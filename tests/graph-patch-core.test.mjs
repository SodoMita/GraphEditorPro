// Unit tests for the DOM-free graph change core. This file transpiles the
// TypeScript source directly and evaluates it in Node: no index.html, no DOM,
// no clipboard. That is the boundary a future server transport can reuse too.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { GraphPatchCore as core } from '../dist/core/graph-patch.js';

const outputText = await readFile('dist/core/graph-patch.js', 'utf8');

const graph = () => ({
  title: 'server-ready',
  customAttributes: [{id:'p1',scope:'node',type:'string'}, {id:'p2',scope:'node',type:'string'}],
  nodes: [{ id: 'a', label: 'Old', x: -200, y: 0, order: 0, custom: { p1: 'old', p2: 'keep' } }],
  edges: [{ id: 'e1', from: 'a', to: 'a', label: 'link', weight: 'keep' }],
  nextNode: 2,
  nextEdge: 2,
});

test('the core has no DOM or transport dependency', () => {
  assert.doesNotMatch(outputText.replace(/\/\/[^\n]*/g, ''), /\b(document|navigator|localStorage|window)\b/);
  assert.equal(typeof core.applyExactPatch, 'function');
  assert.equal(typeof core.applyServerChange, 'function');
});

test('mergeCarried changes only carried fields and merges custom values per key', () => {
  const target = graph().nodes[0];
  const changed = core.mergeCarried(target, { label: 'New', custom: { p1: 'new' } });
  assert.equal(changed, true);
  assert.equal(target.label, 'New');
  assert.equal(target.x, -200, 'an omitted coordinate is preserved');
  assert.equal(target.order, 0, 'order is preserved on an existing entity');
  assert.equal(target.custom.p1, 'new');
  assert.equal(target.custom.p2, 'keep', 'an unrelated custom value survives');
  assert.equal(core.mergeCarried(target, { label: 'New' }), false);
});

test('applyExactPatch reuses ids and creates new entities at carried coordinates', () => {
  const target = graph();
  const result = core.applyExactPatch(target, {
    nodes: [
      { id: 'a', label: 'Updated', x: -200, y: 0, custom: { p1: 'changed' } },
      { id: 'n2', label: 'New', x: 120, y: -40, order: 4 },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'n2', label: 'link*' }],
  }, { maxNodes: 3000, maxEdges: 8000 });

  assert.equal(result.changed, true);
  assert.deepEqual(result.pastedNodeIds, ['a', 'n2']);
  assert.deepEqual(result.pastedEdgeIds, ['e1']);
  assert.equal(target.nodes.length, 2);
  assert.equal(target.nodes[0].custom.p1, 'changed');
  assert.equal(target.nodes[0].custom.p2, 'keep');
  assert.equal(target.nodes[1].x, 120);
  assert.equal(target.nodes[1].y, -40);
  assert.equal(target.nodes[1].order, 4);
  assert.equal(target.edges[0].to, 'n2');
  assert.equal(target.edges[0].weight, 'keep');
  assert.equal(target.nextNode, 3);
  assert.equal(target.nextEdge, 2, 'an existing edge id does not advance the counter');
});

test('applyExactPatch keeps caps, edge fate and duplicate ids deterministic', () => {
  const target = graph();
  const result = core.applyExactPatch(target, {
    nodes: [
      { id: 'n2', label: 'Kept', x: 0, y: 0, order: 1 },
      { id: 'n2', label: 'Duplicate', x: 10, y: 10, order: 2 },
      { id: 'n3', label: 'Over cap', x: 20, y: 20, order: 3 },
    ],
    edges: [
      { id: 'e2', from: 'n3', to: 'a', label: 'dropped endpoint' },
      { id: 'e3', from: 'n2', to: 'a', label: 'kept' },
    ],
  }, { maxNodes: 2, maxEdges: 8000 });

  assert.equal(result.droppedNodes, 2, 'duplicate and cap-rejected nodes are both dropped');
  assert.equal(result.droppedEdges, 1, 'an edge through a cap-dropped carried node is dropped');
  assert.deepEqual(result.pastedNodeIds, ['n2']);
  assert.deepEqual(result.pastedEdgeIds, ['e3']);
  assert.equal(target.nodes.length, 2);
  assert.equal(target.edges.length, 2);
});

