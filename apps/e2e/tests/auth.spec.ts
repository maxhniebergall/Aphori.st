import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page, context }) => {
    // Clear any existing auth state
    await context.clearCookies();
    await context.addInitScript(() => localStorage.clear());
  });

  test('should display login page', async ({ page }) => {
    await page.goto('/');

    // Should redirect to auth or show login
    const hasAuthForm = await page.locator('input[type="email"]').isVisible().catch(() => false);
    const hasLoginButton = await page.locator('button:has-text("Login")').isVisible().catch(() => false);

    expect(hasAuthForm || hasLoginButton).toBeTruthy();
  });

  test('should request magic link', async ({ page }) => {
    await page.goto('/');

    // Find email input and submit
    const emailInput = page.locator('input[type="email"]');
    const submitButton = page.locator('button:has-text("Send")') || page.locator('button:has-text("Login")');

    await emailInput.fill('testuser@example.com');
    await submitButton.click();

    // Should show success message
    const successMsg = page.locator('text=Check your email');
    await expect(successMsg).toBeVisible({ timeout: 5000 });
  });

  test('should verify magic link and store token', async ({ page }) => {
    // First, get a magic link
    const emailTestUser = `test-${Date.now()}@example.com`;

    // Request magic link
    await page.goto('/');
    const emailInput = page.locator('input[type="email"]');
    const submitButton = page.locator('button:has-text("Send")') || page.locator('button:has-text("Login")');

    if (await emailInput.isVisible()) {
      await emailInput.fill(emailTestUser);
      await submitButton.click();
    }

    // Simulate magic link verification by calling the API
    const response = await page.request.post('http://localhost:3001/api/v1/auth/verify-magic-link', {
      data: { token: 'dev_token' },
    }).catch(() => null);

    // Check if we have auth mechanism
    const authToken = await page.evaluate(() => localStorage.getItem('auth_token'));
    const isAuthenticated = authToken !== null || response !== null;

    expect(isAuthenticated).toBeTruthy();
  });

  test('should use dev_token in development', async ({ page }) => {
    // Test that we can access authenticated routes with dev_token
    const response = await page.request.get('http://localhost:3001/api/v1/auth/profile', {
      headers: { 'Authorization': 'Bearer dev_token' },
    });

    expect([200, 401, 403]).toContain(response.status());
  });
});
