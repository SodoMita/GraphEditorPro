type Translation = Readonly<{ en: string; ru: string }>;
type AnyRecord = Record<string, any>;

type GraphMode = 'select' | 'move' | 'node' | 'edge';
type SelectionTool = 'single' | 'rect' | 'brush' | 'lasso' | 'line' | 'polygon';
type SelectionCombine = 'replace' | 'add' | 'subtract';

interface Point {
  x: number;
  y: number;
}

interface ViewBox extends Point {
  w: number;
  h: number;
}

interface GraphNode extends Point {
  id: string;
  label: string;
  shape?: string;
  color?: string;
  type?: string;
  order?: number;
  width?: number;
  height?: number;
  strokeColor?: string;
  strokeSize?: number;
  strokeStyle?: string;
  labelColor?: string;
  labelSize?: number;
  labelPosition?: string;
  labelFont?: string;
  [key: string]: any;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  directed: boolean;
  type?: string;
  weight?: string;
  color?: string;
  strokeSize?: number;
  strokeStyle?: string;
  labelColor?: string;
  labelSize?: number;
  labelFont?: string;
  [key: string]: any;
}

interface GraphSelection {
  nodes: string[];
  edges: string[];
}

interface GraphState {
  title: string;
  mode: GraphMode;
  selectTool: SelectionTool;
  selectCombine: SelectionCombine;
  nextNode: number;
  nextEdge: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  selected: { type: 'node' | 'edge'; id: string } | null;
  selection: GraphSelection;
  settings: AnyRecord;
  viewBox: ViewBox;
  [key: string]: any;
}

interface I18nService {
  strings: Record<string, Translation>;
  dynamic: Record<string, Translation>;
  current: 'en' | 'ru';
  t(key: string, params?: Record<string, unknown>): string;
  applyAll(): void;
  toggle(): void;
  load(): void;
}

interface Window {
  I18N: I18nService;
}
