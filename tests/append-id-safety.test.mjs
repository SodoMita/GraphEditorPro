// Append-import must never loop forever on an id whose numeric suffix is at
// the safe-integer boundary. The loader counter and the append collision
// allocator both have to recover to a fresh, safe range.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');
const settle = (window, ms) => new Promise(resolve => window.setTimeout(resolve, ms));

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
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable:true, value:{ writeText:async()=>{}, readText:async()=>'' },
      });
    },
  });
  return { dom, errors };
}

function exportGraph(document) {
  document.querySelector('#btnExportJson').click();
  const modal = document.querySelector('.export-modal');
  const graph = JSON.parse(modal.querySelector('textarea').value);
  modal.remove();
  return graph;
}

const hugeGraph = {
  title: 'huge-ids',
  mode: 'select',
  // Deliberately unsafe: a loader must not keep a counter it cannot increment.
  nextNode: 9007199254740992,
  nextEdge: 9007199254740992,
  nodes: [
    { id: 'n9007199254740991', label: 'Huge 1', x: -200, y: 0, order: 0 },
    { id: 'n9007199254740990', label: 'Huge 2', x: 200, y: 0, order: 1 },
  ],
  edges: [{ id: 'e9007199254740991', from: 'n9007199254740991', to: 'n9007199254740990', weight: '1' }],
  settings: {},
  viewBox: { x: -500, y: -330, w: 1000, h: 660 },
};

test('the loader clamps maximum suffix ids to a safe counter', async () => {
  const { dom, errors } = createEditorDom(hugeGraph);
  await settle(dom.window, 80);
  const graph = exportGraph(dom.window.document);
  assert.ok(Number.isSafeInteger(graph.nextNode) && graph.nextNode >= 1);
  assert.ok(Number.isSafeInteger(graph.nextEdge) && graph.nextEdge >= 1);
  assert.deepEqual(graph.nodes.map(n => n.id), ['n9007199254740991', 'n9007199254740990']);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('appending a maximum-suffix graph twice uses bounded id allocation', async () => {
  const { dom, errors } = createEditorDom(hugeGraph);
  const { window } = dom; const { document } = window;
  await settle(window, 80);

  for(let i = 0; i < 2; i++){
    document.querySelector('#btnExportJson').click();
    const modal = document.querySelector('.export-modal');
    modal.querySelector('textarea').value = JSON.stringify(hugeGraph);
    const appendChk = modal.querySelector('#expAppendChk');
    if(!appendChk.checked) appendChk.click();
    modal.querySelector('#expImportBtn').click();
    await settle(window, 60);
  }

  const graph = exportGraph(document);
  assert.equal(graph.nodes.length, 6, 'both appends completed');
  assert.equal(graph.edges.length, 3);
  const ids = graph.nodes.map(n => n.id);
  assert.equal(new Set(ids).size, ids.length, 'all host and appended nodes have unique ids');
  for(const id of ['n9007199254740991', 'n9007199254740990']){
    assert.ok(ids.includes(id), `host id ${id} survives`);
  }
  const idSet = new Set(ids);
  for(const edge of graph.edges){
    assert.ok(idSet.has(edge.from) && idSet.has(edge.to), 'every appended edge resolves');
  }
  assert.ok(Number.isSafeInteger(graph.nextNode) && graph.nextNode >= 1);
  assert.ok(Number.isSafeInteger(graph.nextEdge) && graph.nextEdge >= 1);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});
