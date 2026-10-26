import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

const baseGraph = {
  title: 'gizmo',
  mode: 'select',
  selectTool: 'single',
  viewBox: { x: 0, y: 0, w: 1000, h: 660 },
  nodes: [
    { id: 'n1', label: 'A', x: 100, y: 100, order: 0, shape: 'square', color: '#ff0000', width: 80, height: 40, labelSize: 20 },
    { id: 'n2', label: 'B', x: 300, y: 100, order: 1, shape: 'diamond', color: '#00ff00', width: 60, height: 60 },
    { id: 'n3', label: 'C', x: 300, y: 300, order: 2, color: '#0000ff', width: 50, height: 50 },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', label: 'edge label', directed: true, weight: '7', color: '#aabbcc', strokeSize: 4 },
    { id: 'e2', from: 'n2', to: 'n3', label: 'other', directed: false },
  ],
};

function createEditorDom(graph) {
  const errors = [];
  const preload = `localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(graph))});`;
  const documentHtml = html.replace('<script>', `<script>${preload}</script><script>`);
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
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
        dispatchEvent() { return true; },
      });
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => null;
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

function pointer(window, target, type, x, y, options = {}) {
  const event = new window.MouseEvent(type, {
    bubbles: true, cancelable: true,
    button: options.button ?? 0,
    clientX: x, clientY: y,
    shiftKey: Boolean(options.shiftKey),
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    pointerType: { value: options.pointerType ?? 'mouse' },
  });
  target.dispatchEvent(event);
}

const frame = window => new Promise(resolve => window.setTimeout(resolve, 40));

function exported(document) {
  document.querySelector('#btnExportJson').click();
  const modal = document.querySelector('.export-modal');
  assert.ok(modal, 'export preview should open');
  const graph = JSON.parse(modal.querySelector('textarea').value);
  modal.remove();
  return graph;
}

function modeButton(document, mode) {
  const btn = document.querySelector(`[data-gizmo-mode="${mode}"]`);
  assert.ok(btn, `missing gizmo mode button: ${mode}`);
  return btn;
}

function gizmoBox(document) {
  const el = document.querySelector('#transformGizmoLayer .gizmo-box');
  assert.ok(el, 'gizmo bounding box should be rendered');
  const x = Number(el.getAttribute('x'));
  const y = Number(el.getAttribute('y'));
  const w = Number(el.getAttribute('width'));
  const h = Number(el.getAttribute('height'));
  return { x, y, w, h, minX: x, minY: y, maxX: x + w, maxY: y + h, cx: x + w / 2, cy: y + h / 2 };
}

function handleCenter(document, kind) {
  const group = document.querySelector(`#transformGizmoLayer g[data-gizmo-handle="${kind}"]`);
  assert.ok(group, `missing gizmo handle: ${kind}`);
  const shape = group.querySelector('.gizmo-handle-shape');
  if (shape.tagName.toLowerCase() === 'circle') {
    return { x: Number(shape.getAttribute('cx')), y: Number(shape.getAttribute('cy')) };
  }
  return {
    x: Number(shape.getAttribute('x')) + Number(shape.getAttribute('width')) / 2,
    y: Number(shape.getAttribute('y')) + Number(shape.getAttribute('height')) / 2,
  };
}

async function setup(t, graph = baseGraph, selected = ['n1', 'n2']) {
  const { dom, errors } = createEditorDom(graph);
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  const { window } = dom;
  const { document } = window;
  await frame(window);
  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  document.elementFromPoint = () => svg;
  window.dispatchEvent(new window.Event('resize'));
  await frame(window);

  const byId = id => graph.nodes.find(n => n.id === id);
  for (let i = 0; i < selected.length; i++) {
    const n = byId(selected[i]);
    const nodeEl = document.querySelector(`#node-${n.id}`);
    assert.ok(nodeEl, `node ${n.id} should be rendered`);
    pointer(window, nodeEl, 'pointerdown', n.x, n.y, { shiftKey: i > 0 });
    pointer(window, svg, 'pointerup', n.x, n.y, { shiftKey: i > 0 });
  }
  await frame(window);

  const chooseMode = async mode => {
    modeButton(document, mode).click();
    await frame(window);
  };
  const dragHandle = (kind, from, to, options = {}) => {
    const group = document.querySelector(`#transformGizmoLayer g[data-gizmo-handle="${kind}"]`)
      || document.querySelector(`#transformGizmoLayer [data-gizmo-handle="${kind}"]`);
    assert.ok(group, `missing gizmo handle: ${kind}`);
    pointer(window, group, 'pointerdown', from.x, from.y, options);
    pointer(window, svg, 'pointermove', to.x, to.y, options);
    pointer(window, svg, 'pointerup', to.x, to.y, options);
  };
  return { window, document, svg, chooseMode, dragHandle };
}

