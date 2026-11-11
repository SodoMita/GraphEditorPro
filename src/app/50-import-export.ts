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
    const rows: unknown[][] = [['id','source_id','source_label','target_id','target_label','weight','directed','label','type','color','stroke_size','stroke_style','arrow_size','label_color','label_size']];
    for(const e of state.edges){ const a=nodeById(e.from), b=nodeById(e.to); rows.push([e.id,e.from,a?.label||'',e.to,b?.label||'',e.weight,edgeDirection(e),e.label,e.type||'',e.color||'',e.strokeSize??'',e.strokeStyle||'',e.arrowSize??'',e.labelColor||'',e.labelSize??'']); }
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
      if((edgeIsUndirected(edge) || edgeDirection(edge)==='mutual') && from !== to){
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
    // DOT grammar: the edge operator is fixed by the graph kind — `graph` takes
    // only `--`, `digraph` takes only `->`. Emitting `--` for an undirected edge
    // inside a `digraph` (which a mixed graph needs, for its `dir=both` edge)
    // is a syntax error, so the operator follows the header and the *direction*
    // is carried by `dir` alone: none -> undirected, both -> mutual,
    // forward -> directed.
    const allUndirected = state.edges.length > 0 && state.edges.every(e => edgeIsUndirected(e));
    const header = `${allUndirected ? 'graph' : 'digraph'} ${dotId(fileBase())} {`;
    // `graph` may only use `--`, and a mutual edge is invalid there anyway.
    const op = allUndirected ? '--' : '->';
    const lines = [header, '  graph [layout="neato"];', '  node [style="filled"];'];
    for(const n of [...state.nodes].sort((a,b) => (a.order ?? 0) - (b.order ?? 0))){
      const v = nodeVisual(n);
      const attrs = [`label=${dotString(n.label)}`, `pos=${dotString(`${fmtCoord(n.x)},${fmtCoord(-n.y)}!`)}`, `shape=${dotString(dotShapeName(v.shape))}`];
      if(v.shape === 'hexagon') attrs.push('sides=6', 'regular=true');
      // QVGE DOT: fillcolor=fill, color=stroke.color, penwidth=stroke.size, style=stroke.style
      attrs.push(`fillcolor=${dotString(v.color)}`);
      attrs.push(`color=${dotString(v.strokeColor)}`);
      const ss = v.strokeStyle;
      if(ss === 'none'){
        // QVGE NoPen: penwidth 0 + style invis so QVGE CUtils::textToPenStyle("none")/invis matches
        // GraphViz will not draw border when penwidth 0
        attrs.push(`penwidth=0`);
        attrs.push(`style=${dotString('invis')}`);
      } else {
        attrs.push(`penwidth=${v.strokeSize}`);
        if(ss && ss !== 'solid'){
          attrs.push(`style=${dotString(`filled,${dotStrokeStyle(ss)}`)}`);
        } else if(ss === 'solid'){
          // Explicit solid so round-trip preserves it (GraphViz default is solid anyway)
          attrs.push(`style=${dotString('filled,solid')}`);
        } else {
          attrs.push(`style=${dotString('filled')}`);
        }
      }
      attrs.push(`width=${(v.width/72).toFixed(4)}`, `height=${(v.height/72).toFixed(4)}`);
      attrs.push(`order=${n.order ?? 0}`);
      if(n.type) attrs.push(`type=${dotString(n.type)}`);
      lines.push(`  ${dotId(n.id)} [${attrs.join(', ')}];`);
    }
    for(const e of state.edges){
      const v = edgeVisual(e);
      const dir = edgeDirection(e);
      const attrs = [`id=${dotString(e.id)}`, `weight=${dotString(e.weight)}`];
      if(e.label) attrs.push(`label=${dotString(e.label)}`); else if(e.weight && (state.settings.graphDefaults?.edgeWeightMode || 'number') === 'number') attrs.push(`label=${dotString(e.weight)}`);
      // QVGE: store direction explicitly via dir for DOT
      // QVGE DOT: color, penwidth, style, dir
      attrs.push(`color=${dotString(v.color)}`);
      attrs.push(`penwidth=${v.strokeSize}`);
      const es = v.strokeStyle;
      if(es) attrs.push(`style=${dotString(dotStrokeStyle(es))}`);
      if(dir === 'mutual') attrs.push(`dir=${dotString('both')}`);
      else if(dir === 'undirected') attrs.push(`dir=${dotString('none')}`);
      else attrs.push(`dir=${dotString('forward')}`);
      if(v.arrowSize != null){
        const mul = v.arrowSize / DEFAULT_ARROW_SIZE;
        const txt = Number(mul.toFixed(4)).toString();
        attrs.push(`arrowsize=${dotString(txt)}`);
      }
      lines.push(`  ${dotId(e.from)} ${op} ${dotId(e.to)} [${attrs.join(', ')}];`);
    }
    lines.push('}');
    return lines.join('\n') + '\n';
  }
  function exportDot(){ showExportPreview(`${fileBase()}.dot`, exportDotText(), 'text/vnd.graphviz;charset=utf-8'); }
  function xmlEsc(v){ return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;'}[c])); }
  // Every <key> the GraphML exporter writes itself, in emission order. Declared
  // once so the custom-definition filter right below can use the same set of
  // reserved ids instead of a hand-copied list that drifts.
  const GRAPHML_BUILTIN_KEYS: readonly [string, string, string, string][] = [
    ['label', 'node', 'label', 'string'],
    ['nodeId', 'node', 'id', 'string'],
    ['order', 'node', 'order', 'int'],
    ['x', 'node', 'x', 'double'],
    ['y', 'node', 'y', 'double'],
    ['type', 'node', 'type', 'string'],
    ['shape', 'node', 'shape', 'string'],
    ['color', 'node', 'color', 'string'],
    ['width', 'node', 'width', 'double'],
    ['height', 'node', 'height', 'double'],
    ['strokeColor', 'node', 'stroke.color', 'string'],
    ['strokeSize', 'node', 'stroke.size', 'double'],
    ['strokeStyle', 'node', 'stroke.style', 'string'],
    ['labelColor', 'node', 'label.color', 'string'],
    ['labelFont', 'node', 'label.font', 'string'],
    ['labelSize', 'node', 'label.size', 'double'],
    ['labelPosition', 'node', 'label.position', 'string'],
    ['weight', 'edge', 'weight', 'string'],
    ['edgeLabel', 'edge', 'label', 'string'],
    ['edgeType', 'edge', 'type', 'string'],
    ['edgeColor', 'edge', 'color', 'string'],
    ['edgeStrokeSize', 'edge', 'stroke.size', 'double'],
    ['edgeStrokeStyle', 'edge', 'style', 'string'],
    ['edgeLabelColor', 'edge', 'label.color', 'string'],
    ['edgeLabelFont', 'edge', 'label.font', 'string'],
    ['edgeLabelSize', 'edge', 'label.size', 'double'],
    ['directed', 'edge', 'directed', 'boolean'],
    ['direction', 'edge', 'direction', 'string'],
    ['arrowSize', 'edge', 'arrow.size', 'double'],
    ['labelsPolicy', 'graph', 'labels.policy', 'string'],
    ['edgeWeightMode', 'graph', 'edge.weight.mode', 'string'],
    ['edgeWeightMin', 'graph', 'edge.weight.min', 'double'],
    ['edgeWeightMax', 'graph', 'edge.weight.max', 'double'],
    ['edgeWeightCorr', 'graph', 'edge.weight.corr', 'string'],
    ['edgeWidthMin', 'graph', 'edge.width.min', 'double'],
    ['edgeWidthMax', 'graph', 'edge.width.max', 'double'],
    ['edgeWeightColorLow', 'graph', 'edge.weight.colorLow', 'string'],
    ['edgeWeightColorHigh', 'graph', 'edge.weight.colorHigh', 'string'],
    ['canvasBgColor', 'graph', 'canvas.bg.color', 'string'],
    ['gridMinorColor', 'graph', 'grid.minor.color', 'string'],
    ['gridMajorColor', 'graph', 'grid.major.color', 'string'],
    ['gridMinorAlpha', 'graph', 'grid.minor.alpha', 'double'],
    ['gridMajorAlpha', 'graph', 'grid.major.alpha', 'double'],
  ];
  // The one rule core needs: a key is built-in iff it is one of these. Passed as
  // a thunk so classification cannot depend on module evaluation order.
  // The attr.names the importer below reads as built-in, per scope. Kept next to
  // the data map it mirrors so the two cannot drift apart.
  const GRAPHML_READ_NAMES: readonly (readonly [string, string])[] = [
    // Every attr.name the node/edge/graph readers below look up. A <key> using
    // one of these feeds a built-in field, so it cannot also be a definition.
    ...['label','name','x','posx','y','posy','position.x','position.y','graphics','type','shape',
        'color','fillcolor','bgcolor','width','height','stroke.color','stroke.size','stroke.style',
        'strokecolor','strokesize','strokestyle','label.color','label.font','label.size','label.position',
        'labelcolor','labelfont','labelsize','labelposition']
      .map(readName => [readName, 'node'] as const),
    ...['weight','value','label','edgelabel','type','color','edgecolor','style',
        'stroke.color','stroke.size','stroke.style','strokecolor','strokesize','strokestyle',
        'arrow.size','arrowsize','directed','direction','order','id',
        'label.color','label.font','label.size','labelcolor','labelfont','labelsize','labelposition']
      .map(readName => [readName, 'edge'] as const),
    ...['labels.policy','edge.weight.mode','edge.weight.min','edge.weight.max','edge.weight.corr',
        'edge.width.min','edge.width.max','edge.weight.colorlow','edge.weight.colorhigh',
        'canvas.bg.color','grid.minor.color','grid.major.color','grid.minor.alpha','grid.major.alpha']
      .map(readName => [readName, 'graph'] as const),
  ];
  // Built-in cover = every attr.name our exporter writes for a scope (from
  // GRAPHML_BUILTIN_KEYS, so it cannot drift from the key block) plus the alias
  // names the importer accepts from other tools. Either way the <data> binds to
  // one of our fields, so an unmarked key with that name is not a definition.
  const GRAPHML_BUILTIN_NAMES = new Map<string, string[]>(['graph','node','edge'].map(scope => [scope, []]));
  for(const [, forWhom, attrName] of GRAPHML_BUILTIN_KEYS) GRAPHML_BUILTIN_NAMES.get(forWhom)!.push(String(attrName).toLowerCase());
  registerGraphmlSchema(() => ({readNames: [
    ...GRAPHML_READ_NAMES,
    ...[...GRAPHML_BUILTIN_NAMES].flatMap(([scope, names]) => names.map(readName => [readName, scope] as const)),
  ]}));
  // Provenance, stated rather than inferred.
  //
  // Three rounds of review asked for opposite answers on identical bytes:
  //   * <key id="name" attr.name="name"> in our own export is the user's
  //     definition and must come back;
  //   * <key id="name" attr.name="name"> in a foreign file feeds the node label
  //     and must not appear as a definition;
  //   * <key id="qvge.custom.score"> from a third-party tool is that tool's key,
  //     not ours, so it must not be silently un-prefixed into `score`.
  // Identity cannot decide any of that, so the exporter states it:
  //   - every definition key carries QVGE_CUSTOM_MARKER, and keeps the
  //     definition's own id (no namespacing: an external `qvge.custom.score`
  //     stays distinct from our `score`);
  //   - the document declares a marker on <graphml> so a file is attributable
  //     as a whole, which is what lets older exports (written before markers
  //     existed) still be recognised.
  const GRAPHML_BUILTIN_KEY_IDS = new Set(GRAPHML_BUILTIN_KEYS.map(([keyId]) => keyId));
  const QVGE_NS = 'http://qvge.github.io/graphml';
  const QVGE_CUSTOM_MARKER = 'custom-attribute';
  // Prefix used by the previous export format to namespace definitions. Still
  // read, for documents written by that build.
  const CUSTOM_KEY_PREFIX = 'qvge.custom.';
  // <key> lines for the user's custom definitions.
  //
  // GraphML ids are document-unique, and a definition may legitimately share a
  // name with a built-in field (`arrowSize`, `weight`). The marker is what says
  // "this is a definition"; the id only has to be unique, so one that would
  // collide with a built-in key takes a numbered suffix. The original id stays in
  // attr.name? No — plain ids are kept exactly, so a definition that does not
  // collide is written and read back byte-identical.
  function graphmlCustomKeyLines(): string[]{
    const builtinIds = new Set(GRAPHML_BUILTIN_KEYS.map(([keyId]) => keyId));
    const taken = new Set(builtinIds);
    for(const attribute of state.customAttributes) taken.add(attribute.id);
    const emitted = new Set<string>();
    return state.customAttributes.map(attribute => {
      let id = attribute.id;
      if(builtinIds.has(id)){
        // Only the colliding case is rewritten, and deterministically: the first
        // free numbered suffix that no other definition claims.
        for(let suffix = 2; ; suffix++){
          const candidate = `${attribute.id}${suffix}`;
          if(!builtinIds.has(candidate) && !taken.has(candidate) && !emitted.has(candidate)){ id = candidate; break; }
        }
      }
      emitted.add(id);
      const attrName = (attribute as AnyRecord).name || attribute.id;
      // The definition's own id, when the exported key id had to differ. Without
      // it a de-collided `arrowSize` would come back as `arrowSize2` and drift.
      const idAttr = id === attribute.id ? '' : ` qvge:id="${xmlEsc(attribute.id)}"`;
      return `  <key id="${xmlEsc(id)}" for="${xmlEsc(attribute.scope)}" attr.name="${xmlEsc(attrName)}" attr.type="${xmlEsc(attribute.type)}" qvge:kind="${QVGE_CUSTOM_MARKER}"${idAttr}/>`;
    });
  }
  function exportGraphmlText(){
    const gd = state.settings.graphDefaults;
    const lines = [`<?xml version="1.0" encoding="UTF-8"?>`, `<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:qvge="http://qvge.github.io/graphml" qvge:writer="graph-editor-pro" qvge:keys="${GRAPHML_BUILTIN_KEYS.length}">`,
      ...GRAPHML_BUILTIN_KEYS.map(([id, forWhom, attrName, type]) => `  <key id="${id}" for="${forWhom}" attr.name="${attrName}" attr.type="${type}"/>`),
      // Custom definitions come after the built-ins, so a custom id that matches
      // one of them would emit a second <key> with the same id and make every
      // <data key="..."> reference ambiguous. Rename those to a free id (the
      // sanitizer does the same on load) so the definition is kept, not dropped.
      ...graphmlCustomKeyLines(),
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
      const dir = edgeDirection(e);
      const directedBool = dir !== 'undirected';
      const parts = [`    <edge id="${xmlEsc(e.id)}" source="${xmlEsc(e.from)}" target="${xmlEsc(e.to)}" directed="${directedBool ? 'true' : 'false'}">`];
      parts.push(`      <data key="weight">${xmlEsc(e.weight)}</data>`);
      parts.push(`      <data key="edgeLabel">${xmlEsc(e.label)}</data>`);
      if(e.type) parts.push(`      <data key="edgeType">${xmlEsc(e.type)}</data>`);
      parts.push(`      <data key="edgeColor">${xmlEsc(v.color)}</data>`);
      parts.push(`      <data key="edgeStrokeSize">${xmlEsc(v.strokeSize)}</data>`);
      parts.push(`      <data key="edgeStrokeStyle">${xmlEsc(v.strokeStyle)}</data>`);
      parts.push(`      <data key="edgeLabelColor">${xmlEsc(v.labelColor)}</data>`);
      parts.push(`      <data key="edgeLabelFont">${xmlEsc(v.labelFont)}</data>`);
      parts.push(`      <data key="edgeLabelSize">${xmlEsc(v.labelSize)}</data>`);
      parts.push(`      <data key="directed">${directedBool ? 'true' : 'false'}</data>`);
      parts.push(`      <data key="direction">${xmlEsc(dir)}</data>`);
      parts.push(`      <data key="arrowSize">${xmlEsc(v.arrowSize)}</data>`);
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
    const iColor = idx('color'), iStrokeSize = idx('stroke_size'), iStrokeStyle = idx('stroke_style'), iArrowSize = idx('arrow_size');
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
        direction: iDirected >= 0 ? normalizeDirection(row[iDirected]) : normalizeDirection((state.settings as any).direction ?? state.settings.directed),
        directed: ((iDirected >= 0 ? normalizeDirection(row[iDirected]) : normalizeDirection((state.settings as any).direction ?? state.settings.directed)) !== 'undirected' as any),
        type: (iType >= 0 ? row[iType] : '') || ''
      };
      if(iColor >= 0 && row[iColor]) e.color = row[iColor];
      if(iStrokeSize >= 0 && row[iStrokeSize]) e.strokeSize = clamp(parseFloat(row[iStrokeSize])||2.4, 0, 20);
      if(iStrokeStyle >= 0 && row[iStrokeStyle]) e.strokeStyle = row[iStrokeStyle];
      if(iArrowSize >= 0 && row[iArrowSize]) e.arrowSize = clamp(parseFloat(row[iArrowSize])||DEFAULT_ARROW_SIZE, ARROW_SIZE_MIN, ARROW_SIZE_MAX);
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
          const dir = normalizeDirection((state.settings as any).direction ?? state.settings.directed);
          edges.push({ id:'e' + (state.nextEdge + parsed), from: fromId, to: toId, weight: w.slice(0,50), label:'', directed: (dir !== 'undirected') as any, direction: dir as any, type:'' });
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
      const initDir = m[2] === '->' || directedGraph ? 'directed' : 'undirected';
      const e = { id:'e' + (edges.length+1), from:a.id, to:b.id, weight:dotWeight, label:String(attrs.label && attrs.label !== attrs.weight ? attrs.label : ''), directed: (initDir !== 'undirected') as any, direction: initDir as any } as any;
      if(attrs.directed){ const dd = normalizeDirection(attrs.directed); (e as any).direction = dd; (e as any).directed = dd !== 'undirected'; }
      // QVGE DOT edge: color, penwidth->strokeSize, style->strokeStyle, dir controls directed flag
      const ec = parseColor(attrs.color);
      if(ec) (e as any).color = ec;
      if(attrs.penwidth != null && Number.isFinite(Number(attrs.penwidth))) (e as any).strokeSize = Math.max(0, Number(attrs.penwidth));
      if(attrs.style){
        const ss = parseStrokeStyle(attrs.style);
        if(ss) (e as any).strokeStyle = ss;
      }
      if(attrs.arrowsize != null){
        const mul = Number(attrs.arrowsize);
        const m = Number.isFinite(mul) ? mul : 1;
        // Graphviz arrowsize is a multiplier (default 1); convert to editor's absolute size (default 12)
        // Heuristic for legacy files that stored absolute size (e.g. 12): values > 5 are treated as absolute
        if(m > 5){
          (e as any).arrowSize = clamp(m, ARROW_SIZE_MIN, ARROW_SIZE_MAX);
        } else {
          (e as any).arrowSize = clamp(m * DEFAULT_ARROW_SIZE, ARROW_SIZE_MIN, ARROW_SIZE_MAX);
        }
      }
      // dir attribute (QVGE uses dir=forward/none/both) maps to directed/undirected/mutual
      if(attrs.dir){
        const dir = String(attrs.dir).toLowerCase();
        if(dir === 'none' || dir === 'undirected'){ (e as any).direction = 'undirected'; (e as any).directed = false; }
        else if(dir === 'both' || dir === 'mutual'){ (e as any).direction = 'mutual'; (e as any).directed = true; }
        else if(dir === 'forward' || dir === 'directed' || dir === 'true'){ (e as any).direction = 'directed'; (e as any).directed = true; }
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
  // Read the data belonging to *one element*, on *one scope*.
  //
  // Two rules, both learned from bugs that silently corrupted settings:
  //
  //  1. Only this element's own <data> children. `querySelectorAll` is
  //     depth-first, so reading a <graph> that way also collected every <node>'s
  //     data; a node property whose key was unknown on the graph scope then fell
  //     through to its raw id and could overwrite a graph setting.
  //  2. A key that is not a built-in field *on this scope* contributes nothing.
  //     There is no fallback to the raw key id: an id is not a field name. The
  //     fallback existed to rescue undeclared keys, but it made every custom
  //     attribute whose id resembled a setting behave like one.
  //
  // `fieldFor` maps `${keyId}|${scope}` to the built-in field it feeds there, or
  // to '' when the declaration feeds none (a definition, or a shadowed spelling).
  // Presence in the map is what matters, so `hasOwnProperty` — never `||`.
  function graphmlDataMap(el, fieldFor, forWhom): AnyRecord {
    const map: AnyRecord = {};
    for(const d of Array.from(el.children) as Element[]){
      if(d.tagName.toLowerCase() !== 'data') continue;
      const slot = `${d.getAttribute('key') || ''}|${forWhom}`;
      if(!Object.prototype.hasOwnProperty.call(fieldFor, slot)) continue;
      const name = fieldFor[slot];
      if(!name) continue; // declared, but not a built-in field on this scope
      map[name] = d.textContent.trim();
    }
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
    if(s === 'none' || s === 'nopen' || s === 'transparent' || s === 'invis' || s === 'invisible' || s.includes('invis')) return 'none';
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
    const s = String(raw || '').toLowerCase().trim();
    // QVGE: "directed" = one-way, "undirected" = no arrows, "mutual" = bidirectional (both arrows)
    if(s === 'undirected' || s === 'none' || s === 'false' || s === '0') return 'undirected';
    if(s === 'mutual' || s === 'both' || s === 'bidirected') return 'mutual';
    // "directed", "true", "1", "forward", or edgedefault="directed" (default)
    return 'directed';
  }
  function parseGraphml(text){
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if(doc.querySelector('parsererror')) throw new Error(I18N.t('err_invalid_graphml'));
    // ---- GraphML keys: one explicit model, then readers ----
    //
    // Everything about <key> is decided once, here, into `keyRoles`. The readers
    // below (data values, <default> values, custom definitions) only consult that
    // model; none of them re-derives a rule. That is deliberate: every defect in
    // this area came from two places computing the same thing slightly
    // differently — most often one verdict applied to several scopes, when a key
    // for="all" genuinely has a different role on each.
    const KEY_SCOPES = ['graph', 'node', 'edge'] as const;
    type KeyScope = typeof KEY_SCOPES[number];
    // What a single declaration means for one scope it applies to.
    //   canonical — written by our exporter, and spelled the way we spell it
    //   alias     — carries one of our field names under another id or spelling,
    //               so its value feeds that field
    //   shadowed  — a name that only collides with a canonical one after case
    //               folding; it must not overwrite that field
    //   definition— the user's own attribute
    //   ignored   — declares nothing we can use
    type KeyRole = 'canonical' | 'alias' | 'shadowed' | 'definition' | 'ignored';
    interface KeyInfo {
      keyId: string;
      /** attr.name exactly as written, empty when the key has none. */
      rawName: string;
      /** GraphML `for`, defaulting to "all" as the spec says. */
      forWhom: string | 'all';
      /** Scope we store a definition under; "all" has no editor equivalent. */
      scope: KeyScope;
      /** Per scope: what this declaration does there. Absent = does not apply. */
      roles: Partial<Record<KeyScope, KeyRole>>;
      /** Id to record for a definition (a de-collided key remembers its own). */
      definitionId: string;
      /** True when this declaration contributes a user definition. */
      isDefinition: boolean;
      type: string;
    }
    const graphEl = doc.querySelector('graphml');
    const keyEls = [...doc.querySelectorAll('key')];
    const graphmlTypes = ['boolean','int','long','float','double','string'];
    const customAttributes: GraphState['customAttributes'] = [];

    // -- Provenance: is this document one of ours? ------------------------------
    // Either it says so (qvge:writer, every export since marks were added), or it
    // carries the bulk of the built-in key block, which every export of ours has
    // always written in full. Deliberately not keyed on xmlns:qvge: that URI names
    // the QVGE format, so a genuine QVGE file may declare it too.
    const declaredOurs = graphEl?.getAttributeNS(QVGE_NS, 'writer') === 'graph-editor-pro';
    // A foreign file can reuse our key ids for unrelated attributes; what it
    // cannot do by accident is pair each id with the attr.name we pair it with.
    const ourKeys = new Set(GRAPHML_BUILTIN_KEYS.map(([keyId, forWhom, attrName]) =>
      `${keyId}|${forWhom}|${String(attrName).toLowerCase()}`));
    const pairOf = (keyId: string, forWhom: string, attrName: string) =>
      `${keyId}|${forWhom}|${attrName.toLowerCase()}`;
    const isOurKey = (keyId: string, forWhom: string, attrName: string) =>
      ourKeys.has(pairOf(keyId, forWhom, attrName));
    // A document written by an earlier build is still ours, but its key block is
    // a subset of the current one — this PR only ever adds keys (main wrote 41, we
    // write 43), so requiring the current count rejected every older export. The
    // bulk of the block is the signal: we always write all of it, a foreign file
    // lists only the handful it uses.
    const matchedBuiltins = keyEls.filter(k =>
      isOurKey(k.getAttribute('id') || '', k.getAttribute('for') || 'all', String(k.getAttribute('attr.name') || ''))
    ).length;
    const documentIsOurs = declaredOurs || matchedBuiltins >= GRAPHML_BUILTIN_KEYS.length / 2;
    // The spelling a canonical key uses for a field on a scope. Read once, so the
    // shadowing rule below cannot drift from the classification.
    const canonicalSpelling = new Map<string, string>();
    for(const k of keyEls){
      const forWhom = k.getAttribute('for') || 'all';
      const rawName = String(k.getAttribute('attr.name') || '');
      if(!isOurKey(k.getAttribute('id') || '', forWhom, rawName)) continue;
      const slot = `${forWhom}|${rawName.toLowerCase()}`;
      if(!canonicalSpelling.has(slot)) canonicalSpelling.set(slot, rawName);
    }
    const appliesTo = (forWhom: string): readonly KeyScope[] =>
      (forWhom === 'all' ? KEY_SCOPES : KEY_SCOPES.filter(s => s === forWhom)) as readonly KeyScope[];

    // -- Classification --------------------------------------------------------
    const keyInfos: KeyInfo[] = keyEls.map(k => {
      const keyId = k.getAttribute('id') || '';
      const rawName = String(k.getAttribute('attr.name') || '') || keyId;
      const name = rawName.toLowerCase();
      const forWhom = k.getAttribute('for') || 'all';
      // The editor models three scopes; a key for "all" is stored under the widest.
      const scope: KeyScope = forWhom === 'all' ? 'graph' : forWhom as KeyScope;
      const type = String(k.getAttribute('attr.type') || 'string').toLowerCase();
      const type2 = graphmlTypes.includes(type) ? type : 'string';
      // Read by namespace URI, not by the literal prefix: a document re-serialised
      // by another tool may bind a different prefix to the same URI.
      const marked = k.getAttributeNS(QVGE_NS, 'kind') === QVGE_CUSTOM_MARKER;
      const recordedId = k.getAttributeNS(QVGE_NS, 'id') || '';
      // The prefix is a *legacy* way of naming a definition, used by the build
      // before marks existed. A marked key's id is literal even when it starts
      // with those characters, which keeps an external `qvge.custom.score`
      // distinct from a definition genuinely called `score`.
      const prefixed = !marked && documentIsOurs && keyId.startsWith(CUSTOM_KEY_PREFIX) && keyId.length > CUSTOM_KEY_PREFIX.length;
      // Membership in the key block is decided by id alone: every export of ours
      // has written definitions under the user's own id, never under one of our
      // key ids, so an id we reserve can only be built-in.
      const isDefinition = marked || prefixed ? true
        : documentIsOurs ? !GRAPHML_BUILTIN_KEY_IDS.has(keyId)
        : !isBuiltinGraphmlKey(name, forWhom);

      const roles: Partial<Record<KeyScope, KeyRole>> = {};
      for(const dataScope of appliesTo(forWhom)){
        if(isDefinition){ roles[dataScope] = 'definition'; continue; }
        if(!name){ roles[dataScope] = 'ignored'; continue; }
        if(isOurKey(keyId, dataScope, rawName)){ roles[dataScope] = 'canonical'; continue; }
        // A name that only collides with a canonical one after case folding must
        // not overwrite it. A differently-spelled alias of the same field
        // (id="k" attr.name="arrow.size") is not a collision: it feeds it.
        const canonical = canonicalSpelling.get(`${dataScope}|${name}`);
        if(canonical !== undefined && canonical !== rawName){ roles[dataScope] = 'shadowed'; continue; }
        if(isBuiltinGraphmlKey(name, dataScope)){ roles[dataScope] = 'alias'; continue; }
        // Nothing here reads it on this scope, and the document is not ours: the
        // key belongs to the user.
        roles[dataScope] = 'definition';
      }
      // A definition is stored once, under the scope its `for` names — but only
      // when the key is not a built-in field on *any* scope it applies to. A
      // for="all" key named `label` is not a graph field, yet it is still a
      // built-in for nodes and edges, so it is an alias rather than a definition.
      const feedsAnyScope = appliesTo(forWhom).some(dataScope =>
        roles[dataScope] === 'canonical' || roles[dataScope] === 'alias');
      const definitionHere = isDefinition || (!feedsAnyScope && roles[scope] === 'definition');
      const definitionId = prefixed ? keyId.slice(CUSTOM_KEY_PREFIX.length)
        : (marked && recordedId ? recordedId : keyId);
      return {keyId, rawName, forWhom, scope, roles, definitionId, isDefinition: definitionHere, type: type2};
    });

    // -- Derived views: the only things the readers touch -----------------------
    // Field name each (key, scope) supplies, or '' when it supplies none. Present
    // but empty means "declared, and deliberately not a built-in field" — the data
    // map must not fall back to the raw key id (`||` used to defeat this).
    const fieldFor: Record<string, string> = {};
    // How strongly a declaration speaks for a field: a canonical one is
    // authoritative, an alias is a fallback. Shadowed, definition and ignored
    // declarations feed no field at all, so they cannot reach either reader.
    const ROLE_STRENGTH: Partial<Record<KeyRole, number>> = {canonical: 0, alias: 1};
    for(const info of keyInfos){
      const name = info.rawName.toLowerCase();
      for(const dataScope of appliesTo(info.forWhom)){
        const role = info.roles[dataScope];
        fieldFor[`${info.keyId}|${dataScope}`] = (role === 'canonical' || role === 'alias') ? name : '';
      }
      if(info.isDefinition && info.keyId && appliesTo(info.forWhom).includes(info.scope)){
        customAttributes.push({id: info.definitionId, name: info.rawName, scope: info.scope, type: info.type});
      }
    }
    // <default> values resolve through fieldFor — the same mapping the data values
    // use — so the two readers cannot disagree about what a key means. Collecting
    // them into a bucket keyed by `for` instead meant a key for "all" wrote to a
    // scope nobody reads, and every role reached the map, so a shadowed spelling
    // (declared later, or not) could replace a canonical default. A definition's
    // default never lands here either, which is what stops a custom `shape` from
    // changing the node default for the whole document.
    const keyDefaultsByFor: Record<string, AnyRecord> = { graph: {}, node: {}, edge: {} };
    const defaultStrength: Record<string, Record<string, number>> = { graph: {}, node: {}, edge: {} };
    for(const dataScope of KEY_SCOPES){
      for(let index = 0; index < keyInfos.length; index++){
        const info = keyInfos[index];
        if(!appliesTo(info.forWhom).includes(dataScope)) continue;
        const field = fieldFor[`${info.keyId}|${dataScope}`];
        if(!field) continue;
        const strength = ROLE_STRENGTH[info.roles[dataScope] as KeyRole];
        if(strength === undefined) continue;
        const defEl = keyEls[index].querySelector('default');
        if(!defEl) continue;
        const held = defaultStrength[dataScope][field];
        // A weaker declaration never displaces a stronger one; among equals the
        // later <key> wins, as it would for data values.
        if(held !== undefined && held < strength) continue;
        keyDefaultsByFor[dataScope][field] = defEl.textContent.trim();
        defaultStrength[dataScope][field] = strength;
      }
    }

    const graph = doc.querySelector('graph');
    const edgeDefaultAttr = graph?.getAttribute('edgedefault') || 'directed';
    const defaultDirected = parseDirection(edgeDefaultAttr);
    // Parse graph-level <data> (may override key defaults)
    const graphData = graphmlDataMap(graph || doc, fieldFor, 'graph');
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

    // ---- Applying declared defaults -------------------------------------------------
    //
    // A <default> is what an element's *unset* property resolves to. Resolving it
    // needs two things this module knows and nothing else does: which field the
    // key feeds (fieldFor, above) and how to parse a value for that field. Every
    // gap between the reader and the field table has been a silent data loss —
    // an edge `label.size` default that no branch read, an edge style default
    // looked up under `stroke.style` while the exporter writes `style`. So the
    // binding is declared once, here, per field; nothing below re-derives it.
    //
    // `coerce` returns undefined when the value is unusable, which leaves the
    // field unset rather than inventing a value.
    interface FieldBinding {
      /** Defaults key this binding fills in (settings.nodeDefaults / .edgeDefaults). */
      target: string;
      coerce: (raw: string) => unknown;
    }
    const num = (raw: string, fallback: number, lo: number, hi: number) => clamp(finite(raw, fallback), lo, hi);
    const colorOf = (raw: string) => parseColor(raw) || undefined;
    const NODE_FIELD_BINDINGS: Record<string, FieldBinding> = {
      'shape': {target: 'shape', coerce: raw => parseShape(raw) || undefined},
      'color': {target: 'color', coerce: colorOf},
      'stroke.color': {target: 'strokeColor', coerce: colorOf},
      'stroke.size': {target: 'strokeSize', coerce: raw => num(raw, 2.2, 0, 20)},
      'stroke.style': {target: 'strokeStyle', coerce: raw => parseStrokeStyle(raw) || undefined},
      'label.color': {target: 'labelColor', coerce: colorOf},
      'label.size': {target: 'labelSize', coerce: raw => num(raw, 13, 4, 72)},
      'label.position': {target: 'labelPosition', coerce: raw => parseLabelPosition(raw) || undefined},
      'width': {target: 'width', coerce: raw => num(raw, 50, 10, 300)},
      'height': {target: 'height', coerce: raw => num(raw, 50, 10, 300)},
    };
    const EDGE_FIELD_BINDINGS: Record<string, FieldBinding> = {
      'color': {target: 'color', coerce: colorOf},
      'label.color': {target: 'labelColor', coerce: colorOf},
      'stroke.size': {target: 'strokeSize', coerce: raw => num(raw, 2.4, 0, 20)},
      // The exporter writes the edge style as attr.name "style"; older files and
      // QVGE use "stroke.style". Both name the same field.
      'stroke.style': {target: 'strokeStyle', coerce: raw => parseStrokeStyle(raw) || undefined},
      'style': {target: 'strokeStyle', coerce: raw => parseStrokeStyle(raw) || undefined},
      'label.size': {target: 'labelSize', coerce: raw => num(raw, 12, 4, 72)},
      'arrow.size': {target: 'arrowSize', coerce: raw => num(raw, DEFAULT_ARROW_SIZE, ARROW_SIZE_MIN, ARROW_SIZE_MAX)},
      'arrowsize': {target: 'arrowSize', coerce: raw => num(raw, DEFAULT_ARROW_SIZE, ARROW_SIZE_MIN, ARROW_SIZE_MAX)},
      'weight': {target: 'weight', coerce: raw => String(raw)},
    };
    // Font names carry a size with them ("Inter,12"), so they are handled once
    // for both scopes rather than duplicated per field table.
    const applyFonts = (defs: AnyRecord, out: AnyRecord, fallbackSize: number) => {
      const raw = defs['label.font'];
      if(!raw) return;
      const f = parseQvgeFont(raw);
      if(!f) return;
      out.labelFont = f.family;
      if(f.size != null) out.labelSize = clamp(finite(f.size, fallbackSize), 4, 72);
    };
    const applyBindings = (defs: AnyRecord, bindings: Record<string, FieldBinding>, fallbackFontSize: number) => {
      const out: AnyRecord = {};
      for(const [field, binding] of Object.entries(bindings)){
        const raw = defs[field];
        if(raw == null) continue;
        const value = binding.coerce(String(raw));
        if(value !== undefined) out[binding.target] = value;
      }
      applyFonts(defs, out, fallbackFontSize);
      return out;
    };

    // Node and edge defaults, applied from the declared bindings above.
    const nodeKeyDefs = keyDefaultsByFor.node || {};
    const nd = applyBindings(nodeKeyDefs, NODE_FIELD_BINDINGS, 13);
    if(Object.keys(nd).length) settings.nodeDefaults = nd;

    const edgeKeyDefs = keyDefaultsByFor.edge || {};
    const ed = applyBindings(edgeKeyDefs, EDGE_FIELD_BINDINGS, 12);
    if(Object.keys(ed).length) settings.edgeDefaults = ed;

    // Store the edge direction default if present
    let edgeDirectionDefault;
    if(edgeKeyDefs.direction) edgeDirectionDefault = parseDirection(edgeKeyDefs.direction);

    const nodes: GraphNode[] = [], idMap = new Map<string, string>();
    doc.querySelectorAll('node').forEach((el,i) => {
      const raw = el.getAttribute('id') || ('n' + (i+1)), id = safeId(raw, 'n'), d = graphmlDataMap(el, fieldFor, 'node');
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
      const d = graphmlDataMap(el, fieldFor, 'edge');
      const directedAttr = el.getAttribute('directed');
      // QVGE: edge direction can come from data "direction" field or the XML attribute
      let dirStr = directedAttr == null ? defaultDirected : parseDirection(directedAttr);
      if(d.direction != null) dirStr = parseDirection(d.direction);
      else if(directedAttr == null && edgeDirectionDefault != null) dirStr = edgeDirectionDefault;
      const edge: GraphEdge = {
        id: safeId(el.getAttribute('id') || ('e' + (i+1)), 'e'), from, to,
        // An edge with no weight of its own takes the document's declared default.
        // Every other visual property resolves through edgeVisual/edgeDefaults at
        // render time, but weight is read directly by the algorithms and the
        // weight display, so it has to be materialised here — this is the only
        // point where the file's declared defaults are still known.
        weight: String(d.weight ?? d.value ?? edgeKeyDefs.weight ?? ''),
        label: String(d.label || d.edgelabel || ''),
        directed: dirStr !== 'undirected' as any,
        direction: dirStr as any,
        type: String(d.type || '')
      };
      const ec = parseColor(d.color || d.edgecolor); if(ec) edge.color = ec;
      if(d.strokesize != null || d['stroke.size'] != null) edge.strokeSize = clamp(finite(d.strokesize ?? d['stroke.size'], 2.4), 0, 20);
      if(d.strokestyle || d['stroke.style'] || d.style) edge.strokeStyle = parseStrokeStyle(d.strokestyle || d['stroke.style'] || d.style);
      if(d.arrowsize != null || d['arrow.size'] != null) edge.arrowSize = clamp(finite(d.arrowsize ?? d['arrow.size'], DEFAULT_ARROW_SIZE), ARROW_SIZE_MIN, ARROW_SIZE_MAX);
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
