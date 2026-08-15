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
    'graphCanvas', 'gridLayer', 'sceneLayer', 'nodesLayer', 'edgesLayer', 'modeSelect', 'modeNode',
    'modeEdge', 'matrixHost', 'edgeListHost', 'btnUndo', 'btnRedo',
    'btnExportJson', 'fileImport', 'algoOutput',
  ]) {
    assert.match(html, new RegExp(`\\bid=["']${id}["']`), `missing #${id}`);
  }
});