function nodeById(graph, id) {
  const n = graph.nodes.find(item => item.id === id);
  assert.ok(n, `missing node ${id}`);
  return n;
}

function near(actual, expected, message, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`);
}

/** The gizmo contract: positions may change, nothing else may. */
function assertOnlyPositionsChanged(before, after, selectedIds) {
  assert.equal(after.nodes.length, before.nodes.length, 'node count must not change');
  assert.deepEqual(after.edges, before.edges, 'edge records must be byte-identical');
  assert.deepEqual(after.settings, before.settings, 'settings must be untouched');
  for (const oldNode of before.nodes) {
    const newNode = nodeById(after, oldNode.id);
    const { x: oldX, y: oldY, ...oldRest } = oldNode;
    const { x: newX, y: newY, ...newRest } = newNode;
    assert.deepEqual(newRest, oldRest, `visual fields of ${oldNode.id} must be untouched`);
    if (!selectedIds.includes(oldNode.id)) {
      near(newX, oldX, `${oldNode.id}.x (not selected)`);
      near(newY, oldY, `${oldNode.id}.y (not selected)`);
    }
  }
}

test('gizmo mode bar drives the on-canvas overlay, and Off hides it', async t => {
  const { document, chooseMode } = await setup(t);
  assert.ok(document.querySelector('#transformGizmoLayer .gizmo-box'), 'rect gizmo is on by default');
  assert.equal(modeButton(document, 'rect').getAttribute('aria-pressed'), 'true');
  assert.ok(document.querySelectorAll('[data-gizmo-mode]').length >= 10, 'floating bar + sidebar both wired');

  await chooseMode('off');
  assert.equal(document.querySelector('#transformGizmoLayer').childNodes.length, 0, 'off clears the overlay');
  assert.equal(modeButton(document, 'off').getAttribute('aria-pressed'), 'true');
  assert.equal(modeButton(document, 'rect').getAttribute('aria-pressed'), 'false');

  await chooseMode('scale');
  assert.equal(document.querySelectorAll('#transformGizmoLayer g[data-gizmo-handle]').length, 4,
    'scale mode draws four corner handles');
});

test('translate gizmo moves selected node positions only', async t => {
  const { document, chooseMode, dragHandle } = await setup(t);
  await chooseMode('translate');
  const box = gizmoBox(document);
  const before = exported(document);
  const from = handleCenter(document, 'move');
  near(from.x, box.cx, 'centre handle x');
  near(from.y, box.cy, 'centre handle y');

  dragHandle('move', from, { x: from.x + 50, y: from.y + 30 });
  const after = exported(document);
  assertOnlyPositionsChanged(before, after, ['n1', 'n2']);
  near(nodeById(after, 'n1').x, 150, 'n1.x');
  near(nodeById(after, 'n1').y, 130, 'n1.y');
  near(nodeById(after, 'n2').x, 350, 'n2.x');
  near(nodeById(after, 'n2').y, 130, 'n2.y');
});

test('rotate gizmo rotates positions about the selection centre', async t => {
  const { document, chooseMode, dragHandle } = await setup(t);
  await chooseMode('rotate');
  const box = gizmoBox(document);
  const before = exported(document);
  const from = handleCenter(document, 'rotate');
  const radius = box.cy - from.y;
  // A quarter turn clockwise (screen coordinates): above centre → right of centre.
  dragHandle('rotate', from, { x: box.cx + radius, y: box.cy });

  const after = exported(document);
  assertOnlyPositionsChanged(before, after, ['n1', 'n2']);
  for (const n of before.nodes.filter(n => n.id !== 'n3')) {
    const rotated = nodeById(after, n.id);
    near(rotated.x, box.cx - (n.y - box.cy), `${n.id}.x after +90°`);
    near(rotated.y, box.cy + (n.x - box.cx), `${n.id}.y after +90°`);
  }
});

test('scale gizmo scales positions uniformly, leaving sizes alone', async t => {
  const { document, chooseMode, dragHandle } = await setup(t);
  await chooseMode('scale');
  const box = gizmoBox(document);
  const before = exported(document);
  const from = handleCenter(document, 'se');
  const factor = 1.5;
  const to = { x: box.cx + (from.x - box.cx) * factor, y: box.cy + (from.y - box.cy) * factor };
  dragHandle('se', from, to);

  const after = exported(document);
  assertOnlyPositionsChanged(before, after, ['n1', 'n2']);
  for (const n of before.nodes.filter(n => n.id !== 'n3')) {
    const scaled = nodeById(after, n.id);
    near(scaled.x, box.cx + (n.x - box.cx) * factor, `${n.id}.x`, 1e-4);
    near(scaled.y, box.cy + (n.y - box.cy) * factor, `${n.id}.y`, 1e-4);
  }
  // Explicitly: the visual size fields did not scale with the layout.
  assert.equal(nodeById(after, 'n1').width, 80);
  assert.equal(nodeById(after, 'n1').height, 40);
});

test('rect gizmo side handle scales X only', async t => {
  const { document, chooseMode, dragHandle } = await setup(t);
  await chooseMode('rect');
  const box = gizmoBox(document);
  const before = exported(document);
  const from = handleCenter(document, 'e');
  const factor = 1.5;
  dragHandle('e', from, { x: from.x + box.w * (factor - 1), y: from.y });

  const after = exported(document);
  assertOnlyPositionsChanged(before, after, ['n1', 'n2']);
  for (const n of before.nodes.filter(n => n.id !== 'n3')) {
    const scaled = nodeById(after, n.id);
    near(scaled.x, box.minX + (n.x - box.minX) * factor, `${n.id}.x`, 1e-4);
    near(scaled.y, n.y, `${n.id}.y must not change`, 1e-4);
  }
});

test('rect gizmo offers eight box handles plus rotation', async t => {
  const { document, chooseMode } = await setup(t);
  await chooseMode('rect');
  for (const kind of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate']) {
    assert.ok(document.querySelector(`#transformGizmoLayer g[data-gizmo-handle="${kind}"]`),
      `rect mode should expose the ${kind} handle`);
  }
});

