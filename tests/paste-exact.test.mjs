// Paste-in-place (exact paste) — the non-relative sibling of Ctrl+V.
// It restores copied coordinates and merges carried ids into entities the
// document already has instead of minting a second copy of every node/edge.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createWebLocks } from './helpers/web-locks.mjs';
import { GraphPatchCore } from '../dist/core/graph-patch.js';

const html = await readFile('index.html', 'utf8');

function createEditorDom(savedGraph, url = 'https://offline.test/') {
  const errors = [];
  const source = html.replace('<script>',
    `<script>localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(savedGraph))});</script><script>`);
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(source, {
    runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole,
    beforeParse(window) {
      Object.defineProperty(window.navigator, 'locks', { configurable:true, value:createWebLocks() });
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
function setClipboardWrite(window, payload, writeText, readText = async () => JSON.stringify(payload)) {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText, readText },
  });
}
// A system clipboard shared by several tabs, plus the localStorage they share.
// Writes are held until the test releases them, so cross-tab ordering can be
// exercised deterministically.
function createClipboardHub(){
  const store = new Map();
  const storage = {
    get length() { return store.size; },
    key: index => [...store.keys()][index] ?? null,
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: key => { store.delete(key); },
    clear: () => store.clear(),
  };
  const locks = createWebLocks();
  const hub = {
    text: '',
    storage,
    attach(window, tag){
      Object.defineProperty(window.navigator, 'locks', { configurable:true, value:locks });
      const writes = [];
      const pending = [];
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          readText: async () => hub.text,
          writeText: (text) => {
            writes.push(JSON.parse(text).nodes.map(n => n.id).join(','));
            return new Promise(resolve => pending.push(() => { hub.text = text; resolve(); }));
          },
        },
      });
      return {
        tag, writes,
        release(){ while(pending.length) pending.shift()(); },
      };
    },
  };
  return hub;
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
  // The toolbar button is always clickable: a fresh tab can paste straight
  // from the system clipboard without a local copy to enable it.
  assert.equal(document.querySelector('#btnPasteExact').disabled, false, 'no local clipboard needed');

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

