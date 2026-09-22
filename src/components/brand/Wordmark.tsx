/**
 * The brace mark and the product name.
 *
 * The mark is the product's own syntax — a record between braces, with a face.
 * It is drawn inline rather than loaded as a file so it inherits `currentColor`
 * and needs no second request, and it is decorative here because the name is
 * right next to it in text.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`flex items-center gap-1.5 ${className ?? ''}`}>
      <svg
        viewBox="0 0 64 64"
        aria-hidden="true"
        focusable="false"
        className="h-4 w-4 shrink-0 text-accent"
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M24 14c-5 0-6 2.5-6 7v5c0 3.5-1.5 5-4 6.5 2.5 1.5 4 3 4 6.5v5c0 4.5 1 7 6 7" />
          <path d="M40 14c5 0 6 2.5 6 7v5c0 3.5 1.5 5 4 6.5-2.5 1.5-4 3-4 6.5v5c0 4.5-1 7-6 7" />
        </g>
        <g fill="currentColor">
          <circle cx="27.5" cy="32" r="3.4" />
          <circle cx="36.5" cy="32" r="3.4" />
        </g>
      </svg>
      <span className="font-semibold text-[13px] tracking-tight">toke</span>
    </span>
  );
}
