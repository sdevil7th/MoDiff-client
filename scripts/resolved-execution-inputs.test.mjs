import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalAccountingExecutionPlan } from './release-contract-core.mjs';
import { canonicalJsonHash } from './canonical-json.mjs';
import { actualAppliedAdapterFixtures, protocolFactoryArguments } from './canonical-provenance-fixtures.mjs';
import { createRunProvenance, validateAppliedAdapterProof } from './live-proof-provenance.mjs';

let server, contracts, inputs, outputUtils, profiles, tasks;
let ddimAccountingFixture;
function actualDdimAccountingFixture() {
  if (ddimAccountingFixture) return structuredClone(ddimAccountingFixture);
  const backend = fileURLToPath(new URL('../../MoDiff/', import.meta.url));
  const python =
    process.env.MODIFF_BACKEND_PYTHON ||
    `${backend}.venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`;
  const generated = spawnSync(
    python,
    [
      '-B',
      '-c',
      String.raw`
import importlib.util, json
from pathlib import Path
from pytest import MonkeyPatch
spec = importlib.util.spec_from_file_location('ddim_protocol', Path('tests/test_canonical_field_accounting.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with MonkeyPatch.context() as patch:
    graph = module.ddim_graph()
    receipt, _, _, _ = module.run_ddim(patch, graph)
print(json.dumps({'apiGraph': graph, 'receipt': receipt}))
`,
    ],
    { cwd: backend, encoding: 'utf8', maxBuffer: 2_000_000 },
  );
  assert.equal(generated.status, 0, generated.stderr);
  ddimAccountingFixture = JSON.parse(generated.stdout);
  return structuredClone(ddimAccountingFixture);
}

function canonicalAccountingCase() {
  const { apiGraph, receipt } = actualDdimAccountingFixture();
  const loader = Object.values(apiGraph.nodes).find((node) => node.action === 'LoadPipeline');
  return {
    apiGraph,
    expectedApiGraph: structuredClone(apiGraph),
    consumed: receipt,
    target: {
      modelType: 'DDIMPipeline',
      task: 'unconditional_image',
      modelSet: [{ repoId: loader.params.model_id.value.value, revision: loader.params.revision.value }],
    },
  };
}

test('mocked native DDIM accounting derives the unique executed owner without borrowing Preview CPU or hints', () => {
  const value = canonicalAccountingCase();
  const graphBefore = JSON.stringify(value.apiGraph);
  const receiptBefore = JSON.stringify(value.consumed);
  const result = canonicalAccountingExecutionPlan(value);
  assert.equal(result.ownerId, 'node-01');
  assert.equal(result.plan.modelType, 'DDIMPipeline');
  assert.equal(result.plan.dtype, 'float32');
  assert.equal(result.plan.device, 'cuda:0');
  assert.equal(result.plan.deviceMap, 'cuda', 'effective loader placement, not requested none');
  assert.equal(result.plan.quantizationMode, 'none');
  assert.equal(result.plan.offloadMode, 'none');
  assert.equal(result.plan.autoOffload, false);
  assert.equal(result.plan.resourceMode, 'expert');
  assert.equal(result.plan.modelRepo, value.target.modelSet[0].repoId);
  assert.match(result.hash, /^sha256:execution-plan-v1:[a-f0-9]{64}$/u);
  assert.equal(value.apiGraph.runtimeHints, undefined);
  assert.equal(JSON.stringify(value.apiGraph), graphBefore, 'never synthesize hints or rewrite original graph');
  assert.equal(JSON.stringify(value.consumed), receiptBefore, 'never rewrite native evidence');
  assert.equal(result.qualified, undefined, 'a recipe join is not release or native qualification');
});

test('canonical accounting joins reject effective-control, metadata and producer forgeries', () => {
  const section = (value, action) => value.consumed.nodes.find((row) => row.action === action).fieldAccounting;
  const mutations = {
    'changed effective loader device': (value) => {
      section(value, 'LoadPipeline').fields.device.value = 'cpu:0';
    },
    'changed actual generator steps': (value) => {
      section(value, 'UnconditionalGenerate').fields.num_inference_steps.value = 1;
    },
    'invented inactive control': (value) => {
      section(value, 'UnconditionalGenerate').fields.num_inference_steps.disposition = 'inactive';
      section(value, 'UnconditionalGenerate').fields.num_inference_steps.reason = 'adapter-inactive';
    },
    'forged consumed class label': (value) => {
      section(value, 'UnconditionalGenerate').fields.class_label.disposition = 'consumed';
      delete section(value, 'UnconditionalGenerate').fields.class_label.reason;
    },
    'requested control differs': (value) => {
      section(value, 'LoadPipeline').fields.enable_vae_slicing.inputValue = false;
    },
    'wrong scalar origin': (value) => {
      section(value, 'UnconditionalGenerate').fields.seed.source = 'override';
    },
    'missing literal': (value) => {
      delete section(value, 'UnconditionalGenerate').fields.batch_size;
    },
    'unknown field': (value) => {
      section(value, 'UnconditionalGenerate').fields.unknown = {
        disposition: 'consumed',
        source: 'literal',
        inputValue: 1,
        value: 1,
      };
    },
    'forged metadata': (value) => {
      section(value, 'UnconditionalGenerate').fields.image_contract.sha256 = 'a'.repeat(64);
    },
    'wrong recipe producer': (value) => {
      section(value, 'LoadPipeline').inputProjections.execution_recipe.sourceNodeId = 'node-02';
    },
    'wrong recipe producer port': (value) => {
      section(value, 'LoadPipeline').inputProjections.execution_recipe.sourcePortId = 'summary';
    },
    'forged producer projection hash': (value) => {
      section(value, 'DiffusersExecutionRecipe').outputProjections.execution_recipe.sha256 = 'a'.repeat(64);
    },
    'forged matching projection values': (value) => {
      section(value, 'LoadPipeline').inputProjections.execution_recipe.values.device = 'cpu:0';
      section(value, 'DiffusersExecutionRecipe').outputProjections.execution_recipe.values.device = 'cpu:0';
    },
    'missing quantizer projection': (value) => {
      section(value, 'PipelineQuantizationConfigV2').outputProjections = {};
    },
    'enabled quantizer': (value) => {
      section(value, 'PipelineQuantizationConfigV2').outputProjections.quantization_config.values.disabled = false;
    },
    'unaccounted fields': (value) => {
      section(value, 'LoadPipeline').unaccountedFields = ['unknown'];
    },
    'truncated accounting': (value) => {
      value.consumed.fieldAccountingStatus.truncated = true;
    },
    'missing accounting': (value) => {
      delete value.consumed.nodes[0].fieldAccounting;
    },
    'wrong immutable model': (value) => {
      value.target.modelSet[0].revision = 'a'.repeat(40);
    },
    'unsupported model': (value) => {
      value.target.modelType = 'UnknownPipeline';
    },
    'conflicting invented runtime hints': (value) => {
      value.apiGraph.runtimeHints = { resourceMode: 'auto' };
    },
    'ambiguous owner': (value) => {
      value.consumed.nodes[1].nodeId = value.consumed.nodes[0].nodeId;
    },
    'changed original graph': (value) => {
      value.apiGraph.nodes['node-04'].params.num_inference_steps.value = 1;
    },
    'legacy scalar contradicts new accounting': (value) => {
      value.consumed.nodes.find((row) => row.action === 'UnconditionalGenerate').fields.num_inference_steps.value = 1;
    },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const value = canonicalAccountingCase();
    mutate(value);
    assert.throws(() => canonicalAccountingExecutionPlan(value), undefined, label);
  }
});
before(async () => {
  globalThis.window = { location: { origin: 'http://localhost' } };
  // These SSR imports never use HMR. Middleware mode alone still watches the
  // repository and local Gallery assets, consuming inotify entries in parallel tests.
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  contracts = await server.ssrLoadModule('/src/studio/outputContracts.ts');
  inputs = await server.ssrLoadModule('/src/studio/resolvedExecutionInputs.ts');
  outputUtils = await server.ssrLoadModule('/src/studio/outputUtils.ts');
  profiles = await server.ssrLoadModule('/src/studio/modelProfiles.ts');
  tasks = await server.ssrLoadModule('/src/studio/outputTaskDisplay.ts');
});
after(async () => {
  await server?.close();
  delete globalThis.window;
});

test('actual mocked DDIM native accounting survives history without changing legacy v1 bytes', () => {
  // Real five-node canonical export and native accounting, mocked allocation and
  // inference only. This fixture is not a native/model/hardware qualification.
  const { receipt: capture } = actualDdimAccountingFixture();
  const identity = { taskId: capture.taskId, attemptIndex: capture.attemptIndex, nodeId: capture.nodeId };
  const legacy = structuredClone(capture);
  delete legacy.fieldAccountingStatus;
  for (const row of legacy.nodes) delete row.fieldAccounting;
  const before = JSON.stringify(inputs.coerceResolvedExecutionInputs(legacy, identity));
  const normalized = inputs.coerceResolvedExecutionInputs(capture, identity);
  assert.ok(
    normalized.nodes.every((row) => row.fieldAccounting?.complete),
    'new accounting must survive parsing',
  );
  assert.deepEqual(normalized.fieldAccountingStatus, { schemaVersion: 1, truncated: false });
  const stripped = structuredClone(normalized);
  delete stripped.fieldAccountingStatus;
  for (const row of stripped.nodes) delete row.fieldAccounting;
  assert.equal(JSON.stringify(stripped), before, 'the optional extension must not alter any normalized legacy byte');
  const restored = contracts.coerceStudioOutput({
    id: 'protocol-only',
    url: '/fixture.png',
    ...identity,
    resolvedExecutionInputs: capture,
  });
  assert.deepEqual(restored.resolvedExecutionInputs, normalized);
  assert.equal(JSON.stringify(inputs.coerceResolvedExecutionInputs(legacy, identity)), before);
});

