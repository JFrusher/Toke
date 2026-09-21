import { inchesToPoints, millimetresToPoints } from '@/engine/units/convert';
import { inches, millimetres, type Points, points } from '@/engine/units/types';
import { appError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

/**
 * Sheet and design geometry. Everything here is in Points (CLAUDE.md §6);
 * presets are declared in their native unit and converted once.
 */

export type Orientation = 'portrait' | 'landscape';
export type SheetPresetId = 'a4' | 'a3' | 'letter' | 'tabloid';

export type SheetSpec = {
  readonly id: SheetPresetId | 'custom';
  readonly label: string;
  /** Long edge runs vertically in portrait. */
  readonly width: Points;
  readonly height: Points;
};

const mm = (value: number): Points => millimetresToPoints(millimetres(value));
const inch = (value: number): Points => inchesToPoints(inches(value));

/** Portrait dimensions. Landscape is derived by swapping. */
const PRESET_DIMENSIONS: Record<SheetPresetId, { label: string; width: Points; height: Points }> = {
  a4: { label: 'A4 · 210 × 297mm', width: mm(210), height: mm(297) },
  a3: { label: 'A3 · 297 × 420mm', width: mm(297), height: mm(420) },
  letter: { label: 'US Letter · 8.5 × 11in', width: inch(8.5), height: inch(11) },
  tabloid: { label: 'US Tabloid · 11 × 17in', width: inch(11), height: inch(17) },
};

export const SHEET_PRESETS: readonly { id: SheetPresetId; label: string }[] = (
  ['a4', 'a3', 'letter', 'tabloid'] as const
).map((id) => ({ id, label: PRESET_DIMENSIONS[id].label }));

export function sheetPreset(id: SheetPresetId, orientation: Orientation): SheetSpec {
  const preset = PRESET_DIMENSIONS[id];
  const portrait = orientation === 'portrait';

  return {
    id,
    label: preset.label,
    width: portrait ? preset.width : preset.height,
    height: portrait ? preset.height : preset.width,
  };
}

export function customSheet(width: Points, height: Points): SheetSpec {
  return { id: 'custom', label: 'Custom', width, height };
}

/**
 * A tent card is printed at double height and folded across the middle to
 * stand up: an 85 × 55mm finished card comes off an 85 × 110mm piece.
 */
export type FoldSpec = {
  readonly kind: 'tent';
  readonly axis: 'horizontal';
};

export type Size = { readonly width: Points; readonly height: Points };

export type DesignSpec = {
  /** Finished cut size, after folding. */
  readonly trim: Size;
  readonly bleed: Points;
  readonly fold?: FoldSpec;
};

export function designSpec(input: {
  width: Points;
  height: Points;
  bleed: Points;
  fold?: FoldSpec;
}): DesignSpec {
  return {
    trim: { width: input.width, height: input.height },
    bleed: input.bleed,
    ...(input.fold !== undefined ? { fold: input.fold } : {}),
  };
}

/**
 * Space the design occupies on the sheet before cutting — the trim size for a
 * flat card, double height for a tent fold. This, not the trim, is what the
 * imposition solver packs.
 */
export function printedSize(design: DesignSpec): Size {
  if (design.fold?.kind === 'tent') {
    return {
      width: design.trim.width,
      height: points(design.trim.height * 2),
    };
  }
  return design.trim;
}

function invalidSpec(message: string, hint?: string) {
  return appError('INVALID_SPEC', message, hint === undefined ? undefined : { hint });
}

/**
 * Check a design can be placed on a sheet at all. The solver assumes this has
 * passed; it reports layout results, not configuration errors.
 */
export function validateLayout(sheet: SheetSpec, design: DesignSpec, margin: Points): Result<true> {
  if (design.trim.width <= 0 || design.trim.height <= 0) {
    return err(invalidSpec('Trim size must be greater than zero on both axes.'));
  }

  if (design.bleed < 0) {
    return err(invalidSpec('Bleed cannot be negative.'));
  }

  if (margin < 0) {
    return err(invalidSpec('Sheet margin cannot be negative.'));
  }

  const usableWidth = sheet.width - margin * 2;
  const usableHeight = sheet.height - margin * 2;

  if (usableWidth <= 0 || usableHeight <= 0) {
    return err(
      invalidSpec(
        'Sheet margins leave no usable area.',
        'Reduce the margin or choose a larger sheet.',
      ),
    );
  }

  // Validate the PRINTED size, not the trim: a tent card needs double the
  // height, and checking the trim would pass a design that cannot be imposed.
  const printed = printedSize(design);

  if (printed.width > usableWidth || printed.height > usableHeight) {
    const fmt = (value: number) => (value / millimetresToPoints(millimetres(1))).toFixed(1);
    return err(
      appError(
        'DESIGN_EXCEEDS_SHEET',
        `Design is ${fmt(printed.width)} × ${fmt(printed.height)}mm but only ` +
          `${fmt(usableWidth)} × ${fmt(usableHeight)}mm is usable on this sheet.`,
        {
          hint:
            design.fold === undefined
              ? 'Use a larger sheet, or reduce the margin.'
              : 'A tent fold needs double the finished height.',
        },
      ),
    );
  }

  return ok(true);
}
