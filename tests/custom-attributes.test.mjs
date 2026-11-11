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
      window.matchMedia = () => ({matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}});
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => null;
      window.URL.createObjectURL = () => 'blob:offline-test';
      window.URL.revokeObjectURL = () => {};
      Object.defineProperty(window.navigator, 'clipboard', {configurable:true, value:{writeText:async()=>{}, readText:async()=>''}});
    },
  });
  return {dom, errors};
}

test('custom GraphML attributes support add, edit, delete, undo and GraphML round-trip', async () => {
  const {dom, errors} = createEditorDom();
  const {document, Event} = dom.window;
  const id = document.querySelector('#customAttributeId');
  const scope = document.querySelector('#customAttributeScope');
  const type = document.querySelector('#customAttributeType');
  id.value = 'capacity'; scope.value = 'edge'; type.value = 'int';
  document.querySelector('#btnAddCustomAttribute').click();
  assert.equal(document.querySelectorAll('.custom-attribute-row').length, 1);
  assert.equal(document.querySelector('.custom-attribute-row [data-attribute-field="id"]').value, 'capacity');

  const row = document.querySelector('.custom-attribute-row');
  row.querySelector('[data-attribute-field="id"]').value = 'max capacity';
  row.querySelector('[data-attribute-field="scope"]').value = 'graph';
  row.querySelector('[data-attribute-field="type"]').value = 'double';
  row.querySelector('[data-attribute-action="save"]').click();
  assert.equal(document.querySelector('.custom-attribute-row [data-attribute-field="id"]').value, 'max capacity');
  document.querySelector('#btnUndo').click();
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  assert.equal(document.querySelector('.custom-attribute-row [data-attribute-field="id"]').value, 'capacity', 'undo restores the previous definition');
  document.querySelector('#btnRedo').click();
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  assert.equal(document.querySelector('.custom-attribute-row [data-attribute-field="id"]').value, 'max capacity', 'redo restores the edit');

  document.querySelector('#btnExportGraphml').click();
  const graphml = document.querySelector('.export-modal textarea').value;
  assert.match(graphml, /<key id="max capacity" for="graph" attr\.name="max capacity" attr\.type="double"\/>/);
  document.querySelector('#expCloseBtn').click();

  // Import the generated GraphML and ensure the definition is retained.
  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  const exportedText = modal.querySelector('textarea').value;
  modal.remove();
  document.querySelector('#btnExportGraphml').click();
  document.querySelector('.export-modal textarea').value = exportedText;
  document.querySelector('#expImportBtn').click();
  assert.equal(document.querySelector('.custom-attribute-row [data-attribute-field="id"]')?.value, 'max capacity');

  document.querySelector('[data-attribute-action="delete"]').click();
  assert.equal(document.querySelectorAll('.custom-attribute-row').length, 0);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('custom attribute IDs are required and unique', async () => {
  const {dom} = createEditorDom();
  const {document} = dom.window;
  const id = document.querySelector('#customAttributeId');
  document.querySelector('#btnAddCustomAttribute').click();
  assert.equal(document.querySelectorAll('.custom-attribute-row').length, 0, 'blank IDs are rejected');
  id.value = 'tag'; document.querySelector('#btnAddCustomAttribute').click();
  id.value = 'tag'; document.querySelector('#btnAddCustomAttribute').click();
  assert.equal(document.querySelectorAll('.custom-attribute-row').length, 1, 'duplicate IDs are rejected');
  dom.window.close();
});

test('a saved definition keeps its id, even when it looks like a built-in', async () => {
  // The editor refuses to create a reserved id, so a document carrying one was
  // hand-written or written by an older build. Renaming it to `direction2` would
  // silently change the user's property; keeping it costs nothing, and the
  // GraphML exporter already renames colliding ids on the way out.
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0}], edges: [],
    customAttributes: [
      {id:'direction', scope:'edge', type:'string'},
      {id:'edgeArrowSize', scope:'edge', type:'double'},
      {id:'capacity', scope:'edge', type:'int'},
    ],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids, ['direction', 'edgeArrowSize', 'capacity'], 'every definition keeps its id');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('duplicate saved definition ids are collapsed to one', async () => {
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0}], edges: [],
    customAttributes: [
      {id:'capacity', scope:'edge', type:'int'},
      {id:'capacity', scope:'node', type:'string'},
    ],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids, ['capacity'], 'one definition survives, ids stay unique');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a definition cannot take an id the exporter already writes for that scope', async () => {
  const {dom} = createEditorDom();
  const {document} = dom.window;
  const add = (id, scope) => {
    document.querySelector('#customAttributeId').value = id;
    document.querySelector('#customAttributeScope').value = scope;
    document.querySelector('#btnAddCustomAttribute').click();
  };
  // Reserved: this scope's own key id -> the importer would read the built-in
  // field and the definition could never come back.
  for(const [id, scope] of [['direction','edge'], ['arrowSize','edge'], ['weight','edge'], ['label','node']]){
    add(id, scope);
    assert.equal(document.querySelectorAll('.custom-attribute-row').length, 0, `${id} on ${scope} is rejected`);
  }
  // Not reserved: the same id on a scope whose key table has no such id, and an
  // id the exporter never writes. Both round-trip, so both are allowed.
  add('weight', 'node');
  add('edgeArrowSize', 'edge');
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids, ['weight', 'edgeArrowSize'], 'only ids that collide with this scope are refused');
  dom.window.close();
});

