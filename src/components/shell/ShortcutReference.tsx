'use client';

import { Modal } from '@/components/ui/Modal';

/**
 * The shortcuts, written down.
 *
 * Undiscoverable shortcuts are shortcuts nobody uses, and a precision tool
 * whose fast paths are folklore is slower than one without them.
 */

const GROUPS: readonly { title: string; items: readonly [string, string][] }[] = [
  {
    title: 'Tools',
    items: [
      ['V', 'Select'],
      ['T', 'Text'],
      ['R', 'Rectangle'],
      ['E', 'Ellipse'],
      ['L', 'Line'],
    ],
  },
  {
    title: 'Canvas',
    items: [
      ['Arrows', 'Nudge 1pt'],
      ['Shift + arrows', 'Nudge 10pt'],
      ['Delete', 'Remove the selection'],
      ['Escape', 'Deselect'],
      ['Ctrl + Z', 'Undo'],
      ['Ctrl + Shift + Z', 'Redo'],
    ],
  },
  {
    title: 'Panels',
    items: [
      ['Tab', 'Move between controls'],
      ['Arrows on a splitter', 'Resize a panel 8px'],
      ['Shift + arrows on a splitter', 'Resize a panel 32px'],
      ['Home / End on a splitter', 'Snap to the limits'],
      ['Arrows on a dock tab', 'Change dock panel'],
    ],
  },
  {
    title: 'Data',
    items: [
      ['Arrows in the grid', 'Move between cells'],
      ['Enter', 'Edit a cell'],
      ['Escape', 'Cancel an edit'],
      ['Shift + Delete', 'Remove a row'],
      ['Ctrl + Enter', 'Run the SQL query'],
    ],
  },
];

export function ShortcutReference({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="mb-1.5 font-medium text-[11px] text-ink-muted">{group.title}</h3>
            <dl className="flex flex-col gap-1">
              {group.items.map(([keys, action]) => (
                <div key={keys} className="flex items-baseline gap-2">
                  <dt className="w-36 shrink-0 font-mono text-[11px] text-ink">{keys}</dt>
                  <dd className="text-[12px] text-ink-muted">{action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
