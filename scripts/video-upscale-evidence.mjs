import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateSpandrelArtifact } from './input-bound-model-evidence.mjs';
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
  stableStringify,
} from './live-proof-provenance.mjs';

const same = (actual, expected, label) => assert.equal(stableStringify(actual), stableStringify(expected), label);
const keys = (value, allowed) =>
  same(Object.keys(value).sort(), [...allowed].sort(), 'Unexpected upscale evidence fields.');
const fileIdentity = ({ sha256, bytes }) => ({ kind: 'file', sha256, byteSize: bytes });

export function verifyVideoUpscaleFileChain({ resolved, taskId, upscaleId, exportId, upscale, exporter, files }) {
  assert.equal(resolved.schemaVersion, 1);
  assert.equal(resolved.source, 'backend-execution');
  assert.equal(resolved.taskId, taskId);
  assert.equal(resolved.attemptIndex, 0);
  assert.equal(resolved.nodeId, exportId);
  assert.equal(resolved.truncated, false);
  same(resolved.mediaEvidenceStatus, { schemaVersion: 1, truncated: false });
  for (const list of ['ambiguousFields', 'unavailableFields', 'uncapturedNodeIds']) same(resolved[list], []);
  const byId = new Map(resolved.nodes.map((node) => [node.nodeId, node]));
  assert.equal(resolved.nodes.length, 2);
  same([...byId.keys()].sort(), [upscaleId, exportId].sort());
  const check = (id, action, expected) => {
    const node = byId.get(id);
    assert.equal(node.action, action);
    assert.equal(node.module, 'modules.Video');
    same(node.omittedFields, {});
    same(
      node.mediaEvidence,
      { schemaVersion: 1, status: 'complete', source: 'native-builtin-media-v1', ...expected },
      `The native ${action} bytes or controls differ.`,
    );
  };
  const input = fileIdentity(files.source);
  const intermediate = fileIdentity(files.intermediate);
  const controlValues = (params, names) => Object.fromEntries(names.map((name) => [name, params[name].value]));
  check(upscaleId, 'UpscaleVideo', {
    controls: controlValues(upscale, ['pipeline_class', 'operation', 'tile_size', 'tile_overlap', 'device', 'fps']),
    inputs: { video: [input] },
    outputs: { video_out: [intermediate] },
    files: { video: [{ sourceValue: upscale.video.value[0], sha256: input.sha256, byteSize: input.byteSize }] },
  });
  check(exportId, 'Export', {
    controls: controlValues(exporter, ['filename', 'quality', 'fps']),
    inputs: { video: [intermediate] },
    outputs: { file: [fileIdentity(files.output)] },
    files: {},
  });
}

