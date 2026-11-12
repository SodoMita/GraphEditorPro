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
  // Blanks the syntax bytes that live inside quoted strings: braces (which the
  // matchers would read as block delimiters) and arrows (which the edge matcher
  // would read as operators). Length is preserved 1:1, so every match offset
  // still indexes the original, and the placeholders are mapped back out of
  // extracted attribute values via unmaskDotSyntax.
  function maskDotSyntax(src: string): string {
    let out = '';
    for(let i = 0; i < src.length;){
      const c = src[i];
      if(c === '"'){
        out += '"'; i++;
        while(i < src.length){
          const d = src[i];
          if(d === '\\'){ out += d; if(i + 1 < src.length){ out += src[i + 1]; i += 2; } else i++; continue; }
          if(d === '"'){ out += '"'; i++; break; }
          if(d === '{') out += '\u0001';
          else if(d === '}') out += '\u0002';
          else if(d === '-' && src[i + 1] === '>'){ out += '-\u0003'; i += 2; continue; }
          else if(d === '-' && src[i + 1] === '-'){ out += '-\u0004'; i += 2; continue; }
          else out += d;
          i++;
        }
        continue;
      }
      out += c; i++;
    }
    return out;
  }
  function unmaskDotSyntax(s: string): string {
    return s.replace(/\u0001/g, '{').replace(/\u0002/g, '}').replace(/\u0003/g, '>').replace(/\u0004/g, '-');
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
  const dotClampArrowSize = (v: number) => Math.min(DOT_ARROW_SIZE_MAX, Math.max(DOT_ARROW_SIZE_MIN, v));
  function parseDot(text){
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
    const hasStructure = (open >= 0 && close > open) && headerOk;
    const nodes = new Map<string, AnyRecord>(), edges: GraphEdge[] = [];
    const ensureNode = id => { if(!nodes.has(id)) nodes.set(id, {id:safeId(id,'n'), original:id, label:id, x:0, y:0, shape:'circle', color:'#0ea5e9'}); return nodes.get(id); };
    // A bare token must contain at least one word-ish character: a run of
    // pure punctuation ('--', ':.') is never a node reference or endpoint —
    // it is the arrow operator or noise, and must not invent a node.
    const id = '("(?:\\.|[^"])+"|[A-Za-z0-9_:.\\-]*[A-Za-z0-9_][A-Za-z0-9_:.\\-]*)';
    const edgeRe = new RegExp(id + '\\s*(--|->)\\s*' + id + '\\s*(?:\\[([^\\]]*)\\])?', 'g');
    const work = maskDotSyntax(body);
    let m;
    while((m = edgeRe.exec(work))){
      const fromOrig = cleanDotToken(m[1]), toOrig = cleanDotToken(m[3]), attrs = parseAttrList(m[4] || '');
      const a = ensureNode(fromOrig), b = ensureNode(toOrig);
      const dotWeight = attrs.weight != null ? attrs.weight : (attrs.label || '');
      // QVGE tristate: '->' and the graph's directedness both mean "directed".
      const initDir = m[2] === '->' || directedGraph ? 'directed' : 'undirected';
      const e = { id:'e' + (edges.length+1), from:a.id, to:b.id, weight:dotWeight, label:String(attrs.label && attrs.label !== attrs.weight ? attrs.label : ''), directed: initDir !== 'undirected', direction: initDir } as any;
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
        if(mv > 5){
          (e as any).arrowSize = dotClampArrowSize(mv);
        } else {
          (e as any).arrowSize = dotClampArrowSize(mv * DOT_DEFAULT_ARROW_SIZE);
        }
      }
      // dir attribute (QVGE uses dir=forward/none/both) maps to directed/undirected/mutual
      if(attrs.dir){
        const dir = String(attrs.dir).toLowerCase();
        if(dir === 'none' || dir === 'undirected'){ (e as any).direction = 'undirected'; (e as any).directed = false; }
        else if(dir === 'both' || dir === 'mutual'){ (e as any).direction = 'mutual'; (e as any).directed = true; }
        else if(dir === 'forward' || dir === 'directed' || dir === 'true'){ (e as any).direction = 'directed'; (e as any).directed = true; }
      }
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
      if(attrs.width != null && Number.isFinite(Number(attrs.width))) (n as any).width = Math.max(10, Math.round(Number(attrs.width)*72));
      if(attrs.height != null && Number.isFinite(Number(attrs.height))) (n as any).height = Math.max(10, Math.round(Number(attrs.height)*72));
      if(attrs.pos){ const parts = attrs.pos.replace('!','').split(',').map(Number); if(Number.isFinite(parts[0])) n.x = parts[0]; if(Number.isFinite(parts[1])) n.y = -parts[1]; }
    }
    const arr = [...nodes.values()];
    // A structurally recognized DOT graph with zero nodes is a valid empty
    // document ONLY when its body consists solely of no-content statements —
    // the exporter's empty output satisfies this. Anything else ("digraph G {
    // a -> }", "graph [label=];") is real input the parser could not use,
    // not an empty graph — reject it.
    if(!arr.length){
      const after = close >= 0 ? stripped.slice(close + 1) : '';
      return (hasStructure && /^\s*$/.test(after) && scanDotStructure(body)) ? { title:'imported-dot', nodes: [], edges: [] } : null;
    }
    if(arr.every(n => n.x === 0 && n.y === 0) && arr.length > 1){
      const r = Math.max(120, arr.length * 24);
      arr.forEach((n,i) => { const a=-Math.PI/2+i*2*Math.PI/arr.length; n.x=Math.cos(a)*r; n.y=Math.sin(a)*r; });
    }
    return {title:'imported-dot', nodes:arr.map(({original,...n}) => n), edges};
  }
  function parseShape(raw){
    const s = String(raw || '').toLowerCase();
    if(s.includes('disc') || s.includes('disk') || s.includes('circle') || s.includes('ellipse') || s.includes('oval')) return 'circle';
    if(s.includes('diamond')) return 'diamond';
    if(s.includes('square') || s.includes('rect') || s.includes('box')) return 'square';
    // "invtriangle" is DOT's downward triangle; it must be tested before the
    // generic "triangle" rule below or every downward triangle becomes upward.
    if(s.includes('invtri') || s.includes('triangledown') || s === 'triangle down' || s === 'triangle-down') return 'triangleDown';
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
