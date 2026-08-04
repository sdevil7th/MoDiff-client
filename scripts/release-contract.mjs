import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { buildBackendInstallerPackageSet } from './backend-installer-contract.mjs';
import { assertBackendNodeKeys, readBundledBackendNodeRegistry } from './backend-node-registry.mjs';
import {
  assessHistoricalEvidence,
  canonicalWorkflowContract,
  findCanonicalWorkflowRecord,
} from './release-contract-core.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(SCRIPT_DIR, '..');
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(CLIENT_ROOT, '..', 'MoDiff'));
const OUTPUT_PATH = join(BACKEND_ROOT, 'data', 'release-contract.v1.json');
const TEMPLATE_RECEIPT_REGISTRY_PATH = join(
  BACKEND_ROOT,
  'data',
  'qualification',
  'release',
  'template-run-receipts.v2.json',
);
const CHECK = process.argv.includes('--check');

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
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function digestBytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function digestFile(path) {
  return digestBytes(readFileSync(path));
}

function contractHash(namespace, value) {
  return `sha256:${namespace}:${digestBytes(JSON.stringify(stable(value)))}`;
}

function exactRevision(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^.+@[0-9a-f]{40,64}$/i.test(text) ? text : null;
}

function findProofRuns(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (
    typeof value.taskId === 'string' &&
    value.graph &&
    typeof value.graph === 'object' &&
    value.graph.canonicalGraph
  ) {
    found.push(value);
  }
  for (const child of Object.values(value)) findProofRuns(child, found);
  return found;
}

function readLatestProof(entry) {
  if (!entry?.provenancePath) return null;
  const path = join(CLIENT_ROOT, 'public', String(entry.provenancePath).replace(/^\/+/, ''));
  if (!existsSync(path)) return null;
  const provenance = readJson(path);
  return (
    findProofRuns(provenance)
      .sort((left, right) => String(left.capturedAt ?? '').localeCompare(String(right.capturedAt ?? '')))
      .at(-1) ?? null
  );
}

function proofBackendNodes(proof) {
  const nodes = proof?.graph?.canonicalGraph?.nodes;
  if (!Array.isArray(nodes)) return [];
  return [
    ...new Set(nodes.map((node) => `${node.module}.${node.action}`).filter((value) => !value.includes('undefined'))),
  ].sort();
}

