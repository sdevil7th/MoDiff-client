import config from '../../app.config';
import { requestJson } from '../utils/requestJson';

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const STUDIO_HASH = /^studio-spec-v1-[a-f0-9]{8}$/u;

type JsonRecord = Record<string, unknown>;

function invalid(label: string, detail = 'is invalid'): never {
  throw new Error(`Invalid legacy Cluster recovery-audit response: ${label} ${detail}.`);
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(label, 'must be an object');
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, label: string, required: readonly string[], optional: readonly string[] = []) {
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length || unknown.length) invalid(label, 'has missing or unknown fields');
}

function text(value: unknown, label: string, pattern?: RegExp, maximum = 8192): string {
  if (typeof value !== 'string' || !value || value.length > maximum || (pattern && !pattern.test(value)))
    invalid(label);
  return value;
}

function nullableText(value: unknown, label: string, pattern?: RegExp, maximum = 8192): string | null {
  return value === null ? null : text(value, label, pattern, maximum);
}

function count(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(label, 'must be a nonnegative integer');
  return Number(value);
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') invalid(label, 'must be a boolean');
  return value;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(label, 'must be an array');
  return value;
}

function stringList(value: unknown, label: string): string[] {
  const values = list(value, label).map((item, index) => text(item, `${label}[${index}]`, undefined, 1024));
  if (new Set(values).size !== values.length) invalid(label, 'contains duplicates');
  return values;
}

export type HistoricalStudioSpecIdentity = {
  id: string;
  contentHash: string;
  executionProfileId: string;
};

export type HistoricalStudioSpecEvidence = {
  identity: HistoricalStudioSpecIdentity;
  canonicalBodySha256: string;
  sourceIds: string[];
  modelType: string;
  mode: string;
  pipelineClass: string;
  roleCount: number;
  edgeCount: number;
  bindingCount: number;
  actionCount: number;
};

export type HistoricalExecutionTuple = {
  admissionId: string | null;
  studioExecutionSpec: HistoricalStudioSpecIdentity | null;
  instanceCount: number;
  recoveredStudioSpec:
    | { status: 'missing'; authorizesConversion: false }
    | {
        status: 'self_hash_valid_partial_evidence';
        canonicalBodySha256: string;
        sourceIds: string[];
        authorizesConversion: false;
      };
  manualReview:
    | { status: 'evidence_missing' | 'unreviewed'; authorizesConversion: false }
    | {
        status: 'verified_partial_evidence' | 'rejected_evidence';
        reviewId: string;
        reviewer: string;
        reviewedAt: string;
        notes: string;
        reviewHash: string;
        authorizesConversion: false;
      };
};

export type HistoricalRecoveryIdentity = {
  definitionId: string | null;
  libraryRevision: string | null;
  manifestContentHash: string | null;
  admissionIds: string[];
  instanceCount: number;
  disposition:
    | 'identity_malformed'
    | 'execution_receipt_missing'
    | 'execution_receipt_incomplete'
    | 'current_manifest_exact'
    | 'archived_manifest_exact'
    | 'semantic_equivalence_reviewed'
    | 'historical_manifest_evidence_required';
  recoveredStudioSpecs: {
    status: 'partial_evidence_available' | 'missing';
    specificationBodyCount: number;
    executionTupleCount: number;
    instanceCount: number;
    verifiedPartialReviewExecutionTupleCount: number;
    rejectedPartialReviewExecutionTupleCount: number;
    isManifestDefinitionOrConversionAuthority: false;
  };
  executionTuples: HistoricalExecutionTuple[];
  missingEvidence: Array<{ code: string; message: string }>;
  safeNextActions: Array<{ code: string; message: string }>;
};

