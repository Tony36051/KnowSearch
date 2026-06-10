import { getDatabase, type PageRecord } from '@/lib/db';
import type { CapturePagePayload, AppSettings, SearchPagesResponse } from '@/lib/messaging';

const MSG_ERROR_KEY = '__knowsearch_error__';
import { keywordSearch, buildSearchIndex } from '@/lib/search';
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
