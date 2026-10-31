import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, requests, contracts, fixture, hashes;
const selection = {
  pipelineClass: 'ZImageModularPipeline',
  task: 'text_to_image',
  executionProfileId: 'z-image:modular',
  authoringRecipeId: 'retained-z-image-text-to-image:v1',
  bindingSpec: { modelType: 'ZImageModularPipeline', mode: 'modular_text_to_image' },
};
const auxiliarySelections = [
  {
    id: 'qwen_control_image_layout',
    selection: {
      pipelineClass: 'QwenImageModularPipeline',
      task: 'control_image',
      executionProfileId: 'qwen-image:modular',
      authoringRecipeId: 'generic-native-image:v1',
      bindingSpec: { modelType: 'QwenImageModularPipeline', mode: 'control_image' },
    },
  },
  ...['control_image', 'control_edit_image', 'control_inpaint'].map((mode) => ({
    id: `sdxl-authoring-${mode}`,
    selection: {
      pipelineClass: 'StableDiffusionXLModularPipeline',
      task: mode,
      executionProfileId: 'sdxl-base:modular',
      authoringRecipeId: 'generic-native-image:v1',
      bindingSpec: { modelType: 'StableDiffusionXLModularPipeline', mode },
    },
  })),
];
before(async () => {
  globalThis.window = { location: { origin: 'http://127.0.0.1:5191' } };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  requests = await server.ssrLoadModule('/src/workflow/operationStarterRequest.ts');
  hashes = await server.ssrLoadModule('/src/studio/stableHash.ts');
  const operations = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  const backend = path.resolve('../MoDiff');
  const python = process.env.MODIFF_BACKEND_PYTHON || path.join(backend, '.venv', 'Scripts/python.exe');
  fixture = JSON.parse(
    execFileSync(python, [path.resolve('scripts/template-operation-fixtures.py')], {
      cwd: backend,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      input: JSON.stringify([{ id: 'z_image_quick_concept', selection }, ...auxiliarySelections]),
    }),
  );
  contracts = operations.parseOperationContracts(
    fixture.publicPayload.operationContracts,
    fixture.publicPayload.operationContractSchemaVersion,
  );
});

