import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

/* IBM Plex, not Inter/JetBrains Mono (CLAUDE.md §9). Plex was drawn for
   technical interfaces and holds up at the 11–13px this UI lives at.
   Weights are restricted to the three the design system actually uses —
   every extra weight is a font file on the wire. */

const plexSans = IBM_Plex_Sans({
  variable: '--font-plex-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'toke',
  description: 'Variable data design studio for print.',
};

/* Props are typed explicitly rather than via Next's generated `LayoutProps<"/">`
   helper: that type only exists after a build has written .next/types, which
   would make `npm run typecheck` fail on a clean checkout in CI. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
