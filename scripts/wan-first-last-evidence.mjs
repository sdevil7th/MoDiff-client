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
} from './live-proof-provenance.mjs';
import {
  validateNativeVariantOutput,
  validateNativeVariantRun,
  validateUnmodifiedExpertPreparation,
} from './native-variant-run-evidence.mjs';
import { verifyRetainedPngUpload } from './private-image-edit-evidence.mjs';
import { validateNativeVideoDelivery } from './prompt-variant-evidence.mjs';
import {
  canonicalWorkflowAuthoringContract,
  exportCanonicalWorkflowGraphs,
  readCanonicalEvidenceFile,
} from './release-contract-core.mjs';
import { decodedMediaHash } from './template-gallery-harness.mjs';

const modelType = 'WanImage2VideoModularPipeline';
const workflowId = `${modelType}:image_to_video`;
const repoId = 'Wan-AI/Wan2.1-FLF2V-14B-720P-diffusers';
const revision = '17c30769b1e0b5dcaa1799b117bf20a9c31f59d7';
const correctedSource = 'sha256:backend-source-v1:b29a5b0d317aaa781ae2a5205b46b518eea5a3d68a214eb0968dba4ac0660af7';
const format = 'modiff.private.wan-first-last-frame-variant.v1';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const literal = (value) => ({ value, source: 'literal' });
const loaderDefaults = {
  weight_loading_mode: 'cpu',
  attention_backend: 'inherit',
  vae_slicing: null,
  vae_tiling: null,
};
const stages = [
  ['first', 'Image.Load'],
  ['last', 'Image.Load'],
  [
    'loader',
    'ModularDiffusers.ModelsLoader',
    'model_type repo_id revision dtype device auto_offload offload_mode quant_config weight_loading_mode attention_backend vae_slicing vae_tiling',
  ],
  ['embed', 'ModularDiffusers.ImageEmbeddings', 'height width'],
  ['encode', 'ModularDiffusers.ImageEncode', 'height num_frames seed width'],
  ['prompt', 'ModularDiffusers.EncodePrompt', 'prompt negative_prompt'],
  ['denoise', 'ModularDiffusers.Denoise', 'guidance_scale height num_frames num_inference_steps seed width'],
  ['decode', 'ModularDiffusers.DecodeLatents', 'output_type'],
  ['export', 'Video.Export', 'fps'],
];
function owners(api) {
  assert.equal(api.paths.length, 1);
  const [path] = api.paths;
  assert.deepEqual([...path].sort(), Object.keys(api.nodes).sort());
  assert.equal(path.length, stages.length);
  return Object.fromEntries(
    stages.map(([role, action, fields], index) => {
      const id = path[index];
      const node = api.nodes[id];
      assert.equal(`${node.module}.${node.action}`, `modules.${action}`);
      return [role, { id, node, fields }];
    }),
  );
}

