import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const LIVE_PROOF_PROVENANCE_SCHEMA_VERSION = 2;
export const LIVE_PROOF_PROVENANCE_FORMAT = 'modiff.live-proof.provenance.v2';
export const CANONICAL_GRAPH_SCHEMA_VERSION = 1;

const RUNTIME_TORCH_FIELDS = [
  'cuda_available',
  'cuda_device_count',
  'cuda_device_name',
  'cudnn_version',
  'cudnn_deterministic',
  'cudnn_benchmark',
  'deterministic_algorithms',
  'cuda_device_total_memory_bytes',
  'cuda_memory_total_bytes',
  'cuda_device_capability',
];

const EXECUTION_PLAN_FIELDS = [
  'source',
  'device',
  'cudaIndex',
  'modelType',
  'modelRepo',
  'resolvedModelRepo',
  'resolvedArtifact',
  'modelDependencies',
  'executionPath',
  'pipelineClass',
  'dtype',
  'resourceMode',
  'resolvedResourceMode',
  'quantizationMode',
  'quantizedComponents',
  'autoOffload',
  'offloadMode',
  'deviceMap',
  'attentionBackend',
  'regionalCompile',
  'denoiserCache',
  'channelsLast',
  'layerwiseCasting',
  'autoResourceCandidateId',
  'resourceRetryAttempt',
];

const CONTRACT_PARAM_FIELDS = [
  'type',
  'display',
  'default',
  'min',
  'max',
  'step',
  'options',
  'fieldOptions',
  'dataSource',
  'cache',
];

function orderedValue(value) {
  if (Array.isArray(value)) return value.map(orderedValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, orderedValue(entryValue)]),
  );
}

export function stableStringify(value) {
  return JSON.stringify(orderedValue(value));
}

export function sha256Value(prefix, value) {
  const digest = createHash('sha256').update(stableStringify(value)).digest('hex');
  return `sha256:${prefix}:${digest}`;
}

function outputCollectionItemIdentity(item) {
  return {
    index: item.index,
    mediaType: item.mediaType,
    width: item.width,
    height: item.height,
    frames: item.frames,
    durationSeconds: item.durationSeconds,
    sampleRate: item.sampleRate,
    channels: item.channels,
    decodedSha256: item.decodedSha256,
    ...(item.decodedAudioSha256 ? { decodedAudioSha256: item.decodedAudioSha256 } : {}),
    ...(item.audiovisualSha256 ? { audiovisualSha256: item.audiovisualSha256 } : {}),
  };
}

export function repairDuplicateOutputItems(provenance, executedOutput) {
  const backendItems = executedOutput?.backendProvenance?.mediaItems ?? executedOutput?.mediaItems ?? [];
  const uniqueItems = [];
  const seenEncodedHashes = new Set();
  for (const item of provenance?.output?.items ?? []) {
    if (!item?.encodedSha256 || seenEncodedHashes.has(item.encodedSha256)) continue;
    seenEncodedHashes.add(item.encodedSha256);
    uniqueItems.push(item);
  }
  if (uniqueItems.length !== backendItems.length) {
    throw new Error(
      `Cannot repair output collection: ${uniqueItems.length} unique captured item(s) do not match ${backendItems.length} backend item(s).`,
    );
  }
  const items = uniqueItems.map((item, index) => ({
    ...item,
    index,
    backendMediaHash: backendItems[index]?.mediaHash ?? null,
  }));
  const collectionPayload = items.map(outputCollectionItemIdentity);
  const output = {
    ...provenance.output,
    count: items.length,
    collectionHash: sha256Value('decoded-output-collection-v1', collectionPayload),
    backendCollectionHash: executedOutput?.mediaCollectionHash ?? null,
    items,
  };
  const proofLock = {
    format: provenance.format,
    templateRevisionHash: provenance.template?.revisionHash,
    resolvedTemplateLockHash: provenance.template?.resolvedTemplateLockHash,
    graphHash: provenance.graph?.hash,
    executionPlanHash: provenance.graph?.executionPlanHash,
    modelRevision: provenance.model?.modelRevision,
    modelFingerprint: provenance.model?.fingerprint,
    modelSetHash: provenance.models?.hash,
    inputArtifactsHash: provenance.inputArtifactsHash,
    runtimeFingerprint: provenance.runtime?.lockFingerprint,
    backendSourceFingerprint: provenance.runtime?.backendSource?.fingerprint,
    backendContractFingerprint: provenance.runtime?.backendContract?.fingerprint,
    deterministicFingerprint: provenance.runtime?.deterministic?.fingerprint,
    outputCollectionHash: output.collectionHash,
  };
  return {
    ...provenance,
    proofLockHash: sha256Value('live-proof-lock-v1', proofLock),
    output,
  };
}

