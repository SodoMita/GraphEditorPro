import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');
const REFERENCE_VIEWBOX = { x: -500, y: -330, w: 1000, h: 660 };
const VIEWPORT = { width: 1000, height: 660 };

function createEditorDom(savedGraph = null) {
  const errors = [];
  const preload = savedGraph
    ? `localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(savedGraph))});`
    : '';
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
        media: query, matches: false, onchange: null,
        addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {}, dispatchEvent() { return true; },
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
      const canvasRect = () => ({
        x: 0, y: 0, left: 0, top: 0,
        width: VIEWPORT.width, height: VIEWPORT.height,
        right: VIEWPORT.width, bottom: VIEWPORT.height,
        toJSON() { return this; },
      });
      const proto = window.Element.prototype;
      const originalRect = proto.getBoundingClientRect;
      proto.getBoundingClientRect = function () {
        if (this.id === 'canvasWrap' || this.id === 'graphCanvas' || this.id === 'gridLayer') return canvasRect();
        return originalRect.call(this);
      };
    },
  });
  return { dom, errors };
}

function setCanvasRect(svg) {
  const rect = () => ({
    x: 0, y: 0, left: 0, top: 0,
    width: VIEWPORT.width, height: VIEWPORT.height,
    right: VIEWPORT.width, bottom: VIEWPORT.height,
    toJSON() { return this; },
  });
  svg.getBoundingClientRect = rect;
  for (const id of ['canvasWrap', 'gridLayer']) {
    const el = svg.ownerDocument.getElementById(id);
    if (el) el.getBoundingClientRect = rect;
  }
}

function dispatchPointer(window, target, type, options) {
  const event = new window.MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0,
    clientX: options.clientX, clientY: options.clientY,
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId },
    pointerType: { value: options.pointerType ?? 'mouse' },
  });
  target.dispatchEvent(event);
}

const nextFrame = window => new Promise(resolve => window.setTimeout(resolve, 30));
const settle = (window, ms = 260) => new Promise(resolve => window.setTimeout(resolve, ms));

function parseMatrix(raw, label) {
  const match = raw?.match(/^matrix\(([^)]+)\)$/);
  assert.ok(match, `expected a 2D matrix on ${label}, got ${JSON.stringify(raw)}`);
  const [scale, skewX, skewY, scaleY, tx, ty] = match[1].trim().split(/[ ,]+/).map(Number);
  assert.equal(skewX, 0, `${label} matrix has no rotation`);
  assert.equal(skewY, 0, `${label} matrix has no rotation`);
  assert.equal(scale, scaleY, `${label} matrix scales uniformly`);
  return { scale, tx, ty };
}

function cameraMatrix(camera) {
  const raw = camera.getAttribute('transform');
  return raw ? parseMatrix(raw, '#cameraLayer') : { scale: 1, tx: 0, ty: 0 };
}

function projectWorldPoint(camera, x, y) {
  const m = cameraMatrix(camera);
  const basePixels = Math.min(VIEWPORT.width / REFERENCE_VIEWBOX.w, VIEWPORT.height / REFERENCE_VIEWBOX.h);
  const offsetX = (VIEWPORT.width - REFERENCE_VIEWBOX.w * basePixels) / 2;
  const offsetY = (VIEWPORT.height - REFERENCE_VIEWBOX.h * basePixels) / 2;
  return {
    x: (m.scale * x + m.tx - REFERENCE_VIEWBOX.x) * basePixels + offsetX,
    y: (m.scale * y + m.ty - REFERENCE_VIEWBOX.y) * basePixels + offsetY,
  };
}

function smallGraph() {
  return {
    title: 'render-regressions',
    mode: 'select',
    nodes: [
      { id: 'a', label: 'Alpha', x: -200, y: 0 },
      { id: 'b', label: 'Beta', x: 200, y: 0 },
      { id: 'c', label: 'Gamma', x: 0, y: 200 },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'e2', from: 'b', to: 'c' },
    ],
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
}

