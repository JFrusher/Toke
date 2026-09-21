/**
 * @vitest-environment node
 *
 * Reads a file and does arithmetic — no DOM involved. Under jsdom,
 * `import.meta.url` is an http: URL and fileURLToPath rejects it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parsePalette, relativeLuminance } from '@/engine/theme/contrast';

/* Audits the palette as it actually ships: globals.css is read from disk and
   parsed, so a token edited in CSS without updating the audit cannot slip
   through. A parallel TypeScript copy of the palette would test itself. */

const CSS = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8');
const palette = parsePalette(CSS);

const AA_BODY = 4.5;
const AA_LARGE_OR_UI = 3;

/** Surfaces that text is ever set on. The pasteboard is not one — it is the
    empty workspace behind the artboard and never carries copy. */
const TEXT_SURFACES = ['panel', 'panel-raised', 'paper'] as const;

function ratio(fg: string, bg: string): number {
  const f = palette[fg];
  const b = palette[bg];
  if (f === undefined || b === undefined) {
    throw new Error(`palette is missing ${f === undefined ? fg : bg}`);
  }
  return contrastRatio(f, b);
}

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('accepts hex with or without a leading hash, in any case', () => {
    expect(relativeLuminance('FFFFFF')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 6);
  });

  it('is 1:1 for a colour against itself', () => {
    expect(contrastRatio('#3d6b4a', '#3d6b4a')).toBeCloseTo(1, 10);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#1a1815', '#faf8f4')).toBeCloseTo(
      contrastRatio('#faf8f4', '#1a1815'),
      10,
    );
  });
});

describe('parsePalette', () => {
  it('extracts every declared token', () => {
    expect(palette.ink).toBe('#1a1815');
    expect(palette.paper).toBe('#ffffff');
    expect(palette.accent).toBe('#1f3a5f');
  });

  it('ignores non-colour custom properties', () => {
    expect(palette['radius-control']).toBeUndefined();
    expect(palette.duration).toBeUndefined();
  });
});

describe('body text meets WCAG 2.2 AA (4.5:1)', () => {
  const bodyInks = ['ink', 'ink-muted', 'ink-subtle'] as const;

  for (const ink of bodyInks) {
    for (const surface of TEXT_SURFACES) {
      it(`${ink} on ${surface}`, () => {
        expect(ratio(ink, surface)).toBeGreaterThanOrEqual(AA_BODY);
      });
    }
  }
});

describe('semantic state colours meet AA as text', () => {
  // Colour carries meaning here (CLAUDE.md §4.2), so these are read as text
  // and badges, not just painted as fills.
  const semantic = ['accent', 'bound', 'overflow', 'conditional', 'ok'] as const;

  for (const token of semantic) {
    for (const surface of TEXT_SURFACES) {
      it(`${token} on ${surface}`, () => {
        expect(ratio(token, surface)).toBeGreaterThanOrEqual(AA_BODY);
      });
    }
  }
});

describe('control boundaries meet WCAG 1.4.11 (3:1)', () => {
  for (const surface of TEXT_SURFACES) {
    it(`border-control on ${surface}`, () => {
      expect(ratio('border-control', surface)).toBeGreaterThanOrEqual(AA_LARGE_OR_UI);
    });
  }
});

describe('documented exemptions', () => {
  it('ink-disabled is exempt — WCAG excludes disabled controls', () => {
    // Asserted as BELOW the threshold on purpose. If someone "fixes" this by
    // darkening the token, this test fails and forces the conversation:
    // disabled text that meets contrast no longer reads as disabled.
    expect(ratio('ink-disabled', 'panel')).toBeLessThan(AA_BODY);
  });

  it('ink-disabled is lighter than ink-subtle, preserving the hierarchy', () => {
    expect(ratio('ink-disabled', 'panel')).toBeLessThan(ratio('ink-subtle', 'panel'));
  });

  it('decorative hairlines may sit below 3:1', () => {
    expect(ratio('hairline', 'panel')).toBeLessThan(AA_LARGE_OR_UI);
  });

  it('but border-control is meaningfully stronger than a hairline', () => {
    expect(ratio('border-control', 'panel')).toBeGreaterThan(ratio('hairline-strong', 'panel'));
  });
});

describe('the three-tier value structure holds', () => {
  it('the pasteboard is darker than the panels', () => {
    const pasteboard = palette.pasteboard;
    const panel = palette.panel;
    if (pasteboard === undefined || panel === undefined) {
      throw new Error('palette incomplete');
    }
    expect(relativeLuminance(pasteboard)).toBeLessThan(relativeLuminance(panel));
  });

  it('the pasteboard is darker than the artboard', () => {
    const pasteboard = palette.pasteboard;
    const paper = palette.paper;
    if (pasteboard === undefined || paper === undefined) {
      throw new Error('palette incomplete');
    }
    // This is what stops a white card dissolving into light chrome.
    expect(relativeLuminance(pasteboard)).toBeLessThan(relativeLuminance(paper));
  });

  it('the artboard is the only pure white', () => {
    expect(palette.paper).toBe('#ffffff');
    expect(palette.panel).not.toBe('#ffffff');
    expect(palette.pasteboard).not.toBe('#ffffff');
  });

  it('ink tiers descend in contrast', () => {
    expect(ratio('ink', 'panel')).toBeGreaterThan(ratio('ink-muted', 'panel'));
    expect(ratio('ink-muted', 'panel')).toBeGreaterThan(ratio('ink-subtle', 'panel'));
  });
});

describe('light-only by design', () => {
  it('declares no dark-mode block', () => {
    // Strip comments first. The stylesheet *mentions* prefers-color-scheme in
    // a comment explaining why there isn't one, and a naive match on the raw
    // text would fail on the documentation rather than on real config.
    const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutComments).not.toMatch(/prefers-color-scheme/);
  });

  it('still keeps the reduced-motion block, which is not a colour scheme', () => {
    const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutComments).toMatch(/prefers-reduced-motion/);
  });
});
