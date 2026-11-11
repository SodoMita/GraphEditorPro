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

// === General helpers ===
// Boot the editor on `saved`, paste `text` as DOT, and return the resulting
// state for assertions. The default saved document is a 2-node, 1-edge graph.
const DEFAULT_SAVED = () => ({ title: 'keep-general', nodes: [
  {id:'n1', label:'One', x:0, y:0, order:0},
  {id:'n2', label:'Two', x:120, y:0, order:1},
], edges: [{ id:'e1', from:'n1', to:'n2', weight:'1', label:'', directed:true }] });
// === DOT ===
// Parser-structure cases live in dot-core.test.mjs (fast, no jsdom); the
// tests here cover only the end-to-end paths through the real paste flow.

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


test('replace-mode nodes CSV keeps explicit orders, including 0', async () => {
  const saved = {
    title: 'orders',
    nodes: [
      { id:'p1', label:'P1', x:0, y:0, order:0 },
      { id:'p2', label:'P2', x:0, y:100, order:1 },
      { id:'p3', label:'P3', x:0, y:200, order:2 },
    ],
    edges: [],
  };
  const {dom} = createEditorDom(saved);
  const {document} = dom.window;
  const rows = [
    'order,id,label,x,y,shape,color,type',
    '0,p1,P1,0,0,circle,#0ea5e9,',
    '1,p2,P2,0,100,circle,#0ea5e9,',
    '2,p3,P3,0,200,circle,#0ea5e9,',
  ];
  await paste(document, dom.window, '#btnPasteNodesCsv', rows.join('\n'));

  const graph = exportedGraph(document);
  // parseInt(...) || fallback read a real order of 0 as "missing" and pushed the
  // node to the end of the replaced list, so P1 came back as order 3.
  assert.deepEqual(graph.nodes.map(n => [n.id, n.order]), [['p1', 0], ['p2', 1], ['p3', 2]]);
  await settle(dom.window, 120);   // the matrix is rebuilt by the queued render pass
  const header = [...document.querySelectorAll('#matrixHost [data-node-label]')]
    .slice(0, 3)
    .map(el => el.dataset.nodeLabel);
  assert.deepEqual(header, ['p1', 'p2', 'p3'], 'the matrix keeps the imported order');
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


test('DOT labels round-trip newline escapes, literal backslashes and quotes', async () => {
  const labels = ['a\nb', 'a\\nb', 'a"b', "a'b", 'a\\', 'a\\nb\\'];
  const saved = {
    title: 'escapes',
    nodes: labels.map((label, i) => ({ id: 'n' + i, label, x: i * 100, y: 0, order: i })),
    edges: [],
  };
  const {dom} = createEditorDom(saved);
  const {document} = dom.window;

  document.querySelector('#btnExportDot').click();
  const dot = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  // The graph's own DOT export, fed straight back in.
  await paste(document, dom.window, '#btnPasteDot', dot);

  assert.deepEqual(exportedGraph(document).nodes.map(n => n.label), labels,
    'a newline, a literal backslash-n and a trailing backslash all survive');
});


test('CSV export and import preserve labels that start with an apostrophe', async () => {
  const labels = ['=1+1', "'=1+1", "''=1+1", "'plain", '-note', 'plain'];
  const saved = {
    title: 'apostrophes',
    nodes: labels.map((label, i) => ({ id: 'n' + i, label, x: 0, y: i * 60, order: i })),
    edges: [],
  };
  const {dom} = createEditorDom(saved);
  const {document} = dom.window;

  document.querySelector('#btnExportNodesCsv').click();
  const csv = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  assert.ok(csv.includes("''=1+1"), 'a label that already starts with the guard apostrophe is escaped again');

  await paste(document, dom.window, '#btnPasteNodesCsv', csv);
  assert.deepEqual(exportedGraph(document).nodes.map(n => n.label), labels,
    'guarded text is unescaped exactly once per round-trip');
});


test('CSV apostrophe handling is iterative and stays exact for many markers', async () => {
  // A user-reachable cell: thousands of leading apostrophes used to recurse in
  // needsFormulaGuard() and abort the import with a stack overflow.
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  const longLabel = "'".repeat(50_000);
  await paste(document, dom.window, '#btnPasteNodesCsv',
    'order,id,label,x,y,shape,color,type\n0,n1,' + longLabel + ',0,0,circle,#0ea5e9,');
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 1, 'the import completes instead of failing');
  assert.equal(graph.nodes[0].label.length, 80, 'the label is capped by the sanitizer');
  assert.doesNotMatch(toasts(document), /failed/i, 'no failure is reported');
  assert.deepEqual(errors.map(e => e.message), []);

  // The escaping rule still strips exactly one marker, however many there are.
  const label = "'".repeat(20) + '=1+1';
  const saved = { title: 'apostrophes', nodes: [{ id: 'n1', label, x: 0, y: 0, order: 0 }], edges: [] };
  const roundTrip = createEditorDom(saved);
  const doc = roundTrip.dom.window.document;
  doc.querySelector('#btnExportNodesCsv').click();
  const csv = doc.querySelector('.export-modal textarea').value;
  doc.querySelector('#expCloseBtn').click();
  await paste(doc, roundTrip.dom.window, '#btnPasteNodesCsv', csv);
  assert.equal(exportedGraph(doc).nodes[0].label, label, 'one apostrophe is added and one removed');
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
  assert.equal(document.querySelector('#matrixSize').value, '120', 'the matrix-size control is clamped to the ceiling');
  assert.equal(document.querySelector('#matrixSize').max, '120');
  const hidden = document.querySelector('#matrixHost').textContent;
  assert.match(hidden, /350 nodes/, 'the message names the real graph size, not the clamped slice');
  assert.match(hidden, /120/, 'the message names the render ceiling that cannot be raised');
  assert.doesNotMatch(hidden, /300 nodes/, 'no claim that the graph has 300 nodes');
});


test('a saved matrix dimension above the render ceiling is clamped on load', async () => {
  const nodes = Array.from({ length: 3 }, (_, i) => ({ id: 'n' + i, label: 'N' + i, x: i * 10, y: 0, order: i }));
  const {dom} = createEditorDom({ title: 'dim', nodes, edges: [], settings: { matrixDimension: 300, matrixLimit: 999 } });
  const {document} = dom.window;
  await settle(dom.window, 80);
  assert.equal(document.querySelector('#matrixSize').value, '120', 'the view control shows the clamped dimension');
  assert.equal(exportedGraph(document).settings.matrixDimension, 120, 'the saved setting is clamped too');
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


test('malformed graph input never destroys the document and reports the failure', async () => {
  const saved = { title: 'keep-me', nodes: [
    {id:'n1', label:'One', x:0, y:0, order:0},
    {id:'n2', label:'Two', x:120, y:0, order:1},
    {id:'n3', label:'Three', x:0, y:120, order:2},
  ], edges: [] };
  const cases = [
    ['#btnPasteDot', 'hello'],
    ['#btnPasteDot', 'digraph {'],
    ['#btnPasteDot', 'a; b;'],
    ['#btnPasteDot', '{}'],
    ['#btnPasteJson', '{}'],
    ['#btnPasteJson', '[]'],
    ['#btnPasteJson', '{"edges":[]}'],
    ['#btnPasteGraphml', '<graphml xmlns="http://graphml.graphdrawing.org/xmlns"></graphml>'],
  ];
  for(const [button, text] of cases){
    const {dom, errors} = createEditorDom(saved);
    const {document} = dom.window;
    await settle(dom.window, 60);
    await paste(document, dom.window, button, text);
    const graph = exportedGraph(document);
    assert.equal(graph.nodes.length, 3, `document survives ${JSON.stringify(text)} via ${button}`);
    assert.match(toasts(document), /fail|no graph/i, `a failure is reported for ${JSON.stringify(text)}`);
    assert.deepEqual(errors.map(error => error.message), [], `no uncaught errors for ${JSON.stringify(text)}`);
    dom.window.close();
  }
});


test('a replace-mode import can be undone back to the pre-import document', async () => {
  const saved = { title: 'undoable', nodes: [
    {id:'n1', label:'One', x:0, y:0, order:0},
    {id:'n2', label:'Two', x:120, y:0, order:1},
    {id:'n3', label:'Three', x:0, y:120, order:2},
  ], edges: [{ id:'e1', from:'n1', to:'n2', weight:'1', label:'', directed:true }] };
  const {dom} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  const dot = 'digraph G {\n  x [label="Replacement"];\n}';
  await paste(document, dom.window, '#btnPasteDot', dot);
  let graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 1, 'the replace import went through');
  assert.equal(graph.nodes[0].label, 'Replacement');
  document.querySelector('#btnUndo').click();
  await settle(dom.window, 80);
  graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 3, 'undo restores the pre-import document');
  assert.deepEqual(graph.nodes.map(n => n.label), ['One', 'Two', 'Three']);
  assert.equal(graph.edges.length, 1, 'the pre-import edges are restored too');
  dom.window.close();
});


test('a bare GraphML <graph> is a valid empty document (round 10) and undo restores the original', async () => {
  // Round 8 treated this as "an error"; round 10 defines a zero-node <graph>
  // with no dangling edges as a valid empty document that must round-trip.
  const saved = { title: 'keep-me-2', nodes: [
    {id:'n1', label:'One', x:0, y:0, order:0},
  ], edges: [] };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  await paste(document, dom.window, '#btnPasteGraphml', '<graphml xmlns="http://graphml.graphdrawing.org/xmlns"><graph id="g" edgedefault="directed"></graph></graphml>');
  let graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 0, 'the bare graph imports as a valid empty document');
  assert.match(toasts(document), /imported/i);
  document.querySelector('#btnUndo').click();
  await settle(dom.window, 80);
  graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 1, 'undo restores the replaced document');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

// === Round 9 ===

test('valid empty documents (the editor’s own exports) round-trip instead of being rejected', async () => {
  // 1) JSON: an explicitly empty nodes array is a valid empty document.
  const saved = { title: 'keep-me-r9', nodes: [
    {id:'n1', label:'One', x:0, y:0, order:0},
    {id:'n2', label:'Two', x:120, y:0, order:1},
    {id:'n3', label:'Three', x:0, y:120, order:2},
  ], edges: [{ id:'e1', from:'n1', to:'n2', weight:'1', label:'', directed:true }] };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  const emptyJson = JSON.stringify({ title:'empty-doc', mode:'select', selectTool:'nodes', selectCombine:false,
    nextNode:1, nextEdge:1, nodes:[], edges:[], customAttributes:[], graphCustom:{}, settings:{}, viewBox:{x:0,y:0,w:100,h:100} });
  await paste(document, dom.window, '#btnPasteJson', emptyJson);
  let graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 0, 'the empty document replaces the canvas');
  assert.equal(graph.title, 'empty-doc');
  assert.match(toasts(document), /imported/i);
  document.querySelector('#btnUndo').click();
  await settle(dom.window, 80);
  graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 3, 'undo restores the replaced document');
  assert.deepEqual(graph.nodes.map(n => n.label), ['One', 'Two', 'Three']);

  // 2) GraphML: graph-scoped values with zero nodes round-trip too.
  const {dom: dom2, errors: errors2} = createEditorDom(saved);
  const {document: document2} = dom2.window;
  await settle(dom2.window, 60);
  const emptyGraphml = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:grapheditor="https://grapheditor.pro/ns">',
    '  <key id="note" for="graph" attr.name="note" attr.type="string" grapheditor:dataKey="note" grapheditor:dataName="note"/>',
    '  <graph id="empty-doc" edgedefault="directed">',
    '    <data key="note">graph-scoped value</data>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  await paste(document2, dom2.window, '#btnPasteGraphml', emptyGraphml);
  const graph2 = exportedGraph(document2);
  assert.equal(graph2.nodes.length, 0, 'a graph-scoped-value GraphML with zero nodes imports');
  assert.equal(graph2.graphCustom?.note, 'graph-scoped value', 'the graph-scoped custom value survives');
  assert.match(toasts(document2), /imported/i);

  // 3) GraphML: the plain editor empty export (built-in keys + built-in
  // graph-level <data>) is a valid empty document, likewise.
  const {dom: dom3, errors: errors3} = createEditorDom(saved);
  const {document: document3} = dom3.window;
  await settle(dom3.window, 60);
  const plainEmpty = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="labelsPolicy" for="graph" attr.name="labels.policy" attr.type="string"/>',
    '  <key id="canvasBgColor" for="graph" attr.name="canvas.bg.color" attr.type="string"/>',
    '  <graph id="empty-doc" edgedefault="directed">',
    '    <data key="labelsPolicy">auto</data>',
    '    <data key="canvasBgColor">#020617</data>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  await paste(document3, dom3.window, '#btnPasteGraphml', plainEmpty);
  const graph3 = exportedGraph(document3);
  assert.equal(graph3.nodes.length, 0, 'the plain editor empty GraphML imports');
  assert.match(toasts(document3), /imported/i);

  assert.deepEqual(errors.map(e => e.message), []);
  assert.deepEqual(errors2.map(e => e.message), []);
  assert.deepEqual(errors3.map(e => e.message), []);
  dom.window.close(); dom2.window.close(); dom3.window.close();
});


