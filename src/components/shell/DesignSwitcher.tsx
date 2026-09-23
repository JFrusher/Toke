'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useDesignStore } from '@/engine/store/useDesignStore';

/**
 * Switches between the designs in a project.
 *
 * Place cards and menus for the same wedding share one dataset and one file,
 * so the switcher sits in the header beside the project name rather than in a
 * panel — it changes what the whole studio is pointed at.
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
    <div className="flex items-center gap-1">
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
          className="h-7 w-36 rounded-[2px] border border-border-control bg-panel-raised px-1.5 text-[12px] text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
        />
      ) : (
        <select
          value={designId}
          onChange={(event) => switchTo(event.target.value)}
          aria-label="Design"
          data-testid="design-switcher"
          className="h-7 rounded-[2px] border border-border-control bg-panel-raised px-1.5 text-[12px] text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
        >
          {all.map((design) => (
            <option key={design.id} value={design.id}>
              {design.name}
            </option>
          ))}
        </select>
      )}

      <Button variant="quiet" onClick={() => setRenaming(true)} data-testid="design-rename">
        Rename
      </Button>
      <Button
        variant="quiet"
        onClick={() => addDesign(`Design ${all.length + 1}`)}
        data-testid="design-add"
      >
        New design
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
  );
}
