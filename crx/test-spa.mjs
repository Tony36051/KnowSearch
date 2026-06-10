/**
 * Test: SPA dynamic content loading on jandan.net
 * 1. Load main page (首页)
 * 2. Click "树洞" to trigger SPA navigation
 * 3. Wait for new content to load
 * 4. Verify treehole-specific keyword "番茄酱" is captured
 */
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, '.output/chrome-mv3');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Keyword that exists on treehole page but NOT on main page
const TEST_KEYWORD = '番茄酱';

async function main() {
  console.log('=== SPA Dynamic Content Test ===\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run', '--no-default-browser-check',
    ],
  });

  try {
    // Find service worker
    let swTarget = null;
    for (let i = 0; i < 10; i++) {
      const targets = await browser.targets();
      swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension'));
      if (swTarget) break;
      await sleep(1000);
    }
    if (!swTarget) { console.log('FAIL: No service worker'); process.exit(1); }
    const extId = swTarget.url().match(/chrome-extension:\/\/([a-z]+)/)[1];

    // Step 1: Load main page
    const page = await browser.newPage();
    await page.goto('https://jandan.net/', { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('[1] Main page loaded:', await page.title());

    // Verify main page does NOT have the keyword
    const mainText = await page.evaluate(() => document.body.innerText);
    const mainHasKeyword = mainText.includes(TEST_KEYWORD);
    console.log(`[2] Main page has "${TEST_KEYWORD}": ${mainHasKeyword} (expected: false)`);

    // Wait for initial capture
    await sleep(4000);

    // Step 2: Click "树洞" link (SPA navigation)
    console.log('[3] Clicking "树洞"...');
    const clicked = await page.evaluate(() => {
      const links = document.querySelectorAll('a');
      for (const link of links) {
        if (link.textContent.trim().includes('树洞')) {
          link.click();
          return link.href;
        }
      }
      return null;
    });

    if (!clicked) {
      console.log('    FAIL: Could not find "树洞" link');
      process.exit(1);
    }
    console.log('    Clicked:', clicked);

    // Step 3: Wait for SPA navigation + content capture
    console.log('[4] Waiting for SPA content to load and be captured...');
    await sleep(6000);

    const newUrl = await page.url();
    console.log('    Current URL:', newUrl);

    // Check the page now has treehole content
    const treeholeText = await page.evaluate(() => document.body.innerText);
    const pageHasKeyword = treeholeText.includes(TEST_KEYWORD);
    console.log(`[5] Page now has "${TEST_KEYWORD}": ${pageHasKeyword}`);

    // Step 4: Check captured data via popup messaging
    console.log('\n[6] Checking extension captured data...');

    const worker = await swTarget.worker();
    const allPages = await worker.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('knowsearch-db', 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const pages = await new Promise((resolve, reject) => {
        const req = db.transaction('pages', 'readonly').objectStore('pages').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return pages.map(p => ({
        url: p.url,
        title: p.title,
        textLen: p.textLength,
        hasKeyword: p.text?.includes('番茄酱'),
      }));
    });

    for (const p of allPages) {
      console.log(`    - [${p.title}] ${p.url} (${p.textLen} chars, has "${TEST_KEYWORD}": ${p.hasKeyword})`);
    }

    // Step 5: Search for the keyword via popup
    const popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'networkidle2', timeout: 10000 });
    await sleep(500);

    const searchResult = await popupPage.evaluate(async (keyword) => {
      try {
        const res = await browser.runtime.sendMessage({
          type: 'searchPages',
          data: { query: keyword, mode: 'keyword', limit: 10 },
        });
        return {
          ok: true,
          total: res.total,
          results: res.results?.map(r => ({ title: r.title, url: r.url })),
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }, TEST_KEYWORD);

    console.log(`\n[7] Search for "${TEST_KEYWORD}":`, searchResult.ok && searchResult.total > 0 ? 'FOUND' : 'NOT FOUND');
    if (searchResult.results?.length > 0) {
      for (const r of searchResult.results) {
        console.log(`    - ${r.title} (${r.url})`);
      }
    } else if (searchResult.error) {
      console.log('    Error:', searchResult.error);
    }

    // Summary
    const capturedTreehole = allPages.some(p => p.url?.includes('treehole'));
    const capturedKeyword = allPages.some(p => p.hasKeyword);
    const searchFound = searchResult.ok && searchResult.total > 0;

    console.log('\n' + '='.repeat(50));
    console.log('SPA navigation detected (URL changed):', newUrl.includes('treehole') ? 'YES' : 'NO');
    console.log('Treehole page captured:', capturedTreehole ? 'YES' : 'NO');
    console.log(`"${TEST_KEYWORD}" in captured data:`, capturedKeyword ? 'YES' : 'NO');
    console.log(`Search finds "${TEST_KEYWORD}":`, searchFound ? 'YES' : 'NO');

    const allPass = newUrl.includes('treehole') && capturedTreehole && capturedKeyword && searchFound;
    console.log('\n=== ' + (allPass ? 'ALL PASSED' : 'SOME FAILED') + ' ===');
    process.exit(allPass ? 0 : 1);

  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
