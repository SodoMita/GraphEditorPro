#!/usr/bin/env node
// Compare huge graph rendering: GraphEditorPro site vs standalone SVG file
// Generates a huge graph, renders it as pure SVG, and measures load performance in headless Chromium

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 8098;

function makeHugeGraph(nodeCount = 500, edgeCount = 2500) {
  const nodes = [];
  const cols = Math.ceil(Math.sqrt(nodeCount * 1.6));
  const spacing = 130;
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `n${i}`,
      label: `N${i}`,
      x: (i % cols - cols / 2) * spacing,
      y: (Math.floor(i / cols) - Math.sqrt(nodeCount) / 2) * spacing,
      order: i,
      shape: 'circle',
      color: '#0ea5e9',
      width: 50, height: 50
    });
  }
  const edges = [];
  // Use seeded random for reproducibility
  let seed = 12345;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < edgeCount; i++) {
    const from = Math.floor(rnd() * nodeCount);
    let to = Math.floor(rnd() * nodeCount);
    while (to === from) to = Math.floor(rnd() * nodeCount);
    edges.push({ id: `e${i}`, from: `n${from}`, to: `n${to}`, directed: rnd() > 0.3, weight: '1', label: '' });
  }
  return { nodes, edges };
}

function edgePathSvg(a, b, e) {
  const ra = 25, rb = 25;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  const sx = a.x + ux * (ra + 2), sy = a.y + uy * (ra + 2);
  const tx = b.x - ux * (rb + 18), ty = b.y - uy * (rb + 18);
  return `M ${sx} ${sy} L ${tx} ${ty}`;
}

function generateStandaloneSvg(nodes, edges, viewBox) {
  const parts = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}" style="background:#020617">`);
  parts.push(`<style>
    .edge-line{fill:none;stroke:#94a3b8;stroke-width:2.4;stroke-linecap:butt;stroke-linejoin:miter}
    .edge-arrow{fill:#94a3b8}
    .node-shape{fill:#0ea5e9;stroke:#e2e8f0;stroke-width:2.2}
    .node-label{fill:#f8fafc;font-family:Inter,sans-serif;font-size:13px;text-anchor:middle;dominant-baseline:middle;paint-order:stroke;stroke:#020617;stroke-width:4;stroke-linejoin:round}
    .edge-label{fill:#dbeafe;font-family:Inter,sans-serif;font-size:12px;text-anchor:middle;dominant-baseline:middle;paint-order:stroke;stroke:#020617;stroke-width:3;stroke-linejoin:round}
  </style>`);
  // edges
  parts.push(`<g id="edges">`);
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  for (const e of edges) {
    const a = nodeMap.get(e.from), b = nodeMap.get(e.to);
    if (!a || !b) continue;
    const d = edgePathSvg(a, b, e);
    parts.push(`<path class="edge-line" d="${d}"/>`);
    if (e.directed) {
      // simple arrowhead
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const tipX = b.x - Math.cos(angle) * 25, tipY = b.y - Math.sin(angle) * 25;
      const aw = 8, px = -Math.sin(angle) * aw, py = Math.cos(angle) * aw;
      parts.push(`<polygon class="edge-arrow" points="${tipX},${tipY} ${tipX + px - Math.cos(angle) * 18},${tipY + py - Math.sin(angle) * 18} ${tipX - px - Math.cos(angle) * 18},${tipY - py - Math.sin(angle) * 18}"/>`);
    }
  }
  parts.push(`</g>`);
  // nodes
  parts.push(`<g id="nodes">`);
  for (const n of nodes) {
    parts.push(`<g transform="translate(${n.x},${n.y})">`);
    parts.push(`<ellipse class="node-shape" rx="25" ry="25"/>`);
    if (n.label) parts.push(`<text class="node-label" x="0" y="0">${n.label.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</text>`);
    parts.push(`</g>`);
  }
  parts.push(`</g>`);
  parts.push(`</svg>`);
  return parts.join('\n');
}

