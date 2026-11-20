import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { assertCanonicalAccountingGraphEnvelope } from './canonical-runtime-hints.mjs';
import {
  backendSourceEvidence,
  canonicalGraphIdentity,
  normalizeBackendRuntime,
  selectBackendRuntimeFingerprintEvidence,
  selectInstalledModelIdentity,
  stableStringify,
} from './live-proof-provenance.mjs';
import { validateNativeVariantOutput, validateNativeVariantRun } from './native-variant-run-evidence.mjs';
import {
  canonicalWorkflowAuthoringContract,
  exportCanonicalWorkflowGraphs,
  readCanonicalEvidenceFile,
} from './release-contract-core.mjs';

const whisperType = 'HuggingFaceSpeechRecognitionModel';
const ctcType = 'HuggingFaceCTCSpeechRecognitionModel';
const task = 'speech_to_text';
const routes = new Map([
  [
    `${whisperType}:${task}`,
    {
      modelType: whisperType,
      repo: 'openai/whisper-tiny',
      revision: '169d4a4341b33bc18d8881c4b69c2e104e1cc0af',
      pipeline: 'AutoModelForSpeechSeq2Seq',
      loader: 'LoadSpeechRecognitionModel',
      consumer: 'TranscribeAudio',
      timestamps: 'segment',
    },
  ],
  [
    `${ctcType}:${task}`,
    {
      modelType: ctcType,
      repo: 'facebook/wav2vec2-base-960h',
      revision: '22aad52d435eb6dbaf354bdad9b0da84ce7d6156',
      pipeline: 'AutoModelForCTC',
      loader: 'LoadCTCSpeechRecognitionModel',
      consumer: 'TranscribeCTCAudio',
      timestamps: 'word',
    },
  ],
]);
const source = 'node-01';
const loader = 'node-02';
const consumer = 'node-03';
const terminal = 'node-04';
const ids = [source, loader, consumer, terminal];
const speech = 'modules.HuggingFaceSpeech';
export const MAX_SPEECH_WAV_BYTES = 4 * 1024 * 1024;
export const MAX_SPEECH_TRANSCRIPT_BYTES = 1024 * 1024;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (actual, expected, message) => assert.deepEqual(actual, expected, message);
const sameWireJson = (actual, expected, message) =>
  assert.equal(stableStringify(actual), stableStringify(expected), message);
const keys = (row, names, message) => same(Object.keys(row ?? {}).sort(), [...names].sort(), message);
const wire = (sourceId, sourceKey) => ({ display: 'input', sourceId, sourceKey });
const literal = (value) => ({ value, source: 'literal' });
const completeStatus = { schemaVersion: 1, truncated: false };
const media = (inputs, outputs, files) => ({
  schemaVersion: 1,
  status: 'complete',
  source: 'native-builtin-media-v1',
  controls: {},
  inputs,
  outputs,
  files,
});

function speechRoute(workflowId) {
  const route = routes.get(workflowId);
  assert.ok(route, 'Unsupported private speech evidence route.');
  return route;
}

function speechControls(route) {
  const controls = { timestamps: route.timestamps, chunk_length_seconds: 30, stride_length_seconds: 5 };
  return route.modelType === whisperType ? { ...controls, task: 'transcribe', language: '' } : controls;
}

function assertSafeSourceName(name) {
  assert.ok(
    typeof name === 'string' && name.length <= 200 && /^[a-z0-9][a-z0-9_.-]*[.]wav$/iu.test(name),
    'Expected a plain WAV file picker name.',
  );
}

