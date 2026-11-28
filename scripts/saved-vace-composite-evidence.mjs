import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJsonHash } from './canonical-json.mjs';
import { backendContractIdentity, canonicalGraphIdentity, normalizeBackendRuntime } from './live-proof-provenance.mjs';
import { validateNativeVariantOutput } from './native-variant-run-evidence.mjs';
import { canonicalWorkflowAuthoringContract, readCanonicalEvidenceFile } from './release-contract-core.mjs';
import { decodedMediaHash, technicalMediaErrors } from './template-gallery-harness.mjs';

const savedGraphHash = 'sha256:canonical-graph-v1:5b7ac5d2442e6c92e28ee9bff7e02847c3de46dc2570e5d7eb779583f186fc0c';
const savedSourceFingerprint =
  'sha256:backend-source-v1:438519cbac050bb30e69d86506f4510f260d790899896038d9707a5edd488e95';
const savedOutputHash = 'sha256:bytes:a90aff3b61c664b51073574cc6c12efa894f45b88226637b254c9d81a53aad87';
const replayedRegistryHash = '9f1427b04388e4139fe0123f77bb4b01a312bff4554ea60c2495511ef6f00512';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function verifySavedVaceTaskIdentity(queue, task, output) {
  assert.equal(queue.status, 'running');
  assert.equal(task.status, 'completed');
  assert.ok(queue.started_at <= queue.updated_at && queue.updated_at < task.completed_at);
  for (const field of [
    'task_id',
    'sid',
    'attempt_index',
    'client_run_id',
    'run_input_hash',
    'workflow_tab_id',
    'workflow_canvas_epoch',
  ]) {
    assert.notEqual(queue[field], undefined, field);
    assert.equal(queue[field], task[field], field);
  }
  assert.equal(output.taskId, task.task_id);
  assert.equal(output.runInputHash, task.run_input_hash);
  assert.equal(output.clientRunId, task.client_run_id);
  assert.equal(output.attemptIndex, task.attempt_index);
}

