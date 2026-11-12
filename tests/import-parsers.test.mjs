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
  assert.ok(!/secret/.test(node), 'the definition value does not become the node label');
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
  assert.ok(!/secret/.test(node), 'the definition value does not become any built-in field');
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
  // `for` is optional and defaults to "all". The editor only models three
  // concrete scopes, and dropping a definition because its scope is the
  // spec's wildcard is silent data loss.
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
  assert.deepEqual(rows, [{id:'tag', scope:'graph'}], 'the definition survives with the widest scope');

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

test('every <data> key the exporter writes is declared in its own key block', async () => {
  // The exporter emits its <data> lines as literals, so nothing structurally
  // stops it naming a key it never declared — which is how the edge style once
  // went out as "style" while the reader looked for "stroke.style". This checks
  // the two sides agree, so that class of mismatch fails here rather than in a
  // round trip.
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  // The document needs elements: an empty graph only exports graph-level <data>,
  // so a mismatch on a node or edge key would never appear here.
  await paste(document, dom.window, '#btnPasteGraphml', [
    '<?xml version="1.0"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <graph edgedefault="directed">',
    '    <node id="n1"><data key="label">A</data></node><node id="n2"/>',
    '    <edge id="e1" source="n1" target="n2"/>',
    '  </graph>',
    '</graphml>',
  ].join('\n'));
  document.querySelector('#btnExportGraphml').click();
  const xml = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();

  const declared = new Set([...xml.matchAll(/<key id="([^"]+)"/g)].map(match => match[1]));
  const used = [...xml.matchAll(/<data key="([^"]+)"/g)].map(match => match[1]);
  for(const key of used){
    assert.ok(declared.has(key), `<data key="${key}"> has a matching <key> declaration`);
  }
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('an appended edge may end on a node the host graph already has', async () => {
  // Append keeps the host graph, so an incoming edge is allowed to reference a
  // node from it. Sanitising the incoming payload alone made every such edge look
  // dangling and dropped it.
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  const pasteJson = async payload => {
    Object.defineProperty(dom.window.navigator, 'clipboard', {
      configurable: true, value: {writeText: async () => {}, readText: async () => JSON.stringify(payload)}
    });
    document.querySelector('#btnPasteJson').click();
    await settle(dom.window, 60);
  };
  await pasteJson({title: 'host', nodes: [{id: 'a', x: 0, y: 0}, {id: 'a2', x: 20, y: 20}], edges: []});
  document.querySelector('#optImportAppend').checked = true;
  await pasteJson({title: 'incoming', nodes: [{id: 'b', x: 60, y: 60}], edges: [{id: 'ab', from: 'a', to: 'b'}]});

  const graph = exportedGraph(document);
  assert.deepEqual(graph.edges.map(edge => edge.id), ['ab'], 'the edge survives');
  assert.deepEqual(graph.nodes.map(node => node.id), ['a', 'a2', 'b'], 'and the host nodes are not duplicated');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('an appended edge that really is dangling is still dropped', async () => {
  // The counterpart: merging the host nodes must not disable the dangling check.
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
  await pasteJson({title: 'incoming', nodes: [{id: 'b', x: 60, y: 60}], edges: [{id: 'bad', from: 'b', to: 'nowhere'}]});

  const graph = exportedGraph(document);
  assert.deepEqual(graph.edges.map(edge => edge.id), [], 'a dangling edge is not invented into the graph');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

// Append must resolve each edge against the document its endpoints belong to.
// A node id that exists on both sides is the hard case: the appended edge has to
// follow the appended node's rename, while an edge that genuinely names a host
// node has to keep pointing at it.
function appendPair(host, incoming) {
  return async () => {
    const {dom, errors} = createEditorDom();
    const {document} = dom.window;
    const pasteJson = async payload => {
      Object.defineProperty(dom.window.navigator, 'clipboard', {
        configurable: true, value: {writeText: async () => {}, readText: async () => JSON.stringify(payload)}
      });
      document.querySelector('#btnPasteJson').click();
      await settle(dom.window, 80);
    };
    await pasteJson(host);
    document.querySelector('#optImportAppend').checked = true;
    await pasteJson(incoming);
    const graph = exportedGraph(document);
    const close = () => { assert.deepEqual(errors.map(error => error.message), []); dom.window.close(); };
    return {graph, close};
  };
}

const HOST_TWO = {title: 'host', nodes: [{id: 'n1', label: 'H1', x: 0, y: 0}, {id: 'n2', label: 'H2', x: 100, y: 0}], edges: [{id: 'e1', from: 'n1', to: 'n2'}]};

test('an appended edge follows its node when the id collides with a host node', async () => {
  // The appended nodes are renamed (n1, n2 already exist), so the appended edge
  // must follow them. Re-pointing it at the host nodes would silently connect the
  // wrong pair — it looked plausible on screen and was only visible on export.
  const run = appendPair(HOST_TWO, {
    title: 'incoming',
    nodes: [{id: 'n1', label: 'I1', x: 50, y: 50}, {id: 'n2', label: 'I2', x: 150, y: 50}],
    edges: [{id: 'ie', from: 'n1', to: 'n2'}],
  });
  const {graph, close} = await run();
  const appended = graph.nodes.filter(node => node.label === 'I1' || node.label === 'I2');
  const edge = graph.edges.find(candidate => candidate.id === 'ie');
  assert.ok(edge, 'the appended edge survives');
  assert.deepEqual(appended.map(node => node.id).sort(), [edge.from, edge.to].sort(), 'and it joins the appended nodes');
  const hostEdge = graph.edges.find(candidate => candidate.id === 'e1');
  assert.deepEqual([hostEdge.from, hostEdge.to], ['n1', 'n2'], 'the host edge is untouched');
  close();
});

test('an appended edge may join a host node and an appended one', async () => {
  // The mixed case, with a collision present to make sure the two rules do not
  // interfere: one endpoint is genuinely the host's.
  const run = appendPair(HOST_TWO, {
    title: 'incoming',
    nodes: [{id: 'n1', label: 'I1', x: 50, y: 50}, {id: 'c', label: 'C', x: 70, y: 70}],
    edges: [{id: 'mix', from: 'c', to: 'n2'}],
  });
  const {graph, close} = await run();
  const edge = graph.edges.find(candidate => candidate.id === 'mix');
  assert.ok(edge, 'the mixed edge survives');
  const appended = graph.nodes.find(node => node.label === 'C');
  assert.equal(edge.from, appended.id, 'the appended endpoint follows its rename');
  assert.equal(edge.to, 'n2', 'the host endpoint keeps its id');
  close();
});

test('a self edge on an appended node keeps both endpoints on it', async () => {
  const run = appendPair(HOST_TWO, {title: 'incoming', nodes: [{id: 's', x: 60, y: 60}], edges: [{id: 'ss', from: 's', to: 's'}]});
  const {graph, close} = await run();
  const edge = graph.edges.find(candidate => candidate.id === 'ss');
  assert.ok(edge, 'the self edge survives');
  assert.equal(edge.from, edge.to, 'and stays a self edge');
  close();
});

test('an appended edge and a host edge may share an id without merging', async () => {
  // Edge ids collide too; the appended one takes a fresh id and both are kept.
  const run = appendPair(HOST_TWO, {title: 'incoming', nodes: [{id: 'c', x: 60, y: 60}, {id: 'd', x: 90, y: 90}], edges: [{id: 'e1', from: 'c', to: 'd', label: 'INC'}]});
  const {graph, close} = await run();
  assert.equal(graph.edges.length, 2, 'both edges are kept');
  assert.deepEqual(graph.edges.map(edge => edge.label || '').sort(), ['', 'INC'], 'and they stay distinct');
  close();
});

test('append survives nodes/edges that are not arrays', async () => {
  // `data` is untrusted. A document with `"edges": {}` is malformed but its nodes
  // are fine, and the whole append used to abort with "edges is not iterable" —
  // the user got a Paste failed toast and exactly nothing imported. Defaults are
  // materialised before sanitising, so the shape has to be normalised first.
  const run = appendPair(HOST_TWO, {title: 'incoming', nodes: [{id: 'kept', label: 'KEPT', x: 10, y: 10}], edges: {}});
  const {graph, close} = await run();
  assert.ok(graph.nodes.some(node => node.label === 'KEPT'), 'the well-formed nodes are still appended');
  assert.equal(graph.nodes.length, 3, 'host node, second host node and the appended node');
  close();
});

test('append gives appended nodes consecutive places at the end of the order', async () => {
  // `order` is a display sequence — the matrix view shows it as a badge and the
  // move buttons reorder by it — so it has to stay 0..N-1. Appending used to
  // compute it from a count re-read inside the loop, leaking the incoming
  // document's own offsets: a 3-node host took 3 and 4 as 6 and 5.
  const run = appendPair(HOST_TWO, {title: 'incoming', nodes: [{id: 'x', x: 10, y: 10}, {id: 'y', x: 20, y: 20}]});
  const {graph, close} = await run();
  assert.deepEqual(graph.nodes.map(node => node.order), [0, 1, 2, 3], 'contiguous and after the host');
  close();
});

test('append into an empty graph numbers the nodes instead of giving them all zero', async () => {
  const run = appendPair({title: 'empty', nodes: [], edges: []}, {title: 'incoming', nodes: [{id: 'p', x: 10, y: 10}, {id: 'q', x: 20, y: 20}], edges: []});
  const {graph, close} = await run();
  assert.deepEqual(graph.nodes.map(node => node.order), [0, 1], 'each node gets its own place');
  close();
});

test('append materialises a default type, which the element cannot re-derive', async () => {
  // nodeVisual/edgeVisual resolve an element's style through the *default's* type
  // style (d.type -> nodeTypeStyles), so an element with no type of its own is
  // fine as long as its document keeps that default. Append deliberately keeps the
  // host's settings, so the incoming default is discarded — whatever the element
  // needed from it has to be copied on first, or the type (and its style) is gone.
  const run = appendPair(HOST_TWO, {
    title: 'incoming',
    nodes: [{id: 'inherits', label: 'INHERITS', x: 10, y: 10}, {id: 'explicit', label: 'EXPLICIT', x: 20, y: 20, type: 'own'}],
    edges: [],
    settings: {nodeDefaults: {type: 'database'}},
  });
  const {graph, close} = await run();
  assert.equal(graph.nodes.find(node => node.label === 'INHERITS').type, 'database', 'the default type is materialised');
  assert.equal(graph.nodes.find(node => node.label === 'EXPLICIT').type, 'own', 'an explicit type is not overwritten');
  assert.equal(graph.nodes.find(node => node.label === 'H1').type, '', 'and the host is untouched');
  close();
});

test('every node/edge default an element can inherit survives an append', async () => {
  // The materialise lists were the one place that had to be edited by hand when a
  // new inherited property was added, and they had already fallen behind (`type`).
  // Rather than assert the list, drive it from the defaults the app itself keeps:
  // set every key to a distinctive valid value in the incoming document, append an
  // element that sets none of them, and require each one to arrive.
  const PROBE = {
    node: {shape: 'square', color: '#ff0000', width: 66, height: 77, strokeColor: '#00ff00',
      strokeSize: 3, strokeStyle: 'dashed', labelColor: '#0000ff', labelSize: 21,
      labelPosition: 'top', labelFont: 'Courier', type: 'probe-type'},
    edge: {color: '#ff0000', strokeSize: 3, strokeStyle: 'dashed', arrowSize: 9,
      labelColor: '#0000ff', labelSize: 21, labelFont: 'Courier', type: 'probe-type'},
  };
  const run = appendPair(HOST_TWO, {
    title: 'incoming',
    nodes: [{id: 'n-empty', label: 'NODE', x: 10, y: 10}],
    edges: [],
    settings: {nodeDefaults: PROBE.node},
  });
  const {graph, close} = await run();
  const node = graph.nodes.find(candidate => candidate.label === 'NODE');
  const missing = Object.keys(PROBE.node).filter(key => {
    const want = PROBE.node[key], got = node[key];
    return want === '' ? got !== '' : String(got) !== String(want);
  });
  assert.deepEqual(missing, [], 'node defaults that did not survive the append');
  close();

  // Edges need a real edge in the incoming document.
  const runEdge = appendPair(HOST_TWO, {
    title: 'incoming',
    nodes: [{id: 'e-from', x: 10, y: 10}, {id: 'e-to', x: 40, y: 40}],
    edges: [{id: 'edge-empty', from: 'e-from', to: 'e-to'}],
    settings: {edgeDefaults: PROBE.edge},
  });
  const {graph: g2, close: close2} = await runEdge();
  const edge = g2.edges.find(candidate => candidate.id === 'edge-empty');
  const missingEdge = Object.keys(PROBE.edge).filter(key => {
    const want = PROBE.edge[key], got = edge[key];
    return want === '' ? got !== '' : String(got) !== String(want);
  });
  assert.deepEqual(missingEdge, [], 'edge defaults that did not survive the append');
  close2();
});

test('a payload with no nodes or edges does not replace the graph', async () => {
  // Paste has no "replace?" confirmation and resets the undo history, so an empty
  // payload used to destroy the graph outright and report success into the
  // bargain. A JSON array, a bare value or `{}` is not a graph document.
  const host = {title: 'work', nodes: [{id: 'n1', label: 'A'}, {id: 'n2', label: 'B'}], edges: [{id: 'e1', from: 'n1', to: 'n2'}]};
  for (const payload of ['[]', '{}', 'null', '"text"', '42', '{"nodes":[],"edges":[]}']) {
    const {dom, errors} = createEditorDom(host);
    const {document} = dom.window;
    Object.defineProperty(dom.window.navigator, 'clipboard', {configurable: true, value: {writeText: async () => {}, readText: async () => payload}});
    document.querySelector('#btnPasteJson').click();
    await settle(dom.window, 80);
    const graph = exportedGraph(document);
    assert.equal(graph.nodes.length, 2, `the graph survives ${payload}`);
    assert.equal(graph.edges.length, 1, `and keeps its edge after ${payload}`);
    assert.deepEqual(errors.map(error => error.message), []);
    dom.window.close();
  }
});

test('a real document still replaces the graph', async () => {
  // The guard must not block the normal case.
  const {dom, errors} = createEditorDom({title: 'old', nodes: [{id: 'a', label: 'OLD'}], edges: []});
  const {document} = dom.window;
  Object.defineProperty(dom.window.navigator, 'clipboard', {configurable: true, value: {writeText: async () => {}, readText: async () => '{"nodes":[{"id":"z","label":"NEW"}],"edges":[]}'}});
  document.querySelector('#btnPasteJson').click();
  await settle(dom.window, 80);
  const graph = exportedGraph(document);
  assert.deepEqual(graph.nodes.map(node => node.label), ['NEW'], 'replaced as asked');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('the empty-payload guard does not block formats that legitimately bring little', async () => {
  // The guard keys on "no nodes and no edges", not on size: a single node with no
  // edges is still a graph, and DOT/GraphML must never be caught by it.
  const cases = [
    ['#btnPasteDot', 'digraph{a;}', 1],
    ['#btnPasteGraphml', '<graphml><graph edgedefault="directed"><node id="solo"/></graph></graphml>', 1],
  ];
  for (const [button, text, want] of cases) {
    const {dom, errors} = createEditorDom();
    const {document} = dom.window;
    Object.defineProperty(dom.window.navigator, 'clipboard', {configurable: true, value: {writeText: async () => {}, readText: async () => text}});
    document.querySelector(button).click();
    await settle(dom.window, 80);
    const graph = exportedGraph(document);
    assert.equal(graph.nodes.length, want, `${button} still imports`);
    assert.deepEqual(errors.map(error => error.message), []);
    dom.window.close();
  }
});

test('an over-large document says what the ceiling dropped', async () => {
  // The ceilings are a deliberate guard against a hostile payload, but cutting
  // 500 nodes off the tail and reporting "JSON imported" leaves the user with a
  // graph that silently is not their file. Both modes must say so.
  const big = {
    title: 'big',
    nodes: Array.from({length: 3005}, (_, i) => ({id: 'n' + i, label: 'L' + i})),
    edges: [],
  };
  for (const append of [false, true]) {
    const {dom, errors} = createEditorDom();
    const {document} = dom.window;
    Object.defineProperty(dom.window.navigator, 'clipboard', {configurable: true, value: {writeText: async () => {}, readText: async () => JSON.stringify(big)}});
    document.querySelector('#optImportAppend').checked = append;
    document.querySelector('#btnPasteJson').click();
    await settle(dom.window, 300);
    const toast = [...document.querySelectorAll('.toast')].map(el => el.textContent).join(' ');
    assert.match(toast, /5 nodes .* dropped/, `truncation is reported (append=${append})`);
    assert.equal(exportedGraph(document).nodes.length, 3000, 'and the ceiling still holds');
    assert.deepEqual(errors.map(error => error.message), []);
    dom.window.close();
  }
});

test('a document inside the ceiling imports with no truncation notice', async () => {
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  const small = {title: 's', nodes: [{id: 'a', label: 'A'}, {id: 'b', label: 'B'}], edges: [{id: 'e', from: 'a', to: 'b'}]};
  Object.defineProperty(dom.window.navigator, 'clipboard', {configurable: true, value: {writeText: async () => {}, readText: async () => JSON.stringify(small)}});
  document.querySelector('#btnPasteJson').click();
  await settle(dom.window, 120);
  const toast = [...document.querySelectorAll('.toast')].map(el => el.textContent).join(' ');
  assert.doesNotMatch(toast, /dropped/, 'no truncation notice for a normal import');
  assert.match(toast, /imported/i);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a DOT export carries every arrow size back exactly', async () => {
  // Graphviz's `arrowsize` is a multiplier, so writing it is lossy in both
  // directions: 20 -> 1.6667 -> 20.0004, and a multiplier below 5 cannot be told
  // apart from a legacy absolute size. Our own export therefore also carries the
  // exact absolute value, which our reader prefers; other tools still get the
  // standard attribute.
  for (const size of [4, 5, 20, 37.5, 40]) {
    const {dom, errors} = createEditorDom();
    const {document} = dom.window;
    const paste = async (text, button) => {
      Object.defineProperty(dom.window.navigator, 'clipboard', {configurable: true, value: {writeText: async () => {}, readText: async () => text}});
      document.querySelector(button).click();
      await settle(dom.window, 90);
    };
    await paste(JSON.stringify({nodes: [{id: 'a', x: 0, y: 0}, {id: 'b', x: 50, y: 0}], edges: [{id: 'e', from: 'a', to: 'b', arrowSize: size}]}), '#btnPasteJson');
    document.querySelector('#btnExportDot').click();
    await settle(dom.window, 60);
    const dot = document.querySelector('.export-modal textarea').value;
    document.querySelector('#expCloseBtn').click();
    assert.match(dot, /arrowsize="/, 'the standard multiplier is still written for other tools');
    await paste(dot, '#btnPasteDot');
    assert.equal(exportedGraph(document).edges[0].arrowSize, size, `size ${size} survives the round trip`);
    assert.deepEqual(errors.map(error => error.message), []);
    dom.window.close();
  }
});

test('a third-party DOT arrow multiplier still converts through the default', async () => {
  // Files that only have the Graphviz attribute must keep working: the value is a
  // multiplier of the 12px default, except where it is too large to be one.
  const cases = [['0.5', 6], ['2', 24], ['12', 12], ['', 12]];
  for (const [attr, want] of cases) {
    const {dom} = createEditorDom();
    const {document} = dom.window;
    const dot = attr === '' ? 'digraph{a->b}' : `digraph{a->b[arrowsize="${attr}"]}`;
    Object.defineProperty(dom.window.navigator, 'clipboard', {configurable: true, value: {writeText: async () => {}, readText: async () => dot}});
    document.querySelector('#btnPasteDot').click();
    await settle(dom.window, 90);
    const size = exportedGraph(document).edges[0].arrowSize;
    assert.ok(size === want || size === undefined, `arrowsize ${attr || '(absent)'} -> ${size}, wanted ${want}`);
    dom.window.close();
  }
});

test('DOT keeps label styling, node label placement and edge type', async () => {
  // The exporter wrote shape/colour/size but never the label's own styling, so a
  // DOT round trip silently reset a label's colour, size, font and position to the
  // document defaults, and dropped an edge's type. The attributes are Graphviz's
  // own spellings, and the reader accepts them from other tools too.
  const src = {
    nodes: [
      {id: 'n1', label: 'A', x: 12, y: -67, labelColor: '#0000ff', labelSize: 21, labelPosition: 'top', labelFont: 'Courier'},
      {id: 'n2', label: 'B', x: 100, y: 200},
    ],
    edges: [{id: 'e1', from: 'n1', to: 'n2', label: 'L', type: 'et', labelColor: '#0000ff', labelSize: 21}],
  };
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  const paste = async (text, button) => {
    Object.defineProperty(dom.window.navigator, 'clipboard', {configurable: true, value: {writeText: async () => {}, readText: async () => text}});
    document.querySelector(button).click();
    await settle(dom.window, 90);
  };
  await paste(JSON.stringify(src), '#btnPasteJson');
  document.querySelector('#btnExportDot').click();
  await settle(dom.window, 60);
  const dot = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  await paste(dot, '#btnPasteDot');
  const graph = exportedGraph(document);
  const node = graph.nodes.find(candidate => candidate.label === 'A');
  assert.equal(node.labelColor, '#0000ff', 'node label colour');
  assert.equal(node.labelSize, 21, 'node label size');
  assert.equal(node.labelFont, 'Courier', 'node label font');
  assert.equal(node.labelPosition, 'top', 'node label position');
  assert.equal(graph.edges[0].type, 'et', 'edge type');
  assert.equal(graph.edges[0].labelColor, '#0000ff', 'edge label colour');
  assert.equal(graph.edges[0].labelSize, 21, 'edge label size');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a third-party DOT using Graphviz label attributes is read', async () => {
  const {dom, errors} = createEditorDom();
  const {document} = dom.window;
  const dot = 'digraph{a[label="A",fontcolor="#123456",fontsize=18,fontname="Arial",labelloc="b"];b;a->b[type="flow",fontcolor="#654321",fontsize=14]}';
  Object.defineProperty(dom.window.navigator, 'clipboard', {configurable: true, value: {writeText: async () => {}, readText: async () => dot}});
  document.querySelector('#btnPasteDot').click();
  await settle(dom.window, 90);
  const graph = exportedGraph(document);
  const node = graph.nodes.find(candidate => candidate.label === 'A');
  assert.equal(node.labelColor, '#123456');
  assert.equal(node.labelSize, 18);
  assert.equal(node.labelFont, 'Arial');
  assert.equal(node.labelPosition, 'bottom');
  assert.equal(graph.edges[0].type, 'flow');
  assert.equal(graph.edges[0].labelColor, '#654321');
  assert.equal(graph.edges[0].labelSize, 14);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
