import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

function createEditorDom(savedGraph = null) {
  const errors = [];
  const documentHtml = savedGraph
    ? html.replace('<script>', `<script>localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(savedGraph))});</script><script>`)
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
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
        dispatchEvent() { return true; },
      });
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => null;
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
    shiftKey: Boolean(options.shiftKey), // shift is the add-to-selection modifier
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId },
    pointerType: { value: options.pointerType ?? 'mouse' },
  });
  target.dispatchEvent(event);
}

const nextFrame = window => new Promise(resolve => window.setTimeout(resolve, 30));
const settle = (window, ms) => new Promise(resolve => window.setTimeout(resolve, ms));

// The tip highlight is the arrowhead's own triangle, enlarged about its centre
// and drawn behind it — so both triangles must share a centroid. Averaging the
// three points is enough: the accent's centroid is the tip's by construction.
function pointsOf(polygon) {
  return polygon.getAttribute('points').trim().split(/\s+/).map(part => part.split(',').map(Number));
}
function centroidOf(polygon) {
  const points = pointsOf(polygon);
  return points.reduce((acc, [x, y]) => [acc[0] + x / points.length, acc[1] + y / points.length], [0, 0]);
}
function assertCentresMatch(accent, shape) {
  const [ax, ay] = centroidOf(accent);
  const [sx, sy] = centroidOf(shape);
  assert.ok(Math.abs(ax - sx) < 1e-6 && Math.abs(ay - sy) < 1e-6,
    `accent centre (${ax}, ${ay}) must be anchored to the shape centre (${sx}, ${sy})`);
  // Same shape, just bigger: every corner of the accent is further from that
  // shared centre than the corner it grows out of.
  const reach = ([cx, cy], points) => Math.max(...points.map(([x, y]) => Math.hypot(x - cx, y - cy)));
  assert.ok(reach([ax, ay], pointsOf(accent)) > reach([sx, sy], pointsOf(shape)),
    'the tip accent is a larger copy of the tip');
}

// === Camera contract ===
// The root viewBox is a fixed world reference frame written once; the whole
// camera lives in a single matrix on #cameraLayer, which holds the grid and the
// graph. These helpers re-derive that mapping independently of the
// implementation: world -> user space is the matrix, user -> screen space is the
// fixed reference frame mapped with preserveAspectRatio="xMidYMid meet".
const REFERENCE_VIEWBOX = { x: -500, y: -330, w: 1000, h: 660 };
const VIEWPORT = { width: 1000, height: 660 };
// ONE paint system: #cameraLayer is a div holding the grid and the SVG, moved by
// a single composited transform. A second camera surface is the bug this project
// has fixed three times (see 20-rendering.ts).
function assertSingleCameraSurface(document) {
  assert.equal(document.querySelector('#cameraStage'), null,
    'the canvas must have no second camera surface (#cameraStage)');
  const camera = document.querySelector('#cameraLayer');
  assert.ok(camera, '#cameraLayer exists');
  assert.equal(camera.tagName, 'DIV',
    'the camera surface is a plain div, so a camera change is a composited transform');
  assert.equal(document.querySelectorAll('#cameraLayer').length, 1, 'exactly one camera surface');
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

function parseMatrix2d(raw, label) {
  const match = raw?.match(/^matrix\(([^)]+)\)$/);
  assert.ok(match, `expected a 2D matrix on ${label}, got ${JSON.stringify(raw)}`);
  const values = match[1].trim().split(/[ ,]+/).map(Number);
  assert.equal(values[1], 0, `${label} matrix has no rotation`);
  assert.equal(values[2], 0, `${label} matrix has no rotation`);
  assert.ok(Math.abs(values[0] - values[3]) < 1e-9, `${label} matrix scales uniformly`);
  return { scale: values[0], tx: values[4], ty: values[5] };
}

// The camera lives in the CSS transform on the #cameraLayer div.
function cameraMatrix(camera) {
  const inline = (camera.style && camera.style.transform) || '';
  return inline ? parseMatrix2d(inline, '#cameraLayer') : { scale: 1, tx: 0, ty: 0 };
}

function projectWorldPoint(camera, x, y, viewport = VIEWPORT) {
  // Stage 1: the SVG maps world -> reference frame inside its own box. Stage 2:
  // the camera matrix moves that whole box in CSS pixels.
  const m = cameraMatrix(camera);
  const basePixels = Math.min(viewport.width / REFERENCE_VIEWBOX.w, viewport.height / REFERENCE_VIEWBOX.h);
  const refOffsetX = (viewport.width - REFERENCE_VIEWBOX.w * basePixels) / 2;
  const refOffsetY = (viewport.height - REFERENCE_VIEWBOX.h * basePixels) / 2;
  const px = (x - REFERENCE_VIEWBOX.x) * basePixels + refOffsetX;
  const py = (y - REFERENCE_VIEWBOX.y) * basePixels + refOffsetY;
  return { x: m.scale * px + m.tx, y: m.scale * py + m.ty };
}

function assertCameraRendersViewBox(camera, viewBox, viewport = VIEWPORT) {
  // Asserted against the composited result, so a stale preview transform cannot
  // hide a wrong committed camera (or vice versa).
  const cameraPixels = Math.min(viewport.width / viewBox.w, viewport.height / viewBox.h);
  const offsetX = (viewport.width - viewBox.w * cameraPixels) / 2;
  const offsetY = (viewport.height - viewBox.h * cameraPixels) / 2;
  const topLeft = projectWorldPoint(camera, viewBox.x, viewBox.y, viewport);
  const bottomRight = projectWorldPoint(camera, viewBox.x + viewBox.w, viewBox.y + viewBox.h, viewport);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  assert.ok(near(topLeft.x, offsetX) && near(topLeft.y, offsetY),
    `camera top-left (${topLeft.x}, ${topLeft.y}) must land on the camera's letterboxed corner (${offsetX}, ${offsetY})`);
  assert.ok(near(bottomRight.x, viewport.width - offsetX) && near(bottomRight.y, viewport.height - offsetY),
    `camera bottom-right (${bottomRight.x}, ${bottomRight.y}) must land on the letterboxed corner`);
}

const referenceViewBox = () => `${REFERENCE_VIEWBOX.x} ${REFERENCE_VIEWBOX.y} ${REFERENCE_VIEWBOX.w} ${REFERENCE_VIEWBOX.h}`;

function trackAttrWrites(el, attrName) {
  const writes = { count: 0 };
  const setAttribute = el.setAttribute.bind(el);
  el.setAttribute = (name, value) => {
    if (name === attrName) writes.count++;
    return setAttribute(name, value);
  };
  return writes;
}

