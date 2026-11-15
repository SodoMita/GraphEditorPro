import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

// The render-pass generation stamp is the proof that "nothing changed for this
// element". A valid skip must advance the stamp, otherwise the next pass finds
// the stamp one generation behind lastPaintedGen and reprocesses the element,
// alternating every other pass. The observable is the __ent spine link on the
// node's own SVG group.
function createEditorDom(savedGraph) {
  const errors = [];
  const source = html.replace('<script>', `<script>localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(savedGraph))});</script><script>`);
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(source, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://offline.test/', virtualConsole,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.alert = () => {}; window.confirm = () => true; window.prompt = () => null;
      const canvasRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 660, right: 1000, bottom: 660, toJSON() { return this; } });
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

const settle = (window, ms = 80) => new Promise(resolve => window.setTimeout(resolve, ms));
const dispatchPointer = (window, target, type, options = {}) => {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: options.clientX ?? 0, clientY: options.clientY ?? 0 });
  Object.defineProperties(event, { pointerId: { value: options.pointerId ?? 1 }, pointerType: { value: 'mouse' } });
  target.dispatchEvent(event);
};
const selectNode = async (window, document, id, x, y) => {
  const svg = document.querySelector('#graphCanvas');
  document.elementFromPoint = () => document.querySelector('#node-' + id);
  dispatchPointer(window, document.querySelector('#node-' + id), 'pointerdown', { clientX: x, clientY: y });
  dispatchPointer(window, svg, 'pointerup', { clientX: x, clientY: y });
  await settle(window, 120);
};

const NODE_POS = id => {
  const index = Number(id.slice(1)) - 1;
  return { x: -400 + (index % 8) * 120, y: -280 + Math.floor(index / 8) * 120 };
};

function bigGraph() {
  const nodes = [];
  for (let i = 1; i <= 40; i++) {
    const { x, y } = NODE_POS('n' + i);
    nodes.push({ id: 'n' + i, label: 'n' + i, x, y, shape: 'square', order: i });
  }
  return { title: 'render-skip', mode: 'select', nextNode: 41, nextEdge: 1, nodes, edges: [], settings: {}, viewBox: { x: -500, y: -330, w: 1000, h: 660 } };
}

test('consecutive render passes keep skipping unchanged nodes instead of alternating', async () => {
  const { dom, errors } = createEditorDom(bigGraph());
  const { window } = dom; const { document } = window;
  await settle(window, 250);

  const genOf = id => document.querySelector('#node-' + id)?.__ent?.gen;
  const gens = () => [...document.querySelectorAll('.node')].map(el => el.__ent?.gen ?? -1);
  const allCurrent = label => {
    const gs = gens();
    const max = Math.max(...gs);
    for (const g of gs) assert.equal(g, max, `${label}: every node's generation must be current`);
    return max;
  };

  // Select n1 through the canvas so the panel drives the edits.
  const first = NODE_POS('n1');
  await selectNode(window, document, 'n1', 500 + first.x, 330 + first.y);

  // Boot: every element must end the first pass stamped with the same generation.
  const bootGen = allCurrent('after boot');

  // Four successive single-node edits are four successive render passes with
  // exactly one changed element. After EVERY one of them, all untouched nodes
  // must carry the current generation — not lag one generation behind every
  // other pass (the alternate-frames bug).
  const labelInput = document.querySelector('#selNodeLabel');
  let previous = bootGen;
  for (const label of ['n1a', 'n1b', 'n1c', 'n1d']) {
    labelInput.value = label;
    labelInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle(window, 150);
    const genNow = allCurrent(`after editing n1 to ${label}`);
    assert.ok(genNow > previous, `successive passes advance the generation (${previous} → ${genNow})`);
    previous = genNow;
    // n30 is never touched by these edits — it must keep up with the latest
    // pass, pass after pass, not every other pass.
    assert.equal(genOf('n30'), previous, 'n30 keeps up with the latest pass, pass after pass');
  }

  assert.deepEqual(errors.map(e => e.message), []);
  dom.window.close();
});
