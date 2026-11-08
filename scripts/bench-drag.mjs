// Drag-gesture harness: measures the *start* (pointerdown → selection + drag
// arm) and *end* (pointerup → release) of a node drag in a real headless
// Chromium, which is where a drag feels sticky. Every drag is driven inside the
// page — synthetic pointer events plus a continuous rAF loop — so a frame gap
// is attributed to main-thread work wherever it happens (handler, style,
// layout, paint or a deferred callback), never to CDP round trips.
//
//   node scripts/bench-drag.mjs --nodes 100,500,1500 --runs 3
//   node scripts/bench-drag.mjs --graph hub --nodes 2500   # a very high degree node
//   node scripts/bench-drag.mjs --build main=/tmp/gep-base # compare revisions
//
// Reported per size:
//   press:  js     — synchronous pointerdown handler time
//           gap    — worst frame gap in the frames right after the press
//   release: js    — synchronous pointerup handler time
//            gap   — worst frame gap in the frames right after the release
//   post-release   — worst frame gap and how much main-thread time went into
//                    frames over 20 ms, across the 600 ms after the release
//                    (catches work that was merely pushed off the release:
//                    a queued render pass, a snapshot, the autosave write)
//
// --graph hub drags the centre of a star, i.e. a node with more edges than the
// live-drag budget can repaint per frame. --profile adds a sampling profile of
// one press and one release (self time per function).
//
// The browser comes from scripts/browser-setup.sh ($BROWSER_DIR, default
// $HOME/.browser or /tmp/browser).
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const values = args.reduce((acc, value, index) => (value === `--${name}` ? [...acc, args[index + 1]] : acc), []);
  return values.length ? values : [fallback];
};
const GRAPH = argOf('graph', 'grid')[0];
const SIZES = argOf('nodes', '100,500,1500').flatMap(value => value.split(',')).map(Number);
const RUNS = Number(argOf('runs', '3')[0]);
const OUT = argOf('out', '')[0];
const PORT = Number(argOf('port', '8098')[0]);
const PROFILE = args.includes('--profile');
const BUILDS = argOf('build', '').filter(Boolean)
  .map(spec => { const [name, dir] = spec.split('='); return { name, dir: dir || '.' }; });
if (!BUILDS.length) BUILDS.push({ name: 'current', dir: '.' });
BUILDS.forEach(build => { build.dir = path.resolve(build.dir); });

if (typeof WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch {} }

// ---------------------------------------------------------------- graph data
// Same generator as perf-bench: a grid with short-range diagonals, so a node in
// the middle has a realistic handful of incident edges.
// A star: one hub with `nodeCount - 1` leaves, so dragging the hub has a very
// high edge degree — the case where a drag cannot update every edge live.
function makeHubGraph(nodeCount) {
  const nodes = [{ id: 'hub', label: 'Hub', x: 0, y: 0 }];
  const edges = [];
  for (let i = 1; i < nodeCount; i++) {
    const angle = (i / Math.max(1, nodeCount - 1)) * Math.PI * 2;
    nodes.push({ id: `n${i}`, label: `Leaf ${i}`, x: Math.cos(angle) * (300 + (i % 7) * 90), y: Math.sin(angle) * (300 + (i % 5) * 90) });
    edges.push({ id: `e${i}`, from: 'hub', to: `n${i}`, directed: true, weight: '1' });
  }
  return { title: `drag-hub-${nodeCount}`, mode: 'select', nodes, edges, viewBox: { x: -1100, y: -900, w: 2200, h: 1800 } };
}
function makeGraph(nodeCount) {
  const nodes = [], edges = [];
  const cols = Math.ceil(Math.sqrt(nodeCount * 1.6)) || 1;
  const rows = Math.ceil(nodeCount / cols) || 1;
  const spacing = 130;
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `n${i}`, label: `Node ${i}`,
      x: (i % cols - cols / 2) * spacing, y: (Math.floor(i / cols) - rows / 2) * spacing,
    });
  }
  let eid = 0;
  const addEdge = (from, to, directed) => edges.push({ id: `e${eid++}`, from: `n${from}`, to: `n${to}`, directed, weight: '1' });
  for (let i = 0; i < nodeCount; i++) {
    if (i + 1 < nodeCount && (i + 1) % cols !== 0) addEdge(i, i + 1, true);
    if (i + cols < nodeCount) addEdge(i, i + cols, true);
    if (i + 2 < nodeCount && (i + 2) % cols !== 0) addEdge(i, i + 2, false);
  }
  return {
    title: `drag-bench-${nodeCount}`, mode: 'select', nodes, edges,
    viewBox: { x: -(cols * spacing + 400) / 2, y: -(rows * spacing + 400) / 2, w: cols * spacing + 400, h: rows * spacing + 400 },
  };
}
const DRAG_STEPS = size => (size <= 200 ? 8 : size <= 600 ? 6 : 4);

