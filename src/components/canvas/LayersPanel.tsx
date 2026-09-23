// biome-ignore-all lint/a11y/noNoninteractiveElementToInteractiveRole: <ul role="tree"> is the documented ARIA pattern for a layer tree; HTML has no native tree element.
// biome-ignore-all lint/a11y/useFocusableInteractive: the treeitem is a semantic wrapper; focus lives on the controls inside it, which give native click and keyboard activation.

'use client';

import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { SceneNode } from '@/engine/scene/types';
import { isGroup } from '@/engine/scene/types';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { isTokenised } from '@/engine/tokens/parser';
import { cn } from '@/lib/cn';

/**
 * The screen-reader-navigable representation of canvas structure
 * (CLAUDE.md §4.7). It is not a convenience view — for a non-sighted user this
 * IS the canvas, so it must stay in sync in both directions.
 *
 * Rendered top-of-stack first, because that is how a designer reads a layer
 * list, while the underlying array is bottom-to-top paint order.
 *
 * Reordering is by keyboard and toolbar rather than by drag: Ctrl+[ and Ctrl+]
 * work here and globally, where a drag-reorder in a tree is pointer-only
 * unless it is built twice.
 */

/** True when this node, or anything inside it, is bound to a column. */
function isBound(node: SceneNode): boolean {
  if (node.kind === 'text') return isTokenised(node.text);
  return isGroup(node) ? node.children.some(isBound) : false;
}

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
  const renameNode = useCanvasStore((s) => s.renameNode);
  const setNodeVisible = useCanvasStore((s) => s.setNodeVisible);
  const setNodeLocked = useCanvasStore((s) => s.setNodeLocked);

  const [renaming, setRenaming] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const isSelected = selected.includes(node.id);
  const bound = isBound(node);

  useEffect(() => {
    if (renaming) input.current?.select();
  }, [renaming]);

  function commitRename(value: string) {
    setRenaming(false);
    if (value.trim() !== '' && value !== node.name) renameNode(node.id, value);
  }

  return (
    <>
      <li
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isSelected}
        {...(isGroup(node) ? { 'aria-expanded': true } : {})}
        className={cn('flex items-center', isSelected ? 'bg-accent-weak' : 'hover:bg-accent-weak')}
      >
        {renaming ? (
          <input
            ref={input}
            defaultValue={node.name}
            aria-label={`Rename ${node.name}`}
            data-testid={`layer-rename-${node.id}`}
            onBlur={(event) => commitRename(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename(event.currentTarget.value);
              // Escape abandons the edit rather than committing a half-typed
              // name, which is what Escape means everywhere else here.
              if (event.key === 'Escape') setRenaming(false);
              event.stopPropagation();
            }}
            style={{ marginLeft: 8 + depth * 12 }}
            className="h-6 min-w-0 flex-1 rounded-[2px] border border-border-control bg-panel-raised px-1 text-[12px] text-ink focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
          />
        ) : (
          <button
            type="button"
            data-testid={`layer-${node.id}`}
            onClick={(event) => onSelect(node.id, event.shiftKey || event.metaKey || event.ctrlKey)}
            onDoubleClick={() => setRenaming(true)}
            onKeyDown={(event) => {
              // F2 renames, as it does in every file manager and layer list.
              if (event.key === 'F2') {
                event.preventDefault();
                setRenaming(true);
              }
            }}
            style={{ paddingLeft: 8 + depth * 12 }}
            className={cn(
              'flex h-6 min-w-0 flex-1 items-center gap-1.5 text-left text-[12px]',
              'focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent',
              isSelected ? 'text-accent' : 'text-ink',
              node.locked && 'text-ink-subtle',
            )}
          >
            <span aria-hidden className="w-3 shrink-0 text-[11px] text-ink-subtle">
              {isGroup(node) ? '▾' : ''}
            </span>
            <span className="truncate">{node.name}</span>
            {/* A word as well as the colour — §4.7 forbids signalling state by
                colour alone. */}
            {bound && (
              <span data-testid="layer-bound" className="ml-auto shrink-0 text-[11px] text-bound">
                bound
              </span>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={() => setNodeLocked(node.id, !node.locked)}
          aria-pressed={node.locked}
          aria-label={`${node.locked ? 'Unlock' : 'Lock'} ${node.name}`}
          data-testid={`layer-lock-${node.id}`}
          className="h-6 shrink-0 px-1 text-[11px] text-ink-subtle hover:text-ink focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {node.locked ? 'locked' : 'open'}
        </button>

        <button
          type="button"
          onClick={() => setNodeVisible(node.id, !node.visible)}
          aria-pressed={!node.visible}
          aria-label={`${node.visible ? 'Hide' : 'Show'} ${node.name}`}
          data-testid={`layer-visible-${node.id}`}
          className="h-6 shrink-0 pr-2 pl-1 text-[11px] text-ink-subtle hover:text-ink focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {node.visible ? 'shown' : 'hidden'}
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
      return;
    }

    // Reorder keys are deliberately NOT handled here. The global handler
    // already sees them — a layer button is not a typing target — and running
    // both meant one keypress reordered twice, which for a single selection
    // moved it up and then straight back.
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
          className="min-h-0 flex-1 overflow-auto py-1 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
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
