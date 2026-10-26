import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

function createEditorDom(savedGraph = null) {
  const errors = [];
  const values = {};
  if (savedGraph) values['graph-editor-pro-v2'] = JSON.stringify(savedGraph);
  const preload = Object.entries(values)
    .map(([key, value]) => `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
    .join('');
  const documentHtml = preload
    ? html.replace('<script>', `<script>${preload}</script><script>`)
    : html;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(documentHtml, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://offline.test/',
    virtualConsole,
    beforeParse(window) {
      window.matchMedia = query => ({
        media: query, matches: false, onchange: null,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
        dispatchEvent() { return true; },
      });
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => null;
      window.URL.createObjectURL = () => 'blob:offline-test';
      window.URL.revokeObjectURL = () => {};
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { readText: async () => '', writeText: async () => {} },
      });
    },
  });
  return { dom, errors };
}

function setCanvasRect(svg) {
  svg.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0,
    width: 1000, height: 660, right: 1000, bottom: 660,
    toJSON() { return this; },
  });
}

function dispatchPointer(window, target, type, options) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: options.button ?? 0,
    clientX: options.clientX,
    clientY: options.clientY,
    shiftKey: Boolean(options.shiftKey),
    altKey: Boolean(options.altKey),
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId },
    pointerType: { value: options.pointerType ?? 'mouse' },
  });
  target.dispatchEvent(event);
}

const nextFrame = window => new Promise(resolve => window.setTimeout(resolve, 30));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function assertPos(node, x, y, label = node.id) {
  assert.ok(near(node.x, x, 1e-4) && near(node.y, y, 1e-4), `${label} at (${node.x}, ${node.y}), expected (${x}, ${y})`);
}

// A 200x200 square of wide nodes (n1..n4, 80x40) plus an unselected n5.
// Bounds of n1..n4 bodies: x 160..440, y 180..420, centre/pivot (300, 300).
// viewBox and the mocked canvas rect are both 1000x660 at the origin, so
// client coordinates equal world coordinates and 1 screen px = 1 world unit.
const baseGraph = {
  mode: 'select',
  viewBox: { x: 0, y: 0, w: 1000, h: 660 },
  nodes: [
    { id: 'n1', label: 'A', x: 200, y: 200, width: 80, height: 40, shape: 'square', color: '#ff0000' },
    { id: 'n2', label: 'B', x: 400, y: 200, width: 80, height: 40 },
    { id: 'n3', label: 'C', x: 400, y: 400, width: 80, height: 40 },
    { id: 'n4', label: 'D', x: 200, y: 400, width: 80, height: 40 },
    { id: 'n5', label: 'E', x: 650, y: 300 },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', directed: true, weight: '3' },
    { id: 'e2', from: 'n2', to: 'n3', directed: true },
    { id: 'e3', from: 'n2', to: 'n5', directed: false },
  ],
};

function exported(document) {
  document.querySelector('#btnExportJson').click();
  const modal = document.querySelector('.export-modal');
  const graph = JSON.parse(modal.querySelector('textarea').value);
  modal.remove();
  return graph;
}
const nodeMap = graph => Object.fromEntries(graph.nodes.map(n => [n.id, n]));

async function setup(t, graph = baseGraph) {
  const { dom, errors } = createEditorDom(graph);
  t.after(() => { dom.window.close(); assert.deepEqual(errors.map(e => e.message), []); });
  const { window } = dom;
  const { document } = window;
  await nextFrame(window);
  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  document.elementFromPoint = () => svg;
  const pointer = (target, type, x, y, options = {}) => dispatchPointer(window, target, type, {
    pointerId: 1, clientX: x, clientY: y, ...options,
  });
  const clickNode = async (id, x, y, options = {}) => {
    pointer(document.querySelector('#node-' + id), 'pointerdown', x, y, options);
    pointer(svg, 'pointerup', x, y, options);
    await nextFrame(window);
  };
  const selectSquare = async () => {
    await clickNode('n1', 200, 200);
    await clickNode('n2', 400, 200, { shiftKey: true });
    await clickNode('n3', 400, 400, { shiftKey: true });
    await clickNode('n4', 200, 400, { shiftKey: true });
  };
  const gizmoDrag = async (kind, from, to, options = {}) => {
    const el = document.querySelector(`#gizmoLayer [data-gizmo="${kind}"]`);
    assert.ok(el, `gizmo handle ${kind} is rendered`);
    pointer(el, 'pointerdown', from.x, from.y, options);
    pointer(svg, 'pointermove', to.x, to.y, options);
    await nextFrame(window);
    pointer(svg, 'pointerup', to.x, to.y, options);
    await nextFrame(window);
  };
  const key = (code, init = {}) => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: init.key ?? code, code, bubbles: true, shiftKey: Boolean(init.shiftKey) }));
  };
  const handles = () => [...document.querySelectorAll('#gizmoLayer [data-gizmo]')].map(e => e.dataset.gizmo);
  return { window, document, svg, pointer, clickNode, selectSquare, gizmoDrag, key, handles };
}

