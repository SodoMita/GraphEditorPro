#!/usr/bin/env node
/*
 * build.mjs — produce the single static `index.html` from the TypeScript sources.
 *
 * Pipeline (no bundler, no network, fully deterministic):
 *   1. Type-check src/*.ts via `tsc --noEmit` (fails the build on type errors).
 *   2. Strip types from each src/*.ts with the TypeScript transpiler
 *      (ES2022 target, no module wrapping — sources are plain scripts).
 *   3. Concatenate app files inside one IIFE in filename order
 *      (00-…, 10-…, …, 90-main.ts), matching the original architecture.
 *   4. Inline CSS + i18n + app JS into src/template.html placeholders.
 *   5. Run sanity checks on the output (placeholders resolved, balanced
 *      script tags, no fetch/XHR/external URLs), then write index.html.
 *
 * The result is a self-contained offline HTML file: no fetches, no CDN.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const outFile = join(root, 'index.html');

function fail(msg) {
  console.error('\x1b[31mBUILD FAILED:\x1b[0m ' + msg);
  process.exit(1);
}

// ---------------------------------------------------------------- 1. type-check
console.log('› type-checking (tsc --noEmit)…');
try {
  execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(root, 'tsconfig.json'), '--noEmit'], { stdio: 'inherit' });
} catch {
  fail('TypeScript type-check failed — fix the errors above.');
}

// ---------------------------------------------------------------- 2. transpile
const transpile = (code, fileName) => {
  const out = ts.transpileModule(code, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      removeComments: false,
      // Keep output as close to hand-written JS as possible.
      verbatimModuleSyntax: false,
    },
    reportDiagnostics: true,
  });
  const errors = (out.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    fail(`${fileName}: ` + errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; '));
  }
  return out.outputText.replace(/\s+$/, '');
};

const allTs = readdirSync(srcDir).filter(f => f.endsWith('.ts')).sort();
const appFiles = allTs.filter(f => /^\d/.test(f) && f !== '01-i18n.ts');
const i18nFile = '01-i18n.ts';
if (!allTs.includes(i18nFile)) fail('src/01-i18n.ts is missing');
if (!appFiles.length) fail('no numbered app sources found in src/');
console.log('› transpiling', appFiles.length + 1, 'files…');

const i18nJs = transpile(readFileSync(join(srcDir, i18nFile), 'utf8'), i18nFile);

const parts = appFiles.map(f => {
  const js = transpile(readFileSync(join(srcDir, f), 'utf8'), f);
  return `// ---- ${f} ----\n${js}`;
});
const appJs = `(() => {\n  'use strict';\n${parts.join('\n\n')}\n})();`;

// Early syntax sanity: make sure concatenated bundle parses.
try {
  new Function(appJs);
} catch (e) {
  fail('concatenated app bundle does not parse: ' + e.message);
}

// ---------------------------------------------------------------- 3. inline
const css = readFileSync(join(srcDir, 'styles.css'), 'utf8').replace(/\s+$/, '');
let html = readFileSync(join(srcDir, 'template.html'), 'utf8');

const replaceOnce = (marker, content) => {
  const idx = html.indexOf(marker);
  if (idx < 0) fail(`template.html is missing the ${marker} placeholder`);
  if (html.indexOf(marker, idx + 1) >= 0) fail(`template.html has duplicate ${marker} placeholders`);
  html = html.slice(0, idx) + content + html.slice(idx + marker.length);
};
replaceOnce('/*__STYLES__*/', css);
replaceOnce('/*__I18N__*/', i18nJs);
replaceOnce('/*__APP__*/', appJs);

// ---------------------------------------------------------------- 4. verify
console.log('› verifying output…');
if (/\/\*__(STYLES|I18N|APP)__\*\//.test(html)) fail('unresolved placeholder left in output');
const opens = (html.match(/<script>/g) || []).length;
const closes = (html.match(/<\/script>/g) || []).length;
if (opens !== 2 || closes !== 2) fail(`expected exactly 2 <script> blocks, found ${opens} open / ${closes} close`);
// The inlined JS must not contain "</script>" which would break the HTML parser.
for (const [name, code] of [['i18n', i18nJs], ['app', appJs]]) {
  if (/<\/script/i.test(code)) fail(`${name} bundle contains "</script>" — escape it as "<\\/script"`);
}
// Offline guarantee: no network primitives or external resource URLs.
const network = html.match(/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|navigator\.sendBeacon|\bimport\s*\(\s*['"`]/);
if (network) fail('output references a network primitive: ' + network[0]);
const external = html.match(/(?:src|href)\s*=\s*"(?:https?:)?\/\/[^"]*"/i);
if (external) fail('output references an external resource: ' + external[0]);

writeFileSync(outFile, html);
console.log(`✓ built index.html (${(html.length / 1024).toFixed(1)} KB, ${html.split('\n').length} lines)`);
