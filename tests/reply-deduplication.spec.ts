import { test, expect } from '@playwright/test';
import { AuthHelper } from './helpers/auth-helper';
import { PostHelper } from './helpers/post-helper';
import { ReplyHelper } from './helpers/reply-helper';
import { DuplicateHelper } from './helpers/duplicate-helper';
import { testUsers, testReplies, duplicateThreshold } from './fixtures/test-data';

test.describe('Reply Deduplication', () => {
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

    // Login as user1 and create a test post
    await authHelper.loginUser('user1');
    postId = await postHelper.createPost('original');
  });

  test.afterEach(async ({ page }) => {
    await authHelper.logout();
  });

  test('should detect and handle duplicate replies', async ({ page }) => {
    // First, create an original reply
    await postHelper.navigateToPost(postId);
    const originalReplyId = await replyHelper.createReply('duplicate1', postId);
    
    // Verify the original reply was created successfully
    await replyHelper.verifyReplyExists(originalReplyId);

    // Now create a duplicate reply - this should trigger duplicate detection
    const duplicateGroupId = await replyHelper.createReplyAndExpectDuplicate('duplicate2', postId);
    
    // Verify we're redirected to the duplicate comparison page
    expect(page.url()).toContain(`/dupe/${duplicateGroupId}`);
    
    // Verify the duplicate comparison UI is displayed
    await duplicateHelper.verifyDuplicateComparisonView();
  });

  test('should display duplicate comparison UI correctly', async ({ page }) => {
    // Create original reply
    await postHelper.navigateToPost(postId);
    await replyHelper.createReply('duplicate1', postId);
    
    // Create duplicate reply
    const duplicateGroupId = await replyHelper.createReplyAndExpectDuplicate('duplicate2', postId);
    
    // Verify all UI components are present and correct
    await duplicateHelper.verifyOriginalReplyCard();
    await duplicateHelper.verifyDuplicateReplyCards(1);
    await duplicateHelper.verifyGroupInformation();
    
    // Verify similarity score is within expected range
    await duplicateHelper.verifySimilarityScore(0, duplicateThreshold);
    
    // Verify voting panel elements
    await duplicateHelper.verifyVotingPanelElements(0);
  });

  test('should handle multiple duplicate replies in one group', async ({ page }) => {
    // Create original reply
    await postHelper.navigateToPost(postId);
    await replyHelper.createReply('duplicate1', postId);
    
    // Create first duplicate
    const duplicateGroupId = await replyHelper.createReplyAndExpectDuplicate('duplicate2', postId);
    
    // Navigate back to post to create another duplicate
    await duplicateHelper.clickBackToDiscussion();
    
    // Login as different user to create another duplicate
    await authHelper.logout();
    await authHelper.loginUser('user2');
    await postHelper.navigateToPost(postId);
    
    // Create second duplicate - should be added to existing group
    const secondDuplicateGroupId = await replyHelper.createReplyAndExpectDuplicate('duplicate3', postId);
    
    // Should be the same group ID
    expect(secondDuplicateGroupId).toBe(duplicateGroupId);
    
    // Verify UI shows both duplicates
    await duplicateHelper.verifyDuplicateReplyCards(2);
    
    // Verify group information reflects multiple duplicates
    await duplicateHelper.verifyDuplicateGroupData({
      groupId: duplicateGroupId,
      originalReplyText: testReplies.duplicate1.text,
      duplicateCount: 2,
      similarityThreshold: duplicateThreshold
    });
  });

  test('should not detect unique replies as duplicates', async ({ page }) => {
    // Create original reply
    await postHelper.navigateToPost(postId);
    await replyHelper.createReply('duplicate1', postId);
    
    // Create a unique reply - should NOT trigger duplicate detection
    const uniqueReplyId = await replyHelper.createReply('unique1', postId);
    
    // Should remain on the post tree page, not redirect to duplicate view
    expect(page.url()).not.toContain('/dupe/');
    expect(page.url()).toContain(`/postTree/${postId}`);
    
    // Verify the unique reply was created successfully
    await replyHelper.verifyReplyExists(uniqueReplyId);
  });

  test('should allow voting on duplicate replies', async ({ page }) => {
    // Create original and duplicate replies
    await postHelper.navigateToPost(postId);
    await replyHelper.createReply('duplicate1', postId);
    const duplicateGroupId = await replyHelper.createReplyAndExpectDuplicate('duplicate2', postId);
    
    // Test voting functionality
    const initialVoteCount = await duplicateHelper.getVoteCount(0);
    const initialScore = await duplicateHelper.getTotalScore(0);
    
    // Vote for the first duplicate reply
    await duplicateHelper.voteForReply(0);
    
    // Verify vote was recorded
    const newVoteCount = await duplicateHelper.getVoteCount(0);
    const newScore = await duplicateHelper.getTotalScore(0);
    
    expect(newVoteCount).toBeGreaterThan(initialVoteCount);
    expect(newScore).toBeGreaterThanOrEqual(initialScore); // Score could increase or stay same depending on vote type
  });

  test('should navigate back to discussion from duplicate view', async ({ page }) => {
    // Create original and duplicate replies
    await postHelper.navigateToPost(postId);
    await replyHelper.createReply('duplicate1', postId);
    await replyHelper.createReplyAndExpectDuplicate('duplicate2', postId);
    
    // Click back to discussion button
    await duplicateHelper.clickBackToDiscussion();
    
    // Verify we're back on the post tree page
    expect(page.url()).toContain(`/postTree/${postId}`);
    await postHelper.verifyPostExists(postId);
  });

  test('should handle vector similarity threshold correctly', async ({ page }) => {
    // This test verifies the similarity threshold (0.08) is working correctly
    
    // Create original reply
    await postHelper.navigateToPost(postId);
    await replyHelper.createReply('duplicate1', postId);
    
    // Create a highly similar reply (should trigger duplicate detection)
    const duplicateGroupId = await replyHelper.createReplyAndExpectDuplicate('duplicate2', postId);
    
    // Verify similarity score is above threshold
    await duplicateHelper.verifySimilarityScore(0, duplicateThreshold);
    
    // Navigate back and try with a unique reply
    await duplicateHelper.clickBackToDiscussion();
    
    // Create a dissimilar reply (should NOT trigger duplicate detection)
    await replyHelper.createReply('unique2', postId);
    
    // Should remain on post tree, not redirect to duplicate view
    expect(page.url()).not.toContain('/dupe/');
  });

  test('should preserve quote information in duplicate comparison', async ({ page }) => {
    // Create original and duplicate replies
    await postHelper.navigateToPost(postId);
    await replyHelper.createReply('duplicate1', postId);
    const duplicateGroupId = await replyHelper.createReplyAndExpectDuplicate('duplicate2', postId);
    
    // Verify both original and duplicate show correct quoted text
    const originalQuote = await page.locator('.original-reply .quoted-text blockquote').textContent();
    const duplicateQuote = await page.locator('.duplicate-reply .quoted-text blockquote').textContent();
    
    expect(originalQuote).toContain(testReplies.duplicate1.quote.text);
    expect(duplicateQuote).toContain(testReplies.duplicate2.quote.text);
    
    // Both should be the same quote in this test case
    expect(originalQuote).toBe(duplicateQuote);
  });

  test('should display author and timestamp information', async ({ page }) => {
    // Create original and duplicate replies with different users
    await postHelper.navigateToPost(postId);
    await replyHelper.createReply('duplicate1', postId);
    
    // Switch to different user for duplicate
    await authHelper.logout();
    await authHelper.loginUser('user2');
    await postHelper.navigateToPost(postId);
    
    const duplicateGroupId = await replyHelper.createReplyAndExpectDuplicate('duplicate2', postId);
    
    // Verify author information is displayed
    const originalAuthor = await page.locator('.original-reply .author').textContent();
    const duplicateAuthor = await page.locator('.duplicate-reply .author').textContent();
    
    expect(originalAuthor).toContain(testUsers.user1.userId);
    expect(duplicateAuthor).toContain(testUsers.user2.userId);
    
    // Verify timestamps are displayed
    await expect(page.locator('.original-reply .date')).toBeVisible();
    await expect(page.locator('.duplicate-reply .date')).toBeVisible();
  });

  test('should handle edge case: very similar but not identical text', async ({ page }) => {
    // This test ensures the vector similarity is working correctly for near-duplicates
    
    await postHelper.navigateToPost(postId);
    await replyHelper.createReply('duplicate1', postId);
    
    // Create a reply with slight variations that should still be detected as duplicate
    const duplicateGroupId = await replyHelper.createReplyAndExpectDuplicate('duplicate3', postId);
    
    // Verify duplicate was detected despite text variations
    expect(page.url()).toContain(`/dupe/${duplicateGroupId}`);
    await duplicateHelper.verifyDuplicateComparisonView();
    
    // Verify similarity score reflects the slight differences
    await duplicateHelper.verifySimilarityScore(0, duplicateThreshold);
  });
});