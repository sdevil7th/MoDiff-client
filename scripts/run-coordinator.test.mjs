import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let coordinatorModule;
let blockRuntimeModule;
let blockSchemaModule;
let blockAuthorityModule;
let clusterRuntimeStoreModule;
let fieldActionModule;
let flowStoreModule;
let nodesStoreModule;
let runIssueStoreModule;
let runPreparationModule;
let studioStoreModule;
let taskStoreModule;
let websocketModule;
let websocketStoreModule;
let server;
let originalFetch;

before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
    removeItem: (key) => storage.delete(key),
    setItem: (key, value) => storage.set(key, String(value)),
  };
  globalThis.window = {
    dispatchEvent: () => true,
    localStorage: globalThis.localStorage,
    location: { origin: 'http://127.0.0.1:5191' },
  };
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
  coordinatorModule = await server.ssrLoadModule('/src/studio/runCoordinator.ts');
  blockRuntimeModule = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  blockSchemaModule = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  blockAuthorityModule = await server.ssrLoadModule('/src/studio/blockExecutionAuthorityV2.ts');
  clusterRuntimeStoreModule = await server.ssrLoadModule('/src/stores/useHuggingFaceClusterRuntimeStore.ts');
  fieldActionModule = await server.ssrLoadModule('/src/utils/fieldAction.ts');
  flowStoreModule = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  nodesStoreModule = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  runIssueStoreModule = await server.ssrLoadModule('/src/stores/useRunIssueStore.ts');
  runPreparationModule = await server.ssrLoadModule('/src/studio/runPreparation.ts');
  studioStoreModule = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  taskStoreModule = await server.ssrLoadModule('/src/stores/useTaskStore.ts');
  websocketModule = await server.ssrLoadModule('/src/stores/websocketMessageHandler.ts');
  websocketStoreModule = await server.ssrLoadModule('/src/stores/useWebsocketStore.ts');
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  flowStoreModule.useFlowStore.setState({
    nodes: [
      {
        id: 'preview',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Preview',
          label: 'Preview',
          category: 'Test',
          params: {
            output: { type: 'image', display: 'ui_image', value: 'current-workflow.png' },
          },
        },
      },
    ],
    edges: [],
  });
  studioStoreModule.useStudioStore.setState({
    form: { ...studioStoreModule.useStudioStore.getState().form, resourceMode: 'expert' },
    activeWorkflowTabId: 'workflow-origin',
    workflowCanvasHydrated: true,
    workflowCanvasEpoch: 0,
    workflowFormEpoch: 0,
    activeTemplateId: null,
    graphBinding: null,
    workflowTabs: [],
    currentRunContext: null,
    outputs: [],
    runContextsByClientRunId: {},
    runContextsByTaskId: {},
  });
  taskStoreModule.useTaskStore.setState({
    queuedTasks: {},
    currentTask: undefined,
    failedTasks: {},
    sessionRuns: [],
    taskCount: 0,
    queueRevision: 0,
    fetchState: { status: 'idle', error: null, requestId: null },
    focusedTaskId: null,
  });
  runIssueStoreModule.useRunIssueStore.setState({
    issues: [],
    issueDialogOpen: false,
    failure: null,
    failureDialogOpen: false,
    failuresByTaskId: {},
  });
  nodesStoreModule.useNodesStore.setState({ hfDownloadProgress: {} });
  clusterRuntimeStoreModule.useHuggingFaceClusterRuntimeStore.setState({ authorities: {} });
  websocketStoreModule.useWebsocketStore.setState({ sid: 'session-1' });
});

after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
});

function deferredResponse() {
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

function graph(sid = 'session-1') {
  return {
    sid,
    nodes: {
      generate: {
        module: 'modules.Test',
        action: 'Generate',
        params: { prompt: { value: 'test prompt' } },
      },
    },
    paths: [['generate']],
  };
}

function blockV2Root(instanceId = 'coordinator-block-v2', primaryPreview = true, registered = false) {
  const graphWithoutHash = {
    nodes: [
      {
        nodeId: 'generate',
        nodeType: 'custom',
        semanticRole: 'generate',
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Generate',
          params: {
            prompt: { type: 'string', display: 'textarea', default: 'creator prompt' },
            images: { type: 'list[image]', display: 'output' },
          },
        },
      },
      {
        nodeId: 'preview',
        nodeType: 'custom',
        semanticRole: 'preview',
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Preview',
          params: { images: { type: 'list[image]', display: 'ui_image' } },
        },
      },
    ],
    edges: [
      {
        edgeId: 'preview-images',
        sourceNodeId: 'generate',
        sourcePortId: 'images',
        targetNodeId: 'preview',
        targetPortId: 'images',
      },
    ],
    executionOrder: ['generate', 'preview'],
  };
  const blockGraph = {
    ...graphWithoutHash,
    graphHash: blockSchemaModule.blockGraphHashV2(graphWithoutHash),
  };
  const definitionWithoutHash = {
    schemaVersion: 2,
    definitionId: registered
      ? 'diffusers.cluster-admission:TestModularPipeline:text2image:mode:text_to_image'
      : 'user:coordinator-target',
    displayName: 'Coordinator target block',
    source: registered
      ? {
          kind: 'diffusers_catalog',
          catalogCategory: 'diffusers',
          provider: 'huggingface',
          library: 'diffusers',
          libraryRevision: 'a'.repeat(40),
          pipelineClass: 'TestModularPipeline',
          workflow: 'text2image',
          manifestDefinitionId: 'diffusers.modular:TestModularPipeline:text2image',
          manifestContentHash: 'manifest-test-content',
          executionAdmissionId: 'diffusers.cluster-admission:TestModularPipeline:text2image:mode:text_to_image',
          repository: 'owner/model',
          repositoryRevision: 'b'.repeat(40),
        }
      : { kind: 'user' },
    graph: blockGraph,
    boundary: {
      mode: 'explicit',
      inputs: [
        {
          portId: 'prompt',
          label: 'Prompt',
          valueType: 'string',
          required: true,
          binding: { nodeId: 'generate', fieldOrPortId: 'prompt' },
        },
      ],
      outputs: [
        {
          portId: 'images',
          label: 'Images',
          valueType: 'list[image]',
          required: true,
          binding: { nodeId: 'generate', fieldOrPortId: 'images' },
        },
      ],
    },
    controls: [
      {
        controlId: 'prompt',
        label: 'Prompt',
        binding: { nodeId: 'generate', fieldId: 'prompt' },
        valueType: 'string',
        defaultValue: 'creator prompt',
        required: true,
        order: 0,
      },
    ],
    previews: [
      {
        nodeId: 'preview',
        outputPortId: 'images',
        mediaType: 'image',
        ...(primaryPreview ? { primary: true } : {}),
      },
    ],
    ownership: registered
      ? { kind: 'registered', definitionMutable: false }
      : { kind: 'user', definitionMutable: true },
  };
  const definition = {
    ...definitionWithoutHash,
    contentHash: blockSchemaModule.blockDefinitionContentHashV2(definitionWithoutHash),
  };
  return blockRuntimeModule.createBlockRootNodeV2(
    blockSchemaModule.createBlockInstanceV2(definition, {
      instanceId,
      position: { x: 100, y: 100 },
      size: { width: 560, height: 640 },
      values: { prompt: 'coordinated prompt' },
    }),
  );
}

test('a fresh supervisor-recovered worker crash opens an actionable failure with memory evidence', () => {
  const now = Date.now();
  taskStoreModule.useTaskStore.getState().setTasks(undefined, {}, [
    {
      task_id: 'native-crash-task',
      name: 'Graph execution',
      status: 'failed',
      completed_at: now / 1000,
      current_node: 'cluster-root__denoise',
      current_node_name: 'modules.ModularDiffusers.Denoise',
      phase: 'denoising',
      message: 'The backend worker exited unexpectedly during execution.',
      category: 'runtime',
      error_code: 'backend_worker_exited',
      recovery_hint: 'Retry with a lower-memory resource plan.',
      resource_snapshot: {
        process: { rssBytes: 30 * 1024 ** 3 },
        system: { ramAvailableBytes: 38 * 1024 ** 3 },
        accelerators: [{ allocatedBytes: 58 * 1024 ** 3 }],
      },
    },
  ]);

  const issues = runIssueStoreModule.useRunIssueStore.getState();
  assert.equal(issues.failureDialogOpen, true);
  assert.equal(issues.failure?.taskId, 'native-crash-task');
  assert.equal(issues.failure?.errorCode, 'backend_worker_exited');
  assert.match(issues.failure?.memorySummary ?? '', /worker RAM 30\.0 GiB/);
  assert.match(issues.failure?.memorySummary ?? '', /accelerator allocations 58\.0 GiB/);

  issues.closeFailure();
  taskStoreModule.useTaskStore.getState().setTasks(undefined, {}, [
    {
      task_id: 'native-crash-task',
      name: 'Graph execution',
      status: 'failed',
      completed_at: now / 1000,
      error_code: 'backend_worker_exited',
    },
  ]);
  assert.equal(runIssueStoreModule.useRunIssueStore.getState().failureDialogOpen, false);
});

test('queue hydration retains newest activity and never evicts an active submission with older history', () => {
  const tasks = taskStoreModule.useTaskStore.getState();
  const recent = Array.from({ length: 40 }, (_, index) => ({
    task_id: `history-${index}`,
    name: `Historical run ${index}`,
    status: 'completed',
    queued_at: 1000 - index * 10,
    started_at: 1001 - index * 10,
    completed_at: 1002 - index * 10,
  }));
  tasks.setTasks(undefined, {}, recent);
  assert.deepEqual(
    taskStoreModule.useTaskStore.getState().sessionRuns.map(({ id }) => id),
    recent.slice(0, 30).map(({ task_id }) => task_id),
  );
  tasks.recordTaskSnapshot({ task_id: 'new-submission', name: 'Qwen cluster', status: 'queued' });
  tasks.setTasks(undefined, {}, recent);
  assert.equal(taskStoreModule.useTaskStore.getState().sessionRuns[0].id, 'new-submission');
  tasks.setTasks(undefined, {}, [...recent].reverse());
  assert.equal(taskStoreModule.useTaskStore.getState().sessionRuns[0].id, 'new-submission');
  tasks.recordTaskSnapshot({ task_id: 'new-submission', name: 'Qwen cluster', status: 'failed', completed_at: 2000 });
  tasks.setTasks(undefined, {}, recent);
  const runs = taskStoreModule.useTaskStore.getState().sessionRuns;
  assert.equal(runs[0].id, 'new-submission');
  assert.equal(runs[0].status, 'failed');
  assert.equal(runs.length, 30);
  assert.deepEqual(
    runs.slice(1).map(({ id }) => id),
    recent.slice(0, 29).map(({ task_id }) => task_id),
  );
});

test('queue overflow retains the running task ahead of newer waiting tasks across repeated snapshots', () => {
  const tasks = taskStoreModule.useTaskStore.getState();
  const current = {
    task_id: 'running-now',
    name: 'Running cluster',
    status: 'running',
    queued_at: 1000,
    started_at: 1001,
  };
  const waiting = Array.from({ length: 40 }, (_, index) => ({
    task_id: `waiting-${index}`,
    name: `Waiting ${index}`,
    queued_at: 1100 + index,
  }));
  const queue = (items) => Object.fromEntries(items.map((task) => [task.task_id, task]));
  tasks.setTasks(undefined, queue(waiting));
  assert.deepEqual(
    taskStoreModule.useTaskStore.getState().sessionRuns.map(({ id }) => id),
    waiting
      .slice(-30)
      .reverse()
      .map(({ task_id }) => task_id),
  );
  for (const items of [waiting, [...waiting].reverse(), waiting]) {
    tasks.setTasks(current, queue(items));
    const state = taskStoreModule.useTaskStore.getState();
    assert.equal(state.currentTask.task_id, current.task_id);
    assert.equal(state.taskCount, 41);
    assert.equal(state.sessionRuns.length, 30);
    assert.equal(state.sessionRuns[0].id, current.task_id);
    assert.deepEqual(
      state.sessionRuns.slice(1).map(({ id }) => id),
      waiting
        .slice(-29)
        .reverse()
        .map(({ task_id }) => task_id),
    );
  }
  tasks.recordTaskSnapshot({ ...current, progress: 50 });
  assert.equal(taskStoreModule.useTaskStore.getState().sessionRuns[0].progress, 50);
});

test('submission rejects an invalid User Node composition with an actionable socket error', async () => {
  const source = {
    id: 'source',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'ImageSource',
      label: 'Image source',
      category: 'Test',
      params: { output: { type: 'image', display: 'output' } },
    },
  };
  const target = {
    id: 'target',
    type: 'custom',
    position: { x: 300, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'TextSink',
      label: 'Text sink',
      category: 'Test',
      params: { value: { type: 'string', display: 'input', isInput: true } },
    },
  };
  const definition = {
    id: 'invalid-composition',
    name: 'Invalid composition',
    version: 1,
    nodes: [source, target],
    edges: [
      {
        id: 'bad-edge',
        source: source.id,
        sourceHandle: 'output',
        target: target.id,
        targetHandle: 'value',
      },
    ],
    inputs: [],
    outputs: [],
    exposedParams: [],
    createdAt: 1,
    updatedAt: 1,
  };
  flowStoreModule.useFlowStore.setState({
    nodes: [
      {
        id: 'invalid-instance',
        type: 'block',
        position: { x: 0, y: 0 },
        data: {
          type: 'block',
          module: 'modiff.user_blocks',
          action: definition.id,
          label: definition.name,
          category: 'User Nodes',
          params: {},
          userBlockId: definition.id,
          userBlockSnapshot: definition,
          uiState: { blockExpanded: false },
        },
      },
    ],
    edges: [],
  });
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return jsonResponse({ task_id: 'must-not-submit' });
  };

  await assert.rejects(
    coordinatorModule.coordinateGraphRun({ sid: 'session-1' }),
    /User Node "Invalid composition" cannot run: Image source\.output \(image\) cannot connect to Text sink\.value \(string\)/u,
  );
  assert.equal(requestCount, 0);
});

test('a historical registered V2 fixture needs a graph resource plan even if it carries old Auto authority', async () => {
  const registeredRoot = blockV2Root('registered-coordinator-block-v2', true, true);
  flowStoreModule.useFlowStore.setState({ nodes: [registeredRoot], edges: [] });
  const baseForm = studioStoreModule.useStudioStore.getState().form;
  studioStoreModule.useStudioStore.setState({ form: { ...baseForm, resourceMode: 'auto' } });
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return requestCount === 2
      ? jsonResponse({ task_id: 'registered-v2-run', sid: 'session-1', message: 'queued' })
      : jsonResponse(workflowPlan(false));
  };

  await assert.rejects(
    coordinatorModule.coordinateGraphRun({ sid: 'session-1', targetNodeId: registeredRoot.id }),
    /Auto cannot run this workflow: No reviewed recipe/u,
  );
  assert.equal(requestCount, 1);
  const blocked = runIssueStoreModule.useRunIssueStore.getState();
  assert.equal(blocked.issueDialogOpen, true);
  assert.match(blocked.issues[0].message, /No reviewed recipe/);
  assert.match(blocked.issues[0].details, /No run was submitted/);
  assert.equal(blocked.failure, null, 'planning rejection is not a failed model task');
  assert.equal(studioStoreModule.useStudioStore.getState().currentRunContext, null);

  studioStoreModule.useStudioStore.setState({ form: { ...baseForm, resourceMode: 'expert' } });
  const manual = await coordinatorModule.coordinateGraphRun({
    sid: 'session-1',
    targetNodeId: registeredRoot.id,
  });
  assert.equal(requestCount, 2);
  assert.equal(manual.response.task_id, 'registered-v2-run');
  assert.equal(manual.submittedGraph.nodes[registeredRoot.id], undefined);
  assert.equal(JSON.stringify(manual.submittedGraph.nodes).includes('blockInstanceV2'), false);

  const instance = registeredRoot.data.blockInstanceV2;
  const now = Date.now();
  const authorized = blockSchemaModule.normalizeBlockInstanceV2({
    ...instance,
    authorities: [
      {
        kind: 'auto',
        definitionId: instance.definitionRef.definitionId,
        definitionContentHash: instance.definitionRef.contentHash,
        effectiveGraphHash: instance.effectiveGraph.graphHash,
        executionParameterHash: blockAuthorityModule.blockExecutionParameterHashV2(instance),
        artifactRevisions: { 'owner/model': 'b'.repeat(40) },
        admissionId: instance.definitionSnapshot.source.executionAdmissionId,
        issuedAt: new Date(now - 60_000).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(),
      },
    ],
  });
  flowStoreModule.useFlowStore.setState({
    nodes: [blockRuntimeModule.createBlockRootNodeV2(authorized)],
    edges: [],
  });
  studioStoreModule.useStudioStore.setState({ form: { ...baseForm, resourceMode: 'auto' } });
  await assert.rejects(
    coordinatorModule.coordinateGraphRun({ sid: 'session-1', targetNodeId: registeredRoot.id }),
    /Auto cannot run this workflow: No reviewed recipe/u,
  );
  assert.equal(requestCount, 3);
  studioStoreModule.useStudioStore.setState({ form: baseForm });
});

