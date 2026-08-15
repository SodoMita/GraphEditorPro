import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const compiled = await readFile('.build/app.js', 'utf8');
const instrumented = compiled.replace(
  /\ninit\(\);\s*$/,
  '\nglobalThis.__graphEditorTests = { sanitizeState, defaultState, I18N, matrixFor(input) { state = sanitizeState(input); return adjacencyMatrixData(state.nodes); }, matrixCsvFor(input) { state = sanitizeState(input); return matrixCsv(); } };',
);
assert.notEqual(instrumented, compiled, 'test instrumentation must replace the init call');

const inertElement = new Proxy({}, {
  get(target, property) {
    if (property === 'querySelector') return () => inertElement;
    if (property === 'querySelectorAll') return () => [];
    if (property === 'addEventListener') return () => {};
    return target[property];
  },
});
const context = vm.createContext({
  console,
  document: {
    querySelector: () => inertElement,
    querySelectorAll: () => [],
  },
  window: {},
});
vm.runInContext(instrumented, context, { filename: '.build/app.js' });
const { sanitizeState, matrixFor, matrixCsvFor } = context.__graphEditorTests;

test('invalid root values safely fall back to defaults', () => {
  for (const value of [null, undefined, false, 42, 'graph', []]) {
    const result = sanitizeState(value);
    assert.equal(result.title, 'untitled');
    assert.equal(result.nodes.length, 0);
    assert.equal(result.edges.length, 0);
  }
});

test('sanitizer normalizes IDs, keeps them unique, and drops dangling edges', () => {
  const result = sanitizeState({
    nodes: [
      null,
      { id: 'node !', label: 'A', x: 'not-finite', y: 2, order: 0 },
      { id: 'node !', label: 'B', x: 5, y: 6, order: 0 },
    ],
    edges: [
      { id: 'edge !', from: 'node !', to: 'node !', directed: true },
      { id: 'edge !', from: 'node !', to: 'node !', directed: false },
      { id: 'dangling', from: 'missing', to: 'node !' },
    ],
  });

  assert.deepEqual(Array.from(result.nodes, node => node.id), ['node', 'node-2']);
  assert.deepEqual(Array.from(result.nodes, node => node.order), [0, 0]);
  assert.equal(result.nodes[0].x, 0);
  assert.deepEqual(Array.from(result.edges, edge => edge.id), ['edge', 'edge-2']);
  assert.ok(result.edges.every(edge => edge.from === 'node' && edge.to === 'node'));
});

test('sanitizer clamps unsafe settings and rejects non-numeric ranges', () => {
  const maliciousSettings = JSON.parse('{"visibleRange":{"start":"oops","end":99999999999},"nodeWidth":-50,"nodeLabelSize":500,"matrixLimit":999,"edgeListPageSize":99999,"canvasBgColor":"javascript:bad","nodeTypeStyles":{"__proto__":{"color":"#ffffff"},"safe":{"color":"#112233"}}}');
  const result = sanitizeState({ settings: maliciousSettings });

  assert.equal(result.settings.visibleRange.start, -1);
  assert.equal(result.settings.visibleRange.end, 2147483647);
  assert.equal(result.settings.nodeWidth, 10);
  assert.equal(result.settings.nodeLabelSize, 72);
  assert.equal(result.settings.matrixLimit, 300);
  assert.equal(result.settings.edgeListPageSize, 8_000);
  assert.equal(result.settings.canvasBgColor, '#020617');
  assert.equal(Object.getPrototypeOf(result.settings.nodeTypeStyles), null);
  assert.equal(result.settings.nodeTypeStyles.safe.color, '#112233');
});

test('matrix values, edge IDs, and sparse CSV stay consistent', () => {
  const graph = {
    nodes: [
      { id: 'a', label: 'A', x: 0, y: 0 },
      { id: 'b', label: 'B', x: 1, y: 1 },
    ],
    edges: [
      { id: 'directed', from: 'a', to: 'b', directed: true, weight: '2' },
      { id: 'undirected', from: 'a', to: 'b', directed: false, weight: '3' },
    ],
  };
  const matrix = matrixFor(graph);

  assert.deepEqual(Array.from(matrix.values[0][1]), ['2', '3']);
  assert.deepEqual(Array.from(matrix.edgeIds[0][1]), ['directed', 'undirected']);
  assert.deepEqual(Array.from(matrix.values[1][0]), ['3']);
  assert.deepEqual(Array.from(matrix.edgeIds[1][0]), ['undirected']);
  assert.equal(matrixCsvFor(graph), '\ufeff,A,B\r\nA,,2;3\r\nB,3,\r\n');
});

test('sanitizer enforces graph size limits', () => {
  const nodes = Array.from({ length: 3_005 }, (_, index) => ({
    id: `n${index + 1}`,
    label: String(index + 1),
    x: index,
    y: index,
  }));
  const edges = Array.from({ length: 8_005 }, (_, index) => ({
    id: `e${index + 1}`,
    from: 'n1',
    to: 'n1',
  }));
  const result = sanitizeState({ nodes, edges });

  assert.equal(result.nodes.length, 3_000);
  assert.equal(result.edges.length, 8_000);
});
