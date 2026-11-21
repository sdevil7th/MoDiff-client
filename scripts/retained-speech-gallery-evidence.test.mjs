import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { canonicalJsonHash } from './canonical-json.mjs';
import { backendContractIdentity, canonicalGraphIdentity } from './live-proof-provenance.mjs';
import { verifyRetainedSpeechGalleryEvidence } from './retained-speech-gallery-evidence.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileRecord = (path, bytes) => ({ path, bytes: bytes.length, sha256: hash(bytes) });

const whisper = {
  modelType: 'HuggingFaceSpeechRecognitionModel',
  templateId: 'whisper_tiny_blue_cup_transcription',
  sourceTask: 'task-template:whisper-tiny:speech-to-text:v1',
  repo: 'openai/whisper-tiny',
  revision: '169d4a4341b33bc18d8881c4b69c2e104e1cc0af',
  loader: 'LoadSpeechRecognitionModel',
  consumer: 'TranscribeAudio',
  timestamps: 'segment',
};
const wav2vec = {
  modelType: 'HuggingFaceCTCSpeechRecognitionModel',
  templateId: 'wav2vec2_station_announcement',
  sourceTask: 'task-template:wav2vec2-base-960h:speech-to-text:v1',
  repo: 'facebook/wav2vec2-base-960h',
  revision: '22aad52d435eb6dbaf354bdad9b0da84ce7d6156',
  loader: 'LoadCTCSpeechRecognitionModel',
  consumer: 'TranscribeCTCAudio',
  timestamps: 'word',
};

function fixture(t, route = whisper) {
  const evidenceRoot = mkdtempSync(join(tmpdir(), 'modiff-retained-speech-'));
  t.after(() => rmSync(evidenceRoot, { recursive: true, force: true }));
  const store = (path, bytes) => {
    writeFileSync(join(evidenceRoot, path), bytes);
    return fileRecord(path, bytes);
  };
  const durationSeconds = 2 / 16000;
  const transcript = {
    schemaVersion: 1,
    task: 'transcribe',
    text: route === wav2vec ? 'READY' : 'Private verified recording.',
    timestampMode: route.timestamps,
    durationSeconds,
    segments: [{ text: route === wav2vec ? 'READY' : 'Private verified recording.', start: 0, end: durationSeconds }],
  };
  const structured = Buffer.from(JSON.stringify(transcript, null, 2));
  const wav = Buffer.from(
    '524946462800000057415645666d74201000000001000100803e0000007d000002001000646174610400000000c00040',
    'hex',
  );
  const input = store('private.source.wav', wav);
  const output = store('native.output.txt', Buffer.from(JSON.stringify([structured.toString('utf8')])));
  const stages = [
    ['modules.Audio', 'Load'],
    ['modules.HuggingFaceSpeech', route.loader],
    ['modules.HuggingFaceSpeech', route.consumer],
    ['modules.Primitive', 'DataViewer'],
  ];
  const nodes = Object.fromEntries(
    stages.map(([module, action], index) => [
      'node-' + (index + 1),
      { module, action, params: { sample: { value: index } } },
    ]),
  );
  const submission = { nodes, paths: [Object.keys(nodes)] };
  const graph = canonicalGraphIdentity(submission);
  const registry = {
    nodes: Object.fromEntries(
      Object.values(nodes).map(({ module, action }) => [
        module + '.' + action,
        { module, action, params: { sample: { type: 'int', display: 'number' } } },
      ]),
    ),
  };
  const storeJson = (path, value) => store(path, Buffer.from(JSON.stringify(value)));
  const storeCapture = () => storeJson('capture.json', { nodes: storeJson('nodes.json', registry) });
  const workflowId = route.modelType + ':speech_to_text';
  const descriptorBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, workflowId, graphHash: graph.hash }));
  const recipe = {
    workflowId,
    sourceTaskTemplateId: route.sourceTask,
    template: {
      id: route.templateId,
      modelType: route.modelType,
      mode: 'speech_to_text',
      modelArtifact: { source: 'hub', value: route.repo, revision: route.revision },
    },
    originalReceiptSha256: hash(descriptorBytes),
    retainedGraphHash: graph.hash,
    inputLocatorSha256: hash('local.source.wav'),
    inputSha256: input.sha256,
  };
  const receipt = {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-run-receipt.v1',
    proofKind: 'real_backend_input_bound_model_variant',
    workflowId: recipe.workflowId,
    task: 'speech_to_text',
    sourceTemplateId: recipe.sourceTaskTemplateId,
    modelType: route.modelType,
    modelSet: [{ repoId: route.repo, revision: route.revision }],
    inputBinding: {
      field: 'file',
      sourceValue: 'local.source.wav',
      byteSize: input.bytes,
      sha256: input.sha256,
      converted: false,
    },
    graphHash: graph.hash,
    outputHash: 'sha256:bytes:' + output.sha256,
    transcriptEvidence: {
      storage: 'native-text-json',
      durationSeconds,
      timestampMode: route.timestamps,
      segmentCount: 1,
    },
  };
  const provenance = {
    format: 'modiff.input-bound-model-variant-proof.v1',
    evidenceFiles: {
      input,
      output,
      capture: storeCapture(),
      graphRequest: storeJson('graph-request.json', submission),
    },
  };
  const galleryOutput = { bytes: structured, ref: fileRecord('transcript.json', structured) };
  return {
    args: { recipe, native: { receipt, provenance, evidenceRoot, descriptorBytes }, galleryOutput },
    transcript,
    store,
    storeJson,
    storeCapture,
    registry,
    submission,
    wav,
    backendContractFingerprint: backendContractIdentity(registry, graph.canonicalGraph).fingerprint,
  };
}

