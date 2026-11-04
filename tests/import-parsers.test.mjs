import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

function createEditorDom(savedGraph = null, clipboardText = '') {
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
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => {}, readText: async () => clipboardText },
      });
    },
  });
  return {dom, errors};
}

const settle = (window, ms = 40) => new Promise(resolve => window.setTimeout(resolve, ms));

// Read the live document through the app's own JSON export (immediate, unlike
// the debounced autosave).
function exportedGraph(document) {
  document.querySelector('#btnExportJson').click();
  const textarea = document.querySelector('.export-modal textarea');
  const data = JSON.parse(textarea.value);
  document.querySelector('#expCloseBtn').click();
  return data;
}

async function paste(document, window, buttonId, text) {
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async () => {}, readText: async () => text } });
  document.querySelector(buttonId).click();
  await settle(window, 60);
}

const toasts = document => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ');

// === DOT ===
test('DOT import keeps hex colours and "#" inside labels instead of truncating lines', async () => {
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  const dot = [
    'digraph G {',
    '  /* block comment with #hash */',
    '  // line comment',
    '# preprocessor comment',
    '  a [label="C# docs", fillcolor="#ff0000"];',
    '  b [label="Beta"];',
    '  a -> b [weight="2"];',
    '}',
  ].join('\n');
  await paste(document, dom.window, '#btnPasteDot', dot);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 2, 'both node declarations are parsed');
  const byId = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
  assert.equal(byId.a.label, 'C# docs', 'a # inside a quoted label is not a comment');
  assert.equal(byId.a.color, '#ff0000', 'hex colour survives comment stripping');
  assert.equal(byId.b.label, 'Beta');
  assert.equal(graph.edges.length, 1);
  assert.equal(errors.length, 0);
});

test('DOT export and import round-trip labels, shapes, colours, types and weights', async () => {
  const saved = {
    title: 'rt',
    nodes: [
      {id:'n1', label:'Alpha', x:-100, y:0, shape:'circle', color:'#0ea5e9', order:0, type:'server'},
      {id:'n2', label:'Beta', x:50, y:40, shape:'square', color:'#8b5cf6', order:1},
      {id:'n3', label:'Gamma', x:200, y:-40, shape:'triangleUp', color:'#10b981', order:2},
      {id:'n4', label:'Delta', x:300, y:90, shape:'triangleDown', color:'#f59e0b', order:3},
      {id:'n5', label:'Epsilon', x:0, y:200, shape:'hexagon', color:'#ef4444', order:4},
      {id:'n6', label:'Zeta', x:60, y:220, shape:'diamond', color:'#22c55e', order:5},
    ],
    edges: [
      {id:'e1', from:'n1', to:'n2', label:'a-b', weight:'3', directed:true, type:'link'},
      {id:'e2', from:'n2', to:'n3', label:'', weight:'2.5', directed:false},
      {id:'e3', from:'n3', to:'n4', label:'g-d', weight:'', directed:true},
    ],
  };
  const {dom} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportDot').click();
  const dot = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  assert.match(dot, /fillcolor="#0ea5e9"/);

  await paste(document, dom.window, '#btnPasteDot', dot);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, saved.nodes.length, 'no nodes lost');
  assert.deepEqual(graph.nodes.map(n => n.label), saved.nodes.map(n => n.label));
  assert.deepEqual(graph.nodes.map(n => n.shape), saved.nodes.map(n => n.shape), 'shapes survive the round-trip');
  assert.deepEqual(graph.nodes.map(n => n.color), saved.nodes.map(n => n.color));
  assert.equal(graph.nodes[0].type, 'server');
  assert.deepEqual(graph.edges.map(e => e.directed), saved.edges.map(e => e.directed));
  assert.deepEqual(graph.edges.map(e => e.weight ?? ''), saved.edges.map(e => e.weight ?? ''));
  assert.deepEqual(graph.edges.map(e => e.label), saved.edges.map(e => e.label));
});

// === CSV ===
test('matrix CSV import drops cells whose node labels are unknown instead of inventing dangling edges', async () => {
  const saved = { title:'m', nodes:[{id:'n1',label:'A',x:0,y:0},{id:'n2',label:'B',x:100,y:0}], edges:[] };
  const {dom} = createEditorDom(saved);
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteMatrixCsv', 'label,A,B,ZZZ\nA,,1,\nZZZ,,,2\n');
  const graph = exportedGraph(document);
  const ids = new Set(graph.nodes.map(n => n.id));
  for (const edge of graph.edges) {
    assert.ok(ids.has(edge.from), `edge source ${edge.from} exists`);
    assert.ok(ids.has(edge.to), `edge target ${edge.to} exists`);
  }
  assert.equal(graph.edges.length, 1, 'only the A→B cell produces an edge');
  // The toast must attribute the loss to unknown endpoints, not to the size
  // cap: that only stays true while importMatrixCsv resolves endpoints itself
  // instead of letting the sanitizer drop invented ids.
  assert.match(toasts(document), /skipped 1/i);
});

