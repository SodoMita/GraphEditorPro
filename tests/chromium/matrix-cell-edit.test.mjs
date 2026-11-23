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

async function openMatrix(t, graph = GRAPH) {
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
  }, graph);
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

test('clicks reposition the caret and drags select in an open editor', async t => {
  const page = await openMatrix(t);
  const SEL = 'tr[data-r="n2"] td[data-c="n3"]';
  const at = await centre(page, SEL);
  await page.mouse.dblclick(at.x, at.y);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('123456789');

  const box = await page.evaluate(s => {
    const b = document.querySelector(s + ' input').getBoundingClientRect();
    return { left: b.left, right: b.right, y: b.top + b.height / 2 };
  }, SEL);
  // A click at the end of the text must move the caret there (a prevented
  // pointerdown used to leave it where focus() had put it).
  await page.mouse.click(box.right - 3, box.y);
  const caret = await page.evaluate(s => {
    const i = document.querySelector(s + ' input');
    return { start: i.selectionStart, end: i.selectionEnd, focused: document.activeElement === i, ro: i.readOnly, v: i.value };
  }, SEL);
  assert.equal(caret.v, '123456789', 'the click did not commit or alter the text');
  assert.equal(caret.focused, true, 'the editor keeps the focus');
  assert.equal(caret.ro, false, 'the editor stays unlocked');
  assert.equal(caret.start, 9, 'a click at the end of the text moves the caret there');
  assert.equal(caret.end, 9, 'a plain click collapses the selection at the new caret');

  // Dragging inside the editor selects text.
  await page.mouse.move(box.left + 10, box.y);
  await page.mouse.down();
  await page.mouse.move(box.right - 4, box.y, { steps: 4 });
  await page.mouse.up();
  const drag = await page.evaluate(s => {
    const i = document.querySelector(s + ' input');
    return { start: i.selectionStart, end: i.selectionEnd };
  }, SEL);
  assert.ok(drag.end > drag.start, `dragging selects text (got ${drag.start}..${drag.end})`);

  // Enter commits through implicit submission (change while connected), and
  // the committed cell demotes back to a lightweight <td>.
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const td = document.querySelector('tr[data-r="n2"] td[data-c="n3"]');
    return !td.querySelector('input') && td.textContent === '123456789';
  }, null, { timeout: 5000 });
});

