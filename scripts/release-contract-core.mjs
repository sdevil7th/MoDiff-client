import { canonicalJsonHash } from './canonical-json.mjs';
import { assertCanonicalDdimGraphEnvelope } from './canonical-runtime-hints.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, sep } from 'node:path';
import {
  backendSourceEvidence,
  canonicalGraphIdentity,
  canonicalAccountingExecutionPlan,
  createRunProvenance,
  executionPlanIdentity,
  executionReceiptIdentity,
  normalizeBackendRuntime,
  selectInstalledModelIdentity,
  selectBackendRuntimeFingerprintEvidence,
  sha256Value,
  stableStringify,
  validateRunProvenance,
} from './live-proof-provenance.mjs';

export function backendNodesFromCanonicalWorkflow(graph) {
  return [
    ...new Set(
      (graph?.nodes ?? [])
        .map((node) => `${node?.data?.module}.${node?.data?.action}`)
        .filter((value) => !value.includes('undefined')),
    ),
  ].sort();
}

export function canonicalWorkflowContract(manifest, graph) {
  const actualGraphHash = canonicalJsonHash(graph);
  if (manifest?.graphHash !== actualGraphHash) {
    throw new Error(`${String(manifest?.id ?? 'Canonical workflow')} graph hash does not match its manifest.`);
  }
  const backendNodes = backendNodesFromCanonicalWorkflow(graph);
  if (backendNodes.length === 0) {
    throw new Error(`${String(manifest?.id ?? 'Canonical workflow')} has no executable backend nodes.`);
  }
  return {
    graphHash: `sha256:workflow-graph-v1:${actualGraphHash}`,
    backendNodes,
  };
}

export function findCanonicalWorkflowRecord(workflows, template) {
  return (
    workflows.find((workflow) => workflow.manifest.sourceTemplateId === template.id) ??
    workflows.find(
      (workflow) =>
        workflow.manifest.id === `${template.modelType}:${template.mode}` &&
        workflow.manifest.modelType === template.modelType &&
        workflow.manifest.mode === template.mode,
    ) ??
    null
  );
}

function sameNodeContract(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort())
  );
}

export function assessHistoricalEvidence(candidate, canonicalWorkflow, backendRegistry, expected = {}) {
  if (!candidate) return { matches: false, status: 'missing', reasons: ['successful_real_run_receipt'] };
  if (!canonicalWorkflow) {
    return { matches: false, status: 'no_canonical_workflow', reasons: ['canonical_workflow'] };
  }
  const reasons = [];
  if (expected.catalogTemplateLockHash && candidate.catalogTemplateLockHash !== expected.catalogTemplateLockHash) {
    reasons.push('catalog_template_lock_mismatch');
  }
  if (expected.promptSettingsHash && candidate.promptSettingsHash !== expected.promptSettingsHash) {
    reasons.push('prompt_settings_hash_mismatch');
  }
  if (candidate.canonicalWorkflowHash) {
    if (candidate.canonicalWorkflowHash !== canonicalWorkflow.graphHash) {
      reasons.push('canonical_workflow_hash_mismatch');
    }
  }
  if (!sameNodeContract(candidate.backendNodes, canonicalWorkflow.backendNodes)) {
    reasons.push('canonical_workflow_node_contract_mismatch');
  }
  const missingBackendNodes = Array.isArray(candidate.backendNodes)
    ? [...new Set(candidate.backendNodes)].filter((nodeKey) => !backendRegistry.has(nodeKey)).sort()
    : [];
  if (missingBackendNodes.length > 0) reasons.push('historical_backend_nodes_missing');
  return {
    matches: reasons.length === 0,
    status:
      reasons.length === 0 ? (candidate.canonicalWorkflowHash ? 'current' : 'legacy_node_contract_match') : 'stale',
    reasons,
    missingBackendNodes,
  };
}

const same = (actual, expected, label) => assert.equal(stableStringify(actual), stableStringify(expected), label);
const immutableRevision = (value) => typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value);

export { canonicalAccountingExecutionPlan } from './live-proof-provenance.mjs';

