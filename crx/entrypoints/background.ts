import { getDatabase, type PageRecord } from '@/lib/db';
import type { CapturePagePayload, AppSettings, SearchPagesResponse, PageContentResponse, PageTermsResponse, StorageEstimateResponse, GetAllPagesResponse, StorageStatsResponse } from '@/lib/messaging';

const MSG_ERROR_KEY = '__knowsearch_error__';
import { keywordSearch, buildSearchIndex, tokenize } from '@/lib/search';
import { performStorageCleanup, truncateText } from '@/lib/storage-manager';

const DEFAULT_SETTINGS: AppSettings = {
  pythonServiceUrl: 'http://localhost:8199',
  captureEnabled: true,
  excludePatterns: [],
};

export default defineBackground(() => {
  // Initialize database
  getDatabase();

  // Use chrome.runtime.onMessage directly with sendResponse + return true
  // to ensure async responses are correctly delivered in MV3 service workers.
  // browser-polyfill's onMessage wrapper can silently resolve(undefined) when
  // the message port closes before the async handler completes.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const err = (e: unknown) => sendResponse({ [MSG_ERROR_KEY]: e instanceof Error ? e.message : String(e) });

    if (message.type === 'capturePage') {
      handleCapturePage(message.data as CapturePagePayload)
        .then(() => sendResponse({ success: true }))
        .catch(err);
      return true;
    }

    if (message.type === 'searchPages') {
      const { query, mode, limit } = message.data as { query: string; mode: string; limit?: number };
      const searchPromise = mode === 'semantic' ? semanticSearch(query, limit || 20) : keywordSearch(query, limit || 20);
      searchPromise
        .then((result) => sendResponse(result))
        .catch(err);
      return true;
    }

    if (message.type === 'getSettings') {
      getSettingsFn()
        .then((result) => sendResponse(result))
        .catch(err);
      return true;
    }

    if (message.type === 'updateSettings') {
      updateSettings(message.data as Partial<AppSettings>)
        .then(() => sendResponse({ success: true }))
        .catch(err);
      return true;
    }

    if (message.type === 'clearAllData') {
      clearAllData()
        .then((result) => sendResponse(result))
        .catch(err);
      return true;
    }

    if (message.type === 'getPageContent') {
      const { pageId } = message.data as { pageId: string };
      getPageContent(pageId)
        .then((result) => sendResponse(result))
        .catch(err);
      return true;
    }

    if (message.type === 'getPageTerms') {
      const { pageId } = message.data as { pageId: string };
      getPageTerms(pageId)
        .then((result) => sendResponse(result))
        .catch(err);
      return true;
    }

    if (message.type === 'getStorageEstimate') {
      const { pageId } = message.data as { pageId: string };
      getStorageEstimate(pageId)
        .then((result) => sendResponse(result))
        .catch(err);
      return true;
    }

    if (message.type === 'getAllPages') {
      getAllPages()
        .then((result) => sendResponse(result))
        .catch(err);
      return true;
    }

    if (message.type === 'getStorageStats') {
      getStorageStats()
        .then((result) => sendResponse(result))
        .catch(err);
      return true;
    }

    if (message.type === 'clearAllData') {
      clearAllData()
        .then((result) => sendResponse(result))
        .catch(err);
      return true;
    }
  });

  // Periodic cleanup
  browser.alarms.create('storage-cleanup', { periodInMinutes: 60 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'storage-cleanup') {
      performStorageCleanup();
    }
  });
});

