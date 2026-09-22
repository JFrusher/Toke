/**
 * WCAG 2.2 relative luminance and contrast ratio, plus a parser for the
 * palette declared in `src/app/globals.css`.
 *
 * The parser exists so the contrast audit can read the shipping stylesheet
 * rather than a duplicated TypeScript palette — a duplicate would only ever
 * test itself.
 *
 * Reference: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */

const HEX_COLOUR = /^#?([0-9a-f]{6})$/i;

function channels(hex: string): [number, number, number] {
  const match = HEX_COLOUR.exec(hex.trim());
  if (match === null) {
    throw new Error(`Not a 6-digit hex colour: "${hex}"`);
  }

  const digits = match[1];
  if (digits === undefined) {
    throw new Error(`Not a 6-digit hex colour: "${hex}"`);
  }

  return [
    Number.parseInt(digits.slice(0, 2), 16) / 255,
    Number.parseInt(digits.slice(2, 4), 16) / 255,
    Number.parseInt(digits.slice(4, 6), 16) / 255,
  ];
}

function linearise(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linearise) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Extract `--name: #rrggbb;` declarations. Non-colour custom properties
 * (radii, durations, heights) are skipped rather than returned as junk.
 */
export function parsePalette(css: string): Record<string, string> {
  const palette: Record<string, string> = {};
  const declaration = /--([a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi;

  for (const match of css.matchAll(declaration)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      palette[name] = value.toLowerCase();
    }
  }

  return palette;
}
