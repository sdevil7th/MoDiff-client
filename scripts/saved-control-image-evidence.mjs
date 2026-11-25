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
  selectInstalledModelIdentity,
} from './live-proof-provenance.mjs';
import {
  verifyNativeCanny,
  verifyNativeLoadedImage,
  verifyRetainedHostImageFiles,
} from './native-image-load-evidence.mjs';
import {
  validateLateNativeSingleAssetRun,
  validateNativeVariantOutput,
  validateNativeVariantRun,
  validateUnmodifiedExpertPreparation,
} from './native-variant-run-evidence.mjs';
import { verifyRetainedPngUpload } from './private-image-edit-evidence.mjs';
import { validateImagePromptPreparation } from './prompt-variant-evidence.mjs';
import {
  canonicalWorkflowAuthoringContract,
  exportCanonicalWorkflowGraphs,
  readCanonicalEvidenceFile,
} from './release-contract-core.mjs';
import { decodedMediaHash, technicalMediaErrors } from './template-gallery-harness.mjs';

const format = 'modiff.private.saved-control-image-native-png.v1';
const retainedHostFormat = 'modiff.private.saved-control-image-native-files.v1';
const loadFieldsFormat = 'modiff.private.saved-control-image-native-load-fields.v1';
const linuxReplayRuntime = '8cbe038eeeb6d4a4c079783b8d7e4915d9f78faad9495cb8e354504c66925cf5';
const windowsReplayRuntime = 'e5d045d5ecf997c0cfe8dba771fd92cfc1fef6d3e10d91791b2b5e747f384b3c';
const commonSource = 'e3aea8f8d102572ad10fdd0700f0c42d92061e864ede89777efcd6a3269770a8';
const sdxlSource = '371fd754663a95b1b06900df9a838042048466464b4bd5cfa7033c1b6eebe0e3';
const sd15Repair = {
  action: 'ControlInpaint',
  pipelineClass: 'StableDiffusionControlNetInpaintPipeline',
  componentClass: 'ControlNetModel',
  source: 'fe1a57b8e352eb66a1a26ebbff5865aaafcf5d55326c4bbcbaf2132ec75f54a8',
  canny: true,
  windows: true,
  additionalInputs: ['source', 'mask'],
};
const fluxControl = {
  action: 'ControlEdit',
  pipelineClass: 'FluxControlImg2ImgPipeline',
  source: '585997dc1146ec6effb20c260272babc01713ecdea4f78a0872c12ef2568ef83',
  integratedControl: true,
  additionalInputs: ['source'],
};
const fluxControlInpaint = {
  ...fluxControl,
  action: 'ControlInpaint',
  pipelineClass: 'FluxControlInpaintPipeline',
  additionalInputs: ['source', 'mask'],
};
const sdxlWindowsControlEdit = {
  action: 'ControlEdit',
  pipelineClass: 'StableDiffusionXLControlNetImg2ImgPipeline',
  componentClass: 'ControlNetModel',
  source: '2faeaaa03b7902a03df5cd0cea38129b7419f6d844125c0ca7e29ccfaf635290',
  originalRegistryHash: 'fd66c8907b4a7969c1a87757f4d9e629d62395c55b8b74f730432cf1ce47d13e',
  canny: true,
  cannyMediaWitness: true,
  windows: true,
  additionalInputs: ['source'],
  previousExpertFamily: 'StableDiffusionXLImg2ImgPipeline',
};
const routes = {
  'FluxCannyPipeline:control_edit_image': { ...fluxControl, lateOutput: true },
  'FluxCannyPipeline:control_inpaint': { ...fluxControlInpaint, lateOutput: true },
  'FluxDepthPipeline:control_edit_image': fluxControl,
  'FluxDepthPipeline:control_inpaint': fluxControlInpaint,
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
  'StableDiffusionXLControlNetPipeline:control_edit_image': sdxlWindowsControlEdit,
  'StableDiffusionXLPAGPipeline:control_edit_image': {
    ...sdxlWindowsControlEdit,
    pipelineClass: 'StableDiffusionXLControlNetPAGImg2ImgPipeline',
    previousExpertFamily: 'StableDiffusionXLControlNetImg2ImgPipeline',
    pagSettingsUnobserved: true,
    loadFieldsVariant: {
      source: 'b29a5b0d317aaa781ae2a5205b46b518eea5a3d68a214eb0968dba4ac0660af7',
      originalRegistryHash: '194fdfe25573ca708535e0913337cfee8c1137a2b3860f5c5c5a7c5419951d46',
      windows: false,
      cannyMediaWitness: false,
      controls: [
        ['strength', 0.8, 1],
        ['conditioning_scale', 1, 0.85],
        ['guidance_scale', 5, 6],
      ],
    },
  },
  'StableDiffusionXLPAGPipeline:control_image': {
    pipelineClass: 'StableDiffusionXLControlNetPAGPipeline',
    componentClass: 'ControlNetModel',
    source: commonSource,
    canny: true,
    pagSettingsUnobserved: true,
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
  'StableDiffusionPipeline:control_edit_image': {
    ...sd15Repair,
    action: 'ControlEdit',
    pipelineClass: 'StableDiffusionControlNetImg2ImgPipeline',
    source: '3227569ff822090d00a80a3a88213d76d5ca43092d2918cec2494962457865a5',
    additionalInputs: ['source'],
  },
  'StableDiffusionPipeline:control_inpaint': sd15Repair,
  'StableDiffusionPAGPipeline:control_inpaint': {
    ...sd15Repair,
    pipelineClass: 'StableDiffusionControlNetPAGInpaintPipeline',
    pagSettingsUnobserved: true,
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
  const additionalInputs = route.additionalInputs ?? [];
  assert.deepEqual(
    path.map((id) => {
      const { module, action } = api.nodes[id];
      return module + '.' + action;
    }),
    [
      ...(route.canny ? [load, 'modules.ImageFilters.Canny', ...setup] : [...setup, load]),
      ...additionalInputs.map(() => load),
      'modules.DiffusersImage.' + (route.action ?? 'ControlGenerate'),
      'modules.Image.Preview',
    ],
  );
  const [guide, canny, loader] = route.canny ? [path[0], path[1], path[4]] : [path[3], null, path[2]];
  const afterInputs = route.canny ? 5 : 4;
  const inputs = {
    guide,
    ...Object.fromEntries(additionalInputs.map((role, index) => [role, path[index + afterInputs]])),
  };
  const [sampler, preview] = path.slice(-2);
  return { path, inputs, canny, loader, sampler, preview };
}

function savedControlRoute(workflowId, evidenceFormat) {
  const route = routes[workflowId];
  assert.ok(route, 'No reviewed saved control-image route.');
  if (evidenceFormat === loadFieldsFormat) {
    assert.ok(route.loadFieldsVariant, 'No reviewed control-image load evidence variant.');
    return { ...route, ...route.loadFieldsVariant, loadFieldsOnly: true };
  }
  return route;
}

export function verifySavedControlImageInputs(api, output, inputs, workflowId, evidenceFormat) {
  const route = savedControlRoute(workflowId, evidenceFormat);
  const { path, inputs: inputOwners, canny, loader, sampler, preview } = owners(api, route);
  assert.equal(inputs.length, Object.keys(inputOwners).length);
  const receipt = output.resolvedExecutionInputs;
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.source, 'backend-execution');
  assert.equal(receipt.taskId, output.taskId);
  assert.equal(receipt.nodeId, preview);
  assert.equal(receipt.attemptIndex, 0);
  assert.equal(receipt.truncated, false);
  assert.deepEqual(
    receipt.mediaEvidenceStatus,
    route.loadFieldsOnly ? undefined : { schemaVersion: 1, truncated: false },
  );
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
  const decoded = Object.entries(inputOwners).map(([role, id], index) => {
    const input = inputs[index];
    if (route.loadFieldsOnly) {
      const load = api.nodes[id];
      const row = record(id);
      assert.equal(row.mediaEvidence, undefined);
      const mode = role === 'mask' ? 'L' : 'RGB';
      const width = row.fields.source_widths?.value?.[0];
      const height = row.fields.source_heights?.value?.[0];
      assert.ok([width, height].every((size) => Number.isSafeInteger(size) && size > 0 && size <= 8192));
      assert.deepEqual(load.params.file, { display: 'filebrowser', value: [input.sourceValue] });
      assert.deepEqual(
        row.fields,
        {
          alpha_channel: literal(load.params.alpha_channel.value),
          source_hashes: literal([input.file.sha256]),
          source_widths: literal([width]),
          source_heights: literal([height]),
          source_modes: literal([mode]),
        },
        'Saved image load fields differ for ' + role,
      );
      return { width, height, mode };
    }
    const { sourceFile, decodedImage } = verifyNativeLoadedImage(
      api.nodes[id],
      record(id),
      role === 'mask' ? 'L' : 'RGB',
    );
    assert.deepEqual(
      sourceFile,
      {
        sourceValue: input.sourceValue,
        sha256: input.file.sha256,
        byteSize: input.file.bytes,
      },
      'Saved image bytes differ for ' + role,
    );
    return decodedImage;
  });
  const params = api.nodes[sampler].params;
  assert.deepEqual(params.pipeline, connected(loader, 'pipeline'));
  assert.deepEqual(params.control_image, connected(canny ?? inputOwners.guide, canny ? 'output' : 'image'));
  if (inputOwners.source) assert.deepEqual(params.image, connected(inputOwners.source, 'image'));
  if (inputOwners.mask) assert.deepEqual(params.mask_image, connected(inputOwners.mask, 'image'));
  assert.deepEqual(api.nodes[preview].params.image, connected(sampler, 'images'));
  if (canny) {
    assert.deepEqual(api.nodes[canny].params.image, connected(inputOwners.guide, 'image'));
    assert.deepEqual(record(canny).fields, { device: literal(api.nodes[canny].params.device.value) });
    if (route.cannyMediaWitness) {
      verifyNativeCanny(api.nodes[canny].params, record(canny).mediaEvidence, decoded[0]);
    } else {
      assert.equal(record(canny).mediaEvidence, undefined);
    }
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
    executed_task: workflowId.split(':')[1],
    strength: inputOwners.source ? params.strength.value : null,
    guidance_scale: route.trueCfg ? null : params.guidance_scale.value,
    max_sequence_length: route.trueCfg || route.integratedControl ? params.max_sequence_length.value : null,
    control_guidance_start:
      route.guidanceWindowUnavailable || route.integratedControl ? null : params.control_guidance_start.value,
    control_guidance_end:
      route.guidanceWindowUnavailable || route.integratedControl ? null : params.control_guidance_end.value,
    ...(route.trueCfg && { true_cfg_scale: params.guidance_scale.value }),
    ...(route.integratedControl && { conditioning_scale: null, negative_prompt: null }),
  });
  const nativeSampler = record(sampler);
  assert.deepEqual(
    nativeSampler.fields,
    Object.fromEntries(Object.entries(expected).map(([field, value]) => [field, literal(value)])),
    'Saved control sampler fields differ from the graph.',
  );
  assert.equal(nativeSampler.mediaEvidence, undefined);
  return decoded;
}

