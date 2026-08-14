  // Standardized precision for all coordinate exports — 4 decimals prevents drift across round-trips
  function fmtCoord(v){ return (Math.round(v * 10000) / 10000).toString(); }

  function csvCell(v){ v = String(v ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v; }
  function rowsToCsv(rows){ return '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
  function edgeCsv(){
    const rows: Array<Array<string | number>> = [['id','source_id','source_label','target_id','target_label','weight','directed','label','type','color','stroke_size','stroke_style','label_color','label_size']];
    for(const e of state.edges){ const a=nodeById(e.from), b=nodeById(e.to); rows.push([e.id,e.from,a?.label||'',e.to,b?.label||'',String(e.weight ?? ''),e.directed?'true':'false',e.label,e.type||'',e.color||'',e.strokeSize??'',e.strokeStyle||'',e.labelColor||'',e.labelSize??'']); }
    return rowsToCsv(rows);
  }
  function nodeCsv(){
    const sorted = [...state.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    return rowsToCsv([['order','id','label','x','y','shape','color','type'], ...sorted.map(n => [n.order ?? 0, n.id, n.label, fmtCoord(n.x), fmtCoord(n.y), n.shape, n.color, n.type])]);
  }
  function matrixCsv(){
    const sorted = [...state.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    const m = adjacencyMatrix(sorted);
    const rows = [['', ...sorted.map(n => n.label)]];
    sorted.forEach((n,i) => rows.push([n.label, ...m[i].map(cell => cell.join(';') || '')]));
    return rowsToCsv(rows);
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
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.7);display:grid;place-items:center;padding:16px';
    modal.innerHTML = `
      <div style="background:#0f172a;border:1px solid #334155;border-radius:14px;padding:14px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:700;color:#e2e8f0">${esc(name)}</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <label class="row tiny muted" style="gap:4px;margin:0"><input id="expAppendChk" type="checkbox" /> Append</label>
            <button class="btn small good" id="expImportBtn" title="Parse the textarea content and import into the graph" data-i18n="import_btn">Import</button>
            <button class="btn small" id="expCopyBtn" title="Copy textarea content to clipboard" data-i18n="copy">Copy</button>
            <button class="btn small" id="expDlBtn" title="Download textarea content as a file" data-i18n="download">Download</button>
            <button class="btn small danger" id="expCloseBtn" data-i18n="close">Close</button>
          </div>
        </div>
        <p class="tiny muted" style="margin:0"><span data-i18n="export_modal_desc">Editable — modify the text, or paste content here when clipboard read is blocked, then click Import.</span></p>
        <textarea style="flex:1;min-height:240px;width:100%;background:#020617;border:1px solid #334155;color:#dbeafe;border-radius:8px;padding:8px;font-family:ui-monospace,monospace;font-size:11px;resize:vertical" spellcheck="false"></textarea>
      </div>`;
    document.body.appendChild(modal);
    const ta = modal.querySelector('textarea');
    ta.value = content;
    // Sync the append checkbox with the global one
    const appendChk = modal.querySelector('#expAppendChk') as HTMLInputElement;
    const globalAppend = $('#optImportAppend') as HTMLInputElement | null;
    if(globalAppend) appendChk.checked = globalAppend.checked;
    appendChk.addEventListener('change', () => { if(globalAppend) globalAppend.checked = appendChk.checked; });
    modal.querySelector('#expImportBtn').addEventListener('click', () => {
      const text = ta.value;
      if(!text || !text.trim()){ toast(I18N.t('textarea_empty')); return; }
      try {
        if(format === 'json') importGraphData(JSON.parse(text), 'JSON', appendChk.checked);
        else if(format === 'dot') importGraphData(parseDot(text), 'DOT', appendChk.checked);
        else if(format === 'graphml') importGraphData(parseGraphml(text), 'GraphML', appendChk.checked);
        else if(format === 'edges-csv') importEdgesCsv(text, appendChk.checked);
        else if(format === 'matrix-csv') importMatrixCsv(text, appendChk.checked);
        else if(format === 'nodes-csv') importNodesCsv(text, appendChk.checked);
        modal.remove();
      } catch(err){ toast(I18N.t('import_failed', {msg: err.message})); }
    });
    modal.querySelector('#expCopyBtn').addEventListener('click', () => { copyText(ta.value); });
    modal.querySelector('#expDlBtn').addEventListener('click', () => { downloadBlob(name, ta.value, type); });
    modal.querySelector('#expCloseBtn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', ev => { if(ev.target === modal) modal.remove(); });
    // Focus the textarea for immediate editing
    setTimeout(() => ta.focus(), 0);
  }
  function fileBase(){ return (state.title || 'graph').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,60) || 'graph'; }
  function exportJson(){ showExportPreview(`${fileBase()}.graph.json`, JSON.stringify(JSON.parse(snapshot()), null, 2), 'application/json;charset=utf-8'); }
  function dotId(id){ return /^[A-Za-z_][A-Za-z0-9_]*$/.test(id) ? id : '"' + String(id).replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"'; }
  function dotString(v){ return '"' + String(v ?? '').replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n') + '"'; }
  function exportDotText(){
    const allDirected = state.edges.every(e => e.directed);
    const header = `${allDirected ? 'digraph' : 'graph'} ${dotId(fileBase())} {`;
    const connector = allDirected ? '->' : '--';
    const lines = [header, '  graph [layout="neato"];', '  node [style="filled"];'];
    for(const n of [...state.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0))){
      const attrs = [`label=${dotString(n.label)}`, `pos=${dotString(`${fmtCoord(n.x)},${fmtCoord(-n.y)}!`)}`, `shape=${dotString(n.shape === 'diamond' ? 'diamond' : n.shape === 'square' ? 'box' : 'ellipse')}`, `fillcolor=${dotString(n.color)}`, `order=${n.order ?? 0}`];
      lines.push(`  ${dotId(n.id)} [${attrs.join(', ')}];`);
    }
    for(const e of state.edges){
      const op = e.directed ? '->' : connector;
      const attrs = [`id=${dotString(e.id)}`, `weight=${dotString(e.weight)}`];
      if(e.label) attrs.push(`label=${dotString(e.label)}`); else if(e.weight && (state.settings.graphDefaults?.edgeWeightMode || 'number') === 'number') attrs.push(`label=${dotString(e.weight)}`);
      if(!allDirected && e.directed) attrs.push('directed=true');
      lines.push(`  ${dotId(e.from)} ${op} ${dotId(e.to)} [${attrs.join(', ')}];`);
    }
    lines.push('}');
    return lines.join('\n') + '\n';
  }
  function exportDot(){ showExportPreview(`${fileBase()}.dot`, exportDotText(), 'text/vnd.graphviz;charset=utf-8'); }
  function xmlEsc(v){ return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;'}[c])); }
  function exportGraphmlText(){
    const nd = state.settings.nodeDefaults, ed = state.settings.edgeDefaults, gd = state.settings.graphDefaults;
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
      `  <key id="edgeStrokeStyle" for="edge" attr.name="stroke.style" attr.type="string"/>`,
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
    // Node defaults
    const ndLines = [`    <data key="type">${xmlEsc(nd.type)}</data>`, `    <data key="shape">${xmlEsc(nd.shape)}</data>`, `    <data key="color">${xmlEsc(nd.color)}</data>`, `    <data key="width">${xmlEsc(nd.width)}</data>`, `    <data key="height">${xmlEsc(nd.height)}</data>`, `    <data key="strokeColor">${xmlEsc(nd.strokeColor)}</data>`, `    <data key="strokeSize">${xmlEsc(nd.strokeSize)}</data>`, `    <data key="strokeStyle">${xmlEsc(nd.strokeStyle)}</data>`, `    <data key="labelColor">${xmlEsc(nd.labelColor)}</data>`, `    <data key="labelFont">${xmlEsc(nd.labelFont)}</data>`, `    <data key="labelSize">${xmlEsc(nd.labelSize)}</data>`, `    <data key="labelPosition">${xmlEsc(nd.labelPosition)}</data>`];
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