function nodeEntries(apiGraph) {
  if (Array.isArray(apiGraph?.nodes)) {
    return apiGraph.nodes.map((node) => [String(node?.id ?? ''), node]);
  }
  return Object.entries(apiGraph?.nodes ?? {});
}

function graphNodeOrder(apiGraph, entries) {
  const available = new Set(entries.map(([id]) => id));
  const ordered = [];
  for (const nodeId of (apiGraph?.paths ?? []).flat()) {
    const normalized = String(nodeId);
    if (available.has(normalized) && !ordered.includes(normalized)) ordered.push(normalized);
  }

  const remaining = entries
    .filter(([id]) => !ordered.includes(id))
    .sort(([, left], [, right]) => {
      const leftKey = `${left?.module ?? ''}.${left?.action ?? ''}:${stableStringify(left?.params ?? {})}`;
      const rightKey = `${right?.module ?? ''}.${right?.action ?? ''}:${stableStringify(right?.params ?? {})}`;
      return leftKey.localeCompare(rightKey);
    })
    .map(([id]) => id);
  return [...ordered, ...remaining];
}

function canonicalGraphValue(value, idMap) {
  if (Array.isArray(value)) return value.map((item) => canonicalGraphValue(item, idMap));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => {
        if ((key === 'sourceId' || key === 'targetId') && typeof entryValue === 'string') {
          return [key, idMap.get(entryValue) ?? entryValue];
        }
        return [key, canonicalGraphValue(entryValue, idMap)];
      }),
  );
}

function canonicalGraphParams(params, idMap) {
  return Object.fromEntries(
    Object.entries(params ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, rawParam]) => {
        if (
          rawParam &&
          typeof rawParam === 'object' &&
          !Array.isArray(rawParam) &&
          typeof rawParam.display === 'string' &&
          rawParam.display.startsWith('ui_')
        ) {
          const stableParam = { ...rawParam };
          delete stableParam.value;
          return [key, canonicalGraphValue(stableParam, idMap)];
        }
        return [key, canonicalGraphValue(rawParam, idMap)];
      }),
  );
}

export function canonicalizeApiGraph(apiGraph) {
  const entries = nodeEntries(apiGraph);
  const byId = new Map(entries);
  const orderedIds = graphNodeOrder(apiGraph, entries);
  const actionCounts = new Map();
  const idMap = new Map();

  for (const nodeId of orderedIds) {
    const node = byId.get(nodeId) ?? {};
    const actionKey = `${node.module ?? 'unknown'}.${node.action ?? 'unknown'}`;
    const ordinal = (actionCounts.get(actionKey) ?? 0) + 1;
    actionCounts.set(actionKey, ordinal);
    idMap.set(nodeId, `${actionKey}#${ordinal}`);
  }

  const nodes = orderedIds.map((nodeId) => {
    const node = byId.get(nodeId) ?? {};
    return {
      key: idMap.get(nodeId),
      module: node.module ?? null,
      action: node.action ?? null,
      params: canonicalGraphParams(node.params ?? {}, idMap),
    };
  });
  const paths = (apiGraph?.paths ?? []).map((nodePath) =>
    nodePath.map((nodeId) => idMap.get(String(nodeId)) ?? String(nodeId)),
  );

  return orderedValue({
    schemaVersion: CANONICAL_GRAPH_SCHEMA_VERSION,
    nodes,
    paths,
    deterministicMode: apiGraph?.deterministicMode ?? null,
  });
}

export function canonicalGraphIdentity(apiGraph) {
  const canonicalGraph = canonicalizeApiGraph(apiGraph);
  return {
    schemaVersion: CANONICAL_GRAPH_SCHEMA_VERSION,
    hash: sha256Value('canonical-graph-v1', canonicalGraph),
    canonicalGraph,
  };
}

