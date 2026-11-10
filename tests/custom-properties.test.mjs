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
