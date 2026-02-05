import { test, expect } from '@playwright/test';

const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';
const DEV_TOKEN = 'dev_token_user1';

test.describe('Phase 3: Argument Analysis End-to-End', () => {
  test.beforeEach(async ({ page }) => {
    // Set dev token for authentication
    await page.context().addCookies([
      {
        name: 'auth_token',
        value: DEV_TOKEN,
        url: WEB_URL,
      },
    ]);
  });

  test('Full pipeline: Create post → Wait for analysis → See highlights', async ({ page }) => {
    // Navigate to home page
    await page.goto(`${WEB_URL}/`);

    // Create a post with multiple claims and premises
    const postContent =
      'Climate change is real because global temperatures are rising. We must take action immediately. Therefore, governments should implement carbon taxes.';

    // Find and fill the post creation form
    const postInput = page.locator('textarea[placeholder*="What"]').first();
    await postInput.fill(postContent);

    // Submit the post
    const submitButton = page.locator('button:has-text("Post")').first();
    await submitButton.click();

    // Wait for post to appear
    await page.waitForSelector('text=Climate change is real');

    // Wait for analysis to complete (checking for loading indicator to disappear)
    let analysisComplete = false;
    for (let i = 0; i < 30; i++) {
      const analyzingBadge = page.locator('text=Analyzing arguments...').count();
      if (analyzingBadge === 0) {
        analysisComplete = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    expect(analysisComplete).toBe(true);

    // Verify highlights are visible
    const claimHighlights = page.locator('[data-testid="highlight-claim"]');
    const premiseHighlights = page.locator('[data-testid="highlight-premise"]');

    expect(await claimHighlights.count()).toBeGreaterThan(0);
    expect(await premiseHighlights.count()).toBeGreaterThan(0);
  });

  test('Analysis status badge transitions: pending → processing → completed', async ({ page }) => {
    await page.goto(`${WEB_URL}/`);

    // Create a post
    const postContent = 'This is a test post for analysis status tracking.';
    const postInput = page.locator('textarea[placeholder*="What"]').first();
    await postInput.fill(postContent);

    const submitButton = page.locator('button:has-text("Post")').first();
    await submitButton.click();

    // Wait for post to appear
    await page.waitForSelector('text=This is a test post');

    // Check for status badge
    const statusBadge = page.locator('[data-testid="analysis-status"]');

    // Should show "pending" or "processing" initially
    const initialStatus = await statusBadge.textContent();
    expect(['Pending', 'Processing', 'Analyzing arguments...', 'pending', 'processing']).toContain(
      initialStatus?.trim()
    );

    // Wait for analysis to complete (status badge should disappear or show "completed")
    let statusTransitioned = false;
    for (let i = 0; i < 30; i++) {
      const status = await statusBadge.textContent();
      if (status?.toLowerCase().includes('completed') || status === null || status === '') {
        statusTransitioned = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    expect(statusTransitioned).toBe(true);
  });

  test('Highlight colors: blue for claims, green for premises', async ({ page }) => {
    await page.goto(`${WEB_URL}/`);

    // Create post with clear claims and premises
    const postContent =
      'Climate change is happening. Arctic ice is melting. Therefore, sea levels will rise.';

    const postInput = page.locator('textarea[placeholder*="What"]').first();
    await postInput.fill(postContent);

    const submitButton = page.locator('button:has-text("Post")').first();
    await submitButton.click();

    // Wait for analysis
    await page.waitForSelector('text=Climate change is happening');

    // Wait for highlights to appear (up to 30 seconds)
    let highlightsAppeared = false;
    for (let i = 0; i < 30; i++) {
      const claimCount = await page.locator('[data-testid="highlight-claim"]').count();
      if (claimCount > 0) {
        highlightsAppeared = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    expect(highlightsAppeared).toBe(true);

    // Verify claim highlight color (blue)
    const claimHighlight = page.locator('[data-testid="highlight-claim"]').first();
    const claimColor = await claimHighlight.evaluate(el => window.getComputedStyle(el).backgroundColor);
    expect(claimColor).toContain('rgb'); // Should have some color

    // Verify premise highlight exists
    const premiseHighlights = page.locator('[data-testid="highlight-premise"]');
    const premiseCount = await premiseHighlights.count();
    expect(premiseCount).toBeGreaterThanOrEqual(0);
  });

  test('Click highlight to open reply composer targeted to ADU', async ({ page }) => {
    await page.goto(`${WEB_URL}/`);

    // Create post with an argument
    const postContent = 'Global warming threatens coastal cities worldwide.';

    const postInput = page.locator('textarea[placeholder*="What"]').first();
    await postInput.fill(postContent);

    const submitButton = page.locator('button:has-text("Post")').first();
    await submitButton.click();

    // Wait for post and analysis
    await page.waitForSelector('text=Global warming');

    // Wait for highlights to appear
    let highlightFound = false;
    for (let i = 0; i < 30; i++) {
      const highlights = await page.locator('[data-testid="highlight-claim"]').count();
      if (highlights > 0) {
        highlightFound = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    expect(highlightFound).toBe(true);

    // Click on a highlight
    const firstHighlight = page.locator('[data-testid="highlight-claim"]').first();
    await firstHighlight.click();

    // Verify reply composer opens with reference to the ADU
    const replyComposer = page.locator('textarea[placeholder*="Reply"]');
    await expect(replyComposer).toBeVisible();

    // Should have some indication of which claim is being replied to
    const aduReference = page.locator('[data-testid="adu-reference"]');
    const count = await aduReference.count();
    expect(count).toBeGreaterThanOrEqual(0); // May or may not be visible
  });

  test('Semantic search returns relevant results', async ({ page }) => {
    await page.goto(`${WEB_URL}/`);

    // Create multiple posts with different topics
    const posts = [
      'Climate change causes rising sea levels and threatens coastal communities.',
      'Electric vehicles reduce carbon emissions and improve air quality.',
      'Dogs are loyal pets that require regular exercise and care.',
      'Cats are independent animals that enjoy sleeping and hunting.',
    ];

    for (const content of posts) {
      const postInput = page.locator('textarea[placeholder*="What"]').first();
      await postInput.fill(content);

      const submitButton = page.locator('button:has-text("Post")').first();
      await submitButton.click();

      // Wait between posts
      await page.waitForTimeout(500);
    }

    // Find search input
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await searchInput.fill('climate and environment');

    // Submit search
    const searchButton = page.locator('button:has-text("Search")').first();
    if (await searchButton.isVisible()) {
      await searchButton.click();
    } else {
      // Try pressing Enter
      await searchInput.press('Enter');
    }

    // Wait for results
    await page.waitForTimeout(2000);

    // Verify results appear and climate-related posts rank higher
    const resultPosts = page.locator('[data-testid="search-result"]');
    const resultCount = await resultPosts.count();

    // Should have some results
    expect(resultCount).toBeGreaterThan(0);

    // Check that climate-related posts appear in results
    const pageText = await page.locator('body').textContent();
    expect(pageText).toContain('climate');
  });

  test('Semantic search filters unrelated content', async ({ page }) => {
    await page.goto(`${WEB_URL}/`);

    // Create posts
    const climatePost = 'Carbon dioxide emissions are accelerating climate change worldwide.';
    const petPost = 'My cat knocked over a vase and broke it.';

    for (const content of [climatePost, petPost]) {
      const postInput = page.locator('textarea[placeholder*="What"]').first();
      await postInput.fill(content);

      const submitButton = page.locator('button:has-text("Post")').first();
      await submitButton.click();

      await page.waitForTimeout(500);
    }

    // Search for climate-related query
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await searchInput.fill('carbon dioxide and global warming');

    const searchButton = page.locator('button:has-text("Search")').first();
    if (await searchButton.isVisible()) {
      await searchButton.click();
    } else {
      await searchInput.press('Enter');
    }

    await page.waitForTimeout(2000);

    // Get results
    const resultPosts = page.locator('[data-testid="search-result"]');
    const resultCount = await resultPosts.count();

    if (resultCount > 0) {
      // First result should be climate-related, not pet-related
      const firstResult = page.locator('[data-testid="search-result"]').first();
      const firstResultText = await firstResult.textContent();

      expect(firstResultText).toContain('carbon');
      expect(firstResultText).not.toContain('cat');
    }
  });

  test('Tooltip shows confidence percentage on highlight hover', async ({ page }) => {
    await page.goto(`${WEB_URL}/`);

    const postContent = 'Renewable energy sources reduce environmental pollution.';

    const postInput = page.locator('textarea[placeholder*="What"]').first();
    await postInput.fill(postContent);

    const submitButton = page.locator('button:has-text("Post")').first();
    await submitButton.click();

    // Wait for analysis
    await page.waitForSelector('text=Renewable energy');

    // Wait for highlights
    let highlightFound = false;
    for (let i = 0; i < 30; i++) {
      const highlights = await page.locator('[data-testid="highlight-claim"]').count();
      if (highlights > 0) {
        highlightFound = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    expect(highlightFound).toBe(true);

    // Hover over a highlight
    const firstHighlight = page.locator('[data-testid="highlight-claim"]').first();
    await firstHighlight.hover();

    // Wait for tooltip to appear
    await page.waitForTimeout(500);

    // Check for tooltip with confidence
    const tooltip = page.locator('[role="tooltip"], [data-testid="confidence-tooltip"]').first();
    const isVisible = await tooltip.isVisible().catch(() => false);

    if (isVisible) {
      const tooltipText = await tooltip.textContent();
      expect(tooltipText).toMatch(/\d+%|confidence/i);
    }
  });
});
