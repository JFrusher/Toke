'use client';

import { create } from 'zustand';
import { loadFont, registerFont, registerFontFace } from '@/engine/text/fontLoader';
import type { AppError } from '@/lib/errors';
import { err, isErr, ok, type Result } from '@/lib/result';

/**
 * User-supplied typefaces.
 *
 * The registry in `engine/text/fontLoader` is a module-level map, deliberately:
 * it is read from the render path and from a worker, neither of which should
 * depend on React. But a map cannot tell React that a font arrived, so this
 * store keeps the bytes for saving and a version counter for re-rendering.
 */

export type UploadedFont = {
  readonly family: string;
  readonly bytes: Uint8Array;
};

type FontState = {
  /** Uploaded faces only. Bundled ones are always available and never saved. */
  readonly uploaded: readonly UploadedFont[];
  /** Bumped on every change, so components subscribed to it re-read the registry. */
  readonly version: number;

  addFont: (file: File) => Promise<Result<UploadedFont>>;
  /** Restores fonts carried inside a `.toke` on open. */
  loadFonts: (fonts: readonly UploadedFont[]) => Promise<void>;
  reset: () => void;
};

async function install(family: string, bytes: Uint8Array): Promise<Result<UploadedFont>> {
  const loaded = loadFont(bytes, { family });
  if (isErr(loaded)) return err(loaded.error);

  registerFont(loaded.value);
  // The browser is handed the SAME bytes fontkit parsed, which is what keeps
  // the canvas and the PDF measuring one file (CLAUDE.md §2.1 rule 3).
  await registerFontFace(loaded.value);

  return ok({ family: loaded.value.cssFamily, bytes });
}

export const useFontStore = create<FontState>((set, get) => ({
  uploaded: [],
  version: 0,

  async addFont(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Named from the file, since a user font's own family name is often a
    // foundry string nobody recognises.
    const family = file.name.replace(/\.[^.]+$/, '');

    const installed = await install(family, bytes);
    if (isErr(installed)) return installed;

    set((state) => ({
      uploaded: [
        ...state.uploaded.filter((font) => font.family !== installed.value.family),
        installed.value,
      ],
      version: state.version + 1,
    }));

    return installed;
  },

  async loadFonts(fonts) {
    const restored: UploadedFont[] = [];
    for (const font of fonts) {
      const installed = await install(font.family, font.bytes);
      if (!isErr(installed)) restored.push(installed.value);
    }
    set((state) => ({ uploaded: restored, version: state.version + 1 }));
  },

  reset: () => set({ uploaded: [], version: get().version + 1 }),
}));

/** The uploaded faces, for packing into a `.toke`. */
export function fontsForProject(): readonly UploadedFont[] {
  return useFontStore.getState().uploaded;
}

/** Shape of an error surfaced from a failed upload. */
export type FontError = AppError;
