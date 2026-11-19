import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';
import { canonicalJsonHash, decodedAudiovisualMediaHash } from './template-gallery-harness.mjs';
import { verifyTemplateRecipeRecords } from './template-recipe-records.mjs';

const root = resolve(import.meta.dirname, '..');
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'silent',
  optimizeDeps: { entries: [], noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
const exactness = await server.ssrLoadModule('/src/studio/templateExactness.ts');
const { STUDIO_TEMPLATES: templates } = await server.ssrLoadModule('/src/studio/templates.ts');
test.after(() => server.close());

const manifest = JSON.parse(readFileSync(resolve(root, 'public/template-gallery/manifest.json'), 'utf8'));
const history = JSON.parse(readFileSync(resolve(root, 'config/template-recipe-history.v1.json'), 'utf8'));
const selectionIndex = JSON.parse(readFileSync(resolve(root, 'src/studio/templateHistoricalSelections.json'), 'utf8'));

test('an empty active historical ledger is valid after all examples have current replacements', () => {
  const body = {
    schemaVersion: 1,
    format: 'modiff.gallery.recipe-history.v1',
    source: { repository: 'example/gallery', revision: 'a'.repeat(40) },
    records: [],
  };
  const accepted = { ...body, recordsHash: canonicalJsonHash(body) };
  assert.deepEqual(verifyTemplateRecipeRecords(accepted, { runtime: {}, manifest: {} }), []);
  for (const changed of [
    { ...accepted, recordsHash: 'invalid' },
    { ...accepted, records: null },
    { ...accepted, source: { ...body.source, revision: 'main' } },
  ]) {
    assert.throws(() => verifyTemplateRecipeRecords(changed, {}), /invalid/);
  }
});

test('registered native video recipe identities survive presentation-only regrouping', () => {
  const originalNote =
    'Encode Inputs reuses official text encoding and owns source media; the official Denoise call prepares media latents and Video Output decodes and exports the matching result.';
  for (const id of ['ltx_video_text_to_video', 'ltx_video_image_to_video', 'ltx_video_multi_reference']) {
    const template = templates.find((item) => item.id === id);
    const entry = manifest.examples.find((item) => item.templateId === id);
    const registered = {
      ...template,
      executionSelection: { ...template.executionSelection, note: originalNote },
    };
    assert.equal(exactness.getTemplateLockHash(registered, entry.modelRevision), entry.templateLockHash, id);
    assert.deepEqual(template.executionSelection, registered.executionSelection, id);
    assert.equal(exactness.findManifestEntry(template, manifest), entry, id);
    for (const patch of [
      { note: originalNote + ' changed' },
      { executionProfileId: 'different-video:direct' },
      { authoringRecipeId: 'different-recipe:v1' },
    ]) {
      assert.equal(
        exactness.findManifestEntry(
          { ...template, executionSelection: { ...template.executionSelection, ...patch } },
          manifest,
        ),
        undefined,
        `${id}: altered descriptor must still be rejected`,
      );
    }
  }
});

test('the compact browser index exactly projects reviewed historical selections', () => {
  assert.deepEqual(
    selectionIndex.records,
    history.records
      .filter((record) => record.creator.executionSelection)
      .map((record) => ({
        templateId: record.templateId,
        currentTemplateLockHash: record.currentTemplateLockHash,
        templateLockHash: record.bindings.templateLockHash,
        executionSelection: record.creator.executionSelection,
      })),
  );
});

test('registered native LTX examples match the current recipe after visual regrouping', () => {
  for (const id of ['ltx_video_text_to_video', 'ltx_video_image_to_video', 'ltx_video_multi_reference']) {
    const template = templates.find((item) => item.id === id);
    const entry = manifest.examples.find((item) => item.templateId === id);
    assert.ok(entry);
    assert.equal(exactness.findManifestEntry(template, manifest), entry, id);
    assert.equal(exactness.findHistoricalTemplateManifestEntry(template, manifest), undefined, id);
    assert.notEqual(exactness.getTemplateExampleUiState(template, {}, null, manifest).status, 'historical');
  }
});

test('all reconciled records reproduce their original locks and preserve historical scope', () => {
  for (const record of history.records) {
    const template = templates.find((item) => item.id === record.templateId);
    const entry = manifest.examples.find((item) => item.templateId === record.templateId);
    const recipe = exactness.findHistoricalTemplateRecipe(template, manifest);
    assert.equal(recipe?.entry, entry, record.templateId);
    assert.equal(exactness.getTemplateLockHash(recipe.template, entry.modelRevision), record.bindings.templateLockHash);
    assert.equal(exactness.getTemplateLockHash(template, entry.modelRevision), record.currentTemplateLockHash);
    assert.equal(exactness.findManifestEntry(template, manifest), undefined);
    assert.equal(record.currentGraphExecutionProved, false);
    if (record.creator.executionSelection) {
      assert.notDeepEqual(recipe.template.executionSelection, template.executionSelection);
    }
  }
});

test('approved audio remux history binds the derivative and its original run independently', () => {
  using temporary = mkdtempDisposableSync(resolve(tmpdir(), 'modiff-historical-remux-'));
  const gallery = resolve(temporary.path, 'public/template-gallery');
  mkdirSync(gallery, { recursive: true });
  const templateId = 'reviewed_music_video';
  const currentTemplateLockHash = 'tpl_12345555';
  const templateLockHash = 'tpl_12344444';
  const sourceTemplateLockHash = 'tpl_12343333';
  const promptSettingsHash = 'ps_12340000';
  const modelRevision = `example/wan@${'a'.repeat(40)}`;
  const decodedMediaHash = 'sha256:decoded-video:original';
  const decodedAudioHash = 'sha256:decoded-audio:replacement';
  const audiovisualMediaHash = decodedAudiovisualMediaHash(decodedMediaHash, decodedAudioHash);
  const modelSetHash = 'sha256:model-set:original';
  const inputArtifactsHash = 'sha256:input-artifacts:original';
  const proofFields = {
    graphHash: 'sha256:graph:original',
    proofLockHash: 'sha256:proof-lock:original',
    backendSourceFingerprint: 'sha256:backend-source:original',
    backendContractFingerprint: 'sha256:backend-contract:original',
    modelCommit: modelRevision,
    templateRevisionHash: 'sha256:template-revision:original',
  };
  const processorPath = 'scripts/align-subway-strum-review.py';
  const processorHash = createHash('sha256')
    .update(readFileSync(resolve(root, processorPath)))
    .digest('hex');
  const operation = { name: 'audio_delay_fit_and_stream_copy_remux', parameters: { delayVideoFrames: 4 } };
  const expected = {
    templateId,
    templateLockHash,
    promptSettingsHash,
    modelRevision,
    runtimeFingerprint: 'sha256:runtime:original',
    decodedMediaHash,
    decodedAudioHash,
    audiovisualMediaHash,
    modelSetHash,
    inputArtifactsHash,
  };
  const prototype = {
    schemaVersion: 1,
    format: 'modiff.gallery.reviewed-provenance.v1',
    templateId,
    bindings: expected,
    run: {
      ...proofFields,
      template: { id: templateId, promptSettingsHash },
      templateLockHash: sourceTemplateLockHash,
      modelRevision,
      models: { hash: modelSetHash, revisionLock: modelRevision, count: 1, items: [{ modelRevision }] },
      inputArtifactsHash,
      mediaHash: decodedMediaHash,
      output: { collectionHash: 'sha256:output-collection:original' },
      blockers: [],
    },
    derivative: {
      ...expected,
      schemaVersion: 1,
      format: 'modiff.gallery.reviewed-derivative.v1',
      kind: 'audio_remux',
      sourceOutputCollectionHash: 'sha256:output-collection:original',
      sourceVideoHash: decodedMediaHash,
      sourceTemplateLockHash,
      sourcePromptSettingsHash: promptSettingsHash,
      replacementAudio: { encodedSha256: 'encoded', decodedSha256: 'decoded', provenanceSha256: 'provenance' },
      processor: { path: processorPath, contentHash: `sha256:bytes:${processorHash}` },
      operation,
      operationHash: canonicalJsonHash(operation),
    },
  };
  const review = { status: 'approved_reviewed' };
  writeFileSync(resolve(gallery, 'review.json'), JSON.stringify(review));
  const template = { id: templateId, executionSelection: { implementation: 'pipeline_stages' } };
  const historical = { id: templateId };
  const runtime = {
    templates: [template],
    templateLockHash: () => currentTemplateLockHash,
    promptSettingsHash: () => promptSettingsHash,
    findHistoricalTemplateRecipe: () => ({ template: historical }),
    findManifestEntry: () => undefined,
  };
  const verify = (bundle) => {
    writeFileSync(resolve(gallery, 'provenance.json'), JSON.stringify(bundle));
    const entry = {
      ...expected,
      ...proofFields,
      mediaHash: decodedMediaHash,
      provenancePath: '/template-gallery/provenance.json',
      provenanceHash: canonicalJsonHash(bundle),
      qualityReviewPath: '/template-gallery/review.json',
      qualityReviewHash: canonicalJsonHash(review),
    };
    const body = {
      schemaVersion: 1,
      format: 'modiff.gallery.recipe-history.v1',
      source: { repository: 'example/gallery', revision: 'b'.repeat(40) },
      records: [
        {
          templateId,
          currentTemplateLockHash,
          evidenceScope: 'approved_historical_recipe',
          currentGraphExecutionProved: false,
          creator: { executionSelection: null, workflowBlockSettings: {} },
          bindings: { templateLockHash, provenanceHash: entry.provenanceHash },
        },
      ],
    };
    return verifyTemplateRecipeRecords(
      { ...body, recordsHash: canonicalJsonHash(body) },
      { root: temporary.path, runtime, manifest: { schemaVersion: 2, examples: [entry] } },
    );
  };

  const [record] = verify(prototype);
  assert.equal(record.template, historical);
  assert.equal(record.evidenceScope, 'approved_historical_recipe');
  assert.equal(record.currentGraphExecutionProved, false);
  for (const mutate of [
    (bundle) => delete bundle.derivative,
    (bundle) => (bundle.derivative.sourceTemplateLockHash = templateLockHash),
    (bundle) => (bundle.derivative.templateLockHash = currentTemplateLockHash),
    (bundle) => (bundle.derivative.operation.parameters.delayVideoFrames = 5),
    (bundle) => (bundle.derivative.decodedAudioHash = 'different audio'),
    (bundle) => (bundle.derivative.sourceOutputCollectionHash = 'different source'),
    (bundle) => (bundle.bindings.runtimeFingerprint = 'different runtime'),
    (bundle) => (bundle.run.graphHash = 'different graph'),
    (bundle) => (bundle.run.inputArtifactsHash = 'different inputs'),
    (bundle) => (bundle.run.models.count = 0),
    (bundle) => (bundle.run.models.items = 'x'),
  ]) {
    const changed = structuredClone(prototype);
    mutate(changed);
    assert.throws(() => verify(changed), /original creator, graph or complete model-set proof/u);
  }
});

test('the seven accepted native replacements use current recipes and retire active historical associations', () => {
  const replaced = [
    'ltx_video_animated_story',
    'ltx_video_long_showcase',
    'wan_vace_grayscale_control',
    'wan_vace_outpaint_reframe',
    'wan_vace_cinematic_text_to_video',
    'wan_vace_video_color_grade',
    'wan_vace_video_to_video',
  ];
  for (const id of replaced) {
    const template = templates.find((item) => item.id === id);
    const entry = manifest.examples.find((item) => item.templateId === id);
    assert.ok(entry, id);
    assert.equal(exactness.findManifestEntry(template, manifest), entry, id);
    assert.equal(exactness.findHistoricalTemplateManifestEntry(template, manifest), undefined, id);
    assert.equal(
      history.records.some((record) => record.templateId === id),
      false,
      id,
    );
  }
});

test('restored native file identity cannot ignore changed weights, models, inputs or creator settings', () => {
  const template = templates.find((item) => item.id === 'ltx_video_image_to_video');
  const entry = manifest.examples.find((item) => item.templateId === template.id);
  const isolated = { ...manifest, examples: [entry] };
  for (const mutate of [
    (value) => {
      value.prompt += ' changed';
    },
    (value) => {
      value.workflowBlockSettings.upscaler.model.sha256 = 'a'.repeat(64);
    },
    (value) => {
      value.workflowBlockSettings.upscaler.model.revision = 'a'.repeat(40);
    },
    (value) => {
      value.workflowBlockSettings.upscaler.model.value = 'nateraw/real-esrgan-other/RealESRGAN_x2plus.pth';
    },
    (value) => {
      value.workflowBlockSettings.upscaler.model.value = 'nateraw/real-esrgan/../other.pth';
    },
    (value) => {
      value.inputBindings[0].defaultAssets[0].runtimeSha256 = `sha256:bytes:${'a'.repeat(64)}`;
    },
  ]) {
    const changed = structuredClone(template);
    mutate(changed);
    assert.equal(exactness.findManifestEntry(changed, isolated), undefined);
    assert.equal(exactness.findHistoricalTemplateManifestEntry(changed, isolated), undefined);
  }
  assert.equal(
    exactness.findHistoricalTemplateManifestEntry(template, {
      ...manifest,
      examples: [{ ...entry, modelCommit: 'unrecorded' }],
    }),
    undefined,
  );
});
