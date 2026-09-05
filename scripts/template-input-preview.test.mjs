import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createServer } from 'vite';

import { PROJECT_ROOT, readStudioTemplateIds, renderRuntimeInputTypescript } from './template-default-inputs.mjs';

const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom' });
const { bundledTemplateInputPreviewUrl } = await server.ssrLoadModule('/src/studio/templateInputPreview.ts');
const { resolveTemplateAssetUrl } = await server.ssrLoadModule('/src/studio/templateAssets.ts');
const { templateDefaultInputBindings } = await server.ssrLoadModule(
  '/src/studio/generated/templateDefaultInputBindings.ts',
);

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

test('tracked default-input JSON and generated packed bindings stay deterministic and aligned', async () => {
  const mapping = JSON.parse(
    await readFile(
      new URL('../public/template-gallery/runtime-inputs/default-input-bindings.json', import.meta.url),
      'utf8',
    ),
  );
  const templateIds = await readStudioTemplateIds(PROJECT_ROOT);
  assert.deepEqual(
    Object.keys(mapping).filter((templateId) => !templateIds.includes(templateId)),
    [],
    'the tracked mapping contains only runnable templates',
  );
  for (const [index, templateId] of templateIds.entries()) {
    assert.deepEqual(templateDefaultInputBindings(templateId, index), mapping[templateId] ?? [], templateId);
  }

  const rendered = await renderRuntimeInputTypescript({ mapping, templateIds });
  assert.equal(
    rendered,
    await renderRuntimeInputTypescript({ mapping, templateIds }),
    'two renders are byte-identical',
  );
  assert.equal(
    rendered,
    await readFile(new URL('../src/studio/generated/templateDefaultInputBindings.ts', import.meta.url), 'utf8'),
    'the checked-in packed artifact matches the tracked JSON and template order',
  );
});
