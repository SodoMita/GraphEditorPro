  const NS = 'http://www.w3.org/2000/svg';
  const STORAGE_KEY = 'graph-editor-pro-v2';
  const R = 25;
  const DRAG_LIVE_EDGE_LIMIT = 40;
  const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

  /** Return a required DOM element or fail immediately with a useful error. */
  const $ = (selector: string, root: ParentNode = document): any => {
    const element = root.querySelector(selector);
    if(!element) throw new Error(`Required DOM element not found: ${selector}`);
    return element;
  };
  const $$ = (selector: string, root: ParentNode = document): any[] => Array.from(root.querySelectorAll(selector));
  const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
  const esc = (value: unknown): string => String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
  const svg = $('#graphCanvas');
  const gridLayer = $('#gridLayer');
  const gridRect = $('#gridRect');
  const sceneLayer = $('#sceneLayer');
  const edgesLayer = $('#edgesLayer');
  const nodesLayer = $('#nodesLayer');
  const dragLine = $('#dragLine');
  const selectionOverlayLayer = $('#selectionOverlayLayer');
  const gridPattern = $('#gridPattern');

  const NODE_SHAPES = ['circle','square','diamond','triangleUp','triangleDown','hexagon'];
  const STROKE_STYLES = ['solid','dashed','dotted'];
  const LABEL_POSITIONS = ['center','top','bottom','left','right'];
  const LABEL_POLICIES = ['auto','on','off'];
  const FONT_FAMILIES = ['Inter','ui-sans-serif','ui-serif','ui-monospace','Arial','Helvetica','Times New Roman','Courier New'];

  const defaultState = (): GraphState => ({
    title: 'untitled', mode: 'select', selectTool: 'single', selectCombine: 'replace', nextNode: 1, nextEdge: 1,
    nodes: [], edges: [],
    selected: null, selection: {nodes: [], edges: []},
    settings: {
      // Edit-tab node placement (primary for newly added nodes)
      nodeShape:'circle', nodeColor:'#0ea5e9',
      nodeWidth:50, nodeHeight:50,
      nodeStrokeColor:'#e2e8f0', nodeStrokeSize:2.2, nodeStrokeStyle:'solid',
      nodeType:'', nodeLabelColor:'#f8fafc', nodeLabelFont:'Inter', nodeLabelSize:13, nodeLabelPosition:'center',
      // Edit-tab edge defaults (primary for newly added edges)
      directed:true, edgeWeight:'1', edgeLabel:'',
      edgeType:'', edgeColor:'#94a3b8', edgeStrokeSize:2.4, edgeStrokeStyle:'solid',
      edgeLabelColor:'#dbeafe', edgeLabelFont:'Inter', edgeLabelSize:12,
      snap:false, snapX:false, snapY:false, gridSize:40, gridSizeX:40, gridSizeY:40,
      autosave:true, matrixLimit:90, matrixDimension:0, brushDiameter:80,
      inheritDefaults: true,
      noLabel: false, // when true, new nodes are created with empty labels
      // Visible range: filters matrix, edge list, and graph canvas to nodes within [start, end] by order.
      // -1 end means "to last". -1 start means "show all".
      visibleRange: {start: -1, end: -1},
      // Canvas background and grid colors
      canvasBgColor:'#020617', gridMinorColor:'#94a3b8', gridMajorColor:'#94a3b8', gridMinorAlpha:0.105, gridMajorAlpha:0.16,
      graphDefaults: {
        labelsPolicy: 'auto',
        edgeWeightMode: 'number', // 'none' | 'number' | 'color' | 'width'
        edgeWeightMin: 1, edgeWeightMax: 10,
        edgeWeightCorr: 'linear', // 'linear' | 'log' | 'exp' | 'sqrt'
        edgeWidthMin: 1, edgeWidthMax: 8,
        edgeWeightColorLow: '#22d3ee', edgeWeightColorHigh: '#f59e0b'
      },
      nodeDefaults: {
        type:'', color:'#0ea5e9', labelColor:'#f8fafc', labelFont:'Inter', labelSize:13,
        labelPosition:'center', shape:'circle', width:50, height:50,
        strokeColor:'#e2e8f0', strokeSize:2.2, strokeStyle:'solid'
      },
      edgeDefaults: {
        type:'', color:'#94a3b8', labelColor:'#dbeafe', labelFont:'Inter', labelSize:12,
        strokeSize:2.4, strokeStyle:'solid'
      },
      // Per-type style overrides: { 'typeName': { color, shape, width, height, ... }, ... }
      nodeTypeStyles: {},
      edgeTypeStyles: {},
      // Style presets: saved visual styles that can be applied to selection.
      // Each preset: { name, node?: {...style}, edge?: {...style} }
      stylePresets: []
    },
    viewBox: { x:-500, y:-330, w:1000, h:660 }
  });
  let state: GraphState = defaultState();
  let appHistory: string[] = [], appHistoryIndex = -1;
  let renderQueued = false, matrixTimer = null, saveTimer = null, edgeOffsetCache = null;
  let drag = null, pan = null, edgeDraft = null, pendingEdgeFrom = null, pendingNodeTap = null, pinch = null, selectDraft = null, spaceDown = false;
  let viewBoxFrame = false;
  const activePointers = new Map();

  function snapshot(){
    return JSON.stringify({
      title:state.title, mode:state.mode, selectTool:state.selectTool, selectCombine:state.selectCombine, nextNode:state.nextNode, nextEdge:state.nextEdge,
      nodes:state.nodes, edges:state.edges, settings:state.settings, viewBox:state.viewBox,
      // Preserve user focus across undo/redo so editing the same object stays ergonomic
      selected:state.selected, selection:state.selection
    });
  }
  function applySnapshot(raw){
    edgeOffsetCache = null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const data = isRecord(parsed) ? parsed : {};
    const sane = sanitizeState(data);
    // Restore selection if it survives sanitization (nodes/edges still exist)
    const savedSel = data.selected, savedSelection = data.selection;
    state = {...state, ...sane, selected:null, selection:{nodes:[], edges:[]}};
    if(isRecord(savedSel) && isRecord(savedSelection)){
      const nodeIdSet = new Set(state.nodes.map(n => n.id));
      const edgeIdSet = new Set(state.edges.map(e => e.id));
      const validNodes = (Array.isArray(savedSelection.nodes) ? savedSelection.nodes : []).filter(id => nodeIdSet.has(id));
      const validEdges = (Array.isArray(savedSelection.edges) ? savedSelection.edges : []).filter(id => edgeIdSet.has(id));
      state.selection = {nodes: validNodes, edges: validEdges};
      if(savedSel.type === 'node' && nodeIdSet.has(savedSel.id)) state.selected = {type:'node', id:String(savedSel.id)};
      else if(savedSel.type === 'edge' && edgeIdSet.has(savedSel.id)) state.selected = {type:'edge', id:String(savedSel.id)};
      else if(validNodes.length) state.selected = {type:'node', id:validNodes[0]};
      else if(validEdges.length) state.selected = {type:'edge', id:validEdges[0]};
    }
    syncControls();
    queueRender(true, true);
    saveSoon();
  }
  function pushHistory(label='change'){
    edgeOffsetCache = null;
    const snap = snapshot();
    if(appHistory[appHistoryIndex] === snap) return;
    appHistory = appHistory.slice(0, appHistoryIndex + 1);
    appHistory.push(snap);
    if(appHistory.length > 100){ appHistory.shift(); } else { appHistoryIndex++; }
    updateUndoRedo();
    saveSoon();
  }
  function undo(){ if(appHistoryIndex <= 0) return; appHistoryIndex--; applySnapshot(appHistory[appHistoryIndex]); toast(I18N.t('undone')); }
  function redo(){ if(appHistoryIndex >= appHistory.length - 1) return; appHistoryIndex++; applySnapshot(appHistory[appHistoryIndex]); toast(I18N.t('redone')); }
  function updateUndoRedo(){
    $('#btnUndo').disabled = appHistoryIndex <= 0;
    $('#btnRedo').disabled = appHistoryIndex >= appHistory.length - 1;
  }

  function sanitizeState(input: unknown): GraphState {
    const base = defaultState();
    if(!isRecord(input)) return base;
    const source = input;
    const validShape = (value: unknown) => NODE_SHAPES.includes(String(value)) ? String(value) : '';  // '' = unset, falls back to default at render
    const validStroke = (value: unknown) => STROKE_STYLES.includes(String(value)) ? String(value) : '';
    const validLabelPos = (value: unknown) => LABEL_POSITIONS.includes(String(value)) ? String(value) : '';
    const validPolicy = (value: unknown) => LABEL_POLICIES.includes(String(value)) ? String(value) : 'auto';
    const validColor = (value: unknown) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : null;

    const usedNodeIds = new Set<string>();
    const nodeReferences = new Map<string, string>();
    const rawNodes = Array.isArray(source.nodes) ? source.nodes.slice(0, 3000).filter(isRecord) : [];
    const nodes: GraphNode[] = rawNodes.map((n, i) => {
      const rawId = String(n.id || ('n' + (i + 1)));
      const id = uniqueSafeId(rawId, 'n', usedNodeIds);
      // Ambiguous duplicate source IDs deliberately resolve to the first node.
      if(!nodeReferences.has(rawId)) nodeReferences.set(rawId, id);
      const node: GraphNode = {
        id,
        label: String(n.label ?? '').slice(0,80),
        x: finite(n.x, i*35), y: finite(n.y, i*35),
        shape: n.shape ? validShape(n.shape) : '',  // empty = unset
        color: validColor(n.color) || '',            // empty = unset
        type: String(n.type || '').slice(0,40),
        order: clamp(Math.trunc(finite(n.order, i)), 0, 2147483647)
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
    });

    const nodeIds = new Set(nodes.map(node => node.id));
    const usedEdgeIds = new Set<string>();
    const rawEdges = Array.isArray(source.edges) ? source.edges.slice(0, 8000).filter(isRecord) : [];
    const edges: GraphEdge[] = [];
    rawEdges.forEach((e, i) => {
      const from = nodeReferences.get(String(e.from)) || (nodeIds.has(String(e.from)) ? String(e.from) : '');
      const to = nodeReferences.get(String(e.to)) || (nodeIds.has(String(e.to)) ? String(e.to) : '');
      if(!from || !to) return; // Drop dangling edges before they reach render/algorithm code.
      const edge: GraphEdge = {
        id: uniqueSafeId(e.id || ('e' + (i + 1)), 'e', usedEdgeIds),
        from, to,
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
      edges.push(edge);
    });
    const inputSettings = isRecord(source.settings) ? source.settings : {};
    const settings: AnyRecord = {...base.settings, ...inputSettings};
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
    settings.graphDefaults = {
      ...base.settings.graphDefaults,
      ...(isRecord(inputSettings.graphDefaults) ? inputSettings.graphDefaults : {})
    };
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
    settings.nodeDefaults = {
      ...base.settings.nodeDefaults,
      ...(isRecord(inputSettings.nodeDefaults) ? inputSettings.nodeDefaults : {})
    };
    const nd = settings.nodeDefaults;
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
    settings.edgeDefaults = {
      ...base.settings.edgeDefaults,
      ...(isRecord(inputSettings.edgeDefaults) ? inputSettings.edgeDefaults : {})
    };
    const ed = settings.edgeDefaults;
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
    const sanitizeTypeStyle = (ts: unknown, isNode: boolean): AnyRecord | undefined => {
      if(!isRecord(ts)) return undefined;
      const out: AnyRecord = {};
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
    if(isRecord(settings.nodeTypeStyles)){
      const cleaned: AnyRecord = Object.create(null);
      for(const [key, value] of Object.entries(settings.nodeTypeStyles)){
        const style = sanitizeTypeStyle(value, true);
        if(style) cleaned[String(key).slice(0,40)] = style;
      }
      settings.nodeTypeStyles = cleaned;
    } else { settings.nodeTypeStyles = Object.create(null); }
    if(isRecord(settings.edgeTypeStyles)){
      const cleaned: AnyRecord = Object.create(null);
      for(const [key, value] of Object.entries(settings.edgeTypeStyles)){
        const style = sanitizeTypeStyle(value, false);
        if(style) cleaned[String(key).slice(0,40)] = style;
      }
      settings.edgeTypeStyles = cleaned;
    } else { settings.edgeTypeStyles = Object.create(null); }
    const legacyGrid = parseInt(settings.gridSize,10) || 40;
    settings.gridSizeX = clamp(parseInt(settings.gridSizeX,10) || legacyGrid, 5, 300);
    settings.gridSizeY = clamp(parseInt(settings.gridSizeY,10) || legacyGrid, 5, 300);
    settings.gridSize = settings.gridSizeX;
    settings.matrixLimit = clamp(parseInt(settings.matrixLimit,10) || 90, 10, 300);
    settings.matrixDimension = clamp(parseInt(settings.matrixDimension,10) || 0, 0, 300);
    settings.brushDiameter = clamp(parseInt(settings.brushDiameter,10) || 80, 10, 400);
    settings.directed = Boolean(settings.directed); settings.snap = Boolean(settings.snap); settings.snapX = Boolean(settings.snapX); settings.snapY = Boolean(settings.snapY); settings.autosave = settings.autosave !== false;
    // Canvas background and grid colors
    settings.canvasBgColor = validColor(settings.canvasBgColor) || '#020617';
    settings.gridMinorColor = validColor(settings.gridMinorColor) || '#94a3b8';
    settings.gridMajorColor = validColor(settings.gridMajorColor) || '#94a3b8';
    settings.gridMinorAlpha = clamp(finite(settings.gridMinorAlpha, 0.105), 0, 1);
    settings.gridMajorAlpha = clamp(finite(settings.gridMajorAlpha, 0.16), 0, 1);
    // Visible range: sanitize start/end (-1 = unset)
    const visibleRange = isRecord(settings.visibleRange) ? settings.visibleRange : {};
    settings.visibleRange = {
      start: safeRangeEndpoint(visibleRange.start),
      end: safeRangeEndpoint(visibleRange.end)
    };
    // Sanitize style presets
    if(Array.isArray(settings.stylePresets)){
      settings.stylePresets = settings.stylePresets.slice(0, 100).map(p => {
        if(!isRecord(p)) return null;
        const out: AnyRecord = { name: String(p.name || 'preset').slice(0, 40) };
        if(isRecord(p.node)){
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
        if(isRecord(p.edge)){
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
    const vb = isRecord(source.viewBox) ? source.viewBox : base.viewBox;
    const maxN = Math.max(
      ...nodes.map(n => Number((n.id.match(/\d+$/)||[0])[0])),
      finite(source.nextNode,1)-1,
      nodes.length
    );
    const maxE = Math.max(
      ...edges.map(e => Number((e.id.match(/\d+$/)||[0])[0])),
      finite(source.nextEdge,1)-1,
      edges.length
    );
    return {
      ...base,
      title: String(source.title || 'untitled').slice(0,80),
      mode: ['select','move','node','edge'].includes(source.mode) ? source.mode : 'select',
      selectTool: ['single','rect','brush','lasso','line','polygon'].includes(source.selectTool) ? source.selectTool : 'single',
      selectCombine: ['replace','add','subtract'].includes(source.selectCombine) ? source.selectCombine : 'replace',
      selection: {nodes: [], edges: []},
      nextNode: maxN + 1,
      nextEdge: maxE + 1,
      nodes, edges, settings,
      viewBox: { x:finite(vb.x,-500), y:finite(vb.y,-330), w:clamp(finite(vb.w,1000),100,20000), h:clamp(finite(vb.h,660),100,20000) }
    };
  }
  function isRecord(value: unknown): value is AnyRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function finite(value: unknown, fallback: number): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }
  function safeId(value: unknown, prefix: string): string {
    const id = String(value ?? '').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40);
    return id || (prefix + Math.random().toString(36).slice(2,8));
  }
  function uniqueSafeId(value: unknown, prefix: string, used: Set<string>): string {
    const base = String(value ?? '').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40) || prefix;
    let id = base;
    for(let suffix = 2; used.has(id); suffix++){
      const ending = `-${suffix}`;
      id = base.slice(0, Math.max(1, 40 - ending.length)) + ending;
    }
    used.add(id);
    return id;
  }
  function safeRangeEndpoint(value: unknown): number {
    if(value == null || value === '') return -1;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? clamp(parsed, -1, 2147483647) : -1;
  }
  function labelFromNumber(num){
    let n = Math.max(1, Number(num)||1), out = '';
    while(n > 0){ n--; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
    return out;
  }
  function nodeById(id){ return state.nodes.find(n => n.id === id); }
  function edgeById(id){ return state.edges.find(e => e.id === id); }

  // === Visual resolution: merge per-item overrides → type styles → defaults ===
