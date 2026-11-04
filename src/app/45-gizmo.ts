  // === Selection transform gizmo ================================
  // Translate / rotate / scale / rect handles for the current selection.
  // This module owns gizmo preferences, rendering, gestures and keyboard
  // nudging. Other files keep only the unavoidable integration hooks:
  // render/status/selection notifications, pointermove/pointerup routing,
  // and button/hotkey wiring.
  //
  // Contract: every transform writes ONLY target node x/y. Node width,
  // height, shape, labels, colours and every edge record stay untouched;
  // connected edges follow through the ordinary live-edge drag path.
  //
  // Tool + visibility are editor UI preferences, not document data. They
  // live in localStorage so exports, autosaves and undo/redo snapshots do
  // not carry them, and toggling visibility cannot create a history step.
  const GIZMO_PREF_KEY = 'graph-editor-pro-gizmo';
  const GIZMO_TOOLS: GizmoTool[] = ['move','rotate','scale','rect'];
  let gizmoTool: GizmoTool = 'move';
  let gizmoEnabled = true;
  let gizmoPrefsStored = false;
  let gizmoDrag: any = null;

  function loadGizmoPreferences(){
    try {
      const raw = localStorage.getItem(GIZMO_PREF_KEY);
      if(raw == null) return;
      const saved = JSON.parse(raw);
      if(!isRecord(saved)) return;
      gizmoPrefsStored = true;
      if(GIZMO_TOOLS.includes(saved.tool as GizmoTool)) gizmoTool = saved.tool as GizmoTool;
      gizmoEnabled = saved.enabled !== false;
    } catch { /* storage may be unavailable; defaults remain in force */ }
  }
  loadGizmoPreferences();

  function persistGizmoPreferences(){
    gizmoPrefsStored = true;
    try { localStorage.setItem(GIZMO_PREF_KEY, JSON.stringify({tool: gizmoTool, enabled: gizmoEnabled})); } catch { /* ignore */ }
  }
  // PR #23's first version stored these fields in the autosaved document.
  // When a user upgrades, adopt them once into the UI-preference key; new
  // snapshots never write them back into the graph.
  function migrateLegacyGizmoPreferences(source: unknown){
    if(gizmoPrefsStored || !isRecord(source)) return;
    let found = false;
    if(GIZMO_TOOLS.includes(source.gizmoTool as GizmoTool)){
      gizmoTool = source.gizmoTool as GizmoTool;
      found = true;
    }
    if(isRecord(source.settings) && typeof source.settings.gizmoEnabled === 'boolean'){
      gizmoEnabled = source.settings.gizmoEnabled;
      found = true;
    }
    if(found) persistGizmoPreferences();
  }

  function gizmoToolLabel(tool: GizmoTool = gizmoTool): string {
    return I18N.t('gizmo_' + tool + '_label');
  }
  function syncGizmoControls(targetCount?: number){
    $$('[data-gizmotool]').forEach(b => {
      const active = b.dataset.gizmotool === gizmoTool;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    const opt = document.getElementById('optGizmo') as HTMLInputElement | null;
    if(opt && opt.checked !== gizmoEnabled) opt.checked = gizmoEnabled;
    const readout = document.getElementById('gizmoReadout');
    if(!readout) return;
    let text: string;
    if(!gizmoEnabled) text = I18N.t('gizmo_hidden');
    else if(gizmoDrag?.readout) text = `${gizmoToolLabel(gizmoDrag.tool)} · ${gizmoDrag.readout}`;
    else {
      const n = targetCount ?? gizmoTargetNodes().length;
      text = n ? I18N.t('gizmo_active', {mode: gizmoToolLabel(), n}) : I18N.t('gizmo_no_selection');
    }
    setText(readout, text);
  }
  function setGizmoTool(tool: string, render = true){
    if(gizmoDrag) return; // never swap tools underneath a live gizmo gesture
    const next: GizmoTool = GIZMO_TOOLS.includes(tool as GizmoTool) ? tool as GizmoTool : 'move';
    if(next !== gizmoTool){ gizmoTool = next; persistGizmoPreferences(); }
    syncGizmoControls();
    if(render){ renderGizmo(); setStatusOnly(); }
  }
  function setGizmoEnabled(enabled: boolean, render = true){
    const next = Boolean(enabled);
    if(!next && gizmoDrag) endGizmoDrag(false); // hiding mid-gesture cancels it
    if(next !== gizmoEnabled){ gizmoEnabled = next; persistGizmoPreferences(); }
    syncGizmoControls();
    if(render){ renderGizmo(); setStatusOnly(); }
  }

  // === Gizmo rendering ===
  // Translate / rotate / scale / rect handles drawn around the selection in
  // Select mode. Every gizmo tool rewrites ONLY node x/y positions — node
  // sizes, shapes and all other visual parameters are never touched (the
  // node bodies simply ride their translate() to the new spots, exactly
  // like a node drag). Handles are sized in screen pixels converted to
  // world units, so they keep a constant on-screen size at any zoom; the
  // layer rides the camera matrix with the rest of the scene, so pan and
  // zoom previews need no gizmo work at all.
  let gizmoSig = '';
  let gizmoRootEl: any = null;
  let gizmoAnchor: { id:string; x:number; y:number } | null = null;
  let gizmoPivot: { x:number; y:number } | null = null; // user-dragged pivot override
  let gizmoPivotKey = ''; // selection id-set the override belongs to
  // The nodes a gizmo gesture acts on: the selected nodes, or — when only
  // edges are selected — those edges' endpoints, so an edge selection can
  // be moved/rotated as a unit too.
  function gizmoTargetNodes(){
    let nodes = [...selectedNodeIds()].map(nodeById).filter(Boolean);
    if(!nodes.length){
      const ids = new Set<string>();
      for(const id of selectedEdgeIds()){ const e = edgeById(id); if(e){ ids.add(e.from); ids.add(e.to); } }
      nodes = [...ids].map(nodeById).filter(Boolean);
    }
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    if(vr.start >= 0 || vr.end >= 0){ const vis = visibleNodeIds(); nodes = nodes.filter(n => vis.has(n.id)); }
    return nodes;
  }
  function gizmoWorldPerPixel(){
    const r = pointerRect || svg.getBoundingClientRect();
    const s = (r && r.width) ? Math.min(r.width / state.viewBox.w, r.height / state.viewBox.h) : 0;
    return s > 0 ? 1 / s : state.viewBox.w / 1000;
  }
  // Bounds of the node bodies (centres ± half size), i.e. the frame the rect
  // gizmo stretches and the centre the other tools pivot around by default.
  function gizmoNodeBounds(nodes){
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for(const n of nodes){
      const v = nodeVisualC(n);
      const hw = (v.width || 50) / 2, hh = (v.height || 50) / 2;
      if(n.x - hw < minX) minX = n.x - hw;
      if(n.y - hh < minY) minY = n.y - hh;
      if(n.x + hw > maxX) maxX = n.x + hw;
      if(n.y + hh > maxY) maxY = n.y + hh;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }
  function gizmoEl(name, attrs=null, cls=null){
    const el: any = document.createElementNS(NS, name);
    if(cls) el.setAttribute('class', cls);
    if(attrs) for(const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function renderGizmo(){
    const wrap = $('#canvasWrap');
    const show = state.mode === 'select' && gizmoEnabled && !selectDraft && !edgeDraft && !pinch && !pan;
    const nodes = show ? gizmoTargetNodes() : [];
    syncGizmoControls(nodes.length);
    if(!nodes.length){
      if(gizmoSig){ gizmoLayer.textContent = ''; gizmoSig = ''; gizmoRootEl = null; gizmoAnchor = null; }
      wrap.classList.toggle('gizmo-active', false);
      return;
    }
    const b = gizmoNodeBounds(nodes);
    const key = nodes.map(n => n.id).join(',');
    if(key !== gizmoPivotKey){ gizmoPivot = null; gizmoPivotKey = key; }
    const P = gizmoPivot || {x:b.cx, y:b.cy};
    const u = gizmoWorldPerPixel(); // world units per screen pixel
    const tool: GizmoTool = gizmoTool;
    const active = gizmoDrag?.handle || '';
    const pointer = gizmoDrag?.pointer;
    const sig = [tool, key, P.x, P.y, b.minX, b.minY, b.maxX, b.maxY, u.toFixed(4), active,
      gizmoDrag?.readout || '', pointer ? Math.round(pointer.x) + ',' + Math.round(pointer.y) : ''].join('|');
    wrap.classList.toggle('gizmo-active', true);
    if(sig === gizmoSig) return;
    gizmoSig = sig;
    gizmoAnchor = { id: nodes[0].id, x: nodes[0].x, y: nodes[0].y };
    gizmoLayer.textContent = '';
    const root = gizmoEl('g', null, 'gizmo-root');
    gizmoRootEl = root;
    gizmoLayer.appendChild(root);
    const handle = (kind: string) => {
      const g = gizmoEl('g', {'data-gizmo': kind}, 'gizmo-handle' + (active === kind ? ' active' : ''));
      root.appendChild(g);
      return g;
    };
    const armLen = 52 * u, armStart = 11 * u;
    let topY = b.minY;

    if(tool === 'rect'){
      root.appendChild(gizmoEl('rect', {x:b.minX, y:b.minY, width:b.w, height:b.h}, 'gizmo-rectbox'));
      const hit = 7 * u, box = 11 * u, boxHit = 21 * u;
      const edges: Array<[string, number, number, number, number, number, number]> = [
        ['rect-n', b.minX, b.minY, b.maxX, b.minY, b.cx, b.minY],
        ['rect-e', b.maxX, b.minY, b.maxX, b.maxY, b.maxX, b.cy],
        ['rect-s', b.minX, b.maxY, b.maxX, b.maxY, b.cx, b.maxY],
        ['rect-w', b.minX, b.minY, b.minX, b.maxY, b.minX, b.cy],
      ];
      for(const [kind, x1, y1, x2, y2, hx, hy] of edges){
        const g = handle(kind);
        g.appendChild(gizmoEl('line', {x1, y1, x2, y2, 'stroke-width': 2 * hit}, 'gizmo-hit-stroke'));
        g.appendChild(gizmoEl('rect', {x:hx - boxHit/2, y:hy - boxHit/2, width:boxHit, height:boxHit}, 'gizmo-hit'));
        g.appendChild(gizmoEl('rect', {x:hx - box/2, y:hy - box/2, width:box, height:box}, 'gizmo-handle-box gizmo-box-accent gizmo-vis'));
      }
      const corners: Array<[string, number, number]> = [
        ['rect-nw', b.minX, b.minY], ['rect-ne', b.maxX, b.minY],
        ['rect-se', b.maxX, b.maxY], ['rect-sw', b.minX, b.maxY],
      ];
      for(const [kind, hx, hy] of corners){
        const g = handle(kind);
        g.appendChild(gizmoEl('rect', {x:hx - boxHit/2, y:hy - boxHit/2, width:boxHit, height:boxHit}, 'gizmo-hit'));
        g.appendChild(gizmoEl('rect', {x:hx - box/2, y:hy - box/2, width:box, height:box}, 'gizmo-handle-box gizmo-box-accent gizmo-vis'));
      }
      const centre = handle('rect-move');
      centre.appendChild(gizmoEl('circle', {cx:b.cx, cy:b.cy, r:13 * u}, 'gizmo-hit'));
      centre.appendChild(gizmoEl('rect', {x:b.cx - box/2, y:b.cy - box/2, width:box, height:box}, 'gizmo-handle-box gizmo-box-accent gizmo-vis'));
    } else if(tool === 'rotate'){
      // Fixed on-screen ring around the pivot (not a ring enclosing the
      // whole selection): the drag is angular, so the ring size does not
      // affect the math, and a constant-size ring never leaves the canvas
      // for large selections.
      const Rr = 72 * u;
      topY = P.y - Rr; // readout rides the ring, not the (rotating) bounds
      const ring = handle('rotate');
      ring.appendChild(gizmoEl('circle', {cx:P.x, cy:P.y, r:Rr, 'stroke-width': 18 * u}, 'gizmo-hit-stroke'));
      ring.appendChild(gizmoEl('circle', {cx:P.x, cy:P.y, r:Rr}, 'gizmo-ring gizmo-vis'));
      const a = (gizmoDrag?.tool === 'rotate' && pointer) ? Math.atan2(pointer.y - P.y, pointer.x - P.x) : -Math.PI / 2;
      const hx = P.x + Math.cos(a) * Rr, hy = P.y + Math.sin(a) * Rr;
      if(gizmoDrag?.tool === 'rotate') ring.appendChild(gizmoEl('line', {x1:P.x, y1:P.y, x2:hx, y2:hy}, 'gizmo-spoke gizmo-vis'));
      ring.appendChild(gizmoEl('circle', {cx:hx, cy:hy, r:6.5 * u}, 'gizmo-handle-box gizmo-box-amber gizmo-vis'));
    } else {
      // move & scale share the axis arms; they differ in the end handles.
      root.appendChild(gizmoEl('rect', {x:b.minX, y:b.minY, width:b.w, height:b.h}, 'gizmo-bounds'));
      const axisHandle = (kind: string, dx: number, dy: number, axisCls: string, boxCls: string, label: string) => {
        const g = handle(kind);
        const ex = P.x + dx * armLen, ey = P.y + dy * armLen;
        g.appendChild(gizmoEl('line', {x1:P.x + dx * armStart, y1:P.y + dy * armStart, x2:ex, y2:ey, 'stroke-width': 16 * u}, 'gizmo-hit-stroke'));
        g.appendChild(gizmoEl('line', {x1:P.x + dx * armStart, y1:P.y + dy * armStart, x2:ex, y2:ey}, 'gizmo-axis ' + axisCls + ' gizmo-vis'));
        if(tool === 'move'){
          const al = 12 * u, aw = 5 * u;
          const tipX = P.x + dx * (armLen + al), tipY = P.y + dy * (armLen + al);
          const pts = `${tipX},${tipY} ${ex - dy * aw},${ey + dx * aw} ${ex + dy * aw},${ey - dx * aw}`;
          g.appendChild(gizmoEl('circle', {cx:ex + dx * al / 2, cy:ey + dy * al / 2, r: 11 * u}, 'gizmo-hit'));
          g.appendChild(gizmoEl('polygon', {points: pts}, 'gizmo-arrow-' + (dx ? 'x' : 'y') + ' gizmo-vis'));
          const t = gizmoEl('text', {x: tipX + dx * 9 * u - (dy ? 3 * u : 0), y: tipY + dy * 12 * u + (dx ? 4 * u : 0), 'font-size': 11 * u, fill: dx ? '#fb7185' : '#4ade80'}, 'gizmo-axis-label');
          t.textContent = label;
          g.appendChild(t);
        } else {
          const box = 13 * u;
          g.appendChild(gizmoEl('rect', {x:ex - 11 * u, y:ey - 11 * u, width:22 * u, height:22 * u}, 'gizmo-hit'));
          g.appendChild(gizmoEl('rect', {x:ex - box/2, y:ey - box/2, width:box, height:box}, 'gizmo-handle-box ' + boxCls + ' gizmo-vis'));
        }
        return g;
      };
      axisHandle(tool === 'move' ? 'move-x' : 'scale-x', 1, 0, 'gizmo-axis-x', 'gizmo-box-x', 'x');
      axisHandle(tool === 'move' ? 'move-y' : 'scale-y', 0, 1, 'gizmo-axis-y', 'gizmo-box-y', 'y');
      const centre = handle(tool === 'move' ? 'move-free' : 'scale-uniform');
      centre.appendChild(gizmoEl('circle', {cx:P.x, cy:P.y, r:13 * u}, 'gizmo-hit'));
      if(tool === 'move'){
        centre.appendChild(gizmoEl('circle', {cx:P.x, cy:P.y, r:7.5 * u}, 'gizmo-handle-box gizmo-box-accent gizmo-vis'));
      } else {
        const box = 14 * u;
        centre.appendChild(gizmoEl('rect', {x:P.x - box/2, y:P.y - box/2, width:box, height:box}, 'gizmo-handle-box gizmo-box-accent gizmo-vis'));
      }
    }

    // Pivot: marker for every tool; directly draggable in rotate/scale/rect
    // (in move/rect the centre handle already owns that spot, so the small
    // dot on top of it is the pivot grab). Double-click resets to centre.
    if(tool === 'rotate' || tool === 'scale' || tool === 'rect'){
      const pv = handle('pivot');
      const title = gizmoEl('title'); title.textContent = I18N.t('gizmo_pivot'); pv.appendChild(title);
      // In scale/rect the pivot sits inside the centre handle: keep its hit
      // area to the dot itself so the centre handle stays grabbable around it.
      pv.appendChild(gizmoEl('circle', {cx:P.x, cy:P.y, r:(tool === 'rotate' ? 11 : 7) * u}, 'gizmo-hit'));
      pv.appendChild(gizmoEl('circle', {cx:P.x, cy:P.y, r:6 * u}, 'gizmo-pivot-ring gizmo-vis'));
      pv.appendChild(gizmoEl('circle', {cx:P.x, cy:P.y, r:2 * u}, 'gizmo-pivot-dot gizmo-vis'));
    } else {
      root.appendChild(gizmoEl('circle', {cx:P.x, cy:P.y, r:6 * u}, 'gizmo-pivot-ring gizmo-vis'));
    }
    if(gizmoDrag?.readout){
      const t = gizmoEl('text', {x: tool === 'rect' ? b.cx : P.x, y: topY - 10 * u, 'font-size': 12.5 * u}, 'gizmo-readout');
      t.textContent = gizmoDrag.readout;
      root.appendChild(t);
    }
  }
  // Integration hook for moveDragFast: a plain node/group drag translates
  // every gizmo target by the same delta, so the existing overlay can follow
  // with one transform write instead of a rebuild. Gizmo gestures pass their
  // own drag object and rebuild via renderGizmo.
  function followGizmoForPlainDrag(src: any){
    if(!gizmoRootEl || !gizmoAnchor || src === gizmoDrag) return;
    const anchorNode = nodeById(gizmoAnchor.id);
    if(anchorNode) setAttr(gizmoRootEl, 'transform', `translate(${anchorNode.x - gizmoAnchor.x},${anchorNode.y - gizmoAnchor.y})`);
  }

  // === Gizmo gestures ===
  // A gizmo gesture captures every target node's start position once, then
  // recomputes positions from those starts on every pointermove, so a drag
  // never accumulates drift and Escape can restore the gesture exactly.
  // Only node x/y are written — widths, heights, shapes and every other
  // visual parameter stay untouched; connected edges follow through the
  // same live-edge fast path node drags use (moveDragFast).
  let gizmoFrame = false;
  function scheduleGizmoFrame(){
    if(gizmoFrame) return;
    gizmoFrame = true;
    requestAnimationFrame(() => {
      gizmoFrame = false;
      if(!gizmoDrag) return;
      if(gizmoDrag.handle !== 'pivot') moveDragFast(gizmoDrag);
      renderGizmo();
      setText($('#statusPill'), statusText()); // readout only; full command sync happens at gesture ends
    });
  }
  function onGizmoPointerDown(ev){
    const handleEl = (ev.target as Element)?.closest?.('[data-gizmo]') as HTMLElement | null;
    if(!handleEl) return;
    // Let pan/polygon/other in-flight gestures keep the pointer: the gizmo
    // only claims a fresh primary-button press in Select mode.
    if(state.mode !== 'select' || spaceDown || selectDraft || drag || gizmoDrag || pinch || pan) return;
    ev.preventDefault(); ev.stopPropagation();
    svg.focus();
    try{ svg.setPointerCapture(ev.pointerId); }catch{}
    registerPointer(ev);
    if(ev.button === 1 || ev.button === 2){ pendingEdgeFrom = null; startPan(ev); return; }
    if(ev.button !== 0) return;
    if(maybeStartPinch()) return;
    const nodes = gizmoTargetNodes();
    if(!nodes.length) return;
    const p = pointFromEvent(ev);
    const bounds = gizmoNodeBounds(nodes);
    const key = nodes.map(n => n.id).join(',');
    if(key !== gizmoPivotKey){ gizmoPivot = null; gizmoPivotKey = key; }
    const pivot = gizmoPivot ? {...gizmoPivot} : {x:bounds.cx, y:bounds.cy};
    const nodeIdSet = new Set<string>(nodes.map(n => n.id));
    const affectedEdges = state.edges.filter(e => nodeIdSet.has(e.from) || nodeIdSet.has(e.to));
    gizmoDrag = {
      pointerId: ev.pointerId, handle: handleEl.dataset.gizmo || '', tool: gizmoTool,
      nodes, starts: new Map(nodes.map(n => [n.id, {x:n.x, y:n.y}])),
      nodeIdSet, pivot, bounds, startPointer: p, pointer: p,
      unit: gizmoWorldPerPixel(),
      startAngle: Math.atan2(p.y - pivot.y, p.x - pivot.x),
      startDist: Math.hypot(p.x - pivot.x, p.y - pivot.y),
      pivotWas: gizmoPivot ? {...gizmoPivot} : null,
      moved: false, readout: '', affectedEdges,
      liveEdges: affectedEdges.length <= DRAG_LIVE_EDGE_LIMIT, vc: null,
      historyLabel: 'gizmo ' + gizmoTool
    };
    gestureActive = true;
    if(gizmoDrag.handle !== 'pivot') for(const n of nodes){ const el = nodeEl(n.id); if(el) toggleClass(el, 'dragging', true); }
    $('#canvasWrap').classList.add('fast-interaction');
    renderGizmo();
    setStatusOnly();
  }
  function gizmoSafeRatio(num, den){ return Math.abs(den) > 1e-9 ? num / den : 1; }
  function updateGizmoDrag(p, ev){
    const g = gizmoDrag; if(!g) return;
    g.pointer = p;
    const P = g.pivot, S = g.startPointer;
    const apply = (fn) => { for(const n of g.nodes){ const s = g.starts.get(n.id); const q = fn(s); n.x = q.x; n.y = q.y; } };
    if(g.handle === 'pivot'){
      // Snap onto a node centre when close (rotate around that node), else
      // run through the ordinary snap settings (grid / X / Y alignment).
      let best = null, bestD = snapThresholdWorld();
      for(const n of state.nodes){ const d = Math.hypot(n.x - p.x, n.y - p.y); if(d <= bestD){ best = n; bestD = d; } }
      gizmoPivot = best ? {x:best.x, y:best.y} : snapPointToEnabled(p.x, p.y, null);
      g.moved = true;
      g.readout = `${Math.round(gizmoPivot.x)}, ${Math.round(gizmoPivot.y)}`;
      scheduleGizmoFrame();
      return;
    }
    if(g.handle === 'move-free' || g.handle === 'rect-move' || g.handle === 'move-x' || g.handle === 'move-y'){
      // Snapping applies to the gizmo origin; every node rides the same delta.
      const snapped = snapPointToEnabled(P.x + (p.x - S.x), P.y + (p.y - S.y), g.nodeIdSet);
      let dx = snapped.x - P.x, dy = snapped.y - P.y;
      if(g.handle === 'move-x') dy = 0;
      if(g.handle === 'move-y') dx = 0;
      apply(s => ({x: s.x + dx, y: s.y + dy}));
      g.readout = `Δ ${Math.round(dx)}, ${Math.round(dy)}`;
    } else if(g.handle === 'rotate'){
      // Sitting exactly on the pivot has no angle; keep the last frame's
      // positions instead of snapping to atan2(0, 0).
      if(Math.hypot(p.x - P.x, p.y - P.y) < 1e-6){ scheduleGizmoFrame(); return; }
      let ang = Math.atan2(p.y - P.y, p.x - P.x) - g.startAngle;
      if(ev.shiftKey){ const step = Math.PI / 12; ang = Math.round(ang / step) * step; }
      const cos = Math.cos(ang), sin = Math.sin(ang);
      apply(s => { const dx = s.x - P.x, dy = s.y - P.y; return {x: P.x + dx * cos - dy * sin, y: P.y + dx * sin + dy * cos}; });
      let deg = ang * 180 / Math.PI;
      while(deg > 180) deg -= 360;
      while(deg <= -180) deg += 360;
      g.readout = `${deg.toFixed(1)}°`;
    } else if(g.handle === 'scale-uniform' || g.handle === 'scale-x' || g.handle === 'scale-y'){
      let fx = 1, fy = 1;
      if(g.handle === 'scale-uniform'){
        // Radial drag distance maps linearly: 120 px out from the grab point doubles the spread.
        fx = fy = clamp(1 + (Math.hypot(p.x - P.x, p.y - P.y) - g.startDist) / (120 * g.unit), 0.05, 20);
      } else if(g.handle === 'scale-x'){
        fx = clamp(gizmoSafeRatio(p.x - P.x, S.x - P.x), -20, 20);
        if(ev.shiftKey) fy = fx;
      } else {
        fy = clamp(gizmoSafeRatio(p.y - P.y, S.y - P.y), -20, 20);
        if(ev.shiftKey) fx = fy;
      }
      apply(s => ({x: P.x + (s.x - P.x) * fx, y: P.y + (s.y - P.y) * fy}));
      g.readout = fx === fy ? `×${fx.toFixed(2)}` : `×${fx.toFixed(2)} · ×${fy.toFixed(2)}`;
    } else if(g.handle.startsWith('rect-')){
      // Stretch the start-of-gesture bounds: the dragged edge/corner follows
      // the pointer, the opposite side stays anchored (Alt: centre anchored,
      // both sides move). A factor per axis maps start positions into the
      // new frame — node bodies keep their own sizes, only centres move.
      const B = g.bounds, dir = g.handle.slice(5);
      const hasX = dir.includes('e') || dir.includes('w');
      const hasY = dir.includes('n') || dir.includes('s');
      const ax = ev.altKey ? B.cx : (dir.includes('e') ? B.minX : dir.includes('w') ? B.maxX : B.cx);
      const ay = ev.altKey ? B.cy : (dir.includes('s') ? B.minY : dir.includes('n') ? B.maxY : B.cy);
      const hx = dir.includes('e') ? B.maxX : dir.includes('w') ? B.minX : B.cx;
      const hy = dir.includes('s') ? B.maxY : dir.includes('n') ? B.minY : B.cy;
      let fx = hasX ? clamp(gizmoSafeRatio(p.x - ax, hx - ax), -20, 20) : 1;
      let fy = hasY ? clamp(gizmoSafeRatio(p.y - ay, hy - ay), -20, 20) : 1;
      if(ev.shiftKey && hasX && hasY){ const f = Math.abs(fx - 1) >= Math.abs(fy - 1) ? fx : fy; fx = f; fy = f; }
      apply(s => ({x: ax + (s.x - ax) * fx, y: ay + (s.y - ay) * fy}));
      g.readout = `${Math.round(B.w * Math.abs(fx))} × ${Math.round(B.h * Math.abs(fy))}`;
    }
    g.moved = false;
    for(const n of g.nodes){
      const s = g.starts.get(n.id);
      if(Math.abs(n.x - s.x) > 0.01 || Math.abs(n.y - s.y) > 0.01){ g.moved = true; break; }
    }
    scheduleGizmoFrame();
  }
  function endGizmoDrag(commit = true){
    const g = gizmoDrag; if(!g) return;
    gizmoDrag = null;
    if(g.handle === 'pivot'){
      if(!commit) gizmoPivot = g.pivotWas;
    } else {
      if(!commit) for(const n of g.nodes){ const s = g.starts.get(n.id); n.x = s.x; n.y = s.y; }
      moveDragFast(g); // flush the final/restored frame synchronously
      for(const n of g.nodes){ const el = nodeEl(n.id); if(el) toggleClass(el, 'dragging', false); }
      if(commit && g.moved){ pushHistory(g.historyLabel); renderSidebar(); }
      if(commit && g.moved && !g.liveEdges) queueRender(false);
    }
    $('#canvasWrap').classList.remove('fast-interaction');
    gestureActive = false;
    renderGizmo();
    setStatusOnly();
  }
  // Keyboard counterpart of the translate gizmo: shift every gizmo target
  // node by a fixed step, through the same live-edge fast path.
  function nudgeSelection(dx, dy){
    const nodes = gizmoTargetNodes();
    if(!nodes.length) return false;
    for(const n of nodes){ n.x += dx; n.y += dy; }
    const idSet = new Set<string>(nodes.map(n => n.id));
    const affectedEdges = state.edges.filter(e => idSet.has(e.from) || idSet.has(e.to));
    const liveEdges = affectedEdges.length <= DRAG_LIVE_EDGE_LIMIT;
    moveDragFast({ nodes, affectedEdges, liveEdges, vc: null });
    pushHistory('nudge selection');
    if(!liveEdges) queueRender(false);
    renderGizmo();
    renderSidebar();
    return true;
  }
  gizmoLayer.addEventListener('pointerdown', onGizmoPointerDown);
  gizmoLayer.addEventListener('dblclick', ev => {
    if(!(ev.target as Element)?.closest?.('[data-gizmo="pivot"]')) return;
    ev.preventDefault(); ev.stopPropagation();
    gizmoPivot = null;
    renderGizmo();
  });
