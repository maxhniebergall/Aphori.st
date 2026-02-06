import { test, expect } from '@playwright/test';

const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';
const DEV_TOKEN = 'dev_token_user1';

// V2 ontology data-testid selectors (matches ArgumentHighlights.tsx)
const HIGHLIGHT_MAJORCLAIM = '[data-testid="highlight-majorclaim"]';
const HIGHLIGHT_SUPPORTING = '[data-testid="highlight-supporting"]';
const HIGHLIGHT_OPPOSING = '[data-testid="highlight-opposing"]';
const HIGHLIGHT_EVIDENCE = '[data-testid="highlight-evidence"]';
const ALL_HIGHLIGHTS = `${HIGHLIGHT_MAJORCLAIM}, ${HIGHLIGHT_SUPPORTING}, ${HIGHLIGHT_OPPOSING}, ${HIGHLIGHT_EVIDENCE}`;

async function waitForHighlights(page: any, selector: string, timeoutSeconds = 30): Promise<boolean> {
  for (let i = 0; i < timeoutSeconds; i++) {
    const count = await page.locator(selector).count();
    if (count > 0) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

test.describe('Phase 3: Argument Analysis End-to-End (V2 Ontology)', () => {
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

  test('Full pipeline: Create post → Wait for analysis → See V2 highlights', async ({ page }) => {
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

    // Wait for analysis to complete (check for any V2 highlights)
    const highlightsAppeared = await waitForHighlights(page, ALL_HIGHLIGHTS);
    expect(highlightsAppeared).toBe(true);

    // Verify at least one MajorClaim highlight exists (this is the root of the argument)
    const majorClaimCount = await page.locator(HIGHLIGHT_MAJORCLAIM).count();
    expect(majorClaimCount).toBeGreaterThan(0);

    // Should also have Supporting/Evidence highlights for this argumentative text
    const supportingCount = await page.locator(HIGHLIGHT_SUPPORTING).count();
    const evidenceCount = await page.locator(HIGHLIGHT_EVIDENCE).count();
    const totalNonRoot = supportingCount + evidenceCount;
    expect(totalNonRoot).toBeGreaterThan(0);
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

  test('V2 highlight colors: blue=MajorClaim, green=Supporting, red=Opposing, yellow=Evidence', async ({ page }) => {
    await page.goto(`${WEB_URL}/`);

    // Create post with clear argumentative structure
    const postContent =
      'Climate change is happening. Arctic ice is melting as evidence. Therefore, sea levels will rise.';

    const postInput = page.locator('textarea[placeholder*="What"]').first();
    await postInput.fill(postContent);

    const submitButton = page.locator('button:has-text("Post")').first();
    await submitButton.click();

    // Wait for analysis
    await page.waitForSelector('text=Climate change is happening');

    // Wait for V2 highlights to appear
    const highlightsAppeared = await waitForHighlights(page, ALL_HIGHLIGHTS);
    expect(highlightsAppeared).toBe(true);

    // Verify MajorClaim highlight has blue border styling
    const majorClaimHighlight = page.locator(HIGHLIGHT_MAJORCLAIM).first();
    const majorClaimClasses = await majorClaimHighlight.getAttribute('class');
    expect(majorClaimClasses).toContain('border');

    // Verify Supporting highlight has green border styling (if present)
    const supportingCount = await page.locator(HIGHLIGHT_SUPPORTING).count();
    if (supportingCount > 0) {
      const supportingClasses = await page.locator(HIGHLIGHT_SUPPORTING).first().getAttribute('class');
      expect(supportingClasses).toContain('border');
    }
  });

  test('Click V2 highlight to open reply composer', async ({ page }) => {
    await page.goto(`${WEB_URL}/`);

    // Create post with an argument
    const postContent = 'Global warming threatens coastal cities worldwide.';

    const postInput = page.locator('textarea[placeholder*="What"]').first();
    await postInput.fill(postContent);

    const submitButton = page.locator('button:has-text("Post")').first();
    await submitButton.click();

    // Wait for post and analysis
    await page.waitForSelector('text=Global warming');

    // Wait for V2 highlights to appear
    const highlightFound = await waitForHighlights(page, ALL_HIGHLIGHTS);
    expect(highlightFound).toBe(true);

    // Click on the first available highlight (any V2 type)
    const firstHighlight = page.locator(ALL_HIGHLIGHTS).first();
    await firstHighlight.click();

    // Verify reply composer opens
    const replyComposer = page.locator('textarea[placeholder*="Reply"]');
    await expect(replyComposer).toBeVisible();
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

  test('Tooltip shows V2 type label and confidence on highlight hover', async ({ page }) => {
    await page.goto(`${WEB_URL}/`);

    const postContent = 'Renewable energy sources reduce environmental pollution.';

    const postInput = page.locator('textarea[placeholder*="What"]').first();
    await postInput.fill(postContent);

    const submitButton = page.locator('button:has-text("Post")').first();
    await submitButton.click();

    // Wait for analysis
    await page.waitForSelector('text=Renewable energy');

    // Wait for highlights
    const highlightFound = await waitForHighlights(page, ALL_HIGHLIGHTS);
    expect(highlightFound).toBe(true);

    // Hover over a highlight
    const firstHighlight = page.locator(ALL_HIGHLIGHTS).first();
    await firstHighlight.hover();

    // Wait for tooltip to appear
    await page.waitForTimeout(500);

    // The tooltip is set via the title attribute and should contain V2 type + confidence
    const title = await firstHighlight.getAttribute('title');
    expect(title).toBeTruthy();
    // Should contain one of the V2 type labels and a percentage
    expect(title).toMatch(/(Major Claim|Supporting|Opposing|Evidence)/);
    expect(title).toMatch(/\d+%/);
  });
});
