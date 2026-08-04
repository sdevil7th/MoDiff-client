import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateSupportedProfileCoverage } from './release-qualification-policy.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(SCRIPT_DIR, '..');
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(CLIENT_ROOT, '..', 'MoDiff'));
const CONTRACT_PATH = join(BACKEND_ROOT, 'data', 'release-contract.v1.json');
const OUTPUT_PATH = join(BACKEND_ROOT, 'data', 'qualification', 'release', 'release-candidate-report.v1.json');
const HARDWARE_QUALIFICATION_PATH = join(
  BACKEND_ROOT,
  'data',
  'qualification',
  'release',
  'hardware-qualification.v1.json',
);
const RESOURCE_QUALIFICATION_PATH = join(
  BACKEND_ROOT,
  'data',
  'qualification',
  'release',
  'resource-recipe-coverage.v1.json',
);
const CHECK = process.argv.includes('--check');
const REQUIRE_READY = process.argv.includes('--require-ready');

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

function hash(namespace, value) {
  const digest = createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
  return `sha256:${namespace}:${digest}`;
}

const contract = readJson(CONTRACT_PATH);
const hardwareQualification = existsSync(HARDWARE_QUALIFICATION_PATH)
  ? readJson(HARDWARE_QUALIFICATION_PATH)
  : { receipts: [] };
const resourceQualification = existsSync(RESOURCE_QUALIFICATION_PATH)
  ? readJson(RESOURCE_QUALIFICATION_PATH)
  : { status: 'missing', coverage: { required: 0, qualified: 0, missing: 0 } };
const packageSet = Object.values(contract.packageSets ?? {})[0] ?? {};
const incompleteTemplates = contract.templates
  .filter((template) => !template.releaseEligible)
  .map((template) => ({
    id: template.id,
    missing: template.missingReleaseEvidence,
  }));
const incompleteWorkflows = contract.workflows
  .filter((workflow) => !workflow.releaseEligible)
  .map((workflow) => workflow.id);
const missingFieldCounts = {};
for (const template of contract.templates) {
  for (const field of template.qualificationReceiptMissingFields ?? []) {
    missingFieldCounts[field] = (missingFieldCounts[field] ?? 0) + 1;
  }
}
const hardwareCoverage = evaluateSupportedProfileCoverage(
  packageSet.runtimeProfiles,
  hardwareQualification.receipts,
  packageSet.runtimeManifestRevision,
);
const {
  advertisedSupportedProfiles,
  physicallyQualifiedProfiles,
  physicallyObservedProfiles,
  profileTiers,
  unqualifiedSupportedProfiles,
} = hardwareCoverage;

const gates = {
  releaseContractCurrent: true,
  templatesEligible: incompleteTemplates.length === 0,
  workflowsEligible: incompleteWorkflows.length === 0,
  qualificationReceiptsComplete:
    contract.coverage?.completeQualificationReceiptCount === contract.coverage?.templateCount,
  resourceRecipesQualified: resourceQualification.status === 'complete',
  supportedProfileDeclared: hardwareCoverage.hasSupportedProfile,
  supportedProfilesPhysicallyQualified: hardwareCoverage.allSupportedProfilesQualified,
};
const blockers = [
  ...(gates.templatesEligible
    ? []
    : [
        {
          id: 'templates-incomplete',
          count: incompleteTemplates.length,
          message: `${incompleteTemplates.length} published templates lack complete release evidence.`,
        },
      ]),
  ...(gates.workflowsEligible
    ? []
    : [
        {
          id: 'workflows-incomplete',
          count: incompleteWorkflows.length,
          message: `${incompleteWorkflows.length} canonical workflows lack complete release evidence.`,
        },
      ]),
  ...(gates.qualificationReceiptsComplete
    ? []
    : [
        {
          id: 'qualification-receipts-incomplete',
          count:
            Number(contract.coverage?.templateCount ?? 0) -
            Number(contract.coverage?.completeQualificationReceiptCount ?? 0),
          message:
            'Qualification receipts must contain template, graph, model, runtime, resource candidate, output, duration, and peak-memory evidence.',
        },
      ]),
  ...(gates.resourceRecipesQualified
    ? []
    : [
        {
          id: 'resource-recipes-incomplete',
          count: resourceQualification.coverage?.missing ?? null,
          message: 'Every advertised model-family resource recipe requires a measured real-weight run.',
        },
      ]),
  ...(gates.supportedProfileDeclared
    ? []
    : [
        {
          id: 'supported-profile-missing',
          message:
            'At least one runtime profile must remain advertised as supported and carry current physical qualification evidence.',
        },
      ]),
  ...(gates.supportedProfilesPhysicallyQualified
    ? []
    : [
        {
          id: 'supported-profiles-unqualified',
          profiles: unqualifiedSupportedProfiles,
          message:
            'Profiles cannot remain advertised as supported without a checked-in physical qualification receipt.',
        },
      ]),
];
const body = {
  schemaVersion: 1,
  format: 'modiff.release-candidate-report.v1',
  generatedAt: contract.generatedAt,
  releaseContractHash: contract.contractHash,
  status: blockers.length === 0 ? 'ready' : 'blocked',
  gates,
  blockers,
  coverage: {
    templates: contract.coverage?.templateCount ?? 0,
    eligibleTemplates: contract.coverage?.releaseEligibleTemplateCount ?? 0,
    completeQualificationReceipts: contract.coverage?.completeQualificationReceiptCount ?? 0,
    workflows: contract.coverage?.workflowCount ?? 0,
    eligibleWorkflows: contract.coverage?.releaseEligibleWorkflowCount ?? 0,
    resourceRecipes: resourceQualification.coverage,
    releaseEligibleResourceRecipes: resourceQualification.coverage?.byReleaseLane?.releaseEligible ?? null,
    deferredResourceRecipes: resourceQualification.coverage?.byReleaseLane?.deferred ?? null,
  },
  receiptMissingFieldCounts: missingFieldCounts,
  incompleteTemplates,
  incompleteWorkflows,
  advertisedSupportedProfiles,
  physicallyQualifiedProfiles,
  physicallyObservedProfiles,
  runtimeProfileTiers: profileTiers,
  hardwareQualificationPath: existsSync(HARDWARE_QUALIFICATION_PATH)
    ? 'data/qualification/release/hardware-qualification.v1.json'
    : null,
  resourceQualificationPath: existsSync(RESOURCE_QUALIFICATION_PATH)
    ? 'data/qualification/release/resource-recipe-coverage.v1.json'
    : null,
};
const report = {
  ...body,
  reportHash: hash('release-candidate-report-v1', body),
};
const serialized = canonicalJson(report);

if (CHECK) {
  if (!existsSync(OUTPUT_PATH)) throw new Error(`Release candidate report is missing: ${OUTPUT_PATH}`);
  if (readFileSync(OUTPUT_PATH, 'utf8') !== serialized) {
    throw new Error('Release candidate report is stale. Run npm run release:qualification:generate.');
  }
  if (REQUIRE_READY && report.status !== 'ready') {
    throw new Error(`Release candidate is blocked by ${report.blockers.length} gate(s).`);
  }
  console.log(`Release candidate report verified: ${report.status}, ${report.reportHash}`);
} else {
  writeFileSync(OUTPUT_PATH, serialized);
  console.log(`Wrote ${OUTPUT_PATH} (${report.status})`);
}
