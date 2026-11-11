// Unit tests for the pure DOT-parsing core (src/app/46-dot-core.ts),
// evaluated without jsdom — each case runs in microseconds, so the whole
// suite finishes in well under a second. The same assertions used to boot
// a full editor per case through the paste pipeline; the end-to-end paste
// flow keeps a single integration test in import-parsers.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { dot } from './dot-core-harness.mjs';

// DOT itself, quoted exactly as the cases were written for the old paste tests.
const dotEmbed = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

const rejects = text => assert.equal(dot.parseDot(text), null, `${JSON.stringify(text)} is rejected`);
const emptyDoc = text => {
  const r = dot.parseDot(text);
  assert.ok(r, `${JSON.stringify(text)} imports`);
  assert.equal(r.nodes.length, 0, `${JSON.stringify(text)} imports as an empty document`);
  assert.equal(r.edges.length, 0);
  return r;
};
const oneNode = (text, id) => {
  const r = dot.parseDot(text);
  assert.ok(r, `${JSON.stringify(text)} imports`);
  assert.equal(r.nodes.length, 1, `${JSON.stringify(text)} imports as a one-node document`);
  if(id != null) assert.equal(r.nodes[0].id, id);
  return r;
};

test('DOT import keeps hex colours and "#" inside labels instead of truncating lines', () => {
  const text = [
    'digraph G {',
    '  /* block comment with #hash */',
    '  // line comment',
    '# preprocessor comment',
    '  a [label="C# docs", fillcolor="#ff0000"];',
    '  b [label="Beta"];',
    '  a -> b [weight="2"];',
    '}',
  ].join('\n');
  const r = dot.parseDot(text);
  assert.ok(r);
  assert.equal(r.nodes.length, 2, 'both node declarations are parsed');
  const byId = Object.fromEntries(r.nodes.map(n => [n.id, n]));
  assert.equal(byId.a.label, 'C# docs', 'a # inside a quoted label is not a comment');
  assert.equal(byId.a.color, '#ff0000', 'hex colour survives comment stripping');
  assert.equal(byId.b.label, 'Beta');
  assert.equal(r.edges.length, 1);
});

test('DOT comments survive CRLF and CR-only files without eating the next declaration', () => {
  const dotLf = [
    'digraph G {',
    '  # leading hash comment',
    '  a [label="Alpha", fillcolor="#ff0000"];',
    '  b [label="Beta"];',
    '  a -> b;',
    '}',
  ].join('\n');
  for(const eol of ['\n', '\r\n', '\r']) {
    const graph = dot.parseDot(dotLf.split('\n').join(eol));
    assert.ok(graph, `comments survive ${JSON.stringify(eol)} line endings`);
    assert.deepEqual(graph.nodes.map(n => n.label), ['Alpha', 'Beta']);
    assert.equal(graph.edges.length, 1);
  }
});

test('malformed DOT with unparseable content is rejected, not imported as an empty document', () => {
  for(const text of [
    'digraph G { a -> }',
    '// graph\n{}',
    'digraph G { // graph keyword in a comment\n  a ->\n}',
    'graph { -- }',
  ]) rejects(text);
  // A genuinely empty graph with only no-op statements still imports.
  emptyDoc('digraph empty {\n  graph [layout="neato"];\n  node [style="filled"];\n}');
});

test('a hand-written zero-node DOT graph imports; garbage still does not', () => {
  emptyDoc('digraph G {}');
  rejects('digraph {'); // truncated — unterminated block
  emptyDoc('graph G {\n}');
});

test('malformed attribute statements fail the import of an empty digraph', () => {
  for(const text of [
    'digraph G { graph [label=]; }',
    'digraph G { graph [layout="neato", rankdir=]; }',
    'digraph G { node [=5]; }',
    'digraph G { edge [style=]; }',
  ]) rejects(text);
});

test('valid empty digraphs with assignments and empty subgraphs import', () => {
  for(const text of [
    'digraph G { rankdir=LR; }',
    'digraph G { rankdir = LR ; }',
    'digraph G { subgraph { } }',
    'digraph G { subgraph cluster_0 { } }',
    'digraph G { rankdir=LR; subgraph cluster_0 { graph [style=filled] } }',
    'digraph G { dpi=96; }',
  ]) emptyDoc(text);
});

test('an empty digraph with nested content that fails to parse is rejected', () => {
  rejects('digraph G { subgraph cluster_0 { graph [rankdir=] } }');
});

test('valid empty digraphs with quoted assignments and strict prefix import', () => {
  for(const text of [
    'digraph G { rankdir="LR"; }',
    'digraph G { size = "8,8"; }',
    'digraph G { label="a, b"; }',
    'digraph G { dpi="96"; }',
    'strict graph G { dpi=96; }',
    'strict digraph G { rankdir=LR; }',
    'strict graph G { }',
  ]) emptyDoc(text);
});

test('empty quoted values and signed numbers are accepted in empty digraphs', () => {
  for(const text of [
    'digraph G { graph [label=""]; }',
    'digraph G { node [label=""]; }',
    'digraph G { dpi=+96; }',
    'digraph G { ranksep=-0.5; }',
  ]) emptyDoc(text);
});

