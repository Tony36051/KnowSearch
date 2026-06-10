/**
 * E2E test: Load KnowSearch extension, visit jandan.net, verify content capture and search.
 *
 * Uses Puppeteer to launch Chrome with the extension loaded, navigates to the
 * target page, waits for the content script to capture, then queries IndexedDB
 * through the background service-worker to verify the data was stored and is
 * searchable.
 */
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, '.output/chrome-mv3');

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('=== KnowSearch E2E Test ===\n');

  // 1. Launch Chrome with the extension
  console.log('[1] Launching Chrome with extension...');
  const browser = await puppeteer.launch({
    headless: false, // MV3 extensions need headed mode
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  try {
    // 2. Find the extension's service worker (background page)
    // Wait for it to appear since extension loading is async
    console.log('[2] Finding extension background worker...');
    let extensionTarget = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const targets = await browser.targets();
      extensionTarget = targets.find(
        (t) => t.type() === 'service_worker' && t.url().includes('chrome-extension'),
      );
      if (extensionTarget) break;
      await sleep(1000);
    }

    if (!extensionTarget) {
      // List all targets for debugging
      const targets = await browser.targets();
      console.log('    Available targets:');
      for (const t of targets) {
        console.log(`      - type=${t.type()} url=${t.url()}`);
      }
      throw new Error('Could not find extension service worker. Extension may not have loaded.');
    }
    console.log('    Found service worker:', extensionTarget.url());

    const worker = await extensionTarget.worker();

    // 3. Navigate to jandan.net
    console.log('[3] Navigating to https://jandan.net/ ...');
    const page = await browser.newPage();
    await page.goto('https://jandan.net/', { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('    Page loaded:', await page.title());

    // 4. Wait for content script to capture (1s initial delay + processing time)
    console.log('[4] Waiting for content script to capture (5s)...');
    await sleep(5000);

    // 5. Query IndexedDB via the background service worker
    console.log('[5] Checking if page was captured in IndexedDB...');

    const pagesResult = await worker.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('knowsearch-db', 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('pages')) {
            const s = db.createObjectStore('pages', { keyPath: 'id' });
            s.createIndex('by-url', 'url');
            s.createIndex('by-content-hash', 'contentHash');
            s.createIndex('by-last-visited', 'lastVisitedAt');
          }
          if (!db.objectStoreNames.contains('search-terms'))
            db.createObjectStore('search-terms', { keyPath: 'term' });
          if (!db.objectStoreNames.contains('settings'))
            db.createObjectStore('settings', { keyPath: 'key' });
        };
      });

      const tx = db.transaction('pages', 'readonly');
      const store = tx.objectStore('pages');
      const allPages = await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      return allPages;
    });

    console.log(`    Found ${pagesResult.length} page(s) in IndexedDB`);

    let testPassed = true;

    if (pagesResult.length === 0) {
      console.log('    FAIL: No pages captured in IndexedDB!');
      testPassed = false;
    } else {
      for (const p of pagesResult) {
        const textPreview = p.text ? p.text.substring(0, 100) + '...' : '(empty)';
        console.log(`    - URL: ${p.url}`);
        console.log(`      Title: ${p.title}`);
        console.log(`      Text length: ${p.textLength}`);
        console.log(`      Text preview: ${textPreview}`);
        console.log(`      Visit count: ${p.visitCount}`);
      }

      // 6. Check if captured text contains "人工智能"
      const jandanPage = pagesResult.find((p) => p.url && p.url.includes('jandan.net'));
      if (jandanPage) {
        const hasKeyword = jandanPage.text && jandanPage.text.includes('人工智能');
        console.log(`\n[6] Checking if captured text contains "人工智能": ${hasKeyword ? 'YES' : 'NO'}`);

        if (hasKeyword) {
          console.log('    PASS: "人工智能" found in captured content');
        } else {
          console.log('    INFO: "人工智能" not found in captured text (may not be on this page)');
          // Check for other Chinese content at least
          const hasChinese = /[\u4e00-\u9fff]/.test(jandanPage.text);
          console.log(`    Checking for any Chinese content: ${hasChinese ? 'YES' : 'NO'}`);
          if (!hasChinese) {
            console.log('    FAIL: No Chinese content captured at all!');
            testPassed = false;
          } else {
            console.log('    PASS: Chinese content was captured successfully');
          }
        }
      } else {
        console.log('    FAIL: No jandan.net page found in captured data');
        testPassed = false;
      }

      // 7. Test search functionality via the service worker
      console.log('\n[7] Testing search functionality...');

      // First check if search-terms store has data
      const searchTermsCount = await worker.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open('knowsearch-db', 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });

        const tx = db.transaction('search-terms', 'readonly');
        const store = tx.objectStore('search-terms');
        const count = await new Promise((resolve, reject) => {
          const req = store.count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        return count;
      });

      console.log(`    Search terms in index: ${searchTermsCount}`);

      if (searchTermsCount === 0) {
        console.log('    FAIL: No search terms indexed!');
        testPassed = false;
      } else {
        // Try searching for a term
        const searchResult = await worker.evaluate(async () => {
          // Send a message like the popup would
          const query = '人工智能';
          const normalized = query.toLowerCase();
          // Extract bigrams for the query
          const terms = [];
          const segments = normalized.match(/[\u4e00-\u9fff]+/g) || [];
          for (const seg of segments) {
            for (let i = 0; i < seg.length - 1; i++) {
              terms.push(seg.substring(i, i + 2));
            }
          }

          const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('knowsearch-db', 1);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });

          const tx = db.transaction('search-terms', 'readonly');
          const store = tx.objectStore('search-terms');

          const results = {};
          for (const term of terms) {
            const record = await new Promise((resolve, reject) => {
              const req = store.get(term);
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            results[term] = record ? record.pageIds.length : 0;
          }

          return { query, terms, results };
        });

        console.log(`    Search query: "${searchResult.query}"`);
        console.log(`    Query bigrams: ${searchResult.terms.join(', ')}`);
        for (const [term, count] of Object.entries(searchResult.results)) {
          console.log(`      "${term}" -> ${count} page(s)`);
        }

        const totalMatches = Object.values(searchResult.results).reduce((a, b) => a + b, 0);
        if (totalMatches > 0) {
          console.log('    PASS: Search index contains matches for the query');
        } else {
          console.log('    FAIL: Search index has no matches for the query');
          testPassed = false;
        }
      }
    }

    console.log(`\n=== Test ${testPassed ? 'PASSED' : 'FAILED'} ===`);
    process.exit(testPassed ? 0 : 1);

  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
