import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Hoist mocks
const { mockVerifyIdToken, mockIsAllowed, mockFindById } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  mockIsAllowed: vi.fn(),
  mockFindById: vi.fn(),
}));

// Mock google-auth-library
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

// Mock the allowlist cache
vi.mock('../../cache/serviceAccountAllowlist.js', () => ({
  isAllowedServiceAccount: (...args: any[]) => mockIsAllowed(...args),
  syncServiceAccountAllowlist: vi.fn(),
  _resetAllowlist: vi.fn(),
}));

// Mock UserRepo
vi.mock('../../db/repositories/index.js', () => ({
  UserRepo: {
    findById: (...args: any[]) => mockFindById(...args),
    findByEmail: vi.fn(),
    create: vi.fn(),
    isIdAvailable: vi.fn(),
  },
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

// Mock mailer
vi.mock('../../services/mailer.js', () => ({
  sendEmail: vi.fn(),
}));

import authRoutes from '../auth.js';

// Create a minimal Express app with the auth routes
function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRoutes);
  return app;
}

describe('POST /auth/service', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  function validGoogleToken(email: string) {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email,
        email_verified: true,
        sub: 'gcp-sub-123',
      }),
    });
  }

  function invalidGoogleToken() {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));
  }

  const systemUser = {
    id: 'aphorist-system',
    email: 'system@aphori.st',
    display_name: 'Aphorist System',
    user_type: 'human' as const,
    created_at: new Date().toISOString(),
  };

  it('returns 200 with JWT for valid token and allowed service account', async () => {
    validGoogleToken('runner@proj.iam.gserviceaccount.com');
    mockIsAllowed.mockResolvedValue(true);
    mockFindById.mockResolvedValue(systemUser);

    const res = await request(app)
      .post('/api/v1/auth/service')
      .send({ identity_token: 'valid-gcp-token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.id).toBe('aphorist-system');
    expect(res.body.data.expires_at).toBeDefined();
  });

  it('returns 401 for invalid GCP identity token', async () => {
    invalidGoogleToken();

    const res = await request(app)
      .post('/api/v1/auth/service')
      .send({ identity_token: 'bad-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns 403 for valid token but disallowed service account', async () => {
    validGoogleToken('not-allowed@evil.com');
    mockIsAllowed.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/v1/auth/service')
      .send({ identity_token: 'valid-but-not-allowed' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('returns 400 for missing identity_token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/service')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation Error');
  });

  it('returns 500 when system user does not exist', async () => {
    validGoogleToken('runner@proj.iam.gserviceaccount.com');
    mockIsAllowed.mockResolvedValue(true);
    mockFindById.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/auth/service')
      .send({ identity_token: 'valid-gcp-token' });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('System user not configured');
  });
});
