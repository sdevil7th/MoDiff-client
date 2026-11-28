// Closed deterministic proof path for the three input-free data workflows.
// This shares the existing canonical recorder, queue and file boundaries. It
// does not admit models, file inputs, runtime hints or inferred field accounting.
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import {
  canonicalWorkflowContract,
  exportCanonicalWorkflowGraphs,
  readCanonicalEvidenceFile,
} from './release-contract-core.mjs';
import {
  backendSourceEvidence,
  canonicalGraphIdentity,
  normalizeBackendRuntime,
  sha256Value,
  selectBackendRuntimeFingerprintEvidence,
  stableStringify,
} from './live-proof-provenance.mjs';
import { createHash } from 'node:crypto';

const same = (a, b, message) => assert.equal(stableStringify(a), stableStringify(b), message);
const MODES = new Set(['data_conversion', 'graph_utility', 'text_select']);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function builtinDataQualificationTarget(manifest, graph, authoring) {
  const canonical = canonicalWorkflowContract(manifest, graph);
  assert.equal(manifest.modelType, 'BuiltinDataOperation');
  assert.ok(MODES.has(manifest.mode), 'Unsupported deterministic task.');
  assert.equal(manifest.id, `BuiltinDataOperation:${manifest.mode}`);
  assert.ok(manifest.sourceTemplateId?.startsWith('task-template:'));
  same(manifest.requiredArtifacts, ['builtin://modiff/data-operations/v1'], 'Builtin artifact identity differs.');
  assert.equal(authoring.canonicalWorkflowId, manifest.id);
  assert.equal(authoring.modelType, manifest.modelType);
  assert.equal(authoring.mode, manifest.mode);
  assert.equal(authoring.id, `template-authoring:${manifest.id}`);
  same(authoring.canonicalGraph, { path: manifest.graphPath, sha256: manifest.graphHash });
  assert.equal(authoring.defaultsPlan.sourceGraphSha256, manifest.graphHash);
  same(authoring.artifactPlan.requiredArtifacts, manifest.requiredArtifacts);
  same(authoring.artifactPlan.componentRequirements, []);
  same(authoring.inputPlan.items, [], 'File-backed utility evidence is unsupported.');
  assert.equal(authoring.outputPlan.minimumAssetCount, 1);
  same(authoring.outputPlan.mediaKinds, ['json']);
  const source = authoring.promptPlan.prompt;
  assert.ok(typeof source === 'string' && source.length && Buffer.byteLength(source) <= 16384);
  const boundGraph = structuredClone(graph);
  const actions = new Map();
  for (const node of boundGraph.nodes) {
    const identity = `${node.data.module}.${node.data.action}`;
    assert.ok(
      ['modules.Text.ProcessText', 'modules.Primitive.DataViewer', 'modules.Primitive.ExportData'].includes(identity),
      'Undeclared executable node in deterministic workflow.',
    );
    assert.ok(!actions.has(node.data.action), 'Repeated deterministic node.');
    actions.set(node.data.action, node.id);
    assert.ok(
      Object.values(node.data.params).every((p) => p.display !== 'filebrowser'),
      'File-backed utility evidence is unsupported.',
    );
  }
  assert.equal(boundGraph.nodes.length, 3);
  const processor = boundGraph.nodes.find((node) => node.id === actions.get('ProcessText'));
  assert.equal(processor.data.params.source.value, '', 'Canonical source must remain an unbound input.');
  // Only the source input is supplied from the versioned authoring brief. No
  // selector, export control, topology or canonical source file is rewritten.
  processor.data.params.source.value = source;
  return {
    workflowId: manifest.id,
    sourceTemplateId: manifest.sourceTemplateId,
    authoringId: authoring.id,
    authoringHash: sha256Value('canonical-workflow-authoring-v1', authoring),
    canonicalWorkflowHash: canonical.graphHash,
    modelType: manifest.modelType,
    task: manifest.mode,
    boundGraph,
    roles: Object.fromEntries(actions),
    inputBinding: { nodeId: processor.id, field: 'source', source: 'authoring.promptPlan.prompt', value: source },
  };
}

