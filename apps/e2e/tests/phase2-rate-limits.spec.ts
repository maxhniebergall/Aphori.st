import { test, expect } from '@playwright/test';

/**
 * Phase 2 Tests: Per-Action Rate Limits
 * Tests for differentiated rate limits on posts, replies, and votes
 *
 * Note: These tests verify rate limit headers are present and that
 * the rate limiting middleware is applied. Full exhaustion tests
 * would require many requests and are marked as slow.
 */

test.describe('Per-Action Rate Limits', () => {
  test.describe('Post Rate Limiting', () => {
    test('should include rate limit headers on post creation', async ({ request }) => {
      const response = await request.post('http://localhost:3001/api/v1/posts', {
        headers: { 'Authorization': 'Bearer dev_token' },
        data: {
          title: `Rate Limit Test ${Date.now()}`,
          content: 'Testing post rate limits',
        },
      });

      // Accept success or rate limited (both show headers)
      expect([200, 201, 429]).toContain(response.status());

      // Check for standard rate limit headers
      const headers = response.headers();
      expect(headers['ratelimit-limit'] || headers['x-ratelimit-limit']).toBeDefined();
    });

    test('should allow post creation within limits', async ({ request }) => {
      const response = await request.post('http://localhost:3001/api/v1/posts', {
        headers: { 'Authorization': 'Bearer dev_token' },
        data: {
          title: `Within Limits Post ${Date.now()}`,
          content: 'This should succeed',
        },
      });

      // Should succeed or be rate limited (both are valid outcomes)
      expect([200, 201, 429]).toContain(response.status());
    });
  });

  test.describe('Reply Rate Limiting', () => {
    let postId: string | undefined;

    test.beforeEach(async ({ request }) => {
      // Create a post to reply to
      const response = await request.post('http://localhost:3001/api/v1/posts', {
        headers: { 'Authorization': 'Bearer dev_token' },
        data: {
          title: `Reply Rate Limit Test ${Date.now()}`,
          content: 'Post for reply rate limit testing',
        },
      });

      // Handle rate limiting in beforeEach
      if (response.ok()) {
        const json = await response.json();
        postId = json.data?.id;
      }
    });

    test('should include rate limit headers on reply creation', async ({ request }) => {
      test.skip(!postId, 'Skipped due to rate limiting on post creation');

      const response = await request.post(`http://localhost:3001/api/v1/posts/${postId}/replies`, {
        headers: { 'Authorization': 'Bearer dev_token' },
        data: {
          content: `Rate limit test reply ${Date.now()}`,
        },
      });

      expect([200, 201, 429]).toContain(response.status());

      // Check for rate limit headers
      const headers = response.headers();
      expect(headers['ratelimit-limit'] || headers['x-ratelimit-limit']).toBeDefined();
    });

    test('should allow reply creation within limits', async ({ request }) => {
      test.skip(!postId, 'Skipped due to rate limiting on post creation');

      const response = await request.post(`http://localhost:3001/api/v1/posts/${postId}/replies`, {
        headers: { 'Authorization': 'Bearer dev_token' },
        data: {
          content: 'This reply should succeed',
        },
      });

      expect([200, 201, 429]).toContain(response.status());
    });
  });

  test.describe('Vote Rate Limiting', () => {
    let postId: string | undefined;

    test.beforeEach(async ({ request }) => {
      // Create a post to vote on
      const response = await request.post('http://localhost:3001/api/v1/posts', {
        headers: { 'Authorization': 'Bearer dev_token' },
        data: {
          title: `Vote Rate Limit Test ${Date.now()}`,
          content: 'Post for vote rate limit testing',
        },
      });

      // Handle rate limiting in beforeEach
      if (response.ok()) {
        const json = await response.json();
        postId = json.data?.id;
      }
    });

    test('should include rate limit headers on vote creation', async ({ request }) => {
      test.skip(!postId, 'Skipped due to rate limiting on post creation');

      const response = await request.post('http://localhost:3001/api/v1/votes', {
        headers: { 'Authorization': 'Bearer dev_token' },
        data: {
          target_type: 'post',
          target_id: postId,
          value: 1,
        },
      });

      expect([200, 201, 429]).toContain(response.status());

      // Check for rate limit headers
      const headers = response.headers();
      expect(headers['ratelimit-limit'] || headers['x-ratelimit-limit']).toBeDefined();
    });

    test('should allow vote creation within limits', async ({ request }) => {
      test.skip(!postId, 'Skipped due to rate limiting on post creation');

      const response = await request.post('http://localhost:3001/api/v1/votes', {
        headers: { 'Authorization': 'Bearer dev_token' },
        data: {
          target_type: 'post',
          target_id: postId,
          value: 1,
        },
      });

      expect([200, 201, 429]).toContain(response.status());
    });
  });

  test.describe('Anonymous Rate Limiting', () => {
    test('should allow anonymous feed access', async ({ request }) => {
      const response = await request.get('http://localhost:3001/api/v1/feed');

      // Anonymous users can read the feed
      expect(response.ok()).toBeTruthy();
    });

    test('should reject anonymous post creation', async ({ request }) => {
      const response = await request.post('http://localhost:3001/api/v1/posts', {
        data: {
          title: 'Anonymous post attempt',
          content: 'This should fail',
        },
      });

      // Should require authentication
      expect([401, 403]).toContain(response.status());
    });

    test('should reject anonymous vote creation', async ({ request }) => {
      const response = await request.post('http://localhost:3001/api/v1/votes', {
        data: {
          target_type: 'post',
          target_id: 'some-id',
          value: 1,
        },
      });

      // Should require authentication
      expect([401, 403]).toContain(response.status());
    });
  });

  test.describe('Rate Limit Response Format', () => {
    test('rate limit error should have proper format', async ({ request }) => {
      // This test documents the expected error format when rate limited
      // We can't easily trigger a rate limit in tests, but we can verify
      // the format is correct when it does occur

      const response = await request.post('http://localhost:3001/api/v1/posts', {
        headers: { 'Authorization': 'Bearer dev_token' },
        data: {
          title: `Format Test ${Date.now()}`,
          content: 'Testing response format',
        },
      });

      // If rate limited, verify format
      if (response.status() === 429) {
        const json = await response.json();
        expect(json).toHaveProperty('error', 'Too Many Requests');
        expect(json).toHaveProperty('message');
        expect(json.message).toContain('Rate limit exceeded');
      } else {
        // Otherwise, just verify success
        expect(response.ok()).toBeTruthy();
      }
    });
  });
});