test('protects auxiliary model identity while keeping declared Qwen and SDXL Control bindings', async (t) => {
  const { STUDIO_TEMPLATES } = await server.ssrLoadModule('/src/studio/templates.ts');
  const { DEFAULT_STUDIO_FORM } = await server.ssrLoadModule('/src/studio/modelProfiles.ts');
  const { getTemplateLockedSettings } = await server.ssrLoadModule('/src/studio/templateExactness.ts');
  const { createTemplateOperationGraph } = await server.ssrLoadModule('/src/studio/templateOperationWorkflow.ts');
  const { resolveStudioExecutionSpecValues } = await server.ssrLoadModule('/src/studio/executionSpecValues.ts');
  const groups = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  for (const item of auxiliarySelections)
    await t.test(item.id, () => {
      const row = fixture.recipes.find((row) => row.id === item.id);
      const template = structuredClone(STUDIO_TEMPLATES.find((item) => item.id === 'qwen_control_image_layout'));
      template.id = item.id;
      template.modelType = item.selection.bindingSpec.modelType;
      template.mode = item.selection.bindingSpec.mode;
      template.executionSelection = item.selection;
      delete template.modelArtifact;
      delete template.example.modelRevision;
      if (item.id !== 'qwen_control_image_layout') delete template.example;
      const device = row.starter.nodes.find((node) => node.operation.decomposition === 'loader').node.params.device;
      const form = {
        ...DEFAULT_STUDIO_FORM,
        ...(item.id === 'qwen_control_image_layout' ? getTemplateLockedSettings(template) : {}),
        modelType: template.modelType,
        mode: template.mode,
        device: device.value ?? device.default,
        autoOffload: false,
        offloadMode: 'none',
        prompt: 'Creative text must never replace a model identity',
        negativePrompt: 'Creative exclusions must never replace a variant',
        controlImage: 'control.png',
        referenceImages: ['source.png'],
        maskImage: 'mask.png',
      };
      const materialize = (raw) => {
        const starter = requests.parseOperationStarter(
          raw,
          item.selection.pipelineClass,
          item.selection.task,
          contracts,
          item.selection,
        );
        return groups.unpackVisualOperationGroups(
          createTemplateOperationGraph(template, form, starter, fixture.registry, row.spec, row.capability),
        ).graph;
      };
      const valid = materialize(row.starter);
      const owner = valid.nodes.find((node) => node.data.action === 'ModelsLoader');
      const auxiliary = valid.nodes.find((node) => node.data.action === 'AutoModelLoader');
      const expected = resolveStudioExecutionSpecValues(form, row.spec, row.capability, {
        defaultModelRevision: owner.data.params.revision.value,
      });
      for (const [, field, source] of row.spec.bindings.filter(
        ([role, field]) =>
          role === 'controlnetModel' && ['model_type', 'model_id', 'variant', 'revision'].includes(field),
      )) {
        const actual = auxiliary.data.params[field].value;
        assert.deepEqual(
          field === 'model_id' && typeof expected[source] === 'string' ? actual.value : actual,
          expected[source],
        );
      }
      const rehash = (raw) => {
        const { contentHash: _hash, ...semantic } = raw.authoring;
        raw.authoring.contentHash = `studio-authoring-v1-${hashes.hashString(hashes.stableStringify(semantic))}`;
        return raw;
      };
      const baseRevisionSource = row.spec.bindings.find(
        ([role, field]) => role === 'controlnetModel' && field === 'revision',
      )[2];
      for (const [field, source] of [
        ['revision', 'prompt'],
        ['variant', 'negativePrompt'],
        ['trust_remote_code', 'true'],
        ['revision', baseRevisionSource === 'revision' ? 'controlnetRevision' : 'revision'],
      ]) {
        const changed = structuredClone(row.starter);
        changed.authoring.bindings.find(([role, name]) => role === 'controlnetModel' && name === field)[2] = source;
        assert.throws(() => materialize(rehash(changed)), /identity/, `${field} must reject ${source}`);
      }
      const literal = structuredClone(row.starter);
      literal.authoring.bindings = literal.authoring.bindings.filter(
        ([role, field]) => role !== 'controlnetModel' || field !== 'variant',
      );
      literal.authoring.initialValues.push(['controlnetModel', 'variant', 'fp16']);
      assert.throws(() => materialize(rehash(literal)), /identity/);
    });
});
after(async () => server?.close());

test('accepts the exact backend-declared fresh recipe and preserves its provenance', () => {
  const raw = fixture.recipes[0].starter;
  const parsed = requests.parseOperationStarter(raw, selection.pipelineClass, selection.task, contracts, selection);
  assert.deepEqual(parsed.authoring, raw.authoring);
});

test('rejects unsolicited, mismatched, mutated and unbounded recipe declarations', () => {
  const raw = fixture.recipes[0].starter;
  assert.throws(() => requests.parseOperationStarter(raw, selection.pipelineClass, selection.task, contracts));
  for (const [index, change] of [
    (recipe) => {
      recipe.id = 'other:v1';
    },
    (recipe) => {
      recipe.executionProfileIds = ['wrong:profile'];
    },
    (recipe) => {
      recipe.roles[0][0] = 'invented';
    },
    (recipe) => {
      recipe.roles[0][2] = Infinity;
    },
    (recipe) => {
      recipe.bindings[0][2] = 'arbitraryExpression';
    },
    (recipe) => {
      recipe.initialValues[0][2] = { executable: 'code' };
    },
    (recipe) => {
      recipe.initialValues.push(recipe.initialValues[0]);
    },
    (recipe) => {
      recipe.extra = true;
    },
    (recipe) => {
      recipe.contentHash = 'studio-authoring-v1-deadbeef';
    },
  ].entries()) {
    const changed = structuredClone(raw);
    change(changed.authoring);
    // Structural validation must reject invalid data even when its sender
    // recomputes this provenance checksum. It is not a trust signature.
    if (index < 8) {
      const { contentHash: _hash, ...semantic } = changed.authoring;
      changed.authoring.contentHash = `studio-authoring-v1-${hashes.hashString(hashes.stableStringify(semantic))}`;
    }
    assert.throws(() =>
      requests.parseOperationStarter(changed, selection.pipelineClass, selection.task, contracts, selection),
    );
  }
  const absent = structuredClone(raw);
  delete absent.authoring;
  assert.throws(() =>
    requests.parseOperationStarter(absent, selection.pipelineClass, selection.task, contracts, selection),
  );
  const wrongWorkflow = structuredClone(raw);
  wrongWorkflow.workflowId = 'another_workflow';
  assert.throws(() =>
    requests.parseOperationStarter(wrongWorkflow, selection.pipelineClass, selection.task, contracts, selection),
  );
});

