import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { stableJsonValue } from './canonical-json.mjs';
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

export const PRIVATE_IMAGE_EDIT_FORMAT = 'modiff.private.lcm-source-bound-edit.v1';
export const DIRECT_IMAGE_EDIT_FORMAT = 'modiff.private.direct-image-edit-source-bound.v1';
export const NATIVE_PNG_EDIT_FORMAT = 'modiff.private.direct-image-edit-native-png.v1';
export const NATIVE_PNG_INPAINT_FORMAT = 'modiff.private.direct-image-inpaint-native-png.v1';
const baseConsumed = ['num_inference_steps', 'output_type', 'prompt', 'seed'];
const imageGeometry = ['height', 'max_sequence_length', 'width'];
const stableDiffusionEditConsumed = [...baseConsumed, 'negative_prompt', 'guidance_scale', 'strength'];
const editRoutes = new Map([
  [
    'LatentConsistencyModelPipeline:edit_image',
    {
      modelRepo: 'SimianLuo/LCM_Dreamshaper_v7',
      modelRevision: 'a85df6a8bd976cdd08b4fd8f3b73f229c9e54df5',
      loaderClass: 'LatentConsistencyModelImg2ImgPipeline',
      format: PRIVATE_IMAGE_EDIT_FORMAT,
      captureFormat: 'modiff.private.lcm-image-edit-observation.v1',
      consumed: [...baseConsumed, 'guidance_scale', 'strength'],
    },
  ],
  [
    'SanaSprintPipeline:edit_image',
    {
      modelRepo: 'Efficient-Large-Model/Sana_Sprint_0.6B_1024px_diffusers',
      modelRevision: 'aa76e7f4f4928f378716b6716a2130fba3caf5b1',
      loaderClass: 'SanaSprintImg2ImgPipeline',
      format: DIRECT_IMAGE_EDIT_FORMAT,
      captureFormat: 'modiff.private.direct-image-edit-observation.v1',
      consumed: [...baseConsumed, ...imageGeometry, 'guidance_scale', 'strength'],
      fullNativeSnapshot: true,
      strengthVariant: { original: 0.5, retained: 0.75 },
    },
  ],
  [
    'StableDiffusionPipeline:edit_image',
    {
      modelRepo: 'stable-diffusion-v1-5/stable-diffusion-v1-5',
      modelRevision: '451f4fe16113bff5a5d2269ed5ad43b0592e9a14',
      loaderClass: 'StableDiffusionImg2ImgPipeline',
      format: DIRECT_IMAGE_EDIT_FORMAT,
      captureFormat: 'modiff.private.direct-image-edit-observation.v1',
      consumed: stableDiffusionEditConsumed,
      fullNativeSnapshot: true,
      inputPathPrefix: '@data/images/',
      windowsCudaRuntime: true,
      nativePngEvidence: true,
    },
  ],
  [
    'StableDiffusionPipeline:inpaint',
    {
      modelRepo: 'stable-diffusion-v1-5/stable-diffusion-v1-5',
      modelRevision: '451f4fe16113bff5a5d2269ed5ad43b0592e9a14',
      loaderClass: 'StableDiffusionInpaintPipeline',
      format: NATIVE_PNG_INPAINT_FORMAT,
      captureFormat: 'modiff.private.direct-image-inpaint-observation.v1',
      consumed: [...stableDiffusionEditConsumed, 'width', 'height'],
      fullNativeSnapshot: true,
      inputPathPrefix: '@data/images/',
      windowsCudaRuntime: true,
      nativePngEvidence: true,
      masked: true,
    },
  ],
  [
    'StableDiffusionXLPipeline:edit_image',
    {
      modelRepo: 'stabilityai/stable-diffusion-xl-base-1.0',
      modelRevision: '462165984030d82259a11f4367a4eed129e94a7b',
      loaderClass: 'StableDiffusionXLImg2ImgPipeline',
      format: DIRECT_IMAGE_EDIT_FORMAT,
      captureFormat: 'modiff.private.direct-image-edit-observation.v1',
      consumed: stableDiffusionEditConsumed,
      fullOrLateNativeSnapshot: true,
      inputPathPrefix: '@data/images/',
      nativePngEvidence: true,
    },
  ],
  [
    'StableDiffusionXLPipeline:inpaint',
    {
      modelRepo: 'stabilityai/stable-diffusion-xl-base-1.0',
      modelRevision: '462165984030d82259a11f4367a4eed129e94a7b',
      loaderClass: 'StableDiffusionXLInpaintPipeline',
      format: NATIVE_PNG_INPAINT_FORMAT,
      captureFormat: 'modiff.private.direct-image-inpaint-observation.v1',
      consumed: [...stableDiffusionEditConsumed, 'width', 'height'],
      fullNativeSnapshot: true,
      inputPathPrefix: '@data/images/',
      windowsCudaRuntime: true,
      nativePngEvidence: true,
      masked: true,
      strengthVariant: { original: 0.8, retained: 1 },
    },
  ],
]);
const lcmRoute = editRoutes.get('LatentConsistencyModelPipeline:edit_image');

