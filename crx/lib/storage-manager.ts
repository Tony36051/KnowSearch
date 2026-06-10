import { getDatabase, type PageRecord } from './db';

const MAX_RECORDS = 10000;
const MAX_TEXT_LENGTH = 50000;
const MAX_AGE_DAYS = 90;
const STORAGE_THRESHOLD = 0.8;

export function truncateText(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? text.substring(0, MAX_TEXT_LENGTH) : text;
}

export async function performStorageCleanup(): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction('pages', 'readwrite');
  const store = tx.objectStore('pages');
  const index = store.index('by-last-visited');

  // Step 1: Delete records older than MAX_AGE_DAYS
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let cursor = await index.openCursor();
  let deletedCount = 0;

  while (cursor) {
    if (cursor.value.lastVisitedAt < cutoff) {
      await cursor.delete();
      deletedCount++;
    }
    cursor = await cursor.continue();
  }

  // Step 2: If still over MAX_RECORDS, delete oldest until under limit
  const totalCount = await store.count();
  if (totalCount > MAX_RECORDS) {
    const toDelete = totalCount - MAX_RECORDS;
    cursor = await index.openCursor();
    let i = 0;
    while (cursor && i < toDelete) {
      await cursor.delete();
      i++;
      cursor = await cursor.continue();
    }
  }

  // Step 3: Check storage quota
  const estimate = await navigator.storage.estimate();
  if (estimate.usage && estimate.quota && estimate.usage / estimate.quota > STORAGE_THRESHOLD) {
    const count = await store.count();
    const toDelete = Math.ceil(count * 0.2);
    cursor = await index.openCursor();
    let i = 0;
    while (cursor && i < toDelete) {
      await cursor.delete();
      i++;
      cursor = await cursor.continue();
    }
  }

  await tx.done;
}