test('gizmo appears for a selection in select mode only, and tool choice persists', async t => {
  const { document, selectSquare, handles, key } = await setup(t);
  assert.deepEqual(handles(), [], 'no gizmo without a selection');
  assert.equal(document.querySelector('.canvas-wrap').classList.contains('gizmo-active'), false);
  await selectSquare();
  assert.deepEqual(handles(), ['move-x', 'move-y', 'move-free']);
  assert.equal(document.querySelector('.canvas-wrap').classList.contains('gizmo-active'), true);
  assert.equal(document.querySelector('[data-gizmotool="move"]').classList.contains('active'), true);

  document.querySelector('[data-gizmotool="rotate"]').click();
  assert.deepEqual(handles(), ['rotate', 'pivot']);
  document.querySelector('[data-gizmotool="scale"]').click();
  assert.deepEqual(handles(), ['scale-x', 'scale-y', 'scale-uniform', 'pivot']);
  document.querySelector('[data-gizmotool="rect"]').click();
  assert.deepEqual(handles(), ['rect-n', 'rect-e', 'rect-s', 'rect-w', 'rect-nw', 'rect-ne', 'rect-se', 'rect-sw', 'rect-move', 'pivot']);
  assert.equal(exported(document).gizmoTool, 'rect', 'gizmo tool is part of the saved document');

  key('Digit1', { key: '1' });
  assert.equal(exported(document).gizmoTool, 'move', 'Digit1 hotkey selects the translate gizmo');

  document.querySelector('#modeMove').click();
  assert.deepEqual(handles(), [], 'gizmo hides outside select mode');
  document.querySelector('#modeSelect').click();
  assert.deepEqual(handles(), ['move-x', 'move-y', 'move-free'], 'gizmo returns with select mode');
});

test('translate gizmo moves positions only: free drag, axis drag, undo/redo', async t => {
  const { window, document, selectSquare, gizmoDrag } = await setup(t);
  await selectSquare();
  const before = exported(document);

  await gizmoDrag('move-free', { x: 300, y: 300 }, { x: 350, y: 330 });
  let nodes = nodeMap(exported(document));
  assertPos(nodes.n1, 250, 230); assertPos(nodes.n3, 450, 430); assertPos(nodes.n5, 650, 300);
  // Visual parameters of every node and every edge are bit-for-bit intact.
  assert.deepEqual(exported(document).edges, before.edges);
  for (const id of ['n1', 'n2', 'n3', 'n4', 'n5']) {
    const { x, y, ...rest } = nodes[id];
    const { x: _x, y: _y, ...beforeRest } = nodeMap(before)[id];
    assert.deepEqual(rest, beforeRest, `${id} changed only in position`);
  }

  document.querySelector('#btnUndo').click();
  await nextFrame(window);
  nodes = nodeMap(exported(document));
  assertPos(nodes.n1, 200, 200);
  document.querySelector('#btnRedo').click();
  await nextFrame(window);
  assertPos(nodeMap(exported(document)).n1, 250, 230);
  document.querySelector('#btnUndo').click();
  await nextFrame(window);
  // The baseline history entry predates the click-selection, so undoing the
  // first edit restores the load-time (empty) selection; select again.
  await selectSquare();

  // Axis handle: vertical pointer motion is discarded.
  await gizmoDrag('move-x', { x: 352, y: 300 }, { x: 412, y: 390 });
  nodes = nodeMap(exported(document));
  assertPos(nodes.n1, 260, 200); assertPos(nodes.n4, 260, 400);

});

