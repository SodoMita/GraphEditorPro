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

CI (`.github/workflows/ci.yml`) runs `npm run check` on Node 20 and 22 for every push and pull request, and fails if the committed `index.html` differs from what the sources build.

After a successful build, open `index.html` in any modern browser.

## Source layout

The TypeScript files are deliberately ordered in `tsconfig.json`. They form one typed program and are wrapped in a private IIFE in the final HTML, preserving the original application's shared runtime state without exposing implementation globals.

| File | Responsibility |
| --- | --- |
| `src/app/00-i18n.ts` | English/Russian translations and language switching |
| `src/app/10-core.ts` | Types, state, validation, history, shared utilities, and the in-app dialog system |
| `src/app/20-rendering.ts` | SVG, matrix, edge-list, and selection rendering |
| `src/app/30-graph-editing.ts` | Graph mutations, selection, sorting, and matrix editing |
| `src/app/40-interactions.ts` | Pointer, drag, pan, zoom, and canvas selection behavior |
| `src/app/45-gizmo.ts` | Position-only translate/rotate/scale/rect selection gizmo |
| `src/app/50-import-export.ts` | JSON, CSV, DOT, and GraphML import/export |
| `src/app/60-algorithms.ts` | Graph algorithms and automatic layouts |
| `src/app/70-controls.ts` | Style controls, presets, camera controls, and hotkeys |
| `src/app/80-ui.ts` | Event wiring and responsive view controls |
| `src/app/90-bootstrap.ts` | Application initialization |
| `src/app/types.d.ts` | Shared graph and UI type declarations |
| `src/template.html` | Semantic page markup |
| `src/styles.css` | All application styles |

`index.html` is generated and should not be edited directly.

## Moving selections: transform gizmos

In Select mode, a selection that contains nodes (or only edges — their endpoints are used) gets a transform gizmo: handles drawn around the selection on the canvas, a floating toolbar row above the selection tools, and a matching **Transform gizmo** section in the Edit tab with a live status readout. **Every gizmo tool rewrites only node `x`/`y` positions.** Node widths, heights, shapes, colors, labels — all visual parameters of the individual parts — are never touched; the node bodies simply ride to their new spots and connected edges follow through the same live-edge fast path as an ordinary node drag.

| Tool | Handles | What it does to the selected positions |
| --- | --- | --- |
| Translate (`1`) | centre dot, X arrow, Y arrow | Free move, or move constrained to one axis. Existing snap settings (grid, Snap X/Y) apply to the gizmo origin |
| Rotate (`2`) | ring around the pivot | Rotates positions around the pivot. `Shift` snaps to 15° steps |
| Scale (`3`) | X/Y end squares, centre square | Scales positions from the pivot per axis (`Shift` = uniform from an axis handle) or uniformly from the centre. Node sizes do **not** scale |
| Rect (`4`) | bounding-box corners/edges, centre | Stretches positions with the selection's bounding frame: the dragged side follows the pointer, the opposite side stays anchored. `Alt` stretches from the centre, `Shift` keeps the aspect ratio |

The **pivot** defaults to the centre of the selection's bounding box. In Rotate/Scale (and Rect) it is the small white dot: drag it — it snaps onto node centres — to rotate or scale around any point, and double-click it to reset. It resets automatically when the set of selected nodes changes.

