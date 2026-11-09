  const NS = 'http://www.w3.org/2000/svg';
  const STORAGE_KEY = 'graph-editor-pro-v2';
  const AUTOSAVE_PREF_KEY = 'graph-editor-pro-autosave';
  const R = 25;
  // All connected edges follow a dragged node live while their count stays
  // under this budget; beyond it, edges stay frozen until release. Each live
  // edge costs an indexed lookup plus a path rebuild (≈1–2 µs), so the budget
  // bounds per-frame work at a few milliseconds.
  const DRAG_LIVE_EDGE_LIMIT = 2000;
  const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
  // The adjacency matrix is an O(n²) grid of <input> elements, so its rendered
  // size is capped independently of the user-facing row limit. Every cell is a
  // form control: measured in Chromium on a 350-node document, a full render
  // costs ~0.9 s at 90 nodes, ~1.2 s at 120, ~1.6 s at 150 and ~5.8 s at 300.
  // 120 keeps the worst case near a second while leaving the matrix usable for
  // medium graphs. The matrixLimit setting (default 90) decides when the matrix
  // is hidden *below* this cap; it can never raise the cap itself.
  const MATRIX_MAX_CELLS = 14400;
  const MATRIX_MAX_NODES = Math.floor(Math.sqrt(MATRIX_MAX_CELLS));  // 120
  // Pair-interaction budget for the force layout (see layoutForce): bounds one
  // click to roughly a second on a mid-range machine instead of O(iter·n²).
  const FORCE_LAYOUT_PAIR_BUDGET = 17000000;

  /** Return a required DOM element or fail immediately with a useful error. */
  const $ = (selector: string, root: ParentNode = document): any => {
    // Plain "#id" lookups are common in render paths (camera inputs,
    // selection panel, status pills); getElementById is a hash lookup.
    if(root === document && typeof document.getElementById === 'function' && /^#[A-Za-z][A-Za-z0-9_-]*$/.test(selector)){
      const byId = document.getElementById(selector.slice(1));
      if(!byId) throw new Error(`Required DOM element not found: ${selector}`);
      return byId;
    }
    const element = root.querySelector(selector);
    if(!element) throw new Error(`Required DOM element not found: ${selector}`);
    return element;
  };
  const $$ = (selector: string, root: ParentNode = document): any[] => Array.from(root.querySelectorAll(selector));
  // "Can this control take keyboard focus right now?" In browsers that is
  // checkVisibility() (CSS display/visibility/inert aware). Engines without it
  // — jsdom, whose offsetParent is always null — fall back to the structural
  // checks instead of dropping every control from a focus trap.
  const isKeyboardVisible = (el: HTMLElement): boolean => {
    if(el.tabIndex < 0 || el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
    const check = (el as any).checkVisibility;
    return typeof check === 'function' ? Boolean(check.call(el)) : true;
  };
  const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
  // SVG geometry/transform numbers are clamped by Chromium/Skia at ~2^25
  // (33,554,432): two nodes at 1,000,000,100 and 1,000,000,200 written as
  // absolute SVG coordinates both collapse to the same pixel. State keeps the
  // exact finite WORLD coordinates (never rewrite user data); only the numbers
  // written into SVG are rebased onto a floating render origin near the camera.
  const SVG_COORD_LIMIT = 33554432;
  // Keep every number written into SVG comfortably below Skia's ~2^25 clamp.
  // 3e7 still leaves room for grid aprons, long-edge clipping and gizmo arms.
  const RENDER_COORD_LIMIT = 3e7;
  const MAX_CAMERA_SIZE = 2e7; // a 2,000,000-unit Fit no longer truncates
  const MIN_CAMERA_W = 100, MIN_CAMERA_H = 90;
  const RENDER_ORIGIN_SNAP = 1e6;
  let renderOriginX = 0, renderOriginY = 0;
  // Set when the origin moves during a preview-only camera update. Geometry
  // must be rebased in the SAME task as the camera matrix write; a queued rAF
  // lets Chromium paint one frame with the new matrix and old node positions.
  let renderOriginMoved = false;
  function rawRenderX(x: unknown): number { return finite(x, 0) - renderOriginX; }
  function rawRenderY(y: unknown): number { return finite(y, 0) - renderOriginY; }
  function renderX(x: unknown): number { return clamp(rawRenderX(x), -RENDER_COORD_LIMIT, RENDER_COORD_LIMIT); }
  function renderY(y: unknown): number { return clamp(rawRenderY(y), -RENDER_COORD_LIMIT, RENDER_COORD_LIMIT); }
  function clampRenderCoord(value: unknown): number { return clamp(finite(value, 0), -RENDER_COORD_LIMIT, RENDER_COORD_LIMIT); }
  // Coordinates farther than this from the floating origin are off-screen and
  // would exceed Skia's coordinate limit if written into SVG at all. Skip the
  // node in the DOM, but keep it untouched in state/export/autosave; edges are
  // clipped instead of discarded, since a long edge can cross the viewport.
  function isRenderablePoint(x: unknown, y: unknown): boolean {
    return Math.abs(rawRenderX(x)) < RENDER_COORD_LIMIT && Math.abs(rawRenderY(y)) < RENDER_COORD_LIMIT;
  }
  // Keep a camera finite and its viewport size bounded, but PRESERVE its
  // centre when a size must be clamped (the old 20000/1e6 caps truncated
  // fitView without recentring). The cap is large enough for a 2,000,000-unit
  // graph while still keeping render-space grid/geometry coordinates below the
  // Chromium SVG coordinate limit. Coordinates are not magnitude-clamped:
  // the floating origin keeps the SVG numbers small instead.
  function boundedCamera(camera: any): ViewBox {
    const x = finite(camera?.x, 0), y = finite(camera?.y, 0);
    const ow = finite(camera?.w, 1000), oh = finite(camera?.h, 660);
    const w = clamp(ow, MIN_CAMERA_W, MAX_CAMERA_SIZE);
    const h = clamp(oh, MIN_CAMERA_H, MAX_CAMERA_SIZE);
    return { x: x + ow / 2 - w / 2, y: y + oh / 2 - h / 2, w, h };
  }
  // One floating origin for every surface inside g#cameraLayer. It changes only
  // when the camera moves past a 1e6 snap boundary, so ordinary pans/zooms are
  // still a single matrix write; crossing one forces a geometry repaint.
  function ensureRenderOrigin(camera: any){
    const cam = boundedCamera(camera);
    const ox = Math.round(cam.x / RENDER_ORIGIN_SNAP) * RENDER_ORIGIN_SNAP;
    const oy = Math.round(cam.y / RENDER_ORIGIN_SNAP) * RENDER_ORIGIN_SNAP;
    if(ox !== renderOriginX || oy !== renderOriginY){
      renderOriginX = ox; renderOriginY = oy;
      setAttr(svg, 'data-render-origin', `${ox},${oy}`);
      renderOriginMoved = true;
      invalidateGridCache();
    }
    return cam;
  }
  // The camera as seen by the SVG: world position rebased onto the floating
  // origin. cameraDeltaMatrix()/updateGridBackground() consume this, while
  // state.viewBox, exports, hit tests and snapshots stay in world coordinates.
  function renderCamera(camera: any = currentCamera()): ViewBox {
    const cam = ensureRenderOrigin(camera);
    return { x: cam.x - renderOriginX, y: cam.y - renderOriginY, w: cam.w, h: cam.h };
  }
  const esc = (value: unknown): string => String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
  // === In-app dialogs ===
  // Native prompt()/confirm()/alert() block the whole tab, cannot be themed,
  // ignore the document language and are suppressed in some embeds. These
  // helpers reuse the app's modal pattern instead: role=dialog, aria-modal,
  // a focus trap, Escape to cancel and focus restored to the trigger.
  type DialogOptions = {
    title: string;
    message?: string;
    input?: { value?: string; placeholder?: string; maxLength?: number; label?: string };
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  };
  let dialogEl: HTMLElement | null = null;
  let dialogResolve: ((value: string | boolean | null) => void) | null = null;
  let dialogReturnFocus: HTMLElement | null = null;
  let dialogCleanup: (() => void) | null = null;
  function closeDialog(result: string | boolean | null = null){
    if(!dialogEl) return;
    // Detach the document-level listeners *before* restoring focus: they pull
    // focus back into the dialog, which must not fight the hand-off.
    dialogCleanup?.();
    dialogCleanup = null;
    const resolve = dialogResolve;
    dialogEl.remove();
    dialogEl = null;
    dialogResolve = null;
    if(dialogReturnFocus?.isConnected) dialogReturnFocus.focus({preventScroll:true});
    dialogReturnFocus = null;
    resolve?.(result);
  }
  function showDialog(options: DialogOptions): Promise<string | boolean | null> {
    closeDialog(null); // only one dialog at a time
    return new Promise(resolve => {
      dialogResolve = resolve;
      dialogReturnFocus = document.activeElement as HTMLElement;
      const wantsInput = Boolean(options.input);
      const dialog = document.createElement('div');
      dialog.className = 'app-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'appDialogTitle');
      if(options.message) dialog.setAttribute('aria-describedby', 'appDialogMessage');
      const inputId = 'appDialogInput';
      dialog.innerHTML = `
        <form class="app-dialog-card">
          <h2 id="appDialogTitle" class="app-dialog-title">${esc(options.title)}</h2>
          ${options.message ? `<p id="appDialogMessage" class="app-dialog-message">${esc(options.message)}</p>` : ''}
          ${wantsInput ? `<div class="app-dialog-field"><input id="${inputId}" class="app-dialog-input" type="text" autocomplete="off" spellcheck="false" aria-label="${esc(options.input?.label || options.title)}" maxlength="${Number(options.input?.maxLength) || 200}" placeholder="${esc(options.input?.placeholder || '')}" value="${esc(options.input?.value || '')}"></div>` : ''}
          <div class="app-dialog-actions">
            <button type="button" class="btn small" data-dialog-cancel>${esc(options.cancelLabel || I18N.t('dialog_cancel'))}</button>
            <button type="submit" class="btn small ${options.danger ? 'danger' : 'good'}" data-dialog-ok>${esc(options.confirmLabel || I18N.t('dialog_ok'))}</button>
          </div>
        </form>`;
      document.body.appendChild(dialog);
      dialogEl = dialog;
      const input = dialog.querySelector<HTMLInputElement>('#' + inputId);
      const form = dialog.querySelector('form');
      const finish = (result: string | boolean | null) => closeDialog(result);
      form?.addEventListener('submit', ev => {
        ev.preventDefault();
        finish(wantsInput ? (input?.value ?? '') : true);
      });
      dialog.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => finish(wantsInput ? null : false));
      dialog.addEventListener('pointerdown', ev => { if(ev.target === dialog) finish(wantsInput ? null : false); });
      // The handlers live on the document, not on the dialog element: clicking
      // the dialog's own title or message moves focus to <body> in Chromium,
      // and a dialog-scoped keydown never fires from there — Escape and the
      // Tab trap went dead until focus wandered back inside.
      const focusables = () => $$('button:not(:disabled),input:not(:disabled)', dialog).filter(isKeyboardVisible);
      const focusInside = (target: EventTarget | null) => Boolean(target) && dialog.contains(target as Node);
      const onKeyDown = (ev: KeyboardEvent) => {
        if(!dialogEl) return;
        if(ev.key === 'Escape'){ ev.preventDefault(); ev.stopPropagation(); finish(wantsInput ? null : false); return; }
        if(ev.key !== 'Tab') return;
        const items = focusables();
        if(!items.length) { ev.preventDefault(); return; }
        const first = items[0], last = items[items.length - 1];
        // Focus parked outside (title click, backdrop, or a stray programmatic
        // focus) still gets trapped: the next Tab re-enters the dialog.
        if(!focusInside(document.activeElement)){ ev.preventDefault(); (ev.shiftKey ? last : first).focus(); return; }
        if(ev.shiftKey && document.activeElement === first){ ev.preventDefault(); last.focus(); }
        else if(!ev.shiftKey && document.activeElement === last){ ev.preventDefault(); first.focus(); }
      };
      // A modal keeps focus: anything that pulls it out is redirected to the
      // dialog's primary control. The trigger's own focus is restored on close.
      const onFocusIn = (ev: FocusEvent) => {
        if(!dialogEl || focusInside(ev.target)) return;
        const items = focusables();
        (items[items.length - 1] || items[0])?.focus();
      };
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('focusin', onFocusIn, true);
      dialogCleanup = () => {
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('focusin', onFocusIn, true);
      };
      setTimeout(() => {
        if(input){
          input.focus();
          input.select();
        } else {
          dialog.querySelector<HTMLButtonElement>('[data-dialog-ok]')?.focus();
        }
      }, 0);
    });
  }
  /** Replace window.confirm with an in-app, translated, focus-trapped dialog. */
  async function uiConfirm(message: string, options: { title?: string; confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
    return (await showDialog({
      title: options.title || I18N.t('dialog_confirm_title'),
      message,
      confirmLabel: options.confirmLabel,
      danger: options.danger
    })) === true;
  }
  /** Replace window.prompt: resolves to the text, or null when cancelled. */
  async function uiPrompt(title: string, message: string, value = '', maxLength = 80): Promise<string | null> {
    const result = await showDialog({ title, message, input: { value, maxLength } });
    return typeof result === 'string' ? result : null;
  }

  const canvasWrap = $('#canvasWrap');
  const svg = $('#graphCanvas');
  const gridLayer = $('#gridLayer');
  const gridLines = $('#gridLines');
  const gridMinorLines = $('#gridMinorLines');
  const gridMajorLines = $('#gridMajorLines');
  function isCanvasOverlayControl(target: any){
    return Boolean(target?.closest?.('.canvas-hud, .zoom-controls, .mode-fab, .edge-tools, .sel-tools, .gizmo-tools'));
  }
  // #cameraLayer is the ONE camera surface: an SVG <g> inside the canvas. Both
  // gesture previews and committed cameras write the same matrix here, so there
  // is no second surface, no compositor handoff and no clipped world content.
  const cameraLayer = $('#cameraLayer');
  const edgesLayer = $('#edgesLayer');
  const nodesLayer = $('#nodesLayer');
  const dragLine = $('#dragLine');
  const selectionOverlayLayer = $('#selectionOverlayLayer');
  const gizmoLayer = $('#gizmoLayer');

  const NODE_SHAPES = ['circle','square','diamond','triangleUp','triangleDown','hexagon'];
  const STROKE_STYLES = ['solid','dashed','dotted'];
  const LABEL_POSITIONS = ['center','top','bottom','left','right'];
  const LABEL_POLICIES = ['auto','on','off'];
  const RESERVED_CUSTOM_ATTRIBUTE_IDS = new Set(['label','nodeId','order','x','y','type','shape','color','width','height','strokeColor','strokeSize','strokeStyle','labelColor','labelFont','labelSize','labelPosition','weight','edgeLabel','edgeType','edgeColor','edgeStrokeSize','edgeStrokeStyle','edgeLabelColor','edgeLabelFont','edgeLabelSize','directed','labelsPolicy','edgeWeightMode','edgeWeightMin','edgeWeightMax','edgeWeightCorr','edgeWidthMin','edgeWidthMax','edgeWeightColorLow','edgeWeightColorHigh','canvasBgColor','gridMinorColor','gridMajorColor','gridMinorAlpha','gridMajorAlpha']);
  const FONT_FAMILIES = ['Inter','ui-sans-serif','ui-serif','ui-monospace','Arial','Helvetica','Times New Roman','Courier New'];

  const defaultState = (): GraphState => ({
    title: 'untitled', mode: 'select', selectTool: 'single', selectCombine: 'replace', nextNode: 1, nextEdge: 1,
    nodes: [], edges: [], customAttributes: [],
    selected: null, selection: {nodes: [], edges: []},
    settings: {
      // Edit-tab node placement (primary for newly added nodes)
      nodeShape:'circle', nodeColor:'#0ea5e9',
      nodeWidth:50, nodeHeight:50,
      nodeStrokeColor:'#e2e8f0', nodeStrokeSize:2.2, nodeStrokeStyle:'solid',
      nodeType:'', nodeLabelColor:'#f8fafc', nodeLabelFont:'Inter', nodeLabelSize:13, nodeLabelPosition:'center',
      // Edit-tab edge defaults (primary for newly added edges)
      directed:true, edgeWeight:'1', edgeLabel:'',
      edgeType:'', edgeColor:'#94a3b8', edgeStrokeSize:2.4, edgeStrokeStyle:'solid',
      edgeLabelColor:'#dbeafe', edgeLabelFont:'Inter', edgeLabelSize:12,
      snap:false, snapX:false, snapY:false, gridSize:40, gridSizeX:40, gridSizeY:40,
      autosave:true, matrixLimit:90, edgeListPageSize:250, matrixDimension:0, brushDiameter:80,
      // Hit-testing for selection: 'any' selects nodes/edges by any part of
      // them; 'center' selects only at the exact centre of a node/edge.
      hitTestMode: 'any',
      inheritDefaults: true,
      noLabel: false, // when true, new nodes are created with empty labels
      // Copy/paste: when true, pasting preserves edges that have only one endpoint in the clipboard if the other endpoint exists in the graph
      copyPreserveExternal: true,
      // Visible range: filters matrix, edge list, and graph canvas to nodes within [start, end] by order.
      // -1 end means "to last". -1 start means "show all".
      visibleRange: {start: -1, end: -1},
      // Canvas background and grid colors
      canvasBgColor:'#020617', gridMinorColor:'#94a3b8', gridMajorColor:'#94a3b8', gridMinorAlpha:0.105, gridMajorAlpha:0.16,
      graphDefaults: {
        labelsPolicy: 'auto',
        // Label halo: 'outline' = paint-order stroke around glyphs,
        // 'plate' = rounded background rect behind the text, 'none' = bare text.
        labelOutline: 'outline',
        labelOutlineColor: '#020617',
        labelOutlineWidth: 4,
        edgeWeightMode: 'number', // 'none' | 'number' | 'color' | 'width'
        edgeWeightMin: 1, edgeWeightMax: 10,
        edgeWeightCorr: 'linear', // 'linear' | 'log' | 'exp' | 'sqrt'
        edgeWidthMin: 1, edgeWidthMax: 8,
        edgeWeightColorLow: '#22d3ee', edgeWeightColorHigh: '#f59e0b'
      },
      nodeDefaults: {
        type:'', color:'#0ea5e9', labelColor:'#f8fafc', labelFont:'Inter', labelSize:13,
        labelPosition:'center', shape:'circle', width:50, height:50,
        strokeColor:'#e2e8f0', strokeSize:2.2, strokeStyle:'solid'
      },
      edgeDefaults: {
        type:'', color:'#94a3b8', labelColor:'#dbeafe', labelFont:'Inter', labelSize:12,
        strokeSize:2.4, strokeStyle:'solid'
      },
      // Per-type style overrides: { 'typeName': { color, shape, width, height, ... }, ... }
      nodeTypeStyles: {},
      edgeTypeStyles: {},
      // Style presets: saved visual styles that can be applied to selection.
      // Each preset: { name, node?: {...style}, edge?: {...style} }
      stylePresets: []
    },
    viewBox: { x:-500, y:-330, w:1000, h:660 }
  });
  let state: GraphState = defaultState();
  let appHistory: string[] = [], appHistoryIndex = -1;
  let renderQueued = false, matrixTimer = null, saveTimer = null, edgeOffsetCache = null;
  let drag = null, pan = null, edgeDraft = null, pendingEdgeFrom = null, pendingNodeTap = null, pinch = null, selectDraft = null, spaceDown = false;
  const activePointers = new Map();
  // Clipboard for copy/paste of nodes+edges
  let clipboardData: { nodes: GraphNode[]; edges: GraphEdge[]; externalEdges: GraphEdge[] } | null = null;
  let pasteOffsetCount = 0;
  // UI hook installed by the UI layer (80-ui.ts). Renderers that rebuild
  // controls call it instead of reaching for a global, so modules stay
  // decoupled without leaking implementation state onto `window`.
  let syncUiHooks: (() => void) | null = null;

  function snapshot(){
    const vb = currentCamera(); // persist active camera without forcing a mid-gesture SVG commit
    return JSON.stringify({
      title:state.title, mode:state.mode, selectTool:state.selectTool, selectCombine:state.selectCombine, nextNode:state.nextNode, nextEdge:state.nextEdge,
      nodes:state.nodes, edges:state.edges, customAttributes:state.customAttributes, settings:state.settings, viewBox:vb,
      // Preserve user focus across undo/redo so editing the same object stays ergonomic
      selected:state.selected, selection:state.selection
    });
  }
  function applySnapshot(raw){
    cancelZoomPreview();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const data = isRecord(parsed) ? parsed : {};
    const sane = sanitizeState(data);
    // Restore selection if it survives sanitization (nodes/edges still exist)
    const savedSel = data.selected, savedSelection = data.selection;
    state = {...state, ...sane, selected:null, selection:{nodes:[], edges:[]}};
    if(isRecord(savedSel) && isRecord(savedSelection)){
      const nodeIdSet = new Set(state.nodes.map(n => n.id));
      const edgeIdSet = new Set(state.edges.map(e => e.id));
      const validNodes = (Array.isArray(savedSelection.nodes) ? savedSelection.nodes : []).filter(id => nodeIdSet.has(id));
      const validEdges = (Array.isArray(savedSelection.edges) ? savedSelection.edges : []).filter(id => edgeIdSet.has(id));
      state.selection = {nodes: validNodes, edges: validEdges};
      if(savedSel.type === 'node' && nodeIdSet.has(savedSel.id)) state.selected = {type:'node', id:String(savedSel.id)};
      else if(savedSel.type === 'edge' && edgeIdSet.has(savedSel.id)) state.selected = {type:'edge', id:String(savedSel.id)};
      else if(validNodes.length) state.selected = {type:'node', id:validNodes[0]};
      else if(validEdges.length) state.selected = {type:'edge', id:validEdges[0]};
    }
    // Selection cache lives in 30-graph-editing.ts; bump it if present so
    // selectedNodeIds/selectedEdgeIds don't return stale Sets after undo/redo/import.
    try { if(typeof invalidateSelectionCache === 'function') invalidateSelectionCache(); } catch {}
    try { if(typeof selCacheRev !== 'undefined') selCacheRev++; } catch {}
    syncControls();
    persistAutosavePreference(Boolean(state.settings.autosave));
    queueRender(true, true);
    saveSoon();
  }
  // History is bounded both by entry count and by total serialized size:
  // snapshots of large graphs can be megabytes each, and a byte cap keeps
  // memory and eviction cost predictable where an entry cap alone would not.
  const HISTORY_MAX_ENTRIES = 100;
  const HISTORY_MAX_BYTES = 48 * 1024 * 1024;
  // Snapshots are JS strings (UTF-16), so the memory they occupy is two bytes
  // per code unit. Counting code units here would make the byte cap twice as
  // permissive as its name claims.
  const snapshotBytes = (snap: string) => snap.length * 2;
  let historyBytes = 0;
  // === Deferred history entries ===
  // A history entry is a full serialisation of the document, so on a large
  // graph it is the single most expensive step of a gesture release — and it
  // buys nothing *at that moment*: the release paints the geometry the drag
  // already wrote, and the entry is only observed by the next interaction.
  // Gesture ends therefore schedule the push for idle time (after the release
  // frame is painted) and every input that could edit the document flushes it
  // first, so an entry always captures the state it belongs to.
  let pendingHistoryLabel: string | null = null;
  let pendingHistoryIdle: any = null;
  let pendingHistoryTimer: any = null;
  function pushHistorySoon(label: string){
    // The newest label wins: only the state at flush time is captured, and the
    // label is documentation of what moved.
    pendingHistoryLabel = label;
    if(pendingHistoryIdle != null || pendingHistoryTimer != null) return;
    const flush = () => flushPendingHistory();
    if(typeof (window as any).requestIdleCallback === 'function'){
      pendingHistoryIdle = (window as any).requestIdleCallback(flush, {timeout: 250});
    } else {
      // jsdom and any browser without idle callbacks: one turn later is still
      // off the release path, and tests advance timers before they read it.
      pendingHistoryTimer = setTimeout(flush, 0);
    }
  }
  function flushPendingHistory(){
    const label = pendingHistoryLabel;
    // Cleared before the push (pushHistory flushes too) and unconditionally, so
    // a cancelled schedule can never leave a handle behind that would block the
    // next release from scheduling its own entry.
    pendingHistoryLabel = null;
    const idle = pendingHistoryIdle, timer = pendingHistoryTimer;
    pendingHistoryIdle = null;
    pendingHistoryTimer = null;
    if(idle != null){ try { (window as any).cancelIdleCallback?.(idle); } catch {} }
    if(timer != null) clearTimeout(timer);
    if(label == null) return;
    pushHistory(label);
  }
  function pushHistory(_label='change'){  // labels are kept for call-site intent/documentation
    // Never reorder history: a deferred entry from a gesture release belongs
    // before whatever the current caller is about to record.
    flushPendingHistory();
    const snap = snapshot();
    if(appHistory[appHistoryIndex] === snap) return;
    appHistory = appHistory.slice(0, appHistoryIndex + 1);
    appHistory.push(snap);
    historyBytes += snapshotBytes(snap);
    appHistoryIndex = appHistory.length - 1;
    while(appHistory.length > 1 && (appHistory.length > HISTORY_MAX_ENTRIES || historyBytes > HISTORY_MAX_BYTES)){
      historyBytes -= snapshotBytes(appHistory[0]);
      appHistory.shift();
      appHistoryIndex--;
    }
    updateUndoRedo();
    saveSoon();
  }
  function resetHistory(){
    pendingHistoryLabel = null; // a fresh history invalidates any pending entry
    appHistory = [snapshot()];
    appHistoryIndex = 0;
    historyBytes = snapshotBytes(appHistory[0]);
    updateUndoRedo();
  }
  // Undo/redo must see the entry a release deferred; flushing first keeps the
  // step available immediately instead of after the idle callback.
  function undo(){ flushPendingHistory(); if(appHistoryIndex <= 0) return; appHistoryIndex--; applySnapshot(appHistory[appHistoryIndex]); toast(I18N.t('undone')); }
  function redo(){ flushPendingHistory(); if(appHistoryIndex >= appHistory.length - 1) return; appHistoryIndex++; applySnapshot(appHistory[appHistoryIndex]); toast(I18N.t('redone')); }
  function updateCommandStates(){
    const hasSelection = Boolean(state.selected || state.selection?.nodes?.length || state.selection?.edges?.length);
    $('#btnDelete').disabled = !hasSelection;
    $('#btnFlipEdges').disabled = !(state.selection?.edges || []).some(id => edgeById(id)?.directed);
    $('#btnClear').disabled = !state.nodes.length && !state.edges.length;
    $('#btnMatrixClear').disabled = !state.edges.length;
    const hasClipboard = Boolean(clipboardData && (clipboardData.nodes.length || clipboardData.edges.length || clipboardData.externalEdges.length));
    const pasteBtn = document.getElementById('btnPaste') as HTMLButtonElement | null;
    const pasteExtBtn = document.getElementById('btnPasteWithExternal') as HTMLButtonElement | null;
    if(pasteBtn) pasteBtn.disabled = !hasClipboard;
    if(pasteExtBtn) pasteExtBtn.disabled = !hasClipboard;
    const copyBtn = document.getElementById('btnCopy') as HTMLButtonElement | null;
    const cutBtn = document.getElementById('btnCut') as HTMLButtonElement | null;
    const dupBtn = document.getElementById('btnDuplicate') as HTMLButtonElement | null;
    if(copyBtn) copyBtn.disabled = !hasSelection;
    if(cutBtn) cutBtn.disabled = !hasSelection;
    if(dupBtn) dupBtn.disabled = !hasSelection;
  }
  function updateUndoRedo(){
    $('#btnUndo').disabled = appHistoryIndex <= 0;
    $('#btnRedo').disabled = appHistoryIndex >= appHistory.length - 1;
    updateCommandStates();
  }

  function sanitizeState(input: unknown): GraphState {
    const base = defaultState();
    if(!isRecord(input)) return base;
    const source = input;
    const validShape = (value: unknown) => NODE_SHAPES.includes(String(value)) ? String(value) : '';  // '' = unset, falls back to default at render
    const validStroke = (value: unknown) => STROKE_STYLES.includes(String(value)) ? String(value) : '';
    const validLabelPos = (value: unknown) => LABEL_POSITIONS.includes(String(value)) ? String(value) : '';
    const validPolicy = (value: unknown) => LABEL_POLICIES.includes(String(value)) ? String(value) : 'auto';
    const validColor = (value: unknown) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : null;

    const usedNodeIds = new Set<string>();
    const nodeReferences = new Map<string, string>();
    const rawNodes = Array.isArray(source.nodes) ? source.nodes.slice(0, 3000).filter(isRecord) : [];
    const nodes: GraphNode[] = rawNodes.map((n, i) => {
      const rawId = String(n.id || ('n' + (i + 1)));
      const id = uniqueSafeId(rawId, 'n', usedNodeIds);
      // Ambiguous duplicate source IDs deliberately resolve to the first node.
      if(!nodeReferences.has(rawId)) nodeReferences.set(rawId, id);
      const node: GraphNode = {
        id,
        label: String(n.label ?? '').slice(0,80),
        x: finite(n.x, i*35), y: finite(n.y, i*35),
        shape: n.shape ? validShape(n.shape) : '',  // empty = unset
        color: validColor(n.color) || '',            // empty = unset
        type: String(n.type || '').slice(0,40),
        order: clamp(Math.trunc(finite(n.order, i)), 0, 2147483647)
      };
      // Optional per-node overrides — only set if present in input
      if(n.width != null) node.width = clamp(finite(n.width, 50), 10, 300);
      if(n.height != null) node.height = clamp(finite(n.height, 50), 10, 300);
      if(n.strokeColor) node.strokeColor = validColor(n.strokeColor) || '';
      if(n.strokeSize != null) node.strokeSize = clamp(finite(n.strokeSize, 2.2), 0, 20);
      if(n.strokeStyle) node.strokeStyle = validStroke(n.strokeStyle);
      if(n.labelColor) node.labelColor = validColor(n.labelColor) || '';
      if(n.labelSize != null) node.labelSize = clamp(finite(n.labelSize, 13), 4, 72);
      if(n.labelPosition) node.labelPosition = validLabelPos(n.labelPosition);
      if(n.labelFont) node.labelFont = String(n.labelFont).slice(0, 60);
      return node;
    });

    const nodeIds = new Set(nodes.map(node => node.id));
    const usedEdgeIds = new Set<string>();
    const rawEdges = Array.isArray(source.edges) ? source.edges.slice(0, 8000).filter(isRecord) : [];
    const edges: GraphEdge[] = [];
    rawEdges.forEach((e, i) => {
      const from = nodeReferences.get(String(e.from)) || (nodeIds.has(String(e.from)) ? String(e.from) : '');
      const to = nodeReferences.get(String(e.to)) || (nodeIds.has(String(e.to)) ? String(e.to) : '');
      if(!from || !to) return; // Drop dangling edges before they reach render/algorithm code.
      const edge: GraphEdge = {
        id: uniqueSafeId(e.id || ('e' + (i + 1)), 'e', usedEdgeIds),
        from, to,
        label: String(e.label ?? '').slice(0,80),
        directed: Boolean(e.directed),
        type: String(e.type || '').slice(0,40)
      };
      if(e.weight != null && e.weight !== '') edge.weight = String(e.weight).slice(0,50);
      if(e.color) edge.color = validColor(e.color) || '';
      if(e.strokeSize != null) edge.strokeSize = clamp(finite(e.strokeSize, 2.4), 0, 20);
      if(e.strokeStyle) edge.strokeStyle = validStroke(e.strokeStyle);
      if(e.labelColor) edge.labelColor = validColor(e.labelColor) || '';
      if(e.labelSize != null) edge.labelSize = clamp(finite(e.labelSize, 12), 4, 72);
      if(e.labelFont) edge.labelFont = String(e.labelFont).slice(0, 60);
      edges.push(edge);
    });
    const inputSettings = isRecord(source.settings) ? source.settings : {};
    const settings: AnyRecord = {...base.settings, ...inputSettings};
    // Edit-tab placement values — primary for newly added nodes/edges.
    settings.nodeShape = NODE_SHAPES.includes(settings.nodeShape) ? settings.nodeShape : 'circle';
    settings.nodeColor = validColor(settings.nodeColor) || '#0ea5e9';
    settings.nodeWidth = clamp(finite(settings.nodeWidth, 50), 10, 300);
    settings.nodeHeight = clamp(finite(settings.nodeHeight, 50), 10, 300);
    settings.nodeStrokeColor = validColor(settings.nodeStrokeColor) || '#e2e8f0';
    settings.nodeStrokeSize = clamp(finite(settings.nodeStrokeSize, 2.2), 0, 20);
    settings.nodeStrokeStyle = STROKE_STYLES.includes(settings.nodeStrokeStyle) ? settings.nodeStrokeStyle : 'solid';
    settings.nodeType = String(settings.nodeType || '').slice(0, 40);
    settings.nodeLabelColor = validColor(settings.nodeLabelColor) || '#f8fafc';
    settings.nodeLabelFont = String(settings.nodeLabelFont || 'Inter').slice(0, 60);
    settings.nodeLabelSize = clamp(finite(settings.nodeLabelSize, 13), 4, 72);
    settings.nodeLabelPosition = LABEL_POSITIONS.includes(settings.nodeLabelPosition) ? settings.nodeLabelPosition : 'center';
    settings.edgeType = String(settings.edgeType || '').slice(0, 40);
    settings.edgeColor = validColor(settings.edgeColor) || '#94a3b8';
    settings.edgeStrokeSize = clamp(finite(settings.edgeStrokeSize, 2.4), 0, 20);
    settings.edgeStrokeStyle = STROKE_STYLES.includes(settings.edgeStrokeStyle) ? settings.edgeStrokeStyle : 'solid';
    settings.edgeLabelColor = validColor(settings.edgeLabelColor) || '#dbeafe';
    settings.edgeLabelFont = String(settings.edgeLabelFont || 'Inter').slice(0, 60);
    settings.edgeLabelSize = clamp(finite(settings.edgeLabelSize, 12), 4, 72);
    settings.hitTestMode = ['any','center'].includes(settings.hitTestMode) ? settings.hitTestMode : 'any';
    // Merge nested defaults objects
    settings.graphDefaults = {
      ...base.settings.graphDefaults,
      ...(isRecord(inputSettings.graphDefaults) ? inputSettings.graphDefaults : {})
    };
    settings.graphDefaults.labelsPolicy = validPolicy(settings.graphDefaults.labelsPolicy);
    // Label outline / background plate settings
    const los = ['outline','plate','none'];
    settings.graphDefaults.labelOutline = los.includes(settings.graphDefaults.labelOutline) ? settings.graphDefaults.labelOutline : 'outline';
    settings.graphDefaults.labelOutlineColor = validColor(settings.graphDefaults.labelOutlineColor) || '#020617';
    settings.graphDefaults.labelOutlineWidth = clamp(finite(settings.graphDefaults.labelOutlineWidth, 4), 0, 10);
    // Migrate old showEdgeWeights → edgeWeightMode
    if(settings.graphDefaults.showEdgeWeights != null && !settings.graphDefaults.edgeWeightMode){
      settings.graphDefaults.edgeWeightMode = settings.graphDefaults.showEdgeWeights === false ? 'none' : 'number';
    }
    delete settings.graphDefaults.showEdgeWeights;
    const ewm = ['none','number','color','width'];
    settings.graphDefaults.edgeWeightMode = ewm.includes(settings.graphDefaults.edgeWeightMode) ? settings.graphDefaults.edgeWeightMode : 'number';
    const ewCorr = ['linear','log','exp','sqrt'];
    settings.graphDefaults.edgeWeightCorr = ewCorr.includes(settings.graphDefaults.edgeWeightCorr) ? settings.graphDefaults.edgeWeightCorr : 'linear';
    settings.graphDefaults.edgeWeightMin = finite(settings.graphDefaults.edgeWeightMin, 1);
    settings.graphDefaults.edgeWeightMax = finite(settings.graphDefaults.edgeWeightMax, 10);
    settings.graphDefaults.edgeWidthMin = clamp(finite(settings.graphDefaults.edgeWidthMin, 1), 0.1, 50);
    settings.graphDefaults.edgeWidthMax = clamp(finite(settings.graphDefaults.edgeWidthMax, 8), 0.1, 50);
    settings.graphDefaults.edgeWeightColorLow = validColor(settings.graphDefaults.edgeWeightColorLow) || '#22d3ee';
    settings.graphDefaults.edgeWeightColorHigh = validColor(settings.graphDefaults.edgeWeightColorHigh) || '#f59e0b';
    settings.nodeDefaults = {
      ...base.settings.nodeDefaults,
      ...(isRecord(inputSettings.nodeDefaults) ? inputSettings.nodeDefaults : {})
    };
    const nd = settings.nodeDefaults;
    nd.shape = NODE_SHAPES.includes(nd.shape) ? nd.shape : 'circle';
    nd.color = validColor(nd.color) || '#0ea5e9';
    nd.labelColor = validColor(nd.labelColor) || '#f8fafc';
    nd.labelPosition = validLabelPos(nd.labelPosition) || 'center';
    nd.strokeStyle = validStroke(nd.strokeStyle) || 'solid';
    nd.strokeColor = validColor(nd.strokeColor) || '#e2e8f0';
    nd.width = clamp(finite(nd.width, 50), 10, 300);
    nd.height = clamp(finite(nd.height, 50), 10, 300);
    nd.strokeSize = clamp(finite(nd.strokeSize, 2.2), 0, 20);
    nd.labelSize = clamp(finite(nd.labelSize, 13), 4, 72);
    nd.labelFont = String(nd.labelFont || 'Inter').slice(0, 60);
    nd.type = String(nd.type || '').slice(0, 40);
    settings.edgeDefaults = {
      ...base.settings.edgeDefaults,
      ...(isRecord(inputSettings.edgeDefaults) ? inputSettings.edgeDefaults : {})
    };
    const ed = settings.edgeDefaults;
    ed.color = validColor(ed.color) || '#94a3b8';
    ed.labelColor = validColor(ed.labelColor) || '#dbeafe';
    ed.strokeStyle = validStroke(ed.strokeStyle) || 'solid';
    ed.strokeSize = clamp(finite(ed.strokeSize, 2.4), 0, 20);
    ed.labelSize = clamp(finite(ed.labelSize, 12), 4, 72);
    ed.labelFont = String(ed.labelFont || 'Inter').slice(0, 60);
    ed.type = String(ed.type || '').slice(0, 40);
    settings.inheritDefaults = settings.inheritDefaults !== false; // default true
    settings.noLabel = Boolean(settings.noLabel);
    // Sanitize type style maps
    const sanitizeTypeStyle = (ts: unknown, isNode: boolean): AnyRecord | undefined => {
      if(!isRecord(ts)) return undefined;
      const out: AnyRecord = {};
      if(validColor(ts.color)) out.color = ts.color;
      if(isNode){
        if(ts.shape && NODE_SHAPES.includes(ts.shape)) out.shape = ts.shape;
        if(ts.width != null) out.width = clamp(finite(ts.width, 50), 10, 300);
        if(ts.height != null) out.height = clamp(finite(ts.height, 50), 10, 300);
        if(validColor(ts.strokeColor)) out.strokeColor = ts.strokeColor;
        if(ts.strokeSize != null) out.strokeSize = clamp(finite(ts.strokeSize, 2.2), 0, 20);
        if(ts.strokeStyle && STROKE_STYLES.includes(ts.strokeStyle)) out.strokeStyle = ts.strokeStyle;
        if(validColor(ts.labelColor)) out.labelColor = ts.labelColor;
        if(ts.labelSize != null) out.labelSize = clamp(finite(ts.labelSize, 13), 4, 72);
        if(ts.labelPosition && LABEL_POSITIONS.includes(ts.labelPosition)) out.labelPosition = ts.labelPosition;
        if(ts.labelFont) out.labelFont = String(ts.labelFont).slice(0, 60);
      } else {
        if(ts.strokeSize != null) out.strokeSize = clamp(finite(ts.strokeSize, 2.4), 0, 20);
        if(ts.strokeStyle && STROKE_STYLES.includes(ts.strokeStyle)) out.strokeStyle = ts.strokeStyle;
        if(validColor(ts.labelColor)) out.labelColor = ts.labelColor;
        if(ts.labelSize != null) out.labelSize = clamp(finite(ts.labelSize, 12), 4, 72);
        if(ts.labelFont) out.labelFont = String(ts.labelFont).slice(0, 60);
      }
      return Object.keys(out).length ? out : undefined;
    };
    if(isRecord(settings.nodeTypeStyles)){
      const cleaned: AnyRecord = Object.create(null);
      for(const [key, value] of Object.entries(settings.nodeTypeStyles)){
        const style = sanitizeTypeStyle(value, true);
        if(style) cleaned[String(key).slice(0,40)] = style;
      }
      settings.nodeTypeStyles = cleaned;
    } else { settings.nodeTypeStyles = Object.create(null); }
    if(isRecord(settings.edgeTypeStyles)){
      const cleaned: AnyRecord = Object.create(null);
      for(const [key, value] of Object.entries(settings.edgeTypeStyles)){
        const style = sanitizeTypeStyle(value, false);
        if(style) cleaned[String(key).slice(0,40)] = style;
      }
      settings.edgeTypeStyles = cleaned;
    } else { settings.edgeTypeStyles = Object.create(null); }
    const legacyGrid = parseInt(settings.gridSize,10) || 40;
    settings.gridSizeX = clamp(parseInt(settings.gridSizeX,10) || legacyGrid, 5, 300);
    settings.gridSizeY = clamp(parseInt(settings.gridSizeY,10) || legacyGrid, 5, 300);
    settings.gridSize = settings.gridSizeX;
    settings.matrixLimit = positiveInteger(settings.matrixLimit, 90);
    settings.edgeListPageSize = positiveInteger(settings.edgeListPageSize, 250);
    settings.matrixDimension = clamp(parseInt(settings.matrixDimension,10) || 0, 0, MATRIX_MAX_NODES);
    settings.brushDiameter = clamp(parseInt(settings.brushDiameter,10) || 80, 10, 400);
    settings.directed = Boolean(settings.directed); settings.snap = Boolean(settings.snap); settings.snapX = Boolean(settings.snapX); settings.snapY = Boolean(settings.snapY); settings.autosave = settings.autosave !== false;
    settings.copyPreserveExternal = settings.copyPreserveExternal !== false;
    // Gizmo tool/visibility migrated to a local UI preference (45-gizmo.ts);
    // strip the legacy document field so imports/exports cannot resurrect it.
    delete settings.gizmoEnabled;
    // Canvas background and grid colors
    settings.canvasBgColor = validColor(settings.canvasBgColor) || '#020617';
    settings.gridMinorColor = validColor(settings.gridMinorColor) || '#94a3b8';
    settings.gridMajorColor = validColor(settings.gridMajorColor) || '#94a3b8';
    settings.gridMinorAlpha = clamp(finite(settings.gridMinorAlpha, 0.105), 0, 1);
    settings.gridMajorAlpha = clamp(finite(settings.gridMajorAlpha, 0.16), 0, 1);
    // Visible range: sanitize start/end (-1 = unset)
    const visibleRange = isRecord(settings.visibleRange) ? settings.visibleRange : {};
    settings.visibleRange = {
      start: safeRangeEndpoint(visibleRange.start),
      end: safeRangeEndpoint(visibleRange.end)
    };
    // Sanitize style presets
    if(Array.isArray(settings.stylePresets)){
      settings.stylePresets = settings.stylePresets.slice(0, 100).map(p => {
        if(!isRecord(p)) return null;
        const out: AnyRecord = { name: String(p.name || 'preset').slice(0, 40) };
        if(isRecord(p.node)){
          out.node = {};
          const sn = p.node;
          if(sn.shape && NODE_SHAPES.includes(sn.shape)) out.node.shape = sn.shape;
          if(validColor(sn.color)) out.node.color = sn.color;
          if(sn.width != null) out.node.width = clamp(finite(sn.width, 50), 10, 300);
          if(sn.height != null) out.node.height = clamp(finite(sn.height, 50), 10, 300);
          if(validColor(sn.strokeColor)) out.node.strokeColor = sn.strokeColor;
          if(sn.strokeSize != null) out.node.strokeSize = clamp(finite(sn.strokeSize, 2.2), 0, 20);
          if(sn.strokeStyle && STROKE_STYLES.includes(sn.strokeStyle)) out.node.strokeStyle = sn.strokeStyle;
          if(validColor(sn.labelColor)) out.node.labelColor = sn.labelColor;
          if(sn.labelSize != null) out.node.labelSize = clamp(finite(sn.labelSize, 13), 4, 72);
          if(sn.labelPosition && LABEL_POSITIONS.includes(sn.labelPosition)) out.node.labelPosition = sn.labelPosition;
          if(sn.labelFont) out.node.labelFont = String(sn.labelFont).slice(0, 60);
        }
        if(isRecord(p.edge)){
          out.edge = {};
          const se = p.edge;
          if(validColor(se.color)) out.edge.color = se.color;
          if(se.strokeSize != null) out.edge.strokeSize = clamp(finite(se.strokeSize, 2.4), 0, 20);
          if(se.strokeStyle && STROKE_STYLES.includes(se.strokeStyle)) out.edge.strokeStyle = se.strokeStyle;
          if(validColor(se.labelColor)) out.edge.labelColor = se.labelColor;
          if(se.labelSize != null) out.edge.labelSize = clamp(finite(se.labelSize, 12), 4, 72);
          if(se.labelFont) out.edge.labelFont = String(se.labelFont).slice(0, 60);
        }
        return out;
      }).filter(Boolean);
    } else { settings.stylePresets = []; }
    const customAttributeTypes = ['boolean','int','long','float','double','string'];
    const customAttributeIds = new Set<string>();
    const customAttributes = (Array.isArray(source.customAttributes) ? source.customAttributes : [])
      .slice(0, 500).filter(isRecord).map(attribute => {
        const id = String(attribute.id ?? '').trim().slice(0, 128);
        const scope = ['graph','node','edge'].includes(String(attribute.scope)) ? attribute.scope : null;
        const type = customAttributeTypes.includes(String(attribute.type)) ? String(attribute.type) : 'string';
        if(!id || !scope || RESERVED_CUSTOM_ATTRIBUTE_IDS.has(id) || customAttributeIds.has(id)) return null;
        customAttributeIds.add(id);
        return {id, scope, type};
      }).filter(Boolean) as GraphState['customAttributes'];
    const vb = isRecord(source.viewBox) ? source.viewBox : base.viewBox;
    const maxN = Math.max(
      ...nodes.map(n => Number((n.id.match(/\d+$/)||[0])[0])),
      finite(source.nextNode,1)-1,
      nodes.length
    );
    const maxE = Math.max(
      ...edges.map(e => Number((e.id.match(/\d+$/)||[0])[0])),
      finite(source.nextEdge,1)-1,
      edges.length
    );
    return {
      ...base,
      title: String(source.title || 'untitled').slice(0,80),
      mode: ['select','move','node','edge'].includes(source.mode) ? source.mode : 'select',
      selectTool: ['single','rect','brush','lasso','line','polygon'].includes(source.selectTool) ? source.selectTool : 'single',
      selectCombine: ['replace','add','subtract'].includes(source.selectCombine) ? source.selectCombine : 'replace',
      selection: {nodes: [], edges: []},
      nextNode: maxN + 1,
      nextEdge: maxE + 1,
      nodes, edges, customAttributes, settings,
      viewBox: boundedCamera({ x:finite(vb.x,-500), y:finite(vb.y,-330), w:finite(vb.w,1000), h:finite(vb.h,660) })
    };
  }
  function isRecord(value: unknown): value is AnyRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function finite(value: unknown, fallback: number): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }
  function positiveInteger(value: unknown, fallback: number): number {
    const numeric = Math.trunc(finite(value, fallback));
    return numeric > 0 ? numeric : fallback;
  }
  function safeId(value: unknown, prefix: string): string {
    const id = String(value ?? '').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40);
    return id || (prefix + Math.random().toString(36).slice(2,8));
  }
  function uniqueSafeId(value: unknown, prefix: string, used: Set<string>): string {
    const base = String(value ?? '').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40) || prefix;
    let id = base;
    for(let suffix = 2; used.has(id); suffix++){
      const ending = `-${suffix}`;
      id = base.slice(0, Math.max(1, 40 - ending.length)) + ending;
    }
    used.add(id);
    return id;
  }
  function safeRangeEndpoint(value: unknown): number {
    if(value == null || value === '') return -1;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? clamp(parsed, -1, 2147483647) : -1;
  }
  function labelFromNumber(num){
    let n = Math.max(1, Number(num)||1), out = '';
    while(n > 0){ n--; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
    return out;
  }
  // === Indexed id lookups ===
  // Id→object hash indexes behind nodeById/edgeById. These sit on every hot
  // path (selection sync, drag geometry, algorithms), so they must stay O(1)
  // regardless of graph size. The index rebuilds lazily, and only when the
  // array identity, its length, or an explicit invalidation (in-place id
  // rewrite or edge reordering) says the mapping changed.
  let graphRev = 0;
  function invalidateGraphIndex(){ graphRev++; }
  let nodeIndex = { arr: null, len: -1, rev: -1, map: new Map() };
  let edgeIndex = { arr: null, len: -1, rev: -1, map: new Map() };
  function indexFor(index, arr){
    if(index.arr !== arr || index.len !== arr.length || index.rev !== graphRev){
      const map = new Map();
      for(let i = 0; i < arr.length; i++) map.set(arr[i].id, arr[i]);
      index.arr = arr; index.len = arr.length; index.rev = graphRev; index.map = map;
    }
    return index.map;
  }
  function nodeById(id){ return indexFor(nodeIndex, state.nodes).get(id); }
  function edgeById(id){ return indexFor(edgeIndex, state.edges).get(id); }

  // === Visual resolution: merge per-item overrides → type styles → defaults ===
