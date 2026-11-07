import assert from 'node:assert/strict';

const transportKeys = ['clientRunId', 'runInputHash', 'workflowTabId', 'workflowCanvasEpoch', 'workflowSnapshot'];
const optionalTransportKeys = ['workflowTitle', 'nodeId'];
const managedKeys = `source device cudaIndex modelType mode modelRepo modelName resolvedModelRepo resolvedArtifact
  modelDependencies dtype resourceMode resolvedResourceMode quantizationMode quantizedComponents autoOffload offloadMode
  supportedOffloadModes resourcePlan autoFieldOverrides optimizationQualificationForm resourceRetryModes resourceRetryPlans
  compatibilityStatus cudaBudgetPolicy enforceCudaBudget`.split(/\s+/u);
const memoryKeys = [
  'cudaMemoryFreeBytes',
  'cudaMemoryTotalBytes',
  'requestedCudaReserveBytes',
  'requestedCudaBudgetBytes',
];
const same = (actual, expected, label) => assert.deepEqual(actual, expected, label);
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys, label) => {
  assert.ok(record(value), label);
  same(Object.keys(value).sort(), [...keys].sort(), label);
};
const boundedString = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512;

// canonicalGraphIdentity intentionally preserves its historical v1/v2 vectors;
// it is not a complete executable-envelope validator. In particular, loops and
// servicePackage affect backend execution outside nodes/paths. Close this
// initial accounting scope before comparing canonical identities, even for an
// unhinted graph. Empty loops match the backend's no-loop behavior.
export function assertCanonicalDdimGraphEnvelope(apiGraph) {
  const keys = new Set(['sid', 'nodes', 'paths', 'runtimeHints', 'loops']);
  assert.ok(
    record(apiGraph) && Object.keys(apiGraph).every((key) => keys.has(key)),
    'Unsupported canonical graph top-level execution authority.',
  );
  assert.ok(boundedString(apiGraph.sid), 'Unsupported canonical graph session identity.');
  if (Object.hasOwn(apiGraph, 'loops'))
    same(apiGraph.loops, [], 'Unsupported canonical graph loops; only an absent or empty loop list is accounted.');
}

/** Closed policy for the existing ordinary five-node resident DDIM path only.
 * The caller first validates every consumed field and producer projection.
 * Completion is an original native frame, never a replacement GET task body.
 */
