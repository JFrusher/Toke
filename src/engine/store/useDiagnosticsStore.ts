'use client';

import { create } from 'zustand';
import type { AppError } from '@/lib/errors';

/**
 * The one place every failure in the app is visible.
 *
 * CLAUDE.md §3 forbids swallowing an error. A local message in a modal
 * satisfies that only while the modal is open — close it and the failure is
 * gone. Entries here outlive the surface that produced them, so "the import
 * said something and I dismissed it" is recoverable.
 *
 * Deliberately capped: a token that fails to resolve fails once per record,
 * and a 500-record run would otherwise push half a million entries into
 * memory to say one thing.
 */

export type Severity = 'error' | 'warning' | 'info';

export type Diagnostic = {
  readonly id: string;
  /** Epoch milliseconds. Formatted at render, never stored formatted. */
  readonly at: number;
  readonly severity: Severity;
  readonly source: string;
  readonly error: AppError;
  /** How many times this same finding has been reported. */
  readonly count: number;
};

const MAX_ENTRIES = 200;

type DiagnosticsState = {
  readonly entries: readonly Diagnostic[];
  report: (source: string, severity: Severity, error: AppError) => void;
  clear: () => void;
  dismiss: (id: string) => void;
};

/**
 * Two reports of the same problem from the same place are one finding.
 *
 * Keyed on the object too: the same overflow code on two different text boxes
 * is two problems, and collapsing them would hide one of them.
 */
function keyOf(source: string, error: AppError): string {
  return `${source}|${error.code}|${error.objectId ?? ''}|${error.message}`;
}

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  entries: [],

  report: (source, severity, error) =>
    set((state) => {
      const key = keyOf(source, error);
      const existing = state.entries.find((entry) => entry.id === key);

      if (existing !== undefined) {
        return {
          entries: state.entries.map((entry) =>
            entry.id === key ? { ...entry, at: Date.now(), count: entry.count + 1 } : entry,
          ),
        };
      }

      const entry: Diagnostic = {
        id: key,
        at: Date.now(),
        severity,
        source,
        error,
        count: 1,
      };

      // Newest first, oldest dropped past the cap.
      return { entries: [entry, ...state.entries].slice(0, MAX_ENTRIES) };
    }),

  clear: () => set({ entries: [] }),
  dismiss: (id) => set((state) => ({ entries: state.entries.filter((e) => e.id !== id) })),
}));

/** Reports from outside React — stores, workers callbacks, effects. */
export function reportDiagnostic(source: string, severity: Severity, error: AppError): void {
  useDiagnosticsStore.getState().report(source, severity, error);
}
