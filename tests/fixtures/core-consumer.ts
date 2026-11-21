import { GraphPatchCore } from '../../src/core/graph-patch.js';
import { GraphPatchCore as packagedCore } from 'graph-editor-pro/core';
const graph = { nodes: [], edges: [], nextNode: 1, nextEdge: 1 };
const result = GraphPatchCore.applyServerChange(graph, { id: 'example', revision: 1, patch: { nodes: [] } });
const status: string = result.status;
void status; void packagedCore;
