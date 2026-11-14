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

  // A definition edit that migrates must refresh the panel: switch attr0 to
  // int. '42.6' cannot be an int, and the type-migration path preserves the
  // stated text verbatim (the same contract as import and editing), so the
  // panel re-renders with the value it kept — proving the definition edit
  // propagated through the cache path rather than being swallowed by it.
  const defRows = [...document.querySelectorAll('#customAttributesList .custom-attribute-row')];
  const attr0Row = defRows.find(r => r.querySelector('[data-attribute-field="id"]').value === 'attr0');
  attr0Row.querySelector('[data-attribute-field="type"]').value = 'int';
  attr0Row.querySelector('[data-attribute-action="save"]').click();
  await settle(window, 250);
  assert.equal(row().value, '42.6', 'the migrated definition keeps the stated text verbatim');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

function bigGraphTwoNodes() {
  const customAttributes = [];
  for (let i = 0; i < 2000; i++) customAttributes.push({ id: 'attr' + i, scope: 'all', type: 'string' });
  return {
    title: 'custom-props-paginate', mode: 'select', nextNode: 3, nextEdge: 2,
    nodes: [
      { id: 'n1', label: 'n1', x: -200, y: 0, type: '', order: 0, custom: { attr0: 'keep-n1' } },
      { id: 'n2', label: 'n2', x: 200, y: 0, type: '', order: 1, custom: { attr0: 'keep-n2' } },
    ],
    edges: [],
    customAttributes,
    viewBox: { x: -500, y: -350, w: 1000, h: 700 },
  };
}

test('a selection switch at 2000 definitions builds only the visible page of rows', async () => {
  const { dom, errors, stats } = createEditorDom(bigGraphTwoNodes());
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  await selectNode(window, document, 'n1', 300, 350);
  const rows = () => [...document.querySelectorAll('#selectionPanel .custom-prop-row')];
  assert.equal(rows().length, 100, 'only the first page of rows is mounted');
  const pager = document.querySelector('#selectionPanel .custom-props-pager');
  assert.ok(pager, 'the pager is rendered when definitions exceed the page size');
  assert.equal(pager.getAttribute('role'), 'navigation');
  const status = () => pager.querySelector('.custom-props-page-status').textContent;
  assert.equal(status(), 'Showing 1–100 of 2000');
  assert.equal(pager.querySelector('[data-cp-page="prev"]').disabled, true, 'prev is disabled on the first page');
  assert.equal(pager.querySelector('[data-cp-page="next"]').disabled, false);
  assert.equal(pager.querySelector('.custom-props-page-status').getAttribute('aria-live'), 'polite', 'the page status is announced');

  // A selection switch is a full section rebuild (the target changed) — but it
  // must rebuild only the visible page, never all 2000 rows.
  stats.totalBytes = 0; stats.customRowBytes = 0;
  await selectNode(window, document, 'n2', 700, 350);
  assert.ok(stats.customRowBytes < 100000, `the rebuilt section stays bounded (got ${stats.customRowBytes} custom-row bytes)`);
  assert.equal(rows().length, 100, 'the switched section still mounts one page');
  assert.equal(document.querySelector('#selectionPanel [data-custom-attribute="attr0"]').value, 'keep-n2', 'the new node\u2019s values are shown');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('the custom property pager is keyboard-accessible with stable focus', async () => {
  const { dom, errors } = createEditorDom(bigGraphTwoNodes());
  const { window } = dom; const { document } = window;
  await nextFrame(window);
  await selectNode(window, document, 'n1', 300, 350);

  const pager = document.querySelector('#selectionPanel .custom-props-pager');
  const next = pager.querySelector('[data-cp-page="next"]');
  const prev = pager.querySelector('[data-cp-page="prev"]');
  const firstId = () => document.querySelector('#selectionPanel .custom-prop-id').textContent;
  const status = () => pager.querySelector('.custom-props-page-status').textContent;

  // Keyboard navigation: ArrowRight pages forward without leaving the control.
  next.focus();
  assert.equal(document.activeElement, next);
  pager.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(status(), 'Showing 101–200 of 2000');
  assert.equal(firstId(), 'attr100', 'the second page shows the next definitions');
  assert.equal(document.activeElement, next, 'focus stays on the control after paging');
  assert.equal(prev.disabled, false, 'prev is enabled away from the first page');

  // End jumps to the last page; Home returns to the first.
  pager.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  assert.equal(status(), 'Showing 1901–2000 of 2000');
  assert.equal(firstId(), 'attr1900');
  assert.equal(next.disabled, true, 'next is disabled on the last page');
  pager.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
  assert.equal(status(), 'Showing 1–100 of 2000');
  assert.equal(firstId(), 'attr0');

  // The stated value on a page is committed through the same input contract.
  document.querySelector('#selectionPanel [data-custom-attribute="attr0"]').value = 'edited-value';
  document.querySelector('#selectionPanel [data-custom-attribute="attr0"]')
    .dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  assert.equal(document.querySelector('#selectionPanel [data-custom-attribute="attr0"]').value, 'edited-value');

  // A definition beyond page one is reachable by paging, not by building all rows.
  pager.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  const attr150 = document.querySelector('#selectionPanel [data-custom-attribute="attr150"]');
  assert.ok(attr150, 'the second page exposes attr150');
  attr150.value = 'deep-value';
  attr150.dispatchEvent(new window.Event('change', { bubbles: true }));
  await nextFrame(window);
  assert.equal(document.querySelector('#selectionPanel [data-custom-attribute="attr150"]').value, 'deep-value');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('closed panels mount their custom properties lazily on first open', async () => {
  const { dom, errors } = createEditorDom(bigGraph());
  const { window } = dom; const { document } = window;
  await nextFrame(window);

  // The Data tab is inactive at boot: its host must not have been built yet.
  assert.equal(document.querySelectorAll('#graphCustomProps .custom-prop-row').length, 0, 'a hidden panel builds nothing');

  // First activation of the Data tab mounts the section synchronously.
  document.querySelector('#tab-data').click();
  assert.equal(document.querySelectorAll('#graphCustomProps .custom-prop-row').length, 100, 'opening the tab mounts the visible page');
  assert.ok(document.querySelector('#graphCustomProps .custom-props-pager'), 'the pager mounts with the rows');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
