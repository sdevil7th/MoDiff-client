import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import retainedGalleryAuthoringArchives from '../config/retained-gallery-authoring-archives.v1.json' with { type: 'json' };
import { canonicalJsonHash } from './canonical-json.mjs';
import { canonicalGraphIdentity } from './live-proof-provenance.mjs';
import { readCanonicalEvidenceFile } from './release-contract-core.mjs';
import { selectCanonicalWorkflowSources } from './workflow-library-manifest-state.mjs';

const client = resolve(import.meta.dirname, '..');
const backend = resolve(process.env.MODIFF_BACKEND_DIR || join(client, '../MoDiff'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
let server, recipes, fixture, studio, flow, nodeStore, graphBridge, published, exactness, approvedBatchIds;

before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    location: { origin: 'http://127.0.0.1:5191' },
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.localStorage,
    dispatchEvent: () => true,
    setTimeout: globalThis.setTimeout,
  };
  server = await createServer({
    root: client,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  ({ RETAINED_GALLERY_TEMPLATES: recipes } = await server.ssrLoadModule('/src/studio/retainedGalleryTemplates.ts'));
  const { APPROVED_RETAINED_BATCH } = await server.ssrLoadModule('/src/studio/retainedGalleryApprovedBatch.ts');
  approvedBatchIds = new Set(APPROVED_RETAINED_BATCH.map(({ template }) => template.id));
  ({ STUDIO_TEMPLATES: published } = await server.ssrLoadModule('/src/studio/templates.ts'));
  exactness = await server.ssrLoadModule('/src/studio/templateExactness.ts');
  ({ useStudioStore: studio } = await server.ssrLoadModule('/src/stores/useStudioStore.ts'));
  ({ useFlowStore: flow } = await server.ssrLoadModule('/src/stores/useFlowStore.ts'));
  ({ useNodesStore: nodeStore } = await server.ssrLoadModule('/src/stores/useNodeStore.ts'));
  graphBridge = await server.ssrLoadModule('/src/studio/graphBridge.ts');
  const python =
    process.env.MODIFF_BACKEND_PYTHON ||
    join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const script = join(client, 'scripts/template-operation-fixtures.py');
  const args = [script, '--mock-cuda', '--studio-spec-only'];
  fixture = JSON.parse(
    execFileSync(
      process.platform === 'win32' ? python : join(backend, 'scripts/with-runtime-env.sh'),
      process.platform === 'win32' ? args : [python, ...args],
      {
        cwd: backend,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, MODIFF_BACKEND_DIR: backend },
        input: JSON.stringify(
          recipes.map(({ template: { id, modelType, mode } }) => ({
            id,
            selection: { bindingSpec: { modelType, mode } },
          })),
        ),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ),
  );
});

after(async () => {
  await server?.close();
});

const authorsAudioFixture = 'review-source-audio.wav';

function retainedTemplateGraph(recipe, sourceValue = recipe.inputFileName ?? authorsAudioFixture) {
  const manifest = JSON.parse(readFileSync(join(backend, 'data/workflow-library-manifest.json'), 'utf8'));
  const { template } = recipe;
  const row = manifest.workflows.find((item) => item.id === recipe.workflowId);
  assert.equal(row.sourceTemplateId, recipe.sourceTaskTemplateId);
  assert.equal(row.modelType, template.modelType);
  assert.equal(row.mode, template.mode);

  const graph = JSON.parse(readFileSync(join(backend, 'data/graphs', row.graphPath), 'utf8'));
  const api = flow.getState().exportGraph('retained-template-check', undefined, {
    sourceGraph: graph,
    randomizeSeeds: false,
  });
  const nodes = Object.values(api.nodes);
  if (recipe.inputSha256) {
    const [binding] = template.inputBindings;
    const audio = binding.mediaType === 'audio';
    assert.equal(binding.origin, 'user');
    assert.match(recipe.inputSha256, /^[a-f0-9]{64}$/u);
    const source = nodes.find(
      (node) => node.module === (audio ? 'modules.Audio' : 'modules.Image') && node.action === 'Load',
    );
    assert.deepEqual(source.params.file.value, audio ? '' : []);
    source.params.file.value = [sourceValue];
  }
  if (recipe.promptSha256) {
    assert.equal(recipe.promptSha256, sha256(template.prompt));
    const promptNode = nodes.find((node) => node.action === (template.mode === 'edit_image' ? 'Edit' : 'GenerateText'));
    assert.equal(promptNode.params.prompt.value, '');
    promptNode.params.prompt.value = template.prompt;
    if (template.modelType === 'SanaSprintPipeline' && template.mode === 'edit_image') {
      assert.equal(promptNode.params.strength.value, 0.5);
      assert.equal(template.example.lockedSettings.strength, 0.75);
      promptNode.params.strength.value = template.example.lockedSettings.strength;
    }
  }
  return canonicalGraphIdentity(api);
}

test('retained Gallery recipes preserve the native graph identities and standalone skeletons', () => {
  const skeletons = recipes.map(({ sourceTaskTemplateId, template }) => ({
    id: sourceTaskTemplateId,
    modelType: template.modelType,
    mode: template.mode,
  }));
  const sources = selectCanonicalWorkflowSources(
    published,
    skeletons,
    new Set(recipes.map(({ template }) => template.id)),
  );
  for (const recipe of recipes) {
    const { template, reviewedCatalogLock } = recipe;
    const settings = exactness.getTemplateLockedSettings(template);
    assert.equal(published.filter((item) => item.id === template.id).length, 1);
    assert.equal(
      published.find((item) => item.id === template.id),
      template,
    );
    assert.equal(canonicalJsonHash({ template, settings }), recipe.reviewedTemplateSha256);
    assert.equal(exactness.getTemplateLockHash(template), reviewedCatalogLock.templateLockHash);
    assert.equal(
      exactness.getTemplateLockHash(template, `${template.modelArtifact.value}@${template.modelArtifact.revision}`),
      reviewedCatalogLock.galleryTemplateLockHash,
    );
    assert.equal(exactness.getPromptSettingsHash(settings), reviewedCatalogLock.promptSettingsHash);
    if (recipe.inputSha256) assert.equal(exactness.getTemplateInputContractHash(template), undefined);
    assert.deepEqual(sources.get(`${template.modelType}|${template.mode}`), {
      ...skeletons.find(({ id }) => id === recipe.sourceTaskTemplateId),
      taskContract: true,
    });
    if (approvedBatchIds.has(template.id)) {
      const authoringArchive = retainedGalleryAuthoringArchives[recipe.workflowId];
      assert.equal(authoringArchive.descriptorSha256, recipe.originalReceiptSha256);
      assert.ok(authoringArchive.bytes > 0);
      assert.match(authoringArchive.sha256, /^[a-f0-9]{64}$/u);
      const evidenceRoot = join(
        backend,
        'data/qualification/release/canonical-workflow-evidence',
        recipe.originalReceiptSha256,
      );
      const evidenceFile = join(evidenceRoot, 'evidence.json');
      if (recipe.promptSha256 !== undefined) assert.equal(sha256(template.prompt), recipe.promptSha256);
      if (existsSync(evidenceFile)) {
        const originalAuthoring = readCanonicalEvidenceFile(evidenceRoot, {
          path: 'authoring-spec.original.json',
          bytes: authoringArchive.bytes,
          sha256: authoringArchive.sha256,
        });
        assert.equal(JSON.parse(originalAuthoring.bytes).canonicalWorkflowId, recipe.workflowId);
        const bytes = readFileSync(evidenceFile);
        assert.equal(sha256(bytes), recipe.originalReceiptSha256);
        const descriptor = JSON.parse(bytes);
        const capture = descriptor.capture
          ? JSON.parse(readCanonicalEvidenceFile(evidenceRoot, descriptor.capture).bytes)
          : descriptor;
        const saved = JSON.parse(readCanonicalEvidenceFile(evidenceRoot, capture.creatorPackage).bytes);
        const api = flow.getState().exportGraph('retained-batch-check', undefined, {
          sourceGraph: saved.graph,
          randomizeSeeds: false,
        });
        assert.equal(canonicalGraphIdentity(api).hash, recipe.retainedGraphHash, template.id);
        assert.deepEqual(
          capture.inputs.map(({ file }) => file.sha256),
          [recipe.inputSha256, recipe.maskSha256].filter(Boolean),
        );
      }
    } else if (recipe.inputLocatorSha256) {
      const evidenceRoot = join(
        backend,
        'data/qualification/release/canonical-workflow-evidence',
        recipe.originalReceiptSha256,
      );
      const evidenceFile = join(evidenceRoot, 'evidence.json');
      assert.match(recipe.inputLocatorSha256, /^[a-f0-9]{64}$/u);
      assert.equal(recipe.inputFileName, undefined);
      // Repository CI has no private source. The browser-form checks below
      // can use a synthetic picker string without exposing the real locator.
      if (existsSync(evidenceFile)) {
        const bytes = readFileSync(evidenceFile);
        assert.equal(sha256(bytes), recipe.originalReceiptSha256);
        const { capture } = JSON.parse(bytes);
        const { inputs } = JSON.parse(readCanonicalEvidenceFile(evidenceRoot, capture).bytes);
        assert.equal(inputs.length, 1);
        assert.equal(sha256(inputs[0].sourceValue), recipe.inputLocatorSha256);
        assert.equal(retainedTemplateGraph(recipe, inputs[0].sourceValue).hash, recipe.retainedGraphHash, template.id);
      }
    } else {
      assert.equal(retainedTemplateGraph(recipe).hash, recipe.retainedGraphHash, template.id);
    }
  }
  assert.ok(!published.some((item) => ['PixArtSigmaPAGPipeline', 'ShapEPipeline'].includes(item.modelType)));
});

test('fresh Expert recipes prepare with current backend specs and without a generation request', async () => {
  const previousFetch = globalThis.fetch;
  const previousWebSocket = globalThis.WebSocket;
  const previousStudio = studio.getState();
  const previousFlow = flow.getState();
  const previousNodes = nodeStore.getState();
  let contract;
  const fieldActions = [];
  try {
    globalThis.WebSocket = undefined;
    globalThis.fetch = async (request, options) => {
      assert.ok(
        String(request).endsWith('/fields/action'),
        'Only metadata actions belong in the offline authoring test.',
      );
      const payload = JSON.parse(options.body);
      fieldActions.push(payload.fn);
      assert.equal(payload.module, 'modules.DiffusersImage');
      assert.ok(contract);
      if (payload.fn === 'update_pipeline_contract') {
        assert.equal(payload.action, 'LoadPipeline');
        assert.equal(payload.values.pipeline_class, contract.pipelineClass);
        assert.equal(payload.values.mode, contract.mode);
        flow.getState().setParam(payload.node, 'pipeline', { direction: 'output', value: contract }, 'signal');
      } else {
        assert.equal(payload.fn, 'update_image_contract');
        assert.ok(['PredictMap', 'Edit', 'Generate', 'Inpaint', 'UnconditionalGenerate'].includes(payload.action));
        assert.deepEqual(payload.values.image_contract, contract);
      }
      return Response.json({ error: false, nodes: [] });
    };
    nodeStore.setState({
      nodesRegistry: fixture.registry,
      studioModelCapabilities: fixture.capabilities,
      studioModelCapabilitiesAuthoritative: true,
      studioExecutionSpecInvalid: false,
    });
    for (const recipe of recipes) {
      const { template } = recipe;
      const { spec, imageContract } = fixture.recipes.find((item) => item.id === template.id);
      contract = imageContract;
      const inputBinding = template.inputBindings?.[0];
      const audio = inputBinding?.mediaType === 'audio';
      const input = recipe.inputSha256
        ? [recipe.inputFileName ?? (audio ? authorsAudioFixture : 'review-source-image.png')]
        : [];
      const mask = recipe.maskSha256 ? 'review-mask-image.png' : undefined;
      const tabId = studio.getState().createWorkflowTab(template.label, undefined, 'template', template.id);
      studio
        .getState()
        .applyTemplate(
          template,
          audio ? { sourceAudio: input[0] } : { referenceImages: input, ...(mask && { maskImage: mask }) },
        );
      const form = studio.getState().form;
      assert.equal(form.device, template.example.lockedSettings.device ?? 'cuda:0');
      assert.equal(form.resourceMode, 'expert');
      assert.equal(form.randomSeed, false);
      await graphBridge.createOrUpdateStudioGraph(form, undefined, 3000).catch((error) => {
        assert.fail(
          `${template.id}: ${error.message}: ${JSON.stringify({
            finalization: studio.getState().graphFinalization,
            nodes: flow.getState().nodes.map((node) => [node.data.studioRole, node.data.action]),
            edges: flow.getState().edges.map(({ sourceHandle, targetHandle }) => [sourceHandle, targetHandle]),
          })}`,
        );
      });
      const binding = studio.getState().graphBinding;
      assert.equal(binding.executionSpec.contentHash, spec.contentHash);
      assert.equal(studio.getState().activeWorkflowTabId, tabId);
      const api = flow.getState().exportGraph('retained-template-check', undefined, { randomizeSeeds: false });
      if (template.modelType === 'SpandrelImageUpscale') {
        const source = api.nodes[binding.nodes.loadImage].params;
        const upscaler = api.nodes[binding.nodes.imageUpscaler].params;
        const preview = api.nodes[binding.nodes.preview].params;
        assert.deepEqual(source.file.value, input);
        assert.equal(source.alpha_channel.value, 'ignore');
        const { value, ...artifact } = template.modelArtifact;
        assert.deepEqual(upscaler.model_id.value, { ...artifact, value: `${value}/RealESRGAN_x2plus.pth` });
        assert.equal(upscaler.tile_size.value, 256);
        assert.equal(upscaler.tile_overlap.value, 32);
        assert.equal(upscaler.downscale.value, 1);
        assert.equal(upscaler.device.value, 'cuda:0');
        assert.equal(upscaler.image.sourceId, binding.nodes.loadImage);
        assert.equal(upscaler.image.sourceKey, 'image');
        assert.equal(preview.image.sourceId, binding.nodes.imageUpscaler);
        assert.equal(preview.image.sourceKey, 'output');
        const comparable = structuredClone(api);
        comparable.nodes[binding.nodes.loadImage].params.file.value = [recipe.inputFileName];
        assert.deepEqual(canonicalGraphIdentity(comparable), retainedTemplateGraph(recipe));
        continue;
      }
      const loader = api.nodes[binding.nodes[spec.roles.find(([, key]) => key.endsWith('.' + spec.loaderAction))[0]]];
      assert.deepEqual(loader.params.model_id.value, { source: 'hub', value: template.modelArtifact.value });
      assert.equal(loader.params.revision.value, template.modelArtifact.revision);
      assert.equal(loader.params.dtype.value, template.example.lockedSettings.dtype ?? 'float32');
      assert.equal(loader.params.device.value, form.device);
      if (approvedBatchIds.has(template.id) && !audio) {
        const actions = Object.values(api.nodes);
        const generation = actions.find(({ action }) =>
          [
            'Generate',
            'Edit',
            'Inpaint',
            'GenerateAnyToAny',
            'GenerateImageVideoText',
            'UnconditionalGenerate',
          ].includes(action),
        );
        assert.equal(generation.params.prompt?.value ?? '', template.prompt);
        const locked = template.example.lockedSettings;
        if (generation.action === 'UnconditionalGenerate') {
          assert.equal(generation.params.num_inference_steps.value, locked.steps);
          assert.equal(Number(generation.params.seed.value), template.example.lockedSeed);
          assert.equal(generation.params.pipeline.sourceId, binding.nodes.diffusersImagePipeline);
          assert.equal(generation.params.pipeline.sourceKey, 'pipeline');
          assert.equal(generation.params.prompt, undefined);
        } else if (!['GenerateAnyToAny', 'GenerateImageVideoText'].includes(generation.action)) {
          for (const [field, control] of [
            ['width', 'width'],
            ['height', 'height'],
            ['num_inference_steps', 'steps'],
            ['guidance_scale', 'guidanceScale'],
          ]) {
            assert.equal(generation.params[field].value, locked[control], `${template.id} ${control}`);
          }
          assert.equal(Number(generation.params.seed.value), template.example.lockedSeed);
          assert.equal(loader.params.quantization_mode.value, 'none');
        }
        const sources = actions.filter(({ module, action }) => module === 'modules.Image' && action === 'Load');
        assert.equal(sources.length, input.length + Number(Boolean(mask)));
        if (input.length) assert.ok(sources.some(({ params }) => params.file.value?.includes(input[0])));
        if (mask) assert.ok(sources.some(({ params }) => params.file.value?.includes(mask)));
        continue;
      }
      if (audio) {
        const source = api.nodes[binding.nodes.loadAudio];
        // The interactive file picker supplies a local locator. The retained
        // native file evidence records the same selected file as a one-item list.
        const file = source.params.file.value;
        assert.deepEqual(typeof file === 'string' ? [file] : file, input);
        if (template.mode === 'speech_translation') {
          const consumer = Object.values(api.nodes).find(({ action }) => action === 'TranscribeAudio');
          assert.equal(consumer.params.task.value, 'translate');
          assert.equal(consumer.params.language.value, template.example.lockedSettings.speechLanguage);
          assert.equal(consumer.params.timestamps.value, 'segment');
          continue;
        }
        source.params.file.value = input;
        const withIndependentInputsOrdered = ({ canonicalGraph }) => {
          // The fresh form inserts the model before Audio Load. Both are
          // independent suppliers to Transcribe Audio.
          const { nodes, paths } = canonicalGraph;
          assert.deepEqual(
            nodes
              .slice(0, 2)
              .map(({ key }) => key)
              .sort(),
            ['modules.Audio.Load#1', 'modules.HuggingFaceSpeech.' + spec.loaderAction + '#1'],
          );
          assert.equal(paths.length, 1);
          return {
            ...canonicalGraph,
            nodes: [...nodes.slice(0, 2).sort((a, b) => a.key.localeCompare(b.key)), ...nodes.slice(2)],
            paths: [[...paths[0].slice(0, 2).sort(), ...paths[0].slice(2)]],
          };
        };
        assert.deepEqual(
          withIndependentInputsOrdered(canonicalGraphIdentity(api)),
          withIndependentInputsOrdered(retainedTemplateGraph(recipe)),
        );
        continue;
      }
      assert.equal(loader.params.quantization_mode.value, 'none');
      if (template.mode === 'edit_image') {
        const locked = template.example.lockedSettings;
        const source = api.nodes[binding.nodes.loadImage].params;
        assert.deepEqual(source.file.value, input);
        assert.equal(source.alpha_channel.value, 'ignore');
        const edit = api.nodes[binding.nodes.diffusersImageEdit].params;
        assert.deepEqual(edit.image_contract.value, contract);
        const values = Object.fromEntries(
          ['prompt', 'width', 'height', 'num_inference_steps', 'guidance_scale', 'strength', 'seed', 'output_type'].map(
            (key) => [key, edit[key].value],
          ),
        );
        assert.deepEqual(values, {
          prompt: template.prompt,
          width: locked.width,
          height: locked.height,
          num_inference_steps: locked.steps,
          guidance_scale: locked.guidanceScale,
          strength: locked.strength,
          seed: template.example.lockedSeed,
          output_type: locked.outputType,
        });
        assert.equal(edit.image.sourceId, binding.nodes.loadImage);
        assert.equal(edit.pipeline.sourceId, binding.nodes.diffusersImagePipeline);
        assert.equal(api.nodes[binding.nodes.preview].params.image.sourceId, binding.nodes.diffusersImageEdit);
        const controls = api.nodes[binding.nodes.diffusersRecipe].params;
        assert.equal(controls.offload_mode.value, locked.offloadMode);
        assert.equal(controls.attention_backend.value, 'auto');
        assert.equal(controls.vae_slicing.value, true);
        assert.equal(controls.vae_tiling.value, true);
        continue;
      }
      if (recipe.inputSha256) {
        assert.ok(fieldActions.includes('update_pipeline_contract'));
        assert.ok(fieldActions.includes('update_image_contract'));
        assert.deepEqual(api.nodes[binding.nodes.loadImage].params.file.value, input);
        const params = api.nodes[binding.nodes.diffusersPredictMap].params;
        assert.deepEqual(params.image_contract.value, contract);
        assert.equal(params.seed.value, 42);
        assert.equal(params.num_inference_steps.value, 1);
        assert.equal(params.processing_resolution.value, 768);
        assert.equal(params.match_input_resolution.value, true);
        const controls = api.nodes[binding.nodes.diffusersRecipe].params;
        assert.equal(controls.offload_mode.value, 'none');
        assert.equal(controls.attention_backend.value, 'auto');
        assert.equal(controls.vae_slicing.value, true);
        assert.equal(controls.vae_tiling.value, true);
      } else {
        const params = api.nodes[binding.nodes.transformersTextGenerate].params;
        assert.equal(params.prompt.value, template.prompt);
        assert.deepEqual(
          Object.fromEntries(
            Object.entries(params)
              .filter(([key]) => key !== 'model')
              .map(([key, param]) => [key, param.value]),
          ),
          {
            do_sample: false,
            max_new_tokens: 256,
            min_new_tokens: 0,
            num_beams: 1,
            prompt: template.prompt,
            repetition_penalty: 1,
            temperature: 1,
            top_k: 50,
            top_p: 1,
            use_chat_template: true,
          },
        );
        assert.deepEqual(JSON.parse(JSON.stringify(api.nodes[binding.nodes.transformersTextPreview].params.value)), {
          display: 'input',
          sourceId: binding.nodes.transformersTextGenerate,
          sourceKey: 'result',
        });
      }
      const comparable = structuredClone(api);
      if (recipe.inputSha256) {
        // Delivery assigns a backend-specific upload identifier after checking
        // source bytes. Compare the rest of the API using the archived picker.
        comparable.nodes[binding.nodes.loadImage].params.file.value = [recipe.inputFileName];
        const model = comparable.nodes[binding.nodes.diffusersImagePipeline].params;
        for (const name of ['control_components', 'image_prompt_adapter', 'prequantized_transformer']) {
          assert.deepEqual(model[name], { display: 'input', value: undefined }, name);
          delete model[name];
        }
        assert.equal(model.execution_profile_id.value, '');
        delete model.execution_profile_id;
        const preview = comparable.nodes[binding.nodes.preview].params;
        // Preview uses its device only for latent decoding. PredictMap
        // delivers decoded PIL images here and the VAE input is unconnected.
        assert.equal(preview.image.sourceKey, 'preview_images');
        assert.equal(preview.vae.sourceId, undefined);
        assert.equal(preview.device.value, 'cuda:0');
        preview.device.value = 'cpu:0';
      } else {
        // The retained loader preceded explicit quantization. This current
        // field was separately asserted above to keep the same native default.
        delete comparable.nodes[binding.nodes.transformersTextModel].params.quantization_mode;
      }
      const byRole = ({ nodes }) => Object.fromEntries(nodes.map((node) => [node.key, node.params]));
      assert.deepEqual(
        byRole(canonicalGraphIdentity(comparable).canonicalGraph),
        byRole(retainedTemplateGraph(recipe).canonicalGraph),
        template.id,
      );
    }
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.WebSocket = previousWebSocket;
    nodeStore.setState(previousNodes);
    studio.setState(previousStudio);
    flow.setState(previousFlow);
  }
});