function boundSpeechGraph(workflowId, expectedApi, submitted, sourceName) {
  const route = speechRoute(workflowId);
  assertSafeSourceName(sourceName);
  assertCanonicalAccountingGraphEnvelope(expectedApi);
  assertCanonicalAccountingGraphEnvelope(submitted);
  same(submitted.paths, [ids], 'The speech recipe must run the four reviewed nodes in order.');
  keys(submitted.nodes, ids, 'Speech node identities differ.');
  for (const [id, module, action] of [
    [source, 'modules.Audio', 'Load'],
    [loader, speech, route.loader],
    [consumer, speech, route.consumer],
    [terminal, 'modules.Primitive', 'DataViewer'],
  ]) {
    const node = submitted.nodes[id];
    keys(node, ['module', 'action', 'params'], 'Unexpected node execution authority.');
    same([node.module, node.action], [module, action], 'Unexpected speech operation.');
    const fileFields = Object.keys(node.params).filter((field) => node.params[field].display === 'filebrowser');
    same(fileFields, id === source ? ['file'] : [], 'Unexpected speech file input.');
  }
  same(expectedApi.nodes[source].params.file, { display: 'filebrowser', value: '' });
  const expected = structuredClone(expectedApi);
  expected.nodes[source].params.file.value = [sourceName];
  sameWireJson(submitted.nodes, expected.nodes, 'Speech graph differs outside its single bound WAV.');
  same(submitted.paths, expected.paths, 'Speech graph paths differ.');
  const model = submitted.nodes[loader].params;
  same(model.model_id.value, { source: 'hub', value: route.repo }, 'Speech repository differs.');
  assert.equal(model.revision.value, route.revision, 'Speech model pin differs.');
  assert.equal(model.pipeline_class.value, route.pipeline, 'Speech loader class differs.');
  const controls = speechControls(route);
  same(
    submitted.nodes[consumer].params,
    {
      audio: wire(source, 'audio'),
      model: wire(loader, 'model'),
      ...Object.fromEntries(Object.entries(controls).map(([key, value]) => [key, { value }])),
    },
    'Speech consumer inputs or controls differ.',
  );
  same(submitted.nodes[terminal].params.value, wire(consumer, 'transcript'), 'Transcript output wire differs.');
  return { route, model, controls, identity: canonicalGraphIdentity(submitted) };
}

function pcm16Wave(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length >= 44 && bytes.length <= MAX_SPEECH_WAV_BYTES);
  same(bytes.toString('ascii', 0, 4), 'RIFF');
  same(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, 'WAV size differs.');
  let format, pcm;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    assert.ok(end <= bytes.length, 'WAV chunk exceeds retained bytes.');
    if (chunk === 'fmt ') {
      assert.ok(!format && (length === 16 || (length === 18 && bytes.readUInt16LE(start + 16) === 0)));
      format = bytes.subarray(start, end);
    } else if (chunk === 'data') {
      assert.ok(!pcm && format && length > 0 && length % 2 === 0);
      pcm = bytes.subarray(start, end);
    }
    offset = end + (length % 2);
  }
  assert.ok(format && pcm && offset === bytes.length, 'WAV chunks are incomplete.');
  same(
    [
      format.readUInt16LE(0),
      format.readUInt16LE(2),
      format.readUInt32LE(4),
      format.readUInt32LE(8),
      format.readUInt16LE(12),
      format.readUInt16LE(14),
    ],
    [1, 1, 16000, 32000, 2, 16],
    'Expected mono 16 kHz PCM16 WAV.',
  );
  const floats = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i += 2) floats.writeFloatLE(pcm.readInt16LE(i) / 32768, i * 2);
  const frames = pcm.length / 2;
  return {
    duration: frames / 16000,
    identity: {
      kind: 'audio',
      shape: [frames, 1],
      sampleRate: 16000,
      dtype: 'float32-le',
      byteSize: floats.length,
      sha256: digest(floats),
    },
  };
}

function expectedAccounting(controls) {
  const fields = Object.fromEntries(
    Object.entries(controls).map(([field, value]) => [
      field,
      field === 'language'
        ? { disposition: 'inactive', inputValue: value, ...literal(value), reason: 'feature-disabled' }
        : { disposition: 'consumed', inputValue: value, ...literal(value === 'segment' ? true : value) },
    ]),
  );
  return {
    schemaVersion: 1,
    fields,
    inputProjections: {},
    outputProjections: {},
    omittedFields: {},
    unaccountedFields: [],
    complete: true,
  };
}

