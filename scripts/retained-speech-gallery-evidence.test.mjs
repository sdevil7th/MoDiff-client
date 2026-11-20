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

function fixture(t) {
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
    text: 'Private verified recording.',
    timestampMode: 'segment',
    durationSeconds,
    segments: [{ text: 'Private verified recording.', start: 0, end: durationSeconds }],
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
    ['modules.HuggingFaceSpeech', 'LoadSpeechRecognitionModel'],
    ['modules.HuggingFaceSpeech', 'TranscribeAudio'],
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
  const recipe = {
    workflowId: 'HuggingFaceSpeechRecognitionModel:speech_to_text',
    sourceTaskTemplateId: 'task-template:whisper-tiny:speech-to-text:v1',
    template: { id: 'whisper_tiny_blue_cup_transcription' },
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
      timestampMode: 'segment',
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
    args: { recipe, native: { receipt, provenance, evidenceRoot }, galleryOutput },
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