export function executionPlanIdentity(apiGraph) {
  const runtimeHints = apiGraph?.runtimeHints ?? {};
  const plan = Object.fromEntries(
    EXECUTION_PLAN_FIELDS.filter((field) => runtimeHints[field] !== undefined).map((field) => [
      field,
      runtimeHints[field],
    ]),
  );
  return {
    hash: sha256Value('execution-plan-v1', plan),
    plan: orderedValue(plan),
  };
}

function executionReceiptIdentity(executionReceipt, executionPlan) {
  const measurement = executionReceipt?.runtimeMeasurement;
  const hints = executionReceipt?.runtimeHints;
  const peakMemoryBytes =
    measurement?.peakAllocatedBytes ??
    measurement?.peakReservedBytes ??
    measurement?.driverAllocatedBytes ??
    measurement?.processRssBytes ??
    null;
  const manualResourceCandidateId =
    executionPlan?.modelType && executionPlan?.dtype
      ? `manual-resource-v1:${[
          executionPlan.modelType,
          executionPlan.dtype,
          executionPlan.offloadMode ?? 'none',
          executionPlan.quantizationMode ?? 'none',
        ].join('|')}`
      : null;
  return {
    resourceCandidateId:
      hints?.autoResourceCandidateId ?? executionPlan?.autoResourceCandidateId ?? manualResourceCandidateId,
    elapsedSeconds:
      Number.isFinite(measurement?.elapsedSeconds) && measurement.elapsedSeconds >= 0
        ? measurement.elapsedSeconds
        : null,
    peakMemoryBytes: Number.isFinite(peakMemoryBytes) && peakMemoryBytes > 0 ? Math.trunc(peakMemoryBytes) : null,
    measurement: measurement && typeof measurement === 'object' ? orderedValue(measurement) : null,
  };
}

export function resolvedModelReposFromOutput(output) {
  const graph = output?.apiGraphSnapshot;
  const loaderRepos = nodeEntries(graph).flatMap(([, node]) => {
    const params = node?.params ?? {};
    const action = String(node?.action ?? '').toLowerCase();
    const modelParam =
      params.model_id ??
      params.repo_id ??
      (action.includes('adapter') ? params.adapter_path : undefined) ??
      (action === 'lora' ? params.model : undefined);
    if (!modelParam || (!action.includes('load') && action !== 'lora' && action !== 'upscaler')) return [];
    const loaderValue = modelParam?.value;
    const rawRepo = typeof loaderValue === 'object' ? loaderValue?.value : loaderValue;
    if (typeof rawRepo !== 'string' || !rawRepo.trim()) return [];
    const repoOrFile = rawRepo.trim();
    const segments = repoOrFile.split('/');
    const repo =
      segments.length > 2 && /\.(?:safetensors|pt|pth|ckpt|pkl|bin)$/i.test(repoOrFile)
        ? segments.slice(0, 2).join('/')
        : repoOrFile;
    return [repo];
  });
  const fallbacks = [
    graph?.runtimeHints?.resolvedArtifact,
    graph?.runtimeHints?.resolvedModelRepo,
    output?.provenance?.resourcePlan?.resolvedArtifact,
    output?.repo,
  ].filter((value) => typeof value === 'string' && value.trim());
  const dependencyRepos = Array.isArray(graph?.runtimeHints?.modelDependencies)
    ? graph.runtimeHints.modelDependencies
        .map((dependency) => dependency?.repo)
        .filter((value) => typeof value === 'string' && value.trim())
    : [];
  return [...new Set([...(loaderRepos.length > 0 ? loaderRepos : fallbacks), ...dependencyRepos])];
}

export function resolvedModelRepoFromOutput(output) {
  return resolvedModelReposFromOutput(output)[0] ?? null;
}

export function selectInstalledModelIdentity(payload, repoId) {
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const model = models.find(
    (item) => item?.installed && String(item?.repoId ?? '').toLowerCase() === String(repoId ?? '').toLowerCase(),
  );
  if (!model?.selectedRevision || !model?.modelRevision) {
    return null;
  }
  return {
    repoId: model.repoId,
    selectedRevision: model.selectedRevision,
    modelRevision: model.modelRevision,
    fingerprint: model.fingerprint ?? null,
    revisions: (model.revisions ?? []).map((revision) => ({
      hash: revision.hash,
      size: revision.size ?? 0,
      lastModified: revision.lastModified ?? null,
    })),
  };
}

