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
      // jsdom lays nothing out, so the editor would size the canvas 0x0 and the
      // camera would never receive a viewport. Patch the prototype so the very
      // first render already sees a real 1000x660 canvas; the camera measures
      // #canvasWrap, and the SVG/grid are stubbed for the same reason.
      const canvasRect = () => ({
        x: 0, y: 0, left: 0, top: 0,
        width: 1000, height: 660, right: 1000, bottom: 660,
        toJSON() { return this; },
      });
      const proto = window.Element.prototype;
      const originalRect = proto.getBoundingClientRect;
      proto.getBoundingClientRect = function () {
        const id = this.id;
        if (id === 'canvasWrap' || id === 'graphCanvas' || id === 'gridLayer') return canvasRect();
        return originalRect.call(this);
      };
      window.__canvasRect = canvasRect;
    },
  });
  return { dom, errors };
}

function setCanvasRect(svg) {
  // The canvas viewport is measured from #canvasWrap, which is never transformed;
  // stub that as well as the SVG so jsdom reports a real 1000x660 canvas.
  const rect = () => ({
    x: 0, y: 0, left: 0, top: 0,
    width: 1000, height: 660, right: 1000, bottom: 660,
    toJSON() { return this; },
  });
  svg.getBoundingClientRect = rect;
  const wrap = svg.ownerDocument.querySelector('#canvasWrap');
  if (wrap) wrap.getBoundingClientRect = rect;
  const grid = svg.ownerDocument.querySelector('#gridLayer');
  if (grid) grid.getBoundingClientRect = rect;
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
// There is exactly ONE paint system: the root viewBox is a fixed world reference
// frame written once, and both gesture previews and the committed camera are a
// single `transform` matrix on #cameraLayer. These helpers read that one matrix
// — there is no second surface to compose, and a test that needs one has found
// a regression rather than a convenience to add.
const REFERENCE_VIEWBOX = { x: -500, y: -330, w: 1000, h: 660 };
const VIEWPORT = { width: 1000, height: 660 };

function parseMatrix2d(raw, label) {
  const match = raw?.match(/^matrix\(([^)]+)\)$/);
  assert.ok(match, `expected a 2D matrix on ${label}, got ${JSON.stringify(raw)}`);
  const [scale, skewX, skewY, scaleY, tx, ty] = match[1].trim().split(/[ ,]+/).map(Number);
  assert.equal(skewX, 0, `${label} matrix has no rotation`);
  assert.equal(skewY, 0, `${label} matrix has no rotation`);
  assert.ok(Math.abs(scale - scaleY) < 1e-9, `${label} matrix scales uniformly`);
  return { scale, tx, ty };
}

// No CSS-transformed wrapper may exist above the canvas SVG: a second camera
// The camera is ONE surface: #cameraLayer, a div that holds the grid and the
// SVG together and is moved by a single composited transform. A second surface
// is the bug this project has fixed three times (see 20-rendering.ts).
function assertSingleCameraSurface(document) {
  assert.equal(document.querySelector('#cameraStage'), null,
    'the canvas must have no second camera surface (#cameraStage)');
  const camera = document.querySelector('#cameraLayer');
  assert.ok(camera, '#cameraLayer exists');
  assert.equal(camera.tagName, 'DIV',
    'the camera surface must be a plain div so a camera change is a composited transform');
  assert.equal(document.querySelectorAll('#cameraLayer').length, 1,
    'there is exactly one camera surface');
  // Grid and graph must travel inside that one surface.
  assert.equal(document.querySelector('#gridLayer').parentElement, camera,
    'the grid rides the camera surface');
  assert.ok(camera.contains(document.querySelector('#graphCanvas')),
    'the graph rides the same camera surface');
  // The grid alone carries a counter-transform (it must stay viewport-sized
  // while the camera zooms). Everything else must be static: a second element
  // tracking the camera is exactly the second paint system this project removed.
  for (const id of ['graphCanvas', 'graphPlane', 'sceneLayer']) {
    const el = document.getElementById(id);
    if (el && el.style) assert.equal(el.style.transform, '', `#${id} must not track the camera`);
  }
}

