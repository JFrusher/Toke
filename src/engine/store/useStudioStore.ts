import { create } from 'zustand';
import type { StudioMode } from '@/engine/tokens/render';

/**
 * Editing mode and the record cursor.
 *
 * Token Mode shows the template; Live Mode shows one record's values. The
 * cursor is the record being previewed — the Cycle Bar in P7.2 drives it.
 */
type StudioState = {
  readonly mode: StudioMode;
  readonly cursor: number;

  setMode: (mode: StudioMode) => void;
  setCursor: (index: number, total: number) => void;
  step: (delta: number, total: number) => void;
};

export const useStudioStore = create<StudioState>((set, get) => ({
  mode: 'token',
  cursor: 0,

  setMode: (mode) => set({ mode }),

  setCursor(index, total) {
    // Clamped, never wrapped: stepping past the last record should stop at
    // the end rather than silently returning to the first.
    const highest = Math.max(total - 1, 0);
    set({ cursor: Math.min(Math.max(index, 0), highest) });
  },

  step(delta, total) {
    get().setCursor(get().cursor + delta, total);
  },
}));
