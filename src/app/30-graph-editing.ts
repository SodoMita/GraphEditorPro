  function setMode(mode, render=true){
    if(mode !== 'edge') pendingEdgeFrom = null;
    state.mode = mode;
    $$('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    $('#canvasWrap').classList.toggle('move-mode', mode === 'move');
    if(render) { setStatusOnly(); saveSoon(); }
  }
  function setSelectTool(tool, render=true){
    if(selectDraft?.tool === 'polygon' && tool !== 'polygon') finishPolygonSelection(true);
    if(['adjacent','directedAdjacent'].includes(tool)){
      expandSelection(tool === 'directedAdjacent');
      return;
    }
    state.selectTool = ['single','rect','brush','lasso','line','polygon'].includes(tool) ? tool : 'single';
    $$('[data-selecttool]').forEach(b => b.classList.toggle('active', b.dataset.selecttool === state.selectTool));
    if(render) { setMode('select'); saveSoon(); }
  }
  function setSelectCombine(mode, render=true){
    state.selectCombine = ['replace','add','subtract'].includes(mode) ? mode : 'replace';
    $$('[data-selectcombine]').forEach(b => b.classList.toggle('active', b.dataset.selectcombine === state.selectCombine));
    if(render) saveSoon();
  }
  function effectiveSelectCombine(ev=null){ return ev?.shiftKey ? 'add' : (state.selectCombine || 'replace'); }
  function selectedNodeIds(){ return new Set(state.selection?.nodes || []); }
  function selectedEdgeIds(){ return new Set(state.selection?.edges || []); }
  function isNodeSelected(id){ return selectedNodeIds().has(id); }
  function isEdgeSelected(id){ return selectedEdgeIds().has(id); }
  function setSelection(
    nodes: string[] = [],
    edges: string[] = [],
    primary: GraphState['selected'] = null,
    combine: SelectionCombine | boolean | null = 'replace'
  ){
    const selectionMode: SelectionCombine = combine === true ? 'add' :
      (combine === false || combine == null ? 'replace' : combine);
    const nodeSet: Set<string> = selectionMode === 'replace' ? new Set<string>() : selectedNodeIds();
    const edgeSet: Set<string> = selectionMode === 'replace' ? new Set<string>() : selectedEdgeIds();
    if(selectionMode === 'subtract'){
      nodes.forEach(id => nodeSet.delete(id));
      edges.forEach(id => edgeSet.delete(id));
    } else {
      nodes.forEach(id => nodeById(id) && nodeSet.add(id));
      edges.forEach(id => edgeById(id) && edgeSet.add(id));
    }
    state.selection = { nodes:[...nodeSet], edges:[...edgeSet] };
    if(primary && ((primary.type === 'node' && nodeSet.has(primary.id)) || (primary.type === 'edge' && edgeSet.has(primary.id)))) state.selected = primary;
    else if(state.selection.nodes.length) state.selected = {type:'node', id:state.selection.nodes[0]};
    else if(state.selection.edges.length) state.selected = {type:'edge', id:state.selection.edges[0]};
    else state.selected = null;
    syncSelectionDom();
    renderSidebar();
    setStatusOnly();
  }
  function selectItem(type,id){ setSelection(type === 'node' ? [id] : [], type === 'edge' ? [id] : [], {type,id}, false); }
  function deselect(){ if(state.selected || state.selection?.nodes?.length || state.selection?.edges?.length) setSelection([], [], null, false); }
  // Mirror of the selection currently reflected in the DOM. syncSelectionDom
  // used to walk and re-toggle every rendered node and edge on every click;
  // with large graphs that is thousands of class operations per click. Only
  // the elements whose state actually changed are touched now — O(delta).
  let domSelectedNodes = new Set<string>(), domSelectedEdges = new Set<string>();
  function resetSelectionMirror(){
    // Called after a full render pass: renderEdges/renderNodes just applied the
    // exact selection state to every element, so the mirror can adopt it.
    domSelectedNodes = selectedNodeIds();
    domSelectedEdges = selectedEdgeIds();
  }
  function syncSelectionDom(){
    const ns = selectedNodeIds(), es = selectedEdgeIds();
    for(const id of domSelectedNodes){
      if(!ns.has(id)){ const el = nodeEl(id); if(el) toggleClass(el, 'selected', false); }
    }
    for(const id of ns){
      if(!domSelectedNodes.has(id)){ const el = nodeEl(id); if(el) toggleClass(el, 'selected', true); }
    }
    for(const id of domSelectedEdges){
      if(!es.has(id)){
        const el = edgeEl(id); if(!el) continue;
        toggleClass(el, 'selected', false);
        const arrow = (el as any).__arrow;
        if(arrow){ const e = edgeById(id); if(e && e.directed) setAttr(arrow, 'fill', edgeRenderStyleC(e).color); }
      }
    }
    for(const id of es){
      if(!domSelectedEdges.has(id)){
        const el = edgeEl(id); if(!el) continue;
        toggleClass(el, 'selected', true);
        const arrow = (el as any).__arrow;
        if(arrow){ const e = edgeById(id); if(e && e.directed) setAttr(arrow, 'fill', '#22d3ee'); }
      }
    }
    domSelectedNodes = ns; domSelectedEdges = es;
    updateMatrixSelectionDom();
  }
  function updateMatrixSelectionDom(){
    const host = $('#matrixHost');
    if(!host || !host.firstElementChild) return;
    // The matrix panel is hidden in "graph" view and its HTML is rebuilt from
    // the current selection whenever the view switches back — no need to sync.
    const mainEl = document.querySelector('.main');
    if(mainEl && (mainEl as HTMLElement).dataset?.view === 'graph') return;
    const ns = selectedNodeIds(), es = selectedEdgeIds();
    for(const input of host.querySelectorAll('[data-node-label]')){
      toggleClass(input, 'matrix-selected', ns.has(input.dataset.nodeLabel));
    }
    for(const input of host.querySelectorAll('[data-cell-from][data-cell-to]')){
      const ids = (input.dataset.cellEdges || '').split(',').filter(Boolean);
      let selected = false;
      for(let i = 0; i < ids.length; i++){ if(es.has(ids[i])){ selected = true; break; } }
      toggleClass(input, 'matrix-selected', selected);
    }
  }
  function selectMatrixNode(id, append=false){
    if(!nodeById(id)) return;
    setSelection([id], [], {type:'node', id}, append);
  }
  function selectMatrixCell(from, to, append=false){
    const ids = matrixCellEdgeIds(from, to);
    if(ids.length){
      setSelection([], ids, {type:'edge', id:ids[0]}, append);
    } else {
      // Empty cells have no edge to select; keep focus for editing, but clear edge selection unless appending.
      if(!append) setSelection([], [], null, false);
      updateMatrixSelectionDom();
    }
  }
  function expandSelection(directedOnly=false){
    const seeds = selectedNodeIds();
    if(!seeds.size && state.selected?.type === 'edge'){
      const e = edgeById(state.selected.id); if(e){ seeds.add(e.from); seeds.add(e.to); }
    }
    if(!seeds.size){ toast(I18N.t('select_at_least_one')); return; }
    const nodes = new Set(seeds), edges = new Set(selectedEdgeIds());
    for(const e of state.edges){
      if(directedOnly){
        if(seeds.has(e.from)){ nodes.add(e.to); edges.add(e.id); }
        else if(!e.directed && seeds.has(e.to)){ nodes.add(e.from); edges.add(e.id); }
      } else if(seeds.has(e.from) || seeds.has(e.to)){
        nodes.add(e.from); nodes.add(e.to); edges.add(e.id);
      }
    }
    setSelection([...nodes], [...edges], state.selected, false);
    toast(directedOnly ? I18N.t('selected_directed_adj') : I18N.t('selected_adjacent'));
  }

  function snapThresholdWorld(){
    return clamp(state.viewBox.w / 70, 10, 32);
  }
  function snapPointToEnabled(x, y, ignoreId=null){
    const ignored = ignoreId instanceof Set ? ignoreId : new Set(ignoreId ? [ignoreId] : []);
    if(state.settings.snap){
      const gx = state.settings.gridSizeX || state.settings.gridSize || 40;
      const gy = state.settings.gridSizeY || state.settings.gridSize || 40;
      x = Math.round(x / gx) * gx;
      y = Math.round(y / gy) * gy;
    }
    const threshold = snapThresholdWorld();
    if(state.settings.snapX){
      let best = null, bestDist = Infinity;
      for(const n of state.nodes){
        if(ignored.has(n.id)) continue;
        const d = Math.abs(n.x - x);
        if(d < bestDist && d <= threshold){ best = n.x; bestDist = d; }
      }
      if(best !== null) x = best;
    }
    if(state.settings.snapY){
      let best = null, bestDist = Infinity;
      for(const n of state.nodes){
        if(ignored.has(n.id)) continue;
        const d = Math.abs(n.y - y);
        if(d < bestDist && d <= threshold){ best = n.y; bestDist = d; }
      }
      if(best !== null) y = best;
    }
    return {x, y};
  }

  function snapAxisValue(axis, value, ignoreId=null){
    let v = finite(value, 0);
    if(state.settings.snap){
      const g = axis === 'x' ? (state.settings.gridSizeX || state.settings.gridSize || 40) : (state.settings.gridSizeY || state.settings.gridSize || 40);
      v = Math.round(v / g) * g;
    }
    const enabled = axis === 'x' ? state.settings.snapX : state.settings.snapY;
    if(enabled){
      const threshold = snapThresholdWorld();
      let best = null, bestDist = Infinity;
      for(const n of state.nodes){
        if(n.id === ignoreId) continue;
        const candidate = axis === 'x' ? n.x : n.y;
        const d = Math.abs(candidate - v);
        if(d < bestDist && d <= threshold){ best = candidate; bestDist = d; }
      }
      if(best !== null) v = best;
    }
    return v;
  }
  function coordinateBounds(n){
    const xs = state.nodes.map(node => node.x).concat([state.viewBox.x, state.viewBox.x + state.viewBox.w, n.x]);
    const ys = state.nodes.map(node => node.y).concat([state.viewBox.y, state.viewBox.y + state.viewBox.h, n.y]);
    return {
      minX: Math.floor(Math.min(...xs) - 300), maxX: Math.ceil(Math.max(...xs) + 300),
      minY: Math.floor(Math.min(...ys) - 300), maxY: Math.ceil(Math.max(...ys) + 300)
    };
  }

  function isPositionFree(x, y, ignoreIds=new Set()){
    const minDistance = R * 2 + 14;
    return state.nodes.every(n => ignoreIds.has(n.id) || Math.hypot(n.x - x, n.y - y) >= minDistance);
  }
  function findFreeNodePosition(x, y, ignoreIds=new Set()){
    if(isPositionFree(x, y, ignoreIds)) return {x, y};
    const step = R * 2 + 18;
    for(let ring=1; ring<=12; ring++){
      const radius = step * ring;
      const count = Math.max(8, ring * 10);
      const phase = (state.nodes.length % count) * Math.PI * 2 / count;
      for(let i=0; i<count; i++){
        const a = phase + i * Math.PI * 2 / count;
        const px = x + Math.cos(a) * radius;
        const py = y + Math.sin(a) * radius;
        if(isPositionFree(px, py, ignoreIds)) return {x:px, y:py};
      }
    }
    return {x:x + step * 13, y};
  }

  function addNode(x,y){
    ({x, y} = snapPointToEnabled(x, y));
    ({x, y} = findFreeNodePosition(x, y));
    ({x, y} = snapPointToEnabled(x, y));
    if(!isPositionFree(x, y)) ({x, y} = findFreeNodePosition(x, y));
    const custom = $('#nodeLabel').value.trim();
    const s = state.settings;
    const label = s.noLabel ? '' : (custom ? (custom.length <= 3 ? custom : custom.slice(0,80)) : labelFromNumber(state.nextNode));
    const n: GraphNode = { id:'n' + state.nextNode++, label, x, y, type:'', order: state.nodes.length };
    if(s.nodeType){
      n.type = s.nodeType;
      // If a type style exists for this type, leave style props unset so
      // the type style takes effect (nodeVisual falls through to typeStyles).
      const ts = state.settings.nodeTypeStyles && state.settings.nodeTypeStyles[s.nodeType];
      if(ts){
        if(!ts.shape) n.shape = s.nodeShape; else n.shape = '';
        if(!ts.color) n.color = s.nodeColor; else n.color = '';
        if(ts.width == null) n.width = s.nodeWidth;
        if(ts.height == null) n.height = s.nodeHeight;
        if(!ts.strokeColor) n.strokeColor = s.nodeStrokeColor; else n.strokeColor = '';
        if(ts.strokeSize == null) n.strokeSize = s.nodeStrokeSize;
        if(!ts.strokeStyle) n.strokeStyle = s.nodeStrokeStyle; else n.strokeStyle = '';
        if(!ts.labelColor) n.labelColor = s.nodeLabelColor; else n.labelColor = '';
        if(ts.labelSize == null) n.labelSize = s.nodeLabelSize;
        if(!ts.labelFont) n.labelFont = s.nodeLabelFont;
        if(!ts.labelPosition) n.labelPosition = s.nodeLabelPosition; else n.labelPosition = '';
      } else {
        n.shape = s.nodeShape; n.color = s.nodeColor;
        n.width = s.nodeWidth; n.height = s.nodeHeight;
        n.strokeColor = s.nodeStrokeColor; n.strokeSize = s.nodeStrokeSize; n.strokeStyle = s.nodeStrokeStyle;
        n.labelColor = s.nodeLabelColor; n.labelFont = s.nodeLabelFont; n.labelSize = s.nodeLabelSize; n.labelPosition = s.nodeLabelPosition;
      }
    } else {
      n.shape = s.nodeShape; n.color = s.nodeColor;
      n.width = s.nodeWidth; n.height = s.nodeHeight;
      n.strokeColor = s.nodeStrokeColor; n.strokeSize = s.nodeStrokeSize; n.strokeStyle = s.nodeStrokeStyle;
      n.labelColor = s.nodeLabelColor; n.labelFont = s.nodeLabelFont; n.labelSize = s.nodeLabelSize; n.labelPosition = s.nodeLabelPosition;
    }
    state.nodes.push(n); setSelection([n.id], [], {type:'node', id:n.id}, false); pushHistory('add node'); queueRender(true, true);
  }
  function addEdge(from,to){
    if(!nodeById(from) || !nodeById(to)) return;
    const s = state.settings;
    const e: GraphEdge = { id:'e' + state.nextEdge++, from, to, label: String(s.edgeLabel || '').slice(0,80), directed: Boolean(s.directed), type:'' };
    if(s.edgeWeight !== '') e.weight = String(s.edgeWeight).slice(0,50);
    if(s.edgeType){
      e.type = s.edgeType;
      const ts = state.settings.edgeTypeStyles && state.settings.edgeTypeStyles[s.edgeType];
      if(ts){
        if(!ts.color) e.color = s.edgeColor; else e.color = '';
        if(ts.strokeSize == null) e.strokeSize = s.edgeStrokeSize;
        if(!ts.strokeStyle) e.strokeStyle = s.edgeStrokeStyle; else e.strokeStyle = '';
        if(!ts.labelColor) e.labelColor = s.edgeLabelColor; else e.labelColor = '';
        if(ts.labelSize == null) e.labelSize = s.edgeLabelSize;
        if(!ts.labelFont) e.labelFont = s.edgeLabelFont;
      } else {
        e.color = s.edgeColor; e.strokeSize = s.edgeStrokeSize; e.strokeStyle = s.edgeStrokeStyle;
        e.labelColor = s.edgeLabelColor; e.labelFont = s.edgeLabelFont; e.labelSize = s.edgeLabelSize;
      }
    } else {
      e.color = s.edgeColor; e.strokeSize = s.edgeStrokeSize; e.strokeStyle = s.edgeStrokeStyle;
      e.labelColor = s.edgeLabelColor; e.labelFont = s.edgeLabelFont; e.labelSize = s.edgeLabelSize;
    }
    state.edges.push(e); setSelection([], [e.id], {type:'edge', id:e.id}, false); pushHistory('add edge'); queueRender(true, true);
  }
  function graphCenter(nodes=state.nodes){
    if(nodes.length){
      return { x:nodes.reduce((sum,n)=>sum+n.x,0)/nodes.length, y:nodes.reduce((sum,n)=>sum+n.y,0)/nodes.length };
    }
    return { x:state.viewBox.x + state.viewBox.w/2, y:state.viewBox.y + state.viewBox.h/2 };
  }
  function circlePositionsForNewNodes(count, aroundNodes=state.nodes){
    count = Math.max(1, count|0);
    const c = graphCenter(aroundNodes.length ? aroundNodes : state.nodes);
    const radius = count === 1
      ? Math.max(130, Math.min(360, Math.sqrt(Math.max(2, state.nodes.length + 1)) * 70))
      : Math.max(120, Math.min(520, count * 26));
    const startAngle = count === 1
      ? -Math.PI / 2 + ((state.nodes.length % 12) / 12) * Math.PI * 2
      : -Math.PI / 2;
    return Array.from({length:count}, (_,i) => {
      const a = startAngle + (count === 1 ? 0 : i * Math.PI * 2 / count);
      return { x:c.x + Math.cos(a) * radius, y:c.y + Math.sin(a) * radius };
    });
  }
  function createNode(label=null, x=null, y=null){
    const idx = state.nextNode++;
    if(x == null || y == null){
      const pos = circlePositionsForNewNodes(1)[0];
      x = pos.x; y = pos.y;
    }
    ({x, y} = findFreeNodePosition(x, y));
    const s = state.settings;
    const autoLabel = s.noLabel ? '' : (label || labelFromNumber(idx));
    const n: GraphNode = { id:'n' + idx, label:autoLabel, x, y, type:'', order: state.nodes.length };
    // Always bake edit-tab placement values
    if(s.nodeType) n.type = s.nodeType;
    n.shape = s.nodeShape; n.color = s.nodeColor;
    n.width = s.nodeWidth; n.height = s.nodeHeight;
    n.strokeColor = s.nodeStrokeColor; n.strokeSize = s.nodeStrokeSize; n.strokeStyle = s.nodeStrokeStyle;
    n.labelColor = s.nodeLabelColor; n.labelFont = s.nodeLabelFont; n.labelSize = s.nodeLabelSize; n.labelPosition = s.nodeLabelPosition;
    return n;
  }
  function addNodeFromMatrix(){
    const previousCount = state.nodes.length;
    const n = createNode();
    state.nodes.push(n);
    if(state.settings.matrixDimension && state.settings.matrixDimension >= previousCount){
      state.settings.matrixDimension = state.nodes.length;
    }
    setSelection([n.id], [], {type:'node', id:n.id}, false);
    pushHistory('add node from matrix');
    queueRender(true);
    toast(I18N.t('node_added_circle'));
  }
  function insertNodeFromMatrix(){
    const selected = new Set(state.selection?.nodes || []);
    if(!selected.size){ toast('Select one or more matrix row/column labels first. Insert adds before each selected node.'); return; }
    const selectedNodes = state.nodes.filter(n => selected.has(n.id));
    const positions = circlePositionsForNewNodes(selectedNodes.length, selectedNodes);
    let posIndex = 0;
    const newIds = [];
    const reordered = [];
    for(const node of state.nodes){
      if(selected.has(node.id)){
        const pos = positions[posIndex++];
        const inserted = createNode(null, pos.x, pos.y);
        reordered.push(inserted);
        newIds.push(inserted.id);
      }
      reordered.push(node);
    }
    state.nodes = reordered;
    if(state.settings.matrixDimension) state.settings.matrixDimension = clamp(state.settings.matrixDimension + newIds.length, 0, 300);
    setSelection(newIds, [], newIds.length ? {type:'node', id:newIds[0]} : null, false);
    pushHistory('insert node before selected');
    queueRender(true);
    toast(I18N.t('inserted_n_before', {n: newIds.length}));
  }
  function setMatrixDimension(count){
    count = clamp(parseInt(count,10) || 0, 0, 300);
    const current = state.nodes.length;
    state.settings.matrixDimension = count;
    if(count > current){
      const addCount = count - current;
      const positions = circlePositionsForNewNodes(addCount);
      for(let i=0; i<addCount; i++) state.nodes.push(createNode(null, positions[i].x, positions[i].y));
      pushHistory('expand matrix');
      queueRender(true);
      toast(I18N.t('matrix_expanded', {n: count}));
      return;
    }
    pushHistory('set matrix view');
    queueRender(true);
    if(count < current) toast(I18N.t('matrix_view_set', {n: count, m: current}));
    else toast(`Matrix set to ${count}×${count}; graph unchanged`);
  }
  function setNodeLabelFromMatrix(id, label){
    const n = nodeById(id); if(!n) return;
    // If the displayed value was the ID fallback (label was empty) and user
    // didn't change it, keep the label empty instead of baking in the ID.
    const displayed = n.label || id;
    const newLabel = String(label ?? '').slice(0,80);
    if(newLabel === id && n.label === '') return;
    n.label = newLabel;
    pushHistory('edit node label');
    queueRender(true);
  }
  function setMatrixCell(from, to, raw){
    if(!nodeById(from) || !nodeById(to)) return;
    const values = String(raw || '').split(/[;,\n\r]+/).map(v => v.trim()).filter(v => v !== '');
    // Find existing edges for this cell (directed: from→to; undirected: either direction)
    const existing = state.edges.filter(e => (e.from === from && e.to === to) || (!e.directed && e.from === to && e.to === from));
    const s = state.settings;
    if(values.length === 0){
      // No new values — remove all existing edges for this cell
      if(existing.length){
        const existingIds = new Set(existing.map(e => e.id));
        state.edges = state.edges.filter(e => !existingIds.has(e.id));
      }
    } else if(existing.length === values.length){
      // Same number of edges — just update the weights, preserve labels and all other properties
      for(let i = 0; i < existing.length; i++){
        existing[i].weight = values[i].slice(0, 50);
      }
    } else if(existing.length > 0 && values.length > 0){
      // Different count but at least one existing edge — preserve first edge's properties,
      // update its weight, add/remove extra edges as needed
      existing[0].weight = values[0].slice(0, 50);
      // Remove extra existing edges beyond what we need
      if(existing.length > values.length){
        const toRemove = new Set(existing.slice(values.length).map(e => e.id));
        state.edges = state.edges.filter(e => !toRemove.has(e.id));
      }
      // Add new edges for remaining values, inheriting properties from the first existing edge
      const tpl = existing[0];
      for(let i = 1; i < values.length; i++){
        state.edges.push({
          id:'e' + state.nextEdge++, from, to,
          weight: values[i].slice(0, 50),
          label: tpl.label || '',
          directed: tpl.directed,
          type: tpl.type || '',
          color: tpl.color || '', strokeSize: tpl.strokeSize, strokeStyle: tpl.strokeStyle,
          labelColor: tpl.labelColor, labelFont: tpl.labelFont, labelSize: tpl.labelSize
        });
      }
    } else {
      // No existing edges — create new ones with default settings
      for(const weight of values){
        const e: GraphEdge = { id:'e' + state.nextEdge++, from, to, weight:weight.slice(0,50), label:'', directed:Boolean(s.directed), type:'' };
        if(s.edgeType) e.type = s.edgeType;
        const ts = e.type && state.settings.edgeTypeStyles && state.settings.edgeTypeStyles[e.type];
        if(ts){
          if(!ts.color) e.color = s.edgeColor; else e.color = '';
          if(ts.strokeSize == null) e.strokeSize = s.edgeStrokeSize;
          if(!ts.strokeStyle) e.strokeStyle = s.edgeStrokeStyle; else e.strokeStyle = '';
          if(!ts.labelColor) e.labelColor = s.edgeLabelColor; else e.labelColor = '';
          if(ts.labelSize == null) e.labelSize = s.edgeLabelSize;
          if(!ts.labelFont) e.labelFont = s.edgeLabelFont;
        } else {
          e.color = s.edgeColor; e.strokeSize = s.edgeStrokeSize; e.strokeStyle = s.edgeStrokeStyle;
          e.labelColor = s.edgeLabelColor; e.labelFont = s.edgeLabelFont; e.labelSize = s.edgeLabelSize;
        }
        state.edges.push(e);
      }
    }
    setSelection([], matrixCellEdgeIds(from, to), null, false);
    pushHistory('edit matrix edge');
    queueRender(true);
  }
  function clearMatrixEdges(){
    if(!state.edges.length) return;
    if(!confirm(I18N.t('clear_matrix_edges'))) return;
    state.edges = [];
    setSelection([], [], null, false);
    pushHistory('clear matrix edges');
    queueRender(true);
  }
  // === Sorting and reordering ===
  function sortNodesById(){
    state.nodes.sort((a,b) => a.id.localeCompare(b.id, undefined, {numeric:true}));
    pushHistory('sort nodes by id'); queueRender(true); toast(I18N.t('nodes_sorted_id'));
  }
  function sortNodesByLabel(){
    state.nodes.sort((a,b) => (a.label||'').localeCompare(b.label||'', undefined, {numeric:true}));
    pushHistory('sort nodes by label'); queueRender(true); toast(I18N.t('nodes_sorted_label'));
  }
  function renumberNodeOrder(){
    const sorted = [...state.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    sorted.forEach((n,i) => { n.order = i; });
    pushHistory('renumber node order'); queueRender(true); saveSoon(); toast(I18N.t('node_order_renumbered'));
  }
  function sortEdgesById(){
    state.edges.sort((a,b) => a.id.localeCompare(b.id, undefined, {numeric:true}));
    pushHistory('sort edges by id'); queueRender(true); toast(I18N.t('edges_sorted_id'));
  }
  function sortEdgesByFrom(){
    const order = id => { const n = nodeById(id); return n ? (n.order ?? 0) : 0; };
    state.edges.sort((a,b) => order(a.from) - order(b.from) || order(a.to) - order(b.to) || a.id.localeCompare(b.id, undefined, {numeric:true}));
    pushHistory('sort edges by from'); queueRender(true); toast(I18N.t('edges_sorted_from'));
  }
  function sortEdgesByTo(){
    const order = id => { const n = nodeById(id); return n ? (n.order ?? 0) : 0; };
    state.edges.sort((a,b) => order(a.to) - order(b.to) || order(a.from) - order(b.from) || a.id.localeCompare(b.id, undefined, {numeric:true}));
    pushHistory('sort edges by to'); queueRender(true); toast(I18N.t('edges_sorted_to'));
  }
  function moveEdge(edgeId, dir){
    const idx = state.edges.findIndex(e => e.id === edgeId);
    if(idx < 0) return;
    const newIdx = idx + dir;
    if(newIdx < 0 || newIdx >= state.edges.length) return;
    const [e] = state.edges.splice(idx, 1);
    state.edges.splice(newIdx, 0, e);
    pushHistory('move edge'); queueRender(true); saveSoon();
  }
  function deleteSelected(){
    const nodeIds = selectedNodeIds(), edgeIds = selectedEdgeIds();
    if(!nodeIds.size && !edgeIds.size && state.selected){
      if(state.selected.type === 'node') nodeIds.add(state.selected.id); else edgeIds.add(state.selected.id);
    }
    if(!nodeIds.size && !edgeIds.size) return;
    state.nodes = state.nodes.filter(n => !nodeIds.has(n.id));
    state.edges = state.edges.filter(e => !edgeIds.has(e.id) && !nodeIds.has(e.from) && !nodeIds.has(e.to));
    state.selected = null;
    state.selection = {nodes: [], edges: []};
    toast(I18N.t('deleted_n_m', {n: nodeIds.size, m: edgeIds.size}));
    pushHistory('delete'); queueRender(true, true);
  }
