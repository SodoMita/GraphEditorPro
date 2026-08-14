  function renderSidebar(){
    renderStartSelect();
    renderSelectionPanel();
  }
  function renderStartSelect(){
    const sel = $('#algoStart');
    const current = sel.value || state.selected?.id;
    sel.innerHTML = state.nodes.length ? state.nodes.map(n => `<option value="${esc(n.id)}">${esc(n.label || n.id)} (${esc(n.id)})</option>`).join('') : '<option value="">' + I18N.t('no_nodes') + '</option>';
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