export function canonicalDdimRuntimeHintAccounting({ apiGraph, consumed, plan, runtimeEvidence, digest }) {
  const hints = apiGraph.runtimeHints;
  assert.equal(plan.dtype, 'float32', 'Hinted DDIM dtype variants need a separate accounting policy.');
  assert.equal(
    plan.modelRepo,
    'google/ddpm-cifar10-32',
    'Hinted DDIM model variants need a separate accounting policy.',
  );
  assert.ok(record(runtimeEvidence), 'Declared runtime hints require original completion evidence.');
  const { run, output, graphCompleted: completed } = runtimeEvidence;
  assert.ok(record(completed), 'Original completion frame is required for declared runtime hints.');
  const task = run?.task;
  const managed = Object.hasOwn(hints, 'source');
  const optional = optionalTransportKeys.filter((key) => Object.hasOwn(hints, key));
  const memory = memoryKeys.filter((key) => Object.hasOwn(hints, key));
  exactKeys(
    hints,
    [...transportKeys, ...optional, ...(managed ? managedKeys : []), ...memory],
    'Unknown or incomplete canonical runtime hints.',
  );
  assert.ok(JSON.stringify(hints).length <= 8 * 1024 * 1024, 'Canonical runtime hints exceed their bound.');
  assert.ok(managed || memory.length === 0, 'Transport-only hints cannot declare a CUDA budget.');
  for (const key of ['clientRunId', 'runInputHash', 'workflowTabId'])
    assert.ok(boundedString(hints[key]), `Missing runtime correlation ${key}.`);
  assert.ok(
    Number.isSafeInteger(hints.workflowCanvasEpoch) && hints.workflowCanvasEpoch >= 0,
    'Invalid workflow canvas epoch.',
  );
  assert.equal(task?.status, 'completed', 'Canonical hinted task is not completed.');
  assert.equal(task.attempt_index, 0, 'Canonical retries are outside the reviewed scope.');
  assert.ok(task.resourceCandidateId == null, 'Canonical Expert task retains an Auto candidate.');
  assert.ok(
    !task.runtimeHints || Object.keys(task.runtimeHints).length === 0,
    'Canonical task contains unreviewed runtime hints.',
  );
  assert.equal(output?.attemptIndex, 0, 'Canonical hinted output attempt differs.');
  assert.ok(
    boundedString(output?.id) && boundedString(output?.nodeId) && boundedString(output?.fieldKey),
    'Canonical hinted output identity is missing.',
  );
  assert.equal(output?.resolvedExecutionInputs?.attemptIndex, 0, 'Canonical hinted accounting attempt differs.');
  same(consumed, output.resolvedExecutionInputs, 'Canonical hinted consumed receipt differs from the original output.');
  assert.equal(output.nodeId, consumed.nodeId, 'Canonical hinted output owner differs from accounting.');
  assert.equal(output.taskId, task.task_id, 'Canonical hinted output belongs to another task.');
  assert.equal(
    output.resolvedExecutionInputs.taskId,
    task.task_id,
    'Canonical hinted accounting belongs to another task.',
  );
  assert.equal(run.workflow_id, hints.workflowTabId, 'Canonical hinted run workflow differs.');
  const persisted = (run.outputs ?? []).filter((row) => row.id === output.id && row.taskId === task.task_id);
  assert.equal(persisted.length, 1, 'Canonical hinted output is not unique in the original GET.');
  for (const key of [
    'taskId',
    'attemptIndex',
    'clientRunId',
    'runInputHash',
    'workflowTabId',
    'formSnapshot',
    'graphSnapshot',
    'apiGraphSnapshot',
    'resolvedExecutionInputs',
    'mediaHash',
    'mediaItems',
    'nodeId',
    'fieldKey',
  ]) {
    assert.notEqual(output[key], undefined, `Original hinted output ${key} is missing.`);
    same(output[key], persisted[0][key], `Original hinted output ${key} differs.`);
  }
  same(output.apiGraphSnapshot, apiGraph, 'Hinted submitted/output API graph differs.');
  const identityKeys = {
    clientRunId: 'client_run_id',
    runInputHash: 'run_input_hash',
    workflowTabId: 'workflow_tab_id',
    workflowCanvasEpoch: 'workflow_canvas_epoch',
  };
  assert.ok(task.workflow_form_epoch == null, 'Unexpected raw task form epoch.');
  for (const [hint, wire] of Object.entries(identityKeys)) {
    same(task[wire], hints[hint], `Raw task ${wire} differs from submitted hints.`);
    same(completed?.[wire], hints[hint], `Completion ${wire} differs from submitted hints.`);
    if (hint !== 'workflowCanvasEpoch') same(output[hint], hints[hint], `Output ${hint} differs from submitted hints.`);
  }
  exactKeys(
    completed,
    [
      'type',
      'sid',
      'task_id',
      ...Object.values(identityKeys),
      ...(Object.hasOwn(hints, 'nodeId') ? ['node_id'] : []),
      'executionTime',
      'runtimeFingerprint',
      'deterministicMode',
      'runtimeHints',
      'runtimeBudget',
      'runtimeMeasurement',
      'runtimePreparation',
      'resourceRetryHistory',
    ],
    'Original graph_completed frame shape differs.',
  );
  assert.equal(completed.type, 'graph_completed');
  assert.equal(completed.task_id, task.task_id, 'Completion belongs to another task.');
  assert.ok(boundedString(completed.sid), 'Completion session is missing.');
  assert.equal(completed.sid, task.sid, 'Completion/raw task session differs.');
  if (apiGraph.sid !== undefined) assert.equal(completed.sid, apiGraph.sid, 'Submitted/completion session differs.');
  if (output.sid != null) assert.equal(completed.sid, output.sid, 'Output/completion session differs.');
  if (Object.hasOwn(hints, 'nodeId')) {
    assert.equal(hints.nodeId, output.nodeId, 'Targeted runtime output owner differs.');
    assert.equal(task.node_id, hints.nodeId, 'Raw task target differs.');
    assert.equal(completed.node_id, hints.nodeId, 'Completion target differs.');
  } else assert.ok(task.node_id == null, 'Unexpected raw task target.');
  same(completed.resourceRetryHistory, [], 'Canonical completion contains retry history.');
  assert.ok(
    record(completed.runtimeFingerprint) && record(completed.runtimeFingerprint.backendSource),
    'Structured completion runtime/source is missing.',
  );
  same(completed.runtimeFingerprint, task.runtimeFingerprint, 'Completion/raw task runtime or source differs.');
  assert.ok(record(completed.runtimeMeasurement), 'Completion measurement is missing.');
  same(completed.runtimeMeasurement, task.runtimeMeasurement, 'Completion/raw task measurement differs.');
  assert.ok(
    Number.isFinite(completed.executionTime) && completed.executionTime > 0,
    'Completion execution duration is missing.',
  );
  assert.ok(
    Number.isFinite(task.started_at) && Number.isFinite(task.completed_at) && task.completed_at >= task.started_at,
    'Original hinted task duration is missing.',
  );
  assert.ok(
    completed.executionTime <= task.completed_at - task.started_at + 1,
    'Completion duration exceeds the original task interval.',
  );
  // This initial ordinary route does not add a deterministic receipt. A future
  // route must join its native settings rather than treating them as transport.
  assert.ok(
    apiGraph.deterministicMode == null && completed.deterministicMode == null,
    'Hinted deterministic execution needs a separate accounting policy.',
  );
  same(
    completed.runtimePreparation ?? null,
    task.runtimePreparation ?? null,
    'Completion/raw task preparation differs.',
  );
  if (completed.runtimePreparation != null) {
    assert.ok(
      record(completed.runtimePreparation) && completed.runtimePreparation.resourceMode === 'expert',
      'Canonical runtime preparation is outside Expert scope.',
    );
    for (const key of ['workflowAuto', 'mutationPreparation', 'policyPreparation'])
      assert.ok(
        !Object.hasOwn(completed.runtimePreparation, key),
        'Automatic or mutation preparation is outside canonical scope.',
      );
  }
  const snapshot = hints.workflowSnapshot;
  assert.ok(
    record(snapshot) && Array.isArray(snapshot.nodes) && Array.isArray(snapshot.edges),
    'Original workflow snapshot is missing.',
  );
  same(
    snapshot.nodes.map((node) => node.id).sort(),
    Object.keys(apiGraph.nodes).sort(),
    'Workflow snapshot owner scope differs.',
  );
  for (const node of snapshot.nodes) {
    assert.ok(!node.data?.blockInstanceV2, 'Block snapshot authority is outside ordinary DDIM scope.');
    assert.equal(node.data?.module, apiGraph.nodes[node.id]?.module, 'Workflow snapshot module differs.');
    assert.equal(node.data?.action, apiGraph.nodes[node.id]?.action, 'Workflow snapshot action differs.');
  }
  same(snapshot.studioForm, output.formSnapshot, 'Submitted snapshot/output form differs.');
  assert.equal(output.formSnapshot?.modelType, plan.modelType, 'Original hinted form model differs.');
  assert.equal(output.formSnapshot?.mode, 'unconditional_image', 'Original hinted form task differs.');
  for (const key of ['nodes', 'edges', 'viewport'])
    same(snapshot[key], output.graphSnapshot?.[key], `Submitted snapshot/output ${key} differs.`);
  same(task.workflow_snapshot, snapshot, 'Raw task workflow snapshot differs.');
  same(run.workflow_snapshot, snapshot, 'Raw run workflow snapshot differs.');
  if (Object.hasOwn(hints, 'workflowTitle')) {
    assert.ok(
      typeof hints.workflowTitle === 'string' &&
        hints.workflowTitle.length > 0 &&
        hints.workflowTitle.length <= 256 &&
        hints.workflowTitle.trim() === hints.workflowTitle,
      'Workflow title would be coerced.',
    );
    assert.equal(task.workflow_title, hints.workflowTitle, 'Raw task workflow title differs.');
    assert.equal(run.workflow_title, hints.workflowTitle, 'Raw run workflow title differs.');
  } else {
    assert.ok(task.workflow_title == null && run.workflow_title == null, 'Unsubmitted workflow title is present.');
  }
  // Check the actual FE correlation algorithm; this 32-bit value is a join,
  // never a substitute for the SHA-bound originals and executed field receipt.
  const ordered = (value) =>
    Array.isArray(value)
      ? value.map(ordered)
      : record(value)
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, ordered(item)]),
          )
        : value;
  const input = JSON.stringify(
    ordered({
      form: output.formSnapshot,
      nodes: apiGraph.nodes,
      paths: apiGraph.paths,
      deterministicMode: apiGraph.deterministicMode,
      provenance: apiGraph.provenance,
    }),
  );
  let correlation = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1)
    correlation = Math.imul(correlation ^ input.charCodeAt(index), 0x01000193);
  assert.equal(
    hints.runInputHash,
    `run_${(correlation >>> 0).toString(16).padStart(8, '0')}`,
    'Submitted run input hash differs from original form/graph.',
  );
  same(
    completed.runtimeHints,
    { ...hints, controlledArtifacts: [], loaderContract: ['modules.DiffusersImage.LoadPipeline'] },
    'Actual worker hints differ from the submitted DDIM policy.',
  );
  let budgetDecision = 'no-cuda-target';
  if (managed) {
    const expected = {
      source: 'studio',
      device: plan.device,
      modelType: plan.modelType,
      mode: 'unconditional_image',
      modelRepo: plan.modelRepo,
      resolvedModelRepo: plan.modelRepo,
      resolvedArtifact: plan.modelRepo,
      modelDependencies: [],
      dtype: plan.dtype,
      resourceMode: 'expert',
      resolvedResourceMode: 'expert',
      quantizationMode: 'none',
      quantizedComponents: [],
      autoOffload: false,
      offloadMode: 'none',
      supportedOffloadModes: ['none', 'model_cpu'],
      autoFieldOverrides: [],
      resourceRetryModes: ['model_cpu'],
      resourceRetryPlans: [],
      compatibilityStatus: 'expert',
      cudaBudgetPolicy: 'advisory',
      enforceCudaBudget: false,
    };
    for (const [key, item] of Object.entries(expected))
      same(hints[key], item, `Managed DDIM hint ${key} differs from executed controls.`);
    assert.equal(hints.modelName, 'DDIM CIFAR-10 32x32', 'Managed DDIM profile variant is unsupported.');
    const match = /^cuda:(\d+)$/u.exec(plan.device);
    assert.ok(
      match && plan.modelRepo === 'google/ddpm-cifar10-32',
      'Managed DDIM device/model variant is unsupported.',
    );
    assert.equal(hints.cudaIndex, Number(match[1]));
    same(
      hints.resourcePlan,
      {
        summary: `Expert: ${plan.dtype}, none, off`,
        executionPath: null,
        resolvedModelRepo: plan.modelRepo,
        resolvedArtifact: plan.modelRepo,
        dtype: plan.dtype,
        quantizationMode: 'none',
        quantizedComponents: [],
        autoOffload: false,
        offloadMode: 'none',
      },
      'Managed resource summary contradicts execution.',
    );
    same(
      hints.optimizationQualificationForm,
      output.formSnapshot,
      'Optimization observation form differs from original output.',
    );
    for (const [key, item] of Object.entries({
      modelType: plan.modelType,
      mode: 'unconditional_image',
      resourceMode: 'expert',
      dtype: plan.dtype,
      device: plan.device,
      quantizationMode: 'none',
      offloadMode: 'none',
      autoOffload: false,
    }))
      same(output.formSnapshot[key], item, `Managed observation form ${key} differs.`);
    // These counters remain advisory. When present, require the exact FE
    // arithmetic and the actual successful server reset branch, not fraction1
    // alone (the failure branch also reports fraction1).
    if (memory.length) {
      assert.ok(
        Object.hasOwn(hints, 'cudaMemoryTotalBytes') &&
          Object.hasOwn(hints, 'requestedCudaReserveBytes') &&
          Object.hasOwn(hints, 'requestedCudaBudgetBytes'),
        'Incomplete advisory memory counters.',
      );
      for (const key of memory)
        assert.ok(Number.isSafeInteger(hints[key]) && hints[key] >= 0, `Invalid advisory byte counter ${key}.`);
      const total = hints.cudaMemoryTotalBytes;
      const free = hints.cudaMemoryFreeBytes;
      assert.ok(total > 0 && (free === undefined || free <= total), 'Invalid advisory memory total.');
      const reserve = Math.max(1024 ** 3, Math.floor(total * 0.1));
      const fromFree = free && reserve ? Math.max(0, free - reserve) : undefined;
      const fromTotal = Math.max(0, total - reserve);
      const budget = fromFree && fromTotal ? Math.min(fromFree, fromTotal) : (fromFree ?? fromTotal);
      assert.equal(hints.requestedCudaReserveBytes, reserve);
      assert.equal(hints.requestedCudaBudgetBytes, budget);
    }
    same(
      completed.runtimeBudget,
      {
        applied: false,
        reason: 'CUDA budget is advisory; reset PyTorch process memory fraction to full device.',
        cuda_index: hints.cudaIndex,
        cuda_budget_policy: 'advisory',
        fraction: 1,
        model_repo: hints.modelRepo,
        model_name: hints.modelName,
        execution_path: null,
        offload_mode: 'none',
      },
      'Actual advisory CUDA budget reset is unproved or differs.',
    );
    budgetDecision = 'advisory-reset-recorded';
  } else
    same(
      completed.runtimeBudget,
      { applied: false, reason: 'Runtime hints did not target a CUDA device.' },
      'Transport-only budget decision differs.',
    );
  return {
    policy: 'canonical-ddim-runtime-hints-v1',
    route: managed ? 'studio-expert' : 'correlation-only',
    budgetDecision,
    submittedHintsHash: digest('canonical-runtime-hints-v1', hints),
    graphCompletedHash: digest('canonical-graph-completed-v1', completed),
  };
}
