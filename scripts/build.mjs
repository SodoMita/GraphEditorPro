import { readFile, writeFile } from 'node:fs/promises';

const TEMPLATE_MARKER = '  <!-- INLINE_STYLES -->';
const SCRIPT_MARKER = '  <!-- INLINE_SCRIPT -->';

const [template, styles, compiledScript, compiledCore] = await Promise.all([
  readFile('src/template.html', 'utf8'),
  readFile('src/styles.css', 'utf8'),
  readFile('.build/app.js', 'utf8'),
  readFile('dist/core/graph-patch.js', 'utf8'),
]);

function replaceExactlyOnce(source, marker, replacement) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first < 0 || first !== last) {
    throw new Error(`Expected exactly one build marker: ${marker.trim()}`);
  }
  // Slice instead of String.replace: replacement text contains JavaScript `$`/`$$`
  // identifiers, which String.replace would interpret as substitution tokens.
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

const coreMarker = 'export const GraphPatchCore =';
if (compiledCore.split(coreMarker).length !== 2) throw new Error('Expected one core module export');
const browserCore = compiledCore.replace(coreMarker, 'const GraphPatchCore =');

// Everything is deliberately inlined. The generated file can be opened from
// disk, emailed, or hosted as-is without a server or asset requests.
const script = `  <script>\n(() => {\n  'use strict';\n${browserCore.trimEnd()}\n${compiledScript.trimEnd()}\n})();\n  </script>`;
const css = `  <style>\n${styles.trimEnd()}\n  </style>`;

let output = replaceExactlyOnce(template, TEMPLATE_MARKER, css);
output = replaceExactlyOnce(output, SCRIPT_MARKER, script);

await writeFile('index.html', output, 'utf8');
console.log(`Built index.html (${Buffer.byteLength(output).toLocaleString('en-US')} bytes)`);
