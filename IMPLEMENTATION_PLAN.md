# toke — Atomic Implementation Plan

**v1 scope:** place cards, end to end. CSV import → canvas design → token binding → live record
cycling → N-up imposition → press-ready vector PDF, with autosave and `.toke` project files.

Conventions for every task below:

- **TDD.** Write the test, watch it fail, implement, watch it pass. Tasks marked **[pure]** are
  logic-only and must have near-exhaustive unit tests before any implementation.
- **Independently verifiable.** Each task ends with a command whose output proves it works.
- **Definition of done** for all tasks: `npm run typecheck && npm run lint && npm run test` clean,
  plus the task's own acceptance criteria met, plus one commit.
- Task IDs are stable. Reference them in commits: `feat(P3.4): numeric transform fields`.

Dependency order is deliberate. Phases 1–2 front-load the hardest pure maths and the data spine so
the risky work is proven before any UI depends on it. Phase 4 lands persistence as soon as there is
something worth losing.

---

## Phase 0 — Foundation

### P0.1 — Scaffold the Next application
**Do:** `create-next-app` (TypeScript, App Router, Tailwind, npm, no ESLint). Strip boilerplate —
the default landing page, demo SVGs, sample CSS. Set `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes` in `tsconfig.json`. Add the `@/*` path alias.
**Files:** `package.json`, `tsconfig.json`, `next.config.mjs`, `src/app/{layout,page}.tsx`
**Accept:** `npm run dev` serves a blank page at `/` with no console errors or warnings. No
`src/app/api/`. No COOP/COEP headers in `next.config.mjs`. Zero boilerplate assets remain.
**Verify:** `npm run build && npm run typecheck`

### P0.2 — Biome, Vitest, Playwright, npm scripts
**Do:** Install and configure Biome (lint + format, one config). Vitest with a `jsdom` environment
and a separate `golden` project. Playwright with a single Chromium target. Wire every script in
CLAUDE.md §1, **including the Vercel env helpers** — these are referenced by `DEVELOPMENT.md` and
`README.md`, which already exist, so until this task lands those docs point at scripts that are not
there:
```json
"env:pull":         "vercel env pull .env.local",
"env:pull:preview": "vercel env pull .env.local --environment=preview",
"env:list":         "vercel env ls"
```
Also add `.vscode/settings.json` entries for Biome as the default formatter with format-on-save.
**Files:** `biome.json`, `vitest.config.ts`, `playwright.config.ts`, `package.json`,
`.vscode/settings.json`
**Accept:** Every script in CLAUDE.md §1 runs and exits 0. A deliberate lint violation fails
`npm run lint`. A trivial passing test runs under `npm run test`. `npm run env:pull` produces a
gitignored `.env.local` once the project is linked (`vercel link`), and fails with a clear message
when it is not.
**Verify:** `npm run lint && npm run test && npm run test:e2e && git check-ignore -v .env.local`

### P0.3 — CI
**Do:** GitHub Actions on push and PR: install → typecheck → lint → test → build → test:e2e.
Cache npm and the Playwright browser download.
**Files:** `.github/workflows/ci.yml`
**Accept:** Workflow is valid and every job passes on a clean tree.
**Verify:** `act -n` if available, otherwise first push.
**Note:** The repo has no remote and no commits. Create the initial commit in P0.1 and confirm the
remote before this task.

### P0.4 — Unit system **[pure]**
**Do:** `Points`/`Millimetres`/`Inches` branded types. Conversions in both directions. A formatter
that renders Points into a display unit at a given precision. A parser accepting `"85mm"`, `"3.5in"`,
`"24pt"`, `"85"` (bare number = current display unit).
**Files:** `src/engine/units/{types,convert,format,parse}.ts` + tests
**Accept:** Round-trips are lossless to 1e-9 across mm/in/pt. Parser handles whitespace, negatives,
decimals, and returns `Result` (not a throw) on malformed input. Passing a raw `number` where
`Points` is expected is a **compile error** — assert this with a `@ts-expect-error` test.
**Verify:** `npm run test -- units`

### P0.5 — Theme layer
**Do:** CSS custom properties for the full palette in CLAUDE.md §4.1–4.2. Tailwind theme extension
mapping them to utility names. IBM Plex Sans + Mono via `next/font`. Global base: tabular numerals
on `[data-numeric]`, the 4px spacing scale, the 2/4px radius scale, the reduced-motion block.
**Files:** `src/app/globals.css`, `tailwind.config.ts`, `src/app/layout.tsx`
**Accept:** Every §4.1 and §4.2 token resolves in the browser. Both Plex faces load with no layout
shift. `prefers-reduced-motion: reduce` disables all transitions. **No dark-mode block exists** —
this product is light-only by design.
**Verify:** Swatch page rendering all tokens with computed values and a contrast readout.

