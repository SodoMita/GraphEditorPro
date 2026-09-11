// Perf harness for the canvas camera path. Drives synthetic 60 Hz input into a
// real headless Chromium and reports where the time goes per camera update.
//
//   node scripts/perf-bench.mjs --nodes 100,500,1500 --runs 3
//   node scripts/perf-bench.mjs --build main=/tmp/gep-main   # compare revisions
//
// Each --build is `name=directory-containing-index.html`; the default is the
// current checkout. Builds are served over HTTP from one throwaway server, so
// two revisions can be measured in the same browser session back to back.
//
// What is reported per gesture:
//   renderer task / script / style recalc / layout  — from CDP Performance
//   per-update style+layout                          — in-page probe of ONE
//                                                      camera update (the cost
//                                                      that decides smoothness)
//   frame pacing (median/p95/max, dropped frames)     — from rAF in the page
//   camera DOM writes                                 — viewBox vs transform
//
// The browser comes from scripts/browser-setup.sh ($BROWSER_DIR, default
// $HOME/.browser or /tmp/browser).
//
// Graph size is what exposes camera-path problems: style/layout work per camera
// update grows with the number of rendered elements, so a camera driven through
// the root viewBox looks fine on 20 nodes and drops every other frame at 1200.
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
const SIZES = argOf('nodes', '100,500,1500').flatMap(value => value.split(',')).map(Number);
const RUNS = Number(argOf('runs', '3')[0]);
const OUT = argOf('out', '')[0];
const PORT = Number(argOf('port', '8099')[0]);
const BUILDS = argOf('build', '').filter(Boolean)
  .map(spec => { const [name, dir] = spec.split('='); return { name, dir: dir || '.' }; });
if (!BUILDS.length) BUILDS.push({ name: 'current', dir: '.' });
BUILDS.forEach(build => { build.dir = path.resolve(build.dir); });

if (typeof WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch {} }

