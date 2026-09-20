import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let server, contracts, inputs, outputUtils;
before(async () => {
  globalThis.window = { location: { origin: 'http://localhost' } };
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  contracts = await server.ssrLoadModule('/src/studio/outputContracts.ts');
  inputs = await server.ssrLoadModule('/src/studio/resolvedExecutionInputs.ts');
  outputUtils = await server.ssrLoadModule('/src/studio/outputUtils.ts');
});
after(async () => {
  await server?.close();
  delete globalThis.window;
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
for prefix in ("", "modules."):
    nodes, records = {}, {}
    scopes = [("DiffusersImage", "Generate", FIELD_NAMES), *[(m, a, fields) for (m, a), fields in NODE_FIELD_NAMES.items()], ("Text", "ProcessText", {"pipeline_class": "dataOperationType"})]
    for index, (module, action, fields) in enumerate(scopes):
        key = str(index)
        node = {"module": prefix + module, "action": action, "params": {}}
        args = {name: "scope-" + str(index) + "-" + name for name in fields}
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
