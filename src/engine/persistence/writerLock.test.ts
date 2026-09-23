/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import { claimWriter, createAutosave } from '@/engine/persistence/autosave';

// Node ships the Web Locks API; jsdom does not, hence the node environment.
// Two claims in one process stand in for two tabs: the lock is per origin.

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('INC-14 — single autosave writer', () => {
  it('makes the first tab the writer', async () => {
    const first = vi.fn();
    const release = claimWriter(first);
    await settle();

    expect(first).toHaveBeenCalledWith(true);
    release();
  });

  it('tells a second tab it is not the writer', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = claimWriter(first);
    await settle();
    const releaseSecond = claimWriter(second);
    await settle();

    expect(second).toHaveBeenCalledWith(false);
    expect(second).not.toHaveBeenCalledWith(true);
    releaseFirst();
    releaseSecond();
  });

  it('hands the lock to the waiting tab when the writer closes', async () => {
    const second = vi.fn();
    const releaseFirst = claimWriter(() => {});
    await settle();
    const releaseSecond = claimWriter(second);
    await settle();

    releaseFirst();
    await settle();

    expect(second).toHaveBeenLastCalledWith(true);
    releaseSecond();
  });

  it('lets a tab that closes while waiting go without taking the lock', async () => {
    const third = vi.fn();
    const releaseFirst = claimWriter(() => {});
    await settle();
    const releaseSecond = claimWriter(() => {});
    await settle();
    releaseSecond();
    const releaseThird = claimWriter(third);
    await settle();

    releaseFirst();
    await settle();

    // The abandoned second claim must not sit in the queue ahead of the third.
    expect(third).toHaveBeenLastCalledWith(true);
    releaseThird();
  });

  it('treats a browser without Web Locks as the writer', () => {
    const onChange = vi.fn();
    claimWriter(onChange, null);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('skips the write while another tab owns the snapshot', async () => {
    const produce = vi.fn(async () => ({
      name: 'a',
      savedAt: '',
      payload: new Uint8Array(),
    }));
    const autosave = createAutosave({ produce, delayMs: 0, canWrite: () => false });

    autosave.schedule();
    await autosave.flush();

    expect(produce).not.toHaveBeenCalled();
  });
});

describe('takeover', () => {
  it('writes edits made while waiting once this tab becomes the writer', async () => {
    let writer = false;
    const produce = vi.fn(async () => ({ name: 'a', savedAt: '', payload: new Uint8Array() }));
    const autosave = createAutosave({ produce, delayMs: 0, canWrite: () => writer });

    autosave.schedule();
    await settle();
    expect(produce).not.toHaveBeenCalled();

    writer = true;
    await autosave.flush();
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('writes nothing on takeover when nothing was edited', async () => {
    const produce = vi.fn(async () => ({ name: 'a', savedAt: '', payload: new Uint8Array() }));
    const autosave = createAutosave({ produce, delayMs: 0, canWrite: () => true });

    await autosave.flush();
    expect(produce).not.toHaveBeenCalled();
  });
});