// ---------------------------------------------------------------- graph data
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
    title: `bench-${nodeCount}`, mode: 'select', nodes, edges,
    viewBox: { x: -(cols * spacing + 400) / 2, y: -(rows * spacing + 400) / 2, w: cols * spacing + 400, h: rows * spacing + 400 },
  };
}
const stepsFor = size => (size <= 200 ? 60 : size <= 600 ? 40 : 20);

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
    '--headless=new', '--remote-debugging-port=9333', '--no-sandbox', '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--user-data-dir=/tmp/perf-bench-profile', '--window-size=1440,900', 'about:blank',
  ], {
    env: {
      ...process.env,
      LD_LIBRARY_PATH: dir + '/lib',
      FONTCONFIG_FILE: path.join(dir, 'fonts.conf'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const { chromium } = require('playwright');
  for (let attempt = 0; attempt < 150; attempt++) {
    try { if ((await fetch('http://127.0.0.1:9333/json/version')).ok) break; } catch {}
    await sleep(200);
  }
  return { browser: await chromium.connectOverCDP('http://127.0.0.1:9333'), proc };
}

// ------------------------------------------------------------------ page glue
async function openBuild(browser, build, graph) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(saved => localStorage.setItem('graph-editor-pro-v2', JSON.stringify(saved)), graph);
  await page.goto(`http://127.0.0.1:${PORT}/${build.name}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#sceneLayer [id^="node-"]').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(900); // initial render + sidebar debounce
  const info = await page.evaluate(() => ({
    nodes: document.querySelectorAll('#sceneLayer [id^="node-"]').length,
    edges: document.querySelectorAll('#sceneLayer [id^="edge-"]').length,
    sceneElements: document.querySelectorAll('#sceneLayer *').length,
  }));
  return { context, page, info };
}

async function startRecording(page) {
  await page.evaluate(() => {
    const svg = document.querySelector('#graphCanvas');
    const camera = document.querySelector('#cameraLayer');
    const scene = document.querySelector('#sceneLayer');
    const grid = document.querySelector('#gridLayer');
    const counts = { viewBox: 0, cameraTransform: 0, sceneTransform: 0, gridStyle: 0 };
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.target === svg && record.attributeName === 'viewBox') counts.viewBox++;
        if (record.target === camera && record.attributeName === 'transform') counts.cameraTransform++;
        if (record.target === scene && record.attributeName === 'transform') counts.sceneTransform++;
        if (record.target === grid && record.attributeName === 'style') counts.gridStyle++;
      }
    });
    observer.observe(svg, { attributes: true, attributeFilter: ['viewBox'] });
    observer.observe(camera, { attributes: true, attributeFilter: ['transform'] });
    observer.observe(scene, { attributes: true, attributeFilter: ['transform'] });
    if (grid) observer.observe(grid, { attributes: true, attributeFilter: ['style'] });
    window.__perf = { frames: [], counts, observer, recording: true };
    const loop = time => { window.__perf.frames.push(time); if (window.__perf.recording) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
}
async function stopRecording(page) {
  return page.evaluate(() => {
    window.__perf.recording = false;
    window.__perf.observer.disconnect();
    return { frames: window.__perf.frames, writes: window.__perf.counts };
  });
}

const PERF_METRICS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'];
async function readMetrics(cdp) {
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const out = {};
  for (const metric of metrics) if (PERF_METRICS.includes(metric.name)) out[metric.name] = metric.value;
  return out;
}
const durationDiff = (before, after) => Object.fromEntries(PERF_METRICS.map(name =>
  [name, +((after[name] - before[name]) * (name.endsWith('Duration') ? 1000 : 1)).toFixed(2)]));

function frameStats(frames) {
  if (frames.length < 2) return { frames: frames.length };
  const deltas = frames.slice(1).map((time, index) => time - frames[index]).sort((a, b) => a - b);
  const quantile = p => deltas[Math.min(deltas.length - 1, Math.floor(p * deltas.length))];
  return {
    frames: frames.length,
    medianMs: +quantile(0.5).toFixed(2),
    p95Ms: +quantile(0.95).toFixed(2),
    maxMs: +deltas.at(-1).toFixed(2),
    droppedFrames: deltas.reduce((sum, delta) => sum + Math.max(0, Math.round(delta / 16.67) - 1), 0),
  };
}
function summary(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted.length
    ? { median: +sorted[Math.floor(sorted.length / 2)].toFixed(2), p95: +sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))].toFixed(2) }
    : null;
}

// ------------------------------------------------------------------ gestures
async function panGesture(page, cdp, steps, stepMs) {
  const box = await page.evaluate(() => {
    const rect = document.querySelector('#graphCanvas').getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  });
  const y = box.y + box.h / 2, from = box.x + box.w * 0.3, to = box.x + box.w * 0.7;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
  const started = Date.now();
  for (let step = 1; step <= steps; step++) {
    const wait = started + step * stepMs - Date.now();
    if (wait > 0) await sleep(wait);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from + (to - from) * (step / steps), y, button: 'left', buttons: 1, pointerType: 'mouse' });
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
  return Date.now() - started;
}
async function wheelGesture(page, cdp, steps, stepMs) {
  const box = await page.evaluate(() => {
    const rect = document.querySelector('#graphCanvas').getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  });
  const x = box.x + box.w / 2, y = box.y + box.h / 2;
  const started = Date.now();
  for (let step = 0; step < steps; step++) {
    const wait = started + (step + 1) * stepMs - Date.now();
    if (wait > 0) await sleep(wait);
    // A wheel event is one fixed zoom step in the wheel's direction; alternating
    // keeps a long burst inside the zoom clamp instead of pinning it.
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: step % 2 ? 100 : -100, pointerType: 'mouse' });
  }
  return Date.now() - started;
}
const runGesture = (page, cdp, kind, steps, stepMs) =>
  (kind === 'pan' ? panGesture : wheelGesture)(page, cdp, steps, stepMs);

// The probe isolates ONE camera update: dispatch one pointermove, then force
// style+layout once. It is the per-update cost, independent of input pacing.
async function probeCameraUpdate(page, samples) {
  return page.evaluate(async count => {
    const svg = document.querySelector('#graphCanvas');
    const scene = document.querySelector('#sceneLayer');
    const rect = svg.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
    const makeEvent = (type, x) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 99, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: centerY,
    });
    const handler = [], flush = [], frame = [];
    svg.dispatchEvent(makeEvent('pointerdown', centerX));
    let x = centerX;
    for (let i = 0; i < count; i++) {
      x += 2.5;
      const started = performance.now();
      svg.dispatchEvent(makeEvent('pointermove', x));
      const handled = performance.now();
      await new Promise(resolve => requestAnimationFrame(() => {
        const layoutStarted = performance.now();
        void scene.getBoundingClientRect(); // force style + layout for the new camera
        const layoutFinished = performance.now();
        handler.push(handled - started);
        flush.push(layoutFinished - layoutStarted);
        requestAnimationFrame(() => { frame.push(performance.now() - started); resolve(); });
      }));
    }
    svg.dispatchEvent(makeEvent('pointerup', x));
    return { handler: handler.slice(3), flush: flush.slice(3), frame: frame.slice(3) };
  }, samples);
}

async function measureGesture(browser, build, graph, kind, size) {
  const steps = stepsFor(size), stepMs = 16.7;
  const { context, page, info } = await openBuild(browser, build, graph);
  const cdp = await context.newCDPSession(page);
  await page.click('#modeMove').catch(() => {});
  await page.waitForTimeout(50);

  const probe = await probeCameraUpdate(page, 25);

  await startRecording(page); // warm-up gesture, discarded
  await runGesture(page, cdp, kind, Math.min(steps, 15), stepMs);
  await page.waitForTimeout(700);
  await stopRecording(page);

  await startRecording(page);
  const before = await readMetrics(cdp);
  const gestureWallMs = await runGesture(page, cdp, kind, steps, stepMs);
  const during = await readMetrics(cdp);
  await page.waitForTimeout(700); // let a deferred commit land, if the build has one
  const after = await readMetrics(cdp);
  const { frames, writes } = await stopRecording(page);
  const cameraState = await page.evaluate(() => ({
    viewBox: document.querySelector('#graphCanvas').getAttribute('viewBox'),
    cameraTransform: document.querySelector('#cameraLayer').getAttribute('transform'),
    sceneTransform: document.querySelector('#sceneLayer').getAttribute('transform'),
  }));
  await context.close();
  return {
    build: build.name, kind, size, steps, info, gestureWallMs,
    probe: { handler: summary(probe.handler), styleAndLayout: summary(probe.flush), frame: summary(probe.frame) },
    frames: frameStats(frames),
    gestureMetrics: durationDiff(before, during),
    commitMetrics: durationDiff(during, after),
    writes, cameraState,
  };
}

// ---------------------------------------------------------------------- main
const server = await startServer();
const { browser, proc } = await launchBrowser();
const results = [];
const pad = (value, width) => String(value).padStart(width);
try {
  for (const size of SIZES) {
    const graph = makeGraph(size);
    for (const build of BUILDS) {
      for (const kind of ['pan', 'wheel']) {
        const runs = [];
        for (let run = 0; run < RUNS; run++) runs.push(await measureGesture(browser, build, graph, kind, size));
        runs.sort((a, b) => a.gestureMetrics.TaskDuration - b.gestureMetrics.TaskDuration);
        const median = runs[Math.floor(runs.length / 2)];
        results.push(median);
        const metrics = median.gestureMetrics, frames = median.frames, probe = median.probe;
        console.log(
          `[${pad(size, 4)}n] ${median.build.padEnd(8)} ${kind.padEnd(5)} ` +
          `input=${pad(median.gestureWallMs, 5)}ms task=${pad(metrics.TaskDuration.toFixed(0), 5)}ms ` +
          `script=${pad(metrics.ScriptDuration.toFixed(0), 4)}ms style=${pad(metrics.RecalcStyleDuration.toFixed(0), 5)}ms layout=${pad(metrics.LayoutDuration.toFixed(0), 4)}ms ` +
          `| per update: style+layout=${pad(probe.styleAndLayout.median, 6)}ms frame=${pad(probe.frame.median, 6)}ms ` +
          `| frames=${pad(frames.frames, 3)} p95=${pad(frames.p95Ms, 6)}ms max=${pad(frames.maxMs, 7)}ms dropped=${pad(frames.droppedFrames, 4)} ` +
          `| commit task=${pad(median.commitMetrics.TaskDuration.toFixed(0), 4)}ms style=${pad(median.commitMetrics.RecalcStyleDuration.toFixed(0), 4)}ms ` +
          `| writes vb=${median.writes.viewBox} cam=${median.writes.cameraTransform} scene=${median.writes.sceneTransform} grid=${median.writes.gridStyle}`,
        );
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