export function modelSetIdentity(modelIdentities = []) {
  const items = modelIdentities
    .filter(Boolean)
    .map((model) => orderedValue(model))
    .sort((left, right) => String(left.repoId).localeCompare(String(right.repoId)));
  const revisionLock = items.map((item) => item.modelRevision).join(' | ');
  const commitLock = items.map((item) => `${item.repoId}@${item.selectedRevision}`).join(' | ');
  return {
    count: items.length,
    hash: sha256Value('model-set-v1', items),
    revisionLock,
    commitLock,
    items,
  };
}

function inputArtifactsIdentity(inputArtifacts = []) {
  const items = inputArtifacts
    .map((item) =>
      orderedValue({
        role: item.role ?? null,
        path: item.path ?? null,
        contentHash: item.contentHash ?? item.sha256 ?? null,
        byteSize: item.byteSize ?? null,
      }),
    )
    .sort((left, right) => `${left.role}:${left.path}`.localeCompare(`${right.role}:${right.path}`));
  return {
    count: items.length,
    hash: sha256Value('input-artifacts-v1', items),
    items,
  };
}

export function normalizeBackendRuntime(runtimeFingerprint, deterministicMode = null) {
  if (!runtimeFingerprint || typeof runtimeFingerprint !== 'object') {
    return {
      reportedFingerprint: typeof runtimeFingerprint === 'string' ? runtimeFingerprint : null,
      lockFingerprint: null,
      payload: null,
    };
  }

  const torch = Object.fromEntries(
    RUNTIME_TORCH_FIELDS.filter((field) => runtimeFingerprint.torch?.[field] !== undefined).map((field) => [
      field,
      runtimeFingerprint.torch[field],
    ]),
  );
  const applied = deterministicMode?.settings ?? {};
  if (deterministicMode?.enabled) {
    if (typeof applied.cudnn_benchmark === 'boolean') torch.cudnn_benchmark = applied.cudnn_benchmark;
    if (typeof applied.cudnn_deterministic === 'boolean') {
      torch.cudnn_deterministic = applied.cudnn_deterministic;
    }
    if (typeof applied.torch_deterministic_algorithms === 'boolean') {
      torch.deterministic_algorithms = applied.torch_deterministic_algorithms;
    }
  }
  const payload = orderedValue({
    packages: runtimeFingerprint.packages ?? {},
    torch,
    workDir: runtimeFingerprint.work_dir ?? null,
    dataDir: runtimeFingerprint.data_dir ?? null,
  });
  return {
    reportedFingerprint: runtimeFingerprint.fingerprint ?? null,
    lockFingerprint: sha256Value('stable-runtime-v1', payload),
    payload,
  };
}

export function runtimeLockFromProvenance(provenance) {
  const deterministic = provenance?.runtime?.deterministic?.settings;
  return normalizeBackendRuntime(
    {
      fingerprint: provenance?.runtime?.reportedFingerprint,
      packages: provenance?.runtime?.payload?.packages,
      torch: provenance?.runtime?.payload?.torch,
      work_dir: provenance?.runtime?.payload?.workDir,
      data_dir: provenance?.runtime?.payload?.dataDir,
    },
    deterministic,
  ).lockFingerprint;
}

function normalizedContractParam(param) {
  if (!param || typeof param !== 'object') return param;
  return Object.fromEntries(
    CONTRACT_PARAM_FIELDS.filter((field) => param[field] !== undefined).map((field) => [field, param[field]]),
  );
}

export function backendContractIdentity(nodesPayload, canonicalGraph) {
  const contracts = nodesPayload?.nodes ?? nodesPayload ?? {};
  const used = (canonicalGraph?.nodes ?? []).map((node) => {
    const contract = contracts?.[`${node.module}.${node.action}`] ?? {};
    return {
      key: `${node.module}.${node.action}`,
      module: contract.module ?? node.module,
      action: contract.action ?? node.action,
      type: contract.type ?? null,
      cache: contract.cache ?? null,
      skipParamsCheck: contract.skipParamsCheck ?? null,
      params: Object.fromEntries(
        Object.entries(contract.params ?? {})
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, param]) => [key, normalizedContractParam(param)]),
      ),
    };
  });
  const payload = orderedValue(used);
  return {
    fingerprint: sha256Value('backend-contract-v1', payload),
    contracts: payload,
  };
}