// This describes a real non-public authoring record. It is never a Studio
// template, a model entitlement, or permission to change canonical defaults.
export function canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact = null) {
  const canonical = canonicalWorkflowContract(manifest, graph);
  assert.ok(
    manifest.sourceTemplateId?.startsWith('task-template:'),
    'Only standalone canonical workflows use this recorder.',
  );
  assert.ok(authoring && authoring.canonicalWorkflowId === manifest.id, 'Exact canonical authoring record is missing.');
  assert.equal(authoring.modelType, manifest.modelType, 'Authoring model identity differs.');
  assert.equal(authoring.mode, manifest.mode, 'Authoring task differs.');
  assert.equal(authoring.canonicalGraph?.path, manifest.graphPath, 'Authoring graph path differs.');
  assert.equal(authoring.canonicalGraph?.sha256, manifest.graphHash, 'Authoring graph hash is stale.');
  assert.equal(authoring.defaultsPlan?.sourceGraphSha256, manifest.graphHash, 'Authoring defaults are stale.');
  assert.ok(typeof authoring.id === 'string' && authoring.id.length > 0, 'Authoring identity is missing.');
  const required = [...new Set(manifest.requiredArtifacts ?? [])].sort();
  assert.ok(
    required.length && required.every((repo) => typeof repo === 'string' && !repo.startsWith('builtin:')),
    'Deterministic builtin qualification is unsupported; model identity is not applicable.',
  );
  same(
    [...new Set(authoring.artifactPlan?.requiredArtifacts ?? [])].sort(),
    required,
    'Authoring artifact set differs.',
  );
  const pins = new Map(required.map((repo) => [repo, new Set()]));
  const add = (repo, revision) => {
    assert.ok(pins.has(repo), `Undeclared model component: ${String(repo)}`);
    if (revision !== undefined && revision !== null && revision !== '') {
      assert.ok(immutableRevision(revision), `Unresolved immutable model pin: ${repo}`);
      pins.get(repo).add(revision);
    }
  };
  for (const component of authoring.artifactPlan?.componentRequirements ?? []) add(component.repo, component.revision);
  if (artifact?.baseRepo && pins.has(artifact.baseRepo)) add(artifact.baseRepo, artifact.baseRevision);
  for (const node of graph.nodes ?? []) {
    const params = node.data?.params ?? {};
    for (const [key, parameter] of Object.entries(params)) {
      const value = parameter?.value ?? parameter?.default;
      if (value?.source !== 'hub') continue;
      const repo = value.value;
      const revisionKey = ['model', 'model_id', 'repo_id'].includes(key)
        ? 'revision'
        : `${key.replace(/_(?:id|path)$/, '')}_revision`;
      add(repo, value.revision ?? params[revisionKey]?.value ?? params[revisionKey]?.default);
    }
  }
  const modelSet = required.map((repoId) => {
    const revisions = [...pins.get(repoId)];
    assert.equal(revisions.length, 1, `Missing or ambiguous immutable model pin: ${repoId}`);
    return { repoId, revision: revisions[0] };
  });
  return {
    workflowId: manifest.id,
    sourceTemplateId: manifest.sourceTemplateId,
    authoringId: authoring.id,
    authoringHash: sha256Value('canonical-workflow-authoring-v1', authoring),
    canonicalWorkflowHash: canonical.graphHash,
    modelType: manifest.modelType,
    task: manifest.mode,
    modelSet,
    outputPlan: authoring.outputPlan,
  };
}