export function verifyPrivateSpeechConsumer({ workflowId, expectedApi, submitted, output, sourceName, wavBytes }) {
  const bound = boundSpeechGraph(workflowId, expectedApi, submitted, sourceName);
  const read = output.resolvedExecutionInputs;
  assert.ok(read, 'Native speech consumer evidence is required.');
  same(
    [read.schemaVersion, read.source, read.taskId, read.attemptIndex, read.nodeId],
    [1, 'backend-execution', output.taskId, 0, terminal],
    'Native speech evidence owner differs.',
  );
  assert.equal(output.nodeId, terminal);
  same(read.uncapturedNodeIds, []);
  assert.equal(read.truncated, false);
  same(read.fieldAccountingStatus, completeStatus, 'Complete native speech control accounting is required.');
  same(read.mediaEvidenceStatus, completeStatus, 'Complete native speech media evidence is required.');
  same(read.nodes.map((row) => row.nodeId).sort(), ids, 'Native speech node owners are incomplete or ambiguous.');
  const observations = Object.fromEntries(read.nodes.map((row) => [row.nodeId, row]));
  for (const id of ids) {
    same(
      [observations[id].module, observations[id].action],
      [submitted.nodes[id].module, submitted.nodes[id].action],
      'Native speech observation scope differs.',
    );
    same(observations[id].omittedFields, {});
  }
  const { route, model, controls } = bound;
  for (const id of [source, consumer, terminal]) same(observations[id].fields, {});
  same(
    observations[loader].fields,
    {
      device: literal(model.device.value),
      dtype: literal(model.dtype.value),
      model_id: literal(route.repo),
      pipeline_class: literal(route.pipeline),
      revision: literal(route.revision),
    },
    'Native speech loader or model pin differs.',
  );
  const wave = pcm16Wave(wavBytes);
  const input = { sourceValue: sourceName, sha256: digest(wavBytes), byteSize: wavBytes.length, converted: false };
  same(
    observations[source].mediaEvidence,
    media({}, { audio: [wave.identity] }, { file: [input] }),
    'Native Audio.Load WAV or decoded audio differs.',
  );
  same(observations[consumer].fieldAccounting, expectedAccounting(controls), 'Native speech controls differ.');
  same(
    observations[consumer].mediaEvidence,
    media({ audio: [wave.identity] }, {}, {}),
    'The speech consumer did not observe the same decoded audio.',
  );
  return { ...bound, wave, input };
}

function speechTranscript(bytes, item, bound) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_SPEECH_TRANSCRIPT_BYTES);
  const transport = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  assert.ok(Array.isArray(transport) && transport.length === 1 && typeof transport[0] === 'string');
  same(transport, item.value, 'Transcript bytes do not match the native Data Viewer value.');
  const transcript = JSON.parse(transport[0]);
  keys(transcript, ['schemaVersion', 'task', 'text', 'timestampMode', 'durationSeconds', 'segments']);
  same(
    [transcript.schemaVersion, transcript.task, transcript.timestampMode, transcript.durationSeconds],
    [1, 'transcribe', bound.route.timestamps, bound.wave.duration],
    'Delivered transcript settings differ.',
  );
  assert.ok(Array.isArray(transcript.segments) && transcript.segments.length > 0);
  let previous = 0;
  const pieces = [];
  for (const segment of transcript.segments) {
    keys(segment, ['start', 'end', 'text']);
    assert.ok(
      Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        previous <= segment.start &&
        segment.start < segment.end &&
        segment.end <= bound.wave.duration,
      'Invalid speech transcript timestamps.',
    );
    assert.ok(typeof segment.text === 'string' && segment.text.length > 0 && segment.text.trim() === segment.text);
    previous = segment.end;
    pieces.push(segment.text);
  }
  assert.equal(transcript.text, pieces.join(' '), 'Transcript text and timed segments differ.');
  return transcript;
}