### P0.6 — Contrast audit **[pure]**
**Do:** A test asserting WCAG 2.2 AA contrast for every text-on-surface pair in the palette.
**Files:** `src/engine/theme/contrast.test.ts`
**Accept:** All body pairs ≥ 4.5:1, large text and UI boundaries ≥ 3:1. The warm neutrals are the
likely failures — adjust the palette, not the threshold.
**Verify:** `npm run test -- contrast`

---

## Phase 1 — Geometry & Imposition Core **[pure, no UI]**

The highest-risk maths in the product. Prove it in isolation before anything renders.

### P1.1 — Geometry primitives **[pure]**
**Do:** `Rect`, `Point`, `Size`, `Matrix` in Points. Translate, scale, rotate, compose, invert.
Rect union/intersect/contains/inflate. Transform a rect by a matrix (returns the bounding rect of
the transformed corners, not a naive corner-pair transform).
**Files:** `src/engine/geometry/*.ts` + tests
**Accept:** Rotating a rect 45° yields the correct enlarged bounding box. `compose(m, invert(m))` is
identity within 1e-10. Degenerate rects (zero width/height) are handled explicitly.
**Verify:** `npm run test -- geometry`

### P1.2 — Sheet and design specs **[pure]**
**Do:** Sheet presets (A4, A3, US Letter, US Tabloid, custom) in Points. `DesignSpec`
{ trim, bleed, fold?, orientation }. Validation returning structured errors.
**Files:** `src/engine/imposition/specs.ts` + tests
**Accept:** A4 = 595.276 × 841.890pt (±0.001). Design larger than sheet is rejected with a
`DESIGN_EXCEEDS_SHEET` error carrying both measurements. Landscape flips correctly.
**Verify:** `npm run test -- specs`

### P1.3 — Shared-cut imposition solver **[pure]**
**Do:** Given sheet + design + margins, compute columns, rows, N-up, the sheet-centred origin, and
every cell's trim rect. Shared-cut geometry: cards butt on a single cut line, bleeds overlap at
the seam, outer edges keep full bleed.
**Files:** `src/engine/imposition/solve.ts` + tests
**Accept:** 85 × 55mm on A4 with 10mm margins → **10-up (2 × 5)**. Cells are exactly adjacent —
`cell[n].right === cell[n+1].left` exactly, not within tolerance. The grid is centred: left margin
equals right margin within 1e-9. A design that cannot fit even 1-up returns an error, not a
zero-cell grid.
**Verify:** `npm run test -- solve`

### P1.4 — Crop marks **[pure]**
**Do:** Crop mark line segments for a solved grid. Shared-cut rule: marks live in the **sheet
margin only**, projected from each cut line — never between cards. 0.25pt stroke, offset from trim
by the bleed distance, length 5mm.
**Files:** `src/engine/imposition/cropMarks.ts` + tests
**Accept:** A 2 × 5 grid produces marks on 3 vertical and 6 horizontal cut lines, 2 segments each
(top/bottom or left/right margin) = 18 segments. No segment intersects any cell's bleed rect. All
segments lie inside the sheet.
**Verify:** `npm run test -- cropMarks`

### P1.5 — Tent fold geometry **[pure]**
**Do:** Fold-aware design: printed height = 2 × trim height. Two panels — front upright, back
rotated 180°. Emit the fold-mark segments (dashed, in the margin).
**Files:** `src/engine/imposition/fold.ts` + tests
**Accept:** 85 × 55mm tent → 85 × 110mm printed. Back panel carries a 180° rotation about the
panel centre. Fold marks sit on the horizontal centre line, in the margin only. A4 with 10mm
margins yields **4-up (2 × 2)** — note this is *not* half of the flat card's 10-up, because 277mm
of usable height fits two 110mm panels with 57mm wasted.
**Verify:** `npm run test -- fold`

### P1.6 — Pagination **[pure]**
**Do:** Distribute N records across sheets at K-up. Report sheet count, per-sheet record slice, and
the trailing partial sheet's empty cell indices.
**Files:** `src/engine/imposition/paginate.ts` + tests
**Accept:** 142 records at 10-up → 15 sheets, last sheet holds 2 records and reports 8 empty cells.
0 records → 0 sheets, not 1 empty sheet. Record order is stable and matches source-query order.
**Verify:** `npm run test -- paginate`

---

## Phase 2 — Data Layer

### P2.1 — SQLite worker + typed RPC
**Do:** `db.worker.ts` loading `sql.js` from `public/sql-wasm.wasm`. A typed request/response
envelope with correlation ids, structured error mapping, and a `Result`-returning client. Enable
`PRAGMA foreign_keys = ON` on open.
**Files:** `src/engine/db/{db.worker,rpc,client}.ts` + tests
**Accept:** Worker boots and answers `SELECT 1`. A malformed query returns a structured
`SQL_ERROR` with the SQLite message, and does **not** reject the promise or kill the worker. Ten
concurrent queries return correctly correlated results. No `sql.js` import exists outside the worker
— assert with a lint rule or a grep test.
**Verify:** `npm run test -- db/rpc`

