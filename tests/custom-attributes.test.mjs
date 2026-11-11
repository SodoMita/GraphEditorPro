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

test('legacy custom definitions using direction/arrowSize ids are migrated, not discarded', async () => {
  // `direction`, `arrowSize` and `edgeArrowSize` only became built-in GraphML
  // keys after custom attributes shipped, so an existing document can hold a
  // definition under one of them. The sanitizer used to drop those silently.
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0, order:0}],
    edges: [],
    customAttributes: [
      {id:'direction', scope:'edge', type:'string'},
      {id:'edgeArrowSize', scope:'edge', type:'double'},
      {id:'capacity', scope:'edge', type:'int'},
    ],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.equal(ids.length, 3, 'no definition is lost on load');
  assert.equal(new Set(ids).size, 3, 'migrated ids stay unique');
  assert.ok(ids.includes('capacity'), 'a non-reserved id is untouched');
  assert.ok(!ids.includes('direction') && !ids.includes('edgeArrowSize'), 'built-in ids are vacated');
  assert.ok(ids.includes('direction2') && ids.includes('edgeArrowSize2'), 'each legacy id gets a numbered successor');

  // The migrated definitions export under their new ids and come back.
  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  const graphml = modal.querySelector('textarea').value;
  modal.remove();
  const keyIds = [...graphml.matchAll(/<key id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(keyIds).size, keyIds.length, 'exported key ids stay unique');
  assert.ok(keyIds.includes('direction2') && keyIds.includes('capacity'));
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a legacy reserved id does not swallow an explicitly declared numbered id', async () => {
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0, order:0}],
    edges: [],
    customAttributes: [
      {id:'arrowSize', scope:'edge', type:'double'},
      {id:'arrowSize2', scope:'graph', type:'string'},
    ],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  const rows = [...document.querySelectorAll('.custom-attribute-row')];
  const ids = rows.map(row => row.querySelector('[data-attribute-field="id"]').value);
  assert.equal(ids.length, 2, 'both definitions survive');
  assert.ok(ids.includes('arrowSize2'), 'the explicitly declared id keeps its name');
  assert.ok(ids.includes('arrowSize3'), 'the legacy one moves past it');
  assert.equal(document.querySelectorAll('.custom-attribute-row [data-attribute-field="scope"]')[ids.indexOf('arrowSize2')].value, 'graph', 'the explicit definition keeps its own scope');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('reserved built-in ids are still rejected when adding or renaming definitions', async () => {
  const {dom} = createEditorDom();
  const {document} = dom.window;
  for(const reserved of ['direction', 'arrowSize', 'edgeArrowSize', 'directed']){
    document.querySelector('#customAttributeId').value = reserved;
    document.querySelector('#btnAddCustomAttribute').click();
    assert.equal(document.querySelectorAll('.custom-attribute-row').length, 0, `${reserved} is rejected`);
  }
  document.querySelector('#customAttributeId').value = 'capacity';
  document.querySelector('#btnAddCustomAttribute').click();
  assert.equal(document.querySelectorAll('.custom-attribute-row').length, 1, 'a free id is accepted');
  dom.window.close();
});

test('legacy migration keeps going when every short numbered name is already taken', async () => {
  // 99 definitions is far below the 500 limit, so this document is legal. A
  // migration that stopped at suffix 99 lost `direction` entirely.
  const customAttributes = [{id:'direction', scope:'edge', type:'string'}];
  for(let i = 2; i <= 99; i++) customAttributes.push({id:`direction${i}`, scope:'edge', type:'string'});
  customAttributes.push({id:'capacity', scope:'edge', type:'int'});
  const {dom, errors} = createEditorDom({nodes:[{id:'n1', label:'A', x:0, y:0, order:0}], edges:[], customAttributes});
  const {document} = dom.window;
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.equal(ids.length, 100, 'every definition survives');
  assert.equal(new Set(ids).size, ids.length, 'ids stay unique');
  assert.ok(!ids.includes('direction'), 'the reserved id is vacated');
  assert.ok(ids.includes('direction100'), 'the legacy definition moves past the occupied range');
  assert.ok(ids.includes('capacity'), 'unrelated definitions are untouched');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('GraphML export keeps definitions that collide past the whole short suffix range', async () => {
  const customAttributes = [{id:'arrowSize', scope:'edge', type:'double'}];
  for(let i = 2; i <= 99; i++) customAttributes.push({id:`arrowSize${i}`, scope:'edge', type:'double'});
  const {dom, errors} = createEditorDom({nodes:[{id:'n1', label:'A', x:0, y:0, order:0}], edges:[], customAttributes});
  const {document} = dom.window;
  assert.equal(document.querySelectorAll('.custom-attribute-row').length, 99, 'all definitions load');
  document.querySelector('#btnExportGraphml').click();
  const graphml = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  const keyIds = [...graphml.matchAll(/<key id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(keyIds).size, keyIds.length, 'no duplicate key ids');
  assert.equal(keyIds.filter(id => id === 'arrowSize').length, 1, 'exactly one built-in key');
  assert.equal(keyIds.filter(id => id.startsWith('arrowSize')).length, 100, 'the built-in plus all 99 definitions are exported');
  assert.deepEqual(errors.map(error => error.message), []);
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
