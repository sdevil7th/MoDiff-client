import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';

const declared = JSON.parse(readFileSync('tests/fixtures/ancillary-authoring.v1.json', 'utf8'));
const actual = JSON.parse(readFileSync('tests/fixtures/ancillary-starter.v1.json', 'utf8'));
const legacy = JSON.parse(readFileSync('tests/fixtures/prompt-enhancement-legacy-parent.v1.json', 'utf8'));
const cache = mkdtempSync(path.join(tmpdir(), 'modiff-enhancement-authoring-'));
let server, authoring, remap, metadata, stable;
before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = { localStorage, dispatchEvent: () => true, location: { origin: 'http://127.0.0.1:5191' } };
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  authoring = await server.ssrLoadModule('/src/studio/promptEnhancementAuthoring.ts');
  metadata = await server.ssrLoadModule('/src/studio/ancillaryOperations.ts');
  stable = await server.ssrLoadModule('/src/studio/stableHash.ts');
  ({ remapOperationAuthoring: remap } = await server.ssrLoadModule('/src/workflow/operationSharedInputs.ts'));
});
after(async () => {
  await server?.close();
  delete globalThis.window;
  delete globalThis.localStorage;
  rmSync(cache, { recursive: true, force: true });
});

// Real constructor-trapped declaration/registry DTOs, with explicitly synthetic
// authored scalar controls. This does not qualify the private profile or model.
function setup(index = 0, preserve = false, capturedParent) {
  const parent = capturedParent ? structuredClone(capturedParent) : JSON.parse(declared.parents[index].rawParentJson);
  if (index === 0 && !preserve) assert.deepEqual(parent, actual.response.authoring);
  if (preserve) {
    const child = parent.ancillaryOperations[0];
    parent.id = parent.id.replace(/:v1$/u, ':v2');
    child.id = `${parent.id}:preview`;
    child.parent.authoringRecipeId = parent.id;
    child.layoutPolicy = 'preserve-authored-v1';
    if (child.verification) child.verification.supportedPromptModes = ['t2i', 'i2i', 't2i_bbox', 'i2i_bbox'];
    const { contentHash: _oldChild, ...semanticChild } = child;
    child.contentHash = `studio-ancillary-v1-${stable.hashString(stable.stableStringify(semanticChild))}`;
    const { contentHash: _oldParent, ...semanticParent } = parent;
    parent.contentHash = `studio-authoring-v1-${stable.hashString(stable.stableStringify(semanticParent))}`;
  }
  const registry = {
    ...structuredClone(declared.parents[index].registry),
    ...Object.fromEntries(
      actual.response.nodes.map(({ operation, node }) => [operation.nodeKey, structuredClone(node)]),
    ),
  };
  const nodes = parent.roles.map(([role, key, x, y]) => {
    const data = structuredClone(registry[key]);
    const operation = actual.operationContracts.find((operation) => operation.nodeKey === key);
    data.studioRole = role;
    if (operation) data.operationAuthoring = { schemaVersion: 1, operation, defaults: {}, retained: [] };
    if (data.params.offload_mode) data.params.offload_mode.value = 'none';
    if (data.params.auto_offload) data.params.auto_offload.value = false;
    return { id: `authored-${role}`, type: 'custom', position: { x, y }, data };
  });
  const graph = {
    nodes,
    edges: parent.edges.map(([a, b, c, d], index) => ({
      id: `authored-edge-${index}`,
      source: `authored-${a}`,
      sourceHandle: b,
      target: `authored-${c}`,
      targetHandle: d,
    })),
  };
  const child = parent.ancillaryOperations[0];
  const owner = nodes.find((node) => node.data.studioRole === child.bindings.owner.role);
  owner.data.params[child.bindings.owner.promptField].value = '  Unchanged raw prompt.\n';
  owner.data.params[child.bindings.owner.layoutField].value = null;
  authoring.attachPromptEnhancementParents(graph, parent);
  return { graph, parent, child, owner, registry };
}

test('absent metadata preserves legacy graph bytes and adds no feature', () => {
  const graph = { nodes: [], edges: [] };
  assert.equal(authoring.attachPromptEnhancementParents(graph, undefined), graph);
  assert.deepEqual(graph, { nodes: [], edges: [] });
});