function sourceFilesUnder(target) {
  if (!existsSync(target)) return [];
  const stats = statSync(target);
  if (stats.isFile()) return [target];
  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__pycache__' || entry.name.startsWith('.')) return [];
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(child);
    return /\.(py|toml|ini)$/i.test(entry.name) ? [child] : [];
  });
}

function gitCommit(root) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function backendSourceIdentity(backendRoot) {
  const targets = [
    path.join(backendRoot, 'main.py'),
    path.join(backendRoot, 'pyproject.toml'),
    path.join(backendRoot, 'modiff'),
    path.join(backendRoot, 'modules'),
    path.join(backendRoot, 'utils'),
  ];
  const files = [...new Set(targets.flatMap(sourceFilesUnder))]
    .sort((left, right) => left.localeCompare(right))
    .map((file) => ({
      path: path.relative(backendRoot, file).replaceAll('\\', '/'),
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    }));
  const payload = {
    gitCommit: gitCommit(backendRoot),
    files,
  };
  return {
    gitCommit: payload.gitCommit,
    fingerprint: sha256Value('backend-source-v1', payload),
    files,
  };
}

function deterministicIdentity(deterministicMode) {
  const payload = orderedValue(deterministicMode ?? null);
  return {
    fingerprint: sha256Value('deterministic-settings-v1', payload),
    settings: payload,
  };
}

function templateIdentity({
  templateId,
  lockedSettings,
  promptSettingsHash,
  catalogTemplateLockHash,
  resolvedTemplateLockHash,
  modelRevision,
}) {
  const revisionPayload = {
    templateId,
    lockedSettings,
    promptSettingsHash,
    catalogTemplateLockHash,
    resolvedTemplateLockHash,
    modelRevision,
  };
  return {
    id: templateId,
    promptSettingsHash,
    catalogTemplateLockHash,
    resolvedTemplateLockHash,
    revisionHash: sha256Value('template-revision-v1', revisionPayload),
    lockedSettings: orderedValue(lockedSettings),
  };
}

function outputIdentity(outputAnalysis, executedOutput) {
  const backendItems = executedOutput?.backendProvenance?.mediaItems ?? executedOutput?.mediaItems ?? [];
  const items = (outputAnalysis?.analyses ?? []).map((analysis, index) => {
    const mediaType = analysis.mediaType ?? executedOutput?.displayType ?? 'image';
    return {
      index,
      mediaType,
      width: analysis.width ?? null,
      height: analysis.height ?? null,
      frames: analysis.frames ?? null,
      durationSeconds: analysis.durationSeconds ?? null,
      sampleRate: analysis.sampleRate ?? null,
      channels: analysis.channels ?? null,
      byteSize: analysis.byteSize ?? null,
      encodedSha256: analysis.encodedSha256 ?? null,
      decodedSha256: analysis.decodedSha256 ?? analysis.hash ?? null,
      hasAudio: analysis.hasAudio ?? null,
      decodedAudioSha256: analysis.embeddedAudio?.hash ?? analysis.decodedAudioHash ?? null,
      audiovisualSha256: analysis.audiovisualMediaHash ?? null,
      backendMediaHash: backendItems[index]?.mediaHash ?? (index === 0 ? (executedOutput?.mediaHash ?? null) : null),
    };
  });
  const collectionPayload = items.map(outputCollectionItemIdentity);
  return {
    count: items.length,
    collectionHash: sha256Value('decoded-output-collection-v1', collectionPayload),
    backendCollectionHash: executedOutput?.mediaCollectionHash ?? null,
    items,
  };
}