export type LegacyClusterRecoveryAudit = {
  schemaVersion: 4;
  kind: 'registered_cluster_manifest_recovery_audit';
  contentHash: string;
  boundary: {
    readOnly: true;
    containsWorkflowPaths: false;
    containsInstanceIds: false;
    containsPromptOrParameterValues: false;
    historicalHashAloneIsNotExecutionAuthority: true;
    presentationProjectionIsNotDefinitionAuthority: true;
    recoveredStudioSpecEvidenceDoesNotAuthorizeConversion: true;
    compilerMappingPresenceAloneDoesNotAuthorizeConversion: true;
  };
  summary: {
    legacyClusterInstanceCount: number;
    definitionIdentityCount: number;
    currentManifestExactInstanceCount: number;
    currentManifestExactIdentityCount: number;
    currentExecutionTupleExactInstanceCount: number;
    currentExecutionTupleExactIdentityCount: number;
    archivedManifestExactInstanceCount: number;
    archivedManifestExactIdentityCount: number;
    semanticEquivalenceReviewedInstanceCount: number;
    semanticEquivalenceReviewedIdentityCount: number;
    compilerMappingEligibleInstanceCount: number;
    compilerMappingEligibleIdentityCount: number;
    remainingBlockedHistoricalInstanceCount: number;
    remainingBlockedHistoricalIdentityCount: number;
    historicalEvidenceRequiredInstanceCount: number;
    historicalEvidenceRequiredIdentityCount: number;
    completeExecutionReceiptInstanceCount: number;
    missingExecutionReceiptInstanceCount: number;
    missingExecutionReceiptIdentityCount: number;
    incompleteExecutionReceiptInstanceCount: number;
    incompleteExecutionReceiptIdentityCount: number;
    identityReferenceOnlyInstanceCount: number;
    embeddedCompleteDefinitionInstanceCount: number;
    presentationProjectionInstanceCount: number;
    presentationProjectionNodeCount: number;
    malformedIdentityInstanceCount: number;
    malformedIdentityCount: number;
    recoveredStudioSpecBodyCount: number;
    recoveredStudioSpecManifestIdentityCount: number;
    recoveredStudioSpecExecutionTupleCount: number;
    recoveredStudioSpecInstanceCount: number;
    partialReviewVerifiedExecutionTupleCount: number;
    partialReviewRejectedExecutionTupleCount: number;
  };
  evidenceStatus: 'matched' | 'no_matching_evidence';
  evidenceSources: Array<{ sourceId: string; artifactLabel: string }>;
  specifications: HistoricalStudioSpecEvidence[];
  identities: HistoricalRecoveryIdentity[];
};

const DISPOSITIONS = new Set<HistoricalRecoveryIdentity['disposition']>([
  'identity_malformed',
  'execution_receipt_missing',
  'execution_receipt_incomplete',
  'current_manifest_exact',
  'archived_manifest_exact',
  'semantic_equivalence_reviewed',
  'historical_manifest_evidence_required',
]);

const SUMMARY_KEYS = [
  'legacyClusterInstanceCount',
  'definitionIdentityCount',
  'currentManifestExactInstanceCount',
  'currentManifestExactIdentityCount',
  'currentExecutionTupleExactInstanceCount',
  'currentExecutionTupleExactIdentityCount',
  'archivedManifestExactInstanceCount',
  'archivedManifestExactIdentityCount',
  'semanticEquivalenceReviewedInstanceCount',
  'semanticEquivalenceReviewedIdentityCount',
  'compilerMappingEligibleInstanceCount',
  'compilerMappingEligibleIdentityCount',
  'remainingBlockedHistoricalInstanceCount',
  'remainingBlockedHistoricalIdentityCount',
  'historicalEvidenceRequiredInstanceCount',
  'historicalEvidenceRequiredIdentityCount',
  'completeExecutionReceiptInstanceCount',
  'missingExecutionReceiptInstanceCount',
  'missingExecutionReceiptIdentityCount',
  'incompleteExecutionReceiptInstanceCount',
  'incompleteExecutionReceiptIdentityCount',
  'identityReferenceOnlyInstanceCount',
  'embeddedCompleteDefinitionInstanceCount',
  'presentationProjectionInstanceCount',
  'presentationProjectionNodeCount',
  'malformedIdentityInstanceCount',
  'malformedIdentityCount',
  'recoveredStudioSpecBodyCount',
  'recoveredStudioSpecManifestIdentityCount',
  'recoveredStudioSpecExecutionTupleCount',
  'recoveredStudioSpecInstanceCount',
  'partialReviewVerifiedExecutionTupleCount',
  'partialReviewRejectedExecutionTupleCount',
] as const;

