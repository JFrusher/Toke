import { designSpec } from '@/engine/imposition/specs';
import type { TokeImposition, TokeProject } from '@/engine/persistence/tokeFile';
import type { SceneNode } from '@/engine/scene/types';
import { millimetresToPoints } from '@/engine/units/convert';
import { millimetres, points } from '@/engine/units/types';

/**
 * Assembles a TokeProject from live editor state and applies one back.
 *
 * Kept separate from the stores so it stays a pure function of its inputs and
 * can be tested without mounting anything.
 */

/**
 * Record source a new project starts with. Lives here rather than in a
 * component: the boundary test in engine/db/boundaries.test.ts enforces that
 * no component contains raw SQL, and a default is still SQL.
 */
export const DEFAULT_RECORD_SOURCE = 'SELECT * FROM guests';

const DEFAULT_IMPOSITION: TokeImposition = {
  sheet: 'a4',
  orientation: 'portrait',
  margin: millimetresToPoints(millimetres(10)),
  sharedCut: true,
};

export type EditorState = {
  readonly name: string;
  readonly nodes: readonly SceneNode[];
  readonly artboard: { readonly width: number; readonly height: number };
  readonly recordSource: string;
  readonly database: Uint8Array;
  readonly assets: TokeProject['assets'];
  readonly fonts: TokeProject['fonts'];
  readonly imposition?: TokeImposition;
};

export function toProject(state: EditorState): TokeProject {
  return {
    name: state.name,
    designs: [
      {
        id: 'design-1',
        name: state.name,
        spec: designSpec({
          width: points(state.artboard.width),
          height: points(state.artboard.height),
          bleed: millimetresToPoints(millimetres(3)),
        }),
        recordSource: state.recordSource,
        nodes: state.nodes,
      },
    ],
    imposition: state.imposition ?? DEFAULT_IMPOSITION,
    database: state.database,
    assets: state.assets,
    fonts: state.fonts,
  };
}

export type AppliedProject = {
  readonly name: string;
  readonly nodes: readonly SceneNode[];
  readonly artboard: { readonly width: number; readonly height: number };
  readonly recordSource: string;
  readonly database: Uint8Array;
};

/** v1 opens the first design. The format holds many (see tokeFile.ts); the
 *  UI to switch between them is not built yet. */
export function fromProject(project: TokeProject): AppliedProject {
  const design = project.designs[0];

  return {
    name: project.name,
    nodes: design?.nodes ?? [],
    artboard: {
      width: design?.spec.trim.width ?? millimetresToPoints(millimetres(85)),
      height: design?.spec.trim.height ?? millimetresToPoints(millimetres(55)),
    },
    recordSource: design?.recordSource ?? DEFAULT_RECORD_SOURCE,
    database: project.database,
  };
}