export function validateBuiltinDataExecution({
  target,
  expectedApiGraph,
  submittedApiGraph,
  acceptedGraph,
  run,
  messages,
  sourceBefore,
  sourceAfter,
  sourceInventory,
  exportedBytes,
  durableOutputs,
}) {
  for (const api of [expectedApiGraph, submittedApiGraph, acceptedGraph.graph]) {
    same(Object.keys(api).sort(), ['nodes', 'paths', 'sid'], 'Unreviewed graph authority or execution envelope.');
  }
  const identity = canonicalGraphIdentity(expectedApiGraph);
  same(canonicalGraphIdentity(submittedApiGraph), identity, 'Submitted canonical bindings differ.');
  same(acceptedGraph.graph, submittedApiGraph, 'Queue accepted a different graph.');
  const task = run.task;
  assert.equal(task.status, 'completed');
  assert.equal(task.attempt_index, 0, 'Retry/fallback deterministic evidence is unsupported.');
  assert.ok(typeof task.task_id === 'string' && task.task_id.length > 0);
  assert.equal(acceptedGraph.taskId, task.task_id);
  assert.equal(task.sid, submittedApiGraph.sid);
  assert.equal(task.resourceCandidateId, null);
  assert.ok(
    selectBackendRuntimeFingerprintEvidence([task.runtimeFingerprint]),
    'Structured runtime evidence is missing.',
  );
  assert.ok(!task.runtimeHints || Object.keys(task.runtimeHints).length === 0);
  assert.ok(Number.isFinite(task.started_at) && task.completed_at >= task.started_at);
  const measurement = task.runtimeMeasurement;
  assert.equal(measurement.backend, 'cpu');
  assert.equal(measurement.device, 'cpu:0');
  assert.equal(measurement.peakMeasurementVersion, 2);
  assert.ok(Number.isFinite(measurement.elapsedSeconds) && measurement.elapsedSeconds >= 0);
  assert.ok(Number.isSafeInteger(measurement.processRssBytes) && measurement.processRssBytes > 0);
  assert.equal(sourceBefore.identity.fingerprint, sourceInventory.fingerprint);
  assert.equal(sourceAfter.identity.fingerprint, sourceInventory.fingerprint);
  const source = backendSourceEvidence({
    before: sourceInventory,
    after: sourceInventory,
    runtimeFingerprint: task.runtimeFingerprint,
  });
  same(source.blockers, [], 'Source inventory does not match the executing process.');
  // Before/after bodies are original observations; the separately retained full
  // inventory is recovered by its exact native fingerprint, not relabelled as a
  // pre-run file listing.
  for (const observation of [sourceBefore.identity, sourceAfter.identity]) {
    assert.equal(observation.schemaVersion, 1);
    assert.equal(observation.claim, 'process_start_backend_source_identity');
    assert.equal(observation.gitCommit, source.attestation.gitCommit);
    assert.equal(observation.fileCount, source.attestation.fileCount);
  }
  assert.ok(Date.parse(sourceBefore.identity.capturedAt) <= task.started_at * 1000);
  assert.ok(Date.parse(sourceAfter.identity.capturedAt) >= task.completed_at * 1000);
  assert.ok(Array.isArray(messages) && messages.length > 0 && messages.length <= 512);
  assert.ok(
    messages.every((frame) => frame.task_id === task.task_id),
    'Unrelated task frame.',
  );
  assert.ok(!messages.some((frame) => ['task_failed', 'resource_retry'].includes(frame.type)));
  const completed = messages.filter((frame) => frame.type === 'graph_completed');
  assert.equal(completed.length, 1);
  same(completed[0].runtimeFingerprint, task.runtimeFingerprint);
  same(completed[0].runtimeMeasurement, measurement);
  assert.ok(completed[0].runtimeHints == null, 'Runtime hints are unsupported.');
  same(completed[0].resourceRetryHistory, []);
  const executed = messages.filter((frame) => frame.type === 'executed');
  same(executed.map((frame) => frame.node).sort(), Object.keys(expectedApiGraph.nodes).sort());
  for (const frame of executed) {
    assert.equal(frame.status, 'succeeded', 'Cached execution is not a fresh deterministic proof.');
    assert.equal(frame.attempt_index, 0);
    const node = expectedApiGraph.nodes[frame.node];
    assert.equal(frame.name, `${node.module}.${node.action}`);
  }
  const p = Object.fromEntries(
    Object.entries(expectedApiGraph.nodes[target.roles.ProcessText].params)
      .filter(([, field]) => Object.hasOwn(field, 'value'))
      .map(([key, field]) => [key, field.value]),
  );
  same(
    p,
    {
      alternate_source: 'No alternate branch was selected.',
      condition: true,
      ignore_empty_lines: false,
      index: 0,
      operation: target.task,
      pipeline_class: 'BuiltinDataOperationV1',
      selection_mode: 'error',
      source: target.inputBinding.value,
      strip_line: true,
      target_type: 'json',
    },
    'Unreviewed deterministic controls.',
  );
  const expected =
    target.task === 'data_conversion'
      ? JSON.parse(p.source)
      : target.task === 'text_select'
        ? p.source.split(/\r?\n/u)[0].trim()
        : p.source;
  same(JSON.parse(exportedBytes.toString('utf8')), expected, 'Exported result differs from independent oracle.');
  const previews = messages.filter((frame) => frame.type === 'update_value');
  same(previews.map((frame) => frame.node).sort(), [target.roles.DataViewer, target.roles.ExportData].sort());
  assert.equal(run.outputs.length, 2);
  assert.equal(durableOutputs.length, 2);
  for (const frame of previews) {
    assert.equal(frame.attempt_index, 0);
    assert.equal(frame.key, 'preview');
    assert.equal(frame.backend_persisted, true);
    assert.equal(frame.runtimeFingerprint, task.runtimeFingerprint.fingerprint);
    assert.equal(frame.value.length, 1);
    const value = frame.value[0];
    if (frame.node === target.roles.ExportData) {
      assert.ok(
        exportedBytes.equals(Buffer.from(`${value}\n`, 'utf8')),
        'Physical export differs from native export preview.',
      );
    }
    same(
      target.task === 'data_conversion' || frame.node === target.roles.ExportData ? JSON.parse(value) : value,
      expected,
      'Delivered preview differs from deterministic result.',
    );
    const outputs = run.outputs.filter((output) => output.id === frame.output_id && output.nodeId === frame.node);
    assert.equal(outputs.length, 1);
    const output = outputs[0];
    assert.equal(output.taskId, task.task_id);
    assert.equal(output.attemptIndex, 0);
    same(output.value, frame.value);
    assert.equal(output.mediaItems.length, 1);
    const item = output.mediaItems[0];
    const retained = durableOutputs.filter((row) => row.nodeId === frame.node);
    assert.equal(retained.length, 1);
    assert.equal(retained[0].backendPath, item.backendPath);
    assert.equal(item.taskId, task.task_id);
    assert.equal(item.attemptIndex, 0);
    assert.equal(item.byteSize, retained[0].bytes.length);
    assert.equal(item.mediaHash, `sha256:bytes:${hash(retained[0].bytes)}`);
    same(JSON.parse(retained[0].bytes.toString('utf8')), frame.value, 'Durable preview bytes differ.');
    const consumed = frame.resolved_execution_inputs;
    assert.equal(consumed.source, 'backend-execution');
    assert.equal(consumed.taskId, task.task_id);
    assert.equal(consumed.attemptIndex, 0);
    assert.equal(consumed.nodeId, frame.node);
    assert.equal(consumed.truncated, false);
    same(consumed.uncapturedNodeIds, []);
    same(output.resolvedExecutionInputs, consumed);
    const ancestorIds = [
      target.roles.ProcessText,
      target.roles.DataViewer,
      ...(frame.node === target.roles.ExportData ? [target.roles.ExportData] : []),
    ].sort();
    same(consumed.nodes.map((row) => row.nodeId).sort(), ancestorIds);
    for (const row of consumed.nodes) {
      const node = expectedApiGraph.nodes[row.nodeId];
      assert.equal(row.module, node.module);
      assert.equal(row.action, node.action);
      same(row.omittedFields, {});
      same(
        row.fields,
        row.nodeId === target.roles.ProcessText
          ? { pipeline_class: { value: 'BuiltinDataOperationV1', source: 'literal' } }
          : {},
      );
    }
  }
  const { boundGraph: _graph, roles: _roles, ...contract } = target;
  return {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-run-receipt.v1',
    proofKind: 'real_backend_deterministic_data',
    ...contract,
    taskId: task.task_id,
    capturedAt: new Date(task.completed_at * 1000).toISOString(),
    graphHash: identity.hash,
    runtimeFingerprint: normalizeBackendRuntime(task.runtimeFingerprint).lockFingerprint,
    backendSourceFingerprint: sourceInventory.fingerprint,
    outputHash: `sha256:bytes:${hash(exportedBytes)}`,
    executionDurationSeconds: measurement.elapsedSeconds,
    peakMemoryBytes: measurement.processRssBytes,
    modelSet: [],
    resourceCandidateId: null,
    deterministicCorrectness: 'verified_exact_result',
    observationLimits: {
      fullConsumedFieldAccounting: false,
      browserInteraction: false,
      sourceInventoryRecoveredByNativeFingerprint: true,
    },
    qualificationClaims: {
      publicTemplate: false,
      qualityApproved: false,
      rightsApproved: false,
      hardwareQualified: false,
      modelResourceQualified: false,
    },
  };
}

