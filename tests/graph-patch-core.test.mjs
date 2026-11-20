// Unit tests for the DOM-free graph change core. This file transpiles the
// TypeScript source directly and evaluates it in Node: no index.html, no DOM,
// no clipboard. That is the boundary a future server transport can reuse too.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile('src/core/graph-patch.ts', 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None, removeComments: true },
});
const core = new Function(`${outputText}\nreturn GraphPatchCore;`)();

const graph = () => ({
  title: 'server-ready',
  nodes: [{ id: 'a', label: 'Old', x: -200, y: 0, order: 0, custom: { p1: 'old', p2: 'keep' } }],
  edges: [{ id: 'e1', from: 'a', to: 'a', label: 'link', weight: 'keep' }],
  nextNode: 2,
  nextEdge: 2,
});

test('the core has no DOM or transport dependency', () => {
  assert.doesNotMatch(outputText, /\b(document|navigator|localStorage|window)\b/);
  assert.equal(typeof core.applyExactPatch, 'function');
  assert.equal(typeof core.applyServerChange, 'function');
});

test('mergeCarried changes only carried fields and merges custom values per key', () => {
  const target = graph().nodes[0];
  const changed = core.mergeCarried(target, { label: 'New', custom: { p1: 'new' } });
  assert.equal(changed, true);
  assert.equal(target.label, 'New');
  assert.equal(target.x, -200, 'an omitted coordinate is preserved');
  assert.equal(target.order, 0, 'order is preserved on an existing entity');
  assert.equal(target.custom.p1, 'new');
  assert.equal(target.custom.p2, 'keep', 'an unrelated custom value survives');
  assert.equal(core.mergeCarried(target, { label: 'New' }), false);
});

test('applyExactPatch reuses ids and creates new entities at carried coordinates', () => {
  const target = graph();
  const result = core.applyExactPatch(target, {
    nodes: [
      { id: 'a', label: 'Updated', x: -200, y: 0, custom: { p1: 'changed' } },
      { id: 'n2', label: 'New', x: 120, y: -40, order: 4 },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'n2', label: 'link*' }],
  }, { maxNodes: 3000, maxEdges: 8000 });

  assert.equal(result.changed, true);
  assert.deepEqual(result.pastedNodeIds, ['a', 'n2']);
  assert.deepEqual(result.pastedEdgeIds, ['e1']);
  assert.equal(target.nodes.length, 2);
  assert.equal(target.nodes[0].custom.p1, 'changed');
  assert.equal(target.nodes[0].custom.p2, 'keep');
  assert.equal(target.nodes[1].x, 120);
  assert.equal(target.nodes[1].y, -40);
  assert.equal(target.nodes[1].order, 4);
  assert.equal(target.edges[0].to, 'n2');
  assert.equal(target.edges[0].weight, 'keep');
  assert.equal(target.nextNode, 3);
  assert.equal(target.nextEdge, 2, 'an existing edge id does not advance the counter');
});

test('applyExactPatch keeps caps, edge fate and duplicate ids deterministic', () => {
  const target = graph();
  const result = core.applyExactPatch(target, {
    nodes: [
      { id: 'n2', label: 'Kept', x: 0, y: 0, order: 1 },
      { id: 'n2', label: 'Duplicate', x: 10, y: 10, order: 2 },
      { id: 'n3', label: 'Over cap', x: 20, y: 20, order: 3 },
    ],
    edges: [
      { id: 'e2', from: 'n3', to: 'a', label: 'dropped endpoint' },
      { id: 'e3', from: 'n2', to: 'a', label: 'kept' },
    ],
  }, { maxNodes: 2, maxEdges: 8000 });

  assert.equal(result.droppedNodes, 2, 'duplicate and cap-rejected nodes are both dropped');
  assert.equal(result.droppedEdges, 1, 'an edge through a cap-dropped carried node is dropped');
  assert.deepEqual(result.pastedNodeIds, ['n2']);
  assert.deepEqual(result.pastedEdgeIds, ['e3']);
  assert.equal(target.nodes.length, 2);
  assert.equal(target.edges.length, 2);
});