test('a nonempty node array in which every entry is malformed is rejected, not imported', async () => {
  const saved = { title: 'keep-me-r9b', nodes: [
    {id:'n1', label:'One', x:0, y:0, order:0},
    {id:'n2', label:'Two', x:120, y:0, order:1},
  ], edges: [] };
  const cases = [
    '{"nodes":[null],"edges":[]}',
    '{"nodes":[null, 42, "x", true, false],"edges":[]}',
    '{"nodes":[null, "n"],"title":"sneaky"}',
  ];
  for(const text of cases){
    const {dom, errors} = createEditorDom(saved);
    const {document} = dom.window;
    await settle(dom.window, 60);
    await paste(document, dom.window, '#btnPasteJson', text);
    const graph = exportedGraph(document);
    assert.equal(graph.nodes.length, 2, `document survives ${text}`);
    assert.match(toasts(document), /fail|no graph/i, `a failure is reported for ${text}`);
    assert.deepEqual(errors.map(e => e.message), []);
    dom.window.close();
  }
  // A nonempty array with at least one real record imports (the junk entries
  // are dropped by sanitization, as always).
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  await paste(document, dom.window, '#btnPasteJson',
    '{"nodes":[null, {"id":"keep1","label":"Kept","x":5,"y":5,"order":0}],"edges":[]}');
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].label, 'Kept');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});


