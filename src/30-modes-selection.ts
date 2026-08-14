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
  function setSelection(nodes: string[] = [], edges: string[] = [], primary: SelectedRef | null = null, combine: SelectCombine | boolean | null = 'replace'){
    if(combine === true) combine = 'add';
    if(combine === false || combine == null) combine = 'replace';
    const nodeSet = combine === 'replace' ? new Set<string>() : selectedNodeIds();
    const edgeSet = combine === 'replace' ? new Set<string>() : selectedEdgeIds();
    if(combine === 'subtract'){
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
  function syncSelectionDom(){
    const ns = selectedNodeIds(), es = selectedEdgeIds();
    nodesLayer.querySelectorAll('.node.selected,.node.dragging').forEach(el => el.classList.remove('selected','dragging'));
    nodesLayer.querySelectorAll<SVGElement>('.node').forEach(el => el.classList.toggle('selected', ns.has(el.dataset.id as string)));
    edgesLayer.querySelectorAll<SVGElement>('.edge').forEach(el => {
      const selected = es.has(el.dataset.id);
      el.classList.toggle('selected', selected);
      const e = edgeById(el.dataset.id);
      // Update arrow color to match selection state
      const arrow = el.querySelector('.edge-arrow');
      if(arrow && e){
        const v = edgeVisual(e);
        arrow.setAttribute('fill', selected ? '#22d3ee' : v.color);
      }
    });
    updateMatrixSelectionDom();
  }
  function updateMatrixSelectionDom(){
    const ns = selectedNodeIds(), es = selectedEdgeIds();
    $$('#matrixHost [data-node-label]').forEach(input => input.classList.toggle('matrix-selected', ns.has(input.dataset.nodeLabel)));
    $$('#matrixHost [data-cell-from][data-cell-to]').forEach(input => {
      const ids = (input.dataset.cellEdges || '').split(',').filter(Boolean);
      input.classList.toggle('matrix-selected', ids.some(id => es.has(id)));
    });
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

