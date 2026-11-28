import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  assertCanonicalAccountingGraphEnvelope,
  canonicalMarigoldPreviewRuntimeHintAccounting,
} from './canonical-runtime-hints.mjs';
import {
  backendSourceEvidence,
  canonicalGraphIdentity,
  normalizeBackendRuntime,
  selectBackendRuntimeFingerprintEvidence,
  selectInstalledModelIdentity,
  sha256Value,
  stableStringify,
} from './live-proof-provenance.mjs';
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

const workflowId = 'MarigoldDepthPipeline:depth_estimation';
const repoId = 'prs-eth/marigold-depth-lcm-v1-0';
const revision = '04a73502f7fd8fc5e59947b9df3b2266d71d6849';
const maxMediaBytes = 16 * 1024 * 1024;
const chain = [
  ['quantization', 'modules.DiffusersRuntime', 'PipelineQuantizationConfigV2'],
  ['recipe', 'modules.DiffusersRuntime', 'DiffusersExecutionRecipe'],
  ['loader', 'modules.DiffusersImage', 'LoadPipeline'],
  ['source', 'modules.Image', 'Load'],
  ['predict', 'modules.DiffusersImage', 'PredictMap'],
  ['preview', 'modules.Image', 'Preview'],
];
const same = (actual, expected, message) => assert.equal(stableStringify(actual), stableStringify(expected), message);
const keys = (record, expected, message) => same(Object.keys(record ?? {}).sort(), [...expected].sort(), message);
const literalFields = (values) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, source: 'literal' }]));

function owners(api) {
  assertCanonicalAccountingGraphEnvelope(api);
  assert.equal(api.paths.length, 1, 'Marigold requires one executed graph path.');
  same([...api.paths[0]].sort(), Object.keys(api.nodes).sort(), 'Marigold graph path has extra or repeated owners.');
  assert.equal(api.paths[0].length, chain.length);
  return Object.fromEntries(
    chain.map(([role, module, action], i) => {
      const id = api.paths[0][i];
      const node = api.nodes[id];
      keys(node, ['module', 'action', 'params'], 'Marigold graph node contains unknown authority.');
      assert.equal(node.module, module);
      assert.equal(node.action, action);
      return [role, { id, node }];
    }),
  );
}

export function bindMarigoldSource(expectedApi, submittedApi, binding, nodesPayload) {
  assert.match(binding.sourceValue, /^[A-Za-z0-9_-][\w.-]*\.png$/u);
  assert.ok(binding.sourceValue.length <= 512, 'The Marigold image picker filename is too long.');
  const expected = owners(expectedApi);
  const submitted = owners(submittedApi);
  for (const role of [expected.source, submitted.source]) assert.equal(role.id, binding.nodeId);
  assert.equal(binding.field, 'file');
  same(expected.source.node.params.file, { display: 'filebrowser', value: [] }, 'Canonical image picker is not empty.');
  const registry = nodesPayload.nodes ?? nodesPayload;
  for (const { node } of Object.values(submitted)) {
    const contract = registry[`${node.module}.${node.action}`];
    assert.equal(contract?.module, node.module);
    assert.equal(contract.action, node.action);
    same(
      Object.entries(contract.params)
        .filter(([, p]) => p.display === 'filebrowser')
        .map(([name]) => name),
      node === submitted.source.node ? ['file'] : [],
      'The Marigold route has an unbound file browser.',
    );
  }
  const bound = structuredClone(expectedApi);
  bound.nodes[expected.source.id].params.file.value = [binding.sourceValue];
  const identity = canonicalGraphIdentity(bound);
  same(canonicalGraphIdentity(submittedApi), identity, 'Marigold recipe differs outside the bound source PNG.');
  const { loader, predict, preview, recipe, source } = submitted;
  for (const [to, field, from, port] of [
    [loader, 'execution_recipe', recipe, 'execution_recipe'],
    [predict, 'pipeline', loader, 'pipeline'],
    [predict, 'image', source, 'image'],
    [preview, 'image', predict, 'preview_images'],
  ]) {
    same(
      to.node.params[field],
      { display: 'input', sourceId: from.id, sourceKey: port },
      'Marigold preview wire differs.',
    );
  }
  same(loader.node.params.model_id.value, { source: 'hub', value: repoId });
  assert.equal(loader.node.params.revision.value, revision);
  return { ...submitted, identity };
}

