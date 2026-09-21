import { JSDOM, VirtualConsole } from 'jsdom';
import { readFile } from 'node:fs/promises';

async function loadApp(htmlPath, graph){
  const htmlRaw = await readFile(htmlPath,'utf8');
  // Inject saved graph via <script> tag before app script, like tests do
  const injected = `<script>localStorage.setItem('graph-editor-pro-v2', ${JSON.stringify(JSON.stringify(graph))});</script>`;
  const html = htmlRaw.replace('<script>', `${injected}<script>`);
  const vc = new VirtualConsole();
  vc.on('jsdomError', ()=>{});
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    url: "http://localhost/",
    virtualConsole: vc,
    beforeParse(window){
      window.matchMedia = query => ({
        matches: false,
        media: query,
        addEventListener(){},
        removeEventListener(){},
        addListener(){},
        removeListener(){},
      });
      window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.alert = ()=>{};
      window.confirm = ()=>true;
    }
  });
  const win = dom.window;
  await new Promise(res=>{
    if(win.document.readyState==='complete') res();
    else win.addEventListener('load', res);
  });
  // Mock canvas rect so camera can compute
  const svg = win.document.querySelector('#graphCanvas');
  if(svg){
    svg.getBoundingClientRect = () => ({ x:0,y:0,left:0,top:0,width:1000,height:660,right:1000,bottom:660, toJSON(){return this;} });
  }
  await new Promise(r=>setTimeout(r, 1200));
  return dom;
}

function makeCompleteGraph(n){
  const nodes=[];
  const cols=Math.ceil(Math.sqrt(n*1.6));
  const spacing=130;
  for(let i=0;i<n;i++) nodes.push({id:`n${i}`, label:`N${i}`, x:(i%cols-cols/2)*spacing, y:(Math.floor(i/cols)-Math.sqrt(n)/2)*spacing, order:i});
  const edges=[];
  let eid=0;
  for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) edges.push({id:`e${eid++}`, from:`n${i}`, to:`n${j}`, directed:true, weight:'1'});
  return {
    title:`bench-${n}`, mode:'select', nextNode:n+1, nextEdge:edges.length+1,
    nodes, edges,
    viewBox:{x:-1000,y:-1000,w:2000,h:2000},
    settings:{
      nodeShape:'circle', nodeColor:'#0ea5e9', nodeWidth:50, nodeHeight:50,
      nodeStrokeColor:'#e2e8f0', nodeStrokeSize:2.2, nodeStrokeStyle:'solid',
      nodeType:'', nodeLabelColor:'#f8fafc', nodeLabelFont:'Inter', nodeLabelSize:13, nodeLabelPosition:'center',
      directed:true, edgeWeight:'1', edgeLabel:'', edgeType:'', edgeColor:'#94a3b8', edgeStrokeSize:2.4, edgeStrokeStyle:'solid',
      edgeLabelColor:'#dbeafe', edgeLabelFont:'Inter', edgeLabelSize:12,
      snap:false, snapX:false, snapY:false, gridSize:40, gridSizeX:40, gridSizeY:40,
      autosave:false, matrixLimit:90, edgeListPageSize:250, matrixDimension:0, brushDiameter:80,
      hitTestMode:'any', inheritDefaults:true, noLabel:false,
      visibleRange:{start:-1,end:-1},
      canvasBgColor:'#020617', gridMinorColor:'#94a3b8', gridMajorColor:'#94a3b8', gridMinorAlpha:0.105, gridMajorAlpha:0.16,
      graphDefaults:{labelsPolicy:'auto', labelOutline:'outline', labelOutlineColor:'#020617', labelOutlineWidth:4, edgeWeightMode:'number', edgeWeightMin:1, edgeWeightMax:10, edgeWeightCorr:'linear', edgeWidthMin:1, edgeWidthMax:8, edgeWeightColorLow:'#22d3ee', edgeWeightColorHigh:'#f59e0b'},
      nodeDefaults:{type:'', color:'#0ea5e9', labelColor:'#f8fafc', labelFont:'Inter', labelSize:13, labelPosition:'center', shape:'circle', width:50, height:50, strokeColor:'#e2e8f0', strokeSize:2.2, strokeStyle:'solid'},
      edgeDefaults:{type:'', color:'#94a3b8', labelColor:'#dbeafe', labelFont:'Inter', labelSize:12, strokeSize:2.4, strokeStyle:'solid'},
      nodeTypeStyles:{}, edgeTypeStyles:{}, stylePresets:[]
    },
    selected:null, selection:{nodes:[], edges:[]}
  };
}

async function bench(buildPath, n){
  const graph = makeCompleteGraph(n);
  const t0 = performance.now();
  const dom = await loadApp(buildPath, graph);
  const t1 = performance.now();
  const win = dom.window;
  const doc = win.document;
  const sceneElements = doc.querySelectorAll('#sceneLayer *').length;
  const nodesRendered = doc.querySelectorAll('[id^=\"node-\"]').length;
  const edgesRendered = doc.querySelectorAll('[id^=\"edge-\"]').length;
  // Measure a second render pass by calling queueRender if exposed? The app is IIFE but we can trigger via state mutation?
  // Instead measure visibleNodes sorting cost by calling the function if exposed? Not exposed.
  // We'll approximate by measuring time for a forced re-render via dispatching a custom event that triggers renderCanvas? 
  // Simpler: measure time for visibleNodes() if we can access via window? Not exposed.
  // We'll just report load time and DOM counts.
  dom.window.close();
  return { n, edges: graph.edges.length, sceneElements, nodesRendered, edgesRendered, loadMs: Math.round(t1-t0) };
}

