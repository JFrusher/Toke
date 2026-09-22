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

/**
 * Source and intrinsic size for each state.
 *
 * The real pixel dimensions are declared rather than assumed square: Next
 * needs the true ratio to reserve the right box, and these artworks are not
 * square. Getting it wrong reserves the wrong space and shifts the layout when
 * the image lands.
 */
const ART: Record<TokeyState, { src: string; width: number; height: number }> = {
  greeting: { src: '/brand/tokey-greeting.png', width: 451, height: 311 },
  loading: { src: '/brand/tokey-loading.png', width: 345, height: 314 },
  success: { src: '/brand/tokey-success.png', width: 425, height: 320 },
  error: { src: '/brand/tokey-error.png', width: 316, height: 316 },
  tip: { src: '/brand/tokey-tip.png', width: 377, height: 317 },
  settings: { src: '/brand/tokey-settings.png', width: 317, height: 317 },
};

/** Rendered widths, on the 4px grid. */
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
  const art = ART[state];
  const width = SIZE[size];
  const height = Math.round((width / art.width) * art.height);

  return (
    <Image
      src={art.src}
      alt=""
      aria-hidden="true"
      width={width}
      height={height}
      // Sources are ~320-450px wide, so even the largest use is served at
      // better than 2x without a second asset.
      sizes={`${width}px`}
      data-testid={`tokey-${state}`}
      className={className}
      priority={state === 'greeting'}
    />
  );
}
