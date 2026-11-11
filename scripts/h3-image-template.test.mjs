import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

test('the H3 old-town human-and-cat template creates the exact generic image recipe without publishing a preview', async () => {
  const original = { window: globalThis.window, localStorage: globalThis.localStorage };
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  globalThis.window = { location: { origin: 'http://127.0.0.1:5191' }, localStorage: globalThis.localStorage };
  const server = await createServer({
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
  });
  try {
    const { STUDIO_TEMPLATES } = await server.ssrLoadModule('/src/studio/templates.ts');
    const template = STUDIO_TEMPLATES.find((item) => item.id === 'minimax_h3_image_old_town_cat');
    assert.ok(template, 'the requested reusable H3 scene template must exist');
    assert.match(template.prompt, /adult woman/i);
    assert.match(template.prompt, /orange tabby cat/i);
    assert.match(template.prompt, /old town/i);
    assert.equal(template.example.status, 'unverified');
    assert.equal(template.tags.includes('experimental'), true);
    assert.equal(template.executionSelection.memoryPolicy, 'custom_experimental');
    for (const field of ['outputPath', 'mediaHash', 'runtimeFingerprint'])
      assert.equal(Object.hasOwn(template.example, field), false, field);
    const exactness = await server.ssrLoadModule('/src/studio/templateExactness.ts');
    const card = exactness.getTemplateCardMedia(template, null);
    assert.equal(card.thumbnailPath, '/assets/minimax-h3-old-town.card-poster.png');
    assert.equal(card.mediaPath, undefined, 'Editorial artwork is not a generated example.');
    const browser = await server.ssrLoadModule('/src/studio/templateBrowser.ts');
    assert.equal(browser.hasDeclaredExperimentalCreator(template), true);
    const quality = await server.ssrLoadModule('/src/studio/templateQuality.ts');
    assert.equal(quality.auditTemplateQuality(template).passed, true);
    assert.equal(quality.getTemplateNegativePolicy(template).declarationId, 'minimax-h3-image-no-negative-input');
    assert.equal(
      quality.getTemplateNegativePolicy({
        ...template,
        executionSelection: { ...template.executionSelection, executionProfileId: 'unreviewed-profile' },
      }).requirement,
      'required',
    );
    const backend = path.resolve('../MoDiff');
    const python =
      process.env.MODIFF_BACKEND_PYTHON ||
      path.join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const script = path.resolve('scripts/template-operation-fixtures.py');
    const fixture = JSON.parse(
      execFileSync(
        process.platform === 'win32' ? python : path.join(backend, 'scripts/with-runtime-env.sh'),
        process.platform === 'win32' ? [script, '--mock-cuda'] : [python, script, '--mock-cuda'],
        {
          cwd: backend,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          input: JSON.stringify([{ id: template.id, selection: template.executionSelection }]),
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      ),
    );
    const row = fixture.recipes[0];
    const { DEFAULT_STUDIO_FORM, STUDIO_MODEL_PROFILES } = await server.ssrLoadModule('/src/studio/modelProfiles.ts');
    const form = { ...DEFAULT_STUDIO_FORM, ...exactness.getTemplateLockedSettings(template), device: 'cuda:0' };
    const { createTemplateOperationGraph } = await server.ssrLoadModule('/src/studio/templateOperationWorkflow.ts');
    const { unpackVisualOperationGroups } = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
    const { parseOperationStarter } = await server.ssrLoadModule('/src/workflow/operationStarterRequest.ts');
    const { parseOperationContracts } = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
    const operations = parseOperationContracts(fixture.publicPayload.operationContracts, 3);
    const starter = parseOperationStarter(
      row.starter,
      template.executionSelection.pipelineClass,
      template.executionSelection.task,
      operations,
      template.executionSelection,
    );
    const capability = fixture.capabilities.find((item) => item.modelType === template.modelType);
    assert.ok(capability, 'use the actual published capability and its execution profile');
    const presentation = STUDIO_MODEL_PROFILES[template.modelType];
    assert.deepEqual(presentation.defaultSize, capability.defaultSize);
    assert.equal(presentation.defaultDtype, capability.defaultDtype);
    assert.deepEqual(presentation.offloadSupport.modes, capability.offloadSupport.modes);
    assert.equal(presentation.offloadSupport.default, 'group_disk');
    assert.equal(presentation.autoEligible, false);
    assert.equal(presentation.galleryEligible, false);
    const graph = createTemplateOperationGraph(template, form, starter, fixture.registry, row.spec, capability);
    const flat = unpackVisualOperationGroups(graph).graph;
    const stage = (action) => flat.nodes.find((node) => node.data.action === action);
    assert.deepEqual(
      flat.nodes.map((node) => node.data.action).sort(),
      ['ModelsLoader', 'Preview', 'WorkflowDecodeImage', 'WorkflowImageDenoise', 'WorkflowTextEncode'].sort(),
    );
    assert.equal(stage('WorkflowTextEncode').data.params.prompt.value, template.prompt);
    assert.deepEqual(stage('WorkflowImageDenoise').data.params.seed.value, { value: 11426, isRandom: false });
    assert.equal(stage('WorkflowImageDenoise').data.params.width.value, 2048);
    assert.equal(stage('WorkflowImageDenoise').data.params.height.value, 2048);
    assert.equal(
      stage('WorkflowImageDenoise').data.params.min_generation_area.value ??
        stage('WorkflowImageDenoise').data.params.min_generation_area.default,
      4194304,
    );
    for (const field of ['num_inference_steps', 'guidance_scale', 'strength'])
      assert.equal(Object.hasOwn(stage('WorkflowImageDenoise').data.params, field), false);
    assert.equal(stage('ModelsLoader').data.params.revision.value, '492fd8c4eca666f1085f57e30738c1e0d86b3439');
    assert.equal(stage('ModelsLoader').data.params.offload_mode.value, 'group_disk');
    assert.equal(capability.autoEligible, false);
    assert.equal(capability.galleryEligible, false);
  } finally {
    await server.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
