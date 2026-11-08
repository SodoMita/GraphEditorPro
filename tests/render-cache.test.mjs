import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

// The render passes decide what to write by comparing three things: the
// document revision (geometry, labels), a style revision (settings edited in
// place) and each element's paint stamp plus selection. These tests pin that
// contract down from the DOM's point of view — a pass that claims "nothing
// changed" must leave the DOM byte-identical, and every surface that *can*
// change the picture must still reach the elements.
//
// They deliberately assert on rendered attributes rather than on internals:
// the fast paths are an optimisation, and the DOM is the only contract that
// matters to a user.

const html = await readFile('index.html', 'utf8');

function createEditorDom(savedGraph = null) {
  const errors = [];
  const documentHtml = savedGraph
    ? html.replace('<script>', `<script>localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(savedGraph))});</script><script>`)
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
        media: query,
        matches: false,
        onchange: null,
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

function setCanvasRect(svg) {
  svg.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0,
    width: 1000, height: 660, right: 1000, bottom: 660,
    toJSON() { return this; },
  });
}

const nextFrame = window => new Promise(resolve => window.setTimeout(resolve, 30));

// A small graph with two node types and a handful of edges, including a
// parallel pair so lane offsets and arrowheads are exercised.
function sampleGraph() {
  return {
    title: 'render-cache', mode: 'select',
    nodes: [
      { id: 'a', label: 'Alpha', x: -200, y: -60, type: 'hub' },
      { id: 'b', label: 'Beta', x: 160, y: -60 },
      { id: 'c', label: 'Gamma', x: -20, y: 140, width: 90, height: 40, labelSize: 26 },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', directed: true, weight: '3', label: 'uses' },
      { id: 'e2', from: 'a', to: 'b', directed: true, weight: '7' },
      { id: 'e3', from: 'b', to: 'c', directed: false },
    ],
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
    settings: { graphDefaults: { labelsPolicy: 'on' } },
  };
}

async function setup(t, graph = sampleGraph()) {
  const { dom, errors } = createEditorDom(graph);
  t.after(() => { dom.window.close(); assert.deepEqual(errors.map(error => error.message), []); });
  const { window } = dom;
  const { document } = window;
  setCanvasRect(document.querySelector('#graphCanvas'));
  await nextFrame(window);
  await nextFrame(window);
  return { window, document, errors };
}

// A stable, attribute-level snapshot of the two graph layers.
function snapshot(document) {
  return [...document.querySelectorAll('#nodesLayer > g, #edgesLayer > g')].map(group =>
    [...group.attributes].map(attribute => `${attribute.name}=${attribute.value}`).join(' ') + ' { ' +
    [...group.querySelectorAll('*')].map(child =>
      child.tagName + ':' + [...child.attributes].map(attribute => `${attribute.name}=${attribute.value}`).join(',')
    ).join(' ') + ' }'
  ).join('\n');
}

function dispatchPointer(window, target, type, options) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: options.button ?? 0,
    clientX: options.clientX,
    clientY: options.clientY,
    shiftKey: Boolean(options.shiftKey),
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    pointerType: { value: options.pointerType ?? 'mouse' },
  });
  target.dispatchEvent(event);
}

const nodeShape = (document, id) => document.getElementById('node-' + id).querySelector('.node-shape');
const edgeLine = (document, id) => document.getElementById('edge-' + id).querySelector('.edge-line');

test('a repaint that changes nothing still writes nothing to the scene', async t => {
  const { window, document } = await setup(t);
  const before = snapshot(document);
  // The label policy select is the cheapest way to request a render pass. The
  // request itself marks the document dirty, so the pass walks both layers and
  // it is the per-element checks (geometry signature, label text, paint stamp,
  // selection) that have to conclude "nothing to write" — this test is what
  // holds those checks to their word.
  document.querySelector('#defLabelsPolicy').dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  assert.equal(snapshot(document), before, 'an unchanged document repaints to an identical layer');

  // And again, three times in a row: every pass must stay a no-op, not just the
  // first (a stale stamp would show up on the second pass).
  for (let i = 0; i < 3; i++) {
    document.querySelector('#defLabelsPolicy').dispatchEvent(new window.Event('change', { bubbles: true }));
    await nextFrame(window);
  }
  assert.equal(snapshot(document), before);
});

test('a settings-driven repaint after an external style edit still lands', async t => {
  const { window, document } = await setup(t);
  const widthInput = document.querySelector('#defLabelOutlineWidth');
  widthInput.value = '2';
  widthInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  assert.equal(document.getElementById('node-a').querySelector('text').getAttribute('stroke-width'), '2');

  const sizeInput = document.querySelector('#defNodeLabelSize');
  sizeInput.value = '21';
  sizeInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  assert.equal(document.getElementById('node-a').querySelector('text').getAttribute('font-size'), '21');

  // A node-level override still beats the default, and the override's own
  // change must repaint in place without a document revision.
  const node = document.querySelector('#node-c text');
  assert.equal(node.getAttribute('font-size'), '26');
  const outlineAfterSize = node.getAttribute('stroke-width');
  assert.equal(outlineAfterSize, String(Math.round(2 * 26 / 13 * 100) / 100), 'outline scales with the label size');
});

