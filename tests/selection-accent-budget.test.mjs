import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

// A document big enough that a rect select crosses the edge accent budget
// (320 edges): 24 x 24 nodes on a grid, two edges per node.
function bigGraph() {
  const nodes = [];
  const edges = [];
  const cols = 24;
  for (let i = 0; i < cols * cols; i += 1) {
    nodes.push({ id: `n${i}`, label: `N${i}`, x: (i % cols) * 120, y: Math.floor(i / cols) * 120 });
  }
  let e = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    if (i + 1 < nodes.length && (i + 1) % cols !== 0) edges.push({ id: `e${e++}`, from: `n${i}`, to: `n${i + 1}`, directed: false, weight: '1' });
    if (i + cols < nodes.length) edges.push({ id: `e${e++}`, from: `n${i}`, to: `n${i + cols}`, directed: false, weight: '1' });
  }
  return { title: 'bulk', mode: 'select', nodes, edges, viewBox: { x: -200, y: -200, w: 3200, h: 3200 } };
}

function createEditorDom(savedGraph) {
  const errors = [];
  const documentHtml = html.replace(
    '<script>',
    `<script>localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(savedGraph))});</script><script>`,
  );
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
    },
  });
  return { dom, errors };
}

const nextFrame = window => new Promise(resolve => window.requestAnimationFrame(() => resolve()));

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
    button: 0,
    clientX: options.clientX,
    clientY: options.clientY,
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId },
    pointerType: { value: options.pointerType ?? 'mouse' },
  });
  target.dispatchEvent(event);
}


// The editor maps client -> world with the fixed canvas rect the tests install
// (1000x660), so a node's world position inverts to one client point.
function clientPointOf(window, id) {
  const node = JSON.parse(window.localStorage.getItem('graph-editor-pro-v2')).nodes.find(n => n.id === id);
  const vb = JSON.parse(window.localStorage.getItem('graph-editor-pro-v2')).viewBox;
  const scale = Math.min(1000 / vb.w, 660 / vb.h);
  return {
    x: 500 + (node.x - (vb.x + vb.w / 2)) * scale,
    y: 330 + (node.y - (vb.y + vb.h / 2)) * scale,
  };
}

// Drag a rect over the whole canvas, i.e. select every node and edge.
async function rectSelectAll(window, svg) {
  window.document.querySelector('[data-selecttool="rect"]').click();
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerdown', { pointerId: 1, clientX: 2, clientY: 2 });
  // Several samples, like a real drag: a single move is still treated as a tap
  // and would add a node instead of selecting the region.
  for (let step = 1; step <= 4; step += 1) {
    dispatchPointer(window, svg, 'pointermove', { pointerId: 1, clientX: 2 + step * 249, clientY: 2 + step * 164 });
  }
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 998, clientY: 658 });
  await nextFrame(window);
  await nextFrame(window);
}

// Select one node by clicking it, i.e. stay far below the budgets.
async function clickNode(window, svg, id) {
  // jsdom has no hit testing: every node sits at the client point of the
  // event, and a press only starts a drag when it lands inside the node body.
  // So the press is aimed at one node's centre and everything else is outside.
  const el = window.document.getElementById(`node-${id}`);
  const p = clientPointOf(window, id);
  dispatchPointer(window, el, 'pointerdown', { pointerId: 2, clientX: p.x, clientY: p.y });
  dispatchPointer(window, svg, 'pointerup', { pointerId: 2, clientX: p.x, clientY: p.y });
  await nextFrame(window);
  await nextFrame(window);
}

test('a selection past the accent budget colours the graph instead of decorating it', async () => {
  const { dom, errors } = createEditorDom(bigGraph());
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  setCanvasRect(svg);

  await rectSelectAll(dom.window, svg);
  const doc = dom.window.document;

  const selectedNodes = [...doc.querySelectorAll('#nodesLayer > g')].filter(g => g.classList.contains('selected'));
  assert.ok(selectedNodes.length > 320, `the rect covers the whole grid (${selectedNodes.length} nodes selected)`);
  assert.ok(doc.querySelectorAll('#edgesLayer > g.selected').length > 320, 'and more than the budget of edges');
  assert.equal(doc.querySelectorAll('.edge-sel').length, 0,
    'a bulk selection creates no per-edge accent lines');
  assert.equal(doc.querySelectorAll('.edge-sel-arrow').length, 0,
    'a bulk selection creates no per-edge tip accents');
  // Node rings are one element each and stay affordable, so a large node
  // selection keeps the normal ring look.
  assert.equal(doc.querySelectorAll('.node-sel').length, selectedNodes.length,
    'every selected node still carries its accent ring');

  // The look still reads as "selected": the edges adopt the accent colour.
  const line = doc.getElementById('edge-e0').querySelector('.edge-line');
  assert.equal(line.getAttribute('stroke'), 'var(--accent)', 'a selected edge is drawn in the accent colour');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('clearing a bulk selection hands the edges back their own colour', async () => {
  const { dom, errors } = createEditorDom(bigGraph());
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  const doc = dom.window.document;

  await rectSelectAll(dom.window, svg);
  const line = doc.getElementById('edge-e0').querySelector('.edge-line');
  assert.equal(line.getAttribute('stroke'), 'var(--accent)', 'bulk-selected edges are drawn in the accent colour');

  // A press on empty canvas in single-select mode clears the selection on
  // release. (A press on an already-selected node deliberately keeps the group,
  // so it must not be used here.)
  doc.querySelector('[data-selecttool="single"]').click();
  await nextFrame(dom.window);
  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 3, clientX: 900, clientY: 600 });
  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 3, clientX: 900, clientY: 600 });
  await nextFrame(dom.window);
  await nextFrame(dom.window);

  assert.equal(doc.querySelectorAll('#nodesLayer > g.selected').length, 0, 'the selection is cleared');
  assert.equal(doc.querySelectorAll('#edgesLayer > g.selected').length, 0);
  assert.notEqual(line.getAttribute('stroke'), 'var(--accent)',
    'an edge that is no longer selected goes back to its own colour');
  assert.equal(doc.querySelectorAll('.edge-sel, .edge-sel-arrow').length, 0, 'and carries no accent');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a small selection keeps the full accent look', async () => {
  const { dom, errors } = createEditorDom(bigGraph());
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  const doc = dom.window.document;

  await clickNode(dom.window, svg, 'n0');
  const selected = [...doc.querySelectorAll('#nodesLayer > g')].filter(g => g.classList.contains('selected'));
  assert.equal(selected.length, 1);
  assert.ok(selected[0].querySelector('.node-sel'), 'one selected node is decorated with its ring');
  assert.equal(doc.querySelectorAll('.node-sel').length, 1, 'and nothing else is');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
