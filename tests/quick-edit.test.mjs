import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

const NS = 'xmlns="http://graphml.graphdrawing.org/xmlns"';

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
        media: query, matches: false, onchange: null,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
        dispatchEvent() { return true; },
      });
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => null;
      // jsdom has no PointerEvent; the app's press handlers use pointer events,
      // and a MouseEvent carries the same fields they read.
      if (!window.PointerEvent) window.PointerEvent = window.MouseEvent;
    },
  });
  return { dom, errors };
}

const settle = (window, ms = 120) => new Promise(resolve => window.setTimeout(resolve, ms));

async function importGraphml(dom, text) {
  const { window } = dom;
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => {}, readText: async () => text },
  });
  window.document.querySelector('#btnPasteGraphml').click();
  await settle(window, 200);
}

function exportedGraph(document) {
  document.querySelector('#btnExportJson').click();
  const data = JSON.parse(document.querySelector('.export-modal textarea').value);
  document.querySelector('#expCloseBtn').click();
  return data;
}

// A node labelled Alice plus an edge, both declared so the parser binds them.
const graphml = [
  '<?xml version="1.0"?>',
  `<graphml ${NS}>`,
  '  <key id="label" for="node" attr.name="label" attr.type="string"/>',
  '  <key id="weight" for="edge" attr.name="weight" attr.type="string"/>',
  '  <graph edgedefault="directed">',
  '    <node id="n1"><data key="label">Alice</data></node>',
  '    <node id="n2"/>',
  '    <edge id="e1" source="n1" target="n2"><data key="weight">4</data></edge>',
  '  </graph>',
  '</graphml>',
].join('\n');

// A press starts on the element, but the canvas takes pointer capture — and while
// it holds capture the browser retargets that pointer's events to the canvas. The
// double click therefore arrives at #canvasWrap, never at the node group. These
// helpers reproduce exactly that: press on the element, then dispatch dblclick on
// the canvas.
function pressOn(dom, selector, clientX, clientY) {
  const { window } = dom;
  const target = window.document.querySelector(selector);
  assert.ok(target, `expected ${selector} to be rendered`);
  target.dispatchEvent(new window.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, clientX, clientY, pointerId: 1, button: 0,
  }));
  return target;
}

function doubleClickRetargetedToCanvas(dom, clientX, clientY) {
  const { window } = dom;
  window.document.querySelector('#canvasWrap').dispatchEvent(new window.MouseEvent('dblclick', {
    bubbles: true, cancelable: true, clientX, clientY,
  }));
}

function openDialog(document) {
  return document.querySelector('div.app-dialog');
}

function submitDialog(dom, value) {
  const { window } = dom;
  const document = window.document;
  const dialog = openDialog(document);
  assert.ok(dialog, 'expected a dialog to be open');
  const input = dialog.querySelector('input');
  if (input) input.value = value;
  dialog.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

test('double-clicking a node opens the label editor, even though the canvas holds pointer capture', async () => {
  // The reported bug: the dblclick handler lived on the node group, but pointer
  // capture retargets it to the canvas, so the handler never ran and nothing
  // opened. The canvas now resolves the element itself.
  const { dom, errors } = createEditorDom();
  const { window } = dom;
  const document = window.document;
  await importGraphml(dom, graphml);

  pressOn(dom, '#nodesLayer g.node', 100, 100);
  doubleClickRetargetedToCanvas(dom, 100, 100);
  await settle(window);

  const dialog = openDialog(document);
  assert.ok(dialog, 'the label editor opens on a double click');
  assert.equal(dialog.querySelector('input')?.value, 'Alice', 'it is prefilled with the current label');

  submitDialog(dom, 'Renamed');
  await settle(window);

  assert.equal(exportedGraph(document).nodes[0].label, 'Renamed', 'the edit is applied');
  assert.equal(openDialog(document), null, 'and the dialog closes');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('double-clicking an edge opens the weight editor', async () => {
  // The same path for edges, which the reported bug covered too.
  const { dom, errors } = createEditorDom();
  const { window } = dom;
  const document = window.document;
  await importGraphml(dom, graphml);

  pressOn(dom, '#edgesLayer g.edge', 100, 100);
  doubleClickRetargetedToCanvas(dom, 100, 100);
  await settle(window);

  const dialog = openDialog(document);
  assert.ok(dialog, 'the weight editor opens');
  assert.equal(dialog.querySelector('input')?.value, '4', 'prefilled with the current weight');

  submitDialog(dom, '9');
  await settle(window);

  assert.equal(exportedGraph(document).edges[0].weight, '9', 'the weight is applied');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a double click on empty canvas opens nothing', async () => {
  // The counterpart: attribution must not leak from a previous press, or a
  // double click on blank space would edit whatever was touched last.
  const { dom, errors } = createEditorDom();
  const { window } = dom;
  const document = window.document;
  await importGraphml(dom, graphml);

  pressOn(dom, '#nodesLayer g.node', 100, 100);
  // ...then a fresh press that starts on the canvas, and a double click there.
  const wrap = document.querySelector('#canvasWrap');
  wrap.dispatchEvent(new window.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, clientX: 600, clientY: 500, pointerId: 2, button: 0,
  }));
  wrap.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 600, clientY: 500 }));
  await settle(window);

  assert.equal(openDialog(document), null, 'no editor for empty space');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('one double click never stacks two editors', async () => {
  // The element group and the canvas must not both act on the same double click.
  // Every pointer path takes capture on the canvas, so a real double click is
  // delivered there and only there — this pins that whichever route delivers it,
  // exactly one editor opens.
  const { dom, errors } = createEditorDom();
  const { window } = dom;
  const document = window.document;
  await importGraphml(dom, graphml);

  pressOn(dom, '#nodesLayer g.node', 100, 100);
  doubleClickRetargetedToCanvas(dom, 100, 100);
  await settle(window);

  assert.equal(document.querySelectorAll('div.app-dialog').length, 1, 'one editor, not two');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('a double click in a drag-selection tool does not edit', async () => {
  // In rect/lasso/line/polygon a double click is two selection gestures, not an
  // edit. Guarding on the tool keeps the fix from hijacking those.
  const { dom, errors } = createEditorDom();
  const { window } = dom;
  const document = window.document;
  await importGraphml(dom, graphml);

  const rectBtn = document.querySelector('[data-selecttool="rect"]');
  assert.ok(rectBtn, 'the rect selection tool is reachable');
  rectBtn.click();
  await settle(window);

  pressOn(dom, '#nodesLayer g.node', 100, 100);
  doubleClickRetargetedToCanvas(dom, 100, 100);
  await settle(window);

  assert.equal(openDialog(document), null, 'selection tools keep their double clicks');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});
