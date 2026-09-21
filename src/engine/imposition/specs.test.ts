import { describe, expect, it } from 'vitest';
import {
  customSheet,
  designSpec,
  printedSize,
  SHEET_PRESETS,
  sheetPreset,
  validateLayout,
} from '@/engine/imposition/specs';
import { millimetresToPoints } from '@/engine/units/convert';
import { millimetres, points } from '@/engine/units/types';
import { isErr, isOk } from '@/lib/result';

const p = points;
const mm = (n: number) => millimetresToPoints(millimetres(n));

describe('sheet presets', () => {
  it('A4 portrait is 595.276 x 841.890pt', () => {
    const sheet = sheetPreset('a4', 'portrait');
    expect(sheet.width).toBeCloseTo(595.276, 3);
    expect(sheet.height).toBeCloseTo(841.89, 3);
  });

  it('A3 portrait is exactly twice A4 on the long edge', () => {
    const a4 = sheetPreset('a4', 'portrait');
    const a3 = sheetPreset('a3', 'portrait');
    expect(a3.width).toBeCloseTo(a4.height, 6);
  });

  it('US Letter is 612 x 792pt exactly', () => {
    const sheet = sheetPreset('letter', 'portrait');
    expect(sheet.width).toBe(612);
    expect(sheet.height).toBe(792);
  });

  it('US Tabloid is 792 x 1224pt exactly', () => {
    const sheet = sheetPreset('tabloid', 'portrait');
    expect(sheet.width).toBe(792);
    expect(sheet.height).toBe(1224);
  });

  it('landscape swaps the axes', () => {
    const portrait = sheetPreset('a4', 'portrait');
    const landscape = sheetPreset('a4', 'landscape');
    expect(landscape.width).toBeCloseTo(portrait.height, 9);
    expect(landscape.height).toBeCloseTo(portrait.width, 9);
  });

  it('exposes every preset with a human label', () => {
    expect(SHEET_PRESETS.map((s) => s.id)).toEqual(['a4', 'a3', 'letter', 'tabloid']);
    for (const preset of SHEET_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });
});

describe('customSheet', () => {
  it('accepts arbitrary dimensions', () => {
    const sheet = customSheet(p(500), p(700));
    expect(sheet).toMatchObject({ id: 'custom', width: 500, height: 700 });
  });
});

describe('designSpec', () => {
  it('holds trim and bleed', () => {
    const design = designSpec({ width: mm(85), height: mm(55), bleed: mm(3) });
    expect(design.trim.width).toBeCloseTo(240.945, 3);
    expect(design.trim.height).toBeCloseTo(155.906, 3);
    expect(design.bleed).toBeCloseTo(8.504, 3);
  });

  it('has no fold by default', () => {
    const design = designSpec({ width: mm(85), height: mm(55), bleed: mm(3) });
    expect(design.fold).toBeUndefined();
    expect(Object.hasOwn(design, 'fold')).toBe(false);
  });
});

describe('printedSize', () => {
  it('equals the trim size for a flat card', () => {
    const design = designSpec({ width: mm(85), height: mm(55), bleed: mm(3) });
    const size = printedSize(design);
    expect(size.width).toBeCloseTo(mm(85), 9);
    expect(size.height).toBeCloseTo(mm(55), 9);
  });

  it('doubles the height for a tent fold', () => {
    // 85 x 55 folds from an 85 x 110 sheet piece.
    const design = designSpec({
      width: mm(85),
      height: mm(55),
      bleed: mm(3),
      fold: { kind: 'tent', axis: 'horizontal' },
    });
    const size = printedSize(design);
    expect(size.width).toBeCloseTo(mm(85), 9);
    expect(size.height).toBeCloseTo(mm(110), 9);
  });
});

describe('validateLayout', () => {
  const a4 = sheetPreset('a4', 'portrait');

  it('accepts a place card on A4', () => {
    const design = designSpec({ width: mm(85), height: mm(55), bleed: mm(3) });
    expect(isOk(validateLayout(a4, design, mm(10)))).toBe(true);
  });

  it('rejects a design wider than the usable sheet, naming both measurements', () => {
    const design = designSpec({ width: mm(250), height: mm(55), bleed: mm(3) });
    const result = validateLayout(a4, design, mm(10));

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('DESIGN_EXCEEDS_SHEET');
      expect(result.error.message).toMatch(/250/);
      expect(result.error.message).toMatch(/190/);
    }
  });

  it('rejects a tent design whose FOLDED height exceeds the sheet', () => {
    // 85 x 150 flat would fit A4; folded it needs 300mm of height and does not.
    const design = designSpec({
      width: mm(85),
      height: mm(150),
      bleed: mm(3),
      fold: { kind: 'tent', axis: 'horizontal' },
    });
    const result = validateLayout(a4, design, mm(10));
    expect(isErr(result)).toBe(true);
  });

  it('rejects a non-positive trim', () => {
    const design = designSpec({ width: p(0), height: mm(55), bleed: mm(3) });
    const result = validateLayout(a4, design, mm(10));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('INVALID_SPEC');
    }
  });

  it('rejects a negative bleed', () => {
    const design = designSpec({ width: mm(85), height: mm(55), bleed: p(-1) });
    const result = validateLayout(a4, design, mm(10));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('INVALID_SPEC');
    }
  });

  it('rejects a margin that consumes the whole sheet', () => {
    const design = designSpec({ width: mm(85), height: mm(55), bleed: mm(3) });
    const result = validateLayout(a4, design, mm(150));
    expect(isErr(result)).toBe(true);
  });

  it('accepts a design that fits exactly with no slack', () => {
    // 190mm usable width with 10mm margins; a 190mm design fits precisely.
    const design = designSpec({ width: mm(190), height: mm(55), bleed: p(0) });
    expect(isOk(validateLayout(a4, design, mm(10)))).toBe(true);
  });
});
