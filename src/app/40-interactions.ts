  let pointerRect = null; // viewport rect captured at pointerdown, reused for the whole gesture
  function registerPointer(ev){
    // Adopt any pending wheel-zoom before new gesture math runs, and capture
    // the viewport rect once per gesture for clientToWorld.
    flushZoomPreview();
    activePointers.set(ev.pointerId, {id:ev.pointerId, type:ev.pointerType || 'mouse', clientX:ev.clientX, clientY:ev.clientY});
    if(!pointerRect) pointerRect = svg.getBoundingClientRect();
  }
  function updatePointer(ev){ const p = activePointers.get(ev.pointerId); if(p){ p.clientX = ev.clientX; p.clientY = ev.clientY; } }
  function unregisterPointer(ev){ activePointers.delete(ev.pointerId); if(!activePointers.size) pointerRect = null; }
  function touchPointers(){ return [...activePointers.values()].filter(p => p.type === 'touch'); }
  function distClient(a,b){ return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1; }
  function centerClient(a,b){ return {clientX:(a.clientX + b.clientX) / 2, clientY:(a.clientY + b.clientY) / 2}; }
  function clientToWorld(clientX, clientY, viewBox=state.viewBox, rect=null){
    const r = rect || pointerRect || svg.getBoundingClientRect();
    // Match SVG preserveAspectRatio="xMidYMid meet" exactly, otherwise cursor-based
    // gestures drift when the canvas aspect ratio differs from the viewBox.
    const scale = Math.min(r.width / viewBox.w, r.height / viewBox.h);
    const offsetX = (r.width - viewBox.w * scale) / 2;
    const offsetY = (r.height - viewBox.h * scale) / 2;
    return {
      x: viewBox.x + (clientX - r.left - offsetX) / scale,
      y: viewBox.y + (clientY - r.top - offsetY) / scale
    };
  }
  function worldAtClient(clientX, clientY, viewBox=state.viewBox){ return clientToWorld(clientX, clientY, viewBox); }
  function maybeStartPinch(){
    const pts = touchPointers();
    if(pts.length < 2) return false;
    beginPinch(pts[0], pts[1]);
    return true;
  }
  function beginPinch(a,b){
    if(pinch) return;
    if(edgeDraft){ edgeDraft = null; dragLine.style.display = 'none'; dragLine.setAttribute('d',''); }
    if(drag){
      if(drag.fastNodeId) moveNodeFast(drag.fastNodeId);
      if(drag.moved) pushHistory('move node');
      const dragNodes = drag.nodes || (drag.node ? [drag.node] : []);
      for(const dn of dragNodes){ const el = nodeEl(dn.id); if(el) toggleClass(el, 'dragging', false); }
      drag = null;
      syncSelectionDom();
    }
    if(pan){
      state.viewBox = {...pan.previewViewBox};
      pan = null;
      clearFastPanTransform();
      applyViewBox();
    }
    pendingEdgeFrom = null; pendingNodeTap = null;
    const c = centerClient(a,b);
    pinch = { startDistance:distClient(a,b), startViewBox:{...state.viewBox}, startWorld:null, rect:svg.getBoundingClientRect(), previewViewBox:{...state.viewBox}, frame:false };
    pinch.startWorld = clientToWorld(c.clientX, c.clientY, state.viewBox, pinch.rect);
    $('#canvasWrap').classList.add('panning');
    setStatusOnly();
  }
  function updatePinch(){
    const pts = touchPointers();
    if(!pinch || pts.length < 2) return;
    const a = pts[0], b = pts[1], c = centerClient(a,b), r = pinch.rect || svg.getBoundingClientRect();
    const scale = clamp(pinch.startDistance / distClient(a,b), 0.05, 20);
    const nw = clamp(pinch.startViewBox.w * scale, 120, 20000);
    const nh = clamp(pinch.startViewBox.h * scale, 90, 20000);
    const previewScale = Math.min(r.width / nw, r.height / nh);
    const offsetX = (r.width - nw * previewScale) / 2;
    const offsetY = (r.height - nh * previewScale) / 2;
    pinch.previewViewBox = {
      x: pinch.startWorld.x - (c.clientX - r.left - offsetX) / previewScale,
      y: pinch.startWorld.y - (c.clientY - r.top - offsetY) / previewScale,
      w:nw,
      h:nh
    };
    if(!pinch.frame){
      pinch.frame = true;
      requestAnimationFrame(() => { if(pinch){ pinch.frame = false; applyPreviewViewBox(pinch.previewViewBox, pinch.startViewBox, pinch.rect); } });
    }
  }
  function endPinch(){
    if(!pinch) return;
    const done = pinch;
    state.viewBox = {...done.previewViewBox};
    pinch = null;
    clearFastPanTransform();
    applyViewBox();
    $('#canvasWrap').classList.remove('panning');
    saveSoon();
    setStatusOnly();
  }

  function selectionToolNeedsDrag(){ return state.mode === 'select' && ['rect','brush','lasso','line'].includes(state.selectTool); }
  function polygonToolActive(){ return state.mode === 'select' && state.selectTool === 'polygon'; }
  function beginSelectionDraft(ev){
    ev.preventDefault();
    try{ svg.setPointerCapture(ev.pointerId); }catch{}
    const p = pointFromEvent(ev);
    selectDraft = { tool:state.selectTool, pointerId:ev.pointerId, start:p, end:p, points:[p], combine:effectiveSelectCombine(ev), moved:false };
    $('#canvasWrap').classList.add('fast-interaction');
    renderSelectionDraft();
    setStatusOnly();
  }
  function sampleSelectionDraftPoint(p){
    // Stroke sampling runs on every pointermove: brush and lasso geometry
    // must not skip input samples.
    if(!selectDraft) return;
    selectDraft.end = p;
    if(Math.hypot(p.x - selectDraft.start.x, p.y - selectDraft.start.y) > 3) selectDraft.moved = true;
    if(['brush','lasso'].includes(selectDraft.tool)){
      const last = selectDraft.points[selectDraft.points.length - 1];
      if(!last || Math.hypot(p.x-last.x, p.y-last.y) > 6) selectDraft.points.push(p);
    }
  }
  function applySelectionDraft(){
    if(!selectDraft) return;
    if(selectDraft.tool === 'brush'){
      const hit = hitTestSelection(selectDraft, true);
      setSelectionLive(hit.nodes, hit.edges, selectDraft.combine || 'add');
    }
    renderSelectionDraft();
  }
  function updateSelectionDraft(p){
    if(!selectDraft) return;
    sampleSelectionDraftPoint(p);
    applySelectionDraft();
  }
  // The expensive part of a draft update — the O(V+E) brush hit test and the
  // overlay redraw — is coalesced to one per animation frame. pointermove
  // fires far above display rate (trackpads, high-Hz mice); only the latest
  // sampled state per frame matters visually.
  let selectDraftFrame = false;
  function scheduleSelectionDraftUpdate(p){
    if(!selectDraft) return;
    sampleSelectionDraftPoint(p);
    if(selectDraftFrame) return;
    selectDraftFrame = true;
    requestAnimationFrame(() => {
      selectDraftFrame = false;
      applySelectionDraft();
    });
  }
  function finishSelectionDraft(cancel=false){
    if(!selectDraft) return;
    const draft = selectDraft;
    selectDraft = null;
    selectionOverlayLayer.textContent = '';
    $('#canvasWrap').classList.remove('fast-interaction');
    if(!cancel){
      const hit = hitTestSelection(draft, false);
      setSelection(hit.nodes, hit.edges, null, draft.combine || 'replace');
      if(hit.nodes.length || hit.edges.length) toast(I18N.t('selected_n_m', {n: hit.nodes.length, m: hit.edges.length}));
    } else {
      // Brush strokes apply their selection live with the sidebar deferred;
      // make sure the panel catches up even when the gesture is cancelled.
      markSidebarDirty();
      queueRender(false);
    }
  }
  function polygonCloseThreshold(){ return Math.max(10, state.viewBox.w / 160); }
  function handlePolygonPointerDown(ev){
    if(ev.button !== 0) return false;
    ev.preventDefault();
    const p = pointFromEvent(ev);
    if(!selectDraft || selectDraft.tool !== 'polygon'){
      selectDraft = { tool:'polygon', points:[p], start:p, end:p, combine:effectiveSelectCombine(ev), moved:false };
      $('#canvasWrap').classList.add('fast-interaction');
      renderSelectionDraft();
      setStatusOnly();
      return true;
    }
    const pts = selectDraft.points;
    const first = pts[0];
    if(pts.length >= 3 && Math.hypot(p.x-first.x, p.y-first.y) <= polygonCloseThreshold()){
      finishPolygonSelection(false);
      return true;
    }
    const last = pts[pts.length-1];
    if(!last || Math.hypot(p.x-last.x, p.y-last.y) > 2) pts.push(p);
    selectDraft.end = p;
    renderSelectionDraft();
    return true;
  }
  function updatePolygonPreview(ev){
    if(!selectDraft || selectDraft.tool !== 'polygon') return false;
    selectDraft.end = pointFromEvent(ev);
    renderSelectionDraft();
    return true;
  }
  function finishPolygonSelection(cancel=false){
    if(!selectDraft || selectDraft.tool !== 'polygon') return;
    const draft = selectDraft;
    selectDraft = null;
    selectionOverlayLayer.textContent = '';
    $('#canvasWrap').classList.remove('fast-interaction');
    if(!cancel && draft.points.length >= 3){
      draft.end = draft.points[draft.points.length-1];
      const hit = hitTestSelection(draft, false);
      setSelection(hit.nodes, hit.edges, null, draft.combine || 'replace');
      toast(I18N.t('polygon_selected', {n: hit.nodes.length, m: hit.edges.length}));
    } else if(!cancel) toast('Polygon needs at least 3 points');
    setStatusOnly();
  }

  function renderSelectionDraft(){
    if(!selectDraft) return;
    selectionOverlayLayer.textContent = '';
    const d = selectDraft, pts = d.points;
    let el;
    if(d.tool === 'rect'){
      el = document.createElementNS(NS,'rect');
      const x = Math.min(d.start.x,d.end.x), y = Math.min(d.start.y,d.end.y), w = Math.abs(d.end.x-d.start.x), h = Math.abs(d.end.y-d.start.y);
      el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('width', w); el.setAttribute('height', h);
    } else if(d.tool === 'line'){
      el = document.createElementNS(NS,'line');
      el.setAttribute('x1', d.start.x); el.setAttribute('y1', d.start.y); el.setAttribute('x2', d.end.x); el.setAttribute('y2', d.end.y);
    } else if(d.tool === 'brush'){
      el = document.createElementNS(NS,'circle');
      el.setAttribute('cx', d.end.x); el.setAttribute('cy', d.end.y); el.setAttribute('r', (state.settings.brushDiameter || 80) / 2);
    } else if(d.tool === 'polygon'){
      const pathEl = document.createElementNS(NS,'path');
      const previewPts = [...pts];
      if(d.end && pts.length) previewPts.push(d.end);
      const path = previewPts.length ? 'M ' + previewPts.map(q => `${q.x} ${q.y}`).join(' L ') + (pts.length > 2 ? ` L ${pts[0].x} ${pts[0].y}` : '') : '';
      pathEl.setAttribute('d', path);
      pathEl.setAttribute('class', 'selection-draft fill-soft');
      selectionOverlayLayer.appendChild(pathEl);
      if(pts.length){
        const start = document.createElementNS(NS,'circle');
        start.setAttribute('cx', String(pts[0].x)); start.setAttribute('cy', String(pts[0].y)); start.setAttribute('r', String(Math.max(5, state.viewBox.w / 220)));
        start.setAttribute('class','selection-draft');
        selectionOverlayLayer.appendChild(start);
      }
      return;
    } else {
      el = document.createElementNS(NS,'path');
      const path = pts.length ? 'M ' + pts.map(q => `${q.x} ${q.y}`).join(' L ') + (d.tool === 'lasso' && pts.length > 2 ? ' Z' : '') : '';
      el.setAttribute('d', path);
      el.classList.add('fill-soft');
    }
    el.setAttribute('class', (el.getAttribute('class') || '') + ' selection-draft');
    selectionOverlayLayer.appendChild(el);
  }
  function hitTestSelection(draft, liveBrush=false){
    const nodes = [], edges = [];
    const tool = draft.tool;
    const minX = Math.min(draft.start.x,draft.end.x), maxX = Math.max(draft.start.x,draft.end.x), minY = Math.min(draft.start.y,draft.end.y), maxY = Math.max(draft.start.y,draft.end.y);
    const pts = draft.points.length ? draft.points : [draft.start, draft.end];
    const inRect = p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    const nearLine = p => distToSegment(p, draft.start, draft.end) <= Math.max(22, state.viewBox.w / 220);
    const brushRadius = (state.settings.brushDiameter || 80) / 2;
    const nearBrush = p => pts.some(q => Math.hypot(p.x-q.x, p.y-q.y) <= brushRadius);
    const inPoly = p => pts.length > 2 && pointInPolygon(p, pts);
    const test = p => tool === 'rect' ? inRect(p) : tool === 'line' ? nearLine(p) : tool === 'brush' ? nearBrush(p) : inPoly(p);
    for(const n of state.nodes) if(test(n)) nodes.push(n.id);
    for(const e of state.edges){
      const a = nodeById(e.from), b = nodeById(e.to); if(!a || !b) continue;
      const mid = {x:(a.x+b.x)/2, y:(a.y+b.y)/2};
      if(test(mid) || (tool === 'brush' && pts.some(q => distToSegment(q, a, b) <= brushRadius)) || (tool === 'rect' && (inRect(a) || inRect(b))) || (tool === 'line' && segmentNearSegment(draft.start, draft.end, a, b, 20))) edges.push(e.id);
    }
    return {nodes, edges};
  }
  function distToSegment(p,a,b){
    const dx=b.x-a.x, dy=b.y-a.y, len2=dx*dx+dy*dy || 1;
    const t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/len2,0,1);
    const x=a.x+t*dx, y=a.y+t*dy;
    return Math.hypot(p.x-x,p.y-y);
  }
  function segmentNearSegment(a,b,c,d,threshold){
    return distToSegment(c,a,b) <= threshold || distToSegment(d,a,b) <= threshold || distToSegment(a,c,d) <= threshold || distToSegment(b,c,d) <= threshold;
  }
  function pointInPolygon(p, poly){
    let inside=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
      const intersect=((yi>p.y)!==(yj>p.y)) && (p.x < (xj-xi)*(p.y-yi)/((yj-yi)||1e-9)+xi);
      if(intersect) inside=!inside;
    }
    return inside;
  }

  function pointFromEvent(ev){ return clientToWorld(ev.clientX, ev.clientY, state.viewBox); }
  function onNodePointerDown(ev, id){
    ev.preventDefault(); ev.stopPropagation(); try{ svg.setPointerCapture(ev.pointerId); }catch{}
    registerPointer(ev);
    if(ev.button === 1 || ev.button === 2){
      pendingEdgeFrom = null;
      startPan(ev);
      return;
    }
    if(ev.button !== 0) return;
    if(maybeStartPinch()) return;
    if(state.mode === 'move'){
      pendingEdgeFrom = null;
      startPan(ev);
      return;
    }
    if(polygonToolActive()){
      pendingEdgeFrom = null;
      handlePolygonPointerDown(ev);
      return;
    }
    if(selectionToolNeedsDrag()){
      pendingEdgeFrom = null;
      beginSelectionDraft(ev);
      return;
    }
    const p = pointFromEvent(ev);
    if(state.mode === 'edge'){
      if(pendingEdgeFrom && pendingEdgeFrom !== id){
        const from = pendingEdgeFrom; pendingEdgeFrom = null; addEdge(from, id); return;
      }
      pendingEdgeFrom = null;
      selectItem('node', id);
      edgeDraft = { from:id, x:p.x, y:p.y, startClientX:ev.clientX, startClientY:ev.clientY, moved:false };
      updateDragLine(p); setStatusOnly(); return;
    }
    if(state.mode !== 'select' && state.mode !== 'node'){
      selectItem('node', id);
      return;
    }
    const combine = effectiveSelectCombine(ev);
    const wasSelected = isNodeSelected(id);

    if(combine === 'subtract'){
      setSelection([id], [], null, 'subtract');
      return;
    }

    const n = nodeById(id);

    // === ROBUST GROUP DRAG FIX ===
    // When the clicked node is already in the current multi-selection,
    // do NOT call setSelection (which would collapse it in Override mode).
    // Instead, keep the existing selection and start dragging the whole group.
    if (!wasSelected) {
      setSelection([id], [], {type:'node', id}, combine);
    } else {
      // Already selected → preserve the group. Only update primary if needed.
      if (!state.selected || state.selected.id !== id) {
        state.selected = {type:'node', id};
        syncSelectionDom();
        renderSidebar();
      }
    }

    // Build the list of nodes that will actually be dragged
    const selectedIds = selectedNodeIds();
    let dragNodes = [...selectedIds].map(nodeById).filter(Boolean);
    if (!dragNodes.length) {
      dragNodes = [n];
    }

    const dragStarts = new Map(dragNodes.map(node => [node.id, {x:node.x, y:node.y}]));
    const dragIdSet = new Set(dragNodes.map(node => node.id));
    const affectedEdges = state.edges.filter(e => dragIdSet.has(e.from) || dragIdSet.has(e.to));
    drag = { nodeId:id, node:n, nodes:dragNodes, starts:dragStarts, ignoreIds:dragIdSet, startX:n.x, startY:n.y, offsetX:p.x-n.x, offsetY:p.y-n.y, moved:false, affectedEdges, liveEdges: affectedEdges.length <= DRAG_LIVE_EDGE_LIMIT, fastFrame:false, fastNodeId:null, vc:null };
    for(const dn of dragNodes){ const el = nodeEl(dn.id); if(el) toggleClass(el, 'dragging', true); }
    $('#canvasWrap').classList.add('fast-interaction');
    setStatusOnly();
  }
  svg.addEventListener('pointerdown', ev => {
    svg.focus();
    registerPointer(ev);
    if(maybeStartPinch()) return;
    if(ev.button === 1 || ev.button === 2 || spaceDown || state.mode === 'move'){
      pendingEdgeFrom = null;
      startPan(ev);
      return;
    }
    if(ev.button !== 0) return;
    if(ev.target.closest && ev.target.closest('.node,.edge')) return;
    if(polygonToolActive()){
      pendingEdgeFrom = null;
      handlePolygonPointerDown(ev);
      return;
    }
    if(selectionToolNeedsDrag()){
      pendingEdgeFrom = null;
      beginSelectionDraft(ev);
      return;
    }
    if(state.mode === 'node'){
      pendingEdgeFrom = null;
      const p = pointFromEvent(ev);
      if(ev.pointerType === 'touch'){
        pendingNodeTap = { mode:'node', pointerId:ev.pointerId, startClientX:ev.clientX, startClientY:ev.clientY, x:p.x, y:p.y, moved:false };
      } else addNode(p.x, p.y);
      return;
    }
    if(state.mode === 'select') deselect();
  });
  svg.addEventListener('dblclick', ev => {
    if(polygonToolActive() && selectDraft?.tool === 'polygon'){
      ev.preventDefault();
      finishPolygonSelection(false);
      return;
    }
    // Node creation is intentionally handled only by Node-mode pointerdown/tap.
    // This avoids accidental nodes from double-clicks in selection tools or edge mode.
  });
  svg.addEventListener('pointermove', ev => {
    updatePointer(ev);
    // Pending wheel-zoom distorts clientToWorld (the preview lives in a CSS
    // transform, not the viewBox). Commit it before any gesture math.
    if(zoomPreview) flushZoomPreview();
    if(pinch){ updatePinch(); return; }
    if(pan){
      // Keep the real SVG viewBox frozen for the whole gesture. Updating it on
      // every pointer event forces a full vector layout/paint. Instead, move one
      // scene group with a temporary matrix and commit the viewBox on pointerup.
      const rect = pan.rect || svg.getBoundingClientRect();
      const start = pan.startViewBox;
      const scale = Math.min(rect.width / start.w, rect.height / start.h);
      const dx = (ev.clientX - pan.startClientX) / scale;
      const dy = (ev.clientY - pan.startClientY) / scale;
      pan.previewViewBox = {...start, x:start.x - dx, y:start.y - dy};
      if(!pan.frame){
        pan.frame = true;
        requestAnimationFrame(() => {
          if(pan){
            pan.frame = false;
            applyPreviewViewBox(pan.previewViewBox, pan.startViewBox, pan.rect);
          }
        });
      }
      return;
    }
    const p = pointFromEvent(ev);
    if(selectDraft?.tool === 'polygon'){ updatePolygonPreview(ev); return; }
    if(selectDraft && ev.pointerId === selectDraft.pointerId){ scheduleSelectionDraftUpdate(p); return; }
    if(pendingNodeTap && ev.pointerId === pendingNodeTap.pointerId){
      if(Math.hypot(ev.clientX - pendingNodeTap.startClientX, ev.clientY - pendingNodeTap.startClientY) > 10) pendingNodeTap.moved = true;
      pendingNodeTap.x = p.x; pendingNodeTap.y = p.y;
    }
    if(edgeDraft){
      edgeDraft.x = p.x; edgeDraft.y = p.y;
      if(Math.hypot(ev.clientX - edgeDraft.startClientX, ev.clientY - edgeDraft.startClientY) > 8) edgeDraft.moved = true;
      updateDragLine(p); return;
    }
    if(drag){
      const n = drag.node; if(!n) return;
      let x = p.x - drag.offsetX, y = p.y - drag.offsetY;
      ({x, y} = snapPointToEnabled(x, y, drag.ignoreIds || n.id));
      const dx = x - drag.startX, dy = y - drag.startY;
      if(Math.abs(dx) > .5 || Math.abs(dy) > .5) drag.moved = true;
      for(const dn of (drag.nodes || [n])){
        const st = drag.starts?.get(dn.id) || {x:dn.x, y:dn.y};
        dn.x = st.x + dx; dn.y = st.y + dy;
      }
      scheduleFastNodeMove(n.id); return;
    }
  });
  svg.addEventListener('pointerup', ev => finishPointer(ev));
  svg.addEventListener('pointercancel', ev => finishPointer(ev, true));
  function finishPointer(ev, cancel=false){
    if(zoomPreview) flushZoomPreview(); // hit-testing must see committed geometry
    if(pinch){
      unregisterPointer(ev);
      if(touchPointers().length < 2) endPinch();
      return;
    }
    if(selectDraft && ev.pointerId === selectDraft.pointerId){
      finishSelectionDraft(cancel);
      unregisterPointer(ev);
      return;
    }
    if(pendingNodeTap && ev.pointerId === pendingNodeTap.pointerId){
      const tap = pendingNodeTap;
      pendingNodeTap = null;
      if(!cancel && !tap.moved && tap.mode === 'node' && state.mode === 'node') addNode(tap.x, tap.y);
      unregisterPointer(ev);
      return;
    }
    if(edgeDraft){
      const elAtPoint = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = elAtPoint?.closest?.('.node') as HTMLElement | null;
      const to = target?.dataset.id;
      const from = edgeDraft.from;
      const wasTap = !edgeDraft.moved;
      edgeDraft = null; dragLine.style.display = 'none'; dragLine.setAttribute('d','');
      if(!cancel && to && (!wasTap || to !== from)) addEdge(from,to);
      else if(!cancel && wasTap && ev.pointerType === 'touch'){
        pendingEdgeFrom = from;
        state.selected = {type:'node', id:from};
        setStatusOnly();
        toast(I18N.t('source_tap_target'));
        queueRender(false);
      } else queueRender(false);
    }
    if(drag){
      if(drag.fastNodeId) moveDragFast();
      if(drag.moved) pushHistory('move node');
      // Robust cleanup: always remove dragging class and reset state
      try {
        if (drag.nodes) {
          for(const dn of drag.nodes){
            const el = nodeEl(dn.id);
            if(el) toggleClass(el, 'dragging', false);
          }
        }
      } catch(e){}
      const moved = drag.moved, edgesWereLive = drag.liveEdges !== false;
      drag = null;
      $('#canvasWrap').classList.remove('fast-interaction');
      // A click that never moved left the canvas untouched (selection is synced
      // directly), and a live-edge drag already patched every transform and path
      // frame-by-frame — either way the full re-render pass is unnecessary.
      // Only drags whose edges were frozen (very high degree) need a re-render.
      if(moved && !edgesWereLive) queueRender(false);
    }
    if(pan){
      const completedPan = pan;
      state.viewBox = {...completedPan.previewViewBox};
      pan = null;
      clearFastPanTransform();
      applyViewBox();
      $('#canvasWrap').classList.remove('panning'); saveSoon(); setStatusOnly();
    }
    unregisterPointer(ev);
  }
  function updateDragLine(p){
    const from = nodeById(edgeDraft.from); if(!from) return;
    dragLine.setAttribute('d', `M ${from.x} ${from.y} L ${p.x} ${p.y}`); dragLine.style.display = 'block';
  }
  function startPan(ev){
    ev.preventDefault();
    try{ svg.setPointerCapture(ev.pointerId); }catch{}
    pan = {
      startClientX:ev.clientX,
      startClientY:ev.clientY,
      startViewBox:{...state.viewBox},
      previewViewBox:{...state.viewBox},
      rect:svg.getBoundingClientRect(),
      frame:false
    };
    $('#canvasWrap').classList.add('panning');
    setStatusOnly();
  }

  svg.addEventListener('wheel', ev => { ev.preventDefault(); zoomAt(ev.deltaY < 0 ? 0.88 : 1.14, ev.clientX, ev.clientY); }, {passive:false});
  // === Composited wheel zoom ===
  // Changing the SVG viewBox re-lays-out and re-rasterizes every vector
  // element. Wheel events only drive a GPU-composited CSS transform preview
  // (the same mechanism panning uses); the real viewBox is applied exactly
  // once, when the wheel settles.
  let zoomPreview = null; // {base, preview, rect, frame, timer}
  const ZOOM_COMMIT_DELAY = 140;
  function zoomAt(factor, clientX, clientY){
    // A wheel arriving mid pan/pinch would fight the gesture's transform —
    // finalize the gesture first so zoom starts from what is on screen.
    if(pan){
      state.viewBox = {...pan.previewViewBox};
      pan = null;
      clearFastPanTransform();
      $('#canvasWrap').classList.remove('panning');
    }
    if(pinch) endPinch();
    const base = zoomPreview ? zoomPreview.base : {...state.viewBox};
    const cur = zoomPreview ? zoomPreview.preview : state.viewBox;
    const r = zoomPreview ? zoomPreview.rect : svg.getBoundingClientRect();
    const cx = (clientX - r.left) / r.width, cy = (clientY - r.top) / r.height;
    const wx = cur.x + cx * cur.w, wy = cur.y + cy * cur.h;
    const nw = clamp(cur.w * factor, 120, 20000), nh = clamp(cur.h * factor, 90, 20000);
    const preview = { x: wx - cx * nw, y: wy - cy * nh, w: nw, h: nh };
    if(!zoomPreview) zoomPreview = { base, preview, rect: r, frame: false, timer: null };
    else zoomPreview.preview = preview;
    if(!zoomPreview.frame){
      zoomPreview.frame = true;
      requestAnimationFrame(() => {
        if(!zoomPreview) return;
        zoomPreview.frame = false;
        applyPreviewViewBox(zoomPreview.preview, zoomPreview.base, zoomPreview.rect);
      });
    }
    clearTimeout(zoomPreview.timer);
    zoomPreview.timer = setTimeout(commitZoomPreview, ZOOM_COMMIT_DELAY);
  }
  function commitZoomPreview(){
    if(!zoomPreview) return;
    const z = zoomPreview; zoomPreview = null;
    clearTimeout(z.timer);
    state.viewBox = {...z.preview};
    clearFastPanTransform();
    applyViewBox();
    saveSoon();
  }
  function flushZoomPreview(){ if(zoomPreview) commitZoomPreview(); }
  function fitView(){
    if(!state.nodes.length){ state.viewBox = {x:-500,y:-330,w:1000,h:660}; queueRender(false); saveSoon(); return; }
    const xs = state.nodes.map(n=>n.x), ys = state.nodes.map(n=>n.y);
    const minX=Math.min(...xs)-120, maxX=Math.max(...xs)+120, minY=Math.min(...ys)-120, maxY=Math.max(...ys)+120;
    state.viewBox = {x:minX, y:minY, w:Math.max(260,maxX-minX), h:Math.max(220,maxY-minY)}; queueRender(false); saveSoon();
  }

  function editNodeQuick(id){ const n=nodeById(id); if(!n) return; const val=prompt(I18N.t('node_label_prompt'), n.label); if(val !== null){ n.label = val.trim().slice(0,80); pushHistory('rename node'); queueRender(true); } }
  function editEdgeQuick(id){ const e=edgeById(id); if(!e) return; const val=prompt(I18N.t('edge_weight_prompt'), e.weight ?? ''); if(val !== null){ const t = val.trim().slice(0,50); if(t === '') delete e.weight; else e.weight = t; pushHistory('edit edge'); queueRender(true); } }

  // Standardized precision for all coordinate exports — 4 decimals prevents drift across round-trips
