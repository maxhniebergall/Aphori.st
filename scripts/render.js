import puppeteer from 'puppeteer';
import fs from 'fs';

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    // Capture console logs
    page.on('console', msg => console.log('Browser console:', msg.text()));

    console.log("Loading website...");
    await page.goto('http://localhost:3000/storyTree/story-22fff4aa-3e2b-4f9e-8ad7-bec6afc15c93', { waitUntil: 'networkidle0' });

    // Wait for content to be loaded
    try {
        await page.waitForSelector('#root > div > div > div.story-tree-content', { timeout: 5000 });
        // Wait a bit more to ensure React has rendered the content
        await page.waitForTimeout(2000);
    } catch (error) {
        console.error('Error waiting for content:', error);
    }

    // Get rendered HTML
    const storyTreeContent = await page.$('#root > div > div > div.story-tree-content');
    if (storyTreeContent) {
        const html = await storyTreeContent.evaluate(el => el.outerHTML);
        console.log("Rendered HTML:", html);
    } else {
        console.error("Could not find story-tree-content element");
    }

    await browser.close();
})();
