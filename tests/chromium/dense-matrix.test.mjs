// Real-browser regressions for the dense-graph fixes. Two symptoms the user
// reported on a ~1000-cell graph (32 nodes = 992 cells) needed Chromium to
// reproduce, because both are layout/hit-testing behaviour jsdom does not
// implement:
//
//  1. The edge-list weight <input> carries the class `edge-weight`, which a
//     CSS rule for the CANVAS weight label (`text.edge-weight`) also matched.
//     That rule set `pointer-events:none`, so the list cell could not be
//     clicked or focused — the weight was uneditable from the list. The rule
//     is now scoped to the SVG <text>; this test pins the input as clickable.
//
//  2. `.table-scroll` (the matrix window) was capped at
//     `max-height:calc(26vh - 58px)` on desktop, leaving a ~95px peephole on a
//     short viewport so the bottom rows were effectively unreachable. The cap
//     is gone — the window now fills its pane (bounded by the grid row and the
//     pane's `overflow:hidden`) and scrolls to the last row.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

const SMALL = {
  title: 'dense-matrix-small', mode: 'select', nextNode: 4, nextEdge: 3,
  nodes: [
    { id: 'n1', label: 'A', x: -200, y: 0, order: 0 },
    { id: 'n2', label: 'B', x: 200, y: 0, order: 1 },
    { id: 'n3', label: 'C', x: 0, y: 200, order: 2 },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', directed: true, weight: '3', label: '', type: '' },
    { id: 'e2', from: 'n2', to: 'n3', directed: true, weight: '5', label: '', type: '' },
  ],
  customAttributes: [], graphCustom: {}, settings: {},
};

// A complete graph on n nodes: n*(n-1) directed edges. n=32 -> 992 cells, the
// "~1000 cells" dense case from the report.
function completeGraph(n) {
  const nodes = [], edges = [];
  for (let i = 0; i < n; i++) nodes.push({ id: 'n' + (i + 1), label: 'N' + (i + 1), x: (i % 30) * 90 - 1300, y: Math.floor(i / 30) * 90 - 600, order: i });
  let k = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) edges.push({ id: 'e' + (++k), from: nodes[i].id, to: nodes[j].id, directed: true, weight: '1', label: '', type: '' });
  return { title: 'dense-' + n, mode: 'select', nextNode: n + 1, nextEdge: k + 1, nodes, edges, customAttributes: [], graphCustom: {}, settings: {} };
}

function launcher(t) {
  const dir = process.env.BROWSER_DIR;
  const browser = chromium.launch(dir ? {
    executablePath: join(dir, 'chromium'),
    env: { ...process.env, LD_LIBRARY_PATH: join(dir, 'lib'), FONTCONFIG_FILE: join(dir, 'fonts.conf') },
  } : { channel: 'chrome' });
  return browser;
}

async function open(t, graph, { width = 1400, height = 1000, hide = [] } = {}) {
  const browser = await launcher(t);
  t.after(() => browser.close());
  const page = await browser.newPage({ offline: true, viewport: { width, height } });
  await page.goto(new URL('../../index.html', import.meta.url).href);
  await page.evaluate(g => {
    const input = document.querySelector('#fileImport');
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(g)], 'graph.json', { type: 'application/json' }));
    input.dataset.format = 'json';
    Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, graph);
  for (const view of hide) await page.click(`[data-view-btn="${view}"]`);
  return page;
}

test('the edge-list weight input is clickable and focusable', async t => {
  // Edges-only view so the list has room and the hit test is unambiguous.
  const page = await open(t, SMALL, { hide: ['graph', 'matrix'] });
  const weight = page.locator('#edgeListHost input.el-weight').first();
  await page.waitForSelector('#edgeListHost input.el-weight');

  const pe = await weight.evaluate(el => getComputedStyle(el).pointerEvents);
  assert.equal(pe, 'auto', 'the list weight input must not inherit pointer-events:none from the SVG label rule');

  await weight.click({ timeout: 5000 });
  const focused = await page.evaluate(() => {
    const a = document.activeElement;
    return !!(a && a.matches && a.matches('#edgeListHost input.el-weight'));
  });
  assert.ok(focused, 'clicking the weight input focuses it for editing');
});

test('a dense 32-node matrix fills its pane and the bottom row is reachable', async t => {
  // The DEFAULT three-pane view (canvas + matrix + edge list), which is what
  // the user sees and where the bug lived: with the canvas visible the
  // `.main:not(.v-canvas) .table-scroll{max-height:none}` escape hatch does
  // NOT apply, so the old `calc(26vh - 58px)` cap and the short 26vh pane
  // squeezed the matrix window to a ~95px peephole.
  const page = await open(t, completeGraph(32), { width: 1440, height: 940, hide: [] });
  await page.waitForSelector('#matrixHost table tbody tr', { timeout: 15000 });

  const m = await page.evaluate(() => {
    const h = document.querySelector('#matrixHost');
    const cs = getComputedStyle(h);
    h.scrollTop = h.scrollHeight; // scroll to the very bottom
    const rows = h.querySelectorAll('tbody tr');
    const last = rows[rows.length - 1];
    const lr = last.getBoundingClientRect(), hr = h.getBoundingClientRect();
    const pane = document.querySelector('.bottom-pane');
    const pr = pane.getBoundingClientRect();
    return {
      maxHeight: cs.maxHeight,
      rowCount: rows.length,
      clientH: Math.round(h.clientHeight),
      scrollH: Math.round(h.scrollHeight),
      atBottom: Math.abs(h.scrollTop + h.clientHeight - h.scrollHeight) < 2,
      lastLabel: last.querySelector('th.row-head input')?.value ?? null,
      lastVisible: lr.bottom <= hr.bottom + 1 && lr.top >= hr.top - 1,
      paneOverflowsViewport: pr.bottom > window.innerHeight + 1,
    };
  });

  assert.equal(m.rowCount, 32, 'all 32 rows rendered');
  assert.equal(m.maxHeight, 'none', 'the matrix window is no longer capped at calc(26vh - 58px)');
  assert.ok(m.clientH > 120, `the window is a usable height, got ${m.clientH}px`);
  assert.equal(m.lastLabel, 'N32', 'the last row is N32');
  assert.ok(m.atBottom, 'the container scrolls flush to the bottom');
  assert.ok(m.lastVisible, 'the bottom row is visible inside the window after scrolling');
  assert.ok(!m.paneOverflowsViewport, 'the bottom pane stays inside the viewport');
});