test('materializes backend bindings independently of template identity and rejects stale base specifications', async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window.localStorage = globalThis.localStorage;
  globalThis.window.dispatchEvent = () => true;
  const { STUDIO_TEMPLATES } = await server.ssrLoadModule('/src/studio/templates.ts');
  const { DEFAULT_STUDIO_FORM } = await server.ssrLoadModule('/src/studio/modelProfiles.ts');
  const { createTemplateOperationGraph } = await server.ssrLoadModule('/src/studio/templateOperationWorkflow.ts');
  const groups = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const template = structuredClone(STUDIO_TEMPLATES.find((item) => item.id === 'z_image_quick_concept'));
  template.id = 'future-template-identity';
  template.executionSelection = { ...template.executionSelection, ...selection };
  const row = fixture.recipes[0];
  const starter = requests.parseOperationStarter(
    row.starter,
    selection.pipelineClass,
    selection.task,
    contracts,
    selection,
  );
  const form = {
    ...DEFAULT_STUDIO_FORM,
    modelType: selection.bindingSpec.modelType,
    mode: selection.bindingSpec.mode,
    device: 'cpu',
    guidanceScale: 5,
  };
  const graph = createTemplateOperationGraph(template, form, starter, fixture.registry, row.spec, row.capability);
  const flat = groups.unpackVisualOperationGroups(graph).graph;
  const owner = flat.nodes.find((node) => node.data.action === 'ModelsLoader');
  const guider = flat.nodes.find((node) => node.data.action === 'Guider');
  assert.equal(owner.data.params.attention_backend.value, 'auto');
  assert.equal(guider.data.params.guidance_scale.value, 5);
  assert.equal(guider.data.params.use_original_formulation.value, true);
  assert.throws(
    () =>
      createTemplateOperationGraph(
        template,
        form,
        starter,
        fixture.registry,
        { ...row.spec, contentHash: 'studio-spec-v1-deadbeef' },
        row.capability,
      ),
    /stale/,
  );
  const corrupt = structuredClone(starter);
  corrupt.authoring.initialValues.push(['guider', 'guidance_scale', 1000]);
  assert.throws(
    () => createTemplateOperationGraph(template, form, corrupt, fixture.registry, row.spec, row.capability),
    /incompatible/,
  );
  for (const [role, field, source] of [
    ['models', 'revision', 'prompt'],
    ['guider', 'enabled', 'guidanceScale'],
    ['guider', 'guider', 'prompt'],
    ['prompt', 'prompt', 'guidanceScale'],
    ['guider', 'guider_out', 'prompt'],
    ['prompt', '__proto__', 'prompt'],
    ['prompt', 'constructor', 'prompt'],
  ]) {
    const changed = structuredClone(row.starter);
    changed.authoring.initialValues = changed.authoring.initialValues.filter(([r, f]) => r !== role || f !== field);
    changed.authoring.bindings = changed.authoring.bindings.filter(([r, f]) => r !== role || f !== field);
    changed.authoring.bindings.push([role, field, source]);
    const { contentHash: _hash, ...semantic } = changed.authoring;
    changed.authoring.contentHash = `studio-authoring-v1-${hashes.hashString(hashes.stableStringify(semantic))}`;
    const parsed = requests.parseOperationStarter(
      changed,
      selection.pipelineClass,
      selection.task,
      contracts,
      selection,
    );
    assert.throws(
      () => createTemplateOperationGraph(template, form, parsed, fixture.registry, row.spec, row.capability),
      /identity|incompatible|not declared/,
      `must reject ${role}.${field} bound to ${source}`,
    );
  }
  for (const [role, field, value] of [
    ['prompt', '__proto__', 'unsafe'],
    ['prompt', 'constructor', 'unsafe'],
    ['guider', 'guidance_scale', '5'],
    ['guider', 'enabled', 1],
  ]) {
    const changed = structuredClone(starter);
    changed.authoring.initialValues.push([role, field, value]);
    assert.throws(
      () => createTemplateOperationGraph(template, form, changed, fixture.registry, row.spec, row.capability),
      /incompatible|not declared/,
      `must reject ${role}.${field} literal ${value}`,
    );
  }
  assert.equal(Object.prototype.value, undefined, 'Inherited names must never mutate the parameter prototype.');
  assert.throws(
    () =>
      createTemplateOperationGraph(
        template,
        { ...form, guidanceScale: 1000 },
        starter,
        fixture.registry,
        row.spec,
        row.capability,
      ),
    /incompatible/,
  );

  const withVariant = structuredClone(starter);
  const variantOwner = withVariant.nodes.find((item) => item.operation.decomposition === 'loader');
  variantOwner.node.params.reviewed_variant = {
    type: 'string',
    options: ['pinned_variant', 'another_variant'],
    value: 'pinned_variant',
  };
  variantOwner.operation.binding.values.reviewed_variant = 'pinned_variant';
  withVariant.authoring.bindings.push(['models', 'reviewed_variant', 'modelVariant']);
  const preserved = groups.unpackVisualOperationGroups(
    createTemplateOperationGraph(template, form, withVariant, fixture.registry, row.spec, row.capability),
  ).graph;
  assert.equal(
    preserved.nodes.find((node) => node.data.action === 'ModelsLoader').data.params.reviewed_variant.value,
    'pinned_variant',
  );
  const variantBinding = structuredClone(withVariant);
  variantBinding.authoring.bindings.find(([, field]) => field === 'reviewed_variant')[2] = 'prompt';
  assert.throws(
    () => createTemplateOperationGraph(template, form, variantBinding, fixture.registry, row.spec, row.capability),
    /identity/,
  );
  const variantLiteral = structuredClone(withVariant);
  variantLiteral.authoring.bindings = variantLiteral.authoring.bindings.filter(
    ([, field]) => field !== 'reviewed_variant',
  );
  variantLiteral.authoring.initialValues.push(['models', 'reviewed_variant', 'another_variant']);
  assert.throws(
    () => createTemplateOperationGraph(template, form, variantLiteral, fixture.registry, row.spec, row.capability),
    /identity/,
  );

  const nullable = structuredClone(starter);
  const nullableGuider = nullable.nodes.find((item) => item.operation.operationId === 'diffusion.guidance');
  nullableGuider.node.params.optional_strength = { type: 'float', default: null };
  nullable.authoring.bindings.push(['guider', 'optional_strength', 'paddingMaskCrop']);
  const nullableGraph = groups.unpackVisualOperationGroups(
    createTemplateOperationGraph(template, form, nullable, fixture.registry, row.spec, row.capability),
  ).graph;
  assert.equal(
    nullableGraph.nodes.find((node) => node.data.action === 'Guider').data.params.optional_strength.value,
    null,
  );
  nullableGuider.node.params.optional_strength.required = true;
  assert.throws(
    () => createTemplateOperationGraph(template, form, nullable, fixture.registry, row.spec, row.capability),
    /incompatible/,
  );

  const withLora = structuredClone(template);
  withLora.workflowBlocks = ['lora'];
  withLora.workflowBlockSettings = {
    lora: {
      model: { source: 'hub', value: 'org/Adapter', revision: 'a'.repeat(40), sha256: 'b'.repeat(64) },
      scale: 0.7,
      weightName: 'adapter_model.safetensors',
    },
  };
  const loraGraph = groups.unpackVisualOperationGroups(
    createTemplateOperationGraph(withLora, form, starter, fixture.registry, row.spec, row.capability),
  ).graph;
  const adapter = loraGraph.nodes.find((node) => node.data.action === 'Lora');
  assert.deepEqual(adapter.data.params.model.value, { source: 'hub', value: 'org/Adapter' });
  const localOnlyRegistry = structuredClone(fixture.registry);
  localOnlyRegistry['modules.ModularDiffusers.Lora'].params.model.fieldOptions.sources = ['local'];
  assert.throws(
    () => createTemplateOperationGraph(withLora, form, starter, localOnlyRegistry, row.spec, row.capability),
    /incompatible/,
  );
});
