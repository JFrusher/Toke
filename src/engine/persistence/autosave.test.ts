import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRecovery,
  createAutosave,
  loadRecovery,
  markCleanExit,
  needsRecovery,
  type Snapshot,
} from '@/engine/persistence/autosave';
import { isOk } from '@/lib/result';

function snapshot(name: string): Snapshot {
  return {
    name,
    savedAt: new Date().toISOString(),
    payload: new Uint8Array([1, 2, 3]),
  };
}

beforeEach(async () => {
  // Fake ONLY setTimeout. fake-indexeddb dispatches its request events on
  // real timers/microtasks internally, so faking everything freezes the
  // database and no callback ever fires.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await clearRecovery();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('debounce', () => {
  it('does not write immediately', async () => {
    const write = vi.fn(async () => snapshot('a'));
    const autosave = createAutosave({ produce: write, delayMs: 2000 });

    autosave.schedule();
    expect(write).not.toHaveBeenCalled();
  });

  it('writes once the delay elapses', async () => {
    const write = vi.fn(async () => snapshot('a'));
    const autosave = createAutosave({ produce: write, delayMs: 2000 });

    autosave.schedule();
    await vi.advanceTimersByTimeAsync(2000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst of edits into one write', async () => {
    // Typing in a text object fires a change per keystroke. Writing the whole
    // project to IndexedDB on each one would stall the canvas.
    const write = vi.fn(async () => snapshot('a'));
    const autosave = createAutosave({ produce: write, delayMs: 2000 });

    for (let i = 0; i < 20; i += 1) {
      autosave.schedule();
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(2000);

    expect(write).toHaveBeenCalledTimes(1);
  });

  it('flushes immediately when asked', async () => {
    // Used on blur and on page hide, where waiting out the debounce would
    // lose the last edit.
    const write = vi.fn(async () => snapshot('a'));
    const autosave = createAutosave({ produce: write, delayMs: 2000 });

    autosave.schedule();
    await autosave.flush();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('does not write again on a flush with nothing pending', async () => {
    const write = vi.fn(async () => snapshot('a'));
    const autosave = createAutosave({ produce: write, delayMs: 2000 });

    await autosave.flush();
    expect(write).not.toHaveBeenCalled();
  });

  it('stops writing after dispose', async () => {
    const write = vi.fn(async () => snapshot('a'));
    const autosave = createAutosave({ produce: write, delayMs: 2000 });

    autosave.schedule();
    autosave.dispose();
    await vi.advanceTimersByTimeAsync(5000);

    expect(write).not.toHaveBeenCalled();
  });
});

describe('recovery', () => {
  it('reports nothing to recover on a clean store', async () => {
    expect(await needsRecovery()).toBe(false);
  });

  it('reports a recovery after a write with no clean exit', async () => {
    const autosave = createAutosave({ produce: async () => snapshot('unsaved'), delayMs: 10 });
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(10);

    expect(await needsRecovery()).toBe(true);
  });

  it('reports nothing after a clean exit', async () => {
    // A user who saved and closed properly must not be asked to recover.
    const autosave = createAutosave({ produce: async () => snapshot('saved'), delayMs: 10 });
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(10);

    await markCleanExit();
    expect(await needsRecovery()).toBe(false);
  });

  it('returns the last snapshot written', async () => {
    let counter = 0;
    const autosave = createAutosave({
      produce: async () => {
        counter += 1;
        return snapshot(`version-${counter}`);
      },
      delayMs: 10,
    });

    autosave.schedule();
    await vi.advanceTimersByTimeAsync(10);
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(10);

    const recovered = await loadRecovery();
    if (!isOk(recovered)) throw new Error('expected a snapshot');
    expect(recovered.value.name).toBe('version-2');
  });

  it('preserves the payload bytes', async () => {
    const autosave = createAutosave({ produce: async () => snapshot('a'), delayMs: 10 });
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(10);

    const recovered = await loadRecovery();
    if (!isOk(recovered)) throw new Error('expected a snapshot');
    expect(Array.from(recovered.value.payload)).toEqual([1, 2, 3]);
  });

  it('errors when there is nothing to recover', async () => {
    const recovered = await loadRecovery();
    expect(recovered.ok).toBe(false);
  });

  it('clearRecovery discards the snapshot', async () => {
    const autosave = createAutosave({ produce: async () => snapshot('a'), delayMs: 10 });
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(10);

    await clearRecovery();
    expect(await needsRecovery()).toBe(false);
  });
});

describe('write failures', () => {
  it('does not throw when the producer fails', async () => {
    // A quota error must not take the editor down mid-edit.
    const autosave = createAutosave({
      produce: async () => {
        throw new Error('QuotaExceededError');
      },
      delayMs: 10,
    });

    autosave.schedule();
    await expect(vi.advanceTimersByTimeAsync(10)).resolves.not.toThrow();
  });

  it('reports the failure through onError rather than swallowing it', async () => {
    const onError = vi.fn();
    const autosave = createAutosave({
      produce: async () => {
        throw new Error('QuotaExceededError');
      },
      delayMs: 10,
      onError,
    });

    autosave.schedule();
    await vi.advanceTimersByTimeAsync(10);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ code: 'AUTOSAVE_FAILED' });
  });

  it('keeps working after a failed write', async () => {
    let fail = true;
    const autosave = createAutosave({
      produce: async () => {
        if (fail) throw new Error('transient');
        return snapshot('recovered');
      },
      delayMs: 10,
      onError: () => {},
    });

    autosave.schedule();
    await vi.advanceTimersByTimeAsync(10);

    fail = false;
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(10);

    const recovered = await loadRecovery();
    if (!isOk(recovered)) throw new Error('expected a snapshot');
    expect(recovered.value.name).toBe('recovered');
  });
});
