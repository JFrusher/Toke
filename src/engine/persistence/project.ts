import { designSpec } from '@/engine/imposition/specs';
import type { TokeDesign, TokeImposition, TokeProject } from '@/engine/persistence/tokeFile';
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

/** One design as the editor holds it. */
export type EditorDesign = {
  readonly id: string;
  readonly name: string;
  readonly nodes: readonly SceneNode[];
  readonly artboard: { readonly width: number; readonly height: number };
  readonly recordSource: string;
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
  /**
   * The designs NOT currently open, carried through unchanged.
   *
   * `nodes` and `artboard` above are the open one. Keeping the rest separate
   * means saving cannot lose a design just because it is not on screen — which
   * is what happened while `toProject` always wrote exactly one.
   */
  readonly otherDesigns?: readonly EditorDesign[];
  readonly designId?: string;
  readonly designName?: string;
};

function toTokeDesign(design: EditorDesign): TokeDesign {
  return {
    id: design.id,
    name: design.name,
    spec: designSpec({
      width: points(design.artboard.width),
      height: points(design.artboard.height),
      bleed: millimetresToPoints(millimetres(3)),
    }),
    recordSource: design.recordSource,
    nodes: design.nodes,
  };
}

export function toProject(state: EditorState): TokeProject {
  const open: EditorDesign = {
    id: state.designId ?? 'design-1',
    name: state.designName ?? state.name,
    nodes: state.nodes,
    artboard: state.artboard,
    recordSource: state.recordSource,
  };

  // The open design is written in place, so switching designs and saving does
  // not reorder the file.
  const others = state.otherDesigns ?? [];
  const all = others.some((design) => design.id === open.id)
    ? others.map((design) => (design.id === open.id ? open : design))
    : [...others, open];

  return {
    name: state.name,
    designs: all.map(toTokeDesign),
    imposition: state.imposition ?? DEFAULT_IMPOSITION,
    database: state.database,
    assets: state.assets,
    fonts: state.fonts,
  };
}

export type AppliedProject = {
  readonly name: string;
  readonly designId: string;
  readonly designName: string;
  readonly nodes: readonly SceneNode[];
  readonly artboard: { readonly width: number; readonly height: number };
  readonly recordSource: string;
  readonly database: Uint8Array;
  readonly otherDesigns: readonly EditorDesign[];
};

/** Opens one design by id, defaulting to the first. */
export function fromProject(project: TokeProject, designId?: string): AppliedProject {
  const design = project.designs.find((entry) => entry.id === designId) ?? project.designs[0];

  return {
    name: project.name,
    designId: design?.id ?? 'design-1',
    designName: design?.name ?? project.name,
    nodes: design?.nodes ?? [],
    artboard: {
      width: design?.spec.trim.width ?? millimetresToPoints(millimetres(85)),
      height: design?.spec.trim.height ?? millimetresToPoints(millimetres(55)),
    },
    recordSource: design?.recordSource ?? DEFAULT_RECORD_SOURCE,
    database: project.database,
    // Everything except the one being opened, so a later save keeps them.
    otherDesigns: project.designs
      .filter((entry) => entry.id !== design?.id)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        nodes: entry.nodes,
        artboard: { width: entry.spec.trim.width, height: entry.spec.trim.height },
        recordSource: entry.recordSource,
      })),
  };
}