test('replace-mode nodes CSV import drops the previous graph\'s edges', async () => {
  const saved = {
    title: 'stale',
    nodes: [{ id:'n1', label:'A', x:0, y:0, order:0 }, { id:'n2', label:'B', x:100, y:0, order:1 }],
    edges: [{ id:'e1', from:'n1', to:'n2', weight:'7', directed:true }],
  };
  const {dom} = createEditorDom(saved);
  const {document} = dom.window;

  // Replace mode (the default): the CSV keeps both ids, so the sanitizer sees
  // a perfectly valid old edge and would happily keep it.
  const rows = ['order,id,label,x,y,shape,color,type', '0,n1,A2,0,0,circle,#0ea5e9,', '1,n2,B2,100,0,circle,#0ea5e9,'];
  await paste(document, dom.window, '#btnPasteNodesCsv', rows.join('\n'));

  const replaced = exportedGraph(document);
  assert.deepEqual(replaced.nodes.map(n => n.label), ['A2', 'B2']);
  assert.equal(replaced.edges.length, 0, 'an edge of the replaced graph must not survive');
  assert.match(toasts(document), /old edge/i, 'dropping the old edges is reported');

  // Append mode is the opposite contract: the existing edge stays.
  const appended = createEditorDom(saved);
  await settle(appended.dom.window, 40);
  appended.dom.window.document.querySelector('#optImportAppend').checked = true;
  await paste(appended.dom.window.document, appended.dom.window, '#btnPasteNodesCsv', rows.join('\n'));
  const kept = exportedGraph(appended.dom.window.document);
  assert.equal(kept.edges.length, 1, 'append mode keeps the existing edge');
  assert.equal(kept.nodes.length, 4);
});

test('nodes CSV import enforces the document size cap and reports it', async () => {
  const {dom} = createEditorDom();
  const {document} = dom.window;
  const rows = ['order,id,label,x,y,shape,color,type'];
  for (let i = 0; i < 3005; i++) rows.push(`${i},n${i},N${i},${i % 100},0,circle,#0ea5e9,`);
  await paste(document, dom.window, '#btnPasteNodesCsv', rows.join('\n'));
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 3000, 'capped at the sanitizer limit, not silently oversized');
  assert.match(toasts(document), /3000/, 'the truncation is reported to the user');
});

test('CSV imports are sanitised like every other import (labels, colours, sizes)', async () => {
  const saved = { title:'v', nodes:[{id:'n1',label:'A',x:0,y:0},{id:'n2',label:'B',x:100,y:0}], edges:[] };
  const {dom} = createEditorDom(saved);
  const {document} = dom.window;
  const longLabel = 'L'.repeat(200);
  await paste(document, dom.window, '#btnPasteEdgesCsv',
    `id,source_id,target_id,weight,label,color,stroke_size\nE1,n1,n2,4,${longLabel},javascript:bad,999\n`);
  const graph = exportedGraph(document);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].label.length, 80, 'labels are bounded');
  assert.notEqual(graph.edges[0].color, 'javascript:bad', 'invalid colours are rejected');
  assert.ok(!graph.edges[0].strokeSize || graph.edges[0].strokeSize <= 20);
});

test('CSV export neutralises spreadsheet formula injection but keeps numbers intact', async () => {
  const saved = {
    title: 'csv',
    nodes: [
      {id:'n1', label:'=cmd|\' /C calc\'!A0', x:-100, y:0, order:0},
      {id:'n2', label:'@SUM(1+1)', x:100, y:0, order:1},
      {id:'n3', label:'C#', x:200, y:0, order:2},
    ],
    edges: [{id:'e1', from:'n1', to:'n3', weight:'-5', directed:true}],
  };
  const {dom} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportNodesCsv').click();
  const csv = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  assert.ok(csv.includes("'=cmd"), 'a leading = is escaped with an apostrophe');
  assert.ok(csv.includes("'@SUM"), 'a leading @ is escaped with an apostrophe');
  assert.ok(csv.includes('C#,') || csv.includes('C#\r'), 'a # in the middle is untouched');
  assert.ok(csv.includes(',-100,') || csv.includes(',-100\r'), 'negative coordinates stay numeric');

  document.querySelector('#btnExportEdgesCsv').click();
  const edgesCsv = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  assert.ok(edgesCsv.includes(',-5,') || edgesCsv.includes(',-5\r'), 'negative weights stay numeric');
});

