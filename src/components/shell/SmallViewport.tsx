'use client';

import { useEffect, useState } from 'react';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useDataStore } from '@/engine/store/useDataStore';
import { getFont } from '@/engine/text/fontLoader';
import { renderTextNode } from '@/engine/tokens/render';

/**
 * What toke shows below 1024px.
 *
 * Not a reflowed studio. Four panes, a ruler and sub-millimetre dragging do
 * not work on a phone, and pretending otherwise produces something that is
 * technically responsive and practically unusable. CLAUDE.md §4.7 calls for an
 * explicit message and a read-only proof instead.
 *
 * The proof is the point: checking one guest's card on a phone is a real thing
 * people do, and it is worth doing properly.
 */

const BREAKPOINT = 1024;

/** True while the viewport is too narrow for the studio. */
export function useIsSmallViewport(): boolean {
  // Starts false so the server and the first client render agree; the media
  // query is read in an effect.
  const [small, setSmall] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${BREAKPOINT - 1}px)`);
    const update = () => setSmall(query.matches);

    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return small;
}

export function SmallViewport() {
  const nodes = useCanvasStore((s) => s.nodes);
  const artboard = useCanvasStore((s) => s.artboard);
  const records = useDataStore((s) => s.records);

  const [cursor, setCursor] = useState(0);
  const row = records[cursor] ?? null;
  const total = records.length;

  return (
    <main className="flex min-h-dvh flex-col gap-4 bg-panel px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-[15px] tracking-tight">toke</h1>
        <p className="text-[13px] text-ink-muted">
          The studio needs a window at least 1024px wide. Open toke on a larger screen to edit.
        </p>
      </header>

      {total === 0 ? (
        <p data-testid="small-empty" className="text-[13px] text-ink-subtle">
          No records to proof. Import a guest list on a larger screen first.
        </p>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium text-[11px] text-ink-muted">Proof</h2>

          <svg
            viewBox={`0 0 ${artboard.width} ${artboard.height}`}
            role="img"
            aria-label={`Card proof for record ${cursor + 1} of ${total}`}
            data-testid="small-proof"
            className="h-auto w-full border border-hairline-strong bg-paper"
          >
            <title>{`Record ${cursor + 1} of ${total}`}</title>

            {nodes.map((node) => (
              <ProofNode key={node.id} node={node} row={row} />
            ))}
          </svg>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCursor((index) => Math.max(0, index - 1))}
              disabled={cursor === 0}
              aria-label="Previous record"
              data-testid="small-previous"
              className="h-9 min-w-9 rounded-[2px] border border-border-control bg-panel-raised px-3 text-[13px] text-ink disabled:text-ink-disabled focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
            >
              ‹
            </button>

            <span
              data-numeric
              data-testid="small-counter"
              className="flex-1 text-center text-[13px] text-ink-muted"
            >
              {cursor + 1} / {total}
            </span>

            <button
              type="button"
              onClick={() => setCursor((index) => Math.min(total - 1, index + 1))}
              disabled={cursor >= total - 1}
              aria-label="Next record"
              data-testid="small-next"
              className="h-9 min-w-9 rounded-[2px] border border-border-control bg-panel-raised px-3 text-[13px] text-ink disabled:text-ink-disabled focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
            >
              ›
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

/**
 * One node as SVG.
 *
 * Deliberately approximate: this is a proof for reading a name on a phone, not
 * a render. It goes through `renderTextNode` so the TEXT matches what would
 * print — getting the value wrong here would defeat the whole purpose — while
 * the typography is left to the browser.
 */
function ProofNode({
  node,
  row,
}: {
  node: ReturnType<typeof useCanvasStore.getState>['nodes'][number];
  row: Record<string, unknown> | null;
}) {
  if (!node.visible) return null;

  if (node.kind === 'text') {
    const shown = renderTextNode({
      node,
      font: getFont(node.fontFamily, node.fontWeight, node.italic),
      mode: 'live',
      row,
    });

    const anchor = node.align === 'center' ? 'middle' : node.align === 'right' ? 'end' : 'start';
    const x =
      node.align === 'center'
        ? node.x + node.width / 2
        : node.align === 'right'
          ? node.x + node.width
          : node.x;

    return (
      <text
        x={x}
        // An approximate baseline: 80% of the first line box. Exact metrics
        // belong to measure.ts and the PDF, not to a phone preview.
        y={node.y + shown.fontSize * 0.8}
        textAnchor={anchor}
        fontSize={shown.fontSize}
        fontFamily={node.fontFamily}
        fontWeight={node.fontWeight}
        fill={node.fill.kind === 'solid' ? node.fill.color : '#1A1815'}
      >
        {shown.text}
      </text>
    );
  }

  if (node.kind === 'rect') {
    return (
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        fill={node.fill.kind === 'solid' ? node.fill.color : 'none'}
        stroke={node.stroke.kind === 'solid' ? node.stroke.color : 'none'}
        strokeWidth={node.stroke.kind === 'solid' ? node.stroke.width : 0}
      />
    );
  }

  if (node.kind === 'ellipse') {
    return (
      <ellipse
        cx={node.x + node.width / 2}
        cy={node.y + node.height / 2}
        rx={node.width / 2}
        ry={node.height / 2}
        fill={node.fill.kind === 'solid' ? node.fill.color : 'none'}
        stroke={node.stroke.kind === 'solid' ? node.stroke.color : 'none'}
        strokeWidth={node.stroke.kind === 'solid' ? node.stroke.width : 0}
      />
    );
  }

  if (node.kind === 'line' && node.stroke.kind === 'solid') {
    return (
      <line
        x1={node.x}
        y1={node.y}
        x2={node.x + node.width}
        y2={node.y + node.height}
        stroke={node.stroke.color}
        strokeWidth={node.stroke.width}
      />
    );
  }

  return null;
}
