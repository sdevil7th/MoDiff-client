import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import { protocolFactoryArguments } from './canonical-provenance-fixtures.mjs';
import { directImagePromptRuntimeHintAccounting } from './canonical-runtime-hints.mjs';
import {
  canonicalAccountingExecutionPlan,
  createRunProvenance,
  directImagePromptAccountingExecutionPlan,
  stableStringify,
} from './live-proof-provenance.mjs';
import { exportCanonicalWorkflowGraphs, readCanonicalWorkflowEvidence } from './release-contract-core.mjs';

const clientRoot = fileURLToPath(new URL('../', import.meta.url));
const backendRoot = fileURLToPath(new URL('../../MoDiff/', import.meta.url));
const retainedProfiles = [
  {
    modelType: 'DDPMPipeline',
    graphPath: 'ddpm-pipeline/unconditional-image.json',
    evidencePath: process.env.MODIFF_RETAINED_DDPM_EVIDENCE,
    platform: 'Windows-11',
    backend: 'cuda',
    size: 32,
  },
  {
    modelType: 'ConsistencyModelPipeline',
    graphPath: 'consistency-model-pipeline/unconditional-image.json',
    evidencePath: process.env.MODIFF_RETAINED_CONSISTENCY_EVIDENCE,
    platform: 'Linux-x86_64',
    backend: 'rocm',
    size: 64,
  },
];
const emptyConditioning = {
  control_guidance_start: null,
  control_guidance_end: null,
  conditioning_scale: null,
  strength: null,
};
const project = (kind, values, sourceNodeId, sourcePortId) => ({
  kind,
  values,
  sha256: createHash('sha256')
    .update(`${kind}\n${stableStringify(values)}`)
    .digest('hex'),
  ...(sourceNodeId ? { source: 'connected', sourceNodeId, sourcePortId } : {}),
});

// The canonical input is the actual exporter output. The stage transport,
// runtime and accounting observations are synthetic and never registered.
let synthetic;
let syntheticPrx;
const syntheticRetained = new Map();
before(async () => {
  synthetic = await syntheticImageCase({
    modelType: 'PixArtSigmaPAGPipeline',
    graphPath: 'pix-art-sigma-pag-pipeline/text-to-image.json',
    size: 1024,
  });
  syntheticPrx = await syntheticImageCase({
    modelType: 'PRXPipeline',
    graphPath: 'prx-pipeline/text-to-image.json',
    size: 512,
    platform: 'Linux-x86_64',
    backend: 'rocm',
  });
  for (const profile of retainedProfiles) syntheticRetained.set(profile.modelType, await syntheticImageCase(profile));
});

