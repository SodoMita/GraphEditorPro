// Regression coverage for two review findings:
//   1. Matrix CSV cannot distinguish one undirected edge from two opposing
//      directed edges. The reader must expose an explicit interpretation and
//      say which one it applied; JSON remains the fidelity format.
//   2. FileReader failures/aborts were silent, and every partial CSV import
//      used the whole-graph "Replace current graph" confirmation.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

function createEditorDom(savedGraph = null, { readerMode = 'normal' } = {}) {
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
        value: { writeText: async () => {}, readText: async () => '' },
      });
      if (readerMode !== 'normal') {
        // A real FileReader cannot be made to fail deterministically in jsdom.
        // Drive the same onload/onerror/onabort contract the app registers.
        window.FileReader = class FakeFileReader {
          constructor() { this.result = null; this.error = null; this.onload = null; this.onerror = null; this.onabort = null; }
          readAsText() {
            // A synchronous throw is a separate failure mode from an error
            // event (e.g. InvalidStateError) and must be reported too.
            if (readerMode === 'throw') throw new Error('readAsText refused');
            window.setTimeout(() => {
              if (readerMode === 'error') {
                this.error = new Error('disk went away');
                this.onerror?.({target: this});
              } else if (readerMode === 'abort') {
                this.onabort?.({target: this});
              } else {
                this.result = '';
                this.onload?.({target: this});
              }
            }, 0);
          }
        };
      }
    },
  });
  return {dom, errors};
}

const settle = (window, ms = 60) => new Promise(resolve => window.setTimeout(resolve, ms));
const toasts = document => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ');

function exportedGraph(document) {
  document.querySelector('#btnExportJson').click();
  const data = JSON.parse(document.querySelector('.export-modal textarea').value);
  document.querySelector('#expCloseBtn').click();
  return data;
}

function exportVia(document, buttonId) {
  document.querySelector(buttonId).click();
  const value = document.querySelector('.export-modal textarea').value;
  document.querySelector('#expCloseBtn').click();
  return value;
}

async function paste(document, window, buttonId, text) {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => {}, readText: async () => text },
  });
  document.querySelector(buttonId).click();
  await settle(window, 60);
}

function pickFile(window, document, text, name, forcedFormat) {
  const input = document.querySelector('#fileImport');
  const file = new window.File([text], name, {type: 'text/csv'});
  if(forcedFormat) input.dataset.format = forcedFormat;
  Object.defineProperty(input, 'files', {configurable: true, value: [file]});
  input.dispatchEvent(new window.Event('change', {bubbles: true}));
}

// The shipped sample: 7 nodes, 7 edges, exactly one undirected edge (n4--n5).
// Exporting it as Nodes CSV + Matrix CSV and re-importing used to produce 8
// edges, because the exporter writes that edge into both mirror cells.
const SAMPLE = {
  title: 'sample',
  nodes: [
    {id:'n1',label:'A',x:-220,y:-120,shape:'circle',color:'#0ea5e9',order:0},
    {id:'n2',label:'B',x:0,y:-170,shape:'circle',color:'#8b5cf6',order:1},
    {id:'n3',label:'C',x:230,y:-80,shape:'hexagon',color:'#06b6d4',order:2},
    {id:'n4',label:'D',x:-110,y:110,shape:'square',color:'#10b981',order:3},
    {id:'n5',label:'E',x:150,y:140,shape:'diamond',color:'#f59e0b',order:4},
    {id:'n6',label:'F',x:-280,y:60,shape:'triangleUp',color:'#ec4899',order:5},
    {id:'n7',label:'G',x:300,y:120,shape:'triangleDown',color:'#84cc16',order:6},
  ],
  edges: [
    {id:'e1',from:'n1',to:'n2',weight:'4',label:'',directed:true},
    {id:'e2',from:'n1',to:'n4',weight:'2',label:'',directed:true},
    {id:'e3',from:'n2',to:'n3',weight:'3',label:'',directed:true},
    {id:'e4',from:'n4',to:'n5',weight:'1',label:'',directed:false},
    {id:'e5',from:'n5',to:'n3',weight:'5',label:'',directed:true},
    {id:'e6',from:'n6',to:'n1',weight:'2',label:'',directed:true},
    {id:'e7',from:'n3',to:'n7',weight:'3',label:'',directed:true},
  ],
  settings: {},
};