test('an unrelated custom value survives an exact paste that carries only one key', async () => {
  const graph = {
    ...baseGraph,
    customAttributes: [
      { id: 'p1', scope: 'node', type: 'string' },
      { id: 'p2', scope: 'node', type: 'string' },
    ],
    nodes: [
      { ...baseGraph.nodes[0], custom: { p1: 'old', p2: 'keep' } },
      baseGraph.nodes[1],
    ],
  };
  const payload = {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'A*', x: -200, y: 0, order: 0, custom: { p1: 'new' } }],
    edges: [], externalEdges: [],
    customAttributes: [{ id: 'p1', scope: 'node', type: 'string' }],
  };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  setClipboard(window, payload);
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  const node = exportGraph(document).nodes.find(n => n.id === 'a');
  assert.deepEqual(node.custom, { p1: 'new', p2: 'keep' }, 'p2 was never carried, so it stays');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a newer system clipboard beats a stale in-memory copy', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);

  // Create an in-memory copy of the local node first.
  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 30); // wait for the lock-held publication to settle
  // Another tab then copies a different version of the same node.
  setClipboard(window, {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'From other tab', x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
  });
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  const node = exportGraph(document).nodes.find(n => n.id === 'a');
  assert.equal(node.label, 'From other tab', 'the system payload wins over the stale local one');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('the toolbar button pastes from the system clipboard with no local copy', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  setClipboard(window, {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Fresh tab', x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
  });

  assert.equal(document.querySelector('#btnPasteExact').disabled, false);
  document.querySelector('#btnPasteExact').click();
  await settle(window, 120);

  const node = exportGraph(document).nodes.find(n => n.id === 'a');
  assert.equal(node.label, 'Fresh tab');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a partial payload with no coordinates does not reset an existing position', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  setClipboard(window, {
    type: 'graph-editor-clipboard',
    nodes: [
      { id: 'a', label: 'No coordinates', order: 0 },
      { id: 'c', label: 'New without coordinates' },
    ],
    edges: [], externalEdges: [], customAttributes: [],
  });
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  const graph = exportGraph(document);
  const a = graph.nodes.find(n => n.id === 'a');
  assert.equal(a.label, 'No coordinates');
  assert.equal(a.x, -200); assert.equal(a.y, 0, 'omitted axes leave the stored position alone');
  const c = graph.nodes.find(n => n.id === 'c');
  assert.ok(c, 'the new node is still created');
  assert.equal(c.x, 0); assert.equal(c.y, 0, 'new nodes still get finite coordinates');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('exact paste refuses to grow a document past the loader node cap', async () => {
  const nodes = [];
  for(let i = 0; i < 3000; i++) nodes.push({ id: 'n' + i, label: 'N', x: i % 100, y: 0, order: i });
  const { dom, errors } = createEditorDom({ ...baseGraph, nodes, edges: [] });
  const { window } = dom; const { document } = window;
  await settle(window, 500);
  setClipboard(window, {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'extra', label: 'Extra', x: 10, y: 10, order: 3000, custom: { p1: 'orphan' } }],
    edges: [], externalEdges: [],
    customAttributes: [{ id: 'p1', scope: 'node', type: 'string' }],
  });
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 300);

  const graph = exportGraph(document);
  assert.equal(graph.nodes.length, 3000, 'no entity is added beyond the sanitizer cap');
  assert.equal(graph.nodes.some(n => n.id === 'extra'), false);
  assert.deepEqual(graph.customAttributes, [], 'the dropped node leaves no custom definition behind');
  assert.equal(document.querySelector('#btnUndo').disabled, true, 'no history step for a no-op paste');
  assert.match(document.querySelector('.toast-stack').textContent, /3000/, 'the drop is reported');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a rejected system-clipboard write does not let stale system data win', async () => {
  const stale = {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Stale', x: -100, y: 50, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
  };
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  setClipboardWrite(window, stale, async () => { throw new Error('write denied'); });

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 40);
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  const a = exportGraph(document).nodes.find(n => n.id === 'a');
  assert.equal(a.label, 'A', 'the successful local copy wins over the older system payload');
  assert.equal(a.x, -200); assert.equal(a.y, 0);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a pending system-clipboard write counts as not published', async () => {
  const stale = {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Stale', x: -100, y: 50, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
  };
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  setClipboardWrite(window, stale, () => new Promise(() => {}));

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  const a = exportGraph(document).nodes.find(n => n.id === 'a');
  assert.equal(a.label, 'A', 'pending publication still leaves the local copy authoritative');
  assert.equal(a.x, -200); assert.equal(a.y, 0);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('exact paste validates supplied fields and ignores entities without an id', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  setClipboard(window, {
    type: 'graph-editor-clipboard',
    nodes: [
      { id: 'a', label: { bad: true }, width: -9999, x: 'nope', y: 'bad', bogus: 'evil', order: 0 },
      { label: 'No id here' },
    ],
    edges: [], externalEdges: [], customAttributes: [],
  });
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  const graph = exportGraph(document);
  assert.equal(graph.nodes.length, 2, 'the id-less payload entity is ignored, not thrown on');
  const a = graph.nodes.find(n => n.id === 'a');
  assert.equal(a.label, 'A', 'an object label is treated as omitted, not written');
  assert.equal(a.width, 10, 'an out-of-range width is clamped to the loader range');
  assert.equal(a.x, -200); assert.equal(a.y, 0, 'non-numeric coordinates are treated as omitted');
  assert.equal(a.bogus, undefined, 'unknown fields never reach the live entity');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('offset paste drops edges whose copied nodes were rejected at the cap', async () => {
  const nodes = [];
  for(let i = 0; i < 2998; i++) nodes.push({ id: 'n' + i, label: 'N', x: i % 100, y: 0, order: i });
  nodes.push({ id: 'a', label: 'A', x: 0, y: 0, order: 2998 });
  nodes.push({ id: 'b', label: 'B', x: 20, y: 0, order: 2999 });
  const graph = { ...baseGraph, nodes, edges: [{ id: 'e1', from: 'a', to: 'b', label: 'original' }] };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await settle(window, 500);
  setClipboard(window, {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'A', x: 0, y: 0, order: 2998 }, { id: 'b', label: 'B', x: 20, y: 0, order: 2999 }],
    edges: [{ id: 'e1', from: 'a', to: 'b', label: 'copied' }],
    externalEdges: [], customAttributes: [],
  });

  hotkey(window, 'v', { ctrlKey: true });
  await settle(window, 300);
  const exportedGraph = exportGraph(document);
  assert.equal(exportedGraph.nodes.length, 3000);
  assert.deepEqual(exportedGraph.edges.map(e => e.id), ['e1'], 'no duplicate edge between the originals');
  assert.equal(exportedGraph.edges[0].label, 'original');
  assert.match(document.querySelector('.toast-stack').textContent, /3000/);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a failed local write still allows a genuinely newer cross-tab copy', async () => {
  const oldPayload = {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Old', x: -100, y: 50, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
  };
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  let systemText = JSON.stringify(oldPayload);
  setClipboardWrite(window, oldPayload, async () => { throw new Error('denied'); }, async () => systemText);

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 40);
  systemText = JSON.stringify({
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Newer from other tab', x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
  });
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  const a = exportGraph(document).nodes.find(n => n.id === 'a');
  assert.equal(a.label, 'Newer from other tab', 'a changed system payload outranks the failed local copy');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('exact paste can restore the editor’s empty shape and color as unset', async () => {
  const graph = { ...baseGraph,
    nodes: [{ ...baseGraph.nodes[0], shape: 'square', color: '#ff0000' }, baseGraph.nodes[1]],
  };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  setClipboard(window, {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'A', x: -200, y: 0, order: 0, shape: '', color: '' }],
    edges: [], externalEdges: [], customAttributes: [],
  });
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  const a = exportGraph(document).nodes.find(n => n.id === 'a');
  assert.equal(a.shape, '', 'an explicit empty shape is a carried value, not an invalid one');
  assert.equal(a.color, '', 'an explicit empty colour is a carried value, not an invalid one');
  assert.doesNotMatch(document.querySelector('.toast-stack').textContent, /nothing changed/i);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('writes are serialized so a fresh tab sees the newest copy', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  let systemText = '';
  const writes = [];
  const pendingWrites = [];
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      readText: async () => systemText,
      writeText: (text) => {
        writes.push(text);
        return new Promise(resolve => { pendingWrites.push(() => { systemText = text; resolve(); }); });
      },
    },
  });

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 15);
  await selectNode(window, 'b', 700, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 15);
  assert.equal(writes.length, 1, 'the second copy waits for the first write');

  pendingWrites[0]();               // A publishes
  await settle(window, 60);
  assert.equal(writes.length, 2, 'the queued B copy is published after A');
  pendingWrites[1]();
  await settle(window, 20);
  assert.equal(systemText, writes[1], 'the newest copy is the published clipboard value');

  // A fresh destination tab has no local history to arbitrate with.
  const fresh = createEditorDom(baseGraph);
  await settle(fresh.dom.window, 80);
  setClipboard(fresh.dom.window, JSON.parse(writes[1]));
  hotkey(fresh.dom.window, 'v', { ctrlKey: true, altKey: true });
  await settle(fresh.dom.window, 120);
  assert.equal(exportGraph(fresh.dom.window.document).nodes.find(n => n.id === 'b').label, 'B');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close(); fresh.dom.window.close();
});

