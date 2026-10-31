// Optional native observations, never style, hardware or publication approval.
import assert from 'node:assert/strict';
import { canonicalJsonHash } from './canonical-json.mjs';

const same = (left, right, label) => assert.equal(canonicalJsonHash(left), canonicalJsonHash(right), label);
const keys = (value, expected) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Adapter evidence must be an object.');
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), 'Unknown or missing adapter evidence fields.');
};
const text = (value, maximum) =>
  typeof value === 'string' &&
  value.length > 0 &&
  [...value].length <= maximum &&
  value === value.trim() &&
  !/[\u0000-\u001f]/u.test(value);
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

export function validateAppliedAdapterSection(section) {
  assert.equal(section?.schemaVersion, 1);
  if (section.status !== 'complete') {
    keys(section, ['schemaVersion', 'status', 'reason']);
    assert.ok(
      typeof section.reason === 'string' &&
        (section.status === 'truncated'
          ? section.reason === 'record-size-limit'
          : section.status === 'unavailable' &&
            ['unobserved-application', 'owner-invalidated', 'unsupported-owner', 'unsupported-projection'].includes(
              section.reason,
            )),
      'Unknown adapter availability state.',
    );
    return section;
  }
  keys(section, ['schemaVersion', 'status', 'source', 'applicationId', 'observation', 'adapters', 'stateSha256']);
  assert.equal(section.source, 'backend-adapter-application');
  assert.match(section.applicationId, /^[a-f0-9]{32}$/u);
  assert.ok(['activated', 'reused'].includes(section.observation));
  assert.ok(Array.isArray(section.adapters) && section.adapters.length <= 32);
  const names = new Set();
  for (const item of section.adapters) {
    keys(item, ['adapterName', 'scale', 'descriptorSha256', 'artifact', 'scheduler']);
    assert.ok(
      text(item.adapterName, 128) &&
        /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/u.test(item.adapterName) &&
        !names.has(item.adapterName),
      'Adapter names must be bounded identifiers and unique.',
    );
    names.add(item.adapterName);
    assert.ok(typeof item.scale === 'number' && Number.isFinite(item.scale) && item.scale >= -20 && item.scale <= 20);
    assert.ok(sha(item.descriptorSha256));
    const artifact = item.artifact;
    keys(artifact, [
      'source',
      'weightName',
      'sha256',
      ...(artifact?.source === 'hub' ? ['repository', 'revision'] : []),
    ]);
    assert.ok(artifact.source === 'hub' || artifact.source === 'local');
    assert.ok(
      text(artifact.weightName, 256) &&
        !/[\\:]/u.test(artifact.weightName) &&
        artifact.weightName.endsWith('.safetensors') &&
        artifact.weightName.split('/').length <= 64 &&
        artifact.weightName.split('/').every((part) => part && part !== '.' && part !== '..'),
    );
    assert.ok(sha(artifact.sha256));
    if (artifact.source === 'hub') {
      assert.ok(
        text(artifact.repository, 256) &&
          artifact.repository.split('/').length === 2 &&
          artifact.repository.split('/').every((part) => part.length <= 96 && /^\w(?:[\w.-]*\w)?$/u.test(part)) &&
          !artifact.repository.includes('--') &&
          !artifact.repository.includes('..') &&
          !artifact.repository.endsWith('.git'),
      );
      assert.match(artifact.revision, /^[a-f0-9]{40}$/u);
    }
    if (item.scheduler !== null) {
      keys(item.scheduler, ['className', 'configSha256']);
      assert.ok(text(item.scheduler.className, 128) && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(item.scheduler.className));
      assert.match(item.scheduler.configSha256, /^sha256:[a-f0-9]{64}$/u);
    }
  }
  assert.ok(Buffer.byteLength(JSON.stringify({ adapters: section.adapters }), 'utf8') <= 32_768);
  assert.equal(
    section.stateSha256,
    `sha256:applied-adapters-v1:${canonicalJsonHash({ adapters: section.adapters })}`,
    'Applied adapter state digest differs.',
  );
  return section;
}

const literal = (node, name) => {
  const parameter = node.params?.[name];
  assert.ok(
    parameter && Object.hasOwn(parameter, 'value') && !parameter.sourceId && !parameter.sourceKey,
    `Adapter control is not an exact literal: ${name}.`,
  );
  return parameter.value;
};

function scaleLiteral(node) {
  const value = literal(node, 'scale');
  // Historical numeric controls submit decimal text. Match the backend's
  // finite float semantics only here; keep the graph and its identity unchanged.
  const decimal =
    typeof value === 'string' && value.length <= 64 && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value);
  assert.ok(typeof value === 'number' || decimal, 'Adapter scale must be numeric or bounded decimal text.');
  const number = Number(value);
  assert.ok(Number.isFinite(number) && number >= -20 && number <= 20, 'Adapter scale is outside its finite bounds.');
  return number;
}