### P2.2 — Starter schema
**Do:** `guests`, `event_tables`, `menu_selections` per PRD §3.1, with `UNIQUE(guest_id)` added to
`menu_selections`. A `schema_version` table and a forward-only migration runner.
**Files:** `src/engine/db/{schema,migrate}.ts` + tests
**Accept:** Fresh database initialises at the current version. Re-running migrations is a no-op.
FK violations are rejected (proving the pragma is live). `rsvp_status` CHECK constraint rejects
invalid values.
**Verify:** `npm run test -- schema`

### P2.3 — CSV parse and type inference **[pure]**
**Do:** papaparse wrapper. Detect delimiter, require a header row, strip UTF-8 BOM. Infer column
types (integer / real / text / boolean) by sampling. Emit a proposed column mapping against the
`guests` schema, flagging unmatched source columns as candidate new `TEXT` columns.
**Files:** `src/engine/db/csv.ts` + tests
**Accept:** Handles CRLF, quoted fields containing commas and newlines, ragged rows (reported, not
silently padded), empty file, header-only file. `"0"`/`"1"`/`"true"`/`"yes"` infer boolean. A
leading-zero string like `"007"` infers **text**, not integer.
**Verify:** `npm run test -- csv`

### P2.4 — CSV import execution
**Do:** Apply a confirmed mapping — `ALTER TABLE` for new columns, then a batched transactional
insert. Re-import replaces all rows in the target table. Report inserted/skipped/error counts.
**Files:** `src/engine/db/import.ts` + tests
**Accept:** 5,000 rows import in a single transaction under 2s. A mid-file bad row rolls the whole
import back — the table is untouched, and the error names the offending row number. Re-import does
not duplicate.
**Verify:** `npm run test -- import`

### P2.5 — Record Source query + column introspection
**Do:** Store one source query per design. Execute it, return `Row[]` plus a `ColumnSchema`
derived from the result set (name + inferred type). This schema feeds the Inspector's field picker.
**Files:** `src/engine/db/recordSource.ts`, `src/engine/store/useDataStore.ts` + tests
**Accept:** `SELECT * FROM guests WHERE rsvp_status='Accepted'` returns typed rows and a column
schema. A query returning zero rows is a valid empty state, not an error. A syntactically invalid
query surfaces in diagnostics and leaves the previous rows intact.
**Verify:** `npm run test -- recordSource`

### P2.6 — Data grid
**Do:** TanStack Table 9 grid over the current table. Sort, column resize, inline cell edit writing
back through RPC, row add/delete. Virtualised for 10k rows.
**Files:** `src/components/data/DataGrid.tsx`
**Accept:** 10,000 rows scroll at 60fps. Cell edits persist and survive a re-query. Full keyboard
navigation: arrows move, `Enter` edits, `Escape` cancels, `Tab` advances. Dense per §4.4.
**Verify:** Playwright: import fixture → edit a cell → re-query → assert new value.

