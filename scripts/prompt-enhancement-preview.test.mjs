import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Genuine constructor-trapped metadata, closed eligibility; all HTTP replies,
// task observations and generated summaries below are synthetic unit fixtures.
const fixture = JSON.parse(readFileSync('tests/fixtures/prompt-enhancement-starter.v1.json', 'utf8'));
const cache = mkdtempSync(path.join(tmpdir(), 'modiff-enhancement-preview-'));
const sha = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
const worker = {
  instance: 'synthetic-ui-worker',
  backend_source: { fingerprint: `sha256:backend-source-v1:${'a'.repeat(64)}` },
};
let server, flow, studio, registry, socket, tasks, authoring, preview, runtime, canonical, transaction, Component;
let originalFetch, calls, onMetadata, onRuntime, submitted, cacheBody, taskReplies, submissionId;
before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = { localStorage, dispatchEvent: () => true, location: { origin: 'http://127.0.0.1:5191' } };
  originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('No network during module loading');
  };
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  ({ useFlowStore: flow } = await server.ssrLoadModule('/src/stores/useFlowStore.ts'));
  ({ useStudioStore: studio } = await server.ssrLoadModule('/src/stores/useStudioStore.ts'));
  ({ useNodesStore: registry } = await server.ssrLoadModule('/src/stores/useNodeStore.ts'));
  ({ useWebsocketStore: socket } = await server.ssrLoadModule('/src/stores/useWebsocketStore.ts'));
  ({ useTaskStore: tasks } = await server.ssrLoadModule('/src/stores/useTaskStore.ts'));
  authoring = await server.ssrLoadModule('/src/studio/promptEnhancementAuthoring.ts');
  preview = await server.ssrLoadModule('/src/studio/promptEnhancementPreview.ts');
  runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  canonical = (await server.ssrLoadModule('/src/studio/blockSchemaV2.ts')).canonicalBlockStringifyV2;
  transaction = await server.ssrLoadModule('/src/workflow/operationGraphTransaction.ts');
  Component = (await server.ssrLoadModule('/src/components/PromptEnhancementControls.tsx')).default;
});
beforeEach(() => {
  calls = [];
  onMetadata = null;
  onRuntime = null;
  submitted = null;
  submissionId = 'synthetic-preview-B';
  cacheBody = null;
  taskReplies = new Map();
  studio.setState({
    form: {
      ...studio.getState().form,
      resourceMode: 'expert',
      device: 'cpu',
      offloadMode: 'none',
      autoOffload: false,
      randomSeed: false,
    },
    activeWorkflowTabId: 'unit-preview-tab',
    workflowCanvasHydrated: true,
    workflowCanvasEpoch: 0,
    workflowFormEpoch: 0,
    graphBinding: null,
    workflowTabs: [],
    currentRunContext: null,
    outputs: [],
    runContextsByClientRunId: {},
    runContextsByTaskId: {},
  });
  registry.setState({
    nodesRegistry: structuredClone(fixture.registry),
    operationContracts: structuredClone(fixture.operationContracts),
  });
  socket.setState({ isConnected: true, sid: 'unit-preview-sid' });
  tasks.setState({ currentTask: undefined, queuedTasks: {}, sessionRuns: [] });
  flow.getState().replaceGraph({ nodes: [], edges: [] });
  flow.getState().resetHistory();
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url)),
      endpoint = parsed.pathname;
    calls.push(endpoint);
    const json = (value) =>
      new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (endpoint === '/operations/starter') {
      onMetadata?.();
      return json(fixture.response);
    }
    if (endpoint === '/runtime/status') {
      assert.equal(init.cache, 'no-store', 'Runtime identity reads must bypass HTTP caches.');
      onRuntime?.();
      return json(worker);
    }
    if (endpoint === '/graph') {
      submitted = JSON.parse(init.body);
      return json({
        error: false,
        sid: 'unit-preview-sid',
        task_id: submissionId,
        message: 'Synthetic transport only',
      });
    }
    if (endpoint.startsWith('/runs/')) return json({ task: taskReplies.get(decodeURIComponent(endpoint.slice(6))) });
    if (endpoint.startsWith('/cache/')) {
      assert.equal(parsed.search, '?with_metadata=1');
      assert.equal(init.cache, 'no-store');
      return cacheBody instanceof Response
        ? cacheBody
        : new Response(cacheBody, { headers: { 'Content-Type': 'application/json' } });
    }
    if (endpoint === '/cache' && init?.method === 'DELETE') {
      const body = JSON.parse(init.body);
      return json({
        error: false,
        nodes: body.nodes,
        ...(body.scope === 'outputs' ? { scope: 'outputs', retainedModelNodes: [] } : {}),
      });
    }
    assert.fail(`Unexpected request ${endpoint}`);
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
  delete globalThis.window;
  delete globalThis.localStorage;
  rmSync(cache, { recursive: true, force: true });
});

const parent = fixture.response.authoring,
  child = parent.ancillaryOperations[0];
