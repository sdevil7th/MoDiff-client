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
import { verifyNativeLoadedImage } from './native-image-load-evidence.mjs';
import { verifyRetainedPngUpload } from './private-image-edit-evidence.mjs';
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
import { decodedMediaHash, technicalMediaErrors } from './template-gallery-harness.mjs';

const workflowId = 'StableDiffusionXLControlNetPipeline:control_inpaint';
const pipelineClass = 'StableDiffusionXLControlNetInpaintPipeline';
const format = 'modiff.private.native-control-inpaint.v1';
const roles = ['guide', 'mask', 'source'];
const chain = [
  'modules.Image.Load',
  'modules.ImageFilters.Canny',
  'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
  'modules.DiffusersRuntime.DiffusersExecutionRecipe',
  'modules.DiffusersImage.LoadPipeline',
  'modules.Image.Load',
  'modules.Image.Load',
  'modules.DiffusersImage.ControlInpaint',
  'modules.Image.Preview',
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const literal = (value) => ({ value, source: 'literal' });

function owners(api) {
  assert.equal(api.paths.length, 1);
  const [path] = api.paths;
  assert.deepEqual([...path].sort(), Object.keys(api.nodes).sort());
  assert.deepEqual(
    path.map((id) => `${api.nodes[id].module}.${api.nodes[id].action}`),
    chain,
  );
  const [guide, canny, , , loader, source, mask, sampler, preview] = path;
  return { path, guide, canny, loader, source, mask, sampler, preview };
}

export function verifyControlInpaintMedia(api, output, inputs, owner = owners(api)) {
  const receipt = output.resolvedExecutionInputs;
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.source, 'backend-execution');
  assert.equal(receipt.taskId, output.taskId);
  assert.equal(receipt.nodeId, owner.preview);
  assert.equal(receipt.attemptIndex, 0);
  assert.equal(receipt.truncated, false);
  assert.deepEqual(receipt.mediaEvidenceStatus, { schemaVersion: 1, truncated: false });
  assert.deepEqual(receipt.unavailableFields, []);
  assert.deepEqual(receipt.uncapturedNodeIds, []);
  assert.deepEqual(receipt.nodes.map(({ nodeId }) => nodeId).sort(), [...owner.path].sort());
  const record = (id) => {
    const row = receipt.nodes.find(({ nodeId }) => nodeId === id);
    assert.equal(row.module, api.nodes[id].module);
    assert.equal(row.action, api.nodes[id].action);
    assert.deepEqual(row.omittedFields, {});
    assert.equal(row.mediaEvidence.status, 'complete');
    return row;
  };
  const decoded = Object.fromEntries(
    roles.map((role) => {
      const id = owner[role];
      const { sourceFile, decodedImage } = verifyNativeLoadedImage(
        api.nodes[id],
        record(id),
        role === 'mask' ? 'L' : 'RGB',
      );
      assert.deepEqual(sourceFile, {
        sourceValue: inputs[role].sourceValue,
        sha256: inputs[role].file.sha256,
        byteSize: inputs[role].file.bytes,
      });
      return [role, decodedImage];
    }),
  );
  const image = (role) => [{ kind: 'image', ...decoded[role] }];
  const canny = record(owner.canny).mediaEvidence;
  const settings = api.nodes[owner.canny].params;
  const thresholds = [settings.low_threshold.value, settings.high_threshold.value];
  const outputMode = settings.output_mode?.value ?? 'L';
  assert.deepEqual(canny.controls, {
    low_threshold: Math.min(...thresholds),
    high_threshold: Math.max(...thresholds),
    output_mode: outputMode,
    device: settings.device.value,
  });
  assert.deepEqual(canny.inputs, { image: image('guide') }, 'Canny did not consume the selected guide.');
  assert.equal(canny.outputs.output.length, 1);
  assert.equal(canny.outputs.output[0].kind, 'image');
  assert.equal(canny.outputs.output[0].mode, outputMode);

  const sampler = record(owner.sampler);
  const params = api.nodes[owner.sampler].params;
  for (const field of [
    'prompt',
    'negative_prompt',
    'output_type',
    'num_inference_steps',
    'width',
    'height',
    'strength',
    'guidance_scale',
    'conditioning_scale',
    'control_guidance_start',
    'control_guidance_end',
    'seed',
  ]) {
    assert.deepEqual(sampler.fields[field], literal(params[field].value), `Inpaint sampler control differs: ${field}.`);
  }
  assert.deepEqual(sampler.fields.executed_task, literal('control_inpaint'));
  assert.deepEqual(
    sampler.mediaEvidence.inputs,
    {
      image: image('source'),
      mask_image: image('mask'),
      control_image: canny.outputs.output,
    },
    'Control Inpaint did not consume the selected source, mask and Canny output.',
  );
  const composite = sampler.mediaEvidence.outputs.images;
  assert.equal(composite.length, 1);
  assert.deepEqual(
    record(owner.preview).mediaEvidence.inputs,
    { image: composite },
    'Preview received a different image.',
  );
  return decoded;
}