export async function readVideoUpscaleEvidence({ clientRoot, manifest, graph, authoring, artifact, evidencePath }) {
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact);
  assert.equal(target.workflowId, 'SpandrelVideoUpscale:video_upscale');
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes);
  keys(evidence, [
    'schemaVersion',
    'format',
    'workflowId',
    'creator',
    'outputPackage',
    'run',
    'persisted',
    'request',
    'acknowledgment',
    'completion',
    'backendSource',
    'modelObservation',
    'upload',
    'source',
    'intermediate',
    'output',
  ]);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.workflowId, target.workflowId);
  assert.equal(evidence.format, 'modiff.private.video-upscale-native-files.v1');
  const root = realpathSync(dirname(evidencePath));
  const retainedFiles = [];
  const read = (ref) => {
    const retained = readCanonicalEvidenceFile(root, ref, 16 * 1024 * 1024);
    retainedFiles.push({ ...ref, absolutePath: retained.file });
    return retained;
  };
  const json = (ref) => JSON.parse(read(ref).bytes);
  const creator = json(evidence.creator);
  const outputPackage = json(evidence.outputPackage);
  const run = json(evidence.run);
  const persisted = json(evidence.persisted);
  const request = json(evidence.request);
  const graphCompleted = json(evidence.completion);
  const upload = json(evidence.upload);
  const sourceValue = upload.path;
  assert.match(sourceValue, /^@data\/videos\/[a-zA-Z0-9_-][\w.-]{0,200}\.mp4$/u);
  assert.equal(upload.error, false);
  assert.equal(upload.media.kind, 'video');
  assert.equal(upload.media.mimeType, 'video/mp4');
  assert.equal(upload.media.sha256, evidence.source.sha256);
  assert.equal(upload.media.sizeBytes, evidence.source.bytes);

  const [canonical, ...visualGraphs] = await exportCanonicalWorkflowGraphs(clientRoot, [
    graph,
    creator.graph,
    outputPackage.latestOutput.graphSnapshot,
    run.workflow_snapshot,
  ]);
  const find = (api, action) => {
    const nodes = Object.entries(api.nodes).filter(
      ([, node]) => node.module === 'modules.Video' && node.action === action,
    );
    assert.equal(nodes.length, 1, `Expected one ${action} owner.`);
    return nodes[0];
  };
  const [baseId, base] = find(canonical, 'UpscaleVideo');
  assert.equal(Object.keys(canonical.nodes).length, 2);
  same(base.params.video, { display: 'filebrowser', value: '' });
  const [upscaleId, { params: upscale }] = find(request, 'UpscaleVideo');
  const [exportId, { params: exporter }] = find(request, 'Export');
  same(exporter.video, { display: 'input', sourceId: upscaleId, sourceKey: 'video_out' });
  same(request.paths, [[upscaleId, exportId]]);
  const boundApi = structuredClone(canonical);
  boundApi.nodes[baseId].params.video.value = [sourceValue];
  const boundHash = canonicalGraphIdentity(boundApi).hash;
  for (const api of [request, creator.apiGraph, ...visualGraphs])
    assert.equal(
      canonicalGraphIdentity(api).hash,
      boundHash,
      'A saved upscale recipe differs from the captured graph.',
    );

  assert.equal(run.outputs.length, 2);
  assert.equal(persisted.outputs.length, 2);
  const [final, intermediate] = [exportId, upscaleId].map((id) => {
    const rows = run.outputs.filter((row) => row.nodeId === id);
    assert.equal(rows.length, 1);
    const stored = persisted.outputs.find((row) => row.id === rows[0].id);
    same(rows[0], stored, 'Original task output differs from the saved native record.');
    return stored;
  });
  // Older clients omitted this section from the package. The original run and
  // output store must independently hold identical native witnesses.
  const packaged = outputPackage.latestOutput;
  if (packaged.resolvedExecutionInputs !== undefined)
    same(packaged.resolvedExecutionInputs, final.resolvedExecutionInputs);
  const packageWithNativeInputs = {
    ...outputPackage,
    latestOutput: { ...packaged, resolvedExecutionInputs: final.resolvedExecutionInputs },
  };
  const { task, output, hints } = validateNativeVariantRun({
    target,
    outputNodeId: exportId,
    displayType: 'video',
    creator,
    outputPackage: packageWithNativeInputs,
    run: { ...run, outputs: [final] },
    graphCompleted,
    graphRequest: request,
    graphAcknowledgment: json(evidence.acknowledgment),
  });
  const source = json(evidence.backendSource);
  const sourceProof = backendSourceEvidence({ ...source, runtimeFingerprint: task.runtimeFingerprint });
  same(sourceProof.blockers, []);
  const runtime = selectBackendRuntimeFingerprintEvidence([task.runtimeFingerprint]);
  assert.ok(runtime);
  const measurement = task.runtimeMeasurement;
  assert.equal(measurement.backend, 'cuda');
  assert.equal(measurement.device, upscale.device.value);
  assert.equal(measurement.peakMeasurementVersion, 2);
  assert.ok(measurement.elapsedSeconds > 0 && measurement.peakAllocatedBytes > 0);
  const modelArtifact = validateSpandrelArtifact({
    bound: { api: request, upscaleId },
    modelSet: target.modelSet,
    modelArtifact: upscale.model_id.value,
    graphCompleted,
    submissionHints: hints,
    observation: json(evidence.modelObservation),
  });
  verifyVideoUpscaleFileChain({
    resolved: output.resolvedExecutionInputs,
    taskId: task.task_id,
    upscaleId,
    exportId,
    upscale,
    exporter,
    files: { source: evidence.source, intermediate: evidence.intermediate, output: evidence.output },
  });
  const validateMedia = (record, file, physical) =>
    validateNativeVariantOutput({
      output: record,
      task,
      bytes: physical.bytes,
      displayType: 'video',
      contentType: 'video/mp4',
      outputRef: { backendPath: record.backendMediaPath, mediaType: 'video', file },
    });
  const outputVideo = read(evidence.output);
  const item = validateMedia(output, evidence.output, outputVideo);
  validateMedia(intermediate, evidence.intermediate, read(evidence.intermediate));
  const { decodedMediaHash } = await import('./template-gallery-harness.mjs');
  const before = await decodedMediaHash(read(evidence.source).file, 'video');
  const after = await decodedMediaHash(outputVideo.file, 'video');
  same([before.width, before.height], [upload.media.width, upload.media.height]);
  same([after.width, after.height], [before.width * 2, before.height * 2]);
  same(
    [after.width, after.height, after.frames],
    [item.mediaMetadata.width, item.mediaMetadata.height, item.mediaMetadata.frame_count],
  );
  assert.equal(after.frames, before.frames);
  assert.equal(after.fps, before.fps);
  assert.equal(after.fps, upscale.fps.value);
  assert.equal(after.durationSeconds, before.durationSeconds);
  assert.equal(after.hasAudio, before.hasAudio);
  assert.ok(after.lumaStdDev >= 0.75 && after.severeNearBlackFrameRatio < 0.5);
  assert.notEqual(after.hash, before.hash);
  for (const ref of retainedFiles) readCanonicalEvidenceFile(root, ref, 16 * 1024 * 1024);
  assert.ok(readFileSync(evidencePath).equals(descriptorBytes));
  return {
    descriptorBytes,
    retainedFiles,
    receipt: {
      schemaVersion: 1,
      format: 'modiff.canonical-workflow-run-receipt.v1',
      proofKind: 'real_backend_input_bound_model_variant',
      workflowId: target.workflowId,
      sourceTemplateId: target.sourceTemplateId,
      authoringId: target.authoringId,
      authoringHash: target.authoringHash,
      canonicalWorkflowHash: target.canonicalWorkflowHash,
      modelType: target.modelType,
      task: target.task,
      taskId: task.task_id,
      capturedAt: new Date(task.completed_at * 1000).toISOString(),
      graphHash: boundHash,
      modelSet: target.modelSet,
      resourceCandidateId: null,
      runtimeFingerprint: normalizeBackendRuntime(runtime).lockFingerprint,
      backendSourceFingerprint: sourceProof.identity.fingerprint,
      outputHash: item.mediaHash,
      executionDurationSeconds: measurement.elapsedSeconds,
      peakMemoryBytes: measurement.peakAllocatedBytes,
      canonicalDefaultsExecuted: false,
      inputBinding: {
        nodeId: upscaleId,
        field: 'video',
        sha256: evidence.source.sha256,
        width: before.width,
        height: before.height,
      },
      modelArtifact,
      decodedOutput: {
        hash: after.hash,
        width: after.width,
        height: after.height,
        fps: after.fps,
        frameCount: after.frames,
      },
      observationLimits: { fullConsumedFieldAccounting: false, physicalPlatformQualification: false },
      qualificationClaims: {
        publicTemplate: false,
        qualityApproved: false,
        rightsApproved: false,
        hardwareQualified: false,
        modelResourceQualified: false,
      },
    },
  };
}
