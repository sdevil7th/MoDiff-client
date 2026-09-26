import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let schema;
let registeredRoutes;
let routes;
let runtime;
let server;

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  [schema, registeredRoutes, routes, runtime] = await Promise.all([
    server.ssrLoadModule('/src/studio/blockSchemaV2.ts'),
    server.ssrLoadModule('/src/studio/registeredBlockV2Routes.ts'),
    server.ssrLoadModule('/src/studio/blockRouteSelectionV1.ts'),
    server.ssrLoadModule('/src/studio/blockRuntimeV2.ts'),
  ]);
});

after(async () => server?.close());

test('generic route sets bind unique exact admissions and retain a common media output', () => {
  const setIds = routes.REGISTERED_BLOCK_ROUTE_SETS_V1.map(({ routeSetId }) => routeSetId);
  assert.equal(new Set(setIds).size, setIds.length);
  const compiledIds = [];
  routes.REGISTERED_BLOCK_ROUTE_SETS_V1.forEach((routeSet) => {
    assert.ok(routeSet.routes.length >= 2);
    assert.ok(routeSet.routes.length <= 9, `${routeSet.routeSetId} exceeds the eight-inactive-draft limit`);
    assert.equal(new Set(routeSet.routes.map(({ key }) => key)).size, routeSet.routes.length);
    const exact = routeSet.routes.map((route) => {
      compiledIds.push(route.compiledDefinitionId);
      const matches = registeredRoutes.REGISTERED_BLOCK_V2_ROUTES.filter(
        (candidate) =>
          candidate.definitionId === route.catalogDefinitionId && candidate.admissionId === route.compiledDefinitionId,
      );
      assert.equal(matches.length, 1, `${routeSet.routeSetId}/${route.key} is not one exact registered route`);
      return matches[0];
    });
    const commonOutputs = exact
      .map(({ boundary }) => new Set(boundary.outputs.map(({ portId }) => portId)))
      .reduce((common, outputs) => new Set([...common].filter((portId) => outputs.has(portId))));
    assert.ok(commonOutputs.size > 0, `${routeSet.routeSetId} has no stable shared output socket`);
  });
  assert.equal(new Set(compiledIds).size, compiledIds.length, 'one exact admission belongs to multiple route sets');
  assert.deepEqual(setIds, [
    'diffusers.route-set:text-to-image:v1',
    'diffusers.route-set:image-to-image:v1',
    'diffusers.route-set:instruction-edit:v1',
    'diffusers.route-set:inpainting:v1',
    'diffusers.route-set:control-image:v1',
    'diffusers.route-set:text-to-video:v1',
    'diffusers.route-set:image-to-video:v1',
    'diffusers.route-set:klein-text-to-image:v1',
  ]);
});