// The grid paths are `M x y V y` / `M x y H x` segments in WORLD coordinates.
// Extract their bounding range so a test can prove the visible world rectangle
// is covered — a viewport-sized CSS gradient or SVG pattern can silently crop.
function gridRange(document) {
  const parse = id => {
    const d = document.getElementById(id).getAttribute('d') || '';
    const numbers = [...d.matchAll(/[MH]\s*(-?[\d.]+)\s+(-?[\d.]+)|V\s*(-?[\d.]+)|H\s*(-?[\d.]+)/g)];
    const xs = [], ys = [];
    for (const match of numbers) {
      if (match[1] !== undefined) { xs.push(Number(match[1])); ys.push(Number(match[2])); }
      if (match[3] !== undefined) ys.push(Number(match[3]));
      if (match[4] !== undefined) xs.push(Number(match[4]));
    }
    assert.ok(xs.length && ys.length, `${id} paints both axes`);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), d };
  };
  const minor = parse('gridMinorLines');
  const major = parse('gridMajorLines');
  return {
    minor, major,
    x0: Math.min(minor.x0, major.x0), x1: Math.max(minor.x1, major.x1),
    y0: Math.min(minor.y0, major.y0), y1: Math.max(minor.y1, major.y1),
  };
}

function assertGridCoversViewport(document, camera, label) {
  const m = cameraMatrix(camera);
  const visibleX0 = (REFERENCE_VIEWBOX.x - m.tx) / m.scale;
  const visibleX1 = (REFERENCE_VIEWBOX.x + REFERENCE_VIEWBOX.w - m.tx) / m.scale;
  const visibleY0 = (REFERENCE_VIEWBOX.y - m.ty) / m.scale;
  const visibleY1 = (REFERENCE_VIEWBOX.y + REFERENCE_VIEWBOX.h - m.ty) / m.scale;
  const range = gridRange(document);
  assert.ok(range.x0 <= visibleX0 && range.x1 >= visibleX1,
    `${label}: grid x range [${range.x0}, ${range.x1}] must cover the visible world [${visibleX0}, ${visibleX1}]`);
  assert.ok(range.y0 <= visibleY0 && range.y1 >= visibleY1,
    `${label}: grid y range [${range.y0}, ${range.y1}] must cover the visible world [${visibleY0}, ${visibleY1}]`);
  const stepX = Number(document.getElementById('gridLayer').getAttribute('data-minor-x'));
  const stepY = Number(document.getElementById('gridLayer').getAttribute('data-minor-y'));
  assert.ok(stepX > 0 && stepY > 0, `${label}: decimated world steps are reported`);
  return { range, stepX, stepY };
}

