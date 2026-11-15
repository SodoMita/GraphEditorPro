// Regression — review finding: the definitions list (which can hold
// CUSTOM_DEFINITIONS_MAX rows) must not be built while the Data tab is
// inactive; activation mounts the first page and the pager flips pages.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');
function createEditorDom(savedGraph) {
  const errors = [];
  const source = html.replace('<script>', `<script>localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(savedGraph))});</script><script>`);
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
const nextFrame = window => new Promise(resolve => window.setTimeout(resolve, 30));
const settle = (window, ms) => new Promise(resolve => window.setTimeout(resolve, ms));

test('the definitions list defers to Data-tab activation and pages 100 rows at a time', async () => {
  const customAttributes = [];
  for (let i = 0; i < 250; i++) {
    customAttributes.push({ id: 'def' + String(i).padStart(3, '0'), scope: 'node', type: 'string' });
  }
  const saved = { title: 'defs-lazy', mode: 'select', nextNode: 1, nextEdge: 1, nodes: [], edges: [], customAttributes, graphCustom: {}, settings: {} };
  const { dom, errors } = createEditorDom(saved);
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  assert.equal(document.querySelectorAll('#customAttributesList .custom-attribute-row').length, 0,
    'no definition rows are built while the Data tab is inactive');

  document.querySelector('#tab-data').click();
  await settle(window, 20);
  let rows = [...document.querySelectorAll('#customAttributesList .custom-attribute-row')];
  assert.equal(rows.length, 100, 'the first page mounts on activation');
  assert.equal(rows[0].querySelector('[data-attribute-field="id"]').value, 'def000');
  assert.equal(rows[99].querySelector('[data-attribute-field="id"]').value, 'def099');

  document.querySelector('#customAttributesList [data-def-page="next"]').click();
  await settle(window, 20);
  rows = [...document.querySelectorAll('#customAttributesList .custom-attribute-row')];
  assert.equal(rows.length, 100);
  assert.equal(rows[0].querySelector('[data-attribute-field="id"]').value, 'def100');

  document.querySelector('#customAttributesList [data-def-page="next"]').click();
  await settle(window, 20);
  rows = [...document.querySelectorAll('#customAttributesList .custom-attribute-row')];
  assert.equal(rows.length, 50, 'the last page holds the remainder');
  assert.equal(rows[49].querySelector('[data-attribute-field="id"]').value, 'def249');

  document.querySelector('#customAttributesList [data-def-page="prev"]').click();
  await settle(window, 20);
  rows = [...document.querySelectorAll('#customAttributesList .custom-attribute-row')];
  assert.equal(rows[0].querySelector('[data-attribute-field="id"]').value, 'def100');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});
