'use client';

import { useRef, useState } from 'react';
import { addAsset, retainAsset } from '@/engine/persistence/assetStore';
import { imageNode } from '@/engine/scene/factories';
import { initialFrame, naturalSize } from '@/engine/scene/image';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { reportDiagnostic } from '@/engine/store/useDiagnosticsStore';
import { isErr, isOk } from '@/lib/result';

/**
 * Places a photo on the artboard.
 *
 * A file picker rather than a draw-then-fill tool: an image already has a size
 * and an aspect ratio, so asking the user to draw a box first only gives them
 * a box of the wrong shape to correct.
 *
 * Bytes go into the content-addressed asset store, so the same logo placed on
 * twenty cards is stored once and embedded in the PDF once.
 */
export function ImageImport() {
  const artboard = useCanvasStore((s) => s.artboard);
  const addNode = useCanvasStore((s) => s.addNode);

  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function place(file: File | undefined) {
    if (file === undefined) return;
    setBusy(true);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());

      // Checked here, not at export: a format the PDF cannot carry should be
      // refused while the user still has the original file to hand.
      const natural = naturalSize(bytes);
      if (isErr(natural)) {
        reportDiagnostic('image', 'error', natural.error);
        return;
      }

      const stored = await addAsset(new Blob([bytes as unknown as BlobPart], { type: file.type }));
      if (!isOk(stored)) {
        reportDiagnostic('image', 'error', stored.error);
        return;
      }

      await retainAsset(stored.value.id);

      addNode(
        imageNode({
          id: `image-${stored.value.id.slice(0, 8)}-${Date.now().toString(36)}`,
          assetId: stored.value.id,
          ...initialFrame(natural.value, artboard),
          // 'contain' by default: showing the whole picture is the answer that
          // is never surprising, and cropping is a decision the user makes.
          fit: 'contain',
        }),
      );
    } finally {
      setBusy(false);
      // Cleared so selecting the same file twice fires a change event again.
      if (input.current !== null) input.current.value = '';
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        title="Place an image"
        data-testid="tool-image"
        className="h-7 rounded-[2px] border border-transparent px-1.5 text-[11px] text-ink-muted transition-colors hover:bg-accent-weak hover:text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1 disabled:text-ink-disabled"
      >
        Image
      </button>

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        aria-label="Place an image"
        data-testid="image-file"
        onChange={(event) => void place(event.target.files?.[0])}
        className="sr-only"
      />
    </>
  );
}
