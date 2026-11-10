type Translation = Readonly<{
  en: string;
  ru: string;
  /** Russian plural forms for a numeric `{n}`: [one, few, many]. */
  ruPlural?: readonly [string, string, string];
}>;
type AnyRecord = Record<string, any>;

type GraphMode = 'select' | 'move' | 'node' | 'edge';
type SelectionTool = 'single' | 'rect' | 'brush' | 'lasso' | 'line' | 'polygon';
type SelectionCombine = 'replace' | 'add' | 'subtract';
type HitTestMode = 'any' | 'center';
type GizmoTool = 'move' | 'rotate' | 'scale' | 'rect';

interface Point {
  x: number;
  y: number;
}

interface ViewBox extends Point {
  w: number;
  h: number;
}

type CustomAttributeValue = string | number | boolean;

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
  /** Values of user-defined customAttributes with scope 'node', keyed by attribute id. */
  custom?: Record<string, CustomAttributeValue>;
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
  /** Values of user-defined customAttributes with scope 'edge', keyed by attribute id. */
  custom?: Record<string, CustomAttributeValue>;
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
  /** `dataKey` (the raw id of the GraphML <key> this definition migrated from) and `dataName` (that key's lowered attr.name) are kept on importer-created definitions so re-appending the same external file re-resolves to the same definition. Copy/paste re-creations carry `dataKey` only, which never collides with a GraphML migration (those always have a non-empty `dataName`). */
  customAttributes: { id: string; scope: 'graph' | 'node' | 'edge'; type: string; dataKey?: string; dataName?: string }[];
  /** Values of user-defined customAttributes with scope 'graph', keyed by attribute id. */
  graphCustom: Record<string, CustomAttributeValue>;
  selected: { type: 'node' | 'edge'; id: string } | null;
  selection: GraphSelection;
  settings: AnyRecord;
  viewBox: ViewBox;
  [key: string]: any;
}

interface I18nService {
  strings: Record<string, Translation>;
  dynamic: Record<string, Translation>;
  nouns: Record<'en' | 'ru', Record<string, readonly string[]>>;
  current: 'en' | 'ru';
  t(key: string, params?: Record<string, unknown>): string;
  plural(count: unknown, forms: readonly string[]): string;
  applyAll(): void;
  toggle(): void;
  load(): void;
}
