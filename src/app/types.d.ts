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

type EdgeDirection = 'directed' | 'mutual' | 'undirected';
interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  directed?: boolean | string; // legacy boolean, now string enum via direction
  direction?: EdgeDirection | string;
  type?: string;
  weight?: string;
  color?: string;
  strokeSize?: number;
  strokeStyle?: string;
  arrowSize?: number;
  labelColor?: string;
  labelSize?: number;
  labelFont?: string;
  [key: string]: any;
}

interface GraphSelection {
  nodes: string[];
  edges: string[];
}

// Every attr.name the importer reads as a built-in, per scope. A <key> whose
// name is in here feeds one of our fields, so it cannot be a definition.
type GraphmlSchema = {
  readNames: readonly (readonly [string, string])[];
  builtinKeys: readonly (readonly string[])[];
};
interface GraphState {
  title: string;
  mode: GraphMode;
  selectTool: SelectionTool;
  selectCombine: SelectionCombine;
  nextNode: number;
  nextEdge: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** `name` carries the original GraphML attr.name when it differs from the id
   *  (a definition migrated away from a now-reserved key id). */
  customAttributes: { id: string; scope: 'graph' | 'node' | 'edge'; type: string; name?: string }[];
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
