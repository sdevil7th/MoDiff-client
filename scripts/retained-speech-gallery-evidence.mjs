import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJsonHash } from './canonical-json.mjs';
import { backendContractIdentity, canonicalGraphIdentity } from './live-proof-provenance.mjs';
import { MAX_SPEECH_TRANSCRIPT_BYTES, MAX_SPEECH_WAV_BYTES } from './private-speech-evidence.mjs';
import { readCanonicalEvidenceFile } from './release-contract-core.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function retainedBackendContract(evidenceRoot, files, graphHash) {
  const readJson = (ref, maxBytes) => {
    const { bytes } = readCanonicalEvidenceFile(evidenceRoot, ref, maxBytes);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  };
  const graph = canonicalGraphIdentity(readJson(files.graphRequest));
  assert.equal(graph.hash, graphHash, 'Retained Whisper graph differs from the receipt.');
  const capture = readJson(files.capture, 64 * 1024);
  const nodes = readJson(capture.nodes);
  const { contracts, fingerprint } = backendContractIdentity(nodes, graph.canonicalGraph);
  assert.ok(
    contracts.length === 4 && contracts.every(({ params }) => Object.keys(params).length > 0),
    'Retained Whisper graph is missing a native node contract.',
  );
  return fingerprint;
}

// The caller has already revalidated the private native speech capture. Bind
// the exact archived WAV and transport to the separate Gallery JSON bytes.
export function verifyRetainedSpeechGalleryEvidence({ recipe, native, galleryOutput, galleryInput }) {
  assert.equal(recipe.template.id, 'whisper_tiny_blue_cup_transcription');
  assert.equal(recipe.workflowId, 'HuggingFaceSpeechRecognitionModel:speech_to_text');
  assert.equal(galleryInput, undefined, 'The retained Whisper audio source stays private.');
  const { receipt, provenance, evidenceRoot } = native;
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.format, 'modiff.canonical-workflow-run-receipt.v1');
  assert.equal(receipt.proofKind, 'real_backend_input_bound_model_variant');
  assert.equal(receipt.workflowId, recipe.workflowId);
  assert.equal(receipt.sourceTemplateId, recipe.sourceTaskTemplateId);
  assert.equal(receipt.task, 'speech_to_text');
  assert.equal(provenance.format, 'modiff.input-bound-model-variant-proof.v1');

  const { input, output } = provenance.evidenceFiles;
  const binding = receipt.inputBinding;
  assert.equal(binding.field, 'file');
  assert.equal(typeof binding.sourceValue, 'string');
  assert.equal(
    digest(binding.sourceValue),
    recipe.inputLocatorSha256,
    'Whisper source locator differs from the retained recipe.',
  );
  assert.equal(binding.converted, false);
  assert.equal(binding.sha256, recipe.inputSha256, 'Whisper WAV differs from the exact recipe.');
  assert.equal(binding.sha256, input.sha256, 'Archived WAV differs from the native input binding.');
  assert.equal(binding.byteSize, input.bytes);
  readCanonicalEvidenceFile(evidenceRoot, input, MAX_SPEECH_WAV_BYTES);

  const { bytes: transportBytes } = readCanonicalEvidenceFile(evidenceRoot, output, MAX_SPEECH_TRANSCRIPT_BYTES);
  const sourceOutputHash = 'sha256:bytes:' + output.sha256;
  assert.equal(sourceOutputHash, receipt.outputHash, 'Archived Whisper transport differs from the native run.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(transportBytes);
  assert.ok(Buffer.from(text).equals(transportBytes), 'Native Whisper transport must use BOM-free UTF-8.');
  const transport = JSON.parse(text);
  assert.ok(
    Array.isArray(transport) && transport.length === 1 && typeof transport[0] === 'string',
    'Native Whisper transport must contain one structured result.',
  );

  const { bytes: structuredBytes, ref } = galleryOutput;
  assert.ok(
    Buffer.isBuffer(structuredBytes) &&
      structuredBytes.length > 0 &&
      structuredBytes.length <= MAX_SPEECH_TRANSCRIPT_BYTES,
    'Gallery transcript must be a nonempty bounded file.',
  );
  assert.equal(structuredBytes.length, ref.bytes);
  assert.equal(digest(structuredBytes), ref.sha256, 'Gallery transcript differs from the approved file.');
  assert.ok(Buffer.from(transport[0]).equals(structuredBytes), 'Gallery transcript must match the exact native JSON.');
  const transcript = JSON.parse(transport[0]);
  assert.equal(transcript.schemaVersion, 1);
  assert.equal(transcript.task, 'transcribe');
  assert.equal(transcript.timestampMode, 'segment');
  assert.ok(Array.isArray(transcript.segments) && transcript.segments.length > 0);
  assert.deepEqual(
    receipt.transcriptEvidence,
    {
      storage: 'native-text-json',
      durationSeconds: transcript.durationSeconds,
      timestampMode: transcript.timestampMode,
      segmentCount: transcript.segments.length,
    },
    'Gallery transcript metadata differs from the verified speech receipt.',
  );

  return {
    output: {
      mediaType: 'json',
      sourceOutputHash,
      outputEncodedSha256: 'sha256:bytes:' + ref.sha256,
      decodedMediaHash: 'sha256:canonical-json:' + canonicalJsonHash(transcript),
      outputBytes: structuredBytes.length,
    },
    inputSha256: input.sha256,
    backendContractFingerprint: retainedBackendContract(evidenceRoot, provenance.evidenceFiles, receipt.graphHash),
  };
}