export function verifyMarigoldPreviewConsumed(bound, output, binding) {
  const consumed = output.resolvedExecutionInputs;
  assert.equal(consumed.schemaVersion, 1);
  assert.equal(consumed.source, 'backend-execution');
  assert.equal(consumed.taskId, output.taskId);
  assert.equal(consumed.attemptIndex, 0);
  assert.equal(consumed.nodeId, bound.preview.id);
  assert.equal(consumed.truncated, false);
  same(consumed.uncapturedNodeIds, []);
  same(consumed.unavailableFields, []);
  // The accelerator and Preview CPU are intentionally different. Check each
  // native node's value instead of resolving the ambiguous global summary.
  same(consumed.ambiguousFields, ['device']);
  same(consumed.fieldAccountingStatus, { schemaVersion: 1, truncated: false });
  same(consumed.graphTasks, [
    { loaderId: bound.loader.id, pipelineClass: 'MarigoldDepthPipeline', task: 'depth_estimation' },
  ]);
  same(consumed.nodes.map((row) => row.nodeId).sort(), chain.map(([role]) => bound[role].id).sort());
  const recorded = {};
  for (const [role, module, action] of chain) {
    const row = consumed.nodes.find((candidate) => candidate.nodeId === bound[role].id);
    assert.equal(row.module, module);
    assert.equal(row.action, action);
    same(row.omittedFields, {});
    recorded[role] = row.fields;
  }
  same(recorded.quantization, literalFields({ dtype: 'float32' }));
  same(
    recorded.recipe,
    literalFields({
      attention_backend: 'auto',
      device: 'cuda:0',
      offload_mode: 'none',
      vae_slicing: true,
      vae_tiling: true,
    }),
  );
  same(
    recorded.loader,
    literalFields({
      auto_offload: false,
      device: 'cuda:0',
      dtype: 'float32',
      enable_vae_slicing: true,
      enable_vae_tiling: true,
      mode: 'depth_estimation',
      model_id: repoId,
      offload_mode: 'none',
      pipeline_class: 'MarigoldDepthPipeline',
      revision,
    }),
    'Native Marigold model pin or loader controls differ.',
  );
  const sha256 = binding.file.sha256;
  const [width] = recorded.source.source_widths?.value ?? [];
  const [height] = recorded.source.source_heights?.value ?? [];
  assert.ok([width, height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 2048));
  same(
    recorded.source,
    literalFields({
      alpha_channel: 'ignore',
      source_hashes: [sha256],
      source_widths: [width],
      source_heights: [height],
      source_modes: ['RGB'],
    }),
    'Native Marigold source byte identity or geometry differs.',
  );
  same(
    recorded.predict,
    literalFields({
      num_inference_steps: 1,
      processing_resolution: 768,
      match_input_resolution: true,
      output_type: 'np',
      executed_task: 'depth_estimation',
      seed: 42,
    }),
    'Native Marigold prediction controls differ.',
  );
  same(recorded.preview, literalFields({ device: 'cpu:0' }));
  return { width, height, sha256 };
}