async function syntheticImageCase({ modelType, graphPath, size, platform, backend }) {
  const directPrx = modelType === 'PRXPipeline';
  const retained = platform !== undefined && !directPrx;
  const generateAction = retained ? 'UnconditionalGenerate' : 'Generate';
  const taskMode = retained ? 'unconditional_image' : 'text_to_image';
  const graph = JSON.parse(readFileSync(join(backendRoot, 'data/graphs/studio', graphPath), 'utf8'));
  if (directPrx) {
    const generate = graph.nodes.find((node) => node.data.action === 'Generate');
    generate.data.params.prompt.value = 'Editorial product photograph of a single silver compass.';
  }
  const [expected] = await exportCanonicalWorkflowGraphs(clientRoot, [graph]);
  const form = { modelType, mode: taskMode, ...(retained ? { resourceMode: 'expert' } : {}) };
  const visualNodes = graph.nodes.filter(
    (node) => node.data.action === 'Preview' || (directPrx && node.data.action === 'Generate'),
  );
  const ids = new Map(visualNodes.map((node) => [node.id, node.id]));
  const staged = [['setup', (node) => node.data.action !== generateAction]];
  if (!directPrx) staged.push(['generate', (node) => node.data.action === generateAction]);
  for (const [id, pick] of staged) {
    const leaves = graph.nodes.filter((node) => !ids.has(node.id) && pick(node));
    const nodes = leaves.map(({ id: nodeId, data }) => {
      ids.set(nodeId, `block-v2-node:${id.length}:${id}:${nodeId.length}:${nodeId}`);
      return { nodeId, data };
    });
    visualNodes.push({
      id,
      data: { module: 'MoDiff', action: 'BlockV2', blockInstanceV2: { instanceId: id, effectiveGraph: { nodes } } },
    });
  }
  const apiGraph = JSON.parse(JSON.stringify(expected));
  apiGraph.nodes = Object.fromEntries(Object.entries(apiGraph.nodes).map(([id, node]) => [ids.get(id), node]));
  for (const node of Object.values(apiGraph.nodes))
    for (const param of Object.values(node.params)) if (param.sourceId) param.sourceId = ids.get(param.sourceId);
  apiGraph.paths = apiGraph.paths.map((path) => path.map((id) => ids.get(id)));
  const expectedApiGraph = structuredClone(apiGraph);
  const nodeId = visualNodes.find((node) => node.data.action === 'Preview').id;
  const base = protocolFactoryArguments(apiGraph);
  if (platform) {
    base.runtimeFingerprint.packages.platform = platform;
    base.executionReceipt.runtimeMeasurement.backend = backend;
    base.executionReceipt.runtimeMeasurement.device = 'cuda:0';
  }
  const task = {
    task_id: base.taskId,
    sid: apiGraph.sid,
    status: 'completed',
    attempt_index: 0,
    resourceCandidateId: null,
    started_at: 100,
    completed_at: 101,
    runtimeFingerprint: base.runtimeFingerprint,
    runtimeMeasurement: base.executionReceipt.runtimeMeasurement,
    client_run_id: 'protocol-transport',
    workflow_tab_id: 'protocol-staged',
    workflow_canvas_epoch: 7,
  };
  const snapshot = { nodes: visualNodes, edges: [], viewport: graph.viewport, studioForm: form };
  task.workflow_snapshot = snapshot;
  const ordered = (item) =>
    Array.isArray(item)
      ? item.map(ordered)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => [key, ordered(value)]),
          )
        : item;
  const runInput = JSON.stringify(ordered({ form, nodes: apiGraph.nodes, paths: apiGraph.paths }));
  let correlation = 0x811c9dc5;
  for (const character of runInput) correlation = Math.imul(correlation ^ character.charCodeAt(0), 0x01000193);
  task.run_input_hash = `run_${(correlation >>> 0).toString(16).padStart(8, '0')}`;
  apiGraph.runtimeHints = {
    clientRunId: task.client_run_id,
    runInputHash: task.run_input_hash,
    workflowTabId: task.workflow_tab_id,
    workflowCanvasEpoch: task.workflow_canvas_epoch,
    workflowSnapshot: snapshot,
  };
  const consumed = {
    schemaVersion: 1,
    taskId: task.task_id,
    attemptIndex: 0,
    nodeId,
    source: 'backend-execution',
    truncated: false,
    uncapturedNodeIds: [],
    fieldAccountingStatus: { schemaVersion: 1, truncated: false },
    nodes: [],
  };
  const legacy = (value) => ({ value, source: 'literal' });
  const inactive = {
    PipelineQuantizationConfigV2: ['dtype', 'excluded_modules'],
    DiffusersExecutionRecipe: [
      'device_map_overrides',
      'layerwise_casting_components',
      'layerwise_storage_dtype',
      'layerwise_compute_dtype',
      'channels_last_components',
      'compile_components',
      'compile_backend',
      'compile_mode',
      'compile_fullgraph',
      'compile_dynamic',
      'cache_options',
      'cache_threshold',
    ],
    LoadPipeline: ['conditioning_model_id', 'conditioning_revision'],
    Generate: [
      'strength',
      'image_guidance_scale',
      'control_guidance_start',
      'control_guidance_end',
      'padding_mask_crop',
      'layers',
      'resolution',
      'cfg_normalize',
      'use_en_prompt',
    ],
    UnconditionalGenerate: ['eta', 'class_label'],
    ...(directPrx
      ? {
          Generate: [
            'cfg_normalize',
            'control_guidance_end',
            'control_guidance_start',
            'image_guidance_scale',
            'layers',
            'padding_mask_crop',
            'pag_adaptive_scale',
            'pag_scale',
            'resolution',
            'strength',
            'use_en_prompt',
          ],
        }
      : {}),
    Preview: ['device'],
  };
  const replacedLoaderFields = {
    auto_offload: 'offload_mode',
    device: 'device',
    offload_mode: 'offload_mode',
    enable_vae_slicing: 'vae_slicing',
    enable_vae_tiling: 'vae_tiling',
  };
  const recipeParams = Object.values(apiGraph.nodes).find((node) => node.action === 'DiffusersExecutionRecipe').params;
  const recipeValues = { schema_version: 1, quantization: 'none', device_map_strategy: 'none' };
  const none = { backend: 'none', disabled: true };
  const role = (action) => consumed.nodes.find((row) => row.action === action);
  for (const [ownerId, node] of Object.entries(apiGraph.nodes)) {
    const row = {
      nodeId: ownerId,
      module: node.module,
      action: node.action,
      fields: {},
      omittedFields: {},
      fieldAccounting: {
        schemaVersion: 1,
        fields: {},
        inputProjections: {},
        outputProjections: {},
        unaccountedFields: [],
        omittedFields: {},
        complete: true,
      },
    };
    for (const [key, param] of Object.entries(node.params)) {
      if (!Object.hasOwn(param, 'value') || param.sourceId) continue;
      const value = param.value?.source === 'hub' ? param.value.value : param.value;
      let field = { ...legacy(value), disposition: 'consumed', inputValue: value };
      if (inactive[node.action].includes(key)) {
        const reason =
          node.action === 'Preview'
            ? 'already-decoded-image'
            : [generateAction, 'LoadPipeline'].includes(node.action)
              ? 'adapter-inactive'
              : 'feature-disabled';
        field = { ...field, disposition: 'inactive', reason };
      } else if (node.action === 'LoadPipeline' && Object.hasOwn(replacedLoaderFields, key)) {
        const effective = recipeParams[replacedLoaderFields[key]].value;
        field = {
          ...field,
          value: key === 'auto_offload' ? effective !== 'none' : effective,
          disposition: 'superseded',
          reason: 'connected-recipe',
        };
      } else if (retained && node.action === 'LoadPipeline' && key === 'device_map') {
        field = { ...field, value: 'cuda', disposition: 'superseded', reason: 'loader-normalization' };
      } else if (key === 'image_contract') {
        field = {
          source: 'literal',
          disposition: 'metadata',
          reason: 'presentation-contract',
          sha256: project('image-contract-v1', value).sha256,
        };
      }
      row.fieldAccounting.fields[key] = field;
      if (
        node.action === generateAction &&
        field.disposition === 'consumed' &&
        !key.startsWith('pag_') &&
        (!retained || key !== 'batch_size')
      )
        row.fields[key] = legacy(value);
      if (node.action === 'DiffusersExecutionRecipe' && key !== 'device_map_overrides')
        recipeValues[key] = key.endsWith('_components') ? value.split(',').filter(Boolean) : value;
    }
    if (node.action === generateAction) {
      row.fields.executed_task = legacy(taskMode);
      if (!retained) for (const [key, value] of Object.entries(emptyConditioning)) row.fields[key] = legacy(value);
    }
    consumed.nodes.push(row);
  }
  const setup = role('LoadPipeline');
  const recipe = role('DiffusersExecutionRecipe');
  const quant = role('PipelineQuantizationConfigV2');
  setup.fieldAccounting.inputProjections.execution_recipe = project(
    'execution-recipe-v1',
    recipeValues,
    recipe.nodeId,
    'execution_recipe',
  );
  recipe.fieldAccounting.outputProjections.execution_recipe = project('execution-recipe-v1', recipeValues);
  recipe.fieldAccounting.inputProjections.quantization_config = project(
    'disabled-quantization-v1',
    none,
    quant.nodeId,
    'quantization_config',
  );
  quant.fieldAccounting.outputProjections.quantization_config = project('disabled-quantization-v1', none);
  const output = {
    ...base.executedOutput,
    id: 'protocol-image',
    taskId: task.task_id,
    attemptIndex: 0,
    sid: task.sid,
    nodeId,
    fieldKey: 'preview',
    clientRunId: task.client_run_id,
    workflowTabId: task.workflow_tab_id,
    runInputHash: task.run_input_hash,
    apiGraphSnapshot: apiGraph,
    graphSnapshot: snapshot,
    formSnapshot: form,
    resolvedExecutionInputs: consumed,
    mediaItems: [{ ...base.executedOutput.mediaItems[0], width: size, height: size }],
  };
  const run = { task, workflow_id: task.workflow_tab_id, workflow_snapshot: snapshot, outputs: [output] };
  const graphCompleted = {
    type: 'graph_completed',
    sid: task.sid,
    task_id: task.task_id,
    client_run_id: task.client_run_id,
    run_input_hash: task.run_input_hash,
    workflow_tab_id: task.workflow_tab_id,
    workflow_canvas_epoch: task.workflow_canvas_epoch,
    executionTime: 1,
    runtimeFingerprint: task.runtimeFingerprint,
    deterministicMode: null,
    runtimeHints: {
      ...structuredClone(apiGraph.runtimeHints),
      controlledArtifacts: [],
      loaderContract: ['modules.DiffusersImage.LoadPipeline'],
    },
    runtimeBudget: { applied: false, reason: 'Runtime hints did not target a CUDA device.' },
    runtimeMeasurement: task.runtimeMeasurement,
    runtimePreparation: null,
    resourceRetryHistory: [],
  };
  const target = {
    workflowId: `${modelType}:${taskMode}`,
    modelType,
    task: taskMode,
    modelSet: base.modelIdentities.map(({ repoId, selectedRevision }) => ({ repoId, revision: selectedRevision })),
  };
  return {
    ...base,
    executedOutput: output,
    executionReceipt: task,
    canonicalAccountingProof: { expectedApiGraph, target, run, graphCompleted },
  };
}

