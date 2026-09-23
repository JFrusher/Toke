import type { CropRect, ImageFit, ImageNode } from '@/engine/scene/types';
import { FULL_CROP } from '@/engine/scene/types';
import type { Points } from '@/engine/units/types';
import { points } from '@/engine/units/types';
import { appError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

/**
 * Image geometry: natural size, placement and crop.
 *
 * Pure, so the placement maths is tested without a canvas and the PDF renderer
 * and the editor can share one definition of what 'cover' means. Two
 * implementations of a crop is how a preview and a print stop agreeing.
 */

export type Pixels = { readonly width: number; readonly height: number };

/** Reads the intrinsic size out of PNG or JPEG bytes without decoding pixels. */
export function naturalSize(bytes: Uint8Array): Result<Pixels> {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    // PNG: IHDR is the first chunk, width and height at bytes 16 and 20.
    if (bytes.byteLength < 24) return err(imageTruncated());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return ok({ width: view.getUint32(16), height: view.getUint32(20) });
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes);

  return err(
    appError('PDF_IMAGE_UNSUPPORTED', 'Only PNG and JPEG images can be placed.', {
      hint: 'Convert the file to PNG or JPEG first.',
    }),
  );
}

function imageTruncated() {
  return appError('PDF_IMAGE_EMBED_FAILED', 'The image file is truncated.');
}

/**
 * Walks JPEG segments to the frame header.
 *
 * There is no fixed offset: a JPEG carries any number of variable-length
 * segments (EXIF, ICC, comments) before the SOF that holds the dimensions.
 */
function jpegSize(bytes: Uint8Array): Result<Pixels> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1] ?? 0;
    // SOF0–SOF15 hold the frame size. C4, C8 and CC are tables, not frames.
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

    if (isFrame) {
      return ok({ height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) });
    }

    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    offset += 2 + view.getUint16(offset + 2);
  }

  return err(imageTruncated());
}

/**
 * A frame for a newly placed image.
 *
 * Scaled to fit the artboard with a margin and never enlarged past its natural
 * size at 72dpi — a 200px logo blown up to fill a card looks like a mistake,
 * and the user can always resize it up deliberately.
 */
export function initialFrame(
  natural: Pixels,
  artboard: { readonly width: number; readonly height: number },
): { x: Points; y: Points; width: Points; height: Points } {
  const maxWidth = artboard.width * 0.6;
  const maxHeight = artboard.height * 0.6;

  const scale = Math.min(maxWidth / natural.width, maxHeight / natural.height, 1);
  const width = natural.width * scale;
  const height = natural.height * scale;

  return {
    x: points((artboard.width - width) / 2),
    y: points((artboard.height - height) / 2),
    width: points(width),
    height: points(height),
  };
}

/**
 * Where the image sits inside its frame, in frame-relative points.
 *
 * - `fill` stretches to the frame, ignoring aspect.
 * - `contain` fits the whole image inside, leaving space on one axis.
 * - `cover` fills the frame and overflows on one axis, which is what the crop
 *   clips away.
 *
 * The single definition both the canvas and `engine/pdf/render.ts` use.
 */
export function fitBox(
  node: Pick<ImageNode, 'width' | 'height' | 'fit'>,
  aspect: number,
): { x: number; y: number; width: number; height: number } {
  if (node.fit === 'fill' || !Number.isFinite(aspect) || aspect <= 0) {
    return { x: 0, y: 0, width: node.width, height: node.height };
  }

  const frameAspect = node.width / node.height;
  // 'contain' matches the axis that would otherwise overflow; 'cover' matches
  // the other one, so the image spills past the frame instead of leaving gaps.
  const matchWidth = node.fit === 'contain' ? aspect > frameAspect : aspect < frameAspect;

  const width = matchWidth ? node.width : node.height * aspect;
  const height = matchWidth ? node.width / aspect : node.height;

  return { x: (node.width - width) / 2, y: (node.height - height) / 2, width, height };
}

/**
 * The aspect ratio of the CROPPED region, which is what fitBox must reason
 * about.
 *
 * Fitting the uncropped aspect and then cropping would letterbox the wrong
 * axis: a wide photo cropped square must behave like a square.
 */
export function croppedAspect(natural: Pixels, crop: CropRect = FULL_CROP): number {
  const width = natural.width * crop.width;
  const height = natural.height * crop.height;
  if (height <= 0 || width <= 0) return 1;
  return width / height;
}

/** Clamps a crop to the image and refuses a degenerate one. */
export function normaliseCrop(crop: CropRect): CropRect {
  const x = Math.min(Math.max(crop.x, 0), 1);
  const y = Math.min(Math.max(crop.y, 0), 1);
  // A zero-size crop would divide by zero downstream and show nothing, which
  // reads as a broken image rather than as a crop.
  const width = Math.min(Math.max(crop.width, 0.01), 1 - x);
  const height = Math.min(Math.max(crop.height, 0.01), 1 - y);
  return { x, y, width, height };
}

/** True when the fit mode makes the image overflow its frame and need clipping. */
export function needsClip(
  fit: ImageFit,
  node: Pick<ImageNode, 'width' | 'height'>,
  aspect: number,
) {
  if (fit !== 'cover') return false;
  const box = fitBox({ ...node, fit }, aspect);
  return box.width > node.width + 1e-6 || box.height > node.height + 1e-6;
}