test('applyExactPatch keeps counters finite with unsafe server ids', () => {
  const target = graph();
  target.nodes.push({ id: 'n9007199254740991', label: 'Max', x: 0, y: 0, order: 1 });
  target.nextNode = 9007199254740992; // unsafe input from an old document
  const result = core.applyExactPatch(target, {
    nodes: [
      { id: 'n9007199254740992', label: 'Huge', x: 30, y: 30, order: 2 },
      { id: 'n9007199254740992', label: 'Duplicate', x: 40, y: 40, order: 3 },
    ],
    edges: [],
  }, { maxNodes: 3000, maxEdges: 8000 });

  assert.equal(result.droppedNodes, 1);
  assert.ok(Number.isSafeInteger(target.nextNode) && target.nextNode >= 1);
  assert.ok(target.nodes.some(n => n.id === 'n9007199254740992' && n.label === 'Huge'));
});

test('applyServerChange adds idempotency and revision checks around the same merge', () => {
  const target = graph();
  const appliedIds = new Set();
  const change = {
    id: 'change-1', revision: 7,
    patch: { nodes: [{ id: 'a', label: 'From server', custom: { p1: 'server' } }], edges: [] },
  };
  const first = core.applyServerChange(target, change, { appliedIds, lastRevision: 6 });
  assert.equal(first.status, 'applied');
  assert.deepEqual(first.pastedNodeIds, ['a']);
  assert.equal(target.nodes[0].label, 'From server');
  assert.equal(target.nodes[0].custom.p2, 'keep');

  const duplicate = core.applyServerChange(target, change, { appliedIds, lastRevision: 7 });
  assert.equal(duplicate.status, 'duplicate');
  const stale = core.applyServerChange(target, { ...change, id: 'change-2', revision: 5 }, { appliedIds, lastRevision: 7 });
  assert.equal(stale.status, 'stale');
  const invalid = core.applyServerChange(target, { id: '', revision: 8, patch: {} }, { appliedIds, lastRevision: 7 });
  assert.equal(invalid.status, 'invalid');

  const newer = core.applyServerChange(target, {
    id: 'change-3', revision: 8,
    patch: { nodes: [{ id: 'a', label: 'Newer from server' }], edges: [] },
  }, { appliedIds, lastRevision: 7 });
  assert.equal(newer.status, 'applied');
  assert.equal(target.nodes[0].label, 'Newer from server');
});

test('server patches never leave a dangling edge', () => {
  const target = graph();
  const appliedIds = new Set();
  const change = {
    id: 'dangling', revision: 1,
    patch: { nodes: [], edges: [{ id: 'e1', from: 'a', to: 'missing', label: 'bad' }] },
  };
  const result = core.applyServerChange(target, change, { appliedIds });
  assert.equal(result.status, 'rejected');
  assert.equal(result.droppedEdges, 1);
  assert.equal(target.edges[0].to, 'a', 'the existing edge is unchanged');
  assert.equal(appliedIds.has('dangling'), false);
});

test('partial and rejected server changes remain retryable', () => {
  const target = graph();
  const appliedIds = new Set();
  const change = {
    id: 'capacity', revision: 1,
    patch: {
      nodes: [
        { id: 'n2', label: 'Fits', x: 0, y: 0, order: 1 },
        { id: 'n3', label: 'Needs space', x: 10, y: 0, order: 2 },
      ],
      edges: [],
    },
  };
  const partial = core.applyServerChange(target, change, { appliedIds, maxNodes: 2 });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.droppedNodes, 1);
  assert.equal(appliedIds.has('capacity'), false);

  const applied = core.applyServerChange(target, change, { appliedIds, maxNodes: 3 });
  assert.equal(applied.status, 'applied');
  assert.equal(appliedIds.has('capacity'), true);
  assert.ok(target.nodes.some(n => n.id === 'n2'));
  assert.ok(target.nodes.some(n => n.id === 'n3'));

  const rejected = core.applyServerChange(graph(), { id: 'full', revision: 1, patch: change.patch },
    { appliedIds, maxNodes: 1 });
  assert.equal(rejected.status, 'rejected');
  assert.equal(appliedIds.has('full'), false);
});

