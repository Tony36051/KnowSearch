/**
 * Final validation test for KnowSearch extension.
 * Tests: load, capture, search via popup, error check.
 */
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, '.output/chrome-mv3');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('=== KnowSearch Final Validation ===\n');

  const errors = [];

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run', '--no-default-browser-check',
    ],
  });

  try {
    // 1. Extension loads
    let swTarget = null;
    for (let i = 0; i < 10; i++) {
      const targets = await browser.targets();
      swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension'));
      if (swTarget) break;
      await sleep(1000);
    }
    if (!swTarget) { errors.push('Extension service worker not found'); }
    console.log(`[1] Extension load: ${swTarget ? 'PASS' : 'FAIL'}`);

    const extId = swTarget?.url().match(/chrome-extension:\/\/([a-z]+)/)?.[1];

    // 2. IndexedDB + alarms work
    if (swTarget) {
      const worker = await swTarget.worker();
      const check = await worker.evaluate(async () => {
        try {
          const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('knowsearch-db', 1);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const stores = Array.from(db.objectStoreNames);
          const alarms = await chrome.alarms.getAll();
          return { stores, alarms: alarms.map(a => a.name) };
        } catch (err) {
          return { error: err.message };
        }
      });
      if (check.error) { errors.push('IndexedDB/alarms: ' + check.error); console.log('[2] Background check: FAIL -', check.error); }
      else { console.log(`[2] Background check: PASS (stores: ${check.stores.join(',')}, alarms: ${check.alarms.join(',')})`); }
    }

    // 3. Content script captures page
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    await page.goto('https://jandan.net/', { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('[3] Navigated to jandan.net');
    await sleep(6000);

    if (swTarget) {
      const worker = await swTarget.worker();
      const captureCheck = await worker.evaluate(async () => {
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
        const p = pages.find(p => p.url?.includes('jandan.net'));
        return {
          found: !!p,
          textLen: p?.textLength || 0,
          hasAI: p?.text?.includes('人工智能') || false,
        };
      });
      const ok = captureCheck.found && captureCheck.hasAI;
      if (!ok) errors.push('Content capture failed');
      console.log(`[4] Content capture: ${ok ? 'PASS' : 'FAIL'} (len=${captureCheck.textLen}, hasAI=${captureCheck.hasAI})`);
    }

    // 4. Search works via popup
    if (extId) {
      const popupPage = await browser.newPage();
      const popupErrors = [];
      popupPage.on('pageerror', err => popupErrors.push(err.message));

      await popupPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'networkidle2', timeout: 10000 });
      await sleep(500);

      const searchCheck = await popupPage.evaluate(async () => {
        try {
          const res = await browser.runtime.sendMessage({
            type: 'searchPages',
            data: { query: '人工智能', mode: 'keyword', limit: 10 },
          });
          return { ok: res.total > 0, total: res.total, titles: res.results?.map(r => r.title) };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      });

      if (!searchCheck.ok) errors.push('Search failed: ' + (searchCheck.error || 'no results'));
      console.log(`[5] Search via popup: ${searchCheck.ok ? 'PASS' : 'FAIL'} (total=${searchCheck.total}, titles=${searchCheck.titles?.join(',')})`);

      if (popupErrors.length > 0) {
        for (const e of popupErrors) errors.push('Popup error: ' + e);
        console.log('    Popup JS errors:', popupErrors);
      } else {
        console.log('    Popup JS errors: none');
      }

      await popupPage.close();
    }

    // 5. Check for page JS errors (excluding non-extension 404s)
    const realPageErrors = pageErrors.filter(e => !e.includes('404'));
    if (realPageErrors.length > 0) {
      for (const e of realPageErrors) errors.push('Page error: ' + e);
      console.log(`[6] Page JS errors: ${realPageErrors.join('; ')}`);
    } else {
      console.log('[6] Page JS errors: none');
    }

    // Summary
    console.log('\n' + '='.repeat(40));
    if (errors.length === 0) {
      console.log('ALL CHECKS PASSED');
    } else {
      console.log(`FAILED (${errors.length}):`);
      errors.forEach(e => console.log('  - ' + e));
    }

    process.exit(errors.length > 0 ? 1 : 0);
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error('Runner error:', err); process.exit(1); });
