import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  backendContractIdentity,
  backendSourceEvidence,
  canonicalGraphIdentity,
  normalizeBackendRuntime,
  selectBackendRuntimeFingerprintEvidence,
  selectInstalledModelIdentity,
  stableStringify,
} from './live-proof-provenance.mjs';
import { verifyNativeLoadedImage } from './native-image-load-evidence.mjs';
import { validateNativeVariantRun, validateUnmodifiedExpertPreparation } from './native-variant-run-evidence.mjs';
import {
  canonicalWorkflowAuthoringContract,
  exportCanonicalWorkflowGraphs,
  readCanonicalEvidenceFile,
} from './release-contract-core.mjs';
import { decodedMediaHash } from './template-gallery-harness.mjs';

const workflowId = 'QwenImageLayeredPipeline:layer_decomposition';
const repoId = 'Qwen/Qwen-Image-Layered';
const revision = '8f0ca708dfff6ba1dd5f2d85d78f8c108a040bcf';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (a, b, message) => assert.equal(stableStringify(a), stableStringify(b), message);
const literal = (value) => ({ value, source: 'literal' });
const chain = [
  'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
  'modules.DiffusersRuntime.DiffusersExecutionRecipe',
  'modules.DiffusersImage.LoadPipeline',
  'modules.Image.Load',
  'modules.DiffusersImage.LayerDecompose',
  'modules.Image.Preview',
];

function chainOwners(api) {
  assert.equal(api.paths.length, 1);
  const [path] = api.paths;
  same([...path].sort(), Object.keys(api.nodes).sort(), 'The layer graph scope differs.');
  same(
    path.map((id) => `${api.nodes[id].module}.${api.nodes[id].action}`),
    chain,
    'Layer stage order differs.',
  );
  return path;
}

function verifyLayerInputs(output, api, path, input) {
  const [, , loaderId, sourceId, splitId, previewId] = path;
  const inputReceipt = output.resolvedExecutionInputs;
  assert.equal(inputReceipt.schemaVersion, 1);
  assert.equal(inputReceipt.source, 'backend-execution');
  assert.equal(inputReceipt.truncated, false);
  assert.equal(inputReceipt.taskId, output.taskId);
  assert.equal(inputReceipt.nodeId, previewId);
  assert.equal(inputReceipt.attemptIndex, 0);
  same(inputReceipt.mediaEvidenceStatus, { schemaVersion: 1, truncated: false });
  same(inputReceipt.uncapturedNodeIds, []);
  same(inputReceipt.unavailableFields, []);
  same(inputReceipt.nodes.map(({ nodeId }) => nodeId).sort(), [...path].sort());
  const record = (id) => {
    const row = inputReceipt.nodes.find(({ nodeId }) => nodeId === id);
    assert.equal(row.action, api.nodes[id].action);
    assert.equal(row.module, api.nodes[id].module);
    same(row.omittedFields, {});
    return row;
  };
  const { sourceFile, decodedImage } = verifyNativeLoadedImage(api.nodes[sourceId], record(sourceId), 'RGBA');
  same(
    [sourceFile.sourceValue, sourceFile.sha256, sourceFile.byteSize],
    [input.sourceValue, input.file.sha256, input.file.bytes],
    'Loaded layer source differs.',
  );
  const split = record(splitId);
  const preview = record(previewId);
  const loader = record(loaderId);
  same(loader.fields.model_id, literal(repoId));
  same(loader.fields.revision, literal(revision));
  same(loader.fields.mode, literal('layer_decomposition'));
  const params = api.nodes[splitId].params;
  const expected = Object.fromEntries(
    ['layers', 'resolution', 'cfg_normalize', 'use_en_prompt'].map((key) => [key, params[key].value]),
  );
  same(split.mediaEvidence.controls, expected, 'Layer adapter controls differ from the submitted graph.');
  for (const field of [
    'prompt',
    'negative_prompt',
    'num_inference_steps',
    'output_type',
    'max_sequence_length',
    'seed',
  ])
    same(split.fields[field], literal(params[field].value), `Layer adapter control differs: ${field}`);
  same(split.fields.true_cfg_scale, literal(params.guidance_scale.value));
  same(split.fields.executed_task, literal('layer_decomposition'));
  const layers = split.mediaEvidence.outputs.images;
  assert.equal(layers.length, expected.layers);
  assert.equal(split.mediaEvidence.status, 'complete');
  assert.equal(preview.mediaEvidence.status, 'complete');
  same(split.mediaEvidence.inputs, { image: [{ kind: 'image', ...decodedImage }] }, 'Consumed layer source differs.');
  same(preview.mediaEvidence.inputs.image, layers, 'Layer order changed before export.');
  return { decodedImage, layers };
}

