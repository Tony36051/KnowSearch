/**
 * Test: Grafana SPA with scroll-triggered content
 * 1. Load Grafana dashboard
 * 2. Wait/scroll for "queryAllRegion" to appear in body.innerText
 * 3. Wait for extension to capture the content
 * 4. Verify keyword is searchable via popup
 */
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, '.output/chrome-mv3');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TEST_URL = 'https://console.his-op.huawei.com/synta/dashboard/web/d/fvhwterrd/his-op-fang-wen-ri-zhi-apixing-neng-bei-fen-2?access=40199&orgId=1&w3=w00830511@op&from=now-5m&to=now&var-domain=MetaCRM&var-product=All&var-subproduct=Meta%20%E4%BC%99%E4%BC%B4%E6%BF%80%E5%8A%B1&var-subapp=All&var-role=%E6%8F%90%E4%BE%9B%E6%96%B9&var-refFromProdTree=All&var-ref=All&var-appIdFromProdTree=All&var-appid=All&var-request=All&var-api_type=UIAPI&var-response=%3D200&var-time_duration=%3E%3D0&var-Interval=$__auto_interval_Interval';
const TEST_KEYWORD = 'queryAllRegion';

async function findServiceWorker(browser) {
  const targets = await browser.targets();
  return targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension'));
}

async function queryAllPagesFromSW(browser) {
  const sw = await findServiceWorker(browser);
  if (!sw) {
    console.log('    [DB] Service worker not found');
    return [];
  }
  try {
    const worker = await sw.worker();
    return await worker.evaluate(async () => {
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
        url: p.url?.substring(0, 100),
        title: p.title,
        textLen: p.textLength,
        hasKeyword: p.text?.includes('queryAllRegion'),
        textPreview: p.text?.substring(0, 150),
      }));
    });
  } catch (err) {
    console.log('    [DB] Worker evaluate failed:', err.message);
    return [];
  }
}

