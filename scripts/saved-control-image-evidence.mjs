import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { verifyConditioningModels } from './control-inpaint-evidence.mjs';
import {
  backendContractIdentity,
  backendSourceEvidence,
  canonicalGraphIdentity,
  normalizeBackendRuntime,
  selectBackendRuntimeFingerprintEvidence,
} from './live-proof-provenance.mjs';
import { verifyNativeLoadedImage } from './native-image-load-evidence.mjs';
import {
  validateLateNativeImageVariantRun,
  validateNativeVariantOutput,
  validateNativeVariantRun,
  validateUnmodifiedExpertPreparation,
} from './native-variant-run-evidence.mjs';
import { verifyRetainedPngUpload } from './private-image-edit-evidence.mjs';
import {
  canonicalWorkflowAuthoringContract,
  exportCanonicalWorkflowGraphs,
  readCanonicalEvidenceFile,
} from './release-contract-core.mjs';
import { decodedMediaHash, technicalMediaErrors } from './template-gallery-harness.mjs';

const format = 'modiff.private.saved-control-image-native-png.v1';
const replayRuntime = '8cbe038eeeb6d4a4c079783b8d7e4915d9f78faad9495cb8e354504c66925cf5';
const commonSource = 'e3aea8f8d102572ad10fdd0700f0c42d92061e864ede89777efcd6a3269770a8';
const sdxlSource = '371fd754663a95b1b06900df9a838042048466464b4bd5cfa7033c1b6eebe0e3';
const routes = {
  'StableDiffusionPipeline:control_image': {
    pipelineClass: 'StableDiffusionControlNetPipeline',
    componentClass: 'ControlNetModel',
    source: commonSource,
    canny: true,
  },
  'HunyuanDiTControlNetPipeline:control_image': {
    pipelineClass: 'HunyuanDiTControlNetPipeline',
    componentClass: 'HunyuanDiT2DControlNetModel',
    source: '1aae04a8ad2e66aeb3eaacc065f2e111280bd8a64e7e6cb95cc927fed95d6b39',
    canny: true,
    guidanceWindowUnavailable: true,
    lateOutput: true,
  },
  'QwenImageControlNetPipeline:control_image': {
    pipelineClass: 'QwenImageControlNetPipeline',
    componentClass: 'QwenImageControlNetModel',
    source: commonSource,
    canny: false,
    trueCfg: true,
  },
  'StableDiffusionPAGPipeline:control_image': {
    pipelineClass: 'StableDiffusionControlNetPAGPipeline',
    componentClass: 'ControlNetModel',
    source: commonSource,
    canny: true,
    lateOutput: true,
    pagSettingsUnobserved: true,
  },
  'StableDiffusionXLControlNetPipeline:control_image': {
    pipelineClass: 'StableDiffusionXLControlNetPipeline',
    componentClass: 'ControlNetModel',
    source: sdxlSource,
    canny: true,
  },
  'StableDiffusionXLAdapterPipeline:control_image': {
    pipelineClass: 'StableDiffusionXLAdapterPipeline',
    componentClass: 'T2IAdapter',
    conditioningKind: 't2i_adapter',
    componentParameter: 'adapter',
    source: sdxlSource,
    canny: true,
    guidanceWindowUnavailable: true,
  },
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const connected = (sourceId, sourceKey) => ({ display: 'input', sourceId, sourceKey });
const literal = (value) => ({ value, source: 'literal' });

function owners(api, route) {
  assert.equal(api.paths.length, 1);
  const [path] = api.paths;
  assert.deepEqual([...path].sort(), Object.keys(api.nodes).sort());
  const setup = [
    'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
    'modules.DiffusersRuntime.DiffusersExecutionRecipe',
    'modules.DiffusersImage.LoadPipeline',
  ];
  const load = 'modules.Image.Load';
  assert.deepEqual(
    path.map((id) => {
      const { module, action } = api.nodes[id];
      return module + '.' + action;
    }),
    [
      ...(route.canny ? [load, 'modules.ImageFilters.Canny', ...setup] : [...setup, load]),
      'modules.DiffusersImage.ControlGenerate',
      'modules.Image.Preview',
    ],
  );
  const [source, canny, loader] = route.canny ? [path[0], path[1], path[4]] : [path[3], null, path[2]];
  const [sampler, preview] = path.slice(-2);
  return { path, source, canny, loader, sampler, preview };
}

export function verifySavedControlImageInputs(api, output, input, workflowId) {
  const route = routes[workflowId];
  assert.ok(route, 'No reviewed saved control-image route.');
  const { path, source, canny, loader, sampler, preview } = owners(api, route);
  const receipt = output.resolvedExecutionInputs;
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.source, 'backend-execution');
  assert.equal(receipt.taskId, output.taskId);
  assert.equal(receipt.nodeId, preview);
  assert.equal(receipt.attemptIndex, 0);
  assert.equal(receipt.truncated, false);
  assert.deepEqual(receipt.mediaEvidenceStatus, { schemaVersion: 1, truncated: false });
  assert.deepEqual(receipt.unavailableFields, []);
  assert.deepEqual(receipt.uncapturedNodeIds, []);
  assert.deepEqual(receipt.nodes.map(({ nodeId }) => nodeId).sort(), [...path].sort());
  const record = (id) => {
    const row = receipt.nodes.find(({ nodeId }) => nodeId === id);
    assert.equal(row.module, api.nodes[id].module);
    assert.equal(row.action, api.nodes[id].action);
    assert.deepEqual(row.omittedFields, {});
    return row;
  };
  const { sourceFile, decodedImage } = verifyNativeLoadedImage(api.nodes[source], record(source), 'RGB');
  assert.deepEqual(sourceFile, {
    sourceValue: input.sourceValue,
    sha256: input.file.sha256,
    byteSize: input.file.bytes,
  });
  const params = api.nodes[sampler].params;
  assert.deepEqual(params.pipeline, connected(loader, 'pipeline'));
  assert.deepEqual(params.control_image, connected(canny ?? source, canny ? 'output' : 'image'));
  assert.deepEqual(api.nodes[preview].params.image, connected(sampler, 'images'));
  if (canny) {
    assert.deepEqual(api.nodes[canny].params.image, connected(source, 'image'));
    assert.deepEqual(record(canny).fields, { device: literal(api.nodes[canny].params.device.value) });
    assert.equal(record(canny).mediaEvidence, undefined);
  }
  const expected = Object.fromEntries(
    [
      'prompt',
      'negative_prompt',
      'output_type',
      'num_inference_steps',
      'width',
      'height',
      'conditioning_scale',
      'seed',
    ].map((field) => [field, params[field].value]),
  );
  Object.assign(expected, {
    executed_task: 'control_image',
    strength: null,
    guidance_scale: route.trueCfg ? null : params.guidance_scale.value,
    max_sequence_length: route.trueCfg ? params.max_sequence_length.value : null,
    control_guidance_start: route.guidanceWindowUnavailable ? null : params.control_guidance_start.value,
    control_guidance_end: route.guidanceWindowUnavailable ? null : params.control_guidance_end.value,
    ...(route.trueCfg && { true_cfg_scale: params.guidance_scale.value }),
  });
  const nativeSampler = record(sampler);
  assert.deepEqual(
    nativeSampler.fields,
    Object.fromEntries(Object.entries(expected).map(([field, value]) => [field, literal(value)])),
    'Saved control sampler fields differ from the graph.',
  );
  assert.equal(nativeSampler.mediaEvidence, undefined);
  return decodedImage;
}