async function setup() {
  const { createTemplateOperationGraph } = await server.ssrLoadModule('/src/studio/templateOperationWorkflow.ts');
  const { DEFAULT_STUDIO_FORM } = await server.ssrLoadModule('/src/studio/modelProfiles.ts');
  const spec = fixture.baseSpec;
  const form = {
    ...DEFAULT_STUDIO_FORM,
    modelType: spec.modelType,
    mode: spec.mode,
    resourceMode: 'expert',
    device: 'cpu',
    offloadMode: 'none',
    autoOffload: false,
    prompt: '  Authored unit prompt.\n',
    width: 1024,
    height: 1024,
    steps: fixture.capability.recommendedSteps,
    seed: 4201,
    randomSeed: false,
    maxSequenceLength: 8192,
  };
  const graph = createTemplateOperationGraph(
    {
      id: 'unit-preview',
      label: 'Unit fixture only',
      modelType: spec.modelType,
      mode: spec.mode,
      executionSelection: { ...fixture.selection, bindingSpec: { modelType: spec.modelType, mode: spec.mode } },
    },
    form,
    structuredClone(fixture.response),
    structuredClone(fixture.registry),
    spec,
    fixture.capability,
  );
  studio.setState({ form });
  flow.getState().replaceGraph(graph);
  flow.getState().resetHistory();
  const root = graph.nodes.find((node) =>
    node.data.blockInstanceV2?.effectiveGraph.nodes.some((leaf) => leaf.data.studioRole === child.bindings.owner.role),
  );
  const leaf = root.data.blockInstanceV2.effectiveGraph.nodes.find(
    (leaf) => leaf.data.studioRole === child.bindings.owner.role,
  );
  return { ownerId: runtime.blockProjectionNodeIdV2(root.id, leaf.nodeId), graph };
}
function activeOwner(ownerId) {
  return preview.promptEnhancementOwner(ownerId).owner;
}
function editOwnerField(ownerId, field, value) {
  const graph = flow.getState().toObject();
  const root = graph.nodes.find((node) =>
    node.data.blockInstanceV2?.effectiveGraph.nodes.some(
      (leaf) => runtime.blockProjectionNodeIdV2(node.id, leaf.nodeId) === ownerId,
    ),
  );
  const leaf = root.data.blockInstanceV2.effectiveGraph.nodes.find(
    (leaf) => runtime.blockProjectionNodeIdV2(root.id, leaf.nodeId) === ownerId,
  );
  const control = root.data.blockInstanceV2.effectiveInterface.controls.find(
    (control) => control.binding.nodeId === leaf.nodeId && control.binding.fieldId === field,
  );
  assert.ok(control, 'The actual public Block control must exist.');
  const changed = runtime.createBlockRootNodeV2(
    runtime.setBlockInstanceValueV2(root.data.blockInstanceV2, control.controlId, value),
  );
  flow.getState().replaceGraph({ ...graph, nodes: graph.nodes.map((node) => (node.id === root.id ? changed : node)) });
}

function syntheticEnvelope(run, warm = false, nativeText = 'Synthetic appended wording.') {
  const binding = submitted.runtimeHints.executionPurpose.bindings[0],
    verification = child.verification;
  const input = (role, field) => submitted.nodes[binding.roleNodes[role]].params[field].value;
  const mapped = verification.runtimeInputs,
    request = verification.requestInputs,
    hints = submitted.runtimeHints;
  const controls = {
    max_new_tokens: input(request.role, request.maxNewTokensField),
    min_new_tokens: input(request.role, request.minNewTokensField),
    return_dict_in_generate: false,
    ...Object.fromEntries(
      ['do_sample', 'num_beams', 'repetition_penalty', 'use_chat_template'].map((field) => [
        field,
        input(request.role, field),
      ]),
    ),
  };
  const receipt = {
    ...structuredClone(verification.modelReceipt),
    runtime: {
      ...verification.modelReceipt.runtime,
      dtype: input(mapped.role, mapped.dtypeField),
      device: input(mapped.role, mapped.deviceField),
      quantization: verification.quantizationRecipes.find(
        (recipe) => recipe.mode === input(mapped.role, mapped.quantizationField),
      ),
    },
  };
  const sorted = (value) =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, sorted(value[key])]),
          )
        : value;
  receipt.receiptDigest = sha(JSON.stringify(sorted(receipt))); // This closed fixture is entirely ASCII.
  const producer = {
    taskId: warm ? 'synthetic-preview-A' : run.taskId,
    attemptIndex: 0,
    node: { id: run.target.nodeId, module: 'modules.HuggingFaceTransformers', action: 'GenerateImageVideoText' },
    sid: submitted.sid,
    workerInstance: worker.instance,
    backendSourceFingerprint: worker.backend_source.fingerprint,
    graphHash: `sha256:workflow-auto-v1:${'b'.repeat(64)}`,
    recipe: null,
    uiContext: {
      clientRunId: warm ? 'original-client-run-A' : hints.clientRunId,
      runInputHash: hints.runInputHash,
      workflowTabId: hints.workflowTabId,
      workflowCanvasEpoch: warm ? 0 : hints.workflowCanvasEpoch,
      workflowFormEpoch: null,
    },
  };
  const prompt = input(child.bindings.request.role, child.bindings.request.promptField),
    rendered = `Synthetic rendered ${prompt}`;
  const authoredLayout = input(child.bindings.request.role, child.bindings.request.layoutField);
  const append = child.layoutPolicy === 'append-details-preserve-layout-v1';
  const mode = authoredLayout?.regions.length && !append ? 't2i_bbox' : 't2i';
  const consumed = {
    schemaVersion: 1,
    renderedPrompt: rendered,
    references: [],
    processedImageGrid: [],
    fingerprints: {
      operation: input(request.role, request.operationField),
      enhancement_max_new_tokens: controls.max_new_tokens,
      prompt_adapter_id: verification.adapter.id,
      system_prompt_mode: mode,
      system_prompt_sha256: verification.systemPromptSha256ByMode[mode],
      rendered_prompt_sha256: sha(rendered),
      rendered_prompt_utf8_bytes: Buffer.byteLength(rendered),
      rendered_input_ids_sha256: sha('synthetic input token IDs'),
      reference_source_sha256: [],
    },
  };
  const summary = {
    schemaVersion: 1,
    kind: 'prompt-enhancement-proposal',
    producer,
    adapter: verification.adapter,
    request: {
      authoredPromptSha256: sha(prompt),
      authoredLayoutKind: authoredLayout === null ? 'none' : 'object',
      authoredLayoutSha256: authoredLayout === null ? null : sha(canonical({ kind: 'object', value: authoredLayout })),
      controls,
      consumedInputSha256: sha(canonical(consumed)),
    },
    modelReceipt: receipt,
    consumedInput: consumed,
    proposal: {
      mode,
      text: mode === 't2i' && !append ? 'Synthetic independently reviewed proposal.' : null,
      structuredProposal: append
        ? {
            schemaVersion: 3,
            kind: 'caption-append-preserve-layout-v1',
            caption: prompt + '\n\n' + nativeText,
            layoutConditioning: structuredClone(authoredLayout),
            nativeText,
          }
        : mode === 't2i'
          ? null
          : {
              schemaVersion: 2,
              caption: authoredLayout.regions.map((region) => `Enhanced <${region.id}>.`).join(' '),
              rawCaption: authoredLayout.regions.map((_region, index) => `Enhanced <native_${index}>.`).join(' '),
              layoutConditioning: {
                ...structuredClone(authoredLayout),
                regions: authoredLayout.regions.map((region) => ({
                  ...structuredClone(region),
                  description: 'Enhanced description.',
                })),
              },
              rawTable: authoredLayout.regions.map((region, index) => ({
                id: `native_${index}`,
                bbox: [region.targetBox[1], region.targetBox[0], region.targetBox[3], region.targetBox[2]].map(
                  (value) => value * 1000,
                ),
                desc: 'Enhanced description.',
              })),
            },
      finishReason: 'stop',
      inputTokens: 7,
      generatedTokens: 3,
      applyRequired: true,
      applicationAllowed: true,
      layoutOutputValidated: mode === 't2i' && !append ? null : true,
      semanticFidelityVerified: false,
      applicationBlockedReason: null,
    },
  };
  const { recipe: _recipe, ...dispatch } = {
    ...producer,
    taskId: run.taskId,
    uiContext: {
      ...producer.uiContext,
      clientRunId: hints.clientRunId,
      workflowCanvasEpoch: hints.workflowCanvasEpoch,
    },
  };
  const { consumedInputSha256: _consumedHash, ...observedRequest } = summary.request;
  const value = JSON.stringify(summary);
  const envelope = {
    value,
    observation: {
      schemaVersion: 1,
      summarySha256: sha(value),
      producer,
      dispatch: { ...dispatch, status: warm ? 'cached' : 'succeeded' },
      request: observedRequest,
      consumedInput: { schemaVersion: 1, references: [], processedImageGrid: [], fingerprints: consumed.fingerprints },
    },
  };
  for (const actor of [producer, envelope.observation.dispatch])
    taskReplies.set(actor.taskId, {
      task_id: actor.taskId,
      status: 'completed',
      attempt_index: actor.attemptIndex,
      sid: actor.sid,
      client_run_id: actor.uiContext.clientRunId,
      run_input_hash: actor.uiContext.runInputHash,
      workflow_tab_id: actor.uiContext.workflowTabId,
      workflow_canvas_epoch: actor.uiContext.workflowCanvasEpoch,
      workflow_form_epoch: actor.uiContext.workflowFormEpoch,
    });
  cacheBody = JSON.stringify(envelope);
  return envelope;
}

