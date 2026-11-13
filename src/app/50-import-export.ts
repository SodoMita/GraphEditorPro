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
  // ---- The GraphML field model ------------------------------------------------
  //
  // One table says, for every field this app understands: the attr.name our
  // exporter writes, the alias attr.names other tools use, and how to parse a
  // value. Everything GraphML-related is derived from it — which names are
  // built-in (~so a key is not mistaken for a user definition), which names bind
  // to which field for <data> values and for <default> values, and the parser for
  // each. Adding a field in one place used to mean editing three tables, and they
  // had already drifted: `fillcolor` and `edgecolor` were accepted as <data> but
  // not as <default>, and `labelposition` silently fed neither.
  //
  // `parse` returns undefined for a value it cannot use, leaving the field unset.
  interface GraphmlField {
    /** The property on GraphNode/GraphEdge (or the settings default) this fills. */
    field: string;
    /** attr.name the exporter writes for this field. */
    name: string;
    /** attr.names other tools use for the same field. */
    aliases?: string[];
    /** GraphML attr.type the exporter declares. */
    type?: string;
    /** The exporter's <key> id; defaults to the field name. */
    keyId?: string;
  }
  const num = (raw: unknown, fallback: number, lo: number, hi: number) => clamp(finite(raw, fallback), lo, hi);
  const colorOrUndef = (raw: unknown) => parseColor(raw) || undefined;
  const NODE_FIELDS_MODEL: readonly GraphmlField[] = [
    {field: 'label', name: 'label', aliases: ['name']},
    {field: 'id', name: 'id', keyId: 'nodeId'},
    {field: 'order', name: 'order', type: 'int'},
    {field: 'x', name: 'x', aliases: ['posx', 'position.x'], type: 'double'},
    {field: 'y', name: 'y', aliases: ['posy', 'position.y'], type: 'double'},
    {field: 'type', name: 'type'},
    {field: 'shape', name: 'shape', aliases: ['graphics']},
    {field: 'color', name: 'color', aliases: ['fillcolor', 'bgcolor']},
    {field: 'width', name: 'width', type: 'double'},
    {field: 'height', name: 'height', type: 'double'},
    {field: 'strokeColor', name: 'stroke.color', aliases: ['strokecolor']},
    {field: 'strokeSize', name: 'stroke.size', aliases: ['strokesize'], type: 'double'},
    {field: 'strokeStyle', name: 'stroke.style', aliases: ['strokestyle']},
    {field: 'labelColor', name: 'label.color', aliases: ['labelcolor']},
    {field: 'labelFont', name: 'label.font', aliases: ['labelfont']},
    {field: 'labelSize', name: 'label.size', aliases: ['labelsize'], type: 'double'},
    {field: 'labelPosition', name: 'label.position', aliases: ['labelposition']},
  ];
  const EDGE_FIELDS_MODEL: readonly GraphmlField[] = [
    {field: 'weight', name: 'weight', aliases: ['value']},
    {field: 'label', name: 'label', keyId: 'edgeLabel', aliases: ['edgelabel']},
    {field: 'type', name: 'type', keyId: 'edgeType'},
    {field: 'color', name: 'color', keyId: 'edgeColor', aliases: ['edgecolor']},
    {field: 'strokeSize', name: 'stroke.size', keyId: 'edgeStrokeSize', aliases: ['strokesize'], type: 'double'},
    {field: 'strokeStyle', name: 'style', keyId: 'edgeStrokeStyle', aliases: ['stroke.style', 'strokestyle']},
    {field: 'labelColor', name: 'label.color', keyId: 'edgeLabelColor', aliases: ['labelcolor']},
    {field: 'labelFont', name: 'label.font', keyId: 'edgeLabelFont', aliases: ['labelfont']},
    {field: 'labelSize', name: 'label.size', keyId: 'edgeLabelSize', aliases: ['labelsize'], type: 'double'},
    {field: 'directed', name: 'directed', type: 'boolean'},
    {field: 'direction', name: 'direction'},
    {field: 'arrowSize', name: 'arrow.size', keyId: 'arrowSize', aliases: ['arrowsize'], type: 'double'},
  ];
  const GRAPH_FIELDS_MODEL: readonly GraphmlField[] = [
    {field: 'labelsPolicy', name: 'labels.policy'},
    {field: 'edgeWeightMode', name: 'edge.weight.mode'},
    {field: 'edgeWeightMin', name: 'edge.weight.min', type: 'double'},
    {field: 'edgeWeightMax', name: 'edge.weight.max', type: 'double'},
    {field: 'edgeWeightCorr', name: 'edge.weight.corr'},
    {field: 'edgeWidthMin', name: 'edge.width.min', type: 'double'},
    {field: 'edgeWidthMax', name: 'edge.width.max', type: 'double'},
    {field: 'edgeWeightColorLow', name: 'edge.weight.colorLow'},
    {field: 'edgeWeightColorHigh', name: 'edge.weight.colorHigh'},
    {field: 'canvasBgColor', name: 'canvas.bg.color'},
    {field: 'gridMinorColor', name: 'grid.minor.color'},
    {field: 'gridMajorColor', name: 'grid.major.color'},
    {field: 'gridMinorAlpha', name: 'grid.minor.alpha', type: 'double'},
    {field: 'gridMajorAlpha', name: 'grid.major.alpha', type: 'double'},
  ];
  const FIELDS_BY_SCOPE = {graph: GRAPH_FIELDS_MODEL, node: NODE_FIELDS_MODEL, edge: EDGE_FIELDS_MODEL} as const;
  // attr.name (lowercased) -> field, per scope. Every alias resolves here, so a
  // reader never has to know a second spelling.
  const FIELD_BY_NAME: Record<string, Map<string, GraphmlField>> = {};
  for(const [scope, model] of Object.entries(FIELDS_BY_SCOPE)){
    const map = new Map<string, GraphmlField>();
    for(const entry of model){
      for(const name of [entry.name, ...(entry.aliases || [])]) map.set(name.toLowerCase(), entry);
    }
    FIELD_BY_NAME[scope] = map;
  }
  const fieldForName = (scope: string, name: string) => FIELD_BY_NAME[scope]?.get(String(name).toLowerCase());

  // Every <key> the GraphML exporter writes itself, in emission order. Declared
  // once so the custom-definition filter right below can use the same set of
  // reserved ids instead of a hand-copied list that drifts.
  // Derived from the field model above, so the key block and the readers cannot
  // disagree about what a field is called. Order is the model's order: node,
  // edge, graph, which is the order the exporter has always written.
  const GRAPHML_BUILTIN_KEYS: readonly [string, string, string, string][] =
    (['node', 'edge', 'graph'] as const).flatMap(scope =>
      FIELDS_BY_SCOPE[scope].map(entry => [
        entry.keyId || entry.field,
        scope,
        entry.name,
        entry.type || 'string',
      ] as [string, string, string, string]));

  // The one rule core needs: a key is built-in iff it is one of these. Passed as
  // a thunk so classification cannot depend on module evaluation order.
  // The attr.names the importer below reads as built-in, per scope. Kept next to
  // the data map it mirrors so the two cannot drift apart.
  // Every attr.name (canonical and alias) the importer accepts, per scope —
  // derived from the field model, so a name the reader accepts is always a name
  // the classifier recognises as built-in.
  const GRAPHML_READ_NAMES: readonly (readonly [string, string])[] =
    (['node', 'edge', 'graph'] as const).flatMap(scope =>
      [...FIELD_BY_NAME[scope].keys()].map(readName => [readName, scope] as const));

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
  // The <key id> each definition is exported under.
  //
  // GraphML ids are document-unique, and a definition may legitimately share a
  // name with a built-in field (`arrowSize`, `weight`). The marker is what says
  // "this is a definition"; the id only has to be unique, so one that would
  // collide with a built-in key takes a numbered suffix, and the definition's
  // own id rides along in qvge:id so it round-trips without drifting.
  //
  // Values are written under the same id, so the <key> lines and the
  // <data key="..."> emitters both read from this one map — re-deriving it in
  // two places is how a de-collided definition silently loses its values to a
  // built-in field on every export.
  type CustomDef = GraphState['customAttributes'][number];
  function customExportKeyIds(): Map<CustomDef, string> {
    const builtinIds = GRAPHML_BUILTIN_KEY_IDS;
    const taken = new Set(builtinIds);
    for(const attribute of state.customAttributes) taken.add(attribute.id);
    const emitted = new Set<string>();
    const map = new Map<CustomDef, string>();
    for(const attribute of state.customAttributes){
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
      map.set(attribute, id);
    }
    return map;
  }
  function graphmlCustomKeyLines(keyIds: Map<CustomDef, string>): string[]{
    return state.customAttributes.map(attribute => {
      const id = keyIds.get(attribute)!;
      const attrName = (attribute as AnyRecord).name || attribute.id;
      // The definition's own id, when the exported key id had to differ. Without
      // it a de-collided `arrowSize` would come back as `arrowSize2` and drift.
      const idAttr = id === attribute.id ? '' : ` qvge:id="${xmlEsc(attribute.id)}"`;
      return `  <key id="${xmlEsc(id)}" for="${xmlEsc(attribute.scope)}" attr.name="${xmlEsc(attrName)}" attr.type="${xmlEsc(attribute.type)}" qvge:kind="${QVGE_CUSTOM_MARKER}"${idAttr}/>`;
    });
  }
  function exportGraphmlText(){
    const gd = state.settings.graphDefaults;
    const customKeyIds = customExportKeyIds();
    const lines = [`<?xml version="1.0" encoding="UTF-8"?>`, `<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:qvge="http://qvge.github.io/graphml" qvge:writer="graph-editor-pro" qvge:keys="${GRAPHML_BUILTIN_KEYS.length}">`,
      ...GRAPHML_BUILTIN_KEYS.map(([id, forWhom, attrName, type]) => `  <key id="${id}" for="${forWhom}" attr.name="${attrName}" attr.type="${type}"/>`),
      // Custom definitions come after the built-ins, so a custom id that matches
      // one of them would emit a second <key> with the same id and make every
      // <data key="..."> reference ambiguous. Those keys are emitted under a
      // de-collided id carrying qvge:id back to the definition's own id.
      ...graphmlCustomKeyLines(customKeyIds),
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
    // User-defined custom attribute values (definitions are emitted as <key> above).
    // 'all' definitions apply on every scope and write their values everywhere.
    const customGraphDefs = state.customAttributes.filter(a => defAppliesTo(a, 'graph'));
    const customNodeDefs = state.customAttributes.filter(a => defAppliesTo(a, 'node'));
    const customEdgeDefs = state.customAttributes.filter(a => defAppliesTo(a, 'edge'));
    if(isRecord(state.graphCustom)){
      for(const attr of customGraphDefs){
        if(!Object.prototype.hasOwnProperty.call(state.graphCustom, attr.id)) continue;
        const value = state.graphCustom[attr.id];
        if(value === undefined || value === '') continue;
        lines.push(`    <data key="${xmlEsc(customKeyIds.get(attr)!)}">${xmlEsc(formatCustomValue(value))}</data>`);
      }
    }
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
      if(n.custom){
        for(const attr of customNodeDefs){
          if(!Object.prototype.hasOwnProperty.call(n.custom, attr.id)) continue;
          const value = n.custom[attr.id];
          if(value === undefined || value === '') continue;
          parts.push(`      <data key="${xmlEsc(customKeyIds.get(attr)!)}">${xmlEsc(formatCustomValue(value))}</data>`);
        }
      }
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
      if(e.custom){
        for(const attr of customEdgeDefs){
          if(!Object.prototype.hasOwnProperty.call(e.custom, attr.id)) continue;
          const value = e.custom[attr.id];
          if(value === undefined || value === '') continue;
          parts.push(`      <data key="${xmlEsc(customKeyIds.get(attr)!)}">${xmlEsc(formatCustomValue(value))}</data>`);
        }
      }
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
    // Snapshot the pre-import document FIRST: after a replace, undo must bring
    // the old document back instead of starting from a one-entry history.
    pushHistory('before import ' + label);
    state = {...state, ...sane, selected:null, selection:{nodes:[], edges:[]}};
    pushHistory('import ' + label);
    syncControls(); updateUndoRedo(); fitView(); queueRender(true, true); saveSoon();
    toast(I18N.t('imported', {label: label}));
  }
  // Resolve an element's *unset* visual properties against the defaults of the
  // document it came from.
  //
  // Normally an unset property is resolved at render time by nodeVisual/edgeVisual
  // against state.settings, which is what makes changing a default update every
  // element that inherits it. That works because the element and the defaults live
  // in the same document. Append breaks that: the imported elements join a graph
  // whose settings are deliberately kept, so the imported document's defaults are
  // discarded and its elements would silently inherit the *host* graph's style.
  //
  // Materialising here is the only correct moment — after this the imported
  // document's defaults no longer exist anywhere. Which properties to copy is
  // decided by the fields the element left unset, so nothing is overwritten.
  function materializeDefaults(nodes, edges, settings){
    if(settings?.inheritDefaults === false) return; // not inheriting: nothing to resolve
    const nd = settings?.nodeDefaults || {};
    const ed = settings?.edgeDefaults || {};
    const unset = (value) => value == null || value === '';
    const NODE_FIELDS = ['shape','color','width','height','strokeColor','strokeSize',
      'strokeStyle','labelColor','labelSize','labelPosition','labelFont'];
    const EDGE_FIELDS = ['color','strokeSize','strokeStyle','arrowSize',
      'labelColor','labelSize','labelFont'];
    // The caller has not sanitised yet — that is exactly what it is about to do —
    // so an entry may be null or a non-object. Skip those here and let the
    // sanitizer decide their fate; throwing would reject the whole import,
    // including the entries that are perfectly good.
    const isRecord = value => value != null && typeof value === 'object';
    for(const n of nodes){
      if(!isRecord(n)) continue;
      for(const field of NODE_FIELDS){
        if(unset(n[field]) && nd[field] != null) n[field] = nd[field];
      }
    }
    for(const e of edges){
      if(!isRecord(e)) continue;
      for(const field of EDGE_FIELDS){
        if(unset(e[field]) && ed[field] != null) e[field] = ed[field];
      }
    }
  }
  function appendImportedGraph(data, label='graph'){
    // Append mode: merge imported nodes/edges into the current graph.
    // Keep existing settings (styles, defaults, background, grid colors) unchanged.
    // The imported document's own defaults are not kept, so they have to be
    // resolved onto its elements first — otherwise those elements inherit the host
    // graph's style, and an export then writes the wrong values. Read them from
    // the incoming data, before the settings are replaced.
    materializeDefaults(data.nodes || [], data.edges || [], data.settings || {});
    // Keep the current graph's attribute definitions while still learning the
    // import's: values in the imported file reference the imported definitions,
    // and pruning against the merged set drops nothing legitimate. Document-wide
    // (graph-scope) values merge with the imported ones taking precedence.
    // Imported definitions that fit the remaining capacity are merged; the
    // rest are skipped with a toast. Identity is scope-aware and provenance-
    // aware (see capCustomDefinitions): an identical property merges or
    // reuses for free, a different property sharing the id gets a fresh id
    // here, and same id AND scope with matching provenance — the current
    // definition wins.
    const { defs: cappedDefs, skipped: defsSkipped, renameByPair, renamed } = capCustomDefinitions(data.customAttributes, state.customAttributes);
    if(defsSkipped) toast(I18N.t('attribute_import_skipped', { n: defsSkipped }));
    if(renamed) toast(I18N.t('attribute_scope_renamed', { n: renamed }));
    // Definitions re-created under a fresh id (or reused across an earlier
    // mint) bind their payload's values to the RESOLVED id.
    data = remapImportedCustomValues(data, renameByPair);
    const mergedCustomAttributes = [...state.customAttributes, ...cappedDefs];
    const mergedGraphCustom = { ...(isRecord(state.graphCustom) ? state.graphCustom : {}), ...(isRecord(data.graphCustom) ? data.graphCustom : {}) };
    const sane = sanitizeState({...data, settings: state.settings, customAttributes: mergedCustomAttributes, graphCustom: mergedGraphCustom});
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
    // sanitizeState(merged) is the authoritative definition list: current
    // definitions first (they win on same-id-and-scope conflicts), imported
    // definitions after, with scope-aware renames already applied and values
    // rebound. Assign it wholesale — pushing only the non-cross-scope
    // remainder would keep a pre-rename straggler in the document.
    state.customAttributes = sane.customAttributes;
    if(isRecord(sane.graphCustom)) state.graphCustom = sane.graphCustom;
    state.nextNode = Math.max(state.nextNode, counter);
    state.nextEdge = Math.max(state.nextEdge, edgeCounter);
    // The append path keeps the current settings, but may contribute new
    // definitions — repaint every custom-property surface so the Data tab,
    // the pending-defaults editors and the selection panel show them.
    renderCustomAttributes(); renderSelectionPanel();
    pushHistory(`append ${label}`);
    queueRender(true, true); saveSoon();
    toast(discarded > 0
      ? I18N.t('appended_n_m_discarded', {label, n: sane.nodes.length, m: validEdges.length, d: discarded})
      : I18N.t('appended_n_m', {label, n: sane.nodes.length, m: validEdges.length}));
  }
  // Identity of an imported definition against the current document (and the
  // payload itself), in one pass over the carried list:
  //   1) exact id AND scope match — the current definition wins, the carried
  //      one merges for free (committed contract).
  //   2) provenance reuse — the same property (same recorded attr.name, same
  //      scope) already lives under another id minted by an earlier import.
  //      Rebind the carried values to it. A candidate whose id is a key of
  //      the incoming file is never reused: that key may well be a different
  //      property. Reuse requires both sides to record the same name — an
  //      unnamed definition is never claimed for a foreign property.
  //   3) otherwise the id is free — no existing definition claims it.
  //   4) the id is taken in another scope (or pair) — mint a fresh id, record
  //      the carried id as provenance so the NEXT import resolves here, and
  //      rebind the carried values.
  // Definitions beyond the capacity cap are skipped with a toast. Returns
  // { defs, skipped, renameByPair, renamed }; renameByPair maps
  // 'scope|carriedId' -> resolved id for reused/minted definitions, so the
  // caller remaps the carried payload's values to the resolved id.
  // Remaps the custom-value keys of an IMPORTED payload whose definitions
  // were re-created or reused by capCustomDefinitions: every
  // 'scope|carriedId' entry moves the carried values onto the resolved id.
  // Restricted to the payload — the current document's own values keep their
  // keys. Also remaps new-element defaults carried in the payload's settings,
  // which the replace path merges (append ignores them entirely).
  function remapImportedCustomValues(data, renameByPair){
    if(!renameByPair || !renameByPair.size || !isRecord(data)) return data;
    const remapCustom = (map, scope) => {
      if(!isRecord(map)) return map;
      const out = Object.create(null);
      for(const key of Object.keys(map)){
        // A carried definition may resolve under its own scope or as 'all' —
        // check both, the exact scope first.
        out[renameByPair.get(scope + '|' + key) || renameByPair.get('all|' + key) || key] = map[key];
      }
      return out;
    };
    const remapEntity = (entity, scope) =>
      isRecord(entity) && isRecord(entity.custom) ? { ...entity, custom: remapCustom(entity.custom, scope) } : entity;
    const settings = isRecord(data.settings) ? (() => {
      const s = { ...data.settings };
      if(isRecord(s.nodeCustom)) s.nodeCustom = remapCustom(s.nodeCustom, 'node');
      if(isRecord(s.edgeCustom)) s.edgeCustom = remapCustom(s.edgeCustom, 'edge');
      return s;
    })() : data.settings;
    return { ...data,
      graphCustom: remapCustom(data.graphCustom, 'graph'),
      nodes: (Array.isArray(data.nodes) ? data.nodes : []).map(node => remapEntity(node, 'node')),
      edges: (Array.isArray(data.edges) ? data.edges : []).map(edge => remapEntity(edge, 'edge')),
      settings,
    };
  }
  function capCustomDefinitions(defs, existingDefs){
    const existing = Array.isArray(existingDefs) ? existingDefs : [];
    let budget = Math.max(0, CUSTOM_DEFINITIONS_MAX - existing.length);
    const scopeOf = (a: AnyRecord | null | undefined) => ['graph','node','edge','all'].includes(String(a?.scope)) ? String(a?.scope) : 'node';
    // Provenance agreement for the reuse scan. The recorded attr.name is the
    // property's identity across imports; a missing name on either side means
    // the property cannot be proven different, so it may reuse.
    const provMatch = (ex: AnyRecord | undefined, inc: AnyRecord | undefined) => {
      const en = String(ex?.name ?? '').trim().toLowerCase(), inm = String(inc?.name ?? '').trim().toLowerCase();
      // Reuse only on positive evidence — the same property name recorded on
      // both sides. An unnamed definition is claimed by whoever created it;
      // an incoming property may never guess at it.
      return en !== '' && en === inm;
    };
    // Every id the incoming payload itself uses — a mint may never hand one
    // out to another definition, or a freshly minted id collides with a later
    // incoming definition that was meant to keep it. Reuse candidates whose id
    // is one of those keys are likewise never reused.
    const fileKeys = new Set<string>();
    for(const raw of Array.isArray(defs) ? defs : []){
      if(!isRecord(raw)) continue;
      const carriedId = String(raw.id ?? '').trim().slice(0, 128);
      if(carriedId) fileKeys.add(carriedId);
    }
    const byPair = new Map<string, AnyRecord>();
    const byId = new Set<string>();
    for(const a of existing){ byPair.set(String(a?.id) + '|' + scopeOf(a), a); byId.add(String(a?.id)); }
    // A definition can be claimed at most once per import. Without this, two
    // incoming properties that merely share a recorded name would both reuse
    // the first match — remapping both value maps onto one definition and
    // overwriting one's values with the other's. Claims are tracked by
    // id|scope; the same pair of pools covers the document's definitions and
    // the ones kept earlier in this pass.
    const claimed = new Set<string>();
    const pairOf2 = (id: unknown, scope: unknown) => String(id ?? '') + '|' + String(scope ?? '');
    // Reuse is resolved before capacity accounting — a reuse mints nothing and
    // must never be blocked by a full document.
    const kept = [];
    const renameByPair = new Map<string, string>();
    let skipped = 0, renamed = 0;
    for(const raw of Array.isArray(defs) ? defs : []){
      if(!isRecord(raw)) continue; // unparseable: sanitize drops it too
      const id = String(raw.id ?? '').trim().slice(0, 128);
      if(!id) continue; // no id: sanitize drops it too
      const scope = scopeOf(raw);
      const pairKey = id + '|' + scope;
      let inc: AnyRecord = {...raw, id, scope};
      // 1) Exact id AND scope — the current definition wins when the two
      // definitions cannot be proven different (either side without a recorded
      // name, or matching names): the carried one merges for free. A recorded
      // and DIFFERENT name means a different property sharing the id, so it
      // falls through to minting instead of stranding its values.
      const pairHit = byPair.get(pairKey);
      if(pairHit){
        const pn = String(pairHit?.name ?? '').trim().toLowerCase(), inn = String(inc.name ?? '').trim().toLowerCase();
        if(!pn || !inn || pn === inn) continue; // merges without capacity
      }
      // 2) Provenance reuse — the property already lives under another id.
      // Identity outranks name: a definition created by an earlier import
      // records the carried key id it was minted from (`origin`), and a
      // candidate with the same origin is bound regardless of declaration
      // order — GraphML key ids distinguish properties even when their
      // recorded names match. A candidate whose origin differs from this
      // carried id is a distinct property and is never chosen here. Failing
      // an identity match, the legacy attr.name rule applies as it always
      // has (it merges the same property across sources that share no key
      // identity); a definition claimed by an earlier property in this file
      // is likewise no longer a candidate.
      const identity = [...existing, ...kept].find(e => e && scopeOf(e) === scope
        && !claimed.has(pairOf2(e?.id, scopeOf(e)))
        && !fileKeys.has(String(e?.id))
        && e?.origin && String(e.origin) === id);
      if(identity){
        renameByPair.set(scope + '|' + id, String(identity.id));
        claimed.add(pairOf2(identity.id, scopeOf(identity)));
        continue; // free reuse
      }
      if(inc.name){
        const reused = [...existing, ...kept].find(e => e && scopeOf(e) === scope
          && !claimed.has(pairOf2(e?.id, scopeOf(e)))
          && !fileKeys.has(String(e?.id))
          && provMatch(e, inc));
        if(reused){
          renameByPair.set(scope + '|' + id, String(reused.id));
          claimed.add(pairOf2(reused.id, scopeOf(reused)));
          continue; // free reuse
        }
      }
      // 3)/4) New definition, under the cap.
      if(budget <= 0){ skipped++; continue; }
      budget--;
      let finalId = id;
      if(byId.has(id) || pairHit){
        // The id is taken — in another scope, by a different property with the
        // same id and scope, or in the incoming payload. The carried definition
        // needs its own. The mint may not hand out any id used anywhere in the
        // incoming payload (not just the ones processed so far).
        const taken = new Set(byId);
        for(const a of kept) taken.add(String(a?.id));
        for(const carried of fileKeys) taken.add(carried);
        finalId = uniqueCustomAttributeId(id, taken);
        renameByPair.set(scope + '|' + id, finalId);
        // Record the carried id as the name when there is none — it is the
        // property's identity across imports, and without it the next import
        // of the same file cannot find this definition and mints another.
        if(!inc.name) inc = { ...inc, name: id };
        renamed++;
        byId.add(finalId);
      } else {
        byId.add(id);
      }
      const def = finalId === id ? inc : {...inc, id: finalId};
      // Record the carried key id this definition was minted from — the
      // identity a re-import matches against. The recorded name stays the
      // attr.name for export spelling.
      kept.push({ ...def, origin: id });
      byPair.set(finalId + '|' + scope, def);
      claimed.add(pairOf2(finalId, scope));
    }
    return { defs: kept, skipped, renameByPair, renamed };
  }
  function importGraphData(data: any, label, append){
    // A blank or non-graph input ({}, an empty <graphml>, bare prose as DOT,
    // a truncated file) must never reach the document: replacing with zero
    // nodes destroys it silently. Fail loudly, change nothing.
    if(!isRecord(data)){
      toast(I18N.t('import_failed', { msg: I18N.t('err_empty_graph') }));
      return;
    }
    // The editor's own JSON exports are records with a nodes array — an
    // explicitly empty one is a valid empty document and round-trips.
    if(!Array.isArray(data.nodes)){
      toast(I18N.t('import_failed', { msg: I18N.t('err_empty_graph') }));
      return;
    }
    // A NON-EMPTY nodes array in which not a single entry is a record can
    // only sanitize down to nothing — reject it instead of wiping the
    // document. (sanitizeState keeps exactly the record entries, so this
    // check matches the sanitized outcome without double work.)
    if(data.nodes.length > 0 && !data.nodes.some(isRecord)){
      toast(I18N.t('import_failed', { msg: I18N.t('err_no_valid_nodes') }));
      return;
    }
    // A document with zero nodes can never carry edges: dangling edges are
    // dropped on every path in the app, so the editor's own exports won't
    // have them either. An empty nodes array with a non-empty edge list is
    // input whose edges are all meaningless — reject it instead of wiping
    // the document with a success toast.
    if(data.nodes.length === 0 && Array.isArray(data.edges) && data.edges.length > 0){
      toast(I18N.t('import_failed', { msg: I18N.t('err_empty_graph') }));
      return;
    }
    const graph = data as AnyRecord;
    if(!append && isRecord(graph)){
      const customAttributes = graph.customAttributes;
      if(Array.isArray(customAttributes)){
        const { defs, skipped, renameByPair, renamed } = capCustomDefinitions(customAttributes, []);
        if(skipped) toast(I18N.t('attribute_import_skipped', { n: skipped }));
        if(renamed) toast(I18N.t('attribute_scope_renamed', { n: renamed }));
        // Same rule as append: re-created definitions bind the payload's
        // values to the resolved id — otherwise the values strand on the
        // carried id and are lost.
        const remapped = remapImportedCustomValues(graph, renameByPair);
        graph.graphCustom = remapped.graphCustom;
        graph.nodes = remapped.nodes;
        graph.edges = remapped.edges;
        graph.settings = remapped.settings;
        graph.customAttributes = defs;
      }
    }
    if(append){ appendImportedGraph(graph, label); }
    else { replaceWithImportedGraph(graph, label); }
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
      graphCustom: state.graphCustom,
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
    if(parsed === 0 && !append){ toast(I18N.t('csv_nothing_parsed')); return; }
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
    // A matrix is recognizable for this document only when it is exactly a
    // (possibly all-empty) adjacency matrix of live nodes: every column's
    // endpoint resolves and at least one data row's endpoint resolves. This
    // is the shape of the editor's own export, including its all-empty
    // cells. Anything else — a header with an unknown column, a populated
    // cell forcing a skip — is not this document's matrix; committing zero
    // edges from it would clear the existing ones.
    const resolvableColumns = labels.reduce((n, l) => n + (resolveNode(l) != null ? 1 : 0), 0);
    const initialEdges = append ? state.edges.length : 0;
    const edges: GraphEdge[] = append ? state.edges.slice() : [];
    let parsed = 0, skipped = 0, validRows = 0;
    for(let r = 1; r < rows.length; r++){
      const row = rows[r]; if(!row.length) continue;
      const fromId = resolveNode(row[0]);
      if(!fromId){ if(row.slice(1).some(v => (v || '').trim())) skipped++; continue; }
      // A data row whose endpoint resolves is a recognizable adjacency row —
      // an all-empty one is how the editor exports an edgeless document. It
      // must round-trip in replace mode (zero edges), not be refused.
      validRows++;
      for(let c = 1; c < row.length; c++){
        const val = (row[c] || '').trim();
        if(!val) continue;
        if(c - 1 >= labels.length){
          // A populated cell beyond the header's width: the editor never
          // writes one, and silently ignoring it would let a malformed
          // file commit a zero-edge replace over the existing edges.
          // Count it as skipped like any other unhonorable cell.
          skipped++;
          continue;
        }
        const toId = resolveNode(labels[c-1]);
        if(!toId){ skipped++; continue; }
        const weights = val.split(/[;,\n\r]+/).map(v => v.trim()).filter(v => v !== '');
        if(weights.length === 0){
          // A separator-only cell (";") splits into no weights at all. It
          // was populated and unhonorable — count it, never let it vanish
          // from the accounting (or the empty-graph guard accept it).
          skipped++;
          continue;
        }
        for(const w of weights){
          const dir = normalizeDirection((state.settings as any).direction ?? state.settings.directed);
          edges.push({ id:'e' + (state.nextEdge + parsed), from: fromId, to: toId, weight: w.slice(0,50), label:'', directed: (dir !== 'undirected') as any, direction: dir as any, type:'' });
          parsed++;
        }
      }
    }
    // Commit zero edges only when the file says "empty graph": rows of live
    // nodes over live columns, and no populated byte anywhere that was not
    // honored — every populated cell is parsed into an edge, or counted as
    // skipped (beyond the header width, unknown column, or a separator-only
    // cell that splits into no weights). parsed === 0 with skipped === 0
    // therefore means wholly empty cells: the editor's own edgeless export.
    // Anything else is refused and the document is preserved.
    const recognizable = labels.length > 0 && resolvableColumns === labels.length
      && validRows > 0 && skipped === 0;
    if(parsed === 0 && !append && !recognizable){ toast(I18N.t('csv_nothing_parsed')); return; }
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
    if(parsed === 0){ toast(I18N.t('csv_nothing_parsed')); return; }
    const replacedEdges = append ? 0 : state.edges.length;
    const { droppedNodes } = commitCsvGraph(nodes, append ? state.edges : [], 'import nodes csv');
    csvImportToast(state.nodes.length - initialNodes, droppedNodes, 0, 3000, 'imported_n_nodes');
    if(replacedEdges > 0) toast(I18N.t('csv_nodes_replaced_edges', {n: state.nodes.length, e: replacedEdges}));
  }

  // <data> elements that are DIRECT children of el. querySelectorAll('data')
  // would also match descendants — a node's <data> leaked into the graph map
  // and could overwrite document-wide values.
  function graphmlChildData(el): { key: string, text: string }[] {
    const items: { key: string, text: string }[] = [];
    const root = el && el.nodeType === 9 ? el.documentElement : el; // document → root element
    if(!root || !root.children) return items;
    for(const child of root.children){
      if((child.localName || child.tagName) === 'data'){
        // Verbatim: custom values are user data (' keep me ' is not 'keep me').
        // Numeric and boolean coercion trims for parsing itself; nothing here
        // may trim, or a round-trip silently edits a stored string.
        items.push({ key: child.getAttribute('key') || '', text: child.textContent || '' });
      }
    }
    return items;
  }

  function graphmlDataMapById(el): AnyRecord {
    const map: AnyRecord = Object.create(null);
    for(const { key, text } of graphmlChildData(el)) map[key] = text;
    return map;
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
  function graphmlDataMap(el, fieldFor, forWhom, rankFor = {}): AnyRecord {
    const map: AnyRecord = {};
    // Which declaration currently holds each field, and how strong it is — the
    // same precedence rule the defaults use, for the same reason: `weight` and
    // its alias `value` are one property, so two <data> entries stating it must
    // compete rather than let document order decide.
    const held: Record<string, number> = {};
    for(const d of Array.from(el.children) as Element[]){
      if(d.tagName.toLowerCase() !== 'data') continue;
      const slot = `${d.getAttribute('key') || ''}|${forWhom}`;
      if(!Object.prototype.hasOwnProperty.call(fieldFor, slot)) continue;
      const name = fieldFor[slot];
      if(!name) continue; // declared, but not a built-in field on this scope
      // Keyed by *field*, not by the spelling that carried it: `fillcolor` and
      // `color` are one property, and a map keyed by spelling made them two.
      const entry = fieldForName(forWhom, name);
      const field = entry ? entry.field : name;
      const strength = rankFor[slot] ?? 1;
      if(held[field] !== undefined && held[field] < strength) continue;
      map[field] = d.textContent.trim();
      held[field] = strength;
    }
    return map;
  }
  // "Did the element state a value for any of these fields?" — as opposed to
  // leaving them out. An explicit empty <data/> is a stated value, which is why
  // this asks about presence rather than truthiness.
  function hasAny(record, ...fields){
    return fields.some(field => Object.prototype.hasOwnProperty.call(record, field));
  }
  // How to turn a raw GraphML string into a property value, per field. One table
  // for both readers — <data> on an element and <default> on a key — because they
  // are the same conversion and must not diverge.
  const FIELD_PARSERS: Record<string, (raw: string) => unknown> = {
    'shape': raw => parseShape(raw) || undefined,
    'color': raw => colorOrUndef(raw),
    'strokeColor': raw => colorOrUndef(raw),
    'strokeSize': raw => num(raw, 2.2, 0, 20),
    'strokeStyle': raw => parseStrokeStyle(raw) || undefined,
    'labelColor': raw => colorOrUndef(raw),
    'labelSize': raw => num(raw, 13, 4, 72),
    'labelPosition': raw => parseLabelPosition(raw) || undefined,
    'width': raw => num(raw, 50, 10, 300),
    'height': raw => num(raw, 50, 10, 300),
    // Edge values carry their own fallbacks; one parser serves both scopes
    // because the ranges are the same shape and the defaults only differ where
    // the property has a different natural size.
    'arrowSize': raw => num(raw, DEFAULT_ARROW_SIZE, ARROW_SIZE_MIN, ARROW_SIZE_MAX),
    'weight': raw => String(raw),
    'type': raw => String(raw),
    'direction': raw => parseDirection(raw),
  };
  // Properties that live directly on GraphNode/GraphEdge and take their value
  // verbatim. Kept separate from FIELD_PARSERS because there is nothing to parse.
  const NODE_PASSTHROUGH = ['type'] as const;
  const EDGE_PASSTHROUGH = ['type'] as const;

  // Read a field out of a map built from <data> or from <default>. Both are keyed
  // by *field* (graphmlDataMap resolves the spelling through the model), so this
  // is a plain lookup — and, crucially, a lookup that cannot miss an alias: by
  // the time a value is here, the alias has already been folded into its field.
  // Returns undefined when the element states nothing, so callers can tell
  // "absent" from "present but empty".
  function rawField(record, _scope, field){
    return Object.prototype.hasOwnProperty.call(record, field) ? record[field] : undefined;
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
    const graphmlTypes = ['boolean','int','long','float','double','string'];
    const customAttributes: GraphState['customAttributes'] = [];
    // Ids the incoming payload itself uses — a mint may never hand one out to
    // another definition in this file, or a fresh mint collides with a later
    // key of the file that was meant to keep its id.
    const fileKeyIds = new Set<string>();
    // Definition ids handed out by THIS FILE, claiming exactly once: anything
    // that takes an id takes it through this set (or gets a fresh mint), so
    // one file can never hand the same id to two distinct properties and
    // overwrite the first property's values with the second's.
    const resolvedDefIds = new Set<string>();
    // What this import learned about its own definitions: which raw key id
    // carried each property. Values and key defaults are bound through this,
    // so a re-created definition still collects its <data> values.
    const defBindings: { id: string; scope: 'graph' | 'node' | 'edge' | 'all'; type: string; keyId: string; defaultValue?: CustomAttributeValue }[] = [];
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
      /** Per scope: what this declaration does there. Absent = does not apply. */
      roles: Partial<Record<KeyScope, KeyRole>>;
      /** Id to record for a definition (a de-collided key remembers its own). */
      definitionId: string;
      /** True when this declaration contributes a user definition on some scope. */
      isDefinition: boolean;
      /** True when the declaration is a declared foreign or stamped key — such a
          key defines eagerly, values or not (it IS a property). */
      eager: boolean;
      type: string;
    }
    const graphEl = doc.querySelector('graphml');
    const keyEls = [...doc.querySelectorAll('key')];
    for(const k of keyEls){ const kid = k.getAttribute('id'); if(kid) fileKeyIds.add(kid); }

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

    // Which key ids carry a non-empty <data> on each scope — computed up
    // front because the classification decides per declaration which scopes
    // become definitions. A mixed-role declaration (built-in on one scope,
    // this user's property on another) only defines the scopes that actually
    // hold a value or a default; anything else would be a phantom definition.
    const dataKeyIdsByScope: Record<KeyScope, Set<string>> = { graph: new Set(), node: new Set(), edge: new Set() };
    for(const d of Array.from(doc.querySelectorAll('data'))){
      const parentTag = ((d as Element).parentElement?.tagName || '').toLowerCase();
      const dataScope = parentTag === 'graph' ? 'graph' : parentTag === 'node' ? 'node' : parentTag === 'edge' ? 'edge' : null;
      const keyId = d.getAttribute('key') || '';
      if(dataScope && keyId && (d.textContent || '').trim() !== '') dataKeyIdsByScope[dataScope].add(keyId);
    }
    // -- Classification --------------------------------------------------------
    const keyInfos: KeyInfo[] = keyEls.map(k => {
      const keyId = k.getAttribute('id') || '';
      const rawName = String(k.getAttribute('attr.name') || '') || keyId;
      const name = rawName.toLowerCase();
      const forWhom = k.getAttribute('for') || 'all';
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
      // The definition decision is per scope, never per declaration: a key can
      // be this user's property on one scope and a built-in field on another.
      // A for="all" key named `label` feeds the node and edge label fields, yet
      // the graph has no such field — suppressing the definition because the
      // key feeds built-ins elsewhere silently dropped its graph-level value
      // while the import reported success. Each scope whose role is
      // 'definition' contributes one; scopes feeding a built-in stay built-ins.
      const definitionHere = appliesTo(forWhom).some(dataScope => roles[dataScope] === 'definition');
      const definitionId = prefixed ? keyId.slice(CUSTOM_KEY_PREFIX.length)
        : (marked && recordedId ? recordedId : keyId);
      return {keyId, rawName, forWhom, roles, definitionId, isDefinition: definitionHere, eager: isDefinition, type: type2};
    });

    // -- Derived views: the only things the readers touch -----------------------
    // Field name each (key, scope) supplies, or '' when it supplies none. Present
    // but empty means "declared, and deliberately not a built-in field" — the data
    // map must not fall back to the raw key id (`||` used to defeat this).
    const fieldFor: Record<string, string> = {};
    // Precedence per (key, scope): canonical outranks alias. Used by the <data>
    // reader and the <default> reader alike so the two cannot disagree.
    const fieldRank: Record<string, number> = {};
    for(let index = 0; index < keyInfos.length; index++){
      const info = keyInfos[index];
      const name = info.rawName.toLowerCase();
      for(const dataScope of appliesTo(info.forWhom)){
        const role = info.roles[dataScope];
        fieldFor[`${info.keyId}|${dataScope}`] = (role === 'canonical' || role === 'alias') ? name : '';
        // Precedence has three levels, because two of them genuinely differ:
        //   0 the model's own key, written by our exporter;
        //   1 the model's own *spelling* under someone else's key id;
        //   2 any other alias of the field.
        // Without the middle level `color` and `fillcolor` under foreign ids tie,
        // and the later declaration wins on document order alone — which is how a
        // fillcolor default came to override a color default.
        const entry = (role === 'canonical' || role === 'alias') ? fieldForName(dataScope, name) : undefined;
        fieldRank[`${info.keyId}|${dataScope}`] =
          role === 'canonical' ? 0
          : entry && entry.name.toLowerCase() === name ? 1
          : 2;
      }
      if(info.isDefinition && info.keyId){
        // One declaration defines on every scope its key declares AND reads
        // as the user's property — a mixed-role for="all" key (a foreign
        // `label` key) defines only the scopes that are not built-in; the
        // scopes feeding built-ins stay built-ins. A declaration that
        // defines on every scope collapses to ONE 'all' definition (see
        // below) so GraphML's for="all" round-trips 1:1. Definitions cannot
        // share an id (the load path and the delete semantics key on id
        // alone), so the widest scope in KEY_SCOPES order claims the bare id
        // first and the rest mint afresh; the attr.name is recorded on each
        // so a re-import resolves back to them.
        const defEl = keyEls[index].querySelector('default');
        // Verbatim: a custom default is user data (' padded ' is not 'padded').
        // All-whitespace means unset; anything else is stored as written.
        const defVal = defEl ? (defEl.textContent ?? '') : '';
        const hasDefault = defVal.trim() !== '';
        const defaultValue = hasDefault ? coerceCustomValue(defVal, info.type) : undefined;
        // A declared foreign or stamped key always defines (it declares a
        // property, values or not). A mixed-role key defines only the scopes
        // that carry a value or a default — anything else would be a phantom
        // definition in the Data tab.
        const scopesForDef = KEY_SCOPES.filter(s => {
          if(info.roles[s] !== 'definition') return false;
          if(info.eager) return true;
          return hasDefault || dataKeyIdsByScope[s].has(info.keyId);
        });
        if(scopesForDef.length){
          // Claim the id once per DECLARATION in this file, not per scope: one
          // key's expansion writes the same definitionId for every scope that
          // defines on purpose — the definition merge below (capCustomDefinitions)
          // disambiguates the scopes deterministically (graph keeps the bare id,
          // then node, then edge mint afresh) and remaps the values to the
          // minted ids. A second, different declaration claiming the same id
          // mints afresh here instead of silently overwriting the first.
          let defId = info.definitionId;
          if(resolvedDefIds.has(defId)){
            const taken = new Set(fileKeyIds);
            for(const attribute of customAttributes) taken.add(attribute.id);
            for(const claimed of resolvedDefIds) taken.add(claimed);
            defId = uniqueCustomAttributeId(defId, taken);
          }
          resolvedDefIds.add(defId);
          // A for="all" declaration whose definition applies on every scope
          // mints ONE 'all' definition — GraphML's scope is preserved 1:1,
          // the cap slot is spent once, and values keyed by id still land
          // per scope. A declaration that defines only on some scopes (a
          // mixed-role key, e.g. a foreign `label`) keeps the per-scope
          // definitions: an 'all' definition would surface a custom editor
          // for a name that is built-in on the other scopes.
          if(info.forWhom === 'all' && scopesForDef.length === KEY_SCOPES.length){
            customAttributes.push({id: defId, scope: 'all', type: info.type, name: info.rawName} as GraphState['customAttributes'][number]);
            defBindings.push({id: defId, scope: 'all', type: info.type, keyId: info.keyId, defaultValue});
            continue;
          }
          for(const defScope of scopesForDef){
            // Always record the attr.name as provenance — the import merge needs
            // it to recognise a re-created definition across imports. The load
            // path strips a name that equals the id again, so stored documents
            // stay clean.
            customAttributes.push({id: defId, scope: defScope, type: info.type, name: info.rawName} as GraphState['customAttributes'][number]);
            defBindings.push({id: defId, scope: defScope, type: info.type, keyId: info.keyId, defaultValue});
          }
        }
      }
    }
    // <default> values resolve through fieldFor — the same mapping the data values
    // use — so the two readers cannot disagree about what a key means. Collecting
    // them into a bucket keyed by `for` instead meant a key for "all" wrote to a
    // scope nobody reads, and every role reached the map, so a shadowed spelling
    // (declared later, or not) could replace a canonical default. A definition's
    // default never lands here either, which is what stops a custom `shape` from
    // changing the node default for the whole document.
    // Defaults, keyed by *field* rather than by the attr.name that carried them.
    // Two declarations naming the same field — `color` and its alias `fillcolor` —
    // must compete for one slot, or the second one silently wins on document
    // order alone. Resolving the name to a field first is what makes precedence
    // meaningful; comparing raw names made them look like different properties.
    const keyDefaultsByFor: Record<string, AnyRecord> = { graph: {}, node: {}, edge: {} };
    const defaultStrength: Record<string, Record<string, number>> = { graph: {}, node: {}, edge: {} };
    for(const dataScope of KEY_SCOPES){
      for(let index = 0; index < keyInfos.length; index++){
        const info = keyInfos[index];
        if(!appliesTo(info.forWhom).includes(dataScope)) continue;
        const defEl = keyEls[index].querySelector('default');
        if(!defEl) continue;
        // Which field does this declaration feed here? The same mapping the
        // <data> reader uses, so a name that binds a value also binds a default.
        const name = fieldFor[`${info.keyId}|${dataScope}`];
        if(!name) continue;
        const entry = fieldForName(dataScope, name);
        if(!entry) continue;
        // One precedence scale, shared with the <data> reader — a second copy is
        // how a `fillcolor` default came to outrank a `color` one.
        const strength = fieldRank[`${info.keyId}|${dataScope}`];
        if(strength === undefined) continue;
        const held = defaultStrength[dataScope][entry.field];
        // A weaker declaration never displaces a stronger one; among equals the
        // later <key> wins, as it would for data values.
        if(held !== undefined && held < strength) continue;
        // Keep the spelling that carried the value: a font default carries its
        // own size, and the parser needs the text as written.
        keyDefaultsByFor[dataScope][entry.field] = defEl.textContent.trim();
        defaultStrength[dataScope][entry.field] = strength;
      }
    }

    const graph = doc.querySelector('graph');
    const edgeDefaultAttr = graph?.getAttribute('edgedefault') || 'directed';
    const defaultDirected = parseDirection(edgeDefaultAttr);
    // Parse graph-level <data> (may override key defaults)
    const graphData = graphmlDataMap(graph || doc, fieldFor, 'graph', fieldRank);
    // Graph-scoped custom values: bound through the raw key id, like every
    // other scope, so a re-created definition still collects its values.
    const graphDataById = graphmlDataMapById(graph || doc);
    const graphCustom: AnyRecord = Object.create(null);
    for(const def of defBindings){
      if(def.scope !== 'graph' && def.scope !== 'all') continue;
      const raw = graphDataById[def.keyId];
      if(raw != null && String(raw).trim() !== ''){ graphCustom[def.id] = coerceCustomValue(raw, def.type); }
      else if(def.defaultValue !== undefined){ graphCustom[def.id] = def.defaultValue; }
    }
    const graphKeyDefs = keyDefaultsByFor.graph || {};

    // Build settings from QVGE key defaults + graph data
    const settings: AnyRecord = {};
    const gd: AnyRecord = {};
    // labels.policy — from graph data first, then key default
    const lpRaw = graphData.labelsPolicy ?? graphKeyDefs.labelsPolicy;
    if(lpRaw != null){
      const p = parseLabelsPolicy(lpRaw);
      if(p) gd.labelsPolicy = p;
    }
    // Edge weight visualization settings
    const ewmRaw = graphData.edgeWeightMode ?? graphKeyDefs.edgeWeightMode;
    if(ewmRaw != null && ['none','number','color','width'].includes(String(ewmRaw))) gd.edgeWeightMode = String(ewmRaw);
    const ewMinRaw = graphData.edgeWeightMin ?? graphKeyDefs.edgeWeightMin;
    if(ewMinRaw != null && ewMinRaw !== '') gd.edgeWeightMin = Number(ewMinRaw);
    const ewMaxRaw = graphData.edgeWeightMax ?? graphKeyDefs.edgeWeightMax;
    if(ewMaxRaw != null && ewMaxRaw !== '') gd.edgeWeightMax = Number(ewMaxRaw);
    const ewCorrRaw = graphData.edgeWeightCorr ?? graphKeyDefs.edgeWeightCorr;
    if(ewCorrRaw != null && ['linear','log','exp','sqrt'].includes(String(ewCorrRaw))) gd.edgeWeightCorr = String(ewCorrRaw);
    const ewWMinRaw = graphData.edgeWidthMin ?? graphKeyDefs.edgeWidthMin;
    if(ewWMinRaw != null && ewWMinRaw !== '') gd.edgeWidthMin = Number(ewWMinRaw);
    const ewWMaxRaw = graphData.edgeWidthMax ?? graphKeyDefs.edgeWidthMax;
    if(ewWMaxRaw != null && ewWMaxRaw !== '') gd.edgeWidthMax = Number(ewWMaxRaw);
    const ewCLowRaw = graphData.edgeWeightColorLow ?? graphKeyDefs.edgeWeightColorLow;
    if(ewCLowRaw != null){ const c = parseColor(ewCLowRaw); if(c) gd.edgeWeightColorLow = c; }
    const ewCHighRaw = graphData.edgeWeightColorHigh ?? graphKeyDefs.edgeWeightColorHigh;
    if(ewCHighRaw != null){ const c = parseColor(ewCHighRaw); if(c) gd.edgeWeightColorHigh = c; }
    if(Object.keys(gd).length) settings.graphDefaults = gd;
    // Canvas bg and grid colors — from graph data first, then key defaults
    const cbRaw = graphData.canvasBgColor ?? graphKeyDefs.canvasBgColor;
    if(cbRaw != null) settings.canvasBgColor = String(cbRaw);
    const gmRaw = graphData.gridMinorColor ?? graphKeyDefs.gridMinorColor;
    if(gmRaw != null) settings.gridMinorColor = String(gmRaw);
    const gjRaw = graphData.gridMajorColor ?? graphKeyDefs.gridMajorColor;
    if(gjRaw != null) settings.gridMajorColor = String(gjRaw);
    const gmaRaw = graphData.gridMinorAlpha ?? graphKeyDefs.gridMinorAlpha;
    if(gmaRaw != null) settings.gridMinorAlpha = parseFloat(gmaRaw);
    const gjaRaw = graphData.gridMajorAlpha ?? graphKeyDefs.gridMajorAlpha;
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
    // Default bindings, derived from the field model: a default is simply the
    // same field, parsed the same way. Nothing here lists fields by hand any
    // more, which is what let `fillcolor` and `edgecolor` work as <data> and not
    // as <default>.
    const FIELD_BINDINGS: Record<string, FieldBinding> = {};
    for(const [scope, model] of Object.entries(FIELDS_BY_SCOPE)){
      for(const entry of model){
        const parser = FIELD_PARSERS[entry.field];
        if(!parser) continue; // label/id/order/x/y are handled where elements are built
        // A key's attr.name maps to a field through the model, aliases included.
        FIELD_BINDINGS[`${scope}|${entry.name.toLowerCase()}`] = {target: entry.field, coerce: parser};
        for(const alias of entry.aliases || []){
          FIELD_BINDINGS[`${scope}|${alias.toLowerCase()}`] = {target: entry.field, coerce: parser};
        }
      }
    }
    // Font names carry a size with them ("Inter,12"), so they are handled once
    // for both scopes rather than duplicated per field table.
    // Fonts carry their own size, so they get one extra step beyond the plain
    // bindings — but only one, and it keys off the *field*, so every alias the
    // model declares for it (`label.font`, `labelfont`) arrives here already
    // resolved. Reading a literal attr.name here is what dropped labelfont.
    const applyFonts = (defs: AnyRecord, out: AnyRecord, fallbackSize: number) => {
      const raw = defs.labelFont;
      if(!raw) return;
      const f = parseQvgeFont(raw);
      if(!f) return;
      out.labelFont = f.family;
      if(f.size != null) out.labelSize = clamp(finite(f.size, fallbackSize), 4, 72);
    };
    const applyBindings = (defs: AnyRecord, scope: string, fallbackFontSize: number) => {
      const out: AnyRecord = {};
      for(const [field, raw] of Object.entries(defs)){
        if(raw == null) continue;
        const binding = FIELD_BINDINGS[`${scope}|${String(field).toLowerCase()}`];
        if(!binding) continue;
        const value = binding.coerce(String(raw));
        if(value !== undefined) out[binding.target] = value;
      }
      applyFonts(defs, out, fallbackFontSize);
      return out;
    };

    // Node and edge defaults, applied from the declared bindings above.
    const nodeKeyDefs = keyDefaultsByFor.node || {};
    const nd = applyBindings(nodeKeyDefs, 'node', 13);
    if(Object.keys(nd).length) settings.nodeDefaults = nd;

    const edgeKeyDefs = keyDefaultsByFor.edge || {};
    const ed = applyBindings(edgeKeyDefs, 'edge', 12);
    if(Object.keys(ed).length) settings.edgeDefaults = ed;

    // Store the edge direction default if present
    let edgeDirectionDefault;
    if(edgeKeyDefs.direction) edgeDirectionDefault = parseDirection(edgeKeyDefs.direction);

    const nodes: GraphNode[] = [], idMap = new Map<string, string>();
    doc.querySelectorAll('node').forEach((el,i) => {
      const raw = el.getAttribute('id') || ('n' + (i+1)), id = safeId(raw, 'n'), d = graphmlDataMap(el, fieldFor, 'node', fieldRank), dById = graphmlDataMapById(el);
      // QVGE: nodes are unlabeled by default. Only use label data if present.
      // A <default> is what an *unset* label resolves to. "Unset" means the
      // element carries no label data at all — an explicit empty
      // <data key="l"/> is a stated value and must survive as an empty label,
      // or the file's deliberate blank is replaced by a default it overrode.
      // Hence presence (`in`), not truthiness.
      const rawLabel = rawField(d, 'node', 'label');
      const label = String(rawLabel !== undefined ? rawLabel : (rawField(keyDefaultsByFor.node, 'node', 'label') ?? ''));
      const geom = el.querySelector('Geometry, geometry');
      let x = finite(rawField(d, 'node', 'x'), 0), y = finite(rawField(d, 'node', 'y'), 0);
      if(geom){ x = finite(geom.getAttribute('x'), x); y = finite(geom.getAttribute('y'), y); }
      const node: GraphNode = {
        id, label, x, y,
        // '' means unset: rendering falls back to the type style or the defaults.
        shape: (FIELD_PARSERS.shape(rawField(d, 'node', 'shape') ?? '') as string) || '',
        color: (FIELD_PARSERS.color(rawField(d, 'node', 'color') ?? '') as string) || '',
        // `type` is element data like the label, so it takes its declared default
        // the same way — and must, because the exporter writes the type from the
        // element, so an unresolved default would vanish on export.
        type: String(rawField(d, 'node', 'type') ?? keyDefaultsByFor.node.type ?? '')
      };
      // Every remaining field, by the model: one loop, aliases included, so a
      // field cannot be forgotten the way `labelposition` was.
      for(const entry of NODE_FIELDS_MODEL){
        if(['label', 'id', 'order', 'x', 'y', 'type', 'shape', 'color'].includes(entry.field)) continue;
        const rawValue = rawField(d, 'node', entry.field);
        if(rawValue === undefined || rawValue === null) continue;
        const parsed = FIELD_PARSERS[entry.field]?.(String(rawValue));
        if(parsed !== undefined) (node as AnyRecord)[entry.field] = parsed;
      }
      const nlf = rawField(d, 'node', 'labelFont');
      if(nlf){ const f = parseQvgeFont(nlf); if(f){ node.labelFont = f.family; if(f.size) node.labelSize = f.size; } }
      const nodeCustom: AnyRecord = Object.create(null);
      for(const def of defBindings){
        if(def.scope !== 'node' && def.scope !== 'all') continue;
        const raw = dById[def.keyId];
        if(raw != null && String(raw).trim() !== ''){ nodeCustom[def.id] = coerceCustomValue(raw, def.type); }
        else if(def.defaultValue !== undefined){ nodeCustom[def.id] = def.defaultValue; }
      }
      if(Object.keys(nodeCustom).length) node.custom = nodeCustom;
      nodes.push(node);
      idMap.set(raw, id);
    });
    const edges: GraphEdge[] = [];
    doc.querySelectorAll('edge').forEach((el,i) => {
      const from = idMap.get(el.getAttribute('source')), to = idMap.get(el.getAttribute('target')); if(!from || !to) return;
      const d = graphmlDataMap(el, fieldFor, 'edge', fieldRank), dById = graphmlDataMapById(el);
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
        // Consult the *resolved* defaults, not the raw key names: `value` is an
        // accepted alias for weight, and only the binding table knows that. Reading
        // edgeKeyDefs.weight here would miss a <key attr.name="value"> default.
        // `ed` is the resolved edge defaults, so aliases are already folded in.
        weight: String(rawField(d, 'edge', 'weight') ?? ed.weight ?? ''),
        // Same presence rule as the node label above.
        label: String(rawField(d, 'edge', 'label') ?? rawField(keyDefaultsByFor.edge, 'edge', 'label') ?? ''),
        directed: dirStr !== 'undirected' as any,
        direction: dirStr as any,
        type: String(rawField(d, 'edge', 'type') ?? keyDefaultsByFor.edge.type ?? '')
      };
      // Every remaining edge field, by the model — the same loop as the node
      // reader, so neither scope can quietly omit a field.
      for(const entry of EDGE_FIELDS_MODEL){
        if(['weight', 'label', 'type', 'directed', 'direction'].includes(entry.field)) continue;
        const rawValue = rawField(d, 'edge', entry.field);
        if(rawValue === undefined || rawValue === null) continue;
        const parsed = FIELD_PARSERS[entry.field]?.(String(rawValue));
        if(parsed !== undefined) (edge as AnyRecord)[entry.field] = parsed;
      }
      const elf = rawField(d, 'edge', 'labelFont');
      if(elf){ const f = parseQvgeFont(elf); if(f){ edge.labelFont = f.family; if(f.size) edge.labelSize = f.size; } }
      const edgeCustom: AnyRecord = Object.create(null);
      for(const def of defBindings){
        if(def.scope !== 'edge' && def.scope !== 'all') continue;
        const raw = dById[def.keyId];
        if(raw != null && String(raw).trim() !== ''){ edgeCustom[def.id] = coerceCustomValue(raw, def.type); }
        else if(def.defaultValue !== undefined){ edgeCustom[def.id] = def.defaultValue; }
      }
      if(Object.keys(edgeCustom).length) edge.custom = edgeCustom;
      edges.push(edge);
    });
    if(nodes.every(n => n.x === 0 && n.y === 0) && nodes.length > 1){ const r=Math.max(120,nodes.length*24); nodes.forEach((n,i)=>{const a=-Math.PI/2+i*2*Math.PI/nodes.length; n.x=Math.cos(a)*r; n.y=Math.sin(a)*r;}); }
    if(!graph) return null; // a GraphML file without a <graph> is not a document
    // Zero nodes with any raw <edge> element means every edge dangles (there
    // is no node to reference) — importing would silently discard all of
    // them and wipe the document. Our exports can never produce this shape.
    if(!nodes.length && doc.querySelectorAll('edge').length > 0) return null;
    // Otherwise a zero-node <graph> — bare or carrying graph-scoped defaults /
    // <key> definitions — is a valid empty document and round-trips.
    // QVGE behavior: leave visual properties UNSET when not present in the file.
    // Rendering falls back to graph defaults via nodeVisual()/edgeVisual(), so
    // changing defaults later affects all nodes with unset properties.
    return {title:'imported-graphml', nodes, edges, customAttributes, graphCustom, settings};
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