export async function readControlInpaintEvidence({ clientRoot, manifest, graph, authoring, artifact, evidencePath }) {
  assert.equal(manifest.id, workflowId);
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact);
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
  const completed = json(evidence.graphCompleted);
  const [expected, ...visual] = await exportCanonicalWorkflowGraphs(clientRoot, [
    graph,
    creator.graph,
    outputPackage.latestOutput.graphSnapshot,
    run.workflow_snapshot,
  ]);
  const canonical = owners(expected);
  const actual = owners(graphRequest);
  assert.equal(canonicalGraphIdentity(expected).hash, evidence.originalGraphHash);
  assert.deepEqual(Object.keys(evidence.inputs).sort(), roles);
  for (const role of roles) {
    const { sourceValue } = evidence.inputs[role];
    assert.match(sourceValue, /^@data\/images\/[\w-]{1,128}\.png$/u);
    const field = expected.nodes[canonical[role]].params.file;
    assert.deepEqual(field, { display: 'filebrowser', value: role === 'source' ? [] : '' });
    field.value = [sourceValue];
  }
  assert.equal(new Set(roles.map((role) => evidence.inputs[role].file.sha256)).size, roles.length);
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
      'The inpaint graph differs outside its files and prompt.',
    );
  }
  const { task, output, hints } = validateNativeVariantRun({
    target,
    outputNodeId: actual.preview,
    displayType: 'image',
    creator,
    outputPackage,
    run,
    graphCompleted: completed,
    graphRequest,
    graphAcknowledgment: json(evidence.graphAcknowledgment),
    validatePreparation: (value) => validateUnmodifiedExpertPreparation(value, pipelineClass),
  });
  assert.deepEqual(hints.workflowSnapshot.studioForm, output.formSnapshot);
  const decodedInputs = verifyControlInpaintMedia(graphRequest, output, evidence.inputs, actual);
  for (const role of roles) {
    const input = evidence.inputs[role];
    verifyRetainedPngUpload(json(input.upload), input, decodedInputs[role], read(input.file).bytes);
  }

  const loader = graphRequest.nodes[actual.loader].params;
  const base = { repoId: loader.model_id.value.value, revision: loader.revision.value };
  const control = { repoId: loader.conditioning_model_id.value.value, revision: loader.conditioning_revision.value };
  assert.equal(loader.pipeline_class.value, pipelineClass);
  assert.deepEqual(target.modelSet, [control, base]);
  const { controlledArtifacts, loaderContract, ...completionHints } = completed.runtimeHints;
  assert.deepEqual(completionHints, hints);
  assert.deepEqual(loaderContract, ['modules.DiffusersImage.LoadPipeline']);
  assert.equal(controlledArtifacts.length, 1);
  const [conditioning] = controlledArtifacts;
  assert.deepEqual(conditioning.artifact, { source: 'hub', repository: control.repoId, revision: control.revision });
  assert.equal(conditioning.componentClass, 'ControlNetModel');
  assert.equal(conditioning.pipelineClass, pipelineClass);
  assert.equal(conditioning.safeSerializationRequired, true);
  const runtime = selectBackendRuntimeFingerprintEvidence([task.runtimeFingerprint]);
  assert.equal(evidence.modelObservations.length, 2);
  for (const [expectedModel, reference] of [
    [base, evidence.modelObservations[0]],
    [control, evidence.modelObservations[1]],
  ]) {
    const observation = json(reference);
    assert.equal(observation.error, false);
    assert.equal(observation.runtimeFingerprint, runtime.fingerprint);
    assert.equal(observation.models.length, 1);
    assert.equal(observation.models[0].complete, true);
    assert.equal(observation.models[0].repairRequired, false);
    const verified = selectInstalledModelIdentity(observation, expectedModel.repoId);
    assert.equal(verified?.selectedRevision, expectedModel.revision);
  }
  const source = backendSourceEvidence({
    before: json(evidence.backendSourceBefore).identity,
    after: json(evidence.backendSourceAfter).identity,
    runtimeFingerprint: task.runtimeFingerprint,
  });
  assert.deepEqual(source.blockers, []);
  const backendContract = backendContractIdentity(json(evidence.nodes), identity.canonicalGraph);
  assert.ok(backendContract.fingerprint);
  const measurement = task.runtimeMeasurement;
  assert.match(runtime.packages.platform, /^Windows-/u);
  assert.equal(measurement.backend, 'cuda');
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
  assert.deepEqual(technicalMediaErrors(decoded, { width: item.width, height: item.height }), []);
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
    inputBinding: {
      nodeId: actual.source,
      field: 'file',
      sha256: evidence.inputs.source.file.sha256,
      decodedImage: decodedInputs.source,
    },
    maskBinding: {
      nodeId: actual.mask,
      field: 'file',
      sha256: evidence.inputs.mask.file.sha256,
      decodedImage: decodedInputs.mask,
    },
    guideBinding: {
      nodeId: actual.guide,
      field: 'file',
      sha256: evidence.inputs.guide.file.sha256,
      decodedImage: decodedInputs.guide,
    },
    conditioningModel: control,
    promptBinding: { nodeId: actual.sampler, field: 'prompt', sha256: sha256(prompt) },
    decodedOutput: { hash: decoded.hash, width: decoded.width, height: decoded.height },
    observationLimits: {
      fullConsumedFieldAccounting: false,
      nativeCannyAndComposite: true,
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