test('an untargeted two-Block graph uses the existing executor in both Expert and graph Auto', async () => {
  const first = blockV2Root('registered-expert-first', true, true);
  const second = blockV2Root('registered-expert-second', true, true);
  flowStoreModule.useFlowStore.setState({ nodes: [first, second], edges: [] });
  const baseForm = studioStoreModule.useStudioStore.getState().form;
  studioStoreModule.useStudioStore.setState({ form: { ...baseForm, resourceMode: 'expert' } });
  let requestCount = 0;
  globalThis.fetch = async (url) => {
    requestCount += 1;
    if (String(url).endsWith('/auto_resource/workflow')) return jsonResponse(workflowPlan(true));
    return jsonResponse({ task_id: 'two-block-expert-run', sid: 'session-1', message: 'queued' });
  };

  const manual = await coordinatorModule.coordinateGraphRun({ sid: 'session-1' });
  assert.equal(manual.response.task_id, 'two-block-expert-run');
  assert.equal(requestCount, 1);
  assert.equal(Object.keys(manual.submittedGraph.nodes).length, 4);
  assert.equal(JSON.stringify(manual.submittedGraph.nodes).includes('blockInstanceV2'), false);

  studioStoreModule.useStudioStore.setState({ form: { ...baseForm, resourceMode: 'auto' } });
  const automatic = await coordinatorModule.coordinateGraphRun({ sid: 'session-1' });
  assert.equal(Object.keys(automatic.submittedGraph.nodes).length, 4);
  assert.equal(automatic.submittedGraph.runtimeHints.resourceMode, 'auto');
  assert.equal(automatic.submittedGraph.runtimeHints.workflowAutoPlan.graphHash, workflowPlan(true).plannedGraphHash);
  assert.equal(requestCount, 3);
  const asApp = await coordinatorModule.coordinateGraphRun({
    sid: 'session-1',
    studioContext: { applyRuntimeMetadata: false },
  });
  assert.equal(asApp.submittedGraph.runtimeHints.resourceMode, 'auto');
  assert.equal(asApp.submittedGraph.runtimeHints.workflowAutoPlan.graphHash, workflowPlan(true).plannedGraphHash);
  assert.equal(requestCount, 5);
  studioStoreModule.useStudioStore.setState({ form: baseForm });
});

test('out-of-order graph responses attach to their immutable submission contexts', async () => {
  const requests = [];
  globalThis.fetch = (_url, init) => {
    const response = deferredResponse();
    requests.push({ body: JSON.parse(init.body), response });
    return response.promise;
  };

  const firstRun = coordinatorModule.coordinateGraphRun({
    sid: 'session-1',
    preparedGraph: graph(),
    studioContext: { applyRuntimeMetadata: false, clearChangedPreviews: false },
  });
  const firstClientRunId = studioStoreModule.useStudioStore.getState().currentRunContext.clientRunId;

  const secondRun = coordinatorModule.coordinateGraphRun({
    sid: 'session-1',
    preparedGraph: graph(),
    studioContext: { applyRuntimeMetadata: false, clearChangedPreviews: false },
  });
  const secondClientRunId = studioStoreModule.useStudioStore.getState().currentRunContext.clientRunId;

  assert.notEqual(firstClientRunId, secondClientRunId);
  assert.equal(requests.length, 2);

  requests[1].response.resolve(jsonResponse({ task_id: 'task-second', sid: 'session-1', message: 'queued second' }));
  await secondRun;

  requests[0].response.resolve(jsonResponse({ task_id: 'task-first', sid: 'session-1', message: 'queued first' }));
  await firstRun;

  const state = studioStoreModule.useStudioStore.getState();
  assert.equal(state.currentRunContext.clientRunId, secondClientRunId);
  assert.equal(state.currentRunContext.run.taskId, 'task-second');
  assert.equal(state.runContextsByTaskId['task-first'].clientRunId, firstClientRunId);
  assert.equal(state.runContextsByTaskId['task-second'].clientRunId, secondClientRunId);
  assert.equal(state.runContextsByClientRunId[firstClientRunId].run.taskId, 'task-first');
  assert.equal(state.runContextsByClientRunId[secondClientRunId].run.taskId, 'task-second');
});

test('Studio submission sends the same correlation identity that the store captures', async () => {
  let submittedGraph;
  globalThis.fetch = async (_url, init) => {
    submittedGraph = JSON.parse(init.body);
    return jsonResponse({ task_id: 'task-correlated', sid: 'session-1', message: 'queued' });
  };

  const result = await coordinatorModule.coordinateGraphRun({
    sid: 'session-1',
    preparedGraph: graph(),
    studioContext: { clearChangedPreviews: false },
  });

  assert.equal(submittedGraph.runtimeHints.clientRunId, result.context.clientRunId);
  assert.equal(submittedGraph.runtimeHints.runInputHash, result.context.runInputHash);
  assert.equal(submittedGraph.runtimeHints.workflowCanvasEpoch, 0);
  assert.equal(result.response.task_id, 'task-correlated');
  assert.equal(
    studioStoreModule.useStudioStore.getState().runContextsByTaskId['task-correlated'].clientRunId,
    result.context.clientRunId,
  );
});

test('Expert Studio submission retains its executed resource recipe while imported graphs stay generic', async () => {
  const baseForm = studioStoreModule.useStudioStore.getState().form;
  const expertForm = {
    ...baseForm,
    modelType: 'QwenImageModularPipeline',
    resourceMode: 'expert',
    dtype: 'bfloat16',
    quantizationMode: 'none',
    autoOffload: false,
    offloadMode: 'none',
    device: 'cuda:0',
  };
  studioStoreModule.useStudioStore.setState({ form: expertForm });
  let submittedGraph;
  globalThis.fetch = async (_url, init) => {
    submittedGraph = JSON.parse(init.body);
    return jsonResponse({ task_id: 'task-expert-studio', sid: 'session-1', message: 'queued' });
  };

  await coordinatorModule.coordinateGraphRun({
    sid: 'session-1',
    preparedGraph: graph(),
    studioContext: { clearChangedPreviews: false },
  });

  assert.equal(submittedGraph.runtimeHints.source, 'studio');
  assert.equal(submittedGraph.runtimeHints.modelType, expertForm.modelType);
  assert.equal(submittedGraph.runtimeHints.resourceMode, 'expert');
  assert.equal(submittedGraph.runtimeHints.resolvedResourceMode, 'expert');
  assert.equal(submittedGraph.runtimeHints.dtype, 'bfloat16');
  assert.equal(submittedGraph.runtimeHints.quantizationMode, 'none');
  assert.equal(submittedGraph.runtimeHints.autoOffload, false);
  assert.equal(submittedGraph.runtimeHints.offloadMode, 'none');
  assert.equal(submittedGraph.runtimeHints.device, 'cuda:0');
});

test('Cluster submission fingerprints and captures its authorized Auto form', async () => {
  let submittedGraph;
  globalThis.fetch = async (_url, init) => {
    submittedGraph = JSON.parse(init.body);
    return jsonResponse({ task_id: 'task-cluster-form', sid: 'session-1', message: 'queued' });
  };
  const globalForm = {
    ...studioStoreModule.useStudioStore.getState().form,
    prompt: 'canvas prompt',
    resourceMode: 'expert',
  };
  const clusterForm = {
    ...globalForm,
    prompt: 'authorized cluster prompt',
    resourceMode: 'auto',
    dtype: 'bfloat16',
    offloadMode: 'model_cpu',
  };
  studioStoreModule.useStudioStore.setState({ form: globalForm });
  nodesStoreModule.useNodesStore.setState({
    runtimeStatus: { ready: true, runtime_fingerprint: 'cluster-runtime-fingerprint' },
  });
  clusterRuntimeStoreModule.useHuggingFaceClusterRuntimeStore.setState({
    authorities: {
      cluster: {
        schemaVersion: 1,
        instanceId: 'cluster',
        definitionId: 'definition',
        admissionId: 'admission',
        executionFingerprint: 'execution-fingerprint',
        runtimeFingerprint: 'cluster-runtime-fingerprint',
        checkedAt: 1,
        claim: 'qualification_execution_authorized',
        publicationExecutable: false,
        nodeIds: ['generate'],
        bindingValues: {},
        form: clusterForm,
        runtimeHints: { source: 'diffusers-cluster', resourceMode: 'auto' },
      },
    },
  });

  const result = await coordinatorModule.coordinateGraphRun({
    sid: 'session-1',
    preparedGraph: graph(),
  });

  assert.equal(submittedGraph.runtimeHints.source, 'diffusers-cluster');
  assert.equal(submittedGraph.runtimeHints.workflowSnapshot.studioForm.modelType, clusterForm.modelType);
  assert.equal(submittedGraph.runtimeHints.workflowSnapshot.studioForm.prompt, 'authorized cluster prompt');
  assert.equal(submittedGraph.runtimeHints.workflowSnapshot.studioForm.resourceMode, 'auto');
  assert.equal(result.context.form.prompt, 'authorized cluster prompt');
  assert.equal(result.context.form.resourceMode, 'auto');
  assert.equal(result.context.runInputHash, runPreparationModule.getStudioRunInputHash(clusterForm, graph()));
  assert.notEqual(result.context.runInputHash, runPreparationModule.getStudioRunInputHash(globalForm, graph()));
});

test('queued submission preserves the active canvas owner until its exact task starts', async () => {
  let submission = 0;
  globalThis.fetch = async () => {
    submission += 1;
    return jsonResponse({
      task_id: submission === 1 ? 'task-active' : 'task-queued',
      sid: 'session-1',
      message: 'queued',
    });
  };
  studioStoreModule.useStudioStore.setState({
    graphBinding: {
      mode: 'text_to_image',
      modelType: 'ZImageModularPipeline',
      nodes: { preview: 'preview' },
      managedNodeIds: ['preview'],
      managedEdgeIds: [],
      fingerprint: 'queue-ownership',
      createdAt: 1,
      updatedAt: 1,
    },
  });

  const active = await coordinatorModule.coordinateGraphRun({
    sid: 'session-1',
    preparedGraph: graph(),
    studioContext: { applyRuntimeMetadata: false, clearChangedPreviews: false },
  });
  studioStoreModule.useStudioStore
    .getState()
    .markRunContextStatus('task-active', active.context.clientRunId, 'running');

  const queued = await coordinatorModule.coordinateGraphRun({
    sid: 'session-1',
    preparedGraph: graph(),
    studioContext: { applyRuntimeMetadata: false },
    deferCanvasOwnership: true,
  });

  let studio = studioStoreModule.useStudioStore.getState();
  assert.equal(studio.currentRunContext.clientRunId, active.context.clientRunId);
  assert.equal(studio.runContextsByTaskId['task-queued'].clientRunId, queued.context.clientRunId);
  assert.equal(
    studio.shouldApplyRunUpdateToActiveWorkflow('task-active', active.context.clientRunId, 'workflow-origin'),
    true,
  );
  assert.equal(
    studio.shouldApplyRunUpdateToActiveWorkflow('task-queued', queued.context.clientRunId, 'workflow-origin'),
    false,
  );
  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'value'), 'current-workflow.png');

  websocketModule.handleWebsocketMessage(
    {
      type: 'task_started',
      task_id: 'task-queued',
      client_run_id: queued.context.clientRunId,
      sid: 'session-1',
      current: {
        name: 'Graph execution',
        task_id: 'task-queued',
        client_run_id: queued.context.clientRunId,
        sid: 'session-1',
        status: 'running',
      },
      queued: {},
    },
    {
      sid: 'session-1',
      ws: {},
      getSid: () => 'session-1',
      setSid: () => undefined,
      setLoopTimer: () => undefined,
    },
  );

  studio = studioStoreModule.useStudioStore.getState();
  assert.equal(studio.currentRunContext.clientRunId, queued.context.clientRunId);
  assert.equal(
    studio.shouldApplyRunUpdateToActiveWorkflow('task-queued', queued.context.clientRunId, 'workflow-origin'),
    true,
  );
  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'value'), null);
});

test('field actions send the workflow tab and canvas epoch captured at dispatch', async () => {
  studioStoreModule.useStudioStore.setState({
    activeWorkflowTabId: 'workflow-field-action',
    workflowCanvasEpoch: 23,
  });
  let submitted;
  globalThis.fetch = async (_url, init) => {
    submitted = JSON.parse(init.body);
    return jsonResponse({ error: false, task_id: 'field-action-task' });
  };

  await fieldActionModule.default(
    {
      nodeId: 'preview',
      fieldKey: 'output',
      module: 'modules.Test',
      action: 'Preview',
      onChange: 'refresh',
      fieldOptions: { queue: true },
      updateStore: () => undefined,
    },
    'next-value',
  );

  assert.equal(submitted.sid, 'session-1');
  assert.equal(submitted.workflowTabId, 'workflow-field-action');
  assert.equal(submitted.workflowCanvasEpoch, 23);
  assert.equal(submitted.queue, true);
});

test('managed signal dispatch suppresses only its exact automatic handle action once', () => {
  const signal = { direction: 'input', value: 'WanImage2VideoModularPipeline' };
  const replacement = { direction: 'input', value: 'WanImage2VideoModularPipeline' };

  fieldActionModule.suppressNextAutomaticSignalFieldAction('denoise', 'unet', signal);
  assert.equal(
    fieldActionModule.consumeAutomaticSignalFieldActionSuppression('denoise', 'unet', replacement),
    false,
    'an equal-looking but distinct user/edge signal is not suppressed',
  );
  fieldActionModule.suppressNextAutomaticSignalFieldAction('denoise', 'unet', signal);
  assert.equal(fieldActionModule.consumeAutomaticSignalFieldActionSuppression('denoise', 'unet', signal), true);
  assert.equal(
    fieldActionModule.consumeAutomaticSignalFieldActionSuppression('denoise', 'unet', signal),
    false,
    'the programmatic suppression is single use',
  );
});

test('field schema actions invert hide conditions, merge the target, and preserve registry defaults', async () => {
  const showVisibility = [];
  const showProps = {
    nodeId: 'preview',
    fieldKey: 'controlnet_variant',
    module: 'modules.ModularDiffusers',
    action: 'Controlnet',
    onChange: { union: ['control_mode'] },
    updateStore: (field, value, prop) => showVisibility.push({ field, value, prop }),
  };
  await fieldActionModule.default(showProps, 'ordinary');
  await fieldActionModule.default(showProps, 'union');
  assert.deepEqual(showVisibility, [
    { field: 'control_mode', value: true, prop: 'hidden' },
    { field: 'control_mode', value: false, prop: 'hidden' },
  ]);

  const visibility = [];
  const visibilityProps = {
    nodeId: 'preview',
    fieldKey: 'source',
    module: 'modules.Test',
    action: 'Preview',
    onChange: { action: 'hide', data: { yes: ['target'] } },
    updateStore: (field, value, prop) => visibility.push({ field, value, prop }),
  };
  await fieldActionModule.default(visibilityProps, 'yes');
  await fieldActionModule.default(visibilityProps, 'no');
  assert.deepEqual(visibility, [
    { field: 'target', value: true, prop: 'hidden' },
    { field: 'target', value: false, prop: 'hidden' },
  ]);

  flowStoreModule.useFlowStore.setState((state) => ({
    nodes: state.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        params: {
          source: { fieldOptions: { sourceOnly: true } },
          target: { fieldOptions: { targetOnly: true } },
        },
      },
    })),
  }));
  const optionUpdates = [];
  await fieldActionModule.default(
    {
      ...visibilityProps,
      onChange: { action: 'value', target: 'target', prop: 'fieldOptions', data: { yes: { added: true } } },
      updateStore: (field, value, prop) => optionUpdates.push({ field, value, prop }),
    },
    'yes',
  );
  assert.deepEqual(optionUpdates, [
    { field: 'target', value: { targetOnly: true, added: true }, prop: 'fieldOptions' },
  ]);

  const registry = nodesStoreModule.useNodesStore.getState().nodesRegistry;
  nodesStoreModule.useNodesStore.setState({
    nodesRegistry: {
      ...registry,
      'modules.Test.Preview': {
        module: 'modules.Test',
        action: 'Preview',
        label: 'Preview',
        category: 'Test',
        params: { target: { display: 'input', type: 'string', value: 'registry-default' } },
      },
    },
  });
  flowStoreModule.useFlowStore.setState((state) => ({
    nodes: state.nodes.map((node) => ({
      ...node,
      data: { ...node.data, params: { target: { display: 'input', type: 'string', value: 'node-current' } } },
    })),
  }));
  await fieldActionModule.default(
    {
      ...visibilityProps,
      onChange: { action: 'create', data: { yes: { target: { display: 'output', type: 'image' } } } },
      updateStore: () => undefined,
    },
    'yes',
  );
  const created = flowStoreModule.useFlowStore.getState().nodes[0].data.params.target;
  assert.equal(created.value, 'node-current');
  assert.equal(created.display, 'output');
  assert.equal(created.type, 'image');
  assert.equal(
    nodesStoreModule.useNodesStore.getState().nodesRegistry['modules.Test.Preview'].params.target.value,
    'registry-default',
  );
});

test('value signal actions pass backend model identities through without a client allowlist', async () => {
  const updates = [];

  await fieldActionModule.default(
    {
      nodeId: 'preview',
      fieldKey: 'output',
      module: 'modules.Contract',
      action: 'DynamicTask',
      onSignal: { action: 'value', target: 'model_type' },
      updateStore: (field, value, prop) => updates.push({ field, value, prop }),
    },
    'FutureRegisteredModularPipeline',
    'onSignal',
  );

  assert.deepEqual(updates, [
    {
      field: 'model_type',
      value: 'FutureRegisteredModularPipeline',
      prop: 'value',
    },
  ]);
});

test('value signal actions pass structured execution identities without interpreting their fields', async () => {
  const updates = [];
  const identity = {
    version: 1,
    source: 'hub',
    repository: 'example/custom-modular',
    revision: 'a'.repeat(40),
    execution_id: 'b'.repeat(64),
    backend_extension: { arbitrary: ['opaque', 7] },
  };

  await fieldActionModule.default(
    {
      nodeId: 'preview',
      fieldKey: 'output',
      module: 'modules.Contract',
      action: 'DynamicTask',
      onSignal: { action: 'value', target: 'modiff_pipeline_identity' },
      updateStore: (field, value, prop) => updates.push({ field, value, prop }),
    },
    identity,
    'onSignal',
  );

  assert.deepEqual(updates, [{ field: 'modiff_pipeline_identity', value: identity, prop: 'value' }]);
});

