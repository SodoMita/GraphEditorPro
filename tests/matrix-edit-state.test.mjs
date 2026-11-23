// Regression tests for the adjacency-matrix edit session state machine:
//  - promoting a lightweight <td> to an editor keeps the cell's own text as a
//    hidden width placeholder (so the table never reflows while editing);
//  - committing a weight edit closes the session (next single click selects);
//  - committing a NODE LABEL edit closes the session too. The change handler
//    used to reset the armed-cell state only for weight inputs, so a later
//    single click reopened the label editor while a canvas selection made in
//    between stayed in force (selection-based actions hit the wrong node).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createWebLocks } from './helpers/web-locks.mjs';

const html = await readFile('index.html', 'utf8');

function createEditorDom(savedGraph) {
  const errors = [];
  const source = html.replace('<script>', `<script>localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(savedGraph))});</script><script>`);
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(source, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://offline.test/', virtualConsole,
    beforeParse(window) {
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
  return { dom, errors };
}

const nextFrame = window => new Promise(resolve => window.setTimeout(resolve, 30));
const settle = (window, ms) => new Promise(resolve => window.setTimeout(resolve, ms));

function dispatchPointer(window, target, type, options = {}) {
  const event = new window.MouseEvent(type, {
    bubbles: true, cancelable: true,
    button: options.button ?? 0,
    clientX: options.clientX ?? 10, clientY: options.clientY ?? 10,
    shiftKey: Boolean(options.shiftKey),
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    pointerType: { value: options.pointerType ?? 'mouse' },
  });
  target.dispatchEvent(event);
}

const changeValue = (window, element, value) => {
  element.value = value;
  element.dispatchEvent(new window.Event('change', { bubbles: true }));
};

function matrixGraph() {
  return {
    title: 'matrix-edit',
    mode: 'select',
    nextNode: 4, nextEdge: 3,
    nodes: [
      { id: 'a', label: 'A', x: -200, y: 0, order: 0 },
      { id: 'b', label: 'B', x: 200, y: 0, order: 1 },
      { id: 'c', label: 'C', x: 0, y: 200, order: 2 },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', directed: true, weight: '2', label: '', type: '' },
      { id: 'e2', from: 'b', to: 'c', directed: true, weight: '5', label: '', type: '' },
    ],
    customAttributes: [],
    graphCustom: {},
    settings: {},
  };
}

const cellOf = (document, from, to) => document.querySelector(`#matrixHost tr[data-r="${from}"] td[data-c="${to}"]`);
const labelOf = (document, id) => document.querySelector(`#matrixHost tbody th.row-head input[data-node-label="${id}"]`);

test('promoting a matrix cell keeps its text as a hidden width placeholder', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  const cell = cellOf(document, 'a', 'b');
  assert.equal(cell.textContent, '2');
  dispatchPointer(window, cell, 'pointerdown');
  dispatchPointer(window, cell, 'pointerdown');
  const input = cell.querySelector('input.matrix-input');
  assert.ok(input, 'the second press promotes the cell to an input');
  assert.equal(input.value, '2', 'the editor is pre-filled with the weight');
  assert.equal(input.readOnly, false, 'the promoted editor is unlocked');
  const ghost = cell.querySelector('span.mc-ghost');
  assert.ok(ghost, 'the cell keeps a width placeholder while editing');
  assert.equal(ghost.textContent, '2', 'the placeholder carries the cell text so the column width cannot change');
  assert.equal(ghost.getAttribute('aria-hidden'), 'true', 'the placeholder is hidden from assistive tech');
  assert.equal(cell.textContent, '2', 'the cell text survives promotion (layout-neutral edit)');

  // An empty cell mirrors the CSS "0" glyph in its placeholder so promoting
  // it cannot shrink the column either.
  const empty = cellOf(document, 'c', 'a');
  assert.equal(empty.textContent, '');
  dispatchPointer(window, empty, 'pointerdown');
  dispatchPointer(window, empty, 'pointerdown');
  const emptyGhost = empty.querySelector('span.mc-ghost');
  assert.equal(emptyGhost && emptyGhost.textContent, '0', 'empty cells ghost the CSS zero glyph');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('committing a weight edit closes the edit session', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  const cell = cellOf(document, 'a', 'b');
  dispatchPointer(window, cell, 'pointerdown');
  dispatchPointer(window, cell, 'pointerdown');
  const input = cell.querySelector('input.matrix-input');
  changeValue(window, input, '9');
  await nextFrame(window); await settle(window, 90);

  // The commit re-rendered the matrix: the cell is a lightweight <td> again.
  const after = cellOf(document, 'a', 'b');
  assert.equal(after.querySelector('input'), null, 'the committed cell demotes back to text');
  assert.equal(after.textContent, '9');

  // A single press now selects — it must not reopen the editor.
  dispatchPointer(window, after, 'pointerdown');
  await settle(window, 20);
  assert.equal(cellOf(document, 'a', 'b').querySelector('input'), null, 'one press after a commit only selects');
  assert.ok(cellOf(document, 'a', 'b').classList.contains('matrix-selected'), 'the cell shows the selection');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('committing a node label edit closes the edit session (stale selection P2)', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  // Arm the label editor for node A the way a user does: two presses.
  let label = labelOf(document, 'a');
  dispatchPointer(window, label, 'pointerdown');
  dispatchPointer(window, label, 'pointerdown');
  label = labelOf(document, 'a');
  assert.equal(label.readOnly, false, 'the second press unlocks the label');

  changeValue(window, label, 'Alpha');
  await nextFrame(window); await settle(window, 120);
  assert.equal(labelOf(document, 'a').value, 'Alpha', 'the label commit renames the node');

  // The selection moves to B on the canvas while nothing is being edited —
  // a canvas press never touches the matrix edit session, which is exactly
  // why the stale armed state used to survive it.
  const canvasNode = document.querySelector('#canvasWrap g.node[data-id="b"]');
  assert.ok(canvasNode, 'node B is on the canvas');
  dispatchPointer(window, canvasNode, 'pointerdown');
  dispatchPointer(window, canvasNode, 'pointerup');
  await settle(window, 60);
  assert.deepEqual(
    [...document.querySelectorAll('#matrixHost input[data-node-label].matrix-selected')].map(i => i.dataset.nodeLabel),
    ['b', 'b'], 'the canvas press selected node B');

  // …so ONE press on A's label must select A again, not reopen the editor
  // with B still selected.
  label = labelOf(document, 'a');
  dispatchPointer(window, label, 'pointerdown');
  await settle(window, 40);
  label = labelOf(document, 'a');
  assert.equal(label.readOnly, true, 'a single press after a label commit does not reopen the editor');
  assert.ok(label.classList.contains('matrix-selected'), 'the single press selected node A');
  const selectedLabels = [...document.querySelectorAll('#matrixHost input[data-node-label].matrix-selected')].map(i => i.dataset.nodeLabel);
  assert.deepEqual(selectedLabels, ['a', 'a'], 'the stale canvas selection was replaced by A');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});
