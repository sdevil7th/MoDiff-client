import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJsonHash } from './canonical-json.mjs';
import { verifyNativeLoadedImage } from './native-image-load-evidence.mjs';
import {
  backendContractIdentity,
  backendSourceEvidence,
  canonicalGraphIdentity,
  normalizeBackendRuntime,
  directImagePromptAccountingExecutionPlan,
  directImagePromptRoutes,
  selectBackendRuntimeFingerprintEvidence,
  selectInstalledModelIdentity,
  stableStringify,
} from './live-proof-provenance.mjs';
import {
  validateLateNativeImageVariantRun,
  validateNativeVariantOutput,
  validateNativeVariantRun,
  validateUnmodifiedExpertPreparation,
} from './native-variant-run-evidence.mjs';
import {
  canonicalWorkflowAuthoringContract,
  exportCanonicalWorkflowGraphs,
  readCanonicalEvidenceFile,
} from './release-contract-core.mjs';

// These are the reviewed authored prompt exercises, with no external inputs
// or changes to the rest of either published recipe. The native observations
// are narrower than full call accounting and do not qualify public assets.
const textRoute = {
  format: 'modiff.private.smollm2-prompt-variant.v1',
  workflowId: 'HuggingFaceTextGenerationModel:text_generation',
  outputKind: 'json',
  displayType: 'text',
  contentType: 'text/plain',
  platform: /^Windows-/u,
  backend: 'cuda',
  modelRepo: 'HuggingFaceTB/SmolLM2-135M-Instruct',
  modelRevision: '12fd25f77366fa6b3b4b768ec3050bf629380bac',
  loaderContract: [],
  chain: [
    [
      'loader',
      'modules.HuggingFaceTransformers',
      'LoadTextGenerationModel',
      'device dtype model_id pipeline_class revision',
    ],
    ['generator', 'modules.HuggingFaceTransformers', 'GenerateText', 'prompt'],
    ['preview', 'modules.Primitive', 'DataViewer', ''],
  ],
};

const janusTextRoute = {
  ...textRoute,
  format: 'modiff.private.janus-text-prompt-variant.v1',
  workflowId: 'HuggingFaceAnyToAnyModel:text_generation',
  modelRepo: 'deepseek-community/Janus-Pro-1B',
  modelRevision: '1655280bb75959cc1cb85529a2a8b26e7016072e',
  chain: [
    ['loader', 'modules.HuggingFaceTransformers', 'LoadAnyToAnyModel', 'device dtype model_id pipeline_class revision'],
    ['generator', 'modules.HuggingFaceTransformers', 'GenerateAnyToAny', 'prompt'],
    ['preview', 'modules.Primitive', 'DataViewer', ''],
  ],
};

const janusImageRoute = {
  ...janusTextRoute,
  format: 'modiff.private.janus-image-prompt-variant.v1',
  workflowId: 'HuggingFaceAnyToAnyModel:text_to_image',
  outputKind: 'image',
  displayType: 'image',
  contentType: 'image/webp',
  chain: [...janusTextRoute.chain.slice(0, 2), ['preview', 'modules.Image', 'Preview', 'device']],
};

const janusCaptionRoute = {
  ...janusTextRoute,
  format: 'modiff.private.janus-caption-variant.v1',
  workflowId: 'HuggingFaceAnyToAnyModel:image_to_text',
  bindsImage: true,
  baselinePrompt: 'Describe the image.',
  chain: [['source', 'modules.Image', 'Load', ''], ...janusTextRoute.chain],
};

const smolVlmCaptionRoute = {
  ...textRoute,
  format: 'modiff.private.smolvlm-caption-variant.v1',
  workflowId: 'HuggingFaceImageTextToTextModel:image_to_text',
  modelRepo: 'HuggingFaceTB/SmolVLM-256M-Instruct',
  modelRevision: '7e3e67edbbed1bf9888184d9df282b700a323964',
  bindsImage: true,
  baselinePrompt: 'Describe the image.',
  executedTask: 'image_to_text',
  chain: [
    ['source', 'modules.Image', 'Load', ''],
    [
      'loader',
      'modules.HuggingFaceTransformers',
      'LoadImageTextToTextModel',
      'device dtype model_id pipeline_class revision',
    ],
    ['generator', 'modules.HuggingFaceTransformers', 'GenerateImageVideoText', 'prompt'],
    ['preview', 'modules.Primitive', 'DataViewer', ''],
  ],
};

