import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

// This fixture instruments innerHTML so the test can prove WHICH bytes were
// re-parsed when the selection panel re-renders at CUSTOM_DEFINITIONS_MAX.
function createEditorDom(savedGraph) {
  const errors = [];
  const stats = { totalBytes: 0, customRowBytes: 0 };
  const source = html.replace('<script>', `<script>localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(savedGraph))});</script><script>`);
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(source, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://offline.test/', virtualConsole,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.alert = () => {}; window.confirm = () => true; window.prompt = () => null;
      const canvasRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 660, right: 1000, bottom: 660, toJSON() { return this; } });
      const proto = window.Element.prototype;
      const originalRect = proto.getBoundingClientRect;
      proto.getBoundingClientRect = function () {
        const id = this.id;
        if (id === 'canvasWrap' || id === 'graphCanvas' || id === 'gridLayer') return canvasRect();
        return originalRect.call(this);
      };
      const originalInner = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
      Object.defineProperty(proto, 'innerHTML', {
        set(value) {
          const text = String(value);
          stats.totalBytes += text.length;
          if (text.includes('custom-prop-row')) stats.customRowBytes += text.length;
          return originalInner.set.call(this, value);
        },
        get() { return originalInner.get.call(this); },
      });
    },
  });
  return { dom, errors, stats };
}

const nextFrame = window => new Promise(resolve => window.setTimeout(resolve, 30));
const settle = (window, ms) => new Promise(resolve => window.setTimeout(resolve, ms));
const dispatchPointer = (window, target, type, options = {}) => {
  const event = new window.MouseEvent(type, {
    bubbles: true, cancelable: true,
    button: options.button ?? 0,
    clientX: options.clientX ?? 0, clientY: options.clientY ?? 0,
  });
  Object.defineProperties(event, { pointerId: { value: options.pointerId ?? 1 }, pointerType: { value: options.pointerType ?? 'mouse' } });
  target.dispatchEvent(event);
};
function selectNode(window, document, id, x, y) {
  const svg = document.querySelector('#graphCanvas');
  svg.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 660, right: 1000, bottom: 660, toJSON() { return this; } });
  document.elementFromPoint = () => document.querySelector('#node-' + id);
  dispatchPointer(window, document.querySelector('#node-' + id), 'pointerdown', { pointerId: 1, clientX: x, clientY: y });
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: x, clientY: y });
  return nextFrame(window);
}

function bigGraph() {
  const customAttributes = [];
  for (let i = 0; i < 2000; i++) customAttributes.push({ id: 'attr' + i, scope: 'all', type: 'string' });
  return {
    title: 'custom-props-rebuild', mode: 'select', nextNode: 3, nextEdge: 2,
    nodes: [{ id: 'n1', label: 'n1', x: -200, y: 0, type: '', order: 0, custom: { attr0: '42.5' } }],
    edges: [],
    customAttributes,
    viewBox: { x: -500, y: -350, w: 1000, h: 700 },
  };
}

test('a byte-identical repaint at 2000 definitions reuses the panel and its custom sections', async () => {
  const { dom, errors, stats } = createEditorDom(bigGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  await selectNode(window, document, 'n1', 300, 330);
  const row = () => document.querySelector('#selectionPanel .custom-prop-input[data-custom-attribute="attr0"]');
  const first = row();
  assert.ok(first, 'the selection panel renders the custom property rows');

  // A byte-identical repaint (the same value committed again) must not
  // re-parse the panel or its rows: identical markup + identical selection
  // means the live DOM — listeners, focus and all — is already correct.
  stats.totalBytes = 0; stats.customRowBytes = 0;
  const typeInput = document.querySelector('#selNodeType');
  typeInput.value = '';
  typeInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);

  assert.equal(stats.customRowBytes, 0, 'no custom property rows were re-parsed');
  assert.equal(stats.totalBytes, 0, 'the panel was not rebuilt at all');
  assert.equal(row(), first, 'the row element survived the re-render');

  // Focus stays put inside the reused rows — the user's edit is undisturbed.
  first.focus();
  typeInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  assert.equal(document.activeElement, first, 'focus survives a no-op re-render');

  // Listeners of the reused rows still work: edit the value and export.
  first.value = '42.6';
  first.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  document.querySelector('#btnExportJson').click();
  const modal = document.querySelector('.export-modal');
  const graph = JSON.parse(modal.querySelector('textarea').value);
  modal.remove();
  assert.equal(graph.nodes[0].custom.attr0, '42.6', 'the reused input still commits its value');

  // A definition edit that migrates (drops) the stored value must refresh the
  // panel: switch attr0 to int, its non-integer value cannot survive.
  const defRows = [...document.querySelectorAll('#customAttributesList .custom-attribute-row')];
  const attr0Row = defRows.find(r => r.querySelector('[data-attribute-field="id"]').value === 'attr0');
  attr0Row.querySelector('[data-attribute-field="type"]').value = 'int';
  attr0Row.querySelector('[data-attribute-action="save"]').click();
  await settle(window, 250);
  assert.equal(row().value, '', 'the migrated-away value disappears from the panel');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