test('at the 500-definition limit, repeated pastes reuse the remapped definition instead of dropping the value', async () => {
  // 498 filler node-scope definitions + one graph-scoped 'tag' = 499.
  // The carried clipboard definition 'tag' (node scope) conflicts on paste.
  const fillers = Array.from({ length: 498 }, (_, i) => ({ id: 'fill_' + i, scope: 'node', type: 'string' }));
  const saved = { title: 'at-cap', nodes: [{id:'n1', label:'Keep', x:0, y:0, order:0}], edges: [],
    customAttributes: [...fillers, { id: 'tag', scope: 'graph', type: 'string' }] };
  const payload = JSON.stringify({ type: 'graph-editor-clipboard',
    nodes: [{ id: 'c1', label: 'Carried', x: 20, y: 20, order: 0, custom: { tag: 'hello' } }],
    edges: [], externalEdges: [],
    customAttributes: [{ id: 'tag', scope: 'node', type: 'string' }] });
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  const clip = () => Object.defineProperty(dom.window.navigator, 'clipboard',
    { configurable: true, value: { writeText: async () => {}, readText: async () => payload } });
  clip();
  document.querySelector('#btnPaste2').click();
  await settle(dom.window, 80);
  clip();
  document.querySelector('#btnPaste2').click();
  await settle(dom.window, 80);
  const graph = exportedGraph(document);
  assert.equal(graph.customAttributes.length, 500, 'the limit is still respected exactly');
  const tag1 = graph.customAttributes.find(d => d.id === 'tag_1');
  assert.equal(tag1?.dataKey, 'tag', 'the first paste re-created the conflict as tag_1 with provenance');
  const carrieds = graph.nodes.filter(n => n.label === 'Carried');
  assert.equal(carrieds.length, 2, 'both pastes landed their nodes');
  for(const n of carrieds){
    assert.equal(n.custom?.tag_1, 'hello', 'the carried value is bound to tag_1 on every paste, never under the graph-scoped tag');
    assert.equal(n.custom?.tag, undefined, 'the value is never left under the graph-scoped id');
  }
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});


test('empty-nodes JSON with a non-empty edge list is rejected, not imported as an empty document', async () => {
  // Every edge would dangle and be dropped; the editor can never export
  // this shape, so it is not a valid empty document.
  const saved = { title: 'keep-me-r9c', nodes: [
    {id:'n1', label:'One', x:0, y:0, order:0},
    {id:'n2', label:'Two', x:120, y:0, order:1},
  ], edges: [] };
  const cases = [
    '{"nodes":[],"edges":[{"id":"e1","from":"n1","to":"n2","weight":"1","directed":true}]}',
    '{"nodes":[],"edges":[{"from":"a","to":"b"}]}',
  ];
  for(const text of cases){
    const {dom, errors} = createEditorDom(saved);
    const {document} = dom.window;
    await settle(dom.window, 60);
    await paste(document, dom.window, '#btnPasteJson', text);
    const graph = exportedGraph(document);
    assert.equal(graph.nodes.length, 2, `document survives ${text}`);
    assert.match(toasts(document), /fail|no graph/i);
    assert.deepEqual(errors.map(e => e.message), []);
    dom.window.close();
  }
});


test('GraphML without a <graph> element is rejected even when it defines keys', async () => {
  const saved = { title: 'keep-me-r9d', nodes: [
    {id:'n1', label:'One', x:0, y:0, order:0},
  ], edges: [] };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  const noGraph = '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">'
    + '<key id="note" for="graph" attr.name="note" attr.type="string"/>'
    + '</graphml>';
  await paste(document, dom.window, '#btnPasteGraphml', noGraph);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 1, 'document survives a GraphML without <graph>');
  // The explicit rejection (not an accidental TypeError in the parser) must
  // produce the structured empty-graph error.
  assert.match(toasts(document), /contains no graph/i);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});


test('zero-node GraphML carrying only edge-scoped <data> is rejected', async () => {
  // Edge-scoped values never belong to a document root; every edge dangles.
  const saved = { title: 'keep-me-r9e', nodes: [
    {id:'n1', label:'One', x:0, y:0, order:0},
  ], edges: [] };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  const edgeDataOnly = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <graph id="g" edgedefault="directed">',
    '    <edge id="e1" source="a" target="b">',
    '      <data key="weight">1</data>',
    '    </edge>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  await paste(document, dom.window, '#btnPasteGraphml', edgeDataOnly);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 1, 'edge-scoped <data> does not make a zero-node file a valid document');
  assert.match(toasts(document), /fail|no graph/i);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});


test('zero-node GraphML with only graph-scoped direct-child <data> still round-trips', async () => {
  // Positive control for the tightened gate: graph-scoped <data> is document content.
  const saved = { title: 'keep-me-r9f', nodes: [
    {id:'n1', label:'One', x:0, y:0, order:0},
  ], edges: [] };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  const graphDataOnly = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <graph id="g" edgedefault="directed">',
    '    <data key="canvasBgColor">#020617</data>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  await paste(document, dom.window, '#btnPasteGraphml', graphDataOnly);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 0, 'graph-scoped <data> makes it a valid empty document');
  assert.match(toasts(document), /imported/i);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

// === Round 10 ===

test('the editor’s own empty DOT export round-trips', async () => {
  // Seed an empty document, export it as DOT, then paste that exact text
  // into a 3-node document — the empty export must import cleanly.
  const {dom: domEmpty} = createEditorDom({ title: 'empty-dot-src', nodes: [], edges: [] });
  const emptyDoc = domEmpty.window.document;
  await settle(domEmpty.window, 60);
  emptyDoc.querySelector('#btnExportDot').click();
  const dotText = emptyDoc.querySelector('.export-modal textarea').value;
  emptyDoc.querySelector('#expCloseBtn').click();
  assert.match(dotText, /digraph/i, 'the exporter writes a digraph');
  domEmpty.window.close();

  const saved = { title: 'keep-me-r10', nodes: [
    {id:'n1', label:'One', x:0, y:0, order:0},
    {id:'n2', label:'Two', x:120, y:0, order:1},
  ], edges: [{ id:'e1', from:'n1', to:'n2', weight:'1', label:'', directed:true }] };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  await paste(document, dom.window, '#btnPasteDot', dotText);
  let graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 0, 'the empty DOT export imports');
  assert.match(toasts(document), /imported/i);
  document.querySelector('#btnUndo').click();
  await settle(dom.window, 80);
  graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 2, 'undo restores the replaced document');
  assert.equal(graph.edges.length, 1);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});


