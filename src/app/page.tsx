'use client';

import { useEffect } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { SmallViewport, useIsSmallViewport } from '@/components/shell/SmallViewport';
import type { AlignEdge } from '@/engine/canvas/arrange';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useDataStore } from '@/engine/store/useDataStore';
import { points } from '@/engine/units/types';
import { isTypingTarget } from '@/lib/dom';

const NUDGE = 1;
const NUDGE_LARGE = 10;

/**
 * Align and distribute, on Ctrl+Shift.
 *
 * CLAUDE.md §4.7 commits to full keyboard operation, and these were toolbar
 * buttons only. Ctrl+Shift keeps them clear of the browser's own Ctrl+letter
 * bindings and of the single-key tool shortcuts.
 */
const ALIGN_KEYS: Record<string, AlignEdge> = {
  l: 'left',
  c: 'centre',
  r: 'right',
  t: 'top',
  m: 'middle',
  b: 'bottom',
};

const TOOL_KEYS: Record<string, 'select' | 'text' | 'rect' | 'ellipse' | 'line'> = {
  v: 'select',
  t: 'text',
  r: 'rect',
  e: 'ellipse',
  l: 'line',
};

/**
 * The client boundary, and nothing else.
 *
 * Layout lives in `AppShell`; this owns only what must be bound to the window
 * itself — the database handle and the global shortcuts.
 */
export default function StudioPage() {
  const openDatabase = useDataStore((s) => s.open);
  const small = useIsSmallViewport();

  useEffect(() => {
    void openDatabase();
  }, [openDatabase]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const store = useCanvasStore.getState();

      // Never steal keys from a text field — typing "r" in a name should not
      // switch to the rectangle tool.
      if (isTypingTarget(event.target)) return;

      // Nor from a resize handle, which owns its own arrow keys.
      if (
        event.target instanceof HTMLElement &&
        event.target.getAttribute('role') === 'separator'
      ) {
        return;
      }

      const modifier = event.ctrlKey || event.metaKey;

      if (modifier && event.shiftKey) {
        const edge = ALIGN_KEYS[event.key.toLowerCase()];
        if (edge !== undefined) {
          event.preventDefault();
          store.align(edge);
          return;
        }
        if (event.key.toLowerCase() === 'h') {
          event.preventDefault();
          store.distribute('horizontal');
          return;
        }
        if (event.key.toLowerCase() === 'v') {
          event.preventDefault();
          store.distribute('vertical');
          return;
        }
      }

      // Bracket keys reorder within the stack, as they do in every layout tool.
      if (modifier && (event.key === '[' || event.key === ']')) {
        event.preventDefault();
        store.reorderSelection(
          event.key === ']'
            ? event.shiftKey
              ? 'front'
              : 'forward'
            : event.shiftKey
              ? 'back'
              : 'backward',
        );
        return;
      }

      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        store.deleteSelection();
        return;
      }

      if (event.key === 'Escape') {
        store.setSelection([]);
        return;
      }

      const step = event.shiftKey ? NUDGE_LARGE : NUDGE;
      const nudges: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = nudges[event.key];
      if (delta !== undefined) {
        event.preventDefault();
        store.nudge(points(delta[0]), points(delta[1]));
        return;
      }

      if (!modifier) {
        const tool = TOOL_KEYS[event.key.toLowerCase()];
        if (tool !== undefined) store.setTool(tool);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Both trees mount the same stores, so the proof shows the current design
  // and data if the window is simply resized.
  return small ? <SmallViewport /> : <AppShell />;
}