export async function readBuiltinDataEvidence({ clientRoot, manifest, graph, authoring, evidencePath }) {
  const target = builtinDataQualificationTarget(manifest, graph, authoring);
  const stat = lstatSync(evidencePath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536);
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes.toString('utf8'));
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.format, 'modiff.canonical-builtin-data-evidence.v1');
  assert.equal(evidence.workflowId, manifest.id);
  same(
    Object.keys(evidence).sort(),
    [
      'schemaVersion',
      'format',
      'workflowId',
      'submittedApiGraph',
      'acceptedGraph',
      'runDetail',
      'messages',
      'sourceBefore',
      'sourceAfter',
      'sourceInventory',
      'exportedData',
      'durableOutputs',
    ].sort(),
    'Unreviewed deterministic evidence fields.',
  );
  assert.ok(Array.isArray(evidence.durableOutputs) && evidence.durableOutputs.length === 2);
  const root = realpathSync(dirname(evidencePath));
  const retainedFiles = [];
  const read = (ref) => {
    const result = readCanonicalEvidenceFile(root, ref, 16 * 1024 * 1024);
    retainedFiles.push({ ...ref, absolutePath: result.file });
    return result.bytes;
  };
  const json = (ref) => JSON.parse(read(ref).toString('utf8'));
  const [expectedApiGraph] = await exportCanonicalWorkflowGraphs(clientRoot, [target.boundGraph]);
  const receipt = validateBuiltinDataExecution({
    target,
    expectedApiGraph,
    submittedApiGraph: json(evidence.submittedApiGraph),
    acceptedGraph: json(evidence.acceptedGraph),
    run: json(evidence.runDetail),
    messages: json(evidence.messages),
    sourceBefore: json(evidence.sourceBefore),
    sourceAfter: json(evidence.sourceAfter),
    sourceInventory: json(evidence.sourceInventory),
    exportedBytes: read(evidence.exportedData),
    durableOutputs: evidence.durableOutputs.map((row) => ({ ...row, bytes: read(row.file) })),
  });
  for (const ref of retainedFiles) readCanonicalEvidenceFile(root, ref, 16 * 1024 * 1024);
  assert.ok(readFileSync(evidencePath).equals(descriptorBytes));
  return {
    receipt,
    provenance: { format: 'modiff.deterministic-data-proof.v1', receipt },
    evidence,
    descriptorBytes,
    retainedFiles,
    evidenceRoot: root,
  };
}