test('actual metadata remains private; Enable and atomic Apply use normal Undo/Redo and JSON save/reload', async () => {
  assert.equal(fixture.capability.autoEligible, false);
  assert.equal(fixture.capability.templateEligible, false);
  const { ownerId } = await setup(),
    before = structuredClone(flow.getState().toObject());
  await preview.enablePromptEnhancement(ownerId);
  assert.equal(flow.getState().nodes.length, 4);
  assert.equal(flow.getState().historyPast.length, 1);
  flow.getState().undo();
  assert.deepEqual(flow.getState().toObject(), before);
  flow.getState().redo();
  assert.ok(activeOwner(ownerId).data.operationAuthoring.ancillaryBindings);
  const enabled = JSON.parse(JSON.stringify(flow.getState().toObject()));
  flow.getState().replaceGraph(enabled);
  flow.getState().resetHistory();
  const pair = { prompt: activeOwner(ownerId).data.params.prompt.value, layout: null };
  const next = await authoring.planApplyPromptEnhancement(
    enabled,
    ownerId,
    parent,
    child.id,
    { prompt: 'Reviewed unit proposal.', layout: null },
    await authoring.promptEnhancementPairHash(pair),
  );
  transaction.commitOperationGraph(
    next,
    (await server.ssrLoadModule('/src/stores/useStudioStore.ts')).captureWorkflowOperationContext(),
    transaction.operationGraphSignature(enabled),
    'Unit Apply',
  );
  assert.equal(activeOwner(ownerId).data.params.prompt.value, 'Reviewed unit proposal.');
  assert.equal(flow.getState().historyPast.length, 1);
  flow.getState().undo();
  assert.equal(activeOwner(ownerId).data.params.prompt.value, pair.prompt);
  flow.getState().redo();
  await preview.disablePromptEnhancement(ownerId, child.id);
  assert.equal(activeOwner(ownerId).data.params.prompt.value, pair.prompt);
  assert.equal(flow.getState().nodes.length, 4);
});

test('declared structured Preview reaches paired Apply and one Undo without changing authored geometry', async () => {
  const saved = structuredClone(parent);
  const originalSelectionId = fixture.selection.authoringRecipeId;
  try {
    const { hashString, stableStringify } = await server.ssrLoadModule('/src/studio/stableHash.ts');
    child.layoutPolicy = 'preserve-authored-v1';
    parent.id = parent.id.replace(/:v1$/u, ':v2');
    child.id = `${parent.id}:preview`;
    child.parent.authoringRecipeId = parent.id;
    fixture.selection.authoringRecipeId = parent.id;
    child.verification.supportedPromptModes = ['t2i', 'i2i', 't2i_bbox', 'i2i_bbox'];
    child.verification.layoutRequestSuffixSha256 = sha('synthetic declared preservation suffix');
    const { contentHash: _childHash, ...childBody } = child;
    child.contentHash = `studio-ancillary-v1-${hashString(stableStringify(childBody))}`;
    const { contentHash: _parentHash, ...parentBody } = parent;
    parent.contentHash = `studio-authoring-v1-${hashString(stableStringify(parentBody))}`;
    const { ownerId } = await setup();
    const layout = {
      schemaVersion: 2,
      coordinateSpace: 'normalized_xyxy',
      regions: [
        {
          id: 'authored_object',
          description: 'Original description.',
          action: 'place',
          targetBox: [0.1, 0.2, 0.4, 0.7],
        },
      ],
    };
    editOwnerField(ownerId, 'prompt', 'A scene with <authored_object>.');
    editOwnerField(ownerId, 'layout_conditioning', layout);
    await preview.enablePromptEnhancement(ownerId);
    const run = await preview.startPromptEnhancementPreview(ownerId, child.id);
    syntheticEnvelope(run);
    const proposal = await preview.finishPromptEnhancementPreview(run);
    assert.equal(preview.promptEnhancementPreviewDetails(proposal).proposal.structuredProposal.schemaVersion, 2);
    const before = structuredClone(flow.getState().toObject());
    flow.getState().resetHistory();
    await preview.applyPromptEnhancementPreview(proposal);
    assert.equal(activeOwner(ownerId).data.params.prompt.value, 'Enhanced <authored_object>.');
    assert.deepEqual(
      activeOwner(ownerId).data.params.layout_conditioning.value.regions[0].targetBox,
      layout.regions[0].targetBox,
    );
    assert.equal(flow.getState().historyPast.length, 1);
    flow.getState().undo();
    assert.deepEqual(flow.getState().toObject(), before);
  } finally {
    fixture.selection.authoringRecipeId = originalSelectionId;
    for (const key of Object.keys(child)) delete child[key];
    Object.assign(child, saved.ancillaryOperations[0]);
    for (const key of Object.keys(parent)) if (key !== 'ancillaryOperations') delete parent[key];
    Object.assign(parent, { ...saved, ancillaryOperations: [child] });
  }
});

