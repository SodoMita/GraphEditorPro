// Paste-in-place (exact paste) — the non-relative sibling of Ctrl+V.
// It restores copied coordinates and merges carried ids into entities the
// document already has instead of minting a second copy of every node/edge.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

function createEditorDom(savedGraph) {
  const errors = [];
  const source = html.replace('<script>',
    `<script>localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(savedGraph))});</script><script>`);
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(source, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://offline.test/', virtualConsole,
    beforeParse(window) {
      window.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.alert = () => {}; window.confirm = () => true; window.prompt = () => null;
      window.URL.createObjectURL = () => 'blob:offline-test';
      window.URL.revokeObjectURL = () => {};
      Object.defineProperty(window.navigator, 'clipboard', { configurable:true, value:{ writeText:async()=>{}, readText:async()=>'' } });
    },
  });
  return { dom, errors };
}

const settle = (window, ms) => new Promise(resolve => window.setTimeout(resolve, ms));
function exportGraph(document) {
  document.querySelector('#btnExportJson').click();
  const modal = document.querySelector('.export-modal');
  const graph = JSON.parse(modal.querySelector('textarea').value);
  modal.remove();
  return graph;
}
function setClipboard(window, payload) {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText:async()=>{}, readText:async()=> JSON.stringify(payload) },
  });
}
function hotkey(window, key, modifiers) {
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles:true, cancelable:true, ...modifiers }));
}
function dispatchPointer(window, target, type, options = {}) {
  const event = new window.MouseEvent(type, {
    bubbles: true, cancelable: true, button: options.button ?? 0,
    clientX: options.clientX ?? 0, clientY: options.clientY ?? 0,
    shiftKey: Boolean(options.shiftKey),
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    pointerType: { value: 'mouse' },
  });
  target.dispatchEvent(event);
}
async function selectNode(window, id, x, y) {
  const document = window.document;
  const rect = () => ({ x:0, y:0, left:0, top:0, width:1000, height:660, right:1000, bottom:660, toJSON(){ return this; } });
  document.querySelector('#graphCanvas').getBoundingClientRect = rect;
  document.querySelector('#canvasWrap').getBoundingClientRect = rect;
  document.elementFromPoint = () => document.querySelector('#node-' + id);
  dispatchPointer(window, document.querySelector('#node-' + id), 'pointerdown', { pointerId:1, clientX:x, clientY:y });
  dispatchPointer(window, document.querySelector('#graphCanvas'), 'pointerup', { pointerId:1, clientX:x, clientY:y });
  await settle(window, 40);
}

const baseGraph = {
  title: 'exact-paste',
  settings: {},
  viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  nodes: [
    { id: 'a', label: 'A', x: -200, y: 0, order: 0, width: 80 },
    { id: 'b', label: 'B', x: 200, y: 0, order: 1 },
  ],
  edges: [{ id: 'e1', from: 'a', to: 'b', label: 'link', weight: 'keep' }],
};

test('exact hotkey pastes at copied coordinates, merges known ids and keeps unrelated fields', async () => {
  const payload = {
    type: 'graph-editor-clipboard',
    nodes: [
      { id: 'a', label: 'A*', x: -200, y: 0, order: 0 },
      { id: 'b', label: 'B*', x: 200, y: 0, order: 1 },
      { id: 'c', label: 'C', x: 400, y: 0, order: 2 },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', label: 'link*' },
      { id: 'e2', from: 'b', to: 'c', label: 'new' },
    ],
    externalEdges: [],
    customAttributes: [],
  };
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  setClipboard(window, payload);

  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  let graph = exportGraph(document);
  assert.deepEqual(graph.nodes.map(n => n.id), ['a', 'b', 'c'], 'known ids are reused; only the new node is added');
  assert.deepEqual(graph.edges.map(e => e.id), ['e1', 'e2'], 'known edge ids are reused too');
  const a = graph.nodes.find(n => n.id === 'a');
  assert.equal(a.label, 'A*', 'carried value changed');
  assert.equal(a.x, -200); assert.equal(a.y, 0);
  assert.equal(a.width, 80, 'a field the clipboard says nothing about is untouched');
  assert.equal(graph.nodes.find(n => n.id === 'b').label, 'B*');
  const c = graph.nodes.find(n => n.id === 'c');
  assert.equal(c.x, 400); assert.equal(c.y, 0, 'a new node lands at its copied position, no offset');
  assert.equal(graph.edges.find(e => e.id === 'e1').label, 'link*');
  assert.equal(graph.edges.find(e => e.id === 'e1').weight, 'keep', 'existing edge fields survive the merge');
  assert.deepEqual(graph.edges.find(e => e.id === 'e2').from, 'b');
  assert.deepEqual(graph.selection.nodes.slice().sort(), ['a', 'b', 'c'], 'the pasted entities are selected');

  // The second shortcut must be idempotent: no extra clones, no changed data.
  hotkey(window, 'v', { ctrlKey: true, shiftKey: true });
  await settle(window, 120);
  graph = exportGraph(document);
  assert.deepEqual(graph.nodes.map(n => n.id), ['a', 'b', 'c']);
  assert.deepEqual(graph.edges.map(e => e.id), ['e1', 'e2']);
  assert.equal(graph.nodes.find(n => n.id === 'a').width, 80);
  assert.match(document.querySelector('.toast-stack')?.textContent || '', /nothing changed|ничего|изменений/i,
    'a no-op exact paste says so');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('the toolbar button exact-pastes the copied selection without offset or duplication', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  assert.equal(document.querySelector('#btnPasteExact').disabled, true, 'no clipboard yet');

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  assert.equal(document.querySelector('#btnPasteExact').disabled, false, 'copy enables the exact-paste button');

  document.querySelector('#btnPasteExact').click();
  await settle(window, 80);
  const graph = exportGraph(document);
  assert.deepEqual(graph.nodes.map(n => n.id), ['a', 'b'], 'no duplicate of the copied node');
  const a = graph.nodes.find(n => n.id === 'a');
  assert.equal(a.x, -200); assert.equal(a.y, 0, 'the original coordinates are restored, not offset');
  assert.equal(a.label, 'A');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});
