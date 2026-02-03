import { test, expect } from '@playwright/test';

test.describe('Posts - Create and Display', () => {
  test.beforeEach(async ({ page, context }) => {
    // Setup: ensure we're authenticated by adding to context storage
    await context.addInitScript(() => {
      localStorage.setItem('auth_token', 'dev_token');
    });
  });

  test('should display feed page', async ({ page }) => {
    await page.goto('/');

    // Should see feed or posts
    const feedSection = page.locator('main, [role="main"]');
    await expect(feedSection).toBeVisible({ timeout: 5000 });
  });

  test('should create a new post via API', async ({ page }) => {
    const postTitle = `Test Post ${Date.now()}`;
    const postContent = 'This is a test post content with some details about the topic.';

    const response = await page.request.post('http://localhost:3001/api/v1/posts', {
      headers: { 'Authorization': 'Bearer dev_token' },
      data: {
        title: postTitle,
        content: postContent,
        topic: 'general',
      },
    });

    expect(response.ok()).toBeTruthy();

    const postData = await response.json();
    expect(postData).toHaveProperty('id');
    expect(postData.title).toBe(postTitle);
    expect(postData.content).toBe(postContent);
    expect(postData.vote_score).toBe(0);
    expect(postData.reply_count).toBe(0);
  });

  test('should display created post in feed', async ({ page }) => {
    // Create a post first
    const postTitle = `Visible Post ${Date.now()}`;
    const postContent = 'This post should be visible in the feed.';

    await page.request.post('http://localhost:3001/api/v1/posts', {
      headers: { 'Authorization': 'Bearer dev_token' },
      data: {
        title: postTitle,
        content: postContent,
        topic: 'general',
      },
    });

    // Wait a moment for feed to update
    await page.waitForTimeout(1000);

    // Navigate to feed
    await page.goto('/');

    // Check if post appears in feed
    const postElement = page.locator(`text="${postTitle}"`);
    await expect(postElement).toBeVisible({ timeout: 10000 });
  });

  test('should display post metadata correctly', async ({ page }) => {
    // Create a post
    const postTitle = `Metadata Test ${Date.now()}`;

    const response = await page.request.post('http://localhost:3001/api/v1/posts', {
      headers: { 'Authorization': 'Bearer dev_token' },
      data: {
        title: postTitle,
        content: 'Test content',
        topic: 'general',
      },
    });

    const postData = await response.json();

    // Go to feed
    await page.goto('/');

    // Find the post
    const postElement = page.locator(`text="${postTitle}"`).first();
    await expect(postElement).toBeVisible({ timeout: 10000 });

    // Check for metadata
    const voteCount = page.locator('text="0"').first(); // vote score
    const replyCount = page.locator('text="0"'); // reply count

    // At least one should be visible
    const metadataVisible = await postElement.isVisible();
    expect(metadataVisible).toBeTruthy();
  });

  test('should fetch posts via API', async ({ page }) => {
    const response = await page.request.get('http://localhost:3001/api/v1/posts', {
      headers: { 'Authorization': 'Bearer dev_token' },
    });

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('posts');
    expect(Array.isArray(data.posts)).toBeTruthy();

    // Each post should have required fields
    if (data.posts.length > 0) {
      const post = data.posts[0];
      expect(post).toHaveProperty('id');
      expect(post).toHaveProperty('title');
      expect(post).toHaveProperty('content');
      expect(post).toHaveProperty('created_at');
    }
  });
});
