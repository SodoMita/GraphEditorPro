  function nodeVisual(n){
    const d = state.settings.nodeDefaults || {};
    const effectiveType = n.type || d.type || '';
    const ts = (n.type && state.settings.nodeTypeStyles && state.settings.nodeTypeStyles[n.type]) || {};
    const dts = (d.type && state.settings.nodeTypeStyles && state.settings.nodeTypeStyles[d.type]) || {};
    return {
      shape: n.shape || ts.shape || (d.type ? (dts.shape || d.shape) : d.shape),
      color: n.color || ts.color || (d.type ? (dts.color || d.color) : d.color),
      type: effectiveType,
      width: n.width != null ? n.width : (ts.width != null ? ts.width : (d.type && dts.width != null ? dts.width : d.width)),
      height: n.height != null ? n.height : (ts.height != null ? ts.height : (d.type && dts.height != null ? dts.height : d.height)),
      strokeColor: n.strokeColor || ts.strokeColor || (d.type ? (dts.strokeColor || d.strokeColor) : d.strokeColor),
      strokeSize: n.strokeSize != null ? n.strokeSize : (ts.strokeSize != null ? ts.strokeSize : (d.type && dts.strokeSize != null ? dts.strokeSize : d.strokeSize)),
      strokeStyle: n.strokeStyle || ts.strokeStyle || (d.type ? (dts.strokeStyle || d.strokeStyle) : d.strokeStyle),
      labelColor: n.labelColor || ts.labelColor || (d.type ? (dts.labelColor || d.labelColor) : d.labelColor),
      labelSize: n.labelSize != null ? n.labelSize : (ts.labelSize != null ? ts.labelSize : (d.type && dts.labelSize != null ? dts.labelSize : d.labelSize)),
      labelPosition: n.labelPosition || ts.labelPosition || (d.type ? (dts.labelPosition || d.labelPosition) : d.labelPosition),
      labelFont: n.labelFont || ts.labelFont || (d.type ? (dts.labelFont || d.labelFont) : d.labelFont)
    };
  }
  function edgeVisual(e){
    const d = state.settings.edgeDefaults || {};
    const effectiveType = e.type || d.type || '';
    const ts = (e.type && state.settings.edgeTypeStyles && state.settings.edgeTypeStyles[e.type]) || {};
    const dts = (d.type && state.settings.edgeTypeStyles && state.settings.edgeTypeStyles[d.type]) || {};
    return {
      color: e.color || ts.color || (d.type ? (dts.color || d.color) : d.color),
      type: effectiveType,
      strokeSize: e.strokeSize != null ? e.strokeSize : (ts.strokeSize != null ? ts.strokeSize : (d.type && dts.strokeSize != null ? dts.strokeSize : d.strokeSize)),
      strokeStyle: e.strokeStyle || ts.strokeStyle || (d.type ? (dts.strokeStyle || d.strokeStyle) : d.strokeStyle),
      labelColor: e.labelColor || ts.labelColor || (d.type ? (dts.labelColor || d.labelColor) : d.labelColor),
      labelSize: e.labelSize != null ? e.labelSize : (ts.labelSize != null ? ts.labelSize : (d.type && dts.labelSize != null ? dts.labelSize : d.labelSize)),
      labelFont: e.labelFont || ts.labelFont || (d.type ? (dts.labelFont || d.labelFont) : d.labelFont)
    };
  }
  // === Edge weight visualization helpers ===
  // Normalizes a weight value to t ∈ [0,1] based on range and correlation function.
  // min > max is valid → lower values yield higher t (inverted).
  function normalizeWeight(v, min, max, corr){
    const lo = Math.min(min, max), hi = Math.max(min, max);
    if(hi === lo) return 0.5; // degenerate range → midpoint
    const vc = Math.max(lo, Math.min(hi, v)); // clamp to range
    let t;
    switch(corr){
      case 'log':
        if(lo <= 0){ t = (vc - lo) / (hi - lo); } // fallback to linear if non-positive
        else { const ll = Math.log(lo), lh = Math.log(hi); t = lh === ll ? 0.5 : (Math.log(vc) - ll) / (lh - ll); }
        break;
      case 'exp': {
        const el = Math.exp(lo), eh = Math.exp(hi);
        t = eh === el ? 0.5 : (Math.exp(vc) - el) / (eh - el);
        break;
      }
      case 'sqrt':
        if(lo < 0){ t = (vc - lo) / (hi - lo); } // fallback for negative
        else { const sl = Math.sqrt(lo), sh = Math.sqrt(hi); t = sh === sl ? 0.5 : (Math.sqrt(vc) - sl) / (sh - sl); }
        break;
      default: // linear
        t = (vc - lo) / (hi - lo);
    }
    // Invert if min > max (lower values → higher t → higher width/color intensity)
    if(min > max) t = 1 - t;
    return Math.max(0, Math.min(1, t));
  }
  function lerpColor(lowHex, highHex, t){
    const lh = String(lowHex || '#22d3ee').replace('#',''), hh = String(highHex || '#f59e0b').replace('#','');
    if(lh.length !== 6 || hh.length !== 6) return highHex || '#f59e0b';
    const lr = parseInt(lh.slice(0,2),16), lg = parseInt(lh.slice(2,4),16), lb = parseInt(lh.slice(4,6),16);
    const hr = parseInt(hh.slice(0,2),16), hg = parseInt(hh.slice(2,4),16), hb = parseInt(hh.slice(4,6),16);
    const r = Math.round(lr + (hr - lr) * t), g = Math.round(lg + (hg - lg) * t), b = Math.round(lb + (hb - lb) * t);
    return '#' + [r,g,b].map(n => n.toString(16).padStart(2,'0')).join('');
  }
  function edgeWeightNumber(e){
    if(e.weight === '' || e.weight == null) return null;
    const w = Number(e.weight);
    return Number.isFinite(w) ? w : null;
  }
  function isWeightInRange(w, min, max){
    const lo = Math.min(min, max), hi = Math.max(min, max);
    return w >= lo && w <= hi;
  }
  // Returns render style with weight-based color/width overrides applied.
  function edgeRenderStyle(e){
    const v = edgeVisual(e);
    const gd = state.settings.graphDefaults || {};
    const mode = gd.edgeWeightMode || 'number';
    if(mode === 'color' || mode === 'width'){
      const w = edgeWeightNumber(e);
      if(w != null){
        const t = normalizeWeight(w, gd.edgeWeightMin ?? 1, gd.edgeWeightMax ?? 10, gd.edgeWeightCorr || 'linear');
        if(mode === 'color'){
          v.color = lerpColor(gd.edgeWeightColorLow || '#22d3ee', gd.edgeWeightColorHigh || '#f59e0b', t);
        } else { // width
          v.strokeSize = (gd.edgeWidthMin ?? 1) + ((gd.edgeWidthMax ?? 8) - (gd.edgeWidthMin ?? 1)) * t;
        }
      }
    }
    return v;
  }
  // Dash patterns identical to QVGE/Qt (QPen::dashPattern):
  // dash=4, dot=1, space=2 in units of pen width (QPen source). QVGE maps:
  // solid->SolidLine, dashed->DashLine [4,2], dotted->DotLine [1,2],
  // dashdot->DashDotLine [4,2,1,2], dashdotdot->DashDotDotLine [4,2,1,2,1,2],
  // none->NoPen (no stroke). These are written in SVG user units as
  // patternValue * renderSize(width) so they scale with the floating origin
  // and renderScale exactly like Qt's width-scaled pattern.
  const dashCache = new Map();
  function strokeDashArray(style, size){
    if(!style || style === 'solid' || style === 'none') return 'none';
    const key = style + '|' + size + '|' + renderScale;
    let dash = dashCache.get(key);
    if(dash === undefined){
      const s = renderSize(size);
      // Qt patterns in width-units
      const patterns = {
        dashed: [4, 2],
        dotted: [1, 2],
        dashdot: [4, 2, 1, 2],
        dashdotdot: [4, 2, 1, 2, 1, 2]
      };
      const pat = patterns[style];
      if(!pat) return 'none';
      dash = pat.map(v => v * s).join(' ');
      if(dashCache.size > 128) dashCache.clear();
      dashCache.set(key, dash);
    }
    return dash;
  }
  function strokeLineCap(style){
    // QVGE uses Qt::FlatCap (SquareCap) for edges and default SquareCap for nodes.
    // SVG "square" matches that visual extension; "butt" would shorten dashes.
    if(!style || style === 'solid' || style === 'none') return 'butt';
    return 'square';
  }
  // === Label outline / background (Style tab → Graph defaults) ===
  // Applies to node labels, edge labels, and edge weights. 'outline' draws a
  // paint-order stroke halo around the glyphs, 'plate' a rounded background
  // rect behind the text, 'none' renders bare text. The width setting is the
  // halo thickness for a 13px label and scales proportionally with the label
  // size, so outlines stay readable at any label size.
  function labelOutlineConf(){
    const vc = passVisuals;
    if(vc && vc.labelOutline) return vc.labelOutline;
    const gd = state.settings.graphDefaults || {};
    const mode = gd.labelOutline;
    const conf = {
      mode: (mode === 'plate' || mode === 'none') ? mode : 'outline',
      color: gd.labelOutlineColor || '#020617',
      width: clamp(finite(gd.labelOutlineWidth, 4), 0, 10)
    };
    if(vc) vc.labelOutline = conf;
    return conf;
  }
  function labelOutlineThickness(conf, labelSize){
    return conf.width * (labelSize / 13);
  }
  function round2(v){ return Math.round(v * 100) / 100; }
  // Measures a rendered <text> element once per (text, size, font) signature.
  // getComputedTextLength forces layout, so it must not run per render pass;
  // when measurement is unavailable (e.g. jsdom) fall back to a per-glyph
  // estimate that is close enough for a background plate.
  function measuredTextWidth(el, text, size, font){
    const sig = text + '|' + size + '|' + font + '|' + renderScale;
    if(el.__twSig !== sig){
      let w = 0;
      try { if(typeof el.getComputedTextLength === 'function') w = el.getComputedTextLength(); } catch(err){ w = 0; }
      if(!w || !Number.isFinite(w) || w <= 0) w = String(text).length * size * 0.62;
      el.__twSig = sig; el.__tw = w;
    }
    return el.__tw;
  }
  // Keeps a <text> element and its optional background plate (a rect directly
  // behind it) in sync with the configured outline settings. x/y/anchor/
  // baseline describe the text placement; the plate geometry derives from the
  // measured text width. Returns the plate element or null.
  function applyLabelOutline(g, textEl, key, x, y, text, size, font, anchor, baseline){
    const conf = labelOutlineConf();
    if(!textEl) return null;
    const s = renderSize(size);
    if(conf.mode === 'outline' && conf.width > 0){
      setAttr(textEl, 'stroke', conf.color);
      setAttr(textEl, 'stroke-width', renderSize(labelOutlineThickness(conf, size)));
    } else {
      setAttr(textEl, 'stroke', 'none');
      setAttr(textEl, 'stroke-width', '0');
    }
    const plateKey = key + 'Plate';
    let plate = g[plateKey] || null;
    if(conf.mode === 'plate' && text){
      if(!plate){
        plate = document.createElementNS(NS,'rect');
        plate.setAttribute('class','label-plate');
        g.insertBefore(plate, textEl);
        g[plateKey] = plate;
      } else if(plate.nextSibling !== textEl){
        g.insertBefore(plate, textEl); // stays directly behind its text
      }
      // The text's font-size is already scaled, so its measured width is in
      // scaled SVG units. Only size-derived padding/height need scaling.
      const tw = measuredTextWidth(textEl, text, size, font);
      const pad = Math.max(renderSize(2), renderSize(labelOutlineThickness(conf, size) * 0.8));
      const h = s * 1.12 + pad;
      let rx = x - tw / 2 - pad, ry = y - h / 2;
      if(anchor === 'start') rx = x - pad;
      else if(anchor === 'end') rx = x - tw - pad;
      if(baseline === 'auto') ry = y - s * 0.36 - h / 2;
      else if(baseline === 'hanging') ry = y + s * 0.36 - h / 2;
      setAttr(plate, 'x', rx); setAttr(plate, 'y', ry);
      setAttr(plate, 'width', tw + pad * 2); setAttr(plate, 'height', h);
      setAttr(plate, 'rx', Math.min(renderSize(4), s * 0.25));
      setAttr(plate, 'fill', conf.color);
    } else if(plate){
      plate.remove(); g[plateKey] = null; plate = null;
    }
    return plate;
  }
  function removeLabelPlate(g, key){
    const plateKey = key + 'Plate';
    const plate = g[plateKey];
    if(plate){ plate.remove(); g[plateKey] = null; }
  }
  function clearEdgeText(g, kind){
    const key = kind === 'label' ? '__label' : '__weight';
    const el = g[key];
    if(el){ el.remove(); g[key] = null; }
    removeLabelPlate(g, key);
  }
  function setEdgeTextHidden(g, hidden){
    for(const key of ['__label','__weight']){
      const el = g[key];
      if(el){ if(hidden) setAttr(el, 'display', 'none'); else removeAttr(el, 'display'); }
      const plate = g[key + 'Plate'];
      if(plate){ if(hidden) setAttr(plate, 'display', 'none'); else removeAttr(plate, 'display'); }
    }
  }

  // Label/weight content is independent of camera visibility. Keeping the text
  // elements (hidden, not removed) for a visible-but-off-centre midpoint lets a
  // plain pan re-show them without a full render pass; only an EMPTY path
  // removes them, preserving the fully-clipped ghost-label fix.
  function edgeLabelWeightText(e, showLabels = shouldShowLabels()){
    let labelText = '', weightText = '';
    if(!showLabels) return {labelText, weightText};
    const gd = state.settings.graphDefaults || {};
    const weightMode = gd.edgeWeightMode || 'number';
    const wMin = gd.edgeWeightMin ?? 1, wMax = gd.edgeWeightMax ?? 10;
    if(e.label) labelText = e.label;
    if(e.weight !== '' && e.weight != null){
      const w = edgeWeightNumber(e);
      if(w != null){
        if(weightMode === 'number') weightText = e.weight;
        else if((weightMode === 'color' || weightMode === 'width') && !isWeightInRange(w, wMin, wMax)) weightText = e.weight;
      }
    }
    return {labelText, weightText};
  }
  function paintEdgeText(g, d, v, labelText, weightText, visible){
    if(!d.path || (!labelText && !weightText)){
      clearEdgeText(g, 'label'); clearEdgeText(g, 'weight');
      return;
    }
    const hasBoth = Boolean(labelText && weightText);
    const labelOffsetY = hasBoth ? -renderSize((v.labelSize || 12) * 0.75 + 2) : 0;
    let label = g.__label || null;
    if(labelText){
      if(!label){
        label = document.createElementNS(NS,'text');
        label.setAttribute('class','edge-label');
        label.setAttribute('text-anchor','middle'); label.setAttribute('dominant-baseline','middle');
        g.appendChild(label); g.__label = label;
      }
      if(label.textContent !== labelText) label.textContent = labelText;
      setAttr(label, 'x', d.labelX); setAttr(label, 'y', d.labelY + labelOffsetY);
      setAttr(label, 'fill', v.labelColor);
      setAttr(label, 'font-size', renderSize(v.labelSize));
      setAttr(label, 'font-family', v.labelFont);
      applyLabelOutline(g, label, '__label', d.labelX, d.labelY + labelOffsetY, labelText, v.labelSize, v.labelFont, 'middle', 'middle');
    } else if(label){ clearEdgeText(g, 'label'); label = null; }
    let weight = g.__weight || null;
    if(weightText){
      if(!weight){
        weight = document.createElementNS(NS,'text');
        weight.setAttribute('class','edge-weight');
        weight.setAttribute('text-anchor','middle'); weight.setAttribute('dominant-baseline','middle');
        g.appendChild(weight); g.__weight = weight;
      }
      if(weight.textContent !== weightText) weight.textContent = weightText;
      setAttr(weight, 'x', d.labelX); setAttr(weight, 'y', d.labelY);
      setAttr(weight, 'fill', v.labelColor);
      setAttr(weight, 'font-size', renderSize(v.labelSize));
      setAttr(weight, 'font-family', v.labelFont);
      applyLabelOutline(g, weight, '__weight', d.labelX, d.labelY, weightText, v.labelSize, v.labelFont, 'middle', 'middle');
    } else if(weight){ clearEdgeText(g, 'weight'); weight = null; }
    setEdgeTextHidden(g, !visible);
  }
  // A pan/wheel/pinch changes only the camera matrix. Re-evaluate midpoint
  // visibility in that same task so hidden labels reappear without waiting for
  // a document render that may never be scheduled.
  function syncEdgeLabelVisibility(){
    const showLabels = shouldShowLabels();
    for(const [id, g] of edgeEls){
      const e = edgeById(id); if(!e) continue;
      const a = nodeById(e.from), b = nodeById(e.to); if(!a || !b) continue;
      const d = g.__geoData;
      const visible = showLabels && Boolean(d && d.path) && edgeLabelVisible(a, b);
      setEdgeTextHidden(g, !visible);
    }
  }
  // === DOM write de-duplication ===
  // Every write to rendered graph elements goes through these helpers, which
  // skip the DOM entirely when the value equals the last write: unchanged
  // elements cost nothing, avoiding needless attribute parsing and
  // style/paint invalidation during full render passes.
  function attrBox(el){ return el.__ac || (el.__ac = Object.create(null)); }
  function setAttr(el, name, value){
    const c = attrBox(el);
    if(c[name] !== value){ c[name] = value; el.setAttribute(name, value); }
  }
  function removeAttr(el, name){
    const c = attrBox(el);
    if(c[name] !== undefined){ delete c[name]; el.removeAttribute(name); }
  }
  function toggleClass(el, name, on){
    const c = attrBox(el);
    const key = '⟂' + name;
    if(c[key] !== on){ c[key] = on; el.classList.toggle(name, on); }
  }
  function setText(el, text){
    const c = attrBox(el);
    if(c.__text !== text){ c.__text = text; el.textContent = text; }
  }
  // === Per-pass visual cache ===
  // Merged style objects and node "radii" are computed once per item and
  // reused by every edge that touches the item, keeping render passes and drag
  // frames free of repeated merges and short-lived allocations. Each render
  // pass (and each drag gesture) owns one cache.
  // Sorted-by-order cache — invalidated when nodes array identity/len or graphRev changes (reorder, add/remove)
  let sortedNodesCache = { arr: null as any, len: -1, rev: -1, sorted: [] as any[] };
  function sortedNodesByOrder(){
    const arr = state.nodes;
    if(sortedNodesCache.arr === arr && sortedNodesCache.len === arr.length && sortedNodesCache.rev === graphRev){
      return sortedNodesCache.sorted;
    }
    const sorted = [...arr].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    sortedNodesCache.arr = arr; sortedNodesCache.len = arr.length; sortedNodesCache.rev = graphRev; sortedNodesCache.sorted = sorted;
    return sorted;
  }
  // Per-pass visual cache includes visible nodes/ids and label outline config to avoid double work per renderCanvas
  function newVisualCache(){ return { node: new Map(), edge: new Map(), edgeStyle: new Map(), radius: new Map(), visibleNodes: null as any, visibleIds: null as any, labelOutline: null as any, showLabels: null as any }; }
  let passVisuals = null;
  function beginRenderPass(){ passVisuals = newVisualCache(); }
  function endRenderPass(){ passVisuals = null; }
  function visualFor(item, cache, compute, key){
    const c = cache || passVisuals;
    if(!c) return compute();
    let v = c[key].get(item.id);
    if(v === undefined){ v = compute(); c[key].set(item.id, v); }
    return v;
  }
  function nodeVisualC(n, vc=null){ return visualFor(n, vc, () => nodeVisual(n), 'node'); }
  function edgeVisualC(e, vc=null){ return visualFor(e, vc, () => edgeVisual(e), 'edge'); }
  // Distinct cache key from edgeVisualC: both merge styles for an edge, but
  // the results differ (weight-based overrides), so sharing a key would let
  // one return the other's cached object within a single pass.
  function edgeRenderStyleC(e, vc=null){ return visualFor(e, vc, () => edgeRenderStyle(e), 'edgeStyle'); }
  // === Node selection ring ===
  // The selection outline is a slightly larger copy of the node shape, placed
  // BEHIND the shape so the node's own fill colour stays visible. It exists
  // only while a node is selected (unselected nodes keep a single element).
  const SEL_RING_SCALE = 1.35;
  function selRingFor(shape, w, h){
    const S = SEL_RING_SCALE;
    const rw = renderSize(w), rh = renderSize(h), two = renderSize(2);
    let el;
    if(shape === 'square'){
      el = document.createElementNS(NS,'rect'); el.setAttribute('x',-rw/2*S); el.setAttribute('y',-rh/2*S); el.setAttribute('width',rw*S); el.setAttribute('height',rh*S);
    } else if(shape === 'diamond'){
      el = document.createElementNS(NS,'polygon'); el.setAttribute('points',`0,${-rh/2*S-two} ${rw/2*S+two},0 0,${rh/2*S+two} ${-rw/2*S-two},0`);
    } else if(shape === 'triangleUp'){
      el = document.createElementNS(NS,'polygon'); el.setAttribute('points',`0,${-rh/2*S} ${rw/2*S},${rh/2*S} ${-rw/2*S},${rh/2*S}`);
    } else if(shape === 'triangleDown'){
      el = document.createElementNS(NS,'polygon'); el.setAttribute('points',`0,${rh/2*S} ${rw/2*S},${-rh/2*S} ${-rw/2*S},${-rh/2*S}`);
    } else if(shape === 'hexagon'){
      const hx = rw/2*S, hy = rh/2*S, mx = rw/4*S;
      el = document.createElementNS(NS,'polygon'); el.setAttribute('points',`${-hx+mx},${-hy} ${hx-mx},${-hy} ${hx},0 ${hx-mx},${hy} ${-hx+mx},${hy} ${-hx},0`);
    } else {
      el = document.createElementNS(NS,'ellipse'); el.setAttribute('rx',rw/2*S); el.setAttribute('ry',rh/2*S);
    }
    el.setAttribute('class','node-sel');
    return el;
  }
  // Creates/removes/updates a node's selection ring and returns the ring
  // element (or null). Safe to call from render passes and the fast
  // selection-sync path alike.
  function syncNodeSelRing(g: any, _n: any, shape: string, w: number, h: number, selected: boolean){
    const selSig = shape + '|' + w + '|' + h + '|' + renderScale;
    let sel = g.__sel;
    if(selected){
      if(!sel || g.__selSig !== selSig){
        if(sel) sel.remove();
        sel = selRingFor(shape, w, h);
        g.insertBefore(sel, g.firstChild); // behind the shape
        g.__sel = sel; g.__selSig = selSig;
      }
    } else if(sel){
      sel.remove(); g.__sel = null; g.__selSig = null; sel = null;
    }
    return sel;
  }
  // === Edge arrowhead geometry ===
  // One place derives the tip triangle, so the arrow and its selection accent
  // can never disagree. `scale` grows the triangle about its own centre (the
  // centroid), which keeps the accent band even around the tip instead of only
  // pushing the apex forward.
  function edgeArrowPoints(d, scale = 1){
    const aw = renderSize(ARROW_HW), ang = d.arrowAngle;
    const px = -Math.sin(ang) * aw, py = Math.cos(ang) * aw;
    const lx = d.tx + px, ly = d.ty + py;
    const rx = d.tx - px, ry = d.ty - py;
    if(scale === 1) return `${d.tipX},${d.tipY} ${lx},${ly} ${rx},${ry}`;
    const cx = (d.tipX + lx + rx) / 3, cy = (d.tipY + ly + ry) / 3;
    return `${cx + (d.tipX - cx) * scale},${cy + (d.tipY - cy) * scale} ` +
      `${cx + (lx - cx) * scale},${cy + (ly - cy) * scale} ` +
      `${cx + (rx - cx) * scale},${cy + (ry - cy) * scale}`;
  }
  function hasEdgeTip(e, d){
    return Boolean(e && edgeHasEndArrow(e) && d && d.tipX != null && d.arrowAngle != null);
  }
  function hasEdgeStartTip(e, d){
    return Boolean(e && edgeHasStartArrow(e) && d && d.startTipX != null && d.startArrowAngle != null);
  }
  // === Edge selection ring ===
  // Like nodes, a selected edge gets an accent placed BEHIND itself, so the
  // edge's own colour (line *and* arrowhead) stays visible. The body accent is
  // a WIDE LINE: the identical path string as the line, just a thicker stroke.
  // That is deliberately not an outline of the edge shape — nothing has to be
  // derived or offset, so keeping it in sync costs one attribute write per part
  // and the browser only ever inflates a path it already has. The tip accent is
  // a larger copy of the tip triangle, centred on it and drawn behind it. Both
  // parts exist only while the edge is selected.
  const SEL_EDGE_HALO = 7, SEL_EDGE_MIN = 9; // accent width: edge + halo, never hairline
  const SEL_TIP_SCALE = 1.75; // the tip accent is the tip triangle, this much bigger
  // === Bulk-selection accent budget ===
  // A selected edge carries two extra elements (a wide copy of its path and a
  // bigger copy of its tip) so the edge's own colour stays visible inside the
  // highlight. That is the look, and it is cheap when few edges are selected.
  // A region select can select most of the graph's edges at once though: a rect
  // over a 1,500-node/4,388-edge document selects ~2,500 edges, i.e. ~5,000 new
  // elements created inside the release handler — a measured stall of ~25 ms.
  // Past the budget the accents are not created and the selected edges are
  // drawn in the accent colour instead: the highlight still covers exactly the
  // same edges, the selected ids keep their `selected` class, and nothing in the
  // hit-test, drag or panel path reads accents. Node rings are cheap by
  // comparison (one element per node, ~3 ms for 800) and keep the full look
  // unconditionally, so a large node selection still reads as selected.
  const SEL_ACCENT_EDGE_BUDGET = 320;
  function accentBudgetExceeded(_nNodes: number, nEdges: number){
    return nEdges > SEL_ACCENT_EDGE_BUDGET;
  }
  // Set once per render pass (see renderCanvas); read by both layer passes.
  let bulkAccents = false;
  // The stroke a selected edge is drawn in when the accents are budgeted out.
  const SEL_EDGE_COLOR = 'var(--accent)';
  function syncEdgeAccent(g: any, e: any, v: any, d: any, selected: boolean, bulk: boolean){
    if(bulk){
      // Colour instead of outline: no accent element is created, and one left
      // over from an earlier, smaller selection is dropped first so the two
      // looks can never be mixed.
      syncEdgeSelRing(g, e, v, d, false);
      setAttr(g.__line, 'stroke', selected ? SEL_EDGE_COLOR : (v && v.color));
      g.__bulkStroke = selected;
      return null;
    }
    // Leaving a bulk selection: the highlight lived on the line itself, so
    // there is no accent element to drop and the line has to be handed back to
    // its own colour. The regular accent, if any, was removed already.
    if(g.__bulkStroke){
      g.__bulkStroke = false;
      if(v) setAttr(g.__line, 'stroke', v.color);
    }
    return syncEdgeSelRing(g, e, v, d, selected);
  }
  function syncEdgeSelRing(g: any, e: any, v: any, d: any, selected: boolean){
    let sel: any = g.__sel, ring: any = g.__selArrow;
    if(!selected){
      if(sel){ sel.remove(); g.__sel = null; }
      if(ring){ ring.remove(); g.__selArrow = null; }
      return null;
    }
    const line = g.__line;
    // During a render pass or a gesture the caller holds the fresh geometry; on
    // a bare selection change it comes from the per-edge geometry cache, which
    // is the very data the visible line was drawn from.
    const geo = d || g.__geoData;
    // The accent always carries the edge's own path — the very string the line
    // was just given. Reading it back off the line is the cheapest source on a
    // bare selection change (`line.getAttribute` hands out the cached string,
    // whereas serialising `geo.path` again would allocate a copy per selected
    // edge, per pass).
    const accentPath = (geo && geo.path) || (line ? line.getAttribute('d') : '') || '';
    if(!sel){
      sel = document.createElementNS(NS,'path');
      sel.setAttribute('class','edge-sel');
      sel.setAttribute('fill','none');
      // Seed the cache with the path the element is created with, so the
      // setAttr below is a genuine no-op and costs no second attribute write.
      attrBox(sel).d = accentPath;
      sel.setAttribute('d', accentPath);
      g.insertBefore(sel, line || g.firstChild); // behind the line
      g.__sel = sel;
    }
    setAttr(sel, 'd', accentPath);
    setAttr(sel, 'stroke-width', renderSize(Math.max(SEL_EDGE_MIN, (v && v.strokeSize ? v.strokeSize : 0) + SEL_EDGE_HALO)));
    if(hasEdgeTip(e, geo)){
      if(!ring){
        ring = document.createElementNS(NS,'polygon');
        ring.setAttribute('class','edge-sel-arrow');
        // Behind the arrowhead and the line, so only its border shows as accent
        // and it never covers the edge itself. Insert before the selection line
        // accent (or the edge line) so both accents stay behind the edge.
        g.insertBefore(ring, sel || line || g.firstChild);
        g.__selArrow = ring;
      }
      setAttr(ring, 'points', edgeArrowPoints(geo, SEL_TIP_SCALE));
    } else if(ring){
      ring.remove(); g.__selArrow = null;
    }
    return sel;
  }
  // Geometry-only follow-up for a live gesture. A drag patches edge geometry in
  // place and deliberately skips the release re-render, so this is the only
  // writer able to keep the accent on the edge — without it the highlight stays
  // behind at the shape the edge moved away from.
  function moveEdgeSelRing(g: any, d: any){
    if(g.__sel) setAttr(g.__sel, 'd', d.path);
    if(g.__selArrow && d.tipX != null && d.arrowAngle != null) setAttr(g.__selArrow, 'points', edgeArrowPoints(d, SEL_TIP_SCALE));
  }
  function nodeRadiusC(n, vc){
    const c = vc || passVisuals;
    if(!c) return nodeRadius(n);
    let r = c.radius.get(n.id);
    if(r === undefined){ r = nodeRadius(n); c.radius.set(n.id, r); }
    return r;
  }
  function shouldShowLabels(){
    const vc = passVisuals;
    if(vc && vc.showLabels != null) return vc.showLabels;
    const policy = state.settings.graphDefaults?.labelsPolicy || 'auto';
    let res: boolean;
    if(policy === 'off') res = false;
    else if(policy === 'on') res = true;
    else res = state.nodes.length <= 30;
    if(vc) vc.showLabels = res;
    return res;
  }
  // Type lists are cached by nodes/edges identity/len/rev — O(V) only when graph actually changes
  let nodeTypesCache = { arr: null as any, len: -1, rev: -1, types: [] as string[] };
  function existingNodeTypes(){
    const arr = state.nodes;
    if(nodeTypesCache.arr === arr && nodeTypesCache.len === arr.length && nodeTypesCache.rev === graphRev){
      return nodeTypesCache.types;
    }
    const set = new Set<string>();
    for(const n of arr) if(n.type) set.add(n.type);
    const types = [...set].sort();
    nodeTypesCache.arr = arr; nodeTypesCache.len = arr.length; nodeTypesCache.rev = graphRev; nodeTypesCache.types = types;
    return types;
  }
  let edgeTypesCache = { arr: null as any, len: -1, rev: -1, types: [] as string[] };
  function existingEdgeTypes(){
    const arr = state.edges;
    if(edgeTypesCache.arr === arr && edgeTypesCache.len === arr.length && edgeTypesCache.rev === graphRev){
      return edgeTypesCache.types;
    }
    const set = new Set<string>();
    for(const e of arr) if(e.type) set.add(e.type);
    const types = [...set].sort();
    edgeTypesCache.arr = arr; edgeTypesCache.len = arr.length; edgeTypesCache.rev = graphRev; edgeTypesCache.types = types;
    return types;
  }

  function syncControls(){
    $('#docTitleInput').value = state.title;
    // Edit-tab node placement
    $('#nodeShape').value = state.settings.nodeShape;
    $('#nodeColor').value = state.settings.nodeColor;
    $('#nodeWidth').value = state.settings.nodeWidth;
    $('#nodeHeight').value = state.settings.nodeHeight;
    $('#nodeStrokeColor').value = state.settings.nodeStrokeColor;
    $('#nodeStrokeSize').value = state.settings.nodeStrokeSize;
    $('#nodeStrokeStyle').value = state.settings.nodeStrokeStyle;
    $('#nodeType').value = state.settings.nodeType;
    $('#nodeLabelColor').value = state.settings.nodeLabelColor;
    $('#nodeLabelFont').value = state.settings.nodeLabelFont;
    $('#nodeLabelSize').value = state.settings.nodeLabelSize;
    $('#nodeLabelPos').value = state.settings.nodeLabelPosition;
    // Edit-tab edge defaults
    $('#edgeWeight').value = state.settings.edgeWeight;
    $('#edgeLabel').value = state.settings.edgeLabel;
    $('#edgeType').value = state.settings.edgeType;
    $('#edgeColor').value = state.settings.edgeColor;
    $('#edgeStrokeSize').value = state.settings.edgeStrokeSize;
    $('#edgeStrokeStyle').value = state.settings.edgeStrokeStyle;
    $('#edgeLabelColor').value = state.settings.edgeLabelColor;
    $('#edgeLabelFont').value = state.settings.edgeLabelFont;
    $('#edgeLabelSize').value = state.settings.edgeLabelSize;
    const edEl = $('#edgeDirected') as any;
    if(edEl){
      if(edEl.tagName === 'SELECT') edEl.value = normalizeDirection((state.settings as any).direction ?? state.settings.directed);
      else edEl.checked = edgeDirection({direction: (state.settings as any).direction ?? state.settings.directed} as any) !== 'undirected';
    }
    $('#optAutosave').checked = state.settings.autosave;
    $('#optSnap').checked = state.settings.snap;
    $('#optSnapX').checked = state.settings.snapX;
    $('#optSnapY').checked = state.settings.snapY;
    $('#optGridX').value = state.settings.gridSizeX;
    $('#optGridY').value = state.settings.gridSizeY;
    $('#optBrushDiameter').value = state.settings.brushDiameter;
    $('#optMatrixLimit').value = state.settings.matrixLimit;
    $('#optEdgeListPageSize').value = state.settings.edgeListPageSize;
    const inhEl = $('#optInheritDefaults'); if(inhEl) inhEl.checked = state.settings.inheritDefaults !== false;
    const noLblEl = $('#optNoLabel'); if(noLblEl) noLblEl.checked = Boolean(state.settings.noLabel);
    const chkPreserve = document.getElementById('chkCopyPreserve') as HTMLInputElement | null; if(chkPreserve) chkPreserve.checked = state.settings.copyPreserveExternal !== false;
    if(syncUiHooks) syncUiHooks();
    syncStyleControls();
    syncEditTypeLists();
    renderCustomAttributes();
    setMode(state.mode, false);
    syncGizmoControls();
    setSelectTool(state.selectTool || 'single', false);
    setSelectCombine(state.selectCombine || 'replace', false);
    setHitTestMode(state.settings.hitTestMode || 'any', false);
  }
  function syncEditTypeLists(){
    const ntl = $('#nodeTypeListEdit'); if(ntl) ntl.innerHTML = existingNodeTypes().map(t => `<option value="${esc(t)}">`).join('');
    const etl = $('#edgeTypeListEdit'); if(etl) etl.innerHTML = existingEdgeTypes().map(t => `<option value="${esc(t)}">`).join('');
  }

  // A caller of queueRender is a caller that changed something a pass renders
  // from. Document mutations are already visible through graphRev (every
  // structural or in-place edit bumps it) and selection is compared per
  // element; what a revision cannot see is a setting edited directly in place,
  // which is exactly the style/default surface. Every repaint request therefore
  // advances the style revision.
  //
  // There is deliberately no "nothing changed" request: a caller that changed
  // no visual input should not ask for a pass at all (the camera and the grid
  // have their own writers — see `applyCamera`/`updateGridBackground`, which the
  // resize and zoom paths call directly).
  // A floating-origin change can happen in a preview-only pointermove. The
  // camera matrix is written in the current task, so the geometry MUST be
  // rebased in that same task: queueRender() would let Chromium paint one frame
  // with the new matrix and old-origin node/edge coordinates (the exact
  // one-frame regression this PR removes). When we are already inside
  // renderCanvas(), its own geometry passes perform the rebase synchronously.
  // Otherwise run a geometry-only pass right here.
  let renderCanvasActive = false;
  function syncRenderOriginRepaint(){
    // A render-scale change is a geometry change too: write the inverse scene
    // transform in the SAME task as the camera matrix, before any repaint.
    syncRenderScaleDom();
    if(!renderOriginMoved) return;
    renderOriginMoved = false;
    rebaseInteractionOverlays();
    invalidateStyleCache();
    documentDirty = true;
    if(renderCanvasActive) return;
    beginRenderPass();
    renderGen++;
    renderEdges();
    renderNodes();
    renderGizmo();
    paintedRev = graphRev;
    paintedStyleRev = styleRev;
    paintedNodeStyle = styleFingerprint('node');
    paintedEdgeStyle = styleFingerprint('edge');
    documentDirty = false;
    lastPaintedGen = renderGen;
    endRenderPass();
  }
  function queueRender(includeMatrix=false, includeSidebar=false){
    invalidateStyleCache(); documentDirty = true;
    if(includeMatrix){ clearTimeout(matrixTimer); matrixTimer = setTimeout(renderMatrixAndList, 60); }
    if(renderQueued) return;
    renderQueued = true;
    const wantSidebar = includeSidebar || sidebarDirty;
    requestAnimationFrame(() => { renderQueued = false; renderCanvas(); if(wantSidebar){ renderSidebar(); sidebarDirty = false; } });
  }
  let sidebarDirty = false;
  function markSidebarDirty(){ sidebarDirty = true; }
  // Sidebar-only render, coalesced to one per animation frame. Gesture starts
  // and releases call this instead of rendering the panel synchronously: the
  // pointer is on the canvas, so the panel may catch up one frame later, while
  // the gesture keeps the frame it was given. The panel is rebuilt from live
  // state at run time, so deferring cannot show a stale selection.
  let sidebarFrame = false;
  function scheduleSidebarRender(){
    sidebarDirty = true;
    if(sidebarFrame) return;
    sidebarFrame = true;
    requestAnimationFrame(() => {
      sidebarFrame = false;
      if(!sidebarDirty) return;
      sidebarDirty = false;
      renderSidebar();
    });
  }
  // Bumped whenever anything a pass renders from has changed: document
  // mutations bump graphRev, but style settings, defaults, presets and the
  // label policy are written straight into `state.settings` without touching
  // the document. A style revision lets a pass know that a settings-driven
  // repaint is real work, even though no graph revision moved.
  let styleRev = 0;
  let paintedStyleRev = -1;
  function invalidateStyleCache(){ styleRev++; }
  // Whether the document may have changed since the last pass. A repaint
  // request is a declaration that *something* changed, and the document is the
  // common case (edits are written straight into node/edge objects, which no
  // revision counter can observe). A pass may only skip elements while this is
  // false, and it is cleared at the end of every full pass, so the flag means
  // "nothing has been edited since the layers were last painted" — exactly the
  // condition each element's own checks (geometry signature, label text,
  // selection) need in order to be trusted.
  let documentDirty = true;
  // Which *kind* of style work that revision implies. A node colour edit must
  // repaint nodes, but edges keep their own colours and widths: repainting them
  // too would write nothing and still cost a walk of every edge. These two
  // fingerprints narrow a settings change to the layer it actually reaches.
  //
  // They are computed from the containers the renderers read — the defaults,
  // the per-type style maps and the graph-level label/weight options — rather
  // than from `state.settings` as a whole, because everything else in settings
  // (grid, snapping, matrix limits, visible range) does not style an element.
  // Serialising those containers costs a few microseconds per pass and catches
  // every mutation of them, including ones added later.
  let paintedNodeStyle = '', paintedEdgeStyle = '';
  // The settings are mutated in place, so comparing container identity is not
  // enough: a colour picker writes `nodeDefaults.color` directly. Each
  // fingerprint therefore reads the fields the renderers read, in the order
  // they read them, and joins them into one comparable string. It is a few
  // microseconds per pass and it never misses a field that matters.
  const NODE_STYLE_DEFAULT_KEYS = ['shape','color','width','height','strokeColor','strokeSize','strokeStyle','labelColor','labelPosition','labelSize','labelFont'];
  const EDGE_STYLE_DEFAULT_KEYS = ['color','strokeSize','strokeStyle','labelColor','labelFont','labelSize'];
  function styleFingerprint(kind){
    const settings = state.settings || {};
    const gd = settings.graphDefaults || {};
    const defaults = (kind === 'node' ? settings.nodeDefaults : settings.edgeDefaults) || {};
    const types = (kind === 'node' ? settings.nodeTypeStyles : settings.edgeTypeStyles) || {};
    const keys = kind === 'node' ? NODE_STYLE_DEFAULT_KEYS : EDGE_STYLE_DEFAULT_KEYS;
    let out = gd.labelsPolicy || 'auto';
    out += '|' + (gd.labelOutline || 'outline') + '|' + (gd.labelOutlineColor || '#020617') + '|' + (gd.labelOutlineWidth ?? 4);
    out += '|' + (defaults.type || '');
    for(const key of keys) out += '|' + (defaults[key] ?? '');
    if(kind === 'edge') out += '|' + (gd.edgeWeightMode || 'number') + '|' + (gd.edgeWeightMin ?? 1) + '|' + (gd.edgeWeightMax ?? 10)
      + '|' + (gd.edgeWeightCorr || 'linear') + '|' + (gd.edgeWidthMin ?? 1) + '|' + (gd.edgeWidthMax ?? 8)
      + '|' + (gd.edgeWeightColorLow || '#22d3ee') + '|' + (gd.edgeWeightColorHigh || '#f59e0b');
    // Type styles are keyed by user-provided names: walk them in insertion
    // order and include every field a type can set.
    for(const name in types){
      const style = types[name] || {};
      out += '|' + name + ':' + NODE_STYLE_DEFAULT_KEYS.concat(EDGE_STYLE_DEFAULT_KEYS).map(key => style[key] ?? '').join(',');
    }
    return out;
  }
  function renderCanvas(){
    renderCanvasActive = true;
    try {
    beginRenderPass();
    // One decision per pass: is this selection too large to decorate item by
    // item? Both layer passes read it, so the look can never be half outline
    // and half colour within one frame.
    bulkAccents = accentBudgetExceeded(selectedNodeIds().size, selectedEdgeIds().size);
    applyCamera();
    const paths = state.nodes.length;
    $('#canvasWrap').classList.toggle('empty', paths === 0);
    setText($('#statsPill'), I18N.t('n_nodes_m_edges', {n: state.nodes.length, m: state.edges.length}));
    setText($('#statusPill'), statusText());
    // A new generation: from here on, every element the passes touch is stamped
    // with this number, and anything still carrying an older one is out of date.
    renderGen++;
    renderEdges();
    renderNodes();
    // Both layers now match this revision; a pass before the next mutation can
    // trust geometry, label visibility and selection as they are.
    paintedRev = graphRev;
    paintedStyleRev = styleRev;
    paintedNodeStyle = styleFingerprint('node');
    paintedEdgeStyle = styleFingerprint('edge');
    documentDirty = false;
    lastPaintedGen = renderGen;
    renderGizmo();
    updateUndoRedo();
    resetSelectionMirror();
    endRenderPass();
    } finally {
      renderCanvasActive = false;
    }
  }
  // Internal selection-tool ids are not user copy: the status pill used to show
  // "Режим выбора rect" / "Выделение polygon…" for every non-default tool.
  function selectionToolLabel(tool){
    const key = 'sel_' + (tool === 'directedAdjacent' ? 'directed_adj' : tool);
    const label = I18N.t(key);
    return label === key ? tool : label;
  }
  function statusText(){
    if(edgeDraft) return I18N.t('drag_to_target');
    if(pendingEdgeFrom) return I18N.t('source_selected', {name: labelOf(pendingEdgeFrom)});
    if(gizmoDrag && gizmoDrag.readout) return gizmoDrag.readout;
    if(selectDraft) return I18N.t('selection_tool', {tool: selectionToolLabel(selectDraft.tool)});
    if(pinch) return I18N.t('pinch_zoom_pan');
    if(spaceDown) return I18N.t('pan_mode');
    if(state.mode === 'move') return I18N.t('move_mode_drag');
    if(state.mode === 'node') return I18N.t('node_mode_click');
    if(state.mode === 'edge') return I18N.t('edge_mode_drag');
    return state.selectTool === 'single' ? I18N.t('select_mode') : I18N.t('select_tool_mode', {tool: selectionToolLabel(state.selectTool)});
  }
  function applyCamera(){
    // Adopt any pending wheel/button zoom preview into state.viewBox before
    // rendering so unrelated re-renders (e.g. changing default node color or
    // editing labels during the 220ms zoom debounce) never snap back to the
    // pre-zoom camera. Explicit camera-replacement callers (fitView,
    // resetCamera, setCameraFromInputs, undo/redo, import) cancel first.
    if(zoomPreview || pan || pinch){
      // Adopt the clamped ACTIVE camera (wheel zoom, pan or pinch) before
      // rendering so an unrelated re-render during a gesture cannot snap back
      // to the pre-gesture camera. A style change may also queue a render via
      // pushHistory; that path must see the preview too, not state.viewBox.
      state.viewBox = {...currentCamera()};
      if(zoomPreview){ cancelZoomPreview(); saveSoon(); }
    }
    // applyCameraTransform() owns the grid update; it uses the same camera as
    // the matrix, so a style handler that fires during a preview cannot see a
    // different (committed) camera here.
    applyCameraTransform(currentCamera());
    syncNodeHitTargets();
    syncCameraInputs();
    // Gizmo handles are sized in screen pixels, so a committed zoom change
    // re-sizes them in place (signature-guarded: a no-op when nothing changed).
    renderGizmo();
  }

  // === Camera ===
  // ONE paint system: the logical camera (`state.viewBox`, the value every hit
  // test, the grid, the sidebar readout and the saved document use) is written
  // as a single matrix on #cameraLayer, an SVG <g> INSIDE the canvas. The root
  // <svg> keeps a fixed world reference viewBox, written once. A gesture
  // preview and a commit are the SAME attribute write on the SAME element, so
  // there is no second surface, no CSS/SVG handoff and no frame that mixes two
  // cameras.
  //
  // The matrix must live inside the SVG, never on an HTML wrapper around it.
  // An outermost <svg> clips its children to the root viewBox: transforming a
  // wrapper <div> can only move that already-clipped viewport, so nodes and
  // edges outside the reference frame are never painted at all, and a
  // viewport-sized CSS grid inside the wrapper shows its hard edge during a pan
  // or zoom. That was the PR #33 regression (f18fb68). The grid is therefore
  // drawn as world-space SVG paths in this same scene: no pattern decal limit,
  // no separate layer, no crop, and it is always locked to the graph.
  const REFERENCE_VIEWBOX = {x:-500, y:-330, w:1000, h:660};
  let referenceViewBoxInstalled = false;
  function canvasViewportRect(cachedRect: any = null){
    if(cachedRect && cachedRect.width && cachedRect.height) return cachedRect;
    // The SVG is never transformed now, so its own box is the exact viewport
    // the root viewBox maps with preserveAspectRatio="xMidYMid meet". Using
    // #canvasWrap instead would include its (up to 1px) border and shift the
    // camera and hit tests by that much. The stationary backdrop is the
    // fallback for jsdom, which lays nothing out.
    const sr = svg.getBoundingClientRect();
    if(sr.width && sr.height) return sr;
    if(gridLayer){
      const gr = gridLayer.getBoundingClientRect();
      if(gr.width && gr.height) return gr;
    }
    if(canvasWrap) return canvasWrap.getBoundingClientRect();
    return sr;
  }
  function cameraMatrixText(matrix){
    // toFixed(12) destroyed small non-zero scales: a 1e15-unit Fit rounded to
    // 1e-12 and a 2e15-unit Fit wrote scale 0. Keep 15 SIGNIFICANT digits
    // (shortest round-trip precision) so tiny scales survive serialization.
    const clean = value => {
      const v = Number(value);
      if(!Number.isFinite(v) || v === 0) return 0;
      return Number(v.toPrecision(15));
    };
    // SVG transform attribute, in SVG user units (the root viewBox supplies
    // the user -> screen scale afterwards). Space separators are intentional.
    return `matrix(${clean(matrix.scale)} 0 0 ${clean(matrix.scale)} ${clean(matrix.tx)} ${clean(matrix.ty)})`;
  }
  function cameraDeltaMatrix(camera, base, viewport){
    // Compose the two preserveAspectRatio="xMidYMid meet" mappings (the fixed
    // reference frame and the logical camera). Exact for arbitrary viewport
    // / camera aspect ratios, fitView and the numeric camera controls.
    const basePixels = Math.min(viewport.width / base.w, viewport.height / base.h);
    const cameraPixels = Math.min(viewport.width / camera.w, viewport.height / camera.h);
    const scale = cameraPixels / basePixels;
    const baseOffsetX = (viewport.width - base.w * basePixels) / 2;
    const baseOffsetY = (viewport.height - base.h * basePixels) / 2;
    const cameraOffsetX = (viewport.width - camera.w * cameraPixels) / 2;
    const cameraOffsetY = (viewport.height - camera.h * cameraPixels) / 2;
    return {
      scale,
      tx:base.x + (cameraOffsetX - baseOffsetX) / basePixels - scale * camera.x,
      ty:base.y + (cameraOffsetY - baseOffsetY) / basePixels - scale * camera.y
    };
  }
  function ensureReferenceViewBox(){
    if(!referenceViewBoxInstalled){
      referenceViewBoxInstalled = true;
      setAttr(svg, 'viewBox', `${REFERENCE_VIEWBOX.x} ${REFERENCE_VIEWBOX.y} ${REFERENCE_VIEWBOX.w} ${REFERENCE_VIEWBOX.h}`);
      setAttr(svg, 'preserveAspectRatio', 'xMidYMid meet');
    }
  }
  function applyCameraTransform(camera=state.viewBox, rect=null){
    // The reference frame does not depend on the viewport, so install it even
    // when the canvas has no size yet (hidden tab, pre-layout render).
    ensureReferenceViewBox();
    const viewport = canvasViewportRect(rect);
    updateCameraViewportAspect(viewport);
    const projViewport = (viewport.width && viewport.height) ? viewport : { width: REFERENCE_VIEWBOX.w, height: REFERENCE_VIEWBOX.h };
    // Always derived from the fixed reference frame, never composed with the
    // previous frame's matrix, so no drift can accumulate across gestures.
    // Rebase onto the floating render origin: both the matrix translation and
    // every SVG coordinate stay far below Chromium's ~2^25 coordinate limit,
    // while state.viewBox remains the exact world camera.
    const cam = renderCamera(camera);
    syncRenderOriginRepaint();
    setAttr(cameraLayer, 'transform', cameraMatrixText(cameraDeltaMatrix(cam, REFERENCE_VIEWBOX, projViewport)));
    updateGridBackground(cam, projViewport);
    syncEdgeLabelVisibility();
    return (viewport.width && viewport.height) ? viewport : null;
  }
  function applyPreviewCamera(preview, rect=null){
    // One camera, one write. The preview IS the camera: committing only records
    // the value in state.viewBox, so no pixel can move at the handoff. Writing
    // a *delta* from the last committed camera here (as PR #33 did) replaced
    // the absolute matrix with a relative one, which flashed the graph in the
    // wrong place for the whole preview.
    applyCameraTransform(preview, rect);
  }
  function hexToRgba(hex, alpha){
    const h = String(hex || '#94a3b8').replace('#','');
    if(h.length !== 6) return `rgba(148,163,184,${alpha})`;
    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  function setStyleIfChanged(style, property, value){
    if(style[property] !== value) style[property] = value;
  }
  // === Render-space grid ===
  // Paths are written in world units rebased onto the floating render origin,
  // not absolute world coordinates: Chromium clamps SVG numbers above ~2^25,
  // so 1e20 in a path would disappear even though the camera matrix is finite.
  // Grid loops are bounded independently of the coordinate magnitude: a local
  // index, a 4,000-segment cap and an index-magnitude guard replace the old
  // absolute `k++` that could stop incrementing past 2^53.
  const GRID_INDEX_LIMIT = 1e12;
  const MAX_GRID_LINES = 4000;
  function clearGridPaths(){
    setAttr(gridMinorLines, 'd', '');
    setAttr(gridMajorLines, 'd', '');
  }
  // Last drawn render-space extent. The paths are rebuilt only when the grid's
  // decimation/colours change, the floating origin moves, or the view leaves
  // their apron: a pan or wheel preview normally writes NOTHING but the one
  // camera matrix, which keeps the per-update style+layout cost flat regardless
  // of graph size.
  let gridBounds = null; // {tileSig,x0,x1,y0,y1}
  function invalidateGridCache(){ gridBounds = null; }
  // Default to the ACTIVE camera (a pending zoom/pan preview), not the last
  // committed state.viewBox. Style handlers call this with no argument; using
  // the committed camera there recomputed the grid for the wrong view and
  // contracted it to a small central rectangle until the preview committed.
  // The floating origin is snapped to 1e6, which is not necessarily a multiple
  // of a decimated grid step. Keep grid lines locked to WORLD cell boundaries
  // by subtracting the origin's remainder modulo the major step: local line
  // k*stepX - remainder corresponds to world G + k*stepX, where G is a multiple
  // of majorX. BigInt makes the remainder exact even for a 1e20 world camera.
  function worldGridPhase(origin, majorStep){
    const m = BigInt(Math.max(1, Math.round(majorStep)));
    const v = BigInt(Math.trunc(finite(origin, 0)));
    return Number(((v % m) + m) % m);
  }
  function updateGridBackground(vb=renderCamera(), cachedRect=null){
    // No-argument calls come from style handlers; their default can move the
    // floating origin, so schedule the geometry repaint as well.
    syncRenderOriginRepaint();
    const rect = canvasViewportRect(cachedRect);
    if(!rect.width || !rect.height) return;
    updateCameraViewportAspect(rect);
    setStyleIfChanged(gridLayer.style, 'backgroundColor', state.settings.canvasBgColor || '#020617');
    const settings = state.settings;
    const gx = settings.gridSizeX || settings.gridSize || 40;
    const gy = settings.gridSizeY || settings.gridSize || 40;
    const cam = boundedCamera(vb);
    // Match SVG preserveAspectRatio="xMidYMid meet" exactly.
    const pitch = Math.min(rect.width / cam.w, rect.height / cam.h);
    if(!(pitch > 0) || !Number.isFinite(pitch)){ clearGridPaths(); gridBounds = null; return; }
    // Visible world rectangle (including letterboxing) is needed by the
    // decimation budget below.
    const offX = (rect.width - cam.w * pitch) / 2;
    const offY = (rect.height - cam.h * pitch) / 2;
    const visX0 = cam.x - offX / pitch, visX1 = cam.x + cam.w + offX / pitch;
    const visY0 = cam.y - offY / pitch, visY1 = cam.y + cam.h + offY / pitch;
    const spanX = Math.max(1, visX1 - visX0), spanY = Math.max(1, visY1 - visY0);
    // Zoom-adaptive decimation: when a cell would shrink below the readable
    // minimum on screen, draw every k-th cell. Integer multiples keep the lines
    // locked to world coordinates instead of drifting relative to the nodes.
    const GRID_MIN_PX = 8;
    // Do NOT floor the pitch at 1e-6: at a 1e13-unit Fit that limited the
    // decimation to 3.2e8 world units, so the 4,000-segment cap retained only
    // a ~178px-wide central strip. Also bound the step by the segment budget
    // (visible range + apron + bucket padding), so the cap never crops the
    // viewport even when the 8px readability rule alone is not enough.
    const GRID_BUCKET = 256;
    const segmentBudget = Math.max(1, MAX_GRID_LINES - 2 * GRID_BUCKET);
    const decimationFactor = (base, span) => {
      const product = base * pitch;
      const readable = product > 0 && Number.isFinite(GRID_MIN_PX / product)
        ? Math.ceil(GRID_MIN_PX / product) : 1;
      const budget = Math.ceil((7 * Math.max(1, span)) / (base * segmentBudget));
      return Math.max(1, readable, budget);
    };
    const stepX = gx * decimationFactor(gx, spanX);
    const stepY = gy * decimationFactor(gy, spanY);
    const majorX = stepX * Math.max(2, Math.ceil((gx * 5) / stepX));
    const majorY = stepY * Math.max(2, Math.ceil((gy * 5) / stepY));
    const minorColor = hexToRgba(settings.gridMinorColor, settings.gridMinorAlpha ?? 0.105);
    const majorColor = hexToRgba(settings.gridMajorColor, settings.gridMajorAlpha ?? 0.16);
    const phaseX = worldGridPhase(renderOriginX, majorX);
    const phaseY = worldGridPhase(renderOriginY, majorY);
    const tileSig = [stepX, stepY, majorX, majorY, phaseX, phaseY, minorColor, majorColor, renderScale].join('|');
    // Report the decimated steps in WORLD units, where the grid is defined.
    for(const el of [gridLayer, gridLines]){
      if(!el) continue;
      setAttr(el, 'data-minor-x', String(stepX));
      setAttr(el, 'data-minor-y', String(stepY));
      setAttr(el, 'data-major-x', String(majorX));
      setAttr(el, 'data-major-y', String(majorY));
    }
    // L is in WORLD units: renderScale maps it back below RENDER_COORD_LIMIT
    // when the SVG path is written.
    const L = renderCoordLimit();
    if(![visX0, visX1, visY0, visY1].every(Number.isFinite) ||
       visX0 < -L || visX1 > L || visY0 < -L || visY1 > L ||
       Math.max(Math.abs(visX0), Math.abs(visX1)) / stepX > GRID_INDEX_LIMIT ||
       Math.max(Math.abs(visY0), Math.abs(visY1)) / stepY > GRID_INDEX_LIMIT){
      clearGridPaths(); gridBounds = null; return;
    }
    // Keep the existing paths while the camera stays inside their apron.
    const marginX = spanX * 0.75, marginY = spanY * 0.75;
    if(gridBounds && gridBounds.tileSig === tileSig &&
       gridBounds.x0 <= visX0 - marginX && gridBounds.x1 >= visX1 + marginX &&
       gridBounds.y0 <= visY0 - marginY && gridBounds.y1 >= visY1 + marginY) return;
    // Draw the visible render-space range plus several viewports of apron,
    // quantised to a coarse cell bucket. Indices are LOCAL to a world-grid
    // origin G = renderOrigin - phase, so even a 1e20 camera never increments
    // an absolute index past 2^53. The phase keeps every line at an integer
    // multiple of the world cell size; bucket quantisation keeps the bounds
    // stable while a preview stays inside the apron.
    // Cap the apron so a full safe-square Fit cannot push path coordinates past
    // Skia's ~2^25 SVG limit. Bucket quantisation still keeps grid bounds stable
    // while a preview stays inside the apron.
    const apronX = Math.min(spanX * 3, L / 4), apronY = Math.min(spanY * 3, L / 4);
    const drawX0 = Math.max(-L, visX0 - apronX), drawX1 = Math.min(L, visX1 + apronX);
    const drawY0 = Math.max(-L, visY0 - apronY), drawY1 = Math.min(L, visY1 + apronY);
    const bucket = GRID_BUCKET;
    let firstX = Math.floor((drawX0 + phaseX) / stepX) - 1;
    let lastX = Math.ceil((drawX1 + phaseX) / stepX) + 1;
    let firstY = Math.floor((drawY0 + phaseY) / stepY) - 1;
    let lastY = Math.ceil((drawY1 + phaseY) / stepY) + 1;
    firstX = Math.floor(firstX / bucket) * bucket;
    lastX = Math.ceil(lastX / bucket) * bucket;
    firstY = Math.floor(firstY / bucket) * bucket;
    lastY = Math.ceil(lastY / bucket) * bucket;
    // Never write a line coordinate outside the safe render-space square.
    const minFirstX = Math.floor((-L + phaseX) / stepX), maxLastX = Math.ceil((L + phaseX) / stepX);
    const minFirstY = Math.floor((-L + phaseY) / stepY), maxLastY = Math.ceil((L + phaseY) / stepY);
    firstX = Math.max(firstX, minFirstX); lastX = Math.min(lastX, maxLastX);
    firstY = Math.max(firstY, minFirstY); lastY = Math.min(lastY, maxLastY);
    // Hard cap on segments, centred on the visible range.
    const cappedRange = (first, last, visFirst, visLast) => {
      if(last - first + 1 <= MAX_GRID_LINES) return [first, last];
      const center = Math.round((Math.ceil(visFirst) + Math.floor(visLast)) / 2);
      const f = center - Math.floor(MAX_GRID_LINES / 2);
      return [f, f + MAX_GRID_LINES - 1];
    };
    [firstX, lastX] = cappedRange(firstX, lastX, (visX0 + phaseX) / stepX, (visX1 + phaseX) / stepX);
    [firstY, lastY] = cappedRange(firstY, lastY, (visY0 + phaseY) / stepY, (visY1 + phaseY) / stepY);
    firstX = Math.max(firstX, minFirstX); lastX = Math.min(lastX, maxLastX);
    firstY = Math.max(firstY, minFirstY); lastY = Math.min(lastY, maxLastY);
    const rawX0 = rawRenderCoord(firstX * stepX - phaseX), rawX1 = rawRenderCoord(lastX * stepX - phaseX);
    const rawY0 = rawRenderCoord(firstY * stepY - phaseY), rawY1 = rawRenderCoord(lastY * stepY - phaseY);
    const drawnX0 = clampRenderCoord(rawX0), drawnX1 = clampRenderCoord(rawX1);
    const drawnY0 = clampRenderCoord(rawY0), drawnY1 = clampRenderCoord(rawY1);
    const majorEveryX = Math.max(1, Math.round(majorX / stepX));
    const majorEveryY = Math.max(1, Math.round(majorY / stepY));
    let minorD = '', majorD = '';
    const nX = Math.max(0, lastX - firstX + 1), nY = Math.max(0, lastY - firstY + 1);
    for(let i = 0; i < nX; i++){
      const k = firstX + i, x = clampRenderCoord(k * stepX - phaseX);
      if(k % majorEveryX === 0) majorD += `M ${x} ${drawnY0} V ${drawnY1} `;
      else minorD += `M ${x} ${drawnY0} V ${drawnY1} `;
    }
    for(let i = 0; i < nY; i++){
      const k = firstY + i, y = clampRenderCoord(k * stepY - phaseY);
      if(k % majorEveryY === 0) majorD += `M ${drawnX0} ${y} H ${drawnX1} `;
      else minorD += `M ${drawnX0} ${y} H ${drawnX1} `;
    }
    setAttr(gridMinorLines, 'd', minorD.trim());
    setAttr(gridMajorLines, 'd', majorD.trim());
    setAttr(gridMinorLines, 'stroke', minorColor);
    setAttr(gridMajorLines, 'stroke', majorColor);
    // Cache comparisons are in raw world units; only the path strings are
    // scaled into safe SVG coordinates.
    gridBounds = {tileSig, x0:rawX0, x1:rawX1, y0:rawY0, y1:rawY1};
  }
  function setStatusOnly(){ setText($('#statusPill'), statusText()); updateCommandStates(); }
  // Id→element registries for rendered graph elements. They are maintained by
  // the render passes so hot paths (drag geometry, selection sync) never pay a
  // document-wide id lookup. getElementById remains as a safety fallback.
  const nodeEls = new Map(), edgeEls = new Map();
  function nodeEl(id){ return nodeEls.get(id) || document.getElementById('node-' + id); }
  function edgeEl(id){ return edgeEls.get(id) || document.getElementById('edge-' + id); }
  function moveNodeFast(id){
    const n = drag?.node?.id === id ? drag.node : nodeById(id); if(!n) return;
    // A node outside the safe window has no DOM, but its edges may still cross
    // the viewport and must be clipped/updated.
    if(isRenderablePoint(n.x, n.y)){
      const el = nodeEl(id); if(el) setAttr(el, 'transform', `translate(${renderX(n.x)},${renderY(n.y)})`);
    }
    if(drag && drag.liveEdges === false) return;
    const edges = drag?.affectedEdges || state.edges.filter(e => e.from === id || e.to === id);
    for(const edge of edges) updateEdgeFast(edge);
  }
  function moveDragFast(src=drag){
    if(!src) return;
    try {
      const nodes = src.nodes || (src.node ? [src.node] : []);
      for(const n of nodes){
        if(!isRenderablePoint(n.x, n.y)) continue;
        const el = nodeEl(n.id); if(el) setAttr(el, 'transform', `translate(${renderX(n.x)},${renderY(n.y)})`);
      }
      followGizmoForPlainDrag(src);
      if(src.liveEdges === false) return;
      const vc = src.vc || (src.vc = newVisualCache());
      for(const edge of (src.affectedEdges || [])) updateEdgeFast(edge, vc);
    } catch(e) { /* fail-safe */ }
  }
  function updateEdgeFast(edgeOrId, vc=null){
    const e = typeof edgeOrId === 'object' ? edgeOrId : edgeById(edgeOrId); if(!e) return;
    // nodeById is an indexed O(1) lookup now; node positions are mutated in
    // place, so the index always returns the live objects during a drag.
    const a = nodeById(e.from), b = nodeById(e.to); if(!a || !b) return;
    const el = edgeEl(e.id); if(!el) return;
    const g: any = el;
    const d = edgePath(a,b,e, vc || passVisuals);
    // This is now the geometry the element shows, so it becomes the edge's
    // current geometry; the cached signature was taken before the nodes moved
    // and must not certify the older data (the selection accent reads it).
    g.__geoData = d; g.__geoSig = null;
    // This element was rewritten outside a pass; the next pass must not treat
    // it as already painted.
    if(g.__ent) g.__ent.gen = -1;
    const line = g.__line || el.querySelector('.edge-line'); if(line) setAttr(line, 'd', d.path);
    const hit = g.__hit || el.querySelector('.edge-hit'); if(hit) setAttr(hit, 'd', d.path);
    if(!d.path){
      // A fully clipped edge has no line to label: remove text/plates so no
      // ghost can reappear on a later camera-only update.
      paintEdgeText(g, d, null, '', '', false);
      if(g.__arrow){ g.__arrow.remove(); g.__arrow = null; }
      syncEdgeSelRing(g, e, null, d, false);
      return;
    }
    // The fast writer must CREATE text elements too: dragging an endpoint into
    // view can turn an empty/edge-hidden midpoint into a visible one.
    const labelVisible = edgeLabelVisible(a, b);
    const texts = edgeLabelWeightText(e);
    paintEdgeText(g, d, edgeVisualC(e, vc), texts.labelText, texts.weightText, labelVisible);
    // Update arrow tip position/angle during drag
    const arrow = g.__arrow || null;
    if(arrow && hasEdgeTip(e, d)) setAttr(arrow, 'points', edgeArrowPoints(d));
    else if(arrow){ arrow.remove(); g.__arrow = null; }
    // ...and the selection accent with it, or the highlight would be left
    // behind at the edge's old position for the rest of the gesture.
    moveEdgeSelRing(g, d);
  }
  // A gesture whose edge count exceeds the live budget (see
  // DRAG_LIVE_EDGE_LIMIT) skips its edges frame by frame, so they are left at
  // their start geometry. Repaint exactly those edges at release with the same
  // in-place writer the live path uses: the alternative — one render pass over
  // the whole scene — costs a full style/layout/paint of every node and edge,
  // which is a visible stall on the release that follows such a drag.
  function refreshFrozenEdges(edges){
    if(!edges || !edges.length) return;
    const vc = newVisualCache();
    for(const edge of edges) updateEdgeFast(edge, vc);
  }
  // The release itself stays free of that work: on a very high degree node it
  // is thousands of patched edges, which must not delay the frame that settles
  // the node under the pointer. The edges were already frozen for the whole
  // gesture, so they catch up on the next frame — in one pass, because the
  // scene repaints per frame anyway and splitting the work only repaints the
  // same area several times.
  let frozenRefresh: Set<any> | null = null, frozenRefreshFrame = false;
  function scheduleFrozenEdgeRefresh(edges){
    if(!edges || !edges.length) return;
    if(!frozenRefresh) frozenRefresh = new Set();
    for(const edge of edges) frozenRefresh.add(edge);
    if(frozenRefreshFrame) return;
    frozenRefreshFrame = true;
    requestAnimationFrame(() => {
      frozenRefreshFrame = false;
      const pending = frozenRefresh;
      frozenRefresh = null;
      if(pending) refreshFrozenEdges([...pending]);
    });
  }
  function scheduleFastNodeMove(id){
    if(!drag) return;
    drag.fastNodeId = id;
    if(drag.fastFrame) return;
    drag.fastFrame = true;
    requestAnimationFrame(() => {
      moveDragFast();
      if(drag) drag.fastFrame = false;
    });
  }
  // Retires whatever the last pass left in a layer that this pass did not
  // paint, and compacts the spine. `existing` is rebuilt from the live entries
  // only, so the registry the hot paths use never keeps a removed element.
  function sweepLayer(spine, existing, live, registry){
    const arr = spine.arr;
    let k = 0;
    for(let i = 0; i < arr.length; i++){
      const ent = arr[i];
      if(!ent.alive || !live.has(ent.id)){ ent.el.remove(); existing.delete(ent.id); registry.delete(ent.id); continue; }
      arr[k++] = ent;
    }
    arr.length = k;
    existing.clear();
    for(let i = 0; i < k; i++) existing.set(arr[i].id, arr[i]);
  }

  // === Render bookkeeping: generation, revision, element spines ===
  //
  // A render pass is asked to make the DOM match the document. Most of the
  // time it is asked after *something* changed, but it has no idea what: a
  // style edit touches settings, a selection change touches selection, a drag
  // has already written geometry in place, and a plain repaint changes nothing
  // at all. The three counters below are how a pass tells those apart before it
  // spends any work on an element.
  //
  //   renderGen — bumped by every pass; elements remember the generation in
  //               which they were last painted. A pass that finds an element
  //               stamped with the current generation knows nothing has
  //               written to it since (in-place drag writers advance the
  //               generation too), so its DOM already matches the document.
  //   graphRev  — from the core module: bumped by every structural or in-place
  //               document mutation. Geometry (endpoint positions, radii,
  //               parallel lanes) and label visibility are functions of the
  //               document alone, so they can only change with this counter.
  //   paintedRev — the revision the scene was last painted from. A pass over an
  //               unchanged revision can skip geometry and label work entirely.
  //
  // Element spines: one array per layer, in document order. Walking an array is
  // far cheaper than walking the SVG child list (no wrappers, no id parsing),
  // and appending is just a push. An entry is retired by clearing `alive`; the
  // stale sweep at the end of a pass removes its element and compacts the
  // array, so survivors keep their order and no per-pass Map of the layer is
  // needed.
  let renderGen = 0;
  // The generation the most recent pass painted in. An element stamped with it
  // is known to match the document *as of that pass*; nothing has touched it
  // since (in-place writers reset the stamp).
  let lastPaintedGen = -1;
  let paintedRev = -1;
  function newSpine(){ return { arr: [] as any[], dirty: false } as any; }
  const edgeSpine = newSpine(), nodeSpine = newSpine();
  function spineFor(layer){ return layer === edgesLayer ? edgeSpine : nodeSpine; }
  // `gen` is the pass generation the element was last fully written in; -1
  // means "never", which also covers elements created outside a pass.
  function spineEntry(id, el){
    const ent: any = { id, el, alive: true, gen: -1, geometry: false, sel: false };
    el.__ent = ent; // in-place writers reset the stamp through this link
    return ent;
  }
  function retireSpine(spine){
    const arr = spine.arr;
    for(let i = 0; i < arr.length; i++) arr[i].alive = false;
  }
  // Removes the retired elements and compacts the array. Entries that survive
  // are still in document order, because the pass appended their replacements
  // in order — an element that was retired and re-created is simply the newest
  // entry for that id.
  function sweepSpine(spine){
    const arr = spine.arr;
    let k = 0;
    for(let i = 0; i < arr.length; i++){
      const ent = arr[i];
      if(ent.alive){ arr[k++] = ent; continue; }
      ent.el.remove();
    }
    arr.length = k;
  }

  function renderEdges(){
    buildEdgeOffsetCache();
    const showLabels = shouldShowLabels();
    const selectedEdges = selectedEdgeIds();
    // The spine is this pass's working list: entries collected here are the
    // ones still in the scene, and whatever the pass appends is the new tail.
    const spine = edgeSpine;
    // This pass's view of the layer: the entries the previous pass left behind,
    // marked alive again as they are painted. Survivors keep their order and
    // their element; a retired entry is simply not re-marked.
    retireSpine(spine);
    const existing = new Map<string, any>();
    for(let i = 0; i < spine.arr.length; i++) existing.set(spine.arr[i].id, spine.arr[i]);
    const live = new Set();
    const seen = new Set();
    // Pre-compute visible node IDs once per render — edges touching non-visible nodes are skipped entirely
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    const rangeActive = vr.start >= 0 || vr.end >= 0;
    const visIds = rangeActive ? visibleNodeIds() : null;
    // A pass whose document revision matches the last painted one has nothing
    // geometric or label-related to recompute; `genAtStart` lets an element
    // whose stamp is already current skip its frame entirely.
    const stylePass = paintedEdgeStyle !== styleFingerprint('edge');
    const gen = renderGen;
    for(const e of state.edges){
      const a = nodeById(e.from), b = nodeById(e.to);
      if(!a || !b) continue; // dangling endpoints are dropped by the sweep
      // Skip edges touching non-visible nodes entirely — real performance gain, not just dimming
      if(rangeActive && (!visIds.has(e.from) || !visIds.has(e.to))) continue;
      seen.add(e.id);
      const selected = selectedEdges.has(e.id);
      const ent = existing.get(e.id);
      // `alive` was cleared on the whole spine at the top of this pass, so it
      // says nothing here: presence in `existing` is what marks an element as
      // the one this id had before the pass started.
      if(ent && !documentDirty && !stylePass && ent.gen === lastPaintedGen && ent.sel === selected){
        // Painted this generation, from this revision, with this selection:
        // the element's DOM is already exactly what this pass would write.
        ent.alive = true;
        live.add(e.id);
        continue;
      }
      // The merged style of an edge is a pure function of the edge and the
      // style settings, so it is cached on the element and recomputed only when
      // either could have changed: a style pass, or the edge's own style
      // fields. Rebuilding it every time an *unrelated* style edit repaints a
      // 2,500-edge layer was pure overhead — and the result would be identical.
      const edgeStyleKey = e.type + '\u0001' + e.color + '\u0001' + e.strokeSize + '\u0001' + e.strokeStyle
        + '\u0001' + e.labelColor + '\u0001' + e.labelSize + '\u0001' + e.labelFont
        + '\u0001' + e.weight + '\u0001' + edgeDirection(e);
      let v = (!stylePass && ent && ent.el.__styleKey === edgeStyleKey) ? ent.el.__style : null;
      if(!v){
        v = edgeRenderStyleC(e);
        if(ent){ ent.el.__styleKey = edgeStyleKey; ent.el.__style = v; }
      }
      let g: any = ent ? ent.el : null;
      if(!g){
        g = document.createElementNS(NS,'g'); g.classList.add('edge');
        g.id = 'edge-' + e.id; g.dataset.id = e.id; g.dataset.from = e.from; g.dataset.to = e.to;
        g.addEventListener('pointerdown', ev => {
          ev.stopPropagation();
          flushZoomPreview();
          if(ev.button === 1 || ev.button === 2){ registerPointer(ev); pendingEdgeFrom = null; startPan(ev); return; }
          if(ev.button !== 0) return;
          if(polygonToolActive()){ registerPointer(ev); handlePolygonPointerDown(ev); return; }
          if(state.mode === 'move'){ centerOnFurthestNodeOfEdge(e); return; }
          // In centre-hit mode, an edge is only selected when the click lands
          // at the edge's midpoint, not anywhere along it.
          if(state.settings.hitTestMode === 'center'){
            const pa = nodeById(e.from), pb = nodeById(e.to);
            if(pa && pb){
              const p = clientToWorld(ev.clientX, ev.clientY, currentCamera());
              const mx=(pa.x+pb.x)/2, my=(pa.y+pb.y)/2;
              const len = Math.hypot(pb.x-pa.x, pb.y-pa.y) || 1;
              if(Math.hypot(p.x-mx, p.y-my) > Math.max(10, len*0.18)){ deselect(); return; }
            }
          }
          const combine = effectiveSelectCombine(ev);
          setSelection([], [e.id], {type:'edge', id:e.id}, combine);
        });
        g.addEventListener('dblclick', ev => { ev.stopPropagation(); flushZoomPreview(); if(polygonToolActive() && selectDraft?.tool === 'polygon') finishPolygonSelection(false); else editEdgeQuick(e.id); });
        edgesLayer.appendChild(g);
        edgeEls.set(e.id, g);
        const fresh = spineEntry(e.id, g);
        spine.arr.push(fresh);
        existing.set(e.id, fresh);
        g.__styleKey = edgeStyleKey; g.__style = v;
      }
      setAttr(g, 'data-from', e.from);
      setAttr(g, 'data-to', e.to);
      // Geometry cache: the path depends only on endpoint positions, node
      // radii, the parallel-edge lane, and direction. When none of these
      // changed (style-only or unrelated renders), the previous edgePath
      // result is reused without recomputation.
      const ra = nodeRadiusC(a, passVisuals), rb = nodeRadiusC(b, passVisuals);
      const lane = edgeSiblingOffset(e);
      // Include the floating origin: absolute world endpoints unchanged by a
      // camera move still produce different SVG numbers after a rebase, so the
      // geometry cache must not hand back a path from the previous origin.
      const geoSig = `${a.x},${a.y}|${b.x},${b.y}|${ra},${rb}|${lane}|${edgeDirection(e)}|${renderOriginX},${renderOriginY}|${renderScale}`;
      let d = g.__geoSig === geoSig ? g.__geoData : null;
      if(!d){
        d = edgePath(a,b,e, passVisuals);
        g.__geoSig = geoSig;
        g.__geoData = d;
      }
      const edgeVisible = Boolean(d.path);
      toggleClass(g, 'selected', selected);
      // Update or create hit path (child refs are stashed on the group to
      // avoid per-edge selector queries)
      let hit = g.__hit;
      if(!hit){
        // A brand-new element gets its attributes once, through the cache.
        hit = document.createElementNS(NS,'path'); hit.setAttribute('class','edge-hit');
        g.append(hit); g.__hit = hit;
        setAttr(hit, 'd', d.path);
      }
      setAttr(hit, 'd', d.path);
      // Update or create line path
      let line = g.__line;
      if(!line){
        line = document.createElementNS(NS,'path'); line.setAttribute('class','edge-line');
        g.insertBefore(line, g.firstChild); g.__line = line;
        setAttr(line, 'd', d.path);
      }
      setAttr(line, 'd', d.path);
      // A bulk-selected edge is highlighted by its own stroke colour: the
      // render pass is the other writer of that colour (see syncEdgeAccent).
      const lineStroke = bulkAccents && selected ? SEL_EDGE_COLOR : v.color;
      if(v.strokeStyle === 'none'){
        setAttr(line, 'stroke', 'none');
        removeAttr(line, 'stroke-dasharray');
        removeAttr(line, 'stroke-linecap');
        removeAttr(line, 'stroke-linejoin');
      } else {
        setAttr(line, 'stroke', lineStroke); setAttr(line, 'stroke-width', renderSize(v.strokeSize));
        const dash = strokeDashArray(v.strokeStyle, v.strokeSize);
        if(dash !== 'none') setAttr(line, 'stroke-dasharray', dash);
        else removeAttr(line, 'stroke-dasharray');
        setAttr(line, 'stroke-linecap', strokeLineCap(v.strokeStyle));
        setAttr(line, 'stroke-linejoin', 'round');
      }
      // Selection accent: a wide line behind the path and a bigger copy of the
      // tip behind the arrowhead. Neither repaints the edge itself.
      syncEdgeAccent(g, e, v, d, selected && edgeVisible, bulkAccents);
      // Update or create arrows — QVGE has directed (end only), mutual (both), undirected (none)
      let arrow = g.__arrow || null;
      if(hasEdgeTip(e, d)){
        if(!arrow){ arrow = document.createElementNS(NS,'polygon'); arrow.setAttribute('class','edge-arrow'); g.appendChild(arrow); g.__arrow = arrow; }
        setAttr(arrow, 'points', edgeArrowPoints(d));
        setAttr(arrow, 'fill', v.color);
      } else if(arrow){
        arrow.remove(); g.__arrow = null; arrow = null;
      }
      let arrowStart = g.__arrowStart || null;
      if(hasEdgeStartTip(e, d)){
        if(!arrowStart){ arrowStart = document.createElementNS(NS,'polygon'); arrowStart.setAttribute('class','edge-arrow-start'); g.appendChild(arrowStart); g.__arrowStart = arrowStart; }
        setAttr(arrowStart, 'points', edgeArrowPoints({tipX: d.startTipX, tipY: d.startTipY, arrowAngle: d.startArrowAngle} as any));
        setAttr(arrowStart, 'fill', v.color);
      } else if(arrowStart){
        arrowStart.remove(); g.__arrowStart = null; arrowStart = null;
      }
      // Labels/weights are created whenever the edge has a visible path, then
      // hidden (not removed) when the ORIGINAL midpoint is off-screen. A camera
      // pan can therefore re-show them without a full render pass.
      const labelVisible = edgeVisible && edgeLabelVisible(a, b);
      const texts = edgeLabelWeightText(e, showLabels);
      paintEdgeText(g, d, v, texts.labelText, texts.weightText, labelVisible && showLabels);
      // This element now matches the document at this generation.
      const painted = existing.get(e.id);
      if(painted){ painted.alive = true; painted.gen = gen; painted.sel = selected; }
      live.add(e.id);
    }
    sweepLayer(spine, existing, live, edgeEls);
  }
  function edgeGroupKey(e){ return e.from <= e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`; }
  // Lane offsets depend only on edge ids/endpoints and their order in the
  // array. The cache is reused across renders until the array is replaced or
  // resized, or an in-place id/endpoint/reorder mutation bumps the revision.
  let edgeOffsetCacheSrc = null, edgeOffsetCacheLen = -1, edgeOffsetCacheRev = -1;
  function buildEdgeOffsetCache(){
    const edges = state.edges;
    if(edgeOffsetCache && edgeOffsetCacheSrc === edges && edgeOffsetCacheLen === edges.length && edgeOffsetCacheRev === graphRev) return;
    const groups = new Map();
    for(const e of edges){
      const key = edgeGroupKey(e);
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    edgeOffsetCache = new Map();
    const spacing = 30;
    for(const group of groups.values()){
      group.forEach((e, idx) => {
        // Store the lane in canonical pair coordinates. edgePath converts it to the
        // edge's own direction, so A→B and B→A separate to opposite sides.
        edgeOffsetCache.set(e.id, (idx - (group.length - 1) / 2) * spacing);
      });
    }
    edgeOffsetCacheSrc = edges; edgeOffsetCacheLen = edges.length; edgeOffsetCacheRev = graphRev;
  }
  function edgeCanonicalFrom(e){ return e.from <= e.to ? e.from : e.to; }
  function edgeSiblingOffset(e){
    if(!edgeOffsetCache || !edgeOffsetCache.has(e.id)) buildEdgeOffsetCache();
    const lane = edgeOffsetCache.get(e.id) || 0;
    return e.from === edgeCanonicalFrom(e) ? lane : -lane;
  }
  function nodeRadius(n){
    const v = nodeVisual(n);
    // Approximate "radius" for edge endpoint offset: average of half-width/height
    return Math.max(12, (v.width + v.height) / 4);
  }
  const ARROW_LEN = 18; // arrow length from base to tip
  const ARROW_HW = 8;   // arrow half-width
  // Liang–Barsky clip of the straight centre line to the safe render-space
  // square. A long edge may have both endpoints off-screen yet cross the
  // viewport; clipping its geometry keeps that visible segment instead of
  // discarding the edge. Coordinates are raw world units relative to the
  // floating origin; the clamp helper scales them into safe SVG numbers.
  function clipEdgeSegment(x0, y0, x1, y1){
    const L = renderCoordLimit();
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    const slab = (p, q) => {
      if(p === 0) return q >= 0;
      const r = q / p;
      if(p < 0){
        if(r > t1) return false;
        if(r > t0) t0 = r;
      } else {
        if(r < t0) return false;
        if(r < t1) t1 = r;
      }
      return true;
    };
    if(!slab(-dx, x0 + L) || !slab(dx, L - x0) ||
       !slab(-dy, y0 + L) || !slab(dy, L - y0) || t0 > t1) return null;
    return {
      x0: x0 + t0 * dx, y0: y0 + t0 * dy,
      x1: x0 + t1 * dx, y1: y0 + t1 * dy,
      startClipped: t0 > 0, endClipped: t1 < 1
    };
  }
  // Label visibility is decided from the ORIGINAL world midpoint, never from
  // the clipped segment. A partially visible edge whose true midpoint is
  // off-screen must not show a label or weight near the canvas centre. Viewport
  // bounds are cached per camera/scale so a large render pass computes them
  // once rather than per edge.
  let labelViewportCache = { sig: '', bounds: null as any };
  function edgeLabelViewport(){
    const cam = boundedCamera(currentCamera());
    const rect = canvasViewportRect();
    const sig = `${cam.x},${cam.y},${cam.w},${cam.h},${rect.width},${rect.height},${renderScale}`;
    if(sig !== labelViewportCache.sig){
      const pitch = (rect.width && rect.height) ? Math.min(rect.width / cam.w, rect.height / cam.h) : 0;
      const offX = (rect.width - cam.w * pitch) / 2, offY = (rect.height - cam.h * pitch) / 2;
      labelViewportCache = pitch > 0 ? { sig, bounds: {
        x0: cam.x - offX / pitch, x1: cam.x + cam.w + offX / pitch,
        y0: cam.y - offY / pitch, y1: cam.y + cam.h + offY / pitch
      }} : { sig, bounds: null };
    }
    return labelViewportCache.bounds;
  }
  function edgeLabelVisible(a, b){
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if(!isRenderablePoint(mx, my)) return false;
    const bounds = edgeLabelViewport();
    return Boolean(bounds) && mx >= bounds.x0 && mx <= bounds.x1 && my >= bounds.y0 && my <= bounds.y1;
  }
  function edgePath(a,b,e,vc=null){
    const ra = nodeRadiusC(a, vc), rb = nodeRadiusC(b, vc);
    const rc = clampRenderCoord;
    const rawAx = rawRenderX(a.x), rawAy = rawRenderY(a.y);
    const rawBx = rawRenderX(b.x), rawBy = rawRenderY(b.y);
    const hasEnd = edgeHasEndArrow(e), hasStart = edgeHasStartArrow(e);
    const arrowGapEnd = hasEnd ? ARROW_LEN : 2;
    const arrowGapStart = hasStart ? ARROW_LEN : 2;
    const empty = () => ({ path:'', labelX:0, labelY:0, tx:0, ty:0, tipX:null, tipY:null, arrowAngle:null, startTipX:null, startTipY:null, startArrowAngle:null });
    // A self-loop lives entirely around one node: if that node is outside the
    // safe render window the loop cannot have a visible segment.
    if(a.id === b.id){
      if(!isRenderablePoint(a.x, a.y)) return empty();
      const lane = edgeSiblingOffset(e);
      const step = lane / 30;
      const angle = -Math.PI / 2 + step * 0.62;
      const spread = 0.72;
      const loop = 78 + Math.abs(step) * 10;
      // All geometry stays in raw world units until the final rc() writes.
      const sxRaw = rawAx + Math.cos(angle - spread) * (ra + arrowGapStart);
      const syRaw = rawAy + Math.sin(angle - spread) * (ra + arrowGapStart);
      const txRaw = rawAx + Math.cos(angle + spread) * (ra + arrowGapEnd);
      const tyRaw = rawAy + Math.sin(angle + spread) * (ra + arrowGapEnd);
      const c1xRaw = rawAx + Math.cos(angle - spread * 0.45) * (ra + loop);
      const c1yRaw = rawAy + Math.sin(angle - spread * 0.45) * (ra + loop);
      const c2xRaw = rawAx + Math.cos(angle + spread * 0.45) * (ra + loop);
      const c2yRaw = rawAy + Math.sin(angle + spread * 0.45) * (ra + loop);
      const labelRawX = rawAx + Math.cos(angle) * (ra + loop * 0.78);
      const labelRawY = rawAy + Math.sin(angle) * (ra + loop * 0.78);
      const sx = rc(sxRaw), sy = rc(syRaw), tx = rc(txRaw), ty = rc(tyRaw);
      const c1x = rc(c1xRaw), c1y = rc(c1yRaw), c2x = rc(c2xRaw), c2y = rc(c2yRaw);
      const labelX = rc(labelRawX), labelY = rc(labelRawY);
      const arrowAngle = Math.atan2(ty - c2y, tx - c2x);
      const ac = Math.cos(arrowAngle), as = Math.sin(arrowAngle);
      const tipX = hasEnd ? rc(txRaw + ac * arrowGapEnd) : null;
      const tipY = hasEnd ? rc(tyRaw + as * arrowGapEnd) : null;
      // For mutual self-loop, also compute start arrow opposite direction
      let startTipX=null, startTipY=null, startArrowAngle=null;
      if(hasStart){
        const startAngle = Math.atan2(sy - c1y, sx - c1x);
        const sac = Math.cos(startAngle), sas = Math.sin(startAngle);
        startTipX = rc(sxRaw + sac * arrowGapStart);
        startTipY = rc(syRaw + sas * arrowGapStart);
        startArrowAngle = startAngle;
      }
      return { path:`M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`, labelX, labelY, tx, ty, tipX, tipY, arrowAngle, startTipX, startTipY, startArrowAngle };
    }
    const clip = clipEdgeSegment(rawAx, rawAy, rawBx, rawBy);
    if(!clip) return empty();
    const dx = rawBx - rawAx, dy = rawBy - rawAy;
    const len = Math.hypot(dx,dy) || 1, ux = dx/len, uy = dy/len;
    const offset = edgeSiblingOffset(e);
    // ORIGINAL midpoint (raw world units), independent of the clipped segment.
    const midRawX = (rawAx + rawBx) / 2, midRawY = (rawAy + rawBy) / 2;
    // A clipped endpoint is an intersection with the safe window, not a node
    // boundary: do not reserve a radius or arrow gap there.
    const sxRaw = clip.startClipped ? clip.x0 : clip.x0 + ux * (ra + arrowGapStart);
    const syRaw = clip.startClipped ? clip.y0 : clip.y0 + uy * (ra + arrowGapStart);
    const txRaw = clip.endClipped ? clip.x1 : clip.x1 - ux * (rb + arrowGapEnd);
    const tyRaw = clip.endClipped ? clip.y1 : clip.y1 - uy * (rb + arrowGapEnd);
    const sx = rc(sxRaw), sy = rc(syRaw), tx = rc(txRaw), ty = rc(tyRaw);
    if(Math.abs(offset) > 1){
      const mxRaw = midRawX - uy * offset, myRaw = midRawY + ux * offset;
      const mx = rc(mxRaw), my = rc(myRaw);
      const arrowAngle = Math.atan2(tyRaw - myRaw, txRaw - mxRaw);
      const ac = Math.cos(arrowAngle), as = Math.sin(arrowAngle);
      const startArrowAngle = Math.atan2(syRaw - myRaw, sxRaw - mxRaw);
      const sac = Math.cos(startArrowAngle), sas = Math.sin(startArrowAngle);
      const tipX = clip.endClipped || !hasEnd ? null : rc(txRaw + ac * arrowGapEnd);
      const tipY = clip.endClipped || !hasEnd ? null : rc(tyRaw + as * arrowGapEnd);
      const startTipX = clip.startClipped || !hasStart ? null : rc(sxRaw + sac * arrowGapStart);
      const startTipY = clip.startClipped || !hasStart ? null : rc(syRaw + sas * arrowGapStart);
      return { path:`M ${sx} ${sy} Q ${mx} ${my} ${tx} ${ty}`, labelX:mx, labelY:my, tx, ty, tipX, tipY, arrowAngle, startTipX, startTipY, startArrowAngle };
    }
    const arrowAngle = Math.atan2(uy, ux);
    const startArrowAngle = Math.atan2(-uy, -ux);
    const tipX = clip.endClipped || !hasEnd ? null : rc(clip.x1 - ux * rb);
    const tipY = clip.endClipped || !hasEnd ? null : rc(clip.y1 - uy * rb);
    const startTipX = clip.startClipped || !hasStart ? null : rc(clip.x0 + ux * ra);
    const startTipY = clip.startClipped || !hasStart ? null : rc(clip.y0 + uy * ra);
    return { path:`M ${sx} ${sy} L ${tx} ${ty}`, labelX:rc(midRawX), labelY:rc(midRawY), tx, ty, tipX, tipY, arrowAngle, startTipX, startTipY, startArrowAngle };
  }
  // A 50-unit node becomes sub-pixel when Fit spans millions of units, so
  // Chromium cannot hit-test the visible shape. Keep a transparent circular
  // target at least ~7 screen pixels across, expressed in world units and
  // refreshed whenever the camera scale changes.
  let lastNodeHitPixelsPerWorld: any = '';
  function nodeHitPixelsPerWorld(){
    const rect = canvasViewportRect();
    updateCameraViewportAspect(rect);
    const cam = boundedCamera(currentCamera());
    const p = (rect.width && rect.height) ? Math.min(rect.width / cam.w, rect.height / cam.h) : 0;
    return p > 0 ? p : 0.001;
  }
  // Normal nodes are hit-tested by their visible shape, not by a large circle:
  // a 300x10 rectangle must not select from 80px outside its 10-unit body.
  // Only when the whole shape is sub-pixel do we paint a visible ~7px dot and
  // enlarge the hit target to exactly that dot.
  function nodeHitGeometry(v){
    const p = nodeHitPixelsPerWorld();
    const halfMin = Math.min(v.width, v.height) / 2;
    const shapeRadiusPx = Math.max(v.width, v.height) / 2 * p;
    const enlarged = shapeRadiusPx < 3;
    // The cap is on the SCALED SVG number, so in world units it is the
    // scaled render window / renderScale. A 1e12-unit Fit needs ~5e9 world
    // units for a 7px dot; the old fixed 1.5e7 cap made it 0.042px wide.
    const dotRadius = Math.min(renderCoordLimit() / 2, 7 / p);
    return {
      enlarged,
      radius: enlarged ? dotRadius : Math.max(1, halfMin),
      centreRadius: Math.max(8, Math.min(v.width, v.height) * 0.25, enlarged ? dotRadius : 0)
    };
  }
  function nodeHitRadius(v){ return nodeHitGeometry(v).radius; }
  function nodeCentreHitRadius(n){ return nodeHitGeometry(nodeVisualC(n)).centreRadius; }
  function nodeSelectionRadius(n){
    const geo = nodeHitGeometry(nodeVisualC(n));
    return Math.max(nodeRadius(n), geo.enlarged ? geo.radius : 0);
  }
  function syncNodeHitTarget(g, v){
    let hit = g.__hit;
    if(!hit){
      hit = document.createElementNS(NS,'circle');
      hit.setAttribute('class','node-hit');
      hit.setAttribute('cx','0'); hit.setAttribute('cy','0');
      hit.setAttribute('stroke','none');
      g.__hit = hit;
    }
    const geo = nodeHitGeometry(v);
    // At extreme zoom-outs the actual shape is sub-pixel: paint a minimum-size
    // dot with the node colour. At ordinary zoom the target is a small, inert
    // circle inside the visible shape; the shape itself handles pointer events.
    setAttr(hit, 'fill', geo.enlarged ? v.color : 'transparent');
    setAttr(hit, 'fill-opacity', geo.enlarged ? '0.9' : '0');
    setStyleIfChanged(hit.style, 'pointerEvents', geo.enlarged ? 'all' : 'none');
    setAttr(hit, 'r', renderSize(geo.radius));
    // Appending an already-last child is a remove+add mutation: during a zoom
    // burst that would reconstruct node DOM for no reason. Only move it when
    // a newly added label/plate has been inserted above it.
    if(hit !== g.lastChild) g.appendChild(hit);
  }
  function syncNodeHitTargets(){
    const p = nodeHitPixelsPerWorld();
    const sig = `${p}|${renderScale}`;
    if(sig === lastNodeHitPixelsPerWorld) return;
    lastNodeHitPixelsPerWorld = sig;
    for(const [id, g] of nodeEls){
      const n = nodeById(id);
      if(n) syncNodeHitTarget(g, nodeVisual(n));
    }
  }
  function renderNodes(){
    const showLabels = shouldShowLabels();
    const selectedNodes = selectedNodeIds();
    const spine = nodeSpine;
    retireSpine(spine);
    const existing = new Map<string, any>();
    for(let i = 0; i < spine.arr.length; i++) existing.set(spine.arr[i].id, spine.arr[i]);
    const live = new Set();
    const seen = new Set();
    // Pre-compute visible node IDs once per render — avoids per-node Set lookup
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    const rangeActive = vr.start >= 0 || vr.end >= 0;
    const visIds = rangeActive ? visibleNodeIds() : null;
    const draggingId = drag?.nodeId;
    const stylePass = paintedNodeStyle !== styleFingerprint('node');
    const gen = renderGen;
    for(const n of state.nodes){
      // Nodes far outside the floating origin are off-screen AND would exceed
      // Skia's ~2^25 SVG coordinate limit. Keep them in state, skip their DOM.
      if(!isRenderablePoint(n.x, n.y)) continue;
      // Skip non-visible nodes entirely — they are removed from DOM, not dimmed.
      // This gives real performance: fewer SVG elements, fewer attribute patches, less paint.
      if(rangeActive && !visIds.has(n.id)) continue;
      seen.add(n.id);
      const selected = selectedNodes.has(n.id);
      const ent = existing.get(n.id);
      const dragging = draggingId === n.id;
      if(ent && !documentDirty && !stylePass && ent.gen === lastPaintedGen && ent.sel === selected && !dragging){
        // Same reasoning as the edge pass: the element was painted in the
        // previous generation from this revision, with this selection, and no
        // in-place writer has touched it since.
        ent.alive = true;
        live.add(n.id);
        continue;
      }
      const v = nodeVisualC(n);
      let g: any = ent ? ent.el : null;
      if(!g){
        // Create new node group
        g = document.createElementNS(NS,'g'); g.classList.add('node');
        g.id = 'node-' + n.id; g.dataset.id = n.id;
        g.addEventListener('pointerdown', ev => onNodePointerDown(ev, n.id));
        g.addEventListener('dblclick', ev => { ev.stopPropagation(); flushZoomPreview(); if(polygonToolActive() && selectDraft?.tool === 'polygon') finishPolygonSelection(false); else editNodeQuick(n.id); });
        nodesLayer.appendChild(g);
        nodeEls.set(n.id, g);
        const fresh = spineEntry(n.id, g);
        spine.arr.push(fresh);
        existing.set(n.id, fresh);
      }
      // Update transform (always — this is the hot path during drag)
      setAttr(g, 'transform',`translate(${renderX(n.x)},${renderY(n.y)})`);
      // Update selection class
      toggleClass(g, 'selected', selected);
      toggleClass(g, 'dragging', draggingId === n.id);
      const w = v.width, h = v.height;
      // Selection ring: keep a scaled copy of the shape behind the node. It
      // only exists while selected, so unselected nodes stay at one element.
      const sel = syncNodeSelRing(g, n, v.shape, w, h, selected);
      // Update or create shape (element ref stashed on the group)
      let shape = g.__shape;
      const shapeSig = v.shape + '|' + w + '|' + h + '|' + renderScale;
      const needRebuild = !shape || g.__shapeSig !== shapeSig;
      if(needRebuild){
        if(shape) shape.remove();
        const rw = renderSize(w), rh = renderSize(h), two = renderSize(2);
        if(v.shape === 'square'){
          shape = document.createElementNS(NS,'rect'); shape.setAttribute('x',-rw/2); shape.setAttribute('y',-rh/2); shape.setAttribute('width',rw); shape.setAttribute('height',rh);
        } else if(v.shape === 'diamond'){
          shape = document.createElementNS(NS,'polygon'); shape.setAttribute('points',`0,${-rh/2-two} ${rw/2+two},0 0,${rh/2+two} ${-rw/2-two},0`);
        } else if(v.shape === 'triangleUp'){
          shape = document.createElementNS(NS,'polygon'); shape.setAttribute('points',`0,${-rh/2} ${rw/2},${rh/2} ${-rw/2},${rh/2}`);
        } else if(v.shape === 'triangleDown'){
          shape = document.createElementNS(NS,'polygon'); shape.setAttribute('points',`0,${rh/2} ${rw/2},${-rh/2} ${-rw/2},${-rh/2}`);
        } else if(v.shape === 'hexagon'){
          const hx = rw/2, hy = rh/2, mx = rw/4;
          shape = document.createElementNS(NS,'polygon'); shape.setAttribute('points',`${-hx+mx},${-hy} ${hx-mx},${-hy} ${hx},0 ${hx-mx},${hy} ${-hx+mx},${hy} ${-hx},0`);
        } else {
          shape = document.createElementNS(NS,'ellipse'); shape.setAttribute('rx',rw/2); shape.setAttribute('ry',rh/2);
        }
        shape.setAttribute('class','node-shape');
        g.__shapeSig = shapeSig;
        // Keep the selection ring behind the shape
        if(sel) g.insertBefore(shape, sel.nextSibling);
        else g.insertBefore(shape, g.firstChild);
        g.__shape = shape;
      }
      // Update shape style attributes — de-duplicated, so untouched nodes
      // write nothing. QVGE/Qt uses SquareCap+Bevel for nodes, FlatCap+RoundJoin for edges;
      // we keep SVG close by using square caps for dashed styles.
      setAttr(shape, 'fill', v.color);
      if(v.strokeStyle === 'none'){
        setAttr(shape, 'stroke', 'none');
        removeAttr(shape, 'stroke-dasharray');
        removeAttr(shape, 'stroke-linecap');
        removeAttr(shape, 'stroke-linejoin');
      } else {
        setAttr(shape, 'stroke', v.strokeColor); setAttr(shape, 'stroke-width', renderSize(v.strokeSize));
        const dash = strokeDashArray(v.strokeStyle, v.strokeSize);
        if(dash !== 'none') setAttr(shape, 'stroke-dasharray', dash);
        else removeAttr(shape, 'stroke-dasharray');
        setAttr(shape, 'stroke-linecap', strokeLineCap(v.strokeStyle));
        setAttr(shape, 'stroke-linejoin', 'round');
      }
      // Update label
      let label = g.__text || null;
      const wantLabel = showLabels && n.label;
      if(wantLabel){
        if(!label){
          label = document.createElementNS(NS,'text');
          g.appendChild(label); g.__text = label;
        }
        // Text content first: the background plate measurement depends on it
        if(label.textContent !== n.label) label.textContent = n.label;
        let anchor = 'middle', baseline = 'middle';
        let lx = 0, ly = 0;
        const offset = Math.max(w, h)/2 + v.labelSize * 0.7;
        if(v.labelPosition === 'top'){ ly = -offset; baseline = 'auto'; }
        else if(v.labelPosition === 'bottom'){ ly = offset; baseline = 'hanging'; }
        else if(v.labelPosition === 'left'){ lx = -offset; anchor = 'end'; }
        else if(v.labelPosition === 'right'){ lx = offset; anchor = 'start'; }
        setAttr(label, 'text-anchor', anchor);
        setAttr(label, 'dominant-baseline', baseline);
        setAttr(label, 'fill', v.labelColor);
        setAttr(label, 'font-size', renderSize(v.labelSize));
        setAttr(label, 'font-family', v.labelFont);
        setAttr(label, 'x', renderSize(lx)); setAttr(label, 'y', renderSize(ly));
        applyLabelOutline(g, label, '__label', renderSize(lx), renderSize(ly), n.label, v.labelSize, v.labelFont, anchor, baseline);
      } else if(label){
        label.remove(); g.__text = null; label = null;
        removeLabelPlate(g, '__label');
      }
      syncNodeHitTarget(g, v);
      const painted = existing.get(n.id);
      if(painted){ painted.alive = true; painted.gen = gen; painted.sel = selected; }
      live.add(n.id);
    }
    sweepLayer(spine, existing, live, nodeEls);
  }

  function renderSidebar(){
    renderStartSelect();
    renderSelectionPanel();
  }
  let startSelectSig = '';
  function renderStartSelect(){
    const sel = $('#algoStart');
    const nodes = state.nodes;
    // FNV-1a signature over id+label: O(total chars), no DOM. The option list
    // is only patched when this signature changes.
    let h = 2166136261 ^ nodes.length;
    for(let i = 0; i < nodes.length; i++){
      const s = nodes[i].id + '>' + nodes[i].label;
      for(let j = 0; j < s.length; j++){ h ^= s.charCodeAt(j); h = Math.imul(h, 16777619); }
    }
    const sig = I18N.current + ':' + h;
    if(sig !== startSelectSig){
      startSelectSig = sig;
      const options = sel.options;
      const desired = nodes.length ? nodes.length : 1;
      while(options.length > desired) sel.remove(options.length - 1);
      if(nodes.length){
        for(let i = 0; i < nodes.length; i++){
          let opt = options[i];
          if(!opt){ opt = document.createElement('option'); sel.add(opt); }
          const value = nodes[i].id;
          const text = `${nodes[i].label || nodes[i].id} (${nodes[i].id})`;
          if(opt.value !== value) opt.value = value;
          if(opt.textContent !== text) opt.textContent = text;
        }
      } else {
        let opt = options[0];
        if(!opt){ opt = document.createElement('option'); sel.add(opt); }
        if(opt.value !== '') opt.value = '';
        const placeholder = I18N.t('no_nodes');
        if(opt.textContent !== placeholder) opt.textContent = placeholder;
      }
    }
    const current = sel.value || state.selected?.id;
    const selectedNode = state.selected?.type === 'node' ? state.selected.id : current;
    if(selectedNode && state.nodes.some(n => n.id === selectedNode)) sel.value = selectedNode;
  }
  function renderSelectionPanel(){
    const host = $('#selectionPanel');
    const nodeCount = state.selection?.nodes?.length || 0;
    const edgeCount = state.selection?.edges?.length || 0;
    if(!state.selected){ host.innerHTML = '<span class="muted">' + esc(I18N.t('nothing_selected')) + '</span>'; return; }
    if(nodeCount + edgeCount > 1){
      const parts = [];
      parts.push(`<div class="tiny muted" style="margin-bottom:8px">${I18N.t('selected_n_m', {n: nodeCount, m: edgeCount})}</div>`);
      parts.push(`<div class="grid2" style="margin-bottom:8px">
        <button id="selAdjacent" class="btn">${I18N.t('sel_adjacent')}</button>
        <button id="selDirectedAdjacent" class="btn">${I18N.t('directed_adj_short')}</button>
        <button id="selClear" class="btn">${I18N.t('clear_sel')}</button>
        <button id="selDelete" class="btn danger">${I18N.t('delete_btn')}</button>
      </div>`);
      let html = parts.join('');
      // Node editing section (if any nodes selected)
      if(nodeCount > 0){
        const shapeOptions = '<option value="">' + I18N.t('stroke_inherit') + '</option>' + NODE_SHAPES.map(s => `<option value="${s}">${I18N.t('shape_' + s)}</option>`).join('');
        const strokeOptions = '<option value="">' + I18N.t('stroke_inherit') + '</option>' + STROKE_STYLES.map(s => `<option value="${s}">${I18N.t('stroke_' + s)}</option>`).join('');
        const labelPosOptions = ['<option value="">' + I18N.t('stroke_inherit') + '</option>','<option value="center">' + I18N.t('pos_center') + '</option>','<option value="top">' + I18N.t('pos_top') + '</option>','<option value="bottom">' + I18N.t('pos_bottom') + '</option>','<option value="left">' + I18N.t('pos_left') + '</option>','<option value="right">' + I18N.t('pos_right') + '</option>'].join('');
        html += `<div class="section-title">${I18N.t('nodes_n', {n: nodeCount})} <span class="tiny muted">${I18N.t('applies_to_all')}</span></div>
          <div class="grid2">
            <label class="field" for="mulNodeLabel"><span data-i18n="label">${I18N.t('label')}</span> <input id="mulNodeLabel" placeholder="${I18N.t('keep')}" data-i18n-placeholder="keep"></label>
            <label class="field" for="mulNodeType">${I18N.t('type')} <input id="mulNodeType" list="nodeTypeList" placeholder="${I18N.t('keep')}" data-i18n-placeholder="keep"><datalist id="nodeTypeList">${existingNodeTypes().map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
            <label class="field" for="mulNodeOrder">${I18N.t('order')} <input id="mulNodeOrder" type="number" min="0" step="1" placeholder="${I18N.t('keep')}" data-i18n-placeholder="keep" inputmode="numeric"></label>
            <label class="field" for="mulNodeColor">${I18N.t('color')} <input id="mulNodeColor" type="color" value="#0ea5e9"></label>
            <label class="field" for="mulNodeShape">${I18N.t('shape')} <select id="mulNodeShape">${shapeOptions}</select></label>
            <label class="field" for="mulNodeWidth"><span data-i18n="width">${I18N.t('width')}</span> <input id="mulNodeWidth" type="number" min="10" max="300" step="1" placeholder="${I18N.t('keep')}" data-i18n-placeholder="keep" inputmode="decimal"></label>
            <label class="field" for="mulNodeHeight"><span data-i18n="height">${I18N.t('height')}</span> <input id="mulNodeHeight" type="number" min="10" max="300" step="1" placeholder="${I18N.t('keep')}" data-i18n-placeholder="keep" inputmode="decimal"></label>
            <label class="field" for="mulNodeStrokeColor">${I18N.t('stroke_color')} <input id="mulNodeStrokeColor" type="color" value="#e2e8f0"></label>
            <label class="field" for="mulNodeStrokeSize">${I18N.t('stroke_size')} <input id="mulNodeStrokeSize" type="number" min="0" max="20" step="0.1" value="2.2" inputmode="decimal"></label>
            <label class="field" for="mulNodeStrokeStyle">${I18N.t('stroke_style')} <select id="mulNodeStrokeStyle">${strokeOptions}</select></label>
            <label class="field" for="mulNodeLabelColor">${I18N.t('label_color')} <input id="mulNodeLabelColor" type="color" value="#f8fafc"></label>
            <label class="field" for="mulNodeLabelSize">${I18N.t('label_size')} <input id="mulNodeLabelSize" type="number" min="4" max="72" value="13" inputmode="decimal"></label>
            <label class="field" for="mulNodeLabelPos">${I18N.t('label_pos')} <select id="mulNodeLabelPos">${labelPosOptions}</select></label>
            <label class="field" for="mulNodeLabelFont"><span data-i18n="label_font">${I18N.t('label_font')}</span> <input id="mulNodeLabelFont" list="fontList" type="text" placeholder="${I18N.t('keep')}" data-i18n-placeholder="keep"></label>
          </div>
          <div class="row" style="margin-top:6px">
            <button id="mulResetNodeStyle" class="btn small warn" style="flex:1" title="${I18N.t('reset_style_title')}">${I18N.t('reset_style')}</button>
          </div>`;
      }
      // Edge editing section (if any edges selected)
      if(edgeCount > 0){
        const strokeOptions = '<option value="">' + I18N.t('stroke_inherit') + '</option>' + STROKE_STYLES.map(s => `<option value="${s}">${I18N.t('stroke_' + s)}</option>`).join('');
        html += `<div class="section-title">${I18N.t('edges_n', {n: edgeCount})} <span class="tiny muted">${I18N.t('applies_to_all')}</span></div>
          <div class="grid2">
            <label class="field" for="mulEdgeLabel"><span data-i18n="label">${I18N.t('label')}</span> <input id="mulEdgeLabel" placeholder="${I18N.t('keep')}" data-i18n-placeholder="keep"></label>
            <label class="field" for="mulEdgeWeight"><span data-i18n="weight">${I18N.t('weight')}</span> <input id="mulEdgeWeight" placeholder="${I18N.t('keep')}" data-i18n-placeholder="keep"></label>
            <label class="field" for="mulEdgeType">${I18N.t('type')} <input id="mulEdgeType" list="edgeTypeList" placeholder="${I18N.t('keep')}" data-i18n-placeholder="keep"><datalist id="edgeTypeList">${existingEdgeTypes().map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
            <label class="field" for="mulEdgeDirected">${I18N.t('directed')} <select id="mulEdgeDirected"><option value="">${I18N.t('keep')}</option><option value="directed">${I18N.t('directed_edge_short')}</option><option value="mutual">${I18N.t('mutual_edge_short') || 'Mutual'}</option><option value="undirected">${I18N.t('undirected_edge_short')}</option></select></label>
            <label class="field" for="mulEdgeColor">${I18N.t('color')} <input id="mulEdgeColor" type="color" value="#94a3b8"></label>
            <label class="field" for="mulEdgeStrokeSize">${I18N.t('stroke_size')} <input id="mulEdgeStrokeSize" type="number" min="0" max="20" step="0.1" value="2.4" inputmode="decimal"></label>
            <label class="field" for="mulEdgeStrokeStyle">${I18N.t('stroke_style')} <select id="mulEdgeStrokeStyle">${strokeOptions}</select></label>
            <label class="field" for="mulEdgeLabelColor">${I18N.t('label_color')} <input id="mulEdgeLabelColor" type="color" value="#dbeafe"></label>
            <label class="field" for="mulEdgeLabelSize">${I18N.t('label_size')} <input id="mulEdgeLabelSize" type="number" min="4" max="72" value="12" inputmode="decimal"></label>
            <label class="field" for="mulEdgeLabelFont"><span data-i18n="label_font">${I18N.t('label_font')}</span> <input id="mulEdgeLabelFont" list="fontList" type="text" placeholder="${I18N.t('keep')}" data-i18n-placeholder="keep"></label>
          </div>
          <div class="row" style="margin-top:6px">
            <button id="mulResetEdgeStyle" class="btn small warn" style="flex:1" title="${I18N.t('reset_edge_style_title')}">${I18N.t('reset_style')}</button>
          </div>`;
      }
      host.innerHTML = html;
      $('#selAdjacent').addEventListener('click', () => expandSelection(false));
      $('#selDirectedAdjacent').addEventListener('click', () => expandSelection(true));
      $('#selClear').addEventListener('click', deselect);
      $('#selDelete').addEventListener('click', deleteSelected);
      // Wire node multi-edit controls
      if(nodeCount > 0){
        const nodeIds = state.selection.nodes;
        $('#mulNodeLabel').addEventListener('change', e => { const v = e.target.value.slice(0,80); for(const id of nodeIds){ const n = nodeById(id); if(n) n.label = v; } pushHistory('multi node label'); queueRender(true); markSidebarDirty(); saveSoon(); });
        $('#mulNodeType').addEventListener('change', e => { const v = e.target.value.slice(0,40); for(const id of nodeIds){ const n = nodeById(id); if(n){ n.type = v; applyTypeStyleToNode(n); } } invalidateGraphIndex(); pushHistory('multi node type'); queueRender(false); saveSoon(); renderSelectionPanel(); });
        $('#mulNodeOrder').addEventListener('change', e => { const v = e.target.value; if(v === '') return; const ord = clamp(parseInt(v,10)||0, 0, 2147483647); for(const id of nodeIds){ const n = nodeById(id); if(n) n.order = ord; } invalidateGraphIndex(); pushHistory('multi node order'); queueRender(true); saveSoon(); });
        $('#mulNodeColor').addEventListener('input', e => { for(const id of nodeIds){ const n = nodeById(id); if(n) n.color = e.target.value; } queueRender(false); saveSoon(); });
        $('#mulNodeColor').addEventListener('change', () => pushHistory('multi node color'));
        $('#mulNodeShape').addEventListener('change', e => { const v = e.target.value; for(const id of nodeIds){ const n = nodeById(id); if(n) n.shape = v; } pushHistory('multi node shape'); queueRender(false); });
        $('#mulNodeWidth').addEventListener('change', e => { const val = e.target.value; if(val === '') return; const v = clamp(finite(val,50),10,300); e.target.value=v; for(const id of nodeIds){ const n = nodeById(id); if(n) n.width = v; } pushHistory('multi node width'); queueRender(false); saveSoon(); });
        $('#mulNodeHeight').addEventListener('change', e => { const val = e.target.value; if(val === '') return; const v = clamp(finite(val,50),10,300); e.target.value=v; for(const id of nodeIds){ const n = nodeById(id); if(n) n.height = v; } pushHistory('multi node height'); queueRender(false); saveSoon(); });
        $('#mulNodeStrokeColor').addEventListener('input', e => { for(const id of nodeIds){ const n = nodeById(id); if(n) n.strokeColor = e.target.value; } queueRender(false); saveSoon(); });
        $('#mulNodeStrokeColor').addEventListener('change', () => pushHistory('multi stroke color'));
        $('#mulNodeStrokeSize').addEventListener('change', e => { const v = clamp(finite(e.target.value,2.2),0,20); e.target.value=v; for(const id of nodeIds){ const n = nodeById(id); if(n) n.strokeSize = v; } pushHistory('multi stroke size'); queueRender(false); });
        $('#mulNodeStrokeStyle').addEventListener('change', e => { const v = e.target.value; for(const id of nodeIds){ const n = nodeById(id); if(n) n.strokeStyle = v; } pushHistory('multi stroke style'); queueRender(false); });
        $('#mulNodeLabelColor').addEventListener('input', e => { for(const id of nodeIds){ const n = nodeById(id); if(n) n.labelColor = e.target.value; } queueRender(false); saveSoon(); });
        $('#mulNodeLabelColor').addEventListener('change', () => pushHistory('multi label color'));
        $('#mulNodeLabelSize').addEventListener('change', e => { const v = clamp(finite(e.target.value,13),4,72); e.target.value=v; for(const id of nodeIds){ const n = nodeById(id); if(n) n.labelSize = v; } pushHistory('multi label size'); queueRender(false); });
        $('#mulNodeLabelPos').addEventListener('change', e => { const v = e.target.value; for(const id of nodeIds){ const n = nodeById(id); if(n) n.labelPosition = v; } pushHistory('multi label pos'); queueRender(false); });
        $('#mulNodeLabelFont').addEventListener('change', e => { const v = e.target.value.trim().slice(0,60); for(const id of nodeIds){ const n = nodeById(id); if(n) n.labelFont = v || undefined; } pushHistory('multi node label font'); queueRender(false); saveSoon(); });
        attachDragNumber($('#mulNodeWidth'), { min: 10, max: 300, step: 1, sensitivity: 0.5 });
        attachDragNumber($('#mulNodeHeight'), { min: 10, max: 300, step: 1, sensitivity: 0.5 });
        attachDragNumber($('#mulNodeStrokeSize'), { min: 0, max: 20, step: 0.1, sensitivity: 0.3 });
        attachDragNumber($('#mulNodeLabelSize'), { min: 4, max: 72, step: 1, sensitivity: 0.5 });
        $('#mulResetNodeStyle').addEventListener('click', () => {
          for(const id of nodeIds){
            const n = nodeById(id); if(!n) continue;
            delete n.shape; delete n.color; delete n.width; delete n.height;
            delete n.strokeColor; delete n.strokeSize; delete n.strokeStyle;
            delete n.labelColor; delete n.labelSize; delete n.labelPosition; delete n.labelFont;
            n.shape = ''; n.color = '';
          }
          pushHistory('reset multi node style'); queueRender(true); saveSoon(); renderSelectionPanel();
        });
      }
      // Wire edge multi-edit controls
      if(edgeCount > 0){
        const edgeIds = state.selection.edges;
        $('#mulEdgeLabel').addEventListener('change', e => { const v = e.target.value.slice(0,80); for(const id of edgeIds){ const ed = edgeById(id); if(ed) ed.label = v; } pushHistory('multi edge label'); queueRender(true); saveSoon(); });
        $('#mulEdgeWeight').addEventListener('change', e => { const v = e.target.value.slice(0,50); for(const id of edgeIds){ const ed = edgeById(id); if(ed){ if(v === '') delete ed.weight; else ed.weight = v; } } pushHistory('multi edge weight'); queueRender(true); saveSoon(); });
        $('#mulEdgeType').addEventListener('change', e => { const v = e.target.value.slice(0,40); for(const id of edgeIds){ const ed = edgeById(id); if(ed){ ed.type = v; applyTypeStyleToEdge(ed); } } invalidateGraphIndex(); pushHistory('multi edge type'); queueRender(false); saveSoon(); renderSelectionPanel(); });
        $('#mulEdgeDirected').addEventListener('change', e => { const v = e.target.value; if(v === '') return; for(const id of edgeIds){ const ed = edgeById(id); if(ed){ (ed as any).direction = v; (ed as any).directed = v !== 'undirected'; } } pushHistory('multi edge directed'); queueRender(true); });
        $('#mulEdgeColor').addEventListener('input', e => { for(const id of edgeIds){ const ed = edgeById(id); if(ed) ed.color = e.target.value; } queueRender(false); saveSoon(); });
        $('#mulEdgeColor').addEventListener('change', () => pushHistory('multi edge color'));
        $('#mulEdgeStrokeSize').addEventListener('change', e => { const v = clamp(finite(e.target.value,2.4),0,20); e.target.value=v; for(const id of edgeIds){ const ed = edgeById(id); if(ed) ed.strokeSize = v; } pushHistory('multi edge stroke size'); queueRender(false); });
        $('#mulEdgeStrokeStyle').addEventListener('change', e => { const v = e.target.value; for(const id of edgeIds){ const ed = edgeById(id); if(ed) ed.strokeStyle = v; } pushHistory('multi edge stroke style'); queueRender(false); });
        $('#mulEdgeLabelColor').addEventListener('input', e => { for(const id of edgeIds){ const ed = edgeById(id); if(ed) ed.labelColor = e.target.value; } queueRender(false); saveSoon(); });
        $('#mulEdgeLabelColor').addEventListener('change', () => pushHistory('multi edge label color'));
        $('#mulEdgeLabelSize').addEventListener('change', e => { const v = clamp(finite(e.target.value,12),4,72); e.target.value=v; for(const id of edgeIds){ const ed = edgeById(id); if(ed) ed.labelSize = v; } pushHistory('multi edge label size'); queueRender(false); });
        $('#mulEdgeLabelFont').addEventListener('change', e => { const v = e.target.value.trim().slice(0,60); for(const id of edgeIds){ const ed = edgeById(id); if(ed) ed.labelFont = v || undefined; } pushHistory('multi edge label font'); queueRender(false); saveSoon(); });
        attachDragNumber($('#mulEdgeStrokeSize'), { min: 0, max: 20, step: 0.1, sensitivity: 0.3 });
        attachDragNumber($('#mulEdgeLabelSize'), { min: 4, max: 72, step: 1, sensitivity: 0.5 });
        $('#mulResetEdgeStyle').addEventListener('click', () => {
          for(const id of edgeIds){
            const ed = edgeById(id); if(!ed) continue;
            delete ed.color; delete ed.strokeSize; delete ed.strokeStyle;
            delete ed.labelColor; delete ed.labelSize; delete ed.labelFont;
            ed.color = '';
          }
          pushHistory('reset multi edge style'); queueRender(true); saveSoon(); renderSelectionPanel();
        });
      }
      return;
    }
    if(state.selected.type === 'node'){
      const n = nodeById(state.selected.id); if(!n){ setSelection([], [], null, false); return; }
      const bounds = coordinateBounds(n);
      const shapeOptions = NODE_SHAPES.map(s => `<option value="${s}">${I18N.t('shape_' + s)}</option>`).join('');
      const strokeOptions = STROKE_STYLES.map(s => `<option value="${s}">${I18N.t('stroke_' + s)}</option>`).join('');
      const typeList = existingNodeTypes().filter(t => t !== n.type);
      const v = nodeVisual(n);
      host.innerHTML = `
        <div class="grid2">
          <label class="field" for="selNodeLabel">${I18N.t('label')} <input id="selNodeLabel" value="${esc(n.label)}"></label>
          <label class="field" for="selNodeType">${I18N.t('type')} <input id="selNodeType" list="nodeTypeList" value="${esc(n.type)}" placeholder="none" data-i18n-placeholder="none_placeholder"><datalist id="nodeTypeList">${typeList.map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
        </div>
        <div class="grid2" style="margin-top:8px">
          <label class="field" for="selNodeX">${I18N.t('x_coord')} <input id="selNodeX" type="number" value="${Math.round(n.x)}" inputmode="decimal"></label>
          <label class="field" for="selNodeY">${I18N.t('y_coord')} <input id="selNodeY" type="number" value="${Math.round(n.y)}" inputmode="decimal"></label>
        </div>
        <div class="grid2" style="margin-top:8px">
          <label class="field" for="selNodeOrder">${I18N.t('order')} <input id="selNodeOrder" type="number" min="0" step="1" value="${n.order ?? 0}" inputmode="numeric"></label>
          <label class="field" for="selNodeId">${I18N.t('id_label')} <input id="selNodeId" value="${esc(n.id)}" readonly style="opacity:.6"></label>
        </div>
        <div class="section-title" style="margin-top:10px">${I18N.t('style_blank_inherit')} <span class="tiny muted">${I18N.t('blank_inherit')}</span></div>
        <div class="grid2">
          <label class="field" for="selNodeColor">${I18N.t('color')} <input id="selNodeColor" type="color" value="${esc(v.color)}"></label>
          <label class="field" for="selNodeShape">${I18N.t('shape')} <select id="selNodeShape"><option value="">${I18N.t('stroke_inherit')}</option>${shapeOptions}</select></label>
          <label class="field" for="selNodeWidth">${I18N.t('width')} <input id="selNodeWidth" type="number" min="10" max="300" value="${v.width}" inputmode="decimal"></label>
          <label class="field" for="selNodeHeight">${I18N.t('height')} <input id="selNodeHeight" type="number" min="10" max="300" value="${v.height}" inputmode="decimal"></label>
          <label class="field" for="selNodeStrokeColor">${I18N.t('stroke_color')} <input id="selNodeStrokeColor" type="color" value="${esc(v.strokeColor)}"></label>
          <label class="field" for="selNodeStrokeSize">${I18N.t('stroke_size')} <input id="selNodeStrokeSize" type="number" min="0" max="20" step="0.1" value="${v.strokeSize}" inputmode="decimal"></label>
          <label class="field" for="selNodeStrokeStyle">${I18N.t('stroke_style')} <select id="selNodeStrokeStyle"><option value="">${I18N.t('stroke_inherit')}</option>${strokeOptions}</select></label>
          <label class="field" for="selNodeLabelColor">${I18N.t('label_color')} <input id="selNodeLabelColor" type="color" value="${esc(v.labelColor)}"></label>
          <label class="field" for="selNodeLabelSize">${I18N.t('label_size')} <input id="selNodeLabelSize" type="number" min="4" max="72" value="${v.labelSize}" inputmode="decimal"></label>
          <label class="field" for="selNodeLabelPos">${I18N.t('label_pos')} <select id="selNodeLabelPos"><option value="">${I18N.t('stroke_inherit')}</option><option value="center">${I18N.t('pos_center')}</option><option value="top">${I18N.t('pos_top')}</option><option value="bottom">${I18N.t('pos_bottom')}</option><option value="left">${I18N.t('pos_left')}</option><option value="right">${I18N.t('pos_right')}</option></select></label>
          <label class="field" for="selNodeLabelFont">${I18N.t('label_font')} <input id="selNodeLabelFont" list="fontList" type="text" value="${esc(v.labelFont)}" placeholder="Inter"></label>
        </div>
        <div class="row" style="margin-top:8px">
          <button id="selDelete" class="btn danger" style="flex:1">${I18N.t('delete_btn')}</button>
          <button id="selResetStyle" class="btn small warn" style="flex:1" title="${I18N.t('reset_style_title')}">${I18N.t('reset_style')}</button>
        </div>
        <p class="drag-hint">${I18N.t('drag_hint')}</p>`;
      $('#selNodeShape').value = n.shape || '';
      $('#selNodeStrokeStyle').value = n.strokeStyle || '';
      $('#selNodeLabelPos').value = n.labelPosition || '';
      const syncCoordInputs = () => {
        const x = Math.round(n.x), y = Math.round(n.y);
        const xEl = $('#selNodeX'), yEl = $('#selNodeY');
        if(xEl && document.activeElement !== xEl) xEl.value = x;
        if(yEl && document.activeElement !== yEl) yEl.value = y;
      };
      const moveCoord = (axis, value, final=false) => {
        n[axis] = snapAxisValue(axis, value, n.id);
        syncCoordInputs();
        moveNodeFast(n.id);
        saveSoon();
        if(final) pushHistory('move node coordinate');
      };
      $('#selNodeLabel').addEventListener('change', e => { n.label = e.target.value.slice(0,80); pushHistory(); queueRender(true); markSidebarDirty(); });
      $('#selNodeType').addEventListener('change', e => { n.type = e.target.value.slice(0,40); applyTypeStyleToNode(n); invalidateGraphIndex(); pushHistory('node type'); queueRender(false); renderSelectionPanel(); });
      $('#selNodeColor').addEventListener('input', e => { n.color = e.target.value; queueRender(false); saveSoon(); });
      $('#selNodeColor').addEventListener('change', () => pushHistory());
      $('#selNodeShape').addEventListener('change', e => { n.shape = e.target.value; pushHistory(); queueRender(false); });
      $('#selNodeWidth').addEventListener('change', e => { n.width = clamp(finite(e.target.value,50),10,300); e.target.value=n.width; pushHistory(); queueRender(false); });
      $('#selNodeHeight').addEventListener('change', e => { n.height = clamp(finite(e.target.value,50),10,300); e.target.value=n.height; pushHistory(); queueRender(false); });
      $('#selNodeStrokeColor').addEventListener('input', e => { n.strokeColor = e.target.value; queueRender(false); saveSoon(); });
      $('#selNodeStrokeColor').addEventListener('change', () => pushHistory());
      $('#selNodeStrokeSize').addEventListener('change', e => { n.strokeSize = clamp(finite(e.target.value,2.2),0,20); e.target.value=n.strokeSize; pushHistory(); queueRender(false); });
      $('#selNodeStrokeStyle').addEventListener('change', e => { n.strokeStyle = e.target.value; pushHistory(); queueRender(false); });
      $('#selNodeLabelColor').addEventListener('input', e => { n.labelColor = e.target.value; queueRender(false); saveSoon(); });
      $('#selNodeLabelColor').addEventListener('change', () => pushHistory());
      $('#selNodeLabelSize').addEventListener('change', e => { n.labelSize = clamp(finite(e.target.value,13),4,72); e.target.value=n.labelSize; pushHistory(); queueRender(false); });
      $('#selNodeLabelPos').addEventListener('change', e => { n.labelPosition = e.target.value; pushHistory(); queueRender(false); });
      $('#selNodeLabelFont').addEventListener('change', e => { n.labelFont = e.target.value.slice(0,60) || undefined; pushHistory(); queueRender(false); });
      $('#selNodeOrder').addEventListener('change', e => { n.order = clamp(parseInt(e.target.value,10)||0, 0, 2147483647); e.target.value=n.order; invalidateGraphIndex(); pushHistory('node order'); queueRender(true); saveSoon(); });
      $('#selNodeX').addEventListener('input', e => moveCoord('x', e.target.value, false));
      $('#selNodeY').addEventListener('input', e => moveCoord('y', e.target.value, false));
      $('#selNodeX').addEventListener('change', e => moveCoord('x', e.target.value, true));
      $('#selNodeY').addEventListener('change', e => moveCoord('y', e.target.value, true));
      attachDragNumber($('#selNodeX'), { min: bounds.minX, max: bounds.maxX, step: 1, sensitivity: 0.6 });
      attachDragNumber($('#selNodeY'), { min: bounds.minY, max: bounds.maxY, step: 1, sensitivity: 0.6 });
      attachDragNumber($('#selNodeWidth'), { min: 10, max: 300, step: 1, sensitivity: 0.5 });
      attachDragNumber($('#selNodeHeight'), { min: 10, max: 300, step: 1, sensitivity: 0.5 });
      attachDragNumber($('#selNodeStrokeSize'), { min: 0, max: 20, step: 0.1, sensitivity: 0.3 });
      attachDragNumber($('#selNodeLabelSize'), { min: 4, max: 72, step: 1, sensitivity: 0.5 });
      $('#selDelete').addEventListener('click', deleteSelected);
      $('#selResetStyle').addEventListener('click', () => {
        delete n.shape; delete n.color; delete n.width; delete n.height;
        delete n.strokeColor; delete n.strokeSize; delete n.strokeStyle;
        delete n.labelColor; delete n.labelSize; delete n.labelPosition; delete n.labelFont;
        n.shape = ''; n.color = '';
        pushHistory('reset node style'); queueRender(true); saveSoon(); renderSelectionPanel();
      });
    } else {
      const e = edgeById(state.selected.id); if(!e){ setSelection([], [], null, false); return; }
      const a=nodeById(e.from), b=nodeById(e.to);
      const typeList = existingEdgeTypes().filter(t => t !== e.type);
      const v = edgeVisual(e);
      const strokeOptions = STROKE_STYLES.map(s => `<option value="${s}">${I18N.t('stroke_' + s)}</option>`).join('');
      host.innerHTML = `
        <div class="tiny muted" style="margin-bottom:8px">${esc(a?.label || e.from)} → ${esc(b?.label || e.to)}</div>
        <div class="grid2">
          <label class="field" for="selEdgeWeight">${I18N.t('weight')} <input id="selEdgeWeight" value="${esc(e.weight)}"></label>
          <label class="field" for="selEdgeLabel">${I18N.t('label')} <input id="selEdgeLabel" value="${esc(e.label)}"></label>
        </div>
        <label class="field" for="selEdgeType" style="margin-top:8px">${I18N.t('type')} <input id="selEdgeType" list="edgeTypeList" value="${esc(e.type)}" placeholder="${I18N.t('none_placeholder')}" data-i18n-placeholder="none_placeholder"><datalist id="edgeTypeList">${typeList.map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
        <label class="field" for="selEdgeDirected">${I18N.t('direction')} <select id="selEdgeDirected"><option value="directed">${I18N.t('directed_edge_short')}</option><option value="mutual">${I18N.t('mutual_edge_short') || 'Mutual'}</option><option value="undirected">${I18N.t('undirected_edge_short')}</option></select></label>
        <div class="section-title">${I18N.t('style_blank_inherit')} <span class="tiny muted">${I18N.t('blank_inherit')}</span></div>
        <div class="grid2">
          <label class="field" for="selEdgeColor">${I18N.t('color')} <input id="selEdgeColor" type="color" value="${esc(v.color)}"></label>
          <label class="field" for="selEdgeStrokeSize">${I18N.t('stroke_size')} <input id="selEdgeStrokeSize" type="number" min="0" max="20" step="0.1" value="${v.strokeSize}" inputmode="decimal"></label>
          <label class="field" for="selEdgeStrokeStyle">${I18N.t('stroke_style')} <select id="selEdgeStrokeStyle"><option value="">${I18N.t('stroke_inherit')}</option>${strokeOptions}</select></label>
          <label class="field" for="selEdgeLabelColor">${I18N.t('label_color')} <input id="selEdgeLabelColor" type="color" value="${esc(v.labelColor)}"></label>
          <label class="field" for="selEdgeLabelSize">${I18N.t('label_size')} <input id="selEdgeLabelSize" type="number" min="4" max="72" value="${v.labelSize}" inputmode="decimal"></label>
          <label class="field" for="selEdgeLabelFont">${I18N.t('label_font')} <input id="selEdgeLabelFont" list="fontList" type="text" value="${esc(v.labelFont)}" placeholder="Inter"></label>
        </div>
        <div class="row" style="margin-top:8px">
          <button id="selDelete" class="btn danger" style="flex:1">${I18N.t('delete_edge')}</button>
          <button id="selResetEdgeStyle" class="btn small warn" style="flex:1" title="${I18N.t('reset_edge_style_title')}">${I18N.t('reset_style')}</button>
        </div>`;
      $('#selEdgeStrokeStyle').value = e.strokeStyle || '';
      $('#selEdgeWeight').addEventListener('change', ev => { const v = ev.target.value.slice(0,50); if(v === '') delete e.weight; else e.weight = v; pushHistory(); queueRender(true); });
      $('#selEdgeLabel').addEventListener('change', ev => { e.label = ev.target.value.slice(0,80); pushHistory(); queueRender(true); });
      $('#selEdgeType').addEventListener('change', ev => { e.type = ev.target.value.slice(0,40); applyTypeStyleToEdge(e); invalidateGraphIndex(); pushHistory('edge type'); queueRender(false); renderSelectionPanel(); });
      ($('#selEdgeDirected') as any).value = edgeDirection(e);
      $('#selEdgeDirected').addEventListener('change', ev => { (e as any).direction = (ev.target as any).value; (e as any).directed = (ev.target as any).value !== 'undirected'; pushHistory(); queueRender(true); });
      $('#selEdgeColor').addEventListener('input', ev => { e.color = ev.target.value; queueRender(false); saveSoon(); });
      $('#selEdgeColor').addEventListener('change', () => pushHistory());
      $('#selEdgeStrokeSize').addEventListener('change', ev => { e.strokeSize = clamp(finite(ev.target.value,2.4),0,20); ev.target.value=e.strokeSize; pushHistory(); queueRender(false); });
      $('#selEdgeStrokeStyle').addEventListener('change', ev => { e.strokeStyle = ev.target.value; pushHistory(); queueRender(false); });
      $('#selEdgeLabelColor').addEventListener('input', ev => { e.labelColor = ev.target.value; queueRender(false); saveSoon(); });
      $('#selEdgeLabelColor').addEventListener('change', () => pushHistory());
      $('#selEdgeLabelSize').addEventListener('change', ev => { e.labelSize = clamp(finite(ev.target.value,12),4,72); ev.target.value=e.labelSize; pushHistory(); queueRender(false); });
      $('#selEdgeLabelFont').addEventListener('change', ev => { e.labelFont = ev.target.value.slice(0,60) || undefined; pushHistory(); queueRender(false); });
      attachDragNumber($('#selEdgeStrokeSize'), { min: 0, max: 20, step: 0.1, sensitivity: 0.3 });
      attachDragNumber($('#selEdgeLabelSize'), { min: 4, max: 72, step: 1, sensitivity: 0.5 });
      $('#selDelete').addEventListener('click', deleteSelected);
      $('#selResetEdgeStyle').addEventListener('click', () => {
        delete e.color; delete e.strokeSize; delete e.strokeStyle;
        delete e.labelColor; delete e.labelSize; delete e.labelFont;
        e.color = '';
        pushHistory('reset edge style'); queueRender(true); saveSoon(); renderSelectionPanel();
      });
    }
  }
  // Returns nodes sorted by order, optionally filtered by the visible range setting.
  // When visibleRange.start is -1, all nodes are returned. Sorted result is cached
  // globally (invalidated by graphRev), and per-pass visibleNodes/visibleIds are
  // cached inside passVisuals to avoid double sort in renderCanvas (renderEdges + renderNodes).
  function visibleNodes(){
    const vc = passVisuals;
    if(vc && vc.visibleNodes) return vc.visibleNodes;
    const sorted = sortedNodesByOrder();
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    let result: any[];
    if(vr.start < 0 && vr.end < 0) result = sorted;
    else {
      const start = vr.start < 0 ? 0 : vr.start;
      const end = vr.end < 0 ? sorted.length : Math.min(vr.end + 1, sorted.length);
      result = sorted.slice(Math.max(0, start), end);
    }
    if(vc) vc.visibleNodes = result;
    return result;
  }
  function visibleNodeIds(){
    const vc = passVisuals;
    if(vc && vc.visibleIds) return vc.visibleIds;
    const nodes = visibleNodes();
    const ids = new Set(nodes.map((n:any) => n.id));
    if(vc) vc.visibleIds = ids;
    return ids;
  }
  function matrixNodes(){
    const dim = clamp(parseInt(state.settings.matrixDimension,10) || 0, 0, MATRIX_MAX_NODES);
    const sorted = visibleNodes();
    // Hard ceiling, independent of matrixLimit: every matrix cell is an <input>,
    // so an n×n grid is n² DOM elements. Without this, a document with a large
    // matrixLimit (or a big graph and matrixDimension 0) can freeze the tab.
    return dim > 0 ? sorted.slice(0, Math.min(dim, sorted.length)) : sorted.slice(0, MATRIX_MAX_NODES);
  }
  let edgeListRenderLimit = 250;
  function configuredEdgeListPageSize(){
    return positiveInteger(state.settings.edgeListPageSize, 250);
  }
  function renderMatrixAndList(){
    edgeListRenderLimit = configuredEdgeListPageSize();
    const visNodes = matrixNodes();
    const n = visNodes.length, total = state.nodes.length, limit = state.settings.matrixLimit;
    const sizeInput = $('#matrixSize'); if(sizeInput){ sizeInput.value = Math.min(state.settings.matrixDimension || total, MATRIX_MAX_NODES); sizeInput.max = String(MATRIX_MAX_NODES); }
    const note = $('#matrixNote');
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    const rangeActive = vr.start >= 0 || vr.end >= 0;
    if(total === 0){ $('#matrixHost').innerHTML = '<div class="tiny muted">' + I18N.t('no_nodes_yet') + '</div>'; $('#edgeListHost').innerHTML = '<div class="tiny muted">' + I18N.t('no_edges_yet') + '</div>'; note.textContent=''; return; }
    if(n === 0){ $('#matrixHost').innerHTML = '<div class="tiny muted">' + I18N.t('no_nodes_range') + '</div>'; note.textContent = `0 / ${total}`; }
    else if(n > limit){
      // Report the real graph size and the render ceiling, not the already
      // clamped slice: "300 nodes" for a 350-node graph (with advice to raise a
      // limit that could not help) was misleading.
      $('#matrixHost').innerHTML = '<div class="tiny muted">' + esc(I18N.t('matrix_hidden_limit', {total, limit, cap: MATRIX_MAX_NODES})) + '</div>';
      note.textContent = I18N.t('matrix_note_hidden', {n, total});
    }
    else {
      $('#matrixHost').innerHTML = adjacencyMatrixHtml(visNodes);
      note.textContent = rangeActive
        ? I18N.t('matrix_note_range', {n, start: vr.start >= 0 ? vr.start : 0, end: vr.end >= 0 ? vr.end : I18N.t('matrix_note_end'), total})
        : n === total ? `${n}×${n}` : I18N.t('matrix_note_view', {n, total});
    }
    $('#edgeListHost').innerHTML = edgeListHtml();
  }
  function adjacencyMatrixData(nodes=state.nodes, includeEdgeIds=true){
    const index = new Map(nodes.map((node,i) => [node.id,i]));
    const n = nodes.length;
    // Cells are created lazily: an adjacency matrix is almost always sparse, so
    // filling n² empty arrays up front allocates (and later collects) two
    // arrays per cell for nothing. A missing cell simply holds no edge.
    const values: any[][] = new Array(n);
    const edgeIds = includeEdgeIds ? new Array(n) : null;
    const cellAt = (row: any[], i: number) => (row[i] || (row[i] = []));
    for(const edge of state.edges){
      const from=index.get(edge.from), to=index.get(edge.to); if(from == null || to == null) continue;
      const weight = (edge.weight != null && edge.weight !== '') ? edge.weight : '';
      cellAt(values[from] || (values[from] = []), to).push(weight);
      if(edgeIds) cellAt(edgeIds[from] || (edgeIds[from] = []), to).push(edge.id);
      if(edgeIsUndirected(edge) || edgeDirection(edge)==='mutual' && from !== to){
        cellAt(values[to] || (values[to] = []), from).push(weight);
        if(edgeIds) cellAt(edgeIds[to] || (edgeIds[to] = []), from).push(edge.id);
      }
    }
    return {values, edgeIds};
  }
  function adjacencyMatrix(nodes=state.nodes){ return adjacencyMatrixData(nodes, false).values; }
  function matrixCellEdgeIds(from, to){
    return state.edges
      .filter(e => (e.from === from && e.to === to) || ((edgeIsUndirected(e) || edgeDirection(e)==='mutual') && e.from === to && e.to === from))
      .map(e => e.id);
  }
  const emptyCell: any[] = [];
  function adjacencyMatrixHtml(nodes=matrixNodes()){
    const {values, edgeIds} = adjacencyMatrixData(nodes);
    const edgeSel = selectedEdgeIds();
    // Global order index for each node (for move boundaries)
    const allSorted = [...state.nodes].sort((a,b)=>(a.order??0)-(b.order??0));
    const orderPos = new Map(allSorted.map((n,i)=>[n.id,i]));
    // Build with array push+join instead of repeated += to avoid O(n^2) string copying for large matrices
    const parts: string[] = [];
    const header = nodes.map((n, idx) => {
      const pos = orderPos.get(n.id) ?? idx;
      const upDisabled = pos === 0 ? ' disabled' : '';
      const downDisabled = pos === allSorted.length - 1 ? ' disabled' : '';
      return `<th><div class="matrix-header-cell"><input class="matrix-label-input${isNodeSelected(n.id)?' matrix-selected':''}" data-node-label="${esc(n.id)}" value="${esc(n.label || n.id)}" readonly aria-label="${esc(I18N.t('label'))}: ${esc(n.id)}" title="${esc(I18N.t('matrix_node_hint'))}"><div class="matrix-node-controls"><button class="btn small icon matrix-node-move" data-node-move="${esc(n.id)}" data-dir="-1" title="${esc(I18N.t('move_left'))}" aria-label="${esc(I18N.t('move_left'))}: ${esc(n.id)}"${upDisabled}><svg class="ui-icon" aria-hidden="true"><use href="#icon-left"></use></svg></button><span class="matrix-order-badge" title="${esc(I18N.t('order'))}">${n.order??0}</span><button class="btn small icon matrix-node-move" data-node-move="${esc(n.id)}" data-dir="1" title="${esc(I18N.t('move_right'))}" aria-label="${esc(I18N.t('move_right'))}: ${esc(n.id)}"${downDisabled}><svg class="ui-icon" aria-hidden="true"><use href="#icon-right"></use></svg></button></div></div></th>`;
    }).join('');
    parts.push('<table><thead><tr><th scope="col"><span class="visually-hidden">' + esc(I18N.t('matrix_corner')) + '</span></th>', header, '</tr></thead><tbody>');
    for(let i=0;i<nodes.length;i++){
      const row = nodes[i];
      const pos = orderPos.get(row.id) ?? i;
      const upDisabled = pos === 0 ? ' disabled' : '';
      const downDisabled = pos === allSorted.length - 1 ? ' disabled' : '';
      parts.push(`<tr><th class="row-head"><div class="matrix-header-cell row-head-cell"><input class="matrix-label-input${isNodeSelected(row.id)?' matrix-selected':''}" data-node-label="${esc(row.id)}" value="${esc(row.label || row.id)}" readonly aria-label="${esc(I18N.t('label'))}: ${esc(row.id)}" title="${esc(I18N.t('matrix_node_hint'))}"><div class="matrix-node-controls"><button class="btn small icon matrix-node-move" data-node-move="${esc(row.id)}" data-dir="-1" title="${esc(I18N.t('move_up'))}" aria-label="${esc(I18N.t('move_up'))}: ${esc(row.id)}"${upDisabled}><svg class="ui-icon" aria-hidden="true"><use href="#icon-up"></use></svg></button><button class="btn small icon matrix-node-move" data-node-move="${esc(row.id)}" data-dir="1" title="${esc(I18N.t('move_down'))}" aria-label="${esc(I18N.t('move_down'))}: ${esc(row.id)}"${downDisabled}><svg class="ui-icon" aria-hidden="true"><use href="#icon-down"></use></svg></button></div></div></th>`);
      // Rows are sparse (see adjacencyMatrixData): cells without an edge are
      // rendered from the same empty shape on demand, in column order.
      const rowVals = values[i] || [];
      const rowEdgeIds = edgeIds[i] || [];
      for(let j=0;j<nodes.length;j++){
        const cell = rowVals[j] || emptyCell;
        const to = nodes[j].id;
        const ids = rowEdgeIds[j] || emptyCell;
        const selected = ids.some(id => edgeSel.has(id));
        parts.push(`<td><input class="matrix-input${selected?' matrix-selected':''}" data-cell-from="${esc(row.id)}" data-cell-to="${esc(to)}" data-cell-edges="${esc(ids.join(','))}" value="${esc(cell.join(';') || '')}" placeholder="0" readonly aria-label="${esc(I18N.t('col_from'))} ${esc(row.id)}, ${esc(I18N.t('col_to'))} ${esc(to)}" title="${esc(I18N.t('matrix_cell_hint'))}"></td>`);
      }
      parts.push('</tr>');
    }
    parts.push('</tbody></table>');
    return parts.join('');
  }
  function edgeListHtml(){
    if(!state.edges.length){ if($('#edgeListNote')) $('#edgeListNote').textContent = ''; return '<div class="tiny muted">' + I18N.t('no_edges_yet') + '</div>'; }
    // Filter edges by visible range (if set): only show edges where BOTH endpoints are visible
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    const rangeActive = vr.start >= 0 || vr.end >= 0;
    const visIds = rangeActive ? visibleNodeIds() : null;
    const filteredEdges = rangeActive
      ? state.edges.filter(e => visIds.has(e.from) && visIds.has(e.to))
      : state.edges;
    if(!filteredEdges.length){
      if($('#edgeListNote')) $('#edgeListNote').textContent = '';
      return '<div class="tiny muted">' + I18N.t('no_edges_range') + '</div>';
    }
    const renderedEdges = filteredEdges.slice(0, edgeListRenderLimit);
    if($('#edgeListNote')){
      const total = state.edges.length, shown = filteredEdges.length, rendered = renderedEdges.length;
      const filterNote = rangeActive
        ? I18N.t('n_edges_filtered', {n: shown, m: total})
        : I18N.t('n_edges', {n: total});
      const pageNote = rendered < shown
        ? I18N.t('edge_list_showing', {n: rendered})
        : '';
      $('#edgeListNote').textContent = filterNote + pageNote;
    }
    const selectedEdges = selectedEdgeIds();
    const parts: string[] = [];
    parts.push('<table><thead><tr><th scope="col"><span class="visually-hidden">' + esc(I18N.t('rows_reorder')) + '</span></th><th>' + I18N.t('col_num') + '</th><th>' + I18N.t('col_id') + '</th><th>' + I18N.t('col_from') + '</th><th>' + I18N.t('col_to') + '</th><th>' + I18N.t('weight') + '</th><th>' + I18N.t('label') + '</th><th>' + I18N.t('type') + '</th><th>' + I18N.t('col_dir') + '</th><th>' + I18N.t('color') + '</th><th>' + I18N.t('col_stroke') + '</th></tr></thead><tbody>');
    for(let i=0;i<renderedEdges.length;i++){
      const e = renderedEdges[i];
      const a = nodeById(e.from), b = nodeById(e.to);
      const sel = selectedEdges.has(e.id) ? ' matrix-selected' : '';
      const strokeOpts = '<option value=""></option>' + STROKE_STYLES.map(s => `<option value="${s}"${e.strokeStyle===s?' selected':''}>${I18N.t('stroke_' + s)}</option>`).join('');
      parts.push(`<tr>
        <td style="white-space:nowrap">
          <button class="btn small icon edge-up" data-edge-id="${esc(e.id)}" title="${esc(I18N.t('move_up'))}" aria-label="${esc(I18N.t('move_up'))}: ${esc(e.id)}" style="min-height:28px;width:28px;padding:0"><svg class="ui-icon" aria-hidden="true"><use href="#icon-up"></use></svg></button>
          <button class="btn small icon edge-down" data-edge-id="${esc(e.id)}" title="${esc(I18N.t('move_down'))}" aria-label="${esc(I18N.t('move_down'))}: ${esc(e.id)}" style="min-height:28px;width:28px;padding:0"><svg class="ui-icon" aria-hidden="true"><use href="#icon-down"></use></svg></button>
        </td>
        <td>${i+1}</td>
        <td><input class="matrix-input edge-id" data-edge-id="${esc(e.id)}" value="${esc(e.id)}" aria-label="${esc(I18N.t('col_id'))}: ${esc(e.id)}" title="${esc(I18N.t('edge_id_hint'))}" style="width:60px"></td>
        <td><input class="matrix-input edge-from" data-edge-id="${esc(e.id)}" value="${esc(a?.label || e.from)}" aria-label="${esc(I18N.t('col_from'))}: ${esc(e.id)}" title="${esc(I18N.t('edge_from_hint', {node: e.from}))}" style="width:64px"></td>
        <td><input class="matrix-input edge-to" data-edge-id="${esc(e.id)}" value="${esc(b?.label || e.to)}" aria-label="${esc(I18N.t('col_to'))}: ${esc(e.id)}" title="${esc(I18N.t('edge_to_hint', {node: e.to}))}" style="width:64px"></td>
        <td><input class="matrix-input edge-weight${sel}" data-edge-id="${esc(e.id)}" value="${esc(e.weight)}" aria-label="${esc(I18N.t('weight'))}: ${esc(e.id)}" title="${esc(I18N.t('edit_weight'))}" style="width:52px"></td>
        <td><input class="matrix-input edge-elabel" data-edge-id="${esc(e.id)}" value="${esc(e.label)}" aria-label="${esc(I18N.t('label'))}: ${esc(e.id)}" title="${esc(I18N.t('edit_label'))}" style="width:72px"></td>
        <td><input class="matrix-input edge-type" data-edge-id="${esc(e.id)}" value="${esc(e.type)}" aria-label="${esc(I18N.t('type'))}: ${esc(e.id)}" placeholder="none" data-i18n-placeholder="none_placeholder" title="${esc(I18N.t('edit_type'))}" style="width:64px"></td>
        <td><select class="edge-directed" data-edge-id="${esc(e.id)}" aria-label="${esc(I18N.t('directed'))}: ${esc(e.id)}" title="${esc(I18N.t('directed'))}"><option value="directed" ${edgeDirection(e)==='directed'?'selected':''}>→</option><option value="mutual" ${edgeDirection(e)==='mutual'?'selected':''}>↔</option><option value="undirected" ${edgeDirection(e)==='undirected'?'selected':''}>—</option></select></td>
        <td><input type="color" class="edge-color" data-edge-id="${esc(e.id)}" value="${esc(edgeVisual(e).color)}" aria-label="${esc(I18N.t('color'))}: ${esc(e.id)}" title="${esc(I18N.t('edge_color'))}" style="width:32px;height:26px;padding:2px"></td>
        <td><select class="matrix-input edge-stroke-style" data-edge-id="${esc(e.id)}" aria-label="${esc(I18N.t('stroke_style'))}: ${esc(e.id)}" title="${esc(I18N.t('stroke_style'))}" style="width:68px">${strokeOpts}</select></td>
      </tr>`);
    }
    parts.push('</tbody></table>');
    if(renderedEdges.length < filteredEdges.length){
      const remaining = filteredEdges.length - renderedEdges.length;
      const pageSize = configuredEdgeListPageSize();
      const label = I18N.t('edge_list_more', {n: Math.min(pageSize, remaining)});
      parts.push(`<div class="row" style="justify-content:center;padding:8px"><button id="btnEdgeListMore" class="btn small">${label}</button></div>`);
    }
    return parts.join('');
  }

  function showMoreEdgeRows(){
    edgeListRenderLimit += configuredEdgeListPageSize();
    $('#edgeListHost').innerHTML = edgeListHtml();
  }
