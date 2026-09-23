import { describe, expect, it } from 'vitest';
import { designSpec } from '@/engine/imposition/specs';
import {
  packProject,
  readManifest,
  SCHEMA_VERSION,
  type TokeProject,
  unpackProject,
} from '@/engine/persistence/tokeFile';
import { imageNode, rectNode, textNode } from '@/engine/scene/factories';
import { millimetresToPoints } from '@/engine/units/convert';
import { millimetres, points } from '@/engine/units/types';
import { isErr, isOk } from '@/lib/result';

const p = points;
const mm = (n: number) => millimetresToPoints(millimetres(n));

function project(): TokeProject {
  return {
    name: 'Winterbourne wedding',
    // An array from day one. v1 shows one design; the format must not need a
    // migration the first time a user wants place cards AND menus.
    designs: [
      {
        id: 'design-1',
        name: 'Place card',
        spec: designSpec({ width: mm(85), height: mm(55), bleed: mm(3) }),
        recordSource: "SELECT * FROM guests WHERE rsvp_status = 'Accepted'",
        nodes: [
          rectNode({ id: 'r1', x: p(0), y: p(0), width: p(50), height: p(20) }),
          textNode({
            id: 't1',
            x: p(4),
            y: p(4),
            width: p(100),
            height: p(18),
            text: '{{ guests.first_name }}',
          }),
        ],
      },
    ],
    imposition: {
      sheet: 'a4',
      orientation: 'portrait',
      margin: mm(10),
      sharedCut: true,
    },
    database: new Uint8Array([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x00, 0x01]),
    assets: [{ id: 'a'.repeat(64), type: 'image/png', bytes: new Uint8Array([1, 2, 3, 4]) }],
    fonts: [{ family: 'IBM Plex Sans', bytes: new Uint8Array([9, 8, 7]) }],
  };
}

async function roundTrip(input: TokeProject): Promise<TokeProject> {
  const packed = await packProject(input);
  if (!isOk(packed)) throw new Error(packed.error.message);

  const unpacked = await unpackProject(packed.value);
  if (!isOk(unpacked)) throw new Error(unpacked.error.message);
  return unpacked.value;
}

describe('packProject', () => {
  it('produces bytes', async () => {
    const packed = await packProject(project());
    if (!isOk(packed)) throw new Error('expected bytes');
    expect(packed.value.byteLength).toBeGreaterThan(0);
  });

  it('writes a readable manifest without unpacking everything', async () => {
    // The open dialog needs the name and version to decide whether it can
    // even load the file; it should not have to inflate a 50MB database.
    const packed = await packProject(project());
    if (!isOk(packed)) throw new Error('expected bytes');

    const manifest = await readManifest(packed.value);
    if (!isOk(manifest)) throw new Error(manifest.error.message);

    expect(manifest.value).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      name: 'Winterbourne wedding',
      designCount: 1,
    });
  });
});