test('Whisper Gallery proof rejects a changed private source locator', (t) => {
  const { args } = fixture(t);
  args.native.receipt.inputBinding.sourceValue = 'different.source.wav';
  assert.throws(() => verifyRetainedSpeechGalleryEvidence(args), /source locator differs/u);
});

test('verified Whisper Gallery proof binds exact output and original private WAV by hash', (t) => {
  const { args, transcript, backendContractFingerprint } = fixture(t);
  const proof = verifyRetainedSpeechGalleryEvidence(args);
  assert.deepEqual(proof, {
    output: {
      mediaType: 'json',
      sourceOutputHash: args.native.receipt.outputHash,
      outputEncodedSha256: 'sha256:bytes:' + args.galleryOutput.ref.sha256,
      decodedMediaHash: 'sha256:canonical-json:' + canonicalJsonHash(transcript),
      outputBytes: args.galleryOutput.bytes.length,
    },
    inputSha256: args.recipe.inputSha256,
    backendContractFingerprint,
  });
});

test('rejects equal JSON content with different approved file bytes', (t) => {
  const { args, transcript } = fixture(t);
  const bytes = Buffer.from(JSON.stringify(transcript));
  args.galleryOutput = { bytes, ref: fileRecord('transcript.json', bytes) };
  assert.throws(() => verifyRetainedSpeechGalleryEvidence(args), /exact native JSON/u);
});

test('rejects matching changed transport and Gallery output against the saved receipt', (t) => {
  const { args, transcript, store } = fixture(t);
  transcript.text = 'Altered transcript.';
  transcript.segments[0].text = transcript.text;
  const bytes = Buffer.from(JSON.stringify(transcript, null, 2));
  args.galleryOutput = { bytes, ref: fileRecord('transcript.json', bytes) };
  args.native.provenance.evidenceFiles.output = store(
    'native.output.txt',
    Buffer.from(JSON.stringify([bytes.toString('utf8')])),
  );
  assert.throws(() => verifyRetainedSpeechGalleryEvidence(args), /native run/u);
});

test('rejects a WAV altered on disk or replaced with a rehashed descriptor', (t) => {
  const { args, store, wav } = fixture(t);
  wav[wav.length - 1] ^= 1;
  const changed = store('private.source.wav', wav);
  assert.throws(() => verifyRetainedSpeechGalleryEvidence(args), /Evidence file hash differs/u);
  args.native.provenance.evidenceFiles.input = changed;
  assert.throws(() => verifyRetainedSpeechGalleryEvidence(args), /native input binding/u);
  args.native.receipt.inputBinding.sha256 = changed.sha256;
  assert.throws(() => verifyRetainedSpeechGalleryEvidence(args), /exact recipe/u);
});

test('rejects a mismatched decoded transcript observation', (t) => {
  const { args } = fixture(t);
  args.native.receipt.transcriptEvidence.segmentCount = 2;
  assert.throws(() => verifyRetainedSpeechGalleryEvidence(args), /verified speech receipt/u);
});

test('rejects an attempt to provide the private WAV as Gallery input', (t) => {
  const { args, wav } = fixture(t);
  args.galleryInput = { bytes: wav, ref: fileRecord('input.wav', wav) };
  assert.throws(() => verifyRetainedSpeechGalleryEvidence(args), /audio source stays private/u);
});