// Pure shared validation used both when retaining a receipt and when projecting
// release evidence. expectedApiGraph must come from the normal frontend exporter
// over the current canonical source, never from the supplied evidence bundle.
export function validateCanonicalWorkflowEvidence({
  target,
  expectedApiGraph,
  creator,
  outputPackage,
  run,
  provenance,
  graphCompleted,
}) {
  assert.equal(provenance?.format, 'modiff.live-proof.provenance.v2');
  assert.deepEqual(validateRunProvenance(provenance), [], 'Shared provenance validation failed.');
  assert.deepEqual(provenance.blockers ?? [], [], 'Provenance retains blockers.');
  assert.equal(creator?.manifest?.packageType, 'modiff-workflow-share', 'Original creator export is required.');
  assert.equal(outputPackage?.manifest?.packageType, 'modiff-output-package', 'Original output export is required.');
  const output = outputPackage.latestOutput;
  const task = run?.task;
  assert.ok(output && typeof output.id === 'string' && output.id.length > 0, 'Actual output is missing.');
  assert.equal(task?.status, 'completed', 'Task is not completed.');
  assert.equal(task.task_id, output.taskId, 'Output belongs to another task.');
  assert.equal(task.task_id, provenance.taskId, 'Provenance belongs to another task.');
  assert.equal(task.attempt_index, 0, 'Retry/fallback canonical qualification is unsupported.');
  assert.equal(output.attemptIndex, 0);
  assert.equal(output.resolvedExecutionInputs?.taskId, task.task_id, 'Actual consumed-input receipt is missing.');
  assert.equal(output.resolvedExecutionInputs?.attemptIndex, 0);
  assert.ok(typeof output.workflowTabId === 'string' && output.workflowTabId.length > 0);
  assert.equal(run.workflow_id, output.workflowTabId, 'Output belongs to another workflow.');
  const persisted = (run.outputs ?? []).filter((item) => item.id === output.id && item.taskId === task.task_id);
  assert.equal(persisted.length, 1, 'Output is not uniquely present in the raw task.');
  for (const field of [
    'taskId',
    'clientRunId',
    'runInputHash',
    'workflowTabId',
    'attemptIndex',
    'nodeId',
    'fieldKey',
    'formSnapshot',
    'graphSnapshot',
    'apiGraphSnapshot',
    'resolvedExecutionInputs',
    'mediaHash',
    'mediaItems',
  ]) {
    assert.notEqual(output[field], undefined, `Actual output is missing ${field}.`);
    same(output[field], persisted[0][field], `Raw task/output ${field} differs.`);
  }
  same(creator.metadata?.studio, output.formSnapshot, 'Creator settings changed before execution.');
  assert.equal(
    output.formSnapshot.modelType,
    target.modelType,
    'Actual model/task form differs from canonical source.',
  );
  assert.equal(output.formSnapshot.mode, target.task, 'Actual model/task form differs from canonical source.');
  same(outputPackage.apiGraph, output.apiGraphSnapshot, 'Output package graph differs from submitted graph.');
  const expected = canonicalGraphIdentity(expectedApiGraph);
  same(
    canonicalGraphIdentity(creator.apiGraph),
    expected,
    'Creator graph/defaults/bindings differ from canonical source.',
  );
  same(canonicalGraphIdentity(output.apiGraphSnapshot), expected, 'Submitted graph differs from canonical source.');
  same(provenance.graph?.canonicalGraph, expected.canonicalGraph, 'Provenance graph differs from canonical execution.');
  const consumed = output.resolvedExecutionInputs;
  assert.equal(consumed.source, 'backend-execution', 'Consumed inputs do not have backend authority.');
  assert.equal(consumed.truncated, false, 'Consumed inputs are truncated.');
  assert.deepEqual(consumed.uncapturedNodeIds, [], 'Consumed node evidence is incomplete.');
  assert.ok(Array.isArray(consumed.nodes) && consumed.nodes.length > 0, 'Consumed node evidence is missing.');
  assert.equal(
    new Set(consumed.nodes.map((row) => row.nodeId)).size,
    consumed.nodes.length,
    'Consumed node identities are ambiguous.',
  );
  same(
    consumed.nodes.map((row) => row.nodeId).sort(),
    Object.keys(output.apiGraphSnapshot.nodes).sort(),
    'Consumed graph scope differs.',
  );
  const hasAccounting =
    consumed.fieldAccountingStatus !== undefined || consumed.nodes.some((row) => row.fieldAccounting !== undefined);
  if (hasAccounting) assertCanonicalDdimGraphEnvelope(creator.apiGraph);
  const plan = hasAccounting
    ? canonicalAccountingExecutionPlan({
        expectedApiGraph,
        apiGraph: output.apiGraphSnapshot,
        consumed,
        target,
        runtimeEvidence: { run, output, graphCompleted },
      })
    : executionPlanIdentity(output.apiGraphSnapshot);
  if (hasAccounting) {
    assert.equal(consumed.nodeId, output.nodeId, 'Canonical consumed receipt output owner differs.');
    assert.ok(
      !task.runtimeHints || Object.keys(task.runtimeHints).length === 0,
      'Canonical task contains unreviewed runtime hints.',
    );
  }
  if (!hasAccounting) {
    for (const row of consumed.nodes) {
      const submitted = output.apiGraphSnapshot.nodes[row.nodeId];
      assert.equal(row.module, submitted.module, 'Consumed node module differs.');
      assert.equal(row.action, submitted.action, 'Consumed node action differs.');
      assert.deepEqual(row.omittedFields ?? {}, {}, 'Consumed fields were omitted; exact execution cannot be proved.');
      for (const [field, parameter] of Object.entries(submitted.params ?? {})) {
        if (Object.hasOwn(parameter, 'value') && !parameter.sourceId) {
          assert.ok(Object.hasOwn(row.fields ?? {}, field), `Consumed literal is missing: ${row.nodeId}.${field}`);
        }
      }
      for (const [field, captured] of Object.entries(row.fields ?? {})) {
        const parameter = submitted.params?.[field];
        // Connected runtime objects are authenticated by the exact submitted
        // topology. Scalar connected/override values need a further native
        // producer join; never silently treat them as an unchanged literal.
        assert.equal(captured.source, 'literal', 'Connected or overridden consumed scalar is unsupported.');
        if (!parameter && field === 'executed_task') {
          assert.equal(captured.value, target.task, 'Actual executed task differs from canonical task.');
          continue;
        }
        assert.ok(
          parameter && Object.hasOwn(parameter, 'value') && !parameter.sourceId,
          'Consumed literal binding differs.',
        );
        let expectedValue = parameter.value;
        if (expectedValue?.source === 'hub') expectedValue = expectedValue.value;
        // The existing seed receipt contract serializes integer seeds as decimal
        // strings. This comparison accepts only the exact integer spelling.
        if (field === 'seed' && Number.isSafeInteger(expectedValue) && typeof captured.value === 'string')
          expectedValue = String(expectedValue);
        same(captured.value, expectedValue, `Consumed field differs: ${row.nodeId}.${field}`);
      }
    }
  }
  assert.equal(provenance.graphHash, expected.hash);

  const auto = plan.plan.resourceMode === 'auto' || plan.plan.resolvedResourceMode === 'auto';
  if (auto) {
    assert.ok(
      typeof plan.plan.autoResourceCandidateId === 'string' && plan.plan.autoResourceCandidateId.trim().length > 0,
      'Auto resource candidate is missing from the declared execution plan.',
    );
    assert.equal(
      task.resourceCandidateId,
      plan.plan.autoResourceCandidateId,
      'Native Auto resource candidate differs from the declared execution plan.',
    );
  } else {
    assert.ok(plan.plan.autoResourceCandidateId == null, 'Non-Auto graph retains an Auto resource candidate.');
    assert.ok(task.resourceCandidateId == null, 'Non-Auto task retains an Auto resource candidate.');
  }
  assert.equal(plan.plan.modelType, target.modelType, 'Resource recipe model differs from canonical source.');
  if (!hasAccounting) {
    for (const [planned, consumedField] of Object.entries({
      dtype: 'dtype',
      offloadMode: 'offload_mode',
      autoOffload: 'auto_offload',
      device: 'device',
      weightFormat: 'weight_format',
      weightLoadingMode: 'weight_loading_mode',
    })) {
      if (!Object.hasOwn(plan.plan, planned)) continue;
      const values = consumed.nodes.flatMap((row) =>
        Object.hasOwn(row.fields ?? {}, consumedField) ? [row.fields[consumedField].value] : [],
      );
      assert.ok(
        values.length > 0 && values.every((value) => stableStringify(value) === stableStringify(plan.plan[planned])),
        `Resource recipe lacks matching consumed ${consumedField}.`,
      );
    }
  }
  same(provenance.graph?.executionPlan, plan.plan, 'Resource recipe differs from executed graph.');
  assert.equal(provenance.graph?.executionPlanHash, plan.hash);
  assert.equal(provenance.template?.id, target.authoringId, 'Provenance lacks the real canonical authoring identity.');
  assert.equal(provenance.template?.catalogTemplateLockHash, target.authoringHash, 'Canonical authoring lock differs.');
  assert.equal(
    provenance.template?.resolvedTemplateLockHash,
    sha256Value('canonical-workflow-execution-v1', { authoringHash: target.authoringHash, graphHash: expected.hash }),
    'Canonical execution lock differs.',
  );
  assert.equal(
    provenance.template?.promptSettingsHash,
    sha256Value('canonical-workflow-settings-v1', creator.metadata.studio),
    'Canonical settings lock differs.',
  );
  const actualModels = provenance.models.items
    .map((item) => {
      assert.ok(immutableRevision(item.selectedRevision), 'Executed model revision is not immutable.');
      assert.equal(item.modelRevision, `${item.repoId}@${item.selectedRevision}`);
      return { repoId: item.repoId, revision: item.selectedRevision };
    })
    .sort((a, b) => a.repoId.localeCompare(b.repoId));
  same(actualModels, target.modelSet, 'Complete executed model set differs from canonical declarations.');
  const executedPins = new Map();
  for (const node of Object.values(output.apiGraphSnapshot.nodes ?? {})) {
    for (const [key, parameter] of Object.entries(node.params ?? {})) {
      const value = parameter?.value;
      if (value?.source !== 'hub') continue;
      const revisionKey = ['model', 'model_id', 'repo_id'].includes(key)
        ? 'revision'
        : `${key.replace(/_(?:id|path)$/, '')}_revision`;
      const revision = value.revision ?? node.params[revisionKey]?.value;
      assert.ok(immutableRevision(revision), `Executed component pin is unresolved: ${value.value}`);
      if (executedPins.has(value.value))
        assert.equal(executedPins.get(value.value), revision, 'Ambiguous executed component.');
      executedPins.set(value.value, revision);
    }
  }
  same(
    [...executedPins]
      .map(([repoId, revision]) => ({ repoId, revision }))
      .sort((a, b) => a.repoId.localeCompare(b.repoId)),
    target.modelSet,
    'The complete model set is not proved by explicit executed loader fields.',
  );
  assert.ok(
    selectBackendRuntimeFingerprintEvidence([task.runtimeFingerprint], output.apiGraphSnapshot.deterministicMode),
    'Complete structured actual runtime is required.',
  );
  assert.equal(
    normalizeBackendRuntime(task.runtimeFingerprint, output.apiGraphSnapshot.deterministicMode).lockFingerprint,
    provenance.runtimeFingerprint,
    'Actual runtime differs from provenance.',
  );
  same(
    task.runtimeFingerprint.backendSource,
    provenance.runtime.backendSourceAttestation,
    'Process-start source authority differs.',
  );
  const actualExecution = executionReceiptIdentity(
    { runtimeMeasurement: task.runtimeMeasurement, runtimeHints: task.runtimeHints },
    plan.plan,
  );
  same(actualExecution, provenance.execution, 'Actual resource measurements differ.');
  assert.ok(
    Number.isFinite(task.started_at) && Number.isFinite(task.completed_at) && task.completed_at >= task.started_at,
  );
  assert.equal(provenance.capturedAt, new Date(task.completed_at * 1000).toISOString(), 'Completion time differs.');
  assert.ok(provenance.output.items.length >= target.outputPlan.minimumAssetCount, 'Output collection is incomplete.');
  assert.ok(
    provenance.output.items.every((item) => target.outputPlan.mediaKinds.includes(item.mediaType)),
    'Output modality differs.',
  );
  return {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-run-receipt.v1',
    proofKind: 'real_backend_weights',
    ...target,
    taskId: task.task_id,
    outputId: output.id,
    capturedAt: provenance.capturedAt,
    graphHash: expected.hash,
    modelSetHash: provenance.models.hash,
    runtimeFingerprint: provenance.runtimeFingerprint,
    resourceCandidateId: provenance.execution.resourceCandidateId,
    backendSourceFingerprint: provenance.backendSourceFingerprint,
    backendContractFingerprint: provenance.backendContractFingerprint,
    outputHash: provenance.output.collectionHash,
    executionDurationSeconds: provenance.execution.elapsedSeconds,
    peakMemoryBytes: provenance.execution.peakMemoryBytes,
    qualificationClaims: {
      publicTemplate: false,
      qualityApproved: false,
      rightsApproved: false,
      hardwareQualified: false,
    },
  };
}

