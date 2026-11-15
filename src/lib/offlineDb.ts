import type { DepotDatabaseSnapshot, OfflineQueueItem } from '../types/erp';

const DB_NAME = 'gestdepot_offline_db';
const DB_VERSION = 1;
const STORE_SNAPSHOT = 'snapshot';
const STORE_QUEUE = 'sync_queue';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SNAPSHOT)) {
        db.createObjectStore(STORE_SNAPSHOT, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCachedSnapshot(snapshot: DepotDatabaseSnapshot): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOT, 'readwrite');
      tx.objectStore(STORE_SNAPSHOT).put({ id: 'current', data: snapshot, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback to localStorage if IndexedDB fails in restricted mode
    try {
      localStorage.setItem('gestdepot_snapshot', JSON.stringify(snapshot));
    } catch {
      // ignore
    }
  }
}

export async function loadCachedSnapshot(): Promise<DepotDatabaseSnapshot | null> {
  try {
    const db = await openDb();
    return await new Promise<DepotDatabaseSnapshot | null>((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOT, 'readonly');
      const req = tx.objectStore(STORE_SNAPSHOT).get('current');
      req.onsuccess = () => resolve(req.result?.data ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    try {
      const raw = localStorage.getItem('gestdepot_snapshot');
      return raw ? (JSON.parse(raw) as DepotDatabaseSnapshot) : null;
    } catch {
      return null;
    }
  }
}

export async function getOfflineQueue(): Promise<OfflineQueueItem[]> {
  try {
    const db = await openDb();
    return await new Promise<OfflineQueueItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, 'readonly');
      const req = tx.objectStore(STORE_QUEUE).getAll();
      req.onsuccess = () => resolve((req.result as OfflineQueueItem[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function enqueueOfflineItem(item: OfflineQueueItem): Promise<OfflineQueueItem[]> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    tx.objectStore(STORE_QUEUE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return getOfflineQueue();
}

export async function removeOfflineItems(ids: string[]): Promise<OfflineQueueItem[]> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_QUEUE);
    ids.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return getOfflineQueue();
}

export async function updateOfflineItem(item: OfflineQueueItem): Promise<OfflineQueueItem[]> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    tx.objectStore(STORE_QUEUE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return getOfflineQueue();
}