test('declared append-details Preview keeps the full layout and Regenerate never appends its own previous output', async () => {
  const saved = structuredClone(parent),
    originalSelectionId = fixture.selection.authoringRecipeId;
  const operationField = fixture.registry['modules.HuggingFaceTransformers.GenerateImageVideoText'].params.operation;
  const options = structuredClone(operationField.options);
  try {
    const { hashString, stableStringify } = await server.ssrLoadModule('/src/studio/stableHash.ts');
    // Synthetic additive protocol variant. Real producer/native coverage is separate.
    child.layoutPolicy = 'append-details-preserve-layout-v1';
    parent.id = parent.id.replace(/:v1$/u, ':v3');
    child.id = `${parent.id}:preview`;
    child.parent.authoringRecipeId = parent.id;
    fixture.selection.authoringRecipeId = parent.id;
    child.initialValues.find(
      ([role, field]) =>
        role === child.verification.requestInputs.role && field === child.verification.requestInputs.operationField,
    )[2] = 'enhance_prompt_append_details';
    child.verification.supportedPromptModes = ['t2i', 'i2i'];
    child.verification.layoutRequestSuffixSha256 = sha('synthetic declared append request');
    operationField.options.push({
      ...operationField.options.find((option) => option.value === 'enhance_prompt'),
      value: 'enhance_prompt_append_details',
      label: 'enhance_prompt_append_details',
    });
    const { contentHash: _childHash, ...childBody } = child;
    child.contentHash = `studio-ancillary-v1-${hashString(stableStringify(childBody))}`;
    const { contentHash: _parentHash, ...parentBody } = parent;
    parent.contentHash = `studio-authoring-v1-${hashString(stableStringify(parentBody))}`;
    const { ownerId } = await setup();
    const layout = {
      schemaVersion: 2,
      coordinateSpace: 'normalized_xyxy',
      regions: [
        {
          id: 'authored_object',
          description: '  Original description.\n',
          action: 'place',
          targetBox: [0.10001, 0.2, 0.4, 0.7],
        },
      ],
    };
    const prompt = '  A scene with <authored_object>.\n';
    editOwnerField(ownerId, 'prompt', prompt);
    editOwnerField(ownerId, 'layout_conditioning', layout);
    await preview.enablePromptEnhancement(ownerId);
    const first = await preview.startPromptEnhancementPreview(ownerId, child.id);
    const firstEnvelope = syntheticEnvelope(first, false, 'First proposed wording.');
    const firstTicket = await preview.finishPromptEnhancementPreview(first);
    const before = structuredClone(flow.getState().toObject());
    const originalPairHash = await authoring.promptEnhancementPairHash({ prompt, layout });
    await assert.rejects(
      authoring.planApplyPromptEnhancement(
        before,
        ownerId,
        parent,
        child.id,
        { prompt: 'Replacement caption <authored_object>.', layout },
        originalPairHash,
      ),
      /caption prefix/,
    );
    const changedLayout = structuredClone(layout);
    changedLayout.regions[0].description = 'Changed description';
    await assert.rejects(
      authoring.planApplyPromptEnhancement(
        before,
        ownerId,
        parent,
        child.id,
        { prompt: prompt + '\n\nProposed wording.', layout: changedLayout },
        originalPairHash,
      ),
      /any authored layout field/,
    );
    assert.deepEqual(flow.getState().toObject(), before);
    flow.getState().resetHistory();
    await preview.applyPromptEnhancementPreview(firstTicket);
    assert.equal(activeOwner(ownerId).data.params.prompt.value, prompt + '\n\nFirst proposed wording.');
    assert.deepEqual(activeOwner(ownerId).data.params.layout_conditioning.value, layout);
    assert.equal(flow.getState().historyPast.length, 1);
    flow.getState().undo();
    assert.deepEqual(flow.getState().toObject(), before);
    flow.getState().redo();
    submissionId = 'synthetic-preview-C';
    const second = await preview.startPromptEnhancementPreview(ownerId, child.id, true);
    assert.notEqual(second.taskId, first.taskId);
    const binding = submitted.runtimeHints.executionPurpose.bindings[0];
    const request = submitted.nodes[binding.roleNodes[child.bindings.request.role]];
    assert.equal(request.params.prompt.value, prompt, 'Regenerate submits the untouched original caption.');
    assert.deepEqual(request.params.layout_conditioning.value, layout);
    assert.ok(calls.includes('/cache'), 'Regenerate uses normal explicit recomputation.');
    syntheticEnvelope(second, false, 'Second proposed wording.');
    const secondTicket = await preview.finishPromptEnhancementPreview(second);
    assert.notEqual(
      JSON.parse(firstEnvelope.value).producer.taskId,
      preview.promptEnhancementPreviewDetails(secondTicket).producer.taskId,
    );
    flow.getState().resetHistory();
    await preview.applyPromptEnhancementPreview(secondTicket);
    assert.equal(activeOwner(ownerId).data.params.prompt.value, prompt + '\n\nSecond proposed wording.');
    assert.doesNotMatch(activeOwner(ownerId).data.params.prompt.value, /First proposed wording/);
    assert.deepEqual(activeOwner(ownerId).data.params.layout_conditioning.value, layout);
    assert.equal(flow.getState().historyPast.length, 1);
    flow.getState().undo();
    assert.equal(activeOwner(ownerId).data.params.prompt.value, prompt);
    assert.deepEqual(activeOwner(ownerId).data.params.layout_conditioning.value, layout);
  } finally {
    operationField.options = options;
    fixture.selection.authoringRecipeId = originalSelectionId;
    for (const key of Object.keys(child)) delete child[key];
    Object.assign(child, saved.ancillaryOperations[0]);
    for (const key of Object.keys(parent)) if (key !== 'ancillaryOperations') delete parent[key];
    Object.assign(parent, { ...saved, ancillaryOperations: [child] });
  }
});