test('exported formula-guarded cells come back unchanged on import', async () => {
  const saved = {
    title: 'formulas',
    nodes: [
      { id:'n1', label:'=1+1', x:0, y:0, order:0 },
      { id:'n2', label:'@SUM(A1)', x:100, y:0, order:1 },
      { id:'n3', label:'-note', x:200, y:0, order:2 },
    ],
    edges: [],
  };
  const {dom} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportNodesCsv').click();
  const csv = document.querySelector('.export-modal textarea').value;
  assert.ok(csv.includes("'=1+1"), 'export guards the formula-like label');
  // Round-trip through the same import path (the export modal's Import button).
  document.querySelector('#expImportBtn').click();
  await settle(dom.window, 60);
  const graph = exportedGraph(document);
  assert.deepEqual(graph.nodes.map(n => n.label), ['=1+1', '@SUM(A1)', '-note'], 'one apostrophe in, none out');
});

test('DOT comments survive CRLF and CR-only files without eating the next declaration', async () => {
  const dotLf = [
    'digraph G {',
    '  # leading hash comment',
    '  a [label="Alpha", fillcolor="#ff0000"];',
    '  b [label="Beta"];',
    '  a -> b;',
    '}',
  ].join('\n');
  const expected = await (async () => {
    const {dom} = createEditorDom();
    await settle(dom.window, 40);
    await paste(dom.window.document, dom.window, '#btnPasteDot', dotLf);
    const graph = exportedGraph(dom.window.document);
    dom.window.close();
    return graph;
  })();
  assert.deepEqual(expected.nodes.map(n => n.label), ['Alpha', 'Beta']);
  assert.equal(expected.edges.length, 1);

  for (const eol of ['\r\n', '\r']) {
    const {dom, errors} = createEditorDom();
    await settle(dom.window, 40);
    await paste(dom.window.document, dom.window, '#btnPasteDot', dotLf.split('\n').join(eol));
    const graph = exportedGraph(dom.window.document);
    assert.deepEqual(graph.nodes.map(n => n.label), ['Alpha', 'Beta'], `comments survive ${JSON.stringify(eol)} line endings`);
    assert.equal(graph.edges.length, 1, `edges survive ${JSON.stringify(eol)} line endings`);
    assert.deepEqual(errors.map(e => e.message), []);
    dom.window.close();
  }
});

// === Performance guards ===
test('matrix rendering is hard-capped at 14,400 cells regardless of the row limit', async () => {
  const nodes = Array.from({ length: 350 }, (_, i) => ({ id: 'n' + i, label: 'N' + i, x: i * 10, y: 0, order: i }));
  const {dom} = createEditorDom({ title: 'big', nodes, edges: [], settings: { matrixLimit: 5, matrixDimension: 0 } });
  const {document} = dom.window;
  await settle(dom.window, 80);
  const note = document.querySelector('#matrixNote').textContent;
  assert.match(note, /120 of 350/, `matrix reports its capped size (got "${note}")`);
  assert.equal(document.querySelectorAll('#matrixHost table').length, 0, 'oversized matrix is hidden, not rendered');
  const hidden = document.querySelector('#matrixHost').textContent;
  assert.match(hidden, /350 nodes/, 'the message names the real graph size, not the clamped slice');
  assert.match(hidden, /120/, 'the message names the render ceiling that cannot be raised');
  assert.doesNotMatch(hidden, /300 nodes/, 'no claim that the graph has 300 nodes');
});

// === Persistence and accessibility ===
test('a pending autosave is flushed when the page is hidden', async () => {
  const {dom} = createEditorDom();
  const {document, window} = dom.window;
  window.localStorage.removeItem('graph-editor-pro-v2');
  const modeNode = document.querySelector('[data-mode="node"]');
  modeNode.click();
  const canvas = document.querySelector('#graphCanvas');
  canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 660, right: 1000, bottom: 660, toJSON() { return this; } });
  canvas.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 300, clientY: 250 }));
  canvas.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, cancelable: true, button: 0, clientX: 300, clientY: 250 }));
  window.dispatchEvent(new window.Event('pagehide'));
  const saved = JSON.parse(window.localStorage.getItem('graph-editor-pro-v2'));
  assert.equal(saved.nodes.length, 1, 'the node is persisted synchronously on pagehide');
});

test('the page exposes one h1, named tables and a language button whose name contains its visible code', async () => {
  const {dom} = createEditorDom();
  const {document} = dom.window;
  const headings = document.querySelectorAll('h1');
  assert.equal(headings.length, 1);
  assert.equal(headings[0].textContent.trim(), 'Graph Editor Pro');

  const langButton = document.querySelector('#btnLang');
  const code = document.querySelector('#langCode').textContent.trim();
  assert.ok(langButton.getAttribute('aria-label').includes(code), 'accessible name contains the visible text');
  assert.equal(dom.window.I18N, undefined, 'no debug global is exposed');
});
