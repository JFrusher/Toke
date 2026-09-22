'use client';

import { Tokey } from '@/components/brand/Tokey';
import { Button } from '@/components/ui/Button';
import { useShellStore } from '@/engine/store/useShellStore';
import { TUTORIAL } from '@/engine/templates/tutorial';

/**
 * The guided first run, docked beside the canvas.
 *
 * A panel rather than an overlay or a coach-mark sequence: the whole point is
 * to do the steps in the real studio, and anything that covers the studio to
 * explain the studio is working against itself. Nothing here blocks the
 * interface, and it closes for good on the first dismissal.
 *
 * This is onboarding, so Tokey belongs (CLAUDE.md §4.8).
 */
export function TutorialPanel() {
  const step = useShellStore((s) => s.tutorialStep);
  const setStep = useShellStore((s) => s.setTutorialStep);
  const dismiss = useShellStore((s) => s.dismissTutorial);

  const current = TUTORIAL[step];
  if (current === undefined) return null;

  const isLast = step === TUTORIAL.length - 1;

  return (
    <aside
      aria-label="Tutorial"
      data-testid="tutorial-panel"
      className="flex w-72 shrink-0 flex-col gap-3 overflow-auto border-hairline-strong border-l bg-panel p-3"
    >
      <div className="flex items-start gap-2">
        <Tokey state={current.mascot} size="sm" className="shrink-0" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span data-numeric className="text-[11px] text-ink-subtle">
            Step {step + 1} of {TUTORIAL.length}
          </span>
          <h2 className="font-medium text-[13px] text-ink">{current.title}</h2>
        </div>
      </div>

      <p className="text-[12px] text-ink-muted leading-[1.5]">{current.body}</p>

      <p className="border-accent border-l-2 pl-2 text-[12px] text-ink">
        <span className="text-ink-muted">You will know it worked when: </span>
        {current.confirm}
      </p>

      {/* Progress as a labelled count, not a bar: a bar with seven segments at
          this width is decoration, and the number is what the reader wants. */}
      <ol className="flex gap-1" aria-hidden="true">
        {TUTORIAL.map((entry, index) => (
          <li
            key={entry.id}
            className={`h-0.5 flex-1 ${index <= step ? 'bg-accent' : 'bg-hairline-strong'}`}
          />
        ))}
      </ol>

      <div className="mt-auto flex items-center gap-1.5">
        <Button
          variant="quiet"
          onClick={() => setStep(step - 1)}
          disabled={step === 0}
          data-testid="tutorial-back"
        >
          Back
        </Button>

        {isLast ? (
          <Button onClick={dismiss} data-testid="tutorial-finish" className="ml-auto">
            Finish
          </Button>
        ) : (
          <Button onClick={() => setStep(step + 1)} data-testid="tutorial-next" className="ml-auto">
            Next
          </Button>
        )}

        <Button variant="quiet" onClick={dismiss} data-testid="tutorial-dismiss">
          Close
        </Button>
      </div>
    </aside>
  );
}