test('normal unavailable metadata and concurrent document/session/task changes refuse before mutation or dispatch', async (t) => {
  for (const failure of ['unavailable', 'document', 'session', 'task'])
    await t.test(failure, async () => {
      const { ownerId } = await setup();
      if (failure === 'unavailable') {
        const saved = globalThis.fetch;
        globalThis.fetch = async (url, init) =>
          new URL(String(url)).pathname === '/operations/starter'
            ? new Response(JSON.stringify({ error: true, message: 'Private profile unavailable' }), { status: 400 })
            : saved(url, init);
      } else {
        await preview.enablePromptEnhancement(ownerId);
        onRuntime = () => {
          if (failure === 'document')
            studio.setState({ workflowCanvasEpoch: studio.getState().workflowCanvasEpoch + 1 });
          if (failure === 'session') socket.setState({ sid: 'replacement-session' });
          if (failure === 'task')
            tasks.setState({ currentTask: { name: 'Another owned run', task_id: 'another', status: 'running' } });
        };
      }
      const before = structuredClone(flow.getState().toObject()),
        history = flow.getState().historyPast.length;
      await assert.rejects(
        failure === 'unavailable'
          ? preview.enablePromptEnhancement(ownerId)
          : preview.startPromptEnhancementPreview(ownerId, child.id),
        /private|unavailable|changed|wait|workflow/i,
      );
      assert.deepEqual(flow.getState().toObject(), before);
      assert.equal(flow.getState().historyPast.length, history);
      assert.equal(calls.includes('/graph'), false);
      onRuntime = null;
      socket.setState({ sid: 'unit-preview-sid' });
      tasks.setState({ currentTask: undefined });
    });
});

test('current plain-only declaration refuses every authored layout object before preparation and keeps raw values', async () => {
  const { ownerId } = await setup();
  for (const layout of [
    {},
    { schemaVersion: 2, coordinateSpace: 'normalized_xyxy', regions: [] },
    {
      schemaVersion: 2,
      coordinateSpace: 'normalized_xyxy',
      regions: [{ id: 'one', action: 'place', description: 'An object', targetBox: [0, 0, 1, 1] }],
    },
  ]) {
    editOwnerField(ownerId, 'layout_conditioning', layout);
    assert.deepEqual(activeOwner(ownerId).data.params.layout_conditioning.value, layout);
    const before = structuredClone(flow.getState().toObject());
    await assert.rejects(preview.enablePromptEnhancement(ownerId), /layout|schema|regions|invalid/i);
    assert.deepEqual(flow.getState().toObject(), before);
    assert.equal(calls.includes('/graph'), false);
  }
});

test('optional controls render the raw path and disabled actions with existing wrapping tokens', async () => {
  const { ownerId } = await setup();
  const previous = socket.getInitialState().isConnected;
  const originalGraph = { nodes: flow.getInitialState().nodes, edges: flow.getInitialState().edges };
  Object.assign(flow.getInitialState(), { nodes: flow.getState().nodes, edges: flow.getState().edges });
  socket.getInitialState().isConnected = false;
  try {
    const markup = renderToStaticMarkup(React.createElement(Component, { ownerId }));
    assert.match(markup, /The raw prompt runs directly/);
    assert.match(markup, /Enable enhancement/);
    assert.match(markup, /disabled/);
    assert.match(markup, /min-w-0/);
    assert.match(markup, /flex-wrap/);
    assert.doesNotMatch(markup, /switch to Custom|release.*owner|canApply/);
  } finally {
    socket.getInitialState().isConnected = previous;
    Object.assign(flow.getInitialState(), originalGraph);
  }
});

test('Preview dispatch uses the selected ordinary scope and does not change the resource mode', async () => {
  const { ownerId } = await setup();
  await preview.enablePromptEnhancement(ownerId);
  const run = await preview.startPromptEnhancementPreview(ownerId, child.id);
  assert.equal(run.taskId, 'synthetic-preview-B');
  assert.equal(submitted.runtimeHints.executionPurpose.kind, 'explicit_preview');
  assert.equal(submitted.runtimeHints.resourceMode, 'expert');
  assert.equal(studio.getState().form.resourceMode, 'expert');
  const binding = submitted.runtimeHints.executionPurpose.bindings[0];
  assert.deepEqual(Object.keys(submitted.nodes).sort(), Object.values(binding.roleNodes).sort());
  assert.equal(activeOwner(ownerId).data.params.prompt.value, '  Authored unit prompt.\n');
});

test('request refresh keeps the selected inspector mounted through Preview verification and Apply', async () => {
  await setup();
  const { unpackVisualOperationGroups } = await server.ssrLoadModule('/src/workflow/visualOperationGroupProjection.ts');
  const graph = unpackVisualOperationGroups(flow.getState().toObject()).graph;
  flow.getState().replaceGraph(graph);
  const owner = graph.nodes.find(
    (node) => node.data.studioRole === child.bindings.owner.role && node.data.operationAuthoring?.ancillaryParent,
  );
  assert.ok(owner, 'The declared prompt owner must be present after normal ungrouping.');
  const ownerId = owner.id;
  await preview.enablePromptEnhancement(ownerId);
  const edited = 'A later authored prompt requires a fresh ancillary request.';
  flow.getState().setParamWithHistory(ownerId, child.bindings.owner.promptField, edited);
  await flow.getState().onNodesChange([{ type: 'select', id: ownerId, selected: true }]);
  const selectedIds = () =>
    flow
      .getState()
      .nodes.filter((node) => node.selected)
      .map((node) => node.id);
  assert.deepEqual(selectedIds(), [ownerId]);
  const binding = activeOwner(ownerId).data.operationAuthoring.ancillaryBindings[0];
  const requestId = binding.roleNodes[child.bindings.request.role];
  assert.notEqual(
    flow.getState().nodes.find((node) => node.id === requestId).data.params[child.bindings.request.promptField].value,
    edited,
  );
  const lostInspector = [];
  const unsubscribe = flow.subscribe(() => {
    // GraphNodeInputs mounts the selected node's controls only while selected.
    if (!selectedIds().includes(ownerId)) lostInspector.push(true);
  });
  try {
    const run = await preview.startPromptEnhancementPreview(ownerId, child.id);
    assert.deepEqual(lostInspector, [], 'Request refresh must not unmount the action before it receives its run.');
    assert.equal(submitted.nodes[requestId].params[child.bindings.request.promptField].value, edited);
    assert.ok(
      flow
        .getState()
        .toObject()
        .nodes.every((node) => !Object.hasOwn(node, 'selected')),
    );
    const envelope = syntheticEnvelope(run);
    const ticket = await preview.finishPromptEnhancementPreview(run);
    assert.equal(preview.promptEnhancementPreviewDetails(ticket).producer.taskId, run.taskId);
    await preview.applyPromptEnhancementPreview(ticket);
    assert.equal(activeOwner(ownerId).data.params.prompt.value, JSON.parse(envelope.value).proposal.text);
    assert.deepEqual(selectedIds(), [ownerId]);
    await preview.disablePromptEnhancement(ownerId, child.id);
    assert.deepEqual(selectedIds(), [ownerId]);
    await preview.enablePromptEnhancement(ownerId, child.id);
    assert.deepEqual(selectedIds(), [ownerId]);
    assert.deepEqual(lostInspector, []);
  } finally {
    unsubscribe();
  }
});