// Offline observation only. Source-template review and release are separate.
export function verifyPrivateSpeechRun({
  workflowId,
  expectedApi,
  creator,
  outputPackage,
  run,
  graphCompleted,
  graphRequest,
  graphAcknowledgment,
  sourceName,
  wavBytes,
  outputRef,
  outputBytes,
  modelObservation,
  sourceBefore,
  sourceAfter,
}) {
  const route = speechRoute(workflowId);
  const {
    output,
    task: nativeTask,
    hints,
  } = validateNativeVariantRun({
    target: { modelType: route.modelType, task },
    outputNodeId: terminal,
    displayType: 'text',
    creator,
    outputPackage,
    run,
    graphCompleted,
    graphRequest,
    graphAcknowledgment,
  });
  const bound = verifyPrivateSpeechConsumer({
    workflowId,
    expectedApi,
    submitted: graphRequest,
    output,
    sourceName,
    wavBytes,
  });
  same(creator.apiGraph.nodes, graphRequest.nodes, 'Creator speech graph differs.');
  same(creator.apiGraph.paths, graphRequest.paths, 'Creator speech paths differ.');
  same(
    graphCompleted.runtimeHints,
    { ...hints, controlledArtifacts: [], loaderContract: [] },
    'Unexpected native speech execution authority.',
  );
  const fingerprint = selectBackendRuntimeFingerprintEvidence([nativeTask.runtimeFingerprint]);
  assert.ok(fingerprint, 'Native runtime fingerprint is required.');
  const attestation = backendSourceEvidence({
    before: sourceBefore,
    after: sourceAfter,
    runtimeFingerprint: nativeTask.runtimeFingerprint,
  });
  same(attestation.blockers, [], 'Backend source attestation differs.');
  assert.equal(modelObservation.error, false);
  assert.equal(modelObservation.runtimeFingerprint, fingerprint.fingerprint);
  assert.equal(modelObservation.models.length, 1);
  assert.equal(modelObservation.models[0].complete, true);
  assert.equal(modelObservation.models[0].repairRequired, false);
  const observedModel = selectInstalledModelIdentity(modelObservation, route.repo);
  assert.equal(observedModel?.modelRevision, `${route.repo}@${route.revision}`, 'Installed speech model pin differs.');
  assert.equal(nativeTask.runtimeMeasurement?.device, bound.model.device.value, 'Native speech device differs.');
  const measurement = nativeTask.runtimeMeasurement;
  assert.ok(
    Number.isFinite(measurement.elapsedSeconds) && measurement.elapsedSeconds > 0,
    'Native speech elapsed time is missing.',
  );
  assert.ok(Number.isSafeInteger(measurement.peakAllocatedBytes) && measurement.peakAllocatedBytes > 0);
  assert.equal(measurement.peakMeasurementVersion, 2);
  assert.equal(outputBytes.length, outputRef.file.bytes, 'Retained transcript byte count differs.');
  assert.equal(digest(outputBytes), outputRef.file.sha256, 'Retained transcript bytes differ.');
  const item = validateNativeVariantOutput({
    output,
    outputRef,
    task: nativeTask,
    bytes: outputBytes,
    displayType: 'text',
    contentType: 'text/plain',
  });
  const transcript = speechTranscript(outputBytes, item, bound);
  return {
    workflowId,
    taskId: nativeTask.task_id,
    runTitle: hints.workflowTitle,
    capturedAt: new Date(nativeTask.completed_at * 1000).toISOString(),
    modelRevision: observedModel.modelRevision,
    graphHash: bound.identity.hash,
    input: bound.input,
    decodedAudio: bound.wave.identity,
    runtimeFingerprint: normalizeBackendRuntime(fingerprint).lockFingerprint,
    backendSourceFingerprint: attestation.identity.fingerprint,
    executionDurationSeconds: measurement.elapsedSeconds,
    peakMemoryBytes: measurement.peakAllocatedBytes,
    outputSha256: outputRef.file.sha256,
    transcript,
    scope: 'private-native-speech-observation',
  };
}

async function readPrivateSpeechCapture({
  clientRoot,
  canonicalGraph,
  captureRoot,
  evidenceRef,
  graphRequestRef,
  graphAcknowledgmentRef,
}) {
  const retainedFiles = [];
  const read = (ref, maximum) => {
    const result = readCanonicalEvidenceFile(captureRoot, ref, maximum);
    retainedFiles.push({ ...ref, absolutePath: result.file });
    return result.bytes;
  };
  const readJson = (ref, maximum) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read(ref, maximum)));
  const evidence = readJson(evidenceRef, 64 * 1024);
  assert.equal(evidence.schemaVersion, 1);
  speechRoute(evidence.workflowId);
  assert.ok(
    ['modiff.private.speech-recognition-observation.v1', 'modiff.private.input-bound-speech-capture.v1'].includes(
      evidence.format,
    ),
  );
  same(evidence.qualificationClaims, { releaseEligible: false, technicalVariant: true });
  assert.ok(Array.isArray(evidence.inputs) && evidence.inputs.length === 1);
  assert.ok(Array.isArray(evidence.outputs) && evidence.outputs.length === 1);
  assert.ok(Array.isArray(evidence.modelObservations) && evidence.modelObservations.length === 1);
  const [input] = evidence.inputs;
  const [outputRef] = evidence.outputs;
  same([input.nodeId, input.field], [source, 'file']);
  const creator = readJson(evidence.creatorPackage);
  const outputPackage = readJson(evidence.outputPackage);
  const run = readJson(evidence.runDetail);
  const graphRequest = readJson(graphRequestRef ?? evidence.graphRequest);
  const registry = readJson(evidence.nodes).nodes;
  for (const [id, { module, action }] of Object.entries(graphRequest.nodes)) {
    const contract = registry[`${module}.${action}`];
    same([contract?.module, contract?.action], [module, action], 'Speech runtime node registry differs.');
    same(
      Object.keys(contract.params).filter((field) => contract.params[field].display === 'filebrowser'),
      id === source ? ['file'] : [],
      'The retained speech worker had an unbound file input.',
    );
  }
  const [expectedApi, ...captures] = await exportCanonicalWorkflowGraphs(clientRoot, [
    canonicalGraph,
    creator.graph,
    outputPackage.graph,
    run.workflow_snapshot,
  ]);
  for (const capture of captures) {
    sameWireJson(capture.nodes, graphRequest.nodes, 'Retained visual speech graph exports to different nodes.');
    same(capture.paths, graphRequest.paths, 'Retained visual speech graph exports to different paths.');
  }
  const observation = verifyPrivateSpeechRun({
    workflowId: evidence.workflowId,
    expectedApi,
    creator,
    outputPackage,
    run,
    graphRequest,
    graphAcknowledgment: readJson(graphAcknowledgmentRef ?? evidence.graphAcknowledgment),
    graphCompleted: readJson(evidence.graphCompleted),
    sourceName: input.sourceValue,
    wavBytes: read(input.file, MAX_SPEECH_WAV_BYTES),
    outputRef,
    outputBytes: read(outputRef.file, MAX_SPEECH_TRANSCRIPT_BYTES),
    modelObservation: readJson(evidence.modelObservations[0]),
    sourceBefore: readJson(evidence.backendSourceBefore).identity,
    sourceAfter: readJson(evidence.backendSourceAfter).identity,
  });
  return { observation, evidence, retainedFiles };
}