function verifyIntegratedControlCheckpoint({ loader, target, pipelineClass, completed, hints, runtime, observations }) {
  assert.equal(target.modelSet.length, 1);
  assert.equal(observations.length, 1);
  const [{ repoId, revision }] = target.modelSet;
  const [observation] = observations;
  assert.equal(observation.error, false);
  assert.equal(observation.runtimeFingerprint, runtime.fingerprint);
  assert.equal(observation.models.length, 1);
  const [record] = observation.models;
  assert.equal(record.complete, true);
  assert.equal(record.repairRequired, false);
  const installed = selectInstalledModelIdentity(observation, repoId);
  assert.equal(installed.selectedRevision, revision);
  assert.equal(installed.modelRevision, repoId + '@' + revision);
  assert.deepEqual(loader.model_id.value, { source: 'hub', value: repoId });
  assert.equal(loader.revision.value, revision);
  assert.equal(loader.pipeline_class.value, pipelineClass);
  assert.equal(loader.conditioning_kind.value, 'none');
  assert.deepEqual(completed.runtimeHints, {
    ...hints,
    controlledArtifacts: [],
    loaderContract: ['modules.DiffusersImage.LoadPipeline'],
  });
  return { repoId, revision, source: 'integrated_checkpoint' };
}

function validateDirectMutationPreparation(preparation, pipelineClass, { loader, sampler, preview }) {
  const { availableRamBytes, availableVramBytes, mutationPreparation, ...status } = preparation;
  assert.ok([availableRamBytes, availableVramBytes].every((bytes) => Number.isSafeInteger(bytes) && bytes > 0));
  assert.deepEqual(status, {
    performed: true,
    reasons: ['direct pipeline mutation policy changed'],
    resourceMode: 'expert',
    incomingModelFamily: pipelineClass,
    previousModelFamily: pipelineClass,
    residentRecipeReusable: false,
    resourceRecipeChanged: false,
    cleanup: null,
  });
  const { memoryBefore, memoryAfter, ...release } = mutationPreparation;
  assert.deepEqual(release, {
    ownerIds: [loader],
    releasedNodeIds: [sampler, loader, preview].sort(),
    retainedOutputNodes: [sampler, preview].sort(),
    releasedComponentCount: 0,
  });
  for (const memory of [memoryBefore, memoryAfter]) {
    assert.equal(memory.available, true);
    assert.equal(memory.allocator_stats_status, 'paused_during_execution');
    assert.equal(memory.device_count, 1);
  }
}

