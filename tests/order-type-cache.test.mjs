import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

// Regression tests for the interaction between PR #19's render caches
// (sortedNodesByOrder / existingNodeTypes, keyed by array identity +
// length + graphRev) and in-place order/type edits, which change neither
// identity nor length. Without explicit invalidateGraphIndex() bumps at
// those edit sites, the matrix keeps showing the stale node order and
// type datalists keep showing stale type names until some structural
// graph change happens to bump graphRev.

const html = await readFile('index.html', 'utf8');

function createEditorDom(savedGraph) {
  const errors = [];
  const preload = `localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(savedGraph))});`;
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

const nextFrame = window => new Promise(resolve => window.setTimeout(resolve, 30));

async function setup(t, graph) {
  const { dom, errors } = createEditorDom(graph);
  t.after(() => { dom.window.close(); assert.deepEqual(errors.map(e => e.message), []); });
  const { window } = dom;
  const { document } = window;
  const svg = document.querySelector('#graphCanvas');
  svg.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0,
    width: 1000, height: 660, right: 1000, bottom: 660,
    toJSON() { return this; },
  });
  await nextFrame(window);
  await nextFrame(window);
  return { window, document, svg };
}

function clickNode(window, document, svg, id, x, y) {
  const shape = document.querySelector(`#node-${id} .node-shape`);
  assert.ok(shape, `#node-${id} rendered`);
  for (const [target, type] of [[shape, 'pointerdown'], [svg, 'pointerup']]) {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
    target.dispatchEvent(event);
  }
}

const matrixHeader = document =>
  [...document.querySelectorAll('#matrixHost thead [data-node-label]')].map(el => el.getAttribute('data-node-label'));

const threeNodes = labels => ({
  mode: 'select',
  viewBox: { x: 0, y: 0, w: 1000, h: 660 },
  nodes: [
    { id: 'n1', label: labels[0], x: 100, y: 100,order: 0 },
    { id: 'n2', label: labels[1], x: 300, y: 100, order: 1 },
    { id: 'n3', label: labels[2], x: 500, y: 100, order: 2 },
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'n2' }],
});

test('matrix move control reorders the matrix immediately (sorted-nodes cache)', async t => {
  const { window, document } = await setup(t, threeNodes(['A', 'B', 'C']));
  assert.deepEqual(matrixHeader(document), ['n1', 'n2', 'n3']);
  document.querySelector('#matrixHost thead [data-node-move="n1"][data-dir="1"]').click();
  await nextFrame(window);
  await nextFrame(window);
  assert.deepEqual(matrixHeader(document), ['n2', 'n1', 'n3'],
    'matrix must reflect the new node order without needing another graph change');
});

test('sort nodes by label reorders the matrix immediately (sorted-nodes cache)', async t => {
  const { window, document } = await setup(t, threeNodes(['C', 'A', 'B']));
  assert.deepEqual(matrixHeader(document), ['n1', 'n2', 'n3']);
  document.querySelector('#btnSortNodeLabel').click();
  await nextFrame(window);
  await nextFrame(window);
  assert.deepEqual(matrixHeader(document), ['n2', 'n3', 'n1'],
    'matrix must show label order A, B, C right after sorting');
});

test('renaming a node type updates type datalists immediately (type-list cache)', async t => {
  const graph = {
    mode: 'select',
    viewBox: { x: 0, y: 0, w: 1000, h: 660 },
    nodes: [
      { id: 'n1', label: 'A', type: 'alpha', x: 200, y: 200, width: 80, height: 40 },
      { id: 'n2', label: 'B', x: 500, y: 200, width: 80, height: 40 },
    ],
    edges: [],
  };
  const { window, document, svg } = await setup(t, graph);
  clickNode(window, document, svg, 'n1', 200, 200);
  await nextFrame(window);
  const typeInput = document.querySelector('#selNodeType');
  assert.ok(typeInput, 'selection panel shows the node type input');
  typeInput.value = 'beta';
  typeInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);

  clickNode(window, document, svg, 'n2', 500, 200);
  await nextFrame(window);
  const offered = [...document.querySelectorAll('#nodeTypeList option')].map(o => o.getAttribute('value'));
  assert.deepEqual(offered, ['beta'],
    'datalist for another node must offer the new type, not the stale cached list');
});
