  function attachDragNumber(input, options: AnyRecord = {}){
    if(!input) return;
    let wrap = input.closest('.drag-number-wrap');
    let handle;
    if(wrap){
      handle = wrap.querySelector('.drag-handle');
    } else {
      wrap = document.createElement('div');
      wrap.className = 'drag-number-wrap';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.textContent = '\u21C6';
      handle.title = 'Drag horizontally to change (Shift = fine)';
      wrap.appendChild(handle);
    }
    if(handle._dragBound) return;
    handle._dragBound = true;

    const sensitivity = options.sensitivity || 0.5;
    const step = options.step || 1;
    const min = options.min;
    const max = options.max;
    let dragState = null;

    handle.addEventListener('pointerdown', ev => {
      if(ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      try { handle.setPointerCapture(ev.pointerId); } catch {}
      dragState = {
        pointerId: ev.pointerId,
        startX: ev.clientX,
        startVal: parseFloat(input.value) || 0,
        lastVal: parseFloat(input.value) || 0
      };
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    });
    handle.addEventListener('pointermove', ev => {
      if(!dragState || ev.pointerId !== dragState.pointerId) return;
      const dx = ev.clientX - dragState.startX;
      const factor = ev.shiftKey ? 0.1 : 1;
      const delta = Math.round(dx * sensitivity * factor / step) * step;
      let newVal = dragState.startVal + delta;
      if(min != null) newVal = Math.max(min, newVal);
      if(max != null) newVal = Math.min(max, newVal);
      if(String(input.value) !== String(newVal)){
        input.value = newVal;
        dragState.lastVal = newVal;
        input.dispatchEvent(new Event('input', {bubbles:true}));
      }
    });
    const endDrag = ev => {
      if(!dragState || ev.pointerId !== dragState.pointerId) return;
      const changed = dragState.lastVal !== dragState.startVal;
      dragState = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if(changed) input.dispatchEvent(new Event('change', {bubbles:true}));
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  // === Camera position controls ===
  function syncCameraInputs(){
    const cx = state.viewBox.x + state.viewBox.w/2;
    const cy = state.viewBox.y + state.viewBox.h/2;
    const xEl = $('#cameraX'), yEl = $('#cameraY'), wEl = $('#cameraW'), hEl = $('#cameraH');
    if(xEl && document.activeElement !== xEl) xEl.value = Math.round(cx);
    if(yEl && document.activeElement !== yEl) yEl.value = Math.round(cy);
    if(wEl && document.activeElement !== wEl) wEl.value = Math.round(state.viewBox.w);
    if(hEl && document.activeElement !== hEl) hEl.value = Math.round(state.viewBox.h);
    const readout = $('#cameraReadout');
    if(readout) readout.textContent = (I18N.current === 'ru' ? 'центр' : 'center') + ` (${Math.round(cx)}, ${Math.round(cy)}) · ` + (I18N.current === 'ru' ? 'зум' : 'zoom') + ` ${(1000/state.viewBox.w*100).toFixed(0)}%`;
  }
  function setCameraFromInputs(){
    const cx = finite($('#cameraX').value, state.viewBox.x + state.viewBox.w/2);
    const cy = finite($('#cameraY').value, state.viewBox.y + state.viewBox.h/2);
    const w = clamp(finite($('#cameraW').value, state.viewBox.w), 100, 20000);
    const h = clamp(finite($('#cameraH').value, state.viewBox.h), 90, 20000);
    state.viewBox = { x: cx - w/2, y: cy - h/2, w, h };
    applyViewBox();
    saveSoon();
    syncCameraInputs();
    toast(I18N.t('camera_updated'));
  }
  function resetCamera(){
    state.viewBox = {x:-500, y:-330, w:1000, h:660};
    applyViewBox(); saveSoon(); syncCameraInputs();
    toast(I18N.t('camera_reset'));
  }
  function centerOnNode(n){
    if(!n) return;
    state.viewBox.x = n.x - state.viewBox.w/2;
    state.viewBox.y = n.y - state.viewBox.h/2;
    applyViewBox(); saveSoon(); syncCameraInputs();
  }
  function centerOnSelection(){
    const nodes = selectedNodeIds();
    if(nodes.size === 1){
      const n = nodeById([...nodes][0]);
      if(n){ centerOnNode(n); toast(I18N.t('centered_on', {name: n.label})); return; }
    }
    if(state.selected?.type === 'node'){
      const n = nodeById(state.selected.id);
      if(n){ centerOnNode(n); toast(I18N.t('centered_on', {name: n.label})); return; }
    }
    toast(I18N.t('select_single_node'));
  }
  function centerOnFurthestNodeOfEdge(edge){
    const a = nodeById(edge.from), b = nodeById(edge.to);
    if(!a || !b) return;
    const cx = state.viewBox.x + state.viewBox.w/2;
    const cy = state.viewBox.y + state.viewBox.h/2;
    const da = Math.hypot(a.x - cx, a.y - cy);
    const db = Math.hypot(b.x - cx, b.y - cy);
    const target = da >= db ? a : b;
    centerOnNode(target);
    toast(I18N.t('centered_on', {name: target.label}));
  }

  // === Configurable hotkeys ===
  const HOTKEYS_KEY = 'graph-editor-pro-hotkeys';
  const DEFAULT_HOTKEYS = {
    select: 'KeyS', move: 'KeyM', node: 'KeyN', edge: 'KeyE',
    delete: 'Delete', pan: 'Space', undo: 'KeyZ', redo: 'KeyY', escape: 'Escape'
  };
  let _hotkeysCache = null;
  function getHotkeys(){
    if(_hotkeysCache) return _hotkeysCache;
    try {
      const stored = localStorage.getItem(HOTKEYS_KEY);
      _hotkeysCache = stored ? {...DEFAULT_HOTKEYS, ...JSON.parse(stored)} : {...DEFAULT_HOTKEYS};
    } catch { _hotkeysCache = {...DEFAULT_HOTKEYS}; }
    return _hotkeysCache;
  }
  function setHotkey(name, code){
    const hk = getHotkeys();
    hk[name] = code || '';
    try { localStorage.setItem(HOTKEYS_KEY, JSON.stringify(hk)); } catch {}
  }
  function resetHotkeys(){
    try { localStorage.removeItem(HOTKEYS_KEY); } catch {}
    _hotkeysCache = {...DEFAULT_HOTKEYS};
    syncHotkeyInputs();
    toast(I18N.t('hotkeys_reset'));
  }
  function prettyKeyCode(code){
    if(!code) return '\u2014';
    if(code === 'Space') return 'Space';
    if(code === 'Delete') return 'Del';
    if(code === 'Escape') return 'Esc';
    if(code.startsWith('Key')) return code.slice(3);
    if(code.startsWith('Digit')) return code.slice(5);
    if(code.startsWith('Arrow')) return {ArrowLeft:'\u2190', ArrowRight:'\u2192', ArrowUp:'\u2191', ArrowDown:'\u2193'}[code] || code;
    return code;
  }
  function syncHotkeyInputs(){
    const hk = getHotkeys();
    $$('.hotkey-input').forEach(input => {
      const name = input.dataset.hotkey;
      const code = hk[name] || '';
      input.value = code ? prettyKeyCode(code) : '';
      input.placeholder = prettyKeyCode(DEFAULT_HOTKEYS[name] || '');
      input.dataset.code = code;
    });
  }
  function captureHotkey(input){
    input.value = '...';
    input.focus();
    const cleanup = () => {
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('blur', onBlur);
    };
    const onKey = ev => {
      ev.preventDefault();
      ev.stopPropagation();
      if(ev.key === 'Escape'){ syncHotkeyInputs(); input.blur(); cleanup(); return; }
      if(ev.key === 'Backspace' || ev.key === 'Delete'){
        setHotkey(input.dataset.hotkey, '');
        syncHotkeyInputs();
        input.blur();
        cleanup();
        return;
      }
      // Ignore pure modifier keys — let the user press Shift+Key etc.
      if(['Shift','Control','Alt','Meta'].includes(ev.key)) return;
      setHotkey(input.dataset.hotkey, ev.code);
      syncHotkeyInputs();
      input.blur();
      cleanup();
    };
    const onBlur = () => { syncHotkeyInputs(); cleanup(); };
    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', onBlur);
  }
  function matchesHotkey(ev, name){
    const hk = getHotkeys();
    const code = hk[name];
    if(!code) return false;
    return ev.code === code;
  }

  // === Matrix editing state: must click once to select before editing ===
  let matrixEditCell = null; // {type:'cell'|'label', from, to, id}
  function lockAllMatrixInputs(){
    $$('#matrixHost input').forEach(el => { el.readOnly = true; });
  }
  function unlockMatrixInput(el){
    el.readOnly = false;
  }

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
      n.shape = state.settings.nodeDefaults.shape;
      n.color = state.settings.nodeDefaults.color;
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
    const o: AnyRecord = {
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
    const o: AnyRecord = {
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

  // === Style presets ===
  function renderPresetsGrid(){
    const grid = $('#presetsGrid'); if(!grid) return;
    const presets = state.settings.stylePresets || [];
    if(!presets.length){
      grid.innerHTML = '<div class="tiny muted" style="grid-column:1/-1;text-align:center;padding:20px">No presets yet. Select a node or edge and click "Save from selection".</div>';
      return;
    }
    grid.innerHTML = presets.map((p, i) => {
      const preview = presetPreviewSvg(p);
      return `<div class="preset-card-wrap">
        <button class="preset-delete" data-preset-del="${i}" title="Delete preset">×</button>
        <div class="preset-card" data-preset-idx="${i}" title="Apply to selection">
          <div class="preset-preview">${preview}</div>
          <div class="preset-name">${esc(p.name || 'preset')}</div>
        </div>
      </div>`;
    }).join('');
  }
  function presetPreviewSvg(p){
    // Mini SVG preview showing node and/or edge shape
    const parts = [];
    if(p.node){
      const n = p.node;
      const shape = n.shape || 'circle';
      const color = n.color || '#0ea5e9';
      const stroke = n.strokeColor || '#e2e8f0';
      const sw = n.strokeSize != null ? n.strokeSize : 2.2;
      const w = 16, h = 16;
      let s;
      if(shape === 'square') s = `<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" fill="${color}" stroke="${stroke}" stroke-width="${sw}"/>`;
      else if(shape === 'diamond') s = `<polygon points="0,${-h/2-1} ${w/2+1},0 0,${h/2+1} ${-w/2-1},0" fill="${color}" stroke="${stroke}" stroke-width="${sw}"/>`;
      else if(shape === 'triangleUp') s = `<polygon points="0,${-h/2} ${w/2},${h/2} ${-w/2},${h/2}" fill="${color}" stroke="${stroke}" stroke-width="${sw}"/>`;
      else if(shape === 'triangleDown') s = `<polygon points="0,${h/2} ${w/2},${-h/2} ${-w/2},${-h/2}" fill="${color}" stroke="${stroke}" stroke-width="${sw}"/>`;
      else if(shape === 'hexagon') s = `<polygon points="${-6},${-8} 6,${-8} 8,0 6,8 -6,8 -8,0" fill="${color}" stroke="${stroke}" stroke-width="${sw}"/>`;
      else s = `<circle r="${w/2}" fill="${color}" stroke="${stroke}" stroke-width="${sw}"/>`;
      parts.push(`<svg width="24" height="24" viewBox="-12 -12 24 24">${s}</svg>`);
    }
    if(p.edge){
      const e = p.edge;
      const color = e.color || '#94a3b8';
      const sw = e.strokeSize != null ? e.strokeSize : 2.4;
      const dash = e.strokeStyle === 'dashed' ? ' stroke-dasharray="4 3"' : e.strokeStyle === 'dotted' ? ' stroke-dasharray="1 3"' : '';
      parts.push(`<svg width="36" height="24" viewBox="-18 -12 36 24"><line x1="-12" y1="0" x2="12" y2="0" stroke="${color}" stroke-width="${sw}"${dash}/></svg>`);
    }
    return parts.join('');
  }
  function applyPresetToSelection(idx){
    const p = state.settings.stylePresets?.[idx]; if(!p) return;
    const nodeIds = state.selection?.nodes || [];
    const edgeIds = state.selection?.edges || [];
    if(!nodeIds.length && !edgeIds.length){ toast(I18N.t('select_nodes_edges')); return; }
    if(p.node){
      for(const id of nodeIds){
        const n = nodeById(id); if(!n) continue;
        const sn = p.node;
        if(sn.shape) n.shape = sn.shape;
        if(sn.color) n.color = sn.color;
        if(sn.width != null) n.width = sn.width;
        if(sn.height != null) n.height = sn.height;
        if(sn.strokeColor) n.strokeColor = sn.strokeColor;
        if(sn.strokeSize != null) n.strokeSize = sn.strokeSize;
        if(sn.strokeStyle) n.strokeStyle = sn.strokeStyle;
        if(sn.labelColor) n.labelColor = sn.labelColor;
        if(sn.labelSize != null) n.labelSize = sn.labelSize;
        if(sn.labelPosition) n.labelPosition = sn.labelPosition;
        if(sn.labelFont) n.labelFont = sn.labelFont;
      }
    }
    if(p.edge){
      for(const id of edgeIds){
        const e = edgeById(id); if(!e) continue;
        const se = p.edge;
        if(se.color) e.color = se.color;
        if(se.strokeSize != null) e.strokeSize = se.strokeSize;
        if(se.strokeStyle) e.strokeStyle = se.strokeStyle;
        if(se.labelColor) e.labelColor = se.labelColor;
        if(se.labelSize != null) e.labelSize = se.labelSize;
        if(se.labelFont) e.labelFont = se.labelFont;
      }
    }
    pushHistory('apply preset'); queueRender(false); saveSoon();
    const what = [];
    if(p.node && nodeIds.length) what.push(`${nodeIds.length} node${nodeIds.length===1?'':'s'}`);
    if(p.edge && edgeIds.length) what.push(`${edgeIds.length} edge${edgeIds.length===1?'':'s'}`);
    toast(I18N.t('preset_applied', {name: p.name, what: what.join(I18N.current==='ru'?' и ':' and ')}));
  }
  function savePresetFromSelection(){
    const nodeIds = state.selection?.nodes || [];
    const edgeIds = state.selection?.edges || [];
    if(!nodeIds.length && !edgeIds.length){ toast(I18N.t('select_node_edge')); return; }
    const name = prompt(I18N.t('preset_name'), I18N.t('preset') + ' ' + ((state.settings.stylePresets?.length || 0) + 1));
    if(!name) return;
    const preset: AnyRecord = { name: name.slice(0, 40) };
    // Save style from first selected node
    if(nodeIds.length){
      const n = nodeById(nodeIds[0]); if(n){
        const v = nodeVisual(n);
        preset.node = {
          shape: n.shape || v.shape,
          color: n.color || v.color,
          width: n.width != null ? n.width : v.width,
          height: n.height != null ? n.height : v.height,
          strokeColor: n.strokeColor || v.strokeColor,
          strokeSize: n.strokeSize != null ? n.strokeSize : v.strokeSize,
          strokeStyle: n.strokeStyle || v.strokeStyle,
          labelColor: n.labelColor || v.labelColor,
          labelSize: n.labelSize || v.labelSize,
          labelPosition: n.labelPosition || v.labelPosition,
          labelFont: n.labelFont || v.labelFont
        };
      }
    }
    // Save style from first selected edge
    if(edgeIds.length){
      const e = edgeById(edgeIds[0]); if(e){
        const v = edgeVisual(e);
        preset.edge = {
          color: e.color || v.color,
          strokeSize: e.strokeSize != null ? e.strokeSize : v.strokeSize,
          strokeStyle: e.strokeStyle || v.strokeStyle,
          labelColor: e.labelColor || v.labelColor,
          labelSize: e.labelSize || v.labelSize,
          labelFont: e.labelFont || v.labelFont
        };
      }
    }
    if(!state.settings.stylePresets) state.settings.stylePresets = [];
    state.settings.stylePresets.push(preset);
    pushHistory('save preset'); saveSoon(); renderPresetsGrid();
    toast(I18N.t('preset_saved', {name: preset.name}));
  }
  function deletePreset(idx){
    if(!state.settings.stylePresets) return;
    state.settings.stylePresets.splice(idx, 1);
    pushHistory('delete preset'); saveSoon(); renderPresetsGrid();
  }
  function togglePresetsOverlay(){
    const overlay = $('#presetsOverlay');
    if(!overlay) return;
    const isOpen = overlay.classList.toggle('open');
    if(isOpen) renderPresetsGrid();
  }
