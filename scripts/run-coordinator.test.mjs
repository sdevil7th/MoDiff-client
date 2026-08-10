import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let coordinatorModule;
let fieldActionModule;
let flowStoreModule;
let nodesStoreModule;
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
    server: { middlewareMode: true },
    appType: 'custom',
  });
  coordinatorModule = await server.ssrLoadModule('/src/studio/runCoordinator.ts');
  fieldActionModule = await server.ssrLoadModule('/src/utils/fieldAction.ts');
  flowStoreModule = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  nodesStoreModule = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
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

test('field schema actions invert hide conditions, merge the target, and preserve registry defaults', async () => {
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
