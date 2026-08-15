# Graph Editor Pro

Graph Editor Pro is an offline graph editor distributed as **one self-contained `index.html`**. It has no runtime dependencies, external assets, dynamic imports, or network requests, so the generated file can be opened directly from disk.

The application is maintained as TypeScript, HTML, and CSS source files. The build compiles and inlines them into the single-file deliverable.

## Development

Requires Node.js 20 or newer.

```bash
npm ci
npm run build       # type-check and regenerate index.html
npm test            # build plus safety, logic, syntax, and DOM smoke tests
npm run typecheck   # TypeScript only
```

After a successful build, open `index.html` in any modern browser.

## Source layout

The TypeScript files are deliberately ordered in `tsconfig.json`. They form one typed program and are wrapped in a private IIFE in the final HTML, preserving the original application's shared runtime state without exposing implementation globals.

| File | Responsibility |
| --- | --- |
| `src/app/00-i18n.ts` | English/Russian translations and language switching |
| `src/app/10-core.ts` | Types, state, validation, history, and shared utilities |
| `src/app/20-rendering.ts` | SVG, matrix, edge-list, and selection rendering |
| `src/app/30-graph-editing.ts` | Graph mutations, selection, sorting, and matrix editing |
| `src/app/40-interactions.ts` | Pointer, drag, pan, zoom, and canvas selection behavior |
| `src/app/50-import-export.ts` | JSON, CSV, DOT, and GraphML import/export |
| `src/app/60-algorithms.ts` | Graph algorithms and automatic layouts |
| `src/app/70-controls.ts` | Style controls, presets, camera controls, and hotkeys |
| `src/app/80-ui.ts` | Event wiring and responsive view controls |
| `src/app/90-bootstrap.ts` | Application initialization |
| `src/app/types.d.ts` | Shared graph and UI type declarations |
| `src/template.html` | Semantic page markup |
| `src/styles.css` | All application styles |

`index.html` is generated and should not be edited directly.

## Build and safety guarantees

The build fails if any of these guarantees are broken:

- TypeScript does not type-check.
- Inline JavaScript is syntactically invalid.
- The output has anything other than one inline script and one inline style block.
- A script, stylesheet, media resource, CSS import, or remote CSS URL is external.
- Runtime network APIs such as `fetch`, `XMLHttpRequest`, `WebSocket`, or `EventSource` appear in the output.
- Static markup contains duplicate element IDs.

Runtime data is also validated before use. Imported graph state is size-limited, malformed records and dangling edges are discarded, IDs are normalized and deduplicated, numeric/style values are clamped, unsafe map keys are isolated in prototype-free records, and required DOM elements fail with a descriptive error instead of causing a later null dereference.

## Performance design

Navigation keeps the logical SVG `viewBox` frozen during a gesture and applies one compositor-backed CSS transform to the complete SVG image. The grid is an oversized cached layer transformed alongside it, avoiding per-frame gradient repainting. The crisp vector `viewBox` is committed once when navigation ends.

Large supporting views are bounded independently of graph data: the editable edge table renders 250-row pages, and the interactive adjacency matrix is capped at 100×100 cells. Full graph data remains available through paging and CSV export.
