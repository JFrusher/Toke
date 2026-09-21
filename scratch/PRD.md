# Product Requirements Document (PRD) & Technical Architecture

**Project Name:** Toke

**Deployment Target:** Vercel (Next.js App Router + Client-Side WASM / Web Worker)

**Document Status:** Execution-Ready Blueprint for AI Coding Agents (Claude Code)

**Version:** 1.0.0

---

## 1. Executive Summary & Core Philosophy

### 1.1 Product Vision

**toke** is a browser-first, vector-based variable data design studio bridging the gap between unstructured freeform graphic design tools (e.g., Canva) and structured relational data engines (e.g., Airtable, SQL databases, Adobe InDesign Data Merge).

It is built specifically to eliminate the friction in designing personalized stationery, event collateral, and variable-data print assets—such as place cards, custom menus, dynamic invitations, and complex multi-record seating charts.

### 1.2 Core Architectural Axioms

1. **Zero-Server Client-Side Compute:** All database operations (SQLite WASM), layout rendering (Fabric.js), and PDF generation (`pdf-lib`) execute client-side in Web Workers or client threads. Deployment on Vercel requires zero complex backend infrastructure—Vercel serves purely as the static asset / SSR host.
2. **Relational-First Design Canvas:** Elements on the canvas are not static text blocks; they are bound to a reactive in-memory relational database state.
3. **Deterministic Imposition & Vector Fidelity:** What is rendered on screen translates 1:1 to print-ready CMYK-aware PDF documents with precision bleeds, trim boxes, and crop marks.
4. **Dual-Mode Ergonomics:** A clear separation between **Token Design Mode** (editing layout, binding variables, writing conditional rules) and **Live Data Mode** (cycling through actual records, stress-testing layout extremes, and auditing print boundaries).

---

## 2. Design System & UI/UX Framework

### 2.1 Design Language & Aesthetic Guidelines

To provide a clean, uncluttered interface for detailed visual layout work:

* **Theme:** Neutral Dark (`#121214` main background, `#1E1E22` surface, `#2B2B30` borders, `#FAFAFA` primary text). Accent color: **Indigo/Violet Electric** (`#6366F1`) for active tokens, selections, and primary actions.
* **Typography:** Inter for UI elements, JetBrains Mono for token syntax, SQL editor, and property values.
* **Density:** High-density control panels (compact inputs, iconography from Lucide React) maximizing canvas viewport space.
* **UI Components:** Built using **Shadcn UI** + **Tailwind CSS** + **Radix UI Primitives**.

### 2.2 Layout Topography

```
+---------------------------------------------------------------------------------------------------+
|  HEADER BAR: Project Title | Mode Switcher [Token Mode / Live Mode] | Cycle Bar [< Rec 4/120 >] | Export |
+------------------+----------------------------------------------------------+---------------------+
|  LEFT SIDEBAR    |  CANVAS VIEWPORT                                         | RIGHT PANEL         |
|  - Data Tables   |                                                          |                     |
|  - Token Library |  [ Fabric.js Viewport / Dynamic Rulers / Zoom Controls ]  | - Inspector         |
|  - Layers        |                                                          | - Typography        |
|  - Assets        |  +----------------------------------------------------+  | - Token Binding     |
|                  |  |  Place Card Render Bounds                          |  | - Conditional Logic |
|                  |  |  {{ Guest.FirstName }} {{ Guest.LastName }}        |  | - Imposition Rules  |
|                  |  +----------------------------------------------------+  |                     |
+------------------+----------------------------------------------------------+---------------------+
|  BOTTOM BAR: SQLite Query Console (Collapsible) / Terminal Output / Status & Error Diagnostics      |
+---------------------------------------------------------------------------------------------------+

```

---

## 3. Data Architecture & In-Memory Engine

### 3.1 In-Memory Relational Engine (`sql.js` / WASM)

toke uses `sql.js` (SQLite compiled to WebAssembly) running inside a dedicated Web Worker (`db.worker.ts`).

#### Core Schema Definition (Default Wedding/Event Starter Template)