const projection = (value, reader = canonicalAccountingExecutionPlan) => {
  const { expectedApiGraph, target, run, graphCompleted } = value.canonicalAccountingProof;
  return reader({
    expectedApiGraph,
    target,
    apiGraph: value.apiGraph,
    consumed: value.executedOutput.resolvedExecutionInputs,
    runtimeEvidence: { run, graphCompleted, output: value.executedOutput },
  });
};

test('PRX prompt variant accepts the exact cached pin and complete scoped accounting', () => {
  const before = structuredClone(syntheticPrx);
  const accepted = projection(syntheticPrx, directImagePromptAccountingExecutionPlan);
  assert.equal(accepted.plan.runtimeHintAccounting.policy, 'direct-image-prompt-runtime-hints-v1');
  assert.equal(accepted.plan.offloadMode, 'model_cpu');
  assert.deepEqual(syntheticPrx, before);
  assert.throws(() => projection(syntheticPrx), /outside the reviewed scope/u);
});

test('PRX prompt variant rejects alternate model pins, sequence accounting and controls', () => {
  const wrongOwner = structuredClone(syntheticPrx);
  const snapshot = wrongOwner.apiGraph.runtimeHints.workflowSnapshot;
  const generateNode = snapshot.nodes.find((node) => node.data.action === 'Generate');
  const setup = snapshot.nodes.find((node) => node.data.blockInstanceV2);
  setup.data.blockInstanceV2.effectiveGraph.nodes.push({ nodeId: generateNode.id, data: generateNode.data });
  snapshot.nodes = snapshot.nodes.filter((node) => node.id !== generateNode.id);
  assert.throws(
    () => projection(wrongOwner, directImagePromptAccountingExecutionPlan),
    /PRX Model Setup member scope differs/u,
  );
  const wrongPin = structuredClone(syntheticPrx);
  wrongPin.canonicalAccountingProof.target.modelSet[0].revision = 'e'.repeat(40);
  assert.throws(
    () => projection(wrongPin, directImagePromptAccountingExecutionPlan),
    /Conditional image model is outside the reviewed accounting scope/u,
  );
  const misplacedLimit = structuredClone(syntheticPrx);
  const generate = misplacedLimit.executedOutput.resolvedExecutionInputs.nodes.find((row) => row.action === 'Generate');
  const reported = generate.fieldAccounting.fields.max_sequence_length;
  reported.disposition = 'inactive';
  reported.reason = 'adapter-inactive';
  delete generate.fields.max_sequence_length;
  assert.throws(() => projection(misplacedLimit, directImagePromptAccountingExecutionPlan));
  const wrongValue = structuredClone(syntheticPrx);
  const wrongGenerate = wrongValue.executedOutput.resolvedExecutionInputs.nodes.find(
    (row) => row.action === 'Generate',
  );
  wrongGenerate.fieldAccounting.fields.max_sequence_length.value = 224;
  wrongGenerate.fields.max_sequence_length.value = 224;
  assert.throws(() => projection(wrongValue, directImagePromptAccountingExecutionPlan));
  const incomplete = structuredClone(syntheticPrx);
  const incompleteGenerate = incomplete.executedOutput.resolvedExecutionInputs.nodes.find(
    (row) => row.action === 'Generate',
  );
  delete incompleteGenerate.fieldAccounting.fields.cfg_normalize;
  assert.throws(() => projection(incomplete, directImagePromptAccountingExecutionPlan));
});

