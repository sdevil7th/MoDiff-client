import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let autoResourceModule;
let flowStoreModule;
let server;
let taskStoreModule;
let userBlockStoreModule;
let originalFetch;

before(async () => {
  globalThis.window = {
    dispatchEvent: () => true,
    location: { origin: 'http://127.0.0.1:5191' },
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  taskStoreModule = await server.ssrLoadModule('/src/stores/useTaskStore.ts');
  flowStoreModule = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  userBlockStoreModule = await server.ssrLoadModule('/src/stores/useUserBlockStore.ts');
  autoResourceModule = await server.ssrLoadModule('/src/studio/autoResource.ts');
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  taskStoreModule.useTaskStore.setState({
    queuedTasks: {},
    currentTask: undefined,
    failedTasks: {},
    sessionRuns: [],
    taskCount: 0,
    queueRevision: 0,
    fetchState: { status: 'idle', error: null, requestId: null },
  });
  flowStoreModule.useFlowStore.setState({
    nodes: [],
    edges: [],
  });
  userBlockStoreModule.useUserBlockStore.setState({
    blocks: [],
    loaded: false,
    error: null,
    revision: 0,
  });
});

after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
});

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function userBlock(id, name = id) {
  return {
    id,
    name,
    version: 1,
    nodes: [],
    edges: [],
    inputs: [],
    outputs: [],
    exposedParams: [],
  };
}

test('a delayed queue fetch cannot overwrite a newer websocket queue revision', async () => {
  const call = deferred();
  globalThis.fetch = () => call.promise;

  const fetchPromise = taskStoreModule.useTaskStore.getState().fetchTasks();
  taskStoreModule.useTaskStore.getState().setTasks({ name: 'Live task', task_id: 'live', status: 'running' }, {});
  call.resolve(jsonResponse({ current: { name: 'Stale task', task_id: 'stale' }, queued: {} }));
  await fetchPromise;

  const state = taskStoreModule.useTaskStore.getState();
  assert.equal(state.currentTask.task_id, 'live');
  assert.equal(state.fetchState.status, 'success');
});

test('queue response validation reports an endpoint error and a later retry recovers', async () => {
  globalThis.fetch = async () => jsonResponse({ current: null, queued: [] });
  await taskStoreModule.useTaskStore.getState().fetchTasks();
  assert.equal(taskStoreModule.useTaskStore.getState().fetchState.status, 'error');
  assert.match(taskStoreModule.useTaskStore.getState().fetchState.error, /queued task response/);

  globalThis.fetch = async () => jsonResponse({ current: null, queued: { next: { name: 'Next', task_id: 'next' } } });
  await taskStoreModule.useTaskStore.getState().fetchTasks();
  const state = taskStoreModule.useTaskStore.getState();
  assert.equal(state.fetchState.status, 'success');
  assert.equal(state.queuedTasks.next.task_id, 'next');
});

test('supervisor fallback restores active node progress and clears it on terminal recovery', async (t) => {
  const { useStudioStore } = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  const previousWorkflow = useStudioStore.getState().activeWorkflowTabId;
  useStudioStore.setState({ activeWorkflowTabId: 'workflow-1' });
  t.after(() => useStudioStore.setState({ activeWorkflowTabId: previousWorkflow }));
  flowStoreModule.useFlowStore.setState({
    nodes: [
      {
        id: 'generate',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          type: 'custom',
          module: 'modules.DiffusersImage',
          action: 'Generate',
          label: 'Generate',
          params: {},
        },
      },
    ],
    edges: [],
  });
  const snapshots = [
    {
      current: {
        name: 'Graph execution',
        task_id: 'run-1',
        status: 'running',
        current_node: 'generate',
        current_node_name: 'modules.DiffusersImage.Generate',
        node_progress: 37,
        phase: 'denoising',
        workflow_tab_id: 'workflow-1',
      },
      queued: {},
      recent: [],
    },
    {
      current: null,
      queued: {},
      recent: [
        {
          name: 'Graph execution',
          task_id: 'run-1',
          status: 'cancelled',
          current_node: 'generate',
          workflow_tab_id: 'workflow-1',
          message: 'Execution stopped by the supervisor control plane.',
        },
      ],
    },
  ];
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return jsonResponse(snapshots.shift());
  };

  await taskStoreModule.useTaskStore.getState().fetchSupervisorTasks();
  let taskState = taskStoreModule.useTaskStore.getState();
  let node = flowStoreModule.useFlowStore.getState().nodes[0];
  assert.match(requests[0], /:8089\/queue$/);
  assert.equal(taskState.currentTask.task_id, 'run-1');
  assert.equal(node.data.progress, 37);
  assert.equal(node.data.activeTaskId, 'run-1');
  assert.equal(node.data.executionStatus, 'running');

  await taskStoreModule.useTaskStore.getState().fetchSupervisorTasks();
  taskState = taskStoreModule.useTaskStore.getState();
  node = flowStoreModule.useFlowStore.getState().nodes[0];
  assert.equal(taskState.currentTask, undefined);
  assert.equal(taskState.sessionRuns.find((run) => run.id === 'run-1').status, 'cancelled');
  assert.equal(node.data.progress, 0);
  assert.equal(node.data.activeTaskId, null);
  assert.equal(node.data.executionStatus, undefined);
});

