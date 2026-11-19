import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJsonHash } from './canonical-json.mjs';
import {
  backendContractIdentity,
  backendSourceEvidence,
  canonicalGraphIdentity,
  normalizeBackendRuntime,
  selectBackendRuntimeFingerprintEvidence,
  selectInstalledModelIdentity,
  stableStringify,
} from './live-proof-provenance.mjs';
import {
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
      assert.ok(!Object.values(node.params).some((param) => param.display === 'filebrowser'));
      return [role, { id, node, capturedFields: capturedFields ? capturedFields.split(' ') : [] }];
    }),
  );
}

export function bindPromptVariant(profile, original, created, output, baselineHash) {
  graphEnvelope(original);
  graphEnvelope(created);
  graphEnvelope(output, true);
  const baseline = canonicalGraphIdentity(original);
  assert.equal(baseline.hash, baselineHash, 'The current authored prompt recipe differs from the original baseline.');
  const expected = structuredClone(original);
  const promptSlot = owners(profile, expected).generator.node.params.prompt;
  assert.equal(promptSlot.value, '', 'The current authored prompt is already filled.');
  assert.ok(!promptSlot.sourceId, 'The authored prompt must be an unconnected literal.');
  const submittedOwners = owners(profile, output);
  const prompt = submittedOwners.generator.node.params.prompt.value;
  assert.ok(typeof prompt === 'string' && prompt.length <= 4096 && prompt.trim() === prompt && prompt.length > 0);
  assert.ok(!/[\u0000-\u001f\u007f]/u.test(prompt), 'Prompt exercise contains an unsupported control character.');
  promptSlot.value = prompt;
  const identity = canonicalGraphIdentity(expected);
  for (const graph of [created, output])
    same(canonicalGraphIdentity(graph), identity, 'Prompt variant changed a field or wire outside the empty prompt.');
  return { ...submittedOwners, identity, prompt };
}

function validateConsumedPromptVariant(profile, bound, output) {
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
  for (const { id, node, capturedFields } of roles) {
    const row = consumed.nodes.find(({ nodeId }) => nodeId === id);
    assert.equal(row.module, node.module);
    assert.equal(row.action, node.action);
    same(row.omittedFields, {});
    const expected = Object.fromEntries(
      capturedFields.map((field) => {
        const { value, sourceId } = node.params[field];
        assert.notEqual(value, undefined);
        assert.equal(sourceId, undefined);
        return [field, { value: field === 'model_id' ? value.value : value, source: 'literal' }];
      }),
    );
    same(row.fields, expected, `Actual consumed fields differ for ${node.action}.`);
  }
  return consumed;
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
  assert.equal(device, bound.loader.node.params.device.value);
  assert.equal(peakMeasurementVersion, 2);
  assert.ok(Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 && elapsedSeconds <= 7200);
  assert.ok(Number.isSafeInteger(peakAllocatedBytes) && peakAllocatedBytes > 0);
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

export function validatePromptVariantText(bytes, item, bound, runtime) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.ok(bytes.equals(Buffer.from(text)), 'Original JSON output encoding differs.');
  const payload = JSON.parse(text);
  assert.ok(Array.isArray(payload) && payload.length === 1 && typeof payload[0] === 'string');
  assert.ok(
    stableStringify(item.value) === stableStringify(payload),
    'Original text does not match the saved native output.',
  );
  const result = JSON.parse(payload[0]);
  keys(result, ['schemaVersion', 'task', 'text', 'finishReason', 'inputTokens', 'generatedTokens', 'modelReceipt']);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.task, 'text-generation');
  assert.ok(typeof result.text === 'string' && result.text.trim() && result.text.length <= 4096);
  assert.ok(['stop', 'length'].includes(result.finishReason));
  assert.ok(Number.isSafeInteger(result.inputTokens) && result.inputTokens > 0);
  assert.ok(Number.isSafeInteger(result.generatedTokens) && result.generatedTokens > 0);
  assert.ok(result.generatedTokens <= bound.generator.node.params.max_new_tokens.value);
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
  const profiles = [textRoute, videoRoute];
  const profile = profiles.find(({ workflowId }) => workflowId === target.workflowId);
  assert.ok(profile, 'Prompt variant route is not reviewed.');
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
  ]);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.format, profile.format);
  assert.equal(evidence.workflowId, profile.workflowId);
  same(evidence.inputs, []);
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
  const bound = bindPromptVariant(profile, expectedApi, creator.apiGraph, submitted, evidence.originalGraphHash);
  for (const api of [creatorApi, outputApi, runApi]) {
    graphEnvelope(api);
    same(
      canonicalGraphIdentity(api),
      bound.identity,
      'Saved visual graph differs from the exact submitted prompt variant.',
    );
  }
  const { task, output, hints } = validateNativeVariantRun({
    target,
    outputNodeId: bound.preview.id,
    displayType: profile.displayType,
    creator,
    outputPackage,
    run,
    graphCompleted,
    ...(profile === videoRoute
      ? { validatePreparation: (preparation) => validateUnmodifiedExpertPreparation(preparation, target.modelType) }
      : {}),
  });
  same(hints.workflowSnapshot.studioForm, output.formSnapshot, 'Run snapshot form differs from persisted form.');
  validateConsumedPromptVariant(profile, bound, output);
  const nodes = json(evidence.nodes);
  const backendContract = backendContractIdentity(nodes, bound.identity.canonicalGraph);
  assert.ok(backendContract.fingerprint, 'Native backend contract fingerprint is missing.');
  for (const [, module, action] of profile.chain) {
    const contract = (nodes.nodes ?? nodes)[`${module}.${action}`];
    assert.equal(contract?.module, module);
    assert.equal(contract.action, action);
    assert.ok(Object.values(contract.params).every(({ display }) => display !== 'filebrowser'));
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
  const extension = profile === textRoute ? 'txt' : 'mp4';
  assert.equal(item.backendPath, `@data/studio/outputs/${output.id}_item_00.${extension}`);
  assert.equal(output.mediaCollectionHash, `sha256:collection:${digest(JSON.stringify([item.mediaHash]))}`);
  let decodedOutput;
  if (profile === textRoute) {
    decodedOutput = validatePromptVariantText(media.bytes, item, bound, runtime);
  } else {
    const { decodedMediaHash } = await import('./template-gallery-harness.mjs');
    decodedOutput = validatePromptVariantVideo(await decodedMediaHash(media.file, 'video'), item, bound);
  }
  for (const ref of retainedFiles) readCanonicalEvidenceFile(root, ref, 16 * 1024 * 1024);
  assert.ok(readFileSync(evidencePath).equals(descriptorBytes), 'Prompt variant descriptor changed during validation.');
  const receipt = {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-run-receipt.v1',
    proofKind: 'real_backend_prompt_bound_model_variant',
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
    peakMemoryBytes: measurement.peakAllocatedBytes,
    canonicalDefaultsExecuted: false,
    promptBinding: { nodeId: bound.generator.id, field: 'prompt', sha256: digest(bound.prompt) },
    decodedOutput,
    observationLimits: { fullConsumedFieldAccounting: false, physicalPlatformQualification: false },
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
    provenance: { format: 'modiff.prompt-bound-model-variant-proof.v1', receipt },
    evidence,
    descriptorBytes,
    retainedFiles,
    evidenceRoot: root,
  };
}
