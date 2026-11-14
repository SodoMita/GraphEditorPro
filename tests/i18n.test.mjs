import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('index.html', 'utf8');

function createEditorDom(savedGraph = null) {
  const errors = [];
  const preload = savedGraph
    ? `localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(savedGraph))});`
    : '';
  const documentHtml = preload ? html.replace('<script>', `<script>${preload}</script><script>`) : html;
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

const settle = window => new Promise(resolve => window.setTimeout(resolve, 60));

async function switchToRussian(document, window) {
  if (document.documentElement.lang !== 'ru') {
    document.querySelector('#btnLang').click();
    await settle(window);
  }
  assert.equal(document.documentElement.lang, 'ru');
}

// Everything that legitimately stays Latin in the Russian UI: product name,
// keyboard keys, file formats and the GraphML/CSS vocabulary. Anything else is
// an untranslated string.
const ALLOWED_LATIN = [
  /^Graph Editor Pro$/,
  /^(EN|RU)$/,
  /^(Alt|Shift|Ctrl|Esc|Space|Del|Backspace|Delete|Escape|Enter|Tab)$/,
  /^(Ctrl\+[A-Z]|⌘\+[A-Z])$/,
  /^(BFS|DFS|Dijkstra)$/,
  /^(JSON|DOT|GraphML|CSV)$/,
  // GraphML attribute types are schema keywords written into the file as-is.
  /^(boolean|int|long|float|double|string)$/,
  /^Inter$/,
  /^[\d\s.,×·:/()%–-]+$/,
];

const isAllowedLatin = text => ALLOWED_LATIN.some(pattern => pattern.test(text));

function latinLeafTexts(root) {
  const found = [];
  for (const element of root.querySelectorAll('*')) {
    if (element.children.length) continue;
    const text = (element.textContent || '').trim();
    if (!text) continue;
    if (!/[A-Za-z]{2,}/.test(text)) continue;
    if (/[А-Яа-яЁё]/.test(text)) continue;
    found.push(text);
  }
  return [...new Set(found)];
}

const saved = {
  title: 'sample',
  nodes: [
    { id: 'n1', label: 'A', x: 0, y: 0, order: 0 },
    { id: 'n2', label: 'B', x: 160, y: 0, order: 1 },
    { id: 'n3', label: 'C', x: 320, y: 0, order: 2 },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', weight: '3', directed: true },
    { id: 'e2', from: 'n2', to: 'n3', weight: '4', directed: false },
  ],
  settings: {},
};

test('node shape options are translated in every select that lists them', async () => {
  const { dom, errors } = createEditorDom(saved);
  const { window } = dom;
  const document = window.document;
  await settle(window);
  await switchToRussian(document, window);

  for (const selector of ['#nodeShape', '#defNodeShape', '#ntsShape']) {
    const select = document.querySelector(selector);
    assert.ok(select, `${selector} exists`);
    const labels = [...select.options].map(option => option.textContent.trim());
    assert.ok(labels.length >= 6, `${selector} lists every shape`);
    for (const label of labels) {
      assert.doesNotMatch(label, /^(Circle|Square|Diamond|Triangle|Hexagon)/, `${selector} option "${label}" is translated`);
    }
    assert.ok(labels.includes('Круг'), `${selector} shows the Russian for Circle`);
  }
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('switching language re-translates the Style-tab shape select', async () => {
  const { dom, errors } = createEditorDom(saved);
  const { window } = dom;
  const document = window.document;
  await settle(window);
  const english = [...document.querySelector('#defNodeShape').options].map(option => option.textContent.trim());
  assert.deepEqual(english, ['Circle', 'Square', 'Diamond', 'Triangle up', 'Triangle down', 'Hexagon']);

  await switchToRussian(document, window);
  const russian = [...document.querySelector('#defNodeShape').options].map(option => option.textContent.trim());
  assert.deepEqual(russian, ['Круг', 'Квадрат', 'Ромб', 'Треугольник вверх', 'Треугольник вниз', 'Шестиугольник']);
  assert.equal(document.querySelector('#defNodeShape').value, 'circle', 'the selected value survives the switch');

  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('the pivot is called "точка опоры" and never "пивот"', async () => {
  const { dom, errors } = createEditorDom(saved);
  const { window } = dom;
  const document = window.document;
  await settle(window);
  await switchToRussian(document, window);

  const rotateButton = document.querySelector('[data-gizmotool="rotate"]');
  for (const attribute of ['title', 'aria-label']) {
    const label = rotateButton.getAttribute(attribute);
    if (!label) continue;
    assert.match(label, /точк[аиу] опоры/i, `${attribute} names the pivot in Russian`);
    assert.doesNotMatch(label, /пивот/i, `${attribute} avoids "пивот"`);
  }
  assert.match(rotateButton.getAttribute('title'), /точк[аиу] опоры/i);

  const help = document.querySelector('[data-i18n-html="help_gizmo"]').textContent;
  assert.match(help, /точк[аиу] опоры/i);
  assert.doesNotMatch(help, /пивот/i);

  const sidebarKeys = document.querySelector('[data-i18n="gizmo_keys"]').textContent;
  assert.match(sidebarKeys, /точку опоры/i);
  assert.doesNotMatch(sidebarKeys, /пивот/i);

  assert.doesNotMatch(document.body.textContent, /пивот/i, 'no "пивот" anywhere in the Russian interface');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('Russian count strings use real plural forms instead of "узл(ов)"', async () => {
  const expectations = [
    { nodes: 1, edges: 0, text: '1 узел · 0 рёбер' },
    { nodes: 2, edges: 1, text: '2 узла · 1 ребро' },
    { nodes: 3, edges: 3, text: '3 узла · 3 ребра' },
    { nodes: 5, edges: 0, text: '5 узлов · 0 рёбер' },
    { nodes: 21, edges: 22, text: '21 узел · 22 ребра' },
    { nodes: 111, edges: 11, text: '111 узлов · 11 рёбер' },
  ];
  for (const { nodes, edges, text } of expectations) {
    const graph = {
      title: 'counts',
      nodes: Array.from({ length: nodes }, (_, index) => ({ id: 'n' + index, label: 'N' + index, x: index * 30, y: 0, order: index })),
      edges: nodes < 2 ? [] : Array.from({ length: edges }, (_, index) => ({
        id: 'e' + index, from: 'n0', to: 'n1', weight: '1', directed: true,
      })),
      settings: {},
    };
    const { dom, errors } = createEditorDom(graph);
    const { window } = dom;
    const document = window.document;
    await settle(window);
    await switchToRussian(document, window);
    const stats = document.querySelector('#statsPill').textContent;
    assert.ok(stats.includes(text), `expected "${text}" in "${stats}"`);
    assert.doesNotMatch(stats, /узл\(|ребр\(/, 'no parenthesised plural placeholders');
    assert.deepEqual(errors.map(error => error.message), []);
    dom.window.close();
  }
});

test('no Russian panel is left with untranslated English copy', async () => {
  const { dom, errors } = createEditorDom(saved);
  const { window } = dom;
  const document = window.document;
  await settle(window);
  await switchToRussian(document, window);

  const leftovers = [];
  for (const selector of ['#panel-edit', '#panel-style', '#panel-algo', '#panel-data', '#panel-help', '#selectionPanel']) {
    const panel = document.querySelector(selector);
    assert.ok(panel, `${selector} exists`);
    for (const text of latinLeafTexts(panel)) {
      if (!isAllowedLatin(text)) leftovers.push(`${selector}: ${text}`);
    }
  }
  // Selects are filled at runtime too (shape select, weight correlation, ...).
  for (const select of document.querySelectorAll('#panel-style select, #panel-edit select')) {
    for (const option of select.options) {
      const label = option.textContent.trim();
      if (!label || !/[A-Za-z]{2,}/.test(label) || /[А-Яа-яЁё]/.test(label)) continue;
      if (!isAllowedLatin(label)) leftovers.push(`${select.id || 'select'}: option ${label}`);
    }
  }
  assert.deepEqual(leftovers, [], 'untranslated copy found');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('group labels and the algorithm buttons follow the interface language', async () => {
  const { dom, errors } = createEditorDom(saved);
  const { window } = dom;
  const document = window.document;
  await settle(window);
  await switchToRussian(document, window);

  for (const selector of ['.toolbar', '.view-toggle', '#toolsPanel .tabs', '.zoom-controls', '.mode-fab', '.sel-tools', '.edge-tools', '#docTitleInput']) {
    const element = document.querySelector(selector);
    assert.ok(element, `${selector} exists`);
    const label = element.getAttribute('aria-label') || '';
    assert.match(label, /[А-Яа-яЁё]/, `${selector} aria-label is translated (got "${label}")`);
  }

  assert.equal(document.querySelector('#btnComponents').textContent.trim(), 'Компоненты');
  assert.equal(document.querySelector('#btnStats').textContent.trim(), 'Статистика');
  assert.equal(document.querySelector('#btnTopo').textContent.trim(), 'Топология');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('every data-i18n key used by the markup has a dictionary entry', async () => {
  const attributes = ['data-i18n', 'data-i18n-title', 'data-i18n-aria-label', 'data-i18n-placeholder', 'data-i18n-value', 'data-i18n-html'];
  const { dom, errors } = createEditorDom(saved);
  const { window } = dom;
  const document = window.document;
  await settle(window);
  await switchToRussian(document, window);
  // A key with no dictionary entry stays visible as the raw key name.
  const missing = [];
  for (const element of document.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-aria-label], [data-i18n-placeholder], [data-i18n-value], [data-i18n-html]')) {
    for (const attribute of attributes) {
      const key = element.getAttribute(attribute);
      if (!key) continue;
      const rendered = attribute === 'data-i18n' || attribute === 'data-i18n-html'
        ? element.textContent.trim()
        : attribute === 'data-i18n-title'
          ? (element.getAttribute('title') || '').trim()
          : attribute === 'data-i18n-aria-label'
            ? (element.getAttribute('aria-label') || '').trim()
            : attribute === 'data-i18n-placeholder'
              ? (element.getAttribute('placeholder') || '').trim()
              : (element.getAttribute('value') || '').trim();
      if (rendered === key) missing.push(key);
    }
  }
  assert.deepEqual(missing, [], 'missing dictionary entries');
  assert.deepEqual(errors.map(error => error.message), []);
  dom.window.close();
});

test('the type-change toast declines the value count correctly in both languages', async () => {
  // The old copy printed the raw number with a broken Russian noun phrase
  // ("{n} несовместимых значения было удалено" — wrong for every n) and the
  // English "{n} value(s)". The count now goes through the plural table.
  const expectations = [
    { nodes: 1, en: 'removed 1 value', ru: 'несовместимых значений: 1' },
    { nodes: 3, en: 'removed 3 values', ru: 'несовместимых значений: 3' },
    { nodes: 5, en: 'removed 5 values', ru: 'несовместимых значений: 5' },
  ];
  for (const { nodes, en, ru } of expectations) {
    const graph = {
      title: 'counts',
      nodes: Array.from({ length: nodes }, (_, index) => ({
        id: 'n' + index, label: 'N' + index, x: index * 30, y: 0, order: index,
        custom: { cap: 'not-a-number' },
      })),
      edges: [],
      customAttributes: [{ id: 'cap', scope: 'node', type: 'string' }],
      settings: {},
    };
    for (const lang of ['en', 'ru']) {
      const { dom, errors } = createEditorDom(graph);
      const { window } = dom;
      const document = window.document;
      await settle(window);
      if (lang === 'ru') await switchToRussian(document, window);
      const row = [...document.querySelectorAll('.custom-attribute-row')]
        .find(element => element.querySelector('[data-attribute-field="id"]').value === 'cap');
      row.querySelector('[data-attribute-field="type"]').value = 'int';
      row.querySelector('[data-attribute-action="save"]').click();
      await settle(window);
      const toastText = [...document.querySelectorAll('.toast')].map(element => element.textContent).join(' | ');
      const expected = lang === 'ru' ? ru : en;
      assert.ok(toastText.includes(expected), `${lang}: expected "${expected}" in "${toastText}"`);
      assert.doesNotMatch(toastText, lang === 'ru' ? /значения было удалено/ : /\(s\)/, 'the old broken phrasing is gone');
      assert.deepEqual(errors.map(error => error.message), []);
      dom.window.close();
    }
  }
});