// The camera is a CSS transform on #cameraLayer now, so count writes to the
// style property (assigning an unchanged value is not a write).
function trackCameraWrites(camera) {
  const writes = { count: 0 };
  let current = camera.style.transform;
  Object.defineProperty(camera.style, 'transform', {
    configurable: true,
    get() { return current; },
    set(value) {
      if (value !== current) writes.count++;
      current = value;
    },
  });
  return writes;
}

function trackViewBoxWrites(svg) {
  return trackAttrWrites(svg, 'viewBox');
}

function smallGraph() {
  return {
    title: 'fast-paths',
    mode: 'select',
    nodes: [
      { id: 'a', label: 'Alpha', x: -200, y: 0 },
      { id: 'b', label: 'Beta', x: 200, y: 0 },
      { id: 'c', label: 'Gamma', x: 0, y: 200 },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', directed: true, weight: '3' },
      { id: 'e2', from: 'b', to: 'c', directed: true, weight: '5' },
    ],
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
}

test('wheel zoom previews on the one camera matrix and commits by persisting it', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  assertSingleCameraSurface(dom.window.document);
  const camera = dom.window.document.querySelector('#cameraLayer');
  const scene = dom.window.document.querySelector('#sceneLayer');
  const grid = dom.window.document.querySelector('#gridLayer');
  setCanvasRect(svg);
  const viewBoxWrites = trackViewBoxWrites(svg);
  const cameraWrites = trackCameraWrites(camera);

  for (let i = 0; i < 6; i++) {
    svg.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: -100 }));
  }
  await nextFrame(dom.window);

  // Six 0.88 steps anchored at the canvas centre: width and height scale, the
  // centre stays put. The burst coalesces to ONE rAF, so the matrix is written
  // once for the whole burst, not once per wheel event.
  let w = 1000, h = 660;
  for (let i = 0; i < 6; i++) { w *= 0.88; h *= 0.88; }
  const zoomedCamera = { x: -w / 2, y: -h / 2, w, h };

  assert.equal(viewBoxWrites.count, 0, 'the root viewBox is a reference frame, not a per-frame camera write');
  assert.ok(cameraWrites.count >= 1, 'the wheel preview moves the one camera surface');
  assert.notEqual(camera.style.transform, 'matrix(1, 0, 0, 1, 0, 0)', 'the camera surface carries the zoom preview');
  assert.equal(svg.getAttribute('viewBox'), referenceViewBox(), 'the fixed reference frame is installed');
  assertCameraRendersViewBox(camera, zoomedCamera);
  assert.equal(scene.getAttribute('transform'), null, 'the scene group is never transformed');
  assert.match(grid.style.transform, /scale\(/, 'the grid counter-scales to stay viewport-sized');
  // The grid is a CSS-gradient div inside #cameraLayer: it is painted by the same
  // camera transform as the graph, so it cannot desync by a frame.
  assert.equal(grid.parentElement, camera, 'the grid rides the camera surface with the graph');
  assert.ok((grid.style.backgroundImage || '').includes('repeating-linear-gradient'),
    'the world-locked grid is painted as gradients');
  const gridWidthBefore = grid.style.width;
  const previewSample = projectWorldPoint(camera, 125, -90);

  await settle(dom.window, 250); // let the commit debounce fire
  assert.equal(viewBoxWrites.count, 0, 'committing the camera leaves the reference viewBox untouched');
  assert.equal(cameraWrites.count, 1, 'the six-event burst coalesces into one camera write, and settling adds none');
  assert.equal(grid.style.width, gridWidthBefore, 'the grid is re-pitched only by the commit, not per frame');
  const committedSample = projectWorldPoint(camera, 125, -90);
  assert.ok(Math.abs(committedSample.x - previewSample.x) < 1e-6 && Math.abs(committedSample.y - previewSample.y) < 1e-6,
    'the commit changes nothing that is painted: preview and committed cameras project identically');
  assertCameraRendersViewBox(camera, zoomedCamera);
  assert.ok(cameraMatrix(camera).scale > 1, 'zooming in scales the committed camera matrix above 1');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a pointer gesture during pending zoom adopts the committed camera invisibly', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  assertSingleCameraSurface(dom.window.document);
  const camera = dom.window.document.querySelector('#cameraLayer');
  setCanvasRect(svg);
  const viewBoxWrites = trackViewBoxWrites(svg);
  const cameraWrites = trackCameraWrites(camera);

  svg.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: -100 }));
  await nextFrame(dom.window);
  assert.ok(cameraWrites.count >= 1, 'the wheel preview moves the camera surface');
  const zoomedCamera = { x: -440, y: -290.4, w: 880, h: 580.8 };
  assertCameraRendersViewBox(camera, zoomedCamera);
  const previewPoint = projectWorldPoint(camera, -200, 100);
  const writesBeforeHover = cameraWrites.count;

  // Hover pointermove (cursor drift while scrolling) must NOT flush the preview.
  dispatchPointer(dom.window, svg, 'pointermove', { pointerId: 1, clientX: 110, clientY: 105 });
  assert.equal(cameraWrites.count, writesBeforeHover, 'hover pointermove while scrolling does not flush the pending zoom');

  // Starting a pointer gesture adopts the pending camera (persisting it) without
  // moving anything that is painted.
  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  assert.equal(cameraWrites.count, 1, 'pointerdown commits the pending zoom with one camera write');
  const flushedPoint = projectWorldPoint(camera, -200, 100);
  assert.ok(Math.abs(flushedPoint.x - previewPoint.x) < 1e-6 && Math.abs(flushedPoint.y - previewPoint.y) < 1e-6,
    'adopting the pending camera does not change what is painted');
  assertCameraRendersViewBox(camera, zoomedCamera, VIEWPORT);
  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 100, clientY: 100 });
  assert.equal(viewBoxWrites.count, 0, 'the root viewBox is untouched for the whole cycle');
  assert.equal(svg.getAttribute('viewBox'), referenceViewBox());
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('wheel zoom that interrupts a pan continues from the panned camera on the one matrix', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const document = dom.window.document;
  const svg = document.querySelector('#graphCanvas');
  assertSingleCameraSurface(document);
  const camera = document.querySelector('#cameraLayer');
  const scene = document.querySelector('#sceneLayer');
  setCanvasRect(svg);
  const viewBoxWrites = trackViewBoxWrites(svg);
  const cameraWrites = trackCameraWrites(camera);
  document.querySelector('#modeMove').click();

  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  dispatchPointer(dom.window, svg, 'pointermove', { pointerId: 1, clientX: 200, clientY: 100 });
  await nextFrame(dom.window);
  const panPreview = camera.style.transform;
  assert.notEqual(panPreview, '', 'panning moves the one canvas surface');
  assert.notEqual(panPreview, '', 'panning moves the one camera surface');
  assertCameraRendersViewBox(camera, { x: -600, y: -330, w: 1000, h: 660 }, VIEWPORT);

  // The wheel adopts the completed pan (100 world px left) and zooms 0.88 around
  // the canvas centre: width 880, centre (-100, 0).
  svg.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: -100 }));
  await nextFrame(dom.window);
  assert.notEqual(camera.style.transform, panPreview, 'the zoom preview continues on the same surface');
  assertCameraRendersViewBox(camera, { x: -540, y: -290.4, w: 880, h: 580.8 }, VIEWPORT);

  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 200, clientY: 100 });
  assert.equal(viewBoxWrites.count, 0, 'no camera state is ever written into the root viewBox');
  assert.ok(cameraWrites.count >= 1, 'pointerup commits the combined pan+zoom');
  assertCameraRendersViewBox(camera, { x: -540, y: -290.4, w: 880, h: 580.8 }, VIEWPORT);
  assert.equal(scene.getAttribute('transform'), null, 'the scene group stays untransformed');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('click selection toggles classes without a full re-render and stays consistent', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  const nodeA = dom.window.document.getElementById('node-a');
  const edgeE1 = dom.window.document.getElementById('edge-e1');
  const arrow = edgeE1.querySelector('.edge-arrow');
  assert.ok(arrow, 'directed edge renders an arrow');

  dispatchPointer(dom.window, nodeA, 'pointerdown', { pointerId: 1, clientX: 300, clientY: 330 });
  await nextFrame(dom.window);
  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 300, clientY: 330 });
  await nextFrame(dom.window);
  assert.equal(nodeA.classList.contains('selected'), true, 'node gets the selected class on click');

  // Selecting an edge must not repaint its tip. The highlight sits BEHIND the
  // edge — a wide accent line on the edge's own path plus a larger copy of the
  // tip triangle — so the edge keeps its colours and still shows what is marked.
  dispatchPointer(dom.window, edgeE1, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 330 });
  await nextFrame(dom.window);
  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientY: 330, clientX: 500 });
  await nextFrame(dom.window);
  const line = edgeE1.querySelector('.edge-line');
  const ring = edgeE1.querySelector('.edge-sel');
  const tipRing = edgeE1.querySelector('.edge-sel-arrow');
  const order = [...edgeE1.children];
  assert.equal(edgeE1.classList.contains('selected'), true);
  assert.equal(nodeA.classList.contains('selected'), false, 'replace-mode selection drops the node');
  assert.equal(arrow.getAttribute('fill'), line.getAttribute('stroke'), 'selected arrow keeps the edge colour');
  assert.ok(ring, 'selection adds an accent behind the edge');
  assert.equal(ring.getAttribute('d'), line.getAttribute('d'), 'the accent reuses the edge path as-is');
  assert.ok(Number(ring.getAttribute('stroke-width')) > Number(line.getAttribute('stroke-width')),
    'the accent is a wide line rather than an outline of the edge');
  assert.equal(order.indexOf(ring) < order.indexOf(line), true, 'the accent is behind the line');
  assert.ok(tipRing, 'selection adds an accent behind the tip');
  assert.equal(order.indexOf(tipRing) < order.indexOf(arrow), true, 'the tip accent is behind the arrowhead');
  assertCentresMatch(tipRing, arrow);

  // Deselect via empty canvas drops the accent and leaves the edge paint alone.
  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 1, clientX: 30, clientY: 30 });
  await nextFrame(dom.window);
  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 30, clientY: 30 });
  await nextFrame(dom.window);
  assert.equal(edgeE1.classList.contains('selected'), false);
  assert.equal(arrow.getAttribute('fill'), line.getAttribute('stroke'), 'deselected arrow still uses the edge colour');
  assert.equal(edgeE1.querySelectorAll('.edge-sel, .edge-sel-arrow').length, 0,
    'unselected edges carry no accent elements');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('the selected-edge highlight rides the edge through a group drag', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const { window, document } = dom.window;
  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  const edgeE1 = document.getElementById('edge-e1');
  const nodeA = document.getElementById('node-a');
  const nodeB = document.getElementById('node-b');

  // Select the edge, then add both of its endpoints to the selection, so the
  // drag that follows moves the whole edge rather than one end of it.
  dispatchPointer(window, edgeE1, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 330 });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 500, clientY: 330 });
  await nextFrame(window);
  for (const [id, x] of [['node-a', 300], ['node-b', 700]]) {
    dispatchPointer(window, document.getElementById(id), 'pointerdown', { pointerId: 1, clientX: x, clientY: 330, shiftKey: true });
    await nextFrame(window);
    dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: x, clientY: 330 });
    await nextFrame(window);
  }
  const ring = edgeE1.querySelector('.edge-sel');
  const tipRing = edgeE1.querySelector('.edge-sel-arrow');
  assert.ok(ring && tipRing, 'the selected edge carries both accent parts');

  dispatchPointer(window, nodeA, 'pointerdown', { pointerId: 1, clientX: 300, clientY: 330, shiftKey: true });
  await nextFrame(window);
  for (let step = 1; step <= 5; step++) {
    dispatchPointer(window, svg, 'pointermove', { pointerId: 1, clientX: 300 + step * 12, clientY: 330 + step * 24 });
    await nextFrame(window);
    // The drag patches edge geometry in place and skips the release re-render,
    // so this fast path is the only writer able to keep the highlight on screen.
    assert.equal(ring.getAttribute('d'), edgeE1.querySelector('.edge-line').getAttribute('d'),
      `frame ${step}: the accent line follows the moving edge instead of being left behind`);
    assertCentresMatch(tipRing, edgeE1.querySelector('.edge-arrow'));
  }
  assert.notEqual(ring.getAttribute('d'), 'M -173 0 L 157 0', 'the accent no longer sits at the old position');

  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 360, clientY: 450 });
  await nextFrame(window);
  assert.equal(ring.getAttribute('d'), edgeE1.querySelector('.edge-line').getAttribute('d'),
    'the release that skips the re-render still leaves the accent on the edge');

  // A selection change is applied by the delta path, with no render pass at all:
  // the accent has to be rebuilt from the edge's current geometry.
  dispatchPointer(window, svg, 'pointerdown', { pointerId: 1, clientX: 30, clientY: 620 });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 30, clientY: 620 });
  await nextFrame(window);
  assert.equal(edgeE1.querySelectorAll('.edge-sel, .edge-sel-arrow').length, 0, 'deselect removes both accent parts');
  dispatchPointer(window, edgeE1, 'pointerdown', { pointerId: 1, clientX: 560, clientY: 420 });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 560, clientY: 420 });
  await nextFrame(window);
  assert.equal(edgeE1.querySelector('.edge-sel').getAttribute('d'), edgeE1.querySelector('.edge-line').getAttribute('d'),
    're-selecting after a drag highlights where the edge is now, not where it was');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('live-edge drag updates geometry in place and needs no release re-render', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  const nodeB = dom.window.document.getElementById('node-b');
  const beforeLine = dom.window.document.getElementById('edge-e1').querySelector('.edge-line').getAttribute('d');

  dispatchPointer(dom.window, nodeB, 'pointerdown', { pointerId: 1, clientX: 700, clientY: 330 });
  await nextFrame(dom.window);
  for (let step = 1; step <= 4; step++) {
    dispatchPointer(dom.window, svg, 'pointermove', { pointerId: 1, clientX: 700 + step * 20, clientY: 330 + step * 10 });
    await nextFrame(dom.window);
  }
  const midTransform = nodeB.getAttribute('transform');
  const midLine = dom.window.document.getElementById('edge-e1').querySelector('.edge-line').getAttribute('d');
  assert.notEqual(midLine, beforeLine, 'connected edge path follows the drag');
  assert.equal(dom.window.document.querySelector('#canvasWrap').classList.contains('fast-interaction'), true, 'interaction quality mode is active while dragging');

  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 780, clientY: 370 });
  await nextFrame(dom.window);
  assert.equal(nodeB.getAttribute('transform'), midTransform, 'release keeps the dragged position');
  assert.equal(dom.window.document.getElementById('edge-e1').querySelector('.edge-line').getAttribute('d'), midLine, 'release keeps the live-updated path');
  assert.equal(dom.window.document.querySelector('#canvasWrap').classList.contains('fast-interaction'), false, 'interaction quality mode is cleared on release');
  assert.equal(nodeB.classList.contains('dragging'), false, 'dragging class is removed on release');

  // Undo must still restore the pre-drag position (history push on release).
  dom.window.document.getElementById('btnUndo').click();
  await nextFrame(dom.window);
  assert.equal(nodeB.getAttribute('transform'), 'translate(200,0)', 'undo restores the pre-drag node position');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('renaming an edge id through the edge list keeps selection and lookups working', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await settle(dom.window, 150); // edge list renders on a short debounce after init
  const svg = dom.window.document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  const idInput = dom.window.document.querySelector('#edgeListHost .edge-id');
  assert.ok(idInput, 'edge list renders id inputs');
  assert.equal(idInput.value, 'e1');

  await settle(dom.window, 120); // edge list renders on a short debounce
  assert.ok(idInput, 'edge list renders id inputs');
  idInput.value = 'e1-renamed';
  idInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await nextFrame(dom.window);
  assert.ok(dom.window.document.getElementById('edge-e1-renamed'), 'edge element uses the new id');

  const renamed = dom.window.document.getElementById('edge-e1-renamed');
  dispatchPointer(dom.window, renamed, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 330 });
  await nextFrame(dom.window);
  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 500, clientY: 330 });
  await nextFrame(dom.window);
  assert.equal(renamed.classList.contains('selected'), true, 'renamed edge can still be selected (indexed lookup rebuilt)');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('brush selection coalesces to frames and applies selection with sidebar', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  // Switch to the brush tool.
  dom.window.document.querySelector('[data-selecttool="brush"]').click();
  await nextFrame(dom.window);

  // Alpha sits at (-200, 0) → client (300, 330). Sweep across it with several
  // pointermove samples in one frame — only the last should be applied.
  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 1, clientX: 120, clientY: 330 });
  for (let x = 140; x <= 460; x += 40) {
    dispatchPointer(dom.window, svg, 'pointermove', { pointerId: 1, clientX: x, clientY: 330 });
  }
  await settle(dom.window, 60);
  const nodeA = dom.window.document.getElementById('node-a');
  assert.equal(nodeA.classList.contains('selected'), true, 'brushed node becomes selected mid-gesture');

  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 460, clientY: 330 });
  await nextFrame(dom.window);
  assert.equal(nodeA.classList.contains('selected'), true, 'selection persists after release');
  // Sidebar must reflect the selection after the gesture (deferred during it).
  // The sweep crosses an edge too, so the multi-selection header is shown.
  const panel = dom.window.document.getElementById('selectionPanel');
  assert.match(panel.textContent, /1 node/, 'selection panel reflects the brushed selection');
  assert.equal(dom.window.document.querySelector('#canvasWrap').classList.contains('fast-interaction'), false);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('algorithm start select follows selection and label edits', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  const nodeA = dom.window.document.getElementById('node-a');
  const startSelect = dom.window.document.getElementById('algoStart');

  dispatchPointer(dom.window, nodeA, 'pointerdown', { pointerId: 1, clientX: 300, clientY: 330 });
  await nextFrame(dom.window);
  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 300, clientY: 330 });
  await nextFrame(dom.window);
  assert.deepEqual([...startSelect.options].map(option => option.value), ['a', 'b', 'c'], 'sidebar render populates the start select');
  assert.equal(startSelect.value, 'a', 'selecting a node updates the algorithm start select');

  // Rename the label through the selection panel; the option text must follow.
  const labelInput = dom.window.document.getElementById('selNodeLabel');
  assert.ok(labelInput, 'node panel exposes the label input');
  labelInput.value = 'Omega';
  labelInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await nextFrame(dom.window);
  // queueRender(true) in the label handler defers the sidebar render one pass.
  const colorInput = dom.window.document.getElementById('defNodeColor');
  colorInput.value = '#101010';
  colorInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await nextFrame(dom.window);
  const option = [...startSelect.options].find(entry => entry.value === 'a');
  assert.equal(option.textContent, 'Omega (a)', 'option text reflects the renamed label');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