function parseStudioIdentity(value: unknown, label: string): HistoricalStudioSpecIdentity {
  const item = record(value, label);
  exactKeys(item, label, ['id', 'contentHash', 'executionProfileId']);
  return {
    id: text(item.id, `${label}.id`, undefined, 512),
    contentHash: text(item.contentHash, `${label}.contentHash`, STUDIO_HASH),
    executionProfileId: text(item.executionProfileId, `${label}.executionProfileId`, undefined, 512),
  };
}

function parseCodeMessages(value: unknown, label: string) {
  return list(value, label).map((entry, index) => {
    const path = `${label}[${index}]`;
    const item = record(entry, path);
    exactKeys(item, path, ['code', 'message']);
    return {
      code: text(item.code, `${path}.code`, undefined, 512),
      message: text(item.message, `${path}.message`),
    };
  });
}

function parseRecoveredStudioSpec(value: unknown, label: string): HistoricalExecutionTuple['recoveredStudioSpec'] {
  const item = record(value, label);
  const status = text(item.status, `${label}.status`);
  if (status === 'missing') {
    exactKeys(item, label, ['status', 'authorizesConversion']);
    if (bool(item.authorizesConversion, `${label}.authorizesConversion`) !== false) invalid(label, 'grants authority');
    return { status, authorizesConversion: false };
  }
  if (status !== 'self_hash_valid_partial_evidence') invalid(`${label}.status`);
  exactKeys(item, label, ['status', 'canonicalBodySha256', 'sourceIds', 'authorizesConversion']);
  if (bool(item.authorizesConversion, `${label}.authorizesConversion`) !== false) invalid(label, 'grants authority');
  return {
    status,
    canonicalBodySha256: text(item.canonicalBodySha256, `${label}.canonicalBodySha256`, SHA256),
    sourceIds: stringList(item.sourceIds, `${label}.sourceIds`),
    authorizesConversion: false,
  };
}

function parseManualReview(value: unknown, label: string): HistoricalExecutionTuple['manualReview'] {
  const item = record(value, label);
  const status = text(item.status, `${label}.status`);
  if (status === 'evidence_missing' || status === 'unreviewed') {
    exactKeys(item, label, ['status', 'authorizesConversion']);
    if (bool(item.authorizesConversion, `${label}.authorizesConversion`) !== false) invalid(label, 'grants authority');
    return { status, authorizesConversion: false };
  }
  if (status !== 'verified_partial_evidence' && status !== 'rejected_evidence') invalid(`${label}.status`);
  exactKeys(item, label, [
    'status',
    'reviewId',
    'reviewer',
    'reviewedAt',
    'notes',
    'reviewHash',
    'authorizesConversion',
  ]);
  if (bool(item.authorizesConversion, `${label}.authorizesConversion`) !== false) invalid(label, 'grants authority');
  const reviewedAt = text(item.reviewedAt, `${label}.reviewedAt`, undefined, 64);
  if (Number.isNaN(Date.parse(reviewedAt)) || !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(reviewedAt))
    invalid(`${label}.reviewedAt`);
  return {
    status,
    reviewId: text(item.reviewId, `${label}.reviewId`, undefined, 512),
    reviewer: text(item.reviewer, `${label}.reviewer`, undefined, 256),
    reviewedAt,
    notes: text(item.notes, `${label}.notes`, undefined, 4096),
    reviewHash: text(item.reviewHash, `${label}.reviewHash`, SHA256),
    authorizesConversion: false,
  };
}

