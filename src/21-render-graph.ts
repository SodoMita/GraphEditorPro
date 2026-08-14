  function renderEdges(){
    buildEdgeOffsetCache();
    const showLabels = shouldShowLabels();
    const existing = new Map();
    for(const el of [...edgesLayer.children] as HTMLElement[]){
      if(el.dataset?.id) existing.set(el.dataset.id, el);
    }
    const seen = new Set();
    // Pre-compute visible node IDs once per render — edges touching non-visible nodes are skipped entirely
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    const rangeActive = vr.start >= 0 || vr.end >= 0;
    const visIds = rangeActive ? visibleNodeIds() : null;
    for(const e of state.edges){
      const a = nodeById(e.from), b = nodeById(e.to);
      if(!a || !b){
        // Edge has dangling endpoint — remove from DOM if present
        if(existing.has(e.id)) existing.get(e.id).remove();
        continue;
      }
      // Skip edges touching non-visible nodes entirely — real performance gain, not just dimming
      if(rangeActive && (!visIds.has(e.from) || !visIds.has(e.to))) continue;
      seen.add(e.id);
      const selected = isEdgeSelected(e.id);
      const v = edgeRenderStyle(e);
      const d = edgePath(a,b,e);
      let g = existing.get(e.id);
      if(!g){
        g = document.createElementNS(NS,'g'); g.classList.add('edge');
        g.id = 'edge-' + e.id; g.dataset.id = e.id; g.dataset.from = e.from; g.dataset.to = e.to;
        g.addEventListener('pointerdown', ev => {
          ev.stopPropagation();
          if(ev.button === 1 || ev.button === 2){ registerPointer(ev); pendingEdgeFrom = null; startPan(ev); return; }
          if(ev.button !== 0) return;
          if(polygonToolActive()){ registerPointer(ev); handlePolygonPointerDown(ev); return; }
          if(state.mode === 'move'){ centerOnFurthestNodeOfEdge(e); return; }
          selectItem('edge', e.id);
        });
        g.addEventListener('dblclick', ev => { ev.stopPropagation(); if(polygonToolActive() && selectDraft?.tool === 'polygon') finishPolygonSelection(false); else editEdgeQuick(e.id); });
        edgesLayer.appendChild(g);
      }
      g.classList.toggle('selected', selected);
      // Update or create hit path
      let hit = g.querySelector('.edge-hit');
      if(!hit){ hit = document.createElementNS(NS,'path'); hit.setAttribute('class','edge-hit'); g.appendChild(hit); }
      hit.setAttribute('d', d.path);
      // Update or create line path
      let line = g.querySelector('.edge-line');
      if(!line){ line = document.createElementNS(NS,'path'); line.setAttribute('class','edge-line'); g.insertBefore(line, g.firstChild); }
      line.setAttribute('d', d.path);
      line.setAttribute('stroke', v.color); line.setAttribute('stroke-width', v.strokeSize);
      const dash = strokeDashArray(v.strokeStyle, v.strokeSize);
      if(dash !== 'none') line.setAttribute('stroke-dasharray', dash);
      else line.removeAttribute('stroke-dasharray');
      // Update or create arrow
      let arrow = g.querySelector('.edge-arrow');
      if(e.directed && d.tipX != null && d.arrowAngle != null){
        const arrowColor = selected ? '#22d3ee' : v.color;
        const aw = ARROW_HW, ang = d.arrowAngle;
        const sin = Math.sin(ang), cos = Math.cos(ang);
        const px = -sin, py = cos;
        const baseX = d.tx, baseY = d.ty;
        const leftX = baseX + px * aw, leftY = baseY + py * aw;
        const rightX = baseX - px * aw, rightY = baseY - py * aw;
        if(!arrow){ arrow = document.createElementNS(NS,'polygon'); arrow.setAttribute('class','edge-arrow'); g.appendChild(arrow); }
        arrow.setAttribute('points', `${d.tipX},${d.tipY} ${leftX},${leftY} ${rightX},${rightY}`);
        arrow.setAttribute('fill', arrowColor);
      } else if(arrow){
        arrow.remove();
      }
      // Compute label and weight text separately so both can be shown at once.
      // Weight is drawn ON the line midpoint; label is drawn ABOVE it (offset).
      const gd: GraphDefaults = state.settings.graphDefaults || ({} as GraphDefaults);
      const mode = gd.edgeWeightMode || 'number';
      let labelText = '', weightText = '';
      if(showLabels){
        if(e.label) labelText = e.label;
        if(e.weight !== '' && e.weight != null){
          const w = edgeWeightNumber(e);
          if(w != null){
            if(mode === 'number'){
              weightText = String(e.weight);
            } else if(mode === 'color' || mode === 'width'){
              // Show number only when weight is outside the configured range
              if(!isWeightInRange(w, gd.edgeWeightMin ?? 1, gd.edgeWeightMax ?? 10)) weightText = String(e.weight);
            }
            // 'none' mode: never show weight as text
          }
        }
      }
      const hasBoth = labelText && weightText;
      const labelOffsetY = hasBoth ? -(v.labelSize * 0.75 + 2) : 0;
      // Update or create label (drawn above weight when both present)
      let label = g.querySelector('.edge-label');
      if(labelText){
        if(!label){
          label = document.createElementNS(NS,'text');
          label.setAttribute('class','edge-label');
          label.setAttribute('text-anchor','middle'); label.setAttribute('dominant-baseline','middle');
          label.setAttribute('paint-order','stroke');
          label.setAttribute('stroke','#020617');
          label.setAttribute('stroke-linejoin','round');
          g.appendChild(label);
        }
        label.setAttribute('x', d.labelX); label.setAttribute('y', d.labelY + labelOffsetY);
        label.setAttribute('fill', v.labelColor);
        label.setAttribute('font-size', v.labelSize);
        label.setAttribute('font-family', v.labelFont);
        label.setAttribute('stroke-width', Math.max(3, v.labelSize * 0.36));
        if(label.textContent !== labelText) label.textContent = labelText;
      } else if(label){
        label.remove();
      }
      // Update or create weight text (drawn on the line midpoint)
      let weight = g.querySelector('.edge-weight');
      if(weightText){
        if(!weight){
          weight = document.createElementNS(NS,'text');
          weight.setAttribute('class','edge-weight');
          weight.setAttribute('text-anchor','middle'); weight.setAttribute('dominant-baseline','middle');
          weight.setAttribute('paint-order','stroke');
          weight.setAttribute('stroke','#020617');
          weight.setAttribute('stroke-linejoin','round');
          g.appendChild(weight);
        }
        weight.setAttribute('x', d.labelX); weight.setAttribute('y', d.labelY);
        weight.setAttribute('fill', v.labelColor);
        weight.setAttribute('font-size', v.labelSize);
        weight.setAttribute('font-family', v.labelFont);
        weight.setAttribute('stroke-width', Math.max(3, v.labelSize * 0.36));
        if(weight.textContent !== weightText) weight.textContent = weightText;
      } else if(weight){
        weight.remove();
      }
    }
    // Remove stale edges
    for(const [id, el] of existing){ if(!seen.has(id)) el.remove(); }
  }
  function edgeGroupKey(e){ return e.from <= e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`; }
  function buildEdgeOffsetCache(){
    const groups = new Map();
    for(const e of state.edges){
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
  function edgePath(a,b,e){
    const ra = nodeRadius(a), rb = nodeRadius(b);
    const arrowGap = e.directed ? ARROW_LEN : 2; // space reserved for arrow at target
    if(a.id === b.id){
      const lane = edgeSiblingOffset(e);
      const step = lane / 30;
      const angle = -Math.PI / 2 + step * 0.62;
      const spread = 0.72;
      const loop = 78 + Math.abs(step) * 10;
      const sx = a.x + Math.cos(angle - spread) * (ra + 2);
      const sy = a.y + Math.sin(angle - spread) * (ra + 2);
      // Path ends at arrow base; tip extends to node boundary
      const tx = a.x + Math.cos(angle + spread) * (ra + arrowGap);
      const ty = a.y + Math.sin(angle + spread) * (ra + arrowGap);
      const c1x = a.x + Math.cos(angle - spread * 0.45) * (ra + loop);
      const c1y = a.y + Math.sin(angle - spread * 0.45) * (ra + loop);
      const c2x = a.x + Math.cos(angle + spread * 0.45) * (ra + loop);
      const c2y = a.y + Math.sin(angle + spread * 0.45) * (ra + loop);
      const labelX = a.x + Math.cos(angle) * (ra + loop * 0.78);
      const labelY = a.y + Math.sin(angle) * (ra + loop * 0.78);
      // Tangent at endpoint of cubic Bezier: direction = endpoint - last control point
      const arrowAngle = Math.atan2(ty - c2y, tx - c2x);
      // Tip extends from base along tangent by arrowGap to reach node boundary
      const ac = Math.cos(arrowAngle), as = Math.sin(arrowAngle);
      const tipX = tx + ac * arrowGap, tipY = ty + as * arrowGap;
      return { path:`M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`, labelX, labelY, tx, ty, tipX, tipY, arrowAngle };
    }
    const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy) || 1, ux=dx/len, uy=dy/len;
    const offset = edgeSiblingOffset(e);
    // Keep endpoints attached to node boundaries; separate parallel/reverse edges
    // by bending the curve via its control point rather than shifting endpoints.
    const sx=a.x+ux*(ra+2), sy=a.y+uy*(ra+2);
    // Path ends at arrow base (rb + arrowGap from center); tip will be at node boundary (rb)
    const tx=b.x-ux*(rb + arrowGap), ty=b.y-uy*(rb + arrowGap);
    if(Math.abs(offset) > 1){
      const mx=(sx+tx)/2 - uy*offset, my=(sy+ty)/2 + ux*offset;
      // Tangent at endpoint of quadratic Bezier: direction = endpoint - control point
      const arrowAngle = Math.atan2(ty - my, tx - mx);
      const ac = Math.cos(arrowAngle), as = Math.sin(arrowAngle);
      const tipX = tx + ac * arrowGap, tipY = ty + as * arrowGap;
      return { path:`M ${sx} ${sy} Q ${mx} ${my} ${tx} ${ty}`, labelX:mx, labelY:my, tx, ty, tipX, tipY, arrowAngle };
    }
    const arrowAngle = Math.atan2(uy, ux);
    // For straight edges, tip = b - ux*rb (exactly on node boundary)
    const tipX = b.x - ux*rb, tipY = b.y - uy*rb;
    return { path:`M ${sx} ${sy} L ${tx} ${ty}`, labelX:(sx+tx)/2, labelY:(sy+ty)/2, tx, ty, tipX, tipY, arrowAngle };
  }
  function renderNodes(){
    const showLabels = shouldShowLabels();
    const existing = new Map();
    // Index existing node elements by id, collect for removal
    for(const el of [...nodesLayer.children] as HTMLElement[]){
      if(el.dataset?.id) existing.set(el.dataset.id, el);
    }
    const seen = new Set();
    // Pre-compute visible node IDs once per render — avoids per-node Set lookup
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    const rangeActive = vr.start >= 0 || vr.end >= 0;
    const visIds = rangeActive ? visibleNodeIds() : null;
    for(const n of state.nodes){
      // Skip non-visible nodes entirely — they are removed from DOM, not dimmed.
      // This gives real performance: fewer SVG elements, fewer attribute patches, less paint.
      if(rangeActive && !visIds.has(n.id)) continue;
      seen.add(n.id);
      const selected = isNodeSelected(n.id);
      const v = nodeVisual(n);
      let g = existing.get(n.id);
      if(!g){
        // Create new node group
        g = document.createElementNS(NS,'g'); g.classList.add('node');
        g.id = 'node-' + n.id; g.dataset.id = n.id;
        g.addEventListener('pointerdown', ev => onNodePointerDown(ev, n.id));
        g.addEventListener('dblclick', ev => { ev.stopPropagation(); if(polygonToolActive() && selectDraft?.tool === 'polygon') finishPolygonSelection(false); else editNodeQuick(n.id); });
        nodesLayer.appendChild(g);
      }
      // Update transform (always — this is the hot path during drag)
      g.setAttribute('transform',`translate(${n.x},${n.y})`);
      // Update selection class
      g.classList.toggle('selected', selected);
      g.classList.toggle('dragging', drag?.nodeId === n.id);
      // Update or create shape
      let shape = g.querySelector('.node-shape');
      const w = v.width, h = v.height;
      const needRebuild = !shape || shape.dataset.shape !== v.shape || shape.dataset.w !== String(w) || shape.dataset.h !== String(h);
      if(needRebuild){
        if(shape) shape.remove();
        if(v.shape === 'square'){
          shape = document.createElementNS(NS,'rect'); shape.setAttribute('x',-w/2); shape.setAttribute('y',-h/2); shape.setAttribute('width',w); shape.setAttribute('height',h);
        } else if(v.shape === 'diamond'){
          shape = document.createElementNS(NS,'polygon'); shape.setAttribute('points',`0,${-h/2-2} ${w/2+2},0 0,${h/2+2} ${-w/2-2},0`);
        } else if(v.shape === 'triangleUp'){
          shape = document.createElementNS(NS,'polygon'); shape.setAttribute('points',`0,${-h/2} ${w/2},${h/2} ${-w/2},${h/2}`);
        } else if(v.shape === 'triangleDown'){
          shape = document.createElementNS(NS,'polygon'); shape.setAttribute('points',`0,${h/2} ${w/2},${-h/2} ${-w/2},${-h/2}`);
        } else if(v.shape === 'hexagon'){
          const hx = w/2, hy = h/2, mx = w/4;
          shape = document.createElementNS(NS,'polygon'); shape.setAttribute('points',`${-hx+mx},${-hy} ${hx-mx},${-hy} ${hx},0 ${hx-mx},${hy} ${-hx+mx},${hy} ${-hx},0`);
        } else {
          shape = document.createElementNS(NS,'ellipse'); shape.setAttribute('rx',w/2); shape.setAttribute('ry',h/2);
        }
        shape.setAttribute('class','node-shape');
        shape.dataset.shape = v.shape; shape.dataset.w = w; shape.dataset.h = h;
        g.insertBefore(shape, g.firstChild);
      }
      // Update shape style attributes (cheap, do every frame)
      shape.setAttribute('fill', v.color);
      shape.setAttribute('stroke', v.strokeColor); shape.setAttribute('stroke-width', v.strokeSize);
      const dash = strokeDashArray(v.strokeStyle, v.strokeSize);
      if(dash !== 'none') shape.setAttribute('stroke-dasharray', dash);
      else shape.removeAttribute('stroke-dasharray');
      // Update label
      let label = g.querySelector('text');
      const wantLabel = showLabels && n.label;
      if(wantLabel){
        if(!label){
          label = document.createElementNS(NS,'text');
          label.setAttribute('paint-order','stroke');
          label.setAttribute('stroke','#020617');
          label.setAttribute('stroke-linejoin','round');
          g.appendChild(label);
        }
        label.setAttribute('text-anchor','middle');
        label.setAttribute('dominant-baseline','middle');
        label.setAttribute('fill', v.labelColor);
        label.setAttribute('font-size', v.labelSize);
        label.setAttribute('font-family', v.labelFont);
        label.setAttribute('stroke-width', Math.max(3, v.labelSize * 0.32));
        let lx = 0, ly = 0;
        const offset = Math.max(w, h)/2 + v.labelSize * 0.7;
        if(v.labelPosition === 'top'){ ly = -offset; label.setAttribute('dominant-baseline','auto'); }
        else if(v.labelPosition === 'bottom'){ ly = offset; label.setAttribute('dominant-baseline','hanging'); }
        else if(v.labelPosition === 'left'){ lx = -offset; label.setAttribute('text-anchor','end'); }
        else if(v.labelPosition === 'right'){ lx = offset; label.setAttribute('text-anchor','start'); }
        label.setAttribute('x', lx); label.setAttribute('y', ly);
        if(label.textContent !== n.label) label.textContent = n.label;
      } else if(label){
        label.remove();
      }
    }
    // Remove stale elements
    for(const [id, el] of existing){ if(!seen.has(id)) el.remove(); }
  }
