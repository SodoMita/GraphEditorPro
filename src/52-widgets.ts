  // === Blender-style drag-to-change number ===
  // Wraps a numeric input in a .drag-number-wrap and adds a ⇆ handle that,
  // when dragged horizontally, changes the input value. Shift = fine mode.
  function attachDragNumber(input: HTMLInputElement, options: { sensitivity?: number; step?: number; min?: number; max?: number } = {}){
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
