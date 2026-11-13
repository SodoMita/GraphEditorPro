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

test('DOT export of a mixed graph stays valid: digraph uses only -> and direction lives in dir', async () => {
  // A graph with both a mutual and an undirected edge has to be a `digraph`
  // (for dir=both), and DOT forbids `--` inside a digraph. Emitting `--` for
  // the undirected member made Graphviz reject the whole file.
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0, order:0}, {id:'n2', label:'B', x:100, y:0, order:1}, {id:'n3', label:'C', x:200, y:0, order:2}],
    edges: [
      {id:'e1', from:'n1', to:'n2', label:'', weight:'1', directed:true, direction:'mutual'},
      {id:'e2', from:'n2', to:'n3', label:'', weight:'1', directed:false, direction:'undirected'},
    ],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportDot').click();
  const dot = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();

  assert.ok(dot.startsWith('digraph '), 'a mixed graph is exported as digraph');
  const edgeLines = dot.split('\n').filter(line => /\s(?:->|--)\s/.test(line));
  assert.equal(edgeLines.length, 2);
  assert.ok(edgeLines.every(line => line.includes('->')), 'no -- operator inside a digraph');
  assert.ok(!dot.includes(' -- '), 'the whole document is free of --');
  assert.match(edgeLines[0], /dir="both"/, 'mutual edge keeps both arrowheads via dir');
  assert.match(edgeLines[1], /dir="none"/, 'undirected edge keeps no arrowheads via dir');

  // And those two directions survive the import.
  await paste(document, dom.window, '#btnPasteDot', dot);
  const graph = exportedGraph(document);
  assert.deepEqual(graph.edges.map(e => e.direction).sort(), ['mutual', 'undirected']);
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
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:qvge="http://qvge.github.io/graphml">',
    '  <key id="note" for="graph" attr.name="note" attr.type="string" qvge:kind="custom-attribute"/>',
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


