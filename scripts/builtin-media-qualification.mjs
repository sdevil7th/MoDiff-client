// Deterministic fixture qualification through the existing recorder/executor.
// Original packets and media remain immutable. No model or public asset grant.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'vite';
import {
  canonicalWorkflowContract,
  exportCanonicalWorkflowGraphs,
  readCanonicalEvidenceFile,
} from './release-contract-core.mjs';
import {
  canonicalGraphIdentity,
  backendSourceEvidence,
  normalizeBackendRuntime,
  selectBackendRuntimeFingerprintEvidence,
  sha256Value,
  stableStringify,
} from './live-proof-provenance.mjs';

const same = (a, b, message) => assert.equal(stableStringify(a), stableStringify(b), message);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const TYPES = {
  BuiltinImageOperation: ['ImageOperations', 'ProcessImage', 'Image', 'Preview', 'image-operations'],
  BuiltinAudioOperation: ['Audio', 'ProcessAudio', 'Audio', 'Export', 'audio-operations'],
  BuiltinVideoOperation: ['Video', 'ProcessVideo', null, null, 'video-operations'],
};
let parserPromise;
async function parser(clientRoot) {
  parserPromise ??= (async () => {
    const server = await createServer({
      root: clientRoot,
      configFile: false,
      logLevel: 'silent',
      optimizeDeps: { entries: [], noDiscovery: true },
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: 'custom',
    });
    try {
      return await server.ssrLoadModule('/src/studio/builtinMediaEvidence.ts');
    } finally {
      await server.close();
    }
  })();
  return parserPromise;
}

export function builtinMediaTarget(manifest, graph, authoring, inputs, variant, exercises) {
  const canonical = canonicalWorkflowContract(manifest, graph),
    type = TYPES[manifest.modelType];
  assert.ok(type && Object.hasOwn(exercises, manifest.mode), 'Unsupported media qualification task.');
  assert.equal(manifest.id, `${manifest.modelType}:${manifest.mode}`);
  assert.ok(manifest.sourceTemplateId.startsWith('task-template:'));
  same(manifest.requiredArtifacts, [`builtin://modiff/${type[4]}/v1`]);
  assert.equal(authoring.canonicalWorkflowId, manifest.id);
  assert.equal(authoring.modelType, manifest.modelType);
  assert.equal(authoring.mode, manifest.mode);
  same(authoring.canonicalGraph, { path: manifest.graphPath, sha256: manifest.graphHash });
  assert.equal(authoring.defaultsPlan.sourceGraphSha256, manifest.graphHash);
  same(authoring.artifactPlan.requiredArtifacts, manifest.requiredArtifacts);
  same(authoring.artifactPlan.componentRequirements, []);
  assert.ok(['baseline', 'exercise'].includes(variant));
  const boundGraph = structuredClone(graph),
    primary = boundGraph.nodes.filter((n) => n.data.module === `modules.${type[0]}` && n.data.action === type[1]);
  assert.equal(primary.length, 1);
  assert.ok(Array.isArray(inputs) && inputs.length > 0 && inputs.length <= 3);
  const fileFields = boundGraph.nodes.flatMap((n) =>
    Object.entries(n.data.params)
      .filter(([, v]) => v.display === 'filebrowser')
      .map(([field]) => `${n.id}.${field}`),
  );
  same(inputs.map((v) => `${v.nodeId}.${v.field}`).sort(), fileFields.sort(), 'Complete root input bindings required.');
  for (const binding of inputs) {
    assert.ok(Array.isArray(binding.values) && binding.values.length > 0 && binding.values.length <= 2);
    const node = boundGraph.nodes.find((n) => n.id === binding.nodeId),
      parameter = node.data.params[binding.field];
    const empty = parameter.value ?? parameter.default;
    assert.ok(empty === '' || (Array.isArray(empty) && empty.length === 0), 'Canonical input is not unbound.');
    for (const value of binding.values) {
      assert.match(value.sourceValue, /^@data\/[\w./-]+$/u);
      assert.ok(value.sourceValue.split('/').every((part) => part && part !== '.' && part !== '..'));
    }
    assert.ok(parameter.fieldOptions?.multiple || binding.values.length === 1);
    parameter.value = parameter.fieldOptions?.multiple
      ? binding.values.map((v) => v.sourceValue)
      : binding.values[0].sourceValue;
  }
  const allowed = new Set([
    `modules.${type[0]}.${type[1]}`,
    'modules.Image.Load',
    'modules.Image.Preview',
    'modules.Audio.Load',
    'modules.Audio.Export',
    'modules.Video.Export',
  ]);
  assert.ok(
    boundGraph.nodes.every((n) => allowed.has(`${n.data.module}.${n.data.action}`)),
    'Undeclared executable node.',
  );
  if (variant === 'exercise')
    for (const [name, value] of Object.entries(exercises[manifest.mode])) {
      assert.ok(Object.hasOwn(primary[0].data.params, name), 'Exercise field is not declared.');
      primary[0].data.params[name].value = value;
    }
  if (variant === 'exercise' && manifest.mode === 'frame_interpolation')
    boundGraph.nodes.find((n) => n.data.action === 'Export').data.params.fps.value =
      exercises.frame_interpolation.interpolation_fps;
  return {
    workflowId: manifest.id,
    sourceTemplateId: manifest.sourceTemplateId,
    authoringId: authoring.id,
    authoringHash: sha256Value('canonical-workflow-authoring-v1', authoring),
    canonicalWorkflowHash: canonical.graphHash,
    modelType: manifest.modelType,
    task: manifest.mode,
    boundGraph,
    processorId: primary[0].id,
  };
}

