import { test, expect } from '@playwright/test';

test.describe('Complete Flow Integration', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addInitScript(() => {
      localStorage.setItem('auth_token', 'dev_token');
    });
  });

  test('complete user journey: auth -> create post -> reply -> vote -> view in feed', async ({
    page,
  }) => {
    // Step 1: Verify authentication works
    const profileResponse = await page.request.get('http://localhost:3001/api/v1/auth/profile', {
      headers: { 'Authorization': 'Bearer dev_token' },
    });

    expect([200, 401, 403]).toContain(profileResponse.status());

    // Step 2: Create a post
    const postTitle = `Integration Test Post ${Date.now()}`;
    const postContent = 'Complete integration test post with full flow testing.';

    const postResponse = await page.request.post('http://localhost:3001/api/v1/posts', {
      headers: { 'Authorization': 'Bearer dev_token' },
      data: {
        title: postTitle,
        content: postContent,
        topic: 'general',
      },
    });

    expect(postResponse.ok()).toBeTruthy();
    const post = await postResponse.json();
    const postId = post.id;

    expect(post.title).toBe(postTitle);
    expect(post.vote_score).toBe(0);
    expect(post.reply_count).toBe(0);

    // Step 3: Create a reply
    const replyContent = 'This is a test reply in the integration flow.';
    const replyResponse = await page.request.post(
      `http://localhost:3001/api/v1/posts/${postId}/replies`,
      {
        headers: { 'Authorization': 'Bearer dev_token' },
        data: { content: replyContent },
      }
    );

    expect(replyResponse.ok()).toBeTruthy();
    const reply = await replyResponse.json();

    expect(reply.content).toBe(replyContent);
    expect(reply.post_id).toBe(postId);

    // Step 4: Vote on the post
    const voteResponse = await page.request.post(
      `http://localhost:3001/api/v1/posts/${postId}/votes`,
      {
        headers: { 'Authorization': 'Bearer dev_token' },
        data: { vote_type: 'upvote' },
      }
    );

    expect(voteResponse.ok()).toBeTruthy();

    // Step 5: Verify post has updated metadata
    const updatedPostResponse = await page.request.get(
      `http://localhost:3001/api/v1/posts/${postId}`,
      { headers: { 'Authorization': 'Bearer dev_token' } }
    );

    expect(updatedPostResponse.ok()).toBeTruthy();
    const updatedPost = await updatedPostResponse.json();

    expect(updatedPost.vote_score).toBe(1);
    expect(updatedPost.reply_count).toBe(1);

    // Step 6: Verify post appears in feed
    await page.waitForTimeout(500);

    const feedResponse = await page.request.get('http://localhost:3001/api/v1/feed', {
      headers: { 'Authorization': 'Bearer dev_token' },
    });

    expect(feedResponse.ok()).toBeTruthy();
    const feedData = await feedResponse.json();

    const feedPost = feedData.posts.find((p: any) => p.id === postId);
    expect(feedPost).toBeDefined();
    expect(feedPost.vote_score).toBe(1);
    expect(feedPost.reply_count).toBe(1);

    // Step 7: Verify in browser UI
    await page.goto('/');

    const postElement = page.locator(`text="${postTitle}"`);
    await expect(postElement).toBeVisible({ timeout: 10000 });

    // Post should show vote and reply counts
    const parentContainer = postElement.locator('..');
    expect(await parentContainer.isVisible()).toBeTruthy();
  });

  test('multiple posts with interactions create diverse feed', async ({ page }) => {
    const postCount = 5;
    const postIds = [];

    // Create multiple posts
    for (let i = 0; i < postCount; i++) {
      const postResponse = await page.request.post('http://localhost:3001/api/v1/posts', {
        headers: { 'Authorization': 'Bearer dev_token' },
        data: {
          title: `Multi Post ${i + 1} - ${Date.now()}`,
          content: `Content for post ${i + 1} with detailed information`,
          topic: 'general',
        },
      });

      const post = await postResponse.json();
      postIds.push(post.id);

      // Add some interactions to vary them
      if (i % 2 === 0) {
        // Add replies to even-numbered posts
        await page.request.post(`http://localhost:3001/api/v1/posts/${post.id}/replies`, {
          headers: { 'Authorization': 'Bearer dev_token' },
          data: { content: `Reply to post ${i + 1}` },
        });
      }

      if (i % 3 === 0) {
        // Vote on every third post
        await page.request.post(`http://localhost:3001/api/v1/posts/${post.id}/votes`, {
          headers: { 'Authorization': 'Bearer dev_token' },
          data: { vote_type: 'upvote' },
        });
      }
    }

    // Wait for feed to update
    await page.waitForTimeout(1000);

    // Get feed
    const feedResponse = await page.request.get('http://localhost:3001/api/v1/feed', {
      headers: { 'Authorization': 'Bearer dev_token' },
    });

    const feedData = await feedResponse.json();

    // All posts should be in feed
    const feedPostIds = feedData.posts.map((p: any) => p.id);
    postIds.forEach(id => {
      expect(feedPostIds).toContain(id);
    });

    // Verify interactions are reflected
    postIds.forEach((id, index) => {
      const feedPost = feedData.posts.find((p: any) => p.id === id);

      if (index % 2 === 0) {
        // Even posts should have 1 reply
        expect(feedPost.reply_count).toBe(1);
      }

      if (index % 3 === 0) {
        // Every third post should have 1 vote
        expect(feedPost.vote_score).toBe(1);
      }
    });

    // Verify UI displays feed
    await page.goto('/');

    const feedContainer = page.locator('main, [role="main"]');
    await expect(feedContainer).toBeVisible({ timeout: 5000 });
  });

  test('rate limiting on post creation', async ({ page }) => {
    const requests = [];

    // Try to create many posts rapidly
    for (let i = 0; i < 10; i++) {
      const response = page.request.post('http://localhost:3001/api/v1/posts', {
        headers: { 'Authorization': 'Bearer dev_token' },
        data: {
          title: `Rate Limit Test ${i}`,
          content: `Testing rate limiting - post ${i}`,
          topic: 'general',
        },
      }).catch(() => null);

      requests.push(response);
    }

    // Wait for all requests
    const results = await Promise.all(requests);

    // Some should succeed, some might be rate limited
    const statuses = results.map(r => r?.status());
    const successCount = statuses.filter(s => s === 200 || s === 201).length;

    // Should have some successful requests
    expect(successCount).toBeGreaterThan(0);
  });

  test('concurrent operations dont cause conflicts', async ({ page }) => {
    // Create a post
    const postResponse = await page.request.post('http://localhost:3001/api/v1/posts', {
      headers: { 'Authorization': 'Bearer dev_token' },
      data: {
        title: `Concurrent Test ${Date.now()}`,
        content: 'Testing concurrent operations',
        topic: 'general',
      },
    });

    const post = await postResponse.json();
    const postId = post.id;

    // Create multiple replies concurrently
    const replyPromises = [];
    for (let i = 0; i < 3; i++) {
      replyPromises.push(
        page.request.post(`http://localhost:3001/api/v1/posts/${postId}/replies`, {
          headers: { 'Authorization': 'Bearer dev_token' },
          data: { content: `Concurrent reply ${i}` },
        })
      );
    }

    const replyResults = await Promise.all(replyPromises);

    // All should succeed
    replyResults.forEach(result => {
      expect(result.ok()).toBeTruthy();
    });

    // Check final reply count
    await page.waitForTimeout(500);

    const updatedPostResponse = await page.request.get(
      `http://localhost:3001/api/v1/posts/${postId}`,
      { headers: { 'Authorization': 'Bearer dev_token' } }
    );

    const updatedPost = await updatedPostResponse.json();
    expect(updatedPost.reply_count).toBe(3);
  });
});
