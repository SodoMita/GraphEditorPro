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