function parseExecutionTuple(value: unknown, label: string): HistoricalExecutionTuple {
  const item = record(value, label);
  exactKeys(item, label, [
    'admissionId',
    'studioExecutionSpec',
    'instanceCount',
    'recoveredStudioSpec',
    'manualReview',
  ]);
  return {
    admissionId: nullableText(item.admissionId, `${label}.admissionId`, undefined, 1024),
    studioExecutionSpec:
      item.studioExecutionSpec === null
        ? null
        : parseStudioIdentity(item.studioExecutionSpec, `${label}.studioExecutionSpec`),
    instanceCount: count(item.instanceCount, `${label}.instanceCount`),
    recoveredStudioSpec: parseRecoveredStudioSpec(item.recoveredStudioSpec, `${label}.recoveredStudioSpec`),
    manualReview: parseManualReview(item.manualReview, `${label}.manualReview`),
  };
}

function parseRecoveredSummary(value: unknown, label: string): HistoricalRecoveryIdentity['recoveredStudioSpecs'] {
  const item = record(value, label);
  exactKeys(item, label, [
    'status',
    'specificationBodyCount',
    'executionTupleCount',
    'instanceCount',
    'verifiedPartialReviewExecutionTupleCount',
    'rejectedPartialReviewExecutionTupleCount',
    'isManifestDefinitionOrConversionAuthority',
  ]);
  const status = text(item.status, `${label}.status`);
  if (status !== 'partial_evidence_available' && status !== 'missing') invalid(`${label}.status`);
  if (
    bool(item.isManifestDefinitionOrConversionAuthority, `${label}.isManifestDefinitionOrConversionAuthority`) !== false
  )
    invalid(label, 'grants authority');
  return {
    status,
    specificationBodyCount: count(item.specificationBodyCount, `${label}.specificationBodyCount`),
    executionTupleCount: count(item.executionTupleCount, `${label}.executionTupleCount`),
    instanceCount: count(item.instanceCount, `${label}.instanceCount`),
    verifiedPartialReviewExecutionTupleCount: count(
      item.verifiedPartialReviewExecutionTupleCount,
      `${label}.verifiedPartialReviewExecutionTupleCount`,
    ),
    rejectedPartialReviewExecutionTupleCount: count(
      item.rejectedPartialReviewExecutionTupleCount,
      `${label}.rejectedPartialReviewExecutionTupleCount`,
    ),
    isManifestDefinitionOrConversionAuthority: false,
  };
}

function parseIdentity(value: unknown, index: number): HistoricalRecoveryIdentity {
  const label = `audit.identities[${index}]`;
  const item = record(value, label);
  exactKeys(item, label, [
    'definitionId',
    'libraryRevision',
    'manifestContentHash',
    'admissionIds',
    'instanceCount',
    'disposition',
    'sourceEvidence',
    'executionTuples',
    'missingEvidence',
    'safeNextActions',
  ]);
  const disposition = text(item.disposition, `${label}.disposition`) as HistoricalRecoveryIdentity['disposition'];
  if (!DISPOSITIONS.has(disposition)) invalid(`${label}.disposition`);
  const sourceEvidence = record(item.sourceEvidence, `${label}.sourceEvidence`);
  exactKeys(sourceEvidence, `${label}.sourceEvidence`, [
    'embeddedManifest',
    'executionReceipt',
    'presentationProjection',
    'currentCatalog',
    'registeredArchive',
    'reviewedSemanticEquivalence',
    'recoveredStudioSpecs',
  ]);
  // The UI renders only the bounded recovered-evidence projection. Keep every
  // other source-evidence object opaque after confirming it is an object; the
  // backend remains the authority for their detailed diagnostics.
  for (const key of [
    'embeddedManifest',
    'executionReceipt',
    'presentationProjection',
    'currentCatalog',
    'registeredArchive',
    'reviewedSemanticEquivalence',
  ])
    record(sourceEvidence[key], `${label}.sourceEvidence.${key}`);
  return {
    definitionId: nullableText(item.definitionId, `${label}.definitionId`, undefined, 512),
    libraryRevision: nullableText(item.libraryRevision, `${label}.libraryRevision`, COMMIT),
    manifestContentHash: nullableText(item.manifestContentHash, `${label}.manifestContentHash`, SHA256),
    admissionIds: stringList(item.admissionIds, `${label}.admissionIds`),
    instanceCount: count(item.instanceCount, `${label}.instanceCount`),
    disposition,
    recoveredStudioSpecs: parseRecoveredSummary(
      sourceEvidence.recoveredStudioSpecs,
      `${label}.sourceEvidence.recoveredStudioSpecs`,
    ),
    executionTuples: list(item.executionTuples, `${label}.executionTuples`).map((entry, tupleIndex) =>
      parseExecutionTuple(entry, `${label}.executionTuples[${tupleIndex}]`),
    ),
    missingEvidence: parseCodeMessages(item.missingEvidence, `${label}.missingEvidence`),
    safeNextActions: parseCodeMessages(item.safeNextActions, `${label}.safeNextActions`),
  };
}

