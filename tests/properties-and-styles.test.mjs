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

test('Reset Style syncs the single-node shape, stroke style and label position after reset and undo/redo', async () => {
  const graph = {
    title: 'reset-sync', nextNode: 2, nextEdge: 1, mode: 'select',
    nodes: [{ id: 'n1', label: 'N1', x: 0, y: 0, order: 0, shape: 'square', strokeStyle: 'dashed', labelPosition: 'top' }],
    edges: [],
    settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  const nodeN1 = document.getElementById('node-n1');
  dispatchPointer(window, nodeN1, 'pointerdown', { pointerId: 1, clientX: 300, clientY: 330 });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 300, clientY: 330 });
  await nextFrame(window);

  const shapeEl = () => document.querySelector('#selNodeShape');
  const strokeEl = () => document.querySelector('#selNodeStrokeStyle');
  const posEl = () => document.querySelector('#selNodeLabelPos');
  assert.equal(shapeEl()?.value, 'square');
  assert.equal(strokeEl()?.value, 'dashed');
  assert.equal(posEl()?.value, 'top');

  // Push a history entry while the selection is active — the app's undo
  // restores snapshots, and selection only rides snapshots created by a
  // mutation pushed during the selection. The shape dropdown is not part of
  // the panel's interpolated HTML, so this leaves the cached HTML valid for
  // the reuse path — the exact situation the early-return bug strands.
  const shapeSet = document.querySelector('#selNodeShape');
  shapeSet.value = 'circle';
  shapeSet.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  assert.equal(shapeEl()?.value, 'circle', 'the dropdown reflects the edit');

  // Reset Style clears the only overrides; the panel HTML is unchanged, so
  // the cached-panel early return must not leave the dropdowns showing the
  // cleared overrides.
  document.querySelector('#selResetStyle').click();
  await nextFrame(window);
  assert.equal(shapeEl()?.value, '', 'the shape dropdown shows inherit after reset');
  assert.equal(strokeEl()?.value, '', 'the stroke style dropdown shows inherit after reset');
  assert.equal(posEl()?.value, '', 'the label position dropdown shows inherit after reset');

  document.querySelector('#btnUndo').click();
  await nextFrame(window); await new Promise(r => window.setTimeout(r, 40));
  assert.equal(shapeEl()?.value, 'circle', 'undo restores the shape dropdown');
  assert.equal(strokeEl()?.value, 'dashed', 'undo restores the stroke style dropdown');
  assert.equal(posEl()?.value, 'top', 'undo restores the label position dropdown');

  document.querySelector('#btnRedo').click();
  await nextFrame(window); await new Promise(r => window.setTimeout(r, 40));
  assert.equal(shapeEl()?.value, '', 'redo clears the shape dropdown again');
  assert.equal(strokeEl()?.value, '', 'redo clears the stroke style dropdown again');
  assert.equal(posEl()?.value, '', 'redo clears the label position dropdown again');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('types defined in styles appear in selection type dropdowns (preloaded, single, multi, and edge)', async () => {
  const datalistValues = (document, selector) =>
    [...document.querySelectorAll(`${selector} option`)].map(o => o.getAttribute('value'));

  const graph = {
    mode: 'select',
    settings: {
      nodeTypeStyles: {
        server: { color: '#ff0000', shape: 'square', width: 80, height: 60 },
        client: { color: '#00aa00', shape: 'diamond' },
        ' padded': { color: '#aa00ff', shape: 'hexagon' },
        '   ': { color: '#111111' },
      },
      edgeTypeStyles: {
        fiber: { color: '#00ff00', strokeSize: 5, strokeStyle: 'dashed' },
        wireless: { color: '#0088ff', strokeSize: 3 },
      },
    },
    nodes: [
      { id: 'a', label: 'A', x: -200, y: 0, order: 0 },
      { id: 'b', label: 'B', x: 200, y: 0, order: 1, type: 'legacy' },
      { id: 'c', label: 'C', x: 0, y: 200, order: 2 },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', directed: true, weight: '1' },
      { id: 'e2', from: 'b', to: 'c', directed: true, weight: '2' },
    ],
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };

  const { dom, errors } = createEditorDom(graph);
  const { window } = dom;
  const { document } = window;
  await nextFrame(window);
  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);

  // Edit-tab and Style-tab datalists already include the style-defined types
  // (preserving significant leading whitespace while dropping whitespace-only keys).
  assert.deepEqual(datalistValues(document, '#nodeTypeListEdit'), [' padded', 'client', 'legacy', 'server']);
  assert.deepEqual(datalistValues(document, '#defNodeTypeList'), [' padded', 'client', 'legacy', 'server']);
  assert.deepEqual(datalistValues(document, '#nodeTypeStyleList'), [' padded', 'client', 'legacy', 'server']);
  assert.deepEqual(datalistValues(document, '#edgeTypeListEdit'), ['fiber', 'wireless']);
  assert.deepEqual(datalistValues(document, '#defEdgeTypeList'), ['fiber', 'wireless']);
  assert.deepEqual(datalistValues(document, '#edgeTypeStyleList'), ['fiber', 'wireless']);

  // Single untyped node selection offers all node types, including unused style types.
  dispatchPointer(window, document.getElementById('node-a'), 'pointerdown', { pointerId: 1, clientX: 300, clientY: 330 });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 300, clientY: 330 });
  await nextFrame(window);

  const selNodeType = document.querySelector('#selNodeType');
  assert.ok(selNodeType, 'single-node type input is rendered');
  assert.equal(selNodeType.getAttribute('list'), 'nodeTypeList');
  assert.deepEqual(datalistValues(document, '#nodeTypeList'), [' padded', 'client', 'legacy', 'server']);

  // Choosing a style-defined type applies its style immediately and keeps all types listed.
  selNodeType.value = 'server';
  selNodeType.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  const nodeAShape = document.querySelector('#node-a .node-shape');
  assert.equal(nodeAShape.getAttribute('fill'), '#ff0000');
  assert.equal(nodeAShape.tagName.toLowerCase(), 'rect');
  assert.deepEqual(datalistValues(document, '#nodeTypeList'), [' padded', 'client', 'legacy', 'server']);

  // Leading-whitespace type key keeps its style binding, loads in the form, and deletes cleanly.
  const selNodeTypeAfter = document.querySelector('#selNodeType');
  selNodeTypeAfter.value = ' padded';
  selNodeTypeAfter.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  assert.equal(document.querySelector('#node-a .node-shape').getAttribute('fill'), '#aa00ff');
  const ntsInput = document.querySelector('#nodeTypeStyleInput');
  ntsInput.value = ' padded';
  ntsInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(document.querySelector('#ntsColor').value, '#aa00ff');
  document.querySelector('#btnDelNodeTypeStyle').click();
  await nextFrame(window);
  assert.deepEqual(datalistValues(document, '#nodeTypeStyleList'), [' padded', 'client', 'legacy', 'server']);

  // Multi-node selection offers the style-defined node types and applies them.
  dispatchPointer(window, document.getElementById('node-c'), 'pointerdown', { pointerId: 1, clientX: 500, clientY: 530, shiftKey: true });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 500, clientY: 530 });
  await nextFrame(window);

  const mulNodeType = document.querySelector('#mulNodeType');
  assert.ok(mulNodeType, 'multi-node type input is rendered');
  assert.equal(mulNodeType.getAttribute('list'), 'nodeTypeList');
  assert.deepEqual(datalistValues(document, '#nodeTypeList'), [' padded', 'client', 'legacy', 'server']);
  mulNodeType.value = 'client';
  mulNodeType.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  assert.equal(document.querySelector('#node-a .node-shape').getAttribute('fill'), '#00aa00');
  assert.equal(document.querySelector('#node-c .node-shape').getAttribute('fill'), '#00aa00');
  assert.deepEqual(datalistValues(document, '#nodeTypeList'), ['client', 'legacy', 'server']);

  // Single edge selection offers style-defined edge types and applies them.
  dispatchPointer(window, document.getElementById('edge-e1'), 'pointerdown', { pointerId: 1, clientX: 500, clientY: 330 });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 500, clientY: 330 });
  await nextFrame(window);

  const selEdgeType = document.querySelector('#selEdgeType');
  assert.ok(selEdgeType, 'single-edge type input is rendered');
  assert.equal(selEdgeType.getAttribute('list'), 'edgeTypeList');
  assert.deepEqual(datalistValues(document, '#edgeTypeList'), ['fiber', 'wireless']);
  selEdgeType.value = 'fiber';
  selEdgeType.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  assert.equal(document.querySelector('#edge-e1 .edge-line').getAttribute('stroke'), '#00ff00');
  assert.equal(document.querySelector('#edge-e1 .edge-line').getAttribute('stroke-width'), '5');

  // Multi-edge selection offers style-defined edge types and applies them.
  dispatchPointer(window, document.getElementById('edge-e2'), 'pointerdown', { pointerId: 1, clientX: 600, clientY: 430, shiftKey: true });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 600, clientY: 430 });
  await nextFrame(window);

  const mulEdgeType = document.querySelector('#mulEdgeType');
  assert.ok(mulEdgeType, 'multi-edge type input is rendered');
  assert.equal(mulEdgeType.getAttribute('list'), 'edgeTypeList');
  assert.deepEqual(datalistValues(document, '#edgeTypeList'), ['fiber', 'wireless']);
  mulEdgeType.value = 'wireless';
  mulEdgeType.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  assert.equal(document.querySelector('#edge-e1 .edge-line').getAttribute('stroke'), '#0088ff');
  assert.equal(document.querySelector('#edge-e2 .edge-line').getAttribute('stroke'), '#0088ff');

  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('saving, deleting, defaulting, and undoing style types live-updates selected type dropdowns', async () => {
  const datalistValues = (document, selector) =>
    [...document.querySelectorAll(`${selector} option`)].map(o => o.getAttribute('value'));

  const graph = {
    mode: 'select',
    nodes: [
      { id: 'n1', label: 'N1', x: -150, y: 0, order: 0 },
      { id: 'n2', label: 'N2', x: 150, y: 0, order: 1 },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', directed: true },
    ],
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };

  const { dom, errors } = createEditorDom(graph);
  const { window } = dom;
  const { document } = window;
  await nextFrame(window);
  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);

  // Select n1 first, then define a new node type style in the Style tab.
  dispatchPointer(window, document.getElementById('node-n1'), 'pointerdown', { pointerId: 1, clientX: 350, clientY: 330 });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 350, clientY: 330 });
  await nextFrame(window);
  assert.deepEqual(datalistValues(document, '#nodeTypeList'), []);

  const selNodeTypeInitial = document.querySelector('#selNodeType');
  const ntsInput = document.querySelector('#nodeTypeStyleInput');
  const ntsColor = document.querySelector('#ntsColor');
  const ntsShape = document.querySelector('#ntsShape');
  ntsInput.value = 'router';
  ntsColor.value = '#ef4444';
  ntsShape.value = 'hexagon';
  document.querySelector('#btnSaveNodeTypeStyle').click();

  // Dropdown for already-selected node updates in place without rebuilding the panel.
  assert.equal(document.querySelector('#selNodeType'), selNodeTypeInitial, 'datalist-only update preserves selection panel DOM');
  assert.deepEqual(datalistValues(document, '#nodeTypeList'), ['router']);
  assert.deepEqual(datalistValues(document, '#nodeTypeListEdit'), ['router']);
  assert.deepEqual(datalistValues(document, '#defNodeTypeList'), ['router']);
  assert.deepEqual(datalistValues(document, '#nodeTypeStyleList'), ['router']);

  // Default node type in Style tab also surfaces in the selection dropdown.
  const defNodeType = document.querySelector('#defNodeType');
  defNodeType.value = 'worker';
  defNodeType.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(document.querySelector('#selNodeType'), selNodeTypeInitial, 'default-type datalist update preserves selection panel DOM');
  assert.deepEqual(datalistValues(document, '#nodeTypeList'), ['router', 'worker']);

  // Undo removes 'worker'; undo again removes 'router'; redo brings 'router' back.
  document.querySelector('#btnUndo').click();
  await nextFrame(window);
  await new Promise(r => window.setTimeout(r, 40));
  assert.deepEqual(datalistValues(document, '#nodeTypeList'), ['router']);

  document.querySelector('#btnUndo').click();
  await nextFrame(window);
  await new Promise(r => window.setTimeout(r, 40));
  assert.deepEqual(datalistValues(document, '#nodeTypeList'), []);

  document.querySelector('#btnRedo').click();
  await nextFrame(window);
  await new Promise(r => window.setTimeout(r, 40));
  assert.deepEqual(datalistValues(document, '#nodeTypeList'), ['router']);

  // Renaming the selected node's label preserves one-frame sidebar deferral (no focus tear).
  const selNodeTypeBeforeRename = document.querySelector('#selNodeType');
  const selNodeLabel = document.querySelector('#selNodeLabel');
  selNodeLabel.value = 'N1 renamed';
  selNodeLabel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  assert.equal(document.querySelector('#selNodeType'), selNodeTypeBeforeRename, 'label change defers sidebar rebuild past the immediate frame');

  // Special HTML chars and Object.prototype property names work safely as type names.
  ntsInput.value = 'A & "B" <C>';
  ntsColor.value = '#123456';
  document.querySelector('#btnSaveNodeTypeStyle').click();
  ntsInput.value = 'constructor';
  ntsColor.value = '#654321';
  document.querySelector('#btnSaveNodeTypeStyle').click();
  assert.deepEqual(datalistValues(document, '#nodeTypeList'), ['A & "B" <C>', 'constructor', 'router']);

  const selNodeType = document.querySelector('#selNodeType');
  selNodeType.value = 'constructor';
  selNodeType.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  assert.equal(document.querySelector('#node-n1 .node-shape').getAttribute('fill'), '#654321');

  // Deleting an unused style type removes it immediately from all dropdowns.
  ntsInput.value = 'router';
  document.querySelector('#btnDelNodeTypeStyle').click();
  assert.deepEqual(datalistValues(document, '#nodeTypeList'), ['A & "B" <C>', 'constructor']);
  assert.deepEqual(datalistValues(document, '#nodeTypeListEdit'), ['A & "B" <C>', 'constructor']);

  // Select edge e1, then define, default, and delete edge type styles while selected.
  dispatchPointer(window, document.getElementById('edge-e1'), 'pointerdown', { pointerId: 1, clientX: 500, clientY: 330 });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 500, clientY: 330 });
  await nextFrame(window);
  assert.deepEqual(datalistValues(document, '#edgeTypeList'), []);

  const etsInput = document.querySelector('#edgeTypeStyleInput');
  const etsColor = document.querySelector('#etsColor');
  etsInput.value = 'backbone';
  etsColor.value = '#22c55e';
  document.querySelector('#btnSaveEdgeTypeStyle').click();
  assert.deepEqual(datalistValues(document, '#edgeTypeList'), ['backbone']);
  assert.deepEqual(datalistValues(document, '#edgeTypeListEdit'), ['backbone']);
  assert.deepEqual(datalistValues(document, '#defEdgeTypeList'), ['backbone']);
  assert.deepEqual(datalistValues(document, '#edgeTypeStyleList'), ['backbone']);

  const defEdgeType = document.querySelector('#defEdgeType');
  defEdgeType.value = 'uplink';
  defEdgeType.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(datalistValues(document, '#edgeTypeList'), ['backbone', 'uplink']);

  defEdgeType.value = '';
  defEdgeType.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(datalistValues(document, '#edgeTypeList'), ['backbone']);

  etsInput.value = 'backbone';
  document.querySelector('#btnDelEdgeTypeStyle').click();
  assert.deepEqual(datalistValues(document, '#edgeTypeList'), []);
  assert.deepEqual(datalistValues(document, '#edgeTypeListEdit'), []);

  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('pasting tagged clipboard entities with non-string types completes cleanly, renders, and records undo', async () => {
  const datalistValues = (document, selector) =>
    [...document.querySelectorAll(`${selector} option`)].map(o => o.getAttribute('value'));

  const graph = {
    mode: 'select',
    settings: {
      nodeTypeStyles: { '42': { color: '#ef4444', shape: 'square' } },
      edgeTypeStyles: { '7': { color: '#22c55e', strokeSize: 5 } },
    },
    nodes: [{ id: 'base', label: 'Base', x: -200, y: 0, order: 0 }],
    edges: [],
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const payload = JSON.stringify({
    type: 'graph-editor-clipboard',
    nodes: [
      { id: 'p1', label: 'Numeric', x: 0, y: 0, order: 0, type: 42 },
      { id: 'p2', label: 'Zero', x: 160, y: 0, order: 1, type: 0 },
      { id: 'p3', label: 'Bool', x: 160, y: 160, order: 2, type: true },
    ],
    edges: [
      { id: 'pe1', from: 'p1', to: 'p2', directed: true, type: 7 },
    ],
    externalEdges: [
      { id: 'pe2', from: 'base', to: 'p1', directed: true, type: 99 },
    ],
  });

  const { dom, errors } = createEditorDom(graph);
  const { window } = dom;
  const { document } = window;
  await nextFrame(window);

  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => {}, readText: async () => payload },
  });

  document.querySelector('#btnPaste2').click();
  await nextFrame(window);
  await new Promise(r => window.setTimeout(r, 80));

  // All pasted nodes and edges render on the canvas and match string style keys.
  const p1Shape = document.querySelector('#node-p1 .node-shape');
  assert.ok(p1Shape, 'pasted node with numeric type renders on canvas');
  assert.equal(p1Shape.getAttribute('fill'), '#ef4444');
  assert.equal(p1Shape.tagName.toLowerCase(), 'rect');
  assert.ok(document.querySelector('#node-p2 .node-shape'), 'pasted node with falsy numeric type renders');
  assert.ok(document.querySelector('#node-p3 .node-shape'), 'pasted node with boolean type renders');

  const pe1Line = document.querySelector('#edge-pe1 .edge-line');
  assert.ok(pe1Line, 'pasted edge with numeric type renders on canvas');
  assert.equal(pe1Line.getAttribute('stroke'), '#22c55e');
  assert.ok(document.querySelector('#edge-pe2 .edge-line'), 'pasted external edge with numeric type renders');

  // Type datalists offer normalized string types (excluding falsy 0).
  assert.deepEqual(datalistValues(document, '#nodeTypeListEdit'), ['42', 'true']);
  assert.deepEqual(datalistValues(document, '#edgeTypeListEdit'), ['7', '99']);
  assert.doesNotMatch(document.querySelector('#toast')?.textContent || '', /trim is not a function|failed/i);

  // Undo step was recorded and cleanly reverts the entire paste; redo restores it.
  const btnUndo = document.querySelector('#btnUndo');
  assert.equal(btnUndo.disabled, false, 'paste records an undo step');
  btnUndo.click();
  await nextFrame(window);
  await new Promise(r => window.setTimeout(r, 40));
  assert.equal(document.querySelector('#node-p1'), null, 'undo removes pasted node');
  assert.equal(document.querySelector('#edge-pe1'), null, 'undo removes pasted edge');
  assert.deepEqual(datalistValues(document, '#nodeTypeListEdit'), ['42']);
  assert.deepEqual(datalistValues(document, '#edgeTypeListEdit'), ['7']);

  document.querySelector('#btnRedo').click();
  await nextFrame(window);
  await new Promise(r => window.setTimeout(r, 40));
  assert.equal(document.querySelector('#node-p1 .node-shape')?.getAttribute('fill'), '#ef4444');
  assert.deepEqual(datalistValues(document, '#nodeTypeListEdit'), ['42', 'true']);
  assert.deepEqual(datalistValues(document, '#edgeTypeListEdit'), ['7', '99']);

  // Single-node tagged paste with numeric type also populates #selNodeType and #nodeTypeList.
  const soloPayload = JSON.stringify({
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'solo', label: 'Solo', x: -50, y: -150, order: 0, type: 108 }],
    edges: [],
    externalEdges: [],
  });
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => {}, readText: async () => soloPayload },
  });
  document.querySelector('#btnPaste2').click();
  await nextFrame(window);
  await new Promise(r => window.setTimeout(r, 80));
  assert.ok(document.querySelector('#node-solo .node-shape'), 'single pasted node with numeric type renders');
  assert.equal(document.querySelector('#selNodeType')?.value, '108');
  assert.deepEqual(datalistValues(document, '#nodeTypeList'), ['108', '42', 'true']);

  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('default-only padded node and edge types can be styled, loaded, and deleted from their suggestions', async () => {
  const datalistValues = (document, selector) =>
    [...document.querySelectorAll(`${selector} option`)].map(o => o.getAttribute('value'));

  const graph = {
    mode: 'select',
    settings: {
      nodeTypeStyles: { padded: { color: '#00aa00', shape: 'square' } },
    },
    nodes: [
      { id: 'inherit1', label: 'Inherit', x: -180, y: 0, order: 0 },
      { id: 'exact1', label: 'Trimmed', x: 180, y: 0, order: 1, type: 'padded' },
    ],
    edges: [
      { id: 'e1', from: 'inherit1', to: 'exact1', directed: true },
    ],
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };

  const { dom, errors } = createEditorDom(graph);
  const { window } = dom;
  const { document } = window;
  await nextFrame(window);

  // Set default node type to a padded name no node or style currently uses.
  const defNodeType = document.querySelector('#defNodeType');
  defNodeType.value = ' padded';
  defNodeType.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(datalistValues(document, '#nodeTypeStyleList'), [' padded', 'padded']);

  // Selecting ' padded' loads a clean form (not 'padded's green) and saves under ' padded'.
  const ntsInput = document.querySelector('#nodeTypeStyleInput');
  const ntsColor = document.querySelector('#ntsColor');
  const ntsShape = document.querySelector('#ntsShape');
  ntsInput.value = ' padded';
  ntsInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(ntsColor.value, '#0ea5e9', 'does not bleed the trimmed type style into the padded default');

  ntsColor.value = '#ff0000';
  ntsShape.value = 'hexagon';
  document.querySelector('#btnSaveNodeTypeStyle').click();
  await nextFrame(window);

  assert.equal(ntsInput.value, ' padded', 'style input retains exact padded default type key');
  assert.equal(document.querySelector('#node-inherit1 .node-shape').getAttribute('fill'), '#ff0000',
    'untyped node inheriting the padded default type receives the saved red style');
  assert.equal(document.querySelector('#node-exact1 .node-shape').getAttribute('fill'), '#00aa00',
    'separate unpadded type style is preserved untouched');
  assert.deepEqual(datalistValues(document, '#nodeTypeStyleList'), [' padded', 'padded']);

  // Undo/redo round-trips the padded default style cleanly through sanitizeState.
  document.querySelector('#btnUndo').click();
  await nextFrame(window);
  await new Promise(r => window.setTimeout(r, 40));
  assert.equal(document.querySelector('#node-inherit1 .node-shape').getAttribute('fill'), '#0ea5e9');
  assert.deepEqual(datalistValues(document, '#nodeTypeStyleList'), [' padded', 'padded']);
  document.querySelector('#btnRedo').click();
  await nextFrame(window);
  await new Promise(r => window.setTimeout(r, 40));
  assert.equal(document.querySelector('#node-inherit1 .node-shape').getAttribute('fill'), '#ff0000');

  // Same workflow for a default-only padded edge type (with leading and trailing spaces).
  const defEdgeType = document.querySelector('#defEdgeType');
  defEdgeType.value = ' padded ';
  defEdgeType.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(datalistValues(document, '#edgeTypeStyleList'), [' padded ']);

  const etsInput = document.querySelector('#edgeTypeStyleInput');
  const etsColor = document.querySelector('#etsColor');
  const etsStrokeSize = document.querySelector('#etsStrokeSize');
  etsInput.value = ' padded ';
  etsInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  etsColor.value = '#ff0000';
  etsStrokeSize.value = '6';
  document.querySelector('#btnSaveEdgeTypeStyle').click();
  await nextFrame(window);

  assert.equal(etsInput.value, ' padded ');
  assert.equal(document.querySelector('#edge-e1 .edge-line').getAttribute('stroke'), '#ff0000',
    'untyped edge inheriting the padded default type receives the saved red style');
  assert.equal(document.querySelector('#edge-e1 .edge-line').getAttribute('stroke-width'), '6');

  // Deleting the padded edge style removes it cleanly and reverts the inheriting edge.
  document.querySelector('#btnDelEdgeTypeStyle').click();
  await nextFrame(window);
  assert.equal(document.querySelector('#edge-e1 .edge-line').getAttribute('stroke'), '#94a3b8');

  // Brand-new type names with accidental whitespace still trim normally.
  ntsInput.value = '  fresh  ';
  ntsColor.value = '#123456';
  document.querySelector('#btnSaveNodeTypeStyle').click();
  assert.equal(ntsInput.value, 'fresh');
  assert.deepEqual(datalistValues(document, '#nodeTypeStyleList'), [' padded', 'fresh', 'padded']);

  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