export function validateRunProvenance(provenance) {
  const blockers = [];
  const required = [
    ['template.resolvedTemplateLockHash', provenance?.template?.resolvedTemplateLockHash],
    ['template.revisionHash', provenance?.template?.revisionHash],
    ['graph.hash', provenance?.graph?.hash],
    ['graph.executionPlanHash', provenance?.graph?.executionPlanHash],
    ['model.modelRevision', provenance?.model?.modelRevision],
    ['model.selectedRevision', provenance?.model?.selectedRevision],
    ['model.fingerprint', provenance?.model?.fingerprint],
    ['runtime.lockFingerprint', provenance?.runtime?.lockFingerprint],
    ['runtime.backendSourceFingerprint', provenance?.runtime?.backendSource?.fingerprint],
    ['runtime.backendContractFingerprint', provenance?.runtime?.backendContract?.fingerprint],
    ['runtime.deterministicFingerprint', provenance?.runtime?.deterministic?.fingerprint],
    ['output.collectionHash', provenance?.output?.collectionHash],
  ];
  for (const [field, value] of required) {
    if (!value || String(value).includes('pin-required') || String(value).includes('unverified')) {
      blockers.push(`${field} is not pinned.`);
    }
  }
  if (Number(provenance?.schemaVersion) >= 2) {
    if (!provenance?.execution?.resourceCandidateId) {
      blockers.push('execution.resourceCandidateId is missing.');
    }
    if (!Number.isFinite(provenance?.execution?.elapsedSeconds) || provenance.execution.elapsedSeconds < 0) {
      blockers.push('execution.elapsedSeconds is invalid.');
    }
    if (!Number.isInteger(provenance?.execution?.peakMemoryBytes) || provenance.execution.peakMemoryBytes <= 0) {
      blockers.push('execution.peakMemoryBytes is invalid.');
    }
  }
  if ((provenance?.output?.items?.length ?? 0) === 0) blockers.push('output.items is empty.');
  const expectedOutput = provenance?.template?.expectedOutput;
  const primaryOutput = provenance?.output?.items?.[0];
  if (expectedOutput && primaryOutput) {
    for (const field of ['width', 'height', 'frames']) {
      if (
        Number.isInteger(expectedOutput[field]) &&
        expectedOutput[field] > 0 &&
        primaryOutput[field] !== expectedOutput[field]
      ) {
        blockers.push(
          `output.items.0.${field} does not match the template contract: expected ${expectedOutput[field]}, got ${String(primaryOutput[field])}.`,
        );
      }
    }
    if (expectedOutput.requiresAudio === true && primaryOutput.hasAudio !== true) {
      blockers.push('output.items.0.hasAudio does not match the template contract: audio is required.');
    }
  }
  for (const [index, item] of (provenance?.output?.items ?? []).entries()) {
    if (!item.decodedSha256) blockers.push(`output.items.${index}.decodedSha256 is missing.`);
    if (item.mediaType === 'video' && item.hasAudio === true) {
      if (!item.decodedAudioSha256) blockers.push(`output.items.${index}.decodedAudioSha256 is missing.`);
      if (!item.audiovisualSha256) blockers.push(`output.items.${index}.audiovisualSha256 is missing.`);
    }
    if (item.mediaType === 'audio') {
      if (!Number.isInteger(item.sampleRate) || item.sampleRate <= 0) {
        blockers.push(`output.items.${index}.sampleRate is invalid.`);
      }
      if (!Number.isInteger(item.channels) || item.channels <= 0) {
        blockers.push(`output.items.${index}.channels is invalid.`);
      }
      if (!Number.isFinite(item.durationSeconds) || item.durationSeconds <= 0) {
        blockers.push(`output.items.${index}.durationSeconds is invalid.`);
      }
    } else if (item.mediaType !== 'json') {
      if (!Number.isInteger(item.width) || item.width <= 0) blockers.push(`output.items.${index}.width is invalid.`);
      if (!Number.isInteger(item.height) || item.height <= 0) blockers.push(`output.items.${index}.height is invalid.`);
      if (item.mediaType === 'video' && (!Number.isInteger(item.frames) || item.frames <= 0)) {
        blockers.push(`output.items.${index}.frames is invalid.`);
      }
    }
  }
  for (const [index, item] of (provenance?.inputs?.items ?? []).entries()) {
    if (!item.role) blockers.push(`inputs.items.${index}.role is missing.`);
    if (!item.contentHash) blockers.push(`inputs.items.${index}.contentHash is missing.`);
    if (!Number.isInteger(item.byteSize) || item.byteSize <= 0) {
      blockers.push(`inputs.items.${index}.byteSize is invalid.`);
    }
  }
  return blockers;
}

