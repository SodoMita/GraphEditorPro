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

Navigation has exactly one camera mechanism. The root `viewBox` is a fixed world reference frame written once; the logical camera (`state.viewBox`, which every hit test, the grid, the sidebar readout and the saved document all use) is rendered as a single matrix on the promoted `#cameraLayer` — for gesture previews **and** for the committed camera. There is no handoff at gesture begin or end: a commit re-applies the same matrix with the final value, which is a no-op when the preview already reached it, so no frame can ever show a partially applied camera. This is also the cheap path: a promoted transform update costs ~0.1 ms, while rewriting the root `viewBox` re-resolves style and re-runs layout for every node, edge, label and grid cell on every frame (measured ~13 ms per camera update at 100 nodes, ~19 ms at 1200 nodes — the main thread saturated for the whole gesture). Wheel zoom commits the logical camera after the wheel settles (~220 ms) or as soon as a pointer gesture adopts it. The grid is a world-anchored SVG pattern (`#gridRect`) that rides the camera matrix inside the scene, so grid and graph are always painted by the same raster — one render clock on the camera path, and no second layer (the old CSS-background grid div) that could display the previous camera for a frame.

The trade-off this buys: the scene raster is transformed by the compositor, so at **fractional** camera scales the world-locked grid hairlines (1 device pixel, `vector-effect:non-scaling-stroke`) are resampled with it and can render dimmer. Rendered images were compared against the vector-`viewBox` camera at identical cameras: identical to the pixel at 1:1 and at integer scales (0.5×/2×), and at 0.83× up to 0.18% of canvas pixels differ — all of them grid-line pixels; nodes, edges, labels and arrowheads match everywhere.

`scripts/perf-bench.mjs` measures all of this on a real headless Chromium (`scripts/browser-setup.sh` provides the browser): it drives 60 Hz input into pan and wheel gestures and reports renderer task/script/style/layout time, the per-camera-update style+layout cost, frame pacing and the camera DOM writes, per graph size. Pass `--build name=directory` twice to compare two revisions in one session.

Beyond navigation, the hot interaction paths are engineered so their cost tracks *what changed*, not the total graph size:

- **Indexed lookups.** `nodeById`/`edgeById` are lazily rebuilt hash indexes, so selection sync, drag geometry, and algorithm traversals stay O(1) per lookup regardless of graph size.
- **De-duplicated DOM writes.** Every attribute/class write on rendered graph elements goes through small `setAttr`/`toggleClass` helpers that skip the DOM when the value is unchanged, so a render pass that changes nothing writes nothing.
- **Delta selection sync.** Selecting an item touches only the elements whose selection state actually changed (the previous selection is mirrored), instead of re-toggle-walking every node and edge.
- **Per-pass visual caching.** Merged node/edge style objects and node radii are computed once per render pass and reused across edges and drag frames, eliminating thousands of short-lived allocations per frame.
- **Gesture-scoped re-rendering.** A click that does not move anything performs no full render pass at all, and a drag whose connected edges (up to 2000) were patched live during the gesture needs no re-render on release.
- **Frame-coalesced selection tools.** Brush/lasso/rect/line strokes sample every pointermove but run their hit test and overlay redraw once per animation frame; live brush selection defers the sidebar rebuild until the gesture ends.
- **Stable interaction paint.** `.fast-interaction` records gesture state but intentionally changes no filter, label, or shape paint property. The scene therefore keeps identical visual effects before, during, and after a drag; release cannot force a replacement SVG layer or flash a stale raster.
- **Zoom-adaptive grid.** The grid layer decimates to every k-th cell (an integer multiple of the configured grid) when zooming out would shrink cells below a readable on-screen minimum. Lines stay locked to world coordinates at every zoom level instead of drifting or desynchronizing from the nodes.
- **Bounded supporting views.** Large matrices and edge lists render behind configurable limits (defaults: 250 edge rows per page, matrices up to 90×90) independently of graph size; both settings accept any positive integer, so faster computers can raise them without an artificial upper cap. Full data remains available through paging and CSV export.
- **Cheap element access.** Render passes walk the node/edge layers via linked-list traversal (`firstElementChild`/`nextElementSibling`) and read reflected `id` attributes rather than collection indexing or `dataset`, and id→element registries keep drag and selection paths off document-wide lookups. The parallel-edge lane cache rebuilds only when the edge array actually changes.
- **Per-edge geometry caching.** An edge's path depends only on endpoint positions, node radii, its parallel-edge lane, and direction; when none of those changed, the render pass reuses the previous path result instead of recomputing it. Dash-pattern strings are memoized per (style, stroke size).

### Comparison with draw.io (mxGraph)

The interactive-rendering model mirrors the mechanisms draw.io uses, verified against its source (`jgraph/drawio`, `src/main/webapp`):

| Mechanism | draw.io / mxGraph | This editor |
| --- | --- | --- |
| Panning | `mxGraph.prototype.panGraph` moves the canvas via a `transform` during the gesture; the view is revalidated once on release | The promoted camera group carries the camera matrix for the gesture *and* after release, above a fixed reference `viewBox`: one composited write, no handoff frame, no per-frame scene re-layout |
| Wheel zoom | `EditorUi.js` `lazyZoom` accumulates a `cumulativeZoomFactor`, previews with `mainGroup.style.transform = 'scale(f)'` anchored at the cursor, removes shape filters during the preview, and performs one real zoom after a debounce (`lazyZoomDelay` 20 ms / `wheelZoomDelay` 500 ms) | The same cumulative preview/one-commit architecture, with the preview and the commit being the same composited write; logical camera committed after ~220 ms or on pointer adoption |
| Indexed lookups | cells and view states are kept in `mxDictionary` hash maps | node/edge ids resolve through lazily rebuilt hash indexes |
| Drag feedback | `mxGraphHandler.updateLivePreview` repaints moved states and all connected edges live | connected edges follow drags live up to a 2000-edge budget, then freeze until release |
| Undo history | `mxUndoManager` caps at 100 entries (delta edits) | 100 entries plus a total-size cap, since this editor stores full-state snapshots |
| Off-screen culling | none — SVG clips at paint time | none by default, plus an optional order-based visible-range filter that removes non-visible nodes from the DOM entirely |
