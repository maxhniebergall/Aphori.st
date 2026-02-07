import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import logger from '../logger.js';
import { AgentRepo, UserRepo } from '../db/repositories/index.js';
import { authenticateToken, generateAuthToken } from '../middleware/auth.js';
import type { ApiError } from '@chitin/shared';

const router: ReturnType<typeof Router> = Router();

// Validation schemas
const registerAgentSchema = z.object({
  id: z.string()
    .min(1, 'Agent ID is required')
    .max(50, 'Agent ID must be at most 50 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Agent ID can only contain letters, numbers, underscores, and hyphens'),
  name: z.string()
    .min(1, 'Name is required')
    .max(100, 'Name must be at most 100 characters'),
  description: z.string()
    .max(1000, 'Description must be at most 1000 characters')
    .optional(),
  model_info: z.string()
    .max(255, 'Model info must be at most 255 characters')
    .optional(),
});

const updateAgentSchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(100, 'Name must be at most 100 characters')
    .optional(),
  description: z.string()
    .max(1000, 'Description must be at most 1000 characters')
    .nullable()
    .optional(),
  model_info: z.string()
    .max(255, 'Model info must be at most 255 characters')
    .nullable()
    .optional(),
});

const MAX_AGENTS_PER_USER = 5;

/**
 * POST /agents/register
 * Register a new AI agent (humans only)
 */
router.post('/register', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    // Only humans can register agents
    if (req.user?.user_type !== 'human') {
      const apiError: ApiError = {
        error: 'Forbidden',
        message: 'Only human users can register agents',
      };
      res.status(403).json(apiError);
      return;
    }

    const input = registerAgentSchema.parse(req.body);

    // Check agent count limit
    const agentCount = await AgentRepo.countByOwner(req.user.id);
    if (agentCount >= MAX_AGENTS_PER_USER) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: `You can register a maximum of ${MAX_AGENTS_PER_USER} agents`,
      };
      res.status(400).json(apiError);
      return;
    }

    // Check if agent ID already exists
    const existing = await AgentRepo.findById(input.id);
    if (existing) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'Agent ID already taken',
      };
      res.status(400).json(apiError);
      return;
    }

    // Create agent identity
    const agent = await AgentRepo.create(
      input.id,
      req.user.id,
      input.name,
      input.description,
      input.model_info,
    );

    // Create agent user account
    const agentEmail = `${input.id}@agent.chitin.social`;
    const userResult = await UserRepo.create(
      input.id,
      agentEmail,
      'agent',
      input.name
    );

    if (!userResult.success) {
      // Clean up agent identity if user creation fails
      await AgentRepo.softDelete(input.id);
      const apiError: ApiError = {
        error: 'Internal Server Error',
        message: 'Failed to create agent account',
      };
      res.status(500).json(apiError);
      return;
    }

    logger.info('Agent registered', {
      agentId: input.id,
      ownerId: req.user.id,
      name: input.name,
    });

    res.status(201).json({
      success: true,
      data: agent,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const apiError: ApiError = {
        error: 'Validation Error',
        message: error.errors[0]?.message || 'Invalid input',
      };
      res.status(400).json(apiError);
      return;
    }

    logger.error('Failed to register agent', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to register agent',
    };
    res.status(500).json(apiError);
  }
});

/**
 * GET /agents/my
 * List authenticated user's agents
 */
router.get('/my', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const agents = await AgentRepo.findByOwner(req.user!.id);

    res.json({
      success: true,
      data: agents,
    });
  } catch (error) {
    logger.error('Failed to fetch user agents', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to fetch agents',
    };
    res.status(500).json(apiError);
  }
});

/**
 * GET /agents/:agentId
 * Get agent details
 */
router.get('/:agentId', async (req: Request<{ agentId: string }>, res: Response): Promise<void> => {
  try {
    const agent = await AgentRepo.findById(req.params.agentId);

    if (!agent) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'Agent not found',
      };
      res.status(404).json(apiError);
      return;
    }

    res.json({
      success: true,
      data: agent,
    });
  } catch (error) {
    logger.error('Failed to fetch agent', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to fetch agent',
    };
    res.status(500).json(apiError);
  }
});

/**
 * PATCH /agents/:agentId
 * Update agent identity (owner only)
 */
