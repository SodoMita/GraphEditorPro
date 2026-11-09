# Graph Editor Pro — Technical Audit

**Date:** 2026-11-04
**Revision:** `0461e9f` (`main`, branch `arena/2bfc8c34-grapheditorpro`)
**Scope:** correctness, data integrity (import/export), security, performance, accessibility, build/tooling, maintainability.
**Method:** full source read; `npm ci` + `npm run check`; deterministic rebuild; headless Chromium 149 driven via Playwright/CDP (core flows, axe-core, timing probes); custom round-trip and injection harnesses in jsdom; `scripts/perf-bench.mjs` re-run.

---

## 1. Verdict

> **Status: every P1 and P2 finding below has been fixed on this branch, plus the P3 items listed in §6.** The grades and measurements describe the audited revision `0461e9f`; see §6 for the remediation table and the re-verification numbers.

A genuinely well-engineered single-file app: the build is reproducible, the sanitizer is real, escaping is disciplined, and the camera/performance architecture does what the README claims. The weak spots are all in the **edges of the app**: the import parsers (DOT is effectively broken), the CSV/undo paths that bypass the sanitizer, unbounded O(n²) work reachable from a document, and the complete absence of CI, so none of the above is caught by the 62 passing tests.

| Area | Grade | One-line summary |
| --- | --- | --- |
| Build & reproducibility | A | `npm ci` + `npm run check` clean; rebuild is byte-identical to the committed `index.html` |
| Test suite | B− | 62/62 pass in ~34 s, but zero tests for the DOT/GraphML/CSV parsers and no app-code coverage |
| Security (in-app) | A− | No network APIs, no `eval`, consistent HTML escaping, no injection found; CSV export lacks formula neutralisation |
| Data integrity | **C** | DOT import corrupts/truncates graphs; matrix-CSV import creates dangling edges; CSV imports bypass all state caps → silent data loss on reload |
| Performance | B+ | Camera path verified excellent; force layout and matrix rendering are unbounded O(n²) main-thread work |
| Accessibility | C+ | Good roles/labels/focus management, but the canvas is pointer-only and 3 axe violations remain (1 serious) |
| Maintainability | B | Clear module split and heavy commenting, but `strict:false`, 38 `any`s, a 1,582-line render module, and cross-module coupling through `window` |
| Process & CI | **D** | No CI workflows, no linter, no formatter; the documented browser-bench script fails as committed |

---

## 2. What holds up (independently verified)

These are README claims I checked and can confirm:

- **Reproducible build.** `node scripts/clean.mjs && tsc && node scripts/build.mjs && node scripts/check-static.mjs` regenerates `index.html` (628,140 bytes) with **no diff** against the committed artifact.
- **Type-check + tests.** `npm run check`: 62/62 tests pass at the audited revision, no type errors; the current branch passes 137/137 (§6.1–6.3).
- **Supply chain.** 60 packages, all `devDependencies`, `npm audit` reports 0 vulnerabilities; the shipped HTML has no runtime dependencies.
- **Offline guarantees.** The static check passes and I confirmed the output has exactly one inline `<script>`, one `<style>`, no `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`eval`/`new Function`/`document.write`, and no external URLs.
- **Escaping.** I pushed `<img onerror>`, `<svg onload>`, `<textarea onfocus>` and `<option onfocus>` payloads through node labels, types, edge labels, edge weights and custom-attribute IDs, then forced the canvas, selection panel, matrix, edge list and all five tabs to render: **no element injection, no script execution** (`window.__xss` stayed 0). All interpolations I reviewed go through `esc()` or `textContent`.
- **Camera performance.** `scripts/perf-bench.mjs` (headless Chromium, 2 runs):

  | Graph | Gesture | Dropped frames | Per-update style+layout | `viewBox` writes | Camera matrix writes |
  | --- | --- | --- | --- | --- | --- |
  | 100 n | pan | 0 / 210 | 0.2 ms | 0 | 60 |
  | 100 n | wheel | 1 / 326 | 0.5 ms | 0 | 60 |
  | 500 n | pan | 0 / 170 | 0.2 ms | 0 | 40 |
  | 500 n | wheel | 2 / 264 | 1.4 ms | 0 | 40 |
  | 1200 n | pan | 3 / 136 | 0.2 ms | 0 | 20 |
  | 1200 n | wheel | 6 / 202 | 2.8 ms | 0 | 20 |

  The camera is one absolute `transform` on the SVG `g#cameraLayer`; the root `viewBox` is a fixed reference frame and is never used as a camera. The `will-change:transform` hint on that group keeps a camera change to one attribute write, so per-update style+layout stays in the low milliseconds even at 1200 nodes. Compare `node scripts/perf-bench.mjs --build name=directory` against the pre-PR30 build to reproduce the A/B.

  **Trade-off, not equivalence.** A separate two-run 1,200-node measurement against the PR #33 base (the branch point of PR #34) reported ~3.1 ms/update of wheel style/layout here against ~0.2 ms there; a rerun of the committed harness measured 2.1–2.5 ms against 0.1 ms. That base's CSS-gradient grid and wrapper-`DIV` camera avoid SVG style/layout but also have the known clipping, blank-grid and wrong-preview defects. The two builds are therefore **not** equivalently correct, and the 0.2 ms figure must not be read as a regression against a working renderer. Against the pre-PR30 in-SVG baseline the harness reports comparable style/layout (2.5 ms vs 2.3 ms) and fewer dropped wheel frames (14 vs 23); after the floating-origin fix, final two-run measurements at 1,200 nodes report 1.1–1.7 ms/update versus 1.2–2.1 ms on that baseline; dropped wheel frames vary from zero to two on either build across runs, so no consistent frame-pacing advantage is claimed. Wheel zoom can regenerate the render-space grid paths when integer decimation changes; pan/wheel previews that stay inside the apron write only the camera matrix.