function orderedChain(graph, owner) {
  const byId = new Map(graph.nodes.map((node) => [node.key, node]));
  const executed = new Set(graph.paths.flat());
  const source = owner.params?.lora_list;
  if (!source?.sourceId) {
    assert.ok(
      !source || source.value == null || (Array.isArray(source.value) && source.value.length === 0),
      'Opaque adapter list is unsupported.',
    );
    return [];
  }
  assert.equal(source.sourceKey, 'lora');
  assert.ok(!Object.hasOwn(source, 'value') || source.value === undefined);
  const chain = [];
  let id = source.sourceId;
  while (id) {
    assert.ok(chain.length < 32 && !chain.some((node) => node.key === id), 'Adapter chain is cyclic or oversized.');
    const node = byId.get(id);
    assert.ok(
      node && executed.has(id) && node.module === 'modules.ModularDiffusers' && node.action === 'Lora',
      'Adapter source is not an executed native Lora node.',
    );
    chain.push(node);
    const previous = node.params?.previous_loras;
    if (previous?.sourceId) {
      assert.equal(previous.sourceKey, 'lora');
      assert.ok(!Object.hasOwn(previous, 'value') || previous.value === undefined);
      id = previous.sourceId;
    } else {
      assert.ok(!previous || previous.value == null, 'Opaque predecessor is unsupported.');
      id = null;
    }
  }
  return chain.reverse();
}

function verifyOwnerOrder(graph, owner, application, models, strict) {
  // Optional observations authenticate native state without newly imposing a
  // literal Hub-chain requirement on ordinary historical qualification paths.
  if (!strict) return;
  const chain = orderedChain(graph, owner);
  if (application.status !== 'complete') {
    assert.ok(!strict, 'Applied adapter order is unavailable.');
    return;
  }
  assert.equal(application.adapters.length, chain.length, 'Applied adapter count differs from the executed chain.');
  const chainKeys = [...chain.map((node) => node.key), owner.key];
  assert.ok(
    graph.paths.some((path) =>
      chainKeys.every(
        (key, index) => path.includes(key) && (index === 0 || path.indexOf(chainKeys[index - 1]) < path.indexOf(key)),
      ),
    ),
    'Adapter producers were not executed before their owner.',
  );
  for (let index = 0; index < chain.length; index++) {
    const node = chain[index],
      applied = application.adapters[index];
    const name = literal(node, 'adapter_name');
    assert.ok(text(name, 128), 'Generated adapter names need a separate original-name join.');
    assert.equal(applied.adapterName, name, 'Applied adapter order/name differs.');
    assert.equal(applied.scale, scaleLiteral(node), 'Applied adapter scale differs.');
    const selected = literal(node, 'model');
    assert.ok(selected?.source === 'hub', 'Applied artifact proof currently requires a pinned Hub adapter.');
    same(
      applied.artifact,
      {
        source: 'hub',
        repository: selected.value,
        revision: literal(node, 'revision'),
        weightName: literal(node, 'weight_name'),
        sha256: literal(node, 'expected_sha256'),
      },
      'Applied adapter artifact differs.',
    );
    assert.ok(
      models.some(
        (item) =>
          item.repoId === applied.artifact.repository &&
          item.selectedRevision === applied.artifact.revision &&
          item.modelRevision === `${item.repoId}@${item.selectedRevision}`,
      ),
      'Applied adapter is missing its installed immutable model observation.',
    );
    const schedulerClass = literal(node, 'scheduler_class');
    if (schedulerClass === '') assert.equal(applied.scheduler, null, 'An unrequested adapter scheduler was applied.');
    else {
      assert.equal(applied.scheduler?.className, schedulerClass);
      assert.ok(!strict, 'Explicit scheduler normalization is outside the initial applied-order proof scope.');
    }
  }
}

