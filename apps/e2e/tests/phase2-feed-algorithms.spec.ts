import { test, expect } from '@playwright/test';

/**
 * Phase 2 Tests: Feed Sorting Algorithms
 * Tests for rising and controversial feed algorithms
 */

test.describe('Feed Sorting Algorithms', () => {
  test.describe('Rising Algorithm', () => {
    test('should fetch feed with rising sort', async ({ request }) => {
      const response = await request.get('http://localhost:3001/api/v1/feed?sort=rising', {
        headers: { 'Authorization': 'Bearer dev_token' },
      });

      expect(response.ok()).toBeTruthy();
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty('items');
      expect(Array.isArray(json.data.items)).toBeTruthy();
    });

    test('rising sort should return recent posts', async ({ request }) => {
      // Create a fresh post
      const createResponse = await request.post('http://localhost:3001/api/v1/posts', {
        headers: { 'Authorization': 'Bearer dev_token' },
        data: {
          title: `Rising Test Post ${Date.now()}`,
          content: 'Testing rising algorithm',
        },
      });

      // Skip if rate limited
      if (createResponse.status() === 429) {
        test.skip();
        return;
      }

      expect(createResponse.ok()).toBeTruthy();
      const createJson = await createResponse.json();
      const postId = createJson.data?.id;
      expect(postId).toBeDefined();

      // Vote on it to give it some activity
      await request.post('http://localhost:3001/api/v1/votes', {
        headers: { 'Authorization': 'Bearer dev_token' },
        data: {
          target_type: 'post',
          target_id: postId,
          value: 1,
        },
      });

      // Fetch rising feed
      const feedResponse = await request.get('http://localhost:3001/api/v1/feed?sort=rising', {
        headers: { 'Authorization': 'Bearer dev_token' },
      });

      expect(feedResponse.ok()).toBeTruthy();
      const feedJson = await feedResponse.json();

      // Post should be in the rising feed (recent with activity)
      const foundPost = feedJson.data.items.find((p: any) => p.id === postId);
      expect(foundPost).toBeDefined();
    });

    test('rising feed should respect limit parameter', async ({ request }) => {
      const response = await request.get('http://localhost:3001/api/v1/feed?sort=rising&limit=5', {
        headers: { 'Authorization': 'Bearer dev_token' },
      });

      expect(response.ok()).toBeTruthy();
      const json = await response.json();
      expect(json.data.items.length).toBeLessThanOrEqual(5);
    });
  });

  test.describe('Controversial Algorithm', () => {
    test('should fetch feed with controversial sort', async ({ request }) => {
      const response = await request.get('http://localhost:3001/api/v1/feed?sort=controversial', {
        headers: { 'Authorization': 'Bearer dev_token' },
      });

      expect(response.ok()).toBeTruthy();
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty('items');
      expect(Array.isArray(json.data.items)).toBeTruthy();
    });

    test('controversial feed should respect limit parameter', async ({ request }) => {
      const response = await request.get('http://localhost:3001/api/v1/feed?sort=controversial&limit=5', {
        headers: { 'Authorization': 'Bearer dev_token' },
      });

      expect(response.ok()).toBeTruthy();
      const json = await response.json();
      expect(json.data.items.length).toBeLessThanOrEqual(5);
    });
  });

  test.describe('All Sort Options', () => {
    const sortOptions = ['hot', 'new', 'top', 'rising', 'controversial'];

    for (const sort of sortOptions) {
      test(`should support ${sort} sort option`, async ({ request }) => {
        const response = await request.get(`http://localhost:3001/api/v1/feed?sort=${sort}`, {
          headers: { 'Authorization': 'Bearer dev_token' },
        });

        expect(response.ok()).toBeTruthy();
        const json = await response.json();
        expect(json.success).toBe(true);
        expect(json.data).toHaveProperty('items');
      });
    }

    test('should reject invalid sort option', async ({ request }) => {
      const response = await request.get('http://localhost:3001/api/v1/feed?sort=invalid', {
        headers: { 'Authorization': 'Bearer dev_token' },
      });

      expect(response.status()).toBe(400);
      const json = await response.json();
      expect(json).toHaveProperty('error');
    });

    test('should default to hot sort when no sort specified', async ({ request }) => {
      const response = await request.get('http://localhost:3001/api/v1/feed', {
        headers: { 'Authorization': 'Bearer dev_token' },
      });

      expect(response.ok()).toBeTruthy();
      // Should return successfully with default hot sort
      const json = await response.json();
      expect(json.success).toBe(true);
    });
  });

  test.describe('Cursor-based Pagination', () => {
    test('should support cursor parameter', async ({ request }) => {
      // Get first page
      const firstResponse = await request.get('http://localhost:3001/api/v1/feed?limit=5', {
        headers: { 'Authorization': 'Bearer dev_token' },
      });

      expect(firstResponse.ok()).toBeTruthy();
      const firstJson = await firstResponse.json();

      // If there's a next cursor, use it
      if (firstJson.data.cursor) {
        const secondResponse = await request.get(
          `http://localhost:3001/api/v1/feed?limit=5&cursor=${firstJson.data.cursor}`,
          { headers: { 'Authorization': 'Bearer dev_token' } }
        );

        expect(secondResponse.ok()).toBeTruthy();
        const secondJson = await secondResponse.json();
        expect(secondJson.success).toBe(true);

        // Items should be different
        if (secondJson.data.items.length > 0 && firstJson.data.items.length > 0) {
          const firstIds = firstJson.data.items.map((p: any) => p.id);
          const secondIds = secondJson.data.items.map((p: any) => p.id);
          const overlap = secondIds.filter((id: string) => firstIds.includes(id));
          expect(overlap.length).toBe(0);
        }
      }
    });
  });
});
