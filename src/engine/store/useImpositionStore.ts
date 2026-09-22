'use client';

import { create } from 'zustand';
import type { Orientation, SheetPresetId } from '@/engine/imposition/specs';
import { millimetresToPoints } from '@/engine/units/convert';
import type { Points } from '@/engine/units/types';
import { millimetres } from '@/engine/units/types';

const mm = (n: number) => millimetresToPoints(millimetres(n));

/**
 * Sheet configuration for imposition and export.
 *
 * Only the inputs live here. The layout itself — columns, rows, N-up, cell
 * rects — is derived by `solveImposition` at render time and never stored:
 * a cached layout and a changed margin is how a preview and a PDF disagree.
 */
type ImpositionState = {
  readonly preset: SheetPresetId;
  readonly orientation: Orientation;
  readonly margin: Points;
  readonly bleed: Points;
  readonly cropMarks: boolean;

  setPreset: (preset: SheetPresetId) => void;
  setOrientation: (orientation: Orientation) => void;
  setMargin: (margin: Points) => void;
  setBleed: (bleed: Points) => void;
  setCropMarks: (on: boolean) => void;
};

export const useImpositionStore = create<ImpositionState>((set) => ({
  preset: 'a4',
  orientation: 'portrait',
  // 10mm clears the unprintable edge on most office and digital presses, and
  // leaves room for crop marks outside the trim.
  margin: mm(10),
  bleed: mm(3),
  cropMarks: true,

  setPreset: (preset) => set({ preset }),
  setOrientation: (orientation) => set({ orientation }),
  setMargin: (margin) => set({ margin }),
  setBleed: (bleed) => set({ bleed }),
  setCropMarks: (cropMarks) => set({ cropMarks }),
}));