const ownerOrder = [
  ['quantization', 'modules.DiffusersRuntime', 'PipelineQuantizationConfigV2'],
  ['recipe', 'modules.DiffusersRuntime', 'DiffusersExecutionRecipe'],
  ['loader', 'modules.DiffusersImage', 'LoadPipeline'],
  ['source', 'modules.Image', 'Load'],
  ['edit', 'modules.DiffusersImage', 'Edit'],
  ['preview', 'modules.Image', 'Preview'],
];
const inpaintOwners = [
  ...ownerOrder.slice(0, 4),
  ['mask', 'modules.Image', 'Load'],
  ['edit', 'modules.DiffusersImage', 'Inpaint'],
  ownerOrder.at(-1),
];
const editableFields = [
  ...baseConsumed,
  ...imageGeometry,
  'cfg_normalize',
  'control_guidance_end',
  'control_guidance_start',
  'guidance_scale',
  'image_guidance_scale',
  'layers',
  'negative_prompt',
  'padding_mask_crop',
  'pag_adaptive_scale',
  'pag_scale',
  'reference_strength',
  'resolution',
  'strength',
  'use_en_prompt',
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (a, b, message) => assert.equal(stableStringify(a), stableStringify(b), message);
const keys = (row, expected) =>
  same(Object.keys(row ?? {}).sort(), [...expected].sort(), 'Unexpected evidence fields.');

function directOwners(api, hinted = false, masked = false) {
  keys(api, ['sid', 'nodes', 'paths', ...(hinted ? ['runtimeHints'] : [])]);
  const owners = masked ? inpaintOwners : ownerOrder;
  assert.equal(Object.keys(api.nodes).length, owners.length);
  assert.equal(api.paths.length, 1);
  const route = api.paths[0];
  assert.equal(route.length, owners.length);
  assert.equal(new Set(route).size, owners.length);
  return Object.fromEntries(
    owners.map(([role, module, action], index) => {
      const id = route[index];
      const node = api.nodes[id];
      keys(node, ['module', 'action', 'params']);
      assert.equal(node.module, module);
      assert.equal(node.action, action);
      return [role, { id, node }];
    }),
  );
}

export function bindPrivateImageEditGraph({
  expected,
  submitted,
  input,
  maskInput,
  strengthVariant,
  inputPathPrefix = '',
  nativePngEvidence = false,
}) {
  const bound = structuredClone(expected);
  const masked = maskInput !== undefined;
  const canonical = directOwners(bound, false, masked);
  const observed = directOwners(submitted, Object.hasOwn(submitted, 'runtimeHints'), masked);
  const canonicalPrompt = canonical.edit.node.params.prompt;
  assert.equal(canonicalPrompt.value, '');
  const safeBasename = nativePngEvidence ? /^[a-zA-Z0-9_-][\w.-]{0,200}\.png$/u : /^[a-zA-Z0-9_-][\w.-]{0,200}\.webp$/u;
  const bindFile = (role, reference) => {
    const field = canonical[role].node.params.file;
    assert.deepEqual(field, { value: role === 'mask' ? '' : [], display: 'filebrowser' });
    assert.equal(reference.nodeId, observed[role].id);
    assert.equal(reference.field, 'file');
    assert.ok(typeof reference.sourceValue === 'string' && reference.sourceValue.startsWith(inputPathPrefix));
    assert.match(reference.sourceValue.slice(inputPathPrefix.length), safeBasename);
    field.value = [reference.sourceValue];
  };
  bindFile('source', input);
  if (masked) bindFile('mask', maskInput);
  const prompt = observed.edit.node.params.prompt.value;
  assert.ok(typeof prompt === 'string' && prompt.length > 0 && prompt.length <= 4096 && prompt.trim() === prompt);
  assert.ok(!/[\u0000-\u001f\u007f]/u.test(prompt));
  canonicalPrompt.value = prompt;
  if (strengthVariant) {
    assert.equal(canonical.edit.node.params.strength.value, strengthVariant.original);
    canonical.edit.node.params.strength.value = strengthVariant.retained;
  }
  const identity = canonicalGraphIdentity(bound);
  same(
    canonicalGraphIdentity(submitted),
    identity,
    'Submitted edit differs outside its declared file, prompt and reviewed control variant.',
  );
  return { ...observed, prompt, identity };
}

export function validatePrivateImageEditFields(bound, output, consumed = lcmRoute.consumed) {
  const accounting = output.resolvedExecutionInputs;
  for (const field of ['unavailableFields', 'uncapturedNodeIds']) same(accounting[field], []);
  // The legacy flat summary combines the GPU loader/recipe and the inactive
  // CPU preview selector. Only its exact, independently scoped causes are safe.
  // Source and mask also each publish their own exact decoded image facts.
  same(
    accounting.ambiguousFields,
    bound.mask ? ['device', 'imageAlphaChannel', 'imageSourceHashes', 'imageSourceModes'] : ['device'],
  );
  const roles = (bound.mask ? inpaintOwners : ownerOrder).map(([role]) => bound[role]);
  same(accounting.nodes.map(({ nodeId }) => nodeId).sort(), roles.map(({ id }) => id).sort());
  for (const { id, node } of roles) {
    const observed = accounting.nodes.find(({ nodeId }) => nodeId === id);
    assert.equal(observed.module, node.module);
    assert.equal(observed.action, node.action);
    same(observed.omittedFields, {});
  }
  for (const [role, value, flags] of [
    ['recipe', 'cuda:0', { disposition: 'consumed' }],
    ['loader', 'cuda:0', { disposition: 'superseded', reason: 'connected-recipe' }],
    ['preview', 'cpu:0', { disposition: 'inactive', reason: 'already-decoded-image' }],
  ]) {
    const { id, node } = bound[role];
    const observed = accounting.nodes.find(({ nodeId }) => nodeId === id);
    assert.equal(node.params.device.value, value);
    same(observed.fields.device, { value, source: 'literal' });
    same(observed.fieldAccounting.fields.device, { ...flags, inputValue: value, value, source: 'literal' });
  }
  const { fields, complete, inputProjections, outputProjections, unaccountedFields, omittedFields } =
    accounting.nodes.find(({ nodeId }) => nodeId === bound.edit.id).fieldAccounting;
  assert.equal(complete, true);
  same(unaccountedFields, []);
  same(omittedFields, {});
  keys(inputProjections, bound.mask ? ['image', 'mask_image'] : ['image']);
  keys(outputProjections, []);
  const params = bound.edit.node.params;
  const metadata = 'image_contract';
  const known = [...editableFields, metadata];
  keys(fields, known);
  keys(params, [...known, 'image', 'pipeline', ...(bound.mask ? ['mask_image'] : [])]);
  for (const field of known) {
    const value = params[field].value;
    assert.notEqual(value, undefined);
    const expected =
      field === metadata
        ? {
            disposition: 'metadata',
            reason: 'presentation-contract',
            sha256: sha256(`image-contract-v1\n${JSON.stringify(stableJsonValue(value))}`),
          }
        : {
            ...(consumed.includes(field)
              ? { disposition: 'consumed' }
              : { disposition: 'inactive', reason: 'adapter-inactive' }),
            inputValue: value,
            value,
          };
    same(fields[field], { ...expected, source: 'literal' }, `Native Edit field differs: ${field}.`);
  }
  return fields;
}

async function verifySourceBinding(clientRoot, bound, output, input, route) {
  const { createServer } = await import('vite');
  const server = await createServer({
    root: clientRoot,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  try {
    const { verifyImageEditSourceBinding, verifyImageInpaintSourceBinding } = await server.ssrLoadModule(
      '/scripts/image-edit-source-binding.mjs',
    );
    const receipt = output.resolvedExecutionInputs;
    if (bound.mask) {
      const { source, mask } = verifyImageInpaintSourceBinding({
        submittedApi: output.apiGraphSnapshot,
        receipt,
        outputIdentity: output,
        sourceId: bound.source.id,
        maskId: bound.mask.id,
        inpaintId: bound.edit.id,
        expectedOwner: route,
      });
      assert.equal(source.sourceFile.sha256, input.file.sha256);
      assert.equal(source.sourceFile.byteSize, input.file.bytes);
      return { decodedInput: source.decodedImage, mask };
    }
    const joined = verifyImageEditSourceBinding({
      submittedApi: output.apiGraphSnapshot,
      receipt,
      outputIdentity: output,
      loadId: bound.source.id,
      editId: bound.edit.id,
    });
    assert.equal(joined.sourceFile.sha256, input.file.sha256);
    assert.equal(joined.sourceFile.byteSize, input.file.bytes);
    return { decodedInput: joined.decodedImage };
  } finally {
    await server.close();
  }
}

export function validatePrivateImageEditRuntimePlatform(workflowId, platform, backend) {
  const route = editRoutes.get(workflowId);
  assert.ok(route, 'Unknown private image-edit evidence route.');
  if (route.windowsCudaRuntime && /^Windows-/iu.test(platform)) {
    assert.equal(backend, 'cuda');
  } else {
    assert.match(platform, /Linux/iu);
    assert.equal(backend, 'rocm');
  }
}

function validateRuntime(
  task,
  hints,
  completion,
  observation,
  bound,
  workflowId,
  { modelRepo, modelRevision, loaderClass },
) {
  same(
    completion.runtimeHints,
    {
      ...hints,
      controlledArtifacts: [],
      loaderContract: ['modules.DiffusersImage.LoadPipeline'],
    },
    'Native completion runtime envelope differs.',
  );
  const runtime = selectBackendRuntimeFingerprintEvidence([task.runtimeFingerprint]);
  validatePrivateImageEditRuntimePlatform(workflowId, runtime.packages.platform, task.runtimeMeasurement.backend);
  assert.equal(runtime.torch.cuda_available, true);
  assert.equal(task.runtimeMeasurement.device, 'cuda:0');
  const { elapsedSeconds, peakAllocatedBytes, peakReservedBytes, peakMeasurementVersion } = task.runtimeMeasurement;
  assert.equal(peakMeasurementVersion, 2);
  assert.ok(Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 && elapsedSeconds <= 7200);
  assert.ok(Number.isSafeInteger(peakAllocatedBytes) && peakAllocatedBytes > 0);
  assert.ok(Number.isSafeInteger(peakReservedBytes) && peakReservedBytes >= peakAllocatedBytes);
  assert.equal(observation.error, false);
  assert.equal(observation.runtimeFingerprint, runtime.fingerprint);
  assert.equal(observation.models.length, 1);
  assert.equal(observation.models[0].complete, true);
  assert.equal(observation.models[0].repairRequired, false);
  const model = selectInstalledModelIdentity(observation, modelRepo);
  assert.equal(model?.selectedRevision, modelRevision);
  assert.equal(model?.modelRevision, `${modelRepo}@${modelRevision}`);
  const loader = bound.loader.node.params;
  same(loader.model_id.value, { source: 'hub', value: modelRepo });
  assert.equal(loader.revision.value, modelRevision);
  assert.equal(loader.pipeline_class.value, loaderClass);
  return { runtime, elapsedSeconds, peakAllocatedBytes };
}

export function verifyRetainedPngUpload(upload, input, decoded, bytes) {
  keys(upload, ['error', 'path', 'media']);
  assert.equal(upload.error, false);
  assert.equal(upload.path, input.sourceValue);
  assert.match(input.sourceValue, /^@data\/images\/[a-zA-Z0-9_-][\w.-]{0,200}\.png$/u);
  same(
    upload.media,
    {
      filename: input.sourceValue.split('/').at(-1),
      extension: '.png',
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      kind: 'image',
      mimeType: 'image/png',
      width: decoded.width,
      height: decoded.height,
      frames: 1,
    },
    'The retained source upload differs from the exact native PNG input.',
  );
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'The retained source is not PNG.');
}

export async function readPrivateImageEditEvidence({ clientRoot, manifest, graph, authoring, artifact, evidencePath }) {
  const workflowId = manifest.id;
  const route = editRoutes.get(workflowId);
  assert.ok(route, 'Unknown private image-edit evidence route.');
  const { modelRepo, modelRevision, loaderClass } = route;
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact);
  same(target.modelSet, [{ repoId: modelRepo, revision: modelRevision }], 'Private edit model pin differs.');
  same(target.outputPlan.mediaKinds, ['image']);
  assert.equal(target.outputPlan.minimumAssetCount, 1);
  const stat = lstatSync(evidencePath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 65_536);
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes);
  const masked = route.masked === true;
  const pngFormat = masked ? NATIVE_PNG_INPAINT_FORMAT : NATIVE_PNG_EDIT_FORMAT;
  const nativePngEvidence = route.nativePngEvidence === true && evidence.format === pngFormat;
  keys(evidence, [
    'schemaVersion',
    'format',
    'workflowId',
    'capture',
    'graphRequest',
    'graphAcknowledgment',
    'persistedOutputs',
    ...(nativePngEvidence ? ['inputUpload'] : ['inputServerBefore', 'inputServerAfter']),
    ...(masked ? ['maskUpload'] : []),
  ]);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.format, nativePngEvidence ? pngFormat : route.format);
  assert.equal(evidence.workflowId, workflowId);
  const evidenceRoot = realpathSync(dirname(evidencePath));
  const retainedFiles = [];
  const read = (ref, maximum = 16 * 1024 * 1024) => {
    const physical = readCanonicalEvidenceFile(evidenceRoot, ref, maximum);
    retainedFiles.push({ ...ref, absolutePath: physical.file });
    return physical;
  };
  const json = (ref) => JSON.parse(read(ref).bytes);
  const capture = json(evidence.capture);
  keys(capture, [
    'schemaVersion',
    'format',
    'workflowId',
    'qualificationClaims',
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
  assert.equal(capture.schemaVersion, 1);
  assert.equal(capture.format, route.captureFormat);
  assert.equal(capture.workflowId, workflowId);
  same(capture.qualificationClaims, { releaseEligible: false, technicalVariant: true });
  assert.equal(capture.inputs.length, masked ? 2 : 1);
  assert.equal(capture.outputs.length, 1);
  assert.equal(capture.modelObservations.length, 1);
  const [input, maskInput] = capture.inputs;
  const [outputRef] = capture.outputs;
  for (const source of capture.inputs) keys(source, ['nodeId', 'field', 'sourceValue', 'file']);
  keys(outputRef, ['backendPath', 'mediaType', 'file']);
  const creator = json(capture.creatorPackage);
  const outputPackage = json(capture.outputPackage);
  const run = json(capture.runDetail);
  const graphCompleted = json(capture.graphCompleted);
  const graphRequest = json(evidence.graphRequest);
  const graphAcknowledgment = json(evidence.graphAcknowledgment);
  const store = json(evidence.persistedOutputs);
  assert.equal(store.outputs.length, 1);
  const [persistedOutput] = store.outputs;
  const [expected, ...visualExports] = await exportCanonicalWorkflowGraphs(clientRoot, [
    graph,
    creator.graph,
    outputPackage.latestOutput.graphSnapshot,
    run.workflow_snapshot,
  ]);
  const bound = bindPrivateImageEditGraph({
    expected,
    submitted: graphRequest,
    input,
    maskInput,
    strengthVariant: route.strengthVariant,
    inputPathPrefix: route.inputPathPrefix,
    nativePngEvidence,
  });
  for (const api of [creator.apiGraph, ...visualExports]) {
    directOwners(api, false, masked);
    same(canonicalGraphIdentity(api), bound.identity, 'A saved visual owner graph differs from the original Run.');
  }
  const runOptions = {
    target,
    outputNodeId: bound.preview.id,
    displayType: 'image',
    creator,
    outputPackage,
    run,
    graphCompleted,
    graphRequest,
    graphAcknowledgment,
    persistedOutput,
    validatePreparation: (preparation) => validateUnmodifiedExpertPreparation(preparation, loaderClass),
  };
  const hasNativeSnapshot =
    route.fullNativeSnapshot || (route.fullOrLateNativeSnapshot && run.outputs[0]?.apiGraphSnapshot !== undefined);
  if (hasNativeSnapshot) {
    assert.equal(run.outputs.length, 1);
    same(run.outputs[0], persistedOutput, 'Saved native output differs from the at-close output store.');
  }
  const validateRun = hasNativeSnapshot ? validateNativeVariantRun : validateLateNativeImageVariantRun;
  const { task, output, hints } = validateRun(runOptions);
  same(hints.workflowSnapshot.studioForm, output.formSnapshot);
  validatePrivateImageEditFields(bound, output, route.consumed);
  const { decodedInput, mask } = await verifySourceBinding(clientRoot, bound, output, input, route);
  const inputMedia = read(input.file);
  if (nativePngEvidence) {
    verifyRetainedPngUpload(json(evidence.inputUpload), input, decodedInput, inputMedia.bytes);
  } else {
    for (const ref of [evidence.inputServerBefore, evidence.inputServerAfter]) {
      assert.ok(read(ref).bytes.equals(inputMedia.bytes), 'The server-bound source bytes differ.');
    }
  }
  if (masked) {
    const maskMedia = read(maskInput.file);
    assert.equal(mask.sourceFile.sha256, maskInput.file.sha256);
    assert.equal(mask.sourceFile.byteSize, maskInput.file.bytes);
    verifyRetainedPngUpload(json(evidence.maskUpload), maskInput, mask.decodedImage, maskMedia.bytes);
  }
  const media = read(outputRef.file);
  const item = validateNativeVariantOutput({
    output,
    outputRef,
    task,
    bytes: media.bytes,
    displayType: 'image',
    contentType: 'image/webp',
  });
  assert.match(output.id, /^run-output-[a-f0-9]{24}$/u);
  assert.equal(item.backendPath, `@data/studio/outputs/${output.id}_item_00.webp`);
  assert.equal(output.mediaCollectionHash, `sha256:collection:${sha256(JSON.stringify([item.mediaHash]))}`);
  const { decodedMediaHash, technicalMediaErrors } = await import('./template-gallery-harness.mjs');
  const decoded = await decodedMediaHash(media.file, 'image');
  same(technicalMediaErrors(decoded, { width: decodedInput.width, height: decodedInput.height }), []);
  assert.equal(item.width, decoded.width);
  assert.equal(item.height, decoded.height);
  const backendContract = backendContractIdentity(json(capture.nodes), bound.identity.canonicalGraph);
  assert.ok(backendContract.fingerprint);
  const source = backendSourceEvidence({
    before: json(capture.backendSourceBefore).identity,
    after: json(capture.backendSourceAfter).identity,
    runtimeFingerprint: task.runtimeFingerprint,
  });
  same(source.blockers, []);
  const { runtime, elapsedSeconds, peakAllocatedBytes } = validateRuntime(
    task,
    hints,
    graphCompleted,
    json(capture.modelObservations[0]),
    bound,
    workflowId,
    route,
  );
  for (const ref of retainedFiles) readCanonicalEvidenceFile(evidenceRoot, ref, 16 * 1024 * 1024);
  assert.ok(readFileSync(evidencePath).equals(descriptorBytes), 'Evidence descriptor changed during validation.');
  const receipt = {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-run-receipt.v1',
    proofKind: 'real_backend_input_bound_model_variant',
    ...target,
    taskId: task.task_id,
    capturedAt: new Date(task.completed_at * 1000).toISOString(),
    graphHash: bound.identity.hash,
    resourceCandidateId: null,
    outputHash: item.mediaHash,
    runtimeFingerprint: normalizeBackendRuntime(runtime).lockFingerprint,
    backendSourceFingerprint: source.identity.fingerprint,
    backendContractFingerprint: backendContract.fingerprint,
    executionDurationSeconds: elapsedSeconds,
    peakMemoryBytes: peakAllocatedBytes,
    canonicalDefaultsExecuted: false,
    inputBinding: { nodeId: input.nodeId, field: 'file', sha256: input.file.sha256, decodedImage: decodedInput },
    ...(masked
      ? {
          maskBinding: {
            nodeId: maskInput.nodeId,
            field: 'file',
            sha256: maskInput.file.sha256,
            decodedImage: mask.decodedImage,
          },
        }
      : {}),
    promptBinding: { nodeId: bound.edit.id, field: 'prompt', sha256: sha256(bound.prompt) },
    decodedOutput: { hash: decoded.hash, width: decoded.width, height: decoded.height },
    observationLimits: {
      fullConsumedFieldAccounting: false,
      editConsumerControlsObserved: true,
      sourceGeometryQualified: false,
      ...(nativePngEvidence ? { sourceByteWitness: 'native-load-consumer-and-upload' } : {}),
      ...(masked ? { maskByteWitness: 'native-load-consumer-and-upload' } : {}),
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
    provenance: { format: 'modiff.input-bound-model-variant-proof.v1', receipt },
    evidence,
    descriptorBytes,
    retainedFiles,
    evidenceRoot,
  };
}