test('a malformed patch is rejected before anything is mutated', () => {
  const target = graph();
  const appliedIds = new Set();
  const before = JSON.parse(JSON.stringify(target));

  const withNull = core.applyServerChange(target, {
    id: 'null-entry', revision: 1,
    patch: { nodes: [{ id: 'a', label: 'changed' }, null], edges: [] },
  }, { appliedIds });
  assert.equal(withNull.status, 'invalid');
  assert.equal(appliedIds.has('null-entry'), false, 'an invalid change is never acknowledged');
  assert.deepEqual(JSON.parse(JSON.stringify(target)), before, 'the target is untouched');

  for(const patch of [{ nodes: 'not-an-array' }, { nodes: [], edges: 'nope' }, { nodes: [1, 'two'] }]){
    const result = core.applyServerChange(target, { id: 'shape', revision: 1, patch }, { appliedIds });
    assert.equal(result.status, 'invalid', JSON.stringify(patch));
    assert.equal(appliedIds.has('shape'), false);
    assert.deepEqual(JSON.parse(JSON.stringify(target)), before);
  }
  assert.equal(core.validatePatchShape({ nodes: [{ id: 'a' }], edges: [] }), null);
  assert.match(String(core.validatePatchShape({ edges: {} })), /not an array/);
});

test('an invalid change does not consume its revision', () => {
  const target = graph();
  const appliedIds = new Set();
  const bad = core.applyServerChange(target, { id: 'x', revision: 5, patch: { nodes: null } },
    { appliedIds, lastRevision: 4 });
  assert.equal(bad.status, 'invalid');
  // The transport can resend the corrected change at the same revision.
  const good = core.applyServerChange(target, {
    id: 'x', revision: 5, patch: { nodes: [{ id: 'a', label: 'Retried' }], edges: [] },
  }, { appliedIds, lastRevision: 4 });
  assert.equal(good.status, 'applied');
  assert.equal(appliedIds.has('x'), true);
  assert.equal(target.nodes.find(n => n.id === 'a').label, 'Retried');
});

test('server patch rejects non-scalar coercion fields before mutation', () => {
  const bad = { toString: null, valueOf: null };
  for(const [kind, field] of [['nodes','id'], ['nodes','x'], ['nodes','y'], ['nodes','order'], ['edges','id'], ['edges','from'], ['edges','to']]) {
    const target = graph();
    const before = structuredClone(target);
    const appliedIds = new Set();
    const entry = { id: 'b', [field]: bad };
    const patch = { nodes: [{ id: 'a', label: 'new' }], edges: [] };
    patch[kind].push(entry);
    const result = core.applyServerChange(target, { id:'c1', revision:1, patch }, { appliedIds });
    assert.equal(result.status, 'invalid', `${kind}.${field}`);
    assert.deepEqual(target, before);
    assert.equal(appliedIds.size, 0);
  }
});

test('server changes are staged if comparison throws after an earlier update', () => {
  const target = graph();
  let left = {}, right = {};
  for(let i = 0; i < 20000; i++) { left = { nested: left }; right = { nested: right }; }
  target.nodes.push({ id: 'b', order: 1, value: left });
  const originalA = target.nodes[0];
  const appliedIds = new Set();
  const result = core.applyServerChange(target, { id:'deep', revision:1, patch:{ nodes:[
    { id:'a', label:'new' }, { id:'b', value:right },
  ] } }, { appliedIds });
  assert.equal(result.status, 'invalid');
  assert.equal(target.nodes[0], originalA);
  assert.equal(originalA.label, 'Old');
  assert.equal(target.nodes[1].value, left);
  assert.equal(appliedIds.size, 0);
});

test('successful staged server changes preserve entity and array identities', () => {
  const target = graph(), nodes = target.nodes, edges = target.edges, node = nodes[0], edge = edges[0];
  const result = core.applyServerChange(target, { id:'ok', revision:1, patch:{ nodes:[{id:'a',label:'new'}], edges:[{id:'e1',label:'new edge'}] } });
  assert.equal(result.status, 'applied');
  assert.equal(target.nodes, nodes); assert.equal(target.edges, edges);
  assert.equal(target.nodes[0], node); assert.equal(target.edges[0], edge);
  assert.equal(node.label, 'new'); assert.equal(edge.label, 'new edge');
});

test('numeric identities are normalized in persisted entities and resolve through raw-key lookups', () => {
  const target = { nodes: [], edges: [], nextNode: 1, nextEdge: 1 };
  const result = core.applyServerChange(target, { id:'numeric', revision:1,
    patch:{ nodes:[{id:1,label:'one'}, {id:2,label:'two'}],
      edges:[{id:9,from:1,to:'2'}] } });
  assert.equal(result.status, 'applied');
  assert.equal(target.nodes[0].id, '1');
  assert.equal(target.edges[0].id, '9');
  const index = new Map(target.nodes.map(node => [node.id, node]));
  assert.equal(index.get(target.edges[0].from).label, 'one');
  assert.equal(index.get(target.edges[0].to).label, 'two');
  const update = core.applyServerChange(target, {id:'update',revision:2,patch:{edges:[{id:9, from:2, to:1}]} });
  assert.equal(update.status, 'applied');
  assert.equal(index.get(target.edges[0].from).label, 'two');
  assert.equal(index.get(target.edges[0].to).label, 'one');
});

