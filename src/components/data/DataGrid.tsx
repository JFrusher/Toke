// biome-ignore-all lint/a11y/useSemanticElements: a virtualised ARIA grid cannot be a <table> — only a window of rows exists in the DOM and they are absolutely positioned.
// biome-ignore-all lint/a11y/useFocusableInteractive: row and gridcell are containers; focus lives on the inner cell button under a roving tabindex, which is the correct grid pattern.

'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Row, SqlValue } from '@/engine/db/protocol';
import { useDataStore } from '@/engine/store/useDataStore';
import { cn } from '@/lib/cn';

const ROW_HEIGHT = 28;

type SortState = { column: string; direction: 'asc' | 'desc' } | null;

function compare(a: SqlValue, b: SqlValue): number {
  if (a === null && b === null) return 0;
  // Nulls sort last in both directions — an empty cell is absence, not a
  // smallest value, and burying them under 500 names is what users expect.
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function display(value: SqlValue): string {
  return value === null ? '' : String(value);
}

export function DataGrid() {
  const rows = useDataStore((s) => s.rows);
  const columns = useDataStore((s) => s.columns);
  const updateCell = useDataStore((s) => s.updateCell);
  const deleteRow = useDataStore((s) => s.deleteRow);

  const [sort, setSort] = useState<SortState>(null);
  const [cursor, setCursor] = useState({ row: 0, column: 0 });
  const [draft, setDraft] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(() => {
    if (sort === null) return rows;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort(
      (a, b) => compare(a[sort.column] ?? null, b[sort.column] ?? null) * factor,
    );
  }, [rows, sort]);

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Keyed on the boolean, not on `draft` itself. Depending on the draft text
  // re-selects on every keystroke, so each new character replaces the last and
  // the cell ends up holding only the final letter typed.
  const isEditing = draft !== null;
  useEffect(() => {
    if (isEditing) editRef.current?.select();
  }, [isEditing]);

  function move(rowDelta: number, columnDelta: number) {
    setCursor((current) => {
      const row = Math.min(Math.max(current.row + rowDelta, 0), Math.max(sorted.length - 1, 0));
      const column = Math.min(
        Math.max(current.column + columnDelta, 0),
        Math.max(columns.length - 1, 0),
      );
      virtualizer.scrollToIndex(row);
      return { row, column };
    });
  }

  async function commit() {
    const record = sorted[cursor.row];
    const column = columns[cursor.column];
    if (record === undefined || column === undefined || draft === null) return;

    const id = record.id;
    if (typeof id !== 'number') return;

    const next: SqlValue = draft.trim() === '' ? null : draft;
    setDraft(null);
    if (display(record[column.name] ?? null) !== draft) {
      await updateCell(id, column.name, next);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (draft !== null) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDraft(null);
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void commit().then(() => move(1, 0));
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1, 0);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1, 0);
        break;
      case 'ArrowRight':
        event.preventDefault();
        move(0, 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        move(0, -1);
        break;
      case 'Enter': {
        event.preventDefault();
        const record = sorted[cursor.row];
        const column = columns[cursor.column];
        if (record !== undefined && column !== undefined) {
          setDraft(display(record[column.name] ?? null));
        }
        break;
      }
      case 'Delete': {
        if (!event.shiftKey) break;
        event.preventDefault();
        const record = sorted[cursor.row];
        if (record !== undefined && typeof record.id === 'number') {
          void deleteRow(record.id);
        }
        break;
      }
      default:
        break;
    }
  }

  function toggleSort(column: string) {
    setSort((current) => {
      if (current === null || current.column !== column) {
        return { column, direction: 'asc' };
      }
      return current.direction === 'asc' ? { column, direction: 'desc' } : null;
    });
  }

  if (columns.length === 0) {
    return <p className="p-4 text-[12px] text-ink-muted">No table loaded.</p>;
  }

  const items = virtualizer.getVirtualItems();

  return (
    <div
      role="grid"
      aria-rowcount={sorted.length + 1}
      aria-colcount={columns.length}
      className="flex h-full flex-col overflow-hidden bg-panel-raised text-[12px]"
      onKeyDown={onKeyDown}
    >
      <div role="row" className="flex shrink-0 border-hairline-strong border-b bg-panel">
        {columns.map((column) => {
          const active = sort?.column === column.name;
          return (
            <button
              key={column.name}
              type="button"
              role="columnheader"
              aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
              onClick={() => toggleSort(column.name)}
              className={cn(
                'flex h-7 w-[150px] shrink-0 items-center gap-1 border-hairline border-r px-2',
                'text-left font-medium text-[11px] text-ink-muted',
                'hover:bg-accent-weak hover:text-ink',
                'focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2',
                active && 'text-accent',
              )}
            >
              <span className="truncate">{column.name}</span>
              {active ? <span aria-hidden>{sort.direction === 'asc' ? '↑' : '↓'}</span> : null}
            </button>
          );
        })}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((item) => {
            const record = sorted[item.index] as Row | undefined;
            if (record === undefined) return null;

            return (
              <div
                key={item.key}
                role="row"
                aria-rowindex={item.index + 2}
                className="absolute flex border-hairline border-b"
                style={{
                  transform: `translateY(${item.start}px)`,
                  height: ROW_HEIGHT,
                  width: '100%',
                }}
              >
                {columns.map((column, columnIndex) => {
                  const focused = cursor.row === item.index && cursor.column === columnIndex;
                  const editing = focused && draft !== null;
                  const value = record[column.name] ?? null;

                  return (
                    <div
                      key={column.name}
                      role="gridcell"
                      aria-colindex={columnIndex + 1}
                      className={cn(
                        'w-[150px] shrink-0 border-hairline border-r',
                        focused && 'outline-2 outline-accent -outline-offset-2',
                      )}
                    >
                      {editing ? (
                        <input
                          ref={editRef}
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          onBlur={() => void commit()}
                          aria-label={`${column.name}, row ${item.index + 1}`}
                          className="h-full w-full bg-panel-raised px-2 text-[12px] text-ink outline-none"
                          data-numeric={column.declaredType === 'INTEGER' ? '' : undefined}
                        />
                      ) : (
                        <button
                          type="button"
                          tabIndex={focused ? 0 : -1}
                          onFocus={() => setCursor({ row: item.index, column: columnIndex })}
                          onClick={() => setCursor({ row: item.index, column: columnIndex })}
                          onDoubleClick={() => setDraft(display(value))}
                          className={cn(
                            'h-full w-full truncate px-2 text-left text-[12px] outline-none',
                            value === null ? 'text-ink-subtle' : 'text-ink',
                          )}
                          data-numeric={column.declaredType === 'INTEGER' ? '' : undefined}
                        >
                          {value === null ? '—' : String(value)}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-hairline-strong border-t bg-panel px-3 py-1.5 text-[11px] text-ink-muted">
        <span data-numeric>
          {sorted.length} {sorted.length === 1 ? 'record' : 'records'}
        </span>
        <span className="text-ink-subtle">
          Arrows move · Enter edits · Esc cancels · Shift+Delete removes row
        </span>
      </footer>
    </div>
  );
}
