/*
 * 00-globals.ts — Constants, DOM handles, default state, and shared mutable state.
 *
 * SAFETY: required DOM elements are resolved through mustEl(), which throws a
 * descriptive error at startup instead of letting the app die later with an
 * opaque "null is not an object" deep inside a render call.
 */
  const NS = 'http://www.w3.org/2000/svg';
  const STORAGE_KEY = 'graph-editor-pro-v2';
  const R = 25;
  const DRAG_LIVE_EDGE_LIMIT = 40;
  const $ = (sel: string, root: Document | Element = document): any => root.querySelector(sel);
  const $$ = (sel: string, root: Document | Element = document): any[] => Array.from(root.querySelectorAll(sel));
  const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
  const esc = (s: unknown): string => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c] as string));

  /** Resolve a required element or fail fast with a clear message. */
  function mustEl<T extends Element>(sel: string): T {
    const el = document.querySelector(sel);
    if(!el) throw new Error(`Graph Editor Pro: required element "${sel}" is missing from the document`);
    return el as T;
  }
  const svg = mustEl<SVGSVGElement>('#graphCanvas');
  const gridRect = mustEl<SVGRectElement>('#gridRect');
  const edgesLayer = mustEl<SVGGElement>('#edgesLayer');
  const nodesLayer = mustEl<SVGGElement>('#nodesLayer');
  const dragLine = mustEl<SVGPathElement>('#dragLine');
  const selectionOverlayLayer = mustEl<SVGGElement>('#selectionOverlayLayer');
  const gridPattern = mustEl<SVGPatternElement>('#gridPattern');

  const NODE_SHAPES: NodeShape[] = ['circle','square','diamond','triangleUp','triangleDown','hexagon'];
  const STROKE_STYLES: StrokeStyle[] = ['solid','dashed','dotted'];
  const LABEL_POSITIONS: LabelPosition[] = ['center','top','bottom','left','right'];
  const LABEL_POLICIES: LabelPolicy[] = ['auto','on','off'];
  const FONT_FAMILIES = ['Inter','ui-sans-serif','ui-serif','ui-monospace','Arial','Helvetica','Times New Roman','Courier New'];

  const defaultState = (): AppState => ({
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
  let state: AppState = defaultState();
  // NOTE: named historyStack (not `history`) to avoid shadowing window.history.
  let historyStack: string[] = [], historyIndex = -1;
  let renderQueued = false, matrixTimer: any = null, saveTimer: any = null, edgeOffsetCache: Map<string, number> | null = null;
  let drag: DragState | null = null, pan: PanState | null = null, edgeDraft: EdgeDraftState | null = null,
      pendingEdgeFrom: string | null = null, pendingNodeTap: any = null, pinch: PinchState | null = null,
      selectDraft: SelectDraftState | null = null, spaceDown = false;
  let viewBoxFrame = false;
  const activePointers = new Map<number, PointerInfo>();