test('undo/redo and Escape cover a gizmo gesture', async t => {
  const { window, document, chooseMode, dragHandle, svg } = await setup(t);
  await chooseMode('translate');
  const before = exported(document);
  const from = handleCenter(document, 'move');
  dragHandle('move', from, { x: from.x + 40, y: from.y - 20 });
  await frame(window);
  const moved = exported(document);
  near(nodeById(moved, 'n1').x, 140, 'n1 moved');

  document.querySelector('#btnUndo').click();
  await frame(window);
  const undone = exported(document);
  near(nodeById(undone, 'n1').x, 100, 'undo restores x');
  near(nodeById(undone, 'n1').y, 100, 'undo restores y');

  document.querySelector('#btnRedo').click();
  await frame(window);
  near(nodeById(exported(document), 'n1').x, 140, 'redo reapplies the transform');

  // Re-select (undo cleared the selection) and cancel a fresh gesture with Escape.
  const n1 = document.querySelector('#node-n1');
  pointer(window, n1, 'pointerdown', 140, 80);
  pointer(window, svg, 'pointerup', 140, 80);
  await frame(window);
  const from2 = handleCenter(document, 'move');
  const group = document.querySelector('#transformGizmoLayer g[data-gizmo-handle="move"]');
  pointer(window, group, 'pointerdown', from2.x, from2.y);
  pointer(window, svg, 'pointermove', from2.x + 100, from2.y + 100);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  await frame(window);
  const cancelled = exported(document);
  near(nodeById(cancelled, 'n1').x, 140, 'Escape restores x');
  near(nodeById(cancelled, 'n1').y, 80, 'Escape restores y');
  assertOnlyPositionsChanged(before, cancelled, ['n1', 'n2']);
});

