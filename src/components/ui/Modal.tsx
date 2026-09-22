'use client';

import { type ReactNode, useEffect, useRef } from 'react';

/**
 * Native <dialog>, not a component-library modal.
 *
 * showModal() already gives focus trapping, Escape-to-close, aria-modal and an
 * inert background — the parts that are genuinely hard to get right and the
 * only reason to reach for a library here. Everything else is a border.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onCancel={onClose}
      className="w-[min(560px,calc(100vw-32px))] rounded border border-hairline-strong bg-panel p-0 text-ink backdrop:bg-ink/25"
    >
      <header className="flex items-center justify-between border-hairline border-b px-4 py-3">
        <h2 className="font-semibold text-[13px]">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-[2px] px-1.5 py-0.5 text-[12px] text-ink-muted hover:bg-accent-weak hover:text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
        >
          Esc
        </button>
      </header>
      <div className="p-4">{children}</div>
    </dialog>
  );
}
