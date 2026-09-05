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

Navigation keeps the logical SVG `viewBox` frozen during a gesture and applies one compositor-backed CSS transform to the complete SVG image. The grid is an oversized cached layer transformed alongside it, avoiding per-frame gradient repainting. The crisp vector `viewBox` is committed once when navigation ends. Wheel zooming uses the same mechanism: each wheel event only scales the existing raster on the compositor and the expensive full-vector `viewBox` relayout happens once, when the wheel settles (~140 ms) or a pointer gesture adopts the camera.

Beyond navigation, the hot interaction paths are engineered so their cost tracks *what changed*, not the total graph size:

- **Indexed lookups.** `nodeById`/`edgeById` are lazily rebuilt hash indexes, so selection sync, drag geometry, and algorithm traversals stay O(1) per lookup regardless of graph size.
- **De-duplicated DOM writes.** Every attribute/class write on rendered graph elements goes through small `setAttr`/`toggleClass` helpers that skip the DOM when the value is unchanged, so a render pass that changes nothing writes nothing.
- **Delta selection sync.** Selecting an item touches only the elements whose selection state actually changed (the previous selection is mirrored), instead of re-toggle-walking every node and edge.
- **Per-pass visual caching.** Merged node/edge style objects and node radii are computed once per render pass and reused across edges and drag frames, eliminating thousands of short-lived allocations per frame.
- **Gesture-scoped re-rendering.** A click that does not move anything performs no full render pass at all, and a drag whose connected edges (up to 2000) were patched live during the gesture needs no re-render on release.
- **Frame-coalesced selection tools.** Brush/lasso/rect/line strokes sample every pointermove but run their hit test and overlay redraw once per animation frame; live brush selection defers the sidebar rebuild until the gesture ends.
- **Interaction quality mode.** While a drag or brush gesture is active (`.fast-interaction`), node drop-shadow filters are nulled defensively. Label halos are deliberately kept: they are configured per-label (Style → Graph defaults → *Label outline*) so dropping them mid-gesture made text outlines visibly flicker away during drags, while moving them costs nothing — transforms reuse the rasterized glyphs.
- **Zoom-adaptive grid.** The grid layer decimates to every k-th cell (an integer multiple of the configured grid) when zooming out would shrink cells below a readable on-screen minimum. Lines stay locked to world coordinates at every zoom level instead of drifting or desynchronizing from the nodes.
- **Bounded supporting views.** Large matrices and edge lists render behind configurable limits (defaults: 250 edge rows per page, matrices up to 90×90) independently of graph size; both settings accept any positive integer, so faster computers can raise them without an artificial upper cap. Full data remains available through paging and CSV export.
- **Cheap element access.** Render passes walk the node/edge layers via linked-list traversal (`firstElementChild`/`nextElementSibling`) and read reflected `id` attributes rather than collection indexing or `dataset`, and id→element registries keep drag and selection paths off document-wide lookups. The parallel-edge lane cache rebuilds only when the edge array actually changes.
- **Per-edge geometry caching.** An edge's path depends only on endpoint positions, node radii, its parallel-edge lane, and direction; when none of those changed, the render pass reuses the previous path result instead of recomputing it. Dash-pattern strings are memoized per (style, stroke size).

### Comparison with draw.io (mxGraph)

The interactive-rendering model mirrors the mechanisms draw.io uses, verified against its source (`jgraph/drawio`, `src/main/webapp`):

| Mechanism | draw.io / mxGraph | This editor |
| --- | --- | --- |
| Panning | `mxGraph.prototype.panGraph` moves the canvas via a `transform` during the gesture; the view is revalidated once on release | Same: a compositor CSS matrix moves the SVG and grid layer; the `viewBox` commits once on release |
| Wheel zoom | `EditorUi.js` `lazyZoom` accumulates a `cumulativeZoomFactor`, previews with `mainGroup.style.transform = 'scale(f)'` anchored at the cursor, removes shape filters during the preview, and performs one real zoom after a debounce (`lazyZoomDelay` 20 ms / `wheelZoomDelay` 500 ms) | Same architecture: cumulative factor over the preview `viewBox`, compositor scale preview, one `viewBox` commit after ~140 ms or on pointer adoption |
| Indexed lookups | cells and view states are kept in `mxDictionary` hash maps | node/edge ids resolve through lazily rebuilt hash indexes |
| Drag feedback | `mxGraphHandler.updateLivePreview` repaints moved states and all connected edges live | connected edges follow drags live up to a 2000-edge budget, then freeze until release |
| Undo history | `mxUndoManager` caps at 100 entries (delta edits) | 100 entries plus a total-size cap, since this editor stores full-state snapshots |
| Off-screen culling | none — SVG clips at paint time | none by default, plus an optional order-based visible-range filter that removes non-visible nodes from the DOM entirely |
