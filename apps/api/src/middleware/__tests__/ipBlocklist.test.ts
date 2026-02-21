import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { Socket } from 'net';

// ─── Hoist mocks ─────────────────────────────────────────────────────────────

const { mockExists, mockSetex, mockScan, mockOn } = vi.hoisted(() => ({
  mockExists: vi.fn(),
  mockSetex: vi.fn(),
  mockScan: vi.fn(),
  mockOn: vi.fn(),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    exists: mockExists,
    setex: mockSetex,
    scan: mockScan,
    on: mockOn,
  })),
}));

vi.mock('../../config.js', () => ({
  config: {
    redis: { url: 'redis://localhost:6379' },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { ipBlocklistMiddleware, blockIP } from '../ipBlocklist.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(ip?: string): Request {
  return { ip, socket: { remoteAddress: ip } as Socket } as unknown as Request;
}

function makeRes(): Response {
  const res = { status: vi.fn(), end: vi.fn() } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ipBlocklistMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls next() for a non-blocked IP', async () => {
    mockExists.mockResolvedValue(0);
    const next = vi.fn() as unknown as NextFunction;
    await ipBlocklistMiddleware(makeReq('1.2.3.4'), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 404 for a blocked IP', async () => {
    mockExists.mockResolvedValue(1);
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await ipBlocklistMiddleware(makeReq('5.6.7.8'), res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('fails open (calls next) when Redis throws', async () => {
    mockExists.mockRejectedValue(new Error('Redis connection refused'));
    const next = vi.fn() as unknown as NextFunction;
    await ipBlocklistMiddleware(makeReq('9.9.9.9'), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next() when IP is empty string', async () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = { ip: undefined, socket: { remoteAddress: undefined } } as unknown as Request;
    await ipBlocklistMiddleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(mockExists).not.toHaveBeenCalled();
  });
});

describe('blockIP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets the key in Redis with the given TTL', async () => {
    mockSetex.mockResolvedValue('OK');
    await blockIP('1.2.3.4', 3600);
    expect(mockSetex).toHaveBeenCalledWith('ip_block:1.2.3.4', 3600, '1');
  });

  it('uses the default TTL when none is provided', async () => {
    mockSetex.mockResolvedValue('OK');
    await blockIP('1.2.3.4');
    expect(mockSetex).toHaveBeenCalledWith('ip_block:1.2.3.4', 86400, '1');
  });

  it('logs a warning when Redis throws', async () => {
    const { logger } = await import('../../utils/logger.js');
    mockSetex.mockRejectedValue(new Error('timeout'));
    await blockIP('bad.ip');
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to block IP in Redis',
      expect.objectContaining({ ip: 'bad.ip' }),
    );
  });
});
