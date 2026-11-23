import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
const metadata = JSON.parse(
  readFileSync(new URL('../../MoDiff/modiff/visual_node_catalog.v1.json', import.meta.url), 'utf8'),
);
let server, api, guide, registry, catalog;
before(async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.window = { localStorage, location: { origin: 'http://127.0.0.1:8088' }, dispatchEvent: () => true };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  api = await server.ssrLoadModule('/src/studio/visualNodeCatalog.ts');
  guide = (await server.ssrLoadModule('/src/studio/imageStageGuidance.ts')).imageStageGuidance;
  catalog = api.parseVisualCatalog(metadata);
  registry = {};
  for (const stage of catalog.stages)
    for (const mode of stage.modes) {
      const parts = mode.node.split('.');
      const n = (registry[mode.node] ??= {
        module: parts.slice(0, 2).join('.'),
        action: parts[2],
        label: parts[2],
        params: {},
      });
      for (const [field, value] of Object.entries(mode.settings ?? {})) {
        const p = (n.params[field] ??= { options: [] });
        if (!p.options.includes(value)) p.options.push(value);
      }
    }
});
after(async () => await server?.close());
test('an exact decomposed action can be located before model selection without becoming insertable', () => {
  const node = 'modules.ModularDiffusers.WorkflowImageDenoise';
  const definitions = {
    ...registry,
    [node]: { module: 'modules.ModularDiffusers', action: 'WorkflowImageDenoise', label: 'Denoise', params: {} },
  };
  const search = (query, options) => api.visualStageMatches(catalog, definitions, query, options);
  for (const query of [node, 'WorkflowImageDenoise']) {
    const hits = search(query, { showModelHints: true }).filter((hit) => hit.requiresModel);
    assert.deepEqual(
      hits.map((hit) => hit.stage.id),
      ['generate-image', 'edit-image', 'inpaint-image'],
    );
    for (const hit of hits) {
      assert.deepEqual(hit.choices, []);
      assert.equal(api.stageFromDrag(api.stageDragKey(hit.stage, hit.mode), catalog, definitions), null);
    }
    assert.equal(search(query, { showModelHints: false }).length, 0);
    assert.equal(search(query, { showModelHints: true, operations: [] }).length, 0);
  }
});
test('shipped image, video, and caption stages use picker titles after reopening and preserve user titles', async () => {
  const { exampleWorkflowSnapshotFromGraph } = await server.ssrLoadModule('/src/studio/exampleWorkflow.ts');
  const { normalizePersistedFlowState } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const { DEFAULT_STUDIO_FORM } = await server.ssrLoadModule('/src/studio/modelProfiles.ts');
  for (const [file, expected] of [
    ['z-image-modular-pipeline/text-to-image', 'Generate Image'],
    ['wan-video-pipeline/text-to-video', 'Generate Video'],
    ['hugging-face-image-text-to-text-model/image-to-text', 'Generate Text'],
  ]) {
    const raw = JSON.parse(readFileSync(new URL('../../MoDiff/data/graphs/studio/' + file + '.json', import.meta.url)));
    const fresh = exampleWorkflowSnapshotFromGraph(raw, 'default', DEFAULT_STUDIO_FORM);
    for (const state of [fresh, normalizePersistedFlowState(structuredClone(fresh))]) {
      const generate = state.nodes.find((n) => n.data.label === 'Generate');
      assert.ok(generate, file);
      const before = JSON.stringify(generate.data);
      assert.equal(api.visualNodeTitle(catalog, generate.data), expected);
      assert.equal(api.visualNodeTitle(null, generate.data), 'Generate');
      assert.equal(api.visualNodeTitle(catalog, { ...generate.data, label: 'Opening shot' }), 'Opening shot');
      assert.equal(JSON.stringify(generate.data), before);
    }
  }
});
test('35 stages, tiered browsing and every published alias and exact ID can reach its stage', () => {
  const results = (query, options) => api.visualStageMatches(catalog, registry, query, options);
  assert.equal(results('').length, 15);
  assert.equal(results('', { targeted: true }).length, 29);
  assert.equal(results('', { all: true }).length, 35);
  for (const stage of catalog.stages) {
    assert.equal(results(stage.label)[0].stage.id, stage.id, stage.label);
    for (const mode of stage.modes) {
      for (const query of [mode.node, mode.label, ...(mode.terms ?? [])]) {
        const hits = results(query);
        assert.equal(new Set(hits.map((hit) => hit.stage.id)).size, hits.length);
        assert.ok(
          hits.some((hit) => hit.stage.id === stage.id),
          query + ' → ' + stage.id,
        );
      }
    }
  }
  assert.deepEqual(results('!!!'), []);
  assert.equal(results('Ｃａｎｎｙ')[0].stage.label, 'Control Map');
  assert.equal(results('CheckpointLoaderSimple')[0].stage.label, 'Model Setup');
  assert.equal(results('KSampler')[0].stage.label, 'Generate Image');
  assert.equal(results('VAEDecode')[0].stage.label, 'Generate Image');
  assert.equal(results('last extract frame')[0].stage.label, 'Process Video');
});
test('search, drag, insertion and reopening agree on preset values without rewriting the saved graph', () => {
  const hit = api.visualStageMatches(catalog, registry, 'Gaussian blur')[0];
  assert.equal(hit.stage.id, 'process-image');
  assert.equal(hit.definition.params.filter_operation.value, 'gaussian_blur');
  const token = api.stageDragKey(hit.stage, hit.mode);
  assert.deepEqual(api.stageFromDrag(token, catalog, registry), hit.definition);
  assert.equal(api.stageFromDrag(token.replace('Gaussian blur', 'unknown'), catalog, registry), null);
  assert.equal(registry[hit.mode.node].params.operation.value, undefined);
  const saved = JSON.stringify(hit.definition);
  assert.equal(api.visualStageForNode(catalog, JSON.parse(saved)).mode.label, 'Gaussian blur');
  assert.equal(api.visualNodeTitle(catalog, hit.definition, registry[hit.mode.node]), 'Process Image');
  assert.equal(
    api.visualNodeTitle(catalog, { ...hit.definition, label: 'My optical finish' }, registry[hit.mode.node]),
    'My optical finish',
  );
  assert.equal(JSON.stringify(hit.definition), saved);
});
test('selected model, required wire and disabled preset narrow insertable choices', () => {
  const key = 'modules.DiffusersImage.ControlGenerate';
  const operation = { nodeKey: key, pipelineClass: 'ControlModel', task: 'text_to_image' };
  const hits = api.visualStageMatches(catalog, registry, '', { operations: [operation] });
  const hit = hits.find((h) => h.stage.id === 'generate-image');
  assert.deepEqual(
    hit.choices.map((c) => c.operation),
    [operation],
  );
  assert.ok(!hits.some((h) => h.stage.id === 'edit-image'));
  assert.ok(!api.visualStageMatches(catalog, registry, 'KSampler', { operations: [] }).length);
  const decode = api.visualStageMatches(catalog, registry, 'VAE Decode', {
    compatible: (n) => n.action === 'DecodeLatents',
  });
  assert.equal(decode[0].mode.node, 'modules.DiffusersImage.DecodeLatents');
  const mode = { node: key, label: 'unsafe preset', settings: { choice: 'off' } };
  assert.equal(
    api.stageDefinition(mode, {
      [key]: { ...registry[key], params: { choice: { options: [{ value: 'off', disabled: true }] } } },
    }),
    null,
  );
  assert.equal(api.parseVisualCatalog(undefined), null);
  assert.throws(() => api.parseVisualCatalog({ ...metadata, stages: [metadata.stages[0], metadata.stages[0]] }));
});
test('multiple compatible bindings share one stage result and the exact operation selects its own binding', () => {
  const base = { nodeKey: 'modules.DiffusersImage.Generate', pipelineClass: 'Image', task: 'text_to_image' };
  const guided = { ...base, nodeKey: 'modules.DiffusersImage.ControlGenerate', operationId: 'image.control.generate' };
  const plain = { ...base, operationId: 'image.base.generate' };
  const operations = [plain, guided];
  const visible = api.visualStageMatches(catalog, registry, '', { operations });
  assert.equal(visible.filter((hit) => hit.stage.id === 'generate-image').length, 1);
  assert.ok(operations.every((op) => api.representedStageOperations(visible).has(op)));
  const matching = api.visualStageMatches(catalog, registry, guided.operationId, { operations });
  assert.equal(matching[0].operation, guided);
  assert.equal(matching[0].stage.id, 'generate-image');
  assert.ok(
    !api
      .visualStageMatches(catalog, registry, guided.operationId, {
        operations,
        compatible: (_node, op) => op === plain,
      })
      .some((hit) => hit.operation === guided),
  );
});
test('control guidance preserves identity, compatible values and guide wires across model changes', () => {
  const make = (action, more = {}) => ({
    module: 'modules.DiffusersImage',
    action,
    label: action,
    params: {
      pipeline: { type: 'pipeline', display: 'input', signalCompatibility: { required: true, action: '$node' } },
      steps: { type: 'int', value: 12 },
      ...more,
    },
  });
  const plain = make('Edit'),
    controlled = make('ControlEdit', {
      control_image: { type: 'image', display: 'input', required: true },
      conditioning_scale: { type: 'float', default: 1 },
    });
  const defs = { 'modules.DiffusersImage.Edit': plain, 'modules.DiffusersImage.ControlEdit': controlled };
  const edge = { source: 'model', sourceHandle: 'out', target: 'edit', targetHandle: 'pipeline' };
  const context = (data, actions, extra = []) => {
    const edit = { id: 'edit', data };
    const source = {
      id: 'model',
      data: { params: { out: { type: 'pipeline', display: 'output', signal: { value: { actions } } } } },
    };
    return guide(edit, [source, edit], [edge, ...extra], defs, catalog);
  };
  const both = { Edit: ['edit'], ControlEdit: ['edit'] };
  const enabled = context(plain, both).next;
  assert.equal(enabled.action, 'ControlEdit');
  assert.equal(enabled.params.steps.value, 12);
  enabled.params.conditioning_scale = { ...enabled.params.conditioning_scale, value: 0.73 };
  assert.match(context(enabled, { ControlEdit: ['edit'] }).reason, /requires/);
  assert.match(context(enabled, { Edit: ['edit'] }).reason, /does not support/);
  assert.match(
    context(enabled, both, [{ source: 'guide', target: 'edit', targetHandle: 'control_image' }]).reason,
    /Disconnect/,
  );
  const disabled = context(enabled, both).next;
  assert.equal(context(disabled, both).next.params.conditioning_scale.value, 0.73);
  assert.equal(context(plain, { Edit: ['edit'] }), null);
});

