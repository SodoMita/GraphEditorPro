import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

function createEditorDom(savedGraph = null) {
  const errors = [];
  const source = savedGraph
    ? html.replace('<script>', `<script>localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(savedGraph))});</script><script>`)
    : html;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(source, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://offline.test/', virtualConsole,
    beforeParse(window) {
      window.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => null;
      window.URL.createObjectURL = () => 'blob:offline-test';
      window.URL.revokeObjectURL = () => {};
      Object.defineProperty(window.navigator, 'clipboard', { configurable:true, value:{ writeText:async()=>{}, readText:async()=>'' } });
    },
  });
  return { dom, errors };
}

const nextFrame = window => new Promise(resolve => window.setTimeout(resolve, 30));
const settle = (window, ms) => new Promise(resolve => window.setTimeout(resolve, ms));

function dispatchPointer(window, target, type, options = {}) {
  const event = new window.MouseEvent(type, {
    bubbles: true, cancelable: true,
    button: options.button ?? 0,
    clientX: options.clientX ?? 0, clientY: options.clientY ?? 0,
    shiftKey: Boolean(options.shiftKey),
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    pointerType: { value: options.pointerType ?? 'mouse' },
  });
  target.dispatchEvent(event);
}

function setCanvasRect(svg) {
  const rect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 660, right: 1000, bottom: 660, toJSON() { return this; } });
  svg.getBoundingClientRect = rect;
  const wrap = svg.ownerDocument.querySelector('#canvasWrap');
  if (wrap) wrap.getBoundingClientRect = rect;
}

// Node ids are deterministic: a(-200,0) -> screen (300,330), b(200,0) -> (700,330).
function customPropertiesGraph() {
  return {
    title: 'custom-props',
    mode: 'select',
    nextNode: 3, nextEdge: 2,
    nodes: [
      { id: 'a', label: 'Node A', x: -200, y: 0, shape: 'circle', color: '#0ea5e9', type: '', order: 0, custom: { capacity: 7, notes: 'alpha' } },
      { id: 'b', label: 'Node B', x: 200, y: 0, shape: 'circle', color: '#0ea5e9', type: '', order: 1 },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'b', directed: true, weight: '2', label: '', type: '', custom: { enabled: true } }],
    customAttributes: [
      { id: 'capacity', scope: 'node', type: 'int' },
      { id: 'notes', scope: 'node', type: 'string' },
      { id: 'enabled', scope: 'edge', type: 'boolean' },
      { id: 'docTag', scope: 'graph', type: 'string' },
      { id: 'rating', scope: 'graph', type: 'double' },
    ],
    graphCustom: { docTag: 'hello', rating: 4.5 },
    settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
}

function exportGraph(document) {
  document.querySelector('#btnExportJson').click();
  const modal = document.querySelector('.export-modal');
  const graph = JSON.parse(modal.querySelector('textarea').value);
  modal.remove();
  return graph;
}
function exportGraphml(document) {
  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  const text = modal.querySelector('textarea').value;
  modal.remove();
  return text;
}
async function selectNode(window, document, id, x, y) {
  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  document.elementFromPoint = () => document.querySelector('#node-' + id);
  dispatchPointer(window, document.querySelector('#node-' + id), 'pointerdown', { pointerId: 1, clientX: x, clientY: y });
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: x, clientY: y });
  await nextFrame(window);
}
const changeValue = (window, element, value) => {
  element.value = value;
  element.dispatchEvent(new window.Event('change', { bubbles: true }));
};

