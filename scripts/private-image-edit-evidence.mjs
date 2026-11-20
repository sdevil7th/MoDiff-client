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
  validateUnmodifiedExpertPreparation,
} from './native-variant-run-evidence.mjs';
import {
  canonicalWorkflowAuthoringContract,
  exportCanonicalWorkflowGraphs,
  readCanonicalEvidenceFile,
} from './release-contract-core.mjs';

export const PRIVATE_IMAGE_EDIT_FORMAT = 'modiff.private.lcm-source-bound-edit.v1';
const workflowId = 'LatentConsistencyModelPipeline:edit_image';
const modelRepo = 'SimianLuo/LCM_Dreamshaper_v7';
const modelRevision = 'a85df6a8bd976cdd08b4fd8f3b73f229c9e54df5';
const loaderClass = 'LatentConsistencyModelImg2ImgPipeline';
const ownerOrder = [
  ['quantization', 'modules.DiffusersRuntime', 'PipelineQuantizationConfigV2'],
  ['recipe', 'modules.DiffusersRuntime', 'DiffusersExecutionRecipe'],
  ['loader', 'modules.DiffusersImage', 'LoadPipeline'],
  ['source', 'modules.Image', 'Load'],
  ['edit', 'modules.DiffusersImage', 'Edit'],
  ['preview', 'modules.Image', 'Preview'],
];
const consumedEditFields = ['guidance_scale', 'num_inference_steps', 'output_type', 'prompt', 'seed', 'strength'];
const inactiveEditFields = [
  'cfg_normalize',
  'control_guidance_end',
  'control_guidance_start',
  'height',
  'image_guidance_scale',
  'layers',
  'max_sequence_length',
  'negative_prompt',
  'padding_mask_crop',
  'pag_adaptive_scale',
  'pag_scale',
  'reference_strength',
  'resolution',
  'use_en_prompt',
  'width',
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (a, b, message) => assert.equal(stableStringify(a), stableStringify(b), message);
const keys = (row, expected) =>
  same(Object.keys(row ?? {}).sort(), [...expected].sort(), 'Unexpected evidence fields.');

function directOwners(api, hinted = false) {
  keys(api, ['sid', 'nodes', 'paths', ...(hinted ? ['runtimeHints'] : [])]);
  assert.equal(Object.keys(api.nodes).length, ownerOrder.length);
  assert.equal(api.paths.length, 1);
  const route = api.paths[0];
  assert.equal(route.length, ownerOrder.length);
  assert.equal(new Set(route).size, ownerOrder.length);
  return Object.fromEntries(
    ownerOrder.map(([role, module, action], index) => {
      const id = route[index];
      const node = api.nodes[id];
      keys(node, ['module', 'action', 'params']);
      assert.equal(node.module, module);
      assert.equal(node.action, action);
      return [role, { id, node }];
    }),
  );
}

export function bindPrivateImageEditGraph({ expected, submitted, input }) {
  const bound = structuredClone(expected);
  const canonical = directOwners(bound);
  const observed = directOwners(submitted, Object.hasOwn(submitted, 'runtimeHints'));
  const canonicalInput = canonical.source.node.params.file;
  const canonicalPrompt = canonical.edit.node.params.prompt;
  assert.deepEqual(canonicalInput, { value: [], display: 'filebrowser' });
  assert.equal(canonicalPrompt.value, '');
  assert.equal(input.nodeId, observed.source.id);
  assert.equal(input.field, 'file');
  assert.match(input.sourceValue, /^[a-zA-Z0-9_-][\w.-]{0,200}\.webp$/u);
  const prompt = observed.edit.node.params.prompt.value;
  assert.ok(typeof prompt === 'string' && prompt.length > 0 && prompt.length <= 4096 && prompt.trim() === prompt);
  assert.ok(!/[\u0000-\u001f\u007f]/u.test(prompt));
  canonicalInput.value = [input.sourceValue];
  canonicalPrompt.value = prompt;
  const identity = canonicalGraphIdentity(bound);
  same(
    canonicalGraphIdentity(submitted),
    identity,
    'Submitted edit differs outside its single declared file and prompt.',
  );
  return { ...observed, prompt, identity };
}

export function validatePrivateImageEditFields(bound, output) {
  const accounting = output.resolvedExecutionInputs;
  for (const field of ['unavailableFields', 'uncapturedNodeIds']) same(accounting[field], []);
  // The legacy flat summary combines the GPU loader/recipe and the inactive
  // CPU preview selector. Only its exact, independently scoped causes are safe.
  same(accounting.ambiguousFields, ['device']);
  const roles = ownerOrder.map(([role]) => bound[role]);
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
  keys(inputProjections, ['image']);
  keys(outputProjections, []);
  const params = bound.edit.node.params;
  const metadata = 'image_contract';
  const known = [...consumedEditFields, ...inactiveEditFields, metadata];
  keys(fields, known);
  keys(params, [...known, 'image', 'pipeline']);
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
            ...(consumedEditFields.includes(field)
              ? { disposition: 'consumed' }
              : { disposition: 'inactive', reason: 'adapter-inactive' }),
            inputValue: value,
            value,
          };
    same(fields[field], { ...expected, source: 'literal' }, `Native Edit field differs: ${field}.`);
  }
  return fields;
}

