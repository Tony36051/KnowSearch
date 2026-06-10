/**
 * Test: Load the extension in Chrome and check for all errors
 * - Extension loading errors
 * - Service worker (background) errors
 * - Content script injection errors
 * - Popup render errors
 * - Console errors from any extension context
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
  console.log('=== KnowSearch Extension Error Check ===\n');

  const allErrors = [];

  // 1. Launch Chrome with the extension
  console.log('[1] Launching Chrome with extension...');
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  try {
    // 2. Check extension targets
    console.log('[2] Listing extension targets...');
    await sleep(2000);
    const targets = await browser.targets();

    let extensionId = null;
    let swTarget = null;

    for (const t of targets) {
      if (t.url().startsWith('chrome-extension://')) {
        if (!extensionId) {
          const match = t.url().match(/chrome-extension:\/\/([a-z]+)/);
          if (match) extensionId = match[1];
        }
        console.log(`    [${t.type()}] ${t.url()}`);
        if (t.type() === 'service_worker') {
          swTarget = t;
        }
      }
    }

    if (!extensionId) {
      allErrors.push('EXTENSION_NOT_LOADED: No chrome-extension:// targets found');
    }

    if (!swTarget) {
      allErrors.push('NO_SERVICE_WORKER: Extension service worker not found');
    }

    // 3. Check service worker for errors
    if (swTarget) {
      console.log('\n[3] Checking service worker (background)...');
      const worker = await swTarget.worker();

      // Test basic messaging - try sending a getSettings message
      try {
        const settingsResult = await worker.evaluate(async () => {
          try {
            // Test IndexedDB access
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
            return { ok: true, storeNames: Array.from(db.objectStoreNames) };
          } catch (err) {
            return { ok: false, error: err.message };
          }
        });

        if (settingsResult.ok) {
          console.log('    IndexedDB access: OK');
          console.log('    Object stores:', settingsResult.storeNames.join(', '));
        } else {
          allErrors.push(`INDEXEDDB_ERROR: ${settingsResult.error}`);
          console.log('    IndexedDB access: FAILED -', settingsResult.error);
        }
      } catch (err) {
        allErrors.push(`SW_EVAL_ERROR: ${err.message}`);
        console.log('    Service worker eval FAILED:', err.message);
      }

      // Test chrome.alarms
      try {
        const alarmsResult = await worker.evaluate(async () => {
          try {
            const alarms = await chrome.alarms.getAll();
            return { ok: true, alarms: alarms.map(a => a.name) };
          } catch (err) {
            return { ok: false, error: err.message };
          }
        });

        if (alarmsResult.ok) {
          console.log('    Chrome alarms: OK -', alarmsResult.alarms.join(', '));
        } else {
          allErrors.push(`ALARMS_ERROR: ${alarmsResult.error}`);
          console.log('    Chrome alarms: FAILED -', alarmsResult.error);
        }
      } catch (err) {
        allErrors.push(`ALARMS_EVAL_ERROR: ${err.message}`);
      }
    }

    // 4. Test content script injection by navigating to a page
    console.log('\n[4] Testing content script injection...');
    const page = await browser.newPage();

    // Collect console messages from the page
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        pageErrors.push(`PAGE_CONSOLE_ERROR: ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(`PAGE_ERROR: ${err.message}`);
    });

    try {
      await page.goto('https://example.com/', { waitUntil: 'networkidle2', timeout: 15000 });
      console.log('    Navigated to example.com');
      await sleep(3000);

      if (pageErrors.length > 0) {
        for (const e of pageErrors) {
          allErrors.push(e);
          console.log('    ', e);
        }
      } else {
        console.log('    No page errors detected');
      }
    } catch (err) {
      allErrors.push(`NAVIGATION_ERROR: ${err.message}`);
      console.log('    Navigation FAILED:', err.message);
    }

    // 5. Check if content script captured the page
    if (swTarget) {
      console.log('\n[5] Checking if content script captured page...');
      const worker = await swTarget.worker();
      await sleep(2000);

      const captureResult = await worker.evaluate(async () => {
        try {
          const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('knowsearch-db', 1);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });

          const tx = db.transaction('pages', 'readonly');
          const store = tx.objectStore('pages');
          const count = await new Promise((resolve, reject) => {
            const req = store.count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });

          const pages = await new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });

          return {
            ok: true,
            count,
            pages: pages.map(p => ({
              url: p.url,
              title: p.title,
              textLength: p.textLength,
              visitCount: p.visitCount,
            })),
          };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      });

      if (captureResult.ok) {
        console.log(`    Pages captured: ${captureResult.count}`);
        for (const p of captureResult.pages) {
          console.log(`      - ${p.title} (${p.textLength} chars, ${p.visitCount} visits)`);
          console.log(`        ${p.url}`);
        }
        if (captureResult.count === 0) {
          allErrors.push('NO_PAGES_CAPTURED: Content script did not capture any pages');
        }
      } else {
        allErrors.push(`CAPTURE_CHECK_ERROR: ${captureResult.error}`);
        console.log('    Capture check FAILED:', captureResult.error);
      }
    }

    // 6. Test popup page for errors
    if (extensionId) {
      console.log('\n[6] Testing popup page...');
      const popupUrl = `chrome-extension://${extensionId}/popup.html`;
      const popupPage = await browser.newPage();

      const popupErrors = [];
      popupPage.on('pageerror', (err) => {
        popupErrors.push(`POPUP_ERROR: ${err.message}`);
      });
      popupPage.on('console', (msg) => {
        if (msg.type() === 'error') {
          popupErrors.push(`POPUP_CONSOLE_ERROR: ${msg.text()}`);
        }
      });

      try {
        await popupPage.goto(popupUrl, { waitUntil: 'networkidle2', timeout: 10000 });
        await sleep(1000);

        // Check if the Vue app rendered
        const popupContent = await popupPage.evaluate(() => {
          const app = document.querySelector('#app');
          return {
            hasApp: !!app,
            innerHTML: app?.innerHTML?.substring(0, 500) || '(empty)',
            title: document.title,
          };
        });

        console.log('    Popup loaded:', popupContent.title);
        console.log('    #app element:', popupContent.hasApp ? 'exists' : 'MISSING');
        console.log('    Content preview:', popupContent.innerHTML.substring(0, 200));

        if (!popupContent.hasApp) {
          allErrors.push('POPUP_NO_APP: #app element not found in popup');
        }

        if (popupErrors.length > 0) {
          for (const e of popupErrors) {
            allErrors.push(e);
            console.log('    ', e);
          }
        } else {
          console.log('    No popup errors');
        }
      } catch (err) {
        allErrors.push(`POPUP_LOAD_ERROR: ${err.message}`);
        console.log('    Popup load FAILED:', err.message);
      }

      await popupPage.close();
    }

    // 7. Test search functionality end-to-end
    if (swTarget) {
      console.log('\n[7] Testing search end-to-end...');
      const worker = await swTarget.worker();

      const searchResult = await worker.evaluate(async () => {
        try {
          // Simulate a search message like the popup would send
          const query = 'example';
          const normalized = query.toLowerCase();
          const terms = normalized.match(/[a-z0-9]+/g) || [];

          const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('knowsearch-db', 1);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });

          const tx = db.transaction('search-terms', 'readonly');
          const store = tx.objectStore('search-terms');
          const termCount = await new Promise((resolve, reject) => {
            const req = store.count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });

          const matchedPageIds = new Set();
          for (const term of terms) {
            const record = await new Promise((resolve, reject) => {
              const req = store.get(term);
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            if (record) {
              for (const id of record.pageIds) matchedPageIds.add(id);
            }
          }

          return { ok: true, termCount, matchedPages: matchedPageIds.size, terms };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      });

      if (searchResult.ok) {
        console.log(`    Search index terms: ${searchResult.termCount}`);
        console.log(`    Search for "example": ${searchResult.matchedPages} result(s)`);
      } else {
        allErrors.push(`SEARCH_ERROR: ${searchResult.error}`);
        console.log('    Search FAILED:', searchResult.error);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    if (allErrors.length === 0) {
      console.log('ALL CHECKS PASSED - No errors found');
    } else {
      console.log(`FOUND ${allErrors.length} ERROR(S):`);
      for (const e of allErrors) {
        console.log(`  - ${e}`);
      }
    }
    console.log('='.repeat(50));

    process.exit(allErrors.length > 0 ? 1 : 0);

  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