export function readCanonicalEvidenceFile(root, ref, maximum = 32 * 1024 * 1024) {
  assert.ok(
    ref && typeof ref.path === 'string' && !isAbsolute(ref.path) && !/[\\:]/.test(ref.path),
    'Evidence path must be relative and canonical.',
  );
  assert.ok(
    ref.path.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Evidence path is not canonical.',
  );
  assert.match(ref.sha256 ?? '', /^[a-f0-9]{64}$/);
  const base = realpathSync(root);
  let file = base;
  for (const part of ref.path.split('/')) {
    file = join(file, part);
    assert.ok(!lstatSync(file).isSymbolicLink(), 'Evidence symlinks are not permitted.');
  }
  assert.ok(realpathSync(file).startsWith(`${base}${sep}`), 'Evidence escapes its retained root.');
  const stat = lstatSync(file);
  assert.ok(
    stat.isFile() && stat.size > 0 && stat.size <= maximum && stat.size === ref.bytes,
    'Evidence file size/type differs.',
  );
  const bytes = readFileSync(file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), ref.sha256, 'Evidence file hash differs.');
  return { file, bytes };
}

export function canonicalEvidenceWritePath(root, relativePath) {
  assert.ok(
    typeof relativePath === 'string' && !isAbsolute(relativePath) && !/[\\:]/.test(relativePath),
    'Retention path must be relative and canonical.',
  );
  assert.ok(
    relativePath.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Retention path is not canonical.',
  );
  const base = realpathSync(root);
  let target = base;
  for (const part of relativePath.split('/')) {
    target = join(target, part);
    let stat;
    try {
      stat = lstatSync(target);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    assert.ok(!stat.isSymbolicLink(), 'Retention symlinks are not permitted.');
    assert.ok(realpathSync(target).startsWith(`${base}${sep}`), 'Retention path escapes its backend root.');
  }
  return target;
}

// Metadata-only export through the exact frontend implementation used by Run.
// Ephemeral storage and a rejecting fetch prevent inspection from using a live app.
export async function exportCanonicalWorkflowGraphs(clientRoot, graphs) {
  const { createServer } = await import('vite');
  const prior = new Map(
    ['window', 'localStorage', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    location: { origin: 'http://127.0.0.1' },
    localStorage: globalThis.localStorage,
    dispatchEvent: () => true,
  };
  globalThis.fetch = () => {
    throw new Error('Canonical qualification export cannot access the network.');
  };
  let server;
  try {
    server = await createServer({
      root: clientRoot,
      configFile: false,
      logLevel: 'silent',
      optimizeDeps: { entries: [], noDiscovery: true },
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: 'custom',
    });
    const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
    return graphs.map((graph) =>
      useFlowStore.getState().exportGraph('canonical-qualification', undefined, {
        sourceGraph: structuredClone(graph),
        randomizeSeeds: false,
      }),
    );
  } finally {
    await server?.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

// The same derivation is repeated by release-contract; a registry row alone
// never authenticates a run. All file references are to retained original bytes.
export async function readCanonicalWorkflowEvidence({ clientRoot, backendRoot, workflowId, evidencePath }) {
  const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
  const manifestRows = json(join(backendRoot, 'data/workflow-library-manifest.json')).workflows;
  const matches = manifestRows.filter((row) => row.id === workflowId);
  assert.equal(matches.length, 1, 'Canonical workflow ID is missing or ambiguous.');
  const manifest = matches[0];
  assert.ok(
    typeof manifest.graphPath === 'string' &&
      !isAbsolute(manifest.graphPath) &&
      manifest.graphPath.split(/[\\/]/).every((part) => part && part !== '..' && part !== '.'),
    'Canonical graph path is unsafe.',
  );
  const graphRoot = realpathSync(join(backendRoot, 'data/graphs'));
  const graphPath = realpathSync(join(graphRoot, manifest.graphPath));
  assert.ok(graphPath.startsWith(`${graphRoot}${sep}`), 'Canonical graph escapes its source root.');
  const graph = json(graphPath);
  const authoringRows = json(join(backendRoot, 'data/template-authoring-specs.v1.json')).specifications;
  const authoringMatches = authoringRows.filter((row) => row.canonicalWorkflowId === workflowId);
  assert.equal(authoringMatches.length, 1, 'Canonical source authoring identity is missing or ambiguous.');
  const artifact = json(join(backendRoot, 'data/model-artifact-catalog.json')).models.find(
    (row) => row.modelType === manifest.modelType,
  );
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoringMatches[0], artifact);
  assert.ok(
    graph.nodes.every((node) =>
      Object.values(node.data?.params ?? {}).every((field) => field?.display !== 'filebrowser'),
    ),
    'Input-backed canonical qualification is unsupported until native execution-bound input-byte evidence is available.',
  );
  const evidenceStat = lstatSync(evidencePath);
  assert.ok(
    evidenceStat.isFile() && !evidenceStat.isSymbolicLink() && evidenceStat.size <= 65536,
    'Evidence descriptor must be a bounded regular file.',
  );
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes.toString('utf8'));
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.format, 'modiff.canonical-workflow-evidence.v1');
  assert.equal(evidence.workflowId, workflowId);
  const root = realpathSync(dirname(evidencePath));
  const retainedFiles = [];
  const read = (ref, maximum) => {
    const result = readCanonicalEvidenceFile(root, ref, maximum);
    retainedFiles.push({ ...ref, absolutePath: result.file });
    return result;
  };
  const readJson = (ref) => JSON.parse(read(ref).bytes.toString('utf8'));
  const creator = readJson(evidence.creatorPackage);
  const outputPackage = readJson(evidence.outputPackage);
  const run = readJson(evidence.runDetail);
  // Optional for legacy unhinted evidence; hinted DDIM accounting requires this
  // original native frame. read() retains and rechecks its original bytes/hash.
  const graphCompleted =
    evidence.graphCompleted === undefined
      ? undefined
      : JSON.parse(read(evidence.graphCompleted, 16 * 1024 * 1024).bytes.toString('utf8'));
  const output = outputPackage.latestOutput;
  assert.ok(
    output?.apiGraphSnapshot && output?.graphSnapshot && creator.graph && creator.apiGraph,
    'Original graph exports are missing.',
  );
  const [expectedApiGraph, creatorApiGraph, outputApiGraph] = await exportCanonicalWorkflowGraphs(clientRoot, [
    graph,
    creator.graph,
    output.graphSnapshot,
  ]);
  same(
    canonicalGraphIdentity(creatorApiGraph),
    canonicalGraphIdentity(creator.apiGraph),
    'Creator visual/API export differs.',
  );
  same(
    canonicalGraphIdentity(outputApiGraph),
    canonicalGraphIdentity(output.apiGraphSnapshot),
    'Output visual/API export differs.',
  );
  const nodesPayload = readJson(evidence.nodes);
  const contracts = nodesPayload.nodes ?? nodesPayload;
  for (const node of Object.values(output.apiGraphSnapshot.nodes)) {
    const key = `${node.module}.${node.action}`;
    assert.ok(
      contracts[key]?.params && typeof contracts[key].params === 'object',
      `Actual backend contract is missing: ${key}`,
    );
    assert.ok(
      Object.values(contracts[key].params).every((field) => field?.display !== 'filebrowser'),
      'Input-backed canonical qualification is unsupported until native execution-bound input-byte evidence is available.',
    );
  }
  const sourceBefore = readJson(evidence.backendSourceBefore);
  const sourceAfter = readJson(evidence.backendSourceAfter);
  const source = backendSourceEvidence({
    before: sourceBefore.identity,
    after: sourceAfter.identity,
    runtimeFingerprint: run.task?.runtimeFingerprint,
  });
  assert.deepEqual(source.blockers, [], 'Source changed or does not match the running worker.');
  assert.ok(
    Array.isArray(evidence.modelObservations) && evidence.modelObservations.length > 0,
    'Actual model observations are required.',
  );
  const payloads = evidence.modelObservations.map(readJson);
  assert.ok(
    payloads.every((value) => value.error === false && Array.isArray(value.models)),
    'Model observation is incomplete.',
  );
  const modelPayload = { models: payloads.flatMap((value) => value.models) };
  const modelIdentities = target.modelSet.map(({ repoId, revision }) => {
    assert.equal(
      modelPayload.models.filter((row) => row.installed && row.repoId === repoId).length,
      1,
      'Installed model identity is missing or ambiguous.',
    );
    const identity = selectInstalledModelIdentity(modelPayload, repoId);
    assert.equal(identity?.selectedRevision, revision, 'Observed model revision differs.');
    assert.equal(identity?.modelRevision, `${repoId}@${revision}`);
    return identity;
  });
  assert.ok(Array.isArray(evidence.inputs), 'Explicit input evidence array is required.');
  const inputPaths = new Set();
  const visit = (value) => {
    if (typeof value === 'string' && value.startsWith('@data/')) inputPaths.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  for (const node of Object.values(output.apiGraphSnapshot.nodes)) {
    for (const parameter of Object.values(node.params ?? {})) visit(parameter?.value);
  }
  same(
    evidence.inputs.map((row) => row.sourceValue).sort(),
    [...inputPaths].sort(),
    'Complete exact input file bindings are required.',
  );
  assert.equal(
    inputPaths.size,
    0,
    'Input-backed canonical qualification is unsupported until native execution-bound input-byte evidence is available.',
  );
  const inputArtifacts = [];
  const { decodedMediaHash } = await import('./template-gallery-harness.mjs');
  assert.ok(Array.isArray(evidence.outputs) && evidence.outputs.length > 0, 'Physical output evidence is required.');
  assert.equal(evidence.outputs.length, output.mediaItems?.length, 'Complete durable output collection is required.');
  const analyses = [];
  for (const [index, row] of evidence.outputs.entries()) {
    const item = output.mediaItems[index];
    assert.equal(row.backendPath, item.backendPath, 'Durable output order/path differs.');
    const { file, bytes } = read(row.file, 512 * 1024 * 1024);
    assert.equal(item.mediaHash, `sha256:bytes:${row.file.sha256}`, 'Durable output bytes differ.');
    assert.equal(item.byteSize, bytes.length);
    assert.ok(target.outputPlan.mediaKinds.includes(row.mediaType), 'Output modality is not declared.');
    const decoded = await decodedMediaHash(file, row.mediaType);
    analyses.push({
      ...decoded,
      mediaType: row.mediaType,
      byteSize: bytes.length,
      encodedSha256: `sha256:${row.file.sha256}`,
      decodedSha256: decoded.hash,
    });
  }
  const graphIdentity = canonicalGraphIdentity(expectedApiGraph);
  const provenance = createRunProvenance({
    templateId: target.authoringId,
    lockedSettings: creator.metadata?.studio,
    promptSettingsHash: sha256Value('canonical-workflow-settings-v1', creator.metadata?.studio),
    catalogTemplateLockHash: target.authoringHash,
    resolvedTemplateLockHash: sha256Value('canonical-workflow-execution-v1', {
      authoringHash: target.authoringHash,
      graphHash: graphIdentity.hash,
    }),
    apiGraph: output.apiGraphSnapshot,
    nodesPayload,
    modelIdentities,
    inputArtifacts,
    runtimeFingerprint: run.task?.runtimeFingerprint,
    deterministicMode: output.apiGraphSnapshot.deterministicMode,
    backendSource: source.identity,
    outputAnalysis: { analyses },
    executedOutput: output,
    executionReceipt: run.task,
    taskId: run.task?.task_id,
    ...(output.resolvedExecutionInputs?.fieldAccountingStatus !== undefined ||
    output.resolvedExecutionInputs?.nodes?.some((row) => row.fieldAccounting !== undefined)
      ? {
          canonicalAccountingProof: {
            expectedApiGraph,
            target,
            run,
            ...(graphCompleted === undefined ? {} : { graphCompleted }),
          },
        }
      : {}),
    capturedAt: new Date(run.task?.completed_at * 1000).toISOString(),
  });
  const receipt = validateCanonicalWorkflowEvidence({
    target,
    expectedApiGraph,
    creator,
    outputPackage,
    run,
    provenance,
    graphCompleted,
  });
  // Recheck before any caller writes. All generated metadata remains separate
  // from the untouched exported packages and the raw task/observation bodies.
  for (const ref of retainedFiles) readCanonicalEvidenceFile(root, ref, 512 * 1024 * 1024);
  same(
    readFileSync(evidencePath).toString('base64'),
    descriptorBytes.toString('base64'),
    'Evidence descriptor changed during validation.',
  );
  return { receipt, provenance, evidence, descriptorBytes, retainedFiles, evidenceRoot: root };
}