test('rotate gizmo rotates around the bounds centre; Shift snaps to 15°', async t => {
  const { document, selectSquare, gizmoDrag } = await setup(t);
  await selectSquare();
  document.querySelector('[data-gizmotool="rotate"]').click();
  // Grab the ring at angle 0 (east of the pivot), drag to angle +90° (south).
  await gizmoDrag('rotate', { x: 372, y: 300 }, { x: 300, y: 372 });
  let nodes = nodeMap(exported(document));
  assertPos(nodes.n1, 400, 200); assertPos(nodes.n2, 400, 400);
  assertPos(nodes.n3, 200, 400); assertPos(nodes.n4, 200, 200);
  assertPos(nodes.n5, 650, 300);
  assert.equal(nodes.n1.width, 80, 'rotation never touches node size');

  document.querySelector('#btnUndo').click();
  await nextFrame(document.defaultView);
  await selectSquare();
  document.querySelector('[data-gizmotool="rotate"]').click();
  // ~40° of free rotation plus Shift must land exactly on the 45° step.
  const a = 40 * Math.PI / 180;
  await gizmoDrag('rotate', { x: 372, y: 300 }, { x: 300 + 72 * Math.cos(a), y: 300 + 72 * Math.sin(a) }, { shiftKey: true });
  nodes = nodeMap(exported(document));
  const c45 = Math.cos(Math.PI / 4), s45 = Math.sin(Math.PI / 4);
  assertPos(nodes.n1, 300 + (-100 * c45 - -100 * s45), 300 + (-100 * s45 + -100 * c45));
});

test('scale gizmo scales positions about the pivot without resizing nodes', async t => {
  const { document, selectSquare, gizmoDrag } = await setup(t);
  await selectSquare();
  document.querySelector('[data-gizmotool="scale"]').click();

  // X handle grabbed 52px east of the pivot, dragged to 104px: fx = 2.
  await gizmoDrag('scale-x', { x: 352, y: 300 }, { x: 404, y: 300 });
  let nodes = nodeMap(exported(document));
  assertPos(nodes.n1, 100, 200); assertPos(nodes.n2, 500, 200); assertPos(nodes.n3, 500, 400);
  for (const id of ['n1', 'n2', 'n3', 'n4']) {
    assert.equal(nodes[id].width, 80, `${id} width unchanged by scale`);
    assert.equal(nodes[id].height, 40, `${id} height unchanged by scale`);
  }
  document.querySelector('#btnUndo').click();
  await nextFrame(document.defaultView);
  await selectSquare();
  document.querySelector('[data-gizmotool="scale"]').click();

  // Centre handle: radial drag of 120px maps to a uniform factor of 2.
  await gizmoDrag('scale-uniform', { x: 300, y: 300 }, { x: 420, y: 300 });
  nodes = nodeMap(exported(document));
  assertPos(nodes.n1, 100, 100); assertPos(nodes.n3, 500, 500);
  assertPos(nodes.n5, 650, 300);
});

