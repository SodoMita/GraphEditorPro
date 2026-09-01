// CDP helper: connect to a running headless Chromium and drive it.
// Usage: node shot.mjs <command> [args...]
//   shot <path.png>                        — screenshot current viewport
//   eval <expression>                      — evaluate JS, print JSON result
//   click <selector>                       — click first match via JS
//   fullshot <path.png> <selector>         — screenshot an element's box
import { WebSocket } from 'ws';
import { writeFileSync } from 'node:fs';

const [,, cmd, ...args] = process.argv;
const base = 'http://127.0.0.1:9333';
const targets = await (await fetch(base + '/json')).json();
const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:8080'));
if (!page) { console.error('no page target'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.on('message', data => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
function cdp(method, params = {}) {
  return new Promise(res => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
async function evaluate(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text, detail: r.result.exceptionDetails.exception?.description };
  return r.result?.result?.value;
}
async function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

if (cmd === 'viewport') {
  const [w, h, mobile] = args;
  await cdp('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: mobile === 'mobile' });
  console.log('viewport', w, h, mobile || 'desktop');
} else if (cmd === 'shot') {
  const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(args[0], Buffer.from(r.result.data, 'base64'));
  console.log('saved', args[0]);
} else if (cmd === 'eval') {
  console.log(JSON.stringify(await evaluate(args[0]), null, 1));
} else if (cmd === 'click') {
  const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(args[0])}); if(!el) return 'no-match'; el.click(); return 'clicked'; })()`);
  console.log(ok);
} else if (cmd === 'fullshot') {
  const r = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(args[1])}); if(!el) return null; const b = el.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height}; })()`);
  if (!r) { console.error('no element'); process.exit(1); }
  const shot = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 } });
  writeFileSync(args[0], Buffer.from(shot.result.data, 'base64'));
  console.log('saved', args[0], JSON.stringify(r));
}
ws.close();
process.exit(0);