test('an unavailable snapshot keeps an old unstamped legacy payload out', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  let reads = 0;
  let systemText = '';
  let localStamp = null;
  setClipboardWrite(window, {}, async (text) => {
    localStamp = JSON.parse(text).clipboardStamp;
    throw new Error('denied');
  }, async () => {
    reads++;
    if(reads === 1) throw new Error('snapshot denied');
    return systemText;
  });

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 40);
  systemText = JSON.stringify({
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Legacy payload', x: -100, y: 50, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
  });
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  const a = exportGraph(document).nodes.find(n => n.id === 'a');
  assert.equal(a.label, 'A', 'unknown ordering is not evidence that the legacy payload is newer');
  assert.equal(a.x, -200); assert.equal(a.y, 0);
  // A stamped newer payload is still allowed to win.
  systemText = JSON.stringify({
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Newer stamped', x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
    clipboardStamp: { t: localStamp.t + 1, s: 99, tab: 'other-tab' },
  });
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);
  assert.equal(exportGraph(document).nodes.find(n => n.id === 'a').label, 'Newer stamped');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a second paste does not fall back to an older local copy while reading', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  let reads = 0;
  setClipboardWrite(window, {}, async () => {}, () => { reads++; return new Promise(() => {}); });

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  reads = 0;                              // ignore the pre-copy snapshot read
  hotkey(window, 'v', { ctrlKey: true });  // starts the pending read
  await settle(window, 60);
  hotkey(window, 'v', { ctrlKey: true });  // supersedes it with a new read
  await settle(window, 60);

  const graph = exportGraph(document);
  assert.equal(reads, 2, 'both commands read the current system clipboard');
  assert.equal(graph.nodes.length, 2, 'no stale local copy is pasted');
  assert.doesNotMatch(document.querySelector('.toast-stack').textContent, /local copy|локальная копия/i);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('offset paste allocates distinct ids for colliding normalized nodes', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  setClipboard(window, {
    type: 'graph-editor-clipboard',
    nodes: [
      { id: 'one!', label: 'First', x: 100, y: 0, order: 0, custom: { p1: 'kept' } },
      { id: 'one', label: 'Second', x: 200, y: 0, order: 1, custom: { p1: 'dropped' } },
    ],
    edges: [], externalEdges: [],
    customAttributes: [{ id: 'p1', scope: 'node', type: 'string' }],
  });
  hotkey(window, 'v', { ctrlKey: true });
  await settle(window, 120);

  const graph = exportGraph(document);
  assert.equal(graph.nodes.length, 4, 'both raw identities survive normalization');
  const one = graph.nodes.find(n => n.id === 'one');
  const second = graph.nodes.find(n => n.id === 'one-2');
  assert.equal(one.label, 'First');
  assert.deepEqual(one.custom, { p1: 'kept' });
  assert.equal(second.label, 'Second');
  assert.deepEqual(second.custom, { p1: 'dropped' });
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a slow system read is allowed to finish instead of using stale local data', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  let copied = false;
  const newer = {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Slower but newer', x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
  };
  setClipboardWrite(window, {}, async () => {}, async () => {
    if(!copied) return '';
    await new Promise(resolve => window.setTimeout(resolve, 160));
    return JSON.stringify(newer);
  });

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  copied = true;
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 260);

  assert.equal(exportGraph(document).nodes.find(n => n.id === 'a').label, 'Slower but newer');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a newer stamped system payload wins even while the local write is pending', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  let localStamp = null;
  let systemText = '';
  setClipboardWrite(window, {}, (text) => {
    localStamp = JSON.parse(text).clipboardStamp;
    return new Promise(() => {});
  }, async () => systemText);

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 20);   // the publication turn is claimed asynchronously
  systemText = JSON.stringify({
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Other tab while pending', x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
    clipboardStamp: { t: localStamp.t + 1, s: 1, tab: 'other' },
  });
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  assert.equal(exportGraph(document).nodes.find(n => n.id === 'a').label, 'Other tab while pending');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('equal timestamps do not order payloads by per-tab counters', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  window.Date.now = () => 12345;
  let localStamp = null;
  let systemText = '';
  setClipboardWrite(window, {}, async (text) => {
    localStamp = JSON.parse(text).clipboardStamp;
    systemText = text;
  }, async () => systemText);

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await selectNode(window, 'b', 700, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 20);
  assert.equal(localStamp.s, 2, 'the local copy is the second one');
  systemText = JSON.stringify({
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Later in another tab', x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
    clipboardStamp: { t: localStamp.t, s: 1, tab: 'aaa' },
  });
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  assert.equal(exportGraph(document).nodes.find(n => n.id === 'a').label, 'Later in another tab',
    'an ambiguous tie must not be decided by incomparable counters');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a fresh tab trusts its current clipboard even when the stamp is older', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  // A clipboard-history restore has an old stamp but is the user's current
  // clipboard content; persistent history must not declare it empty.
  window.localStorage.setItem('graph-editor-pro-clipboard-stamp', JSON.stringify({ t: 2000, s: 1, tab: 'newer' }));
  setClipboard(window, {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Restored from history', x: -100, y: 50, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
    clipboardStamp: { t: 1000, s: 9, tab: 'older' },
  });
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  const a = exportGraph(document).nodes.find(n => n.id === 'a');
  assert.equal(a.label, 'Restored from history');
  assert.equal(a.x, -100); assert.equal(a.y, 50);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a queued copy never overwrites unrelated clipboard content', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  let systemText = '';
  const writes = [];
  const pendingWrites = [];
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      readText: async () => systemText,
      writeText: (text) => {
        writes.push(text);
        return new Promise(resolve => { pendingWrites.push(() => { systemText = text; resolve(); }); });
      },
    },
  });

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 15);
  await selectNode(window, 'b', 700, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 15);
  pendingWrites[0]();               // A publishes; B is now ready to publish
  systemText = 'plain text copied by another app';
  await settle(window, 80);

  assert.equal(writes.length, 1, 'B is never written over the newer plain text');
  assert.equal(systemText, 'plain text copied by another app');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a queued copy stays local when the clipboard cannot be verified', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  const writes = [];
  const pendingWrites = [];
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      readText: async () => { throw new Error('no read permission'); },
      writeText: (text) => {
        writes.push(text);
        return new Promise(resolve => { pendingWrites.push(resolve); });
      },
    },
  });

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 15);
  await selectNode(window, 'b', 700, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 15);
  assert.equal(writes.length, 1);
  pendingWrites[0]();               // A publishes, B becomes eligible
  await settle(window, 80);

  assert.equal(writes.length, 1, 'unreadable clipboard must not be overwritten by a delayed copy');
  assert.match(document.body.textContent, /safely published/);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a cancelled pending paste cannot apply its delayed system payload', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  const resolvers = [];
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async () => {},
      readText: () => new Promise(resolve => { resolvers.push(resolve); }),
    },
  });

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  hotkey(window, 'v', { ctrlKey: true, altKey: true });  // first paste starts a hanging read
  await settle(window, 20);
  hotkey(window, 'v', { ctrlKey: true, altKey: true });  // superseded by a second read
  await settle(window, 20);

  resolvers[2](JSON.stringify({
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Current system payload', x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
  }));
  await settle(window, 120);
  assert.equal(exportGraph(document).nodes.find(n => n.id === 'a').label, 'Current system payload');

  resolvers[1](JSON.stringify({
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Delayed system payload', x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
  }));
  await settle(window, 120);
  const graph = exportGraph(document);
  assert.equal(graph.nodes.length, 2, 'the cancelled read pastes nothing more');
  assert.equal(graph.nodes.find(n => n.id === 'a').label, 'Current system payload');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a failed copy leaves the published clipboard stamp and valid payload usable', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  window.Date.now = () => 1000;
  let publishedText = '';
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text) => { publishedText = text; }, readText: async () => '' },
  });

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 30);
  const stamp = JSON.parse(window.localStorage.getItem('graph-editor-pro-clipboard-stamp'));
  assert.equal(stamp.t, 1000, 'a successful copy publishes its stamp');
  const valid = JSON.parse(publishedText);

  window.Date.now = () => 2000;
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => { throw new Error('write denied'); }, readText: async () => '' },
  });
  await selectNode(window, 'b', 700, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 30);
  assert.deepEqual(JSON.parse(window.localStorage.getItem('graph-editor-pro-clipboard-stamp')), stamp,
    'a failed copy must not advance the shared stamp');

  // A fresh tab has no local copy and must still trust the earlier payload.
  const fresh = createEditorDom(baseGraph);
  await settle(fresh.dom.window, 80);
  fresh.dom.window.localStorage.setItem('graph-editor-pro-clipboard-stamp', JSON.stringify(stamp));
  valid.nodes[0].label = 'Valid published payload';
  setClipboard(fresh.dom.window, valid);
  hotkey(fresh.dom.window, 'v', { ctrlKey: true, altKey: true });
  await settle(fresh.dom.window, 120);
  assert.equal(exportGraph(fresh.dom.window.document).nodes.find(n => n.id === 'a').label, 'Valid published payload');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close(); fresh.dom.window.close();
});

