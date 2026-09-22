'use client';

import { ImageImport } from '@/components/canvas/ImageImport';
import { CycleBar } from '@/components/preview/CycleBar';
import { Button } from '@/components/ui/Button';
import type { AlignEdge } from '@/engine/canvas/arrange';
import { type Tool, useCanvasStore } from '@/engine/store/useCanvasStore';
import { useStudioStore } from '@/engine/store/useStudioStore';
import { cn } from '@/lib/cn';

const TOOLS: readonly { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Select', key: 'V' },
  { id: 'text', label: 'Text', key: 'T' },
  { id: 'rect', label: 'Rectangle', key: 'R' },
  { id: 'ellipse', label: 'Ellipse', key: 'E' },
  { id: 'line', label: 'Line', key: 'L' },
];

const ALIGNMENTS: readonly { edge: AlignEdge; label: string }[] = [
  { edge: 'left', label: 'Align left' },
  { edge: 'centre', label: 'Align centre' },
  { edge: 'right', label: 'Align right' },
  { edge: 'top', label: 'Align top' },
  { edge: 'middle', label: 'Align middle' },
  { edge: 'bottom', label: 'Align bottom' },
];

export function CanvasToolbar({ onPreflight }: { onPreflight: () => void }) {
  const tool = useCanvasStore((s) => s.tool);
  const setTool = useCanvasStore((s) => s.setTool);
  const zoom = useCanvasStore((s) => s.zoom);
  const setZoom = useCanvasStore((s) => s.setZoom);
  const canUndo = useCanvasStore((s) => s.canUndo);
  const canRedo = useCanvasStore((s) => s.canRedo);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const align = useCanvasStore((s) => s.align);
  const distribute = useCanvasStore((s) => s.distribute);
  const reorderSelection = useCanvasStore((s) => s.reorderSelection);
  const group = useCanvasStore((s) => s.group);
  const ungroup = useCanvasStore((s) => s.ungroup);
  const snapEnabled = useCanvasStore((s) => s.snapEnabled);
  const setSnapEnabled = useCanvasStore((s) => s.setSnapEnabled);
  const selectionCount = useCanvasStore((s) => s.selection.length);

  const mode = useStudioStore((s) => s.mode);
  const setMode = useStudioStore((s) => s.setMode);

  return (
    <div className="flex shrink-0 items-center gap-1 border-hairline-strong border-b bg-panel px-2 py-1.5">
      {/* A real fieldset rather than role="group" on a div: the label is
          useful to a screen reader, and the native element carries it. */}
      <fieldset className="flex items-center gap-0.5 border-0 p-0">
        <legend className="sr-only">Mode</legend>
        {(['token', 'live'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            data-testid={`mode-${value}`}
            onClick={() => setMode(value)}
            className={cn(
              'h-7 rounded-[2px] border px-2 text-[12px] font-medium transition-colors duration-[120ms]',
              'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1',
              mode === value
                ? 'border-accent bg-accent text-paper'
                : 'border-transparent text-ink-muted hover:bg-accent-weak hover:text-ink',
            )}
          >
            {value === 'token' ? 'Token' : 'Live'}
          </button>
        ))}
      </fieldset>

      {mode === 'live' && <CycleBar />}

      <span className="mx-1 h-5 w-px bg-hairline-strong" />
      <div role="toolbar" aria-label="Tools" className="flex items-center gap-0.5">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={tool === entry.id}
            title={`${entry.label} (${entry.key})`}
            data-testid={`tool-${entry.id}`}
            onClick={() => setTool(entry.id)}
            className={cn(
              'h-7 rounded-[2px] border px-2 text-[12px] font-medium transition-colors duration-[120ms]',
              'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1',
              tool === entry.id
                ? 'border-accent bg-accent text-paper'
                : 'border-transparent text-ink-muted hover:bg-accent-weak hover:text-ink',
            )}
          >
            {entry.label}
          </button>
        ))}
        {/* Not in TOOLS: an image already has a size and an aspect ratio, so
            it is placed from a file picker rather than drawn as a box. */}
        <ImageImport />
      </div>

      <span className="mx-1 h-5 w-px bg-hairline-strong" />

      <Button variant="quiet" disabled={!canUndo} onClick={undo} data-testid="undo">
        Undo
      </Button>
      <Button variant="quiet" disabled={!canRedo} onClick={redo} data-testid="redo">
        Redo
      </Button>

      <span className="mx-1 h-5 w-px bg-hairline-strong" />

      <div role="toolbar" aria-label="Arrange" className="flex items-center gap-0.5">
        {ALIGNMENTS.map((entry) => (
          <button
            key={entry.edge}
            type="button"
            title={entry.label}
            aria-label={entry.label}
            data-testid={`align-${entry.edge}`}
            disabled={selectionCount === 0}
            onClick={() => align(entry.edge)}
            className="h-7 rounded-[2px] border border-transparent px-1.5 text-[11px] text-ink-muted hover:bg-accent-weak hover:text-ink disabled:text-ink-disabled disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
          >
            {entry.edge.slice(0, 1).toUpperCase()}
          </button>
        ))}

        <Button
          variant="quiet"
          disabled={selectionCount < 3}
          onClick={() => distribute('horizontal')}
          title="Distribute horizontally — needs three or more"
        >
          Dist H
        </Button>
        <Button
          variant="quiet"
          disabled={selectionCount < 3}
          onClick={() => distribute('vertical')}
          title="Distribute vertically — needs three or more"
        >
          Dist V
        </Button>
      </div>

      <span className="mx-1 h-5 w-px bg-hairline-strong" />

      <Button
        variant="quiet"
        disabled={selectionCount === 0}
        onClick={() => reorderSelection('front')}
      >
        Front
      </Button>
      <Button
        variant="quiet"
        disabled={selectionCount === 0}
        onClick={() => reorderSelection('back')}
      >
        Back
      </Button>
      <Button variant="quiet" disabled={selectionCount < 2} onClick={group} data-testid="group">
        Group
      </Button>
      <Button variant="quiet" disabled={selectionCount === 0} onClick={ungroup}>
        Ungroup
      </Button>

      <div className="ml-auto flex items-center gap-2">
        <Button onClick={onPreflight} data-testid="open-preflight">
          Pre-flight
        </Button>

        <span className="h-5 w-px bg-hairline-strong" />

        <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(event) => setSnapEnabled(event.target.checked)}
            className="accent-accent"
          />
          Snap
        </label>

        <span className="h-5 w-px bg-hairline-strong" />

        <Button variant="quiet" onClick={() => setZoom(zoom / 1.25)} aria-label="Zoom out">
          −
        </Button>
        <span
          data-numeric
          data-testid="zoom-level"
          className="w-11 text-center text-[11px] text-ink-muted"
        >
          {Math.round(zoom * 100)}%
        </span>
        <Button variant="quiet" onClick={() => setZoom(zoom * 1.25)} aria-label="Zoom in">
          +
        </Button>
        <Button variant="quiet" onClick={() => setZoom(1)} title="Reset to 100%">
          100%
        </Button>
      </div>
    </div>
  );
}
