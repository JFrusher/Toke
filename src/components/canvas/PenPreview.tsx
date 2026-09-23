'use client';

import { type PenPath, toPath } from '@/engine/canvas/pen';
import { useCanvasStore } from '@/engine/store/useCanvasStore';

/**
 * The path being drawn, before it is a node.
 *
 * An SVG overlay rather than a Fabric object for the same reason as guides:
 * nothing unfinished may enter the scene graph, because the scene graph is
 * what the PDF prints. The path is drawn in scene points and mapped through the
 * viewport transform, so it lines up with the canvas at every zoom.
 */
export function PenPreview({
  draft,
  width,
  height,
}: {
  draft: PenPath;
  width: number;
  height: number;
}) {
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);

  if (draft.anchors.length === 0 || width <= 0 || height <= 0) return null;

  const d = toPath(draft, { x: 0, y: 0 });

  return (
    <svg
      width={width}
      height={height}
      aria-hidden="true"
      data-testid="pen-preview"
      data-anchors={draft.anchors.length}
      className="pointer-events-none absolute inset-0 z-10"
    >
      <g transform={`matrix(${zoom} 0 0 ${zoom} ${panX} ${panY})`}>
        <path
          d={d}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1}
          // A constant 1px on screen at any zoom; scaling the stroke with the
          // view would make a preview line vanish when zoomed out.
          vectorEffect="non-scaling-stroke"
        />

        {draft.anchors.map((anchor, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: anchors are append-only and never reordered, so their position is their identity; two anchors may share coordinates
          <g key={index}>
            {anchor.handle !== null && (
              <line
                x1={anchor.x - anchor.handle.x}
                y1={anchor.y - anchor.handle.y}
                x2={anchor.x + anchor.handle.x}
                y2={anchor.y + anchor.handle.y}
                stroke="var(--ink-subtle)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
            <rect
              x={anchor.x - 3 / zoom}
              y={anchor.y - 3 / zoom}
              width={6 / zoom}
              height={6 / zoom}
              // The first anchor is filled, because clicking it closes the path
              // and that should be visible before it happens.
              fill={index === 0 ? 'var(--accent)' : 'var(--paper)'}
              stroke="var(--accent)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </g>
    </svg>
  );
}
