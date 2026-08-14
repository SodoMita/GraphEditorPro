  // === Visual resolution: merge per-item overrides → type styles → defaults ===
  function nodeVisual(n){
    const d = state.settings.nodeDefaults;
    const ts = (n.type && state.settings.nodeTypeStyles && state.settings.nodeTypeStyles[n.type]) || {};
    return {
      shape: n.shape || ts.shape || d.shape,
      color: n.color || ts.color || d.color,
      type: n.type || '',
      width: n.width != null ? n.width : (ts.width != null ? ts.width : d.width),
      height: n.height != null ? n.height : (ts.height != null ? ts.height : d.height),
      strokeColor: n.strokeColor || ts.strokeColor || d.strokeColor,
      strokeSize: n.strokeSize != null ? n.strokeSize : (ts.strokeSize != null ? ts.strokeSize : d.strokeSize),
      strokeStyle: n.strokeStyle || ts.strokeStyle || d.strokeStyle,
      labelColor: n.labelColor || ts.labelColor || d.labelColor,
      labelSize: n.labelSize || ts.labelSize || d.labelSize,
      labelPosition: n.labelPosition || ts.labelPosition || d.labelPosition,
      labelFont: n.labelFont || ts.labelFont || d.labelFont
    };
  }
  function edgeVisual(e){
    const d = state.settings.edgeDefaults;
    const ts = (e.type && state.settings.edgeTypeStyles && state.settings.edgeTypeStyles[e.type]) || {};
    return {
      color: e.color || ts.color || d.color,
      type: e.type || '',
      strokeSize: e.strokeSize != null ? e.strokeSize : (ts.strokeSize != null ? ts.strokeSize : d.strokeSize),
      strokeStyle: e.strokeStyle || ts.strokeStyle || d.strokeStyle,
      labelColor: e.labelColor || ts.labelColor || d.labelColor,
      labelSize: e.labelSize || ts.labelSize || d.labelSize,
      labelFont: e.labelFont || ts.labelFont || d.labelFont
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
    const gd: GraphDefaults = state.settings.graphDefaults || ({} as GraphDefaults);
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
  function strokeDashArray(style, size){
    if(style === 'dashed') return `${Math.max(4, size*2)} ${Math.max(3, size*1.5)}`;
    if(style === 'dotted') return `${Math.max(1, size*0.8)} ${Math.max(3, size*1.8)}`;
    return 'none';
  }
  function shouldShowLabels(){
    const policy = state.settings.graphDefaults?.labelsPolicy || 'auto';
    if(policy === 'off') return false;
    if(policy === 'on') return true;
    return state.nodes.length <= 30;
  }
  function existingNodeTypes(){
    const set = new Set();
    for(const n of state.nodes) if(n.type) set.add(n.type);
    return [...set].sort();
  }
  function existingEdgeTypes(){
    const set = new Set();
    for(const e of state.edges) if(e.type) set.add(e.type);
    return [...set].sort();
  }