const videoRoute = {
  format: 'modiff.private.shap-e-prompt-variant.v1',
  workflowId: 'ShapEPipeline:text_to_3d',
  outputKind: 'video',
  displayType: 'video',
  contentType: 'video/mp4',
  platform: /^Linux-/u,
  backend: 'rocm',
  modelRepo: 'openai/shap-e',
  modelRevision: '7bd337afdea1c17842e1c3cc45c4e268356dba40',
  loaderContract: ['modules.DiffusersThreeD.LoadPipeline'],
  chain: [
    ['quantization', 'modules.DiffusersRuntime', 'PipelineQuantizationConfigV2', 'dtype'],
    [
      'recipe',
      'modules.DiffusersRuntime',
      'DiffusersExecutionRecipe',
      'attention_backend device offload_mode vae_slicing vae_tiling',
    ],
    [
      'loader',
      'modules.DiffusersThreeD',
      'LoadPipeline',
      'auto_offload device dtype model_id offload_mode pipeline_class revision',
    ],
    [
      'generator',
      'modules.DiffusersThreeD',
      'GenerateRenderedArtifact',
      'guidance_scale num_inference_steps prompt seed',
    ],
    ['preview', 'modules.Video', 'Export', 'fps'],
  ],
};

const imagePromptRoute = {
  outputKind: 'image',
  displayType: 'image',
  contentType: 'image/webp',
  loaderContract: ['modules.DiffusersImage.LoadPipeline'],
  bindSeed: true,
  chain: [
    ['quantization', 'modules.DiffusersRuntime', 'PipelineQuantizationConfigV2', ''],
    ['recipe', 'modules.DiffusersRuntime', 'DiffusersExecutionRecipe', ''],
    ['loader', 'modules.DiffusersImage', 'LoadPipeline', ''],
    ['generator', 'modules.DiffusersImage', 'Generate', ''],
    ['preview', 'modules.Image', 'Preview', ''],
  ],
};

const same = (actual, expected, message) => assert.equal(stableStringify(actual), stableStringify(expected), message);
const keys = (record, fields, message) => same(Object.keys(record ?? {}).sort(), [...fields].sort(), message);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const graphEnvelope = (graph, hinted = false) =>
  keys(
    graph,
    ['sid', 'nodes', 'paths', ...(hinted ? ['runtimeHints'] : [])],
    'Unreviewed prompt variant graph envelope.',
  );

function owners(profile, api) {
  const [path] = api.paths;
  assert.equal(api.paths.length, 1, 'Expected one prompt variant execution path.');
  same(
    [...path].sort(),
    Object.keys(api.nodes).sort(),
    'Prompt variant contains an uncontrolled node or repeated path item.',
  );
  assert.equal(path.length, profile.chain.length);
  return Object.fromEntries(
    profile.chain.map(([role, module, action, capturedFields], index) => {
      const id = path[index];
      const node = api.nodes[id];
      keys(node, ['module', 'action', 'params'], 'Unreviewed prompt variant node definition.');
      assert.equal(node.module, module);
      assert.equal(node.action, action);
      const fileFields = Object.keys(node.params).filter((name) => node.params[name].display === 'filebrowser');
      same(fileFields, role === 'source' && profile.bindsImage ? ['file'] : []);
      return [role, { id, node, capturedFields: capturedFields ? capturedFields.split(' ') : [] }];
    }),
  );
}

export function bindPromptVariant(profile, original, created, output, baselineHash, sourceValue) {
  graphEnvelope(original);
  graphEnvelope(created);
  graphEnvelope(output, true);
  const expected = structuredClone(original);
  const expectedOwners = owners(profile, expected);
  if (profile.executionDevice === 'cpu:0') {
    const cpuChanges = [
      [expectedOwners.loader, 'auto_offload', true, false],
      [expectedOwners.loader, 'device', 'cuda:0', 'cpu:0'],
      [expectedOwners.loader, 'dtype', 'float16', 'float32'],
      [expectedOwners.loader, 'offload_mode', 'model_cpu', 'none'],
      [expectedOwners.quantization, 'dtype', 'float16', 'float32'],
      [expectedOwners.recipe, 'device', 'cuda:0', 'cpu:0'],
      [expectedOwners.recipe, 'offload_mode', 'model_cpu', 'none'],
    ];
    for (const [owner, field, originalValue, cpuValue] of cpuChanges) {
      const param = owner.node.params[field];
      assert.equal(param.value, originalValue);
      assert.ok(!param.sourceId && !param.sourceKey, 'A CPU variant requires literal resource controls.');
      param.value = cpuValue;
    }
  }
  const baseline = canonicalGraphIdentity(expected);
  assert.equal(baseline.hash, baselineHash, 'The current authored prompt recipe differs from the original baseline.');
  const expectedInputs = expectedOwners.generator.node.params;
  if (profile.bindsImage) {
    assert.match(sourceValue, /^@data\/images\/[a-z0-9_-]{1,120}[.]png$/iu);
    const { params } = expectedOwners.source.node;
    same(params.file, { display: 'filebrowser', value: [] });
    assert.equal(params.alpha_channel.value, 'ignore');
    same(expectedInputs.images, { display: 'input', sourceId: expectedOwners.source.id, sourceKey: 'image' });
    params.file.value = [sourceValue];
  }
  const promptSlot = expectedInputs.prompt;
  assert.equal(
    promptSlot.value,
    profile.baselinePrompt ?? '',
    'The authored prompt differs from the reviewed default.',
  );
  assert.ok(!promptSlot.sourceId, 'The authored prompt must be an unconnected literal.');
  const submittedOwners = owners(profile, output);
  const prompt = submittedOwners.generator.node.params.prompt.value;
  assert.ok(typeof prompt === 'string' && prompt.length <= 4096 && prompt.trim() === prompt && prompt.length > 0);
  assert.ok(!/[\u0000-\u001f\u007f]/u.test(prompt), 'Prompt exercise contains an unsupported control character.');
  promptSlot.value = prompt;
  let seed;
  if (profile.bindSeed) {
    const seedSlot = expectedInputs.seed;
    const actualSeed = submittedOwners.generator.node.params.seed;
    for (const input of [seedSlot, actualSeed])
      assert.ok(input && !input.sourceId && !input.sourceKey, 'Prompt variant requires a literal seed.');
    const raw = actualSeed.value;
    seed = typeof raw === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(raw) ? Number(raw) : raw;
    assert.ok(Number.isSafeInteger(seed) && seed >= 0, 'Prompt variant requires a safely representable unsigned seed.');
    seedSlot.value = raw;
  }
  const identity = canonicalGraphIdentity(expected);
  const mismatch = profile.bindsImage
    ? 'Caption variant changed the canonical graph outside its bound source and prompt.'
    : profile.bindSeed
      ? 'Prompt variant changed a field or wire outside the bound prompt and seed.'
      : 'Prompt variant changed a field or wire outside the empty prompt.';
  for (const graph of [created, output]) same(canonicalGraphIdentity(graph), identity, mismatch);
  return { ...submittedOwners, identity, prompt, expected, seed };
}

