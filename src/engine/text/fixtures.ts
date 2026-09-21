import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Real font bytes for tests.
 *
 * @fontsource ships WOFF rather than TTF. fontkit reads it and reports the
 * same metrics either way, which is all the measurement tests need. PDF
 * embedding (P8.6) requires TTF/OTF and will need its own fixture.
 *
 * Node-only — never imported by application code.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const PLEX_SANS_REGULAR = `${ROOT}node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff`;
export const PLEX_SANS_BOLD = `${ROOT}node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff`;
export const PLEX_SANS_ITALIC = `${ROOT}node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-italic.woff`;

export function fontBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}