test('unavailable enhancement removal preserves applied and later authored pairs, references and unrelated topology', async () => {
  for (const index of [0, 1]) {
    const { graph, parent, child, owner, registry } = setup(index);
    const enabled = await authoring.planEnablePromptEnhancement(graph, owner.id, parent, child.id, registry);
    const current = enabled.nodes.find((node) => node.id === owner.id);
    const layout = {
      schemaVersion: 2,
      coordinateSpace: 'normalized_xyxy',
      regions: [{ id: 'subject', description: 'Retain exactly.', action: 'place', targetBox: [0.2, 0.2, 0.8, 0.8] }],
    };
    current.data.params.prompt.value = 'Keep this applied <subject> caption.\n';
    current.data.params.layout_conditioning.value = layout;
    current.data.operationAuthoring.ancillaryParent.appliedPairSha256 = await authoring.promptEnhancementPairHash({
      prompt: current.data.params.prompt.value,
      layout,
    });
    const before = structuredClone(enabled);
    const binding = current.data.operationAuthoring.ancillaryBindings[0];
    const removed = new Set(Object.values(binding.roleNodes));
    const expected = structuredClone(enabled);
    expected.nodes = expected.nodes.filter((node) => !removed.has(node.id));
    expected.edges = expected.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target));
    const kept = expected.nodes.find((node) => node.id === owner.id);
    delete kept.data.operationAuthoring.ancillaryBindings;
    delete kept.data.operationAuthoring.ancillaryParent.appliedPairSha256;
    assert.deepEqual(await authoring.planDetachUnavailablePromptEnhancement(enabled, owner.id, child.id), expected);
    assert.deepEqual(enabled, before);
  }
});

test('unavailable enhancement removal refuses ambiguous or shared persisted ownership atomically', async (t) => {
  for (const fault of [
    'wrong-parent',
    'wrong-owner',
    'wrong-leaf',
    'extra-role',
    'shared-claim',
    'shared-parent-claim',
    'extra-edge',
    'missing-edge',
    'duplicate-edge',
    'duplicate-node',
    'duplicate-owner',
  ]) {
    await t.test(fault, async () => {
      const { graph, parent, child, owner, registry } = setup();
      const enabled = await authoring.planEnablePromptEnhancement(graph, owner.id, parent, child.id, registry);
      const current = enabled.nodes.find((node) => node.id === owner.id);
      const binding = current.data.operationAuthoring.ancillaryBindings[0];
      const provider = enabled.nodes.find((node) => node.id === binding.roleNodes.provider);
      const proposal = enabled.nodes.find((node) => node.id === binding.roleNodes.proposal);
      const edge = enabled.edges.find((edge) => edge.source === provider.id);
      if (fault === 'wrong-parent') binding.parent.authoringRecipeId += ':foreign';
      if (fault === 'wrong-owner') binding.parentRoleNodes.prompt = 'foreign';
      if (fault === 'wrong-leaf') provider.data.action = 'ModelsLoader';
      if (fault === 'extra-role') binding.roleNodes.foreign = 'foreign';
      if (fault === 'shared-claim') {
        const other = structuredClone(current);
        other.id = 'other-owner';
        enabled.nodes.push(other);
      }
      if (fault === 'shared-parent-claim') {
        const other = structuredClone(current);
        other.id = 'other-owner';
        delete other.data.operationAuthoring.ancillaryBindings;
        other.data.operationAuthoring.ancillaryParent.parentRoleNodes.prompt = provider.id;
        enabled.nodes.push(other);
      }
      if (fault === 'extra-edge')
        enabled.edges.push({
          id: 'foreign-edge',
          source: proposal.id,
          sourceHandle: 'text',
          target: owner.id,
          targetHandle: 'prompt',
        });
      if (fault === 'missing-edge') enabled.edges = enabled.edges.filter((item) => item.id !== edge.id);
      if (fault === 'duplicate-edge') enabled.edges.push({ ...edge, id: 'duplicate-edge' });
      if (fault === 'duplicate-node') enabled.nodes.push(structuredClone(provider));
      if (fault === 'duplicate-owner') enabled.nodes.push(structuredClone(current));
      const before = structuredClone(enabled);
      await assert.rejects(
        authoring.planDetachUnavailablePromptEnhancement(enabled, owner.id, child.id),
        /ancillary|enhancement|duplicate|collision/i,
      );
      assert.deepEqual(enabled, before);
    });
  }
});