test('a fast double-click elsewhere cannot destroy the next editor (render race)', async t => {
  const page = await openMatrix(t);
  const X = 'tr[data-r="n2"] td[data-c="n3"]';
  const Y = 'tr[data-r="n5"] td[data-c="n6"]';
  const xa = await centre(page, X);
  await page.mouse.dblclick(xa.x, xa.y);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('42');

  // Committing X by double-clicking Y with a 10 ms interval: the blur fires
  // X's change (which queues a matrix rebuild ~60 ms later) while the second
  // press has just opened Y's editor. The rebuild used to replace that
  // editor and drop focus back to the page.
  const ya = await centre(page, Y);
  await page.mouse.dblclick(ya.x, ya.y, { delay: 10 });
  await page.keyboard.type('77');
  const read = s => page.evaluate(sel => {
    const i = document.querySelector(sel + ' input');
    return i ? { v: i.value, st: i.selectionStart, en: i.selectionEnd, focused: document.activeElement === i, ro: i.readOnly } : null;
  }, s);
  const pre = await read(Y);
  assert.ok(pre, 'the second editor opened');
  assert.equal(pre.ro, false, 'the second editor is unlocked');
  await page.waitForTimeout(400); // let the queued rebuild land
  const post = await read(Y);
  assert.deepEqual(post, pre, 'the pending rebuild did not destroy the open editor');
  assert.equal(post.focused, true, 'focus stayed in the editor, not the page');
  const xText = await page.evaluate(s => document.querySelector(s).textContent, X);
  assert.equal(xText, '42', 'the first edit committed');
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
  // Commit by pressing another label: blur fires `change` while the field is
  // still in the document. Wait for the COMMITTED state (re-locked and
  // re-rendered with the new label), not for the open editor's live value.
  const other = await centre(page, 'tr[data-r="n2"] th.row-head input[data-node-label]');
  await page.mouse.click(other.x, other.y);
  await page.waitForFunction(() => {
    const i = document.querySelector('tr[data-r="n1"] th.row-head input[data-node-label]');
    return i.readOnly && i.value === 'Alpha';
  }, null, { timeout: 5000 });

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

// The graph weight/selection assertions below read #edgeListHost, which is
// rendered from the graph model. The matrix cell text cannot be trusted for
// this: demoting an editor writes the field's value back into the <td>, so the
// grid can display a weight the graph never received.
const edgeWeight = (page, id) => page.evaluate(eid => {
  const i = document.querySelector(`#edgeListHost input.edge-weight[data-edge-id="${eid}"]`);
  return i ? i.value : null;
}, id);

const selectedEdges = page => page.evaluate(
  () => [...document.querySelectorAll('#edgeListHost input.edge-weight.matrix-selected')].map(i => i.dataset.edgeId),
);

test('a deferred commit does not steal the selection made by the click that closed it', async t => {
  const page = await openMatrix(t);
  const X = 'tr[data-r="n1"] td[data-c="n2"]'; // edge e1
  const Y = 'tr[data-r="n2"] td[data-c="n3"]'; // edge e2
  const xa = await centre(page, X);
  await page.mouse.dblclick(xa.x, xa.y);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('11');

  // One click on Y closes X's editor (blur → change) and selects Y. The change
  // handler defers its commit to a microtask, so the commit used to run after
  // Y was already selected and re-select X — leaving the wrong edge selected
  // for every selection-based action.
  const ya = await centre(page, Y);
  await page.mouse.click(ya.x, ya.y);
  await page.waitForFunction(
    () => document.querySelector('#edgeListHost input.edge-weight[data-edge-id="e1"]')?.value === '11',
    null, { timeout: 5000 },
  );
  await page.waitForTimeout(150); // let any stray re-selection land

  assert.equal(await edgeWeight(page, 'e1'), '11', 'the edit committed');
  assert.deepEqual(await selectedEdges(page), ['e2'], 'the clicked cell keeps the selection');
  const cells = await page.evaluate(([x, y]) => ({
    x: document.querySelector(x).className,
    y: document.querySelector(y).className,
  }), [X, Y]);
  assert.ok(cells.y.includes('matrix-selected'), 'the matrix marks the clicked cell');
  assert.ok(!cells.x.includes('matrix-selected'), 'the matrix no longer marks the edited cell');
});

test('an edit restored after a rebuild commits when blurred without typing', async t => {
  const page = await openMatrix(t);
  const X = 'tr[data-r="n2"] td[data-c="n3"]'; // edge e2
  const Y = 'tr[data-r="n5"] td[data-c="n6"]'; // edge e4 (weight 9)
  const xa = await centre(page, X);
  await page.mouse.dblclick(xa.x, xa.y);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('42');

  // Double-click Y before X's queued rebuild lands: the rebuild replaces the
  // grid, so the edit session is re-opened on the fresh DOM with its value
  // assigned PROGRAMMATICALLY. That clears the field's dirty flag — Chromium
  // fires no `change` when it is blurred, so the typed weight used to be
  // dropped (the grid showed 99, the graph kept 9 until a reload exposed it).
  const ya = await centre(page, Y);
  await page.mouse.dblclick(ya.x, ya.y, { delay: 10 });
  await page.keyboard.press('Control+A');
  await page.keyboard.type('99');
  await page.waitForTimeout(400); // let the rebuild land and restore the editor
  const restored = await page.evaluate(s => {
    const i = document.querySelector(s + ' input');
    return i ? { v: i.value, ro: i.readOnly, focused: document.activeElement === i } : null;
  }, Y);
  assert.ok(restored, 'the editor was re-opened on the rebuilt grid');
  assert.equal(restored.v, '99', 'the restored editor holds the typed weight');
  assert.equal(restored.ro, false, 'the restored editor is unlocked');
  assert.equal(restored.focused, true, 'the restored editor owns the focus');

  // Blur WITHOUT typing another key: no change event will ever fire for it.
  const away = await centre(page, 'tr[data-r="n4"] td[data-c="n5"]');
  await page.mouse.click(away.x, away.y);
  await page.waitForFunction(
    () => document.querySelector('#edgeListHost input.edge-weight[data-edge-id="e4"]')?.value === '99',
    null, { timeout: 3000 },
  ).catch(() => {}); // fall through to the assertion for a readable failure

  assert.equal(await edgeWeight(page, 'e4'), '99', 'the unreported edit reaches the graph');
  assert.equal(await page.evaluate(s => document.querySelector(s).textContent, Y), '99', 'grid and graph agree');
  assert.equal(await edgeWeight(page, 'e2'), '42', 'the earlier edit is still there');
});

// Cell (n3,n4) holds two parallel edges — e3 undirected with weight 1 and e5
// directed with NO weight — so the cell renders "1;" and an editor that reduces
// it to "1" must drop the extra edge.
const PARALLEL_GRAPH = {
  ...GRAPH,
  nextEdge: 6,
  edges: [
    ...GRAPH.edges.slice(0, 3),
    { id: 'e5', from: 'n3', to: 'n4', directed: true, weight: '', label: '', type: '' },
    ...GRAPH.edges.slice(3),
  ],
};

const editorOf = (page, sel) => page.evaluate(s => {
  const i = document.querySelector(s + ' input.matrix-input');
  return i ? { v: i.value, ro: i.readOnly, focused: document.activeElement === i } : null;
}, sel);

test('blurring a re-opened editor does not undo an Undo', async t => {
  const page = await openMatrix(t);
  const X = 'tr[data-r="n1"] td[data-c="n2"]'; // edge e1, weight 3
  const xa = await centre(page, X);
  await page.mouse.dblclick(xa.x, xa.y);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('42');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.querySelector('#edgeListHost input.edge-weight[data-edge-id="e1"]')?.value === '42',
    null, { timeout: 5000 },
  );

  // Re-open the SAME cell and type nothing.
  await page.mouse.click(xa.x, xa.y);
  await page.mouse.click(xa.x, xa.y);
  const opened = await editorOf(page, X);
  assert.ok(opened && opened.ro === false && opened.focused, 'the cell is being edited again');
  assert.equal(opened.v, '42', 'the editor is pre-filled with the committed weight');

  // Undo underneath the open editor: Ctrl+Z is handled while a matrix field has
  // focus, so the editor stays open (the rebuild re-opens it with its old
  // text), then blur without typing a single key.
  await page.keyboard.press('Control+Z');
  await page.waitForFunction(
    () => document.querySelector('#edgeListHost input.edge-weight[data-edge-id="e1"]')?.value === '3',
    null, { timeout: 5000 },
  );
  const restored = await editorOf(page, X);
  assert.ok(restored, 'the open editor survived the Undo re-render');
  // The session holds no draft, so the restore re-reads the MODEL instead of
  // replaying the captured text — the focused editor shows the undone value.
  assert.equal(restored.v, '3', 'the restored editor shows the undone value, not the stale one');

  const away = await centre(page, 'tr[data-r="n4"] td[data-c="n5"]');
  await page.mouse.click(away.x, away.y);
  await page.waitForTimeout(300);
  assert.equal(await edgeWeight(page, 'e1'), '3', 'the blur did not write 42 back over the Undo');
  assert.equal(await page.evaluate(s => document.querySelector(s).textContent, X), '3', 'the cell shows what the graph holds');
});

test('a blur commits parallel-edge text that changes how many values the cell has', async t => {
  const page = await openMatrix(t, PARALLEL_GRAPH);
  const X = 'tr[data-r="n2"] td[data-c="n3"]';   // edge e2
  const PAR = 'tr[data-r="n3"] td[data-c="n4"]'; // "1;" — e3 + e5
  assert.equal(await page.evaluate(s => document.querySelector(s).textContent, PAR), '1;',
    'the parallel unweighted edge renders as an empty value');

  const xa = await centre(page, X);
  await page.mouse.dblclick(xa.x, xa.y);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('42');
  // Open the parallel cell before X's queued rebuild lands and reduce "1;" to
  // "1": one value for two edges drops the extra edge on a normal commit.
  const ya = await centre(page, PAR);
  await page.mouse.dblclick(ya.x, ya.y, { delay: 10 });
  await page.keyboard.press('Control+A');
  await page.keyboard.type('1');
  await page.waitForTimeout(400); // the rebuild lands and restores the editor
  const restored = await editorOf(page, PAR);
  assert.ok(restored, 'the editor was re-opened on the rebuilt grid');
  assert.equal(restored.v, '1', 'the typed text survived the rebuild');

  // Blur without typing: no `change` will ever report this text.
  const away = await centre(page, 'tr[data-r="n4"] td[data-c="n5"]');
  await page.mouse.click(away.x, away.y);
  await page.waitForTimeout(400);
  const e5 = await page.evaluate(() => !!document.querySelector('#edgeListHost input.edge-weight[data-edge-id="e5"]'));
  assert.equal(e5, false, 'the blur removed the parallel edge (empty values are significant)');
  assert.equal(await edgeWeight(page, 'e3'), '1', 'the surviving edge keeps its weight');
  assert.equal(await page.evaluate(s => document.querySelector(s).textContent, PAR), '1');
});

test('switching to another cell takes two clicks, not three', async t => {
  const page = await openMatrix(t);
  const X = 'tr[data-r="n1"] td[data-c="n2"]'; // edge e1
  const Y = 'tr[data-r="n2"] td[data-c="n3"]'; // edge e2
  const xa = await centre(page, X);
  await page.mouse.dblclick(xa.x, xa.y);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('11');

  // Press 1 on Y closes X's editor and arms Y — the deferred commit must not
  // clear that armed state, or press 2 only selects and the editor needs a
  // third click.
  const ya = await centre(page, Y);
  await page.mouse.click(ya.x, ya.y);
  await page.waitForFunction(
    () => document.querySelector('#edgeListHost input.edge-weight[data-edge-id="e1"]')?.value === '11',
    null, { timeout: 5000 },
  );
  await page.waitForTimeout(200);
  assert.equal(await editorOf(page, Y), null, 'one press selects without opening an editor');

  await page.mouse.click(ya.x, ya.y);
  await page.waitForTimeout(200);
  const ed = await editorOf(page, Y);
  assert.ok(ed, 'the second press opened the editor');
  assert.equal(ed.ro, false, 'the editor is unlocked');
  assert.equal(ed.focused, true, 'the editor owns the focus');
  assert.equal(ed.v, '7', 'the editor is pre-filled with the cell weight');
});

// The label of node n5 (fixture label "E") as the EDGE LIST renders it — an
// honest model read, unlike a matrix label input which may be an open editor.
const nodeLabelInGraph = (page, edgeId) => page.evaluate(eid => {
  const w = document.querySelector(`#edgeListHost input.edge-weight[data-edge-id="${eid}"]`);
  const tr = w && w.closest('tr');
  return tr ? tr.querySelector('.el-from').value : null;
}, edgeId);

test('clicking the other label instance commits the restored row-label draft', async t => {
  const page = await openMatrix(t);
  const X = 'tr[data-r="n1"] td[data-c="n2"]'; // edge e1
  const ROW = 'tr[data-r="n5"] th.row-head input[data-node-label="n5"]';
  const COL = '#matrixHost thead th input[data-node-label="n5"]';

  const xa = await centre(page, X);
  await page.mouse.dblclick(xa.x, xa.y);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('42');
  // Open n5's ROW label before X's queued rebuild lands and type into it: the
  // rebuild then re-opens the label with its text assigned programmatically, so
  // no `change` will ever report the draft.
  const rl = await centre(page, ROW);
  await page.mouse.dblclick(rl.x, rl.y, { delay: 10 });
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Alpha');
  await page.waitForTimeout(400); // the rebuild lands and restores the label
  const restored = await page.evaluate(s => {
    const i = document.querySelector(s);
    return { v: i.value, ro: i.readOnly, focused: document.activeElement === i };
  }, ROW);
  assert.equal(restored.v, 'Alpha', 'the row-label draft survived the rebuild');
  assert.equal(restored.ro, false, 'the restored label is unlocked');
  assert.equal(restored.focused, true, 'the restored label owns the focus');

  // Click the SAME node's COLUMN label. That opens the other instance while the
  // row label's deferred blur is still pending; the draft belongs to the field
  // that was typed in, so opening a new one must not throw it away.
  const cl = await centre(page, COL);
  await page.mouse.click(cl.x, cl.y);
  // Wait for the COMMITTED model (the edge list re-renders from the graph), not
  // for a matrix label input: the open editor shows the typed text whether or
  // not anything committed, so waiting on it proves nothing.
  await page.waitForFunction(
    () => {
      const w = document.querySelector('#edgeListHost input.edge-weight[data-edge-id="e4"]');
      return !!w && w.closest('tr').querySelector('.el-from').value === 'Alpha';
    }, null, { timeout: 5000 },
  ).catch(() => {}); // fall through to the assertions for a readable failure

  assert.equal(await nodeLabelInGraph(page, 'e4'), 'Alpha', 'the restored label draft reached the graph');
  assert.equal(await page.evaluate(s => document.querySelector(s).value, ROW), 'Alpha', 'the row head shows the commit');
  assert.equal(await page.evaluate(s => document.querySelector(s).value, COL), 'Alpha', 'the column head shows the commit');
  const col = await page.evaluate(s => {
    const i = document.querySelector(s);
    return { ro: i.readOnly, focused: document.activeElement === i };
  }, COL);
  assert.equal(col.ro, false, 'the column editor the click opened is still unlocked');
  assert.equal(col.focused, true, 'the column editor kept the focus');
});

test('a keystroke after Undo edits the undone value, not the stale one', async t => {
  const page = await openMatrix(t);
  const X = 'tr[data-r="n1"] td[data-c="n2"]'; // edge e1, weight 3
  const xa = await centre(page, X);
  await page.mouse.dblclick(xa.x, xa.y);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('42');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.querySelector('#edgeListHost input.edge-weight[data-edge-id="e1"]')?.value === '42',
    null, { timeout: 5000 },
  );

  // Re-open the cell without typing, Undo, then keep typing: the editor is
  // focused the whole time, so what it shows is what the next key appends to.
  await page.mouse.click(xa.x, xa.y);
  await page.mouse.click(xa.x, xa.y);
  await page.keyboard.press('Control+Z');
  await page.waitForFunction(
    () => document.querySelector('#edgeListHost input.edge-weight[data-edge-id="e1"]')?.value === '3',
    null, { timeout: 5000 },
  );
  const shown = await editorOf(page, X);
  assert.ok(shown && shown.focused, 'the editor is still open after the Undo');
  assert.equal(shown.v, '3', 'the open editor shows the undone value');

  await page.keyboard.type('0');
  assert.equal((await editorOf(page, X)).v, '30', 'the keystroke edited the undone value');
  const away = await centre(page, 'tr[data-r="n4"] td[data-c="n5"]');
  await page.mouse.click(away.x, away.y);
  await page.waitForTimeout(300);
  assert.equal(await edgeWeight(page, 'e1'), '30', 'the commit is 30, not 420');
});