test('option signal actions preserve single- and multi-select value shapes', async () => {
  flowStoreModule.useFlowStore.setState((state) => ({
    nodes: state.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        params: {
          guider: { type: 'string', display: 'select', value: 'ClassifierFreeGuidance' },
          scheduler: { type: 'string', display: 'select', value: 'EulerDiscreteScheduler' },
          blocks: {
            type: 'string',
            display: 'select',
            value: ['transformer_blocks'],
            fieldOptions: { multiple: true },
          },
        },
      },
    })),
  }));
  const updateStore = (field, value, prop = 'value') =>
    flowStoreModule.useFlowStore.getState().setParam('preview', field, value, prop);

  await fieldActionModule.default(
    {
      nodeId: 'preview',
      fieldKey: 'contract',
      module: 'modules.Contract',
      action: 'DynamicOptions',
      onSignal: {
        action: 'value',
        target: 'scheduler',
        prop: 'options',
        data: { ModelA: ['FlowMatchEulerDiscreteScheduler', 'DDIMScheduler'] },
      },
      updateStore,
    },
    'ModelA',
    'onSignal',
  );
  await fieldActionModule.default(
    {
      nodeId: 'preview',
      fieldKey: 'contract',
      module: 'modules.Contract',
      action: 'DynamicOptions',
      onSignal: {
        action: 'value',
        target: 'guider',
        prop: 'options',
        data: { ModelA: ['ClassifierFreeGuidance', 'AutoGuidance'] },
      },
      updateStore,
    },
    'ModelA',
    'onSignal',
  );
  await fieldActionModule.default(
    {
      nodeId: 'preview',
      fieldKey: 'contract',
      module: 'modules.Contract',
      action: 'DynamicOptions',
      onSignal: {
        action: 'value',
        target: 'blocks',
        prop: 'options',
        data: { ModelA: ['transformer_blocks', 'single_transformer_blocks'] },
      },
      updateStore,
    },
    'ModelA',
    'onSignal',
  );
  await new Promise((resolve) => queueMicrotask(resolve));

  const flow = flowStoreModule.useFlowStore.getState();
  assert.equal(flow.getParam('preview', 'guider', 'value'), 'ClassifierFreeGuidance');
  assert.equal(flow.getParam('preview', 'scheduler', 'value'), 'FlowMatchEulerDiscreteScheduler');
  assert.deepEqual(flow.getParam('preview', 'blocks', 'value'), ['transformer_blocks']);
});

test('hidden execution identity changes participate in the Studio run input hash', () => {
  const form = studioStoreModule.useStudioStore.getState().form;
  const baseGraph = graph();
  const graphWithIdentity = (executionId) => ({
    ...baseGraph,
    nodes: {
      ...baseGraph.nodes,
      generate: {
        ...baseGraph.nodes.generate,
        params: {
          ...baseGraph.nodes.generate.params,
          modiff_pipeline_identity: {
            value: {
              version: 1,
              source: 'hub',
              repository: 'example/custom-modular',
              revision: 'a'.repeat(40),
              execution_id: executionId,
            },
          },
        },
      },
    },
  });

  const first = runPreparationModule.getStudioRunInputHash(form, graphWithIdentity('1'.repeat(64)));
  const same = runPreparationModule.getStudioRunInputHash(form, graphWithIdentity('1'.repeat(64)));
  const second = runPreparationModule.getStudioRunInputHash(form, graphWithIdentity('2'.repeat(64)));
  assert.equal(first, same);
  assert.notEqual(first, second);
});

test('imported graph submission captures generic correlation without Studio resource metadata', async () => {
  const currentStudio = studioStoreModule.useStudioStore.getState();
  studioStoreModule.useStudioStore.setState({
    workflowTabs: [
      {
        id: 'workflow-origin',
        title: 'Imported workflow',
        createdAt: 1,
        updatedAt: 1,
        dirty: false,
        source: 'import',
        snapshot: {
          nodes: flowStoreModule.useFlowStore.getState().nodes,
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          studioForm: currentStudio.form,
          studioGraphBinding: null,
          selectedMode: currentStudio.selectedMode,
          activeTemplateId: null,
          sourceOutputId: null,
          pinnedGraphInputIds: [],
        },
      },
    ],
  });

  let submittedGraph;
  globalThis.fetch = async (_url, init) => {
    submittedGraph = JSON.parse(init.body);
    return jsonResponse({ task_id: 'task-imported', sid: 'session-1', message: 'queued' });
  };

  const result = await coordinatorModule.coordinateGraphRun({
    sid: 'session-1',
    targetNodeId: 'preview',
  });

  assert.equal(submittedGraph.runtimeHints.clientRunId, result.context.clientRunId);
  assert.equal(submittedGraph.runtimeHints.runInputHash, result.context.runInputHash);
  assert.equal(submittedGraph.runtimeHints.workflowTabId, 'workflow-origin');
  assert.equal(submittedGraph.runtimeHints.workflowTitle, 'Imported workflow');
  assert.equal(submittedGraph.runtimeHints.nodeId, 'preview');
  assert.equal(submittedGraph.runtimeHints.workflowSnapshot.nodes[0].id, 'preview');
  for (const managedOnlyField of [
    'source',
    'device',
    'modelFamily',
    'modelType',
    'modelRepo',
    'resourceMode',
    'resourcePlan',
    'autoResourcePlan',
  ]) {
    assert.equal(submittedGraph.runtimeHints[managedOnlyField], undefined, managedOnlyField);
  }

  assert.equal(result.context.apiGraph.runtimeHints.clientRunId, result.context.clientRunId);
  assert.equal(result.response.task_id, 'task-imported');
  const sessionRun = taskStoreModule.useTaskStore.getState().sessionRuns.find((run) => run.id === 'task-imported');
  assert.equal(sessionRun.client_run_id, result.context.clientRunId);
  assert.equal(sessionRun.run_input_hash, result.context.runInputHash);
  assert.equal(sessionRun.workflow_tab_id, 'workflow-origin');
  assert.equal(sessionRun.workflow_title, 'Imported workflow');
  assert.equal(sessionRun.workflow_snapshot.nodes[0].id, 'preview');
  assert.equal(sessionRun.node_id, 'preview');
  assert.equal(sessionRun.status, 'queued');
});

test('run from a V2 root submits its primary preview path without executable wrapper authority', async () => {
  const root = blockV2Root();
  const firstDeclaredFallback = blockV2Root('coordinator-block-v2-fallback', false);
  assert.equal(
    flowStoreModule.resolveFlowExecutionTargetNodeId([firstDeclaredFallback], firstDeclaredFallback.id),
    blockRuntimeModule.blockProjectionNodeIdV2(firstDeclaredFallback.id, 'preview'),
  );
  const diagnosticBase = blockV2Root('coordinator-block-v2-terminal-selection').data.blockInstanceV2;
  const diagnosticDefinitionWithoutHash = {
    ...structuredClone(diagnosticBase.definitionSnapshot),
    previews: [
      { nodeId: 'generate', outputPortId: 'prompt', mediaType: 'text', primary: true },
      { nodeId: 'preview', outputPortId: 'images', mediaType: 'image' },
    ],
  };
  delete diagnosticDefinitionWithoutHash.contentHash;
  const diagnosticDefinition = {
    ...diagnosticDefinitionWithoutHash,
    contentHash: blockSchemaModule.blockDefinitionContentHashV2(diagnosticDefinitionWithoutHash),
  };
  const diagnosticRoot = blockRuntimeModule.createBlockRootNodeV2(
    blockSchemaModule.createBlockInstanceV2(diagnosticDefinition, {
      instanceId: 'coordinator-block-v2-terminal-selection',
      position: { x: 0, y: 0 },
      size: { width: 560, height: 640 },
      values: { prompt: 'coordinated prompt' },
    }),
  );
  assert.equal(
    flowStoreModule.resolveFlowExecutionTargetNodeId([diagnosticRoot], diagnosticRoot.id),
    blockRuntimeModule.blockProjectionNodeIdV2(diagnosticRoot.id, 'preview'),
    'an intermediate diagnostic marked primary must not truncate the terminal media path',
  );
  flowStoreModule.useFlowStore.setState({ nodes: [root], edges: [] });
  let submittedGraph;
  globalThis.fetch = async (_url, init) => {
    submittedGraph = JSON.parse(init.body);
    return jsonResponse({ task_id: 'task-block-v2', sid: 'session-1', message: 'queued' });
  };

  const result = await coordinatorModule.coordinateGraphRun({
    sid: 'session-1',
    targetNodeId: root.id,
  });
  const previewTarget = blockRuntimeModule.blockProjectionNodeIdV2(root.id, 'preview');
  const generateTarget = blockRuntimeModule.blockProjectionNodeIdV2(root.id, 'generate');

  assert.equal(submittedGraph.nodes[root.id], undefined);
  assert.ok(submittedGraph.nodes[generateTarget]);
  assert.ok(submittedGraph.nodes[previewTarget]);
  assert.equal(submittedGraph.paths.length, 1);
  assert.equal(submittedGraph.paths[0].at(-1), previewTarget);
  assert.equal(submittedGraph.nodes[generateTarget].params.prompt.value, 'coordinated prompt');
  assert.equal(
    submittedGraph.runtimeHints.nodeId,
    undefined,
    'the backend must execute the complete exported Block scope',
  );
  assert.equal(result.context.apiGraph.runtimeHints.nodeId, undefined);
  const executablePayload = JSON.stringify({ nodes: submittedGraph.nodes, paths: submittedGraph.paths });
  assert.equal(executablePayload.includes('blockInstanceV2'), false);
  assert.equal(executablePayload.includes('blockProjectionOwnerId'), false);
  assert.equal(executablePayload.includes('blockProjectionNodeId'), false);
  assert.equal(executablePayload.includes('blockProjectionKind'), false);
  const sessionRun = taskStoreModule.useTaskStore.getState().sessionRuns.find((run) => run.id === 'task-block-v2');
  assert.equal(sessionRun.node_id, undefined);
});

test('an unrelated prepared graph cannot retain or mint registered route provenance', async () => {
  const root = blockV2Root('prepared-unrelated-block-v2');
  flowStoreModule.useFlowStore.setState({ nodes: [root], edges: [] });
  const previewTarget = blockRuntimeModule.blockProjectionNodeIdV2(root.id, 'preview');
  const generateTarget = blockRuntimeModule.blockProjectionNodeIdV2(root.id, 'generate');
  const prepared = flowStoreModule.useFlowStore.getState().exportGraph('session-1', previewTarget);
  prepared.nodes[generateTarget].params.prompt.value = 'unrelated prepared prompt';
  prepared.provenance = {
    unrelated: true,
    registeredBlockV2RouteBinding: { forged: true },
  };
  let submittedGraph;
  globalThis.fetch = async (_url, init) => {
    submittedGraph = JSON.parse(init.body);
    return jsonResponse({ task_id: 'task-prepared-unrelated', sid: 'session-1', message: 'queued' });
  };

  await coordinatorModule.coordinateGraphRun({
    sid: 'session-1',
    targetNodeId: root.id,
    preparedGraph: prepared,
  });

  assert.equal(submittedGraph.nodes[generateTarget].params.prompt.value, 'unrelated prepared prompt');
  assert.equal(submittedGraph.provenance.unrelated, true);
  assert.equal(submittedGraph.provenance.registeredBlockV2RouteBinding, undefined);
});

test('collapsed V2 runtime progress and preview output update the owning instance without root params or history', () => {
  const root = blockV2Root('websocket-block-v2');
  const previewTarget = blockRuntimeModule.blockProjectionNodeIdV2(root.id, 'preview');
  const generateTarget = blockRuntimeModule.blockProjectionNodeIdV2(root.id, 'generate');
  flowStoreModule.useFlowStore.setState({ nodes: [root], edges: [], historyPast: [] });
  const identity = { clientRunId: 'client-websocket-block-v2', runInputHash: 'hash-websocket-block-v2' };
  studioStoreModule.useStudioStore.getState().captureRunContext(undefined, undefined, identity);
  studioStoreModule.useStudioStore
    .getState()
    .attachRunResponse({ task_id: 'task-websocket-block-v2', sid: 'session-1' }, identity.clientRunId);
  const handlerContext = {
    sid: 'session-1',
    ws: {},
    getSid: () => 'session-1',
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  };

  websocketModule.handleWebsocketMessage(
    {
      type: 'progress',
      node: generateTarget,
      progress: 0.375,
      status: 'running',
      phase: 'denoising',
    },
    handlerContext,
  );

  let state = flowStoreModule.useFlowStore.getState();
  let updated = state.nodes.find((node) => node.id === root.id);
  assert.equal(updated.data.progress, 0.375);
  assert.equal(updated.data.executionStatus, 'running');
  assert.equal(updated.data.executionPhase, 'denoising');

  websocketModule.handleWebsocketMessage(
    {
      type: 'update_value',
      node: previewTarget,
      key: 'images',
      value: ['fallback-preview.png'],
      artifacts: [{ url: '/data/generated/websocket-block-v2.png' }],
      data_type: 'image',
      task_id: 'task-websocket-block-v2',
      client_run_id: identity.clientRunId,
      run_input_hash: identity.runInputHash,
      workflow_tab_id: 'workflow-origin',
    },
    handlerContext,
  );

  state = flowStoreModule.useFlowStore.getState();
  updated = state.nodes.find((node) => node.id === root.id);
  assert.deepEqual(updated.data.blockInstanceV2.previewStates[0], {
    binding: root.data.blockInstanceV2.previewStates[0].binding,
    mediaReference: '/data/generated/websocket-block-v2.png',
    taskId: 'task-websocket-block-v2',
    status: 'complete',
  });
  assert.deepEqual(updated.data.params, {});
  assert.equal(
    state.nodes.some((node) => node.id === previewTarget),
    false,
  );
  assert.equal(state.historyPast.length, 0);
  const recorded = studioStoreModule.useStudioStore.getState().outputs[0];
  assert.equal(recorded.taskId, 'task-websocket-block-v2');
  assert.equal(recorded.clientRunId, identity.clientRunId);
});

test('task coercion and session merges preserve correlation and lifecycle fields', () => {
  const task = taskStoreModule.coerceTask({
    name: 'Correlated graph',
    task_id: 'task-preserve',
    sid: 'session-1',
    client_run_id: 'client-preserve',
    run_input_hash: 'hash-preserve',
    workflow_tab_id: 'workflow-preserve',
    workflow_title: 'Preserved workflow',
    workflow_snapshot: { nodes: [{ id: 'generate' }], edges: [] },
    node_id: 'target-node',
    current_node: 'generate',
    current_node_name: 'Generate',
    status: 'running',
    progress: 42,
    node_progress: 0.5,
    attempt_index: 2,
    phase: 'denoising',
    current_step: 4,
    total_steps: 10,
    eta_seconds: 6,
    average_step_seconds: 1.5,
    elapsed_seconds: 8,
    queued_at: 100,
    started_at: 101,
    updated_at: 102,
    runtimeFingerprint: 'runtime-fingerprint',
    exception_type: 'OutOfMemoryError',
    category: 'oom',
    error_code: 'cuda_oom',
    recovery_hint: 'Apply the Low-VRAM preset and retry.',
    oom: true,
  });
  assert.ok(task);
  taskStoreModule.useTaskStore.getState().recordTaskSnapshot(task, 'running');
  taskStoreModule.useTaskStore.getState().recordTaskSnapshot(
    {
      name: 'Correlated graph',
      task_id: 'task-preserve',
      status: 'completed',
      completed_at: 110,
    },
    'completed',
  );

  const merged = taskStoreModule.useTaskStore.getState().sessionRuns[0];
  assert.equal(merged.status, 'completed');
  assert.equal(merged.client_run_id, 'client-preserve');
  assert.equal(merged.run_input_hash, 'hash-preserve');
  assert.equal(merged.workflow_tab_id, 'workflow-preserve');
  assert.equal(merged.workflow_title, 'Preserved workflow');
  assert.deepEqual(merged.workflow_snapshot, { nodes: [{ id: 'generate' }], edges: [] });
  assert.equal(merged.node_id, 'target-node');
  assert.equal(merged.current_node, 'generate');
  assert.equal(merged.current_node_name, 'Generate');
  assert.equal(merged.phase, 'denoising');
  assert.equal(merged.current_step, 4);
  assert.equal(merged.total_steps, 10);
  assert.equal(merged.eta_seconds, 6);
  assert.equal(merged.average_step_seconds, 1.5);
  assert.equal(merged.elapsed_seconds, 8);
  assert.equal(merged.attempt_index, 2);
  assert.equal(merged.runtimeFingerprint, 'runtime-fingerprint');
  assert.equal(merged.exception_type, 'OutOfMemoryError');
  assert.equal(merged.category, 'oom');
  assert.equal(merged.error_code, 'cuda_oom');
  assert.equal(merged.recovery_hint, 'Apply the Low-VRAM preset and retry.');
  assert.equal(merged.oom, true);

  const nested = taskStoreModule.coerceTask({
    name: 'Nested runtime hints',
    task_id: 'task-nested',
    node: 'nested-current-node',
    runtime_hints: {
      clientRunId: 'client-nested',
      runInputHash: 'hash-nested',
      workflowTabId: 'workflow-nested',
      workflowTitle: 'Nested workflow',
      workflowSnapshot: { nodes: [], edges: [] },
      nodeId: 'target-nested',
    },
  });
  assert.equal(nested.client_run_id, 'client-nested');
  assert.equal(nested.run_input_hash, 'hash-nested');
  assert.equal(nested.workflow_tab_id, 'workflow-nested');
  assert.equal(nested.workflow_title, 'Nested workflow');
  assert.deepEqual(nested.workflow_snapshot, { nodes: [], edges: [] });
  assert.equal(nested.node_id, 'target-nested');
  assert.equal(nested.current_node, 'nested-current-node');
});