test('applyExactPatch keeps counters finite with unsafe server ids', () => {
  const target = graph();
  target.nodes.push({ id: 'n9007199254740991', label: 'Max', x: 0, y: 0, order: 1 });
  target.nextNode = 9007199254740992; // unsafe input from an old document
  const result = core.applyExactPatch(target, {
    nodes: [
      { id: 'n9007199254740992', label: 'Huge', x: 30, y: 30, order: 2 },
      { id: 'n9007199254740992', label: 'Duplicate', x: 40, y: 40, order: 3 },
    ],
    edges: [],
  }, { maxNodes: 3000, maxEdges: 8000 });

  assert.equal(result.droppedNodes, 1);
  assert.ok(Number.isSafeInteger(target.nextNode) && target.nextNode >= 1);
  assert.ok(target.nodes.some(n => n.id === 'n9007199254740992' && n.label === 'Huge'));
});

test('applyServerChange adds idempotency and revision checks around the same merge', () => {
  const target = graph();
  const appliedIds = new Set();
  const change = {
    id: 'change-1', revision: 7,
    patch: { nodes: [{ id: 'a', label: 'From server', custom: { p1: 'server' } }], edges: [] },
  };
  const first = core.applyServerChange(target, change, { appliedIds, lastRevision: 6 });
  assert.equal(first.status, 'applied');
  assert.deepEqual(first.pastedNodeIds, ['a']);
  assert.equal(target.nodes[0].label, 'From server');
  assert.equal(target.nodes[0].custom.p2, 'keep');

  const duplicate = core.applyServerChange(target, change, { appliedIds, lastRevision: 7 });
  assert.equal(duplicate.status, 'duplicate');
  const stale = core.applyServerChange(target, { ...change, id: 'change-2', revision: 5 }, { appliedIds, lastRevision: 7 });
  assert.equal(stale.status, 'stale');
  const invalid = core.applyServerChange(target, { id: '', revision: 8, patch: {} }, { appliedIds, lastRevision: 7 });
  assert.equal(invalid.status, 'invalid');

  const newer = core.applyServerChange(target, {
    id: 'change-3', revision: 8,
    patch: { nodes: [{ id: 'a', label: 'Newer from server' }], edges: [] },
  }, { appliedIds, lastRevision: 7 });
  assert.equal(newer.status, 'applied');
  assert.equal(target.nodes[0].label, 'Newer from server');
});

test('server patches never leave a dangling edge', () => {
  const target = graph();
  const appliedIds = new Set();
  const change = {
    id: 'dangling', revision: 1,
    patch: { nodes: [], edges: [{ id: 'e1', from: 'a', to: 'missing', label: 'bad' }] },
  };
  const result = core.applyServerChange(target, change, { appliedIds });
  assert.equal(result.status, 'rejected');
  assert.equal(result.droppedEdges, 1);
  assert.equal(target.edges[0].to, 'a', 'the existing edge is unchanged');
  assert.equal(appliedIds.has('dangling'), false);
});

test('partial and rejected server changes remain retryable', () => {
  const target = graph();
  const appliedIds = new Set();
  const change = {
    id: 'capacity', revision: 1,
    patch: {
      nodes: [
        { id: 'n2', label: 'Fits', x: 0, y: 0, order: 1 },
        { id: 'n3', label: 'Needs space', x: 10, y: 0, order: 2 },
      ],
      edges: [],
    },
  };
  const partial = core.applyServerChange(target, change, { appliedIds, maxNodes: 2 });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.droppedNodes, 1);
  assert.equal(appliedIds.has('capacity'), false);

  const applied = core.applyServerChange(target, change, { appliedIds, maxNodes: 3 });
  assert.equal(applied.status, 'applied');
  assert.equal(appliedIds.has('capacity'), true);
  assert.ok(target.nodes.some(n => n.id === 'n2'));
  assert.ok(target.nodes.some(n => n.id === 'n3'));

  const rejected = core.applyServerChange(graph(), { id: 'full', revision: 1, patch: change.patch },
    { appliedIds, maxNodes: 1 });
  assert.equal(rejected.status, 'rejected');
  assert.equal(appliedIds.has('full'), false);
});

