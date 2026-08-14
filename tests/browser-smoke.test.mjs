import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

test('generated page initializes without runtime errors', async () => {
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
        value: {
          readText: async () => '',
          writeText: async () => {},
        },
      });
    },
  });

  // Let the queued animation-frame render and timers settle.
  await new Promise(resolve => dom.window.setTimeout(resolve, 50));

  assert.deepEqual(errors.map(error => error.message), []);
  assert.match(dom.window.document.title, /Graph Editor Pro/);
  assert.equal(dom.window.document.querySelector('#statusPill')?.textContent?.length > 0, true);
  assert.equal(dom.window.document.querySelector('#graphCanvas')?.getAttribute('viewBox'), '-500 -330 1000 660');

  dom.window.close();
});
