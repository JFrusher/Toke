'use client';

import { useEffect } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useDataStore } from '@/engine/store/useDataStore';
import { points } from '@/engine/units/types';

const NUDGE = 1;
const NUDGE_LARGE = 10;

const TOOL_KEYS: Record<string, 'select' | 'text' | 'rect' | 'ellipse' | 'line'> = {
  v: 'select',
  t: 'text',
  r: 'rect',
  e: 'ellipse',
  l: 'line',
};

/** True when the event came from somewhere the user is typing. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/**
 * The client boundary, and nothing else.
 *
 * Layout lives in `AppShell`; this owns only what must be bound to the window
 * itself — the database handle and the global shortcuts.
 */
export default function StudioPage() {
  const openDatabase = useDataStore((s) => s.open);

  useEffect(() => {
    void openDatabase();
  }, [openDatabase]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const store = useCanvasStore.getState();

      // Never steal keys from a text field — typing "r" in a name should not
      // switch to the rectangle tool.
      if (isTextEntry(event.target)) return;

      // Nor from a resize handle, which owns its own arrow keys.
      if (
        event.target instanceof HTMLElement &&
        event.target.getAttribute('role') === 'separator'
      ) {
        return;
      }

      const modifier = event.ctrlKey || event.metaKey;

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

  return <AppShell />;
}