test('zero-node GraphML with an edge whose endpoints are absent is rejected', async () => {
  // Finding 1: an edge key + a dangling edge must NOT import as an empty
  // document behind an import toast.
  const saved = { title: 'keep-me-r10c', nodes: [
    {id:'n1', label:'One', x:0, y:0, order:0},
    {id:'n2', label:'Two', x:120, y:0, order:1},
    {id:'n3', label:'Three', x:0, y:120, order:2},
  ], edges: [] };
  const cases = [
    // with an <key> declaration for the edge (the reported repro)
    ['<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
     '  <key id="w" for="edge" attr.name="weight" attr.type="string"/>',
     '  <graph id="g" edgedefault="directed">',
     '    <edge id="e1" source="a" target="b">',
     '      <data key="w">1</data>',
     '    </edge>',
     '  </graph>',
     '</graphml>'].join('\n'),
    // without any key
    ['<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
     '  <graph id="g" edgedefault="directed">',
     '    <edge id="e1" source="a" target="b"/>',
     '  </graph>',
     '</graphml>'].join('\n'),
  ];
  for(const text of cases){
    const {dom, errors} = createEditorDom(saved);
    const {document} = dom.window;
    await settle(dom.window, 60);
    await paste(document, dom.window, '#btnPasteGraphml', text);
    const graph = exportedGraph(document);
    assert.equal(graph.nodes.length, 3, 'document survives the dangling-edge GraphML');
    assert.match(toasts(document), /fail|no graph/i);
    assert.deepEqual(errors.map(e => e.message), []);
    dom.window.close();
  }
});

// === Round 11 ===

