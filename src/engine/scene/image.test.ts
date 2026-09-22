/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { fitBox, initialFrame, naturalSize, needsClip } from '@/engine/scene/image';
import { points } from '@/engine/units/types';
import { isErr, isOk } from '@/lib/result';

/** 1x1 red PNG. */
const PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

/** Minimal JPEG: SOI, an APP0 segment to skip, then SOF0 at 40x20. */
function jpeg(width: number, height: number, padding = 0): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10 + padding, ...new Array(14 + padding).fill(0)];
  const sof = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    ...new Array(8).fill(0),
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof]);
}

describe('naturalSize', () => {
  it('reads a PNG header', () => {
    const size = naturalSize(PNG);
    expect(isOk(size)).toBe(true);
    if (isOk(size)) expect(size.value).toEqual({ width: 1, height: 1 });
  });

  it('walks JPEG segments to the frame header', () => {
    // There is no fixed offset: EXIF, ICC and comment segments all sit before
    // the SOF, so reading a constant position finds garbage on a real photo.
    const size = naturalSize(jpeg(40, 20));
    expect(isOk(size)).toBe(true);
    if (isOk(size)) expect(size.value).toEqual({ width: 40, height: 20 });
  });

  it('still finds the frame past a longer preamble', () => {
    const size = naturalSize(jpeg(1200, 800, 64));
    expect(isOk(size)).toBe(true);
    if (isOk(size)) expect(size.value).toEqual({ width: 1200, height: 800 });
  });

  it('refuses a format PDF cannot carry', () => {
    // GIF magic. Accepting it here would defer the failure to export.
    const result = naturalSize(new Uint8Array([0x47, 0x49, 0x46, 0x38]));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('PDF_IMAGE_UNSUPPORTED');
  });

  it('refuses a truncated file', () => {
    expect(isErr(naturalSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47])))).toBe(true);
  });
});

describe('initialFrame', () => {
  const artboard = { width: 240, height: 155 };

  it('centres the image on the artboard', () => {
    const frame = initialFrame({ width: 100, height: 100 }, artboard);
    expect(frame.x + frame.width / 2).toBeCloseTo(artboard.width / 2, 6);
    expect(frame.y + frame.height / 2).toBeCloseTo(artboard.height / 2, 6);
  });

  it('never enlarges a small image', () => {
    // A 40pt logo blown up to fill a card looks like a mistake; the user can
    // still resize it up deliberately.
    const frame = initialFrame({ width: 40, height: 20 }, artboard);
    expect(frame.width).toBeCloseTo(40, 6);
    expect(frame.height).toBeCloseTo(20, 6);
  });

  it('scales a large image down inside the artboard', () => {
    const frame = initialFrame({ width: 4000, height: 3000 }, artboard);
    expect(frame.width).toBeLessThanOrEqual(artboard.width * 0.6 + 1e-6);
    expect(frame.height).toBeLessThanOrEqual(artboard.height * 0.6 + 1e-6);
  });

  it('keeps the aspect ratio when scaling down', () => {
    const frame = initialFrame({ width: 4000, height: 2000 }, artboard);
    expect(frame.width / frame.height).toBeCloseTo(2, 6);
  });
});

describe('fitBox', () => {
  const frame = { width: points(100), height: points(50) };

  it('fill stretches to the frame', () => {
    const box = fitBox({ ...frame, fit: 'fill' }, 1);
    expect(box).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it('contain fits a wide image by its width, leaving space above and below', () => {
    const box = fitBox({ ...frame, fit: 'contain' }, 4);
    expect(box.width).toBeCloseTo(100, 6);
    expect(box.height).toBeCloseTo(25, 6);
    expect(box.y).toBeCloseTo(12.5, 6);
    // Nothing overflows.
    expect(box.height).toBeLessThanOrEqual(frame.height);
  });

  it('contain fits a tall image by its height', () => {
    const box = fitBox({ ...frame, fit: 'contain' }, 0.5);
    expect(box.height).toBeCloseTo(50, 6);
    expect(box.width).toBeCloseTo(25, 6);
    expect(box.x).toBeCloseTo(37.5, 6);
  });

  it('cover fills the frame and overflows on one axis', () => {
    const box = fitBox({ ...frame, fit: 'cover' }, 4);
    expect(box.height).toBeCloseTo(50, 6);
    expect(box.width).toBeCloseTo(200, 6);
    // Overflow is centred, so the crop takes equally from both sides.
    expect(box.x).toBeCloseTo(-50, 6);
  });

  it('cover never leaves a gap', () => {
    for (const aspect of [0.2, 0.5, 1, 2, 4, 9]) {
      const box = fitBox({ ...frame, fit: 'cover' }, aspect);
      expect(box.width).toBeGreaterThanOrEqual(frame.width - 1e-6);
      expect(box.height).toBeGreaterThanOrEqual(frame.height - 1e-6);
    }
  });

  it('contain never overflows', () => {
    for (const aspect of [0.2, 0.5, 1, 2, 4, 9]) {
      const box = fitBox({ ...frame, fit: 'contain' }, aspect);
      expect(box.width).toBeLessThanOrEqual(frame.width + 1e-6);
      expect(box.height).toBeLessThanOrEqual(frame.height + 1e-6);
    }
  });

  it('falls back to fill for a degenerate aspect', () => {
    // A zero or NaN aspect would otherwise produce an infinite box.
    expect(fitBox({ ...frame, fit: 'cover' }, 0).width).toBe(100);
    expect(fitBox({ ...frame, fit: 'contain' }, Number.NaN).height).toBe(50);
  });
});

describe('needsClip', () => {
  const frame = { width: points(100), height: points(50) };

  it('is true for a cover image that overflows', () => {
    expect(needsClip('cover', frame, 4)).toBe(true);
  });

  it('is false when cover happens to match the frame exactly', () => {
    expect(needsClip('cover', frame, 2)).toBe(false);
  });

  it('is false for contain and fill, which never overflow', () => {
    expect(needsClip('contain', frame, 4)).toBe(false);
    expect(needsClip('fill', frame, 4)).toBe(false);
  });
});
