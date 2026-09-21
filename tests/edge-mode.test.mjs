import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

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

function dispatchPointer(window, target, type, options) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: options.button ?? 0,
    clientX: options.clientX,
    clientY: options.clientY,
    shiftKey: Boolean(options.shiftKey), // shift is the add-to-selection modifier
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId },
    pointerType: { value: options.pointerType ?? 'mouse' },
  });
  target.dispatchEvent(event);
}

const nextFrame = window => new Promise(resolve => window.setTimeout(resolve, 30));
const settle = (window, ms) => new Promise(resolve => window.setTimeout(resolve, ms));

const baseGraph = {
  mode: 'edge',
  viewBox: { x: 0, y: 0, w: 1000, h: 660 },
  nodes: [
    { id: 'n1', label: 'A', x: 100, y: 100 },
    { id: 'n2', label: 'B', x: 300, y: 100 },
    { id: 'n3', label: 'C', x: 500, y: 100 },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', directed: true, label: 'forward', weight: '7', color: '#ff0000' },
    { id: 'e2', from: 'n2', to: 'n1', directed: true, label: 'reverse' },
    { id: 'e3', from: 'n2', to: 'n3', directed: false },
    { id: 'e4', from: 'n3', to: 'n3', directed: true },
    { id: 'e5', from: 'n1', to: 'n3', directed: true },
  ],
};

function exported(document) {
  document.querySelector('#btnExportJson').click();
  const modal = document.querySelector('.export-modal');
  const graph = JSON.parse(modal.querySelector('textarea').value);
  modal.remove();
  return graph;
}

async function setup(t, graph = baseGraph) {
  const { dom, errors } = createEditorDom(graph);
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  const { window } = dom;
  const { document } = window;
  await nextFrame(window);
  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  let hit = svg;
  document.elementFromPoint = () => hit;
  const pointer = (target, type, x, y, options = {}) => dispatchPointer(window, target, type, {
    pointerId: 1, clientX: x, clientY: y, ...options,
  });
  const drag = (destination, type = 'pointerup', pointerType = 'mouse', x = 720, y = 430) => {
    hit = document.querySelector('#node-n1');
    pointer(hit, 'pointerdown', 100, 100, { pointerType });
    hit = destination;
    pointer(svg, 'pointermove', x, y, { pointerType });
    pointer(svg, type, x, y, { pointerType });
  };
  return { window, document, svg, pointer, drag, setHit: el => { hit = el; } };
}

test('edge-mode flip control reverses only selected directed edges and supports undo/redo', async t => {
  const { window, document, pointer } = await setup(t);
  const button = document.querySelector('#btnFlipEdges');
  assert.ok(button.querySelector('use[href="#icon-flip-edge"]'));
  assert.equal(button.getAttribute('aria-label'), 'Flip selected directed edges');
  assert.equal(button.disabled, true);
  assert.equal(window.getComputedStyle(button).display, 'inline-flex');
  pointer(document.querySelector('#edge-e3'), 'pointerdown', 400, 100);
  assert.equal(button.disabled, true, 'undirected-only selection cannot be flipped');
  for (const id of ['e1', 'e2', 'e4']) {
    pointer(document.querySelector('#edge-' + id), 'pointerdown', 200, 100, { shiftKey: true });
  }
  assert.equal(button.disabled, false);
  const before = exported(document);
  const oldArrow = document.querySelector('#edge-e1 .edge-arrow')?.outerHTML;
  button.click();
  await settle(window, 90);
  const after = exported(document);
  assert.deepEqual(after.nodes, before.nodes);
  assert.deepEqual(after.selection, before.selection);
  assert.deepEqual(after.edges, before.edges.map(e => ['e1', 'e2'].includes(e.id) ? { ...e, from: e.to, to: e.from } : e));
  assert.equal(document.querySelector('#edge-e1').dataset.from, 'n2');
  assert.equal(document.querySelector('#edge-e1').dataset.to, 'n1');
  assert.notEqual(document.querySelector('#edge-e1 .edge-arrow')?.outerHTML, oldArrow);
  document.querySelector('#btnUndo').click();
  await nextFrame(window);
  assert.deepEqual(exported(document).edges, before.edges);
  document.querySelector('#btnRedo').click();
  await nextFrame(window);
  assert.deepEqual(exported(document).edges, after.edges);
  document.querySelector('#modeSelect').click();
  assert.equal(window.getComputedStyle(button).display, 'none');
});

