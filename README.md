# toke

Browser-first, vector-based **variable data design studio**.

Bind canvas elements to a relational dataset, cycle through live records, impose N-up onto print
sheets, and export press-ready vector PDF. Built for personalised stationery and event collateral —
place cards, menus, invitations, seating charts.

Everything runs client-side: SQLite compiles to WebAssembly in a worker, the canvas is Fabric.js,
and PDF generation happens in the browser. There is no backend.

---

## Status

**Pre-scaffold.** The audit, architecture and task plan are complete; the application itself has not
been generated yet. Start at task **P0.1** in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

The `npm` scripts referenced throughout the docs land with P0.1 and P0.2.

## Documentation

| File | Contents |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Architecture, code style, design system, domain glossary. The source of truth for conventions. |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | 63 atomic tasks with acceptance criteria, across 10 phases. |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Branching model, environments, Vercel deployment, release process. |
| [scratch/PRD.md](scratch/PRD.md) | Original product requirements. Superseded where CLAUDE.md §9 says so. |

## Getting started

```bash
npm install
npm run env:pull     # vercel env pull .env.local
npm run dev
```

## Stack

Next.js 16 · React 19 · TypeScript · Fabric.js 6.9 · sql.js (SQLite WASM) · pdf-lib + fontkit ·
zustand · TanStack Table · Tailwind · Biome · Vitest · Playwright · Vercel

## Contributing

Branch from `staging`, never from `main`. See [DEVELOPMENT.md](DEVELOPMENT.md).