export function validateMediaLifecycle({ expectedApi, submittedApi, accepted, run, messages, before, after }) {
  for (const api of [expectedApi, submittedApi, accepted.graph])
    same(Object.keys(api).sort(), ['nodes', 'paths', 'sid'], 'Unreviewed execution authority.');
  same(
    canonicalGraphIdentity(expectedApi),
    canonicalGraphIdentity(submittedApi),
    'Submitted graph/defaults/bindings differ.',
  );
  same(accepted.graph, submittedApi, 'Accepted queue graph differs.');
  const task = run.task;
  assert.equal(task.status, 'completed');
  assert.equal(task.attempt_index, 0);
  assert.equal(task.resourceCandidateId, null);
  assert.equal(accepted.taskId, task.task_id);
  assert.equal(task.sid, submittedApi.sid);
  assert.ok(!task.runtimeHints || Object.keys(task.runtimeHints).length === 0);
  assert.ok(
    Number.isFinite(task.started_at) && Number.isFinite(task.completed_at) && task.completed_at >= task.started_at,
  );
  const source = backendSourceEvidence({
    before: before.identity,
    after: after.identity,
    runtimeFingerprint: task.runtimeFingerprint,
  });
  assert.ok(
    selectBackendRuntimeFingerprintEvidence([task.runtimeFingerprint]),
    'Structured actual runtime is missing.',
  );
  same(source.blockers, [], 'Source does not match the native process.');
  assert.ok(
    Date.parse(before.identity.capturedAt) <= task.started_at * 1000 &&
      Date.parse(after.identity.capturedAt) >= task.completed_at * 1000,
  );
  assert.ok(Array.isArray(messages) && messages.length <= 512 && messages.every((m) => m.task_id === task.task_id));
  const done = messages.filter((m) => m.type === 'graph_completed');
  assert.equal(done.length, 1);
  same(done[0].runtimeFingerprint, task.runtimeFingerprint);
  same(done[0].runtimeMeasurement, task.runtimeMeasurement);
  same(done[0].resourceRetryHistory, []);
  assert.ok(done[0].runtimeHints == null);
  const executed = messages.filter((m) => m.type === 'executed');
  same(executed.map((m) => m.node).sort(), Object.keys(expectedApi.nodes).sort());
  for (const frame of executed) {
    const node = expectedApi.nodes[frame.node];
    assert.equal(frame.name, `${node.module}.${node.action}`);
    assert.equal(frame.status, 'succeeded', 'Cached result is not a fresh proof.');
    assert.equal(frame.attempt_index, 0);
  }
  const m = task.runtimeMeasurement;
  assert.equal(m.backend, 'cpu');
  assert.equal(m.device, 'cpu:0');
  assert.equal(m.peakMeasurementVersion, 2);
  assert.ok(
    Number.isFinite(m.elapsedSeconds) &&
      m.elapsedSeconds >= 0 &&
      Number.isSafeInteger(m.processRssBytes) &&
      m.processRssBytes > 0,
  );
  return { task, source: source.identity, graphHash: canonicalGraphIdentity(expectedApi).hash };
}

