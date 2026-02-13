import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock config — vi.mock is hoisted, so use vi.hoisted for shared state
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    serviceAuth: {
      allowlistSecret: JSON.stringify(['runner@proj.iam.gserviceaccount.com']),
      audience: 'https://api.test.com',
    },
  },
}));

vi.mock('../../config.js', () => ({
  config: mockConfig,
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

import { isAllowedServiceAccount, syncServiceAccountAllowlist, _resetAllowlist } from '../serviceAccountAllowlist.js';

beforeEach(() => {
  _resetAllowlist();
  mockConfig.serviceAuth.allowlistSecret = JSON.stringify(['runner@proj.iam.gserviceaccount.com']);
});

describe('isAllowedServiceAccount', () => {
  it('returns true for allowed emails', async () => {
    expect(await isAllowedServiceAccount('runner@proj.iam.gserviceaccount.com')).toBe(true);
  });

  it('returns false for disallowed emails', async () => {
    expect(await isAllowedServiceAccount('hacker@evil.com')).toBe(false);
  });

  it('returns consistent results across calls', async () => {
    expect(await isAllowedServiceAccount('runner@proj.iam.gserviceaccount.com')).toBe(true);
    expect(await isAllowedServiceAccount('runner@proj.iam.gserviceaccount.com')).toBe(true);
    expect(await isAllowedServiceAccount('other@b.com')).toBe(false);
  });

  it('refreshes after reset', async () => {
    expect(await isAllowedServiceAccount('runner@proj.iam.gserviceaccount.com')).toBe(true);

    _resetAllowlist();
    mockConfig.serviceAuth.allowlistSecret = JSON.stringify([]);

    expect(await isAllowedServiceAccount('runner@proj.iam.gserviceaccount.com')).toBe(false);
  });

  it('returns false on invalid JSON', async () => {
    _resetAllowlist();
    mockConfig.serviceAuth.allowlistSecret = 'not-json';
    expect(await isAllowedServiceAccount('a@b.com')).toBe(false);
  });
});

describe('syncServiceAccountAllowlist', () => {
  it('warms the cache on success', async () => {
    await syncServiceAccountAllowlist();
    expect(await isAllowedServiceAccount('runner@proj.iam.gserviceaccount.com')).toBe(true);
  });

  it('handles invalid JSON gracefully', async () => {
    mockConfig.serviceAuth.allowlistSecret = 'not-json';
    await syncServiceAccountAllowlist();
    // Should not throw
  });
});

describe('disabled service auth', () => {
  it('returns false when secret not configured', async () => {
    mockConfig.serviceAuth.allowlistSecret = '';
    _resetAllowlist();

    await syncServiceAccountAllowlist();
    expect(await isAllowedServiceAccount('anything@test.com')).toBe(false);
  });
});
