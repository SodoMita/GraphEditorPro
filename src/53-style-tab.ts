  // === Style tab: populate + sync default controls ===
  function populateStyleSelects(){
    const shapeSel = $('#defNodeShape');
    if(shapeSel && !shapeSel.options.length){
      shapeSel.innerHTML = NODE_SHAPES.map(s => `<option value="${s}">${{circle:'Circle',square:'Square',diamond:'Diamond',triangleUp:'Triangle Up',triangleDown:'Triangle Down',hexagon:'Hexagon'}[s]}</option>`).join('');
    }
    const fontList = $('#fontList');
    if(fontList && !fontList.options.length){
      fontList.innerHTML = FONT_FAMILIES.map(f => `<option value="${f}">`).join('');
    }
  }
  function updateEdgeWeightModeVisibility(){
    const mode = state.settings.graphDefaults?.edgeWeightMode || 'number';
    const rangeSec = $('#edgeWeightRangeSection');
    const corrSec = $('#defEdgeWeightCorr')?.closest('.field');
    const widthSec = $('#edgeWidthSection');
    const colorSec = $('#edgeColorSection');
    const showRange = mode === 'color' || mode === 'width';
    if(rangeSec) rangeSec.style.display = showRange ? '' : 'none';
    if(corrSec) corrSec.style.display = showRange ? '' : 'none';
    if(widthSec) widthSec.style.display = mode === 'width' ? '' : 'none';
    if(colorSec) colorSec.style.display = mode === 'color' ? '' : 'none';
  }
  function syncStyleControls(){
    populateStyleSelects();
    const nd = state.settings.nodeDefaults, ed = state.settings.edgeDefaults, gd = state.settings.graphDefaults;
    const set = (id, val) => { const el = $('#'+id); if(el) el.value = val ?? ''; };
    set('defLabelsPolicy', gd.labelsPolicy);
    set('defEdgeWeightMode', gd.edgeWeightMode || 'number');
    set('defEdgeWeightMin', gd.edgeWeightMin ?? 1);
    set('defEdgeWeightMax', gd.edgeWeightMax ?? 10);
    set('defEdgeWeightCorr', gd.edgeWeightCorr || 'linear');
    set('defEdgeWidthMin', gd.edgeWidthMin ?? 1);
    set('defEdgeWidthMax', gd.edgeWidthMax ?? 8);
    set('defEdgeWeightColorLow', gd.edgeWeightColorLow || '#22d3ee');
    set('defEdgeWeightColorHigh', gd.edgeWeightColorHigh || '#f59e0b');
    updateEdgeWeightModeVisibility();
    set('canvasBgColor', state.settings.canvasBgColor);
    set('gridMinorColor', state.settings.gridMinorColor);
    set('gridMinorAlpha', state.settings.gridMinorAlpha);
    set('gridMajorColor', state.settings.gridMajorColor);
    set('gridMajorAlpha', state.settings.gridMajorAlpha);
    // Visible range inputs
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    set('visRangeStart', vr.start >= 0 ? vr.start : '');
    set('visRangeEnd', vr.end >= 0 ? vr.end : '');
    const vrNote = $('#visRangeNote');
    if(vrNote){
      const total = state.nodes.length;
      const visCount = vr.start >= 0 || vr.end >= 0 ? visibleNodes().length : total;
      vrNote.textContent = vr.start >= 0 || vr.end >= 0 ? `(${visCount}/${total} ` + (I18N.current === 'ru' ? 'видимо)' : 'visible)') : '';
    }
    set('defNodeType', nd.type);
    set('defNodeShape', nd.shape);
    set('defNodeColor', nd.color);
    set('defNodeStrokeColor', nd.strokeColor);
    set('defNodeWidth', nd.width);
    set('defNodeHeight', nd.height);
    set('defNodeStrokeSize', nd.strokeSize);
    set('defNodeStrokeStyle', nd.strokeStyle);
    set('defNodeLabelColor', nd.labelColor);
    set('defNodeLabelFont', nd.labelFont);
    set('defNodeLabelSize', nd.labelSize);
    set('defNodeLabelPos', nd.labelPosition);
    set('defEdgeType', ed.type);
    set('defEdgeColor', ed.color);
    set('defEdgeStrokeSize', ed.strokeSize);
    set('defEdgeStrokeStyle', ed.strokeStyle);
    set('defEdgeLabelColor', ed.labelColor);
    set('defEdgeLabelFont', ed.labelFont);
    set('defEdgeLabelSize', ed.labelSize);
    // Update type datalists with existing types
    const nodeTypeList = $('#defNodeTypeList');
    const edgeTypeList = $('#defEdgeTypeList');
    if(nodeTypeList) nodeTypeList.innerHTML = existingNodeTypes().map(t => `<option value="${esc(t)}">`).join('');
    if(edgeTypeList) edgeTypeList.innerHTML = existingEdgeTypes().map(t => `<option value="${esc(t)}">`).join('');
    // Update type style dropdowns
    populateTypeStyleSelects();
  }
  function applyNodeDefaultsToAll(){
    for(const n of state.nodes){
      delete n.width; delete n.height; delete n.strokeColor; delete n.strokeSize; delete n.strokeStyle;
      delete n.labelColor; delete n.labelSize; delete n.labelPosition; delete n.labelFont;
      n.shape = state.settings.nodeDefaults.shape as NodeShape;
      n.color = state.settings.nodeDefaults.color as string;
    }
    pushHistory('apply node defaults'); queueRender(true); toast(I18N.t('node_defaults_applied'));
  }
  function applyEdgeDefaultsToAll(){
    for(const e of state.edges){
      delete e.color; delete e.strokeSize; delete e.strokeStyle;
      delete e.labelColor; delete e.labelSize; delete e.labelFont;
    }
    pushHistory('apply edge defaults'); queueRender(true); toast(I18N.t('edge_defaults_applied'));
  }

  // === Type style management ===
  function populateTypeStyleSelects(){
    const nList = $('#nodeTypeStyleList');
    const eList = $('#edgeTypeStyleList');
    const nodeTypes = [...new Set([...existingNodeTypes(), ...Object.keys(state.settings.nodeTypeStyles || {})])].sort();
    const edgeTypes = [...new Set([...existingEdgeTypes(), ...Object.keys(state.settings.edgeTypeStyles || {})])].sort();
    if(nList) nList.innerHTML = nodeTypes.map(t => `<option value="${esc(t)}">`).join('');
    if(eList) eList.innerHTML = edgeTypes.map(t => `<option value="${esc(t)}">`).join('');
  }
  function loadNodeTypeStyleForm(type){
    const ts = (type && state.settings.nodeTypeStyles && state.settings.nodeTypeStyles[type]) || {};
    $('#ntsColor').value = ts.color || '#0ea5e9';
    $('#ntsShape').value = ts.shape || '';
    $('#ntsWidth').value = ts.width != null ? ts.width : 50;
    $('#ntsHeight').value = ts.height != null ? ts.height : 50;
    $('#ntsStrokeColor').value = ts.strokeColor || '#e2e8f0';
    $('#ntsStrokeSize').value = ts.strokeSize != null ? ts.strokeSize : 2.2;
    $('#ntsStrokeStyle').value = ts.strokeStyle || '';
    $('#ntsLabelColor').value = ts.labelColor || '#f8fafc';
    $('#ntsLabelSize').value = ts.labelSize != null ? ts.labelSize : 13;
    $('#ntsLabelPos').value = ts.labelPosition || '';
    $('#ntsLabelFont').value = ts.labelFont || '';
  }
  function loadEdgeTypeStyleForm(type){
    const ts = (type && state.settings.edgeTypeStyles && state.settings.edgeTypeStyles[type]) || {};
    $('#etsColor').value = ts.color || '#94a3b8';
    $('#etsStrokeSize').value = ts.strokeSize != null ? ts.strokeSize : 2.4;
    $('#etsStrokeStyle').value = ts.strokeStyle || '';
    $('#etsLabelColor').value = ts.labelColor || '#dbeafe';
    $('#etsLabelSize').value = ts.labelSize != null ? ts.labelSize : 12;
    $('#etsLabelFont').value = ts.labelFont || '';
  }
  function saveNodeTypeStyle(){
    const type = $('#nodeTypeStyleInput').value.trim();
    if(!type){ toast(I18N.t('enter_type_first')); return; }
    if(!state.settings.nodeTypeStyles) state.settings.nodeTypeStyles = {};
    const o: Record<string, any> = {
      color: $('#ntsColor').value,
      width: clamp(finite($('#ntsWidth').value, 50), 10, 300),
      height: clamp(finite($('#ntsHeight').value, 50), 10, 300),
      strokeColor: $('#ntsStrokeColor').value,
      strokeSize: clamp(finite($('#ntsStrokeSize').value, 2.2), 0, 20),
      labelColor: $('#ntsLabelColor').value,
      labelSize: clamp(finite($('#ntsLabelSize').value, 13), 4, 72)
    };
    if($('#ntsShape').value) o.shape = $('#ntsShape').value;
    if($('#ntsStrokeStyle').value) o.strokeStyle = $('#ntsStrokeStyle').value;
    if($('#ntsLabelPos').value) o.labelPosition = $('#ntsLabelPos').value;
    if($('#ntsLabelFont').value.trim()) o.labelFont = $('#ntsLabelFont').value.trim().slice(0, 60);
    state.settings.nodeTypeStyles[type] = o;
    // Apply type style to all existing nodes of this type (clears blocking overrides)
    for(const n of state.nodes){ if(n.type === type) applyTypeStyleToNode(n); }
    pushHistory('save node type style'); queueRender(true); saveSoon(); populateTypeStyleSelects();
    toast(I18N.t('saved_style_type', {type: type}));
  }
  function saveEdgeTypeStyle(){
    const type = $('#edgeTypeStyleInput').value.trim();
    if(!type){ toast(I18N.t('enter_type_first')); return; }
    if(!state.settings.edgeTypeStyles) state.settings.edgeTypeStyles = {};
    const o: Record<string, any> = {
      color: $('#etsColor').value,
      strokeSize: clamp(finite($('#etsStrokeSize').value, 2.4), 0, 20),
      labelColor: $('#etsLabelColor').value,
      labelSize: clamp(finite($('#etsLabelSize').value, 12), 4, 72)
    };
    if($('#etsStrokeStyle').value) o.strokeStyle = $('#etsStrokeStyle').value;
    if($('#etsLabelFont').value.trim()) o.labelFont = $('#etsLabelFont').value.trim().slice(0, 60);
    state.settings.edgeTypeStyles[type] = o;
    // Apply type style to all existing edges of this type (clears blocking overrides)
    for(const e of state.edges){ if(e.type === type) applyTypeStyleToEdge(e); }
    pushHistory('save edge type style'); queueRender(true); saveSoon(); populateTypeStyleSelects();
    toast(I18N.t('saved_style_type', {type: type}));
  }
  function delNodeTypeStyle(){
    const type = $('#nodeTypeStyleInput').value.trim();
    if(!type){ toast(I18N.t('enter_type_first')); return; }
    if(state.settings.nodeTypeStyles && state.settings.nodeTypeStyles[type]){
      delete state.settings.nodeTypeStyles[type];
      pushHistory('delete node type style'); queueRender(true); saveSoon(); populateTypeStyleSelects(); loadNodeTypeStyleForm('');
      toast(I18N.t('deleted_style_type', {type: type}));
    }
  }
  function delEdgeTypeStyle(){
    const type = $('#edgeTypeStyleInput').value.trim();
    if(!type){ toast(I18N.t('enter_type_first')); return; }
    if(state.settings.edgeTypeStyles && state.settings.edgeTypeStyles[type]){
      delete state.settings.edgeTypeStyles[type];
      pushHistory('delete edge type style'); queueRender(true); saveSoon(); populateTypeStyleSelects(); loadEdgeTypeStyleForm('');
      toast(I18N.t('deleted_style_type', {type: type}));
    }
  }
  function clearNodeOverridesForType(){
    const type = $('#nodeTypeStyleInput').value.trim();
    if(!type){ toast(I18N.t('enter_type_first')); return; }
    let count = 0;
    for(const n of state.nodes){
      if(n.type === type){
        delete n.shape; delete n.color; delete n.width; delete n.height;
        delete n.strokeColor; delete n.strokeSize; delete n.strokeStyle;
        delete n.labelColor; delete n.labelSize; delete n.labelPosition; delete n.labelFont;
        n.shape = ''; n.color = '';
        count++;
      }
    }
    pushHistory('clear per-node overrides'); queueRender(true); saveSoon();
    toast(count > 0 ? I18N.t('cleared_overrides_n', {n: count}) : I18N.t('no_nodes_type'));
  }
  function clearEdgeOverridesForType(){
    const type = $('#edgeTypeStyleInput').value.trim();
    if(!type){ toast(I18N.t('enter_type_first')); return; }
    let count = 0;
    for(const e of state.edges){
      if(e.type === type){
        delete e.color; delete e.strokeSize; delete e.strokeStyle;
        delete e.labelColor; delete e.labelSize; delete e.labelFont;
        e.color = '';
        count++;
      }
    }
    pushHistory('clear per-edge overrides'); queueRender(true); saveSoon();
    toast(count > 0 ? I18N.t('cleared_overrides_e', {n: count}) : I18N.t('no_edges_type'));
  }

  // Clear per-item overrides for properties that the node's type style defines,
  // so the type style takes effect immediately.
  function applyTypeStyleToNode(n){
    if(!n.type) return;
    const ts = state.settings.nodeTypeStyles && state.settings.nodeTypeStyles[n.type];
    if(!ts) return;
    if(ts.shape){ n.shape = ''; }
    if(ts.color){ n.color = ''; }
    if(ts.width != null) delete n.width;
    if(ts.height != null) delete n.height;
    if(ts.strokeColor){ n.strokeColor = ''; }
    if(ts.strokeSize != null) delete n.strokeSize;
    if(ts.strokeStyle){ n.strokeStyle = ''; }
    if(ts.labelColor){ n.labelColor = ''; }
    if(ts.labelSize != null) delete n.labelSize;
    if(ts.labelPosition){ n.labelPosition = ''; }
    if(ts.labelFont) delete n.labelFont;
  }
  function applyTypeStyleToEdge(e){
    if(!e.type) return;
    const ts = state.settings.edgeTypeStyles && state.settings.edgeTypeStyles[e.type];
    if(!ts) return;
    if(ts.color){ e.color = ''; }
    if(ts.strokeSize != null) delete e.strokeSize;
    if(ts.strokeStyle){ e.strokeStyle = ''; }
    if(ts.labelColor){ e.labelColor = ''; }
    if(ts.labelSize != null) delete e.labelSize;
    if(ts.labelFont) delete e.labelFont;
  }
