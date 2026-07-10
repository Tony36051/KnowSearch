/**
 * Simple typed messaging utilities that work with WXT's browser-polyfill.
 *
 * WXT injects browser-polyfill which wraps chrome.runtime.onMessage/sendMessage
 * with Promise-based semantics. This causes issues with the classic
 * `return true` + `sendResponse` pattern.
 *
 * Solution: Use chrome API directly in background (service worker), and
 * use browser API in content scripts and popup (where polyfill works naturally
 * as a Promise-based interface).
 */

export interface CapturePagePayload {
  url: string;
  title: string;
  text: string;
  excerpt: string;
  siteName: string | null;
  contentHash: string;
  favicon: string | null;
  capturedAt: number;
}

export interface SearchPagesPayload {
  query: string;
  mode: 'keyword' | 'semantic';
  limit?: number;
}

export interface SearchResult {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  favicon: string | null;
  firstVisitedAt: number;
  lastVisitedAt: number;
  visitCount: number;
  relevanceScore: number;
}

export interface SearchPagesResponse {
  results: SearchResult[];
  total: number;
  mode: 'keyword' | 'semantic' | 'fallback';
}

export interface AppSettings {
  pythonServiceUrl: string;
  captureEnabled: boolean;
  excludePatterns: string[];
}

export interface GetPageContentPayload {
  pageId: string;
}

export interface PageContentResponse {
  id: string;
  url: string;
  title: string;
  text: string;
  excerpt: string;
  siteName: string | null;
  favicon: string | null;
  firstVisitedAt: number;
  lastVisitedAt: number;
  visitCount: number;
  textLength: number;
}

export interface GetPageTermsPayload {
  pageId: string;
}

export interface PageTermsResponse {
  terms: string[];
}

export interface StorageEstimateResponse {
  pageRecordSize: number;
  indexTermsSize: number;
  totalDbUsage: number;
  totalDbQuota: number;
}

export interface GetAllPagesResponse {
  pages: PageContentResponse[];
}

export interface StorageStatsResponse {
  pageCount: number;
  termCount: number;
  totalTextLength: number;
  earliestVisitedAt: number;
  latestVisitedAt: number;
  pagesSize: number;
  termsSize: number;
}

/** Internal error marker sent by background onMessage handler */
const MSG_ERROR_KEY = '__knowsearch_error__';

/**
 * Send a message from content script or popup to background.
 * Uses chrome.runtime.sendMessage directly to avoid polyfill issues
 * with async responses in MV3 service workers.
 *
 * The background handler uses sendResponse() to reply. If the handler
 * encounters an error, it sends { [MSG_ERROR_KEY]: string } which we
 * convert to a rejected Promise here.
 */
export function sendMessage<T = unknown>(type: string, data?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && typeof response === 'object' && MSG_ERROR_KEY in response) {
        reject(new Error(response[MSG_ERROR_KEY]));
        return;
      }
      resolve(response as T);
    });
  });
}
