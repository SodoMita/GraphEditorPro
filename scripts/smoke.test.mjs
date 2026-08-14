#!/usr/bin/env node
/*
 * smoke.test.mjs — behavioural smoke test for the built index.html.
 *
 * Loads the single-file build in jsdom (offline, no network), polyfills the
 * few browser APIs jsdom lacks (matchMedia, getBBox, pointer capture), then:
 *   - boots the app and checks the canvas renders,
 *   - adds the sample graph and verifies nodes/edges appear in the SVG,
 *   - clicks every button, toggles every select/input,
 *   - switches language RU/EN and back,
 *   - runs all algorithm buttons,
 *   - verifies zero uncaught errors at the end.
 *
 * Usage: node scripts/smoke.test.mjs [path-to-html]   (default: index.html)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || join(root, 'index.html');
const html = readFileSync(file, 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const detail = e.detail ? String(e.detail.message || e.detail) : '';
  errors.push(`UNCAUGHT: ${e.message} ${detail}`.trim());
});
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'http://localhost/',
});
const w = dom.window;
const d = w.document;

// --- polyfills for APIs jsdom does not implement -------------------------
w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
w.SVGElement.prototype.getBBox = function () { return { x: 0, y: 0, width: 100, height: 50 }; };
w.HTMLElement.prototype.scrollIntoView = function () {};
w.Element.prototype.setPointerCapture = function () {};
w.Element.prototype.releasePointerCapture = function () {};
if (!w.PointerEvent) w.PointerEvent = w.MouseEvent;
w.document.execCommand = () => true;
w.prompt = () => null;
w.confirm = () => true;
w.alert = () => {};

// --- run the page's scripts ----------------------------------------------
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (scripts.length !== 2) { console.error(`expected 2 inline scripts, found ${scripts.length}`); process.exit(1); }
for (const s of scripts) {
  try { w.eval(s); } catch (e) { errors.push('BOOT: ' + e.message); }
}
d.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
w.dispatchEvent(new w.Event('load'));

const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w }));
const fire = (el, type) => el && el.dispatchEvent(new w.Event(type, { bubbles: true }));
const raf = () => new Promise(r => setTimeout(r, 40));

let passed = 0, failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ ' + name); }
};

await raf(); await raf();

// 1. Boot state
check('stats pill rendered', /0/.test(d.getElementById('statsPill')?.textContent ?? ''));
check('canvas wrap marked empty', d.getElementById('canvasWrap').classList.contains('empty'));

// 2. Sample graph
click(d.getElementById('btnSample'));
await raf(); await raf();
const nNodes = d.getElementById('nodesLayer').children.length;
const nEdges = d.getElementById('edgesLayer').children.length;
check('sample adds 7 nodes', nNodes === 7);
check('sample adds 7 edges', nEdges === 7);
check('empty hint removed', !d.getElementById('canvasWrap').classList.contains('empty'));

// 3. Undo / redo
click(d.getElementById('btnUndo'));
await raf(); await raf();
check('undo removes sample', d.getElementById('nodesLayer').children.length === 0);
click(d.getElementById('btnRedo'));
await raf(); await raf();
check('redo restores sample', d.getElementById('nodesLayer').children.length === 7);

// 4. Matrix renders
await new Promise(r => setTimeout(r, 200));
check('adjacency matrix rendered', d.querySelectorAll('#matrixHost table td, #matrixHost table th').length > 0);
check('edge list rendered', d.querySelectorAll('#edgeListHost tr').length > 1);

// 5. Algorithms
for (const id of ['btnBfs', 'btnDfs', 'btnDijkstra', 'btnComponents', 'btnTopo', 'btnStats']) {
  click(d.getElementById(id));
}
await raf();
check('algorithm output produced', (d.getElementById('algoOutput')?.textContent ?? '').length > 0);

// 6. Language toggle round-trip
const before = d.querySelector('[data-i18n="tab_edit"]')?.textContent;
click(d.getElementById('btnLang'));
await raf();
const after = d.querySelector('[data-i18n="tab_edit"]')?.textContent;
click(d.getElementById('btnLang'));
await raf();
const back = d.querySelector('[data-i18n="tab_edit"]')?.textContent;
check('language switch changes text', before !== after);
check('language switch round-trips', before === back);

// 7. Click every button (destructive ones last; Clear excluded until the end)
const skip = new Set(['btnClear']);
for (const b of [...d.querySelectorAll('button')]) {
  if (skip.has(b.id)) continue;
  try { click(b); } catch (e) { errors.push(`click #${b.id || b.textContent.slice(0, 20)}: ${e.message}`); }
}
await raf(); await raf();

// 8. Poke every select and a broad sample of inputs
for (const sel of d.querySelectorAll('select')) { try { fire(sel, 'change'); } catch (e) { errors.push(`select #${sel.id}: ${e.message}`); } }
for (const inp of [...d.querySelectorAll('input')].slice(0, 120)) {
  try { fire(inp, 'input'); fire(inp, 'change'); } catch (e) { errors.push(`input #${inp.id}: ${e.message}`); }
}
await raf(); await raf();

// 9. Clear graph last
click(d.getElementById('btnClear'));
await raf(); await raf();
check('clear empties the canvas', d.getElementById('nodesLayer').children.length === 0);

// 10. No runtime errors anywhere in the run
const realErrors = errors.filter(e => !/matchMedia|not implemented/i.test(e));
check('no uncaught runtime errors', realErrors.length === 0);
if (realErrors.length) realErrors.slice(0, 15).forEach(e => console.error('    ' + e));

console.log(`\n${failed === 0 ? '✓' : '✗'} smoke test: ${passed} passed, ${failed} failed (${file})`);
process.exit(failed === 0 ? 0 : 1);
