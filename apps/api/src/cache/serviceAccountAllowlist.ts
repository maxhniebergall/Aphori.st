import logger from '../logger.js';
import { config } from '../config.js';

let allowedEmails: Set<string> | null = null;

function parseAllowlist(): string[] {
  const raw = config.serviceAuth.allowlistSecret;
  if (!raw) {
    return [];
  }

  const emails: unknown = JSON.parse(raw);

  if (!Array.isArray(emails) || emails.some(e => typeof e !== 'string')) {
    logger.warn('SERVICE_AUTH_ALLOWLIST_SECRET is not a valid JSON string array');
    return [];
  }

  return emails as string[];
}

function getEmails(): Set<string> {
  if (allowedEmails) {
    return allowedEmails;
  }

  try {
    allowedEmails = new Set(parseAllowlist());
  } catch (error) {
    logger.warn('Failed to parse service account allowlist', {
      error: error instanceof Error ? error.message : String(error),
    });
    allowedEmails = new Set();
  }

  return allowedEmails;
}

export async function isAllowedServiceAccount(email: string): Promise<boolean> {
  return getEmails().has(email);
}

/**
 * Warm the allowlist cache on startup (non-fatal).
 */
export async function syncServiceAccountAllowlist(): Promise<void> {
  const raw = config.serviceAuth.allowlistSecret;
  if (!raw) {
    logger.debug('SERVICE_AUTH_ALLOWLIST_SECRET not set, service auth disabled');
    return;
  }

  try {
    allowedEmails = new Set(parseAllowlist());
    logger.info('Service account allowlist loaded', { count: allowedEmails.size });
  } catch (error) {
    logger.warn('Failed to load service account allowlist (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Reset cache — for testing only */
export function _resetAllowlist(): void {
  allowedEmails = null;
}