test('the actual Python image utility producer retains scoped controls and ordered hashes in history', () => {
  const backend = fileURLToPath(new URL('../../MoDiff/', import.meta.url));
  const python =
    process.env.MODIFF_BACKEND_PYTHON ||
    `${backend}.venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`;
  const produced = spawnSync(
    python,
    [
      '-B',
      '-c',
      String.raw`
import json
from modiff.execution_input_provenance import capture_generation_inputs, build_resolved_execution_inputs
cases = [
 ('Image','Load',{'alpha_channel':'ignore','source_hashes':['a'*64,'b'*64], 'source_widths':[512,1024], 'source_heights':[512,1024], 'source_modes':['RGB','L']}),
 ('Image','Resize',{'width':768,'height':1280,'method':'pad','multiple_of':1,'interpolation':'lanczos'}),
 ('ImageOperations','ResizeImage',{'fit_mode':'contain','resampling':'bicubic'}),
 ('ImageOperations','CropImage',{'x':0,'y':165,'width':1024,'height':1024}),
 ('ImageOperations','MaskComposite',{'mask_channel':'luminance','invert_mask':False}),
 ('Image','Save',{'filename':'studio/outputs/composite_{HASH:12}.png','quality':100}),
]
nodes, records = {}, {}
for i,(module,action,values) in enumerate(cases):
 key='node-'+str(i)
 node={'module':'modules.'+module,'action':action,'params':({'image':{'sourceId':'node-'+str(i-1),'sourceKey':'output'}} if i else {})}
 nodes[key]=node
 records[key]=capture_generation_inputs(key,node,{**values,'token':'not-evidence'})
receipt=build_resolved_execution_inputs({'nodes':nodes},records,task_id='protocol-only',attempt_index=0,node_id='node-5')
print(json.dumps(receipt))
`,
    ],
    { cwd: backend, encoding: 'utf8', maxBuffer: 300_000 },
  );
  assert.equal(produced.status, 0, produced.stderr);
  const capture = JSON.parse(produced.stdout);
  const original = JSON.stringify(capture);
  const identity = { taskId: capture.taskId, attemptIndex: 0, nodeId: capture.nodeId };
  const parsed = inputs.coerceResolvedExecutionInputs(capture, identity);
  assert.ok(parsed, 'the compatible client must retain the genuine producer contract');
  const load = parsed.nodes.find((node) => node.action === 'Load');
  assert.deepEqual(load.fields.source_hashes.value, ['a'.repeat(64), 'b'.repeat(64)]);
  assert.deepEqual(load.fields.source_modes.value, ['RGB', 'L']);
  assert.equal(parsed.nodes.find((node) => node.action === 'CropImage').fields.y.value, 165);
  assert.equal(parsed.nodes.find((node) => node.action === 'MaskComposite').fields.invert_mask.value, false);
  assert.equal(JSON.stringify(capture), original, 'no receipt rewrites');
  assert.equal(original.includes('not-evidence'), false);
  const restored = contracts.coerceStudioOutput({
    id: 'image-utility-protocol',
    url: '/fixture.png',
    ...identity,
    resolvedExecutionInputs: capture,
  });
  assert.deepEqual(restored.resolvedExecutionInputs, parsed);
  const moved = structuredClone(capture);
  moved.nodes[0].action = 'UnreviewedAction';
  assert.equal(
    inputs.coerceResolvedExecutionInputs(moved, identity),
    undefined,
    'scoped fields cannot move to another action',
  );
  const reordered = structuredClone(capture);
  reordered.nodes.find((node) => node.action === 'Load').fields.source_hashes.value.reverse();
  assert.equal(
    inputs.coerceResolvedExecutionInputs(reordered, identity),
    undefined,
    'a summary cannot borrow reordered input evidence',
  );
});

test('optional accounting rejects unknown scopes, objects, origins, projections and incomplete claims', () => {
  const { receipt: original } = actualDdimAccountingFixture();
  const identity = { taskId: original.taskId, attemptIndex: original.attemptIndex, nodeId: original.nodeId };
  const quant = (value) => value.nodes.find((row) => row.action === 'PipelineQuantizationConfigV2');
  const recipeNode = (value) => value.nodes.find((row) => row.action === 'DiffusersExecutionRecipe');
  const changes = {
    'unknown scope': (value) => {
      quant(value).action = 'Unknown';
    },
    'unknown accounting field': (value) => {
      quant(value).fieldAccounting.fields.token = {
        disposition: 'consumed',
        inputValue: 'private',
        value: 'private',
        source: 'literal',
      };
    },
    'opaque value': (value) => {
      quant(value).fieldAccounting.fields.backend.value = { private: true };
    },
    'extra field key': (value) => {
      quant(value).fieldAccounting.fields.backend.token = 'private';
    },
    'unknown disposition': (value) => {
      quant(value).fieldAccounting.fields.backend.disposition = 'approved';
    },
    'invented reason': (value) => {
      quant(value).fieldAccounting.fields.dtype.reason = 'approved';
    },
    'connected origin missing port': (value) => {
      delete recipeNode(value).fieldAccounting.inputProjections.quantization_config.sourcePortId;
    },
    'stale literal origin': (value) => {
      quant(value).fieldAccounting.fields.backend.sourceNodeId = 'old';
    },
    'unknown projection field': (value) => {
      quant(value).fieldAccounting.outputProjections.quantization_config.values.secret = 'private';
    },
    'enabled quantization': (value) => {
      quant(value).fieldAccounting.outputProjections.quantization_config.values.disabled = false;
    },
    'wrong projection kind': (value) => {
      quant(value).fieldAccounting.outputProjections.quantization_config.kind = 'runtime-object';
    },
    'missing projection': (value) => {
      quant(value).fieldAccounting.outputProjections = {};
    },
    'false complete': (value) => {
      quant(value).fieldAccounting.omittedFields.backend = 'missing';
    },
    'missing status': (value) => {
      delete value.fieldAccountingStatus;
    },
    'unknown status version': (value) => {
      value.fieldAccountingStatus.schemaVersion = 2;
    },
    'oversize section': (value) => {
      quant(value).fieldAccounting.unaccountedFields = Array(20).fill('x'.repeat(16000));
      quant(value).fieldAccounting.complete = false;
    },
  };
  for (const [label, change] of Object.entries(changes)) {
    const value = structuredClone(original);
    change(value);
    assert.equal(inputs.coerceResolvedExecutionInputs(value, identity), undefined, label);
  }
  const partial = structuredClone(original);
  partial.fieldAccountingStatus.truncated = true;
  delete quant(partial).fieldAccounting;
  recipeNode(partial).fieldAccounting = {
    schemaVersion: 1,
    fields: {},
    inputProjections: {},
    outputProjections: {},
    unaccountedFields: [],
    omittedFields: { accounting: 'record-size-limit' },
    complete: false,
  };
  const parsed = inputs.coerceResolvedExecutionInputs(partial, identity);
  assert.equal(parsed.fieldAccountingStatus.truncated, true);
  assert.equal(recipeNode(parsed).fieldAccounting.complete, false);
  assert.equal(parsed.truncated, false, 'optional extension limits never change v1 truncation');
  assert.deepEqual(parsed.summary, original.summary);
  const old = receipt();
  const legacyIdentity = { taskId: 'actual-task', attemptIndex: 2, nodeId: 'preview' };
  assert.equal(JSON.stringify(inputs.coerceResolvedExecutionInputs(old, legacyIdentity)), JSON.stringify(old));
});

test('SSR receipt imports and explicit watch requests allocate no filesystem watchers', () => {
  assert.equal(server.config.server.watch, null);
  assert.deepEqual(server.watcher.getWatched(), {});
  server.watcher.add([
    fileURLToPath(new URL('../src/studio/resolvedExecutionInputs.ts', import.meta.url)),
    fileURLToPath(new URL('../public/template-gallery', import.meta.url)),
  ]);
  assert.deepEqual(server.watcher.getWatched(), {});
});

test('receipt-free records never present coercion defaults as recorded task, model or numeric inputs', () => {
  for (const displayType of ['text', 'json', 'image', 'video', 'audio']) {
    const output = contracts.coerceStudioOutput({ id: 'unrecorded', url: '/asset', displayType });
    for (const restored of [output, contracts.coerceStudioOutput(JSON.parse(JSON.stringify(output)))]) {
      assert.equal(tasks.outputTaskDisplay(restored), 'Task not captured');
      assert.equal(inputs.outputModelKey(restored), 'uncaptured-model');
      assert.equal(restored.modelLabel, 'Model not captured');
      for (const key of ['seed', 'width', 'height', 'steps', 'guidanceScale', 'numFrames', 'fps']) {
        assert.equal(inputs.outputNumericInputValue(restored, key), undefined);
      }
    }
  }
});

test('explicit legacy settings retain zero values and survive history without borrowing omitted fields', () => {
  const output = contracts.coerceStudioOutput({
    id: 'legacy-partial',
    url: '/clip.mp4',
    seed: 0,
    formSnapshot: { mode: 'text_to_video', modelType: 'WanVideoPipeline', fps: 15, numFrames: 81 },
  });
  for (const restored of [output, contracts.coerceStudioOutput(JSON.parse(JSON.stringify(output)))]) {
    assert.equal(tasks.outputTaskDisplay(restored), 'Text to video');
    assert.equal(inputs.outputModelKey(restored), 'WanVideoPipeline');
    assert.equal(inputs.outputNumericInputValue(restored, 'seed'), 0);
    assert.equal(inputs.outputNumericInputValue(restored, 'fps'), 15);
    assert.equal(inputs.outputNumericInputValue(restored, 'numFrames'), 81);
    assert.equal(inputs.outputNumericInputValue(restored, 'steps'), undefined);
  }
});

function capturedOutput(fields, extra = {}) {
  const evidence = receipt();
  evidence.nodes[0].fields = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, { value, source: 'literal' }]),
  );
  const names = { model_type: 'modelType', num_inference_steps: 'steps', guidance_scale: 'guidanceScale' };
  evidence.summary = Object.fromEntries(Object.entries(fields).map(([key, value]) => [names[key] ?? key, value]));
  return contracts.coerceStudioOutput({
    id: 'captured',
    url: '/image.webp',
    taskId: 'actual-task',
    attemptIndex: 2,
    nodeId: 'preview',
    modelType: 'ZImageModularPipeline',
    modelLabel: 'Z-Image Turbo',
    steps: 9,
    guidanceScale: 1,
    formSnapshot: { modelType: 'ZImageModularPipeline', steps: 9, guidanceScale: 1 },
    resolvedExecutionInputs: evidence,
    ...extra,
  });
}

test('captured model identity replaces stale labels for every registered model and custom pipelines', () => {
  for (const [modelType, profile] of Object.entries(profiles.STUDIO_MODEL_PROFILES)) {
    const output = capturedOutput({ model_type: modelType });
    assert.equal(output.modelType, modelType);
    assert.equal(output.modelLabel, profile.label);
    assert.equal(inputs.outputModelKey(output), modelType);
    assert.equal(output.formSnapshot.modelType, 'ZImageModularPipeline');
    const restored = contracts.coerceStudioOutput(JSON.parse(JSON.stringify(output)));
    assert.equal(restored.modelLabel, profile.label);
  }
  for (const modelType of ['CustomModularPipeline', 'AnotherCustomPipeline', 'constructor']) {
    const output = capturedOutput({ model_type: modelType });
    assert.equal(output.modelLabel, modelType);
    assert.equal(inputs.outputModelKey(output), modelType, 'custom models must not share the legacy fallback filter');
  }
  const legacy = capturedOutput({}, { resolvedExecutionInputs: undefined, modelLabel: 'My historical alias' });
  assert.equal(legacy.modelLabel, 'My historical alias');
  assert.equal(inputs.outputModelKey(legacy), 'ZImageModularPipeline');
});

test('missing, ambiguous and incomplete model evidence never labels a run with the starting form model', () => {
  const missing = capturedOutput({});
  const ambiguous = structuredClone(missing.resolvedExecutionInputs);
  ambiguous.nodes[0].fields.model_type = { value: 'FluxModularPipeline', source: 'literal' };
  ambiguous.nodes.push({
    ...structuredClone(ambiguous.nodes[0]),
    nodeId: 'other',
    fields: { model_type: { value: 'StableDiffusionXLModularPipeline', source: 'literal' } },
  });
  ambiguous.ambiguousFields = ['modelType'];
  const incomplete = structuredClone(ambiguous);
  incomplete.truncated = true;
  incomplete.unavailableFields = ['modelType'];
  for (const evidence of [missing.resolvedExecutionInputs, ambiguous, incomplete]) {
    const output = capturedOutput({}, { resolvedExecutionInputs: evidence });
    assert.ok(output.resolvedExecutionInputs);
    assert.equal(output.modelLabel, 'Model not uniquely captured');
    assert.equal(inputs.outputModelKey(output), 'uncaptured-model');
  }
});