test('changing a manual stage restores action-specific settings and refuses an incompatible live wire', async () => {
  const { changeStageAction } = await server.ssrLoadModule('/src/studio/stageActionChange.ts');
  const stage = catalog.stages.find((s) => s.id === 'media-input'),
    loadImage = stage.modes.find((m) => m.node === 'modules.Image.Load'),
    loadAudio = stage.modes.find((m) => m.node === 'modules.Audio.Load');
  const defs = {};
  for (const [m, type] of [
    [loadImage, 'image'],
    [loadAudio, 'audio'],
  ])
    defs[m.node] = {
      ...registry[m.node],
      label: 'Load',
      params: { path: { type: 'string', default: '' }, out: { type, display: 'output' } },
    };
  const image = {
    id: 'source',
    data: {
      ...defs[loadImage.node],
      params: { ...defs[loadImage.node].params, path: { type: 'string', value: 'example.png' } },
    },
  };
  const sound = changeStageAction(image, loadAudio, catalog, defs, [image], []);
  assert.equal(sound.params.path.value, undefined);
  const reopened = { id: 'source', data: JSON.parse(JSON.stringify(sound)) };
  assert.equal(changeStageAction(reopened, loadImage, catalog, defs, [reopened], []).params.path.value, 'example.png');
  const viewer = {
    id: 'viewer',
    data: { module: 'custom.Test', action: 'Show', params: { input: { display: 'input', type: 'image' } } },
  };
  const edge = { source: 'source', sourceHandle: 'out', target: 'viewer', targetHandle: 'input' };
  assert.throws(
    () => changeStageAction(image, loadAudio, catalog, defs, [image, viewer], [edge]),
    /connection is incompatible/,
  );
  assert.equal(image.data.params.path.value, 'example.png');
});
