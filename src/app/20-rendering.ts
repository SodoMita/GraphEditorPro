  function nodeVisual(n){
    const d = state.settings.nodeDefaults;
    const ts = (n.type && state.settings.nodeTypeStyles && state.settings.nodeTypeStyles[n.type]) || {};
    return {
      shape: n.shape || ts.shape || d.shape,
      color: n.color || ts.color || d.color,
      type: n.type || '',
      width: n.width != null ? n.width : (ts.width != null ? ts.width : d.width),
      height: n.height != null ? n.height : (ts.height != null ? ts.height : d.height),
      strokeColor: n.strokeColor || ts.strokeColor || d.strokeColor,
      strokeSize: n.strokeSize != null ? n.strokeSize : (ts.strokeSize != null ? ts.strokeSize : d.strokeSize),
      strokeStyle: n.strokeStyle || ts.strokeStyle || d.strokeStyle,
      labelColor: n.labelColor || ts.labelColor || d.labelColor,
      labelSize: n.labelSize || ts.labelSize || d.labelSize,
      labelPosition: n.labelPosition || ts.labelPosition || d.labelPosition,
      labelFont: n.labelFont || ts.labelFont || d.labelFont
    };
  }
  function edgeVisual(e){
    const d = state.settings.edgeDefaults;
    const ts = (e.type && state.settings.edgeTypeStyles && state.settings.edgeTypeStyles[e.type]) || {};
    return {
      color: e.color || ts.color || d.color,
      type: e.type || '',
      strokeSize: e.strokeSize != null ? e.strokeSize : (ts.strokeSize != null ? ts.strokeSize : d.strokeSize),
      strokeStyle: e.strokeStyle || ts.strokeStyle || d.strokeStyle,
      labelColor: e.labelColor || ts.labelColor || d.labelColor,
      labelSize: e.labelSize || ts.labelSize || d.labelSize,
      labelFont: e.labelFont || ts.labelFont || d.labelFont
    };
  }
  // === Edge weight visualization helpers ===
  // Normalizes a weight value to t ∈ [0,1] based on range and correlation function.
  // min > max is valid → lower values yield higher t (inverted).
  function normalizeWeight(v, min, max, corr){
    const lo = Math.min(min, max), hi = Math.max(min, max);
    if(hi === lo) return 0.5; // degenerate range → midpoint
    const vc = Math.max(lo, Math.min(hi, v)); // clamp to range
    let t;
    switch(corr){
      case 'log':
        if(lo <= 0){ t = (vc - lo) / (hi - lo); } // fallback to linear if non-positive
        else { const ll = Math.log(lo), lh = Math.log(hi); t = lh === ll ? 0.5 : (Math.log(vc) - ll) / (lh - ll); }
        break;
      case 'exp': {
        const el = Math.exp(lo), eh = Math.exp(hi);
        t = eh === el ? 0.5 : (Math.exp(vc) - el) / (eh - el);
        break;
      }
      case 'sqrt':
        if(lo < 0){ t = (vc - lo) / (hi - lo); } // fallback for negative
        else { const sl = Math.sqrt(lo), sh = Math.sqrt(hi); t = sh === sl ? 0.5 : (Math.sqrt(vc) - sl) / (sh - sl); }
        break;
      default: // linear
        t = (vc - lo) / (hi - lo);
    }
    // Invert if min > max (lower values → higher t → higher width/color intensity)
    if(min > max) t = 1 - t;
    return Math.max(0, Math.min(1, t));
  }
  function lerpColor(lowHex, highHex, t){
    const lh = String(lowHex || '#22d3ee').replace('#',''), hh = String(highHex || '#f59e0b').replace('#','');
    if(lh.length !== 6 || hh.length !== 6) return highHex || '#f59e0b';
    const lr = parseInt(lh.slice(0,2),16), lg = parseInt(lh.slice(2,4),16), lb = parseInt(lh.slice(4,6),16);
    const hr = parseInt(hh.slice(0,2),16), hg = parseInt(hh.slice(2,4),16), hb = parseInt(hh.slice(4,6),16);
    const r = Math.round(lr + (hr - lr) * t), g = Math.round(lg + (hg - lg) * t), b = Math.round(lb + (hb - lb) * t);
    return '#' + [r,g,b].map(n => n.toString(16).padStart(2,'0')).join('');
  }
  function edgeWeightNumber(e){
    if(e.weight === '' || e.weight == null) return null;
    const w = Number(e.weight);
    return Number.isFinite(w) ? w : null;
  }
  function isWeightInRange(w, min, max){
    const lo = Math.min(min, max), hi = Math.max(min, max);
    return w >= lo && w <= hi;
  }
  // Returns render style with weight-based color/width overrides applied.
  function edgeRenderStyle(e){
    const v = edgeVisual(e);
    const gd = state.settings.graphDefaults || {};
    const mode = gd.edgeWeightMode || 'number';
    if(mode === 'color' || mode === 'width'){
      const w = edgeWeightNumber(e);
      if(w != null){
        const t = normalizeWeight(w, gd.edgeWeightMin ?? 1, gd.edgeWeightMax ?? 10, gd.edgeWeightCorr || 'linear');
        if(mode === 'color'){
          v.color = lerpColor(gd.edgeWeightColorLow || '#22d3ee', gd.edgeWeightColorHigh || '#f59e0b', t);
        } else { // width
          v.strokeSize = (gd.edgeWidthMin ?? 1) + ((gd.edgeWidthMax ?? 8) - (gd.edgeWidthMin ?? 1)) * t;
        }
      }
    }
    return v;
  }
  // Dash patterns depend only on (style, stroke size); sizes repeat heavily
  // across a graph, so the built strings are memoized.
  const dashCache = new Map();
  function strokeDashArray(style, size){
    if(style !== 'dashed' && style !== 'dotted') return 'none';
    const key = style + size;
    let dash = dashCache.get(key);
    if(dash === undefined){
      dash = style === 'dashed'
        ? `${Math.max(4, size*2)} ${Math.max(3, size*1.5)}`
        : `${Math.max(1, size*0.8)} ${Math.max(3, size*1.8)}`;
      if(dashCache.size > 128) dashCache.clear();
      dashCache.set(key, dash);
    }
    return dash;
  }
  // === DOM write de-duplication ===
  // Every write to rendered graph elements goes through these helpers, which
  // skip the DOM entirely when the value equals the last write: unchanged
  // elements cost nothing, avoiding needless attribute parsing and
  // style/paint invalidation during full render passes.
  function attrBox(el){ return el.__ac || (el.__ac = Object.create(null)); }
  function setAttr(el, name, value){
    const c = attrBox(el);
    if(c[name] !== value){ c[name] = value; el.setAttribute(name, value); }
  }
  function removeAttr(el, name){
    const c = attrBox(el);
    if(c[name] !== undefined){ delete c[name]; el.removeAttribute(name); }
  }
  function toggleClass(el, name, on){
    const c = attrBox(el);
    const key = '⟂' + name;
    if(c[key] !== on){ c[key] = on; el.classList.toggle(name, on); }
  }
  function setText(el, text){
    const c = attrBox(el);
    if(c.__text !== text){ c.__text = text; el.textContent = text; }
  }
  // === Per-pass visual cache ===
  // Merged style objects and node "radii" are computed once per item and
  // reused by every edge that touches the item, keeping render passes and drag
  // frames free of repeated merges and short-lived allocations. Each render
  // pass (and each drag gesture) owns one cache.
  function newVisualCache(){ return { node: new Map(), edge: new Map(), radius: new Map() }; }
  let passVisuals = null;
  function beginRenderPass(){ passVisuals = newVisualCache(); }
  function endRenderPass(){ passVisuals = null; }
  function visualFor(item, cache, compute, key){
    const c = cache || passVisuals;
    if(!c) return compute();
    let v = c[key].get(item.id);
    if(v === undefined){ v = compute(); c[key].set(item.id, v); }
    return v;
  }
  function nodeVisualC(n, vc=null){ return visualFor(n, vc, () => nodeVisual(n), 'node'); }
  function edgeVisualC(e, vc=null){ return visualFor(e, vc, () => edgeVisual(e), 'edge'); }
  function edgeRenderStyleC(e, vc=null){ return visualFor(e, vc, () => edgeRenderStyle(e), 'edge'); }
  // === Node selection ring ===
  // The selection outline is a slightly larger copy of the node shape, placed
  // BEHIND the shape so the node's own fill colour stays visible. It exists
  // only while a node is selected (unselected nodes keep a single element).
  const SEL_RING_SCALE = 1.35;
  function selRingFor(shape, w, h){
    const S = SEL_RING_SCALE;
    let el;
    if(shape === 'square'){
      el = document.createElementNS(NS,'rect'); el.setAttribute('x',-w/2*S); el.setAttribute('y',-h/2*S); el.setAttribute('width',w*S); el.setAttribute('height',h*S);
    } else if(shape === 'diamond'){
      el = document.createElementNS(NS,'polygon'); el.setAttribute('points',`0,${-h/2*S-2} ${w/2*S+2},0 0,${h/2*S+2} ${-w/2*S-2},0`);
    } else if(shape === 'triangleUp'){
      el = document.createElementNS(NS,'polygon'); el.setAttribute('points',`0,${-h/2*S} ${w/2*S},${h/2*S} ${-w/2*S},${h/2*S}`);
    } else if(shape === 'triangleDown'){
      el = document.createElementNS(NS,'polygon'); el.setAttribute('points',`0,${h/2*S} ${w/2*S},${-h/2*S} ${-w/2*S},${-h/2*S}`);
    } else if(shape === 'hexagon'){
      const hx = w/2*S, hy = h/2*S, mx = w/4*S;
      el = document.createElementNS(NS,'polygon'); el.setAttribute('points',`${-hx+mx},${-hy} ${hx-mx},${-hy} ${hx},0 ${hx-mx},${hy} ${-hx+mx},${hy} ${-hx},0`);
    } else {
      el = document.createElementNS(NS,'ellipse'); el.setAttribute('rx',w/2*S); el.setAttribute('ry',h/2*S);
    }
    el.setAttribute('class','node-sel');
    return el;
  }
  // Creates/removes/updates a node's selection ring and returns the ring
  // element (or null). Safe to call from render passes and the fast
  // selection-sync path alike.
  function syncNodeSelRing(g: any, n: any, shape: string, w: number, h: number, selected: boolean){
    const selSig = shape + '|' + w + '|' + h;
    let sel = g.__sel;
    if(selected){
      if(!sel || g.__selSig !== selSig){
        if(sel) sel.remove();
        sel = selRingFor(shape, w, h);
        g.insertBefore(sel, g.firstChild); // behind the shape
        g.__sel = sel; g.__selSig = selSig;
      }
    } else if(sel){
      sel.remove(); g.__sel = null; g.__selSig = null; sel = null;
    }
    return sel;
  }
  function nodeRadiusC(n, vc){
    const c = vc || passVisuals;
    if(!c) return nodeRadius(n);
    let r = c.radius.get(n.id);
    if(r === undefined){ r = nodeRadius(n); c.radius.set(n.id, r); }
    return r;
  }
  function shouldShowLabels(){
    const policy = state.settings.graphDefaults?.labelsPolicy || 'auto';
    if(policy === 'off') return false;
    if(policy === 'on') return true;
    return state.nodes.length <= 30;
  }
  function existingNodeTypes(){
    const set = new Set();
    for(const n of state.nodes) if(n.type) set.add(n.type);
    return [...set].sort();
  }
  function existingEdgeTypes(){
    const set = new Set();
    for(const e of state.edges) if(e.type) set.add(e.type);
    return [...set].sort();
  }

  function syncControls(){
    $('#docTitleInput').value = state.title;
    // Edit-tab node placement
    $('#nodeShape').value = state.settings.nodeShape;
    $('#nodeColor').value = state.settings.nodeColor;
    $('#nodeWidth').value = state.settings.nodeWidth;
    $('#nodeHeight').value = state.settings.nodeHeight;
    $('#nodeStrokeColor').value = state.settings.nodeStrokeColor;
    $('#nodeStrokeSize').value = state.settings.nodeStrokeSize;
    $('#nodeStrokeStyle').value = state.settings.nodeStrokeStyle;
    $('#nodeType').value = state.settings.nodeType;
    $('#nodeLabelColor').value = state.settings.nodeLabelColor;
    $('#nodeLabelFont').value = state.settings.nodeLabelFont;
    $('#nodeLabelSize').value = state.settings.nodeLabelSize;
    $('#nodeLabelPos').value = state.settings.nodeLabelPosition;
    // Edit-tab edge defaults
    $('#edgeWeight').value = state.settings.edgeWeight;
    $('#edgeLabel').value = state.settings.edgeLabel;
    $('#edgeType').value = state.settings.edgeType;
    $('#edgeColor').value = state.settings.edgeColor;
    $('#edgeStrokeSize').value = state.settings.edgeStrokeSize;
    $('#edgeStrokeStyle').value = state.settings.edgeStrokeStyle;
    $('#edgeLabelColor').value = state.settings.edgeLabelColor;
    $('#edgeLabelFont').value = state.settings.edgeLabelFont;
    $('#edgeLabelSize').value = state.settings.edgeLabelSize;
    $('#edgeDirected').checked = state.settings.directed;
    $('#optAutosave').checked = state.settings.autosave;
    $('#optSnap').checked = state.settings.snap;
    $('#optSnapX').checked = state.settings.snapX;
    $('#optSnapY').checked = state.settings.snapY;
    $('#optGridX').value = state.settings.gridSizeX;
    $('#optGridY').value = state.settings.gridSizeY;
    $('#optBrushDiameter').value = state.settings.brushDiameter;
    $('#optMatrixLimit').value = state.settings.matrixLimit;
    $('#optEdgeListPageSize').value = state.settings.edgeListPageSize;
    const inhEl = $('#optInheritDefaults'); if(inhEl) inhEl.checked = state.settings.inheritDefaults !== false;
    const noLblEl = $('#optNoLabel'); if(noLblEl) noLblEl.checked = Boolean(state.settings.noLabel);
    syncStyleControls();
    syncEditTypeLists();
    setMode(state.mode, false);
    setSelectTool(state.selectTool || 'single', false);
    setSelectCombine(state.selectCombine || 'replace', false);
  }
  function syncEditTypeLists(){
    const ntl = $('#nodeTypeListEdit'); if(ntl) ntl.innerHTML = existingNodeTypes().map(t => `<option value="${esc(t)}">`).join('');
    const etl = $('#edgeTypeListEdit'); if(etl) etl.innerHTML = existingEdgeTypes().map(t => `<option value="${esc(t)}">`).join('');
  }

  function queueRender(includeMatrix=false, includeSidebar=false){
    if(includeMatrix){ clearTimeout(matrixTimer); matrixTimer = setTimeout(renderMatrixAndList, 60); }
    if(renderQueued) return;
    renderQueued = true;
    const wantSidebar = includeSidebar || sidebarDirty;
    requestAnimationFrame(() => { renderQueued = false; renderCanvas(); if(wantSidebar){ renderSidebar(); sidebarDirty = false; } });
  }
  let sidebarDirty = false;
  function markSidebarDirty(){ sidebarDirty = true; }
  function renderCanvas(){
    beginRenderPass();
    applyViewBox();
    gridPattern.setAttribute('width', state.settings.gridSizeX);
    gridPattern.setAttribute('height', state.settings.gridSizeY);
    const paths = state.nodes.length;
    $('#canvasWrap').classList.toggle('empty', paths === 0);
    setText($('#statsPill'), I18N.t('n_nodes_m_edges', {n: state.nodes.length, m: state.edges.length}));
    setText($('#statusPill'), statusText());
    renderEdges();
    renderNodes();
    updateUndoRedo();
    resetSelectionMirror();
    endRenderPass();
  }
  function statusText(){
    if(edgeDraft) return I18N.t('drag_to_target');
    if(pendingEdgeFrom) return I18N.t('source_selected', {name: labelOf(pendingEdgeFrom)});
    if(selectDraft) return I18N.t('selection_tool', {tool: selectDraft.tool});
    if(pinch) return I18N.t('pinch_zoom_pan');
    if(spaceDown) return I18N.t('pan_mode');
    if(state.mode === 'move') return I18N.t('move_mode_drag');
    if(state.mode === 'node') return I18N.t('node_mode_click');
    if(state.mode === 'edge') return I18N.t('edge_mode_drag');
    return state.selectTool === 'single' ? I18N.t('select_mode') : I18N.t('select_tool_mode', {tool: state.selectTool});
  }
  function applyViewBox(){
    // Commit any in-flight composited zoom preview before the camera changes
    // underneath it (fit view, camera inputs, undo, import, ...).
    flushZoomPreview();
    setAttr(svg, 'viewBox', `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.w} ${state.viewBox.h}`);
    updateGridBackground(state.viewBox);
    syncCameraInputs();
  }
  function applyPreviewViewBox(preview, base=state.viewBox, rect=null){
    const viewport = rect || svg.getBoundingClientRect();
    const scale = base.w / preview.w;
    const tx = base.x - scale * preview.x;
    const ty = base.y - scale * preview.y;

    // The oversized grid is rasterized once, then moved/scaled by the compositor.
    // Repainting four CSS gradients every frame was the largest navigation cost.
    const pixelScale = Math.min(viewport.width / base.w, viewport.height / base.h);
    const offsetX = (viewport.width - base.w * pixelScale) / 2;
    const offsetY = (viewport.height - base.h * pixelScale) / 2;
    const screenX = (1 - scale) * offsetX + pixelScale * (tx + (scale - 1) * base.x);
    const screenY = (1 - scale) * offsetY + pixelScale * (ty + (scale - 1) * base.y);
    const transform = `matrix(${scale},0,0,${scale},${screenX},${screenY})`;
    svg.style.transform = transform;
    gridLayer.style.transform = transform;
  }
  function clearFastPanTransform(){
    svg.style.transform = '';
    gridLayer.style.transform = '';
  }
  function hexToRgba(hex, alpha){
    const h = String(hex || '#94a3b8').replace('#','');
    if(h.length !== 6) return `rgba(148,163,184,${alpha})`;
    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  function setStyleIfChanged(style, property, value){
    if(style[property] !== value) style[property] = value;
  }
  let gridSig = '';
  function invalidateGridCache(){ gridSig = ''; }
  function updateGridBackground(vb=state.viewBox, cachedRect=null){
    const settings = state.settings;
    // The gradient geometry depends only on (viewBox, viewport size, grid
    // settings); it is recomputed only when one of them changes. Viewport
    // resizes invalidate the cache via invalidateGridCache().
    const sig = `${vb.x},${vb.y},${vb.w},${vb.h}|${settings.gridSizeX},${settings.gridSizeY},${settings.gridSize}|${settings.canvasBgColor},${settings.gridMinorColor},${settings.gridMajorColor},${settings.gridMinorAlpha},${settings.gridMajorAlpha}`;
    if(sig === gridSig) return;
    const rect = cachedRect || svg.getBoundingClientRect();
    if(!rect.width || !rect.height) return;
    gridSig = sig;
    const gx = settings.gridSizeX || settings.gridSize || 40;
    const gy = settings.gridSizeY || settings.gridSize || 40;

    // The grid is a sibling layer, so repainting it does not invalidate the
    // potentially thousands of vector elements in the SVG scene.
    setStyleIfChanged(gridLayer.style, 'backgroundColor', settings.canvasBgColor || '#020617');
    const minorColor = hexToRgba(settings.gridMinorColor, settings.gridMinorAlpha ?? 0.105);
    const majorColor = hexToRgba(settings.gridMajorColor, settings.gridMajorAlpha ?? 0.16);
    if(gridLayer.style.getPropertyValue('--grid-minor-color') !== minorColor) gridLayer.style.setProperty('--grid-minor-color', minorColor);
    if(gridLayer.style.getPropertyValue('--grid-major-color') !== majorColor) gridLayer.style.setProperty('--grid-major-color', majorColor);

    // Match SVG preserveAspectRatio="xMidYMid meet" exactly.
    const scale = Math.min(rect.width / vb.w, rect.height / vb.h);
    const offsetX = (rect.width - vb.w * scale) / 2;
    const offsetY = (rect.height - vb.h * scale) / 2;
    const cellX = Math.max(4, gx * scale), cellY = Math.max(4, gy * scale);
    const majorXSize = cellX * 5, majorYSize = cellY * 5;
    const mod = (value, size) => ((value % size) + size) % size;
    const extensionX = rect.width;
    const extensionY = rect.height;
    const minorX = mod(offsetX - vb.x * scale, cellX) + extensionX;
    const minorY = mod(offsetY - vb.y * scale, cellY) + extensionY;
    const majorX = mod(offsetX - vb.x * scale, majorXSize) + extensionX;
    const majorY = mod(offsetY - vb.y * scale, majorYSize) + extensionY;
    const size = `${cellX}px ${cellY}px,${cellX}px ${cellY}px,${majorXSize}px ${majorYSize}px,${majorXSize}px ${majorYSize}px`;
    const position = `${minorX}px ${minorY}px,${minorX}px ${minorY}px,${majorX}px ${majorY}px,${majorX}px ${majorY}px`;
    setStyleIfChanged(gridLayer.style, 'transformOrigin', `${extensionX}px ${extensionY}px`);
    setStyleIfChanged(gridLayer.style, 'backgroundSize', size);
    setStyleIfChanged(gridLayer.style, 'backgroundPosition', position);
  }
  function setStatusOnly(){ setText($('#statusPill'), statusText()); }
  // Id→element registries for rendered graph elements. They are maintained by
  // the render passes so hot paths (drag geometry, selection sync) never pay a
  // document-wide id lookup. getElementById remains as a safety fallback.
  const nodeEls = new Map(), edgeEls = new Map();
  function nodeEl(id){ return nodeEls.get(id) || document.getElementById('node-' + id); }
  function edgeEl(id){ return edgeEls.get(id) || document.getElementById('edge-' + id); }
  function moveNodeFast(id){
    const n = drag?.node?.id === id ? drag.node : nodeById(id); if(!n) return;
    const el = nodeEl(id); if(el) setAttr(el, 'transform', `translate(${n.x},${n.y})`);
    if(drag && drag.liveEdges === false) return;
    const edges = drag?.affectedEdges || state.edges.filter(e => e.from === id || e.to === id);
    for(const edge of edges) updateEdgeFast(edge);
  }
  function moveDragFast(){
    if(!drag) return;
    try {
      const nodes = drag.nodes || (drag.node ? [drag.node] : []);
      for(const n of nodes){
        const el = nodeEl(n.id); if(el) setAttr(el, 'transform', `translate(${n.x},${n.y})`);
      }
      if(drag.liveEdges === false) return;
      const vc = drag.vc || (drag.vc = newVisualCache());
      for(const edge of (drag.affectedEdges || [])) updateEdgeFast(edge, vc);
    } catch(e) { /* fail-safe */ }
  }
  function updateEdgeFast(edgeOrId, vc=null){
    const e = typeof edgeOrId === 'object' ? edgeOrId : edgeById(edgeOrId); if(!e) return;
    // nodeById is an indexed O(1) lookup now; node positions are mutated in
    // place, so the index always returns the live objects during a drag.
    const a = nodeById(e.from), b = nodeById(e.to); if(!a || !b) return;
    const el = edgeEl(e.id); if(!el) return;
    const g: any = el;
    const d = edgePath(a,b,e, vc || passVisuals);
    const line = g.__line || el.querySelector('.edge-line'); if(line) setAttr(line, 'd', d.path);
    const hit = g.__hit || el.querySelector('.edge-hit'); if(hit) setAttr(hit, 'd', d.path);
    const label = g.__label || null;
    const weight = g.__weight || null;
    const hasBoth = label && weight;
    const labelOffsetY = hasBoth ? -((edgeVisualC(e, vc).labelSize || 12) * 0.75 + 2) : 0;
    if(label){ setAttr(label, 'x', d.labelX); setAttr(label, 'y', d.labelY + labelOffsetY); }
    if(weight){ setAttr(weight, 'x', d.labelX); setAttr(weight, 'y', d.labelY); }
    // Update arrow tip position/angle during drag
    const arrow = g.__arrow || null;
    if(arrow && e.directed && d.tipX != null && d.arrowAngle != null){
      const aw = ARROW_HW, ang = d.arrowAngle;
      const sin = Math.sin(ang), cos = Math.cos(ang);
      const px = -sin, py = cos;
      const baseX = d.tx, baseY = d.ty;
      const leftX = baseX + px * aw, leftY = baseY + py * aw;
      const rightX = baseX - px * aw, rightY = baseY - py * aw;
      setAttr(arrow, 'points', `${d.tipX},${d.tipY} ${leftX},${leftY} ${rightX},${rightY}`);
    }
  }
  function scheduleFastNodeMove(id){
    if(!drag) return;
    drag.fastNodeId = id;
    if(drag.fastFrame) return;
    drag.fastFrame = true;
    requestAnimationFrame(() => {
      moveDragFast();
      if(drag) drag.fastFrame = false;
    });
  }
  function renderEdges(){
    buildEdgeOffsetCache();
    const showLabels = shouldShowLabels();
    const selectedEdges = selectedEdgeIds();
    const existing = new Map();
    // Linked-list traversal of the layer (the reflected id attribute is
    // "edge-<edgeId>"); avoids both collection-proxy indexing and dataset
    // proxy access per child. Collects everything up front, so later appends
    // of new elements during this pass cannot affect the traversal.
    for(let el = edgesLayer.firstElementChild; el; el = el.nextElementSibling){
      const eid = el.id;
      if(eid.startsWith('edge-')) existing.set(eid.slice(5), el);
    }
    const seen = new Set();
    // Pre-compute visible node IDs once per render — edges touching non-visible nodes are skipped entirely
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    const rangeActive = vr.start >= 0 || vr.end >= 0;
    const visIds = rangeActive ? visibleNodeIds() : null;
    const gd = state.settings.graphDefaults || {};
    const weightMode = gd.edgeWeightMode || 'number';
    const wMin = gd.edgeWeightMin ?? 1, wMax = gd.edgeWeightMax ?? 10;
    for(const e of state.edges){
      const a = nodeById(e.from), b = nodeById(e.to);
      if(!a || !b){
        // Edge has dangling endpoint — remove from DOM if present
        if(existing.has(e.id)) existing.get(e.id).remove();
        continue;
      }
      // Skip edges touching non-visible nodes entirely — real performance gain, not just dimming
      if(rangeActive && (!visIds.has(e.from) || !visIds.has(e.to))) continue;
      seen.add(e.id);
      const selected = selectedEdges.has(e.id);
      const v = edgeRenderStyleC(e);
      let g: any = existing.get(e.id);
      if(!g){
        g = document.createElementNS(NS,'g'); g.classList.add('edge');
        g.id = 'edge-' + e.id; g.dataset.id = e.id; g.dataset.from = e.from; g.dataset.to = e.to;
        g.addEventListener('pointerdown', ev => {
          ev.stopPropagation();
          if(ev.button === 1 || ev.button === 2){ registerPointer(ev); pendingEdgeFrom = null; startPan(ev); return; }
          if(ev.button !== 0) return;
          if(polygonToolActive()){ registerPointer(ev); handlePolygonPointerDown(ev); return; }
          if(state.mode === 'move'){ centerOnFurthestNodeOfEdge(e); return; }
          selectItem('edge', e.id);
        });
        g.addEventListener('dblclick', ev => { ev.stopPropagation(); if(polygonToolActive() && selectDraft?.tool === 'polygon') finishPolygonSelection(false); else editEdgeQuick(e.id); });
        edgesLayer.appendChild(g);
        edgeEls.set(e.id, g);
      }
      // Geometry cache: the path depends only on endpoint positions, node
      // radii, the parallel-edge lane, and direction. When none of these
      // changed (style-only or unrelated renders), the previous edgePath
      // result is reused without recomputation.
      const ra = nodeRadiusC(a, passVisuals), rb = nodeRadiusC(b, passVisuals);
      const lane = edgeSiblingOffset(e);
      const geoSig = `${a.x},${a.y}|${b.x},${b.y}|${ra},${rb}|${lane}|${e.directed ? 1 : 0}`;
      let d = g.__geoSig === geoSig ? g.__geoData : null;
      if(!d){
        d = edgePath(a,b,e, passVisuals);
        g.__geoSig = geoSig;
        g.__geoData = d;
      }
      toggleClass(g, 'selected', selected);
      // Update or create hit path (child refs are stashed on the group to
      // avoid per-edge selector queries)
      let hit = g.__hit;
      if(!hit){ hit = document.createElementNS(NS,'path'); hit.setAttribute('class','edge-hit'); g.appendChild(hit); g.__hit = hit; }
      setAttr(hit, 'd', d.path);
      // Update or create line path
      let line = g.__line;
      if(!line){ line = document.createElementNS(NS,'path'); line.setAttribute('class','edge-line'); g.insertBefore(line, g.firstChild); g.__line = line; }
      setAttr(line, 'd', d.path);
      setAttr(line, 'stroke', v.color); setAttr(line, 'stroke-width', v.strokeSize);
      const dash = strokeDashArray(v.strokeStyle, v.strokeSize);
      if(dash !== 'none') setAttr(line, 'stroke-dasharray', dash);
      else removeAttr(line, 'stroke-dasharray');
      // Update or create arrow
      let arrow = g.__arrow || null;
      if(e.directed && d.tipX != null && d.arrowAngle != null){
        const arrowColor = selected ? '#22d3ee' : v.color;
        const aw = ARROW_HW, ang = d.arrowAngle;
        const sin = Math.sin(ang), cos = Math.cos(ang);
        const px = -sin, py = cos;
        const baseX = d.tx, baseY = d.ty;
        const leftX = baseX + px * aw, leftY = baseY + py * aw;
        const rightX = baseX - px * aw, rightY = baseY - py * aw;
        if(!arrow){ arrow = document.createElementNS(NS,'polygon'); arrow.setAttribute('class','edge-arrow'); g.appendChild(arrow); g.__arrow = arrow; }
        setAttr(arrow, 'points', `${d.tipX},${d.tipY} ${leftX},${leftY} ${rightX},${rightY}`);
        setAttr(arrow, 'fill', arrowColor);
      } else if(arrow){
        arrow.remove(); g.__arrow = null; arrow = null;
      }
      // Compute label and weight text separately so both can be shown at once.
      // Weight is drawn ON the line midpoint; label is drawn ABOVE it (offset).
      let labelText = '', weightText = '';
      if(showLabels){
        if(e.label) labelText = e.label;
        if(e.weight !== '' && e.weight != null){
          const w = edgeWeightNumber(e);
          if(w != null){
            if(weightMode === 'number'){
              weightText = e.weight;
            } else if(weightMode === 'color' || weightMode === 'width'){
              // Show number only when weight is outside the configured range
              if(!isWeightInRange(w, wMin, wMax)) weightText = e.weight;
            }
            // 'none' mode: never show weight as text
          }
        }
      }
      const hasBoth = labelText && weightText;
      const labelOffsetY = hasBoth ? -(v.labelSize * 0.75 + 2) : 0;
      // Update or create label (drawn above weight when both present)
      let label = g.__label || null;
      if(labelText){
        if(!label){
          label = document.createElementNS(NS,'text');
          label.setAttribute('class','edge-label');
          label.setAttribute('text-anchor','middle'); label.setAttribute('dominant-baseline','middle');
          label.setAttribute('paint-order','stroke');
          label.setAttribute('stroke','#020617');
          label.setAttribute('stroke-linejoin','round');
          g.appendChild(label); g.__label = label;
        }
        setAttr(label, 'x', d.labelX); setAttr(label, 'y', d.labelY + labelOffsetY);
        setAttr(label, 'fill', v.labelColor);
        setAttr(label, 'font-size', v.labelSize);
        setAttr(label, 'font-family', v.labelFont);
        setAttr(label, 'stroke-width', Math.max(3, v.labelSize * 0.36));
        if(label.textContent !== labelText) label.textContent = labelText;
      } else if(label){
        label.remove(); g.__label = null; label = null;
      }
      // Update or create weight text (drawn on the line midpoint)
      let weight = g.__weight || null;
      if(weightText){
        if(!weight){
          weight = document.createElementNS(NS,'text');
          weight.setAttribute('class','edge-weight');
          weight.setAttribute('text-anchor','middle'); weight.setAttribute('dominant-baseline','middle');
          weight.setAttribute('paint-order','stroke');
          weight.setAttribute('stroke','#020617');
          weight.setAttribute('stroke-linejoin','round');
          g.appendChild(weight); g.__weight = weight;
        }
        setAttr(weight, 'x', d.labelX); setAttr(weight, 'y', d.labelY);
        setAttr(weight, 'fill', v.labelColor);
        setAttr(weight, 'font-size', v.labelSize);
        setAttr(weight, 'font-family', v.labelFont);
        setAttr(weight, 'stroke-width', Math.max(3, v.labelSize * 0.36));
        if(weight.textContent !== weightText) weight.textContent = weightText;
      } else if(weight){
        weight.remove(); g.__weight = null; weight = null;
      }
    }
    // Remove stale edges
    for(const [id, el] of existing){ if(!seen.has(id)){ el.remove(); edgeEls.delete(id); } }
  }
  function edgeGroupKey(e){ return e.from <= e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`; }
  // Lane offsets depend only on edge ids/endpoints and their order in the
  // array. The cache is reused across renders until the array is replaced or
  // resized, or an in-place id/endpoint/reorder mutation bumps the revision.
  let edgeOffsetCacheSrc = null, edgeOffsetCacheLen = -1, edgeOffsetCacheRev = -1;
  function buildEdgeOffsetCache(){
    const edges = state.edges;
    if(edgeOffsetCache && edgeOffsetCacheSrc === edges && edgeOffsetCacheLen === edges.length && edgeOffsetCacheRev === graphRev) return;
    const groups = new Map();
    for(const e of edges){
      const key = edgeGroupKey(e);
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    edgeOffsetCache = new Map();
    const spacing = 30;
    for(const group of groups.values()){
      group.forEach((e, idx) => {
        // Store the lane in canonical pair coordinates. edgePath converts it to the
        // edge's own direction, so A→B and B→A separate to opposite sides.
        edgeOffsetCache.set(e.id, (idx - (group.length - 1) / 2) * spacing);
      });
    }
    edgeOffsetCacheSrc = edges; edgeOffsetCacheLen = edges.length; edgeOffsetCacheRev = graphRev;
  }
  function edgeCanonicalFrom(e){ return e.from <= e.to ? e.from : e.to; }
  function edgeSiblingOffset(e){
    if(!edgeOffsetCache || !edgeOffsetCache.has(e.id)) buildEdgeOffsetCache();
    const lane = edgeOffsetCache.get(e.id) || 0;
    return e.from === edgeCanonicalFrom(e) ? lane : -lane;
  }
  function nodeRadius(n){
    const v = nodeVisual(n);
    // Approximate "radius" for edge endpoint offset: average of half-width/height
    return Math.max(12, (v.width + v.height) / 4);
  }
  const ARROW_LEN = 18; // arrow length from base to tip
  const ARROW_HW = 8;   // arrow half-width
  function edgePath(a,b,e,vc=null){
    const ra = nodeRadiusC(a, vc), rb = nodeRadiusC(b, vc);
    const arrowGap = e.directed ? ARROW_LEN : 2; // space reserved for arrow at target
    if(a.id === b.id){
      const lane = edgeSiblingOffset(e);
      const step = lane / 30;
      const angle = -Math.PI / 2 + step * 0.62;
      const spread = 0.72;
      const loop = 78 + Math.abs(step) * 10;
      const sx = a.x + Math.cos(angle - spread) * (ra + 2);
      const sy = a.y + Math.sin(angle - spread) * (ra + 2);
      // Path ends at arrow base; tip extends to node boundary
      const tx = a.x + Math.cos(angle + spread) * (ra + arrowGap);
      const ty = a.y + Math.sin(angle + spread) * (ra + arrowGap);
      const c1x = a.x + Math.cos(angle - spread * 0.45) * (ra + loop);
      const c1y = a.y + Math.sin(angle - spread * 0.45) * (ra + loop);
      const c2x = a.x + Math.cos(angle + spread * 0.45) * (ra + loop);
      const c2y = a.y + Math.sin(angle + spread * 0.45) * (ra + loop);
      const labelX = a.x + Math.cos(angle) * (ra + loop * 0.78);
      const labelY = a.y + Math.sin(angle) * (ra + loop * 0.78);
      // Tangent at endpoint of cubic Bezier: direction = endpoint - last control point
      const arrowAngle = Math.atan2(ty - c2y, tx - c2x);
      // Tip extends from base along tangent by arrowGap to reach node boundary
      const ac = Math.cos(arrowAngle), as = Math.sin(arrowAngle);
      const tipX = tx + ac * arrowGap, tipY = ty + as * arrowGap;
      return { path:`M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`, labelX, labelY, tx, ty, tipX, tipY, arrowAngle };
    }
    const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy) || 1, ux=dx/len, uy=dy/len;
    const offset = edgeSiblingOffset(e);
    // Keep endpoints attached to node boundaries; separate parallel/reverse edges
    // by bending the curve via its control point rather than shifting endpoints.
    const sx=a.x+ux*(ra+2), sy=a.y+uy*(ra+2);
    // Path ends at arrow base (rb + arrowGap from center); tip will be at node boundary (rb)
    const tx=b.x-ux*(rb + arrowGap), ty=b.y-uy*(rb + arrowGap);
    if(Math.abs(offset) > 1){
      const mx=(sx+tx)/2 - uy*offset, my=(sy+ty)/2 + ux*offset;
      // Tangent at endpoint of quadratic Bezier: direction = endpoint - control point
      const arrowAngle = Math.atan2(ty - my, tx - mx);
      const ac = Math.cos(arrowAngle), as = Math.sin(arrowAngle);
      const tipX = tx + ac * arrowGap, tipY = ty + as * arrowGap;
      return { path:`M ${sx} ${sy} Q ${mx} ${my} ${tx} ${ty}`, labelX:mx, labelY:my, tx, ty, tipX, tipY, arrowAngle };
    }
    const arrowAngle = Math.atan2(uy, ux);
    // For straight edges, tip = b - ux*rb (exactly on node boundary)
    const tipX = b.x - ux*rb, tipY = b.y - uy*rb;
    return { path:`M ${sx} ${sy} L ${tx} ${ty}`, labelX:(sx+tx)/2, labelY:(sy+ty)/2, tx, ty, tipX, tipY, arrowAngle };
  }
  function renderNodes(){
    const showLabels = shouldShowLabels();
    const selectedNodes = selectedNodeIds();
    const existing = new Map();
    // Linked-list traversal of the layer (the reflected id attribute is
    // "node-<nodeId>"); avoids both collection-proxy indexing and dataset
    // proxy access per child. Collects everything up front, so later appends
    // of new elements during this pass cannot affect the traversal.
    for(let el = nodesLayer.firstElementChild; el; el = el.nextElementSibling){
      const nid = el.id;
      if(nid.startsWith('node-')) existing.set(nid.slice(5), el);
    }
    const seen = new Set();
    // Pre-compute visible node IDs once per render — avoids per-node Set lookup
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    const rangeActive = vr.start >= 0 || vr.end >= 0;
    const visIds = rangeActive ? visibleNodeIds() : null;
    const draggingId = drag?.nodeId;
    for(const n of state.nodes){
      // Skip non-visible nodes entirely — they are removed from DOM, not dimmed.
      // This gives real performance: fewer SVG elements, fewer attribute patches, less paint.
      if(rangeActive && !visIds.has(n.id)) continue;
      seen.add(n.id);
      const selected = selectedNodes.has(n.id);
      const v = nodeVisualC(n);
      let g: any = existing.get(n.id);
      if(!g){
        // Create new node group
        g = document.createElementNS(NS,'g'); g.classList.add('node');
        g.id = 'node-' + n.id; g.dataset.id = n.id;
        g.addEventListener('pointerdown', ev => onNodePointerDown(ev, n.id));
        g.addEventListener('dblclick', ev => { ev.stopPropagation(); if(polygonToolActive() && selectDraft?.tool === 'polygon') finishPolygonSelection(false); else editNodeQuick(n.id); });
        nodesLayer.appendChild(g);
        nodeEls.set(n.id, g);
      }
      // Update transform (always — this is the hot path during drag)
      setAttr(g, 'transform',`translate(${n.x},${n.y})`);
      // Update selection class
      toggleClass(g, 'selected', selected);
      toggleClass(g, 'dragging', draggingId === n.id);
      const w = v.width, h = v.height;
      // Selection ring: keep a scaled copy of the shape behind the node. It
      // only exists while selected, so unselected nodes stay at one element.
      const sel = syncNodeSelRing(g, n, v.shape, w, h, selected);
      // Update or create shape (element ref stashed on the group)
      let shape = g.__shape;
      const shapeSig = v.shape + '|' + w + '|' + h;
      const needRebuild = !shape || g.__shapeSig !== shapeSig;
      if(needRebuild){
        if(shape) shape.remove();
        if(v.shape === 'square'){
          shape = document.createElementNS(NS,'rect'); shape.setAttribute('x',-w/2); shape.setAttribute('y',-h/2); shape.setAttribute('width',w); shape.setAttribute('height',h);
        } else if(v.shape === 'diamond'){
          shape = document.createElementNS(NS,'polygon'); shape.setAttribute('points',`0,${-h/2-2} ${w/2+2},0 0,${h/2+2} ${-w/2-2},0`);
        } else if(v.shape === 'triangleUp'){
          shape = document.createElementNS(NS,'polygon'); shape.setAttribute('points',`0,${-h/2} ${w/2},${h/2} ${-w/2},${h/2}`);
        } else if(v.shape === 'triangleDown'){
          shape = document.createElementNS(NS,'polygon'); shape.setAttribute('points',`0,${h/2} ${w/2},${-h/2} ${-w/2},${-h/2}`);
        } else if(v.shape === 'hexagon'){
          const hx = w/2, hy = h/2, mx = w/4;
          shape = document.createElementNS(NS,'polygon'); shape.setAttribute('points',`${-hx+mx},${-hy} ${hx-mx},${-hy} ${hx},0 ${hx-mx},${hy} ${-hx+mx},${hy} ${-hx},0`);
        } else {
          shape = document.createElementNS(NS,'ellipse'); shape.setAttribute('rx',w/2); shape.setAttribute('ry',h/2);
        }
        shape.setAttribute('class','node-shape');
        g.__shapeSig = shapeSig;
        // Keep the selection ring behind the shape
        if(sel) g.insertBefore(shape, sel.nextSibling);
        else g.insertBefore(shape, g.firstChild);
        g.__shape = shape;
      }
      // Update shape style attributes — de-duplicated, so untouched nodes
      // write nothing
      setAttr(shape, 'fill', v.color);
      setAttr(shape, 'stroke', v.strokeColor); setAttr(shape, 'stroke-width', v.strokeSize);
      const dash = strokeDashArray(v.strokeStyle, v.strokeSize);
      if(dash !== 'none') setAttr(shape, 'stroke-dasharray', dash);
      else removeAttr(shape, 'stroke-dasharray');
      // Update label
      let label = g.__text || null;
      const wantLabel = showLabels && n.label;
      if(wantLabel){
        if(!label){
          label = document.createElementNS(NS,'text');
          label.setAttribute('paint-order','stroke');
          label.setAttribute('stroke','#020617');
          label.setAttribute('stroke-linejoin','round');
          g.appendChild(label); g.__text = label;
        }
        setAttr(label, 'text-anchor', 'middle');
        setAttr(label, 'dominant-baseline', 'middle');
        setAttr(label, 'fill', v.labelColor);
        setAttr(label, 'font-size', v.labelSize);
        setAttr(label, 'font-family', v.labelFont);
        setAttr(label, 'stroke-width', Math.max(3, v.labelSize * 0.32));
        let lx = 0, ly = 0;
        const offset = Math.max(w, h)/2 + v.labelSize * 0.7;
        if(v.labelPosition === 'top'){ ly = -offset; setAttr(label, 'dominant-baseline','auto'); }
        else if(v.labelPosition === 'bottom'){ ly = offset; setAttr(label, 'dominant-baseline','hanging'); }
        else if(v.labelPosition === 'left'){ lx = -offset; setAttr(label, 'text-anchor','end'); }
        else if(v.labelPosition === 'right'){ lx = offset; setAttr(label, 'text-anchor','start'); }
        setAttr(label, 'x', lx); setAttr(label, 'y', ly);
        if(label.textContent !== n.label) label.textContent = n.label;
      } else if(label){
        label.remove(); g.__text = null; label = null;
      }
    }
    // Remove stale elements
    for(const [id, el] of existing){ if(!seen.has(id)){ el.remove(); nodeEls.delete(id); } }
  }
  function renderSidebar(){
    renderStartSelect();
    renderSelectionPanel();
  }
  let startSelectSig = '';
  function renderStartSelect(){
    const sel = $('#algoStart');
    const nodes = state.nodes;
    // FNV-1a signature over id+label: O(total chars), no DOM. The option list
    // is only patched when this signature changes.
    let h = 2166136261 ^ nodes.length;
    for(let i = 0; i < nodes.length; i++){
      const s = nodes[i].id + '>' + nodes[i].label;
      for(let j = 0; j < s.length; j++){ h ^= s.charCodeAt(j); h = Math.imul(h, 16777619); }
    }
    const sig = I18N.current + ':' + h;
    if(sig !== startSelectSig){
      startSelectSig = sig;
      const options = sel.options;
      const desired = nodes.length ? nodes.length : 1;
      while(options.length > desired) sel.remove(options.length - 1);
      if(nodes.length){
        for(let i = 0; i < nodes.length; i++){
          let opt = options[i];
          if(!opt){ opt = document.createElement('option'); sel.add(opt); }
          const value = nodes[i].id;
          const text = `${nodes[i].label || nodes[i].id} (${nodes[i].id})`;
          if(opt.value !== value) opt.value = value;
          if(opt.textContent !== text) opt.textContent = text;
        }
      } else {
        let opt = options[0];
        if(!opt){ opt = document.createElement('option'); sel.add(opt); }
        if(opt.value !== '') opt.value = '';
        const placeholder = I18N.t('no_nodes');
        if(opt.textContent !== placeholder) opt.textContent = placeholder;
      }
    }
    const current = sel.value || state.selected?.id;
    const selectedNode = state.selected?.type === 'node' ? state.selected.id : current;
    if(selectedNode && state.nodes.some(n => n.id === selectedNode)) sel.value = selectedNode;
  }
  function renderSelectionPanel(){
    const host = $('#selectionPanel');
    const nodeCount = state.selection?.nodes?.length || 0;
    const edgeCount = state.selection?.edges?.length || 0;
    if(!state.selected){ host.innerHTML = '<span class="muted" data-i18n="nothing_selected">Nothing selected.</span>'; return; }
    if(nodeCount + edgeCount > 1){
      const parts = [];
      parts.push(`<div class="tiny muted" style="margin-bottom:8px">${I18N.t('selected_n_m', {n: nodeCount, m: edgeCount})}</div>`);
      parts.push(`<div class="grid2" style="margin-bottom:8px">
        <button id="selAdjacent" class="btn">${I18N.t('sel_adjacent')}</button>
        <button id="selDirectedAdjacent" class="btn">${I18N.t('directed_adj_short')}</button>
        <button id="selClear" class="btn">${I18N.t('clear_sel')}</button>
        <button id="selDelete" class="btn danger">${I18N.t('delete_btn')}</button>
      </div>`);
      let html = parts.join('');
      // Node editing section (if any nodes selected)
      if(nodeCount > 0){
        const shapeOptions = '<option value="">' + I18N.t('stroke_inherit') + '</option>' + NODE_SHAPES.map(s => `<option value="${s}">${I18N.t('shape_' + s)}</option>`).join('');
        const strokeOptions = '<option value="">' + I18N.t('stroke_inherit') + '</option>' + STROKE_STYLES.map(s => `<option value="${s}">${I18N.t('stroke_' + s)}</option>`).join('');
        const labelPosOptions = ['<option value="">' + I18N.t('stroke_inherit') + '</option>','<option value="center">' + I18N.t('pos_center') + '</option>','<option value="top">' + I18N.t('pos_top') + '</option>','<option value="bottom">' + I18N.t('pos_bottom') + '</option>','<option value="left">' + I18N.t('pos_left') + '</option>','<option value="right">' + I18N.t('pos_right') + '</option>'].join('');
        html += `<div class="section-title">${I18N.t('nodes_n', {n: nodeCount})} <span class="tiny muted">${I18N.t('applies_to_all')}</span></div>
          <div class="grid2">
            <label class="field" for="mulNodeType">${I18N.t('type')} <input id="mulNodeType" list="nodeTypeList" placeholder="${I18N.t('keep')}" data-i18n-placeholder="keep"><datalist id="nodeTypeList">${existingNodeTypes().map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
            <label class="field" for="mulNodeOrder"><span data-i18n="order">Order</span> <input id="mulNodeOrder" type="number" min="0" step="1" placeholder="${I18N.t('keep')}" data-i18n-placeholder="keep" inputmode="numeric"></label>
            <label class="field" for="mulNodeColor"><span data-i18n="color">Color</span> <input id="mulNodeColor" type="color" value="#0ea5e9"></label>
            <label class="field" for="mulNodeShape"><span data-i18n="shape">Shape</span> <select id="mulNodeShape">${shapeOptions}</select></label>
            <label class="field" for="mulNodeStrokeColor"><span data-i18n="stroke_color">Stroke color</span> <input id="mulNodeStrokeColor" type="color" value="#e2e8f0"></label>
            <label class="field" for="mulNodeStrokeSize"><span data-i18n="stroke_size">Stroke size</span> <input id="mulNodeStrokeSize" type="number" min="0" max="20" step="0.1" value="2.2" inputmode="decimal"></label>
            <label class="field" for="mulNodeStrokeStyle"><span data-i18n="stroke_style">Stroke style</span> <select id="mulNodeStrokeStyle">${strokeOptions}</select></label>
            <label class="field" for="mulNodeLabelColor"><span data-i18n="label_color">Label color</span> <input id="mulNodeLabelColor" type="color" value="#f8fafc"></label>
            <label class="field" for="mulNodeLabelSize"><span data-i18n="label_size">Label size</span> <input id="mulNodeLabelSize" type="number" min="4" max="72" value="13" inputmode="decimal"></label>
            <label class="field" for="mulNodeLabelPos"><span data-i18n="label_pos">Label pos</span> <select id="mulNodeLabelPos">${labelPosOptions}</select></label>
          </div>`;
      }
      // Edge editing section (if any edges selected)
      if(edgeCount > 0){
        const strokeOptions = '<option value="">' + I18N.t('stroke_inherit') + '</option>' + STROKE_STYLES.map(s => `<option value="${s}">${I18N.t('stroke_' + s)}</option>`).join('');
        html += `<div class="section-title">${I18N.t('edges_n', {n: edgeCount})} <span class="tiny muted">${I18N.t('applies_to_all')}</span></div>
          <div class="grid2">
            <label class="field" for="mulEdgeType">${I18N.t('type')} <input id="mulEdgeType" list="edgeTypeList" placeholder="${I18N.t('keep')}" data-i18n-placeholder="keep"><datalist id="edgeTypeList">${existingEdgeTypes().map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
            <label class="field" for="mulEdgeDirected"><span data-i18n="directed">Directed</span> <select id="mulEdgeDirected"><option value="">${I18N.t('keep')}</option><option value="true">${I18N.t('directed_edge_short')}</option><option value="false">${I18N.t('undirected_edge_short')}</option></select></label>
            <label class="field" for="mulEdgeColor"><span data-i18n="color">Color</span> <input id="mulEdgeColor" type="color" value="#94a3b8"></label>
            <label class="field" for="mulEdgeStrokeSize"><span data-i18n="stroke_size">Stroke size</span> <input id="mulEdgeStrokeSize" type="number" min="0" max="20" step="0.1" value="2.4" inputmode="decimal"></label>
            <label class="field" for="mulEdgeStrokeStyle"><span data-i18n="stroke_style">Stroke style</span> <select id="mulEdgeStrokeStyle">${strokeOptions}</select></label>
            <label class="field" for="mulEdgeLabelColor"><span data-i18n="label_color">Label color</span> <input id="mulEdgeLabelColor" type="color" value="#dbeafe"></label>
            <label class="field" for="mulEdgeLabelSize"><span data-i18n="label_size">Label size</span> <input id="mulEdgeLabelSize" type="number" min="4" max="72" value="12" inputmode="decimal"></label>
          </div>`;
      }
      host.innerHTML = html;
      $('#selAdjacent').addEventListener('click', () => expandSelection(false));
      $('#selDirectedAdjacent').addEventListener('click', () => expandSelection(true));
      $('#selClear').addEventListener('click', deselect);
      $('#selDelete').addEventListener('click', deleteSelected);
      // Wire node multi-edit controls
      if(nodeCount > 0){
        const nodeIds = state.selection.nodes;
        const setNodeProp = (prop, val, isInput) => {
          for(const id of nodeIds){ const n = nodeById(id); if(n){ if(val === '' && isInput) n[prop] = ''; else if(val !== '') n[prop] = isInput ? val : val; } }
          pushHistory('multi-edit nodes'); queueRender(false); saveSoon();
        };
        $('#mulNodeType').addEventListener('change', e => { const v = e.target.value.slice(0,40); for(const id of nodeIds){ const n = nodeById(id); if(n){ n.type = v; applyTypeStyleToNode(n); } } pushHistory('multi node type'); queueRender(false); saveSoon(); renderSelectionPanel(); });
        $('#mulNodeOrder').addEventListener('change', e => { const v = e.target.value; if(v === '') return; const ord = clamp(parseInt(v,10)||0, 0, 2147483647); for(const id of nodeIds){ const n = nodeById(id); if(n) n.order = ord; } pushHistory('multi node order'); queueRender(true); saveSoon(); });
        $('#mulNodeColor').addEventListener('input', e => { for(const id of nodeIds){ const n = nodeById(id); if(n) n.color = e.target.value; } queueRender(false); saveSoon(); });
        $('#mulNodeColor').addEventListener('change', () => pushHistory('multi node color'));
        $('#mulNodeShape').addEventListener('change', e => { const v = e.target.value; for(const id of nodeIds){ const n = nodeById(id); if(n) n.shape = v; } pushHistory('multi node shape'); queueRender(false); });
        $('#mulNodeStrokeColor').addEventListener('input', e => { for(const id of nodeIds){ const n = nodeById(id); if(n) n.strokeColor = e.target.value; } queueRender(false); saveSoon(); });
        $('#mulNodeStrokeColor').addEventListener('change', () => pushHistory('multi stroke color'));
        $('#mulNodeStrokeSize').addEventListener('change', e => { const v = clamp(finite(e.target.value,2.2),0,20); e.target.value=v; for(const id of nodeIds){ const n = nodeById(id); if(n) n.strokeSize = v; } pushHistory('multi stroke size'); queueRender(false); });
        $('#mulNodeStrokeStyle').addEventListener('change', e => { const v = e.target.value; for(const id of nodeIds){ const n = nodeById(id); if(n) n.strokeStyle = v; } pushHistory('multi stroke style'); queueRender(false); });
        $('#mulNodeLabelColor').addEventListener('input', e => { for(const id of nodeIds){ const n = nodeById(id); if(n) n.labelColor = e.target.value; } queueRender(false); saveSoon(); });
        $('#mulNodeLabelColor').addEventListener('change', () => pushHistory('multi label color'));
        $('#mulNodeLabelSize').addEventListener('change', e => { const v = clamp(finite(e.target.value,13),4,72); e.target.value=v; for(const id of nodeIds){ const n = nodeById(id); if(n) n.labelSize = v; } pushHistory('multi label size'); queueRender(false); });
        $('#mulNodeLabelPos').addEventListener('change', e => { const v = e.target.value; for(const id of nodeIds){ const n = nodeById(id); if(n) n.labelPosition = v; } pushHistory('multi label pos'); queueRender(false); });
      }
      // Wire edge multi-edit controls
      if(edgeCount > 0){
        const edgeIds = state.selection.edges;
        $('#mulEdgeType').addEventListener('change', e => { const v = e.target.value.slice(0,40); for(const id of edgeIds){ const ed = edgeById(id); if(ed){ ed.type = v; applyTypeStyleToEdge(ed); } } pushHistory('multi edge type'); queueRender(false); saveSoon(); renderSelectionPanel(); });
        $('#mulEdgeDirected').addEventListener('change', e => { const v = e.target.value; if(v === '') return; const dir = v === 'true'; for(const id of edgeIds){ const ed = edgeById(id); if(ed) ed.directed = dir; } pushHistory('multi edge directed'); queueRender(true); });
        $('#mulEdgeColor').addEventListener('input', e => { for(const id of edgeIds){ const ed = edgeById(id); if(ed) ed.color = e.target.value; } queueRender(false); saveSoon(); });
        $('#mulEdgeColor').addEventListener('change', () => pushHistory('multi edge color'));
        $('#mulEdgeStrokeSize').addEventListener('change', e => { const v = clamp(finite(e.target.value,2.4),0,20); e.target.value=v; for(const id of edgeIds){ const ed = edgeById(id); if(ed) ed.strokeSize = v; } pushHistory('multi edge stroke size'); queueRender(false); });
        $('#mulEdgeStrokeStyle').addEventListener('change', e => { const v = e.target.value; for(const id of edgeIds){ const ed = edgeById(id); if(ed) ed.strokeStyle = v; } pushHistory('multi edge stroke style'); queueRender(false); });
        $('#mulEdgeLabelColor').addEventListener('input', e => { for(const id of edgeIds){ const ed = edgeById(id); if(ed) ed.labelColor = e.target.value; } queueRender(false); saveSoon(); });
        $('#mulEdgeLabelColor').addEventListener('change', () => pushHistory('multi edge label color'));
        $('#mulEdgeLabelSize').addEventListener('change', e => { const v = clamp(finite(e.target.value,12),4,72); e.target.value=v; for(const id of edgeIds){ const ed = edgeById(id); if(ed) ed.labelSize = v; } pushHistory('multi edge label size'); queueRender(false); });
      }
      return;
    }
    if(state.selected.type === 'node'){
      const n = nodeById(state.selected.id); if(!n){ setSelection([], [], null, false); return; }
      const bounds = coordinateBounds(n);
      const shapeOptions = NODE_SHAPES.map(s => `<option value="${s}">${I18N.t('shape_' + s)}</option>`).join('');
      const strokeOptions = STROKE_STYLES.map(s => `<option value="${s}">${I18N.t('stroke_' + s)}</option>`).join('');
      const typeList = existingNodeTypes().filter(t => t !== n.type);
      const v = nodeVisual(n);
      host.innerHTML = `
        <div class="grid2">
          <label class="field" for="selNodeLabel">${I18N.t('label')} <input id="selNodeLabel" value="${esc(n.label)}"></label>
          <label class="field" for="selNodeType">${I18N.t('type')} <input id="selNodeType" list="nodeTypeList" value="${esc(n.type)}" placeholder="none" data-i18n-placeholder="none_placeholder"><datalist id="nodeTypeList">${typeList.map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
        </div>
        <div class="grid2" style="margin-top:8px">
          <label class="field" for="selNodeX">${I18N.t('x_coord')} <input id="selNodeX" type="number" value="${Math.round(n.x)}" inputmode="decimal"></label>
          <label class="field" for="selNodeY">${I18N.t('y_coord')} <input id="selNodeY" type="number" value="${Math.round(n.y)}" inputmode="decimal"></label>
        </div>
        <div class="grid2" style="margin-top:8px">
          <label class="field" for="selNodeOrder">${I18N.t('order')} <input id="selNodeOrder" type="number" min="0" step="1" value="${n.order ?? 0}" inputmode="numeric"></label>
          <label class="field" for="selNodeId">${I18N.t('id_label')} <input id="selNodeId" value="${esc(n.id)}" readonly style="opacity:.6"></label>
        </div>
        <div class="section-title" style="margin-top:10px">${I18N.t('style_blank_inherit')} <span class="tiny muted">${I18N.t('blank_inherit')}</span></div>
        <div class="grid2">
          <label class="field" for="selNodeColor">${I18N.t('color')} <input id="selNodeColor" type="color" value="${esc(v.color)}"></label>
          <label class="field" for="selNodeShape">${I18N.t('shape')} <select id="selNodeShape"><option value="">${I18N.t('stroke_inherit')}</option>${shapeOptions}</select></label>
          <label class="field" for="selNodeWidth">${I18N.t('width')} <input id="selNodeWidth" type="number" min="10" max="300" value="${v.width}" inputmode="decimal"></label>
          <label class="field" for="selNodeHeight">${I18N.t('height')} <input id="selNodeHeight" type="number" min="10" max="300" value="${v.height}" inputmode="decimal"></label>
          <label class="field" for="selNodeStrokeColor">${I18N.t('stroke_color')} <input id="selNodeStrokeColor" type="color" value="${esc(v.strokeColor)}"></label>
          <label class="field" for="selNodeStrokeSize">${I18N.t('stroke_size')} <input id="selNodeStrokeSize" type="number" min="0" max="20" step="0.1" value="${v.strokeSize}" inputmode="decimal"></label>
          <label class="field" for="selNodeStrokeStyle">${I18N.t('stroke_style')} <select id="selNodeStrokeStyle"><option value="">${I18N.t('stroke_inherit')}</option>${strokeOptions}</select></label>
          <label class="field" for="selNodeLabelColor">${I18N.t('label_color')} <input id="selNodeLabelColor" type="color" value="${esc(v.labelColor)}"></label>
          <label class="field" for="selNodeLabelSize">${I18N.t('label_size')} <input id="selNodeLabelSize" type="number" min="4" max="72" value="${v.labelSize}" inputmode="decimal"></label>
          <label class="field" for="selNodeLabelPos">${I18N.t('label_pos')} <select id="selNodeLabelPos"><option value="">${I18N.t('stroke_inherit')}</option><option value="center">${I18N.t('pos_center')}</option><option value="top">${I18N.t('pos_top')}</option><option value="bottom">${I18N.t('pos_bottom')}</option><option value="left">${I18N.t('pos_left')}</option><option value="right">${I18N.t('pos_right')}</option></select></label>
          <label class="field" for="selNodeLabelFont">${I18N.t('label_font')} <input id="selNodeLabelFont" list="fontList" type="text" value="${esc(v.labelFont)}" placeholder="Inter"></label>
        </div>
        <div class="row" style="margin-top:8px">
          <button id="selDelete" class="btn danger" style="flex:1">${I18N.t('delete_btn')}</button>
          <button id="selResetStyle" class="btn small warn" style="flex:1" title="${I18N.t('reset_style_title')}">${I18N.t('reset_style')}</button>
        </div>
        <p class="drag-hint">${I18N.t('drag_hint')}</p>`;
      $('#selNodeShape').value = n.shape || '';
      $('#selNodeStrokeStyle').value = n.strokeStyle || '';
      $('#selNodeLabelPos').value = n.labelPosition || '';
      const syncCoordInputs = () => {
        const x = Math.round(n.x), y = Math.round(n.y);
        const xEl = $('#selNodeX'), yEl = $('#selNodeY');
        if(xEl && document.activeElement !== xEl) xEl.value = x;
        if(yEl && document.activeElement !== yEl) yEl.value = y;
      };
      const moveCoord = (axis, value, final=false) => {
        n[axis] = snapAxisValue(axis, value, n.id);
        syncCoordInputs();
        moveNodeFast(n.id);
        saveSoon();
        if(final) pushHistory('move node coordinate');
      };
      $('#selNodeLabel').addEventListener('change', e => { n.label = e.target.value.slice(0,80); pushHistory(); queueRender(true); markSidebarDirty(); });
      $('#selNodeType').addEventListener('change', e => { n.type = e.target.value.slice(0,40); applyTypeStyleToNode(n); pushHistory('node type'); queueRender(false); renderSelectionPanel(); });
      $('#selNodeColor').addEventListener('input', e => { n.color = e.target.value; queueRender(false); saveSoon(); });
      $('#selNodeColor').addEventListener('change', () => pushHistory());
      $('#selNodeShape').addEventListener('change', e => { n.shape = e.target.value; pushHistory(); queueRender(false); });
      $('#selNodeWidth').addEventListener('change', e => { n.width = clamp(finite(e.target.value,50),10,300); e.target.value=n.width; pushHistory(); queueRender(false); });
      $('#selNodeHeight').addEventListener('change', e => { n.height = clamp(finite(e.target.value,50),10,300); e.target.value=n.height; pushHistory(); queueRender(false); });
      $('#selNodeStrokeColor').addEventListener('input', e => { n.strokeColor = e.target.value; queueRender(false); saveSoon(); });
      $('#selNodeStrokeColor').addEventListener('change', () => pushHistory());
      $('#selNodeStrokeSize').addEventListener('change', e => { n.strokeSize = clamp(finite(e.target.value,2.2),0,20); e.target.value=n.strokeSize; pushHistory(); queueRender(false); });
      $('#selNodeStrokeStyle').addEventListener('change', e => { n.strokeStyle = e.target.value; pushHistory(); queueRender(false); });
      $('#selNodeLabelColor').addEventListener('input', e => { n.labelColor = e.target.value; queueRender(false); saveSoon(); });
      $('#selNodeLabelColor').addEventListener('change', () => pushHistory());
      $('#selNodeLabelSize').addEventListener('change', e => { n.labelSize = clamp(finite(e.target.value,13),4,72); e.target.value=n.labelSize; pushHistory(); queueRender(false); });
      $('#selNodeLabelPos').addEventListener('change', e => { n.labelPosition = e.target.value; pushHistory(); queueRender(false); });
      $('#selNodeLabelFont').addEventListener('change', e => { n.labelFont = e.target.value.slice(0,60) || undefined; pushHistory(); queueRender(false); });
      $('#selNodeOrder').addEventListener('change', e => { n.order = clamp(parseInt(e.target.value,10)||0, 0, 2147483647); e.target.value=n.order; pushHistory('node order'); queueRender(true); saveSoon(); });
      $('#selNodeX').addEventListener('input', e => moveCoord('x', e.target.value, false));
      $('#selNodeY').addEventListener('input', e => moveCoord('y', e.target.value, false));
      $('#selNodeX').addEventListener('change', e => moveCoord('x', e.target.value, true));
      $('#selNodeY').addEventListener('change', e => moveCoord('y', e.target.value, true));
      attachDragNumber($('#selNodeX'), { min: bounds.minX, max: bounds.maxX, step: 1, sensitivity: 0.6 });
      attachDragNumber($('#selNodeY'), { min: bounds.minY, max: bounds.maxY, step: 1, sensitivity: 0.6 });
      attachDragNumber($('#selNodeWidth'), { min: 10, max: 300, step: 1, sensitivity: 0.5 });
      attachDragNumber($('#selNodeHeight'), { min: 10, max: 300, step: 1, sensitivity: 0.5 });
      attachDragNumber($('#selNodeStrokeSize'), { min: 0, max: 20, step: 0.1, sensitivity: 0.3 });
      attachDragNumber($('#selNodeLabelSize'), { min: 4, max: 72, step: 1, sensitivity: 0.5 });
      $('#selDelete').addEventListener('click', deleteSelected);
      $('#selResetStyle').addEventListener('click', () => {
        delete n.shape; delete n.color; delete n.width; delete n.height;
        delete n.strokeColor; delete n.strokeSize; delete n.strokeStyle;
        delete n.labelColor; delete n.labelSize; delete n.labelPosition; delete n.labelFont;
        n.shape = ''; n.color = '';
        pushHistory('reset node style'); queueRender(true); saveSoon(); renderSelectionPanel();
      });
    } else {
      const e = edgeById(state.selected.id); if(!e){ setSelection([], [], null, false); return; }
      const a=nodeById(e.from), b=nodeById(e.to);
      const typeList = existingEdgeTypes().filter(t => t !== e.type);
      const v = edgeVisual(e);
      const strokeOptions = STROKE_STYLES.map(s => `<option value="${s}">${I18N.t('stroke_' + s)}</option>`).join('');
      host.innerHTML = `
        <div class="tiny muted" style="margin-bottom:8px">${esc(a?.label || e.from)} → ${esc(b?.label || e.to)}</div>
        <div class="grid2">
          <label class="field" for="selEdgeWeight">${I18N.t('weight')} <input id="selEdgeWeight" value="${esc(e.weight)}"></label>
          <label class="field" for="selEdgeLabel">${I18N.t('label')} <input id="selEdgeLabel" value="${esc(e.label)}"></label>
        </div>
        <label class="field" for="selEdgeType" style="margin-top:8px">${I18N.t('type')} <input id="selEdgeType" list="edgeTypeList" value="${esc(e.type)}" placeholder="${I18N.t('none_placeholder')}" data-i18n-placeholder="none_placeholder"><datalist id="edgeTypeList">${typeList.map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
        <label class="row tiny muted" style="margin:8px 0"><input id="selEdgeDirected" type="checkbox" ${e.directed?'checked':''}> ${I18N.t('directed_edge')}</label>
        <div class="section-title">${I18N.t('style_blank_inherit')} <span class="tiny muted">${I18N.t('blank_inherit')}</span></div>
        <div class="grid2">
          <label class="field" for="selEdgeColor">${I18N.t('color')} <input id="selEdgeColor" type="color" value="${esc(v.color)}"></label>
          <label class="field" for="selEdgeStrokeSize">${I18N.t('stroke_size')} <input id="selEdgeStrokeSize" type="number" min="0" max="20" step="0.1" value="${v.strokeSize}" inputmode="decimal"></label>
          <label class="field" for="selEdgeStrokeStyle">${I18N.t('stroke_style')} <select id="selEdgeStrokeStyle"><option value="">${I18N.t('stroke_inherit')}</option>${strokeOptions}</select></label>
          <label class="field" for="selEdgeLabelColor">${I18N.t('label_color')} <input id="selEdgeLabelColor" type="color" value="${esc(v.labelColor)}"></label>
          <label class="field" for="selEdgeLabelSize">${I18N.t('label_size')} <input id="selEdgeLabelSize" type="number" min="4" max="72" value="${v.labelSize}" inputmode="decimal"></label>
          <label class="field" for="selEdgeLabelFont">${I18N.t('label_font')} <input id="selEdgeLabelFont" list="fontList" type="text" value="${esc(v.labelFont)}" placeholder="Inter"></label>
        </div>
        <div class="row" style="margin-top:8px">
          <button id="selDelete" class="btn danger" style="flex:1">${I18N.t('delete_edge')}</button>
          <button id="selResetEdgeStyle" class="btn small warn" style="flex:1" title="${I18N.t('reset_edge_style_title')}">${I18N.t('reset_style')}</button>
        </div>`;
      $('#selEdgeStrokeStyle').value = e.strokeStyle || '';
      $('#selEdgeWeight').addEventListener('change', ev => { const v = ev.target.value.slice(0,50); if(v === '') delete e.weight; else e.weight = v; pushHistory(); queueRender(true); });
      $('#selEdgeLabel').addEventListener('change', ev => { e.label = ev.target.value.slice(0,80); pushHistory(); queueRender(true); });
      $('#selEdgeType').addEventListener('change', ev => { e.type = ev.target.value.slice(0,40); applyTypeStyleToEdge(e); pushHistory('edge type'); queueRender(false); renderSelectionPanel(); });
      $('#selEdgeDirected').addEventListener('change', ev => { e.directed = ev.target.checked; pushHistory(); queueRender(true); });
      $('#selEdgeColor').addEventListener('input', ev => { e.color = ev.target.value; queueRender(false); saveSoon(); });
      $('#selEdgeColor').addEventListener('change', () => pushHistory());
      $('#selEdgeStrokeSize').addEventListener('change', ev => { e.strokeSize = clamp(finite(ev.target.value,2.4),0,20); ev.target.value=e.strokeSize; pushHistory(); queueRender(false); });
      $('#selEdgeStrokeStyle').addEventListener('change', ev => { e.strokeStyle = ev.target.value; pushHistory(); queueRender(false); });
      $('#selEdgeLabelColor').addEventListener('input', ev => { e.labelColor = ev.target.value; queueRender(false); saveSoon(); });
      $('#selEdgeLabelColor').addEventListener('change', () => pushHistory());
      $('#selEdgeLabelSize').addEventListener('change', ev => { e.labelSize = clamp(finite(ev.target.value,12),4,72); ev.target.value=e.labelSize; pushHistory(); queueRender(false); });
      $('#selEdgeLabelFont').addEventListener('change', ev => { e.labelFont = ev.target.value.slice(0,60) || undefined; pushHistory(); queueRender(false); });
      attachDragNumber($('#selEdgeStrokeSize'), { min: 0, max: 20, step: 0.1, sensitivity: 0.3 });
      attachDragNumber($('#selEdgeLabelSize'), { min: 4, max: 72, step: 1, sensitivity: 0.5 });
      $('#selDelete').addEventListener('click', deleteSelected);
      $('#selResetEdgeStyle').addEventListener('click', () => {
        delete e.color; delete e.strokeSize; delete e.strokeStyle;
        delete e.labelColor; delete e.labelSize; delete e.labelFont;
        e.color = '';
        pushHistory('reset edge style'); queueRender(true); saveSoon(); renderSelectionPanel();
      });
    }
  }
  // Returns nodes sorted by order, optionally filtered by the visible range setting.
  // When visibleRange.start is -1, all nodes are returned.
  function visibleNodes(){
    const sorted = [...state.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    if(vr.start < 0 && vr.end < 0) return sorted;
    const start = vr.start < 0 ? 0 : vr.start;
    const end = vr.end < 0 ? sorted.length : Math.min(vr.end + 1, sorted.length);
    return sorted.slice(Math.max(0, start), end);
  }
  function visibleNodeIds(){
    return new Set(visibleNodes().map(n => n.id));
  }
  function matrixNodes(){
    const dim = clamp(parseInt(state.settings.matrixDimension,10) || 0, 0, 300);
    const sorted = visibleNodes();
    return dim > 0 ? sorted.slice(0, Math.min(dim, sorted.length)) : sorted;
  }
  let edgeListRenderLimit = 250;
  function configuredEdgeListPageSize(){
    return positiveInteger(state.settings.edgeListPageSize, 250);
  }
  function renderMatrixAndList(){
    edgeListRenderLimit = configuredEdgeListPageSize();
    const visNodes = matrixNodes();
    const n = visNodes.length, total = state.nodes.length, limit = state.settings.matrixLimit;
    const sizeInput = $('#matrixSize'); if(sizeInput) sizeInput.value = state.settings.matrixDimension || total;
    const note = $('#matrixNote');
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    const rangeActive = vr.start >= 0 || vr.end >= 0;
    if(total === 0){ $('#matrixHost').innerHTML = '<div class="tiny muted">' + I18N.t('no_nodes_yet') + '</div>'; $('#edgeListHost').innerHTML = '<div class="tiny muted">' + I18N.t('no_edges_yet') + '</div>'; note.textContent=''; return; }
    if(n === 0){ $('#matrixHost').innerHTML = '<div class="tiny muted">' + I18N.t('no_nodes_range') + '</div>'; note.textContent = `0 / ${total}`; }
    else if(n > limit){ $('#matrixHost').innerHTML = '<div class="tiny muted">' + (I18N.current === 'ru' ? `Матрица скрыта для производительности (${n} узлов > лимит ${limit}). Используйте экспорт Matrix CSV или увеличьте лимит.` : `Matrix hidden for performance (${n} nodes > limit ${limit}). Use Matrix CSV export or increase the limit.`) + '</div>'; note.textContent = I18N.current === 'ru' ? `скрыто (${n} из ${total} узлов)` : `hidden (${n} of ${total} nodes)`; }
    else {
      $('#matrixHost').innerHTML = adjacencyMatrixHtml(visNodes);
      note.textContent = rangeActive
        ? `${n}×${n} (` + (I18N.current === 'ru' ? 'диапазон ' : 'range ') + `${vr.start >= 0 ? vr.start : 0}–${vr.end >= 0 ? vr.end : (I18N.current === 'ru' ? 'конец' : 'end')} ` + (I18N.current === 'ru' ? 'из' : 'of') + ` ${total})`
        : n === total ? `${n}×${n}` : `${n}×${n} ` + (I18N.current === 'ru' ? `вид ${total} узлов` : `view of ${total} nodes`);
    }
    $('#edgeListHost').innerHTML = edgeListHtml();
  }
  function adjacencyMatrixData(nodes=state.nodes, includeEdgeIds=true){
    const index = new Map(nodes.map((node,i) => [node.id,i]));
    const values = Array.from({length:nodes.length}, () => Array.from({length:nodes.length}, () => []));
    const edgeIds = includeEdgeIds
      ? Array.from({length:nodes.length}, () => Array.from({length:nodes.length}, () => []))
      : null;
    for(const edge of state.edges){
      const from=index.get(edge.from), to=index.get(edge.to); if(from == null || to == null) continue;
      const weight = (edge.weight != null && edge.weight !== '') ? edge.weight : '';
      values[from][to].push(weight);
      if(edgeIds) edgeIds[from][to].push(edge.id);
      if(!edge.directed && from !== to){
        values[to][from].push(weight);
        if(edgeIds) edgeIds[to][from].push(edge.id);
      }
    }
    return {values, edgeIds};
  }
  function adjacencyMatrix(nodes=state.nodes){ return adjacencyMatrixData(nodes, false).values; }
  function matrixCellEdgeIds(from, to){
    return state.edges
      .filter(e => (e.from === from && e.to === to) || (!e.directed && e.from === to && e.to === from))
      .map(e => e.id);
  }
  function adjacencyMatrixHtml(nodes=matrixNodes()){
    const {values, edgeIds} = adjacencyMatrixData(nodes);
    const edgeSel = selectedEdgeIds();
    const header = nodes.map(n => `<th><input class="matrix-label-input${isNodeSelected(n.id)?' matrix-selected':''}" data-node-label="${esc(n.id)}" value="${esc(n.label || n.id)}" readonly title="Click to select node; click again to rename"></th>`).join('');
    let html = '<table><thead><tr><th></th>' + header + '</tr></thead><tbody>';
    nodes.forEach((row,i) => {
      html += `<tr><th class="row-head"><input class="matrix-label-input${isNodeSelected(row.id)?' matrix-selected':''}" data-node-label="${esc(row.id)}" value="${esc(row.label || row.id)}" readonly title="Click to select node; click again to rename"></th>` +
        values[i].map((cell,j) => {
          const to = nodes[j].id;
          const ids = edgeIds[i][j];
          const selected = ids.some(id => edgeSel.has(id));
          return `<td><input class="matrix-input${selected?' matrix-selected':''}" data-cell-from="${esc(row.id)}" data-cell-to="${esc(to)}" data-cell-edges="${esc(ids.join(','))}" value="${esc(cell.join(';') || '')}" placeholder="0" readonly title="Click to select edge(s); click again to edit weights"></td>`;
        }).join('') + '</tr>';
    });
    return html + '</tbody></table>';
  }
  function edgeListHtml(){
    if(!state.edges.length){ if($('#edgeListNote')) $('#edgeListNote').textContent = ''; return '<div class="tiny muted">' + I18N.t('no_edges_yet') + '</div>'; }
    // Filter edges by visible range (if set): only show edges where BOTH endpoints are visible
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    const rangeActive = vr.start >= 0 || vr.end >= 0;
    const visIds = rangeActive ? visibleNodeIds() : null;
    const filteredEdges = rangeActive
      ? state.edges.filter(e => visIds.has(e.from) && visIds.has(e.to))
      : state.edges;
    if(!filteredEdges.length){
      if($('#edgeListNote')) $('#edgeListNote').textContent = '';
      return '<div class="tiny muted">' + I18N.t('no_edges_range') + '</div>';
    }
    const renderedEdges = filteredEdges.slice(0, edgeListRenderLimit);
    if($('#edgeListNote')){
      const total = state.edges.length, shown = filteredEdges.length, rendered = renderedEdges.length;
      const filterNote = rangeActive
        ? I18N.t('n_edges_filtered', {n: shown, m: total})
        : I18N.t('n_edges', {n: total});
      const pageNote = rendered < shown
        ? (I18N.current === 'ru' ? ` · показано ${rendered}` : ` · showing ${rendered}`)
        : '';
      $('#edgeListNote').textContent = filterNote + pageNote;
    }
    const selectedEdges = selectedEdgeIds();
    let html = '<table><thead><tr><th></th><th>' + I18N.t('col_num') + '</th><th>' + I18N.t('col_id') + '</th><th>' + I18N.t('col_from') + '</th><th>' + I18N.t('col_to') + '</th><th>' + I18N.t('weight') + '</th><th>' + I18N.t('label') + '</th><th>' + I18N.t('type') + '</th><th>' + I18N.t('col_dir') + '</th><th>' + I18N.t('color') + '</th><th>' + I18N.t('col_stroke') + '</th></tr></thead><tbody>';
    renderedEdges.forEach((e,i) => {
      const a = nodeById(e.from), b = nodeById(e.to);
      const sel = selectedEdges.has(e.id) ? ' matrix-selected' : '';
      const strokeOpts = '<option value=""></option>' + STROKE_STYLES.map(s => `<option value="${s}"${e.strokeStyle===s?' selected':''}>${I18N.t('stroke_' + s)}</option>`).join('');
      html += `<tr>
        <td style="white-space:nowrap">
          <button class="btn small icon edge-up" data-edge-id="${esc(e.id)}" title="Move up" style="min-height:26px;width:24px;padding:0">↑</button>
          <button class="btn small icon edge-down" data-edge-id="${esc(e.id)}" title="Move down" style="min-height:26px;width:24px;padding:0">↓</button>
        </td>
        <td>${i+1}</td>
        <td><input class="matrix-input edge-id" data-edge-id="${esc(e.id)}" value="${esc(e.id)}" title="Click to select edge; edit to change ID" style="width:60px"></td>
        <td><input class="matrix-input edge-from" data-edge-id="${esc(e.id)}" value="${esc(a?.label || e.from)}" title="Source: ${esc(e.from)} — type node label or ID to reassign" style="width:64px"></td>
        <td><input class="matrix-input edge-to" data-edge-id="${esc(e.id)}" value="${esc(b?.label || e.to)}" title="Target: ${esc(e.to)} — type node label or ID to reassign" style="width:64px"></td>
        <td><input class="matrix-input edge-weight${sel}" data-edge-id="${esc(e.id)}" value="${esc(e.weight)}" title="Edit weight" style="width:52px"></td>
        <td><input class="matrix-input edge-elabel" data-edge-id="${esc(e.id)}" value="${esc(e.label)}" title="Edit label" style="width:72px"></td>
        <td><input class="matrix-input edge-type" data-edge-id="${esc(e.id)}" value="${esc(e.type)}" placeholder="none" data-i18n-placeholder="none_placeholder" title="Edit type" style="width:64px"></td>
        <td><input type="checkbox" class="edge-directed" data-edge-id="${esc(e.id)}" ${e.directed?'checked':''} title="Directed"></td>
        <td><input type="color" class="edge-color" data-edge-id="${esc(e.id)}" value="${esc(edgeVisual(e).color)}" title="Edge color" style="width:32px;height:26px;padding:2px"></td>
        <td><select class="matrix-input edge-stroke-style" data-edge-id="${esc(e.id)}" style="width:68px">${strokeOpts}</select></td>
      </tr>`;
    });
    html += '</tbody></table>';
    if(renderedEdges.length < filteredEdges.length){
      const remaining = filteredEdges.length - renderedEdges.length;
      const pageSize = configuredEdgeListPageSize();
      const label = I18N.current === 'ru'
        ? `Показать ещё ${Math.min(pageSize, remaining)}`
        : `Show ${Math.min(pageSize, remaining)} more`;
      html += `<div class="row" style="justify-content:center;padding:8px"><button id="btnEdgeListMore" class="btn small">${label}</button></div>`;
    }
    return html;
  }
  function showMoreEdgeRows(){
    edgeListRenderLimit += configuredEdgeListPageSize();
    $('#edgeListHost').innerHTML = edgeListHtml();
  }
