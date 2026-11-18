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
function setClipboardWrite(window, payload, writeText, readText = async () => JSON.stringify(payload)) {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText, readText },
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

test('a late older write cannot replace a newer local copy', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  let systemText = '';
  const pendingWrites = {};
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      readText: async () => systemText,
      writeText: (text) => {
        const key = JSON.parse(text).nodes[0].id;
        return new Promise(resolve => { pendingWrites[key] = () => { systemText = text; resolve(); }; });
      },
    },
  });

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await selectNode(window, 'b', 700, 330);
  document.querySelector('#btnCopy').click();
  // B's write finishes first, then an unrelated copy overwrites the system
  // clipboard; A's older write finally lands after both.
  pendingWrites.b();
  await settle(window, 20);
  systemText = JSON.stringify({
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'b', label: 'Changed', x: 200, y: 0, order: 1 }],
    edges: [], externalEdges: [], customAttributes: [],
  });
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);
  assert.equal(exportGraph(document).nodes.find(n => n.id === 'b').label, 'Changed');

  pendingWrites.a();
  await settle(window, 20);
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  const graph = exportGraph(document);
  assert.equal(graph.nodes.find(n => n.id === 'b').label, 'B', 'the newer local copy wins again');
  assert.equal(graph.nodes.find(n => n.id === 'a').label, 'A', 'the late older write is ignored');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a denied pre-copy snapshot does not mask a later cross-tab copy', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  let reads = 0;
  const newer = {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'Later cross-tab', x: -200, y: 0, order: 0 }],
    edges: [], externalEdges: [], customAttributes: [],
  };
  setClipboardWrite(window, {}, async () => { throw new Error('denied'); }, async () => {
    reads++;
    if(reads === 1) throw new Error('snapshot denied');
    return JSON.stringify(newer);
  });

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  await settle(window, 40);
  hotkey(window, 'v', { ctrlKey: true, altKey: true });
  await settle(window, 120);

  const a = exportGraph(document).nodes.find(n => n.id === 'a');
  assert.equal(a.label, 'Later cross-tab', 'an unknown baseline is not treated as "always stale"');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a hanging system read does not block a valid local paste', async () => {
  const { dom, errors } = createEditorDom(baseGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  setClipboardWrite(window, {}, async () => {}, () => new Promise(() => {}));

  await selectNode(window, 'a', 300, 330);
  document.querySelector('#btnCopy').click();
  hotkey(window, 'v', { ctrlKey: true });
  await settle(window, 180);

  const graph = exportGraph(document);
  assert.equal(graph.nodes.length, 3, 'the local copy pasted without waiting for the system read');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('offset paste iterates planned nodes so duplicate normalized ids paste once', async () => {
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
  assert.equal(graph.nodes.length, 3, 'only the first normalized id is pasted');
  const one = graph.nodes.find(n => n.id === 'one');
  assert.equal(one.label, 'First');
  assert.deepEqual(one.custom, { p1: 'kept' }, 'the rejected duplicate cannot smuggle in a value');
  assert.match(document.querySelector('.toast-stack').textContent, /skipped/i);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});