function validateConsumedPromptVariant(profile, bound, output, suppliedImage) {
  const consumed = output.resolvedExecutionInputs;
  assert.equal(consumed.schemaVersion, 1);
  assert.equal(consumed.source, 'backend-execution');
  assert.equal(consumed.taskId, output.taskId);
  assert.equal(consumed.attemptIndex, 0);
  assert.equal(consumed.nodeId, bound.preview.id);
  assert.equal(consumed.truncated, false);
  for (const key of ['ambiguousFields', 'unavailableFields', 'uncapturedNodeIds']) same(consumed[key], []);
  const roles = profile.chain.map(([role]) => bound[role]);
  same(
    consumed.nodes.map(({ nodeId }) => nodeId).sort(),
    roles.map(({ id }) => id).sort(),
    'Native prompt variant scope differs.',
  );
  let image;
  for (const { id, node, capturedFields } of roles) {
    const row = consumed.nodes.find(({ nodeId }) => nodeId === id);
    assert.equal(row.module, node.module);
    assert.equal(row.action, node.action);
    same(row.omittedFields, {});
    if (profile.bindsImage && id === bound.source.id) {
      const { sourceFile, decodedImage } = verifyNativeLoadedImage(node, row, 'RGB');
      assert.equal(sourceFile.sourceValue, suppliedImage.sourceValue);
      assert.equal(sourceFile.sha256, suppliedImage.file.sha256, 'Caption source bytes differ from the native load.');
      assert.equal(sourceFile.byteSize, suppliedImage.file.bytes);
      image = { nodeId: id, field: 'file', sha256: sourceFile.sha256, decodedImage };
      continue;
    }
    const expected = Object.fromEntries(
      capturedFields.map((field) => {
        const { value, sourceId } = node.params[field];
        assert.notEqual(value, undefined);
        assert.equal(sourceId, undefined);
        return [field, { value: field === 'model_id' ? value.value : value, source: 'literal' }];
      }),
    );
    if (profile.executedTask && id === bound.generator.id) {
      expected.executed_task = { value: profile.executedTask, source: 'literal' };
    }
    same(row.fields, expected, `Actual consumed fields differ for ${node.action}.`);
  }
  return image;
}

function validateNativePromptRuntime(profile, bound, task, hints, graphCompleted, observation) {
  same(
    graphCompleted.runtimeHints,
    { ...hints, controlledArtifacts: [], loaderContract: profile.loaderContract },
    'Native completion has unreviewed runtime authority.',
  );
  assert.match(task.runtimeFingerprint.packages.platform, profile.platform);
  assert.equal(task.runtimeFingerprint.torch.cuda_available, true);
  const runtime = selectBackendRuntimeFingerprintEvidence([task.runtimeFingerprint]);
  assert.ok(runtime, 'Native runtime fingerprint is incomplete.');
  const { backend, device, peakMeasurementVersion, elapsedSeconds, peakAllocatedBytes } = task.runtimeMeasurement;
  assert.equal(backend, profile.backend);
  assert.equal(device, profile.executionDevice === 'cpu:0' ? 'cuda:0' : bound.loader.node.params.device.value);
  assert.equal(peakMeasurementVersion, 2);
  assert.ok(Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 && elapsedSeconds <= 7200);
  assert.ok(Number.isSafeInteger(peakAllocatedBytes));
  if (profile.executionDevice === 'cpu:0') assert.equal(peakAllocatedBytes, 0);
  else assert.ok(peakAllocatedBytes > 0);
  assert.equal(observation.error, false);
  assert.equal(observation.runtimeFingerprint, runtime.fingerprint);
  assert.equal(observation.models.length, 1);
  const model = selectInstalledModelIdentity(observation, profile.modelRepo);
  const [{ complete, repairRequired }] = observation.models;
  assert.equal(complete, true);
  assert.equal(repairRequired, false);
  assert.equal(model?.selectedRevision, profile.modelRevision);
  assert.equal(model?.modelRevision, `${profile.modelRepo}@${profile.modelRevision}`);
  same(bound.loader.node.params.model_id.value, { source: 'hub', value: profile.modelRepo });
  assert.equal(bound.loader.node.params.revision.value, profile.modelRevision);
  return { runtime, measurement: task.runtimeMeasurement };
}