function makeGraphEditorJson(nodes, edges) {
  return {
    title: `huge-${nodes.length}n-${edges.length}e`,
    mode: 'select',
    nextNode: nodes.length + 1,
    nextEdge: edges.length + 1,
    nodes,
    edges,
    viewBox: { x: -1000, y: -1000, w: 2000, h: 2000 },
    settings: {
      nodeShape: 'circle', nodeColor: '#0ea5e9', nodeWidth: 50, nodeHeight: 50,
      nodeStrokeColor: '#e2e8f0', nodeStrokeSize: 2.2, nodeStrokeStyle: 'solid',
      nodeType: '', nodeLabelColor: '#f8fafc', nodeLabelFont: 'Inter', nodeLabelSize: 13, nodeLabelPosition: 'center',
      directed: true, edgeWeight: '1', edgeLabel: '', edgeType: '', edgeColor: '#94a3b8', edgeStrokeSize: 2.4, edgeStrokeStyle: 'solid',
      edgeLabelColor: '#dbeafe', edgeLabelFont: 'Inter', edgeLabelSize: 12,
      snap: false, snapX: false, snapY: false, gridSize: 40, gridSizeX: 40, gridSizeY: 40,
      autosave: false, matrixLimit: 90, edgeListPageSize: 250, matrixDimension: 0, brushDiameter: 80,
      hitTestMode: 'any', inheritDefaults: true, noLabel: false,
      visibleRange: { start: -1, end: -1 },
      canvasBgColor: '#020617', gridMinorColor: '#94a3b8', gridMajorColor: '#94a3b8', gridMinorAlpha: 0.105, gridMajorAlpha: 0.16,
      graphDefaults: { labelsPolicy: 'auto', labelOutline: 'outline', labelOutlineColor: '#020617', labelOutlineWidth: 4, edgeWeightMode: 'number', edgeWeightMin: 1, edgeWeightMax: 10, edgeWeightCorr: 'linear', edgeWidthMin: 1, edgeWidthMax: 8, edgeWeightColorLow: '#22d3ee', edgeWeightColorHigh: '#f59e0b' },
      nodeDefaults: { type: '', color: '#0ea5e9', labelColor: '#f8fafc', labelFont: 'Inter', labelSize: 13, labelPosition: 'center', shape: 'circle', width: 50, height: 50, strokeColor: '#e2e8f0', strokeSize: 2.2, strokeStyle: 'solid' },
      edgeDefaults: { type: '', color: '#94a3b8', labelColor: '#dbeafe', labelFont: 'Inter', labelSize: 12, strokeSize: 2.4, strokeStyle: 'solid' },
      nodeTypeStyles: {}, edgeTypeStyles: {}, stylePresets: []
    },
    selected: null, selection: { nodes: [], edges: [] }
  };
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
  };
  const nodeCount = parseInt(getArg('nodes', '500'), 10);
  const edgeCount = parseInt(getArg('edges', '2500'), 10);

  console.log(`Generating huge graph: ${nodeCount} nodes, ${edgeCount} edges`);
  const { nodes, edges } = makeHugeGraph(nodeCount, edgeCount);

  // Calculate viewBox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
  }
  const vb = { x: minX - 200, y: minY - 200, w: (maxX - minX) + 400, h: (maxY - minY) + 400 };

  // Generate standalone SVG
  const svgContent = generateStandaloneSvg(nodes, edges, vb);
  const svgPath = `/tmp/huge-graph-${nodeCount}n-${edgeCount}e.svg`;
  await writeFile(svgPath, svgContent, 'utf8');
  console.log(`\nStandalone SVG: ${svgPath}`);
  console.log(`  File size: ${(svgContent.length / 1024).toFixed(1)} KB`);
  console.log(`  Elements: ${nodes.length} nodes + ${edges.length} edges = ${nodes.length + edges.length} groups, ~${svgContent.split('<path').length - 1 + svgContent.split('<ellipse').length - 1} shapes`);

  // Generate GraphEditorPro JSON for site version
  const graphJson = makeGraphEditorJson(nodes, edges);
  const jsonPath = `/tmp/huge-graph-${nodeCount}n-${edgeCount}e.json`;
  await writeFile(jsonPath, JSON.stringify(graphJson, null, 2), 'utf8');
  console.log(`\nGraphEditor JSON: ${jsonPath}`);
  console.log(`  File size: ${(JSON.stringify(graphJson).length / 1024).toFixed(1)} KB`);

  // Generate HTML wrappers for comparison
  const siteHtml = await readFile('index.html', 'utf8');
  // Inject graph via localStorage like tests do
  const siteWithGraph = siteHtml.replace('<script>', `<script>localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(graphJson))});</script><script>`);
  const sitePath = `/tmp/huge-site-${nodeCount}n-${edgeCount}e.html`;
  await writeFile(sitePath, siteWithGraph, 'utf8');
  console.log(`\nSite version (index.html + graph): ${sitePath}`);
  console.log(`  File size: ${(siteWithGraph.length / 1024).toFixed(1)} KB`);

  const pureSvgHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Huge Graph ${nodeCount}n ${edgeCount}e - Pure SVG</title><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#020617;overflow:hidden}svg{width:100%;height:100%;display:block}</style></head><body>${svgContent.replace('<?xml version="1.0" encoding="UTF-8"?>','')}</body></html>`;
  const purePath = `/tmp/huge-pure-${nodeCount}n-${edgeCount}e.html`;
  await writeFile(purePath, pureSvgHtml, 'utf8');
  console.log(`\nPure SVG HTML wrapper: ${purePath}`);
  console.log(`  File size: ${(pureSvgHtml.length / 1024).toFixed(1)} KB`);

  // Start server and measure with Playwright if available
  console.log(`\n=== Performance comparison ===`);
  console.log(`To view manually:`);
  console.log(`  - Pure SVG file: file://${svgPath} (open directly in browser)`);
  console.log(`  - Pure SVG HTML: file://${purePath}`);
  console.log(`  - Site version: file://${sitePath}`);
  console.log(`  - Or serve via: npx serve /tmp`);

  // Try to launch browser for automated measurement
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const { chromium } = require('playwright');
    
    // Find browser binary
    const browserDirs = [process.env.BROWSER_DIR, '/tmp/browser', `${process.env.HOME}/.browser`].filter(Boolean);
    let browserDir = null;
    for (const dir of browserDirs) {
      if (existsSync(`${dir}/chromium`)) { browserDir = dir; break; }
    }
    if (!browserDir) {
      console.log(`\nNo Chromium found for automated bench (run scripts/browser-setup.sh)`);
      console.log(`Manual comparison recommended: open both files and check DevTools Performance`);
      return;
    }

    const server = createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname === '/site') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(siteWithGraph);
      } else if (url.pathname === '/pure') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(pureSvgHtml);
      } else if (url.pathname === '/svg') {
        res.writeHead(200, { 'content-type': 'image/svg+xml' });
        res.end(svgContent);
      } else {
        res.writeHead(404); res.end('not found');
      }
    });
    await new Promise(r => server.listen(PORT, '127.0.0.1', r));
    console.log(`\nServer listening on http://127.0.0.1:${PORT}`);

    const proc = spawn(`${browserDir}/chromium`, [
      '--headless=new', '--remote-debugging-port=9334', '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=/tmp/svg-bench-profile', '--window-size=1440,900', 'about:blank'
    ], {
      env: { ...process.env, LD_LIBRARY_PATH: `${browserDir}/lib`, FONTCONFIG_FILE: `${browserDir}/fonts.conf` },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    for (let i = 0; i < 150; i++) {
      try { if ((await fetch('http://127.0.0.1:9334/json/version')).ok) break; } catch {}
      await sleep(200);
    }
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9334');

    async function measurePage(pageUrl, name) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      
      const t0 = Date.now();
      await page.goto(pageUrl, { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      const t1 = Date.now();
      
      const { metrics } = await cdp.send('Performance.getMetrics');
      const get = n => metrics.find(m => m.name === n)?.value || 0;
      
      const info = await page.evaluate(() => ({
        totalElements: document.querySelectorAll('*').length,
        svgElements: document.querySelectorAll('svg *').length,
        nodes: document.querySelectorAll('[id^=\"node-\"]').length || document.querySelectorAll('#nodes g').length,
        edges: document.querySelectorAll('[id^=\"edge-\"]').length || document.querySelectorAll('#edges path').length,
      }));
      
      await context.close();
      return {
        name,
        loadMs: t1 - t0,
        task: (get('TaskDuration') * 1000).toFixed(0),
        script: (get('ScriptDuration') * 1000).toFixed(0),
        style: (get('RecalcStyleDuration') * 1000).toFixed(0),
        layout: (get('LayoutDuration') * 1000).toFixed(0),
        ...info
      };
    }

    console.log(`\nMeasuring...`);
    const pureResult = await measurePage(`http://127.0.0.1:${PORT}/pure`, 'pure-svg');
    const siteResult = await measurePage(`http://127.0.0.1:${PORT}/site`, 'site');

    console.log(`\n=== Results for ${nodeCount}n ${edgeCount}e ===`);
    console.log(`Pure SVG:`);
    console.log(`  Load: ${pureResult.loadMs}ms, Task: ${pureResult.task}ms, Script: ${pureResult.script}ms, Style: ${pureResult.style}ms, Layout: ${pureResult.layout}ms`);
    console.log(`  DOM: ${pureResult.totalElements} total, ${pureResult.svgElements} svg, ${pureResult.nodes} nodes, ${pureResult.edges} edges`);
    console.log(`Site (GraphEditorPro):`);
    console.log(`  Load: ${siteResult.loadMs}ms, Task: ${siteResult.task}ms, Script: ${siteResult.script}ms, Style: ${siteResult.style}ms, Layout: ${siteResult.layout}ms`);
    console.log(`  DOM: ${siteResult.totalElements} total, ${siteResult.svgElements} svg, ${siteResult.nodes} nodes, ${siteResult.edges} edges`);
    console.log(`\nDifference:`);
    console.log(`  Load overhead: +${siteResult.loadMs - pureResult.loadMs}ms (${((siteResult.loadMs/pureResult.loadMs-1)*100).toFixed(0)}%)`);
    console.log(`  Total DOM overhead: ${siteResult.totalElements - pureResult.totalElements} elements`);
    console.log(`  Task overhead: +${siteResult.task - pureResult.task}ms`);

    await browser.close();
    proc.kill('SIGKILL');
    server.close();
  } catch (e) {
    console.log(`\nAutomated measurement failed: ${e.message}`);
    console.log(`Manual comparison: open files in browser and use DevTools > Performance`);
  }
}

main().catch(console.error);
