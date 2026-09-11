import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exactCurrentResourceRouteFromManifest, loadCurrentResourceRouteManifest } from './current-resource-routes.mjs';
import { validateRunProvenance } from './live-proof-provenance.mjs';
import {
  exactRouteModelSetWasExecuted,
  resourceRecipeFromProvenance,
  resourceRecipeHash,
  resourceWorkloadHash,
} from './resource-qualification.mjs';
import { normalizeResourceRouteBinding, resourceRouteBindingHash } from './resource-route-binding.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_PATH);
const CLIENT_ROOT = resolve(SCRIPT_DIR, '..');
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(CLIENT_ROOT, '..', 'MoDiff'));
const REGISTRY_PATH = resolve(
  process.env.MODIFF_ROUTE_RESOURCE_RECEIPT_REGISTRY ||
    join(BACKEND_ROOT, 'data', 'qualification', 'release', 'route-resource-workload-receipts.v1.json'),
);
const PROVENANCE_DIR = resolve(
  process.env.MODIFF_ROUTE_RESOURCE_PROVENANCE_DIR ||
    join(BACKEND_ROOT, 'data', 'qualification', 'release', 'route-resource-provenance'),
);
const RECEIPT_HASH_PREFIX = 'sha256:route-resource-workload-receipt-v1:';
const MODEL_SET_HASH = /^sha256:model-set-v1:[a-f0-9]{64}$/u;
const RECEIPT_FIELDS = [
  'schemaVersion',
  'format',
  'proofKind',
  'familyCoverageDeclared',
  'publicationAuthority',
  'autoAuthority',
  'routeBinding',
  'routeBindingHash',
  'workloadHash',
  'recipe',
  'recipeHash',
  'modelSetHash',
  'runtimeContract',
  'proofs',
  'receiptHash',
];
const PROOF_RECEIPT_FIELDS = [
  'taskId',
  'capturedAt',
  'graphHash',
  'outputHash',
  'outputCollectionHash',
  'executionDurationSeconds',
  'peakMemoryBytes',
  'peakReservedBytes',
  'processRssBytes',
  'backend',
  'device',
  'proofPath',
  'proofSha256',
];
const RUNTIME_CONTRACT_FIELDS = [
  'runtimeFingerprint',
  'runtimeLockFingerprint',
  'backendSourceFingerprint',
  'backendContractFingerprint',
  'deterministicFingerprint',
];

