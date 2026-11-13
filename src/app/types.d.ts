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
  /** Values of user-defined customAttributes with scope 'edge', keyed by attribute id. */
  custom?: Record<string, CustomAttributeValue>;
  [key: string]: any;
}

interface GraphSelection {
  nodes: string[];
  edges: string[];
}

// Every attr.name the importer reads as a built-in, per scope. A <key> whose
// name is in here feeds one of our fields, so it cannot be a definition.
type GraphmlSchema = { readNames: readonly (readonly [string, string])[] };
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
   *  (e.g. a definition re-created under a fresh id, where the exporter cannot
   *  use the id as the key name). Ids are stable in the editor, so graphs can
   *  match definitions across imports by their own id. */
  /** `origin` is the carried key id a definition was minted from, recorded so re-imports bind to the same property. */
  customAttributes: { id: string; scope: 'graph' | 'node' | 'edge'; type: string; name?: string; origin?: string }[];
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
