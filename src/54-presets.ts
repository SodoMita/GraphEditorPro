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
    const preset: { name: string; node?: Record<string, any>; edge?: Record<string, any> } = { name: name.slice(0, 40) };
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