```sql
-- Core Table: Guests
CREATE TABLE guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    dietary_requirements TEXT DEFAULT 'None',
    is_vegetarian BOOLEAN DEFAULT 0,
    is_plus_one BOOLEAN DEFAULT 0,
    table_id INTEGER,
    seat_number INTEGER,
    rsvp_status TEXT CHECK(rsvp_status IN ('Accepted', 'Declined', 'Pending')) DEFAULT 'Pending',
    FOREIGN KEY(table_id) REFERENCES event_tables(id)
);

-- Core Table: Event Tables
CREATE TABLE event_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_number INTEGER NOT NULL UNIQUE,
    table_name TEXT NOT NULL,
    capacity INTEGER DEFAULT 10,
    location_zone TEXT
);

-- Core Table: Custom Options / Menu Selections
CREATE TABLE menu_selections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id INTEGER,
    starter_choice TEXT,
    main_choice TEXT,
    dessert_choice TEXT,
    FOREIGN KEY(guest_id) REFERENCES guests(id)
);

```

### 3.2 Dual-Tier Query Interface

1. **Tier 1: Visual Query Builder (Shadcn UI Dropdowns):**
* Select Table $\rightarrow$ Select Field $\rightarrow$ Set Condition.
* Example: `FROM guests WHERE is_vegetarian = 1 AND rsvp_status = 'Accepted'`.


2. **Tier 2: SQL Raw Editor (Monaco Editor / CodeMirror integration):**
* Direct SQL execution console allowing arbitrary queries, CTEs, and JOINs.
* Query outputs automatically hydrate the Token Binding Engine.



---

## 4. Canvas Engine & Tokenization Protocol

### 4.1 Fabric.js Canvas Wrapper

The design canvas is built on Fabric.js (v6+), wrapped within a custom React ref lifecycle manager.

#### Extended Fabric Object Properties

Every object added to the Fabric.js canvas (Text, Image, Group, Frame) is extended with a custom dataset payload:

```typescript
export interface TokenBindingMetadata {
  bindingId: string;
  tokenType: 'scalar' | 'conditional' | 'repeater';
  query: string; // E.g., "SELECT first_name FROM guests WHERE id = :active_id"
  fallbackValue: string;
  autoFit: {
    enabled: boolean;
    minFontSize: number;
    maxFontSize: number;
    mode: 'shrink-to-fit' | 'truncate' | 'wrap';
  };
  conditionalLogic?: {
    expression: string; // E.g., "is_vegetarian == 1"
    actionOnFalse: 'hide' | 'opacity-zero' | 'render-fallback';
    fallbackAssetUrl?: string;
  };
  repeaterConfig?: {
    groupByField: string; // E.g., "table_id"
    maxColumns: number;
    itemSpacingX: number;
    itemSpacingY: number;
    direction: 'horizontal' | 'vertical' | 'grid';
  };
}

```

### 4.2 Token Types & Behavior

#### 1. Scalar Tokens (`{{ Table.Field }}`)

* Replaces string matches inside Fabric `IText` or `Textbox` objects.
* **Auto-Fit Engine Algorithm:**
1. Calculate target bounding box constraints (`width`, `height`).
2. Measure rendered text width using Canvas 2D context (`ctx.measureText`).
3. If rendered width > bounding box width:
* Iteratively decrement `fontSize` until `renderedWidth <= boundingWidth` or `fontSize == minFontSize`.
* If `fontSize == minFontSize` and string still overflows, apply truncation (`...`) or trigger a canvas overflow error flag on the UI.





#### 2. Conditional Container Tokens (`IF / ELSE` Visibility Blocks)

* Binds an entire Fabric element or group to a boolean evaluation rule.
* **Evaluation Flow:**
* Record values are injected into an isolated expression evaluator.
* If `TRUE`: Element set to `visible = true`, `opacity = 1`.
* If `FALSE`: Element hidden, layout re-adjusted if contained within a dynamic flow stack.



#### 3. Repeater / Grid Tokens (1-to-Many Aggregation for Seating Charts)

