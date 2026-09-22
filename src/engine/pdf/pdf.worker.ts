/// <reference lib="webworker" />

import { exportProof, exportSheets } from '@/engine/pdf/assemble';
import type { ExportJob, ExportMessage, ExportRequest } from '@/engine/pdf/exportProtocol';
import { clearFonts, loadFont, registerFont } from '@/engine/text/fontLoader';
import { appError } from '@/lib/errors';
import { isErr } from '@/lib/result';

/**
 * Runs an export off the main thread, so a 500-card run does not freeze the
 * studio while it renders.
 *
 * One job at a time by design: an export is a user-initiated, user-visible
 * action with a progress bar, and two concurrent ones would only compete for
 * the same memory budget. A second request while one is running is refused
 * rather than queued.
 */

let running = false;
let cancelled = false;

function send(message: ExportMessage): void {
  self.postMessage(message);
}

/**
 * Loads the job's fonts into this worker's registry.
 *
 * The registry is module-global and the worker has its own module scope, so
 * nothing the UI registered is visible here. Cleared first: a previous job's
 * faces would otherwise shadow this one's and silently export the wrong
 * typeface.
 */
function installFonts(job: ExportJob): ReturnType<typeof appError> | null {
  clearFonts();

  for (const font of job.fonts) {
    const loaded = loadFont(font.bytes, {
      family: font.family,
      weight: font.weight,
      italic: font.italic,
    });
    if (isErr(loaded)) return loaded.error;
    registerFont(loaded.value);
  }

  return null;
}

async function run(request: Extract<ExportRequest, { op: 'export' | 'proof' }>): Promise<void> {
  const { job } = request;

  const fontError = installFonts(job);
  if (fontError !== null) {
    send({ op: 'failed', error: fontError });
    return;
  }

  const assets = new Map(job.assets);

  if (request.op === 'proof') {
    const row = job.rows[0] ?? {};
    const result = await exportProof({ nodes: job.nodes, row, design: job.design, assets });
    if (isErr(result)) send({ op: 'failed', error: result.error });
    else
      send({
        op: 'done',
        bytes: result.value,
        sheetCount: 1,
        nUp: 1,
        recordsRendered: 1,
        emptyCells: 0,
      });
    return;
  }

  const result = await exportSheets({
    nodes: job.nodes,
    rows: job.rows,
    sheet: job.sheet,
    design: job.design,
    margin: job.margin,
    cropMarks: job.cropMarks,
    assets,
    onProgress: (fraction, sheet) => {
      send({ op: 'progress', fraction, sheet });
    },
    // Checked between sheets. Finer granularity would mean threading a signal
    // through every draw call for a cancellation the user cannot perceive.
    shouldCancel: () => cancelled,
  });

  if (cancelled) {
    send({ op: 'cancelled' });
    return;
  }

  if (isErr(result)) {
    send({ op: 'failed', error: result.error });
    return;
  }

  const { bytes, sheetCount, nUp, recordsRendered, emptyCells } = result.value;
  // Transferred, not copied: a 50-sheet export is megabytes, and a structured
  // clone of it doubles peak memory at exactly the worst moment.
  self.postMessage({ op: 'done', bytes, sheetCount, nUp, recordsRendered, emptyCells }, [
    bytes.buffer as ArrayBuffer,
  ]);
}

self.onmessage = async (event: MessageEvent<ExportRequest>) => {
  const request = event.data;

  if (request.op === 'cancel') {
    cancelled = true;
    return;
  }

  if (running) {
    send({
      op: 'failed',
      error: appError('EXPORT_BUSY', 'An export is already running.', {
        hint: 'Wait for it to finish, or cancel it first.',
      }),
    });
    return;
  }

  running = true;
  cancelled = false;

  try {
    await run(request);
  } catch (error) {
    // A throw here would be an unhandled rejection inside the worker, which
    // leaves the UI waiting on a progress bar that never moves again.
    const message = error instanceof Error ? error.message : String(error);
    send({ op: 'failed', error: appError('EXPORT_FAILED', message) });
  } finally {
    running = false;
  }
};