export async function readMarigoldPreviewEvidence({ clientRoot, manifest, graph, authoring, artifact, evidencePath }) {
  assert.equal(manifest.id, workflowId);
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact);
  same(target.modelSet, [{ repoId, revision }], 'The Marigold route has a different model pin.');
  const stat = lstatSync(evidencePath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 65_536);
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes);
  keys(
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
      'outputs',
    ],
    'Unexpected Marigold preview evidence fields.',
  );
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.format, 'modiff.private.input-bound-model-smoke.v1');
  assert.equal(evidence.workflowId, workflowId);
  same(evidence.qualificationClaims, { releaseEligible: false, technicalVariant: true });
  for (const field of ['inputs', 'outputs', 'modelObservations'])
    assert.ok(
      Array.isArray(evidence[field]) && evidence[field].length === 1,
      `Marigold evidence requires one ${field} entry.`,
    );
  const [binding] = evidence.inputs;
  const [outputRef] = evidence.outputs;
  keys(binding, ['nodeId', 'field', 'sourceValue', 'file'], 'Unreviewed Marigold input binding fields.');
  keys(outputRef, ['backendPath', 'mediaType', 'file'], 'Unreviewed Marigold output binding fields.');
  const evidenceRoot = realpathSync(dirname(evidencePath));
  const retainedFiles = [];
  const read = (ref, maximum) => {
    const result = readCanonicalEvidenceFile(evidenceRoot, ref, maximum);
    retainedFiles.push({ ...ref, absolutePath: result.file });
    return result;
  };
  const json = (ref) => JSON.parse(read(ref).bytes);
  const creator = json(evidence.creatorPackage);
  const outputPackage = json(evidence.outputPackage);
  const run = json(evidence.runDetail);
  const graphCompleted = json(evidence.graphCompleted);
  const { latestOutput } = outputPackage;
  const apiGraph = latestOutput.apiGraphSnapshot;
  const [expected, creatorApi, outputApi, nativeApi] = await exportCanonicalWorkflowGraphs(clientRoot, [
    graph,
    creator.graph,
    latestOutput.graphSnapshot,
    run.workflow_snapshot,
  ]);
  const bound = bindMarigoldSource(expected, apiGraph, binding, json(evidence.nodes));
  for (const api of [creator.apiGraph, creatorApi, outputApi, nativeApi]) {
    owners(api);
    same(
      canonicalGraphIdentity(api),
      bound.identity,
      'Marigold creator or durable canvas differs from the bound graph.',
    );
  }
  const { task, output } = validateNativeVariantRun({
    target,
    outputNodeId: bound.preview.id,
    displayType: 'image',
    creator,
    outputPackage,
    run,
    graphCompleted,
    validatePreparation: (preparation) => validateUnmodifiedExpertPreparation(preparation, target.modelType),
  });
  const input = verifyMarigoldPreviewConsumed(bound, output, binding);
  const hintAccounting = canonicalMarigoldPreviewRuntimeHintAccounting({
    apiGraph,
    consumed: output.resolvedExecutionInputs,
    plan: { modelType: target.modelType },
    runtimeEvidence: { run, output, graphCompleted },
    digest: sha256Value,
  });
  const source = backendSourceEvidence({
    before: json(evidence.backendSourceBefore).identity,
    after: json(evidence.backendSourceAfter).identity,
    runtimeFingerprint: task.runtimeFingerprint,
  });
  same(source.blockers, [], 'Marigold worker source differs from original observations.');
  const runtime = selectBackendRuntimeFingerprintEvidence([task.runtimeFingerprint]);
  assert.ok(runtime, 'Native Marigold runtime fingerprint is incomplete.');
  assert.match(task.runtimeFingerprint.packages.platform, /^Windows-/u);
  assert.equal(task.runtimeFingerprint.torch.cuda_available, true);
  const measurement = task.runtimeMeasurement;
  assert.equal(measurement.backend, 'cuda');
  assert.equal(measurement.device, 'cuda:0');
  assert.equal(measurement.peakMeasurementVersion, 2);
  assert.ok(Number.isFinite(measurement.elapsedSeconds) && measurement.elapsedSeconds > 0);
  assert.ok(Number.isSafeInteger(measurement.peakAllocatedBytes) && measurement.peakAllocatedBytes > 0);
  const observation = json(evidence.modelObservations[0]);
  assert.equal(observation.error, false);
  assert.equal(observation.runtimeFingerprint, task.runtimeFingerprint.fingerprint);
  assert.equal(observation.models.length, 1);
  assert.equal(observation.models[0].complete, true);
  const installed = selectInstalledModelIdentity(observation, repoId);
  assert.equal(installed?.modelRevision, `${repoId}@${revision}`);
  assert.equal(installed.selectedRevision, revision);
  const inputFile = read(binding.file, maxMediaBytes);
  const outputFile = read(outputRef.file, maxMediaBytes);
  const item = validateNativeVariantOutput({
    output,
    outputRef,
    task,
    bytes: outputFile.bytes,
    displayType: 'image',
    contentType: 'image/webp',
  });
  const nativeUrl = new URL(item.value, 'http://127.0.0.1');
  assert.equal(nativeUrl.origin, 'http://127.0.0.1');
  assert.equal(nativeUrl.pathname, `/cache/${bound.preview.id}/output/0`);
  assert.equal(nativeUrl.searchParams.get('format'), 'WEBP');
  assert.equal(nativeUrl.searchParams.get('quality'), '100');
  const { decodedMediaHash } = await import('./template-gallery-harness.mjs');
  const sourceDecoded = await decodedMediaHash(inputFile.file, 'image');
  const outputDecoded = await decodedMediaHash(outputFile.file, 'image');
  const dimensions = ({ width, height }) => [width, height];
  assert.ok(
    inputFile.bytes.length >= 33 &&
      inputFile.bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
      inputFile.bytes.toString('ascii', 12, 16) === 'IHDR' &&
      inputFile.bytes[25] === 2,
    'The archived source is not RGB PNG.',
  );
  assert.ok(
    outputFile.bytes.length >= 20 &&
      outputFile.bytes.toString('ascii', 0, 4) === 'RIFF' &&
      outputFile.bytes.toString('ascii', 8, 12) === 'WEBP',
    'The archived preview is not WebP.',
  );
  same(
    dimensions(sourceDecoded),
    dimensions(input),
    'Decoded Marigold source geometry differs from the native receipt.',
  );
  same(dimensions(outputDecoded), dimensions(input), 'The Marigold preview did not retain source size.');
  same(dimensions(item), dimensions(outputDecoded), 'Persisted Marigold preview geometry differs.');
  assert.ok(outputDecoded.lumaStdDev >= 0.75 && outputDecoded.nearBlackRatio <= 0.995, 'Marigold preview is blank.');
  for (const ref of retainedFiles) readCanonicalEvidenceFile(evidenceRoot, ref);
  assert.ok(
    readFileSync(evidencePath).equals(descriptorBytes),
    'Marigold evidence descriptor changed during validation.',
  );
  const receipt = {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-run-receipt.v1',
    proofKind: 'real_backend_input_bound_model_variant',
    ...target,
    taskId: task.task_id,
    capturedAt: new Date(task.completed_at * 1000).toISOString(),
    graphHash: bound.identity.hash,
    resourceCandidateId: null,
    runtimeFingerprint: normalizeBackendRuntime(runtime).lockFingerprint,
    backendSourceFingerprint: source.identity.fingerprint,
    outputHash: item.mediaHash,
    executionDurationSeconds: measurement.elapsedSeconds,
    peakMemoryBytes: measurement.peakAllocatedBytes,
    canonicalDefaultsExecuted: false,
    inputBinding: { nodeId: binding.nodeId, field: binding.field, ...input },
    decodedOutput: { hash: outputDecoded.hash, width: outputDecoded.width, height: outputDecoded.height },
    observationLimits: {
      fullConsumedFieldAccounting: false,
      numericDepthPrediction: false,
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
  const provenance = { format: 'modiff.input-bound-model-variant-proof.v1', receipt, hintAccounting };
  return { receipt, provenance, evidence, descriptorBytes, retainedFiles, evidenceRoot };
}