export async function readLayerDecompositionEvidence({
  clientRoot,
  manifest,
  graph,
  authoring,
  artifact,
  evidencePath,
}) {
  assert.equal(manifest.id, workflowId);
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact);
  same(target.modelSet, [{ repoId, revision }]);
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes);
  assert.equal(evidence.format, 'modiff.private.native-layer-decomposition.v1');
  assert.equal(evidence.schemaVersion, 1);
  const root = realpathSync(dirname(evidencePath));
  const retainedFiles = [];
  const read = (ref) => {
    const { bytes, file } = readCanonicalEvidenceFile(root, ref, 16 * 1024 * 1024);
    retainedFiles.push({ ...ref, absolutePath: file });
    return { bytes, file };
  };
  const json = (ref) => JSON.parse(read(ref).bytes);
  const creator = json(evidence.creatorPackage);
  const outputPackage = json(evidence.outputPackage);
  const run = json(evidence.runDetail);
  const completed = json(evidence.graphCompleted);
  const request = json(evidence.graphRequest);
  const [expected, ...visual] = await exportCanonicalWorkflowGraphs(clientRoot, [
    graph,
    creator.graph,
    outputPackage.latestOutput.graphSnapshot,
    run.workflow_snapshot,
  ]);
  assert.equal(canonicalGraphIdentity(expected).hash, evidence.originalGraphHash);
  const expectedPath = chainOwners(expected);
  const path = chainOwners(request);
  const [, , , sourceId, splitId, previewId] = path;
  const input = evidence.input;
  assert.match(input.sourceValue, /^@data\/images\/[a-z0-9_-]{1,128}[.]png$/iu);
  assert.equal(input.nodeId, sourceId);
  const sourceSlot = expected.nodes[expectedPath[3]].params.file;
  same(sourceSlot, { display: 'filebrowser', value: [] });
  sourceSlot.value = [input.sourceValue];
  const prompt = request.nodes[splitId].params.prompt.value;
  assert.ok(typeof prompt === 'string' && prompt.length > 0 && prompt.length <= 4096 && prompt === prompt.trim());
  assert.ok(!/[\u0000-\u001f\u007f]/u.test(prompt));
  expected.nodes[expectedPath[4]].params.prompt.value = prompt;
  const identity = canonicalGraphIdentity(expected);
  for (const value of [request, creator.apiGraph, ...visual]) {
    same(canonicalGraphIdentity(value), identity, 'The layer graph differs outside its source and authored prompt.');
  }
  const { task, output, hints } = validateNativeVariantRun({
    target,
    outputNodeId: previewId,
    displayType: 'image_collection',
    creator,
    outputPackage,
    run,
    graphCompleted: completed,
    graphRequest: request,
    graphAcknowledgment: json(evidence.graphAcknowledgment),
    validatePreparation: (value) => validateUnmodifiedExpertPreparation(value, target.modelType),
  });
  same(hints.workflowSnapshot.studioForm, output.formSnapshot);
  same(completed.runtimeHints, {
    ...hints,
    controlledArtifacts: [],
    loaderContract: ['modules.DiffusersImage.LoadPipeline'],
  });
  const { decodedImage, layers } = verifyLayerInputs(output, request, path, input);
  const source = read(input.file);
  assert.equal(source.bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const upload = json(input.upload);
  assert.equal(upload.error, false);
  assert.equal(upload.path, input.sourceValue);
  same(
    [upload.media.sha256, upload.media.sizeBytes, upload.media.width, upload.media.height],
    [digest(source.bytes), source.bytes.length, decodedImage.width, decodedImage.height],
  );
  assert.equal(upload.media.frames, 1);
  assert.equal(upload.media.mimeType, 'image/png');
  const runtimeSource = backendSourceEvidence({
    before: json(evidence.backendSourceBefore).identity,
    after: json(evidence.backendSourceAfter).identity,
    runtimeFingerprint: task.runtimeFingerprint,
  });
  same(runtimeSource.blockers, []);
  const backendContract = backendContractIdentity(json(evidence.nodes), identity.canonicalGraph);
  assert.ok(backendContract.fingerprint);
  const runtime = selectBackendRuntimeFingerprintEvidence([task.runtimeFingerprint]);
  assert.match(runtime.packages.platform, /^Linux-/u);
  assert.equal(evidence.modelObservations.length, 1);
  const observation = json(evidence.modelObservations[0]);
  assert.equal(observation.error, false);
  assert.equal(observation.models.length, 1);
  assert.equal(observation.models[0].complete, true);
  assert.equal(observation.models[0].repairRequired, false);
  assert.equal(observation.runtimeFingerprint, runtime.fingerprint);
  const model = selectInstalledModelIdentity(observation, repoId);
  assert.equal(model?.selectedRevision, revision);
  assert.equal(model?.modelRevision, `${repoId}@${revision}`);
  const measurement = task.runtimeMeasurement;
  assert.equal(measurement.backend, 'rocm');
  assert.equal(measurement.device, 'cuda:0');
  assert.equal(measurement.peakMeasurementVersion, 2);
  assert.ok(measurement.elapsedSeconds > 0 && measurement.elapsedSeconds <= 7200);
  assert.ok(measurement.peakAllocatedBytes > 0);
  const media = await verifyLayerCollection(output, evidence.outputs, layers, read);
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
    backendSourceFingerprint: runtimeSource.identity.fingerprint,
    backendContractFingerprint: backendContract.fingerprint,
    resourceCandidateId: null,
    outputHash: output.mediaCollectionHash,
    executionDurationSeconds: measurement.elapsedSeconds,
    peakMemoryBytes: measurement.peakAllocatedBytes,
    canonicalDefaultsExecuted: false,
    inputBinding: { nodeId: sourceId, field: 'file', sha256: input.file.sha256, decodedImage },
    promptBinding: { nodeId: splitId, field: 'prompt', sha256: digest(prompt) },
    decodedOutput: { kind: 'image_collection', items: media },
    observationLimits: {
      fullConsumedFieldAccounting: false,
      orderedLayerStack: true,
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
    evidenceRoot: root,
    retainedFiles,
    provenance: { format: 'modiff.input-bound-model-variant-proof.v1', receipt },
  };
}