export function validateSampledCpuWorkerMemory(bytes, worker, source, task) {
  keys(worker, ['origin', 'pid', 'source']);
  assert.match(worker.origin, /^http:\/\/127[.]0[.]0[.]1:[1-9][0-9]{0,4}$/u);
  assert.ok(Number.isSafeInteger(worker.pid) && worker.pid > 0);
  assert.equal(worker.source.fingerprint, source.fingerprint);
  assert.equal(worker.source.fileCount, source.files.length);
  assert.equal(worker.source.gitCommit, source.gitCommit);
  const samples = new TextDecoder('utf-8', { fatal: true })
    .decode(bytes)
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  const { started_at: started, completed_at: completed } = task;
  assert.ok(Number.isFinite(started) && Number.isFinite(completed) && completed > started);
  assert.ok(samples.length >= 3 && samples.length <= 10000);
  assert.ok(samples[0].unixTime <= started && started - samples[0].unixTime < 15);
  assert.ok(samples.at(-1).unixTime >= completed && samples.at(-1).unixTime - completed < 15);
  let previous = -Infinity;
  let peak = 0;
  for (const sample of samples) {
    keys(sample, ['unixTime', 'hostAvailable', 'workerRss', 'accelerator']);
    const { unixTime, workerRss, hostAvailable } = sample;
    assert.ok(Number.isFinite(unixTime) && unixTime > previous);
    if (Number.isFinite(previous)) assert.ok(unixTime - previous <= 3);
    assert.ok(Number.isSafeInteger(workerRss) && workerRss > 0);
    assert.ok(Number.isSafeInteger(hostAvailable) && hostAvailable > 0);
    if (unixTime >= started && unixTime <= completed) peak = Math.max(peak, workerRss);
    previous = unixTime;
  }
  assert.ok(
    Number.isSafeInteger(task.runtimeMeasurement.processRssBytes) && task.runtimeMeasurement.processRssBytes > 0,
  );
  assert.ok(peak >= task.runtimeMeasurement.processRssBytes);
  return peak;
}

function validateImagePromptPreparation(preparation, modelType) {
  if (preparation?.performed !== true) {
    validateUnmodifiedExpertPreparation(preparation, modelType);
    return;
  }
  const { cleanup, reasons, ...unchanged } = preparation;
  validateUnmodifiedExpertPreparation({ ...unchanged, performed: false, cleanup: null, reasons: [] }, modelType);
  same(reasons, ['cached model family is unknown'], 'Unreviewed direct image cache cleanup.');
  keys(cleanup, ['released', 'allocatorTrimmed', 'errors']);
  same(cleanup.errors, [], 'Direct image cache cleanup failed.');
  assert.equal(typeof cleanup.allocatorTrimmed, 'boolean');
  keys(cleanup.released, ['nodes', 'models', 'diffusers_components', 'offload_files']);
  assert.ok(Object.values(cleanup.released).every((count) => Number.isSafeInteger(count) && count >= 0));
}

function nativeTextResult(bytes, item) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.ok(bytes.equals(Buffer.from(text)), 'Original JSON output encoding differs.');
  const payload = JSON.parse(text);
  assert.ok(Array.isArray(payload) && payload.length === 1 && typeof payload[0] === 'string');
  assert.ok(
    stableStringify(item.value) === stableStringify(payload),
    'Original text does not match the saved native output.',
  );
  return JSON.parse(payload[0]);
}

function validateGeneratedText(result, bound) {
  assert.equal(result.schemaVersion, 1);
  assert.ok(typeof result.text === 'string' && result.text.trim() && result.text.length <= 4096);
  assert.ok(['stop', 'length'].includes(result.finishReason));
  assert.ok(Number.isSafeInteger(result.inputTokens) && result.inputTokens > 0);
  assert.ok(Number.isSafeInteger(result.generatedTokens) && result.generatedTokens > 0);
  assert.ok(result.generatedTokens <= bound.generator.node.params.max_new_tokens.value);
}

