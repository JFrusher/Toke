import type { Rect } from '@/engine/geometry/rect';
import type { NodeId, SceneNode } from '@/engine/scene/types';
import type { Points } from '@/engine/units/types';

/**
 * Snapping to guides, object edges and the artboard.
 *
 * The threshold is expressed in SCREEN pixels and divided by zoom. A fixed
 * document-space threshold feels sticky when zoomed in and useless when zoomed
 * out; the user is judging distance by what they can see.
 */

export type SnapAxis = 'vertical' | 'horizontal';
export type SnapEdge = 'start' | 'end' | 'centre';

export type Guide = {
  readonly id: string;
  readonly axis: SnapAxis;
  readonly position: Points;
};

export type SnapTargets = {
  /** x positions. */
  readonly vertical: readonly number[];
  /** y positions. */
  readonly horizontal: readonly number[];
};

export type SnapMatch = {
  readonly axis: SnapAxis;
  readonly position: number;
  readonly edge: SnapEdge;
};

export type SnapOptions = {
  /** Screen pixels. */
  readonly threshold: number;
  readonly zoom: number;
  readonly enabled?: boolean;
};

export type SnapResult = {
  readonly rect: Rect;
  readonly matches: readonly SnapMatch[];
};

export function snapTargets(
  nodes: readonly SceneNode[],
  artboard: Rect,
  guides: readonly Guide[],
  exclude?: NodeId,
): SnapTargets {
  const vertical = [artboard.x, artboard.x + artboard.width / 2, artboard.x + artboard.width];
  const horizontal = [artboard.y, artboard.y + artboard.height / 2, artboard.y + artboard.height];

  for (const node of nodes) {
    // A node must never snap to itself, or it could not be moved at all.
    if (node.id === exclude) continue;
    vertical.push(node.x, node.x + node.width / 2, node.x + node.width);
    horizontal.push(node.y, node.y + node.height / 2, node.y + node.height);
  }

  for (const guide of guides) {
    (guide.axis === 'vertical' ? vertical : horizontal).push(guide.position);
  }

  return { vertical, horizontal };
}

/** Precedence is fixed — start, end, centre — so a tie resolves the same way
 *  every frame. Iteration-order ties would make a drag jitter. */
const EDGES: readonly SnapEdge[] = ['start', 'end', 'centre'];

function edgeValue(start: number, size: number, edge: SnapEdge): number {
  if (edge === 'start') return start;
  if (edge === 'end') return start + size;
  return start + size / 2;
}

function bestOffset(
  start: number,
  size: number,
  targets: readonly number[],
  tolerance: number,
): { offset: number; match: SnapMatch | null; axisless: number } {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestOffsetValue = 0;
  let bestTarget: number | null = null;
  let bestEdge: SnapEdge | null = null;

  for (const edge of EDGES) {
    const value = edgeValue(start, size, edge);
    for (const target of targets) {
      const distance = Math.abs(target - value);
      // Strictly less-than keeps the earlier edge in EDGES order on a tie.
      if (distance <= tolerance && distance < bestDistance) {
        bestDistance = distance;
        bestOffsetValue = target - value;
        bestTarget = target;
        bestEdge = edge;
      }
    }
  }

  return {
    offset: bestOffsetValue,
    match:
      bestTarget === null || bestEdge === null
        ? null
        : { axis: 'vertical', position: bestTarget, edge: bestEdge },
    axisless: bestDistance,
  };
}

export function snap(node: SceneNode, targets: SnapTargets, options: SnapOptions): SnapResult {
  const rect: Rect = { x: node.x, y: node.y, width: node.width, height: node.height };

  if (options.enabled === false) {
    return { rect, matches: [] };
  }

  const tolerance = options.threshold / options.zoom;

  const horizontalFit = bestOffset(rect.x, rect.width, targets.vertical, tolerance);
  const verticalFit = bestOffset(rect.y, rect.height, targets.horizontal, tolerance);

  const matches: SnapMatch[] = [];
  if (horizontalFit.match !== null) {
    matches.push({ ...horizontalFit.match, axis: 'vertical' });
  }
  if (verticalFit.match !== null) {
    matches.push({ ...verticalFit.match, axis: 'horizontal' });
  }

  return {
    rect: {
      ...rect,
      x: rect.x + horizontalFit.offset,
      y: rect.y + verticalFit.offset,
    },
    matches,
  };
}
