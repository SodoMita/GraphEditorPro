/*
 * Shared type definitions for Graph Editor Pro.
 *
 * All src/*.ts files are compiled as plain scripts (no import/export) and
 * concatenated into a single IIFE by scripts/build.mjs, so every declaration
 * in this file is visible to every other source file at compile time while
 * emitting zero runtime code.
 */

type NodeShape = 'circle' | 'square' | 'diamond' | 'triangleUp' | 'triangleDown' | 'hexagon';
type StrokeStyle = 'solid' | 'dashed' | 'dotted';
type LabelPosition = 'center' | 'top' | 'bottom' | 'left' | 'right';
type LabelPolicy = 'auto' | 'on' | 'off';
type EditorMode = 'select' | 'move' | 'node' | 'edge';
type SelectTool = 'single' | 'rect' | 'brush' | 'lasso' | 'line' | 'polygon' | 'adjacent' | 'directedAdjacent';
type SelectCombine = 'replace' | 'add' | 'subtract';

interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  order?: number;
  type?: string;
  /* Visual overrides: empty string means "unset — inherit type style / defaults". */
  shape?: NodeShape | '';
  color?: string;
  width?: number;
  height?: number;
  strokeColor?: string;
  strokeSize?: number;
  strokeStyle?: StrokeStyle | '';
  labelColor?: string;
  labelFont?: string;
  labelSize?: number;
  labelPosition?: LabelPosition | '';
  /** Per-item extras kept permissive: import formats may attach metadata. */
  [key: string]: unknown;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  directed?: boolean;
  weight?: string | number;
  label?: string;
  type?: string;
  color?: string;
  strokeSize?: number;
  strokeStyle?: StrokeStyle | '';
  labelColor?: string;
  labelFont?: string;
  labelSize?: number;
  [key: string]: unknown;
}

interface ViewBox { x: number; y: number; w: number; h: number; }

interface SelectionState { nodes: string[]; edges: string[]; }

interface SelectedRef { type: 'node' | 'edge'; id: string; }

interface GraphDefaults {
  labelsPolicy: LabelPolicy;
  edgeWeightMode: 'none' | 'number' | 'color' | 'width';
  edgeWeightMin: number;
  edgeWeightMax: number;
  edgeWeightCorr: 'linear' | 'log' | 'exp' | 'sqrt';
  edgeWidthMin: number;
  edgeWidthMax: number;
  edgeWeightColorLow: string;
  edgeWeightColorHigh: string;
  [key: string]: unknown;
}

interface AppSettings {
  nodeShape: NodeShape;
  nodeColor: string;
  nodeWidth: number;
  nodeHeight: number;
  nodeStrokeColor: string;
  nodeStrokeSize: number;
  nodeStrokeStyle: StrokeStyle;
  nodeType: string;
  nodeLabelColor: string;
  nodeLabelFont: string;
  nodeLabelSize: number;
  nodeLabelPosition: LabelPosition;
  directed: boolean;
  edgeWeight: string;
  edgeLabel: string;
  edgeType: string;
  edgeColor: string;
  edgeStrokeSize: number;
  edgeStrokeStyle: StrokeStyle;
  edgeLabelColor: string;
  edgeLabelFont: string;
  edgeLabelSize: number;
  snap: boolean;
  snapX: boolean;
  snapY: boolean;
  gridSize: number;
  gridSizeX: number;
  gridSizeY: number;
  autosave: boolean;
  matrixLimit: number;
  matrixDimension: number;
  brushDiameter: number;
  inheritDefaults: boolean;
  noLabel: boolean;
  visibleRange: { start: number; end: number };
  canvasBgColor: string;
  gridMinorColor: string;
  gridMajorColor: string;
  gridMinorAlpha: number;
  gridMajorAlpha: number;
  graphDefaults: GraphDefaults;
  nodeDefaults: Record<string, unknown>;
  edgeDefaults: Record<string, unknown>;
  nodeTypeStyles: Record<string, Record<string, unknown>>;
  edgeTypeStyles: Record<string, Record<string, unknown>>;
  stylePresets: Array<{ name: string; node?: Record<string, any>; edge?: Record<string, any> }>;
  [key: string]: unknown;
}

interface AppState {
  title: string;
  mode: EditorMode;
  selectTool: SelectTool;
  selectCombine: SelectCombine;
  nextNode: number;
  nextEdge: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  selected: SelectedRef | null;
  selection: SelectionState;
  settings: AppSettings;
  viewBox: ViewBox;
}

/** Transient interaction states — permissive because they are ad-hoc bags of drag data. */
interface DragState { [key: string]: any; }
interface PanState { [key: string]: any; }
interface PinchState { [key: string]: any; }
interface EdgeDraftState { [key: string]: any; }
interface SelectDraftState { [key: string]: any; }
interface PointerInfo { id: number; type: string; clientX: number; clientY: number; }
interface MatrixEditCell { [key: string]: any; }

interface I18nEntry { en: string; ru: string; }

interface I18nApi {
  strings: Record<string, I18nEntry>;
  current: string;
  t(key: string, params?: Record<string, string | number>): string;
  applyAll(): void;
  toggle(): void;
  load(): void;
  [key: string]: any;
}

interface Window { I18N: I18nApi; }
declare var I18N: I18nApi;