test('numeric string display preserves raw receipts and forms across history reload', () => {
  for (const [raw, expected] of [
    ['32', 32],
    ['6.5', 6.5],
    ['0', 0],
    ['.62', 0.62],
    ['  +3.2e1  ', 32],
  ]) {
    let output = capturedOutput({ num_inference_steps: raw, guidance_scale: raw });
    const original = structuredClone(output.resolvedExecutionInputs);
    for (let reload = 0; reload < 2; reload++) {
      assert.equal(inputs.outputInputDisplay(output, 'steps'), expected);
      assert.equal(inputs.outputNumericInputValue(output, 'guidanceScale'), expected);
      assert.deepEqual(output.resolvedExecutionInputs, original);
      assert.equal(output.formSnapshot.steps, 9);
      output = contracts.coerceStudioOutput(JSON.parse(JSON.stringify(output)));
    }
  }
  for (const raw of [
    '',
    ' ',
    '0x20',
    '0b10',
    '32px',
    'NaN',
    'Infinity',
    '1e400',
    '9007199254740993',
    true,
    null,
    ['32'],
  ]) {
    const output = capturedOutput({ num_inference_steps: raw });
    assert.equal(inputs.outputNumericInputValue(output, 'steps'), undefined, JSON.stringify(raw));
    assert.match(inputs.outputInputDisplay(output, 'steps'), /Not uniquely captured/);
  }
  const output = capturedOutput({ num_inference_steps: '32' });
  const evidence = structuredClone(output.resolvedExecutionInputs);
  evidence.nodes.push({
    ...structuredClone(evidence.nodes[0]),
    nodeId: 'other',
    fields: { num_inference_steps: { value: 32, source: 'literal' } },
  });
  evidence.summary = {};
  evidence.ambiguousFields = ['steps'];
  const mixed = capturedOutput({}, { resolvedExecutionInputs: evidence });
  assert.ok(mixed.resolvedExecutionInputs);
  assert.equal(
    inputs.outputNumericInputValue(mixed, 'steps'),
    undefined,
    'display parsing cannot erase capture ambiguity',
  );
});

function receipt() {
  return {
    schemaVersion: 1,
    source: 'backend-execution',
    taskId: 'actual-task',
    attemptIndex: 2,
    nodeId: 'preview',
    nodes: [
      {
        nodeId: 'encode',
        module: 'modules.ModularDiffusers',
        action: 'Step',
        fields: {
          prompt: {
            value: 'Actual wired complex workshop prompt',
            source: 'connected',
            sourceNodeId: 'text',
            sourcePortId: 'output',
          },
          num_inference_steps: { value: 50, source: 'literal' },
          width: { value: 1328, source: 'literal' },
        },
        omittedFields: {},
      },
    ],
    summary: { prompt: 'Actual wired complex workshop prompt', steps: 50, width: 1328 },
    ambiguousFields: [],
    unavailableFields: [],
    uncapturedNodeIds: [],
    truncated: false,
  };
}

function appliedAdapterReceipt(observation = 'activated') {
  const capture = receipt();
  const adapters = [0, 1, 0.75].map((scale, index) => ({
    adapterName: `protocol_${index}`,
    scale,
    descriptorSha256: String(index + 1).repeat(64),
    artifact: {
      source: 'hub',
      repository: `protocol/adapter-${index}`,
      revision: 'a'.repeat(40),
      weightName: 'adapter.safetensors',
      sha256: String(index + 4).repeat(64),
    },
    scheduler: null,
  }));
  capture.nodes.push({
    nodeId: 'loader',
    module: 'modules.ModularDiffusers',
    action: 'ModelsLoader',
    fields: {},
    omittedFields: {},
    appliedAdapters: {
      schemaVersion: 1,
      status: 'complete',
      source: 'backend-adapter-application',
      applicationId: 'a'.repeat(32),
      observation,
      adapters,
      stateSha256: `sha256:applied-adapters-v1:${canonicalJsonHash({ adapters })}`,
    },
  });
  capture.appliedAdaptersStatus = { schemaVersion: 1, truncated: false };
  return capture;
}

test('applied adapter observations survive history without changing any legacy receipt byte', () => {
  for (const observation of ['activated', 'reused']) {
    const capture = appliedAdapterReceipt(observation);
    const identity = { taskId: capture.taskId, attemptIndex: capture.attemptIndex, nodeId: capture.nodeId };
    const legacy = structuredClone(capture);
    delete legacy.appliedAdaptersStatus;
    delete legacy.nodes[1].appliedAdapters;
    const before = JSON.stringify(inputs.coerceResolvedExecutionInputs(legacy, identity));
    const result = inputs.coerceResolvedExecutionInputs(capture, identity);
    assert.deepEqual(result.nodes[1].appliedAdapters, capture.nodes[1].appliedAdapters);
    assert.deepEqual(result.appliedAdaptersStatus, capture.appliedAdaptersStatus);
    const stripped = structuredClone(result);
    delete stripped.appliedAdaptersStatus;
    delete stripped.nodes[1].appliedAdapters;
    assert.equal(JSON.stringify(stripped), before);
    const restored = contracts.coerceStudioOutput({
      id: 'protocol-only',
      url: '/fixture.png',
      ...identity,
      resolvedExecutionInputs: capture,
    });
    assert.deepEqual(restored.resolvedExecutionInputs, result);
  }
  const unicodeAlias = appliedAdapterReceipt();
  unicodeAlias.nodes[1].appliedAdapters.adapters[0].artifact.weightName = '😀'.repeat(140) + '.safetensors';
  assert.ok(
    inputs.coerceResolvedExecutionInputs(unicodeAlias, unicodeAlias),
    'Backend alias bounds count Unicode code points.',
  );
});

test('actual backend applied adapter producer survives history and locks Python numeric and lifecycle identities', () => {
  for (const [kind, { receipt: capture, originalReceipt, apiGraph }] of Object.entries(
    actualAppliedAdapterFixtures(),
  )) {
    const identity = { taskId: capture.taskId, attemptIndex: capture.attemptIndex, nodeId: capture.nodeId };
    const parsed = inputs.coerceResolvedExecutionInputs(capture, identity);
    assert.ok(parsed, kind);
    const original = capture.nodes.find((node) => node.appliedAdapters)?.appliedAdapters;
    assert.deepEqual(parsed.nodes.find((node) => node.appliedAdapters)?.appliedAdapters, original, kind);
    const restored = contracts.coerceStudioOutput({
      id: 'protocol-only',
      url: '/fixture.png',
      ...identity,
      resolvedExecutionInputs: capture,
    });
    assert.deepEqual(restored.resolvedExecutionInputs, parsed);
    const args = protocolFactoryArguments(apiGraph);
    args.taskId = capture.taskId;
    args.executedOutput = {
      ...args.executedOutput,
      ...identity,
      apiGraphSnapshot: apiGraph,
      resolvedExecutionInputs: capture,
    };
    args.executionReceipt = {
      ...args.executionReceipt,
      task_id: capture.taskId,
      attempt_index: capture.attemptIndex,
      status: 'completed',
    };
    const proof = createRunProvenance(args);
    // This tiny adapter-dispatch fixture has no declared resource plan. Keep
    // that existing hold; adapter evidence must not manufacture qualification.
    const baselineArgs = structuredClone(args);
    delete baselineArgs.executedOutput.resolvedExecutionInputs;
    assert.deepEqual(proof.blockers, createRunProvenance(baselineArgs).blockers, kind);
    assert.deepEqual(proof.blockers, ['execution.resourceCandidateId is missing.'], kind);
    if (kind === 'unavailable') {
      assert.throws(() => validateAppliedAdapterProof(proof, { required: true }), /unavailable/);
      continue;
    }
    const locked = validateAppliedAdapterProof(proof, { required: true }).owners[0].application;
    assert.deepEqual(locked, original);
    assert.equal(locked.stateSha256, `sha256:applied-adapters-v1:${canonicalJsonHash({ adapters: locked.adapters })}`);
    assert.deepEqual(
      locked.adapters.map((item) => item.scale),
      kind === 'empty' ? [] : [0, 1, 0.75],
    );
    if (kind !== 'empty')
      assert.ok(locked.adapters.every((item) => item.artifact.weightName === 'weights/adapter.safetensors'));
    assert.equal(locked.observation, kind === 'reused' ? 'reused' : 'activated');
    if (kind === 'reused')
      assert.equal(
        locked.applicationId,
        originalReceipt.nodes.find((node) => node.appliedAdapters).appliedAdapters.applicationId,
      );
    const legacy = structuredClone(capture);
    delete legacy.appliedAdaptersStatus;
    for (const node of legacy.nodes) delete node.appliedAdapters;
    const stripped = structuredClone(parsed);
    delete stripped.appliedAdaptersStatus;
    for (const node of stripped.nodes) delete node.appliedAdapters;
    assert.equal(
      JSON.stringify(stripped),
      JSON.stringify(inputs.coerceResolvedExecutionInputs(legacy, identity)),
      kind,
    );
  }
});

