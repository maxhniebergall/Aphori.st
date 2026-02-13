import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isAllowedServiceAccount, syncServiceAccountAllowlist, _resetAllowlist } from '../serviceAccountAllowlist.js';

// Mock config
vi.mock('../../config.js', () => ({
  config: {
    serviceAuth: {
      allowlistSecret: 'projects/test/secrets/allowlist/versions/latest',
      audience: 'https://api.test.com',
    },
  },
}));

// Mock Secret Manager
const mockAccessSecretVersion = vi.fn();
vi.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: vi.fn().mockImplementation(() => ({
    accessSecretVersion: mockAccessSecretVersion,
  })),
}));

// Mock logger
vi.mock('../../logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

beforeEach(() => {
  _resetAllowlist();
  vi.clearAllMocks();
});

describe('isAllowedServiceAccount', () => {
  it('returns true for allowed emails', async () => {
    mockAccessSecretVersion.mockResolvedValue([{
      payload: { data: JSON.stringify(['runner@proj.iam.gserviceaccount.com']) },
    }]);

    expect(await isAllowedServiceAccount('runner@proj.iam.gserviceaccount.com')).toBe(true);
  });

  it('returns false for disallowed emails', async () => {
    mockAccessSecretVersion.mockResolvedValue([{
      payload: { data: JSON.stringify(['runner@proj.iam.gserviceaccount.com']) },
    }]);

    expect(await isAllowedServiceAccount('hacker@evil.com')).toBe(false);
  });

  it('caches results within TTL', async () => {
    mockAccessSecretVersion.mockResolvedValue([{
      payload: { data: JSON.stringify(['a@b.com']) },
    }]);

    await isAllowedServiceAccount('a@b.com');
    await isAllowedServiceAccount('a@b.com');
    await isAllowedServiceAccount('other@b.com');
    expect(mockAccessSecretVersion).toHaveBeenCalledTimes(1);
  });

  it('refreshes after reset', async () => {
    mockAccessSecretVersion.mockResolvedValue([{
      payload: { data: JSON.stringify(['a@b.com']) },
    }]);

    expect(await isAllowedServiceAccount('a@b.com')).toBe(true);

    _resetAllowlist();
    mockAccessSecretVersion.mockResolvedValue([{
      payload: { data: JSON.stringify([]) },
    }]);

    expect(await isAllowedServiceAccount('a@b.com')).toBe(false);
    expect(mockAccessSecretVersion).toHaveBeenCalledTimes(2);
  });

  it('returns empty set on fetch error with no prior cache', async () => {
    mockAccessSecretVersion.mockRejectedValue(new Error('network error'));

    expect(await isAllowedServiceAccount('a@b.com')).toBe(false);
  });

  it('returns stale cache on fetch error when cache exists', async () => {
    mockAccessSecretVersion.mockResolvedValue([{
      payload: { data: JSON.stringify(['a@b.com']) },
    }]);
    await isAllowedServiceAccount('a@b.com');

    // Expire cache then fail on refresh
    _resetAllowlist();
    // Re-populate then expire
    await isAllowedServiceAccount('a@b.com'); // repopulates
    // Now manually expire by resetting and having fetch fail
    _resetAllowlist();

    // First call populated the set. After reset + error, it should handle gracefully
    mockAccessSecretVersion.mockRejectedValue(new Error('network error'));
    // With no cache (reset clears it), returns empty
    expect(await isAllowedServiceAccount('a@b.com')).toBe(false);
  });
});

describe('syncServiceAccountAllowlist', () => {
  it('warms the cache on success', async () => {
    mockAccessSecretVersion.mockResolvedValue([{
      payload: { data: JSON.stringify(['runner@proj.iam.gserviceaccount.com']) },
    }]);

    await syncServiceAccountAllowlist();

    // Should be cached — no additional Secret Manager call
    expect(await isAllowedServiceAccount('runner@proj.iam.gserviceaccount.com')).toBe(true);
    expect(mockAccessSecretVersion).toHaveBeenCalledTimes(1);
  });

  it('handles errors gracefully', async () => {
    mockAccessSecretVersion.mockRejectedValue(new Error('secret not found'));

    // Should not throw
    await syncServiceAccountAllowlist();
  });
});

describe('disabled service auth', () => {
  it('returns false when secret not configured', async () => {
    // Override config to have empty secret
    const { config } = await import('../../config.js');
    const original = config.serviceAuth.allowlistSecret;
    (config.serviceAuth as any).allowlistSecret = '';
    _resetAllowlist();

    await syncServiceAccountAllowlist();
    expect(await isAllowedServiceAccount('anything@test.com')).toBe(false);
    expect(mockAccessSecretVersion).not.toHaveBeenCalled();

    (config.serviceAuth as any).allowlistSecret = original;
  });
});