function exactKeys(value, keys) {
  return (
    Boolean(value && typeof value === 'object' && !Array.isArray(value)) &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
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

function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

function sha256File(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Route resource proof is missing ${label}.`);
  return value;
}

function runtimeContract(proof) {
  const contract = {
    runtimeFingerprint: nonEmpty(proof?.runtimeFingerprint, 'runtimeFingerprint'),
    runtimeLockFingerprint: nonEmpty(proof?.runtime?.lockFingerprint, 'runtime.lockFingerprint'),
    backendSourceFingerprint: nonEmpty(proof?.runtime?.backendSource?.fingerprint, 'runtime.backendSource.fingerprint'),
    backendContractFingerprint: nonEmpty(
      proof?.runtime?.backendContract?.fingerprint,
      'runtime.backendContract.fingerprint',
    ),
    deterministicFingerprint: nonEmpty(proof?.runtime?.deterministic?.fingerprint, 'runtime.deterministic.fingerprint'),
  };
  if (
    contract.runtimeFingerprint !== contract.runtimeLockFingerprint ||
    (proof?.backendSourceFingerprint !== undefined &&
      proof.backendSourceFingerprint !== contract.backendSourceFingerprint) ||
    (proof?.backendContractFingerprint !== undefined &&
      proof.backendContractFingerprint !== contract.backendContractFingerprint)
  ) {
    throw new Error('Route resource proof contains inconsistent runtime/backend contract fingerprints.');
  }
  return contract;
}

function outputHash(proof) {
  return nonEmpty(proof?.mediaHash ?? proof?.output?.items?.[0]?.decodedSha256, 'measured output hash');
}

function validateMeasuredEvidence(proof) {
  if (!Number.isFinite(proof?.execution?.elapsedSeconds) || proof.execution.elapsedSeconds <= 0) {
    throw new Error('Route resource proof requires a positive measured execution duration.');
  }
  if (!Number.isInteger(proof?.execution?.peakMemoryBytes) || proof.execution.peakMemoryBytes <= 0) {
    throw new Error('Route resource proof requires positive measured peak memory.');
  }
  if (!Array.isArray(proof?.output?.items) || proof.output.items.length === 0) {
    throw new Error('Route resource proof requires a non-empty measured output collection.');
  }
  proof.output.items.forEach((item) => nonEmpty(item?.decodedSha256, 'decoded output item hash'));
  nonEmpty(proof?.output?.collectionHash, 'output collection hash');
  nonEmpty(proof?.execution?.measurement?.backend, 'measurement backend');
  nonEmpty(proof?.execution?.measurement?.device, 'measurement device');
}

function validateOneRouteProof(proof, currentRoute) {
  if (Number(proof?.schemaVersion) < 2 || proof?.format !== 'modiff.live-proof.provenance.v2') {
    throw new Error('Route resource qualification requires current v2 live-proof provenance.');
  }
  const blockers = [...new Set([...(proof?.blockers ?? []), ...validateRunProvenance(proof)])];
  if (blockers.length > 0) throw new Error(`Route resource proof contains blocker(s): ${blockers.join(' ')}`);
  const routeBinding = normalizeResourceRouteBinding(proof?.routeBinding);
  const routeBindingHash = resourceRouteBindingHash(routeBinding);
  if (
    proof?.routeBindingHash !== routeBindingHash ||
    currentRoute.routeBindingHash !== routeBindingHash ||
    canonicalJson(currentRoute.routeBinding) !== canonicalJson(routeBinding)
  ) {
    throw new Error('Route resource proof does not match the exact current registered BlockDefinitionV2 route.');
  }
  if (!exactRouteModelSetWasExecuted(proof, routeBinding)) {
    throw new Error('Route resource proof does not contain the complete exact route artifact/dependency model set.');
  }
  const modelSetHash = proof?.models?.hash;
  if (!MODEL_SET_HASH.test(String(modelSetHash ?? '')) || !Array.isArray(proof?.models?.items)) {
    throw new Error('Route resource proof requires a complete hash-locked model set.');
  }
  const recipe = resourceRecipeFromProvenance(proof);
  if (
    recipe.modelType !== currentRoute.definition.pipelineClass ||
    typeof recipe.pipelineClass !== 'string' ||
    !recipe.pipelineClass ||
    typeof recipe.executionPath !== 'string' ||
    !recipe.executionPath ||
    typeof recipe.dtype !== 'string' ||
    !recipe.dtype ||
    typeof recipe.device !== 'string' ||
    !recipe.device
  ) {
    throw new Error('Route resource proof execution plan does not match the current route model and exact recipe.');
  }
  if (recipe.offloadMode !== 'none' && recipe.autoOffload !== true) {
    throw new Error('An offloaded route resource proof must record autoOffload=true.');
  }
  validateMeasuredEvidence(proof);
  const capturedAt = nonEmpty(proof.capturedAt, 'capturedAt');
  const capturedDate = new Date(capturedAt);
  if (!Number.isFinite(capturedDate.valueOf()) || capturedDate.toISOString() !== capturedAt) {
    throw new Error('Route resource proof capturedAt is invalid.');
  }
  return {
    proof,
    taskId: nonEmpty(proof.taskId, 'taskId'),
    capturedAt,
    graphHash: nonEmpty(proof.graphHash ?? proof?.graph?.hash, 'graphHash'),
    routeBinding,
    routeBindingHash,
    workloadHash: resourceWorkloadHash(proof),
    recipe,
    recipeHash: resourceRecipeHash(recipe),
    modelSetHash,
    runtimeContract: runtimeContract(proof),
    outputHash: outputHash(proof),
    outputCollectionHash: proof.output.collectionHash,
  };
}

/** Validate two independent retained runs before creating route evidence. */
export function validateRouteResourceQualificationPair({ proofs, currentRoute }) {
  if (!Array.isArray(proofs) || proofs.length !== 2) {
    throw new Error('Route resource qualification requires exactly two retained current-V2 live proofs.');
  }
  const checked = proofs.map((proof) => validateOneRouteProof(proof, currentRoute));
  if (checked[0].taskId === checked[1].taskId) {
    throw new Error('Route resource qualification requires two distinct backend task IDs.');
  }
  if (checked[0].capturedAt === checked[1].capturedAt) {
    throw new Error('Route resource qualification requires two independently captured runs.');
  }
  for (const [field, label] of [
    ['routeBindingHash', 'route binding'],
    ['workloadHash', 'canonical workload'],
    ['recipeHash', 'resource recipe'],
    ['modelSetHash', 'complete model set'],
  ]) {
    if (checked[0][field] !== checked[1][field]) {
      throw new Error(`Route resource proofs do not share the same ${label}.`);
    }
  }
  if (canonicalJson(checked[0].runtimeContract) !== canonicalJson(checked[1].runtimeContract)) {
    throw new Error('Route resource proofs do not share the same runtime/backend/deterministic contracts.');
  }
  return {
    routeBinding: checked[0].routeBinding,
    routeBindingHash: checked[0].routeBindingHash,
    workloadHash: checked[0].workloadHash,
    recipe: checked[0].recipe,
    recipeHash: checked[0].recipeHash,
    modelSetHash: checked[0].modelSetHash,
    runtimeContract: checked[0].runtimeContract,
    checked,
  };
}

function receiptHash(receipt) {
  const body = Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'receiptHash'));
  return `${RECEIPT_HASH_PREFIX}${createHash('sha256').update(canonicalJson(body)).digest('hex')}`;
}

function receiptKey(receipt) {
  // One reviewed canonical workload owns the current resource baseline for a
  // route/recipe. A later real two-proof pair replaces it; parallel workloads
  // must not silently create competing authorization records.
  return [receipt.routeBindingHash, receipt.recipeHash].join('|');
}

export function retainedRouteResourceProofs({ receipt, backendRoot = BACKEND_ROOT }) {
  if (!Array.isArray(receipt?.proofs) || receipt.proofs.length !== 2) {
    throw new Error('Route resource workload receipt must reference exactly two retained proofs.');
  }
  return receipt.proofs.map((proofReceipt) => {
    const proofRelativePath = String(proofReceipt?.proofPath ?? '').replaceAll('\\', '/');
    if (
      !proofRelativePath.startsWith('data/qualification/release/route-resource-provenance/') ||
      proofRelativePath.split('/').includes('..')
    ) {
      throw new Error(`Route resource qualification proof path is outside its retained lane: ${proofRelativePath}`);
    }
    const proofPath = resolve(backendRoot, proofRelativePath);
    if (!existsSync(proofPath)) {
      throw new Error(`Route resource qualification proof is missing: ${proofRelativePath}`);
    }
    if (sha256File(proofPath) !== proofReceipt.proofSha256) {
      throw new Error(`Route resource qualification proof hash mismatch: ${proofRelativePath}`);
    }
    return readJson(proofPath);
  });
}

export function validateRouteResourceWorkloadReceipt({ receipt, proofs, currentRoute }) {
  const validated = validateRouteResourceQualificationPair({ proofs, currentRoute });
  if (
    !exactKeys(receipt, RECEIPT_FIELDS) ||
    receipt?.schemaVersion !== 1 ||
    receipt?.format !== 'modiff.route-resource-workload-receipt.v1' ||
    receipt?.proofKind !== 'two_distinct_current_v2_live_proofs' ||
    receipt?.familyCoverageDeclared !== false ||
    receipt?.publicationAuthority !== false ||
    receipt?.autoAuthority !== false ||
    receipt?.routeBindingHash !== validated.routeBindingHash ||
    canonicalJson(receipt?.routeBinding) !== canonicalJson(validated.routeBinding) ||
    receipt?.workloadHash !== validated.workloadHash ||
    receipt?.recipeHash !== validated.recipeHash ||
    canonicalJson(receipt?.recipe) !== canonicalJson(validated.recipe) ||
    receipt?.modelSetHash !== validated.modelSetHash ||
    canonicalJson(receipt?.runtimeContract) !== canonicalJson(validated.runtimeContract) ||
    !Array.isArray(receipt?.proofs) ||
    receipt.proofs.length !== 2 ||
    receipt?.receiptHash !== receiptHash(receipt)
  ) {
    throw new Error('Route resource workload receipt is malformed, stale, or grants unsupported authority.');
  }
  if (!exactKeys(receipt.runtimeContract, RUNTIME_CONTRACT_FIELDS)) {
    throw new Error('Route resource workload receipt runtime contract is malformed.');
  }
  receipt.proofs.forEach((proofReceipt, index) => {
    const proof = validated.checked[index];
    if (
      !exactKeys(proofReceipt, PROOF_RECEIPT_FIELDS) ||
      proofReceipt?.taskId !== proof.taskId ||
      proofReceipt?.capturedAt !== proof.capturedAt ||
      proofReceipt?.graphHash !== proof.graphHash ||
      proofReceipt?.outputHash !== proof.outputHash ||
      proofReceipt?.outputCollectionHash !== proof.outputCollectionHash ||
      proofReceipt?.executionDurationSeconds !== proof.proof.execution.elapsedSeconds ||
      proofReceipt?.peakMemoryBytes !== proof.proof.execution.peakMemoryBytes ||
      proofReceipt?.peakReservedBytes !== (proof.proof.execution?.measurement?.peakReservedBytes ?? null) ||
      proofReceipt?.processRssBytes !== (proof.proof.execution?.measurement?.processRssBytes ?? null) ||
      proofReceipt?.backend !== proof.proof.execution.measurement.backend ||
      proofReceipt?.device !== proof.proof.execution.measurement.device ||
      typeof proofReceipt?.proofPath !== 'string' ||
      !proofReceipt.proofPath ||
      typeof proofReceipt?.proofSha256 !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/u.test(proofReceipt.proofSha256)
    ) {
      throw new Error('Route resource workload receipt does not match both retained proof measurements.');
    }
  });
  return validated;
}

export async function recordRouteResourceQualification({
  provenancePaths,
  registryPath = REGISTRY_PATH,
  provenanceDir = PROVENANCE_DIR,
  backendRoot = BACKEND_ROOT,
  currentRouteManifest,
  currentRouteManifestPath,
} = {}) {
  if (!Array.isArray(provenancePaths) || provenancePaths.length !== 2) {
    throw new Error('Pass exactly two provenance paths to route resource qualification.');
  }
  const sourcePaths = provenancePaths.map((path) => resolve(path));
  sourcePaths.forEach((path) => {
    if (!existsSync(path)) throw new Error(`Route resource provenance is missing: ${path}`);
  });
  const proofs = sourcePaths.map(readJson);
  const manifest = currentRouteManifest ?? loadCurrentResourceRouteManifest({ manifestPath: currentRouteManifestPath });
  const currentRoute = exactCurrentResourceRouteFromManifest(proofs[0]?.routeBinding, manifest);
  const validated = validateRouteResourceQualificationPair({ proofs, currentRoute });
  mkdirSync(provenanceDir, { recursive: true });
  const proofReceipts = sourcePaths.map((sourcePath, index) => {
    const proof = proofs[index];
    const digest = sha256File(sourcePath);
    const retainedName = `${validated.routeBinding.admissionId
      .replaceAll(/[^A-Za-z0-9._-]/gu, '_')
      .slice(-96)}.${proof.taskId.replaceAll(/[^A-Za-z0-9._-]/gu, '_').slice(0, 64)}.${digest.slice(7, 23)}.json`;
    const retainedPath = join(provenanceDir, retainedName);
    copyFileSync(sourcePath, retainedPath);
    return {
      taskId: proof.taskId,
      capturedAt: proof.capturedAt,
      graphHash: proof.graphHash ?? proof.graph.hash,
      outputHash: outputHash(proof),
      outputCollectionHash: proof.output.collectionHash,
      executionDurationSeconds: proof.execution.elapsedSeconds,
      peakMemoryBytes: proof.execution.peakMemoryBytes,
      peakReservedBytes: proof.execution?.measurement?.peakReservedBytes ?? null,
      processRssBytes: proof.execution?.measurement?.processRssBytes ?? null,
      backend: proof.execution.measurement.backend,
      device: proof.execution.measurement.device,
      proofPath: relative(backendRoot, retainedPath).replaceAll('\\', '/'),
      proofSha256: sha256File(retainedPath),
    };
  });
  const body = {
    schemaVersion: 1,
    format: 'modiff.route-resource-workload-receipt.v1',
    proofKind: 'two_distinct_current_v2_live_proofs',
    familyCoverageDeclared: false,
    publicationAuthority: false,
    autoAuthority: false,
    routeBinding: validated.routeBinding,
    routeBindingHash: validated.routeBindingHash,
    workloadHash: validated.workloadHash,
    recipe: validated.recipe,
    recipeHash: validated.recipeHash,
    modelSetHash: validated.modelSetHash,
    runtimeContract: validated.runtimeContract,
    proofs: proofReceipts,
  };
  const receipt = { ...body, receiptHash: receiptHash(body) };
  validateRouteResourceWorkloadReceipt({
    receipt,
    proofs: retainedRouteResourceProofs({ receipt, backendRoot }),
    currentRoute,
  });
  const previous = existsSync(registryPath)
    ? readJson(registryPath)
    : { schemaVersion: 1, format: 'modiff.route-resource-workload-receipt-registry.v1', receipts: [] };
  if (
    previous?.schemaVersion !== 1 ||
    previous?.format !== 'modiff.route-resource-workload-receipt-registry.v1' ||
    !Array.isArray(previous?.receipts)
  ) {
    throw new Error('Route resource workload receipt registry is malformed.');
  }
  for (const candidate of previous.receipts) {
    const candidateRoute = exactCurrentResourceRouteFromManifest(candidate?.routeBinding, manifest);
    validateRouteResourceWorkloadReceipt({
      receipt: candidate,
      proofs: retainedRouteResourceProofs({ receipt: candidate, backendRoot }),
      currentRoute: candidateRoute,
    });
  }
  const receipts = [
    ...previous.receipts.filter((candidate) => receiptKey(candidate) !== receiptKey(receipt)),
    receipt,
  ].sort((left, right) => receiptKey(left).localeCompare(receiptKey(right)));
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(
    registryPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        format: 'modiff.route-resource-workload-receipt-registry.v1',
        generatedAt: [...proofs.map((proof) => proof.capturedAt)].sort().at(-1),
        receipts,
      },
      null,
      2,
    )}\n`,
  );
  return receipt;
}

async function main() {
  const provenancePaths = [
    process.env.MODIFF_ROUTE_RESOURCE_PROVENANCE_A,
    process.env.MODIFF_ROUTE_RESOURCE_PROVENANCE_B,
  ].filter(Boolean);
  if (provenancePaths.length !== 2) {
    throw new Error(
      'Set MODIFF_ROUTE_RESOURCE_PROVENANCE_A and MODIFF_ROUTE_RESOURCE_PROVENANCE_B to two completed V2 proofs.',
    );
  }
  const receipt = await recordRouteResourceQualification({ provenancePaths });
  console.log(
    `Recorded two-proof exact-route resource workload for ${receipt.routeBinding.admissionId}: ${receipt.recipe.modelType} ${receipt.recipe.dtype} ${receipt.recipe.offloadMode} ${receipt.recipe.quantizationMode}.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) await main();
