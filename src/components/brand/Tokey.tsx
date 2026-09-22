'use client';

import Image from 'next/image';

/**
 * Tokey, the mascot.
 *
 * Confined to ONBOARDING surfaces — the template gallery, an empty artboard,
 * tutorial steps, the small-viewport screen. Never in working chrome: the
 * toolbar, inspector, dock, diagnostics and canvas stay a precision instrument
 * (CLAUDE.md §4.8). A character that turns up while someone is positioning
 * type to a tenth of a millimetre is in the way.
 *
 * Always decorative: every surface that uses Tokey states its message in text
 * beside it, so the illustration carries no information of its own and is
 * hidden from assistive technology.
 */

export type TokeyState = 'greeting' | 'loading' | 'success' | 'error' | 'tip' | 'settings';

const SOURCE: Record<TokeyState, string> = {
  greeting: '/brand/tokey-greeting.png',
  loading: '/brand/tokey-loading.png',
  success: '/brand/tokey-success.png',
  error: '/brand/tokey-error.png',
  tip: '/brand/tokey-tip.png',
  settings: '/brand/tokey-settings.png',
};

/** Rendered sizes, on the 4px grid. */
const SIZE = { sm: 48, md: 72, lg: 112 } as const;

export function Tokey({
  state,
  size = 'md',
  className,
}: {
  state: TokeyState;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const pixels = SIZE[size];

  return (
    <Image
      src={SOURCE[state]}
      alt=""
      aria-hidden="true"
      width={pixels}
      height={pixels}
      // Intrinsic sizes are ~320px square, so the largest use is still served
      // at better than 2x without a second asset.
      sizes={`${pixels}px`}
      data-testid={`tokey-${state}`}
      className={className}
      style={{ width: pixels, height: 'auto' }}
      priority={state === 'greeting'}
    />
  );
}