test('alternative enhancement parent selection preserves authored graph state and refuses structural drift', async (t) => {
  const { graph, parent, owner } = setup();
  const target = structuredClone(parent);
  target.id = `${parent.id}:alternative`;
  const child = target.ancillaryOperations[0];
  child.id = `${target.id}:preview`;
  child.parent.authoringRecipeId = target.id;
  const rehash = () => {
    const { contentHash: _childHash, ...childBody } = child;
    child.contentHash = `studio-ancillary-v1-${stable.hashString(stable.stableStringify(childBody))}`;
    const { contentHash: _parentHash, ...body } = target;
    target.contentHash = `studio-authoring-v1-${stable.hashString(stable.stableStringify(body))}`;
  };
  rehash();
  const before = structuredClone(graph);
  const chosen = await authoring.planSelectPromptEnhancementParent(graph, owner.id, parent, target);
  assert.deepEqual(graph, before);
  assert.deepEqual(chosen.edges, graph.edges);
  assert.equal(chosen.nodes.length, graph.nodes.length);
  const expected = structuredClone(graph);
  expected.nodes.find((node) => node.id === owner.id).data.operationAuthoring.ancillaryParent.parent = {
    ...child.parent,
    authoringContentHash: target.contentHash,
  };
  assert.deepEqual(chosen, expected, 'Only the selected owner advisory identity changes.');
  for (const [name, alter] of [
    [
      'base spec',
      (p) => {
        p.baseSpecId = 'another';
      },
    ],
    [
      'roles',
      (p) => {
        p.roles[0][2] += 1;
      },
    ],
    [
      'bindings',
      (p) => {
        p.bindings[0][1] = 'another';
      },
    ],
    [
      'initial values',
      (p) => {
        p.initialValues.push(['prompt', 'unrelated', 1]);
      },
    ],
    [
      'edges',
      (p) => {
        p.edges[0][1] = 'another';
      },
    ],
    [
      'owner',
      (p) => {
        p.ancillaryOperations[0].bindings.owner.layoutField = 'another';
      },
    ],
    [
      'multiple children',
      (p) => {
        p.ancillaryOperations.push(p.ancillaryOperations[0]);
      },
    ],
  ])
    await t.test(name, async () => {
      const malformed = structuredClone(target);
      alter(malformed);
      await assert.rejects(
        authoring.planSelectPromptEnhancementParent(graph, owner.id, parent, malformed),
        /alternative/,
      );
      assert.deepEqual(graph, before);
    });
});

test('saved enhancement selection is a strict advisory context with exact role remapping', () => {
  const { owner, parent } = setup();
  const before = structuredClone(owner.data.operationAuthoring);
  const offer = authoring.promptEnhancementParentFromHint(before);
  assert.equal(offer.parent.authoringContentHash, parent.contentHash);
  assert.equal('executionAuthority' in offer, false);
  const next = remap(before, (id) => `clone-${id}`);
  assert.deepEqual(
    Object.values(next.ancillaryParent.parentRoleNodes),
    Object.values(offer.parentRoleNodes).map((id) => `clone-${id}`),
  );
  assert.deepEqual(owner.data.operationAuthoring, before);
  const restored = JSON.parse(JSON.stringify(next));
  assert.deepEqual(authoring.promptEnhancementParentFromHint(restored), next.ancillaryParent);
});

test('malformed contexts, accessor hints, duplicate nodes and forged grants refuse', () => {
  const { owner } = setup();
  const offer = structuredClone(owner.data.operationAuthoring.ancillaryParent);
  for (const mutate of [
    (value) => {
      value.schemaVersion = true;
    },
    (value) => {
      value.canApply = true;
    },
    (value) => {
      value.parent.executionProfileId = ['profile'];
    },
    (value) => {
      value.parent.authoringContentHash = 'wrong';
    },
    (value) => {
      value.parentRoleNodes.models = value.parentRoleNodes.prompt;
    },
    (value) => {
      value.parentRoleNodes.prompt = '\ud800';
    },
    (value) => {
      value.parentRoleNodes.prompt = 'a'.repeat(513);
    },
    (value) => {
      value.appliedPairSha256 = 'not-a-digest';
    },
  ]) {
    const copy = structuredClone(offer);
    mutate(copy);
    assert.throws(() => authoring.parsePromptEnhancementParent(copy), /ancillary/i);
  }
  let touched = false;
  assert.throws(
    () =>
      authoring.promptEnhancementParentFromHint(
        Object.defineProperty({}, 'ancillaryParent', {
          enumerable: true,
          get() {
            touched = true;
            return offer;
          },
        }),
      ),
    /data field/,
  );
  assert.equal(touched, false);
});

