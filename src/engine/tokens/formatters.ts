/**
 * Token formatters. Pure string functions, applied left to right.
 *
 * Deliberately few. Every formatter is a thing a user must learn, and the
 * four here cover what stationery actually needs.
 */

/**
 * Word boundaries for title case: whitespace, hyphen and apostrophe.
 *
 * The apostrophe matters — "O'brien" is wrong on a place card and O'Brien is
 * a surname real guests have. So is Mary-Jane.
 */
const WORD_START = /(^|[\s'’-])([a-z])/g;

export const FORMATTERS = {
  upper: (value: string) => value.toUpperCase(),
  lower: (value: string) => value.toLowerCase(),
  trim: (value: string) => value.trim(),
  title: (value: string) =>
    // Lowercase first so a SHOUTED cell becomes Title Case rather than
    // staying shouted.
    value.toLowerCase().replace(WORD_START, (_match, boundary: string, letter: string) => {
      return boundary + letter.toUpperCase();
    }),
} as const satisfies Record<string, (value: string) => string>;

export type FormatterName = keyof typeof FORMATTERS;

export function applyFormatters(value: string, names: readonly string[]): string {
  let result = value;
  for (const name of names) {
    const formatter = FORMATTERS[name as FormatterName];
    if (formatter !== undefined) result = formatter(result);
  }
  return result;
}