// -------------------------------------------------------------- static server
function startServer() {
  const server = createServer(async (request, response) => {
    const [name, file] = new URL(request.url, 'http://localhost').pathname.split('/').filter(Boolean);
    const build = BUILDS.find(candidate => candidate.name === name);
    if (!build || file !== 'index.html') { response.writeHead(404).end('not found'); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(await readFile(path.join(build.dir, 'index.html')));
  });
  return new Promise(resolve => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

// ------------------------------------------------------------------- browser
function browserBinary() {
  const dirs = [process.env.BROWSER_DIR, '/tmp/browser', path.join(process.env.HOME || '', '.browser')].filter(Boolean);
  for (const dir of dirs) if (existsSync(path.join(dir, 'chromium'))) return dir;
  throw new Error('no Chromium found: run scripts/browser-setup.sh (sets $BROWSER_DIR)');
}
async function launchBrowser() {
  const dir = browserBinary();
  const proc = spawn(path.join(dir, 'chromium'), [
    '--headless=new', '--remote-debugging-port=9334', '--no-sandbox', '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--user-data-dir=/tmp/drag-bench-profile', '--window-size=1440,900', 'about:blank',
  ], {
    env: { ...process.env, LD_LIBRARY_PATH: dir + '/lib', FONTCONFIG_FILE: path.join(dir, 'fonts.conf') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const { chromium } = require('playwright');
  for (let attempt = 0; attempt < 150; attempt++) {
    try { if ((await fetch('http://127.0.0.1:9334/json/version')).ok) break; } catch {}
    await sleep(200);
  }
  return { browser: await chromium.connectOverCDP('http://127.0.0.1:9334'), proc };
}

// ------------------------------------------------------------------ page glue
async function openBuild(browser, build, graph) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(saved => {
    localStorage.setItem('graph-editor-pro-v2', JSON.stringify(saved));
    localStorage.setItem('graph-editor-pro-autosave', 'true');
  }, graph);
  await page.goto(`http://127.0.0.1:${PORT}/${build.name}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#sceneLayer [id^="node-"]').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(900); // initial render + sidebar debounce
  return { context, page };
}

// One drag cycle, timed entirely in the page so the numbers are main-thread
// work, not CDP round trips. A continuous rAF loop records frame timestamps, so
// a stall shows up as a gap between frames wherever it happens (handler, style,
// layout or paint). The press starts from an empty canvas so the worst case —
// a press that has to change the selection — is what gets measured.
async function measureDrag(page, steps) {
  return page.evaluate(async steps => {
    const svg = document.querySelector('#graphCanvas');
    const rect = (document.querySelector('#gridLayer') || svg).getBoundingClientRect();
    const nodes = [...document.querySelectorAll('#sceneLayer [id^="node-"]')];
    const target = document.getElementById('node-hub') || nodes[Math.floor(nodes.length / 2)];
    const box = target.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const empty = { x: rect.left + 12, y: rect.top + rect.height - 12 };
    const pointer = (type, x, y) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y,
    });
    const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve(performance.now())));
    const settle = async () => { await frame(); await frame(); await new Promise(resolve => setTimeout(resolve, 90)); };

    const frames = [];
    let recording = true;
    const loop = () => { frames.push(performance.now()); if (recording) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    const gapsSince = mark => {
      const after = frames.filter(time => time > mark);
      const out = [];
      let previous = mark;
      for (const time of after) { out.push(time - previous); previous = time; }
      return out;
    };
    const stallSince = mark => Math.max(0, ...gapsSince(mark).slice(0, 12));

    // Clear the selection on the empty canvas, and let that settle.
    svg.dispatchEvent(pointer('pointerdown', empty.x, empty.y));
    svg.dispatchEvent(pointer('pointerup', empty.x, empty.y));
    await settle();

    const startAt = performance.now();
    target.dispatchEvent(pointer('pointerdown', cx, cy));
    const startMs = performance.now() - startAt;
    await frame();
    const startStall = stallSince(startAt);

    for (let step = 1; step <= steps; step++) {
      svg.dispatchEvent(pointer('pointermove', cx + step * 3, cy + step * 2));
      await frame();
    }

    const endAt = performance.now();
    svg.dispatchEvent(pointer('pointerup', cx + steps * 3, cy + steps * 2));
    const endMs = performance.now() - endAt;
    await frame();
    const endStall = stallSince(endAt || 1);

    // Watch frames for 600 ms after the release: deferred work (a queued render
    // pass, the debounced autosave write) shows up as a main-thread gap here.
    const watchUntil = endAt + 600;
    while (performance.now() < watchUntil) await frame();
    const endJank = stallSince(endAt);
    const lateGaps = gapsSince(endAt).filter(gap => gap > 20);
    recording = false;
    return { startMs, endMs, startStall, endStall, endJank, longGaps: lateGaps.length, longGapMs: +lateGaps.reduce((sum, gap) => sum + gap, 0).toFixed(0) };
  }, steps);
}

// Sampling profiler for one press or one release: which functions own the time?
async function profileOnce(page, kind) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await page.evaluate(kind => { window.__profileTarget = kind; }, kind);
  await cdp.send('Profiler.start');
  await page.evaluate(async kind => {
    const svg = document.querySelector('#graphCanvas');
    const rect = (document.querySelector('#gridLayer') || svg).getBoundingClientRect();
    const nodes = [...document.querySelectorAll('#sceneLayer [id^="node-"]')];
    const target = document.getElementById('node-hub') || nodes[Math.floor(nodes.length / 2)];
    const box = target.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const empty = { x: rect.left + 12, y: rect.top + rect.height - 12 };
    const pointer = (type, x, y) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y,
    });
    const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
    svg.dispatchEvent(pointer('pointerdown', empty.x, empty.y));
    svg.dispatchEvent(pointer('pointerup', empty.x, empty.y));
    await frame(); await frame();
    if (kind === 'start') {
      target.dispatchEvent(pointer('pointerdown', cx, cy));
      await frame();
      svg.dispatchEvent(pointer('pointerup', cx, cy));
    } else {
      target.dispatchEvent(pointer('pointerdown', cx, cy));
      await frame();
      for (let step = 1; step <= 3; step++) { svg.dispatchEvent(pointer('pointermove', cx + step * 20, cy)); await frame(); }
      svg.dispatchEvent(pointer('pointerup', cx + 60, cy));
    }
    await frame();
  }, kind);
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.send('Profiler.disable').catch(() => {});
  // Self time per (function, url:line) from the sampling profile.
  const self = new Map();
  const byId = new Map(profile.nodes.map(node => [node.id, node]));
  const total = profile.samples.length || 1;
  const counts = new Map();
  for (const id of profile.samples) counts.set(id, (counts.get(id) || 0) + 1);
  for (const [id, count] of counts) {
    const node = byId.get(id);
    const name = node.callFrame.functionName || '(anonymous)';
    const where = `${(node.callFrame.url || '').split('/').pop() || 'inline'}:${node.callFrame.lineNumber + 1}`;
    const key = `${name} ${where}`;
    self.set(key, (self.get(key) || 0) + count);
  }
  return [...self.entries()]
    .map(([key, count]) => ({ key, pct: +(100 * count / total).toFixed(1) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 12);
}

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +sorted.at(-1).toFixed(2) };
}

// ---------------------------------------------------------------------- main
const server = await startServer();
const { browser, proc } = await launchBrowser();
const results = [];
const pad = (value, width) => String(value).padStart(width);
try {
  for (const size of SIZES) {
    const graph = GRAPH === 'hub' ? makeHubGraph(size) : makeGraph(size);
    for (const build of BUILDS) {
      const { context, page } = await openBuild(browser, build, graph);
      const runs = [];
      // Warm-up drag, discarded: first-paint JIT and layout paths are not what
      // a user's second drag feels like.
      await measureDrag(page, DRAG_STEPS(size));
      for (let run = 0; run < RUNS; run++) runs.push(await measureDrag(page, DRAG_STEPS(size)));
      let profiles = null;
      if (PROFILE) profiles = { start: await profileOnce(page, 'start'), end: await profileOnce(page, 'end') };
      await context.close();
      const summaryRun = {
        build: build.name, size, runs,
        startMs: summary(runs.map(run => run.startMs)),
        endMs: summary(runs.map(run => run.endMs)),
        startStall: summary(runs.map(run => run.startStall)),
        endStall: summary(runs.map(run => run.endStall)),
        endJank: summary(runs.map(run => run.endJank)),
        longGaps: summary(runs.map(run => run.longGaps)),
        longGapMs: summary(runs.map(run => run.longGapMs)),
        profiles,
      };
      results.push(summaryRun);
      console.log(
        `[${pad(size, 4)}n ${GRAPH.padEnd(4)}] ${build.name.padEnd(8)} ` +
        `press: js=${pad(summaryRun.startMs.median, 5)}ms frame-gap=${pad(summaryRun.startStall.median, 5)}ms ` +
        `| release: js=${pad(summaryRun.endMs.median, 5)}ms frame-gap=${pad(summaryRun.endStall.median, 5)}ms ` +
        `| post-release: worst gap=${pad(summaryRun.endJank.max, 6)}ms long frames=${pad(summaryRun.longGaps.median, 3)} (${pad(summaryRun.longGapMs.median, 5)}ms lost)`,
      );
      if (profiles) {
        for (const kind of ['start', 'end']) {
          console.log(`         profile ${kind}: ` + profiles[kind].map(entry => `${entry.key} ${entry.pct}%`).join(' | '));
        }
      }
    }
  }
} finally {
  await browser.close().catch(() => {});
  proc.kill('SIGKILL');
  server.close();
}
if (OUT) {
  await writeFile(OUT, JSON.stringify(results, null, 1));
  console.log(`\nwrote ${OUT}`);
}