export function validateAppliedAdapterProof(provenance, { required = false } = {}) {
  const proof = provenance?.adapterApplications;
  if (proof === undefined) {
    assert.equal(provenance?.adapterApplicationsHash, undefined, 'Adapter proof hash has no observation.');
    assert.ok(!required, 'Original applied adapter order evidence is required.');
    return null;
  }
  keys(proof, ['schemaVersion', 'source', 'taskId', 'attemptIndex', 'outputNodeKey', 'truncated', 'owners']);
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.source, 'backend-execution');
  assert.equal(proof.taskId, provenance.taskId);
  assert.ok(
    typeof proof.taskId === 'string' &&
      proof.taskId.length > 0 &&
      Number.isSafeInteger(proof.attemptIndex) &&
      proof.attemptIndex >= 0,
  );
  assert.ok(typeof proof.truncated === 'boolean' && Array.isArray(proof.owners) && proof.owners.length <= 256);
  assert.equal(
    provenance.adapterApplicationsHash,
    `sha256:adapter-applications-v1:${canonicalJsonHash(proof)}`,
    'Adapter proof digest differs.',
  );
  const graph = provenance.graph.canonicalGraph;
  const executed = new Set(graph.paths.flat());
  assert.ok(executed.has(proof.outputNodeKey), 'Adapter proof output was not executed.');
  const nodes = new Map(graph.nodes.map((node) => [node.key, node]));
  const ancestors = new Set();
  const pending = [proof.outputNodeKey];
  while (pending.length) {
    const key = pending.pop();
    if (ancestors.has(key)) continue;
    assert.ok(nodes.has(key) && ancestors.size < 256, 'Adapter output ancestry is missing or oversized.');
    ancestors.add(key);
    for (const parameter of Object.values(nodes.get(key).params ?? {})) {
      if (parameter.sourceId) pending.push(parameter.sourceId);
    }
  }
  const expectedOwners = graph.nodes.filter(
    (node) => executed.has(node.key) && node.module === 'modules.ModularDiffusers' && node.action === 'ModelsLoader',
  );
  const seen = new Set();
  for (const item of proof.owners) {
    keys(item, ['nodeKey', 'application']);
    const owner = expectedOwners.find((node) => node.key === item.nodeKey);
    assert.ok(
      owner && ancestors.has(item.nodeKey) && !seen.has(item.nodeKey),
      'Applied adapter owner is missing, detached or duplicated.',
    );
    seen.add(item.nodeKey);
    validateAppliedAdapterSection(item.application);
    verifyOwnerOrder(graph, owner, item.application, provenance.models.items, required);
  }
  if (required) {
    assert.equal(proof.truncated, false, 'Applied adapter ancestry is incomplete.');
    assert.ok(
      expectedOwners.length > 0 && proof.owners.length === expectedOwners.length,
      'Applied adapter owners are incomplete.',
    );
  }
  return proof;
}

export function createAppliedAdapterProof({ apiGraph, canonicalGraph, executedOutput, executionReceipt, taskId }) {
  const consumed = executedOutput?.resolvedExecutionInputs;
  if (
    consumed?.appliedAdaptersStatus === undefined &&
    !consumed?.nodes?.some((row) => row.appliedAdapters !== undefined)
  )
    return null;
  assert.equal(consumed.schemaVersion, 1, 'Applied adapter native receipt version is unsupported.');
  assert.equal(consumed.source, 'backend-execution');
  assert.equal(consumed.taskId, taskId);
  assert.equal(executedOutput.taskId, taskId);
  assert.equal(executionReceipt?.task_id, taskId, 'Applied adapter evidence requires the original task identity.');
  assert.equal(executionReceipt.status, 'completed');
  assert.equal(consumed.attemptIndex, executionReceipt.attempt_index);
  assert.equal(consumed.attemptIndex, executedOutput.attemptIndex);
  assert.equal(consumed.nodeId, executedOutput.nodeId);
  same(apiGraph, executedOutput.apiGraphSnapshot, 'Applied adapter graph differs from the original output snapshot.');
  keys(consumed.appliedAdaptersStatus, ['schemaVersion', 'truncated']);
  assert.equal(consumed.appliedAdaptersStatus.schemaVersion, 1);
  assert.equal(typeof consumed.appliedAdaptersStatus.truncated, 'boolean');
  assert.equal(typeof consumed.truncated, 'boolean');
  assert.ok(Array.isArray(consumed.nodes) && consumed.nodes.length <= 256 && Array.isArray(consumed.uncapturedNodeIds));
  // Canonicalization preserves executed path order. Match that existing order;
  // never rewrite the native receipt or manufacture an input/output graph.
  const ids = [...new Set(apiGraph.paths.flat())];
  const canonicalIds = [...new Set(canonicalGraph.paths.flat())];
  assert.equal(ids.length, canonicalIds.length);
  const idMap = new Map(ids.map((id, index) => [id, canonicalIds[index]]));
  const owners = consumed.nodes
    .filter((row) => row.appliedAdapters !== undefined)
    .map((row) => {
      assert.equal(row.module, 'modules.ModularDiffusers');
      assert.equal(row.action, 'ModelsLoader');
      assert.equal(apiGraph.nodes[row.nodeId]?.module, row.module);
      assert.equal(apiGraph.nodes[row.nodeId]?.action, row.action);
      assert.ok(idMap.has(row.nodeId), 'Adapter owner is outside executed ancestry.');
      return { nodeKey: idMap.get(row.nodeId), application: validateAppliedAdapterSection(row.appliedAdapters) };
    });
  const proof = {
    schemaVersion: 1,
    source: 'backend-execution',
    taskId,
    attemptIndex: consumed.attemptIndex,
    outputNodeKey: idMap.get(consumed.nodeId),
    truncated: consumed.truncated || consumed.uncapturedNodeIds.length > 0 || consumed.appliedAdaptersStatus.truncated,
    owners,
  };
  return { proof, hash: `sha256:adapter-applications-v1:${canonicalJsonHash(proof)}` };
}