function sampleCsv() {
  const {dom} = createEditorDom(SAMPLE);
  const {document} = dom.window;
  const nodes = exportVia(document, '#btnExportNodesCsv');
  const matrix = exportVia(document, '#btnExportMatrixCsv');
  dom.window.close();
  return {nodes, matrix};
}

async function roundTrip(mode) {
  const {nodes, matrix} = sampleCsv();
  const {dom, errors} = createEditorDom();
  const {document, window} = dom.window;
  await settle(window, 40);
  await paste(document, window, '#btnPasteNodesCsv', nodes);
  document.querySelector('#optMatrixImportMode').value = mode;
  await paste(document, window, '#btnPasteMatrixCsv', matrix);
  const graph = exportedGraph(document);
  const messages = toasts(document);
  dom.window.close();
  assert.deepEqual(errors.map(e => e.message), []);
  return {graph, messages};
}

test('the default "one edge per cell" reading is explicit and reports the ambiguity', async () => {
  const {graph, messages} = await roundTrip('cells');
  assert.equal(graph.nodes.length, 7);
  assert.equal(graph.edges.length, 8, 'the undirected edge occupies two cells');
  const between = graph.edges.filter(e =>
    (e.from === 'n4' && e.to === 'n5') || (e.from === 'n5' && e.to === 'n4'));
  assert.equal(between.length, 2);
  assert.ok(between.every(e => e.direction === 'directed'));
  assert.match(messages, /mirror pair/i, 'the toast warns about the ambiguous pair');
  assert.match(messages, /separate edges/i);
});

test('the mirror interpretation round-trips the sample as 7 edges with one undirected edge', async () => {
  const {graph, messages} = await roundTrip('mirror');
  assert.equal(graph.nodes.length, 7);
  assert.equal(graph.edges.length, 7, 'the symmetric pair collapses to one edge');
  const undirected = graph.edges.filter(e => e.direction === 'undirected');
  assert.equal(undirected.length, 1);
  assert.deepEqual([undirected[0].from, undirected[0].to], ['n4', 'n5']);
  assert.equal(undirected[0].weight, '1');
  assert.equal(graph.edges.filter(e => e.direction === 'directed').length, 6);
  assert.deepEqual(graph.edges.map(e => e.weight).sort(), ['1','2','2','3','3','4','5']);
  assert.match(messages, /one undirected edge/i, 'the toast names the applied interpretation');
  assert.match(messages, /JSON/i, 'and points to the fidelity format');
});

test('mirror mode only collapses symmetric cells whose weights agree', async () => {
  const saved = {
    title: 'two-way',
    nodes: [{id:'n1',label:'A',x:0,y:0,order:0},{id:'n2',label:'B',x:100,y:0,order:1},{id:'n3',label:'C',x:200,y:0,order:2}],
    edges: [], settings: {},
  };
  const {dom, errors} = createEditorDom(saved);
  const {document, window} = dom.window;
  document.querySelector('#optMatrixImportMode').value = 'mirror';
  // A↔B disagree (1 vs 9): two directed edges. B↔C agree (7): one undirected.
  await paste(document, window, '#btnPasteMatrixCsv', ',A,B,C\nA,,1,\nB,9,,7\nC,,7,\n');
  const graph = exportedGraph(document);
  assert.equal(graph.edges.length, 3);
  const pair = (a,b) => graph.edges.filter(e => (e.from === a && e.to === b) || (e.from === b && e.to === a));
  assert.equal(pair('n1','n2').length, 2);
  assert.ok(pair('n1','n2').every(e => e.direction === 'directed'));
  assert.equal(pair('n2','n3').length, 1);
  assert.equal(pair('n2','n3')[0].direction, 'undirected');
  assert.equal(pair('n2','n3')[0].weight, '7');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a self-loop has no mirror and stays a single directed edge', async () => {
  const saved = {
    title: 'loop',
    nodes: [{id:'n1',label:'A',x:0,y:0,order:0}], edges: [], settings: {},
  };
  const {dom} = createEditorDom(saved);
  const {document, window} = dom.window;
  document.querySelector('#optMatrixImportMode').value = 'mirror';
  await paste(document, window, '#btnPasteMatrixCsv', ',A\nA,5\n');
  const graph = exportedGraph(document);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].from, 'n1');
  assert.equal(graph.edges[0].to, 'n1');
  assert.equal(graph.edges[0].direction, 'directed');
  dom.window.close();
});