export function createRunProvenance({
  templateId,
  lockedSettings,
  promptSettingsHash,
  catalogTemplateLockHash,
  resolvedTemplateLockHash,
  apiGraph,
  nodesPayload,
  modelIdentity,
  modelIdentities,
  inputArtifacts = [],
  runtimeFingerprint,
  deterministicMode,
  backendSource,
  outputAnalysis,
  executedOutput,
  executionReceipt,
  taskId,
  expectedOutput,
  capturedAt = new Date().toISOString(),
}) {
  const graph = canonicalGraphIdentity(apiGraph);
  const executionPlan = executionPlanIdentity(apiGraph);
  const execution = executionReceiptIdentity(executionReceipt, executionPlan.plan);
  const runtime = normalizeBackendRuntime(runtimeFingerprint, deterministicMode);
  const backendContract = backendContractIdentity(nodesPayload, graph.canonicalGraph);
  const deterministic = deterministicIdentity(deterministicMode);
  const modelSet = modelSetIdentity(modelIdentities?.length ? modelIdentities : [modelIdentity].filter(Boolean));
  const compatibilityModel =
    modelSet.count === 1
      ? modelSet.items[0]
      : {
          repoId: `model-set:${modelSet.hash}`,
          selectedRevision: modelSet.commitLock,
          modelRevision: modelSet.revisionLock,
          fingerprint: modelSet.hash,
          revisions: [],
        };
  const inputs = inputArtifactsIdentity(inputArtifacts);
  const template = templateIdentity({
    templateId,
    lockedSettings,
    promptSettingsHash,
    catalogTemplateLockHash,
    resolvedTemplateLockHash,
    modelRevision: compatibilityModel?.modelRevision,
  });
  const output = outputIdentity(outputAnalysis, executedOutput);
  const proofLock = {
    format: LIVE_PROOF_PROVENANCE_FORMAT,
    templateRevisionHash: template.revisionHash,
    resolvedTemplateLockHash: template.resolvedTemplateLockHash,
    graphHash: graph.hash,
    executionPlanHash: executionPlan.hash,
    modelRevision: compatibilityModel?.modelRevision ?? null,
    modelFingerprint: compatibilityModel?.fingerprint ?? null,
    modelSetHash: modelSet.hash,
    inputArtifactsHash: inputs.hash,
    runtimeFingerprint: runtime.lockFingerprint,
    backendSourceFingerprint: backendSource?.fingerprint ?? null,
    backendContractFingerprint: backendContract.fingerprint,
    deterministicFingerprint: deterministic.fingerprint,
    outputCollectionHash: output.collectionHash,
  };
  const firstOutput = output.items[0] ?? {};
  const provenance = {
    schemaVersion: LIVE_PROOF_PROVENANCE_SCHEMA_VERSION,
    format: LIVE_PROOF_PROVENANCE_FORMAT,
    capturedAt,
    taskId: taskId ?? null,
    proofLockHash: sha256Value('live-proof-lock-v1', proofLock),
    graphHash: graph.hash,
    runtimeFingerprint: runtime.lockFingerprint,
    backendReportedRuntimeFingerprint: runtime.reportedFingerprint,
    backendSourceFingerprint: backendSource?.fingerprint ?? null,
    backendContractFingerprint: backendContract.fingerprint,
    modelRevision: compatibilityModel?.modelRevision ?? null,
    modelCommit: compatibilityModel?.selectedRevision ?? null,
    inputArtifactsHash: inputs.hash,
    templateLockHash: template.resolvedTemplateLockHash,
    templateRevisionHash: template.revisionHash,
    mediaHash: firstOutput.decodedSha256 ?? null,
    decodedAudioHash: firstOutput.decodedAudioSha256 ?? null,
    audiovisualMediaHash: firstOutput.audiovisualSha256 ?? null,
    mediaType: firstOutput.mediaType ?? null,
    width: firstOutput.width ?? null,
    height: firstOutput.height ?? null,
    frames: firstOutput.frames ?? null,
    durationSeconds: firstOutput.durationSeconds ?? null,
    sampleRate: firstOutput.sampleRate ?? null,
    channels: firstOutput.channels ?? null,
    template: {
      ...template,
      expectedOutput:
        expectedOutput && typeof expectedOutput === 'object'
          ? {
              ...(Number.isInteger(expectedOutput.width) ? { width: expectedOutput.width } : {}),
              ...(Number.isInteger(expectedOutput.height) ? { height: expectedOutput.height } : {}),
              ...(Number.isInteger(expectedOutput.frames) ? { frames: expectedOutput.frames } : {}),
              ...(expectedOutput.requiresAudio === true ? { requiresAudio: true } : {}),
            }
          : null,
    },
    graph: {
      ...graph,
      executionPlanHash: executionPlan.hash,
      executionPlan: executionPlan.plan,
    },
    execution,
    model: compatibilityModel ?? null,
    models: modelSet,
    inputs,
    runtime: {
      ...runtime,
      backendSource: backendSource ?? null,
      backendContract,
      deterministic,
    },
    output,
  };
  return {
    ...provenance,
    blockers: validateRunProvenance(provenance),
  };
}

