import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { bindMarigoldSource, verifyMarigoldPreviewConsumed } from './marigold-preview-evidence.mjs';
import { exportCanonicalWorkflowGraphs, readCanonicalWorkflowEvidence } from './release-contract-core.mjs';

const clientRoot = fileURLToPath(new URL('../', import.meta.url));
const backendRoot = fileURLToPath(new URL('../../MoDiff/', import.meta.url));
const workflowId = 'MarigoldDepthPipeline:depth_estimation';
const evidencePath = process.env.MODIFF_RETAINED_MARIGOLD_EVIDENCE;
const catalogPath = 'data/graphs/studio/marigold-depth-pipeline/depth-estimation.json';

async function fixture() {
  const graph = JSON.parse(readFileSync(join(backendRoot, catalogPath)));
  const [expected] = await exportCanonicalWorkflowGraphs(clientRoot, [graph]);
  const submitted = structuredClone(expected);
  const source = Object.entries(submitted.nodes).find(([, node]) => node.action === 'Load')[0];
  const binding = { nodeId: source, field: 'file', sourceValue: 'fixture.png', file: { sha256: 'a'.repeat(64) } };
  submitted.nodes[source].params.file.value = [binding.sourceValue];
  const registry = Object.fromEntries(
    Object.entries(submitted.nodes).map(([id, node]) => [
      `${node.module}.${node.action}`,
      {
        module: node.module,
        action: node.action,
        params: id === source ? { file: { display: 'filebrowser' } } : {},
      },
    ]),
  );
  return { expected, submitted, binding, registry };
}

test('Marigold qualifies only the current six-node preview chain and single declared image binding', async () => {
  const { expected, submitted, binding, registry } = await fixture();
  const before = structuredClone([expected, submitted]);
  const bound = bindMarigoldSource(expected, submitted, binding, registry);
  assert.equal(bound.preview.node.params.image.sourceKey, 'preview_images');
  assert.deepEqual([expected, submitted], before);
  assert.throws(() => bindMarigoldSource(expected, submitted, { ...binding, sourceValue: '../image.png' }, registry));
  const changed = structuredClone(submitted);
  changed.nodes[bound.preview.id].params.image.sourceKey = 'prediction';
  assert.throws(() => bindMarigoldSource(expected, changed, binding, registry), /recipe differs/);
  changed.nodes[bound.preview.id].params.image.sourceKey = 'preview_images';
  changed.nodes[bound.predict.id].params.num_inference_steps.value = 2;
  assert.throws(() => bindMarigoldSource(expected, changed, binding, registry), /recipe differs/);
  registry['modules.DiffusersImage.PredictMap'].params.second_file = { display: 'filebrowser' };
  assert.throws(() => bindMarigoldSource(expected, submitted, binding, registry), /unbound file browser/);
});

test('Marigold binds actual source bytes and observed depth controls to the rendered Preview owner', async () => {
  const { expected, submitted, binding, registry } = await fixture();
  const bound = bindMarigoldSource(expected, submitted, binding, registry);
  const controls = {
    quantization: { dtype: 'float32' },
    recipe: { attention_backend: 'auto', device: 'cuda:0', offload_mode: 'none', vae_slicing: true, vae_tiling: true },
    loader: {
      auto_offload: false,
      device: 'cuda:0',
      dtype: 'float32',
      enable_vae_slicing: true,
      enable_vae_tiling: true,
      mode: 'depth_estimation',
      model_id: 'prs-eth/marigold-depth-lcm-v1-0',
      offload_mode: 'none',
      pipeline_class: 'MarigoldDepthPipeline',
      revision: '04a73502f7fd8fc5e59947b9df3b2266d71d6849',
    },
    source: {
      alpha_channel: 'ignore',
      source_hashes: [binding.file.sha256],
      source_widths: [64],
      source_heights: [48],
      source_modes: ['RGB'],
    },
    predict: {
      num_inference_steps: 1,
      processing_resolution: 768,
      match_input_resolution: true,
      output_type: 'np',
      executed_task: 'depth_estimation',
      seed: 42,
    },
    preview: { device: 'cpu:0' },
  };
  const output = {
    taskId: 'synthetic',
    resolvedExecutionInputs: {
      schemaVersion: 1,
      source: 'backend-execution',
      taskId: 'synthetic',
      attemptIndex: 0,
      nodeId: bound.preview.id,
      truncated: false,
      fieldAccountingStatus: { schemaVersion: 1, truncated: false },
      uncapturedNodeIds: [],
      unavailableFields: [],
      ambiguousFields: ['device'],
      graphTasks: [{ loaderId: bound.loader.id, pipelineClass: 'MarigoldDepthPipeline', task: 'depth_estimation' }],
      nodes: Object.entries(controls).map(([role, fields]) => ({
        nodeId: bound[role].id,
        module: bound[role].node.module,
        action: bound[role].node.action,
        omittedFields: {},
        fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value, source: 'literal' }])),
      })),
    },
  };
  assert.deepEqual(verifyMarigoldPreviewConsumed(bound, output, binding), {
    width: 64,
    height: 48,
    sha256: binding.file.sha256,
  });
  for (const [action, field, changed, message] of [
    ['Load', 'source_hashes', ['0'.repeat(64)], /source byte identity/],
    ['LoadPipeline', 'revision', '0'.repeat(40), /model pin/],
    ['PredictMap', 'processing_resolution', 512, /prediction controls/],
  ]) {
    const other = structuredClone(output);
    other.resolvedExecutionInputs.nodes.find((node) => node.action === action).fields[field].value = changed;
    assert.throws(() => verifyMarigoldPreviewConsumed(bound, other, binding), message);
  }
});

test(
  'Marigold validates the retained original task and files as preview-only technical evidence',
  { skip: !evidencePath },
  async () => {
    const original = readFileSync(evidencePath);
    const { receipt } = await readCanonicalWorkflowEvidence({ clientRoot, backendRoot, workflowId, evidencePath });
    assert.equal(receipt.proofKind, 'real_backend_input_bound_model_variant');
    assert.equal(receipt.canonicalDefaultsExecuted, false);
    assert.equal(receipt.observationLimits.numericDepthPrediction, false);
    assert.deepEqual([receipt.decodedOutput.width, receipt.decodedOutput.height], [64, 48]);
    assert.ok(Object.values(receipt.qualificationClaims).every((claim) => claim === false));
    assert.deepEqual(readFileSync(evidencePath), original);
  },
);
