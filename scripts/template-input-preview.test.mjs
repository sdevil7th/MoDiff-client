import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const { bundledTemplateInputPreviewUrl } = await server.ssrLoadModule('/src/studio/templateInputPreview.ts');
const { resolveTemplateAssetUrl } = await server.ssrLoadModule('/src/studio/templateAssets.ts');

test.after(async () => {
  await server.close();
});

const continuationAudioPath =
  '/template-gallery/runtime-inputs/assets/3807d712e24a94c4b445c2fa950a784bba334f5f665e74964fe4d47a43856230.wav';

test('resolves an exact template input filename through the configured asset source', () => {
  assert.equal(
    bundledTemplateInputPreviewUrl('audio/ace_step_audio_continuation.source_audio.wav'),
    resolveTemplateAssetUrl(continuationAudioPath),
  );
});

test('resolves the backend collision suffix to the byte-identical configured input', () => {
  assert.equal(
    bundledTemplateInputPreviewUrl('audio/ace_step_audio_continuation.source_audio_8e-hx3.wav'),
    resolveTemplateAssetUrl(continuationAudioPath),
  );
});

test('does not substitute an unrelated user file', () => {
  assert.equal(bundledTemplateInputPreviewUrl('audio/my-own-recording.wav'), null);
});
