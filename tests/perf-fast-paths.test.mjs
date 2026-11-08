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
const STAGE_OVERSCAN = 0.5;
const STAGE_SPAN = 1 + 2 * STAGE_OVERSCAN;
const STAGE_IDENTITY = 'matrix(1, 0, 0, 1, 0, 0)';

function parseMatrix2d(raw, label) {
  const match = raw?.match(/^matrix\(([^)]+)\)$/);
  assert.ok(match, `expected a 2D matrix on ${label}, got ${JSON.stringify(raw)}`);
  const values = match[1].trim().split(/[ ,]+/).map(Number);
  assert.equal(values[1], 0, `${label} matrix has no rotation`);
  assert.equal(values[2], 0, `${label} matrix has no rotation`);
  assert.ok(Math.abs(values[0] - values[3]) < 1e-9, `${label} matrix scales uniformly`);
  return { scale: values[0], tx: values[4], ty: values[5] };
}

function stageFor(camera) {
  return camera.ownerDocument.querySelector('#cameraStage');
}

function stageMatrix(camera) {
  const inline = stageFor(camera)?.style?.transform;
  return inline ? parseMatrix2d(inline, '#cameraStage') : { scale: 1, tx: 0, ty: 0 };
}

function cameraMatrix(element) {
  return parseMatrix2d(element.getAttribute('transform'), `#${element.id}`);
}

function stageViewportBounds(camera, viewport = VIEWPORT) {
  const stage = stageMatrix(camera);
  const left = -STAGE_OVERSCAN * viewport.width + stage.tx;
  const top = -STAGE_OVERSCAN * viewport.height + stage.ty;
  return {
    left,
    top,
    right: left + STAGE_SPAN * viewport.width * stage.scale,
    bottom: top + STAGE_SPAN * viewport.height * stage.scale,
  };
}

function projectWorldPoint(camera, x, y, viewport = VIEWPORT) {
  const layer = cameraMatrix(camera);
  const stage = stageMatrix(camera);
  const basePixels = Math.min(viewport.width / REFERENCE_VIEWBOX.w, viewport.height / REFERENCE_VIEWBOX.h);
  const refPixels = STAGE_SPAN * basePixels;
  const refOffsetX = STAGE_SPAN * ((viewport.width - REFERENCE_VIEWBOX.w * basePixels) / 2);
  const refOffsetY = STAGE_SPAN * ((viewport.height - REFERENCE_VIEWBOX.h * basePixels) / 2);
  const svgX = (layer.scale * x + layer.tx - REFERENCE_VIEWBOX.x) * refPixels + refOffsetX;
  const svgY = (layer.scale * y + layer.ty - REFERENCE_VIEWBOX.y) * refPixels + refOffsetY;
  return {
    x: -STAGE_OVERSCAN * viewport.width + stage.scale * svgX + stage.tx,
    y: -STAGE_OVERSCAN * viewport.height + stage.scale * svgY + stage.ty,
  };
}

