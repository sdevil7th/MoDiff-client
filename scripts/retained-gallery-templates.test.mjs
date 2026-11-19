import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { canonicalGraphIdentity } from './live-proof-provenance.mjs';

const client = resolve(import.meta.dirname, '..');
const backend = resolve(process.env.MODIFF_BACKEND_DIR || join(client, '../MoDiff'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
let server, recipes, fixture, studio, flow, nodeStore, graphBridge, published;

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
  ({ STUDIO_TEMPLATES: published } = await server.ssrLoadModule('/src/studio/templates.ts'));
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

function retainedTemplateGraph(recipe) {
  const manifest = JSON.parse(readFileSync(join(backend, 'data/workflow-library-manifest.json'), 'utf8'));
  const { template } = recipe;
  const row = manifest.workflows.find((item) => item.id === recipe.workflowId);
  assert.equal(row.sourceTemplateId, recipe.sourceTaskTemplateId);
  assert.equal(row.modelType, template.modelType);
  assert.equal(row.mode, template.mode);
  assert.ok(!published.some((item) => item.id === template.id));

  const graph = JSON.parse(readFileSync(join(backend, 'data/graphs', row.graphPath), 'utf8'));
  const api = flow.getState().exportGraph('retained-template-check', undefined, {
    sourceGraph: graph,
    randomizeSeeds: false,
  });
  const node = Object.values(api.nodes).find((item) => item.action === (recipe.inputSha256 ? 'Load' : 'GenerateText'));
  if (recipe.inputSha256) {
    assert.equal(template.inputBindings[0].origin, 'user');
    assert.match(recipe.inputSha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(node.params.file.value, []);
    node.params.file.value = [recipe.inputFileName];
  } else {
    assert.equal(recipe.promptSha256, sha256(template.prompt));
    assert.equal(node.params.prompt.value, '');
    node.params.prompt.value = template.prompt;
  }
  return canonicalGraphIdentity(api);
}

test('retained Gallery recipes preserve the native graph identities and standalone skeletons', () => {
  for (const recipe of recipes) {
    assert.equal(retainedTemplateGraph(recipe).hash, recipe.retainedGraphHash, recipe.template.id);
  }
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
        assert.equal(payload.action, 'PredictMap');
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
      const input = recipe.inputSha256 ? ['@data/images/sha256-bound-ramp.png'] : [];
      const tabId = studio.getState().createWorkflowTab(template.label, undefined, 'template', template.id);
      studio.getState().applyTemplate(template, { referenceImages: input });
      const form = studio.getState().form;
      assert.equal(form.device, 'cuda:0');
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
      const loader = api.nodes[binding.nodes[spec.roles.find(([, key]) => key.endsWith('.' + spec.loaderAction))[0]]];
      assert.deepEqual(loader.params.model_id.value, { source: 'hub', value: template.modelArtifact.value });
      assert.equal(loader.params.revision.value, template.modelArtifact.revision);
      assert.equal(loader.params.dtype.value, 'float32');
      assert.equal(loader.params.quantization_mode.value, 'none');
      assert.equal(loader.params.device.value, 'cuda:0');
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
