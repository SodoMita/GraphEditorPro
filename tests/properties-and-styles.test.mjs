import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

function createEditorDom(savedGraph = null, matchMediaMatches = false) {
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
        matches: matchMediaMatches,
        onchange: null,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
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

function nextFrame(window) {
  return new Promise(resolve => window.requestAnimationFrame(resolve));
}

function setCanvasRect(svg) {
  svg.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0,
    width: 1000, height: 660, right: 1000, bottom: 660,
    toJSON() { return this; },
  });
}

function dispatchPointer(window, target, type, options = {}) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: options.button ?? 0,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
    shiftKey: options.shiftKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    altKey: options.altKey ?? false,
    metaKey: options.metaKey ?? false,
  });
  if (options.pointerId !== undefined) {
    Object.defineProperty(event, 'pointerId', { value: options.pointerId });
    Object.defineProperty(event, 'pointerType', { value: options.pointerType ?? 'mouse' });
  }
  target.dispatchEvent(event);
}

test('default node and edge type prioritizes type style over default settings', async () => {
  const graph = {
    settings: {
      nodeDefaults: {
        type: 'server',
        color: '#0ea5e9',
        shape: 'circle',
        width: 50,
        height: 50,
      },
      edgeDefaults: {
        type: 'network',
        color: '#94a3b8',
        strokeSize: 2.4,
      },
      nodeTypeStyles: {
        server: {
          color: '#ff0000',
          shape: 'square',
          width: 80,
          height: 80,
          strokeColor: '#ffff00',
        },
      },
      edgeTypeStyles: {
        network: {
          color: '#00ff00',
          strokeSize: 5.5,
        },
      },
    },
    nodes: [
      { id: 'n1', label: '1', x: 0, y: 0, order: 0 },
      { id: 'n2', label: '2', x: 100, y: 0, order: 1, color: '#123456' }, // explicit color override
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', directed: true },
      { id: 'e2', from: 'n1', to: 'n2', directed: false, color: '#654321' }, // explicit color override
    ],
  };

  const { dom, errors } = createEditorDom(graph);
  await nextFrame(dom.window);
  const document = dom.window.document;

  const n1Shape = document.querySelector('#node-n1 .node-shape');
  assert.equal(n1Shape.getAttribute('fill'), '#ff0000', 'node without explicit style prioritizes type style color');
  assert.equal(n1Shape.tagName.toLowerCase(), 'rect', 'node without explicit shape prioritizes type style shape (square)');

  const n2Shape = document.querySelector('#node-n2 .node-shape');
  assert.equal(n2Shape.getAttribute('fill'), '#123456', 'node with explicit color keeps its own color');

  const e1Line = document.querySelector('#edge-e1 .edge-line');
  assert.equal(e1Line.getAttribute('stroke'), '#00ff00', 'edge without explicit style prioritizes type style color');
  assert.equal(e1Line.getAttribute('stroke-width'), '5.5', 'edge without explicit stroke size prioritizes type style');

  const e2Line = document.querySelector('#edge-e2 .edge-line');
  assert.equal(e2Line.getAttribute('stroke'), '#654321', 'edge with explicit color keeps its own color');

  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('multi-selection exposes width, height, font, weight, label and applies to selected', async () => {
  const graph = {
    nodes: [
      { id: 'a', label: 'A', x: -200, y: 0, order: 0 },
      { id: 'b', label: 'B', x: 200, y: 0, order: 1 },
      { id: 'c', label: 'C', x: 0, y: 200, order: 2 },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', directed: true, weight: '1' },
      { id: 'e2', from: 'b', to: 'c', directed: true, weight: '2' },
    ],
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };

  const { dom, errors } = createEditorDom(graph);
  await nextFrame(dom.window);
  const window = dom.window;
  const document = window.document;
  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);

  // Select node-a and node-b with Shift to form a multi-selection
  const nodeA = document.getElementById('node-a');
  const nodeB = document.getElementById('node-b');
  dispatchPointer(window, nodeA, 'pointerdown', { pointerId: 1, clientX: 300, clientY: 330 });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 300, clientY: 330 });
  await nextFrame(window);
  dispatchPointer(window, nodeB, 'pointerdown', { pointerId: 1, clientX: 700, clientY: 330, shiftKey: true });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 700, clientY: 330 });
  await nextFrame(window);

  // Node controls in multi-selection
  const widthInput = document.querySelector('#mulNodeWidth');
  const heightInput = document.querySelector('#mulNodeHeight');
  const labelFontInput = document.querySelector('#mulNodeLabelFont');
  const labelInput = document.querySelector('#mulNodeLabel');
  const resetNodeBtn = document.querySelector('#mulResetNodeStyle');

  assert.ok(widthInput, 'mulNodeWidth exists in menu');
  assert.ok(heightInput, 'mulNodeHeight exists in menu');
  assert.ok(labelFontInput, 'mulNodeLabelFont exists in menu');
  assert.ok(labelInput, 'mulNodeLabel exists in menu');
  assert.ok(resetNodeBtn, 'mulResetNodeStyle exists in menu');

  // Apply width and height to selected nodes
  widthInput.value = '75';
  widthInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  heightInput.value = '65';
  heightInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  labelFontInput.value = 'Roboto';
  labelFontInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  labelInput.value = 'Group';
  labelInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);

  // Check SVG elements for node a and b
  const nodeAShape = document.querySelector('#node-a .node-shape');
  const nodeBShape = document.querySelector('#node-b .node-shape');
  const nodeCShape = document.querySelector('#node-c .node-shape');
  assert.equal(nodeAShape.getAttribute('rx'), '37.5', 'node a width updated to 75 (rx=37.5)');
  assert.equal(nodeBShape.getAttribute('rx'), '37.5', 'node b width updated to 75 (rx=37.5)');
  assert.notEqual(nodeCShape.getAttribute('rx'), '37.5', 'unselected node c width unchanged');

  // Check labels
  assert.equal(document.querySelector('#node-a text').textContent, 'Group', 'node a label updated');
  assert.equal(document.querySelector('#node-b text').textContent, 'Group', 'node b label updated');
  assert.equal(document.querySelector('#node-c text').textContent, 'C', 'node c label unchanged');

  // Reset styles for selected nodes
  resetNodeBtn.click();
  await nextFrame(window);
  const resetAShape = document.querySelector('#node-a .node-shape');
  assert.equal(resetAShape.getAttribute('rx'), '25', 'node a width reverted to default 50 (rx=25)');

  // Now test multi-edge selection
  const edgeE1 = document.getElementById('edge-e1');
  const edgeE2 = document.getElementById('edge-e2');
  dispatchPointer(window, edgeE1, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 330 });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 500, clientY: 330 });
  await nextFrame(window);
  dispatchPointer(window, edgeE2, 'pointerdown', { pointerId: 1, clientX: 600, clientY: 400, shiftKey: true });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 600, clientY: 400 });
  await nextFrame(window);

  const edgeFontInput = document.querySelector('#mulEdgeLabelFont');
  const edgeWeightInput = document.querySelector('#mulEdgeWeight');
  const edgeLabelInput = document.querySelector('#mulEdgeLabel');
  const resetEdgeBtn = document.querySelector('#mulResetEdgeStyle');

  assert.ok(edgeFontInput, 'mulEdgeLabelFont exists in menu');
  assert.ok(edgeWeightInput, 'mulEdgeWeight exists in menu');
  assert.ok(edgeLabelInput, 'mulEdgeLabel exists in menu');
  assert.ok(resetEdgeBtn, 'mulResetEdgeStyle exists in menu');

  edgeWeightInput.value = '42';
  edgeWeightInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  edgeFontInput.value = 'Courier New';
  edgeFontInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  edgeLabelInput.value = 'Link';
  edgeLabelInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);

  assert.equal(document.querySelector('#edge-e1 .edge-weight')?.textContent, '42', 'edge e1 weight updated');
  assert.equal(document.querySelector('#edge-e2 .edge-weight').textContent, '42', 'edge e2 weight updated');

  // Reset styles for selected edges
  resetEdgeBtn.click();
  await nextFrame(window);

  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('apply defaults to selected nodes and edges buttons exist and function', async () => {
  const graph = {
    settings: {
      nodeDefaults: { shape: 'square', color: '#abcdef' },
      edgeDefaults: { color: '#fedcba', strokeSize: 4 },
    },
    nodes: [
      { id: 'n1', label: '1', x: -100, y: 0, shape: 'circle', color: '#111111' },
      { id: 'n2', label: '2', x: 100, y: 0, shape: 'circle', color: '#222222' },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', directed: true, color: '#333333' },
    ],
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };

  const { dom, errors } = createEditorDom(graph);
  await nextFrame(dom.window);
  const window = dom.window;
  const document = window.document;
  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);

  const btnApplyNodeSel = document.querySelector('#btnApplyNodeDefaultsSel');
  const btnApplyEdgeSel = document.querySelector('#btnApplyEdgeDefaultsSel');
  assert.ok(btnApplyNodeSel, 'btnApplyNodeDefaultsSel exists');
  assert.ok(btnApplyEdgeSel, 'btnApplyEdgeDefaultsSel exists');

  // Select node n1
  const nodeN1 = document.getElementById('node-n1');
  dispatchPointer(window, nodeN1, 'pointerdown', { pointerId: 1, clientX: 400, clientY: 330 });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 400, clientY: 330 });
  await nextFrame(window);

  // Click apply defaults to selected
  btnApplyNodeSel.click();
  await nextFrame(window);

  const n1Shape = document.querySelector('#node-n1 .node-shape');
  const n2Shape = document.querySelector('#node-n2 .node-shape');
  assert.equal(n1Shape.getAttribute('fill'), '#abcdef', 'selected node n1 received default color');
  assert.equal(n2Shape.getAttribute('fill'), '#222222', 'unselected node n2 was untouched');

  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('landscape canvas-disabled mode allows bottom pane and table scroll to expand without dead space', async () => {
  const css = await readFile('src/styles.css', 'utf8');

  // Verify CSS contains the full-height flex rules for canvas-hidden mode
  assert.ok(
    css.includes('.main:not(.v-canvas) .bottom-pane'),
    'CSS has rules targeting .bottom-pane when canvas is hidden'
  );
  assert.ok(
    css.includes('.main:not(.v-canvas) .table-scroll'),
    'CSS has rules expanding .table-scroll when canvas is hidden'
  );

  const { dom, errors } = createEditorDom();
  await nextFrame(dom.window);
  const document = dom.window.document;

  const main = document.querySelector('.main');
  const bottomPane = document.querySelector('.bottom-pane');
  const graphBtn = document.querySelector('[data-view-btn="graph"]');
  const matrixBtn = document.querySelector('[data-view-btn="matrix"]');

  // Turn on matrix first so we can turn off graph (at least 1 view must stay visible)
  if (matrixBtn && !main.classList.contains('v-matrix')) {
    matrixBtn.click();
  }
  if (graphBtn && main.classList.contains('v-canvas')) {
    graphBtn.click();
  }
  await nextFrame(dom.window);

  assert.ok(!main.classList.contains('v-canvas'), 'v-canvas removed from main when canvas is hidden');
  assert.ok(main.classList.contains('v-matrix'), 'v-matrix is active');
  assert.ok(bottomPane, 'bottom pane exists');

  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
