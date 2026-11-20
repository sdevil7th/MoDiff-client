import assert from 'node:assert/strict';
import test from 'node:test';
import { validateLateNativeImageVariantRun, validateNativeVariantRun } from './native-variant-run-evidence.mjs';
import { bindPrivateImageEditGraph } from './private-image-edit-evidence.mjs';

function archivedImage() {
  const target = { task: 'edit_image', modelType: 'LatentConsistencyModelPipeline' };
  const formSnapshot = { ...target, mode: target.task, resourceMode: 'expert' };
  const graphSnapshot = { nodes: [], edges: [] };
  const workflowSnapshot = { ...graphSnapshot, studioForm: formSnapshot };
  const hints = {
    clientRunId: 'client-run',
    runInputHash: 'run-input',
    workflowTabId: 'workflow',
    workflowCanvasEpoch: 2,
    workflowTitle: 'Private image test',
    workflowSnapshot,
  };
  const sid = 'native-session';
  const taskId = 'native-task';
  const apiGraphSnapshot = { sid, nodes: {}, paths: [], runtimeHints: hints };
  const item = { displayType: 'image', backendPath: '@data/studio/outputs/test.webp', byteSize: 10 };
  const earlyMedia = [{ ...item, durationSeconds: null }];
  const mediaItems = [{ ...item, label: 'Item 1' }];
  const backendIdentity = { source: 'backend-record', backendExecutionId: taskId, mediaHash: 'native-image-sha' };
  const runtimeFingerprint = { fingerprint: 'private-runtime' };
  const runtimeMeasurement = { elapsedSeconds: 1 };
  const runtimePreparation = null;
  const shared = {
    taskId,
    sid,
    id: 'native-image',
    attemptIndex: 0,
    clientRunId: hints.clientRunId,
    runInputHash: hints.runInputHash,
    workflowTabId: hints.workflowTabId,
    nodeId: 'preview',
    fieldKey: 'preview',
    displayType: 'image',
    formSnapshot,
    graphSnapshot,
    resolvedExecutionInputs: {},
    mediaHash: backendIdentity.mediaHash,
    mediaCollectionHash: 'native-collection-sha',
  };
  const output = {
    ...shared,
    apiGraphSnapshot,
    mediaItems,
    backendProvenance: { ...backendIdentity, mediaItems, capturedAt: 200, exactTemplateCompatible: false },
  };
  const early = {
    ...shared,
    mediaItems: earlyMedia,
    backendProvenance: { ...backendIdentity, mediaItems: earlyMedia, capturedAt: 100 },
  };
  const context = {
    client_run_id: hints.clientRunId,
    run_input_hash: hints.runInputHash,
    workflow_tab_id: hints.workflowTabId,
    workflow_canvas_epoch: hints.workflowCanvasEpoch,
  };
  const run = {
    task: {
      task_id: taskId,
      sid,
      status: 'completed',
      attempt_index: 0,
      resourceCandidateId: null,
      started_at: 100,
      completed_at: 200,
      ...context,
      runtimeFingerprint,
      runtimeMeasurement,
      runtimePreparation,
      workflow_snapshot: workflowSnapshot,
    },
    workflow_id: hints.workflowTabId,
    workflow_title: hints.workflowTitle,
    workflow_snapshot: workflowSnapshot,
    outputs: [early],
  };
  return {
    target,
    displayType: 'image',
    outputNodeId: 'preview',
    run,
    creator: { manifest: { packageType: 'modiff-workflow-share' }, metadata: { studio: formSnapshot } },
    outputPackage: {
      manifest: { packageType: 'modiff-output-package' },
      apiGraph: apiGraphSnapshot,
      graph: graphSnapshot,
      latestOutput: structuredClone(output),
    },
    graphCompleted: {
      type: 'graph_completed',
      task_id: taskId,
      sid,
      ...context,
      deterministicMode: null,
      resourceRetryHistory: [],
      runtimeBudget: { applied: false },
      runtimeFingerprint,
      runtimeMeasurement,
      runtimePreparation,
    },
    graphRequest: apiGraphSnapshot,
    graphAcknowledgment: { error: false, sid, task_id: taskId },
    persistedOutput: output,
  };
}