function valueAt(root, pathExpression) {
  return pathExpression.split('.').reduce((value, key) => value?.[key], root);
}

export function compareRunProvenance(baseline, candidate) {
  const fields = [
    'schemaVersion',
    'format',
    'template.id',
    'template.promptSettingsHash',
    'template.resolvedTemplateLockHash',
    'template.revisionHash',
    'graph.hash',
    'graph.executionPlanHash',
    'model.repoId',
    'model.selectedRevision',
    'model.modelRevision',
    'model.fingerprint',
    'models.count',
    'models.hash',
    'inputs.count',
    'inputs.hash',
    'runtime.backendSource.fingerprint',
    'runtime.backendContract.fingerprint',
    'runtime.deterministic.fingerprint',
    'output.count',
    'output.collectionHash',
  ];
  const maxOutputs = Math.max(baseline?.output?.items?.length ?? 0, candidate?.output?.items?.length ?? 0);
  for (let index = 0; index < maxOutputs; index += 1) {
    const mediaType =
      baseline?.output?.items?.[index]?.mediaType ?? candidate?.output?.items?.[index]?.mediaType ?? 'image';
    fields.push(`output.items.${index}.decodedSha256`);
    if (baseline?.output?.items?.[index]?.decodedAudioSha256 || candidate?.output?.items?.[index]?.decodedAudioSha256) {
      fields.push(`output.items.${index}.decodedAudioSha256`);
    }
    if (baseline?.output?.items?.[index]?.audiovisualSha256 || candidate?.output?.items?.[index]?.audiovisualSha256) {
      fields.push(`output.items.${index}.audiovisualSha256`);
    }
    if (mediaType === 'audio') {
      fields.push(
        `output.items.${index}.sampleRate`,
        `output.items.${index}.channels`,
        `output.items.${index}.durationSeconds`,
      );
    } else if (mediaType === 'video') {
      fields.push(
        `output.items.${index}.width`,
        `output.items.${index}.height`,
        `output.items.${index}.frames`,
        `output.items.${index}.durationSeconds`,
      );
    } else if (mediaType !== 'json') {
      fields.push(`output.items.${index}.width`, `output.items.${index}.height`);
    }
  }

  const mismatches = fields.flatMap((field) => {
    const expected = valueAt(baseline, field);
    const actual = valueAt(candidate, field);
    return stableStringify(expected) === stableStringify(actual) ? [] : [{ field, expected, actual }];
  });
  const baselineRuntimeLock = runtimeLockFromProvenance(baseline);
  const candidateRuntimeLock = runtimeLockFromProvenance(candidate);
  if (baselineRuntimeLock !== candidateRuntimeLock) {
    mismatches.push({
      field: 'runtime.lockFingerprint',
      expected: baselineRuntimeLock,
      actual: candidateRuntimeLock,
    });
  }
  const baselineBlockers = validateRunProvenance(baseline);
  const candidateBlockers = validateRunProvenance(candidate);
  return {
    matches: mismatches.length === 0,
    candidateExact: mismatches.length === 0 && baselineBlockers.length === 0 && candidateBlockers.length === 0,
    comparedFields: fields.length + 1,
    mismatches,
    baselineBlockers,
    candidateBlockers,
  };
}
