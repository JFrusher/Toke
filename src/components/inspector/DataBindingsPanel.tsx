'use client';

import type { BindableProperty, SceneNode } from '@/engine/scene/types';
import { walk } from '@/engine/scene/types';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useDataStore } from '@/engine/store/useDataStore';
import { useLibraryStore } from '@/engine/store/useLibraryStore';

/**
 * Binds an object's properties to record-source columns.
 *
 * The rule itself lives in the record source: a column computed with CASE,
 * a join, anything SQL can say. This panel only says which column drives
 * which property, so there is one rule language rather than two.
 */

const PROPERTIES: readonly {
  property: BindableProperty;
  label: string;
  applies: (node: SceneNode) => boolean;
}[] = [
  { property: 'visible', label: 'Show when', applies: () => true },
  { property: 'fill', label: 'Fill colour', applies: (node) => 'fill' in node },
  { property: 'stroke', label: 'Stroke colour', applies: (node) => 'stroke' in node },
  { property: 'asset', label: 'Image', applies: (node) => node.kind === 'image' },
  { property: 'x', label: 'X', applies: () => true },
  { property: 'y', label: 'Y', applies: () => true },
  { property: 'width', label: 'Width', applies: () => true },
  { property: 'height', label: 'Height', applies: () => true },
];

const HINT: Record<BindableProperty, string> = {
  visible: 'Hidden when the value is empty, 0, false or no.',
  fill: 'A hex colour such as #3D6B4A.',
  stroke: 'A hex colour such as #3D6B4A.',
  asset: 'The name of an image in the library.',
  x: 'A length; mm unless the value says otherwise.',
  y: 'A length; mm unless the value says otherwise.',
  width: 'A length; mm unless the value says otherwise.',
  height: 'A length; mm unless the value says otherwise.',
};

export function DataBindingsPanel() {
  const nodes = useCanvasStore((s) => s.nodes);
  const selection = useCanvasStore((s) => s.selection);
  const setBinding = useCanvasStore((s) => s.setBinding);
  const columns = useDataStore((s) => s.recordColumns);
  const libraryNames = useLibraryStore((s) => s.names);
  const addToLibrary = useLibraryStore((s) => s.add);

  const selected = [...walk(nodes)].filter((node) => selection.includes(node.id));
  const node = selected.length === 1 ? selected[0] : undefined;

  if (node === undefined) return null;

  const names = columns.map((column) => column.name);

  return (
    <section
      className="flex flex-col gap-2 border-hairline border-b p-3"
      data-testid="data-bindings"
    >
      <h2 className="font-medium text-[11px] text-ink-muted">Driven by data</h2>

      {PROPERTIES.filter(({ applies }) => applies(node)).map(({ property, label }) => {
        const bound = node.bind?.[property];
        // A column the record source no longer returns stays listed, so the
        // select can show what is bound and pre-flight's complaint makes sense.
        const options = bound === undefined || names.includes(bound) ? names : [...names, bound];

        return (
          <label key={property} className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] text-ink-muted">{label}</span>
              <select
                value={bound ?? ''}
                onChange={(event) =>
                  setBinding(
                    node.id,
                    property,
                    event.target.value === '' ? null : event.target.value,
                  )
                }
                aria-label={`${label} from column`}
                data-testid={`bind-${property}`}
                className="h-6 min-w-0 flex-1 rounded-[2px] border border-border-control bg-panel-raised px-1 font-mono text-[11px] text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
              >
                <option value="">As designed</option>
                {options.map((name) => (
                  <option key={name} value={name}>
                    {names.includes(name) ? name : `${name} (not in record source)`}
                  </option>
                ))}
              </select>
            </span>
            {bound !== undefined && (
              <span className="pl-22 text-[11px] text-ink-subtle">{HINT[property]}</span>
            )}
          </label>
        );
      })}

      {node.kind === 'image' && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-muted">Image library</span>
          {libraryNames.length === 0 ? (
            <p className="text-[11px] text-ink-subtle">No images yet.</p>
          ) : (
            <ul data-testid="library-names" className="font-mono text-[11px] text-ink">
              {libraryNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg"
            multiple
            aria-label="Add images to the library"
            data-testid="library-file"
            onChange={(event) => {
              void addToLibrary([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
            className="rounded-[2px] border border-border-control bg-panel-raised px-2 py-1 text-[11px] text-ink file:mr-2 file:rounded-[2px] file:border-0 file:bg-accent-weak file:px-2 file:py-0.5 file:text-[11px] file:text-accent focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
          />
        </div>
      )}
    </section>
  );
}