export async function readBuiltinMediaEvidence({ clientRoot, manifest, graph, authoring, evidencePath }) {
  const stat = lstatSync(evidencePath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536);
  const descriptorBytes = readFileSync(evidencePath),
    evidence = JSON.parse(descriptorBytes.toString('utf8'));
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.format, 'modiff.canonical-builtin-media-evidence.v1');
  assert.equal(evidence.workflowId, manifest.id);
  same(Object.keys(evidence).sort(), ['schemaVersion', 'format', 'workflowId', 'runs'].sort());
  assert.ok(Array.isArray(evidence.runs) && evidence.runs.length === 2);
  same(
    evidence.runs.map((r) => r.variant),
    ['baseline', 'exercise'],
  );
  const root = realpathSync(dirname(evidencePath)),
    retainedFiles = [];
  const read = (ref) => {
    const result = readCanonicalEvidenceFile(root, ref, 64 * 1024 * 1024);
    retainedFiles.push({ ...ref, absolutePath: result.file });
    return result;
  };
  const json = (ref) => JSON.parse(read(ref).bytes.toString('utf8'));
  const exercises = JSON.parse(
    readFileSync(join(clientRoot, 'config/builtin-media-qualification.v1.json'), 'utf8'),
  ).exercises;
  const targets = evidence.runs.map((r) =>
    builtinMediaTarget(manifest, graph, authoring, r.inputs, r.variant, exercises),
  );
  const apis = await exportCanonicalWorkflowGraphs(
    clientRoot,
    targets.map((t) => t.boundGraph),
  );
  const { parseBuiltinMediaEvidence, BUILTIN_MEDIA_EVIDENCE_SCOPES } = await parser(clientRoot);
  const executions = [];
  for (const [index, record] of evidence.runs.entries()) {
    const target = targets[index],
      expectedApi = apis[index],
      submittedApi = json(record.submittedApi),
      accepted = json(record.acceptedGraph),
      run = json(record.runDetail),
      messages = json(record.messages);
    const lifecycle = validateMediaLifecycle({
      expectedApi,
      submittedApi,
      accepted,
      run,
      messages,
      before: json(record.sourceBefore),
      after: json(record.sourceAfter),
    });
    const terminalIds = Object.keys(expectedApi.nodes).filter((id) =>
      Object.values(expectedApi.nodes).every((n) => Object.values(n.params).every((p) => p.sourceId !== id)),
    );
    assert.equal(terminalIds.length, 1);
    const terminalId = terminalIds[0];
    const outputs = run.outputs.filter((o) => o.nodeId === terminalId);
    assert.equal(outputs.length, 1);
    const output = outputs[0],
      frames = messages.filter((m) => m.type === 'update_value' && m.node === terminalId && m.output_id === output.id);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].backend_persisted, true);
    assert.equal(output.taskId, lifecycle.task.task_id);
    assert.equal(output.attemptIndex, 0);
    same(frames[0].resolved_execution_inputs, output.resolvedExecutionInputs);
    const consumed = output.resolvedExecutionInputs;
    assert.equal(consumed.source, 'backend-execution');
    assert.equal(consumed.taskId, lifecycle.task.task_id);
    assert.equal(consumed.nodeId, terminalId);
    assert.equal(consumed.attemptIndex, 0);
    same(consumed.uncapturedNodeIds, []);
    assert.equal(consumed.truncated, false);
    same(consumed.mediaEvidenceStatus, { schemaVersion: 1, truncated: false });
    same(consumed.nodes.map((n) => n.nodeId).sort(), Object.keys(expectedApi.nodes).sort());
    const media = new Map(),
      nodeControls = {};
    for (const node of consumed.nodes) {
      const submitted = expectedApi.nodes[node.nodeId];
      assert.equal(node.module, submitted.module);
      assert.equal(node.action, submitted.action);
      const scope = `${node.module.replace(/^modules\./u, '')}.${node.action}`,
        observed = parseBuiltinMediaEvidence(node.mediaEvidence, scope);
      assert.equal(observed?.status, 'complete', `Missing complete native media capture: ${node.nodeId}`);
      const names = new Set(BUILTIN_MEDIA_EVIDENCE_SCOPES[scope].controls.split(/\s+/u).filter(Boolean));
      const expectedControls = Object.fromEntries(
        Object.entries(submitted.params)
          .filter(([k, p]) => names.has(k) && Object.hasOwn(p, 'value'))
          .map(([k, p]) => [k, p.value]),
      );
      same(observed.controls, expectedControls, 'Normalized native controls differ.');
      nodeControls[node.nodeId] = observed.controls;
      media.set(node.nodeId, observed);
    }
    for (const [id, node] of Object.entries(expectedApi.nodes))
      for (const [port, param] of Object.entries(node.params))
        if (param.sourceId) {
          const targetMedia = media.get(id),
            producer = media.get(param.sourceId);
          same(
            targetMedia.inputs[port],
            producer.outputs[param.sourceKey],
            `Consumed ordered media differs across ${id}.${port}`,
          );
        }
    const oracleInputs = [];
    for (const binding of record.inputs) {
      const native = media.get(binding.nodeId).files[binding.field];
      assert.equal(native.length, binding.values.length);
      const values = binding.values.map((row, i) => {
        const physical = read(row.file);
        assert.equal(native[i].sourceValue, row.sourceValue);
        assert.equal(native[i].sha256, row.file.sha256);
        assert.equal(native[i].byteSize, row.file.bytes);
        assert.ok(native[i].converted !== true);
        if (media.get(binding.nodeId).inputs[binding.field])
          same(
            media.get(binding.nodeId).inputs[binding.field][i],
            { kind: 'file', sha256: row.file.sha256, byteSize: row.file.bytes },
            'Snapshot consumption differs from original source bytes.',
          );
        return { path: physical.file };
      });
      oracleInputs.push({ nodeId: binding.nodeId, field: binding.field, values });
    }
    assert.equal(record.durableOutputs.length, output.mediaItems.length);
    const durable = record.durableOutputs.map((row, i) => {
      const item = output.mediaItems[i],
        physical = read(row.file);
      assert.equal(row.backendPath, item.backendPath);
      assert.equal(item.taskId, lifecycle.task.task_id);
      assert.equal(item.attemptIndex, 0);
      assert.equal(item.mediaHash, `sha256:bytes:${row.file.sha256}`);
      assert.equal(item.byteSize, row.file.bytes);
      if (expectedApi.nodes[terminalId].module === 'modules.Image') {
        const nativeUrl = new URL(output.provenance.mediaItems[i].url, 'http://127.0.0.1');
        assert.equal(nativeUrl.pathname, `/cache/${terminalId}/output/${i}`);
        assert.equal(nativeUrl.searchParams.get('format'), 'WEBP');
        assert.equal(nativeUrl.searchParams.get('quality'), '100');
      }
      if (media.get(terminalId).outputs.file)
        same(media.get(terminalId).outputs.file[i], {
          kind: 'file',
          sha256: row.file.sha256,
          byteSize: row.file.bytes,
        });
      return { path: physical.file };
    });
    const raw = record.rawOutputs.map((row, i) => {
      assert.equal(row.nodeId, terminalId);
      assert.equal(row.field, 'output');
      assert.equal(row.index, i);
      return { path: read(row.file).file };
    });
    const primary = expectedApi.nodes[target.processorId],
      isImage = manifest.modelType === 'BuiltinImageOperation',
      isAudio = manifest.modelType === 'BuiltinAudioOperation';
    const primarySource = primary.params[isImage ? 'image' : isAudio ? 'source' : 'videos']?.sourceId;
    const oracle = {
      mode: manifest.mode,
      modelType: manifest.modelType,
      controls: nodeControls[target.processorId],
      nodeControls,
      inputs: oracleInputs,
      durableOutputs: durable,
      rawOutputs: raw,
      primarySource,
      referenceSource: primary.params.reference?.sourceId,
      maskSource: primary.params.mask?.sourceId,
      exportControls: nodeControls[terminalId],
    };
    if (record.intermediate) {
      const physical = read(record.intermediate);
      const native = media.get(target.processorId).outputs.video;
      same(native, [{ kind: 'file', sha256: record.intermediate.sha256, byteSize: record.intermediate.bytes }]);
      oracle.intermediate = { path: physical.file };
    } else
      assert.ok(
        isImage || isAudio || manifest.mode === 'video_frame_extract',
        'Native intermediate output is missing.',
      );
    const python =
      process.env.MODIFF_BACKEND_PYTHON ||
      process.env.MODIFF_PYTHON ||
      join(clientRoot, '../MoDiff/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const checked = spawnSync(python, ['-X', 'utf8', '-B', join(clientRoot, 'scripts/verify-builtin-media.py')], {
      input: JSON.stringify(oracle),
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(checked.status, 0, `Independent ${manifest.mode}/${record.variant} check failed: ${checked.stderr}`);
    const result = JSON.parse(checked.stdout);
    assert.equal(result.status, 'passed');
    for (const [nodeId, identities] of Object.entries(result.rootDecoded))
      same(
        media.get(nodeId).outputs[isImage ? 'image' : 'audio'],
        identities,
        'Decoded roots differ from actual loaded bytes.',
      );
    if (result.processedImages) {
      same(media.get(target.processorId).outputs[isImage ? 'output' : 'images'], result.processedImages);
      same(media.get(terminalId).outputs.output, result.processedImages);
    }
    if (result.processedAudio) same(media.get(target.processorId).outputs.output, [result.processedAudio]);
    executions.push({
      variant: record.variant,
      taskId: lifecycle.task.task_id,
      graphHash: lifecycle.graphHash,
      capturedAt: new Date(lifecycle.task.completed_at * 1000).toISOString(),
      backendSourceFingerprint: lifecycle.source.fingerprint,
      runtimeFingerprint: normalizeBackendRuntime(lifecycle.task.runtimeFingerprint).lockFingerprint,
      executionDurationSeconds: lifecycle.task.runtimeMeasurement.elapsedSeconds,
      peakMemoryBytes: lifecycle.task.runtimeMeasurement.processRssBytes,
      outputHashes: record.durableOutputs.map((row) => `sha256:bytes:${row.file.sha256}`),
      correctness: result,
    });
  }
  for (const ref of retainedFiles) readCanonicalEvidenceFile(root, ref, 64 * 1024 * 1024);
  assert.ok(readFileSync(evidencePath).equals(descriptorBytes));
  const target = targets[0],
    last = executions.at(-1);
  const receipt = {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-run-receipt.v1',
    proofKind: 'real_backend_deterministic_media',
    workflowId: manifest.id,
    sourceTemplateId: manifest.sourceTemplateId,
    authoringId: authoring.id,
    authoringHash: target.authoringHash,
    canonicalWorkflowHash: target.canonicalWorkflowHash,
    modelType: manifest.modelType,
    task: manifest.mode,
    taskId: executions[0].taskId,
    capturedAt: last.capturedAt,
    graphHash: executions[0].graphHash,
    modelSet: [],
    resourceCandidateId: null,
    runtimeFingerprint: executions[0].runtimeFingerprint,
    backendSourceFingerprint: executions[0].backendSourceFingerprint,
    outputHash: sha256Value(
      'builtin-media-output-collection-v1',
      executions.map((e) => e.outputHashes),
    ),
    executionDurationSeconds: executions.reduce((n, e) => n + e.executionDurationSeconds, 0),
    peakMemoryBytes: Math.max(...executions.map((e) => e.peakMemoryBytes)),
    canonicalDefaultsExecuted: true,
    deterministicCorrectness: 'verified_media_contract',
    executions,
    observationLimits: {
      fullConsumedFieldAccounting: false,
      browserInteraction: false,
      physicalPlatformQualification: false,
    },
    qualificationClaims: {
      publicTemplate: false,
      qualityApproved: false,
      rightsApproved: false,
      hardwareQualified: false,
      modelResourceQualified: false,
    },
  };
  return {
    receipt,
    provenance: { format: 'modiff.deterministic-media-proof.v1', receipt },
    evidence,
    descriptorBytes,
    retainedFiles,
    evidenceRoot: root,
  };
}
