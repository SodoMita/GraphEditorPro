  function sanitizeState(input: any): AppState {
    const base = defaultState();
    if(!input || typeof input !== 'object') return base;
    const validShape = (s: any): NodeShape | '' => NODE_SHAPES.includes(s) ? s : '';  // '' = unset, falls back to default at render
    const validStroke = (s: any): StrokeStyle | '' => STROKE_STYLES.includes(s) ? s : '';
    const validLabelPos = (s: any): LabelPosition | '' => LABEL_POSITIONS.includes(s) ? s : '';
    const validPolicy = (s: any): LabelPolicy => LABEL_POLICIES.includes(s) ? s : 'auto';
    const validColor = (c: any): string | null => /^#[0-9a-f]{6}$/i.test(c || '') ? c : null;
    const nodes = Array.isArray(input.nodes) ? input.nodes.slice(0, 3000).map((n,i) => {
      const node: GraphNode = {
        id: safeId(n.id || ('n' + (i+1)), 'n'),
        label: String(n.label ?? '').slice(0,80),
        x: finite(n.x, i*35), y: finite(n.y, i*35),
        shape: n.shape ? validShape(n.shape) : '',  // empty = unset
        color: validColor(n.color) || '',            // empty = unset
        type: String(n.type || '').slice(0,40),
        order: clamp(parseInt(String(n.order), 10) || i, 0, 2147483647)  // unsigned int, used for placement & serialization
      };
      // Optional per-node overrides — only set if present in input
      if(n.width != null) node.width = clamp(finite(n.width, 50), 10, 300);
      if(n.height != null) node.height = clamp(finite(n.height, 50), 10, 300);
      if(n.strokeColor) node.strokeColor = validColor(n.strokeColor) || '';
      if(n.strokeSize != null) node.strokeSize = clamp(finite(n.strokeSize, 2.2), 0, 20);
      if(n.strokeStyle) node.strokeStyle = validStroke(n.strokeStyle);
      if(n.labelColor) node.labelColor = validColor(n.labelColor) || '';
      if(n.labelSize != null) node.labelSize = clamp(finite(n.labelSize, 13), 4, 72);
      if(n.labelPosition) node.labelPosition = validLabelPos(n.labelPosition);
      if(n.labelFont) node.labelFont = String(n.labelFont).slice(0, 60);
      return node;
    }) : [];
    const nodeIds = new Set(nodes.map(n => n.id));
    const edges = Array.isArray(input.edges) ? input.edges.slice(0, 8000).filter(e => nodeIds.has(e.from) && nodeIds.has(e.to)).map((e,i) => {
      const edge: GraphEdge = {
        id: safeId(e.id || ('e' + (i+1)), 'e'),
        from: String(e.from), to: String(e.to),
        label: String(e.label ?? '').slice(0,80),
        directed: Boolean(e.directed),
        type: String(e.type || '').slice(0,40)
      };
      if(e.weight != null && e.weight !== '') edge.weight = String(e.weight).slice(0,50);
      if(e.color) edge.color = validColor(e.color) || '';
      if(e.strokeSize != null) edge.strokeSize = clamp(finite(e.strokeSize, 2.4), 0, 20);
      if(e.strokeStyle) edge.strokeStyle = validStroke(e.strokeStyle);
      if(e.labelColor) edge.labelColor = validColor(e.labelColor) || '';
      if(e.labelSize != null) edge.labelSize = clamp(finite(e.labelSize, 12), 4, 72);
      if(e.labelFont) edge.labelFont = String(e.labelFont).slice(0, 60);
      return edge;
    }) : [];
    const settings: AppSettings = {...base.settings, ...(input.settings || {})};
    // Edit-tab placement values — primary for newly added nodes/edges.
    settings.nodeShape = NODE_SHAPES.includes(settings.nodeShape) ? settings.nodeShape : 'circle';
    settings.nodeColor = validColor(settings.nodeColor) || '#0ea5e9';
    settings.nodeWidth = clamp(finite(settings.nodeWidth, 50), 10, 300);
    settings.nodeHeight = clamp(finite(settings.nodeHeight, 50), 10, 300);
    settings.nodeStrokeColor = validColor(settings.nodeStrokeColor) || '#e2e8f0';
    settings.nodeStrokeSize = clamp(finite(settings.nodeStrokeSize, 2.2), 0, 20);
    settings.nodeStrokeStyle = STROKE_STYLES.includes(settings.nodeStrokeStyle) ? settings.nodeStrokeStyle : 'solid';
    settings.nodeType = String(settings.nodeType || '').slice(0, 40);
    settings.nodeLabelColor = validColor(settings.nodeLabelColor) || '#f8fafc';
    settings.nodeLabelFont = String(settings.nodeLabelFont || 'Inter').slice(0, 60);
    settings.nodeLabelSize = clamp(finite(settings.nodeLabelSize, 13), 4, 72);
    settings.nodeLabelPosition = LABEL_POSITIONS.includes(settings.nodeLabelPosition) ? settings.nodeLabelPosition : 'center';
    settings.edgeType = String(settings.edgeType || '').slice(0, 40);
    settings.edgeColor = validColor(settings.edgeColor) || '#94a3b8';
    settings.edgeStrokeSize = clamp(finite(settings.edgeStrokeSize, 2.4), 0, 20);
    settings.edgeStrokeStyle = STROKE_STYLES.includes(settings.edgeStrokeStyle) ? settings.edgeStrokeStyle : 'solid';
    settings.edgeLabelColor = validColor(settings.edgeLabelColor) || '#dbeafe';
    settings.edgeLabelFont = String(settings.edgeLabelFont || 'Inter').slice(0, 60);
    settings.edgeLabelSize = clamp(finite(settings.edgeLabelSize, 12), 4, 72);
    // Merge nested defaults objects
    settings.graphDefaults = {...base.settings.graphDefaults, ...(settings.graphDefaults || input.settings?.graphDefaults || {})};
    settings.graphDefaults.labelsPolicy = validPolicy(settings.graphDefaults.labelsPolicy);
    // Migrate old showEdgeWeights → edgeWeightMode
    if(settings.graphDefaults.showEdgeWeights != null && !settings.graphDefaults.edgeWeightMode){
      settings.graphDefaults.edgeWeightMode = settings.graphDefaults.showEdgeWeights === false ? 'none' : 'number';
    }
    delete settings.graphDefaults.showEdgeWeights;
    const ewm = ['none','number','color','width'];
    settings.graphDefaults.edgeWeightMode = ewm.includes(settings.graphDefaults.edgeWeightMode) ? settings.graphDefaults.edgeWeightMode : 'number';
    const ewCorr = ['linear','log','exp','sqrt'];
    settings.graphDefaults.edgeWeightCorr = ewCorr.includes(settings.graphDefaults.edgeWeightCorr) ? settings.graphDefaults.edgeWeightCorr : 'linear';
    settings.graphDefaults.edgeWeightMin = finite(settings.graphDefaults.edgeWeightMin, 1);
    settings.graphDefaults.edgeWeightMax = finite(settings.graphDefaults.edgeWeightMax, 10);
    settings.graphDefaults.edgeWidthMin = clamp(finite(settings.graphDefaults.edgeWidthMin, 1), 0.1, 50);
    settings.graphDefaults.edgeWidthMax = clamp(finite(settings.graphDefaults.edgeWidthMax, 8), 0.1, 50);
    settings.graphDefaults.edgeWeightColorLow = validColor(settings.graphDefaults.edgeWeightColorLow) || '#22d3ee';
    settings.graphDefaults.edgeWeightColorHigh = validColor(settings.graphDefaults.edgeWeightColorHigh) || '#f59e0b';
    settings.nodeDefaults = {...base.settings.nodeDefaults, ...(settings.nodeDefaults || input.settings?.nodeDefaults || {})};
    const nd: any = settings.nodeDefaults;
    nd.shape = NODE_SHAPES.includes(nd.shape) ? nd.shape : 'circle';
    nd.color = validColor(nd.color) || '#0ea5e9';
    nd.labelColor = validColor(nd.labelColor) || '#f8fafc';
    nd.labelPosition = validLabelPos(nd.labelPosition) || 'center';
    nd.strokeStyle = validStroke(nd.strokeStyle) || 'solid';
    nd.strokeColor = validColor(nd.strokeColor) || '#e2e8f0';
    nd.width = clamp(finite(nd.width, 50), 10, 300);
    nd.height = clamp(finite(nd.height, 50), 10, 300);
    nd.strokeSize = clamp(finite(nd.strokeSize, 2.2), 0, 20);
    nd.labelSize = clamp(finite(nd.labelSize, 13), 4, 72);
    nd.labelFont = String(nd.labelFont || 'Inter').slice(0, 60);
    nd.type = String(nd.type || '').slice(0, 40);
    settings.edgeDefaults = {...base.settings.edgeDefaults, ...(settings.edgeDefaults || input.settings?.edgeDefaults || {})};
    const ed: any = settings.edgeDefaults;
    ed.color = validColor(ed.color) || '#94a3b8';
    ed.labelColor = validColor(ed.labelColor) || '#dbeafe';
    ed.strokeStyle = validStroke(ed.strokeStyle) || 'solid';
    ed.strokeSize = clamp(finite(ed.strokeSize, 2.4), 0, 20);
    ed.labelSize = clamp(finite(ed.labelSize, 12), 4, 72);
    ed.labelFont = String(ed.labelFont || 'Inter').slice(0, 60);
    ed.type = String(ed.type || '').slice(0, 40);
    settings.inheritDefaults = settings.inheritDefaults !== false; // default true
    settings.noLabel = Boolean(settings.noLabel);
    // Sanitize type style maps
    const sanitizeTypeStyle = (ts: any, isNode: boolean): Record<string, unknown> | undefined => {
      if(!ts || typeof ts !== 'object') return undefined;
      const out: Record<string, any> = {};
      if(validColor(ts.color)) out.color = ts.color;
      if(isNode){
        if(ts.shape && NODE_SHAPES.includes(ts.shape)) out.shape = ts.shape;
        if(ts.width != null) out.width = clamp(finite(ts.width, 50), 10, 300);
        if(ts.height != null) out.height = clamp(finite(ts.height, 50), 10, 300);
        if(validColor(ts.strokeColor)) out.strokeColor = ts.strokeColor;
        if(ts.strokeSize != null) out.strokeSize = clamp(finite(ts.strokeSize, 2.2), 0, 20);
        if(ts.strokeStyle && STROKE_STYLES.includes(ts.strokeStyle)) out.strokeStyle = ts.strokeStyle;
        if(validColor(ts.labelColor)) out.labelColor = ts.labelColor;
        if(ts.labelSize != null) out.labelSize = clamp(finite(ts.labelSize, 13), 4, 72);
        if(ts.labelPosition && LABEL_POSITIONS.includes(ts.labelPosition)) out.labelPosition = ts.labelPosition;
        if(ts.labelFont) out.labelFont = String(ts.labelFont).slice(0, 60);
      } else {
        if(ts.strokeSize != null) out.strokeSize = clamp(finite(ts.strokeSize, 2.4), 0, 20);
        if(ts.strokeStyle && STROKE_STYLES.includes(ts.strokeStyle)) out.strokeStyle = ts.strokeStyle;
        if(validColor(ts.labelColor)) out.labelColor = ts.labelColor;
        if(ts.labelSize != null) out.labelSize = clamp(finite(ts.labelSize, 12), 4, 72);
        if(ts.labelFont) out.labelFont = String(ts.labelFont).slice(0, 60);
      }
      return Object.keys(out).length ? out : undefined;
    };
    if(settings.nodeTypeStyles && typeof settings.nodeTypeStyles === 'object'){
      const cleaned: Record<string, any> = {};
      for(const [k, v] of Object.entries(settings.nodeTypeStyles)){
        const s = sanitizeTypeStyle(v, true);
        if(s) cleaned[String(k).slice(0,40)] = s;
      }
      settings.nodeTypeStyles = cleaned;
    } else { settings.nodeTypeStyles = {}; }
    if(settings.edgeTypeStyles && typeof settings.edgeTypeStyles === 'object'){
      const cleaned: Record<string, any> = {};
      for(const [k, v] of Object.entries(settings.edgeTypeStyles)){
        const s = sanitizeTypeStyle(v, false);
        if(s) cleaned[String(k).slice(0,40)] = s;
      }
      settings.edgeTypeStyles = cleaned;
    } else { settings.edgeTypeStyles = {}; }
    const legacyGrid = parseInt(String(settings.gridSize),10) || 40;
    settings.gridSizeX = clamp(parseInt(String(settings.gridSizeX),10) || legacyGrid, 5, 300);
    settings.gridSizeY = clamp(parseInt(String(settings.gridSizeY),10) || legacyGrid, 5, 300);
    settings.gridSize = settings.gridSizeX;
    settings.matrixLimit = clamp(parseInt(String(settings.matrixLimit),10) || 90, 10, 300);
    settings.matrixDimension = clamp(parseInt(String(settings.matrixDimension),10) || 0, 0, 300);
    settings.brushDiameter = clamp(parseInt(String(settings.brushDiameter),10) || 80, 10, 400);
    settings.directed = Boolean(settings.directed); settings.snap = Boolean(settings.snap); settings.snapX = Boolean(settings.snapX); settings.snapY = Boolean(settings.snapY); settings.autosave = settings.autosave !== false;
    // Canvas background and grid colors
    settings.canvasBgColor = validColor(settings.canvasBgColor) || '#020617';
    settings.gridMinorColor = validColor(settings.gridMinorColor) || '#94a3b8';
    settings.gridMajorColor = validColor(settings.gridMajorColor) || '#94a3b8';
    settings.gridMinorAlpha = clamp(finite(settings.gridMinorAlpha, 0.105), 0, 1);
    settings.gridMajorAlpha = clamp(finite(settings.gridMajorAlpha, 0.16), 0, 1);
    // Visible range: sanitize start/end (-1 = unset)
    const vr: any = settings.visibleRange || {};
    settings.visibleRange = {
      start: vr.start != null && vr.start !== '' ? clamp(parseInt(vr.start, 10), -1, 2147483647) : -1,
      end: vr.end != null && vr.end !== '' ? clamp(parseInt(vr.end, 10), -1, 2147483647) : -1
    };
    // Sanitize style presets
    if(Array.isArray(settings.stylePresets)){
      settings.stylePresets = settings.stylePresets.slice(0, 100).map((p: any) => {
        if(!p || typeof p !== 'object') return null;
        const out: { name: string; node?: Record<string, any>; edge?: Record<string, any> } = { name: String(p.name || 'preset').slice(0, 40) };
        if(p.node && typeof p.node === 'object'){
          out.node = {};
          const sn = p.node;
          if(sn.shape && NODE_SHAPES.includes(sn.shape)) out.node.shape = sn.shape;
          if(validColor(sn.color)) out.node.color = sn.color;
          if(sn.width != null) out.node.width = clamp(finite(sn.width, 50), 10, 300);
          if(sn.height != null) out.node.height = clamp(finite(sn.height, 50), 10, 300);
          if(validColor(sn.strokeColor)) out.node.strokeColor = sn.strokeColor;
          if(sn.strokeSize != null) out.node.strokeSize = clamp(finite(sn.strokeSize, 2.2), 0, 20);
          if(sn.strokeStyle && STROKE_STYLES.includes(sn.strokeStyle)) out.node.strokeStyle = sn.strokeStyle;
          if(validColor(sn.labelColor)) out.node.labelColor = sn.labelColor;
          if(sn.labelSize != null) out.node.labelSize = clamp(finite(sn.labelSize, 13), 4, 72);
          if(sn.labelPosition && LABEL_POSITIONS.includes(sn.labelPosition)) out.node.labelPosition = sn.labelPosition;
          if(sn.labelFont) out.node.labelFont = String(sn.labelFont).slice(0, 60);
        }
        if(p.edge && typeof p.edge === 'object'){
          out.edge = {};
          const se = p.edge;
          if(validColor(se.color)) out.edge.color = se.color;
          if(se.strokeSize != null) out.edge.strokeSize = clamp(finite(se.strokeSize, 2.4), 0, 20);
          if(se.strokeStyle && STROKE_STYLES.includes(se.strokeStyle)) out.edge.strokeStyle = se.strokeStyle;
          if(validColor(se.labelColor)) out.edge.labelColor = se.labelColor;
          if(se.labelSize != null) out.edge.labelSize = clamp(finite(se.labelSize, 12), 4, 72);
          if(se.labelFont) out.edge.labelFont = String(se.labelFont).slice(0, 60);
        }
        return out;
      }).filter(Boolean);
    } else { settings.stylePresets = []; }
    const vb = input.viewBox || base.viewBox;
    const maxN = Math.max(
      ...nodes.map(n => Number((n.id.match(/\d+$/)||[0])[0])),
      finite(input.nextNode,1)-1,
      nodes.length
    );
    const maxE = Math.max(
      ...edges.map(e => Number((e.id.match(/\d+$/)||[0])[0])),
      finite(input.nextEdge,1)-1,
      edges.length
    );
    return {
      ...base,
      title: String(input.title || 'untitled').slice(0,80),
      mode: ['select','move','node','edge'].includes(input.mode) ? input.mode : 'select',
      selectTool: ['single','rect','brush','lasso','line','polygon'].includes(input.selectTool) ? input.selectTool : 'single',
      selectCombine: ['replace','add','subtract'].includes(input.selectCombine) ? input.selectCombine : 'replace',
      selection: {nodes: [], edges: []},
      nextNode: maxN + 1,
      nextEdge: maxE + 1,
      nodes, edges, settings,
      viewBox: { x:finite(vb.x,-500), y:finite(vb.y,-330), w:clamp(finite(vb.w,1000),100,20000), h:clamp(finite(vb.h,660),100,20000) }
    };
  }
  function finite(v, fallback){ v = Number(v); return Number.isFinite(v) ? v : fallback; }
  function safeId(id, prefix){ id = String(id).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40); return id || (prefix + Math.random().toString(36).slice(2,8)); }
  function labelFromNumber(num){
    let n = Math.max(1, Number(num)||1), out = '';
    while(n > 0){ n--; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
    return out;
  }
  function nodeById(id){ return state.nodes.find(n => n.id === id); }
  function edgeById(id){ return state.edges.find(e => e.id === id); }

