// Regression — review findings: origins are identity. They must (a) cross
// every document boundary in the injective wire spelling (JSON included),
// (b) never be decoded twice on a round trip, and (c) a foreign JSON payload
// must not mint a fingerprint token out of a raw marker-shaped string.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');
function createEditorDom(savedGraph) {
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
const paste = async (document, window, button, text) => {
  Object.defineProperty(window.navigator, 'clipboard', { configurable:true, value:{ writeText:async()=>{}, readText:async()=>text } });
  document.querySelector(button).click();
  await nextFrame(window); await settle(window, 80);
};
function exportJson(document) {
  document.querySelector('#btnExportJson').click();
  const modal = document.querySelector('.export-modal');
  const text = modal.querySelector('textarea').value;
  modal.remove();
  return text;
}
function exportGraphml(document) {
  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  const text = modal.querySelector('textarea').value;
  modal.remove();
  return text;
}
const longKey = 'J' + 'k'.repeat(299);
const graphmlFor = (key, value) => [
  '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:qvge="http://qvge.github.io/graphml">',
  `  <key id="${key}" for="node" attr.name="longprop-a" attr.type="string" qvge:kind="custom-attribute"/>`,
  '  <graph id="g" edgedefault="directed">',
  `    <node id="n1"><data key="${key}">${value}</data></node>`,
  '  </graph>',
  '</graphml>',
].join('\n');

test('JSON export carries origins in the wire spelling and re-import restores the exact identity', async () => {
  const { dom } = createEditorDom({ title: 'wire-json', nodes: [], edges: [] });
  const { window } = dom; const { document } = window;
  await settle(window, 60);
  await paste(document, window, '#btnPasteGraphml', graphmlFor(longKey, 'value-long'));
  const json = exportJson(document);
  assert.equal(json.includes('\u0001'), false, 'the JSON export never carries a raw U+0001 marker');
  const tokenMatch = json.match(/h106:[0-9a-f]{28}/);
  assert.ok(tokenMatch, 'the long key is carried as an h106 wire token');
  // Re-import the exported JSON into a fresh document.
  const second = createEditorDom({ title: 'wire-json-2', nodes: [], edges: [] });
  const { window: window2 } = second.dom; const document2 = window2.document;
  await settle(window2, 60);
  await paste(document2, window2, '#btnPasteJson', json);
  const json2 = exportJson(document2);
  const token2 = (JSON.parse(json2).customAttributes || []).map(d => d.origin).find(o => typeof o === 'string' && o.startsWith('h106:'));
  assert.equal(token2, tokenMatch[0], 'the identity is stable across a JSON export/import round trip');
  const def2 = (JSON.parse(json2).customAttributes || []).find(d => d.name === 'longprop-a');
  assert.ok(def2, 'the definition survived the round trip');
  assert.equal(JSON.parse(json2).nodes.find(n => n.id === 'n1').custom[def2.id], 'value-long', 'the value travels with the identity');
  dom.window.close(); second.dom.window.close();
});

test('GraphML identity is stable across three export/import generations (origins are decoded exactly once)', async () => {
  const { dom } = createEditorDom({ title: 'wire-gml-1', nodes: [], edges: [] });
  const { window } = dom; const { document } = window;
  await settle(window, 60);
  await paste(document, window, '#btnPasteGraphml', graphmlFor(longKey, 'value-long'));
  const gen1 = exportGraphml(document);
  const t1 = gen1.match(/qvge:origin="([^"]+)"/)[1];
  const second = createEditorDom({ title: 'wire-gml-2', nodes: [], edges: [] });
  await settle(second.dom.window, 60);
  await paste(second.dom.window.document, second.dom.window, '#btnPasteGraphml', gen1);
  const t2 = exportGraphml(second.dom.window.document).match(/qvge:origin="([^"]+)"/)[1];
  const third = createEditorDom({ title: 'wire-gml-3', nodes: [], edges: [] });
  await settle(third.dom.window, 60);
  await paste(third.dom.window.document, third.dom.window, '#btnPasteGraphml', exportGraphml(second.dom.window.document));
  const t3 = exportGraphml(third.dom.window.document).match(/qvge:origin="([^"]+)"/)[1];
  assert.equal(t2, t1, 'a re-import re-exports the identical token');
  assert.equal(t3, t2, 'the token is stable over two round trips');
  dom.window.close(); second.dom.window.close(); third.dom.window.close();
});

test('a raw marker-shaped string in a foreign JSON payload cannot mint a token equal to itself and round-trips deterministically', async () => {
  const marker = '\u0001' + 'a'.repeat(28);
  const payload = {
    title: 'evil', mode: 'select', nextNode: 2, nextEdge: 1,
    nodes: [{ id: 'x', label: 'l', x: 0, y: 0, order: 0, custom: { p: 'v' } }],
    edges: [],
    customAttributes: [{ id: 'p', scope: 'node', type: 'string', origin: marker }],
    graphCustom: {}, settings: {},
  };
  const { dom } = createEditorDom({ title: 'wire-marker', nodes: [], edges: [] });
  const { window } = dom; const { document } = window;
  await settle(window, 60);
  await paste(document, window, '#btnPasteJson', JSON.stringify(payload));
  const out = JSON.parse(exportJson(document));
  assert.equal(exportJson(document).includes('\u0001'), false, 'no raw marker leaves the document');
  const origin = out.customAttributes.find(d => d.id === 'p').origin;
  assert.ok(origin.startsWith('h106:'), `the forged marker is re-tagged to a fingerprint token, got ${JSON.stringify(origin)}`);
  assert.notEqual(origin, 'h106:' + 'a'.repeat(28), 'the forged marker does not pass through verbatim');
  // Re-importing the export reproduces the identical origin.
  const second = createEditorDom({ title: 'wire-marker-2', nodes: [], edges: [] });
  await settle(second.dom.window, 60);
  await paste(second.dom.window.document, second.dom.window, '#btnPasteJson', exportJson(document));
  const origin2 = (JSON.parse(exportJson(second.dom.window.document)).customAttributes || []).find(d => d.id === 'p')?.origin;
  assert.equal(origin2, origin, 'the re-tagged identity is stable across imports');
  dom.window.close(); second.dom.window.close();
});
