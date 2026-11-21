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
  // Yielding an already-running task keeps pending input ahead of the next
  // batch of force-layout passes. Safari has no scheduler.yield() yet, so a
  // setTimeout fallback is part of the contract, not an optional extra.
  const yieldToBrowser = (): Promise<void> => {
    const scheduler = (window as any).scheduler;
    if(scheduler && typeof scheduler.yield === 'function') return scheduler.yield();
    return new Promise(resolve => setTimeout(resolve, 0));
  };
  let forceLayoutRunning = false;
  async function layoutForce(requestedIter=180){
    const nodes = state.nodes, n = nodes.length;
    if(forceLayoutRunning || n < 2 || hasActiveCanvasGesture()) return;
    flushPendingHistory();
    const startRev = documentRev;
    const interrupted = () => documentRev !== startRev || hasActiveCanvasGesture();
    forceLayoutRunning = true;
    try {
      // A yield must expose neither partial geometry nor a history entry. Keep
      // all solve inputs private (including endpoints) until the commit.
      const points = nodes.map(node => ({node, id:node.id, x:node.x, y:node.y,
        startX:node.x, startY:node.y, dx:0, dy:0}));
      const byId = new Map(points.map(p => [p.id, p]));
      const links = state.edges.map(e => ({id:e.id, from:e.from, to:e.to, v:byId.get(e.from), u:byId.get(e.to)}));
      const pairs = n * (n - 1) / 2;
      const iter = Math.max(5, Math.min(requestedIter, Math.floor(FORCE_LAYOUT_PAIR_BUDGET / Math.max(1, pairs))));
      const reduced = iter < requestedIter;
      const area=Math.max(700*500, n*22000), k=Math.sqrt(area/n);
      let deadline = performance.now() + 50;
      for(let step=0; step<iter; step++){
        for(let i=0; i<n; i++){
          const v = points[i];
          for(let j=i+1; j<n; j++){
            const u=points[j], dx=v.x-u.x, dy=v.y-u.y, d=Math.hypot(dx,dy)||.01;
            const f=(k*k)/d, fx=(dx/d)*f, fy=(dy/d)*f;
            v.dx += fx; v.dy += fy; u.dx -= fx; u.dy -= fy;
          }
          // One all-pairs pass at the import cap can itself take hundreds of
          // milliseconds. Check once per row, not once per pair or per pass.
          if(performance.now() >= deadline){
            await yieldToBrowser();
            if(interrupted()) return;
            deadline = performance.now() + 50;
          }
        }
        for(const {v,u} of links){
          if(!v || !u) continue;
          const dx=v.x-u.x, dy=v.y-u.y, d=Math.hypot(dx,dy)||.01;
          const f=(d*d)/k, fx=(dx/d)*f, fy=(dy/d)*f;
          v.dx -= fx; v.dy -= fy; u.dx += fx; u.dy += fy;
        }
        const temp = 80 * (1 - step/iter);
        for(const v of points){
          const len=Math.hypot(v.dx,v.dy)||.01;
          v.x += (v.dx/len)*Math.min(len,temp); v.y += (v.dy/len)*Math.min(len,temp);
          v.dx = v.dy = 0;
        }
      }
      // Validate *all* targets before the first write, including live geometry
      // that might not have reached an undo snapshot yet.
      if(interrupted() || state.nodes !== nodes || nodes.length !== n || state.edges.length !== links.length
        || points.some((p,i) => nodes[i] !== p.node || p.node.id !== p.id || p.node.x !== p.startX || p.node.y !== p.startY)
        || links.some((l,i) => { const e=state.edges[i]; return e.id !== l.id || e.from !== l.from || e.to !== l.to; })) return;
      for(const p of points){ p.node.x = p.x; p.node.y = p.y; }
      // Only geometry changed. Replacing the matrix/edge-list inputs here
      // would discard any draft the user started while the solve was yielding.
      pushHistory('relax layout'); fitView(); queueRender(false);
      if(reduced) toast(I18N.t('layout_force_reduced', {iter, n}));
    } finally {
      forceLayoutRunning = false;
    }
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
  const TOAST_LIMIT = 4;
  const toastActivity = new WeakMap<Element, {hovered:boolean; timer:number}>();
  function toast(message){
    const stack: HTMLElement = $('#toastStack');
    const removeToast = (node: Element) => {
      window.clearTimeout(toastActivity.get(node)?.timer);
      node.remove();
    };
    // Oldest idle message first. If all are in use, deliver the new message
    // anyway; releasing a held toast below will bring the stack back to four.
    for(const node of Array.from(stack.children)){
      if(stack.childElementCount < TOAST_LIMIT) break;
      if(!toastActivity.get(node)?.hovered && !node.contains(document.activeElement)) removeToast(node);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    const text = document.createElement('span');
    text.textContent = message;
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'toast-close';
    close.setAttribute('aria-label', I18N.t('toast_close'));
    close.textContent = '\u00d7';
    el.append(text, close);
    const activity = {hovered:false, timer:0};
    toastActivity.set(el, activity);
    let dismissedByUser = false;
    const pause = () => {
      if(dismissedByUser) return;
      window.clearTimeout(activity.timer);
      // Interaction can also begin during the short auto-dismiss transition.
      el.style.opacity = ''; el.style.transform = '';
    };
    const dismiss = () => {
      window.clearTimeout(activity.timer);
      el.style.opacity = '0'; el.style.transform = 'translateY(6px)';
      activity.timer = window.setTimeout(() => el.remove(), 180);
    };
    const arm = () => {
      window.clearTimeout(activity.timer);
      activity.timer = window.setTimeout(dismiss, 2300);
    };
    const resumeIfIdle = (focus: EventTarget | null) => {
      if(dismissedByUser || activity.hovered || (focus instanceof Node && el.contains(focus))) return;
      if(stack.childElementCount > TOAST_LIMIT) removeToast(el);
      else arm();
    };
    el.addEventListener('pointerenter', () => { activity.hovered = true; pause(); });
    el.addEventListener('focusin', pause);
    el.addEventListener('pointerleave', () => { activity.hovered = false; resumeIfIdle(document.activeElement); });
    el.addEventListener('focusout', ev => resumeIfIdle(ev.relatedTarget));
    close.addEventListener('click', () => { dismissedByUser = true; dismiss(); });
    stack.appendChild(el);
    arm();
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
