/**
 * 验证脚本：确认 history 页面的 IntersectionObserver「加载更多」真实生效。
 *
 * 与 test-integration-history.mjs 不同，本脚本【不使用】 window.__knowsearch_loadMore
 * 测试桥，而是仅通过 scrollIntoView 让 .load-more 哨兵真实进入视口，依赖
 * IntersectionObserver 自身回调触发 visibleCount 增长。
 *
 * 用法：
 *   cd crx && pnpm build
 *   node test-verify-loadmore.mjs
 */
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, '.output/chrome-mv3');
const TEST_RECORD_COUNT = 25;
const PAGE_SIZE = 20;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function setupBrowser() {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  let swTarget = null;
  for (let i = 0; i < 10; i++) {
    const targets = await browser.targets();
    swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension'));
    if (swTarget) break;
    await sleep(1000);
  }
  if (!swTarget) throw new Error('Extension service worker not found');
  const extId = swTarget.url().match(/chrome-extension:\/\/([a-z]+)/)?.[1];
  if (!extId) throw new Error('Could not extract extension ID');
  const worker = await swTarget.worker();
  return { browser, extId, worker };
}

async function injectTestData(worker, count) {
  await worker.evaluate(async (n) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('knowsearch-db', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('pages', 'readwrite');
    const store = tx.objectStore('pages');
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      store.put({
        id: `test-page-${i}`,
        url: `https://example.com/test-page-${i}`,
        title: `验证页面 ${i}`,
        text: `第 ${i} 个验证页面正文`.repeat(5),
        excerpt: `第 ${i} 个验证页面摘要`,
        siteName: null,
        contentHash: `test-hash-${i}`,
        favicon: null,
        firstVisitedAt: now - i * 3600000,
        lastVisitedAt: now - i * 3600000,
        visitCount: 1,
        textLength: 100,
      });
    }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
  }, count);
}

async function cleanupTestData(worker) {
  await worker.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('knowsearch-db', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('pages', 'readwrite');
    const store = tx.objectStore('pages');
    const all = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const page of all) {
      if (page.id.startsWith('test-page-')) store.delete(page.id);
    }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
  });
}

async function main() {
  console.log('=== 验证 history 页 IntersectionObserver 真实触发 ===\n');
  const { browser, extId, worker } = await setupBrowser();
  let historyPage = null;
  try {
    console.log(`注入 ${TEST_RECORD_COUNT} 条测试数据...`);
    await injectTestData(worker, TEST_RECORD_COUNT);

    historyPage = await browser.newPage();
    // 诊断：记录所有 IntersectionObserver.observe 的目标，确认哨兵是否被 observe
    await historyPage.evaluateOnNewDocument(() => {
      window.__ioObserved = [];
      const orig = IntersectionObserver.prototype.observe;
      IntersectionObserver.prototype.observe = function (target) {
        try { window.__ioObserved.push(target?.className || target?.tagName || String(target)); } catch {}
        return orig.call(this, target);
      };
    });
    await historyPage.goto(`chrome-extension://${extId}/history.html`, { waitUntil: 'networkidle2', timeout: 10000 });
    await historyPage.waitForSelector('.page-item', { timeout: 5000 });
    await sleep(300);

    let itemCount = await historyPage.evaluate(() => document.querySelectorAll('.page-item').length);
    assert.strictEqual(itemCount, PAGE_SIZE, `初始应显示 ${PAGE_SIZE} 条，实际 ${itemCount}`);
    console.log(`  ✓ 初始 .page-item 数量 = ${itemCount}`);

    const hasLoadMore = await historyPage.evaluate(() => !!document.querySelector('.load-more'));
    assert.ok(hasLoadMore, '初始应存在 .load-more 哨兵');
    console.log('  ✓ .load-more 哨兵存在');

    const ioObserved = await historyPage.evaluate(() => window.__ioObserved);
    console.log(`  [诊断] IntersectionObserver.observe 被调用的目标: ${JSON.stringify(ioObserved)}`);

    // 关键：不调用 test bridge，仅通过真实滚动让哨兵进入视口，依赖 IntersectionObserver 自身触发
    await historyPage.evaluate(() => {
      const el = document.querySelector('.load-more');
      if (el) el.scrollIntoView({ block: 'end' });
    });
    // 轮询检查 itemCount 是否由 IntersectionObserver 回调推动增长（不用 waitForFunction 以避免 DOM 持续 mutation 期间的偶发超时）
    let finalCount = 0;
    for (let i = 0; i < 15; i++) {
      await sleep(200);
      finalCount = await historyPage.evaluate(() => document.querySelectorAll('.page-item').length);
      if (finalCount === TEST_RECORD_COUNT) break;
    }
    assert.strictEqual(finalCount, TEST_RECORD_COUNT, `IntersectionObserver 触发后应为 ${TEST_RECORD_COUNT} 条，实际 ${finalCount}`);
    console.log(`  ✓ IntersectionObserver 真实触发：${PAGE_SIZE} -> ${finalCount}（未使用 test bridge）`);

    const hasLoadMoreAfter = await historyPage.evaluate(() => !!document.querySelector('.load-more'));
    assert.strictEqual(hasLoadMoreAfter, false, '全部加载完后 .load-more 应消失');
    console.log('  ✓ .load-more 已消失（全部加载完）');

    console.log('\n=== 验证通过：IntersectionObserver 正常工作 ===');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ 验证失败:', err.message);
    process.exit(1);
  } finally {
    try {
      if (historyPage) await historyPage.close();
      await cleanupTestData(worker);
    } catch { /* best effort */ }
    await browser.close();
  }
}

main().catch(err => { console.error('Runner error:', err); process.exit(1); });
