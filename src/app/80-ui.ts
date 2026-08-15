  function wireUi(){
    svg.addEventListener('selectstart', ev => ev.preventDefault());
    svg.addEventListener('contextmenu', ev => ev.preventDefault());
    svg.addEventListener('auxclick', ev => ev.preventDefault());
    $$('.tab').forEach(btn => btn.addEventListener('click', () => {
      // Mobile-app style: tapping a tab opens its panel as a bottom sheet;
      // tapping the active tab again closes the sheet. Both the bottom tab
      // bar and the sheet-header tabs share this handler and stay in sync.
      const target = btn.dataset.tab;
      const panel = $(`#panel-${target}`);
      const opening = !panel.classList.contains('active');
      $$('.tab-panel').forEach(p => p.classList.remove('active'));
      $$('.tab').forEach(b => b.classList.toggle('active', opening && b.dataset.tab === target));
      if(opening) panel.classList.add('active');
      const sidebarEl = document.querySelector('.sidebar');
      if(sidebarEl) sidebarEl.classList.toggle('open', opening);
    }));
    // Hamburger menu: opens/closes the panel sheet (tabs live in the sheet
    // header, so the menu button just re-triggers the active tab).
    const menuBtn = $('#btnMenu');
    if(menuBtn){
      menuBtn.addEventListener('click', () => {
        const tab = document.querySelector<HTMLElement>('.sidebar .tabs .tab.active')
          || document.querySelector<HTMLElement>('.sidebar .tabs .tab[data-tab="edit"]');
        if(tab) tab.click();
      });
    }
    $$('[data-mode]').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
    $$('[data-selecttool]').forEach(btn => btn.addEventListener('click', () => setSelectTool(btn.dataset.selecttool)));
    $$('[data-selectcombine]').forEach(btn => btn.addEventListener('click', () => setSelectCombine(btn.dataset.selectcombine)));
    $('#optBrushDiameter').addEventListener('change', e => { state.settings.brushDiameter = clamp(parseInt(e.target.value,10)||80,10,400); e.target.value = state.settings.brushDiameter; pushHistory('brush diameter'); });
    $('#docTitleInput').addEventListener('input', e => { state.title = e.target.value.slice(0,80) || 'untitled'; document.title = state.title + ' · Graph Editor Pro'; saveSoon(); });
    $('#docTitleInput').addEventListener('change', () => pushHistory('title'));
    // Edit-tab node placement — primary values for newly added nodes
    $('#nodeShape').addEventListener('change', e => { state.settings.nodeShape = e.target.value; pushHistory('node shape'); queueRender(false); });
    $('#nodeColor').addEventListener('input', e => { state.settings.nodeColor = e.target.value; queueRender(false); saveSoon(); });
    $('#nodeColor').addEventListener('change', () => pushHistory('node color'));
    $('#nodeWidth').addEventListener('change', e => { state.settings.nodeWidth = clamp(finite(e.target.value,50),10,300); e.target.value = state.settings.nodeWidth; pushHistory('node width'); queueRender(false); });
    $('#nodeHeight').addEventListener('change', e => { state.settings.nodeHeight = clamp(finite(e.target.value,50),10,300); e.target.value = state.settings.nodeHeight; pushHistory('node height'); queueRender(false); });
    $('#nodeStrokeColor').addEventListener('input', e => { state.settings.nodeStrokeColor = e.target.value; queueRender(false); saveSoon(); });
    $('#nodeStrokeColor').addEventListener('change', () => pushHistory('node stroke color'));
    $('#nodeStrokeSize').addEventListener('change', e => { state.settings.nodeStrokeSize = clamp(finite(e.target.value,2.2),0,20); e.target.value = state.settings.nodeStrokeSize; pushHistory('node stroke size'); queueRender(false); });
    $('#nodeStrokeStyle').addEventListener('change', e => { state.settings.nodeStrokeStyle = e.target.value; pushHistory('node stroke style'); queueRender(false); });
    $('#nodeType').addEventListener('change', e => { state.settings.nodeType = e.target.value.slice(0,40); pushHistory('node type'); saveSoon(); });
    $('#nodeLabelColor').addEventListener('input', e => { state.settings.nodeLabelColor = e.target.value; queueRender(false); saveSoon(); });
    $('#nodeLabelColor').addEventListener('change', () => pushHistory('node label color'));
    $('#nodeLabelFont').addEventListener('change', e => { state.settings.nodeLabelFont = e.target.value.slice(0,60); pushHistory('node label font'); queueRender(false); });
    $('#nodeLabelSize').addEventListener('change', e => { state.settings.nodeLabelSize = clamp(finite(e.target.value,13),4,72); e.target.value = state.settings.nodeLabelSize; pushHistory('node label size'); queueRender(false); });
    $('#nodeLabelPos').addEventListener('change', e => { state.settings.nodeLabelPosition = e.target.value; pushHistory('node label position'); queueRender(false); });
    // Edit-tab edge defaults — primary values for newly added edges
    $('#edgeWeight').addEventListener('input', e => { state.settings.edgeWeight = e.target.value; saveSoon(); });
    $('#edgeLabel').addEventListener('input', e => { state.settings.edgeLabel = e.target.value; saveSoon(); });
    $('#edgeType').addEventListener('change', e => { state.settings.edgeType = e.target.value.slice(0,40); pushHistory('edge type'); saveSoon(); });
    $('#edgeColor').addEventListener('input', e => { state.settings.edgeColor = e.target.value; queueRender(false); saveSoon(); });
    $('#edgeColor').addEventListener('change', () => pushHistory('edge color'));
    $('#edgeStrokeSize').addEventListener('change', e => { state.settings.edgeStrokeSize = clamp(finite(e.target.value,2.4),0,20); e.target.value = state.settings.edgeStrokeSize; pushHistory('edge stroke size'); queueRender(false); });
    $('#edgeStrokeStyle').addEventListener('change', e => { state.settings.edgeStrokeStyle = e.target.value; pushHistory('edge stroke style'); queueRender(false); });
    $('#edgeLabelColor').addEventListener('input', e => { state.settings.edgeLabelColor = e.target.value; queueRender(false); saveSoon(); });
    $('#edgeLabelColor').addEventListener('change', () => pushHistory('edge label color'));
    $('#edgeLabelFont').addEventListener('change', e => { state.settings.edgeLabelFont = e.target.value.slice(0,60); pushHistory('edge label font'); queueRender(false); });
    $('#edgeLabelSize').addEventListener('change', e => { state.settings.edgeLabelSize = clamp(finite(e.target.value,12),4,72); e.target.value = state.settings.edgeLabelSize; pushHistory('edge label size'); queueRender(false); });
    $('#edgeDirected').addEventListener('change', e => { state.settings.directed = e.target.checked; saveSoon(); });
    $('#optAutosave').addEventListener('change', e => { state.settings.autosave = e.target.checked; if(e.target.checked) saveSoon(); pushHistory('autosave'); });
    $('#optInheritDefaults').addEventListener('change', e => { state.settings.inheritDefaults = e.target.checked; pushHistory('inherit defaults'); });
    $('#optNoLabel').addEventListener('change', e => { state.settings.noLabel = e.target.checked; pushHistory('no label'); });
    $('#optSnap').addEventListener('change', e => { state.settings.snap = e.target.checked; pushHistory('snap grid'); });
    $('#optSnapX').addEventListener('change', e => { state.settings.snapX = e.target.checked; pushHistory('snap x'); });
    $('#optSnapY').addEventListener('change', e => { state.settings.snapY = e.target.checked; pushHistory('snap y'); });
    $('#optGridX').addEventListener('change', e => { state.settings.gridSizeX = clamp(parseInt(e.target.value,10)||40,5,300); state.settings.gridSize = state.settings.gridSizeX; e.target.value=state.settings.gridSizeX; pushHistory('grid width'); updateGridBackground(); });
    $('#optGridY').addEventListener('change', e => { state.settings.gridSizeY = clamp(parseInt(e.target.value,10)||40,5,300); e.target.value=state.settings.gridSizeY; pushHistory('grid height'); updateGridBackground(); });
    $('#optMatrixLimit').addEventListener('change', e => { state.settings.matrixLimit = positiveInteger(e.target.value,90); e.target.value=state.settings.matrixLimit; pushHistory('matrix limit'); queueRender(true); });
    $('#optEdgeListPageSize').addEventListener('change', e => { state.settings.edgeListPageSize = positiveInteger(e.target.value,250); e.target.value=state.settings.edgeListPageSize; edgeListRenderLimit=state.settings.edgeListPageSize; pushHistory('edge list page size'); queueRender(true); });
    $('#btnUndo').addEventListener('click', undo); $('#btnRedo').addEventListener('click', redo);
    $('#btnDelete').addEventListener('click', deleteSelected);
    // Presets overlay
    $('#btnPresets').addEventListener('click', togglePresetsOverlay);
    $('#btnPresetClose').addEventListener('click', togglePresetsOverlay);
    $('#btnPresetSave').addEventListener('click', savePresetFromSelection);
    $('#presetsGrid').addEventListener('click', ev => {
      const del = ev.target.closest('[data-preset-del]');
      if(del){ ev.stopPropagation(); deletePreset(parseInt(del.dataset.presetDel, 10)); return; }
      const card = ev.target.closest('[data-preset-idx]');
      if(card){ applyPresetToSelection(parseInt(card.dataset.presetIdx, 10)); }
    });
    $('#btnClear').addEventListener('click', () => { if(!state.nodes.length && !state.edges.length) return; if(confirm(I18N.t('clear_entire'))){ state.nodes=[]; state.edges=[]; state.selected=null; state.selection={nodes: [], edges: []}; state.nextNode=1; state.nextEdge=1; pushHistory('clear'); queueRender(true, true); } });
    $('#btnSample').addEventListener('click', addSample);
    $('#btnLang').addEventListener('click', () => { I18N.toggle(); toast(I18N.t('language_switched')); });
    $('#btnZoomIn').addEventListener('click', () => { const r=svg.getBoundingClientRect(); zoomAt(.82, r.left+r.width/2, r.top+r.height/2); });
    $('#btnZoomOut').addEventListener('click', () => { const r=svg.getBoundingClientRect(); zoomAt(1.22, r.left+r.width/2, r.top+r.height/2); });
    $('#btnZoomReset').addEventListener('click', fitView); $('#btnFit').addEventListener('click', fitView);
    $('#btnMatrixResize').addEventListener('click', () => setMatrixDimension($('#matrixSize').value));
    $('#matrixSize').addEventListener('keydown', ev => { if(ev.key === 'Enter') setMatrixDimension(ev.target.value); });
    $('#btnMatrixAddNode').addEventListener('click', addNodeFromMatrix);
    $('#btnMatrixInsertNode').addEventListener('click', insertNodeFromMatrix);
    $('#btnMatrixClear').addEventListener('click', clearMatrixEdges);
    $('#btnSortNodeId').addEventListener('click', sortNodesById);
    $('#btnSortNodeLabel').addEventListener('click', sortNodesByLabel);
    $('#btnSortNodeOrder').addEventListener('click', renumberNodeOrder);
    $('#btnSortEdgeId').addEventListener('click', sortEdgesById);
    $('#btnSortEdgeFrom').addEventListener('click', sortEdgesByFrom);
    $('#btnSortEdgeTo').addEventListener('click', sortEdgesByTo);
    // Visible range controls
    function applyVisibleRange(){
      const sVal = $('#visRangeStart').value;
      const eVal = $('#visRangeEnd').value;
      state.settings.visibleRange = {
        start: sVal === '' ? -1 : clamp(parseInt(sVal,10)||0, 0, 2147483647),
        end: eVal === '' ? -1 : clamp(parseInt(eVal,10)||0, 0, 2147483647)
      };
      pushHistory('visible range'); queueRender(true); saveSoon();
      const vrNote = $('#visRangeNote');
      if(vrNote){
        const total = state.nodes.length;
        const visCount = visibleNodes().length;
        vrNote.textContent = `(${visCount}/${total} ` + (I18N.current === 'ru' ? 'видимо)' : 'visible)');
      }
    }
    $('#btnVisRangeApply').addEventListener('click', applyVisibleRange);
    $('#btnVisRangeAll').addEventListener('click', () => {
      state.settings.visibleRange = {start:-1, end:-1};
      $('#visRangeStart').value = ''; $('#visRangeEnd').value = '';
      const vrNote = $('#visRangeNote'); if(vrNote) vrNote.textContent = '';
      pushHistory('clear visible range'); queueRender(true); saveSoon();
    });
    // Enter key in range inputs applies the range
    ['visRangeStart','visRangeEnd'].forEach(id => {
      const el = $('#'+id); if(el){ el.addEventListener('keydown', ev => { if(ev.key === 'Enter'){ ev.preventDefault(); applyVisibleRange(); } }); }
    });
    // Edge list editing events (delegated)
    const edgeListHost = $('#edgeListHost');
    if(edgeListHost){
      edgeListHost.addEventListener('click', ev => {
        const t = ev.target;
        if(t.matches('#btnEdgeListMore')){ showMoreEdgeRows(); return; }
        if(t.matches('.edge-up')){ moveEdge(t.dataset.edgeId, -1); return; }
        if(t.matches('.edge-down')){ moveEdge(t.dataset.edgeId, 1); return; }
      });
      edgeListHost.addEventListener('pointerdown', ev => {
        const t = ev.target;
        if(t.matches('.edge-id, .edge-from, .edge-to, .edge-weight, .edge-elabel, .edge-type')){
          const id = t.dataset.edgeId;
          // Select the edge if not already selected — delayed so the input can focus first
          if(!isEdgeSelected(id)){ setTimeout(() => { if(!isEdgeSelected(id)) selectItem('edge', id); }, 0); }
        }
      });
      edgeListHost.addEventListener('change', ev => {
        const t = ev.target;
        if(!t.dataset || !t.dataset.edgeId) return;
        const e = edgeById(t.dataset.edgeId); if(!e) return;
        // Use queueRender(false) — canvas only — so the edge list inputs aren't rebuilt
        // (rebuilding would destroy the next input the user taps on mobile)
        if(t.matches('.edge-weight')){ const v = t.value.slice(0,50); if(v === '') delete e.weight; else e.weight = v; pushHistory('edit edge weight'); queueRender(false); saveSoon(); }
        else if(t.matches('.edge-elabel')){ e.label = t.value.slice(0,80); pushHistory('edit edge label'); queueRender(false); saveSoon(); }
        else if(t.matches('.edge-type')){ e.type = t.value.slice(0,40); applyTypeStyleToEdge(e); pushHistory('edit edge type'); queueRender(false); saveSoon(); }
        else if(t.matches('.edge-directed')){ e.directed = t.checked; pushHistory('edit edge directed'); queueRender(false); saveSoon(); }
        else if(t.matches('.edge-color')){ e.color = t.value; pushHistory('edit edge color'); queueRender(false); saveSoon(); }
        else if(t.matches('.edge-stroke-style')){ e.strokeStyle = t.value || undefined; pushHistory('edit edge stroke style'); queueRender(false); saveSoon(); }
        else if(t.matches('.edge-id')){
          const newId = safeId(t.value, 'e');
          if(newId !== e.id && !state.edges.some(x => x.id === newId)){
            e.id = newId; pushHistory('edit edge id'); queueRender(false); saveSoon();
          } else { t.value = e.id; }
        }
        else if(t.matches('.edge-from') || t.matches('.edge-to')){
          const label = t.value.trim();
          const target = state.nodes.find(n => n.label === label || n.id === label);
          if(target){
            if(t.matches('.edge-from')) e.from = target.id; else e.to = target.id;
            pushHistory('edit edge endpoint'); queueRender(false); saveSoon();
          }
        }
      });
      edgeListHost.addEventListener('input', ev => {
        const t = ev.target;
        if(!t.dataset || !t.dataset.edgeId) return;
        const e = edgeById(t.dataset.edgeId); if(!e) return;
        if(t.matches('.edge-color')){ e.color = t.value; queueRender(false); saveSoon(); }
      });
    }
    $('#matrixHost').addEventListener('pointerdown', ev => {
      const t = ev.target;
      if(t.matches('[data-node-label]')){
        const id = t.dataset.nodeLabel;
        const isEditing = matrixEditCell?.type === 'label' && matrixEditCell?.id === id;
        lockAllMatrixInputs();
        if(isEditing){
          // Second click on same label — allow editing
          unlockMatrixInput(t);
          matrixEditCell = {type:'label', id};
          // Don't preventDefault — let it focus
        } else {
          // First click — select only, block keyboard
          ev.preventDefault();
          selectMatrixNode(id, ev.shiftKey);
          matrixEditCell = {type:'label', id};
        }
        return;
      }
      if(t.matches('[data-cell-from][data-cell-to]')){
        const from = t.dataset.cellFrom, to = t.dataset.cellTo;
        const isEditing = matrixEditCell?.type === 'cell' && matrixEditCell?.from === from && matrixEditCell?.to === to;
        lockAllMatrixInputs();
        if(isEditing){
          unlockMatrixInput(t);
          matrixEditCell = {type:'cell', from, to};
        } else {
          ev.preventDefault();
          selectMatrixCell(from, to, ev.shiftKey);
          matrixEditCell = {type:'cell', from, to};
        }
        return;
      }
    });
    $('#matrixHost').addEventListener('change', ev => {
      const t = ev.target;
      if(t.matches('[data-node-label]')) setNodeLabelFromMatrix(t.dataset.nodeLabel, t.value);
      if(t.matches('[data-cell-from][data-cell-to]')) setMatrixCell(t.dataset.cellFrom, t.dataset.cellTo, t.value);
      // Re-lock after edit commit
      t.readOnly = true;
      matrixEditCell = null;
    });
    $('#matrixHost').addEventListener('focusout', ev => {
      const t = ev.target;
      if(t.matches && t.matches('input')){ t.readOnly = true; }
    });
    function chooseImport(format, accept){ const input = $('#fileImport'); input.dataset.format = format; input.accept = accept; input.click(); }
    $('#btnExportJson').addEventListener('click', exportJson);
    $('#btnImportJson').addEventListener('click', () => chooseImport('json', 'application/json,.json'));
    $('#btnExportDot').addEventListener('click', exportDot);
    $('#btnImportDot').addEventListener('click', () => chooseImport('dot', '.dot,.gv,text/vnd.graphviz,text/plain'));
    $('#btnExportGraphml').addEventListener('click', exportGraphml);
    $('#btnImportGraphml').addEventListener('click', () => chooseImport('graphml', '.graphml,.xml,application/graphml+xml,application/xml,text/xml'));
    $('#fileImport').addEventListener('change', e => { importFile(e.target.files[0], e.target.dataset.format || 'auto'); e.target.value=''; e.target.dataset.format='auto'; });
    $('#btnExportEdgesCsv').addEventListener('click', () => { showExportPreview(`${fileBase()}-edges.csv`, edgeCsv(), 'text/csv;charset=utf-8'); });
    $('#btnExportMatrixCsv').addEventListener('click', () => { showExportPreview(`${fileBase()}-matrix.csv`, matrixCsv(), 'text/csv;charset=utf-8'); });
    $('#btnExportNodesCsv').addEventListener('click', () => { showExportPreview(`${fileBase()}-nodes.csv`, nodeCsv(), 'text/csv;charset=utf-8'); });
    $('#btnCopyEdgeCsv').addEventListener('click', copyEdgeCsv);
    $('#btnCopyMatrixCsv').addEventListener('click', copyMatrixCsv);
    $('#btnCopyNodesCsv').addEventListener('click', copyNodesCsv);
    $('#btnCopyJson').addEventListener('click', copyJson);
    $('#btnCopyDot').addEventListener('click', copyDot);
    $('#btnCopyGraphml').addEventListener('click', copyGraphml);
    // Paste from clipboard
    $('#btnPasteJson').addEventListener('click', () => pasteFromClipboard('json'));
    $('#btnPasteDot').addEventListener('click', () => pasteFromClipboard('dot'));
    $('#btnPasteGraphml').addEventListener('click', () => pasteFromClipboard('graphml'));
    $('#btnPasteEdgesCsv').addEventListener('click', () => pasteFromClipboard('edges-csv'));
    $('#btnPasteMatrixCsv').addEventListener('click', () => pasteFromClipboard('matrix-csv'));
    $('#btnPasteNodesCsv').addEventListener('click', () => pasteFromClipboard('nodes-csv'));
    $('#btnLayoutCircle').addEventListener('click', layoutCircle); $('#btnLayoutGrid').addEventListener('click', layoutGrid); $('#btnLayoutForce').addEventListener('click', () => layoutForce());
    $('#btnCenterSelection').addEventListener('click', centerOnSelection);
    // Camera position controls
    $('#btnCameraSet').addEventListener('click', setCameraFromInputs);
    $('#btnCameraFit').addEventListener('click', fitView);
    $('#btnCameraReset').addEventListener('click', resetCamera);
    ['cameraX','cameraY','cameraW','cameraH'].forEach(id => {
      const el = $('#'+id);
      if(el){
        el.addEventListener('keydown', ev => { if(ev.key === 'Enter'){ ev.preventDefault(); setCameraFromInputs(); } });
        el.addEventListener('change', setCameraFromInputs);
      }
    });
    // Hotkey configuration
    $('#btnResetHotkeys').addEventListener('click', resetHotkeys);
    $$('.hotkey-input').forEach(input => {
      input.addEventListener('click', () => captureHotkey(input));
      input.addEventListener('focus', () => captureHotkey(input));
    });
    // Style tab — default controls
    const nd = () => state.settings.nodeDefaults, ed = () => state.settings.edgeDefaults, gd = () => state.settings.graphDefaults;
    $('#defLabelsPolicy').addEventListener('change', e => { gd().labelsPolicy = e.target.value; pushHistory('labels policy'); queueRender(false); });
    $('#defEdgeWeightMode').addEventListener('change', e => { gd().edgeWeightMode = e.target.value; pushHistory('edge weight mode'); updateEdgeWeightModeVisibility(); queueRender(false); saveSoon(); });
    $('#defEdgeWeightMin').addEventListener('change', e => { gd().edgeWeightMin = finite(e.target.value, 1); pushHistory('edge weight min'); queueRender(false); saveSoon(); });
    $('#defEdgeWeightMax').addEventListener('change', e => { gd().edgeWeightMax = finite(e.target.value, 10); pushHistory('edge weight max'); queueRender(false); saveSoon(); });
    $('#defEdgeWeightCorr').addEventListener('change', e => { gd().edgeWeightCorr = e.target.value; pushHistory('edge weight corr'); queueRender(false); saveSoon(); });
    $('#defEdgeWidthMin').addEventListener('change', e => { gd().edgeWidthMin = clamp(finite(e.target.value,1),0.1,50); e.target.value = gd().edgeWidthMin; pushHistory('edge width min'); queueRender(false); saveSoon(); });
    $('#defEdgeWidthMax').addEventListener('change', e => { gd().edgeWidthMax = clamp(finite(e.target.value,8),0.1,50); e.target.value = gd().edgeWidthMax; pushHistory('edge width max'); queueRender(false); saveSoon(); });
    $('#defEdgeWeightColorLow').addEventListener('input', e => { gd().edgeWeightColorLow = e.target.value; queueRender(false); saveSoon(); });
    $('#defEdgeWeightColorLow').addEventListener('change', () => pushHistory('edge weight color low'));
    $('#defEdgeWeightColorHigh').addEventListener('input', e => { gd().edgeWeightColorHigh = e.target.value; queueRender(false); saveSoon(); });
    $('#defEdgeWeightColorHigh').addEventListener('change', () => pushHistory('edge weight color high'));
    $('#canvasBgColor').addEventListener('input', e => { state.settings.canvasBgColor = e.target.value; updateGridBackground(); saveSoon(); });
    $('#canvasBgColor').addEventListener('change', () => pushHistory('canvas bg color'));
    $('#gridMinorColor').addEventListener('input', e => { state.settings.gridMinorColor = e.target.value; updateGridBackground(); saveSoon(); });
    $('#gridMinorColor').addEventListener('change', () => pushHistory('grid minor color'));
    $('#gridMinorAlpha').addEventListener('change', e => { state.settings.gridMinorAlpha = clamp(finite(e.target.value,0.105),0,1); e.target.value=state.settings.gridMinorAlpha; pushHistory('grid minor alpha'); updateGridBackground(); saveSoon(); });
    $('#gridMajorColor').addEventListener('input', e => { state.settings.gridMajorColor = e.target.value; updateGridBackground(); saveSoon(); });
    $('#gridMajorColor').addEventListener('change', () => pushHistory('grid major color'));
    $('#gridMajorAlpha').addEventListener('change', e => { state.settings.gridMajorAlpha = clamp(finite(e.target.value,0.16),0,1); e.target.value=state.settings.gridMajorAlpha; pushHistory('grid major alpha'); updateGridBackground(); saveSoon(); });
    $('#defNodeType').addEventListener('change', e => { nd().type = e.target.value.slice(0,40); pushHistory('default node type'); saveSoon(); });
    $('#defNodeShape').addEventListener('change', e => { nd().shape = e.target.value; state.settings.nodeShape = e.target.value; const el=$('#nodeShape'); if(el) el.value = e.target.value; pushHistory('default node shape'); queueRender(false); });
    $('#defNodeColor').addEventListener('input', e => { nd().color = e.target.value; state.settings.nodeColor = e.target.value; const el=$('#nodeColor'); if(el) el.value = e.target.value; queueRender(false); saveSoon(); });
    $('#defNodeColor').addEventListener('change', () => pushHistory('default node color'));
    $('#defNodeStrokeColor').addEventListener('input', e => { nd().strokeColor = e.target.value; queueRender(false); saveSoon(); });
    $('#defNodeStrokeColor').addEventListener('change', () => pushHistory('default stroke color'));
    $('#defNodeWidth').addEventListener('change', e => { nd().width = clamp(finite(e.target.value,50),10,300); e.target.value = nd().width; pushHistory('default node width'); queueRender(false); });
    $('#defNodeHeight').addEventListener('change', e => { nd().height = clamp(finite(e.target.value,50),10,300); e.target.value = nd().height; pushHistory('default node height'); queueRender(false); });
    $('#defNodeStrokeSize').addEventListener('change', e => { nd().strokeSize = clamp(finite(e.target.value,2.2),0,20); e.target.value = nd().strokeSize; pushHistory('default stroke size'); queueRender(false); });
    $('#defNodeStrokeStyle').addEventListener('change', e => { nd().strokeStyle = e.target.value; pushHistory('default stroke style'); queueRender(false); });
    $('#defNodeLabelColor').addEventListener('input', e => { nd().labelColor = e.target.value; queueRender(false); saveSoon(); });
    $('#defNodeLabelColor').addEventListener('change', () => pushHistory('default label color'));
    $('#defNodeLabelFont').addEventListener('change', e => { nd().labelFont = e.target.value; pushHistory('default label font'); queueRender(false); });
    $('#defNodeLabelSize').addEventListener('change', e => { nd().labelSize = clamp(finite(e.target.value,13),4,72); e.target.value = nd().labelSize; pushHistory('default label size'); queueRender(false); });
    $('#defNodeLabelPos').addEventListener('change', e => { nd().labelPosition = e.target.value; pushHistory('default label position'); queueRender(false); });
    $('#defEdgeType').addEventListener('change', e => { ed().type = e.target.value.slice(0,40); pushHistory('default edge type'); saveSoon(); });
    $('#defEdgeColor').addEventListener('input', e => { ed().color = e.target.value; queueRender(false); saveSoon(); });
    $('#defEdgeColor').addEventListener('change', () => pushHistory('default edge color'));
    $('#defEdgeStrokeSize').addEventListener('change', e => { ed().strokeSize = clamp(finite(e.target.value,2.4),0,20); e.target.value = ed().strokeSize; pushHistory('default edge stroke size'); queueRender(false); });
    $('#defEdgeStrokeStyle').addEventListener('change', e => { ed().strokeStyle = e.target.value; pushHistory('default edge stroke style'); queueRender(false); });
    $('#defEdgeLabelColor').addEventListener('input', e => { ed().labelColor = e.target.value; queueRender(false); saveSoon(); });
    $('#defEdgeLabelColor').addEventListener('change', () => pushHistory('default edge label color'));
    $('#defEdgeLabelFont').addEventListener('change', e => { ed().labelFont = e.target.value; pushHistory('default edge label font'); queueRender(false); });
    $('#defEdgeLabelSize').addEventListener('change', e => { ed().labelSize = clamp(finite(e.target.value,12),4,72); e.target.value = ed().labelSize; pushHistory('default edge label size'); queueRender(false); });
    $('#btnApplyNodeDefaults').addEventListener('click', applyNodeDefaultsToAll);
    $('#btnApplyEdgeDefaults').addEventListener('click', applyEdgeDefaultsToAll);
    // Type style controls
    $('#nodeTypeStyleInput').addEventListener('change', e => loadNodeTypeStyleForm(e.target.value));
    $('#edgeTypeStyleInput').addEventListener('change', e => loadEdgeTypeStyleForm(e.target.value));
    $('#btnSaveNodeTypeStyle').addEventListener('click', saveNodeTypeStyle);
    $('#btnSaveEdgeTypeStyle').addEventListener('click', saveEdgeTypeStyle);
    $('#btnDelNodeTypeStyle').addEventListener('click', delNodeTypeStyle);
    $('#btnDelEdgeTypeStyle').addEventListener('click', delEdgeTypeStyle);
    $('#btnClearNodeOverrides').addEventListener('click', clearNodeOverridesForType);
    $('#btnClearEdgeOverrides').addEventListener('click', clearEdgeOverridesForType);
    // View toggle controls
    const mainEl = document.querySelector<HTMLElement>('.main');
    if(mainEl){
      // Default to graph view in landscape; on desktop the data-view attribute is absent so all panels show.
      // Landscape defaults to the horizontal split (canvas left, panels right) —
      // panels get full height on the short wide screen.
      const isLandscape = window.matchMedia('(max-width:950px) and (orientation:landscape)').matches;
      if(isLandscape){ mainEl.dataset.view = 'graph'; mainEl.dataset.orient = 'h'; }
      const syncViewButtons = (view: string) => {
        document.querySelectorAll<HTMLElement>('[data-view-btn]').forEach(b => b.classList.toggle('active', b.dataset.viewBtn === view));
      };
      document.querySelectorAll<HTMLElement>('[data-view-btn]').forEach(btn => {
        btn.addEventListener('click', () => {
          const view = btn.dataset.viewBtn;
          mainEl.dataset.view = view;
          syncViewButtons(view);
          // Trigger a render to resize the canvas to its new container
          setTimeout(() => queueRender(true), 0);
        });
      });
      const orientBtn = $('#btnViewOrient');
      let syncOrientBtn: (() => void) | null = null;
      if(orientBtn){
        syncOrientBtn = () => {
          orientBtn.textContent = mainEl.dataset.orient === 'h' ? '↕' : '↔';
          orientBtn.classList.toggle('active', mainEl.dataset.orient === 'h');
          orientBtn.title = I18N.t(mainEl.dataset.orient === 'h' ? 'orient_to_v' : 'orient_to_h');
        };
        orientBtn.addEventListener('click', () => {
          const cur = mainEl.dataset.orient || 'v';
          mainEl.dataset.orient = cur === 'v' ? 'h' : 'v';
          if(syncOrientBtn) syncOrientBtn();
          setTimeout(() => queueRender(true), 0);
        });
        if(mainEl.dataset.orient) syncOrientBtn();
      }
      // Update view when orientation changes (e.g. rotating device)
      window.matchMedia('(max-width:950px) and (orientation:landscape)').addEventListener('change', e => {
        if(e.matches){
          if(!mainEl.dataset.view) mainEl.dataset.view = 'graph';
          if(!mainEl.dataset.orient) mainEl.dataset.orient = 'h';
          if(syncOrientBtn) syncOrientBtn();
        } else {
          // Leaving landscape — clear view attributes so desktop layout applies
          delete mainEl.dataset.view;
          delete mainEl.dataset.orient;
          syncViewButtons('graph');
          if(syncOrientBtn) syncOrientBtn();
        }
        setTimeout(() => queueRender(true), 50);
      });
    }
    $('#btnBfs').addEventListener('click', runBfs); $('#btnDfs').addEventListener('click', runDfs); $('#btnDijkstra').addEventListener('click', runDijkstra); $('#btnComponents').addEventListener('click', runComponents); $('#btnTopo').addEventListener('click', runTopo); $('#btnStats').addEventListener('click', runStats);
    $('#btnCopyResults').addEventListener('click', () => copyText($('#algoOutput').textContent));
    window.addEventListener('keydown', ev => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
      const ctrl = ev.ctrlKey || ev.metaKey;
      // Undo/Redo work even when typing in inputs (Ctrl+Z is universal)
      if(ctrl && matchesHotkey(ev, 'undo')){ ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
      if(ctrl && matchesHotkey(ev, 'redo')){ ev.preventDefault(); redo(); return; }
      if(typing) return;
      if(matchesHotkey(ev, 'escape')){ ev.preventDefault(); if(selectDraft?.tool === 'polygon') finishPolygonSelection(true); else if(selectDraft) finishSelectionDraft(true); pendingEdgeFrom=null; pendingNodeTap=null; edgeDraft=null; dragLine.style.display='none'; setStatusOnly(); return; }
      if(matchesHotkey(ev, 'delete')){ ev.preventDefault(); deleteSelected(); return; }
      if(matchesHotkey(ev, 'pan')){ spaceDown = true; setStatusOnly(); return; }
      if(matchesHotkey(ev, 'select')){ ev.preventDefault(); setMode('select'); return; }
      if(matchesHotkey(ev, 'move')){ ev.preventDefault(); setMode('move'); return; }
      if(matchesHotkey(ev, 'node')){ ev.preventDefault(); setMode('node'); return; }
      if(matchesHotkey(ev, 'edge')){ ev.preventDefault(); setMode('edge'); return; }
    });
    window.addEventListener('keyup', ev => { if(matchesHotkey(ev, 'pan')){ spaceDown = false; setStatusOnly(); } });
    window.addEventListener('resize', () => queueRender(false));
    // Перерисовать матрицу и канвас при смене языка
    window.addEventListener('i18n-change', () => {
      // Обновить state.title если он дефолтный
      if(state.title === 'untitled' || state.title === 'безымянный') state.title = I18N.t('doc_title');
      document.title = state.title + ' · ' + I18N.t('brand_name');
      queueRender(true, true);
      syncControls();
    });
    // Global reset: clear drag/pan/pinch states on blur or Escape to prevent "zombie drag"
    // (pointerup may be missed if a system alert steals focus or the window loses focus mid-drag)
    function resetInteractionState(){
      let changed = false, navigationChanged = false;
      if(drag){
        if(drag.fastNodeId) moveNodeFast(drag.fastNodeId);
        if(drag.moved) pushHistory('move node');
        drag = null; changed = true;
      }
      if(pan){ state.viewBox = {...pan.previewViewBox}; pan = null; changed = true; navigationChanged = true; }
      if(pinch){ state.viewBox = {...pinch.previewViewBox}; pinch = null; changed = true; navigationChanged = true; }
      if(edgeDraft){ edgeDraft = null; dragLine.style.display = 'none'; dragLine.setAttribute('d',''); changed = true; }
      if(pendingEdgeFrom){ pendingEdgeFrom = null; changed = true; }
      if(pendingNodeTap){ pendingNodeTap = null; changed = true; }
      if(selectDraft){ finishSelectionDraft(true); changed = true; }
      if(navigationChanged){ clearFastPanTransform(); applyViewBox(); saveSoon(); }
      if(changed){ syncSelectionDom(); setStatusOnly(); $('#canvasWrap').classList.remove('panning'); activePointers.clear(); }
    }
    window.addEventListener('blur', resetInteractionState);
    window.addEventListener('visibilitychange', () => { if(document.hidden) resetInteractionState(); });
    window.addEventListener('keyup', ev => { if(ev.key === 'Escape') resetInteractionState(); });
    // Clear pointer capture on pointercancel (fires when the OS cancels a pointer sequence)
    svg.addEventListener('pointercancel', () => resetInteractionState());
  }