// What is on screen: a world point -> viewport pixel, through the CSS matrix
// that the camera currently has on #cameraLayer.
function camMatrix(camera) {
  const inline = (camera.style && camera.style.transform) || '';
  return inline ? parseMatrix2d(inline, '#cameraLayer') : { scale: 1, tx: 0, ty: 0 };
}

function cameraScale(camera) {
  return camMatrix(camera).scale;
}

function projectWorldPoint(camera, x, y, viewport = VIEWPORT) {
  // Paint is two stages, in this order: the SVG maps the world onto the reference
  // frame inside its own box (preserveAspectRatio="xMidYMid meet"), then the CSS
  // matrix on #cameraLayer moves that box. Both stages matter.
  const m = camMatrix(camera);
  const basePixels = Math.min(viewport.width / REFERENCE_VIEWBOX.w, viewport.height / REFERENCE_VIEWBOX.h);
  const refOffsetX = (viewport.width - REFERENCE_VIEWBOX.w * basePixels) / 2;
  const refOffsetY = (viewport.height - REFERENCE_VIEWBOX.h * basePixels) / 2;
  const px = (x - REFERENCE_VIEWBOX.x) * basePixels + refOffsetX;
  const py = (y - REFERENCE_VIEWBOX.y) * basePixels + refOffsetY;
  return { x: m.scale * px + m.tx, y: m.scale * py + m.ty };
}

