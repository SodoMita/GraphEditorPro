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
// Typing, as the browser reports it: `input` fires for user edits only. A
// programmatic assignment (the session restore after a rebuild, an Undo
// re-render) never fires it — that is how the app tells them apart.
const typeInto = (window, element, value) => {
  element.value = value;
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
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

test('a press inside an open editor keeps native caret behaviour', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  const cell = cellOf(document, 'a', 'b');
  dispatchPointer(window, cell, 'pointerdown');
  dispatchPointer(window, cell, 'pointerdown');
  const input = cell.querySelector('input.matrix-input');
  assert.equal(input.readOnly, false, 'the editor is open');

  // A press on the field that is already open belongs to the text editor:
  // the handler must not preventDefault it (that froze the caret and blocked
  // drag-selection) and must not commit/demote the editor.
  const event = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 5, clientY: 5 });
  Object.defineProperties(event, { pointerId: { value: 2 }, pointerType: { value: 'mouse' } });
  input.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false, 'a press inside the open editor is not preventDefault-ed');
  assert.equal(document.activeElement, input, 'the editor keeps the focus');
  assert.equal(input.readOnly, false, 'the editor stays unlocked');
  assert.equal(cellOf(document, 'a', 'b').querySelector('input.matrix-input'), input, 'the press did not commit or demote the editor');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('an open editor survives a matrix rebuild with value and caret', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  const cell = cellOf(document, 'a', 'b');
  dispatchPointer(window, cell, 'pointerdown');
  dispatchPointer(window, cell, 'pointerdown');
  const input = cell.querySelector('input.matrix-input');
  // Type, as a user does: the `input` event is what marks the session as having
  // a draft. A session WITHOUT one only re-reads the model on restore, so a
  // graph that moved while the editor was open is not masked by stale text.
  typeInto(window, input, '77');
  input.setSelectionRange(1, 2);

  // A rebuild unrelated to the editor (adding a node queues a matrix
  // re-render) must not destroy it: the session is captured and re-opened on
  // the fresh DOM, value and caret included.
  document.querySelector('#btnMatrixAddNode').click();
  await nextFrame(window); await settle(window, 120);

  const after = cellOf(document, 'a', 'b').querySelector('input.matrix-input');
  assert.ok(after, 'the editor was re-opened on the rebuilt matrix');
  assert.equal(after.value, '77', 'the typed value survived the rebuild');
  assert.equal(after.selectionStart, 1, 'the caret start survived the rebuild');
  assert.equal(after.selectionEnd, 2, 'the caret end survived the rebuild');
  assert.equal(after.readOnly, false, 'the re-opened editor is unlocked');
  assert.equal(document.activeElement, after, 'the re-opened editor owns the focus');
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

const edgeWeightOf = (document, id) => {
  const i = document.querySelector(`#edgeListHost input.edge-weight[data-edge-id="${id}"]`);
  return i ? i.value : null;
};
const selectedEdgeIds = document => [...document.querySelectorAll('#edgeListHost input.edge-weight.matrix-selected')].map(i => i.dataset.edgeId);

test('a blur with text the browser never reports still commits the edit', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  const cell = cellOf(document, 'a', 'b');
  dispatchPointer(window, cell, 'pointerdown');
  dispatchPointer(window, cell, 'pointerdown');
  const input = cell.querySelector('input.matrix-input');
  assert.equal(input.readOnly, false, 'the editor is open');

  typeInto(window, input, '77');
  // A rebuild lands before the blur (adding a node queues a matrix re-render),
  // so the session is re-opened on the fresh DOM with its text assigned
  // PROGRAMMATICALLY. That clears the browser's dirty flag: no `change` event
  // will ever follow, only the blur. The matrix used to keep displaying the
  // restored text while the graph held the old weight, and a reload revealed
  // the loss.
  document.querySelector('#btnMatrixAddNode').click();
  await nextFrame(window); await settle(window, 120);
  const restored = cellOf(document, 'a', 'b').querySelector('input.matrix-input');
  assert.ok(restored, 'the editor was re-opened on the rebuilt matrix');
  assert.equal(restored.value, '77', 'the typed text survived the rebuild');

  restored.blur();
  await nextFrame(window); await settle(window, 120);

  assert.equal(edgeWeightOf(document, 'e1'), '77', 'the unreported text reached the graph');
  assert.equal(cellOf(document, 'a', 'b').textContent, '77', 'the grid shows the committed weight');

  // The commit closes the session: one press selects, it does not re-open.
  const after = cellOf(document, 'a', 'b');
  dispatchPointer(window, after, 'pointerdown');
  await settle(window, 40);
  assert.equal(cellOf(document, 'a', 'b').querySelector('input'), null, 'one press after the commit only selects');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a deferred commit does not overwrite a selection made while it waited', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  const x = cellOf(document, 'a', 'b'); // edge e1
  const y = cellOf(document, 'b', 'c'); // edge e2
  dispatchPointer(window, x, 'pointerdown');
  dispatchPointer(window, x, 'pointerdown');
  const input = x.querySelector('input.matrix-input');
  assert.equal(input.readOnly, false, 'the editor for e1 is open');

  // One gesture, in browser order: the press on Y first blurs X (firing its
  // `change`, whose commit is deferred to a microtask) and then selects Y. The
  // deferred commit must not re-select X on top of that newer selection.
  changeValue(window, input, '11');
  dispatchPointer(window, y, 'pointerdown');
  await nextFrame(window); await settle(window, 120);

  assert.equal(edgeWeightOf(document, 'e1'), '11', 'the edit committed');
  assert.deepEqual(selectedEdgeIds(document), ['e2'], 'the pressed cell keeps the selection');
  assert.ok(cellOf(document, 'b', 'c').classList.contains('matrix-selected'), 'the matrix marks the pressed cell');
  assert.ok(!cellOf(document, 'a', 'b').classList.contains('matrix-selected'), 'the matrix dropped the edited cell');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

// A cell holding two parallel edges where one has no weight renders ";7".
function parallelEdgeGraph() {
  const g = matrixGraph();
  g.edges = [
    { id: 'e3', from: 'a', to: 'b', directed: true, weight: '', label: '', type: '' },
    { id: 'e1', from: 'a', to: 'b', directed: true, weight: '7', label: '', type: '' },
    { id: 'e2', from: 'b', to: 'c', directed: true, weight: '5', label: '', type: '' },
  ];
  g.nextEdge = 4;
  return g;
}

const abEdgeRows = document => [...document.querySelectorAll('#edgeListHost tbody tr')]
  .filter(tr => tr.querySelector('.el-from')?.value === 'A' && tr.querySelector('.el-to')?.value === 'B');

test('blurring a re-opened editor does not undo an Undo', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  // Commit 42 over the weight 2.
  const cell = cellOf(document, 'a', 'b');
  dispatchPointer(window, cell, 'pointerdown');
  dispatchPointer(window, cell, 'pointerdown');
  const input = cell.querySelector('input.matrix-input');
  typeInto(window, input, '42');
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window); await settle(window, 120);
  assert.equal(edgeWeightOf(document, 'e1'), '42', 'the edit committed');

  // Re-open the same cell WITHOUT typing, then Undo underneath it. Ctrl+Z is
  // handled while a matrix field has focus, so the editor stays open and the
  // rebuild re-opens it on the fresh DOM with its old text.
  const reopened = cellOf(document, 'a', 'b');
  dispatchPointer(window, reopened, 'pointerdown');
  dispatchPointer(window, reopened, 'pointerdown');
  const open = cellOf(document, 'a', 'b').querySelector('input.matrix-input');
  assert.ok(open, 'the cell is being edited again');
  assert.equal(open.value, '42');
  document.querySelector('#btnUndo').click();
  await nextFrame(window); await settle(window, 120);
  assert.equal(edgeWeightOf(document, 'e1'), '2', 'Undo restored the previous weight');
  const restored = cellOf(document, 'a', 'b').querySelector('input.matrix-input');
  assert.ok(restored, 'the open editor survived the Undo re-render');
  // The session holds no draft, so the restore re-reads the MODEL instead of
  // replaying the captured text — the focused editor shows the undone value.
  assert.equal(restored.value, '2', 'the restored editor shows the undone value, not the stale one');

  // Blurring must not treat that stale text as an uncommitted edit: nobody
  // typed in this session, so the graph keeps the undone value.
  restored.blur();
  await nextFrame(window); await settle(window, 120);
  assert.equal(edgeWeightOf(document, 'e1'), '2', 'the blur did not write 42 back over the Undo');
  assert.equal(cellOf(document, 'a', 'b').textContent, '2', 'the cell shows what the graph holds');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a blur commits parallel-edge text that changes how many values the cell has', async () => {
  const { dom, errors } = createEditorDom(parallelEdgeGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  const cell = cellOf(document, 'a', 'b');
  assert.equal(cell.textContent, ';7', 'the parallel unweighted edge renders as an empty value');
  dispatchPointer(window, cell, 'pointerdown');
  dispatchPointer(window, cell, 'pointerdown');
  const input = cell.querySelector('input.matrix-input');
  // One value for two edges: a plain `change` commit drops the extra edge.
  typeInto(window, input, '7');

  // A rebuild lands before the blur, so the text is restored programmatically
  // and no `change` will ever report it.
  document.querySelector('#btnMatrixAddNode').click();
  await nextFrame(window); await settle(window, 120);
  const restored = cellOf(document, 'a', 'b').querySelector('input.matrix-input');
  assert.ok(restored, 'the editor was re-opened on the rebuilt matrix');
  assert.equal(restored.value, '7', 'the typed text survived the rebuild');

  restored.blur();
  await nextFrame(window); await settle(window, 120);
  const rows = abEdgeRows(document);
  assert.equal(rows.length, 1, 'the blur removed the parallel edge (empty values are significant)');
  assert.equal(rows[0].querySelector('.el-weight').value, '7', 'the surviving edge keeps the weight');
  assert.equal(cellOf(document, 'a', 'b').textContent, '7');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a deferred commit keeps the cell the blurring press armed', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  const x = cellOf(document, 'a', 'b'); // edge e1
  dispatchPointer(window, x, 'pointerdown');
  dispatchPointer(window, x, 'pointerdown');
  const input = x.querySelector('input.matrix-input');
  assert.equal(input.readOnly, false, 'the editor for e1 is open');

  // One gesture: the press on the other cell blurs this editor (its `change`
  // commit is deferred) and arms the cell it pressed.
  changeValue(window, input, '11');
  const y = cellOf(document, 'b', 'c'); // edge e2
  dispatchPointer(window, y, 'pointerdown');
  await nextFrame(window); await settle(window, 120);
  assert.equal(edgeWeightOf(document, 'e1'), '11', 'the edit committed');

  // The armed cell must still be armed: ONE more press opens its editor. With
  // the armed state cleared by the deferred commit this press only selected,
  // and switching cells took a third click.
  const y2 = cellOf(document, 'b', 'c');
  dispatchPointer(window, y2, 'pointerdown');
  await settle(window, 40);
  const yInput = cellOf(document, 'b', 'c').querySelector('input.matrix-input');
  assert.ok(yInput, 'the second press on the armed cell opens its editor');
  assert.equal(yInput.readOnly, false, 'the editor is unlocked');
  assert.equal(yInput.value, '5', 'the editor is pre-filled with the cell weight');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a label restored after a rebuild commits on blur without a change event', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  // Open node A's label editor (two presses) and type in it.
  let label = labelOf(document, 'a');
  dispatchPointer(window, label, 'pointerdown');
  dispatchPointer(window, label, 'pointerdown');
  label = labelOf(document, 'a');
  assert.equal(label.readOnly, false, 'the second press unlocks the label');
  typeInto(window, label, 'Beta');

  // A rebuild lands before the blur, so the session is re-opened on the fresh
  // DOM with its text assigned programmatically: no `change` will ever report
  // it, exactly like the weight-cell case.
  document.querySelector('#btnMatrixAddNode').click();
  await nextFrame(window); await settle(window, 120);
  const restored = labelOf(document, 'a');
  assert.equal(restored.value, 'Beta', 'the typed label survived the rebuild');
  assert.equal(restored.readOnly, false, 'the re-opened label is unlocked');
  assert.equal(document.activeElement, restored, 'the re-opened label owns the focus');

  restored.blur();
  await nextFrame(window); await settle(window, 150);
  const after = labelOf(document, 'a');
  assert.equal(after.value, 'Beta', 'the unreported label reached the graph');
  assert.equal(after.readOnly, true, 'the label commit re-locks the field');
  // Both label instances (column header and row head) render the model.
  const header = document.querySelector('#matrixHost thead th input[data-node-label="a"]');
  assert.equal(header.value, 'Beta', 'the column header shows the committed label');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('blurring a re-opened label editor does not undo an Undo', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);
  const headerLabel = () => document.querySelector('#matrixHost thead th input[data-node-label="a"]');

  // Commit the label Alpha for node A.
  let label = labelOf(document, 'a');
  dispatchPointer(window, label, 'pointerdown');
  dispatchPointer(window, label, 'pointerdown');
  label = labelOf(document, 'a');
  typeInto(window, label, 'Alpha');
  label.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window); await settle(window, 150);
  assert.equal(labelOf(document, 'a').value, 'Alpha', 'the label commit renamed the node');

  // Re-open the SAME label without typing, then Undo underneath it. Only the
  // row-head instance is restored, so the column header keeps rendering the
  // model and is an honest read of the graph.
  const reopened = labelOf(document, 'a');
  dispatchPointer(window, reopened, 'pointerdown');
  dispatchPointer(window, reopened, 'pointerdown');
  const open = labelOf(document, 'a');
  assert.equal(open.readOnly, false, 'the label is being edited again');
  assert.equal(open.value, 'Alpha');
  document.querySelector('#btnUndo').click();
  await nextFrame(window); await settle(window, 150);
  assert.equal(headerLabel().value, 'A', 'Undo restored the previous label');
  const restored = labelOf(document, 'a');
  assert.equal(restored.readOnly, false, 'the open label survived the Undo re-render');
  // No draft in this session, so the restore re-reads the model: the focused
  // label shows the undone value instead of the stale text.
  assert.equal(restored.value, 'A', 'the restored label shows the undone value');

  // Nobody typed in this session, so the blur must not write the stale label
  // back over the Undo — it mirrors the model into the field instead.
  restored.blur();
  await nextFrame(window); await settle(window, 120);
  assert.equal(headerLabel().value, 'A', 'the graph kept the undone label');
  assert.equal(labelOf(document, 'a').value, 'A', 'the field shows what the graph holds');
  assert.equal(labelOf(document, 'a').readOnly, true, 'the label re-locks');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

// Three parallel edges a->b weighted "7", "", "" — the cell renders "7;;".
function parallel3Graph() {
  const g = matrixGraph();
  g.edges = [
    { id: 'p1', from: 'a', to: 'b', directed: true, weight: '7', label: '', type: '' },
    { id: 'p2', from: 'a', to: 'b', directed: true, weight: '', label: '', type: '' },
    { id: 'p3', from: 'a', to: 'b', directed: true, weight: '', label: '', type: '' },
    { id: 'e2', from: 'b', to: 'c', directed: true, weight: '5', label: '', type: '' },
  ];
  g.nextEdge = 4;
  return g;
}

// Node A's label as the EDGE LIST renders it — a model read that cannot be an
// open matrix editor showing its own draft.
const nodeALabelInGraph = document => {
  const w = document.querySelector('#edgeListHost input.edge-weight[data-edge-id="e1"]');
  const tr = w && w.closest('tr');
  return tr ? tr.querySelector('.el-from').value : null;
};
const headerLabelOf = (document, id) => document.querySelector(`#matrixHost thead th input[data-node-label="${id}"]`);

test('clicking the other label instance commits the restored row-label draft', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  // Commit a cell edit — that queues a matrix rebuild ~60ms out.
  const cell = cellOf(document, 'a', 'b');
  dispatchPointer(window, cell, 'pointerdown');
  dispatchPointer(window, cell, 'pointerdown');
  const cellInput = cell.querySelector('input.matrix-input');
  typeInto(window, cellInput, '11');
  cellInput.dispatchEvent(new window.Event('change', { bubbles: true }));

  // Open node A's ROW label before that rebuild lands, and type into it: the
  // rebuild re-opens the label with its text assigned programmatically, so no
  // `change` will ever report the draft.
  let row = labelOf(document, 'a');
  dispatchPointer(window, row, 'pointerdown');
  dispatchPointer(window, row, 'pointerdown');
  row = labelOf(document, 'a');
  typeInto(window, row, 'Alpha');
  await nextFrame(window); await settle(window, 150);
  const restored = labelOf(document, 'a');
  assert.equal(restored.value, 'Alpha', 'the row-label draft survived the rebuild');
  assert.equal(restored.readOnly, false, 'the restored label is unlocked');
  assert.equal(document.activeElement, restored, 'the restored label owns the focus');

  // Click the SAME node's COLUMN label: that opens the other instance while the
  // row label's deferred blur is still pending. The draft belongs to the field
  // that was typed in, so a new session must not throw it away.
  dispatchPointer(window, headerLabelOf(document, 'a'), 'pointerdown');
  await nextFrame(window); await settle(window, 150);

  assert.equal(nodeALabelInGraph(document), 'Alpha', 'the restored draft reached the graph');
  assert.equal(labelOf(document, 'a').value, 'Alpha', 'the row head shows the commit');
  const col = headerLabelOf(document, 'a');
  assert.equal(col.value, 'Alpha', 'the column head shows the commit');
  assert.equal(col.readOnly, false, 'the column editor the click opened is still unlocked');
  assert.equal(document.activeElement, col, 'the column editor kept the focus');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('consecutive empty values survive normalisation, so the blur commit lands', async () => {
  const { dom, errors } = createEditorDom(parallel3Graph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  const cell = cellOf(document, 'a', 'b');
  assert.equal(cell.textContent, '7;;', 'three parallel edges render two empty values');
  dispatchPointer(window, cell, 'pointerdown');
  dispatchPointer(window, cell, 'pointerdown');
  const input = cell.querySelector('input.matrix-input');
  // One value for three edges: a commit keeps a single edge.
  typeInto(window, input, '7;');

  // A rebuild lands before the blur, so the text is restored programmatically
  // and only the blur fallback can commit it.
  document.querySelector('#btnMatrixAddNode').click();
  await nextFrame(window); await settle(window, 150);
  const restored = cellOf(document, 'a', 'b').querySelector('input.matrix-input');
  assert.ok(restored, 'the editor was re-opened on the rebuilt matrix');
  assert.equal(restored.value, '7;', 'the draft survived the rebuild');

  restored.blur();
  await nextFrame(window); await settle(window, 150);
  const rows = abEdgeRows(document);
  assert.equal(rows.length, 1, 'the blur dropped the two extra parallel edges');
  assert.equal(rows[0].querySelector('.el-weight').value, '7', 'the surviving edge keeps the weight');
  assert.equal(cellOf(document, 'a', 'b').textContent, '7');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a keystroke after Undo edits the undone value, not the stale one', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  const cell = cellOf(document, 'a', 'b');
  dispatchPointer(window, cell, 'pointerdown');
  dispatchPointer(window, cell, 'pointerdown');
  const input = cell.querySelector('input.matrix-input');
  typeInto(window, input, '42');
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window); await settle(window, 150);
  assert.equal(edgeWeightOf(document, 'e1'), '42', 'the edit committed');

  // Re-open without typing, Undo, then keep typing in the focused editor.
  const reopened = cellOf(document, 'a', 'b');
  dispatchPointer(window, reopened, 'pointerdown');
  dispatchPointer(window, reopened, 'pointerdown');
  document.querySelector('#btnUndo').click();
  await nextFrame(window); await settle(window, 150);
  assert.equal(edgeWeightOf(document, 'e1'), '2', 'Undo restored the previous weight');
  const restored = cellOf(document, 'a', 'b').querySelector('input.matrix-input');
  assert.ok(restored, 'the editor is still open after the Undo');
  assert.equal(document.activeElement, restored, 'the editor owns the focus');
  assert.equal(restored.value, '2', 'the open editor shows the undone value');

  typeInto(window, restored, restored.value + '0');
  restored.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window); await settle(window, 150);
  assert.equal(edgeWeightOf(document, 'e1'), '20', 'the keystroke edited the undone value, not 420');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a label editor opened over a pending commit is pre-filled from the model', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  let row = labelOf(document, 'a');
  dispatchPointer(window, row, 'pointerdown');
  dispatchPointer(window, row, 'pointerdown');
  row = labelOf(document, 'a');
  typeInto(window, row, 'Alpha');

  // Click the SAME node's column label and type straight away. The row commit is
  // deferred to the end of the gesture, so the DOM still shows "A": the new
  // editor has to be pre-filled from the MODEL, otherwise the keystroke anchors
  // stale text as a draft and the restore replays it over the commit.
  dispatchPointer(window, headerLabelOf(document, 'a'), 'pointerdown');
  const col = headerLabelOf(document, 'a');
  assert.equal(col.value, 'Alpha', 'the new editor shows the committed label');
  assert.equal(col.readOnly, false, 'the column editor is open');
  assert.equal(document.activeElement, col, 'the column editor owns the focus');
  typeInto(window, col, `${col.value}X`);
  await nextFrame(window); await settle(window, 150);

  dispatchPointer(window, cellOf(document, 'b', 'c'), 'pointerdown');
  await nextFrame(window); await settle(window, 150);
  assert.equal(nodeALabelInGraph(document), 'AlphaX', 'the keystroke appended instead of overwriting');
  assert.equal(labelOf(document, 'a').value, 'AlphaX', 'the row head agrees');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a cell editor opened before an Undo rebuild shows the undone value', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  const cell = cellOf(document, 'a', 'b');
  dispatchPointer(window, cell, 'pointerdown');
  dispatchPointer(window, cell, 'pointerdown');
  const input = cell.querySelector('input.matrix-input');
  typeInto(window, input, '42');
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window); await settle(window, 120);
  assert.equal(edgeWeightOf(document, 'e1'), '42', 'the edit committed');

  // Undo reverts the model but the matrix rebuild is debounced ~60ms out, so the
  // DOM still reads 42. Opening the cell in that window must show the MODEL.
  document.querySelector('#btnUndo').click();
  const stale = cellOf(document, 'a', 'b');
  assert.equal(stale.textContent.trim(), '42', 'the cell text is still the pre-Undo DOM');
  dispatchPointer(window, stale, 'pointerdown');
  dispatchPointer(window, stale, 'pointerdown');
  const open = cellOf(document, 'a', 'b').querySelector('input.matrix-input');
  assert.ok(open, 'the cell is being edited');
  assert.equal(open.value, '2', 'the editor shows the undone value, not the stale one');
  const ghost = cellOf(document, 'a', 'b').querySelector('span.mc-ghost');
  assert.equal(ghost.textContent, '2', 'the hidden placeholder matches the shown text');
  await nextFrame(window); await settle(window, 150);
  assert.equal(edgeWeightOf(document, 'e1'), '2', 'opening the editor changed nothing');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

// --- Rebuild avoidance (dense-graph freeze fix) ---------------------------
// A dense matrix (32 nodes = 992 cells) used to rebuild #matrixHost from a
// ~1.5 MB innerHTML string on EVERY render — including the selection-only and
// single-cell-edit renders that fire constantly while editing. That is what
// froze the tab. The renderer now diffs per-row content signatures and patches
// only the rows that actually changed, so the <table> and untouched rows stay
// the same DOM nodes. These tests pin that contract: they fail on a build that
// still swaps innerHTML wholesale and pass on the patching build.
test('a committed weight edit patches the matrix in place instead of rebuilding the table', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  const tableBefore = document.querySelector('#matrixHost table');
  assert.ok(tableBefore, 'the matrix table rendered');
  const rowBefore = cellOf(document, 'a', 'b').closest('tr');
  const otherRowBefore = cellOf(document, 'c', 'a').closest('tr');

  const cell = cellOf(document, 'a', 'b');
  dispatchPointer(window, cell, 'pointerdown');
  dispatchPointer(window, cell, 'pointerdown');
  const input = cell.querySelector('input.matrix-input');
  changeValue(window, input, '9');
  // A real commit blurs (the user clicks away or tabs out) before the ~60ms
  // debounced rebuild lands, so no matrix field is focused at render time and
  // the patch path runs. Leaving focus in the cell would force a full rebuild
  // (the patcher never touches a focused field), which is the correct but
  // slower path — not the one this test pins.
  input.blur();
  await nextFrame(window); await settle(window, 120);

  const tableAfter = document.querySelector('#matrixHost table');
  assert.equal(tableAfter, tableBefore, 'the <table> element was patched, not replaced by an innerHTML swap');
  assert.equal(cellOf(document, 'a', 'b').closest('tr'), rowBefore, 'the edited row node is preserved');
  assert.equal(cellOf(document, 'c', 'a').closest('tr'), otherRowBefore, 'an untouched row node is preserved');
  assert.equal(cellOf(document, 'a', 'b').textContent, '9', 'the cell shows the committed weight');
  assert.equal(cellOf(document, 'a', 'b').querySelector('input'), null, 'the editor demoted back to lightweight text');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('editing a weight in the edge list updates the matrix cell', async () => {
  const { dom, errors } = createEditorDom(matrixGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  assert.equal(cellOf(document, 'a', 'b').textContent, '2', 'the cell starts at the model weight');
  const listInput = document.querySelector('#edgeListHost input.el-weight[data-edge-id="e1"]');
  assert.ok(listInput, 'the edge-list weight input rendered');
  listInput.value = '11';
  listInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window); await settle(window, 120);

  // The list handler used to call queueRender(false) (canvas only), so the
  // matrix cell kept showing the stale weight after a list edit. It now
  // re-renders the matrix too, and the patch layer updates just that cell.
  assert.equal(edgeWeightOf(document, 'e1'), '11', 'the model took the list edit');
  assert.equal(cellOf(document, 'a', 'b').textContent, '11', 'the matrix cell follows the edge-list weight');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});