test('applied adapter history rejects unknown scopes, opaque values and malformed lifecycle evidence', () => {
  const changes = {
    'foreign owner': (v) => {
      v.nodes[1].action = 'AutoModelLoader';
    },
    'foreign module': (v) => {
      v.nodes[1].module = 'modules.Foreign';
    },
    'missing status': (v) => {
      delete v.appliedAdaptersStatus;
    },
    'unknown status key': (v) => {
      v.appliedAdaptersStatus.secret = 'opaque';
    },
    'false complete envelope': (v) => {
      delete v.nodes[1].appliedAdapters;
    },
    'unknown section key': (v, a) => {
      a.localPath = '/private';
    },
    'unknown version': (v, a) => {
      a.schemaVersion = 2;
    },
    'wrong source': (v, a) => {
      a.source = 'submitted-graph';
    },
    'invalid application ID': (v, a) => {
      a.applicationId = 'A'.repeat(32);
    },
    'invented observation': (v, a) => {
      a.observation = 'assumed';
    },
    'invalid state hash': (v, a) => {
      a.stateSha256 = 'a'.repeat(64);
    },
    'too many adapters': (v, a) => {
      a.adapters = Array(33).fill(a.adapters[0]);
    },
    'oversize UTF8 payload': (v, a) => {
      a.adapters = Array.from({ length: 32 }, (_, index) => ({
        ...a.adapters[0],
        adapterName: `style_${index}`,
        artifact: { ...a.adapters[0].artifact, weightName: '界'.repeat(240) + '.safetensors' },
      }));
    },
    'duplicate names': (v, a) => {
      a.adapters[1].adapterName = a.adapters[0].adapterName;
    },
    'oversize name': (v, a) => {
      a.adapters[0].adapterName = 'a'.repeat(129);
    },
    'path name': (v, a) => {
      a.adapters[0].adapterName = 'C:/private/adapter';
    },
    'url name': (v, a) => {
      a.adapters[0].adapterName = 'https://private/adapter';
    },
    'repository url': (v, a) => {
      a.adapters[0].artifact.repository = 'https://private/adapter';
    },
    'repository alias': (v, a) => {
      a.adapters[0].artifact.repository = 'protocol/adapter.git';
    },
    'unsupported weight': (v, a) => {
      a.adapters[0].artifact.weightName = 'adapter.bin';
    },
    'boolean scale': (v, a) => {
      a.adapters[0].scale = false;
    },
    'string scale': (v, a) => {
      a.adapters[0].scale = '1';
    },
    'out of bounds scale': (v, a) => {
      a.adapters[0].scale = 21;
    },
    'opaque scale': (v, a) => {
      a.adapters[0].scale = {};
    },
    'nonfinite scale': (v, a) => {
      a.adapters[0].scale = Infinity;
    },
    'unknown descriptor digest': (v, a) => {
      a.adapters[0].descriptorSha256 = 'bad';
    },
    'opaque artifact': (v, a) => {
      a.adapters[0].artifact.private = '/private';
    },
    'coerced source': (v, a) => {
      a.adapters[0].artifact.source = ['local'];
      delete a.adapters[0].artifact.repository;
      delete a.adapters[0].artifact.revision;
    },
    'mutable revision': (v, a) => {
      a.adapters[0].artifact.revision = 'main';
    },
    'path traversal': (v, a) => {
      a.adapters[0].artifact.weightName = '../weights.safetensors';
    },
    'bad artifact digest': (v, a) => {
      a.adapters[0].artifact.sha256 = 'A'.repeat(64);
    },
    'opaque scheduler': (v, a) => {
      a.adapters[0].scheduler = { className: 'Scheduler', config: {} };
    },
    'coerced scheduler': (v, a) => {
      a.adapters[0].scheduler = [];
    },
  };
  for (const [label, mutate] of Object.entries(changes)) {
    const capture = appliedAdapterReceipt();
    mutate(capture, capture.nodes[1].appliedAdapters);
    assert.equal(inputs.coerceResolvedExecutionInputs(capture, capture), undefined, label);
  }
  for (const section of [
    { schemaVersion: 1, status: 'unavailable', reason: 'unobserved-application' },
    { schemaVersion: 1, status: 'unavailable', reason: 'owner-invalidated' },
    { schemaVersion: 1, status: 'truncated', reason: 'record-size-limit' },
  ]) {
    const capture = appliedAdapterReceipt();
    capture.nodes[1].appliedAdapters = section;
    assert.deepEqual(inputs.coerceResolvedExecutionInputs(capture, capture).nodes[1].appliedAdapters, section);
    capture.nodes[1].appliedAdapters.reason = [section.reason];
    assert.equal(inputs.coerceResolvedExecutionInputs(capture, capture), undefined);
  }
  const dropped = appliedAdapterReceipt();
  delete dropped.nodes[1].appliedAdapters;
  dropped.appliedAdaptersStatus.truncated = true;
  assert.deepEqual(
    inputs.coerceResolvedExecutionInputs(dropped, dropped).appliedAdaptersStatus,
    dropped.appliedAdaptersStatus,
  );
});

test('only the actual native loader capture accepts the exact consumed weight format', () => {
  const identity = { taskId: 'actual-task', attemptIndex: 2, nodeId: 'preview' };
  const make = (value, module = 'modules.ModularDiffusers', action = 'ModelsLoader') => {
    const capture = receipt();
    capture.nodes.push({
      nodeId: 'weight-owner',
      module,
      action,
      fields: { weight_format: { value, source: 'literal' } },
      omittedFields: {},
    });
    capture.summary.weightFormat = value;
    return capture;
  };
  for (const value of ['native', 'fp8r', 'nvfp4']) {
    for (const module of ['modules.ModularDiffusers', 'ModularDiffusers']) {
      const evidence = make(value, module);
      assert.deepEqual(inputs.coerceResolvedExecutionInputs(evidence, identity), evidence);
      const restored = contracts.coerceStudioOutput({
        id: 'weights',
        url: '/out.png',
        ...identity,
        resolvedExecutionInputs: JSON.parse(JSON.stringify(evidence)),
      });
      assert.equal(restored.resolvedExecutionInputs.summary.weightFormat, value);
      const forged = structuredClone(evidence);
      forged.summary.weightFormat = value === 'native' ? 'fp8r' : 'native';
      assert.equal(inputs.coerceResolvedExecutionInputs(forged, identity), undefined);
    }
  }
  for (const invalid of ['', 'auto', 'FP8R', true, null, 1, ['native'], {}])
    assert.equal(inputs.coerceResolvedExecutionInputs(make(invalid), identity), undefined);
  for (const [module, action] of [
    ['modules.ModularDiffusers', 'EncodePrompt'],
    ['modules.DiffusersImage', 'LoadPipeline'],
    ['modules.Foreign', 'ModelsLoader'],
  ])
    assert.equal(inputs.coerceResolvedExecutionInputs(make('native', module, action), identity), undefined);
  const wrongLabel = make('native');
  wrongLabel.summary = { ...receipt().summary, weight_format: 'native' };
  assert.equal(inputs.coerceResolvedExecutionInputs(wrongLabel, identity), undefined);
  assert.equal(inputs.coerceResolvedExecutionInputs(receipt(), identity).summary.weightFormat, undefined);
});

test('connected native NF4 consumed configuration survives strict output history as a bounded flat list', () => {
  // Match the validated backend adapter's successful snapshot, not Python
  // config objects or a client-derived claim about loaded tensor precision.
  const consumed = [
    'transformer:weight_format=nvfp4;compute_dtype=bfloat16;load_device=cpu',
    'text_encoder:quantization=bnb_4bit;quant_type=nf4;compute_dtype=bfloat16',
    'text_encoder:double_quant=true;quant_storage=uint8;load_device=cuda:0',
    'text_encoder:skip_modules=model.visual,lm_head',
    'text_encoder:converted_linear_count=252',
    'text_encoder:placement=model_cpu;current_device=cpu',
    'text_encoder:recipe_id=flux3-qwen3vl-language-nf4:v1',
    `text_encoder:signature=${'d'.repeat(64)}`,
  ];
  const backend = fileURLToPath(new URL('../../MoDiff/', import.meta.url));
  const python =
    process.env.MODIFF_BACKEND_PYTHON ||
    `${backend}.venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`;
  const generated = spawnSync(
    python,
    [
      '-B',
      '-c',
      String.raw`
import json, sys
from modiff.execution_input_provenance import capture_generation_inputs, bind_generation_input_origins, build_resolved_execution_inputs
consumed = json.load(sys.stdin)
nodes = {
    "quantization": {"module": "modules.ModularDiffusers", "action": "QuantizationConfigNode", "params": {}},
    "loader": {"module": "modules.ModularDiffusers", "action": "ModelsLoader", "params": {
        "quant_config": {"sourceId": "quantization", "sourceKey": "quantization_config"}}},
    "preview": {"module": "modules.Image", "action": "Preview", "params": {
        "image": {"sourceId": "loader", "sourceKey": "vae_out"}}},
}
args = {"model_type": "Flux3DistilledModularPipeline", "weight_format": "nvfp4",
        "quant_config": consumed, "weight_loading_mode": "cpu"}
records = {key: capture_generation_inputs(key, node, args if key == "loader" else {})
           for key, node in nodes.items()}
records["loader"] = bind_generation_input_origins("loader", nodes["loader"], records["loader"])
print(json.dumps(build_resolved_execution_inputs({"nodes": nodes}, records,
    task_id="actual-task", attempt_index=2, node_id="preview")))
`,
    ],
    { cwd: backend, encoding: 'utf8', input: JSON.stringify(consumed) },
  );
  assert.equal(generated.status, 0, generated.stderr);
  const capture = JSON.parse(generated.stdout);
  const identity = { taskId: 'actual-task', attemptIndex: 2, nodeId: 'preview' };
  const field = capture.nodes.find((node) => node.nodeId === 'loader').fields.quant_config;
  assert.deepEqual(field, {
    value: consumed,
    source: 'connected',
    sourceNodeId: 'quantization',
    sourcePortId: 'quantization_config',
  });
  assert.deepEqual(capture.summary.quantConfig, consumed);
  assert.deepEqual(inputs.coerceResolvedExecutionInputs(capture, identity), capture);
  let output = contracts.coerceStudioOutput({
    id: 'parent-nf4',
    url: '/image.webp',
    ...identity,
    resolvedExecutionInputs: capture,
  });
  for (let reload = 0; reload < 2; reload++) {
    assert.deepEqual(output.resolvedExecutionInputs, capture);
    output = contracts.coerceStudioOutput(JSON.parse(JSON.stringify(output)));
  }
  for (const invalid of [[{ recipeId: 'not-a-flat-snapshot' }], [consumed], Array(17).fill('entry')]) {
    const malformed = structuredClone(capture);
    malformed.nodes.find((node) => node.nodeId === 'loader').fields.quant_config.value = invalid;
    malformed.summary.quantConfig = invalid;
    assert.equal(inputs.coerceResolvedExecutionInputs(malformed, identity), undefined);
  }
  const changed = structuredClone(capture);
  changed.summary.quantConfig[2] = 'text_encoder:load_device=cpu';
  assert.equal(inputs.coerceResolvedExecutionInputs(changed, identity), undefined);
});

test('merged video metadata keeps requested, consumed and encoded dimensions distinct', () => {
  const value = contracts.coerceStudioOutput({
    id: 'video',
    url: '/clip.mp4',
    displayType: 'video',
    taskId: 'actual-task',
    attemptIndex: 2,
    nodeId: 'preview',
    width: 640,
    height: 640,
    formSnapshot: { width: 640, height: 640, numFrames: 81, fps: 16 },
    resolvedExecutionInputs: receipt(),
    mediaItems: [
      {
        index: 0,
        url: '/clip.mp4',
        displayType: 'video',
        mediaMetadata: {
          source: 'encoded-file',
          width: 1280,
          height: 720,
          frame_count: 77,
          fps: 24,
        },
      },
    ],
  });
  const original = structuredClone(value);
  assert.equal(outputUtils.videoOutputSummary(value), '1280x720 | 77 frames | 24fps');
  assert.equal(inputs.outputNumericInputValue(value, 'width'), 1328);
  assert.equal(value.formSnapshot.width, 640);
  assert.deepEqual(value, original);
  delete value.mediaItems[0].mediaMetadata;
  // Missing captured height/frame/fps must not be filled with unrelated form fallbacks.
  assert.doesNotMatch(outputUtils.videoOutputSummary(value), /640|81 frames|16fps/);
});

test('backend resolved inputs override stale form metadata and survive JSON history reload without editing the form', () => {
  const output = contracts.coerceStudioOutput({
    id: 'output',
    url: '/image.webp',
    taskId: 'actual-task',
    attemptIndex: 2,
    nodeId: 'preview',
    prompt: 'fallback',
    steps: 8,
    width: 1024,
    formSnapshot: { prompt: 'fallback', steps: 8, width: 1024 },
    promptSettingsHash: 'stale-form-hash',
    exactTemplateCompatible: true,
    resolvedExecutionInputs: receipt(),
  });
  assert.equal(output.prompt, 'Actual wired complex workshop prompt');
  assert.equal(output.steps, 50);
  assert.equal(output.width, 1328);
  assert.equal(output.formSnapshot.prompt, 'fallback');
  assert.equal(output.formSnapshot.steps, 8);
  assert.equal(output.exactTemplateCompatible, false);
  assert.equal(output.promptSettingsHash, undefined);
  const restored = contracts.coerceStudioOutput(JSON.parse(JSON.stringify(output)));
  assert.deepEqual(restored.resolvedExecutionInputs, receipt());
  assert.equal(restored.prompt, output.prompt);
});

