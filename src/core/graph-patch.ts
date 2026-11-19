// DOM-free graph change application.
//
// This is the reusable part of the "paste in place" feature. It knows nothing
// about the clipboard, localStorage, the DOM, history, selection or toasts:
// callers supply a graph-shaped target and a patch, and receive a change
// report. Clipboard paste, file import and future server updates can all use
// the same semantics: carry only supplied fields, reuse carried ids, keep
// unrelated data, respect document caps and leave counters safe.

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
  status: 'applied' | 'duplicate' | 'stale' | 'invalid';
  id?: string;
  revision?: number;
  reason?: string;
};

const GraphPatchCore = (() => {
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

  // Apply an exact (in-place) patch to a graph-shaped target. The target's
  // nodes/edges arrays and next counters are mutated; everything else is
  // returned as a report so the caller owns history/UI/side effects.
  function applyExactPatch(target: GraphPatchTarget, patch: ExactPatch, options: ExactPatchOptions = {}): ExactPatchResult {
    const patchNodes = Array.isArray(patch?.nodes) ? patch.nodes : [];
    const patchEdges = Array.isArray(patch?.edges) ? patch.edges : [];
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
    let droppedNodes = 0;
    let droppedEdges = 0;
    const seenNodeIds = new Set<string>();
    const seenEdgeIds = new Set<string>();

    for(const orig of [...patchNodes].sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0))){
      const node = cloneEntity(orig);
      const id = String(node.id ?? '');
      if(!id || seenNodeIds.has(id)){ droppedNodes++; continue; }
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
      const edge = cloneEntity(orig);
      const id = String(edge.id ?? '');
      if(!id){ droppedEdges++; continue; }
      const existing = edgeById.get(id);
      if(existing){
        if(mergeCarried(existing, edge)) changed = true;
        pastedEdgeIds.push(existing.id);
      } else {
        if(target.edges.length >= maxEdges){ droppedEdges++; continue; }
        nextEdge = advanceCounter(nextEdge, edge.id);
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
    const result = applyExactPatch(target, change.patch, options);
    options.appliedIds?.add(change.id);
    return { ...result, status: 'applied', id: change.id, revision: change.revision };
  }

  return {
    isRecord, cloneCustomMap, cloneEntity, valuesEqual, mergeCustom, mergeCarried,
    safeCounter, advanceCounter, allocateId, applyExactPatch, applyServerChange,
  };
})();
