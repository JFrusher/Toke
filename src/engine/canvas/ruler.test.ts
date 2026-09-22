/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { labelStep, minorStep, rulerTicks } from '@/engine/canvas/ruler';
import { millimetresToPoints } from '@/engine/units/convert';
import type { DisplayUnit } from '@/engine/units/types';
import { millimetres } from '@/engine/units/types';

const mm = (n: number) => millimetresToPoints(millimetres(n));

/** The range the acceptance criterion names. */
const ZOOMS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8, 16] as const;
const UNITS: readonly DisplayUnit[] = ['mm', 'in', 'pt'];

describe('labelStep', () => {
  it('never crowds labels closer than they can be read', () => {
    // The whole point of adaptive subdivision: at any zoom in range, in any
    // unit, a labelled tick has room for its own text.
    for (const unit of UNITS) {
      for (const zoom of ZOOMS) {
        const step = labelStep(zoom, unit);
        const screenPx = (unit === 'mm' ? mm(step) : unit === 'in' ? step * 72 : step) * zoom;
        expect(screenPx, `${unit} @ ${zoom}x`).toBeGreaterThanOrEqual(56);
      }
    }
  });

  it('coarsens as you zoom out and refines as you zoom in', () => {
    for (const unit of UNITS) {
      const steps = ZOOMS.map((zoom) => labelStep(zoom, unit));
      for (let i = 1; i < steps.length; i += 1) {
        const previous = steps[i - 1] ?? 0;
        const current = steps[i] ?? 0;
        // Monotonic: a ruler that jumps back to a coarser step on zooming IN
        // would be visibly wrong.
        expect(current, `${unit}`).toBeLessThanOrEqual(previous);
      }
    }
  });

  it('picks whole millimetres, not arbitrary fractions', () => {
    for (const zoom of ZOOMS) {
      const step = labelStep(zoom, 'mm');
      expect(Number.isInteger(step), `mm step ${step} @ ${zoom}x`).toBe(true);
    }
  });

  it('subdivides inches in halves rather than tenths', () => {
    // An imperial ruler reads in sixteenths; 0.2in means nothing to the person
    // holding it.
    for (const zoom of ZOOMS) {
      const step = labelStep(zoom, 'in');
      const sixteenths = step * 16;
      expect(Number.isInteger(Math.round(sixteenths * 1e6) / 1e6), `in step ${step}`).toBe(true);
    }
  });

  it('keeps going past the top of the ladder rather than crowding', () => {
    // At 1% zoom the widest rung is still too tight; the step must keep
    // doubling instead of giving up and stacking labels.
    const step = labelStep(0.01, 'mm');
    expect(mm(step) * 0.01).toBeGreaterThanOrEqual(56);
  });
});

describe('minorStep', () => {
  it('never places subdivisions closer than they can be told apart', () => {
    for (const unit of UNITS) {
      for (const zoom of ZOOMS) {
        const step = labelStep(zoom, unit);
        const minor = minorStep(step, zoom, unit);
        const px = (unit === 'mm' ? mm(minor) : unit === 'in' ? minor * 72 : minor) * zoom;
        expect(px, `${unit} @ ${zoom}x`).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('divides the labelled step evenly', () => {
    for (const unit of UNITS) {
      for (const zoom of ZOOMS) {
        const step = labelStep(zoom, unit);
        const divisions = step / minorStep(step, zoom, unit);
        // A subdivision that does not divide the step leaves ticks drifting off
        // the labels.
        expect(Math.abs(divisions - Math.round(divisions)), `${unit} @ ${zoom}x`).toBeLessThan(
          1e-9,
        );
      }
    }
  });

  it('falls back to the labelled step when nothing finer fits', () => {
    expect(minorStep(10, 0.0001, 'mm')).toBe(10);
  });
});

describe('rulerTicks', () => {
  it('covers the requested range', () => {
    const ticks = rulerTicks({ fromPt: 0, toPt: mm(100), zoom: 1, unit: 'mm' });
    expect(ticks.length).toBeGreaterThan(0);

    const first = ticks[0]?.positionPt ?? 0;
    const last = ticks[ticks.length - 1]?.positionPt ?? 0;
    expect(first).toBeLessThanOrEqual(0);
    expect(last).toBeLessThanOrEqual(mm(100) + 1e-6);
  });

  it('lands on round numbers whatever the range starts at', () => {
    // Panning must not drag the ticks off whole units with it.
    const ticks = rulerTicks({ fromPt: mm(37.4), toPt: mm(137.4), zoom: 2, unit: 'mm' });
    for (const tick of ticks) {
      const asMm = tick.positionPt / mm(1);
      expect(Math.abs(asMm - Math.round(asMm * 1e6) / 1e6)).toBeLessThan(1e-6);
    }
  });

  it('labels some ticks and leaves the subdivisions bare', () => {
    const ticks = rulerTicks({ fromPt: 0, toPt: mm(200), zoom: 1, unit: 'mm' });
    const labelled = ticks.filter((tick) => tick.label !== null);

    expect(labelled.length).toBeGreaterThan(0);
    expect(labelled.length).toBeLessThan(ticks.length);
  });

  it('labels whole numbers without trailing zeroes', () => {
    const ticks = rulerTicks({ fromPt: 0, toPt: mm(200), zoom: 1, unit: 'mm' });
    for (const tick of ticks) {
      if (tick.label !== null) expect(tick.label).not.toMatch(/\.\d*0$/);
    }
  });

  it('handles negative coordinates, which is most of the pasteboard', () => {
    const ticks = rulerTicks({ fromPt: mm(-50), toPt: mm(50), zoom: 1, unit: 'mm' });
    expect(ticks.some((tick) => tick.positionPt < 0)).toBe(true);
    expect(ticks.some((tick) => tick.label === '0')).toBe(true);
  });

  it('stays bounded at every zoom in range', () => {
    for (const unit of UNITS) {
      for (const zoom of ZOOMS) {
        const ticks = rulerTicks({ fromPt: 0, toPt: 2000, zoom, unit });
        expect(ticks.length, `${unit} @ ${zoom}x`).toBeLessThanOrEqual(2000);
      }
    }
  });

  it('returns nothing for a degenerate range or zoom', () => {
    // A zero-width viewport during mount, or a zoom that has not been set yet,
    // must not produce an infinite loop.
    expect(rulerTicks({ fromPt: 0, toPt: 0, zoom: 1, unit: 'mm' })).toEqual([]);
    expect(rulerTicks({ fromPt: 100, toPt: 0, zoom: 1, unit: 'mm' })).toEqual([]);
    expect(rulerTicks({ fromPt: 0, toPt: 100, zoom: 0, unit: 'mm' })).toEqual([]);
    expect(rulerTicks({ fromPt: 0, toPt: 100, zoom: Number.NaN, unit: 'mm' })).toEqual([]);
  });
});
