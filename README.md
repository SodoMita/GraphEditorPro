# Graph Editor Pro

An offline, single-file graph editor (nodes, edges, adjacency matrix, algorithms,
import/export in JSON / DOT / GraphML / CSV, EN/RU interface).

The deliverable is **`index.html`** — one static HTML file with everything
inlined. It performs **no network requests**: no fetches, no CDNs, no fonts,
no analytics. Open it from disk and it works.

## Repository layout

```
index.html            ← built artifact (the site; committed for convenience)
src/
  template.html       ← page markup with /*__STYLES__*/ /*__I18N__*/ /*__APP__*/ placeholders
  styles.css          ← all CSS
  types.ts            ← shared type declarations (compile-time only, no runtime code)
  01-i18n.ts          ← EN/RU translation table + I18N runtime (first <script>)
  00-globals.ts       ← constants, DOM handles (fail-fast), default state, shared state
  10-history.ts       ← snapshot/undo/redo stack
  11-sanitize.ts      ← state sanitizer/validator for loads & imports
  12-visuals.ts       ← style resolution (item → type style → defaults), weight visualization
  20-render-core.ts   ← render loop, viewBox, grid background, fast-path movers
  21-render-graph.ts  ← SVG edge/node rendering
  22-sidebar.ts       ← selection panel (single & multi edit forms)
  23-matrix-view.ts   ← adjacency matrix + edge list HTML
  30-modes-selection.ts ← modes, selection tools, selection state
  31-graph-ops.ts     ← add/insert/delete/sort nodes & edges, snapping, matrix editing
  32-interaction.ts   ← pointer/touch/pinch/drag/pan/zoom handling
  40-export.ts        ← CSV/JSON/DOT/GraphML exporters + preview modal
  41-import.ts        ← CSV/JSON/DOT/GraphML parsers and importers
  50-algorithms.ts    ← BFS, DFS, Dijkstra, components, topo sort, stats, layouts
  51-persistence.ts   ← localStorage autosave, toasts, clipboard copy
  52-widgets.ts       ← drag-number inputs, camera controls, configurable hotkeys
  53-style-tab.ts     ← style defaults + per-type style management
  54-presets.ts       ← style presets overlay
  60-wire-ui.ts       ← all event wiring
  90-main.ts          ← init()
scripts/
  build.mjs           ← type-check → transpile → concatenate → inline → verify
  smoke.test.mjs      ← boots the built file in jsdom and exercises the UI
```

The numbered files are concatenated **in filename order** inside a single IIFE,
exactly reproducing the original architecture (one shared scope, no modules) —
so the built page behaves identically to the previous hand-maintained file
while the sources stay small and reviewable.

## Commands

```bash
npm install        # once — installs typescript + jsdom (dev only)
npm run check      # type-check only
npm run build      # type-check + build index.html
npm test           # smoke-test the built index.html in jsdom
npm run all        # check + build + test
```

## Safety & logic checks

- **Compile time** — `tsc` runs over all sources with shared types
  (`src/types.ts`): graph state, settings, selection, i18n API. The build
  fails on any type error.
- **Build time** — `scripts/build.mjs` verifies the output: placeholders
  resolved, exactly two `<script>` blocks, bundle parses, and it greps the
  final HTML for network primitives (`fetch`, `XMLHttpRequest`, `WebSocket`,
  `sendBeacon`, dynamic `import()`) and external `src=`/`href=` URLs —
  guaranteeing the no-fetch, fully-offline property on every build.
- **Runtime** — required DOM elements are resolved through `mustEl()`, which
  throws a descriptive error at startup instead of failing later with an
  opaque null dereference. The state sanitizer (`11-sanitize.ts`) still
  validates and clamps everything loaded from localStorage or imported files.
- **Test time** — `scripts/smoke.test.mjs` loads the built page, adds the
  sample graph, exercises undo/redo, algorithms, language switching, clicks
  every button and pokes every control, then asserts zero uncaught errors.

## Notes

- `index (4) (1).html` is the original uploaded single-file version, kept for
  reference. `index.html` is the same application built from `src/`.
- The global `history` variable was renamed `historyStack` in the sources to
  avoid shadowing `window.history`; behavior is unchanged.