async function handleCapturePage(data: CapturePagePayload): Promise<void> {
  const db = await getDatabase();
  const text = truncateText(data.text);

  const checkTx = db.transaction('pages', 'readonly');
  const checkIndex = checkTx.objectStore('pages').index('by-url');
  let existingRecords: PageRecord[] = [];
  try {
    existingRecords = await checkIndex.getAll(data.url);
  } catch {
    // Index might not have results
  }
  await checkTx.done;

  const duplicate = existingRecords.find((r) => r.contentHash === data.contentHash);

  if (duplicate) {
    const tx = db.transaction('pages', 'readwrite');
    const store = tx.objectStore('pages');
    duplicate.lastVisitedAt = data.capturedAt;
    duplicate.visitCount += 1;
    await store.put(duplicate);
    await tx.done;
  } else {
    const id = crypto.randomUUID();
    const record: PageRecord = {
      id,
      url: data.url,
      title: data.title,
      text,
      excerpt: data.excerpt,
      siteName: data.siteName,
      contentHash: data.contentHash,
      favicon: data.favicon,
      firstVisitedAt: data.capturedAt,
      lastVisitedAt: data.capturedAt,
      visitCount: 1,
      textLength: text.length,
    };

    const tx = db.transaction('pages', 'readwrite');
    const store = tx.objectStore('pages');
    await store.add(record);
    await tx.done;

    await buildSearchIndex(id, text);
  }
}

