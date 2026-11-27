import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createServer } from 'vite';

let server, flow, readiness, nodesStore;
before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    localStorage,
    sessionStorage: localStorage,
    dispatchEvent: () => true,
    location: { origin: 'http://127.0.0.1:5191' },
  };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  ({ useFlowStore: flow } = await server.ssrLoadModule('/src/stores/useFlowStore.ts'));
  readiness = await server.ssrLoadModule('/src/studio/runReadiness.ts');
  ({ useNodesStore: nodesStore } = await server.ssrLoadModule('/src/stores/useNodeStore.ts'));
});
after(async () => server?.close());
beforeEach(() => flow.getState().replaceGraph({ nodes: [], edges: [] }));

function graph(display = 'ui_video', source = 'file') {
  return {
    nodes: [
      {
        id: 'frames',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          module: 'modules.Video',
          action: 'Load',
          label: 'Scene',
          type: 'custom',
          params: {
            file: { display: 'filebrowser', type: 'str', value: ['@data/videos/scene.mp4'] },
            video: { display: 'output', type: 'video' },
          },
        },
      },
      {
        id: 'film',
        type: 'custom',
        position: { x: 300, y: 0 },
        data: {
          module: 'modules.Video',
          action: 'ExportWithAudio',
          label: 'Moonflower photographic film',
          category: 'Video',
          type: 'custom',
          params: {
            video: { display: 'input', type: 'video' },
            preview: { display, type: 'url', dataSource: source },
            file: { display: 'output', type: 'video' },
          },
        },
      },
    ],
    edges: [{ id: 'frames-film', source: 'frames', sourceHandle: 'video', target: 'film', targetHandle: 'video' }],
  };
}

function structuralIssues() {
  return readiness
    .collectRunReadinessIssues({ sid: 'unit-session', isConnected: true, includeStudio: false })
    .filter((issue) => ['graph_output_missing', 'graph_output_disconnected'].includes(issue.code));
}

test('a renamed video-with-audio exporter retains its declared visible output', () => {
  const original = graph();
  flow.getState().replaceGraph(original);
  const before = structuredClone(flow.getState().toObject());
  const inspection = readiness.inspectCurrentGraph();
  assert.deepEqual(inspection.connectedOutputNodeIds, ['film']);
  assert.equal(inspection.outputPathCount, 1);
  assert.deepEqual(structuralIssues(), []);
  assert.deepEqual(flow.getState().toObject(), before, 'Readiness must not repair or relabel the saved graph.');
});

test('declared media and text previews do not depend on a node label or action spelling', () => {
  for (const display of ['ui_image', 'ui_video', 'ui_audio', 'ui_text', 'ui_imagecompare']) {
    const current = graph(display);
    current.nodes[1].data.module = 'modules.Utility';
    current.nodes[1].data.action = 'Bake';
    flow.getState().replaceGraph(current);
    assert.deepEqual(readiness.inspectCurrentGraph().connectedOutputNodeIds, ['film'], display);
  }
});

test('an input-backed widget or unknown preview source does not invent an output', () => {
  for (const source of ['video', 'absent', '']) {
    flow.getState().replaceGraph(graph('ui_video', source));
    assert.deepEqual(readiness.inspectCurrentGraph().outputNodeIds, [], source);
    assert.equal(structuralIssues()[0]?.code, 'graph_output_missing');
  }
  flow.getState().replaceGraph(graph('ui_label'));
  assert.deepEqual(readiness.inspectCurrentGraph().outputNodeIds, []);
});

test('disabled and disconnected declared outputs still block Run', () => {
  const disconnected = graph();
  disconnected.edges = [];
  flow.getState().replaceGraph(disconnected);
  assert.equal(structuralIssues()[0]?.code, 'graph_output_disconnected');
  const disabled = graph();
  disabled.nodes[1].data.uiState = { disabled: true };
  flow.getState().replaceGraph(disabled);
  assert.equal(structuralIssues()[0]?.code, 'graph_output_missing');
});

test('readiness excludes descendants of disabled containers just as API export does', () => {
  const current = graph();
  current.nodes.forEach((node) => {
    node.parentId = 'disabled-stage';
  });
  current.nodes.unshift({
    id: 'disabled-stage',
    type: 'group',
    position: { x: 0, y: 0 },
    data: { type: 'group', module: '', action: '', params: {}, uiState: { disabled: true } },
  });
  flow.getState().replaceGraph(current);
  const before = structuredClone(flow.getState().toObject());
  const inspection = readiness.inspectCurrentGraph();
  assert.equal(inspection.enabledExecutableCount, 0);
  assert.deepEqual(inspection.outputNodeIds, []);
  assert.deepEqual(flow.getState().toObject(), before);
});

