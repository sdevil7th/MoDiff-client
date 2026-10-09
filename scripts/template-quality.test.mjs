import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;
let qualityModule;
let templatesModule;

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      entries: [],
      noDiscovery: true,
    },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  qualityModule = await server.ssrLoadModule('/src/studio/templateQuality.ts');
  templatesModule = await server.ssrLoadModule('/src/studio/templates.ts');
});

after(async () => {
  await server?.close();
});

function sampleTemplate(overrides = {}) {
  return {
    id: 'quality_test_template',
    label: 'Quality test template',
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    description: 'Synthetic semantic audit fixture.',
    prompt:
      'Create a studio product photograph of a ceramic field radio, centered in a three-quarter tabletop composition with warm side lighting, realistic brass texture, controlled reflections, and crisp editorial finish.',
    negativePrompt:
      'warped radio geometry, duplicate controls, unreadable product label, floating object, noisy shadows, compression artifacts',
    ...overrides,
  };
}

test('the complete catalog audits authored prompts and reports backend defaults as unresolved', () => {
  const audits = qualityModule.auditTemplateCatalog(templatesModule.STUDIO_TEMPLATES);
  const unresolved = audits.filter((audit) => audit.promptResolution === 'unresolved_backend_default');
  assert.deepEqual(
    unresolved.map((audit) => audit.templateId),
    ['cosmos3_super_text_to_image'],
  );
  for (const audit of unresolved) {
    assert.equal(audit.passed, false);
    assert.deepEqual(
      audit.issues.map((issue) => issue.code),
      ['unresolved_backend_default'],
    );
  }
  const failures = audits
    .filter((audit) => !audit.passed && audit.promptResolution !== 'unresolved_backend_default')
    .map((audit) => `${audit.templateId}: ${audit.issues.map((issue) => issue.message).join(' | ')}`);

  assert.deepEqual(failures, []);
  assert.deepEqual(
    new Set(audits.map((audit) => audit.kind)),
    new Set([
      'image_generation',
      'image_edit',
      'image_inpaint',
      'image_outpaint',
      'image_control',
      'image_layers',
      'video',
      'audio',
    ]),
  );
});

test('the Cosmos publisher blank-negative declaration does not extend to other same-class recipes', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'cosmos3_super_text_to_image');
  assert.equal(qualityModule.getTemplateNegativePolicy(template).declarationId, 'cosmos3-super-publisher-conditioning');
  const other = {
    ...template,
    executionSelection: { ...template.executionSelection, executionProfileId: 'another-profile' },
  };
  assert.equal(qualityModule.getTemplateNegativePolicy(other).requirement, 'required');
});

test('semantic coverage rejects long but content-free prompt padding', () => {
  const audit = qualityModule.auditTemplateQuality(
    sampleTemplate({
      prompt: 'beautiful masterpiece high quality professional detailed '.repeat(40),
    }),
  );

  assert.equal(audit.passed, false);
  assert.deepEqual(
    audit.issues.filter((issue) => issue.code === 'missing_semantic_group').map((issue) => issue.semanticGroup),
    ['focal_content', 'spatial_design', 'visual_treatment'],
  );
});

test('edit prompts name the source, transformation, invariants, and integration behavior', () => {
  const incomplete = qualityModule.auditTemplateQuality(
    sampleTemplate({
      mode: 'edit_image',
      modelType: 'QwenImageEditModularPipeline',
      prompt: 'Transform the source portrait into a graphite rain jacket.',
    }),
  );

  assert.equal(incomplete.passed, false);
  assert.ok(incomplete.issues.some((issue) => issue.semanticGroup === 'preservation'));
  assert.ok(incomplete.issues.some((issue) => issue.semanticGroup === 'integration'));

  const complete = qualityModule.auditTemplateQuality(
    sampleTemplate({
      mode: 'edit_image',
      modelType: 'QwenImageEditModularPipeline',
      prompt:
        'Transform the source portrait by replacing the coat with graphite fabric. Preserve the same face, pose, crop, and background, and match the original perspective, contact shadows, material finish, and light direction.',
    }),
  );
  assert.equal(complete.passed, true);
});

test('negative prompts require specific failure modes instead of generic quality words', () => {
  const generic = qualityModule.auditTemplateQuality(
    sampleTemplate({
      negativePrompt: 'bad quality, low quality, ugly, blurry',
    }),
  );

  assert.equal(generic.passed, false);
  assert.ok(generic.issues.some((issue) => issue.code === 'generic_negative_constraints'));
});

test('blank negative prompts are accepted only by a declared model-aware policy', () => {
  const undeclared = qualityModule.auditTemplateQuality(sampleTemplate({ negativePrompt: '' }));
  assert.ok(undeclared.issues.some((issue) => issue.code === 'blank_negative_not_allowed'));

  const flux = qualityModule.auditTemplateQuality(
    sampleTemplate({
      modelType: 'FluxDevPipeline',
      negativePrompt: '',
    }),
  );
  assert.equal(flux.negative.policy.declarationId, 'flux-native-conditioning');
  assert.equal(
    flux.issues.some((issue) => issue.code === 'blank_negative_not_allowed'),
    false,
  );

  const explicitCfgOne = qualityModule.auditTemplateQuality(
    sampleTemplate({
      negativePrompt: '',
      example: {
        mediaType: 'image',
        status: 'unverified',
        lockedSeed: 1,
        modelRevision: 'synthetic',
        runtimeEstimate: 'synthetic',
        lockedSettings: { guidanceScale: 1 },
      },
    }),
  );
  assert.equal(explicitCfgOne.negative.policy.declarationId, 'explicit-cfg-one-image-recipe');
  assert.equal(
    explicitCfgOne.issues.some((issue) => issue.code === 'blank_negative_not_allowed'),
    false,
  );
});

test('backend-owned prompts remain unresolved until their actual default is supplied to the semantic audit', () => {
  const template = sampleTemplate({ prompt: '', executionSelection: { backendDefaultInputs: ['prompt'] } });
  const unresolved = qualityModule.auditTemplateQuality(template);
  assert.equal(unresolved.promptResolution, 'unresolved_backend_default');
  assert.equal(unresolved.passed, false);
  assert.deepEqual(
    unresolved.issues.map((issue) => issue.code),
    ['unresolved_backend_default'],
  );
  const resolved = qualityModule.auditTemplateQuality(template, { prompt: sampleTemplate().prompt });
  assert.equal(resolved.promptResolution, 'backend_default');
  assert.equal(resolved.passed, true);
  const weak = qualityModule.auditTemplateQuality(template, { prompt: 'high quality '.repeat(100) });
  assert.equal(weak.passed, false);
  assert.equal(
    weak.issues.some((issue) => issue.code === 'missing_semantic_group'),
    true,
  );
  const undeclared = qualityModule.auditTemplateQuality(sampleTemplate({ prompt: '' }), {
    prompt: sampleTemplate().prompt,
  });
  assert.equal(undeclared.passed, false, 'A caller cannot replace an undeclared empty template prompt.');
  const authored = qualityModule.auditTemplateQuality(
    sampleTemplate({
      executionSelection: { backendDefaultInputs: ['prompt'] },
    }),
    { prompt: 'high quality' },
  );
  assert.equal(authored.promptResolution, 'template');
  assert.equal(authored.passed, true, 'Authored text takes precedence over a fresh backend default.');
});
