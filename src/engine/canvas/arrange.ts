import type { Rect } from '@/engine/geometry/rect';
import { groupNode } from '@/engine/scene/factories';
import type { NodeId, SceneNode } from '@/engine/scene/types';
import { assertNever, isGroup } from '@/engine/scene/types';
import { points } from '@/engine/units/types';

/**
 * Align, distribute, reorder, group. Pure functions over node arrays; array
 * order is z-order, bottom to top.
 */

export type AlignEdge = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';
export type Axis = 'horizontal' | 'vertical';
export type ReorderDirection = 'forward' | 'backward' | 'front' | 'back';

function boundsOf(nodes: readonly SceneNode[]): Rect {
  const first = nodes[0];
  if (first === undefined) return { x: 0, y: 0, width: 0, height: 0 };

  // Typed as plain numbers: these accumulate through Math.min/max, which
  // strips the Points brand. They are re-branded on the way out.
  let left: number = first.x;
  let top: number = first.y;
  let right: number = first.x + first.width;
  let bottom: number = first.y + first.height;

  for (const node of nodes) {
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x + node.width);
    bottom = Math.max(bottom, node.y + node.height);
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * A single selection aligns to the artboard; two or more align to their own
 * bounds. Aligning one object to itself would be a no-op, so the artboard is
 * the only useful reading.
 */
export function alignNodes(
  nodes: readonly SceneNode[],
  edge: AlignEdge,
  artboard: Rect,
): readonly SceneNode[] {
  if (nodes.length === 0) return nodes;

  const frame = nodes.length === 1 ? artboard : boundsOf(nodes);

  return nodes.map((node) => {
    switch (edge) {
      case 'left':
        return { ...node, x: points(frame.x) };
      case 'centre':
        return { ...node, x: points(frame.x + (frame.width - node.width) / 2) };
      case 'right':
        return { ...node, x: points(frame.x + frame.width - node.width) };
      case 'top':
        return { ...node, y: points(frame.y) };
      case 'middle':
        return { ...node, y: points(frame.y + (frame.height - node.height) / 2) };
      case 'bottom':
        return { ...node, y: points(frame.y + frame.height - node.height) };
      default:
        // Keeps the switch exhaustive AND gives the callback a provable
        // return on every path. A `return node` default would silently
        // swallow a newly added edge instead of failing the build.
        return assertNever(edge, 'align edge');
    }
  });
}

/**
 * Equalises the GAPS between objects, not their centres. Centre-based
 * distribution leaves visibly uneven spacing whenever objects differ in size,
 * which is the usual case.
 */
export function distributeNodes(nodes: readonly SceneNode[], axis: Axis): readonly SceneNode[] {
  if (nodes.length < 3) return nodes;

  const horizontal = axis === 'horizontal';
  const size = (node: SceneNode) => (horizontal ? node.width : node.height);
  const start = (node: SceneNode) => (horizontal ? node.x : node.y);

  // Sort by position: selection order is arbitrary and must not affect layout.
  const ordered = [...nodes].sort((a, b) => start(a) - start(b));

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (first === undefined || last === undefined) return nodes;

  const span = start(last) + size(last) - start(first);
  const occupied = ordered.reduce((total, node) => total + size(node), 0);
  const gap = (span - occupied) / (ordered.length - 1);

  const placed = new Map<NodeId, number>();
  let cursor: number = start(first);
  for (const node of ordered) {
    placed.set(node.id, cursor);
    cursor += size(node) + gap;
  }

  // Map back over the ORIGINAL array so selection order is preserved.
  return nodes.map((node) => {
    const position = placed.get(node.id);
    if (position === undefined) return node;
    return horizontal ? { ...node, x: points(position) } : { ...node, y: points(position) };
  });
}

export function reorder(
  nodes: readonly SceneNode[],
  selection: readonly NodeId[],
  direction: ReorderDirection,
): readonly SceneNode[] {
  const selected = new Set(selection);
  const moving = nodes.filter((node) => selected.has(node.id));
  const rest = nodes.filter((node) => !selected.has(node.id));

  if (moving.length === 0) return nodes;

  if (direction === 'front') return [...rest, ...moving];
  if (direction === 'back') return [...moving, ...rest];

  const step = direction === 'forward' ? 1 : -1;
  const result = [...nodes];

  // Iterate from the edge the selection is moving toward, so a contiguous
  // multi-selection shifts as a block instead of colliding with itself.
  const indices = result
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => selected.has(node.id))
    .map(({ index }) => index);

  const ordered = step === 1 ? [...indices].reverse() : indices;

  for (const index of ordered) {
    const target = index + step;
    if (target < 0 || target >= result.length) continue;
    if (selected.has(result[target]?.id ?? '')) continue;

    const a = result[index];
    const b = result[target];
    if (a === undefined || b === undefined) continue;
    result[index] = b;
    result[target] = a;
  }

  return result;
}

/**
 * Wraps the selection in a group sized to its bounds. Children keep ABSOLUTE
 * coordinates — the group is a container for selection and z-order, not a
 * coordinate system, which keeps ungrouping exact and the PDF renderer simple.
 */
export function groupSelection(
  nodes: readonly SceneNode[],
  selection: readonly NodeId[],
  id: NodeId,
): readonly SceneNode[] {
  const selected = new Set(selection);
  const children = nodes.filter((node) => selected.has(node.id));

  if (children.length < 2) return nodes;

  const bounds = boundsOf(children);
  const group = groupNode({
    id,
    x: points(bounds.x),
    y: points(bounds.y),
    width: points(bounds.width),
    height: points(bounds.height),
    children,
  });

  return [...nodes.filter((node) => !selected.has(node.id)), group];
}

export function ungroupSelection(
  nodes: readonly SceneNode[],
  selection: readonly NodeId[],
): readonly SceneNode[] {
  const selected = new Set(selection);

  return nodes.flatMap((node) =>
    selected.has(node.id) && isGroup(node) ? [...node.children] : [node],
  );
}
