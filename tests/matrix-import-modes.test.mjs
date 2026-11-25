// CSV is the app's own dialect: an unedited export carries the complete
// document in extra rows/columns/cells, so export -> import is lossless.
// Files without that appendix (hand-written matrices, older builds) stay
// partial, and the Matrix CSV interpretation option applies to them.
// Also covers actionable FileReader failures and scope-specific confirmations.
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

// Only the visible table of an app export: everything from the first
// full-document marker onwards is the lossless appendix.
function mainTable(csv) {
  // A visible matrix row may itself be `#GEP-CSV,2`: the real appendix is the
  // marker immediately followed by the `meta` section header.
  const index = csv.search(/^#GEP-CSV,2\r?\n#GEP-CSV,meta\r?$/m);
  return index < 0 ? csv : csv.slice(0, index);
}

// The shipped sample: 7 nodes, 7 edges, exactly one undirected edge (n4--n5).
// Reading only its adjacency grid used to produce 8 edges.
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

// Everything the native JSON format carries, so a CSV round-trip can be
// compared to it field by field: tri-state direction, parallel edges, custom
// definitions + values on every scope, type styles, settings and odd labels.
const RICH = {
  title: 'rich "graph"',
  mode: 'select', selectTool: 'rect', selectCombine: 'add',
  nodes: [
    {id:'n1',label:'=1+1',x:-12.5,y:0.001,order:0,shape:'hexagon',color:'#0ea5e9',type:'server',
      width:80,height:40,strokeColor:'#111111',strokeSize:0,strokeStyle:'dashdot',
      labelColor:'#abcdef',labelSize:9,labelPosition:'bottom',labelFont:'Inter',
      custom:{priority:'high',count:7}},
    {id:'n2',label:"'=plain",x:120,y:-40,order:1,shape:'square',color:'#8b5cf6',
      custom:{priority:'',count:0}},
    {id:'n3',label:'C#',x:240,y:80,order:2,shape:'diamond',custom:{flag:true}},
  ],
  edges: [
    {id:'e1',from:'n1',to:'n2',weight:'1',label:'a,b',direction:'directed',type:'link',
      color:'#123456',strokeSize:0,strokeStyle:'dotted',arrowSize:4,labelColor:'#fedcba',labelSize:20,
      custom:{priority:'urgent'}},
    {id:'e2',from:'n1',to:'n2',weight:'2',direction:'undirected',type:'link'},
    {id:'e3',from:'n2',to:'n1',weight:'3',direction:'mutual'},
    {id:'e4',from:'n3',to:'n3',weight:'',direction:'undirected',label:''},
  ],
  customAttributes: [
    {id:'priority',scope:'all',type:'string',name:'Priority'},
    {id:'count',scope:'node',type:'int',name:'Count'},
    {id:'flag',scope:'node',type:'boolean',name:'Flag'},
  ],
  graphCustom: {priority:'graph-value'},
  settings: {
    direction:'mutual', nodeShape:'square', nodeColor:'#222222', gridSizeX:25, gridSizeY:25,
    canvasBgColor:'#010203', gridMinorAlpha:0.2, autosave:false, snap:true,
    edgeTypeStyles:{link:{color:'#445566',strokeSize:0}},
    nodeTypeStyles:{server:{shape:'hexagon'}},
    nodeCustom:{priority:'pending'}, edgeCustom:{priority:'pending-edge'},
  },
};

function baseline(document) {
  // JSON export is the app's own complete document; use it as the reference.
  return exportedGraph(document);
}

async function roundTripCsv(buttonId, pasteButtonId, saved) {
  const source = createEditorDom(saved);
  const before = baseline(source.dom.window.document);
  const csv = exportVia(source.dom.window.document, buttonId);
  source.dom.window.close();

  const {dom, errors} = createEditorDom();
  const {document, window} = dom.window;
  await settle(window, 40);
  await paste(document, window, pasteButtonId, csv);
  const after = exportedGraph(document);
  const messages = toasts(document);
  dom.window.close();
  assert.deepEqual(errors.map(e => e.message), []);
  return {before, after, csv, messages};
}

const CSV_FORMATS = [
  ['#btnExportNodesCsv', '#btnPasteNodesCsv'],
  ['#btnExportEdgesCsv', '#btnPasteEdgesCsv'],
  ['#btnExportMatrixCsv', '#btnPasteMatrixCsv'],
];

for(const [exportButton, pasteButton] of CSV_FORMATS){
  test(`${exportButton} round-trips the sample losslessly (7 edges, exact directions)`, async () => {
    const {before, after, csv} = await roundTripCsv(exportButton, pasteButton, SAMPLE);
    assert.match(csv, /^#GEP-CSV,2$/m, 'the file carries the full-document appendix');
    assert.equal(after.nodes.length, 7);
    assert.equal(after.edges.length, 7);
    assert.equal(after.edges.filter(e => e.direction === 'undirected').length, 1);
    assert.deepEqual(after, before, 'the whole document is identical to the JSON reference');
  });

  test(`${exportButton} round-trips custom attributes, settings and tri-state direction`, async () => {
    const {before, after} = await roundTripCsv(exportButton, pasteButton, RICH);
    assert.deepEqual(after, before, 'every document field survives the CSV round-trip');
    assert.equal(after.edges.find(e => e.id === 'e3').direction, 'mutual');
    assert.equal(after.nodes[0].custom.priority, 'high');
    assert.equal(after.nodes[1].custom.priority, '', 'a stated empty value stays stated');
    assert.equal(after.settings.edgeTypeStyles.link.strokeSize, 0, 'an inherited zero stays zero');
  });
}

test('each CSV export keeps its familiar table first, then adds rows/columns/cells', async () => {
  const {dom} = createEditorDom(SAMPLE);
  const {document} = dom.window;
  const nodesCsv = exportVia(document, '#btnExportNodesCsv');
  const edgesCsv = exportVia(document, '#btnExportEdgesCsv');
  const matrixCsv = exportVia(document, '#btnExportMatrixCsv');
  assert.ok(nodesCsv.replace(/^\ufeff/, '').startsWith('order,id,label,x,y,'));
  assert.ok(edgesCsv.replace(/^\ufeff/, '').startsWith('id,source_id,source_label,target_id,target_label,'));
  assert.ok(matrixCsv.replace(/^\ufeff/, '').startsWith(',A,B,C,D,E,F,G'));
  for(const csv of [nodesCsv, edgesCsv, matrixCsv]){
    for(const section of ['meta','settings','graphCustom','attributes','nodes','edges'])
      assert.match(csv, new RegExp(`^#GEP-CSV,${section}$`, 'm'), `${section} section is present`);
    assert.match(csv, /^#GEP-CSV,nodes\r?\nid,/m, 'nodes section has real columns');
  }
  dom.window.close();
});

test('marker-like labels and custom keys cannot truncate or split the appendix', async () => {
  const weird = {
    title: 'markers',
    nodes: [{id:'n1', label:'#GEP-CSV', x:0, y:0, order:0}],
    edges: [{id:'e1', from:'n1', to:'n1', weight:'2', direction:'directed'}],
    customAttributes: [{id:'#GEP-CSV', scope:'all', type:'string', name:'Marker'}],
    graphCustom: {'#GEP-CSV': 2},
    settings: {},
  };
  // The visible one-node matrix itself contains the row `#GEP-CSV,2`, and
  // the graphCustom map contains the same key/value pair inside the appendix.
  const {before, after, csv} = await roundTripCsv('#btnExportMatrixCsv', '#btnPasteMatrixCsv', weird);
  assert.ok(mainTable(csv).replace(/^\ufeff/, '').includes('#GEP-CSV,2'), 'a visible row looks like the marker');
  assert.deepEqual(after, before, 'the real appendix is still found from the end');
  // Custom values are validated as strings by the document model.
  assert.equal(after.graphCustom['#GEP-CSV'], '2');

  // Even a literal marker-shaped DATA row inside the appendix must not be
  // mistaken for a section boundary and swallow the tables that follow it.
  const tampered = csv.replace('#GEP-CSV,attributes', '#GEP-CSV,2\n#GEP-CSV,attributes');
  const host = createEditorDom(SAMPLE);
  await paste(host.dom.window.document, host.dom.window, '#btnPasteMatrixCsv', tampered);
  assert.deepEqual(exportedGraph(host.dom.window.document), before, 'known sections still parse in order');
  host.dom.window.close();
});

test('a quoted newline in a label cannot fake an appendix marker', async () => {
  const multiline = 'first\n#GEP-CSV,2\nlast';
  const weird = {
    ...SAMPLE,
    nodes: [{...SAMPLE.nodes[0], label: multiline}, ...SAMPLE.nodes.slice(1)],
  };
  const {before, after} = await roundTripCsv('#btnExportNodesCsv', '#btnPasteNodesCsv', weird);
  assert.deepEqual(after, before);
  assert.equal(after.nodes[0].label, multiline);
});

test('the appendix is required: a truncated file never wipes the document', async () => {
  const {dom, errors} = createEditorDom(SAMPLE);
  const {document, window} = dom.window;
  // A marker and a meta section, but no nodes/edges tables.
  await paste(document, window, '#btnPasteMatrixCsv', ',A\nA,\n#GEP-CSV,2\n#GEP-CSV,meta\nkey,value\n');
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 7, 'the host document survives');
  assert.equal(graph.edges.length, 7);
  assert.match(toasts(document), /incomplete/i, 'a truncated appendix is an error, not a success');
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('editing the preview text drops the appendix so the edits take effect', async () => {
  const {dom} = createEditorDom(SAMPLE);
  const {document, window} = dom.window;
  document.querySelector('#btnExportNodesCsv').click();
  const ta = document.querySelector('.export-modal textarea');
  assert.match(document.querySelector('#expFormatNote').textContent, /complete graph/i);
  ta.value = ta.value.replace('-220', '999');
  ta.dispatchEvent(new window.Event('input', {bubbles: true}));
  assert.match(document.querySelector('#expFormatNote').textContent, /ignored|partial/i,
    'the note follows the edited content');
  document.querySelector('#expImportBtn').click();
  await settle(window, 60);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes[0].x, 999, 'the edited coordinate is applied');
  assert.equal(graph.edges.length, 0, 'a plain Nodes CSV replaces edges with none');
  dom.window.close();
});

test('editing a preview with quoted newlines strips only the real appendix', async () => {
  const label = 'first\n#GEP-CSV,2\nlast';
  const {dom} = createEditorDom({...SAMPLE, nodes:[{...SAMPLE.nodes[0], label}, ...SAMPLE.nodes.slice(1)]});
  const {document, window} = dom.window;
  document.querySelector('#btnExportNodesCsv').click();
  const ta = document.querySelector('.export-modal textarea');
  ta.value = ta.value.replace('-220', '999');
  ta.dispatchEvent(new window.Event('input', {bubbles: true}));
  assert.match(document.querySelector('#expFormatNote').textContent, /ignored|partial/i);
  document.querySelector('#expImportBtn').click();
  await settle(window, 60);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes[0].x, 999, 'the visible edit is applied');
  assert.equal(graph.nodes[0].label, label, 'quoted newlines in the table survive slicing');
  assert.equal(graph.edges.length, 0, 'the stale appendix was ignored');
  dom.window.close();
});

// === Partial / foreign matrices still need an explicit interpretation ===

function sampleMatrixGrid() {
  const {dom} = createEditorDom(SAMPLE);
  const csv = mainTable(exportVia(dom.window.document, '#btnExportMatrixCsv'));
  dom.window.close();
  return csv;
}

test('a partial matrix in "one edge per cell" mode reports the ambiguity', async () => {
  const grid = sampleMatrixGrid();
  const {dom} = createEditorDom({...SAMPLE, edges: []});
  const {document, window} = dom.window;
  await paste(document, window, '#btnPasteMatrixCsv', grid);
  const graph = exportedGraph(document);
  const messages = toasts(document);
  assert.equal(graph.edges.length, 8, 'the undirected edge occupies two cells');
  const between = graph.edges.filter(e =>
    (e.from === 'n4' && e.to === 'n5') || (e.from === 'n5' && e.to === 'n4'));
  assert.equal(between.length, 2);
  assert.match(messages, /mirror pair/i);
  assert.match(messages, /separate edges/i);
  dom.window.close();
});

test('a partial matrix in mirror mode collapses the symmetric pair', async () => {
  const grid = sampleMatrixGrid();
  const {dom} = createEditorDom({...SAMPLE, edges: []});
  const {document, window} = dom.window;
  document.querySelector('#optMatrixImportMode').value = 'mirror';
  await paste(document, window, '#btnPasteMatrixCsv', grid);
  const graph = exportedGraph(document);
  const messages = toasts(document);
  assert.equal(graph.edges.length, 7);
  const undirected = graph.edges.filter(e => e.direction === 'undirected');
  assert.equal(undirected.length, 1);
  assert.equal(undirected[0].weight, '1');
  assert.match(messages, /one undirected edge/i);
  assert.match(messages, /JSON/i);
  dom.window.close();
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
  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});

test('a self-loop has no mirror and stays a single directed edge', async () => {
  const saved = { title:'loop', nodes:[{id:'n1',label:'A',x:0,y:0,order:0}], edges:[], settings:{} };
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

test('the export preview explains lossless exports and partial files', async () => {
  const {dom} = createEditorDom(SAMPLE);
  const {document, window} = dom.window;
  document.querySelector('#btnExportMatrixCsv').click();
  assert.match(document.querySelector('#expFormatNote').textContent, /complete graph/i);
  assert.match(document.querySelector('#expFormatNote').textContent, /losslessly/i);
  // Pasting a foreign matrix into the same box changes the note live.
  const ta = document.querySelector('.export-modal textarea');
  ta.value = ',A,B\nA,,1\nB,1,\n';
  ta.dispatchEvent(new window.Event('input', {bubbles: true}));
  assert.match(document.querySelector('#expFormatNote').textContent, /partial/i);
  assert.match(document.querySelector('#expFormatNote').textContent, /interpretation/i);
  // A marker-looking line INSIDE a quoted label is not an appendix.
  ta.value = 'id,label\n1,"first\n#GEP-CSV,2\nlast"\n';
  ta.dispatchEvent(new window.Event('input', {bubbles: true}));
  assert.match(document.querySelector('#expFormatNote').textContent, /partial/i);
  document.querySelector('#expCloseBtn').click();
  document.querySelector('#btnExportEdgesCsv').click();
  assert.match(document.querySelector('#expFormatNote').textContent, /complete graph/i);
  document.querySelector('#expCloseBtn').click();
  document.querySelector('#btnExportNodesCsv').click();
  assert.match(document.querySelector('#expFormatNote').textContent, /complete graph/i);
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

test('a partial Matrix CSV file import names the interpretation and the JSON alternative', async () => {
  const {dom} = createEditorDom(PARTIAL_HOST);
  const {document, window} = dom.window;
  document.querySelector('#optMatrixImportMode').value = 'mirror';
  pickFile(window, document, ',A,B\nA,,7\nB,7,\n', 'matrix.csv', 'matrix-csv');
  await settle(window, 120);
  const dialog = document.querySelector('.app-dialog');
  assert.ok(dialog);
  const message = dialog.querySelector('.app-dialog-message').textContent;
  assert.match(message, /partial Matrix CSV/i);
  assert.match(message, /Mirror cells are one undirected edge/i);
  assert.match(message, /use JSON/i);
  assert.doesNotMatch(message, /^Replace current graph/i);
  dialog.querySelector('[data-dialog-ok]').click();
  await settle(window, 120);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1, 'the chosen interpretation is the one applied');
  assert.equal(graph.edges[0].direction, 'undirected');
  dom.window.close();
});

test('auto-detected partial CSV files also get their format-specific confirmation', async () => {
  const {dom} = createEditorDom(PARTIAL_HOST);
  const {document, window} = dom.window;
  // No forced format: the kind is resolved from the filename/header before the
  // dialog is built, not afterwards with a generic message.
  pickFile(window, document, ',A,B\nA,,7\nB,7,\n', 'graph-matrix.csv');
  await settle(window, 120);
  const dialog = document.querySelector('.app-dialog');
  assert.ok(dialog);
  assert.match(dialog.querySelector('.app-dialog-message').textContent, /Matrix CSV/i);
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

test('a lossless CSV file import asks about the whole graph it carries', async () => {
  const source = createEditorDom(SAMPLE);
  const csv = exportVia(source.dom.window.document, '#btnExportEdgesCsv');
  source.dom.window.close();
  const {dom} = createEditorDom(PARTIAL_HOST);
  const {document, window} = dom.window;
  pickFile(window, document, csv, 'edges.csv', 'edges-csv');
  await settle(window, 120);
  const dialog = document.querySelector('.app-dialog');
  assert.ok(dialog);
  assert.match(dialog.querySelector('.app-dialog-message').textContent, /complete graph/i);
  dialog.querySelector('[data-dialog-ok]').click();
  await settle(window, 120);
  const graph = exportedGraph(document);
  assert.equal(graph.nodes.length, 7, 'the file carried its own nodes');
  assert.equal(graph.edges.length, 7);
  assert.equal(graph.edges.filter(e => e.direction === 'undirected').length, 1);
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