const builds = [
  {name:'main', path:'/tmp/gep-main/index.html'},
  {name:'fixed', path:'/tmp/gep-fixed/index.html'},
];

for(const size of [50,100,200]){
  console.log(`\n=== Complete graph ${size} nodes ===`);
  for(const b of builds){
    const r = await bench(b.path, size);
    console.log(`${b.name.padEnd(6)} ${r.n}n ${r.edges}e -> DOM ${r.sceneElements} elements (nodes ${r.nodesRendered} edges ${r.edgesRendered}) load ${r.loadMs}ms`);
  }
}

// Also bench sparse grid like perf-bench does
function makeGridGraph(nodeCount){
  const nodes=[], edges=[];
  const cols=Math.ceil(Math.sqrt(nodeCount*1.6));
  const spacing=130;
  for(let i=0;i<nodeCount;i++) nodes.push({id:`n${i}`, label:`N${i}`, x:(i%cols-cols/2)*spacing, y:(Math.floor(i/cols)-Math.sqrt(nodeCount)/2)*spacing, order:i});
  let eid=0;
  const add=(f,t,d)=>edges.push({id:`e${eid++}`, from:`n${f}`, to:`n${t}`, directed:d, weight:'1'});
  for(let i=0;i<nodeCount;i++){
    if(i+1<nodeCount && (i+1)%cols!==0) add(i,i+1,true);
    if(i+cols<nodeCount) add(i,i+cols,true);
    if(i+2<nodeCount && (i+2)%cols!==0) add(i,i+2,false);
  }
  return {
    title:`bench-${nodeCount}`, mode:'select', nextNode:nodeCount+1, nextEdge:edges.length+1,
    nodes, edges,
    viewBox:{x:-1000,y:-1000,w:2000,h:2000},
    settings:{
      nodeShape:'circle', nodeColor:'#0ea5e9', nodeWidth:50, nodeHeight:50,
      nodeStrokeColor:'#e2e8f0', nodeStrokeSize:2.2, nodeStrokeStyle:'solid',
      nodeType:'', nodeLabelColor:'#f8fafc', nodeLabelFont:'Inter', nodeLabelSize:13, nodeLabelPosition:'center',
      directed:true, edgeWeight:'1', edgeLabel:'', edgeType:'', edgeColor:'#94a3b8', edgeStrokeSize:2.4, edgeStrokeStyle:'solid',
      edgeLabelColor:'#dbeafe', edgeLabelFont:'Inter', edgeLabelSize:12,
      snap:false, snapX:false, snapY:false, gridSize:40, gridSizeX:40, gridSizeY:40,
      autosave:false, matrixLimit:90, edgeListPageSize:250, matrixDimension:0, brushDiameter:80,
      hitTestMode:'any', inheritDefaults:true, noLabel:false,
      visibleRange:{start:-1,end:-1},
      canvasBgColor:'#020617', gridMinorColor:'#94a3b8', gridMajorColor:'#94a3b8', gridMinorAlpha:0.105, gridMajorAlpha:0.16,
      graphDefaults:{labelsPolicy:'auto', labelOutline:'outline', labelOutlineColor:'#020617', labelOutlineWidth:4, edgeWeightMode:'number', edgeWeightMin:1, edgeWeightMax:10, edgeWeightCorr:'linear', edgeWidthMin:1, edgeWidthMax:8, edgeWeightColorLow:'#22d3ee', edgeWeightColorHigh:'#f59e0b'},
      nodeDefaults:{type:'', color:'#0ea5e9', labelColor:'#f8fafc', labelFont:'Inter', labelSize:13, labelPosition:'center', shape:'circle', width:50, height:50, strokeColor:'#e2e8f0', strokeSize:2.2, strokeStyle:'solid'},
      edgeDefaults:{type:'', color:'#94a3b8', labelColor:'#dbeafe', labelFont:'Inter', labelSize:12, strokeSize:2.4, strokeStyle:'solid'},
      nodeTypeStyles:{}, edgeTypeStyles:{}, stylePresets:[]
    },
    selected:null, selection:{nodes:[], edges:[]}
  };
}

async function benchGrid(buildPath, n){
  const graph = makeGridGraph(n);
  const t0 = performance.now();
  const dom = await loadApp(buildPath, graph);
  const t1 = performance.now();
  const doc = dom.window.document;
  const sceneElements = doc.querySelectorAll('#sceneLayer *').length;
  dom.window.close();
  return { n, edges: graph.edges.length, sceneElements, loadMs: Math.round(t1-t0) };
}

for(const size of [100,500,1500]){
  console.log(`\n=== Grid graph ${size} nodes ===`);
  for(const b of builds){
    const r = await benchGrid(b.path, size);
    console.log(`${b.name.padEnd(6)} ${r.n}n ${r.edges}e -> DOM ${r.sceneElements} elements load ${r.loadMs}ms`);
  }
}
