import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { DesignSpec, Orientation, SheetPresetId } from '@/engine/imposition/specs';
import type { SceneNode } from '@/engine/scene/types';
import type { Points } from '@/engine/units/types';
import { appError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

/**
 * The `.toke` project file: a zip with a JSON manifest, one JSON document per
 * concern, and raw bytes for the database, assets and fonts.
 *
 * `designs` is an ARRAY from the first release even though v1's UI exposes a
 * single design. A wedding needs place cards, menus, table numbers and a
 * seating chart off one guest list; making that a format migration later
 * would mean rewriting every file a user had already saved.
 *
 * Binary payloads are stored as files inside the zip rather than base64 in
 * JSON — base64 costs a third more bytes and forces the whole database
 * through a string.
 */

export const SCHEMA_VERSION = 1;

const MANIFEST = 'manifest.json';
const DESIGNS = 'designs.json';
const IMPOSITION = 'imposition.json';
const DATABASE = 'data.sqlite';
const ASSET_DIR = 'assets/';
const FONT_DIR = 'fonts/';

export type TokeDesign = {
  readonly id: string;
  readonly name: string;
  readonly spec: DesignSpec;
  readonly recordSource: string;
  readonly nodes: readonly SceneNode[];
};

export type TokeImposition = {
  readonly sheet: SheetPresetId | 'custom';
  readonly orientation: Orientation;
  readonly margin: Points;
  readonly sharedCut: boolean;
};

export type TokeAsset = {
  readonly id: string;
  readonly type: string;
  readonly bytes: Uint8Array;
};

export type TokeFont = {
  readonly family: string;
  readonly bytes: Uint8Array;
};

export type TokeProject = {
  readonly name: string;
  readonly designs: readonly TokeDesign[];
  readonly imposition: TokeImposition;
  /** Result of `db.export()` — a complete SQLite file. */
  readonly database: Uint8Array;
  readonly assets: readonly TokeAsset[];
  readonly fonts: readonly TokeFont[];
};

export type TokeManifest = {
  readonly schemaVersion: number;
  readonly name: string;
  readonly designCount: number;
  readonly savedAt: string;
  readonly assetIds: readonly string[];
  readonly assetTypes: Readonly<Record<string, string>>;
  readonly fontFamilies: readonly string[];
};

function corrupt(detail: string) {
  return appError('TOKE_CORRUPT', `This file is not a readable toke project: ${detail}`, {
    hint: 'It may be damaged, or not a .toke file.',
  });
}

/** Font families and asset ids become filenames; keep them filesystem-safe. */
function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_');
}

export async function packProject(project: TokeProject): Promise<Result<Uint8Array>> {
  // `__forceVersion` exists only so tests can produce a file from a future
  // version and prove the reader refuses it.
  const version =
    (project as TokeProject & { __forceVersion?: number }).__forceVersion ?? SCHEMA_VERSION;

  const assetTypes: Record<string, string> = {};
  const files: Record<string, Uint8Array> = {};

  for (const asset of project.assets) {
    assetTypes[asset.id] = asset.type;
    files[`${ASSET_DIR}${safeName(asset.id)}`] = asset.bytes;
  }

  for (const font of project.fonts) {
    files[`${FONT_DIR}${safeName(font.family)}`] = font.bytes;
  }

  const manifest: TokeManifest = {
    schemaVersion: version,
    name: project.name,
    designCount: project.designs.length,
    savedAt: new Date().toISOString(),
    assetIds: project.assets.map((asset) => asset.id),
    assetTypes,
    fontFamilies: project.fonts.map((font) => font.family),
  };

  try {
    const zipped = zipSync({
      ...files,
      [MANIFEST]: strToU8(JSON.stringify(manifest, null, 2)),
      [DESIGNS]: strToU8(JSON.stringify(project.designs)),
      [IMPOSITION]: strToU8(JSON.stringify(project.imposition)),
      [DATABASE]: project.database,
    });
    return ok(zipped);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(appError('TOKE_WRITE_FAILED', `Could not write the project: ${message}`));
  }
}

function inflate(bytes: Uint8Array): Result<Record<string, Uint8Array>> {
  if (bytes.byteLength === 0) return err(corrupt('the file is empty'));

  try {
    return ok(unzipSync(bytes));
  } catch {
    return err(corrupt('it is not a zip archive'));
  }
}

/** Reads just the manifest. The open dialog needs the name and version to
 *  decide whether it can load a file at all, without inflating a large
 *  database to find out. */
export async function readManifest(bytes: Uint8Array): Promise<Result<TokeManifest>> {
  const inflated = inflate(bytes);
  if (!inflated.ok) return err(inflated.error);

  const raw = inflated.value[MANIFEST];
  if (raw === undefined) return err(corrupt('it has no manifest'));

  try {
    return ok(JSON.parse(strFromU8(raw)) as TokeManifest);
  } catch {
    return err(corrupt('the manifest is not valid JSON'));
  }
}

export async function unpackProject(bytes: Uint8Array): Promise<Result<TokeProject>> {
  const inflated = inflate(bytes);
  if (!inflated.ok) return err(inflated.error);

  const files = inflated.value;
  const manifest = await readManifest(bytes);
  if (!manifest.ok) return err(manifest.error);

  if (manifest.value.schemaVersion > SCHEMA_VERSION) {
    // Refuse rather than load what we understand and drop the rest. A partial
    // load looks like success and destroys the unknown parts on next save.
    return err(
      appError(
        'TOKE_VERSION_UNSUPPORTED',
        `This project was saved by a newer version of toke (format ${manifest.value.schemaVersion}, this build reads ${SCHEMA_VERSION}).`,
        { hint: 'Update toke to open it.' },
      ),
    );
  }

  function readJson<T>(name: string): Result<T> {
    const raw = files[name];
    if (raw === undefined) return err(corrupt(`${name} is missing`));
    try {
      return ok(JSON.parse(strFromU8(raw)) as T);
    } catch {
      return err(corrupt(`${name} is not valid JSON`));
    }
  }

  const designs = readJson<TokeDesign[]>(DESIGNS);
  if (!designs.ok) return err(designs.error);

  const imposition = readJson<TokeImposition>(IMPOSITION);
  if (!imposition.ok) return err(imposition.error);

  const database = files[DATABASE];
  if (database === undefined) return err(corrupt('the database is missing'));

  const assets: TokeAsset[] = [];
  for (const id of manifest.value.assetIds) {
    const payload = files[`${ASSET_DIR}${safeName(id)}`];
    if (payload === undefined) continue;
    assets.push({
      id,
      type: manifest.value.assetTypes[id] ?? 'application/octet-stream',
      bytes: payload,
    });
  }

  const fonts: TokeFont[] = [];
  for (const family of manifest.value.fontFamilies) {
    const payload = files[`${FONT_DIR}${safeName(family)}`];
    if (payload === undefined) continue;
    fonts.push({ family, bytes: payload });
  }

  return ok({
    name: manifest.value.name,
    designs: designs.value,
    imposition: imposition.value,
    database,
    assets,
    fonts,
  });
}
