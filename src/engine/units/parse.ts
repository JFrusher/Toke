import { toPoints } from '@/engine/units/convert';
import { type DisplayUnit, isDisplayUnit, type Points } from '@/engine/units/types';
import { appError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

/**
 * Deliberately strict. A trailing unit is captured as free letters and then
 * validated, so "85cm" fails with a message naming the unit rather than being
 * silently read as 85 of the current display unit — which would be a wrong
 * measurement that looks entirely plausible on screen.
 *
 * Scientific notation is rejected: nobody types "1e3mm" into a card width, and
 * accepting it would also accept "1e" style partial input mid-edit.
 */
const LENGTH_PATTERN = /^(-?(?:\d+(?:\.\d+)?|\.\d+))\s*([a-z]*)$/i;

function invalidLength(input: string) {
  return appError('INVALID_LENGTH', `Cannot read "${input}" as a length.`, {
    hint: 'Use a number with an optional unit — 85mm, 3.5in, 24pt.',
  });
}

/**
 * Parse user input into Points. A bare number is interpreted as `defaultUnit`,
 * which is the unit currently shown in the UI.
 */
export function parseLength(input: string, defaultUnit: DisplayUnit): Result<Points> {
  const trimmed = input.trim();
  const match = LENGTH_PATTERN.exec(trimmed);

  if (match === null) {
    return err(invalidLength(trimmed));
  }

  const [, numeric, suffix] = match;
  if (numeric === undefined) {
    return err(invalidLength(trimmed));
  }

  const value = Number(numeric);
  if (!Number.isFinite(value)) {
    return err(invalidLength(trimmed));
  }

  const unit = suffix === undefined || suffix === '' ? defaultUnit : suffix.toLowerCase();
  if (!isDisplayUnit(unit)) {
    return err(invalidLength(trimmed));
  }

  return ok(toPoints(value, unit));
}