test('saved SD1.5 stage owners still require the original native completion evidence', () => {
  const block = (actions) => ({
    data: { blockInstanceV2: { effectiveGraph: { nodes: actions.map((action) => ({ data: { action } })) } } },
  });
  const preview = { data: { action: 'Preview' } };
  const setup = block(['LoadPipeline', 'PipelineQuantizationConfigV2', 'DiffusersExecutionRecipe']);
  const generate = block(['Generate']);
  const verify = (modelType, nodes) =>
    directImagePromptRuntimeHintAccounting({
      plan: { modelType },
      apiGraph: { runtimeHints: { workflowSnapshot: { nodes } } },
    });
  assert.throws(() => verify('StableDiffusionPipeline', [preview, setup, generate]), /original completion evidence/u);
  assert.throws(
    () => verify('StableDiffusionPipeline', [preview, setup, block(['Preview'])]),
    /Saved SD1.5 Generate member scope differs/u,
  );
  assert.throws(
    () => verify('StableDiffusionPipeline', [preview, setup, { data: { action: 'Generate' } }]),
    /exact saved stage owners/u,
  );
  assert.throws(() => verify('PRXPipeline', [preview, setup, generate]), /exact saved stage owners/u);
  assert.throws(() => verify('SanaSprintPipeline', [preview, setup, generate]), /outside reviewed scope/u);
});