for (const pointerType of ['mouse', 'touch']) {
  test(`${pointerType} connection drop on canvas creates a styled, snapped node and edge in one undo step`, async t => {
    const graph = { ...baseGraph, edges: [], settings: {
      snap: true, gridSizeX: 40, gridSizeY: 40,
      directed: true, edgeLabel: 'new link', edgeWeight: '12',
      nodeDefaults: { type: 'server', color: '#ff0000', shape: 'square', width: 70, height: 60 },
    } };
    const { window, document, drag } = await setup(t, graph);
    document.querySelector('#nodeLabel').value = 'New';
    const before = exported(document);
    drag(document.querySelector('#gridRect'), 'pointerup', pointerType, 713, 427);
    await settle(window, 90);
    const after = exported(document);
    assert.equal(after.nodes.length, 4);
    assert.equal(after.edges.length, 1);
    const node = after.nodes.at(-1), edge = after.edges[0];
    assert.deepEqual([node.x, node.y], [720, 440]);
    assert.equal(node.label, 'New');
    assert.equal(node.type, 'server');
    assert.equal(node.shape, undefined, 'new nodes retain live style inheritance');
    const shape = document.querySelector(`#node-${node.id} .node-shape`);
    assert.equal(shape.tagName.toLowerCase(), 'rect');
    assert.equal(shape.getAttribute('fill'), '#ff0000');
    assert.deepEqual([edge.from, edge.to, edge.directed, edge.label, edge.weight], ['n1', node.id, true, 'new link', '12']);
    assert.deepEqual(after.selection, { nodes: [], edges: [edge.id] });
    assert.equal(document.querySelector('#dragLine').style.display, 'none');
    document.querySelector('#btnUndo').click();
    await nextFrame(window);
    assert.deepEqual(exported(document).nodes, before.nodes);
    assert.deepEqual(exported(document).edges, []);
    document.querySelector('#btnRedo').click();
    await nextFrame(window);
    assert.deepEqual(exported(document).nodes, after.nodes.map(n => ({ color: '', shape: '', ...n })));
    assert.deepEqual(exported(document).edges, after.edges);
  });
}

test('drop coordinates follow a panned and zoomed camera, and undirected creation stays undirected', async t => {
  const { window, document, svg, drag } = await setup(t, {
    ...baseGraph, edges: [], viewBox: { x: -200, y: 50, w: 500, h: 330 }, settings: { directed: false },
  });
  drag(svg, 'pointerup', 'mouse', 800, 600);
  await nextFrame(window);
  const graph = exported(document);
  assert.deepEqual([graph.nodes.at(-1).x, graph.nodes.at(-1).y], [200, 350]);
  assert.equal(graph.edges[0].directed, false);
});

test('existing-node and self-loop connections do not create extra nodes', async t => {
  const { window, document, drag } = await setup(t, { ...baseGraph, edges: [] });
  drag(document.querySelector('#node-n2'));
  await nextFrame(window);
  let graph = exported(document);
  assert.equal(graph.nodes.length, 3);
  assert.deepEqual([graph.edges[0].from, graph.edges[0].to], ['n1', 'n2']);
  drag(document.querySelector('#node-n1'));
  await nextFrame(window);
  graph = exported(document);
  assert.equal(graph.nodes.length, 3);
  assert.deepEqual([graph.edges[1].from, graph.edges[1].to], ['n1', 'n1']);
});

test('cancelled connections, edge hits, controls, outside drops and clicks never create nodes', async t => {
  const { window, document, svg, pointer, drag, setHit } = await setup(t);
  const before = exported(document);
  for (const target of [null, document.body, document.querySelector('#modeEdge'), document.querySelector('#edge-e1')]) {
    drag(target);
    await nextFrame(window);
  }
  drag(svg, 'pointercancel');
  const source = document.querySelector('#node-n1');
  setHit(source);
  pointer(source, 'pointerdown', 100, 100);
  pointer(svg, 'pointerup', 100, 100);
  // A canvas click without a source is not node mode.
  setHit(svg);
  pointer(svg, 'pointerdown', 700, 400);
  pointer(svg, 'pointerup', 700, 400);
  await nextFrame(window);
  const after = exported(document);
  assert.deepEqual(after.nodes, before.nodes);
  assert.deepEqual(after.edges, before.edges);
  assert.equal(document.querySelector('#btnUndo').disabled, true);
});

test('touch source tap followed by canvas tap creates a connected node; cancellation does not', async t => {
  const { window, document, svg, pointer, setHit } = await setup(t, { ...baseGraph, edges: [] });
  const tapSource = () => {
    const source = document.querySelector('#node-n1');
    setHit(source);
    pointer(source, 'pointerdown', 100, 100, { pointerType: 'touch' });
    pointer(svg, 'pointerup', 100, 100, { pointerType: 'touch' });
  };
  tapSource();
  setHit(svg);
  pointer(svg, 'pointerdown', 720, 430, { pointerType: 'touch' });
  pointer(svg, 'pointercancel', 720, 430, { pointerType: 'touch' });
  assert.equal(exported(document).nodes.length, 3);
  tapSource();
  setHit(svg);
  pointer(svg, 'pointerdown', 720, 430, { pointerType: 'touch' });
  pointer(svg, 'pointerup', 720, 430, { pointerType: 'touch' });
  await nextFrame(window);
  const graph = exported(document);
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.edges.length, 1);
  assert.deepEqual([graph.edges[0].from, graph.edges[0].to], ['n1', graph.nodes.at(-1).id]);
});
