import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import test from 'node:test';

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

function sampleGraph() {
  return {
    title: 'outline',
    mode: 'select',
    nodes: [
      { id: 'a', label: 'Alpha', x: -200, y: 0 },
      { id: 'b', label: 'Beta', x: 200, y: 0 },
      { id: 'big', label: 'Big', x: 0, y: 200, labelSize: 26 },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', directed: true, weight: '3', label: 'link' },
    ],
    viewBox: { x: -500, y: -330, w: 1000, h: 660 },
  };
}

test('labels keep their outline halo during a node drag', async () => {
  const { dom, errors } = createEditorDom(sampleGraph());
  await nextFrame(dom.window);
  const doc = dom.window.document;
  const svg = doc.querySelector('#graphCanvas');
  setCanvasRect(svg);
  const text = doc.getElementById('node-a').querySelector('text');

  const before = { stroke: text.getAttribute('stroke'), width: text.getAttribute('stroke-width') };
  assert.equal(before.stroke, '#020617', 'default outline halo is rendered');

  dispatchPointer(dom.window, doc.getElementById('node-b'), 'pointerdown', { pointerId: 1, clientX: 700, clientY: 330 });
  dispatchPointer(dom.window, svg, 'pointermove', { pointerId: 1, clientX: 740, clientY: 350 });
  await nextFrame(dom.window);
  assert.equal(doc.querySelector('#canvasWrap').classList.contains('fast-interaction'), true, 'gesture is in progress');
  // The halo must stay identical for the whole gesture — no mid-draw degradation.
  assert.equal(text.getAttribute('stroke'), before.stroke, 'halo color survives the drag');
  assert.equal(text.getAttribute('stroke-width'), before.width, 'halo width survives the drag');
  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 740, clientY: 350 });
  await nextFrame(dom.window);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('label outline width scales with the label size and is configurable', async () => {
  const { dom, errors } = createEditorDom(sampleGraph());
  await nextFrame(dom.window);
  const doc = dom.window.document;
  const svg = doc.querySelector('#graphCanvas');
  setCanvasRect(svg);

  const normal = doc.getElementById('node-a').querySelector('text');
  const big = doc.getElementById('node-big').querySelector('text');
  assert.equal(normal.getAttribute('stroke-width'), '4', '13px label gets the configured width');
  assert.equal(big.getAttribute('stroke-width'), '8', '26px label scales the outline proportionally');

  // Change width setting: 4 → 2
  const widthInput = doc.getElementById('defLabelOutlineWidth');
  widthInput.value = '2';
  widthInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await nextFrame(dom.window);
  assert.equal(normal.getAttribute('stroke-width'), '2');

  // Change color setting
  const colorInput = doc.getElementById('defLabelOutlineColor');
  colorInput.value = '#fbbf24';
  colorInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await nextFrame(dom.window);
  assert.equal(normal.getAttribute('stroke'), '#fbbf24');

  // Edge labels and weights share the halo
  const edgeLabel = doc.getElementById('edge-e1').querySelector('.edge-label');
  const edgeWeight = doc.getElementById('edge-e1').querySelector('.edge-weight');
  assert.equal(edgeLabel.getAttribute('stroke'), '#fbbf24');
  assert.ok(Math.abs(parseFloat(edgeWeight.getAttribute('stroke-width')) - 2 * 12 / 13) < 0.02, 'edge weight halo scales by its own label size');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('background plate mode draws a rect behind the label and none mode strips everything', async () => {
  const { dom, errors } = createEditorDom(sampleGraph());
  await nextFrame(dom.window);
  const doc = dom.window.document;
  const svg = doc.querySelector('#graphCanvas');
  setCanvasRect(svg);
  const group = doc.getElementById('node-a');
  const text = group.querySelector('text');

  const select = doc.getElementById('defLabelOutline');
  select.value = 'plate';
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await nextFrame(dom.window);

  const plate = group.querySelector('rect.label-plate');
  assert.ok(plate, 'plate rect is created');
  assert.equal(plate.getAttribute('fill'), '#020617', 'plate uses the configured color');
  assert.equal(text.getAttribute('stroke'), 'none', 'plate mode replaces the glyph outline');
  assert.ok(plate.nextSibling === text || plate.nextElementSibling === text, 'plate sits directly behind its text');
  const plateWidth = parseFloat(plate.getAttribute('width'));
  assert.ok(plateWidth > 10, 'plate is wider than bare padding');

  // Edge weights get plates too, and they follow a live drag.
  const edgeGroup = doc.getElementById('edge-e1');
  const edgeWeightPlate = edgeGroup.querySelector('rect.label-plate');
  assert.ok(edgeWeightPlate, 'edge text receives a plate');
  const xBefore = parseFloat(edgeWeightPlate.getAttribute('x'));
  dispatchPointer(dom.window, doc.getElementById('node-b'), 'pointerdown', { pointerId: 1, clientX: 700, clientY: 330 });
  dispatchPointer(dom.window, svg, 'pointermove', { pointerId: 1, clientX: 760, clientY: 330 });
  await nextFrame(dom.window);
  assert.notEqual(parseFloat(edgeWeightPlate.getAttribute('x')), xBefore, 'plate follows the dragged edge');
  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 760, clientY: 330 });
  await nextFrame(dom.window);

  // None mode removes halo and plate entirely
  select.value = 'none';
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await nextFrame(dom.window);
  assert.equal(text.getAttribute('stroke'), 'none');
  assert.equal(group.querySelector('rect.label-plate'), null, 'plate is removed');

  // Settings survive state sanitization round-trips (undo/redo, import)
  dom.window.close();
});