test('copy/paste from the merged branch still works and the gizmo follows the pasted selection', async t => {
  const { window, document } = await setup(t);
  const before = exported(document);
  assert.equal(before.nodes.length, 3);

  document.querySelector('#btnCopy').click();
  document.querySelector('#btnPaste').click();
  await frame(window);

  const after = exported(document);
  assert.equal(after.nodes.length, 5, 'paste adds the copied nodes');
  // The merged copy/paste branch also preserves the dangling n2→n3 edge when
  // its external endpoint still exists (copyPreserveExternal defaults to on).
  assert.equal(after.edges.length, 4, 'paste recreates internal and dangling edges');
  for (const old of before.nodes) assert.deepEqual(nodeById(after, old.id), old, 'original nodes untouched');
  const pasted = after.nodes.filter(n => !before.nodes.some(b => b.id === n.id));
  assert.equal(pasted.length, 2);
  assert.ok(pasted.some(n => n.width === 80 && n.height === 40 && n.shape === 'square'),
    'pasted nodes keep their individual visual parameters');
  assert.ok(document.querySelector('#transformGizmoLayer .gizmo-box'),
    'gizmo is visible for the freshly pasted selection');
});

test('keyboard shortcuts switch gizmo modes and the choice persists', async t => {
  const { window, document, chooseMode } = await setup(t);
  const press = key => window.dispatchEvent(new window.KeyboardEvent('keydown', {
    key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, bubbles: true,
  }));
  for (const [key, mode] of [['g', 'translate'], ['r', 'rotate'], ['k', 'scale'], ['b', 'rect'], ['0', 'off']]) {
    press(key);
    await frame(window);
    assert.equal(modeButton(document, mode).getAttribute('aria-pressed'), 'true', `${key} selects ${mode}`);
    assert.equal(window.localStorage.getItem('graph-editor-pro-gizmo-mode'), mode);
  }
  assert.equal(document.querySelector('#transformGizmoLayer').childNodes.length, 0);

  await chooseMode('rect');
  assert.equal(window.localStorage.getItem('graph-editor-pro-gizmo-mode'), 'rect');
  assert.ok(document.querySelector('#transformGizmoLayer .gizmo-box'));
});

test('a single selected node gets translation only, not no-op rotate/scale handles', async t => {
  const { document, chooseMode, dragHandle } = await setup(t, baseGraph, ['n1']);
  await chooseMode('rotate');
  assert.equal(document.querySelectorAll('#transformGizmoLayer g[data-gizmo-handle]').length, 0,
    'rotate handles are hidden for a one-node selection');
  const hint = document.querySelector('#transformGizmoLayer .gizmo-readout');
  assert.match(hint.textContent, /at least two/i);
  const border = document.querySelector('#transformGizmoLayer .gizmo-box-hit');
  assert.ok(border, 'the draggable box border remains');

  const box = gizmoBox(document);
  const before = exported(document);
  dragHandle('move', { x: box.cx, y: box.cy }, { x: box.cx + 30, y: box.cy + 20 });
  const after = exported(document);
  assertOnlyPositionsChanged(before, after, ['n1']);
  near(nodeById(after, 'n1').x, 130, 'single node x');
  near(nodeById(after, 'n1').y, 120, 'single node y');
});

test('Shift snaps rotation to 15 degree increments', async t => {
  const { document, chooseMode, dragHandle } = await setup(t);
  await chooseMode('rotate');
  const box = gizmoBox(document);
  const before = exported(document);
  const from = handleCenter(document, 'rotate');
  const radius = box.cy - from.y;
  // Start directly above the centre (-90°); move to -80° (a raw 10° turn),
  // which Shift must snap to 15°.
  const targetAngle = -80 * Math.PI / 180;
  const to = { x: box.cx + radius * Math.cos(targetAngle), y: box.cy + radius * Math.sin(targetAngle) };
  dragHandle('rotate', from, to, { shiftKey: true });

  const angle = 15 * Math.PI / 180;
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const after = exported(document);
  assertOnlyPositionsChanged(before, after, ['n1', 'n2']);
  for (const n of before.nodes.filter(n => n.id !== 'n3')) {
    const rotated = nodeById(after, n.id);
    near(rotated.x, box.cx + (n.x - box.cx) * cs - (n.y - box.cy) * sn, `${n.id}.x`, 0.02);
    near(rotated.y, box.cy + (n.x - box.cx) * sn + (n.y - box.cy) * cs, `${n.id}.y`, 0.02);
  }
});
