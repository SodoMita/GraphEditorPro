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
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId },
    pointerType: { value: options.pointerType ?? 'mouse' },
  });
  target.dispatchEvent(event);
}

const nextFrame = window => new Promise(resolve => window.setTimeout(resolve, 30));
const settle = (window, ms) => new Promise(resolve => window.setTimeout(resolve, ms));

function matrixValues(element) {
  const match = element.getAttribute('transform')?.match(/^matrix\(([^)]+)\)$/);
  assert.ok(match, `expected a matrix transform on #${element.id}`);
  return match[1].trim().split(/[ ,]+/).map(Number);
}

function assertCameraPairCancels(camera, scene) {
  const outer = matrixValues(camera), inner = matrixValues(scene);
  const scale = outer[0] * inner[0];
  const tx = outer[0] * inner[4] + outer[4];
  const ty = outer[3] * inner[5] + outer[5];
  assert.ok(Math.abs(scale - 1) < 1e-9, `outer × inner scale must be identity, got ${scale}`);
  assert.ok(Math.abs(tx) < 1e-9, `outer × inner x must cancel, got ${tx}`);
  assert.ok(Math.abs(ty) < 1e-9, `outer × inner y must cancel, got ${ty}`);
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

test('wheel zoom commits without changing its promoted matrix at the boundary', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  const camera = dom.window.document.querySelector('#cameraLayer');
  const scene = dom.window.document.querySelector('#sceneLayer');
  const grid = dom.window.document.querySelector('#gridLayer');
  setCanvasRect(svg);

  let viewBoxWrites = 0;
  const setAttribute = svg.setAttribute.bind(svg);
  svg.setAttribute = (name, value) => {
    if (name === 'viewBox') viewBoxWrites++;
    return setAttribute(name, value);
  };

  for (let i = 0; i < 6; i++) {
    svg.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: -100 }));
  }
  await nextFrame(dom.window);

  assert.equal(viewBoxWrites, 0, 'the expensive root viewBox stays frozen during the wheel burst');
  assert.match(camera.getAttribute('transform'), /^matrix\(/, 'zoom preview rides on the promoted camera layer');
  assert.equal(scene.getAttribute('transform'), null);
  assert.equal(grid.style.transform, '', 'the grid never uses a handoff transform');
  const gridRect = dom.window.document.querySelector('#gridRect');
  assert.ok(gridRect, 'the SVG grid rect exists');
  assert.equal(gridRect.parentNode.getAttribute('id'), 'sceneLayer', 'the grid renders inside the camera scene, so grid and graph share one paint pipeline');
  const pattern = dom.window.document.querySelector('#gridPattern');
  const patternWidthBefore = pattern.getAttribute('width');
  assert.ok(patternWidthBefore, 'the grid pattern geometry is initialized');
  assert.equal(grid.style.backgroundPosition, '', 'no CSS background grid is used (a separate composited layer could show a stale frame)');
  const previewMatrix = camera.getAttribute('transform');

  await settle(dom.window, 250); // let the commit debounce fire
  assert.equal(viewBoxWrites, 1, 'exactly one viewBox write commits the zoom');
  assert.equal(camera.getAttribute('transform'), previewMatrix, 'commit leaves the compositor property untouched');
  assert.match(scene.getAttribute('transform'), /^matrix\(/, 'the inner scene receives the inverse matrix');
  assertCameraPairCancels(camera, scene);
  const vb = svg.getAttribute('viewBox').split(' ').map(Number);
  assert.ok(vb[2] < 1000, 'zooming in shrinks the viewBox width');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a pointer gesture during pending zoom adopts the committed camera', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  const camera = dom.window.document.querySelector('#cameraLayer');
  const scene = dom.window.document.querySelector('#sceneLayer');
  setCanvasRect(svg);

  svg.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: -100 }));
  await nextFrame(dom.window);
  assert.match(camera.getAttribute('transform'), /^matrix\(/);
  const previewMatrix = camera.getAttribute('transform');

  // Any pointer gesture must flush the preview before doing hit-test math.
  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  assert.equal(camera.getAttribute('transform'), previewMatrix, 'flush does not reset the promoted camera matrix');
  assert.match(scene.getAttribute('transform'), /^matrix\(/, 'flush cancels it in the inner SVG group');
  assertCameraPairCancels(camera, scene);
  assert.equal(svg.getAttribute('viewBox').split(' ')[2], String(1000 * 0.88), 'flushed preview becomes the real viewBox');
  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 100, clientY: 100 });
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('wheel zoom that interrupts a pan first commits the panned camera', async () => {
  const { dom, errors } = createEditorDom(smallGraph());
  await nextFrame(dom.window);
  const document = dom.window.document;
  const svg = document.querySelector('#graphCanvas');
  const camera = document.querySelector('#cameraLayer');
  const scene = document.querySelector('#sceneLayer');
  setCanvasRect(svg);
  document.querySelector('#modeMove').click();

  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  dispatchPointer(dom.window, svg, 'pointermove', { pointerId: 1, clientX: 200, clientY: 100 });
  await nextFrame(dom.window);
  const panMatrix = camera.getAttribute('transform');
  assert.equal(svg.getAttribute('viewBox'), '-500 -330 1000 660', 'viewBox is still the pre-pan camera during preview');

  svg.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 330, deltaY: -100 }));
  assert.equal(svg.getAttribute('viewBox'), '-600 -330 1000 660', 'wheel adopts the completed pan before starting zoom');
  await nextFrame(dom.window);
  assert.notEqual(camera.getAttribute('transform'), panMatrix, 'zoom composes from the rebased pan matrix');

  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 200, clientY: 100 });
  assert.equal(svg.getAttribute('viewBox').split(' ')[2], String(1000 * 0.88));
  assertCameraPairCancels(camera, scene);
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

  // Selecting the edge paints its arrow in the accent color.
  dispatchPointer(dom.window, edgeE1, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 330 });
  await nextFrame(dom.window);
  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientY: 330, clientX: 500 });
  await nextFrame(dom.window);
  assert.equal(edgeE1.classList.contains('selected'), true);
  assert.equal(nodeA.classList.contains('selected'), false, 'replace-mode selection drops the node');
  assert.equal(arrow.getAttribute('fill'), '#22d3ee', 'selected arrow uses the accent color');

  // Deselect via empty canvas restores the regular edge color.
  const line = edgeE1.querySelector('.edge-line');
  const lineStroke = line.getAttribute('stroke');
  dispatchPointer(dom.window, svg, 'pointerdown', { pointerId: 1, clientX: 30, clientY: 30 });
  await nextFrame(dom.window);
  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 30, clientY: 30 });
  await nextFrame(dom.window);
  assert.equal(edgeE1.classList.contains('selected'), false);
  assert.equal(arrow.getAttribute('fill'), lineStroke, 'deselected arrow returns to the edge color');
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
