import { invoke } from '@tauri-apps/api/core';
import { requestThumbnailBlob } from '../images/thumbnails';
import { native, registerProject } from '../platform/desktop';
import { openLibrary, type LibraryDocument, type LibraryEntry } from './library';

const keyOf = (entry: LibraryEntry) => `${entry.kind}:${entry.id}`;
const pending = new Map<string, { revision: number; work: Promise<number | null> }>();
const backfills = new Map<string, Promise<Blob | null>>();
const failedBackfills = new Map<string, number>();
let backfillTail = Promise.resolve();
let browserCache: Promise<IDBDatabase> | undefined;

function coverDatabase(): Promise<IDBDatabase> {
  if (!browserCache) {
    browserCache = new Promise((resolve, reject) => {
      const request = indexedDB.open('picparty-project-covers', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('covers');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return browserCache;
}

async function readCover(entry: LibraryEntry): Promise<Blob | null> {
  if (native) {
    if (entry.coverRevision == null) return null;
    const response = await invoke<ArrayBuffer | number[]>('library_read_cover', { id: entry.id, kind: entry.kind, revision: entry.coverRevision });
    const bytes = Array.isArray(response) ? Uint8Array.from(response).buffer : response;
    return bytes.byteLength ? new Blob([bytes], { type: 'image/jpeg' }) : null;
  }
  const db = await coverDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('covers').objectStore('covers').get(keyOf(entry));
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error);
  });
}

async function writeCover(entry: LibraryEntry, blob: Blob): Promise<number | null> {
  if (native) {
    return invoke('library_write_cover', {
      id: entry.id, kind: entry.kind, revision: entry.revision,
      jpeg: Array.from(new Uint8Array(await blob.arrayBuffer())),
    });
  }
  const db = await coverDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('covers', 'readwrite');
    transaction.objectStore('covers').put(blob, keyOf(entry));
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
  return entry.revision;
}

/** Sidecar previews are best-effort. Skip intermediate cover jobs when rapid
 * autosaves leave a newer snapshot waiting for the same project. */
export function queueProjectCover(document: LibraryDocument): Promise<number | null> {
  const { entry, project } = document;
  const key = keyOf(entry), previous = pending.get(key);
  if (previous && previous.revision >= entry.revision) return previous.work;
  const work: Promise<number | null> = Promise.resolve(previous?.work).catch(() => null).then(async () => {
    if (pending.get(key)?.work !== work || entry.deletedAt) return null;
    const page = project.pages[0];
    if (!page) return null;
    return writeCover(entry, await requestThumbnailBlob(project, page));
  });
  pending.set(key, { revision: entry.revision, work });
  const cleanup = () => { if (pending.get(key)?.work === work) pending.delete(key); };
  void work.then(cleanup, cleanup);
  return work;
}

export async function loadProjectCover(entry: LibraryEntry): Promise<Blob | null> {
  const saved = await readCover(entry);
  if (saved || !entry.pageCount || entry.deletedAt || failedBackfills.get(keyOf(entry)) === entry.revision) return saved;
  const key = keyOf(entry);
  const existing = backfills.get(key);
  if (existing) return existing;
  // Old entries may contain many pages. Load just one uncached document at
  // a time so scrolling through the library cannot decode a batch at once.
  const work = backfillTail.then(() => backfillCover(entry));
  backfillTail = work.then(() => {}, () => {});
  backfills.set(key, work);
  const cleanup = () => backfills.delete(key);
  void work.then(cleanup, cleanup);
  return work;
}

async function backfillCover(entry: LibraryEntry): Promise<Blob | null> {
  try {
    const existing = pending.get(keyOf(entry));
    if (existing) {
      const revision = await existing.work;
      if (revision !== null) return readCover({ ...entry, coverRevision: revision });
    }
    const document = await openLibrary(entry.id, entry.kind);
    const current = await readCover(document.entry);
    if (current) return current;
    await registerProject(document.project);
    const revision = await queueProjectCover(document);
    if (revision !== null) return readCover({ ...entry, coverRevision: revision });
  } catch {
    // Older library entries may be offline. Retry only after their revision changes.
    failedBackfills.set(keyOf(entry), entry.revision);
  }
  return null;
}