test('noncanonical server identities are rejected before mutation or acknowledgement', () => {
  for(const [kind, field, value] of [['nodes','id','bad id'], ['edges','id','x/y'], ['edges','to','x'.repeat(41)]]) {
    const target = graph(), before = structuredClone(target), appliedIds = new Set();
    const patch = { nodes:[{id:'a',label:'changed'}], edges:[] };
    patch[kind].push({id:'a', [field]:value});
    const result = core.applyServerChange(target, {id:'bad',revision:1,patch}, {appliedIds});
    assert.equal(result.status, 'invalid');
    assert.deepEqual(target, before);
    assert.equal(appliedIds.size, 0);
  }
});

test('server changes reject malformed fields and duplicate or missing ids without mutation', () => {
  const cases = [
    {nodes:[{id:'a',label:'new'}, {id:'b',label:{evil:true}}]},
    {nodes:[{id:'a',width:'wide'}]}, {nodes:[{id:'a',width:301}]},
    {nodes:[{id:'a',shape:'not-a-shape'}]}, {nodes:[{id:'a',color:'red'}]},
    {edges:[{id:'e1',from:null}]}, {edges:[{id:'e1',direction:'sideways'}]},
    {nodes:[{id:'a',x:NaN}]}, {nodes:[{id:'a',label:null}]},
    {nodes:[{id:'a',custom:{x:{bad:true}}}]},
    {nodes:[{label:'missing'}]}, {nodes:[{id:'a'},{id:'a'}]},
    {nodes:[{id:1},{id:'1'}]}, {edges:[{id:'e1'},{id:'e1'}]},
    {edges:[{id:'new-edge',from:'a'}]}, {edges:[{id:'e1',weight:{bad:true}}]},
  ];
  for(const patch of cases){
    const target = graph(), before = structuredClone(target), appliedIds = new Set();
    const result = core.applyServerChange(target, {id:'bad', revision:3, patch}, {appliedIds});
    assert.equal(result.status, 'invalid', JSON.stringify(patch));
    assert.deepEqual(target, before);
    assert.equal(appliedIds.size, 0);
  }
});

test('server changes enforce default and absolute node and edge limits', () => {
  const nodes = Array.from({length:3000}, (_,i) => ({id:'n'+i,label:'N',x:0,y:0,order:i}));
  const edges = Array.from({length:8000}, (_,i) => ({id:'e'+i,from:'n0',to:'n0',label:''}));
  for(const options of [{}, {maxNodes:Infinity,maxEdges:Infinity}, {maxNodes:100000,maxEdges:100000}]){
    const target = {nodes:structuredClone(nodes),edges:structuredClone(edges),nextNode:1,nextEdge:1};
    const appliedIds = new Set();
    const result = core.applyServerChange(target, {id:'cap',revision:1,patch:{
      nodes:[{id:'new',label:'excess'}],edges:[{id:'new-edge',from:'n0',to:'n0'}],
    }}, {...options, appliedIds});
    assert.equal(result.status,'rejected');
    assert.equal(target.nodes.length,3000); assert.equal(target.edges.length,8000);
    assert.equal(appliedIds.size,0);
  }
  const target = {nodes:structuredClone(nodes),edges:[],nextNode:1,nextEdge:1};
  const appliedIds = new Set();
  const result = core.applyServerChange(target, {id:'partial',revision:2,patch:{nodes:[{id:'n0',label:'changed'},{id:'new'}]}}, {appliedIds});
  assert.equal(result.status,'partial'); assert.equal(target.nodes[0].label,'changed');
  assert.equal(appliedIds.size,0);
});

test('new server entities without labels get safe string defaults', () => {
  const target = {nodes:[],edges:[],nextNode:1,nextEdge:1};
  const result = core.applyServerChange(target, {id:'defaults',revision:1,patch:{nodes:[{id:'n'}],edges:[{id:'e',from:'n',to:'n'}]}});
  assert.equal(result.status,'applied');
  assert.equal(target.nodes[0].label.padEnd(2), '  ');
  assert.equal(target.edges[0].label, '');
});


