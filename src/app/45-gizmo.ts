  // === Transform gizmo =====================================================
  // A classic editor gizmo (translate / rotate / scale / rect) for the current
  // node selection. The important contract: every gesture writes ONLY the x/y
  // of the selected nodes. No width, height, shape, label, colour, font, type,
  // order or edge property is ever read for writing, so visual parameters of
  // individual parts cannot change. Node radii are read (read-only) to size the
  // bounding box; the box itself is an overlay, never graph data.
  //
  // The layer is inside #sceneLayer, i.e. inside the composited camera group,
  // so it pans/zooms with the graph for free. Handles are sized in world units
  // derived from the current camera scale, which keeps them a constant number
  // of screen pixels. Only small hit shapes accept pointer input: nodes under
  // the box remain selectable/draggable in the ordinary way.

  type GizmoMode = 'off' | 'translate' | 'rotate' | 'scale' | 'rect';
  const GIZMO_MODES: GizmoMode[] = ['off', 'translate', 'rotate', 'scale', 'rect'];
  const GIZMO_PREF_KEY = 'graph-editor-pro-gizmo-mode';
  const GIZMO_MIN_SCALE = 0.05;
  const GIZMO_MAX_SCALE = 20;
  const GIZMO_ROTATE_STEP = Math.PI / 12; // 15 degrees while Shift is held
  const GIZMO_CORNER_KINDS = ['nw', 'ne', 'se', 'sw'];
  const GIZMO_RECT_KINDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  let gizmoMode: GizmoMode = loadGizmoMode();
  let gizmoDrag: any = null;
  let gizmoFrame = false;
  let gizmoSignature = '';

  function loadGizmoMode(): GizmoMode {
    try {
      const saved = localStorage.getItem(GIZMO_PREF_KEY);
      if (GIZMO_MODES.includes(saved as GizmoMode)) return saved as GizmoMode;
    } catch { /* storage may be unavailable */ }
    return 'rect'; // full box by default, so all four transforms are discoverable
  }

  function gizmoModeLabel(mode: GizmoMode = gizmoMode): string {
    return I18N.t('gizmo_mode_' + mode);
  }

  /** Switch modes. This is a UI preference, not document state: it is never
   *  serialized into the graph, exported JSON or the undo history. */
  function setGizmoMode(mode: string, persist = true) {
    const next = (GIZMO_MODES.includes(mode as GizmoMode) ? mode : 'off') as GizmoMode;
    if (gizmoDrag) finishGizmoDrag(true);
    if (next === gizmoMode && persist) { syncGizmoControls(); return; }
    gizmoMode = next;
    if (persist) {
      try { localStorage.setItem(GIZMO_PREF_KEY, gizmoMode); } catch { /* ignore */ }
    }
    syncGizmoControls();
    scheduleGizmoUpdate();
    setStatusOnly();
  }

  function syncGizmoControls() {
    $$('[data-gizmo-mode]').forEach((b: HTMLElement) => {
      const active = b.dataset.gizmoMode === gizmoMode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    const readout = document.getElementById('gizmoReadout');
    if (readout) {
      const count = state.selection?.nodes?.length || 0;
      readout.textContent = gizmoMode === 'off'
        ? I18N.t('gizmo_idle')
        : I18N.t('gizmo_active', { mode: gizmoModeLabel(), n: count });
    }
  }

  function gizmoHasSelection(): boolean {
    return gizmoMode !== 'off' && state.mode === 'select' &&
      (state.selection?.nodes?.length || 0) > 0;
  }
  function gizmoActive(): boolean { return Boolean(gizmoHasSelection() || gizmoDrag); }

  /** World units per screen pixel at the current (committed) camera. */
  function gizmoUnit(camera = state.viewBox): number {
    const r = svg.getBoundingClientRect();
    const pixelsPerUnit = r.width > 0 && r.height > 0
      ? Math.min(r.width / camera.w, r.height / camera.h)
      : 1;
    return pixelsPerUnit > 0 ? 1 / pixelsPerUnit : camera.w / 1000;
  }

  function gizmoSelectedNodes(): GraphNode[] {
    const ids = state.selection?.nodes || [];
    const out: GraphNode[] = [];
    for (const id of ids) { const n = nodeById(id); if (n) out.push(n); }
    return out;
  }

  /** Axis-aligned bounds of the selected node bodies, padded in screen pixels. */
  function gizmoBounds(nodes: GraphNode[], unit: number): any {
    if (!nodes.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const r = Math.max(nodeRadius(n), 8 * unit);
      minX = Math.min(minX, n.x - r); minY = Math.min(minY, n.y - r);
      maxX = Math.max(maxX, n.x + r); maxY = Math.max(maxY, n.y + r);
    }
    const pad = 12 * unit;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return { minX, minY, maxX, maxY, cx, cy, w: maxX - minX, h: maxY - minY };
  }

  function gzNum(value: number, digits = 3): number {
    if (!Number.isFinite(value)) return 0;
    const f = Math.pow(10, digits);
    return Math.round(value * f) / f;
  }
  function gzEl(tag: string, attrs: AnyRecord, parent: Element = transformGizmoLayer): SVGElement {
    const el = document.createElementNS(NS, tag);
    for (const key of Object.keys(attrs)) el.setAttribute(key, String(attrs[key]));
    parent.appendChild(el);
    return el;
  }

  function scheduleGizmoUpdate() {
    if (gizmoFrame) return;
    gizmoFrame = true;
    requestAnimationFrame(() => { gizmoFrame = false; renderTransformGizmo(); });
  }

  function hideTransformGizmo() {
    if (transformGizmoLayer.firstChild) transformGizmoLayer.textContent = '';
    removeAttr(transformGizmoLayer, 'transform');
    gizmoSignature = '';
  }

  function renderTransformGizmo() {
    if (!gizmoActive()) { hideTransformGizmo(); return; }
    const d = gizmoDrag;
    const mode: GizmoMode = d ? d.mode : gizmoMode;
    const camera = d ? d.viewBox : state.viewBox;
    const unit = gizmoUnit(camera);
    const nodes: GraphNode[] = d ? d.nodes : gizmoSelectedNodes();
    const b = d ? d.bounds : gizmoBounds(nodes, unit);
    if (!b) { hideTransformGizmo(); return; }
    const matrix: string = d ? d.matrix : '';
    const readout: string = d ? d.readout : '';
    // Rebuilding a dozen tiny SVG elements is cheap, but skip it when nothing
    // about the box, mode or gesture readout changed (e.g. idle render passes).
    const signature = [mode, nodes.map(n => n.id).join(','),
      gzNum(b.minX), gzNum(b.minY), gzNum(b.maxX), gzNum(b.maxY),
      gzNum(unit, 5), matrix, readout, I18N.current].join('|');
    if (signature === gizmoSignature) return;
    gizmoSignature = signature;

    transformGizmoLayer.textContent = '';
    if (matrix) setAttr(transformGizmoLayer, 'transform', matrix);
    else removeAttr(transformGizmoLayer, 'transform');

    const handleR = 5.5 * unit;
    const hitR = Math.max(11 * unit, handleR * 1.8);
    gzEl('rect', {
      class: 'gizmo-box', x: b.minX, y: b.minY, width: b.w, height: b.h, rx: 4 * unit
    });
    // Dragging the border (or the centre cross) translates the selection.
    gzEl('rect', {
      class: 'gizmo-box-hit', 'data-gizmo-handle': 'move',
      x: b.minX, y: b.minY, width: b.w, height: b.h, 'stroke-width': 14 * unit
    });
    gzEl('path', {
      class: 'gizmo-pivot',
      d: `M ${b.cx - 6 * unit} ${b.cy} H ${b.cx + 6 * unit} M ${b.cx} ${b.cy - 6 * unit} V ${b.cy + 6 * unit}`
    });

    const addHandle = (kind: string, x: number, y: number, circle = false) => {
      const g = gzEl('g', {
        class: 'gizmo-handle gizmo-h-' + kind,
        'data-gizmo-handle': kind, 'aria-hidden': 'true'
      });
      if (circle) {
        gzEl('circle', { class: 'gizmo-handle-shape', cx: x, cy: y, r: handleR }, g);
      } else {
        gzEl('rect', {
          class: 'gizmo-handle-shape', x: x - handleR, y: y - handleR,
          width: handleR * 2, height: handleR * 2, rx: 1.6 * unit
        }, g);
      }
      // Transparent, larger touch target on top of the visible shape.
      gzEl('circle', { class: 'gizmo-handle-hit', cx: x, cy: y, r: hitR }, g);
      return g;
    };
    const corners: AnyRecord = {
      nw: [b.minX, b.minY], ne: [b.maxX, b.minY],
      se: [b.maxX, b.maxY], sw: [b.minX, b.maxY]
    };
    const sides: AnyRecord = {
      n: [b.cx, b.minY], e: [b.maxX, b.cy],
      s: [b.cx, b.maxY], w: [b.minX, b.cy]
    };

    // Rotating/scaling a single point around its own centre is a no-op, so
    // don't offer handles that cannot do anything. The box border still moves
    // that node like a normal translate.
    const multi = nodes.length > 1;
    if (mode === 'translate') {
      const ax = b.maxX + 36 * unit, ay = b.cy;
      const bx = b.cx, by = b.minY - 36 * unit;
      gzEl('line', { class: 'gizmo-axis gizmo-axis-x', x1: b.cx, y1: b.cy, x2: ax, y2: ay });
      gzEl('line', { class: 'gizmo-axis gizmo-axis-y', x1: bx, y1: by, x2: b.cx, y2: b.cy });
      addHandle('move', b.cx, b.cy, true);
      addHandle('move-x', ax, ay, true);
      addHandle('move-y', bx, by, true);
    } else if (multi && mode === 'rotate') {
      const ry = b.minY - 30 * unit;
      gzEl('line', { class: 'gizmo-guide', x1: b.cx, y1: b.minY, x2: b.cx, y2: ry });
      addHandle('rotate', b.cx, ry, true);
    } else if (multi && mode === 'scale') {
      for (const kind of GIZMO_CORNER_KINDS) addHandle(kind, corners[kind][0], corners[kind][1]);
    } else if (multi && mode === 'rect') {
      for (const kind of GIZMO_RECT_KINDS) {
        const pt = corners[kind] || sides[kind];
        addHandle(kind, pt[0], pt[1], false);
      }
      const ry = b.minY - 30 * unit;
      gzEl('line', { class: 'gizmo-guide', x1: b.cx, y1: b.minY, x2: b.cx, y2: ry });
      addHandle('rotate', b.cx, ry, true);
    }

    const label = readout || (!multi && mode !== 'translate'
      ? I18N.t('gizmo_need_two')
      : I18N.t('gizmo_readout_idle', { mode: gizmoModeLabel(mode), n: nodes.length }));
    // Prefer above the box (clear of the floating tool pills at the bottom).
    // Rotate/rect have a stem handle above, so leave room for it there. If the
    // box is already at the top of the camera, fall back to below the box.
    const above = (multi && (mode === 'rotate' || mode === 'rect')) ? 44 * unit : 10 * unit;
    let labelY = b.minY - above;
    if (labelY < camera.y + 8 * unit) labelY = b.maxY + 21 * unit;
    const text = gzEl('text', {
      class: 'gizmo-readout', x: b.cx, y: labelY,
      'text-anchor': 'middle', 'font-size': 12 * unit
    });
    text.textContent = label;
  }

  // The opposite point stays fixed while a rect/scale handle is dragged.
  function gizmoAnchor(kind: string, b: any): Point {
    switch (kind) {
      case 'nw': return { x: b.maxX, y: b.maxY };
      case 'ne': return { x: b.minX, y: b.maxY };
      case 'se': return { x: b.minX, y: b.minY };
      case 'sw': return { x: b.maxX, y: b.minY };
      case 'n': return { x: b.cx, y: b.maxY };
      case 's': return { x: b.cx, y: b.minY };
      case 'e': return { x: b.minX, y: b.cy };
      case 'w': return { x: b.maxX, y: b.cy };
      default: return { x: b.cx, y: b.cy };
    }
  }
  function gizmoUsesAxis(kind: string): { x: boolean; y: boolean } {
    if (GIZMO_CORNER_KINDS.includes(kind)) return { x: true, y: true };
    if (kind === 'e' || kind === 'w') return { x: true, y: false };
    if (kind === 'n' || kind === 's') return { x: false, y: true };
    return { x: false, y: false };
  }

  function onGizmoPointerDown(ev: any) {
    const target = ev.target as Element;
    const handle = target && target.closest ? target.closest('[data-gizmo-handle]') : null;
    if (!handle || !gizmoHasSelection() || ev.button !== 0) return;
    if (!transformGizmoLayer.contains(handle)) return;
    ev.preventDefault();
    ev.stopPropagation();
    beginGizmoDrag(ev, handle.getAttribute('data-gizmo-handle') || 'move');
  }
  transformGizmoLayer.addEventListener('pointerdown', onGizmoPointerDown);

  function beginGizmoDrag(ev: any, kind: string) {
    // One gesture at a time: never fight an in-flight node drag, pan or draft.
    if (gizmoDrag || drag || pan || pinch || selectDraft || edgeDraft) return;
    registerPointer(ev);
    try { svg.setPointerCapture(ev.pointerId); } catch { /* jsdom / older SVG */ }
    const unit = gizmoUnit();
    const nodes = gizmoSelectedNodes();
    const b = gizmoBounds(nodes, unit);
    if (!b) return;
    const camera = { ...state.viewBox };
    const p0 = clientToWorld(ev.clientX, ev.clientY, camera, pointerRect || svg.getBoundingClientRect());
    const ids = new Set(nodes.map(n => n.id));
    const starts = new Map(nodes.map(n => [n.id, { x: n.x, y: n.y }]));
    const anchor = gizmoAnchor(kind, b);
    const affectedEdges = state.edges.filter(e => ids.has(e.from) || ids.has(e.to));
    const liveEdges = affectedEdges.length <= DRAG_LIVE_EDGE_LIMIT;
    const mode = gizmoMode;
    gizmoDrag = {
      pointerId: ev.pointerId, kind, mode, nodes, ids, starts, bounds: b,
      cx: b.cx, cy: b.cy, anchor, viewBox: camera,
      start: p0, denomX: p0.x - anchor.x, denomY: p0.y - anchor.y,
      startDistance: Math.max(unit * 8, Math.hypot(p0.x - b.cx, p0.y - b.cy)),
      lastAngle: Math.atan2(p0.y - b.cy, p0.x - b.cx), angle: 0,
      matrix: '', readout: '', moved: false, liveEdges,
      historyLabel: 'gizmo ' + (kind === 'rotate' ? 'rotate' : kind.startsWith('move') ? 'translate' : mode === 'rect' ? 'rect transform' : 'scale') + ' selection'
    };
    // Reuse the existing fast drag writer: it repoints node transforms and all
    // connected edges in one frame without a full render pass.
    drag = {
      node: nodes[0], nodes, starts, ignoreIds: ids,
      startX: p0.x, startY: p0.y, offsetX: 0, offsetY: 0,
      affectedEdges, liveEdges, moved: false,
      fastFrame: false, fastNodeId: null, vc: null, gizmo: true
    };
    gestureActive = true;
    $('#canvasWrap').classList.add('fast-interaction');
    scheduleGizmoUpdate();
    setStatusOnly();
  }

  function updateGizmoDrag(ev: any) {
    const d = gizmoDrag;
    if (!d || ev.pointerId !== d.pointerId) return;
    // Use the camera captured at gesture start: a wheel zoom mid-drag must not
    // teleport the pointer's world position.
    const p = clientToWorld(ev.clientX, ev.clientY, d.viewBox, pointerRect || svg.getBoundingClientRect());
    const shift = Boolean(ev.shiftKey);
    const apply = (fn: (x: number, y: number) => Point) => {
      for (const n of d.nodes) {
        const st = d.starts.get(n.id);
        const next = fn(st.x, st.y);
        n.x = next.x; n.y = next.y;
      }
    };
    let matrix = '', readout = '';

    if (d.kind === 'move' || d.kind === 'move-x' || d.kind === 'move-y') {
      let dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (d.kind === 'move-x') dy = 0;
      if (d.kind === 'move-y') dx = 0;
      // Snap the pivot (not each node), like a normal group drag would. The
      // selected ids are excluded from alignment snapping against themselves.
      const snapped = snapPointToEnabled(d.cx + dx, d.cy + dy, d.ids);
      dx = snapped.x - d.cx; dy = snapped.y - d.cy;
      if (d.kind === 'move-x') dy = 0;
      if (d.kind === 'move-y') dx = 0;
      apply((x, y) => ({ x: x + dx, y: y + dy }));
      matrix = `translate(${gzNum(dx)},${gzNum(dy)})`;
      readout = I18N.t('gizmo_value_move', { dx: Math.round(dx), dy: Math.round(dy) });
    } else if (d.kind === 'rotate') {
      const a = Math.atan2(p.y - d.cy, p.x - d.cx);
      let diff = a - d.lastAngle;
      if (diff > Math.PI) diff -= 2 * Math.PI;
      else if (diff < -Math.PI) diff += 2 * Math.PI;
      d.angle += diff;
      d.lastAngle = a;
      const angle = shift ? Math.round(d.angle / GIZMO_ROTATE_STEP) * GIZMO_ROTATE_STEP : d.angle;
      const cs = Math.cos(angle), sn = Math.sin(angle);
      apply((x, y) => {
        const ox = x - d.cx, oy = y - d.cy;
        return { x: d.cx + ox * cs - oy * sn, y: d.cy + ox * sn + oy * cs };
      });
      const degrees = gzNum(angle * 180 / Math.PI);
      matrix = `rotate(${degrees},${gzNum(d.cx)},${gzNum(d.cy)})`;
      readout = I18N.t('gizmo_value_rotate', { angle: Math.round(degrees) });
    } else if (d.mode === 'scale') {
      let s = Math.hypot(p.x - d.cx, p.y - d.cy) / d.startDistance;
      s = clamp(s, GIZMO_MIN_SCALE, GIZMO_MAX_SCALE);
      if (shift) s = Math.max(0.1, Math.round(s * 10) / 10);
      apply((x, y) => ({ x: d.cx + (x - d.cx) * s, y: d.cy + (y - d.cy) * s }));
      const f = gzNum(s);
      matrix = `matrix(${f},0,0,${f},${gzNum(d.cx * (1 - s))},${gzNum(d.cy * (1 - s))})`;
      readout = I18N.t('gizmo_value_scale', { sx: gzNum(s, 2), sy: gzNum(s, 2) });
    } else {
      // Rect mode: independent X/Y scaling about the opposite handle/edge.
      const axis = gizmoUsesAxis(d.kind);
      let sx = axis.x && Math.abs(d.denomX) > 1e-9 ? (p.x - d.anchor.x) / d.denomX : 1;
      let sy = axis.y && Math.abs(d.denomY) > 1e-9 ? (p.y - d.anchor.y) / d.denomY : 1;
      sx = axis.x ? clamp(sx, GIZMO_MIN_SCALE, GIZMO_MAX_SCALE) : 1;
      sy = axis.y ? clamp(sy, GIZMO_MIN_SCALE, GIZMO_MAX_SCALE) : 1;
      if (shift && axis.x && axis.y) {
        const f = Math.max(GIZMO_MIN_SCALE, Math.round(((Math.abs(sx) + Math.abs(sy)) / 2) * 10) / 10);
        sx = f; sy = f;
      }
      apply((x, y) => ({
        x: d.anchor.x + (x - d.anchor.x) * sx,
        y: d.anchor.y + (y - d.anchor.y) * sy
      }));
      const fx = gzNum(sx), fy = gzNum(sy);
      matrix = `matrix(${fx},0,0,${fy},${gzNum(d.anchor.x * (1 - sx))},${gzNum(d.anchor.y * (1 - sy))})`;
      readout = I18N.t('gizmo_value_scale', { sx: gzNum(sx, 2), sy: gzNum(sy, 2) });
    }

    d.matrix = matrix; d.readout = readout;
    if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > 0.5) {
      d.moved = true;
      if (drag) drag.moved = true;
    }
    // One DOM write per frame for nodes + connected edges, then refresh the
    // overlay with the same matrix the nodes just received.
    scheduleFastNodeMove(d.nodes[0]?.id);
    scheduleGizmoUpdate();
    setStatusOnly();
  }

  function finishGizmoDrag(cancel = false) {
    const d = gizmoDrag;
    if (!d) return;
    if (cancel) {
      for (const n of d.nodes) {
        const st = d.starts.get(n.id);
        n.x = st.x; n.y = st.y;
      }
    }
    // Flush the pending frame before dropping `drag`, otherwise a fast gesture
    // could leave one node/edge transform stale.
    if (drag) moveDragFast();
    const moved = d.moved && !cancel;
    gizmoDrag = null;
    drag = null;
    gestureActive = false;
    $('#canvasWrap').classList.remove('fast-interaction');
    gizmoSignature = '';
    if (moved) {
      pushHistory(d.historyLabel);
      if (!d.liveEdges) queueRender(false);
      saveSoon();
    }
    if (cancel && d.moved) toast(I18N.t('gizmo_cancelled'));
    scheduleGizmoUpdate();
    setStatusOnly();
  }
  function cancelGizmoDrag() { finishGizmoDrag(true); }
