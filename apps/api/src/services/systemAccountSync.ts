import { query } from '../db/pool.js';
import logger from '../logger.js';
import { config } from '../config.js';

/**
 * Sync system account IDs from Google Cloud Secret Manager.
 *
 * Reads a JSON array of user IDs from the secret specified by
 * SYSTEM_ACCOUNT_SECRET (e.g. "projects/my-proj/secrets/system-accounts/versions/latest").
 * Sets is_system = true for listed IDs and false for all others.
 *
 * Non-fatal: falls back to migration seed data on failure.
 */
export async function syncSystemAccountsFromSecret(): Promise<void> {
  const secretName = config.systemAccountSecret;
  if (!secretName) {
    logger.debug('SYSTEM_ACCOUNT_SECRET not set, skipping Secret Manager sync');
    return;
  }

  try {
    // Dynamic import so the dep only loads when configured
    const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
    const client = new SecretManagerServiceClient();

    const [version] = await client.accessSecretVersion({ name: secretName });
    const payload = version.payload?.data;
    if (!payload) {
      logger.warn('Secret Manager returned empty payload', { secretName });
      return;
    }

    const raw = typeof payload === 'string' ? payload : Buffer.from(payload as Uint8Array).toString('utf8');
    const systemIds: string[] = JSON.parse(raw);

    if (!Array.isArray(systemIds) || systemIds.some(id => typeof id !== 'string')) {
      logger.warn('Secret Manager payload is not a string array', { secretName });
      return;
    }

    if (systemIds.length === 0) {
      logger.info('Secret Manager returned empty system account list, clearing all');
      await query('UPDATE users SET is_system = false WHERE is_system = true');
      return;
    }

    // Set is_system = true for listed IDs, false for all others
    await query(
      `UPDATE users SET is_system = (id = ANY($1::text[]))
       WHERE is_system = true OR id = ANY($1::text[])`,
      [systemIds]
    );

    logger.info('System accounts synced from Secret Manager', {
      count: systemIds.length,
      ids: systemIds,
    });
  } catch (error) {
    logger.warn('Failed to sync system accounts from Secret Manager (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
      secretName,
    });
  }
}
