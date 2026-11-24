// Regressions for the table-reconciliation layer (the rebuild-avoidance path
// added for the dense-graph freeze). Each test pins one way the layer can drift
// from the model it is supposed to mirror:
//
//  P1  Undo left a focused edge-list field showing the pre-Undo weight forever.
//  P2  "Show more" wrote #edgeListHost behind the signature cache's back, so
//      expanded rows were never reconciled.
//  P2  Selection sync lit up the reverse cell of a directed edge.
//  P2  An armed (single-clicked) cell counted as an open editor and disabled
//      the patch path for every later render.
//  P2  The list note built one visible-id Set per edge.
//  P3  Endpoint tooltips kept the old node ID after a reassignment.
//  P3  A node added outside the visible range left reorder buttons disabled.
//
// All seven fail on the build they were found in and pass on the fix.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createWebLocks } from './helpers/web-locks.mjs';

const html = await readFile('index.html', 'utf8');

function createEditorDom(savedGraph, { countSets = false } = {}) {
  const errors = [];
  const counters = { sets: 0 };
  const source = html.replace('<script>', `<script>localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(savedGraph))});</script><script>`);
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(source, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://offline.test/', virtualConsole,
    beforeParse(window) {
      if (countSets) {
        // Count Set constructions so an allocation-per-edge regression is
        // observable deterministically instead of through a flaky timer.
        const NativeSet = window.Set;
        class CountingSet extends NativeSet {
          constructor(...args) { super(...args); counters.sets++; }
        }
        Object.defineProperty(CountingSet, 'name', { value: 'Set' });
        window.Set = CountingSet;
      }
      Object.defineProperty(window.navigator, 'locks', { configurable: true, value: createWebLocks() });
      window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => null;
      window.URL.createObjectURL = () => 'blob:offline-test';
      window.URL.revokeObjectURL = () => {};
      Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async () => {}, readText: async () => '' } });
    },
  });
  return { dom, errors, counters };
}

const settle = (window, ms) => new Promise(resolve => window.setTimeout(resolve, ms));

function dispatchPointer(window, target, type) {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  target.dispatchEvent(event);
}

const cellOf = (document, from, to) => document.querySelector(`#matrixHost tr[data-r="${from}"] td[data-c="${to}"]`);
const cellText = (document, from, to) => cellOf(document, from, to).textContent;
const listWeight = (document, id) => document.querySelector(`#edgeListHost input.el-weight[data-edge-id="${id}"]`);
const listRows = document => document.querySelectorAll('#edgeListHost tbody tr').length;

// Commit a value into a list field the way a user does, then let the debounced
// matrix/list render land.
function commit(window, input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

// Four edges (e4 undirected, so one graph can prove both selection rules)
// and enough rows for "show more" to have a second page to reveal.
function baseGraph(settings = {}) {
  return {
    title: 'reconcile', mode: 'select', nextNode: 5, nextEdge: 5,
    nodes: [
      { id: 'a', label: 'A', x: -200, y: 0, order: 0 },
      { id: 'b', label: 'B', x: 200, y: 0, order: 1 },
      { id: 'c', label: 'C', x: 0, y: 200, order: 2 },
      { id: 'd', label: 'D', x: 300, y: 200, order: 3 },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', directed: true, weight: '3', label: '', type: '' },
      { id: 'e2', from: 'b', to: 'c', directed: true, weight: '5', label: '', type: '' },
      { id: 'e3', from: 'c', to: 'a', directed: true, weight: '6', label: '', type: '' },
      // Undirected and on its own pair of nodes, so its mirrored cells (c,d)
      // and (d,c) never overlap a cell another test asserts on.
      { id: 'e4', from: 'c', to: 'd', directed: false, weight: '8', label: '', type: '' },
    ],
    customAttributes: [], graphCustom: {}, settings,
  };
}

// A complete directed graph: n*(n-1) edges, every node inside the visible range
// so the range filter (and its note count) actually runs.
function rangedGraph(n) {
  const nodes = [], edges = [];
  for (let i = 0; i < n; i++) nodes.push({ id: 'n' + (i + 1), label: 'N' + (i + 1), x: i * 60, y: i * 40, order: i });
  let k = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) edges.push({ id: 'e' + (++k), from: nodes[i].id, to: nodes[j].id, directed: true, weight: '1', label: '', type: '' });
  return {
    title: 'ranged', mode: 'select', nextNode: n + 1, nextEdge: k + 1, nodes, edges,
    customAttributes: [], graphCustom: {},
    settings: { visibleRange: { start: 0, end: n - 1 } },
  };
}

