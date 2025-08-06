import { Page } from '@playwright/test';
import { testUsers, apiEndpoints } from '../fixtures/test-data';

export class AuthHelper {
  constructor(private page: Page) {}

  async loginUser(userKey: keyof typeof testUsers) {
    const user = testUsers[userKey];
    
    // For testing, we'll use direct API calls to set up authentication
    // In production, this would go through the full magic link flow
    await this.page.goto('/login');
    
    // Fill in email and request magic link
    await this.page.fill('input[type="email"]', user.email);
    await this.page.click('button[type="submit"]');
    
    // Wait for confirmation message
    await this.page.waitForSelector('text=Magic link sent');
    
    // For testing, we'll simulate the magic link verification
    // by directly setting the auth token (this would normally come from email)
    await this.simulateMagicLinkVerification(user.userId);
    
    // Navigate to feed after authentication
    await this.page.goto('/feed');
    await this.page.waitForSelector('[data-testid="feed-container"]', { timeout: 10000 });
  }
  
  private async simulateMagicLinkVerification(userId: string) {
    // This simulates clicking a magic link that would contain a verification token
    // In a real test, we'd need to either:
    // 1. Access the test email to get the real link
    // 2. Use a test API endpoint to generate a valid token
    // 3. Mock the authentication in the test environment
    
    // For now, we'll set a mock token in localStorage
    // This assumes the application accepts tokens set this way in test mode
    await this.page.evaluate((uid) => {
      localStorage.setItem('token', `mock-token-${uid}`);
      localStorage.setItem('userId', uid);
    }, userId);
  }
  
  async logout() {
    await this.page.evaluate(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('userId');
    });
    await this.page.goto('/login');
  }
  
  async isLoggedIn(): Promise<boolean> {
    try {
      await this.page.waitForSelector('[data-testid="user-profile"]', { timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }
  
  async waitForLoginRedirect() {
    await this.page.waitForURL('**/feed');
  }
}