import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getBuildInfo } from '@/lib/buildInfo';

/**
 * The /dev pages are tools for building toke, not part of it (DOC-1).
 *
 * Available locally and on preview deployments, where they are useful for
 * checking a change; a 404 in production. The e2e suite runs against the dev
 * server, so /dev/measure stays testable.
 */
export default function DevLayout({ children }: { children: ReactNode }) {
  if (getBuildInfo().env === 'production') notFound();
  return children;
}