async function verifyLayerCollection(output, refs, layers, read) {
  assert.equal(refs.length, layers.length);
  assert.equal(output.mediaItems.length, layers.length);
  const hashes = output.mediaItems.map(({ mediaHash }) => mediaHash);
  assert.ok(hashes.every((hash) => /^sha256:bytes:[a-f0-9]{64}$/u.test(hash)));
  // The backend uses Python's default JSON separator for this ordered list.
  const serialized = `[${hashes.map((hash) => JSON.stringify(hash)).join(', ')}]`;
  assert.equal(output.mediaHash, `sha256:collection:${digest(serialized)}`);
  assert.equal(output.mediaCollectionHash, output.mediaHash);
  const provenance = output.backendProvenance;
  assert.equal(provenance.source, 'backend-record');
  assert.equal(provenance.backendExecutionId, output.taskId);
  for (const field of [
    'clientRunId',
    'runInputHash',
    'workflowTabId',
    'nodeId',
    'fieldKey',
    'attemptIndex',
    'mediaHash',
    'mediaCollectionHash',
    'mediaItems',
  ])
    same(provenance[field], output[field]);
  assert.equal(provenance.mediaPath, refs[0].backendPath);
  const decoded = [];
  for (const [index, ref] of refs.entries()) {
    const item = output.mediaItems[index];
    const layer = layers[index];
    assert.equal(layer.mode, 'RGBA');
    assert.equal(ref.mediaType, 'image');
    assert.equal(item.index, index);
    assert.equal(item.taskId, output.taskId);
    assert.equal(item.clientRunId, output.clientRunId);
    assert.equal(item.runInputHash, output.runInputHash);
    assert.equal(item.attemptIndex, 0);
    assert.equal(item.backendPath, ref.backendPath);
    assert.equal(item.backendPath, `@data/studio/outputs/${output.id}_item_0${index}.webp`);
    assert.equal(item.mediaHash, `sha256:bytes:${ref.file.sha256}`);
    assert.equal(item.contentType, 'image/webp');
    const { bytes, file } = read(ref.file);
    assert.equal(item.byteSize, bytes.length);
    const { hash, width, height } = await decodedMediaHash(file, 'image');
    same([width, height], [layer.width, layer.height], 'Delivered layer geometry differs.');
    same([width, height], [item.width, item.height], 'Saved layer geometry differs.');
    decoded.push({ hash, width, height, encodedSha256: ref.file.sha256 });
  }
  return decoded;
}