function assertCameraRendersViewBox(camera, viewBox, viewport = VIEWPORT) {
  const cameraPixels = Math.min(viewport.width / viewBox.w, viewport.height / viewBox.h);
  const offsetX = (viewport.width - viewBox.w * cameraPixels) / 2;
  const offsetY = (viewport.height - viewBox.h * cameraPixels) / 2;
  const topLeft = projectWorldPoint(camera, viewBox.x, viewBox.y, viewport);
  const bottomRight = projectWorldPoint(camera, viewBox.x + viewBox.w, viewBox.y + viewBox.h, viewport);
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

test('pan previews and commits through the one camera matrix, never the root viewBox', async () => {
  const { dom, errors } = createEditorDom();
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  assertSingleCameraSurface(dom.window.document);
  const camera = dom.window.document.querySelector('#cameraLayer');
  const scene = dom.window.document.querySelector('#sceneLayer');
  const grid = dom.window.document.querySelector('#gridLayer');
  setCanvasRect(svg);
  const viewBoxWrites = trackViewBoxWrites(svg);
  const baseCameraMatrix = camera.style.transform;
  dom.window.document.querySelector('#modeMove').click();

  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  dispatchPointer(dom.window, svg, 'pointermove', { pointerId: 1, clientX: 180, clientY: 140 });
  await nextFrame(dom.window);

  // Dragged 80 px right and 40 px down at 1:1 — the surface moves right and down
  // by exactly that, and the committed camera matrix is left alone until release.
  assert.equal(viewBoxWrites.count, 0, 'the root viewBox is a reference frame, not a camera write');
  assert.notEqual(camera.style.transform, baseCameraMatrix,
    'the pan preview moves the one camera surface');
  assertCameraRendersViewBox(camera, { x: -580, y: -370, w: 1000, h: 660 });
  assert.equal(scene.getAttribute('transform'), null, 'the scene group is never transformed');
  // The grid counter-scales so it always fills the canvas; that is not a camera.
  assert.match(grid.style.transform, /^translate\(.*\) scale\(.*\)$/,
    'the grid counter-transforms to stay viewport-sized');
  const gridStyleBefore = grid.style.backgroundImage;
  assert.ok(gridStyleBefore.includes('repeating-linear-gradient'), 'the world-locked grid is painted');
  const previewOrigin = projectWorldPoint(camera, 0, 0);

  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 180, clientY: 140 });
  assert.equal(viewBoxWrites.count, 0, 'releasing the pan writes no viewBox');
  const committedOrigin = projectWorldPoint(camera, 0, 0);
  assert.ok(Math.abs(committedOrigin.x - previewOrigin.x) < 1e-6 && Math.abs(committedOrigin.y - previewOrigin.y) < 1e-6,
    'release keeps every pixel where the preview put it');
  assertCameraRendersViewBox(camera, { x: -580, y: -370, w: 1000, h: 660 });
  assert.equal(scene.getAttribute('transform'), null, 'still no compensation on #sceneLayer');
  assert.equal(svg.getAttribute('viewBox'), `-500 -330 1000 660`, 'the reference frame is untouched');
  assert.equal(grid.style.backgroundImage, gridStyleBefore,
    'panning never repaints the grid; it only moves with the camera');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('pinch preview and commit are the same camera matrix, with no mid-gesture viewBox writes', async () => {
  const { dom, errors } = createEditorDom();
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  assertSingleCameraSurface(dom.window.document);
  const camera = dom.window.document.querySelector('#cameraLayer');
  const scene = dom.window.document.querySelector('#sceneLayer');
  setCanvasRect(svg);
  const viewBoxWrites = trackViewBoxWrites(svg);
  const baseCameraMatrix = camera.getAttribute('transform');

  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 100 });
  dispatchPointer(dom.window, svg, 'pointermove', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 100 });
  await nextFrame(dom.window);

  assert.equal(viewBoxWrites.count, 0, 'the root viewBox stays the reference frame during a pinch');
  assert.notEqual(camera.style.transform, baseCameraMatrix,
    'the pinch preview moves the one camera surface');
  const previewScale = cameraScale(camera);
  assert.ok(previewScale > 1, 'pinching apart zooms in');
  const previewAnchor = projectWorldPoint(camera, 120, -80);
  const committedWidthBefore = dom.window.document.querySelector('#cameraW').value;

  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 100 });
  assert.equal(viewBoxWrites.count, 0, 'committing the pinch writes no viewBox either');
  const committedAnchor = projectWorldPoint(camera, 120, -80);
  assert.ok(Math.abs(committedAnchor.x - previewAnchor.x) < 1e-6 && Math.abs(committedAnchor.y - previewAnchor.y) < 1e-6,
    'the commit paints every world point at the exact same screen pixel as the preview');
  assert.equal(scene.getAttribute('transform'), null, 'no compensation transform is needed');
  // The logical camera the sidebar now reports must be the camera that was on
  // screen: the composited matrix scale and the committed viewBox width agree.
  const committedWidth = Number(dom.window.document.querySelector('#cameraW').value);
  assert.notEqual(committedWidthBefore, String(committedWidth));
  assert.equal(committedWidth, Math.round(VIEWPORT.width / previewScale), 'the committed camera matches the previewed matrix');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

// === In-app dialogs ===
// Native prompt/confirm/alert block the tab, ignore the document language and
// cannot be styled or focus-trapped. These tests pin the replacement contract:
// every destructive action asks inside the document, Escape cancels, focus
// returns to the trigger and the buttons are translated.

function nodeGroup(document, id) {
  return document.querySelector(`#node-${id}`);
}

