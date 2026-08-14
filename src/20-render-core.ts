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
    applyViewBox();
    updateGridBackground();
    gridPattern.setAttribute('width', String(state.settings.gridSizeX));
    gridPattern.setAttribute('height', String(state.settings.gridSizeY));
    const paths = state.nodes.length;
    $('#canvasWrap').classList.toggle('empty', paths === 0);
    $('#statsPill').textContent = I18N.t('n_nodes_m_edges', {n: state.nodes.length, m: state.edges.length});
    $('#statusPill').textContent = statusText();
    renderEdges();
    renderNodes();
    updateUndoRedo();
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
    svg.setAttribute('viewBox', `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.w} ${state.viewBox.h}`);
    updateGridBackground(state.viewBox);
    syncCameraInputs();
  }
  function fastTransformLayers(){ return [edgesLayer, dragLine, selectionOverlayLayer, nodesLayer].filter(Boolean); }
  function setLayerMatrix(scale, tx, ty){
    const t = `matrix(${scale} 0 0 ${scale} ${tx} ${ty})`;
    for(const el of fastTransformLayers()) el.setAttribute('transform', t);
  }
  function applyPreviewViewBox(preview, base=state.viewBox, rect=null){
    const scale = base.w / preview.w;
    const tx = base.x - scale * preview.x;
    const ty = base.y - scale * preview.y;
    setLayerMatrix(scale, tx, ty);
    updateGridBackground(preview, rect);
  }
  function clearFastPanTransform(){ for(const el of fastTransformLayers()) el.removeAttribute('transform'); updateGridBackground(state.viewBox); }
  function hexToRgba(hex, alpha){
    const h = String(hex || '#94a3b8').replace('#','');
    if(h.length !== 6) return `rgba(148,163,184,${alpha})`;
    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  function updateGridBackground(vb=state.viewBox, cachedRect=null){
    const rect = cachedRect || svg.getBoundingClientRect();
    const s = state.settings;
    const gx = s.gridSizeX || s.gridSize || 40;
    const gy = s.gridSizeY || s.gridSize || 40;
    // Apply background color
    svg.style.backgroundColor = s.canvasBgColor || '#020617';
    // Apply grid colors via CSS variables
    svg.style.setProperty('--grid-minor-color', hexToRgba(s.gridMinorColor, s.gridMinorAlpha ?? 0.105));
    svg.style.setProperty('--grid-major-color', hexToRgba(s.gridMajorColor, s.gridMajorAlpha ?? 0.16));
    // Match SVG's default preserveAspectRatio="xMidYMid meet": one uniform world-to-screen scale.
    const scale = Math.min(rect.width / vb.w, rect.height / vb.h);
    const offsetX = (rect.width - vb.w * scale) / 2;
    const offsetY = (rect.height - vb.h * scale) / 2;
    const cellX = Math.max(4, gx * scale), cellY = Math.max(4, gy * scale);
    const majorXSize = cellX * 5, majorYSize = cellY * 5;
    const mod = (v, m) => ((v % m) + m) % m;
    const minorX = mod(offsetX - vb.x * scale, cellX);
    const minorY = mod(offsetY - vb.y * scale, cellY);
    const majorX = mod(offsetX - vb.x * scale, majorXSize);
    const majorY = mod(offsetY - vb.y * scale, majorYSize);
    svg.style.setProperty('--grid-px', `${cellX}px`);
    svg.style.setProperty('--grid-py', `${cellY}px`);
    svg.style.setProperty('--major-grid-px', `${majorXSize}px`);
    svg.style.setProperty('--major-grid-py', `${majorYSize}px`);
    svg.style.setProperty('--grid-pos-x', `${minorX}px`); svg.style.setProperty('--grid-pos-y', `${minorY}px`);
    svg.style.setProperty('--major-grid-pos-x', `${majorX}px`); svg.style.setProperty('--major-grid-pos-y', `${majorY}px`);
  }
  function requestViewBoxApply(){
    if(viewBoxFrame) return;
    viewBoxFrame = true;
    requestAnimationFrame(() => { viewBoxFrame = false; applyViewBox(); });
  }
  function setStatusOnly(){ $('#statusPill').textContent = statusText(); }
  function nodeEl(id){ return document.getElementById('node-' + id); }
  function edgeEl(id){ return document.getElementById('edge-' + id); }
  function moveNodeFast(id){
    const n = drag?.node?.id === id ? drag.node : nodeById(id); if(!n) return;
    const el = nodeEl(id); if(el) el.setAttribute('transform', `translate(${n.x},${n.y})`);
    if(drag && drag.liveEdges === false) return;
    const edges = drag?.affectedEdges || state.edges.filter(e => e.from === id || e.to === id);
    for(const edge of edges) updateEdgeFast(edge);
  }
  function moveDragFast(){
    if(!drag) return;
    try {
      const nodes = drag.nodes || (drag.node ? [drag.node] : []);
      for(const n of nodes){
        const el = nodeEl(n.id); if(el) el.setAttribute('transform', `translate(${n.x},${n.y})`);
      }
      if(drag.liveEdges === false) return;
      for(const edge of (drag.affectedEdges || [])) updateEdgeFast(edge);
    } catch(e) { /* fail-safe */ }
  }
  function updateEdgeFast(edgeOrId){
    const e = typeof edgeOrId === 'object' ? edgeOrId : edgeById(edgeOrId); if(!e) return;
    const getNode = drag?.nodeMap ? id => drag.nodeMap.get(id) : nodeById;
    const a = getNode(e.from), b = getNode(e.to); if(!a || !b) return;
    const el = edgeEl(e.id); if(!el) return;
    const d = edgePath(a,b,e);
    const line = el.querySelector('.edge-line'); if(line) line.setAttribute('d', d.path);
    const hit = el.querySelector('.edge-hit'); if(hit) hit.setAttribute('d', d.path);
    const label = el.querySelector('.edge-label');
    const weight = el.querySelector('.edge-weight');
    const hasBoth = label && weight;
    const labelOffsetY = hasBoth ? -((edgeVisual(e).labelSize || 12) * 0.75 + 2) : 0;
    if(label){ label.setAttribute('x', d.labelX); label.setAttribute('y', d.labelY + labelOffsetY); }
    if(weight){ weight.setAttribute('x', d.labelX); weight.setAttribute('y', d.labelY); }
    // Update arrow tip position/angle during drag
    const arrow = el.querySelector('.edge-arrow');
    if(arrow && e.directed && d.tipX != null && d.arrowAngle != null){
      const aw = ARROW_HW, ang = d.arrowAngle;
      const sin = Math.sin(ang), cos = Math.cos(ang);
      const px = -sin, py = cos;
      const baseX = d.tx, baseY = d.ty;
      const leftX = baseX + px * aw, leftY = baseY + py * aw;
      const rightX = baseX - px * aw, rightY = baseY - py * aw;
      arrow.setAttribute('points', `${d.tipX},${d.tipY} ${leftX},${leftY} ${rightX},${rightY}`);
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