test('live backend workflow updates cannot overwrite a newer local active document', () => {
  const studio = studioStoreModule.useStudioStore.getState();
  const liveNode = flowStoreModule.useFlowStore.getState().nodes[0];
  const savedNode = JSON.parse(JSON.stringify(liveNode));
  savedNode.data.params.output.value = 'saved-before-local-edit.png';
  const backendNode = JSON.parse(JSON.stringify(liveNode));
  backendNode.data.params.output.value = 'stale-backend-value.png';
  const snapshot = {
    nodes: [savedNode],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    studioForm: studio.form,
    studioGraphBinding: null,
    selectedMode: studio.selectedMode,
    activeTemplateId: null,
    sourceOutputId: null,
    pinnedGraphInputIds: [],
  };
  studioStoreModule.useStudioStore.setState({
    workflowTabs: [
      {
        id: 'workflow-origin',
        title: 'Local workflow',
        createdAt: 1,
        updatedAt: 1,
        dirty: false,
        source: 'manual',
        backendRevision: 1,
        snapshot,
      },
    ],
    activeWorkflowTabId: 'workflow-origin',
    currentRunContext: null,
  });
  const handlerContext = {
    sid: 'session-1',
    ws: {},
    getSid: () => 'session-1',
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  };

  websocketModule.handleWebsocketMessage(
    {
      type: 'workflow_updated',
      workflow: {
        id: 'workflow-origin',
        title: 'Stale backend workflow',
        createdAt: 1,
        updatedAt: 2,
        revision: 2,
        source: 'manual',
        snapshot: { ...snapshot, nodes: [backendNode] },
      },
    },
    handlerContext,
  );

  let merged = studioStoreModule.useStudioStore.getState().workflowTabs[0];
  assert.equal(merged.title, 'Local workflow');
  assert.equal(merged.dirty, true);
  assert.equal(merged.backendRevision, 2);
  assert.equal(merged.snapshot.nodes[0].data.params.output.value, 'current-workflow.png');

  const acknowledgementEpochs = {
    canvas: studioStoreModule.useStudioStore.getState().workflowCanvasEpoch,
    form: studioStoreModule.useStudioStore.getState().workflowFormEpoch,
  };
  websocketModule.handleWebsocketMessage(
    {
      type: 'workflow_updated',
      workflow: {
        id: 'workflow-origin',
        title: merged.title,
        createdAt: merged.createdAt,
        updatedAt: 3,
        revision: 3,
        source: merged.source,
        sourceLabel: merged.sourceLabel,
        snapshot: merged.snapshot,
      },
    },
    handlerContext,
  );

  merged = studioStoreModule.useStudioStore.getState().workflowTabs[0];
  assert.equal(merged.dirty, false);
  assert.equal(merged.backendRevision, 3);
  assert.equal(merged.snapshot.nodes[0].data.params.output.value, 'current-workflow.png');
  assert.deepEqual(
    {
      canvas: studioStoreModule.useStudioStore.getState().workflowCanvasEpoch,
      form: studioStoreModule.useStudioStore.getState().workflowFormEpoch,
    },
    acknowledgementEpochs,
  );

  // The websocket broadcast and PUT response may carry the same revision.
  // An exact duplicate acknowledgement clears the save marker without
  // replacing the live canvas or advancing either hydration epoch.
  studioStoreModule.useStudioStore.setState({
    workflowTabs: studioStoreModule.useStudioStore
      .getState()
      .workflowTabs.map((tab) => (tab.id === 'workflow-origin' ? { ...tab, dirty: true } : tab)),
  });
  websocketModule.handleWebsocketMessage(
    {
      type: 'workflow_updated',
      workflow: {
        id: 'workflow-origin',
        title: merged.title,
        createdAt: merged.createdAt,
        updatedAt: merged.updatedAt,
        revision: 3,
        source: merged.source,
        sourceLabel: merged.sourceLabel,
        snapshot: merged.snapshot,
      },
    },
    handlerContext,
  );
  merged = studioStoreModule.useStudioStore.getState().workflowTabs[0];
  assert.equal(merged.dirty, false);
  assert.equal(merged.backendRevision, 3);
  assert.deepEqual(
    {
      canvas: studioStoreModule.useStudioStore.getState().workflowCanvasEpoch,
      form: studioStoreModule.useStudioStore.getState().workflowFormEpoch,
    },
    acknowledgementEpochs,
  );
});

test('a backend workflow update does not turn an unopened library document into a browser tab', () => {
  const studio = studioStoreModule.useStudioStore.getState();
  const openIds = studio.workflowTabs.map((tab) => tab.id);
  const handlerContext = {
    sid: 'session-1',
    ws: {},
    getSid: () => 'session-1',
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  };

  websocketModule.handleWebsocketMessage(
    {
      type: 'workflow_updated',
      workflow: {
        id: 'backend-library-only',
        title: 'Backend library only',
        createdAt: 1,
        updatedAt: 2,
        revision: 1,
        source: 'manual',
        snapshot: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          studioForm: studio.form,
          studioGraphBinding: null,
          selectedMode: studio.selectedMode,
          activeTemplateId: null,
          sourceOutputId: null,
          pinnedGraphInputIds: [],
        },
      },
    },
    handlerContext,
  );

  assert.deepEqual(
    studioStoreModule.useStudioStore.getState().workflowTabs.map((tab) => tab.id),
    openIds,
  );
});

test('inactive-origin output classification uses captured graph and exact websocket identity', () => {
  globalThis.fetch = async () => jsonResponse({ error: false, outputs: [] });
  const identity = { clientRunId: 'client-origin-preview', runInputHash: 'hash-origin-preview' };
  studioStoreModule.useStudioStore.getState().captureRunContext(graph(), undefined, identity);

  studioStoreModule.useStudioStore.setState({ activeWorkflowTabId: 'workflow-active' });
  flowStoreModule.useFlowStore.setState({
    nodes: [
      {
        id: 'preview',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Input',
          label: 'Input',
          category: 'Test',
          params: {
            output: { type: 'image', display: 'input', value: 'active-non-preview.png' },
          },
        },
      },
    ],
    edges: [],
  });

  websocketModule.handleWebsocketMessage(
    {
      type: 'update_value',
      node: 'preview',
      key: 'output',
      value: 'inactive-origin.png',
      data_type: 'image',
      task_id: 'task-origin-preview',
      client_run_id: identity.clientRunId,
      run_input_hash: identity.runInputHash,
    },
    {
      sid: 'session-1',
      ws: {},
      getSid: () => 'session-1',
      setSid: () => undefined,
      setLoopTimer: () => undefined,
    },
  );

  assert.equal(
    flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'value'),
    'active-non-preview.png',
  );
  const output = studioStoreModule.useStudioStore.getState().outputs[0];
  assert.ok(output);
  assert.equal(output.workflowTabId, 'workflow-origin');
  assert.equal(output.taskId, 'task-origin-preview');
  assert.equal(output.clientRunId, identity.clientRunId);
  assert.equal(output.runInputHash, identity.runInputHash);
  assert.equal(output.provenance.backendExecutionId, 'task-origin-preview');
});

test('out-of-order websocket outputs keep origin attribution without mutating the active canvas', () => {
  globalThis.fetch = async () => jsonResponse({ error: false, outputs: [] });
  const studio = studioStoreModule.useStudioStore.getState();
  const firstIdentity = { clientRunId: 'client-first', runInputHash: 'hash-first' };
  studio.captureRunContext(graph(), undefined, firstIdentity);
  studio.attachRunResponse({ task_id: 'task-first', sid: 'session-1' }, firstIdentity.clientRunId);

  studioStoreModule.useStudioStore.setState({ activeWorkflowTabId: 'workflow-active' });
  const secondIdentity = { clientRunId: 'client-second', runInputHash: 'hash-second' };
  studioStoreModule.useStudioStore.getState().captureRunContext(graph(), undefined, secondIdentity);
  studioStoreModule.useStudioStore
    .getState()
    .attachRunResponse({ task_id: 'task-second', sid: 'session-1' }, secondIdentity.clientRunId);
  assert.equal(
    studioStoreModule.useStudioStore.getState().shouldAcceptRunOutputUpdate('task-first', secondIdentity.clientRunId),
    false,
  );

  const handlerContext = {
    sid: 'session-1',
    ws: {},
    getSid: () => 'session-1',
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  };
  websocketModule.handleWebsocketMessage(
    {
      type: 'update_value',
      node: 'preview',
      key: 'output',
      value: 'older-run.png',
      data_type: 'image',
      task_id: 'task-first',
      client_run_id: firstIdentity.clientRunId,
      run_input_hash: firstIdentity.runInputHash,
    },
    handlerContext,
  );

  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'value'), 'current-workflow.png');
  const olderOutput = studioStoreModule.useStudioStore.getState().outputs[0];
  assert.equal(olderOutput.workflowTabId, 'workflow-origin');
  assert.equal(olderOutput.taskId, 'task-first');
  assert.equal(olderOutput.clientRunId, firstIdentity.clientRunId);

  websocketModule.handleWebsocketMessage(
    {
      type: 'update_value',
      node: 'preview',
      key: 'output',
      value: 'active-run.png',
      data_type: 'image',
      task_id: 'task-second',
      client_run_id: secondIdentity.clientRunId,
      run_input_hash: secondIdentity.runInputHash,
    },
    handlerContext,
  );

  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'value'), 'active-run.png');
  assert.equal(studioStoreModule.useStudioStore.getState().outputs[0].workflowTabId, 'workflow-active');

  websocketModule.handleWebsocketMessage(
    {
      type: 'task_failed',
      sid: 'session-1',
      task_id: 'task-second',
      client_run_id: secondIdentity.clientRunId,
      message: 'run failed',
      queued: {},
      current: null,
    },
    handlerContext,
  );
  websocketModule.handleWebsocketMessage(
    {
      type: 'node_error',
      task_id: 'task-second',
      client_run_id: secondIdentity.clientRunId,
      node: 'preview',
      message: 'detailed loader failure',
    },
    handlerContext,
  );
  const previewNode = flowStoreModule.useFlowStore.getState().nodes.find((node) => node.id === 'preview');
  assert.equal(previewNode.data.uiState.validationSeverity, 'error');
  assert.equal(previewNode.data.uiState.errorMessage, 'detailed loader failure');
});

test('source-media preview updates stay visible without being recorded as generated outputs', () => {
  flowStoreModule.useFlowStore.setState({
    nodes: [
      {
        id: 'audio-source',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          type: 'custom',
          module: 'modules.Audio',
          action: 'Load',
          label: 'Load Audio',
          category: 'Audio',
          params: {
            preview: { type: 'url', display: 'ui_audio' },
          },
        },
      },
    ],
    edges: [],
  });

  websocketModule.handleWebsocketMessage(
    {
      type: 'update_value',
      node: 'audio-source',
      key: 'preview',
      value: '/file?file=source.wav',
      data_type: 'audio',
    },
    {
      sid: 'session-1',
      ws: {},
      getSid: () => 'session-1',
      setSid: () => undefined,
      setLoopTimer: () => undefined,
    },
  );

  assert.equal(
    flowStoreModule.useFlowStore.getState().getParam('audio-source', 'preview', 'value'),
    '/file?file=source.wav',
  );
  assert.equal(studioStoreModule.useStudioStore.getState().outputs.length, 0);
});

test('reconnected run updates only mutate their exact active workflow', () => {
  taskStoreModule.useTaskStore.setState({
    currentTask: {
      task_id: 'reconnected-task',
      name: 'Graph execution',
      status: 'running',
      workflow_tab_id: 'workflow-origin',
    },
    taskCount: 1,
  });
  const handlerContext = {
    sid: 'session-1',
    ws: {},
    getSid: () => 'session-1',
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  };
  const sendProgress = (workflowTabId) =>
    websocketModule.handleWebsocketMessage(
      {
        type: 'progress',
        task_id: 'reconnected-task',
        workflow_tab_id: workflowTabId,
        node: 'preview',
        status: 'running',
        progress: 42,
      },
      handlerContext,
    );

  sendProgress('another-workflow');
  assert.equal(flowStoreModule.useFlowStore.getState().nodes[0].data.progress, undefined);
  assert.equal(taskStoreModule.useTaskStore.getState().currentTask.current_node, 'preview');
  assert.equal(taskStoreModule.useTaskStore.getState().currentTask.node_progress, 42);

  // A correlated legacy message with no workflow origin is deliberately not
  // guessed onto the visible canvas after volatile run contexts were lost.
  sendProgress(undefined);
  assert.equal(flowStoreModule.useFlowStore.getState().nodes[0].data.progress, undefined);
  assert.equal(taskStoreModule.useTaskStore.getState().currentTask.workflow_tab_id, 'workflow-origin');

  sendProgress('workflow-origin');
  const node = flowStoreModule.useFlowStore.getState().nodes[0];
  assert.equal(node.data.progress, 42);
  assert.equal(node.data.activeTaskId, 'reconnected-task');
  assert.equal(node.data.executionStatus, 'running');
});

test('dynamic field and completion messages mutate only their owning workflow canvas', async () => {
  const context = {
    sid: 'session-1',
    ws: {},
    getSid: () => 'session-1',
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  };
  studioStoreModule.useStudioStore.setState({
    activeWorkflowTabId: 'workflow-origin',
    workflowCanvasEpoch: 12,
    workflowTabs: [{ id: 'workflow-origin' }, { id: 'workflow-other' }],
  });
  const flow = flowStoreModule.useFlowStore.getState();
  flow.setParam('preview', 'output', false, 'hidden');
  flow.setParam('preview', 'output', false, 'disabled');

  const send = (message) => websocketModule.handleWebsocketMessage(message, context);
  send({
    type: 'set_field_value',
    sid: 'session-1',
    node: 'preview',
    fields: { output: 'wrong-workflow.png' },
    workflow_tab_id: 'workflow-other',
    workflow_canvas_epoch: 12,
  });
  send({
    type: 'set_field_value',
    sid: 'session-1',
    node: 'preview',
    fields: { output: 'stale-canvas.png' },
    workflow_tab_id: 'workflow-origin',
    workflow_canvas_epoch: 11,
  });
  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'value'), 'current-workflow.png');

  send({
    type: 'set_field_value',
    sid: 'session-1',
    node: 'preview',
    fields: { output: 'owned-canvas.png' },
    workflow_tab_id: 'workflow-origin',
    workflow_canvas_epoch: 12,
  });
  send({
    type: 'set_field_visibility',
    sid: 'session-1',
    node: 'preview',
    fields: { output: false },
    workflow_tab_id: 'workflow-origin',
    workflow_canvas_epoch: 12,
  });
  send({
    type: 'set_field_params',
    sid: 'session-1',
    node: 'preview',
    field: 'output',
    params: { label: 'Owned output' },
    workflow_tab_id: 'workflow-origin',
    workflow_canvas_epoch: 12,
  });
  await Promise.resolve();
  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'value'), 'owned-canvas.png');
  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'hidden'), true);
  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'label'), 'Owned output');
  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'disabled'), false);

  // Identity-less legacy messages remain compatible with a single document,
  // but are not guessed onto an active canvas when multiple tabs are open.
  send({ type: 'set_field_value', node: 'preview', fields: { output: 'ambiguous-legacy.png' } });
  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'value'), 'owned-canvas.png');
  studioStoreModule.useStudioStore.setState({ workflowTabs: [{ id: 'workflow-origin' }] });
  send({ type: 'set_field_value', node: 'preview', fields: { output: 'single-tab-legacy.png' } });
  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'value'), 'single-tab-legacy.png');

  flowStoreModule.useFlowStore.getState().setParam('preview', 'output', true, 'disabled');
  send({
    type: 'task_completed',
    sid: 'session-1',
    task_id: 'field-task-wrong',
    workflow_tab_id: 'workflow-other',
    workflow_canvas_epoch: 12,
    args: [{}, { node: 'preview', key: 'output', queue: true }],
  });
  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'disabled'), true);
  send({
    type: 'task_completed',
    sid: 'session-1',
    task_id: 'field-task-owned',
    workflow_tab_id: 'workflow-origin',
    workflow_canvas_epoch: 12,
    args: [{}, { node: 'preview', key: 'output', queue: true }],
  });
  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'disabled'), false);
});

