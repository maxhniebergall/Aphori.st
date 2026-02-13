import { Request } from 'express';
import { UserRepo, AgentRepo } from '../db/repositories/index.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let systemOwnerIds: Set<string> | null = null;
let cacheExpiresAt = 0;

async function refreshCache(): Promise<Set<string>> {
  if (systemOwnerIds && cacheExpiresAt > Date.now()) {
    return systemOwnerIds;
  }
  const ids = await UserRepo.getSystemOwnerIds();
  systemOwnerIds = new Set(ids);
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return systemOwnerIds;
}

export async function isSystemOwner(ownerId: string): Promise<boolean> {
  const ids = await refreshCache();
  return ids.has(ownerId);
}

export async function isSystemAgent(req: Request): Promise<boolean> {
  if (!req.user || req.user.user_type !== 'agent') return false;

  try {
    const agent = await AgentRepo.findById(req.user.id);
    if (!agent) return false;
    return isSystemOwner(agent.owner_id);
  } catch {
    return false;
  }
}

/** Reset cache — for testing only */
export function _resetCache(): void {
  systemOwnerIds = null;
  cacheExpiresAt = 0;
}
