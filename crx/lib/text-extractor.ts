import { Readability } from '@mozilla/readability';

export interface ExtractedContent {
  title: string;
  text: string;
  excerpt: string;
  siteName: string | null;
}

export function extractPageContent(): ExtractedContent | null {
  // Step 1: Try Readability
  const documentClone = document.cloneNode(true) as Document;
  const reader = new Readability(documentClone);
  const article = reader.parse();

  if (article?.textContent && article.textContent.trim().length > 100) {
    const readabilityText = article.textContent.trim();

    // If Readability returned very little content compared to the page,
    // it likely misidentified the content area. Fall back to body.innerText.
    const bodyText = document.body?.innerText?.trim() || '';
    if (bodyText.length > readabilityText.length * 3 && bodyText.length > 200) {
      return {
        title: article.title || document.title,
        text: bodyText,
        excerpt: bodyText.substring(0, 200),
        siteName: article.siteName || null,
      };
    }

    return {
      title: article.title || document.title,
      text: readabilityText,
      excerpt: article.excerpt || '',
      siteName: article.siteName || null,
    };
  }

  // Step 2: Manual fallback — use body.innerText directly
  return extractContentManual();
}

function extractContentManual(): ExtractedContent | null {
  // Use document.body.innerText directly — the browser already excludes
  // script/style content and only returns visible rendered text.
  const body = document.body;
  if (!body) return null;

  const text = body.innerText?.trim() || '';
  if (text.length < 50) return null;

  return {
    title: document.title,
    text,
    excerpt: text.substring(0, 200),
    siteName: null,
  };
}

export function getFaviconUrl(): string | null {
  const link = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');
  if (link?.href) {
    try {
      return new URL(link.href, location.href).href;
    } catch {
      return null;
    }
  }
  return null;
}

export async function computeContentHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
