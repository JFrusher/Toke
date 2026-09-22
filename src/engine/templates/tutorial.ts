import type { TokeyState } from '@/components/brand/Tokey';

/**
 * The guided first run.
 *
 * Each step names one thing to do and how to know it worked. The steps are
 * data rather than a component so the copy sits in one place, stays
 * typechecked against the panel that renders it, and can be tested without a
 * browser.
 *
 * Written in print and database terms, not encouragement (CLAUDE.md §4.8):
 * "bind this text to a column" beats "let's make something beautiful".
 */

export type TutorialStep = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** How the user knows the step worked. */
  readonly confirm: string;
  readonly mascot: TokeyState;
};

export const TUTORIAL: readonly TutorialStep[] = [
  {
    id: 'data',
    title: 'The dataset is the print run',
    body: 'A tutorial roster of 24 guests is loaded. One row is one card — the record source query decides which rows print, and the two declined guests are already filtered out.',
    confirm: 'The Data tab shows 24 rows; the imposition panel counts 22 records.',
    mascot: 'greeting',
  },
  {
    id: 'bind',
    title: 'Bind text to a column',
    body: 'Select the guest name and look at the Binding panel. {{ first_name }} is a column reference, resolved against whichever record you are previewing — not a search-and-replace.',
    confirm: 'The layers tree marks the object "bound".',
    mascot: 'tip',
  },
  {
    id: 'cycle',
    title: 'Cycle the records',
    body: 'Switch to Live mode and step through the roster. Every bound object updates together. Find Bartholomew Winterbourne-Fitzgerald: his name is far too long for the box.',
    confirm: 'The name shrinks to fit rather than running past the trim.',
    mascot: 'tip',
  },
  {
    id: 'autofit',
    title: 'Auto-fit measures the real font',
    body: 'Shrink, truncate or wrap. The measurement comes from the font file itself, and the PDF renderer reads the same numbers — so a name that fits on screen fits on the card.',
    confirm: 'Changing the minimum size changes where the long name gives up.',
    mascot: 'settings',
  },
  {
    id: 'impose',
    title: 'Impose onto a sheet',
    body: 'Trim 85 × 55mm at 10-up on A4 with 3mm bleed. The sheet preview is drawn from the same solver the PDF uses, so the yield it reports is the yield you get.',
    confirm: '22 records across 3 sheets, with 8 cells wasted on the last one.',
    mascot: 'settings',
  },
  {
    id: 'preflight',
    title: 'Pre-flight before you commit',
    body: 'Pre-flight scans every record, not just the one on screen — overflow, unresolved tokens and empty values. It is cheaper than a reprint.',
    confirm: 'The report lists findings per record, or says the run is clean.',
    mascot: 'error',
  },
  {
    id: 'export',
    title: 'Export press-ready PDF',
    body: 'Vector text with subset-embedded fonts, TrimBox and BleedBox on every sheet, and crop marks in the margins. Hand the file straight to a print shop.',
    confirm: 'A 3-page PDF downloads, and the text in it is selectable.',
    mascot: 'success',
  },
];
