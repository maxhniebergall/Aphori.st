import { Page, expect } from '@playwright/test';
import { testReplies } from '../fixtures/test-data';

export class ReplyHelper {
  constructor(private page: Page) {}

  async createReply(replyKey: keyof typeof testReplies, parentId: string, parentType: 'post' | 'reply' = 'post'): Promise<string> {
    const replyData = testReplies[replyKey];
    
    // First, select the text to quote
    if (parentType === 'post') {
      await this.selectTextInPost(parentId, replyData.quote.text);
    } else {
      await this.selectTextInReply(parentId, replyData.quote.text);
    }
    
    // Wait for reply editor to appear after text selection
    await this.page.waitForSelector('[data-testid="reply-editor"]', { timeout: 5000 });
    
    // Fill in reply text
    await this.page.fill('textarea[data-testid="reply-text"]', replyData.text);
    
    // Verify quote is populated
    const quoteText = await this.page.textContent('[data-testid="quoted-text"]');
    expect(quoteText).toContain(replyData.quote.text);
    
    // Submit the reply
    await this.page.click('button[data-testid="submit-reply"]');
    
    // Wait for reply to be created and return its ID
    // This might need to be adjusted based on how reply IDs are exposed in the UI
    await this.page.waitForSelector('[data-testid^="reply-"]', { timeout: 10000 });
    
    // Get the newest reply ID from the DOM
    const replyElements = await this.page.locator('[data-testid^="reply-"]').all();
    const lastReply = replyElements[replyElements.length - 1];
    const replyId = await lastReply.getAttribute('data-testid');
    
    expect(replyId).toBeTruthy();
    return replyId!.replace('reply-', '');
  }
  
  async createReplyAndExpectDuplicate(replyKey: keyof typeof testReplies, parentId: string): Promise<string> {
    const replyData = testReplies[replyKey];
    
    // Select text and start reply process
    await this.selectTextInPost(parentId, replyData.quote.text);
    await this.page.waitForSelector('[data-testid="reply-editor"]');
    
    // Fill in reply text
    await this.page.fill('textarea[data-testid="reply-text"]', replyData.text);
    
    // Submit the reply
    await this.page.click('button[data-testid="submit-reply"]');
    
    // Wait for duplicate detection to trigger (should redirect to /dupe/:groupId)
    await this.page.waitForURL('**/dupe/**', { timeout: 15000 });
    
    // Extract the duplicate group ID from URL
    const url = this.page.url();
    const groupId = url.split('/dupe/')[1];
    
    expect(groupId).toBeTruthy();
    return groupId;
  }
  
  private async selectTextInPost(postId: string, text: string) {
    const postElement = this.page.locator(`[data-testid="post-${postId}"]`);
    const textElement = postElement.locator(`text="${text}"`).first();
    await textElement.waitFor();
    
    // Use the text selection functionality
    await textElement.click({ clickCount: 3 });
  }
  
  private async selectTextInReply(replyId: string, text: string) {
    const replyElement = this.page.locator(`[data-testid="reply-${replyId}"]`);
    const textElement = replyElement.locator(`text="${text}"`).first();
    await textElement.waitFor();
    
    await textElement.click({ clickCount: 3 });
  }
  
  async verifyReplyExists(replyId: string) {
    await expect(this.page.locator(`[data-testid="reply-${replyId}"]`)).toBeVisible();
  }
  
  async getReplyContent(replyId: string): Promise<string> {
    const replyElement = this.page.locator(`[data-testid="reply-${replyId}"]`);
    return await replyElement.textContent() || '';
  }
  
  async waitForReplyEditor() {
    await this.page.waitForSelector('[data-testid="reply-editor"]', { timeout: 10000 });
  }
  
  async waitForDuplicateDetection() {
    // Wait for either reply creation or duplicate detection
    return await Promise.race([
      this.page.waitForURL('**/dupe/**').then(() => 'duplicate'),
      this.page.waitForSelector('[data-testid^="reply-"]', { timeout: 15000 }).then(() => 'created')
    ]);
  }
}