test('an older supervisor response cannot overwrite a newer websocket queue snapshot', async () => {
  const call = deferred();
  globalThis.fetch = () => call.promise;

  const fetchPromise = taskStoreModule.useTaskStore.getState().fetchSupervisorTasks();
  taskStoreModule.useTaskStore
    .getState()
    .setTasks({ name: 'Websocket task', task_id: 'websocket-live', status: 'running' }, {});
  call.resolve(
    jsonResponse({
      current: { name: 'Stale supervisor task', task_id: 'supervisor-stale', status: 'running' },
      queued: {},
      recent: [],
    }),
  );
  await fetchPromise;

  assert.equal(taskStoreModule.useTaskStore.getState().currentTask.task_id, 'websocket-live');
});

test('a delayed block fetch cannot overwrite a newer optimistic local block', async () => {
  const call = deferred();
  globalThis.fetch = () => call.promise;
  const fetchPromise = userBlockStoreModule.useUserBlockStore.getState().fetchBlocks();
  userBlockStoreModule.useUserBlockStore.getState().upsertLocalBlock(userBlock('local'));
  call.resolve(jsonResponse({ blocks: [userBlock('stale')] }));
  await fetchPromise;

  const state = userBlockStoreModule.useUserBlockStore.getState();
  assert.deepEqual(
    state.blocks.map((block) => block.id),
    ['local'],
  );
  assert.equal(state.error, null);
});

test('out-of-order block saves cannot resurrect an older version', async () => {
  const calls = [];
  globalThis.fetch = () => {
    const call = deferred();
    calls.push(call);
    return call.promise;
  };

  const first = userBlockStoreModule.useUserBlockStore.getState().saveBlock(userBlock('same', 'First'));
  const second = userBlockStoreModule.useUserBlockStore.getState().saveBlock(userBlock('same', 'Second'));
  calls[1].resolve(jsonResponse({ block: userBlock('same', 'Second saved') }));
  await second;
  calls[0].resolve(jsonResponse({ block: userBlock('same', 'First saved') }));
  await first;

  assert.equal(userBlockStoreModule.useUserBlockStore.getState().blocks[0].name, 'Second saved');
});

test('a failed block delete restores only its target and preserves concurrent edits', async () => {
  const first = userBlock('first');
  const second = userBlock('second');
  const concurrent = userBlock('concurrent');
  userBlockStoreModule.useUserBlockStore.getState().setBlocks([first, second]);
  const call = deferred();
  globalThis.fetch = () => call.promise;

  const deletion = userBlockStoreModule.useUserBlockStore.getState().deleteBlock('first');
  userBlockStoreModule.useUserBlockStore.getState().upsertLocalBlock(concurrent);
  call.resolve(jsonResponse({ error: true, message: 'Delete rejected.' }, 409));
  await assert.rejects(deletion, (error) => error.kind === 'http' && error.message === 'Delete rejected.');

  const state = userBlockStoreModule.useUserBlockStore.getState();
  assert.deepEqual(new Set(state.blocks.map((block) => block.id)), new Set(['first', 'second', 'concurrent']));
  assert.equal(state.error, 'Delete rejected.');
});

test('Auto planning preserves its error-plan API while using normalized transport failures', async () => {
  globalThis.fetch = async () => new Response('<html>bad gateway</html>', { status: 502 });
  const plan = await autoResourceModule.fetchAutoResourcePlan({ modelType: 'QwenImageModularPipeline' });
  assert.equal(plan.error, true);
  assert.equal(plan.status, 'needs_setup');
  assert.match(plan.message, /invalid JSON/);
});

