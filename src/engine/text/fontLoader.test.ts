/**
 * @vitest-environment node
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  fontBytes,
  PLEX_SANS_BOLD,
  PLEX_SANS_ITALIC,
  PLEX_SANS_REGULAR,
} from '@/engine/text/fixtures';
import {
  BUNDLED_FONTS,
  clearFonts,
  fontKey,
  getFont,
  loadFont,
  registerFont,
} from '@/engine/text/fontLoader';
import { isErr, isOk } from '@/lib/result';

function load(path: string, meta: Parameters<typeof loadFont>[1] = {}) {
  const result = loadFont(fontBytes(path), meta);
  if (!isOk(result)) throw new Error(result.error.message);
  return result.value;
}

describe('loadFont', () => {
  it('reads the family name from the file, not from the caller', () => {
    // A user renaming a file must not change what the PDF says the font is.
    expect(load(PLEX_SANS_REGULAR).family).toBe('IBM Plex Sans');
  });

  it('exposes units per em', () => {
    expect(load(PLEX_SANS_REGULAR).unitsPerEm).toBe(1000);
  });

  it('exposes ascent and descent in font units', () => {
    const font = load(PLEX_SANS_REGULAR);
    expect(font.ascent).toBeGreaterThan(0);
    // Descent is negative in font units, and staying that way matters:
    // flipping the sign would put every baseline in the wrong place.
    expect(font.descent).toBeLessThan(0);
  });

  it('retains the original bytes for PDF embedding', () => {
    const bytes = fontBytes(PLEX_SANS_REGULAR);
    const font = load(PLEX_SANS_REGULAR);

    expect(font.bytes.byteLength).toBe(bytes.byteLength);
    expect(font.bytes[0]).toBe(bytes[0]);
  });

  it('records the weight and style the caller declares', () => {
    const font = load(PLEX_SANS_BOLD, { weight: 600 });
    expect(font.weight).toBe(600);
    expect(font.italic).toBe(false);
  });

  it('loads an italic face', () => {
    expect(load(PLEX_SANS_ITALIC, { italic: true }).italic).toBe(true);
  });

  it('defaults to weight 400 upright', () => {
    const font = load(PLEX_SANS_REGULAR);
    expect(font).toMatchObject({ weight: 400, italic: false });
  });
});

describe('css family vs file family', () => {
  it('registers a SemiBold face under the family a design references', () => {
    // The real trap: TrueType folds weight into the legacy family, so this
    // file calls itself "IBM Plex Sans SemiBold". A design references
    // "IBM Plex Sans" at weight 600, and lookup must find it.
    const font = load(PLEX_SANS_BOLD, { family: 'IBM Plex Sans', weight: 600 });

    expect(font.family).toBe('IBM Plex Sans SemiBold');
    expect(font.cssFamily).toBe('IBM Plex Sans');
  });

  it('falls back to the file family when none is declared', () => {
    expect(load(PLEX_SANS_REGULAR).cssFamily).toBe('IBM Plex Sans');
  });

  it('finds a registered face by its css family', () => {
    clearFonts();
    registerFont(load(PLEX_SANS_BOLD, { family: 'IBM Plex Sans', weight: 600 }));

    expect(getFont('IBM Plex Sans', 600, false)).not.toBeNull();
    // The legacy name must NOT resolve; that is what was breaking lookup.
    expect(getFont('IBM Plex Sans SemiBold', 600, false)).toBeNull();
    clearFonts();
  });
});

describe('rejection', () => {
  it('rejects bytes that are not a font, with a specific message', () => {
    // Never silently mis-render: a wrong font in a print run is invisible
    // until the cards arrive.
    const result = loadFont(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), {});
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('FONT_UNREADABLE');
    }
  });

  it('rejects an empty file', () => {
    expect(isErr(loadFont(new Uint8Array([]), {}))).toBe(true);
  });

  it('rejects a truncated font rather than loading half of it', () => {
    const truncated = fontBytes(PLEX_SANS_REGULAR).slice(0, 64);
    expect(isErr(loadFont(truncated, {}))).toBe(true);
  });
});

describe('fontKey', () => {
  it('distinguishes family, weight and style', () => {
    expect(fontKey('IBM Plex Sans', 400, false)).not.toBe(fontKey('IBM Plex Sans', 600, false));
    expect(fontKey('IBM Plex Sans', 400, false)).not.toBe(fontKey('IBM Plex Sans', 400, true));
  });

  it('is case insensitive on the family', () => {
    // CSS font matching is case insensitive; a scene node saying "ibm plex
    // sans" must find the registered face.
    expect(fontKey('IBM Plex Sans', 400, false)).toBe(fontKey('ibm plex sans', 400, false));
  });
});

describe('weight fallback', () => {
  const FAMILY = 'IBM Plex Sans';
  const regularOf = () => load(PLEX_SANS_REGULAR, { family: FAMILY, weight: 400 });
  const boldOf = () => load(PLEX_SANS_BOLD, { family: FAMILY, weight: 600 });
  const italicOf = () => load(PLEX_SANS_ITALIC, { family: FAMILY, weight: 400, italic: true });

  beforeEach(() => {
    clearFonts();
  });

  it('prefers an exact match', () => {
    const regular = regularOf();
    const bold = boldOf();
    registerFont(regular);
    registerFont(bold);

    expect(getFont(FAMILY, 600, false)).toBe(bold);
  });

  it('falls back to the nearest weight in the same family', () => {
    // A design built against a font set this build does not ship — weight 500,
    // say — must still measure and print rather than failing at export.
    const regular = regularOf();
    const bold = boldOf();
    registerFont(regular);
    registerFont(bold);

    // 500 is equidistant from 400 and 600; the first registered wins, which
    // is the lighter face and the safer default for a text weight.
    expect(getFont(FAMILY, 500, false)).toBe(regular);

    clearFonts();
    registerFont(bold);
    expect(getFont(FAMILY, 400, false)).toBe(bold);
  });

  it('keeps the slant in preference to the weight', () => {
    const regular = regularOf();
    const italic = italicOf();
    expect(regular).not.toBe(italic);
    registerFont(regular);
    registerFont(italic);

    expect(getFont(FAMILY, 600, true)).toBe(italic);
  });

  it('never substitutes a different family', () => {
    // A different family has unrelated metrics; measuring against one and
    // printing another is the failure this whole module exists to prevent.
    registerFont(regularOf());
    expect(getFont('Helvetica', 400, false)).toBeNull();
  });
});

describe('bundled coverage', () => {
  it('ships every weight the scene graph can ask for', () => {
    // A weight that is offered but not bundled is worse than one that is
    // missing: fontkit falls back to the nearest loaded face and measures
    // THAT, while the browser's CSS matching falls back to a system font with
    // unrelated metrics — so auto-fit passes against one typeface and the
    // canvas draws another. Weight 500 was exactly this bug.
    const upright = BUNDLED_FONTS.filter((entry) => entry.meta.italic !== true).map(
      (entry) => entry.meta.weight,
    );

    for (const weight of [400, 500, 600] as const) {
      expect(upright, `weight ${weight} is offered but not bundled`).toContain(weight);
    }
  });

  it('points every bundled font at a .ttf the app actually serves', () => {
    for (const entry of BUNDLED_FONTS) {
      expect(entry.url).toMatch(/^\/fonts\/.+\.ttf$/);
      expect(existsSync(join(process.cwd(), 'public', entry.url)), entry.url).toBe(true);
    }
  });
});
