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
  assert.ok(keyIds.includes('capacity'), 'the non-colliding custom definition is exported');

  // The built-in key still carries the value, and the import restores it.
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const graph = exportedGraph(document);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].arrowSize, 20, 'arrowSize survives the round-trip');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('GraphML keys that reuse a built-in id for an unrelated attr.name become custom definitions', async () => {
  // The attribute NAME is what makes a key built-in — the engine reads those
  // values positionally by name. An external document may reuse a now-reserved
  // id for something else entirely; filtering on the id alone discarded it.
  const graphml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="direction" for="node" attr.name="externalTag" attr.type="string"/>',
    '  <key id="arrowSize" for="edge" attr.name="packetCount" attr.type="int"/>',
    '  <key id="weight" for="edge" attr.name="weight" attr.type="string"/>',
    '  <graph edgedefault="directed">',
    '    <node id="n1"><data key="direction">alpha</data></node>',
    '    <node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"><data key="weight">3</data><data key="arrowSize">9</data></edge>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);

  const rows = [...document.querySelectorAll('.custom-attribute-row')].map(row => ({
    id: row.querySelector('[data-attribute-field="id"]').value,
    scope: row.querySelector('[data-attribute-field="scope"]').value,
    type: row.querySelector('[data-attribute-field="type"]').value,
  }));
  assert.equal(rows.length, 2, 'both external definitions are kept');
  assert.ok(!rows.some(row => row.id === 'weight'), 'a genuine built-in name is not a custom definition');
  // Definitions are named after their own attr.name (lowercased, as the
  // importer has always done), not after the built-in id they collided with.
  assert.equal(rows.find(row => row.id === 'packetcount').type, 'int', 'the definition type survives');
  assert.equal(rows.find(row => row.id === 'externaltag').scope, 'node', 'the definition scope survives');

  // The graph itself still imports, and the unrelated data does not leak into
  // the built-in fields it happens to share an id with.
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].weight, '3', 'the real built-in weight is parsed');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('GraphML import keeps built-in-only documents free of custom definitions', async () => {
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="label" for="node" attr.name="label" attr.type="string"/>',
    '  <key id="weight" for="edge" attr.name="weight" attr.type="string"/>',
    '  <key id="direction" for="edge" attr.name="direction" attr.type="string"/>',
    '  <key id="arrowSize" for="edge" attr.name="arrow.size" attr.type="double"/>',
    '  <graph edgedefault="directed">',
    '    <node id="n1"><data key="label">A</data></node>',
    '    <node id="n2"><data key="label">B</data></node>',
    '    <edge id="e1" source="n1" target="n2"><data key="weight">2</data><data key="direction">mutual</data><data key="arrowSize">30</data></edge>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  assert.equal(document.querySelectorAll('.custom-attribute-row').length, 0, 'no built-in comes back as a custom definition');
  const graph = exportedGraph(document);
  assert.equal(graph.edges[0].direction, 'mutual');
  assert.equal(graph.edges[0].arrowSize, 30);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('built-in keys are identified by id and name together, aliases included', async () => {
  // A name alone cannot decide this. `style` is the exporter's own edge
  // stroke-style name AND a legal user definition; only the key id shows which
  // is which. Aliases the parser reads (arrowsize, fillcolor, posx, `name`,
  // `value`) bind to built-in fields, so they must never surface as definitions.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    // the app's own keys -> built-in
    '  <key id="edgeStrokeStyle" for="edge" attr.name="style" attr.type="string"/>',
    '  <key id="weight" for="edge" attr.name="weight" attr.type="string"/>',
    '  <key id="arrowSize" for="edge" attr.name="arrow.size" attr.type="double"/>',
    '  <key id="label" for="node" attr.name="label" attr.type="string"/>',
    // aliases the parser reads -> still built-in, never definitions
    '  <key id="as" for="edge" attr.name="arrowsize" attr.type="double"/>',
    '  <key id="vv" for="edge" attr.name="value" attr.type="string"/>',
    '  <key id="px" for="node" attr.name="posx" attr.type="double"/>',
    '  <key id="fc" for="node" attr.name="fillcolor" attr.type="string"/>',
    '  <key id="nn" for="node" attr.name="name" attr.type="string"/>',
    // a user definition reusing the schema name `style` under its own id
    '  <key id="style" for="edge" attr.name="style" attr.type="string"/>',
    '  <key id="nStyle" for="node" attr.name="style" attr.type="string"/>',
    '  <graph edgedefault="directed">',
    '    <node id="n1"><data key="label">A</data><data key="px">7</data><data key="fc">#ff0000</data></node>',
    '    <node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"><data key="edgeStrokeStyle">dashed</data><data key="weight">4</data><data key="as">24</data></edge>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);

  const rows = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(rows.sort(), ['nStyle', 'style'], 'only the user-authored keys become definitions');

  const graph = exportedGraph(document);
  assert.equal(graph.edges[0].strokeStyle, 'dashed', 'the app key still drives stroke style');
  assert.equal(graph.edges[0].weight, '4', 'weight still drives weight');
  assert.equal(graph.edges[0].arrowSize, 24, 'the arrowsize alias still sets the built-in size');
  assert.equal(graph.nodes[0].x, 7, 'the posx alias still sets the position');
  assert.equal(graph.nodes[0].color, '#ff0000', 'the fillcolor alias still sets the colour');
  assert.equal(graph.nodes[0].label, 'A');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a user definition may reuse a schema name on a scope that has no such field', async () => {
  // Nodes have no `style` property, so an edge-schema name on a node is the
  // user's definition and must survive its own export/import. `name` and
  // `value` are label/weight aliases, so they are built-in and never surface.
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0}], edges: [],
    customAttributes: [{id:'style', scope:'node', type:'string'}],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportGraphml').click();
  const graphml = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  assert.match(graphml, /<key id="style" for="node" attr\.name="style"/);

  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids, ['style'], 'the node definition comes back');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('an edge definition named style survives its own round-trip', async () => {
  // The editor allows an edge definition called `style`; the exporter writes it
  // under its own id, which is what distinguishes it from the built-in key.
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0}, {id:'n2', label:'B', x:100, y:0}],
    edges: [{id:'e1', from:'n1', to:'n2', label:'', weight:'1', directed:true, direction:'directed'}],
    customAttributes: [{id:'style', scope:'edge', type:'string'}],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportGraphml').click();
  const graphml = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  assert.match(graphml, /<key id="style" for="edge" attr\.name="style"/);

  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids, ['style'], 'the edge definition comes back');
  const graph = exportedGraph(document);
  assert.equal(graph.edges.length, 1, 'the graph is intact');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('node definitions keep working while parser aliases stay built-in', async () => {
  // `name` backs up a missing node label and `value` backs up an edge weight,
  // so keys spelled that way are built-in fields and must not surface as
  // definitions. A node definition that reuses an edge-schema name (`style`) is
  // the user's, though — nodes have no such property.
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0}, {id:'n2', label:'B', x:100, y:0}], edges: [],
    customAttributes: [{id:'style', scope:'node', type:'string'}],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportGraphml').click();
  const graphml = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  assert.match(graphml, /<key id="style" for="node" attr\.name="style"/);

  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids, ['style'], 'the node definition comes back');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('external GraphML keys reusing older reserved ids keep their definitions', async () => {
  // The importer has always accepted an external key such as id="x" with an
  // unrelated attr.name. Once ids became reserved, the sanitizer dropped them;
  // they must be renamed instead, named after their own attr.name.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="x" for="node" attr.name="externalTag" attr.type="string"/>',
    '  <key id="y" for="edge" attr.name="priority" attr.type="int"/>',
    '  <key id="color" for="graph" attr.name="palette" attr.type="string"/>',
    '  <key id="x2" for="node" attr.name="x" attr.type="double"/>',
    '  <graph edgedefault="directed">',
    '    <node id="n1"/>',
    '    <node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);

  const rows = [...document.querySelectorAll('.custom-attribute-row')].map(row => ({
    id: row.querySelector('[data-attribute-field="id"]').value,
    scope: row.querySelector('[data-attribute-field="scope"]').value,
    type: row.querySelector('[data-attribute-field="type"]').value,
  }));
  assert.equal(rows.length, 3, 'every external definition survives');
  assert.deepEqual(rows.find(row => row.id === 'externaltag'), {id:'externaltag', scope:'node', type:'string'});
  assert.deepEqual(rows.find(row => row.id === 'priority'), {id:'priority', scope:'edge', type:'int'});
  assert.deepEqual(rows.find(row => row.id === 'palette'), {id:'palette', scope:'graph', type:'string'});

  // The real built-ins sharing those ids still parse, and the next import of the
  // exported document keeps the same three definitions.
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  const roundTripped = [];
  document.querySelector('#btnExportGraphml').click();
  roundTripped.push(document.querySelector('.export-modal textarea').value);
  document.querySelector('#expCloseBtn').click();
  await paste(document, dom.window, '#btnPasteGraphml', roundTripped[0]);
  const again = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(again.sort(), ['externaltag', 'palette', 'priority'], 'definitions survive a round-trip');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('every attr.name the GraphML exporter writes is classed built-in for its scope', async () => {
  // The built-in name sets and the exporter's key list have to agree: a name
  // the exporter writes but the sets miss re-opens the phantom-definition bug
  // on the app's own documents; a name the sets include but the app never
  // writes silently discards a user's definition. This caught a real mismatch
  // (attr.name="edge.weight.colorLow" vs a lowercased set entry).
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0}, {id:'n2', label:'B', x:100, y:0}],
    edges: [{id:'e1', from:'n1', to:'n2', label:'', weight:'1', directed:true, direction:'directed'}],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportGraphml').click();
  const graphml = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();

  const keys = [...graphml.matchAll(/<key id="([^"]+)" for="([^"]+)" attr\.name="([^"]+)"/g)]
    .map(([, id, scope, name]) => ({id, scope, name}));
  assert.ok(keys.length > 40, 'the exporter emits its full schema');

  // Re-importing our own export must yield no custom definitions at all: every
  // key it carries is part of the schema, not the user's.
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const rows = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(rows, [], 'no key from the app\'s own export becomes a custom definition');

  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a user style definition coexists with the built-in edge style key', async () => {
  // Both appear in one document: our <key id="edgeStrokeStyle" attr.name="style">
  // and the user's <key id="style" attr.name="style">. Only the id separates
  // them, so both the stroke style and the definition must survive.
  const saved = {
    nodes: [{id:'n1', label:'A', x:0, y:0}, {id:'n2', label:'B', x:100, y:0}],
    edges: [{id:'e1', from:'n1', to:'n2', label:'', weight:'1', directed:true, direction:'directed', strokeStyle:'dashed'}],
    customAttributes: [{id:'style', scope:'edge', type:'string'}],
  };
  const {dom, errors} = createEditorDom(saved);
  const {document} = dom.window;
  document.querySelector('#btnExportGraphml').click();
  const graphml = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();

  const keyIds = [...graphml.matchAll(/<key id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(keyIds).size, keyIds.length, 'key ids stay unique');
  assert.equal(keyIds.filter(id => id === 'style').length, 1, 'one user style key');
  assert.ok(keyIds.includes('edgeStrokeStyle'), 'and the built-in one');

  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids, ['style'], 'the definition survives');
  const graph = exportedGraph(document);
  assert.equal(graph.edges[0].strokeStyle, 'dashed', 'and the built-in stroke style still round-trips');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a foreign name under one of the app key ids stays a definition', async () => {
  // id="weight" attr.name="score" is not the built-in weight: the name decides.
  const graphml = [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="weight" for="node" attr.name="score" attr.type="double"/>',
    '  <key id="label" for="node" attr.name="title" attr.type="string"/>',
    '  <key id="arrowSize" for="node" attr.name="rank" attr.type="int"/>',
    '  <graph edgedefault="directed"><node id="n1"/></graph>',
    '</graphml>',
  ].join('\n');
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  await paste(document, dom.window, '#btnPasteGraphml', graphml);
  const ids = [...document.querySelectorAll('.custom-attribute-row [data-attribute-field="id"]')].map(input => input.value);
  assert.deepEqual(ids.sort(), ['rank', 'score', 'title'], 'all three foreign definitions are kept');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
