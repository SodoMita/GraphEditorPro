  function snapshot(){
    return JSON.stringify({
      title:state.title, mode:state.mode, selectTool:state.selectTool, selectCombine:state.selectCombine, nextNode:state.nextNode, nextEdge:state.nextEdge,
      nodes:state.nodes, edges:state.edges, settings:state.settings, viewBox:state.viewBox,
      // Preserve user focus across undo/redo so editing the same object stays ergonomic
      selected:state.selected, selection:state.selection
    });
  }
  function applySnapshot(raw){
    edgeOffsetCache = null;
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const sane = sanitizeState(data);
    // Restore selection if it survives sanitization (nodes/edges still exist)
    const savedSel = data.selected, savedSelection = data.selection;
    state = {...state, ...sane, selected:null, selection:{nodes:[], edges:[]}};
    if(savedSel && savedSelection){
      const nodeIdSet = new Set(state.nodes.map(n => n.id));
      const edgeIdSet = new Set(state.edges.map(e => e.id));
      const validNodes = (savedSelection.nodes || []).filter(id => nodeIdSet.has(id));
      const validEdges = (savedSelection.edges || []).filter(id => edgeIdSet.has(id));
      state.selection = {nodes: validNodes, edges: validEdges};
      if(savedSel.type === 'node' && nodeIdSet.has(savedSel.id)) state.selected = savedSel;
      else if(savedSel.type === 'edge' && edgeIdSet.has(savedSel.id)) state.selected = savedSel;
      else if(validNodes.length) state.selected = {type:'node', id:validNodes[0]};
      else if(validEdges.length) state.selected = {type:'edge', id:validEdges[0]};
    }
    syncControls();
    queueRender(true, true);
    saveSoon();
  }
  function pushHistory(label='change'){
    edgeOffsetCache = null;
    const snap = snapshot();
    if(historyStack[historyIndex] === snap) return;
    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(snap);
    if(historyStack.length > 100){ historyStack.shift(); } else { historyIndex++; }
    updateUndoRedo();
    saveSoon();
  }
  function undo(){ if(historyIndex <= 0) return; historyIndex--; applySnapshot(historyStack[historyIndex]); toast(I18N.t('undone')); }
  function redo(){ if(historyIndex >= historyStack.length - 1) return; historyIndex++; applySnapshot(historyStack[historyIndex]); toast(I18N.t('redone')); }
  function updateUndoRedo(){
    $('#btnUndo').disabled = historyIndex <= 0;
    $('#btnRedo').disabled = historyIndex >= historyStack.length - 1;
  }

