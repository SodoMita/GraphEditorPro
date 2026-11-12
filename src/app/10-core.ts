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
  // Keep every number written into SVG comfortably below Skia's ~2^25 clamp.
  // 3e7 still leaves room for grid aprons, long-edge clipping and gizmo arms.
  const RENDER_COORD_LIMIT = 3e7;
  const RENDER_ORIGIN_SNAP = 1e6;
  // Instead of capping the world camera to a fixed safe square, choose a
  // POWER-OF-TWO render-space scale for the whole scene. Every SVG number is
  // multiplied by this scale; the inverse scale is written as a product of
  // small SVG scale()s on the scene group, and the camera matrix stays in true
  // world units. A 1422x588 Fit of a 30,000,000-unit vertical span and a
  // 60,000,000-unit horizontal Fit therefore both keep their full size while
  // every path/transform number remains below Skia's coordinate limit. This is
  // not another camera clamp: camera.w/h, state, autosave and export keep the
  // exact world viewport.
  let renderScale = 1;
  let renderScaleDirty = true;
  let cameraViewportAspect = 1;
  function updateCameraViewportAspect(rect: any = null){
    const r = (rect && rect.width && rect.height) ? rect
      : (svg && typeof svg.getBoundingClientRect === 'function' ? svg.getBoundingClientRect() : null);
    if(!r || !(r.width > 0) || !(r.height > 0)) return;
    const aspect = r.width / r.height;
    if(Number.isFinite(aspect) && aspect > 0) cameraViewportAspect = aspect;
  }
  // The camera is not clamped to a display limit. Only sub-viewport minimums
  // keep gestures usable; huge finite spans are handled by shrinking
  // renderScale, never by rewriting the world camera or recentring it.
  function maxCameraWidth(){ return Infinity; }
  function maxCameraHeight(){ return Infinity; }
  const MIN_CAMERA_W = 100, MIN_CAMERA_H = 90;
  // Largest WORLD distance from the floating origin that can be written into
  // SVG after applying renderScale. Geometry is clamped in world units first,
  // then scaled, so no attribute can exceed RENDER_COORD_LIMIT.
  function renderCoordLimit(){ return RENDER_COORD_LIMIT / renderScale; }
  function rawRenderCoord(value: unknown): number {
    const L = renderCoordLimit();
    return clamp(finite(value, 0), -L, L);
  }
  function renderCoord(value: unknown): number { return renderScale * rawRenderCoord(value); }
  function renderSize(value: unknown): number { return finite(value, 0) * renderScale; }
  // Visible half-span of the camera in world units, including letterboxing.
  // Normalised to a viewport height of 1 so it works before layout and in the
  // inert VM used by the state-safety tests.
  function renderCameraHalfSpan(cam: ViewBox): number {
    const aspect = cameraViewportAspect > 0 ? cameraViewportAspect : 1;
    const w = Math.max(cam.w, MIN_CAMERA_W), h = Math.max(cam.h, MIN_CAMERA_H);
    const pitch = Math.min(aspect / w, 1 / h);
    const offX = (aspect - w * pitch) / 2, offY = (1 - h * pitch) / 2;
    if(!(pitch > 0) || !Number.isFinite(pitch)) return Math.max(w, h) / 2;
    return Math.max(w / 2 + offX / pitch, h / 2 + offY / pitch);
  }
  // Pick 2^-n <= limit/halfSpan. Powers of two make the inverse transform
  // exact and avoid float drift between the geometry, grid and camera.
  function safeRenderScale(cam: ViewBox): number {
    const halfSpan = renderCameraHalfSpan(cam) + RENDER_ORIGIN_SNAP;
    const ratio = RENDER_COORD_LIMIT / Math.max(1, halfSpan);
    if(!(ratio > 0) || !Number.isFinite(ratio) || ratio >= 1) return 1;
    const exponent = Math.max(-900, Math.floor(Math.log2(ratio)));
    return 2 ** exponent;
  }
  let renderOriginX = 0, renderOriginY = 0;
  // Set when the origin OR the render-space scale moves during a preview-only
  // camera update. Geometry must be rebased in the SAME task as the camera
  // matrix write; a queued rAF lets Chromium paint one frame with the new
  // matrix and old node positions.
  let renderOriginMoved = false;
  function rawRenderX(x: unknown): number { return finite(x, 0) - renderOriginX; }
  function rawRenderY(y: unknown): number { return finite(y, 0) - renderOriginY; }
  function renderX(x: unknown): number { return renderCoord(rawRenderX(x)); }
  function renderY(y: unknown): number { return renderCoord(rawRenderY(y)); }
  function clampRenderCoord(value: unknown): number { return renderCoord(value); }
  // Coordinates farther than the scaled safe window from the floating origin
  // would exceed Skia's coordinate limit if written into SVG at all. Skip the
  // node in the DOM, but keep it untouched in state/export/autosave; edges are
  // clipped instead of discarded, since a long edge can cross the viewport.
  function isRenderablePoint(x: unknown, y: unknown): boolean {
    const L = renderCoordLimit();
    return Math.abs(rawRenderX(x)) <= L && Math.abs(rawRenderY(y)) <= L;
  }
  function syncRenderScaleForCamera(cam: ViewBox){
    const next = safeRenderScale(cam);
    if(next !== renderScale){
      renderScale = next;
      renderScaleDirty = true;
      renderOriginMoved = true; // force same-task geometry repaint
      invalidateGridCache();
    }
  }
  // The inverse of renderScale is a power of two. Express it as a product of
  // small scale() operations (each <= 2^20) so even a 1e20-unit camera never
  // writes an SVG transform number above Skia's ~2^25 limit.
  function renderScaleInverseText(): string | null {
    if(renderScale >= 1) return null;
    let exponent = Math.round(-Math.log2(renderScale));
    const parts: string[] = [];
    while(exponent > 20){ parts.push('scale(1048576)'); exponent -= 20; }
    if(exponent > 0 || !parts.length) parts.push(`scale(${2 ** exponent})`);
    return parts.join(' ');
  }
  function syncRenderScaleDom(){
    if(!renderScaleDirty) return;
    renderScaleDirty = false;
    const text = renderScaleInverseText();
    if(sceneLayer){
      if(text === null){
        if(sceneLayer.hasAttribute('transform')) sceneLayer.removeAttribute('transform');
      } else if(sceneLayer.getAttribute('transform') !== text){
        sceneLayer.setAttribute('transform', text);
      }
      try { sceneLayer.style.setProperty('--render-scale', String(renderScale)); } catch { /* inert VM */ }
    }
    if(svg){
      const marker = String(renderScale);
      if(svg.getAttribute('data-render-scale') !== marker) svg.setAttribute('data-render-scale', marker);
    }
  }
  // Keep a camera finite and preserve its centre. There is NO upper display
  // clamp: the render-space scale adapts to the full world viewport instead of
  // truncating fitView or a loaded camera.
  function boundedCamera(camera: any): ViewBox {
    const x = finite(camera?.x, 0), y = finite(camera?.y, 0);
    const ow = finite(camera?.w, 1000), oh = finite(camera?.h, 660);
    const w = clamp(ow, MIN_CAMERA_W, maxCameraWidth());
    const h = clamp(oh, MIN_CAMERA_H, maxCameraHeight());
    const cam = { x: x + (ow - w) / 2, y: y + (oh - h) / 2, w, h };
    syncRenderScaleForCamera(cam);
    return cam;
  }
  // One floating origin for every surface inside the scene. It changes only
  // when the camera centre moves past a 1e6 snap boundary, so ordinary
  // pans/zooms are still a single matrix write; crossing one forces a geometry
  // repaint. Snapping to the CENTRE keeps both ends of a huge Fit centred in
  // the scaled safe window.
  function ensureRenderOrigin(camera: any){
    const cam = boundedCamera(camera);
    const ox = Math.round((cam.x + cam.w / 2) / RENDER_ORIGIN_SNAP) * RENDER_ORIGIN_SNAP;
    const oy = Math.round((cam.y + cam.h / 2) / RENDER_ORIGIN_SNAP) * RENDER_ORIGIN_SNAP;
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
  updateCameraViewportAspect();
  if(typeof window !== 'undefined' && typeof window.addEventListener === 'function'){
    window.addEventListener('resize', () => updateCameraViewportAspect(), { passive: true });
  }
  if(typeof ResizeObserver !== 'undefined' && svg && typeof svg.getBoundingClientRect === 'function'){
    try { new ResizeObserver(() => updateCameraViewportAspect()).observe(svg); } catch { /* non-DOM test context */ }
  }
  function isCanvasOverlayControl(target: any){
    return Boolean(target?.closest?.('.canvas-hud, .zoom-controls, .mode-fab, .edge-tools, .sel-tools, .gizmo-tools'));
  }
  // #cameraLayer is the ONE camera surface: an SVG <g> inside the canvas. Both
  // gesture previews and committed cameras write the same matrix here, so there
  // is no second surface, no compositor handoff and no clipped world content.
  const cameraLayer = $('#cameraLayer');
  const sceneLayer = $('#sceneLayer');
  const edgesLayer = $('#edgesLayer');
  const nodesLayer = $('#nodesLayer');
  const dragLine = $('#dragLine');
  const selectionOverlayLayer = $('#selectionOverlayLayer');
  const gizmoLayer = $('#gizmoLayer');

  const NODE_SHAPES = ['circle','square','diamond','triangleUp','triangleDown','hexagon'];
  // QVGE-compatible stroke styles: must match CUtils::textToPenStyle mapping
  // none=NoPen, solid=SolidLine, dashed=DashLine, dotted=DotLine, dashdot=DashDotLine, dashdotdot=DashDotDotLine
  const STROKE_STYLES = ['solid','dashed','dotted','dashdot','dashdotdot','none'];
  const LABEL_POSITIONS = ['center','top','bottom','left','right'];
  const LABEL_POLICIES = ['auto','on','off'];
  // Maximum number of custom attribute definitions the editor will hold.
  const CUSTOM_DEFINITIONS_MAX = 500;
  // Finds the first free "<base>_<n>" id for a re-created definition. No id is
  // reserved in the editor (the exporter marks its own definitions, so a name
  // like `direction` cannot collide with a built-in key) — the only constraint
  // is uniqueness against the ids already in play.
  function uniqueCustomAttributeId(base: string, taken: Set<string>): string {
    for(let n = 1; n < 1000; n++){
      const candidate = `${base.slice(0, 120)}_${n}`;
      if(!taken.has(candidate)){
        taken.add(candidate);
        return candidate;
      }
    }
    const fallback = `${base.slice(0, 110)}_${Math.floor(Math.random() * 1e6)}`;
    taken.add(fallback);
    return fallback;
  }
  // Custom-value maps must carry their keys as OWN properties: a user-chosen
  // id like "__proto__" must never mutate a prototype or shadow inherited
  // members. Everything the app creates is already null-prototyped; this copies
  // legacy ordinary objects (e.g. from JSON.parse) into safe maps.
  function ownKeyRecord(value: unknown): AnyRecord {
    if(isRecord(value) && Object.getPrototypeOf(value) === null) return value;
    const out: AnyRecord = Object.create(null);
    if(isRecord(value)) for(const key of Object.keys(value)) out[key] = value[key];
    return out;
  }
  const EDGE_DIRECTIONS = ['directed','mutual','undirected'];
  const DEFAULT_ARROW_SIZE = 12;
  const ARROW_SIZE_MIN = 4, ARROW_SIZE_MAX = 40;
  function normalizeDirection(raw: any): string {
    if(raw === true || raw === 'true' || raw === 1 || raw === '1') return 'directed';
    if(raw === false || raw === 'false' || raw === 0 || raw === '0') return 'undirected';
    const s = String(raw ?? '').trim().toLowerCase();
    if(!s) return 'directed';
    if(s === 'directed' || s === 'forward' || s === 'true' || s === '1' || s === 'directed (one end)') return 'directed';
    if(s === 'mutual' || s === 'both' || s === 'bidirected' || s === 'bidirectional' || s === 'mutual (both ends)') return 'mutual';
    if(s === 'undirected' || s === 'none' || s === 'false' || s === '0' || s === 'undirected (no ends)') return 'undirected';
    if(['directed','mutual','undirected'].includes(s)) return s;
    if(s.startsWith('bi')) return 'mutual';
    return 'directed';
  }
  function edgeDirection(e: any): string {
    // Canonical field is e.direction, legacy is e.directed (boolean or string)
    const raw = (e && (e.direction ?? e.directed));
    return normalizeDirection(raw);
  }
  function edgeHasEndArrow(e: any): boolean {
    const d = edgeDirection(e);
    return d === 'directed' || d === 'mutual';
  }
  function edgeHasStartArrow(e: any): boolean {
    return edgeDirection(e) === 'mutual';
  }
  function edgeIsUndirected(e: any): boolean {
    return edgeDirection(e) === 'undirected';
  }
  // ---- GraphML keys: the importer's own read surface ----
  //
  // Two rounds of review asked for opposite answers on the same <key>
  // (id="fillcolor" attr.name="fillcolor" for="node"):
  //   * a definition the user made, exported by us, must come back;
  //   * a foreign key with that name must not appear as a definition, because
  //     the importer reads `fillcolor` as the node colour.
  // The bytes are identical, so no rule over (id, name, scope) can decide it.
  // Only the writer knows, so the exporter marks its own definitions
  // (qvge:custom) and everything unmarked is classified by the one question
  // left: does the importer read this attr.name as a built-in for this scope?
  // If it does, the key feeds a built-in field and cannot be a definition.
  let graphmlSchemaSource: (() => GraphmlSchema) | null = null;
  function registerGraphmlSchema(source: () => GraphmlSchema): void {
    graphmlSchemaSource = source;
  }
  function graphmlSchema(): GraphmlSchema {
    return graphmlSchemaSource ? graphmlSchemaSource() : {readNames: []};
  }
  // Could an unmarked key bind to one of our built-in fields? A key declared
  // without `for` (GraphML's default is "all") may apply to any scope, so it is
  // built-in when the name is read on *any* scope — otherwise a foreign key
  // named `label` would be reported as a definition while still setting labels.
  function isBuiltinGraphmlKey(name: string, scope: string): boolean {
    const wanted = String(name || '').toLowerCase();
    const anyScope = scope === 'all';
    return graphmlSchema().readNames.some(([readName, readScope]) =>
      readName === wanted && (anyScope || readScope === scope));
  }

  const FONT_FAMILIES = ['Inter','ui-sans-serif','ui-serif','ui-monospace','Arial','Helvetica','Times New Roman','Courier New'];

  const defaultState = (): GraphState => ({
    title: 'untitled', mode: 'select', selectTool: 'single', selectCombine: 'replace', nextNode: 1, nextEdge: 1,
    nodes: [], edges: [], customAttributes: [], graphCustom: Object.create(null),
    selected: null, selection: {nodes: [], edges: []},
    settings: {
      // Edit-tab node placement (primary for newly added nodes)
      nodeShape:'circle', nodeColor:'#0ea5e9',
      nodeWidth:50, nodeHeight:50,
      nodeStrokeColor:'#e2e8f0', nodeStrokeSize:2.2, nodeStrokeStyle:'solid',
      nodeType:'', nodeLabelColor:'#f8fafc', nodeLabelFont:'Inter', nodeLabelSize:13, nodeLabelPosition:'center',
      // Edit-tab edge defaults (primary for newly added edges) — QVGE uses direction string
      directed:true, direction:'directed', edgeWeight:'1', edgeLabel:'',
      edgeType:'', edgeColor:'#94a3b8', edgeStrokeSize:2.4, edgeStrokeStyle:'solid',
      edgeArrowSize: DEFAULT_ARROW_SIZE,
      edgeLabelColor:'#dbeafe', edgeLabelFont:'Inter', edgeLabelSize:12,
      // Pending custom property values applied to newly created nodes/edges
      // (Edit-tab "Node placement" / "New edge defaults" sections).
      nodeCustom: Object.create(null), edgeCustom: Object.create(null),
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
        strokeSize:2.4, strokeStyle:'solid', arrowSize: DEFAULT_ARROW_SIZE
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
  // The clipboard payload carries the definitions of every custom attribute
  // it references, so pasting into a document that lacks them can re-create
  // them. Existing definitions win on id conflicts.
  let clipboardData: { nodes: GraphNode[]; edges: GraphEdge[]; externalEdges: GraphEdge[]; customAttributes?: { id: string; scope: 'graph' | 'node' | 'edge'; type: string; name?: string }[] } | null = null;
  let pasteOffsetCount = 0;
  // UI hook installed by the UI layer (80-ui.ts). Renderers that rebuild
  // controls call it instead of reaching for a global, so modules stay
  // decoupled without leaking implementation state onto `window`.
  let syncUiHooks: (() => void) | null = null;

  function snapshot(){
    const vb = currentCamera(); // persist active camera without forcing a mid-gesture SVG commit
    return JSON.stringify({
      title:state.title, mode:state.mode, selectTool:state.selectTool, selectCombine:state.selectCombine, nextNode:state.nextNode, nextEdge:state.nextEdge,
      nodes:state.nodes, edges:state.edges, customAttributes:state.customAttributes, graphCustom:state.graphCustom, settings:state.settings, viewBox:vb,
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
    $('#btnFlipEdges').disabled = !(state.selection?.edges || []).some(id => { const e=edgeById(id); return e && edgeDirection(e) !== 'undirected'; });
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


  // === Custom property values (values of user-defined custom attributes) ===
  // A custom property target is the graph, a node/edge, or one of the two
  // pseudo-targets for values pending application to newly created nodes/edges
  // (kept in settings so they ride defaults/undo like every other new-element
  // default). The pseudo-targets share the same set/unset plumbing.
  type CustomPropTarget = 'graph' | GraphNode | GraphEdge | 'node-defaults' | 'edge-defaults';
  function customStoreOf(target: CustomPropTarget): AnyRecord | undefined {
    if(target === 'graph') return state.graphCustom;
    if(target === 'node-defaults') return isRecord(state.settings) ? state.settings.nodeCustom : undefined;
    if(target === 'edge-defaults') return isRecord(state.settings) ? state.settings.edgeCustom : undefined;
    return target.custom;
  }
  function isPendingDefaultsTarget(target: CustomPropTarget): target is 'node-defaults' | 'edge-defaults' {
    return target === 'node-defaults' || target === 'edge-defaults';
  }
  // Definitions live in state.customAttributes; values live next to the entity
  // they describe: state.graphCustom for scope 'graph', node.custom / edge.custom
  // (flat id -> scalar maps) otherwise. Values are only kept while their
  // attribute is defined — deleting a definition strips its values — and are
  // always stored as plain string|number|boolean scalars with capped sizes, so a
  // hand-edited file cannot smuggle objects, prototype pollution or huge blobs
  // into the document.
  const CUSTOM_VALUE_MAX = 1000;
  const CUSTOM_VALUE_KEYS_MAX = CUSTOM_DEFINITIONS_MAX; // one value per definition, never more
  function customAttributeTypeMap(definitions: readonly { id: string; type: string }[]): Map<string, string> {
    const map = new Map<string, string>();
    for(const attribute of definitions) map.set(attribute.id, attribute.type);
    return map;
  }
  function coerceCustomValue(value: unknown, type: string): CustomAttributeValue {
    const raw = typeof value === 'number' || typeof value === 'boolean' ? String(value) : String(value ?? '');
    const text = raw.trim();
    if(type === 'boolean'){
      if(value === true || /^(true|1|yes|on)$/i.test(text)) return true;
      if(value === false || /^(false|0|no|off)$/i.test(text)) return false;
      return text.slice(0, CUSTOM_VALUE_MAX);
    }
    if(type === 'int' || type === 'long'){
      const numeric = Number(text);
      if(Number.isFinite(numeric)){
        const truncated = Math.trunc(numeric);
        // Out-of-range values are kept as the exact text the user typed or the
        // file contains (never silently clamped) — same lenient rule as for
        // unparseable input, so a valid 64-bit long round-trips intact.
        if(type === 'int' && (truncated < -2147483648 || truncated > 2147483647)) return text.slice(0, CUSTOM_VALUE_MAX);
        if(type === 'long' && Math.abs(truncated) > Number.MAX_SAFE_INTEGER) return text.slice(0, CUSTOM_VALUE_MAX);
        return truncated;
      }
      return text.slice(0, CUSTOM_VALUE_MAX);
    }
    if(type === 'float' || type === 'double'){
      const numeric = Number(text);
      if(Number.isFinite(numeric)) return numeric;
      return text.slice(0, CUSTOM_VALUE_MAX);
    }
    return raw.slice(0, CUSTOM_VALUE_MAX);
  }
  // Migrates stored values of one attribute to a new type. Unlike
  // coerceCustomValue (the import path, which keeps unrepresentable text),
  // this returns undefined for values that cannot be represented in the target
  // type, so the caller can drop them explicitly.
  function coerceCustomValueForType(value: CustomAttributeValue, type: string): CustomAttributeValue | undefined {
    if(type === 'string') return String(value).slice(0, CUSTOM_VALUE_MAX);
    if(type === 'boolean'){
      if(typeof value === 'boolean') return value;
      const text = String(value ?? '').trim();
      if(/^(true|1|yes|on)$/i.test(text)) return true;
      if(/^(false|0|no|off)$/i.test(text)) return false;
      return undefined;
    }
    if(type === 'int' || type === 'long'){
      if(typeof value === 'boolean') return undefined; // a truthy flag is not a number
      const text = String(value ?? '').trim();
      if(text === '') return undefined;
      const numeric = Number(text);
      if(!Number.isFinite(numeric)) return undefined;
      const truncated = Math.trunc(numeric);
      // Out-of-range values are preserved as the exact text, mirroring the
      // input and import paths — a 64-bit long the JS number line cannot hold
      // is stored as text, never dropped or clamped.
      if(type === 'int' && (truncated < -2147483648 || truncated > 2147483647)) return text.slice(0, CUSTOM_VALUE_MAX);
      if(type === 'long' && Math.abs(truncated) > Number.MAX_SAFE_INTEGER) return text.slice(0, CUSTOM_VALUE_MAX);
      return truncated;
    }
    if(type === 'float' || type === 'double'){
      if(typeof value === 'boolean') return undefined;
      const numeric = Number(String(value ?? '').trim());
      return Number.isFinite(numeric) ? numeric : undefined;
    }
    return String(value).slice(0, CUSTOM_VALUE_MAX);
  }
  // Rewrites every stored value of one attribute id to a new type, dropping
  // values that cannot be represented. Returns how many were dropped. Undo
  // restores the pre-migration state as one history entry.
  function migrateCustomValuesForType(id: string, newType: string): number {
    let dropped = 0;
    for(const { store, write } of customValueStoreRefs()){
      if(!isRecord(store)) continue;
      if(!Object.prototype.hasOwnProperty.call(store, id)) continue;
      const safe = ownKeyRecord(store);
      if(safe !== store) write(safe);
      const migrated = coerceCustomValueForType(safe[id], newType);
      if(migrated === undefined){ delete safe[id]; dropped++; }
      else safe[id] = migrated;
    }
    return dropped;
  }
  function sanitizeCustomValues(input: unknown, typeById: Map<string, string>): Record<string, CustomAttributeValue> | undefined {
    if(!isRecord(input)) return undefined;
    const out: Record<string, CustomAttributeValue> = Object.create(null);
    let count = 0;
    for(const rawKey of Object.keys(input)){
      if(count >= CUSTOM_VALUE_KEYS_MAX) break;
      const key = String(rawKey).slice(0, 128);
      if(!key) continue;
      const type = typeById.get(key);
      if(type === undefined) continue; // value without a definition is dropped, not trusted
      const raw = Object.prototype.hasOwnProperty.call(input, rawKey) ? input[rawKey] : undefined;
      if(raw == null) continue;
      if(typeof raw === 'string' && raw.trim() === '') continue; // empty means unset
      out[key] = coerceCustomValue(raw, type);
      count++;
    }
    return count ? out : undefined;
  }
  function formatCustomValue(value: CustomAttributeValue): string {
    return typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
  }
  function definedCustomAttributes(scope: 'graph' | 'node' | 'edge'){
    return state.customAttributes.filter(attribute => attribute.scope === scope);
  }
  function customValueOf(target: CustomPropTarget, id: string): CustomAttributeValue | undefined {
    const store = customStoreOf(target);
    return isRecord(store) && Object.prototype.hasOwnProperty.call(store, id) ? store[id] : undefined;
  }
  function setCustomValue(target: CustomPropTarget, id: string, value: CustomAttributeValue): void {
    if(target === 'graph'){
      state.graphCustom = ownKeyRecord(state.graphCustom);
      state.graphCustom[id] = value;
      return;
    }
    if(isPendingDefaultsTarget(target)){
      const key = target === 'node-defaults' ? 'nodeCustom' : 'edgeCustom';
      if(!isRecord(state.settings)) state.settings = {};
      state.settings[key] = ownKeyRecord(state.settings[key]);
      state.settings[key][id] = value;
      return;
    }
    target.custom = ownKeyRecord(target.custom);
    target.custom[id] = value;
  }
  function unsetCustomValue(target: CustomPropTarget, id: string): void {
    const store = customStoreOf(target);
    if(isRecord(store)){
      delete store[id];
      // Entities drop their empty map so exported documents stay clean; the
      // graph and the pending-defaults maps keep their (possibly empty) shape.
      if(!isPendingDefaultsTarget(target) && target !== 'graph' && !Object.keys(store).length) delete target.custom;
    }
  }
  // Removing an attribute definition drops its values everywhere (they have no
  // meaning, and no UI to show them, without the definition). Undo restores both.
  function stripCustomAttributeValues(id: string): void {
    unsetCustomValue('graph', id);
    unsetCustomValue('node-defaults', id);
    unsetCustomValue('edge-defaults', id);
    for(const node of state.nodes) unsetCustomValue(node, id);
    for(const edge of state.edges) unsetCustomValue(edge, id);
  }
  // Enumerates every map that can hold custom-property values together with a
  // write-back for when it must be replaced by a safe (null-prototype) copy.
  function customValueStoreRefs(): { store: unknown; write: (safe: AnyRecord) => void }[] {
    const refs: { store: unknown; write: (safe: AnyRecord) => void }[] = [
      { store: state.graphCustom, write: safe => { state.graphCustom = safe; } },
      { store: isRecord(state.settings) ? state.settings.nodeCustom : undefined, write: safe => { if(isRecord(state.settings)) state.settings.nodeCustom = safe; } },
      { store: isRecord(state.settings) ? state.settings.edgeCustom : undefined, write: safe => { if(isRecord(state.settings)) state.settings.edgeCustom = safe; } },
    ];
    for(const n of state.nodes) refs.push({ store: n.custom, write: safe => { n.custom = Object.keys(safe).length ? safe : undefined; } });
    for(const e of state.edges) refs.push({ store: e.custom, write: safe => { e.custom = Object.keys(safe).length ? safe : undefined; } });
    return refs;
  }
  // ---- Scope changes -------------------------------------------------------
  // Scope decides WHERE values may live: graph scope keeps one value in
  // state.graphCustom; node/edge scope keeps per-entity values (entity.custom)
  // and a pending new-element default (settings.nodeCustom/edgeCustom). A
  // scope change therefore relocates one of:
  //   graph -> node/edge : lossless — the single graph value is promoted to
  //                        every entity lacking one (plus the pending default);
  //   node/edge -> graph : N values cannot collapse to 1 — the values are
  //                        discarded after explicit confirmation;
  //   node <-> edge      : values belong to the old entity type — same
  //                        confirmed-discard treatment. (Values are always one
  //                        undo step with the definition edit.)
  function countCustomAttributeValues(id: string, scope: 'graph' | 'node' | 'edge'): number {
    let count = 0;
    if(scope === 'graph'){
      if(isRecord(state.graphCustom) && Object.prototype.hasOwnProperty.call(state.graphCustom, id)) count++;
      return count;
    }
    const defaults = isRecord(state.settings) ? (scope === 'node' ? state.settings.nodeCustom : state.settings.edgeCustom) : undefined;
    if(isRecord(defaults) && Object.prototype.hasOwnProperty.call(defaults, id)) count++;
    for(const entity of (scope === 'node' ? state.nodes : state.edges)){
      if(isRecord(entity.custom) && Object.prototype.hasOwnProperty.call(entity.custom, id)) count++;
    }
    return count;
  }
  function promoteGraphCustomAttribute(id: string, scope: 'node' | 'edge'): void {
    if(!isRecord(state.graphCustom) || !Object.prototype.hasOwnProperty.call(state.graphCustom, id)) return;
    const value = state.graphCustom[id];
    const entities = scope === 'node' ? state.nodes : state.edges;
    for(const entity of entities){
      // Existing per-entity values are the oldest user data — keep them; the
      // graph value is promoted only to entities that lack one.
      if(isRecord(entity.custom) && Object.prototype.hasOwnProperty.call(entity.custom, id)) continue;
      const store = ownKeyRecord(entity.custom);
      store[id] = value;
      entity.custom = store;
    }
    if(!isRecord(state.settings)) state.settings = {};
    const key = scope === 'node' ? 'nodeCustom' : 'edgeCustom';
    const pending = ownKeyRecord(state.settings[key]);
    if(!Object.prototype.hasOwnProperty.call(pending, id)) pending[id] = value;
    state.settings[key] = pending;
    delete state.graphCustom[id];
  }
  function discardCustomAttributeValues(id: string, scope: 'graph' | 'node' | 'edge'): void {
    if(scope === 'graph'){ unsetCustomValue('graph', id); return; }
    const entities = scope === 'node' ? state.nodes : state.edges;
    for(const entity of entities) unsetCustomValue(entity, id);
    unsetCustomValue(scope === 'node' ? 'node-defaults' : 'edge-defaults', id);
  }
  // Renaming an attribute id moves its values with it, so the user does not
  // silently lose what they already typed.
  function renameCustomAttributeValues(oldId: string, newId: string): void {
    for(const { store, write } of customValueStoreRefs()){
      if(!isRecord(store)) continue;
      if(!Object.prototype.hasOwnProperty.call(store, oldId)) continue;
      const safe = ownKeyRecord(store);
      if(safe !== store) write(safe);
      safe[newId] = safe[oldId];
      delete safe[oldId];
    }
  }
  // Reads one entity-or-graph target and applies a raw control value to every
  // target. Returns 'ok' | 'noop' | 'invalid'. Empty text/number input unsets in
  // single mode and is a no-op in multi mode (so a blanked field cannot wipe a
  // whole selection); the boolean '__unset__' option unsets in multi mode.
  function applyCustomPropValue(def: { id: string; type: string }, targets: CustomPropTarget[], raw: string, multi: boolean): 'ok' | 'noop' | 'invalid' {
    const unsetAll = () => { for(const target of targets) unsetCustomValue(target, def.id); };
    const setAll = (value: CustomAttributeValue) => { for(const target of targets) setCustomValue(target, def.id, value); };
    if(def.type === 'boolean'){
      if(raw === ''){ if(multi) return 'noop'; unsetAll(); return 'ok'; }
      if(raw === '__unset__'){ unsetAll(); return 'ok'; }
      if(raw !== 'true' && raw !== 'false') return 'invalid';
      setAll(raw === 'true');
      return 'ok';
    }
    const text = raw.trim();
    if(text === ''){ if(multi) return 'noop'; unsetAll(); return 'ok'; }
    if(def.type === 'string'){ setAll(text.slice(0, CUSTOM_VALUE_MAX)); return 'ok'; }
    const numeric = Number(text);
    if(!Number.isFinite(numeric)) return 'invalid';
    const truncated = Math.trunc(numeric);
    // Out-of-range input is stored as the exact text (never silently clamped);
    // it round-trips unchanged and the field keeps showing what was typed.
    if(def.type === 'int' && (truncated < -2147483648 || truncated > 2147483647)) setAll(text.slice(0, CUSTOM_VALUE_MAX));
    else if(def.type === 'long' && Math.abs(truncated) > Number.MAX_SAFE_INTEGER) setAll(text.slice(0, CUSTOM_VALUE_MAX));
    else if(def.type === 'int' || def.type === 'long') setAll(truncated);
    else setAll(numeric); // float / double
    return 'ok';
  }
  // Whether every target holds the identical value (used to prefill single
  // controls and to detect "mixed" multi selections).
  function sharedCustomPropValue(targets: CustomPropTarget[], id: string): { value?: CustomAttributeValue; mixed: boolean } {
    const first = targets.length ? customValueOf(targets[0], id) : undefined;
    for(let i = 1; i < targets.length; i++){
      if(customValueOf(targets[i], id) !== first) return { value: undefined, mixed: true };
    }
    return { value: first, mixed: false };
  }
  // One row per attribute: an escaped label (id + type badge) and the typed
  // control. All user-visible text goes through esc()/I18N — attribute ids are
  // user input.
  function customPropControlHtml(attr: { id: string; type: string }, targets: CustomPropTarget[], multi: boolean): string {
    const { value, mixed } = sharedCustomPropValue(targets, attr.id);
    const safeId = esc(attr.id);
    const common = `class="custom-prop-input" data-custom-attribute="${safeId}" data-custom-type="${esc(attr.type)}" title="${esc(I18N.t('custom_prop_title'))}"`;
    if(attr.type === 'boolean'){
      const keepOption = multi ? `<option value="">${esc(I18N.t('keep'))}</option>` : `<option value="">${esc(I18N.t('custom_prop_unset'))}</option>`;
      const unsetOption = multi ? `<option value="__unset__">${esc(I18N.t('custom_prop_unset'))}</option>` : '';
      const trueSel = value === true && !mixed ? ' selected' : '';
      const falseSel = value === false && !mixed ? ' selected' : '';
      return `<select ${common}>${keepOption}${unsetOption}<option value="true"${trueSel}>true</option><option value="false"${falseSel}>false</option></select>`;
    }
    // Text inputs with a decimal/numeric inputmode, not type=number: a browser
    // number field silently reports "" for anything it cannot parse, which
    // would turn "clear the field" and "typed garbage" into the same action.
    // This way garbage reaches the handler, is rejected with a toast, and the
    // field reverts to the stored value.
    const isNumeric = attr.type !== 'string';
    const integer = attr.type === 'int' || attr.type === 'long';
    const shown = !mixed && value !== undefined ? esc(formatCustomValue(value)) : '';
    const placeholder = multi ? `placeholder="${esc(I18N.t('keep'))}" data-i18n-placeholder="keep"` : '';
    const maxlength = isNumeric ? ' maxlength="32"' : ` maxlength="${CUSTOM_VALUE_MAX}"`;
    return `<input type="text"${maxlength} ${common} value="${shown}" ${placeholder} inputmode="${integer ? 'numeric' : isNumeric ? 'decimal' : 'text'}" autocomplete="off" spellcheck="false">`;
  }
  function customPropsSectionHtml(scope: 'graph' | 'node' | 'edge', targets: CustomPropTarget[], multi: boolean): string {
    const defs = definedCustomAttributes(scope);
    if(!defs.length){
      return `<div class="custom-props custom-props-empty tiny muted" data-scope="${scope}">${esc(I18N.t('custom_prop_none'))}</div>`;
    }
    const rows = defs.map(attr => `
      <label class="field custom-prop-row"><span class="custom-prop-label"><span class="custom-prop-id">${esc(attr.id)}</span> <span class="custom-prop-type">${esc(attr.type)}</span></span>${customPropControlHtml(attr, targets, multi)}</label>`).join('');
    return `<div class="custom-props" data-scope="${scope}">${rows}</div>`;
  }
  // Wires the freshly built custom property controls (both the selection panel
  // and the graph values block rebuild their inputs before calling this).
  function wireCustomProps(host: ParentNode, scope: 'graph' | 'node' | 'edge', targets: CustomPropTarget[], multi: boolean){
    host.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`.custom-props[data-scope="${scope}"] .custom-prop-input`).forEach(input => {
      input.addEventListener('change', () => {
        const id = input.getAttribute('data-custom-attribute') || '';
        const def = state.customAttributes.find(attribute => attribute.id === id && attribute.scope === scope);
        if(!def) return;
        const result = applyCustomPropValue(def, targets, String(input.value ?? ''), multi);
        if(result === 'invalid'){ toast(I18N.t('attribute_invalid_number')); renderCustomPropHosts(); return; }
        if(result === 'noop') return;
        pushHistory('custom property'); queueRender(false); saveSoon();
      });
    });
  }
  // Repaint every surface that shows custom property values (cheap: just the
  // fields, not the canvas). Used after invalid input reverts and after def
  // edits re-render the data panel.
  function renderCustomPropHosts(){
    renderGraphCustomProps();
    renderNewElementCustomProps();
    renderSelectionPanel();
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

    const customAttributeTypes = ['boolean','int','long','float','double','string'];
    // Pre-scan: every id present in the input — as a definition or as a key of
    // Definition ids are stable in the editor, so graphs match properties by
    // them across imports and reloads. Two definitions cannot share an id —
    // values are keyed by id alone — so duplicates in a saved document are
    // collapsed first-wins, whatever scope they claim. (The import paths, not
    // the load path, handle id conflicts from files with separate namespaces.)
    const customAttributeIds = new Set<string>();
    const customAttributes = (Array.isArray(source.customAttributes) ? source.customAttributes : [])
      .slice(0, CUSTOM_DEFINITIONS_MAX).filter(isRecord).map(attribute => {
        const id = String(attribute.id ?? '').trim().slice(0, 128);
        const scope = ['graph','node','edge'].includes(String(attribute.scope)) ? attribute.scope : null;
        const type = customAttributeTypes.includes(String(attribute.type)) ? String(attribute.type) : 'string';
        if(!id || !scope) return null;
        if(customAttributeIds.has(id)) return null; // first wins
        customAttributeIds.add(id);
        // Keep the attr.name the importer recorded (original spelling) so a
        // re-created definition still exports under the property name it was
        // read with.
        const rawName = String((attribute as AnyRecord).name ?? '').trim().slice(0, 128);
        const out: AnyRecord = {id, scope, type};
        if(rawName && rawName !== id) out.name = rawName;
        return out as GraphState['customAttributes'][number];
      }).filter(Boolean) as GraphState['customAttributes'];
    const customAttributeTypeById = customAttributeTypeMap(customAttributes);
    // New-element defaults sanitize against their own scope's definitions only.
    const nodeDefaultTypeById = customAttributeTypeMap(customAttributes.filter(a => a.scope === 'node'));
    const edgeDefaultTypeById = customAttributeTypeMap(customAttributes.filter(a => a.scope === 'edge'));

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
      const customValues = sanitizeCustomValues(n.custom, customAttributeTypeById);
      if(customValues) node.custom = customValues;
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
      const dir = normalizeDirection((e as any).direction ?? (e as any).directed);
      const edge: GraphEdge = {
        id: uniqueSafeId(e.id || ('e' + (i + 1)), 'e', usedEdgeIds),
        from, to,
        label: String(e.label ?? '').slice(0,80),
        directed: dir as any, // legacy boolean compat: keep truthy for directed/mutual
        direction: dir,
        type: String(e.type || '').slice(0,40)
      };
      // Keep legacy directed boolean in sync (true = directed/mutual, false = undirected) for old exports
      (edge as any).directed = dir !== 'undirected';
      if(e.weight != null && e.weight !== '') edge.weight = String(e.weight).slice(0,50);
      if(e.color) edge.color = validColor(e.color) || '';
      if(e.strokeSize != null) edge.strokeSize = clamp(finite(e.strokeSize, 2.4), 0, 20);
      if(e.strokeStyle) edge.strokeStyle = validStroke(e.strokeStyle);
      if(e.arrowSize != null) edge.arrowSize = clamp(finite(e.arrowSize, DEFAULT_ARROW_SIZE), ARROW_SIZE_MIN, ARROW_SIZE_MAX);
      if(e.labelColor) edge.labelColor = validColor(e.labelColor) || '';
      if(e.labelSize != null) edge.labelSize = clamp(finite(e.labelSize, 12), 4, 72);
      if(e.labelFont) edge.labelFont = String(e.labelFont).slice(0, 60);
      const customValues = sanitizeCustomValues(e.custom, customAttributeTypeById);
      if(customValues) edge.custom = customValues;
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
    settings.edgeArrowSize = clamp(finite(settings.edgeArrowSize, DEFAULT_ARROW_SIZE), ARROW_SIZE_MIN, ARROW_SIZE_MAX);
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
    ed.arrowSize = clamp(finite(ed.arrowSize, DEFAULT_ARROW_SIZE), ARROW_SIZE_MIN, ARROW_SIZE_MAX);
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
        if(ts.arrowSize != null) out.arrowSize = clamp(finite(ts.arrowSize, DEFAULT_ARROW_SIZE), ARROW_SIZE_MIN, ARROW_SIZE_MAX);
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
    // QVGE: edge direction default is directed/mutual/undirected (string); keep boolean legacy
    // Prefer explicit inputSettings values over merged defaults so legacy
    // documents like { directed:false } (without direction) are not masked by
    // the base default direction='directed'.
    const dirRawInput = (inputSettings as any).direction ?? (inputSettings as any).directed;
    const dirRaw = dirRawInput !== undefined ? dirRawInput : ((settings as any).direction ?? settings.directed);
    const dirNorm = normalizeDirection(dirRaw);
    settings.direction = dirNorm;
    settings.directed = dirNorm !== 'undirected';
    settings.snap = Boolean(settings.snap); settings.snapX = Boolean(settings.snapX); settings.snapY = Boolean(settings.snapY); settings.autosave = settings.autosave !== false;
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
          if(se.arrowSize != null) out.edge.arrowSize = clamp(finite(se.arrowSize, DEFAULT_ARROW_SIZE), ARROW_SIZE_MIN, ARROW_SIZE_MAX);
          if(validColor(se.labelColor)) out.edge.labelColor = se.labelColor;
          if(se.labelSize != null) out.edge.labelSize = clamp(finite(se.labelSize, 12), 4, 72);
          if(se.labelFont) out.edge.labelFont = String(se.labelFont).slice(0, 60);
        }
        return out;
      }).filter(Boolean);
    } else { settings.stylePresets = []; }
    const graphCustom = sanitizeCustomValues(source.graphCustom, customAttributeTypeById) || Object.create(null);
    settings.nodeCustom = sanitizeCustomValues(inputSettings.nodeCustom, nodeDefaultTypeById) || Object.create(null);
    settings.edgeCustom = sanitizeCustomValues(inputSettings.edgeCustom, edgeDefaultTypeById) || Object.create(null);
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
      nodes, edges, customAttributes, graphCustom, settings,
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
