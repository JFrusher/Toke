import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Real font bytes for tests.
 *
 * TTF, deliberately — the SAME files the app serves and the PDF embeds.
 * An earlier version measured against @fontsource's WOFF, which cannot be
 * embedded in a PDF at all; measuring one file and embedding another would
 * void the P5.3 agreement guarantee. Verified identical metrics before
 * switching (zero delta across all three faces).
 *
 * Node-only — never imported by application code.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const PLEX_SANS_REGULAR = `${ROOT}public/fonts/plex-sans-400-normal.ttf`;
export const PLEX_SANS_BOLD = `${ROOT}public/fonts/plex-sans-600-normal.ttf`;
export const PLEX_SANS_ITALIC = `${ROOT}public/fonts/plex-sans-400-italic.ttf`;

export function fontBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}