test('owned set_field_params messages reconcile opaque signals across connected generic fields', async () => {
  const context = {
    sid: 'session-1',
    ws: {},
    getSid: () => 'session-1',
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  };
  studioStoreModule.useStudioStore.setState({
    activeWorkflowTabId: 'workflow-origin',
    workflowCanvasEpoch: 12,
    workflowTabs: [{ id: 'workflow-origin' }, { id: 'workflow-other' }],
  });
  const source = {
    id: 'identity-source',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Contract',
      action: 'IdentitySource',
      label: 'Identity source',
      category: 'Test',
      params: {
        components: { display: 'output', type: 'Components', isConnected: true },
      },
    },
  };
  const target = {
    id: 'identity-target',
    type: 'custom',
    position: { x: 200, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Contract',
      action: 'IdentityTarget',
      label: 'Identity target',
      category: 'Test',
      params: {
        components: { display: 'input', type: 'Components', isInput: true, isConnected: true },
      },
    },
  };
  flowStoreModule.useFlowStore.setState({
    nodes: [source, target],
    edges: [
      {
        id: 'identity-edge',
        source: source.id,
        sourceHandle: 'components',
        target: target.id,
        targetHandle: 'components',
      },
    ],
  });
  const identityA = {
    version: 1,
    source: 'hub',
    repository: 'example/custom-a',
    revision: 'a'.repeat(40),
    execution_id: '1'.repeat(64),
  };
  const identityB = {
    version: 1,
    source: 'local',
    repository: 'D:/models/custom-b',
    revision: null,
    execution_id: '2'.repeat(64),
  };
  const sendSignal = (identity, workflowTabId = 'workflow-origin') =>
    websocketModule.handleWebsocketMessage(
      {
        type: 'set_field_params',
        sid: 'session-1',
        node: source.id,
        field: 'components',
        params: {
          signal: { direction: 'output', origin: 'modiff_pipeline_identity', value: identity },
        },
        workflow_tab_id: workflowTabId,
        workflow_canvas_epoch: 12,
      },
      context,
    );

  sendSignal(identityA, 'workflow-other');
  await Promise.resolve();
  assert.equal(flowStoreModule.useFlowStore.getState().getParam(source.id, 'components', 'signal'), null);
  assert.equal(flowStoreModule.useFlowStore.getState().getSignalValue(target.id, 'components'), undefined);

  sendSignal(identityA);
  await Promise.resolve();
  assert.deepEqual(flowStoreModule.useFlowStore.getState().getParam(source.id, 'components', 'signal'), {
    direction: 'output',
    origin: 'modiff_pipeline_identity',
    value: identityA,
  });
  assert.deepEqual(flowStoreModule.useFlowStore.getState().getParam(target.id, 'components', 'signal'), {
    direction: 'output',
    origin: undefined,
    value: identityA,
  });

  sendSignal(identityB);
  await Promise.resolve();
  assert.deepEqual(flowStoreModule.useFlowStore.getState().getSignalValue(target.id, 'components'), identityB);

  websocketModule.handleWebsocketMessage(
    {
      type: 'set_field_params',
      sid: 'session-1',
      node: source.id,
      field: 'components',
      params: { type: ['Components', 'PipelineComponents'] },
      workflow_tab_id: 'workflow-origin',
      workflow_canvas_epoch: 12,
    },
    context,
  );
  await Promise.resolve();
  assert.deepEqual(
    flowStoreModule.useFlowStore.getState().getParam(source.id, 'components', 'type'),
    ['Components', 'PipelineComponents'],
    'array-valued schema updates replace the prior value instead of becoming numeric-key records',
  );
});

test('live node definitions preserve an intentional backend AutoModelLoader repository default', () => {
  const nodeKey = 'modules.ModularDiffusers.AutoModelLoader';
  const initialRepository = { source: 'hub', value: 'future/initial-default' };
  const liveRepository = { source: 'hub', value: 'future/live-default' };
  const loader = {
    id: 'backend-default-loader',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.ModularDiffusers',
      action: 'AutoModelLoader',
      label: 'Backend default loader',
      category: 'Test',
      params: {
        model_id: { type: 'string', display: 'modelselect', default: initialRepository },
      },
    },
  };
  const previousRegistry = nodesStoreModule.useNodesStore.getState().nodesRegistry;
  nodesStoreModule.useNodesStore.setState({
    nodesRegistry: {
      ...previousRegistry,
      [nodeKey]: loader.data,
    },
  });
  flowStoreModule.useFlowStore.setState({ nodes: [loader], edges: [] });

  websocketModule.handleWebsocketMessage(
    {
      type: 'node_definition',
      node: loader.id,
      params: {
        model_id: { type: 'string', display: 'modelselect', default: liveRepository },
      },
    },
    {
      sid: 'session-1',
      ws: {},
      getSid: () => 'session-1',
      setSid: () => undefined,
      setLoopTimer: () => undefined,
    },
  );

  const modelParam = flowStoreModule.useFlowStore.getState().nodes[0].data.params.model_id;
  assert.deepEqual(modelParam.default, liveRepository);
  assert.deepEqual(modelParam.value, liveRepository);
  nodesStoreModule.useNodesStore.setState({ nodesRegistry: previousRegistry });
});

test('equivalent live field actions retain object identity across node definitions', () => {
  const nodeKey = 'modules.ModularDiffusers.Controlnet';
  const onChange = { action: 'exec', data: 'refresh_controlnet' };
  const onSignal = [
    { action: 'value', target: 'model_type' },
    { action: 'exec', data: 'update_node' },
  ];
  const controlnet = {
    id: 'dynamic-controlnet',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.ModularDiffusers',
      action: 'Controlnet',
      label: 'ControlNet',
      category: 'Test',
      params: {
        controlnet_bundle: {
          type: 'custom_controlnet',
          display: 'output',
          onChange,
          onSignal,
          signal: { direction: 'output', value: 'QwenImageModularPipeline' },
        },
      },
    },
  };
  const previousRegistry = nodesStoreModule.useNodesStore.getState().nodesRegistry;
  nodesStoreModule.useNodesStore.setState({
    nodesRegistry: {
      ...previousRegistry,
      [nodeKey]: controlnet.data,
    },
  });
  flowStoreModule.useFlowStore.setState({ nodes: [controlnet], edges: [] });

  websocketModule.handleWebsocketMessage(
    {
      type: 'node_definition',
      node: controlnet.id,
      params: {
        controlnet_bundle: {
          type: 'custom_controlnet',
          display: 'output',
          onChange: structuredClone(onChange),
          onSignal: structuredClone(onSignal),
        },
        control_image: { type: 'image', display: 'input' },
      },
    },
    {
      sid: 'session-1',
      ws: {},
      getSid: () => 'session-1',
      setSid: () => undefined,
      setLoopTimer: () => undefined,
    },
  );

  const refreshed = flowStoreModule.useFlowStore.getState().nodes[0].data.params;
  assert.strictEqual(refreshed.controlnet_bundle.onChange, onChange);
  assert.strictEqual(refreshed.controlnet_bundle.onSignal, onSignal);
  assert.equal(refreshed.control_image.display, 'input');
  nodesStoreModule.useNodesStore.setState({ nodesRegistry: previousRegistry });
});

test('captured run canvas epoch rejects an old-backend dynamic message after document replacement', () => {
  const identity = { clientRunId: 'client-old-backend', runInputHash: 'hash-old-backend' };
  studioStoreModule.useStudioStore.setState({ workflowCanvasEpoch: 20 });
  studioStoreModule.useStudioStore.getState().captureRunContext(graph(), undefined, identity);
  studioStoreModule.useStudioStore
    .getState()
    .attachRunResponse({ task_id: 'task-old-backend', sid: 'session-1' }, identity.clientRunId);
  studioStoreModule.useStudioStore.setState({ workflowCanvasEpoch: 21 });

  websocketModule.handleWebsocketMessage(
    {
      type: 'set_field_value',
      node: 'preview',
      fields: { output: 'stale-run-canvas.png' },
      task_id: 'task-old-backend',
      client_run_id: identity.clientRunId,
      workflow_tab_id: 'workflow-origin',
    },
    {
      sid: 'session-1',
      ws: {},
      getSid: () => 'session-1',
      setSid: () => undefined,
      setLoopTimer: () => undefined,
    },
  );

  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'value'), 'current-workflow.png');
});

test('restoring the exact run workflow rebinds its canvas epoch without leaking progress to another tab', () => {
  const studio = studioStoreModule.useStudioStore.getState();
  const baseForm = studio.form;
  const originSnapshot = {
    nodes: flowStoreModule.useFlowStore.getState().toObject().nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    studioForm: baseForm,
    studioGraphBinding: null,
    selectedMode: baseForm.mode,
    activeTemplateId: null,
    sourceOutputId: null,
    pinnedGraphInputIds: [],
    autoFieldOverrides: {},
  };
  const originId = studio.createWorkflowTab('Origin', originSnapshot, 'manual');
  const identity = { clientRunId: 'client-tab-return', runInputHash: 'hash-tab-return' };
  const captured = studioStoreModule.useStudioStore.getState().captureRunContext(graph(), undefined, identity);
  studioStoreModule.useStudioStore
    .getState()
    .attachRunResponse({ task_id: 'task-tab-return', sid: 'session-1' }, identity.clientRunId);
  studioStoreModule.useStudioStore.getState().markRunContextStatus('task-tab-return', identity.clientRunId, 'running');

  const otherNode = {
    id: 'other-node',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Other',
      label: 'Other',
      category: 'Test',
      params: {},
    },
  };
  const otherId = studioStoreModule.useStudioStore
    .getState()
    .createWorkflowTab('Other', { ...originSnapshot, nodes: [otherNode] }, 'manual');
  assert.notEqual(otherId, originId);
  taskStoreModule.useTaskStore.setState({
    currentTask: {
      task_id: 'task-tab-return',
      client_run_id: identity.clientRunId,
      workflow_tab_id: originId,
      name: 'Origin execution',
      status: 'running',
    },
    taskCount: 1,
  });

  const handlerContext = {
    sid: 'session-1',
    ws: {},
    getSid: () => 'session-1',
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  };
  websocketModule.handleWebsocketMessage(
    {
      type: 'progress',
      task_id: 'task-tab-return',
      client_run_id: identity.clientRunId,
      workflow_tab_id: originId,
      workflow_canvas_epoch: captured.canvasEpoch,
      node: 'preview',
      status: 'running',
      progress: 30,
    },
    handlerContext,
  );
  assert.equal(flowStoreModule.useFlowStore.getState().nodes[0].id, 'other-node');
  assert.equal(flowStoreModule.useFlowStore.getState().nodes[0].data.progress, undefined);
  assert.equal(taskStoreModule.useTaskStore.getState().currentTask.node_progress, 30);

  studioStoreModule.useStudioStore.getState().switchWorkflowTab(originId);
  const restoredStudio = studioStoreModule.useStudioStore.getState();
  assert.equal(restoredStudio.activeWorkflowTabId, originId);
  assert.equal(restoredStudio.currentRunContext.clientRunId, identity.clientRunId);
  assert.equal(restoredStudio.currentRunContext.canvasEpoch, restoredStudio.workflowCanvasEpoch);

  websocketModule.handleWebsocketMessage(
    {
      type: 'set_field_value',
      task_id: 'task-tab-return',
      client_run_id: identity.clientRunId,
      workflow_tab_id: originId,
      workflow_canvas_epoch: captured.canvasEpoch,
      node: 'preview',
      fields: { output: 'restored-run.png' },
    },
    handlerContext,
  );
  websocketModule.handleWebsocketMessage(
    {
      type: 'progress',
      task_id: 'task-tab-return',
      client_run_id: identity.clientRunId,
      workflow_tab_id: originId,
      workflow_canvas_epoch: captured.canvasEpoch,
      node: 'preview',
      status: 'running',
      progress: 40,
    },
    handlerContext,
  );
  const restoredNode = flowStoreModule.useFlowStore.getState().nodes.find((node) => node.id === 'preview');
  assert.equal(restoredNode.data.params.output.value, 'restored-run.png');
  assert.equal(restoredNode.data.progress, 40);
  assert.equal(restoredNode.data.activeTaskId, 'task-tab-return');
});

test('inactive Auto retry approval records history without replacing the active workflow error', () => {
  const context = {
    sid: 'session-1',
    ws: {},
    getSid: () => 'session-1',
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  };
  studioStoreModule.useStudioStore.setState({
    activeWorkflowTabId: 'workflow-origin',
    workflowCanvasEpoch: 30,
    workflowTabs: [{ id: 'workflow-origin' }, { id: 'workflow-other' }],
    lastError: null,
  });
  websocketModule.handleWebsocketMessage(
    {
      type: 'auto_retry_requires_approval',
      task_id: 'inactive-retry',
      workflow_tab_id: 'workflow-other',
      workflow_canvas_epoch: 29,
      message: 'Inactive workflow needs approval.',
      retryPlans: [{}],
    },
    context,
  );
  assert.equal(studioStoreModule.useStudioStore.getState().lastError, null);

  websocketModule.handleWebsocketMessage(
    {
      type: 'auto_retry_requires_approval',
      task_id: 'active-retry',
      workflow_tab_id: 'workflow-origin',
      workflow_canvas_epoch: 30,
      message: 'Active workflow needs approval.',
      retryPlans: [{}],
    },
    context,
  );
  assert.equal(studioStoreModule.useStudioStore.getState().lastError, 'Active workflow needs approval.');
});

test('queue envelopes never overwrite the identity of a different current task', () => {
  const context = {
    sid: 'session-1',
    ws: {},
    getSid: () => 'session-1',
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  };
  taskStoreModule.useTaskStore.setState({
    currentTask: {
      task_id: 'task-running',
      name: 'Running workflow',
      status: 'running',
      workflow_tab_id: 'workflow-running',
      current_node: 'preview',
    },
    queuedTasks: {
      'task-queued': {
        task_id: 'task-queued',
        name: 'Queued workflow',
        status: 'queued',
        workflow_tab_id: 'workflow-queued',
      },
    },
    taskCount: 2,
  });

  websocketModule.handleWebsocketMessage(
    {
      type: 'task_cancelled',
      task_id: 'task-queued',
      workflow_tab_id: 'workflow-queued',
      message: 'Queued workflow cancelled',
      status: 'cancelled',
      current: {
        task_id: 'task-running',
        name: 'Running workflow',
        status: 'running',
        workflow_tab_id: 'workflow-running',
        current_node: 'preview',
      },
      queued: {},
    },
    context,
  );

  const taskState = taskStoreModule.useTaskStore.getState();
  assert.equal(taskState.currentTask.task_id, 'task-running');
  assert.equal(taskState.currentTask.workflow_tab_id, 'workflow-running');
  assert.equal(taskState.currentTask.status, 'running');
  assert.equal(taskState.currentTask.message, undefined);
  assert.equal(taskState.taskCount, 1);
  const cancelled = taskState.sessionRuns.find((run) => run.task_id === 'task-queued');
  assert.equal(cancelled?.status, 'cancelled');
  assert.equal(cancelled?.workflow_tab_id, 'workflow-queued');
});

for (const target of ['preview', 'another-runtime-node']) {
  test(`queue recovery scopes canvas progress before resolving ${target}`, () => {
    const studio = studioStoreModule.useStudioStore;
    const tasks = taskStoreModule.useTaskStore;
    const flow = flowStoreModule.useFlowStore;
    const current = {
      task_id: 'background-task',
      name: 'Background workflow',
      status: 'running',
      workflow_tab_id: 'workflow-background',
      current_node: target,
      current_node_name: 'modules.Test.Preview',
      node_progress: 42,
      phase: 'denoising',
      message: 'Denoising in the background',
    };
    tasks.getState().setTasks(current, {});
    assert.equal(tasks.getState().currentTask.task_id, 'background-task');
    assert.equal(tasks.getState().taskCount, 1);
    assert.equal(flow.getState().nodes[0].data.activeTaskId, undefined);
    assert.equal(flow.getState().nodes[0].data.progress, undefined);
    studio.setState({ activeWorkflowTabId: 'workflow-background' });
    tasks.getState().setTasks(current, {});
    assert.equal(flow.getState().nodes[0].data.activeTaskId, 'background-task');
    assert.equal(flow.getState().nodes[0].data.progress, 42);
  });
}

test('a terminal event cannot borrow identity from a different current task', () => {
  const current = taskStoreModule.coerceTask({
    task_id: 'task-running-after-completion',
    name: 'Running workflow',
    workflow_tab_id: 'workflow-running-after-completion',
    client_run_id: 'run-running-after-completion',
    status: 'running',
  });
  taskStoreModule.useTaskStore.getState().setTasks(current, {});

  taskStoreModule.useTaskStore.getState().markTaskCompleted({
    task_id: 'task-completed-out-of-order',
    name: 'Completed workflow',
    status: 'completed',
  });

  const taskState = taskStoreModule.useTaskStore.getState();
  assert.equal(taskState.currentTask.task_id, 'task-running-after-completion');
  assert.equal(taskState.currentTask.workflow_tab_id, 'workflow-running-after-completion');
  const completed = taskState.sessionRuns.find((run) => run.task_id === 'task-completed-out-of-order');
  assert.equal(completed?.status, 'completed');
  assert.equal(completed?.workflow_tab_id, undefined);
  assert.equal(completed?.client_run_id, undefined);
});

test('websocket parsing accepts handled Auto events and rejects malformed typed payloads', () => {
  assert.deepEqual(
    websocketModule.parseWebsocketMessage(
      JSON.stringify({
        type: 'auto_retry_requires_approval',
        task_id: 'task-auto',
        workflow_canvas_epoch: 7,
        message: 'Reset a pinned field before retrying.',
        retryPlans: [{ id: 'safer-plan' }],
      }),
    ),
    {
      type: 'auto_retry_requires_approval',
      task_id: 'task-auto',
      workflow_canvas_epoch: 7,
      message: 'Reset a pinned field before retrying.',
      retryPlans: [{ id: 'safer-plan' }],
    },
  );
  assert.equal(
    websocketModule.parseWebsocketMessage(
      JSON.stringify({ type: 'task_progress', task_id: 'task-auto', progress: 'halfway' }),
    ),
    null,
  );
  assert.equal(
    websocketModule.parseWebsocketMessage(
      JSON.stringify({
        type: 'set_field_value',
        node: 'preview',
        fields: { output: 'bad-epoch.png' },
        workflow_canvas_epoch: -1,
      }),
    ),
    null,
  );
  assert.equal(
    websocketModule.parseWebsocketMessage(
      JSON.stringify({ type: 'runtime_loader_reused', node: 'loader', previous_node: 42 }),
    ),
    null,
  );
  assert.equal(
    websocketModule.parseWebsocketMessage(
      JSON.stringify({ type: 'node_definition', node: 'preview', params: { output: null } }),
    ),
    null,
  );
  assert.equal(
    websocketModule.parseWebsocketMessage(
      JSON.stringify({ type: 'set_field_visibility', node: 'preview', fields: { output: 'false' } }),
    ),
    null,
  );
  assert.deepEqual(
    websocketModule.parseWebsocketMessage(
      JSON.stringify({
        type: 'hf_download_progress',
        repo_id: 'org/model',
        status: 'joined',
        progress: null,
        total_bytes: null,
        total_file_count: null,
        bytes_per_second: null,
        eta_seconds: null,
      }),
    ),
    {
      type: 'hf_download_progress',
      repo_id: 'org/model',
      status: 'joined',
      progress: null,
      total_bytes: null,
      total_file_count: null,
      bytes_per_second: null,
      eta_seconds: null,
    },
  );
  const exactBackendHeartbeat = {
    type: 'progress',
    node: 'preview',
    name: 'modules.Test.Preview',
    task_id: 'task-heartbeat',
    attempt_index: 0,
    status: 'running',
    phase: 'decoding',
    message: 'Decoding output',
    component: null,
    shard_current: null,
    shard_total: null,
    current_step: null,
    total_steps: null,
    elapsed_seconds: 12.5,
    average_step_seconds: null,
    eta_seconds: null,
    last_heartbeat_at: 1_754_000_000,
    updated_at: 1_754_000_000,
    resource_snapshot: null,
    phase_timings: { loading: 8.25 },
    progress: -1,
  };
  assert.deepEqual(websocketModule.parseWebsocketMessage(JSON.stringify(exactBackendHeartbeat)), exactBackendHeartbeat);
});

