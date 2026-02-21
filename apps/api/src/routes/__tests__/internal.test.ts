import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Hoist mocks ─────────────────────────────────────────────────────────────

const { mockBlockIP, mockGetBlockedIPs } = vi.hoisted(() => ({
  mockBlockIP: vi.fn(),
  mockGetBlockedIPs: vi.fn(),
}));

vi.mock('../../middleware/ipBlocklist.js', () => ({
  blockIP: (...args: unknown[]) => mockBlockIP(...args),
  getBlockedIPs: (...args: unknown[]) => mockGetBlockedIPs(...args),
}));

vi.mock('../../config.js', () => ({
  config: {
    internalSecret: 'test-secret-value',
  },
}));

import internalRouter from '../internal.js';

// ─── App fixture ─────────────────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/internal', internalRouter);
  return app;
}

// ─── Auth guard ──────────────────────────────────────────────────────────────

describe('internal route auth guard', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 404 when no secret is provided', async () => {
    const res = await request(createApp()).post('/internal/block-ip').send({ ip: '1.2.3.4' });
    expect(res.status).toBe(404);
  });

  it('returns 404 when the wrong secret is provided', async () => {
    const res = await request(createApp())
      .post('/internal/block-ip')
      .set('x-internal-secret', 'wrong-secret')
      .send({ ip: '1.2.3.4' });
    expect(res.status).toBe(404);
  });

  it('proceeds when the correct secret is provided', async () => {
    mockBlockIP.mockResolvedValue(undefined);
    const res = await request(createApp())
      .post('/internal/block-ip')
      .set('x-internal-secret', 'test-secret-value')
      .send({ ip: '1.2.3.4' });
    expect(res.status).toBe(200);
  });
});

// ─── POST /internal/block-ip ─────────────────────────────────────────────────

describe('POST /internal/block-ip', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const authed = () =>
    request(createApp())
      .post('/internal/block-ip')
      .set('x-internal-secret', 'test-secret-value');

  it('returns 400 when ip is missing', async () => {
    const res = await authed().send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ip is required/i);
  });

  it('blocks the IP and returns ok:true', async () => {
    mockBlockIP.mockResolvedValue(undefined);
    const res = await authed().send({ ip: '10.0.0.1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockBlockIP).toHaveBeenCalledWith('10.0.0.1', undefined);
  });

  it('passes a valid ttlSeconds to blockIP', async () => {
    mockBlockIP.mockResolvedValue(undefined);
    const res = await authed().send({ ip: '10.0.0.1', ttlSeconds: 3600 });
    expect(res.status).toBe(200);
    expect(mockBlockIP).toHaveBeenCalledWith('10.0.0.1', 3600);
  });

  it('returns 400 for negative ttlSeconds', async () => {
    const res = await authed().send({ ip: '10.0.0.1', ttlSeconds: -1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for zero ttlSeconds', async () => {
    const res = await authed().send({ ip: '10.0.0.1', ttlSeconds: 0 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-integer ttlSeconds', async () => {
    const res = await authed().send({ ip: '10.0.0.1', ttlSeconds: 1.5 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for Infinity ttlSeconds', async () => {
    const res = await authed().send({ ip: '10.0.0.1', ttlSeconds: 1e309 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when ttlSeconds exceeds the 30-day maximum', async () => {
    const res = await authed().send({ ip: '10.0.0.1', ttlSeconds: 31 * 24 * 60 * 60 });
    expect(res.status).toBe(400);
  });
});

// ─── GET /internal/blocked-ips ───────────────────────────────────────────────

describe('GET /internal/blocked-ips', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 404 without a valid secret', async () => {
    const res = await request(createApp()).get('/internal/blocked-ips');
    expect(res.status).toBe(404);
  });

  it('returns the list of blocked IPs', async () => {
    mockGetBlockedIPs.mockResolvedValue(['1.1.1.1', '2.2.2.2']);
    const res = await request(createApp())
      .get('/internal/blocked-ips')
      .set('x-internal-secret', 'test-secret-value');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ips: ['1.1.1.1', '2.2.2.2'] });
  });
});