export function validatePromptVariantText(bytes, item, bound, runtime) {
  const result = nativeTextResult(bytes, item);
  keys(result, ['schemaVersion', 'task', 'text', 'finishReason', 'inputTokens', 'generatedTokens', 'modelReceipt']);
  assert.equal(result.task, 'text-generation');
  validateGeneratedText(result, bound);
  const { receiptDigest, ...record } = result.modelReceipt;
  const version = runtime.packages.transformers;
  assert.match(version, /^\d+(?:\.\d+){2}(?:[a-z0-9.+-]+)?$/u);
  same(
    record,
    {
      schemaVersion: 1,
      library: 'transformers',
      task: 'text-generation',
      loader: { modelAutoClass: 'AutoModelForCausalLM', preprocessorAutoClass: 'AutoTokenizer' },
      runtime: {
        architectures: ['LlamaForCausalLM'],
        device: bound.loader.node.params.device.value,
        dtype: bound.loader.node.params.dtype.value,
        modelClass: 'LlamaForCausalLM',
        modelType: 'llama',
        preprocessorClass: 'GPT2Tokenizer',
        quantization: { mode: 'none' },
        transformersVersion: version,
      },
      security: { hostedInference: false, localFilesOnly: true, safetensorsOnly: true, trustRemoteCode: false },
      source: { kind: 'hub', repository: textRoute.modelRepo, revision: textRoute.modelRevision },
    },
    'Native text model-selection receipt differs from the executed local recipe.',
  );
  assert.equal(receiptDigest, `sha256:${canonicalJsonHash(record)}`, 'Native text model receipt digest differs.');
  return {
    schemaVersion: 1,
    kind: 'json',
    finishReason: result.finishReason,
    inputTokens: result.inputTokens,
    generatedTokens: result.generatedTokens,
    modelReceiptDigest: receiptDigest,
  };
}

function validateJanusPromptVariantText(bytes, item, bound, runtime, source) {
  const result = nativeTextResult(bytes, item);
  keys(result, [
    'schemaVersion',
    'task',
    'adapter',
    'outputModality',
    'text',
    'image',
    'audio',
    'finishReason',
    'inputTokens',
    'generatedTokens',
    'inputImageCount',
    'inputMediaPixels',
    'modelReceipt',
  ]);
  assert.equal(result.task, 'any-to-any-generation');
  assert.equal(result.adapter, 'janus-v1');
  assert.equal(result.outputModality, 'text');
  assert.equal(result.image, null);
  assert.equal(result.audio, null);
  assert.equal(result.inputImageCount, source ? 1 : 0);
  assert.equal(result.inputMediaPixels, source ? source.width * source.height : 0);
  validateGeneratedText(result, bound);
  const { receiptDigest, ...record } = result.modelReceipt;
  const version = runtime.packages.transformers;
  assert.match(version, /^\d+(?:\.\d+){2}(?:[a-z0-9.+-]+)?$/u);
  same(
    record,
    {
      schemaVersion: 1,
      library: 'transformers',
      task: 'any-to-any-generation',
      adapter: {
        adapterId: 'janus-v1',
        imageGeneration: { height: 384, patchSize: 16, tokenCount: 576, width: 384 },
        inputModalities: ['image', 'text'],
        modelType: 'janus',
        outputModalities: ['image', 'text'],
      },
      loader: {
        configAutoClass: 'AutoConfig',
        modelAutoClass: 'AutoModelForMultimodalLM',
        pipelineClass: 'AnyToAnyPipeline',
        preprocessorAutoClass: 'AutoProcessor',
      },
      runtime: {
        architectures: ['JanusForConditionalGeneration'],
        device: bound.loader.node.params.device.value,
        dtype: bound.loader.node.params.dtype.value,
        modelClass: 'JanusForConditionalGeneration',
        modelType: 'janus',
        pipelineClass: 'AnyToAnyPipeline',
        preprocessorClass: 'JanusProcessor',
        transformersVersion: version,
      },
      security: { hostedInference: false, localFilesOnly: true, safetensorsOnly: true, trustRemoteCode: false },
      source: { kind: 'hub', repository: janusTextRoute.modelRepo, revision: janusTextRoute.modelRevision },
    },
    'Native Janus model-selection receipt differs from the executed local recipe.',
  );
  assert.equal(receiptDigest, `sha256:${canonicalJsonHash(record)}`, 'Native Janus model receipt digest differs.');
  return {
    schemaVersion: 1,
    kind: 'json',
    finishReason: result.finishReason,
    inputTokens: result.inputTokens,
    generatedTokens: result.generatedTokens,
    modelReceiptDigest: receiptDigest,
  };
}