describe('round trip', () => {
  it('preserves the project name', async () => {
    expect((await roundTrip(project())).name).toBe('Winterbourne wedding');
  });

  it('preserves designs as an array', async () => {
    const back = await roundTrip(project());
    expect(Array.isArray(back.designs)).toBe(true);
    expect(back.designs).toHaveLength(1);
  });

  it('preserves the scene graph exactly', async () => {
    const original = project();
    const back = await roundTrip(original);
    expect(back.designs[0]?.nodes).toEqual(original.designs[0]?.nodes);
  });

  it('preserves the record source query', async () => {
    const back = await roundTrip(project());
    expect(back.designs[0]?.recordSource).toContain('rsvp_status');
  });

  it('preserves design geometry in Points', async () => {
    const original = project();
    const back = await roundTrip(original);
    expect(back.designs[0]?.spec.trim.width).toBeCloseTo(mm(85), 9);
    expect(back.designs[0]?.spec.bleed).toBeCloseTo(mm(3), 9);
  });

  it('preserves imposition settings', async () => {
    const back = await roundTrip(project());
    expect(back.imposition).toMatchObject({ sheet: 'a4', sharedCut: true });
  });

  it('preserves the database bytes exactly', async () => {
    const original = project();
    const back = await roundTrip(original);
    expect(Array.from(back.database)).toEqual(Array.from(original.database));
  });

  it('preserves asset bytes and ids', async () => {
    const original = project();
    const back = await roundTrip(original);

    expect(back.assets).toHaveLength(1);
    expect(back.assets[0]?.id).toBe(original.assets[0]?.id);
    expect(Array.from(back.assets[0]?.bytes ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('preserves embedded fonts', async () => {
    const back = await roundTrip(project());
    expect(back.fonts[0]?.family).toBe('IBM Plex Sans');
    expect(Array.from(back.fonts[0]?.bytes ?? [])).toEqual([9, 8, 7]);
  });

  it('handles a project with no assets or fonts', async () => {
    const bare = { ...project(), assets: [], fonts: [] };
    const back = await roundTrip(bare);
    expect(back.assets).toEqual([]);
    expect(back.fonts).toEqual([]);
  });

  it('handles multiple designs', async () => {
    const original = project();
    const two: TokeProject = {
      ...original,
      designs: [
        ...original.designs,
        {
          id: 'design-2',
          name: 'Menu',
          spec: designSpec({ width: mm(120), height: mm(210), bleed: mm(3) }),
          recordSource: 'SELECT * FROM guests',
          nodes: [],
        },
      ],
    };

    const back = await roundTrip(two);
    expect(back.designs.map((d) => d.name)).toEqual(['Place card', 'Menu']);
  });
});

describe('version handling', () => {
  it('stamps the current schema version', async () => {
    const packed = await packProject(project());
    if (!isOk(packed)) throw new Error('expected bytes');

    const manifest = await readManifest(packed.value);
    if (!isOk(manifest)) throw new Error('expected a manifest');
    expect(manifest.value.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('refuses a file from a newer version rather than loading it partially', async () => {
    // Loading half a newer format and silently dropping what it does not
    // understand would destroy the user's work on the next save.
    const packed = await packProject({ ...project(), __forceVersion: SCHEMA_VERSION + 1 } as never);
    if (!isOk(packed)) throw new Error('expected bytes');

    const result = await unpackProject(packed.value);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('TOKE_VERSION_UNSUPPORTED');
      expect(result.error.message).toMatch(/newer/i);
    }
  });
});

describe('malformed input', () => {
  it('rejects bytes that are not a zip', async () => {
    const result = await unpackProject(new Uint8Array([1, 2, 3, 4, 5]));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('TOKE_CORRUPT');
  });

  it('rejects an empty file', async () => {
    const result = await unpackProject(new Uint8Array([]));
    expect(isErr(result)).toBe(true);
  });

  it('rejects a zip missing its manifest', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const bogus = zipSync({ 'something.txt': strToU8('not a project') });

    const result = await unpackProject(bogus);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('TOKE_CORRUPT');
  });

  it('rejects a manifest that is not valid JSON', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const bogus = zipSync({ 'manifest.json': strToU8('{ not json') });

    const result = await unpackProject(bogus);
    expect(isErr(result)).toBe(true);
  });
});

describe('schema migration', () => {
  it('fills in a crop for image nodes saved before v2', async () => {
    // A v1 file has no crop at all. Migrating on read means every consumer
    // sees current-format nodes and nothing downstream checks the version.
    const v1 = {
      ...project(),
      designs: [
        {
          id: 'design-1',
          name: 'Card',
          spec: designSpec({ width: points(240), height: points(155), bleed: points(8) }),
          recordSource: 'SELECT * FROM guests',
          nodes: [
            // Deliberately missing `crop`, as a v1 file would be.
            {
              ...imageNode({
                id: 'photo',
                x: points(0),
                y: points(0),
                width: points(100),
                height: points(50),
                assetId: 'abc',
              }),
              crop: undefined,
            },
          ],
        },
      ],
      __forceVersion: 1,
    };

    const packed = await packProject(v1 as unknown as Parameters<typeof packProject>[0]);
    if (!isOk(packed)) throw new Error(packed.error.message);

    const read = await unpackProject(packed.value);
    if (!isOk(read)) throw new Error(read.error.message);

    const node = read.value.designs[0]?.nodes[0];
    expect(node?.kind).toBe('image');
    if (node?.kind === 'image') expect(node.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('leaves a v2 crop untouched', async () => {
    const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
    const withCrop = {
      ...project(),
      designs: [
        {
          id: 'design-1',
          name: 'Card',
          spec: designSpec({ width: points(240), height: points(155), bleed: points(8) }),
          recordSource: 'SELECT * FROM guests',
          nodes: [
            imageNode({
              id: 'photo',
              x: points(0),
              y: points(0),
              width: points(100),
              height: points(50),
              assetId: 'abc',
              crop,
            }),
          ],
        },
      ],
    };

    const packed = await packProject(withCrop);
    if (!isOk(packed)) throw new Error(packed.error.message);
    const read = await unpackProject(packed.value);
    if (!isOk(read)) throw new Error(read.error.message);

    const node = read.value.designs[0]?.nodes[0];
    if (node?.kind === 'image') expect(node.crop).toEqual(crop);
  });
});
