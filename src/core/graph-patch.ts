// DOM-free graph change application.
//
// This is the reusable part of the "paste in place" feature. It knows nothing
// about the clipboard, localStorage, the DOM, history, selection or toasts:
// callers supply a graph-shaped target and a patch, and receive a change
// report. Clipboard paste, file import and future server updates can all use
// the same semantics: carry only supplied fields, reuse carried ids, keep
// unrelated data, respect document caps and leave counters safe.

type AnyRecord = Record<string, any>;

type GraphPatchTarget = {
  nodes: any[];
  edges: any[];
  nextNode: number;
  nextEdge: number;
  [key: string]: any;
};

type ExactPatch = {
  nodes?: readonly AnyRecord[];
  edges?: readonly AnyRecord[];
};

type ExactPatchOptions = {
  maxNodes?: number;
  maxEdges?: number;
  /** Carried node ids; an edge pointing at one that was cap-dropped is skipped. */
  carriedNodeIds?: ReadonlySet<string>;
};

type ExactPatchResult = {
  changed: boolean;
  droppedNodes: number;
  droppedEdges: number;
  pastedNodeIds: string[];
  pastedEdgeIds: string[];
  nextNode: number;
  nextEdge: number;
};

type ServerChange = {
  id: string;
  revision: number;
  patch: ExactPatch;
};

type ServerApplyOptions = ExactPatchOptions & {
  /** Highest revision already applied by the caller. */
  lastRevision?: number;
  /** Caller-owned idempotency set; successful changes are added to it. */
  appliedIds?: Set<string>;
};

type ServerApplyResult = ExactPatchResult & {
  status: 'applied' | 'partial' | 'rejected' | 'duplicate' | 'stale' | 'invalid';
  id?: string;
  revision?: number;
  reason?: string;
};