- **Sanitizer.** Size caps (3000 nodes / 8000 edges), ID normalisation, dangling-edge dropping, colour/shape/range validation and prototype-free style maps are all present and covered by tests.
- **Real-browser sanity.** Add node, drag, undo, language switch, matrix edit and a tour of all five tabs produced **no console errors or exceptions**.

---

## 3. Findings

Severity: **P1** = data loss / broken feature, **P2** = serious defect or operational gap, **P3** = polish/hardening.

### P1-1 — DOT import is broken for any file containing `#` (including the app's own DOT export)

`src/app/50-import-export.ts:506`

```js
let body = text.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'').replace(/#.*$/gm,'');
```

`#` is treated as a line comment **anywhere**, including inside quoted attribute values. Hex colours are the standard way to write DOT colours, so virtually every real file (and every file this app exports, since it always writes `fillcolor="#rrggbb"`) has its node declarations truncated mid-line. The node regex then swallows the following declaration too, cascading.

Observed round-trip of a 6-node graph exported by the app and re-imported:

| | Before | After DOT round-trip |
| --- | --- | --- |
| Nodes | 6 | **4** (two lost) |
| Labels | `Alpha, Beta, Gamma, Delta, Dup, Dup` | **`n1, n2, n3, n4`** (IDs) |
| Shapes | circle, square, triangleUp, hexagon, diamond… | **all `circle`** |
| Colours / types / order | preserved | **lost** |

Minimal repros (paste into *Data → Paste DOT*):

