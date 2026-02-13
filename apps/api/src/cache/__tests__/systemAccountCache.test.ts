import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isSystemOwner, isSystemAgent, _resetCache } from '../systemAccountCache.js';

// Mock repositories
vi.mock('../../db/repositories/index.js', () => ({
  UserRepo: {
    getSystemOwnerIds: vi.fn(),
  },
  AgentRepo: {
    findById: vi.fn(),
  },
}));

import { UserRepo, AgentRepo } from '../../db/repositories/index.js';

const mockGetSystemOwnerIds = vi.mocked(UserRepo.getSystemOwnerIds);
const mockAgentFindById = vi.mocked(AgentRepo.findById);

beforeEach(() => {
  _resetCache();
  vi.clearAllMocks();
});

describe('isSystemOwner', () => {
  it('returns true for system owner IDs', async () => {
    mockGetSystemOwnerIds.mockResolvedValue(['aphorist-system', 'other-system']);
    expect(await isSystemOwner('aphorist-system')).toBe(true);
    expect(await isSystemOwner('other-system')).toBe(true);
  });

  it('returns false for non-system owner IDs', async () => {
    mockGetSystemOwnerIds.mockResolvedValue(['aphorist-system']);
    expect(await isSystemOwner('regular-user')).toBe(false);
  });

  it('caches results and does not re-query within TTL', async () => {
    mockGetSystemOwnerIds.mockResolvedValue(['aphorist-system']);
    await isSystemOwner('aphorist-system');
    await isSystemOwner('aphorist-system');
    await isSystemOwner('other-user');
    expect(mockGetSystemOwnerIds).toHaveBeenCalledTimes(1);
  });

  it('refreshes cache after reset', async () => {
    mockGetSystemOwnerIds.mockResolvedValue(['aphorist-system']);
    expect(await isSystemOwner('aphorist-system')).toBe(true);

    _resetCache();
    mockGetSystemOwnerIds.mockResolvedValue([]);
    expect(await isSystemOwner('aphorist-system')).toBe(false);
    expect(mockGetSystemOwnerIds).toHaveBeenCalledTimes(2);
  });
});

describe('isSystemAgent', () => {
  function makeReq(user?: { id: string; user_type: string }) {
    return { user } as any;
  }

  it('returns false for unauthenticated requests', async () => {
    expect(await isSystemAgent(makeReq())).toBe(false);
  });

  it('returns false for human users', async () => {
    expect(await isSystemAgent(makeReq({ id: 'human-1', user_type: 'human' }))).toBe(false);
  });

  it('returns false for agents with unknown ID', async () => {
    mockAgentFindById.mockResolvedValue(null);
    expect(await isSystemAgent(makeReq({ id: 'ghost-agent', user_type: 'agent' }))).toBe(false);
  });

  it('returns true for agents owned by system accounts', async () => {
    mockAgentFindById.mockResolvedValue({ id: 'my-agent', owner_id: 'aphorist-system' } as any);
    mockGetSystemOwnerIds.mockResolvedValue(['aphorist-system']);
    expect(await isSystemAgent(makeReq({ id: 'my-agent', user_type: 'agent' }))).toBe(true);
  });

  it('returns false for agents owned by regular accounts', async () => {
    mockAgentFindById.mockResolvedValue({ id: 'my-agent', owner_id: 'regular-user' } as any);
    mockGetSystemOwnerIds.mockResolvedValue(['aphorist-system']);
    expect(await isSystemAgent(makeReq({ id: 'my-agent', user_type: 'agent' }))).toBe(false);
  });
});
