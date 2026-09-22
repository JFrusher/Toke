'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Drag handle between two panes.
 *
 * `role="separator"` with `aria-valuenow` is what makes this operable without
 * a pointer — a splitter that only responds to a drag locks keyboard users out
 * of the panel sizes entirely (CLAUDE.md §4.7). Arrow keys move it, Home and
 * End jump to the limits.
 *
 * Sizes are reported in points of the flex basis, not percentages: the studio
 * is a precision instrument and a panel that changes width when the window
 * does is a panel the user has to re-tune.
 */
export function ResizeHandle({
  orientation,
  value,
  min,
  max,
  onChange,
  label,
  invert = false,
}: {
  /** The axis the handle MOVES along, not the axis of the line it draws. */
  orientation: 'horizontal' | 'vertical';
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  label: string;
  /** True when growing the panel means moving the handle towards 0. */
  invert?: boolean;
}) {
  const dragging = useRef(false);
  const latest = useRef(value);
  latest.current = value;

  const clamp = useCallback((next: number) => Math.min(max, Math.max(min, next)), [min, max]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      if (!dragging.current) return;
      // Measured from the viewport edge rather than accumulated from a delta,
      // so a dropped pointer event cannot leave the handle behind the cursor.
      const raw =
        orientation === 'horizontal'
          ? invert
            ? window.innerWidth - event.clientX
            : event.clientX
          : window.innerHeight - event.clientY;
      onChange(clamp(raw));
    }

    function onPointerUp() {
      dragging.current = false;
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [orientation, invert, onChange, clamp]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 32 : 8;
    const keys: Record<string, number> = {
      ArrowLeft: orientation === 'horizontal' ? (invert ? step : -step) : 0,
      ArrowRight: orientation === 'horizontal' ? (invert ? -step : step) : 0,
      ArrowUp: orientation === 'vertical' ? step : 0,
      ArrowDown: orientation === 'vertical' ? -step : 0,
    };

    if (event.key === 'Home') {
      event.preventDefault();
      onChange(min);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      onChange(max);
      return;
    }

    const delta = keys[event.key];
    if (delta === undefined || delta === 0) return;
    event.preventDefault();
    onChange(clamp(latest.current + delta));
  }

  const horizontal = orientation === 'horizontal';

  return (
    /* An <hr> is a thematic break, not an interactive widget, and Tailwind
       preflight zeroes its height and adds a border — exactly the 1px geometry
       this handle controls. Assistive technology reads the explicit role the
       same way. */
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot carry this handle's 1px geometry under Tailwind preflight
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      data-testid={`resize-${label.toLowerCase().replace(/\s+/g, '-')}`}
      onKeyDown={onKeyDown}
      onPointerDown={() => {
        dragging.current = true;
        document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
        // Without this a drag selects the text in both panes as it passes.
        document.body.style.userSelect = 'none';
      }}
      className={
        horizontal
          ? 'w-px shrink-0 cursor-col-resize bg-hairline-strong transition-colors hover:bg-border-control focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-accent'
          : 'h-px shrink-0 cursor-row-resize bg-hairline-strong transition-colors hover:bg-border-control focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-accent'
      }
    />
  );
}
