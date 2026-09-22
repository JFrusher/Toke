// fontkit is CJS: its default export is undefined under Vite's ESM interop,
// so the named export is the only reliable form.
import { create as createFont, type Font, type FontCollection } from 'fontkit';
import type { FontWeight } from '@/engine/scene/types';
import { appError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

/**
 * Parses font bytes once and keeps everything downstream needs.
 *
 * The same LoadedFont serves both consumers: fontkit metrics drive
 * measurement (P5.2) and the retained bytes are embedded into the PDF (P8.6).
 * One parse, one source of truth — measuring against one font and embedding
 * another is how text that fits on screen overflows the trim in print.
 */

export type LoadedFont = {
  /** What the file calls itself. Used for display and PDF naming. */
  readonly family: string;
  /**
   * The family a design references, and the registry key.
   *
   * These differ more often than you would expect. TrueType's name table
   * folds weight into the LEGACY family — this project's SemiBold face calls
   * itself "IBM Plex Sans SemiBold" — while CSS matches on the TYPOGRAPHIC
   * family ("IBM Plex Sans") with weight as a separate axis. Subsetters
   * frequently strip the typographic name records entirely, so the caller
   * must be able to say which family a face belongs to.
   */
  readonly cssFamily: string;
  readonly weight: FontWeight;
  readonly italic: boolean;
  /** Font design units per em — 1000 for CFF, commonly 2048 for TrueType. */
  readonly unitsPerEm: number;
  /** Font units. Positive. */
  readonly ascent: number;
  /** Font units. NEGATIVE — keeping the sign is what puts baselines right. */
  readonly descent: number;
  readonly lineGap: number;
  /** Original bytes, retained for PDF embedding. */
  readonly bytes: Uint8Array;
  /** Parsed font, for glyph layout. */
  readonly parsed: Font;
};

export type FontMeta = {
  readonly weight?: FontWeight;
  readonly italic?: boolean;
  /** CSS family to register under. Defaults to the file's own family name. */
  readonly family?: string;
};

/** Name ID 16 where the font has one; subsetters often strip it. */
function typographicFamily(font: Font): string | null {
  const records = (font as unknown as { name?: { records?: Record<string, unknown> } }).name
    ?.records;
  const preferred = records?.preferredFamily;

  if (typeof preferred === 'string') return preferred;
  if (preferred !== null && typeof preferred === 'object') {
    const values = Object.values(preferred as Record<string, string>);
    return values[0] ?? null;
  }
  return null;
}

function isSingleFont(value: Font | FontCollection): value is Font {
  return 'unitsPerEm' in value && typeof (value as Font).unitsPerEm === 'number';
}

/** Stable lookup key. Case-insensitive on family, as CSS font matching is. */
export function fontKey(family: string, weight: FontWeight, italic: boolean): string {
  return `${family.toLowerCase()}|${weight}|${italic ? 'i' : 'n'}`;
}

export function loadFont(bytes: Uint8Array, meta: FontMeta): Result<LoadedFont> {
  if (bytes.byteLength === 0) {
    return err(appError('FONT_UNREADABLE', 'The font file is empty.'));
  }

  let parsed: Font | FontCollection;
  try {
    // fontkit needs a Buffer-like view; a bare Uint8Array is accepted in node
    // and in the browser once polyfilled by the bundler.
    parsed = createFont(bytes as Parameters<typeof createFont>[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(
      appError('FONT_UNREADABLE', `That file could not be read as a font: ${message}`, {
        hint: 'Supply a TrueType (.ttf) or OpenType (.otf) file.',
      }),
    );
  }

  // fontkit returns a collection for .ttc/.dfont, which has no single set of
  // metrics. Refuse rather than silently picking face zero.
  if (!isSingleFont(parsed)) {
    return err(
      appError('FONT_UNREADABLE', 'That file holds a font collection, not a single font.', {
        hint: 'Export one face and upload that.',
      }),
    );
  }

  return ok({
    // Read from the file, never from the filename: renaming a file must not
    // change what the PDF declares the font to be.
    family: parsed.familyName ?? 'Unknown',
    cssFamily: meta.family ?? typographicFamily(parsed) ?? parsed.familyName ?? 'Unknown',
    weight: meta.weight ?? 400,
    italic: meta.italic ?? false,
    unitsPerEm: parsed.unitsPerEm,
    ascent: parsed.ascent,
    descent: parsed.descent,
    lineGap: parsed.lineGap,
    bytes,
    parsed,
  });
}

/**
 * Registry of loaded faces, so a scene node's `fontFamily` can find the
 * bytes that will be embedded.
 */
const registry = new Map<string, LoadedFont>();

export function registerFont(font: LoadedFont): void {
  registry.set(fontKey(font.cssFamily, font.weight, font.italic), font);
}

export function getFont(family: string, weight: FontWeight, italic: boolean): LoadedFont | null {
  return registry.get(fontKey(family, weight, italic)) ?? null;
}

export function registeredFonts(): readonly LoadedFont[] {
  return [...registry.values()];
}

export function clearFonts(): void {
  registry.clear();
}

/**
 * Hands the SAME bytes to the browser that fontkit measured.
 *
 * This is what makes P5.3's guarantee hold: if the browser rendered a
 * different file — a system fallback, or a Google-hosted copy — its advance
 * widths would diverge from ours and auto-fit would lie.
 */
export async function registerFontFace(font: LoadedFont): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return;

  const face = new FontFace(font.cssFamily, font.bytes as unknown as BufferSource, {
    weight: String(font.weight),
    style: font.italic ? 'italic' : 'normal',
  });

  await face.load();
  document.fonts.add(face);
}

/** Fetches, parses, registers in both fontkit and the browser. */
export async function loadFontFromUrl(url: string, meta: FontMeta): Promise<Result<LoadedFont>> {
  let bytes: Uint8Array;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return err(appError('FONT_UNREADABLE', `Could not fetch ${url}: ${response.status}`));
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(appError('FONT_UNREADABLE', `Could not fetch ${url}: ${message}`));
  }

  const loaded = loadFont(bytes, meta);
  if (!loaded.ok) return loaded;

  registerFont(loaded.value);
  await registerFontFace(loaded.value);
  return loaded;
}

export const PLEX = 'IBM Plex Sans';

/** The faces bundled with the app. */
export const BUNDLED_FONTS: readonly { url: string; meta: FontMeta }[] = [
  // family is declared explicitly: the SemiBold file reports its family as
  // "IBM Plex Sans SemiBold", which is not what a design references.
  { url: '/fonts/plex-sans-400-normal.ttf', meta: { family: PLEX, weight: 400, italic: false } },
  { url: '/fonts/plex-sans-600-normal.ttf', meta: { family: PLEX, weight: 600, italic: false } },
  { url: '/fonts/plex-sans-400-italic.ttf', meta: { family: PLEX, weight: 400, italic: true } },
];

let bootstrap: Promise<void> | null = null;

/** Idempotent: many components need fonts, only one load should happen. */
export function ensureFontsLoaded(): Promise<void> {
  bootstrap ??= Promise.all(
    BUNDLED_FONTS.map((entry) => loadFontFromUrl(entry.url, entry.meta)),
  ).then(() => undefined);
  return bootstrap;
}
