import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { builtinMediaTarget, validateMediaLifecycle } from './builtin-media-qualification.mjs';
import { canonicalJsonHash } from './canonical-json.mjs';
import { sha256Value } from './live-proof-provenance.mjs';
import { canonicalWorkflowAuthoringContract } from './release-contract-core.mjs';

const backend = resolve(process.env.MODIFF_BACKEND_DIR || '../MoDiff');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const manifest = json(join(backend, 'data/workflow-library-manifest.json')).workflows;
const authorings = json(join(backend, 'data/template-authoring-specs.v1.json')).specifications;
const exercises = json(resolve('config/builtin-media-qualification.v1.json')).exercises;
function fixture(mode = 'image_crop') {
  const row = manifest.find((r) => r.mode === mode && r.modelType.startsWith('Builtin'));
  const graph = json(join(backend, 'data/graphs', row.graphPath)),
    authoring = authorings.find((r) => r.canonicalWorkflowId === row.id);
  const inputs = graph.nodes.flatMap((node) =>
    Object.entries(node.data.params)
      .filter(([, p]) => p.display === 'filebrowser')
      .map(([field, p]) => ({
        nodeId: node.id,
        field,
        values: Array.from(
          {
            length:
              p.fieldOptions?.multiple &&
              ['mask_composite', 'image_stitch', 'video_stitch', 'video_tile'].includes(mode)
                ? 2
                : 1,
          },
          (_, i) => ({ sourceValue: `@data/fixtures/${node.id}-${i}.bin` }),
        ),
      })),
  );
  return { row, graph, authoring, inputs };
}
test('all 17 model-free media recipes preserve canonical defaults and bind only declared inputs and explicit exercises', () => {
  assert.equal(Object.keys(exercises).length, 17);
  for (const mode of Object.keys(exercises)) {
    const f = fixture(mode),
      original = JSON.stringify(f.graph);
    assert.throws(
      () => canonicalWorkflowAuthoringContract(f.row, f.graph, f.authoring),
      /builtin qualification is unsupported/,
    );
    const baseline = builtinMediaTarget(f.row, f.graph, f.authoring, f.inputs, 'baseline', exercises);
    const edited = builtinMediaTarget(f.row, f.graph, f.authoring, f.inputs, 'exercise', exercises);
    assert.equal(baseline.modelType, f.row.modelType);
    assert.equal(baseline.canonicalWorkflowHash, edited.canonicalWorkflowHash);
    const primary = edited.boundGraph.nodes.find((n) => n.id === edited.processorId);
    for (const [field, value] of Object.entries(exercises[mode])) assert.equal(primary.data.params[field].value, value);
    assert.equal(JSON.stringify(f.graph), original, 'Authoritative workflow defaults were changed');
  }
});
test('media admission rejects missing roots, traversal, model substitutions and stale source identity', () => {
  for (const change of [
    (f) => {
      f.inputs = [];
    },
    (f) => {
      f.inputs[0].values[0].sourceValue = '@data/../private.png';
    },
    (f) => {
      f.row.modelType = 'UnreviewedModel';
    },
    (f) => {
      f.authoring.canonicalGraph.sha256 = 'stale';
    },
    (f) => {
      f.row.requiredArtifacts = ['example/weights'];
    },
    (f) => {
      f.inputs.push(structuredClone(f.inputs[0]));
    },
  ]) {
    const f = structuredClone(fixture());
    change(f);
    assert.throws(() => builtinMediaTarget(f.row, f.graph, f.authoring, f.inputs, 'baseline', exercises));
  }
  const f = fixture();
  f.graph.nodes[0].data.module = 'custom.Unreviewed';
  f.row.graphHash = canonicalJsonHash(f.graph);
  f.authoring.canonicalGraph.sha256 = f.row.graphHash;
  f.authoring.defaultsPlan.sourceGraphSha256 = f.row.graphHash;
  assert.throws(
    () => builtinMediaTarget(f.row, f.graph, f.authoring, f.inputs, 'baseline', exercises),
    /Undeclared|equal|length/,
  );
});
function lifecycle() {
  const source = { gitCommit: 'd'.repeat(40), files: [{ path: 'main.py', sha256: 'c'.repeat(64) }] };
  source.fingerprint = sha256Value('backend-source-v1', source);
  const start = Date.parse('2026-11-15T00:00:01Z') / 1000;
  const claim = {
    schemaVersion: 1,
    claim: 'process_start_backend_source_identity',
    gitCommit: source.gitCommit,
    fingerprint: source.fingerprint,
    fileCount: 1,
    capturedAt: '2026-11-15T00:00:00Z',
  };
  const api = {
    sid: 'synthetic-session',
    nodes: { op: { module: 'modules.Video', action: 'ProcessVideo', params: { fps: { value: 24 } } } },
    paths: [['op']],
  };
  const runtime = {
    fingerprint: 'sha256:synthetic-runtime',
    packages: { torch: '2.14.1', python: '3.12.11' },
    torch: { version: '2.14.1', cuda_available: false },
    work_dir: '/synthetic/work',
    data_dir: '/synthetic/data',
    backendSource: claim,
  };
  const measurement = {
    backend: 'cpu',
    device: 'cpu:0',
    peakMeasurementVersion: 2,
    elapsedSeconds: 0.1,
    processRssBytes: 4096,
  };
  const task = {
    task_id: 'synthetic-media',
    sid: api.sid,
    status: 'completed',
    attempt_index: 0,
    resourceCandidateId: null,
    started_at: start,
    completed_at: start + 0.1,
    runtimeFingerprint: runtime,
    runtimeMeasurement: measurement,
  };
  return {
    expectedApi: structuredClone(api),
    submittedApi: structuredClone(api),
    accepted: { taskId: task.task_id, graph: structuredClone(api) },
    run: { task },
    before: { identity: { ...source, capturedAt: '2026-11-15T00:00:00Z' } },
    after: { identity: { ...source, capturedAt: '2026-11-15T00:00:02Z' } },
    messages: [
      {
        type: 'executed',
        task_id: task.task_id,
        node: 'op',
        name: 'modules.Video.ProcessVideo',
        status: 'succeeded',
        attempt_index: 0,
      },
      {
        type: 'graph_completed',
        task_id: task.task_id,
        runtimeFingerprint: runtime,
        runtimeMeasurement: measurement,
        runtimeHints: null,
        resourceRetryHistory: [],
      },
    ],
  };
}
test('the media lifecycle requires the exact fresh queue graph, task, completion, source and measurement', async (t) => {
  assert.equal(validateMediaLifecycle(lifecycle()).task.status, 'completed');
  for (const [name, change] of [
    [
      'graph drift',
      (f) => {
        f.submittedApi.nodes.op.params.fps.value = 30;
      },
    ],
    [
      'extra authority',
      (f) => {
        f.accepted.graph.servicePackage = {};
      },
    ],
    [
      'fallback',
      (f) => {
        f.run.task.attempt_index = 1;
      },
    ],
    [
      'unrelated accepted task',
      (f) => {
        f.accepted.taskId = 'other';
      },
    ],
    [
      'cached result',
      (f) => {
        f.messages[0].status = 'cached';
      },
    ],
    [
      'missing node',
      (f) => {
        f.messages.shift();
      },
    ],
    [
      'source drift',
      (f) => {
        f.after.identity.fingerprint = 'changed';
      },
    ],
    [
      'incomplete memory',
      (f) => {
        delete f.run.task.runtimeMeasurement.processRssBytes;
      },
    ],
    [
      'unrelated frame',
      (f) => {
        f.messages[0].task_id = 'other';
      },
    ],
    [
      'Auto substitution',
      (f) => {
        f.run.task.resourceCandidateId = 'unreviewed';
      },
    ],
  ])
    await t.test(name, () => {
      const f = structuredClone(lifecycle());
      change(f);
      assert.throws(() => validateMediaLifecycle(f));
    });
});