test('truncated DOT with an unterminated subgraph is rejected', () => {
  for(const text of [
    'digraph G { subgraph child { }',
    'digraph G { subgraph child { dpi=96; }',
    'strict digraph G { subgraph { dpi=96; }',
    'digraph G { dpi=96; subgraph child { }',
  ]) rejects(text);
});

test('whitespace-separated attribute lists import as empty documents', () => {
  for(const text of [
    'digraph G { graph [label="Hello" rankdir=LR]; }',
    'digraph G { graph [dpi=96 rankdir=LR]; }',
    'digraph G { node [shape=box style=filled color=red]; }',
    'digraph G { graph [label = "Spaced Out" rankdir = LR]; }',
    'digraph G { graph [label="Hello" rankdir=LR dpi=96]; }',
  ]) emptyDoc(text);
});

test('whitespace-separated attribute lists still reject malformed items', () => {
  for(const text of [
    'digraph G { graph [label="Hello" rankdir=]; }',
    'digraph G { graph [label="Hello" , , ]; }',
    'digraph G { node [shape=box =fill]; }',
    'digraph G { graph ["Unterminated]; }',
  ]) rejects(text);
});

test('trailing garbage or unbalanced braces fail the import of an empty digraph', () => {
  for(const text of [
    'digraph G { } garbage }',
    'digraph G { } garbage',
    'digraph G { } }',
    'digraph G { subgraph child { } } trailing }',
  ]) rejects(text);
});

test('multiple attribute lists per statement import as empty documents', () => {
  for(const text of [
    'digraph G { graph [label=x][rankdir=LR]; }',
    'digraph G { graph [label=x] [rankdir=LR]; }',
    'digraph G { node [shape=box][style=filled][color=red]; }',
    'digraph G { dpi=96; graph [a=1][b=2][c=3]; }',
    'digraph G { graph [a=1][][b=2]; }',
  ]) emptyDoc(text);
});

test('a malformed later attribute list still rejects the statement', () => {
  for(const text of [
    'digraph G { graph [label=x][rankdir=]; }',
    'digraph G { graph [label=x][=rankdir]; }',
    'digraph G { node [shape=box][][style=]; }',
  ]) rejects(text);
});

test('an empty digraph followed only by a comment still imports', () => {
  emptyDoc('digraph G { dpi=96; } /* trailing comment */\n');
});

test('valid single-node DOT statements import', () => {
  for(const [text, id] of [
    ['digraph G { a }', 'a'],
    ['digraph G { a [shape=box] }', 'a'],
    ['digraph G { "quoted node" }', 'quotednode'],
  ]) oneNode(text, id);
});

test('node-ish garbage with no extractable nodes is rejected', () => {
  for(const text of [
    'digraph G { a b }',
    'digraph G { a -> }',
    'digraph G { -- b }',
  ]) rejects(text);
});

test('non-DOT text cannot win structure from inside a quoted string', () => {
  for(const text of [
    'banana "graph" {}',
    'banana "digraph" {}',
    'banana "graph" { } x',
    'banana "unterminated { }',
    '{ }',
    '"graph"',
  ]) rejects(text);
});

test('anonymous subgraph blocks import as valid empty documents', () => {
  for(const text of [
    'digraph G { { } }',
    'digraph G { { { } } }',
    'digraph G { { dpi=96; } }',
    'digraph G { {} }',
    'digraph G { strict subgraph { } { } }',
  ]) emptyDoc(text);
});

test('an anonymous block with a node statement imports the node', () => {
  oneNode('digraph G { { a } }', 'a');
});

test('HTML-like labels import as valid empty documents', () => {
  for(const text of [
    'graph G { graph [label=<hello>] }',
    'digraph G { graph [label=<hello>]; }',
    'digraph G { graph [label=<<a href="u">hello</a>>]; }',
    'digraph G { graph [label=<<TABLE><TR><TD>cell</TD></TR></TABLE>>]; }',
    'digraph G { label=<hello>; }',
  ]) emptyDoc(text);
});

test('an unterminated HTML label rejects the import', () => {
  rejects('digraph G { graph [label=<hello]; }');
});

test('a closing brace inside a quoted string does not end the graph body', () => {
  // The quoted "}" must not close the block: the statement after it still parses.
  emptyDoc('digraph G { label="}" }');
});

test('syntax bytes inside quoted values cannot become DOT structure', () => {
  for(const text of [
    'digraph G { label="{ghost}"; }',
    'digraph G { label="}"; }',
    'digraph G { label="a -> b"; }',
    'graph G { label="-- ghost"; }',
  ]) {
    const r = emptyDoc(text);
    assert.ok(!r.nodes.some(n => n.id === 'ghost' || n.id === 'x' || n.id === 'y'),
      `${JSON.stringify(text)} invents no phantom node`);
  }
});

test('a node attribute value round-trips even with braces inside quotes', () => {
  const r = oneNode('digraph G { a [label="{ghost}"]; }', 'a');
  assert.equal(r.nodes[0].label, '{ghost}', 'the brace placeholder was mapped back out');
});