function definition({ definitionId, pipelineClass, prompt, negativePrompt = false }) {
  const node = {
    nodeId: 'generate',
    nodeType: 'custom',
    data: {
      module: 'modules.ModularDiffusers',
      action: 'Generate',
      params: {
        prompt: { type: 'string', value: prompt },
        seed: { type: 'int', value: 1 },
        ...(negativePrompt ? { negative_prompt: { type: 'string', value: '' } } : {}),
        images: { type: 'image', display: 'output' },
      },
    },
    semanticRole: 'denoise',
  };
  const graphBody = { nodes: [node], edges: [], executionOrder: ['generate'] };
  const graph = { ...graphBody, graphHash: schema.blockGraphHashV2(graphBody) };
  const boundary = {
    mode: 'explicit',
    inputs: [
      {
        portId: 'prompt',
        label: 'Prompt',
        valueType: 'string',
        required: true,
        binding: { nodeId: 'generate', fieldOrPortId: 'prompt' },
      },
      ...(negativePrompt
        ? [
            {
              portId: 'negative_prompt',
              label: 'Negative prompt',
              valueType: 'string',
              required: false,
              binding: { nodeId: 'generate', fieldOrPortId: 'negative_prompt' },
            },
          ]
        : []),
    ],
    outputs: [
      {
        portId: 'images',
        label: 'Images',
        valueType: 'image',
        required: true,
        binding: { nodeId: 'generate', fieldOrPortId: 'images' },
      },
    ],
  };
  const controls = [
    {
      controlId: 'prompt',
      label: 'Prompt',
      binding: { nodeId: 'generate', fieldId: 'prompt' },
      valueType: 'string',
      defaultValue: prompt,
      required: true,
      order: 0,
    },
    {
      controlId: 'seed',
      label: 'Seed',
      binding: { nodeId: 'generate', fieldId: 'seed' },
      valueType: 'int',
      defaultValue: 1,
      order: 1,
    },
  ];
  const body = {
    schemaVersion: 2,
    definitionId,
    displayName: `${pipelineClass} — Text To Image`,
    source: {
      kind: 'diffusers_catalog',
      catalogCategory: 'diffusers',
      provider: 'diffusers',
      library: 'diffusers',
      libraryRevision: 'a'.repeat(40),
      pipelineClass,
      workflow: 'text2image',
      manifestDefinitionId: definitionId,
      manifestContentHash: `sha256:${pipelineClass === 'QwenImageModularPipeline' ? 'b' : 'c'}`.padEnd(71, '0'),
      executionAdmissionId: `admission:${pipelineClass}:text2image`,
    },
    graph,
    boundary,
    controls,
    previews: [{ nodeId: 'generate', outputPortId: 'images', mediaType: 'image', primary: true }],
    ownership: { kind: 'registered', definitionMutable: false },
  };
  return { ...body, contentHash: schema.blockDefinitionContentHashV2(body) };
}

function instance(definitionValue, instanceId = 'same-canvas-root') {
  return schema.createBlockInstanceV2(definitionValue, {
    instanceId,
    position: { x: 40, y: 80 },
    size: { width: 520, height: 640 },
    values: { prompt: definitionValue.controls[0].defaultValue, seed: { value: '1', isRandom: false } },
    internalLayout: { generate: { x: 30, y: 90 } },
  });
}

function fixtures() {
  const qwen = definition({
    definitionId: 'diffusers.cluster-admission:QwenImageModularPipeline:text2image:mode:text_to_image',
    pipelineClass: 'QwenImageModularPipeline',
    prompt: 'Qwen creator prompt',
    negativePrompt: true,
  });
  const flux = definition({
    definitionId: 'diffusers.cluster-admission:FluxModularPipeline:text2image:mode:text_to_image',
    pipelineClass: 'FluxModularPipeline',
    prompt: 'FLUX creator prompt',
  });
  const sdxl = definition({
    definitionId: 'diffusers.cluster-admission:StableDiffusionXLModularPipeline:text2image:mode:text_to_image',
    pipelineClass: 'StableDiffusionXLModularPipeline',
    prompt: 'SDXL creator prompt',
    negativePrompt: true,
  });
  return {
    qwen,
    flux,
    sdxl,
    qwenInstance: instance(qwen),
    fluxInstance: instance(flux, 'compiled-flux-root'),
    sdxlInstance: instance(sdxl, 'compiled-sdxl-root'),
  };
}

test('Klein text-to-image Base and Distilled have an exact bounded route set and preserve drafts', () => {
  const create = (pipelineClass, prompt) =>
    instance(
      definition({
        definitionId: `diffusers.cluster-admission:${pipelineClass}:text2image:mode:text_to_image`,
        pipelineClass,
        prompt,
      }),
    );
  const base = create('Flux2KleinBaseModularPipeline', 'A brass astrolabe on a velvet workbench.');
  const distilled = create('Flux2KleinModularPipeline', 'Distilled creator prompt');
  const before = structuredClone(base);
  const switched = routes.switchBlockRouteInstanceV1(base, 'flux2-klein', distilled);
  assert.equal(switched.routeSelection.routeSetId, 'diffusers.route-set:klein-text-to-image:v1');
  assert.equal(switched.values.prompt, base.values.prompt);
  assert.deepEqual(switched.values.seed, base.values.seed);
  assert.deepEqual(base, before);
  const edited = schema.normalizeBlockInstanceV2({
    ...switched,
    values: { ...switched.values, prompt: 'A miniature observatory beside the astrolabe.' },
  });
  const restoredBase = routes.switchBlockRouteInstanceV1(edited, 'flux2-klein-base', base);
  assert.deepEqual(restoredBase.effectiveGraph, base.effectiveGraph);
  assert.deepEqual(restoredBase.effectiveInterface, base.effectiveInterface);
  assert.deepEqual(restoredBase.values, base.values);
  const reloaded = schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(restoredBase)));
  const restoredDistilled = routes.switchBlockRouteInstanceV1(reloaded, 'flux2-klein', distilled);
  assert.deepEqual(restoredDistilled.values, edited.values);
  assert.deepEqual(restoredDistilled.definitionSnapshot, distilled.definitionSnapshot);
});