test('the export preview warns that Matrix CSV is lossy and names JSON', async () => {
  const {dom} = createEditorDom();
  const {document} = dom.window;
  document.querySelector('#btnExportMatrixCsv').click();
  const note = document.querySelector('#expFormatNote');
  assert.ok(note, 'the Matrix CSV preview carries a format-specific note');
  assert.match(note.textContent, /lossy/i);
  assert.match(note.textContent, /direction/i);
  assert.match(note.textContent, /JSON/);
  document.querySelector('#expCloseBtn').click();
  document.querySelector('#btnExportEdgesCsv').click();
  assert.match(document.querySelector('#expFormatNote').textContent, /replaces the current edges/i);
  document.querySelector('#expCloseBtn').click();
  document.querySelector('#btnExportNodesCsv').click();
  assert.match(document.querySelector('#expFormatNote').textContent, /removes the current edges/i);
  document.querySelector('#expCloseBtn').click();
  dom.window.close();
});

// === Partial-format confirmations ===
const PARTIAL_HOST = {
  title: 'host',
  nodes: [{id:'n1',label:'A',x:0,y:0,order:0},{id:'n2',label:'B',x:100,y:0,order:1}],
  edges: [{id:'e1',from:'n1',to:'n2',weight:'3',label:'original'}],
  settings: {},
};

test('an Edges CSV file import confirms the edges only, keeps the nodes, and says so', async () => {
  const {dom, errors} = createEditorDom(PARTIAL_HOST);
  const {document, window} = dom.window;
  pickFile(window, document, 'id,source_id,target_id,weight,label\ne2,n1,n2,9,imported', 'edges.csv', 'edges-csv');
  await settle(window, 120);
  const dialog = document.querySelector('.app-dialog');
  assert.ok(dialog, 'a replace confirmation is shown');
  const message = dialog.querySelector('.app-dialog-message').textContent;
  assert.match(message, /current edges/i);
  assert.match(message, /nodes.*kept/i);
  assert.doesNotMatch(message, /Replace current graph/i, 'no whole-graph wording for a partial import');
  dialog.querySelector('[data-dialog-ok]').click();
  await settle(window, 120);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 2, 'nodes survive the edge import');
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].label, 'imported');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a Nodes CSV file import warns that the old edges will be removed', async () => {
  const {dom} = createEditorDom(PARTIAL_HOST);
  const {document, window} = dom.window;
  pickFile(window, document, 'order,id,label,x,y\n0,n1,A,0,0\n1,n2,B,100,0', 'nodes.csv', 'nodes-csv');
  await settle(window, 120);
  const dialog = document.querySelector('.app-dialog');
  assert.ok(dialog);
  assert.match(dialog.querySelector('.app-dialog-message').textContent, /current edges will be removed/i);
  dialog.querySelector('[data-dialog-ok]').click();
  await settle(window, 120);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 0, 'old edges are gone with the replaced nodes');
  dom.window.close();
});

