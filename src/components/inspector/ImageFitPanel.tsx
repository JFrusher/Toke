'use client';

import { Button } from '@/components/ui/Button';
import { normaliseCrop } from '@/engine/scene/image';
import type { CropRect, ImageFit, SceneNode } from '@/engine/scene/types';
import { FULL_CROP } from '@/engine/scene/types';
import { useCanvasStore } from '@/engine/store/useCanvasStore';

/**
 * How a photo sits inside its frame.
 *
 * Three modes, each described by what it does to the picture rather than by
 * its name — "cover" means nothing to someone laying out a place card, and
 * choosing the wrong one is only obvious after the cards are cut.
 */

const MODES: readonly { value: ImageFit; label: string; detail: string }[] = [
  { value: 'contain', label: 'Fit', detail: 'Whole image, space on one side' },
  { value: 'cover', label: 'Fill', detail: 'Fills the frame, crops the overflow' },
  { value: 'fill', label: 'Stretch', detail: 'Distorts to the frame' },
];

function isImage(node: SceneNode): node is Extract<SceneNode, { kind: 'image' }> {
  return node.kind === 'image';
}

export function ImageFitPanel() {
  const nodes = useCanvasStore((s) => s.nodes);
  const selection = useCanvasStore((s) => s.selection);
  const replaceNodes = useCanvasStore((s) => s.replaceNodes);

  function setCrop(id: string, crop: CropRect) {
    const safe = normaliseCrop(crop);
    replaceNodes(
      nodes.map((current) =>
        current.id === id && current.kind === 'image' ? { ...current, crop: safe } : current,
      ),
      'Crop image',
      // Typing into a percentage field is one gesture, not one command per
      // keystroke.
      `crop:${id}`,
    );
  }

  const selected = nodes.filter((node) => selection.includes(node.id)).filter(isImage);
  const node = selected[0];

  // Nothing to show unless exactly one image is selected; a mixed selection
  // would have to pick one node's value to display and silently apply it to
  // the rest.
  if (selected.length !== 1 || node === undefined) return null;

  return (
    <div className="flex flex-col gap-2 border-hairline border-t p-3">
      <h2 className="font-medium text-[11px] text-ink-muted">Image</h2>

      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Image fit</legend>
        {MODES.map((mode) => (
          <label
            key={mode.value}
            className="flex cursor-pointer items-baseline gap-1.5 text-[12px] text-ink"
          >
            <input
              type="radio"
              name="image-fit"
              checked={node.fit === mode.value}
              onChange={() =>
                replaceNodes(
                  // Narrowed on kind as well as id: spreading onto the untyped
                  // union would widen every node in the scene.
                  nodes.map((current) =>
                    current.id === node.id && current.kind === 'image'
                      ? { ...current, fit: mode.value }
                      : current,
                  ),
                  `Image fit: ${mode.label.toLowerCase()}`,
                )
              }
              data-testid={`image-fit-${mode.value}`}
              className="accent-accent"
            />
            <span className="w-12 shrink-0">{mode.label}</span>
            <span className="text-[11px] text-ink-subtle">{mode.detail}</span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-muted">Crop</span>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {(
            [
              ['x', 'Left'],
              ['y', 'Top'],
              ['width', 'Width'],
              ['height', 'Height'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1">
              <span className="w-10 shrink-0 text-[11px] text-ink-muted">{label}</span>
              <input
                data-numeric
                data-testid={`crop-${key}`}
                // Percentages, because a crop is a fraction of the source and
                // showing it in millimetres would imply it moves with the
                // frame.
                value={Math.round(node.crop[key] * 100)}
                onChange={(event) => {
                  const next = Number(event.target.value) / 100;
                  if (!Number.isFinite(next)) return;
                  setCrop(node.id, { ...node.crop, [key]: next });
                }}
                type="number"
                min={0}
                max={100}
                className="h-6 w-full min-w-0 rounded-[2px] border border-border-control bg-panel-raised px-1 text-[11px] text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
              />
              <span className="text-[11px] text-ink-subtle">%</span>
            </label>
          ))}
        </div>

        <Button
          variant="quiet"
          onClick={() => setCrop(node.id, FULL_CROP)}
          disabled={node.crop.width === 1 && node.crop.height === 1}
          data-testid="crop-reset"
        >
          Show the whole image
        </Button>
      </div>
    </div>
  );
}