test('Qwen to FLUX to Qwen keeps one root and restores independent exact route drafts', () => {
  const { qwen, flux, qwenInstance, fluxInstance } = fixtures();
  const editedQwen = schema.normalizeBlockInstanceV2({
    ...qwenInstance,
    values: { ...qwenInstance.values, prompt: 'edited Qwen prompt', seed: { value: '42', isRandom: false } },
    customization: { ...qwenInstance.customization, state: 'parameters_changed' },
  });
  const selectedFlux = routes.switchBlockRouteInstanceV1(editedQwen, 'flux-1-dev', fluxInstance);
  assert.equal(selectedFlux.instanceId, editedQwen.instanceId);
  assert.deepEqual(selectedFlux.presentation.position, editedQwen.presentation.position);
  assert.deepEqual(selectedFlux.presentation.size, editedQwen.presentation.size);
  assert.equal(selectedFlux.definitionRef.definitionId, flux.definitionId);
  assert.equal(selectedFlux.values.prompt, 'edited Qwen prompt');
  assert.deepEqual(selectedFlux.values.seed, { value: '42', isRandom: false });
  assert.equal(selectedFlux.routeSelection.selectedRouteKey, 'flux-1-dev');
  assert.equal(
    selectedFlux.routeSelection.inactiveDrafts['qwen-image-2512'].definitionRef.definitionId,
    qwen.definitionId,
  );
  assert.deepEqual(selectedFlux.previewStates, [{ binding: flux.previews[0], status: 'idle' }]);
  assert.deepEqual(selectedFlux.authorities, []);

  const editedFlux = schema.normalizeBlockInstanceV2({
    ...selectedFlux,
    values: { ...selectedFlux.values, prompt: 'edited FLUX prompt' },
  });
  const restoredQwen = routes.switchBlockRouteInstanceV1(editedFlux, 'qwen-image-2512', qwenInstance);
  assert.equal(restoredQwen.definitionRef.definitionId, qwen.definitionId);
  assert.equal(restoredQwen.values.prompt, 'edited Qwen prompt');
  assert.deepEqual(restoredQwen.values.seed, { value: '42', isRandom: false });
  assert.equal(restoredQwen.routeSelection.selectedRouteKey, 'qwen-image-2512');
  assert.equal(restoredQwen.routeSelection.inactiveDrafts['flux-1-dev'].values.prompt, 'edited FLUX prompt');

  const restoredFlux = routes.switchBlockRouteInstanceV1(restoredQwen, 'flux-1-dev', fluxInstance);
  assert.equal(restoredFlux.values.prompt, 'edited FLUX prompt');
  assert.deepEqual(schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(restoredFlux))), restoredFlux);
});