test('a huge numeric id cannot freeze a later offset paste', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  const payload = {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'n9007199254740992', label: 'Huge', x: 100, y: 100, order: 2 }],
    edges: [], externalEdges: [], customAttributes: [],
  };
  setClipboard(window, payload);
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);
  let graph = exportGraph(document);
  assert.ok(graph.nodes.some(n => n.id === 'n9007199254740992'));

  // The same id now collides: the old allocator could not increment it and
  // looped forever. A fresh tab with only the system payload reproduces it.
  setClipboard(window, payload);
  hotkey(window, 'v', { ctrlKey: true });
  await settle(window, 200);
  graph = exportGraph(document);
  assert.equal(graph.nodes.length, 4, 'the offset paste completed with a new node');
  const replacement = graph.nodes.find(n => n.label === 'Huge' && n.id !== 'n9007199254740992');
  assert.ok(replacement && /^n\d+$/.test(replacement.id),
    'the replacement id is allocated safely: ' + graph.nodes.map(n => n.id).join(','));
  assert.ok(Number.isSafeInteger(Number(replacement.id.slice(1))));
  assert.ok(Number.isSafeInteger(graph.nextNode) && graph.nextNode >= 1,
    'the counter remains finite and safe');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('Cmd+Option+V works when Option changes the key character', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  setClipboard(window, {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Mac exact paste', x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
  });

  document.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: '√', code: 'KeyV', metaKey: true, altKey: true, bubbles: true, cancelable: true,
  }));
  await settle(window, 120);

  const graph = exportGraph(document);
  assert.equal(graph.nodes.length, 2, 'the physical V key is recognized');
  const a = graph.nodes.find(n => n.id === 'a');
  assert.equal(a.label, 'Mac exact paste');
  assert.equal(a.x, -200); assert.equal(a.y, 0);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a second paste cannot overwrite a later edit with the older local copy', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 30);
  const copiedStamp = JSON.parse(window.localStorage.getItem('graph-editor-pro-clipboard-stamp'));

  // A user edit made after the copy, pasted from the system clipboard.
  setClipboard(window, {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Edited after copy', x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
  });
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);
  assert.equal(exportGraph(document).nodes.find(n => n.id === 'a').label, 'Edited after copy');

  let reads = 0;
  const newer = {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Newer current clipboard', x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
    clipboardStamp: { t: copiedStamp.t + 1000, s: 9, tab: 'another-tab' },
  };
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async () => {},
      readText: async () => {
        reads++;
        await new Promise(resolve => window.setTimeout(resolve, 150));
        return JSON.stringify(newer);
      },
    },
  });

  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 30);
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 400);

  const graph = exportGraph(document);
  assert.equal(reads, 2, 'both commands read the current clipboard');
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.nodes.find(n => n.id === 'a').label, 'Newer current clipboard');
  assert.doesNotMatch(document.querySelector('.toast-stack').textContent, /local copy|локальная копия/i);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a second paste cancels the first while it awaits a failed-copy snapshot', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  let reads = 0;
  let writtenStamp = null;
  const snapshot = new Promise(resolve => window.setTimeout(() => resolve(''), 240));
  const payloadFor = (label) => JSON.stringify({
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label, x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
    clipboardStamp: { t: (writtenStamp?.t ?? 1000) + 100, s: 9, tab: 'another-tab' },
  });
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        writtenStamp = JSON.parse(text).clipboardStamp;
        throw new Error('write denied');
      },
      readText: async () => {
        reads++;
        if(reads === 1) return snapshot;
        return payloadFor(reads === 2 ? 'First stale' : 'Second current');
      },
    },
  });

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 30);
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 30);   // inside the bounded snapshot wait
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 300);

  assert.equal(reads, 3, 'the pre-copy snapshot and both paste reads happened');
  assert.equal(exportGraph(document).nodes.find(n => n.id === 'a').label, 'Second current');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('same-tab sequence numbers break equal-timestamp ties', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  window.Date.now = () => 12345;
  let localStamp = null;
  let writeCalls = 0;
  setClipboardWrite(window, {}, (text) => {
    localStamp = JSON.parse(text).clipboardStamp;
    writeCalls++;
    // The first copy settles; the second stays outstanding so its stamp can
    // correctly reject an older same-tab payload.
    return writeCalls === 1 ? Promise.resolve() : new Promise(() => {});
  }, async () => '');

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 30);
  await selectNode(window, 'b', 700, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 30);
  assert.equal(localStamp.s, 2, 'both copies share the mocked timestamp');

  const payloadWithStamp = (seq, label) => ({
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'b', label, x: 200, y: 0, order: 1 }],
    edges: [], externalEdges: [], customAttributes: [],
    clipboardStamp: { t: 12345, s: seq, tab: localStamp.tab },
  });
  setClipboard(window, payloadWithStamp(1, 'Older same-tab copy'));
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);
  assert.equal(exportGraph(document).nodes.find(n => n.id === 'b').label, 'B',
    'the pending newer copy wins over an older sequence from the same tab');

  setClipboard(window, payloadWithStamp(3, 'Newer same-tab copy'));
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);
  assert.equal(exportGraph(document).nodes.find(n => n.id === 'b').label, 'Newer same-tab copy');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('editable matrix fields keep native clipboard shortcuts', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  setClipboard(window, {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Hijacked', x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
  });
  const input = document.createElement('input');
  input.className = 'matrix-label-input';
  document.body.appendChild(input);

  let event = new window.KeyboardEvent('keydown', {
    key: 'v', code: 'KeyV', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
  });
  input.dispatchEvent(event);
  await settle(window, 120);
  assert.equal(event.defaultPrevented, false, 'an editable matrix field keeps its native paste');
  assert.equal(exportGraph(document).nodes.find(n => n.id === 'a').label, 'A');

  input.readOnly = true;
  event = new window.KeyboardEvent('keydown', {
    key: 'v', code: 'KeyV', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
  });
  input.dispatchEvent(event);
  await settle(window, 120);
  assert.equal(event.defaultPrevented, true, 'a read-only matrix field represents graph selection');
  assert.equal(exportGraph(document).nodes.find(n => n.id === 'a').label, 'Hijacked');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a physical KeyV producing another character does not paste', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  setClipboard(window, {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Wrong layout paste', x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
  });
  const event = new window.KeyboardEvent('keydown', {
    key: 'k', code: 'KeyV', ctrlKey: true, bubbles: true, cancelable: true,
  });
  document.dispatchEvent(event);
  await settle(window, 120);

  assert.equal(event.defaultPrevented, false);
  assert.equal(exportGraph(document).nodes.find(n => n.id === 'a').label, 'A');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a restored older clipboard item is pasted in the source tab', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  let systemText = '';
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text) => { systemText = text; }, readText: async () => systemText },
  });

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 40);
  const firstCopy = JSON.parse(systemText);
  await selectNode(window, 'b', 700, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 40);

  const restored = JSON.parse(JSON.stringify(firstCopy));
  restored.nodes[0].label = 'Restored A';
  systemText = JSON.stringify(restored);
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  const graph = exportGraph(document);
  assert.equal(graph.nodes.find(n => n.id === 'a').label, 'Restored A',
    'the restored item is the current clipboard, not an obsolete outstanding write');
  assert.equal(graph.nodes.find(n => n.id === 'b').label, 'B');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

