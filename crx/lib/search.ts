import { getDatabase, type PageRecord } from './db';
import type { SearchResult, SearchPagesResponse } from './messaging';

// Stop words for English
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'that', 'this', 'was', 'are',
  'be', 'has', 'had', 'have', 'will', 'would', 'could', 'should', 'not',
  'can', 'do', 'did', 'get', 'got', 'its', 'as', 'if', 'so', 'no',
  'de', 'la', 'le', 'les', 'un', 'une', 'des', 'du', 'et',
]);

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const normalized = text.toLowerCase();

  // Split into segments: CJK runs and non-CJK words
  const segments = normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];

  for (const segment of segments) {
    if (/^[a-z0-9]+$/.test(segment)) {
      // English/number token
      if (segment.length > 1 && !STOP_WORDS.has(segment)) {
        tokens.push(segment);
      }
    } else if (/^[\u4e00-\u9fff]+$/.test(segment)) {
      // CJK segment: extract bigrams
      for (let i = 0; i < segment.length - 1; i++) {
        tokens.push(segment.substring(i, i + 2));
      }
    }
  }

  return [...new Set(tokens)];
}

export async function buildSearchIndex(pageId: string, text: string): Promise<void> {
  const db = await getDatabase();
  const terms = tokenize(text);
  const tx = db.transaction('search-terms', 'readwrite');
  const store = tx.objectStore('search-terms');

  for (const term of terms) {
    const existing = await store.get(term);
    if (existing) {
      if (!existing.pageIds.includes(pageId)) {
        existing.pageIds.push(pageId);
        await store.put(existing);
      }
    } else {
      await store.add({ term, pageIds: [pageId] });
    }
  }

  await tx.done;
}

export async function removeFromSearchIndex(pageId: string): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction('search-terms', 'readwrite');
  const store = tx.objectStore('search-terms');

  let cursor = await store.openCursor();
  while (cursor) {
    const record = cursor.value;
    const idx = record.pageIds.indexOf(pageId);
    if (idx !== -1) {
      record.pageIds.splice(idx, 1);
      if (record.pageIds.length === 0) {
        await cursor.delete();
      } else {
        await cursor.update(record);
      }
    }
    cursor = await cursor.continue();
  }

  await tx.done;
}

export async function keywordSearch(query: string, limit: number = 20): Promise<SearchPagesResponse> {
  const db = await getDatabase();
  const queryTerms = tokenize(query);

  if (queryTerms.length === 0) {
    return { results: [], total: 0, mode: 'keyword' };
  }

  // Step 1: Look up each query term in the inverted index
  // Also do prefix matching: if query term is "queryallregion", it should match
  // indexed terms like "queryallregions00000000000000000000000000003464"
  const tx = db.transaction('search-terms', 'readonly');
  const store = tx.objectStore('search-terms');

  const termResults: Map<string, Set<string>> = new Map();

  for (const term of queryTerms) {
    // Exact match
    const record = await store.get(term);
    if (record) {
      termResults.set(term, new Set(record.pageIds));
    } else {
      // Prefix match: scan for indexed terms that start with the query term
      let cursor = await store.openCursor();
      const matchedPageIds = new Set<string>();
      while (cursor) {
        const indexedTerm = cursor.value.term;
        if (indexedTerm.startsWith(term) || indexedTerm.includes(term)) {
          for (const pageId of cursor.value.pageIds) {
            matchedPageIds.add(pageId);
          }
        }
        cursor = await cursor.continue();
      }
      if (matchedPageIds.size > 0) {
        termResults.set(term, matchedPageIds);
      }
    }
  }

  await tx.done;

  if (termResults.size === 0) {
    return { results: [], total: 0, mode: 'keyword' };
  }

  // Step 2: AND logic (intersection)
  const termSets = [...termResults.values()];
  let candidatePageIds: Set<string> = new Set(termSets[0]);
  for (let i = 1; i < termSets.length; i++) {
    candidatePageIds = new Set([...candidatePageIds].filter((id) => termSets[i].has(id)));
  }

  // Fallback to OR if AND yields nothing
  if (candidatePageIds.size === 0) {
    candidatePageIds = new Set();
    for (const set of termSets) {
      for (const id of set) candidatePageIds.add(id);
    }
  }

  // Step 3: Fetch full page records and compute relevance scores
  const pagesTx = db.transaction('pages', 'readonly');
  const pagesStore = pagesTx.objectStore('pages');

  const scoredResults: SearchResult[] = [];

  for (const pageId of candidatePageIds) {
    const page = await pagesStore.get(pageId);
    if (!page) continue;

    const score = computeRelevanceScore(queryTerms, page, termResults);
    scoredResults.push({
      id: page.id,
      url: page.url,
      title: page.title,
      excerpt: page.excerpt,
      favicon: page.favicon,
      firstVisitedAt: page.firstVisitedAt,
      lastVisitedAt: page.lastVisitedAt,
      visitCount: page.visitCount,
      relevanceScore: score,
    });
  }

  await pagesTx.done;

  // Step 4: Sort by relevance and limit
  scoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const limited = scoredResults.slice(0, limit);

  return { results: limited, total: scoredResults.length, mode: 'keyword' };
}

function computeRelevanceScore(
  queryTerms: string[],
  page: PageRecord,
  termResults: Map<string, Set<string>>,
): number {
  let score = 0;

  // Factor 1: Term match in title
  const titleLower = page.title.toLowerCase();
  for (const term of queryTerms) {
    if (titleLower.includes(term)) {
      score += 10;
    }
  }

  // Factor 2: Number of matching terms
  const matchCount = queryTerms.filter((term) => termResults.get(term)?.has(page.id)).length;
  score += matchCount * 5;

  // Factor 3: Recency bonus
  const daysSinceVisit = (Date.now() - page.lastVisitedAt) / (1000 * 60 * 60 * 24);
  if (daysSinceVisit < 1) score += 3;
  else if (daysSinceVisit < 7) score += 2;
  else if (daysSinceVisit < 30) score += 1;

  // Factor 4: Visit count
  if (page.visitCount > 5) score += 2;
  else if (page.visitCount > 2) score += 1;

  return score;
}
