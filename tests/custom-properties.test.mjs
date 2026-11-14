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
  assert.match(graphml, /<key id="capacity" for="node" attr\.name="capacity" attr\.type="int" qvge:kind="custom-attribute"\/>/);

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

test('more than 200 custom values survive a load (cap matches the definition limit)', async () => {
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
  // The add form likewise accepts built-in-looking ids now: no id is
  // reserved any more (definitions export in their own marked key namespace).
  document.querySelector('#customAttributeId').value = 'posx';
  document.querySelector('#customAttributeScope').value = 'node';
  document.querySelector('#customAttributeType').value = 'string';
  document.querySelector('#btnAddCustomAttribute').click();
  await nextFrame(window);
  assert.equal(exportGraph(document).customAttributes.some(a => a.id === 'posx'), true,
    'built-in-looking ids are allowed — marked keys never alias built-in fields');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a custom id colliding with a built-in name round-trips without touching the node stroke', async () => {
  // A custom attribute whose id spells a built-in field. Ids are kept
  // verbatim; the exporter writes the marked key under the id as-is (it is
  // not a built-in key id) and the value rides along with the definition.
  const doc = {
    title: 'legacy-stroke', mode: 'select', nextNode: 2, nextEdge: 1,
    nodes: [{ id: 'a', label: 'A', x: 0, y: 0, order: 0, strokeColor: '#123456', custom: { 'stroke.color': '#ff0000' } }],
    edges: [],
    customAttributes: [{ id: 'stroke.color', scope: 'node', type: 'string' }],
    graphCustom: {},
    settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const { dom, errors } = createEditorDom(doc);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  // The definition keeps its id, and the value with it.
  let graph = exportGraph(document);
  assert.deepEqual(graph.customAttributes.map(a => a.id), ['stroke.color']);
  assert.equal(graph.nodes.find(n => n.id === 'a').custom['stroke.color'], '#ff0000');

  // Round-trip through the GraphML export and back.
  const graphml = exportGraphml(document);
  assert.match(graphml, /<key id="stroke\.color" /);
  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = graphml;
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);

  graph = exportGraph(document);
  const node = graph.nodes.find(n => n.id === 'a');
  assert.equal(node.strokeColor, '#123456', 'the built-in stroke keeps its own value');
  assert.deepEqual(graph.customAttributes.map(a => a.id), ['stroke.color'], 'the custom definition survives the round-trip');
  assert.equal(node.custom['stroke.color'], '#ff0000');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('case-variant definition ids are kept verbatim, not discarded, on load', async () => {
  const doc = {
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
  const { dom, errors } = createEditorDom(doc);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const graph = exportGraph(document);
  assert.deepEqual(graph.customAttributes.map(a => a.id).sort(), ['Direction', 'FillColor', 'Label'],
    'definition ids are kept exactly as saved');
  assert.equal(graph.graphCustom.Label, 5, 'the graph value stays with its definition');
  assert.equal(graph.nodes.find(n => n.id === 'a').custom.FillColor, 'red');
  assert.equal(graph.edges.find(e => e.id === 'e1').custom.Direction, 9);
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

test('the editor refuses a 2001st definition instead of letting it vanish on reload', async () => {
  const customAttributes = Array.from({ length: 2000 }, (_, i) => ({
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
  assert.equal(exported.customAttributes.length, 2000, 'the cap holds; nothing silently disappears on reload');
  assert.equal(exported.customAttributes.some(a => a.id === 'overflow'), false);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('append-import past the definition cap skips the extra definitions with a toast', async () => {
  const customAttributes = Array.from({ length: 2000 }, (_, i) => ({
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
  assert.equal(exported.customAttributes.length, 2000, 'the imported definitions beyond the cap are skipped');
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

test('saved definitions keep their ids — no id is reserved anywhere', async () => {
  const doc = {
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
  const { dom, errors } = createEditorDom(doc);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const graph = exportGraph(document);
  const ids = graph.customAttributes.map(a => a.id).sort();
  assert.deepEqual(ids, ['Label', 'Label_1', 'Weight', 'Weight_1'],
    'every definition keeps the id it was saved with');
  assert.equal(graph.nodes.find(n => n.id === 'a').custom.Label, 'a');
  assert.equal(graph.nodes.find(n => n.id === 'a').custom.Label_1, 'b');
  assert.equal(graph.graphCustom.Weight, 'x');
  assert.equal(graph.graphCustom.Weight_1, 'y', 'the definitions keep their own values');
  assert.equal(Object.prototype.hasOwnProperty.call(graph.graphCustom, 'Weight_2'), false,
    'an orphan value key with no definition is dropped, not adopted');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('append import counts duplicate definitions for free against capacity', async () => {
  const customAttributes = Array.from({ length: 1999 }, (_, i) => ({
    id: 'attr' + String(i).padStart(4, '0'), scope: 'node', type: 'string',
  }));
  const graph = { ...customPropertiesGraph(), nodes: [], edges: [], customAttributes, graphCustom: {} };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  // attr0000 already exists; extra is new — it fits exactly once (1999 + 1 = 2000).
  const imported = {
    title: 'imported', mode: 'select', nextNode: 1, nextEdge: 1,
    nodes: [{ id: 'app1', label: 'App', x: 100, y: 100, order: 0, custom: { extra: 'kept' } }],
    edges: [],
    customAttributes: [
      { id: 'attr0000', scope: 'node', type: 'string' },
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
  assert.equal(exported.customAttributes.length, 2000);
  assert.equal(exported.customAttributes.some(a => a.id === 'extra'), true,
    'the new definition fits the remaining capacity and is kept');
  assert.equal(exported.nodes.find(n => n.id === 'app1').custom.extra, 'kept',
    'its value survives together with the definition');
  const toastText = [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ');
  assert.doesNotMatch(toastText, /Skipped/, 'nothing was skipped — capacity was used, not duplicates');
  dom.window.close();

  // Genuinely full: the new definition is skipped with a toast.
  const fullAttributes = Array.from({ length: 2000 }, (_, i) => ({
    id: 'attr' + String(i).padStart(4, '0'), scope: 'node', type: 'string',
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
  assert.equal(exported.customAttributes.length, 2000);
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

test('an external GraphML key whose id is a built-in name keeps its id', async () => {
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
  assert.equal(def.id, 'x', 'the id is kept verbatim');
  const node = graph.nodes.find(n => n.id === 'a');
  assert.equal(node.custom.x, 'hello', 'the value binds to the definition');
  assert.equal(typeof node.x, 'number', 'the built-in x coordinate was not captured');

  // The definition exports under a de-collided key id marked back to it.
  const graphml = exportGraphml(document);
  assert.match(graphml, /<key id="x2" for="node" attr\.name="externalTag"[^>]*qvge:id="x"/,
    'the built-in key id is de-collided on export, marked back to the definition');
  document.querySelector('#btnExportGraphml').click();
  const reimport = document.querySelector('.export-modal');
  reimport.querySelector('textarea').value = graphml;
  reimport.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);
  graph = exportGraph(document);
  assert.equal(graph.customAttributes.some(a => a.id === 'x' && a.scope === 'node'), true);
  assert.equal(graph.nodes.find(n => n.id === 'a').custom.x, 'hello');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('pasting into a document without the definitions re-creates them', async () => {
  // Source document: a property and a valued node.
  const source = { ...customPropertiesGraph(),
    nodes: [{ id: 'a', label: 'A', x: -200, y: 0, order: 0, custom: { capacity: 7 } }],
    edges: [], graphCustom: {},
    customAttributes: [{ id: 'capacity', scope: 'node', type: 'int' }],
  };
  const { dom, errors } = createEditorDom(source);
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  let clip = '';
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async t => { clip = t; }, readText: async () => clip },
  });
  await selectNode(window, document, 'a', 300, 330);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
  await nextFrame(window);
  assert.match(clip, /capacity/, 'the clipboard payload carries the definitions');
  dom.window.close();

  // Target document WITHOUT the capacity definition.
  const target = { title: 'target', mode: 'select', nextNode: 2, nextEdge: 1,
    nodes: [], edges: [], customAttributes: [], graphCustom: {}, settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const t2 = createEditorDom(target);
  const t2Window = t2.dom.window; const t2Document = t2Window.document;
  Object.defineProperty(t2Window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => {}, readText: async () => clip },
  });
  await nextFrame(t2Window);
  t2Document.dispatchEvent(new t2Window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
  await nextFrame(t2Window); await settle(t2Window, 60);

  const exported = exportGraph(t2Document);
  assert.equal(exported.customAttributes.some(a => a.id === 'capacity'), true,
    'the definition is re-created on paste');
  assert.equal(exported.nodes.length, 1);
  assert.equal(exported.nodes[0].custom.capacity, 7, 'the value is visible and saved, not stranded');
  const graphml = exportGraphml(t2Document);
  assert.match(graphml, /<key id="capacity"/);
  assert.match(graphml, /<data key="capacity">7<\/data>/);
  t2.dom.window.close();
});

test('pasting keeps an existing same-id definition instead of duplicating it', async () => {
  const source = { ...customPropertiesGraph(),
    nodes: [{ id: 'a', label: 'A', x: -200, y: 0, order: 0, custom: { capacity: 9 } }],
    edges: [], graphCustom: {},
    customAttributes: [{ id: 'capacity', scope: 'node', type: 'int' }],
  };
  const { dom } = createEditorDom(source);
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  let clip = '';
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async t => { clip = t; }, readText: async () => clip },
  });
  await selectNode(window, document, 'a', 300, 330);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
  await nextFrame(window);
  dom.window.close();

  // Target HAS capacity already but as a string-typed definition — the carried
  // value must be coerced to the target definition's type, not create a second def.
  const target = { title: 'target', mode: 'select', nextNode: 2, nextEdge: 1,
    nodes: [], edges: [], graphCustom: {}, settings: {},
    customAttributes: [{ id: 'capacity', scope: 'node', type: 'string' }],
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const t2 = createEditorDom(target);
  const t2Window = t2.dom.window; const t2Document = t2Window.document;
  Object.defineProperty(t2Window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => {}, readText: async () => clip },
  });
  await nextFrame(t2Window);
  t2Document.dispatchEvent(new t2Window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
  await nextFrame(t2Window); await settle(t2Window, 60);
  const exported = exportGraph(t2Document);
  assert.equal(exported.customAttributes.filter(a => a.id === 'capacity').length, 1, 'no duplicate definition');
  assert.equal(exported.customAttributes.find(a => a.id === 'capacity').type, 'string', 'the existing definition wins');
  assert.equal(exported.nodes[0].custom.capacity, '9', 'the carried value is coerced to the existing type');
  t2.dom.window.close();
});

test('matrix-created edges clone custom values (parallel edge and pending defaults)', async () => {
  const graph = { ...customPropertiesGraph(),
    nodes: [
      { id: 'a', label: 'A', x: -200, y: 0, order: 0 },
      { id: 'b', label: 'B', x: 200, y: 0, order: 1 },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'b', directed: true, weight: '1', label: '', type: '', custom: { enabled: true } }],
    customAttributes: [
      { id: 'enabled', scope: 'edge', type: 'boolean' },
      { id: 'voltage', scope: 'edge', type: 'int' },
    ],
    settings: { edgeCustom: { voltage: 7 } },
    graphCustom: {},
  };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window); await settle(window, 90);

  // Cell (a→b) holds the existing edge; typing "1;2" adds a parallel edge.
  const cell = document.querySelector('[data-cell-from="a"][data-cell-to="b"]');
  assert.ok(cell);
  dispatchPointer(window, cell, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 });
  dispatchPointer(window, cell, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 });
  changeValue(window, cell, '1;2');
  await nextFrame(window); await settle(window, 40);

  let exported = exportGraph(document);
  const e1 = exported.edges.find(e => e.weight === '1');
  const parallel = exported.edges.find(e => e.weight === '2');
  assert.ok(parallel, 'the parallel edge was created');
  assert.equal(e1.custom.enabled, true);
  assert.equal(parallel.custom?.enabled, true,
    'the parallel edge clones the template edge\'s custom values');

  // Cell (b→a) is empty; typing a weight creates a brand-new edge with the
  // pending edge defaults applied (as the canvas path does).
  const cellBA = document.querySelector('[data-cell-from="b"][data-cell-to="a"]');
  assert.ok(cellBA);
  dispatchPointer(window, cellBA, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 });
  dispatchPointer(window, cellBA, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 });
  changeValue(window, cellBA, '5');
  await nextFrame(window); await settle(window, 40);

  exported = exportGraph(document);
  const created = exported.edges.find(e => e.weight === '5');
  assert.ok(created, 'the edge was created from the empty cell');
  assert.equal(created.custom?.voltage, 7,
    'a matrix-created edge receives the pending edge custom defaults');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('changing a definition scope warns about and handles stored values', async () => {
  const graph = { ...customPropertiesGraph(),
    nodes: [{ id: 'a', label: 'A', x: -200, y: 0, order: 0, custom: { cap: 'red' } }],
    edges: [],
    customAttributes: [{ id: 'cap', scope: 'node', type: 'string' }],
    settings: { nodeCustom: { cap: 'pending' } },
    graphCustom: {},
  };
  const rowFor = document => [...document.querySelectorAll('.custom-attribute-row')]
    .find(row => row.querySelector('[data-attribute-field="id"]').value === 'cap');

  // Cancel leg: nothing is discarded, the scope stays.
  const cancel = createEditorDom(graph);
  await nextFrame(cancel.dom.window);
  let document = cancel.dom.window.document;
  rowFor(document).querySelector('[data-attribute-field="scope"]').value = 'graph';
  rowFor(document).querySelector('[data-attribute-action="save"]').click();
  await nextFrame(cancel.dom.window); await settle(cancel.dom.window, 30);
  const dialog = document.querySelector('.app-dialog');
  assert.ok(dialog, 'a confirmation dialog is shown for a scope change with values');
  dialog.querySelector('[data-dialog-cancel]').click();
  await nextFrame(cancel.dom.window);
  let exported = exportGraph(document);
  assert.equal(exported.customAttributes.find(a => a.id === 'cap').scope, 'node', 'cancel keeps the scope');
  assert.equal(exported.nodes[0].custom.cap, 'red', 'cancel keeps the values');
  assert.equal(exported.settings.nodeCustom.cap, 'pending', 'cancel keeps the pending default');
  cancel.dom.window.close();

  // Confirm leg: values are discarded explicitly, in one undo step.
  const yes = createEditorDom(graph);
  await nextFrame(yes.dom.window);
  document = yes.dom.window.document;
  rowFor(document).querySelector('[data-attribute-field="scope"]').value = 'graph';
  rowFor(document).querySelector('[data-attribute-action="save"]').click();
  await nextFrame(yes.dom.window); await settle(yes.dom.window, 30);
  document.querySelector('.app-dialog [data-dialog-ok]').click();
  await nextFrame(yes.dom.window);
  exported = exportGraph(document);
  assert.equal(exported.customAttributes.find(a => a.id === 'cap').scope, 'graph');
  assert.equal(exported.nodes[0].custom, undefined, 'the node value is gone (as confirmed)');
  assert.equal(Object.keys(exported.settings.nodeCustom || {}).length, 0, 'the pending default is gone');
  document.querySelector('#btnUndo').click();
  await nextFrame(yes.dom.window); await settle(yes.dom.window, 40);
  exported = exportGraph(document);
  assert.equal(exported.customAttributes.find(a => a.id === 'cap').scope, 'node', 'undo restores the scope');
  assert.equal(exported.nodes[0].custom.cap, 'red', 'undo restores the values');
  assert.equal(exported.settings.nodeCustom.cap, 'pending', 'undo restores the pending default');
  yes.dom.window.close();

  // graph -> node: the graph value is promoted to every entity (lossless), no dialog.
  const promote = createEditorDom({ ...graph,
    nodes: [
      { id: 'a', label: 'A', x: -200, y: 0, order: 0 },
      { id: 'b', label: 'B', x: 200, y: 0, order: 1 },
    ],
    edges: [],
    customAttributes: [{ id: 'shared', scope: 'graph', type: 'int' }],
    settings: {},
    graphCustom: { shared: 5 },
  });
  await nextFrame(promote.dom.window);
  document = promote.dom.window.document;
  const promoteRow = [...document.querySelectorAll('.custom-attribute-row')]
    .find(row => row.querySelector('[data-attribute-field="id"]').value === 'shared');
  promoteRow.querySelector('[data-attribute-field="scope"]').value = 'node';
  promoteRow.querySelector('[data-attribute-action="save"]').click();
  await nextFrame(promote.dom.window); await settle(promote.dom.window, 30);
  assert.equal(document.querySelector('.app-dialog'), null, 'no confirmation needed for the lossless direction');
  exported = exportGraph(document);
  assert.equal(exported.customAttributes.find(a => a.id === 'shared').scope, 'node');
  assert.equal(exported.nodes.every(n => n.custom && n.custom.shared === 5), true,
    'the graph value was promoted to every node');
  assert.equal(exported.graphCustom.shared, undefined, 'the graph value moved, not copied');
  promote.dom.window.close();
});

test('repeated GraphML appends of the same external key resolve to one definition', async () => {
  const external = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="x" for="node" attr.name="externalTag" attr.type="int"/>
  <graph id="g" edgedefault="directed">
    <node id="a"><data key="x">7</data></node>
  </graph>
</graphml>`;
  const { dom, errors } = createEditorDom();
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  for(let round = 0; round < 3; round++){
    document.querySelector('#btnExportGraphml').click();
    const modal = document.querySelector('.export-modal');
    modal.querySelector('textarea').value = external;
    const appendChk = modal.querySelector('#expAppendChk');
    if(!appendChk.checked) appendChk.click();
    modal.querySelector('#expImportBtn').click();
    await nextFrame(window); await settle(window, 50);
    modal.remove();
  }
  const exported = exportGraph(document);
  const matches = exported.customAttributes.filter(a => a.id === 'x');
  assert.equal(matches.length, 1, 'one definition, not a new one per import');
  assert.equal(matches[0].name, 'externalTag', 'provenance recorded for reuse');
  for(const node of exported.nodes){
    assert.equal(node.custom.x, 7, 'every node carries the value under the same definition');
  }
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('appending a GraphML file never overwrites an unrelated property', async () => {
  const external = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="x" for="graph" attr.name="externalTag" attr.type="string"/>
  <key id="directed" for="node" attr.name="externalFlag" attr.type="boolean"/>
  <graph id="g" edgedefault="directed">
    <data key="x">fresh</data>
    <node id="imp"><data key="directed">true</data></node>
  </graph>
</graphml>`;
  const seed = { ...customPropertiesGraph(),
    nodes: [{ id: 'seed', label: 'S', x: 0, y: 0, order: 0, custom: { directed_1: true } }],
    edges: [],
    graphCustom: { x_1: 'keep' },
    customAttributes: [
      { id: 'x_1', scope: 'graph', type: 'string' },
      { id: 'directed_1', scope: 'node', type: 'boolean' },
    ],
    settings: {},
  };
  const { dom, errors } = createEditorDom(seed);
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  const appendOnce = async () => {
    document.querySelector('#btnExportGraphml').click();
    const modal = document.querySelector('.export-modal');
    modal.querySelector('textarea').value = external;
    const appendChk = modal.querySelector('#expAppendChk');
    if(!appendChk.checked) appendChk.click();
    modal.querySelector('#expImportBtn').click();
    await nextFrame(window); await settle(window, 50);
    modal.remove();
  };
  await appendOnce();
  let exported = exportGraph(document);
  assert.equal(exported.graphCustom.x_1, 'keep',
    'the unrelated x_1 graph value survives the append');
  const freshGraph = exported.customAttributes.find(a => a.id === 'x');
  assert.ok(freshGraph, 'the incoming key gets its own definition');
  assert.equal(freshGraph.name, 'externalTag', 'provenance is recorded');
  assert.equal(exported.graphCustom.x, 'fresh', 'the imported value lands on the imported definition');
  const freshNode = exported.customAttributes.find(a => a.id === 'directed');
  assert.ok(freshNode, 'the incoming node key gets its own definition');
  assert.equal(freshNode.name, 'externalFlag');
  const importedNode = exported.nodes.find(n => n.id === 'imp');
  assert.ok(importedNode);
  assert.equal(importedNode.custom.directed, true);
  assert.equal(exported.nodes.find(n => n.id === 'seed').custom.directed_1, true,
    'the unrelated directed_1 definition and value are untouched');

  // Re-appending the same file merges into the same definitions instead of minting new ones.
  await appendOnce();
  exported = exportGraph(document);
  assert.equal(exported.customAttributes.filter(a => a.id === 'x').length, 1);
  assert.equal(exported.customAttributes.filter(a => a.id === 'directed').length, 1);
  assert.equal(exported.graphCustom.x_1, 'keep');
  assert.equal(exported.graphCustom.x, 'fresh');
  assert.equal(exported.nodes.find(n => n.id === 'seed').custom.directed_1, true);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('pasting values into a document where the id is used by another scope renames the carried definition', async () => {
  const source = { ...customPropertiesGraph(),
    nodes: [{ id: 'a', label: 'A', x: -200, y: 0, order: 0, custom: { tag: 'yes' } }],
    edges: [], graphCustom: {},
    customAttributes: [{ id: 'tag', scope: 'node', type: 'string' }],
  };
  const { dom } = createEditorDom(source);
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  let clip = '';
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async t => { clip = t; }, readText: async () => clip },
  });
  await selectNode(window, document, 'a', 300, 330);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
  await nextFrame(window);
  dom.window.close();

  // Target has "tag" as a GRAPH-scope definition — a node value under that id
  // would be invisible and omitted from GraphML, so paste must rename it.
  const target = { title: 'target', mode: 'select', nextNode: 2, nextEdge: 1,
    nodes: [], edges: [], graphCustom: { tag: 'graphval' }, settings: {},
    customAttributes: [{ id: 'tag', scope: 'graph', type: 'string' }],
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const t2 = createEditorDom(target);
  const t2Window = t2.dom.window; const t2Document = t2Window.document;
  Object.defineProperty(t2Window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => {}, readText: async () => clip },
  });
  await nextFrame(t2Window);
  t2Document.dispatchEvent(new t2Window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
  await nextFrame(t2Window); await settle(t2Window, 60);

  assert.match(t2Document.querySelector('#toastStack')?.textContent || '', /renamed/i,
    'the rename is announced, not silent');
  const exported = exportGraph(t2Document);
  const graphDef = exported.customAttributes.find(a => a.id === 'tag');
  assert.equal(graphDef.scope, 'graph', 'the existing definition keeps its scope');
  const renamed = exported.customAttributes.find(a => a.scope === 'node');
  assert.ok(renamed, 'a node-scope definition is created for the pasted values');
  assert.notEqual(renamed.id, 'tag');
  const pasted = exported.nodes[0];
  assert.equal(pasted.custom[renamed.id], 'yes', 'the value moved to the renamed definition');
  assert.equal(pasted.custom.tag, undefined, 'nothing is stranded under the graph-scoped id');
  assert.equal(exported.graphCustom.tag, 'graphval', 'the graph value is untouched');
  const graphml = exportGraphml(t2Document);
  assert.match(graphml, new RegExp('<key id="' + renamed.id + '" for="node"'));
  assert.match(graphml, new RegExp('<data key="' + renamed.id + '">yes</data>'));
  t2.dom.window.close();
});

test('pasting starts from the copied originals — the internal clipboard is never coerced in place', async () => {
  const graph = { ...customPropertiesGraph(),
    nodes: [{ id: 'a', label: 'A', x: -200, y: 0, order: 0, custom: { tag: 'no' } }],
    edges: [], graphCustom: {},
    customAttributes: [{ id: 'tag', scope: 'node', type: 'string' }],
  };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  await selectNode(window, document, 'a', 300, 330);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
  await nextFrame(window);
  const rowFor = () => [...document.querySelectorAll('.custom-attribute-row')]
    .find(row => row.querySelector('[data-attribute-field="id"]').value === 'tag');
  const setType = async type => {
    rowFor().querySelector('[data-attribute-field="type"]').value = type;
    rowFor().querySelector('[data-attribute-action="save"]').click();
    await nextFrame(window); await settle(window, 40);
  };
  // Flip the definition to boolean — the stored values migrate ('no' -> false).
  await setType('boolean');
  // Paste — the carried 'no' coerces to false; the clipboard itself must not change.
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
  await nextFrame(window); await settle(window, 60);
  // Flip the definition back to string — stored values migrate (false -> 'false').
  await setType('string');
  // Paste again — a pristine clipboard must yield 'no', not a previously coerced 'false'.
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
  await nextFrame(window); await settle(window, 60);

  const exported = exportGraph(document);
  const restored = exported.nodes.filter(n => n.custom && n.custom.tag === 'no');
  assert.equal(restored.length, 1, 'the second paste carries the original copied value');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

const appendGraphmlFile = async (document, window, text, append = true) => {
  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = text;
  const chk = modal.querySelector('#expAppendChk');
  if(Boolean(chk.checked) !== append) chk.click();
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 50);
  modal.remove();
};

test('GraphML keys sharing a raw id in two files get distinct definitions', async () => {
  const file1 = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="x" for="graph" attr.name="colour" attr.type="string"/>
  <graph id="g" edgedefault="directed">
    <data key="x">red</data>
    <node id="a"/>
  </graph>
</graphml>`;
  const file2 = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="x" for="graph" attr.name="owner" attr.type="string"/>
  <graph id="g" edgedefault="directed">
    <data key="x">bob</data>
    <node id="b"/>
  </graph>
</graphml>`;
  const { dom, errors } = createEditorDom();
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  await appendGraphmlFile(document, window, file1);
  await appendGraphmlFile(document, window, file2);
  const exported = exportGraph(document);
  const colour = exported.customAttributes.find(a => a.name === 'colour');
  const owner = exported.customAttributes.find(a => a.name === 'owner');
  assert.ok(colour, 'the colour property is kept');
  assert.ok(owner, 'the owner property of the same raw key id gets its own definition');
  assert.notEqual(colour.id, owner.id);
  assert.equal(exported.graphCustom[colour.id], 'red');
  assert.equal(exported.graphCustom[owner.id], 'bob', 'the second property does not overwrite the first');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a key id the incoming file uses is never handed out to another definition', async () => {
  const file1 = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="x" for="graph" attr.name="externalTag" attr.type="string"/>
  <graph id="g" edgedefault="directed">
    <data key="x">original</data>
    <node id="a"/>
  </graph>
</graphml>`;
  const file2 = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="x" for="graph" attr.name="externalTag" attr.type="string"/>
  <key id="x_1" for="graph" attr.name="other" attr.type="string"/>
  <graph id="g" edgedefault="directed">
    <data key="x">second</data>
    <data key="x_1">other-value</data>
    <node id="b"/>
  </graph>
</graphml>`;
  const { dom, errors } = createEditorDom();
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  await appendGraphmlFile(document, window, file1);
  let exported = exportGraph(document);
  assert.equal(exported.graphCustom.x, 'original', 'the imported definition keeps its id verbatim');
  // The same property re-imported merges (newer data wins); the file's own
  // key x_1 is a different property and keeps its id verbatim too.
  await appendGraphmlFile(document, window, file2);
  exported = exportGraph(document);
  const other = exported.customAttributes.find(a => a.id === 'x_1');
  assert.ok(other, 'the file’s own x_1 key becomes its own definition');
  assert.equal(other.name, 'other');
  assert.equal(exported.graphCustom.x_1, 'other-value', 'the file’s x_1 value lands on the file’s definition');
  assert.equal(exported.graphCustom.x, 'second', 'the same property re-imported takes the newer value');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('recorded provenance survives a GraphML export/reopen cycle and definition edits', async () => {
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="x" for="graph" attr.name="externalTag" attr.type="string"/>
  <graph id="g" edgedefault="directed">
    <data key="x">original</data>
    <node id="a"/>
  </graph>
</graphml>`;
  const { dom, errors } = createEditorDom();
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  await appendGraphmlFile(document, window, source);
  let exported = exportGraph(document);
  assert.equal(exported.customAttributes.find(a => a.name === 'externalTag').id, 'x');

  // Export → reopen (replace mode) loses nothing: provenance travels in the GraphML.
  const graphml = exportGraphml(document);
  assert.match(graphml, /attr\.name="externalTag"/, 'the exported key records the property name');
  await appendGraphmlFile(document, window, graphml, false);
  exported = exportGraph(document);
  const reopened = exported.customAttributes.find(a => a.name === 'externalTag');
  assert.ok(reopened, 'provenance is restored when the exported GraphML is reopened');
  assert.equal(reopened.id, 'x', 'the definition round-trips under its own id');
  // Appending the original source again merges into the same definition.
  await appendGraphmlFile(document, window, source);
  exported = exportGraph(document);
  assert.deepEqual(exported.customAttributes.filter(a => a.name === 'externalTag').map(a => a.id), ['x']);

  // Editing the definition keeps the recorded name.
  const row = () => [...document.querySelectorAll('.custom-attribute-row')]
    .find(r => r.querySelector('[data-attribute-field="id"]').value === 'x');
  row().querySelector('[data-attribute-field="type"]').value = 'long';
  row().querySelector('[data-attribute-action="save"]').click();
  await nextFrame(window); await settle(window, 40);
  await appendGraphmlFile(document, window, source);
  exported = exportGraph(document);
  assert.deepEqual(exported.customAttributes.filter(a => a.name === 'externalTag').map(a => a.id), ['x']);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('repeated pastes reuse the definition renamed for a scope conflict instead of splitting it', async () => {
  const source = { ...customPropertiesGraph(),
    nodes: [{ id: 'a', label: 'A', x: -200, y: 0, order: 0, custom: { tag: 'yes' } }],
    edges: [], graphCustom: {},
    customAttributes: [{ id: 'tag', scope: 'node', type: 'string' }],
  };
  const { dom } = createEditorDom(source);
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  let clip = '';
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async t => { clip = t; }, readText: async () => clip },
  });
  await selectNode(window, document, 'a', 300, 330);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
  await nextFrame(window);
  dom.window.close();

  const target = { title: 'target', mode: 'select', nextNode: 2, nextEdge: 1,
    nodes: [], edges: [], graphCustom: { tag: 'graphval' }, settings: {},
    customAttributes: [{ id: 'tag', scope: 'graph', type: 'string' }],
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const t2 = createEditorDom(target);
  const t2Window = t2.dom.window; const t2Document = t2Window.document;
  Object.defineProperty(t2Window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => {}, readText: async () => clip },
  });
  await nextFrame(t2Window);
  for(let round = 0; round < 2; round++){
    t2Document.dispatchEvent(new t2Window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
    await nextFrame(t2Window); await settle(t2Window, 60);
  }
  const exported = exportGraph(t2Document);
  assert.equal(exported.customAttributes.filter(a => a.scope === 'node').length, 1,
    'the scope conflict created exactly one node-scope definition');
  assert.equal(exported.customAttributes.some(a => a.id === 'tag_2'), false, 'no split definition on the second paste');
  const renamed = exported.customAttributes.find(a => a.scope === 'node');
  assert.equal(exported.nodes.length, 2);
  assert.ok(exported.nodes.every(n => n.custom[renamed.id] === 'yes'));
  assert.equal(exported.graphCustom.tag, 'graphval');
  t2.dom.window.close();
});

test('a fractional value typed into an integer-typed field is stored verbatim, never silently truncated', async () => {
  const { dom, errors } = createEditorDom(customPropertiesGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  await selectNode(window, document, 'a', 300, 330);
  const capacity = document.querySelector('#selectionPanel [data-custom-attribute="capacity"]');
  changeValue(window, capacity, '7.5');
  await nextFrame(window);
  const graph = exportGraph(document);
  assert.equal(graph.nodes.find(n => n.id === 'a')?.custom?.capacity, '7.5', 'the stated fraction is stored verbatim');
  assert.equal(document.querySelector('#selectionPanel [data-custom-attribute="capacity"]').value, '7.5');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('the integer-typed field resyncs to the stored value after commit (042 commits to 42)', async () => {
  const { dom, errors } = createEditorDom(customPropertiesGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  await selectNode(window, document, 'a', 300, 330);
  const capacity = document.querySelector('#selectionPanel [data-custom-attribute="capacity"]');
  changeValue(window, capacity, '042');
  await nextFrame(window);
  assert.equal(document.querySelector('#selectionPanel [data-custom-attribute="capacity"]').value, '42', 'the field shows the stored value, not the typed text');
  const graph = exportGraph(document);
  assert.equal(graph.nodes.find(n => n.id === 'a')?.custom?.capacity, 42, 'the stored value is the integer 42');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('an appended graph property with a different origin cannot overwrite the existing graph value', async () => {
  // Identity of a definition across imports is the recorded origin. An
  // incoming graph property sharing the id AND the name but recording a
  // different origin is a different property: it must mint its own
  // definition, never merge onto the existing one and overwrite its value.
  const graph = { ...customPropertiesGraph(),
    customAttributes: [{ id: 'capacity', scope: 'graph', type: 'int', name: 'capacity', origin: 'capkey' }],
    graphCustom: { capacity: 100 },
  };
  const { dom, errors } = createEditorDom(graph);
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  const appended = {
    title: 'appended', mode: 'select', nextNode: 1, nextEdge: 1,
    nodes: [{ id: 'app1', label: 'App', x: 400, y: 200, order: 2 }],
    edges: [],
    customAttributes: [{ id: 'capacity', scope: 'graph', type: 'int', name: 'capacity', origin: 'env_9' }],
    graphCustom: { capacity: 999 },
    settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  document.querySelector('#btnExportJson').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = JSON.stringify(appended);
  modal.querySelector('#expAppendChk').click();
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);

  const out = exportGraph(document);
  assert.equal(out.graphCustom.capacity, 100, 'the existing property keeps its graph value');
  const minted = (out.customAttributes || []).filter(a => a.id !== 'capacity' && String(a.origin) === 'env_9');
  assert.equal(minted.length, 1, 'the incoming property mints its own definition');
  assert.equal(out.graphCustom[minted[0].id], 999, 'its value binds to the new definition');
  assert.equal(out.customAttributes.filter(a => a.id === 'capacity').length, 1, 'the original definition is untouched');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('two distinct same-name properties cannot both claim one all-scope definition on paste', async () => {
  // A hand-built clipboard payload: one node carrying TWO custom keys
  // ('metric' and 'load'). Both definitions are named 'metric' and recorded
  // with the same origin — two distinct properties (different key ids), one
  // document-wide definition 'allMetric' that matches either of them by
  // identity. A definition can be claimed at most once per paste; the second
  // must not also resolve to it — otherwise both value keys remap onto
  // 'allMetric' and the second assignment overwrites the first.
  const payload = {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'a', label: 'A', x: -200, y: 0, order: 0, custom: { metric: 'val-metric', load: 'val-load' } }],
    edges: [],
    externalEdges: [],
    customAttributes: [
      { id: 'metric', scope: 'node', type: 'string', name: 'metric', origin: 'env' },
      { id: 'load', scope: 'node', type: 'string', name: 'metric', origin: 'env' },
    ],
  };
  const target = { title: 'target', mode: 'select', nextNode: 1, nextEdge: 1,
    nodes: [], edges: [],
    customAttributes: [{ id: 'allMetric', scope: 'all', type: 'string', name: 'metric', origin: 'env' }],
    graphCustom: {}, settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const { dom, errors } = createEditorDom(target);
  const { window } = dom; const { document } = window;
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => {}, readText: async () => JSON.stringify(payload) },
  });
  await nextFrame(window);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
  await nextFrame(window); await settle(window, 60);

  const exported = exportGraph(document);
  const node = exported.nodes[0];
  const defs = exported.customAttributes || [];
  assert.equal(node.custom.allMetric, 'val-metric', 'the first property keeps its value on the shared definition');
  assert.equal(node.custom.load, 'val-load', 'the second property keeps its value under its own key');
  assert.ok(defs.some(a => a.scope === 'all' && a.id === 'allMetric'), 'the shared definition survives');
  assert.ok(defs.some(a => a.id === 'load' && a.scope === 'node'), 'the second property is defined on its own id');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a pasted definition with a conflicting recorded origin cannot merge into the same-id definition', async () => {
  // The document records its 'metric' definition with origin 'a' (created by
  // an earlier import of key a). The clipboard carries a node property
  // 'metric' recorded with origin 'b' — a different property that merely
  // shares the id. The exact-pair merge must refuse to bind them: one claim
  // for a different property would put both unrelated values under one
  // definition.
  const payload = {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'p1', label: 'Carried', x: 0, y: 0, order: 0, custom: { metric: 'from-b' } }],
    edges: [],
    externalEdges: [],
    customAttributes: [{ id: 'metric', scope: 'node', type: 'string', origin: 'b' }],
  };
  const target = { title: 'target', mode: 'select', nextNode: 2, nextEdge: 1,
    nodes: [{ id: 'keep', label: 'Keep', x: 50, y: 0, order: 0, custom: { metric: 'from-a' } }],
    edges: [],
    customAttributes: [{ id: 'metric', scope: 'node', type: 'string', origin: 'a' }],
    graphCustom: {}, settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const { dom, errors } = createEditorDom(target);
  const { window } = dom; const { document } = window;
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => {}, readText: async () => JSON.stringify(payload) },
  });
  await nextFrame(window);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
  await nextFrame(window); await settle(window, 60);

  const graph = exportGraph(document);
  assert.equal(graph.customAttributes.filter(d => d.id === 'metric' && d.origin === 'a').length, 1,
    'the document keeps its origin-a definition');
  const minted = graph.customAttributes.find(d => d.origin === 'b');
  assert.ok(minted, 'the origin-b property is re-created as its own definition');
  assert.notEqual(minted.id, 'metric', 'minted under a fresh id, never the taken one');
  const pasted = graph.nodes.find(n => n.label === 'Carried');
  assert.equal(pasted.custom?.[minted.id], 'from-b', 'the carried value binds the minted definition');
  assert.equal(pasted.custom?.metric, undefined, 'and never the origin-a definition');
  assert.equal(graph.nodes.find(n => n.id === 'keep')?.custom?.metric, 'from-a',
    'the pre-existing values stay on the origin-a definition');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a carried narrower pair with a conflicting origin cannot merge into the covering all-scope definition', async () => {
  // Same identity question as the exact-pair branch, one level up: an
  // all-scope definition is the document's definition for this id on every
  // scope — but only when the two recorded origins allow it. A carried
  // node-scope 'metric' from origin 'b' must not bind the all-scope 'metric'
  // from origin 'a'; it mints its own per-scope definition instead.
  const payload = {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'p1', label: 'Carried', x: 0, y: 0, order: 0, custom: { metric: 'from-b' } }],
    edges: [],
    externalEdges: [],
    customAttributes: [{ id: 'metric', scope: 'node', type: 'string', origin: 'b' }],
  };
  const target = { title: 'target', mode: 'select', nextNode: 1, nextEdge: 1,
    nodes: [], edges: [],
    customAttributes: [{ id: 'metric', scope: 'all', type: 'string', origin: 'a' }],
    graphCustom: {}, settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const { dom, errors } = createEditorDom(target);
  const { window } = dom; const { document } = window;
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => {}, readText: async () => JSON.stringify(payload) },
  });
  await nextFrame(window);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
  await nextFrame(window); await settle(window, 60);

  const graph = exportGraph(document);
  const allDef = graph.customAttributes.find(d => d.scope === 'all');
  assert.equal(allDef?.origin, 'a', 'the all-scope definition stays the origin-a property');
  const minted = graph.customAttributes.find(d => d.origin === 'b');
  assert.ok(minted, 'the origin-b property is re-created as its own definition');
  const pasted = graph.nodes.find(n => n.label === 'Carried');
  assert.equal(pasted.custom?.[minted.id], 'from-b', 'the carried value binds the minted definition');
  assert.equal(pasted.custom?.metric, undefined, 'and never the origin-a all-scope definition');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('graph property controls rebuild when a same-shaped import changes the values', async () => {
  // The custom-property section cache keys on a signature of the stored
  // values. Plain 'key=value;' concatenation made {a: "x;b=y"} and
  // {a: "x", b: "y"} hash alike, so a replace-import kept the cached section
  // showing the previous document's controls (a = "x;b=y", b blank) although
  // the imported state held a = "x" and b = "y".
  const defs = [
    { id: 'a', scope: 'graph', type: 'string' },
    { id: 'b', scope: 'graph', type: 'string' },
  ];
  const saved = { title: 'sig', mode: 'select', nextNode: 1, nextEdge: 1,
    nodes: [], edges: [],
    customAttributes: defs,
    graphCustom: { a: 'x;b=y' }, settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
  const { dom, errors } = createEditorDom(saved);
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  const aValue = () => document.querySelector('#graphCustomProps [data-custom-attribute="a"]')?.value;
  const bValue = () => document.querySelector('#graphCustomProps [data-custom-attribute="b"]')?.value;
  assert.equal(aValue(), 'x;b=y', 'the host renders the current values');
  assert.equal(bValue(), '');

  document.querySelector('#btnExportJson').click();
  const modal = document.querySelector('.export-modal');
  modal.querySelector('textarea').value = JSON.stringify({
    title: 'sig', mode: 'select', nextNode: 1, nextEdge: 1,
    nodes: [], edges: [],
    customAttributes: defs,
    graphCustom: { a: 'x', b: 'y' }, settings: {},
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  });
  modal.querySelector('#expImportBtn').click();
  await nextFrame(window); await settle(window, 60);

  assert.equal(aValue(), 'x', 'the a control shows the imported value');
  assert.equal(bValue(), 'y', 'the b control shows the imported value');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});