test('outline settings are sanitized with the rest of graphDefaults', async () => {
  const { dom, errors } = createEditorDom({
    ...sampleGraph(),
    settings: { graphDefaults: { labelOutline: 'weird', labelOutlineColor: 'red', labelOutlineWidth: -5 } },
  });
  await nextFrame(dom.window);
  const doc = dom.window.document;
  const select = doc.getElementById('defLabelOutline');
  assert.equal(select.value, 'outline', 'invalid mode falls back to outline');
  assert.equal(doc.getElementById('defLabelOutlineColor').value, '#020617', 'invalid color falls back');
  assert.equal(doc.getElementById('defLabelOutlineWidth').value, '0', 'negative width clamps to 0');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('grid decimates instead of clamping at low zoom, staying world-locked', async () => {
  const { dom, errors } = createEditorDom(sampleGraph());
  await nextFrame(dom.window);
  const doc = dom.window.document;
  const svg = doc.querySelector('#graphCanvas');
  setCanvasRect(svg);
  const grid = doc.getElementById('gridLayer');

  const zoomTo = async width => {
    const camW = doc.getElementById('cameraW');
    camW.value = String(width);
    camW.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await nextFrame(dom.window);
    return grid.style.backgroundSize.split(',').map(layer => layer.trim().split(/\s+/).map(parseFloat));
  };

  // 1000×660 canvas over a 1000-wide viewBox → scale 1: base grid unchanged.
  const at1000 = await zoomTo(1000);
  assert.equal(at1000[0][0], 40, 'minor cell at 100% is the raw grid size');
  assert.equal(at1000[2][0], 200, 'major cell is every 5th minor at 100%');

  // scale 1/12: raw minor cell 3.33px < 8px minimum → decimate to every 3rd cell
  // (120 world → 10px on screen); majors stay on every 2nd decimated step (240 → 20px).
  const at12000 = await zoomTo(12000);
  assert.equal(at12000[0][0], 10, 'minor grid decimates to a whole world multiple, not a 4px clamp');
  assert.equal(at12000[0][1], 10);
  assert.equal(at12000[2][0], 20, 'major grid remains an integer multiple of the minor step');
  assert.ok(at12000[2][0] >= 2 * at12000[0][0], 'majors are at least 2× the minor spacing');

  // scale 1/20: raw minor 2px → every 4th cell (160 world → 8px), majors every 320 → 16px.
  const at20000 = await zoomTo(20000);
  assert.equal(at20000[0][0], 8);
  assert.equal(at20000[2][0], 16);

  // Every decimated cell is an integer multiple of the raw 40-unit grid, so
  // rendered lines stay anchored to world coordinates at any zoom (the old
  // hard 4px clamp rescaled the pattern off the world grid, which made it
  // drift diagonally relative to the nodes).
  const worldStep = (layers, width) => layers[0][0] * width / 1000; // cellPx / scale, scale = 1000/width
  assert.equal(worldStep(at12000, 12000) / 40, 3, '12000 zoom decimates to every 3rd grid cell');
  assert.equal(worldStep(at20000, 20000) / 40, 4, '20000 zoom decimates to every 4th grid cell');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
