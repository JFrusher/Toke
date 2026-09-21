'use client';

import { Button } from '@/components/ui/Button';
import type { AutoFitConfig, TextNode } from '@/engine/scene/types';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useDataStore } from '@/engine/store/useDataStore';
import { FORMATTER_NAMES, isTokenised, parseTokens } from '@/engine/tokens/parser';
import { points } from '@/engine/units/types';
import { cn } from '@/lib/cn';

const MODES: readonly { value: AutoFitConfig['mode']; label: string; hint: string }[] = [
  { value: 'shrink', label: 'Shrink', hint: 'Reduce the size until it fits' },
  { value: 'truncate', label: 'Truncate', hint: 'Cut with an ellipsis' },
  { value: 'wrap', label: 'Wrap', hint: 'Break onto more lines' },
];

export function TokenBindingPanel() {
  const nodes = useCanvasStore((s) => s.nodes);
  const selection = useCanvasStore((s) => s.selection);
  const replaceNodes = useCanvasStore((s) => s.replaceNodes);
  const columns = useDataStore((s) => s.columns);

  const selected = nodes.filter((node) => selection.includes(node.id));
  const node = selected.length === 1 ? selected[0] : undefined;

  if (node === undefined || node.kind !== 'text') {
    return (
      <section className="border-hairline border-b p-3">
        <h2 className="font-semibold text-[11px] text-ink-muted uppercase tracking-[0.06em]">
          Binding
        </h2>
        <p className="mt-1.5 text-[12px] text-ink-subtle">Select one text object.</p>
      </section>
    );
  }

  const text = node as TextNode;
  const bound = isTokenised(text.text);
  const parsed = parseTokens(text.text);
  const problem = parsed.ok ? null : parsed.error;

  function update(patch: Partial<TextNode>, label: string) {
    replaceNodes(
      // Narrowed on kind as well as id: spreading a Partial<TextNode> onto
      // the untyped union would widen every node in the scene.
      nodes.map((current) =>
        current.id === text.id && current.kind === 'text' ? { ...current, ...patch } : current,
      ),
      label,
    );
  }

  function insertToken(column: string) {
    // Appended rather than replacing, so a design like
    // "{{ first_name }} {{ last_name }}" is built by clicking twice.
    const separator = text.text === '' || text.text.endsWith(' ') ? '' : ' ';
    update({ text: `${text.text}${separator}{{ ${column} }}` }, `Bind ${column}`);
  }

  return (
    <section className="flex flex-col gap-2.5 border-hairline border-b p-3">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold text-[11px] text-ink-muted uppercase tracking-[0.06em]">
          Binding
        </h2>
        {bound && (
          <span
            data-testid="bound-badge"
            className="rounded-[2px] bg-accent-weak px-1 py-px text-[10px] text-bound"
          >
            bound
          </span>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-muted">Text</span>
        <textarea
          data-testid="binding-text"
          value={text.text}
          rows={2}
          onChange={(event) => update({ text: event.target.value }, 'Edit text')}
          className="resize-none rounded-[2px] border border-border-control bg-panel-raised px-1.5 py-1 font-mono text-[11px] text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
        />
      </label>

      {problem !== null && (
        <p role="alert" data-testid="binding-error" className="text-[11px] text-overflow">
          {problem.message}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-muted">Insert field</span>
        {columns.length === 0 ? (
          <p className="text-[11px] text-ink-subtle">Import data to bind fields.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {columns.map((column) => (
              <button
                key={column.name}
                type="button"
                data-testid={`insert-${column.name}`}
                onClick={() => insertToken(column.name)}
                className="rounded-[2px] border border-border-control bg-panel-raised px-1.5 py-0.5 font-mono text-[10px] text-ink hover:bg-accent-weak focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
              >
                {column.name}
              </button>
            ))}
          </div>
        )}
        <p className="text-[10px] text-ink-subtle">
          Formatters: {FORMATTER_NAMES.join(', ')} — {'{{ last_name | upper }}'}
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-muted">Fallback when empty</span>
        <input
          data-testid="binding-fallback"
          value={text.fallback}
          placeholder="leave blank to print nothing"
          onChange={(event) => update({ fallback: event.target.value }, 'Set fallback')}
          className="h-6 rounded-[2px] border border-border-control bg-panel-raised px-1.5 text-[12px] text-ink placeholder:text-ink-subtle focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
        />
      </label>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-[11px] text-ink-muted">When it does not fit</legend>
        <div className="flex gap-1">
          {MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              title={mode.hint}
              aria-pressed={text.autoFit?.mode === mode.value}
              data-testid={`autofit-${mode.value}`}
              onClick={() =>
                update(
                  {
                    autoFit: {
                      mode: mode.value,
                      minFontSize: text.autoFit?.minFontSize ?? points(6),
                    },
                  },
                  `Auto-fit ${mode.value}`,
                )
              }
              className={cn(
                'h-6 flex-1 rounded-[2px] border px-1 text-[11px]',
                'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1',
                text.autoFit?.mode === mode.value
                  ? 'border-accent bg-accent text-paper'
                  : 'border-border-control bg-panel-raised text-ink hover:bg-accent-weak',
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <Button
          variant="quiet"
          onClick={() => update({ autoFit: null }, 'Auto-fit off')}
          className={text.autoFit === null ? 'text-accent' : ''}
        >
          {text.autoFit === null ? 'Auto-fit off' : 'Turn auto-fit off'}
        </Button>
      </fieldset>
    </section>
  );
}