export function verifyFirstLastFields(output, api, inputs) {
  const actual = owners(api);
  const receipt = output.resolvedExecutionInputs;
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.source, 'backend-execution');
  assert.equal(receipt.taskId, output.taskId);
  assert.equal(receipt.nodeId, actual.export.id);
  assert.equal(receipt.attemptIndex, 0);
  assert.equal(receipt.truncated, false);
  assert.deepEqual(receipt.uncapturedNodeIds, []);
  assert.deepEqual(receipt.unavailableFields, []);
  assert.deepEqual(receipt.ambiguousFields, ['imageSourceHashes']);
  assert.deepEqual(receipt.nodes.map(({ nodeId }) => nodeId).sort(), [...api.paths[0]].sort());
  for (const [role, { id, node, fields }] of Object.entries(actual)) {
    const observed = receipt.nodes.find(({ nodeId }) => id === nodeId);
    assert.equal(observed.module, node.module);
    assert.equal(observed.action, node.action);
    assert.deepEqual(observed.omittedFields, {});
    if (fields) {
      const settings = Object.fromEntries(
        fields.split(' ').map((key) => {
          const field =
            node.params[key] ??
            (role === 'loader' && Object.hasOwn(loaderDefaults, key) ? { value: loaderDefaults[key] } : undefined);
          assert.ok(field, `No literal for ${role}.${key}.`);
          assert.equal(field.sourceId, undefined);
          if (role === 'loader' && key === 'quant_config') {
            assert.deepEqual(field, { display: 'input' });
            return [key, literal(null)];
          }
          return [key, literal(key === 'repo_id' ? field.value.value : field.value)];
        }),
      );
      assert.deepEqual(observed.fields, settings, `Observed ${role} controls differ.`);
      continue;
    }
    const input = inputs[role];
    assert.deepEqual(node.params.file, { display: 'filebrowser', value: [input.sourceValue] });
    assert.deepEqual(
      observed.fields,
      {
        alpha_channel: literal('ignore'),
        source_hashes: literal([input.file.sha256]),
        source_widths: literal([input.geometry.width]),
        source_heights: literal([input.geometry.height]),
        source_modes: literal(['RGB']),
      },
      `Observed ${role} frame differs.`,
    );
    for (const processor of [actual.embed, actual.encode]) {
      assert.deepEqual(processor.node.params[role === 'first' ? 'image' : 'last_image'], {
        display: 'input',
        sourceId: id,
        sourceKey: 'image',
      });
    }
  }
}

