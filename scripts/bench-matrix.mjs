// Benchmark: measures adjacency-matrix and edge-list rendering performance
// at various graph sizes using JSDOM (same engine as the test suite).
//
// Usage: node scripts/bench-matrix.mjs
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createWebLocks } from '../tests/helpers/web-locks.mjs';

const html = await readFile('index.html', 'utf8');

function createEditorDom(savedGraph = null) {
  const errors = [];
  const source = savedGraph
    ? html.replace('<script>', `<script>localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(savedGraph))});</script><script>`)
    : html;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(source, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://offline.test/', virtualConsole,
    beforeParse(window) {
      Object.defineProperty(window.navigator, 'locks', { configurable:true, value:createWebLocks() });
      window.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => null;
      window.URL.createObjectURL = () => 'blob:offline-test';
      window.URL.revokeObjectURL = () => {};
      Object.defineProperty(window.navigator, 'clipboard', { configurable:true, value:{ writeText:async()=>{}, readText:async()=>'' } });
    },
  });
  return { dom, errors };
}

function nextFrame(window) {
  return new Promise(r => window.requestAnimationFrame(() => r()));
}
function settle(window, ms = 90) {
  return new Promise(r => setTimeout(r, ms));
}

// Generate graph: N nodes, edgesPerNode edges per node (dense or sparse)
function makeGraph(n, edgesPerNode) {
  const nodes = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ id: `n${i}`, label: `Node ${i}`, x: (i % 20) * 60, y: Math.floor(i / 20) * 60, order: i });
  }
  const edges = [];
  let eid = 0;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < edgesPerNode && i + 1 + k < n; k++) {
      const j = (i + 1 + k) % n;
      if (i === j) continue;
      edges.push({ id: `e${eid++}`, from: `n${i}`, to: `n${j}`, weight: String((eid % 5) + 1), label: '', directed: true, type: '' });
    }
  }
  return { nodes, edges };
}

function bench(label, fn, iters = 5) {
  // warmup
  fn();
  const times = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const min = times[0];
  const max = times[times.length - 1];
  console.log(`  ${label.padEnd(42)} median=${median.toFixed(1).padStart(8)}ms  min=${min.toFixed(1).padStart(8)}ms  max=${max.toFixed(1).padStart(8)}ms`);
  return median;
}

console.log('\n=== Adjacency Matrix & Edge List Benchmark ===\n');

const configs = [
  { n: 50, dense: 5, label: '50 nodes, ~250 edges (medium)' },
  { n: 100, dense: 3, label: '100 nodes, ~300 edges (sparse)' },
  { n: 100, dense: 10, label: '100 nodes, ~1000 edges (dense)' },
  { n: 120, dense: 5, label: '120 nodes, ~600 edges (large)' },
];

for (const cfg of configs) {
  const graph = makeGraph(cfg.n, cfg.dense);
  const { dom } = createEditorDom({
    ...graph,
    customAttributes: [],
    settings: { matrixLimit: 200 }, // raise limit so matrix renders for 100+ nodes
    graphCustom: {},
  });
  const { window } = dom;
  const { document } = window;
  await nextFrame(window);
  await settle(window, 100);

  // Show matrix + edge list panels
  const main = document.querySelector('.main');
  main.classList.add('v-matrix', 'v-edges');
  await settle(window, 100);

  console.log(`\n--- ${cfg.label} ---`);
  console.log(`    nodes=${graph.nodes.length}  edges=${graph.edges.length}  matrix cells=${cfg.n * cfg.n}`);

  const matrixHost = document.getElementById('matrixHost');
  const edgeHost = document.getElementById('edgeListHost');

  // Count DOM elements
  const matrixEls = matrixHost.querySelectorAll('*').length;
  const matrixInputs = matrixHost.querySelectorAll('input').length;
  const matrixTds = matrixHost.querySelectorAll('td').length;
  const matrixThs = matrixHost.querySelectorAll('th').length;
  const edgeEls = edgeHost.querySelectorAll('*').length;
  console.log(`    DOM matrix: ${matrixEls} elements (${matrixInputs} inputs, ${matrixTds} td, ${matrixThs} th)`);
  console.log(`    DOM edge list: ${edgeEls} elements`);

  // Measure full render by toggling view away and back (triggers renderMatrixAndList).
  // This actually rebuilds the matrix HTML from state and sets innerHTML.
  bench('Full render (toggle view)', () => {
    main.classList.remove('v-matrix', 'v-edges');
    main.classList.add('v-matrix', 'v-edges');
    // Force the render cycle by toggling a setting that triggers queueRender(true)
    const s = window.state.settings;
    s.matrixLimit = (s.matrixLimit || 200) + 0; // no-op value change
    // Dispatch a custom event the app listens for — or just wait for rAF
  }, 3);

  // Measure innerHTML re-parse (DOM parsing cost only, no HTML generation)
  const matrixHtml = matrixHost.innerHTML;
  console.log(`    Matrix HTML size: ${(matrixHtml.length / 1024).toFixed(0)} KB`);
  bench('innerHTML re-parse (matrix)', () => {
    matrixHost.innerHTML = matrixHtml;
  });

  // Measure innerHTML re-parse for edge list
  const edgeHtml = edgeHost.innerHTML;
  console.log(`    Edge list HTML size: ${(edgeHtml.length / 1024).toFixed(0)} KB`);
  bench('innerHTML re-parse (edge list)', () => {
    edgeHost.innerHTML = edgeHtml;
  });

  // Measure querySelectorAll costs (updated selectors)
  bench('querySelectorAll [data-c] (cells)', () => {
    matrixHost.querySelectorAll('[data-c]');
  });
  bench('querySelectorAll input (lockAll)', () => {
    matrixHost.querySelectorAll('input');
  });
  bench('querySelectorAll [data-node-label]', () => {
    matrixHost.querySelectorAll('[data-node-label]');
  });

  // Measure classList.toggle on all cells (simulates updateMatrixSelectionDom)
  bench('classList.toggle on all cells', () => {
    const cells = matrixHost.querySelectorAll('[data-c]');
    for (const cell of cells) {
      cell.classList.toggle('matrix-selected', false);
    }
  });

  dom.window.close();
}

console.log('\n=== Done ===\n');