function assertCameraRendersViewBox(camera, viewBox, viewport = VIEWPORT) {
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

test('wheel zoom moves only the promoted #cameraStage during burst and commits once to #cameraLayer', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  const stage = dom.window.document.querySelector('#cameraStage');
  const camera = dom.window.document.querySelector('#cameraLayer');
  const scene = dom.window.document.querySelector('#sceneLayer');
  const grid = dom.window.document.querySelector('#gridLayer');
  setCanvasRect(svg);
  const viewBoxWrites = trackViewBoxWrites(svg);
  const cameraWrites = trackAttrWrites(camera, 'transform');

  for (let i = 0; i < 6; i++) {
    svg.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: -100 }));
  }
  await nextFrame(dom.window);

  // Six 0.88 steps anchored at the canvas centre: width and height scale, the
  // centre stays put. During the wheel burst, #cameraLayer receives ZERO writes.
  let w = 1000, h = 660;
  for (let i = 0; i < 6; i++) { w *= 0.88; h *= 0.88; }
  const zoomedCamera = { x: -w / 2, y: -h / 2, w, h };

  assert.equal(viewBoxWrites.count, 0, 'the root viewBox is a reference frame, not a per-frame camera write');
  assert.equal(cameraWrites.count, 0, 'active wheel zoom never touches SVG #cameraLayer transform per frame');
  assert.notEqual(stage.style.transform, STAGE_IDENTITY, '#cameraStage carries the GPU-composited preview scale');
  assert.equal(svg.getAttribute('viewBox'), referenceViewBox(), 'the fixed reference frame is installed');
  assertCameraRendersViewBox(camera, zoomedCamera);
  assert.equal(scene.getAttribute('transform'), null, 'the scene group is never transformed');
  assert.equal(grid.style.transform, '', 'the grid never uses a handoff transform');
  const gridRect = dom.window.document.querySelector('#gridRect');
  assert.ok(gridRect, 'the SVG grid rect exists');
  assert.equal(gridRect.parentNode.getAttribute('id'), 'sceneLayer', 'the grid rides the camera matrix, so grid and graph are painted by one pass');
  const pattern = dom.window.document.querySelector('#gridPattern');
  const patternWidthBefore = pattern.getAttribute('width');
  assert.ok(patternWidthBefore, 'the grid pattern geometry is initialized');
  assert.equal(grid.style.backgroundPosition, '', 'no CSS background grid is used');
  const previewSample = projectWorldPoint(camera, 125, -90);

  await settle(dom.window, 250); // let the commit debounce fire
  assert.equal(viewBoxWrites.count, 0, 'committing the camera leaves the reference viewBox untouched');
  assert.equal(cameraWrites.count, 1, 'settling commits to #cameraLayer exactly once');
  assert.equal(stage.style.transform, STAGE_IDENTITY, 'settling resets #cameraStage to identity atomically');
  const committedSample = projectWorldPoint(camera, 125, -90);
  assert.ok(Math.abs(committedSample.x - previewSample.x) < 1e-6 && Math.abs(committedSample.y - previewSample.y) < 1e-6,
    'the commit changes nothing that is painted: preview and committed cameras project identically');
  assertCameraRendersViewBox(camera, zoomedCamera);
  assert.ok(cameraMatrix(camera).scale > 1, 'zooming in scales the committed camera matrix above 1');
  assert.equal(pattern.getAttribute('width'), patternWidthBefore, 'the world-locked grid pattern needs no rebuild while zooming');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a pointer gesture during pending zoom adopts the committed camera invisibly', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  const stage = dom.window.document.querySelector('#cameraStage');
  const camera = dom.window.document.querySelector('#cameraLayer');
  setCanvasRect(svg);
  const viewBoxWrites = trackViewBoxWrites(svg);
  const cameraWrites = trackAttrWrites(camera, 'transform');

  svg.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: -100 }));
  await nextFrame(dom.window);
  assert.equal(cameraWrites.count, 0, 'wheel preview stays on #cameraStage before pointerdown');
  const zoomedCamera = { x: -440, y: -290.4, w: 880, h: 580.8 };
  assertCameraRendersViewBox(camera, zoomedCamera);
  const previewPoint = projectWorldPoint(camera, -200, 100);

  // Hover pointermove (cursor drift while scrolling) must NOT flush the preview.
  dispatchPointer(dom.window, svg, 'pointermove', { pointerId: 1, clientX: 110, clientY: 105 });
  assert.equal(cameraWrites.count, 0, 'hover pointermove while scrolling does not flush zoomPreview onto SVG');
  assert.notEqual(stage.style.transform, STAGE_IDENTITY);

  // Starting a pointer gesture adopts the pending camera atomically onto #cameraLayer.
  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  assert.equal(cameraWrites.count, 1, 'pointerdown flushes pending zoom once');
  assert.equal(stage.style.transform, STAGE_IDENTITY, 'stage resets to identity when zoom flushes');
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

