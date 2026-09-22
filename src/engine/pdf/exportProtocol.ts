import type { DesignSpec, SheetSpec } from '@/engine/imposition/specs';
import type { FontWeight, SceneNode } from '@/engine/scene/types';
import type { Points } from '@/engine/units/types';
import type { AppError } from '@/lib/errors';

/**
 * Wire format between the main thread and `pdf.worker.ts`.
 *
 * Everything here is structured-cloneable. Fabric objects never appear —
 * the scene is serialised to plain `SceneNode`s first (CLAUDE.md §2.1), and
 * fonts and assets cross as raw bytes rather than as registry handles, since
 * the worker has its own module scope and shares no registry with the UI.
 */

export type ExportFont = {
  readonly family: string;
  readonly weight: FontWeight;
  readonly italic: boolean;
  readonly bytes: Uint8Array;
};

export type ExportJob = {
  readonly nodes: readonly SceneNode[];
  readonly rows: readonly Record<string, unknown>[];
  readonly sheet: SheetSpec;
  readonly design: DesignSpec;
  readonly margin: Points;
  readonly cropMarks: boolean;
  readonly fonts: readonly ExportFont[];
  readonly assets: readonly (readonly [string, Uint8Array])[];
};

export type ExportRequest =
  | { readonly op: 'export'; readonly job: ExportJob }
  | { readonly op: 'proof'; readonly job: ExportJob }
  | { readonly op: 'cancel' };

export type ExportMessage =
  | { readonly op: 'progress'; readonly fraction: number; readonly sheet: number }
  | {
      readonly op: 'done';
      readonly bytes: Uint8Array;
      readonly sheetCount: number;
      readonly nUp: number;
      readonly recordsRendered: number;
      readonly emptyCells: number;
    }
  | { readonly op: 'failed'; readonly error: AppError }
  | { readonly op: 'cancelled' };