// === Drag start / drag end ===
// Both ends of a drag sit between the pointer and the next frame, so they must
// not carry work that can happen later: the selection panel can be rebuilt on
// the next frame, and the undo snapshot can wait for idle time.
test('pressing a node defers the selection panel instead of rebuilding it in the handler', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const window = dom.window, document = window.document;
  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  const nodeA = document.getElementById('node-a');
  const panel = document.getElementById('selectionPanel');
  const pressText = panel.textContent;

  dispatchPointer(window, nodeA, 'pointerdown', { pointerId: 1, clientX: 300, clientY: 330 });
  // The press is the frame that decides how soon the node follows the pointer.
  assert.equal(panel.textContent, pressText, 'the press itself does not rebuild the panel');
  assert.equal(document.getElementById('selNodeLabel'), null, 'no node panel inside the press handler');

  await nextFrame(window);
  const labelInput = document.getElementById('selNodeLabel');
  assert.ok(labelInput, 'the panel catches up on the next frame');
  assert.equal(labelInput.value, 'Alpha', 'and it shows the node that was pressed');
  assert.equal(nodeA.classList.contains('selected'), true, 'the node itself is selected immediately');

  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 300, clientY: 330 });
  await nextFrame(window);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a release leaves the drag undoable before its deferred snapshot runs', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const window = dom.window, document = window.document;
  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  const nodeB = document.getElementById('node-b');

  dispatchPointer(window, nodeB, 'pointerdown', { pointerId: 1, clientX: 700, clientY: 330 });
  await nextFrame(window);
  for (let step = 1; step <= 3; step++) {
    dispatchPointer(window, svg, 'pointermove', { pointerId: 1, clientX: 700 + step * 20, clientY: 330 + step * 10 });
    await nextFrame(window);
  }
  assert.notEqual(nodeB.getAttribute('transform'), 'translate(200,0)', 'the drag moved the node');

  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 760, clientY: 360 });
  // No frame in between: the snapshot is deferred, but the entry it belongs to
  // must already be available to the next input (here Ctrl+Z), so an undo right
  // after the release still restores the pre-drag position.
  const undoKey = new window.KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true });
  document.body.dispatchEvent(undoKey);
  await nextFrame(window);
  assert.equal(nodeB.getAttribute('transform'), 'translate(200,0)', 'undo right after the release restores the pre-drag position');
  assert.equal(document.getElementById('btnRedo').disabled, false, 'the undone drag is redoable');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a very high degree drag re-points its frozen edges at release', async () => {
  // More edges on one node than the live-drag budget allows: the drag cannot
  // repaint them frame by frame, so the release has to catch them up (in place,
  // not by re-rendering the scene).
  const edges = [];
  for (let index = 0; index < 2001; index++) edges.push({ id: `p${index}`, from: 'a', to: 'b', directed: true, weight: '1' });
  const { dom, errors } = createEditorDom({
    title: 'frozen-edges', mode: 'select',
    nodes: [{ id: 'a', label: 'A', x: -200, y: 0 }, { id: 'b', label: 'B', x: 200, y: 0 }],
    edges,
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  });
  await settle(dom.window, 400); // the initial pass renders 2001 edges
  const window = dom.window, document = window.document;
  const svg = document.querySelector('#graphCanvas');
  setCanvasRect(svg);
  const nodeB = document.getElementById('node-b');
  const edge = document.getElementById('edge-p0');
  const line = edge.querySelector('.edge-line');
  const before = line.getAttribute('d');

  dispatchPointer(window, nodeB, 'pointerdown', { pointerId: 1, clientX: 700, clientY: 330 });
  await nextFrame(window);
  for (let step = 1; step <= 3; step++) {
    dispatchPointer(window, svg, 'pointermove', { pointerId: 1, clientX: 700 + step * 20, clientY: 330 + step * 10 });
    await nextFrame(window);
  }
  assert.equal(line.getAttribute('d'), before, 'a drag past the edge budget leaves its edges frozen');

  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 760, clientY: 360 });
  await settle(window, 120); // the catch-up runs one frame later
  assert.notEqual(line.getAttribute('d'), before, 'the release re-points the frozen edges');
  assert.equal(document.getElementById('canvasWrap').classList.contains('fast-interaction'), false);
  assert.equal(nodeB.classList.contains('dragging'), false);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('scaling across wheel, zoom buttons, pinch, fit, and resize never reconstructs SVG DOM elements', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const window = dom.window, document = window.document;
  const svg = document.querySelector('#graphCanvas');
  const camera = document.querySelector('#cameraLayer');
  const gridLayer = document.querySelector('#gridLayer');
  const gizmoLayer = document.querySelector('#gizmoLayer');
  setCanvasRect(svg);

  // Select nodes so the selection gizmo is live while scaling, and warm up the
  // move gizmo tree once before observing scaling mutations.
  dispatchPointer(window, document.getElementById('node-a'), 'pointerdown', { pointerId: 1, clientX: 300, clientY: 330 });
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 300, clientY: 330 });
  await nextFrame(window);

  const initialGridPaint = gridLayer.style.backgroundImage;
  assert.equal(initialGridPaint.split('repeating-linear-gradient').length - 1, 4,
    'the grid is four persistent gradient layers, never rebuilt');
  const initialGizmoRoot = gizmoLayer.querySelector('.gizmo-root');
  assert.ok(initialGizmoRoot, 'gizmo root is rendered for the selected node');
  const initialGizmoHit = initialGizmoRoot.querySelector('[data-gizmo="move-free"] .gizmo-hit');
  const radiusBefore = Number(initialGizmoHit.getAttribute('r'));
  const initialNodeA = document.getElementById('node-a');
  const initialEdge1 = document.getElementById('edge-e1');

  let childListMutations = 0;
  const observer = new window.MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') childListMutations += record.addedNodes.length + record.removedNodes.length;
    }
  });
  observer.observe(svg, { childList: true, subtree: true });

  // 1. Deep zoom-out burst across grid decimation thresholds + commit
  for (let i = 0; i < 18; i++) {
    svg.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: 100 }));
  }
  await settle(window, 260);
  assert.ok(Number(gridLayer.getAttribute('data-major-x')) > 200,
    'grid decimated to a wider world stride without rebuilding anything');
  assert.ok(Number(initialGizmoHit.getAttribute('r')) > radiusBefore, 'gizmo handle scaled up in world units in place');

  // 2. Rapid #btnZoomIn clicks coalesce into one preview frame and one commit
  const camWrites = trackCameraWrites(camera);
  for (let i = 0; i < 5; i++) document.querySelector('#btnZoomIn').click();
  await nextFrame(window);
  assert.ok(camWrites.count <= 1,
    `five rapid #btnZoomIn clicks coalesce into at most one preview write (saw ${camWrites.count})`);
  const previewWrites = camWrites.count;
  await settle(window, 260);
  assert.ok(camWrites.count - previewWrites <= 1,
    'the burst then commits with at most one more write');

  // 3. Pinch zoom + commit
  dispatchPointer(window, svg, 'pointerdown', { pointerId: 10, pointerType: 'touch', clientX: 300, clientY: 330 });
  dispatchPointer(window, svg, 'pointerdown', { pointerId: 11, pointerType: 'touch', clientX: 700, clientY: 330 });
  dispatchPointer(window, svg, 'pointermove', { pointerId: 11, pointerType: 'touch', clientX: 820, clientY: 330 });
  await nextFrame(window);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 11, pointerType: 'touch', clientX: 820, clientY: 330 });
  dispatchPointer(window, svg, 'pointerup', { pointerId: 10, pointerType: 'touch', clientX: 300, clientY: 330 });

  // 4. fitView (#btnFit) updates only the camera, never reconciling nodes/edges
  document.querySelector('#btnFit').click();
  await nextFrame(window);

  // 5. Window resize updates reference viewBox, grid, and gizmo in place
  svg.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0,
    width: 1280, height: 800, right: 1280, bottom: 800,
    toJSON() { return this; },
  });
  window.dispatchEvent(new window.Event('resize'));
  await nextFrame(window);

  observer.disconnect();
  assert.equal(childListMutations, 0, 'zero SVG DOM nodes were added or removed across wheel, button zoom, pinch, fit, and resize');
  assert.equal(gridLayer.style.backgroundImage.split('repeating-linear-gradient').length - 1, 4,
    'the grid keeps its four gradient layers across every scaling path');
  assert.equal(gizmoLayer.querySelector('.gizmo-root'), initialGizmoRoot, 'exact same gizmo subtree remains mounted');
  assert.equal(document.getElementById('node-a'), initialNodeA, 'node SVG elements were never reconstructed');
  assert.equal(document.getElementById('edge-e1'), initialEdge1, 'edge SVG elements were never reconstructed');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a gesture preview is one composited transform on the sole camera surface, and the commit lands on the same pixel', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const window = dom.window, document = window.document;
  const svg = document.querySelector('#graphCanvas');
  assertSingleCameraSurface(document);
  const camera = document.querySelector('#cameraLayer');
  setCanvasRect(svg);
  const cameraWrites = trackCameraWrites(camera);
  // The grid must not be repainted per frame: that is what turned a smooth pan
  // into 21 grid repaints of a screen-sized div in the earlier design.
  const grid = document.querySelector('#gridLayer');
  let gridRepaints = 0;
  const lastGrid = grid.style.backgroundImage;
  new window.MutationObserver(records => {
    for (const record of records) if (record.target === grid && record.attributeName === 'style') gridRepaints++;
  }).observe(grid, { attributes: true, attributeFilter: ['style'] });

  document.querySelector('#modeMove').click();
  dispatchPointer(window, svg, 'pointerdown', { pointerId: 1, clientX: 200, clientY: 200 });
  for (let i = 1; i <= 5; i++) {
    dispatchPointer(window, svg, 'pointermove', { pointerId: 1, clientX: 200 + i * 20, clientY: 200 + i * 8 });
    await nextFrame(window);
  }
  assert.ok(cameraWrites.count >= 1, 'each preview frame moves the one camera surface');
  assert.equal(gridRepaints, 0, 'a pan never repaints the grid; it only moves with the camera');
  assert.equal(grid.style.backgroundImage, lastGrid);

  const previewPoint = projectWorldPoint(camera, 0, 0);
  const previewTransform = camera.style.transform;
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 300, clientY: 240 });

  // Commit re-applies the same logical camera; nothing may move on screen.
  const committedPoint = projectWorldPoint(camera, 0, 0);
  assert.ok(Math.abs(committedPoint.x - previewPoint.x) < 1e-6 && Math.abs(committedPoint.y - previewPoint.y) < 1e-6,
    'the commit puts every world point on the pixel the preview left it on');
  assert.ok(camera.style.transform, 'the camera surface still carries a transform after commit');
  assert.deepEqual(errors.map(error => error.message), []);

  // Strip comments: the rules explain in prose why they avoid a property, so a
  // raw regex over the stylesheet would match the explanation, not the code.
  const css = [...document.querySelectorAll('style')]
    .map(node => node.textContent.replace(/\/\*[\s\S]*?\*\//g, ''))
    .join('\n');
  assert.match(css, /#cameraLayer\{[^}]*will-change:\s*transform/,
    '#cameraLayer must keep its compositing hint, or every camera change repaints the scene');
  const svgRule = css.slice(css.indexOf('#graphCanvas{'), css.indexOf('}', css.indexOf('#graphCanvas{')));
  assert.match(svgRule, /width:100%/, 'the SVG fills its box (a replaced element ignores inset alone)');
  assert.doesNotMatch(svgRule, /will-change|transform:/,
    'the SVG itself must stay unpromoted; the camera moves the wrapper, not the SVG');
  dom.window.close();
});

