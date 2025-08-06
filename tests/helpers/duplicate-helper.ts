import { Page, expect } from '@playwright/test';

export class DuplicateHelper {
  constructor(private page: Page) {}

  async navigateToDuplicateComparison(groupId: string) {
    await this.page.goto(`/dupe/${groupId}`);
    await this.page.waitForSelector('[data-testid="duplicate-comparison-view"]', { timeout: 10000 });
  }
  
  async verifyDuplicateComparisonView() {
    // Check that the duplicate comparison UI is loaded
    await expect(this.page.locator('[data-testid="duplicate-comparison-view"]')).toBeVisible();
    
    // Verify header
    await expect(this.page.locator('h1')).toContainText('Duplicate Replies Found');
    
    // Verify description
    await expect(this.page.locator('.duplicate-description')).toContainText('similar');
    
    // Verify back button
    await expect(this.page.locator('.back-to-post-button')).toBeVisible();
  }
  
  async verifyOriginalReplyCard() {
    const originalCard = this.page.locator('.original-reply');
    await expect(originalCard).toBeVisible();
    
    // Check header
    await expect(originalCard.locator('h3')).toContainText('Original Reply');
    
    // Check meta information
    await expect(originalCard.locator('.author')).toBeVisible();
    await expect(originalCard.locator('.date')).toBeVisible();
    
    // Check quoted text section
    await expect(originalCard.locator('.quoted-text blockquote')).toBeVisible();
    
    // Check reply text section
    await expect(originalCard.locator('.reply-text p')).toBeVisible();
  }
  
  async verifyDuplicateReplyCards(expectedCount: number) {
    const duplicateCards = this.page.locator('.duplicate-reply');
    await expect(duplicateCards).toHaveCount(expectedCount);
    
    for (let i = 0; i < expectedCount; i++) {
      const card = duplicateCards.nth(i);
      
      // Check header
      await expect(card.locator('h3')).toContainText(`Duplicate Reply #${i + 1}`);
      
      // Check meta information including similarity score
      await expect(card.locator('.author')).toBeVisible();
      await expect(card.locator('.date')).toBeVisible();
      await expect(card.locator('.similarity')).toContainText('similar');
      
      // Check content sections
      await expect(card.locator('.quoted-text blockquote')).toBeVisible();
      await expect(card.locator('.reply-text p')).toBeVisible();
      
      // Check voting panel
      await expect(card.locator('[data-testid="duplicate-voting-panel"]')).toBeVisible();
    }
  }
  
  async verifyGroupInformation() {
    const groupInfo = this.page.locator('.group-info');
    await expect(groupInfo).toBeVisible();
    
    await expect(groupInfo.locator('h3')).toContainText('Group Information');
    
    // Check group details
    await expect(groupInfo.locator('text=Group ID:')).toBeVisible();
    await expect(groupInfo.locator('text=Created:')).toBeVisible();
    await expect(groupInfo.locator('text=Similarity Threshold:')).toBeVisible();
    await expect(groupInfo.locator('text=Total Duplicates:')).toBeVisible();
    await expect(groupInfo.locator('text=Parent Connections:')).toBeVisible();
  }
  
  async verifySimilarityScore(replyIndex: number, expectedThreshold: number) {
    const duplicateCard = this.page.locator('.duplicate-reply').nth(replyIndex);
    const similarityText = await duplicateCard.locator('.similarity').textContent();
    
    expect(similarityText).toBeTruthy();
    
    // Extract percentage from text like "85.5% similar"
    const percentageMatch = similarityText!.match(/(\d+\.?\d*)%/);
    expect(percentageMatch).toBeTruthy();
    
    const similarityPercentage = parseFloat(percentageMatch![1]);
    
    // The similarity should be above the threshold
    // Note: The UI shows similarity as percentage, but the backend uses distance
    // where lower distance = higher similarity
    expect(similarityPercentage).toBeGreaterThan((1 - expectedThreshold) * 100);
  }
  