test('an inactive route draft materializes as an independent validation-only compiler candidate', () => {
  const { qwenInstance, fluxInstance } = fixtures();
  const selectedFlux = routes.switchBlockRouteInstanceV1(qwenInstance, 'flux-1-dev', fluxInstance);
  const candidate = routes.inactiveBlockRouteDraftInstanceV1(selectedFlux, 'qwen-image-2512');
  assert.ok(candidate);
  assert.equal(candidate.instanceId, selectedFlux.instanceId);
  assert.equal(candidate.definitionRef.definitionId, qwenInstance.definitionRef.definitionId);
  assert.deepEqual(candidate.values, qwenInstance.values);
  assert.deepEqual(candidate.presentation.position, selectedFlux.presentation.position);
  assert.equal(candidate.routeSelection, undefined);
  assert.deepEqual(candidate.authorities, []);
  candidate.values.prompt = 'candidate-only edit';
  assert.equal(selectedFlux.routeSelection.inactiveDrafts['qwen-image-2512'].values.prompt, qwenInstance.values.prompt);
  assert.equal(routes.inactiveBlockRouteDraftInstanceV1(selectedFlux, 'missing-route'), null);
});

test('route switching preserves durable internal interfaces in the exact inactive draft without transplanting them', () => {
  const { qwenInstance, fluxInstance } = fixtures();
  const graph = structuredClone(qwenInstance.effectiveGraph);
  graph.nodes[0].containerInterface = {
    schemaVersion: 1,
    boundary: structuredClone(qwenInstance.effectiveInterface.boundary),
    controls: qwenInstance.effectiveInterface.controls.map((control) => {
      const local = structuredClone(control);
      delete local.defaultValue;
      return local;
    }),
  };
  graph.nodes[0].containerInterface.controls[0].label = 'My Qwen scene';
  const edited = runtime.replaceBlockEffectiveGraphV2(qwenInstance, graph);
  const flux = routes.switchBlockRouteInstanceV1(edited, 'flux-1-dev', fluxInstance);
  assert.equal(flux.effectiveGraph.nodes[0].containerInterface, undefined);
  assert.deepEqual(flux.routeSelection.inactiveDrafts['qwen-image-2512'].effectiveGraph, edited.effectiveGraph);
  const reloaded = schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(flux)));
  const restored = routes.switchBlockRouteInstanceV1(reloaded, 'qwen-image-2512', qwenInstance);
  assert.deepEqual(restored.effectiveGraph, edited.effectiveGraph);
  assert.deepEqual(restored.effectiveInterface, edited.effectiveInterface);
  assert.deepEqual(restored.values, edited.values);
});

test('Qwen, FLUX, and SDXL retain three independent drafts on one canvas root', () => {
  const { qwenInstance, fluxInstance, sdxlInstance } = fixtures();
  const qwen = schema.normalizeBlockInstanceV2({
    ...qwenInstance,
    values: { ...qwenInstance.values, prompt: 'Qwen route value' },
  });
  const flux = routes.switchBlockRouteInstanceV1(qwen, 'flux-1-dev', fluxInstance);
  const editedFlux = schema.normalizeBlockInstanceV2({
    ...flux,
    values: { ...flux.values, prompt: 'FLUX route value' },
  });
  const sdxl = routes.switchBlockRouteInstanceV1(editedFlux, 'sdxl-base-1.0', sdxlInstance);
  assert.equal(sdxl.instanceId, qwen.instanceId);
  assert.equal(sdxl.definitionRef.definitionId, sdxlInstance.definitionRef.definitionId);
  assert.equal(sdxl.values.prompt, 'FLUX route value');
  assert.deepEqual(Object.keys(sdxl.routeSelection.inactiveDrafts).sort(), ['flux-1-dev', 'qwen-image-2512']);

  const editedSdxl = schema.normalizeBlockInstanceV2({
    ...sdxl,
    values: { ...sdxl.values, prompt: 'SDXL route value' },
  });
  const restoredQwen = routes.switchBlockRouteInstanceV1(editedSdxl, 'qwen-image-2512', qwenInstance);
  assert.equal(restoredQwen.values.prompt, 'Qwen route value');
  assert.equal(restoredQwen.routeSelection.inactiveDrafts['flux-1-dev'].values.prompt, 'FLUX route value');
  assert.equal(restoredQwen.routeSelection.inactiveDrafts['sdxl-base-1.0'].values.prompt, 'SDXL route value');

  const restoredSdxl = routes.switchBlockRouteInstanceV1(restoredQwen, 'sdxl-base-1.0', sdxlInstance);
  assert.equal(restoredSdxl.values.prompt, 'SDXL route value');
  assert.equal(restoredSdxl.instanceId, qwen.instanceId);
});