test('the graph names only an unambiguous owner with literal model selectors', () => {
  const pipeline = 'ExampleVideoAudioPipeline';
  const loader = {
    id: 'declared-owner',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.DiffusersVideo',
      action: 'LoadPipeline',
      label: 'Model Setup',
      params: {
        pipeline_class: { value: pipeline },
        model_id: { value: { source: 'hub', value: 'publisher/example' } },
        execution_profile_id: { value: 'example:direct' },
      },
      operationAuthoring: {
        schemaVersion: 1,
        operation: {
          pipelineClass: pipeline,
          task: 'text_to_video_with_audio',
          workflowId: null,
          binding: { pipelineClass: pipeline, values: {} },
          operationId: 'diffusion.load_models',
          nodeKey: 'modules.DiffusersVideo.LoadPipeline',
          nodeType: 'loader',
          blockName: null,
          decomposition: 'loader',
          support: 'declared',
          ports: [],
        },
        defaults: {},
        retained: [],
      },
    },
  };
  flow.getState().replaceGraph({ nodes: [loader], edges: [] });
  const before = structuredClone(flow.getState().toObject());
  const summary = readiness.inspectCurrentGraph();
  assert.equal(summary.declaredTask, 'text_to_video_with_audio');
  const declared = summary.declaredModel;
  assert.deepEqual(declared, {
    pipeline,
    repo: 'publisher/example',
    profileId: 'example:direct',
  });
  assert.deepEqual(readiness.inspectWorkflowModel(before), declared);
  assert.deepEqual(flow.getState().toObject(), before);

  const other = structuredClone(loader);
  other.id = 'other-model-owner';
  flow.getState().replaceGraph({ nodes: [loader, other], edges: [] });
  const multiple = readiness.inspectCurrentGraph();
  assert.equal(multiple.modelRefs.length, 2, 'Separate owners can select the same repository.');
  assert.equal(multiple.declaredModel, undefined);
  assert.deepEqual(
    readiness.inspectWorkflowModel(before),
    declared,
    'The inspected capture can outlive the active graph.',
  );

  const source = graph().nodes[0];
  flow.getState().replaceGraph({
    nodes: [source, loader],
    edges: [
      { id: 'connected-model', source: source.id, sourceHandle: 'video', target: loader.id, targetHandle: 'model_id' },
    ],
  });
  assert.equal(
    readiness.inspectCurrentGraph().declaredModel,
    undefined,
    'A connected selector can override its literal.',
  );

  const stale = structuredClone(loader);
  stale.data.params.pipeline_class.value = 'DifferentPipeline';
  flow.getState().replaceGraph({ nodes: [stale], edges: [] });
  assert.equal(
    readiness.inspectCurrentGraph().declaredModel,
    undefined,
    'A stale hint cannot supply the runtime name.',
  );
});

test('a conflicting catalog label keeps the declared pipeline name', () => {
  const model = { pipeline: 'ExamplePipeline', profileId: 'default:profile', repo: 'publisher/repo' };
  const known = { ...model, label: 'Example Model' };
  const unrelated = { ...known, repo: 'other/repo', label: 'Other Model' };
  assert.equal(readiness.declaredGraphModelLabel(model, [known, unrelated]), known.label);
  assert.equal(readiness.declaredGraphModelLabel(model, [unrelated]), model.pipeline);
  assert.equal(
    readiness.declaredGraphModelLabel(model, [known, { ...known, label: 'Conflicting Model' }]),
    model.pipeline,
  );
});

test('only registry-declared inactive model fields are omitted from setup references', () => {
  const key = 'modules.TestLoader.Load';
  const previous = nodesStore.getState().nodesRegistry;
  const node = {
    id: 'loader',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      module: 'modules.TestLoader',
      action: 'Load',
      params: {
        model_id: { display: 'modelselect', hidden: true, value: { source: 'hub', value: 'publisher/base' } },
        auxiliary_model_id: {
          display: 'modelselect',
          hidden: true,
          value: { source: 'hub', value: 'publisher/auxiliary' },
          fieldOptions: { modelReferenceInactiveWhenHidden: true },
        },
      },
    },
  };
  try {
    nodesStore.setState({ nodesRegistry: { [key]: { params: { model_id: {}, auxiliary_model_id: {} } } } });
    assert.equal(readiness.collectNodeModelReferences(node).length, 2, 'Imported metadata cannot opt itself out.');
    nodesStore.setState({
      nodesRegistry: {
        [key]: {
          params: { model_id: {}, auxiliary_model_id: { fieldOptions: { modelReferenceInactiveWhenHidden: true } } },
        },
      },
    });
    const before = structuredClone(node);
    assert.deepEqual(
      readiness.collectNodeModelReferences(node).map((r) => r.value),
      ['publisher/base'],
    );
    assert.deepEqual(node, before, 'Inspection cannot clear retained model choices.');
    node.data.params.auxiliary_model_id.hidden = false;
    assert.equal(readiness.collectNodeModelReferences(node).length, 2, 'An active auxiliary remains required.');
    delete node.data.params.auxiliary_model_id.hidden;
    assert.equal(readiness.collectNodeModelReferences(node).length, 2, 'Unknown visibility remains conservative.');
  } finally {
    nodesStore.setState({ nodesRegistry: previous });
  }
});