  async voteForReply(replyIndex: number) {
    const duplicateCard = this.page.locator('.duplicate-reply').nth(replyIndex);
    const voteButton = duplicateCard.locator('button[data-testid="vote-button"]');
    
    // Get current vote count
    const voteCountBefore = await this.getVoteCount(replyIndex);
    
    // Click vote button
    await voteButton.click();
    
    // Wait for the vote to be processed (page should refresh with updated counts)
    await this.page.waitForLoadState('networkidle');
    
    // Verify vote count increased
    const voteCountAfter = await this.getVoteCount(replyIndex);
    expect(voteCountAfter).toBeGreaterThan(voteCountBefore);
  }
  
  async getVoteCount(replyIndex: number): Promise<number> {
    const duplicateCard = this.page.locator('.duplicate-reply').nth(replyIndex);
    const votingPanel = duplicateCard.locator('[data-testid="duplicate-voting-panel"]');
    
    // Get upvotes count
    const upvotesText = await votingPanel.locator('.upvotes').textContent();
    const upvotesMatch = upvotesText?.match(/(\d+)/);
    const upvotes = upvotesMatch ? parseInt(upvotesMatch[1]) : 0;
    
    // Get downvotes count  
    const downvotesText = await votingPanel.locator('.downvotes').textContent();
    const downvotesMatch = downvotesText?.match(/(\d+)/);
    const downvotes = downvotesMatch ? parseInt(downvotesMatch[1]) : 0;
    
    return upvotes + downvotes;
  }
  
  async getTotalScore(replyIndex: number): Promise<number> {
    const duplicateCard = this.page.locator('.duplicate-reply').nth(replyIndex);
    const scoreText = await duplicateCard.locator('.total-score').textContent();
    
    const scoreMatch = scoreText?.match(/Score: (-?\d+)/);
    return scoreMatch ? parseInt(scoreMatch[1]) : 0;
  }
  
  async verifyVotingPanelElements(replyIndex: number) {
    const duplicateCard = this.page.locator('.duplicate-reply').nth(replyIndex);
    const votingPanel = duplicateCard.locator('[data-testid="duplicate-voting-panel"]');
    
    // Check voting header
    await expect(votingPanel.locator('h4')).toContainText('Community Preference');
    await expect(votingPanel.locator('.total-score')).toBeVisible();
    
    // Check vote stats
    await expect(votingPanel.locator('.vote-bar')).toBeVisible();
    await expect(votingPanel.locator('.upvotes')).toBeVisible();
    await expect(votingPanel.locator('.downvotes')).toBeVisible();
    
    // Check vote button
    await expect(votingPanel.locator('button[data-testid="vote-button"]')).toBeVisible();
    await expect(votingPanel.locator('button[data-testid="vote-button"]')).toContainText('Vote for This Reply');
  }
  
  async clickBackToDiscussion() {
    await this.page.click('.back-to-post-button');
    await this.page.waitForURL('**/postTree/**');
  }
  
  async verifyDuplicateGroupData(expectedData: {
    groupId: string;
    originalReplyText: string;
    duplicateCount: number;
    similarityThreshold: number;
  }) {
    // Verify URL contains group ID
    expect(this.page.url()).toContain(`/dupe/${expectedData.groupId}`);
    
    // Verify original reply text
    const originalReplyText = await this.page.locator('.original-reply .reply-text p').textContent();
    expect(originalReplyText).toContain(expectedData.originalReplyText);
    
    // Verify duplicate count
    const duplicateCards = this.page.locator('.duplicate-reply');
    await expect(duplicateCards).toHaveCount(expectedData.duplicateCount);
    
    // Verify similarity threshold in group info
    const thresholdText = await this.page.locator('.group-info text=Similarity Threshold:').locator('..').textContent();
    expect(thresholdText).toContain(`${(expectedData.similarityThreshold * 100).toFixed(1)}%`);
  }
}