test('strict output verification accepts a separately joined late native image snapshot', () => {
  const options = archivedImage();
  const before = structuredClone(options);
  assert.throws(() => validateNativeVariantRun(options), /native output apiGraphSnapshot differs/u);
  const { task, output } = validateLateNativeImageVariantRun(options);
  assert.equal(task.task_id, 'native-task');
  assert.equal(output.apiGraphSnapshot.sid, 'native-session');
  assert.deepEqual(options, before);
});

test('the late native image join rejects a changed task, capture, graph or output', () => {
  const scenarios = [
    [
      ({ persistedOutput }) => {
        persistedOutput.taskId = 'different-task';
      },
      /changed taskId/u,
    ],
    [
      ({ persistedOutput }) => {
        persistedOutput.apiGraphSnapshot = undefined;
      },
      /snapshot is missing/u,
    ],
    [
      ({ persistedOutput }) => {
        persistedOutput.apiGraphSnapshot = { ...persistedOutput.apiGraphSnapshot, sid: 'different' };
      },
      /apiGraphSnapshot differs/u,
    ],
    [
      ({ run }) => {
        run.outputs[0].resolvedExecutionInputs = { swapped: true };
      },
      /changed resolvedExecutionInputs/u,
    ],
    [
      ({ persistedOutput }) => {
        persistedOutput.mediaItems[0].byteSize = 11;
      },
      /image identity changed/u,
    ],
    [
      ({ persistedOutput }) => {
        persistedOutput.backendProvenance.backendExecutionId = 'stale-task';
      },
      /provenance identity changed/u,
    ],
    [
      ({ persistedOutput }) => {
        persistedOutput.backendProvenance.exactTemplateCompatible = true;
      },
      /false/u,
    ],
  ];
  for (const [mutate, error] of scenarios) {
    const options = archivedImage();
    mutate(options);
    assert.throws(() => validateLateNativeImageVariantRun(options), error);
  }
});

test('private direct image edit graph binds exactly one empty file and one empty prompt', () => {
  const expected = {
    sid: 'canonical',
    nodes: {
      quantization: { module: 'modules.DiffusersRuntime', action: 'PipelineQuantizationConfigV2', params: {} },
      recipe: { module: 'modules.DiffusersRuntime', action: 'DiffusersExecutionRecipe', params: {} },
      loader: { module: 'modules.DiffusersImage', action: 'LoadPipeline', params: {} },
      source: { module: 'modules.Image', action: 'Load', params: { file: { value: [], display: 'filebrowser' } } },
      edit: {
        module: 'modules.DiffusersImage',
        action: 'Edit',
        params: {
          prompt: { value: '' },
          strength: { value: 0.8 },
          image: { display: 'input', sourceId: 'source', sourceKey: 'image' },
        },
      },
      preview: { module: 'modules.Image', action: 'Preview', params: {} },
    },
    paths: [['quantization', 'recipe', 'loader', 'source', 'edit', 'preview']],
  };
  const input = { nodeId: 'source', field: 'file', sourceValue: 'source.webp' };
  const submitted = structuredClone(expected);
  submitted.nodes.source.params.file.value = [input.sourceValue];
  submitted.nodes.edit.params.prompt.value = 'A lake at dawn.';
  const invoke = () => bindPrivateImageEditGraph({ expected, submitted, input });
  assert.equal(invoke().prompt, 'A lake at dawn.');
  assert.deepEqual(expected.nodes.source.params.file.value, []);
  submitted.nodes.edit.params.strength.value = 0.7;
  assert.throws(invoke, /changed|differs outside/u);
  const strengthVariant = { original: 0.8, retained: 0.7 };
  const bindVariant = (variant = strengthVariant) =>
    bindPrivateImageEditGraph({ expected, submitted, input, strengthVariant: variant });
  assert.equal(bindVariant().edit.node.params.strength.value, 0.7);
  assert.equal(expected.nodes.edit.params.strength.value, 0.8);
  assert.throws(() => bindVariant({ ...strengthVariant, original: 0.5 }));
  submitted.nodes.edit.params.strength.value = 0.8;
  assert.throws(() => bindVariant(), /differs outside/u);
  submitted.nodes.edit.params.image.sourceKey = 'mask';
  assert.throws(invoke, /differs outside/u);
  submitted.loops = [];
  assert.throws(invoke, /Unexpected evidence fields/u);
});
