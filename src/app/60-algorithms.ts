  function adjacency(directedMode=true){
    const adj = new Map(state.nodes.map(n => [n.id, []]));
    for(const e of state.edges){
      if(!adj.has(e.from) || !adj.has(e.to)) continue;
      const w = (e.weight === '' || e.weight == null) ? 1 : Number(e.weight); const wt = Number.isFinite(w) ? w : 1;
      adj.get(e.from).push({to:e.to, weight:wt, edge:e});
      if(edgeIsUndirected(e) || edgeDirection(e)==='mutual' || !directedMode) adj.get(e.to).push({to:e.from, weight:wt, edge:e});
    }
    for(const arr of adj.values()) arr.sort((a,b) => (nodeById(a.to)?.label || a.to).localeCompare(nodeById(b.to)?.label || b.to));
    return adj;
  }
  function startId(){ return $('#algoStart').value || state.nodes[0]?.id || ''; }
  function runBfs(){ const start=startId(); if(!start) return out(I18N.t('no_start_node')); const adj=adjacency(true), seen=new Set([start]), q=[start], order=[]; while(q.length){ const v=q.shift(); order.push(v); for(const nb of adj.get(v)||[]) if(!seen.has(nb.to)){seen.add(nb.to); q.push(nb.to);} } out(I18N.t('bfs_order') + '\n' + order.map(labelOf).join(' → ')); }
  function runDfs(){ const start=startId(); if(!start) return out(I18N.t('no_start_node')); const adj=adjacency(true), seen=new Set(), order=[]; (function dfs(v){ seen.add(v); order.push(v); for(const nb of adj.get(v)||[]) if(!seen.has(nb.to)) dfs(nb.to); })(start); out(I18N.t('dfs_order') + '\n' + order.map(labelOf).join(' → ')); }
  function runDijkstra(){
    const start=startId(); if(!start) return out(I18N.t('no_start_node')); const adj=adjacency(true), dist=new Map(state.nodes.map(n => [n.id, Infinity])), prev=new Map(); dist.set(start,0); const unvisited=new Set(state.nodes.map(n=>n.id));
    while(unvisited.size){ let u=null,best=Infinity; for(const id of unvisited){ if(dist.get(id)<best){best=dist.get(id);u=id;} } if(u===null) break; unvisited.delete(u); for(const nb of adj.get(u)||[]){ const alt=dist.get(u)+Math.max(0,nb.weight); if(alt<dist.get(nb.to)){ dist.set(nb.to,alt); prev.set(nb.to,u); } } }
    const rows = state.nodes.map(n => `${(n.label || n.id).padEnd(12)} ${dist.get(n.id)===Infinity?'∞':dist.get(n.id)}`).join('\n'); out(I18N.t('dijkstra_from', {name: labelOf(start)}) + '\n' + rows);
  }
  function runComponents(){
    const adj=adjacency(false), seen=new Set(), comps=[];
    for(const n of state.nodes){ if(seen.has(n.id)) continue; const comp=[], stack=[n.id]; seen.add(n.id); while(stack.length){ const v=stack.pop(); comp.push(v); for(const nb of adj.get(v)||[]) if(!seen.has(nb.to)){seen.add(nb.to); stack.push(nb.to);} } comps.push(comp); }
    out(I18N.t('components_n', {n: comps.length}) + '\n' + comps.map((c,i)=>`${i+1}. ${c.map(labelOf).join(', ')}`).join('\n'));
  }
  function runTopo(){
    const adj=adjacency(true), indeg=new Map(state.nodes.map(n=>[n.id,0]));
    for(const e of state.edges){
      if(edgeIsUndirected(e)) return out(I18N.t('topo_undirected'));
      if(edgeDirection(e) === 'mutual'){
        if(indeg.has(e.to)) indeg.set(e.to, indeg.get(e.to)+1);
        if(indeg.has(e.from)) indeg.set(e.from, indeg.get(e.from)+1);
      } else {
        if(indeg.has(e.to)) indeg.set(e.to, indeg.get(e.to)+1);
      }
    }
    const q=state.nodes.filter(n=>indeg.get(n.id)===0).map(n=>n.id), order=[];
    while(q.length){ const v=q.shift(); order.push(v); for(const nb of adj.get(v)||[]){ indeg.set(nb.to, indeg.get(nb.to)-1); if(indeg.get(nb.to)===0) q.push(nb.to); } }
    if(order.length !== state.nodes.length) out(I18N.t('topo_cycle')); else out(I18N.t('topo_order') + '\n' + order.map(labelOf).join(' → '));
  }
  function runStats(){ out(graphStats()); }
  function graphStats(){
    const directed=state.edges.filter(e=>edgeDirection(e)==='directed').length, mutual=state.edges.filter(e=>edgeDirection(e)==='mutual').length, undirected=state.edges.filter(e=>edgeIsUndirected(e)).length;
    const deg = new Map(state.nodes.map(n=>[n.id,{in:0,out:0,total:0}]));
    for(const e of state.edges){ const a=deg.get(e.from), b=deg.get(e.to); if(!a||!b) continue; a.out++; b.in++; a.total++; b.total++; if(edgeIsUndirected(e) || edgeDirection(e)==='mutual'){ a.in++; b.out++; } }
    const maxDeg = [...deg.entries()].sort((a,b)=>b[1].total-a[1].total)[0];
    return I18N.t('graph_statistics') + '\n' + I18N.t('nodes_label') + ' ' + state.nodes.length + '\n' + I18N.t('edges_label') + ' ' + state.edges.length + ' (' + directed + ' ' + (I18N.current==='ru'?'направленных':'directed') + ', ' + mutual + ' ' + I18N.t('mutual') + ', ' + undirected + ' ' + (I18N.current==='ru'?'ненаправленных':'undirected') + ')\n' + I18N.t('density') + ' ' + density() + '\n' + I18N.t('highest_degree') + ' ' + (maxDeg ? labelOf(maxDeg[0]) + ' (' + maxDeg[1].total + ')' : I18N.t('na'));
  }
  function density(){ const n=state.nodes.length; if(n<2) return '0'; return (state.edges.length / (n*(n-1))).toFixed(3); }
  function labelOf(id){ return nodeById(id)?.label || id; }
  function out(text){ $('#algoOutput').textContent = text; }

  function layoutCircle(){
    const n=state.nodes.length; if(!n) return; const radius=Math.max(120, n*22), cx=0, cy=0;
    state.nodes.forEach((node,i)=>{ const a=-Math.PI/2 + i*2*Math.PI/n; node.x=cx+Math.cos(a)*radius; node.y=cy+Math.sin(a)*radius; });
    pushHistory('circle layout'); fitView(); queueRender(true);
  }
  function layoutGrid(){
    const n=state.nodes.length; if(!n) return; const cols=Math.ceil(Math.sqrt(n)), gap=110;
    state.nodes.forEach((node,i)=>{ node.x=(i%cols-(cols-1)/2)*gap; node.y=(Math.floor(i/cols)-Math.floor((n-1)/cols)/2)*gap; });
    pushHistory('grid layout'); fitView(); queueRender(true);
  }
  function layoutForce(requestedIter=180){
    const n=state.nodes.length; if(n < 2) return;
    // Repulsion is all-pairs, so cost is O(iter · n²): 600 nodes took ~1.9 s and
    // the 3000-node import cap would freeze the tab for ~45 s. Budget the pair
    // work instead so one click always finishes in roughly a second; large
    // graphs get fewer refinement passes rather than an unresponsive page.
    const pairs = n * (n - 1) / 2;
    const iter = Math.max(5, Math.min(requestedIter, Math.floor(FORCE_LAYOUT_PAIR_BUDGET / Math.max(1, pairs))));
    const reduced = iter < requestedIter;
    const area=Math.max(700*500, n*22000), k=Math.sqrt(area/n);
    for(let step=0; step<iter; step++){
      const disp = new Map(state.nodes.map(v=>[v.id,{x:0,y:0}]));
      for(let i=0;i<n;i++) for(let j=i+1;j<n;j++){
        const v=state.nodes[i], u=state.nodes[j]; let dx=v.x-u.x, dy=v.y-u.y, d=Math.hypot(dx,dy)||.01; const f=(k*k)/d; dx/=d; dy/=d; disp.get(v.id).x += dx*f; disp.get(v.id).y += dy*f; disp.get(u.id).x -= dx*f; disp.get(u.id).y -= dy*f;
      }
      for(const e of state.edges){ const v=nodeById(e.from), u=nodeById(e.to); if(!v||!u) continue; let dx=v.x-u.x, dy=v.y-u.y, d=Math.hypot(dx,dy)||.01; const f=(d*d)/k; dx/=d; dy/=d; disp.get(v.id).x -= dx*f; disp.get(v.id).y -= dy*f; disp.get(u.id).x += dx*f; disp.get(u.id).y += dy*f; }
      const temp = 80 * (1 - step/iter);
      for(const v of state.nodes){ const d=disp.get(v.id); const len=Math.hypot(d.x,d.y)||.01; v.x += (d.x/len)*Math.min(len,temp); v.y += (d.y/len)*Math.min(len,temp); }
    }
    pushHistory('relax layout'); fitView(); queueRender(true);
    if(reduced) toast(I18N.t('layout_force_reduced', {iter, n}));
  }
  async function addSample(){
    if(state.nodes.length && !await uiConfirm(I18N.t('replace_with_sample'), {danger: true})) return;
    state.nodes = [
      {id:'n1',label:'A',x:-220,y:-120,shape:'circle',color:'#0ea5e9'}, {id:'n2',label:'B',x:0,y:-170,shape:'circle',color:'#8b5cf6'},
      {id:'n3',label:'C',x:230,y:-80,shape:'hexagon',color:'#06b6d4'}, {id:'n4',label:'D',x:-110,y:110,shape:'square',color:'#10b981'},
      {id:'n5',label:'E',x:150,y:140,shape:'diamond',color:'#f59e0b'},
      {id:'n6',label:'F',x:-280,y:60,shape:'triangleUp',color:'#ec4899'}, {id:'n7',label:'G',x:300,y:120,shape:'triangleDown',color:'#84cc16'}
    ];
    state.edges = [
      {id:'e1',from:'n1',to:'n2',weight:'4',label:'',directed:true}, {id:'e2',from:'n1',to:'n4',weight:'2',label:'',directed:true},
      {id:'e3',from:'n2',to:'n3',weight:'3',label:'',directed:true}, {id:'e4',from:'n4',to:'n5',weight:'1',label:'',directed:false},
      {id:'e5',from:'n5',to:'n3',weight:'5',label:'',directed:true}, {id:'e6',from:'n6',to:'n1',weight:'2',label:'',directed:true},
      {id:'e7',from:'n3',to:'n7',weight:'3',label:'',directed:true}
    ];
    state.nextNode = 8; state.nextEdge = 8; state.selected = null; state.selection = {nodes: [], edges: []}; pushHistory('sample'); fitView(); queueRender(true, true); toast(I18N.t('sample_loaded'));
  }

  function persistAutosavePreference(enabled: boolean){
    try { localStorage.setItem(AUTOSAVE_PREF_KEY, enabled ? 'true' : 'false'); } catch {}
  }
  // Autosave failures used to be swallowed, so a full quota looked exactly like
  // a working save while every subsequent edit was lost. Report it once.
  let autosaveFailureReported = false;
  function writeAutosave(){
    try {
      localStorage.setItem(STORAGE_KEY, snapshot());
      autosaveFailureReported = false;
      return true;
    } catch {
      if(!autosaveFailureReported){
        autosaveFailureReported = true;
        toast(I18N.t('autosave_failed'));
      }
      return false;
    }
  }
  function saveSoon(){
    clearTimeout(saveTimer);
    if(!state.settings.autosave) return;
    saveTimer = setTimeout(() => { saveTimer = null; writeAutosave(); }, 250);
  }
  // Flush a pending debounced write when the page goes away; otherwise the last
  // 250 ms of edits are lost by closing the tab right after a change.
  function flushAutosave(){
    if(!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    if(state.settings.autosave) writeAutosave();
  }
  function loadSaved(){
    try{
      const preference = localStorage.getItem(AUTOSAVE_PREF_KEY);
      // An explicit opt-out must be honored before reading an older graph
      // snapshot; otherwise turning autosave off appears to do nothing after
      // the next reload.
      if(preference === 'false'){
        state.settings.autosave = false;
        return;
      }
      const saved = localStorage.getItem(STORAGE_KEY);
      if(saved){
        const parsed = JSON.parse(saved);
        migrateLegacyGizmoPreferences(parsed);
        state = {...state, ...sanitizeState(parsed), selected:null};
      }
      if(preference === 'true') state.settings.autosave = true;
    }catch{}
  }
  function toast(message){
    const stack = $('#toastStack');
    while(stack.children.length >= 4) stack.firstElementChild?.remove();
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0'; el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 180);
    }, 2300);
  }
  async function copyText(text){
    try{ await navigator.clipboard.writeText(text); toast(I18N.t('copied')); return; }
    catch{ /* fall through to the legacy path */ }
    // The Clipboard API is refused outright in a sandboxed iframe or under a
    // restrictive permissions policy, which is exactly when the fallback runs —
    // and execCommand is deprecated, so it may not exist at all. Calling it
    // unguarded threw an uncaught TypeError out of the handler, and the toast
    // said "Copied" regardless, so the user was told a copy had happened when
    // nothing was on the clipboard. Now the legacy path is guarded and the
    // message reflects the result.
    let copied = false;
    const ta = document.createElement('textarea');
    try{
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      copied = typeof document.execCommand === 'function' && document.execCommand('copy') === true;
    } catch { copied = false; }
    finally { ta.remove(); }
    toast(copied ? I18N.t('copied') : I18N.t('copy_failed'));
  }

  // === Copy-to-clipboard for every export format ===
  function copyJson(){ copyText(exportJsonText()); }
  function copyDot(){ copyText(exportDotText()); }
  function copyGraphml(){ copyText(exportGraphmlText()); }
  function copyEdgeCsv(){ copyText(edgeCsv().replace(/^\ufeff/,'')); }
  function copyMatrixCsv(){ copyText(matrixCsv().replace(/^\ufeff/,'')); }
  function copyNodesCsv(){ copyText(nodeCsv().replace(/^\ufeff/,'')); }

  // === Blender-style drag-to-change number ===
  // Wraps a numeric input in a .drag-number-wrap and adds a ⇆ handle that,
  // when dragged horizontally, changes the input value. Shift = fine mode.
