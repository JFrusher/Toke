'use client';

import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'default' | 'primary' | 'quiet' | 'danger';

const VARIANTS: Record<Variant, string> = {
  default:
    'bg-panel-raised text-ink border-border-control hover:bg-accent-weak active:bg-accent-weak',
  primary: 'bg-accent text-paper border-accent hover:opacity-90 active:opacity-100',
  quiet: 'bg-transparent text-ink-muted border-transparent hover:bg-accent-weak hover:text-ink',
  danger: 'bg-panel-raised text-overflow border-border-control hover:bg-overflow hover:text-paper',
};

/**
 * 28px control height, 2px radius, 1px hairline — CLAUDE.md §4.4.
 * Hand-written rather than pulled from a component library: at this size the
 * whole thing is a class string, and a dependency would only add indirection.
 */
export function Button({
  variant = 'default',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-[2px] border px-2.5',
        'text-[12px] font-medium leading-none',
        'transition-colors duration-[120ms] ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:text-ink-disabled disabled:bg-panel',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