async function semanticSearch(query: string, limit: number): Promise<SearchPagesResponse> {
  const settings = await getSettingsFn();
  const serviceUrl = settings.pythonServiceUrl || 'http://localhost:8199';

  try {
    const response = await fetch(`${serviceUrl}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) throw new Error(`Service returned ${response.status}`);

    const data = await response.json();
    return { ...data, mode: 'semantic' as const };
  } catch {
    const fallback = await keywordSearch(query, limit);
    fallback.mode = 'fallback';
    return fallback;
  }
}

async function getSettingsFn(): Promise<AppSettings> {
  const db = await getDatabase();
  const tx = db.transaction('settings', 'readonly');
  const store = tx.objectStore('settings');

  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    const record = await store.get(key);
    if (record) {
      (settings as any)[key] = record.value;
    }
  }

  await tx.done;
  return settings;
}

async function updateSettings(data: Partial<AppSettings>): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction('settings', 'readwrite');
  const store = tx.objectStore('settings');

  for (const [key, value] of Object.entries(data)) {
    await store.put({ key, value });
  }

  await tx.done;
}

async function clearAllData(): Promise<{ pagesDeleted: number; termsDeleted: number }> {
  const db = await getDatabase();

  // Count in readonly transaction
  const countTx = db.transaction(['pages', 'search-terms'], 'readonly');
  const pagesDeleted = await countTx.objectStore('pages').count();
  const termsDeleted = await countTx.objectStore('search-terms').count();
  await countTx.done;

  // Clear in readwrite transaction
  const clearTx = db.transaction(['pages', 'search-terms'], 'readwrite');
  await clearTx.objectStore('pages').clear();
  await clearTx.objectStore('search-terms').clear();
  await clearTx.done;

  return { pagesDeleted, termsDeleted };
}

async function getPageContent(pageId: string): Promise<PageContentResponse | null> {
  const db = await getDatabase();
  const tx = db.transaction('pages', 'readonly');
  const page = await tx.objectStore('pages').get(pageId);
  await tx.done;
  if (!page) return null;
  return {
    id: page.id, url: page.url, title: page.title, text: page.text,
    excerpt: page.excerpt, siteName: page.siteName, favicon: page.favicon,
    firstVisitedAt: page.firstVisitedAt, lastVisitedAt: page.lastVisitedAt,
    visitCount: page.visitCount, textLength: page.textLength,
  };
}

async function getPageTerms(pageId: string): Promise<PageTermsResponse> {
  const db = await getDatabase();
  const tx = db.transaction('pages', 'readonly');
  const page = await tx.objectStore('pages').get(pageId);
  await tx.done;
  if (!page) return { terms: [] };
  return { terms: tokenize(page.text) };
}

async function getStorageEstimate(pageId: string): Promise<StorageEstimateResponse> {
  const db = await getDatabase();

  const pageTx = db.transaction('pages', 'readonly');
  const page = await pageTx.objectStore('pages').get(pageId);
  await pageTx.done;

  let pageRecordSize = 0;
  let indexTermsSize = 0;
  if (page) {
    pageRecordSize += page.text.length * 2;
    pageRecordSize += page.title.length * 2;
    pageRecordSize += page.url.length * 2;
    pageRecordSize += page.excerpt.length * 2;
    pageRecordSize += (page.siteName?.length || 0) * 2;
    pageRecordSize += (page.favicon?.length || 0) * 2;
    pageRecordSize += page.contentHash.length * 2;
    pageRecordSize += page.id.length * 2;
    pageRecordSize += 64;

    const terms = tokenize(page.text);
    indexTermsSize = terms.length * 80; // 每个词项估算：term 字符串 + pageIds 数组 + 行开销
  }

  const estimate = await navigator.storage.estimate();
  return {
    pageRecordSize,
    indexTermsSize,
    totalDbUsage: estimate.usage || 0,
    totalDbQuota: estimate.quota || 0,
  };
}

async function getAllPages(): Promise<GetAllPagesResponse> {
  const db = await getDatabase();
  const tx = db.transaction('pages', 'readonly');
  const store = tx.objectStore('pages');
  const index = store.index('by-last-visited');
  const records = await index.getAll();
  await tx.done;

  // 按 URL 去重：同一 URL 只保留最近访问的记录
  const seen = new Map<string, typeof records[0]>();
  for (const page of records) {
    const existing = seen.get(page.url);
    if (!existing || page.lastVisitedAt > existing.lastVisitedAt) {
      seen.set(page.url, page);
    }
  }

  const pages = [...seen.values()].map((page) => ({
    id: page.id, url: page.url, title: page.title,
    excerpt: page.excerpt, siteName: page.siteName, favicon: page.favicon,
    firstVisitedAt: page.firstVisitedAt, lastVisitedAt: page.lastVisitedAt,
    visitCount: page.visitCount, textLength: page.textLength,
  }));
  return { pages };
}

async function getStorageStats(): Promise<StorageStatsResponse> {
  const db = await getDatabase();

  const pagesTx = db.transaction('pages', 'readonly');
  const pagesStore = pagesTx.objectStore('pages');
  const pageCount = await pagesStore.count();
  let totalTextLength = 0;
  let pagesSize = 0;
  let earliestVisitedAt = Infinity;
  let latestVisitedAt = 0;
  let cursor = await pagesStore.openCursor();
  while (cursor) {
    totalTextLength += cursor.value.textLength;
    // 估算单条页面记录大小：各字符串字段 UTF-16 编码 + 固定开销
    pagesSize += cursor.value.textLength * 2;
    pagesSize += cursor.value.title.length * 2;
    pagesSize += cursor.value.url.length * 2;
    pagesSize += cursor.value.excerpt.length * 2;
    pagesSize += (cursor.value.siteName?.length || 0) * 2;
    pagesSize += (cursor.value.favicon?.length || 0) * 2;
    pagesSize += cursor.value.contentHash.length * 2;
    pagesSize += cursor.value.id.length * 2;
    pagesSize += 64;
    if (cursor.value.lastVisitedAt < earliestVisitedAt) earliestVisitedAt = cursor.value.lastVisitedAt;
    if (cursor.value.lastVisitedAt > latestVisitedAt) latestVisitedAt = cursor.value.lastVisitedAt;
    cursor = await cursor.continue();
  }
  await pagesTx.done;

  const termsTx = db.transaction('search-terms', 'readonly');
  const termsStore = termsTx.objectStore('search-terms');
  const termCount = await termsStore.count();
  let termsSize = 0;
  let termCursor = await termsStore.openCursor();
  while (termCursor) {
    termsSize += termCursor.value.term.length * 2;
    termsSize += termCursor.value.pageIds.length * 80; // UUID + 数组开销
    termsSize += 32; // 行开销
    termCursor = await termCursor.continue();
  }
  await termsTx.done;

  return {
    pageCount,
    termCount,
    totalTextLength,
    earliestVisitedAt: pageCount > 0 ? earliestVisitedAt : 0,
    latestVisitedAt,
    pagesSize,
    termsSize,
  };
}