export const GraphPatchCore = (() => {
  const MAX_GRAPH_NODES = 3000;
  const MAX_GRAPH_EDGES = 8000;
  const NODE_SHAPES = ['circle','square','diamond','triangleUp','triangleDown','hexagon'];
  const STROKE_STYLES = ['solid','dashed','dotted','dashdot','dashdotdot','none'];
  const LABEL_POSITIONS = ['center','top','bottom','left','right'];
  function isRecord(value: unknown): value is AnyRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function finiteNumber(value: unknown, fallback: number): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  // Own keys only: "__proto__" must survive as an ordinary custom-value key.
  function cloneCustomMap(source: unknown): AnyRecord | undefined {
    if(!isRecord(source)) return undefined;
    const out: AnyRecord = Object.create(null);
    for(const key of Object.keys(source)){
      const value = source[key];
      if(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    }
    return Object.keys(out).length ? out : undefined;
  }

  function cloneEntity(entity: AnyRecord): AnyRecord {
    const out = { ...entity };
    const custom = cloneCustomMap(entity.custom);
    if(custom) out.custom = custom;
    else delete out.custom;
    return out;
  }

  function valuesEqual(a: unknown, b: unknown): boolean {
    if(a === b) return true;
    if(isRecord(a) && isRecord(b)){
      const ak = Object.keys(a), bk = Object.keys(b);
      return ak.length === bk.length && ak.every(k => valuesEqual(a[k], b[k]));
    }
    return false;
  }

  // Custom values merge per key. A patch carrying only p1 cannot wipe p2.
  function mergeCustom(target: AnyRecord, carriedCustom: unknown): boolean {
    const incoming = cloneCustomMap(carriedCustom);
    if(!incoming) return false;
    const out: AnyRecord = Object.create(null);
    if(isRecord(target.custom)) for(const key of Object.keys(target.custom)) out[key] = target.custom[key];
    let changed = false;
    for(const key of Object.keys(incoming)){
      if(!Object.prototype.hasOwnProperty.call(out, key) || !valuesEqual(out[key], incoming[key])){
        out[key] = incoming[key];
        changed = true;
      }
    }
    if(changed) target.custom = out;
    return changed;
  }

  // The central "change only what changed" rule for every carried entity.
  function mergeCarried(target: AnyRecord, carried: AnyRecord, keep: readonly string[] = []): boolean {
    let changed = false;
    for(const key of Object.keys(carried)){
      if(key === 'id' || key === 'custom' || keep.includes(key)) continue;
      if(!valuesEqual(target[key], carried[key])){
        target[key] = carried[key];
        changed = true;
      }
    }
    if(mergeCustom(target, carried.custom)) changed = true;
    return changed;
  }

  function safeCounter(value: unknown, fallback = 1): number {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : fallback;
  }

  function advanceCounter(current: number, id: unknown): number {
    const base = safeCounter(current, 1);
    const num = Number((String(id ?? '').match(/\d+$/) || [0])[0]);
    if(!Number.isSafeInteger(num) || num < base) return base;
    return num < Number.MAX_SAFE_INTEGER ? num + 1 : 1;
  }

  // Bounded allocation: an unsafe or exhausted counter cannot be incremented
  // in a loop, so fall back to a fresh timestamp-based safe id instead.
  function allocateId(prefix: string, used: Set<string>, start: number): { id: string; next: number } {
    let counter = safeCounter(start, 1);
    const tried = new Set<number>();
    while(used.has(prefix + counter)){
      if(counter >= Number.MAX_SAFE_INTEGER || tried.has(counter)){
        let suffix = 0, candidate = '';
        do {
          candidate = prefix + Date.now().toString(36) + (suffix ? '-' + suffix : '');
          suffix++;
        } while(used.has(candidate));
        used.add(candidate);
        return { id: candidate, next: 1 };
      }
      tried.add(counter);
      counter++;
    }
    const id = prefix + counter;
    used.add(id);
    return { id, next: counter < Number.MAX_SAFE_INTEGER ? counter + 1 : 1 };
  }

  // A patch is validated as a whole before anything is mutated. A malformed
  // entry must never leave the graph half-updated: the caller could not retry
  // deterministically, and a partially applied change would look like success.
  function validatePatchShape(patch: unknown): string | null {
    if(!isRecord(patch)) return 'patch is not an object';
    for(const key of ['nodes', 'edges'] as const){
      const seenIds = new Set<string>();
      if(!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      const list = (patch as AnyRecord)[key];
      if(!Array.isArray(list)) return `patch.${key} is not an array`;
      for(const entry of list){
        if(!isRecord(entry)) return `patch.${key} contains a non-object entry`;
        if(entry.id == null || !['string', 'number', 'boolean'].includes(typeof entry.id) || String(entry.id) === '') return `patch.${key} has a missing id`;
        const normalizedId = String(entry.id);
        if(seenIds.has(normalizedId)) return `patch.${key} has a duplicate id`;
        seenIds.add(normalizedId);
        // Built-in fields must already have the shape the editor consumes.
        // The custom value map must contain only editor-supported scalar values.
        const strings = key === 'nodes'
          ? ['label', 'shape', 'color', 'type', 'strokeColor', 'strokeStyle', 'labelColor', 'labelPosition', 'labelFont']
          : ['label', 'type', 'weight', 'color', 'strokeStyle', 'labelColor', 'labelFont', 'direction'];
        for(const field of strings){
          if(Object.prototype.hasOwnProperty.call(entry, field) && typeof entry[field] !== 'string')
            return `patch.${key} has an invalid ${field}`;
        }
        const enums: Record<string, readonly string[]> = key === 'nodes'
          ? { shape: NODE_SHAPES, strokeStyle: STROKE_STYLES, labelPosition: LABEL_POSITIONS }
          : { strokeStyle: STROKE_STYLES, direction: ['directed','mutual','undirected'] };
        for(const [field, allowed] of Object.entries(enums)){
          if(entry[field] !== undefined && entry[field] !== '' && !allowed.includes(entry[field]))
            return `patch.${key} has an invalid ${field}`;
        }
        for(const field of ['color','strokeColor','labelColor']){
          if(entry[field] !== undefined && (typeof entry[field] !== 'string' || (entry[field] !== '' && !/^#[0-9a-f]{6}$/i.test(entry[field]))))
            return `patch.${key} has an invalid ${field}`;
        }
        if(entry.type !== undefined && entry.type.length > 40) return `patch.${key} has an invalid type`;
        if(entry.label !== undefined && entry.label.length > 80) return `patch.${key} has an invalid label`;
        if(entry.labelFont !== undefined && entry.labelFont.length > 60) return `patch.${key} has an invalid labelFont`;
        if(key === 'edges' && entry.weight !== undefined && entry.weight.length > 50) return 'patch.edges has an invalid weight';
        if(key === 'edges' && entry.directed !== undefined && typeof entry.directed !== 'boolean' && typeof entry.directed !== 'string')
          return 'patch.edges has an invalid directed';
        const ranges: Record<string, [number, number]> = key === 'nodes'
          ? { x: [-Infinity, Infinity], y: [-Infinity, Infinity], order: [0, 2147483647], width: [10, 300], height: [10, 300], strokeSize: [0, 20], labelSize: [4, 72] }
          : { strokeSize: [0, 20], arrowSize: [4, 40], labelSize: [4, 72] };
        for(const [field, [min, max]] of Object.entries(ranges)){
          if(!Object.prototype.hasOwnProperty.call(entry, field)) continue;
          const value = entry[field];
          if(typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (field === 'order' && !Number.isInteger(value)))
            return `patch.${key} has an invalid ${field}`;
        }
        if(Object.prototype.hasOwnProperty.call(entry, 'custom')){
          if(!isRecord(entry.custom)) return `patch.${key} has an invalid custom`;
          if(Object.keys(entry.custom).length > 2000) return `patch.${key} has too many custom values`;
          for(const value of Object.values(entry.custom)){
            if((typeof value !== 'string' && typeof value !== 'boolean' && typeof value !== 'number') ||
               (typeof value === 'number' && !Number.isFinite(value)) || (typeof value === 'string' && value.length > 1000)) return `patch.${key} has an invalid custom value`;
          }
        }
        // These fields are coerced with Number/String while applying a patch.
        // JSON objects can have non-callable toString/valueOf properties, so
        // coercing them may throw after an earlier entity was already changed.
        for(const field of (key === 'nodes' ? ['id', 'x', 'y', 'order'] : ['id', 'from', 'to'])){
          const value = entry[field];
          if(value != null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean'){
            return `patch.${key} has a non-scalar ${field}`;
          }
        }
        // The editor's loader removes these characters and caps identities at
        // 40 characters. Reject rather than silently rename a server identity,
        // which could make two distinct records collide on a later load.
        for(const field of (key === 'nodes' ? ['id'] : ['id', 'from', 'to'])){
          const value = entry[field];
          if(value == null){
            if(Object.prototype.hasOwnProperty.call(entry, field)) return `patch.${key} has an invalid ${field}`;
            continue;
          }
          const identity = String(value);
          if(!identity || identity.length > 40 || /[\s"`'<>&\\/?#()[\]{}*+.,;:!@$%^=|~\u0000-\u001f\u007f]/.test(identity)){
            return `patch.${key} has a noncanonical ${field}`;
          }
        }
      }
    }
    return null;
  }

  // The loader truncates custom keys and discards keys lacking a surviving
  // definition. Validate against the same first-wins definition namespace and
  // reject values whose type would be coerced on reload.
  function validateServerCustomValues(target: GraphPatchTarget, patch: ExactPatch): string | null {
    const definitions = new Map<string, { scope: string; type: string; canonical: boolean }>();
    const source = Array.isArray(target.customAttributes) ? target.customAttributes.slice(0, 2000) : [];
    for(const def of source){
      if(!isRecord(def)) continue;
      const rawId = String(def.id ?? '');
      const id = rawId.trim().slice(0, 128);
      if(!id || !['node','edge','graph','all'].includes(def.scope) || definitions.has(id)) continue;
      definitions.set(id, {scope: def.scope, canonical: typeof def.id === 'string' && rawId === id,
        type: ['string','boolean','int','long','float','double'].includes(def.type) ? def.type : 'string'});
    }
    for(const [scope, entities] of [['node', patch.nodes], ['edge', patch.edges]] as const){
      for(const entity of entities || []){
        if(!entity.custom) continue;
        for(const [key, value] of Object.entries(entity.custom)){
          if(!key || key !== key.trim() || key.length > 128) return `patch.${scope}s has a noncanonical custom key`;
          const def = definitions.get(key);
          if(!def || !def.canonical) return `patch.${scope}s has an undefined or noncanonical custom definition`;
          // Other-scope values survive as orphans verbatim. Applicable values
          // must already be canonical so coerceCustomValue does not change them.
          if(def.scope !== scope && def.scope !== 'all') continue;
          const canonical = def.type === 'string' ? typeof value === 'string'
            : def.type === 'boolean' ? typeof value === 'boolean'
            : def.type === 'int' ? typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
            : def.type === 'long' ? typeof value === 'number' && Number.isSafeInteger(value)
            : typeof value === 'number' && Number.isFinite(value);
          if(!canonical) return `patch.${scope}s has a noncanonical custom value`;
        }
      }
    }
    return null;
  }

  // Apply an exact (in-place) patch to a graph-shaped target. The target's
  // nodes/edges arrays and next counters are mutated; everything else is
  // returned as a report so the caller owns history/UI/side effects.
  function applyExactPatch(target: GraphPatchTarget, patch: ExactPatch, options: ExactPatchOptions = {}): ExactPatchResult {
    // Only well-formed entries are considered: a null/primitive entry is
    // reported as dropped instead of throwing halfway through the mutation.
    const patchNodes = (Array.isArray(patch?.nodes) ? patch.nodes : []).filter(isRecord);
    const patchEdges = (Array.isArray(patch?.edges) ? patch.edges : []).filter(isRecord);
    const malformedNodes = (Array.isArray(patch?.nodes) ? patch.nodes.length : 0) - patchNodes.length;
    const malformedEdges = (Array.isArray(patch?.edges) ? patch.edges.length : 0) - patchEdges.length;
    const maxNodes = options.maxNodes == null ? Number.MAX_SAFE_INTEGER : options.maxNodes;
    const maxEdges = options.maxEdges == null ? Number.MAX_SAFE_INTEGER : options.maxEdges;
    const carriedNodeIds = options.carriedNodeIds
      || new Set<string>(patchNodes.map(n => String(n?.id ?? '')));
    const nodeById = new Map<string, AnyRecord>(target.nodes.map(n => [String(n.id), n]));
    const edgeById = new Map<string, AnyRecord>(target.edges.map(e => [String(e.id), e]));
    const pastedNodeIds: string[] = [];
    const pastedEdgeIds: string[] = [];
    let nextNode = safeCounter(target.nextNode, 1);
    let nextEdge = safeCounter(target.nextEdge, 1);
    let nextFreeOrder = target.nodes.reduce((m, n) => Math.max(m, Number(n.order) || 0), -1) + 1;
    let changed = false;
    let droppedNodes = malformedNodes;
    let droppedEdges = malformedEdges;
    const seenNodeIds = new Set<string>();
    const seenEdgeIds = new Set<string>();

    for(const orig of [...patchNodes].sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0))){
      const node = cloneEntity(orig);
      const id = String(node.id ?? '');
      if(!id || seenNodeIds.has(id)){ droppedNodes++; continue; }
      node.id = id;
      seenNodeIds.add(id);
      // Coordinates are restored only when carried; a partial patch must not
      // reset a stored position. Non-finite supplied values are treated as
      // omitted for an existing entity and as zero for a new one.
      for(const axis of ['x', 'y'] as const){
        if(Object.prototype.hasOwnProperty.call(node, axis)){
          node[axis] = finiteNumber(node[axis], nodeById.has(id) ? finiteNumber(nodeById.get(id)![axis], 0) : 0);
        } else if(nodeById.has(id)){
          delete node[axis];
        } else {
          node[axis] = 0;
        }
      }
      const existing = nodeById.get(id);
      if(existing){
        if(mergeCarried(existing, node, ['order'])) changed = true;
        pastedNodeIds.push(existing.id);
      } else {
        if(target.nodes.length >= maxNodes){ droppedNodes++; continue; }
        nextNode = advanceCounter(nextNode, node.id);
        const carriedOrder = Number(node.order);
        node.order = Number.isFinite(carriedOrder) ? carriedOrder : nextFreeOrder++;
        if(!Object.prototype.hasOwnProperty.call(node, 'label')) node.label = '';
        target.nodes.push(node);
        nodeById.set(id, node);
        pastedNodeIds.push(id);
        changed = true;
      }
    }

    const pastedNodeIdSet = new Set(pastedNodeIds);
    for(const orig of patchEdges){
      const edgeId = String(orig?.id ?? '');
      if(!edgeId || seenEdgeIds.has(edgeId)){ droppedEdges++; continue; }
      seenEdgeIds.add(edgeId);
      const from = String(orig?.from ?? ''), to = String(orig?.to ?? '');
      // An edge through a cap-dropped carried node would be dangling after
      // the next load, so it is dropped here too.
      if((carriedNodeIds.has(from) && !pastedNodeIdSet.has(from)) ||
         (carriedNodeIds.has(to) && !pastedNodeIdSet.has(to))){ droppedEdges++; continue; }
      const existingById = edgeById.get(edgeId);
      // A server patch may change an endpoint to a node that does not exist in
      // the resulting graph. That edge would be silently discarded on the next
      // load, so reject the edge here instead of reporting a false success.
      const suppliedFrom = Object.prototype.hasOwnProperty.call(orig, 'from');
      const suppliedTo = Object.prototype.hasOwnProperty.call(orig, 'to');
      if((suppliedFrom && !nodeById.has(from)) || (suppliedTo && !nodeById.has(to)) ||
         (!existingById && (!suppliedFrom || !suppliedTo))){ droppedEdges++; continue; }
      const edge = cloneEntity(orig);
      const id = String(edge.id ?? '');
      if(!id){ droppedEdges++; continue; }
      edge.id = id;
      if(suppliedFrom) edge.from = from;
      if(suppliedTo) edge.to = to;
      // direction is authoritative in the renderer. A legacy directed-only
      // patch must update it as well, and both fields must agree on reload.
      if(Object.prototype.hasOwnProperty.call(edge, 'direction') || Object.prototype.hasOwnProperty.call(edge, 'directed')){
        const raw = Object.prototype.hasOwnProperty.call(edge, 'direction') ? edge.direction : edge.directed;
        const text = String(raw ?? '').trim().toLowerCase();
        const direction = raw === false || text === 'false' || text === '0' || text === 'none' || text === 'undirected' || text === 'undirected (no ends)'
          ? 'undirected' : text === 'mutual' || text === 'both' || text === 'bidirected' || text === 'bidirectional' || text === 'mutual (both ends)' || text.startsWith('bi')
          ? 'mutual' : 'directed';
        edge.direction = direction;
        edge.directed = direction !== 'undirected';
      }
      const existing = edgeById.get(id);
      if(existing){
        if(mergeCarried(existing, edge)) changed = true;
        pastedEdgeIds.push(existing.id);
      } else {
        if(target.edges.length >= maxEdges){ droppedEdges++; continue; }
        nextEdge = advanceCounter(nextEdge, edge.id);
        if(!Object.prototype.hasOwnProperty.call(edge, 'label')) edge.label = '';
        target.edges.push(edge);
        edgeById.set(id, edge);
        pastedEdgeIds.push(id);
        changed = true;
      }
    }

    target.nextNode = nextNode;
    target.nextEdge = nextEdge;
    if(changed && patchNodes.length) target.nodes.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    return { changed, droppedNodes, droppedEdges, pastedNodeIds, pastedEdgeIds, nextNode, nextEdge };
  }

  // Server-originated changes use the exact same merge core as clipboard
  // paste. Transport concerns (auth, ordering source, persistence) stay in
  // the caller; this adapter only enforces idempotency and monotonic revision.
  function applyServerChange(target: GraphPatchTarget, change: ServerChange, options: ServerApplyOptions = {}): ServerApplyResult {
    const empty = {
      changed: false, droppedNodes: 0, droppedEdges: 0,
      pastedNodeIds: [] as string[], pastedEdgeIds: [] as string[],
      nextNode: safeCounter(target.nextNode, 1), nextEdge: safeCounter(target.nextEdge, 1),
    };
    if(!isRecord(change) || typeof change.id !== 'string' || !change.id ||
       !Number.isSafeInteger(change.revision) || !isRecord(change.patch)){
      return { ...empty, status: 'invalid', reason: 'malformed server change' };
    }
    if(options.appliedIds?.has(change.id)){
      return { ...empty, status: 'duplicate', id: change.id, revision: change.revision };
    }
    const lastRevision = Number.isSafeInteger(options.lastRevision) ? Number(options.lastRevision) : -Infinity;
    if(change.revision <= lastRevision){
      return { ...empty, status: 'stale', id: change.id, revision: change.revision };
    }
    // Shape first: an unapplied change must leave the target untouched so the
    // caller can reject it (or fix it) without having to repair the graph.
    const shapeProblem = validatePatchShape(change.patch);
    if(shapeProblem){
      return { ...empty, status: 'invalid', id: change.id, revision: change.revision, reason: shapeProblem };
    }
    const customProblem = validateServerCustomValues(target, change.patch);
    if(customProblem){
      return { ...empty, status: 'invalid', id: change.id, revision: change.revision, reason: customProblem };
    }
    const existingEdgeIds = new Set(target.edges.map(edge => String(edge.id)));
    for(const edge of change.patch.edges || []){
      if(!existingEdgeIds.has(String(edge.id)) &&
         (!Object.prototype.hasOwnProperty.call(edge, 'from') || !Object.prototype.hasOwnProperty.call(edge, 'to'))){
        return { ...empty, status: 'invalid', id: change.id, revision: change.revision, reason: 'new edge is missing an endpoint' };
      }
    }
    // Stage against detached entity records. If an unexpected conversion or
    // comparison throws, no earlier entity in the caller's graph is changed.
    // Preserve existing entity and array identities when committing so UI
    // adapters holding references continue to observe the applied change.
    let result: ExactPatchResult;
    const originals = new Map<AnyRecord, AnyRecord>();
    let staged: GraphPatchTarget;
    try {
      const clone = (entity: AnyRecord) => {
        const copy = { ...entity };
        originals.set(copy, entity);
        return copy;
      };
      staged = { ...target, nodes: target.nodes.map(clone), edges: target.edges.map(clone) };
      const boundedLimit = (value: number | undefined, ceiling: number) =>
        Number.isSafeInteger(value) && value! >= 0 ? Math.min(value!, ceiling) : ceiling;
      result = applyExactPatch(staged, change.patch, { ...options,
        maxNodes: boundedLimit(options.maxNodes, MAX_GRAPH_NODES),
        maxEdges: boundedLimit(options.maxEdges, MAX_GRAPH_EDGES),
      });
    } catch {
      return { ...empty, status: 'invalid', id: change.id, revision: change.revision, reason: 'patch could not be applied' };
    }
    const commit = (destination: AnyRecord[], source: AnyRecord[]) => {
      const entities = source.map(entity => {
        const original = originals.get(entity);
        if(original){ Object.assign(original, entity); return original; }
        return entity;
      });
      destination.length = 0;
      for(const entity of entities) destination.push(entity);
    };
    commit(target.nodes, staged.nodes);
    commit(target.edges, staged.edges);
    target.nextNode = staged.nextNode;
    target.nextEdge = staged.nextEdge;
    const requested = (Array.isArray(change.patch.nodes) ? change.patch.nodes.length : 0)
      + (Array.isArray(change.patch.edges) ? change.patch.edges.length : 0);
    const dropped = result.droppedNodes + result.droppedEdges;
    // Do not acknowledge work that still has to be retried. Exact patches are
    // idempotent, so replaying a partial change is safe once capacity exists.
    const status = dropped === 0 ? 'applied' : dropped === requested ? 'rejected' : 'partial';
    if(status === 'applied') options.appliedIds?.add(change.id);
    return { ...result, status, id: change.id, revision: change.revision };
  }

  return {
    MAX_GRAPH_NODES, MAX_GRAPH_EDGES, NODE_SHAPES, STROKE_STYLES, LABEL_POSITIONS,
    isRecord, cloneCustomMap, cloneEntity, valuesEqual, mergeCustom, mergeCarried,
    safeCounter, advanceCounter, allocateId, validatePatchShape, applyExactPatch, applyServerChange,
  };
})();
