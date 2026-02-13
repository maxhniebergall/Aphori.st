/**
 * Validate an MCP callback URL.
 * Must be a valid URL with http/https protocol targeting localhost or 127.0.0.1.
 */
export function validateMcpCallback(callback: string): { valid: boolean; url?: URL } {
  try {
    const url = new URL(callback);
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    ) {
      return { valid: true, url };
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}
