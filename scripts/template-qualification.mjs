import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTemplateRuntime } from './template-gallery-harness.mjs';
import { canonicalWorkflowContract, findCanonicalWorkflowRecord } from './release-contract-core.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(SCRIPT_DIR, '..');
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(CLIENT_ROOT, '..', 'MoDiff'));
const ARTIFACT_ROOT = process.env.MODIFF_LIVE_PROOF_ARTIFACT ? resolve(process.env.MODIFF_LIVE_PROOF_ARTIFACT) : null;
const DIRECT_PROVENANCE_PATH = process.env.MODIFF_TEMPLATE_PROVENANCE
  ? resolve(process.env.MODIFF_TEMPLATE_PROVENANCE)
  : null;
const REGISTRY_PATH = resolve(
  process.env.MODIFF_TEMPLATE_RECEIPT_REGISTRY ||
    join(BACKEND_ROOT, 'data', 'qualification', 'release', 'template-run-receipts.v2.json'),
);
const PROVENANCE_DIR = resolve(
  process.env.MODIFF_TEMPLATE_PROVENANCE_DIR ||
    join(BACKEND_ROOT, 'data', 'qualification', 'release', 'template-provenance'),
);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  return `sha256:${sha256Bytes(readFileSync(path))}`;
}

function required(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  return path;
}

function exactRevision(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^.+@[0-9a-f]{40,64}$/i.test(text) ? text : null;
}

function stableReceiptKey(receipt) {
  return [
    receipt.templateId,
    receipt.runtimeFingerprint,
    receipt.resourceCandidateId,
    receipt.canonicalWorkflowHash,
    receipt.graphHash,
    receipt.outputHash,
  ].join('|');
}

if (!ARTIFACT_ROOT && !DIRECT_PROVENANCE_PATH) {
  throw new Error(
    'Set MODIFF_LIVE_PROOF_ARTIFACT to a completed live-proof artifact directory or MODIFF_TEMPLATE_PROVENANCE to a v2 gallery-run provenance file.',
  );
}

const statusPath = ARTIFACT_ROOT ? required(join(ARTIFACT_ROOT, 'status.json'), 'Proof status') : null;
const provenancePath = DIRECT_PROVENANCE_PATH
  ? required(DIRECT_PROVENANCE_PATH, 'Run provenance')
  : required(join(ARTIFACT_ROOT, 'run-provenance.json'), 'Run provenance');
const status = statusPath ? readJson(statusPath) : { step: 'success', proofMode: 'template' };
const provenance = readJson(provenancePath);
if (status.step !== 'success') {
  throw new Error(`Live proof is not complete; current step is ${String(status.step ?? 'unknown')}.`);
}
if (status.proofMode !== 'template') {
  throw new Error('Only locked template-mode proofs can become template execution receipts.');
}
if (Number(provenance.schemaVersion) < 2 || provenance.format !== 'modiff.live-proof.provenance.v2') {
  throw new Error('Template qualification requires a v2 live-proof provenance record.');
}
if ((provenance.blockers ?? []).length > 0) {
  throw new Error(`Template proof contains blocker(s): ${provenance.blockers.join(' ')}`);
}

const runtime = await loadTemplateRuntime(CLIENT_ROOT);
const templateId = provenance.template?.id ?? status.templateId;
const template = runtime.templates.find((item) => item.id === templateId);
if (!template) throw new Error(`Template ${String(templateId)} is not in the runtime catalog.`);
const workflowManifest = readJson(
  required(join(BACKEND_ROOT, 'data', 'workflow-library-manifest.json'), 'Canonical workflow manifest'),
);
const workflowRecords = (workflowManifest.workflows ?? []).map((manifest) => {
  const graph = readJson(required(join(BACKEND_ROOT, 'data', 'graphs', manifest.graphPath), manifest.id));
  return { manifest, graph };
});
const canonicalWorkflow = findCanonicalWorkflowRecord(workflowRecords, template);
if (!canonicalWorkflow) {
  throw new Error(`Template ${String(templateId)} has no current canonical workflow.`);
}
const canonicalWorkflowHash = canonicalWorkflowContract(canonicalWorkflow.manifest, canonicalWorkflow.graph).graphHash;

const expectedCatalogLock = runtime.templateLockHash(template);
const expectedPromptHash = runtime.promptSettingsHash(template);
if (provenance.template?.catalogTemplateLockHash !== expectedCatalogLock) {
  throw new Error(
    `Template catalog lock is stale: expected ${expectedCatalogLock}, got ${String(
      provenance.template?.catalogTemplateLockHash,
    )}.`,
  );
}
if (provenance.template?.promptSettingsHash !== expectedPromptHash) {
  throw new Error(
    `Template prompt/settings lock is stale: expected ${expectedPromptHash}, got ${String(
      provenance.template?.promptSettingsHash,
    )}.`,
  );
}