test('schema-v2 Auto planning rejects a selected candidate without an exact bounded loader target', async () => {
  globalThis.fetch = async () =>
    jsonResponse({
      schemaVersion: 2,
      status: 'ready',
      compatibility: {
        state: 'ready',
        severity: 'success',
        code: 'ready',
        summary: 'Ready',
        detail: 'Ready',
        source: 'backend_auto_planner',
      },
      selectedCandidate: {
        id: 'stale-target',
        modelType: 'QwenImageModularPipeline',
        mode: 'text_to_image',
        executionPath: 'direct-diffusers-image',
      },
      candidates: [],
    });
  const plan = await autoResourceModule.fetchAutoResourcePlan({ modelType: 'QwenImageModularPipeline' });
  assert.equal(plan.error, true);
  assert.match(plan.message, /invalid response/i);
});

test('schema-v2 Auto planning accepts and preserves the backend profile-bound candidate receipt', async () => {
  const candidate = {
    id: 'flux-direct',
    autoResourceSchemaVersion: 2,
    executionProfileId: 'flux-schnell:direct',
    modelType: 'FluxSchnellPipeline',
    mode: 'text_to_image',
    loaderModule: 'modules.DiffusersImage',
    loaderAction: 'LoadPipeline',
    executionPath: 'direct-diffusers-image',
    pipelineClass: 'FluxPipeline',
    modelRepo: 'black-forest-labs/FLUX.1-schnell',
    modelDependencies: [],
    studioExecutionSpecContract: {
      schemaVersion: 1,
      id: 'flux-schnell:text-to-image:v1',
      contentHash: 'studio-spec-v1-9cd1abb5',
      executionProfileId: 'flux-schnell:direct',
    },
  };
  globalThis.fetch = async () =>
    jsonResponse({
      schemaVersion: 2,
      status: 'ready',
      compatibility: {
        state: 'ready',
        severity: 'success',
        code: 'ready',
        summary: 'Ready',
        detail: 'Ready',
        source: 'backend_auto_planner',
      },
      selectedCandidate: candidate,
      candidates: [candidate],
    });

  const plan = await autoResourceModule.fetchAutoResourcePlan({ modelType: candidate.modelType });
  assert.equal(plan.error, undefined);
  assert.equal(plan.selectedCandidate.executionProfileId, 'flux-schnell:direct');
  assert.equal(plan.selectedCandidate.autoResourceSchemaVersion, plan.schemaVersion);
  assert.deepEqual(plan.selectedCandidate.studioExecutionSpecContract, candidate.studioExecutionSpecContract);
});

test('schema-v2 Auto planning bounds candidate identity depth, count, size, and syntax', async () => {
  const candidate = {
    id: 'qwen-direct',
    modelType: 'QwenImageModularPipeline',
    mode: 'text_to_image',
    loaderModule: 'modules.DiffusersImage',
    loaderAction: 'LoadPipeline',
    executionPath: 'direct-diffusers-image',
    pipelineClass: 'QwenImagePipeline',
    modelRepo: 'Qwen/Qwen-Image-2512',
  };
  const plan = (selectedCandidate, candidates) => ({
    schemaVersion: 2,
    compatibility: {
      state: 'ready',
      severity: 'success',
      code: 'ready',
      summary: 'Ready',
      detail: 'Ready',
      source: 'backend_auto_planner',
    },
    selectedCandidate,
    candidates,
  });
  let nested = 'leaf';
  for (let depth = 0; depth < 1_200; depth += 1) nested = { nested };
  const payloads = [
    plan({ ...candidate, nested }, [{ ...candidate, nested }]),
    plan(
      candidate,
      Array.from({ length: 65 }, (_, index) => ({ ...candidate, id: `candidate-${index}` })),
    ),
    plan({ ...candidate, id: 'bad\nid' }, [{ ...candidate, id: 'bad\nid' }]),
    plan({ ...candidate, note: 'x'.repeat(65_537) }, [{ ...candidate }]),
    plan(candidate, [candidate, { ...candidate, id: 'duplicate-retry' }, { ...candidate, id: 'duplicate-retry' }]),
    plan({ ...candidate, executionPath: 'modular-diffusers' }, [{ ...candidate, executionPath: 'modular-diffusers' }]),
  ];
  for (const payload of payloads) {
    globalThis.fetch = async () => jsonResponse(payload);
    const result = await autoResourceModule.fetchAutoResourcePlan({ modelType: candidate.modelType });
    assert.equal(result.error, true);
    assert.match(result.message, /invalid response/i);
  }
});