test('receipt requires exact task attempt/output identity and a summary derived from bounded node evidence', () => {
  const identity = { taskId: 'actual-task', attemptIndex: 2, nodeId: 'preview' };
  assert.ok(inputs.coerceResolvedExecutionInputs(receipt(), identity));
  for (const patch of [{ taskId: 'other' }, { attemptIndex: 1 }, { nodeId: 'other' }]) {
    assert.equal(inputs.coerceResolvedExecutionInputs(receipt(), { ...identity, ...patch }), undefined);
  }
  const wrongSummary = receipt();
  wrongSummary.summary.prompt = 'forged summary';
  assert.equal(inputs.coerceResolvedExecutionInputs(wrongSummary, identity), undefined);
  const secret = receipt();
  secret.nodes[0].fields.hf_token = { value: 'not allowed', source: 'literal' };
  assert.equal(inputs.coerceResolvedExecutionInputs(secret, identity), undefined);
  const invalid = receipt();
  invalid.nodes[0].fields.width.value = Number.NaN;
  assert.equal(inputs.coerceResolvedExecutionInputs(invalid, identity), undefined);
  const badOrigin = receipt();
  delete badOrigin.nodes[0].fields.prompt.sourceNodeId;
  assert.equal(inputs.coerceResolvedExecutionInputs(badOrigin, identity), undefined);
});

test('captured native and whole-pipeline attention/VAE policies survive history and retain ambiguity', () => {
  const identity = { taskId: 'actual-task', attemptIndex: 2, nodeId: 'preview' };
  for (const [slicing, tiling] of [
    ['vae_slicing', 'vae_tiling'],
    ['enable_vae_slicing', 'enable_vae_tiling'],
  ]) {
    const capture = receipt();
    Object.assign(capture.nodes[0].fields, {
      attention_backend: { value: '_native_math', source: 'literal' },
      [slicing]: { value: true, source: 'literal' },
      [tiling]: { value: false, source: 'literal' },
    });
    Object.assign(capture.summary, { attentionBackend: '_native_math', vaeSlicing: true, vaeTiling: false });
    assert.deepEqual(inputs.coerceResolvedExecutionInputs(capture, identity), capture);
    const restored = contracts.coerceStudioOutput(
      JSON.parse(JSON.stringify({ id: 'policies', url: '/image.webp', ...identity, resolvedExecutionInputs: capture })),
    );
    assert.deepEqual(restored.resolvedExecutionInputs, capture);
    const unknown = structuredClone(capture);
    unknown.nodes[0].fields.enable_vae_unknown = { value: true, source: 'literal' };
    assert.equal(inputs.coerceResolvedExecutionInputs(unknown, identity), undefined);
  }
  const mixed = receipt();
  Object.assign(mixed.nodes[0].fields, {
    vae_slicing: { value: true, source: 'literal' },
    enable_vae_slicing: { value: false, source: 'literal' },
  });
  mixed.ambiguousFields = ['vaeSlicing'];
  assert.deepEqual(inputs.coerceResolvedExecutionInputs(mixed, identity), mixed);
});

test('captured weight loading mode preserves its cpu/cuda value through output history', () => {
  const identity = { taskId: 'actual-task', attemptIndex: 2, nodeId: 'preview' };
  for (const value of ['cpu', 'cuda']) {
    const capture = receipt();
    capture.nodes.push({
      nodeId: 'loader',
      module: 'modules.ModularDiffusers',
      action: 'ModelsLoader',
      fields: { weight_loading_mode: { value, source: 'literal' } },
      omittedFields: {},
    });
    capture.summary.weightLoadingMode = value;
    assert.deepEqual(inputs.coerceResolvedExecutionInputs(capture, identity), capture);
    const restored = contracts.coerceStudioOutput(
      JSON.parse(
        JSON.stringify({
          id: 'weight-loading',
          url: '/image.webp',
          ...identity,
          resolvedExecutionInputs: capture,
        }),
      ),
    );
    assert.deepEqual(restored.resolvedExecutionInputs, capture);
    assert.equal(restored.resolvedExecutionInputs.summary.weightLoadingMode, value);
    const forged = structuredClone(capture);
    forged.summary.weightLoadingMode = value === 'cpu' ? 'cuda' : 'cpu';
    assert.equal(inputs.coerceResolvedExecutionInputs(forged, identity), undefined);
  }
  for (const value of ['auto', 'CUDA', '', true, null, 1, ['cpu']]) {
    const capture = receipt();
    capture.nodes.push({
      nodeId: 'loader',
      module: 'modules.ModularDiffusers',
      action: 'ModelsLoader',
      fields: { weight_loading_mode: { value, source: 'literal' } },
      omittedFields: {},
    });
    capture.summary.weightLoadingMode = value;
    assert.equal(inputs.coerceResolvedExecutionInputs(capture, identity), undefined);
  }
  assert.equal(inputs.coerceResolvedExecutionInputs(receipt(), identity).summary.weightLoadingMode, undefined);
  const mixed = receipt();
  mixed.nodes.push(
    ...['cpu', 'cuda'].map((value) => ({
      nodeId: `loader-${value}`,
      module: 'modules.ModularDiffusers',
      action: 'ModelsLoader',
      fields: { weight_loading_mode: { value, source: 'literal' } },
      omittedFields: {},
    })),
  );
  mixed.ambiguousFields = ['weightLoadingMode'];
  assert.deepEqual(inputs.coerceResolvedExecutionInputs(mixed, identity), mixed);
  const omitted = receipt();
  omitted.nodes.push({
    nodeId: 'loader',
    module: 'modules.ModularDiffusers',
    action: 'ModelsLoader',
    fields: {},
    omittedFields: { weight_loading_mode: 'opaque input' },
  });
  omitted.unavailableFields = ['weightLoadingMode'];
  assert.deepEqual(inputs.coerceResolvedExecutionInputs(omitted, identity), omitted);
});

test('every backend capture field survives client history parsing with node-scoped adapter identity', () => {
  const backend = fileURLToPath(new URL('../../MoDiff/', import.meta.url));
  const python =
    process.env.MODIFF_BACKEND_PYTHON ||
    `${backend}.venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`;
  const generated = spawnSync(
    python,
    [
      '-c',
      String.raw`
import json
from modiff.execution_input_provenance import FIELD_NAMES, NODE_FIELD_NAMES, capture_generation_inputs, build_resolved_execution_inputs
cases = []
for prefix, weight_mode in [(p, w) for p in ("", "modules.") for w in ("cpu", "cuda")]:
    nodes, records = {}, {}
    scopes = [("DiffusersImage", "Generate", FIELD_NAMES), *[(m, a, fields) for (m, a), fields in NODE_FIELD_NAMES.items()], ("Text", "ProcessText", {"pipeline_class": "dataOperationType"})]
    for index, (module, action, fields) in enumerate(scopes):
        key = str(index)
        node = {"module": prefix + module, "action": action, "params": {}}
        args = {name: "scope-" + str(index) + "-" + name for name in fields}
        if "weight_loading_mode" in args: args["weight_loading_mode"] = weight_mode
        if "weight_format" in args: args["weight_format"] = "native"
        enhancement = {"operation": "enhance_prompt", "enhancement_max_new_tokens": 2,
                       "prompt_adapter_id": "transformers-prompt-enhancement-v1", "system_prompt_mode": "i2i",
                       "system_prompt_sha256": "a" * 64, "rendered_prompt_sha256": "sha256:" + "b" * 64,
                       "rendered_prompt_utf8_bytes": 64, "rendered_input_ids_sha256": "sha256:" + "c" * 64,
                       "reference_source_sha256": ["sha256:" + "d" * 64],
                       "processed_pixel_sha256": "sha256:" + "e" * 64, "processed_pixel_shape": [4, 5],
                       "processed_grid_sha256": "sha256:" + "f" * 64, "processed_grid_shape": [1, 3]}
        args.update({name: value for name, value in enhancement.items() if name in args})
        for name in ("conditioning_scale", "control_mode", "prompt_embeds_scale", "pooled_prompt_embeds_scale"):
            if name in args: args[name] = [0.4, 0.2]
        if "shared_conditions" in args: args["shared_conditions"] = True
        if "layer_scales" in args: args["layer_scales"] = {"opaque": [1.0]}
        if module == "Text": args["pipeline_class"] = "BuiltinDataOperationV1"
        nodes[key] = node
        records[key] = capture_generation_inputs(key, node, args)
    nodes["preview"] = {"module": "Image", "action": "Preview", "params": {key: {"sourceId": key, "sourceKey": "output"} for key in records}}
    cases.append(build_resolved_execution_inputs({"nodes": nodes}, records, task_id="actual-task", attempt_index=2, node_id="preview"))
print(json.dumps(cases))
`,
    ],
    { cwd: backend, encoding: 'utf8' },
  );
  assert.equal(generated.status, 0, generated.stderr);
  const identity = { taskId: 'actual-task', attemptIndex: 2, nodeId: 'preview' };
  for (const capture of JSON.parse(generated.stdout)) {
    assert.deepEqual(inputs.coerceResolvedExecutionInputs(capture, identity), capture);
    const restored = contracts.coerceStudioOutput({
      id: 'ordinary',
      url: '/image.webp',
      ...identity,
      resolvedExecutionInputs: capture,
    });
    assert.deepEqual(restored.resolvedExecutionInputs, capture);
    const forged = structuredClone(capture);
    forged.summary.revision = forged.summary.ipAdapterRevision;
    assert.equal(
      inputs.coerceResolvedExecutionInputs(forged, identity),
      undefined,
      'auxiliary revision cannot masquerade as base revision',
    );
    const wrongScope = structuredClone(capture);
    wrongScope.nodes.find((node) => node.action === 'ImagePromptAdapter').action = 'Other';
    assert.equal(
      inputs.coerceResolvedExecutionInputs(wrongScope, identity),
      undefined,
      'adapter fields are not global permissions',
    );
  }
});

