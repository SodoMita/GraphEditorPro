// Real-browser regressions for the adjacency-matrix cell editor. These need
// Chromium: the symptoms are layout and focus behaviour (table reflow while a
// cell is edited, double-click never reaching the editor, translucent frozen
// headers), none of which jsdom implements.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

const GRAPH = {
  title: 'matrix-cell-edit',
  mode: 'select',
  nextNode: 7, nextEdge: 5,
  nodes: [
    { id: 'n1', label: 'A', x: -260, y: -120, order: 0 },
    { id: 'n2', label: 'B', x: 260, y: -120, order: 1 },
    { id: 'n3', label: 'C', x: -260, y: 160, order: 2 },
    { id: 'n4', label: 'D', x: 260, y: 160, order: 3 },
    { id: 'n5', label: 'E', x: 0, y: 0, order: 4 },
    { id: 'n6', label: 'F', x: 0, y: 300, order: 5 },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', directed: true, weight: '3', label: '', type: '' },
    { id: 'e2', from: 'n2', to: 'n3', directed: true, weight: '7', label: '', type: '' },
    { id: 'e3', from: 'n3', to: 'n4', directed: false, weight: '1', label: '', type: '' },
    { id: 'e4', from: 'n5', to: 'n6', directed: true, weight: '9', label: '', type: '' },
  ],
  customAttributes: [],
  graphCustom: {},
  settings: {},
};

async function openMatrix(t) {
  // Use installed Chrome on developer machines and CI, or the existing
  // scripts/browser-setup.sh Chromium rig in the offline Linux sandbox.
  const dir = process.env.BROWSER_DIR;
  const browser = await chromium.launch(dir ? {
    executablePath: join(dir, 'chromium'),
    env: { ...process.env, LD_LIBRARY_PATH: join(dir, 'lib'), FONTCONFIG_FILE: join(dir, 'fonts.conf') },
  } : { channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ offline: true, viewport: { width: 1400, height: 1000 } });
  await page.goto(new URL('../../index.html', import.meta.url).href);
  await page.evaluate(g => {
    const input = document.querySelector('#fileImport');
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(g)], 'graph.json', { type: 'application/json' }));
    input.dataset.format = 'json';
    Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, GRAPH);
  // Matrix-only view: the grid fills the screen, as when a user edits cells.
  await page.click('[data-view-btn="graph"]');
  await page.click('[data-view-btn="edges"]');
  await page.waitForSelector('#matrixHost table');
  return page;
}

const rect = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) };
}, sel);

const centre = (page, sel) => page.evaluate(s => {
  const b = document.querySelector(s).getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}, sel);

const sameBox = (a, b) => a && b && Math.abs(a.x - b.x) < 0.6 && Math.abs(a.y - b.y) < 0.6 && Math.abs(a.w - b.w) < 0.6;

