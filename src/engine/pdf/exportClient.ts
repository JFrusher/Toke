import type { ExportJob, ExportMessage, ExportRequest } from '@/engine/pdf/exportProtocol';
import { getAsset } from '@/engine/persistence/assetStore';
import type { SceneNode as Node, SceneNode, TextNode } from '@/engine/scene/types';
import { walk } from '@/engine/scene/types';
import { getFont, registeredFonts } from '@/engine/text/fontLoader';
import { appError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

/**
 * Drives `pdf.worker.ts` from the main thread.
 *
 * Kept separate from the worker so the UI can be tested without spawning one,
 * and so the scene → plain-data serialisation happens in exactly one place.
 */

export type ExportHandle = {
  readonly result: Promise<Result<{ bytes: Uint8Array; sheetCount: number; emptyCells: number }>>;
  /** Asks the worker to stop between sheets. */
  cancel: () => void;
};

/**
 * Every registered face, as bytes.
 *
 * The worker has its own module scope and therefore its own empty font
 * registry; sending only the faces the scene references would break the
 * moment a token resolved to text in a fallback face.
 */
export function fontsForExport(nodes?: readonly SceneNode[]): ExportJob['fonts'] {
  // With a scene, only the faces it actually resolves to. Every face is ~218KB
  // copied across the worker boundary, so sending the whole registry for a
  // card that uses one weight quadruples the payload for nothing.
  //
  // The face getFont RESOLVES to is what is sent, not the one requested: when
  // a weight falls back, the worker's own getFont makes the same choice from
  // the same family, so canvas and PDF still read one file.
  const faces =
    nodes === undefined
      ? registeredFonts()
      : [
          ...new Set(
            [...walk(nodes)]
              .filter((node): node is TextNode => node.kind === 'text')
              .map((node) => getFont(node.fontFamily, node.fontWeight, node.italic))
              .filter((font): font is NonNullable<typeof font> => font !== null),
          ),
        ];

  return faces.map((font) => ({
    // cssFamily, NOT family: the design references the family it was
    // registered under, while `family` is whatever the file calls itself —
    // "IBM Plex Sans SemiBold" for a face a design knows as "IBM Plex Sans",
    // and the foundry's own string for an uploaded one. Sending the wrong one
    // means the worker cannot find the face and the export fails.
    family: font.cssFamily,
    weight: font.weight,
    italic: font.italic,
    bytes: font.bytes,
  }));
}

/**
 * Reads every asset the scene references out of the store, as bytes.
 *
 * Resolved on the main thread and handed to the worker: the PDF worker never
 * touches IndexedDB, which keeps it off a store the autosave is also writing
 * to (CLAUDE.md §2.1).
 */
export async function assetsForExport(nodes: readonly SceneNode[]): Promise<ExportJob['assets']> {
  const ids = new Set<string>();

  const walk = (list: readonly Node[]) => {
    for (const node of list) {
      if (node.kind === 'image') ids.add(node.assetId);
      if (node.kind === 'group') walk(node.children);
    }
  };
  walk(nodes);

  const resolved: [string, Uint8Array][] = [];
  for (const id of ids) {
    const asset = await getAsset(id);
    // A missing asset is NOT skipped here: the renderer raises
    // PDF_ASSET_MISSING for it, which is a named failure rather than a card
    // exported with a hole in it.
    if (asset.ok) resolved.push([id, asset.value.bytes]);
  }

  return resolved;
}

export function startExport(
  worker: Worker,
  job: Omit<ExportJob, 'fonts'> & { fonts?: ExportJob['fonts'] },
  onProgress?: (fraction: number) => void,
  /** 'proof' renders one record at trim size with no imposition or marks. */
  op: 'export' | 'proof' = 'export',
): ExportHandle {
  const payload: ExportJob = { ...job, fonts: job.fonts ?? fontsForExport(job.nodes) };

  const result = new Promise<Result<{ bytes: Uint8Array; sheetCount: number; emptyCells: number }>>(
    (resolve) => {
      worker.onmessage = (event: MessageEvent<ExportMessage>) => {
        const message = event.data;

        if (message.op === 'progress') {
          onProgress?.(message.fraction);
          return;
        }

        // Detached before resolving: a late progress message after the handler
        // is gone would otherwise throw inside the event loop.
        worker.onmessage = null;

        if (message.op === 'done') {
          resolve(
            ok({
              bytes: message.bytes,
              sheetCount: message.sheetCount,
              emptyCells: message.emptyCells,
            }),
          );
          return;
        }

        resolve(
          message.op === 'cancelled'
            ? err(appError('EXPORT_CANCELLED', 'The export was cancelled.'))
            : err(message.error),
        );
      };

      worker.onerror = (event) => {
        worker.onmessage = null;
        resolve(err(appError('EXPORT_FAILED', event.message || 'The export worker crashed.')));
      };
    },
  );

  const request: ExportRequest = { op, job: payload };
  worker.postMessage(request);

  return {
    result,
    cancel: () => {
      const cancel: ExportRequest = { op: 'cancel' };
      worker.postMessage(cancel);
    },
  };
}

/** Hands the bytes to the browser as a download. Nothing leaves the machine. */
export function downloadPdf(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  // Revoked on the next tick: revoking synchronously races the click in
  // Safari and produces an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Strips anything a scene node carries that cannot be structured-cloned. */
export function serialiseForExport(nodes: readonly SceneNode[]): readonly SceneNode[] {
  return JSON.parse(JSON.stringify(nodes)) as readonly SceneNode[];
}
