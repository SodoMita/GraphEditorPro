// Source-level invariants for the custom-values identity contract, learned
// from audit rounds 2–3 (P2/P3 fixes ①–㉑). These are deliberately NOT
// behavioral tests — they are the fast, deterministic guards that a future
// edit must not silently regress: any finite cap or identity shortcut on an
// origin has already caused a data-loss or conflation bug once.
//
// Run with: npm run check:contract
// Self-test against a broken tree: CONTRACT_ROOT=/tmp/broken npm run check:contract
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.CONTRACT_ROOT || process.cwd();
const appDir = join(root, 'src/app');
const files = readdirSync(appDir).filter(name => name.endsWith('.ts'));
const read = name => readFileSync(join(appDir, name), 'utf8');
const core = read('10-core.ts');
const paste = read('30-graph-editing.ts');
const imp = read('50-import-export.ts');
const all = files.map(f => read(f)).join('\n');

const failures = [];
let invoked = 0;
const inv = (name, condition) => {
  invoked += 1;
  if (condition) console.log(`ok    ${name}`);
  else { failures.push(name); console.error(`FAIL  ${name}`); }
};

// --- Bounded, lossless origin identity (fingerprint past the bound) ---
inv('ORIGIN_IDENTITY_MAX = 256 is the identity bound (P3, fingerprint fix)', /ORIGIN_IDENTITY_MAX\s*=\s*256/.test(core));
inv('originIdentity is defined and fingerprints past the bound (tagged token)', /function originIdentity/.test(core) && /const fp106/.test(core) && /FP_MARK\s*=\s*'\\u0001'/.test(core));
inv('fingerprints live in a namespace disjoint from XML-expressible literals (U+0001 marker)', /charAt\(0\) === FP_MARK/.test(core) && /FP_MARK \+ cyrb53/.test(core));
inv('originIdentity passes short origins through verbatim before fingerprinting (long path only)', /if\(s\.length <= ORIGIN_IDENTITY_MAX\) return s;[\s\S]{0,80}?return fp106\(s\);/.test(core));
inv('cyrb53 is the fingerprint hash (two independent seeds)', /function cyrb53/.test(core) && /cyrb53\(s(tr)?, 0\)/.test(core) && /cyrb53\(s(tr)?, 0x9e3779b9\)/.test(core));