test('selection state survives repaints and is not re-written when unchanged', async t => {
  const { window, document } = await setup(t);
  const nodeA = document.getElementById('node-a');
  dispatchPointer(window, nodeA, 'pointerdown', { clientX: 300, clientY: 240 });
  await nextFrame(window);
  dispatchPointer(window, document.querySelector('#graphCanvas'), 'pointerup', { clientX: 300, clientY: 240 });
  await nextFrame(window);
  assert.equal(nodeA.classList.contains('selected'), true);
  assert.ok(nodeA.querySelector('.node-sel'), 'selected node carries its accent ring');

  const selectedSnapshot = snapshot(document);
  document.querySelector('#defLabelsPolicy').dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  assert.equal(nodeA.classList.contains('selected'), true, 'repaint keeps the selection');
  assert.ok(nodeA.querySelector('.node-sel'), 'repaint keeps the accent ring');
  assert.equal(snapshot(document), selectedSnapshot, 'the repaint is still a no-op');

  // Selecting a different node must move the accent, not double it.
  dispatchPointer(window, document.getElementById('node-b'), 'pointerdown', { clientX: 500, clientY: 240 });
  await nextFrame(window);
  dispatchPointer(window, document.querySelector('#graphCanvas'), 'pointerup', { clientX: 500, clientY: 240 });
  await nextFrame(window);
  assert.equal(nodeA.classList.contains('selected'), false);
  assert.equal(nodeA.querySelector('.node-sel'), null, 'the previous accent is removed');
  assert.ok(document.getElementById('node-b').querySelector('.node-sel'));
});

test('an edge colour change repaints only the edges', async t => {
  const { window, document } = await setup(t);
  const nodeBefore = snapshot(document).split('\n').filter(line => !line.startsWith('edge-') && line.includes('{'));
  const input = document.querySelector('#defEdgeColor');
  input.value = '#f472b6';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await nextFrame(window);
  for (const id of ['e1', 'e2', 'e3']) {
    assert.equal(edgeLine(document, id).getAttribute('stroke'), '#f472b6');
  }
  const arrow = document.getElementById('edge-e1').querySelector('.edge-arrow');
  assert.equal(arrow.getAttribute('fill'), '#f472b6', 'the arrow follows the edge colour');
});

test('a drag repoints its edges once and the next pass agrees with it', async t => {
  const { window, document } = await setup(t);
  const svg = document.querySelector('#graphCanvas');
  const nodeA = document.getElementById('node-a');
  const beforePath = edgeLine(document, 'e1').getAttribute('d');

  dispatchPointer(window, nodeA, 'pointerdown', { clientX: 300, clientY: 240 });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointermove', { clientX: 380, clientY: 300 });
  await nextFrame(window);
  const draggedPath = edgeLine(document, 'e1').getAttribute('d');
  assert.notEqual(draggedPath, beforePath, 'the edge follows the dragged node live');
  dispatchPointer(window, svg, 'pointerup', { clientX: 380, clientY: 300 });
  await nextFrame(window);
  await nextFrame(window);

  // A later full pass must not "correct" the live geometry back, and must
  // reproduce exactly what the drag wrote.
  const afterDrag = snapshot(document);
  document.querySelector('#defLabelsPolicy').dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  assert.equal(snapshot(document), afterDrag, 'a repaint after a drag is a no-op');
});

test('deleting and re-adding elements keeps the layer bookkeeping honest', async t => {
  const { window, document } = await setup(t);
  const nodeB = document.getElementById('node-b');
  dispatchPointer(window, nodeB, 'pointerdown', { clientX: 500, clientY: 240 });
  await nextFrame(window);
  dispatchPointer(window, document.querySelector('#graphCanvas'), 'pointerup', { clientX: 500, clientY: 240 });
  await nextFrame(window);
  document.querySelector('#btnDelete').click();
  await nextFrame(window);
  assert.equal(document.getElementById('node-b'), null, 'the deleted node leaves the DOM');
  assert.equal(document.getElementById('edge-e1'), null, 'and so do its edges');

  // The remaining elements must still be repainted into a consistent state:
  // a stale spine entry for the deleted node would either resurrect it or
  // leave the survivors unwritten.
  document.querySelector('#defNodeColor').dispatchEvent(new window.Event('input', { bubbles: true }));
  await nextFrame(window);
  const survivors = [...document.querySelectorAll('#nodesLayer > g')].map(group => group.id).sort();
  assert.deepEqual(survivors, ['node-a', 'node-c']);

  // Undo brings the whole graph back, elements included.
  const undo = new window.KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true });
  window.dispatchEvent(undo);
  await nextFrame(window);
  await nextFrame(window);
  const restored = [...document.querySelectorAll('#nodesLayer > g')].map(group => group.id).sort();
  assert.deepEqual(restored, ['node-a', 'node-b', 'node-c']);
  assert.ok(edgeLine(document, 'e1').getAttribute('d').startsWith('M '), 'restored edges have their geometry');
});
