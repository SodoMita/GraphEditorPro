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