test('editing a custom definition keeps its id, and migrated names survive reload', async () => {
  // Resolution must not reshape an id that is already usable, or editing a
  // definition would silently move it (capacity -> capacity2) and the same
  // document would import differently on every load.
  {
    const {dom} = createEditorDom();
    const {document} = dom.window;
    document.querySelector('#customAttributeId').value = 'capacity';
    document.querySelector('#btnAddCustomAttribute').click();
    const row = document.querySelector('.custom-attribute-row');
    row.querySelector('[data-attribute-field="scope"]').value = 'graph';
    row.querySelector('[data-attribute-field="type"]').value = 'double';
    row.querySelector('[data-attribute-action="save"]').click();
    const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
    assert.deepEqual(ids, ['capacity'], 'the id is unchanged by an unrelated edit');
    assert.equal(document.querySelector('[data-attribute-field="scope"]').value, 'graph');
    assert.equal(document.querySelector('[data-attribute-field="type"]').value, 'double');
    dom.window.close();
  }

  // A definition renamed away from a reserved id keeps its external attr.name
  // through autosave and the next load, so exporting it again is lossless.
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0}], edges: [],
    customAttributes: [{id:'externaltag', scope:'node', type:'string', name:'externaltag'}],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids, ['externaltag'], 'a migrated definition keeps its id across reloads');
  document.querySelector('#btnExportGraphml').click();
  const graphml = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  assert.match(graphml, /<key id="externaltag"[^>]*attr\.name="externaltag"/, 'and still exports its own attr.name');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('editing a migrated definition keeps the GraphML attr.name it came with', async () => {
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0}], edges: [],
    customAttributes: [{id:'externaltag', scope:'node', type:'string', name:'externalTag'}],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  const row = document.querySelector('.custom-attribute-row');
  row.querySelector('[data-attribute-field="type"]').value = 'double';
  row.querySelector('[data-attribute-action="save"]').click();
  document.querySelector('#btnExportGraphml').click();
  const graphml = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  assert.match(graphml, /<key id="externaltag"[^>]*attr\.name="externalTag" attr\.type="double"/,
    'an unrelated edit does not rename the key back to its custom id');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('renaming a definition drops the attr.name that belonged to the old key', async () => {
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0}], edges: [],
    customAttributes: [{id:'externaltag', scope:'node', type:'string', name:'externalTag'}],
  };
  const {dom} = createEditorDom(saved);
  const {document} = dom.window;
  const row = document.querySelector('.custom-attribute-row');
  row.querySelector('[data-attribute-field="id"]').value = 'renamed';
  row.querySelector('[data-attribute-action="save"]').click();
  document.querySelector('#btnExportGraphml').click();
  const graphml = document.querySelector('.export-modal textarea').value;
  assert.match(graphml, /<key id="renamed"[^>]*attr\.name="renamed"/, 'the new id is the key name');
  assert.ok(!graphml.includes('externalTag'), 'the stale name is gone');
  dom.window.close();
});

test('a preserved GraphML attr.name keeps its original case through export', async () => {
  // Case matters to other GraphML consumers, so lowercasing on import would
  // change the property's meaning on the next export.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="k" for="node" attr.name="MiXeDCase" attr.type="string"/>',
    '  <graph edgedefault="directed"><node id="n1"/></graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await new Promise(resolve => dom.window.setTimeout(resolve, 40));
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true, value: {writeText: async () => {}, readText: async () => graphml},
  });
  document.querySelector('#btnPasteGraphml').click();
  await new Promise(resolve => dom.window.setTimeout(resolve, 120));

  document.querySelector('#btnExportGraphml').click();
  const exported = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  assert.match(exported, /<key id="k"[^>]*attr\.name="MiXeDCase"/, 'the exact spelling is re-emitted');
  assert.ok(!/attr\.name="mixedcase"/.test(exported), 'the name is not lowercased');

  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
