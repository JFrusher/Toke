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

        // Settled on the TRANSACTION, not the request. Chrome checks quota at
        // commit: the put succeeds, then the transaction aborts with
        // QuotaExceededError. Resolving on request success reported a full
        // disk as a saved snapshot (VER-6).
        transaction.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        transaction.onabort = () => {
          db.close();
          reject(
            transaction.error ??
              request.error ??
              new DOMException('The snapshot write was aborted.', 'AbortError'),
          );
        };
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

const WRITER_LOCK = 'toke-autosave-writer';

/**
 * INC-14 — one writer per browser profile.
 *
 * Every tab shares the one recovery snapshot, so two tabs autosaving means the
 * last write wins and the other tab's work is silently gone from recovery. The
 * first tab holds a Web Lock for its lifetime; later tabs queue behind it and
 * take over when it closes. The lock is released by the browser when a tab
 * dies, so a crash cannot leave the snapshot orphaned.
 *
 * `onChange(false)` fires once when another tab already writes, `onChange(true)`
 * when this tab becomes the writer. Returns the release.
 */
export function claimWriter(
  onChange: (writer: boolean) => void,
  locks: LockManager | null = globalThis.navigator?.locks ?? null,
): () => void {
  // No Web Locks (very old browser): behave as before, one tab writing.
  if (locks === null) {
    onChange(true);
    return () => {};
  }

  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const abort = new AbortController();

  // Hold until released: the lock lasts as long as the callback's promise.
  const hold = () => {
    onChange(true);
    return held;
  };

  void locks
    .request(WRITER_LOCK, { ifAvailable: true }, (lock) => {
      if (lock !== null) return hold();
      onChange(false);
      // ifAvailable and signal cannot be combined, so the queued request is a
      // second call. Aborting it on release rejects its promise, which is the
      // expected end of a tab that never got to write.
      locks.request(WRITER_LOCK, { signal: abort.signal }, hold).catch((error: unknown) => {
        if (!abort.signal.aborted) throw error;
      });
      return undefined;
    })
    .catch((error: unknown) => {
      if (!abort.signal.aborted) throw error;
    });

  return () => {
    abort.abort();
    release();
  };
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
  /** False while another tab owns the snapshot; see `claimWriter`. */
  canWrite?: () => boolean;
  onError?: (error: ReturnType<typeof appError>) => void;
}): Autosave {
  const delay = options.delayMs ?? 2000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let disposed = false;

  async function write() {
    // Stays pending while another tab writes, so flush() on takeover writes
    // the edits made while waiting — and writes nothing if there were none.
    if (options.canWrite?.() === false) return;
    pending = false;
    try {
      const snapshot = await options.produce();
      await run('readwrite', (store) => store.put({ ...snapshot, id: KEY, dirty: true }));
    } catch (error) {
      // A quota error must not take the editor down mid-edit, but it must not
      // vanish either — the user needs to know their work is not being saved.
      // Browsers word the quota message differently; the name is the contract,
      // and "storage is full" tells the user what to do about it.
      // Not `instanceof Error`: DOMException is not an Error in every runtime.
      const full = error instanceof DOMException && error.name === 'QuotaExceededError';
      const message = error instanceof Error ? error.message : String(error);
      options.onError?.(
        appError(
          'AUTOSAVE_FAILED',
          full ? 'Could not autosave: browser storage is full.' : `Could not autosave: ${message}`,
          {
            hint: 'Save the project to a file — recovery may not be available.',
          },
        ),
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
