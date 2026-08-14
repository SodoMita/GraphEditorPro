import { readFile, writeFile } from 'node:fs/promises';

const TEMPLATE_MARKER = '  <!-- INLINE_STYLES -->';
const SCRIPT_MARKER = '  <!-- INLINE_SCRIPT -->';

const [template, styles, compiledScript] = await Promise.all([
  readFile('src/template.html', 'utf8'),
  readFile('src/styles.css', 'utf8'),
  readFile('.build/app.js', 'utf8'),
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

// Everything is deliberately inlined. The generated file can be opened from
// disk, emailed, or hosted as-is without a server or asset requests.
const script = `  <script>\n(() => {\n  'use strict';\n${compiledScript.trimEnd()}\n})();\n  </script>`;
const css = `  <style>\n${styles.trimEnd()}\n  </style>`;

let output = replaceExactlyOnce(template, TEMPLATE_MARKER, css);
output = replaceExactlyOnce(output, SCRIPT_MARKER, script);

await writeFile('index.html', output, 'utf8');
console.log(`Built index.html (${Buffer.byteLength(output).toLocaleString('en-US')} bytes)`);
