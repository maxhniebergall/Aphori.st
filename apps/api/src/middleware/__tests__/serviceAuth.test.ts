import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock google-auth-library
const { mockVerifyIdToken } = vi.hoisted(() => {
  const mockVerifyIdToken = vi.fn();
  return { mockVerifyIdToken };
});
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

vi.mock('../../config.js', () => ({
  config: {
    serviceAuth: {
      allowlistSecret: '',
      audience: 'https://api.test.com',
    },
  },
}));

import { verifyGoogleIdentityToken } from '../serviceAuth.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('verifyGoogleIdentityToken', () => {
  it('returns email and sub for a valid token', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: 'runner@proj.iam.gserviceaccount.com',
        email_verified: true,
        sub: '12345',
      }),
    });

    const result = await verifyGoogleIdentityToken('valid-token');
    expect(result).toEqual({
      email: 'runner@proj.iam.gserviceaccount.com',
      sub: '12345',
    });
    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'valid-token',
      audience: 'https://api.test.com',
    });
  });

  it('uses custom audience when provided', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: 'runner@proj.iam.gserviceaccount.com',
        email_verified: true,
        sub: '12345',
      }),
    });

    await verifyGoogleIdentityToken('valid-token', 'https://custom.audience.com');
    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'valid-token',
      audience: 'https://custom.audience.com',
    });
  });

  it('throws when email is missing', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: '12345' }),
    });

    await expect(verifyGoogleIdentityToken('bad-token'))
      .rejects.toThrow('Token missing verified email');
  });

  it('throws when email is not verified', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: 'runner@proj.iam.gserviceaccount.com',
        email_verified: false,
        sub: '12345',
      }),
    });

    await expect(verifyGoogleIdentityToken('bad-token'))
      .rejects.toThrow('Token missing verified email');
  });

  it('throws when Google rejects the token', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Token expired'));

    await expect(verifyGoogleIdentityToken('expired-token'))
      .rejects.toThrow('Token expired');
  });
});
