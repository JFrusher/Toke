'use client';

import { useEffect, useRef, useState } from 'react';
import { rulerTicks } from '@/engine/canvas/ruler';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useShellStore } from '@/engine/store/useShellStore';

/**
 * Rulers down the top and left edges of the viewport.
 *
 * Tick placement is decided by `engine/canvas/ruler.ts` — this only draws. The
 * cursor indicator is the part that earns the rulers their place: a coordinate
 * readout in the inspector tells you where an object is, and a line on the
 * ruler tells you where your hand is.
 */

export const RULER_SIZE = 20;

type Props = {
  /** Viewport size in screen pixels, excluding the rulers themselves. */
  readonly width: number;
  readonly height: number;
  /** Pointer position in screen pixels relative to the viewport, or null. */
  readonly cursor: { readonly x: number; readonly y: number } | null;
};

export function CanvasRulers({ width, height, cursor }: Props) {
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  const unit = useShellStore((s) => s.displayUnit);

  if (width <= 0 || height <= 0) return null;

  // Scene coordinates at each end of the visible area. The pan is in screen
  // pixels, so it divides out by the zoom rather than multiplying.
  const horizontal = rulerTicks({
    fromPt: -panX / zoom,
    toPt: (width - panX) / zoom,
    zoom,
    unit,
  });
  const vertical = rulerTicks({
    fromPt: -panY / zoom,
    toPt: (height - panY) / zoom,
    zoom,
    unit,
  });

  return (
    <>
      {/* The corner square, so the two rulers meet cleanly. */}
      <div
        aria-hidden="true"
        style={{ width: RULER_SIZE, height: RULER_SIZE }}
        className="absolute top-0 left-0 z-20 border-hairline-strong border-r border-b bg-panel"
      />

      <svg
        role="img"
        aria-label={`Horizontal ruler in ${unit}`}
        data-testid="ruler-horizontal"
        data-unit={unit}
        width={width}
        height={RULER_SIZE}
        style={{ left: RULER_SIZE }}
        className="pointer-events-none absolute top-0 z-20 border-hairline-strong border-b bg-panel"
      >
        <title>{`Horizontal ruler in ${unit}`}</title>
        {horizontal.map((tick) => {
          const x = Math.round(tick.positionPt * zoom + panX) + 0.5;
          return (
            <g key={`h${tick.positionPt}`}>
              <line
                x1={x}
                x2={x}
                y1={tick.label === null ? RULER_SIZE - 4 : RULER_SIZE - 8}
                y2={RULER_SIZE}
                stroke="var(--hairline-strong)"
                strokeWidth={1}
              />
              {tick.label !== null && (
                <text x={x + 2} y={9} fontSize={9} fill="var(--ink-subtle)">
                  {tick.label}
                </text>
              )}
            </g>
          );
        })}

        {cursor !== null && (
          <line
            x1={cursor.x + 0.5}
            x2={cursor.x + 0.5}
            y1={0}
            y2={RULER_SIZE}
            stroke="var(--accent)"
            strokeWidth={1}
            data-testid="ruler-cursor-x"
          />
        )}
      </svg>

      <svg
        role="img"
        aria-label={`Vertical ruler in ${unit}`}
        data-testid="ruler-vertical"
        width={RULER_SIZE}
        height={height}
        style={{ top: RULER_SIZE }}
        className="pointer-events-none absolute left-0 z-20 border-hairline-strong border-r bg-panel"
      >
        <title>{`Vertical ruler in ${unit}`}</title>
        {vertical.map((tick) => {
          const y = Math.round(tick.positionPt * zoom + panY) + 0.5;
          return (
            <g key={`v${tick.positionPt}`}>
              <line
                y1={y}
                y2={y}
                x1={tick.label === null ? RULER_SIZE - 4 : RULER_SIZE - 8}
                x2={RULER_SIZE}
                stroke="var(--hairline-strong)"
                strokeWidth={1}
              />
              {tick.label !== null && (
                // Rotated so the numbers read up the ruler, as they do in
                // every other layout tool.
                <text
                  x={0}
                  y={0}
                  fontSize={9}
                  fill="var(--ink-subtle)"
                  transform={`translate(9 ${y - 2}) rotate(-90)`}
                >
                  {tick.label}
                </text>
              )}
            </g>
          );
        })}

        {cursor !== null && (
          <line
            y1={cursor.y + 0.5}
            y2={cursor.y + 0.5}
            x1={0}
            x2={RULER_SIZE}
            stroke="var(--accent)"
            strokeWidth={1}
            data-testid="ruler-cursor-y"
          />
        )}
      </svg>
    </>
  );
}

/** Tracks the pointer over an element, in element-relative screen pixels. */
export function useCursorPosition(ref: React.RefObject<HTMLElement | null>) {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    function onMove(event: PointerEvent) {
      // Coalesced into an animation frame: pointermove fires far faster than
      // the rulers can usefully repaint, and each one is a React render.
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const box = element?.getBoundingClientRect();
        if (box === undefined) return;
        setCursor({ x: event.clientX - box.left, y: event.clientY - box.top });
      });
    }

    function onLeave() {
      setCursor(null);
    }

    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerleave', onLeave);
    return () => {
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [ref]);

  return cursor;
}