test('rect gizmo stretches the selection frame from the opposite side, or from the centre with Alt', async t => {
  const { document, selectSquare, gizmoDrag } = await setup(t);
  await selectSquare();
  document.querySelector('[data-gizmotool="rect"]').click();

  // East edge 440 -> 580 with the west edge (160) anchored: fx = 420/280 = 1.5.
  await gizmoDrag('rect-e', { x: 440, y: 300 }, { x: 580, y: 340 });
  let nodes = nodeMap(exported(document));
  assertPos(nodes.n1, 220, 200); assertPos(nodes.n2, 520, 200);
  assertPos(nodes.n3, 520, 400); assertPos(nodes.n5, 650, 300);
  assert.equal(nodes.n2.width, 80, 'rect stretch never resizes node bodies');

  document.querySelector('#btnUndo').click();
  await nextFrame(document.defaultView);
  await selectSquare();
  document.querySelector('[data-gizmotool="rect"]').click();

  // SE corner (440,420) -> (580,540): fx = 1.5, fy = (540-180)/(420-180) = 1.5.
  await gizmoDrag('rect-se', { x: 440, y: 420 }, { x: 580, y: 540 });
  nodes = nodeMap(exported(document));
  assertPos(nodes.n1, 220, 210); assertPos(nodes.n3, 520, 510);

  document.querySelector('#btnUndo').click();
  await nextFrame(document.defaultView);
  await selectSquare();
  document.querySelector('[data-gizmotool="rect"]').click();

  // Alt: anchored at the centre (300): east edge 440 -> 510 gives fx = 210/140 = 1.5 about x=300.
  await gizmoDrag('rect-e', { x: 440, y: 300 }, { x: 510, y: 300 }, { altKey: true });
  nodes = nodeMap(exported(document));
  assertPos(nodes.n1, 150, 200); assertPos(nodes.n2, 450, 200);
});

test('pivot can be dragged onto a node and reset by double-click; Escape cancels a gizmo drag', async t => {
  const { window, document, svg, selectSquare, gizmoDrag, pointer, key } = await setup(t);
  await selectSquare();
  document.querySelector('[data-gizmotool="rotate"]').click();

  await gizmoDrag('pivot', { x: 300, y: 300 }, { x: 203, y: 198 });
  const ring = () => document.querySelector('#gizmoLayer .gizmo-pivot-ring');
  assert.equal(Number(ring().getAttribute('cx')), 200, 'pivot snapping lands on the node centre');
  assert.equal(Number(ring().getAttribute('cy')), 200);

  // Rotate 90° around n1: n1 stays, n2 orbits to (200, 400).
  await gizmoDrag('rotate', { x: 272, y: 200 }, { x: 200, y: 272 });
  const nodes = nodeMap(exported(document));
  assertPos(nodes.n1, 200, 200); assertPos(nodes.n2, 200, 400);
  assertPos(nodes.n3, 0, 400); assertPos(nodes.n4, 0, 200);

  document.querySelector('#btnUndo').click();
  await nextFrame(window);
  await selectSquare();
  document.querySelector('[data-gizmotool="rotate"]').click();
  const pivotEl = document.querySelector('#gizmoLayer [data-gizmo="pivot"]');
  pivotEl.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  assert.equal(Number(ring().getAttribute('cx')), 300, 'double-click resets the pivot to the centre');

  // Escape mid-drag restores the exact pre-gesture positions, no history entry.
  const handle = document.querySelector('#gizmoLayer [data-gizmo="rotate"]');
  pointer(handle, 'pointerdown', 372, 300);
  pointer(svg, 'pointermove', 300, 372);
  await nextFrame(window);
  key('Escape', { key: 'Escape' });
  pointer(svg, 'pointerup', 300, 372);
  await nextFrame(window);
  const after = nodeMap(exported(document));
  assertPos(after.n1, 200, 200); assertPos(after.n2, 400, 200);
  assert.equal(document.querySelector('#btnRedo').disabled, false, 'cancel pushed no history (redo still holds the undone rotation)');
});

test('edge-only selection is transformed through its endpoints', async t => {
  const { document, svg, pointer, gizmoDrag, handles } = await setup(t);
  pointer(document.querySelector('#edge-e1'), 'pointerdown', 300, 200);
  pointer(svg, 'pointerup', 300, 200);
  assert.deepEqual(handles(), ['move-x', 'move-y', 'move-free']);
  // Bounds centre of n1+n2 bodies is (300, 200).
  await gizmoDrag('move-free', { x: 300, y: 200 }, { x: 340, y: 230 });
  const nodes = nodeMap(exported(document));
  assertPos(nodes.n1, 240, 230); assertPos(nodes.n2, 440, 230);
  assertPos(nodes.n3, 400, 400); assertPos(nodes.n5, 650, 300);
});