test('a Matrix CSV file import names the interpretation and the JSON alternative', async () => {
  const {dom} = createEditorDom(PARTIAL_HOST);
  const {document, window} = dom.window;
  document.querySelector('#optMatrixImportMode').value = 'mirror';
  pickFile(window, document, ',A,B\nA,,7\nB,7,\n', 'matrix.csv', 'matrix-csv');
  await settle(window, 120);
  const dialog = document.querySelector('.app-dialog');
  assert.ok(dialog);
  const message = dialog.querySelector('.app-dialog-message').textContent;
  assert.match(message, /Matrix CSV/i);
  assert.match(message, /Mirror cells are one undirected edge/i);
  assert.match(message, /use JSON/i);
  assert.doesNotMatch(message, /Replace current graph/i);
  dialog.querySelector('[data-dialog-ok]').click();
  await settle(window, 120);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1, 'the chosen interpretation is the one applied');
  assert.equal(graph.edges[0].direction, 'undirected');
  dom.window.close();
});

test('auto-detected CSV files also get their format-specific confirmation', async () => {
  const {dom} = createEditorDom(PARTIAL_HOST);
  const {document, window} = dom.window;
  // No forced format: the kind is resolved from the filename/header before the
  // dialog is built, not afterwards with a generic message.
  pickFile(window, document, ',A,B\nA,,7\nB,7,\n', 'graph-matrix.csv');
  await settle(window, 120);
  const dialog = document.querySelector('.app-dialog');
  assert.ok(dialog);
  const message = dialog.querySelector('.app-dialog-message').textContent;
  assert.match(message, /Matrix CSV/i);
  assert.match(message, /use JSON/i);
  dialog.querySelector('[data-dialog-cancel]').click();
  await settle(window, 40);
  assert.equal(exportedGraph(document).edges.length, 1, 'cancelling leaves the host untouched');
  dom.window.close();
});

test('a JSON file import still uses the whole-graph confirmation', async () => {
  const {dom} = createEditorDom(PARTIAL_HOST);
  const {document, window} = dom.window;
  pickFile(window, document, JSON.stringify({title:'replacement',nodes:[{id:'x',label:'X',x:0,y:0}],edges:[]}), 'graph.json', 'json');
  await settle(window, 120);
  const dialog = document.querySelector('.app-dialog');
  assert.ok(dialog);
  assert.match(dialog.querySelector('.app-dialog-message').textContent, /Replace current graph/i);
  dialog.querySelector('[data-dialog-cancel]').click();
  dom.window.close();
});

// === FileReader terminal states ===

test('a FileReader error is reported with the filename, reason and an actionable recovery', async () => {
  const {dom, errors} = createEditorDom(null, {readerMode:'error'});
  const {document, window} = dom.window;
  pickFile(window, document, 'id,source_id,target_id,weight\ne1,n1,n2,1', 'broken.csv', 'edges-csv');
  await settle(window, 80);
  const messages = toasts(document);
  assert.match(messages, /Could not read "broken.csv"/);
  assert.match(messages, /disk went away/);
  assert.match(messages, /Re-select the file/i);
  assert.match(messages, /export preview/i);
  assert.equal(document.querySelector('.app-dialog'), null, 'no import ran');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a FileReader abort is reported and tells the user to choose the file again', async () => {
  const {dom, errors} = createEditorDom(null, {readerMode:'abort'});
  const {document, window} = dom.window;
  pickFile(window, document, 'id,source_id,target_id,weight\ne1,n1,n2,1', 'cancelled.csv', 'edges-csv');
  await settle(window, 80);
  const messages = toasts(document);
  assert.match(messages, /"cancelled.csv" was aborted/i);
  assert.match(messages, /Choose the file again/i);
  assert.equal(document.querySelector('.app-dialog'), null);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a synchronous readAsText failure is reported instead of escaping the click handler', async () => {
  const {dom, errors} = createEditorDom(null, {readerMode:'throw'});
  const {document, window} = dom.window;
  pickFile(window, document, 'id,source_id,target_id,weight\ne1,n1,n2,1', 'locked.csv', 'edges-csv');
  await settle(window, 80);
  assert.match(toasts(document), /Could not read "locked.csv": readAsText refused/);
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});