test('Enable creates only the exact declared branch and leaves raw prompt/layout intact', async () => {
  const { graph, parent, child, owner, registry } = setup();
  const before = structuredClone(graph);
  const next = await authoring.planEnablePromptEnhancement(graph, owner.id, parent, child.id, registry);
  assert.deepEqual(graph, before);
  assert.equal(next.nodes.length, graph.nodes.length + child.roles.length);
  const binding = next.nodes.find((node) => node.id === owner.id).data.operationAuthoring.ancillaryBindings[0];
  const request = next.nodes.find((node) => node.id === binding.roleNodes[child.bindings.request.role]);
  assert.equal(request.data.params[child.bindings.request.promptField].value, '  Unchanged raw prompt.\n');
  assert.equal(request.data.params[child.bindings.request.layoutField].value, null);
  assert.deepEqual(next.nodes.find((node) => node.id === owner.id).data.params, owner.data.params);
  await assert.rejects(authoring.planEnablePromptEnhancement(next, owner.id, parent, child.id, registry), /disable/i);
});

test('retained plain v1 full declaration supports normal Disable and Enable without hash migration', async () => {
  const { graph, parent, child, owner, registry } = setup(1, false, legacy.authoring);
  const currentRegistry = JSON.parse(
    readFileSync('tests/fixtures/prompt-enhancement-starter.v1.json', 'utf8'),
  ).registry;
  for (const [, key] of child.roles) registry[key] = structuredClone(currentRegistry[key]);
  assert.equal(parent.contentHash, 'studio-authoring-v1-d43668d0');
  assert.equal(child.contentHash, 'studio-ancillary-v1-95fc4619');
  assert.deepEqual(child.verification.supportedPromptModes, ['t2i', 'i2i']);
  assert.equal(Object.hasOwn(child, 'layoutPolicy'), false);
  const enabled = await authoring.planEnablePromptEnhancement(graph, owner.id, parent, child.id, registry);
  const disabled = await authoring.planDisablePromptEnhancement(enabled, owner.id, parent, child.id);
  const reenabled = await authoring.planEnablePromptEnhancement(disabled, owner.id, parent, child.id, registry);
  const binding = reenabled.nodes.find((node) => node.id === owner.id).data.operationAuthoring.ancillaryBindings[0];
  assert.equal(binding.contentHash, child.contentHash);
  assert.equal(binding.parent.authoringContentHash, parent.contentHash);
  assert.deepEqual(parent, legacy.authoring);
});

test('Apply changes caption and layout together; Disable restores only untouched applied values', async () => {
  const { graph, parent, child, owner, registry } = setup();
  const enabled = await authoring.planEnablePromptEnhancement(graph, owner.id, parent, child.id, registry);
  const hash = await authoring.promptEnhancementPairHash({ prompt: '  Unchanged raw prompt.\n', layout: null });
  const pair = { prompt: 'Proposed caption.', layout: null };
  const applied = await authoring.planApplyPromptEnhancement(enabled, owner.id, parent, child.id, pair, hash);
  assert.equal(applied.nodes.find((node) => node.id === owner.id).data.params.prompt.value, pair.prompt);
  assert.equal(
    enabled.nodes.find((node) => node.id === owner.id).data.params.prompt.value,
    '  Unchanged raw prompt.\n',
  );
  const disabled = await authoring.planDisablePromptEnhancement(applied, owner.id, parent, child.id);
  assert.equal(disabled.nodes.length, graph.nodes.length);
  assert.equal(
    disabled.nodes.find((node) => node.id === owner.id).data.params.prompt.value,
    '  Unchanged raw prompt.\n',
  );
  const edited = structuredClone(applied);
  edited.nodes.find((node) => node.id === owner.id).data.params.prompt.value = 'Later user edit.';
  const kept = await authoring.planDisablePromptEnhancement(edited, owner.id, parent, child.id);
  assert.equal(kept.nodes.find((node) => node.id === owner.id).data.params.prompt.value, 'Later user edit.');
  await assert.rejects(
    authoring.planApplyPromptEnhancement(edited, owner.id, parent, child.id, pair, hash),
    /changed/i,
  );
});

