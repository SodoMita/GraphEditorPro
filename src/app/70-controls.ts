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
      handle.innerHTML = '<svg class="ui-icon" aria-hidden="true"><use href="#icon-scrub"></use></svg>';
      handle.title = I18N.t('drag_hint');
      handle.setAttribute('aria-hidden', 'true');
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
  function syncCameraInputField(el: any, value: number, force = false){
    if(!el) return;
    const str = String(Math.round(value));
    if(force || document.activeElement !== el){
      if(el.value !== str) el.value = str;
      el._syncedValue = str;
      el._userDirty = false;
    }
  }
  function isCameraInputEdited(el: any){
    if(!el) return false;
    if(el._userDirty) return true;
    return el._syncedValue !== undefined ? el.value !== el._syncedValue : el.value !== '';
  }
  function syncCameraInputs(force = false){
    const vb = currentCamera();
    const cx = vb.x + vb.w/2;
    const cy = vb.y + vb.h/2;
    syncCameraInputField($('#cameraX'), cx, force);
    syncCameraInputField($('#cameraY'), cy, force);
    syncCameraInputField($('#cameraW'), vb.w, force);
    syncCameraInputField($('#cameraH'), vb.h, force);
    const readout = $('#cameraReadout');
    if(readout){
      const text = I18N.t('camera_readout', {x: Math.round(cx), y: Math.round(cy), zoom: (1000/vb.w*100).toFixed(0)});
      if(readout.textContent !== text) readout.textContent = text;
    }
  }
  function setCameraFromInputs(sourceEl: any = null){
    // Apply only fields actually edited by the user (or explicitly submitted
    // via Enter in `sourceEl`), falling back to `currentCamera()` for untouched
    // fields so an in-flight wheel/button zoom is never reverted by stale
    // pre-preview values still sitting in the other inputs.
    const base = currentCamera();
    const xEl = $('#cameraX') as any, yEl = $('#cameraY') as any, wEl = $('#cameraW') as any, hEl = $('#cameraH') as any;
    const useField = (el: any) => Boolean(el && (el === sourceEl || isCameraInputEdited(el)));
    const baseCx = base.x + base.w/2;
    const baseCy = base.y + base.h/2;
    const cx = finite(useField(xEl) ? finite(xEl.value, baseCx) : baseCx, 0);
    const cy = finite(useField(yEl) ? finite(yEl.value, baseCy) : baseCy, 0);
    const ow = finite(useField(wEl) ? finite(wEl.value, base.w) : base.w, base.w);
    const oh = finite(useField(hEl) ? finite(hEl.value, base.h) : base.h, base.h);
    cancelZoomPreview();
    state.viewBox = boundedCamera({ x: cx - ow / 2, y: cy - oh / 2, w: ow, h: oh });
    applyCamera();
    saveSoon();
    syncCameraInputs(true);
    toast(I18N.t('camera_updated'));
  }
  function resetCamera(){
    cancelZoomPreview();
    state.viewBox = {x:-500, y:-330, w:1000, h:660};
    applyCamera(); saveSoon(); syncCameraInputs();
    toast(I18N.t('camera_reset'));
  }
  function centerOnNode(n){
    if(!n) return;
    flushZoomPreview();
    state.viewBox.x = finite(n.x - state.viewBox.w/2, 0);
    state.viewBox.y = finite(n.y - state.viewBox.h/2, 0);
    applyCamera(); saveSoon(); syncCameraInputs();
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
    flushZoomPreview();
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
    gizmoMove: 'Digit1', gizmoRotate: 'Digit2', gizmoScale: 'Digit3', gizmoRect: 'Digit4', gizmoToggle: 'KeyG',
    delete: 'Delete', pan: 'Space', undo: 'KeyZ', redo: 'KeyY', escape: 'Escape'
  };
  let _hotkeysCache = null;
  function getHotkeys(){
    if(_hotkeysCache) return _hotkeysCache;
    _hotkeysCache = {...DEFAULT_HOTKEYS};
    try {
      const stored = localStorage.getItem(HOTKEYS_KEY);
      const saved = stored ? JSON.parse(stored) : null;
      // Storage is user-writable and survives upgrades, so anything can be in
      // there. Only a known action with a string code is adopted — a null, a
      // number or an object in a slot used to reach prettyKeyCode and throw
      // "code.startsWith is not a function" from the settings panel, which then
      // failed to render at all. Unknown keys are ignored the same way.
      if(saved && typeof saved === 'object' && !Array.isArray(saved)){
        for(const name of Object.keys(DEFAULT_HOTKEYS)){
          const code = saved[name];
          if(typeof code === 'string') _hotkeysCache[name] = code;
        }
      }
    } catch { /* unreadable storage: defaults stand */ }
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
    if(typeof code !== 'string' || !code) return '\u2014';
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
  // Did the USER change the text of the field that is open right now? The
  // browser's own dirty flag cannot answer that across a matrix rebuild: the
  // session restore assigns the value programmatically, which clears it. Blur
  // commits unreported text only while this is set — inferring "uncommitted"
  // from the graph alone wrote a re-opened editor's stale text back over a
  // graph that Undo (or an algorithm, or an import) had just changed. Set by
  // the `input` event, cleared when a session opens and when it commits; it
  // lives outside the DOM, so capture/restore across a rebuild preserves it.
  let matrixEditDirty = false;
  function lockAllMatrixInputs(){
    $$('#matrixHost input').forEach(el => { el.readOnly = true; });
  }
  function unlockMatrixInput(el){
    el.readOnly = false;
  }
  // Promote a lightweight <td class="mc"> to editable by inserting an
  // <input> INSIDE the <td> (the <td> stays in the table row). Returns the
  // input so the caller can focus/unlock it.
  //
  // The input is taken OUT OF FLOW (CSS absolutely positions it over the
  // cell) and the cell's own text is kept as a hidden width placeholder
  // (`span.mc-ghost`). An in-flow <input> carries an intrinsic preferred
  // width of its own (~20ch), so promoting used to widen the column and
  // reflow the whole table: the cell being edited visibly jumped to the
  // left and every neighbour column shifted under the pointer — which also
  // made the second press of a double-click land on a different cell.
  // With an out-of-flow input and a same-text placeholder, promotion and
  // demotion are layout-neutral: the grid never moves while editing.
  function promoteCellToInput(td: HTMLElement): HTMLInputElement {
    // The cell textContent is either empty (no edge, or edge with empty
    // weight — CSS :empty::before shows a "0" placeholder) or the actual
    // weight text (including "0" for a real zero-weight edge).
    const raw = td.textContent || '';
    const input = document.createElement('input');
    input.className = 'matrix-input';
    input.value = raw;
    input.placeholder = '0';
    input.readOnly = true;
    // Copy accessible name from the <td> to the <input>.
    if(td.getAttribute('aria-label')) input.setAttribute('aria-label', td.getAttribute('aria-label')!);
    input.title = td.title || '';
    // Width placeholder: same text as the cell had, hidden but still laid
    // out, so the column keeps exactly the width it had before promotion.
    // For an empty cell the placeholder mirrors the CSS "0" glyph that
    // :empty::before would otherwise contribute.
    const ghost = document.createElement('span');
    ghost.className = 'mc-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.textContent = raw === '' ? '0' : raw;
    td.textContent = '';
    td.appendChild(ghost);
    td.appendChild(input);
    return input;
  }
  // Demote: remove the <input> (and its width placeholder) from inside its
  // <td> and restore the plain text content. Called on blur/focusout — all
  // matrix cells default to <td> with text; the <input> is only present
  // while a cell is being actively edited.
  function demoteInputToCell(input: HTMLInputElement){
    const td = input.parentElement;
    if(!td || !td.parentNode) return; // already detached — re-render handled it
    // Restore text content from the input value. Empty values become empty
    // textContent — CSS :empty::before shows a "0" placeholder visually.
    const val = input.value;
    td.removeChild(input);
    const ghost = td.querySelector('span.mc-ghost');
    if(ghost) td.removeChild(ghost);
    td.textContent = val;
  }
  // --- Edit sessions that survive a matrix rebuild -------------------------
  // A matrix re-render replaces #matrixHost wholesale, destroying whatever
  // editor is open in it — together with the text already typed there. The
  // rebuild queued by committing one cell lands ~60ms later, which is exactly
  // when a fast double-click has just opened the NEXT editor: that editor
  // used to vanish and focus fell back to the page. renderMatrixAndList()
  // therefore captures the open session before swapping the HTML and
  // re-applies it afterwards (value and caret included).
  let matrixEditSession: {kind:'cell'|'label', from:string, to:string, id:string, row:boolean, value:string, start:number, end:number} | null = null;
  function captureMatrixEditSession(){
    matrixEditSession = null;
    const edit = matrixEditCell;
    if(!edit) return;
    const active = document.activeElement as HTMLInputElement | null;
    if(!active || active.readOnly || !active.matches || !active.matches('#matrixHost input')) return;
    const start = active.selectionStart ?? 0, end = active.selectionEnd ?? 0;
    if(edit.type === 'cell'){
      const cell = (active as Element).closest('td.mc[data-c]');
      if(!cell) return;
      const {from, to} = cellFromTo(cell);
      if(from !== edit.from || to !== edit.to) return;
      matrixEditSession = {kind:'cell', from, to, id:'', row:false, value: active.value, start, end};
    } else {
      const id = (active as HTMLElement).dataset?.nodeLabel || '';
      if(!id || id !== edit.id) return;
      // Every node label exists twice (column header and row head): remember
      // which instance was open so the restore re-opens exactly that one.
      const row = !!(active as Element).closest('th.row-head');
      matrixEditSession = {kind:'label', from:'', to:'', id, row, value: active.value, start, end};
    }
  }
  function restoreMatrixEditSession(){
    const s = matrixEditSession;
    matrixEditSession = null;
    if(!s) return;
    let input: HTMLInputElement | null = null;
    if(s.kind === 'cell'){
      const cell = document.querySelector('#matrixHost tr[data-r="' + matrixAttrValue(s.from) + '"] td[data-c="' + matrixAttrValue(s.to) + '"]');
      if(!cell) return; // the cell is gone (node removed/filtered) — nothing to restore
      input = promoteCellToInput(cell as HTMLElement);
    } else {
      // Re-open the same instance (row head vs column header) that was open.
      const scope = s.row ? '#matrixHost tbody th.row-head' : '#matrixHost thead th';
      input = document.querySelector(scope + ' input[data-node-label="' + matrixAttrValue(s.id) + '"]') as HTMLInputElement | null;
      if(!input) return;
    }
    input.value = s.value;
    input.readOnly = false;
    input.focus({ preventScroll: true });
    try{ input.setSelectionRange(s.start, s.end); }catch{ /* selection unsupported */ }
    // matrixEditCell already describes this field; the session stays armed.
  }

  // === Style tab: populate + sync default controls ===
  function populateStyleSelects(){
    const shapeSel = $('#defNodeShape');
    // Labels must be resolved through I18N — a hardcoded English map kept this
    // select in English forever, and it is repopulated on a language switch
    // because syncStyleControls() runs from the i18n-change handler.
    if(shapeSel){
      const wanted = NODE_SHAPES.map(s => `<option value="${s}">${I18N.t('shape_' + s)}</option>`).join('');
      if(shapeSel.innerHTML !== wanted) shapeSel.innerHTML = wanted;
      if(shapeSel.value !== state.settings.nodeDefaults?.shape) shapeSel.value = state.settings.nodeDefaults?.shape ?? '';
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
    set('defLabelOutline', gd.labelOutline || 'outline');
    set('defLabelOutlineColor', gd.labelOutlineColor || '#020617');
    set('defLabelOutlineWidth', gd.labelOutlineWidth ?? 4);
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
      vrNote.textContent = vr.start >= 0 || vr.end >= 0 ? I18N.t('visible_count', {n: visCount, total}) : '';
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
    set('defEdgeArrowSize', ed.arrowSize);
    set('defEdgeLabelColor', ed.labelColor);
    set('defEdgeLabelFont', ed.labelFont);
    set('defEdgeLabelSize', ed.labelSize);
    // Update type datalists with existing and style-defined types
    syncEditTypeLists();
  }
  function applyNodeDefaultsToAll(){
    const d = state.settings.nodeDefaults;
    for(const n of state.nodes){
      delete n.width; delete n.height; delete n.strokeColor; delete n.strokeSize; delete n.strokeStyle;
      delete n.labelColor; delete n.labelSize; delete n.labelPosition; delete n.labelFont;
      if(d.type){
        n.type = d.type;
        delete n.shape; delete n.color;
        applyTypeStyleToNode(n);
      } else {
        n.shape = d.shape;
        n.color = d.color;
      }
    }
    invalidateGraphIndex(); pushHistory('apply node defaults'); queueRender(true); syncEditTypeLists(); renderSelectionPanel(); toast(I18N.t('node_defaults_applied'));
  }
  function applyNodeDefaultsToSelected(){
    const nodeIds = state.selection?.nodes || [];
    if(!nodeIds.length){ toast(I18N.t('no_nodes_selected')); return; }
    const d = state.settings.nodeDefaults;
    for(const id of nodeIds){
      const n = nodeById(id); if(!n) continue;
      delete n.width; delete n.height; delete n.strokeColor; delete n.strokeSize; delete n.strokeStyle;
      delete n.labelColor; delete n.labelSize; delete n.labelPosition; delete n.labelFont;
      if(d.type){
        n.type = d.type;
        delete n.shape; delete n.color;
        applyTypeStyleToNode(n);
      } else {
        n.shape = d.shape;
        n.color = d.color;
      }
    }
    invalidateGraphIndex(); pushHistory('apply node defaults to selected'); queueRender(true); syncEditTypeLists(); renderSelectionPanel();
    toast(I18N.t('node_defaults_applied_sel', {count: nodeIds.length}));
  }
  function applyEdgeDefaultsToAll(){
    const d = state.settings.edgeDefaults;
    for(const e of state.edges){
      delete e.color; delete e.strokeSize; delete e.strokeStyle; delete e.arrowSize;
      delete e.labelColor; delete e.labelSize; delete e.labelFont;
      if(d.type){
        e.type = d.type;
        applyTypeStyleToEdge(e);
      }
    }
    invalidateGraphIndex(); pushHistory('apply edge defaults'); queueRender(true); syncEditTypeLists(); renderSelectionPanel(); toast(I18N.t('edge_defaults_applied'));
  }
  function applyEdgeDefaultsToSelected(){
    const edgeIds = state.selection?.edges || [];
    if(!edgeIds.length){ toast(I18N.t('no_edges_selected')); return; }
    const d = state.settings.edgeDefaults;
    for(const id of edgeIds){
      const e = edgeById(id); if(!e) continue;
      delete e.color; delete e.strokeSize; delete e.strokeStyle; delete e.arrowSize;
      delete e.labelColor; delete e.labelSize; delete e.labelFont;
      if(d.type){
        e.type = d.type;
        applyTypeStyleToEdge(e);
      }
    }
    invalidateGraphIndex(); pushHistory('apply edge defaults to selected'); queueRender(true); syncEditTypeLists(); renderSelectionPanel();
    toast(I18N.t('edge_defaults_applied_sel', {count: edgeIds.length}));
  }

  // === Type style management ===
  function isKnownExactType(kind: 'node' | 'edge', candidate: string): boolean {
    if(!candidate) return false;
    if(kind === 'node'){
      const styles = state.settings?.nodeTypeStyles;
      return Boolean(styles && Object.prototype.hasOwnProperty.call(styles, candidate))
        || sanitizeEntityType(state.settings?.nodeDefaults?.type) === candidate
        || sanitizeEntityType(state.settings?.nodeType) === candidate
        || state.nodes.some(n => sanitizeEntityType(n.type) === candidate);
    }
    const styles = state.settings?.edgeTypeStyles;
    return Boolean(styles && Object.prototype.hasOwnProperty.call(styles, candidate))
      || sanitizeEntityType(state.settings?.edgeDefaults?.type) === candidate
      || sanitizeEntityType(state.settings?.edgeType) === candidate
      || state.edges.some(e => sanitizeEntityType(e.type) === candidate);
  }
  function resolveTypeStyleKey(kind: 'node' | 'edge', input: unknown): string {
    const raw = sanitizeEntityType(input);
    if(raw.trim() && isKnownExactType(kind, raw)) return raw;
    if(!input || typeof input === 'symbol') return '';
    try { return String(input).trim().slice(0, 40); } catch { return ''; }
  }
  function loadNodeTypeStyleForm(type){
    const key = resolveTypeStyleKey('node', type);
    const ts = getTypeStyle(state.settings.nodeTypeStyles, key) || {};
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
    const key = resolveTypeStyleKey('edge', type);
    const ts = getTypeStyle(state.settings.edgeTypeStyles, key) || {};
    $('#etsColor').value = ts.color || '#94a3b8';
    $('#etsStrokeSize').value = ts.strokeSize != null ? ts.strokeSize : 2.4;
    $('#etsStrokeStyle').value = ts.strokeStyle || '';
    $('#etsArrowSize').value = ts.arrowSize != null ? ts.arrowSize : '';
    $('#etsLabelColor').value = ts.labelColor || '#dbeafe';
    $('#etsLabelSize').value = ts.labelSize != null ? ts.labelSize : 12;
    $('#etsLabelFont').value = ts.labelFont || '';
  }
  function saveNodeTypeStyle(){
    const type = resolveTypeStyleKey('node', $('#nodeTypeStyleInput').value);
    if(!type){ toast(I18N.t('enter_type_first')); return; }
    $('#nodeTypeStyleInput').value = type;
    if(!state.settings.nodeTypeStyles) state.settings.nodeTypeStyles = Object.create(null);
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
    for(const n of state.nodes){
      if(n.type === type || (!n.type && state.settings.nodeDefaults?.type === type)) applyTypeStyleToNode(n);
    }
    invalidateTypeLists();
    pushHistory('save node type style'); queueRender(true); saveSoon(); syncEditTypeLists(); renderSelectionPanel();
    toast(I18N.t('saved_style_type', {type: type}));
  }
  function saveEdgeTypeStyle(){
    const type = resolveTypeStyleKey('edge', $('#edgeTypeStyleInput').value);
    if(!type){ toast(I18N.t('enter_type_first')); return; }
    $('#edgeTypeStyleInput').value = type;
    if(!state.settings.edgeTypeStyles) state.settings.edgeTypeStyles = Object.create(null);
    const o: AnyRecord = {
      color: $('#etsColor').value,
      strokeSize: clamp(finite($('#etsStrokeSize').value, 2.4), 0, 20),
      labelColor: $('#etsLabelColor').value,
      labelSize: clamp(finite($('#etsLabelSize').value, 12), 4, 72)
    };
    if($('#etsStrokeStyle').value) o.strokeStyle = $('#etsStrokeStyle').value;
    const av = $('#etsArrowSize').value; if(av !== '') o.arrowSize = clamp(finite(av, DEFAULT_ARROW_SIZE), ARROW_SIZE_MIN, ARROW_SIZE_MAX);
    if($('#etsLabelFont').value.trim()) o.labelFont = $('#etsLabelFont').value.trim().slice(0, 60);
    state.settings.edgeTypeStyles[type] = o;
    // Apply type style to all existing edges of this type (clears blocking overrides)
    for(const e of state.edges){
      if(e.type === type || (!e.type && state.settings.edgeDefaults?.type === type)) applyTypeStyleToEdge(e);
    }
    invalidateTypeLists();
    pushHistory('save edge type style'); queueRender(true); saveSoon(); syncEditTypeLists(); renderSelectionPanel();
    toast(I18N.t('saved_style_type', {type: type}));
  }
  function delNodeTypeStyle(){
    const type = resolveTypeStyleKey('node', $('#nodeTypeStyleInput').value);
    if(!type){ toast(I18N.t('enter_type_first')); return; }
    if(getTypeStyle(state.settings.nodeTypeStyles, type)){
      delete state.settings.nodeTypeStyles[type];
      invalidateTypeLists();
      pushHistory('delete node type style'); queueRender(true); saveSoon(); syncEditTypeLists(); renderSelectionPanel(); loadNodeTypeStyleForm('');
      toast(I18N.t('deleted_style_type', {type: type}));
    }
  }
  function delEdgeTypeStyle(){
    const type = resolveTypeStyleKey('edge', $('#edgeTypeStyleInput').value);
    if(!type){ toast(I18N.t('enter_type_first')); return; }
    if(getTypeStyle(state.settings.edgeTypeStyles, type)){
      delete state.settings.edgeTypeStyles[type];
      invalidateTypeLists();
      pushHistory('delete edge type style'); queueRender(true); saveSoon(); syncEditTypeLists(); renderSelectionPanel(); loadEdgeTypeStyleForm('');
      toast(I18N.t('deleted_style_type', {type: type}));
    }
  }
  function clearNodeOverridesForType(){
    const type = resolveTypeStyleKey('node', $('#nodeTypeStyleInput').value);
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
    pushHistory('clear per-node overrides'); queueRender(true); saveSoon(); renderSelectionPanel();
    toast(count > 0 ? I18N.t('cleared_overrides_n', {n: count}) : I18N.t('no_nodes_type'));
  }
  function clearEdgeOverridesForType(){
    const type = resolveTypeStyleKey('edge', $('#edgeTypeStyleInput').value);
    if(!type){ toast(I18N.t('enter_type_first')); return; }
    let count = 0;
    for(const e of state.edges){
      if(e.type === type){
        delete e.color; delete e.strokeSize; delete e.strokeStyle; delete e.arrowSize;
        delete e.labelColor; delete e.labelSize; delete e.labelFont;
        e.color = '';
        count++;
      }
    }
    pushHistory('clear per-edge overrides'); queueRender(true); saveSoon(); renderSelectionPanel();
    toast(count > 0 ? I18N.t('cleared_overrides_e', {n: count}) : I18N.t('no_edges_type'));
  }

  // Clear per-item overrides for properties that the node's type style defines,
  // so the type style takes effect immediately.
  function applyTypeStyleToNode(n){
    if(!n.type) return;
    const ts = getTypeStyle(state.settings.nodeTypeStyles, n.type);
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
    const ts = getTypeStyle(state.settings.edgeTypeStyles, e.type);
    if(!ts) return;
    if(ts.color){ e.color = ''; }
    if(ts.strokeSize != null) delete e.strokeSize;
    if(ts.strokeStyle){ e.strokeStyle = ''; }
    if(ts.arrowSize != null) delete e.arrowSize;
    if(ts.labelColor){ e.labelColor = ''; }
    if(ts.labelSize != null) delete e.labelSize;
    if(ts.labelFont) delete e.labelFont;
  }

  // === Style presets ===
  let presetsReturnFocus: HTMLElement | null = null;
  let presetsTrapCleanup: (() => void) | null = null;
  function renderPresetsGrid(){
    const grid = $('#presetsGrid'); if(!grid) return;
    const presets = state.settings.stylePresets || [];
    if(!presets.length){
      grid.innerHTML = `<div class="tiny muted" style="grid-column:1/-1;text-align:center;padding:20px">${esc(I18N.t('no_presets'))}</div>`;
      return;
    }
    grid.innerHTML = presets.map((p, i) => {
      const preview = presetPreviewSvg(p);
      return `<div class="preset-card-wrap">
        <button class="preset-delete" data-preset-del="${i}" title="${esc(I18N.t('delete_preset'))}" aria-label="${esc(I18N.t('delete_preset'))}"><svg class="ui-icon" aria-hidden="true"><use href="#icon-close"></use></svg></button>
        <button class="preset-card" data-preset-idx="${i}" title="${esc(I18N.t('apply_preset'))}" aria-label="${esc(I18N.t('apply_preset'))}: ${esc(p.name || 'preset')}">
          <span class="preset-preview">${preview}</span>
          <span class="preset-name">${esc(p.name || 'preset')}</span>
        </button>
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
      const raw = e.strokeStyle || 'solid';
      let dash = '';
      if(raw === 'none') dash = ' style="display:none"';
      else if(raw === 'dashed') dash = ' stroke-dasharray="8 4" stroke-linecap="square"';
      else if(raw === 'dotted') dash = ' stroke-dasharray="2 4" stroke-linecap="square"';
      else if(raw === 'dashdot') dash = ' stroke-dasharray="8 4 2 4" stroke-linecap="square"';
      else if(raw === 'dashdotdot') dash = ' stroke-dasharray="8 4 2 4 2 4" stroke-linecap="square"';
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
        if(se.arrowSize != null) e.arrowSize = se.arrowSize;
        if(se.labelColor) e.labelColor = se.labelColor;
        if(se.labelSize != null) e.labelSize = se.labelSize;
        if(se.labelFont) e.labelFont = se.labelFont;
      }
    }
    pushHistory('apply preset'); queueRender(false); saveSoon();
    const what = [];
    if(p.node && nodeIds.length) what.push(I18N.t('preset_what_nodes', {n: nodeIds.length}));
    if(p.edge && edgeIds.length) what.push(I18N.t('preset_what_edges', {n: edgeIds.length}));
    toast(I18N.t('preset_applied', {name: p.name, what: what.join(I18N.t('list_and'))}));
  }
  async function savePresetFromSelection(){
    const nodeIds = state.selection?.nodes || [];
    const edgeIds = state.selection?.edges || [];
    if(!nodeIds.length && !edgeIds.length){ toast(I18N.t('select_node_edge')); return; }
    const name = await uiPrompt(I18N.t('preset_name'), I18N.t('preset_name_hint'), I18N.t('preset') + ' ' + ((state.settings.stylePresets?.length || 0) + 1), 60);
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
          arrowSize: e.arrowSize != null ? e.arrowSize : v.arrowSize,
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
  const presetsDialog = $('#presetsOverlay') as HTMLDialogElement;
  function presetsOpen(): boolean { return presetsDialog.open || presetsDialog.classList.contains('open'); }
  function finishPresetsClose(){
    if(presetsOpen()) return; // a queued native close event from a previous opening
    presetsTrapCleanup?.(); // release containment before restoring the opener
    presetsTrapCleanup = null;
    const stack = $('#toastStack');
    if(stack.parentElement === presetsDialog) document.body.appendChild(stack);
    if(presetsReturnFocus?.isConnected) presetsReturnFocus.focus({preventScroll:true});
    presetsReturnFocus = null;
  }
  function togglePresetsOverlay(open = !presetsOpen()){
    if(open === presetsOpen()) return;
    if(open){
      // The toolbar button is the opener even on browsers where a pointer
      // click doesn't focus a button first.
      presetsReturnFocus = $('#btnPresets');
      if(typeof presetsDialog.showModal === 'function') presetsDialog.showModal();
      else {
        presetsDialog.classList.add('open');
        presetsDialog.setAttribute('role', 'dialog');
        presetsDialog.setAttribute('aria-modal', 'true');
        presetsDialog.setAttribute('aria-hidden', 'false');
        presetsTrapCleanup = trapFallbackDialog(presetsDialog, () => !dialogEl, $('#btnPresetClose'),
          () => togglePresetsOverlay(false));
      }
      // A body-level live region is inert and behind a native modal, no matter
      // its z-index. Keep preset feedback in the same accessible top layer.
      presetsDialog.appendChild($('#toastStack'));
      renderPresetsGrid();
      $('#btnPresetClose').focus({preventScroll:true});
    } else {
      if(presetsDialog.open) presetsDialog.close();
      else {
        presetsDialog.classList.remove('open');
        presetsDialog.setAttribute('aria-hidden', 'true');
      }
      finishPresetsClose();
    }
  }
  presetsDialog.addEventListener('close', finishPresetsClose);
  const CUSTOM_ATTRIBUTE_TYPES = ['boolean','int','long','float','double','string'];
  // Graph-scope custom property values (document-wide). Node/edge values live in
  // the selection panel; graph values have no "selection", so they are edited
  // here, right under the definitions they belong to.
  function renderGraphCustomProps(){
    const host = $('#graphCustomProps');
    if(!host) return;
    // The section element is cached by content key and moved in place — an
    // unrelated repaint no longer re-parses hundreds of rows.
    mountCustomProps(host, null, 'graph', 'graph', ['graph'], false);
  }
  // Custom property editors for the two new-element default sections. The
  // chosen values apply to nodes/edges created afterwards and are stored on
  // settings (nodeCustom/edgeCustom) so they ride history, autosave and the
  // sanitizer like every other new-element default.
  function renderNewElementCustomProps(){
    const nodeHost = $('#newNodeCustomProps');
    if(nodeHost) mountCustomProps(nodeHost, null, 'new-node', 'node', ['node-defaults'], false);
    const edgeHost = $('#newEdgeCustomProps');
    if(edgeHost) mountCustomProps(edgeHost, null, 'new-edge', 'edge', ['edge-defaults'], false);
  }
  // The definitions list used to be rebuilt whole on every sync: one
  // innerHTML parse of ~2.5 MB at CUSTOM_DEFINITIONS_MAX — and it ran at
  // startup even with the Data tab closed. It now renders one page of
  // CUSTOM_ATTRIBUTES_PAGE_SIZE rows (matching the value editor pages) plus a
  // pager, no-op syncs re-use the live DOM, and the boot-time build defers
  // until the Data tab is first activated. Unsaved edits survive a page flip
  // (stashed by row index and re-applied); structural mutations clear the
  // stash because indices shift then.
  const CUSTOM_ATTRIBUTES_PAGE_SIZE = 100;
  let customAttributesPage = 0;
  let customAttributesBooted = false;
  let customAttributesDeferred = false;
  let lastCustomAttributesHtml: string | null = null;
  const customAttributeEdits = new Map<number, { id: string; scope: string; type: string }>();
  function stashVisibleAttributeRows(){
    const host = $('#customAttributesList') as HTMLElement | null;
    if(!host) return;
    host.querySelectorAll('.custom-attribute-row').forEach(row => {
      const index = Number(row.getAttribute('data-custom-attribute'));
      if(!Number.isFinite(index)) return;
      const idField = row.querySelector<HTMLInputElement>('[data-attribute-field="id"]');
      const scopeField = row.querySelector<HTMLSelectElement>('[data-attribute-field="scope"]');
      const typeField = row.querySelector<HTMLSelectElement>('[data-attribute-field="type"]');
      const def = state.customAttributes[index];
      if(!idField || !scopeField || !typeField || !def) return;
      const values = { id: idField.value, scope: scopeField.value, type: typeField.value };
      if(values.id === def.id && values.scope === def.scope && values.type === def.type) customAttributeEdits.delete(index);
      else customAttributeEdits.set(index, values);
    });
  }
  function flushDeferredCustomAttributes(){
    // Interactive flush: the user is looking at (or acting on) the list, so
    // build it now. Counterpart of the boot deferral inside
    // renderCustomAttributes.
    customAttributesBooted = true;
    customAttributesDeferred = false;
    renderCustomAttributes();
  }
  function renderCustomAttributes(options?: { keepEdits?: boolean }){
    renderGraphCustomProps();
    renderNewElementCustomProps();
    const host = $('#customAttributesList') as HTMLElement | null;
    if(!host) return;
    if(!customAttributesBooted && !document.querySelector('#panel-data')?.classList.contains('active')){
      // Boot-time render with the Data tab closed: building thousands of
      // rows now is wasted work. Defer to the tab activation.
      customAttributesDeferred = true;
      return;
    }
    customAttributesBooted = true;
    customAttributesDeferred = false;
    if(!options?.keepEdits) customAttributeEdits.clear();
    const defs = state.customAttributes;
    if(!defs.length){
      const emptyHtml = `<div class="tiny muted">${esc(I18N.t('no_custom_attrs'))}</div>`;
      if(lastCustomAttributesHtml !== emptyHtml){ host.innerHTML = emptyHtml; lastCustomAttributesHtml = emptyHtml; }
      customAttributesPage = 0;
      return;
    }
    const pageCount = Math.max(1, Math.ceil(defs.length / CUSTOM_ATTRIBUTES_PAGE_SIZE));
    customAttributesPage = Math.min(Math.max(0, customAttributesPage), pageCount - 1);
    const start = customAttributesPage * CUSTOM_ATTRIBUTES_PAGE_SIZE;
    const slice = defs.slice(start, start + CUSTOM_ATTRIBUTES_PAGE_SIZE);
    const listHtml = slice.map((attribute, offset) => {
      const index = start + offset;
      const stashed = customAttributeEdits.get(index);
      const fieldId = stashed?.id ?? attribute.id;
      const fieldScope = stashed?.scope ?? attribute.scope;
      const fieldType = stashed?.type ?? attribute.type;
      return `
      <div class="custom-attribute-row" data-custom-attribute="${index}">
        <div class="custom-attribute-fields">
          <label class="field col"><span>${esc(I18N.t('attribute_id'))}</span><input type="text" maxlength="128" required value="${esc(fieldId)}" data-attribute-field="id"></label>
          <label class="field col"><span>${esc(I18N.t('attribute_scope'))}</span><select data-attribute-field="scope">
            <option value="graph" ${fieldScope === 'graph' ? 'selected' : ''}>${esc(I18N.t('scope_graph'))}</option>
            <option value="node" ${fieldScope === 'node' ? 'selected' : ''}>${esc(I18N.t('scope_node'))}</option>
            <option value="edge" ${fieldScope === 'edge' ? 'selected' : ''}>${esc(I18N.t('scope_edge'))}</option>
            <option value="all" ${fieldScope === 'all' ? 'selected' : ''}>${esc(I18N.t('scope_all'))}</option>
          </select></label>
          <label class="field col"><span>${esc(I18N.t('attribute_type'))}</span><select data-attribute-field="type">${CUSTOM_ATTRIBUTE_TYPES.map(type => `<option value="${type}" ${fieldType === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>
        </div>
        <div class="row custom-attribute-actions">
          <button type="button" class="btn small good" data-attribute-action="save">${esc(I18N.t('save_attribute'))}</button>
          <button type="button" class="btn small danger" data-attribute-action="delete" title="${esc(I18N.t('delete_btn'))}" aria-label="${esc(I18N.t('delete_btn'))}">${esc(I18N.t('delete_btn'))}</button>
        </div>
      </div>`;
    }).join('');
    const pagerHtml = pageCount > 1
      ? `<div class="custom-props-pager" role="navigation" aria-label="${esc(I18N.t('custom_props_pager_label'))}"><button type="button" class="btn small" data-def-page="prev" aria-label="${esc(I18N.t('custom_props_prev_page'))}">${esc(I18N.t('custom_props_prev_page'))}</button><span class="custom-props-page-status tiny" role="status" aria-live="polite">${esc(I18N.t('custom_props_page_status', { from: start + 1, to: start + slice.length, n: defs.length }))}</span><button type="button" class="btn small" data-def-page="next" aria-label="${esc(I18N.t('custom_props_next_page'))}">${esc(I18N.t('custom_props_next_page'))}</button></div>`
      : '';
    const pageHtml = `<div class="custom-attributes-rows">${listHtml}</div>${pagerHtml}`;
    if(pageHtml !== lastCustomAttributesHtml){
      host.innerHTML = pageHtml;
      lastCustomAttributesHtml = pageHtml;
      const prev = pagerHtml ? host.querySelector<HTMLButtonElement>('[data-def-page="prev"]') : null;
      const next = pagerHtml ? host.querySelector<HTMLButtonElement>('[data-def-page="next"]') : null;
      if(prev) prev.disabled = customAttributesPage === 0;
      if(next) next.disabled = customAttributesPage === pageCount - 1;
    }
    // One delegated listener for the pager; rows carry none of their own.
    if(!host.dataset.defsPagerWired){
      host.dataset.defsPagerWired = '1';
      host.addEventListener('click', ev => {
        const btn = (ev.target as HTMLElement)?.closest?.('[data-def-page]') as HTMLButtonElement | null;
        if(!btn || btn.disabled) return;
        stashVisibleAttributeRows();
        const dir = btn.dataset.defPage === 'prev' ? -1 : 1;
        customAttributesPage += dir;
        renderCustomAttributes({ keepEdits: true });
        const fresh = host.querySelector<HTMLButtonElement>(btn.dataset.defPage === 'prev' ? '[data-def-page="prev"]' : '[data-def-page="next"]');
        fresh?.focus({ preventScroll: true });
      });
    }
  }
