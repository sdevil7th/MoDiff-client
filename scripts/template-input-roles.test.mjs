import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalTemplateInputRole, isGeneratedUpscaleComparison } from './template-default-inputs.mjs';

test('native input roles preserve ordered references and canonical media fields', () => {
  for (const [native, expected] of Object.entries({
    sourceAudio: 'source_audio',
    sourceVideo: 'source_video',
    referenceAudio: 'reference_audio',
    maskVideo: 'mask_video',
    controlVideo: 'control_video',
    maskImage: 'mask_image',
    controlImage: 'control_image',
    'referenceImages[0]': 'reference_image_1',
    'referenceImages[5]': 'reference_image_6',
  })) {
    assert.equal(canonicalTemplateInputRole(native), expected);
    assert.equal(canonicalTemplateInputRole(expected), expected);
  }
  for (const value of [
    'referenceImages[-1]',
    'referenceImages[64]',
    'referenceImages[x]',
    'referenceImages',
    'madeUp',
  ]) {
    assert.doesNotMatch(canonicalTemplateInputRole(value) ?? '', /^(?:reference_image_\d+|source_audio|mask_image)$/u);
  }
  assert.equal(canonicalTemplateInputRole(null), null);
});

test('a comparison-only upscale input is excluded only with its actual generated graph ancestry', () => {
  const item = {
    role: 'upscaleSourceComparison',
    path: '@data/studio/outputs/original.webp',
    contentHash: `sha256:bytes:${'a'.repeat(64)}`,
  };
  const entry = { beforeMediaHash: item.contentHash };
  const run = {
    graph: {
      canonicalGraph: {
        nodes: [
          { key: 'generate', module: 'modules.ModularDiffusers', action: 'Denoise' },
          {
            key: 'decode',
            module: 'modules.ModularDiffusers',
            action: 'DecodeLatents',
            params: { latents: { sourceId: 'generate', sourceKey: 'latents' } },
          },
          {
            key: 'upscale',
            module: 'modules.Spandrel',
            action: 'Upscaler',
            params: { image: { sourceId: 'decode', sourceKey: 'images' } },
          },
        ],
      },
    },
  };
  assert.equal(isGeneratedUpscaleComparison(item, run, entry), true);
  assert.equal(isGeneratedUpscaleComparison(item, run, { beforeMediaHash: 'different' }), false);
  assert.equal(isGeneratedUpscaleComparison({ ...item, path: '@data/images/input.webp' }, run, entry), false);
  for (const index of [0, 1, 2]) {
    const changed = structuredClone(run);
    changed.graph.canonicalGraph.nodes.splice(index, 1);
    assert.equal(isGeneratedUpscaleComparison(item, changed, entry), false);
  }
  const loaded = structuredClone(run);
  loaded.graph.canonicalGraph.nodes.push({ module: 'modules.Image', action: 'Load' });
  assert.equal(isGeneratedUpscaleComparison(item, loaded, entry), false);
});