test('declared structured Apply is one Undo pair and refuses stale bindings or geometry without mutation', async () => {
  const { graph, parent, child, owner, registry } = setup(1, true);
  const layout = {
    schemaVersion: 2,
    coordinateSpace: 'normalized_xyxy',
    regions: [
      {
        id: 'object',
        description: 'Original object.',
        action: 'relocate',
        targetBox: [0.2, 0.2, 0.8, 0.8],
        source: { referenceIndex: 0, box: [0, 0, 1, 1], expectedReferenceId: `sha256:${'a'.repeat(64)}` },
      },
    ],
  };
  owner.data.params.prompt.value = 'Move <object>.';
  owner.data.params.layout_conditioning.value = structuredClone(layout);
  const enabled = await authoring.planEnablePromptEnhancement(graph, owner.id, parent, child.id, registry);
  const original = { prompt: 'Move <object>.', layout };
  const hash = await authoring.promptEnhancementPairHash(original);
  const proposed = structuredClone(original);
  proposed.prompt = 'Move the detailed <object>.';
  proposed.layout.regions[0].description = 'A detailed object.';
  const { useFlowStore: flow } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const studio = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  const transaction = await server.ssrLoadModule('/src/workflow/operationGraphTransaction.ts');
  studio.useStudioStore.setState({
    activeWorkflowTabId: 'structured-unit',
    workflowCanvasEpoch: 1,
    workflowFormEpoch: 1,
    canvasTransition: null,
    graphFinalization: null,
  });
  flow.getState().replaceGraph(enabled);
  flow.getState().resetHistory();
  const current = flow.getState().toObject();
  const next = await authoring.planApplyPromptEnhancement(current, owner.id, parent, child.id, proposed, hash);
  transaction.commitOperationGraph(
    next,
    studio.captureWorkflowOperationContext(),
    transaction.operationGraphSignature(current),
    'Apply structured enhancement',
  );
  assert.equal(flow.getState().historyPast.length, 1);
  const pair = () => {
    const current = flow.getState().nodes.find((node) => node.id === owner.id);
    return { prompt: current.data.params.prompt.value, layout: current.data.params.layout_conditioning.value };
  };
  assert.deepEqual(pair(), proposed);
  flow.getState().undo();
  assert.deepEqual(pair(), original);
  flow.getState().redo();
  assert.deepEqual(pair(), proposed);
  for (const mutate of [
    (p) => {
      p.layout.regions[0].source.expectedReferenceId = `sha256:${'b'.repeat(64)}`;
    },
    (p) => {
      p.layout.regions[0].targetBox[0] = 0.201;
    },
    (p) => {
      p.layout.regions[0].action = 'remove';
      p.layout.regions[0].targetBox = null;
    },
  ]) {
    const changed = structuredClone(proposed),
      before = structuredClone(enabled);
    mutate(changed);
    await assert.rejects(
      authoring.planApplyPromptEnhancement(enabled, owner.id, parent, child.id, changed, hash),
      /identities|geometry/,
    );
    assert.deepEqual(enabled, before);
  }
  const stale = structuredClone(enabled);
  stale.nodes.find(
    (node) => node.id === owner.id,
  ).data.params.layout_conditioning.value.regions[0].source.expectedReferenceId = `sha256:${'c'.repeat(64)}`;
  await assert.rejects(
    authoring.planApplyPromptEnhancement(stale, owner.id, parent, child.id, proposed, hash),
    /changed/,
  );
});

