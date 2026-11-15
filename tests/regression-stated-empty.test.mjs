// Regression — review finding: a whitespace-only stored value is a STATED
// EMPTY and must survive a definition type migration verbatim (never '',
// never 0, never false), and undo/redo must round-trip it.
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
function exportGraph(document) {
  document.querySelector('#btnExportJson').click();
  const modal = document.querySelector('.export-modal');
  const graph = JSON.parse(modal.querySelector('textarea').value);
  modal.remove();
  return graph;
}

for (const target of ['boolean', 'int', 'long', 'float', 'double']) {
  test(`a whitespace-only stored value migrates verbatim into ${target} and back`, async () => {
    const saved = {
      title: 'stated-empty', mode: 'select', nextNode: 2, nextEdge: 1,
      nodes: [{ id: 'a', label: 'A', x: -200, y: 0, order: 0, custom: { whit: '   ' } }],
      edges: [],
      customAttributes: [{ id: 'whit', scope: 'node', type: 'string' }],
      graphCustom: {}, settings: {},
    };
    const { dom, errors } = createEditorDom(saved);
    const { window } = dom; const { document } = window;
    await nextFrame(window);
    // Flip the definition's type to the target type via the definitions list.
    document.querySelector('#tab-data').click();
    const row = [...document.querySelectorAll('.custom-attribute-row')]
      .find(r => r.querySelector('[data-attribute-field="id"]').value === 'whit');
    row.querySelector('[data-attribute-field="type"]').value = target;
    row.querySelector('[data-attribute-action="save"]').click();
    await settle(window, 60);
    let exported = exportGraph(document);
    assert.equal(exported.nodes[0].custom.whit, '   ', `the stated whitespace survives migration into ${target}`);
    // One undo step restores the previous type (and value, still verbatim).
    document.querySelector('#btnUndo').click();
    await settle(window, 60);
    exported = exportGraph(document);
    assert.equal(exported.nodes[0].custom.whit, '   ', 'the value is still the stated whitespace after undo');
    assert.deepEqual(errors.map(e => e.message), []);
    dom.window.close();
  });
}