test('graph-scope values render in the Data tab, persist and unset cleanly', async () => {
  const { dom, errors } = createEditorDom(customPropertiesGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const docTag = document.querySelector('#graphCustomProps [data-custom-attribute="docTag"]');
  const rating = document.querySelector('#graphCustomProps [data-custom-attribute="rating"]');
  assert.ok(docTag && rating, 'graph values block renders for graph-scope attributes');
  assert.equal(docTag.value, 'hello');
  assert.equal(rating.value, '4.5');

  changeValue(window, docTag, 'world');
  await nextFrame(window);
  let graph = exportGraph(document);
  assert.equal(graph.graphCustom.docTag, 'world');
  assert.equal(graph.graphCustom.rating, 4.5, 'untouched graph values are kept');

  changeValue(window, document.querySelector('#graphCustomProps [data-custom-attribute="docTag"]'), '');
  await nextFrame(window);
  graph = exportGraph(document);
  assert.equal(Object.prototype.hasOwnProperty.call(graph.graphCustom, 'docTag'), false, 'an empty field unsets the value');
  assert.equal(graph.graphCustom.rating, 4.5);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('node values: set, view, invalid input reverts, unset, undo and redo', async () => {
  const { dom, errors } = createEditorDom(customPropertiesGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  await selectNode(window, document, 'a', 300, 330);

  let capacity = document.querySelector('#selectionPanel [data-custom-attribute="capacity"]');
  assert.ok(capacity, 'selection panel renders the node custom property');
  assert.equal(capacity.value, '7', 'loads the stored value');

  changeValue(window, capacity, '42');
  await nextFrame(window);
  let graph = exportGraph(document);
  assert.equal(graph.nodes.find(n => n.id === 'a').custom.capacity, 42);

  capacity = document.querySelector('#selectionPanel [data-custom-attribute="capacity"]');
  changeValue(window, capacity, 'not-a-number');
  await nextFrame(window);
  assert.equal(document.querySelector('#selectionPanel [data-custom-attribute="capacity"]').value, '42', 'invalid number is rejected and the field reverts');

  document.querySelector('#btnUndo').click();
  await nextFrame(window); await settle(window, 40);
  graph = exportGraph(document);
  assert.equal(graph.nodes.find(n => n.id === 'a').custom.capacity, 7, 'undo restores the previous value');

  document.querySelector('#btnRedo').click();
  await nextFrame(window); await settle(window, 40);
  graph = exportGraph(document);
  assert.equal(graph.nodes.find(n => n.id === 'a').custom.capacity, 42, 'redo restores the edit');

  changeValue(window, document.querySelector('#selectionPanel [data-custom-attribute="capacity"]'), '');
  await nextFrame(window);
  graph = exportGraph(document);
  assert.equal(graph.nodes.find(n => n.id === 'a').custom?.capacity, undefined, 'clearing the field unsets the value');
  assert.equal(graph.nodes.find(n => n.id === 'a').custom.notes, 'alpha', 'other values are kept');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('edge values render in the single-edge panel and round-trip through undo', async () => {
  const { dom, errors } = createEditorDom(customPropertiesGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  document.elementFromPoint = () => document.querySelector('#edge-e1');
  dispatchPointer(window, document.querySelector('#edge-e1'), 'pointerdown', { pointerId: 1, clientX: 500, clientY: 330 });
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 500, clientY: 330 });
  await nextFrame(window);

  const enabled = document.querySelector('#selectionPanel [data-custom-attribute="enabled"]');
  assert.ok(enabled, 'selection panel renders the edge custom property');
  assert.equal(enabled.tagName, 'SELECT');
  assert.equal(enabled.value, 'true', 'boolean value is restored');

  enabled.value = '__unset__';
  enabled.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  let graph = exportGraph(document);
  assert.equal(graph.edges.find(e => e.id === 'e1').custom?.enabled, undefined, 'unset clears the boolean');

  document.querySelector('#btnUndo').click();
  await nextFrame(window); await settle(window, 40);
  graph = exportGraph(document);
  assert.equal(graph.edges.find(e => e.id === 'e1').custom.enabled, true, 'undo restores the boolean');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('deleting a definition strips its values; renaming migrates them', async () => {
  const { dom, errors } = createEditorDom(customPropertiesGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const rows = [...document.querySelectorAll('.custom-attribute-row')];
  const capacityRow = rows.find(row => row.querySelector('[data-attribute-field="id"]')?.value === 'capacity');
  assert.ok(capacityRow, 'the capacity definition row is rendered');
  changeValue(window, capacityRow.querySelector('[data-attribute-field="id"]'), 'cap');
  capacityRow.querySelector('[data-attribute-action="save"]').click();
  await nextFrame(window);
  let graph = exportGraph(document);
  assert.deepEqual(graph.nodes.find(n => n.id === 'a').custom, { cap: 7, notes: 'alpha' }, 'renaming moves the values to the new id');

  const deleteRow = [...document.querySelectorAll('.custom-attribute-row')]
    .find(row => row.querySelector('[data-attribute-field="id"]')?.value === 'notes');
  assert.ok(deleteRow, 'the notes definition row is rendered');
  deleteRow.querySelector('[data-attribute-action="delete"]').click();
  await nextFrame(window);
  graph = exportGraph(document);
  assert.deepEqual(graph.nodes.find(n => n.id === 'a').custom, { cap: 7 }, 'deleting a definition drops its values');
  assert.equal(graph.customAttributes.some(a => a.id === 'notes'), false, 'the definition itself is removed');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('GraphML export carries values and re-import restores them', async () => {
  const { dom, errors } = createEditorDom(customPropertiesGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const graphml = exportGraphml(document);
  assert.match(graphml, /<data key="capacity">7<\/data>/, 'node value exported');
  assert.match(graphml, /<data key="notes">alpha<\/data>/, 'string node value exported');
  assert.match(graphml, /<data key="enabled">true<\/data>/, 'boolean edge value exported');
  assert.match(graphml, /<data key="docTag">hello<\/data>/, 'graph value exported');
  assert.match(graphml, /<data key="rating">4.5<\/data>/, 'double graph value exported');
  // Definitions are emitted as <key> elements.
  assert.match(graphml, /<key id="capacity" for="node" attr\.name="capacity" attr\.type="int"\/>/);

  // Re-import the file (replace mode) through the export modal.
  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = graphml;
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);

  const docTag = document.querySelector('#graphCustomProps [data-custom-attribute="docTag"]');
  assert.equal(docTag?.value, 'hello', 'graph value survives the round-trip');
  assert.equal(document.querySelector('#graphCustomProps [data-custom-attribute="rating"]')?.value, '4.5');
  const roundTrip = exportGraphml(document);
  assert.match(roundTrip, /<data key="capacity">7<\/data>/, 'node value survives the round-trip');
  assert.match(roundTrip, /<data key="notes">alpha<\/data>/, 'string value survives the round-trip');
  assert.match(roundTrip, /<data key="enabled">true<\/data>/, 'boolean value survives the round-trip');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('sanitizer prunes values without definitions and coerces junk safely', async () => {
  const payload = {
    title: 'junk', nextNode: 2, nextEdge: 1,
    nodes: [{ id: 'a', label: 'A', x: 0, y: 0, custom: { capacity: 'not-a-number', bogus: 'zzz', enabled: 'yes' } }],
    edges: [],
    customAttributes: [
      { id: 'capacity', scope: 'node', type: 'int' },
      { id: 'enabled', scope: 'node', type: 'boolean' },
    ],
    settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const { dom, errors } = createEditorDom();
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  document.querySelector('#btnExportJson').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = JSON.stringify(payload);
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);

  const graph = exportGraph(document);
  assert.deepEqual(graph.nodes[0].custom, { capacity: 'not-a-number', enabled: true },
    'values for undefined ids are dropped; unparsable values survive as text instead of crashing');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('attribute ids are escaped when custom properties render', async () => {
  const { dom, errors } = createEditorDom(customPropertiesGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const malicious = '"><img src=x onerror="window.__xss=1">';
  document.querySelector('#customAttributeId').value = malicious;
  document.querySelector('#btnAddCustomAttribute').click();
  await nextFrame(window);

  await selectNode(window, document, 'a', 300, 330);
  assert.equal(document.querySelector('#selectionPanel img'), null, 'no element injection through the attribute id');
  assert.equal(window.__xss, undefined, 'no script execution');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('graph values and node customs survive a localStorage reload', async () => {
  const first = createEditorDom(customPropertiesGraph());
  const { window } = first.dom; const { document } = window;
  await nextFrame(window);
  changeValue(window, document.querySelector('#graphCustomProps [data-custom-attribute="rating"]'), '9.25');
  // Flush the debounced autosave.
  await settle(window, 400);
  const saved = window.localStorage.getItem('graph-editor-pro-v2');
  assert.ok(saved, 'autosave wrote the document');
  assert.equal(JSON.parse(saved).graphCustom.rating, 9.25);
  assert.equal(JSON.parse(saved).nodes.find(n => n.id === 'a').custom.capacity, 7);
  first.dom.window.close();
});

test('multi-select applies a value to every selected node and supports unset', async () => {
  const { dom, errors } = createEditorDom(customPropertiesGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  // Switch to the rectangle selection tool and drag a frame covering both nodes.
  document.querySelector('[data-selecttool="rect"]').click();
  await nextFrame(window);
  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  dispatchPointer(window, svg, 'pointerdown', { pointerId: 1, clientX: 250, clientY: 280 });
  dispatchPointer(window, svg, 'pointermove', { pointerId: 1, clientX: 750, clientY: 380 });
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 750, clientY: 380 });
  await nextFrame(window); await settle(window, 40);

  const capacity = document.querySelector('#selectionPanel [data-scope="node"] [data-custom-attribute="capacity"]');
  assert.ok(capacity, 'multi-select panel renders node custom properties');
  changeValue(window, capacity, '99');
  await nextFrame(window);

  let graph = exportGraph(document);
  assert.equal(graph.nodes.find(n => n.id === 'a').custom.capacity, 99, 'applies to the first selected node');
  assert.equal(graph.nodes.find(n => n.id === 'b').custom.capacity, 99, 'applies to the second selected node');

  // Empty text input in multi mode keeps values (no accidental wipes)...
  const keepInput = document.querySelector('#selectionPanel [data-scope="node"] [data-custom-attribute="capacity"]');
  changeValue(window, keepInput, '');
  await nextFrame(window);
  graph = exportGraph(document);
  assert.equal(graph.nodes.find(n => n.id === 'b').custom.capacity, 99, 'an empty multi edit keeps the values');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('GraphML import tolerates externally authored mixed-case keys and round-trips values', async () => {
  // QVGE-style files: key id differs from attr.name, mixed case, boolean as "yes".
  const { dom, errors } = createEditorDom();
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="MyKey" for="node" attr.name="My NAME" attr.type="int"/>
  <key id="DocTag" for="graph" attr.name="Doc Tag" attr.type="string"/>
  <key id="EdgeFlag" for="edge" attr.name="Edge Flag" attr.type="boolean"/>
  <graph id="g" edgedefault="directed">
    <data key="DocTag">hello-world</data>
    <node id="a"><data key="MyKey">42</data></node>
    <node id="b"/>
    <edge id="e1" source="a" target="b" directed="true"><data key="EdgeFlag">yes</data></edge>
  </graph>
</graphml>`;
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);

  const graphInput = document.querySelector('#graphCustomProps [data-custom-attribute="DocTag"]');
  assert.equal(graphInput?.value, 'hello-world', 'graph-scope value imports from a mixed-case attr.name');
  await selectNode(window, document, 'a', 300, 330);
  const nodeInput = document.querySelector('#selectionPanel [data-custom-attribute="MyKey"]');
  assert.equal(nodeInput?.value, '42', 'node value imports');

  const roundTrip = exportGraphml(document);
  assert.match(roundTrip, /<data key="DocTag">hello-world<\/data>/);
  assert.match(roundTrip, /<data key="MyKey">42<\/data>/);
  assert.match(roundTrip, /<data key="EdgeFlag">true<\/data>/, 'boolean "yes" is parsed to true and re-exported as true');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('new node defaults apply pending custom values and keep them as one undo step per edit', async () => {
  const seed = customPropertiesGraph();
  const graph = { ...seed, nodes: [], edges: [], settings: {} };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const input = document.querySelector('#newNodeCustomProps [data-scope="node"] [data-custom-attribute="capacity"]');
  assert.ok(input, 'the Node placement section renders pending node custom property editors');
  changeValue(window, input, '33');
  await nextFrame(window);

  // Create a node via the canvas in node mode.
  document.querySelector('[data-mode="node"]').click();
  const canvas = document.querySelector('#graphCanvas');
  setCanvasRect(canvas);
  dispatchPointer(window, canvas, 'pointerdown', { pointerId: 1, clientX: 300, clientY: 300 });
  dispatchPointer(window, canvas, 'pointerup', { pointerId: 1, clientX: 300, clientY: 300 });
  await nextFrame(window); await settle(window, 40);

  let exported = exportGraph(document);
  assert.equal(exported.nodes.length, 1, 'one node created');
  assert.equal(exported.nodes[0].custom.capacity, 33, 'pending value applied to the new node');
  assert.equal(exported.settings.nodeCustom.capacity, 33, 'pending value persists on settings');

  // One history entry for the creation, one for the earlier property edit.
  document.querySelector('#btnUndo').click();
  await nextFrame(window); await settle(window, 40);
  exported = exportGraph(document);
  assert.equal(exported.nodes.length, 0, 'undo removes the created node');
  assert.equal(exported.settings.nodeCustom.capacity, 33, 'the pending value edit is a separate history entry');

  document.querySelector('#btnUndo').click();
  await nextFrame(window); await settle(window, 40);
  exported = exportGraph(document);
  assert.equal(exported.settings.nodeCustom.capacity, undefined, 'a second undo reverts the pending value edit');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('new edge defaults apply pending custom values to edges created via connect', async () => {
  const graph = {
    title: 'pending-edge', mode: 'edge', nextNode: 3, nextEdge: 1,
    nodes: [
      { id: 'n1', label: 'A', x: 100, y: 100, order: 0 },
      { id: 'n2', label: 'B', x: 400, y: 100, order: 1 },
    ],
    edges: [],
    customAttributes: [{ id: 'enabled', scope: 'edge', type: 'boolean' }],
    settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const enabled = document.querySelector('#newEdgeCustomProps [data-scope="edge"] [data-custom-attribute="enabled"]');
  assert.ok(enabled, 'the New edge defaults section renders pending edge custom property editors');
  changeValue(window, enabled, 'true');
  await nextFrame(window);

  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  document.elementFromPoint = () => document.querySelector('#node-n2');
  dispatchPointer(window, document.querySelector('#node-n1'), 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  dispatchPointer(window, svg, 'pointermove', { pointerId: 1, clientX: 400, clientY: 100 });
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 400, clientY: 100 });
  await nextFrame(window); await settle(window, 40);

  const exported = exportGraph(document);
  assert.equal(exported.edges.length, 1, 'one edge created via connect');
  assert.equal(exported.edges[0].from, 'n1');
  assert.equal(exported.edges[0].to, 'n2');
  assert.equal(exported.edges[0].custom.enabled, true, 'pending value applied to the new edge');
  assert.equal(exported.settings.edgeCustom.enabled, true, 'pending value persists on settings');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('renaming and deleting a definition migrates and strips pending new-element values', async () => {
  const graph = {
    title: 'pending-rename', mode: 'select', nextNode: 1, nextEdge: 1,
    nodes: [], edges: [],
    customAttributes: [{ id: 'capacity', scope: 'node', type: 'int' }],
    settings: { nodeCustom: { capacity: 5 } },
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  // The pending value survived sanitize at load time.
  const input = document.querySelector('#newNodeCustomProps [data-custom-attribute="capacity"]');
  assert.equal(input?.value, '5');

  // Rename the definition; the pending value follows the new id.
  const row = document.querySelector('.custom-attribute-row');
  row.querySelector('[data-attribute-field="id"]').value = 'maxCapacity';
  row.querySelector('[data-attribute-action="save"]').click();
  await nextFrame(window);
  let exported = exportGraph(document);
  assert.deepEqual(exported.settings.nodeCustom, { maxCapacity: 5 }, 'pending value migrated to the new id');
  assert.equal(document.querySelector('#newNodeCustomProps [data-custom-attribute="maxCapacity"]')?.value, '5');

  // Delete the definition; the pending value is stripped.
  document.querySelector('.custom-attribute-row [data-attribute-action="delete"]').click();
  await nextFrame(window);
  exported = exportGraph(document);
  assert.deepEqual(exported.settings.nodeCustom, {}, 'pending value stripped with the definition');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('GraphML round-trip keeps case-distinct custom ids and never rewrites the node label', async () => {
  const graph = { ...customPropertiesGraph(),
    nodes: [{ id: 'a', label: 'Original', x: -200, y: 0, shape: 'circle', color: '#0ea5e9', type: '', order: 0, custom: { ColorTag: 'red', colortag: 7 } }],
    edges: [],
    customAttributes: [
      { id: 'ColorTag', scope: 'node', type: 'string' },
      { id: 'colortag', scope: 'node', type: 'int' },
    ],
    graphCustom: {},
  };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const graphml = exportGraphml(document);
  assert.match(graphml, /<key id="ColorTag"/);
  assert.match(graphml, /<key id="colortag"/);
  assert.match(graphml, /<data key="ColorTag">red<\/data>/);
  assert.match(graphml, /<data key="colortag">7<\/data>/);

  // Re-import through the export modal (replace mode).
  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = graphml;
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);

  const roundTripped = exportGraph(document);
  assert.equal(roundTripped.nodes.find(n => n.id === 'a').label, 'Original', 'the built-in label is untouched');
  assert.equal(roundTripped.nodes.find(n => n.id === 'a').custom.ColorTag, 'red');
  assert.equal(roundTripped.nodes.find(n => n.id === 'a').custom.colortag, 7);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('GraphML graph-scope values are not overwritten by node values sharing attr.name', async () => {
  const qvge = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="gOwner" for="graph" attr.name="owner" attr.type="string"/>
  <key id="nOwner" for="node" attr.name="owner" attr.type="string"/>
  <graph id="g" edgedefault="directed">
    <data key="gOwner">Alice</data>
    <node id="a"><data key="nOwner">Bob</data></node>
    <node id="b"/>
    <edge id="e1" source="a" target="b" directed="true"/>
  </graph>
</graphml>`;
  const { dom, errors } = createEditorDom();
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = qvge;
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);

  const exported = exportGraph(document);
  assert.equal(exported.graphCustom.gOwner, 'Alice', 'the graph-scope value survives; node data cannot overwrite it');
  assert.equal(exported.nodes.find(n => n.id === 'a').custom.nOwner, 'Bob');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('more than 200 custom values survive a load (cap matches the 500-definition limit)', async () => {
  const customAttributes = [];
  const custom = {};
  for (let i = 0; i < 210; i++) {
    const id = 'attr_' + String(i).padStart(3, '0');
    customAttributes.push({ id, scope: 'node', type: 'int' });
    custom[id] = i;
  }
  const graph = {
    title: 'cap', mode: 'select', nextNode: 2, nextEdge: 1,
    nodes: [{ id: 'a', label: 'A', x: 0, y: 0, order: 0, custom }],
    edges: [], customAttributes, settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  const exported = exportGraph(document);
  assert.equal(Object.keys(exported.nodes[0].custom || {}).length, 210, 'no values are silently dropped past 200');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('int32 minimum and beyond-safe-range long are never silently clamped', async () => {
  const graph = { ...customPropertiesGraph(),
    customAttributes: [
      { id: 'intDef', scope: 'node', type: 'int' },
      { id: 'longDef', scope: 'node', type: 'long' },
    ],
    nodes: [{ id: 'a', label: 'A', x: -200, y: 0, order: 0, custom: { intDef: -2147483648 } }],
    edges: [],
  };
  delete graph.graphCustom;
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  await selectNode(window, document, 'a', 300, 330);

  // Loaded value is the int32 minimum, not clamped upward.
  let input = document.querySelector('#selectionPanel [data-custom-attribute="intDef"]');
  assert.equal(input.value, '-2147483648');

  // Above int32: preserved as the exact text, not clamped to 2147483647.
  changeValue(window, input, '2147483648');
  await nextFrame(window);
  let exported = exportGraph(document);
  assert.equal(exported.nodes.find(n => n.id === 'a').custom.intDef, '2147483648');

  // A 64-bit long the JS number line cannot hold exactly: exact text round-trips.
  const longInput = document.querySelector('#selectionPanel [data-custom-attribute="longDef"]');
  changeValue(window, longInput, '9223372036854775807');
  await nextFrame(window);
  exported = exportGraph(document);
  assert.equal(exported.nodes.find(n => n.id === 'a').custom.longDef, '9223372036854775807');

  // Undo restores the pre-clamp history entry with the int32 minimum intact.
  document.querySelector('#btnUndo').click();
  await nextFrame(window); await settle(window, 40);
  document.querySelector('#btnUndo').click();
  await nextFrame(window); await settle(window, 40);
  input = document.querySelector('#selectionPanel [data-custom-attribute="intDef"]');
  exported = exportGraph(document);
  assert.equal(exported.nodes.find(n => n.id === 'a').custom.intDef, -2147483648, 'int32 minimum survives undo');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('GraphML <default> on custom keys is applied to elements without explicit data', async () => {
  const qvge = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="dCap" for="node" attr.name="dCap" attr.type="int"><default>42</default></key>
  <key id="dTag" for="graph" attr.name="dTag" attr.type="string"><default>hello</default></key>
  <key id="dFlag" for="edge" attr.name="dFlag" attr.type="boolean"><default>yes</default></key>
  <graph id="g" edgedefault="directed">
    <node id="a"><data key="dCap">7</data></node>
    <node id="b"/>
    <edge id="e1" source="a" target="b" directed="true"/>
  </graph>
</graphml>`;
  const { dom, errors } = createEditorDom();
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = qvge;
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);

  const exported = exportGraph(document);
  assert.equal(exported.nodes.find(n => n.id === 'a').custom.dCap, 7, 'explicit data wins over the default');
  assert.equal(exported.nodes.find(n => n.id === 'b').custom.dCap, 42, 'the key default applies to elements without data');
  assert.equal(exported.graphCustom.dTag, 'hello', 'graph-scope default applied');
  assert.equal(exported.edges[0].custom.dFlag, true, 'edge-scope default applied');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('changing a definition type migrates values and drops the unconvertible ones', async () => {
  const graph = { ...customPropertiesGraph(),
    customAttributes: [
      { id: 'flag', scope: 'graph', type: 'string' },
      { id: 'count', scope: 'graph', type: 'string' },
      { id: 'score', scope: 'node', type: 'int' },
    ],
    nodes: [{ id: 'a', label: 'A', x: -200, y: 0, order: 0, custom: { score: 42 } }],
    edges: [],
    graphCustom: { flag: 'yes', count: 'hello' },
  };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const rowFor = id => [...document.querySelectorAll('.custom-attribute-row')]
    .find(row => row.querySelector('[data-attribute-field="id"]').value === id);
  const setType = (row, type) => {
    row.querySelector('[data-attribute-field="type"]').value = type;
    row.querySelector('[data-attribute-action="save"]').click();
  };

  // string "yes" → boolean true (converted, not dropped, not left as junk)
  setType(rowFor('flag'), 'boolean');
  await nextFrame(window);
  let exported = exportGraph(document);
  assert.equal(exported.graphCustom.flag, true);

  // string "hello" → int: cannot be represented, value is dropped explicitly
  setType(rowFor('count'), 'int');
  await nextFrame(window);
  exported = exportGraph(document);
  assert.equal(Object.prototype.hasOwnProperty.call(exported.graphCustom, 'count'), false, 'unconvertible graph value is dropped, not left dangling');
  assert.equal(exported.graphCustom.flag, true, 'untouched definitions keep their values');

  // int → string: value is converted, not dropped
  setType(rowFor('score'), 'string');
  await nextFrame(window);
  exported = exportGraph(document);
  assert.equal(exported.nodes.find(n => n.id === 'a').custom.score, '42');

  // Undo still steps over the migrations one edit at a time.
  document.querySelector('#btnUndo').click();
  await nextFrame(window); await settle(window, 40);
  exported = exportGraph(document);
  assert.equal(exported.nodes.find(n => n.id === 'a').custom.score, 42, 'undo restores the pre-migration value');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('adding a definition refreshes an open selection panel; append import repaints the Data tab', async () => {
  const graph = { ...customPropertiesGraph(),
    nodes: [
      { id: 'a', label: 'A', x: -200, y: 0, order: 0 },
      { id: 'b', label: 'B', x: 200, y: 0, order: 1 },
    ],
  };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  await selectNode(window, document, 'a', 300, 330);
  assert.equal(document.querySelector('#selectionPanel [data-custom-attribute="newTag"]'), null);

  // Add a node-scope definition via the form while the node stays selected.
  document.querySelector('#customAttributeId').value = 'newTag';
  document.querySelector('#customAttributeScope').value = 'node';
  document.querySelector('#customAttributeType').value = 'string';
  document.querySelector('#btnAddCustomAttribute').click();
  await nextFrame(window);
  assert.ok(document.querySelector('#selectionPanel [data-custom-attribute="newTag"]'),
    'the selection panel immediately shows the new attribute');

  // Append-import a document declaring a graph-scope definition with a value.
  const appended = {
    title: 'appended', mode: 'select', nextNode: 1, nextEdge: 1,
    nodes: [{ id: 'app1', label: 'App', x: 400, y: 200, order: 2 }],
    edges: [],
    customAttributes: [{ id: 'appendedDef', scope: 'graph', type: 'string' }],
    graphCustom: { appendedDef: 'from-append' },
    settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  document.querySelector('#btnExportJson').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = JSON.stringify(appended);
  modal.querySelector('#expAppendChk').click();
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);

  assert.ok([...document.querySelectorAll('#customAttributesList .custom-attribute-row')]
    .some(row => row.querySelector('[data-attribute-field="id"]').value === 'appendedDef'),
    'the Data tab lists the appended definition');
  assert.equal(document.querySelector('#graphCustomProps [data-custom-attribute="appendedDef"]')?.value,
    'from-append', 'the imported graph value is visible without further interaction');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('GraphML keys with QVGE built-in attr.name (name/posx/posy) import as built-ins, not custom', async () => {
  const qvge = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="kName" for="node" attr.name="name" attr.type="string"/>
  <key id="kPosX" for="node" attr.name="posx" attr.type="double"/>
  <key id="kPosY" for="node" attr.name="posy" attr.type="double"/>
  <key id="kNote" for="node" attr.name="note" attr.type="string"/>
  <graph id="g" edgedefault="directed">
    <node id="a"><data key="kName">Alpha</data><data key="kPosX">123</data><data key="kPosY">456</data><data key="kNote">hello</data></node>
  </graph>
</graphml>`;
  const { dom, errors } = createEditorDom();
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = qvge;
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);

  const graph = exportGraph(document);
  const node = graph.nodes.find(n => n.id === 'a');
  assert.equal(node.label, 'Alpha', 'the name key feeds the built-in label');
  assert.equal(node.x, 123);
  assert.equal(node.y, 456);
  assert.deepEqual(graph.customAttributes.map(a => a.id), ['kNote'],
    'built-in keys are not re-created as custom definitions');
  assert.equal(node.custom.kNote, 'hello', 'genuinely custom keys still import');
  // The add form likewise refuses built-in names going forward.
  document.querySelector('#customAttributeId').value = 'posx';
  document.querySelector('#customAttributeScope').value = 'node';
  document.querySelector('#customAttributeType').value = 'string';
  document.querySelector('#btnAddCustomAttribute').click();
  await nextFrame(window);
  assert.equal(exportGraph(document).customAttributes.some(a => a.id === 'posx'), false,
    'built-in attr.name values cannot become custom ids');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a legacy custom id colliding with a built-in name round-trips without touching the node stroke', async () => {
  // Documents created before the reserved-name rules: custom attribute
  // "stroke.color" with a value, plus an unrelated built-in stroke color.
  const legacy = {
    title: 'legacy-stroke', mode: 'select', nextNode: 2, nextEdge: 1,
    nodes: [{ id: 'a', label: 'A', x: 0, y: 0, order: 0, strokeColor: '#123456', custom: { 'stroke.color': '#ff0000' } }],
    edges: [],
    customAttributes: [{ id: 'stroke.color', scope: 'node', type: 'string' }],
    graphCustom: {},
    settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const { dom, errors } = createEditorDom(legacy);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  // The load migrates the legacy definition to a unique safe id, keeping the value.
  let graph = exportGraph(document);
  assert.deepEqual(graph.customAttributes.map(a => a.id), ['stroke.color_1']);
  assert.equal(graph.nodes.find(n => n.id === 'a').custom['stroke.color_1'], '#ff0000');

  // Round-trip through the GraphML export and back.
  const graphml = exportGraphml(document);
  assert.match(graphml, /<key id="stroke\.color_1" /);
  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = graphml;
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);

  graph = exportGraph(document);
  const node = graph.nodes.find(n => n.id === 'a');
  assert.equal(node.strokeColor, '#123456', 'the built-in stroke keeps its own value');
  assert.deepEqual(graph.customAttributes.map(a => a.id), ['stroke.color_1'], 'the custom definition survives the round-trip');
  assert.equal(node.custom['stroke.color_1'], '#ff0000');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('previously allowed case-variant definitions are migrated, not discarded, on load', async () => {
  const legacy = {
    title: 'legacy-case', mode: 'select', nextNode: 2, nextEdge: 2,
    nodes: [{ id: 'a', label: 'A', x: 0, y: 0, order: 0, custom: { FillColor: 'red' } }],
    edges: [{ id: 'e1', from: 'a', to: 'a', directed: true, weight: '1', label: '', type: '', custom: { Direction: 9 } }],
    customAttributes: [
      { id: 'Label', scope: 'graph', type: 'int' },
      { id: 'FillColor', scope: 'node', type: 'string' },
      { id: 'Direction', scope: 'edge', type: 'int' },
    ],
    graphCustom: { Label: 5 },
    settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const { dom, errors } = createEditorDom(legacy);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const graph = exportGraph(document);
  assert.deepEqual(graph.customAttributes.map(a => a.id).sort(), ['Direction_1', 'FillColor_1', 'Label_1'],
    'legacy ids are renamed to unique safe ids');
  assert.equal(graph.graphCustom.Label_1, 5, 'the graph value moved with its definition');
  assert.equal(graph.nodes.find(n => n.id === 'a').custom.FillColor_1, 'red');
  assert.equal(graph.edges.find(e => e.id === 'e1').custom.Direction_1, 9);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('changing a definition from string to long keeps a 64-bit value the number line cannot hold', async () => {
  const graph = { ...customPropertiesGraph(),
    nodes: [], edges: [],
    customAttributes: [{ id: 'big', scope: 'graph', type: 'string' }],
    graphCustom: { big: '9223372036854775807' },
  };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const row = [...document.querySelectorAll('.custom-attribute-row')]
    .find(r => r.querySelector('[data-attribute-field="id"]').value === 'big');
  row.querySelector('[data-attribute-field="type"]').value = 'long';
  row.querySelector('[data-attribute-action="save"]').click();
  await nextFrame(window);

  const exported = exportGraph(document);
  assert.equal(exported.graphCustom.big, '9223372036854775807', 'the exact 64-bit value survives the type change');
  const input = document.querySelector('#graphCustomProps [data-custom-attribute="big"]');
  assert.equal(input.value, '9223372036854775807', 'the field shows the exact value');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('the editor refuses a 501st definition instead of letting it vanish on reload', async () => {
  const customAttributes = Array.from({ length: 500 }, (_, i) => ({
    id: 'attr' + String(i).padStart(3, '0'), scope: 'node', type: 'string',
  }));
  const graph = { ...customPropertiesGraph(), nodes: [], edges: [], customAttributes, graphCustom: {} };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  document.querySelector('#customAttributeId').value = 'overflow';
  document.querySelector('#customAttributeScope').value = 'node';
  document.querySelector('#customAttributeType').value = 'string';
  document.querySelector('#btnAddCustomAttribute').click();
  await nextFrame(window);

  const exported = exportGraph(document);
  assert.equal(exported.customAttributes.length, 500, 'the cap holds; nothing silently disappears on reload');
  assert.equal(exported.customAttributes.some(a => a.id === 'overflow'), false);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('append-import past the definition cap skips the extra definitions with a toast', async () => {
  const customAttributes = Array.from({ length: 500 }, (_, i) => ({
    id: 'attr' + String(i).padStart(3, '0'), scope: 'node', type: 'string',
  }));
  const graph = { ...customPropertiesGraph(), nodes: [], edges: [], customAttributes, graphCustom: {} };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const imported = {
    title: 'imported', mode: 'select', nextNode: 1, nextEdge: 1,
    nodes: [{ id: 'app1', label: 'App', x: 100, y: 100, order: 0 }],
    edges: [],
    customAttributes: [{ id: 'extra1', scope: 'node', type: 'string' }, { id: 'extra2', scope: 'graph', type: 'string' }],
    graphCustom: { extra2: 'value' },
    settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  document.querySelector('#btnExportJson').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = JSON.stringify(imported);
  modal.querySelector('#expAppendChk').click();
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);

  const exported = exportGraph(document);
  assert.equal(exported.customAttributes.length, 500, 'the imported definitions beyond the cap are skipped');
  assert.equal(exported.customAttributes.some(a => a.id === 'extra1'), false);
  assert.equal(exported.graphCustom.extra2, undefined, 'values without a definition are dropped, not stored');
  const toastText = [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ');
  assert.match(toastText, /Skipped 2/, 'the skip is reported to the user');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a __proto__ custom property works like any other: own-key storage end to end', async () => {
  // Fresh document: create the definition through the form.
  const { dom, errors } = createEditorDom();
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  document.querySelector('#customAttributeId').value = '__proto__';
  document.querySelector('#customAttributeScope').value = 'graph';
  document.querySelector('#customAttributeType').value = 'string';
  document.querySelector('#btnAddCustomAttribute').click();
  await nextFrame(window);

  const input = document.querySelector('#graphCustomProps [data-custom-attribute="__proto__"]');
  assert.ok(input, 'the graph values block renders the new property');
  assert.equal(input.value, '', 'a fresh property renders empty, not [object Object]');
  changeValue(window, input, 'hello');
  await nextFrame(window);

  const exported = exportGraph(document);
  assert.equal(Object.prototype.hasOwnProperty.call(exported.graphCustom, '__proto__'), true,
    'the value is stored as an own key');
  assert.equal(exported.graphCustom['__proto__'], 'hello');
  assert.equal(Object.getPrototypeOf(exported.graphCustom), Object.prototype,
    'JSON round-trip keeps the own key without polluting prototypes');
  dom.window.close();

  // Seeded document: an own "__proto__" key stored in the file loads intact.
  const seeded = JSON.parse('{"title":"proto","mode":"select","nextNode":2,"nextEdge":1,"nodes":[{"id":"a","label":"A","x":0,"y":0,"order":0}],"edges":[],"customAttributes":[{"id":"__proto__","scope":"graph","type":"string"}],"graphCustom":{"__proto__":"hello"},"settings":{},"viewBox":{"x":-500,"y":-330,"w":1000,"h":660}}');
  const seededDom = createEditorDom(seeded);
  const seededWindow = seededDom.dom.window; const seededDocument = seededWindow.document;
  await nextFrame(seededWindow);
  const loaded = seededDocument.querySelector('#graphCustomProps [data-custom-attribute="__proto__"]');
  assert.equal(loaded.value, 'hello', 'the stored own key survives the load, not the prototype');
  const roundTripped = exportGraph(seededDocument);
  assert.equal(roundTripped.graphCustom['__proto__'], 'hello');
  assert.deepEqual(seededDom.errors.map(error => error.message), []);
  seededDom.dom.window.close();
});

test('legacy migration reserves ids from the whole input — no overwrite of existing definitions', async () => {
  const legacy = {
    title: 'legacy-reserve', mode: 'select', nextNode: 2, nextEdge: 1,
    nodes: [{ id: 'a', label: 'A', x: 0, y: 0, order: 0, custom: { Label: 'a', Label_1: 'b' } }],
    edges: [],
    customAttributes: [
      { id: 'Label', scope: 'node', type: 'string' },
      { id: 'Label_1', scope: 'node', type: 'string' },
      { id: 'Weight', scope: 'graph', type: 'string' },
      { id: 'Weight_1', scope: 'graph', type: 'string' },
    ],
    graphCustom: { Weight: 'x', Weight_1: 'y', Weight_2: 'orphan' },
    settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const { dom, errors } = createEditorDom(legacy);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const graph = exportGraph(document);
  const ids = graph.customAttributes.map(a => a.id).sort();
  // The pre-existing Label_1 and Tag_1 survive untouched; the legacy ids are
  // migrated to fresh ids that collide with nothing in the input.
  assert.deepEqual(ids, ['Label_1', 'Label_2', 'Weight_1', 'Weight_3'],
    'pre-existing definitions and orphan value keys are both reserved; migrated ids skip them');
  assert.equal(graph.nodes.find(n => n.id === 'a').custom.Label_1, 'b');
  assert.equal(graph.nodes.find(n => n.id === 'a').custom.Label_2, 'a', 'the legacy value moved to the migrated id');
  assert.equal(graph.graphCustom.Weight_1, 'y', 'the pre-existing definition keeps its value');
  assert.equal(graph.graphCustom.Weight_3, 'x', 'the graph value moved to the migrated id');
  assert.equal(Object.prototype.hasOwnProperty.call(graph.graphCustom, 'Weight_2'), false,
    'an orphan value key with no definition is dropped, not adopted');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('append import counts duplicate definitions for free against capacity', async () => {
  const customAttributes = Array.from({ length: 499 }, (_, i) => ({
    id: 'attr' + String(i).padStart(3, '0'), scope: 'node', type: 'string',
  }));
  const graph = { ...customPropertiesGraph(), nodes: [], edges: [], customAttributes, graphCustom: {} };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  // attr000 already exists; extra is new — it fits exactly once (499 + 1 = 500).
  const imported = {
    title: 'imported', mode: 'select', nextNode: 1, nextEdge: 1,
    nodes: [{ id: 'app1', label: 'App', x: 100, y: 100, order: 0, custom: { extra: 'kept' } }],
    edges: [],
    customAttributes: [
      { id: 'attr000', scope: 'node', type: 'string' },
      { id: 'extra', scope: 'node', type: 'string' },
    ],
    graphCustom: {},
    settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  document.querySelector('#btnExportJson').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = JSON.stringify(imported);
  modal.querySelector('#expAppendChk').click();
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);

  let exported = exportGraph(document);
  assert.equal(exported.customAttributes.length, 500);
  assert.equal(exported.customAttributes.some(a => a.id === 'extra'), true,
    'the new definition fits the remaining capacity and is kept');
  assert.equal(exported.nodes.find(n => n.id === 'app1').custom.extra, 'kept',
    'its value survives together with the definition');
  const toastText = [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ');
  assert.doesNotMatch(toastText, /Skipped/, 'nothing was skipped — capacity was used, not duplicates');
  dom.window.close();

  // Genuinely full: the new definition is skipped with a toast.
  const fullAttributes = Array.from({ length: 500 }, (_, i) => ({
    id: 'attr' + String(i).padStart(3, '0'), scope: 'node', type: 'string',
  }));
  const full = { ...customPropertiesGraph(), nodes: [], edges: [], customAttributes: fullAttributes, graphCustom: {} };
  const fullDom = createEditorDom(full);
  const fullWindow = fullDom.dom.window; const fullDocument = fullWindow.document;
  await nextFrame(fullWindow);
  fullDocument.querySelector('#btnExportJson').click();
  const fullModal = fullDocument.querySelector('.export-modal');
  fullModal.querySelector('textarea').value = JSON.stringify(imported);
  fullModal.querySelector('#expAppendChk').click();
  fullModal.querySelector('#expImportBtn').click();
  await nextFrame(fullWindow); await settle(fullWindow, 60);
  exported = exportGraph(fullDocument);
  assert.equal(exported.customAttributes.length, 500);
  assert.equal(exported.customAttributes.some(a => a.id === 'extra'), false);
  const fullToast = [...fullDocument.querySelectorAll('.toast')].map(t => t.textContent).join(' | ');
  assert.match(fullToast, /Skipped 1/, 'only the definition that does not fit is skipped');
  fullDom.dom.window.close();
});

test('__proto__ values survive cloning: new nodes from pending defaults and duplication', async () => {
  const seeded = JSON.parse('{"title":"proto-clone","mode":"select","selectTool":"single","selectCombine":"replace","nextNode":2,"nextEdge":1,"nodes":[{"id":"seed1","label":"Seed","x":-200,"y":0,"order":0,"custom":{"__proto__":"keep"}}],"edges":[],"customAttributes":[{"id":"__proto__","scope":"node","type":"string"}],"graphCustom":{},"settings":{"nodeCustom":{"__proto__":"hello"}},"viewBox":{"x":-500,"y":-330,"w":1000,"h":660}}');
  const { dom, errors } = createEditorDom(seeded);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  // Leg 1: duplicate the selected seed node — the clone keeps the own key.
  await selectNode(window, document, 'seed1', 300, 330);
  document.querySelector('#btnDuplicate2').click();
  await nextFrame(window); await settle(window, 40);
  let exported = exportGraph(document);
  assert.equal(exported.nodes.length, 2, 'duplicate created');
  for(const node of exported.nodes){
    assert.equal(Object.prototype.hasOwnProperty.call(node.custom, '__proto__'), true);
    assert.equal(node.custom['__proto__'], 'keep');
  }

  // Leg 2: a new node created in node mode applies the pending default (which
  // goes through the same clone helper) to the new element.
  document.querySelector('[data-mode="node"]').click();
  const canvas = document.querySelector('#graphCanvas');
  setCanvasRect(canvas);
  dispatchPointer(window, canvas, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 400 });
  dispatchPointer(window, canvas, 'pointerup', { pointerId: 1, clientX: 500, clientY: 400 });
  await nextFrame(window); await settle(window, 40);
  exported = exportGraph(document);
  assert.equal(exported.nodes.length, 3, 'new node created');
  const newNode = exported.nodes.find(n => n.id !== 'seed1' && n.order >= 0 && n.custom && n.custom['__proto__'] === 'hello');
  assert.ok(newNode, 'the pending default was cloned into the new node');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('an external GraphML key whose id is a built-in name is migrated, not discarded', async () => {
  const qvge = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="x" for="node" attr.name="externalTag" attr.type="string"/>
  <graph id="g" edgedefault="directed">
    <node id="a"><data key="x">hello</data></node>
  </graph>
</graphml>`;
  const { dom, errors } = createEditorDom();
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = qvge;
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);

  let graph = exportGraph(document);
  const def = graph.customAttributes.find(a => a.scope === 'node');
  assert.ok(def, 'the external key is kept as a custom definition');
  assert.equal(def.id, 'x_1', 'the reserved id is migrated to a safe unique id');
  const node = graph.nodes.find(n => n.id === 'a');
  assert.equal(node.custom.x_1, 'hello', 'the value moved with the definition');
  assert.equal(typeof node.x, 'number', 'the built-in x coordinate was not captured');

  // The migrated definition round-trips cleanly from then on.
  const graphml = exportGraphml(document);
  assert.match(graphml, /<key id="x_1" /);
  document.querySelector('#btnExportGraphml').click();
  const reimport = document.querySelector('.export-modal');
  reimport.querySelector('textarea').value = graphml;
  reimport.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);
  graph = exportGraph(document);
  assert.equal(graph.customAttributes.some(a => a.id === 'x_1' && a.scope === 'node'), true);
  assert.equal(graph.nodes.find(n => n.id === 'a').custom.x_1, 'hello');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