test('a conflicting paste keeps GraphML provenance so re-paste and import-append reuse the definition', async () => {
  // Target document: graph-scope x_1 already exists, forcing a mint when the
  // carried node-scope x_1 (migrated from reserved key "x") is pasted.
  const saved = { title: 'cap-provenance', nodes: [{id:'b1', label:'Keep', x:0, y:0, order:0}], edges: [],
    customAttributes: [{ id: 'x_1', scope: 'graph', type: 'string' }] };
  const payload = JSON.stringify({ type: 'graph-editor-clipboard',
    nodes: [{ id: 'c1', label: 'Carried', x: 30, y: 30, order: 0, custom: { x_1: 'red' } }],
    edges: [], externalEdges: [],
    customAttributes: [{ id: 'x_1', scope: 'node', type: 'string', dataKey: 'x', dataName: 'fill color' }] });
  const originalGraphml = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="x" for="node" attr.name="fill color" attr.type="string"/>',
    '  <graph id="g" edgedefault="directed">',
    '    <node id="m2"><data key="x">blue</data></node>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  const clip = () => Object.defineProperty(dom.window.navigator, 'clipboard',
    { configurable: true, value: { writeText: async () => {}, readText: async () => payload } });

  clip(); document.querySelector('#btnPaste2').click(); await settle(dom.window, 80);
  let graph = exportedGraph(document);
  const minted = graph.customAttributes.find(d => d.id === 'x_1_1');
  assert.equal(minted?.scope, 'node', 'the conflicting paste minted x_1_1');
  assert.equal(minted?.dataKey, 'x', 'the minted definition keeps the ORIGINAL key id as provenance');
  assert.equal(minted?.dataName, 'fill color', 'the minted definition keeps the original key name as provenance');

  // A second identical paste must reuse x_1_1, never mint x_1_2.
  clip(); document.querySelector('#btnPaste2').click(); await settle(dom.window, 80);
  graph = exportedGraph(document);
  assert.equal(graph.customAttributes.length, 2, 're-pasting creates no new definition');
  assert.equal(graph.customAttributes.some(d => d.id === 'x_1_2'), false, 'no x_1_2 is minted');

  // Appending the original GraphML must find x_1_1 via its provenance and
  // reuse it — never create x_2.
  Object.defineProperty(dom.window.navigator, 'clipboard',
    { configurable: true, value: { writeText: async () => {}, readText: async () => originalGraphml } });
  const appendChk = document.querySelector('#optImportAppend');
  assert.ok(appendChk, 'the append option exists');
  appendChk.checked = true;
  document.querySelector('#btnPasteGraphml').click();
  await settle(dom.window, 80);
  graph = exportedGraph(document);
  assert.equal(graph.customAttributes.length, 2, 'appending the source file reuses the definition, no x_2 is created');
  assert.equal(graph.customAttributes.some(d => d.id === 'x_2'), false, 'x_2 is never minted');
  const carrieds = graph.nodes.filter(n => n.label === 'Carried');
  assert.equal(carrieds.length, 2);
  for(const n of carrieds) assert.equal(n.custom?.x_1_1, 'red', 'carried values stay bound to x_1_1');
  const imported = graph.nodes.find(n => n.id === 'm2' || n.id.startsWith('n'));
  assert.equal(graph.customAttributes.filter(d => d.id === 'x_1_1').length, 1);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

// === Round 12 ===

test('a batch paste with conflicting provenance mints one definition for the whole batch', async () => {
  // Fresh document has a FRUIT property x_1 whose provenance says (x, fruit).
  const saved = { title: 'batch-provenance', nodes: [{id:'b1', label:'Keep', x:0, y:0, order:0}], edges: [],
    customAttributes: [{ id: 'x_1', scope: 'node', type: 'string', dataKey: 'x', dataName: 'fruit' }] };
  const payload = JSON.stringify({ type: 'graph-editor-clipboard',
    nodes: [
      { id: 'c1', label: 'CarriedA', x: 30, y: 30, order: 0, custom: { x_1: 'red' } },
      { id: 'c2', label: 'CarriedB', x: 90, y: 30, order: 1, custom: { x_1: 'blue' } },
    ],
    edges: [], externalEdges: [],
    customAttributes: [{ id: 'x_1', scope: 'node', type: 'string', dataKey: 'x', dataName: 'vehicle' }] });
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  Object.defineProperty(dom.window.navigator, 'clipboard',
    { configurable: true, value: { writeText: async () => {}, readText: async () => payload } });
  document.querySelector('#btnPaste2').click();
  await settle(dom.window, 80);
  const graph = exportedGraph(document);
  const minted = graph.customAttributes.filter(d => d.scope === 'node' && d.id !== 'x_1');
  assert.equal(minted.length, 1, 'exactly one node-scope definition was minted for the whole batch');
  assert.equal(minted[0].id, 'x_1_1');
  assert.equal(minted[0].dataName, 'vehicle', 'the minted definition keeps the carried provenance');
  assert.equal(graph.customAttributes.find(d => d.id === 'x_1')?.dataName, 'fruit', 'the fruit definition is untouched');
  const carrieds = graph.nodes.filter(n => n.label.startsWith('Carried'));
  assert.equal(carrieds.length, 2);
  for(const n of carrieds) assert.equal(n.custom?.x_1_1, n.label === 'CarriedA' ? 'red' : 'blue', 'each value lands on the minted definition');
  assert.equal(graph.customAttributes.length, 2, 'no orphaned or duplicated definitions');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});


test('a matching id with different provenance is never merged into the existing definition', async () => {
  // The document's node x_1 came from key fruit (provenance x/fruit).
  const saved = { title: 'fruit-doc', nodes: [{id:'b1', label:'Keep', x:0, y:0, order:0}], edges: [],
    customAttributes: [{ id: 'x_1', scope: 'node', type: 'string', dataKey: 'x', dataName: 'fruit' }] };
  // The clipboard carries a node property x_1 from key vehicle (provenance x/vehicle).
  const payload = JSON.stringify({ type: 'graph-editor-clipboard',
    nodes: [{ id: 'c1', label: 'Carried', x: 30, y: 30, order: 0, custom: { x_1: 'vehicle-value' } }],
    edges: [], externalEdges: [],
    customAttributes: [{ id: 'x_1', scope: 'node', type: 'string', dataKey: 'x', dataName: 'vehicle' }] });
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  Object.defineProperty(dom.window.navigator, 'clipboard',
    { configurable: true, value: { writeText: async () => {}, readText: async () => payload } });
  document.querySelector('#btnPaste2').click();
  await settle(dom.window, 80);
  let graph = exportedGraph(document);
  assert.equal(graph.customAttributes.find(d => d.id === 'x_1')?.dataName, 'fruit', 'the fruit definition is untouched');
  const vehicle = graph.customAttributes.find(d => d.dataName === 'vehicle');
  assert.ok(vehicle, 'a vehicle definition was created for the carried property');
  assert.equal(vehicle.id, 'x_1_1');
  const carried = graph.nodes.find(n => n.label === 'Carried');
  assert.equal(carried?.custom?.x_1_1, 'vehicle-value', 'the carried value is bound to the vehicle definition');
  assert.equal(carried?.custom?.x_1, undefined, 'the vehicle value never lands on the fruit definition');
  // Re-paste: still no duplicate
  Object.defineProperty(dom.window.navigator, 'clipboard',
    { configurable: true, value: { writeText: async () => {}, readText: async () => payload } });
  document.querySelector('#btnPaste2').click();
  await settle(dom.window, 80);
  graph = exportedGraph(document);
  assert.equal(graph.customAttributes.length, 2, 're-paste creates no additional definitions');
  assert.equal(graph.customAttributes.some(d => d.id === 'x_1_2'), false);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});


test('a truncated DOT import is rejected and the document is preserved', async () => {
  // End-to-end sentinel for the parse-reject path: parseDot returning null
  // must leave the document untouched and report the failure. The unit
  // matrix for which inputs are rejected lives in dot-core.test.mjs.
  const saved = { title: 'keep-me-r14a', nodes: [
    {id:'n1', label:'One', x:0, y:0, order:0},
  ], edges: [] };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  await paste(document, dom.window, '#btnPasteDot', 'digraph G { subgraph child { }');
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 1, 'the truncated input does not import as an empty document');
  assert.match(toasts(document), /fail|no graph/i);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a CSV replace import that parses nothing preserves the document', async () => {
  const saved = DEFAULT_SAVED();
  const cases = [
    ['#btnPasteNodesCsv', 'id,label\n\n\n'],
    ['#btnPasteEdgesCsv', 'source_id,target_id\n\n\n'],
    ['#btnPasteMatrixCsv', 'label,A,B\n\n\n'],
  ];
  for(const [button, text] of cases){
    const {dom, errors} = createEditorDom(saved);
    const {document} = dom.window;
    await settle(dom.window, 60);
    await paste(document, dom.window, button, text);
    const graph = exportedGraph(document);
    assert.equal(graph.nodes.length, 2, `${button} preserves the nodes`);
    assert.equal(graph.edges.length, 1, `${button} preserves the edges`);
    assert.match(toasts(document), /nothing could be imported/i);
    assert.deepEqual(errors.map(e => e.message), []);
    dom.window.close();
  }
});


test('the editor’s own empty matrix export imports in replace mode and clears the edges', async () => {
  // The zero-parse guard added for garbage input must not refuse a valid
  // empty adjacency matrix: replacing with it is how a document’s edges are
  // cleared, and the previous head correctly did so.
  const saved = { title: 'keep-matrix-empty', nodes: [
    {id:'n1', label:'One', x:0, y:0, order:0},
    {id:'n2', label:'Two', x:120, y:0, order:1},
  ], edges: [{ id:'e1', from:'n1', to:'n2', weight:'1', label:'', directed:true }] };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  // Exactly what matrixCsv() writes for this document once it has no edges:
  // BOM + header row of labels + one all-empty row per node, CRLF separated.
  const emptyMatrix = '\ufeff,One,Two\r\nOne,,\r\nTwo,,\r\n';
  await paste(document, dom.window, '#btnPasteMatrixCsv', emptyMatrix);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 2, 'the nodes survive');
  assert.equal(graph.edges.length, 0, 'the empty matrix replace clears the stale edge');
  assert.match(toasts(document), /imported/i);
  assert.deepEqual(errors.map(e => e.message), []);
  // The freshly edgeless document exports the same file it imported. (The
  // export modal shows the payload in a <textarea>, whose value normalises
  // CRLF to LF — compare with line endings normalised too.)
  document.querySelector('#btnExportMatrixCsv').click();
  const exported = document.querySelector('.export-modal textarea').value;
  assert.equal(exported, emptyMatrix.replace(/\r\n/g, '\n'), 'the empty import round-trips through the exporter');
  document.querySelector('#expCloseBtn').click();
  dom.window.close();
});

