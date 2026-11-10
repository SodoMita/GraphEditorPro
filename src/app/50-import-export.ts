  function assertImportTextSize(text: string): void {
    if(text.length > MAX_IMPORT_BYTES){
      throw new Error(I18N.t('import_too_large', {mb: Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}));
    }
  }

  function fmtCoord(v){ return (Math.round(v * 10000) / 10000).toString(); }

  // Spreadsheet apps execute a cell that starts with =, +, @, tab or CR as a
  // formula. Graph labels and weights are user/import-controlled text, so a
  // malicious .json could otherwise run code on the exporter's machine when the
  // CSV is opened in Excel/Sheets. Prefix such cells with an apostrophe (the
  // standard mitigation) while leaving plain numbers — including negative
  // coordinates — untouched so the CSV stays usable.
  function formulaLikeText(v: string): boolean {
    return /^[=+@\t\r]/.test(v) || (/^-/.test(v) && !/^-\s*\d/.test(v));
  }
  // A leading apostrophe is the spreadsheet "this is text" marker, so the guard
  // has to escape a value that itself starts with one. Guarding exactly the
  // values that would otherwise be read back as guarded makes the encoding
  // reversible: '=1+1 is exported as ''=1+1 and still means '=1+1 on import.
  function needsFormulaGuard(v: string): boolean {
    // Iterative on purpose: a cell may carry thousands of leading apostrophes,
    // and recursing once per apostrophe overflowed the stack (the import was
    // caught and reported, but it never loaded). Equivalent to "a value needs
    // the guard when it is formula-like after stripping any escaped
    // apostrophes".
    let i = 0;
    while(i < v.length && v.charCodeAt(i) === 39 /* ' */) i++;
    return formulaLikeText(i === 0 ? v : v.slice(i));
  }
  function csvCell(v){
    v = String(v ?? '');
    if(needsFormulaGuard(v)) v = "'" + v;          // spreadsheet formula guard
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v;
  }
  // Inverse of the guard above: a label that really starts with "=", "+", "@"
  // or "-x" is exported as '=... so spreadsheets keep it as text, and reading
  // the file back (our import, or Excel/LibreOffice "save as CSV") drops that
  // one marker again. The marker is only removed when what follows would itself
  // have been guarded, so a label that genuinely starts with an apostrophe
  // survives the round-trip.
  function csvUnescapeCell(v: string): string {
    if(v[0] === "'" && needsFormulaGuard(v.slice(1))) return v.slice(1);
    return v;
  }
  function rowsToCsv(rows){ return '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
  function edgeCsv(){
    const rows: unknown[][] = [['id','source_id','source_label','target_id','target_label','weight','directed','label','type','color','stroke_size','stroke_style','label_color','label_size']];
    for(const e of state.edges){ const a=nodeById(e.from), b=nodeById(e.to); rows.push([e.id,e.from,a?.label||'',e.to,b?.label||'',e.weight,e.directed?'true':'false',e.label,e.type||'',e.color||'',e.strokeSize??'',e.strokeStyle||'',e.labelColor||'',e.labelSize??'']); }
    return rowsToCsv(rows);
  }
  function nodeCsv(){
    const sorted = [...state.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    return rowsToCsv([['order','id','label','x','y','shape','color','type'], ...sorted.map(n => [n.order ?? 0, n.id, n.label, fmtCoord(n.x), fmtCoord(n.y), n.shape, n.color, n.type])]);
  }
  function matrixCsv(){
    const sorted = [...state.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    const index = new Map(sorted.map((node, position) => [node.id, position]));
    const sparseRows = Array.from({length:sorted.length}, () => new Map());
    for(const edge of state.edges){
      const from = index.get(edge.from), to = index.get(edge.to); if(from == null || to == null) continue;
      const weight = (edge.weight != null && edge.weight !== '') ? edge.weight : '';
      if(!sparseRows[from].has(to)) sparseRows[from].set(to, []);
      sparseRows[from].get(to).push(weight);
      if(!edge.directed && from !== to){
        if(!sparseRows[to].has(from)) sparseRows[to].set(from, []);
        sparseRows[to].get(from).push(weight);
      }
    }
    const lines = [['', ...sorted.map(node => node.label)].map(csvCell).join(',')];
    sorted.forEach((node, rowIndex) => {
      const row = Array.from({length:sorted.length + 1}, () => '');
      row[0] = node.label;
      for(const [column, weights] of sparseRows[rowIndex]) row[column + 1] = weights.join(';');
      lines.push(row.map(csvCell).join(','));
    });
    return '\ufeff' + lines.join('\r\n') + '\r\n';
  }
  function downloadBlob(name, content, type='application/octet-stream'){
    const blob = new Blob([content], {type}); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    // Fallback: if download didn't work (e.g. sandboxed iframe), offer clipboard copy
    setTimeout(() => {
      toast(I18N.t('download_hint', {name: name}));
    }, 100);
  }
  function showExportPreview(name, content, type){
    // Show export content in an editable modal textarea.
    // Dual-purpose: export (edit/copy/download) AND import (paste/edit/import).
    // Detect format from filename extension so the Import button knows how to parse.
    const lowerName = (name || '').toLowerCase();
    let format = 'json';
    if(lowerName.endsWith('.dot') || lowerName.endsWith('.gv')) format = 'dot';
    else if(lowerName.endsWith('.graphml') || lowerName.endsWith('.xml')) format = 'graphml';
    else if(lowerName.includes('edges')) format = 'edges-csv';
    else if(lowerName.includes('matrix')) format = 'matrix-csv';
    else if(lowerName.includes('nodes')) format = 'nodes-csv';
    document.querySelector('.export-modal')?.remove();
    const returnFocus = document.activeElement as HTMLElement;
    const modal = document.createElement('div');
    modal.className = 'export-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'exportDialogTitle');
    modal.style.cssText = 'position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.72);display:grid;place-items:center;padding:16px';
    modal.innerHTML = `
      <div style="background:#0f172a;border:1px solid #334155;border-radius:14px;padding:14px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;gap:8px;box-shadow:0 24px 70px rgba(0,0,0,.55)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <span id="exportDialogTitle" style="font-weight:700;color:#e2e8f0">${esc(name)}</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <label class="row tiny muted" style="gap:4px;margin:0"><input id="expAppendChk" type="checkbox" /> ${esc(I18N.t('append'))}</label>
            <button class="btn small symbol-only good" id="expImportBtn" title="${esc(I18N.t('import_btn'))}" aria-label="${esc(I18N.t('import_btn'))}"><svg class="ui-icon" aria-hidden="true"><use href="#icon-import"></use></svg></button>
            <button class="btn small symbol-only" id="expCopyBtn" title="${esc(I18N.t('copy'))}" aria-label="${esc(I18N.t('copy'))}"><svg class="ui-icon" aria-hidden="true"><use href="#icon-copy"></use></svg></button>
            <button class="btn small symbol-only" id="expDlBtn" title="${esc(I18N.t('download'))}" aria-label="${esc(I18N.t('download'))}"><svg class="ui-icon" aria-hidden="true"><use href="#icon-export"></use></svg></button>
            <button class="btn small symbol-only danger" id="expCloseBtn" title="${esc(I18N.t('close'))}" aria-label="${esc(I18N.t('close'))}"><svg class="ui-icon" aria-hidden="true"><use href="#icon-close"></use></svg></button>
          </div>
        </div>
        <p class="tiny muted" style="margin:0">${esc(I18N.t('export_modal_desc'))}</p>
        <textarea aria-label="${esc(name)}" style="flex:1;min-height:clamp(100px,32vh,240px);width:100%;background:#020617;border:1px solid #334155;color:#dbeafe;border-radius:8px;padding:8px;font-family:ui-monospace,monospace;font-size:11px;resize:vertical" spellcheck="false"></textarea>
      </div>`;
    document.body.appendChild(modal);
    const closeModal = () => {
      modal.remove();
      if(returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
    };
    const ta = modal.querySelector<HTMLTextAreaElement>('textarea');
    ta.value = content;
    // Sync the append checkbox with the global one
    const appendChk = modal.querySelector<HTMLInputElement>('#expAppendChk');
    const globalAppend = $('#optImportAppend');
    if(globalAppend) appendChk.checked = globalAppend.checked;
    appendChk.addEventListener('change', () => { if(globalAppend) globalAppend.checked = appendChk.checked; });
    modal.querySelector('#expImportBtn').addEventListener('click', () => {
      const text = ta.value;
      if(!text || !text.trim()){ toast(I18N.t('textarea_empty')); return; }
      try {
        assertImportTextSize(text);
        if(format === 'json') importGraphData(JSON.parse(text), 'JSON', appendChk.checked);
        else if(format === 'dot') importGraphData(parseDot(text), 'DOT', appendChk.checked);
        else if(format === 'graphml') importGraphData(parseGraphml(text), 'GraphML', appendChk.checked);
        else if(format === 'edges-csv') importEdgesCsv(text, appendChk.checked);
        else if(format === 'matrix-csv') importMatrixCsv(text, appendChk.checked);
        else if(format === 'nodes-csv') importNodesCsv(text, appendChk.checked);
        closeModal();
      } catch(err){ toast(I18N.t('import_failed', {msg: err.message})); }
    });
    modal.querySelector('#expCopyBtn').addEventListener('click', () => { copyText(ta.value); });
    modal.querySelector('#expDlBtn').addEventListener('click', () => { downloadBlob(name, ta.value, type); });
    modal.querySelector('#expCloseBtn').addEventListener('click', closeModal);
    modal.addEventListener('click', ev => { if(ev.target === modal) closeModal(); });
    modal.addEventListener('keydown', ev => {
      if(ev.key === 'Escape'){
        ev.preventDefault(); ev.stopPropagation(); closeModal(); return;
      }
      if(ev.key !== 'Tab') return;
      const focusable = $$('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])', modal)
        .filter(isKeyboardVisible);
      if(!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if(ev.shiftKey && document.activeElement === first){ ev.preventDefault(); last.focus(); }
      else if(!ev.shiftKey && document.activeElement === last){ ev.preventDefault(); first.focus(); }
    });
    // Focus at the beginning; assigning a long value leaves the caret at the
    // end in some browsers and otherwise opens the preview scrolled to EOF.
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(0, 0);
      ta.scrollTop = 0;
      ta.scrollLeft = 0;
    }, 0);
  }
  function fileBase(){ return (state.title || 'graph').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,60) || 'graph'; }
  function exportJson(){ showExportPreview(`${fileBase()}.graph.json`, JSON.stringify(JSON.parse(snapshot()), null, 2), 'application/json;charset=utf-8'); }
  // Map the editor's shape names onto DOT's vocabulary (and back in parseDot).
  function dotShapeName(shape){
    return shape === 'diamond' ? 'diamond'
      : shape === 'square' ? 'box'
      : shape === 'triangleUp' ? 'triangle'
      : shape === 'triangleDown' ? 'invtriangle'
      : shape === 'hexagon' ? 'polygon'
      : 'ellipse';
  }
  function dotId(id){ return /^[A-Za-z_][A-Za-z0-9_]*$/.test(id) ? id : '"' + String(id).replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"'; }
  function dotString(v){ return '"' + String(v ?? '').replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n') + '"'; }
  // DOT style mapping for QVGE parity: QVGE uses style values solid/dashed/dotted/dashdot/dashdotdot/none
  // (CUtils::penStyleToText). DOT natively supports solid/dashed/dotted/bold/invis/filled,
  // but QVGE's DOT import (via CUtils) recognises dashdot/dashdotdot as well, so we emit
  // them directly for fidelity; GraphViz will fallback to dashed where unsupported.
  function dotStrokeStyle(style){
    if(!style || style === 'solid') return 'solid';
    if(style === 'dashed') return 'dashed';
    if(style === 'dotted') return 'dotted';
    if(style === 'dashdot') return 'dashdot';
    if(style === 'dashdotdot') return 'dashdotdot';
    if(style === 'none') return 'invis';
    return style;
  }
  function exportDotText(){
    const allDirected = state.edges.every(e => e.directed);
    const header = `${allDirected ? 'digraph' : 'graph'} ${dotId(fileBase())} {`;
    const connector = allDirected ? '->' : '--';
    const lines = [header, '  graph [layout="neato"];', '  node [style="filled"];'];
    for(const n of [...state.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0))){
      const v = nodeVisual(n);
      const attrs = [`label=${dotString(n.label)}`, `pos=${dotString(`${fmtCoord(n.x)},${fmtCoord(-n.y)}!`)}`, `shape=${dotString(dotShapeName(v.shape))}`];
      if(v.shape === 'hexagon') attrs.push('sides=6', 'regular=true');
      // QVGE DOT: fillcolor=fill, color=stroke.color, penwidth=stroke.size, style=stroke.style
      attrs.push(`fillcolor=${dotString(v.color)}`);
      attrs.push(`color=${dotString(v.strokeColor)}`);
      attrs.push(`penwidth=${v.strokeSize}`);
      const ss = v.strokeStyle;
      if(ss && ss !== 'solid' && ss !== 'none'){
        attrs.push(`style=${dotString(`filled,${dotStrokeStyle(ss)}`)}`);
      } else if(ss === 'none'){
        attrs.push(`style=${dotString('filled')}`);
      } else {
        attrs.push(`style=${dotString('filled')}`);
      }
      attrs.push(`width=${(v.width/72).toFixed(4)}`, `height=${(v.height/72).toFixed(4)}`);
      attrs.push(`order=${n.order ?? 0}`);
      if(n.type) attrs.push(`type=${dotString(n.type)}`);
      lines.push(`  ${dotId(n.id)} [${attrs.join(', ')}];`);
    }
    for(const e of state.edges){
      const v = edgeVisual(e);
      const op = e.directed ? '->' : connector;
      const attrs = [`id=${dotString(e.id)}`, `weight=${dotString(e.weight)}`];
      if(e.label) attrs.push(`label=${dotString(e.label)}`); else if(e.weight && (state.settings.graphDefaults?.edgeWeightMode || 'number') === 'number') attrs.push(`label=${dotString(e.weight)}`);
      if(!allDirected && e.directed) attrs.push('directed=true');
      // QVGE DOT: color, penwidth, style, dir
      attrs.push(`color=${dotString(v.color)}`);
      attrs.push(`penwidth=${v.strokeSize}`);
      const es = v.strokeStyle;
      if(es) attrs.push(`style=${dotString(dotStrokeStyle(es))}`);
      if(e.directed) attrs.push(`dir=${dotString('forward')}`);
      else attrs.push(`dir=${dotString('none')}`);
      lines.push(`  ${dotId(e.from)} ${op} ${dotId(e.to)} [${attrs.join(', ')}];`);
    }
    lines.push('}');
    return lines.join('\n') + '\n';
  }
  function exportDot(){ showExportPreview(`${fileBase()}.dot`, exportDotText(), 'text/vnd.graphviz;charset=utf-8'); }
  function xmlEsc(v){ return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;'}[c])); }
  function exportGraphmlText(){
    const gd = state.settings.graphDefaults;
    const lines = [`<?xml version="1.0" encoding="UTF-8"?>`, `<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:qvge="http://qvge.github.io/graphml">`,
      `  <key id="label" for="node" attr.name="label" attr.type="string"/>`,
      `  <key id="nodeId" for="node" attr.name="id" attr.type="string"/>`,
      `  <key id="order" for="node" attr.name="order" attr.type="int"/>`,
      `  <key id="x" for="node" attr.name="x" attr.type="double"/>`,
      `  <key id="y" for="node" attr.name="y" attr.type="double"/>`,
      `  <key id="type" for="node" attr.name="type" attr.type="string"/>`,
      `  <key id="shape" for="node" attr.name="shape" attr.type="string"/>`,
      `  <key id="color" for="node" attr.name="color" attr.type="string"/>`,
      `  <key id="width" for="node" attr.name="width" attr.type="double"/>`,
      `  <key id="height" for="node" attr.name="height" attr.type="double"/>`,
      `  <key id="strokeColor" for="node" attr.name="stroke.color" attr.type="string"/>`,
      `  <key id="strokeSize" for="node" attr.name="stroke.size" attr.type="double"/>`,
      `  <key id="strokeStyle" for="node" attr.name="stroke.style" attr.type="string"/>`,
      `  <key id="labelColor" for="node" attr.name="label.color" attr.type="string"/>`,
      `  <key id="labelFont" for="node" attr.name="label.font" attr.type="string"/>`,
      `  <key id="labelSize" for="node" attr.name="label.size" attr.type="double"/>`,
      `  <key id="labelPosition" for="node" attr.name="label.position" attr.type="string"/>`,
      `  <key id="weight" for="edge" attr.name="weight" attr.type="string"/>`,
      `  <key id="edgeLabel" for="edge" attr.name="label" attr.type="string"/>`,
      `  <key id="edgeType" for="edge" attr.name="type" attr.type="string"/>`,
      `  <key id="edgeColor" for="edge" attr.name="color" attr.type="string"/>`,
      `  <key id="edgeStrokeSize" for="edge" attr.name="stroke.size" attr.type="double"/>`,
      `  <key id="edgeStrokeStyle" for="edge" attr.name="style" attr.type="string"/>`,
      `  <key id="edgeLabelColor" for="edge" attr.name="label.color" attr.type="string"/>`,
      `  <key id="edgeLabelFont" for="edge" attr.name="label.font" attr.type="string"/>`,
      `  <key id="edgeLabelSize" for="edge" attr.name="label.size" attr.type="double"/>`,
      `  <key id="directed" for="edge" attr.name="directed" attr.type="boolean"/>`,
      `  <key id="labelsPolicy" for="graph" attr.name="labels.policy" attr.type="string"/>`,
      `  <key id="edgeWeightMode" for="graph" attr.name="edge.weight.mode" attr.type="string"/>`,
      `  <key id="edgeWeightMin" for="graph" attr.name="edge.weight.min" attr.type="double"/>`,
      `  <key id="edgeWeightMax" for="graph" attr.name="edge.weight.max" attr.type="double"/>`,
      `  <key id="edgeWeightCorr" for="graph" attr.name="edge.weight.corr" attr.type="string"/>`,
      `  <key id="edgeWidthMin" for="graph" attr.name="edge.width.min" attr.type="double"/>`,
      `  <key id="edgeWidthMax" for="graph" attr.name="edge.width.max" attr.type="double"/>`,
      `  <key id="edgeWeightColorLow" for="graph" attr.name="edge.weight.colorLow" attr.type="string"/>`,
      `  <key id="edgeWeightColorHigh" for="graph" attr.name="edge.weight.colorHigh" attr.type="string"/>`,
      `  <key id="canvasBgColor" for="graph" attr.name="canvas.bg.color" attr.type="string"/>`,
      `  <key id="gridMinorColor" for="graph" attr.name="grid.minor.color" attr.type="string"/>`,
      `  <key id="gridMajorColor" for="graph" attr.name="grid.major.color" attr.type="string"/>`,
      `  <key id="gridMinorAlpha" for="graph" attr.name="grid.minor.alpha" attr.type="double"/>`,
      `  <key id="gridMajorAlpha" for="graph" attr.name="grid.major.alpha" attr.type="double"/>`,
      ...state.customAttributes.map(attribute => `  <key id="${xmlEsc(attribute.id)}" for="${attribute.scope}" attr.name="${xmlEsc(attribute.id)}" attr.type="${attribute.type}"/>`),
      `  <graph id="${xmlEsc(fileBase())}" edgedefault="directed">`];
    // Graph-level defaults
    lines.push(`    <data key="labelsPolicy">${xmlEsc(gd.labelsPolicy)}</data>`);
    lines.push(`    <data key="edgeWeightMode">${xmlEsc(gd.edgeWeightMode || 'number')}</data>`);
    lines.push(`    <data key="edgeWeightMin">${gd.edgeWeightMin ?? 1}</data>`);
    lines.push(`    <data key="edgeWeightMax">${gd.edgeWeightMax ?? 10}</data>`);
    lines.push(`    <data key="edgeWeightCorr">${xmlEsc(gd.edgeWeightCorr || 'linear')}</data>`);
    lines.push(`    <data key="edgeWidthMin">${gd.edgeWidthMin ?? 1}</data>`);
    lines.push(`    <data key="edgeWidthMax">${gd.edgeWidthMax ?? 8}</data>`);
    lines.push(`    <data key="edgeWeightColorLow">${xmlEsc(gd.edgeWeightColorLow || '#22d3ee')}</data>`);
    lines.push(`    <data key="edgeWeightColorHigh">${xmlEsc(gd.edgeWeightColorHigh || '#f59e0b')}</data>`);
    lines.push(`    <data key="canvasBgColor">${xmlEsc(state.settings.canvasBgColor)}</data>`);
    lines.push(`    <data key="gridMinorColor">${xmlEsc(state.settings.gridMinorColor)}</data>`);
    lines.push(`    <data key="gridMajorColor">${xmlEsc(state.settings.gridMajorColor)}</data>`);
    lines.push(`    <data key="gridMinorAlpha">${xmlEsc(state.settings.gridMinorAlpha)}</data>`);
    lines.push(`    <data key="gridMajorAlpha">${xmlEsc(state.settings.gridMajorAlpha)}</data>`);
    // Node defaults are serialised per node below (resolved visuals), so no
    // separate <default> block is emitted.
    // Serialize nodes sorted by order
    const sortedNodes = [...state.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    for(const n of sortedNodes){
      const v = nodeVisual(n);
      const parts = [`    <node id="${xmlEsc(n.id)}">`];
      // QVGE: label is separate data, not the id. Export empty label if none.
      parts.push(`      <data key="label">${xmlEsc(n.label)}</data>`);
      parts.push(`      <data key="nodeId">${xmlEsc(n.id)}</data>`);
      parts.push(`      <data key="order">${xmlEsc(n.order ?? 0)}</data>`);
      parts.push(`      <data key="x">${xmlEsc(fmtCoord(n.x))}</data>`);
      parts.push(`      <data key="y">${xmlEsc(fmtCoord(n.y))}</data>`);
      if(n.type) parts.push(`      <data key="type">${xmlEsc(n.type)}</data>`);
      parts.push(`      <data key="shape">${xmlEsc(v.shape)}</data>`);
      parts.push(`      <data key="color">${xmlEsc(v.color)}</data>`);
      parts.push(`      <data key="width">${xmlEsc(v.width)}</data>`);
      parts.push(`      <data key="height">${xmlEsc(v.height)}</data>`);
      parts.push(`      <data key="strokeColor">${xmlEsc(v.strokeColor)}</data>`);
      parts.push(`      <data key="strokeSize">${xmlEsc(v.strokeSize)}</data>`);
      parts.push(`      <data key="strokeStyle">${xmlEsc(v.strokeStyle)}</data>`);
      parts.push(`      <data key="labelColor">${xmlEsc(v.labelColor)}</data>`);
      parts.push(`      <data key="labelFont">${xmlEsc(v.labelFont)}</data>`);
      parts.push(`      <data key="labelSize">${xmlEsc(v.labelSize)}</data>`);
      parts.push(`      <data key="labelPosition">${xmlEsc(v.labelPosition)}</data>`);
      parts.push(`    </node>`);
      lines.push(parts.join('\n'));
    }
    for(const e of state.edges){
      const v = edgeVisual(e);
      const parts = [`    <edge id="${xmlEsc(e.id)}" source="${xmlEsc(e.from)}" target="${xmlEsc(e.to)}" directed="${e.directed ? 'true' : 'false'}">`];
      parts.push(`      <data key="weight">${xmlEsc(e.weight)}</data>`);
      parts.push(`      <data key="edgeLabel">${xmlEsc(e.label)}</data>`);
      if(e.type) parts.push(`      <data key="edgeType">${xmlEsc(e.type)}</data>`);
      parts.push(`      <data key="edgeColor">${xmlEsc(v.color)}</data>`);
      parts.push(`      <data key="edgeStrokeSize">${xmlEsc(v.strokeSize)}</data>`);
      parts.push(`      <data key="edgeStrokeStyle">${xmlEsc(v.strokeStyle)}</data>`);
      parts.push(`      <data key="edgeLabelColor">${xmlEsc(v.labelColor)}</data>`);
      parts.push(`      <data key="edgeLabelFont">${xmlEsc(v.labelFont)}</data>`);
      parts.push(`      <data key="edgeLabelSize">${xmlEsc(v.labelSize)}</data>`);
      parts.push(`      <data key="directed">${e.directed ? 'true' : 'false'}</data>`);
      parts.push(`    </edge>`);
      lines.push(parts.join('\n'));
    }
    lines.push('  </graph>', '</graphml>');
    return lines.join('\n') + '\n';
  }
  function exportGraphml(){ showExportPreview(`${fileBase()}.graphml`, exportGraphmlText(), 'application/graphml+xml;charset=utf-8'); }
  function exportJsonText(){ return JSON.stringify(JSON.parse(snapshot()), null, 2); }
  function replaceWithImportedGraph(data, label='graph'){
    cancelZoomPreview();
    // Preserve current graph defaults (Style tab) when importing — only override
    // if the file explicitly carries its own defaults.
    const mergedSettings = {...state.settings, ...(data.settings || {})};
    const sane = sanitizeState({...data, title:data.title || fileBase(), settings: mergedSettings});
    state = {...state, ...sane, selected:null, selection:{nodes:[], edges:[]}};
    appHistory=[snapshot()]; appHistoryIndex=0;
    syncControls(); updateUndoRedo(); fitView(); queueRender(true, true); saveSoon();
    toast(I18N.t('imported', {label: label}));
  }
  function appendImportedGraph(data, label='graph'){
    // Append mode: merge imported nodes/edges into the current graph.
    // Keep existing settings (styles, defaults, background, grid colors) unchanged.
    const sane = sanitizeState({...data, settings: state.settings});
    // Map imported node IDs to avoid collisions with existing nodes
    const existingIds = new Set(state.nodes.map(n => n.id));
    const idMap = new Map();
    let counter = state.nextNode;
    for(const n of sane.nodes){
      let newId = n.id;
      if(existingIds.has(newId)){
        // Generate a unique ID
        while(existingIds.has('n' + counter)) counter++;
        newId = 'n' + counter;
        counter++;
      }
      existingIds.add(newId);
      idMap.set(n.id, newId);
      n.id = newId;
      // Offset position to avoid overlap with existing nodes
      n.x += 200; n.y += 200;
      n.order = state.nodes.length + state.nodes.filter(x => x.order >= n.order).length;
    }
    // Remap edge endpoints — DISCARD edges with dangling references.
    // An edge is dangling if its endpoint wasn't in the imported nodes list
    // AND doesn't already exist in the current graph (would "snap" to wrong node).
    const existingEdgeIds = new Set(state.edges.map(e => e.id));
    const validEdges = [];
    let discarded = 0;
    let edgeCounter = state.nextEdge;
    for(const e of sane.edges){
      // Resolve endpoints: prefer idMap (imported node), else check if it's an existing node
      const newFrom = idMap.has(e.from) ? idMap.get(e.from) : (existingIds.has(e.from) ? e.from : null);
      const newTo = idMap.has(e.to) ? idMap.get(e.to) : (existingIds.has(e.to) ? e.to : null);
      if(newFrom == null || newTo == null){
        // Edge references a node that doesn't exist in import or current graph — discard
        discarded++;
        continue;
      }
      e.from = newFrom;
      e.to = newTo;
      let newId = e.id;
      if(existingEdgeIds.has(newId)){
        while(existingEdgeIds.has('e' + edgeCounter)) edgeCounter++;
        newId = 'e' + edgeCounter;
        edgeCounter++;
      }
      existingEdgeIds.add(newId);
      e.id = newId;
      validEdges.push(e);
    }
    state.nodes.push(...sane.nodes);
    state.edges.push(...validEdges);
    const customIds = new Set(state.customAttributes.map(attribute => attribute.id));
    state.customAttributes.push(...sane.customAttributes.filter(attribute => !customIds.has(attribute.id)));
    state.nextNode = Math.max(state.nextNode, counter);
    state.nextEdge = Math.max(state.nextEdge, edgeCounter);
    pushHistory(`append ${label}`);
    queueRender(true, true); saveSoon();
    toast(discarded > 0
      ? I18N.t('appended_n_m_discarded', {label, n: sane.nodes.length, m: validEdges.length, d: discarded})
      : I18N.t('appended_n_m', {label, n: sane.nodes.length, m: validEdges.length}));
  }
  function importGraphData(data, label, append){
    if(append){ appendImportedGraph(data, label); }
    else { replaceWithImportedGraph(data, label); }
  }
  async function pasteFromClipboard(format){
    try{
      const text = await navigator.clipboard.readText();
      if(!text || !text.trim()){ toast(I18N.t('clipboard_empty')); return; }
      assertImportTextSize(text);
      const append = $('#optImportAppend')?.checked;
      if(format === 'json'){
        const data = JSON.parse(text);
        importGraphData(data, 'JSON', append);
      } else if(format === 'dot'){
        importGraphData(parseDot(text), 'DOT', append);
      } else if(format === 'graphml'){
        importGraphData(parseGraphml(text), 'GraphML', append);
      } else if(format === 'edges-csv'){
        importEdgesCsv(text, append);
      } else if(format === 'matrix-csv'){
        importMatrixCsv(text, append);
      } else if(format === 'nodes-csv'){
        importNodesCsv(text, append);
      }
    } catch(err){ toast(I18N.t('paste_failed', {msg: err.message})); }
  }
  function parseCsv(text){
    const rows = [];
    let row = [], field = '', inQuotes = false;
    text = text.replace(/^\ufeff/, '');
    for(let i = 0; i < text.length; i++){
      const c = text[i];
      if(inQuotes){
        if(c === '"'){ if(text[i+1] === '"'){ field += '"'; i++; } else inQuotes = false; }
        else field += c;
      } else {
        if(c === '"') inQuotes = true;
        else if(c === ','){ row.push(field); field = ''; }
        else if(c === '\r'){ /* skip */ }
        else if(c === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
        else field += c;
      }
    }
    if(field || row.length){ row.push(field); rows.push(row); }
    return rows.map(cells => cells.map(csvUnescapeCell));
  }
  // Every CSV importer used to write straight into state.nodes/state.edges, so
  // it bypassed everything sanitizeState guarantees: the 3000/8000 caps, label
  // length, colour/shape/stroke validation and dangling-edge removal. A 4,000
  // row nodes CSV therefore produced a 4,000-node document that silently shrank
  // to 3,000 on the next reload. All CSV paths now funnel through the same
  // sanitizer as JSON/GraphML imports.
  function commitCsvGraph(nodes, edges, label) {
    const sane = sanitizeState({
      title: state.title, mode: state.mode, selectTool: state.selectTool,
      selectCombine: state.selectCombine, nextNode: state.nextNode, nextEdge: state.nextEdge,
      nodes, edges, customAttributes: state.customAttributes,
      settings: state.settings, viewBox: currentCamera()
    });
    const droppedNodes = nodes.length - sane.nodes.length;
    const droppedEdges = edges.length - sane.edges.length;
    state = {...state, ...sane, selected: null, selection: {nodes: [], edges: []}};
    invalidateGraphIndex();
    invalidateSelectionCache();
    pushHistory(label); queueRender(true, true); saveSoon();
    return { droppedNodes, droppedEdges };
  }
  function csvImportToast(imported: number, dropped: number, skipped: number, limit: number, key: string) {
    if(dropped > 0){ toast(I18N.t('csv_import_capped', {imported, dropped, limit})); return; }
    if(skipped > 0){ toast(I18N.t('csv_import_skipped', {imported, skipped})); return; }
    toast(I18N.t(key, {n: imported}));
  }
  function importEdgesCsv(text, append){
    const rows = parseCsv(text);
    if(rows.length < 2){ toast(I18N.t('no_edge_data')); return; }
    const header = rows[0].map(h => h.toLowerCase().trim());
    const idx = name => header.indexOf(name);
    const iId = idx('id'), iFrom = idx('source_id') >= 0 ? idx('source_id') : idx('from'), iTo = idx('target_id') >= 0 ? idx('target_id') : idx('to');
    const iWeight = idx('weight'), iLabel = idx('label'), iDirected = idx('directed'), iType = idx('type');
    const iColor = idx('color'), iStrokeSize = idx('stroke_size'), iStrokeStyle = idx('stroke_style');
    if(iFrom < 0 || iTo < 0){ toast(I18N.t('csv_needs_cols')); return; }
    const labelToId = new Map(state.nodes.map(n => [n.label, n.id]));
    const idSet = new Set(state.nodes.map(n => n.id));
    const resolveNode = val => {
      if(!val) return null;
      if(idSet.has(val)) return val;
      if(labelToId.has(val)) return labelToId.get(val);
      return null;
    };
    const initialEdges = append ? state.edges.length : 0;
    const edges: GraphEdge[] = append ? state.edges.slice() : [];
    let parsed = 0, skipped = 0;
    for(let r = 1; r < rows.length; r++){
      const row = rows[r]; if(!row.length || (row.length === 1 && !row[0])) continue;
      const from = resolveNode(row[iFrom]); const to = resolveNode(row[iTo]);
      if(!from || !to){ skipped++; continue; }
      const e: GraphEdge = {
        // Duplicate/invalid ids are normalised by the sanitizer below, so no
        // quadratic uniqueness scan is needed here.
        id: (iId >= 0 && row[iId]) ? row[iId] : 'e' + (state.nextEdge + parsed),
        from, to,
        weight: iWeight >= 0 ? String(row[iWeight] ?? '').slice(0,50) : '',
        label: (iLabel >= 0 ? row[iLabel] : '') || '',
        directed: iDirected >= 0 ? (row[iDirected] === 'true' || row[iDirected] === '1') : state.settings.directed,
        type: (iType >= 0 ? row[iType] : '') || ''
      };
      if(iColor >= 0 && row[iColor]) e.color = row[iColor];
      if(iStrokeSize >= 0 && row[iStrokeSize]) e.strokeSize = clamp(parseFloat(row[iStrokeSize])||2.4, 0, 20);
      if(iStrokeStyle >= 0 && row[iStrokeStyle]) e.strokeStyle = row[iStrokeStyle];
      edges.push(e); parsed++;
    }
    const { droppedEdges } = commitCsvGraph(state.nodes, edges, 'import edges csv');
    csvImportToast(state.edges.length - initialEdges, droppedEdges, skipped, 8000, 'imported_n_edges');
  }
  function importMatrixCsv(text, append){
    const rows = parseCsv(text);
    if(rows.length < 2){ toast(I18N.t('no_matrix_data')); return; }
    const labels = rows[0].slice(1);
    const labelToId = new Map(state.nodes.map(n => [n.label, n.id]));
    const idSet = new Set(state.nodes.map(n => n.id));
    // Matrix rows and columns are written as *labels* (see matrixCsv), so an
    // endpoint has to resolve to a live node id before an edge is created.
    // Unknown endpoints are skipped here rather than handed to the sanitizer:
    // the sanitizer would drop the edge anyway, but then the import would
    // report a full import while edges silently vanished. Skipping keeps the
    // "skipped" count — and the toast — true.
    const resolveNode = val => {
      if(!val) return null;
      if(idSet.has(val)) return val;
      if(labelToId.has(val)) return labelToId.get(val);
      return null;
    };
    const initialEdges = append ? state.edges.length : 0;
    const edges: GraphEdge[] = append ? state.edges.slice() : [];
    let parsed = 0, skipped = 0;
    for(let r = 1; r < rows.length; r++){
      const row = rows[r]; if(!row.length) continue;
      const fromId = resolveNode(row[0]);
      if(!fromId){ if(row.slice(1).some(v => (v || '').trim())) skipped++; continue; }
      for(let c = 1; c < row.length && c-1 < labels.length; c++){
        const val = (row[c] || '').trim();
        if(!val) continue;
        const toId = resolveNode(labels[c-1]);
        if(!toId){ skipped++; continue; }
        const weights = val.split(/[;,\n\r]+/).map(v => v.trim()).filter(v => v !== '');
        for(const w of weights){
          edges.push({ id:'e' + (state.nextEdge + parsed), from: fromId, to: toId, weight: w.slice(0,50), label:'', directed: state.settings.directed, type:'' });
          parsed++;
        }
      }
    }
    const { droppedEdges } = commitCsvGraph(state.nodes, edges, 'import matrix csv');
    csvImportToast(state.edges.length - initialEdges, droppedEdges, skipped, 8000, 'imported_n_edges');
  }
  function importNodesCsv(text, append){
    const rows = parseCsv(text);
    if(rows.length < 2){ toast(I18N.t('no_node_data')); return; }
    const header = rows[0].map(h => h.toLowerCase().trim());
    const idx = name => header.indexOf(name);
    const iOrder = idx('order'), iId = idx('id'), iLabel = idx('label'), iX = idx('x'), iY = idx('y');
    const iShape = idx('shape'), iColor = idx('color'), iType = idx('type');
    const initialNodes = append ? state.nodes.length : 0;
    // Missing orders fall back to the position in the imported file, which is
    // 0-based in replace mode (the old list is gone) and continues after the
    // existing nodes in append mode.
    const orderBase = append ? state.nodes.length : 0;
    const nodes: GraphNode[] = append ? state.nodes.slice() : [];
    let parsed = 0;
    for(let r = 1; r < rows.length; r++){
      const row = rows[r]; if(!row.length || (row.length === 1 && !row[0])) continue;
      // parseInt() || fallback turned a legitimate order of 0 into "missing",
      // so a replaced 3-node graph came back as orders 3,1,2.
      const orderCell = iOrder >= 0 ? String(row[iOrder] ?? '').trim() : '';
      const parsedOrder = orderCell === '' ? NaN : parseInt(orderCell, 10);
      const n: GraphNode = {
        id: (iId >= 0 && row[iId]) ? row[iId] : 'n' + (state.nextNode + parsed),
        label: (iLabel >= 0 ? row[iLabel] : '') || '',
        x: iX >= 0 ? parseFloat(row[iX]) || 0 : 0,
        y: iY >= 0 ? parseFloat(row[iY]) || 0 : 0,
        shape: (iShape >= 0 ? row[iShape] : '') || '',
        color: (iColor >= 0 ? row[iColor] : '') || '',
        type: (iType >= 0 ? row[iType] : '') || '',
        order: Number.isFinite(parsedOrder) ? Math.max(0, Math.trunc(parsedOrder)) : orderBase + parsed
      };
      nodes.push(n); parsed++;
    }
    // Replace mode replaces the whole document, exactly as it did before the
    // sanitizer funnel: carrying the previous edges over would leave them
    // attached to nodes that no longer exist — and because the sanitizer only
    // drops *unknown* endpoints, an old edge whose id happens to match a new
    // node survived as a stale connection.
    const replacedEdges = append ? 0 : state.edges.length;
    const { droppedNodes } = commitCsvGraph(nodes, append ? state.edges : [], 'import nodes csv');
    csvImportToast(state.nodes.length - initialNodes, droppedNodes, 0, 3000, 'imported_n_nodes');
    if(replacedEdges > 0) toast(I18N.t('csv_nodes_replaced_edges', {n: state.nodes.length, e: replacedEdges}));
  }
  function parseAttrList(text): AnyRecord {
    const attrs: AnyRecord = {};
    if(!text) return attrs;
    const re = /([A-Za-z_][\w.:-]*)\s*=\s*("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,\]\s]+)/g;
    let m;
    while((m = re.exec(text))){
      let v = m[2].trim();
      if((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'")) v = dotUnescape(v.slice(1,-1));
      attrs[m[1].toLowerCase()] = v;
    }
    return attrs;
  }
  // DOT string escapes: \\ \" \' and \n. One pass, because chaining
  // replacements unescaped in the wrong order: "a\\\\nb" (the literal label a\nb)
  // hit the \n rule first and came back as a backslash plus a newline.
  function dotUnescape(text: string): string {
    return text.replace(/\\([\\"'n])/g, (_, ch) => ch === 'n' ? '\n' : ch);
  }
  function cleanDotToken(t){
    t = String(t || '').trim();
    if((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'")) return dotUnescape(t.slice(1,-1));
    return t;
  }
  // Strip DOT comments without touching quoted strings. A '#' is only a comment
  // at the start of a line (C-preprocessor style): treating every '#' as one,
  // as a global /#.*$/ regex does, truncates hex colours (fillcolor="#0ea5e9")
  // and labels such as "C#" mid-line — which used to swallow the declaration
  // that followed and silently drop nodes.
  function stripDotComments(text: string): string {
    // DOT line comments run to the end of the *line*, and a line may end with
    // LF, CRLF or a lone CR (files saved on old Macs, or pasted from tools that
    // normalise to CR). The scanner has to recognise all three: an earlier
    // version only reset "at line start" on LF, so in a CR-only file a `#`
    // comment was never recognised, its text stayed in the source, and the
    // node regex then swallowed the declaration on the next line.
    let out = '';
    let i = 0;
    let atLineStart = true;
    while(i < text.length){
      const ch = text[i];
      if(ch === '"'){                       // copy the whole quoted string verbatim
        out += ch; i++;
        while(i < text.length){
          const c = text[i]; out += c; i++;
          if(c === '\\'){ if(i < text.length){ out += text[i]; i++; } continue; }
          if(c === '"') break;
        }
        atLineStart = false;
        continue;
      }
      if(ch === '\r' || ch === '\n'){        // keep the terminator, remember the boundary
        out += ch; i++;
        if(ch === '\r' && text[i] === '\n'){ out += '\n'; i++; }
        atLineStart = true;
        continue;
      }
      if(ch === '/' && text[i+1] === '*'){ const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 2; out += ' '; continue; }
      if((ch === '#' && atLineStart) || (ch === '/' && text[i+1] === '/')){
        // Skip the comment text but leave the line terminator to the branch
        // above, so the following declaration keeps its own line.
        while(i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
        continue;
      }
      out += ch; i++;
      if(ch !== ' ' && ch !== '\t' && ch !== '\ufeff') atLineStart = false;
    }
    return out;
  }
  function parseDot(text){
    const directedGraph = /\bdigraph\b/i.test(text);
    let body = stripDotComments(text);
    const open = body.indexOf('{'), close = body.lastIndexOf('}'); if(open >= 0 && close > open) body = body.slice(open+1, close);
    const nodes = new Map<string, AnyRecord>(), edges: GraphEdge[] = [];
    const ensureNode = id => { if(!nodes.has(id)) nodes.set(id, {id:safeId(id,'n'), original:id, label:id, x:0, y:0, shape:'circle', color:'#0ea5e9'}); return nodes.get(id); };
    const id = '("(?:\\.|[^"])+"|[A-Za-z0-9_:.\\-]+)';
    const edgeRe = new RegExp(id + '\\s*(--|->)\\s*' + id + '\\s*(?:\\[([^\\]]*)\\])?', 'g');
    let m;
    while((m = edgeRe.exec(body))){
      const fromOrig = cleanDotToken(m[1]), toOrig = cleanDotToken(m[3]), attrs = parseAttrList(m[4] || '');
      const a = ensureNode(fromOrig), b = ensureNode(toOrig);
      const dotWeight = attrs.weight != null ? attrs.weight : (attrs.label || '');
      const e = { id:'e' + (edges.length+1), from:a.id, to:b.id, weight:dotWeight, label:String(attrs.label && attrs.label !== attrs.weight ? attrs.label : ''), directed:m[2] === '->' || attrs.directed === 'true' || directedGraph } as any;
      // QVGE DOT edge: color, penwidth->strokeSize, style->strokeStyle, dir controls directed flag
      const ec = parseColor(attrs.color);
      if(ec) (e as any).color = ec;
      if(attrs.penwidth != null && Number.isFinite(Number(attrs.penwidth))) (e as any).strokeSize = Math.max(0, Number(attrs.penwidth));
      if(attrs.style){
        const ss = parseStrokeStyle(attrs.style);
        if(ss) (e as any).strokeStyle = ss;
      }
      // dir attribute (QVGE uses dir=forward/none) can override directed flag
      if(attrs.dir){
        const dir = String(attrs.dir).toLowerCase();
        if(dir === 'none' || dir === 'undirected') e.directed = false;
        else if(dir === 'forward' || dir === 'directed' || dir === 'both') e.directed = true;
      }
      edges.push(e as any);
    }
    const withoutEdges = body.replace(edgeRe, '');
    const nodeRe = new RegExp('(?:^|;|[\\r\\n])\\s*' + id + '\\s*(?:\\[([^\\]]*)\\])?\\s*(?=;|[\\r\\n]|$)', 'g');
    while((m = nodeRe.exec(withoutEdges))){
      const name = cleanDotToken(m[1]);
      if(['graph','node','edge'].includes(name.toLowerCase())) continue;
      const attrs = parseAttrList(m[2] || ''), n = ensureNode(name);
      if(attrs.label) n.label = attrs.label;
      if(attrs.fillcolor || attrs.color) n.color = /^#[0-9a-f]{6}$/i.test(attrs.fillcolor || attrs.color) ? (attrs.fillcolor || attrs.color) : n.color;
      if(attrs.shape){
        const shape = parseShape(attrs.shape);
        if(shape) n.shape = shape;
        else if(/polygon/i.test(attrs.shape) && String(attrs.sides) === '6') n.shape = 'hexagon';
      }
      if(attrs.type) n.type = String(attrs.type).slice(0, 40);
      if(attrs.order != null && Number.isFinite(Number(attrs.order))) n.order = Math.max(0, Math.trunc(Number(attrs.order)));
      // QVGE DOT node: fillcolor->fill, color->stroke.color, penwidth->stroke.size, style->stroke.style
      // DOT may have fillcolor for interior and color for border; respect both
      if(attrs.fillcolor){
        const fc = parseColor(attrs.fillcolor);
        if(fc) n.color = fc;
      }
      if(attrs.color){
        const sc = parseColor(attrs.color);
        if(sc) (n as any).strokeColor = sc;
      }
      if(attrs.penwidth != null && Number.isFinite(Number(attrs.penwidth))) (n as any).strokeSize = Math.max(0, Number(attrs.penwidth));
      if(attrs.style){
        const ss = parseStrokeStyle(attrs.style);
        if(ss) (n as any).strokeStyle = ss;
      }
      // width/height from DOT are in inches (72 dpi -> px)
      if(attrs.width != null && Number.isFinite(Number(attrs.width))) (n as any).width = Math.max(10, Math.round(Number(attrs.width)*72));
      if(attrs.height != null && Number.isFinite(Number(attrs.height))) (n as any).height = Math.max(10, Math.round(Number(attrs.height)*72));
      if(attrs.pos){ const parts = attrs.pos.replace('!','').split(',').map(Number); if(Number.isFinite(parts[0])) n.x = parts[0]; if(Number.isFinite(parts[1])) n.y = -parts[1]; }
    }
    const arr = [...nodes.values()];
    if(arr.every(n => n.x === 0 && n.y === 0) && arr.length > 1){
      const r = Math.max(120, arr.length * 24);
      arr.forEach((n,i) => { const a=-Math.PI/2+i*2*Math.PI/arr.length; n.x=Math.cos(a)*r; n.y=Math.sin(a)*r; });
    }
    return {title:'imported-dot', nodes:arr.map(({original,...n}) => n), edges};
  }
  function graphmlDataMap(el, keyNames): AnyRecord {
    const map: AnyRecord = {};
    el.querySelectorAll('data').forEach(d => { const key=d.getAttribute('key') || ''; const name=(keyNames[key] || key).toLowerCase(); map[name] = d.textContent.trim(); });
    return map;
  }
  function parseShape(raw){
    const s = String(raw || '').toLowerCase();
    if(s.includes('disc') || s.includes('disk') || s.includes('circle') || s.includes('ellipse') || s.includes('oval')) return 'circle';
    if(s.includes('diamond')) return 'diamond';
    if(s.includes('square') || s.includes('rect') || s.includes('box')) return 'square';
    // "invtriangle" is DOT's downward triangle; it must be tested before the
    // generic "triangle" rule below or every downward triangle becomes upward.
    if(s.includes('invtri') || s.includes('triangledown') || s === 'triangle down' || s === 'triangle-down') return 'triangleDown';
    if(s.includes('triangleup') || s === 'triangle up' || s === 'triangle-up') return 'triangleUp';
    if(s.includes('hexagon') || s.includes('hex')) return 'hexagon';
    if(s.includes('triangle')) return 'triangleUp';
    return '';
  }
  function parseStrokeStyle(raw){
    const s = String(raw || '').toLowerCase().trim();
    if(!s) return '';
    // QVGE/CUtils exact mapping: none, solid, dotted, dashed, dashdot, dashdotdot
    // Also handle GraphViz DOT style values (dashed/dotted/solid/bold/invis) and
    // common hyphen variants. Order matters: longest first.
    if(s === 'none' || s === 'nopen' || s === 'transparent' || s === 'invis' || s === 'invisible') return 'none';
    if(s.includes('dashdotdot') || s.includes('dash-dot-dot') || s.includes('dash_dot_dot')) return 'dashdotdot';
    if(s.includes('dashdot') || s.includes('dash-dot') || s.includes('dash_dot')) return 'dashdot';
    if(s.includes('dash')) return 'dashed';
    if(s.includes('dot')) return 'dotted';
    if(s.includes('solid')) return 'solid';
    // Qt enum names that may leak through
    if(s.includes('dashline')) return 'dashed';
    if(s.includes('dotline')) return 'dotted';
    if(s.includes('dashdotline') && !s.includes('dashdotdot')) return 'dashdot';
    if(s.includes('dashdotdotline')) return 'dashdotdot';
    return '';
  }
  // Parse QVGE font descriptor: "Family,Size,-1,5,weight,italic,underline,strikeout,0,0"
  // Returns {family, size}
  function parseQvgeFont(raw){
    const s = String(raw || '').trim();
    if(!s) return null;
    // If it's a simple font name (no comma), return as-is with default size
    if(!s.includes(',')) return { family: s, size: null };
    const parts = s.split(',').map(p => p.trim());
    const family = parts[0] || 'Inter';
    const size = parseInt(parts[1], 10);
    return { family: family.slice(0, 60), size: (size > 0 && size <= 72) ? size : null };
  }
  // CSS named colors → hex. Handles common color names.
  const NAMED_COLORS = {
    black:'#000000', white:'#ffffff', red:'#ff0000', green:'#008000', blue:'#0000ff',
    yellow:'#ffff00', cyan:'#00ffff', magenta:'#ff00ff', gray:'#808080', grey:'#808080',
    silver:'#c0c0c0', maroon:'#800000', olive:'#808000', lime:'#00ff00', aqua:'#00ffff',
    teal:'#008080', navy:'#000080', fuchsia:'#ff00ff', purple:'#800080',
    orange:'#ffa500', pink:'#ffc0cb', brown:'#a52a2a', violet:'#ee82ee',
    indigo:'#4b0082', gold:'#ffd700', coral:'#ff7f50', salmon:'#fa8072',
    khaki:'#f0e68c', lavender:'#e6e6fa', tan:'#d2b48c', turquoise:'#40e0d0'
  };
  function parseColor(raw){
    if(!raw) return null;
    const s = String(raw).trim().toLowerCase();
    if(/^#[0-9a-f]{6}$/i.test(s)) return s;
    if(/^#[0-9a-f]{3}$/i.test(s)){ // expand #abc → #aabbcc
      return '#' + s[1]+s[1]+s[2]+s[2]+s[3]+s[3];
    }
    if(NAMED_COLORS[s]) return NAMED_COLORS[s];
    // rgb(r,g,b) format
    const rgb = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if(rgb) return '#' + [rgb[1],rgb[2],rgb[3]].map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
    return null;
  }
  // QVGE integer enum mappings
  function parseLabelPosition(raw){
    const s = String(raw || '').toLowerCase();
    if(['center','top','bottom','left','right'].includes(s)) return s;
    const n = parseInt(s, 10);
    // QVGE enum: 0=center, 1=top, 2=bottom, 3=left, 4=right
    if([0,1,2,3,4].includes(n)) return ['center','top','bottom','left','right'][n];
    return '';
  }
  function parseLabelsPolicy(raw){
    const s = String(raw || '').toLowerCase();
    if(['auto','on','off'].includes(s)) return s;
    const n = parseInt(s, 10);
    // QVGE enum: 0=off, 1=on, 2=auto
    if([0,1,2].includes(n)) return ['off','on','auto'][n];
    return '';
  }
  function parseDirection(raw){
    const s = String(raw || '').toLowerCase();
    // QVGE: "directed" = one-way, "undirected" = no arrows, "mutual" = bidirectional (rendered as undirected)
    if(s === 'undirected' || s === 'false' || s === '0' || s === 'mutual') return false;
    return true; // "directed", "true", "1", or default
  }
  function parseGraphml(text){
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if(doc.querySelector('parsererror')) throw new Error(I18N.t('err_invalid_graphml'));
    // Build keyNames map AND parse <default> values from <key> elements (QVGE format)
    const keyNames: Record<string, string> = {};
    const keyDefaultsByFor: Record<string, AnyRecord> = { graph: {}, node: {}, edge: {} };
    const graphmlTypes = ['boolean','int','long','float','double','string'];
    const reservedKeyIds = RESERVED_CUSTOM_ATTRIBUTE_IDS;
    const reservedAttrNames = new Set(['label','id','order','x','y','type','shape','color','width','height','stroke.color','stroke.size','stroke.style','label.color','label.font','label.size','label.position','weight','direction','labels.policy','edge.weight.mode','edge.weight.min','edge.weight.max','edge.weight.corr','edge.width.min','edge.width.max','edge.weight.colorlow','edge.weight.colorhigh','canvas.bg.color','grid.minor.color','grid.major.color','grid.minor.alpha','grid.major.alpha']);
    const customAttributes: GraphState['customAttributes'] = [];
    doc.querySelectorAll('key').forEach(k => {
      const id = k.getAttribute('id');
      const name = (k.getAttribute('attr.name') || id).toLowerCase();
      const forWhom = k.getAttribute('for') || 'all';
      keyNames[id] = name;
      const attributeType = String(k.getAttribute('attr.type') || 'string').toLowerCase();
      if(id && !reservedKeyIds.has(id) && !reservedAttrNames.has(name) && ['graph','node','edge'].includes(forWhom)){
        customAttributes.push({id, scope: forWhom as 'graph' | 'node' | 'edge', type: graphmlTypes.includes(attributeType) ? attributeType : 'string'});
      }
      const defEl = k.querySelector('default');
      if(defEl){
        const val = defEl.textContent.trim();
        keyDefaultsByFor[forWhom] = keyDefaultsByFor[forWhom] || {};
        keyDefaultsByFor[forWhom][name] = val;
      }
    });
    const graph = doc.querySelector('graph');
    const edgeDefaultAttr = graph?.getAttribute('edgedefault') || 'directed';
    const defaultDirected = parseDirection(edgeDefaultAttr);
    // Parse graph-level <data> (may override key defaults)
    const graphData = graphmlDataMap(graph || doc, keyNames);
    const graphKeyDefs = keyDefaultsByFor.graph || {};

    // Build settings from QVGE key defaults + graph data
    const settings: AnyRecord = {};
    const gd: AnyRecord = {};
    // labels.policy — from graph data first, then key default
    const lpRaw = graphData['labels.policy'] ?? graphKeyDefs['labels.policy'];
    if(lpRaw != null){
      const p = parseLabelsPolicy(lpRaw);
      if(p) gd.labelsPolicy = p;
    }
    // Edge weight visualization settings
    const ewmRaw = graphData['edge.weight.mode'] ?? graphKeyDefs['edge.weight.mode'];
    if(ewmRaw != null && ['none','number','color','width'].includes(String(ewmRaw))) gd.edgeWeightMode = String(ewmRaw);
    const ewMinRaw = graphData['edge.weight.min'] ?? graphKeyDefs['edge.weight.min'];
    if(ewMinRaw != null && ewMinRaw !== '') gd.edgeWeightMin = Number(ewMinRaw);
    const ewMaxRaw = graphData['edge.weight.max'] ?? graphKeyDefs['edge.weight.max'];
    if(ewMaxRaw != null && ewMaxRaw !== '') gd.edgeWeightMax = Number(ewMaxRaw);
    const ewCorrRaw = graphData['edge.weight.corr'] ?? graphKeyDefs['edge.weight.corr'];
    if(ewCorrRaw != null && ['linear','log','exp','sqrt'].includes(String(ewCorrRaw))) gd.edgeWeightCorr = String(ewCorrRaw);
    const ewWMinRaw = graphData['edge.width.min'] ?? graphKeyDefs['edge.width.min'];
    if(ewWMinRaw != null && ewWMinRaw !== '') gd.edgeWidthMin = Number(ewWMinRaw);
    const ewWMaxRaw = graphData['edge.width.max'] ?? graphKeyDefs['edge.width.max'];
    if(ewWMaxRaw != null && ewWMaxRaw !== '') gd.edgeWidthMax = Number(ewWMaxRaw);
    const ewCLowRaw = graphData['edge.weight.colorlow'] ?? graphKeyDefs['edge.weight.colorlow'];
    if(ewCLowRaw != null){ const c = parseColor(ewCLowRaw); if(c) gd.edgeWeightColorLow = c; }
    const ewCHighRaw = graphData['edge.weight.colorhigh'] ?? graphKeyDefs['edge.weight.colorhigh'];
    if(ewCHighRaw != null){ const c = parseColor(ewCHighRaw); if(c) gd.edgeWeightColorHigh = c; }
    if(Object.keys(gd).length) settings.graphDefaults = gd;
    // Canvas bg and grid colors — from graph data first, then key defaults
    const cbRaw = graphData['canvas.bg.color'] ?? graphKeyDefs['canvas.bg.color'];
    if(cbRaw != null) settings.canvasBgColor = String(cbRaw);
    const gmRaw = graphData['grid.minor.color'] ?? graphKeyDefs['grid.minor.color'];
    if(gmRaw != null) settings.gridMinorColor = String(gmRaw);
    const gjRaw = graphData['grid.major.color'] ?? graphKeyDefs['grid.major.color'];
    if(gjRaw != null) settings.gridMajorColor = String(gjRaw);
    const gmaRaw = graphData['grid.minor.alpha'] ?? graphKeyDefs['grid.minor.alpha'];
    if(gmaRaw != null) settings.gridMinorAlpha = parseFloat(gmaRaw);
    const gjaRaw = graphData['grid.major.alpha'] ?? graphKeyDefs['grid.major.alpha'];
    if(gjaRaw != null) settings.gridMajorAlpha = parseFloat(gjaRaw);

    // Node defaults from key defaults
    const nodeKeyDefs = keyDefaultsByFor.node || {};
    const nd: AnyRecord = {};
    if(nodeKeyDefs.shape) nd.shape = parseShape(nodeKeyDefs.shape) || undefined;
    if(nodeKeyDefs.color) nd.color = parseColor(nodeKeyDefs.color) || undefined;
    if(nodeKeyDefs['stroke.color']) nd.strokeColor = parseColor(nodeKeyDefs['stroke.color']) || undefined;
    if(nodeKeyDefs['stroke.size'] != null) nd.strokeSize = clamp(finite(nodeKeyDefs['stroke.size'], 2.2), 0, 20);
    if(nodeKeyDefs['stroke.style']) nd.strokeStyle = parseStrokeStyle(nodeKeyDefs['stroke.style']) || undefined;
    if(nodeKeyDefs['label.color']) nd.labelColor = parseColor(nodeKeyDefs['label.color']) || undefined;
    if(nodeKeyDefs['label.position'] != null){ const p = parseLabelPosition(nodeKeyDefs['label.position']); if(p) nd.labelPosition = p; }
    if(nodeKeyDefs['label.font']){ const f = parseQvgeFont(nodeKeyDefs['label.font']); if(f){ nd.labelFont = f.family; if(f.size != null) nd.labelSize = f.size; } }
    if(nodeKeyDefs.width != null) nd.width = clamp(finite(nodeKeyDefs.width, 50), 10, 300);
    if(nodeKeyDefs.height != null) nd.height = clamp(finite(nodeKeyDefs.height, 50), 10, 300);
    if(Object.keys(nd).length) settings.nodeDefaults = nd;

    // Edge defaults from key defaults
    const edgeKeyDefs = keyDefaultsByFor.edge || {};
    const ed: AnyRecord = {};
    if(edgeKeyDefs.color) ed.color = parseColor(edgeKeyDefs.color) || undefined;
    if(edgeKeyDefs['label.color']) ed.labelColor = parseColor(edgeKeyDefs['label.color']) || undefined;
    if(edgeKeyDefs['stroke.size'] != null) ed.strokeSize = clamp(finite(edgeKeyDefs['stroke.size'], 2.4), 0, 20);
    if(edgeKeyDefs.style) ed.strokeStyle = parseStrokeStyle(edgeKeyDefs.style) || undefined;
    if(edgeKeyDefs['label.font']){ const f = parseQvgeFont(edgeKeyDefs['label.font']); if(f){ ed.labelFont = f.family; if(f.size != null) ed.labelSize = f.size; } }
    if(edgeKeyDefs.weight != null) ed.weight = String(edgeKeyDefs.weight);
    if(Object.keys(ed).length) settings.edgeDefaults = ed;

    // Store the edge direction default if present
    let edgeDirectionDefault;
    if(edgeKeyDefs.direction) edgeDirectionDefault = parseDirection(edgeKeyDefs.direction);

    const nodes: GraphNode[] = [], idMap = new Map<string, string>();
    doc.querySelectorAll('node').forEach((el,i) => {
      const raw = el.getAttribute('id') || ('n' + (i+1)), id = safeId(raw, 'n'), d = graphmlDataMap(el, keyNames);
      // QVGE: nodes are unlabeled by default. Only use label data if present.
      const label = String(d.label || d.name || '');
      let x = finite(d.x ?? d.posx ?? d['position.x'], 0), y = finite(d.y ?? d.posy ?? d['position.y'], 0);
      const geom = el.querySelector('Geometry, geometry');
      if(geom){ x = finite(geom.getAttribute('x'), x); y = finite(geom.getAttribute('y'), y); }
      const node: GraphNode = {
        id, label, x, y,
        shape: d.shape ? parseShape(d.shape) : '',   // '' = unset, falls back to default
        color: parseColor(d.color || d.fillcolor) || '',  // '' = unset
        type: String(d.type || '')
      };
      if(d.width != null) node.width = clamp(finite(d.width, 50), 10, 300);
      if(d.height != null) node.height = clamp(finite(d.height, 50), 10, 300);
      const sc = parseColor(d.strokecolor || d['stroke.color']); if(sc) node.strokeColor = sc;
      if(d.strokesize != null || d['stroke.size'] != null) node.strokeSize = clamp(finite(d.strokesize ?? d['stroke.size'], 2.2), 0, 20);
      if(d.strokestyle || d['stroke.style']) node.strokeStyle = parseStrokeStyle(d.strokestyle || d['stroke.style']);
      const lc = parseColor(d.labelcolor || d['label.color']); if(lc) node.labelColor = lc;
      if(d.labelsize != null || d['label.size'] != null) node.labelSize = clamp(finite(d.labelsize ?? d['label.size'], 13), 4, 72);
      if(d.labelfont || d['label.font']){ const f = parseQvgeFont(d.labelfont || d['label.font']); if(f){ node.labelFont = f.family; if(f.size) node.labelSize = f.size; } }
      if(d.labelposition != null || d['label.position'] != null){
        const p = parseLabelPosition(d.labelposition ?? d['label.position']);
        if(p) node.labelPosition = p;
      }
      nodes.push(node);
      idMap.set(raw, id);
    });
    const edges: GraphEdge[] = [];
    doc.querySelectorAll('edge').forEach((el,i) => {
      const from = idMap.get(el.getAttribute('source')), to = idMap.get(el.getAttribute('target')); if(!from || !to) return;
      const d = graphmlDataMap(el, keyNames);
      const directedAttr = el.getAttribute('directed');
      // QVGE: edge direction can come from data "direction" field or the XML attribute
      let directed = directedAttr == null ? defaultDirected : parseDirection(directedAttr);
      if(d.direction != null) directed = parseDirection(d.direction);
      else if(directedAttr == null && edgeDirectionDefault != null) directed = edgeDirectionDefault;
      const edge: GraphEdge = {
        id: safeId(el.getAttribute('id') || ('e' + (i+1)), 'e'), from, to,
        weight: String(d.weight ?? d.value ?? ''),
        label: String(d.label || d.edgelabel || ''),
        directed,
        type: String(d.type || '')
      };
      const ec = parseColor(d.color || d.edgecolor); if(ec) edge.color = ec;
      if(d.strokesize != null || d['stroke.size'] != null) edge.strokeSize = clamp(finite(d.strokesize ?? d['stroke.size'], 2.4), 0, 20);
      if(d.strokestyle || d['stroke.style'] || d.style) edge.strokeStyle = parseStrokeStyle(d.strokestyle || d['stroke.style'] || d.style);
      const elc = parseColor(d.labelcolor || d['label.color']); if(elc) edge.labelColor = elc;
      if(d.labelsize != null || d['label.size'] != null) edge.labelSize = clamp(finite(d.labelsize ?? d['label.size'], 12), 4, 72);
      if(d.labelfont || d['label.font']){ const f = parseQvgeFont(d.labelfont || d['label.font']); if(f){ edge.labelFont = f.family; if(f.size) edge.labelSize = f.size; } }
      edges.push(edge);
    });
    if(nodes.every(n => n.x === 0 && n.y === 0) && nodes.length > 1){ const r=Math.max(120,nodes.length*24); nodes.forEach((n,i)=>{const a=-Math.PI/2+i*2*Math.PI/nodes.length; n.x=Math.cos(a)*r; n.y=Math.sin(a)*r;}); }
    // QVGE behavior: leave visual properties UNSET when not present in the file.
    // Rendering falls back to graph defaults via nodeVisual()/edgeVisual(), so
    // changing defaults later affects all nodes with unset properties.
    return {title:'imported-graphml', nodes, edges, customAttributes, settings};
  }
  function importFile(file, forcedFormat='auto'){
    if(!file) return;
    if(file.size > MAX_IMPORT_BYTES){
      toast(I18N.t('import_too_large', {mb: Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}));
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try{
        const text = String(reader.result || '');
        assertImportTextSize(text);
        const name = (file.name || '').toLowerCase();
        const format = forcedFormat !== 'auto' ? forcedFormat : name.endsWith('.dot') || name.endsWith('.gv') ? 'dot' : name.endsWith('.graphml') || name.endsWith('.xml') ? 'graphml' : name.endsWith('.csv') ? 'csv' : 'json';
        const append = $('#optImportAppend')?.checked;
        if(!append && (state.nodes.length || state.edges.length) && !await uiConfirm(I18N.t('replace_with_import'), {danger: true, confirmLabel: I18N.t('import_btn')})) return;
        if(format === 'dot') importGraphData(parseDot(text), 'DOT', append);
        else if(format === 'graphml') importGraphData(parseGraphml(text), 'GraphML', append);
        else if(format === 'csv'){
          // Auto-detect CSV type from filename or header
          if(name.includes('edge')) importEdgesCsv(text, append);
          else if(name.includes('matrix')) importMatrixCsv(text, append);
          else if(name.includes('node')) importNodesCsv(text, append);
          else {
            // Detect by header
            const firstLine = text.split('\n')[0].toLowerCase();
            if(firstLine.includes('source_id') || firstLine.includes('from')) importEdgesCsv(text, append);
            else if(firstLine.startsWith('id,') || firstLine.includes('label') && !firstLine.includes('source')) importNodesCsv(text, append);
            else importMatrixCsv(text, append);
          }
        }
        else { importGraphData(JSON.parse(text), 'JSON', append); }
      } catch(err){ toast(I18N.t('could_not_import', {msg: err.message})); }
    };
    reader.readAsText(file);
  }