// --- Publication ordering: audit findings 1-3 -------------------------------

test('a waiting copy is never published after a newer copy', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  let systemText = '';
  const writes = [];
  const pending = [];
  const gates = [];
  let reads = 0;
  const finish = () => { while(pending.length) pending.shift()(); };
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      // Copy snapshots resolve; the publication check for B hangs until
      // released, which is the window in which C gets copied.
      readText: () => {
        reads++;
        if(reads <= 2) return Promise.resolve('');
        if(reads === 3) return new Promise(resolve => gates.push(() => resolve(systemText)));
        return Promise.resolve(systemText);
      },
      writeText: (text) => {
        const payload = JSON.parse(text);
        writes.push(payload.clipboardStamp.s);
        return new Promise(resolve => pending.push(() => { systemText = text; resolve(); }));
      },
    },
  });

  await selectNode(window, 'a', 300, 330); document.querySelector('#btnCopy').click();
  await settle(window, 20);
  await selectNode(window, 'b', 700, 330); document.querySelector('#btnCopy').click();
  await settle(window, 20);
  pending[0]();                              // copy 1 lands; copy 2 verifies and hangs
  await settle(window, 40);
  await selectNode(window, 'a', 300, 330); document.querySelector('#btnCopy').click();
  await settle(window, 20);                  // C is copied during B's verification

  assert.deepEqual(writes, [1], 'nothing is written while the publication slot is owned');

  gates.forEach(release => release());
  await settle(window, 400);                 // let the newest copy's bounded read expire
  for(let i = 0; i < 4 && pending.length; i++){ finish(); await settle(window, 60); }

  assert.deepEqual(writes, [1, 3], 'the superseded copy 2 is dropped; copy 3 is published');
  assert.equal(JSON.parse(systemText).clipboardStamp.s, 3);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a stalled verification read fails closed and does not strand the pump', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  let systemText = '';
  const writes = [];
  const pending = [];
  const finish = () => { while(pending.length) pending.shift()(); };
  let reads = 0;
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      readText: () => {
        reads++;
        if(reads <= 2) return Promise.resolve('');
        return new Promise(() => {});     // never settles
      },
      writeText: (text) => {
        writes.push(JSON.parse(text).nodes.map(n => n.id).join(','));
        return new Promise(resolve => pending.push(() => { systemText = text; resolve(); }));
      },
    },
  });

  await selectNode(window, 'a', 300, 330); document.querySelector('#btnCopy').click();
  await settle(window, 20);
  await selectNode(window, 'b', 700, 330); document.querySelector('#btnCopy').click();
  await settle(window, 20);
  pending[0]();                              // A lands; B's verification read hangs forever
  await settle(window, 700);                 // beyond the bounded publication read

  for(let i = 0; i < 4 && pending.length; i++){ finish(); await settle(window, 60); }

  assert.deepEqual(writes, ['a'], 'unknown clipboard contents must not be overwritten');
  assert.equal(JSON.parse(systemText).nodes[0].id, 'a');
  assert.match(document.body.textContent, /safely published/);
  // An explicit new copy is not blocked by the failed verification.
  document.querySelector('#btnCopy').click();
  await settle(window, 80);
  assert.deepEqual(writes, ['a', 'b']);
  finish(); await settle(window, 80);
  assert.equal(JSON.parse(systemText).nodes[0].id, 'b');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('one tab publishes at a time so the newest copy is the one left behind', async () => {
  const hub = createClipboardHub();
  const tabA = createEditorDom(baseGraph);
  const tabB = createEditorDom(baseGraph);
  await settle(tabA.dom.window, 80); await settle(tabB.dom.window, 80);
  // Two tabs sharing one system clipboard and one localStorage.
  const clipA = hub.attach(tabA.dom.window, 'A');
  const clipB = hub.attach(tabB.dom.window, 'B');
  Object.defineProperty(tabA.dom.window, 'localStorage', { configurable: true, value: hub.storage });
  Object.defineProperty(tabB.dom.window, 'localStorage', { configurable: true, value: hub.storage });

  await selectNode(tabA.dom.window, 'a', 300, 330);
  await selectNode(tabB.dom.window, 'b', 700, 330);
  tabA.dom.window.document.querySelector('#btnCopy').click();
  await settle(tabA.dom.window, 20);
  // A is publishing. B copies afterwards, so B is the newer intent.
  tabB.dom.window.document.querySelector('#btnCopy').click();
  await settle(tabB.dom.window, 1100); // exceeds both old 700ms lease and 600ms wait
  assert.deepEqual(clipB.writes, [], 'B does not publish while A owns the clipboard');

  clipA.release();                       // A's delayed write lands first
  await settle(tabB.dom.window, 300);
  clipB.release();                       // then B publishes its newer copy
  await settle(tabB.dom.window, 200);

  assert.deepEqual(clipA.writes, ['a']);
  assert.deepEqual(clipB.writes, ['b'], 'the newer copy follows the older one');
  assert.equal(JSON.parse(hub.text).nodes[0].id, 'b', 'A never lands after B');

  // A fresh tab (no local copies) must paste the newest payload.
  const fresh = createEditorDom(baseGraph);
  await settle(fresh.dom.window, 80);
  Object.defineProperty(fresh.dom.window, 'localStorage', { configurable: true, value: hub.storage });
  setClipboard(fresh.dom.window, JSON.parse(hub.text));
  await selectNode(fresh.dom.window, 'a', 300, 330);
  hotkey(fresh.dom.window, 'v', { ctrlKey: true, altKey: true });
  await settle(fresh.dom.window, 150);
  const pasted = exportGraph(fresh.dom.window.document);
  assert.equal(pasted.nodes.find(n => n.id === 'b').label, 'B');
  assert.deepEqual(tabA.errors.map(e => e.message), []);
  assert.deepEqual(tabB.errors.map(e => e.message), []);
  assert.deepEqual(fresh.errors.map(e => e.message), []);
  tabA.dom.window.close(); tabB.dom.window.close(); fresh.dom.window.close();
});