function templateInputs(template, origin) {
  return (template.inputBindings ?? [])
    .filter((binding) => binding.origin === origin)
    .map((binding) => stable(binding))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function requiredArtifacts(template, profile, artifactCatalogEntry) {
  const artifacts = [];
  const baseRevision = exactRevision(template.example?.modelRevision);
  if (baseRevision) {
    const at = baseRevision.lastIndexOf('@');
    artifacts.push({ role: 'model', repo: baseRevision.slice(0, at), revision: baseRevision.slice(at + 1) });
  } else if (artifactCatalogEntry?.baseRepo && artifactCatalogEntry?.baseRevision) {
    artifacts.push({
      role: 'model',
      repo: artifactCatalogEntry.baseRepo,
      revision: artifactCatalogEntry.baseRevision,
    });
  } else {
    artifacts.push({ role: 'model', repo: profile.defaultRepo, revision: null });
  }
  const lora = template.workflowBlockSettings?.lora;
  if (lora?.model?.value) {
    artifacts.push({
      role: 'lora',
      source: lora.model.source,
      repo: lora.model.source === 'hub' ? lora.model.value : null,
      path: lora.model.source === 'local' ? lora.model.value : null,
      revision: lora.model.revision ?? null,
      sha256: lora.model.sha256 ? `sha256:${lora.model.sha256}` : null,
      byteSize: lora.model.byteSize ?? null,
      userSupplied: template.evidencePolicy === 'user_supplied',
    });
  }
  return artifacts;
}

function outputContract(template) {
  return {
    mediaKinds: template.outputKinds ?? [template.example?.mediaType ?? 'unknown'],
    expected: template.example?.expectedOutput ?? {},
    mediaSlots: template.mediaSlots ?? [],
  };
}

function resourceContract(profile, template) {
  const locked = template.example?.lockedSettings ?? {};
  return {
    supportedOffloadModes: profile.offloadSupport.modes,
    declaredRecipes: [
      {
        id: 'resident',
        dtype: profile.defaultDtype,
        quantizationMode: 'none',
        autoOffload: false,
        offloadMode: 'none',
      },
      {
        id: 'profile-default',
        dtype: profile.defaultDtype,
        quantizationMode: 'none',
        autoOffload: profile.offloadSupport.default !== 'none',
        offloadMode: profile.offloadSupport.default,
      },
      {
        id: 'low-memory',
        dtype: profile.lowVram.dtype,
        quantizationMode: profile.lowVram.quantizationMode ?? 'none',
        autoOffload: profile.lowVram.autoOffload,
        offloadMode: profile.lowVram.offloadMode ?? profile.offloadSupport.lowVram,
      },
    ],
    templateDefaults: {
      resourceMode: locked.resourceMode ?? 'auto',
      dtype: locked.dtype ?? profile.defaultDtype,
      quantizationMode: locked.quantizationMode ?? 'none',
      autoOffload: locked.autoOffload ?? profile.lowVram.autoOffload,
      offloadMode: locked.offloadMode ?? profile.offloadSupport.default,
    },
    proofPolicy: 'A recipe is runnable only when the live Auto planner returns a ready proof for the current runtime.',
  };
}

const QUALIFICATION_RECEIPT_FIELDS = [
  'templateId',
  'graphHash',
  'modelRevision',
  'runtimeFingerprint',
  'resourceCandidateId',
  'outputHash',
  'executionDurationSeconds',
  'peakMemoryBytes',
];

function receiptMissingFields(value) {
  if (!value) return [...QUALIFICATION_RECEIPT_FIELDS];
  return QUALIFICATION_RECEIPT_FIELDS.filter((field) => {
    const candidate = value[field];
    if (field === 'executionDurationSeconds') return !Number.isFinite(candidate) || candidate < 0;
    if (field === 'peakMemoryBytes') return !Number.isInteger(candidate) || candidate <= 0;
    return typeof candidate !== 'string' || !candidate.trim();
  });
}

function receipt(templateId, entry, proof) {
  if (!entry || !proof || !String(proof.format ?? '').startsWith('modiff.live-proof.')) return null;
  const proofGraphHash = proof.graphHash ?? proof.graph?.hash ?? null;
  if (entry.graphHash && proofGraphHash && entry.graphHash !== proofGraphHash) return null;
  return {
    templateId,
    proofKind: 'real_backend_weights',
    proofFormat: proof.format,
    taskId: proof.taskId,
    capturedAt: proof.capturedAt ?? entry.verificationTimestamp ?? null,
    graphHash: proofGraphHash ?? entry.graphHash ?? null,
    canonicalWorkflowHash: entry.canonicalWorkflowHash ?? proof.canonicalWorkflowHash ?? null,
    backendNodes: proofBackendNodes(proof),
    catalogTemplateLockHash: proof.template?.catalogTemplateLockHash ?? null,
    promptSettingsHash: proof.template?.promptSettingsHash ?? null,
    modelRevision: exactRevision(entry.modelRevision ?? proof.modelRevision),
    runtimeFingerprint: entry.runtimeFingerprint ?? proof.runtimeFingerprint ?? null,
    backendSourceFingerprint: entry.backendSourceFingerprint ?? proof.backendSourceFingerprint ?? null,
    backendContractFingerprint: entry.backendContractFingerprint ?? proof.backendContractFingerprint ?? null,
    mediaHash: entry.mediaHash ?? proof.mediaHash ?? null,
    outputHash: entry.mediaHash ?? proof.mediaHash ?? null,
    outputPath: entry.outputPath ?? null,
    outputDurationSeconds: entry.durationSeconds ?? proof.output?.durationSeconds ?? null,
    executionDurationSeconds: proof.execution?.elapsedSeconds ?? null,
    resourceCandidateId:
      proof.execution?.resourceCandidateId ?? proof.graph?.executionPlan?.autoResourceCandidateId ?? null,
    peakMemoryBytes:
      proof.execution?.peakMemoryBytes ??
      proof.runtime?.payload?.torch?.cuda_max_memory_allocated_bytes ??
      proof.runtime?.payload?.torch?.cuda_peak_allocated_bytes ??
      null,
    verificationStatus: entry.verificationStatus ?? null,
    qualityReviewStatus: entry.qualityReviewStatus ?? null,
    provenancePath: entry.provenancePath,
    provenanceHash: entry.provenanceHash,
  };
}

function readTemplateReceiptRegistry() {
  if (!existsSync(TEMPLATE_RECEIPT_REGISTRY_PATH)) return [];
  const registry = readJson(TEMPLATE_RECEIPT_REGISTRY_PATH);
  if (
    Number(registry.schemaVersion) !== 2 ||
    registry.format !== 'modiff.template-run-receipt-registry.v2' ||
    !Array.isArray(registry.receipts)
  ) {
    throw new Error('Template qualification receipt registry has an invalid schema.');
  }
  return registry.receipts;
}

function verifiedDirectReceipt(value) {
  if (!value || value.format !== 'modiff.template-run-receipt.v2') return null;
  const proofPath = resolve(BACKEND_ROOT, String(value.proofPath ?? ''));
  if (
    proofPath !== BACKEND_ROOT &&
    !proofPath.startsWith(`${BACKEND_ROOT}${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    throw new Error(`Template qualification provenance path escapes the backend root: ${proofPath}`);
  }
  if (!existsSync(proofPath)) {
    throw new Error(`Template qualification provenance is missing: ${String(value.proofPath)}`);
  }
  if (`sha256:${digestFile(proofPath)}` !== value.proofSha256) {
    throw new Error(`Template qualification provenance hash mismatch: ${String(value.proofPath)}`);
  }
  const proof = readJson(proofPath);
  const candidate = {
    templateId: value.templateId,
    proofKind: value.proofKind,
    proofFormat: proof.format,
    taskId: value.taskId,
    capturedAt: value.capturedAt,
    graphHash: value.graphHash,
    modelRevision: exactRevision(value.modelRevision),
    runtimeFingerprint: value.runtimeFingerprint,
    backendSourceFingerprint: value.backendSourceFingerprint,
    backendContractFingerprint: value.backendContractFingerprint,
    mediaHash: value.outputHash,
    outputHash: value.outputHash,
    executionDurationSeconds: value.executionDurationSeconds,
    resourceCandidateId: value.resourceCandidateId,
    peakMemoryBytes: value.peakMemoryBytes,
    provenancePath: value.proofPath,
    provenanceHash: value.proofSha256,
    catalogTemplateLockHash: value.catalogTemplateLockHash,
    promptSettingsHash: value.promptSettingsHash,
    canonicalWorkflowHash: value.canonicalWorkflowHash ?? null,
    backendNodes: proofBackendNodes(proof),
  };
  const mismatches = [
    ['templateId', proof.template?.id, candidate.templateId],
    ['graphHash', proof.graphHash, candidate.graphHash],
    ['modelRevision', proof.modelRevision, candidate.modelRevision],
    ['runtimeFingerprint', proof.runtimeFingerprint, candidate.runtimeFingerprint],
    ['resourceCandidateId', proof.execution?.resourceCandidateId, candidate.resourceCandidateId],
    ['outputHash', proof.mediaHash, candidate.outputHash],
    ['executionDurationSeconds', proof.execution?.elapsedSeconds, candidate.executionDurationSeconds],
    ['peakMemoryBytes', proof.execution?.peakMemoryBytes, candidate.peakMemoryBytes],
  ].filter(([, proofValue, receiptValue]) => proofValue !== receiptValue);
  if (mismatches.length > 0 || receiptMissingFields(candidate).length > 0) {
    throw new Error(
      `Template qualification receipt ${String(value.templateId)} does not match retained provenance: ${mismatches
        .map(([field]) => field)
        .join(', ')}`,
    );
  }
  return candidate;
}

const gallery = readJson(join(CLIENT_ROOT, 'public', 'template-gallery', 'manifest.json'));
const workflowManifest = readJson(join(BACKEND_ROOT, 'data', 'workflow-library-manifest.json'));
const artifactCatalog = readJson(join(BACKEND_ROOT, 'data', 'model-artifact-catalog.json'));
const galleryByTemplate = new Map(gallery.examples.map((entry) => [entry.templateId, entry]));
const artifactByModel = new Map(artifactCatalog.models.map((entry) => [entry.modelType, entry]));
const directReceipts = readTemplateReceiptRegistry().map(verifiedDirectReceipt).filter(Boolean);
const directReceiptsByTemplate = new Map();
for (const directReceipt of directReceipts) {
  const candidates = directReceiptsByTemplate.get(directReceipt.templateId) ?? [];
  candidates.push(directReceipt);
  candidates.sort((left, right) => String(left.capturedAt ?? '').localeCompare(String(right.capturedAt ?? '')));
  directReceiptsByTemplate.set(directReceipt.templateId, candidates);
}
const workflowRecords = workflowManifest.workflows.map((workflow) => {
  const graphPath = join(BACKEND_ROOT, 'data', 'graphs', workflow.graphPath);
  const graph = readJson(graphPath);
  return { manifest: workflow, graph, contract: canonicalWorkflowContract(workflow, graph) };
});
const vite = await createServer({
  root: CLIENT_ROOT,
  appType: 'custom',
  server: { middlewareMode: true },
});

try {
  const { STUDIO_TEMPLATES } = await vite.ssrLoadModule('/src/studio/templates.ts');
  const { STUDIO_MODEL_PROFILES } = await vite.ssrLoadModule('/src/studio/modelProfiles.ts');
  const { templateBackendNodeKeys } = await vite.ssrLoadModule('/src/studio/templateBackendCapabilities.ts');
  const { getPromptSettingsHash, getTemplateLockHash, getTemplateLockedSettings } = await vite.ssrLoadModule(
    '/src/studio/templateExactness.ts',
  );
  const backendNodeRegistry = readBundledBackendNodeRegistry(BACKEND_ROOT);
  for (const workflow of workflowRecords) {
    assertBackendNodeKeys(workflow.contract.backendNodes, backendNodeRegistry, workflow.manifest.id);
  }
  const packageSet = buildBackendInstallerPackageSet(BACKEND_ROOT);
  packageSet.contractHash = contractHash('package-set-v2', packageSet);

  const templates = STUDIO_TEMPLATES.map((template) => {
    const profile = STUDIO_MODEL_PROFILES[template.modelType];
    const artifactCatalogEntry = artifactByModel.get(template.modelType);
    const galleryEntry = galleryByTemplate.get(template.id);
    const proof = readLatestProof(galleryEntry);
    const workflow = findCanonicalWorkflowRecord(workflowRecords, template);
    const schema = {
      id: template.id,
      mode: template.mode,
      modelType: template.modelType,
      inputBindings: template.inputBindings ?? [],
      outputKinds: template.outputKinds ?? [],
      mediaSlots: template.mediaSlots ?? [],
      requiredBackendCapabilities: template.requiredBackendCapabilities ?? [],
      workflowBlocks: template.workflowBlocks ?? [],
      workflowBlockSettings: template.workflowBlockSettings ?? {},
      lockedSeed: template.example?.lockedSeed ?? null,
      lockedSettings: template.example?.lockedSettings ?? {},
      expectedOutput: template.example?.expectedOutput ?? {},
    };
    const graphHash = workflow?.contract.graphHash ?? null;
    const galleryReceipt = receipt(template.id, galleryEntry, proof);
    const currentCatalogTemplateLockHash = getTemplateLockHash(template);
    const currentPromptSettingsHash = getPromptSettingsHash(getTemplateLockedSettings(template));
    const matchingDirectReceipts = (directReceiptsByTemplate.get(template.id) ?? []).filter(
      (candidate) =>
        candidate.catalogTemplateLockHash === currentCatalogTemplateLockHash &&
        candidate.promptSettingsHash === currentPromptSettingsHash,
    );
    const historicalCandidates = [...matchingDirectReceipts, galleryReceipt]
      .filter(Boolean)
      .filter(
        (candidate) =>
          candidate.catalogTemplateLockHash === currentCatalogTemplateLockHash &&
          candidate.promptSettingsHash === currentPromptSettingsHash,
      )
      .sort((left, right) => String(left.capturedAt ?? '').localeCompare(String(right.capturedAt ?? '')));
    const assessedHistoricalCandidates = historicalCandidates.map((candidate) => ({
      candidate,
      assessment: assessHistoricalEvidence(candidate, workflow?.contract ?? null, backendNodeRegistry),
    }));
    const currentHistoricalEvidence = assessedHistoricalCandidates.filter((item) => item.assessment.matches).at(-1);
    const latestHistoricalEvidence = assessedHistoricalCandidates.at(-1) ?? null;
    const lastSuccessfulRun = currentHistoricalEvidence
      ? {
          ...currentHistoricalEvidence.candidate,
          canonicalWorkflowHash: workflow.contract.graphHash,
          evidenceMatch: currentHistoricalEvidence.assessment.status,
        }
      : null;
    const modelRevision =
      exactRevision(lastSuccessfulRun?.modelRevision) ??
      exactRevision(galleryEntry?.modelRevision ?? template.example?.modelRevision) ??
      (artifactCatalogEntry?.baseRepo && artifactCatalogEntry?.baseRevision
        ? `${artifactCatalogEntry.baseRepo}@${artifactCatalogEntry.baseRevision}`
        : null);
    const qualificationExemption = template.evidencePolicy === 'user_supplied' ? 'user_supplied_artifact' : null;
    const incompleteReceiptFields = qualificationExemption ? [] : receiptMissingFields(lastSuccessfulRun);
    const approvedGalleryExample =
      typeof galleryEntry?.qualityReviewStatus === 'string' && galleryEntry.qualityReviewStatus.startsWith('approved_');
    const missingReleaseEvidence = qualificationExemption
      ? []
      : [
          ...(graphHash ? [] : ['graph_hash']),
          ...(modelRevision ? [] : ['exact_model_revision']),
          ...(lastSuccessfulRun ? [] : ['successful_real_run_receipt']),
          ...(!lastSuccessfulRun && latestHistoricalEvidence && !latestHistoricalEvidence.assessment.matches
            ? latestHistoricalEvidence.assessment.reasons.map((reason) => `qualification_receipt_${reason}`)
            : []),
          ...incompleteReceiptFields.map((field) => `qualification_receipt_${field}`),
          ...(approvedGalleryExample ? [] : ['approved_gallery_example']),
        ];
    const declaredBackendNodes = templateBackendNodeKeys(template);
    const backendNodes = workflow?.contract.backendNodes ?? declaredBackendNodes;
    assertBackendNodeKeys(backendNodes, backendNodeRegistry, template.id);
    const artifactRequirements = requiredArtifacts(template, profile, artifactCatalogEntry);
    if (
      lastSuccessfulRun?.modelRevision &&
      !artifactRequirements.some(
        (artifact) =>
          artifact.repo && `${artifact.repo}@${artifact.revision ?? ''}` === lastSuccessfulRun.modelRevision,
      )
    ) {
      const at = lastSuccessfulRun.modelRevision.lastIndexOf('@');
      artifactRequirements.push({
        role: 'qualification_model',
        repo: lastSuccessfulRun.modelRevision.slice(0, at),
        revision: lastSuccessfulRun.modelRevision.slice(at + 1),
      });
    }
    return {
      id: template.id,
      label: template.label,
      mode: template.mode,
      modelType: template.modelType,
      schemaHash: contractHash('template-schema-v1', schema),
      graphHash,
      canonicalWorkflowId: workflow?.manifest.id ?? null,
      canonicalWorkflowPath: workflow?.manifest.graphPath ?? null,
      exactModelRevision: modelRevision,
      reviewedExampleModelRevision: exactRevision(galleryEntry?.modelRevision),
      requiredArtifacts: artifactRequirements,
      backendNodes,
      packageSetIds: [packageSet.id],
      requiredBackendCapabilities: template.requiredBackendCapabilities ?? [],
      defaultAssets: templateInputs(template, 'template'),
      userInputs: templateInputs(template, 'user'),
      downstreamGraphInputs: templateInputs(template, 'graph'),
      resourceRecipes: resourceContract(profile, template),
      outputContract: outputContract(template),
      lastSuccessfulRealRun: lastSuccessfulRun,
      historicalEvidence: latestHistoricalEvidence
        ? {
            status: latestHistoricalEvidence.assessment.status,
            graphHash: latestHistoricalEvidence.candidate.graphHash,
            canonicalWorkflowHash: latestHistoricalEvidence.candidate.canonicalWorkflowHash ?? null,
            backendNodes: latestHistoricalEvidence.candidate.backendNodes,
            reasons: latestHistoricalEvidence.assessment.reasons,
            missingBackendNodes: latestHistoricalEvidence.assessment.missingBackendNodes ?? [],
          }
        : null,
      qualificationReceiptMissingFields: incompleteReceiptFields,
      evidencePolicy: template.evidencePolicy ?? 'generated',
      qualificationExemption,
      releaseEligible: Boolean(qualificationExemption) || missingReleaseEvidence.length === 0,
      missingReleaseEvidence,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));

  const workflows = workflowRecords
    .map(({ manifest, graph }) => {
      const artifact = artifactByModel.get(manifest.modelType);
      const sourceTemplate = templates.find((template) => template.id === manifest.sourceTemplateId);
      const exactModelRevision =
        sourceTemplate?.exactModelRevision ??
        (artifact?.baseRepo && artifact?.baseRevision ? `${artifact.baseRepo}@${artifact.baseRevision}` : null);
      return {
        id: manifest.id,
        modelType: manifest.modelType,
        mode: manifest.mode,
        graphPath: manifest.graphPath,
        graphHash: canonicalWorkflowContract(manifest, graph).graphHash,
        backendNodes: canonicalWorkflowContract(manifest, graph).backendNodes,
        packageSetIds: [packageSet.id],
        exactModelRevision,
        defaultAssets: sourceTemplate?.defaultAssets ?? [],
        userInputs: sourceTemplate?.userInputs ?? manifest.requiredInputs ?? {},
        resourceRecipes: sourceTemplate?.resourceRecipes ?? null,
        outputContract: sourceTemplate?.outputContract ?? { mediaKinds: [manifest.mediaKind] },
        lastSuccessfulRealRun: sourceTemplate?.lastSuccessfulRealRun ?? null,
        releaseEligible: Boolean(exactModelRevision && sourceTemplate?.releaseEligible),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const body = {
    schemaVersion: 1,
    format: 'modiff.release-contract.v1',
    generatedAt: gallery.generatedAt ?? workflowManifest.generatedAt,
    packageSets: { [packageSet.id]: packageSet },
    templates,
    workflows,
    coverage: {
      templateCount: templates.length,
      releaseEligibleTemplateCount: templates.filter((item) => item.releaseEligible).length,
      templateReceiptCount: templates.filter((item) => item.lastSuccessfulRealRun).length,
      completeQualificationReceiptCount: templates.filter((item) => item.qualificationReceiptMissingFields.length === 0)
        .length,
      workflowCount: workflows.length,
      releaseEligibleWorkflowCount: workflows.filter((item) => item.releaseEligible).length,
      missingTemplateEvidence: templates
        .filter((item) => item.missingReleaseEvidence.length)
        .map((item) => ({ id: item.id, missing: item.missingReleaseEvidence })),
    },
  };
  for (const template of templates) {
    for (const field of [
      'schemaHash',
      'graphHash',
      'exactModelRevision',
      'backendNodes',
      'packageSetIds',
      'defaultAssets',
      'userInputs',
      'resourceRecipes',
      'outputContract',
    ]) {
      if (template[field] === undefined) throw new Error(`${template.id} is missing release-contract field ${field}.`);
    }
    if (!template.backendNodes.length) throw new Error(`${template.id} has no backend-node contract.`);
  }
  for (const workflow of workflows) {
    if (!workflow.graphHash || !workflow.backendNodes.length || !workflow.packageSetIds.length) {
      throw new Error(`${workflow.id} has an incomplete canonical-workflow release contract.`);
    }
  }
  const output = {
    ...body,
    contractHash: contractHash('release-contract-v1', body),
  };
  const serialized = canonicalJson(output);
  if (CHECK) {
    if (!existsSync(OUTPUT_PATH)) throw new Error(`Release contract is missing: ${OUTPUT_PATH}`);
    if (readFileSync(OUTPUT_PATH, 'utf8') !== serialized) {
      throw new Error('Release contract is stale. Run npm run release:contract:generate.');
    }
    console.log(
      `Release contract verified: ${templates.length} templates, ${workflows.length} workflows, ${output.contractHash}`,
    );
  } else {
    writeFileSync(OUTPUT_PATH, serialized);
    console.log(`Wrote ${OUTPUT_PATH}`);
  }
} finally {
  await vite.close();
}
