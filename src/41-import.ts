  function replaceWithImportedGraph(data: any, label = 'graph'){
    // Preserve current graph defaults (Style tab) when importing — only override
    // if the file explicitly carries its own defaults.
    const mergedSettings = {...state.settings, ...(data.settings || {})};
    const sane = sanitizeState({...data, title:data.title || fileBase(), settings: mergedSettings});
    state = {...state, ...sane, selected:null, selection:{nodes:[], edges:[]}};
    historyStack=[snapshot()]; historyIndex=0;
    syncControls(); updateUndoRedo(); fitView(); queueRender(true, true); saveSoon();
    toast(I18N.t('imported', {label: label}));
  }
  function appendImportedGraph(data: any, label = 'graph'){
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
    state.nextNode = Math.max(state.nextNode, counter);
    state.nextEdge = Math.max(state.nextEdge, edgeCounter);
    pushHistory(`append ${label}`);
    queueRender(true, true); saveSoon();
    const msg = discarded > 0
      ? `${label} appended: +${sane.nodes.length} nodes, +${validEdges.length} edges (${discarded} dangling edge${discarded===1?'':'s'} discarded)`
      : `${label} appended: +${sane.nodes.length} nodes, +${validEdges.length} edges`;
    toast(msg);
  }
  function importGraphData(data: any, label: string, append: boolean){
    if(append){ appendImportedGraph(data, label); }
    else { replaceWithImportedGraph(data, label); }
  }
  async function pasteFromClipboard(format){
    try{
      const text = await navigator.clipboard.readText();
      if(!text || !text.trim()){ toast(I18N.t('clipboard_empty')); return; }
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
    return rows;
  }
  function importEdgesCsv(text: string, append: boolean){
    const rows = parseCsv(text);
    if(rows.length < 2){ toast(I18N.t('no_edge_data')); return; }
    const header = rows[0].map(h => h.toLowerCase().trim());
    const idx = name => header.indexOf(name);
    const iId = idx('id'), iFrom = idx('source_id') >= 0 ? idx('source_id') : idx('from'), iTo = idx('target_id') >= 0 ? idx('target_id') : idx('to');
    const iWeight = idx('weight'), iLabel = idx('label'), iDirected = idx('directed'), iType = idx('type');
    const iColor = idx('color'), iStrokeSize = idx('stroke_size'), iStrokeStyle = idx('stroke_style');
    if(iFrom < 0 || iTo < 0){ toast(I18N.t('csv_needs_cols')); return; }
    const labelToId = new Map(state.nodes.map(n => [n.label, n.id]));
    const resolveNode = val => {
      if(!val) return null;
      if(state.nodes.some(n => n.id === val)) return val;
      if(labelToId.has(val)) return labelToId.get(val);
      return null;
    };
    if(!append){ state.edges = []; state.selected = null; state.selection = {nodes:[], edges:[]}; }
    let count = 0;
    for(let r = 1; r < rows.length; r++){
      const row = rows[r]; if(!row.length || (row.length === 1 && !row[0])) continue;
      const from = resolveNode(row[iFrom]); const to = resolveNode(row[iTo]);
      if(!from || !to) continue;
      const e: GraphEdge = {
        id: (iId >= 0 && row[iId]) ? safeId(row[iId], 'e') : 'e' + state.nextEdge,
        from, to,
        weight: iWeight >= 0 ? String(row[iWeight] ?? '').slice(0,50) : '',
        label: (iLabel >= 0 ? row[iLabel] : '') || '',
        directed: iDirected >= 0 ? (row[iDirected] === 'true' || row[iDirected] === '1') : state.settings.directed,
        type: (iType >= 0 ? row[iType] : '') || ''
      };
      if(iColor >= 0 && row[iColor]) e.color = row[iColor];
      if(iStrokeSize >= 0 && row[iStrokeSize]) e.strokeSize = clamp(parseFloat(row[iStrokeSize])||2.4, 0, 20);
      if(iStrokeStyle >= 0 && row[iStrokeStyle]) e.strokeStyle = row[iStrokeStyle];
      // Ensure unique edge ID
      while(state.edges.some(x => x.id === e.id)) e.id = 'e' + state.nextEdge++;
      state.edges.push(e); count++;
    }
    pushHistory('import edges csv'); queueRender(true, true); saveSoon();
    toast(I18N.t('imported_n_edges', {n: count}));
  }
  function importMatrixCsv(text: string, append: boolean){
    const rows = parseCsv(text);
    if(rows.length < 2){ toast(I18N.t('no_matrix_data')); return; }
    const labels = rows[0].slice(1);
    const labelToId = new Map(state.nodes.map(n => [n.label, n.id]));
    if(!append){ state.edges = []; state.selected = null; state.selection = {nodes:[], edges:[]}; }
    let count = 0;
    for(let r = 1; r < rows.length; r++){
      const row = rows[r]; if(!row.length) continue;
      const fromLabel = row[0];
      let fromId = labelToId.get(fromLabel);
      if(!fromId){ fromId = fromLabel; }
      for(let c = 1; c < row.length && c-1 < labels.length; c++){
        const val = (row[c] || '').trim();
        if(!val) continue;
        const toLabel = labels[c-1];
        let toId = labelToId.get(toLabel);
        if(!toId){ toId = toLabel; }
        const weights = val.split(/[;,\n\r]+/).map(v => v.trim()).filter(v => v !== '');
        for(const w of weights){
          state.edges.push({ id:'e' + state.nextEdge++, from: fromId, to: toId, weight: w.slice(0,50), label:'', directed: state.settings.directed, type:'' });
          count++;
        }
      }
    }
    pushHistory('import matrix csv'); queueRender(true, true); saveSoon();
    toast(I18N.t('imported_n_edges', {n: count}));
  }
  function importNodesCsv(text: string, append: boolean){
    const rows = parseCsv(text);
    if(rows.length < 2){ toast(I18N.t('no_node_data')); return; }
    const header = rows[0].map(h => h.toLowerCase().trim());
    const idx = name => header.indexOf(name);
    const iOrder = idx('order'), iId = idx('id'), iLabel = idx('label'), iX = idx('x'), iY = idx('y');
    const iShape = idx('shape'), iColor = idx('color'), iType = idx('type');
    if(!append){ state.nodes = []; state.edges = []; state.selected = null; state.selection = {nodes:[], edges:[]}; }
    let count = 0;
    for(let r = 1; r < rows.length; r++){
      const row = rows[r]; if(!row.length || (row.length === 1 && !row[0])) continue;
      const n = {
        id: (iId >= 0 && row[iId]) ? safeId(row[iId], 'n') : 'n' + state.nextNode,
        label: (iLabel >= 0 ? row[iLabel] : '') || '',
        x: iX >= 0 ? parseFloat(row[iX]) || 0 : 0,
        y: iY >= 0 ? parseFloat(row[iY]) || 0 : 0,
        shape: (iShape >= 0 ? row[iShape] : '') || '',
        color: (iColor >= 0 ? row[iColor] : '') || '',
        type: (iType >= 0 ? row[iType] : '') || '',
        order: iOrder >= 0 ? (parseInt(row[iOrder],10) || state.nodes.length) : state.nodes.length
      };
      while(state.nodes.some(x => x.id === n.id)) n.id = 'n' + state.nextNode++;
      state.nodes.push(n); count++;
    }
    pushHistory('import nodes csv'); queueRender(true, true); saveSoon();
    toast(I18N.t('imported_n_nodes', {n: count}));
  }
  function parseAttrList(text){
    const attrs: Record<string, string> = {};
    if(!text) return attrs;
    const re = /([A-Za-z_][\w.:-]*)\s*=\s*("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,\]\s]+)/g;
    let m;
    while((m = re.exec(text))){
      let v = m[2].trim();
      if((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'")) v = v.slice(1,-1).replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\'/g,"'").replace(/\\\\/g,'\\');
      attrs[m[1].toLowerCase()] = v;
    }
    return attrs;
  }
  function cleanDotToken(t){
    t = String(t || '').trim();
    if((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'")) return t.slice(1,-1).replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\'/g,"'").replace(/\\\\/g,'\\');
    return t;
  }
  function parseDot(text){
    const directedGraph = /\bdigraph\b/i.test(text);
    let body = text.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'').replace(/#.*$/gm,'');
    const open = body.indexOf('{'), close = body.lastIndexOf('}'); if(open >= 0 && close > open) body = body.slice(open+1, close);
    const nodes = new Map<string, any>(), edges: any[] = [];
    const ensureNode = id => { if(!nodes.has(id)) nodes.set(id, {id:safeId(id,'n'), original:id, label:id, x:0, y:0, shape:'circle', color:'#0ea5e9'}); return nodes.get(id); };
    const id = '("(?:\\.|[^"])+"|[A-Za-z0-9_:.\\-]+)';
    const edgeRe = new RegExp(id + '\\s*(--|->)\\s*' + id + '\\s*(?:\\[([^\\]]*)\\])?', 'g');
    let m;
    while((m = edgeRe.exec(body))){
      const fromOrig = cleanDotToken(m[1]), toOrig = cleanDotToken(m[3]), attrs = parseAttrList(m[4] || '');
      const a = ensureNode(fromOrig), b = ensureNode(toOrig);
      const dotWeight = attrs.weight || attrs.label || '';
      edges.push({ id:'e' + (edges.length+1), from:a.id, to:b.id, weight:dotWeight, label:String(attrs.label && attrs.label !== attrs.weight ? attrs.label : ''), directed:m[2] === '->' || attrs.directed === 'true' || directedGraph });
    }
    const withoutEdges = body.replace(edgeRe, '');
    const nodeRe = new RegExp('(?:^|;|\\n)\\s*' + id + '\\s*(?:\\[([^\\]]*)\\])?\\s*(?=;|\\n|$)', 'g');
    while((m = nodeRe.exec(withoutEdges))){
      const name = cleanDotToken(m[1]);
      if(['graph','node','edge'].includes(name.toLowerCase())) continue;
      const attrs = parseAttrList(m[2] || ''), n = ensureNode(name);
      if(attrs.label) n.label = attrs.label;
      if(attrs.fillcolor || attrs.color) n.color = /^#[0-9a-f]{6}$/i.test(attrs.fillcolor || attrs.color) ? (attrs.fillcolor || attrs.color) : n.color;
      if(attrs.shape) n.shape = /diamond/i.test(attrs.shape) ? 'diamond' : /box|square|rect/i.test(attrs.shape) ? 'square' : 'circle';
      if(attrs.pos){ const parts = attrs.pos.replace('!','').split(',').map(Number); if(Number.isFinite(parts[0])) n.x = parts[0]; if(Number.isFinite(parts[1])) n.y = -parts[1]; }
    }
    const arr = [...nodes.values()];
    if(arr.every(n => n.x === 0 && n.y === 0) && arr.length > 1){
      const r = Math.max(120, arr.length * 24);
      arr.forEach((n,i) => { const a=-Math.PI/2+i*2*Math.PI/arr.length; n.x=Math.cos(a)*r; n.y=Math.sin(a)*r; });
    }
    return {title:'imported-dot', nodes:arr.map(({original,...n}) => n), edges};
  }
  function graphmlDataMap(el: Element | Document, keyNames: Record<string, string>): Record<string, string> {
    const map: Record<string, string> = {};
    el.querySelectorAll('data').forEach(d => { const key=d.getAttribute('key') || ''; const name=(keyNames[key] || key).toLowerCase(); map[name] = d.textContent.trim(); });
    return map;
  }
  function parseShape(raw){
    const s = String(raw || '').toLowerCase();
    if(s.includes('disc') || s.includes('disk') || s.includes('circle') || s.includes('ellipse') || s.includes('oval')) return 'circle';
    if(s.includes('diamond')) return 'diamond';
    if(s.includes('square') || s.includes('rect') || s.includes('box')) return 'square';
    if(s.includes('triangleup') || s === 'triangle up' || s === 'triangle-up') return 'triangleUp';
    if(s.includes('triangledown') || s === 'triangle down' || s === 'triangle-down') return 'triangleDown';
    if(s.includes('hexagon') || s.includes('hex')) return 'hexagon';
    if(s.includes('triangle')) return 'triangleUp';
    return '';
  }
  function parseStrokeStyle(raw){
    const s = String(raw || '').toLowerCase();
    if(s.includes('dashdotdot') || s.includes('dash-dot-dot')) return 'dashed'; // approximate
    if(s.includes('dashdot') || s.includes('dash-dot')) return 'dashed';       // approximate
    if(s.includes('dash')) return 'dashed';
    if(s.includes('dot')) return 'dotted';
    if(s.includes('solid')) return 'solid';
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
    if(doc.querySelector('parsererror')) throw new Error('Invalid XML/GraphML');
    // Build keyNames map AND parse <default> values from <key> elements (QVGE format)
    const keyNames = {};
    const keyDefaults = {};  // keyed by attr.name, separated by target
    const keyDefaultsByFor: Record<string, Record<string, string>> = { graph: {}, node: {}, edge: {} };
    doc.querySelectorAll('key').forEach(k => {
      const id = k.getAttribute('id');
      const name = (k.getAttribute('attr.name') || id).toLowerCase();
      const forWhom = k.getAttribute('for') || 'all';
      keyNames[id] = name;
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
    const settings: Record<string, any> = {};
    const gd: Record<string, any> = {};
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
    const nd: Record<string, any> = {};
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
    const ed: Record<string, any> = {};
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
    
    const nodes: any[] = [], idMap = new Map<string, string>();
    doc.querySelectorAll('node').forEach((el,i) => {
      const raw = el.getAttribute('id') || ('n' + (i+1)), id = safeId(raw, 'n'), d = graphmlDataMap(el, keyNames);
      // QVGE: nodes are unlabeled by default. Only use label data if present.
      const label = String(d.label || d.name || '');
      let x = finite(d.x ?? d.posx ?? d['position.x'], 0), y = finite(d.y ?? d.posy ?? d['position.y'], 0);
      const geom = el.querySelector('Geometry, geometry');
      if(geom){ x = finite(geom.getAttribute('x'), x); y = finite(geom.getAttribute('y'), y); }
      const node: Record<string, any> = {
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
    const edges: any[] = [];
    doc.querySelectorAll('edge').forEach((el,i) => {
      const from = idMap.get(el.getAttribute('source')), to = idMap.get(el.getAttribute('target')); if(!from || !to) return;
      const d = graphmlDataMap(el, keyNames);
      const directedAttr = el.getAttribute('directed');
      // QVGE: edge direction can come from data "direction" field or the XML attribute
      let directed = directedAttr == null ? defaultDirected : parseDirection(directedAttr);
      if(d.direction != null) directed = parseDirection(d.direction);
      else if(directedAttr == null && edgeDirectionDefault != null) directed = edgeDirectionDefault;
      const edge: Record<string, any> = {
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
    return {title:'imported-graphml', nodes, edges, settings};
  }
  function importFile(file, forcedFormat='auto'){
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const text = String(reader.result || '');
        const name = (file.name || '').toLowerCase();
        const format = forcedFormat !== 'auto' ? forcedFormat : name.endsWith('.dot') || name.endsWith('.gv') ? 'dot' : name.endsWith('.graphml') || name.endsWith('.xml') ? 'graphml' : name.endsWith('.csv') ? 'csv' : 'json';
        const append = $('#optImportAppend')?.checked;
        if(!append && (state.nodes.length || state.edges.length) && !confirm(I18N.t('replace_with_import'))) return;
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
      } catch(err){ alert(I18N.t('could_not_import', {msg: err.message})); }
    };
    reader.readAsText(file);
  }