test('destructive actions confirm inside the document and never call native confirm', async () => {
  const savedGraph = {
    nodes: [{ id: 'n1', label: 'Alpha', x: 0, y: 0 }],
    edges: [],
    settings: {},
  };
  const { dom, errors } = createEditorDom(savedGraph);
  await nextFrame(dom.window);
  const document = dom.window.document;
  // Fail loudly if any code path still reaches for the blocking native dialog.
  dom.window.confirm = () => { throw new Error('native confirm() was called'); };
  dom.window.alert = () => { throw new Error('native alert() was called'); };
  dom.window.prompt = () => { throw new Error('native prompt() was called'); };

  const clear = document.querySelector('#btnClear');
  clear.focus();
  clear.click();
  await nextFrame(dom.window);

  let dialog = document.querySelector('.app-dialog');
  assert.ok(dialog, 'clearing the graph opens an in-app dialog');
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(dialog.getAttribute('aria-labelledby'), 'appDialogTitle');
  assert.equal(dialog.querySelector('.app-dialog-title').textContent, 'Confirm', 'default language is English');
  assert.equal(document.activeElement, dialog.querySelector('[data-dialog-ok]'), 'confirm is focused by default');

  // Escape cancels, keeps the graph and returns focus to the trigger.
  dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextFrame(dom.window);
  assert.equal(document.querySelector('.app-dialog'), null, 'Escape closes the dialog');
  assert.match(document.querySelector('#statsPill').textContent, /^1 /, 'Escape keeps the graph');
  assert.equal(document.activeElement, clear, 'focus returns to the trigger');

  // Cancel button does the same.
  clear.click();
  await nextFrame(dom.window);
  document.querySelector('.app-dialog [data-dialog-cancel]').click();
  await nextFrame(dom.window);
  assert.equal(document.querySelector('.app-dialog'), null);
  assert.match(document.querySelector('#statsPill').textContent, /^1 /);

  // Backdrop click cancels too.
  clear.click();
  await nextFrame(dom.window);
  dialog = document.querySelector('.app-dialog');
  dialog.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
  await nextFrame(dom.window);
  assert.equal(document.querySelector('.app-dialog'), null);
  assert.match(document.querySelector('#statsPill').textContent, /^1 /);

  // Confirming clears the graph.
  clear.click();
  await nextFrame(dom.window);
  document.querySelector('.app-dialog [data-dialog-ok]').click();
  await nextFrame(dom.window);
  assert.equal(document.querySelector('.app-dialog'), null, 'confirm closes the dialog');
  assert.match(document.querySelector('#statsPill').textContent, /^0 /, 'confirm clears the graph');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('double-clicking a node edits its label in an in-app prompt', async () => {
  const savedGraph = {
    nodes: [{ id: 'n1', label: 'Alpha', x: 0, y: 0 }],
    edges: [],
    settings: {},
  };
  const { dom, errors } = createEditorDom(savedGraph);
  await nextFrame(dom.window);
  const document = dom.window.document;
  dom.window.confirm = () => { throw new Error('native confirm() was called'); };
  dom.window.alert = () => { throw new Error('native alert() was called'); };
  dom.window.prompt = () => { throw new Error('native prompt() was called'); };

  const group = nodeGroup(document, 'n1');
  assert.ok(group, 'node group is rendered');
  group.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await nextFrame(dom.window);

  const dialog = document.querySelector('.app-dialog');
  assert.ok(dialog, 'double-click opens an in-app prompt');
  const input = dialog.querySelector('.app-dialog-input');
  assert.ok(input, 'the prompt has a text field');
  assert.equal(input.value, 'Alpha', 'the field is prefilled with the current label');
  assert.equal(document.activeElement, input, 'the field is focused');

  // Escape leaves the label untouched.
  dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextFrame(dom.window);
  assert.equal(document.querySelector('.app-dialog'), null);
  assert.match(nodeGroup(document, 'n1').textContent, /Alpha/);

  // Submitting writes the new label through the normal graph path.
  group.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await nextFrame(dom.window);
  const field = document.querySelector('.app-dialog .app-dialog-input');
  field.value = 'Renamed';
  document.querySelector('.app-dialog form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await nextFrame(dom.window);

  assert.equal(document.querySelector('.app-dialog'), null, 'submitting closes the prompt');
  assert.match(nodeGroup(document, 'n1').textContent, /Renamed/, 'the node renders the new label');
  assert.doesNotMatch(nodeGroup(document, 'n1').textContent, /Alpha/);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('dialog keys keep working after focus leaves the dialog', async () => {
  const savedGraph = {
    nodes: [{ id: 'n1', label: 'Alpha', x: 0, y: 0 }],
    edges: [],
    settings: {},
  };
  const { dom, errors } = createEditorDom(savedGraph);
  await nextFrame(dom.window);
  const document = dom.window.document;
  const clear = document.querySelector('#btnClear');

  // Clicking a dialog's own title or message parks focus on <body> in real
  // browsers. Escape and the Tab trap must still work from there.
  clear.focus();
  clear.click();
  await nextFrame(dom.window);
  let dialog = document.querySelector('.app-dialog');
  assert.ok(dialog);
  dialog.querySelector('.app-dialog-title').click();
  document.activeElement.blur();
  assert.equal(document.activeElement, document.body, 'focus is outside the dialog');

  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextFrame(dom.window);
  assert.equal(document.querySelector('.app-dialog'), null, 'Escape closes the dialog even from <body>');
  assert.match(document.querySelector('#statsPill').textContent, /^1 /, 'the graph is untouched');

  // Tab from outside the dialog pulls focus back in instead of escaping it.
  clear.focus();
  clear.click();
  await nextFrame(dom.window);
  dialog = document.querySelector('.app-dialog');
  document.activeElement.blur();
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  assert.equal(dialog.contains(document.activeElement), true, 'Tab re-enters the dialog');
  assert.equal(document.activeElement, dialog.querySelector('[data-dialog-cancel]'), 'forward Tab lands on the first control');

  // Focus pulled out by the page itself is redirected back inside.
  const outside = document.querySelector('#btnLang');
  outside.focus();
  assert.equal(dialog.contains(document.activeElement), true, 'focus cannot leave an open dialog');

  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextFrame(dom.window);
  assert.equal(document.activeElement, clear, 'focus returns to the trigger after closing');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('the prompt field carries the dialog title as its accessible name', async () => {
  const savedGraph = {
    nodes: [{ id: 'n1', label: 'Alpha', x: 0, y: 0 }],
    edges: [],
    settings: {},
  };
  const { dom, errors } = createEditorDom(savedGraph);
  await nextFrame(dom.window);
  const document = dom.window.document;

  nodeGroup(document, 'n1').dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await nextFrame(dom.window);

  const dialog = document.querySelector('.app-dialog');
  const input = dialog.querySelector('.app-dialog-input');
  assert.equal(input.getAttribute('aria-label'), 'Node label:', 'the field is named');
  assert.equal(dialog.querySelectorAll('label').length, 0, 'no empty <label> wrapping the field');
  assert.equal(dialog.getAttribute('aria-labelledby'), 'appDialogTitle');

  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextFrame(dom.window);
  assert.equal(document.querySelector('.app-dialog'), null);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('dialog copy follows the document language', async () => {
  const savedGraph = {
    nodes: [{ id: 'n1', label: 'Alpha', x: 0, y: 0 }],
    edges: [],
    settings: {},
  };
  const { dom, errors } = createEditorDom(savedGraph);
  await nextFrame(dom.window);
  const document = dom.window.document;

  // Default UI language is English; switch to Russian and the dialog follows.
  document.querySelector('#btnLang').click();
  await nextFrame(dom.window);

  document.querySelector('#btnClear').click();
  await nextFrame(dom.window);

  const dialog = document.querySelector('.app-dialog');
  assert.ok(dialog, 'the confirmation still opens after a language switch');
  assert.equal(dialog.querySelector('.app-dialog-title').textContent, 'Подтверждение');
  assert.equal(dialog.querySelector('[data-dialog-cancel]').textContent, 'Отмена');
  assert.equal(dialog.querySelector('[data-dialog-ok]').textContent, 'Очистить');
  dialog.querySelector('[data-dialog-ok]').click();
  await nextFrame(dom.window);

  assert.equal(document.querySelector('.app-dialog'), null);
  assert.match(document.querySelector('#statsPill').textContent, /^0 /);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