export async function readSavedControlImageEvidence({
  clientRoot,
  manifest,
  graph,
  authoring,
  artifact,
  evidencePath,
}) {
  const route = routes[manifest.id];
  assert.ok(route, 'No reviewed saved control-image route.');
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact);
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes);
  assert.equal(evidence.format, format);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.workflowId, manifest.id);
  const evidenceRoot = realpathSync(dirname(evidencePath));
  const retainedFiles = [];
  const read = (ref) => {
    const result = readCanonicalEvidenceFile(evidenceRoot, ref, 16 * 1024 * 1024);
    retainedFiles.push({ ...ref, absolutePath: result.file });
    return result;
  };
  const json = (ref) => JSON.parse(read(ref).bytes);
  const creator = json(evidence.creatorPackage);
  const outputPackage = json(evidence.outputPackage);
  const run = json(evidence.runDetail);
  const graphRequest = json(evidence.graphRequest);
  const completed = json(evidence.graphCompleted);
  const [expected, ...visual] = await exportCanonicalWorkflowGraphs(clientRoot, [
    graph,
    creator.graph,
    outputPackage.latestOutput.graphSnapshot,
    run.workflow_snapshot,
  ]);
  const canonical = owners(expected, route);
  const actual = owners(graphRequest, route);
  assert.equal(canonicalGraphIdentity(expected).hash, evidence.originalGraphHash);
  const [input] = evidence.inputs;
  assert.equal(evidence.inputs.length, 1);
  assert.match(input.sourceValue, /^@data\/images\/[\w-]{1,128}\.png$/u);
  const fileSlot = expected.nodes[canonical.source].params.file;
  assert.deepEqual(fileSlot, { display: 'filebrowser', value: '' });
  fileSlot.value = [input.sourceValue];
  const prompt = graphRequest.nodes[actual.sampler].params.prompt.value;
  assert.ok(typeof prompt === 'string' && prompt.length > 0 && prompt.length <= 4096 && prompt === prompt.trim());
  assert.ok(!/[\u0000-\u001f\u007f]/u.test(prompt));
  const promptSlot = expected.nodes[canonical.sampler].params.prompt;
  assert.deepEqual(promptSlot, { display: 'textarea', value: '' });
  promptSlot.value = prompt;
  const identity = canonicalGraphIdentity(expected);
  for (const graphSource of [graphRequest, creator.apiGraph, ...visual]) {
    assert.equal(
      canonicalGraphIdentity(graphSource).hash,
      identity.hash,
      'Saved graph differs outside its prompt and guide.',
    );
  }
  const validate = route.lateOutput ? validateLateNativeImageVariantRun : validateNativeVariantRun;
  const { task, output, hints } = validate({
    target,
    outputNodeId: actual.preview,
    displayType: 'image',
    creator,
    outputPackage,
    run,
    graphCompleted: completed,
    graphRequest,
    graphAcknowledgment: json(evidence.graphAcknowledgment),
    validatePreparation: (value) => validateUnmodifiedExpertPreparation(value, route.pipelineClass),
    ...(route.lateOutput && { persistedOutput: json(evidence.persistedOutput).outputs[0] }),
  });
  const decodedImage = verifySavedControlImageInputs(graphRequest, output, input, manifest.id);
  verifyRetainedPngUpload(json(input.upload), input, decodedImage, read(input.file).bytes);
  const source = backendSourceEvidence({
    before: json(evidence.backendSourceBefore).identity,
    after: json(evidence.backendSourceAfter).identity,
    runtimeFingerprint: task.runtimeFingerprint,
  });
  assert.deepEqual(source.blockers, []);
  const expectedSource = 'sha256:backend-source-v1:' + route.source;
  assert.equal(source.identity.fingerprint, expectedSource);
  const replay = json(evidence.registryReplay);
  const { bytes: nodeBytes } = read(evidence.nodes);
  assert.deepEqual(replay, {
    scope: 'Original nodes handler only, with exact source and runtime contract',
    modelRuns: 0,
    fileCount: source.identity.files.length,
    sourceFingerprint: expectedSource,
    runtimeContract: replayRuntime,
    nodeHash: sha256(nodeBytes),
    nodeBytes: nodeBytes.length,
  });
  const backendContract = backendContractIdentity(JSON.parse(nodeBytes), identity.canonicalGraph);
  assert.ok(backendContract.fingerprint);
  const runtime = selectBackendRuntimeFingerprintEvidence([task.runtimeFingerprint]);
  const control = verifyConditioningModels({
    loader: graphRequest.nodes[actual.loader].params,
    target,
    pipelineClass: route.pipelineClass,
    componentClass: route.componentClass,
    conditioningKind: route.conditioningKind,
    componentParameter: route.componentParameter,
    completed,
    hints,
    runtime,
    observations: evidence.modelObservations.map(json),
  });
  const measurement = task.runtimeMeasurement;
  assert.match(runtime.packages.platform, /^Linux-/u);
  assert.equal(measurement.backend, 'rocm');
  assert.equal(measurement.device, 'cuda:0');
  assert.equal(measurement.peakMeasurementVersion, 2);
  assert.ok(measurement.elapsedSeconds > 0 && measurement.elapsedSeconds <= 7200);
  assert.ok(measurement.peakAllocatedBytes > 0 && measurement.peakReservedBytes >= measurement.peakAllocatedBytes);
  assert.equal(evidence.outputs.length, 1);
  const [outputRef] = evidence.outputs;
  const media = read(outputRef.file);
  const item = validateNativeVariantOutput({
    output,
    outputRef,
    task,
    bytes: media.bytes,
    displayType: 'image',
    contentType: 'image/webp',
  });
  const decoded = await decodedMediaHash(media.file, 'image');
  const params = graphRequest.nodes[actual.sampler].params;
  assert.deepEqual(technicalMediaErrors(decoded, { width: params.width.value, height: params.height.value }), []);
  assert.deepEqual([item.width, item.height], [decoded.width, decoded.height]);
  for (const ref of retainedFiles) readCanonicalEvidenceFile(evidenceRoot, ref, 16 * 1024 * 1024);
  assert.ok(readFileSync(evidencePath).equals(descriptorBytes));
  const receipt = {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-run-receipt.v1',
    proofKind: 'real_backend_input_bound_model_variant',
    ...target,
    graphHash: identity.hash,
    capturedAt: new Date(task.completed_at * 1000).toISOString(),
    taskId: task.task_id,
    outputId: output.id,
    runtimeFingerprint: normalizeBackendRuntime(runtime).lockFingerprint,
    backendSourceFingerprint: source.identity.fingerprint,
    backendContractFingerprint: backendContract.fingerprint,
    resourceCandidateId: null,
    outputHash: item.mediaHash,
    executionDurationSeconds: measurement.elapsedSeconds,
    peakMemoryBytes: measurement.peakAllocatedBytes,
    canonicalDefaultsExecuted: false,
    inputBinding: { nodeId: actual.source, field: 'file', sha256: input.file.sha256, decodedImage },
    conditioningModel: control,
    promptBinding: { nodeId: actual.sampler, field: 'prompt', sha256: sha256(prompt) },
    decodedOutput: { hash: decoded.hash, width: decoded.width, height: decoded.height },
    observationLimits: {
      fullConsumedFieldAccounting: false,
      processedControlPixelsObserved: false,
      ...(route.pagSettingsUnobserved && { effectivePagSettingsObserved: false }),
      physicalPlatformQualification: false,
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
    descriptorBytes,
    evidence,
    evidenceRoot,
    retainedFiles,
    provenance: { format: 'modiff.input-bound-model-variant-proof.v1', receipt },
  };
}