export async function readPrivateSpeechRun(args) {
  return (await readPrivateSpeechCapture(args)).observation;
}

// The canonical recorder can recognize this exact private recipe. Its
// immutable evidence never implies permission to register a public template.
export async function readCanonicalSpeechEvidence({ clientRoot, manifest, graph, authoring, artifact, evidencePath }) {
  const route = speechRoute(manifest.id);
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact);
  same(target.modelSet, [{ repoId: route.repo, revision: route.revision }], 'Canonical speech pin differs.');
  same(target.outputPlan.mediaKinds, ['json'], 'Canonical speech must deliver structured text.');
  assert.equal(target.outputPlan.minimumAssetCount, 1);
  const stat = lstatSync(evidencePath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 65_536);
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes);
  keys(evidence, ['schemaVersion', 'format', 'workflowId', 'capture', 'graphRequest', 'graphAcknowledgment']);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.format, 'modiff.private.speech-to-text-input-bound.v1');
  assert.equal(evidence.workflowId, manifest.id);
  const evidenceRoot = realpathSync(dirname(evidencePath));
  const {
    observation,
    evidence: capture,
    retainedFiles,
  } = await readPrivateSpeechCapture({
    clientRoot,
    canonicalGraph: graph,
    captureRoot: evidenceRoot,
    evidenceRef: evidence.capture,
    graphRequestRef: evidence.graphRequest,
    graphAcknowledgmentRef: evidence.graphAcknowledgment,
  });
  assert.equal(observation.workflowId, manifest.id, 'Captured speech workflow differs.');
  assert.equal(observation.modelRevision, `${route.repo}@${route.revision}`, 'Captured speech pin differs.');
  assert.equal(observation.runTitle, basename(manifest.graphPath, '.json'), 'Canonical speech run title differs.');
  for (const ref of retainedFiles) readCanonicalEvidenceFile(evidenceRoot, ref);
  assert.ok(readFileSync(evidencePath).equals(descriptorBytes), 'Speech descriptor changed during validation.');

  const receipt = {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-run-receipt.v1',
    proofKind: 'real_backend_input_bound_model_variant',
    ...target,
    recipeTitle: authoring.title,
    runTitle: observation.runTitle,
    taskId: observation.taskId,
    capturedAt: observation.capturedAt,
    graphHash: observation.graphHash,
    resourceCandidateId: null,
    runtimeFingerprint: observation.runtimeFingerprint,
    backendSourceFingerprint: observation.backendSourceFingerprint,
    outputHash: `sha256:bytes:${observation.outputSha256}`,
    executionDurationSeconds: observation.executionDurationSeconds,
    peakMemoryBytes: observation.peakMemoryBytes,
    canonicalDefaultsExecuted: false,
    inputBinding: { nodeId: source, field: 'file', ...observation.input, decodedAudio: observation.decodedAudio },
    transcriptEvidence: {
      storage: 'native-text-json',
      durationSeconds: observation.transcript.durationSeconds,
      timestampMode: observation.transcript.timestampMode,
      segmentCount: observation.transcript.segments.length,
    },
    observationLimits: {
      fullConsumedFieldAccounting: false,
      speechConsumerControlsObserved: true,
      actualRecognizerInputAfterNormalization: false,
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
  const provenance = {
    format: 'modiff.input-bound-model-variant-proof.v1',
    receipt,
    evidenceFiles: {
      capture: evidence.capture,
      graphRequest: evidence.graphRequest,
      graphAcknowledgment: evidence.graphAcknowledgment,
      input: capture.inputs[0].file,
      output: capture.outputs[0].file,
    },
  };
  return { receipt, provenance, evidence, descriptorBytes, retainedFiles, evidenceRoot };
}
