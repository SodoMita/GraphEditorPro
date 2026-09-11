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

// === Camera contract ===
// The root viewBox is a fixed world reference frame written once; the camera
// lives in a single matrix on #cameraLayer (which holds the grid and the graph)
// for gesture previews AND for the committed camera. These helpers re-derive
// that mapping independently of the implementation.
const REFERENCE_VIEWBOX = { x: -500, y: -330, w: 1000, h: 660 };
const VIEWPORT = { width: 1000, height: 660 };

function cameraScale(camera) {
  const match = camera.getAttribute('transform')?.match(/^matrix\(([^)]+)\)$/);
  assert.ok(match, `expected a camera matrix on #${camera.id}`);
  return match[1].trim().split(/[ ,]+/).map(Number)[0];
}

function assertCameraRendersViewBox(camera, viewBox, viewport = VIEWPORT) {
  const match = camera.getAttribute('transform')?.match(/^matrix\(([^)]+)\)$/);
  assert.ok(match, `expected a camera matrix on #${camera.id}`);
  const [scale, skewX, skewY, , tx, ty] = match[1].trim().split(/[ ,]+/).map(Number);
  assert.equal(skewX, 0, 'the camera matrix has no rotation');
  assert.equal(skewY, 0, 'the camera matrix has no rotation');
  const basePixels = Math.min(viewport.width / REFERENCE_VIEWBOX.w, viewport.height / REFERENCE_VIEWBOX.h);
  const baseOffsetX = (viewport.width - REFERENCE_VIEWBOX.w * basePixels) / 2;
  const baseOffsetY = (viewport.height - REFERENCE_VIEWBOX.h * basePixels) / 2;
  // user space -> screen space is the fixed reference frame mapped with
  // preserveAspectRatio="xMidYMid meet": subtract the reference origin first.
  const toClient = (x, y) => ({
    x: (scale * x + tx - REFERENCE_VIEWBOX.x) * basePixels + baseOffsetX,
    y: (scale * y + ty - REFERENCE_VIEWBOX.y) * basePixels + baseOffsetY,
  });
  const cameraPixels = Math.min(viewport.width / viewBox.w, viewport.height / viewBox.h);
  const offsetX = (viewport.width - viewBox.w * cameraPixels) / 2;
  const offsetY = (viewport.height - viewBox.h * cameraPixels) / 2;
  const topLeft = toClient(viewBox.x, viewBox.y);
  const bottomRight = toClient(viewBox.x + viewBox.w, viewBox.y + viewBox.h);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  assert.ok(near(topLeft.x, offsetX) && near(topLeft.y, offsetY),
    `camera top-left (${topLeft.x}, ${topLeft.y}) must land on the letterboxed corner (${offsetX}, ${offsetY})`);
  assert.ok(near(bottomRight.x, viewport.width - offsetX) && near(bottomRight.y, viewport.height - offsetY),
    `camera bottom-right (${bottomRight.x}, ${bottomRight.y}) must land on the letterboxed corner`);
}

function trackViewBoxWrites(svg) {
  const writes = { count: 0 };
  const setAttribute = svg.setAttribute.bind(svg);
  svg.setAttribute = (name, value) => {
    if (name === 'viewBox') writes.count++;
    return setAttribute(name, value);
  };
  return writes;
}

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

test('pan moves only the composited camera and never rewrites the root viewBox', async () => {
  const { dom, errors } = createEditorDom();
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  const camera = dom.window.document.querySelector('#cameraLayer');
  const scene = dom.window.document.querySelector('#sceneLayer');
  const grid = dom.window.document.querySelector('#gridLayer');
  setCanvasRect(svg);
  const viewBoxWrites = trackViewBoxWrites(svg);
  dom.window.document.querySelector('#modeMove').click();

  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  dispatchPointer(dom.window, svg, 'pointermove', { pointerId: 1, clientX: 180, clientY: 140 });
  await nextFrame(dom.window);

  // Dragged 80 px right and 40 px down at 1:1 — the camera moves left and up by
  // the same world distance.
  assert.equal(viewBoxWrites.count, 0, 'the root viewBox is a reference frame, not a camera write');
  assertCameraRendersViewBox(camera, { x: -580, y: -370, w: 1000, h: 660 });
  assert.equal(scene.getAttribute('transform'), null, 'the scene group is never transformed');
  assert.equal(grid.style.transform, '', 'the grid never uses a temporary compositor transform');
  const pattern = dom.window.document.querySelector('#gridPattern');
  const patternWidthBefore = pattern.getAttribute('width');
  assert.ok(patternWidthBefore, 'the world-locked grid pattern is initialized');
  const previewMatrix = camera.getAttribute('transform');

  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 180, clientY: 140 });
  assert.equal(viewBoxWrites.count, 0, 'releasing the pan writes no viewBox: there is no commit boundary to cross');
  assert.equal(camera.getAttribute('transform'), previewMatrix, 'release keeps every pixel where the preview put it');
  assertCameraRendersViewBox(camera, { x: -580, y: -370, w: 1000, h: 660 });
  assert.equal(scene.getAttribute('transform'), null, 'still no compensation: nothing was handed off');
  assert.equal(svg.getAttribute('viewBox'), `-500 -330 1000 660`, 'the reference frame is untouched');
  assert.equal(pattern.getAttribute('width'), patternWidthBefore, 'panning never rebuilds the world-locked grid pattern');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('pinch preview and commit are the same composited camera write', async () => {
  const { dom, errors } = createEditorDom();
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  const camera = dom.window.document.querySelector('#cameraLayer');
  const scene = dom.window.document.querySelector('#sceneLayer');
  setCanvasRect(svg);
  const viewBoxWrites = trackViewBoxWrites(svg);

  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 100 });
  dispatchPointer(dom.window, svg, 'pointermove', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 100 });
  await nextFrame(dom.window);

  assert.equal(viewBoxWrites.count, 0, 'the root viewBox stays the reference frame during a pinch');
  const previewScale = cameraScale(camera);
  assert.ok(previewScale > 1, 'pinching apart zooms in');
  const previewMatrix = camera.getAttribute('transform');
  const committedWidthBefore = dom.window.document.querySelector('#cameraW').value;

  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 100 });
  assert.equal(viewBoxWrites.count, 0, 'committing the pinch writes no viewBox either');
  assert.equal(camera.getAttribute('transform'), previewMatrix, 'the commit paints exactly what the preview painted');
  assert.equal(scene.getAttribute('transform'), null, 'no compensation transform is needed');
  // The logical camera the sidebar now reports must be the camera that was on
  // screen: the composited matrix scale and the committed viewBox width agree.
  const committedWidth = Number(dom.window.document.querySelector('#cameraW').value);
  assert.notEqual(committedWidthBefore, String(committedWidth));
  assert.equal(committedWidth, Math.round(VIEWPORT.width / previewScale), 'the committed camera matches the previewed matrix');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
