import { keywordSearch } from './search';
import type { SearchPagesResponse } from './messaging';

const DEFAULT_SERVICE_URL = 'http://localhost:8199';

export async function semanticSearch(
  query: string,
  limit: number = 20,
  serviceUrl?: string,
): Promise<SearchPagesResponse> {
  const url = serviceUrl || DEFAULT_SERVICE_URL;

  try {
    const response = await fetch(`${url}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Service returned ${response.status}`);
    }

    const data = await response.json();
    return {
      results: data.results,
      total: data.total,
      mode: 'semantic',
    };
  } catch {
    const fallback = await keywordSearch(query, limit);
    fallback.mode = 'fallback';
    return fallback;
  }
}
