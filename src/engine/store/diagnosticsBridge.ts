'use client';

import { useDataStore } from '@/engine/store/useDataStore';
import { reportDiagnostic } from '@/engine/store/useDiagnosticsStore';

/**
 * Routes store failures into the diagnostics log.
 *
 * A subscription rather than a `reportDiagnostic` call at each of the ~15
 * places `useDataStore` sets an error: those grow, and the sixteenth would be
 * the one nobody remembers to wire up. Watching the field catches every
 * failure, including ones written after this file.
 */

let installed = false;

export function installDiagnosticsBridge(): void {
  // Idempotent: React 19 runs effects twice in development, and a second
  // subscription would double every entry's count.
  if (installed) return;
  installed = true;

  let lastError = useDataStore.getState().error;
  let lastSourceError = useDataStore.getState().recordSourceError;

  useDataStore.subscribe((state) => {
    if (state.error !== lastError) {
      lastError = state.error;
      if (state.error !== null) reportDiagnostic('database', 'error', state.error);
    }

    if (state.recordSourceError !== lastSourceError) {
      lastSourceError = state.recordSourceError;
      if (state.recordSourceError !== null) {
        reportDiagnostic('record source', 'error', state.recordSourceError);
      }
    }
  });
}
