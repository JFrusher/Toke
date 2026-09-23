'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { FontWeight, TextNode } from '@/engine/scene/types';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { reportDiagnostic } from '@/engine/store/useDiagnosticsStore';
import { useFontStore } from '@/engine/store/useFontStore';
import { registeredFonts } from '@/engine/text/fontLoader';
import { isErr } from '@/lib/result';

/**
 * Typeface, weight and slant for the selected text.
 *
 * The family list is the font REGISTRY, not a hardcoded list: whatever has
 * been loaded — bundled or uploaded — is what can be chosen, so the picker can
 * never offer a face the PDF renderer cannot embed.
 */
export function TypographyPanel() {
  const nodes = useCanvasStore((s) => s.nodes);
  const selection = useCanvasStore((s) => s.selection);
  const replaceNodes = useCanvasStore((s) => s.replaceNodes);
  // Subscribed so an upload re-renders the list; the registry itself is a
  // module-level map and would not trigger React on its own.
  const version = useFontStore((s) => s.version);
  const addFont = useFontStore((s) => s.addFont);

  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const selected = nodes.filter((node) => selection.includes(node.id));
  const node = selected.length === 1 ? selected[0] : undefined;

  // `version` is read so the list refreshes after an upload.
  const families = [...new Set(registeredFonts().map((font) => font.cssFamily))].sort();
  void version;

  async function upload(file: File | undefined) {
    if (file === undefined) return;
    setBusy(true);
    try {
      const result = await addFont(file);
      if (isErr(result)) reportDiagnostic('fonts', 'error', result.error);
    } finally {
      setBusy(false);
      if (input.current !== null) input.current.value = '';
    }
  }

  function update(patch: Partial<TextNode>, label: string) {
    if (node === undefined) return;
    replaceNodes(
      nodes.map((current) =>
        current.id === node.id && current.kind === 'text' ? { ...current, ...patch } : current,
      ),
      label,
    );
  }

  const text = node?.kind === 'text' ? node : undefined;

  return (
    <section className="flex flex-col gap-2 border-hairline border-b p-3">
      <h2 className="font-medium text-[11px] text-ink-muted">Typography</h2>

      <label className="flex items-center gap-1.5">
        <span className="w-12 shrink-0 text-[11px] text-ink-muted">Family</span>
        <select
          value={text?.fontFamily ?? ''}
          disabled={text === undefined}
          onChange={(event) => update({ fontFamily: event.target.value }, 'Set typeface')}
          data-testid="font-family"
          className="h-6 min-w-0 flex-1 rounded-[2px] border border-border-control bg-panel-raised px-1 text-[11px] text-ink disabled:text-ink-disabled focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
        >
          {families.map((family) => (
            <option key={family} value={family}>
              {family}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5">
        <span className="w-12 shrink-0 text-[11px] text-ink-muted">Weight</span>
        <select
          value={text?.fontWeight ?? 400}
          disabled={text === undefined}
          onChange={(event) =>
            update({ fontWeight: Number(event.target.value) as FontWeight }, 'Set weight')
          }
          data-testid="font-weight"
          className="h-6 min-w-0 flex-1 rounded-[2px] border border-border-control bg-panel-raised px-1 text-[11px] text-ink disabled:text-ink-disabled focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
        >
          {([400, 500, 600] as const).map((weight) => (
            <option key={weight} value={weight}>
              {weight}
            </option>
          ))}
        </select>
      </label>

      <Button
        variant="quiet"
        disabled={busy}
        onClick={() => input.current?.click()}
        data-testid="font-upload"
      >
        {busy ? 'Loading…' : 'Add a typeface'}
      </Button>

      <input
        ref={input}
        type="file"
        accept=".ttf,.otf,font/ttf,font/otf"
        aria-label="Add a typeface"
        data-testid="font-file"
        onChange={(event) => void upload(event.target.files?.[0])}
        className="sr-only"
      />

      <p className="text-[11px] text-ink-subtle">
        TrueType or OpenType. The file travels inside the project, so it opens the same on another
        machine.
      </p>
    </section>
  );
}