function parseSource(value: unknown, index: number) {
  const label = `audit.partialStudioSpecEvidence.sources[${index}]`;
  const item = record(value, label);
  exactKeys(item, label, [
    'sourceId',
    'artifactLabel',
    'compressedSha256',
    'compressedBytes',
    'uncompressedSha256',
    'uncompressedBytes',
    'selector',
    'candidateSpecificationCount',
  ]);
  text(item.compressedSha256, `${label}.compressedSha256`, SHA256);
  count(item.compressedBytes, `${label}.compressedBytes`);
  text(item.uncompressedSha256, `${label}.uncompressedSha256`, SHA256);
  count(item.uncompressedBytes, `${label}.uncompressedBytes`);
  text(item.selector, `${label}.selector`, undefined, 512);
  count(item.candidateSpecificationCount, `${label}.candidateSpecificationCount`);
  return {
    sourceId: text(item.sourceId, `${label}.sourceId`, undefined, 160),
    artifactLabel: text(item.artifactLabel, `${label}.artifactLabel`, undefined, 512),
  };
}

function parseSpecification(value: unknown, index: number): HistoricalStudioSpecEvidence {
  const label = `audit.partialStudioSpecEvidence.specifications[${index}]`;
  const item = record(value, label);
  exactKeys(item, label, ['identity', 'canonicalBodySha256', 'specification', 'sourceIds', 'authorizesConversion']);
  if (bool(item.authorizesConversion, `${label}.authorizesConversion`) !== false) invalid(label, 'grants authority');
  const identity = parseStudioIdentity(item.identity, `${label}.identity`);
  const specification = record(item.specification, `${label}.specification`);
  exactKeys(
    specification,
    `${label}.specification`,
    [
      'schemaVersion',
      'canonicalizationVersion',
      'id',
      'modelType',
      'mode',
      'executionProfileId',
      'loaderModule',
      'loaderAction',
      'executionPath',
      'pipelineClass',
      'defaultRepo',
      'roles',
      'edges',
      'bindings',
      'autoFields',
      'actions',
      'contentHash',
    ],
    ['auxiliaryTerminalRoles'],
  );
  if (
    specification.schemaVersion !== 1 ||
    specification.id !== identity.id ||
    specification.contentHash !== identity.contentHash ||
    specification.executionProfileId !== identity.executionProfileId
  )
    invalid(`${label}.specification`, 'does not match its evidence identity');
  const roles = list(specification.roles, `${label}.specification.roles`);
  const edges = list(specification.edges, `${label}.specification.edges`);
  const bindings = list(specification.bindings, `${label}.specification.bindings`);
  const actions = list(specification.actions, `${label}.specification.actions`);
  list(specification.autoFields, `${label}.specification.autoFields`);
  if (specification.auxiliaryTerminalRoles !== undefined)
    stringList(specification.auxiliaryTerminalRoles, `${label}.specification.auxiliaryTerminalRoles`);
  return {
    identity,
    canonicalBodySha256: text(item.canonicalBodySha256, `${label}.canonicalBodySha256`, SHA256),
    sourceIds: stringList(item.sourceIds, `${label}.sourceIds`),
    modelType: text(specification.modelType, `${label}.specification.modelType`, undefined, 512),
    mode: text(specification.mode, `${label}.specification.mode`, undefined, 512),
    pipelineClass: text(specification.pipelineClass, `${label}.specification.pipelineClass`, undefined, 512),
    roleCount: roles.length,
    edgeCount: edges.length,
    bindingCount: bindings.length,
    actionCount: actions.length,
  };
}