test('a quoted arrow inside a node label invents no edge', () => {
  const r = oneNode('digraph G { a [label="x -> y"]; }', 'a');
  assert.equal(r.nodes[0].label, 'x -> y');
  assert.equal(r.edges.length, 0, 'the quoted arrow is not an edge');
});

test('prose mentioning "graph" cannot pass for a graph header', () => {
  for(const text of [
    'this is not a graph {}',
    'banana graph {}',
    'G { }',
    'digraph G extra { }',
    'the quick brown graph',
    'a digraph without braces',
  ]) rejects(text);
});

test('a strict header with a graph keyword and name imports as empty', () => {
  for(const text of [
    'graph G { }',
    'digraph { }',
    'strict graph G { }',
    'strict digraph HardlyComplex { }',
    'DIGRAPH G { }',
    'graph "a name" { }',
    'graph 42 { }',
  ]) emptyDoc(text);
});

test('HTML attribute values with nesting, spaces and commas round-trip', () => {
  const text = 'digraph G { a [label=<<TABLE><TR><TD>hello world, again</TD></TR></TABLE>>]; }';
  const r = oneNode(text, 'a');
  assert.equal(r.nodes[0].label, '<<TABLE><TR><TD>hello world, again</TD></TR></TABLE>>',
    'the HTML value round-trips including its delimiters');
});

test('string values are opaque to the parser (generated matrix)', () => {
  const payloads = ['{', '}', '->', '--', 'a, b', 'x -> y', 'brace} and{', 'semi;colon', 'back\\slash', 'line\nbreak', '"'];
  for(const payload of payloads){
    const embedded = dotEmbed(payload);
    for(const [name, text, check] of [
      ['attr label', `digraph G { a [label="${embedded}"]; }`, 'node'],
      ['graph assignment', `graph G { label="${embedded}"; }`, 'empty'],
    ]){
      const r = dot.parseDot(text);
      assert.ok(r, `${name} ${JSON.stringify(payload)}: imports`);
      if(check === 'node'){
        assert.equal(r.nodes.length, 1, `${name} ${JSON.stringify(payload)}: one node, no phantoms`);
        assert.equal(r.nodes[0].label, payload, 'the value round-trips byte-for-byte');
        assert.equal(r.edges.length, 0, 'no edge is invented from a string value');
      } else {
        assert.equal(r.nodes.length, 0, `${name} ${JSON.stringify(payload)}: valid empty document`);
      }
    }
  }
});

test('DOT comments cannot inject nodes or edges (LF, CRLF and CR files)', () => {
  // A comment whose text is valid DOT must stay inert: this is what the
  // comment stripper exists for. Uses DOT-significant bytes (an edge, a fake
  // node statement) so an unstripped comment line would invent both.
  for(const eol of ['\n', '\r\n', '\r']) {
    for(const comment of ['# x -> y { fake [label="ghost"]; }', '// x -> y { fake [label="ghost"]; }']) {
      const text = ['digraph G {', `  ${comment}`, '  a [label="real"];', '}'].join(eol);
      const r = dot.parseDot(text);
      assert.ok(r, `${JSON.stringify(eol)} ${comment}: imports`);
      assert.deepEqual(r.nodes.map(n => n.id), ['a'], `${JSON.stringify(eol)} ${comment}: no phantom node`);
      assert.equal(r.edges.length, 0, `${JSON.stringify(eol)} ${comment}: no phantom edge`);
    }
  }
  const block = dot.parseDot('digraph G {\n  /* x -> y { fake [label="ghost"]; } */\n  a [label="real"];\n}');
  assert.ok(block);
  assert.deepEqual(block.nodes.map(n => n.id), ['a'], 'block comment injects nothing');
  assert.equal(block.edges.length, 0);
});

test('HTML-like DOT labels keep quoted text inside them intact', () => {
  // Audit repro: quoted text inside an HTML value was masked like any other
  // quoted string, but only wholly quoted values were unmasked afterwards,
  // so the label kept mask control characters instead of the braces.
  const braces = dot.parseDot('digraph G { a [label=<<A HREF="{ref}">x</A>>]; }');
  assert.ok(braces);
  assert.equal(braces.nodes[0].label, '<<A HREF="{ref}">x</A>>', 'braces inside the quoted href survive');
  const arrow = dot.parseDot('digraph G { a [label=<<A HREF="x->y">go</A>>]; }');
  assert.ok(arrow);
  assert.equal(arrow.nodes[0].label, '<<A HREF="x->y">go</A>>', 'an arrow inside the quoted href survives literally');
  const dashes = dot.parseDot('digraph G { a [label=<<A TITLE="a--b">x</A>>]; }');
  assert.ok(dashes);
  assert.equal(dashes.nodes[0].label, '<<A TITLE="a--b">x</A>>', 'a double dash inside the quoted title survives literally');
  assert.ok(!/[\u0001-\u0004]/.test(braces.nodes[0].label + arrow.nodes[0].label + dashes.nodes[0].label),
    'no mask sentinel leaks into an HTML-like label');
});