test('wheel zoom that interrupts a pan adopts the panned camera on #cameraStage with zero mid-gesture SVG commits', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const document = dom.window.document;
  const svg = document.querySelector('#graphCanvas');
  const stage = document.querySelector('#cameraStage');
  const camera = document.querySelector('#cameraLayer');
  const scene = document.querySelector('#sceneLayer');
  setCanvasRect(svg);
  const viewBoxWrites = trackViewBoxWrites(svg);
  const cameraWrites = trackAttrWrites(camera, 'transform');
  document.querySelector('#modeMove').click();

  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  dispatchPointer(dom.window, svg, 'pointermove', { pointerId: 1, clientX: 200, clientY: 100 });
  await nextFrame(dom.window);
  const panStageTransform = stage.style.transform;
  assert.equal(cameraWrites.count, 0, 'panning does not touch SVG #cameraLayer');
  assertCameraRendersViewBox(camera, { x: -600, y: -330, w: 1000, h: 660 }, VIEWPORT);

  // The wheel adopts the completed pan (100 world px left) and zooms 0.88 around
  // the canvas centre: width 880, centre (-100, 0) — STILL on #cameraStage with 0 SVG commits!
  svg.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: -100 }));
  await nextFrame(dom.window);
  assert.equal(cameraWrites.count, 0, 'pan -> wheel handoff keeps compositing on #cameraStage without an SVG commit');
  assert.notEqual(stage.style.transform, panStageTransform, 'zoom updates #cameraStage from the adopted pan');
  assertCameraRendersViewBox(camera, { x: -540, y: -290.4, w: 880, h: 580.8 }, VIEWPORT);

  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 200, clientY: 100 });
  assert.equal(viewBoxWrites.count, 0, 'no camera state is ever written into the root viewBox');
  assert.equal(cameraWrites.count, 1, 'pointerup flushes the combined pan+zoom onto #cameraLayer once');
  assert.equal(stage.style.transform, STAGE_IDENTITY, 'stage returns to identity after commit');
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
  const pattern = document.querySelector('#gridPattern');
  const gizmoLayer = document.querySelector('#gizmoLayer');
  setCanvasRect(svg);

  // Select nodes so the selection gizmo is live while scaling, and warm up the
  // move gizmo tree once before observing scaling mutations.
  dispatchPointer(window, document.getElementById('node-a'), 'pointerdown', { pointerId: 1, clientX: 300, clientY: 330 });
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 300, clientY: 330 });
  await nextFrame(window);

  const initialGridPaths = [...pattern.querySelectorAll('path')];
  assert.equal(initialGridPaths.length, 3, 'grid pattern keeps 3 persistent SVG paths');
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
  assert.ok(Number(pattern.getAttribute('width')) > 200, 'grid decimated to a wider world stride without rebuilding paths');
  assert.ok(Number(initialGizmoHit.getAttribute('r')) > radiusBefore, 'gizmo handle scaled up in world units in place');

  // 2. Rapid #btnZoomIn / #btnZoomOut clicks coalesce on #cameraStage and commit once
  const camWrites = trackAttrWrites(camera, 'transform');
  for (let i = 0; i < 5; i++) document.querySelector('#btnZoomIn').click();
  await nextFrame(window);
  assert.equal(camWrites.count, 0, 'rapid #btnZoomIn clicks coalesce on #cameraStage before settling');
  await settle(window, 260);
  assert.equal(camWrites.count, 1, 'rapid #btnZoomIn burst commits once');

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
  assert.deepEqual([...pattern.querySelectorAll('path')], initialGridPaths, 'exact same 3 <path> instances remain in #gridPattern');
  assert.equal(gizmoLayer.querySelector('.gizmo-root'), initialGizmoRoot, 'exact same gizmo subtree remains mounted');
  assert.equal(document.getElementById('node-a'), initialNodeA, 'node SVG elements were never reconstructed');
  assert.equal(document.getElementById('edge-e1'), initialEdge1, 'edge SVG elements were never reconstructed');
  assert.deepEqual(errors.map(error => error.message), []);
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
  // reflects the 200%x200% overscan box AND #cameraStage's CSS matrix!
  grid.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0,
    width: 1000, height: 660, right: 1000, bottom: 660,
    toJSON() { return this; },
  });
  svg.getBoundingClientRect = () => {
    const b = stageViewportBounds(camera);
    return {
      x: b.left, y: b.top, left: b.left, top: b.top,
      width: b.right - b.left, height: b.bottom - b.top,
      right: b.right, bottom: b.bottom,
      toJSON() { return this; },
    };
  };

  // Off-centre cursor at (250, 165) -> world (-250, -165) at initial camera.
  const anchorX = 250, anchorY = 165;
  const beforeScreen = projectWorldPoint(camera, -250, -165);
  assert.ok(Math.abs(beforeScreen.x - anchorX) < 1e-6 && Math.abs(beforeScreen.y - anchorY) < 1e-6);

  // Dispatch wheel step 1, wait a frame so #cameraStage scales svg's rect, then
  // dispatch wheel step 2 and commit: (-250, -165) must stay pinned under (250, 165).
  svg.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: anchorX, clientY: anchorY, deltaY: -100 }));
  await nextFrame(window);
  svg.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: anchorX, clientY: anchorY, deltaY: -100 }));
  await nextFrame(window);
  const duringScreen = projectWorldPoint(camera, -250, -165);
  assert.ok(Math.abs(duringScreen.x - anchorX) < 1e-6 && Math.abs(duringScreen.y - anchorY) < 1e-6,
    `world anchor stayed under cursor during scaled stage preview (${duringScreen.x}, ${duringScreen.y})`);

  await settle(window, 260);
  const afterScreen = projectWorldPoint(camera, -250, -165);
  assert.ok(Math.abs(afterScreen.x - anchorX) < 1e-6 && Math.abs(afterScreen.y - anchorY) < 1e-6,
    `world anchor stayed under cursor after commit (${afterScreen.x}, ${afterScreen.y})`);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('overscan stage keeps off-screen world content rendered during pan and zoom-out without blank margins', async () => {
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
  const camera = document.querySelector('#cameraLayer');
  setCanvasRect(svg);

  // At rest, offRight (x=760) is outside the 1000px viewport (x=1260 > 1000)
  // YET inside the 200%x200% overscanned SVG user-space bounds [-500..+500]:
  const layerAtRest = cameraMatrix(camera);
  const offRightSvgUserX = layerAtRest.scale * 760 + layerAtRest.tx;
  assert.ok(offRightSvgUserX >= REFERENCE_VIEWBOX.x && offRightSvgUserX <= REFERENCE_VIEWBOX.x + REFERENCE_VIEWBOX.w,
    `off-screen node x=760 is pre-rendered inside the overscan SVG reference frame (userX=${offRightSvgUserX})`);

  // 1. Mid-pan left by 360px (NO pointerup -> pure #cameraStage preview):
  //    offRight slides into the visible [0..1000] viewport and #cameraStage still covers [0..1000]x[0..660].
  document.querySelector('#modeMove').click();
  dispatchPointer(window, svg, 'pointerdown', { pointerId: 1, clientX: 600, clientY: 330 });
  dispatchPointer(window, svg, 'pointermove', { pointerId: 1, clientX: 240, clientY: 330 });
  await nextFrame(window);
  const panBounds = stageViewportBounds(camera);
  assert.ok(panBounds.left <= 0.5 && panBounds.right >= VIEWPORT.width - 0.5,
    `overscan stage covers full viewport width during pan (${panBounds.left}..${panBounds.right})`);
  const offRightDuringPan = projectWorldPoint(camera, 760, 0);
  assert.ok(offRightDuringPan.x > 0 && offRightDuringPan.x < VIEWPORT.width,
    `off-screen node appears inside viewport during live pan preview (x=${offRightDuringPan.x})`);
  dispatchPointer(window, svg, 'pointerup', { pointerId: 1, clientX: 240, clientY: 330 });
  document.querySelector('#btnCameraReset').click();

  // 2. Moderate wheel zoom-out (3 steps, ~1.48x, pure #cameraStage preview) AND
  //    deep wheel zoom-out (10 steps total, ~3.7x, crossing 2x apron -> auto-rebase):
  //    every frame keeps #cameraStage covering 100% of [0..1000]x[0..660]!
  for (let i = 0; i < 10; i++) {
    svg.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: 100 }));
    await nextFrame(window);
    const bounds = stageViewportBounds(camera);
    assert.ok(bounds.left <= 0.5 && bounds.top <= 0.5 && bounds.right >= VIEWPORT.width - 0.5 && bounds.bottom >= VIEWPORT.height - 0.5,
      `zoom-out step ${i + 1} leaves zero blank margin (${JSON.stringify(bounds)})`);
  }
  const farLeftDuringDeepZoom = projectWorldPoint(camera, -1600, 0);
  assert.ok(farLeftDuringDeepZoom.x > 0 && farLeftDuringDeepZoom.x < VIEWPORT.width,
    `far off-screen node (-1600) is rendered inside viewport during deep zoom-out preview (x=${farLeftDuringDeepZoom.x})`);
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

