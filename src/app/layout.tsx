import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'toke',
  description: 'Variable data design studio for print.',
};

/* Props are typed explicitly rather than via Next's generated `LayoutProps<"/">`
   helper: that type only exists after a build has written .next/types, which
   would make `npm run typecheck` fail on a clean checkout in CI. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
