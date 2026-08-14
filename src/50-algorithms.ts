  function adjacency(directedMode=true){
    const adj = new Map(state.nodes.map(n => [n.id, []]));
    for(const e of state.edges){
      if(!adj.has(e.from) || !adj.has(e.to)) continue;
      const w = (e.weight === '' || e.weight == null) ? 1 : Number(e.weight); const wt = Number.isFinite(w) ? w : 1;
      adj.get(e.from).push({to:e.to, weight:wt, edge:e});
      if(!e.directed || !directedMode) adj.get(e.to).push({to:e.from, weight:wt, edge:e});
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
    for(const e of state.edges){ if(e.directed && indeg.has(e.to)) indeg.set(e.to, indeg.get(e.to)+1); if(!e.directed) return out(I18N.t('topo_undirected')); }
    const q=state.nodes.filter(n=>indeg.get(n.id)===0).map(n=>n.id), order=[];
    while(q.length){ const v=q.shift(); order.push(v); for(const nb of adj.get(v)||[]){ indeg.set(nb.to, indeg.get(nb.to)-1); if(indeg.get(nb.to)===0) q.push(nb.to); } }
    if(order.length !== state.nodes.length) out(I18N.t('topo_cycle')); else out(I18N.t('topo_order') + '\n' + order.map(labelOf).join(' → '));
  }
  function runStats(){ out(graphStats()); }
  function graphStats(){
    const directed=state.edges.filter(e=>e.directed).length, undirected=state.edges.length-directed;
    const deg = new Map(state.nodes.map(n=>[n.id,{in:0,out:0,total:0}]));
    for(const e of state.edges){ const a=deg.get(e.from), b=deg.get(e.to); if(!a||!b) continue; a.out++; b.in++; a.total++; b.total++; if(!e.directed){ a.in++; b.out++; } }
    const maxDeg = [...deg.entries()].sort((a,b)=>b[1].total-a[1].total)[0];
    return I18N.t('graph_statistics') + '\n' + I18N.t('nodes_label') + ' ' + state.nodes.length + '\n' + I18N.t('edges_label') + ' ' + state.edges.length + ' (' + directed + ' ' + (I18N.current==='ru'?'направленных':'directed') + ', ' + undirected + ' ' + (I18N.current==='ru'?'ненаправленных':'undirected') + ')\n' + I18N.t('density') + ' ' + density() + '\n' + I18N.t('highest_degree') + ' ' + (maxDeg ? labelOf(maxDeg[0]) + ' (' + maxDeg[1].total + ')' : I18N.t('na'));
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
  function layoutForce(iter=180){
    const n=state.nodes.length; if(n < 2) return; const area=Math.max(700*500, n*22000), k=Math.sqrt(area/n);
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
  }
  function addSample(){
    if(state.nodes.length && !confirm(I18N.t('replace_with_sample'))) return;
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