test('Enable refuses stale metadata, source layout and absent registry; Disable protects unrelated connections', async () => {
  const { graph, parent, child, owner, registry } = setup();
  const stale = structuredClone(parent);
  stale.contentHash = 'studio-authoring-v1-00000000';
  await assert.rejects(authoring.planEnablePromptEnhancement(graph, owner.id, stale, child.id, registry), /refresh/i);
  await assert.rejects(authoring.planEnablePromptEnhancement(graph, owner.id, parent, child.id, {}), /registry/i);
  const source = structuredClone(graph);
  source.nodes.find((node) => node.id === owner.id).data.params.layout_conditioning.value = {
    schemaVersion: 2,
    coordinateSpace: 'normalized_xyxy',
    regions: [
      {
        id: 'object',
        description: 'Move object',
        action: 'relocate',
        targetBox: [0.1, 0.1, 0.5, 0.5],
        source: { referenceIndex: 0, expectedReferenceId: `sha256:${'a'.repeat(64)}`, box: [0, 0, 1, 1] },
      },
    ],
  };
  await assert.rejects(
    authoring.planEnablePromptEnhancement(source, owner.id, parent, child.id, registry),
    /source|layout/i,
  );
  const enabled = await authoring.planEnablePromptEnhancement(graph, owner.id, parent, child.id, registry);
  const binding = enabled.nodes.find((node) => node.id === owner.id).data.operationAuthoring.ancillaryBindings[0];
  enabled.edges.push({
    id: 'foreign',
    source: binding.roleNodes[child.bindings.output.role],
    sourceHandle: 'text',
    target: owner.id,
    targetHandle: 'prompt_input',
  });
  await assert.rejects(
    authoring.planDisablePromptEnhancement(enabled, owner.id, parent, child.id),
    /additional connections/i,
  );
});

test('verification metadata stays closed, immutable and distinct from observed runtime or grants', () => {
  // Synthetic static declaration, not an artifact/processor/runtime observation.
  const value = {
    schemaVersion: 1,
    adapter: { id: 'fixture-adapter', declarationSha256: `sha256:${'a'.repeat(64)}` },
    supportedPromptModes: ['t2i', 'i2i'],
    runtimeInputs: {
      role: 'source',
      modelField: 'model_id',
      revisionField: 'revision',
      dtypeField: 'dtype',
      deviceField: 'device',
      quantizationField: 'quantization_mode',
    },
    requestInputs: {
      role: 'request',
      operationField: 'operation',
      maxNewTokensField: 'enhancement_max_new_tokens',
      minNewTokensField: 'min_new_tokens',
      maxInputTokensField: 'max_input_tokens',
      maxImagePixelsField: 'max_image_pixels',
    },
    systemPromptsSha256: `sha256:${'b'.repeat(64)}`,
    chatTemplateSha256: `sha256:${'c'.repeat(64)}`,
    systemPromptSha256ByMode: Object.fromEntries(
      ['t2i', 'i2i', 't2i_bbox', 'i2i_bbox'].map((mode) => [mode, 'd'.repeat(64)]),
    ),
    modelReceipt: {
      schemaVersion: 1,
      library: 'transformers',
      task: 'image-video-to-text',
      source: { kind: 'hub', repository: 'fixture/model', revision: 'e'.repeat(40) },
      loader: { preprocessorAutoClass: 'AutoProcessor', modelAutoClass: 'AutoModelForImageTextToText' },
      security: { localFilesOnly: true, trustRemoteCode: false, safetensorsOnly: true, hostedInference: false },
      runtime: {
        transformersVersion: '5.18.0',
        preprocessorClass: 'FixtureProcessor',
        modelClass: 'FixtureModel',
        modelType: 'fixture',
        architectures: ['FixtureModel'],
      },
    },
    quantizationRecipes: [{ mode: 'none' }],
  };
  assert.deepEqual(metadata.parseAncillaryVerification(value), value);
  for (const mutate of [
    (v) => {
      v.canApply = true;
    },
    (v) => {
      v.supportedPromptModes = [['t2i']];
    },
    (v) => {
      v.supportedPromptModes = ['t2i', 't2i'];
    },
    (v) => {
      v.runtimeInputs.dtypeField = v.runtimeInputs.deviceField;
    },
    (v) => {
      v.runtimeInputs.role = ['source'];
    },
    (v) => {
      v.requestInputs.canApply = true;
    },
    (v) => {
      v.modelReceipt.security.trustRemoteCode = true;
    },
    (v) => {
      v.modelReceipt.source.revision = 'main';
    },
    (v) => {
      v.modelReceipt.source.kind = ['hub'];
    },
    (v) => {
      v.modelReceipt.runtime.device = 'cuda';
    },
    (v) => {
      v.modelReceipt.runtime.architectures = [true];
    },
    (v) => {
      v.modelReceipt.runtime.modelClass = 'a'.repeat(257);
    },
    (v) => {
      v.modelReceipt.receiptDigest = `sha256:${'a'.repeat(64)}`;
    },
    (v) => {
      v.adapter.declarationSha256 = 'a'.repeat(64);
    },
    (v) => {
      v.systemPromptSha256ByMode.i2i = `sha256:${'a'.repeat(64)}`;
    },
    (v) => {
      v.quantizationRecipes = [{ mode: ['none'] }];
    },
    (v) => {
      v.quantizationRecipes.push({ mode: 'none' });
    },
  ]) {
    const copy = structuredClone(value);
    mutate(copy);
    assert.throws(() => metadata.parseAncillaryVerification(copy), /ancillary/i);
  }
});

