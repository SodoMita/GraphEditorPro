// Fast loader for the pure DOT-parsing core (src/app/46-dot-core.ts).
// The section between the DOT-CORE markers is TypeScript with zero DOM or
// app-state references; this harness transpiles just that section (plus the
// one shared app helper it calls, safeId from 10-core.ts, taken verbatim)
// and evaluates it. The app bundle is built from the same sources, so the
// unit tests exercise exactly what ships — without booting jsdom per case.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const coreFile = readFileSync(join(root, 'src/app/46-dot-core.ts'), 'utf8');
const begin = coreFile.indexOf('// === DOT-CORE-BEGIN ===');
const end = coreFile.indexOf('// === DOT-CORE-END ===');
if(begin < 0 || end < 0 || end <= begin){
  throw new Error('DOT-CORE markers are missing from src/app/46-dot-core.ts');
}
const core = coreFile.slice(begin, end);

const core10 = readFileSync(join(root, 'src/app/10-core.ts'), 'utf8');
const safeIdMatch = /  function safeId\(value: unknown, prefix: string\): string \{[\s\S]*?\n  \}/.exec(core10);
if(!safeIdMatch){
  throw new Error('safeId implementation not found in src/app/10-core.ts — the harness must stay in sync');
}

const js = ts.transpileModule(safeIdMatch[0] + '\n' + core, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;

const names = ['parseAttrList', 'dotUnescape', 'cleanDotToken', 'stripDotComments',
  'skipDotString', 'skipDotHtml', 'maskDotSyntax', 'unmaskDotSyntax',
  'scanDotOutline', 'scanDotStructure', 'parseDot', 'parseShape', 'parseStrokeStyle',
  'NAMED_COLORS', 'parseColor'];

export const dot = new Function(`${js}\nreturn { safeId, ${names.join(', ')} };`)();