export function parseLegacyClusterRecoveryAuditResponse(value: unknown): LegacyClusterRecoveryAudit {
  const response = record(value, 'response');
  exactKeys(response, 'response', ['error', 'audit']);
  if (response.error !== false) invalid('response.error', 'must be false');
  const audit = record(response.audit, 'audit');
  exactKeys(audit, 'audit', [
    'schemaVersion',
    'kind',
    'boundary',
    'localEvidence',
    'summary',
    'partialStudioSpecEvidence',
    'identities',
    'contentHash',
  ]);
  if (audit.schemaVersion !== 4 || audit.kind !== 'registered_cluster_manifest_recovery_audit')
    invalid('audit', 'uses an unsupported contract');
  const boundary = record(audit.boundary, 'audit.boundary');
  exactKeys(boundary, 'audit.boundary', [
    'readOnly',
    'containsWorkflowPaths',
    'containsInstanceIds',
    'containsPromptOrParameterValues',
    'historicalHashAloneIsNotExecutionAuthority',
    'presentationProjectionIsNotDefinitionAuthority',
    'recoveredStudioSpecEvidenceDoesNotAuthorizeConversion',
    'compilerMappingPresenceAloneDoesNotAuthorizeConversion',
  ]);
  const parsedBoundary = {
    readOnly: bool(boundary.readOnly, 'audit.boundary.readOnly'),
    containsWorkflowPaths: bool(boundary.containsWorkflowPaths, 'audit.boundary.containsWorkflowPaths'),
    containsInstanceIds: bool(boundary.containsInstanceIds, 'audit.boundary.containsInstanceIds'),
    containsPromptOrParameterValues: bool(
      boundary.containsPromptOrParameterValues,
      'audit.boundary.containsPromptOrParameterValues',
    ),
    historicalHashAloneIsNotExecutionAuthority: bool(
      boundary.historicalHashAloneIsNotExecutionAuthority,
      'audit.boundary.historicalHashAloneIsNotExecutionAuthority',
    ),
    presentationProjectionIsNotDefinitionAuthority: bool(
      boundary.presentationProjectionIsNotDefinitionAuthority,
      'audit.boundary.presentationProjectionIsNotDefinitionAuthority',
    ),
    recoveredStudioSpecEvidenceDoesNotAuthorizeConversion: bool(
      boundary.recoveredStudioSpecEvidenceDoesNotAuthorizeConversion,
      'audit.boundary.recoveredStudioSpecEvidenceDoesNotAuthorizeConversion',
    ),
    compilerMappingPresenceAloneDoesNotAuthorizeConversion: bool(
      boundary.compilerMappingPresenceAloneDoesNotAuthorizeConversion,
      'audit.boundary.compilerMappingPresenceAloneDoesNotAuthorizeConversion',
    ),
  };
  if (
    parsedBoundary.readOnly !== true ||
    parsedBoundary.containsWorkflowPaths !== false ||
    parsedBoundary.containsInstanceIds !== false ||
    parsedBoundary.containsPromptOrParameterValues !== false ||
    parsedBoundary.historicalHashAloneIsNotExecutionAuthority !== true ||
    parsedBoundary.presentationProjectionIsNotDefinitionAuthority !== true ||
    parsedBoundary.recoveredStudioSpecEvidenceDoesNotAuthorizeConversion !== true ||
    parsedBoundary.compilerMappingPresenceAloneDoesNotAuthorizeConversion !== true
  )
    invalid('audit.boundary', 'weakens the read-only evidence boundary');
  record(audit.localEvidence, 'audit.localEvidence');
  const rawSummary = record(audit.summary, 'audit.summary');
  exactKeys(rawSummary, 'audit.summary', SUMMARY_KEYS);
  const summary = Object.fromEntries(
    SUMMARY_KEYS.map((key) => [key, count(rawSummary[key], `audit.summary.${key}`)]),
  ) as LegacyClusterRecoveryAudit['summary'];
  if (
    summary.compilerMappingEligibleInstanceCount + summary.remainingBlockedHistoricalInstanceCount !==
      summary.legacyClusterInstanceCount -
        summary.currentExecutionTupleExactInstanceCount -
        summary.semanticEquivalenceReviewedInstanceCount ||
    summary.compilerMappingEligibleIdentityCount + summary.remainingBlockedHistoricalIdentityCount !==
      summary.definitionIdentityCount -
        summary.currentExecutionTupleExactIdentityCount -
        summary.semanticEquivalenceReviewedIdentityCount
  )
    invalid('audit.summary', 'has inconsistent historical compiler-mapping progress');
  const partial = record(audit.partialStudioSpecEvidence, 'audit.partialStudioSpecEvidence');
  exactKeys(partial, 'audit.partialStudioSpecEvidence', [
    'status',
    'authorizesConversion',
    'sources',
    'specifications',
    'manualReviews',
  ]);
  const evidenceStatus = text(partial.status, 'audit.partialStudioSpecEvidence.status');
  if (evidenceStatus !== 'matched' && evidenceStatus !== 'no_matching_evidence')
    invalid('audit.partialStudioSpecEvidence.status');
  if (bool(partial.authorizesConversion, 'audit.partialStudioSpecEvidence.authorizesConversion') !== false)
    invalid('audit.partialStudioSpecEvidence', 'grants authority');
  const evidenceSources = list(partial.sources, 'audit.partialStudioSpecEvidence.sources').map(parseSource);
  const specifications = list(partial.specifications, 'audit.partialStudioSpecEvidence.specifications').map(
    parseSpecification,
  );
  // Individual reviewed decisions are already projected into each execution
  // tuple. Validate the collection shape but do not render reviewer metadata
  // from a second path.
  list(partial.manualReviews, 'audit.partialStudioSpecEvidence.manualReviews').forEach((review, index) =>
    record(review, `audit.partialStudioSpecEvidence.manualReviews[${index}]`),
  );
  const identities = list(audit.identities, 'audit.identities').map(parseIdentity);
  if (summary.definitionIdentityCount !== identities.length) invalid('audit.summary.definitionIdentityCount');
  if (summary.recoveredStudioSpecBodyCount !== specifications.length)
    invalid('audit.summary.recoveredStudioSpecBodyCount');
  return {
    schemaVersion: 4,
    kind: 'registered_cluster_manifest_recovery_audit',
    contentHash: text(audit.contentHash, 'audit.contentHash', SHA256),
    boundary: {
      readOnly: true,
      containsWorkflowPaths: false,
      containsInstanceIds: false,
      containsPromptOrParameterValues: false,
      historicalHashAloneIsNotExecutionAuthority: true,
      presentationProjectionIsNotDefinitionAuthority: true,
      recoveredStudioSpecEvidenceDoesNotAuthorizeConversion: true,
      compilerMappingPresenceAloneDoesNotAuthorizeConversion: true,
    },
    summary,
    evidenceStatus,
    evidenceSources,
    specifications,
    identities,
  };
}

export function fetchLegacyClusterRecoveryAudit() {
  return requestJson(`${config.serverAddress}/studio/composite-migrations/recovery-audit`, {
    timeoutMs: 60_000,
    parse: parseLegacyClusterRecoveryAuditResponse,
  });
}
