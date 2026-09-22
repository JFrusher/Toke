import { appError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

/**
 * Content-addressed blob store in IndexedDB.
 *
 * Assets are keyed by the SHA-256 of their bytes, so the same logo placed on
 * both sides of a card — or re-uploaded by a user who forgot they already had
 * it — is stored exactly once. Scene nodes hold only this id (CLAUDE.md §2.2):
 * a data URI on a node would be copied into every undo entry and every
 * serialised project.
 */

const DB_NAME = 'toke-assets';
const DB_VERSION = 1;
const STORE = 'assets';

export type AssetRecord = {
  readonly id: string;
  readonly type: string;
  readonly size: number;
  /** Number of scene nodes pointing at this blob. */
  readonly refCount: number;
  readonly createdAt: string;
};

/**
 * Bytes, not a Blob.
 *
 * A Blob does not survive IndexedDB's structured clone intact, and every
 * downstream consumer wants bytes regardless: the .toke packer (P4.2) writes
 * them straight into the zip, and the PDF renderer (P8.4) embeds them in a
 * worker, where a Blob would have to be converted anyway.
 */
export type StoredAsset = AssetRecord & { readonly bytes: Uint8Array };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = body(transaction.objectStore(STORE));

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
        transaction.oncomplete = () => db.close();
      }),
  );
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function addAsset(blob: Blob): Promise<Result<AssetRecord>> {
  if (blob.size === 0) {
    return err(appError('ASSET_INVALID', 'The file is empty.'));
  }

  const bytes = await blob.arrayBuffer();
  const id = await sha256(bytes);

  const existing = await run<StoredAsset | undefined>('readonly', (store) => store.get(id));
  if (existing !== undefined) {
    // Identical bytes: reuse the record rather than writing a second copy.
    const { bytes: _bytes, ...record } = existing;
    return ok(record);
  }

  const record: AssetRecord = {
    id,
    type: blob.type === '' ? 'application/octet-stream' : blob.type,
    size: blob.size,
    refCount: 0,
    createdAt: new Date().toISOString(),
  };

  await run('readwrite', (store) => store.put({ ...record, bytes: new Uint8Array(bytes) }));
  return ok(record);
}

export async function getAsset(id: string): Promise<Result<StoredAsset>> {
  const found = await run<StoredAsset | undefined>('readonly', (store) => store.get(id));

  if (found === undefined) {
    return err(
      appError('ASSET_NOT_FOUND', `No asset with id ${id.slice(0, 12)}…`, {
        hint: 'The project may reference an image that was never saved with it.',
      }),
    );
  }
  return ok(found);
}

export async function listAssets(): Promise<readonly AssetRecord[]> {
  const all = await run<StoredAsset[]>('readonly', (store) => store.getAll());
  return all.map(({ bytes: _bytes, ...record }) => record);
}

async function adjustRefCount(id: string, delta: number): Promise<void> {
  const found = await run<StoredAsset | undefined>('readonly', (store) => store.get(id));
  if (found === undefined) return;

  // Clamped at zero. A double-delete of the same node would otherwise drive
  // the count negative and strand the blob permanently above the GC
  // threshold.
  const refCount = Math.max(0, found.refCount + delta);
  await run('readwrite', (store) => store.put({ ...found, refCount }));
}

export function retainAsset(id: string): Promise<void> {
  return adjustRefCount(id, 1);
}

export function releaseAsset(id: string): Promise<void> {
  return adjustRefCount(id, -1);
}

/** Deletes every asset nothing points at. Returns the ids removed. */
export async function collectGarbage(): Promise<readonly string[]> {
  const all = await run<StoredAsset[]>('readonly', (store) => store.getAll());
  const orphans = all.filter((asset) => asset.refCount <= 0).map((asset) => asset.id);

  for (const id of orphans) {
    await run('readwrite', (store) => store.delete(id));
  }
  return orphans;
}

export async function totalBytes(): Promise<number> {
  const all = await listAssets();
  return all.reduce((total, asset) => total + asset.size, 0);
}

export async function clearAssets(): Promise<void> {
  await run('readwrite', (store) => store.clear());
}

/** Object URL for the canvas, which needs a src rather than bytes. The caller
 *  owns the URL and must revokeObjectURL it. */
export function objectUrlFor(asset: StoredAsset): string {
  return URL.createObjectURL(new Blob([asset.bytes as BlobPart], { type: asset.type }));
}