test('at the definition limit, repeated pastes reuse the remapped definition instead of dropping the value', async () => {
  // 1998 filler node-scope definitions + one graph-scoped 'tag' = 1999.
  // The carried clipboard definition 'tag' (node scope) conflicts on paste.
  const fillers = Array.from({ length: 1998 }, (_, i) => ({ id: 'fill_' + i, scope: 'node', type: 'string' }));
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
  assert.equal(graph.customAttributes.length, 2000, 'the limit is still respected exactly');
  const tag1 = graph.customAttributes.find(d => d.id === 'tag_1');
  assert.equal(tag1?.name, 'tag', 'the first paste re-created the conflict as tag_1 with the carried id recorded as its name');
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

test('a conflicting paste keeps the recorded name so re-paste and import-append reuse the definition', async () => {
  // Target document: graph-scope x_1 already exists, forcing a mint when the
  // carried node-scope x_1 (a foreign key "x" with attr.name "fill color",
  // kept under the name it was read with) is pasted.
  const saved = { title: 'cap-provenance', nodes: [{id:'b1', label:'Keep', x:0, y:0, order:0}], edges: [],
    customAttributes: [{ id: 'x_1', scope: 'graph', type: 'string' }] };
  // The clipboard payload carries a re-export of the definition — including
  // the foreign key id it was minted from (our payloads always re-export it).
  const payload = JSON.stringify({ type: 'graph-editor-clipboard',
    nodes: [{ id: 'c1', label: 'Carried', x: 30, y: 30, order: 0, custom: { x_1: 'red' } }],
    edges: [], externalEdges: [],
    customAttributes: [{ id: 'x_1', scope: 'node', type: 'string', name: 'fill color', origin: 'x' }] });
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
  assert.equal(minted?.name, 'fill color', 'the minted definition keeps the name recorded by the source key');

  // A second identical paste must reuse x_1_1, never mint x_1_2.
  clip(); document.querySelector('#btnPaste2').click(); await settle(dom.window, 80);
  graph = exportedGraph(document);
  assert.equal(graph.customAttributes.length, 2, 're-pasting creates no new definition');
  assert.equal(graph.customAttributes.some(d => d.id === 'x_1_2'), false, 'no x_1_2 is minted');

  // Appending the original GraphML must find x_1_1 via its recorded name and
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
  // Fresh document has a FRUIT property x_1 whose recorded name is fruit.
  const saved = { title: 'batch-provenance', nodes: [{id:'b1', label:'Keep', x:0, y:0, order:0}], edges: [],
    customAttributes: [{ id: 'x_1', scope: 'node', type: 'string', name: 'fruit' }] };
  const payload = JSON.stringify({ type: 'graph-editor-clipboard',
    nodes: [
      { id: 'c1', label: 'CarriedA', x: 30, y: 30, order: 0, custom: { x_1: 'red' } },
      { id: 'c2', label: 'CarriedB', x: 90, y: 30, order: 1, custom: { x_1: 'blue' } },
    ],
    edges: [], externalEdges: [],
    customAttributes: [{ id: 'x_1', scope: 'node', type: 'string', name: 'vehicle' }] });
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
  assert.equal(minted[0].name, 'vehicle', 'the minted definition keeps the carried name');
  assert.equal(graph.customAttributes.find(d => d.id === 'x_1')?.name, 'fruit', 'the fruit definition is untouched');
  const carrieds = graph.nodes.filter(n => n.label.startsWith('Carried'));
  assert.equal(carrieds.length, 2);
  for(const n of carrieds) assert.equal(n.custom?.x_1_1, n.label === 'CarriedA' ? 'red' : 'blue', 'each value lands on the minted definition');
  assert.equal(graph.customAttributes.length, 2, 'no orphaned or duplicated definitions');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});


test('a matching id with different provenance is never merged into the existing definition', async () => {
  // The document's node x_1 came from a key named fruit (recorded name).
  const saved = { title: 'fruit-doc', nodes: [{id:'b1', label:'Keep', x:0, y:0, order:0}], edges: [],
    customAttributes: [{ id: 'x_1', scope: 'node', type: 'string', name: 'fruit' }] };
  // The clipboard carries a node property x_1 from a key named vehicle.
  const payload = JSON.stringify({ type: 'graph-editor-clipboard',
    nodes: [{ id: 'c1', label: 'Carried', x: 30, y: 30, order: 0, custom: { x_1: 'vehicle-value' } }],
    edges: [], externalEdges: [],
    customAttributes: [{ id: 'x_1', scope: 'node', type: 'string', name: 'vehicle' }] });
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  Object.defineProperty(dom.window.navigator, 'clipboard',
    { configurable: true, value: { writeText: async () => {}, readText: async () => payload } });
  document.querySelector('#btnPaste2').click();
  await settle(dom.window, 80);
  let graph = exportedGraph(document);
  assert.equal(graph.customAttributes.find(d => d.id === 'x_1')?.name, 'fruit', 'the fruit definition is untouched');
  const vehicle = graph.customAttributes.find(d => d.name === 'vehicle');
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

test('GraphML custom keys for="all" and with no for import into every scope', async () => {
  // A key declared without `for` (or explicitly for "all") is one declaration
  // covering every scope — dropping the node and edge values on import is
  // silent data loss while the toast says success. GraphML's scope is kept
  // 1:1 in the stored document: ONE definition with scope 'all' carries the
  // property on every scope under the same id.
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
  const byKey = (g, name, scope) => g.customAttributes.find(d => (d.name ?? d.id) === name && d.scope === scope);
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph = exportedGraph(document);
  for(const name of ['mood', 'flag']){
    assert.ok(byKey(graph, name, 'all'), `${name} has an all-scope definition`);
  }
  assert.equal(graph.customAttributes.length, 2, 'one definition per key, scope all');
  assert.equal(graph.graphCustom?.mood, 'calm', 'graph value imported');
  assert.equal(graph.graphCustom?.flag, true, 'graph boolean coerced');
  const allMood = byKey(graph, 'mood', 'all').id;
  const allFlag = byKey(graph, 'flag', 'all').id;
  const n2 = graph.nodes.find(n => n.id !== 'n1');
  assert.equal(n2.custom?.[allMood], 'happy', 'node value imported under the shared id');
  assert.equal(n2.custom?.[allFlag], false, 'node boolean coerced');
  const e2 = graph.edges.find(e => e.id !== 'e1');
  assert.equal(e2.custom?.[allFlag], true, 'edge value imported');
  assert.equal(e2.custom?.[allMood], 'alright', 'the for="all" key default applies where no value is given');
  assert.match(toasts(document), /imported/i);
  assert.deepEqual(errors.map(e => e.message), []);
  // Re-appending the same file must not grow the definition set: the
  // recorded names resolve each definition back to itself.
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph2 = exportedGraph(document);
  assert.equal(graph2.customAttributes.length, 2, 're-importing reuses the all-scope definitions');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a persisted document with the same custom id in two scopes is collapsed at load', async () => {
  // A hand-edited or legacy save can hold "score" as both a graph-scope and
  // a node-scope definition. Two definitions cannot share an id — values are
  // keyed by id alone — so the first definition wins and the duplicate is
  // dropped, whatever scope it claimed. The stored values all survive load;
  // the loser simply has no definition left to bind them.
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
  assert.equal(graph.customAttributes.length, 1, 'the duplicate definition is collapsed');
  assert.equal(graph.customAttributes[0].scope, 'graph', 'the first definition keeps the id');
  assert.equal(graph.customAttributes[0].type, 'string');
  assert.equal(graph.graphCustom.score, 'graph-value', 'graph value stays bound to the graph definition');
  assert.equal(graph.nodes[0].custom?.score, '7', 'the orphaned value is kept, not destroyed');
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

test('replacing the same for="all" GraphML twice keeps recorded names, so a later append reuses the definitions', async () => {
  // Replace import is wholesale; the second replace of the same file must
  // resolve to the SAME definitions. Then appending the file must not create
  // new node or edge definitions.
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
  const byKey = (g, name, scope) => g.customAttributes.find(d => (d.name ?? d.id) === name && d.scope === scope);
  await paste(document, dom.window, '#btnPasteGraphml', graphml);   // replace
  const first = exportedGraph(document);
  const idsBefore = first.customAttributes.map(d => d.id + ':' + d.scope).sort();
  assert.ok(byKey(first, 'mood', 'all'), 'the for="all" key mints an all-scope definition');
  assert.ok(first.customAttributes.every(d => (d.name ?? d.id) === 'mood' || (d.name ?? d.id) === 'flag'), 'every definition records the property name it was made from');
  assert.equal(first.graphCustom?.mood, 'calm', 'the graph value is imported');
  await paste(document, dom.window, '#btnPasteGraphml', graphml);   // replace again
  const second = exportedGraph(document);
  assert.deepEqual(second.customAttributes.map(d => d.id + ':' + d.scope).sort(), idsBefore, 'the second replace resolves to the same definitions');
  assert.ok(second.customAttributes.every(d => (d.name ?? d.id) === 'mood' || (d.name ?? d.id) === 'flag'), 'recorded names survive the reuse');
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);   // append
  const third = exportedGraph(document);
  assert.equal(third.customAttributes.length, idsBefore.length, 'the append creates no new definitions');
  const edgeMood = byKey(third, 'mood', 'all');
  const importedEdges = third.edges.filter(e => e.custom);
  assert.ok(importedEdges.length >= 1, 'the appended edge carries its custom values');
  for(const edge of importedEdges){
    assert.equal(edge.custom?.[edgeMood.id], 'alright', 'the edge value binds the same all-scope definition (the key default applies)');
  }
  assert.ok(third.graphCustom?.mood !== undefined, 'the graph value is retained');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a persisted cross-scope same-id pair is collapsed to the first definition', async () => {
  // A saved document can carry "shape" as both a graph-scope and a
  // node-scope definition. Two definitions cannot share an id — values are
  // keyed by id alone — so the first wins and the duplicate is dropped,
  // whatever scope it claimed (the load path never renames). The stored
  // values all survive load; the loser simply has no definition left.
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
  assert.equal(graph.customAttributes.length, 1, 'the pair collapses to the first definition');
  assert.equal(graphDef.id, 'shape', 'the first definition keeps the id');
  assert.equal(graph.graphCustom?.shape, 'graph-value', 'the graph value binds the surviving definition');
  assert.equal(graph.nodes[0].custom?.shape, 'node-value', 'the orphaned node value is kept, not destroyed');
  document.querySelector('#btnExportGraphml').click();
  const exported = document.querySelector('.export-modal textarea').value;
  // `shape` is also a built-in key id, so the definition exports de-collided
  // (`shape2`) with qvge:id pointing back at its own id.
  assert.match(exported, /<key id="shape2" for="graph"[^>]*qvge:id="shape"/, 'the GraphML export carries the surviving definition');
  assert.ok(/<data key="shape2">graph-value<\/data>/.test(exported), 'the GraphML export carries the graph value');
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

test('a re-created key reused for two incoming properties never overwrites the other', async () => {
  // Step 1: a graph-scoped score exists; appending a node-scoped score mints
  // score_1 for it. Step 2: a file with DISTINCT node keys score and score_1
  // is appended. The migrated score_1 may not be reused for either incoming
  // key — the file's own score_1 is a different property, and the incoming
  // score may not reuse an id the file itself declares — so both keys get
  // their own definitions. The file must arrive lossless in both key orders,
  // and re-appending it must not grow the definitions.
  const saved = { title: 'keep-claim',
    nodes: [{id:'n1', label:'One', x:0, y:0, order:0}], edges: [],
    customAttributes: [{ id:'score', scope:'graph', type:'string' }],
    graphCustom: { score: 'graph-value' } };
  const file1 = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="score" for="node" attr.name="score" attr.type="string"/>',
    '  <graph id="g" edgedefault="directed">',
    '    <node id="n2"><data key="score">42</data></node>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const step2For = keys => [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    ...keys.map(k => `  <key id="${k}" for="node" attr.name="${k}" attr.type="string"/>`),
    '  <graph id="g" edgedefault="directed">',
    '    <node id="m"><data key="score">73</data><data key="score_1">99</data></node>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  for(const keys of [['score', 'score_1'], ['score_1', 'score']]){
    const {dom, errors} = createEditorDom(saved);
    const {document} = dom.window;
    await settle(dom.window, 60);
    document.querySelector('#optImportAppend').checked = true;
    await paste(document, dom.window, '#btnPasteGraphml', file1);
    const after1 = exportedGraph(document);
    const migrated = after1.customAttributes.find(d => d.scope === 'node');
    assert.equal(migrated.id, 'score_1', `re-created definition id (key order: ${keys.join(',')})`);
    await paste(document, dom.window, '#btnPasteGraphml', step2For(keys));
    const after2 = exportedGraph(document);
    assert.equal(after2.customAttributes.length, 4, `the migrated definition survives and both incoming properties get their own (key order: ${keys.join(',')})`);
    const n2 = after2.nodes.find(n => n.id === 'n2');
    assert.equal(n2?.custom?.[migrated.id], '42', `the migrated definition keeps its original value (key order: ${keys.join(',')})`);
    const m = after2.nodes.find(n => n.id === 'm');
    const bound = Object.entries(m.custom ?? {});
    assert.equal(bound.length, 2, `no value overwritten (key order: ${keys.join(',')})`);
    assert.deepEqual(new Set(Object.values(Object.fromEntries(bound))), new Set(['73', '99']), `both values present (key order: ${keys.join(',')})`);
    assert.ok(!Object.prototype.hasOwnProperty.call(m.custom ?? {}, migrated.id), `the migrated id is not re-used for this file's properties (key order: ${keys.join(',')})`);
    assert.equal(after2.graphCustom?.score, 'graph-value', 'the graph-scope property is untouched');
    // Re-appending the same file resolves to the same four definitions.
    await paste(document, dom.window, '#btnPasteGraphml', step2For(keys));
    const after3 = exportedGraph(document);
    assert.equal(after3.customAttributes.length, 4, `re-appending creates no new definitions (key order: ${keys.join(',')})`);
    document.querySelector('#btnExportGraphml').click();
    const exported = document.querySelector('.export-modal textarea').value;
    assert.ok(exported.includes('73') && exported.includes('99'), 'the export carries both values');
    document.querySelector('#expCloseBtn').click();
    assert.deepEqual(errors.map(e => e.message), []);
    dom.window.close();
  }
});
test('two distinct incoming keys named like an existing property never merge into one definition', async () => {
  // Regression: the reuse scan used to match by name and scope without ever
  // marking the match as claimed, so two distinct key ids of one file both
  // remapped onto the same existing definition and the first value was
  // overwritten by the second.
  const file1 = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="metric" for="node" attr.name="metric" attr.type="string"/>',
    '  <graph id="g" edgedefault="directed">',
    '    <node id="a"><data key="metric">zero</data></node>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  // The appended file declares two distinct keys, both recorded as "metric",
  // with a value each on one node. Both are different properties: the file
  // key ids are what distinguish them.
  const file2 = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="m1" for="node" attr.name="metric" attr.type="string"/>',
    '  <key id="m2" for="node" attr.name="metric" attr.type="string"/>',
    '  <graph id="g" edgedefault="directed">',
    '    <node id="b"><data key="m1">first</data><data key="m2">second</data></node>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await settle(dom.window, 60);
  await paste(document, dom.window, '#btnPasteGraphml', file1);
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, dom.window, '#btnPasteGraphml', file2);
  const graph = exportedGraph(document);
  const values = graph.nodes.find(n => n.id === 'b')?.custom ?? {};
  assert.equal(Object.values(values).filter(v => v === 'first').length, 1, 'the first value survives');
  assert.equal(Object.values(values).filter(v => v === 'second').length, 1, 'the second value survives');
  assert.equal(Object.keys(values).length, 2, 'the two keys keep their own definitions, neither overwrites the other');
  assert.ok(!Object.prototype.hasOwnProperty.call(values, 'metric'), 'neither incoming property is folded into the existing same-named definition');
  assert.equal(graph.nodes.find(n => n.id === 'a')?.custom?.metric, 'zero', 'the existing property is untouched');
  assert.equal(graph.customAttributes.length, 3, 'the existing definition plus one new definition per incoming key id');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});
test('DOT export of a fully undirected graph still uses graph and --', async () => {
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0, order:0}, {id:'n2', label:'B', x:100, y:0, order:1}],
    edges: [{id:'e1', from:'n1', to:'n2', label:'', weight:'1', directed:false, direction:'undirected'}],
  };
  const {dom} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportDot').click();
  const dot = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  assert.ok(dot.startsWith('graph '), 'an all-undirected graph keeps the graph header');
  assert.match(dot, /n1 -- n2/, 'and its -- operator');
  assert.ok(!dot.includes('->'), 'no -> operator inside a graph');
  dom.window.close();
});

test('GraphML export never repeats a built-in key id, even when a custom definition collides', async () => {
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0, order:0}, {id:'n2', label:'B', x:100, y:0, order:1}],
    edges: [{id:'e1', from:'n1', to:'n2', label:'', weight:'1', directed:true, direction:'directed', arrowSize:20}],
    // A document from before `arrowSize` became a built-in key.
    customAttributes: [{id:'arrowSize', scope:'edge', type:'double'}, {id:'capacity', scope:'edge', type:'int'}],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportGraphml').click();
  const graphml = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();

  const keyIds = [...graphml.matchAll(/<key id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(keyIds).size, keyIds.length, 'every <key> id is unique');
  assert.equal(keyIds.filter(id => id === 'arrowSize').length, 1, 'exactly one arrowSize key');
  // Definitions live in their own namespace, so a definition called `arrowSize`
  // and the built-in key of that name no longer fight over the same id.
  // Definitions keep their own id and are marked, so the built-in key and the
  // definition of the same name coexist without sharing an id.
  assert.ok(keyIds.includes('arrowSize'), 'the definition keeps its id');
  assert.ok(keyIds.includes('capacity'), 'and so does the non-colliding one');
  // The built-in key still carries the value, and the import restores it.
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph = exportedGraph(document);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].arrowSize, 20, 'arrowSize survives the round-trip');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('an unmarked key that binds to a built-in field never becomes a definition', async () => {
  // Foreign files have no provenance marker, so the only safe question is
  // whether the importer reads that attr.name as a built-in for that scope.
  // If it does, the <data> feeds one of our fields and a definition for it
  // would be one the app could never round-trip — a phantom.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    // our own keys -> built-in, never definitions
    '  <key id="label" for="node" attr.name="label" attr.type="string"/>',
    '  <key id="weight" for="edge" attr.name="weight" attr.type="string"/>',
    '  <key id="edgeStrokeStyle" for="edge" attr.name="style" attr.type="string"/>',
    '  <key id="arrowSize" for="edge" attr.name="arrow.size" attr.type="double"/>',
    // the same names under foreign ids -> still built-in, still no definition
    '  <key id="k" for="edge" attr.name="arrow.size" attr.type="double"/>',
    '  <key id="k2" for="edge" attr.name="style" attr.type="string"/>',
    '  <key id="k3" for="edge" attr.name="stroke.size" attr.type="double"/>',
    '  <key id="k4" for="node" attr.name="stroke.color" attr.type="string"/>',
    // the aliases the importer reads -> built-in too, so no phantom definitions
    '  <key id="style" for="edge" attr.name="style" attr.type="string"/>',
    '  <key id="name" for="node" attr.name="name" attr.type="string"/>',
    '  <key id="fillcolor" for="node" attr.name="fillcolor" attr.type="string"/>',
    '  <key id="value" for="edge" attr.name="value" attr.type="string"/>',
    '  <key id="arrowsize" for="edge" attr.name="arrowsize" attr.type="double"/>',
    '  <key id="posx" for="node" attr.name="posx" attr.type="double"/>',
    // a name we never read -> the user's definition, kept
    '  <key id="score" for="node" attr.name="score" attr.type="double"/>',
    '  <graph edgedefault="directed">',
    '    <node id="n1"><data key="label">A</data><data key="fillcolor">#ff0000</data><data key="posx">17</data></node>',
    '    <node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"><data key="weight">4</data><data key="edgeStrokeStyle">dashed</data><data key="k">30</data><data key="value">7</data></edge>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);

  const rows = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(rows, ['score'], 'only the name we never read stays a definition');

  const graph = exportedGraph(document);
  assert.equal(graph.nodes[0].label, 'A', 'label still binds');
  assert.equal(graph.nodes[0].color, '#ff0000', 'the fillcolor alias still binds');
  assert.equal(graph.nodes[0].x, 17, 'the posx alias still binds');
  assert.equal(graph.edges[0].weight, '4', 'weight still binds');
  assert.equal(graph.edges[0].strokeStyle, 'dashed', 'the app style key still binds');
  assert.equal(graph.edges[0].arrowSize, 30, 'a foreign id spelling arrow.size still binds');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a user definition named after a built-in field survives its own round-trip', async () => {
  // These names all bind to built-in fields when a foreign file uses them, so
  // they could never survive as definitions there. The exporter marks its own
  // definitions instead (<key id="D" qvge:kind="custom-attribute">), which is what
  // distinguishable — and this round-trip exact.
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0}, {id:'n2', label:'B', x:100, y:0}],
    edges: [{id:'e1', from:'n1', to:'n2', label:'', weight:'1', directed:true, direction:'directed'}],
    customAttributes: [
      {id:'name', scope:'node', type:'string'},
      {id:'fillcolor', scope:'node', type:'string'},
      {id:'value', scope:'edge', type:'string'},
      {id:'style', scope:'edge', type:'string'},
    ],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportGraphml').click();
  const graphml = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();

  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids.sort(), ['fillcolor', 'name', 'style', 'value'], 'all four definitions come back');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('the app\'s own export re-imports without inventing definitions', async () => {
  // The strongest guard on the rule: every key our exporter writes must be
  // classified built-in, or the app would spawn definitions from its own files.
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0}, {id:'n2', label:'B', x:100, y:0}],
    edges: [{id:'e1', from:'n1', to:'n2', label:'', weight:'1', directed:true, direction:'mutual', arrowSize:20, strokeStyle:'dotted'}],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportGraphml').click();
  const graphml = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  assert.ok([...graphml.matchAll(/<key /g)].length > 40, 'the exporter emits its full schema');

  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const rows = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(rows, [], 'no key from our own export becomes a definition');
  const graph = exportedGraph(document);
  assert.equal(graph.edges[0].direction, 'mutual');
  assert.equal(graph.edges[0].arrowSize, 20);
  assert.equal(graph.edges[0].strokeStyle, 'dotted');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a definition keeps its id through export and re-import, even when it looks built-in', async () => {
  // A definition that would collide with a built-in key id is written under a
  // numbered key id, but records its own id in qvge:id, so it comes back
  // unchanged instead of drifting to weight2 on every save.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="weight" for="node" attr.name="weight" attr.type="string"/>',
    '  <key id="arrowSize" for="edge" attr.name="score" attr.type="double"/>',
    '  <graph edgedefault="directed">',
    '    <node id="n1"><data key="weight">heavy</data></node>',
    '    <node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"><data key="arrowSize">3</data></edge>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids.sort(), ['arrowSize', 'weight'], 'both are definitions');

  document.querySelector('#btnExportGraphml').click();
  const exported = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  assert.match(exported, /<key id="weight2" for="node" attr\.name="weight"[^>]*qvge:id="weight"/, 'the key id is unique and the definition id is recorded');
  assert.match(exported, /<key id="arrowSize2" for="edge" attr\.name="score"[^>]*qvge:id="arrowSize"/, 'and the foreign name rides along');

  await paste(document, dom.window, '#btnPasteGraphml', exported);
  const again = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(again.sort(), ['arrowSize', 'weight'], 'a second round-trip is a no-op');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a GraphML export from the previous build keeps its definitions', async () => {
  // The build before this one marked nothing and named definitions with a
  // leading `qvge.custom.`. Both forms have to survive: the key block is
  // complete, which is what attributes the document to us rather than to a
  // third-party tool that happens to use the same names.
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0}, {id:'n2', label:'B', x:100, y:0}],
    edges: [{id:'e1', from:'n1', to:'n2', label:'', weight:'1', directed:true, direction:'mutual'}],
    customAttributes: [
      {id:'name', scope:'node', type:'string'},
      {id:'value', scope:'edge', type:'string'},
      {id:'style', scope:'edge', type:'string'},
    ],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportGraphml').click();
  const current = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();

  // (a) the pre-marker export: plain ids, no qvge:kind, no writer attribute.
  const unmarked = current.replace(/ qvge:writer="graph-editor-pro" qvge:keys="\d+"/, '').replace(/ qvge:kind="custom-attribute"/g, '');
  await paste(document, dom.window, '#btnPasteGraphml', unmarked);
  let ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids.sort(), ['name', 'style', 'value'], 'unmarked definitions survive');
  assert.equal(exportedGraph(document).nodes[0].label, 'A', 'and the label still binds to its own key');

  // (b) the namespaced export written by the previous head.
  const prefixed = unmarked
    .replace('<key id="name" for="node"', '<key id="qvge.custom.name" for="node"')
    .replace('<key id="style" for="edge"', '<key id="qvge.custom.style" for="edge"');
  await paste(document, dom.window, '#btnPasteGraphml', prefixed);
  ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids.sort(), ['name', 'style', 'value'], 'namespaced definitions are un-prefixed once, not dropped');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a foreign key that looks namespaced keeps its own id instead of collapsing', async () => {
  // `qvge.custom.score` from another tool is that tool's key. Stripping the
  // prefix here would make it collide with the genuine `score` definition and
  // one of the two would be silently dropped.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="score" for="node" attr.name="score" attr.type="double"/>',
    '  <key id="qvge.custom.score" for="node" attr.name="other" attr.type="string"/>',
    '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/></graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  let ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids.sort(), ['qvge.custom.score', 'score'], 'both keys survive as distinct definitions');

  document.querySelector('#btnExportGraphml').click();
  const exported = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  await paste(document, dom.window, '#btnPasteGraphml', exported);
  ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids.sort(), ['qvge.custom.score', 'score'], 'and neither is lost on the next round-trip');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a definition\'s data never feeds the built-in field of the same name', async () => {
  // A definition called `label` is legal, and its <data> must stay in the custom
  // namespace. If it entered the built-in name map it would overwrite the node
  // label — which is exactly what a marked key is there to prevent.
  const saved = {
    nodes: [{id:'n1', label:'Alice', x:0, y:0}, {id:'n2', label:'B', x:100, y:0}],
    edges: [{id:'e1', from:'n1', to:'n2', label:'', weight:'1', directed:true, direction:'directed'}],
    customAttributes: [{id:'label', scope:'node', type:'string'}],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportGraphml').click();
  const exported = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();

  await paste(document, dom.window, '#btnPasteGraphml', exported);
  const rows = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(rows, ['label'], 'the definition survives');
  assert.equal(exportedGraph(document).nodes[0].label, 'Alice', 'and the label is not overwritten by it');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('an export from main (41 keys, no marker) keeps its custom definitions', async () => {
  // main wrote a smaller built-in block than we do, so requiring the current key
  // count rejected every export made before this PR. The bulk of our block is
  // what identifies us, and 41 of today's 43 is still the bulk of it.
  const mainKeys = [
    ['label','node','label'],['nodeId','node','id'],['order','node','order'],['x','node','x'],['y','node','y'],
    ['type','node','type'],['shape','node','shape'],['color','node','color'],['width','node','width'],
    ['height','node','height'],['strokeColor','node','stroke.color'],['strokeSize','node','stroke.size'],
    ['strokeStyle','node','stroke.style'],['labelColor','node','label.color'],['labelFont','node','label.font'],
    ['labelSize','node','label.size'],['labelPosition','node','label.position'],
    ['weight','edge','weight'],['edgeLabel','edge','label'],['edgeType','edge','type'],['edgeColor','edge','color'],
    ['edgeStrokeSize','edge','stroke.size'],['edgeStrokeStyle','edge','style'],['edgeLabelColor','edge','label.color'],
    ['edgeLabelFont','edge','label.font'],['edgeLabelSize','edge','label.size'],['directed','edge','directed'],
    ['labelsPolicy','graph','labels.policy'],['edgeWeightMode','graph','edge.weight.mode'],
    ['edgeWeightMin','graph','edge.weight.min'],['edgeWeightMax','graph','edge.weight.max'],
    ['edgeWeightCorr','graph','edge.weight.corr'],['edgeWidthMin','graph','edge.width.min'],
    ['edgeWidthMax','graph','edge.width.max'],['edgeWeightColorLow','graph','edge.weight.colorLow'],
    ['edgeWeightColorHigh','graph','edge.weight.colorHigh'],['canvasBgColor','graph','canvas.bg.color'],
    ['gridMinorColor','graph','grid.minor.color'],['gridMajorColor','graph','grid.major.color'],
    ['gridMinorAlpha','graph','grid.minor.alpha'],['gridMajorAlpha','graph','grid.major.alpha'],
  ];
  const graphml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:qvge="http://qvge.github.io/graphml">',
    ...mainKeys.map(([id, scope, name]) => `  <key id="${id}" for="${scope}" attr.name="${name}" attr.type="string"/>`),
    '  <key id="name" for="node" attr.name="name" attr.type="string"/>',
    '  <key id="value" for="edge" attr.name="value" attr.type="string"/>',
    '  <key id="style" for="edge" attr.name="style" attr.type="string"/>',
    '  <graph edgedefault="directed">',
    '    <node id="n1"><data key="label">A</data></node><node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids.sort(), ['name', 'style', 'value'], 'all three definitions survive');
  assert.equal(exportedGraph(document).nodes[0].label, 'A', 'and the built-in label still binds');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a definition cannot capture a built-in value or default', async () => {
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:qvge="http://qvge.github.io/graphml" qvge:writer="graph-editor-pro">',
    '  <key id="label" for="node" attr.name="label" attr.type="string"/>',
    '  <key id="label2" for="node" attr.name="label" attr.type="string" qvge:kind="custom-attribute" qvge:id="label"/>',
    '  <key id="shape" for="node" attr.name="shape" attr.type="string"/>',
    '  <key id="shape2" for="node" attr.name="shape" attr.type="string" qvge:kind="custom-attribute" qvge:id="shape"><default>square</default></key>',
    '  <graph edgedefault="directed"><node id="n1"><data key="label2">secret</data></node><node id="n2"/></graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);

  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids.sort(), ['label', 'shape'], 'both definitions survive');

  document.querySelector('#btnExportGraphml').click();
  const exported = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  // Data under the marked key must not reach the node label: the data map falls
  // back to the raw key when it is unknown, so "unknown" has to mean empty.
  const node = exported.match(/<node id="n1"[\s\S]*?<\/node>/)[0];
  // The definition's value round-trips under its own key (de-collided to
  // `label2` on the way out), never on the built-in label key.
  assert.match(node, /<data key="label2">secret<\/data>/, 'the definition value round-trips under its own key');
  assert.equal((node.match(/<data key="label">([^<]*)<\/data>/) || [])[1], '', 'the built-in label key does not carry it');
  // And a definition's <default> must not become the built-in default.
  assert.ok(!/<key id="shape" [^>]*>\s*<default>/.test(exported), 'the custom shape default stays out of the node defaults');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('definitions survive a re-serialised namespace prefix', async () => {
  // qvge: is a prefix, not part of the name. Another tool that binds the same
  // URI to a different prefix must still be read as our marker.
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0}, {id:'n2', label:'B', x:100, y:0}],
    edges: [{id:'e1', from:'n1', to:'n2', label:'', weight:'1', directed:true, direction:'mutual'}],
    customAttributes: [{id:'direction', scope:'edge', type:'string'}],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportGraphml').click();
  const exported = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();

  const renamed = exported
    .replace('xmlns:qvge="http://qvge.github.io/graphml"', 'xmlns:q="http://qvge.github.io/graphml"')
    .replace(/qvge:/g, 'q:');
  await paste(document, dom.window, '#btnPasteGraphml', renamed);
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids, ['direction'], 'the definition keeps its id, not direction2');
  assert.equal(exportedGraph(document).edges[0].direction, 'mutual', 'and the edge direction is untouched');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a marked key whose id is a bare field name cannot set a built-in value', async () => {
  // The definition's key id here is `name`, which is also something the node
  // reader looks up. An empty mapping has to survive the data map's fallback to
  // the raw key, or the definition's value becomes the node label.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:qvge="http://qvge.github.io/graphml" qvge:writer="graph-editor-pro">',
    '  <key id="label" for="node" attr.name="label" attr.type="string"/>',
    '  <key id="name" for="node" attr.name="name" attr.type="string" qvge:kind="custom-attribute"/>',
    '  <graph edgedefault="directed">',
    // No <data key="label"> here: the node reader does `d.label || d.name`, so a
    // real label would mask the leak. The definition's value must be the only
    // candidate and still not become the label.
    '    <node id="n1"><data key="name">secret</data></node><node id="n2"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);

  document.querySelector('#btnExportGraphml').click();
  const exported = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  const node = exported.match(/<node id="n1"[\s\S]*?<\/node>/)[0];
  // The definition's value round-trips under its own marked key, never on the
  // built-in label key.
  assert.match(node, /<data key="name">secret<\/data>/, 'the definition value round-trips under its own key');
  assert.equal((node.match(/<data key="label">([^<]*)<\/data>/) || [])[1], '',
    'the label is untouched');
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids, ['name'], 'and the definition itself survives');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a foreign file reusing our key ids for other attributes keeps its definitions', async () => {
  // An id alone does not identify our built-in keys: the exporter always pairs
  // each id with a specific attr.name. Matching only (id, scope) made this file
  // look like an old export of ours, and every definition in it was dropped.
  const ids = ['label','nodeId','order','x','y','type','shape','color','width','height',
    'strokeColor','strokeSize','strokeStyle','labelColor','labelFont','labelSize','labelPosition'];
  const edgeIds = ['weight','edgeLabel','edgeType','edgeColor','edgeStrokeSize'];
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    ...ids.map((id, i) => `  <key id="${id}" for="node" attr.name="foreign_${i}" attr.type="string"/>`),
    ...edgeIds.map((id, i) => `  <key id="${id}" for="edge" attr.name="also_foreign_${i}" attr.type="string"/>`),
    '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/></graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const defs = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.equal(defs.length, ids.length + edgeIds.length, 'every definition is kept');
  assert.deepEqual(defs.sort(), [...ids, ...edgeIds].sort(), 'the ids are the ones the file declared');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a key declared without `for` is kept, not dropped (GraphML default is "all")', async () => {
  // `for` is optional and defaults to "all". The declaration imports as ONE
  // definition with scope 'all' — GraphML's scope kept 1:1 — which applies
  // on every scope instead of being dropped or collapsed onto the graph and
  // losing the rest of the data.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="tag" attr.name="tag" attr.type="string"/>',
    '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/></graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  let rows = [...document.querySelectorAll('.custom-attribute-row')].map(row => ({
    id: row.querySelector('[data-attribute-field="id"]').value,
    scope: row.querySelector('[data-attribute-field="scope"]').value,
  }));
  assert.deepEqual(rows, [{id:'tag', scope:'all'}],
    'the definition imports as a single all-scope definition');

  document.querySelector('#btnExportGraphml').click();
  const exported = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  await paste(document, dom.window, '#btnPasteGraphml', exported);
  rows = [...document.querySelectorAll('.custom-attribute-row')].map(row => row.querySelector('[data-attribute-field="id"]').value);
  assert.deepEqual(rows, ['tag'], 'and it round-trips');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a scope-less key whose name is a built-in field still binds it, not becomes a definition', async () => {
  // Same missing `for`, but the name is one the readers use: it must feed the
  // built-in field rather than appear as a phantom definition.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="k" attr.name="label" attr.type="string"/>',
    '  <graph edgedefault="directed"><node id="n1"><data key="k">Hi</data></node></graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.deepEqual([...document.querySelectorAll('.custom-attribute-row')].map(r => r.querySelector('[data-attribute-field="id"]').value), [],
    'no phantom definition');
  assert.equal(exportedGraph(document).nodes[0].label, 'Hi', 'and the value reaches the label it names');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a differently-cased name does not overwrite the built-in value it collides with', async () => {
  // attr.name is case-sensitive, but the internal data map lowercases. Before
  // this was handled, a key spelled attr.name="LABEL" landed in the same slot as
  // the real label and, being last, replaced its value.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="label" for="node" attr.name="label" attr.type="string"/>',
    '  <key id="shout" for="node" attr.name="LABEL" attr.type="string"/>',
    '  <graph edgedefault="directed">',
    '    <node id="n1"><data key="label">real</data><data key="shout">fake</data></node>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.equal(exportedGraph(document).nodes[0].label, 'real', 'the canonical key wins');

  // The declaration order must not matter.
  const reversed = graphml
    .replace('  <key id="label" for="node" attr.name="label" attr.type="string"/>\n', '')
    .replace('<key id="shout"', '<key id="label" for="node" attr.name="label" attr.type="string"/>\n  <key id="shout"')
    .replace('<data key="label">real</data><data key="shout">fake</data>', '<data key="shout">fake</data><data key="label">real</data>');
  await paste(document, dom.window, '#btnPasteGraphml', reversed);
  assert.equal(exportedGraph(document).nodes[0].label, 'real', 'and neither does declaration order');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('every custom definition id survives an export/import cycle, however it is spelled', async () => {
  // A table-driven guard over the id space, because the per-case tests only
  // cover the ids someone thought of. Ids that collide with a built-in key, that
  // look namespaced, that are built-in *names* rather than ids, and that differ
  // only by case all have to come back unchanged after two round-trips.
  const ids = [
    'capacity', 'Capacity', 'CAPACITY', 'tag', 'tag2', 'score',
    'weight', 'label', 'name', 'style', 'value', 'shape', 'direction', 'arrowSize',
    'stroke.color', 'labels.policy', 'edge.weight.mode',
    'qvge.custom.score', 'qvge.custom.', 'a b', 'a.b', 'x-y', '0numeric',
  ];
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0}, {id:'n2', label:'B', x:100, y:0}],
    edges: [{id:'e1', from:'n1', to:'n2', label:'', weight:'1', directed:true, direction:'mutual', arrowSize:20}],
    customAttributes: ids.map(id => ({id, scope:'node', type:'string'})),
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  const idsOf = () => [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value).sort();
  assert.deepEqual(idsOf(), [...ids].sort(), 'every definition is accepted up front');

  for(let pass = 1; pass <= 2; pass++){
    document.querySelector('#btnExportGraphml').click();
    const exported = document.querySelector('.export-modal textarea').value;
    document.querySelector('#expCloseBtn').click();
    // Every <key> id must be unique, or <data key="..."> becomes ambiguous.
    const keyIds = [...exported.matchAll(/<key id="([^"]*)"/g)].map(m => m[1]);
    assert.equal(new Set(keyIds).size, keyIds.length, `pass ${pass}: key ids are unique`);
    await paste(document, dom.window, '#btnPasteGraphml', exported);
    assert.deepEqual(idsOf(), [...ids].sort(), `pass ${pass}: the same ids come back`);
  }
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a name spelled differently on one scope does not shadow another scope', async () => {
  // The canonical-spelling map is keyed by scope as well as name. Keyed by name
  // alone, a node key spelled attr.name="LABEL" decided that the edge key spelled
  // attr.name="label" was a duplicate, and the edge's label was discarded.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="label" for="node" attr.name="LABEL" attr.type="string"/>',
    '  <key id="el" for="edge" attr.name="label" attr.type="string"/>',
    '  <graph edgedefault="directed">',
    '    <node id="n1"/><node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"><data key="el">Relation</data></edge>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph = exportedGraph(document);
  assert.equal(graph.edges[0].label, 'Relation', 'the edge label survives a node key on another scope');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a cross-scope case collision does not drop a definition either', async () => {
  // Same shape through the definition path, and the node key must be canonical
  // for shadowing to engage at all — otherwise the test proves nothing. The edge
  // key here is the canonical *edge* key spelled "label" while the node key is
  // spelled "Label": a name-only map shadows the edge one and its value is lost.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="label" for="node" attr.name="Label" attr.type="string"/>',
    '  <key id="edgeLabel" for="edge" attr.name="label" attr.type="string"/>',
    '  <key id="et" for="edge" attr.name="tag" attr.type="string"/>',
    '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/><edge id="e1" source="n1" target="n2"><data key="edgeLabel">E</data></edge></graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const rows = [...document.querySelectorAll('.custom-attribute-row')].map(row => ({
    id: row.querySelector('[data-attribute-field="id"]').value,
    scope: row.querySelector('[data-attribute-field="scope"]').value,
  }));
  assert.deepEqual(rows, [{id:'et', scope:'edge'}], 'the edge definition survives');
  // And the canonical node key still provides its value under its own spelling.
  assert.equal(exportedGraph(document).edges[0].label, 'E', 'the edge value reaches the edge label');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('an all-scope key still feeds a scope where it does not collide', async () => {
  // A <key> with no `for` applies to every element type. Deciding whether it is
  // a collision has to be done per scope: here it is spelled "LABEL" and collides
  // with the canonical node key spelled "label", but on the edge scope there is
  // no such key, so the edge value it carries is legitimate and must survive.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="label" for="node" attr.name="label" attr.type="string"/>',
    '  <key id="allk" attr.name="LABEL" attr.type="string"/>',
    '  <graph edgedefault="directed">',
    '    <node id="n1"/><node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"><data key="allk">Relation</data></edge>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph = exportedGraph(document);
  assert.equal(graph.edges[0].label, 'Relation', 'the edge keeps the all-scope value');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('an all-scope key is still shadowed on the scope where it does collide', async () => {
  // The counterpart: on the node scope the canonical key must win, or the
  // per-scope relaxation above would reintroduce the value-overwrite bug.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="label" for="node" attr.name="label" attr.type="string"/>',
    '  <key id="allk" attr.name="LABEL" attr.type="string"/>',
    '  <graph edgedefault="directed">',
    '    <node id="n1"><data key="label">real</data><data key="allk">fake</data></node>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.equal(exportedGraph(document).nodes[0].label, 'real', 'the canonical key still wins its own scope');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('an all-scope key that collides nowhere feeds every scope', async () => {
  // The base case the previous two are variations of: with no canonical rivals,
  // one all-scope key supplies the label to nodes and edges alike.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="only" attr.name="label" attr.type="string"/>',
    '  <graph edgedefault="directed">',
    '    <node id="n1"><data key="only">N</data></node><node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"><data key="only">E</data></edge>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes[0].label, 'N', 'the node keeps it');
  assert.equal(graph.edges[0].label, 'E', 'and so does the edge');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a node property cannot overwrite a graph setting through its key id', async () => {
  // `querySelectorAll('data')` on <graph> is depth-first, so graph data
  // collection also picked up every node's <data>. A node definition whose id
  // happened to look like a graph setting — and which has no mapping on the
  // graph scope, since it is declared for="node" — then fell back to its raw
  // id and set the canvas background.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:qvge="http://qvge.org/xmlns">',
    '  <key id="canvas.bg.color" for="node" attr.name="canvas.bg.color" attr.type="string" qvge:kind="custom"/>',
    '  <graph edgedefault="directed">',
    '    <node id="n1"><data key="canvas.bg.color">#ff0000</data></node>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const settings = exportedGraph(document).settings;
  assert.notEqual(settings.canvasBgColor, '#ff0000', 'a node property must not reach a graph setting');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('graph data is read from the graph element only, never from descendants', async () => {
  // The other half of the rule, isolated: here the key *is* a valid graph field,
  // so the mapping lookup succeeds and only the traversal decides the outcome.
  // Reading <graph> with querySelectorAll collected the node's copy of the value.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="cb" for="graph" attr.name="canvas.bg.color" attr.type="string"/>',
    '  <graph edgedefault="directed">',
    '    <node id="n1"><data key="cb">#ff0000</data></node>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.notEqual(exportedGraph(document).settings.canvasBgColor, '#ff0000', 'node data is not graph data');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a declared graph-scope key still sets the setting it names', async () => {
  // Positive control for both rules above: <graph><data> under a declared graph
  // key must keep working, or "fixing" the leak would just break graph settings.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="cb" for="graph" attr.name="canvas.bg.color" attr.type="string"/>',
    '  <graph edgedefault="directed">',
    '    <data key="cb">#00ff00</data>',
    '    <node id="n1"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.equal(exportedGraph(document).settings.canvasBgColor, '#00ff00', 'a declared graph key still applies');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('an undeclared key id cannot act as a field name', async () => {
  // Rule 2 on its own: there is no <key> at all, so nothing is mapped for any
  // scope and the old code fell back to the raw key id — turning an arbitrary id
  // into a setting name. An id is not a field name, declared or not.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <graph edgedefault="directed">',
    '    <data key="canvas.bg.color">#ff0000</data>',
    '    <node id="n1"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.notEqual(exportedGraph(document).settings.canvasBgColor, '#ff0000', 'an undeclared key is not a field');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a shadowed default cannot override a canonical one', async () => {
  // The role model governs data values and defaults alike: a key that is shadowed
  // on a scope feeds no field there, so its <default> cannot speak for that field
  // either. Declared after the canonical key, as in the report.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="shape" for="node" attr.name="shape" attr.type="string"><default>circle</default></key>',
    '  <key id="s2" for="node" attr.name="SHAPE" attr.type="string"><default>square</default></key>',
    '  <graph edgedefault="directed"><node id="n1"/></graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.equal(exportedGraph(document).settings.nodeDefaults.shape, 'circle', 'the canonical default wins');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('shadowed defaults lose regardless of declaration order', async () => {
  // Precedence must be a property of the roles, not of document order: the same
  // two keys declared the other way round give the same result.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="s2" for="node" attr.name="SHAPE" attr.type="string"><default>square</default></key>',
    '  <key id="shape" for="node" attr.name="shape" attr.type="string"><default>circle</default></key>',
    '  <graph edgedefault="directed"><node id="n1"/></graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.equal(exportedGraph(document).settings.nodeDefaults.shape, 'circle', 'order does not decide it');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a canonical default outranks an alias default', async () => {
  // Same precedence mechanism, one step weaker: an alias is a legitimate second
  // source but must not displace the canonical spelling of the same field. The
  // canonical key is declared *first* here on purpose — written the other way
  // round, "last key wins" would produce the right answer for the wrong reason.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="shape" for="node" attr.name="shape" attr.type="string"><default>circle</default></key>',
    '  <key id="k" for="node" attr.name="shape" attr.type="string"><default>square</default></key>',
    '  <graph edgedefault="directed"><node id="n1"/></graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.equal(exportedGraph(document).settings.nodeDefaults.shape, 'circle', 'canonical beats alias');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a lone shadowed spelling still supplies its default', async () => {
  // Shadowing only exists to protect a canonical key. With no canonical key
  // present there is nothing to protect, so the value is the only source and must
  // be used — otherwise "fixing" precedence would drop legitimate documents.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="s2" for="node" attr.name="SHAPE" attr.type="string"><default>square</default></key>',
    '  <graph edgedefault="directed"><node id="n1"/></graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.equal(exportedGraph(document).settings.nodeDefaults.shape, 'square', 'nothing to shadow, so it applies');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a for="all" default reaches the scopes it applies to', async () => {
  // The default reader used to bucket by the raw `for` attribute, so a key
  // declared for "all" wrote its default to a scope the readers never consult and
  // the value was silently lost.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="s3" attr.name="shape" attr.type="string"><default>diamond</default></key>',
    '  <graph edgedefault="directed"><node id="n1"/></graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.equal(exportedGraph(document).settings.nodeDefaults.shape, 'diamond', 'an all-scope default still lands');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a weight default reaches edges that have no explicit weight', async () => {
  // A default is what an element's unset property resolves to, not merely a
  // setting. The renderer already treats weight this way for
  // color/width/labelSize — edgeVisual falls back to settings.edgeDefaults — but
  // weight itself had no fallback, so an edge with no <data> weighed 1.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="w" attr.name="weight" attr.type="int"><default>12</default></key>',
    '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph = exportedGraph(document);
  assert.equal(graph.settings.edgeDefaults.weight, '12', 'the default is kept');
  assert.equal(graph.edges[0].weight, '12', 'and the edge without its own weight resolves to it');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('an explicit edge weight still beats the default', async () => {
  // The counterpart: applying the default must not overwrite a value the file
  // states. Both directions matter — one drops data, the other invents it.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="w" attr.name="weight" attr.type="int"><default>12</default></key>',
    '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"><data key="w">3</data></edge>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.equal(exportedGraph(document).edges[0].weight, '3', 'the stated weight wins');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('an edge with neither weight nor default stays unweighted', async () => {
  // And the baseline: no default declared means no weight, which is how a fresh
  // graph behaves today. Filling in a value here would be inventing data.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const weight = exportedGraph(document).edges[0].weight;
  // The JSON export omits empty values, so "no weight" is either absent or ''.
  assert.ok(weight === undefined || weight === '', 'no default, no weight');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('both edge style spellings name the same field', async () => {
  // The exporter writes the edge style as attr.name "style"; other tools and our
  // older files use "stroke.style". They are one field, so either spelling must
  // reach edgeDefaults.strokeStyle. A reader that knows only one of them silently
  // drops the default the other carries.
  for(const spelling of ['style', 'stroke.style']){
    const graphml = [
      '<?xml version="1.0"?>',
      '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
      `  <key id="e4" for="edge" attr.name="${spelling}" attr.type="string"><default>dotted</default></key>`,
      '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/>',
      '    <edge id="e1" source="n1" target="n2"/>',
      '  </graph>',
      '</graphml>',
    ].join('\n');
    const {dom, errors} = createEditorDom();
    const {document} = dom.window;
    await paste(document, dom.window, '#btnPasteGraphml', graphml);
    assert.equal(exportedGraph(document).settings.edgeDefaults.strokeStyle, 'dotted', `attr.name="${spelling}" works`);
    assert.deepEqual(errors.map(error => error.message), []);
    dom.window.close();
  }
});

test('an edge label size default is not dropped', async () => {
  // edgeLabelSize is a declared built-in key, but the default reader had no
  // branch for label.size on the edge scope at all.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="e5" for="edge" attr.name="label.size" attr.type="double"><default>19</default></key>',
    '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.equal(exportedGraph(document).settings.edgeDefaults.labelSize, 19, 'the declared size is kept');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('every edge field with a default actually receives it', async () => {
  // One table drives both scopes now, so the set is checked as a set: a field
  // added to the key block but not to the binding table shows up here.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="c" for="edge" attr.name="color" attr.type="string"><default>#010101</default></key>',
    '  <key id="lc" for="edge" attr.name="label.color" attr.type="string"><default>#020202</default></key>',
    '  <key id="ss" for="edge" attr.name="stroke.size" attr.type="double"><default>9</default></key>',
    '  <key id="st" for="edge" attr.name="style" attr.type="string"><default>dotted</default></key>',
    '  <key id="ls" for="edge" attr.name="label.size" attr.type="double"><default>19</default></key>',
    '  <key id="as" for="edge" attr.name="arrow.size" attr.type="double"><default>5</default></key>',
    '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const ed = exportedGraph(document).settings.edgeDefaults;
  assert.equal(ed.color, '#010101');
  assert.equal(ed.labelColor, '#020202');
  assert.equal(ed.strokeSize, 9);
  assert.equal(ed.strokeStyle, 'dotted');
  assert.equal(ed.labelSize, 19);
  assert.equal(ed.arrowSize, 5);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a value default is a weight default', async () => {
  // `value` is an accepted alias for weight in edge <data>, and the reader has
  // always honoured it there. The default binding table has to agree, or the
  // alias works for stated values and silently fails for defaults.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="v" for="edge" attr.name="value" attr.type="int"><default>12</default></key>',
    '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.equal(exportedGraph(document).edges[0].weight, '12', 'the alias default applies');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a label default labels the elements that have none', async () => {
  // `label` is element data rather than a style, so it is applied during element
  // construction instead of through the style bindings — but it is still a
  // <default>, and an unset label must resolve to it like any other property.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="nl" for="node" attr.name="label" attr.type="string"><default>Alice</default></key>',
    '  <key id="el" for="edge" attr.name="label" attr.type="string"><default>rel</default></key>',
    '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes[0].label, 'Alice', 'the node takes the label default');
  assert.equal(graph.edges[0].label, 'rel', 'and so does the edge');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a stated label still beats the label default', async () => {
  // The counterpart, so applying the default cannot overwrite stated data.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="nl" for="node" attr.name="label" attr.type="string"><default>Alice</default></key>',
    '  <graph edgedefault="directed"><node id="n1"><data key="nl">Bob</data></node></graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.equal(exportedGraph(document).nodes[0].label, 'Bob', 'stated data wins');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('appending keeps the imported document\'s visual defaults', async () => {
  // Append deliberately keeps the host graph's settings, so the imported
  // document's defaults would be discarded — leaving its elements to inherit the
  // host style. They have to be resolved onto the elements at append time, which
  // is the last moment those defaults exist.
  const host = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <graph edgedefault="directed"><node id="a"/><node id="b"/>',
    '    <edge id="ab" source="a" target="b"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const incoming = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="sh" for="node" attr.name="shape" attr.type="string"><default>square</default></key>',
    '  <key id="st" for="edge" attr.name="stroke.style" attr.type="string"><default>dashed</default></key>',
    '  <graph edgedefault="directed"><node id="c"/><node id="d"/>',
    '    <edge id="cd" source="c" target="d"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', host);
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, dom.window, '#btnPasteGraphml', incoming);
  const graph = exportedGraph(document);
  const byId = (list, id) => list.find(item => item.id === id);
  assert.equal(byId(graph.nodes, 'c').shape, 'square', 'the imported node keeps its document\'s shape');
  assert.equal(byId(graph.nodes, 'd').shape, 'square');
  assert.equal(byId(graph.edges, 'cd').strokeStyle, 'dashed', 'and the imported edge its own stroke style');
  // The host graph must be untouched: its elements still inherit, and its
  // settings are still its own.
  assert.ok(!byId(graph.nodes, 'a').shape, 'the host node still inherits');
  assert.equal(graph.settings.nodeDefaults.shape, 'circle', 'the host defaults are unchanged');
  assert.equal(graph.settings.edgeDefaults.strokeStyle, 'solid');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('an explicit empty label survives the label default', async () => {
  // A label default applies to a label that is *unset*. An element carrying
  // <data key="l"/> with no text has stated its label — an intentional blank —
  // and must not have a default substituted for it. Presence, not truthiness.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="l" for="node" attr.name="label" attr.type="string"><default>Fallback</default></key>',
    '  <graph edgedefault="directed">',
    '    <node id="n1"><data key="l"></data></node>',
    '    <node id="n2"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph = exportedGraph(document);
  const byId = id => graph.nodes.find(n => n.id === id);
  assert.equal(byId('n1').label, '', 'the stated blank is kept');
  assert.equal(byId('n2').label, 'Fallback', 'the unset one takes the default');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('an explicit empty edge label survives the edge label default', async () => {
  // The same rule on the edge scope, which has its own label reader.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="el" for="edge" attr.name="label" attr.type="string"><default>EFB</default></key>',
    '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"><data key="el"></data></edge>',
    '    <edge id="e2" source="n2" target="n1"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph = exportedGraph(document);
  const byId = id => graph.edges.find(e => e.id === id);
  assert.equal(byId('e1').label, '', 'the stated blank is kept');
  assert.equal(byId('e2').label, 'EFB', 'the unset one takes the default');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('append skips null entries instead of rejecting the whole import', async () => {
  // Sanitisation happens after the defaults are materialised, so a malformed
  // entry is still present at that point. Skipping it lets the sanitizer drop it
  // while the rest of the payload imports, which is what append did before.
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  const pasteJson = async payload => {
    Object.defineProperty(dom.window.navigator, 'clipboard', {
      configurable: true, value: {writeText: async () => {}, readText: async () => JSON.stringify(payload)}
    });
    document.querySelector('#btnPasteJson').click();
    await settle(dom.window, 60);
  };
  await pasteJson({title: 'host', nodes: [{id: 'a', x: 0, y: 0}], edges: []});
  document.querySelector('#optImportAppend').checked = true;
  await pasteJson({
    title: 'incoming',
    nodes: [null, {id: 'b', x: 40, y: 40}],
    edges: [null, {id: 'bc', from: 'b', to: 'b'}],
  });
  const graph = exportedGraph(document);
  assert.deepEqual(graph.nodes.map(n => n.id), ['a', 'b'], 'the valid node still arrives');
  assert.deepEqual(graph.edges.map(e => e.id), ['bc'], 'and so does the valid edge');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('append tolerates a payload that is entirely null entries', async () => {
  // The degenerate case: nothing usable. It must be a no-op, not a failure.
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  const pasteJson = async payload => {
    Object.defineProperty(dom.window.navigator, 'clipboard', {
      configurable: true, value: {writeText: async () => {}, readText: async () => JSON.stringify(payload)}
    });
    document.querySelector('#btnPasteJson').click();
    await settle(dom.window, 60);
  };
  await pasteJson({title: 'host', nodes: [{id: 'a', x: 0, y: 0}], edges: []});
  document.querySelector('#optImportAppend').checked = true;
  await pasteJson({title: 'incoming', nodes: [null, null], edges: [null]});
  assert.deepEqual(exportedGraph(document).nodes.map(n => n.id), ['a'], 'the host graph is intact');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

// === The field model is checked against itself ==============================
//
// Every case below is generated from the parser's own field model rather than
// written out by hand, because the defects in this area were never a wrong rule
// — they were a field that one table knew about and another did not. A test that
// lists fields by hand cannot catch that; one that walks the model can.
const GRAPHML_ALIAS_CASES = [
  // [attr.name, scope, sample value, property, expected value]
  ['fillcolor', 'node', '#ff0000', 'color', '#ff0000'],
  ['bgcolor', 'node', '#00ff00', 'color', '#00ff00'],
  ['strokecolor', 'node', '#0000ff', 'strokeColor', '#0000ff'],
  ['strokesize', 'node', '7', 'strokeSize', 7],
  ['strokestyle', 'node', 'dotted', 'strokeStyle', 'dotted'],
  ['labelcolor', 'node', '#111111', 'labelColor', '#111111'],
  ['labelsize', 'node', '21', 'labelSize', 21],
  ['labelposition', 'node', 'bottom', 'labelPosition', 'bottom'],
  ['graphics', 'node', 'diamond', 'shape', 'diamond'],
  ['posx', 'node', '40', 'x', 40],
  ['edgecolor', 'edge', '#222222', 'color', '#222222'],
  ['strokesize', 'edge', '9', 'strokeSize', 9],
  ['strokestyle', 'edge', 'dashed', 'strokeStyle', 'dashed'],
  ['labelcolor', 'edge', '#333333', 'labelColor', '#333333'],
  ['labelsize', 'edge', '19', 'labelSize', 19],
  ['arrowsize', 'edge', '5', 'arrowSize', 5],
  ['value', 'edge', '12', 'weight', '12'],
  ['edgelabel', 'edge', 'rel', 'label', 'rel'],
];

test('every declared alias binds as element data', async () => {
  // An alias is a name other tools use for one of our fields. If the model says
  // a name is an alias, a <data> under that name must reach that field.
  for(const [name, scope, value, property, expected] of GRAPHML_ALIAS_CASES){
    const graphml = scope === 'node'
      ? ['<?xml version="1.0"?>', '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
         `  <key id="k" for="node" attr.name="${name}" attr.type="string"/>`,
         '  <graph edgedefault="directed"><node id="n1"><data key="k">' + value + '</data></node></graph>',
         '</graphml>'].join('\n')
      : ['<?xml version="1.0"?>', '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
         `  <key id="k" for="edge" attr.name="${name}" attr.type="string"/>`,
         '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/>',
         `    <edge id="e1" source="n1" target="n2"><data key="k">${value}</data></edge>`,
         '  </graph>', '</graphml>'].join('\n');
    const {dom, errors} = createEditorDom();
    const {document} = dom.window;
    await paste(document, dom.window, '#btnPasteGraphml', graphml);
    const graph = exportedGraph(document);
    const element = scope === 'node' ? graph.nodes[0] : graph.edges[0];
    assert.equal(String(element[property]), String(expected), `attr.name="${name}" on ${scope} feeds ${property}`);
    assert.deepEqual(errors.map(error => error.message), []);
    dom.window.close();
  }
});

test('every declared alias binds as a key default', async () => {
  // The same names as <default>. This is the pair that drifted: `fillcolor` and
  // `edgecolor` worked as data and not as defaults, and `edgelabel` likewise.
  // `x`/`y` are positions — a default coordinate is meaningless and the parser
  // deliberately offers none. `label`/`weight` are element *data*, not styles, so
  // their defaults land on the elements instead; both are covered by their own
  // tests above.
  const defaulted = GRAPHML_ALIAS_CASES.filter(([, , , property]) =>
    !['x', 'y', 'label', 'weight'].includes(property));
  for(const [name, scope, value, property, expected] of defaulted){
    const graphml = ['<?xml version="1.0"?>', '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
      `  <key id="k" for="${scope}" attr.name="${name}" attr.type="string"><default>${value}</default></key>`,
      '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/><edge id="e1" source="n1" target="n2"/></graph>',
      '</graphml>'].join('\n');
    const {dom, errors} = createEditorDom();
    const {document} = dom.window;
    await paste(document, dom.window, '#btnPasteGraphml', graphml);
    const graph = exportedGraph(document);
    const defaults = scope === 'node' ? graph.settings.nodeDefaults : graph.settings.edgeDefaults;
    assert.equal(String(defaults[property]), String(expected), `default attr.name="${name}" on ${scope} feeds ${property}`);
    assert.deepEqual(errors.map(error => error.message), []);
    dom.window.close();
  }
});

test('an alias default cannot displace a canonical default', async () => {
  // `color` and its alias `fillcolor` are one field. Keying defaults by the
  // attr.name that carried them made them look like two properties, so whichever
  // was declared last won on document order alone.
  for(const order of [['color', 'fillcolor'], ['fillcolor', 'color']]){
    const keys = order.map((name, i) =>
      `  <key id="k${i}" for="node" attr.name="${name}" attr.type="string"><default>${name === 'color' ? '#ff0000' : '#0000ff'}</default></key>`);
    const graphml = ['<?xml version="1.0"?>', '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
      ...keys, '  <graph edgedefault="directed"><node id="n1"/></graph>', '</graphml>'].join('\n');
    const {dom, errors} = createEditorDom();
    const {document} = dom.window;
    await paste(document, dom.window, '#btnPasteGraphml', graphml);
    assert.equal(exportedGraph(document).settings.nodeDefaults.color, '#ff0000',
      `canonical wins regardless of order (${order.join(' then ')})`);
    assert.deepEqual(errors.map(error => error.message), []);
    dom.window.close();
  }
});

test('an alias data value cannot displace a canonical data value', async () => {
  // The same rule for <data>: the element states the weight twice, once under
  // the canonical name and once under the alias. The canonical one is stronger.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="w" for="edge" attr.name="weight" attr.type="string"/>',
    '  <key id="v" for="edge" attr.name="value" attr.type="string"/>',
    '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"><data key="w">4</data><data key="v">7</data></edge>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.equal(exportedGraph(document).edges[0].weight, '4', 'canonical beats alias');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a labelfont default is applied like label.font', async () => {
  // A font default carries its size, and the reader looked for the literal
  // attr.name "label.font" — so the alias the model declares for the same field
  // was dropped. Both spellings, both scopes.
  for(const [scope, family, size] of [['node', 'Arial', 20], ['edge', 'Courier', 15]]){
    for(const name of ['label.font', 'labelfont']){
      const graphml = ['<?xml version="1.0"?>', '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
        `  <key id="lf" for="${scope}" attr.name="${name}" attr.type="string"><default>${family},${size}</default></key>`,
        '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/><edge id="e1" source="n1" target="n2"/></graph>',
        '</graphml>'].join('\n');
      const {dom, errors} = createEditorDom();
      const {document} = dom.window;
      await paste(document, dom.window, '#btnPasteGraphml', graphml);
      const defaults = scope === 'node' ? exportedGraph(document).settings.nodeDefaults : exportedGraph(document).settings.edgeDefaults;
      assert.equal(defaults.labelFont, family, `${scope} attr.name="${name}" sets the family`);
      assert.equal(defaults.labelSize, size, `${scope} attr.name="${name}" carries the size`);
      assert.deepEqual(errors.map(error => error.message), []);
      dom.window.close();
    }
  }
});

test('a type default reaches the elements and survives export', async () => {
  // `type` is element data, so it is written from the element, not from settings.
  // A type default recorded only in settings therefore disappeared on export.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="nt" for="node" attr.name="type" attr.type="string"><default>server</default></key>',
    '  <key id="et" for="edge" attr.name="type" attr.type="string"><default>link</default></key>',
    '  <graph edgedefault="directed"><node id="n1"/><node id="n2"/><edge id="e1" source="n1" target="n2"/></graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes[0].type, 'server', 'the node takes the type default');
  assert.equal(graph.edges[0].type, 'link', 'and the edge takes its own');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

// === Audit round: three P2 regressions (2026-11) ===

test('re-importing same-name properties in reverse declaration order keeps each value with its own definition', async () => {
  // Two graph-scope definitions share the recorded name 'metric', so the
  // node keys 'a' and 'b' (also both named 'metric') must mint afresh.
  // Re-importing the same keys with the <key> declarations reversed must
  // still bind each key to ITS definition — the key identity recorded at
  // creation (`origin`) is what disambiguates them; name+order does not.
  const saved = { title: 'order-independent-reuse', nodes: [], edges: [],
    customAttributes: [
      { id: 'a', scope: 'graph', type: 'int', name: 'metric' },
      { id: 'b', scope: 'graph', type: 'int', name: 'metric' },
    ] };
  const graphml = (first, second) => [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    `  <key id="${first}" for="node" attr.name="metric" attr.type="int"/>`,
    `  <key id="${second}" for="node" attr.name="metric" attr.type="int"/>`,
    '  <graph id="g" edgedefault="directed">',
    `    <node id="m1"><data key="${first}">100</data><data key="${second}">200</data></node>`,
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, dom.window, '#btnPasteGraphml', graphml('a', 'b'));
  let graph = exportedGraph(document);
  const byOrigin = (g, origin) => g.customAttributes.find(d => d.origin === origin);
  assert.equal(byOrigin(graph, 'a')?.id, 'a_1', 'the first key mints a_1');
  assert.equal(byOrigin(graph, 'b')?.id, 'b_1', 'the second key mints b_1');
  const m1 = graph.nodes.find(n => n.id === 'm1');
  assert.equal(m1?.custom?.a_1, 100, 'a binds a_1');
  assert.equal(m1?.custom?.b_1, 200, 'b binds b_1');
  // Append the same file with the <key> declarations reversed: neither a
  // new definition nor swapped values may happen.
  await paste(document, dom.window, '#btnPasteGraphml', graphml('b', 'a'));
  graph = exportedGraph(document);
  assert.equal(graph.customAttributes.filter(d => d.origin === 'a').length, 1, 'no new definition is minted for key a');
  assert.equal(graph.customAttributes.filter(d => d.origin === 'b').length, 1, 'no new definition is minted for key b');
  assert.equal(graph.customAttributes.length, 4, 'the document keeps the two graph and two node definitions');
  const customs = graph.nodes.map(n => n.custom).filter(Boolean);
  assert.ok(customs.some(c => c.a_1 === 100 && c.b_1 === 200), 'the re-imported values stay bound to the same definitions');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a mixed-role for="all" key keeps its graph-level value as a definition; built-in scopes stay fields', async () => {
  // A foreign key named `label` for the whole file: label is a built-in
  // field on nodes and edges — those data bind to the built-ins as usual.
  // The graph has no such field, so its graph-level value is the user's
  // own property and must survive — before this fix it was silently
  // dropped while the import reported success.
  const saved = { title: 'mixed-role', nodes: [], edges: [] };
  const graphml = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="extLabel" for="all" attr.name="label" attr.type="string"/>',
    '  <graph id="g" edgedefault="directed">',
    '    <data key="extLabel">graph-note</data>',
    '    <node id="n1"><data key="extLabel">node-label</data></node>',
    '    <edge id="e1" source="n1" target="n1"><data key="extLabel">edge-label</data></edge>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  await paste(document, dom.window, '#btnPasteGraphml', graphml);   // replace import
  const graph = exportedGraph(document);
  const defs = graph.customAttributes;
  assert.equal(defs.length, 1, 'exactly one definition — on the graph scope only');
  assert.equal(defs[0].scope, 'graph');
  assert.equal(graph.graphCustom?.extLabel, 'graph-note', 'the graph-level value is preserved as a custom property');
  const n = graph.nodes.find(n => n.id === 'n1');
  const e = graph.edges.find(e => e.id === 'e1');
  assert.equal(n?.label, 'node-label', 'the node label field received its value');
  assert.equal(e?.label, 'edge-label', 'the edge label field received its value');
  assert.ok(!n?.custom, 'no node-scope definition is created for a built-in field');
  assert.ok(!e?.custom, 'no edge-scope definition is created for a built-in field');
  assert.match(toasts(document), /imported/i);
  assert.deepEqual(errors.map(e2 => e2.message), []);
  dom.window.close();
});

test('GraphML round-trips custom string values verbatim, spaces included', async () => {
  const saved = { title: 'verbatim-strings',
    customAttributes: [{ id: 'note', scope: 'node', type: 'string' }],
    nodes: [{ id: 'n1', label: 'One', x: 0, y: 0, order: 0, custom: { note: ' keep me ' } }],
    edges: [] };
  const {dom, errors} = createEditorDom(saved);
  const {window} = dom;
  const {document} = window;
  await settle(window, 60);
  // The stored value carries its spaces through the exporter…
  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  const graphml = modal.querySelector('textarea').value;
  assert.match(graphml, /<data key="note"> keep me <\/data>/, 'the exported value carries its spaces');
  modal.remove();
  // …and through re-importing that file into the same document.
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, window, '#btnPasteGraphml', graphml);
  const graph = exportedGraph(document);
  const imported = graph.nodes.find(n => n.custom && Object.keys(n.custom).length && n.label === 'One');
  assert.equal(imported?.custom?.note, ' keep me ', 'the spaces survive the round-trip');
  // A foreign <default> with surrounding padding is stored verbatim too.
  const padded = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="pad" for="node" attr.name="pad" attr.type="string"><default>  padded  </default></key>',
    '  <graph edgedefault="directed"><node id="p1"/></graph>',
    '</graphml>',
  ].join('\n');
  await paste(document, window, '#btnPasteGraphml', padded);
  const withPad = exportedGraph(document);
  const p1 = withPad.nodes.find(n => n.id === 'p1');
  assert.equal(p1?.custom?.pad, '  padded  ', 'the padded default is stored verbatim');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

// === The multi-scope ('all') definition model ===

test('pasting a payload carrying an all-scope definition does not fork a per-scope twin', async () => {
  // The entity values are keyed by the definition's id; the payload declares
  // it once, scope 'all'. The paste must resolve against the 'all|' pair —
  // minting a node-scope twin would silently move the values off the shared id.
  const payload = JSON.stringify({ type: 'graph-editor-clipboard',
    nodes: [{ id: 'c1', label: 'Carried', x: 20, y: 20, order: 0, custom: { metric: 'm' } }],
    edges: [{ id: 'c2', from: 'c1', to: 'c1', directed: true, custom: { metric: 'e' } }],
    externalEdges: [],
    customAttributes: [{ id: 'metric', scope: 'all', type: 'string' }] });
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await settle(dom.window, 60);
  Object.defineProperty(dom.window.navigator, 'clipboard',
    { configurable: true, value: { writeText: async () => {}, readText: async () => payload } });
  document.querySelector('#btnPaste2').click();
  await settle(dom.window, 80);
  const graph = exportedGraph(document);
  const defs = graph.customAttributes.filter(d => d.id === 'metric');
  assert.equal(defs.length, 1, 'exactly one definition is created for the carried all-scope definition');
  assert.equal(defs[0].scope, 'all', 'and it is an all-scope definition');
  const node = graph.nodes.find(n => n.label === 'Carried');
  assert.equal(node.custom?.metric, 'm', 'the node value binds the shared id');
  const edge = graph.edges.find(e => e.from === node.id);
  assert.equal(edge.custom?.metric, 'e', 'the edge value binds the same shared id');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('pasting an all-scope definition whose id is taken mints an all-scope twin, never a per-scope one', async () => {
  const saved = { title: 'all-twin', nodes: [{id:'b1', label:'Keep', x:0, y:0, order:0}], edges: [],
    customAttributes: [{ id: 'metric', scope: 'graph', type: 'string' }] };
  const payload = JSON.stringify({ type: 'graph-editor-clipboard',
    nodes: [{ id: 'c1', label: 'Carried', x: 20, y: 20, order: 0, custom: { metric: 'm' } }],
    edges: [], externalEdges: [],
    customAttributes: [{ id: 'metric', scope: 'all', type: 'string' }] });
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  Object.defineProperty(dom.window.navigator, 'clipboard',
    { configurable: true, value: { writeText: async () => {}, readText: async () => payload } });
  document.querySelector('#btnPaste2').click();
  await settle(dom.window, 80);
  const graph = exportedGraph(document);
  const alls = graph.customAttributes.filter(d => d.scope === 'all');
  assert.equal(alls.length, 1, 'one fresh all-scope definition is minted');
  assert.equal(alls[0].origin, 'metric', 'it records the carried id as its origin');
  const node = graph.nodes.find(n => n.label === 'Carried');
  assert.equal(node.custom?.[alls[0].id], 'm', 'the carried value binds the fresh all-scope id');
  assert.equal(node.custom?.metric, undefined, 'and never the taken graph-scope id');
  assert.equal(graph.customAttributes.filter(d => d.scope === 'graph').length, 1, 'the original graph definition is untouched');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('an all-scope definition exports for="all" and re-imports as all-scope, values intact', async () => {
  const saved = { title: 'all-roundtrip',
    customAttributes: [{ id: 'metric', scope: 'all', type: 'string' }],
    graphCustom: { metric: 'graph-value' },
    nodes: [{ id: 'n1', label: 'One', x: 0, y: 0, order: 0, custom: { metric: 'node-value' } }],
    edges: [] };
  const {dom, errors} = createEditorDom(saved);
  const {window} = dom;
  const {document} = window;
  await settle(window, 60);
  // The stored 'all' scope survives the load path.
  assert.equal(exportedGraph(document).customAttributes[0]?.scope, 'all', 'the saved document loads with an all-scope definition');
  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  const graphml = modal.querySelector('textarea').value;
  modal.remove();
  assert.match(graphml, /<key id="metric" for="all"[^>]*qvge:kind="custom-attribute"/, 'the definition exports for="all"');
  assert.match(graphml, /<data key="metric">graph-value<\/data>/, 'the graph value is written');
  assert.match(graphml, /<data key="metric">node-value<\/data>/, 'the node value is written');
  // Replace-import the export: one all-scope definition comes back.
  document.querySelector('#btnExportGraphml').click();
  const modal2 = document.querySelector('.export-modal');
  modal2.querySelector('textarea').value = graphml;
  modal2.querySelector('#expImportBtn').click();
  await settle(window, 60);
  const graph = exportedGraph(document);
  const defs = graph.customAttributes.filter(d => d.id === 'metric');
  assert.equal(defs.length, 1, 'a single definition survives the round-trip');
  assert.equal(defs[0].scope, 'all', 'and it comes back all-scope');
  assert.equal(graph.graphCustom?.metric, 'graph-value', 'the graph value survives');
  assert.equal(graph.nodes.find(n => n.id === 'n1')?.custom?.metric, 'node-value', 'the node value survives');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('growing a graph definition to all is additive — no confirmation, the value stays graph-level', async () => {
  const saved = { title: 'grow-to-all',
    customAttributes: [{ id: 'metric', scope: 'graph', type: 'string' }],
    graphCustom: { metric: 'graph-value' },
    nodes: [{ id: 'n1', label: 'One', x: 0, y: 0, order: 0 }],
    edges: [] };
  const {dom, errors} = createEditorDom(saved);
  const {window} = dom;
  const {document} = window;
  await settle(window, 60);
  const rowSelect = () => document.querySelector('#customAttributesList .custom-attribute-row [data-attribute-field="scope"]');
  assert.equal(rowSelect()?.value, 'graph');
  rowSelect().value = 'all';
  document.querySelector('#customAttributesList [data-attribute-action="save"]').click();
  await settle(window, 60);
  assert.equal(document.querySelector('.app-dialog'), null, 'no confirmation is asked when growing to all');
  const graph = exportedGraph(document);
  assert.equal(graph.customAttributes.find(d => d.id === 'metric')?.scope, 'all', 'the definition is all-scope now');
  assert.equal(graph.graphCustom?.metric, 'graph-value', 'and the graph value stayed where it was');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('narrowing an all definition asks for confirmation and drops only the lost scopes', async () => {
  const saved = { title: 'narrow-from-all',
    customAttributes: [{ id: 'metric', scope: 'all', type: 'string' }],
    graphCustom: { metric: 'graph-value' },
    nodes: [{ id: 'n1', label: 'One', x: 0, y: 0, order: 0, custom: { metric: 'node-value' } }],
    edges: [{ id: 'e1', from: 'n1', to: 'n1', directed: true, custom: { metric: 'edge-value' } }] };
  const {dom, errors} = createEditorDom(saved);
  const {window} = dom;
  const {document} = window;
  await settle(window, 60);
  const rowSelect = () => document.querySelector('#customAttributesList .custom-attribute-row [data-attribute-field="scope"]');
  assert.equal(rowSelect()?.value, 'all');
  rowSelect().value = 'node';
  document.querySelector('#customAttributesList [data-attribute-action="save"]').click();
  await settle(window, 60);
  const dialog = document.querySelector('.app-dialog');
  assert.ok(dialog, 'narrowing out of all asks for a danger confirmation');
  dialog.querySelector('[data-dialog-ok]').click();
  await settle(window, 60);
  const graph = exportedGraph(document);
  assert.equal(graph.customAttributes.find(d => d.id === 'metric')?.scope, 'node', 'the definition is node-scope now');
  assert.equal(graph.graphCustom?.metric, undefined, 'the graph value is discarded');
  assert.equal(graph.nodes[0].custom?.metric, 'node-value', 'the node value — still applicable — is kept');
  assert.equal(graph.edges[0].custom?.metric, undefined, 'the edge value is discarded');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('cancelling the narrowing confirmation leaves every value untouched', async () => {
  const saved = { title: 'narrow-cancel',
    customAttributes: [{ id: 'metric', scope: 'all', type: 'string' }],
    graphCustom: { metric: 'graph-value' },
    nodes: [{ id: 'n1', label: 'One', x: 0, y: 0, order: 0, custom: { metric: 'node-value' } }],
    edges: [] };
  const {dom, errors} = createEditorDom(saved);
  const {window} = dom;
  const {document} = window;
  await settle(window, 60);
  const rowSelect = () => document.querySelector('#customAttributesList .custom-attribute-row [data-attribute-field="scope"]');
  rowSelect().value = 'node';
  document.querySelector('#customAttributesList [data-attribute-action="save"]').click();
  await settle(window, 60);
  const dialog = document.querySelector('.app-dialog');
  assert.ok(dialog, 'narrowing asks for confirmation');
  dialog.querySelector('[data-dialog-cancel]').click();
  await settle(window, 60);
  const graph = exportedGraph(document);
  assert.equal(graph.customAttributes.find(d => d.id === 'metric')?.scope, 'all', 'the definition stays all-scope');
  assert.equal(graph.graphCustom?.metric, 'graph-value', 'the graph value is kept');
  assert.equal(graph.nodes[0].custom?.metric, 'node-value', 'the node value is kept');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

// === Audit round (2026-11): origin provenance & verbatim empties ===

test('identity reuse does not bind a same-key-id property with a different recorded name', async () => {
  // A graph-scope 'a' takes the bare id, so the first file's node key mints
  // a_1 (name fruit). A second file declaring node key a with name owner is
  // the same key id but a DIFFERENT property — it must mint afresh.
  const saved = { title: 'origin-name-guard', nodes: [], edges: [],
    customAttributes: [{ id: 'a', scope: 'graph', type: 'string' }] };
  const file = (name, value) => [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    `  <key id="a" for="node" attr.name="${name}" attr.type="string"/>`,
    '  <graph id="g" edgedefault="directed">',
    `    <node id="n1"><data key="a">${value}</data></node>`,
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, dom.window, '#btnPasteGraphml', file('fruit', 'apple'));
  await paste(document, dom.window, '#btnPasteGraphml', file('owner', 'bob'));
  const graph = exportedGraph(document);
  const fruit = graph.customAttributes.find(d => d.name === 'fruit');
  const owner = graph.customAttributes.find(d => d.name === 'owner');
  assert.ok(fruit && owner, 'two distinct definitions exist for the two properties');
  assert.notEqual(fruit.id, owner.id, 'a distinct property is never bound to the fruit definition');
  const imported = graph.nodes.filter(n => n.custom);
  const values = imported.flatMap(n => Object.entries(n.custom));
  assert.ok(values.some(([id, v]) => id === fruit.id && v === 'apple'), 'the fruit value stays on the fruit definition');
  assert.ok(values.some(([id, v]) => id === owner.id && v === 'bob'), 'bob binds the owner definition, not the fruit one');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('JSON round-trip preserves origin, so a later reverse-order append cannot swap same-name properties', async () => {
  const saved = { title: 'origin-json', nodes: [], edges: [],
    customAttributes: [
      { id: 'a', scope: 'graph', type: 'int', name: 'metric' },
      { id: 'b', scope: 'graph', type: 'int', name: 'metric' },
    ] };
  const graphml = (first, second, v1, v2) => [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    `  <key id="${first}" for="node" attr.name="metric" attr.type="int"/>`,
    `  <key id="${second}" for="node" attr.name="metric" attr.type="int"/>`,
    '  <graph id="g" edgedefault="directed">',
    `    <node id="m1"><data key="${first}">${v1}</data><data key="${second}">${v2}</data></node>`,
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom(saved);
  const {window} = dom;
  const {document} = window;
  await settle(window, 60);
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, window, '#btnPasteGraphml', graphml('a', 'b', 100, 200));
  // Export the JSON document, then replace-import it (origin must survive)…
  const json = exportedGraph(document);
  assert.ok(json.customAttributes.some(d => d.id === 'a_1' && d.origin === 'a'), 'the minted definition exports its origin');
  const jsonText = JSON.stringify(json);
  document.querySelector('#optImportAppend').checked = false;
  await paste(document, window, '#btnPasteJson', jsonText);               // clean replace
  // …then append the same keys reversed — values must not swap.
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, window, '#btnPasteGraphml', graphml('b', 'a', 200, 100));
  const graph = exportedGraph(document);
  const a1 = graph.customAttributes.find(d => d.origin === 'a' && d.scope === 'node');
  const b1 = graph.customAttributes.find(d => d.origin === 'b' && d.scope === 'node');
  assert.ok(a1 && b1, 'both original definitions survive the round-trips');
  const customs = graph.nodes.map(n => n.custom).filter(Boolean);
  assert.ok(customs.some(c => c[a1.id] === 100 && c[b1.id] === 200), 'the values stay bound to the same definitions in both key orders');
  assert.equal(graph.customAttributes.length, 4, 'no definitions are minted by the round-trip');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('GraphML round-trip preserves origin, so reverse-order reimport cannot swap same-name properties', async () => {
  const saved = { title: 'origin-graphml', nodes: [], edges: [],
    customAttributes: [
      { id: 'a', scope: 'graph', type: 'int', name: 'metric' },
      { id: 'b', scope: 'graph', type: 'int', name: 'metric' },
    ] };
  const graphml = (first, second) => [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    `  <key id="${first}" for="node" attr.name="metric" attr.type="int"/>`,
    `  <key id="${second}" for="node" attr.name="metric" attr.type="int"/>`,
    '  <graph id="g" edgedefault="directed">',
    `    <node id="m1"><data key="${first}">100</data><data key="${second}">200</data></node>`,
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom(saved);
  const {window} = dom;
  const {document} = window;
  await settle(window, 60);
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, window, '#btnPasteGraphml', graphml('a', 'b'));
  // Export GraphML and reimport it (replace), then append reversed.
  const exporter = document.querySelector('#btnExportGraphml');
  exporter.click();
  const modal = document.querySelector('.export-modal');
  const text = modal.querySelector('textarea').value;
  modal.remove();
  document.querySelector('#optImportAppend').checked = false;
  exporter.click();
  const modal2 = document.querySelector('.export-modal');
  modal2.querySelector('textarea').value = text;
  modal2.querySelector('#expImportBtn').click();
  await settle(window, 60);
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, window, '#btnPasteGraphml', graphml('b', 'a'));
  const graph = exportedGraph(document);
  const a1 = graph.customAttributes.find(d => d.origin === 'a' && d.scope === 'node');
  const b1 = graph.customAttributes.find(d => d.origin === 'b' && d.scope === 'node');
  assert.ok(a1 && b1, 'both original definitions survive the GraphML round-trip');
  const customs = graph.nodes.map(n => n.custom).filter(Boolean);
  assert.ok(customs.some(c => c[a1.id] === 100 && c[b1.id] === 200), 'the values stay bound to the same definitions in both key orders');
  assert.equal(graph.customAttributes.length, 4, 'no definitions are minted by the round-trip');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('one clipboard paste never binds two carried properties to one existing definition', async () => {
  // The document already holds k2_1 (node, name 'tag', origin 'k2'). The
  // payload carries two NEW properties with distinct ids and the same name.
  // The k3 value must not be stolen by k2_1 (and k3 must not mint onto it) —
  // and the k2 value must still resolve to k2_1 via its origin.
  const saved = { title: 'paste-claimed', nodes: [{id:'keep', label:'Keep', x:0, y:0, order:0}], edges: [],
    customAttributes: [{ id: 'k2_1', scope: 'node', type: 'string', name: 'tag', origin: 'k2' }] };
  const payload = JSON.stringify({ type: 'graph-editor-clipboard',
    nodes: [{ id: 'c1', label: 'Carried', x: 20, y: 20, order: 0, custom: { k3: 'VAL_K3', k2: 'VAL_K2' } }],
    edges: [], externalEdges: [],
    customAttributes: [
      { id: 'k3', scope: 'node', type: 'string', name: 'tag' },
      { id: 'k2', scope: 'node', type: 'string', name: 'tag' },
    ] });
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  Object.defineProperty(dom.window.navigator, 'clipboard',
    { configurable: true, value: { writeText: async () => {}, readText: async () => payload } });
  document.querySelector('#btnPaste2').click();
  await settle(dom.window, 80);
  const graph = exportedGraph(document);
  const carried = graph.nodes.find(n => n.label === 'Carried');
  assert.equal(carried.custom?.k2_1, 'VAL_K2', 'the k2 value reuses the k2_1 definition via its origin');
  assert.equal(carried.custom?.k3, 'VAL_K3', 'the k3 value keeps its own definition, never collapses onto k2_1');
  const defs = graph.customAttributes.filter(d => (d.name ?? d.id) === 'tag');
  assert.equal(defs.length, 2, 'one reused definition (k2_1) and one fresh one for the distinct property');
  assert.ok(defs.some(d => d.id === 'k2_1'), 'the existing definition is reused');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('an explicitly empty or whitespace-only custom string beats the declared default, and round-trips', async () => {
  const graphml = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="note" for="node" attr.name="note" attr.type="string"><default>fallback</default></key>',
    '  <key id="gNote" for="graph" attr.name="gNote" attr.type="string"><default>gfallback</default></key>',
    '  <key id="eNote" for="edge" attr.name="eNote" attr.type="string"><default>efallback</default></key>',
    '  <graph id="g" edgedefault="directed">',
    '    <data key="gNote"></data>',
    '    <node id="n1"><data key="note"></data></node>',
    '    <node id="n2"><data key="note"> </data></node>',
    '    <node id="n3"/>',
    '    <edge id="e1" source="n1" target="n2"><data key="eNote"></data></edge>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {window} = dom;
  const {document} = window;
  await settle(window, 60);
  await paste(document, window, '#btnPasteGraphml', graphml);
  let graph = exportedGraph(document);
  assert.equal(graph.graphCustom?.gNote, '', 'an explicitly empty graph-level value beats the default');
  const byId = id => graph.nodes.find(n => n.id === id);
  assert.equal(byId('n1')?.custom?.note, '', 'an explicitly empty node value beats the default');
  assert.equal(byId('n2')?.custom?.note, ' ', 'a whitespace-only node value is stored verbatim');
  assert.equal(byId('n3')?.custom?.note, 'fallback', 'an absent value takes the default');
  assert.equal(graph.edges[0]?.custom?.eNote, '', 'an explicitly empty edge value beats the default');
  // The empty values must survive the export verbatim…
  document.querySelector('#btnExportGraphml').click();
  const modal = document.querySelector('.export-modal');
  const exported = modal.querySelector('textarea').value;
  modal.remove();
  assert.match(exported, /<data key="note"><\/data>/, 'the empty node value is written');
  assert.match(exported, /<data key="note"> <\/data>/, 'the whitespace node value is written');
  assert.match(exported, /<data key="gNote"><\/data>/, 'the empty graph value is written');
  assert.match(exported, /<data key="eNote"><\/data>/, 'the empty edge value is written');
  // …and the reimport.
  document.querySelector('#btnExportGraphml').click();
  const modal2 = document.querySelector('.export-modal');
  modal2.querySelector('textarea').value = exported;
  modal2.querySelector('#expImportBtn').click();
  await settle(window, 60);
  graph = exportedGraph(document);
  assert.equal(graph.graphCustom?.gNote, '', 'the empty graph value survives the round-trip');
  assert.equal(graph.nodes.find(n => n.id === 'n1')?.custom?.note, '', 'the empty node value survives the round-trip');
  assert.equal(graph.nodes.find(n => n.id === 'n2')?.custom?.note, ' ', 'the whitespace node value survives the round-trip');
  assert.equal(graph.edges.find(e => e.id === 'e1')?.custom?.eNote, '', 'the empty edge value survives the round-trip');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('DOT round-trip preserves bracketed labels and self-exported node attributes', async () => {
  const labels = ['arr[0]', 'say "hi" [1]', 'x]y'];
  const saved = {
    title: 'brackets',
    nodes: labels.map((label, i) => ({ id: 'n' + i, label, x: i * 120, y: 0, order: i })),
    edges: [{ id: 'e1', from: 'n0', to: 'n1', label: 'link[0]', weight: '3', directed: true }],
  };
  const {dom} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportDot').click();
  const dot = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();

  await paste(document, dom.window, '#btnPasteDot', dot);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, labels.length, 'every node survives the round-trip');
  assert.deepEqual(graph.nodes.map(n => n.label), labels, 'bracketed labels round-trip');
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].label, 'link[0]', 'bracketed edge labels round-trip');
  dom.window.close();
});

test('DOT import applies stacked attribute lists (node colour after label, edge direction after weight)', async () => {
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteDot',
    'digraph G {\n  n1 [label="first"][color="#ff0000"];\n  n2 [label="second"];\n  n1 -> n2 [weight="2"][dir="none"];\n}');
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.find(n => n.label === 'first')?.color, '#ff0000', 'the second node list is applied');
  assert.equal(graph.edges[0]?.weight, '2', 'the first edge list is applied');
  assert.equal(graph.edges[0]?.direction, 'undirected', 'the second edge list is applied');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('an append import reuses an all-scope definition for a narrower incoming scope instead of minting', async () => {
  const saved = { title: 'all-cover',
    nodes: [{ id: 'n1', label: 'One', x: 0, y: 0, order: 0, custom: { mood: 'calm' } }],
    edges: [],
    customAttributes: [{ id: 'mood', scope: 'all', type: 'string' }],
    graphCustom: {} };
  const graphml = [
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="mood" for="node" attr.name="mood" attr.type="string"/>',
    '  <graph id="g" edgedefault="directed">',
    '    <node id="n2"><data key="mood">happy</data></node>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  document.querySelector('#optImportAppend').checked = true;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph = exportedGraph(document);
  assert.equal(graph.customAttributes.length, 1, 'the all-scope definition covers the incoming node-scope property');
  assert.equal(graph.customAttributes[0].scope, 'all');
  assert.equal(graph.nodes.find(n => n.id === 'n2')?.custom?.mood, 'happy', 'the imported node binds the all-scope definition');
  assert.equal(graph.nodes.find(n => n.id === 'n1')?.custom?.mood, 'calm', 'the carried value stays bound');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a replace import that carries no settings does not inherit the replaced document\'s pending custom defaults', async () => {
  const saved = { title: 'old',
    nodes: [{ id: 'n1', label: 'One', x: 0, y: 0, order: 0 }],
    edges: [],
    customAttributes: [{ id: 'score', scope: 'all', type: 'string' }],
    graphCustom: {},
    settings: { nodeCustom: { score: 'carried-node-default' }, edgeCustom: { score: 'carried-edge-default' } } };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  await settle(dom.window, 60);
  assert.equal(exportedGraph(document).settings.nodeCustom?.score, 'carried-node-default', 'the seed default is in place');
  assert.equal(exportedGraph(document).settings.edgeCustom?.score, 'carried-edge-default', 'the seed edge default is in place');
  // A JSON file without settings must not drag the replaced document's pending
  // defaults along — they would stamp onto elements created in the new document.
  const payload = JSON.stringify({ title: 'new',
    nodes: [{ id: 'n1', label: 'A', x: 0, y: 0, order: 0 }], edges: [],
    customAttributes: [{ id: 'score', scope: 'all', type: 'string' }] });
  await paste(document, dom.window, '#btnPasteJson', payload);
  const replaced = exportedGraph(document);
  assert.equal(replaced.settings.nodeCustom?.score, undefined, 'the replaced document\'s pending node default is gone');
  assert.equal(replaced.settings.edgeCustom?.score, undefined, 'the replaced document\'s pending edge default is gone');
  // …while a file that carries its own pending defaults still applies them.
  const payload2 = JSON.stringify({ title: 'newer',
    nodes: [{ id: 'n1', label: 'A', x: 0, y: 0, order: 0 }], edges: [],
    customAttributes: [{ id: 'score', scope: 'all', type: 'string' }],
    settings: { nodeCustom: { score: 'file-node-default' } } });
  await paste(document, dom.window, '#btnPasteJson', payload2);
  assert.equal(exportedGraph(document).settings.nodeCustom?.score, 'file-node-default', 'a carried pending default is applied');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});