export async function readWanFirstLastEvidence({ clientRoot, manifest, graph, authoring, artifact, evidencePath }) {
  assert.equal(manifest.id, workflowId);
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact);
  assert.deepEqual(target.modelSet, [{ repoId, revision }]);
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes);
  assert.equal(evidence.format, format);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.workflowId, workflowId);
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
  const completion = json(evidence.graphCompleted);
  const [expected, ...visual] = await exportCanonicalWorkflowGraphs(clientRoot, [
    graph,
    creator.graph,
    outputPackage.latestOutput.graphSnapshot,
    run.workflow_snapshot,
  ]);
  assert.equal(canonicalGraphIdentity(expected).hash, evidence.originalGraphHash);
  const canonical = owners(expected);
  const actual = owners(graphRequest);
  const [first, last] = evidence.inputs;
  assert.equal(evidence.inputs.length, 2);
  assert.notEqual(first.file.sha256, last.file.sha256);
  const inputs = { first, last };
  for (const [role, input] of Object.entries(inputs)) {
    assert.match(input.sourceValue, /^@data\/images\/[\w-]{1,128}\.png$/u);
    const field = canonical[role].node.params.file;
    assert.deepEqual(field, { display: 'filebrowser', value: role === 'first' ? [] : '' });
    field.value = [input.sourceValue];
  }
  const prompts = {};
  for (const field of ['prompt', 'negative_prompt']) {
    const value = actual.prompt.node.params[field].value;
    assert.ok(typeof value === 'string' && value.length > 0 && value.length <= 4096 && value === value.trim());
    assert.ok(!/[\u0000-\u001f\u007f]/u.test(value));
    assert.deepEqual(canonical.prompt.node.params[field], { value: '', display: 'textarea' });
    canonical.prompt.node.params[field].value = value;
    prompts[field] = digest(value);
  }
  assert.deepEqual(canonical.denoise.node.params.guidance_scale, { display: 'slider', value: 3 });
  canonical.denoise.node.params.guidance_scale.value = 5.5;
  const identity = canonicalGraphIdentity(expected);
  for (const value of [graphRequest, creator.apiGraph, ...visual]) {
    assert.equal(
      canonicalGraphIdentity(value).hash,
      identity.hash,
      'The supplied frame recipe differs from the reviewed variant.',
    );
  }
  const { task, output, hints } = validateNativeVariantRun({
    // This archived form used the older task label. The graph and authoring
    // contract above verify the canonical two-frame operation independently.
    target: { ...target, task: 'single_image_to_video' },
    outputNodeId: actual.export.id,
    displayType: 'video',
    creator,
    outputPackage,
    run,
    graphCompleted: completion,
    graphRequest,
    graphAcknowledgment: json(evidence.graphAcknowledgment),
    validatePreparation: (value) => validateUnmodifiedExpertPreparation(value, modelType),
  });
  assert.deepEqual(hints.workflowSnapshot.studioForm, output.formSnapshot);
  assert.deepEqual(completion.runtimeHints, {
    ...hints,
    loaderContract: ['modules.ModularDiffusers.ModelsLoader'],
    controlledArtifacts: [],
  });
  const geometry = { width: actual.denoise.node.params.width.value, height: actual.denoise.node.params.height.value };
  for (const input of Object.values(inputs)) {
    const { bytes, file } = read(input.file);
    const decoded = await decodedMediaHash(file, 'image');
    assert.deepEqual({ width: decoded.width, height: decoded.height }, geometry);
    verifyRetainedPngUpload(json(input.upload), input, geometry, bytes);
    input.geometry = geometry;
  }
  verifyFirstLastFields(output, graphRequest, inputs);
  const backend = backendSourceEvidence({
    before: json(evidence.backendSourceBefore).identity,
    after: json(evidence.backendSourceAfter).identity,
    runtimeFingerprint: task.runtimeFingerprint,
  });
  assert.deepEqual(backend.blockers, []);
  assert.equal(backend.identity.fingerprint, correctedSource);
  const backendContract = backendContractIdentity(json(evidence.nodes), identity.canonicalGraph);
  assert.ok(backendContract.fingerprint);
  const runtime = selectBackendRuntimeFingerprintEvidence([task.runtimeFingerprint]);
  assert.equal(evidence.modelObservations.length, 1);
  const observation = json(evidence.modelObservations[0]);
  assert.equal(observation.error, false);
  assert.equal(observation.runtimeFingerprint, runtime.fingerprint);
  assert.equal(observation.models.length, 1);
  assert.equal(observation.models[0].complete, true);
  assert.equal(observation.models[0].repairRequired, false);
  assert.equal(selectInstalledModelIdentity(observation, repoId)?.selectedRevision, revision);
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
    displayType: 'video',
    contentType: 'video/mp4',
  });
  const decodedOutput = validateNativeVideoDelivery(await decodedMediaHash(media.file, 'video'), item, {
    ...geometry,
    frames: actual.denoise.node.params.num_frames.value,
    fps: actual.export.node.params.fps.value,
  });
  for (const ref of retainedFiles) readCanonicalEvidenceFile(evidenceRoot, ref, 16 * 1024 * 1024);
  assert.ok(readFileSync(evidencePath).equals(descriptorBytes));
  const frameBinding = (role) => ({
    nodeId: actual[role].id,
    field: 'file',
    sha256: inputs[role].file.sha256,
    ...geometry,
  });
  const receipt = {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-run-receipt.v1',
    proofKind: 'real_backend_input_bound_model_variant',
    ...target,
    graphHash: identity.hash,
    taskId: task.task_id,
    outputId: output.id,
    capturedAt: new Date(task.completed_at * 1000).toISOString(),
    runtimeFingerprint: normalizeBackendRuntime(runtime).lockFingerprint,
    backendSourceFingerprint: backend.identity.fingerprint,
    backendContractFingerprint: backendContract.fingerprint,
    resourceCandidateId: null,
    outputHash: item.mediaHash,
    executionDurationSeconds: measurement.elapsedSeconds,
    peakMemoryBytes: measurement.peakAllocatedBytes,
    canonicalDefaultsExecuted: false,
    inputBinding: frameBinding('first'),
    lastFrameBinding: frameBinding('last'),
    promptBinding: { nodeId: actual.prompt.id, field: 'prompt', sha256: prompts.prompt },
    negativePromptBinding: { nodeId: actual.prompt.id, field: 'negative_prompt', sha256: prompts.negative_prompt },
    decodedOutput,
    observationLimits: {
      fullConsumedFieldAccounting: false,
      independentEncoderPixelSnapshots: false,
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
