import { Page, expect } from '@playwright/test';
import { testPosts, apiEndpoints } from '../fixtures/test-data';

export class PostHelper {
  constructor(private page: Page) {}

  async createPost(contentKey: keyof typeof testPosts): Promise<string> {
    const content = testPosts[contentKey];
    
    // Navigate to post creation page
    await this.page.goto('/post');
    await this.page.waitForSelector('[data-testid="post-editor"]', { timeout: 10000 });
    
    // Fill in post content
    await this.page.fill('textarea[data-testid="post-content"]', content.content);
    
    // Submit the post
    await this.page.click('button[data-testid="submit-post"]');
    
    // Wait for success and get the post ID from the URL
    await this.page.waitForURL('**/postTree/**');
    const url = this.page.url();
    const postId = url.split('/postTree/')[1];
    
    expect(postId).toBeTruthy();
    return postId;
  }
  
  async navigateToPost(postId: string) {
    await this.page.goto(`/postTree/${postId}`);
    await this.page.waitForSelector('[data-testid="post-tree-container"]', { timeout: 10000 });
  }
  
  async waitForPostToLoad(postId: string) {
    await this.page.waitForSelector(`[data-testid="post-${postId}"]`);
  }
  
  async selectTextInPost(postId: string, text: string) {
    const postElement = this.page.locator(`[data-testid="post-${postId}"]`);
    
    // Find the text content within the post
    const textElement = postElement.locator(`text="${text}"`).first();
    await textElement.waitFor();
    
    // Triple-click to select text (this might need refinement based on actual implementation)
    await textElement.click({ clickCount: 3 });
    
    // Verify text is selected
    const selectedText = await this.page.evaluate(() => window.getSelection()?.toString());
    expect(selectedText).toContain(text);
  }
  
  async getPostContent(postId: string): Promise<string> {
    const postElement = this.page.locator(`[data-testid="post-${postId}"]`);
    return await postElement.textContent() || '';
  }
  
  async verifyPostExists(postId: string) {
    await expect(this.page.locator(`[data-testid="post-${postId}"]`)).toBeVisible();
  }
}