test('ordinary graph replacements clear selection unless explicitly preserved', async (t) => {
  const { captureWorkflowOperationContext } = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  for (const preserveSelection of [false, true])
    await t.test(preserveSelection ? 'explicit in-place refresh' : 'ordinary replacement', async () => {
      await setup();
      const selectedId = flow.getState().nodes[0].id;
      await flow.getState().onNodesChange([{ type: 'select', id: selectedId, selected: true }]);
      const before = flow.getState().toObject();
      assert.ok(before.nodes.every((node) => !Object.hasOwn(node, 'selected')));
      transaction.commitOperationGraph(
        structuredClone(before),
        captureWorkflowOperationContext(),
        transaction.operationGraphSignature(before),
        'Replace reviewed graph',
        { preserveSelection },
      );
      assert.deepEqual(
        flow
          .getState()
          .nodes.filter((node) => node.selected)
          .map((node) => node.id),
        preserveSelection ? [selectedId] : [],
      );
    });
});

test('an explicit operation selection plan can select a new node or clear the old selection', async (t) => {
  const { createNodeFromRegistry } = await server.ssrLoadModule('/src/workflow/nodeFactory.ts');
  const { captureWorkflowOperationContext } = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  for (const intent of ['new node', 'clear selection'])
    await t.test(intent, async () => {
      await setup();
      const previousId = flow.getState().nodes[0].id;
      await flow.getState().onNodesChange([{ type: 'select', id: previousId, selected: true }]);
      const before = flow.getState().toObject();
      const graph = structuredClone(before);
      let nextId = null;
      if (intent === 'new node') {
        const next = createNodeFromRegistry('modules.Image.Preview', fixture.registry, { x: 2100, y: 0 });
        assert.ok(next);
        next.selected = true;
        nextId = next.id;
        graph.nodes.push(next);
      } else graph.nodes[0].selected = false;
      transaction.commitOperationGraph(
        graph,
        captureWorkflowOperationContext(),
        transaction.operationGraphSignature(before),
        'Explicit selection intent',
        { preserveSelection: true },
      );
      assert.deepEqual(
        flow
          .getState()
          .nodes.filter((node) => node.selected)
          .map((node) => node.id),
        nextId ? [nextId] : [],
      );
    });
});

test('a raw unclaimed text-generator graph still requires an ordinary visible output path', async () => {
  const { createNodeFromRegistry } = await server.ssrLoadModule('/src/workflow/nodeFactory.ts');
  const provider = createNodeFromRegistry(child.roles[0][1], fixture.registry, { x: 0, y: 0 });
  const proposal = createNodeFromRegistry(child.roles[1][1], fixture.registry, { x: 300, y: 0 });
  flow.getState().replaceGraph({
    nodes: [provider, proposal],
    edges: child.edges.map(([a, output, b, input], index) => ({
      id: `raw-${index}`,
      source: a === child.roles[0][0] ? provider.id : proposal.id,
      sourceHandle: output,
      target: b === child.roles[0][0] ? provider.id : proposal.id,
      targetHandle: input,
    })),
  });
  const { collectRunReadinessIssues } = await server.ssrLoadModule('/src/studio/runReadiness.ts');
  assert.ok(
    collectRunReadinessIssues({ sid: 'unit-preview-sid', isConnected: true, includeStudio: false }).some(
      (issue) => issue.code === 'graph_output_missing',
    ),
  );
});

test('synthetic fresh and warm observations require task/request/source correlation before an explicit atomic Apply', async (t) => {
  for (const warm of [false, true])
    await t.test(warm ? 'original producer A with current cached dispatch B' : 'fresh current producer B', async () => {
      const { ownerId } = await setup();
      await preview.enablePromptEnhancement(ownerId);
      const run = await preview.startPromptEnhancementPreview(ownerId, child.id),
        envelope = syntheticEnvelope(run, warm);
      const original = activeOwner(ownerId).data.params.prompt.value;
      const ticket = await preview.finishPromptEnhancementPreview(run);
      assert.equal(
        preview.promptEnhancementPreviewDetails(ticket).producer.taskId,
        warm ? 'synthetic-preview-A' : run.taskId,
      );
      assert.equal(
        activeOwner(ownerId).data.params.prompt.value,
        original,
        'Verification alone must not edit authored values.',
      );
      await preview.applyPromptEnhancementPreview(ticket);
      assert.equal(activeOwner(ownerId).data.params.prompt.value, JSON.parse(envelope.value).proposal.text);
      flow.getState().undo();
      assert.equal(activeOwner(ownerId).data.params.prompt.value, original);
      await assert.rejects(preview.applyPromptEnhancementPreview(ticket), /new verified Preview/i);
    });
});

