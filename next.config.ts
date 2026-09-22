import type { NextConfig } from 'next';

/**
 * toke is a client-side application. Vercel hosts static assets and the SSR
 * shell; there is no API surface and no server runtime of our own.
 *
 * Deliberately ABSENT — see CLAUDE.md §9:
 *
 *   Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy
 *     The PRD specified `require-corp` site-wide. That is only needed for
 *     SharedArrayBuffer, which sql.js does not use. Enabling it silently
 *     breaks every cross-origin font and image for no benefit. If we ever
 *     move to OPFS-backed SQLite, revisit this — and expect to host all
 *     assets same-origin when we do.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
