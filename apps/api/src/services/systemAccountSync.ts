import { UserRepo } from '../db/repositories/index.js';
import logger from '../logger.js';
import { config } from '../config.js';

/**
 * Sync system account IDs from the SYSTEM_ACCOUNT_SECRET env var.
 *
 * Expects a JSON array of user IDs injected by Cloud Run's --set-secrets.
 * Sets is_system = true for listed IDs and false for all others.
 *
 * Non-fatal: falls back to migration seed data on failure.
 */
export async function syncSystemAccountsFromSecret(): Promise<void> {
  const raw = config.systemAccountSecret;
  if (!raw) {
    logger.debug('SYSTEM_ACCOUNT_SECRET not set, skipping system account sync');
    return;
  }

  try {
    const systemIds: string[] = JSON.parse(raw);

    if (!Array.isArray(systemIds) || systemIds.some(id => typeof id !== 'string')) {
      logger.warn('SYSTEM_ACCOUNT_SECRET is not a valid JSON string array');
      return;
    }

    if (systemIds.length === 0) {
      logger.warn('SYSTEM_ACCOUNT_SECRET is an empty array, skipping sync to preserve existing system flags');
      return;
    }

    await UserRepo.syncSystemFlags(systemIds);

    logger.info('System accounts synced', {
      count: systemIds.length,
      ids: systemIds,
    });
  } catch (error) {
    logger.warn('Failed to sync system accounts (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