test('a TypeScript consumer can import the real core module', () => {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2020', '--module', 'Node16', '--moduleResolution', 'Node16', 'tests/fixtures/core-consumer.ts'], { stdio:'pipe' });
});

test('server custom values require canonical keys and surviving definitions', () => {
  const long = 'x'.repeat(128);
  const target = graph();
  target.customAttributes.push({id:long, scope:'node', type:'string'}, {id:'n',scope:'node',type:'int'}, {id:'e',scope:'edge',type:'string'});
  const before = structuredClone(target), appliedIds = new Set();
  for(const custom of [{[long+'extra']:'overwrite'}, {missing:'lost'}, {' p1':'bad'}, {n:'123'}]){
    const result = core.applyServerChange(target, {id:'bad',revision:1,patch:{nodes:[{id:'a',label:'changed',custom}]}}, {appliedIds});
    assert.equal(result.status,'invalid'); assert.deepEqual(target,before); assert.equal(appliedIds.size,0);
  }
  const valid = core.applyServerChange(target, {id:'good',revision:1,patch:{nodes:[{id:'a',custom:{n:123,e:'orphan'}}]}}, {appliedIds});
  assert.equal(valid.status,'applied');
  assert.equal(target.nodes[0].custom.n,123); assert.equal(target.nodes[0].custom.e,'orphan');
});

test('server direction patches synchronize authoritative and legacy fields', () => {
  const target = graph();
  target.edges[0].direction = 'directed'; target.edges[0].directed = true;
  const change = (id, revision, edge) => core.applyServerChange(target, {id,revision,patch:{edges:[{id:'e1',...edge}]}});
  assert.equal(change('off',1,{directed:false}).status, 'applied');
  assert.equal(target.edges[0].direction,'undirected'); assert.equal(target.edges[0].directed,false);
  assert.equal(change('both',2,{direction:'mutual'}).status, 'applied');
  assert.equal(target.edges[0].direction,'mutual'); assert.equal(target.edges[0].directed,true);
  assert.equal(change('priority',3,{direction:'directed',directed:false}).status, 'applied');
  assert.equal(target.edges[0].direction,'directed'); assert.equal(target.edges[0].directed,true);
});


test('the package core subpath is importable as an ES module', async () => {
  const imported = await import('graph-editor-pro/core');
  assert.equal(imported.GraphPatchCore, core);
});

test('server custom definitions are checked against the first loader-surviving identity', () => {
  const key = 'k'.repeat(128), target = graph();
  target.customAttributes.unshift({id:key+'suffix',scope:'node',type:'int'}, {id:key,scope:'node',type:'string'});
  const before = structuredClone(target), ids = new Set();
  const result = core.applyServerChange(target, {id:'collision',revision:1,patch:{nodes:[{id:'a',custom:{[key]:'unsafe'}}]}}, {appliedIds:ids});
  assert.equal(result.status,'invalid'); assert.deepEqual(target,before); assert.equal(ids.size,0);
});

test('server reorders existing nodes before acknowledging and preserves omitted fields', () => {
  const target = graph();
  target.nodes.push({id:'b',label:'Other',x:50,y:10,order:1});
  const nodes = target.nodes, a = nodes[0], b = nodes[1], ids = new Set();
  const change = {id:'swap', revision:1, patch:{nodes:[{id:'a',order:1}, {id:'b',order:0}]}};
  const result = core.applyServerChange(target, change, {appliedIds:ids});
  assert.equal(result.status,'applied'); assert.equal(result.changed,true); assert.ok(ids.has('swap'));
  assert.equal(target.nodes,nodes, 'array identity remains stable');
  assert.deepEqual(target.nodes.map(n => [n.id,n.order]), [['b',0],['a',1]]);
  assert.equal(target.nodes[0],b); assert.equal(target.nodes[1],a);
  assert.equal(a.label,'Old'); assert.equal(b.x,50);
  assert.equal(core.applyServerChange(target,change,{appliedIds:ids}).status,'duplicate');
  const noOrder = core.applyServerChange(target, {id:'label',revision:2,patch:{nodes:[{id:'a',label:'Updated'}]}}, {appliedIds:ids});
  assert.equal(noOrder.status,'applied'); assert.equal(a.order,1);
});