test('arrow keys nudge the selection and G toggles the gizmo', async t => {
  const { document, selectSquare, key, handles } = await setup(t);
  await selectSquare();
  key('ArrowRight', { key: 'ArrowRight' });
  key('ArrowDown', { key: 'ArrowDown', shiftKey: true });
  let nodes = nodeMap(exported(document));
  assertPos(nodes.n1, 201, 210); assertPos(nodes.n3, 401, 410); assertPos(nodes.n5, 650, 300);

  key('KeyG', { key: 'g' });
  assert.deepEqual(handles(), [], 'G hides the gizmo');
  assert.equal(exported(document).settings.gizmoEnabled, false);
  key('KeyG', { key: 'g' });
  assert.deepEqual(handles(), ['move-x', 'move-y', 'move-free'], 'G brings the gizmo back');
  nodes = nodeMap(exported(document));
  assertPos(nodes.n1, 201, 210, 'toggling the gizmo never moves nodes');
});

test('single-node selection transforms as a group of one', async t => {
  const { document, clickNode, gizmoDrag } = await setup(t);
  await clickNode('n5', 650, 300);
  await gizmoDrag('move-y', { x: 650, y: 352 }, { x: 700, y: 402 });
  const nodes = nodeMap(exported(document));
  assertPos(nodes.n5, 650, 350, 'move-y discards the x drift for a single node too');
  assertPos(nodes.n1, 200, 200);
});

// --- Regression coverage for the branches merged into this one ---

test('merged selection-set cache: shift-add updates the DOM for every added node', async t => {
  const { document, clickNode } = await setup(t);
  await clickNode('n1', 200, 200);
  assert.equal(document.querySelector('#node-n1').classList.contains('selected'), true);
  await clickNode('n2', 400, 200, { shiftKey: true });
  assert.equal(document.querySelector('#node-n2').classList.contains('selected'), true,
    'add-mode merge must not swallow the selection delta');
  assert.equal(document.querySelector('#node-n1').classList.contains('selected'), true);
  await clickNode('n3', 400, 400, { shiftKey: true });
  assert.equal(document.querySelector('#node-n3').classList.contains('selected'), true);
  assert.deepEqual(exported(document).selection.nodes.sort(), ['n1', 'n2', 'n3']);
});

test('merged copy/paste: paste clones selected nodes with internal and preserved external edges', async t => {
  const graph = {
    mode: 'select',
    viewBox: { x: 0, y: 0, w: 1000, h: 660 },
    nodes: [
      { id: 'n1', label: 'A', x: 200, y: 200 },
      { id: 'n2', label: 'B', x: 400, y: 200 },
      { id: 'n3', label: 'C', x: 400, y: 400 },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', directed: true },
      { id: 'e2', from: 'n2', to: 'n3', directed: true },
    ],
  };
  const { window, document, clickNode } = await setup(t, graph);
  await clickNode('n1', 200, 200);
  await clickNode('n2', 400, 200, { shiftKey: true });
  assert.equal(document.querySelector('#btnPaste').disabled, true);
  document.querySelector('#btnCopy').click();
  assert.equal(document.querySelector('#btnPaste').disabled, false, 'copy enables paste');
  document.querySelector('#btnPaste').click();
  await nextFrame(window);
  const after = exported(document);
  assert.equal(after.nodes.length, 5, 'two clones pasted');
  assert.equal(after.edges.length, 4, 'internal edge cloned and the dangling n2->n3 edge preserved onto the clone');
  const originals = new Set(['n1', 'n2', 'n3']);
  const clones = after.nodes.filter(n => !originals.has(n.id));
  assert.equal(clones.length, 2);
  for (const clone of clones) {
    assert.ok(!after.nodes.some(n => originals.has(n.id) && n.x === clone.x && n.y === clone.y),
      'pasted clone does not sit exactly on an existing node');
  }
  assert.deepEqual(after.selection.nodes.sort(), clones.map(n => n.id).sort(), 'paste selects the clones');
  document.querySelector('#btnUndo').click();
  await nextFrame(window);
  assert.equal(exported(document).nodes.length, 3, 'paste is one undo step');
});