async function main() {
  console.log('=== Grafana Scroll Test ===\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run', '--no-default-browser-check',
      '--ignore-certificate-errors',
    ],
  });

  try {
    // Find extension service worker
    let swTarget = null;
    for (let i = 0; i < 10; i++) {
      swTarget = await findServiceWorker(browser);
      if (swTarget) break;
      await sleep(1000);
    }
    if (!swTarget) { console.log('FAIL: No service worker'); process.exit(1); }
    const extId = swTarget.url().match(/chrome-extension:\/\/([a-z]+)/)[1];

    // Step 1: Navigate to Grafana
    console.log('[1] Navigating to Grafana...');
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('console', msg => {
      if (msg.text().includes('KnowSearch') || msg.text().includes('knowsearch'))
        console.log(`    [CONTENT-SCRIPT] ${msg.text()}`);
    });
    await page.goto(TEST_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('    Loaded:', await page.title());

    // Check if content script is injected
    const contentScriptCheck = await page.evaluate(() => {
      // Content script sets up MutationObserver on document.body
      return !!document.body && document.body.childNodes.length > 0;
    });
    console.log('    Page has body content:', contentScriptCheck);

    // Wait a moment for content script to run initial capture
    await sleep(3000);

    // Step 2: Wait for panels to render (up to 60s)
    console.log('[2] Waiting for Grafana panels to render...');
    let foundAtWait = false;
    for (let wait = 0; wait < 30; wait++) {
      await sleep(2000);
      const check = await page.evaluate((kw) => {
        const text = document.body.innerText;
        return { textLen: text.length, hasKeyword: text.includes(kw) };
      }, TEST_KEYWORD);
      console.log(`    t=${(wait + 1) * 2}s: textLen=${check.textLen}, hasKeyword=${check.hasKeyword}`);
      if (check.hasKeyword) {
        foundAtWait = true;
        console.log('    >>> Keyword found!');
        break;
      }
    }

    // Step 3: If not found, scroll to trigger panel loading
    if (!foundAtWait) {
      console.log('[3] Scrolling to load panels...');
      for (let i = 0; i < 20; i++) {
        await page.evaluate(() => {
          const outerScroll = document.querySelector('#reactRoot > div > main > div.css-wtcggw > div > div > div.scrollbar-view');
          if (outerScroll) outerScroll.scrollTop += 500;
          else window.scrollBy(0, 500);
        });
        await sleep(1500);

        const check = await page.evaluate((kw) => {
          const text = document.body.innerText;
          return { textLen: text.length, hasKeyword: text.includes(kw) };
        }, TEST_KEYWORD);
        console.log(`    Scroll ${i + 1}: textLen=${check.textLen}, hasKeyword=${check.hasKeyword}`);
        if (check.hasKeyword) {
          console.log('    >>> Keyword found after scroll!');
          break;
        }
      }
    }

    // Step 4: Wait for extension MutationObserver to re-capture
    console.log('[4] Waiting for extension to capture content (8s)...');
    await sleep(8000);

    // Step 5: Check what extension captured
    console.log('[5] Checking captured data...');

    // Check if content script is active by looking for MutationObserver
    const hasObserver = await page.evaluate(() => {
      // We can't directly check MutationObserver, but we can check if the page
      // has been loaded long enough for the content script to run
      return document.body?.innerText?.length > 0;
    });
    console.log('    Page innerText exists:', hasObserver);

    // Check SW logs
    try {
      const sw = await findServiceWorker(browser);
      if (sw) {
        const worker = await sw.worker();
        const swLog = await worker.evaluate(() => {
          // Return the last few console.log outputs (not directly available)
          // Instead, check the pages store for the 3070-char record
          return 'SW alive';
        });
        console.log('    SW status:', swLog);
      }
    } catch (err) {
      console.log('    SW check failed:', err.message);
    }

    if (pageErrors.length > 0) {
      console.log('    Page JS errors:', pageErrors.slice(0, 5));
    }
    const finalBodyText = await page.evaluate(() => document.body.innerText);
    console.log(`    body.innerText: ${finalBodyText.length} chars, has "${TEST_KEYWORD}": ${finalBodyText.includes(TEST_KEYWORD)}`);

    let allPages = [];
    let searchTermsCount = 0;
    let sampleTerms = [];
    try {
      const sw = await findServiceWorker(browser);
      if (sw) {
        const worker = await sw.worker();
        allPages = await worker.evaluate(async () => {
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
            url: p.url?.substring(0, 100),
            title: p.title,
            textLen: p.textLength,
            hasKeyword: p.text?.includes('queryAllRegion'),
            textPreview: p.text?.substring(0, 150),
          }));
        });

        // Check search-terms store and test tokenize on captured text
        const swInfo = await worker.evaluate(async () => {
          const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('knowsearch-db', 1);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const count = await new Promise((resolve, reject) => {
            const req = db.transaction('search-terms', 'readonly').objectStore('search-terms').count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          // Get all terms
          const sampleReq = db.transaction('search-terms', 'readonly').objectStore('search-terms').getAll();
          const allTerms = await new Promise((resolve, reject) => {
            sampleReq.onsuccess = () => resolve(sampleReq.result);
            sampleReq.onerror = () => reject(sampleReq.error);
          });

          // Get the 3070-char page text and test tokenize
          const pages = await new Promise((resolve, reject) => {
            const req = db.transaction('pages', 'readonly').objectStore('pages').getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const bigPage = pages.find(p => p.textLength > 2000);
          let tokenizeTest = null;
          if (bigPage) {
            // Manual tokenize
            const text = bigPage.text;
            const normalized = text.toLowerCase();
            const segments = normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];
            const tokens = [];
            for (const seg of segments) {
              if (/^[a-z0-9]+$/.test(seg) && seg.length > 1) {
                tokens.push(seg);
              } else if (/^[\u4e00-\u9fff]+$/.test(seg)) {
                for (let i = 0; i < seg.length - 1; i++) {
                  tokens.push(seg.substring(i, i + 2));
                }
              }
            }
            const uniqueTokens = [...new Set(tokens)];
            tokenizeTest = {
              textLen: text.length,
              hasQueryAllRegion: text.includes('queryAllRegion'),
              segmentCount: segments.length,
              tokenCount: uniqueTokens.length,
              sampleTokens: uniqueTokens.filter(t => t.includes('query') || t.includes('all') || t.includes('region')),
              textAroundKeyword: text.includes('queryAllRegion') ? text.substring(Math.max(0, text.indexOf('queryAllRegion') - 50), text.indexOf('queryAllRegion') + 60) : null,
            };
          }

          return {
            count,
            sample: allTerms.slice(0, 10).map(t => ({ term: t.term, pageIds: t.pageIds?.length })),
            hasQueryAllRegion: allTerms.some(t => t.term === 'queryallregion'),
            termsWithQuery: allTerms.filter(t => t.term.includes('query')).map(t => t.term),
            tokenizeTest,
          };
        });
        searchTermsCount = swInfo.count;
        sampleTerms = swInfo.sample;
        console.log(`    Search terms count: ${searchTermsCount}, has 'queryallregion': ${swInfo.hasQueryAllRegion}`);
        console.log('    Terms with "query":', swInfo.termsWithQuery);
        if (swInfo.tokenizeTest) {
          console.log('    Tokenize test:', JSON.stringify(swInfo.tokenizeTest));
        }
        console.log('    Sample terms:', JSON.stringify(sampleTerms));
      }
    } catch (err) {
      console.log('    DB query failed:', err.message);
    }

    const grafanaPages = allPages.filter(p => p.url?.includes('console.his-op'));
    console.log(`    Captured Grafana pages: ${grafanaPages.length}`);
    for (const p of grafanaPages) {
      console.log(`    - [${p.title}] ${p.url}... (${p.textLen} chars, hasKeyword=${p.hasKeyword})`);
      console.log(`      Preview: ${p.textPreview}`);
    }
    // Show all captured pages for debugging
    const otherPages = allPages.filter(p => !p.url?.includes('console.his-op'));
    console.log(`    Other captured pages: ${otherPages.length}`);
    for (const p of otherPages.slice(0, 5)) {
      console.log(`    - [${p.title}] ${p.url}... (${p.textLen} chars)`);
    }

    // Step 6: Search via service worker directly (more reliable than popup)
    console.log('\n[6] Searching via service worker...');
    let searchResult = { ok: false, total: 0, results: [] };
    try {
      const sw = await findServiceWorker(browser);
      if (sw) {
        const worker = await sw.worker();
        searchResult = await worker.evaluate(async (keyword) => {
          try {
            const db = await new Promise((resolve, reject) => {
              const req = indexedDB.open('knowsearch-db', 1);
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            // Direct search in search-terms store
            const terms = keyword.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];
            console.log('Search terms:', terms);
            const tx = db.transaction('search-terms', 'readonly');
            const store = tx.objectStore('search-terms');
            const results = {};
            for (const term of terms) {
              const record = await store.get(term);
              if (record) results[term] = record.pageIds;
              else results[term] = null;
            }
            await tx.done;
            return { ok: true, terms, indexResults: results };
          } catch (err) {
            return { ok: false, error: err.message };
          }
        }, TEST_KEYWORD);
        console.log('    Search index lookup:', JSON.stringify(searchResult));
      } else {
        console.log('    Service worker not found');
      }
    } catch (err) {
      console.log('    Search failed:', err.message);
    }

    // Also try popup search
    let popupSearchResult = { ok: false, total: 0, results: [] };
    try {
      const popupPage = await browser.newPage();
      await popupPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'networkidle2', timeout: 10000 });
      await sleep(500);

      popupSearchResult = await popupPage.evaluate(async (keyword) => {
        try {
          const res = await browser.runtime.sendMessage({
            type: 'searchPages',
            data: { query: keyword, mode: 'keyword', limit: 10 },
          });
          return {
            ok: true,
            total: res.total,
            results: res.results?.map(r => ({ title: r.title, url: r.url?.substring(0, 80) })),
          };
        } catch (err) {
          return { ok: false, total: 0, results: [], error: err.message };
        }
      }, TEST_KEYWORD);
      await popupPage.close();
    } catch (err) {
      console.log('    Popup search failed:', err.message);
    }
    console.log('    Popup search:', popupSearchResult.ok && popupSearchResult.total > 0 ? 'FOUND' : 'NOT FOUND',
      popupSearchResult.error ? `(error: ${popupSearchResult.error})` : `(total=${popupSearchResult.total})`);

    console.log(`    Search result: ${searchResult.ok && searchResult.total > 0 ? 'FOUND' : 'NOT FOUND'} (total=${searchResult.total})`);
    if (searchResult.results?.length > 0) {
      for (const r of searchResult.results) {
        console.log(`    - ${r.title} (${r.url})`);
      }
    }

    // Summary
    const bodyHasKeyword = finalBodyText.includes(TEST_KEYWORD);
    const keywordCaptured = grafanaPages.some(p => p.hasKeyword);
    const searchFound = popupSearchResult.ok && popupSearchResult.total > 0;

    console.log('\n' + '='.repeat(50));
    console.log(`body.innerText has "${TEST_KEYWORD}":`, bodyHasKeyword ? 'YES' : 'NO');
    console.log(`"${TEST_KEYWORD}" in captured data:`, keywordCaptured ? 'YES' : 'NO');
    console.log(`Search finds "${TEST_KEYWORD}":`, searchFound ? 'YES' : 'NO');

    if (bodyHasKeyword && !keywordCaptured) {
      console.log('\nDIAGNOSIS: Page has keyword in innerText but extension did not capture it.');
      console.log('Likely: MutationObserver threshold (50 nodes) not met, or content loaded before extension was ready.');
    }

    const allPass = keywordCaptured && searchFound;
    console.log('\n=== ' + (allPass ? 'ALL PASSED' : 'SOME FAILED') + ' ===');
    process.exit(allPass ? 0 : 1);

  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
