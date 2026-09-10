import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

function createEditorDom(savedGraph = null, storedValues = {}) {
  const errors = [];
  const values = { ...storedValues };
  if (savedGraph) values['graph-editor-pro-v2'] = JSON.stringify(savedGraph);
  const preload = Object.entries(values)
    .map(([key, value]) => `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
    .join('');
  const documentHtml = preload
    ? html.replace('<script>', `<script>${preload}</script><script>`)
    : html;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(documentHtml, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://offline.test/',
    virtualConsole,
    beforeParse(window) {
      window.matchMedia = query => ({
        media: query,
        matches: false,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return true; },
      });
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => null;
      window.URL.createObjectURL = () => 'blob:offline-test';
      window.URL.revokeObjectURL = () => {};
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { readText: async () => '', writeText: async () => {} },
      });
    },
  });
  return { dom, errors };
}

function setCanvasRect(svg) {
  svg.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0,
    width: 1000, height: 660, right: 1000, bottom: 660,
    toJSON() { return this; },
  });
}

function dispatchPointer(window, target, type, options) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: options.button ?? 0,
    clientX: options.clientX,
    clientY: options.clientY,
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId },
    pointerType: { value: options.pointerType ?? 'mouse' },
  });
  target.dispatchEvent(event);
}

const nextFrame = window => new Promise(resolve => window.setTimeout(resolve, 30));

test('generated page initializes without runtime errors', async () => {
  const { dom, errors } = createEditorDom();
  await new Promise(resolve => dom.window.setTimeout(resolve, 50));

  assert.deepEqual(errors.map(error => error.message), []);
  assert.match(dom.window.document.title, /Graph Editor Pro/);
  assert.equal(dom.window.document.querySelector('#statusPill')?.textContent?.length > 0, true);
  assert.equal(dom.window.document.querySelector('#graphCanvas')?.getAttribute('viewBox'), '-500 -330 1000 660');
  dom.window.close();
});

test('tools drawer is non-modal, leaves the graph focusable, and closes with Escape', async () => {
  const { dom, errors } = createEditorDom();
  await nextFrame(dom.window);
  const document = dom.window.document;
  const drawer = document.querySelector('#toolsPanel');
  const menu = document.querySelector('#btnMenu');

  assert.equal(drawer.hasAttribute('inert'), true);
  assert.equal(drawer.getAttribute('aria-hidden'), 'true');
  assert.equal(drawer.getAttribute('role'), 'region');
  assert.equal(drawer.hasAttribute('aria-modal'), false);
  assert.equal(document.querySelector('#sidebarScrim'), null);
  assert.equal(menu.getAttribute('aria-expanded'), 'false');

  const canvas = document.querySelector('#graphCanvas');
  setCanvasRect(canvas);
  document.querySelector('#modeNode').click();
  menu.click();
  assert.equal(drawer.classList.contains('open'), true);
  assert.equal(drawer.inert, false);
  assert.equal(drawer.getAttribute('aria-hidden'), 'false');
  assert.equal(menu.getAttribute('aria-expanded'), 'true');
  assert.equal(menu.getAttribute('aria-label'), 'Close panels');
  assert.equal(document.querySelector('#tab-edit').getAttribute('aria-selected'), 'true');

  canvas.focus();
  assert.equal(document.activeElement, canvas);
  dispatchPointer(dom.window, canvas, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 330 });
  dispatchPointer(dom.window, canvas, 'pointerup', { pointerId: 1, clientX: 500, clientY: 330 });
  await nextFrame(dom.window);
  assert.match(document.querySelector('#statsPill').textContent, /^1 /);
  assert.equal(drawer.classList.contains('open'), true);

  document.querySelector('#tab-data').click();
  assert.equal(document.querySelector('#panel-data').classList.contains('active'), true);
  assert.equal(document.querySelector('#tab-data').getAttribute('aria-selected'), 'true');

  dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(drawer.classList.contains('open'), false);
  assert.equal(drawer.inert, true);
  assert.equal(drawer.getAttribute('aria-hidden'), 'true');
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
  assert.equal(menu.getAttribute('aria-label'), 'Open tools and properties');
  assert.equal(document.activeElement, canvas);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('sample graph action lives in Help and returns to the canvas', async () => {
  const { dom, errors } = createEditorDom();
  await nextFrame(dom.window);
  const document = dom.window.document;
  const drawer = document.querySelector('#toolsPanel');
  const menu = document.querySelector('#btnMenu');
  const sample = document.querySelector('#btnSample');

  assert.equal(document.querySelector('.appbar #btnSample'), null);
  assert.equal(sample.closest('#panel-help') !== null, true);
  assert.equal(document.querySelector('[data-selecttool="brush"] use').getAttribute('href'), '#icon-brush');
  assert.ok(document.querySelector('#icon-brush circle[stroke-dasharray]'));
  assert.equal(document.querySelector('[data-selecttool="adjacent"] use').getAttribute('href'), '#icon-adjacent');
  assert.equal(document.querySelector('[data-selecttool="directedAdjacent"] use').getAttribute('href'), '#icon-directed-adjacent');

  menu.click();
  document.querySelector('#tab-help').click();
  sample.click();
  await nextFrame(dom.window);

  assert.equal(drawer.classList.contains('open'), false);
  assert.equal(document.activeElement, menu);
  assert.match(document.querySelector('#statsPill').textContent, /^7 /);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('JSON export serializes sanitized style presets', async () => {
  const savedGraph = {
    nodes: [],
    edges: [],
    settings: {
      stylePresets: [{
        name: 'Ocean preset',
        node: { shape: 'circle', color: '#0ea5e9', width: 64 },
        edge: { color: '#38bdf8', strokeStyle: 'dashed' },
      }],
    },
  };
  const { dom, errors } = createEditorDom(savedGraph);
  await nextFrame(dom.window);

  dom.window.document.querySelector('#btnExportJson').click();
  const exported = JSON.parse(dom.window.document.querySelector('.export-modal textarea').value);
  assert.deepEqual(exported.settings.stylePresets, savedGraph.settings.stylePresets);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('autosave opt-out is persisted and prevents stale graph restoration', async () => {
  const first = createEditorDom();
  await nextFrame(first.dom.window);
  const autosave = first.dom.window.document.querySelector('#optAutosave');
  autosave.checked = false;
  autosave.dispatchEvent(new first.dom.window.Event('change', { bubbles: true }));
  assert.equal(first.dom.window.localStorage.getItem('graph-editor-pro-autosave'), 'false');
  first.dom.window.close();

  const staleGraph = {
    nodes: [{ id: 'stale', label: 'Should not load', x: 0, y: 0, order: 0 }],
    edges: [],
  };
  const second = createEditorDom(staleGraph, { 'graph-editor-pro-autosave': 'false' });
  await nextFrame(second.dom.window);
  assert.equal(second.dom.window.document.querySelector('#optAutosave').checked, false);
  assert.match(second.dom.window.document.querySelector('#statsPill').textContent, /^0 /);
  assert.deepEqual(second.errors.map(error => error.message), []);
  second.dom.window.close();
});

test('new nodes actually honor the inherit-defaults switch', async () => {
  const { dom, errors } = createEditorDom();
  await nextFrame(dom.window);
  const document = dom.window.document;
  const placementColor = document.querySelector('#nodeColor');
  placementColor.value = '#ff0000';
  placementColor.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  document.querySelector('#btnMatrixAddNode').click();
  await nextFrame(dom.window);
  assert.equal(document.querySelector('#node-n1 .node-shape').getAttribute('fill'), '#0ea5e9', 'inherited node follows Style defaults');

  const inherit = document.querySelector('#optInheritDefaults');
  inherit.checked = false;
  inherit.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  document.querySelector('#btnMatrixAddNode').click();
  await nextFrame(dom.window);
  assert.equal(document.querySelector('#node-n2 .node-shape').getAttribute('fill'), '#ff0000', 'non-inherited node bakes placement color');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('large edge lists render in bounded pages', async () => {
  const nodeCount = 300;
  const edgeCount = 600;
  const graph = {
    settings: { edgeListPageSize: 500 },
    nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: `n${index}`, label: `N${index}`, x: index % 30, y: Math.floor(index / 30), order: index,
    })),
    edges: Array.from({ length: edgeCount }, (_, index) => ({
      id: `e${index}`, from: `n${index % nodeCount}`, to: `n${(index + 1) % nodeCount}`, directed: true,
    })),
  };
  const { dom, errors } = createEditorDom(graph);
  await new Promise(resolve => dom.window.setTimeout(resolve, 150));

  assert.equal(dom.window.document.querySelectorAll('#edgeListHost tbody tr').length, 500);
  assert.ok(dom.window.document.querySelector('#btnEdgeListMore'));
  dom.window.document.querySelector('#btnEdgeListMore').click();
  assert.equal(dom.window.document.querySelectorAll('#edgeListHost tbody tr').length, 600);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('pan keeps its promoted matrix stable while the viewBox commits', async () => {
  const { dom, errors } = createEditorDom();
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  const camera = dom.window.document.querySelector('#cameraLayer');
  const scene = dom.window.document.querySelector('#sceneLayer');
  const grid = dom.window.document.querySelector('#gridLayer');
  setCanvasRect(svg);
  dom.window.document.querySelector('#modeMove').click();

  let viewBoxWrites = 0;
  const setAttribute = svg.setAttribute.bind(svg);
  svg.setAttribute = (name, value) => {
    if (name === 'viewBox') viewBoxWrites++;
    return setAttribute(name, value);
  };

  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  dispatchPointer(dom.window, svg, 'pointermove', { pointerId: 1, clientX: 180, clientY: 140 });
  await nextFrame(dom.window);

  assert.equal(viewBoxWrites, 0, 'the expensive root viewBox stays frozen during pan');
  assert.equal(camera.getAttribute('transform'), 'matrix(1 0 0 1 80 40)');
  assert.equal(scene.getAttribute('transform'), null, 'no compensation is needed before commit');
  assert.equal(grid.style.transform, '', 'the grid never uses a temporary compositor transform');
  const previewMatrix = camera.getAttribute('transform');

  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 180, clientY: 140 });
  assert.equal(viewBoxWrites, 1);
  assert.equal(camera.getAttribute('transform'), previewMatrix, 'the promoted property is untouched at the commit boundary');
  assert.equal(scene.getAttribute('transform'), 'matrix(1 0 0 1 -80 -40)', 'the inner inverse cancels the persistent outer matrix');
  assert.equal(svg.getAttribute('viewBox'), '-580 -370 1000 660');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('pinch also rebases without clearing its promoted preview matrix', async () => {
  const { dom, errors } = createEditorDom();
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  const camera = dom.window.document.querySelector('#cameraLayer');
  const scene = dom.window.document.querySelector('#sceneLayer');
  setCanvasRect(svg);

  let viewBoxWrites = 0;
  const setAttribute = svg.setAttribute.bind(svg);
  svg.setAttribute = (name, value) => {
    if (name === 'viewBox') viewBoxWrites++;
    return setAttribute(name, value);
  };

  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 100 });
  dispatchPointer(dom.window, svg, 'pointermove', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 100 });
  await nextFrame(dom.window);

  assert.equal(viewBoxWrites, 0, 'the expensive root viewBox stays frozen during pinch');
  assert.match(camera.getAttribute('transform'), /^matrix\(/);
  const previewMatrix = camera.getAttribute('transform');

  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 100 });
  assert.equal(viewBoxWrites, 1);
  assert.equal(camera.getAttribute('transform'), previewMatrix, 'commit does not clear or replace the promoted matrix');
  assert.match(scene.getAttribute('transform'), /^matrix\(/, 'inner compensation is installed for the committed viewBox');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
