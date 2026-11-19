  // Numeric ids are a convenience, not an unbounded counter. Any suffix that
  // exceeds the safe-integer range is unusable for arithmetic allocation; reset
  // to a fresh safe range instead of looping on a counter that cannot advance.
  function allocateLocalId(prefix: string, used: Set<string>, start: number): { id: string; next: number } {
    let counter = safeGraphCounter(start, 1);
    const tried = new Set<number>();
    while(used.has(prefix + counter)){
      if(counter >= Number.MAX_SAFE_INTEGER || tried.has(counter)){
        let suffix = 0, candidate = '';
        do {
          candidate = prefix + Date.now().toString(36) + (suffix ? '-' + suffix : '');
          suffix++;
        } while(used.has(candidate));
        used.add(candidate);
        return { id: candidate, next: 1 };
      }
      tried.add(counter);
      counter++;
    }
    const id = prefix + counter;
    used.add(id);
    return { id, next: counter < Number.MAX_SAFE_INTEGER ? counter + 1 : 1 };
  }
  function takeNextGraphId(prefix: 'n' | 'e'): string {
    const current = prefix === 'n' ? state.nextNode : state.nextEdge;
    // Read the arrays directly: a bulk edit can append entities before the
    // cached id index is rebuilt, and that cache must not hide a collision.
    const exists = (id: string) => prefix === 'n'
      ? state.nodes.some(n => n.id === id)
      : state.edges.some(e => e.id === id);
    if(Number.isSafeInteger(current) && current >= 0){
      const id = prefix + current;
      if(!exists(id)){
        const next = current < Number.MAX_SAFE_INTEGER ? current + 1 : 1;
        if(prefix === 'n') state.nextNode = next; else state.nextEdge = next;
        return id;
      }
    }
    const used = new Set(prefix === 'n' ? state.nodes.map(n => n.id) : state.edges.map(e => e.id));
    const allocated = allocateLocalId(prefix, used, current);
    if(prefix === 'n') state.nextNode = allocated.next; else state.nextEdge = allocated.next;
    return allocated.id;
  }
  function advanceCounterFromId(current: number, id: unknown): number {
    const base = safeGraphCounter(current, 1);
    const num = Number((String(id ?? '').match(/\d+$/)||[0])[0]);
    if(!Number.isSafeInteger(num) || num < base) return base;
    return num < Number.MAX_SAFE_INTEGER ? num + 1 : 1;
  }
  function setMode(mode, render=true){
    if(mode !== 'edge') pendingEdgeFrom = null;
    state.mode = mode;
    $$('[data-mode]').forEach(b => {
      const active = b.dataset.mode === mode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    $('#canvasWrap').classList.toggle('move-mode', mode === 'move');
    $('#canvasWrap').classList.toggle('edge-mode', mode === 'edge');
    // Selection tools float over the canvas only while Select mode is active
    $('#canvasWrap').classList.toggle('select-mode', mode === 'select');
    renderGizmo();
    if(render) { setStatusOnly(); saveSoon(); }
  }
  function setSelectTool(tool, render=true){
    if(selectDraft?.tool === 'polygon' && tool !== 'polygon') finishPolygonSelection(true);
    if(['adjacent','directedAdjacent'].includes(tool)){
      expandSelection(tool === 'directedAdjacent');
      return;
    }
    state.selectTool = ['single','rect','brush','lasso','line','polygon'].includes(tool) ? tool : 'single';
    $$('[data-selecttool]').forEach(b => {
      const active = b.dataset.selecttool === state.selectTool;
      b.classList.toggle('active', active);
      if(!['adjacent','directedAdjacent'].includes(b.dataset.selecttool)) b.setAttribute('aria-pressed', String(active));
    });
    if(render) { setMode('select'); saveSoon(); }
  }
  function setSelectCombine(mode, render=true){
    state.selectCombine = ['replace','add','subtract'].includes(mode) ? mode : 'replace';
    $$('[data-selectcombine]').forEach(b => {
      const active = b.dataset.selectcombine === state.selectCombine;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    if(render) saveSoon();
  }
  function setHitTestMode(mode, render=true){
    state.settings.hitTestMode = ['any','center'].includes(mode) ? mode : 'any';
    $$('[data-hittest]').forEach(b => {
      const active = b.dataset.hittest === state.settings.hitTestMode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    if(render) { setStatusOnly(); saveSoon(); }
  }
  function effectiveSelectCombine(ev=null){ return ev?.shiftKey ? 'add' : (state.selectCombine || 'replace'); }
  // Selection sets are cached — creating a new Set per render pass is
  // wasteful when selection hasn't changed, especially for matrix rendering
  // which checks isNodeSelected per cell. The cache rebuilds when the
  // revision counter is bumped (mergeSelection/delete/undo) OR when the
  // state.selection arrays themselves were replaced, which also covers the
  // direct assignments in import/sample/clear that never bump the counter.
  // Callers must treat the returned Sets as read-only: anyone who needs to
  // add/remove ids copies first (mergeSelection, expandSelection).
  let selCacheRev = 0;
  let selCache = { rev: -1, srcNodes: null as string[] | null, srcEdges: null as string[] | null, nodes: new Set<string>(), edges: new Set<string>() };
  function invalidateSelectionCache(){ selCacheRev++; }
  function getSelectionCache(){
    const srcNodes = state.selection?.nodes || null;
    const srcEdges = state.selection?.edges || null;
    if(selCache.rev !== selCacheRev || selCache.srcNodes !== srcNodes || selCache.srcEdges !== srcEdges){
      selCache.nodes = new Set<string>(srcNodes || []);
      selCache.edges = new Set<string>(srcEdges || []);
      selCache.srcNodes = srcNodes;
      selCache.srcEdges = srcEdges;
      selCache.rev = selCacheRev;
    }
    return selCache;
  }
  function selectedNodeIds(){ return getSelectionCache().nodes; }
  function selectedEdgeIds(){ return getSelectionCache().edges; }
  function isNodeSelected(id){ return getSelectionCache().nodes.has(id); }
  function isEdgeSelected(id){ return getSelectionCache().edges.has(id); }
  // Shared selection-merge core: computes state.selection/state.selected from
  // the requested ids and combine mode. Callers decide how much DOM to update.
  function mergeSelection(
    nodes: string[] = [],
    edges: string[] = [],
    primary: GraphState['selected'] = null,
    combine: SelectionCombine | boolean | null = 'replace'
  ){
    const selectionMode: SelectionCombine = combine === true ? 'add' :
      (combine === false || combine == null ? 'replace' : combine);
    const nodeSet: Set<string> = selectionMode === 'replace' ? new Set<string>() : new Set<string>(selectedNodeIds());
    const edgeSet: Set<string> = selectionMode === 'replace' ? new Set<string>() : new Set<string>(selectedEdgeIds());
    if(selectionMode === 'subtract'){
      nodes.forEach(id => nodeSet.delete(id));
      edges.forEach(id => edgeSet.delete(id));
    } else {
      nodes.forEach(id => nodeById(id) && nodeSet.add(id));
      edges.forEach(id => edgeById(id) && edgeSet.add(id));
    }
    state.selection = { nodes:[...nodeSet], edges:[...edgeSet] };
    invalidateSelectionCache();
    if(primary && ((primary.type === 'node' && nodeSet.has(primary.id)) || (primary.type === 'edge' && edgeSet.has(primary.id)))) state.selected = primary;
    else if(state.selection.nodes.length) state.selected = {type:'node', id:state.selection.nodes[0]};
    else if(state.selection.edges.length) state.selected = {type:'edge', id:state.selection.edges[0]};
    else state.selected = null;
  }
  function setSelection(
    nodes: string[] = [],
    edges: string[] = [],
    primary: GraphState['selected'] = null,
    combine: SelectionCombine | boolean | null = 'replace',
    // Gesture starts pass true: the panel is rebuilt on the next frame instead
    // of inside the press handler. Selecting the node under the pointer is
    // what makes the drag start feel immediate, and the panel is not part of
    // the gesture — it only has to be right when the frame is painted.
    deferSidebar = false
  ){
    mergeSelection(nodes, edges, primary, combine);
    syncSelectionDom();
    if(deferSidebar) scheduleSidebarRender(); else renderSidebar();
    setStatusOnly();
  }
  // Live variant for per-frame selection tools (brush): identical state
  // updates, but the sidebar render is deferred instead of running per frame.
  function setSelectionLive(
    nodes: string[] = [],
    edges: string[] = [],
    combine: SelectionCombine | boolean | null = 'add'
  ){
    mergeSelection(nodes, edges, null, combine);
    syncSelectionDom();
    markSidebarDirty();
    setStatusOnly();
  }
  function selectItem(type,id){ setSelection(type === 'node' ? [id] : [], type === 'edge' ? [id] : [], {type,id}, false); }
  function deselect(){ if(state.selected || state.selection?.nodes?.length || state.selection?.edges?.length) setSelection([], [], null, false); }
  // Mirror of the selection currently reflected in the DOM. syncSelectionDom
  // touches only the elements whose selection state changed — O(delta) per
  // selection change instead of O(V+E).
  let domSelectedNodes = new Set<string>(), domSelectedEdges = new Set<string>();
  function resetSelectionMirror(){
    // Called after a full render pass: renderEdges/renderNodes just applied the
    // exact selection state to every element, so the mirror can adopt it.
    domSelectedNodes = selectedNodeIds();
    domSelectedEdges = selectedEdgeIds();
  }
  function syncSelectionDom(){
    const ns = selectedNodeIds(), es = selectedEdgeIds();
    // One decision for the whole update, for the same reason the render pass
    // makes one: the edge accent look is chosen for the new selection as a
    // whole, so a single frame can never be half outlined and half coloured.
    const bulk = accentBudgetExceeded(ns.size, es.size);
    // The ids whose DOM state actually changes. They are collected here anyway
    // (the loops below already compare the two sets) and handed to the matrix
    // mirror, whose grid is n² inputs: a press must not touch every one of them.
    const changedNodes: string[] = [], changedEdges: string[] = [];
    for(const id of domSelectedNodes){
      if(!ns.has(id)){
        changedNodes.push(id);
        const el = nodeEl(id); if(!el) continue;
        toggleClass(el, 'selected', false);
        const n = nodeById(id); if(n){ const v = nodeVisualC(n); syncNodeSelRing(el, n, v.shape, v.width, v.height, false); }
      }
    }
    for(const id of ns){
      if(!domSelectedNodes.has(id)){
        changedNodes.push(id);
        const el = nodeEl(id); if(!el) continue;
        toggleClass(el, 'selected', true);
        const n = nodeById(id); if(n){ const v = nodeVisualC(n); syncNodeSelRing(el, n, v.shape, v.width, v.height, true); }
      }
    }
    for(const id of domSelectedEdges){
      if(!es.has(id)){
        changedEdges.push(id);
        const el = edgeEl(id); if(!el) continue;
        toggleClass(el, 'selected', false);
        // Dropping the accent is all it takes: the edge line and its tip were
        // never repainted, so the arrow keeps the colour the render gave it.
        syncEdgeAccent(el, edgeById(id), edgeRenderStyleC(edgeById(id)), null, false, bulk);
      }
    }
    for(const id of es){
      if(!domSelectedEdges.has(id)){
        changedEdges.push(id);
        const el = edgeEl(id); if(!el) continue;
        toggleClass(el, 'selected', true);
        const e = edgeById(id);
        // Stroke width of the accent follows the edge's own width, so the
        // merged style is read here (and cached for this pass) only for the
        // edges whose selection actually changed.
        if(e) syncEdgeAccent(el, e, edgeRenderStyleC(e), null, true, bulk);
      }
    }
    domSelectedNodes = ns; domSelectedEdges = es;
    updateMatrixSelectionDom(changedNodes, changedEdges);
    // The gizmo frames the selection, so it follows every selection change
    // that did not go through a full render pass.
    renderGizmo();
  }
  function matrixAttrValue(value: string){
    // Ids are sanitised to [A-Za-z0-9_-], so an attribute selector is safe;
    // escape anyway so a hand-edited document can never inject a selector.
    const api = (window as any).CSS;
    return api && typeof api.escape === 'function' ? api.escape(value) : String(value).replace(/["\\]/g, '\\$&');
  }
  function updateMatrixSelectionDom(changedNodes: string[] | null = null, changedEdges: string[] | null = null){
    const host = $('#matrixHost');
    if(!host || !host.firstElementChild) return;
    // The matrix panel is hidden in "graph" view and its HTML is rebuilt from
    // the current selection whenever the view switches back — no need to sync.
    const mainEl = document.querySelector('.main');
    if(mainEl && (mainEl as HTMLElement).dataset?.view === 'graph') return;
    const ns = selectedNodeIds(), es = selectedEdgeIds();
    // O(delta) node columns: a node drag or a plain click changes one or two
    // ids, so only their cells are looked up, and the edge rows are skipped
    // entirely when no edge's selection changed. Past DELTA_LOOKUP_LIMIT changed
    // ids (a brush stroke selecting hundreds of nodes) the per-id lookups cost
    // more than one scan of the grid, so there the scan is used instead.
    const DELTA_LOOKUP_LIMIT = 16;
    if(changedNodes && changedEdges && changedNodes.length <= DELTA_LOOKUP_LIMIT){
      for(const id of changedNodes){
        for(const input of host.querySelectorAll(`[data-node-label="${matrixAttrValue(id)}"]`)){
          toggleClass(input, 'matrix-selected', ns.has(input.dataset.nodeLabel));
        }
      }
      if(!changedEdges.length) return;
      const changedEdgeSet = new Set(changedEdges);
      for(const input of host.querySelectorAll('[data-cell-from][data-cell-to]')){
        const ids = (input.dataset.cellEdges || '').split(',').filter(Boolean);
        if(!ids.some(id => changedEdgeSet.has(id))) continue;
        let selected = false;
        for(let i = 0; i < ids.length; i++){ if(es.has(ids[i])){ selected = true; break; } }
        toggleClass(input, 'matrix-selected', selected);
      }
      return;
    }
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
    const seeds = new Set<string>(selectedNodeIds());
    if(!seeds.size && state.selected?.type === 'edge'){
      const e = edgeById(state.selected.id); if(e){ seeds.add(e.from); seeds.add(e.to); }
    }
    if(!seeds.size){ toast(I18N.t('select_at_least_one')); return; }
    const nodes = new Set(seeds), edges = new Set(selectedEdgeIds());
    for(const e of state.edges){
      const dir = edgeDirection(e);
      const isUndirectedOrMutual = dir === 'undirected' || dir === 'mutual';
      if(directedOnly){
        if(seeds.has(e.from)){ nodes.add(e.to); edges.add(e.id); }
        else if(isUndirectedOrMutual && seeds.has(e.to)){ nodes.add(e.from); edges.add(e.id); }
      } else if(seeds.has(e.from) || seeds.has(e.to)){
        nodes.add(e.from); nodes.add(e.to); edges.add(e.id);
      }
    }
    setSelection([...nodes], [...edges], state.selected, false);
    toast(directedOnly ? I18N.t('selected_directed_adj') : I18N.t('selected_adjacent'));
  }

  function snapThresholdWorld(){
    return clamp(currentCamera().w / 70, 10, 32);
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
    // Single pass min/max without intermediate arrays or spread — avoids O(n) allocations and call-stack blow-up on large graphs
    const vb = currentCamera();
    let minX = vb.x, maxX = vb.x + vb.w;
    let minY = vb.y, maxY = vb.y + vb.h;
    // include the edited node's own position
    if(n.x < minX) minX = n.x; if(n.x > maxX) maxX = n.x;
    if(n.y < minY) minY = n.y; if(n.y > maxY) maxY = n.y;
    for(let i=0;i<state.nodes.length;i++){
      const node = state.nodes[i];
      if(node.x < minX) minX = node.x; if(node.x > maxX) maxX = node.x;
      if(node.y < minY) minY = node.y; if(node.y > maxY) maxY = node.y;
    }
    return {
      minX: Math.floor(minX - 300), maxX: Math.ceil(maxX + 300),
      minY: Math.floor(minY - 300), maxY: Math.ceil(maxY + 300)
    };
  }

  function isPositionFree(x, y, ignoreIds=new Set()){
    const minDistance = R * 2 + 14;
    const minDist2 = minDistance * minDistance;
    // Use squared distance to avoid sqrt per node — same result, cheaper
    for(let i=0;i<state.nodes.length;i++){
      const n = state.nodes[i];
      if(ignoreIds.has(n.id)) continue;
      const dx = n.x - x, dy = n.y - y;
      if(dx*dx + dy*dy < minDist2) return false;
    }
    return true;
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

  function applyNewNodeDefaults(n: GraphNode){
    const s = state.settings;
    // Pending custom property values from "Node placement" apply to every new
    // node (they are data, so the inherit-mode early return does not skip them).
    const pendingCustom = s.nodeCustom && typeof s.nodeCustom === 'object' ? cloneCustomMap(s.nodeCustom) : undefined;
    if(pendingCustom) n.custom = pendingCustom;
    if(s.nodeType) n.type = s.nodeType;
    else if(s.nodeDefaults?.type) n.type = s.nodeDefaults.type;
    // Inherit mode deliberately leaves visual properties unset so later
    // changes to Style-tab defaults (or the node's type style) remain live.
    if(s.inheritDefaults !== false) return;
    const d = s.nodeDefaults;
    const defType = n.type || d?.type;
    const dts = (defType && s.nodeTypeStyles && s.nodeTypeStyles[defType]) || {};
    n.shape = (defType && dts.shape) ? dts.shape : s.nodeShape;
    n.color = (defType && dts.color) ? dts.color : s.nodeColor;
    n.width = (defType && dts.width != null) ? dts.width : s.nodeWidth;
    n.height = (defType && dts.height != null) ? dts.height : s.nodeHeight;
    n.strokeColor = (defType && dts.strokeColor) ? dts.strokeColor : s.nodeStrokeColor;
    n.strokeSize = (defType && dts.strokeSize != null) ? dts.strokeSize : s.nodeStrokeSize;
    n.strokeStyle = (defType && dts.strokeStyle) ? dts.strokeStyle : s.nodeStrokeStyle;
    n.labelColor = (defType && dts.labelColor) ? dts.labelColor : s.nodeLabelColor;
    n.labelFont = (defType && dts.labelFont) ? dts.labelFont : s.nodeLabelFont;
    n.labelSize = (defType && dts.labelSize != null) ? dts.labelSize : s.nodeLabelSize;
    n.labelPosition = (defType && dts.labelPosition) ? dts.labelPosition : s.nodeLabelPosition;
  }

  // Shared placement path for standalone nodes and connection endpoints.
  function createCanvasNode(x,y){
    ({x, y} = snapPointToEnabled(x, y));
    ({x, y} = findFreeNodePosition(x, y));
    ({x, y} = snapPointToEnabled(x, y));
    if(!isPositionFree(x, y)) ({x, y} = findFreeNodePosition(x, y));
    const custom = $('#nodeLabel').value.trim();
    const s = state.settings;
    const id = takeNextGraphId('n');
    const suffix = Number((id.match(/\d+$/)||[0])[0]);
    const autoNumber = Number.isSafeInteger(suffix) ? suffix : state.nodes.length + 1;
    const label = s.noLabel ? '' : (custom ? (custom.length <= 3 ? custom : custom.slice(0,80)) : labelFromNumber(autoNumber));
    const n: GraphNode = { id, label, x, y, type:'', order: state.nodes.length };
    applyNewNodeDefaults(n);
    return n;
  }
  function addNode(x,y){
    const n = createCanvasNode(x,y);
    state.nodes.push(n); setSelection([n.id], [], {type:'node', id:n.id}, false); pushHistory('add node'); queueRender(true, true);
  }
  function addConnectedNode(from, x, y){
    if(!nodeById(from)) return;
    const n = createCanvasNode(x,y);
    state.nodes.push(n);
    // addEdge records the node and edge together as one undoable action.
    addEdge(from, n.id);
  }
  function addEdge(from,to){
    if(!nodeById(from) || !nodeById(to)) return;
    const s = state.settings;
    const defEdgeType = s.edgeDefaults?.type || '';
    const effectiveType = s.edgeType || defEdgeType;
    const dir = normalizeDirection((s as any).direction ?? s.directed);
    const e: GraphEdge = { id: takeNextGraphId('e'), from, to, label: String(s.edgeLabel || '').slice(0,80), directed: dir !== 'undirected' as any, direction: dir as any, type: effectiveType };
    // Pending custom property values from "New edge defaults".
    const pendingCustom = s.edgeCustom && typeof s.edgeCustom === 'object' ? cloneCustomMap(s.edgeCustom) : undefined;
    if(pendingCustom) e.custom = pendingCustom;
    if(s.edgeWeight !== '') e.weight = String(s.edgeWeight).slice(0,50);
    if(effectiveType){
      const ts = state.settings.edgeTypeStyles && state.settings.edgeTypeStyles[effectiveType];
      if(ts){
        if(!ts.color) e.color = s.edgeColor; else e.color = '';
        if(ts.strokeSize == null) e.strokeSize = s.edgeStrokeSize;
        if(!ts.strokeStyle) e.strokeStyle = s.edgeStrokeStyle; else e.strokeStyle = '';
        if(ts.arrowSize == null) e.arrowSize = s.edgeArrowSize ?? DEFAULT_ARROW_SIZE;
        if(!ts.labelColor) e.labelColor = s.edgeLabelColor; else e.labelColor = '';
        if(ts.labelSize == null) e.labelSize = s.edgeLabelSize;
        if(!ts.labelFont) e.labelFont = s.edgeLabelFont;
      } else {
        e.color = s.edgeColor; e.strokeSize = s.edgeStrokeSize; e.strokeStyle = s.edgeStrokeStyle; e.arrowSize = s.edgeArrowSize ?? DEFAULT_ARROW_SIZE;
        e.labelColor = s.edgeLabelColor; e.labelFont = s.edgeLabelFont; e.labelSize = s.edgeLabelSize;
      }
    } else {
      e.color = s.edgeColor; e.strokeSize = s.edgeStrokeSize; e.strokeStyle = s.edgeStrokeStyle; e.arrowSize = s.edgeArrowSize ?? DEFAULT_ARROW_SIZE;
      e.labelColor = s.edgeLabelColor; e.labelFont = s.edgeLabelFont; e.labelSize = s.edgeLabelSize;
    }
    state.edges.push(e); setSelection([], [e.id], {type:'edge', id:e.id}, false); pushHistory('add edge'); queueRender(true, true);
  }
  function flipSelectedEdges(){
    const flipped = [];
    for(const id of selectedEdgeIds()){
      const e = edgeById(id);
      if(!e || edgeIsUndirected(e) || e.from === e.to) continue;
      [e.from, e.to] = [e.to, e.from];
      flipped.push(e);
    }
    if(!flipped.length) return;
    invalidateGraphIndex();
    // Paint the new direction in this same task. The queued render pass reaches
    // the canvas a frame later, and on a large graph that frame also carries the
    // sidebar rebuild, so the flip used to land visibly late. updateEdgeFast is
    // the drag-time geometry writer: it re-points one edge's path, label/weight,
    // arrowhead and selection accent in place and leaves its geometry cache
    // stale for the next full pass to recompute.
    for(const e of flipped){
      const el = edgeEl(e.id);
      if(el){ setAttr(el, 'data-from', e.from); setAttr(el, 'data-to', e.to); }
      updateEdgeFast(e);
    }
    pushHistory('flip edge direction');
    markSidebarDirty();
    queueRender(true, true);
  }
  function graphCenter(nodes=state.nodes){
    if(nodes.length){
      return { x:nodes.reduce((sum,n)=>sum+n.x,0)/nodes.length, y:nodes.reduce((sum,n)=>sum+n.y,0)/nodes.length };
    }
    const vb = currentCamera();
    return { x:vb.x + vb.w/2, y:vb.y + vb.h/2 };
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
    const id = takeNextGraphId('n');
    const suffix = Number((id.match(/\d+$/)||[0])[0]);
    const idx = Number.isSafeInteger(suffix) ? suffix : state.nodes.length + 1;
    if(x == null || y == null){
      const pos = circlePositionsForNewNodes(1)[0];
      x = pos.x; y = pos.y;
    }
    ({x, y} = findFreeNodePosition(x, y));
    const s = state.settings;
    const autoLabel = s.noLabel ? '' : (label || labelFromNumber(idx));
    const n: GraphNode = { id, label:autoLabel, x, y, type:'', order: state.nodes.length };
    applyNewNodeDefaults(n);
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
    if(!selected.size){ toast(I18N.t('select_matrix_labels_first')); return; }
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
    if(state.settings.matrixDimension) state.settings.matrixDimension = clamp(state.settings.matrixDimension + newIds.length, 0, MATRIX_MAX_NODES);
    setSelection(newIds, [], newIds.length ? {type:'node', id:newIds[0]} : null, false);
    pushHistory('insert node before selected');
    queueRender(true);
    toast(I18N.t('inserted_n_before', {n: newIds.length}));
  }
  function setMatrixDimension(count){
    // The matrix cannot render more than MATRIX_MAX_NODES, so growing the graph
    // through this control stops there too instead of creating nodes the view
    // can never show.
    const requested = parseInt(count,10) || 0;
    count = clamp(requested, 0, MATRIX_MAX_NODES);
    if(requested > MATRIX_MAX_NODES) toast(I18N.t('matrix_cap_reached', {cap: MATRIX_MAX_NODES}));
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
    else toast(I18N.t('matrix_unchanged', {n: count}));
  }
  function setNodeLabelFromMatrix(id, label){
    const n = nodeById(id); if(!n) return;
    // If the value equals the ID fallback (label was empty) and the user did
    // not change it, keep the label empty instead of baking in the ID.
    const newLabel = String(label ?? '').slice(0,80);
    if(newLabel === id && n.label === '') return;
    n.label = newLabel;
    pushHistory('edit node label');
    queueRender(true);
  }
  function setMatrixCell(from, to, raw){
    if(!nodeById(from) || !nodeById(to)) return;
    const values = String(raw || '').split(/[;,\n\r]+/).map(v => v.trim()).filter(v => v !== '');
    // Find existing edges for this cell (directed: from→to; undirected/mutual: either direction)
    const existing = state.edges.filter(e => (e.from === from && e.to === to) || ((edgeIsUndirected(e) || edgeDirection(e)==='mutual') && e.from === to && e.to === from));
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
        const inherited = cloneCustomMap(tpl.custom);
        const fresh: GraphEdge = {
          id: takeNextGraphId('e'), from, to,
          weight: values[i].slice(0, 50),
          label: tpl.label || '',
          // Carry the canonical tristate: copying only the legacy boolean turned
          // every extra weight of a mutual edge into a directed edge.
          direction: (tpl as any).direction ?? (tpl.directed ? 'directed' : 'undirected'),
          directed: tpl.directed,
          type: tpl.type || '',
          color: tpl.color || '', strokeSize: tpl.strokeSize, strokeStyle: tpl.strokeStyle, arrowSize: (tpl as any).arrowSize,
          labelColor: tpl.labelColor, labelFont: tpl.labelFont, labelSize: tpl.labelSize
        };
        if(inherited) fresh.custom = inherited;
        state.edges.push(fresh);
      }
    } else {
      // No existing edges — create new ones with default settings
      for(const weight of values){
        const dir = normalizeDirection((s as any).direction ?? s.directed);
        const e: GraphEdge = { id: takeNextGraphId('e'), from, to, weight:weight.slice(0,50), label:'', directed: dir !== 'undirected' as any, direction: dir as any, type:'' };
        // Pending custom property values from "New edge defaults", as on the canvas path.
        const pendingCustom = s.edgeCustom && typeof s.edgeCustom === 'object' ? cloneCustomMap(s.edgeCustom) : undefined;
        if(pendingCustom) e.custom = pendingCustom;
        if(s.edgeType) e.type = s.edgeType;
        const ts = e.type && state.settings.edgeTypeStyles && state.settings.edgeTypeStyles[e.type];
        if(ts){
          if(!ts.color) e.color = s.edgeColor; else e.color = '';
          if(ts.strokeSize == null) e.strokeSize = s.edgeStrokeSize;
          if(!ts.strokeStyle) e.strokeStyle = s.edgeStrokeStyle; else e.strokeStyle = '';
          if(ts.arrowSize == null) (e as any).arrowSize = (s as any).edgeArrowSize ?? DEFAULT_ARROW_SIZE;
          if(!ts.labelColor) e.labelColor = s.edgeLabelColor; else e.labelColor = '';
          if(ts.labelSize == null) e.labelSize = s.edgeLabelSize;
          if(!ts.labelFont) e.labelFont = s.edgeLabelFont;
        } else {
          e.color = s.edgeColor; e.strokeSize = s.edgeStrokeSize; e.strokeStyle = s.edgeStrokeStyle; (e as any).arrowSize = (s as any).edgeArrowSize ?? DEFAULT_ARROW_SIZE;
          e.labelColor = s.edgeLabelColor; e.labelFont = s.edgeLabelFont; e.labelSize = s.edgeLabelSize;
        }
        state.edges.push(e);
      }
    }
    setSelection([], matrixCellEdgeIds(from, to), null, false);
    pushHistory('edit matrix edge');
    queueRender(true);
  }
  async function clearMatrixEdges(){
    if(!state.edges.length) return;
    if(!await uiConfirm(I18N.t('clear_matrix_edges'), {danger: true, confirmLabel: I18N.t('clear')})) return;
    state.edges = [];
    setSelection([], [], null, false);
    pushHistory('clear matrix edges');
    queueRender(true);
  }
  // === Sorting and reordering ===
  function sortNodesById(){
    const sorted = [...state.nodes].sort((a,b) => a.id.localeCompare(b.id, undefined, {numeric:true}));
    sorted.forEach((n,i) => { n.order = i; });
    state.nodes.sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    invalidateGraphIndex(); // order fields changed in place: sorted-nodes cache must rebuild
    pushHistory('sort nodes by id'); queueRender(true); toast(I18N.t('nodes_sorted_id'));
  }
  function sortNodesByLabel(){
    const sorted = [...state.nodes].sort((a,b) => (a.label||'').localeCompare(b.label||'', undefined, {numeric:true}));
    sorted.forEach((n,i) => { n.order = i; });
    state.nodes.sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    invalidateGraphIndex(); // order fields changed in place: sorted-nodes cache must rebuild
    pushHistory('sort nodes by label'); queueRender(true); toast(I18N.t('nodes_sorted_label'));
  }
  function renumberNodeOrder(){
    const sorted = [...state.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    sorted.forEach((n,i) => { n.order = i; });
    state.nodes.sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    invalidateGraphIndex(); // order fields changed in place: sorted-nodes cache must rebuild
    pushHistory('renumber node order'); queueRender(true); saveSoon(); toast(I18N.t('node_order_renumbered'));
  }
  function moveNode(nodeId, dir){
    const sorted = [...state.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    const idx = sorted.findIndex(n => n.id === nodeId);
    if(idx < 0) return;
    const newIdx = idx + dir;
    if(newIdx < 0 || newIdx >= sorted.length) return;
    const [moved] = sorted.splice(idx, 1);
    sorted.splice(newIdx, 0, moved);
    sorted.forEach((n,i) => { n.order = i; });
    state.nodes.sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    invalidateGraphIndex(); // order fields changed in place: sorted-nodes cache must rebuild
    pushHistory('move node'); queueRender(true); saveSoon();
  }
  function moveNodeToPosition(nodeId, newPosition){
    const sorted = [...state.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    const idx = sorted.findIndex(n => n.id === nodeId);
    if(idx < 0) return;
    newPosition = clamp(Math.trunc(newPosition), 0, sorted.length - 1);
    if(idx === newPosition) return;
    const [moved] = sorted.splice(idx, 1);
    sorted.splice(newPosition, 0, moved);
    sorted.forEach((n,i) => { n.order = i; });
    state.nodes.sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    invalidateGraphIndex(); // order fields changed in place: sorted-nodes cache must rebuild
    pushHistory('move node to position'); queueRender(true); saveSoon();
  }
  function reverseNodeOrder(){
    const sorted = [...state.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    sorted.reverse();
    sorted.forEach((n,i) => { n.order = i; });
    state.nodes.sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    invalidateGraphIndex(); // order fields changed in place: sorted-nodes cache must rebuild
    pushHistory('reverse node order'); queueRender(true); toast(I18N.t('nodes_reversed'));
  }
  function shuffleNodeOrder(){
    const sorted = [...state.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    for(let i = sorted.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    }
    sorted.forEach((n,i) => { n.order = i; });
    state.nodes.sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    invalidateGraphIndex(); // order fields changed in place: sorted-nodes cache must rebuild
    pushHistory('shuffle node order'); queueRender(true); toast(I18N.t('nodes_shuffled'));
  }
  function sortEdgesById(){
    state.edges.sort((a,b) => a.id.localeCompare(b.id, undefined, {numeric:true}));
    invalidateGraphIndex();
    pushHistory('sort edges by id'); queueRender(true); toast(I18N.t('edges_sorted_id'));
  }
  function sortEdgesByFrom(){
    const order = id => { const n = nodeById(id); return n ? (n.order ?? 0) : 0; };
    state.edges.sort((a,b) => order(a.from) - order(b.from) || order(a.to) - order(b.to) || a.id.localeCompare(b.id, undefined, {numeric:true}));
    invalidateGraphIndex();
    pushHistory('sort edges by from'); queueRender(true); toast(I18N.t('edges_sorted_from'));
  }
  function sortEdgesByTo(){
    const order = id => { const n = nodeById(id); return n ? (n.order ?? 0) : 0; };
    state.edges.sort((a,b) => order(a.to) - order(b.to) || order(a.from) - order(b.from) || a.id.localeCompare(b.id, undefined, {numeric:true}));
    invalidateGraphIndex();
    pushHistory('sort edges by to'); queueRender(true); toast(I18N.t('edges_sorted_to'));
  }
  function moveEdge(edgeId, dir){
    const idx = state.edges.findIndex(e => e.id === edgeId);
    if(idx < 0) return;
    const newIdx = idx + dir;
    if(newIdx < 0 || newIdx >= state.edges.length) return;
    const [e] = state.edges.splice(idx, 1);
    state.edges.splice(newIdx, 0, e);
    invalidateGraphIndex();
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
    invalidateSelectionCache();
    toast(I18N.t('deleted_n_m', {n: nodeIds.size, m: edgeIds.size}));
    pushHistory('delete'); queueRender(true, true);
  }

  // === Copy / Paste ===
  function cloneCustomMap(source){
    if(!source || typeof source !== 'object') return undefined;
    const out: AnyRecord = Object.create(null); // own keys only: "__proto__" must survive the clone
    for(const key of Object.keys(source)){
      const value = source[key];
      if(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    }
    return Object.keys(out).length ? out : undefined;
  }
  // The definitions of every custom attribute referenced by the given
  // entities, so a clipboard payload can be re-instantiated in a document
  // that lacks them. Same-document pastes re-add nothing (ids already exist).
  function referencedCustomAttributes(entities){
    const used = new Set<string>();
    for(const entity of entities){
      if(isRecord(entity?.custom)) for(const key of Object.keys(entity.custom)) used.add(key);
    }
    return state.customAttributes.filter(attribute => used.has(attribute.id)).map(attribute => ({ ...attribute }));
  }
  function cloneNode(n){ const c = {...n}; const custom = cloneCustomMap(n?.custom); if(custom) c.custom = custom; else delete c.custom; return c; }
  function cloneEdge(e){ const c = {...e}; const custom = cloneCustomMap(e?.custom); if(custom) c.custom = custom; else delete c.custom; return c; }
  // Whether the latest local copy was published to the system clipboard. A
  // pending or failed write leaves the system clipboard older than the
  // in-memory payload, so pastes must not prefer it in that state. The stamp
  // identifies the copy whose payload is on the clipboard even if an older
  // write resolves later and overwrites it.
  type ClipboardStamp = { t: number; s: number; tab: string };
  // Bounds only the optional pre-copy snapshot, never the paste read itself.
  const CLIPBOARD_SNAPSHOT_TIMEOUT_MS = 80;
  const CLIPBOARD_STAMP_KEY = 'graph-editor-pro-clipboard-stamp';
  const clipboardTabId = Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
  const compareClipboardStamps = (left: any, right: any): boolean | null => {
    if(!isRecord(left) || !isRecord(right)) return null;
    if(!Number.isFinite(Number(left.t)) || !Number.isFinite(Number(right.t))) return null;
    if(Number(left.t) !== Number(right.t)) return Number(left.t) > Number(right.t);
    // Sequence numbers are only comparable within one tab. Across tabs they
    // are independent counters, so an equal timestamp stays ambiguous.
    if(left.tab === right.tab && typeof left.tab === 'string'){
      const leftSeq = Number(left.s), rightSeq = Number(right.s);
      if(Number.isFinite(leftSeq) && Number.isFinite(rightSeq) && leftSeq !== rightSeq){
        return leftSeq > rightSeq;
      }
    }
    return null;
  };
  const readGlobalClipboardStamp = (): any => {
    try { return JSON.parse(localStorage.getItem(CLIPBOARD_STAMP_KEY) || 'null'); }
    catch { return null; }
  };
  // A stamp is evidence that the matching payload was actually published.
  // Writing it early would let a failed copy invalidate an older, still valid
  // system payload for every fresh tab.
  const publishClipboardStamp = (stamp: ClipboardStamp) => {
    const current = readGlobalClipboardStamp();
    if(current && compareClipboardStamps(stamp, current) !== true) return;
    try { localStorage.setItem(CLIPBOARD_STAMP_KEY, JSON.stringify(stamp)); } catch {}
  };
  const boundedRead = async <T>(promise: Promise<T>, fallback: T): Promise<T> => {
    let timer: any = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), CLIPBOARD_SNAPSHOT_TIMEOUT_MS); }),
      ]);
    } finally {
      if(timer != null) clearTimeout(timer);
    }
  };
  let localClipboardWrite: {
    seq: number;
    state: 'pending' | 'published' | 'failed';
    stamp: ClipboardStamp;
    // undefined means the pre-copy snapshot was denied/unknown, not empty.
    staleSystemText: Promise<string | undefined>;
  } | null = null;
  let localClipboardSeq = 0;
  // A paste read still in flight. Its generation token is invalidated by the
  // next paste command, so a hanging read can never paste a second time.
  let pasteGeneration = 0;
  let pendingSystemRead: { token: number } | null = null;
  const clipboardHas = (obj: unknown, key: string) => isRecord(obj) && Object.prototype.hasOwnProperty.call(obj, key);
  const clipboardText = (value: unknown, max: number, trim = false) => {
    if(typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return undefined;
    const text = String(value);
    return (trim ? text.trim() : text).slice(0, max);
  };
  const clipboardNumber = (value: unknown, min: number, max: number, integer = false) => {
    const n = Number(value);
    if(!Number.isFinite(n)) return undefined;
    return clamp(integer ? Math.trunc(n) : n, min, max);
  };
  const clipboardColor = (value: unknown) => {
    const text = String(value ?? '');
    // '' is the editor's stored value for "unset", not a bad payload value.
    if(text === '') return '';
    return /^#[0-9a-f]{6}$/i.test(text) ? text : undefined;
  };
  const clipboardChoice = (value: unknown, allowed: readonly string[]) => {
    const text = String(value ?? '');
    return text === '' || allowed.includes(text) ? text : undefined;
  };
  // Clipboard is foreign input. Only fields the app itself writes are copied,
  // and each supplied field is normalized exactly as load/sanitize would.
  // Invalid values are treated as omitted so an in-place merge cannot corrupt
  // a live entity (and cannot overwrite it with a default either).
  function sanitizeClipboardEntity(raw: unknown, kind: 'node' | 'edge'): AnyRecord | null {
    if(!isRecord(raw)) return null;
    const idText = clipboardText(raw.id, 200, true);
    if(!idText) return null;
    // Same identity normalization as the loader: a payload id that would be
    // rewritten on reload must not be used to address a live entity here.
    const id = uniqueSafeId(idText, kind === 'node' ? 'n' : 'e', new Set());
    const out: AnyRecord = { id };
    const take = (key: string, normalize: (value: unknown) => unknown) => {
      if(!clipboardHas(raw, key)) return;
      const value = normalize(raw[key]);
      if(value !== undefined) out[key] = value;
    };
    const finiteCoordinate = (value: unknown) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    };
    const endpointId = (value: unknown) => {
      const text = clipboardText(value, 200, true);
      return text ? uniqueSafeId(text, 'n', new Set()) : undefined;
    };
    if(kind === 'node'){
      take('x', finiteCoordinate); take('y', finiteCoordinate);
      take('label', v => clipboardText(v, 80));
      take('shape', v => clipboardChoice(v, NODE_SHAPES));
      take('color', clipboardColor);
      take('type', v => clipboardText(v, 40));
      take('order', v => clipboardNumber(v, 0, 2147483647, true));
      take('width', v => clipboardNumber(v, 10, 300));
      take('height', v => clipboardNumber(v, 10, 300));
      take('strokeColor', clipboardColor);
      take('strokeSize', v => clipboardNumber(v, 0, 20));
      take('strokeStyle', v => clipboardChoice(v, STROKE_STYLES));
      take('labelColor', clipboardColor);
      take('labelSize', v => clipboardNumber(v, 4, 72));
      take('labelPosition', v => clipboardChoice(v, LABEL_POSITIONS));
      take('labelFont', v => clipboardText(v, 60));
    } else {
      take('from', endpointId);
      take('to', endpointId);
      take('label', v => clipboardText(v, 80));
      take('direction', v => normalizeDirection(v));
      take('directed', v => normalizeDirection(v));
      take('type', v => clipboardText(v, 40));
      take('weight', v => clipboardText(v, 50));
      take('color', clipboardColor);
      take('strokeSize', v => clipboardNumber(v, 0, 20));
      take('strokeStyle', v => clipboardChoice(v, STROKE_STYLES));
      take('arrowSize', v => clipboardNumber(v, 4, 40));
      take('labelColor', clipboardColor);
      take('labelSize', v => clipboardNumber(v, 4, 72));
      take('labelFont', v => clipboardText(v, 60));
      if(clipboardHas(out, 'direction')) out.directed = out.direction !== 'undirected';
      else if(clipboardHas(out, 'directed')){
        out.direction = normalizeDirection(out.directed);
        out.directed = out.direction !== 'undirected';
      }
    }
    if(clipboardHas(raw, 'custom')){
      const custom = cloneCustomMap(raw.custom);
      if(custom) out.custom = custom;
    }
    return out;
  }
  // clipboardData and pasteOffsetCount are defined in 10-core.ts (shared state)
  function getSelectedNodeIdsForCopy(): Set<string> {
    const ids = new Set(state.selection?.nodes || []);
    if(state.selected?.type === 'node') ids.add(state.selected.id);
    // Also include nodes that have selected edges but no nodes selected? If only edges selected, don't auto-add their endpoints — edge copy will handle
    return ids;
  }
  function getSelectedEdgeIdsForCopy(): Set<string> {
    const ids = new Set(state.selection?.edges || []);
    if(state.selected?.type === 'edge') ids.add(state.selected.id);
    return ids;
  }
  function copySelectedNodes(){
    const nodeIds = getSelectedNodeIdsForCopy();
    const edgeIds = getSelectedEdgeIdsForCopy();
    if(!nodeIds.size && !edgeIds.size){
      toast(I18N.t('nothing_to_copy'));
      return false;
    }
    // If no nodes selected but edges selected, copy those edges (both endpoints must exist on paste)
    // If nodes selected, copy nodes + edges between them + candidate external edges
    const nodes = state.nodes.filter(n => nodeIds.has(n.id)).map(cloneNode);
    const edges: GraphEdge[] = [];
    const externalEdges: GraphEdge[] = [];
    if(nodeIds.size){
      for(const e of state.edges){
        const fromIn = nodeIds.has(e.from);
        const toIn = nodeIds.has(e.to);
        const selected = edgeIds.has(e.id);
        if(fromIn && toIn){
          edges.push(cloneEdge(e));
        } else if(fromIn || toIn){
          // Incident edge: store as external candidate (preserve optionally)
          // If edge was explicitly selected, we also mark it external (it has exactly one endpoint in selection)
          // If edge was not selected but incident, we still store it as external for optional preservation
          externalEdges.push(cloneEdge(e));
        } else if(selected && !fromIn && !toIn){
          // Edge selected without its endpoints selected: treat as external requiring both endpoints exist
          externalEdges.push(cloneEdge(e));
        }
      }
      // If user explicitly selected edges whose both endpoints are in selection but edge wasn't captured above? Already captured as internal.
      // For explicitly selected internal edges, they are already in edges.
    } else {
      // No nodes selected: copy selected edges only
      for(const e of state.edges){
        if(edgeIds.has(e.id)) edges.push(cloneEdge(e));
      }
    }
    // Carry the definitions of the custom attributes this payload references,
    // so pasting into a document without them can re-create them.
    // Definitions carry identity in their origins; tokens are internal, so
    // they cross the boundary in the wire spelling (decoded symmetrically on
    // paste). The in-memory payload and the system clipboard both get the
    // encoded form — a raw marker may not travel between documents.
    const customAttributes = referencedCustomAttributes([...nodes, ...edges, ...externalEdges])
      .map(attribute => attribute?.origin == null ? attribute
        : { ...attribute, origin: originForWire(attribute?.origin) });
    clipboardData = { nodes, edges, externalEdges, customAttributes };
    // Publish to the system clipboard for cross-tab paste, but remember the
    // outcome. An in-memory copy is always newer than the system clipboard
    // until this write resolves successfully.
    const writeSeq = ++localClipboardSeq;
    const stamp: ClipboardStamp = { t: Date.now(), s: writeSeq, tab: clipboardTabId };
    // Capture what the system clipboard held before this copy. If publishing
    // fails, a later, different system payload is from another tab and is
    // genuinely newer than our in-memory copy. A denied snapshot stays
    // undefined so it is never mistaken for an empty clipboard.
    let staleSystemText: Promise<string | undefined> = Promise.resolve(undefined);
    try {
      if(navigator.clipboard && typeof navigator.clipboard.readText === 'function'){
        staleSystemText = navigator.clipboard.readText().then(text => text || '', () => undefined);
      }
    } catch { staleSystemText = Promise.resolve(undefined); }
    localClipboardWrite = { seq: writeSeq, state: 'pending', stamp, staleSystemText };
    let payload = '';
    try {
      payload = JSON.stringify({ type: 'graph-editor-clipboard', nodes, edges, externalEdges, customAttributes, clipboardStamp: stamp });
      if(navigator.clipboard && typeof navigator.clipboard.writeText === 'function'){
        const settleWrite = (published: boolean) => {
          if(localClipboardWrite?.seq === writeSeq){
            localClipboardWrite.state = published ? 'published' : 'failed';
            if(published){
              // Shared with other tabs only now that the payload is really on
              // the system clipboard. A failed write leaves the previous stamp
              // (and therefore the previous valid payload) untouched.
              publishClipboardStamp(stamp);
            }
            return;
          }
          // An obsolete write is simply ignored. Never start a compensating
          // write here: anything copied since it began (including plain text
          // from another app) must stay on the clipboard.
        };
        const outcome: any = navigator.clipboard.writeText(payload);
        if(outcome && typeof outcome.then === 'function'){
          outcome.then(() => settleWrite(true), () => settleWrite(false));
        } else {
          settleWrite(true);
        }
      } else {
        localClipboardWrite.state = 'failed';
      }
    } catch {
      if(localClipboardWrite?.seq === writeSeq) localClipboardWrite.state = 'failed';
    }
    // Try to use copyText helper if available
    if(nodes.length || edges.length || externalEdges.length){
      const internalCount = edges.length;
      const externalCount = externalEdges.length;
      const totalEdges = internalCount + externalCount;
      if(nodes.length) toast(I18N.t('copied_n_m', {n: nodes.length, m: totalEdges}) || `Copied ${nodes.length} node(s), ${totalEdges} edge(s)`);
      else toast(I18N.t('copied_edges', {n: edges.length}) || `Copied ${edges.length} edge(s)`);
    }
    // Update command states (paste now available)
    updateCommandStates();
    return true;
  }
  function cutSelectedNodes(){
    if(!copySelectedNodes()) return;
    deleteSelected();
  }
  function duplicateSelectedNodes(){
    if(!copySelectedNodes()) return;
    pasteClipboardInternal();
  }
  function pasteClipboardInternal(fromSystemClipboard?: AnyRecord | null, options?: { exact?: boolean }){
    // 'exact' is the in-place paste: no offset, no collision reshuffle, and
    // carried ids that already exist update the entity in place instead of
    // creating a second copy of it.
    const exactPaste = options?.exact === true;
    // Clone the clipboard entities — the definition resolution below may
    // remap or coerce their custom values, which must never leak back into
    // the clipboard (a second paste has to start from the copied originals).
    const cloneClipboardData = (src: AnyRecord) => ({
      nodes: (Array.isArray(src.nodes) ? src.nodes : [])
        .map((n: AnyRecord) => sanitizeClipboardEntity(cloneNode(n), 'node')).filter((n): n is AnyRecord => n !== null),
      edges: (Array.isArray(src.edges) ? src.edges : [])
        .map((e: AnyRecord) => sanitizeClipboardEntity(cloneEdge(e), 'edge')).filter((e): e is AnyRecord => e !== null),
      externalEdges: (Array.isArray(src.externalEdges) ? src.externalEdges : [])
        .map((e: AnyRecord) => sanitizeClipboardEntity(cloneEdge(e), 'edge')).filter((e): e is AnyRecord => e !== null),
      customAttributes: (Array.isArray(src.customAttributes) ? src.customAttributes : [])
        .filter(isRecord)
        .map((def: AnyRecord) => ({ ...def })),
    });
    let data = null;
    if(fromSystemClipboard && fromSystemClipboard.type === 'graph-editor-clipboard'){
      data = cloneClipboardData(fromSystemClipboard);
    } else if(clipboardData){
      data = cloneClipboardData(clipboardData);
    }
    if(!data || (!data.nodes.length && !data.edges.length && !data.externalEdges.length)){
      toast(I18N.t('clipboard_empty'));
      return false;
    }
    const preserveExternal = state.settings.copyPreserveExternal !== false;
    // Plan which entities will really be pasted BEFORE resolving custom
    // definitions: a definition for a node/edge dropped by the document cap
    // would otherwise be added to the document with no entity to use it.
    const nodeCapacity = Math.max(0, MAX_GRAPH_NODES - state.nodes.length);
    const edgeCapacity = Math.max(0, MAX_GRAPH_EDGES - state.edges.length);
    let droppedNodes = 0, droppedEdges = 0;
    const reportDropped = () => {
      if(droppedNodes) toast(I18N.t('paste_cap_nodes', {n: droppedNodes, limit: MAX_GRAPH_NODES}));
      if(droppedEdges) toast(I18N.t('paste_cap_edges', {n: droppedEdges, limit: MAX_GRAPH_EDGES}));
    };
    const originalExistingNodeIds = new Set(state.nodes.map(n => n.id));
    const originalExistingEdgeIds = new Set(state.edges.map(e => e.id));
    const sortedCopyNodes = [...data.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    const plannedNodes: AnyRecord[] = [];
    const plannedNodeIds = new Set<string>();
    // A carried node rejected by the cap must still be remembered: its id may
    // name a real node in this document, but it is NOT an external endpoint
    // for this paste — it was carried and dropped, so edges through it go too.
    const rejectedNodeIds = new Set<string>();
    let nodeSlots = nodeCapacity;
    for(const orig of sortedCopyNodes){
      const id = String(orig?.id ?? '');
      if(!id || plannedNodeIds.has(id)){ droppedNodes++; if(id) rejectedNodeIds.add(id); continue; }
      plannedNodeIds.add(id);
      // In exact mode an existing id is an update, so it consumes no slot.
      if(!exactPaste || !originalExistingNodeIds.has(id)){
        if(nodeSlots <= 0){ droppedNodes++; rejectedNodeIds.add(id); continue; }
        nodeSlots--;
      }
      plannedNodes.push(orig);
    }
    data.nodes = plannedNodes;
    // An endpoint's fate decides whether a carried edge will be pasted at
    // all: 'pasted' = it clones with this paste, 'existing' = it stays bound
    // to a node the document already has, 'absent' = it points nowhere and
    // the edge is dropped. Definition minting below is limited to the edges
    // that will actually materialize — a dropped edge must not leave a
    // phantom definition (and its values) behind.
    const carriedNodeIds = new Set(data.nodes.map(n => String(n?.id)));
    const endpointFate = (id: unknown): 'pasted' | 'existing' | 'absent' => {
      const key = String(id ?? '');
      if(rejectedNodeIds.has(key)) return 'absent';
      return carriedNodeIds.has(key) ? 'pasted' : originalExistingNodeIds.has(key) ? 'existing' : 'absent';
    };
    const edgeMaterializes = (orig: AnyRecord, isExternal: boolean): boolean => {
      if(isExternal && !preserveExternal) return false;
      // An omitted endpoint stays as it is on an existing edge; only a
      // supplied endpoint has to name a node that will exist after the paste.
      if(exactPaste && originalExistingEdgeIds.has(String(orig?.id ?? ''))){
        if(clipboardHas(orig, 'from') && endpointFate(orig.from) === 'absent') return false;
        if(clipboardHas(orig, 'to') && endpointFate(orig.to) === 'absent') return false;
        return true;
      }
      const fs = endpointFate(orig?.from), ts = endpointFate(orig?.to);
      if(fs === 'pasted' && ts === 'pasted') return true;
      if(fs === 'absent' || ts === 'absent') return false;
      if(fs === 'existing' && ts === 'existing') return true;
      // Exactly one pasted side: an external edge reaching into the document.
      return preserveExternal;
    };
    const candidateEdges = [
      ...data.edges.filter(e => edgeMaterializes(e, false)).map(e => ({ entity: e })),
      ...(data.externalEdges || []).filter(e => edgeMaterializes(e, true)).map(e => ({ entity: e })),
    ];
    const plannedEdgeIds = new Set<string>();
    const plannedEdges: AnyRecord[] = [];
    let edgeSlots = edgeCapacity;
    for(const { entity: orig } of candidateEdges){
      const id = String(orig?.id ?? '');
      if(!id || plannedEdgeIds.has(id)){ droppedEdges++; continue; }
      plannedEdgeIds.add(id);
      // Updating an existing edge consumes no capacity; only new edges do.
      if(!exactPaste || !originalExistingEdgeIds.has(id)){
        if(edgeSlots <= 0){ droppedEdges++; continue; }
        edgeSlots--;
      }
      plannedEdges.push(orig);
    }
    const materializedEdges = plannedEdges.map(entity => ({ entity }));
    // Re-create carried custom-attribute definitions this document lacks.
    // Definitions are resolved per (id, scope) PAIR, not by id alone: an
    // existing definition with the same id but a different scope cannot
    // display or export the pasted values, so in that case the carried
    // definition is re-created under a fresh unique id and the carried values
    // are remapped to it (lossless). Same-pair definitions merge (the
    // existing one wins). Definitions beyond the definition cap are skipped with a
    // toast and their values are dropped, as on any other load path.
    const carriedDefs = (Array.isArray(data.customAttributes) ? data.customAttributes : [])
      .filter(isRecord)
      .map(def => {
        // Lookups against the payload's value keys must use the ORIGINAL
        // key — it can be arbitrarily long. Definition ids are capped at
        // 128 by the sanitizer, so a destination id over-long is minted at
        // creation time from the capped base, never by bisecting the key
        // here (two keys sharing the first 128 chars are different
        // properties — they may not collapse onto one definition).
        const fullId = String(def.id ?? '').trim();
        const id = fullId;
        const scope = ['graph','node','edge','all'].includes(String(def.scope)) ? String(def.scope) : 'node';
        const type = CUSTOM_ATTRIBUTE_TYPES.includes(String(def.type)) ? String(def.type) : 'string';
        if(!id) return null;
        const name = String(def.name ?? '').trim().slice(0, 128);
        // The origin is identity data (the carried key id the definition was
        // minted from) — stored in full up to the identity bound, then as a
        // fingerprint of the full string. The clipboard is foreign input: the
        // wire spellings decode, raw marker-shaped input may not mint a token.
        const origin = originFromForeign((def as AnyRecord).origin);
        return { id, scope: scope as 'graph' | 'node' | 'edge' | 'all', type, ...(name ? { name } : {}), ...(origin ? { origin } : {}) };
      })
      .filter((def): def is { id: string; scope: 'graph' | 'node' | 'edge' | 'all'; type: string; name?: string; origin?: string } => def !== null);
    const defsByPair = new Map(state.customAttributes.map(attribute => [attribute.id + '|' + attribute.scope, attribute]));
    const existingPairs = new Set(defsByPair.keys());
    const carriedByPair = new Map<string, { id: string; scope: 'graph' | 'node' | 'edge' | 'all'; type: string; name?: string; origin?: string }>(carriedDefs.map(def => [def.id + '|' + def.scope, def]));
    const carriedScopeById = new Map<string, 'graph' | 'node' | 'edge' | 'all'>(carriedDefs.map(def => [def.id, def.scope]));
    const carriedTypeById = new Map<string, string>(carriedDefs.map(def => [def.id, def.type]));
    // Ids that may not be handed out during this paste. A pair's own carried
    // id stays available for its own direct creation; every existing
    // definition, every carried id (another pair's creation target) and every
    // definition created here is off-limits for minting a fresh unique id.
    const createdIds = new Set(state.customAttributes.map(attribute => attribute.id));
    const mintTaken = new Set([...createdIds, ...carriedTypeById.keys()]);
    let remaining = Math.max(0, CUSTOM_DEFINITIONS_MAX - state.customAttributes.length);
    let skipped = 0;
    let renamed = 0;
    const failedPairs = new Set<string>();
    // Per-paste resolution cache: ensurePair runs once per key per entity,
    // but a freshly created/reused definition only reaches state after the
    // loop — so the pair must be marked resolved here or the second node in
    // the same payload would mint a duplicate.
    const handledPairs = new Set<string>();
    // One paste = one pass: a definition reused here for one carried property
    // may not be claimed by another (distinct ids, same recorded name) — the
    // later remap would overwrite the earlier property's values with its own.
    const claimed = new Set<string>();
    const renameByPair = new Map<string, string>();
    const defsToAdd: { id: string; scope: 'node' | 'edge' | 'all'; type: string; name?: string; origin?: string }[] = [];
    const addDef = (newId: string, scope: 'node' | 'edge' | 'all', type: string, carriedOrigin: string, provenance?: { name: string }) => {
      defsToAdd.push({ id: newId, scope, type, origin: carriedOrigin, ...provenance });
      existingPairs.add(newId + '|' + scope);
      createdIds.add(newId);
      mintTaken.add(newId);
    };
    // Two definitions sharing id+scope are the same property ONLY when both
    // carry no recorded name (created manually — nothing else to go on) or
    // both carry the same recorded one, AND both record compatible origins
    // (a re-export keeps the key id its definition was minted from; an
    // older one defaults it to the carried id). Anything else is a different
    // property sharing the id: it must be re-created under a fresh id and
    // the carried values remapped, never merged into the existing definition.
    const provenanceMatches = (existing: AnyRecord | undefined, carried: AnyRecord | undefined) => {
      const existingName = String(existing?.name ?? '').trim().toLowerCase();
      const carriedName = String(carried?.name ?? '').trim().toLowerCase();
      if(existingName || carriedName){
        if(existingName !== carriedName) return false;
      }
      // The exact-pair branch is the same identity question as the import's
      // exact-pair branch, so it applies the same rule there: both sides
      // recording conflicting origins proves a different property sharing
      // the id. An origin-less definition offers only its own id as merge
      // evidence — a carried key whose identity is a DIFFERENT string (a
      // longer foreign id, a fingerprint of one) proves nothing was shared
      // and mints instead; only an exactly-equal key id or recorded origin
      // keeps the free merge.
      const existingOrigin = String(existing?.origin ?? '').trim() || String(existing?.id ?? '').trim();
      const carriedOrigin = String(carried?.origin ?? '').trim() || literalForeignIdentity(String(carried?.id ?? '').trim());
      return existingOrigin === carriedOrigin;
    };
    const ensurePair = (id: string, scope: 'node' | 'edge' | 'all') => {
      const key = id + '|' + scope;
      if(failedPairs.has(key) || handledPairs.has(key)) return;
      if(existingPairs.has(key) && provenanceMatches(defsByPair.get(key), carriedByPair.get(key))) {
        handledPairs.add(key); // merge: existing wins
        return;
      }
      // An existing 'all' definition is the document's definition for this id
      // on every scope — a carried narrower-scope pair with matching
      // provenance merges into it (existing wins), never mints an env_1 twin.
      const allKey = id + '|all';
      if(scope !== 'all' && existingPairs.has(allKey) && provenanceMatches(defsByPair.get(allKey), carriedByPair.get(key))) {
        handledPairs.add(key); // merge: the all definition wins
        return;
      }
      // Fall through to the reuse/mint machinery: a key collision between
      // DIFFERENT properties resolves exactly like a missing pair — the mint
      // path re-creates the carried definition under a fresh id and remaps
      // the values, leaving the existing definition untouched.
      const carriedPair = carriedByPair.get(key);
      const type = carriedPair ? carriedPair.type : (carriedTypeById.get(id) || 'string');
      // A reusable mapping already exists in the document. Resolving it
      // before ANY mint decision matters twice: reuse creates no definition,
      // so it must never be blocked by a full document; and identity
      // binding must not depend on the carried id being free — a definition
      // re-created under a fresh id by an earlier import (origin = the
      // foreign key id) must be found even when the carried id itself is
      // unused here. Identity across pastes is the recorded origin (a
      // re-exported payload keeps it), with the recorded name as a guard:
      // when both sides carry a name, it must agree — a different
      // property sharing the key id must never be claimed. A definition
      // claimed by an earlier property in this paste is no longer a
      // candidate.
      const carriedName = (String(carriedPair?.name ?? '').trim() || id).toLowerCase();
      const carriedNameRaw = String(carriedPair?.name ?? '').trim().toLowerCase();
      const incOrigin = (String(carriedPair?.origin ?? '').trim() || literalForeignIdentity(String(carriedPair?.id ?? '').trim() || id));
      const nameAgreement = (a: AnyRecord | undefined) => {
        const an = String(a?.name ?? '').trim().toLowerCase();
        return !an || !carriedNameRaw || an === carriedNameRaw;
      };
      const scopeCovered = (a: AnyRecord | undefined) => a?.scope === scope || a?.scope === 'all';
      const prior = state.customAttributes.find(attribute =>
        scopeCovered(attribute as AnyRecord) && !carriedTypeById.has(attribute.id)
        && !claimed.has(attribute.id + '|' + attribute.scope)
        && attribute.origin && String(attribute.origin) === incOrigin
        && nameAgreement(attribute as AnyRecord))
      ?? state.customAttributes.find(attribute => {
        if(!scopeCovered(attribute as AnyRecord)) return false;
        if(carriedTypeById.has(attribute.id)) return false;
        if(claimed.has(attribute.id + '|' + attribute.scope)) return false;
        // The recorded-name rule binds only origin-less definitions (created
        // manually); a provenance-tracked definition belongs to a specific
        // key id and may not drift onto a different one.
        if(String((attribute as AnyRecord).origin ?? '').trim()) return false;
        return String(attribute.name ?? '').trim().toLowerCase() === carriedName;
      });
      if(prior){
        renameByPair.set(key, prior.id);
        // Claim the definition under ITS OWN scope — the exclusion scans in
        // the two candidate queries probe with the candidate's attribute.scope.
        // Claiming an 'all' definition adopted for a narrower carried pair
        // under the carried scope would leave it unclaimed for those scans,
        // and a second distinct carried property named the same would be
        // granted the same definition (its values landing on the first's).
        claimed.add(prior.id + '|' + String((prior as AnyRecord)?.scope ?? scope));
        handledPairs.add(key);
        return;
      }
      if(remaining <= 0){ failedPairs.add(key); skipped++; return; }
      if(id.length <= 128 && !createdIds.has(id)){
        remaining--;
        addDef(id, scope, type, (String(carriedPair?.origin ?? '').trim() || literalForeignIdentity(String(carriedPair?.id ?? '').trim() || id)), carriedPair?.name ? { name: carriedPair.name } : undefined);
        handledPairs.add(key);
        return;
      }
      const newId = uniqueCustomAttributeId(id, mintTaken);
      remaining--;
      renamed++;
      // Keep the carried definition's recorded name when it has one; when it
      // has none, record the carried id as the name so the next paste (or a
      // round-trip of an export of it) finds THIS definition instead of
      // minting a second one for the same property.
      addDef(newId, scope, type, (String(carriedPair?.origin ?? '').trim() || literalForeignIdentity(String(carriedPair?.id ?? '').trim() || id)), { name: carriedPair?.name || id });
      renameByPair.set(key, newId);
      handledPairs.add(key);
    };
    const ensureEntityPairs = (entities: AnyRecord[], scope: 'node' | 'edge') => {
      for(const entity of entities){
        if(!isRecord(entity?.custom)) continue;
        for(const key of Object.keys(entity.custom)){
          // A carried 'all' definition owns its values on every scope — an
          // entity value keyed by it must resolve against the 'all' pair,
          // never mint a competing per-scope twin. Other carried scopes keep
          // today's per-scope handling (a cross-scope id forks losslessly).
          ensurePair(key, carriedScopeById.get(key) === 'all' ? 'all' : scope);
        }
      }
    };
    ensureEntityPairs(data.nodes, 'node');
    ensureEntityPairs(materializedEdges.map(m => m.entity), 'edge');
    if(defsToAdd.length) state.customAttributes.push(...defsToAdd);
    // A definition minted or rebound during this paste is a document change
    // even if no entity field ends up differing — undo has to cover it.
    const definitionsChanged = defsToAdd.length > 0 || renameByPair.size > 0;
    // Remap carried values whose definition was re-created under a fresh id.
    if(renameByPair.size){
      const remapCustom = (entity: AnyRecord, scope: 'node' | 'edge') => {
        if(!isRecord(entity?.custom)) return;
        const out: Record<string, CustomAttributeValue> = Object.create(null);
        for(const [key, value] of Object.entries(entity.custom)){
          // Values of an all-scope definition are keyed under 'all|' — look
          // there before the per-scope entry.
          out[renameByPair.get(key + '|all') || renameByPair.get(key + '|' + scope) || key] = value as CustomAttributeValue;
        }
        entity.custom = out;
      };
      for(const node of data.nodes) remapCustom(node, 'node');
      for(const { entity: edge } of materializedEdges) remapCustom(edge, 'edge');
    }
    if(defsToAdd.length){ flushDeferredCustomAttributes(); renderCustomPropHosts(); }
    if(skipped) toast(I18N.t('attribute_import_skipped', { n: skipped }));
    if(renamed) toast(I18N.t('attribute_scope_renamed', { n: renamed }));
    // Coerce carried values against the definitions applicable to each
    // entity's scope. A same-id definition surviving in another scope marks
    // the value as a collapsed orphan — kept verbatim, never destroyed; an
    // id with no definition anywhere is dropped.
    const pasteAllSurvivingTypeById = customAttributeTypeMap(state.customAttributes);
    const pasteNodeTypeById = customAttributeTypeMap(state.customAttributes.filter(a => defAppliesTo(a, 'node')));
    const pasteEdgeTypeById = customAttributeTypeMap(state.customAttributes.filter(a => defAppliesTo(a, 'edge')));
    for(const entity of [...data.nodes]){
      const resolved = sanitizeCustomValues(entity?.custom, pasteNodeTypeById, pasteAllSurvivingTypeById);
      if(resolved) entity.custom = resolved; else delete entity?.custom;
    }
    for(const { entity } of materializedEdges){
      const resolved = sanitizeCustomValues(entity?.custom, pasteEdgeTypeById, pasteAllSurvivingTypeById);
      if(resolved) entity.custom = resolved; else delete entity?.custom;
    }
    if(exactPaste){
      // Exact paste is a *merge*, not a clone pass. Each carried id names one
      // entity: if the document already has it, that object is updated and no
      // second copy is made. Only keys present in the payload are written, so
      // unrelated fields an existing node/edge acquired since the copy stay
      // intact; the node order is left alone as well. Coordinates, however,
      // are restored verbatim (no offset and no free-spot search).
      const valuesEqual = (a: unknown, b: unknown): boolean => {
        if(a === b) return true;
        if(isRecord(a) && isRecord(b)){
          const ak = Object.keys(a), bk = Object.keys(b);
          return ak.length === bk.length && ak.every(k => valuesEqual(a[k], b[k]));
        }
        return false;
      };
      // Custom values are merged key by key, never as a whole map: a payload
      // carrying only p1 must leave the document's unrelated p2 untouched.
      const mergeCustom = (target: AnyRecord, carriedCustom: unknown) => {
        const incoming = cloneCustomMap(carriedCustom);
        if(!incoming) return false;
        const out: AnyRecord = Object.create(null);
        if(isRecord(target.custom)) for(const key of Object.keys(target.custom)) out[key] = target.custom[key];
        let changed = false;
        for(const key of Object.keys(incoming)){
          if(!Object.prototype.hasOwnProperty.call(out, key) || !valuesEqual(out[key], incoming[key])){
            out[key] = incoming[key]; changed = true;
          }
        }
        if(changed) target.custom = out;
        return changed;
      };
      const mergeCarried = (target: AnyRecord, carried: AnyRecord, keep: string[] = []) => {
        let changed = false;
        for(const key of Object.keys(carried)){
          if(key === 'id' || key === 'custom' || keep.includes(key)) continue;
          const incoming = carried[key];
          if(!valuesEqual(target[key], incoming)){ target[key] = incoming; changed = true; }
        }
        if(mergeCustom(target, carried.custom)) changed = true;
        return changed;
      };
      const nodeById = new Map(state.nodes.map(n => [n.id, n] as [string, GraphNode]));
      const edgeById = new Map(state.edges.map(e => [e.id, e] as [string, GraphEdge]));
      const pastedNodeIds: string[] = [];
      const pastedEdgeIds: string[] = [];
      let changed = false;
      let nextFreeOrder = state.nodes.reduce((m, n) => Math.max(m, n.order ?? 0), -1) + 1;
      for(const orig of [...data.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0))){
        const node: AnyRecord = cloneNode(orig);
        const existing = nodeById.get(node.id);
        // Only coordinates actually carried by the clipboard are written. A
        // partial payload that omits x/y must never reset a stored position.
        for(const axis of ['x','y'] as const){
          if(Object.prototype.hasOwnProperty.call(node, axis)){
            const numeric = Number(node[axis]);
            node[axis] = Number.isFinite(numeric) ? numeric : (existing ? finite(existing[axis], 0) : 0);
          } else if(existing){
            delete node[axis];
          } else {
            node[axis] = 0;
          }
        }
        if(existing){
          if(mergeCarried(existing, node, ['order'])) changed = true;
          pastedNodeIds.push(existing.id);
        } else {
          if(state.nodes.length >= MAX_GRAPH_NODES){ droppedNodes++; continue; }
          state.nextNode = advanceCounterFromId(state.nextNode, node.id);
          const carriedOrder = Number(node.order);
          node.order = Number.isFinite(carriedOrder) ? carriedOrder : nextFreeOrder++;
          state.nodes.push(node as GraphNode); nodeById.set(node.id, node as GraphNode);
          pastedNodeIds.push(node.id); changed = true;
        }
      }
      const pastedNodeIdSet = new Set(pastedNodeIds);
      for(const { entity: orig } of materializedEdges){
        // Never create an edge whose carried endpoint was dropped by the cap:
        // it would be dangling and the loader would discard it on reopen.
        const from = String(orig.from ?? ''), to = String(orig.to ?? '');
        if((carriedNodeIds.has(from) && !pastedNodeIdSet.has(from)) ||
           (carriedNodeIds.has(to) && !pastedNodeIdSet.has(to))){ droppedEdges++; continue; }
        const edge = cloneEdge(orig) as GraphEdge;
        const existing = edgeById.get(edge.id);
        if(existing){
          if(mergeCarried(existing, edge)) changed = true;
          pastedEdgeIds.push(existing.id);
        } else {
          if(state.edges.length >= MAX_GRAPH_EDGES){ droppedEdges++; continue; }
          state.nextEdge = advanceCounterFromId(state.nextEdge, edge.id);
          // Endpoints are carried verbatim: a pasted node reuses its own id,
          // an external endpoint is a pre-existing node in this document.
          state.edges.push(edge); edgeById.set(edge.id, edge);
          pastedEdgeIds.push(edge.id); changed = true;
        }
      }
      if(changed || definitionsChanged){
        if(data.nodes.length) state.nodes.sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
        invalidateGraphIndex();
        pushHistory('paste in place');
      }
      if(pastedNodeIds.length || pastedEdgeIds.length){
        setSelection(pastedNodeIds, pastedEdgeIds,
          pastedNodeIds.length ? {type:'node', id: pastedNodeIds[0]} : {type:'edge', id: pastedEdgeIds[0]}, false);
      }
      queueRender(true, true);
      if(!changed && !definitionsChanged) toast(I18N.t('pasted_exact_noop'));
      else if(pastedNodeIds.length) toast(I18N.t('pasted_exact_n_m', {n: pastedNodeIds.length, m: pastedEdgeIds.length}));
      else toast(I18N.t('pasted_exact_edges', {n: pastedEdgeIds.length}));
      reportDropped();
      saveSoon();
      return true;
    } else {
      const maxOrder = state.nodes.reduce((m, n) => Math.max(m, n.order ?? 0), -1);
      let nextOrder = maxOrder + 1;
      pasteOffsetCount = (pasteOffsetCount + 1) % 20;
      const offsetDist = 40 + pasteOffsetCount * 10;
      const idMap = new Map<string, string>();
      const newNodes: GraphNode[] = [];
      const newNodeIds: string[] = [];
      const existingNodeIds = new Set(originalExistingNodeIds);
      const isFreeWithPlaced = (x:number, y:number, ignoreIds:Set<string>, placed:GraphNode[]) => {
        if(!isPositionFree(x, y, ignoreIds)) return false;
        for(const pn of placed){
          if(Math.hypot(pn.x - x, pn.y - y) < 50) return false;
        }
        return true;
      };
      const findFreeForPaste = (x:number, y:number, ignoreIds:Set<string>, placed:GraphNode[]) => {
        if(isFreeWithPlaced(x, y, ignoreIds, placed)) return {x, y};
        const step = 50;
        for(let ring=1; ring<=8; ring++){
          const radius = step * ring;
          const count = Math.max(8, ring * 8);
          for(let i=0; i<count; i++){
            const a = i * Math.PI*2 / count;
            const px = x + Math.cos(a)*radius;
            const py = y + Math.sin(a)*radius;
            if(isFreeWithPlaced(px, py, ignoreIds, placed)) return {x:px, y:py};
          }
        }
        return {x: x + 80, y: y + 80};
      };
      // data.nodes is the planned set: cap-rejected and duplicate-id entries
      // were already removed before custom definitions were resolved.
      for(const orig of data.nodes){
        let newId = orig.id;
        const used = new Set([...existingNodeIds, ...newNodeIds]);
        if(used.has(newId)){
          const allocated = allocateLocalId('n', used, state.nextNode);
          newId = allocated.id;
          state.nextNode = allocated.next;
        } else {
          state.nextNode = advanceCounterFromId(state.nextNode, newId);
        }
        idMap.set(orig.id, newId);
        const cloned: GraphNode = cloneNode({...orig, id: newId, order: nextOrder++} as GraphNode);
        let nx = finite(orig.x, 0) + offsetDist;
        let ny = finite(orig.y, 0) + offsetDist;
        // The clone is not in state.nodes yet, so nothing may be ignored:
        // ignoring every existing id (as the merged branch did) disables the
        // overlap check against the graph entirely. Already-placed clones are
        // covered by findFreeForPaste's `placed` check.
        const free = findFreeForPaste(nx, ny, new Set<string>(), newNodes);
        cloned.x = free.x;
        cloned.y = free.y;
        newNodes.push(cloned);
        newNodeIds.push(newId);
        existingNodeIds.add(newId);
      }
      const finalNewEdges: GraphEdge[] = [];
      const usedEdgeIds2 = new Set(state.edges.map(e=>e.id));
      const edgeIdMap = new Set<string>();
      const addEdgeWithNewId = (orig: GraphEdge, from: string, to: string) => {
        let nid = orig.id;
        if(usedEdgeIds2.has(nid) || edgeIdMap.has(nid)){
          const usedEdgeIds = new Set([...usedEdgeIds2, ...edgeIdMap]);
          const allocated = allocateLocalId('e', usedEdgeIds, state.nextEdge);
          nid = allocated.id;
          state.nextEdge = allocated.next;
        } else {
          state.nextEdge = advanceCounterFromId(state.nextEdge, nid);
        }
        const ce: GraphEdge = cloneEdge({...orig, id: nid, from, to} as GraphEdge);
        finalNewEdges.push(ce);
        edgeIdMap.add(nid);
        usedEdgeIds2.add(nid);
      };
      // The set was resolved before the definitions were minted; idMap now
      // agrees with it one-to-one (an endpoint maps iff it is being pasted).
      for(const { entity: orig } of materializedEdges){
        const from = String(orig.from ?? ''), to = String(orig.to ?? '');
        // A node dropped by the node cap has no clone; an edge pointing at it
        // would be dangling after reload, so it is dropped here as well.
        if((carriedNodeIds.has(from) && !idMap.has(from)) ||
           (carriedNodeIds.has(to) && !idMap.has(to))){ droppedEdges++; continue; }
        if(finalNewEdges.length >= edgeCapacity){ droppedEdges++; continue; }
        const nf = idMap.get(orig.from), nt = idMap.get(orig.to);
        addEdgeWithNewId(orig as GraphEdge, nf ?? orig.from, nt ?? orig.to);
      }
      if(newNodes.length) state.nodes.push(...newNodes);
      if(finalNewEdges.length) state.edges.push(...finalNewEdges);
      state.nodes.sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
      if(finalNewEdges.length) invalidateGraphIndex();
      const selNodes = newNodes.map(n=>n.id);
      const selEdges = finalNewEdges.map(e=>e.id);
      if(selNodes.length || selEdges.length){
        setSelection(selNodes, selEdges, selNodes.length ? {type:'node', id: selNodes[0]} : (selEdges.length ? {type:'edge', id: selEdges[0]} : null), false);
      }
      pushHistory('paste'); queueRender(true, true);
      const totalPastedEdges = finalNewEdges.length;
      if(newNodes.length) toast(I18N.t('pasted_n_m', {n: newNodes.length, m: totalPastedEdges}) || `Pasted ${newNodes.length} node(s), ${totalPastedEdges} edge(s)`);
      else if(totalPastedEdges) toast(I18N.t('pasted_edges', {n: totalPastedEdges}) || `Pasted ${totalPastedEdges} edge(s)`);
      reportDropped();
      saveSoon();
      return true;
    }
  }
  async function pasteFromClipboardSource(exact: boolean){
    const hasInternal = Boolean(clipboardData &&
      (clipboardData.nodes.length || clipboardData.edges.length || clipboardData.externalEdges.length));
    if(pendingSystemRead){
      // Supersede the in-flight command. Another paste is still a request to
      // read the CURRENT system clipboard, never an implicit request to use
      // the older local copy.
      pasteGeneration++;
      pendingSystemRead = null;
    }
    const token = ++pasteGeneration;
    const pending = { token };
    // Keep the marker for the whole command: the snapshot wait below is just
    // as cancellable as the clipboard read itself.
    pendingSystemRead = pending;
    try {
      const outcome: any = await (async (): Promise<{ text: string } | { error: unknown }> => {
        try { return { text: (await navigator.clipboard.readText()) || '' }; }
        catch(e){ return { error: e }; }
      })();
      if(token !== pasteGeneration) return; // superseded by another paste

      let systemData: AnyRecord | null = null;
      let systemIssue: { key: string; params?: AnyRecord } | null = null;
      let text = '';
      if(outcome && outcome.error){
        systemIssue = { key:'paste_failed', params:{msg:(outcome.error as Error)?.message} };
        // Falling back to the in-memory copy is an explicit response to an
        // unavailable system clipboard, not a side effect of another paste.
        if(hasInternal){
          toast(I18N.t('paste_local_fallback'));
          pasteClipboardInternal(null, { exact });
          return;
        }
      } else {
        text = outcome?.text || '';
      }

      if(text.trim()){
        try {
          const parsed = JSON.parse(text);
          if(parsed && parsed.type === 'graph-editor-clipboard'){
            systemData = parsed;
          } else if(parsed && Array.isArray(parsed.nodes)){
            systemIssue = { key:'paste_failed', params:{msg:I18N.t('err_not_node_clipboard')} };
          } else {
            systemIssue = { key:'clipboard_empty' };
          }
        } catch(e){
          systemIssue = { key:'paste_failed', params:{msg:(e as Error).message} };
        }
      } else if(!systemIssue){
        systemIssue = { key:'clipboard_empty' };
      }

      let systemCanBeNewer = !localClipboardWrite || localClipboardWrite.state === 'published';
      let systemRejectedByStamp = false;
      if(localClipboardWrite?.state === 'failed'){
        // An unavailable snapshot gives no ordering evidence: keep the local
        // copy authoritative rather than letting an old legacy payload win.
        const staleText = await boundedRead<string | undefined>(localClipboardWrite.staleSystemText, undefined);
        if(token !== pasteGeneration) return; // cancelled during the snapshot wait
        systemCanBeNewer = staleText !== undefined && text !== staleText;
      }
      if(systemData && localClipboardWrite){
        // A newer stamped payload is valid regardless of our local write being
        // pending or failed; an older one is never valid. Only the local write
        // provides evidence here: a persistent stamp is clipboard history and
        // cannot tell what the user currently has on the clipboard.
        const order = compareClipboardStamps(systemData.clipboardStamp, localClipboardWrite.stamp);
        if(order === true) systemCanBeNewer = true;
        else if(order === false){ systemCanBeNewer = false; systemRejectedByStamp = true; }
      }
      if(token !== pasteGeneration) return;

      if(systemData && systemCanBeNewer && !systemRejectedByStamp){ pasteClipboardInternal(systemData, { exact }); return; }
      if(hasInternal){ pasteClipboardInternal(null, { exact }); return; }
      if(systemData && !systemRejectedByStamp){ pasteClipboardInternal(systemData, { exact }); return; }
      if(systemIssue) toast(I18N.t(systemIssue.key, systemIssue.params));
      else if(systemRejectedByStamp) toast(I18N.t('clipboard_empty'));
    } finally {
      if(pendingSystemRead === pending) pendingSystemRead = null;
    }
  }
  function pasteFromSystemClipboard(){ return pasteFromClipboardSource(false); }
  function pasteExactFromSystemClipboard(){ return pasteFromClipboardSource(true); }
