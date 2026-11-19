// The retained Spandrel x2 fixture fills the one file picker in the canonical graph.
// Its receipt attests a technical execution variant, without release or resource qualification.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateNativeVariantOutput, validateNativeVariantRun } from './native-variant-run-evidence.mjs';
import {
  canonicalWorkflowAuthoringContract,
  exportCanonicalWorkflowGraphs,
  readCanonicalEvidenceFile,
} from './release-contract-core.mjs';
import {
  backendSourceEvidence,
  canonicalGraphIdentity,
  normalizeBackendRuntime,
  selectBackendRuntimeFingerprintEvidence,
  selectInstalledModelIdentity,
  stableStringify,
} from './live-proof-provenance.mjs';

export const INPUT_BOUND_MODEL_EVIDENCE_FORMAT = 'modiff.private.input-bound-model-smoke.v1';
const WORKFLOW_ID = 'SpandrelImageUpscale:image_upscale';
const PROOF_KIND = 'real_backend_input_bound_model_variant';
const same = (a, b, message) => assert.equal(stableStringify(a), stableStringify(b), message);
const recordKeys = (row, keys, message) => same(Object.keys(row ?? {}).sort(), keys.sort(), message);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

function fileSlots(nodes) {
  return Object.entries(nodes).flatMap(([id, node]) =>
    Object.entries(node.params ?? {})
      .filter(([, parameter]) => parameter.display === 'filebrowser')
      .map(([field]) => ({ id, field })),
  );
}

export function bindSpandrelInput(expected, binding, nodesPayload) {
  assert.match(binding.sourceValue, /^[a-zA-Z0-9_-][\w.-]*\.png$/u);
  assert.ok(binding.sourceValue.length <= 512, 'The input picker filename is too long.');
  const { nodes, paths } = expected;
  const entries = Object.entries(nodes);
  const [upscaleId] =
    entries.find(([, node]) => node.module === 'modules.Spandrel' && node.action === 'Upscaler') ?? [];
  const [previewId] = entries.find(([, node]) => node.module === 'modules.Image' && node.action === 'Preview') ?? [];
  const loadId = binding.nodeId;
  assert.ok(upscaleId && previewId && entries.length === 3, 'Unsupported input-bound Spandrel topology.');
  assert.equal(nodes[loadId]?.module, 'modules.Image');
  assert.equal(nodes[loadId].action, 'Load');
  assert.equal(binding.field, 'file');
  same(fileSlots(nodes), [{ id: loadId, field: 'file' }], 'A single declared image file picker is required.');
  same(nodes[loadId].params.file, { display: 'filebrowser', value: [] }, 'The canonical file input must be empty.');
  same(paths, [[loadId, upscaleId, previewId]], 'Expected one load, upscale and preview path.');
  same(nodes[upscaleId].params.image, { display: 'input', sourceId: loadId, sourceKey: 'image' });
  same(nodes[previewId].params.image, { display: 'input', sourceId: upscaleId, sourceKey: 'output' });
  const contracts = nodesPayload.nodes ?? nodesPayload;
  const registry = Object.fromEntries(
    entries.map(([id, { module, action }]) => {
      const node = contracts[`${module}.${action}`];
      assert.equal(node?.module, module, 'Original backend node contract differs.');
      assert.equal(node?.action, action, 'Original backend node contract differs.');
      return [id, node];
    }),
  );
  same(fileSlots(registry), [{ id: loadId, field: 'file' }], 'Original backend file input contract differs.');
  assert.equal(registry[loadId].params.file.fieldOptions?.multiple, true);
  const api = structuredClone(expected);
  api.nodes[loadId].params.file.value = [binding.sourceValue];
  return { api, loadId, upscaleId, previewId };
}

function compareBoundGraph(submitted, expected, hints) {
  recordKeys(submitted, ['sid', 'nodes', 'paths', ...(hints ? ['runtimeHints'] : [])], 'Unreviewed graph envelope.');
  same(submitted.nodes, expected.nodes, 'Graph differs outside the single canonical image file binding.');
  same(submitted.paths, expected.paths, 'Graph paths differ from the canonical input-bound recipe.');
}

