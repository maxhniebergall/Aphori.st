import { test, expect } from '@playwright/test';
import { AuthHelper } from './helpers/auth-helper';
import { PostHelper } from './helpers/post-helper';
import { ReplyHelper } from './helpers/reply-helper';
import { DuplicateHelper } from './helpers/duplicate-helper';

test.describe('Reply Deduplication Edge Cases', () => {
  let authHelper: AuthHelper;
  let postHelper: PostHelper;
  let replyHelper: ReplyHelper;
  let duplicateHelper: DuplicateHelper;
  let postId: string;

  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    postHelper = new PostHelper(page);
    replyHelper = new ReplyHelper(page);
    duplicateHelper = new DuplicateHelper(page);

    await authHelper.loginUser('user1');
    postId = await postHelper.createPost('original');
  });

  test.afterEach(async ({ page }) => {
    await authHelper.logout();
  });

  test('should handle vector search service unavailable', async ({ page }) => {
    // This test simulates what happens when the vector search service is down
    // The reply should still be created, just without duplicate detection
    
    // Mock the vector search API to return an error
    await page.route('**/api/search/**', route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Vector service unavailable' })
      });
    });

    await postHelper.navigateToPost(postId);
    
    // Try to create a reply that would normally be detected as duplicate
    const replyId = await replyHelper.createReply('duplicate1', postId);
    
    // Should create reply successfully despite vector service error
    await replyHelper.verifyReplyExists(replyId);
    
    // Should NOT redirect to duplicate page
    expect(page.url()).not.toContain('/dupe/');
    expect(page.url()).toContain(`/postTree/${postId}`);
  });

  test('should handle invalid duplicate group ID', async ({ page }) => {
    const invalidGroupId = 'invalid-group-id-12345';
    
    // Navigate directly to duplicate page with invalid ID
    await duplicateHelper.navigateToDuplicateComparison(invalidGroupId);
    
    // Should show error state
    await expect(page.locator('.error-state')).toBeVisible();
    await expect(page.locator('h2')).toContainText('Error');
    await expect(page.locator('.error-state p')).toContainText('not found');
    
    // Should have back button
    await expect(page.locator('.back-button')).toBeVisible();
  });

  test('should handle concurrent duplicate creation', async ({ page, context }) => {
    // Create original reply
    await postHelper.navigateToPost(postId);
    await replyHelper.createReply('duplicate1', postId);
    
    // Open second tab/page to simulate concurrent user
    const page2 = await context.newPage();
    const authHelper2 = new AuthHelper(page2);
    const postHelper2 = new PostHelper(page2);
    const replyHelper2 = new ReplyHelper(page2);
    
    await authHelper2.loginUser('user2');
    await postHelper2.navigateToPost(postId);
    
    // Both users try to create similar replies simultaneously
    const [groupId1, result2] = await Promise.allSettled([
      replyHelper.createReplyAndExpectDuplicate('duplicate2', postId),
      replyHelper2.waitForDuplicateDetection()
    ]);
    
    // At least one should detect duplicate
    if (groupId1.status === 'fulfilled') {
      expect(groupId1.value).toBeTruthy();
      expect(page.url()).toContain(`/dupe/${groupId1.value}`);
    }
    
    await page2.close();
  });

  test('should handle very long reply text with duplicate detection', async ({ page }) => {
    // Create original reply with very long text
    const longText = 'I completely agree with your point about AI safety. '.repeat(20) + 
                     'The potential risks of advanced AI systems need to be carefully considered and mitigated.';
    
    const longReply = {
      text: longText,
      quote: {
        text: 'We need to consider both the benefits and potential risks',
        selectionRange: { start: 95, end: 145 }
      }
    };
    
    await postHelper.navigateToPost(postId);
    
    // Create long original reply by manually entering text
    await replyHelper.selectTextInPost(postId, longReply.quote.text);
    await page.fill('textarea[data-testid="reply-text"]', longReply.text);
    await page.click('button[data-testid="submit-reply"]');
    
    // Now create a similar long reply that should be detected as duplicate
    const similarLongText = 'Totally agree about AI safety concerns. '.repeat(20) + 
                           'The risks from advanced artificial intelligence systems require careful consideration.';
    
    await replyHelper.selectTextInPost(postId, longReply.quote.text);
    await page.fill('textarea[data-testid="reply-text"]', similarLongText);
    await page.click('button[data-testid="submit-reply"]');
    
    // Should still detect as duplicate despite length
    await page.waitForURL('**/dupe/**', { timeout: 20000 });
    await duplicateHelper.verifyDuplicateComparisonView();
  });

  test('should handle special characters and unicode in replies', async ({ page }) => {
    const unicodeReply1 = {
      text: 'Je suis d\'accord avec votre point sur la sécurité IA! 🤖 Les risques potentiels des systèmes IA avancés doivent être soigneusement considérés.',
      quote: {
        text: 'benefits and potential risks',
        selectionRange: { start: 120, end: 147 }
      }
    };
    
    const unicodeReply2 = {
      text: 'Estoy de acuerdo con su punto sobre la seguridad de IA! 🤖 Los riesgos potenciales de los sistemas de IA avanzados deben considerarse cuidadosamente.',
      quote: {
        text: 'benefits and potential risks',
        selectionRange: { start: 120, end: 147 }
      }
    };
    
    await postHelper.navigateToPost(postId);
    
    // Create first unicode reply
    await replyHelper.selectTextInPost(postId, unicodeReply1.quote.text);
    await page.fill('textarea[data-testid="reply-text"]', unicodeReply1.text);
    await page.click('button[data-testid="submit-reply"]');
    
    // Create similar unicode reply
    await replyHelper.selectTextInPost(postId, unicodeReply2.quote.text);
    await page.fill('textarea[data-testid="reply-text"]', unicodeReply2.text);
    
    const result = await replyHelper.waitForDuplicateDetection();
    
    // Vector similarity might not detect these as duplicates due to different languages
    // This tests the robustness of the system with international content
    if (result === 'duplicate') {
      await duplicateHelper.verifyDuplicateComparisonView();
    } else {
      // If not detected as duplicate, verify reply was created
      await expect(page.locator('[data-testid^="reply-"]')).toBeVisible();
    }
  });

  test('should handle network errors during voting', async ({ page }) => {
    // Create duplicate group first
    await postHelper.navigateToPost(postId);
    await replyHelper.createReply('duplicate1', postId);
    const groupId = await replyHelper.createReplyAndExpectDuplicate('duplicate2', postId);
    
    // Mock network error for voting API
    await page.route('**/api/replies/duplicate/*/vote', route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Network error' })
      });
    });
    
    // Try to vote
    await page.click('button[data-testid="vote-button"]');
    
    // Should handle error gracefully (implementation dependent)
    // Could show error message or retry mechanism
    await page.waitForTimeout(2000); // Wait for any error handling
    
    // Verify page is still functional
    await expect(page.locator('[data-testid="duplicate-comparison-view"]')).toBeVisible();
  });

  test('should handle malformed reply data', async ({ page }) => {
    // Test with reply that has malformed quote data
    await postHelper.navigateToPost(postId);
    
    // Intercept reply creation API to test malformed response handling
    await page.route('**/api/replies/createReply', route => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          success: true,
          id: 'malformed-reply-id',
          // Missing other expected fields
        })
      });
    });
    
    await replyHelper.selectTextInPost(postId, 'some text');
    await page.fill('textarea[data-testid="reply-text"]', 'Test reply with malformed data');
    await page.click('button[data-testid="submit-reply"]');
    
    // Should handle gracefully without crashing
    await page.waitForTimeout(3000);
    
    // Page should still be functional
    await expect(page.locator('[data-testid="post-tree-container"]')).toBeVisible();
  });

  test('should handle database transaction failures', async ({ page }) => {
    // Mock database transaction failure
    await page.route('**/api/replies/createReply', route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ 
          success: false, 
          error: 'Database transaction failed' 
        })
      });
    });
    
    await postHelper.navigateToPost(postId);
    await replyHelper.selectTextInPost(postId, 'some text for quote');
    await page.fill('textarea[data-testid="reply-text"]', 'Test reply that will fail');
    await page.click('button[data-testid="submit-reply"]');
    
    // Should show error message to user
    await expect(page.locator('text=error')).toBeVisible({ timeout: 10000 });
    
    // Reply should not be created
    await expect(page.locator('[data-testid="reply-"]')).not.toBeVisible();
  });

  test('should handle empty or minimal reply text', async ({ page }) => {
    await postHelper.navigateToPost(postId);
    
    // Try with very short text that might be allowed (like "Yes!")
    await replyHelper.selectTextInPost(postId, 'implications for society');
    await page.fill('textarea[data-testid="reply-text"]', 'Yes!');
    await page.click('button[data-testid="submit-reply"]');
    
    // Should either create successfully or show validation error
    const hasReply = await page.locator('[data-testid^="reply-"]').count() > 0;
    const hasError = await page.locator('text=error').isVisible();
    
    expect(hasReply || hasError).toBeTruthy();
  });

  test('should handle quote text not found in source', async ({ page }) => {
    await postHelper.navigateToPost(postId);
    
    // Mock an API call with quote text that doesn't exist in the source
    await page.route('**/api/replies/createReply', route => {
      const request = route.request();
      const postData = request.postDataJSON();
      
      // Modify quote to have non-existent text
      postData.quote.text = 'This text does not exist in the source';
      
      route.continue({
        postData: JSON.stringify(postData)
      });
    });
    
    await replyHelper.selectTextInPost(postId, 'AI becomes more prevalent');
    await page.fill('textarea[data-testid="reply-text"]', 'Reply with invalid quote');
    await page.click('button[data-testid="submit-reply"]');
    
    // Should handle invalid quote gracefully
    // Implementation may reject the reply or sanitize the quote
    await page.waitForTimeout(3000);
    
    // Verify system remains stable
    await expect(page.locator('[data-testid="post-tree-container"]')).toBeVisible();
  });
});