test('rejects a rehashed graph that differs from the captured Whisper graph', (t) => {
  const { args, submission, storeJson } = fixture(t);
  submission.nodes['node-1'].params.sample.value = 999;
  args.native.provenance.evidenceFiles.graphRequest = storeJson('graph-request.json', submission);
  assert.throws(() => verifyRetainedSpeechGalleryEvidence(args), /graph differs from the receipt/u);
});

test('rejects a rehashed incomplete native node inventory', (t) => {
  const { args, registry, storeCapture } = fixture(t);
  delete registry.nodes['modules.Audio.Load'];
  args.native.provenance.evidenceFiles.capture = storeCapture();
  assert.throws(() => verifyRetainedSpeechGalleryEvidence(args), /missing a native node contract/u);
});

test('verified Wav2Vec2 Gallery proof binds the pinned CTC word result and private WAV', (t) => {
  const { args, transcript, backendContractFingerprint } = fixture(t, wav2vec);
  const proof = verifyRetainedSpeechGalleryEvidence(args);
  assert.deepEqual(proof, {
    output: {
      mediaType: 'json',
      sourceOutputHash: args.native.receipt.outputHash,
      outputEncodedSha256: 'sha256:bytes:' + args.galleryOutput.ref.sha256,
      decodedMediaHash: 'sha256:canonical-json:' + canonicalJsonHash(transcript),
      outputBytes: args.galleryOutput.bytes.length,
    },
    inputSha256: args.recipe.inputSha256,
    backendContractFingerprint,
  });
});

test('a Wav2Vec2 draft cannot substitute another checkpoint, route, or native descriptor', (t) => {
  const { args } = fixture(t, wav2vec);
  const { recipe, native } = args;
  const wrongArtifact = { ...recipe.template.modelArtifact, revision: 'a'.repeat(40) };
  assert.throws(
    () =>
      verifyRetainedSpeechGalleryEvidence({
        ...args,
        recipe: { ...recipe, template: { ...recipe.template, modelArtifact: wrongArtifact } },
      }),
    /template model pin differs/u,
  );
  assert.throws(
    () =>
      verifyRetainedSpeechGalleryEvidence({
        ...args,
        recipe: { ...recipe, workflowId: whisper.modelType + ':speech_to_text' },
      }),
    /workflow differs from the reviewed template/u,
  );
  assert.throws(
    () =>
      verifyRetainedSpeechGalleryEvidence({ ...args, native: { ...native, descriptorBytes: Buffer.from('changed') } }),
    /descriptor differs/u,
  );
});

test('Wav2Vec2 rejects a consistently rehashed segment result and private audio publication', (t) => {
  const { args, transcript, store, wav } = fixture(t, wav2vec);
  assert.throws(
    () => verifyRetainedSpeechGalleryEvidence({ ...args, galleryInput: { bytes: wav } }),
    /audio source stays private/u,
  );
  transcript.timestampMode = 'segment';
  const bytes = Buffer.from(JSON.stringify(transcript));
  args.galleryOutput = { bytes, ref: fileRecord('transcript.json', bytes) };
  const output = store('native.output.txt', Buffer.from(JSON.stringify([bytes.toString('utf8')])));
  args.native.provenance.evidenceFiles.output = output;
  args.native.receipt.outputHash = 'sha256:bytes:' + output.sha256;
  args.native.receipt.transcriptEvidence.timestampMode = 'segment';
  assert.throws(() => verifyRetainedSpeechGalleryEvidence(args), /timestamp mode differs from the reviewed route/u);
});

test('Wav2Vec2 rejects substituted Whisper nodes even if the edited graph and node registry agree', (t) => {
  const { args, submission, registry, storeCapture, storeJson } = fixture(t, wav2vec);
  const previous = 'modules.HuggingFaceSpeech.' + wav2vec.consumer;
  const replacement = 'modules.HuggingFaceSpeech.' + whisper.consumer;
  submission.nodes['node-3'].action = whisper.consumer;
  registry.nodes[replacement] = { ...registry.nodes[previous], action: whisper.consumer };
  delete registry.nodes[previous];
  args.native.provenance.evidenceFiles.capture = storeCapture();
  args.native.provenance.evidenceFiles.graphRequest = storeJson('graph-request.json', submission);
  args.native.receipt.graphHash = canonicalGraphIdentity(submission).hash;
  args.recipe.retainedGraphHash = args.native.receipt.graphHash;
  assert.throws(() => verifyRetainedSpeechGalleryEvidence(args), /differs from the reviewed node identities/u);
});