| DOT input | Result |
| --- | --- |
| `digraph G { a [label="Alpha"]; b [label="Beta"]; a -> b; }` | ✅ `Alpha`, `Beta` |
| same, with `fillcolor="#ff0000"` on `a` | ❌ `Alpha`, **`b`** (b's declaration lost) |
| `a [label="C# docs"];` | ❌ label becomes `"C\n  b [label="` |

**Impact:** the advertised interchange format silently destroys graphs, and it is the most likely way users bring in external data.
**Fix:** strip `#` comments only at the start of a line (`/^[ \t]*#.*$/gm`), and ideally tokenise quoted strings before stripping anything. Add parser tests (see §5).

---

### P1-2 — Matrix-CSV import creates edges whose endpoints do not exist

`src/app/50-import-export.ts:432-458`

```js
let fromId = labelToId.get(fromLabel);
if(!fromId){ fromId = fromLabel; }     // ← accepts an unknown label as an ID
...
state.edges.push({ ..., from: fromId, to: toId, ... });
```

Every other import path relies on `sanitizeState` to drop dangling edges, but `importMatrixCsv` writes straight into `state.edges`. Repro (2 nodes `A`,`B`, row/column label `ZZZ` with weight `2`):

```
edges after import: [ {id:"e1", from:"n1", to:"n2", …}, {id:"e2", from:"ZZZ", to:"n2", weight:"2"} ]
node ids: [ "n1", "n2" ]     DOM edge groups: 1
```

The phantom edge is invisible on canvas, but it appears as a ghost row in the edge list (endpoint cell shows the raw string `ZZZ`), inflates graph statistics and exports, and disappears on the next reload (the sanitizer drops it) — a silent state inconsistency.
**Fix:** resolve only against known node IDs/labels, count discards, and report them in the toast (as `appendImportedGraph` already does).

**Related (same file, medium):** matrix CSV is lossy in ways users won't expect — edge label, type and `directed` are not represented, undirected edges are exported in both cells and re-import as two directed edges, and an edge with an **empty weight exports as an empty cell and vanishes on import**. Verified: 3 edges in → 3 edges out, but `directed` `1,0,1` became `1,1,1`, edge labels were lost, and the weightless edge disappeared. Either document the format as "weights only, adjacency snapshot" in the UI, or encode presence separately (e.g. `1` for weightless edges).

---

### P1-3 — CSV importers bypass every state cap → silent truncation on reload

`sanitizeState` enforces 3000 nodes / 8000 edges (`src/app/10-core.ts:222-244`). `importNodesCsv` (`src/app/50-import-export.ts:460`), `importEdgesCsv` (`:392`) and `importMatrixCsv` (`:432`) enforce nothing, and they also skip the label-length, colour and stroke-style validation the sanitizer applies (`:418`, `:473` store raw CSV text).

Measured: importing a 4,000-row nodes CSV produces **4,000 nodes in memory and in the DOM** (`nodesLayer` count 4,000); after a reload the document loads with **3,000** — 1,000 nodes are gone, and the next edit autosaves the truncated graph over the good snapshot.

**Fix:** route CSV results through `sanitizeState` (or at least apply the same numeric caps + field validation), and tell the user when a cap truncates.

---

### P2-1 — Matrix rendering is unbounded O(n²) DOM and can hang the tab

`src/app/20-rendering.ts:1431` (`matrixNodes`), `:1483` (`adjacencyMatrixHtml`); limits at `src/app/10-core.ts:437-438`.

`matrixLimit` accepts *any* positive integer (documented as deliberate), and `matrixDimension: 0` (the default) means "one column per node". A document that sets `matrixLimit` ≥ node count therefore renders n² `<input>` elements.

Measured (headless Chromium, cold load of a seeded document):

| Nodes | Matrix limit | Inputs | Result |
| --- | --- | --- | --- |
| 300 | 300 | 90,600 | loads, but ~5.8 s to paint the matrix |
| 700 | 700 | 490,000 | **did not finish within 40 s**; the page monopolised the machine until killed (load average 13) |

**Impact:** a shared/imported `.graph.json` (or simply raising the limit on a large graph) freezes the tab for minutes. This is reachable from untrusted data, not just user error.
**Fix:** keep `matrixLimit` configurable but clamp the *rendered* matrix to an absolute ceiling (e.g. 400×400 = 160k cells), or virtualise rows; and treat it as a hard cap in the sanitizer.

---

### P2-2 — Force-directed layout runs O(iter·n²) synchronously on the main thread

`src/app/60-algorithms.ts:54` (`layoutForce`, default 180 iterations, all-pairs loop) — no cap, no confirmation, no progress, no worker.

Measured: **200 nodes → 250 ms; 600 nodes → 1.85 s.** The loop is quadratic, so 1,500 nodes ≈ 11 s and the 3,000-node import cap ≈ 45 s of a frozen tab (no repaint, no cancel). Circle/grid layouts are O(n) and fine.

**Fix:** cap iterations/nodes for the synchronous path (e.g. Barnes–Hut or sampling above ~800 nodes), or run it in a Worker with a progress toast and a cancel button.

---

### P2-3 — `scripts/browser-setup.sh` fails as committed

`scripts/browser-setup.sh:6` sets `ROOT` without `export`, but `:13` reads `process.env.ROOT`:

```
$ bash scripts/browser-setup.sh
== inflating chromium + runtime libs + fonts from @sparticuz/chromium ==
TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received undefined
```

Running `ROOT=$(pwd) bash scripts/browser-setup.sh` works (Chromium 149.0.7827.0 verified). Since `perf-bench.mjs` documents this script as the way to get a browser, the documented benchmarking workflow is broken out of the box. One-word fix: `export ROOT=...`.

---

### P2-4 — No CI, no linter, no formatter

No `.github/` directory exists, so the README's "the build fails if any of these guarantees are broken" is enforced only on the developer's machine. There is also no ESLint/Prettier config, while `tsconfig.json` disables the strongest safety net (`strict: false`, `noImplicitAny: false`).

Recommended: a single workflow running `npm ci && npm run check` on push/PR (Node 20 and 22), plus `npx tsc --noEmit --strict` as a non-blocking "debt" job so the gap is visible.

---

### P2-5 — Accessibility: the canvas is a black box for keyboard/AT users

axe-core (initial state, node selected, panels open, export modal, presets overlay):

| Rule | Impact | Nodes |
| --- | --- | --- |
| `label-content-name-mismatch` | **serious** | `#btnLang` — visible text "RU"/"EN", accessible name "Switch language" (`src/template.html:94`) |
| `page-has-heading-one` | moderate | no `<h1>` anywhere in the template |
| `empty-table-header` | minor | empty first `<th>` of the matrix and edge-list tables (`src/app/20-rendering.ts:1497`, `:1544`) |

Beyond axe:

- `#graphCanvas` is focusable (`tabindex="0"`) and correctly named (`role="img"` + `aria-label`), but nodes/edges are `<g>` elements with no `tabindex`/`role` and there is no keyboard path for selecting, moving or connecting a node — the primary UI stays pointer-only. The matrix/edge list provides a partial text route (focusable inputs), which keeps this from being a blocker.
- Modal dialogs use blocking `prompt()` (`src/app/40-interactions.ts:786-787`, `src/app/70-controls.ts:617`) and `confirm()`/`alert()` in several places — unstyled, not undoable, and inconsistent with the app's otherwise careful `role="dialog"` + focus-trap pattern.

The rest is better than typical: roving `tabindex` + arrow keys on the tablist, `aria-pressed` on view toggles, focus restoration on overlays, `aria-live` toast stack, `prefers-reduced-motion` support and visible `:focus-visible` rings.

---

### P2-6 — Persistence is best-effort and silent

- `saveSoon()` (`src/app/60-algorithms.ts:87`) debounces autosave by 250 ms and there is **no `pagehide`/`beforeunload` flush**, so closing the tab right after an edit loses it.
- Every `localStorage.setItem` is wrapped in `try{}catch{}` with no user feedback (32 catch blocks across the source, several of them bare). A `QuotaExceededError` on a large graph (a 3,000-node / 8,000-edge snapshot) means autosave has silently stopped working and the user keeps editing a document that is no longer being saved.

**Fix:** flush on `pagehide`; on write failure, surface a one-time toast ("autosave failed — browser storage full — export your graph").

---

### P3 findings

| ID | Finding | Where |
| --- | --- | --- |
| P3-1 | CSV export quotes `"`/`,`/newlines correctly but does not neutralise spreadsheet formulas (leading `=`, `+`, `-`, `@`). A label imported from a malicious file is executed as a formula when the CSV is opened in Excel/Sheets | `src/app/50-import-export.ts:9` |
| P3-2 | No CSP `<meta>`; harmless today (fully offline, no remote content) but a cheap defence-in-depth win if the file is ever hosted | `src/template.html` head |
| P3-3 | README says the IIFE leaves "no implementation globals", but `window.I18N = I18N` (`src/app/00-i18n.ts:631`) and `window.syncPreserve` (`src/app/80-ui.ts:366`, called from `src/app/20-rendering.ts:457`) are exactly that. The `syncPreserve` hack is a cross-module callback smuggled through `window`; use a shared hook declared in `10-core.ts` | see cells |
| P3-4 | Type-safety debt: `strict:false`, 38 explicit `any`, `$()` returns `any`, and dead guards such as `if(typeof moveNode === 'function')` (`src/app/80-ui.ts:346`) / `typeof invalidateSelectionCache === 'function'` (`src/app/10-core.ts:149`) — artefacts of the concatenated-scope build where the functions are always defined | see cells |
| P3-5 | Untranslated user-facing string: append-import toast is hard-coded English (`appended: +N nodes, +M edges`) while the rest of the UI is fully bilingual (501 keys, none missing) | `src/app/50-import-export.ts:338-344` |
| P3-6 | Undo stores a full JSON snapshot per edit; the cap is named `HISTORY_MAX_BYTES` but measures UTF-16 code units (`snap.length`), and because `snapshot()` includes `viewBox`, undo also teleports the camera | `src/app/10-core.ts:120-175` |
| P3-7 | `comparison.html` is committed with links to `huge-*.svg` / `huge-*-site.html` that are not in the repo — a checked-in report page whose iframes 404 | `comparison.html` |
| P3-8 | Matrix-CSV round-trip cannot survive duplicate or empty labels (labelled columns are matched by label), and matrix export uses labels while nodes CSV uses IDs — inconsistent identity model across formats | `src/app/50-import-export.ts:34-41`, `:432` |
| P3-9 | Single 628 KB unminified inline bundle. Fine for an offline artifact, but there is no minify step, so parse/compile cost and diff noise stay maximal | `scripts/build.mjs` |

---

## 4. Test and tooling gaps

- **No parser tests at all.** The suite covers camera mechanics, gizmos, selection, styles, caching, sanitizer and static-output invariants, but not one exercises `parseDot` / `parseGraphml` / `import*Csv`. That is why P1-1, P1-2 and P1-3 shipped green.
- **No round-trip tests.** A single "export each format → import → deep-equal the graph" test per format would have caught P1-1 and most of P1-2.
- **App coverage is unmeasurable.** Tests run the compiled bundle inside jsdom (a separate V8 context), so `node --experimental-test-coverage` reports 99.8 % on the *test files* and nothing on `src/app`. Instrument `index.html` at build time (or run the suite against the compiled JS) to get real numbers.
- **No real-browser test in the suite.** Playwright is a dependency, but only the perf script uses it; `tests/browser-smoke.test.mjs` is jsdom. Given the compositor/camera design, at least one Chromium smoke test would be worth its runtime.
- **No lint/format/CI** (see P2-4).

---

## 5. Prioritised remediation plan

**Now (data integrity, small diffs):**
1. `parseDot`: strip `#` only at line start; add ~10 parser tests (colours, `#` in labels, quoted IDs, attributes, PORT/compass points).
2. `importMatrixCsv`: reject unknown endpoints, count discards, and apply `sanitizeState` to the merged result; same for nodes/edges CSV (P1-2, P1-3).
3. `export ROOT` in `browser-setup.sh` (one word).

**Next (robustness):**
4. Clamp rendered matrix size to an absolute ceiling; cap/worker the force layout with progress and cancel (P2-1, P2-2).
5. Flush autosave on `pagehide`; surface storage-quota failures (P2-6).
6. Add a GitHub Actions workflow running `npm ci && npm run check` on Node 20/22 (P2-4).

**Then (accessibility & hygiene):**
7. `#btnLang`: put the visible "RU"/"EN" into the accessible name (`aria-label="Switch language (current: EN)"`), add an `<h1>` (visually hidden), label the two corner `<th>` cells, give `#graphCanvas` a `role`/`aria-label`, and add a keyboard path for node selection (e.g. arrow-key traversal of nodes in order).
8. Replace `prompt()`/`confirm()` with the existing modal pattern.
9. Remove the `window.syncPreserve` / `window.I18N` leaks, then turn on `strict` incrementally (start with `noImplicitAny` on the newer modules).
10. Neutralise CSV formulas on export; add a CSP meta tag; drop or fix `comparison.html`'s broken artifact links.

---

## 6. Remediation status

Implemented in this branch after the audit (all covered by `tests/import-parsers.test.mjs`, and re-verified in headless Chromium):

| Finding | Status | Change |
| --- | --- | --- |
| P1-1 DOT corruption | **Fixed** | `stripDotComments()` tokenises quoted strings and treats `#` as a comment only at line start; DOT export/import now round-trips labels, colours, node types, order and all six shapes (`triangle`/`invtriangle`/`polygon sides=6`); label-only edges no longer gain a phantom weight |
| P1-2 Matrix-CSV dangling edges | **Fixed** | Unknown endpoints are skipped and counted; every CSV path now commits through `commitCsvGraph()` → `sanitizeState` |
| P1-3 CSV imports bypassing caps | **Fixed** | Same funnel: 3000/8000 caps, label bounds, colour/shape/stroke validation; oversized imports report what was dropped |
| P2-1 Matrix O(n²) | **Fixed** | `MATRIX_MAX_CELLS = 14,400` hard ceiling (120×120 nodes): a 350-node document renders 14,400 cells in ~1.2 s instead of 90,600 cells in ~5.8 s (measured: 150×150 1.6 s, 300×300 5.8 s). The hidden-matrix note now names the real graph size and the ceiling instead of the already-clamped slice |
| P2-2 Force layout freeze | **Fixed** | `FORCE_LAYOUT_PAIR_BUDGET` (17M pair interactions): 600 nodes 1.85 s → 613 ms, 1,500 nodes ≈11 s → 707 ms, with a toast when passes are reduced |
| P2-3 Broken browser-setup script | **Fixed** | `export ROOT`; the script now runs unmodified and yields Chromium 149 |
| P2-4 No CI | **Fixed** | `.github/workflows/ci.yml` runs `npm run check` on Node 20/22 and fails on a stale `index.html` |
| P2-5 a11y (`#btnLang`, `<h1>`, empty `<th>`) | **Fixed** | Accessible name now contains the visible code; one hidden `<h1>`; labelled corner cells; axe reports **0 violations** in the initial, selected and panels-open states |
| P2-6 Silent persistence | **Fixed** | `writeAutosave()` reports quota failures once; `flushAutosave()` on `pagehide`/hidden |
| P3-1 CSV formula injection | **Fixed** | Leading `=`/`+`/`@`/tab/CR (and `-` before non-digits) are prefixed with `'`; numeric columns unaffected |
| P3-3 `window` leaks | **Fixed** | `window.syncPreserve` replaced by the `syncUiHooks` hook; `window.I18N` removed |
| P3-5 Untranslated append toast | **Fixed** | `appended_n_m` / `appended_n_m_discarded` keys |
| P3-6 History cap units | **Fixed** | Snapshot size counted in UTF-16 bytes |
| P3-7 `comparison.html` dead links | **Fixed** | Dead iframes/links replaced with a note that artifacts are generated |
| P2-5 blocking `prompt`/`confirm`/`alert` | **Fixed** | New `showDialog()`/`uiConfirm()`/`uiPrompt()` in `10-core.ts` (role=dialog, aria-modal, Escape/backdrop cancel, focus trap, focus restore, translated buttons). All 7 call sites converted — clear graph, clear matrix edges, replace with sample, replace with import, preset name, node label, edge weight; the two import `alert`s now use the toast stack. `tests/browser-smoke.test.mjs` fails if any path reaches a native dialog |
| Dialog keyboard trap and field name (review) | **Fixed** | Keydown/focusin handlers moved to the document, so Escape and Tab keep working after a click parks focus on `<body>`; focus is pulled back into an open dialog. The prompt field is named by the dialog title (`aria-label`) instead of an empty `<label>`: Chromium AX reports `textbox "Node label:"` |
| CSV replace mode (review) | **Fixed** | A replace-mode nodes CSV clears the previous edges *before* sanitising (carrying them over left stale-but-valid edges attached to a replaced graph), and keeps explicit orders: `parseInt(...) \|\| fallback` read a real order of `0` as missing, so a replaced 3-node document came back as orders 3,1,2 with the matrix header reordered. Orders are parsed with `NaN`/empty-string detection and the fallback now counts from 0 in replace mode. Append mode is unchanged; dropped edges are reported |
| CSV formula guard reversibility (review) | **Fixed** | The import side drops the export apostrophe, and the export side now also escapes values that already start with one (`'=1+1` → `''=1+1`): `=1+1`, `'=1+1`, `''=1+1` and `'plain` all round-trip byte-exactly, and matrix-CSV labels with those values match again |
| DOT label escapes (review) | **Fixed** | Unescaping is a single pass (`\\`, `\"`, `\'`, `\n`), so a literal `a\nb` label is no longer turned into a backslash plus a newline; newline, literal backslash-n, quotes and a trailing backslash all round-trip |
| DOT comment lines over CR-only EOLs (review) | **Fixed** | The comment scanner treats LF, CRLF and a lone CR as line boundaries (and the node regex accepts CR), so a `#` comment no longer leaves its text behind to swallow the next declaration; tests cover all three EOL styles |
| Matrix-CSV endpoint resolution (review) | **Fixed** | The dead `byId` branch is gone and the skip is now observable: the toast reports the skipped unknown endpoints (`skipped N`), which the sanitizer alone could not distinguish from a size-cap drop |
| P3-4 type-safety debt (`strict:false`) | **Partly fixed** | `noImplicitThis`, `strictBindCallApply`, `strictFunctionTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters` are now on with 0 errors (5 dead declarations and 3 unused parameters removed as a result). `strict`/`noImplicitAny`/`strictNullChecks` stay off — 747 `noImplicitAny` errors — and `tsconfig.json` now says so explicitly |
| P2-5 keyboard selection of canvas nodes | **Open** | Nodes are still pointer-only; the matrix/edge-list tables remain the keyboard route |

**Still open** (deliberately out of this change, each with its reason):

- **`strict` / `noImplicitAny` / `strictNullChecks`.** Turning them on yields ~747 `noImplicitAny` errors alone across the concatenated scope; it is a mechanical but large refactor that would swamp the review of the behaviour fixes. The seven cheap flags that *do* pass were enabled instead (see P3-4 above), so regressions in unused code, fall-through and implicit returns are now caught.
- **`#` at the start of a DOT line (policy still open).** The importer drops a line whose first non-space character is `#`, which is what the DOT language reserves those lines for (C-preprocessor output), and that is why hex colours and `C#` labels survive. The open question is whether such a line should instead be parsed as a statement: a file that starts an unquoted statement with `#` loses it. Changing that needs a format decision, not a bug fix.
- **Keyboard selection and movement of canvas nodes** (P2-5 remainder). A real feature — roving focus over `<g>` nodes plus a keyboard connect flow — not a defect fix.
- **A Playwright smoke job in CI.** Chromium 149 needs a download step; the suite stays jsdom-only so `npm run check` remains ~35 s and offline-capable. The Playwright harnesses used for this audit live outside the repo (`node_modules/.audit/`).
- **App-code coverage instrumentation.** Tests drive the compiled bundle in a separate V8 context, so `node --test --experimental-test-coverage` measures the test files, not `src/app`. Fixing it means building an instrumented bundle for the test run.
- **Matrix/edge-list virtualisation below the 120-node cap.** The cap (`MATRIX_MAX_CELLS`) bounds the worst case at ~1.2 s; windowing would let it grow again, and 120 nodes is the point where a matrix stops being readable anyway.
- **CSP meta tag (P3-2).** A single file with one inline script and one inline style block needs `'unsafe-inline'` (or hashes regenerated on every build) to keep working, which would buy almost nothing over the current "no network APIs in the output" build gate. Revisit only if the file is ever served from a host.
- **Matrix-CSV identity model (P3-8).** Round-tripping duplicate or empty labels needs a format decision (labels vs IDs, plus a legend); it changes the export contract, so it belongs in its own change.
- **Minification (P3-9).** The 645 KB unminified bundle is deliberate: readable diffs and a reviewable artifact for an offline file.

Verification after this second round: `npm run check` passes with **84 tests** (62 existing + 22 regressions), `npx tsc --noEmit` is clean under the hardened flag set, `axe.run()` returns no violations with a dialog open, and headless Chromium confirms the dialog contract end to end (Escape cancels and restores focus to the trigger, `Tab` stays inside, Enter confirms, zero native `dialog` events, zero page errors).

---

## 6.1 PR #34 re-verification, the two P2 follow-ups and the successive audit findings

- `npm run check` on this branch: typecheck clean, **137/137 tests pass**, rebuilt `index.html` is **716,463 bytes** and the static-output gate passes. The regression suite covers the original camera/grid findings, a saved `viewBox.x: 1e20`, a `1e20` camera input, grid-colour changes during pending wheel/pan/pinch previews, three successive updated-audit cases, floating-origin boundary rebasing, world-locked grid phase with a 7-unit grid, long-edge clipping, 2,000,000- and 50,000,000-unit Fit, oversized hit targets, ghost edge labels, and centre-hit selection of enlarged dots.
- Real Chromium 149: the final build loads the `1e20` camera in ~77 ms with a finite `matrix(1 0 0 1 -500 -330)` and a full-viewport grid; the pre-fix PR #34 build times out after 10 s. The PR #33 base writes a CSS `style.transform` in ~80 ms but paints no SVG grid. After 30 zoom-out wheel steps, a grid-colour `input` contracts the old grid to a central rectangle; the final build keeps the grid filling the viewport with the preview matrix unchanged. Pan and pinch style changes also retain viewport coverage and the active camera.
- First updated audit, A/B against the prior PR #34 build: nodes at X=1,000,000,100/200 project 100 px apart and both hit-test (previously both collapsed and hit nothing); editing the title autosaves the exact coordinates. Fit uses the whole span with screen padding centred at X=50,000, putting both X=0/100,000 nodes on screen and hit-testable (previously `w=20000` centred at X=9,880). A node at X=50,000,000 renders and hit-tests with `matrix(1 0 0 1 0 0)` (previously blank with `matrix(1 0 0 1 -50000000 0)`).
- Root cause and invariants: Chromium clamps SVG attribute numbers above ~2^25 to float32. State keeps exact finite world coordinates at ingestion, in inputs, gestures and autosave; a floating render origin snapped to the camera centre in 1e6 steps rebases every SVG coordinate onto the camera without changing the data. `boundedCamera()` keeps sizes finite with an aspect-aware cap derived from the ±3e7 safe render square (up to 58,000,000 units wide) without decentring a fit. Nodes >3e7 render units away are skipped in the DOM only; long edges are clipped to that safe square instead of discarded, and fully clipped edges suppress all label/weight/plate/arrow/accent geometry. Grid paths are capped to ±3e7 and use a bounded local index with a 4,000-segment cap and an index-magnitude guard instead of an absolute `k++`; a BigInt remainder preserves the world-cell phase across origin snaps. `currentCamera()` covers wheel zoom, pan and pinch previews, and both style handlers and `applyCamera()` use that active camera.
- The base's ~0.2 ms style/layout figure is preserved above as a qualified trade-off, not as evidence that the base was equally correct.

## 6.2 Second updated PR #34 audit

- **Same-task origin rebase.** `syncRenderOriginRepaint()` no longer queues a rAF. When a pan crosses a 1e6 snap boundary it either relies on the already-running `renderCanvas()` pass or runs a geometry-only pass immediately, so the camera matrix and node/edge/grid/overlay attributes change in one task. Chromium frame recording across the boundary is monotonic (1441 → 481 px); the previous deferred build spiked to 801,712 px for one frame.
- **Long-edge clipping.** Edge endpoints beyond the safe render square no longer remove the whole edge. Liang–Barsky clipping preserves the visible segment: X=0→11,000,000 draws `M 27 0 L 10999957 0`, and X=0→50,000,000 clips at `L 30000000 0` with the off-screen arrowhead suppressed. All path coordinates stay below 3e7.
- **Fit beyond 1e6.** The camera cap now follows the aspect-aware safe square with centre preservation, grid apron/coordinates are capped, Fit adds ~16 screen pixels of padding, and sub-pixel nodes get a visible minimum-size dot plus a ~7px hit target. A 2,000,000-unit graph Fits to `w=2050719`, centre X=1,000,000, with both nodes fully inside the viewport and hit-testable; §6.3 extends this to 50,000,000 units.
- **Prior resolutions retained:** exact >1e9 autosave coordinates, 100,000-unit Fit, `1e20` no-hang load, and grid-colour coverage during zoom/pan/pinch all still pass.


---

## 6.3 Third updated PR #34 audit

- **Oversized invisible hit circles.** A 300×10 rectangular node previously got a circular target with `r=150` world units; clicking 80 screen pixels above the 8px-tall shape selected it. The normal-zoom target is now inert (`pointer-events:none`) with a radius of half the *smaller* dimension (`r=5`), so the visible shape alone is hit-tested. Chromium now reports the outside point as `svg` and leaves the node unselected; a centre click still selects it.
- **Ghost labels on fully clipped edges.** A remote X=100,000,000→100,000,100 edge with `REMOTE`/`42` previously had an empty path but painted its label and weight at (0,0). An empty path now suppresses label text, weight text, plates, arrowheads and selection accents in both full render and live-drag writers; no `REMOTE` or `42` text remains in the DOM.
- **Centre-hit mode on enlarged dots.** After a 2,000,000-unit Fit, `nodeCentreHitRadius()` uses the camera-sized ~7px dot radius instead of the original 50-unit body. A click four pixels from the dot centre now hits `.node-hit` and selects the node; region selection uses the same effective radius.
- **Fit beyond the old 2e7 cap.** The floating origin snaps to the camera centre, and `boundedCamera()` uses an aspect-aware cap with one 1e6 snap step of headroom (58,000,000 units wide on a 1280×820 canvas). X=0/50,000,000 now Fits to `w=51267835`, centre X=25,000,000, origin `25000000,0`, with both 14px dots fully inside the viewport and hit-testable; grid coordinates remain within ±3e7. A square camera at the cap clamps to `w=58000000,h=24303586` and still paints a viewport-covering grid.
- **Prior resolutions retained:** same-task origin rebase (recorded frames 1441→640 with no 801,712 px spike), `M 27 0 L 10999957 0` crossing edge, 2,000,000-unit Fit, exact X=1,000,000,100/200 autosave, `1e20` camera load in ~146 ms, and full grid coverage during a zoom-preview style change all pass targeted Chromium 149 checks.


---

## 7. Appendix — how to reproduce

```bash
npm ci
npm run check                    # typecheck + build + 137 tests (~60 s)
git diff --exit-code index.html  # rebuild is byte-identical

# headless browser (note: script needs ROOT exported as committed)
ROOT=$(pwd) bash scripts/browser-setup.sh
node scripts/perf-bench.mjs --nodes 100,1200 --runs 2 --out /tmp/perf.json
```

DOT corruption (in-app): *Data → Paste DOT* with

```
digraph G { a [label="Alpha", fillcolor="#ff0000"]; b [label="Beta"]; a -> b; }
```

→ node `b` loses its label (becomes `b`).

Matrix-CSV dangling edge: export a 2-node graph as matrix CSV, replace a row label with `ZZZ`, re-import, then inspect the autosaved snapshot in DevTools:

```js
JSON.parse(localStorage.getItem('graph-editor-pro-v2').edges)
// → [{ id:"e2", from:"ZZZ", to:"n2", … }]
```

Ax matrix/axe run: load `index.html`, inject `axe-core`, `axe.run()` — expected 3 violations (see P2-5).
