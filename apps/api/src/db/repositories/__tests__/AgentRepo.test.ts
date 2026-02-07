import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AgentRepo } from '../AgentRepo.js';
import { UserRepo } from '../UserRepo.js';
import { testDb } from '../../../__tests__/utils/testDb.js';

describe('AgentRepo', () => {
  beforeAll(async () => {
    await testDb.setup();
  });

  beforeEach(async () => {
    await testDb.reset();
  });

  afterAll(async () => {
    await testDb.teardown();
  });

  describe('Agent Identity Management', () => {
    it('should create an agent identity', async () => {
      // Create owner
      const owner = await UserRepo.create('owner1', 'owner@example.com', 'human', 'Owner');
      expect(owner.success).toBe(true);
      const ownerId = owner.data!.id;

      // Create agent
      const agent = await AgentRepo.create(
        'test-agent',
        ownerId,
        'Test Agent',
        'A test agent',
        'GPT-4',
      );

      expect(agent.id).toBe('test-agent');
      expect(agent.owner_id).toBe(ownerId);
      expect(agent.name).toBe('Test Agent');
      expect(agent.description).toBe('A test agent');
    });

    it('should find agent by ID', async () => {
      const owner = await UserRepo.create('owner2', 'owner2@example.com', 'human');
      const ownerId = owner.data!.id;

      await AgentRepo.create('agent2', ownerId, 'Agent 2');

      const found = await AgentRepo.findById('agent2');
      expect(found).not.toBeNull();
      expect(found?.id).toBe('agent2');
      expect(found?.name).toBe('Agent 2');
    });

    it('should find agents by owner', async () => {
      const owner = await UserRepo.create('owner3', 'owner3@example.com', 'human');
      const ownerId = owner.data!.id;

      await AgentRepo.create('agent-a', ownerId, 'Agent A');
      await AgentRepo.create('agent-b', ownerId, 'Agent B');

      const agents = await AgentRepo.findByOwner(ownerId);
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.id)).toContain('agent-a');
      expect(agents.map((a) => a.id)).toContain('agent-b');
    });

    it('should count agents by owner', async () => {
      const owner = await UserRepo.create('owner4', 'owner4@example.com', 'human');
      const ownerId = owner.data!.id;

      await AgentRepo.create('agent1', ownerId, 'Agent 1');
      await AgentRepo.create('agent2', ownerId, 'Agent 2');
      await AgentRepo.create('agent3', ownerId, 'Agent 3');

      const count = await AgentRepo.countByOwner(ownerId);
      expect(count).toBe(3);
    });

    it('should update agent identity', async () => {
      const owner = await UserRepo.create('owner5', 'owner5@example.com', 'human');
      const ownerId = owner.data!.id;

      await AgentRepo.create('agent-update', ownerId, 'Original Name', 'Original desc');

      const updated = await AgentRepo.update('agent-update', {
        name: 'Updated Name',
        description: 'Updated desc',
      });

      expect(updated?.name).toBe('Updated Name');
      expect(updated?.description).toBe('Updated desc');
    });

    it('should soft delete agent', async () => {
      const owner = await UserRepo.create('owner6', 'owner6@example.com', 'human');
      const ownerId = owner.data!.id;

      await AgentRepo.create('agent-delete', ownerId, 'To Delete');

      const deleted = await AgentRepo.softDelete('agent-delete');
      expect(deleted).toBe(true);

      const found = await AgentRepo.findById('agent-delete');
      expect(found).toBeNull();
    });

  });

  describe('Token Management', () => {
    it('should create agent token', async () => {
      const owner = await UserRepo.create('owner9', 'owner9@example.com', 'human');
      const ownerId = owner.data!.id;

      await AgentRepo.create('token-agent', ownerId, 'Token Agent');

      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      const token = await AgentRepo.createToken('token-agent', 'test-jti-123', expiresAt);

      expect(token.agent_id).toBe('token-agent');
      expect(token.jti).toBe('test-jti-123');
      expect(token.revoked_at).toBeNull();
    });

    it('should find token by JTI', async () => {
      const owner = await UserRepo.create('owner10', 'owner10@example.com', 'human');
      const ownerId = owner.data!.id;

      await AgentRepo.create('token-agent2', ownerId, 'Token Agent 2');

      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await AgentRepo.createToken('token-agent2', 'find-jti-456', expiresAt);

      const found = await AgentRepo.findTokenByJti('find-jti-456');
      expect(found).not.toBeNull();
      expect(found?.jti).toBe('find-jti-456');
      expect(found?.agent_id).toBe('token-agent2');
    });

    it('should check if token is valid', async () => {
      const owner = await UserRepo.create('owner11', 'owner11@example.com', 'human');
      const ownerId = owner.data!.id;

      await AgentRepo.create('token-agent3', ownerId, 'Token Agent 3');

      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await AgentRepo.createToken('token-agent3', 'valid-jti-789', expiresAt);

      const isValid = await AgentRepo.isTokenValid('valid-jti-789');
      expect(isValid).toBe(true);
    });

    it('should reject revoked tokens', async () => {
      const owner = await UserRepo.create('owner12', 'owner12@example.com', 'human');
      const ownerId = owner.data!.id;

      await AgentRepo.create('token-agent4', ownerId, 'Token Agent 4');

      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await AgentRepo.createToken('token-agent4', 'revoke-jti-000', expiresAt);

      // Revoke the token
      await AgentRepo.revokeTokenByJti('revoke-jti-000');

      const isValid = await AgentRepo.isTokenValid('revoke-jti-000');
      expect(isValid).toBe(false);
    });

    it('should revoke all tokens for agent', async () => {
      const owner = await UserRepo.create('owner13', 'owner13@example.com', 'human');
      const ownerId = owner.data!.id;

      await AgentRepo.create('token-agent5', ownerId, 'Token Agent 5');

      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await AgentRepo.createToken('token-agent5', 'jti-111', expiresAt);
      await AgentRepo.createToken('token-agent5', 'jti-222', expiresAt);

      const revokedCount = await AgentRepo.revokeAllTokens('token-agent5');
      expect(revokedCount).toBe(2);

      const isValid1 = await AgentRepo.isTokenValid('jti-111');
      const isValid2 = await AgentRepo.isTokenValid('jti-222');
      expect(isValid1).toBe(false);
      expect(isValid2).toBe(false);
    });
  });

  describe('Aggregate Activity Counts', () => {
    it('should get owner activity counts', async () => {
      const owner = await UserRepo.create('owner14', 'owner14@example.com', 'human');
      const ownerId = owner.data!.id;

      await AgentRepo.create('activity-agent', ownerId, 'Activity Agent');

      // Note: In real tests, we'd create actual posts/replies/votes
      // For now, we just test that the query runs without error
      const windowStart = new Date(Date.now() - 60 * 60 * 1000);
      const counts = await AgentRepo.getOwnerActivityCounts(ownerId, windowStart);

      expect(counts.posts).toBe(0);
      expect(counts.replies).toBe(0);
      expect(counts.votes).toBe(0);
    });
  });
});
