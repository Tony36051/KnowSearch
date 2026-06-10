import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'knowsearch-db';
const DB_VERSION = 1;

export interface PageRecord {
  id: string;
  url: string;
  title: string;
  text: string;
  excerpt: string;
  siteName: string | null;
  contentHash: string;
  favicon: string | null;
  firstVisitedAt: number;
  lastVisitedAt: number;
  visitCount: number;
  textLength: number;
}

export interface SearchTermRecord {
  term: string;
  pageIds: string[];
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

interface KnowSearchDB {
  pages: PageRecord;
  'search-terms': SearchTermRecord;
  settings: SettingRecord;
}

let dbInstance: IDBPDatabase<KnowSearchDB> | null = null;

export async function getDatabase(): Promise<IDBPDatabase<KnowSearchDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<KnowSearchDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const pageStore = db.createObjectStore('pages', { keyPath: 'id' });
      pageStore.createIndex('by-url', 'url');
      pageStore.createIndex('by-content-hash', 'contentHash');
      pageStore.createIndex('by-last-visited', 'lastVisitedAt');

      db.createObjectStore('search-terms', { keyPath: 'term' });
      db.createObjectStore('settings', { keyPath: 'key' });
    },
  });

  return dbInstance;
}