export async function readSavedControlImageEvidence({
  clientRoot,
  manifest,
  graph,
  authoring,
  artifact,
  evidencePath,
}) {
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact);
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes);
  const route = savedControlRoute(manifest.id, evidence.format);
  assert.equal(
    evidence.format,
    route.loadFieldsOnly ? loadFieldsFormat : route.integratedControl ? retainedHostFormat : format,
  );
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
  const inputs = evidence.inputs;
  const roles = Object.keys(canonical.inputs);
  assert.equal(inputs.length, roles.length);
  assert.equal(new Set(inputs.map(({ file }) => file.sha256)).size, roles.length);
  for (const [index, role] of roles.entries()) {
    const { sourceValue } = inputs[index];
    const sourcePattern =
      route.integratedControl && role === 'source'
        ? /^@data\/images\/[\w-]{1,128}\.(?:png|webp)$/u
        : /^@data\/images\/[\w-]{1,128}\.png$/u;
    assert.match(sourceValue, sourcePattern);
    const fileSlot = expected.nodes[canonical.inputs[role]].params.file;
    assert.deepEqual(fileSlot, { display: 'filebrowser', value: role === 'source' ? [] : '' });
    fileSlot.value = [sourceValue];
  }
  const prompt = graphRequest.nodes[actual.sampler].params.prompt.value;
  assert.ok(typeof prompt === 'string' && prompt.length > 0 && prompt.length <= 4096 && prompt === prompt.trim());
  assert.ok(!/[\u0000-\u001f\u007f]/u.test(prompt));
  const promptSlot = expected.nodes[canonical.sampler].params.prompt;
  assert.deepEqual(promptSlot, { display: 'textarea', value: '' });
  promptSlot.value = prompt;
  if (route.loadFieldsOnly) {
    const loader = expected.nodes[canonical.loader].params;
    assert.equal(loader.execution_profile_id, undefined);
    loader.execution_profile_id = { value: '' };
    for (const [key, original, retained] of route.controls) {
      const parameter = expected.nodes[canonical.sampler].params[key];
      assert.equal(parameter.value, original);
      parameter.value = retained;
    }
  }
  const identity = canonicalGraphIdentity(expected);
  for (const graphSource of [graphRequest, creator.apiGraph, ...visual]) {
    assert.equal(
      canonicalGraphIdentity(graphSource).hash,
      identity.hash,
      'Saved graph differs outside its prompt and selected images.',
    );
  }
  const nativeStore = route.integratedControl ? read(evidence.persistedOutput) : undefined;
  const stored = nativeStore ? JSON.parse(nativeStore.bytes).outputs : undefined;
  if (stored) assert.equal(stored.length, 1);
  const validate = route.lateOutput ? validateLateNativeSingleAssetRun : validateNativeVariantRun;
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
    validatePreparation: (value) =>
      route.loadFieldsOnly
        ? validateDirectMutationPreparation(value, route.pipelineClass, actual)
        : route.previousExpertFamily
          ? validateImagePromptPreparation(value, {
              modelType: route.pipelineClass,
              previousExpertFamily: route.previousExpertFamily,
            })
          : validateUnmodifiedExpertPreparation(value, route.pipelineClass),
    ...(route.lateOutput && { persistedOutput: (stored ?? json(evidence.persistedOutput).outputs)[0] }),
  });
  if (stored) {
    assert.equal(stored[0].taskId, task.task_id);
    assert.equal(stored[0].mediaHash, output.mediaHash);
    assert.deepEqual(stored[0].apiGraphSnapshot, output.apiGraphSnapshot);
    assert.deepEqual(stored[0].resolvedExecutionInputs, output.resolvedExecutionInputs);
    verifyRetainedHostImageFiles(json(evidence.hostInputFiles), {
      taskId: task.task_id,
      persistedOutputSha256: sha256(nativeStore.bytes),
      inputs,
    });
  }
  const decoded = verifySavedControlImageInputs(graphRequest, output, inputs, manifest.id, evidence.format);
  const imageBindings = Object.fromEntries(
    await Promise.all(
      roles.map(async (role, index) => {
        const input = inputs[index];
        const decodedImage = decoded[index];
        const file = read(input.file);
        if (route.integratedControl || route.loadFieldsOnly) {
          const dimensions = await decodedMediaHash(file.file, 'image');
          assert.deepEqual([dimensions.width, dimensions.height], [decodedImage.width, decodedImage.height]);
        }
        if (!route.integratedControl) {
          verifyRetainedPngUpload(json(input.upload), input, decodedImage, file.bytes);
        }
        return [role, { nodeId: actual.inputs[role], field: 'file', sha256: input.file.sha256, decodedImage }];
      }),
    ),
  );
  const source = backendSourceEvidence({
    before: json(evidence.backendSourceBefore).identity,
    after: json(evidence.backendSourceAfter).identity,
    runtimeFingerprint: task.runtimeFingerprint,
  });
  assert.deepEqual(source.blockers, []);
  const expectedSource = 'sha256:backend-source-v1:' + route.source;
  assert.equal(source.identity.fingerprint, expectedSource);
  const { bytes: nodeBytes } = read(evidence.nodes);
  if (route.originalRegistryHash) {
    assert.equal(evidence.registryReplay, undefined);
    assert.equal(sha256(nodeBytes), route.originalRegistryHash);
  } else {
    assert.deepEqual(json(evidence.registryReplay), {
      scope: 'Original nodes handler only, with exact source and runtime contract',
      modelRuns: 0,
      fileCount: source.identity.files.length,
      sourceFingerprint: expectedSource,
      runtimeContract: route.windows ? windowsReplayRuntime : linuxReplayRuntime,
      nodeHash: sha256(nodeBytes),
      nodeBytes: nodeBytes.length,
    });
  }
  const backendContract = backendContractIdentity(JSON.parse(nodeBytes), identity.canonicalGraph);
  assert.ok(backendContract.fingerprint);
  const runtime = selectBackendRuntimeFingerprintEvidence([task.runtimeFingerprint]);
  const verifyModels = route.integratedControl ? verifyIntegratedControlCheckpoint : verifyConditioningModels;
  const control = verifyModels({
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
  assert.match(runtime.packages.platform, route.windows ? /^Windows-/u : /^Linux-/u);
  assert.equal(measurement.backend, route.windows ? 'cuda' : 'rocm');
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
  const decodedOutput = await decodedMediaHash(media.file, 'image');
  const params = graphRequest.nodes[actual.sampler].params;
  assert.deepEqual(technicalMediaErrors(decodedOutput, { width: params.width.value, height: params.height.value }), []);
  assert.deepEqual([item.width, item.height], [decodedOutput.width, decodedOutput.height]);
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
    inputBinding: imageBindings.source ?? imageBindings.guide,
    ...(imageBindings.source && { guideBinding: imageBindings.guide }),
    ...(imageBindings.mask && { maskBinding: imageBindings.mask }),
    conditioningModel: control,
    promptBinding: { nodeId: actual.sampler, field: 'prompt', sha256: sha256(prompt) },
    decodedOutput: { hash: decodedOutput.hash, width: decodedOutput.width, height: decodedOutput.height },
    observationLimits: {
      fullConsumedFieldAccounting: false,
      processedControlPixelsObserved: false,
      ...(route.loadFieldsOnly && {
        nativeEdgeMapObserved: false,
        sourceByteWitness: 'native-load-and-upload-with-typed-wire',
      }),
      ...(route.cannyMediaWitness && { nativeEdgeMapObserved: true }),
      ...(route.integratedControl && {
        originalUploadResponsesObserved: false,
        hostFilesMatchedNativeLoads: true,
      }),
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