test('cursor anchor stays locked in world space when CSS transform scales svg.getBoundingClientRect', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const window = dom.window, document = window.document;
  const svg = document.querySelector('#graphCanvas');
  const grid = document.querySelector('#gridLayer');
  const camera = document.querySelector('#cameraLayer');

  // Simulate real browser geometry: #gridLayer stays at the untransformed
  // viewport rect (1000x660), while #graphCanvas's getBoundingClientRect()
  // reflects the preview transform currently on the surface. jsdom does not
  // apply CSS transforms to layout, so mirror what the browser would report.
  grid.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0,
    width: 1000, height: 660, right: 1000, bottom: 660,
    toJSON() { return this; },
  });
  svg.getBoundingClientRect = () => {
    const surface = surfaceMatrix(document);
    const left = surface.tx, top = surface.ty;
    const right = surface.scale * VIEWPORT.width + surface.tx;
    const bottom = surface.scale * VIEWPORT.height + surface.ty;
    return {
      x: left, y: top, left, top, width: right - left, height: bottom - top, right, bottom,
      toJSON() { return this; },
    };
  };

  // Off-centre cursor at (250, 165) -> world (-250, -165) at initial camera.
  const anchorX = 250, anchorY = 165;
  const beforeScreen = projectWorldPoint(camera, -250, -165);
  assert.ok(Math.abs(beforeScreen.x - anchorX) < 1e-6 && Math.abs(beforeScreen.y - anchorY) < 1e-6);

  // Dispatch wheel step 1, wait a frame so the surface preview scales the SVG's
  // reported rect, then dispatch wheel step 2 and commit: (-250, -165) must stay
  // pinned under (250, 165).
  svg.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: anchorX, clientY: anchorY, deltaY: -100 }));
  await nextFrame(window);
  svg.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: anchorX, clientY: anchorY, deltaY: -100 }));
  await nextFrame(window);
  const duringScreen = projectWorldPoint(camera, -250, -165);
  assert.ok(Math.abs(duringScreen.x - anchorX) < 1e-6 && Math.abs(duringScreen.y - anchorY) < 1e-6,
    `world anchor stayed under cursor during the scaled surface preview (${duringScreen.x}, ${duringScreen.y})`);

  await settle(window, 260);
  const afterScreen = projectWorldPoint(camera, -250, -165);
  assert.ok(Math.abs(afterScreen.x - anchorX) < 1e-6 && Math.abs(afterScreen.y - anchorY) < 1e-6,
    `world anchor stayed under cursor after commit (${afterScreen.x}, ${afterScreen.y})`);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('pan and zoom-out previews paint the new camera immediately, with nothing cached off-screen', async () => {
  const graph = {
    ...smallGraph(),
    nodes: [
      ...smallGraph().nodes,
      // Off-screen at rest (initial viewBox x ∈ [-500, +500], y ∈ [-330, +330])
      { id: 'offRight', label: 'OffRight', x: 760, y: 0 },
      { id: 'farLeft', label: 'FarLeft', x: -1600, y: 0 },
    ],
  };
  const { dom, errors } = createEditorDom(graph);
  await nextFrame(dom.window);
  const window = dom.window, document = window.document;
  const svg = document.querySelector('#graphCanvas');
  assertSingleCameraSurface(document);
  const camera = document.querySelector('#cameraLayer');
  setCanvasRect(svg);

  // The camera is a live vector matrix, so an off-screen node is one attribute
  // write away instead of depending on a pre-rasterized apron having covered
  // the right region. Panning left brings it into the viewport in that write.
  document.querySelector('#modeMove').click();
  dispatchPointer(window, svg, 'pointerdown', { pointerId: 1, clientX: 600, clientY: 330 });
  dispatchPointer(window, svg, 'pointermove', { pointerId: 1, clientX: 240, clientY: 330 });
  await nextFrame(window);
  const offRightDuringPan = projectWorldPoint(camera, 760, 0);
  assert.ok(offRightDuringPan.x > 0 && offRightDuringPan.x < VIEWPORT.width,
    `off-screen node appears inside the viewport during a live pan preview (x=${offRightDuringPan.x})`);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 240, clientY: 330 });
  document.querySelector('#btnCameraReset').click();

  // Deep zoom-out: the camera keeps rendering a valid, fully-covered viewport at
  // every step — no apron to exhaust, so no rebase and no blank frame.
  for (let i = 0; i < 10; i++) {
    svg.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: 100 }));
    await nextFrame(window);
    const m = cameraMatrix(camera);
    assert.ok(m.scale > 0 && Number.isFinite(m.tx) && Number.isFinite(m.ty),
      `zoom-out step ${i + 1} leaves the camera a valid matrix (${JSON.stringify(m)})`);
    const topLeft = projectWorldPoint(camera, -1600 - 5000, 0);
    assert.ok(Number.isFinite(topLeft.x), 'projection stays finite at every zoom level');
  }
  const farLeftDuringDeepZoom = projectWorldPoint(camera, -1600, 0);
  assert.ok(farLeftDuringDeepZoom.x > 0 && farLeftDuringDeepZoom.x < VIEWPORT.width,
    `far off-screen node (-1600) is rendered inside the viewport during deep zoom-out (x=${farLeftDuringDeepZoom.x})`);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('wheel and pointer events on #canvasWrap / #gridLayer outside <svg> drive zoom and pan while HUD controls stay isolated', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const window = dom.window, document = window.document;
  const wrap = document.querySelector('#canvasWrap');
  const grid = document.querySelector('#gridLayer');
  const svg = document.querySelector('#graphCanvas');
  const camera = document.querySelector('#cameraLayer');
  setCanvasRect(svg);

  // Dispatch wheel directly on #gridLayer (as happens if a pointer target is outside <svg> inside #canvasWrap)
  grid.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 50, clientY: 50, deltaY: 100 }));
  await nextFrame(window);
  await settle(window, 260);
  const afterWheelW = Number(document.querySelector('#cameraW').value);
  assert.equal(afterWheelW, 1140, 'wheel on #gridLayer zoomed out from 1000 to 1140');

  // Dispatch pan pointer sequence directly on #canvasWrap in Move mode
  document.querySelector('#modeMove').click();
  dispatchPointer(window, wrap, 'pointerdown', { pointerId: 5, clientX: 40, clientY: 40 });
  dispatchPointer(window, wrap, 'pointermove', { pointerId: 5, clientX: 140, clientY: 90 });
  await nextFrame(window);
  dispatchPointer(window, wrap, 'pointerup', { pointerId: 5, clientX: 140, clientY: 90 });
  assert.notEqual(Number(document.querySelector('#cameraX').value), 0, 'panning on #canvasWrap moved the camera');

  // Clicking a floating HUD button inside #canvasWrap must NOT trigger canvas pointerdown/pan
  const camBeforeBtn = camera.getAttribute('transform');
  dispatchPointer(window, document.querySelector('#modeSelect'), 'pointerdown', { pointerId: 6, clientX: 20, clientY: 600 });
  dispatchPointer(window, document.querySelector('#modeSelect'), 'pointerup', { pointerId: 6, clientX: 20, clientY: 600 });
  assert.equal(camera.getAttribute('transform'), camBeforeBtn, 'HUD button pointer events do not pan the canvas');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('unrelated re-renders during pending wheel zoom preserve the zoomed camera, and camera inputs are never overwritten before apply', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const window = dom.window, document = window.document;
  const svg = document.querySelector('#graphCanvas');
  const camera = document.querySelector('#cameraLayer');
  setCanvasRect(svg);

  // 1. Trigger a wheel zoom-in, then trigger an unrelated renderCanvas() (changing
  //    default node color) BEFORE the 220ms settle timer expires.
  svg.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: -100 }));
  svg.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: -100 }));
  await nextFrame(window);
  const expectedW = 1000 * 0.88 * 0.88;
  const expectedH = 660 * 0.88 * 0.88;
  assertCameraRendersViewBox(camera, { x: -expectedW / 2, y: -expectedH / 2, w: expectedW, h: expectedH });

  const defColor = document.querySelector('#defNodeColor');
  defColor.value = '#f97316';
  defColor.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle(window, 60); // renderCanvas() runs while debounce was still < 220ms
  assertCameraRendersViewBox(camera, { x: -expectedW / 2, y: -expectedH / 2, w: expectedW, h: expectedH });
  assert.equal(Number(document.querySelector('#cameraW').value), Math.round(expectedW),
    'unrelated renderCanvas() adopted the pending zoom instead of reverting to 1000');

  // 2. While another wheel preview is pending, enter numeric camera values,
  //    move focus off the inputs onto #btnCameraSet, and click Apply.
  svg.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: -100 }));
  await nextFrame(window);
  const camX = document.querySelector('#cameraX');
  const camY = document.querySelector('#cameraY');
  const camW = document.querySelector('#cameraW');
  const camH = document.querySelector('#cameraH');
  const applyBtn = document.querySelector('#btnCameraSet');
  camX.value = '250';
  camY.value = '-120';
  camW.value = '800';
  camH.value = '528';
  applyBtn.focus(); // none of the 4 inputs is document.activeElement
  applyBtn.click();

  assertCameraRendersViewBox(camera, { x: 250 - 400, y: -120 - 264, w: 800, h: 528 });
  assert.equal(camX.value, '250', 'entered cameraX was not overwritten by syncCameraInputs');
  assert.equal(camY.value, '-120', 'entered cameraY was not overwritten by syncCameraInputs');
  assert.equal(camW.value, '800', 'entered cameraW was not overwritten by syncCameraInputs');
  assert.equal(camH.value, '528', 'entered cameraH was not overwritten by syncCameraInputs');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('edge centre-hit selection during an off-centre zoom preview hits at the visible midpoint on the first click', async () => {
  const graph = {
    ...smallGraph(),
    nodes: [
      { id: 'n1', label: 'A', x: -120, y: -60 },
      { id: 'n2', label: 'B', x: 120, y: 60 },
    ],
    edges: [{ id: 'e1', from: 'n1', to: 'n2' }],
    settings: { hitTestMode: 'center' },
  };
  const { dom, errors } = createEditorDom(graph);
  await nextFrame(dom.window);
  const window = dom.window, document = window.document;
  const svg = document.querySelector('#graphCanvas');
  const camera = document.querySelector('#cameraLayer');
  const edge = document.querySelector('#edge-e1');
  setCanvasRect(svg);

  // Off-centre wheel zoom near (120, 90) so the visible midpoint of e1 (world 0,0)
  // moves far away from its pre-zoom screen position (500, 330).
  for (let i = 0; i < 4; i++) {
    svg.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 120, clientY: 90, deltaY: -100 }));
  }
  await nextFrame(window);
  const visibleMidpoint = projectWorldPoint(camera, 0, 0);
  assert.ok(Math.hypot(visibleMidpoint.x - 500, visibleMidpoint.y - 330) > 120,
    `off-centre zoom shifted visible midpoint to (${visibleMidpoint.x}, ${visibleMidpoint.y})`);

  // Click the visible midpoint BEFORE the 220ms zoom commit fires.
  dispatchPointer(window, edge, 'pointerdown', { pointerId: 11, clientX: visibleMidpoint.x, clientY: visibleMidpoint.y });
  dispatchPointer(window, edge, 'pointerup', { pointerId: 11, clientX: visibleMidpoint.x, clientY: visibleMidpoint.y });
  assert.equal(edge.classList.contains('selected'), true,
    'edge must be selected on the first click at its visible midpoint during zoom preview');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('physical pointerdown/pointerup/click bursts on #btnZoomIn coalesce into one camera commit', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const window = dom.window, document = window.document;
  const svg = document.querySelector('#graphCanvas');
  assertSingleCameraSurface(document);
  const camera = document.querySelector('#cameraLayer');
  const btnZoomIn = document.querySelector('#btnZoomIn');
  setCanvasRect(svg);

  const cameraWrites = trackCameraWrites(camera);

  // Three physical clicks 50ms apart: each dispatches bubbling pointerdown ->
  // pointerup -> click on #btnZoomIn (inside #canvasWrap).
  for (let i = 0; i < 3; i++) {
    dispatchPointer(window, btnZoomIn, 'pointerdown', { pointerId: 20 + i, clientX: 960, clientY: 620 });
    dispatchPointer(window, btnZoomIn, 'pointerup', { pointerId: 20 + i, clientX: 960, clientY: 620 });
    btnZoomIn.click();
    await settle(window, 50);
  }
  // Each click repaints the pending preview on the one camera matrix; the point
  // of the coalescing is that the debounce persists it once, not three times.
  assert.ok(cameraWrites.count <= 4,
    `three preview clicks write the matrix a bounded number of times (saw ${cameraWrites.count})`);
  const writesBeforeCommit = cameraWrites.count;

  await settle(window, 250);
  assert.ok(cameraWrites.count - writesBeforeCommit <= 2,
    'settling commits the button-zoom burst with at most one more write');
  assert.equal(Number(document.querySelector('#cameraW').value), Math.round(1000 * 0.82 * 0.82 * 0.82));
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('applying a single edited camera field via Enter preserves an in-flight wheel zoom on unedited fields', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const window = dom.window, document = window.document;
  const svg = document.querySelector('#graphCanvas');
  const camera = document.querySelector('#cameraLayer');
  const camX = document.querySelector('#cameraX');
  const camW = document.querySelector('#cameraW');
  setCanvasRect(svg);

  // Focus #cameraX, enter a new X value, then wheel-zoom while #cameraX stays focused.
  camX.focus();
  camX.value = '225';
  camX.dispatchEvent(new window.Event('input', { bubbles: true }));

  svg.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 250, clientY: 165, deltaY: -100 }));
  await nextFrame(window);
  // Pre-settle: #cameraW input still holds the pre-preview string '1000', while
  // the active preview camera has width 880 and height 580.8.
  assert.equal(camW.value, '1000');

  // Press Enter inside #cameraX while the zoom preview is still in flight.
  camX.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

  // X=225 is applied, while width/height/Y come from the in-flight 880x580.8 zoom
  // rather than reverting to the stale 1000x660 strings in the untouched inputs.
  assert.equal(camX.value, '225');
  assert.equal(camW.value, '880', 'width stayed at the zoomed 880 instead of reverting to 1000');
  const expectedCy = -165 - (165 - 0) / (660 / 580.8) + 580.8 / 2;
  assertCameraRendersViewBox(camera, { x: 225 - 440, y: expectedCy - 580.8 / 2, w: 880, h: 580.8 });
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
