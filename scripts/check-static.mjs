import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile('index.html', 'utf8');
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

check(/^<!DOCTYPE html>/i.test(html), 'output must start with an HTML doctype');
check((html.match(/<style\b/gi) ?? []).length === 1, 'output must contain exactly one inline style block');
check((html.match(/<script\b/gi) ?? []).length === 1, 'output must contain exactly one inline script block');
check(!/<!--\s*INLINE_(?:STYLES|SCRIPT)\s*-->/.test(html), 'all build markers must be replaced');

// Runtime resources must stay embedded. Blob/data URLs created for explicit
// user downloads are local and are intentionally allowed.
const forbiddenAssets = [
  [/<script\b[^>]*\bsrc\s*=/i, 'external script source'],
  [/<link\b[^>]*\brel\s*=\s*["']?stylesheet/i, 'external stylesheet'],
  [/<(?:img|audio|video|source|iframe)\b[^>]*\bsrc\s*=/i, 'external media source'],
  [/@import\s/i, 'CSS @import'],
  [/url\(\s*["']?(?:https?:)?\/\//i, 'remote CSS URL'],
];
for (const [pattern, label] of forbiddenAssets) {
  check(!pattern.test(html), `output contains an ${label}`);
}

const forbiddenNetworkApis = [
  [/\bfetch\s*\(/, 'fetch'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'],
  [/\bnavigator\.sendBeacon\b/, 'sendBeacon'],
  [/\bimport\(/, 'dynamic import'],
];
for (const [pattern, api] of forbiddenNetworkApis) {
  check(!pattern.test(html), `output contains network-capable API: ${api}`);
}

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
if (scriptMatch) {
  try {
    new vm.Script(scriptMatch[1], { filename: 'index.html:inline-script' });
  } catch (error) {
    failures.push(`inline JavaScript is invalid: ${error.message}`);
  }
}

const staticMarkup = html.slice(0, html.indexOf('<script>'));
const ids = [...staticMarkup.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
check(new Set(ids).size === ids.length, 'output contains duplicate element IDs');

if (failures.length) {
  throw new Error(`Static output validation failed:\n- ${failures.join('\n- ')}`);
}

console.log('Static output check passed: one HTML file, all assets inline, no network APIs.');
