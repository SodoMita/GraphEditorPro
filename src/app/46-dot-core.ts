// Pure DOT parsing core — no DOM, no app state, no imports.
// Shared verbatim between the app bundle (concatenated by tsc) and the
// unit-test harness (tests/dot-core-harness.mjs), which extracts this
// section and evaluates it on its own. Keep it self-contained: adding
// a reference to anything outside this file breaks the fast tests.
// === DOT-CORE-BEGIN ===
  // Sequential attribute-list parser, grammar identical to the empty-document
  // scanner: items are ID, optionally ID = value, separated by
  // whitespace/commas/semicolons. A value may be a quoted string (single or
  // double), an HTML-like string (<...>, nested-aware), an ID, or a number.
  // An item whose value cannot be read is skipped, as the regex did before.
  function parseAttrList(text): AnyRecord {
    const attrs: AnyRecord = {};
    if(!text) return attrs;
    let j = 0;
    const wsOnly = (from: number): number => { let k = from; while(k < text.length && /\s/.test(text[k])) k++; return k; };
    const skipToSeparator = (from: number): number => { const next = text.slice(from).search(/[\s,;]/); return next < 0 ? text.length : from + next; };
    while(j < text.length){
      while(j < text.length && /[\s,;]/.test(text[j])) j++;
      if(j >= text.length) break;
      const idMatch = /^[A-Za-z_][\w.:-]*/.exec(text.slice(j));
      if(!idMatch){ j = skipToSeparator(j); continue; }
      const key = idMatch[0].toLowerCase();
      j = wsOnly(j + idMatch[0].length);
      if(text[j] !== '=') continue; // bare ID — not an assignment; skipped
      j = wsOnly(j + 1);
      const c = text[j];
      let raw: string | null = null;
      if(c === '"' || c === "'"){
        const quote = c;
        let end = j + 1;
        while(end < text.length){
          if(text[end] === '\\'){ end += 2; continue; }
          if(text[end] === quote){ end++; break; }
          end++;
        }
        raw = text.slice(j, Math.min(end, text.length));
        j = Math.min(end, text.length);
      } else if(c === '<'){
        const end = skipDotHtml(text, j);
        if(end < 0){ j = skipToSeparator(j); continue; }
        raw = text.slice(j, end);
        j = end;
      } else {
        const bare = /^[^,\]\s]+/.exec(text.slice(j));
        if(bare){ raw = bare[0]; j += bare[0].length; }
      }
      if(raw == null) continue;
      // Restore the syntax bytes the mask blanked inside quoted strings,
      // wherever they appear in the value: wholly quoted values are
      // unescaped below (idempotent second pass), but an HTML-like value
      // carries quoted text of its own (HREF="{ref}"), which otherwise kept
      // the mask sentinels as control characters.
      let v = unmaskDotSyntax(raw.trim());
      const q = v[0];
      const last = v[v.length - 1];
    if((q === '"' && last === '"') || (q === "'" && last === "'")) v = dotUnescape(v.slice(1, -1));
      attrs[key] = v;
    }
    return attrs;
  }
  // DOT string escapes: \\ \" \' and \n. One pass, because chaining
  // replacements unescaped in the wrong order: "a\\\\nb" (the literal label a\nb)
  // hit the \n rule first and came back as a backslash plus a newline.
  function dotUnescape(text: string): string {
    return unmaskDotSyntax(text.replace(/\\([\\"'n])/g, (_, ch) => ch === 'n' ? '\n' : ch));
  }
  function cleanDotToken(t){
    t = String(t || '').trim();
    if((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'")) return dotUnescape(t.slice(1,-1));
    return t;
  }
  // Strip DOT comments without touching quoted strings. A '#' is only a comment
  // at the start of a line (C-preprocessor style): treating every '#' as one,
  // as a global /#.*$/ regex does, truncates hex colours (fillcolor="#0ea5e9")
  // and labels such as "C#" mid-line — which used to swallow the declaration
  // that followed and silently drop nodes.
  function stripDotComments(text: string): string {
    // DOT line comments run to the end of the *line*, and a line may end with
    // LF, CRLF or a lone CR (files saved on old Macs, or pasted from tools that
    // normalise to CR). The scanner has to recognise all three: an earlier
    // version only reset "at line start" on LF, so in a CR-only file a `#`
    // comment was never recognised, its text stayed in the source, and the
    // node regex then swallowed the declaration on the next line.
    let out = '';
    let i = 0;
    let atLineStart = true;
    while(i < text.length){
      const ch = text[i];
      if(ch === '"'){                       // copy the whole quoted string verbatim
        out += ch; i++;
        while(i < text.length){
          const c = text[i]; out += c; i++;
          if(c === '\\'){ if(i < text.length){ out += text[i]; i++; } continue; }
          if(c === '"') break;
        }
        atLineStart = false;
        continue;
      }
      if(ch === '\r' || ch === '\n'){        // keep the terminator, remember the boundary
        out += ch; i++;
        if(ch === '\r' && text[i] === '\n'){ out += '\n'; i++; }
        atLineStart = true;
        continue;
      }
      if(ch === '/' && text[i+1] === '*'){ const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 2; out += ' '; continue; }
      if((ch === '#' && atLineStart) || (ch === '/' && text[i+1] === '/')){
        // Skip the comment text but leave the line terminator to the branch
        // above, so the following declaration keeps its own line.
        while(i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
        continue;
      }
      out += ch; i++;
      if(ch !== ' ' && ch !== '\t' && ch !== '\ufeff') atLineStart = false;
    }
    return out;
  }
  // Scans a comment-free DOT body (the inside of a braces block) and returns
  // true iff every byte is consumed by a well-formed no-content statement.
  // This is the single structural grammar for the empty-document path — the
  // three statement forms the import has always accepted, expressed one way
  // only, failing closed on the first byte no rule recognizes (nothing is
  // ever skipped silently):
  //   graph|node|edge [list] [list] ...   attribute statement(s)
  //   ID = value                           simple assignment (rankdir=LR)
  //   [strict] subgraph [name] { ... }     recursive block
  // Node and edge statements never pass here: if one were present, the
  // extractor would have found nodes, so seeing one means the input is not a
  // usable empty graph and must not replace the document. EOF is only legal
  // where no closing brace is pending, a bare '}' only where one is — so a
  // truncated or padded file can never come back as "empty".
  // Index just after the closing quote of a string starting at i (or s.length if unterminated).
  function skipDotString(s: string, i: number): number {
    let j = i + 1;
    while(j < s.length){
      if(s[j] === '\\'){ j += 2; continue; }
      if(s[j] === '"') return j + 1;
      j++;
    }
    return s.length;
  }
  // Index just after an HTML-like string (<...>), tracking nesting depth and
  // skipping quoted strings inside it. Returns -1 when unterminated.
  function skipDotHtml(s: string, i: number): number {
    let j = i + 1, depth = 1;
    while(j < s.length && depth > 0){
      const c = s[j];
      if(c === '"'){ const end = skipDotString(s, j); if(end >= s.length && s[s.length - 1] !== '"') return -1; j = end; continue; }
      if(c === '<'){ depth++; j++; continue; }
      if(c === '>'){ depth--; j++; continue; }
      j++;
    }
    return depth === 0 ? j : -1;
  }
  // Blanks the syntax bytes that live inside quoted strings AND inside
  // HTML-like strings: braces (which the matchers would read as block
  // delimiters), arrows (which the edge matcher would read as operators) and
  // brackets (which the attribute-list matcher would read as list delimiters).
  // Brackets are legal inside both contexts ('label="arr[0]"',
  // 'label=<<B>[x]</B>>'), and a literal ']' in a value used to terminate the
  // attribute-list match early and drop or garble the rest of the statement.
  // Length is preserved 1:1 by the sentinels, and the placeholders are mapped
  // back out of extracted attribute values via unmaskDotSyntax. An HTML-like
  // string nests '<...>' and may carry quoted text of its own (HREF="{ref}"),
  // which is masked by the same rules.
  function maskDotSyntax(src: string): string {
    // One syntax byte (or arrow pair) → its sentinel, or null when the byte
    // is ordinary text. Arrows are two bytes, so the replacement also carries
    // the source length it consumes.
    const maskSeq = (i: number): { rep: string, len: number } | null => {
      const d = src[i];
      if(d === '{') return { rep: '\u0001', len: 1 };
      if(d === '}') return { rep: '\u0002', len: 1 };
      if(d === '[') return { rep: '\u0005', len: 1 };
      if(d === ']') return { rep: '\u0006', len: 1 };
      if(d === '-' && src[i + 1] === '>') return { rep: '-\u0003', len: 2 };
      if(d === '-' && src[i + 1] === '-') return { rep: '-\u0004', len: 2 };
      return null;
    };
    // Copies a quoted string starting at i (src[i] === '"') through its
    // closing quote, masking the syntax bytes inside. Escape bytes (\\ plus
    // the next byte) are copied verbatim so an escaped quote cannot terminate
    // the string. An unterminated string consumes the rest of the input —
    // the same rule the structure scanner uses.
    const copyQuoted = (start: number): { text: string, next: number } => {
      let text = '"', i = start + 1;
      while(i < src.length){
        const d = src[i];
        if(d === '\\'){ text += d; if(i + 1 < src.length){ text += src[i + 1]; i += 2; } else i++; continue; }
        if(d === '"'){ text += '"'; i++; return { text, next: i }; }
        const m = maskSeq(i);
        if(m){ text += m.rep; i += m.len; continue; }
        text += d; i++;
      }
      return { text, next: i };
    };
    let out = '';
    for(let i = 0; i < src.length;){
      const c = src[i];
      if(c === '"'){ const r = copyQuoted(i); out += r.text; i = r.next; continue; }
      if(c === '<'){
        // HTML-like string: mask until its matching '>' (nesting depth and
        // quoted text inside included), then resume normal scanning.
        out += '<'; i++;
        let depth = 1;
        while(i < src.length && depth > 0){
          const d = src[i];
          if(d === '"'){ const r = copyQuoted(i); out += r.text; i = r.next; continue; }
          if(d === '<'){ depth++; out += d; i++; continue; }
          if(d === '>'){ depth--; out += d; i++; continue; }
          const m = maskSeq(i);
          if(m){ out += m.rep; i += m.len; continue; }
          out += d; i++;
        }
        continue;
      }
      out += c; i++;
    }
    return out;
  }
  function unmaskDotSyntax(s: string): string {
    return s.replace(/\u0001/g, '{').replace(/\u0002/g, '}').replace(/\u0003/g, '>').replace(/\u0004/g, '-').replace(/\u0005/g, '[').replace(/\u0006/g, ']');
  }
  // Walks a comment-free DOT source and reports its outline without interpreting
  // values: the index of the first '{' and the last '}' OUTSIDE any quoted string
  // (or -1 when absent), plus the same source with every quoted string blanked to
  // `""` (for keyword tests). An unterminated string swallows the rest of the
  // input — text inside it can neither build structure nor pass for a keyword.
  function scanDotOutline(src: string): { open: number, close: number, unquoted: string, openUnquoted: number } {
    let open = -1, close = -1, unquoted = '', openUnquoted = -1;
    for(let i = 0; i < src.length;){
      const c = src[i];
      if(c === '"'){
        unquoted += '""';
        let j = i + 1;
        while(j < src.length){
          if(src[j] === '\\'){ j += 2; continue; }
          if(src[j] === '"'){ j += 1; break; }
          j++;
        }
        i = j; // unterminated: j === src.length — the tail is one big string
        continue;
      }
      if(c === '{'){ if(open < 0){ open = i; openUnquoted = unquoted.length; } unquoted += c; i++; continue; }
      if(c === '}'){ close = i; unquoted += c; i++; continue; }
      unquoted += c; i++;
    }
    return { open, close, unquoted, openUnquoted };
  }
  function scanDotStructure(src: string): boolean {
    const NUM_SRC = '[+-]?(?:\\d+(\\.\\d*)?|\\.\\d+)';
    const numRe = new RegExp('^' + NUM_SRC);
    const skipWs = (s: string, i: number): number => { while(i < s.length && /[\s;]/.test(s[i])) i++; return i; };
    const matchId = (s: string, i: number): { end: number } | null => {
      const rest = s.slice(i);
      const quoted = /^"(?:\\.|[^"])*"/.exec(rest);
      if(quoted) return { end: i + quoted[0].length };
      const m = /^[A-Za-z0-9_:.\-]*[A-Za-z0-9_][A-Za-z0-9_:.\-]*/.exec(rest);
      if(m && m[0].length) return { end: i + m[0].length };
      return null;
    };
    // One definition of a DOT value: an HTML-like string, an ID, a quoted string, or a signed number.
    const matchValue = (s: string, i: number): { end: number } | null => {
      if(s[i] === '<'){ const end = skipDotHtml(s, i); return end >= 0 ? { end } : null; }
      const id = matchId(s, i); if(id) return id;
      const num = numRe.exec(s.slice(i)); if(num) return { end: i + num[0].length };
      return null;
    };    // Index just after the matching close of the delimiter pair starting at i.
    const matchPair = (s: string, i: number, open: string, close: string): number => {
      let depth = 0;
      for(let j = i; j < s.length; j++){
        const c = s[j];
        if(c === '<'){ const end = skipDotHtml(s, j); if(end < 0) return -1; j = end - 1; continue; }
        if(c === '"'){ j = skipDotString(s, j) - 1; continue; }
        if(c === open) depth++;
        else if(c === close){ depth--; if(!depth) return j + 1; }
      }
      return -1;
    };
    // Attribute list: whitespace/comma/semicolon-separated items; each item is
    // ID or ID = value (graphviz accepts whitespace-separated attributes, e.g.
    // 'graph [label="Hello" rankdir=LR]'). Quoted strings are consumed whole.
    // A single trailing separator is fine; a run of separators is malformed.
    const attrListOk = (raw: string): boolean => {
      const wsOnly = (from: number): number => { let k = from; while(k < raw.length && /\s/.test(raw[k])) k++; return k; };
      let j = wsOnly(0);
      while(j < raw.length){
        const id = matchId(raw, j); if(!id) return false; j = id.end;
        j = wsOnly(j);
        if(raw[j] === '='){
          j = wsOnly(j + 1);
          const val = matchValue(raw, j); if(!val) return false; j = val.end;
        }
        j = wsOnly(j);
        if(raw[j] === ',' || raw[j] === ';') j = wsOnly(j + 1);
      }
      return true;
    };
    // Consumes statements from position i. needClose marks a subgraph body,
    // where EOF is unterminated input rather than end-of-body; a bare '}'
    // closes such a body, or fails everywhere else.
    const walk = (s: string, i: number, needClose: boolean): { ok: boolean, next: number } => {
      while(true){
        i = skipWs(s, i);
        if(i >= s.length) return needClose ? { ok: false, next: i } : { ok: true, next: i };
        if(s[i] === '}') return needClose ? { ok: true, next: i + 1 } : { ok: false, next: i };
        // Anonymous subgraph block: '{ ... }'
        if(s[i] === '{'){
          const inner = walk(s, i + 1, true);
          if(!inner.ok) return inner;
          i = inner.next;
          continue;
        }
        // Attribute statement: graph|node|edge, then one or more [list]
        // ('graph [label=x][rankdir=LR];' — every list is validated).
        const kw = /^(graph|node|edge)\b/i.exec(s.slice(i));
        if(kw){
          let at = skipWs(s, i + kw[0].length);
          if(s[at] !== '[') return { ok: false, next: at };
          while(s[at] === '['){
            const close = matchPair(s, at, '[', ']');
            if(close < 0) return { ok: false, next: at };
            if(!attrListOk(s.slice(at + 1, close - 1))) return { ok: false, next: at };
            at = skipWs(s, close);
          }
          i = at;
          continue;
        }
        // Subgraph block: [strict] subgraph [name] { ... }
        const sg = /^(?:strict\s+)?subgraph\b/i.exec(s.slice(i));
        if(sg){
          let at = skipWs(s, i + sg[0].length);
          if(s[at] !== '{'){
            const name = matchId(s, at); if(!name) return { ok: false, next: at };
            at = skipWs(s, name.end);
            if(s[at] !== '{') return { ok: false, next: at };
          }
          const inner = walk(s, at + 1, true);
          if(!inner.ok) return inner;
          i = inner.next;
          continue;
        }
        // Simple assignment: ID = value (rankdir=LR, dpi=96, ...).
        const lhs = matchId(s, i);
        if(lhs){
          const eq = skipWs(s, lhs.end);
          if(s[eq] !== '=') return { ok: false, next: eq };
          const rhsStart = skipWs(s, eq + 1);
          const rhs = matchValue(s, rhsStart);
          if(!rhs) return { ok: false, next: rhsStart };
          i = rhs.end;
          continue;
        }
        return { ok: false, next: i };
      }
    };
    return walk(src, skipWs(src, 0), false).ok;
  }
  // Arrow-size constants, copied from 10-core.ts — this section must stay
  // self-contained (the unit-test harness evaluates it in isolation).
  const DOT_DEFAULT_ARROW_SIZE = 12, DOT_ARROW_SIZE_MIN = 4, DOT_ARROW_SIZE_MAX = 40;
  // DOT lengths are inches when neato/fdp read them back (GraphViz `inputscale`
  // defaults to "no scaling, units on input are inches"), and QVGE writes and
  // reads them the same way (`CFileSerializerDOT.cpp`: `pos().x() / 72`, and
  // `x * 72` on import). The editor works in pixels at the same 72-per-inch
  // ratio `width`/`height` already use, so `pos` converts on both sides.
  // Copied here for the same self-containment reason as the arrow constants;
  // the exporter (50-import-export.ts) keeps its own copy under this name.
  const DOT_PX_PER_INCH = 72;
  // Attribute prefix marking the editor's own custom values (see 50-import-export.ts
  // `gepCustomAttr`). This module must stay self-contained for its unit-test
  // harness, so the value is repeated rather than imported; the name is distinct
  // because every module lands in one shared scope after bundling.
  const DOT_CUSTOM_ATTR_PREFIX = '_gep_custom_';
  // Copied from 10-core.ts for the same self-containment reason.
  const DOT_LABEL_POSITIONS = ['center','top','bottom','left','right'];
  const dotClampArrowSize = (v: number) => Math.min(DOT_ARROW_SIZE_MAX, Math.max(DOT_ARROW_SIZE_MIN, v));
  function parseDot(text, options: { units?: 'auto' | 'inches' | 'legacyPixels' } = {}){
    // Strip comments once, up front: the structure test and the
    // directed-graph default both derive from the comment-free source, so a
    // keyword hiding inside a comment can never rescue garbage input.
    const stripped = stripDotComments(text);
    // Braces and keywords are located quote-aware: a quoted string may hold
    // '}' or the word 'graph' without granting structure to garbage input.
    const { open, close, unquoted, openUnquoted } = scanDotOutline(stripped);
    // A structurally recognized DOT graph document needs a strict graph header
    // ([strict] graph|digraph [name]) before its braces block. Prose that
    // merely mentions the word 'graph' is not a graph; the header is matched
    // on the string-blanked outline so a quoted keyword cannot grant structure.
    const headerText = openUnquoted >= 0 ? unquoted.slice(0, openUnquoted) : '';
    const headerRe = /^\s*(strict\s+)?(di)?graph(\s+("(?:\\.|[^"])*"|[A-Za-z0-9_:.\-]*[A-Za-z0-9_][A-Za-z0-9_:.\-]*))?\s*$/i;
    const headerOk = open >= 0 && headerRe.test(headerText);
    const directedGraph = headerOk && /^\s*(strict\s+)?digraph\b/i.test(headerText);
    let body = stripped;
    if(open >= 0 && close > open) body = stripped.slice(open + 1, close);
    // `pos` units, resolved from the graph's own declarations.
    //
    // GraphViz: `neato -n`/`-n2` treat `pos` as POINTS (and ignore
    // `inputscale`), which is also the unit layout programs write on output;
    // a plain `neato`/`fdp` run treats an unmarked `pos` as INCHES. See
    // `dotGraphUnits` below for how this file decides which case it is.
    // The reader may state the convention outright. `legacyPixels` is the
    // migration path for files this app wrote before the units fix (pixel `pos`
    // against inch `width`); `inches` forces the QVGE/neato reading even for a
    // file whose numbers look like pixels. `auto` keeps the format signals.
    const unitsChoice = options.units || 'auto';
    const dotUnits = unitsChoice === 'legacyPixels'
      ? { pointsPerInch: DOT_PX_PER_INCH, legacyPixels: true }
      : unitsChoice === 'inches' ? { pointsPerInch: 1 } : dotGraphUnits(body);
    const dotPosScale = DOT_PX_PER_INCH / dotUnits.pointsPerInch;
    const hasStructure = (open >= 0 && close > open) && headerOk;
    const nodes = new Map<string, AnyRecord>(), edges: GraphEdge[] = [];
    const ensureNode = id => { if(!nodes.has(id)) nodes.set(id, {id:safeId(id,'n'), original:id, label:id, x:0, y:0, shape:'circle', color:'#0ea5e9'}); return nodes.get(id); };
    // A bare token must contain at least one word-ish character: a run of
    // pure punctuation ('--', ':.') is never a node reference or endpoint —
    // it is the arrow operator or noise, and must not invent a node.
    // Quoted IDs may carry escape pairs (a backslash before the quote). The
    // escape branch must be regex backslash-backslash-dot (escaped backslash
    // plus any byte) — in this source string that is doubled to four
    // backslashes. A single backslash-dot would match a literal dot instead.
    const id = '("(?:\\\\.|[^"])+"|[A-Za-z0-9_:.\\-]*[A-Za-z0-9_][A-Za-z0-9_:.\\-]*)';
    const edgeRe = new RegExp(id + '\\s*(--|->)\\s*' + id + '\\s*(?:\\[([^\\]]*)\\])?', 'g');
    // Stacked attribute lists ('n1 [label="a"][color="#f00"]') are merged into
    // one comma-separated list before the node/edge matchers run — in the
    // masked source a '][' pair can only be two adjacent lists of the same
    // statement (quoted/HTML strings can no longer carry a literal ']' or
    // '['), and a statement-initial '[' is not legal DOT anyway. Attribute
    // items are whitespace/comma/semicolon separated, so a plain comma join
    // reparses identically; later lists override duplicate keys, matching
    // how a single repeated key is handled.
    const work = maskDotSyntax(body).replace(/\]\s*\[/g, ',');
    let m;
    while((m = edgeRe.exec(work))){
      const fromOrig = cleanDotToken(m[1]), toOrig = cleanDotToken(m[3]), attrs = parseAttrList(m[4] || '');
      const a = ensureNode(fromOrig), b = ensureNode(toOrig);
      // `label` is a LABEL, not a weight. This used to fall back to it, so a
      // plain GraphViz file with `a -> b [label="heeft"]` arrived with the
      // weight "heeft": the algorithms then read Number("heeft") = NaN and
      // silently used 1, and the label was duplicated into the weight field.
      // DOT has a real `weight` attribute for this; when it is absent the edge
      // has no weight, which is what an empty string means to the model.
      const dotWeight = attrs.weight != null ? attrs.weight : '';
      // QVGE tristate: '->' and the graph's directedness both mean "directed".
      const initDir = m[2] === '->' || directedGraph ? 'directed' : 'undirected';
      // The exporter prints the weight as `label` when the document shows edge
      // weights (`edgeWeightMode`), and tags only that synthetic label with
      // `_gepWeightLabel` (attribute keys are lower-cased by `parseAttrList`).
      // Comparing the two texts instead dropped real labels, because "3" on a
      // 3-weight edge is a perfectly ordinary label.
      const eLabel = attrs._gepweightlabel ? '' : (attrs.label != null ? String(attrs.label) : '');
      const e = { id:'e' + (edges.length+1), from:a.id, to:b.id, weight:dotWeight, label:eLabel, directed: initDir !== 'undirected', direction: initDir } as any;
      if(attrs.directed){
        const dd = String(attrs.directed).toLowerCase();
        const direction = dd === 'undirected' || dd === 'none' ? 'undirected' : dd === 'mutual' || dd === 'both' ? 'mutual' : 'directed';
        (e as any).direction = direction;
        (e as any).directed = direction !== 'undirected';
      }
      // QVGE DOT edge: color, penwidth->strokeSize, style->strokeStyle, dir controls direction
      const ec = parseColor(attrs.color);
      if(ec) (e as any).color = ec;
      if(attrs.penwidth != null && Number.isFinite(Number(attrs.penwidth))) (e as any).strokeSize = Math.max(0, Number(attrs.penwidth));
      if(attrs.style){
        const ss = parseStrokeStyle(attrs.style);
        if(ss) (e as any).strokeStyle = ss;
      }
      if(attrs.arrowsize != null){
        const mul = Number(attrs.arrowsize);
        const mv = Number.isFinite(mul) ? mul : 1;
        // Graphviz arrowsize is a multiplier (default 1); convert to editor's absolute size (default 12)
        // Heuristic for legacy files that stored absolute size (e.g. 12): values > 5 are treated as absolute
        // The exporter writes the multiplier to four decimals, so 20/12 comes
        // back as 1.6667 and 20 as 20.0004. The editor's sizes are whole
        // numbers; a fraction of a pixel is not a size.
        (e as any).arrowSize = Math.round(dotClampArrowSize(mv > 5 ? mv : mv * DOT_DEFAULT_ARROW_SIZE) * 100) / 100;
      }
      // dir attribute (QVGE uses dir=forward/none/both) maps to directed/undirected/mutual
      if(attrs.dir){
        const dir = String(attrs.dir).toLowerCase();
        if(dir === 'none' || dir === 'undirected'){ (e as any).direction = 'undirected'; (e as any).directed = false; }
        else if(dir === 'both' || dir === 'mutual'){ (e as any).direction = 'mutual'; (e as any).directed = true; }
        else if(dir === 'forward' || dir === 'directed' || dir === 'true'){ (e as any).direction = 'directed'; (e as any).directed = true; }
      }
      if(attrs.type) (e as any).type = String(attrs.type).slice(0, 40);
      const edgeCustom: AnyRecord = {};
      for(const key of Object.keys(attrs)){
        if(!key.startsWith(DOT_CUSTOM_ATTR_PREFIX)) continue;
        const cid = key.slice(DOT_CUSTOM_ATTR_PREFIX.length);
        if(cid) edgeCustom[cid] = String(attrs[key]);
      }
      if(Object.keys(edgeCustom).length) (e as any).custom = edgeCustom;
      readDotLabelAttrs(attrs, e);
      edges.push(e as any);
    }
    const withoutEdges = work.replace(edgeRe, '');
    const nodeRe = new RegExp('(?:^|;|[\\r\\n]|\\{)\\s*' + id + '\\s*(?:\\[([^\\]]*)\\])?\\s*(?=;|[\\r\\n]|}|$)', 'g');
    if(hasStructure || edges.length)
    while((m = nodeRe.exec(withoutEdges))){
      const name = cleanDotToken(m[1]);
      if(['graph','node','edge'].includes(name.toLowerCase())) continue;
      const attrs = parseAttrList(m[2] || ''), n = ensureNode(name);
      if(attrs.label) n.label = attrs.label;
      readDotLabelAttrs(attrs, n);
      if(attrs.fillcolor || attrs.color) n.color = /^#[0-9a-f]{6}$/i.test(attrs.fillcolor || attrs.color) ? (attrs.fillcolor || attrs.color) : n.color;
      if(attrs.shape){
        const shape = parseShape(attrs.shape);
        if(shape) n.shape = shape;
        else if(/polygon/i.test(attrs.shape) && String(attrs.sides) === '6') n.shape = 'hexagon';
      }
      if(attrs.type) n.type = String(attrs.type).slice(0, 40);
      if(attrs.order != null && Number.isFinite(Number(attrs.order))) n.order = Math.max(0, Math.trunc(Number(attrs.order)));
      // QVGE DOT node: fillcolor->fill, color->stroke.color, penwidth->stroke.size, style->stroke.style
      // DOT may have fillcolor for interior and color for border; respect both
      if(attrs.fillcolor){
        const fc = parseColor(attrs.fillcolor);
        if(fc) n.color = fc;
      }
      if(attrs.color){
        const sc = parseColor(attrs.color);
        if(sc) (n as any).strokeColor = sc;
      }
      if(attrs.penwidth != null && Number.isFinite(Number(attrs.penwidth))) (n as any).strokeSize = Math.max(0, Number(attrs.penwidth));
      if(attrs.style){
        const ss = parseStrokeStyle(attrs.style);
        if(ss) (n as any).strokeStyle = ss;
      }
      // width/height from DOT are in inches (72 dpi -> px)
      if(attrs.width != null && Number.isFinite(Number(attrs.width))) (n as any).width = Math.max(10, Math.round(Number(attrs.width)*DOT_PX_PER_INCH));
      if(attrs.height != null && Number.isFinite(Number(attrs.height))) (n as any).height = Math.max(10, Math.round(Number(attrs.height)*DOT_PX_PER_INCH));
      // `pos` is in inches too (GraphViz `inputscale` default), so it converts
      // with the same 72 as width/height above; `dotPosScale` is that 72 unless
      // the file declares `inputscale`, which switches the unit to points.
      if(attrs.pos){
        const parts = attrs.pos.replace('!','').split(',').map(Number);
        if(Number.isFinite(parts[0])) n.x = parts[0] * dotPosScale;
        if(Number.isFinite(parts[1])) n.y = -parts[1] * dotPosScale;
        // "no positions at all" is decided by whether the attribute was
        // DECLARED, not by whether the numbers happen to be zero. A graph whose
        // nodes all sit at the origin is a real graph; inferring it as missing
        // moved it onto a circle.
        n.__hasPos = true;
      }
      // DOT carries arbitrary attributes — that is what the format is FOR — so
      // the editor's own values ride along as `_gep_custom_<id>`. The prefix
      // keeps them out of GraphViz's namespace and marks them as ours, exactly
      // like `_gepWeightLabel` marks a drawn weight.
      const custom: AnyRecord = {};
      for(const key of Object.keys(attrs)){
        if(!key.startsWith(DOT_CUSTOM_ATTR_PREFIX)) continue;
        const id = key.slice(DOT_CUSTOM_ATTR_PREFIX.length);
        if(id) custom[id] = String(attrs[key]);
      }
      if(Object.keys(custom).length) (n as any).custom = custom;
      if(attrs._gep_labelposition && DOT_LABEL_POSITIONS.includes(String(attrs._gep_labelposition))){
        (n as any).labelPosition = String(attrs._gep_labelposition);
      }
    }
    // DOT's z-order is the order of DECLARATION, so that is the order the
    // document must come back in — but the parse above reads edges BEFORE node
    // statements (the edge regex has to see the raw text), so insertion order
    // here is "whichever node an edge mentioned first": in
    // `first; second; third; second -> third` the Map held second, third, first.
    //
    // The order is recovered from the source instead: one scan over `work` for
    // every statement start, and each node is placed at the offset where it
    // first appears. A node only an edge mentions takes that edge's offset,
    // which is where DOT would put it too.
    const declaredAt = new Map<string, number>();
    {
      const stmtRe = new RegExp(
        '(?:^|[;\\r\\n]|\\{)\\s*' + id +
        '(?:\\s*(?:--|->)\\s*' + id + ')?', 'g');
      let dm;
      while((dm = stmtRe.exec(work))){
        const name = cleanDotToken(dm[1]);
        if(!['graph','node','edge'].includes(name.toLowerCase()) && !declaredAt.has(name)) declaredAt.set(name, dm.index);
        if(dm[2] != null){
          const other = cleanDotToken(dm[2]);
          if(!declaredAt.has(other)) declaredAt.set(other, dm.index);
        }
      }
    }
    const arr = [...nodes.values()].sort((a, b) =>
      (declaredAt.get(a.original) ?? 0) - (declaredAt.get(b.original) ?? 0));
    arr.forEach((n, i) => { if(n.order == null) n.order = i; });
    // A structurally recognized DOT graph with zero nodes is a valid empty
    // document ONLY when its body consists solely of no-content statements —
    // the exporter's empty output satisfies this. Anything else ("digraph G {
    // a -> }", "graph [label=];") is real input the parser could not use,
    // not an empty graph — reject it.
    if(!arr.length){
      const after = close >= 0 ? stripped.slice(close + 1) : '';
      return (hasStructure && /^\s*$/.test(after) && scanDotStructure(body)) ? { title:'imported-dot', nodes: [], edges: [] } : null;
    }
    // Only lay the nodes out when the file declared no position at all. Testing
    // `x === 0 && y === 0` instead re-placed graphs that legitimately sit on the
    // origin, and a file whose coordinates rounded to zero (see `dotCoord`) fell
    // into the same branch.
    if(arr.length > 1 && !arr.some((n: any) => n.__hasPos)){
      const r = Math.max(120, arr.length * 24);
      arr.forEach((n,i) => { const a=-Math.PI/2+i*2*Math.PI/arr.length; n.x=Math.cos(a)*r; n.y=Math.sin(a)*r; });
    }
    // Custom values only survive `sanitizeState` when their DEFINITION exists:
    // an unknown key is an orphan and is dropped. DOT cannot declare one, so the
    // definitions are synthesized from the values that were read — scope from
    // where the attribute appeared, type `string` because DOT carries text
    // verbatim. QVGE does the same (`attr.name` equals the attribute id).
    const customSeen = new Map<string, { id: string; scope: string; type: string; name: string }>();
    for(const n of arr){
      for(const cid of Object.keys((n as any).custom || {})){
        if(!customSeen.has('node:' + cid)) customSeen.set('node:' + cid, { id: cid, scope: 'node', type: 'string', name: cid });
      }
    }
    for(const e of edges){
      for(const cid of Object.keys((e as any).custom || {})){
        if(!customSeen.has('edge:' + cid)) customSeen.set('edge:' + cid, { id: cid, scope: 'edge', type: 'string', name: cid });
      }
    }
    return {
      title:'imported-dot',
      nodes:arr.map(({original, __hasPos, ...n}) => n),
      edges,
      customAttributes: [...customSeen.values()],
      legacyPixels: dotUnits.legacyPixels === true
    };
  }
  function parseShape(raw){
    const s = String(raw || '').toLowerCase();
    if(s.includes('disc') || s.includes('disk') || s.includes('circle') || s.includes('ellipse') || s.includes('oval')) return 'circle';
    if(s.includes('diamond')) return 'diamond';
    if(s.includes('square') || s.includes('rect') || s.includes('box')) return 'square';
    // "invtriangle" is DOT's downward triangle; it must be tested before the
    // generic "triangle" rule below or every downward triangle becomes upward.
    // `triangle2` is QVGE's internal name for the same shape (it appears in XGR
    // files and class attributes), so it belongs on this branch too — without
    // it the generic rule below turned it into an upward triangle.
    if(s.includes('invtri') || s.includes('triangledown') || s === 'triangle down' || s === 'triangle-down' || s === 'triangle2') return 'triangleDown';
    if(s.includes('triangleup') || s === 'triangle up' || s === 'triangle-up') return 'triangleUp';
    if(s.includes('hexagon') || s.includes('hex')) return 'hexagon';
    if(s.includes('triangle')) return 'triangleUp';
    return '';
  }
  function parseStrokeStyle(raw){
    const s = String(raw || '').toLowerCase().trim();
    if(!s) return '';
    // QVGE/CUtils exact mapping: none, solid, dotted, dashed, dashdot, dashdotdot
    // Also handle GraphViz DOT style values (dashed/dotted/solid/bold/invis) and
    // common hyphen variants. Order matters: longest first.
    if(s === 'none' || s === 'nopen' || s === 'transparent' || s === 'invis' || s === 'invisible' || s.includes('invis')) return 'none';
    if(s.includes('dashdotdot') || s.includes('dash-dot-dot') || s.includes('dash_dot_dot')) return 'dashdotdot';
    if(s.includes('dashdot') || s.includes('dash-dot') || s.includes('dash_dot')) return 'dashdot';
    if(s.includes('dash')) return 'dashed';
    if(s.includes('dot')) return 'dotted';
    if(s.includes('solid')) return 'solid';
    // Qt enum names that may leak through
    if(s.includes('dashline')) return 'dashed';
    if(s.includes('dotline')) return 'dotted';
    if(s.includes('dashdotline') && !s.includes('dashdotdot')) return 'dashdot';
    if(s.includes('dashdotdotline')) return 'dashdotdot';
    return '';
  }
  // CSS named colors → hex. Handles common color names.
  const NAMED_COLORS = {
    black:'#000000', white:'#ffffff', red:'#ff0000', green:'#008000', blue:'#0000ff',
    yellow:'#ffff00', cyan:'#00ffff', magenta:'#ff00ff', gray:'#808080', grey:'#808080',
    silver:'#c0c0c0', maroon:'#800000', olive:'#808000', lime:'#00ff00', aqua:'#00ffff',
    teal:'#008080', navy:'#000080', fuchsia:'#ff00ff', purple:'#800080',
    orange:'#ffa500', pink:'#ffc0cb', brown:'#a52a2a', violet:'#ee82ee',
    indigo:'#4b0082', gold:'#ffd700', coral:'#ff7f50', salmon:'#fa8072',
    khaki:'#f0e68c', lavender:'#e6e6fa', tan:'#d2b48c', turquoise:'#40e0d0'
  };
  // Blank the *contents* of every quoted and HTML-like string, keeping the
  // length identical so every index still lines up with the original source.
  //
  // `maskDotSyntax` protects the parser from brackets inside labels but leaves
  // their text intact, which is right for reading values and wrong for deciding
  // what a file *declares*: a node labelled `inputscale=72` would otherwise read
  // as a units declaration and rescale the whole document.
  function blankDotStrings(src: string): string {
    const out = src.split('');
    const hide = (from: number, to: number) => { for(let k = from; k < to && k < out.length; k++) out[k] = ' '; };
    for(let i = 0; i < src.length;){
      if(src[i] === '"'){
        let j = i + 1;
        while(j < src.length){
          if(src[j] === '\\'){ j += 2; continue; }
          if(src[j] === '"') break;
          j++;
        }
        hide(i + 1, Math.min(j, src.length));
        i = j + 1;
        continue;
      }
      if(src[i] === '<'){
        let depth = 1, j = i + 1;
        while(j < src.length && depth > 0){
          if(src[j] === '<') depth++;
          else if(src[j] === '>'){ depth--; if(depth === 0) break; }
          j++;
        }
        hide(i + 1, Math.min(j, src.length));
        i = j + 1;
        continue;
      }
      i++;
    }
    return out.join('');
  }

  // Which unit a DOT file's `pos` values are in, expressed as points per inch.
  //
  // Three spellings reach this reader and they do not agree on a unit:
  //
  //  * a layout program's output (`dot -Tdot`, `neato -Tdot`) — POINTS, the unit
  //    GraphViz documents for `pos` output and the one `neato -n` consumes;
  //  * a hand-written `neato`/`fdp` input — INCHES unless `inputscale` says
  //    otherwise, and `inputscale` is a graph attribute only;
  //  * this editor's own export — INCHES, like QVGE's, naming `neato` in the
  //    graph attributes so another tool can reproduce the layout.
  //
  // Guessing from the numbers alone cannot work (a graph can legitimately span
  // hundreds of points or a few inches), so the units come from what the file
  // says about itself, in this order:
  //
  //  1. an explicit `inputscale` graph attribute — points per inch, directly.
  //     `inputscale=0` is GraphViz's documented alias for 72;
  //  2. `pin` or a `!` on any `pos` — the file asks for its positions to be
  //     kept as they are, which is `neato -n` semantics: points;
  //  3. an engine that only lays out (`dot`, `circo`, `twopi`, `osage`,
  //     `patchwork`) can only have produced these positions itself: points;
  //  4. otherwise inches, which is what unmarked `neato`/`fdp` input means.
  //
  // Every step looks at the graph's own attributes, never at arbitrary text: a
  // label reading "inputscale=72" must not rescale the document, so quoted and
  // HTML strings are blanked before anything is matched.
  function dotGraphUnits(body: string): { pointsPerInch: number; legacyPixels?: boolean } {
    // A graph-level `graph [...]` statement wins over a `name = value` written
    // anywhere in the body: the latter also matches a statement's stray text,
    // and a declaration placed after the nodes is still a graph declaration.
    // Both are read from the string-blanked source.
    // Two views of the same source: `valuesReadable` keeps attribute values
    // (needed for `inputscale=72`, `layout="dot"`, `pos="…!"`), while
    // `declarationsOnly` blanks every string so text cannot impersonate a
    // declaration. Lengths are preserved, so both index the same positions.
    const valuesReadable = maskDotSyntax(body);
    const unquote = (raw: string): string => {
      if(raw[0] === '"' && raw.length > 1) return dotUnescape(raw.slice(1, -1)).trim();
      if(raw[0] === '<') return raw.slice(1, -1).trim();
      return raw.trim();
    };
    // Graph-level attributes, and only those. `readScalar` used to accept a
    // `name = value` anywhere in the body — including inside a node's attribute
    // list, so `a [pos="1,2", inputscale=72]` rescaled the whole document from
    // a node property. GraphViz binds `inputscale` at graph scope; the same key
    // on a node or edge is that element's own attribute.
    //
    // A `graph [ ... ]` statement is a graph attribute wherever it appears, even
    // after nodes, as is `graph.attr = value` and a bare `key = value` at body
    // scope. `subgraph x { ... }` is a nested scope and is skipped whole.
    //
    // The walk runs over the ORIGINAL body: `maskDotSyntax` replaces `[`, `]`
    // and `{` with sentinels, so it cannot be used to find statement structure
    // (that is what broke the first attempt at this). Values are taken from the
    // masked copies, whose indices line up one-to-one with the original.
    const graphAttrs: AnyRecord = {};
    {
      const start = blankDotStrings(body);
      const valueAt = (from: number, to: number) => valuesReadable.slice(from, to);
      let i = 0;
      const skipBalanced = (from: number, openCh: string, closeCh: string): number => {
        // `from` points at the opening bracket in the blanked source.
        let d = 0, j = from;
        while(j < start.length){
          if(start[j] === openCh) d++;
          else if(start[j] === closeCh){ d--; if(d === 0) return j + 1; }
          j++;
        }
        return start.length;
      };
      while(i < start.length){
        const ch = start[i];
        if(ch === ';' || ch === ',' || /\s/.test(ch)){ i++; continue; }
        // The graph's own header is not part of `body`, but a stray `digraph`
        // would otherwise be read as a node name.
        const sub = /^(?:strict\s+)?(?:di|)graph\b/i.exec(start.slice(i));
        if(sub){ i += sub[0].length; continue; }
        const subg = /^subgraph\b[^{]*\{/i.exec(start.slice(i));
        if(subg){ i = skipBalanced(i + subg[0].length - 1, '{', '}'); continue; }
        const gb = /^graph\s*\[/i.exec(start.slice(i));
        if(gb){
          const from = i + gb[0].length - 1;
          const to = skipBalanced(from, '[', ']');
          const parsed = parseAttrList(valueAt(from + 1, to - 1));
          for(const k of Object.keys(parsed)) graphAttrs[k] = parsed[k];
          i = to;
          continue;
        }
        // `graph.name = value`, and bare `name = value` at body scope.
        const kv = /^(?:graph\s*\.\s*)?([A-Za-z_][\w.]*)\s*=(?!=)\s*/i.exec(start.slice(i));
        if(kv){
          const from = i + kv[0].length;
          const literal = /^("(?:[^"\\]|\\.)*"|<[^>]*>|[^,;\s\]}]+)/.exec(valueAt(from, start.length));
          if(literal){
            graphAttrs[kv[1].toLowerCase()] = unquote(valueAt(from, from + literal[0].length));
            i = from + literal[0].length;
            continue;
          }
        }
        // An element statement: its attribute list belongs to the element, so
        // skip the whole list — this is what stops a node's `inputscale`.
        const el = /^(?:"(?:[^"\\]|\\.)*"|[A-Za-z0-9_:.\-]+)\s*(?:--|->)?\s*\[/i.exec(start.slice(i));
        if(el){
          const bracket = i + el[0].length - 1;
          i = skipBalanced(bracket, '[', ']');
          continue;
        }
        i++;
      }
    }
    const readScalar = (name: string): string | null => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(graphAttrs, key) ? String(graphAttrs[key]).trim() : null;
    };
    const inputscale = readScalar('inputscale');
    if(inputscale != null && inputscale !== ''){
      const value = Number(inputscale);
      // 0 is GraphViz's alias for 72. Anything else that is not a positive
      // number is not a units declaration; ignoring it beats letting a typo
      // rescale the whole document.
      if(Number.isFinite(value) && value === 0) return { pointsPerInch: 72 };
      if(Number.isFinite(value) && value > 0) return { pointsPerInch: value };
    }
    // A `!` on `pos` is NOT a units marker: our own export (and QVGE) writes
    // inches with `!` to pin the node, and `neato -n` reads points with the same
    // suffix. Treating it as "points" made every file this app produced import
    // 72x too small. What does identify a laid-out GraphViz file is `bb` or a
    // concrete engine in `layout`, both checked below.
    const layout = (readScalar('layout') || '').toLowerCase();
    if(/^(dot|circo|twopi|osage|patchwork)\b/.test(layout)) return { pointsPerInch: 72 };
    // `dot -Tdot` stamps the bounding box in points; `neato`/`fdp` do not. When
    // `layout` is absent (a raw `-Tdot` file names no engine) this is the only
    // reliable signal that the numbers were produced by a layout run.
    if(readScalar('bb') != null) return { pointsPerInch: 72 };
    // NOTHING ELSE IS GUESSED. An earlier version inferred pixels from wide
    // coordinate spans, and the review was right that it is unsound in both
    // directions: two nodes with inch `pos` 0 and 100 imported at 100 instead of
    // 7200, and an old pixel file whose nodes sat 30 apart imported at 2160.
    // Units are not recoverable from the numbers; the reader picks them
    // (`importDot`'s legacy option) instead.
    return { pointsPerInch: 1 };
  }
  // Label typography, one table for nodes and edges. QVGE writes a label's
  // colour/size/font as the GraphViz `fontcolor`/`fontsize`/`fontname`
  // attributes (`CFileSerializerDOT::doWriteLabel`), and reads `xlabel` as a
  // label when `label` is absent (`CFormatDOT::readLabel`). Neither was
  // understood here, so a QVGE file lost its label text and every file lost
  // the label's typography. Keep the names in sync with `dotLabelAttrs` in
  // 50-import-export.ts, which writes them back.
  function readDotLabelAttrs(attrs, target){
    // `label` wins whenever the attribute is PRESENT, including when its text
    // happens to equal the node id or is empty — `n [label="n", xlabel="other"]`
    // says the label is "n", and inferring "absent" from the text turned it into
    // "other". Only a file that declares no `label` at all falls back to
    // `xlabel`, which is what `CFormatDOT::readLabel` does.
    const labelDeclared = Object.prototype.hasOwnProperty.call(attrs, 'label');
    if(!labelDeclared && attrs.xlabel != null && attrs.xlabel !== '') target.label = String(attrs.xlabel).slice(0, 80);
    const lc = parseColor(attrs.fontcolor);
    if(lc) (target as any).labelColor = lc;
    if(attrs.fontsize != null && Number.isFinite(Number(attrs.fontsize))){
      (target as any).labelSize = Math.min(72, Math.max(4, Number(attrs.fontsize)));
    }
    if(attrs.fontname){
      // QVGE appends the style to the family when it writes a bold/italic
      // font ("DejaVu Sans bold"); the editor's field is a family only.
      (target as any).labelFont = String(attrs.fontname).replace(/\s+(bold|italic)\s*$/gi, '').slice(0, 60);
    }
    return target;
  }
  function parseColor(raw){
    if(!raw) return null;
    const s = String(raw).trim().toLowerCase();
    if(/^#[0-9a-f]{6}$/i.test(s)) return s;
    if(/^#[0-9a-f]{3}$/i.test(s)){ // expand #abc → #aabbcc
      return '#' + s[1]+s[1]+s[2]+s[2]+s[3]+s[3];
    }
    if(NAMED_COLORS[s]) return NAMED_COLORS[s];
    // rgb(r,g,b) format
    const rgb = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if(rgb) return '#' + [rgb[1],rgb[2],rgb[3]].map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
    return null;
  }
// === DOT-CORE-END ===