test('a queued copy publishes over unchanged content after its predecessor fails', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  let text = 'external text'; let rejectFirst;
  const writes = [];
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: {
    readText: async () => text,
    writeText: payload => {
      writes.push(JSON.parse(payload).nodes[0].id);
      if(writes.length === 1) return new Promise((_, reject) => { rejectFirst = reject; });
      text = payload; return Promise.resolve();
    },
  }});
  await selectNode(window, 'a', 300, 330); document.querySelector('#btnCopy').click();
  await settle(window, 30);
  await selectNode(window, 'b', 700, 330); document.querySelector('#btnCopy').click();
  rejectFirst(new Error('denied'));
  await settle(window, 300);
  assert.deepEqual(writes, ['a', 'b']);
  assert.equal(JSON.parse(text).nodes[0].id, 'b');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a superseded copy releases the turn it acquired while waiting', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  const locks = window.navigator.locks;
  let release;
  const held = locks.request('graph-editor-pro-clipboard-publish', () => new Promise(resolve => { release = resolve; }));
  await settle(window, 20);
  const writes = [];
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: {
    readText: async () => '',
    writeText: async payload => { writes.push(JSON.parse(payload).nodes[0].id); },
  }});
  await selectNode(window, 'a', 300, 330); document.querySelector('#btnCopy').click();
  await selectNode(window, 'b', 700, 330); document.querySelector('#btnCopy').click();
  release(); await held;
  await settle(window, 300);
  assert.deepEqual(writes, ['b']);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a waiting lock verifies the clipboard after acquiring it', async () => {
  const { dom } = createEditorDom(baseGraph), { window } = dom;
  await settle(window, 80);
  let release, text = 'before'; const writes = [];
  const held = window.navigator.locks.request('graph-editor-pro-clipboard-publish', () => new Promise(resolve => { release = resolve; }));
  await settle(window, 20);
  Object.defineProperty(window.navigator, 'clipboard', { configurable:true, value:{
    readText: async () => text,
    writeText: async payload => { writes.push(payload); text = payload; },
  }});
  await selectNode(window, 'a', 300, 330);
  window.document.querySelector('#btnCopy').click(); await settle(window, 80);
  text = 'new external text';
  release(); await held; await settle(window, 300);
  assert.equal(text, 'new external text'); assert.equal(writes.length, 0);
  assert.match(window.document.body.textContent, /safely published/);
  dom.window.close();
});

test('an abandoned write marker and missing Web Locks fail closed', async () => {
  for(const mode of ['abandoned', 'no-locks', 'no-storage', 'registry-denied']) {
    const { dom } = createEditorDom(baseGraph), { window } = dom;
    await settle(window, 80);
    let writes = 0;
    Object.defineProperty(window.navigator, 'clipboard', { configurable:true, value:{
      readText: async () => '', writeText: async () => { writes++; },
    }});
    if(mode === 'abandoned') window.localStorage.setItem('graph-editor-pro-clipboard-inflight', '{"tab":"lost"}');
    if(mode === 'no-locks') Object.defineProperty(window.navigator, 'locks', { configurable:true, value:undefined });
    if(mode === 'no-storage') Object.defineProperty(window, 'localStorage', { configurable:true, value:{
      getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); },
    }});
    if(mode === 'registry-denied') {
      const storage = window.localStorage;
      Object.defineProperty(window, 'localStorage', { configurable:true, value:{
        get length() { return storage.length; }, key: index => storage.key(index),
        getItem: key => storage.getItem(key),
        setItem: (key, value) => { if(key === 'graph-editor-pro-clipboard-publish') throw new Error('denied'); storage.setItem(key, value); },
        removeItem: key => storage.removeItem(key),
      }});
    }
    await selectNode(window, 'a', 300, 330);
    window.document.querySelector('#btnCopy').click(); await settle(window, 150);
    assert.equal(writes, 0, mode);
    assert.match(window.document.body.textContent, /safely published/);
    dom.window.close();
  }
});

test('two tabs queued before publication publish in user-copy order', async () => {
  const hub = createClipboardHub();
  const a = createEditorDom(baseGraph), b = createEditorDom(baseGraph);
  const aw = a.dom.window, bw = b.dom.window;
  await settle(aw, 80); await settle(bw, 80);
  const ca = hub.attach(aw, 'A'), cb = hub.attach(bw, 'B');
  Object.defineProperty(aw, 'localStorage', { configurable:true, value:hub.storage });
  Object.defineProperty(bw, 'localStorage', { configurable:true, value:hub.storage });
  let releaseLock;
  const held = aw.navigator.locks.request('graph-editor-pro-clipboard-publish', () => new Promise(resolve => { releaseLock = resolve; }));
  await settle(aw, 20);
  await selectNode(aw, 'a', 300, 330); await selectNode(bw, 'b', 700, 330);
  aw.document.querySelector('#btnCopy').click(); await settle(aw, 50);
  bw.document.querySelector('#btnCopy').click(); await settle(bw, 50);
  assert.deepEqual(ca.writes, []); assert.deepEqual(cb.writes, []);
  releaseLock(); await held; await settle(aw, 120);
  assert.deepEqual(ca.writes, ['a']); assert.deepEqual(cb.writes, []);
  ca.release(); await settle(bw, 200);
  assert.deepEqual(cb.writes, ['b']);
  cb.release(); await settle(bw, 100);
  assert.equal(JSON.parse(hub.text).nodes[0].id, 'b');
  a.dom.window.close(); b.dom.window.close();
});

