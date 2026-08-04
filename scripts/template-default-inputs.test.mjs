import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  PROJECT_ROOT,
  buildTemplateDefaultInputPlan,
  renderRuntimeInputJson,
  renderRuntimeInputTypescript,
  runtimeTreeDigest,
  verifyTemplateDefaultInputPlan,
  writeTemplateDefaultInputPlan,
} from './template-default-inputs.mjs';

const MANIFEST_PATH = join(PROJECT_ROOT, 'public', 'template-gallery', 'manifest.json');
const RUNTIME_ROOT = join(PROJECT_ROOT, 'public', 'template-gallery', 'runtime-inputs');
const APPROVED_REVIEW_STATUSES = new Set(['approved_exact', 'approved_reviewed']);

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function sha256(path) {
  return `sha256:bytes:${createHash('sha256')
    .update(await readFile(path))
    .digest('hex')}`;
}

function flattenedDefaultAssets(mapping) {
  return Object.entries(mapping).flatMap(([templateId, bindings]) =>
    bindings.flatMap((binding) => binding.defaultAssets.map((asset) => ({ templateId, field: binding.field, asset }))),
  );
}

test('approved provenance root inputs have complete typed Studio binding coverage', async () => {
  const plan = await buildTemplateDefaultInputPlan();
  const manifest = await readJson(MANIFEST_PATH);
  const approvedTemplateIds = new Set(
    manifest.examples
      .filter((entry) => APPROVED_REVIEW_STATUSES.has(entry.qualityReviewStatus))
      .map((entry) => entry.templateId),
  );
  const mappedAssets = flattenedDefaultAssets(plan.mapping);

  assert.equal(mappedAssets.length, plan.requirements.length);
  assert.ok(mappedAssets.length > 0);
  assert.ok(plan.runtimeAssets.length <= mappedAssets.length, 'identical reviewed bytes may be shared');
  for (const templateId of Object.keys(plan.mapping)) {
    assert.ok(approvedTemplateIds.has(templateId), `${templateId} is still approved by the public manifest`);
  }
  for (const requirement of plan.requirements) {
    const expectedAssetId = `${requirement.templateId}-${requirement.role.replaceAll('_', '-')}`;
    const bindingAsset = mappedAssets.find(
      ({ templateId, asset }) => templateId === requirement.templateId && asset.id === expectedAssetId,
    );
    assert.ok(bindingAsset, `${requirement.templateId} ${requirement.role} has a generated binding`);
    assert.equal(bindingAsset.asset.runtimeSha256, requirement.contentHash);
    assert.match(
      bindingAsset.asset.runtimePath,
      /^\/template-gallery\/runtime-inputs\/assets\/[a-f0-9]{64}\.[a-z0-9]+$/,
    );
  }
  assert.deepEqual(
    plan.mapping.ltx_video_long_showcase[0].defaultAssets.map((asset) => asset.id),
    [
      'ltx_video_long_showcase-reference-image-1',
      'ltx_video_long_showcase-reference-image-2',
      'ltx_video_long_showcase-reference-image-3',
      'ltx_video_long_showcase-reference-image-4',
      'ltx_video_long_showcase-reference-image-5',
      'ltx_video_long_showcase-reference-image-6',
    ],
    'multiple reference images stay in reviewed numeric order',
  );
  assert.deepEqual(
    plan.excludedGenerated.map(({ templateId, role }) => [templateId, role]),
    [['qwen_upscale_finish', 'generated_before_upscale']],
    'generated intermediate outputs never become bundled root inputs',
  );
  assert.equal(plan.mapping.qwen_upscale_finish, undefined);

  const wanBindings = plan.mapping.wan_vace_outpaint_reframe;
  const wanSource = wanBindings.find((binding) => binding.field === 'sourceVideo').defaultAssets.at(0);
  const wanMask = wanBindings.find((binding) => binding.field === 'maskVideo').defaultAssets.at(0);
  assert.equal(
    wanSource.previewPath,
    '/template-gallery/inputs/wan_vace_outpaint_reframe.before.mp4',
    'the raw reviewed source points at the browser-safe H.264 Before derivative',
  );
  assert.notEqual(wanSource.previewPath, wanSource.runtimePath);
  assert.equal(wanMask.previewPath, undefined, 'the mask never inherits the source-video preview');
});

test('runtime input files retain every reviewed provenance byte hash', async () => {
  const plan = await buildTemplateDefaultInputPlan();
  await verifyTemplateDefaultInputPlan(plan);

  for (const asset of plan.runtimeAssets) {
    const runtimePath = join(RUNTIME_ROOT, asset.relativePath);
    assert.equal(await sha256(runtimePath), asset.contentHash, asset.relativePath);
    assert.equal((await readFile(runtimePath)).byteLength, asset.byteSize, asset.relativePath);
  }
});

test('JSON and TypeScript mappings are deterministic views of the same keyed contract', async () => {
  const plan = await buildTemplateDefaultInputPlan();
  const jsonMapping = JSON.parse(renderRuntimeInputJson(plan));
  assert.deepEqual(jsonMapping, plan.mapping);

  const typescript = await renderRuntimeInputTypescript(plan);
  assert.match(typescript, /satisfies Partial<Record<StudioTemplateId, StudioTemplateInputBinding\[\]>>;/);
  for (const templateId of Object.keys(plan.mapping)) {
    assert.match(typescript, new RegExp(`\\b${templateId}: \\[`));
  }
});

test('two clean generations produce byte-identical runtime and typed bundles', async () => {
  const plan = await buildTemplateDefaultInputPlan();
  const firstRoot = await mkdtemp(join(tmpdir(), 'modiff-template-inputs-a-'));
  const secondRoot = await mkdtemp(join(tmpdir(), 'modiff-template-inputs-b-'));

  try {
    await writeTemplateDefaultInputPlan(plan, firstRoot);
    await writeTemplateDefaultInputPlan(plan, secondRoot);
    await verifyTemplateDefaultInputPlan(plan, firstRoot);
    await verifyTemplateDefaultInputPlan(plan, secondRoot);
    assert.equal(await runtimeTreeDigest(firstRoot), await runtimeTreeDigest(secondRoot));
  } finally {
    await rm(firstRoot, { recursive: true, force: true });
    await rm(secondRoot, { recursive: true, force: true });
  }
});
