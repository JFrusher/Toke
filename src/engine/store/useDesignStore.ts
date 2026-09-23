'use client';

import { create } from 'zustand';
import type { EditorDesign } from '@/engine/persistence/project';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useDataStore } from '@/engine/store/useDataStore';
import { points } from '@/engine/units/types';

/**
 * Which design is open, and the ones that are not.
 *
 * A project holds several designs — place cards and menus for the same
 * wedding, sharing one dataset. The `.toke` format has stored an array from
 * day one; until now `toProject` wrote exactly one and `fromProject` read only
 * the first, so a second design could not be created and would have been lost
 * on save if it had.
 *
 * The OPEN design lives in `useCanvasStore` as the live scene. This store
 * holds the others, parked, plus enough identity to write the open one back
 * into the right slot.
 */

type DesignState = {
  readonly designId: string;
  readonly designName: string;
  /** Every design except the open one. */
  readonly others: readonly EditorDesign[];

  /** Replaces the whole set, on opening a project. */
  setDesigns: (input: {
    designId: string;
    designName: string;
    others: readonly EditorDesign[];
  }) => void;
  addDesign: (name: string) => void;
  switchTo: (id: string) => void;
  renameDesign: (id: string, name: string) => void;
  removeDesign: (id: string) => void;
  reset: () => void;
};

const FIRST_ID = 'design-1';

/** The open design, read out of the canvas store. */
function openDesign(id: string, name: string): EditorDesign {
  const canvas = useCanvasStore.getState();
  return {
    id,
    name,
    nodes: canvas.nodes,
    artboard: { width: canvas.artboard.width, height: canvas.artboard.height },
    recordSource: useDataStore.getState().recordSource,
  };
}

/** Loads a parked design into the canvas. */
function open(design: EditorDesign) {
  useCanvasStore.getState().loadScene(design.nodes, {
    x: points(0),
    y: points(0),
    width: points(design.artboard.width),
    height: points(design.artboard.height),
  });
  void useDataStore.getState().setRecordSource(design.recordSource);
}

export const useDesignStore = create<DesignState>((set, get) => ({
  designId: FIRST_ID,
  designName: 'Design 1',
  others: [],

  setDesigns: ({ designId, designName, others }) => set({ designId, designName, others }),

  addDesign(name) {
    const { designId, designName, others } = get();
    // The current design is parked before the canvas is cleared, or the work
    // on screen would be discarded by creating a new one.
    const parked = openDesign(designId, designName);
    const id = `design-${Date.now().toString(36)}`;

    set({ designId: id, designName: name, others: [...others, parked] });

    useCanvasStore.getState().loadScene([], {
      x: points(0),
      y: points(0),
      width: points(parked.artboard.width),
      height: points(parked.artboard.height),
    });
  },

  switchTo(id) {
    const { designId, designName, others } = get();
    if (id === designId) return;

    const target = others.find((design) => design.id === id);
    if (target === undefined) return;

    const parked = openDesign(designId, designName);
    set({
      designId: target.id,
      designName: target.name,
      others: [...others.filter((design) => design.id !== id), parked],
    });
    open(target);
  },

  renameDesign(id, name) {
    const trimmed = name.trim();
    if (trimmed === '') return;

    if (id === get().designId) {
      set({ designName: trimmed });
      return;
    }
    set({
      others: get().others.map((design) =>
        design.id === id ? { ...design, name: trimmed } : design,
      ),
    });
  },

  removeDesign(id) {
    const { designId, others } = get();
    // A project with no designs has nothing to print, so the last one stays.
    if (others.length === 0) return;

    if (id !== designId) {
      set({ others: others.filter((design) => design.id !== id) });
      return;
    }

    const [next, ...rest] = others;
    if (next === undefined) return;
    set({ designId: next.id, designName: next.name, others: rest });
    open(next);
  },

  reset: () => set({ designId: FIRST_ID, designName: 'Design 1', others: [] }),
}));