async function verifySourceBinding(clientRoot, bound, output, input) {
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
    const { verifyImageEditSourceBinding } = await server.ssrLoadModule('/scripts/image-edit-source-binding.mjs');
    const receipt = output.resolvedExecutionInputs;
    const joined = verifyImageEditSourceBinding({
      submittedApi: output.apiGraphSnapshot,
      receipt,
      outputIdentity: output,
      loadId: bound.source.id,
      editId: bound.edit.id,
    });
    assert.equal(joined.sourceFile.sha256, input.file.sha256);
    assert.equal(joined.sourceFile.byteSize, input.file.bytes);
    return joined.decodedImage;
  } finally {
    await server.close();
  }
}

function validateRuntime(task, hints, completion, observation, bound) {
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
  assert.match(runtime.packages.platform, /Linux/iu);
  assert.equal(runtime.torch.cuda_available, true);
  assert.equal(task.runtimeMeasurement.backend, 'rocm');
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

export async function readPrivateImageEditEvidence({ clientRoot, manifest, graph, authoring, artifact, evidencePath }) {
  assert.equal(manifest.id, workflowId);
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact);
  same(target.modelSet, [{ repoId: modelRepo, revision: modelRevision }]);
  same(target.outputPlan.mediaKinds, ['image']);
  assert.equal(target.outputPlan.minimumAssetCount, 1);
  const stat = lstatSync(evidencePath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 65_536);
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes);
  keys(evidence, [
    'schemaVersion',
    'format',
    'workflowId',
    'capture',
    'graphRequest',
    'graphAcknowledgment',
    'persistedOutputs',
    'inputServerBefore',
    'inputServerAfter',
  ]);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.format, PRIVATE_IMAGE_EDIT_FORMAT);
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
  assert.equal(capture.format, 'modiff.private.lcm-image-edit-observation.v1');
  assert.equal(capture.workflowId, workflowId);
  same(capture.qualificationClaims, { releaseEligible: false, technicalVariant: true });
  assert.equal(capture.inputs.length, 1);
  assert.equal(capture.outputs.length, 1);
  assert.equal(capture.modelObservations.length, 1);
  const [input] = capture.inputs;
  const [outputRef] = capture.outputs;
  keys(input, ['nodeId', 'field', 'sourceValue', 'file']);
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
  const bound = bindPrivateImageEditGraph({ expected, submitted: graphRequest, input });
  for (const api of [creator.apiGraph, ...visualExports]) {
    directOwners(api);
    same(canonicalGraphIdentity(api), bound.identity, 'A saved visual owner graph differs from the original Run.');
  }
  const { task, output, hints } = validateLateNativeImageVariantRun({
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
  });
  same(hints.workflowSnapshot.studioForm, output.formSnapshot);
  validatePrivateImageEditFields(bound, output);
  const decodedInput = await verifySourceBinding(clientRoot, bound, output, input);
  const inputMedia = read(input.file);
  for (const ref of [evidence.inputServerBefore, evidence.inputServerAfter]) {
    assert.ok(read(ref).bytes.equals(inputMedia.bytes), 'The server-bound source bytes differ.');
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
    promptBinding: { nodeId: bound.edit.id, field: 'prompt', sha256: sha256(bound.prompt) },
    decodedOutput: { hash: decoded.hash, width: decoded.width, height: decoded.height },
    observationLimits: {
      fullConsumedFieldAccounting: false,
      editConsumerControlsObserved: true,
      sourceGeometryQualified: false,
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