export function validateConsumedSpandrelInput({ bound, binding, output }) {
  const consumed = output.resolvedExecutionInputs;
  assert.equal(consumed.schemaVersion, 1);
  assert.equal(consumed.source, 'backend-execution');
  assert.equal(consumed.taskId, output.taskId, 'Consumed source belongs to another task.');
  assert.equal(consumed.attemptIndex, 0, 'Consumed source belongs to another attempt.');
  assert.equal(consumed.nodeId, bound.previewId, 'Consumed receipt belongs to another output owner.');
  assert.equal(consumed.truncated, false);
  same(consumed.uncapturedNodeIds, []);
  same(consumed.ambiguousFields, []);
  same(consumed.unavailableFields, []);
  same(consumed.fieldAccountingStatus, { schemaVersion: 1, truncated: false });
  same(consumed.nodes.map((node) => node.nodeId).sort(), Object.keys(bound.api.nodes).sort());
  for (const row of consumed.nodes) {
    const submitted = bound.api.nodes[row.nodeId];
    assert.equal(row.module, submitted.module);
    assert.equal(row.action, submitted.action);
    same(row.omittedFields, {});
  }
  const load = consumed.nodes.find((node) => node.nodeId === bound.loadId).fields;
  const upscale = consumed.nodes.find((node) => node.nodeId === bound.upscaleId).fields;
  const preview = consumed.nodes.find((node) => node.nodeId === bound.previewId);
  const literal = (value) => ({ value, source: 'literal' });
  const sourceHash = binding.file.sha256;
  const width = load.source_widths?.value?.[0];
  const height = load.source_heights?.value?.[0];
  assert.ok([width, height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 2048));
  same(
    load,
    {
      alpha_channel: literal(bound.api.nodes[bound.loadId].params.alpha_channel.value),
      source_hashes: literal([sourceHash]),
      source_widths: literal([width]),
      source_heights: literal([height]),
      source_modes: literal(['RGB']),
    },
    'Native Image.Load source byte identity or decoded metadata differs.',
  );
  same(
    upscale,
    {
      device: literal(bound.api.nodes[bound.upscaleId].params.device.value),
      model_id: literal(bound.api.nodes[bound.upscaleId].params.model_id.value.value),
    },
    'Native Spandrel model or device differs.',
  );
  const { device, export: previewExport } = bound.api.nodes[bound.previewId].params;
  same(preview.fields, { device: literal(device.value) });
  same(
    preview.fieldAccounting,
    {
      schemaVersion: 1,
      fields: {
        device: {
          disposition: 'inactive',
          inputValue: device.value,
          value: device.value,
          reason: 'already-decoded-image',
          source: 'literal',
        },
        export: {
          disposition: 'consumed',
          inputValue: previewExport.value,
          value: previewExport.value,
          source: 'literal',
        },
      },
      inputProjections: {},
      outputProjections: {},
      unaccountedFields: [],
      omittedFields: {},
      complete: true,
    },
    'Native terminal preview accounting differs.',
  );
  return { width, height, sourceHash };
}

export function validateSpandrelArtifact({
  bound,
  modelSet,
  modelArtifact,
  graphCompleted,
  submissionHints,
  observation,
}) {
  const model = bound.api.nodes[bound.upscaleId].params.model_id.value;
  same(modelArtifact, model, 'Declared checkpoint metadata differs from canonical graph.');
  const [org, repository, weightName] = model.value.split('/');
  assert.equal(model.source, 'hub');
  assert.equal(weightName, 'RealESRGAN_x2plus.pth');
  assert.equal(model.value, `${org}/${repository}/${weightName}`);
  assert.equal(bound.api.nodes[bound.upscaleId].params.downscale.value, 1);
  same(modelSet, [{ repoId: `${org}/${repository}`, revision: model.revision }]);
  const completionHints = graphCompleted.runtimeHints;
  recordKeys(
    completionHints,
    [...Object.keys(submissionHints), 'controlledArtifacts', 'loaderContract'],
    'Unreviewed native execution authority.',
  );
  const { controlledArtifacts, loaderContract, ...nativeSubmissionHints } = completionHints;
  same(nativeSubmissionHints, submissionHints, 'Completed graph metadata differs from the original submission.');
  same(loaderContract, []);
  const receipt = {
    schemaVersion: 1,
    kind: 'spandrel_upscaler',
    module: 'modules.Spandrel',
    action: 'Upscaler',
    artifact: {
      source: 'hub',
      repository: `${org}/${repository}`,
      revision: model.revision,
      weightName,
      sha256: model.sha256,
    },
  };
  // Backend controlled artifacts use a bare SHA-256 of sorted compact JSON.
  same(
    controlledArtifacts,
    [{ ...receipt, descriptorSha256: sha256(stableStringify(receipt)) }],
    'Native controlled checkpoint or descriptor digest differs.',
  );
  assert.equal(observation.error, false);
  assert.equal(observation.models.length, 1, 'Installed checkpoint observation is ambiguous.');
  const installed = selectInstalledModelIdentity(observation, receipt.artifact.repository);
  assert.equal(installed?.selectedRevision, model.revision);
  assert.equal(installed?.modelRevision, `${receipt.artifact.repository}@${model.revision}`);
  assert.equal(observation.models[0].complete, true);
  assert.equal(observation.models[0].size, model.byteSize);
  assert.equal(observation.runtimeFingerprint, graphCompleted.runtimeFingerprint.fingerprint);
  return { ...controlledArtifacts[0], byteSize: model.byteSize };
}

