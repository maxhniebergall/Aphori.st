import logger from '../logger.js';
import { config } from '../config.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FAILURE_RETRY_MS = 30 * 1000; // 30 seconds

let allowedEmails: Set<string> | null = null;
let cacheExpiresAt = 0;

async function fetchAllowlist(): Promise<string[]> {
  const secretName = config.serviceAuth.allowlistSecret;
  if (!secretName) {
    return [];
  }

  const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
  const client = new SecretManagerServiceClient();

  const [version] = await client.accessSecretVersion({ name: secretName });
  const payload = version.payload?.data;
  if (!payload) {
    logger.warn('Service account allowlist secret returned empty payload', { secretName });
    return [];
  }

  const raw = typeof payload === 'string' ? payload : Buffer.from(payload as Uint8Array).toString('utf8');
  const emails: unknown = JSON.parse(raw);

  if (!Array.isArray(emails) || emails.some(e => typeof e !== 'string')) {
    logger.warn('Service account allowlist is not a string array', { secretName });
    return [];
  }

  return emails as string[];
}

async function refreshCache(): Promise<Set<string>> {
  if (allowedEmails && cacheExpiresAt > Date.now()) {
    return allowedEmails;
  }

  try {
    const emails = await fetchAllowlist();
    allowedEmails = new Set(emails);
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return allowedEmails;
  } catch (error) {
    // If cache exists but expired, keep stale data rather than failing
    if (allowedEmails) {
      logger.warn('Failed to refresh service account allowlist, using stale cache', {
        error: error instanceof Error ? error.message : String(error),
      });
      cacheExpiresAt = Date.now() + FAILURE_RETRY_MS;
      return allowedEmails;
    }
    // No cache at all — return empty set (service auth disabled)
    allowedEmails = new Set();
    cacheExpiresAt = Date.now() + FAILURE_RETRY_MS;
    return allowedEmails;
  }
}

export async function isAllowedServiceAccount(email: string): Promise<boolean> {
  const emails = await refreshCache();
  return emails.has(email);
}

/**
 * Warm the allowlist cache on startup (non-fatal).
 */
export async function syncServiceAccountAllowlist(): Promise<void> {
  const secretName = config.serviceAuth.allowlistSecret;
  if (!secretName) {
    logger.debug('SERVICE_AUTH_ALLOWLIST_SECRET not set, service auth disabled');
    return;
  }

  try {
    const emails = await fetchAllowlist();
    allowedEmails = new Set(emails);
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    logger.info('Service account allowlist synced', { count: emails.length });
  } catch (error) {
    logger.warn('Failed to sync service account allowlist (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
      secretName,
    });
  }
}

/** Reset cache — for testing only */
export function _resetAllowlist(): void {
  allowedEmails = null;
  cacheExpiresAt = 0;
}