router.patch('/:agentId', authenticateToken, async (req: Request<{ agentId: string }>, res: Response): Promise<void> => {
  try {
    const agent = await AgentRepo.findById(req.params.agentId);

    if (!agent) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'Agent not found',
      };
      res.status(404).json(apiError);
      return;
    }

    // Check ownership
    if (agent.owner_id !== req.user!.id) {
      const apiError: ApiError = {
        error: 'Forbidden',
        message: 'You do not have permission to update this agent',
      };
      res.status(403).json(apiError);
      return;
    }

    const input = updateAgentSchema.parse(req.body);

    const updated = await AgentRepo.update(req.params.agentId, {
      name: input.name,
      description: input.description ?? undefined,
      model_info: input.model_info ?? undefined,
    });

    if (!updated) {
      const apiError: ApiError = {
        error: 'Internal Server Error',
        message: 'Failed to update agent',
      };
      res.status(500).json(apiError);
      return;
    }

    logger.info('Agent updated', { agentId: req.params.agentId });

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const apiError: ApiError = {
        error: 'Validation Error',
        message: error.errors[0]?.message || 'Invalid input',
      };
      res.status(400).json(apiError);
      return;
    }

    logger.error('Failed to update agent', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to update agent',
    };
    res.status(500).json(apiError);
  }
});

/**
 * DELETE /agents/:agentId
 * Delete agent (owner only)
 */
router.delete('/:agentId', authenticateToken, async (req: Request<{ agentId: string }>, res: Response): Promise<void> => {
  try {
    const agent = await AgentRepo.findById(req.params.agentId);

    if (!agent) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'Agent not found',
      };
      res.status(404).json(apiError);
      return;
    }

    // Check ownership
    if (agent.owner_id !== req.user!.id) {
      const apiError: ApiError = {
        error: 'Forbidden',
        message: 'You do not have permission to delete this agent',
      };
      res.status(403).json(apiError);
      return;
    }

    // Soft delete agent
    await AgentRepo.softDelete(req.params.agentId);

    // Soft delete agent user
    await UserRepo.softDelete(req.params.agentId);

    // Revoke all tokens
    await AgentRepo.revokeAllTokens(req.params.agentId);

    logger.info('Agent deleted', { agentId: req.params.agentId });

    res.json({
      success: true,
      message: 'Agent deleted',
    });
  } catch (error) {
    logger.error('Failed to delete agent', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to delete agent',
    };
    res.status(500).json(apiError);
  }
});

/**
 * POST /agents/:agentId/token
 * Generate a new agent token (1-hour expiry)
 */
router.post('/:agentId/token', authenticateToken, async (req: Request<{ agentId: string }>, res: Response): Promise<void> => {
  try {
    const agent = await AgentRepo.findById(req.params.agentId);

    if (!agent) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'Agent not found',
      };
      res.status(404).json(apiError);
      return;
    }

    // Check ownership
    if (agent.owner_id !== req.user!.id) {
      const apiError: ApiError = {
        error: 'Forbidden',
        message: 'You do not have permission to generate tokens for this agent',
      };
      res.status(403).json(apiError);
      return;
    }

    // Generate token
    const jti = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Store token record in database
    await AgentRepo.createToken(req.params.agentId, jti, expiresAt);

    // Generate JWT
    const token = generateAuthToken(
      req.params.agentId,
      `${req.params.agentId}@agent.chitin.social`,
      'agent',
      jti,
      '1h'
    );

    logger.info('Agent token generated', { agentId: req.params.agentId });

    res.status(201).json({
      success: true,
      data: {
        token,
        expires_at: expiresAt.toISOString(),
        jti,
      },
    });
  } catch (error) {
    logger.error('Failed to generate token', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to generate token',
    };
    res.status(500).json(apiError);
  }
});

/**
 * POST /agents/:agentId/revoke-tokens
 * Revoke all tokens for an agent
 */
router.post('/:agentId/revoke-tokens', authenticateToken, async (req: Request<{ agentId: string }>, res: Response): Promise<void> => {
  try {
    const agent = await AgentRepo.findById(req.params.agentId);

    if (!agent) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'Agent not found',
      };
      res.status(404).json(apiError);
      return;
    }

    // Check ownership
    if (agent.owner_id !== req.user!.id) {
      const apiError: ApiError = {
        error: 'Forbidden',
        message: 'You do not have permission to revoke tokens for this agent',
      };
      res.status(403).json(apiError);
      return;
    }

    // Revoke all tokens
    const revokedCount = await AgentRepo.revokeAllTokens(req.params.agentId);

    logger.info('Agent tokens revoked', { agentId: req.params.agentId, revokedCount });

    res.json({
      success: true,
      data: {
        revoked_count: revokedCount,
      },
    });
  } catch (error) {
    logger.error('Failed to revoke tokens', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to revoke tokens',
    };
    res.status(500).json(apiError);
  }
});

export default router;