test('clipboard recovery requires confirmation and refuses a live owner', async () => {
  const { dom } = createEditorDom(baseGraph), { window } = dom;
  await settle(window, 80);
  const key = 'graph-editor-pro-clipboard-inflight';
  window.localStorage.setItem(key, '{"old":true}');
  const button = window.document.querySelector('#btnClipboardRecovery');
  button.click(); await settle(window, 20);
  assert.match(window.document.querySelector('.app-dialog-message').textContent, /closing ALL.*restarting the browser/);
  window.document.querySelector('[data-dialog-cancel]').click(); await settle(window, 20);
  assert.notEqual(window.localStorage.getItem(key), null, 'cancel does not clear the marker');

  let release;
  const held = window.navigator.locks.request('graph-editor-pro-clipboard-publish', () => new Promise(resolve => { release = resolve; }));
  await settle(window, 20);
  button.click(); await settle(window, 20);
  window.document.querySelector('.app-dialog form').dispatchEvent(new window.Event('submit', { bubbles:true, cancelable:true }));
  await settle(window, 60);
  assert.notEqual(window.localStorage.getItem(key), null, 'active owner prevents recovery');
  assert.match(window.document.querySelector('.toast-stack').textContent, /still active/);
  release(); await held; await settle(window, 30);

  button.click(); await settle(window, 20);
  window.document.querySelector('.app-dialog form').dispatchEvent(new window.Event('submit', { bubbles:true, cancelable:true }));
  await settle(window, 60);
  assert.equal(window.localStorage.getItem(key), null);
  assert.match(window.document.querySelector('.toast-stack').textContent, /recovery complete/i);
  dom.window.close();
});

test('a fresh tab warns that system clipboard order across sites is ambiguous', async () => {
  const { dom } = createEditorDom(baseGraph), { window } = dom;
  await settle(window, 80);
  setClipboard(window, { type:'graph-editor-clipboard', nodes:[{id:'a',label:'Clipboard item'}], edges:[], externalEdges:[] });
  hotkey(window, 'v', { ctrlKey:true, altKey:true });
  await settle(window, 100);
  assert.equal(exportGraph(window.document).nodes.find(n => n.id === 'a').label, 'Clipboard item');
  assert.match(window.document.querySelector('.toast-stack').textContent, /different sites.*older/);
  dom.window.close();
});

test('compatibility and abandoned-copy failures explain different actions', async () => {
  for(const mode of ['compatibility', 'recovery']) {
    const { dom } = createEditorDom(baseGraph), { window } = dom;
    await settle(window, 80);
    let writes = 0;
    Object.defineProperty(window.navigator, 'clipboard', { configurable:true, value:{ readText:async () => '', writeText:async () => { writes++; } } });
    if(mode === 'compatibility') Object.defineProperty(window.navigator, 'locks', { configurable:true, value:undefined });
    else window.localStorage.setItem('graph-editor-pro-clipboard-inflight', '{"old":true}');
    await selectNode(window, 'a', 300, 330); window.document.querySelector('#btnCopy').click();
    await settle(window, 120);
    const toast = window.document.querySelector('.toast-stack').textContent;
    if(mode === 'compatibility') assert.match(toast, /Web Locks.*storage.*export JSON/);
    else assert.match(toast, /Clipboard recovery/);
    assert.equal(writes, 0);
    dom.window.close();
  }
});

test('cross-origin late writes remain ambiguous and a fresh paste warns the user', async () => {
  const hub = createClipboardHub();
  const a = createEditorDom(baseGraph, 'https://a.example/');
  const b = createEditorDom(baseGraph, 'https://b.example/');
  const aw = a.dom.window, bw = b.dom.window;
  await settle(aw, 80); await settle(bw, 80);
  const ca = hub.attach(aw, 'A'), cb = hub.attach(bw, 'B');
  // Web Locks and localStorage are distinct at different origins.
  Object.defineProperty(aw.navigator, 'locks', { configurable:true, value:createWebLocks() });
  Object.defineProperty(bw.navigator, 'locks', { configurable:true, value:createWebLocks() });
  await selectNode(aw, 'a', 300, 330); await selectNode(bw, 'b', 700, 330);
  aw.document.querySelector('#btnCopy').click(); await settle(aw, 50);
  bw.document.querySelector('#btnCopy').click(); await settle(bw, 50);
  cb.release(); await settle(bw, 40);
  assert.equal(JSON.parse(hub.text).nodes[0].id, 'b');
  ca.release(); await settle(aw, 40);
  assert.equal(JSON.parse(hub.text).nodes[0].id, 'a', 'cross-origin lock scopes cannot prevent the late write');
  const fresh = createEditorDom(baseGraph, 'https://a.example/');
  await settle(fresh.dom.window, 80);
  setClipboard(fresh.dom.window, JSON.parse(hub.text));
  hotkey(fresh.dom.window, 'v', { ctrlKey:true, altKey:true });
  await settle(fresh.dom.window, 100);
  assert.match(fresh.dom.window.document.querySelector('.toast-stack').textContent, /different sites.*older/);
  a.dom.window.close(); b.dom.window.close(); fresh.dom.window.close();
});

test('a known waiting predecessor does not authorize overwriting newer external text', async () => {
  const hub = createClipboardHub();
  const a = createEditorDom(baseGraph), b = createEditorDom(baseGraph);
  const aw = a.dom.window, bw = b.dom.window;
  await settle(aw, 80); await settle(bw, 80);
  const ca = hub.attach(aw, 'A'), cb = hub.attach(bw, 'B');
  Object.defineProperty(aw, 'localStorage', { configurable:true, value:hub.storage });
  Object.defineProperty(bw, 'localStorage', { configurable:true, value:hub.storage });
  let releaseLock;
  const held = aw.navigator.locks.request('graph-editor-pro-clipboard-publish', () => new Promise(resolve => { releaseLock = resolve; }));
  await settle(aw, 20);
  await selectNode(aw, 'a', 300, 330); await selectNode(bw, 'b', 700, 330);
  aw.document.querySelector('#btnCopy').click(); await settle(aw, 50);
  bw.document.querySelector('#btnCopy').click(); await settle(bw, 50);
  releaseLock(); await held; await settle(aw, 120);
  ca.release(); hub.text = 'newer external copy';
  await settle(bw, 250);
  assert.deepEqual(cb.writes, []);
  assert.equal(hub.text, 'newer external copy');
  a.dom.window.close(); b.dom.window.close();
});

