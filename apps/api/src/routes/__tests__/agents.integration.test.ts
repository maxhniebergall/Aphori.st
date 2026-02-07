import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testDb } from '../../__tests__/utils/testDb.js';
import { UserRepo } from '../../db/repositories/index.js';
import { generateAuthToken } from '../../middleware/auth.js';

const apiUrl = 'http://localhost:3001';

describe('Agent Routes Integration Tests', () => {
  beforeAll(async () => {
    await testDb.setup();
  });

  beforeEach(async () => {
    await testDb.reset();
  });

  afterAll(async () => {
    await testDb.teardown();
  });

  describe('POST /agents/register', () => {
    it('should register a new agent as human user', async () => {
      // Create a human user
      const user = await UserRepo.create('human1', 'human1@example.com', 'human');
      const token = generateAuthToken(user.data!.id, user.data!.email, 'human');

      const response = await fetch(`${apiUrl}/api/v1/agents/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: 'my-agent',
          name: 'My Agent',
          description: 'A test agent',
          model_info: 'GPT-4',
        }),
      });

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('my-agent');
      expect(data.data.name).toBe('My Agent');
      expect(data.data.owner_id).toBe(user.data!.id);
    });

    it('should reject agent registration by non-human users', async () => {
      // Create an agent user (this shouldn't be possible in normal flow, but test the guard)
      const user = await UserRepo.create('agent1', 'agent1@agent.chitin.social', 'agent');
      const token = generateAuthToken(user.data!.id, user.data!.email, 'agent');

      const response = await fetch(`${apiUrl}/api/v1/agents/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: 'bad-agent',
          name: 'Bad Agent',
        }),
      });

      expect(response.status).toBe(403);
    });

    it('should enforce max agents per user', async () => {
      const user = await UserRepo.create('human2', 'human2@example.com', 'human');
      const token = generateAuthToken(user.data!.id, user.data!.email, 'human');

      // Register 5 agents
      for (let i = 0; i < 5; i++) {
        const response = await fetch(`${apiUrl}/api/v1/agents/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            id: `agent-${i}`,
            name: `Agent ${i}`,
          }),
        });
        expect(response.status).toBe(201);
      }

      // Try to register 6th agent
      const response = await fetch(`${apiUrl}/api/v1/agents/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: 'agent-6',
          name: 'Agent 6',
        }),
      });

      expect(response.status).toBe(400);
      const data = (await response.json()) as any;
      expect(data.error).toBe('Bad Request');
    });

    it('should reject duplicate agent IDs', async () => {
      const user = await UserRepo.create('human3', 'human3@example.com', 'human');
      const token = generateAuthToken(user.data!.id, user.data!.email, 'human');

      // Register first agent
      await fetch(`${apiUrl}/api/v1/agents/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: 'duplicate-agent',
          name: 'First Agent',
        }),
      });

      // Try to register with same ID
      const response = await fetch(`${apiUrl}/api/v1/agents/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: 'duplicate-agent',
          name: 'Second Agent',
        }),
      });

      expect(response.status).toBe(400);
      const data = (await response.json()) as any;
      expect(data.message).toContain('already taken');
    });
  });

  describe('GET /agents/my', () => {
    it('should list user\'s agents', async () => {
      const user = await UserRepo.create('human4', 'human4@example.com', 'human');
      const token = generateAuthToken(user.data!.id, user.data!.email, 'human');

      // Register two agents
      for (let i = 0; i < 2; i++) {
        await fetch(`${apiUrl}/api/v1/agents/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            id: `my-agent-${i}`,
            name: `My Agent ${i}`,
          }),
        });
      }

      // List agents
      const response = await fetch(`${apiUrl}/api/v1/agents/my`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
    });
  });

  describe('POST /agents/:agentId/token', () => {
    it('should generate agent token', async () => {
      const user = await UserRepo.create('human6', 'human6@example.com', 'human');
      const token = generateAuthToken(user.data!.id, user.data!.email, 'human');

      // Register agent
      await fetch(`${apiUrl}/api/v1/agents/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: 'token-agent',
          name: 'Token Agent',
        }),
      });

      // Generate token
      const response = await fetch(`${apiUrl}/api/v1/agents/token-agent/token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
      expect(data.data.token).toBeDefined();
      expect(data.data.expires_at).toBeDefined();
      expect(data.data.jti).toBeDefined();
    });

    it('should allow agent to use generated token', async () => {
      const user = await UserRepo.create('human7', 'human7@example.com', 'human');
      const token = generateAuthToken(user.data!.id, user.data!.email, 'human');

      // Register agent
      await fetch(`${apiUrl}/api/v1/agents/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: 'auth-agent',
          name: 'Auth Agent',
        }),
      });

      // Generate token for agent
      const tokenResponse = await fetch(`${apiUrl}/api/v1/agents/auth-agent/token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const tokenData = (await tokenResponse.json()) as any;
      const agentToken = tokenData.data.token;

      // Use agent token to make authenticated request
      const meResponse = await fetch(`${apiUrl}/api/v1/auth/me`, {
        headers: {
          Authorization: `Bearer ${agentToken}`,
        },
      });

      expect(meResponse.status).toBe(200);
      const meData = (await meResponse.json()) as any;
      expect(meData.user_type).toBe('agent');
    });
  });

  describe('POST /agents/:agentId/revoke-tokens', () => {
    it('should revoke all agent tokens', async () => {
      const user = await UserRepo.create('human8', 'human8@example.com', 'human');
      const token = generateAuthToken(user.data!.id, user.data!.email, 'human');

      // Register agent
      await fetch(`${apiUrl}/api/v1/agents/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: 'revoke-agent',
          name: 'Revoke Agent',
        }),
      });

      // Generate token
      const tokenResponse = await fetch(`${apiUrl}/api/v1/agents/revoke-agent/token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const tokenData = (await tokenResponse.json()) as any;
      const agentToken = tokenData.data.token;

      // Verify token works
      let meResponse = await fetch(`${apiUrl}/api/v1/auth/me`, {
        headers: {
          Authorization: `Bearer ${agentToken}`,
        },
      });
      expect(meResponse.status).toBe(200);

      // Revoke all tokens
      const revokeResponse = await fetch(`${apiUrl}/api/v1/agents/revoke-agent/revoke-tokens`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      expect(revokeResponse.status).toBe(200);

      // Verify token no longer works
      meResponse = await fetch(`${apiUrl}/api/v1/auth/me`, {
        headers: {
          Authorization: `Bearer ${agentToken}`,
        },
      });
      expect(meResponse.status).toBe(401);
    });
  });

  describe('DELETE /agents/:agentId', () => {
    it('should delete agent', async () => {
      const user = await UserRepo.create('human9', 'human9@example.com', 'human');
      const token = generateAuthToken(user.data!.id, user.data!.email, 'human');

      // Register agent
      await fetch(`${apiUrl}/api/v1/agents/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: 'delete-agent',
          name: 'Delete Agent',
        }),
      });

      // Delete agent
      const deleteResponse = await fetch(`${apiUrl}/api/v1/agents/delete-agent`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      expect(deleteResponse.status).toBe(200);

      // Verify agent is deleted
      const getResponse = await fetch(`${apiUrl}/api/v1/agents/delete-agent`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      expect(getResponse.status).toBe(404);
    });
  });
});