export function validateSpandrelDecodedMedia({ sourceBytes, outputBytes, sourceDecoded, outputDecoded, input, item }) {
  assert.ok(
    sourceBytes.length >= 33 &&
      sourceBytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
      sourceBytes.toString('ascii', 12, 16) === 'IHDR' &&
      sourceBytes[25] === 2,
    'Original source is not RGB PNG.',
  );
  assert.ok(
    outputBytes.length >= 20 &&
      outputBytes.toString('ascii', 0, 4) === 'RIFF' &&
      outputBytes.toString('ascii', 8, 12) === 'WEBP',
    'Original output is not WebP.',
  );
  same([sourceDecoded.width, sourceDecoded.height], [input.width, input.height], 'Decoded source dimensions differ.');
  same(
    [outputDecoded.width, outputDecoded.height],
    [input.width * 2, input.height * 2],
    'Decoded output is not 2× the original input.',
  );
  same([item.width, item.height], [outputDecoded.width, outputDecoded.height], 'Persisted output dimensions differ.');
  assert.ok(
    outputDecoded.nearBlackRatio <= 0.995 && outputDecoded.lumaStdDev >= 0.75,
    'Original output is visually blank.',
  );
}

export async function readInputBoundModelEvidence({ clientRoot, manifest, graph, authoring, artifact, evidencePath }) {
  assert.equal(manifest.id, WORKFLOW_ID, 'Unsupported file-backed model workflow.');
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact);
  const stat = lstatSync(evidencePath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 65536);
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes);
  recordKeys(
    evidence,
    [
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
      'modelArtifact',
      'outputs',
      ...(evidence.graphRequest === undefined ? [] : ['graphRequest', 'graphAcknowledgment']),
    ],
    'Unexpected input-bound evidence descriptor.',
  );
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.format, INPUT_BOUND_MODEL_EVIDENCE_FORMAT);
  assert.equal(evidence.workflowId, target.workflowId);
  same(evidence.qualificationClaims, { releaseEligible: false, technicalVariant: true });
  assert.equal(evidence.inputs.length, 1);
  assert.equal(evidence.modelObservations.length, 1);
  assert.equal(evidence.outputs.length, 1);
  const [binding] = evidence.inputs;
  const [outputRef] = evidence.outputs;
  recordKeys(binding, [
    'nodeId',
    'field',
    'sourceValue',
    'file',
    ...(binding.before === undefined ? [] : ['before', 'after']),
  ]);
  recordKeys(outputRef, ['backendPath', 'mediaType', 'file']);
  const root = realpathSync(dirname(evidencePath));
  const retainedFiles = [];
  const read = (ref, maximum) => {
    const result = readCanonicalEvidenceFile(root, ref, maximum);
    retainedFiles.push({ ...ref, absolutePath: result.file });
    return result;
  };
  const json = (ref) => JSON.parse(read(ref).bytes);
  const creator = json(evidence.creatorPackage);
  const outputPackage = json(evidence.outputPackage);
  const run = json(evidence.runDetail);
  const graphCompleted = json(evidence.graphCompleted);
  const [expectedApi, creatorApi, outputApi, nativeApi] = await exportCanonicalWorkflowGraphs(clientRoot, [
    graph,
    creator.graph,
    outputPackage.latestOutput.graphSnapshot,
    run.workflow_snapshot,
  ]);
  const bound = bindSpandrelInput(expectedApi, binding, json(evidence.nodes));
  for (const api of [creatorApi, outputApi, nativeApi]) compareBoundGraph(api, bound.api, false);
  compareBoundGraph(creator.apiGraph, bound.api, false);
  compareBoundGraph(outputPackage.latestOutput.apiGraphSnapshot, bound.api, true);
  const { task, output, hints } = validateNativeVariantRun({
    target,
    outputNodeId: bound.previewId,
    displayType: 'image',
    creator,
    outputPackage,
    run,
    graphCompleted,
    ...(evidence.graphRequest !== undefined
      ? {
          graphRequest: json(evidence.graphRequest),
          graphAcknowledgment: json(evidence.graphAcknowledgment),
        }
      : {}),
  });
  const source = backendSourceEvidence({
    before: json(evidence.backendSourceBefore).identity,
    after: json(evidence.backendSourceAfter).identity,
    runtimeFingerprint: task.runtimeFingerprint,
  });
  same(source.blockers, [], 'Backend source differs from the running process.');
  const runtime = selectBackendRuntimeFingerprintEvidence([task.runtimeFingerprint]);
  assert.ok(runtime, 'Native runtime fingerprint is incomplete.');
  assert.match(task.runtimeFingerprint.packages.platform, /^Windows-/u);
  const measurement = task.runtimeMeasurement;
  assert.equal(measurement.backend, 'cuda');
  assert.equal(measurement.device, bound.api.nodes[bound.upscaleId].params.device.value);
  assert.ok(task.runtimeFingerprint.torch.cuda_available);
  assert.equal(measurement.peakMeasurementVersion, 2);
  assert.ok(Number.isFinite(measurement.elapsedSeconds) && measurement.elapsedSeconds > 0);
  assert.ok(Number.isSafeInteger(measurement.peakAllocatedBytes) && measurement.peakAllocatedBytes > 0);
  const modelArtifact = validateSpandrelArtifact({
    bound,
    modelSet: target.modelSet,
    modelArtifact: evidence.modelArtifact,
    graphCompleted,
    submissionHints: hints,
    observation: json(evidence.modelObservations[0]),
  });
  const input = validateConsumedSpandrelInput({ bound, binding, output });
  const physicalInput = read(binding.file, MAX_MEDIA_BYTES);
  if (binding.before !== undefined)
    for (const ref of [binding.before, binding.after])
      assert.ok(
        read(ref, MAX_MEDIA_BYTES).bytes.equals(physicalInput.bytes),
        'Server input observations differ from archived source bytes.',
      );
  const physicalOutput = read(outputRef.file, MAX_MEDIA_BYTES);
  const item = validateNativeVariantOutput({
    output,
    outputRef,
    task,
    bytes: physicalOutput.bytes,
    displayType: 'image',
    contentType: 'image/webp',
  });
  const nativeUrl = new URL(item.value, 'http://127.0.0.1');
  assert.equal(nativeUrl.origin, 'http://127.0.0.1');
  assert.equal(nativeUrl.pathname, `/cache/${bound.previewId}/output/0`);
  assert.equal(nativeUrl.searchParams.get('format'), 'WEBP');
  assert.equal(nativeUrl.searchParams.get('quality'), '100');
  // Decode the retained media independently of native width/height claims.
  const { decodedMediaHash } = await import('./template-gallery-harness.mjs');
  const sourceDecoded = await decodedMediaHash(physicalInput.file, 'image');
  const outputDecoded = await decodedMediaHash(physicalOutput.file, 'image');
  validateSpandrelDecodedMedia({
    sourceBytes: physicalInput.bytes,
    outputBytes: physicalOutput.bytes,
    sourceDecoded,
    outputDecoded,
    input,
    item,
  });
  for (const ref of retainedFiles) readCanonicalEvidenceFile(root, ref);
  assert.ok(readFileSync(evidencePath).equals(descriptorBytes), 'Evidence descriptor changed during validation.');
  const receipt = {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-run-receipt.v1',
    proofKind: PROOF_KIND,
    workflowId: target.workflowId,
    sourceTemplateId: target.sourceTemplateId,
    authoringId: target.authoringId,
    authoringHash: target.authoringHash,
    canonicalWorkflowHash: target.canonicalWorkflowHash,
    modelType: target.modelType,
    task: target.task,
    taskId: task.task_id,
    capturedAt: new Date(task.completed_at * 1000).toISOString(),
    graphHash: canonicalGraphIdentity(output.apiGraphSnapshot).hash,
    modelSet: target.modelSet,
    resourceCandidateId: null,
    runtimeFingerprint: normalizeBackendRuntime(runtime).lockFingerprint,
    backendSourceFingerprint: source.identity.fingerprint,
    outputHash: item.mediaHash,
    executionDurationSeconds: measurement.elapsedSeconds,
    peakMemoryBytes: measurement.peakAllocatedBytes,
    canonicalDefaultsExecuted: false,
    inputBinding: {
      nodeId: binding.nodeId,
      field: binding.field,
      serverReadsCompared: binding.before !== undefined,
      sha256: input.sourceHash,
      width: input.width,
      height: input.height,
    },
    modelArtifact,
    decodedOutput: { hash: outputDecoded.hash, width: outputDecoded.width, height: outputDecoded.height },
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
    provenance: { format: 'modiff.input-bound-model-variant-proof.v1', receipt },
    evidence,
    descriptorBytes,
    retainedFiles,
    evidenceRoot: root,
  };
}
