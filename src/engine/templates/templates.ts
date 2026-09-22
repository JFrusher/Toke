import { lineNode, rectNode, textNode } from '@/engine/scene/factories';
import type { SceneNode } from '@/engine/scene/types';
import { millimetresToPoints } from '@/engine/units/convert';
import type { Points } from '@/engine/units/types';
import { millimetres, points } from '@/engine/units/types';

/**
 * Starter designs, declared as data rather than shipped as `.toke` files.
 *
 * A `.toke` carries a complete SQLite file, so a template on disk would need a
 * build step running sql.js to produce a binary that then drifts every time
 * the schema changes. Declaring the design here and feeding the sample roster
 * through the normal CSV import gives the same result, stays typechecked, and
 * exercises the import path a real user takes. (Divergence from the plan's
 * `public/templates/*.toke`.)
 */

const mm = (n: number): Points => millimetresToPoints(millimetres(n));

export type Template = {
  readonly id: string;
  readonly name: string;
  /** One line of print terms — no marketing copy. */
  readonly description: string;
  readonly trim: { readonly width: Points; readonly height: Points };
  /** Set for a tent card: trim is the finished size, printed at double height. */
  readonly tentFold: boolean;
  readonly recordSource: string;
  readonly nodes: readonly SceneNode[];
  /** Imported through the normal CSV path, so the roster is real data. */
  readonly sampleCsv: string;
  /** Opens the guided first run when this template loads. */
  readonly startsTutorial?: boolean;
};

/**
 * Twenty-four guests, with the awkward cases a real list contains: a
 * double-barrelled surname that will not fit, an accented name, an apostrophe
 * and a one-letter first name.
 */
const SAMPLE_GUESTS = [
  'first_name,last_name,table_number,rsvp_status,dietary',
  'Ada,Lovelace,1,Accepted,',
  'Grace,Hopper,1,Accepted,Vegetarian',
  'Alan,Turing,1,Accepted,',
  'Katherine,Johnson,1,Accepted,',
  'Edsger,Dijkstra,2,Accepted,',
  'Barbara,Liskov,2,Accepted,Vegan',
  'Donald,Knuth,2,Accepted,',
  'Frances,Allen,2,Accepted,',
  'Bartholomew,Winterbourne-Fitzgerald,3,Accepted,Gluten free',
  'Chelsea,Ó Súilleabháin,3,Accepted,',
  "Seán,O'Donnell,3,Accepted,",
  'J,Park,3,Accepted,',
  'Tim,Berners-Lee,4,Accepted,',
  'Radia,Perlman,4,Accepted,Vegetarian',
  'Vint,Cerf,4,Accepted,',
  'Anita,Borg,4,Accepted,',
  'Margaret,Hamilton,5,Accepted,',
  'Leslie,Lamport,5,Accepted,',
  'Shafi,Goldwasser,5,Accepted,Vegan',
  'Ken,Thompson,5,Accepted,',
  'Dennis,Ritchie,6,Declined,',
  'Niklaus,Wirth,6,Declined,',
  'Adele,Goldberg,6,Accepted,',
  'Alan,Kay,6,Accepted,',
].join('\n');

function flatPlaceCard(): readonly SceneNode[] {
  const width = mm(85);

  return [
    rectNode({
      id: 'card-ground',
      x: points(0),
      y: points(0),
      width,
      height: mm(55),
      fill: { kind: 'solid', color: '#FFFFFF' },
      stroke: { kind: 'none' },
    }),
    textNode({
      id: 'guest-name',
      x: mm(6),
      y: mm(19),
      width: mm(73),
      height: mm(12),
      text: '{{ first_name }} {{ last_name }}',
      fontSize: points(20),
      fontWeight: 500,
      align: 'center',
      // Shrink, not truncate: a guest whose name is cut in half at their own
      // place setting is worse than one set a point smaller.
      autoFit: { mode: 'shrink', minFontSize: points(11) },
    }),
    lineNode({
      id: 'rule',
      x: mm(34),
      y: mm(34),
      width: mm(17),
      height: points(0),
      stroke: { kind: 'solid', color: '#C7BFB0', width: points(0.75) },
    }),
    textNode({
      id: 'table-number',
      x: mm(6),
      y: mm(38),
      width: mm(73),
      height: mm(6),
      text: 'Table {{ table_number }}',
      fontSize: points(10),
      align: 'center',
      fill: { kind: 'solid', color: '#6B6459' },
      autoFit: { mode: 'shrink', minFontSize: points(8) },
    }),
  ];
}

/**
 * A tent card is printed at double height and folded across the middle, so the
 * artwork sits on the LOWER half — the upper half becomes the back when the
 * card stands up.
 */
function tentPlaceCard(): readonly SceneNode[] {
  const width = mm(85);
  // Plain number: adding two Points strips the brand, which is the branded
  // type doing its job. Re-brand at each use.
  const foldLine: number = mm(55);

  return [
    rectNode({
      id: 'card-ground',
      x: points(0),
      y: points(0),
      width,
      height: mm(110),
      fill: { kind: 'solid', color: '#FFFFFF' },
      stroke: { kind: 'none' },
    }),
    textNode({
      id: 'guest-name',
      x: mm(6),
      y: points(foldLine + mm(19)),
      width: mm(73),
      height: mm(12),
      text: '{{ first_name }} {{ last_name }}',
      fontSize: points(20),
      fontWeight: 500,
      align: 'center',
      autoFit: { mode: 'shrink', minFontSize: points(11) },
    }),
    textNode({
      id: 'table-number',
      x: mm(6),
      y: points(foldLine + mm(34)),
      width: mm(73),
      height: mm(6),
      text: 'Table {{ table_number }}',
      fontSize: points(10),
      align: 'center',
      fill: { kind: 'solid', color: '#6B6459' },
      autoFit: { mode: 'shrink', minFontSize: points(8) },
    }),
  ];
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'place-card-flat',
    name: 'Place card, flat',
    description: 'Trim 85 x 55mm. 10-up on A4 with 3mm bleed.',
    trim: { width: mm(85), height: mm(55) },
    tentFold: false,
    // Declined guests do not get a place card, and printing them is how a run
    // comes back the wrong length.
    recordSource: "SELECT * FROM guests WHERE rsvp_status = 'Accepted' ORDER BY table_number, id",
    nodes: flatPlaceCard(),
    sampleCsv: SAMPLE_GUESTS,
  },
  {
    id: 'place-card-tent',
    name: 'Place card, tent fold',
    description: 'Trim 85 x 55mm, printed 85 x 110mm and folded. 5-up on A4.',
    trim: { width: mm(85), height: mm(55) },
    tentFold: true,
    recordSource: "SELECT * FROM guests WHERE rsvp_status = 'Accepted' ORDER BY table_number, id",
    nodes: tentPlaceCard(),
    sampleCsv: SAMPLE_GUESTS,
  },
  {
    id: 'tutorial',
    name: 'Guided tour',
    description: 'The flat place card, with a seven-step walkthrough alongside.',
    trim: { width: mm(85), height: mm(55) },
    tentFold: false,
    recordSource: "SELECT * FROM guests WHERE rsvp_status = 'Accepted' ORDER BY table_number, id",
    nodes: flatPlaceCard(),
    sampleCsv: SAMPLE_GUESTS,
    startsTutorial: true,
  },
];

export function templateById(id: string): Template | null {
  return TEMPLATES.find((template) => template.id === id) ?? null;
}