test('exact patch preserves existing order by default but can explicitly apply it', () => {
  const target = graph(); target.nodes.push({id:'b',label:'B',x:0,y:0,order:1});
  const patch = {nodes:[{id:'a',order:1},{id:'b',order:0}]};
  const clipboard = core.applyExactPatch(target, patch);
  assert.equal(clipboard.changed,false);
  assert.deepEqual(target.nodes.map(n => [n.id,n.order]), [['a',0],['b',1]]);
  const generic = core.applyExactPatch(target, patch, {applyExistingNodeOrder:true});
  assert.equal(generic.changed,true);
  assert.deepEqual(target.nodes.map(n => [n.id,n.order]), [['b',0],['a',1]]);
});

test('a partial server reorder remains retryable and applies new nodes when capacity is raised', () => {
  const target = graph(); target.nodes.push({id:'b',label:'B',x:0,y:0,order:1});
  const ids = new Set();
  const change = {id:'partial-order',revision:2,patch:{nodes:[{id:'a',order:1},{id:'b',order:0},{id:'c',label:'C',order:2}]}};
  const partial = core.applyServerChange(target,change,{appliedIds:ids,maxNodes:2});
  assert.equal(partial.status,'partial'); assert.equal(ids.has(change.id),false);
  assert.deepEqual(target.nodes.map(n => [n.id,n.order]), [['b',0],['a',1]]);
  const retry = core.applyServerChange(target,change,{appliedIds:ids,maxNodes:3});
  assert.equal(retry.status,'applied'); assert.ok(ids.has(change.id));
  assert.deepEqual(target.nodes.map(n => [n.id,n.order]), [['b',0],['a',1],['c',2]]);
});

test('invalid server order is rejected atomically and does not consume the change id', () => {
  const target = graph(); target.nodes.push({id:'b',label:'B',x:0,y:0,order:1});
  const before = structuredClone(target), ids = new Set();
  const bad = {id:'order',revision:1,patch:{nodes:[{id:'a',order:1},{id:'b',order:-1}]}};
  assert.equal(core.applyServerChange(target,bad,{appliedIds:ids}).status,'invalid');
  assert.deepEqual(target,before); assert.equal(ids.size,0);
  const good = { ...bad, patch:{nodes:[{id:'a',order:1},{id:'b',order:0}]} };
  assert.equal(core.applyServerChange(target,good,{appliedIds:ids}).status,'applied');
  assert.deepEqual(target.nodes.map(n => n.id),['b','a']);
});

test('server custom values accept exactly the values preserved verbatim by the loader', () => {
  const target = graph();
  const definitions = [
    {id:'i',scope:'node',type:'int'}, {id:'l',scope:'node',type:'long'},
    {id:'f',scope:'node',type:'float'}, {id:'d',scope:'node',type:'double'},
    {id:'b',scope:'node',type:'boolean'},
  ];
  target.customAttributes.push(...definitions);
  const preserved = {i:'1.0000000000000001', l:'9223372036854775807', f:'', d:'not numeric', b:'maybe'};
  const ids = new Set();
  const result = core.applyServerChange(target,{id:'verbatim',revision:1,patch:{nodes:[{id:'a',custom:preserved}]}},{appliedIds:ids});
  assert.equal(result.status,'applied');
  for(const [key,value] of Object.entries(preserved)) assert.equal(target.nodes[0].custom[key],value);
  for(const [key,value] of [['i','1'], ['l','42'], ['f','1.2'], ['d','3'], ['b','yes']]){
    const before = JSON.stringify(target);
    const rejected = core.applyServerChange(target,{id:'convert-'+key,revision:2,patch:{nodes:[{id:'a',custom:{[key]:value}}]}},{appliedIds:ids});
    assert.equal(rejected.status,'invalid', `${key} would change on reload`);
    assert.equal(JSON.stringify(target),before); assert.equal(ids.has('convert-'+key),false);
  }
  for(const [key,type] of [['i','int'],['l','long'],['f','float'],['d','double'],['b','boolean']]){
    for(const value of ['', '  ', 'maybe']){
      assert.equal(core.coerceCustomValue(value,type), value);
      const accepted = core.applyServerChange(target,{id:`${key}-${JSON.stringify(value)}`,revision:3,patch:{nodes:[{id:'a',custom:{[key]:value}}]}},{appliedIds:ids});
      assert.equal(accepted.status,'applied'); assert.equal(target.nodes[0].custom[key],value);
    }
  }
});
