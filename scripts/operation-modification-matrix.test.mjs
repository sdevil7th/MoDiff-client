import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.resolve(root, '../MoDiff');
const python =
  process.env.MODIFF_BACKEND_PYTHON ||
  path.join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const fixture = path.join(root, 'scripts/operation-starter-fixtures.py');
const starters = JSON.parse(
  execFileSync(
    process.platform === 'win32' ? python : path.join(backend, 'scripts/with-runtime-env.sh'),
    process.platform === 'win32' ? [fixture, '--all'] : [python, fixture, '--all'],
    { cwd: backend, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  ),
);

test('every published Modular starter preserves its generic graph and unrelated diagnostics during a compatible change', async (t) => {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  try {
    const a = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
    const schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
    const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
    const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
    assert.ok(starters.length >= 86);
    for (const starter of starters) {
      const label = `${starter.pipelineClass}/${starter.task}`;
      await t.test(label, async () => {
        const graph = a.createOperationStarter(starter, { x: 80, y: 100 });
        const loader = graph.nodes.find((n) => n.data.operationAuthoring.operation.decomposition === 'loader');
        const custom = {
          id: 'custom-diagnostic',
          type: 'custom',
          position: { x: 1, y: 1 },
          data: {
            type: 'custom',
            module: 'custom.Diagnostics',
            action: 'Observe',
            label: 'My diagnostic',
            params: { text: { type: 'str', value: 'retained diagnostic' } },
          },
        };
        graph.nodes.push(custom);
        const original = structuredClone(graph);
        const plan = a.planOperationChange(graph, loader.id, starter);
        assert.deepEqual(graph, original, label);
        assert.deepEqual(
          plan.graph.nodes.find((n) => n.id === custom.id),
          custom,
          label,
        );
        assert.equal(plan.graph.nodes.length, graph.nodes.length, label);
        assert.deepEqual(plan.diagnostics, [], label);
        assert.equal(
          new Set(plan.graph.edges.map((e) => `${e.target}:${e.targetHandle}`)).size,
          plan.graph.edges.length,
          label,
        );
        const semantic = JSON.parse(
          JSON.stringify({
            nodes: graph.nodes.map((n) => ({ nodeId: n.id, nodeType: n.type, data: n.data })),
            edges: graph.edges.map((e) => ({
              edgeId: e.id,
              sourceNodeId: e.source,
              sourcePortId: e.sourceHandle,
              targetNodeId: e.target,
              targetPortId: e.targetHandle,
            })),
          }),
        );
        semantic.graphHash = schema.blockGraphHashV2(semantic);
        const definition = {
          schemaVersion: 2,
          definitionId: 'user:matrix',
          displayName: 'Matrix Block',
          source: { kind: 'user' },
          graph: semantic,
          boundary: { mode: 'explicit', inputs: [], outputs: [] },
          controls: [],
          suggestedInputs: [],
          previews: [],
          ownership: { kind: 'user', definitionMutable: true },
        };
        definition.contentHash = schema.blockDefinitionContentHashV2(definition);
        const instance = schema.createBlockInstanceV2(definition, {
          instanceId: 'matrix-block',
          position: { x: 80, y: 100 },
          size: { width: 520, height: 640 },
        });
        const canvas = { nodes: [runtime.createBlockRootNodeV2(instance)], edges: [] };
        const changed = planBlockOperationChange(canvas, 'matrix-block', loader.id, starter);
        const next = schema.normalizeBlockInstanceV2(
          JSON.parse(JSON.stringify(changed.graph.nodes[0].data.blockInstanceV2)),
        );
        assert.deepEqual(next.definitionSnapshot, definition, label);
        assert.deepEqual(next.effectiveGraph.nodes.find((n) => n.nodeId === custom.id).data, custom.data, label);
        assert.equal(next.effectiveGraph.nodes.length, semantic.nodes.length, label);
        assert.deepEqual(canvas.nodes[0].data.blockInstanceV2, instance, label);
      });
    }
  } finally {
    await server.close();
  }
});
