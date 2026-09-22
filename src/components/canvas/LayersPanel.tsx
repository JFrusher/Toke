// biome-ignore-all lint/a11y/noNoninteractiveElementToInteractiveRole: <ul role="tree"> is the documented ARIA pattern for a layer tree; HTML has no native tree element.
// biome-ignore-all lint/a11y/useFocusableInteractive: the treeitem is a semantic wrapper; focus lives on the button inside it, which gives native click and keyboard activation.

'use client';

import type { KeyboardEvent } from 'react';
import type { SceneNode } from '@/engine/scene/types';
import { isGroup } from '@/engine/scene/types';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { cn } from '@/lib/cn';

/**
 * The screen-reader-navigable representation of canvas structure
 * (CLAUDE.md §4.7). It is not a convenience view — for a non-sighted user this
 * IS the canvas, so it must stay in sync in both directions.
 *
 * Rendered top-of-stack first, because that is how a designer reads a layer
 * list, while the underlying array is bottom-to-top paint order.
 */

function LayerRow({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: SceneNode;
  depth: number;
  selected: readonly string[];
  onSelect: (id: string, additive: boolean) => void;
}) {
  const isSelected = selected.includes(node.id);
  const bound = false; // token binding lands in P6.6

  return (
    <>
      <li
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isSelected}
        {...(isGroup(node) ? { 'aria-expanded': true } : {})}
      >
        <button
          type="button"
          data-testid={`layer-${node.id}`}
          onClick={(event) => onSelect(node.id, event.shiftKey || event.metaKey || event.ctrlKey)}
          style={{ paddingLeft: 8 + depth * 12 }}
          className={cn(
            'flex h-6 w-full items-center gap-1.5 pr-2 text-left text-[12px]',
            'focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2',
            isSelected ? 'bg-accent-weak text-accent' : 'text-ink hover:bg-accent-weak',
          )}
        >
          <span aria-hidden className="w-3 shrink-0 text-[11px] text-ink-subtle">
            {isGroup(node) ? '▾' : ''}
          </span>
          <span className="truncate">{node.name}</span>
          {!node.visible && <span className="ml-auto text-[11px] text-ink-subtle">hidden</span>}
          {bound && <span className="ml-auto text-[11px] text-bound">bound</span>}
        </button>
      </li>
      {isGroup(node) &&
        [...node.children]
          .reverse()
          .map((child) => (
            <LayerRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
    </>
  );
}

export function LayersPanel() {
  const nodes = useCanvasStore((s) => s.nodes);
  const selection = useCanvasStore((s) => s.selection);
  const setSelection = useCanvasStore((s) => s.setSelection);
  const deleteSelection = useCanvasStore((s) => s.deleteSelection);

  function onSelect(id: string, additive: boolean) {
    if (!additive) {
      setSelection([id]);
      return;
    }
    setSelection(
      selection.includes(id) ? selection.filter((current) => current !== id) : [...selection, id],
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelection();
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <h2 className="shrink-0 border-hairline border-b px-3 py-2 font-medium text-[11px] text-ink-muted">
        Layers
      </h2>

      {nodes.length === 0 ? (
        <p className="px-3 py-2 text-[12px] text-ink-subtle">
          Nothing on the artboard. Pick a tool and click to place.
        </p>
      ) : (
        <ul
          role="tree"
          aria-label="Layers"
          aria-multiselectable="true"
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 overflow-auto py-1 focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
        >
          {/* Reversed: a layer list reads top of stack first. */}
          {[...nodes].reverse().map((node) => (
            <LayerRow
              key={node.id}
              node={node}
              depth={0}
              selected={selection}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