// --- Origins are never truncated ANYWHERE (any cap conflates long foreign keys) ---
inv('no source line truncates an origin (no .slice( on an origin)', !all.split('\n').some(line => /origin/.test(line) && /\.slice\(/.test(line)));

// --- Every identity/storage ingress goes through the fingerprint ---
inv('load/sanitize records origins via originIdentity', /rawOrigin\s*=\s*originIdentity\(attribute\.origin\)/.test(core));
inv('paste carries origins via originFromForeign (clipboard is foreign input)', /const origin = originFromForeign\(\(def as AnyRecord\)\.origin\)/.test(paste));
inv('paste encodes carried origins in the wire spelling on copy', /originForWire\(attribute\?\.origin\)/.test(paste));
inv('GraphML parse ingress shares the one foreign ingress (wire decode, forged markers re-tagged)', /const origin = originFromForeign\(k\.getAttributeNS\(QVGE_NS, 'origin'\) \|\| ''\)/.test(imp));
inv('foreign ingress decodes the wire encoding and re-tags forged markers (originFromForeign)', /function originFromForeign/.test(core) && /WIRE_TOKEN_RE\.test\(s\)/.test(core) && /literalForeignIdentity\(s\)/.test(core));
inv('foreign KEY IDS never mint a token (literalForeignIdentity: fingerprint past the bound, markers re-tagged)', /const literalForeignIdentity/.test(core) && /s\.charAt\(0\) === FP_MARK \|\| s\.length > ORIGIN_IDENTITY_MAX/.test(core));
inv('export encodes origins in the disjoint spellings (h106: token / l106: escaped literal) and never emits raw markers', /function originForWire/.test(core) && /isFpToken\(s\)\) return 'h106:' \+ s\.substring\(1\)/.test(core) && /'l106:' \+ encodeURIComponent/.test(core) && /originForWire\(attribute\.origin\)/.test(imp));
inv('JSON exports encode origins in the wire spelling (no raw markers leak across the boundary)', /function jsonExportText/.test(imp) && /attribute\.origin = originForWire\(attribute\.origin\)/.test(imp));
inv('import boundaries decode origins once, at their parsers (JSON at the parse sites, GraphML in the parser) — claims inside import use the internal identity verbatim', /incOriginPair\s*=\s*String\(\(inc as AnyRecord\)\?\.origin \?\? ''\)\.trim\(\) \|\| literalForeignIdentity\(fullId\)/.test(imp));
inv('every JSON site feeding the import funnel decodes origins exactly once (three call sites plus the definition)', (imp.match(/decodeForeignGraphJson\(/g) || []).length === 4 && !/importGraphData\(JSON\.parse\(/.test(imp) && !/importGraphData\(data, 'JSON'/.test(imp));
inv('import paths never re-decode an already-internal identity (originFromForeign only at a document boundary)', !/originFromForeign\(inc\.origin\)/.test(imp) && !/originFromForeign\(keepOriginRaw\)/.test(imp));

// --- Import exact-pair branch: truncated keys prove nothing without an origin match (P2, ⑱) ---
inv('exact-pair merge requires recorded origin equality (no "no origin = free merge")', /pairOrigin === incOriginPair/.test(imp) && !imp.includes('!pairOrigin || pairOrigin === incOriginPair'));
inv('exact-pair default identity is the existing definition\'s own id', /String\(\(pairHit as AnyRecord\)\?\.origin \?\? ''\)\.trim\(\) \|\| String\(pairHit\?\.id \?\? ''\)\.trim\(\)/.test(imp));

// --- Paste exact-pair branch: same rule (P3, ⑳) ---
inv('paste exact-pair: an origin-less destination is evidence only by its own id', /String\(existing\?\.origin \?\? ''\)\.trim\(\) \|\| String\(existing\?\.id \?\? ''\)\.trim\(\)/.test(paste));
inv('paste no longer free-merges an unproven foreign key onto an origin-less property', !paste.includes('if(!existingOrigin) return true;'));

// --- Deferral: a stale pending mount never lands on a cleared selection (P2, ⑮) ---
inv('flushPendingCustomPropHosts drops requests whose targets are not live', /liveNodes\s*=\s*new Set\(state\.nodes\)/.test(core) && /targetsAlive/.test(core));
inv('mountCustomProps returns without touching the host when the placeholder is gone', /The placeholder vanished since the request was made/.test(core));

// --- Pager re-reads live values on every render (P2, ⑯) ---
const sectionIdx = core.indexOf('function customPropsSection(');
const renderPageIdx = core.indexOf('const renderPage = (page: number)');
const wiresIdx = core.indexOf('wireCustomProps(element', renderPageIdx);
inv('renderPage re-reads sharedCustomPropValues per render before wiring rows', sectionIdx > 0 && renderPageIdx > sectionIdx && wiresIdx > renderPageIdx && core.slice(renderPageIdx, wiresIdx).includes('sharedCustomPropValues(targets, defs)'));
inv('no build-time shared snapshot remains before renderPage', sectionIdx > 0 && renderPageIdx > sectionIdx && !core.slice(sectionIdx, renderPageIdx).includes('const shared = sharedCustomPropValues'));

// --- Round-trip contract: export emits the identity (P2, ⑰) ---
inv('GraphML export emits qvge:origin for provenance-tracked definitions', /qvge:origin=/.test(imp));

// --- Escape must not close an underlying overlay while a modal owns the key ---
const uiSource = read('80-ui.ts');
const escapeHandler = uiSource.slice(uiSource.indexOf("window.addEventListener('keydown', ev => {"));
inv('window Escape handler stands down for an active dialog before presets/sidebar',
    escapeHandler.includes('if(uiDialogOpen()) return;')
    && escapeHandler.indexOf('if(uiDialogOpen()) return;') < escapeHandler.indexOf("$('#presetsOverlay')"));

// --- Display heuristics stay capped (positive control: legitimate caps remain) ---
inv('definition names stay capped at 128 as a display heuristic', /const rawName = String\(\(attribute as AnyRecord\)\.name \?\? ''\)\.trim\(\)\.slice\(0, 128\)/.test(core));

if (failures.length) {
  console.error(`\nContract check failed: ${failures.length} invariant(s) broken:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nContract check passed: ${invoked - failures.length} invariants hold across ${files.length} source files.`);
