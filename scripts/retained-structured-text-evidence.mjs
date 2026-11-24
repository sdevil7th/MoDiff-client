import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJsonHash } from './canonical-json.mjs';

const MAX_TEXT_EVIDENCE_BYTES = 2 * 1024 * 1024;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function parseJsonBytes(bytes, label) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.ok(Buffer.from(text).equals(bytes), `${label} must use UTF-8 without a byte order mark.`);
  return JSON.parse(text);
}

// The caller must first verify the canonical workflow receipt against its
// original source and captures. This binds its exact text output to a separate,
// approved JSON file. Neither the native receipt nor its media hash changes.
export function verifyRetainedStructuredText({ receipt, transportBytes, structuredBytes, outputSha256 }) {
  const textRoutes = {
    'HuggingFaceTextGenerationModel:text_generation': ['real_backend_prompt_bound_model_variant', 'text-generation'],
    'HuggingFaceAnyToAnyModel:text_generation': ['real_backend_prompt_bound_model_variant', 'any-to-any-generation'],
    'HuggingFaceAnyToAnyModel:image_to_text': ['real_backend_input_bound_model_variant', 'any-to-any-generation'],
  };
  const route = Object.hasOwn(textRoutes, receipt?.workflowId) ? textRoutes[receipt.workflowId] : null;
  assert.ok(
    receipt?.schemaVersion === 1 &&
      receipt.format === 'modiff.canonical-workflow-run-receipt.v1' &&
      route &&
      receipt.proofKind === route[0] &&
      receipt.decodedOutput?.schemaVersion === 1 &&
      receipt.decodedOutput.kind === 'json',
    'A verified receipt for the reviewed text workflow is required.',
  );
  for (const bytes of [transportBytes, structuredBytes]) {
    assert.ok(
      Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_TEXT_EVIDENCE_BYTES,
      'Retained text evidence requires a nonempty bounded file.',
    );
  }
  const sourceOutputHash = `sha256:bytes:${digest(transportBytes)}`;
  assert.equal(sourceOutputHash, receipt.outputHash, 'Retained bytes differ from the original native transport.');
  assert.match(outputSha256, /^[a-f0-9]{64}$/u, 'An exact approved structured result hash is required.');
  assert.equal(digest(structuredBytes), outputSha256, 'Retained bytes differ from the approved structured result.');

  const transport = parseJsonBytes(transportBytes, 'Native transport');
  assert.ok(
    Array.isArray(transport) && transport.length === 1 && typeof transport[0] === 'string',
    'Native text transport must contain one encoded JSON result.',
  );
  const native = JSON.parse(transport[0]);
  const decoded = receipt.decodedOutput;
  assert.ok(
    native?.schemaVersion === 1 &&
      native.task === route[1] &&
      typeof native.text === 'string' &&
      native.text.trim() &&
      native.finishReason === decoded.finishReason &&
      native.inputTokens === decoded.inputTokens &&
      native.generatedTokens === decoded.generatedTokens &&
      native.modelReceipt?.receiptDigest === decoded.modelReceiptDigest &&
      /^sha256:[a-f0-9]{64}$/u.test(decoded.modelReceiptDigest),
    'Decoded result differs from the native text receipt.',
  );
  if (native.task === 'any-to-any-generation') {
    const source = receipt.inputBinding?.decodedImage;
    const caption = receipt.workflowId === 'HuggingFaceAnyToAnyModel:image_to_text';
    assert.equal(Boolean(source), caption, 'Janus result has the wrong source evidence.');
    assert.equal(native.outputModality, 'text');
    assert.equal(native.inputImageCount, caption ? 1 : 0);
    assert.equal(native.inputMediaPixels, caption ? source.width * source.height : 0);
  }
  const { receiptDigest, ...model } = native.modelReceipt;
  assert.equal(receiptDigest, `sha256:${canonicalJsonHash(model)}`, 'Native text model receipt digest differs.');
  assert.deepEqual(
    receipt.modelSet,
    [{ repoId: model.source?.repository, revision: model.source?.revision }],
    'Decoded model differs from the executed immutable model set.',
  );
  const structured = parseJsonBytes(structuredBytes, 'Structured result');
  assert.deepEqual(structured, native, 'Approved JSON differs from the decoded native result.');
  return {
    schemaVersion: 1,
    format: 'modiff.gallery.retained-structured-text.v1',
    sourceOutputHash,
    sourceBytes: transportBytes.length,
    outputEncodedSha256: `sha256:bytes:${outputSha256}`,
    outputBytes: structuredBytes.length,
    decodedMediaHash: `sha256:canonical-json:${canonicalJsonHash(structured)}`,
  };
}