const expectedOutput = template.example?.expectedOutput;
const primaryOutput = provenance.output?.items?.[0];
if (expectedOutput && typeof expectedOutput === 'object') {
  if (!primaryOutput || typeof primaryOutput !== 'object') {
    throw new Error('Template output contract cannot be verified because the primary output receipt is missing.');
  }
  for (const field of ['width', 'height', 'frames']) {
    const expected = expectedOutput[field];
    if (Number.isInteger(expected) && expected > 0 && primaryOutput[field] !== expected) {
      throw new Error(
        `Template output contract mismatch for ${field}: expected ${expected}, got ${String(primaryOutput[field])}.`,
      );
    }
  }
  if (expectedOutput.requiresAudio === true && primaryOutput.hasAudio !== true) {
    throw new Error('Template output contract requires embedded audio, but the primary output does not contain it.');
  }
}

const modelRevision = exactRevision(provenance.modelRevision);
const receipt = {
  schemaVersion: 2,
  format: 'modiff.template-run-receipt.v2',
  proofKind: 'real_backend_weights',
  templateId,
  taskId: provenance.taskId,
  capturedAt: provenance.capturedAt,
  catalogTemplateLockHash: expectedCatalogLock,
  resolvedTemplateLockHash: provenance.templateLockHash,
  promptSettingsHash: expectedPromptHash,
  canonicalWorkflowHash,
  graphHash: provenance.graphHash,
  modelRevision,
  runtimeFingerprint: provenance.runtimeFingerprint,
  resourceCandidateId: provenance.execution?.resourceCandidateId ?? null,
  outputHash: provenance.mediaHash,
  executionDurationSeconds: provenance.execution?.elapsedSeconds ?? null,
  peakMemoryBytes: provenance.execution?.peakMemoryBytes ?? null,
  backendSourceFingerprint: provenance.backendSourceFingerprint ?? null,
  backendContractFingerprint: provenance.backendContractFingerprint ?? null,
};

for (const [field, value] of Object.entries({
  taskId: receipt.taskId,
  capturedAt: receipt.capturedAt,
  canonicalWorkflowHash: receipt.canonicalWorkflowHash,
  graphHash: receipt.graphHash,
  modelRevision: receipt.modelRevision,
  runtimeFingerprint: receipt.runtimeFingerprint,
  resourceCandidateId: receipt.resourceCandidateId,
  outputHash: receipt.outputHash,
})) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Template qualification receipt is missing ${field}.`);
  }
}
if (!Number.isFinite(receipt.executionDurationSeconds) || receipt.executionDurationSeconds < 0) {
  throw new Error('Template qualification receipt is missing executionDurationSeconds.');
}
if (!Number.isInteger(receipt.peakMemoryBytes) || receipt.peakMemoryBytes <= 0) {
  throw new Error('Template qualification receipt is missing peakMemoryBytes.');
}

mkdirSync(PROVENANCE_DIR, { recursive: true });
const provenanceBytes = readFileSync(provenancePath);
const provenanceDigest = sha256Bytes(provenanceBytes);
const retainedName = `${templateId}.${provenanceDigest.slice(0, 16)}.json`;
const retainedPath = join(PROVENANCE_DIR, retainedName);
copyFileSync(provenancePath, retainedPath);
const retainedProofPath = join('data', 'qualification', 'release', 'template-provenance', retainedName);
const retainedReceipt = {
  ...receipt,
  proofPath: retainedProofPath,
  proofSha256: sha256File(retainedPath),
  sourceArtifact: ARTIFACT_ROOT ? basename(ARTIFACT_ROOT) : relative(CLIENT_ROOT, provenancePath),
};

const previous = existsSync(REGISTRY_PATH)
  ? readJson(REGISTRY_PATH)
  : {
      schemaVersion: 2,
      format: 'modiff.template-run-receipt-registry.v2',
      receipts: [],
    };
const receipts = [
  ...(previous.receipts ?? []).filter((candidate) => stableReceiptKey(candidate) !== stableReceiptKey(retainedReceipt)),
  retainedReceipt,
].sort((left, right) => {
  const templateOrder = String(left.templateId).localeCompare(String(right.templateId));
  return (
    templateOrder ||
    String(left.capturedAt).localeCompare(String(right.capturedAt)) ||
    stableReceiptKey(left).localeCompare(stableReceiptKey(right))
  );
});
mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
writeFileSync(
  REGISTRY_PATH,
  `${JSON.stringify(
    {
      schemaVersion: 2,
      format: 'modiff.template-run-receipt-registry.v2',
      generatedAt: retainedReceipt.capturedAt,
      receipts,
    },
    null,
    2,
  )}\n`,
);
console.log(`Recorded locked-template execution receipt for ${templateId}.`);
