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

function projectWorldPoint(camera, x, y, viewport = VIEWPORT) {
  const layer = cameraMatrix(camera);
  const stage = stageMatrix(camera);
  const basePixels = Math.min(viewport.width / REFERENCE_VIEWBOX.w, viewport.height / REFERENCE_VIEWBOX.h);
  const baseOffsetX = (viewport.width - REFERENCE_VIEWBOX.w * basePixels) / 2;
  const baseOffsetY = (viewport.height - REFERENCE_VIEWBOX.h * basePixels) / 2;
  const svgX = (layer.scale * x + layer.tx - REFERENCE_VIEWBOX.x) * basePixels + baseOffsetX;
  const svgY = (layer.scale * y + layer.ty - REFERENCE_VIEWBOX.y) * basePixels + baseOffsetY;
  return {
    x: stage.scale * svgX + stage.tx,
    y: stage.scale * svgY + stage.ty,
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
  // reflects #cameraStage's CSS matrix!
  grid.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0,
    width: 1000, height: 660, right: 1000, bottom: 660,
    toJSON() { return this; },
  });
  svg.getBoundingClientRect = () => {
    const s = stageMatrix(camera);
    return {
      x: s.tx, y: s.ty, left: s.tx, top: s.ty,
      width: 1000 * s.scale, height: 660 * s.scale,
      right: s.tx + 1000 * s.scale, bottom: s.ty + 660 * s.scale,
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