test('Regenerate reuses the original request after Apply and captures later user edits without recursively enhancing output', async () => {
  const { graph, parent, child, owner, registry } = setup();
  const raw = owner.data.params.prompt.value;
  const enabled = await authoring.planEnablePromptEnhancement(graph, owner.id, parent, child.id, registry);
  const hash = await authoring.promptEnhancementPairHash({ prompt: raw, layout: null });
  const applied = await authoring.planApplyPromptEnhancement(
    enabled,
    owner.id,
    parent,
    child.id,
    { prompt: 'First proposed wording.', layout: null },
    hash,
  );
  const refreshed = await authoring.planRefreshPromptEnhancementRequest(applied, owner.id, parent, child.id);
  const current = refreshed.nodes.find((node) => node.id === owner.id);
  const binding = current.data.operationAuthoring.ancillaryBindings[0];
  const request = refreshed.nodes.find((node) => node.id === binding.roleNodes[child.bindings.request.role]);
  assert.equal(current.data.params.prompt.value, raw);
  assert.equal(request.data.params.prompt.value, raw);
  assert.equal(current.data.operationAuthoring.ancillaryParent.appliedPairSha256, undefined);
  const edited = structuredClone(applied);
  edited.nodes.find((node) => node.id === owner.id).data.params.prompt.value = 'Later user-authored wording.';
  const later = await authoring.planRefreshPromptEnhancementRequest(edited, owner.id, parent, child.id);
  assert.equal(
    later.nodes.find((node) => node.id === binding.roleNodes[child.bindings.request.role]).data.params.prompt.value,
    'Later user-authored wording.',
  );
});

test('implicit scalar Inputs controls are opt-in for exact generic members; other stage behavior stays unchanged', async () => {
  const { child, registry } = setup();
  const { createNodeFromRegistry } = await server.ssrLoadModule('/src/workflow/nodeFactory.ts');
  const { groupVisualStages } = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const node = createNodeFromRegistry(child.roles[0][1], registry, { x: 0, y: 0 });
  const graph = { nodes: [node], edges: [] };
  const ordinary = groupVisualStages(graph, [node.id], 'inputs');
  const adopted = groupVisualStages(graph, [node.id], 'inputs', undefined, { implicitScalarControlNodeIds: [node.id] });
  const ordinaryFields = ordinary.nodes[0].data.blockInstanceV2.effectiveInterface.controls.map(
    (control) => control.binding.fieldId,
  );
  const adoptedFields = adopted.nodes[0].data.blockInstanceV2.effectiveInterface.controls.map(
    (control) => control.binding.fieldId,
  );
  assert.ok(adoptedFields.length > ordinaryFields.length);
  assert.ok(adoptedFields.includes('dtype'));
  assert.throws(
    () =>
      groupVisualStages(graph, [node.id], 'inputs', undefined, { implicitScalarControlNodeIds: ['foreign-member'] }),
    /explicitly adopted/,
  );
  assert.throws(
    () => groupVisualStages(graph, [node.id], 'setup', undefined, { implicitScalarControlNodeIds: [node.id] }),
    /explicitly adopted/,
  );
  const declared = setup().owner;
  assert.throws(
    () =>
      groupVisualStages({ nodes: [declared], edges: [] }, [declared.id], 'inputs', undefined, {
        implicitScalarControlNodeIds: [declared.id],
      }),
    /explicitly adopted/,
  );
  assert.deepEqual(graph, { nodes: [node], edges: [] });
});
