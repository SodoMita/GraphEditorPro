// Regression — review finding: two crafted clipboard definitions whose ids
// are over the storage bound and share their first 128 characters are two
// different properties; neither may collapse onto the other, and no value
// may end up keyed under an id that survives as no definition.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');
function createEditorDom() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, {
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

test('crafted over-long clipboard ids sharing a 128-char prefix mint two definitions', async () => {
  const fixtureKeyA = 'P'.repeat(300) + '-TAIL-A';
  const fixtureKeyB = 'P'.repeat(300) + '-TAIL-B';
  const payload = {
    type: 'graph-editor-clipboard',
    nodes: [{ id: 'carried-a', label: 'old', x: 10, y: 10, order: 0, custom: { [fixtureKeyA]: 'value-a', [fixtureKeyB]: 'value-b' } }],
    edges: [],
    externalEdges: [],
    customAttributes: [
      { id: fixtureKeyA, scope: 'node', type: 'string' },
      { id: fixtureKeyB, scope: 'node', type: 'string' },
    ],
  };
  const { dom, errors } = createEditorDom();
  const { window } = dom; const { document } = window;
  await settle(window, 80);
  Object.defineProperty(window.navigator, 'clipboard', { configurable:true, value:{ writeText:async()=>{}, readText:async()=> JSON.stringify(payload) } });
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
  await settle(window, 150);
  const exported = exportGraph(document);
  const defs = exported.customAttributes.filter(d => d.scope === 'node');
  assert.equal(defs.length, 2, 'the two crafted keys mint two definitions, not one');
  assert.notEqual(defs[0].id, defs[1].id);
  const node = exported.nodes.find(n => n.id === 'carried-a');
  assert.ok(node, 'the carried node was pasted');
  assert.deepEqual(Object.values(node.custom).sort(), ['value-a', 'value-b'], 'both values landed in the document');
  const defIds = new Set(defs.map(d => d.id));
  for (const key of Object.keys(node.custom)) {
    assert.ok(defIds.has(key), `the valued key ${JSON.stringify(key.slice(0, 20))}… names a surviving definition`);
  }
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});