function validateSmolVlmCaption(bytes, item, bound, runtime, source) {
  const result = nativeTextResult(bytes, item);
  keys(result, [
    'schemaVersion',
    'task',
    'text',
    'finishReason',
    'inputTokens',
    'generatedTokens',
    'imageCount',
    'videoFrameCount',
    'mediaPixels',
    'modelReceipt',
  ]);
  assert.equal(result.task, 'image-video-to-text');
  assert.equal(result.imageCount, 1);
  assert.equal(result.videoFrameCount, 0);
  assert.equal(result.mediaPixels, source.width * source.height);
  validateGeneratedText(result, bound);
  const { receiptDigest, ...record } = result.modelReceipt;
  const version = runtime.packages.transformers;
  assert.match(version, /^\d+(?:\.\d+){2}(?:[a-z0-9.+-]+)?$/u);
  same(
    record,
    {
      schemaVersion: 1,
      library: 'transformers',
      task: 'image-video-to-text',
      loader: { modelAutoClass: 'AutoModelForImageTextToText', preprocessorAutoClass: 'AutoProcessor' },
      runtime: {
        architectures: ['Idefics3ForConditionalGeneration'],
        device: bound.loader.node.params.device.value,
        dtype: bound.loader.node.params.dtype.value,
        modelClass: 'Idefics3ForConditionalGeneration',
        modelType: 'idefics3',
        preprocessorClass: 'Idefics3Processor',
        quantization: { mode: 'none' },
        transformersVersion: version,
      },
      security: { hostedInference: false, localFilesOnly: true, safetensorsOnly: true, trustRemoteCode: false },
      source: { kind: 'hub', repository: smolVlmCaptionRoute.modelRepo, revision: smolVlmCaptionRoute.modelRevision },
    },
    'Native SmolVLM model-selection receipt differs from the executed local recipe.',
  );
  assert.equal(receiptDigest, `sha256:${canonicalJsonHash(record)}`, 'Native SmolVLM model receipt digest differs.');
  return {
    schemaVersion: 1,
    kind: 'json',
    finishReason: result.finishReason,
    inputTokens: result.inputTokens,
    generatedTokens: result.generatedTokens,
    modelReceiptDigest: receiptDigest,
  };
}

export function validatePromptVariantVideo(decoded, item, bound) {
  const frameSize = bound.generator.node.params.frame_size.value;
  const fps = bound.preview.node.params.fps.value;
  const native = item.mediaMetadata;
  assert.equal(native.source, 'encoded-file');
  assert.equal(native.width, frameSize);
  assert.equal(native.height, frameSize);
  assert.equal(native.fps, fps);
  assert.equal(native.frame_count, 20);
  assert.ok(Math.abs(native.duration_seconds - native.frame_count / fps) <= 0.01);
  same(
    [decoded.width, decoded.height, decoded.fps, decoded.frames],
    [native.width, native.height, native.fps, native.frame_count],
    'Decoded video properties differ from native encoded-file metadata.',
  );
  assert.ok(Math.abs(decoded.durationSeconds - native.duration_seconds) <= 0.02);
  assert.equal(decoded.codecName, 'h264');
  assert.equal(decoded.hasAudio, false);
  assert.equal(decoded.uniqueFrameRatio, 1);
  return {
    kind: 'video',
    width: decoded.width,
    height: decoded.height,
    fps: decoded.fps,
    frames: decoded.frames,
    durationSeconds: decoded.durationSeconds,
    hash: decoded.hash,
  };
}