test('skipped conflicting clipboard definitions cannot overwrite host node or edge properties', async () => {
  for(const exact of [true, false]){
    const attrs = [
      {id:'field',scope:'node',type:'string',name:'Host field'},
      {id:'edgefield',scope:'edge',type:'string',name:'Host edge'},
      {id:'allfield',scope:'all',type:'string',name:'Host all'},
      ...Array.from({length:1997}, (_,i) => ({id:'filler'+i,scope:'node',type:'string'})),
    ];
    const saved = {...baseGraph, customAttributes:attrs,
      nodes:baseGraph.nodes.map(n => n.id === 'a' ? {...n,custom:{field:'host',allfield:'host-all'}} : n),
      edges:baseGraph.edges.map(e => ({...e,custom:{edgefield:'host-edge',allfield:'host-all-edge'}})),
    };
    const {dom,errors} = createEditorDom(saved), {window} = dom;
    await settle(window,100);
    setClipboard(window, {type:'graph-editor-clipboard',
      nodes:[{id:'a',label:'Pasted',x:0,y:0,custom:{field:'foreign',allfield:'foreign-all'}}, {id:'b',label:'B',x:20,y:0}],
      edges:[{id:'e1',from:'a',to:'b',custom:{edgefield:'foreign-edge',allfield:'foreign-all-edge'}}],externalEdges:[],
      customAttributes:[{id:'field',scope:'node',type:'string',name:'Source field'},
        {id:'edgefield',scope:'edge',type:'string',name:'Source edge'},
        {id:'allfield',scope:'all',type:'string',name:'Source all'}],
    });
    hotkey(window,'v',{ctrlKey:true,...(exact ? {altKey:true} : {})}); await settle(window,200);
    const out = exportGraph(window.document);
    const node = out.nodes.find(n => n.id === 'a');
    const edge = out.edges.find(e => e.id === 'e1');
    assert.equal(node.custom.field,'host'); assert.equal(node.custom.allfield,'host-all');
    assert.equal(edge.custom.edgefield,'host-edge'); assert.equal(edge.custom.allfield,'host-all-edge');
    if(!exact){
      const pasted = out.nodes.find(n => n.id !== 'a' && n.id !== 'b' && n.label === 'Pasted');
      assert.ok(pasted); assert.equal(pasted.custom?.field,undefined); assert.equal(pasted.custom?.allfield,undefined);
    }
    assert.match(window.document.querySelector('.toast-stack').textContent,/skipped/i);
    assert.deepEqual(errors.map(e => e.message),[]); dom.window.close();
  }
});

test('edges resolve their original raw identities when normalized ids collide', async () => {
  for(const exact of [true,false]){
    const {dom,errors} = createEditorDom(baseGraph), {window} = dom;
    await settle(window,80);
    setClipboard(window,{type:'graph-editor-clipboard',nodes:[
      {id:'one!',label:'First',x:100,y:0,order:0}, {id:'one',label:'Duplicate',x:200,y:0,order:1},
    ],edges:[{id:'self',from:'one!',to:'one!',label:'loop'}, {id:'other',from:'one',to:'one!',label:'other'}],externalEdges:[]});
    hotkey(window,'v',{ctrlKey:true,...(exact ? {altKey:true} : {})}); await settle(window,140);
    const out = exportGraph(window.document);
    const node = out.nodes.find(n => n.label === 'First');
    const edge = out.edges.find(e => e.label === 'loop');
    assert.ok(node); assert.ok(edge); assert.equal(edge.from,node.id); assert.equal(edge.to,node.id);
    const duplicate = out.nodes.find(n => n.label === 'Duplicate');
    const other = out.edges.find(e => e.label === 'other');
    assert.ok(duplicate); assert.notEqual(node.id, duplicate.id);
    assert.ok(other); assert.equal(other.from, duplicate.id); assert.equal(other.to, node.id);
    assert.deepEqual(errors.map(e => e.message),[]); dom.window.close();
  }
});


test('accepted server custom values survive a real editor reload', async () => {
  const key = 'x'.repeat(128);
  const target = structuredClone(baseGraph);
  target.nextNode = 1; target.nextEdge = 2;
  target.customAttributes = [{id:key,scope:'node',type:'string'}, {id:'count',scope:'node',type:'int'}];
  target.nodes[0].custom = {[key]:'original',count:1};
  const before = structuredClone(target), ids = new Set();
  for(const custom of [{[key+'extra']:'corrupt'}, {undefinedField:'lost'}]){
    const result = GraphPatchCore.applyServerChange(target, {id:'invalid',revision:1,patch:{nodes:[{id:'a',custom}]}}, {appliedIds:ids});
    assert.equal(result.status,'invalid'); assert.deepEqual(target,before); assert.equal(ids.size,0);
  }
  assert.equal(GraphPatchCore.applyServerChange(target, {id:'valid',revision:1,patch:{nodes:[{id:'a',custom:{count:7}}]}}, {appliedIds:ids}).status,'applied');
  const {dom,errors} = createEditorDom(target); await settle(dom.window,100);
  const restored = exportGraph(dom.window.document).nodes.find(n => n.id === 'a');
  assert.equal(restored.custom[key], 'original'); assert.equal(restored.custom.count,7);
  assert.deepEqual(errors.map(e => e.message),[]); dom.window.close();
});

test('long raw clipboard ids with the same prefix retain distinct endpoints', async () => {
  const prefix = 'z'.repeat(220), first = prefix+'a', second = prefix+'b';
  for(const exact of [true,false]){
    const {dom,errors} = createEditorDom(baseGraph), {window} = dom; await settle(window,80);
    setClipboard(window,{type:'graph-editor-clipboard',nodes:[{id:first,label:'First',x:0,y:0},{id:second,label:'Second',x:100,y:0}],
      edges:[{id:'long-edge',from:first,to:second,label:'long link'}],externalEdges:[]});
    hotkey(window,'v',{ctrlKey:true,...(exact ? {altKey:true} : {})}); await settle(window,150);
    const graph = exportGraph(window.document), a = graph.nodes.find(n => n.label === 'First'), b = graph.nodes.find(n => n.label === 'Second');
    const edge = graph.edges.find(e => e.label === 'long link');
    assert.ok(a && b && edge); assert.notEqual(a.id,b.id); assert.equal(edge.from,a.id); assert.equal(edge.to,b.id);
    assert.deepEqual(errors.map(e => e.message),[]); dom.window.close();
  }
});

test('exact clipboard paste preserves the order of existing nodes', async () => {
  const {dom,errors} = createEditorDom(baseGraph), {window} = dom;
  await settle(window,80);
  setClipboard(window, {type:'graph-editor-clipboard',nodes:[{id:'a',order:1},{id:'b',order:0}],edges:[],externalEdges:[]});
  hotkey(window,'v',{ctrlKey:true,altKey:true}); await settle(window,120);
  const graph = exportGraph(window.document);
  assert.deepEqual(graph.nodes.map(n => [n.id,n.order]), [['a',0],['b',1]]);
  assert.deepEqual(errors.map(e => e.message),[]); dom.window.close();
});
