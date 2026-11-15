import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const html = await readFile('index.html', 'utf8');
const template = await readFile('src/template.html', 'utf8');

test('generated deliverable is one self-contained HTML document', () => {
  assert.equal((html.match(/<script\b/gi) ?? []).length, 1);
  assert.equal((html.match(/<style\b/gi) ?? []).length, 1);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html, /<link\b[^>]*\brel\s*=\s*["']?stylesheet/i);
  assert.doesNotMatch(html, /\bfetch\s*\(/);
  assert.doesNotMatch(html, /\bXMLHttpRequest\b/);
  assert.doesNotMatch(html, /\bWebSocket\b/);
});

test('inlined JavaScript is syntactically valid', () => {
  const match = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'inline script is present');
  assert.doesNotThrow(() => new vm.Script(match[1], { filename: 'index.html:inline-script' }));
});

test('source template has no duplicate element IDs', () => {
  const ids = [...template.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
  assert.ok(ids.length > 100, 'expected the complete editor template');
  assert.equal(new Set(ids).size, ids.length);
});

test('key graph editor controls remain in the generated page', () => {
  for (const id of [
    'graphCanvas', 'gridLayer', 'cameraLayer', 'sceneLayer', 'nodesLayer', 'edgesLayer', 'modeSelect', 'modeNode',
    'modeEdge', 'matrixHost', 'edgeListHost', 'btnUndo', 'btnRedo',
    'btnExportJson', 'fileImport', 'optMatrixLimit', 'optEdgeListPageSize', 'algoOutput',
  ]) {
    assert.match(html, new RegExp(`\\bid=["']${id}["']`), `missing #${id}`);
  }
});

test('portrait: the app bar outranks the lifted tool rows', async () => {
  // The lifted rows are position:fixed with a bottom offset that rises with
  // the sheet, so on short phones they reach into the app bar. Whatever the
  // sheet height, the app bar's controls must stay reachable.
  const css = await readFile('src/styles.css', 'utf8');
  const portrait = css.match(/@media \(max-width:950px\) and \(orientation:portrait\)\{[\s\S]*?\n    \}/);
  assert.ok(portrait, 'the portrait media query exists');
  const appbar = portrait[0].match(/\.appbar\{[^}]*z-index:\s*(\d+)/);
  assert.ok(appbar, 'the portrait block raises .appbar z-index');
  const others = portrait[0].replace(/\.appbar\{[^}]*\}/g, '');
  const lifted = [...others.matchAll(/z-index:\s*(\d+)/g)].map(m => Number(m[1])).filter(n => n > 0 && n < 90);
  assert.ok(lifted.length > 0, 'the lifted rows carry z-index values');
  assert.ok(Number(appbar[1]) > Math.max(...lifted),
    `appbar z-index ${appbar[1]} outranks the lifted rows (${Math.max(...lifted)})`);
});