test('shared guidance receipts distinguish scale-one CFG formulations and stay scoped to the Guider', () => {
  const identity = { taskId: 'actual-task', attemptIndex: 2, nodeId: 'preview' };
  for (const enabled of [true, false]) {
    for (const original of [true, false]) {
      const capture = receipt();
      capture.nodes.push({
        nodeId: 'guide',
        module: 'modules.ModularDiffusers',
        action: 'Guider',
        fields: {
          guider: { value: 'ClassifierFreeGuidance', source: 'literal' },
          guidance_scale: { value: 1, source: 'literal' },
          enabled: { value: enabled, source: 'literal' },
          use_original_formulation: { value: original, source: 'literal' },
          guidance_rescale: { value: 0, source: 'literal' },
          start: { value: 0, source: 'literal' },
          stop: { value: 1, source: 'literal' },
        },
        omittedFields: {},
      });
      Object.assign(capture.summary, {
        guidanceScale: 1,
        guiderType: 'ClassifierFreeGuidance',
        guidanceEnabled: enabled,
        guidanceOriginalFormulation: original,
        guidanceRescale: 0,
        guidanceStart: 0,
        guidanceStop: 1,
      });
      assert.deepEqual(inputs.coerceResolvedExecutionInputs(capture, identity), capture);
      const restored = contracts.coerceStudioOutput(
        JSON.parse(
          JSON.stringify({
            id: 'guidance',
            url: '/image.webp',
            ...identity,
            resolvedExecutionInputs: capture,
          }),
        ),
      );
      assert.deepEqual(restored.resolvedExecutionInputs, capture);
      const wrongScope = structuredClone(capture);
      wrongScope.nodes.at(-1).action = 'EncodePrompt';
      assert.equal(inputs.coerceResolvedExecutionInputs(wrongScope, identity), undefined);
      const forged = structuredClone(capture);
      forged.summary.guidanceOriginalFormulation = !original;
      assert.equal(inputs.coerceResolvedExecutionInputs(forged, identity), undefined);
    }
  }
});

test('ambiguous or opaque generation inputs are disclosed instead of presenting form defaults as runtime facts', () => {
  const capture = receipt();
  capture.nodes.push({
    nodeId: 'second',
    module: 'modules.ModularDiffusers',
    action: 'Step',
    fields: {
      prompt: { value: 'second upstream prompt', source: 'literal' },
    },
    omittedFields: { num_inference_steps: 'unsupported-value' },
  });
  delete capture.summary.prompt;
  delete capture.summary.steps;
  capture.ambiguousFields = ['prompt'];
  capture.unavailableFields = ['steps'];
  const output = contracts.coerceStudioOutput({
    id: 'output',
    url: '/image.webp',
    taskId: 'actual-task',
    attemptIndex: 2,
    nodeId: 'preview',
    prompt: 'fallback',
    steps: 8,
    resolvedExecutionInputs: capture,
  });
  assert.equal(output.prompt, '');
  assert.match(inputs.outputInputDisplay(output, 'steps'), /Not uniquely captured/);
  assert.equal(inputs.outputInputDisplay(output, 'width'), 1328);
});

test('summary cards and preview history never turn missing or ambiguous captures into form facts', () => {
  const output = contracts.coerceStudioOutput({
    id: 'summary-output',
    url: '/image.webp',
    nodeId: 'preview',
    taskId: 'actual-task',
    attemptIndex: 2,
    seed: 12345,
    height: 1024,
    formSnapshot: { numFrames: 81, fps: 24 },
    resolvedExecutionInputs: receipt(),
  });
  for (const key of ['seed', 'height', 'numFrames', 'fps']) {
    assert.equal(inputs.outputNumericInputValue(output, key), undefined);
    assert.match(inputs.outputInputDisplay(output, key), /Not uniquely captured/);
  }
  assert.equal(inputs.outputMediaSizeLabel(output), undefined, 'missing height is not fabricated');
  output.mediaItems = [{ width: 1400, height: 900 }];
  assert.equal(inputs.outputMediaSizeLabel(output), '1400x900', 'decoded dimensions describe the actual asset');
  const legacy = contracts.coerceStudioOutput({
    id: 'legacy',
    url: '/video.mp4',
    seed: 12345,
    width: 1024,
    height: 768,
    formSnapshot: { numFrames: 81, fps: 24 },
  });
  assert.equal(inputs.outputNumericInputValue(legacy, 'seed'), 12345);
  assert.equal(inputs.outputNumericInputValue(legacy, 'numFrames'), 81);
  assert.equal(inputs.outputMediaSizeLabel(legacy), '1024x768');
});

test('effective image overrides survive persistence without presenting unused form controls', () => {
  const capture = receipt();
  capture.nodes = [
    {
      nodeId: 'generate',
      module: 'modules.DiffusersImage',
      action: 'Generate',
      fields: {
        prompt: { value: null, source: 'literal' },
        seed: { value: null, source: 'literal' },
        num_inference_steps: { value: null, source: 'literal' },
        true_cfg_scale: { value: 4, source: 'connected', sourceNodeId: 'guidance', sourcePortId: 'value' },
      },
      omittedFields: {},
    },
  ];
  capture.summary = { prompt: null, seed: null, steps: null, trueCfgScale: 4 };
  const requested = { prompt: 'Unused saved prompt', seed: 7, steps: 50 };
  let output = contracts.coerceStudioOutput({
    id: 'overridden-image',
    url: '/image.webp',
    taskId: 'actual-task',
    attemptIndex: 2,
    nodeId: 'preview',
    ...requested,
    formSnapshot: requested,
    resolvedExecutionInputs: capture,
  });
  for (let reload = 0; reload < 2; reload += 1) {
    assert.ok(output.resolvedExecutionInputs);
    assert.equal(output.prompt, '');
    assert.match(inputs.outputInputDisplay(output, 'seed'), /Not uniquely captured/);
    assert.match(inputs.outputInputDisplay(output, 'steps'), /Not uniquely captured/);
    assert.equal(output.formSnapshot.prompt, requested.prompt);
    assert.equal(output.formSnapshot.seed, requested.seed);
    assert.deepEqual(output.resolvedExecutionInputs, capture);
    output = contracts.coerceStudioOutput(JSON.parse(JSON.stringify(output)));
  }
});

test('graph task evidence replaces stale history labels while preserving the saved form', () => {
  const evidence = receipt();
  evidence.nodes.push({
    nodeId: 'loader',
    module: 'modules.ModularDiffusers',
    action: 'ModelsLoader',
    fields: {
      model_type: { value: 'StableDiffusionXLModularPipeline', source: 'literal' },
    },
    omittedFields: {},
  });
  evidence.summary.modelType = 'StableDiffusionXLModularPipeline';
  evidence.graphTasks = [
    { loaderId: 'loader', pipelineClass: 'StableDiffusionXLModularPipeline', task: 'image_to_image' },
  ];
  const value = {
    id: 'graph-task',
    url: '/image.webp',
    taskId: 'actual-task',
    attemptIndex: 2,
    nodeId: 'preview',
    mode: 'text_to_image',
    formSnapshot: { mode: 'text_to_image' },
    resolvedExecutionInputs: evidence,
  };
  const output = contracts.coerceStudioOutput(value);
  assert.equal(output.mode, 'image_to_image');
  assert.equal(output.formSnapshot.mode, 'text_to_image');
  assert.deepEqual(output.resolvedExecutionInputs.graphTasks, evidence.graphTasks);
  assert.equal(contracts.coerceStudioOutput(JSON.parse(JSON.stringify(output))).mode, 'image_to_image');
  for (const patch of [{ loaderId: 'missing' }, { pipelineClass: 'FluxModularPipeline' }, { task: {} }]) {
    const malformed = structuredClone(evidence);
    Object.assign(malformed.graphTasks[0], patch);
    assert.equal(inputs.coerceResolvedExecutionInputs(malformed, output), undefined);
  }
});

function taskHistoryOutput(graphTasks) {
  const evidence = receipt();
  evidence.nodes.push({
    nodeId: 'loader',
    module: 'modules.ModularDiffusers',
    action: 'ModelsLoader',
    fields: { model_type: { value: 'QwenImageEditPlusModularPipeline', source: 'literal' } },
    omittedFields: {},
  });
  evidence.summary.modelType = 'QwenImageEditPlusModularPipeline';
  if (graphTasks !== undefined) evidence.graphTasks = graphTasks;
  return contracts.coerceStudioOutput({
    id: 'task-alias',
    url: '/image.webp',
    taskId: 'actual-task',
    attemptIndex: 2,
    nodeId: 'preview',
    mode: 'text_to_image',
    formSnapshot: { mode: 'text_to_image', steps: 50 },
    resolvedExecutionInputs: evidence,
  });
}

test('ordinary image task receipts survive history reload with strict owner identity', () => {
  for (const [module, action, pipeline, task] of [
    ['DiffusersImage', 'LoadPipeline', 'ZImageInpaintPipeline', 'outpaint'],
    ['HuggingFaceTransformers', 'LoadDepthEstimationModel', 'AutoModelForDepthEstimation', 'depth_estimation'],
    ['HuggingFaceTransformers', 'LoadImageTextToTextModel', 'AutoModelForImageTextToText', 'image_to_text'],
    ['ImageOperations', 'ProcessImage', 'BuiltinImageOperationV1', 'image_crop'],
  ]) {
    const evidence = receipt();
    evidence.nodes = [
      {
        nodeId: 'owner',
        module: 'modules.' + module,
        action,
        fields: { pipeline_class: { value: pipeline, source: 'literal' } },
        omittedFields: {},
      },
    ];
    evidence.summary = { modelType: pipeline };
    evidence.ambiguousFields = [];
    evidence.unavailableFields = [];
    evidence.graphTasks = [{ loaderId: 'owner', pipelineClass: pipeline, task }];
    const identity = { taskId: 'actual-task', attemptIndex: 2, nodeId: 'preview' };
    assert.deepEqual(inputs.coerceResolvedExecutionInputs(evidence, identity), evidence);
    let output = contracts.coerceStudioOutput({
      id: 'ordinary-image',
      url: '/image.webp',
      ...identity,
      mode: 'text_to_image',
      formSnapshot: { mode: 'text_to_image' },
      resolvedExecutionInputs: evidence,
    });
    for (let reload = 0; reload < 2; reload++) {
      assert.equal(output.mode, task);
      assert.equal(output.formSnapshot.mode, 'text_to_image');
      output = contracts.coerceStudioOutput(JSON.parse(JSON.stringify(output)));
    }
    for (const mutate of [
      (e) => {
        e.nodes[0].module = 'custom.Foreign';
      },
      (e) => {
        e.graphTasks[0].pipelineClass = 'WrongClass';
      },
      (e) => {
        e.nodes[0].fields = {};
        e.summary = {};
      },
      (e) => {
        e.graphTasks.push(e.graphTasks[0]);
      },
      (e) => {
        e.truncated = true;
      },
      (e) => {
        e.uncapturedNodeIds = ['missing'];
      },
    ]) {
      const malformed = structuredClone(evidence);
      mutate(malformed);
      assert.equal(inputs.coerceResolvedExecutionInputs(malformed, identity), undefined);
    }
  }
});

const taskOwner = { loaderId: 'loader', pipelineClass: 'QwenImageEditPlusModularPipeline' };

test('ambiguous consumed task stays explicitly uncaptured across history reload without borrowing the form', () => {
  let output = taskHistoryOutput([{ ...taskOwner, task: null }]);
  for (let reload = 0; reload < 2; reload++) {
    assert.equal(tasks.outputTaskDisplay(output), 'Task not uniquely captured');
    assert.equal(output.mode, 'text_to_image');
    assert.equal(output.formSnapshot.mode, 'text_to_image');
    assert.equal(output.formSnapshot.steps, 50);
    assert.equal(inputs.outputModelKey(output), 'QwenImageEditPlusModularPipeline');
    output = contracts.coerceStudioOutput(JSON.parse(JSON.stringify(output)));
  }
});