test('a matrix whose columns do not resolve preserves the document', async () => {
  // Audit repro: label,Unknown / A,5 has a row whose endpoint resolves but
  // no column that can hold one. Committing zero edges from it would clear
  // the existing edge — the import must be refused as unrecognizable.
  const saved = { title: 'keep-matrix-unknown-cols', nodes: [
    {id:'n1', label:'A', x:0, y:0, order:0},
    {id:'n2', label:'B', x:120, y:0, order:1},
  ], edges: [{ id:'e1', from:'n1', to:'n2', weight:'1', label:'', directed:true }] };
  // Audit repro (round B): a row endpoint resolves but the only value
  // targets an unknown column. Audit repro (round C): one column resolves
  // and one does not — every populated cell is skipped, so the matrix is
  // not a coherent empty graph for this document. All must be refused.
  const cases = [
    'label,Unknown\nA,5\n',
    'label,Unknown\nA,\n',
    'label,A,Unknown\nA,,5\n',
    'label,A,Unknown\nA,\n',
    'label,X,Unknown\nA,1,2\n',
    'label,A\nX,5\nA,\n',
    // A populated cell beyond the header width (row wider than the header):
    // never an empty matrix — refuse.
    'label,A\nA,,5\n',
    // A separator-only cell splits into no weights — populated, unhonorable.
    'label,A\nA,";"\n',
    'label,A\nA,";;,;"\n',
  ];
  for(const text of cases){
    const {dom, errors} = createEditorDom(saved);
    const {document} = dom.window;
    await settle(dom.window, 60);
    await paste(document, dom.window, '#btnPasteMatrixCsv', text);
    const graph = exportedGraph(document);
    assert.equal(graph.nodes.length, 2, `${JSON.stringify(text)} keeps the nodes`);
    assert.equal(graph.edges.length, 1, `${JSON.stringify(text)} keeps the existing edge`);
    assert.match(toasts(document), /nothing could be imported/i, `${JSON.stringify(text)} reports the refusal`);
    assert.deepEqual(errors.map(e => e.message), []);
    dom.window.close();
  }
});