test('the frozen matrix frame is fully opaque', async t => {
  const page = await openMatrix(t);
  const bg = await page.evaluate(() => {
    const g = sel => getComputedStyle(document.querySelector(sel)).backgroundColor;
    return [g('#matrixHost th.matrix-corner'), g('#matrixHost thead th:nth-child(2)'), g('#matrixHost tbody th.row-head')];
  });
  for (const color of bg) {
    assert.match(color, /^rgb\(/, `frozen header background must be opaque, got ${color}`);
  }
});

test('double-click edits a cell without moving the grid', async t => {
  const page = await openMatrix(t);
  const SEL = 'tr[data-r="n2"] td[data-c="n3"]';
  const before = {
    table: await rect(page, '#matrixHost table'),
    cell: await rect(page, SEL),
    corner: await rect(page, '#matrixHost th.matrix-corner'),
    row: await rect(page, 'tr[data-r="n2"] th.row-head'),
  };
  const at = await centre(page, SEL);
  await page.mouse.dblclick(at.x, at.y);
  const editor = await page.evaluate(s => {
    const td = document.querySelector(s);
    const input = td.querySelector('input.matrix-input');
    if (!input) return null;
    const tb = td.getBoundingClientRect(), ib = input.getBoundingClientRect();
    return {
      value: input.value,
      readOnly: input.readOnly,
      focused: document.activeElement === input,
      inside: tb.left <= ib.left + 0.5 && ib.right <= tb.right + 0.5 && tb.top <= ib.top + 0.5 && ib.bottom <= tb.bottom + 0.5,
    };
  }, SEL);
  assert.ok(editor, 'the double-click opens the cell editor');
  assert.equal(editor.value, '7', 'the editor is pre-filled with the cell weight');
  assert.equal(editor.readOnly, false, 'the editor accepts keys');
  assert.equal(editor.focused, true, 'the editor owns the focus');
  assert.equal(editor.inside, true, 'the editor stays inside its own cell');

  const after = {
    table: await rect(page, '#matrixHost table'),
    cell: await rect(page, SEL),
    corner: await rect(page, '#matrixHost th.matrix-corner'),
    row: await rect(page, 'tr[data-r="n2"] th.row-head'),
  };
  assert.ok(sameBox(before.table, after.table), 'opening the editor must not reflow the table');
  assert.ok(sameBox(before.cell, after.cell), 'the edited cell keeps its place');
  assert.ok(sameBox(before.corner, after.corner), 'the frozen corner keeps its place');
  assert.ok(sameBox(before.row, after.row), 'the frozen row head keeps its place');

  // Typing and clicking another cell commits the edit and demotes the input.
  await page.keyboard.type('12');
  const away = await centre(page, 'tr[data-r="n4"] td[data-c="n5"]');
  await page.mouse.click(away.x, away.y);
  await page.waitForFunction(() => !document.querySelector('#matrixHost td.mc input'));
  const committed = await page.evaluate(() => document.querySelector('tr[data-r="n2"] td[data-c="n3"]').textContent);
  assert.equal(committed, '712', 'the typed weight commits on click-away');
});

test('a label commit closes the edit session so the next click selects', async t => {
  const page = await openMatrix(t);
  const LABEL = 'tr[data-r="n1"] th.row-head input[data-node-label]';
  const at = await centre(page, LABEL);
  await page.mouse.dblclick(at.x, at.y);
  const editing = await page.evaluate(s => {
    const input = document.querySelector(s);
    return { readOnly: input.readOnly, focused: document.activeElement === input };
  }, LABEL);
  assert.equal(editing.readOnly, false, 'the double-click unlocks the label');
  assert.equal(editing.focused, true, 'the unlocked label owns the focus');

  await page.keyboard.press('Control+A');
  await page.keyboard.type('Alpha');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('tr[data-r="n1"] th.row-head input[data-node-label]').value === 'Alpha');

  // Select another node ON THE CANVAS while nothing is being edited — a
  // canvas press never touches the matrix edit session, which is exactly
  // why a stale armed state used to survive it.
  await page.click('[data-view-btn="graph"]');
  await page.waitForSelector('#canvasWrap g.node[data-id="n2"]');
  const nb = await page.evaluate(() => {
    const b = document.querySelector('#canvasWrap g.node[data-id="n2"]').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(nb.x, nb.y);
  await page.waitForFunction(() => [...document.querySelectorAll('#matrixHost input[data-node-label].matrix-selected')].some(i => i.dataset.nodeLabel === 'n2'));

  // …then ONE press on the edited label must select that node again instead
  // of reopening the editor with the other selection still in force.
  const a = await centre(page, LABEL);
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(150);
  const state = await page.evaluate(s => {
    const input = document.querySelector(s);
    const selected = [...document.querySelectorAll('#matrixHost input[data-node-label].matrix-selected')].map(i => i.dataset.nodeLabel);
    return { readOnly: input.readOnly, focused: document.activeElement === input, selected };
  }, LABEL);
  assert.equal(state.readOnly, true, 'one press after a label commit does not reopen the editor');
  assert.equal(state.focused, false, 'the label is not focused after a selecting press');
  assert.ok(state.selected.includes('n1'), 'the press selected the labelled node');
  assert.ok(!state.selected.includes('n2'), 'the stale selection was replaced');
});
