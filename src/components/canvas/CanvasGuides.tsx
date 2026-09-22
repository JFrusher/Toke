'use client';

import type { SnapMatch } from '@/engine/canvas/snapping';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useShellStore } from '@/engine/store/useShellStore';
import { formatNumber } from '@/engine/units/format';
import { points } from '@/engine/units/types';

/**
 * Guides and live snap indicators, drawn over the canvas.
 *
 * An SVG overlay rather than Fabric objects, for three reasons: guides must
 * never reach the scene graph and so can never reach the PDF; they must not be
 * snappable to themselves; and keeping them out of the Fabric object map
 * preserves its one-to-one mirror of the scene, which the whole store↔canvas
 * sync depends on.
 *
 * The lines are SVG but the hit targets are real `<button>`s. A 1px line is
 * not something anyone can click, and an SVG element carrying a click handler
 * is reachable by pointer only — §4.7 wants guides removable from the
 * keyboard too.
 */

type Props = {
  readonly width: number;
  readonly height: number;
  /** Matches from the snap in progress, or empty when nothing is dragging. */
  readonly matches: readonly SnapMatch[];
};

/** Width of the invisible strip that carries the pointer target. */
const HIT_WIDTH = 9;

export function CanvasGuides({ width, height, matches }: Props) {
  const guides = useCanvasStore((s) => s.guides);
  const removeGuide = useCanvasStore((s) => s.removeGuide);
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  const unit = useShellStore((s) => s.displayUnit);

  if (width <= 0 || height <= 0) return null;

  const screenOf = (guide: (typeof guides)[number]) =>
    guide.axis === 'vertical' ? guide.position * zoom + panX : guide.position * zoom + panY;

  return (
    <div
      data-testid="canvas-guides"
      data-guide-count={guides.length}
      data-snap-count={matches.length}
      className="pointer-events-none absolute inset-0 z-10"
    >
      <svg width={width} height={height} aria-hidden="true" className="absolute inset-0">
        {guides.map((guide) => {
          const at = screenOf(guide);
          const vertical = guide.axis === 'vertical';
          return (
            <line
              key={guide.id}
              x1={vertical ? at : 0}
              x2={vertical ? at : width}
              y1={vertical ? 0 : at}
              y2={vertical ? height : at}
              stroke="var(--conditional)"
              strokeWidth={1}
              data-testid="guide-line"
              data-axis={guide.axis}
            />
          );
        })}

        {matches.map((match) => {
          const at =
            match.axis === 'vertical' ? match.position * zoom + panX : match.position * zoom + panY;
          const vertical = match.axis === 'vertical';
          return (
            <line
              key={`${match.axis}-${match.edge}-${match.position}`}
              x1={vertical ? at : 0}
              x2={vertical ? at : width}
              y1={vertical ? 0 : at}
              y2={vertical ? height : at}
              stroke="var(--overflow)"
              strokeWidth={1}
              strokeDasharray="3 3"
              data-testid="snap-indicator"
            />
          );
        })}
      </svg>

      {guides.map((guide) => {
        const at = screenOf(guide);
        const vertical = guide.axis === 'vertical';

        return (
          <button
            key={guide.id}
            type="button"
            onClick={() => removeGuide(guide.id)}
            data-testid="guide-hit"
            aria-label={`Remove ${guide.axis} guide at ${formatNumber(points(guide.position), unit)}${unit}`}
            style={
              vertical
                ? { left: at - HIT_WIDTH / 2, top: 0, width: HIT_WIDTH, height }
                : { top: at - HIT_WIDTH / 2, left: 0, height: HIT_WIDTH, width }
            }
            className={`pointer-events-auto absolute bg-transparent focus-visible:bg-accent-weak focus-visible:outline-2 focus-visible:outline-accent ${
              vertical ? 'cursor-ew-resize' : 'cursor-ns-resize'
            }`}
          />
        );
      })}
    </div>
  );
}
