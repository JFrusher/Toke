'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useDesignStore } from '@/engine/store/useDesignStore';

/**
 * The designs in a project, above the layers.
 *
 * Place cards and menus for the same wedding share one dataset and one file.
 * A list at the top of the left sidebar is where every layout tool keeps its
 * pages or artboards, and it reads faster than a dropdown. It used to sit in
 * the header, which made the header too wide to stay on one line.
 */
export function DesignSwitcher() {
  const designId = useDesignStore((s) => s.designId);
  const designName = useDesignStore((s) => s.designName);
  const others = useDesignStore((s) => s.others);
  const switchTo = useDesignStore((s) => s.switchTo);
  const addDesign = useDesignStore((s) => s.addDesign);
  const renameDesign = useDesignStore((s) => s.renameDesign);
  const removeDesign = useDesignStore((s) => s.removeDesign);

  const [renaming, setRenaming] = useState(false);

  const all = [{ id: designId, name: designName }, ...others].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  return (
    <section className="flex shrink-0 flex-col gap-1.5 border-hairline border-b p-3">
      <h2 className="font-medium text-[11px] text-ink-muted">Designs</h2>

      {renaming ? (
        <input
          defaultValue={designName}
          aria-label="Design name"
          data-testid="design-name"
          onBlur={(event) => {
            renameDesign(designId, event.target.value);
            setRenaming(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') setRenaming(false);
          }}
          className="h-7 w-full rounded-[2px] border border-border-control bg-panel-raised px-1.5 text-[12px] text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
        />
      ) : (
        <select
          value={designId}
          onChange={(event) => switchTo(event.target.value)}
          aria-label="Design"
          data-testid="design-switcher"
          className="h-7 w-full rounded-[2px] border border-border-control bg-panel-raised px-1.5 text-[12px] text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
        >
          {all.map((design) => (
            <option key={design.id} value={design.id}>
              {design.name}
            </option>
          ))}
        </select>
      )}

      <div className="flex flex-wrap gap-1">
        <Button
          variant="quiet"
          onClick={() => addDesign(`Design ${all.length + 1}`)}
          data-testid="design-add"
        >
          New
        </Button>
        <Button variant="quiet" onClick={() => setRenaming(true)} data-testid="design-rename">
          Rename
        </Button>
        <Button
          variant="quiet"
          onClick={() => removeDesign(designId)}
          // The last design stays: a project with none has nothing to print.
          disabled={others.length === 0}
          data-testid="design-remove"
        >
          Remove
        </Button>
      </div>
    </section>
  );
}