test('far nodes and edges outside the reference frame stay inside the SVG viewport', async () => {
  const graph = {
    title: 'Far',
    nodes: [
      { id: 'far1', label: 'FarA', x: 1600, y: 0 },
      { id: 'far2', label: 'FarB', x: -1600, y: 0 },
      { id: 'zero', label: 'Zero', x: 0, y: 0 },
    ],
    edges: [{ id: 'e1', from: 'far2', to: 'zero' }, { id: 'e2', from: 'zero', to: 'far1' }],
    viewBox: { x: -2500, y: -1200, w: 5000, h: 2400 },
  };
  const { dom, errors } = createEditorDom(graph);
  await nextFrame(dom.window);
  const document = dom.window.document;
  const svg = document.getElementById('graphCanvas');
  const camera = document.getElementById('cameraLayer');
  setCanvasRect(svg);

  // Root cause of the vanishing nodes/edges: transforming an HTML wrapper
  // around the <svg> only moves the already-clipped SVG viewport.
  assert.equal(camera.tagName.toLowerCase(), 'g', 'the camera is an SVG group');
  assert.ok(svg.contains(camera), 'the camera lives inside the SVG');
  assert.equal(svg.parentElement.id, 'canvasWrap', 'the SVG has no camera wrapper');
  assert.equal(svg.parentElement.style.transform, '', 'no ancestor CSS transform clips the root viewBox');
  assert.equal(svg.getAttribute('viewBox'), '-500 -330 1000 660', 'the root viewBox is the fixed reference frame');
  assert.equal(svg.getAttribute('preserveAspectRatio'), 'xMidYMid meet');

  for (const id of ['far1', 'far2', 'zero']) {
    assert.ok(document.getElementById(`node-${id}`), `node ${id} is rendered`);
  }
  assert.equal(document.querySelectorAll('#edgesLayer > *').length, 2, 'both far edges are rendered');
  // The camera matrix must map those far world points INTO the visible frame.
  for (const [id, x, y] of [['far1', 1600, 0], ['far2', -1600, 0], ['zero', 0, 0]]) {
    const p = projectWorldPoint(camera, x, y);
    assert.ok(p.x > 0 && p.x < VIEWPORT.width && p.y > 0 && p.y < VIEWPORT.height,
      `${id} projects inside the SVG viewport (${p.x}, ${p.y})`);
  }
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('grid paths cover the visible world at rest, zoom, pan, and pinch', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const window = dom.window, document = window.document;
  const svg = document.getElementById('graphCanvas');
  const camera = document.getElementById('cameraLayer');
  setCanvasRect(svg);

  assert.equal(document.getElementById('gridLines').parentElement.id, 'sceneLayer',
    'the grid is world-space geometry inside the camera scene');
  assert.equal(document.getElementById('gridLayer').parentElement.id, 'canvasWrap',
    'the static backdrop is outside the camera');
  assertGridCoversViewport(document, camera, 'at rest');

  // Zoom out hard: the pitch decimates, but the paths must still cover the view.
  for (let i = 0; i < 12; i++) {
    svg.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 250, clientY: 165, deltaY: 100 }));
  }
  await nextFrame(window);
  assertGridCoversViewport(document, camera, 'mid zoom-out preview');
  await settle(window);
  assertGridCoversViewport(document, camera, 'after zoom-out commit');

  // Pan: no blank strip may appear at the leading edge of the gesture.
  document.getElementById('modeMove').click();
  dispatchPointer(window, svg, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 330 });
  for (let i = 1; i <= 5; i++) {
    dispatchPointer(window, svg, 'pointermove', { pointerId: 1, clientX: 500 + i * 60, clientY: 330 + i * 20 });
    await nextFrame(window);
    assertGridCoversViewport(document, camera, `mid pan ${i}`);
  }
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 800, clientY: 430 });
  assertGridCoversViewport(document, camera, 'after pan commit');

  // Pinch zoom: same world-space paths, still covering the viewport.
  dispatchPointer(window, svg, 'pointerdown', { pointerId: 10, pointerType: 'touch', clientX: 300, clientY: 330 });
  dispatchPointer(window, svg, 'pointerdown', { pointerId: 11, pointerType: 'touch', clientX: 700, clientY: 330 });
  dispatchPointer(window, svg, 'pointermove', { pointerId: 11, pointerType: 'touch', clientX: 820, clientY: 330 });
  await nextFrame(window);
  assertGridCoversViewport(document, camera, 'mid pinch');
  dispatchPointer(window, svg, 'pointerup', { pointerId: 11, pointerType: 'touch', clientX: 820, clientY: 330 });
  dispatchPointer(window, svg, 'pointerup', { pointerId: 10, pointerType: 'touch', clientX: 300, clientY: 330 });
  assertGridCoversViewport(document, camera, 'after pinch');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('preview and commit paint the same pixels and the same grid phase, with no one-frame jump', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const window = dom.window, document = window.document;
  const svg = document.getElementById('graphCanvas');
  const camera = document.getElementById('cameraLayer');
  const backdrop = document.getElementById('gridLayer');
  setCanvasRect(svg);

  const snapshot = label => ({
    label,
    matrix: camera.getAttribute('transform'),
    minor: document.getElementById('gridMinorLines').getAttribute('d'),
    major: document.getElementById('gridMajorLines').getAttribute('d'),
    backdropTransform: backdrop.style.transform,
    backdropBackground: backdrop.style.backgroundImage,
    origin: projectWorldPoint(camera, 0, 0),
    far: projectWorldPoint(camera, -1600, 900),
  });
  const samePixels = (a, b) => {
    assert.equal(b.matrix, a.matrix, `${b.label}: the camera matrix is unchanged at the handoff`);
    assert.equal(b.minor, a.minor, `${b.label}: minor grid phase is unchanged at the handoff`);
    assert.equal(b.major, a.major, `${b.label}: major grid phase is unchanged at the handoff`);
    for (const key of ['origin', 'far']) {
      assert.ok(Math.abs(a[key].x - b[key].x) < 1e-9 && Math.abs(a[key].y - b[key].y) < 1e-9,
        `${b.label}: ${key} stays on exactly the same pixel`);
    }
    assert.equal(b.backdropTransform, a.backdropTransform, `${b.label}: no CSS counter-transform appears`);
    assert.equal(b.backdropBackground, a.backdropBackground, `${b.label}: no CSS gradient is repainted`);
  };

  // Wheel: several bursts, checking every preview -> commit handoff.
  for (let burst = 0; burst < 3; burst++) {
    for (let i = 0; i < 3; i++) {
      svg.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 250 + burst * 30, clientY: 165, deltaY: burst % 2 ? 100 : -100 }));
    }
    await nextFrame(window);
    const preview = snapshot(`wheel burst ${burst} preview`);
    await settle(window);
    samePixels(preview, snapshot(`wheel burst ${burst} commit`));
  }

  // Pan: a live preview must hand off to the identical commit.
  document.getElementById('modeMove').click();
  dispatchPointer(window, svg, 'pointerdown', { pointerId: 1, clientX: 200, clientY: 200 });
  dispatchPointer(window, svg, 'pointermove', { pointerId: 1, clientX: 380, clientY: 260 });
  await nextFrame(window);
  const panPreview = snapshot('pan preview');
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 380, clientY: 260 });
  samePixels(panPreview, snapshot('pan commit'));

  // Pinch: same guarantee for the multi-pointer path.
  dispatchPointer(window, svg, 'pointerdown', { pointerId: 10, pointerType: 'touch', clientX: 300, clientY: 330 });
  dispatchPointer(window, svg, 'pointerdown', { pointerId: 11, pointerType: 'touch', clientX: 700, clientY: 330 });
  dispatchPointer(window, svg, 'pointermove', { pointerId: 11, pointerType: 'touch', clientX: 840, clientY: 330 });
  await nextFrame(window);
  const pinchPreview = snapshot('pinch preview');
  dispatchPointer(window, svg, 'pointerup', { pointerId: 11, pointerType: 'touch', clientX: 840, clientY: 330 });
  dispatchPointer(window, svg, 'pointerup', { pointerId: 10, pointerType: 'touch', clientX: 300, clientY: 330 });
  samePixels(pinchPreview, snapshot('pinch commit'));
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('grid lines stay locked to world coordinates and never re-phase on a commit', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const window = dom.window, document = window.document;
  const svg = document.getElementById('graphCanvas');
  setCanvasRect(svg);

  const verticalLines = () => {
    const d = document.getElementById('gridMinorLines').getAttribute('d') || '';
    return [...d.matchAll(/M\s*(-?[\d.]+)\s+-?[\d.]+\s+V/g)].map(match => Number(match[1]));
  };
  const majorVerticalLines = () => {
    const d = document.getElementById('gridMajorLines').getAttribute('d') || '';
    return [...d.matchAll(/M\s*(-?[\d.]+)\s+-?[\d.]+\s+V/g)].map(match => Number(match[1]));
  };
  const assertWorldLocked = label => {
    const step = Number(document.getElementById('gridLayer').getAttribute('data-minor-x'));
    const majorStep = Number(document.getElementById('gridLayer').getAttribute('data-major-x'));
    const lines = verticalLines();
    const majors = majorVerticalLines();
    assert.ok(lines.length && majors.length, `${label}: both line sets are painted`);
    for (const x of lines) assert.ok(x % step === 0, `${label}: minor line ${x} is a multiple of the world step ${step}`);
    for (const x of majors) assert.ok(x % majorStep === 0, `${label}: major line ${x} is a multiple of the major step ${majorStep}`);
    assert.ok(majors.includes(0), `${label}: world origin stays on a major line (no phase jump)`);
    return { step, majors };
  };

  const atRest = assertWorldLocked('at rest');
  for (let i = 0; i < 6; i++) {
    svg.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: -100 }));
  }
  await nextFrame(window);
  const preview = assertWorldLocked('wheel preview');
  await settle(window);
  const commit = assertWorldLocked('wheel commit');
  assert.equal(commit.step, preview.step, 'the commit does not re-pitch the grid');
  assert.deepEqual(commit.majors, preview.majors, 'the commit does not shift a single grid line');
  assert.ok(atRest.step === 40 && preview.step >= 40, 'decimation only ever widens whole world cells');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