export async function readPromptVariantEvidence({ clientRoot, manifest, graph, authoring, artifact, evidencePath }) {
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact);
  const imageRoute = directImagePromptRoutes.find(({ workflowId }) => workflowId === target.workflowId);
  const profile = imageRoute
    ? { ...imagePromptRoute, ...imageRoute }
    : [textRoute, janusTextRoute, janusImageRoute, janusCaptionRoute, smolVlmCaptionRoute, videoRoute].find(
        ({ workflowId }) => workflowId === target.workflowId,
      );
  assert.ok(profile, 'Prompt variant route is not reviewed.');
  const requiresOriginalRequest =
    imageRoute !== undefined ||
    profile === janusTextRoute ||
    profile === janusImageRoute ||
    profile === janusCaptionRoute ||
    profile === smolVlmCaptionRoute;
  const sampledCpuMemory = profile.executionDevice === 'cpu:0';
  same(target.modelSet, [{ repoId: profile.modelRepo, revision: profile.modelRevision }]);
  assert.equal(target.outputPlan.minimumAssetCount, 1);
  assert.ok(target.outputPlan.mediaKinds.includes(profile.outputKind));
  const stat = lstatSync(evidencePath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 65536);
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes);
  keys(evidence, [
    'schemaVersion',
    'format',
    'originalGraphHash',
    'workflowId',
    'creatorPackage',
    'outputPackage',
    'runDetail',
    'nodes',
    'backendSourceBefore',
    'backendSourceAfter',
    'graphCompleted',
    'modelObservations',
    'inputs',
    'outputs',
    ...(requiresOriginalRequest ? ['graphRequest', 'graphAcknowledgment'] : []),
    ...(profile.lateNativeSnapshot ? ['persistedOutputs'] : []),
    ...(sampledCpuMemory ? ['worker', 'resourceSamples'] : []),
  ]);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.format, profile.format);
  assert.equal(evidence.workflowId, profile.workflowId);
  assert.ok(Array.isArray(evidence.inputs));
  assert.equal(evidence.inputs.length, profile.bindsImage ? 1 : 0);
  const [suppliedImage] = evidence.inputs;
  if (suppliedImage) keys(suppliedImage, ['sourceValue', 'file', 'upload']);
  assert.equal(evidence.modelObservations.length, 1);
  assert.equal(evidence.outputs.length, 1);
  const [outputRef] = evidence.outputs;
  keys(outputRef, ['backendPath', 'mediaType', 'file']);
  const root = realpathSync(dirname(evidencePath));
  const retainedFiles = [];
  function read(ref, maximum = 16 * 1024 * 1024) {
    const physical = readCanonicalEvidenceFile(root, ref, maximum);
    retainedFiles.push({ ...ref, absolutePath: physical.file });
    return physical;
  }
  const json = (ref) => JSON.parse(read(ref).bytes);
  const creator = json(evidence.creatorPackage);
  const outputPackage = json(evidence.outputPackage);
  const run = json(evidence.runDetail);
  const graphCompleted = json(evidence.graphCompleted);
  const submitted = outputPackage.latestOutput.apiGraphSnapshot;
  const [expectedApi, creatorApi, outputApi, runApi] = await exportCanonicalWorkflowGraphs(clientRoot, [
    graph,
    creator.graph,
    outputPackage.latestOutput.graphSnapshot,
    run.workflow_snapshot,
  ]);
  const bound = bindPromptVariant(
    profile,
    expectedApi,
    creator.apiGraph,
    submitted,
    evidence.originalGraphHash,
    suppliedImage?.sourceValue,
  );
  for (const api of [creatorApi, outputApi, runApi]) {
    graphEnvelope(api);
    same(
      canonicalGraphIdentity(api),
      bound.identity,
      'Saved visual graph differs from the exact submitted prompt variant.',
    );
  }
  const runOptions = {
    target,
    outputNodeId: bound.preview.id,
    displayType: profile.displayType,
    creator,
    outputPackage,
    run,
    graphCompleted,
    ...(requiresOriginalRequest
      ? {
          graphRequest: json(evidence.graphRequest),
          graphAcknowledgment: json(evidence.graphAcknowledgment),
        }
      : {}),
    ...(imageRoute
      ? { validatePreparation: (preparation) => validateImagePromptPreparation(preparation, target.modelType) }
      : {}),
    ...(profile === videoRoute
      ? { validatePreparation: (preparation) => validateUnmodifiedExpertPreparation(preparation, target.modelType) }
      : {}),
  };
  let validatedRun;
  let accountingRun = run;
  if (profile.lateNativeSnapshot) {
    const store = json(evidence.persistedOutputs);
    assert.equal(store.outputs.length, 1);
    const [persistedOutput] = store.outputs;
    validatedRun = validateLateNativeImageVariantRun({ ...runOptions, persistedOutput });
    accountingRun = { ...run, outputs: [persistedOutput] };
  } else {
    validatedRun = validateNativeVariantRun(runOptions);
  }
  const { task, output, hints } = validatedRun;
  same(hints.workflowSnapshot.studioForm, output.formSnapshot, 'Run snapshot form differs from persisted form.');
  const accounting = imageRoute
    ? directImagePromptAccountingExecutionPlan({
        expectedApiGraph: bound.expected,
        apiGraph: submitted,
        consumed: output.resolvedExecutionInputs,
        target,
        runtimeEvidence: { run: accountingRun, output, graphCompleted },
      })
    : null;
  const inputBinding = accounting ? undefined : validateConsumedPromptVariant(profile, bound, output, suppliedImage);
  if (suppliedImage) {
    const source = read(suppliedImage.file, 2 * 1024 * 1024);
    const upload = json(suppliedImage.upload);
    const { width, height } = inputBinding.decodedImage;
    assert.equal(upload.error, false);
    assert.equal(upload.path, suppliedImage.sourceValue);
    same(
      upload.media,
      {
        filename: suppliedImage.sourceValue.split('/').at(-1),
        extension: '.png',
        sizeBytes: source.bytes.length,
        sha256: inputBinding.sha256,
        kind: 'image',
        mimeType: 'image/png',
        width,
        height,
        frames: 1,
      },
      'Caption input differs from the original image upload.',
    );
  }
  const nodes = json(evidence.nodes);
  const backendContract = backendContractIdentity(nodes, bound.identity.canonicalGraph);
  assert.ok(backendContract.fingerprint, 'Native backend contract fingerprint is missing.');
  for (const [role, module, action] of profile.chain) {
    const contract = (nodes.nodes ?? nodes)[`${module}.${action}`];
    assert.equal(contract?.module, module);
    assert.equal(contract.action, action);
    same(
      Object.keys(contract.params).filter((name) => contract.params[name].display === 'filebrowser'),
      role === 'source' && profile.bindsImage ? ['file'] : [],
    );
  }
  const source = backendSourceEvidence({
    before: json(evidence.backendSourceBefore).identity,
    after: json(evidence.backendSourceAfter).identity,
    runtimeFingerprint: task.runtimeFingerprint,
  });
  same(source.blockers, [], 'Backend source differs from the running process.');
  const { runtime, measurement } = validateNativePromptRuntime(
    profile,
    bound,
    task,
    hints,
    graphCompleted,
    json(evidence.modelObservations[0]),
  );
  const peakMemoryBytes = sampledCpuMemory
    ? validateSampledCpuWorkerMemory(
        read(evidence.resourceSamples, 1024 * 1024).bytes,
        json(evidence.worker),
        source.identity,
        task,
      )
    : measurement.peakAllocatedBytes;
  const media = read(outputRef.file, 2 * 1024 * 1024);
  const item = validateNativeVariantOutput({
    output,
    outputRef,
    task,
    bytes: media.bytes,
    displayType: profile.displayType,
    contentType: profile.contentType,
  });
  assert.match(output.id, /^run-output-[a-f0-9]{24}$/u);
  const extension = { image: 'webp', json: 'txt', video: 'mp4' }[profile.outputKind];
  assert.equal(item.backendPath, `@data/studio/outputs/${output.id}_item_00.${extension}`);
  assert.equal(output.mediaCollectionHash, `sha256:collection:${digest(JSON.stringify([item.mediaHash]))}`);
  let decodedOutput;
  if (profile === textRoute) {
    decodedOutput = validatePromptVariantText(media.bytes, item, bound, runtime);
  } else if (profile === janusTextRoute || profile === janusCaptionRoute) {
    decodedOutput = validateJanusPromptVariantText(media.bytes, item, bound, runtime, inputBinding?.decodedImage);
  } else if (profile === smolVlmCaptionRoute) {
    decodedOutput = validateSmolVlmCaption(media.bytes, item, bound, runtime, inputBinding.decodedImage);
  } else if (profile === videoRoute) {
    const { decodedMediaHash } = await import('./template-gallery-harness.mjs');
    decodedOutput = validatePromptVariantVideo(await decodedMediaHash(media.file, 'video'), item, bound);
  } else {
    const { decodedMediaHash, technicalMediaErrors } = await import('./template-gallery-harness.mjs');
    const decoded = await decodedMediaHash(media.file, 'image');
    same(technicalMediaErrors(decoded, { width: item.width, height: item.height }), []);
    if (profile === janusImageRoute) {
      same([decoded.width, decoded.height], [384, 384], 'Janus image dimensions differ from the reviewed image route.');
    }
    decodedOutput = { kind: 'image', hash: decoded.hash, width: decoded.width, height: decoded.height };
  }
  for (const ref of retainedFiles) readCanonicalEvidenceFile(root, ref, 16 * 1024 * 1024);
  assert.ok(readFileSync(evidencePath).equals(descriptorBytes), 'Prompt variant descriptor changed during validation.');
  const receipt = {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-run-receipt.v1',
    proofKind: inputBinding ? 'real_backend_input_bound_model_variant' : 'real_backend_prompt_bound_model_variant',
    ...target,
    taskId: task.task_id,
    outputId: output.id,
    capturedAt: new Date(task.completed_at * 1000).toISOString(),
    graphHash: bound.identity.hash,
    runtimeFingerprint: normalizeBackendRuntime(runtime).lockFingerprint,
    backendSourceFingerprint: source.identity.fingerprint,
    backendContractFingerprint: backendContract.fingerprint,
    resourceCandidateId: null,
    outputHash: item.mediaHash,
    executionDurationSeconds: measurement.elapsedSeconds,
    peakMemoryBytes,
    canonicalDefaultsExecuted: false,
    promptBinding: { nodeId: bound.generator.id, field: 'prompt', sha256: digest(bound.prompt) },
    ...(inputBinding ? { inputBinding } : {}),
    ...(accounting ? { seedBinding: { nodeId: bound.generator.id, field: 'seed', value: bound.seed } } : {}),
    decodedOutput,
    observationLimits: {
      fullConsumedFieldAccounting: Boolean(accounting),
      physicalPlatformQualification: false,
      ...(sampledCpuMemory ? { memoryMeasurement: 'sampled_worker_rss' } : {}),
    },
    qualificationClaims: {
      publicTemplate: false,
      qualityApproved: false,
      rightsApproved: false,
      hardwareQualified: false,
      modelResourceQualified: false,
    },
  };
  return {
    receipt,
    provenance: {
      format: inputBinding ? 'modiff.input-bound-model-variant-proof.v1' : 'modiff.prompt-bound-model-variant-proof.v1',
      receipt,
    },
    evidence,
    descriptorBytes,
    retainedFiles,
    evidenceRoot: root,
  };
}