### P2.7 — CSV import dialog
**Do:** File drop → preview first 20 rows → column mapping UI (source → target, or "create
column", or "ignore") → type confirmation → import with progress.
**Files:** `src/components/data/CsvImportDialog.tsx`
**Accept:** Mapping is fully keyboard-operable. Inferred types are shown and overridable. Errors
are inline and specific. Cancel at any stage leaves the database untouched.
**Verify:** Playwright: drop fixture CSV → map → import → assert grid populated.

---

## Phase 3 — Canvas Editor

### P3.1 — Scene graph model **[pure]**
**Do:** `SceneNode` discriminated union — text, rect, ellipse, line, path, image, group. Geometry
in Points. Serialise to/from Fabric objects. **This is the worker-crossing format and the PDF
renderer's input contract; Fabric instances never leave the main thread.**
**Files:** `src/engine/scene/{types,toFabric,fromFabric}.ts` + tests
**Accept:** Round-trip Fabric → SceneNode → Fabric preserves geometry to 1e-6, style, z-order and
group nesting. `structuredClone` of a `SceneNode[]` succeeds (proving worker-transferability).
Unknown node types fail at compile time via exhaustive switch.
**Verify:** `npm run test -- scene`

### P3.2 — Fabric canvas wrapper
**Do:** React wrapper around Fabric 6.9.1 with correct mount/unmount, resize observation, and
device-pixel-ratio handling. Dynamic import to keep Fabric off the server. Canvas state syncs to
`useCanvasStore` — narrow selectors only.
**Files:** `src/components/canvas/StudioCanvas.tsx`, `src/engine/store/useCanvasStore.ts`
**Accept:** No SSR errors. Mount/unmount 50 times without leaking listeners or canvases (assert
listener count). Resize is debounced and does not distort geometry. No full-store subscriptions.
**Verify:** Playwright: load studio → assert canvas present → resize viewport → assert no error.

### P3.3 — Viewport: zoom, pan, fit, rulers
**Do:** Zoom 10–1600% via wheel/pinch/controls, space-drag and middle-drag pan, fit-to-artboard,
100% reset. Rulers in the active display unit with a live cursor indicator.
**Files:** `src/components/canvas/{CanvasViewport,CanvasRulers}.tsx`
**Accept:** Zoom is a view transform — object geometry in Points is **unchanged** at every zoom
level (assert by reading the store). Ruler ticks stay legible from 10% to 1600% (adaptive
subdivision). Pasteboard renders `--pasteboard`, artboard renders `--paper` with the single
permitted drop shadow.
**Verify:** Playwright: zoom to 400% → assert stored geometry identical to 100%.

### P3.4 — Object creation tools
**Do:** Text, rect, ellipse, line, image (upload), pen/path. Toolbar with keyboard shortcuts
(`T`, `R`, `E`, `L`, `I`, `P`, `V` for select).
**Files:** `src/components/canvas/CanvasToolbar.tsx`, `src/engine/scene/factories.ts`
**Accept:** Each tool creates a correctly typed `SceneNode` at the click point. Shortcuts work and
do not fire while a text object is in edit mode. Every created node survives a P3.1 round-trip.
**Verify:** Playwright: create one of each type → assert scene graph contents.

### P3.5 — Selection and direct manipulation
**Do:** Click, shift-click, marquee select. Move, resize (with corner-handle aspect lock), rotate.
Multi-select transforms operate on the group bounding box.
**Files:** `src/components/canvas/selection.ts`
**Accept:** Multi-select resize scales all members proportionally about the correct origin. Rotation
is about the selection centre. Selection outline uses `--accent` at 1px, unscaled by zoom.
**Verify:** Playwright: select two objects → resize → assert both geometries.

### P3.6 — Numeric transform fields
**Do:** X / Y / W / H / rotation inputs in the Inspector, in the active display unit. Unit-suffix
parsing via P0.4. Arrow-key increment (1 unit; `Shift` 10).
**Files:** `src/components/inspector/TransformFields.tsx`
**Accept:** Typing `85mm` into W sets exactly 240.945pt. Tabular numerals throughout. Values update
live during canvas drag without fighting user input mid-edit. Multi-select shows `—` for fields
that differ.
**Verify:** Playwright: type `85mm` → assert stored Points value.

### P3.7 — Guides and snapping
**Do:** Drag guides from rulers. Snap to guides, object edges/centres, artboard edges/centre, and
an optional grid. 4px screen-space threshold (so it stays constant across zoom). Visual snap
indicators.
**Files:** `src/engine/canvas/snapping.ts` + tests, `src/components/canvas/Guides.tsx`
**Accept:** Snap threshold is constant in *screen* pixels at every zoom level. Holding `Ctrl`
suspends snapping. Guides persist in the design and survive save/load. Snap target resolution is
deterministic when several candidates are within threshold (document the precedence).
**Verify:** `npm run test -- snapping` + Playwright drag test.

### P3.8 — Align, distribute, z-order, group
**Do:** Align 6 ways, distribute horizontally/vertically, bring/send forward/back/front/end,
group/ungroup.
**Files:** `src/engine/canvas/arrange.ts` + tests
**Accept:** Align on a single selection aligns to the artboard; on multi-select, to the selection
bounds. Distribute requires ≥3 and equalises gaps, not centres. Group preserves child geometry and
z-order; ungroup restores absolute positions exactly.
**Verify:** `npm run test -- arrange`

### P3.9 — Undo/redo
**Do:** Command stack. Every mutation is a command with `apply`/`invert`. Coalesce continuous drags
into one entry. `Ctrl+Z` / `Ctrl+Shift+Z`. Depth 100.
**Files:** `src/engine/history/*.ts` + tests
**Accept:** A 20-step sequence undoes and redoes to byte-identical scene graphs. A drag is one
entry, not one per mousemove. Redo is correctly discarded after a new action. Selection state is
restored alongside geometry.
**Verify:** `npm run test -- history`

### P3.10 — Layers panel
**Do:** Tree view of the scene graph. Reorder by drag, rename, toggle visibility/lock, select.
**This is the screen-reader representation of the canvas — treat it as a first-class a11y surface,
not a convenience.**
**Files:** `src/components/canvas/LayersPanel.tsx`
**Accept:** Full keyboard tree navigation with correct `role="tree"`/`treeitem`/`aria-level`
semantics. Stays in sync with canvas selection in both directions. Token-bound layers carry the
`--bound` indicator.
**Verify:** Playwright + `axe` scan of the panel.

---

## Phase 4 — Persistence

### P4.1 — Asset blob store
**Do:** IndexedDB store for image blobs, content-hash addressed. Scene nodes reference by hash.
Reference counting with garbage collection of orphans.
**Files:** `src/engine/persistence/assetStore.ts` + tests
**Accept:** The same image added twice stores once. Deleting the last referencing node GCs the
blob; deleting one of two does not. Blobs survive reload. Store exposes total bytes used.
**Verify:** `npm run test -- assetStore`

### P4.2 — `.toke` file format
**Do:** Zip container: `manifest.json` (with `schemaVersion`), `design.json`, `data.sqlite`
(`db.export()` bytes), `imposition.json`, `assets/`, `fonts/`. **Format supports N designs per
project from day one** even though v1's UI exposes one.
**Files:** `src/engine/persistence/tokeFile.ts` + tests
**Accept:** Save → load round-trip reproduces scene graph, database rows, imposition config, assets
and fonts exactly. A future `schemaVersion` is refused with a clear message rather than partially
loaded. A corrupt zip fails cleanly. `designs` is an array in the manifest.
**Verify:** `npm run test -- tokeFile`

### P4.3 — Save / open
**Do:** File System Access API where available, `<a download>` + file input fallback elsewhere.
Track dirty state; prompt on unload when dirty.
**Files:** `src/engine/persistence/fileIo.ts`, `src/components/shell/FileMenu.tsx`
**Accept:** Save-then-open restores an identical studio. Fallback path works in Firefox/Safari.
Dirty indicator is accurate. `beforeunload` fires only when genuinely dirty.
**Verify:** Playwright: create design → save → reload → open → assert scene graph.

### P4.4 — Autosave and crash recovery
**Do:** Debounced 2s + on-blur autosave to IndexedDB. `BroadcastChannel` single-writer lock across
tabs. On boot, offer recovery if an unclean session is detected.
**Files:** `src/engine/persistence/autosave.ts` + tests
**Accept:** A simulated crash mid-edit recovers work to within one debounce interval. A second tab
opens read-only with a clear banner rather than racing the first. Autosave never blocks the main
thread perceptibly.
**Verify:** `npm run test -- autosave` + Playwright two-context test.

---

## Phase 5 — Fonts & Text Measurement

**The shared contract between canvas and PDF. Everything downstream depends on it being exact.**

### P5.1 — Font loader
**Do:** Load `.ttf`/`.otf` as `ArrayBuffer`. Parse with fontkit for metrics; register with the
`FontFace` API for canvas. Bundle IBM Plex Sans/Mono and a small curated starter set; support user
upload behind a licensing acknowledgement.
**Files:** `src/engine/text/fontLoader.ts` + tests
**Accept:** A loaded font is available to both fontkit and canvas. OTF/CFF is accepted or rejected
with a specific message — never silently mis-rendered. A variable font is rejected with guidance to
supply a static instance. Font bytes are retained for PDF embedding.
**Verify:** `npm run test -- fontLoader`

### P5.2 — Measurement service **[pure]**
**Do:** The single text-measurement path. Given string, font, size, tracking and optional wrap
width: return advance width, line boxes, ascent/descent, and wrapped line breaks. fontkit metrics
only. Kern pairs from the font's `kern`/`GPOS` where simple; **no complex shaping**.
**Files:** `src/engine/text/measure.ts` + tests
**Accept:** Measurements match fontkit's own `layout()` advance widths exactly. Word wrap breaks at
the correct indices, including a word longer than the wrap width, trailing whitespace, and
consecutive spaces. Empty string returns zero width and one line box. **A grep test asserts
`measureText` appears nowhere in `src/` outside this file's tests.**
**Verify:** `npm run test -- measure`

### P5.3 — Wire Fabric text to the measurement service
**Do:** Override Fabric's text measurement so on-canvas layout uses P5.2.
**Files:** `src/engine/scene/textNode.ts`
**Accept:** Canvas-rendered text width equals `measure()` output within 0.5pt for a 20-string
fixture across 3 fonts and 5 sizes. **This is the guarantee that auto-fit passing on screen means it
fits in the PDF** — if it fails, stop and fix it before Phase 6.
**Verify:** `npm run test -- textNode`

---

## Phase 6 — Token Engine

### P6.1 — Token parser **[pure]**
**Do:** Parse `{{ table.field | formatter }}` from a string into literal and token segments.
Support multiple tokens per string, chained formatters, and escaped `\{{`.
**Files:** `src/engine/tokens/parser.ts` + tests
**Accept:** Handles whitespace variation, unclosed braces (→ literal, no throw), unknown formatter
(→ structured error naming it), nested braces, and empty `{{}}`. Round-trips segments back to the
original string.
**Verify:** `npm run test -- tokens/parser`

### P6.2 — Formatters **[pure]**
**Do:** `upper`, `lower`, `title`, `trim`. Chainable, pure, each individually tested.
**Files:** `src/engine/tokens/formatters.ts` + tests
**Accept:** `title` handles hyphenated and apostrophed names correctly — `o'brien` → `O'Brien`,
`mary-jane` → `Mary-Jane`. Formatters are null-safe. Chain order is applied left to right.
**Verify:** `npm run test -- formatters`

### P6.3 — Resolver and fallback rules **[pure]**
**Do:** Resolve tokens against the current row. Fallback fires on `NULL`, empty string, or
whitespace-only. Missing column is a structured error, not a silent empty.
**Files:** `src/engine/tokens/resolver.ts` + tests
**Accept:** All three fallback triggers verified separately. A column absent from the row schema
produces `UNKNOWN_COLUMN` with the column name and the object id. Numeric `0` and `false` resolve
to `"0"`/`"false"` — they are **not** treated as empty.
**Verify:** `npm run test -- resolver`

### P6.4 — Smart-space collapsing **[pure]**
**Do:** When a token resolves empty and is surrounded by whitespace literals, collapse the
duplicated space. Trim leading/trailing whitespace from the final string.
**Files:** `src/engine/tokens/collapse.ts` + tests
**Accept:** `"{{First}} {{Middle}} {{Last}}"` with an empty middle yields `"Ada Lovelace"`, not
`"Ada  Lovelace"`. Leading and trailing empties leave no edge whitespace. Intentional double spaces
in *literal* text are preserved.
**Verify:** `npm run test -- collapse`

### P6.5 — Auto-fit engine **[pure]**
**Do:** Three modes. `shrink-to-fit`: binary-search font size between min and max using P5.2.
`truncate`: clip at the box and append `…`. `wrap`: wrap to width, shrink only if height overflows.
All report an overflow flag when constraints cannot be met.
**Files:** `src/engine/text/autoFit.ts` + tests
**Accept:** Binary search converges in ≤8 iterations for any range and never returns a size that
overflows. At `minFontSize` with residual overflow, the flag is set and the configured mode is
applied. Truncation never splits a surrogate pair or combining mark. `wrap` respects both width and
height.
**Verify:** `npm run test -- autoFit`

### P6.6 — Binding inspector
**Do:** Bind a text object to a token. Field picker populated from P2.5's column schema. Formatter
chips. Fallback value input. Auto-fit mode + min/max size controls. Live preview of the current
record.
**Files:** `src/components/inspector/{TokenBindingPanel,AutoFitSettings}.tsx`
**Accept:** Field picker lists only columns in the current record source. Binding is reversible
without data loss. Overflow state shows both the `--overflow` colour **and** a text badge. Panel is
fully keyboard-operable.
**Verify:** Playwright: bind field → assert canvas shows resolved value.

### P6.7 — Token Mode rendering
**Do:** In Token Mode, render the literal `{{ guests.first_name }}` string with a dotted `--bound`
outline on bound objects. In Live Mode, render resolved values.
**Files:** `src/engine/scene/tokenRender.ts`, `src/components/shell/ModeSwitcher.tsx`
**Accept:** Mode switch is instant and non-destructive. Outline is 1px dotted, unscaled by zoom.
Auto-fit is applied in **Live Mode only** — Token Mode shows the design's authored size.
**Verify:** Playwright: toggle modes → assert rendered text.

---

## Phase 7 — Live Mode & Pre-flight

### P7.1 — Record cursor
**Do:** Cursor state over the record-source rows. First/prev/next/last, jump to index, jump by id.
Clamped at both ends. Reset appropriately when the source query changes.
**Files:** `src/engine/store/useStudioStore.ts` + tests
**Accept:** Cursor never goes out of bounds. Zero rows is a valid state the UI handles. Changing the
source query resets the cursor to 0 and does not retain a stale row.
**Verify:** `npm run test -- cursor`

### P7.2 — Cycle bar
**Do:** `|< < Record 42 of 150 > >|` with keyboard shortcuts (`PageUp`/`PageDown`, `Home`/`End`)
and a search-to-jump field matching against a configurable display column.
**Files:** `src/components/preview/{CycleBar,RecordSearch}.tsx`
**Accept:** Tabular numerals — the counter must not shift width while cycling. Search is debounced
and matches case-insensitively on substring. Holding `PageDown` cycles smoothly with no dropped
frames at 150 records.
**Verify:** Playwright: cycle 10 records → assert canvas updates each time.

### P7.3 — Pre-flight report
**Do:** Scan every record before export. Report per-record: text overflow at min size, unresolved
tokens, missing assets. Summary counts plus a jump-to-record action per finding.
**Files:** `src/engine/preflight/*.ts` + tests, `src/components/preview/PreflightReport.tsx`
**Accept:** 150 records scan in under 2s. **Findings do not block export** — they warn. Clicking a
finding jumps to the record and selects the offending object. A clean scan shows the `--ok` state
with an explicit "142 records, no issues" message.
**Verify:** `npm run test -- preflight` + Playwright.

---

## Phase 8 — PDF Export

### P8.1 — PDF document setup
**Do:** pdf-lib document with `@pdf-lib/fontkit` registered. Per page: `MediaBox` = sheet,
`BleedBox` = trim + bleed, `TrimBox` = trim.
**Files:** `src/engine/pdf/document.ts` + tests
**Accept:** All three boxes are present and correct in the output, verified by parsing the generated
PDF back. Page size matches the sheet spec to 0.001pt.
**Verify:** `npm run test:pdf -- document`

### P8.2 — Shape renderers
**Do:** `SceneNode` → pdf-lib draw calls for rect, ellipse, line, path. Fill, stroke, stroke width,
dash, opacity.
**Files:** `src/engine/pdf/renderers/shapes.ts` + tests
**Accept:** Each shape's rendered geometry, extracted from the PDF, matches its `SceneNode` within
0.01pt. Stroke alignment is explicit and documented (pdf-lib centres strokes). Zero-size shapes are
skipped, not emitted as degenerate operators.
**Verify:** `npm run test:pdf -- shapes`

### P8.3 — Text renderer
**Do:** Text nodes via `drawText` with the subset-embedded font, positioned using P5.2 line boxes.
Handle multi-line, alignment, tracking and baseline correctly.
**Files:** `src/engine/pdf/renderers/text.ts` + tests
**Accept:** Extracted text positions match P5.2's computed line boxes within 0.01pt. Multi-line
leading is correct. Centre and right alignment are exact. **A fixture that auto-fits on canvas
produces text within the trim box in the PDF** — this is the headline correctness claim of the
product.
**Verify:** `npm run test:pdf -- text`

### P8.4 — Image renderer
**Do:** Embed PNG/JPEG from the asset store, positioned and scaled per the node's transform, with
clipping where the node is clipped.
**Files:** `src/engine/pdf/renderers/image.ts` + tests
**Accept:** Aspect ratio preserved. Unsupported formats are reported in pre-flight, not silently
dropped. The same asset used on 150 cards is embedded **once** and referenced — assert by file size.
**Verify:** `npm run test:pdf -- image`

### P8.5 — Transforms, groups and clipping
**Do:** Matrix push/pop for group nesting, rotation and scale. Clip paths. Nested opacity.
**Files:** `src/engine/pdf/renderers/transform.ts` + tests
**Accept:** A rotated object inside a scaled group lands in the correct absolute position. Graphics
state is balanced — every push has a matching pop (assert by parsing the content stream). Nested
opacity multiplies correctly.
**Verify:** `npm run test:pdf -- transform`

### P8.6 — Font subsetting
**Do:** Embed only the glyphs actually used across the whole run. One subset per font per document.
**Files:** `src/engine/pdf/fonts.ts` + tests
**Accept:** A 150-record export embeds a subset dramatically smaller than the full font. All used
glyphs are present — no `.notdef` boxes. Two designs sharing a font produce one embedded subset.
**Verify:** `npm run test:pdf -- fonts`

### P8.7 — Sheet assembly
**Do:** Combine P1.3/1.4/1.5/1.6 with the renderers: for each sheet, for each cell, translate to the
cell origin and render the record's resolved scene graph; then draw crop and fold marks.
**Files:** `src/engine/pdf/assemble.ts` + tests
**Accept:** 142 records at 10-up produce 15 pages. Every card sits exactly in its solved cell. Crop
marks appear once per sheet in the margins. The final partial sheet renders 2 cards and no empty
placeholders.
**Verify:** `npm run test:pdf -- assemble`

### P8.8 — Export worker
**Do:** `pdf.worker.ts` receiving resolved scene graphs, font bytes and imposition config. Chunked
page emission, progress messages, cancellation.
**Files:** `src/engine/pdf/pdf.worker.ts`, `src/components/imposition/ExportDialog.tsx`
**Accept:** **500 records export in under 30s and under 1GB peak memory.** Progress is monotonic and
accurate. Cancel stops within 500ms and frees memory. The main thread stays responsive — the canvas
is still pannable during export.
**Verify:** `npm run test:pdf -- worker` + a manual 500-record timing run.

### P8.9 — Proof export
**Do:** Single-record export at trim size with no imposition, for on-screen checking.
**Files:** `src/engine/pdf/proof.ts`
**Accept:** One page at exactly trim size, current record, no crop marks. Generates in under 500ms.
**Verify:** `npm run test:pdf -- proof`

### P8.10 — Imposition panel
**Do:** Sheet preset picker, trim dimensions, bleed, margins, shared-cut toggle, tent-fold toggle,
live N-up and sheet-count readout, visual sheet preview.
**Files:** `src/components/imposition/{ImpositionPanel,SheetPreview}.tsx`
**Accept:** Readout updates live: "10-up · 15 sheets · 8 cells empty on final sheet". Preview
matches actual PDF output geometry. Invalid configurations are explained inline, not just disabled.
**Verify:** Playwright: change sheet size → assert N-up readout.

---

## Phase 9 — Shell, Diagnostics & Accessibility

### P9.1 — Application shell
**Do:** Assemble header, left sidebar, canvas, right inspector, bottom bar. Resizable, collapsible
panels with persisted sizes.
**Files:** `src/components/shell/AppShell.tsx`
**Accept:** Panel sizes persist across reload. Canvas resizes correctly as panels move. No layout
shift on load. Density matches §4.4 exactly.
**Verify:** Playwright layout assertions.

### P9.2 — Diagnostics panel
**Do:** Bottom-bar panel listing SQL errors, token failures, overflow warnings, font problems and
export progress. Severity filter. Click a finding to select the offending canvas object.
**Files:** `src/components/shell/DiagnosticsPanel.tsx`
**Accept:** Every `AppError` with an `objectId` is click-to-focus. Entries are timestamped and
clearable. **No error anywhere in the app is swallowed without appearing here** — audit every
`catch` in the codebase as part of this task.
**Verify:** Playwright: trigger a SQL error → assert diagnostics entry → click → assert selection.

### P9.3 — SQL console
**Do:** CodeMirror 6 SQL editor in the bottom bar. Execute, result grid, error display, history.
Sets the record source from the current query.
**Files:** `src/components/data/SqlConsole.tsx`
**Accept:** Syntax highlighting. `Ctrl+Enter` executes. Errors show the SQLite message inline.
"Use as record source" wires the query straight into P2.5. Monospace, tabular numerals in results.
**Verify:** Playwright: run a query → assert results → set as source.

### P9.4 — Templates and first run
**Do:** Two starter templates (flat place card 85 × 55mm; tent place card 85 × 110mm) plus a 24-row
sample guest dataset. Template gallery on empty state.
**Files:** `public/templates/*.toke`, `src/components/shell/TemplateGallery.tsx`
**Accept:** A template loads into a working design with sample data, bound tokens and a valid
imposition config. A new user can reach a correct exported PDF **without importing anything**.
**Verify:** Playwright: fresh load → pick template → export → assert PDF page count.

### P9.5 — Keyboard and accessibility pass
**Do:** Full audit. Canvas `Tab` cycling, arrow nudge (1pt / `Shift` 10pt), `Enter` to edit,
`Escape` to deselect. Focus rings everywhere. ARIA on all custom controls. A visible shortcut
reference.
**Files:** across the component tree
**Accept:** `axe` reports zero violations on every view. Every action is reachable by keyboard.
Focus order is logical and focus is never trapped. Screen reader announces mode switches and record
changes via a live region.
**Verify:** `npm run test:e2e -- a11y`

### P9.6 — Small-viewport state
**Do:** Below 1024px, replace the studio with an explicit message and a read-only proof preview of
the current record.
**Files:** `src/components/shell/SmallViewport.tsx`
**Accept:** No horizontal scroll at 390px. The message is specific and non-patronising. The proof
preview is genuinely usable for checking a record on a phone.
**Verify:** Playwright at 390 / 768 / 1024 / 1440px.

### P9.7 — Release verification
**Do:** Full end-to-end pass against the v1 acceptance scenario.
**Accept, in one unbroken run:** Import a 150-row guest CSV → design an 85 × 55mm place card →
bind `first_name` and `last_name` with auto-fit → cycle to the longest name and confirm it fits →
configure A4 shared-cut with 3mm bleed → pre-flight clean → export → **15-page PDF, correct
`TrimBox`/`BleedBox`, crop marks in margins only, subset-embedded fonts, selectable vector text,
every card inside its trim** → save `.toke` → reload → reopen → identical studio state.
**Verify:** Full Playwright suite + manual inspection of the PDF in Acrobat with box overlays on.

---

## Task Count

| Phase | Tasks | Focus |
|---|---|---|
| P0 Foundation | 6 | Scaffold, tooling, units, theme |
| P1 Geometry & Imposition | 6 | **[pure]** — highest-risk maths, proven first |
| P2 Data Layer | 7 | SQLite worker, CSV, grid, record source |
| P3 Canvas Editor | 10 | Scene graph, tools, precision, history |
| P4 Persistence | 4 | Assets, `.toke`, save/open, autosave |
| P5 Fonts & Measurement | 3 | The canvas ⇄ PDF contract |
| P6 Token Engine | 7 | Parse, resolve, format, auto-fit |
| P7 Live Mode | 3 | Cursor, cycle bar, pre-flight |
| P8 PDF Export | 10 | Custom renderer, subsetting, assembly |
| P9 Shell & A11y | 7 | Diagnostics, SQL, templates, keyboard |
| **Total** | **63** | |

## Critical Path

```
P0.4 units ──► P1.* imposition ──────────────┐
                                             ▼
P2.1 db worker ──► P2.5 record source ──► P6.3 resolver ──► P6.5 auto-fit ──► P8.3 text
                                             ▲                    ▲              ▲
P5.1 fonts ──► P5.2 measure ─────────────────┴────────────────────┴──────────────┘
                    │
                    └──► P5.3 wire Fabric  ◄── the correctness linchpin
```

**P5.2 → P5.3 is the linchpin.** If canvas and PDF measurement diverge, auto-fit lies: text that
fits on screen overflows the trim in print, and the product's core promise fails silently across an
entire print run. Do not proceed past Phase 5 until P5.3's 0.5pt tolerance holds.

**P8.3 is the highest-risk single task.** Text positioning in a hand-written PDF renderer is where
this kind of project usually breaks. Budget accordingly.