* Used for canvas items like Table Cards or Seating Board directories.
* **Workflow:**
1. Define a **Parent Container** (e.g., Table 1 Frame).
2. Insert a **Template Item** bound to a list query (`SELECT first_name, last_name FROM guests WHERE table_id = :table_id`).
3. Fabric canvas automatically clones and positions the template item vertically/horizontally across the container based on `itemSpacingY` and `maxColumns`.



---

## 5. Dual-Mode UX & Live QA Workflow

### 5.1 Token Design Mode

* Canvas renders token strings explicitly: `{{ guests.first_name }}`.
* Bounding boxes for tokens display dotted violet outlines.
* Conditional layers show status icons (e.g., `[Veg Flag: Conditional]`).

### 5.2 Live Data Mode & Stress Testing

* **Cycle Bar Interface:**
* Fast record navigation: `|<  <  Record #42 of 150  >  >|`.
* Search bar to jump to a specific guest by name.


* **Stress-Test Filters:**
* **Longest String Audit:** Evaluates the database to find records with the max length for each field (e.g., guest with the longest full name) and forces preview on them.
* **Edge Case Inspector:** Previews records missing optional data (e.g., no dietary requirements provided).



---

## 6. Print Imposition & Export Engine

### 6.1 Imposition Pipeline Architecture

For 1-to-1 designs (e.g., printing 10 place cards per A4 sheet):

```
+-----------------------------------------------------------------------+
|  A4 / Letter Sheet Canvas Container (210mm x 297mm)                   |
|                                                                       |
|  +------------------+  [Bleed: 3mm]  +------------------+             |
|  | Place Card #1    |  <----------->  | Place Card #2    |             |
|  | (85mm x 55mm)    |                | (85mm x 55mm)    |             |
|  +------------------+                +------------------+             |
|  | Trim Box Bounds  |                | Trim Box Bounds  |             |
|  +------------------+                +------------------+             |
|  + (Crop Mark)                      + (Crop Mark)                     |
|                                                                       |
|  +------------------+                +------------------+             |
|  | Place Card #3    |                | Place Card #4    |             |
|  +------------------+                +------------------+             |
+-----------------------------------------------------------------------+

```

### 6.2 Imposition Configuration Parameters

* **Target Sheet Size:** A4, A3, US Letter, US Tabloid, or Custom dimensions.
* **Design Dimensions:** Exact trimmed dimensions (e.g., `85mm x 55mm`).
* **Bleed Margin:** Default `3mm` (or `0.125 in`).
* **Cut Marks & Registration Marks:**
* Outside trim box: 0.25pt black stroke crop marks placed at corners.
* Optional color bars and job metadata header at top margin.



### 6.3 Vector PDF Export (`pdf-lib`)

* Runs inside a dedicated Web Worker to prevent main thread frame drops.
* Converts Fabric canvas SVG/vector layers into high-resolution PDF pages.
* Supports embeddable custom TrueType (`.ttf`) and OpenType (`.otf`) fonts loaded via `ArrayBuffer`.

---

## 7. Directory & Repository Structure