test('Auto plan batches preserve reviewed optional-runtime targets and reject mismatched loaders', async () => {
  const targets = [
    ['modules.DiffusersImage', 'LoadPipeline', 'direct-diffusers-image'],
    ['modules.HuggingFaceSpeech', 'LoadSpeechRecognitionModel', 'direct-huggingface-speech'],
    ['modules.HuggingFaceSpeech', 'LoadCTCSpeechRecognitionModel', 'direct-huggingface-speech-ctc'],
    ['modules.HuggingFaceTransformers', 'LoadDepthEstimationModel', 'direct-huggingface-transformers-depth'],
    ['modules.HuggingFaceTransformers', 'LoadTextGenerationModel', 'direct-huggingface-transformers-text'],
    ['modules.HuggingFaceTransformers', 'LoadImageTextToTextModel', 'direct-huggingface-transformers-image-text'],
    ['modules.HuggingFaceTransformers', 'LoadAnyToAnyModel', 'direct-huggingface-transformers-any-to-any'],
  ];
  const plans = targets.map(([loaderModule, loaderAction, executionPath], index) => ({
    schemaVersion: 2,
    compatibility: {
      state: 'needs_setup',
      severity: 'warning',
      code: 'runtime_missing',
      summary: 'Install required',
      detail: 'Optional runtime requires explicit consent.',
      source: 'backend_auto_planner',
    },
    selectedCandidate: null,
    candidates: [
      {
        id: `candidate-${index}`,
        executionProfileId: `profile-${index}`,
        modelType: `Model${index}`,
        mode: 'text_to_image',
        loaderModule,
        loaderAction,
        executionPath,
        pipelineClass: `Pipeline${index}`,
        modelRepo: 'example/reviewed-model',
        optionalRuntime: { profileId: 'reviewed-runtime', installed: false },
      },
    ],
  }));
  const forms = plans.map((plan) => ({ modelType: plan.candidates[0].modelType }));
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return jsonResponse({ plans });
  };
  assert.deepEqual(await autoResourceModule.fetchAutoResourcePlans(forms), plans);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].endsWith('/auto_resource/plans'));

  for (const loaderAction of ['LoadPipeline', 'UnreviewedLoader']) {
    const invalid = structuredClone(plans);
    invalid[1].candidates[0].loaderAction = loaderAction;
    globalThis.fetch = async () => jsonResponse({ plans: invalid });
    await assert.rejects(autoResourceModule.fetchAutoResourcePlans(forms), (error) => error.kind === 'invalid_payload');
  }
});

test('Auto plan batches and history mutations reject invalid or failed responses', async () => {
  globalThis.fetch = async () => jsonResponse({ plans: [null] });
  await assert.rejects(
    autoResourceModule.fetchAutoResourcePlans([{ modelType: 'QwenImageModularPipeline' }]),
    (error) => error.kind === 'invalid_payload' && /invalid response/i.test(error.message),
  );

  globalThis.fetch = async () => jsonResponse({ message: 'History is locked.' }, 423);
  await assert.rejects(
    autoResourceModule.clearAutoResourceHistory({ modelType: 'QwenImageModularPipeline' }),
    (error) => error.kind === 'http' && error.status === 423 && error.message === 'History is locked.',
  );
});

for (const [modulePath, storeName, method, response] of [
  [
    '/src/stores/useRegisteredBlockInterfacesStore.ts',
    'useRegisteredBlockInterfacesStore',
    'fetch',
    { schemaVersion: 1, error: false, entries: [] },
  ],
  [
    '/src/stores/useHuggingFaceModularConditionalStore.ts',
    'useHuggingFaceModularConditionalStore',
    'fetchSnapshot',
    null,
  ],
]) {
  test(`${storeName} coalesces concurrent callers and permits retry after failure`, async () => {
    const store = (await server.ssrLoadModule(modulePath))[storeName];
    store.setState({ loaded: false, error: null });
    const held = deferred();
    let count = 0;
    globalThis.fetch = async () => {
      count += 1;
      await held.promise;
      return jsonResponse({ message: 'Metadata temporarily unavailable' }, 503);
    };
    const first = store.getState()[method]();
    const second = store.getState()[method]();
    assert.equal(first, second);
    assert.equal(store.getState().loaded, false);
    assert.equal(count, 1);
    held.resolve();
    await Promise.all([first, second]);
    assert.equal(store.getState().loaded, true);
    assert.ok(store.getState().error);
    globalThis.fetch = async () => {
      count += 1;
      return jsonResponse(response);
    };
    await store.getState()[method]();
    assert.equal(count, 2);
    if (response) {
      assert.equal(store.getState().error, null);
      assert.deepEqual(store.getState().entries, []);
    } else assert.ok(store.getState().error, 'Malformed conditional metadata fails closed.');
  });
}