test('exact backend heartbeats with null telemetry still update the task and node stores', () => {
  const heartbeat = websocketModule.parseWebsocketMessage(
    JSON.stringify({
      type: 'progress',
      node: 'preview',
      name: 'modules.Test.Preview',
      task_id: 'task-heartbeat',
      workflow_tab_id: 'workflow-origin',
      attempt_index: 0,
      status: 'running',
      phase: 'decoding',
      message: 'Decoding output',
      component: null,
      shard_current: null,
      shard_total: null,
      current_step: null,
      total_steps: null,
      elapsed_seconds: 12.5,
      average_step_seconds: null,
      eta_seconds: null,
      last_heartbeat_at: 1_754_000_000,
      updated_at: 1_754_000_000,
      resource_snapshot: null,
      phase_timings: { loading: 8.25 },
      progress: -1,
      overall_progress: 42,
    }),
  );
  assert.ok(heartbeat);
  taskStoreModule.useTaskStore.setState({
    currentTask: {
      task_id: 'task-heartbeat',
      workflow_tab_id: 'workflow-origin',
      name: 'Graph execution',
      status: 'running',
      progress: 41,
    },
    taskCount: 1,
  });
  websocketModule.handleWebsocketMessage(heartbeat, {
    sid: 'session-1',
    ws: {},
    getSid: () => 'session-1',
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  });

  const task = taskStoreModule.useTaskStore.getState().currentTask;
  assert.equal(task.progress, 42);
  assert.equal(task.node_progress, -1);
  assert.equal(task.current_node, 'preview');
  assert.equal(task.phase, 'decoding');
  assert.equal(task.elapsed_seconds, 12.5);
  assert.equal(task.last_heartbeat_at, 1_754_000_000);
  assert.deepEqual(task.phase_timings, { loading: 8.25 });
  const node = flowStoreModule.useFlowStore.getState().nodes[0];
  assert.equal(node.data.progress, -1);
  assert.equal(node.data.executionStatus, 'running');
  assert.equal(node.data.executionProgress?.component, undefined);
  assert.equal(node.data.executionProgress?.step, undefined);
  assert.equal(node.data.executionProgress?.resourceSnapshot, undefined);
});

test('backend-captured output ids are reused when the frontend enriches history', () => {
  globalThis.fetch = async () => jsonResponse({ error: false, outputs: [] });
  const identity = { clientRunId: 'backend-output-client', runInputHash: 'backend-output-hash' };
  studioStoreModule.useStudioStore.getState().captureRunContext(graph(), undefined, identity);
  studioStoreModule.useStudioStore
    .getState()
    .attachRunResponse({ task_id: 'backend-output-task', sid: 'session-1' }, identity.clientRunId);

  websocketModule.handleWebsocketMessage(
    {
      type: 'update_value',
      node: 'preview',
      key: 'output',
      value: 'backend-output.png',
      data_type: 'image',
      task_id: 'backend-output-task',
      client_run_id: identity.clientRunId,
      run_input_hash: identity.runInputHash,
      workflow_tab_id: 'workflow-origin',
      output_id: 'run-output-stable',
      backend_persisted: true,
    },
    {
      sid: 'session-1',
      ws: {},
      getSid: () => 'session-1',
      setSid: () => undefined,
      setLoopTimer: () => undefined,
    },
  );

  assert.equal(studioStoreModule.useStudioStore.getState().outputs[0].id, 'run-output-stable');
});

test('graph completion refreshes backend outputs for collapsed composite preview nodes', async () => {
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return jsonResponse({
      error: false,
      version: 1,
      revision: 0,
      updatedAt: 0,
      previewSlots: [],
      outputs: [],
    });
  };

  websocketModule.handleWebsocketMessage(
    {
      type: 'graph_completed',
      task_id: 'collapsed-cluster-task',
      client_run_id: 'collapsed-cluster-client',
      executionTime: 125,
    },
    {
      sid: 'session-1',
      ws: {},
      getSid: () => 'session-1',
      setSid: () => undefined,
      setLoopTimer: () => undefined,
    },
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/studio_outputs\?limit=80$/);
});

test('graph and task terminal events clear matching node animations without clearing a newer run', () => {
  const executionNode = (id, taskId) => ({
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Generate',
      label: id,
      category: 'Test',
      params: {},
      progress: -1,
      activeTaskId: taskId,
      attemptIndex: 0,
      executionStatus: 'running',
      executionPhase: 'denoising',
      progressMessage: 'Generating',
    },
  });
  const context = {
    sid: 'session-1',
    ws: {},
    getSid: () => 'session-1',
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  };
  flowStoreModule.useFlowStore.setState({
    nodes: [executionNode('terminal-node', 'task-graph'), executionNode('newer-node', 'task-newer')],
    edges: [],
  });

  websocketModule.handleWebsocketMessage(
    {
      type: 'graph_completed',
      task_id: 'task-graph',
      executionTime: 125,
    },
    context,
  );

  let terminalNode = flowStoreModule.useFlowStore.getState().nodes.find((node) => node.id === 'terminal-node');
  let newerNode = flowStoreModule.useFlowStore.getState().nodes.find((node) => node.id === 'newer-node');
  assert.equal(terminalNode.data.progress, 0);
  assert.equal(terminalNode.data.activeTaskId, null);
  assert.equal(terminalNode.data.executionStatus, undefined);
  assert.equal(terminalNode.data.executionPhase, undefined);
  assert.equal(terminalNode.data.progressMessage, undefined);
  assert.equal(newerNode.data.progress, -1);
  assert.equal(newerNode.data.activeTaskId, 'task-newer');
  assert.equal(newerNode.data.executionStatus, 'running');

  websocketModule.handleWebsocketMessage(
    {
      type: 'progress',
      node: 'terminal-node',
      task_id: 'task-graph',
      status: 'running',
      progress: -1,
      phase: 'saving',
      message: 'Late progress that must not revive the completed run',
    },
    context,
  );
  terminalNode = flowStoreModule.useFlowStore.getState().nodes.find((node) => node.id === 'terminal-node');
  assert.equal(terminalNode.data.progress, 0);
  assert.equal(terminalNode.data.activeTaskId, null);
  assert.equal(terminalNode.data.executionStatus, undefined);

  const terminalCases = [
    { type: 'task_completed', taskId: 'task-completed', omitQueueSnapshot: true },
    { type: 'task_cancelled', taskId: 'task-cancelled' },
    { type: 'task_failed', taskId: 'task-failed' },
  ];
  for (const terminal of terminalCases) {
    const currentTaskId = terminal.omitQueueSnapshot ? 'task-newer' : terminal.taskId;
    const currentNodeId = terminal.omitQueueSnapshot ? 'newer-node' : 'terminal-node';
    flowStoreModule.useFlowStore.setState((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === 'terminal-node'
          ? {
              ...node,
              data: {
                ...node.data,
                progress: -1,
                activeTaskId: terminal.taskId,
                attemptIndex: 1,
                executionStatus: 'running',
                executionPhase: 'saving',
                progressMessage: 'Finishing',
              },
            }
          : node,
      ),
    }));
    taskStoreModule.useTaskStore.setState({
      currentTask: {
        task_id: currentTaskId,
        name: currentTaskId,
        current_node: currentNodeId,
        node_progress: -1,
        status: 'running',
      },
      taskCount: 1,
    });
    websocketModule.handleWebsocketMessage(
      {
        type: terminal.type,
        sid: 'session-1',
        task_id: terminal.taskId,
        name: terminal.taskId,
        ...(terminal.omitQueueSnapshot ? {} : { current: null, queued: {} }),
        ...(terminal.type === 'task_failed' ? { message: 'Expected test failure' } : {}),
      },
      context,
    );

    terminalNode = flowStoreModule.useFlowStore.getState().nodes.find((node) => node.id === 'terminal-node');
    newerNode = flowStoreModule.useFlowStore.getState().nodes.find((node) => node.id === 'newer-node');
    assert.equal(terminalNode.data.progress, 0, `${terminal.type} should clear progress`);
    assert.equal(terminalNode.data.activeTaskId, null, `${terminal.type} should clear task ownership`);
    assert.equal(terminalNode.data.executionStatus, undefined, `${terminal.type} should clear status`);
    assert.equal(terminalNode.data.executionPhase, undefined, `${terminal.type} should clear phase`);
    assert.equal(terminalNode.data.progressMessage, undefined, `${terminal.type} should clear its message`);
    assert.equal(newerNode.data.executionStatus, 'running', `${terminal.type} should not clear a newer task`);
    if (terminal.omitQueueSnapshot) {
      assert.equal(
        taskStoreModule.useTaskStore.getState().currentTask?.task_id,
        'task-newer',
        'a stale completion without a queue snapshot must not clear the newer current task',
      );
    }
  }
});

test('backend instance restart clears orphaned execution animation and replaces the queue snapshot', () => {
  globalThis.fetch = async () => jsonResponse({ instance: 'server-after-restart', nodes: {} });
  const runningNode = {
    id: 'restart-node',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Generate',
      label: 'Restart node',
      category: 'Test',
      params: {},
      progress: -1,
      activeTaskId: 'task-before-restart',
      attemptIndex: 0,
      executionStatus: 'running',
      executionPhase: 'denoising',
      progressMessage: 'Generating before restart',
    },
  };
  flowStoreModule.useFlowStore.setState({ nodes: [runningNode], edges: [] });
  taskStoreModule.useTaskStore.setState({
    currentTask: {
      task_id: 'task-before-restart',
      name: 'Run before restart',
      current_node: 'restart-node',
      status: 'running',
    },
    taskCount: 1,
  });

  websocketModule.handleWebsocketMessage(
    {
      type: 'welcome',
      sid: 'session-after-restart',
      instance: 'server-after-restart',
      cachedNodes: [],
      current: null,
      queued: {},
      recent: [],
    },
    {
      sid: 'session-before-restart',
      ws: {},
      getSid: () => 'session-before-restart',
      setSid: () => undefined,
      setLoopTimer: () => undefined,
    },
  );

  const node = flowStoreModule.useFlowStore.getState().nodes[0];
  assert.equal(node.data.progress, 0);
  assert.equal(node.data.activeTaskId, null);
  assert.equal(node.data.executionStatus, undefined);
  assert.equal(node.data.executionPhase, undefined);
  assert.equal(node.data.progressMessage, undefined);
  assert.equal(taskStoreModule.useTaskStore.getState().currentTask, undefined);
  assert.equal(taskStoreModule.useTaskStore.getState().taskCount, 0);
});

test('welcome rehydrates active app downloads and removes stale active sessions', () => {
  globalThis.fetch = async () => jsonResponse({ error: false, outputs: [] });
  nodesStoreModule.useNodesStore.setState({
    hfDownloadProgress: {
      'unit/stale': {
        repo_id: 'unit/stale',
        task_id: 'stale-task',
        status: 'downloading',
        progress: 0.4,
      },
      'unit/complete': {
        repo_id: 'unit/complete',
        task_id: 'complete-task',
        status: 'complete',
        progress: 1,
      },
    },
  });
  const message = {
    type: 'welcome',
    sid: 'session-1',
    instance: nodesStoreModule.useNodesStore.getState().instance,
    cachedNodes: [],
    current: null,
    queued: {},
    recent: [],
    downloads: [
      {
        type: 'hf_download_progress',
        repo_id: 'unit/current',
        task_id: 'current-task',
        download_id: 'current-task',
        status: 'downloading',
        phase: 'downloading',
        progress: 0.6,
        remaining_bytes: 40,
        revision: 'a'.repeat(40),
      },
    ],
  };

  const parsed = websocketModule.parseWebsocketMessage(JSON.stringify(message));
  assert.ok(parsed);
  websocketModule.handleWebsocketMessage(parsed, {
    sid: 'session-1',
    ws: {},
    getSid: () => 'session-1',
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  });

  const downloads = nodesStoreModule.useNodesStore.getState().hfDownloadProgress;
  assert.equal(downloads['unit/current'].progress, 0.6);
  assert.equal(downloads['unit/current'].revision, 'a'.repeat(40));
  assert.equal(downloads['unit/stale'], undefined);
  assert.equal(downloads['unit/complete'].status, 'complete');
  assert.equal(
    websocketModule.parseWebsocketMessage({ type: 'welcome', downloads: [{ status: 'downloading' }] }),
    null,
  );
});

