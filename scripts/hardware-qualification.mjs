import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureQualificationStatus } from './release-qualification-policy.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(SCRIPT_DIR, '..');
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(CLIENT_ROOT, '..', 'MoDiff'));
const OUTPUT_PATH = join(BACKEND_ROOT, 'data', 'qualification', 'release', 'hardware-qualification.v1.json');
const ARTIFACT_ROOT = resolve(process.env.MODIFF_LIVE_PROOF_ARTIFACT || '');
const GALLERY_REPORT_PATH = resolve(process.env.MODIFF_GALLERY_REPORT || '');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256File(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])]),
  );
}

function required(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  return path;
}

async function readGalleryEvidence(path) {
  const report = readJson(required(path, 'Gallery report'));
  const output = (report.results ?? [])
    .flatMap((result) => result.outputs ?? [])
    .find((candidate) => candidate?.terminalTask?.status === 'completed' && candidate?.evidence?.provenance);
  if (!output) {
    throw new Error('Gallery report does not contain a completed output with retained provenance.');
  }
  const provenancePath = required(resolve(output.evidence.provenance), 'Gallery run provenance');
  const backendUrl = String(process.env.MODIFF_BACKEND_URL || report.backend?.url || report.server || '').replace(
    /\/$/,
    '',
  );
  if (!backendUrl) throw new Error('Gallery hardware qualification requires a backend URL.');
  const response = await fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Backend health returned HTTP ${response.status}.`);
  const health = await response.json();
  if (output.terminalTask.runtimeFingerprint && health.runtime_fingerprint !== output.terminalTask.runtimeFingerprint) {
    throw new Error('Current backend runtime does not match the completed gallery run.');
  }
  return {
    status: { step: 'success' },
    health,
    provenance: readJson(provenancePath),
    provenancePath,
    websocketEventsPath: output.evidence?.websocketEvents
      ? required(resolve(output.evidence.websocketEvents), 'Gallery websocket evidence')
      : null,
  };
}

async function readQualificationEvidence() {
  if (process.env.MODIFF_GALLERY_REPORT) {
    return readGalleryEvidence(GALLERY_REPORT_PATH);
  }
  if (!process.env.MODIFF_LIVE_PROOF_ARTIFACT) {
    throw new Error(
      'Set MODIFF_LIVE_PROOF_ARTIFACT to a completed live-proof directory or MODIFF_GALLERY_REPORT to a completed gallery report.',
    );
  }
  const statusPath = required(join(ARTIFACT_ROOT, 'status.json'), 'Proof status');
  const healthPath = required(join(ARTIFACT_ROOT, 'backend-health.json'), 'Backend health');
  const provenancePath = required(join(ARTIFACT_ROOT, 'run-provenance.json'), 'Run provenance');
  return {
    status: readJson(statusPath),
    health: readJson(healthPath),
    provenance: readJson(provenancePath),
    provenancePath,
    websocketEventsPath: existsSync(join(ARTIFACT_ROOT, 'websocket-events.json'))
      ? join(ARTIFACT_ROOT, 'websocket-events.json')
      : null,
  };
}

function coldLoaderDurationSeconds(path) {
  if (!path) return null;
  const evidence = readJson(path);
  const loaderEvents = (evidence.events ?? []).filter(
    (event) =>
      event?.type === 'executed' &&
      event?.hasChanged === true &&
      /(?:^|\.)LoadPipeline$/.test(String(event?.name ?? '')),
  );
  if (loaderEvents.length === 0) return null;
  const durations = loaderEvents
    .map((event) => Number(event?.executionTime?.last))
    .filter((value) => Number.isFinite(value));
  return durations.length > 0 ? Math.max(...durations) : null;
}

function coldLoadTarget(modelType, deviceName) {
  if (modelType === 'AceStepAudioPipeline' && /(?:nvidia\s+geforce\s+)?rtx\s*4080/i.test(String(deviceName ?? ''))) {
    return {
      name: 'ACE-Step RTX 4080 cold pipeline load',
      maxSeconds: 120,
      recipe: { dtype: 'bfloat16', offloadMode: 'none', deviceMap: 'cuda' },
    };
  }
  return null;
}

const { status, health, provenance, provenancePath, websocketEventsPath } = await readQualificationEvidence();
if (status.step !== 'success') throw new Error(`Live proof is not complete; current step is ${status.step}.`);
if (health.ready !== true || health.runtime_profile?.execution_ready !== true) {
  throw new Error('Live proof backend did not report an execution-ready managed profile.');
}
if (Number(provenance.schemaVersion) < 2 || (provenance.blockers ?? []).length > 0) {
  throw new Error('Live proof does not contain a complete v2 qualification receipt.');
}

const profileId = health.runtime_profile.installed;
const torch = health.packages?.torch ?? {};
const measuredDevice = String(provenance.execution?.measurement?.device ?? '');
const device = measuredDevice.startsWith('xpu')
  ? (torch.xpu_devices?.[0] ?? {})
  : measuredDevice.startsWith('mps')
    ? (torch.mps_devices?.[0] ?? {})
    : (torch.cuda_devices?.[0] ?? {});
const executionPlan = provenance.graph?.executionPlan ?? {};
const recipeHash =
  provenance.graph?.executionPlanHash ??
  `sha256:execution-plan-v1:${createHash('sha256')
    .update(JSON.stringify(stable(executionPlan)))
    .digest('hex')}`;
const receipt = {
  status: captureQualificationStatus(health.runtime_profile.support_tier),
  profileId,
  supportTierAtCapture: health.runtime_profile.support_tier,
  manifestRevision: health.runtime_profile.manifest_revision,
  platform: health.python?.platform ?? null,
  pythonVersion: String(health.python?.version ?? '').split(' ')[0] || null,
  torchVersion: torch.version ?? null,
  deviceName: device.name ?? torch.cuda_device_name ?? provenance.execution?.measurement?.device ?? null,
  backend: device.backend ?? provenance.execution?.measurement?.backend ?? null,
  vendor: device.vendor ?? null,
  architecture: device.architecture ?? null,
  memoryKind: device.memory_kind ?? null,
  totalMemoryBytes:
    device.total_memory ?? torch.cuda_device_total_memory_bytes ?? torch.cuda_memory_total_bytes ?? null,
  runtimeFingerprint: provenance.runtimeFingerprint,
  modelRevision: provenance.modelRevision,
  modelType: provenance.graph?.executionPlan?.modelType ?? null,
  resourceCandidateId: provenance.execution?.resourceCandidateId ?? null,
  offloadMode: provenance.graph?.executionPlan?.offloadMode ?? null,
  quantizationMode: provenance.graph?.executionPlan?.quantizationMode ?? null,
  recipeHash,
  recipe: executionPlan,
  executionDurationSeconds: provenance.execution?.elapsedSeconds ?? null,
  coldLoaderDurationSeconds: coldLoaderDurationSeconds(websocketEventsPath),
  peakMemoryBytes: provenance.execution?.peakMemoryBytes ?? null,
  outputHash: provenance.mediaHash ?? null,
  taskId: provenance.taskId ?? null,
  capturedAt: provenance.capturedAt ?? null,
  proofPath: relative(dirname(BACKEND_ROOT), provenancePath),
  proofSha256: sha256File(provenancePath),
};
const performanceTarget = coldLoadTarget(receipt.modelType, receipt.deviceName);
if (performanceTarget) {
  if (receipt.coldLoaderDurationSeconds === null) {
    throw new Error(`${performanceTarget.name} qualification is missing cold loader timing evidence.`);
  }
  if (receipt.coldLoaderDurationSeconds > performanceTarget.maxSeconds) {
    throw new Error(
      `${performanceTarget.name} exceeded ${performanceTarget.maxSeconds}s: ${receipt.coldLoaderDurationSeconds.toFixed(2)}s.`,
    );
  }
  receipt.performanceTarget = performanceTarget;
  receipt.performanceQualified = true;
}
for (const field of [
  'profileId',
  'runtimeFingerprint',
  'modelRevision',
  'modelType',
  'resourceCandidateId',
  'executionDurationSeconds',
  'peakMemoryBytes',
  'outputHash',
]) {
  if (receipt[field] === null || receipt[field] === undefined || receipt[field] === '') {
    throw new Error(`Hardware qualification receipt is missing ${field}.`);
  }
}

const previous = existsSync(OUTPUT_PATH)
  ? readJson(OUTPUT_PATH)
  : { schemaVersion: 1, format: 'modiff.hardware-qualification.v1', receipts: [] };
const key = (item) =>
  [
    item.profileId,
    item.platform,
    item.deviceName,
    item.modelType,
    item.resourceCandidateId,
    item.offloadMode,
    item.quantizationMode,
    item.recipeHash,
  ].join('|');
const receipts = [...(previous.receipts ?? []).filter((item) => key(item) !== key(receipt)), receipt].sort(
  (left, right) => key(left).localeCompare(key(right)),
);
writeFileSync(
  OUTPUT_PATH,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      format: 'modiff.hardware-qualification.v1',
      generatedAt: receipt.capturedAt,
      receipts,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Recorded ${profileId} hardware ${receipt.status === 'qualified' ? 'qualification' : 'observation'} from ${
    process.env.MODIFF_GALLERY_REPORT ? GALLERY_REPORT_PATH : ARTIFACT_ROOT
  }.`,
);