test('a populated cell beyond the header width is reported as skipped, not ignored', async () => {
  // General accounting, not just the zero-edge guard: the editor never
  // writes cells past the header width, so such a cell cannot be honored —
  // it must count in the skipped tally instead of vanishing from the toast.
  const saved = { title: 'keep-matrix-wide-row', nodes: [
    {id:'n1', label:'A', x:0, y:0, order:0},
    {id:'n2', label:'B', x:120, y:0, order:1},
  ], edges: [{ id:'e1', from:'n1', to:'n2', weight:'1', label:'', directed:true }] };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  await paste(document, dom.window, '#btnPasteMatrixCsv', 'label,A\nA,1,5\n');
  const graph = exportedGraph(document);
  assert.equal(graph.edges.length, 1, 'the honored cell becomes an edge');
  assert.equal(graph.edges[0].weight, '1');
  assert.match(toasts(document), /skipped/i, 'the extra populated cell is counted as skipped');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('appending a GraphML key whose id matches an existing definition of another scope remaps instead of stranding values', async () => {
  // The document has a graph-scoped "score". The appended file carries a
  // node-scoped "score" with values. The value must stay reachable: a
  // node-scope definition must exist, the value must bind to it, and a
  // subsequent GraphML export must carry both.
  const saved = { title: 'keep-scope', nodes: [{id:'n1', label:'One', x:0, y:0, order:0}], edges: [],
    customAttributes: [{ id:'score', scope:'graph', type:'string' }],
    graphCustom: { score: 'graph-value' } };
  const graphml = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="score" for="node" attr.name="score" attr.type="string"/>',
    '  <graph id="g" edgedefault="directed">',
    '    <node id="n2"><data key="score">42</data></node>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph = exportedGraph(document);
  assert.equal(graph.graphCustom?.score, 'graph-value', 'the existing graph-scope definition keeps serving the graph value');
  const nodeDefs = graph.customAttributes.filter(d => d.scope === 'node');
  assert.equal(nodeDefs.length, 1, 'the incoming node-scope definition survives the merge');
  assert.notEqual(nodeDefs[0].id, 'score', 'it was remapped away from the graph-scope id');
  const imported = graph.nodes.find(n => n.id !== 'n1');
  assert.equal(imported.custom?.[nodeDefs[0].id], '42', 'the value is bound to the remapped node-scope definition');
  assert.equal(imported.custom?.score, undefined, 'the value does not bind to the graph-scope definition');
  document.querySelector('#btnExportGraphml').click();
  const exported = document.querySelector('.export-modal textarea').value;
  assert.ok(exported.includes(nodeDefs[0].id), 'the export carries the remapped definition');
  assert.ok(exported.includes('42'), 'the export carries the value');
  document.querySelector('#expCloseBtn').click();
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('GraphML custom keys for="all" and with no for default import into every scope', async () => {
  const saved = { title: 'keep-allkeys',
    nodes: [{id:'n1', label:'One', x:0, y:0, order:0}],
    edges: [{ id:'e1', from:'n1', to:'n1', weight:'', label:'', directed:true }] };
  const graphml = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="mood" for="all" attr.name="mood" attr.type="string"><default>alright</default></key>',
    '  <key id="flag" attr.name="flag" attr.type="boolean"/>',
    '  <graph id="g" edgedefault="directed">',
    '    <data key="mood">calm</data>',
    '    <data key="flag">true</data>',
    '    <node id="n2"><data key="mood">happy</data><data key="flag">false</data></node>',
    '    <edge id="e2" source="n2" target="n2"><data key="flag">true</data></edge>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph = exportedGraph(document);
  const defs = graph.customAttributes;
  assert.equal(defs.length, 6, 'mood expands to graph/node/edge and flag expands to graph/node/edge');
  const moodDefs = Object.fromEntries(defs.filter(d => d.dataKey === 'mood').map(d => [d.scope, d]));
  const flagDefs = Object.fromEntries(defs.filter(d => d.dataKey === 'flag').map(d => [d.scope, d]));
  for(const scope of ['graph', 'node', 'edge']){
    assert.ok(moodDefs[scope], `mood has a ${scope}-scope definition`);
    assert.ok(flagDefs[scope], `flag has a ${scope}-scope definition`);
    assert.equal(moodDefs[scope].type, 'string');
    assert.equal(flagDefs[scope].type, 'boolean');
  }
  assert.equal(graph.graphCustom?.mood, 'calm', 'graph value imported');
  assert.equal(graph.graphCustom?.flag, true, 'graph boolean coerced');
  const n2 = graph.nodes.find(n => n.label !== 'One' || n.custom);
  assert.equal(n2.custom?.[moodDefs.node.id], 'happy', 'node value imported');
  assert.equal(n2.custom?.[flagDefs.node.id], false, 'node boolean coerced');
  const e2 = graph.edges.find(e => e.custom);
  assert.equal(e2.custom?.[flagDefs.edge.id], true, 'edge value imported');
  assert.equal(e2.custom?.[moodDefs.edge.id], 'alright', 'the for="all" key default applies where no explicit value is given');
  assert.match(toasts(document), /imported/i);
  assert.deepEqual(errors.map(e => e.message), []);
  // Re-appending the same file must not grow the definition set: the
  // expansion defs carry provenance and resolve to themselves.
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph2 = exportedGraph(document);
  assert.equal(graph2.customAttributes.length, 6, 're-importing reuses the expanded definitions');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a persisted document with the same custom id in two scopes is healed at load', async () => {
  // A hand-edited or legacy save can hold "score" as both a graph-scope and
  // a node-scope definition. sanitizeState must keep the first, mint the
  // second a fresh id and rebind this scope's values — never drop them.
  const saved = { title: 'cross-scope-load',
    nodes: [{id:'n1', label:'One', x:0, y:0, order:0, custom:{score:'7'}}],
    edges: [],
    customAttributes: [
      { id:'score', scope:'graph', type:'string' },
      { id:'score', scope:'node', type:'int' },
    ],
    graphCustom: { score: 'graph-value' } };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  const graph = exportedGraph(document);
  assert.equal(graph.customAttributes.length, 2, 'both definitions survive');
  const graphDef = graph.customAttributes.find(d => d.scope === 'graph');
  const nodeDef = graph.customAttributes.find(d => d.scope === 'node');
  assert.equal(graphDef.id, 'score', 'the first definition keeps the bare id');
  assert.equal(graphDef.type, 'string');
  assert.notEqual(nodeDef.id, 'score', 'the second scope is renamed, not dropped');
  assert.equal(nodeDef.type, 'int', 'the renamed definition keeps its type');
  assert.equal(graph.graphCustom.score, 'graph-value', 'graph value stays bound to the graph definition');
  assert.equal(graph.nodes[0].custom?.[nodeDef.id], 7, 'node value moved onto the renamed definition, coerced');
  assert.equal(graph.nodes[0].custom?.score, undefined, 'no value leaks onto the graph definition');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('appending the same node-scoped GraphML twice reuses one definition instead of splitting the property', async () => {
  // A graph-scoped definition already occupies the id "score". The first
  // append mints a fresh id for the incoming node-scope property; the second
  // append of the SAME file must resolve to that mint instead of minting
  // another one — otherwise one property splits across definitions and the
  // definition limit drains.
  const saved = { title: 'keep-find1', nodes: [{id:'n1', label:'One', x:0, y:0, order:0}], edges: [],
    customAttributes: [{ id:'score', scope:'graph', type:'string' }],
    graphCustom: { score: 'graph-value' } };
  const graphml = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="score" for="node" attr.name="score" attr.type="string"/>',
    '  <graph id="g" edgedefault="directed">',
    '    <node id="n2"><data key="score">42</data></node>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const first = exportedGraph(document);
  assert.equal(first.customAttributes.length, 2, 'the incoming definition survived the merge');
  const nodeDef = first.customAttributes.find(d => d.scope === 'node');
  assert.ok(nodeDef, 'a node-scope definition exists');
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const second = exportedGraph(document);
  assert.equal(second.customAttributes.length, 2, 'the second append reuses the minted definition');
  const nodeDefs = second.customAttributes.filter(d => d.scope === 'node');
  assert.equal(nodeDefs.length, 1, 'still exactly one node-scope score definition');
  const importedNodes = second.nodes.filter(n => n.custom);
  assert.equal(importedNodes.length, 2, 'both imports added nodes carrying the value');
  for(const node of importedNodes){
    assert.equal(node.custom?.[nodeDef.id], '42', 'both nodes bind the value to the same definition');
    assert.equal(node.custom?.score, undefined, 'the value never binds to the graph-scope id');
  }
  assert.equal(second.graphCustom?.score, 'graph-value', 'the graph-scope property is untouched');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('replacing the same for="all" GraphML twice keeps provenance, so a later append reuses the definitions', async () => {
  // Replace import is wholesale; the second replace of the same file must
  // resolve to the SAME definitions and re-stamp their provenance markers.
  // Then appending the file must not create new node or edge definitions.
  const graphml = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="mood" for="all" attr.name="mood" attr.type="string"><default>alright</default></key>',
    '  <key id="flag" attr.name="flag" attr.type="boolean"/>',
    '  <graph id="g" edgedefault="directed">',
    '    <data key="mood">calm</data>',
    '    <node id="n1"><data key="mood">happy</data></node>',
    '    <edge id="e1" source="n1" target="n1"><data key="flag">true</data></edge>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await settle(dom.window, 60);
  await paste(document, dom.window, '#btnPasteGraphml', graphml);   // replace
  const first = exportedGraph(document);
  const idsBefore = first.customAttributes.map(d => d.id + ':' + d.scope).sort();
  const byKey = (g, key, scope) => g.customAttributes.find(d => d.dataKey === key && d.scope === scope);
  assert.ok(byKey(first, 'mood', 'edge'), 'expansion produced an edge-scope mood definition');
  assert.ok(first.customAttributes.every(d => d.dataKey === 'mood' || d.dataKey === 'flag'), 'every definition carries provenance');
  await paste(document, dom.window, '#btnPasteGraphml', graphml);   // replace again
  const second = exportedGraph(document);
  assert.deepEqual(second.customAttributes.map(d => d.id + ':' + d.scope).sort(), idsBefore, 'the second replace resolves to the same definitions');
  assert.ok(second.customAttributes.every(d => d.dataKey === 'mood' || d.dataKey === 'flag'), 'provenance markers survive the reuse');
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);   // append
  const third = exportedGraph(document);
  assert.equal(third.customAttributes.length, idsBefore.length, 'the append creates no new definitions');
  const edgeMood = byKey(third, 'mood', 'edge');
  const importedEdges = third.edges.filter(e => e.custom);
  assert.ok(importedEdges.length >= 1, 'the appended edge carries its custom values');
  for(const edge of importedEdges){
    assert.equal(edge.custom?.[edgeMood.id], 'alright', 'the edge value binds the original edge-scope definition');
  }
  assert.ok(third.graphCustom?.mood !== undefined, 'the graph value is retained');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a persisted reserved-id cross-scope pair migrates to distinct ids with values bound per scope', async () => {
  // "shape" is a reserved (built-in) id. A saved document carrying it as both
  // a graph-scope and a node-scope definition must migrate to two distinct
  // ids — with each scope's values bound to its own definition — instead of
  // both value scopes binding to the same (last) migrated id.
  const saved = { title: 'shape-xscope',
    nodes: [{id:'n1', label:'One', x:0, y:0, order:0, custom:{shape:'node-value'}}],
    edges: [],
    customAttributes: [
      { id:'shape', scope:'graph', type:'string' },
      { id:'shape', scope:'node', type:'string' },
    ],
    graphCustom: { shape: 'graph-value' } };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  const graph = exportedGraph(document);
  const graphDef = graph.customAttributes.find(d => d.scope === 'graph');
  const nodeDef = graph.customAttributes.find(d => d.scope === 'node');
  assert.equal(graph.customAttributes.length, 2, 'both definitions survive');
  assert.notEqual(graphDef.id, nodeDef.id, 'the reserved cross-scope pair mints distinct ids');
  assert.equal(graph.graphCustom?.[graphDef.id], 'graph-value', 'the graph value binds the graph definition');
  assert.equal(graph.nodes[0].custom?.[nodeDef.id], 'node-value', 'the node value binds the node definition');
  assert.equal(graph.nodes[0].custom?.[graphDef.id], undefined, 'node values never leak onto the graph definition');
  document.querySelector('#btnExportGraphml').click();
  const exported = document.querySelector('.export-modal textarea').value;
  assert.ok(exported.includes(graphDef.id) && exported.includes('graph-value'), 'the GraphML export carries the graph property');
  assert.ok(exported.includes(nodeDef.id) && exported.includes('node-value'), 'the GraphML export carries the node property');
  document.querySelector('#expCloseBtn').click();
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a JSON replace import binds values to the definitions after a scope rename', async () => {
  // One document carries "score" as both a graph- and a node-scope definition.
  // The node definition is re-created under a fresh id on import — its values
  // must follow onto that id, in the document and in the GraphML export.
  const payload = { title: 'json-replace',
    nodes: [{id:'m1', label:'M', x:0, y:0, order:0, custom:{score:'node-value'}}],
    edges: [],
    customAttributes: [
      { id:'score', scope:'graph', type:'string' },
      { id:'score', scope:'node', type:'string' },
    ],
    graphCustom: { score: 'graph-value' } };
  const saved = { title: 'before', nodes: [{id:'n1', label:'One', x:0, y:0, order:0}], edges: [] };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  await paste(document, dom.window, '#btnPasteJson', JSON.stringify(payload)); // replace
  const graph = exportedGraph(document);
  const graphDef = graph.customAttributes.find(d => d.scope === 'graph');
  const nodeDef = graph.customAttributes.find(d => d.scope === 'node');
  assert.equal(graph.customAttributes.length, 2, 'both definitions survive the replace');
  assert.notEqual(nodeDef.id, graphDef.id, 'the node definition is re-created under a fresh id');
  assert.equal(graph.graphCustom?.[graphDef.id], 'graph-value', 'the graph value binds the graph definition');
  const m1 = graph.nodes.find(n => n.label === 'M');
  assert.equal(m1.custom?.[nodeDef.id], 'node-value', 'the node value binds the renamed definition');
  assert.equal(m1.custom?.score, undefined, 'no value strands on the carried id');
  document.querySelector('#btnExportGraphml').click();
  const exported = document.querySelector('.export-modal textarea').value;
  assert.ok(exported.includes(graphDef.id) && exported.includes('graph-value'), 'the export carries the graph property');
  assert.ok(exported.includes(nodeDef.id) && exported.includes('node-value'), 'the export carries the node property');
  document.querySelector('#expCloseBtn').click();
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('appending an import that carries score and score_1 keeps both properties distinct', async () => {
  // With a graph-scope "score" present, appending a node whose custom
  // properties are "score" and "score_1" must keep both: the minted id for
  // "score" has to dodge the incoming "score_1", and the two values must not
  // overwrite each other.
  const saved = { title: 'keep-mint',
    nodes: [{id:'n1', label:'One', x:0, y:0, order:0}], edges: [],
    customAttributes: [{ id:'score', scope:'graph', type:'string' }],
    graphCustom: { score: 'graph-value' } };
  const payload = { title: 'append-mint',
    nodes: [{id:'m1', label:'M', x:0, y:0, order:0, custom:{score:'sc', score_1:'sc1'}}],
    edges: [],
    customAttributes: [
      { id:'score', scope:'node', type:'string' },
      { id:'score_1', scope:'node', type:'string' },
    ] };
  // --- JSON append
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, dom.window, '#btnPasteJson', JSON.stringify(payload));
  const graph = exportedGraph(document);
  assert.equal(graph.customAttributes.length, 3, 'all three definitions survive');
  const nodeDefs = Object.fromEntries(graph.customAttributes.filter(d => d.scope === 'node').map(d => [d.id, true]));
  assert.equal(Object.keys(nodeDefs).length, 2, 'two distinct node-scope definitions');
  assert.ok(!nodeDefs['score'], 'the minted definition did not capture the graph-scope id');
  const m1 = graph.nodes.find(n => n.label === 'M');
  const custom = m1.custom ?? {};
  assert.equal(Object.keys(custom).length, 2, 'both values survive, none overwritten');
  // The incoming "score_1" definition keeps its id (it was free); the minted
  // id for "score" had to dodge it, so it is not "score_1".
  assert.equal(custom['score_1'], 'sc1', 'the score_1 property keeps its definition and value');
  const mintedId = Object.keys(custom).find(k => k !== 'score_1');
  assert.ok(mintedId && mintedId !== 'score', 'the score property was re-created under a fresh id');
  assert.equal(custom[mintedId], 'sc', 'its value followed onto the fresh id');
  assert.equal(graph.graphCustom?.score, 'graph-value', 'the graph-scope property is untouched');
  assert.deepEqual(errors.map(e => e.message), []);
  // --- GraphML append, same expectation
  const dom2ctx = createEditorDom(saved);
  const {document: document2} = dom2ctx.dom.window;
  await settle(dom2ctx.dom.window, 60);
  document2.querySelector('#optImportAppend').checked = true;
  const graphml = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="score" for="node" attr.name="score" attr.type="string"/>',
    '  <key id="score_1" for="node" attr.name="score_1" attr.type="string"/>',
    '  <graph id="g" edgedefault="directed">',
    '    <node id="m1"><data key="score">sc</data><data key="score_1">sc1</data></node>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  await paste(document2, dom2ctx.dom.window, '#btnPasteGraphml', graphml);
  const graph2 = exportedGraph(document2);
  assert.equal(graph2.customAttributes.length, 3, 'all three definitions survive the GraphML append');
  const m1g = graph2.nodes.find(n => n.label !== 'One');
  assert.equal(Object.keys(m1g.custom ?? {}).length, 2, 'both values survive the GraphML append');
  const values = Object.fromEntries(Object.entries(m1g.custom ?? {}));
  assert.deepEqual(new Set(Object.values(values)), new Set(['sc', 'sc1']), 'neither value is overwritten');
  assert.deepEqual(dom2ctx.errors.map(e => e.message), []);
  dom2ctx.dom.window.close();
  dom.window.close();
});