A numeric readout (delta, angle, factor, or frame size) follows the drag on the canvas and in the status pill. `Esc` cancels a gizmo drag and restores the exact pre-gesture positions; a committed drag is a single undo step. Arrow keys nudge the selection (grid step while snap is on, otherwise 1 unit; `Shift` multiplies). `G` (or the *Show transform gizmo* checkbox in the Edit tab's Transform gizmo section) hides the gizmo when its handles would get in the way. The digit/`G` bindings are remappable like the other hotkeys.

Implementation notes: `src/app/45-gizmo.ts` owns the gizmo's preferences, rendering, gestures and keyboard nudging; the rest of the app only keeps render/selection notifications, pointermove/pointerup routing, and button/hotkey wiring. The active tool and show/hide choice are browser UI preferences in `localStorage` (`graph-editor-pro-gizmo`), not document data — they never enter exports, autosaves or undo snapshots, and toggling visibility cannot create a history step (legacy autosaves that still carry the old document fields are migrated once on load). The gizmo lives in its own `#gizmoLayer` inside the camera scene, above the nodes, and is rebuilt only when its signature (tool, selection ids, pivot, bounds, screen-pixel size, drag state) changes. Handles are sized in world units per screen pixel, so they keep a constant on-screen size at any zoom; only handle shapes take pointer events (lines and the rotate ring are stroke-only), so the frame never blocks the nodes under it. During an ordinary group drag the whole gizmo follows with a single transform write on its root instead of a rebuild.

## Build and safety guarantees

The build fails if any of these guarantees are broken:

- TypeScript does not type-check.
- Inline JavaScript is syntactically invalid.
- The output has anything other than one inline script and one inline style block.
- A script, stylesheet, media resource, CSS import, or remote CSS URL is external.
- Runtime network APIs such as `fetch`, `XMLHttpRequest`, `WebSocket`, or `EventSource` appear in the output.
- Static markup contains duplicate element IDs.

Runtime data is also validated before use. Every import path — JSON, GraphML, DOT, edge/nodes/matrix CSV and the clipboard — runs through the same sanitizer, so all of them share the 3000-node / 8000-edge caps, labelled-field bounds, colour/shape/stroke validation and dangling-edge removal (a CSV import that exceeds a cap says so in the toast instead of silently building an oversized document that shrinks on the next reload). IDs are normalized and deduplicated, numeric/style values are clamped, unsafe map keys are isolated in prototype-free records, and required DOM elements fail with a descriptive error instead of causing a later null dereference. DOT parsing strips comments only where DOT defines them (a leading `#` on a line, `//` and `/* */` outside quoted strings), so hex colours and labels such as `C#` survive; the line scanner accepts LF, CRLF and lone-CR endings, and string unescaping is a single pass so `\n` (newline), literal `\n`, quotes and trailing backslashes all survive. DOT export/import round-trips labels, positions, colours, node types, node order and the six shapes (hexagon as a regular polygon, triangles as `triangle`/`invtriangle`). CSV export prefixes formula-like cells with an apostrophe and doubles it when the value already starts with one, so imports restore every label byte-for-byte, including text such as `'=1+1`. CSV node rows keep the order column exactly as written — `0` is an order, not a missing value — and fall back to the row position only when the cell is empty. Autosave is flushed on `pagehide`, and a failed write (full or unavailable storage) reports itself instead of failing silently.

## Dialogs and keyboard

Destructive and text-entry actions (clearing the graph or the matrix, replacing the document with an import or the sample graph, naming a preset, the double-click node-label and edge-weight editors) never call the browser's blocking `prompt`/`confirm`/`alert`. `showDialog()` in `src/app/10-core.ts` builds the same modal pattern the rest of the app uses: `role="dialog"`, `aria-modal="true"`, a title wired through `aria-labelledby`, Escape and backdrop-click to cancel, `Tab`/`Shift+Tab` trapped between the visible buttons and the field, and focus restored to the triggering control on close. The buttons are translated (`dialog_ok`, `dialog_cancel`, `dialog_confirm_title`) and the text field opens focused with its value selected, so a double-click rename is type-and-Enter. Import failures and oversized-file notices use the `aria-live` toast stack instead of an alert, so they never steal focus.

## Performance design

Navigation is a **single paint system**: one camera surface, `#cameraLayer`, an SVG `<g>` inside `#graphCanvas`, moved by one absolute `transform` matrix (space-separated SVG `matrix()`, in user units). The root `viewBox` is a fixed world reference frame (`-500 -330 1000 660`, `xMidYMid meet`) installed once and never rewritten during a gesture. A preview and a commit are the same write — the preview *is* the camera, committing only records it in `state.viewBox` — so no frame can mix two cameras and there is no handoff. Keeping the matrix **inside** the SVG is what lets every world point be painted: an HTML wrapper transformed around the `<svg>` can only move the already-clipped viewport, so nodes and edges outside the reference frame silently disappear at zoom/pan. The stationary `div#gridLayer` carries only the background colour; the grid itself is two persistent world-space `<path>`s inside `g#gridLines` in the camera scene, so it rides the very same matrix as the graph, cannot expose an unpainted edge, and cannot re-pitch or re-phase on a commit. `#cameraLayer{will-change:transform}` keeps that group composited, so a camera change is one attribute write rather than a full scene repaint. Measured on headless Chromium at 1200 nodes (two runs, `scripts/perf-bench.mjs`): pan **3 dropped frames / 16.8 ms p95** and wheel **6 dropped frames**, against 4 and 19 for the pre-PR30 baseline. Across every scaling path (wheel, zoom buttons, pinch, `fitView`, and window resize), zero SVG elements are torn down or recreated: `fitView` / `resize` re-apply only the camera instead of reconciling `#nodesLayer` and `#edgesLayer`, and `#gizmoLayer` updates cached per-tool handle subtrees in place.

**Do not add a second camera surface, and do not wrap the SVG in a transformed HTML camera.** Two separately-transformed surfaces (the `#cameraStage` era, commits `7f09230`/`af90851`/`aa081b7`/`12df425`) update on different clocks; two DOM writes can never be atomic and that desync flashes one wrong frame at gesture end. A single wrapper `<div>` around the `<svg>` is not a fix either: it transforms the SVG viewport *after* the root `viewBox` has clipped the scene, so far nodes and edges vanish, and a viewport-sized CSS-gradient grid inside it either crops during a pan or re-phases at the commit. Nor should a preview write a *relative* delta from the last committed camera: that puts the graph in the wrong place for the whole preview. The speed comes from the compositing hint on the SVG group and one absolute matrix, never from splitting the camera.

The world-space grid paths are regenerated only when the visible world range leaves their decimated apron or the integer decimation step changes; panning and wheel previews normally write nothing but the one camera matrix (zero `childList` mutations). Lines are always integer multiples of the configured grid cell in world units, with `vector-effect:non-scaling-stroke`, so they stay world-locked at every zoom, including zoom-outs far past the fixed reference frame. Real-browser A/B against the pre-PR30 build gives identical camera matrices, node/edge positions and grid coverage at rest, mid-pan, mid-wheel, and after every commit.

**Robustness bounds.** `safeWorldCoord()` clamps camera and node `x`/`y` to ±1e9 at ingestion, in the camera inputs, in `fitView()`, and on every generated gesture preview; `safeCamera()` applies the same bound immediately before any matrix or grid use. The grid never increments an absolute world-cell index with `k++`: it enumerates a bounded local `i` under a 4,000-segment cap and a `GRID_INDEX_LIMIT` guard. A saved document with `viewBox.x: 1e20` therefore loads instead of hanging when `k++` would stop changing past 2^53. `currentCamera()` is the single active-camera accessor for wheel zoom, pan and pinch previews. Grid-style handlers default to it and `applyCamera()` adopts it before an unrelated re-render, so changing a grid colour mid-gesture cannot recompute the grid from the stale committed camera.

**Performance trade-off.** An independent two-run, 1,200-node Chromium measurement against the PR #33 base reported about **3.1 ms/update** of wheel style/layout on this PR versus **0.2 ms** on that base; a rerun with `scripts/perf-bench.mjs` measured **2.1–2.5 ms** versus **0.1 ms**. The lower number comes from that base's CSS-gradient grid and wrapper `DIV` transform, which avoid SVG style/layout but also produce the known clipping, blank-grid and wrong-preview defects this PR fixes. It is a correctness/performance trade-off, **not** an equivalent-correctness comparison. Against the pre-PR30 in-SVG baseline (which had the same kind of camera), the harness reports comparable per-update style/layout (2.5 ms vs 2.3 ms) and fewer dropped wheel frames (14 vs 23).

`scripts/perf-bench.mjs` measures all of this on a real headless Chromium (`scripts/browser-setup.sh` provides the browser): it drives 60 Hz input into pan and wheel gestures and reports renderer task/script/style/layout time, the per-camera-update style+layout cost, frame pacing and the camera DOM writes, per graph size. Pass `--build name=directory` twice to compare two revisions in one session.

`scripts/bench-drag.mjs` does the same for the two ends of a node drag — press and release — which are the moments a drag feels sticky. It times each handler, then keeps recording animation frames for 600 ms after the release, so work that was merely pushed off the release (a queued render pass, a snapshot write) still shows up as a frame gap. `--graph hub` drags the centre of a star instead, i.e. a node with more edges than the live-drag budget.

Beyond navigation, the hot interaction paths are engineered so their cost tracks *what changed*, not the total graph size:

- **Indexed lookups.** `nodeById`/`edgeById` are lazily rebuilt hash indexes, so selection sync, drag geometry, and algorithm traversals stay O(1) per lookup regardless of graph size.
- **De-duplicated DOM writes.** Every attribute/class write on rendered graph elements goes through small `setAttr`/`toggleClass` helpers that skip the DOM when the value is unchanged, so a render pass that changes nothing writes nothing.
- **Delta selection sync.** Selecting an item touches only the elements whose selection state actually changed (the previous selection is mirrored), instead of re-toggle-walking every node and edge.
- **Per-pass visual caching.** Merged node/edge style objects and node radii are computed once per render pass and reused across edges and drag frames, eliminating thousands of short-lived allocations per frame.
- **Selection accents that follow the geometry.** A selected node carries a scaled copy of its own shape, a selected edge a wider copy of its own path plus a larger copy of its arrowhead triangle. The elements exist only while selected, the edge accent reuses the path string the line was just given (no outline of the edge shape is derived), and the live-drag writer that re-points the edge re-points the accent in the same frame — measured at +2 attribute writes per selected edge per frame on a 300-edge hub drag (429 total).
- **Bulk selections that cost one write per edge, not two elements.** Accents are the look until the selection gets large: a region select can put most of the graph in the selection, and a rect over a 1,500-node/4,388-edge document selects ~2,500 edges, i.e. the two accent elements each would create (~5,000 elements) inside the release handler. Past 320 selected edges the accents are not created and selected edges are drawn in the accent colour instead, so the highlight still covers exactly the selected edges, the selected ids keep their `selected` class, and nothing in the hit-test, drag or panel path reads accents. Measured on that document (rect select over the whole canvas, 792 nodes and 2,493 edges selected): the release handler drops from 35.0 ms to 15.2 ms and the stall through the following frame from 131 ms to 81 ms; with the accents skipped entirely it is 10.6 ms and 70 ms, so the remaining cost is the selection sync itself. Node rings are one element each (~3 ms per 800) and are never budgeted out, so a large node selection keeps the normal ring look. The look is chosen once per update, so a frame can never be half outlined and half coloured, and releasing the selection hands every edge back its own colour.
- **Gesture-scoped re-rendering.** A click that does not move anything performs no full render pass at all, and a drag whose connected edges (up to 2000) were patched live during the gesture needs no re-render on release.
- **Drag ends that stop at the gesture.** Press and release both used to run work that could have waited, in the task the pointer is waiting on. The press rebuilt the whole selection panel (a few dozen controls, listeners re-wired) before the node could follow the cursor; it now marks the panel dirty and renders it on the next frame, which the canvas never looks at. The release serialised the entire document for the undo stack; that snapshot now runs at idle time after the release frame, and every input that could edit the document — a pointer press, a key, a wheel, or any other history push, undo or redo — flushes it first, so an undo pressed straight after a drag still restores the pre-drag position. Both are measured on the drag bench: on a 3,000-node graph the press handler drops from ~6 ms to ~1 ms and the release handler from ~10 ms to ~0.1 ms.
- **Frozen edges catch up in place.** Past the live-edge budget a drag cannot repaint its edges frame by frame, so they are left at their start geometry. The release re-points exactly those edges through the same in-place writer the live path uses, one frame later, instead of running a render pass over every node and edge of the scene: dragging the centre of a 2,500-edge star used to end with a ~90 ms stall, now with a ~70 ms one-frame catch-up that the release itself does not wait for. The correction path also covers keyboard nudges and gizmo drags.
- **One element query per page, not per render.** The selection sync renders the gizmo, whose tool buttons were looked up with a document-wide attribute query on every update — milliseconds on a large scene, inside every press. The static buttons are resolved once.
- **Same-task commits for immediate commands.** A command whose only visible effect is local geometry writes the canvas in the click's own task and lets the queued render pass confirm it. Flipping selected edges re-points each flipped edge through the drag-time writer (path, label/weight, arrowhead and selection accent), so the new direction is on screen in that frame instead of two frames later, behind the sidebar rebuild the queued pass carries on large graphs. Full-state operations (undo/redo, import, layout) keep going through the render pass, which owns the whole scene.
- **Frame-coalesced selection tools.** Brush/lasso/rect/line strokes sample every pointermove but run their hit test and overlay redraw once per animation frame; live brush selection defers the sidebar rebuild until the gesture ends.
- **Stable interaction paint.** `.fast-interaction` records gesture state but intentionally changes no filter, label, or shape paint property. The scene therefore keeps identical visual effects before, during, and after a drag; release cannot force a replacement SVG layer or flash a stale raster.
- **Zoom-adaptive grid.** The grid layer decimates to every k-th cell (an integer multiple of the configured grid) when zooming out would shrink cells below a readable on-screen minimum. Lines stay locked to world coordinates at every zoom level instead of drifting or desynchronizing from the nodes.
- **Bounded supporting views.** Large matrices and edge lists render behind configurable limits (defaults: 250 edge rows per page, matrices hidden above 90 nodes) independently of graph size. Both settings accept any positive integer, but the matrix has a hard rendering ceiling of 14,400 cells (120×120 nodes) regardless of how high the limit is set: an n×n grid costs n² DOM elements, and every cell is an `<input>`. Measured in Chromium on a 350-node document, a full 300×300 render takes ~5.8 s to paint, 150×150 ~1.6 s and 120×120 ~1.2 s, so the ceiling sits where the view stays usable. Larger matrices show as a `120×120 view of N nodes` (the note names the real graph size and the ceiling), with full data still available through paging, the edge list and CSV export.
- **Budgeted layout runs.** The force-directed layout is all-pairs, so its cost is O(iterations · n²); it now budgets pair work (≈17M interactions) instead of always running 180 passes. Measured on 1,200-node-class graphs this keeps one click near a second (600 nodes: 613 ms for 94 passes, 1,500 nodes: 707 ms for 15 passes) and the toast says when the pass count was reduced. Circle and grid layouts are O(n) and unaffected.
- **Cheap element access.** Render passes walk the node/edge layers via linked-list traversal (`firstElementChild`/`nextElementSibling`) and read reflected `id` attributes rather than collection indexing or `dataset`, and id→element registries keep drag and selection paths off document-wide lookups. The parallel-edge lane cache rebuilds only when the edge array actually changes.
- **Per-edge geometry caching.** An edge's path depends only on endpoint positions, node radii, its parallel-edge lane, and direction; when none of those changed, the render pass reuses the previous path result instead of recomputing it. Dash-pattern strings are memoized per (style, stroke size).

### Comparison with draw.io (mxGraph)

The interactive-rendering model mirrors the mechanisms draw.io uses, verified against its source (`jgraph/drawio`, `src/main/webapp`):

| Mechanism | draw.io / mxGraph | This editor |
| --- | --- | --- |
| Panning | `mxGraph.prototype.panGraph` moves the canvas via a `transform` during the gesture; the view is revalidated once on release | One absolute `transform` on the SVG camera group carries graph and grid together during the gesture; release records the same camera above a fixed reference `viewBox` |
| Wheel zoom | `EditorUi.js` `lazyZoom` accumulates a `cumulativeZoomFactor`, previews with `mainGroup.style.transform = 'scale(f)'` anchored at the cursor, removes shape filters during the preview, and performs one real zoom after a debounce (`lazyZoomDelay` 20 ms / `wheelZoomDelay` 500 ms) | Cumulative preview as one absolute matrix on the composited SVG camera group (`0` SVG rebuilds per frame); the ~220 ms debounce only persists the camera, with in-place grid/gizmo updates |
| Indexed lookups | cells and view states are kept in `mxDictionary` hash maps | node/edge ids resolve through lazily rebuilt hash indexes |
| Drag feedback | `mxGraphHandler.updateLivePreview` repaints moved states and all connected edges live | connected edges follow drags live up to a 2000-edge budget, then freeze until release |
| Undo history | `mxUndoManager` caps at 100 entries (delta edits) | 100 entries plus a total-size cap, since this editor stores full-state snapshots |
| Off-screen culling | none — SVG clips at paint time | none by default, plus an optional order-based visible-range filter that removes non-visible nodes from the DOM entirely |