test('missing and mixed consumed task evidence never uses the historical global task', () => {
  const output = taskHistoryOutput();
  assert.equal(tasks.outputTaskDisplay(output), 'Task not uniquely captured');
  for (const graphTasks of [
    [],
    [{ ...taskOwner, task: null }],
    [
      { ...taskOwner, task: 'edit_image' },
      { ...taskOwner, loaderId: 'other', task: 'text_to_image' },
    ],
    [
      { ...taskOwner, task: 'edit_image' },
      { ...taskOwner, loaderId: 'other', task: null },
    ],
    [{ ...taskOwner, task: 'unrecognized_task' }],
    [{ ...taskOwner, task: 'constructor' }],
  ]) {
    output.resolvedExecutionInputs.graphTasks = graphTasks;
    assert.equal(tasks.outputTaskDisplay(output), 'Task not uniquely captured');
  }
});

test('unique consumed task labels override stale history, and only receipt-free records retain legacy labels', () => {
  for (const task of ['edit_image', 'multi_image_reference_edit']) {
    const output = taskHistoryOutput([{ ...taskOwner, task }]);
    assert.equal(tasks.outputTaskDisplay(output), profiles.STUDIO_MODE_LABELS[task]);
    assert.equal(output.formSnapshot.mode, 'text_to_image');
  }
  const legacy = taskHistoryOutput();
  delete legacy.resolvedExecutionInputs;
  assert.equal(tasks.outputTaskDisplay(legacy), 'Text to image');
});

test('depth receipt preserves model-default resolution and false input matching through history parsing', () => {
  const value = receipt();
  value.nodes[0] = {
    nodeId: 'depth',
    module: 'modules.HuggingFaceTransformers',
    action: 'PredictDepth',
    fields: {
      processing_resolution: { value: 0, source: 'literal' },
      match_input_resolution: { value: false, source: 'literal' },
      depth_convention: { value: 'model_default', source: 'literal' },
    },
    omittedFields: {},
  };
  value.summary = { processingResolution: 0, matchInputResolution: false, depthConvention: 'model_default' };
  const identity = { taskId: 'actual-task', attemptIndex: 2, nodeId: 'preview' };
  assert.deepEqual(inputs.coerceResolvedExecutionInputs(value, identity), value);
  const mismatched = structuredClone(value);
  mismatched.summary.matchInputResolution = true;
  assert.equal(inputs.coerceResolvedExecutionInputs(mismatched, identity), undefined);
});

test('audio receipt validates duration, delivery rate and consumed controls through history parsing', () => {
  const value = receipt();
  value.nodes[0] = {
    nodeId: 'audio',
    module: 'modules.DiffusersAudio',
    action: 'Generate',
    fields: {
      num_inference_steps: { value: 200, source: 'connected', sourceNodeId: 'steps', sourcePortId: 'value' },
      guidance_scale: { value: 3.5, source: 'literal' },
      audio_duration: { value: 10, source: 'literal' },
      sample_rate: { value: 16000, source: 'literal' },
    },
    omittedFields: {},
  };
  value.summary = { steps: 200, guidanceScale: 3.5, audioDuration: 10, sampleRate: 16000 };
  const identity = { taskId: 'actual-task', attemptIndex: 2, nodeId: 'preview' };
  assert.deepEqual(inputs.coerceResolvedExecutionInputs(value, identity), value);
  const mismatched = structuredClone(value);
  mismatched.summary.steps = 8;
  assert.equal(inputs.coerceResolvedExecutionInputs(mismatched, identity), undefined);
  const restored = inputs.coerceResolvedExecutionInputs(JSON.parse(JSON.stringify(value)), identity);
  assert.equal(restored.nodes[0].fields.num_inference_steps.sourceNodeId, 'steps');
});

test('attention context reuse survives receipts and rejects a contradictory summary', () => {
  for (const enabled of [true, false]) {
    const value = receipt();
    value.nodes[0] = {
      nodeId: 'generate',
      module: 'modules.DiffusersImage',
      action: 'Generate',
      fields: { use_kv_cache: { value: enabled, source: 'literal' } },
      omittedFields: {},
    };
    value.summary = { attentionContextReuse: enabled };
    const identity = { taskId: 'actual-task', attemptIndex: 2, nodeId: 'preview' };
    assert.deepEqual(inputs.coerceResolvedExecutionInputs(JSON.parse(JSON.stringify(value)), identity), value);
    value.summary.attentionContextReuse = !enabled;
    assert.equal(inputs.coerceResolvedExecutionInputs(value, identity), undefined);
  }
});

test('image stage receipts keep loader execution mode and each consumed stage task scoped to their actual actions', () => {
  const identity = { taskId: 'actual-task', attemptIndex: 2, nodeId: 'preview' };
  for (const [action, field, label] of [
    ['LoadPipeline', 'mode', 'executionMode'],
    ['EncodeInputs', 'executed_task', 'executedTask'],
    ['Denoise', 'executed_task', 'executedTask'],
    ['DecodeLatents', 'executed_task', 'executedTask'],
  ]) {
    const value = receipt();
    value.nodes = [
      {
        nodeId: 'stage',
        module: 'modules.DiffusersImage',
        action,
        fields: { [field]: { value: 'control_image', source: 'literal' } },
        omittedFields: {},
      },
    ];
    value.summary = { [label]: 'control_image' };
    assert.deepEqual(inputs.coerceResolvedExecutionInputs(value, identity), value);
    assert.deepEqual(inputs.coerceResolvedExecutionInputs(JSON.parse(JSON.stringify(value)), identity), value);
    const omitted = structuredClone(value);
    omitted.nodes[0].fields = {};
    omitted.nodes[0].omittedFields = { [field]: 'unsupported-value' };
    omitted.summary = {};
    omitted.unavailableFields = [label];
    assert.deepEqual(inputs.coerceResolvedExecutionInputs(omitted, identity), omitted);
    for (const mutate of [
      (copy) => {
        copy.nodes[0].action = 'UnreviewedAction';
      },
      (copy) => {
        copy.nodes[0].module = 'modules.Foreign';
      },
      (copy) => {
        copy.nodes[0].fields.unknown_mode = copy.nodes[0].fields[field];
      },
      (copy) => {
        copy.summary[label] = 'foreign_task';
      },
      (copy) => {
        copy.summary = { [label === 'executedTask' ? 'executionMode' : 'executedTask']: 'control_image' };
      },
    ]) {
      const copy = structuredClone(value);
      mutate(copy);
      assert.equal(inputs.coerceResolvedExecutionInputs(copy, identity), undefined);
    }
  }
  const foreignField = receipt();
  foreignField.nodes = [
    {
      nodeId: 'denoise',
      module: 'modules.DiffusersImage',
      action: 'Denoise',
      fields: { mode: { value: 'control_image', source: 'literal' } },
      omittedFields: {},
    },
  ];
  foreignField.summary = { executionMode: 'control_image' };
  assert.equal(inputs.coerceResolvedExecutionInputs(foreignField, identity), undefined);
});

// Frozen NodeBase/official tiny CPU producer captures, not HTTP or trained-model proof.
const textGenerationProducerReceipts = {
  'enhance-two-references': {
    schemaVersion: 1,
    source: 'backend-execution',
    taskId: 'pup-cpu-unit-enhance-two-references',
    attemptIndex: 0,
    nodeId: 'enhancement-two-reference-producer',
    nodes: [
      {
        nodeId: 'enhancement-two-reference-producer',
        module: 'modules.HuggingFaceTransformers',
        action: 'GenerateImageVideoText',
        fields: {
          operation: {
            value: 'enhance_prompt',
            source: 'literal',
          },
          enhancement_max_new_tokens: {
            value: 2,
            source: 'literal',
          },
          prompt_adapter_id: {
            value: 'transformers-prompt-enhancement-v1',
            source: 'literal',
          },
          system_prompt_mode: {
            value: 'i2i',
            source: 'literal',
          },
          system_prompt_sha256: {
            value: '95cec384d5b6d341caa9fb3f2c7ca45ee80c2364b3a95d4044aebf976f6dd3bf',
            source: 'literal',
          },
          rendered_prompt_sha256: {
            value: 'sha256:e583f6f3e687f148de99dfb5a343cbbc41176639a63f587cbc67e0d662afda5f',
            source: 'literal',
          },
          rendered_prompt_utf8_bytes: {
            value: 2895,
            source: 'literal',
          },
          rendered_input_ids_sha256: {
            value: 'sha256:4cbd5087487435586ea6a9296a7ff22994a1501d25eaded251eff78080d866e5',
            source: 'literal',
          },
          reference_source_sha256: {
            value: [
              'sha256:b89644f82b4521c8f0367c253020a36500bff049786d8b77237ad17ea3dcbed8',
              'sha256:d44a7e0346e4324df997c774a567940899789649018fb6a6072ef28a95e9bd50',
            ],
            source: 'literal',
          },
          processed_pixel_sha256: {
            value: 'sha256:c6f80e90f8455363b22d0f1be2fd04f399761bc6580448d2c32c717b2353fea2',
            source: 'literal',
          },
          processed_pixel_shape: {
            value: [512, 1536],
            source: 'literal',
          },
          processed_grid_sha256: {
            value: 'sha256:63a4454b5f1dd1e3fe5850ed8174d35d1346744920630f0e7b8ef547b1b86ba6',
            source: 'literal',
          },
          processed_grid_shape: {
            value: [2, 3],
            source: 'literal',
          },
          prompt: {
            value: 'Combine the red and blue squares.',
            source: 'literal',
          },
        },
        omittedFields: {},
      },
    ],
    summary: {
      textOperation: 'enhance_prompt',
      enhancementMaxNewTokens: 2,
      promptAdapterId: 'transformers-prompt-enhancement-v1',
      systemPromptMode: 'i2i',
      systemPromptSha256: '95cec384d5b6d341caa9fb3f2c7ca45ee80c2364b3a95d4044aebf976f6dd3bf',
      renderedPromptSha256: 'sha256:e583f6f3e687f148de99dfb5a343cbbc41176639a63f587cbc67e0d662afda5f',
      renderedPromptUtf8Bytes: 2895,
      renderedInputIdsSha256: 'sha256:4cbd5087487435586ea6a9296a7ff22994a1501d25eaded251eff78080d866e5',
      referenceSourceSha256: [
        'sha256:b89644f82b4521c8f0367c253020a36500bff049786d8b77237ad17ea3dcbed8',
        'sha256:d44a7e0346e4324df997c774a567940899789649018fb6a6072ef28a95e9bd50',
      ],
      processedPixelSha256: 'sha256:c6f80e90f8455363b22d0f1be2fd04f399761bc6580448d2c32c717b2353fea2',
      processedPixelShape: [512, 1536],
      processedGridSha256: 'sha256:63a4454b5f1dd1e3fe5850ed8174d35d1346744920630f0e7b8ef547b1b86ba6',
      processedGridShape: [2, 3],
      prompt: 'Combine the red and blue squares.',
    },
    ambiguousFields: [],
    unavailableFields: [],
    uncapturedNodeIds: [],
    truncated: false,
  },
  'standard-fresh-defaults': {
    schemaVersion: 1,
    source: 'backend-execution',
    taskId: 'pup-cpu-unit-standard-fresh-defaults',
    attemptIndex: 0,
    nodeId: 'standard-fresh-defaults',
    nodes: [
      {
        nodeId: 'standard-fresh-defaults',
        module: 'modules.HuggingFaceTransformers',
        action: 'GenerateImageVideoText',
        fields: {
          prompt: {
            value: 'Describe the red square.',
            source: 'literal',
          },
          operation: {
            value: 'standard',
            source: 'literal',
          },
          executed_task: {
            value: 'image_to_text',
            source: 'literal',
          },
        },
        omittedFields: {},
      },
    ],
    summary: {
      prompt: 'Describe the red square.',
      textOperation: 'standard',
      executedTask: 'image_to_text',
    },
    ambiguousFields: [],
    unavailableFields: [],
    uncapturedNodeIds: [],
    truncated: false,
  },
  'standard-legacy-omitted': {
    schemaVersion: 1,
    source: 'backend-execution',
    taskId: 'pup-cpu-unit-standard-legacy-omitted',
    attemptIndex: 0,
    nodeId: 'standard-legacy-omitted',
    nodes: [
      {
        nodeId: 'standard-legacy-omitted',
        module: 'modules.HuggingFaceTransformers',
        action: 'GenerateImageVideoText',
        fields: {
          prompt: {
            value: 'Describe the blue square.',
            source: 'literal',
          },
          executed_task: {
            value: 'image_to_text',
            source: 'literal',
          },
        },
        omittedFields: {},
      },
    ],
    summary: {
      prompt: 'Describe the blue square.',
      executedTask: 'image_to_text',
    },
    ambiguousFields: [],
    unavailableFields: [],
    uncapturedNodeIds: [],
    truncated: false,
  },
};