test('staged PixArt evidence derives a correlated Expert CPU-offload plan without altering the originals', () => {
  const before = structuredClone(synthetic);
  const result = projection(synthetic);
  assert.equal(result.plan.runtimeHintAccounting.policy, 'canonical-pixart-sigma-pag-runtime-hints-v1');
  assert.equal(result.plan.runtimeHintAccounting.route, 'correlation-only');
  assert.equal(result.plan.offloadMode, 'model_cpu');
  assert.equal(result.plan.deviceMap, 'none');
  assert.equal(createRunProvenance(synthetic).graph.executionPlanHash, result.hash);
  assert.deepEqual(synthetic, before);
});

test('staged PixArt evidence rejects missing, relabelled, or contradictory native controls and authorities', () => {
  const cases = [
    [
      ({ fields }) => {
        delete fields.pag_scale;
      },
      /literal field set differs/,
    ],
    [
      ({ fields }) => {
        fields.pag_adaptive_scale.value = 1;
      },
      /Effective control differs/,
    ],
    [
      ({ fields }) => {
        fields.seed.inputValue = 0;
      },
      /Requested literal differs/,
    ],
    [
      ({ fields }) => {
        fields.image_contract.sha256 = '0'.repeat(64);
      },
      /Metadata contract hash differs/,
    ],
    [
      ({ fields }) => {
        fields.layers.disposition = 'consumed';
        delete fields.layers.reason;
      },
      /Wrong disposition/,
    ],
    [
      ({ row }) => {
        row.fields.conditioning_scale.value = 1;
      },
      /Inactive legacy control/,
    ],
    [
      ({ row }) => {
        delete row.fieldAccounting;
      },
      /accounting section keys/i,
    ],
    [
      ({ proof }) => {
        delete proof.graphCompleted;
      },
      /Original completion frame/,
    ],
    [
      ({ proof }) => {
        proof.graphCompleted.run_input_hash = 'other';
      },
      /Completion run_input_hash/,
    ],
    [
      ({ proof }) => {
        proof.target.modelSet[0].revision = '1'.repeat(40);
      },
      /outside the reviewed accounting scope/,
    ],
    [
      ({ value }) => {
        value.apiGraph.runtimeHints.source = 'studio';
      },
      /transport-only hints/,
    ],
    [
      ({ value }) => {
        value.executedOutput.mediaItems[0].width = 768;
      },
      /output width differs/,
    ],
  ];
  for (const [mutate, expected] of cases) {
    const value = structuredClone(synthetic);
    const row = value.executedOutput.resolvedExecutionInputs.nodes.find((entry) => entry.action === 'Generate');
    mutate({ value, row, fields: row.fieldAccounting.fields, proof: value.canonicalAccountingProof });
    assert.throws(() => projection(value), expected);
    assert.throws(() => createRunProvenance(value), expected);
  }
});

