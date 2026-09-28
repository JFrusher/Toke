'use client';

import { create } from 'zustand';
import { addAsset, listAssets } from '@/engine/persistence/assetStore';
import { imageKey } from '@/engine/scene/bindings';
import { reportDiagnostic } from '@/engine/store/useDiagnosticsStore';

/**
 * The image library: every named image an image binding can pick.
 *
 * Images keep the file name they arrived with. A record source column holding
 * "veg" or "gf.png" then picks one per row, the same way a text token picks a
 * value — so photos, badges and logos can vary with the data.
 *
 * ponytail: the asset store is per browser, not per project, so a library
 * image from another project is visible here and travels in the next save.
 * Scope assets to a project if that turns out to matter.
 */
type LibraryState = {
  /** `imageKey(name)` → asset id. */
  readonly images: ReadonlyMap<string, string>;
  /** Display names, in the order they arrived. */
  readonly names: readonly string[];
  refresh: () => Promise<void>;
  add: (files: readonly File[]) => Promise<void>;
};

export const useLibraryStore = create<LibraryState>((set, get) => ({
  images: new Map(),
  names: [],

  async refresh() {
    const records = await listAssets();
    const named = records.filter((record) => record.name !== undefined);
    set({
      images: new Map(named.map((record) => [imageKey(record.name ?? ''), record.id])),
      names: named.map((record) => record.name ?? ''),
    });
  },

  async add(files) {
    for (const file of files) {
      const added = await addAsset(file, file.name);
      if (!added.ok) reportDiagnostic('image library', 'error', added.error);
    }
    await get().refresh();
  },
}));