test('paired backend prompt-enhancement and ordinary receipts survive exact history roundtrip', () => {
  for (const [name, capture] of Object.entries(textGenerationProducerReceipts)) {
    const identity = { taskId: capture.taskId, attemptIndex: capture.attemptIndex, nodeId: capture.nodeId };
    assert.deepEqual(inputs.coerceResolvedExecutionInputs(capture, identity), capture, name);
    const output = contracts.coerceStudioOutput({
      id: name,
      url: '/unit-text',
      displayType: 'text',
      ...identity,
      prompt: 'stale form fallback',
      formSnapshot: { prompt: 'stale form fallback' },
      resolvedExecutionInputs: capture,
    });
    assert.deepEqual(output.resolvedExecutionInputs, capture);
    assert.equal(output.prompt, capture.summary.prompt);
    assert.equal(output.formSnapshot.prompt, 'stale form fallback');
    assert.deepEqual(contracts.coerceStudioOutput(JSON.parse(JSON.stringify(output))).resolvedExecutionInputs, capture);
  }
  assert.equal(textGenerationProducerReceipts['standard-fresh-defaults'].summary.textOperation, 'standard');
  assert.equal(textGenerationProducerReceipts['standard-fresh-defaults'].summary.enhancementMaxNewTokens, undefined);
  assert.equal(textGenerationProducerReceipts['standard-legacy-omitted'].summary.textOperation, undefined);
  const enhanced = textGenerationProducerReceipts['enhance-two-references'];
  assert.equal(enhanced.summary.textOperation, 'enhance_prompt');
  assert.equal(enhanced.summary.referenceSourceSha256.length, 2);
  assert.notEqual(enhanced.summary.referenceSourceSha256[0], enhanced.summary.referenceSourceSha256[1]);
  assert.equal(enhanced.summary.modelType, undefined, 'capture does not grant an image model identity');
});

test('captured append-details operation survives the ordinary output receipt parser', () => {
  const capture = enhancementReceipt();
  capture.summary.textOperation = 'enhance_prompt_append_details';
  for (const node of capture.nodes) {
    if (node.fields.operation) node.fields.operation.value = 'enhance_prompt_append_details';
  }
  assert.equal(
    inputs.coerceResolvedExecutionInputs(capture, enhancementIdentity(capture)).summary.textOperation,
    'enhance_prompt_append_details',
  );
});

const enhancementNames = {
  operation: 'textOperation',
  enhancement_max_new_tokens: 'enhancementMaxNewTokens',
  prompt_adapter_id: 'promptAdapterId',
  system_prompt_mode: 'systemPromptMode',
  system_prompt_sha256: 'systemPromptSha256',
  rendered_prompt_sha256: 'renderedPromptSha256',
  rendered_prompt_utf8_bytes: 'renderedPromptUtf8Bytes',
  rendered_input_ids_sha256: 'renderedInputIdsSha256',
  reference_source_sha256: 'referenceSourceSha256',
  processed_pixel_sha256: 'processedPixelSha256',
  processed_pixel_shape: 'processedPixelShape',
  processed_grid_sha256: 'processedGridSha256',
  processed_grid_shape: 'processedGridShape',
};

function enhancementReceipt() {
  return structuredClone(textGenerationProducerReceipts['enhance-two-references']);
}

function enhancementIdentity(capture) {
  return { taskId: capture.taskId, attemptIndex: capture.attemptIndex, nodeId: capture.nodeId };
}

test('enhancement observations reject malformed scalars, hashes, counts and tensor shapes without coercion', () => {
  const invalid = {
    operation: ['', 'enhance', ['enhance_prompt'], true, null, 1],
    enhancement_max_new_tokens: [0, -1, 3585, 1.5, '2', true, null],
    prompt_adapter_id: ['', 'bad id', 'Uppercase', 'a'.repeat(129), [], null],
    system_prompt_mode: ['', 'bbox', ['i2i'], true, null],
    system_prompt_sha256: ['sha256:' + 'a'.repeat(64), 'a'.repeat(63), 'A'.repeat(64), null],
    rendered_prompt_sha256: ['a'.repeat(64), 'sha256:' + 'a'.repeat(63), 'sha256:' + 'A'.repeat(64), null],
    rendered_prompt_utf8_bytes: [0, -1, 524289, 1.5, '3', true, null],
    rendered_input_ids_sha256: ['', 'a'.repeat(64), null],
    reference_source_sha256: [
      null,
      ['bad'],
      ['sha256:' + 'a'.repeat(64)].flatMap((hash) => Array(11).fill(hash)),
      [[]],
    ],
    processed_pixel_sha256: ['', 'a'.repeat(64), null],
    processed_pixel_shape: [
      [],
      [1],
      [1, 2, 3],
      [true, 2],
      [0, 2],
      [1.5, 2],
      ['1', 2],
      [Number.MAX_SAFE_INTEGER + 1, 2],
    ],
    processed_grid_sha256: ['', 'a'.repeat(64), null],
    processed_grid_shape: [[], [0, 3], [11, 3], [2, 4], [2.5, 3], ['2', 3], [2, true]],
  };
  for (const [key, values] of Object.entries(invalid))
    for (const value of values) {
      const capture = enhancementReceipt();
      capture.nodes[0].fields[key].value = value;
      capture.summary[enhancementNames[key]] = value;
      assert.equal(
        inputs.coerceResolvedExecutionInputs(capture, enhancementIdentity(capture)),
        undefined,
        `${key}: ${JSON.stringify(value)}`,
      );
    }
});

test('enhancement observations are scoped to the exact generic generation action and output identity', () => {
  for (const [module, action] of [
    ['modules.HuggingFaceTransformers', 'PredictDepth'],
    ['modules.HuggingFaceTransformers', 'LoadImageTextToTextModel'],
    ['modules.ModularDiffusers', 'EncodePrompt'],
    ['modules.Foreign', 'GenerateImageVideoText'],
  ]) {
    const capture = enhancementReceipt();
    Object.assign(capture.nodes[0], { module, action });
    assert.equal(inputs.coerceResolvedExecutionInputs(capture, enhancementIdentity(capture)), undefined);
  }
  for (const patch of [{ taskId: 'other' }, { attemptIndex: 1 }, { nodeId: 'other' }]) {
    const capture = enhancementReceipt();
    assert.equal(
      inputs.coerceResolvedExecutionInputs(capture, { ...enhancementIdentity(capture), ...patch }),
      undefined,
    );
  }
  const capture = enhancementReceipt();
  capture.nodes[0].module = 'HuggingFaceTransformers';
  assert.deepEqual(inputs.coerceResolvedExecutionInputs(capture, enhancementIdentity(capture)), capture);
  capture.nodes[0].fields.reference_id = { value: 'not-vae-authority', source: 'literal' };
  assert.equal(inputs.coerceResolvedExecutionInputs(capture, enhancementIdentity(capture)), undefined);
});

test('enhancement text-only, bounded endpoints, missing observations and ambiguity retain existing receipt rules', () => {
  const capture = enhancementReceipt();
  capture.nodes[0].fields.enhancement_max_new_tokens.value = capture.summary.enhancementMaxNewTokens = 3584;
  capture.nodes[0].fields.rendered_prompt_utf8_bytes.value = capture.summary.renderedPromptUtf8Bytes = 524288;
  capture.nodes[0].fields.reference_source_sha256.value = capture.summary.referenceSourceSha256 = [];
  capture.nodes[0].fields.system_prompt_mode.value = capture.summary.systemPromptMode = 't2i';
  for (const key of [
    'processed_pixel_sha256',
    'processed_pixel_shape',
    'processed_grid_sha256',
    'processed_grid_shape',
  ]) {
    delete capture.nodes[0].fields[key];
    delete capture.summary[enhancementNames[key]];
  }
  assert.deepEqual(inputs.coerceResolvedExecutionInputs(capture, enhancementIdentity(capture)), capture);
  const missing = enhancementReceipt();
  delete missing.nodes[0].fields.processed_pixel_sha256;
  delete missing.summary.processedPixelSha256;
  missing.nodes[0].omittedFields.processed_pixel_sha256 = 'record-size-limit';
  missing.unavailableFields = ['processedPixelSha256'];
  assert.deepEqual(inputs.coerceResolvedExecutionInputs(missing, enhancementIdentity(missing)), missing);
  const mixed = enhancementReceipt();
  mixed.nodes.push({
    nodeId: 'encoder',
    module: 'modules.ModularDiffusers',
    action: 'EncodePrompt',
    fields: {
      prompt: {
        value: 'An explicitly applied proposal.',
        source: 'connected',
        sourceNodeId: mixed.nodes[0].nodeId,
        sourcePortId: 'text',
      },
    },
    omittedFields: {},
  });
  delete mixed.summary.prompt;
  mixed.ambiguousFields = ['prompt'];
  const output = contracts.coerceStudioOutput({
    id: 'mixed-prompt',
    url: '/out.png',
    ...enhancementIdentity(mixed),
    prompt: 'wrong fallback',
    formSnapshot: { prompt: 'wrong fallback' },
    resolvedExecutionInputs: mixed,
  });
  assert.deepEqual(output.resolvedExecutionInputs, mixed);
  assert.equal(output.prompt, '');
  assert.equal(output.formSnapshot.prompt, 'wrong fallback');
  assert.equal(output.resolvedExecutionInputs.nodes[0].fields.prompt.value, 'Combine the red and blue squares.');
});

test('enhancement observation origins reject coercible arrays, objects and booleans', () => {
  for (const source of [['literal'], ['connected'], ['override'], { value: 'literal' }, false, true, 1, null]) {
    const capture = enhancementReceipt();
    capture.nodes[0].fields.operation.source = source;
    assert.equal(inputs.coerceResolvedExecutionInputs(capture, enhancementIdentity(capture)), undefined);
  }
});
