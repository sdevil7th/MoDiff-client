import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.resolve(root, '../MoDiff');
const python =
  process.env.MODIFF_BACKEND_PYTHON ||
  path.join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const rows = JSON.parse(
  execFileSync(python, [path.join(root, 'scripts/operation-starter-fixtures.py'), '--large-av'], {
    cwd: backend,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }),
);
globalThis.window = { location: { origin: 'http://127.0.0.1:8088' } };

test('joint video starters select one declared render without hiding legacy operation authority', async () => {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  try {
    const requests = await server.ssrLoadModule('/src/workflow/operationStarterRequest.ts');
    const operations = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
    assert.equal(rows.length, 11);
    for (const row of rows) {
      const { testOperationContracts: rawContracts, ...payload } = row;
      const contracts = operations.parseOperationContracts(rawContracts, 3);
      const legacy = payload.pipelineClass.startsWith('LTX2');
      const action = legacy || payload.task.endsWith('_with_audio') ? 'GenerateVideoAudio' : 'Generate';
      assert.equal(contracts.filter((c) => c.decomposition === 'pipeline').length, legacy ? 2 : 1);
      const parsed = requests.parseOperationStarter(payload, payload.pipelineClass, payload.task, contracts);
      assert.deepEqual(
        parsed.nodes.map((n) => n.node.action),
        ['LoadPipeline', action],
      );
      assert.equal(parsed.edges.length, 1);
      for (const [index, mutate] of [
        (p) => p.nodes.pop(),
        (p) => p.edges.splice(0),
        (p) => {
          p.edges[0].sourceHandle = 'resolved_artifact';
        },
        (p) => {
          p.edges[0].targetHandle = 'reference_images';
        },
      ].entries()) {
        const malformed = structuredClone(payload);
        mutate(malformed);
        assert.throws(
          () => requests.parseOperationStarter(malformed, payload.pipelineClass, payload.task, contracts),
          `${payload.pipelineClass}/${payload.task}: malformed mutation ${index}`,
        );
      }
    }
  } finally {
    await server.close();
  }
});
