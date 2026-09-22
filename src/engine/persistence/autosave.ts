import { appError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

/**
 * Debounced autosave into IndexedDB, plus crash recovery.
 *
 * A snapshot is written on a delay after the last edit. Writing on every
 * change would push the whole project — database included — through
 * IndexedDB on each keystroke and stall the canvas.
 *
 * Recovery works on a "dirty" flag rather than a heuristic: a snapshot is
 * marked dirty when written and clean only when the user saves or closes
 * properly. Anything else — crash, tab kill, power loss — leaves it dirty and
 * triggers the recovery prompt on next boot.
 */

const DB_NAME = 'toke-recovery';
const DB_VERSION = 1;
const STORE = 'snapshots';
const KEY = 'current';

export type Snapshot = {
  readonly name: string;
  readonly savedAt: string;
  /** A packed .toke file. */
  readonly payload: Uint8Array;
};

type StoredSnapshot = Snapshot & { readonly id: string; readonly dirty: boolean };

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

async function readSnapshot(): Promise<StoredSnapshot | undefined> {
  return run<StoredSnapshot | undefined>('readonly', (store) => store.get(KEY));
}

/** True when the last session ended without a clean exit. */
export async function needsRecovery(): Promise<boolean> {
  const stored = await readSnapshot();
  return stored?.dirty === true;
}

export async function loadRecovery(): Promise<Result<Snapshot>> {
  const stored = await readSnapshot();
  if (stored === undefined) {
    return err(appError('RECOVERY_EMPTY', 'There is nothing to recover.'));
  }

  const { id: _id, dirty: _dirty, ...snapshot } = stored;
  return ok(snapshot);
}

/** Call after a real save, or on a deliberate close. */
export async function markCleanExit(): Promise<void> {
  const stored = await readSnapshot();
  if (stored === undefined) return;
  await run('readwrite', (store) => store.put({ ...stored, dirty: false }));
}

export async function clearRecovery(): Promise<void> {
  await run('readwrite', (store) => store.clear());
}

export type Autosave = {
  /** Restart the debounce. Safe to call on every edit. */
  schedule: () => void;
  /** Write now. Used on blur and page hide, where the debounce would lose
   *  the last edit. */
  flush: () => Promise<void>;
  dispose: () => void;
};

export function createAutosave(options: {
  produce: () => Promise<Snapshot>;
  delayMs?: number;
  onError?: (error: ReturnType<typeof appError>) => void;
}): Autosave {
  const delay = options.delayMs ?? 2000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let disposed = false;

  async function write() {
    pending = false;
    try {
      const snapshot = await options.produce();
      await run('readwrite', (store) => store.put({ ...snapshot, id: KEY, dirty: true }));
    } catch (error) {
      // A quota error must not take the editor down mid-edit, but it must not
      // vanish either — the user needs to know their work is not being saved.
      const message = error instanceof Error ? error.message : String(error);
      options.onError?.(
        appError('AUTOSAVE_FAILED', `Could not autosave: ${message}`, {
          hint: 'Save the project to a file — recovery may not be available.',
        }),
      );
    }
  }

  return {
    schedule() {
      if (disposed) return;
      pending = true;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void write();
      }, delay);
    },

    async flush() {
      if (disposed || !pending) return;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await write();
    },

    dispose() {
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = false;
    },
  };
}