// The archived server records both ends of this specific task. They preserve
// the prepared graph and inputs. The original dispatch and event are absent.
export async function readSavedVaceCompositeEvidence({ manifest, graph, authoring, artifact, evidencePath }) {
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact);
  assert.equal(target.workflowId, 'WanVACEPipeline:video_inpaint');
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes);
  assert.equal(evidence.workflowId, target.workflowId);
  const root = dirname(realpathSync(evidencePath));
  const retainedFiles = [];
  const read = (ref, limit) => {
    const result = readCanonicalEvidenceFile(root, ref, limit);
    retainedFiles.push(ref);
    return result;
  };
  const json = (ref) => JSON.parse(read(ref).bytes);
  const run = json(evidence.run);
  const [output] = run.outputs;
  assert.equal(run.outputs.length, 1);
  const { task } = run;
  verifySavedVaceTaskIdentity(json(evidence.queue).current, task, output);
  assert.equal(output.modelType, target.modelType);
  assert.equal(output.mode, target.task);
  const source = task.runtimeFingerprint.backendSource;
  assert.deepEqual(json(evidence.health).backend_source, source);
  assert.equal(source.fingerprint, savedSourceFingerprint);
  const sourceManifest = json(evidence.sourceManifest);
  const sourceFiles = Object.entries(sourceManifest.files)
    .filter(
      ([path]) =>
        /^(main\.py|pyproject\.toml)$/u.test(path) ||
        (/^(modiff|modules|utils)\/.+\.(py|toml|ini)$/iu.test(path) &&
          path.split('/').every((part) => !part.startsWith('.') && part !== '__pycache__')),
    )
    .map(([path, { sha256 }]) => ({ path, sha256 }))
    .sort((left, right) => (left.path < right.path ? -1 : 1));
  assert.equal(sourceFiles.length, source.fileCount);
  assert.equal(
    'sha256:backend-source-v1:' + canonicalJsonHash({ files: sourceFiles, gitCommit: source.gitCommit }),
    savedSourceFingerprint,
  );

  const registry = read(evidence.nodes);
  const replay = json(evidence.registryReplay);
  assert.equal(replay.nodeHash, replayedRegistryHash);
  assert.equal(sha256(registry.bytes), replayedRegistryHash);
  assert.equal(replay.nodeBytes, registry.bytes.length);
  assert.equal(replay.sourceFingerprint, savedSourceFingerprint);
  assert.equal(replay.fileCount, source.fileCount);
  assert.equal(replay.modelRuns, 0);
  assert.equal(replay.python, task.runtimeFingerprint.packages.python);
  assert.match(replay.accelerator, /MI300X/u);
  for (const name of ['diffusers', 'transformers', 'peft', 'accelerate', 'safetensors', 'torch']) {
    assert.equal(replay.versions[name], task.runtimeFingerprint.packages[name], name);
  }
  const api = output.apiGraphSnapshot;
  const identity = canonicalGraphIdentity(api);
  assert.equal(identity.hash, savedGraphHash);
  const nodes = JSON.parse(registry.bytes);
  assert.ok(identity.canonicalGraph.nodes.every(({ module, action }) => nodes.nodes[`${module}.${action}`]));
  const backendContract = backendContractIdentity(nodes, identity.canonicalGraph);
  const entry = (module, action) => {
    const found = Object.entries(api.nodes).filter(([, node]) => node.module === module && node.action === action);
    assert.equal(found.length, 1);
    return found[0];
  };
  const [loaderId, loader] = entry('modules.DiffusersVideo', 'LoadPipeline');
  const [upscalerId, upscaler] = entry('modules.Spandrel', 'Upscaler');
  assert.deepEqual(
    [loader, upscaler].map(({ params }) => ({
      repoId: params.model_id.value.value,
      revision: params.revision?.value ?? params.model_id.value.revision,
    })),
    target.modelSet,
  );
  const [encoderId, encoder] = entry('modules.DiffusersVideo', 'EncodeInputs');
  const sourceId = api.nodes[encoder.params.video.sourceId].params.video.sourceId;
  const maskId = api.nodes[encoder.params.mask.sourceId].params.mask.sourceId;
  const referenceId = encoder.params.reference_images.sourceId;
  assert.equal(new Set([sourceId, maskId, referenceId]).size, 3);
  const [compositeId, composite] = entry('modules.Video', 'MaskedComposite');
  assert.equal(composite.params.source.sourceId, sourceId);
  assert.equal(composite.params.generated.sourceId, upscalerId);
  assert.equal(composite.params.mask.sourceId, encoder.params.mask.sourceId);
  const [exportId, exporter] = entry('modules.Video', 'Export');
  assert.equal(exporter.params.video.sourceId, compositeId);
  assert.equal(output.nodeId, exportId);

  const resolved = output.resolvedExecutionInputs;
  assert.equal(resolved.taskId, task.task_id);
  assert.equal(resolved.attemptIndex, task.attempt_index);
  assert.equal(resolved.truncated, false);
  const fields = (id) => resolved.nodes.find(({ nodeId }) => nodeId === id).fields;
  assert.equal(fields(loaderId).revision.value, target.modelSet[0].revision);
  assert.equal(fields(loaderId).model_id.value, target.modelSet[0].repoId);
  assert.equal(fields(upscalerId).model_id.value, target.modelSet[1].repoId);
  assert.equal(fields(encoderId).prompt.value, encoder.params.prompt.value);
  assert.equal(fields(encoderId).executed_task.value, target.task);
  assert.equal(fields(exportId).fps.value, 16);
  const sourceFile = read(evidence.sourceVideo, 128 * 1024 * 1024);
  read(evidence.maskVideo);
  read(evidence.referenceImage);
  const inputLedger = json(evidence.inputLedger).inputs;
  const proof = json(evidence.mediaReplay);
  for (const [index, ref] of [evidence.sourceVideo, evidence.maskVideo, evidence.referenceImage].entries()) {
    assert.equal(inputLedger[index].sha256, ref.sha256);
    assert.equal(inputLedger[index].bytes, ref.bytes);
  }
  assert.deepEqual(fields(referenceId).source_hashes.value, [evidence.referenceImage.sha256]);
  assert.equal(proof.sourceFileSha256, evidence.sourceVideo.sha256);
  assert.equal(proof.maskFileSha256, evidence.maskVideo.sha256);
  assert.equal(proof.referenceFileSha256, evidence.referenceImage.sha256);
  assert.equal(proof.normalizedSourcePixelSha256, fields(encoderId).video_source_sha256.value);
  assert.equal(proof.normalizedSourceFrames, fields(encoderId).video_source_frames.value);
  assert.equal(proof.originalNormalizedInputVerified, true);

  const rendered = read(evidence.output, 64 * 1024 * 1024);
  assert.equal(output.mediaHash, savedOutputHash);
  assert.equal(proof.outputFileSha256, savedOutputHash);
  assert.equal('sha256:bytes:' + evidence.output.sha256, savedOutputHash);
  validateNativeVariantOutput({
    task,
    output,
    bytes: rendered.bytes,
    displayType: 'video',
    contentType: 'video/mp4',
    outputRef: { file: evidence.output, mediaType: 'video', backendPath: output.backendMediaPath },
  });
  const decoded = await decodedMediaHash(rendered.file, 'video');
  const geometry = { width: 1664, height: 960, frames: 161, durationSeconds: 161 / 16 };
  assert.deepEqual(technicalMediaErrors(decoded, geometry, 'video'), []);
  assert.equal(decoded.hasAudio, false);
  assert.equal(decoded.fps, 16);
  const measurement = task.runtimeMeasurement;
  assert.equal(measurement.backend, 'rocm');
  assert.equal(measurement.peakMeasurementVersion, 2);
  assert.ok(measurement.elapsedSeconds > 0 && measurement.peakAllocatedBytes > 0);

  const receipt = {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-run-receipt.v1',
    proofKind: 'real_backend_input_bound_model_variant',
    ...target,
    taskId: task.task_id,
    outputId: output.id,
    capturedAt: new Date(task.completed_at * 1000).toISOString(),
    graphHash: identity.hash,
    resourceCandidateId: null,
    runtimeFingerprint: normalizeBackendRuntime(task.runtimeFingerprint).lockFingerprint,
    backendSourceFingerprint: source.fingerprint,
    backendContractFingerprint: backendContract.fingerprint,
    outputHash: output.mediaHash,
    executionDurationSeconds: measurement.elapsedSeconds,
    peakMemoryBytes: measurement.peakAllocatedBytes,
    canonicalDefaultsExecuted: false,
    inputBinding: {
      nodeId: sourceId,
      field: 'file',
      sha256: evidence.sourceVideo.sha256,
      byteSize: sourceFile.bytes.length,
      normalizedVideoSha256: proof.normalizedSourcePixelSha256,
    },
    maskBinding: { nodeId: maskId, field: 'file', sha256: evidence.maskVideo.sha256 },
    referenceBindings: [{ nodeId: referenceId, field: 'file', inputIndex: 0, sha256: evidence.referenceImage.sha256 }],
    promptBinding: { nodeId: encoderId, field: 'prompt', sha256: sha256(encoder.params.prompt.value) },
    decodedOutput: { kind: 'video', ...geometry, fps: decoded.fps, hash: decoded.hash },
    observationLimits: {
      originalRunningQueueMatched: true,
      originalCompletionRecordMatched: true,
      independentDispatchAcknowledgment: false,
      independentCompletionEvent: false,
      fullConsumedFieldAccounting: false,
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
  return { descriptorBytes, retainedFiles, evidence, evidenceRoot: root, receipt };
}