```
toke/
├── public/
  ├── fonts/
  ├── templates/
  └── sql-wasm.wasm
├── src/
│   ├── app/                        # Next.js App Router Pages
│   │   ├── layout.tsx
│   │   ├── page.tsx                # Studio Main Viewport
│   │   └── api/                    # Static / Edge route stubs
│   ├── components/                 # React UI Components
│   │   ├── canvas/                 # Fabric.js Canvas Wrappers
│   │   │   ├── StudioCanvas.tsx
│   │   │   ├── CanvasRulers.tsx
│   │   │   └── CanvasToolbar.tsx
│   │   ├── data/                   # Data Grid & SQL Editor
│   │   │   ├── DataGridModal.tsx
│   │   │   ├── SqlConsole.tsx
│   │   │   └── VisualQueryBuilder.tsx
│   │   ├── inspector/              # Right Sidebar Control Panels
│   │   │   ├── InspectorPanel.tsx
│   │   │   ├── TokenBindingPanel.tsx
│   │   │   ├── AutoFitSettings.tsx
│   │   │   └── ConditionalLogicPanel.tsx
│   │   ├── preview/                # Live QA & Cycle Controls
│   │   │   ├── CycleBar.tsx
│   │   │   └── StressTestModal.tsx
│   │   └── ui/                     # Shadcn UI Primitives
│   ├── engine/                     # Core Business Logic & State
│   │   ├── db/                     # SQLite WASM Bridge
│   │   │   ├── db.worker.ts
│   │   │   └── DatabaseContext.tsx
│   │   ├── canvas/                 # Fabric.js Binding Extensions
│   │   │   ├── tokenManager.ts
│   │   │   ├── autoFitEngine.ts
│   │   │   └── repeaterEngine.ts
│   │   ├── export/                 # PDF & Imposition Pipeline
│   │   │   ├── pdfExporter.worker.ts
│   │   │   └── impositionEngine.ts
│   │   └── store/                  # Zustand Global Application State
│   │       ├── useStudioStore.ts
│   │       ├── useDataStore.ts
│   │       └── useCanvasStore.ts
│   ├── lib/                        # Utility Libraries
│   │   ├── utils.ts
│   │   └── fontLoader.ts
│   └── types/                      # TypeScript Definitions
│       ├── canvas.ts
│       ├── database.ts
│       └── imposition.ts
├── tailwind.config.js
├── tsconfig.json
├── next.config.mjs
└── package.json

```

---

## 8. Technical Stack & Key Dependencies

```json
{
  "name": "toke",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "fabric": "^6.0.0-rc2",
    "sql.js": "^1.10.0",
    "pdf-lib": "^1.17.1",
    "@fontsource/inter": "^5.0.0",
    "@fontsource/jetbrains-mono": "^5.0.0",
    "zustand": "^4.5.0",
    "lucide-react": "^0.370.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.3.0",
    "@radix-ui/react-dialog": "^1.0.5",
    "@radix-ui/react-dropdown-menu": "^2.0.6",
    "@radix-ui/react-tabs": "^1.0.4",
    "@radix-ui/react-slider": "^1.1.2",
    "@radix-ui/react-switch": "^1.0.3",
    "@tanstack/react-table": "^8.16.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.12.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/sql.js": "^1.4.9",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.3"
  }
}

```

---

## 9. Vercel Deployment & Configuration Constraints

To guarantee zero-build-error deployment on Vercel:

### 9.1 WebAssembly & Web Worker Headers

Ensure `next.config.mjs` configures the correct headers for SharedArrayBuffer / WASM execution and excludes Web Workers from server bundling:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Enable WebAssembly support
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Fallbacks for node built-ins in browser
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }

    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
        ],
      },
    ];
  },
};

export default nextConfig;

```

---

## 10. Development Roadmap & Execution Phases

AI Coding Agents (Claude Code) should construct the repository adhering to this sequence:

1. **Phase 1: Base Application Shell & Fabric.js Canvas Integration**
* Initialize Next.js project with Tailwind CSS, Shadcn UI, and Zustand store.
* Render Fabric.js viewport with zoom, pan, rulers, and fundamental vector tools (Text, Rect, Circle, Image upload).


2. **Phase 2: SQLite WASM Worker & Data Layer**
* Integrate `sql.js` in a Web Worker thread.
* Build the spreadsheet grid (`@tanstack/react-table`) modal and CSV import parser.
* Build Visual Query Builder and SQL console components.


3. **Phase 3: Token Binding & Auto-Fit Engine**
* Implement custom metadata properties on Fabric.js objects.
* Write the Token Resolver module (replaces `{{ field }}` with DB value).
* Implement text auto-fit/shrink-to-fit measurement loops.


4. **Phase 4: Dual Mode & Live Preview Cycle**
* Add the Mode Switcher (`Token Mode` vs. `Live Mode`).
* Construct the Cycle Bar with record step navigation and longest-string stress-testing filter.


5. **Phase 5: Print Imposition & Vector PDF Export**
* Build the Imposition calculation module (calculating rows, cols, bleeds, crop mark locations).
* Integrate `pdf-lib` worker to synthesize high-res multi-page PDF output.