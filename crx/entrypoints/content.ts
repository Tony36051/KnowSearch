import { extractPageContent, getFaviconUrl, computeContentHash } from '@/lib/text-extractor';
import { sendMessage } from '@/lib/messaging';

const DEBOUNCE_MS = 2000;
const MIN_CAPTURE_INTERVAL_MS = 5000;
const SIGNIFICANT_CHANGE_THRESHOLD = 10;

let currentUrl = location.href;
let lastCaptureTime = 0;
let lastCapturedTextLen = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    setTimeout(() => capturePageContent(), 1000);

    window.addEventListener('popstate', () => checkUrlChange());
    setInterval(checkUrlChange, 1000);

    const observer = new MutationObserver((mutations) => {
      let addedNodeCount = 0;
      for (const mutation of mutations) {
        addedNodeCount += mutation.addedNodes.length;
      }

      if (addedNodeCount < SIGNIFICANT_CHANGE_THRESHOLD) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const now = Date.now();
        if (now - lastCaptureTime >= MIN_CAPTURE_INTERVAL_MS) {
          capturePageContent();
          lastCaptureTime = now;
        }
        debounceTimer = null;
      }, DEBOUNCE_MS);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        capturePageContent();
      }
    });

    // Periodic check for content growth (catches slow-rendering pages like Grafana)
    setInterval(() => {
      const currentLen = document.body?.innerText?.length || 0;
      if (currentLen > lastCapturedTextLen * 1.5 && currentLen > 100) {
        const now = Date.now();
        if (now - lastCaptureTime >= MIN_CAPTURE_INTERVAL_MS) {
          // Content grew significantly, re-capture
          capturePageContent();
        }
      }
    }, 10000);
  },
});

function checkUrlChange() {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    setTimeout(() => capturePageContent(), 1500);
  }
}

async function capturePageContent() {
  const extracted = extractPageContent();
  if (!extracted) return;

  const contentHash = await computeContentHash(extracted.text.substring(0, 500));
  lastCaptureTime = Date.now();
  lastCapturedTextLen = extracted.text.length;

  try {
    await sendMessage('capturePage', {
      url: location.href,
      title: extracted.title,
      text: extracted.text,
      excerpt: extracted.excerpt,
      siteName: extracted.siteName,
      contentHash,
      favicon: getFaviconUrl(),
      capturedAt: Date.now(),
    });
  } catch {
    // Extension context may be invalidated
  }
}