test('P1: Undo reconciles a focused edge-list weight field instead of leaving it stale', async () => {
  const { dom, errors } = createEditorDom(baseGraph());
  const { window } = dom; const { document } = window;
  await settle(window, 200);

  commit(window, listWeight(document, 'e1'), '42');
  await settle(window, 200);
  assert.equal(cellText(document, 'a', 'b'), '42', 'the commit reached the model and the matrix');

  // Refocus the field WITHOUT typing, then Undo. The field is clean, so it has
  // to re-read the model exactly like the matrix editor does.
  const focused = listWeight(document, 'e1');
  focused.focus();
  assert.equal(document.activeElement, focused, 'the weight field is focused');
  document.querySelector('#btnUndo').click();
  await settle(window, 250);

  assert.equal(cellText(document, 'a', 'b'), '3', 'the matrix shows the undone weight');
  assert.equal(listWeight(document, 'e1').value, '3', 'the focused list field shows the undone weight, not the stale 42');

  // The point of the fix: the next keystroke edits the undone value.
  const after = listWeight(document, 'e1');
  commit(window, after, after.value + '0');
  await settle(window, 200);
  assert.equal(cellText(document, 'a', 'b'), '30', 'typing 0 committed 30, not 420');

  // The other half of the rule: a field the user IS typing into keeps its
  // draft. Writing the model back over a focused field must be reserved for a
  // clean one, or an unrelated render would eat half-typed text.
  const draft = listWeight(document, 'e1');
  draft.focus();
  draft.value = '99';
  draft.dispatchEvent(new window.Event('input', { bubbles: true })); // a real keystroke
  // Reassigning e1's source changes e1's own row, so the patcher visits it.
  commit(window, document.querySelector('#edgeListHost input.el-from[data-edge-id="e1"]'), 'C');
  await settle(window, 250);
  assert.equal(listWeight(document, 'e1').value, '99', 'the uncommitted draft survived a render of its own row');

  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('P2: expanded edge-list rows are reconciled and never show an undone value', async () => {
  const { dom, errors } = createEditorDom(baseGraph({ edgeListPageSize: 2 }));
  const { window } = dom; const { document } = window;
  await settle(window, 250);

  assert.equal(listRows(document), 2, 'the list starts at one page of two');
  document.querySelector('#btnEdgeListMore').click();
  await settle(window, 200);
  assert.equal(listRows(document), 4, 'show more expanded the list to four rows');

  const third = listWeight(document, 'e3');
  assert.equal(third.value, '6', 'the third row is e3');
  commit(window, third, '42');
  await settle(window, 250);
  assert.equal(cellText(document, 'c', 'a'), '42', 'the matrix followed the edit');

  document.querySelector('#btnUndo').click();
  await settle(window, 300);

  assert.equal(cellText(document, 'c', 'a'), '6', 'the matrix shows the undone weight');
  const stale = [...document.querySelectorAll('#edgeListHost input.el-weight')].filter(i => i.value === '42');
  assert.deepEqual(stale.map(i => i.dataset.edgeId), [], 'no visible list row still shows the undone 42');
  assert.equal(listWeight(document, 'e3')?.value ?? '6', '6', 'e3 reads the model weight wherever it is rendered');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('P2: a directed edge selection does not highlight the reverse matrix cell', async () => {
  const { dom, errors } = createEditorDom(baseGraph());
  const { window } = dom; const { document } = window;
  await settle(window, 200);

  assert.equal(cellOf(document, 'a', 'b').dataset.e, 'e1', 'a→b holds e1');
  assert.equal(cellOf(document, 'b', 'a').dataset.e, '', 'b→a holds no edge (e1 is directed)');

  // One press selects the cell's edge without opening an editor.
  dispatchPointer(window, cellOf(document, 'a', 'b'), 'pointerdown');
  await settle(window, 80);
  assert.ok(cellOf(document, 'a', 'b').classList.contains('matrix-selected'), 'the selected cell is highlighted');

  // Any matrix render re-syncs selection from scratch.
  commit(window, listWeight(document, 'e2'), '77');
  await settle(window, 250);

  assert.ok(cellOf(document, 'a', 'b').classList.contains('matrix-selected'), 'the selected cell stays highlighted');
  assert.ok(!cellOf(document, 'b', 'a').classList.contains('matrix-selected'),
    'the reverse cell of a DIRECTED edge stays dark — it holds no selected edge');

  // The other half of the rule: an UNDIRECTED edge really is mirrored into both
  // cells by adjacencyMatrixData, so both must light up. Dropping the reverse
  // lookup has to cost nothing here.
  dispatchPointer(window, cellOf(document, 'c', 'd'), 'pointerdown'); // selects e4 (undirected c—d)
  await settle(window, 80);
  commit(window, listWeight(document, 'e2'), '88');
  await settle(window, 250);
  assert.ok(cellOf(document, 'c', 'd').classList.contains('matrix-selected'), 'the pressed cell of the undirected edge is highlighted');
  assert.ok(cellOf(document, 'd', 'c').classList.contains('matrix-selected'), 'its mirror is highlighted too');
  assert.ok(!cellOf(document, 'a', 'b').classList.contains('matrix-selected'), 'the previous selection was replaced');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('P2: an armed cell does not disable the patch path', async () => {
  const { dom, errors } = createEditorDom(baseGraph());
  const { window } = dom; const { document } = window;
  await settle(window, 200);
  const tableBefore = document.querySelector('#matrixHost table');
  assert.ok(tableBefore, 'the matrix rendered');

  // First press of the select-then-edit gesture: the cell is armed/selected but
  // no editor is open, so there is nothing for capture/restore to preserve.
  dispatchPointer(window, cellOf(document, 'a', 'b'), 'pointerdown');
  await settle(window, 80);
  assert.equal(cellOf(document, 'a', 'b').querySelector('input'), null, 'no editor is open');

  commit(window, listWeight(document, 'e2'), '77');
  await settle(window, 250);

  assert.equal(document.querySelector('#matrixHost table'), tableBefore,
    'the matrix was patched in place — an armed cell must not force a full replacement');
  assert.equal(cellText(document, 'b', 'c'), '77', 'the edited cell updated');

  // And it keeps patching on later renders.
  commit(window, listWeight(document, 'e3'), '88');
  await settle(window, 250);
  assert.equal(document.querySelector('#matrixHost table'), tableBefore, 'the next render patches too');
  assert.equal(cellText(document, 'c', 'a'), '88');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('P2: a render builds one visible-id set, not one per edge', async () => {
  const graph = rangedGraph(12); // 132 directed edges, all inside the range
  const { dom, errors, counters } = createEditorDom(graph, { countSets: true });
  const { window } = dom; const { document } = window;
  await settle(window, 700);
  assert.equal(document.querySelectorAll('#edgeListHost tbody tr').length, 132, 'every edge is listed');

  const first = document.querySelector('#edgeListHost input.el-weight');
  const before = counters.sets;
  commit(window, first, '99');
  await settle(window, 500);
  const delta = counters.sets - before;

  assert.ok(delta < 40,
    `one render constructed ${delta} Sets; the visible-id set must be built once per render, not once per edge`);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('P3: endpoint tooltips follow a reassigned endpoint', async () => {
  const { dom, errors } = createEditorDom(baseGraph());
  const { window } = dom; const { document } = window;
  await settle(window, 200);

  const from = document.querySelector('#edgeListHost input.el-from[data-edge-id="e1"]');
  assert.equal(from.value, 'A');
  assert.ok(from.title.includes('a'), `the tooltip starts out naming the source id, got "${from.title}"`);
  const titleBefore = from.title;

  // Reassign the source of e1 from A to C.
  commit(window, from, 'C');
  await settle(window, 250);

  const after = document.querySelector('#edgeListHost input.el-from[data-edge-id="e1"]');
  assert.equal(after.value, 'C', 'the endpoint moved');
  assert.notEqual(after.title, titleBefore, 'the tooltip was refreshed');
  assert.ok(after.title.includes('c'), `the tooltip names the new source id, got "${after.title}"`);
  assert.ok(!after.title.includes(': a'), `the tooltip no longer names the old source id, got "${after.title}"`);
  assert.equal(cellText(document, 'c', 'b'), '3', 'the matrix cell moved with the endpoint');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('P3: a node added outside the visible range re-enables the reorder buttons', async () => {
  const graph = baseGraph({ visibleRange: { start: 0, end: 1 } });
  graph.nodes = graph.nodes.slice(0, 2); // only A and B exist
  graph.edges = graph.edges.filter(e => ['a', 'b'].includes(e.from) && ['a', 'b'].includes(e.to));
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await settle(window, 250);

  assert.equal(document.querySelectorAll('#matrixHost tbody tr').length, 2, 'two rows are visible');
  const moveButtons = () => [...document.querySelectorAll('#matrixHost button[data-node-move="b"][data-dir="1"]')];
  assert.ok(moveButtons().length > 0, 'B has move-forward buttons');
  assert.ok(moveButtons().every(b => b.disabled), 'B is last in the graph, so moving forward is disabled');

  // The new node lands outside the 0–1 range: the visible rows do not change,
  // but B is no longer the last node in the graph.
  document.querySelector('#btnMatrixAddNode').click();
  await settle(window, 300);

  assert.equal(document.querySelectorAll('#matrixHost tbody tr').length, 2, 'the new node is outside the visible range');
  assert.ok(moveButtons().every(b => !b.disabled),
    'B can now move forward, so its buttons must be enabled');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});