test('a verified Preview cannot Apply after a worker or backend source rollover, without changing the document', async (t) => {
  for (const field of ['worker', 'source'])
    await t.test(field, async () => {
      const originalRuntime = structuredClone(worker);
      try {
        const { ownerId } = await setup();
        await preview.enablePromptEnhancement(ownerId);
        const run = await preview.startPromptEnhancementPreview(ownerId, child.id);
        syntheticEnvelope(run);
        const ticket = await preview.finishPromptEnhancementPreview(run);
        const before = structuredClone(flow.getState().toObject());
        const history = flow.getState().historyPast.length;
        // Only the fresh Apply read observes the rollover; same DTOs/epochs stay unchanged.
        onRuntime = () => {
          if (field === 'worker') worker.instance = 'replacement-worker';
          else worker.backend_source.fingerprint = `sha256:backend-source-v1:${'d'.repeat(64)}`;
        };
        await assert.rejects(preview.applyPromptEnhancementPreview(ticket), /worker or backend source changed/);
        assert.deepEqual(flow.getState().toObject(), before);
        assert.equal(flow.getState().historyPast.length, history);
      } finally {
        onRuntime = null;
        Object.assign(worker, originalRuntime);
      }
    });
});

test('normal running and completed node status cannot stale an otherwise unchanged Preview or Apply', async () => {
  const { ownerId } = await setup();
  await preview.enablePromptEnhancement(ownerId);
  const run = await preview.startPromptEnhancementPreview(ownerId, child.id),
    envelope = syntheticEnvelope(run);
  const root = flow
    .getState()
    .nodes.find((node) =>
      node.data.blockInstanceV2?.effectiveGraph.nodes.some(
        (leaf) => runtime.blockProjectionNodeIdV2(node.id, leaf.nodeId) === ownerId,
      ),
    );
  assert.equal(root.data.uiState, undefined);
  const original = activeOwner(ownerId).data.params.prompt.value,
    graphSignature = transaction.operationGraphSignature(flow.getState().toObject());
  // The websocket status reducer materializes uiState even when there is no authored UI setting.
  flow.getState().setNodeUiState(root.id, { validationSeverity: 'info', validationMessage: 'Running' });
  flow.getState().updateProgress(root.id, -1, { activeTaskId: run.taskId, executionStatus: 'running' });
  flow.getState().setNodeUiState(root.id, { validationSeverity: 'success', validationMessage: 'Completed' });
  flow.getState().updateProgress(root.id, 0, { activeTaskId: run.taskId, executionStatus: 'completed' });
  assert.equal(transaction.operationGraphSignature(flow.getState().toObject()), graphSignature);
  const ticket = await preview.finishPromptEnhancementPreview(run);
  assert.equal(activeOwner(ownerId).data.params.prompt.value, original);
  await preview.applyPromptEnhancementPreview(ticket);
  assert.equal(activeOwner(ownerId).data.params.prompt.value, JSON.parse(envelope.value).proposal.text);
  flow.getState().undo();
  assert.equal(activeOwner(ownerId).data.params.prompt.value, original);
});

test('synthetic observation drift, contradictory cache origin, duplicate JSON and later edits cannot mint or reuse Apply', async (t) => {
  for (const fault of [
    'task',
    'source',
    'graph',
    'request',
    'consumed',
    'digest',
    'duplicate',
    'ui',
    'wire',
    'later-edit',
  ])
    await t.test(fault, async () => {
      const { ownerId } = await setup();
      await preview.enablePromptEnhancement(ownerId);
      const run = await preview.startPromptEnhancementPreview(ownerId, child.id),
        envelope = syntheticEnvelope(run, true);
      if (fault === 'task') envelope.observation.dispatch.taskId = 'foreign-task';
      if (fault === 'source') envelope.observation.producer.workerInstance = 'replacement-worker';
      if (fault === 'graph') envelope.observation.producer.graphHash = `sha256:workflow-auto-v1:${'c'.repeat(64)}`;
      if (fault === 'request') envelope.observation.request.authoredPromptSha256 = sha('other raw prompt');
      if (fault === 'consumed')
        envelope.observation.consumedInput.fingerprints.rendered_input_ids_sha256 = sha('other processed tokens');
      if (fault === 'digest') envelope.observation.summarySha256 = sha('different summary bytes');
      cacheBody = JSON.stringify(envelope);
      if (fault === 'duplicate') cacheBody = cacheBody.replace('{"value":', '{"value":"discarded","value":');
      if (fault === 'ui') flow.getState().setNodeUiState(flow.getState().nodes[0].id, { disabled: true });
      if (fault === 'wire') {
        const graph = flow.getState().toObject();
        assert.ok(graph.edges.length);
        flow.getState().replaceGraph({ ...graph, edges: graph.edges.slice(1) });
      }
      const before = activeOwner(ownerId).data.params.prompt.value;
      if (fault === 'later-edit') {
        const ticket = await preview.finishPromptEnhancementPreview(run);
        editOwnerField(ownerId, 'prompt', 'Later user edit');
        await assert.rejects(preview.applyPromptEnhancementPreview(ticket), /changed|fresh|workflow/i);
        assert.equal(activeOwner(ownerId).data.params.prompt.value, 'Later user edit');
      } else {
        await assert.rejects(
          preview.finishPromptEnhancementPreview(run),
          /changed|Preview|duplicate|observ|producer|task|graph|input/i,
        );
        assert.equal(activeOwner(ownerId).data.params.prompt.value, before);
      }
    });
});

test('metadata reads bound streamed bytes and reject invalid UTF8 before creating a verified ticket', async (t) => {
  for (const fault of ['overflow', 'invalid-utf8', 'advertised-overflow', 'advertised-invalid'])
    await t.test(fault, async () => {
      const { ownerId } = await setup();
      await preview.enablePromptEnhancement(ownerId);
      const run = await preview.startPromptEnhancementPreview(ownerId, child.id);
      syntheticEnvelope(run);
      let cancelled = false;
      const limit = (await server.ssrLoadModule('/src/studio/promptEnhancementSummary.ts'))
        .MAX_ENHANCEMENT_ENVELOPE_BYTES;
      cacheBody =
        fault === 'invalid-utf8'
          ? new Response(new Uint8Array([0xc3, 0x28]))
          : new Response(
              new ReadableStream({
                pull(controller) {
                  controller.enqueue(new Uint8Array(limit + 1));
                },
                cancel() {
                  cancelled = true;
                },
              }),
              {
                headers: fault.startsWith('advertised')
                  ? { 'Content-Length': fault === 'advertised-invalid' ? 'not-a-number' : String(limit + 1) }
                  : {},
              },
            );
      await assert.rejects(preview.finishPromptEnhancementPreview(run), /byte limit|encoded data|UTF/i);
      if (fault !== 'invalid-utf8') assert.equal(cancelled, true);
      assert.equal(activeOwner(ownerId).data.params.prompt.value, '  Authored unit prompt.\n');
    });
});