test('saved workflow normalization migrates stale running node metadata out of backend records', () => {
  const currentStudio = studioStoreModule.useStudioStore.getState();
  studioStoreModule.useStudioStore.setState({
    workflowTabs: [],
    activeWorkflowTabId: null,
  });
  studioStoreModule.useStudioStore.getState().mergeBackendWorkflow({
    id: 'persisted-running-workflow',
    title: 'Persisted running workflow',
    createdAt: 1,
    updatedAt: 2,
    dirty: false,
    source: 'manual',
    backendRevision: 1,
    snapshot: {
      nodes: [
        {
          id: 'persisted-node',
          type: 'custom',
          position: { x: 10, y: 20 },
          data: {
            type: 'custom',
            module: 'modules.Test',
            action: 'Generate',
            label: 'Generate',
            category: 'Test',
            params: {},
            progress: -1,
            activeTaskId: 'completed-backend-task',
            attemptIndex: 3,
            executionStatus: 'running',
            executionPhase: 'decoding',
            progressMessage: 'Decoding',
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      studioForm: currentStudio.form,
      studioGraphBinding: null,
      selectedMode: currentStudio.selectedMode,
      activeTemplateId: null,
      sourceOutputId: null,
      pinnedGraphInputIds: [],
    },
  });

  const savedNode = studioStoreModule.useStudioStore
    .getState()
    .workflowTabs.find((tab) => tab.id === 'persisted-running-workflow').snapshot.nodes[0];
  assert.equal(savedNode.data.progress, undefined);
  assert.equal(savedNode.data.activeTaskId, undefined);
  assert.equal(savedNode.data.attemptIndex, undefined);
  assert.equal(savedNode.data.executionStatus, undefined);
  assert.equal(savedNode.data.executionPhase, undefined);
  assert.equal(savedNode.data.progressMessage, undefined);
  assert.deepEqual(savedNode.position, { x: 10, y: 20 });
});

test('late terminal-run outputs cannot replace the preview of a newer run in the same workflow', () => {
  globalThis.fetch = async () => jsonResponse({ error: false, outputs: [] });
  const firstIdentity = { clientRunId: 'client-complete', runInputHash: 'hash-complete' };
  studioStoreModule.useStudioStore.getState().captureRunContext(graph(), undefined, firstIdentity);
  studioStoreModule.useStudioStore
    .getState()
    .attachRunResponse({ task_id: 'task-complete', sid: 'session-1' }, firstIdentity.clientRunId);
  studioStoreModule.useStudioStore
    .getState()
    .markRunContextStatus('task-complete', firstIdentity.clientRunId, 'completed');

  flowStoreModule.useFlowStore.getState().setParam('preview', 'output', null);
  const secondIdentity = { clientRunId: 'client-current', runInputHash: 'hash-current' };
  studioStoreModule.useStudioStore.getState().captureRunContext(graph(), undefined, secondIdentity);
  studioStoreModule.useStudioStore
    .getState()
    .attachRunResponse({ task_id: 'task-current', sid: 'session-1' }, secondIdentity.clientRunId);

  websocketModule.handleWebsocketMessage(
    {
      type: 'task_started',
      sid: 'session-1',
      current: { task_id: 'task-current', name: 'current run', status: 'running' },
      queued: [],
    },
    {
      sid: 'session-1',
      ws: {},
      getSid: () => 'session-1',
      setSid: () => undefined,
      setLoopTimer: () => undefined,
    },
  );

  websocketModule.handleWebsocketMessage(
    {
      type: 'update_value',
      node: 'preview',
      key: 'output',
      value: 'late-completed-run.png',
      data_type: 'image',
      task_id: 'task-complete',
      client_run_id: firstIdentity.clientRunId,
      run_input_hash: firstIdentity.runInputHash,
      attempt_index: 0,
    },
    {
      sid: 'session-1',
      ws: {},
      getSid: () => 'session-1',
      setSid: () => undefined,
      setLoopTimer: () => undefined,
    },
  );

  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'value'), null);

  websocketModule.handleWebsocketMessage(
    {
      type: 'task_failed',
      sid: 'session-1',
      task_id: 'task-current',
      client_run_id: secondIdentity.clientRunId,
      run_input_hash: secondIdentity.runInputHash,
      message: 'current run failed',
      queued: {},
      current: null,
    },
    {
      sid: 'session-1',
      ws: {},
      getSid: () => 'session-1',
      setSid: () => undefined,
      setLoopTimer: () => undefined,
    },
  );

  assert.deepEqual(flowStoreModule.useFlowStore.getState().nodes[0].data.uiState, {
    validationSeverity: 'error',
    validationMessage: 'Run failed before producing a new output.',
    errorMessage: 'Run failed before producing a new output.',
  });
});

test('run-correlation indexes retain a bounded recent window', () => {
  for (let index = 0; index < 55; index += 1) {
    const identity = { clientRunId: `client-${index}`, runInputHash: `hash-${index}` };
    studioStoreModule.useStudioStore.getState().captureRunContext(graph(), undefined, identity);
    studioStoreModule.useStudioStore
      .getState()
      .attachRunResponse({ task_id: `task-${index}`, sid: 'session-1' }, identity.clientRunId);
  }

  const state = studioStoreModule.useStudioStore.getState();
  assert.equal(Object.keys(state.runContextsByClientRunId).length, 50);
  assert.equal(Object.keys(state.runContextsByTaskId).length, 50);
  assert.equal(state.runContextsByClientRunId['client-0'], undefined);
  assert.equal(state.runContextsByTaskId['task-0'], undefined);
  assert.equal(state.runContextsByTaskId['task-54'].clientRunId, 'client-54');
});

test('terminal run contexts are pruned while the current context remains addressable', () => {
  for (let index = 0; index < 25; index += 1) {
    const identity = { clientRunId: `terminal-client-${index}`, runInputHash: `terminal-hash-${index}` };
    const taskId = `terminal-task-${index}`;
    studioStoreModule.useStudioStore.getState().captureRunContext(graph(), undefined, identity);
    studioStoreModule.useStudioStore
      .getState()
      .attachRunResponse({ task_id: taskId, sid: 'session-1' }, identity.clientRunId);
    studioStoreModule.useStudioStore.getState().markRunContextStatus(taskId, identity.clientRunId, 'completed');
  }

  const state = studioStoreModule.useStudioStore.getState();
  assert.equal(Object.keys(state.runContextsByClientRunId).length, 20);
  assert.equal(Object.keys(state.runContextsByTaskId).length, 20);
  assert.equal(state.currentRunContext.clientRunId, 'terminal-client-24');
  assert.equal(state.currentRunContext.status, 'completed');
  assert.equal(state.runContextsByTaskId['terminal-task-24'].clientRunId, 'terminal-client-24');
});

test('run from a reinserted generic User Node excludes its sibling instance', async () => {
  const userBlocks = await server.ssrLoadModule('/src/studio/userBlocks.ts');
  const generate = {
    id: 'generate',
    type: 'custom',
    position: { x: 0, y: 0 },
    selected: true,
    data: {
      type: 'custom',
      module: 'modules.Image',
      action: 'Generate',
      label: 'Generate',
      params: {
        prompt: { type: 'string', value: 'unchanged original prompt' },
        images: { type: 'image', display: 'output' },
      },
    },
  };
  const preview = {
    id: 'preview',
    type: 'custom',
    position: { x: 400, y: 0 },
    selected: true,
    data: {
      type: 'custom',
      module: 'modules.Image',
      action: 'Preview',
      label: 'Preview',
      params: {
        image: { type: 'image', display: 'input' },
        preview: { type: 'image', display: 'ui_image', sourceKey: 'output' },
      },
    },
  };
  const edges = [
    { id: 'generate-preview', source: 'generate', sourceHandle: 'images', target: 'preview', targetHandle: 'image' },
  ];
  const made = userBlocks.createUserBlockFromSelection({ nodes: [generate, preview], edges });
  assert.equal(made.ok, true);
  const first = userBlocks.createUserBlockNode(made.block, { x: 0, y: 0 }, 'first');
  const second = userBlocks.createUserBlockNode(made.block, { x: 500, y: 0 }, 'second');
  flowStoreModule.useFlowStore.setState({ nodes: [first, second], edges: [] });
  const exported = flowStoreModule.useFlowStore.getState().exportGraph('session-1', second.id);
  assert.deepEqual(Object.keys(exported.nodes).sort(), ['second__generate', 'second__preview']);
  assert.deepEqual(exported.paths, [['second__generate', 'second__preview']]);
  assert.equal(exported.nodes.second__generate.params.prompt.value, 'unchanged original prompt');
  assert.equal(flowStoreModule.resolveFlowExecutionTargetNodeId([first, second], second.id, []), 'second__preview');
});

test('resource assessment uses actual Block scope and invalidates semantic edits without changing the graph', async () => {
  const assessment = await server.ssrLoadModule('/src/studio/workflowResourceAssessmentV2.ts');
  const root = blockV2Root('resource-scope');
  const outside = {
    id: 'outside-lora',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { type: 'custom', module: 'modules.ModularDiffusers', action: 'Lora', label: 'Outside LoRA', params: {} },
  };
  const nodes = [root, outside];
  const before = JSON.stringify(nodes);
  const whole = assessment.buildWorkflowResourceRequestV2(nodes, []);
  const selected = assessment.buildWorkflowResourceRequestV2(nodes, [], root.id);
  assert.equal(whole.adapterCount, 1);
  assert.equal(selected.adapterCount, 0);
  assert.equal(whole.nodeCount, selected.nodeCount + 1);
  assert.equal(JSON.stringify(nodes), before);
  const moved = structuredClone(nodes);
  moved[0].position = { x: 350, y: 220 };
  moved[0].data.blockInstanceV2.presentation.position = { x: 350, y: 220 };
  assert.equal(assessment.buildWorkflowResourceRequestV2(moved, []).key, whole.key);
  const changed = structuredClone(nodes);
  changed[1].data.params.scale = { type: 'float', value: 0.6 };
  assert.notEqual(assessment.buildWorkflowResourceRequestV2(changed, []).key, whole.key);
  assert.equal(assessment.buildWorkflowResourceRequestV2(changed, [], root.id).key, selected.key);
  assert.throws(() => assessment.buildWorkflowResourceRequestV2(nodes, [], 'missing'), /Select a Block/);
});

test('selected Block Auto eligibility ignores an upstream Block excluded from execution', async () => {
  const eligibility = await server.ssrLoadModule('/src/studio/blockAutoEligibilityV2.ts');
  const first = blockV2Root('source-block', true, true);
  const second = blockV2Root('selected-block', true, true);
  const result = eligibility.inspectRegisteredBlockAutoEligibilityV2(
    [first, second],
    [{ id: 'crossing', source: first.id, sourceHandle: 'images', target: second.id, targetHandle: 'prompt' }],
    second.id,
  );
  assert.equal(
    result.code,
    'stale_registered_definition',
    'selected root is inspected on its own; a historical fixture is still not granted Auto authority',
  );
});

function workflowPlan(ready) {
  return {
    schemaVersion: 1,
    graphHash: 'sha256:workflow-auto-v1:' + 'a'.repeat(64),
    plannedGraphHash: 'sha256:workflow-auto-v1:' + 'b'.repeat(64),
    canAutoRun: ready,
    issues: ready ? [] : ['No reviewed recipe'],
    message: 'Workflow Auto',
    patches: [],
    loaders: [],
    requirements: {},
    available: {},
    sharedMemory: false,
  };
}

test('Auto refuses a stale plan if the workflow changes while planning', async () => {
  studioStoreModule.useStudioStore.setState({
    form: { ...studioStoreModule.useStudioStore.getState().form, resourceMode: 'auto' },
  });
  const pending = deferredResponse();
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return pending.promise;
  };
  const auto = await server.ssrLoadModule('/src/studio/workflowAutoExecutionV2.ts');
  const run = auto.prepareWorkflowAutoExecutionV2(graph());
  studioStoreModule.useStudioStore.setState({ activeWorkflowTabId: 'another-workflow' });
  pending.resolve(jsonResponse(workflowPlan(true)));
  await assert.rejects(run, /workflow or mode changed/);
  assert.equal(requests, 1);
});

test('Auto plans an older collapsed Block through a virtual conversion and commits offload with one Undo', async () => {
  const users = await server.ssrLoadModule('/src/studio/userBlocks.ts');
  const legacy = await server.ssrLoadModule('/src/studio/legacyBlockMovementV2.ts');
  const auto = await server.ssrLoadModule('/src/studio/workflowAutoExecutionV2.ts');
  const definition = {
    id: 'legacy-model',
    name: 'Legacy model',
    version: 1,
    nodes: [
      {
        id: 'loader',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          type: 'custom',
          module: 'modules.Primitive',
          action: 'TextValue',
          params: {
            text: { type: 'string', value: 'unchanged prompt' },
            offload_mode: { type: 'string', value: 'none' },
            output: { type: 'string', display: 'output' },
          },
        },
      },
    ],
    edges: [],
    inputs: [],
    outputs: [{ id: 'result', label: 'Result', type: 'string', nodeId: 'loader', paramKey: 'output' }],
    exposedParams: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const root = users.createUserBlockNode(definition, { x: 0, y: 0 }, 'legacy-root');
  const flow = flowStoreModule.useFlowStore;
  flow.getState().replaceGraph({ nodes: [root], edges: [] });
  studioStoreModule.useStudioStore.setState({
    form: { ...studioStoreModule.useStudioStore.getState().form, resourceMode: 'auto' },
  });
  const prepared = legacy.prepareLegacyGraphForAutoV2(flow.getState().nodes, [], undefined);
  const exported = flow.getState().exportGraph('sid', undefined, { sourceGraph: prepared, randomizeSeeds: false });
  assert.equal(flow.getState().nodes[0].data.blockInstanceV2, undefined);
  const loaderId = Object.keys(exported.nodes)[0];
  globalThis.fetch = async () =>
    jsonResponse({ ...workflowPlan(true), patches: [{ nodeId: loaderId, field: 'offload_mode', value: 'model_cpu' }] });
  const submitted = await auto.prepareWorkflowAutoExecutionV2(exported, prepared);
  assert.equal(submitted.nodes[loaderId].params.offload_mode.value, 'model_cpu');
  const converted = flow.getState().nodes.find((node) => node.id === root.id).data.blockInstanceV2;
  assert.equal(converted.effectiveGraph.nodes[0].data.params.text.value, 'unchanged prompt');
  assert.equal(converted.effectiveGraph.nodes[0].data.params.offload_mode.value, 'model_cpu');
  flow.getState().undo();
  assert.equal(flow.getState().nodes.find((node) => node.id === root.id).data.blockInstanceV2, undefined);
});

test('computed resource updates preserve newer user edits and reject malformed events', async () => {
  const auto = await server.ssrLoadModule('/src/studio/workflowAutoExecutionV2.ts');
  const flow = flowStoreModule.useFlowStore;
  const node = {
    id: 'loader',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Primitive',
      action: 'TextValue',
      params: { offload_mode: { type: 'string', value: 'none' }, output: { type: 'string', display: 'output' } },
    },
  };
  flow.getState().replaceGraph({ nodes: [node], edges: [] });
  auto.applyRuntimeWorkflowAutoSettingsV2([
    { nodeId: node.id, field: 'offload_mode', previousValue: 'none', value: 'model_cpu' },
  ]);
  assert.equal(flow.getState().nodes[0].data.params.offload_mode.value, 'model_cpu');
  assert.throws(
    () =>
      auto.applyRuntimeWorkflowAutoSettingsV2([
        { nodeId: node.id, field: 'offload_mode', previousValue: 'none', value: 'group_disk' },
      ]),
    /newer workflow edits/,
  );
  assert.equal(flow.getState().nodes[0].data.params.offload_mode.value, 'model_cpu');
});

test('runtime resource-update messages reject non-resource fields and wrong value types', () => {
  const message = {
    type: 'auto_resource_plan_applied',
    resourceUpdates: [{ nodeId: 'loader', field: 'offload_mode', value: 'model_cpu', previousValue: 'none' }],
  };
  assert.ok(websocketModule.parseWebsocketMessage(JSON.stringify(message)));
  message.resourceUpdates[0].field = 'dtype';
  assert.equal(websocketModule.parseWebsocketMessage(JSON.stringify(message)), null);
  message.resourceUpdates[0].field = 'auto_offload';
  assert.equal(websocketModule.parseWebsocketMessage(JSON.stringify(message)), null);
});

function resourceInputBlock(mirrored = false) {
  const nodes = ['loader', ...(mirrored ? ['peer'] : [])].map((nodeId) => ({
    nodeId,
    nodeType: 'custom',
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Loader',
      params: {
        offload_mode: { type: 'string', value: 'none', isInput: true },
        output: { type: 'pipeline', display: 'output' },
      },
    },
  }));
  const graph = { nodes, edges: [], executionOrder: nodes.map((node) => node.nodeId) };
  graph.graphHash = blockSchemaModule.blockGraphHashV2(graph);
  const definition = {
    schemaVersion: 2,
    definitionId: 'user:resource-input',
    displayName: 'Resource input',
    source: { kind: 'user' },
    graph,
    boundary: {
      mode: 'explicit',
      inputs: [
        {
          portId: 'resource',
          label: 'Offload',
          valueType: 'string',
          required: false,
          binding: { nodeId: 'loader', fieldOrPortId: 'offload_mode' },
          ...(mirrored ? { mirrorBindings: [{ nodeId: 'peer', fieldOrPortId: 'offload_mode' }] } : {}),
        },
      ],
      outputs: [],
    },
    controls: [],
    previews: [],
    ownership: { kind: 'user', definitionMutable: true },
  };
  definition.contentHash = blockSchemaModule.blockDefinitionContentHashV2(definition);
  return blockRuntimeModule.createBlockRootNodeV2(
    blockSchemaModule.createBlockInstanceV2(definition, {
      instanceId: 'resource-block',
      position: { x: 0, y: 0 },
      size: { width: 400, height: 320 },
      values: { resource: 'none' },
    }),
  );
}

test('Auto updates a boundary resource input and keeps export, Undo and Redo consistent', async () => {
  const auto = await server.ssrLoadModule('/src/studio/workflowAutoExecutionV2.ts');
  const flow = flowStoreModule.useFlowStore;
  flow.getState().replaceGraph({ nodes: [resourceInputBlock()], edges: [] });
  const exported = () => flow.getState().exportGraph('', undefined, { randomizeSeeds: false });
  const id = blockRuntimeModule.blockProjectionNodeIdV2('resource-block', 'loader');
  const before = exported();
  const submitted = auto.applyWorkflowAutoSettingsV2(before, [
    { nodeId: id, field: 'offload_mode', value: 'model_cpu' },
  ]);
  assert.equal(
    flow.getState().nodes.find((node) => node.id === 'resource-block').data.blockInstanceV2.values.resource,
    'model_cpu',
  );
  assert.deepEqual(exported(), submitted);
  flow.getState().undo();
  assert.deepEqual(exported(), before);
  flow.getState().redo();
  assert.deepEqual(exported(), submitted);
});

test('Auto treats mirrored boundary resource inputs as one atomic resource group', async () => {
  const auto = await server.ssrLoadModule('/src/studio/workflowAutoExecutionV2.ts');
  const flow = flowStoreModule.useFlowStore;
  flow.getState().replaceGraph({ nodes: [resourceInputBlock(true)], edges: [] });
  const exported = () => flow.getState().exportGraph('', undefined, { randomizeSeeds: false });
  const before = exported();
  const patches = ['loader', 'peer'].map((nodeId) => ({
    nodeId: blockRuntimeModule.blockProjectionNodeIdV2('resource-block', nodeId),
    field: 'offload_mode',
    value: 'model_cpu',
  }));
  assert.throws(() => auto.applyWorkflowAutoSettingsV2(before, patches.slice(0, 1)), /shared resource control/);
  assert.deepEqual(exported(), before);
  studioStoreModule.useStudioStore.setState({
    form: { ...studioStoreModule.useStudioStore.getState().form, resourceMode: 'auto' },
  });
  globalThis.fetch = async () => jsonResponse({ ...workflowPlan(true), patches });
  const submitted = await auto.prepareWorkflowAutoExecutionV2(before);
  assert.deepEqual(exported().nodes, submitted.nodes);
  assert.deepEqual(submitted.runtimeHints.workflowAutoPlan.resourceControlGroups, [
    patches.map(({ nodeId, field }) => ({ nodeId, field })),
  ]);
  flow.getState().undo();
  assert.deepEqual(exported(), before);
});

test('mixed legacy and Modular Auto reaches planning without committing a rejected conversion', async () => {
  const users = await server.ssrLoadModule('/src/studio/userBlocks.ts');
  const { useHuggingFaceNodeLibraryStore: catalog } = await server.ssrLoadModule(
    '/src/stores/useHuggingFaceNodeLibraryStore.ts',
  );
  const { useHuggingFaceModularConditionalStore: hierarchy } = await server.ssrLoadModule(
    '/src/stores/useHuggingFaceModularConditionalStore.ts',
  );
  const original = [catalog.getState(), hierarchy.getState()];
  try {
    catalog.setState({ library: { definitions: [] } });
    hierarchy.setState({ snapshot: { pipelines: [] } });
    const definition = JSON.parse(
      readFileSync(path.join(ROOT, '../MoDiff/tests/fixtures/block_container_interface_v1.json'), 'utf8'),
    );
    const current = blockRuntimeModule.createBlockRootNodeV2(
      blockSchemaModule.createBlockInstanceV2(definition, {
        instanceId: 'current-modular',
        position: { x: 0, y: 0 },
        size: { width: 400, height: 320 },
      }),
    );
    const legacy = users.createUserBlockNode(
      {
        id: 'legacy',
        name: 'Legacy',
        version: 1,
        nodes: [
          {
            id: 'value',
            type: 'custom',
            position: { x: 0, y: 0 },
            data: {
              type: 'custom',
              module: 'modules.Primitive',
              action: 'TextValue',
              params: { text: { type: 'string', value: 'preserved' }, output: { type: 'string', display: 'output' } },
            },
          },
        ],
        edges: [],
        inputs: [],
        outputs: [{ id: 'result', label: 'Result', type: 'string', nodeId: 'value', paramKey: 'output' }],
        exposedParams: [],
        createdAt: 1,
        updatedAt: 1,
      },
      { x: 0, y: 0 },
      'legacy-root',
    );
    const flow = flowStoreModule.useFlowStore;
    flow.getState().replaceGraph({ nodes: [legacy, current], edges: [] });
    const before = flow.getState().toObject();
    studioStoreModule.useStudioStore.setState({
      form: { ...studioStoreModule.useStudioStore.getState().form, resourceMode: 'auto' },
    });
    let planned;
    globalThis.fetch = async (url, options) => {
      assert.match(String(url), /auto_resource\/workflow$/);
      planned = JSON.parse(options.body).graph;
      return jsonResponse(workflowPlan(false));
    };
    await assert.rejects(coordinatorModule.coordinateGraphRun({ sid: 'session-1' }), /No reviewed recipe/);
    assert.ok(Object.values(planned.nodes).some((node) => node.params.text?.value === 'preserved'));
    assert.deepEqual(flow.getState().toObject(), before);
  } finally {
    catalog.setState(original[0]);
    hierarchy.setState(original[1]);
  }
});

