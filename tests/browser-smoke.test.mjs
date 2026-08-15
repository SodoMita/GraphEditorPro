import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

function createEditorDom() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, {
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

test('pan uses a scene preview and commits the viewBox only once', async () => {
  const { dom, errors } = createEditorDom();
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
  const scene = dom.window.document.querySelector('#sceneLayer');
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
  assert.match(scene.getAttribute('transform'), /^matrix\(/);

  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 1, clientX: 180, clientY: 140 });
  assert.equal(viewBoxWrites, 1);
  assert.equal(scene.hasAttribute('transform'), false);
  assert.equal(svg.getAttribute('viewBox'), '-580 -370 1000 660');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('pinch also keeps the root viewBox frozen until gesture end', async () => {
  const { dom, errors } = createEditorDom();
  await nextFrame(dom.window);
  const svg = dom.window.document.querySelector('#graphCanvas');
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
  assert.match(scene.getAttribute('transform'), /^matrix\(/);

  dispatchPointer(dom.window, svg, 'pointerup', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 100 });
  assert.equal(viewBoxWrites, 1);
  assert.equal(scene.hasAttribute('transform'), false);
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