test('a malformed patch is rejected before anything is mutated', () => {
  const target = graph();
  const appliedIds = new Set();
  const before = JSON.parse(JSON.stringify(target));

  const withNull = core.applyServerChange(target, {
    id: 'null-entry', revision: 1,
    patch: { nodes: [{ id: 'a', label: 'changed' }, null], edges: [] },
  }, { appliedIds });
  assert.equal(withNull.status, 'invalid');
  assert.equal(appliedIds.has('null-entry'), false, 'an invalid change is never acknowledged');
  assert.deepEqual(JSON.parse(JSON.stringify(target)), before, 'the target is untouched');

  for(const patch of [{ nodes: 'not-an-array' }, { nodes: [], edges: 'nope' }, { nodes: [1, 'two'] }]){
    const result = core.applyServerChange(target, { id: 'shape', revision: 1, patch }, { appliedIds });
    assert.equal(result.status, 'invalid', JSON.stringify(patch));
    assert.equal(appliedIds.has('shape'), false);
    assert.deepEqual(JSON.parse(JSON.stringify(target)), before);
  }
  assert.equal(core.validatePatchShape({ nodes: [{ id: 'a' }], edges: [] }), null);
  assert.match(String(core.validatePatchShape({ edges: {} })), /not an array/);
});

test('an invalid change does not consume its revision', () => {
  const target = graph();
  const appliedIds = new Set();
  const bad = core.applyServerChange(target, { id: 'x', revision: 5, patch: { nodes: null } },
    { appliedIds, lastRevision: 4 });
  assert.equal(bad.status, 'invalid');
  // The transport can resend the corrected change at the same revision.
  const good = core.applyServerChange(target, {
    id: 'x', revision: 5, patch: { nodes: [{ id: 'a', label: 'Retried' }], edges: [] },
  }, { appliedIds, lastRevision: 4 });
  assert.equal(good.status, 'applied');
  assert.equal(appliedIds.has('x'), true);
  assert.equal(target.nodes.find(n => n.id === 'a').label, 'Retried');
});

test('server patch rejects non-scalar coercion fields before mutation', () => {
  const bad = { toString: null, valueOf: null };
  for(const [kind, field] of [['nodes','id'], ['nodes','x'], ['nodes','y'], ['nodes','order'], ['edges','id'], ['edges','from'], ['edges','to']]) {
    const target = graph();
    const before = structuredClone(target);
    const appliedIds = new Set();
    const entry = { id: 'b', [field]: bad };
    const patch = { nodes: [{ id: 'a', label: 'new' }], edges: [] };
    patch[kind].push(entry);
    const result = core.applyServerChange(target, { id:'c1', revision:1, patch }, { appliedIds });
    assert.equal(result.status, 'invalid', `${kind}.${field}`);
    assert.deepEqual(target, before);
    assert.equal(appliedIds.size, 0);
  }
});

test('server changes are staged if comparison throws after an earlier update', () => {
  const target = graph();
  let left = {}, right = {};
  for(let i = 0; i < 20000; i++) { left = { nested: left }; right = { nested: right }; }
  target.nodes.push({ id: 'b', order: 1, value: left });
  const originalA = target.nodes[0];
  const appliedIds = new Set();
  const result = core.applyServerChange(target, { id:'deep', revision:1, patch:{ nodes:[
    { id:'a', label:'new' }, { id:'b', value:right },
  ] } }, { appliedIds });
  assert.equal(result.status, 'invalid');
  assert.equal(target.nodes[0], originalA);
  assert.equal(originalA.label, 'Old');
  assert.equal(target.nodes[1].value, left);
  assert.equal(appliedIds.size, 0);
});

test('successful staged server changes preserve entity and array identities', () => {
  const target = graph(), nodes = target.nodes, edges = target.edges, node = nodes[0], edge = edges[0];
  const result = core.applyServerChange(target, { id:'ok', revision:1, patch:{ nodes:[{id:'a',label:'new'}], edges:[{id:'e1',label:'new edge'}] } });
  assert.equal(result.status, 'applied');
  assert.equal(target.nodes, nodes); assert.equal(target.edges, edges);
  assert.equal(target.nodes[0], node); assert.equal(target.edges[0], edge);
  assert.equal(node.label, 'new'); assert.equal(edge.label, 'new edge');
});