test('Modular preparation still rejects live edits while lowering a virtual graph', async () => {
  const composition = await server.ssrLoadModule('/src/studio/modularComposition.ts');
  const { useHuggingFaceNodeLibraryStore: catalog } = await server.ssrLoadModule(
    '/src/stores/useHuggingFaceNodeLibraryStore.ts',
  );
  const { useHuggingFaceModularConditionalStore: hierarchy } = await server.ssrLoadModule(
    '/src/stores/useHuggingFaceModularConditionalStore.ts',
  );
  const original = [catalog.getState(), hierarchy.getState()];
  const flow = flowStoreModule.useFlowStore;
  try {
    catalog.setState({ library: { definitions: [] } });
    const snapshot = flow.getState();
    const executionNodes = structuredClone(snapshot.nodes);
    hierarchy.setState({
      snapshot: null,
      fetchSnapshot: async () => {
        flow.setState({ nodes: [...flow.getState().nodes, resourceInputBlock()] });
        hierarchy.setState({ snapshot: { pipelines: [] } });
      },
    });
    await assert.rejects(composition.prepareModularCompositionExecutionV2(snapshot, executionNodes), /graph changed/);
    assert.ok(flow.getState().nodes.some((node) => node.id === 'resource-block'));
  } finally {
    catalog.setState(original[0]);
    hierarchy.setState(original[1]);
  }
});

test('field actions reject detached canvas controls before dispatch and before late updates', async () => {
  const updates = [];
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return jsonResponse({ error: false });
  };
  const props = {
    nodeId: 'preview',
    fieldKey: 'output',
    module: 'modules.Test',
    action: 'Preview',
    onChange: 'refresh',
    updateStore: (...args) => updates.push(args),
    workflowContext: studioStoreModule.captureWorkflowOperationContext(),
  };
  flowStoreModule.useFlowStore.setState({ nodes: [] });
  await fieldActionModule.default(props, 'late mount');
  assert.deepEqual(calls, [], 'a detached template field must not send empty values to the backend');
  assert.deepEqual(updates, []);

  flowStoreModule.useFlowStore.setState({
    nodes: [
      {
        id: 'preview',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: { module: 'modules.Test', action: 'Preview', params: { output: { value: 'new workflow' } } },
      },
    ],
  });
  studioStoreModule.useStudioStore.setState({ activeWorkflowTabId: 'workflow-other', workflowCanvasEpoch: 1 });
  await fieldActionModule.default(props, 'same id in another workflow');
  assert.deepEqual(calls, []);
  assert.deepEqual(updates, []);

  const currentProps = { ...props, workflowContext: studioStoreModule.captureWorkflowOperationContext() };
  const pending = deferredResponse();
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return pending.promise;
  };
  const action = fieldActionModule.default(currentProps, 'current');
  assert.equal(calls.length, 1, 'current explicit actions still dispatch');
  assert.deepEqual(calls[0].values, { output: 'new workflow' });
  const beforeSwitch = structuredClone(updates);
  studioStoreModule.useStudioStore.setState({ activeWorkflowTabId: 'workflow-origin', workflowCanvasEpoch: 2 });
  pending.resolve(jsonResponse({ error: false }));
  await action;
  assert.deepEqual(updates, beforeSwitch, 'a completed action may not enable fields in another workflow');
});

test('queued option updates retain their originating canvas ownership', async () => {
  const updates = [];
  const props = {
    nodeId: 'preview',
    fieldKey: 'output',
    module: 'modules.Test',
    action: 'Preview',
    workflowContext: studioStoreModule.captureWorkflowOperationContext(),
    onSignal: { action: 'value', target: 'output', prop: 'options', data: { yes: ['new'] } },
    updateStore: (...args) => updates.push(args),
  };
  const action = fieldActionModule.default(props, 'yes', 'onSignal');
  const immediate = structuredClone(updates);
  studioStoreModule.useStudioStore.setState({ activeWorkflowTabId: 'workflow-other', workflowCanvasEpoch: 1 });
  await action;
  assert.deepEqual(updates, immediate);
});

test('nonqueued field metadata requests abort when their workflow is replaced', async () => {
  let signal;
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      signal = init.signal;
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    });
  const request = fieldActionModule.default(
    {
      nodeId: 'preview',
      fieldKey: 'output',
      module: 'modules.Test',
      action: 'Preview',
      onChange: 'refresh',
      updateStore: () => undefined,
    },
    'next',
  );
  try {
    assert.ok(signal);
    studioStoreModule.useStudioStore.setState((state) => ({ workflowCanvasEpoch: state.workflowCanvasEpoch + 1 }));
    assert.equal(signal.aborted, true);
    await request;
  } finally {
    // Avoid leaving the deliberately unanswered request alive after a red assertion.
    if (!signal.aborted) signal.dispatchEvent(new Event('abort'));
    await request.catch(() => undefined);
  }
});

test('navigation cancels nonqueued schema waits and removes its temporary listener', async () => {
  const listeners = new Set();
  globalThis.window.addEventListener = (name, callback) => {
    assert.equal(name, 'beforeunload');
    listeners.add(callback);
  };
  globalThis.window.removeEventListener = (name, callback) => {
    assert.equal(name, 'beforeunload');
    listeners.delete(callback);
  };
  let signal;
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      signal = init.signal;
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    });
  try {
    const request = fieldActionModule.default(
      {
        nodeId: 'preview',
        fieldKey: 'output',
        module: 'modules.Test',
        action: 'Preview',
        onChange: 'refresh',
        updateStore: () => undefined,
      },
      'next',
    );
    assert.equal(listeners.size, 1);
    for (const listener of listeners) listener();
    await request;
    assert.equal(signal.aborted, true);
    assert.equal(listeners.size, 0);
  } finally {
    delete globalThis.window.addEventListener;
    delete globalThis.window.removeEventListener;
  }
});

test('changing workflows retains the acknowledgement of a queued field action', async () => {
  let signal;
  globalThis.fetch = async (_url, init) => {
    signal = init.signal;
    studioStoreModule.useStudioStore.setState((state) => ({ workflowCanvasEpoch: state.workflowCanvasEpoch + 1 }));
    return jsonResponse({ error: false, task_id: 'queued-action' });
  };
  await fieldActionModule.default(
    {
      nodeId: 'preview',
      fieldKey: 'output',
      module: 'modules.Test',
      action: 'Preview',
      onChange: 'refresh',
      fieldOptions: { queue: true },
      updateStore: () => undefined,
    },
    'next',
  );
  assert.equal(signal.aborted, false);
});

for (const responseKind of ['blocked', 'http-error', 'invalid-response']) {
  for (const changed of [false, 'tab', 'graph', 'mode']) {
    test(`workflow Auto ${responseKind} keeps actionable feedback only for the current draft (changed=${changed})`, async () => {
      const auto = await server.ssrLoadModule('/src/studio/workflowAutoExecutionV2.ts');
      studioStoreModule.useStudioStore.setState({
        form: { ...studioStoreModule.useStudioStore.getState().form, resourceMode: 'auto' },
      });
      const before = flowStoreModule.useFlowStore.getState().toObject();
      const pending = deferredResponse();
      const requests = [];
      globalThis.fetch = async (url) => {
        requests.push(String(url));
        return pending.promise;
      };
      const run = auto.prepareWorkflowAutoExecutionV2(graph());
      if (changed === 'tab') studioStoreModule.useStudioStore.setState({ activeWorkflowTabId: 'another-workflow' });
      if (changed === 'graph') flowStoreModule.useFlowStore.getState().setParam('preview', 'output', 'newer.png');
      if (changed === 'mode') studioStoreModule.useStudioStore.getState().updateForm({ resourceMode: 'expert' });
      const currentDraft = flowStoreModule.useFlowStore.getState().toObject();
      pending.resolve(
        responseKind === 'blocked'
          ? jsonResponse(workflowPlan(false))
          : responseKind === 'http-error'
            ? jsonResponse({ error: true, message: 'Runtime requires repair' }, 400)
            : jsonResponse({ invalid: true }),
      );
      await assert.rejects(run);
      const issues = runIssueStoreModule.useRunIssueStore.getState();
      assert.equal(issues.issueDialogOpen, !changed);
      assert.equal(issues.issues.length, changed ? 0 : 1);
      assert.equal(issues.failure, null);
      assert.equal(studioStoreModule.useStudioStore.getState().currentRunContext, null);
      assert.deepEqual(flowStoreModule.useFlowStore.getState().toObject(), currentDraft);
      if (!changed) assert.deepEqual(currentDraft, before);
      assert.equal(requests.length, 1);
      assert.match(requests[0], /auto_resource\/workflow$/);
    });
  }
}

for (const status of ['running', 'succeeded', 'cached']) {
  test(`a ${status} node clears the previous attempt's error detail`, () => {
    const flow = flowStoreModule.useFlowStore.getState();
    flow.setNodeUiState('preview', {
      validationSeverity: 'error',
      validationMessage: 'Previous allocation failed',
      errorMessage: 'Previous allocation failed',
    });
    websocketModule.handleWebsocketMessage(
      { type: status === 'running' ? 'progress' : 'executed', node: 'preview', status, progress: 0 },
      { sid: 'session-1', ws: {}, getSid: () => 'session-1', setSid: () => undefined, setLoopTimer: () => undefined },
    );
    const state = flowStoreModule.useFlowStore.getState().nodes[0].data.uiState;
    assert.equal(state.errorMessage, undefined);
    assert.equal(state.validationSeverity, status === 'running' ? 'info' : 'success');
    assert.notEqual(state.validationMessage, 'Previous allocation failed');
  });
}

function legacyMetadataBlock(id = 'saved') {
  const params = {
    model: { type: 'string', display: 'model', value: 'old', onChange: 'inspect' },
    strength: { type: 'float', default: 1 },
    image: { type: 'image', display: 'input' },
  };
  return {
    id,
    type: 'block',
    position: { x: 0, y: 0 },
    data: {
      type: 'block',
      module: 'user',
      action: 'block',
      userBlockId: 'definition',
      params: { selected: { ...params.model, value: 'new' }, amount: { ...params.strength, value: 0.5 } },
      userBlockSnapshot: {
        id: 'definition',
        name: 'Processor',
        version: 1,
        createdAt: '',
        updatedAt: '',
        edges: [],
        inputs: [],
        outputs: [],
        nodes: [
          {
            id: 'processor',
            type: 'custom',
            position: { x: 0, y: 0 },
            data: { type: 'custom', module: 'modules.Test', action: 'Processor', params },
          },
        ],
        exposedParams: [
          { id: 'selected', nodeId: 'processor', paramKey: 'model' },
          { id: 'amount', nodeId: 'processor', paramKey: 'strength' },
        ],
      },
    },
  };
}

test('collapsed legacy metadata actions use declared internal identity and instance values', async () => {
  const flow = flowStoreModule.useFlowStore;
  const block = legacyMetadataBlock();
  flow.setState({ nodes: [block], edges: [] });
  const definition = structuredClone(block.data.userBlockSnapshot);
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return jsonResponse({ error: false });
  };
  await fieldActionModule.default(
    {
      nodeId: 'saved',
      fieldKey: 'selected',
      module: 'modules.Test',
      action: 'Processor',
      onChange: 'inspect',
      updateStore: (...args) => flow.getState().setParam('saved', ...args),
    },
    'new',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].node, 'saved__processor');
  assert.equal(calls[0].fieldKey, 'model');
  assert.deepEqual(calls[0].values, { model: 'new', strength: 0.5 });
  assert.deepEqual(flow.getState().nodes[0].data.userBlockSnapshot, definition);
});

test('collapsed legacy metadata updates map only exact exposed fields to their owning instance', () => {
  const flow = flowStoreModule.useFlowStore;
  const blocks = [legacyMetadataBlock(), legacyMetadataBlock('peer')];
  flow.setState({ nodes: blocks, edges: [] });
  const before = structuredClone(blocks);
  flow.getState().setParam('saved__processor', 'model', { value: 'pinned', revision: 'a'.repeat(40) });
  assert.deepEqual(flow.getState().getParam('saved', 'selected', 'value'), {
    value: 'pinned',
    revision: 'a'.repeat(40),
  });
  assert.deepEqual(flow.getState().getParam('saved__processor', 'model', 'value'), {
    value: 'pinned',
    revision: 'a'.repeat(40),
  });
  flow.getState().setParam('saved__processor', 'unexposed', 'ignored');
  flow.getState().setParam('saved__other', 'model', 'ignored');
  assert.equal(flow.getState().nodes[0].data.params.unexposed, undefined);
  assert.deepEqual(flow.getState().nodes[0].data.userBlockSnapshot, before[0].data.userBlockSnapshot);
  assert.deepEqual(flow.getState().nodes[1], before[1]);
});

test('collapsed legacy metadata retains websocket ownership and rejects undeclared or replaced owners', async () => {
  const flow = flowStoreModule.useFlowStore;
  const block = legacyMetadataBlock();
  flow.setState({ nodes: [block], edges: [] });
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return jsonResponse({ error: false });
  };
  const props = {
    nodeId: 'saved',
    fieldKey: 'selected',
    module: 'modules.Test',
    action: 'Processor',
    onChange: 'inspect',
    updateStore: (...args) => flow.getState().setParam('saved', ...args),
  };
  await fieldActionModule.default({ ...props, action: 'Other' }, 'new');
  await fieldActionModule.default({ ...props, fieldKey: 'invented' }, 'new');
  assert.deepEqual(calls, []);
  const context = {
    sid: 'session-1',
    ws: {},
    getSid: () => 'session-1',
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  };
  const message = {
    type: 'set_field_value',
    node: 'saved__processor',
    fields: { model: 'pinned' },
    sid: 'session-1',
    workflow_tab_id: 'workflow-origin',
    workflow_canvas_epoch: 0,
    workflow_form_epoch: 0,
  };
  websocketModule.handleWebsocketMessage({ ...message, workflow_canvas_epoch: 1 }, context);
  websocketModule.handleWebsocketMessage({ ...message, workflow_form_epoch: 1 }, context);
  websocketModule.handleWebsocketMessage({ ...message, sid: 'another-session' }, context);
  assert.equal(flow.getState().getParam('saved', 'selected', 'value'), 'new');
  websocketModule.handleWebsocketMessage(message, context);
  assert.equal(flow.getState().getParam('saved', 'selected', 'value'), 'pinned');
  websocketModule.handleWebsocketMessage(
    { ...message, type: 'set_field_visibility', fields: { strength: false } },
    context,
  );
  assert.equal(flow.getState().getParam('saved', 'amount', 'hidden'), true);
  websocketModule.handleWebsocketMessage(
    { ...message, type: 'set_field_params', field: 'strength', params: { max: 2 } },
    context,
  );
  assert.equal(flow.getState().getParam('saved', 'amount', 'max'), 2);
  const before = structuredClone(flow.getState().nodes);
  flow.setState({
    nodes: before.map((node) => ({ ...node, data: { ...node.data, uiState: { blockExpanded: true } } })),
  });
  websocketModule.handleWebsocketMessage({ ...message, fields: { model: 'late' } }, context);
  assert.equal(flow.getState().getParam('saved', 'selected', 'value'), 'pinned');
  flow.setState({ nodes: [] });
  await fieldActionModule.default(props, 'detached');
  websocketModule.handleWebsocketMessage(message, context);
  assert.deepEqual(calls, []);
  assert.deepEqual(flow.getState().nodes, []);
});

test('collapsed legacy model callbacks retain the live structured action descriptor for debouncing', () => {
  const block = legacyMetadataBlock();
  const onChange = { action: 'exec', data: 'inspect' };
  block.data.params.selected.onChange = onChange;
  block.data.userBlockSnapshot.nodes[0].data.params.model.onChange = structuredClone(onChange);
  flowStoreModule.useFlowStore.setState({ nodes: [block], edges: [] });
  const source = fieldActionModule.fieldActionSource({
    nodeId: 'saved',
    fieldKey: 'selected',
    module: 'modules.Test',
    action: 'Processor',
  });
  assert.equal(source.param.onChange, onChange);
  assert.equal(source.node.id, 'saved__processor');
});

test('collapsed legacy inspector controls dispatch the same internal callback as canvas controls', async () => {
  const flow = flowStoreModule.useFlowStore;
  const block = legacyMetadataBlock();
  flow.setState({ nodes: [block], edges: [] });
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return jsonResponse({ error: false });
  };
  await fieldActionModule.default(
    {
      nodeId: block.id,
      fieldKey: 'selected',
      module: block.data.module,
      action: block.data.action,
      onChange: 'inspect',
      updateStore: (...args) => flow.getState().setParam(block.id, ...args),
    },
    'new',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].node, 'saved__processor');
  assert.equal(calls[0].module, 'modules.Test');
  assert.equal(calls[0].action, 'Processor');
  assert.equal(calls[0].fieldKey, 'model');
  assert.deepEqual(calls[0].values, { model: 'new', strength: 0.5 });
});