test('an inactive registered draft rebases to a newer exact pin without losing compatible values or layout', () => {
  const { qwen, qwenInstance, fluxInstance } = fixtures();
  const editedQwen = schema.normalizeBlockInstanceV2({
    ...qwenInstance,
    values: { ...qwenInstance.values, prompt: 'keep this saved Qwen prompt' },
    customization: { ...qwenInstance.customization, state: 'parameters_changed' },
  });
  const selectedFlux = routes.switchBlockRouteInstanceV1(editedQwen, 'flux-1-dev', fluxInstance);

  const updatedBody = structuredClone(qwen);
  delete updatedBody.contentHash;
  updatedBody.graph.nodes[0].data.params.seed.hidden = false;
  updatedBody.graph.graphHash = schema.blockGraphHashV2({
    nodes: updatedBody.graph.nodes,
    edges: updatedBody.graph.edges,
    executionOrder: updatedBody.graph.executionOrder,
  });
  updatedBody.contentHash = schema.blockDefinitionContentHashV2(updatedBody);
  const updatedQwen = schema.normalizeBlockDefinitionV2(updatedBody);
  const restored = routes.switchBlockRouteInstanceV1(selectedFlux, 'qwen-image-2512', instance(updatedQwen));

  assert.equal(restored.definitionRef.contentHash, updatedQwen.contentHash);
  assert.equal(restored.definitionSnapshot.graph.nodes[0].data.params.seed.hidden, false);
  assert.equal(restored.values.prompt, 'keep this saved Qwen prompt');
  assert.deepEqual(restored.presentation.internalLayout.generate, { x: 30, y: 90 });
  assert.equal(restored.customization.state, 'parameters_changed');
});

test('connected common ports survive while route-only connected ports fail with a remedy', () => {
  const { qwenInstance, fluxInstance } = fixtures();
  assert.doesNotThrow(() =>
    routes.assertBlockRouteEdgesCompatibleV1(qwenInstance, fluxInstance, [
      {
        id: 'prompt-edge',
        source: 'text',
        sourceHandle: 'text',
        target: qwenInstance.instanceId,
        targetHandle: 'prompt',
      },
      {
        id: 'image-edge',
        source: qwenInstance.instanceId,
        sourceHandle: 'images',
        target: 'preview',
        targetHandle: 'images',
      },
    ]),
  );
  assert.throws(
    () =>
      routes.assertBlockRouteEdgesCompatibleV1(qwenInstance, fluxInstance, [
        {
          id: 'negative-edge',
          source: 'text',
          sourceHandle: 'text',
          target: qwenInstance.instanceId,
          targetHandle: 'negative_prompt',
        },
      ]),
    /negative_prompt is connected.*disconnect or remap/u,
  );
});

test('execution expansion emits only the selected exact route and never an inactive draft', () => {
  const { qwenInstance, fluxInstance } = fixtures();
  const editedQwen = schema.normalizeBlockInstanceV2({
    ...qwenInstance,
    values: { ...qwenInstance.values, prompt: 'inactive Qwen secret prompt' },
  });
  const selectedFlux = routes.switchBlockRouteInstanceV1(editedQwen, 'flux-1-dev', fluxInstance);
  const editedFlux = schema.normalizeBlockInstanceV2({
    ...selectedFlux,
    values: { ...selectedFlux.values, prompt: 'active FLUX execution prompt' },
  });
  const root = runtime.createBlockRootNodeV2(editedFlux);
  const expanded = runtime.expandBlockGraphV2ForExecution([root], []);
  const serialized = JSON.stringify(expanded);

  assert.equal(expanded.nodes.length, editedFlux.effectiveGraph.nodes.length);
  assert.equal(
    expanded.nodes.some((node) => node.data.blockInstanceV2),
    false,
  );
  assert.match(serialized, /active FLUX execution prompt/u);
  assert.doesNotMatch(serialized, /inactive Qwen secret prompt/u);
  assert.doesNotMatch(serialized, /routeSelection|inactiveDrafts/u);
});

