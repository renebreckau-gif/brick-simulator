// Lokale Ablage des Bildprojekts im Browser (IndexedDB): Bilder als Blob nach Prüfsumme, Entwurfsauftrag
// als JSON. Nichts davon gelangt in Git, in den öffentlichen Build oder in Modell-Exporte.
import type { DesignBrief } from '../../core/design/brief';

/**
 * Datenbankname. Nur im Entwicklungsserver lässt sich mit ?teststore=<name> eine getrennte Ablage wählen,
 * damit Browserprüfungen nie einen laufenden Nutzerentwurf berühren. Im öffentlichen Build gibt es den Schalter nicht.
 */
function dbName(): string {
  if (import.meta.env.DEV) {
    const t = new URLSearchParams(globalThis.location?.search ?? '').get('teststore');
    if (t && /^[a-z0-9-]{1,32}$/.test(t)) return `baustein-design--test-${t}`;
  }
  return 'baustein-design';
}
const DB = dbName();
const DB_VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
      if (!db.objectStoreNames.contains('briefs')) db.createObjectStore('briefs');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(store: 'images' | 'briefs', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => {
      resolve(req.result);
      db.close();
    };
    t.onerror = () => reject(t.error);
  });
}

export const saveBrief = (b: DesignBrief) => tx('briefs', 'readwrite', (s) => s.put(JSON.stringify(b), 'current'));
export async function loadBrief(): Promise<string | null> {
  return ((await tx('briefs', 'readonly', (s) => s.get('current'))) as string | undefined) ?? null;
}
export const saveImage = (sha: string, blob: Blob) => tx('images', 'readwrite', (s) => s.put(blob, sha));
export async function loadImage(sha: string): Promise<Blob | null> {
  return ((await tx('images', 'readonly', (s) => s.get(sha))) as Blob | undefined) ?? null;
}
export const deleteImage = (sha: string) => tx('images', 'readwrite', (s) => s.delete(sha));
/** Räumlicher Entwurf (05B.0) – eigener Schlüssel in derselben lokalen Ablage; der Entwurfsauftrag bleibt unverändert. */
export const saveSpatial = (json: string) => tx('briefs', 'readwrite', (s) => s.put(json, 'spatial'));
export async function loadSpatial(): Promise<string | null> {
  return ((await tx('briefs', 'readonly', (s) => s.get('spatial'))) as string | undefined) ?? null;
}
export const clearAll = async () => {
  await tx('images', 'readwrite', (s) => s.clear());
  await tx('briefs', 'readwrite', (s) => s.clear());
};