test('metadata status failures retain the HTTP status and cannot change authored inputs', async () => {
  const { ownerId } = await setup();
  await preview.enablePromptEnhancement(ownerId);
  const run = await preview.startPromptEnhancementPreview(ownerId, child.id);
  syntheticEnvelope(run);
  cacheBody = new Response('Unavailable metadata', { status: 503 });
  await assert.rejects(
    preview.finishPromptEnhancementPreview(run),
    (error) => error.kind === 'http' && error.status === 503 && /Preview metadata/.test(error.message),
  );
  assert.equal(activeOwner(ownerId).data.params.prompt.value, '  Authored unit prompt.\n');
});

test('cancelling a metadata body read uses the shared transport without changing authored inputs', async () => {
  const { ownerId } = await setup();
  await preview.enablePromptEnhancement(ownerId);
  const run = await preview.startPromptEnhancementPreview(ownerId, child.id);
  syntheticEnvelope(run);
  const previousFetch = globalThis.fetch,
    controller = new AbortController();
  let bodyStarted;
  const started = new Promise((resolve) => {
    bodyStarted = resolve;
  });
  globalThis.fetch = async (url, init) => {
    if (!new URL(String(url)).pathname.startsWith('/cache/')) return previousFetch(url, init);
    assert.equal(init.cache, 'no-store');
    return new Response(
      new ReadableStream({
        start(stream) {
          init.signal.addEventListener('abort', () => stream.error(init.signal.reason), { once: true });
        },
        pull() {
          bodyStarted();
        },
      }),
    );
  };
  const pending = preview.finishPromptEnhancementPreview(run, controller.signal);
  const rejected = assert.rejects(pending, (error) => error.kind === 'aborted');
  await started;
  controller.abort(new Error('Unit read cancelled.'));
  await rejected;
  assert.equal(activeOwner(ownerId).data.params.prompt.value, '  Authored unit prompt.\n');
});

test('changing an enabled parent requires Disable; a disabled change derives a fresh exact offer from its new starter', async () => {
  const { ownerId } = await setup();
  await preview.enablePromptEnhancement(ownerId);
  const { planOperationChange } = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
  const { requestOperationStarter } = await server.ssrLoadModule('/src/workflow/operationStarterRequest.ts');
  const { visualOperationOwnerId } = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const { expandFlowExecutionGraph } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const starter = await requestOperationStarter(
    fixture.selection.pipelineClass,
    fixture.selection.task,
    fixture.operationContracts,
    undefined,
    fixture.selection.executionProfileId,
    fixture.selection.authoringRecipeId,
  );
  const loaderId = (graph) => {
    const root = graph.nodes.find((node) =>
      node.data.blockInstanceV2?.effectiveGraph.nodes.some((leaf) => leaf.data.studioRole === 'models'),
    );
    const leaf = root.data.blockInstanceV2.effectiveGraph.nodes.find((leaf) => leaf.data.studioRole === 'models');
    return visualOperationOwnerId(graph, leaf.nodeId, root.id);
  };
  const enabled = flow.getState().toObject();
  assert.throws(
    () => planOperationChange(enabled, loaderId(enabled), starter, { restoreDefaults: true }),
    /disable.*enhancement/i,
  );
  assert.equal(activeOwner(ownerId).data.params.prompt.value, '  Authored unit prompt.\n');
  await preview.disablePromptEnhancement(ownerId, child.id);
  const disabled = flow.getState().toObject();
  const plan = planOperationChange(disabled, loaderId(disabled), starter, { restoreDefaults: true });
  const native = expandFlowExecutionGraph(plan.graph.nodes, plan.graph.edges);
  const ownerKey = parent.roles.find(([role]) => role === child.bindings.owner.role)[1];
  const prompt = native.nodes.find((node) => `${node.data.module}.${node.data.action}` === ownerKey);
  assert.ok(
    prompt.data.operationAuthoring.ancillaryParent,
    'A complete disabled parent must receive a fresh backend-declared advisory offer.',
  );
  assert.equal(
    prompt.data.operationAuthoring.ancillaryParent.parent.authoringContentHash,
    starter.authoring.contentHash,
  );
  const offer = prompt.data.operationAuthoring.ancillaryParent;
  assert.deepEqual(Object.keys(offer.parentRoleNodes).sort(), parent.roles.map(([role]) => role).sort());
  for (const [role, key] of starter.authoring.roles) {
    const actual = native.nodes.find((node) => node.id === offer.parentRoleNodes[role]);
    assert.ok(actual, `The new role ${role} must point to an actual current native leaf.`);
    assert.equal(`${actual.data.module}.${actual.data.action}`, key);
  }
  assert.equal(plan.graph.nodes.length, 4);
  assert.equal(prompt.data.operationAuthoring.ancillaryBindings, undefined);
});

test('normal Enable and reloaded Preview renew selected parent fields absent from the generic raw registry', async () => {
  const { ownerId } = await setup();
  const nextRegistry = structuredClone(registry.getState().nodesRegistry);
  const key = fixture.response.authoring.roles.find(
    ([role]) => role === fixture.response.authoring.ancillaryOperations[0].bindings.owner.role,
  )[1];
  delete nextRegistry[key].params.prompt;
  delete nextRegistry[key].params.layout_conditioning;
  registry.setState({ nodesRegistry: nextRegistry });
  await preview.enablePromptEnhancement(ownerId);
  const enabled = JSON.parse(JSON.stringify(flow.getState().toObject()));
  flow.setState(enabled);
  await preview.currentPromptEnhancementDeclaration(ownerId, fixture.response.authoring.ancillaryOperations[0].id);
  await preview.startPromptEnhancementPreview(ownerId, fixture.response.authoring.ancillaryOperations[0].id);
  assert.equal(submitted.runtimeHints.executionPurpose.kind, 'explicit_preview');
  assert.deepEqual(registry.getState().nodesRegistry, nextRegistry);
});