test('physical pointerdown/pointerup/click bursts on #btnZoomIn coalesce on #cameraStage with zero intermediate commits', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const window = dom.window, document = window.document;
  const svg = document.querySelector('#graphCanvas');
  const camera = document.querySelector('#cameraLayer');
  const stage = document.querySelector('#cameraStage');
  const btnZoomIn = document.querySelector('#btnZoomIn');
  setCanvasRect(svg);

  const cameraWrites = trackAttrWrites(camera, 'transform');

  // Three physical clicks 50ms apart: each dispatches bubbling pointerdown ->
  // pointerup -> click on #btnZoomIn (inside #canvasWrap).
  for (let i = 0; i < 3; i++) {
    dispatchPointer(window, btnZoomIn, 'pointerdown', { pointerId: 20 + i, clientX: 960, clientY: 620 });
    dispatchPointer(window, btnZoomIn, 'pointerup', { pointerId: 20 + i, clientX: 960, clientY: 620 });
    btnZoomIn.click();
    await settle(window, 50);
  }
  assert.equal(cameraWrites.count, 0,
    'physical zoom-button clicks 50ms apart must not flush #cameraLayer on button pointerup');
  assert.notEqual(stage.style.transform, STAGE_IDENTITY, '#cameraStage holds the coalesced button-zoom preview');

  await settle(window, 250);
  assert.equal(cameraWrites.count, 1, 'settled button-zoom burst commits #cameraLayer once');
  assert.equal(stage.style.transform, STAGE_IDENTITY);
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