for (const { modelType, evidencePath } of retainedProfiles) {
  test(`${modelType} joins the resident automatic-attention proof and rejects contradictory receipts`, () => {
    const value = syntheticRetained.get(modelType);
    const original = structuredClone(value);
    const result = projection(value);
    assert.equal(result.plan.runtimeHintAccounting.policy, 'canonical-retained-unconditional-runtime-hints-v1');
    assert.equal(result.plan.runtimeHintAccounting.route, 'correlation-only');
    assert.equal(result.plan.attentionBackend, 'auto');
    assert.equal(result.plan.offloadMode, 'none');
    assert.equal(result.plan.deviceMap, 'cuda');
    assert.equal(createRunProvenance(value).graph.executionPlanHash, result.hash);
    assert.deepEqual(value, original);
    for (const [mutate, message] of [
      [
        (candidate) => {
          const generate = candidate.executedOutput.resolvedExecutionInputs.nodes.find(
            (row) => row.action === 'UnconditionalGenerate',
          );
          generate.fieldAccounting.fields.eta.disposition = 'consumed';
          delete generate.fieldAccounting.fields.eta.reason;
        },
        /Wrong disposition/,
      ],
      [
        (candidate) => {
          candidate.executionReceipt.runtimeFingerprint.packages.platform = 'Unreviewed-operating-system';
        },
        /Retained platform differs/,
      ],
      [
        (candidate) => {
          candidate.executionReceipt.runtimeMeasurement.backend = 'cpu';
        },
        /Retained measurement backend differs/,
      ],
      [
        (candidate) => {
          candidate.canonicalAccountingProof.target.modelSet[0].revision = '0'.repeat(40);
        },
        /Retained unconditional model is outside the reviewed scope/,
      ],
      [
        (candidate) => {
          candidate.executedOutput.mediaItems[0].height += 1;
        },
        /Retained unconditional output height differs/,
      ],
      [
        (candidate) => {
          delete candidate.canonicalAccountingProof.graphCompleted;
        },
        /Original completion frame/,
      ],
    ]) {
      const changed = structuredClone(value);
      mutate(changed);
      assert.throws(() => projection(changed), message);
      assert.throws(() => createRunProvenance(changed), message);
    }
  });

  test(
    `${modelType} validates the retained original workflow, native task, and WebP`,
    { skip: !evidencePath },
    async () => {
      const workflowId = `${modelType}:unconditional_image`;
      const original = readFileSync(evidencePath);
      const { receipt, provenance } = await readCanonicalWorkflowEvidence({
        clientRoot,
        backendRoot,
        workflowId,
        evidencePath,
      });
      assert.equal(receipt.workflowId, workflowId);
      assert.equal(receipt.proofKind, 'real_backend_weights');
      assert.ok(Object.values(receipt.qualificationClaims).every((claim) => claim === false));
      assert.equal(provenance.graph.executionPlan.attentionBackend, 'auto');
      assert.deepEqual(readFileSync(evidencePath), original);
    },
  );
}
