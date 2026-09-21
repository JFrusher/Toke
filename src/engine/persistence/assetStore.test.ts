import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addAsset,
  clearAssets,
  collectGarbage,
  getAsset,
  listAssets,
  releaseAsset,
  retainAsset,
  totalBytes,
} from '@/engine/persistence/assetStore';
import { isErr, isOk } from '@/lib/result';

function file(contents: string, type = 'image/png'): Blob {
  return new Blob([contents], { type });
}

async function add(contents: string, type?: string) {
  const result = await addAsset(file(contents, type));
  if (!isOk(result)) throw new Error(result.error.message);
  return result.value;
}

beforeEach(async () => {
  await clearAssets();
});

describe('addAsset', () => {
  it('returns a content hash as the id', async () => {
    const asset = await add('hello');
    // SHA-256 hex.
    expect(asset.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives identical bytes the same id', async () => {
    const first = await add('same bytes');
    const second = await add('same bytes');
    expect(second.id).toBe(first.id);
  });

  it('stores identical bytes exactly once', async () => {
    // The same logo placed on both sides of a card must not double the
    // project file.
    await add('same bytes');
    await add('same bytes');
    expect(await listAssets()).toHaveLength(1);
  });

  it('gives different bytes different ids', async () => {
    const first = await add('one');
    const second = await add('two');
    expect(second.id).not.toBe(first.id);
  });

  it('records size and mime type', async () => {
    const asset = await add('12345', 'image/jpeg');
    expect(asset.size).toBe(5);
    expect(asset.type).toBe('image/jpeg');
  });

  it('rejects an empty blob', async () => {
    const result = await addAsset(new Blob([]));
    expect(isErr(result)).toBe(true);
  });
});

describe('getAsset', () => {
  it('returns the stored bytes as a Uint8Array, not a Blob', async () => {
    const asset = await add('round trip me');
    const found = await getAsset(asset.id);

    if (!isOk(found)) throw new Error('expected the asset back');
    expect(new TextDecoder().decode(found.value.bytes)).toBe('round trip me');
  });

  it('errors for an unknown id', async () => {
    const result = await getAsset('0'.repeat(64));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('ASSET_NOT_FOUND');
  });
});

describe('reference counting', () => {
  it('starts at zero references', async () => {
    const asset = await add('unreferenced');
    const listed = await listAssets();
    expect(listed.find((a) => a.id === asset.id)?.refCount).toBe(0);
  });

  it('counts each retain', async () => {
    const asset = await add('shared');
    await retainAsset(asset.id);
    await retainAsset(asset.id);

    const listed = await listAssets();
    expect(listed.find((a) => a.id === asset.id)?.refCount).toBe(2);
  });

  it('decrements on release', async () => {
    const asset = await add('shared');
    await retainAsset(asset.id);
    await retainAsset(asset.id);
    await releaseAsset(asset.id);

    const listed = await listAssets();
    expect(listed.find((a) => a.id === asset.id)?.refCount).toBe(1);
  });

  it('never drops below zero', async () => {
    // A double-delete of the same node must not make the count negative and
    // strand the blob above the GC threshold forever.
    const asset = await add('shared');
    await retainAsset(asset.id);
    await releaseAsset(asset.id);
    await releaseAsset(asset.id);

    const listed = await listAssets();
    expect(listed.find((a) => a.id === asset.id)?.refCount).toBe(0);
  });
});

describe('collectGarbage', () => {
  it('removes assets with no references', async () => {
    const asset = await add('orphan');
    const removed = await collectGarbage();

    expect(removed).toEqual([asset.id]);
    expect(await listAssets()).toHaveLength(0);
  });

  it('keeps an asset that is still referenced', async () => {
    const asset = await add('kept');
    await retainAsset(asset.id);

    expect(await collectGarbage()).toEqual([]);
    expect(await listAssets()).toHaveLength(1);
  });

  it('keeps an asset while one of two references remains', async () => {
    const asset = await add('two refs');
    await retainAsset(asset.id);
    await retainAsset(asset.id);
    await releaseAsset(asset.id);

    expect(await collectGarbage()).toEqual([]);
  });

  it('collects once the last reference goes', async () => {
    const asset = await add('last ref');
    await retainAsset(asset.id);
    await releaseAsset(asset.id);

    expect(await collectGarbage()).toEqual([asset.id]);
  });
});

describe('totalBytes', () => {
  it('is zero for an empty store', async () => {
    expect(await totalBytes()).toBe(0);
  });

  it('sums stored blobs', async () => {
    await add('12345');
    await add('1234567890');
    expect(await totalBytes()).toBe(15);
  });

  it('counts deduplicated bytes once', async () => {
    await add('12345');
    await add('12345');
    expect(await totalBytes()).toBe(5);
  });
});

describe('durability', () => {
  it('survives a fresh handle to the database', async () => {
    // Proxy for a page reload: the data lives in IndexedDB, not in a module
    // level cache.
    const asset = await add('persist me');
    const found = await getAsset(asset.id);

    if (!isOk(found)) throw new Error('expected the asset back');
    expect(found.value.id).toBe(asset.id);
  });
});