test('route drafts reject recursion, mutable definitions, active-key duplication, and key drift', () => {
  const { qwenInstance, fluxInstance } = fixtures();
  const switched = routes.switchBlockRouteInstanceV1(qwenInstance, 'flux-1-dev', fluxInstance);
  const activeDuplicate = structuredClone(switched);
  activeDuplicate.routeSelection.inactiveDrafts['flux-1-dev'] =
    activeDuplicate.routeSelection.inactiveDrafts['qwen-image-2512'];
  assert.throws(() => schema.normalizeBlockInstanceV2(activeDuplicate), /must not contain the selected active route/u);

  const keyDrift = structuredClone(switched);
  keyDrift.routeSelection.inactiveDrafts['qwen-image-2512'].routeKey = 'another-key';
  assert.throws(() => schema.normalizeBlockInstanceV2(keyDrift), /routeKey must match/u);

  const recursive = structuredClone(switched);
  recursive.routeSelection.inactiveDrafts['qwen-image-2512'].routeSelection = switched.routeSelection;
  assert.throws(() => schema.normalizeBlockInstanceV2(recursive), /unknown keys/u);

  const mutable = structuredClone(switched);
  mutable.routeSelection.inactiveDrafts['qwen-image-2512'].definitionSnapshot.ownership = {
    kind: 'user',
    definitionMutable: true,
  };
  assert.throws(() => schema.normalizeBlockInstanceV2(mutable), /registered and immutable/u);
});

test('definition changes retain edited upstream and user drafts across tasks without changing their saved baselines', () => {
  const { qwenInstance, fluxInstance } = fixtures();
  const userDefinition = {
    ...qwenInstance.definitionSnapshot,
    definitionId: 'user:edited-upstream',
    source: { kind: 'user' },
    ownership: { kind: 'user', definitionMutable: true },
  };
  userDefinition.contentHash = schema.blockDefinitionContentHashV2(userDefinition);
  const current = instance(userDefinition);
  current.values.prompt = 'My custom composition prompt';
  const before = structuredClone(current);
  const changed = routes.switchBlockDefinitionV2(current, fluxInstance);
  assert.equal(changed.instanceId, current.instanceId);
  assert.equal(changed.values.prompt, current.values.prompt);
  assert.deepEqual(
    changed.routeSelection.inactiveDrafts[userDefinition.definitionId].effectiveGraph,
    current.effectiveGraph,
  );
  const restored = routes.restoreBlockDefinitionDraftV2(
    schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(changed))),
    userDefinition.definitionId,
  );
  assert.deepEqual(restored.effectiveGraph, current.effectiveGraph);
  assert.deepEqual(restored.effectiveInterface, current.effectiveInterface);
  assert.deepEqual(restored.values, current.values);
  assert.deepEqual(restored.definitionSnapshot, current.definitionSnapshot);
  assert.deepEqual(current, before);
  assert.equal(routes.registeredRouteSetForBlockV1(restored), null);
});

test('definition changes preserve historical route drafts under exact definition identities', () => {
  const { qwenInstance, fluxInstance, sdxlInstance } = fixtures();
  const legacy = routes.switchBlockRouteInstanceV1(qwenInstance, 'flux-1-dev', fluxInstance);
  const changed = routes.switchBlockDefinitionV2(legacy, sdxlInstance);
  assert.deepEqual(
    Object.keys(changed.routeSelection.inactiveDrafts).sort(),
    [qwenInstance.definitionRef.definitionId, fluxInstance.definitionRef.definitionId].sort(),
  );
  const restored = routes.restoreBlockDefinitionDraftV2(changed, qwenInstance.definitionRef.definitionId);
  assert.deepEqual(restored.effectiveGraph, qwenInstance.effectiveGraph);
  const busy = { ...qwenInstance, previewStates: qwenInstance.previewStates.map((s) => ({ ...s, status: 'running' })) };
  assert.throws(() => routes.switchBlockDefinitionV2(busy, fluxInstance), /finish/i);
});
