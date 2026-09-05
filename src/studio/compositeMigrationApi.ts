import config from '../../app.config';
import { formatRequestError, requestJson, RequestError } from '../utils/requestJson';
import { normalizeBlockInstanceV2, type BlockInstanceV2 } from './blockSchemaV2';

export const COMPOSITE_MIGRATION_APPLY_CONFIRMATION = 'APPLY_BLOCK_V2_MIGRATION';
export const COMPOSITE_MIGRATION_ROLLBACK_CONFIRMATION = 'ROLLBACK_BLOCK_V2_MIGRATION';

const MIGRATION_ID = /^block-v2-migration-[a-f0-9]{24}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const BLOCK_DEFINITION_HASH = /^block-definition-v2-[a-f0-9]{8}$/u;
const BLOCK_GRAPH_HASH = /^block-graph-v2-[a-f0-9]{8}$/u;
const BLOCK_INTERFACE_HASH = /^block-interface-v2-[a-f0-9]{8}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const TARGET_PATH = /^(?:user-workflows\/[^/]+\.json|studio\/blocks\/[^/]+\.json)$/u;
const WORKFLOW_PATH = /^user-workflows\/[^/]+\.json$/u;
const CANDIDATE_KINDS = new Set([
  'legacy_registered_cluster_instance',
  'reusable_v1_definition',
  'workflow_v1_instance',
  'workflow_v1_instances',
  'registered_cluster_compiler_output',
]);
const TARGET_KINDS = new Set(['reusable_v1_definition', 'workflow_v1_instances', 'workflow_composite_instances']);
const JOURNAL_STATES = new Set(['applied', 'applying', 'prepared', 'recovery_required', 'rolled_back', 'rolling_back']);
const EFFECTIVE_STATES = new Set(['applied', 'conflict', 'interrupted', 'rolled_back']);
const TARGET_STATES = new Set(['applied', 'conflict', 'missing', 'source']);

type JsonRecord = Record<string, unknown>;

function invalid(label: string, detail = 'is invalid'): never {
  throw new Error(`Invalid composite migration response: ${label} ${detail}.`);
}

function record(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(label, 'must be an object');
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, label: string, required: readonly string[], optional: readonly string[] = []) {
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length) invalid(label, `is missing ${missing.join(', ')}`);
  if (unknown.length) invalid(label, `contains unknown keys ${unknown.join(', ')}`);
}

function text(value: unknown, label: string, pattern?: RegExp, maximum = 4096) {
  if (typeof value !== 'string' || !value || value.length > maximum || (pattern && !pattern.test(value)))
    invalid(label);
  return value;
}

function optionalId(value: unknown, label: string) {
  if (value === null) return null;
  return text(value, label, undefined, 512);
}

function boolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') invalid(label, 'must be a boolean');
  return value;
}

function nonnegativeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(label, 'must be a nonnegative integer');
  return Number(value);
}

function array(value: unknown, label: string) {
  if (!Array.isArray(value)) invalid(label, 'must be an array');
  return value;
}

function unique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) invalid(label, 'contains duplicate entries');
}

export type CompositeMigrationTarget = {
  sourcePath: string;
  kind: 'reusable_v1_definition' | 'workflow_v1_instances' | 'workflow_composite_instances';
  beforeSha256: string;
  afterSha256: string;
  convertedIds: string[];
  byteLength: number;
};

export type CompositeMigrationCandidate = {
  kind:
    | 'legacy_registered_cluster_instance'
    | 'reusable_v1_definition'
    | 'workflow_v1_instance'
    | 'workflow_v1_instances'
    | 'registered_cluster_compiler_output';
  sourcePath: string;
  id: string | null;
  status: 'blocked' | 'convertible';
  reason?: string;
  targetAfterSha256?: string;
  sourceSha256?: string;
  legacyCompositeHash?: string;
  compilerReceipt?: RegisteredClusterCompilerReceipt;
  semanticEquivalenceAuthority?: LegacyClusterSemanticEquivalenceAuthority;
  historicalCompilerMappingAuthority?: LegacyClusterHistoricalCompilerMappingAuthority;
};

export type LegacyClusterSemanticEquivalenceAuthority = {
  receiptId: string;
  receiptHash: string;
  historical: {
    manifestDefinitionId: string;
    libraryRevision: string;
    manifestContentHash: string;
    executionAdmissionId: string;
    studioExecutionSpec: { id: string; contentHash: string; executionProfileId: string };
    executionGraphHash: string;
    interfaceHash: string;
  };
  destination: {
    manifestDefinitionId: string;
    libraryRevision: string;
    manifestContentHash: string;
    executionAdmissionId: string;
    blockDefinitionId: string;
    blockDefinitionContentHash: string;
    blockDefinitionCanonicalSha256: string;
    executionGraphHash: string;
    interfaceHash: string;
  };
  review: {
    decision: 'semantic_equivalent';
    issuer: string;
    reviewedAt: string;
    notes: string;
  };
};

export type LegacyClusterHistoricalCompilerMappingAuthority = {
  mappingId: string;
  mappingHash: string;
  historical: {
    manifestDefinitionId: string;
    libraryRevision: string;
    manifestContentHash: string;
    executionAdmissionId: string;
    studioExecutionSpec: { id: string; contentHash: string; executionProfileId: string };
    archivedDefinitionRecordHash: string;
    blockContractHash: string;
    rootBlockDefinitionId: string;
  };
  destination: LegacyClusterSemanticEquivalenceAuthority['destination'];
  review: {
    decision: 'historical_compiler_mapping_reviewed';
    issuer: string;
    reviewedAt: string;
    notes: string;
  };
};

export type RegisteredClusterCompilerReceipt = {
  instanceId: string;
  definitionId: string;
  admissionId: string;
  compiledDefinitionContentHash: string;
  compiledDefinitionCanonicalSha256: string;
  legacyCompositeHash: string;
  absorbedProjectionNodeIds: string[];
  absorbedInternalEdgeIds: string[];
  semanticEquivalenceAuthority?: LegacyClusterSemanticEquivalenceAuthority;
  historicalCompilerMappingAuthority?: LegacyClusterHistoricalCompilerMappingAuthority;
};

export type RegisteredClusterCompilerConversion = {
  legacyInstanceId: string;
  legacyCompositeHash: string;
  admissionId: string;
  compiledDefinitionContentHash: string;
  compiledDefinitionCanonicalSha256: string;
  blockInstanceV2: BlockInstanceV2;
  ownedNodeMappings: Array<{ legacyNodeId: string; semanticNodeId: string }>;
  portMappings: Array<{
    direction: 'input' | 'output';
    legacyNodeId: string;
    legacyPortId: string;
    v2PortId: string;
  }>;
  valueMappings: Array<
    | {
        sourceKind: string;
        sourceNodeId: string;
        sourceFieldId: string;
        targetKind: 'instance_value';
        targetValueId: string;
      }
    | {
        sourceKind: string;
        sourceNodeId: string;
        sourceFieldId: string;
        targetKind: 'graph_param';
        targetNodeId: string;
        targetFieldId: string;
      }
  >;
  previewMappings: Array<{
    sourceNodeId: string;
    sourceFieldId: string;
    targetNodeId: string;
    targetOutputPortId: string;
  }>;
  absorbedInternalEdgeIds: string[];
  semanticEquivalenceReceipt?: { receiptId: string; receiptHash: string };
  historicalCompilerMapping?: { mappingId: string; mappingHash: string };
};

export type RegisteredClusterCompilerSupplement = {
  schemaVersion: 1;
  kind: 'registered_cluster_v2_compiler_supplement';
  compilerOutputs: Array<{
    sourcePath: string;
    sourceSha256: string;
    conversions: RegisteredClusterCompilerConversion[];
  }>;
};

export type CompositeMigrationInventoryIssue = {
  sourcePath: string;
  path: string;
  code: string;
  severity: 'error' | 'warning';
  message: string;
};

export type CompositeMigrationPreview = {
  schemaVersion: 1;
  kind: 'legacy_composite_to_block_v2_migration';
  mode: 'read_only_preview';
  boundary: {
    writesFiles: false;
    requiresExplicitApplyAuthority: true;
    createsExactBackupsBeforeReplacement: true;
    deletesRecords: false;
    mergesRecords: false;
    legacyClusterConversionRequiresRegisteredCompiler: true;
    compilerSupplementRequiredForRegisteredClusters?: true;
    containsPromptAndParameterValues: false;
  };
  compilerSupplement?: {
    provided: boolean;
    contentHash: string | null;
    sourceCount: number;
    conversionCount: number;
  };
  inventoryReportHash: string;
  sourceSetHash: string;
  summary: {
    sourceCount: number;
    targetFileCount: number;
    convertibleCandidateCount: number;
    blockedCandidateCount: number;
    legacyClusterBlockedCount: number;
    registeredClusterConvertibleCount?: number;
    hasChanges: boolean;
  };
  targets: CompositeMigrationTarget[];
  candidates: CompositeMigrationCandidate[];
  blocked: CompositeMigrationCandidate[];
  inventoryIssues: CompositeMigrationInventoryIssue[];
  migrationId: string;
  planHash: string;
};

export type CompositeMigrationTargetStatus = {
  sourcePath: string;
  currentSha256: string | null;
  state: 'applied' | 'conflict' | 'missing' | 'source';
};

export type CompositeMigrationStatus = {
  migrationId: string;
  journalState: 'applied' | 'applying' | 'prepared' | 'recovery_required' | 'rolled_back' | 'rolling_back';
  effectiveState: 'applied' | 'conflict' | 'interrupted' | 'rolled_back';
  planHash: string;
  inventoryReportHash: string;
  targets: CompositeMigrationTargetStatus[];
  rollbackAvailable: boolean;
  resumeAvailable: false;
};

export type CompositeMigrationMutationResult = {
  idempotent: boolean;
  changedPaths?: string[];
  restoredPaths?: string[];
  status: CompositeMigrationStatus;
};

export function canApplyCompositeMigration(
  preview: CompositeMigrationPreview,
  confirmation: string,
  allowBlockedCandidates: boolean,
) {
  return (
    preview.summary.hasChanges &&
    confirmation === COMPOSITE_MIGRATION_APPLY_CONFIRMATION &&
    (preview.summary.blockedCandidateCount === 0 || allowBlockedCandidates)
  );
}

function canonicallyOrdered(values: readonly string[], label: string) {
  for (let index = 1; index < values.length; index += 1)
    if ((values[index - 1] ?? '') >= (values[index] ?? '')) invalid(label, 'must be unique and canonically ordered');
}

function stringList(value: unknown, label: string) {
  const result = array(value, label).map((item, index) => text(item, `${label}[${index}]`, undefined, 512));
  canonicallyOrdered(result, label);
  return result;
}

function parseStudioSpecBinding(value: unknown, label: string) {
  const item = record(value, label);
  exactKeys(item, label, ['id', 'contentHash', 'executionProfileId']);
  return {
    id: text(item.id, `${label}.id`, undefined, 512),
    contentHash: text(item.contentHash, `${label}.contentHash`, undefined, 128),
    executionProfileId: text(item.executionProfileId, `${label}.executionProfileId`, undefined, 512),
  };
}

function parseSemanticEquivalenceAuthority(value: unknown, label: string): LegacyClusterSemanticEquivalenceAuthority {
  const item = record(value, label);
  exactKeys(item, label, ['receiptId', 'receiptHash', 'historical', 'destination', 'review']);
  const historical = record(item.historical, `${label}.historical`);
  exactKeys(historical, `${label}.historical`, [
    'manifestDefinitionId',
    'libraryRevision',
    'manifestContentHash',
    'executionAdmissionId',
    'studioExecutionSpec',
    'executionGraphHash',
    'interfaceHash',
  ]);
  const destination = record(item.destination, `${label}.destination`);
  exactKeys(destination, `${label}.destination`, [
    'manifestDefinitionId',
    'libraryRevision',
    'manifestContentHash',
    'executionAdmissionId',
    'blockDefinitionId',
    'blockDefinitionContentHash',
    'blockDefinitionCanonicalSha256',
    'executionGraphHash',
    'interfaceHash',
  ]);
  const review = record(item.review, `${label}.review`);
  exactKeys(review, `${label}.review`, ['decision', 'issuer', 'reviewedAt', 'notes']);
  if (review.decision !== 'semantic_equivalent') invalid(`${label}.review.decision`);
  const reviewedAt = text(review.reviewedAt, `${label}.review.reviewedAt`, undefined, 64);
  if (!/(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(reviewedAt) || Number.isNaN(Date.parse(reviewedAt)))
    invalid(`${label}.review.reviewedAt`, 'must be an offset ISO-8601 timestamp');
  return {
    receiptId: text(item.receiptId, `${label}.receiptId`, undefined, 256),
    receiptHash: text(item.receiptHash, `${label}.receiptHash`, SHA256),
    historical: {
      manifestDefinitionId: text(
        historical.manifestDefinitionId,
        `${label}.historical.manifestDefinitionId`,
        undefined,
        512,
      ),
      libraryRevision: text(historical.libraryRevision, `${label}.historical.libraryRevision`, COMMIT),
      manifestContentHash: text(historical.manifestContentHash, `${label}.historical.manifestContentHash`, SHA256),
      executionAdmissionId: text(
        historical.executionAdmissionId,
        `${label}.historical.executionAdmissionId`,
        undefined,
        1024,
      ),
      studioExecutionSpec: parseStudioSpecBinding(
        historical.studioExecutionSpec,
        `${label}.historical.studioExecutionSpec`,
      ),
      executionGraphHash: text(historical.executionGraphHash, `${label}.historical.executionGraphHash`, SHA256),
      interfaceHash: text(historical.interfaceHash, `${label}.historical.interfaceHash`, SHA256),
    },
    destination: {
      manifestDefinitionId: text(
        destination.manifestDefinitionId,
        `${label}.destination.manifestDefinitionId`,
        undefined,
        512,
      ),
      libraryRevision: text(destination.libraryRevision, `${label}.destination.libraryRevision`, COMMIT),
      manifestContentHash: text(destination.manifestContentHash, `${label}.destination.manifestContentHash`, SHA256),
      executionAdmissionId: text(
        destination.executionAdmissionId,
        `${label}.destination.executionAdmissionId`,
        undefined,
        1024,
      ),
      blockDefinitionId: text(destination.blockDefinitionId, `${label}.destination.blockDefinitionId`, undefined, 384),
      blockDefinitionContentHash: text(
        destination.blockDefinitionContentHash,
        `${label}.destination.blockDefinitionContentHash`,
        BLOCK_DEFINITION_HASH,
      ),
      blockDefinitionCanonicalSha256: text(
        destination.blockDefinitionCanonicalSha256,
        `${label}.destination.blockDefinitionCanonicalSha256`,
        SHA256,
      ),
      executionGraphHash: text(
        destination.executionGraphHash,
        `${label}.destination.executionGraphHash`,
        BLOCK_GRAPH_HASH,
      ),
      interfaceHash: text(destination.interfaceHash, `${label}.destination.interfaceHash`, BLOCK_INTERFACE_HASH),
    },
    review: {
      decision: 'semantic_equivalent',
      issuer: text(review.issuer, `${label}.review.issuer`, undefined, 256),
      reviewedAt,
      notes: text(review.notes, `${label}.review.notes`, undefined, 4096),
    },
  };
}

function parseHistoricalCompilerMappingAuthority(
  value: unknown,
  label: string,
): LegacyClusterHistoricalCompilerMappingAuthority {
  const item = record(value, label);
  exactKeys(item, label, ['mappingId', 'mappingHash', 'historical', 'destination', 'review']);
  const historical = record(item.historical, `${label}.historical`);
  exactKeys(historical, `${label}.historical`, [
    'manifestDefinitionId',
    'libraryRevision',
    'manifestContentHash',
    'executionAdmissionId',
    'studioExecutionSpec',
    'archivedDefinitionRecordHash',
    'blockContractHash',
    'rootBlockDefinitionId',
  ]);
  const destination = record(item.destination, `${label}.destination`);
  exactKeys(destination, `${label}.destination`, [
    'manifestDefinitionId',
    'libraryRevision',
    'manifestContentHash',
    'executionAdmissionId',
    'blockDefinitionId',
    'blockDefinitionContentHash',
    'blockDefinitionCanonicalSha256',
    'executionGraphHash',
    'interfaceHash',
  ]);
  const review = record(item.review, `${label}.review`);
  exactKeys(review, `${label}.review`, ['decision', 'issuer', 'reviewedAt', 'notes']);
  if (review.decision !== 'historical_compiler_mapping_reviewed') invalid(`${label}.review.decision`);
  const reviewedAt = text(review.reviewedAt, `${label}.review.reviewedAt`, undefined, 64);
  if (!/(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(reviewedAt) || Number.isNaN(Date.parse(reviewedAt)))
    invalid(`${label}.review.reviewedAt`, 'must be an offset ISO-8601 timestamp');
  return {
    mappingId: text(item.mappingId, `${label}.mappingId`, undefined, 256),
    mappingHash: text(item.mappingHash, `${label}.mappingHash`, SHA256),
    historical: {
      manifestDefinitionId: text(
        historical.manifestDefinitionId,
        `${label}.historical.manifestDefinitionId`,
        undefined,
        512,
      ),
      libraryRevision: text(historical.libraryRevision, `${label}.historical.libraryRevision`, COMMIT),
      manifestContentHash: text(historical.manifestContentHash, `${label}.historical.manifestContentHash`, SHA256),
      executionAdmissionId: text(
        historical.executionAdmissionId,
        `${label}.historical.executionAdmissionId`,
        undefined,
        1024,
      ),
      studioExecutionSpec: parseStudioSpecBinding(
        historical.studioExecutionSpec,
        `${label}.historical.studioExecutionSpec`,
      ),
      archivedDefinitionRecordHash: text(
        historical.archivedDefinitionRecordHash,
        `${label}.historical.archivedDefinitionRecordHash`,
        SHA256,
      ),
      blockContractHash: text(historical.blockContractHash, `${label}.historical.blockContractHash`, SHA256),
      rootBlockDefinitionId: text(
        historical.rootBlockDefinitionId,
        `${label}.historical.rootBlockDefinitionId`,
        undefined,
        1024,
      ),
    },
    destination: {
      manifestDefinitionId: text(
        destination.manifestDefinitionId,
        `${label}.destination.manifestDefinitionId`,
        undefined,
        512,
      ),
      libraryRevision: text(destination.libraryRevision, `${label}.destination.libraryRevision`, COMMIT),
      manifestContentHash: text(destination.manifestContentHash, `${label}.destination.manifestContentHash`, SHA256),
      executionAdmissionId: text(
        destination.executionAdmissionId,
        `${label}.destination.executionAdmissionId`,
        undefined,
        1024,
      ),
      blockDefinitionId: text(destination.blockDefinitionId, `${label}.destination.blockDefinitionId`, undefined, 384),
      blockDefinitionContentHash: text(
        destination.blockDefinitionContentHash,
        `${label}.destination.blockDefinitionContentHash`,
        BLOCK_DEFINITION_HASH,
      ),
      blockDefinitionCanonicalSha256: text(
        destination.blockDefinitionCanonicalSha256,
        `${label}.destination.blockDefinitionCanonicalSha256`,
        SHA256,
      ),
      executionGraphHash: text(
        destination.executionGraphHash,
        `${label}.destination.executionGraphHash`,
        BLOCK_GRAPH_HASH,
      ),
      interfaceHash: text(destination.interfaceHash, `${label}.destination.interfaceHash`, BLOCK_INTERFACE_HASH),
    },
    review: {
      decision: 'historical_compiler_mapping_reviewed',
      issuer: text(review.issuer, `${label}.review.issuer`, undefined, 256),
      reviewedAt,
      notes: text(review.notes, `${label}.review.notes`, undefined, 4096),
    },
  };
}

function parseCompilerReceipt(value: unknown, label: string): RegisteredClusterCompilerReceipt {
  const item = record(value, label);
  exactKeys(
    item,
    label,
    [
      'instanceId',
      'definitionId',
      'admissionId',
      'compiledDefinitionContentHash',
      'compiledDefinitionCanonicalSha256',
      'legacyCompositeHash',
      'absorbedProjectionNodeIds',
      'absorbedInternalEdgeIds',
    ],
    ['semanticEquivalenceAuthority', 'historicalCompilerMappingAuthority'],
  );
  const semanticEquivalenceAuthority =
    item.semanticEquivalenceAuthority === undefined
      ? undefined
      : parseSemanticEquivalenceAuthority(item.semanticEquivalenceAuthority, `${label}.semanticEquivalenceAuthority`);
  const historicalCompilerMappingAuthority =
    item.historicalCompilerMappingAuthority === undefined
      ? undefined
      : parseHistoricalCompilerMappingAuthority(
          item.historicalCompilerMappingAuthority,
          `${label}.historicalCompilerMappingAuthority`,
        );
  if (semanticEquivalenceAuthority && historicalCompilerMappingAuthority)
    invalid(label, 'must not combine semantic-equivalence and historical compiler-mapping authority');
  return {
    instanceId: text(item.instanceId, `${label}.instanceId`, undefined, 512),
    definitionId: text(item.definitionId, `${label}.definitionId`, undefined, 512),
    admissionId: text(item.admissionId, `${label}.admissionId`, undefined, 1024),
    compiledDefinitionContentHash: text(
      item.compiledDefinitionContentHash,
      `${label}.compiledDefinitionContentHash`,
      BLOCK_DEFINITION_HASH,
    ),
    compiledDefinitionCanonicalSha256: text(
      item.compiledDefinitionCanonicalSha256,
      `${label}.compiledDefinitionCanonicalSha256`,
      SHA256,
    ),
    legacyCompositeHash: text(item.legacyCompositeHash, `${label}.legacyCompositeHash`, SHA256),
    absorbedProjectionNodeIds: stringList(item.absorbedProjectionNodeIds, `${label}.absorbedProjectionNodeIds`),
    absorbedInternalEdgeIds: stringList(item.absorbedInternalEdgeIds, `${label}.absorbedInternalEdgeIds`),
    ...(semanticEquivalenceAuthority ? { semanticEquivalenceAuthority } : {}),
    ...(historicalCompilerMappingAuthority ? { historicalCompilerMappingAuthority } : {}),
  };
}

function parseCompilerConversion(value: unknown, label: string): RegisteredClusterCompilerConversion {
  const item = record(value, label);
  exactKeys(
    item,
    label,
    [
      'legacyInstanceId',
      'legacyCompositeHash',
      'admissionId',
      'compiledDefinitionContentHash',
      'compiledDefinitionCanonicalSha256',
      'blockInstanceV2',
      'ownedNodeMappings',
      'portMappings',
      'valueMappings',
      'previewMappings',
      'absorbedInternalEdgeIds',
    ],
    ['semanticEquivalenceReceipt', 'historicalCompilerMapping'],
  );
  const ownedNodeMappings = array(item.ownedNodeMappings, `${label}.ownedNodeMappings`).map((value, index) => {
    const path = `${label}.ownedNodeMappings[${index}]`;
    const mapping = record(value, path);
    exactKeys(mapping, path, ['legacyNodeId', 'semanticNodeId']);
    return {
      legacyNodeId: text(mapping.legacyNodeId, `${path}.legacyNodeId`, undefined, 512),
      semanticNodeId: text(mapping.semanticNodeId, `${path}.semanticNodeId`, undefined, 512),
    };
  });
  canonicallyOrdered(
    ownedNodeMappings.map(({ legacyNodeId, semanticNodeId }) => `${legacyNodeId}\0${semanticNodeId}`),
    `${label}.ownedNodeMappings`,
  );
  const portMappings = array(item.portMappings, `${label}.portMappings`).map((value, index) => {
    const path = `${label}.portMappings[${index}]`;
    const mapping = record(value, path);
    exactKeys(mapping, path, ['direction', 'legacyNodeId', 'legacyPortId', 'v2PortId']);
    const direction = text(mapping.direction, `${path}.direction`);
    if (direction !== 'input' && direction !== 'output') invalid(`${path}.direction`);
    return {
      direction: direction as 'input' | 'output',
      legacyNodeId: text(mapping.legacyNodeId, `${path}.legacyNodeId`, undefined, 512),
      legacyPortId: text(mapping.legacyPortId, `${path}.legacyPortId`, undefined, 512),
      v2PortId: text(mapping.v2PortId, `${path}.v2PortId`, undefined, 512),
    };
  });
  canonicallyOrdered(
    portMappings.map(
      ({ direction, legacyNodeId, legacyPortId, v2PortId }) =>
        `${direction}\0${legacyNodeId}\0${legacyPortId}\0${v2PortId}`,
    ),
    `${label}.portMappings`,
  );
  const valueMappings = array(item.valueMappings, `${label}.valueMappings`).map((value, index) => {
    const path = `${label}.valueMappings[${index}]`;
    const mapping = record(value, path);
    const targetKind = text(mapping.targetKind, `${path}.targetKind`);
    const common = {
      sourceKind: text(mapping.sourceKind, `${path}.sourceKind`, undefined, 512),
      sourceNodeId: text(mapping.sourceNodeId, `${path}.sourceNodeId`, undefined, 512),
      sourceFieldId: text(mapping.sourceFieldId, `${path}.sourceFieldId`, undefined, 512),
    };
    if (targetKind === 'instance_value') {
      exactKeys(mapping, path, ['sourceKind', 'sourceNodeId', 'sourceFieldId', 'targetKind', 'targetValueId']);
      return {
        ...common,
        targetKind: 'instance_value' as const,
        targetValueId: text(mapping.targetValueId, `${path}.targetValueId`, undefined, 512),
      };
    }
    if (targetKind === 'graph_param') {
      exactKeys(mapping, path, [
        'sourceKind',
        'sourceNodeId',
        'sourceFieldId',
        'targetKind',
        'targetNodeId',
        'targetFieldId',
      ]);
      return {
        ...common,
        targetKind: 'graph_param' as const,
        targetNodeId: text(mapping.targetNodeId, `${path}.targetNodeId`, undefined, 512),
        targetFieldId: text(mapping.targetFieldId, `${path}.targetFieldId`, undefined, 512),
      };
    }
    invalid(`${path}.targetKind`);
  });
  canonicallyOrdered(
    valueMappings.map(
      ({ sourceKind, sourceNodeId, sourceFieldId, targetKind }) =>
        `${sourceKind}\0${sourceNodeId}\0${sourceFieldId}\0${targetKind}`,
    ),
    `${label}.valueMappings`,
  );
  const previewMappings = array(item.previewMappings, `${label}.previewMappings`).map((value, index) => {
    const path = `${label}.previewMappings[${index}]`;
    const mapping = record(value, path);
    exactKeys(mapping, path, ['sourceNodeId', 'sourceFieldId', 'targetNodeId', 'targetOutputPortId']);
    return {
      sourceNodeId: text(mapping.sourceNodeId, `${path}.sourceNodeId`, undefined, 512),
      sourceFieldId: text(mapping.sourceFieldId, `${path}.sourceFieldId`, undefined, 512),
      targetNodeId: text(mapping.targetNodeId, `${path}.targetNodeId`, undefined, 512),
      targetOutputPortId: text(mapping.targetOutputPortId, `${path}.targetOutputPortId`, undefined, 512),
    };
  });
  canonicallyOrdered(
    previewMappings.map(
      ({ sourceNodeId, sourceFieldId, targetNodeId, targetOutputPortId }) =>
        `${sourceNodeId}\0${sourceFieldId}\0${targetNodeId}\0${targetOutputPortId}`,
    ),
    `${label}.previewMappings`,
  );
  const semanticEquivalenceReceipt =
    item.semanticEquivalenceReceipt === undefined
      ? undefined
      : (() => {
          const reference = record(item.semanticEquivalenceReceipt, `${label}.semanticEquivalenceReceipt`);
          exactKeys(reference, `${label}.semanticEquivalenceReceipt`, ['receiptId', 'receiptHash']);
          return {
            receiptId: text(reference.receiptId, `${label}.semanticEquivalenceReceipt.receiptId`, undefined, 256),
            receiptHash: text(reference.receiptHash, `${label}.semanticEquivalenceReceipt.receiptHash`, SHA256),
          };
        })();
  const historicalCompilerMapping =
    item.historicalCompilerMapping === undefined
      ? undefined
      : (() => {
          const reference = record(item.historicalCompilerMapping, `${label}.historicalCompilerMapping`);
          exactKeys(reference, `${label}.historicalCompilerMapping`, ['mappingId', 'mappingHash']);
          return {
            mappingId: text(reference.mappingId, `${label}.historicalCompilerMapping.mappingId`, undefined, 256),
            mappingHash: text(reference.mappingHash, `${label}.historicalCompilerMapping.mappingHash`, SHA256),
          };
        })();
  if (semanticEquivalenceReceipt && historicalCompilerMapping)
    invalid(label, 'must not combine semantic-equivalence and historical compiler-mapping authority');
  return {
    legacyInstanceId: text(item.legacyInstanceId, `${label}.legacyInstanceId`, undefined, 512),
    legacyCompositeHash: text(item.legacyCompositeHash, `${label}.legacyCompositeHash`, SHA256),
    admissionId: text(item.admissionId, `${label}.admissionId`, undefined, 1024),
    compiledDefinitionContentHash: text(
      item.compiledDefinitionContentHash,
      `${label}.compiledDefinitionContentHash`,
      BLOCK_DEFINITION_HASH,
    ),
    compiledDefinitionCanonicalSha256: text(
      item.compiledDefinitionCanonicalSha256,
      `${label}.compiledDefinitionCanonicalSha256`,
      SHA256,
    ),
    blockInstanceV2: normalizeBlockInstanceV2(item.blockInstanceV2),
    ownedNodeMappings,
    portMappings,
    valueMappings,
    previewMappings,
    absorbedInternalEdgeIds: stringList(item.absorbedInternalEdgeIds, `${label}.absorbedInternalEdgeIds`),
    ...(semanticEquivalenceReceipt ? { semanticEquivalenceReceipt } : {}),
    ...(historicalCompilerMapping ? { historicalCompilerMapping } : {}),
  };
}

export function parseRegisteredClusterCompilerSupplement(value: unknown): RegisteredClusterCompilerSupplement {
  const supplement = record(value, 'compiler supplement');
  exactKeys(supplement, 'compiler supplement', ['schemaVersion', 'kind', 'compilerOutputs']);
  if (supplement.schemaVersion !== 1 || supplement.kind !== 'registered_cluster_v2_compiler_supplement')
    invalid('compiler supplement', 'uses an unsupported contract');
  const compilerOutputs = array(supplement.compilerOutputs, 'compiler supplement.compilerOutputs').map(
    (value, index) => {
      const label = `compiler supplement.compilerOutputs[${index}]`;
      const output = record(value, label);
      exactKeys(output, label, ['sourcePath', 'sourceSha256', 'conversions']);
      const conversions = array(output.conversions, `${label}.conversions`).map((item, conversionIndex) =>
        parseCompilerConversion(item, `${label}.conversions[${conversionIndex}]`),
      );
      if (!conversions.length) invalid(`${label}.conversions`, 'must not be empty');
      canonicallyOrdered(
        conversions.map(({ legacyInstanceId }) => legacyInstanceId),
        `${label}.conversions`,
      );
      return {
        sourcePath: text(output.sourcePath, `${label}.sourcePath`, WORKFLOW_PATH),
        sourceSha256: text(output.sourceSha256, `${label}.sourceSha256`, SHA256),
        conversions,
      };
    },
  );
  canonicallyOrdered(
    compilerOutputs.map(({ sourcePath }) => sourcePath),
    'compiler supplement.compilerOutputs',
  );
  return { schemaVersion: 1, kind: 'registered_cluster_v2_compiler_supplement', compilerOutputs };
}

function parseTarget(value: unknown, index: number): CompositeMigrationTarget {
  const item = record(value, `preview.targets[${index}]`);
  exactKeys(item, `preview.targets[${index}]`, [
    'sourcePath',
    'kind',
    'beforeSha256',
    'afterSha256',
    'convertedIds',
    'byteLength',
  ]);
  const kind = text(item.kind, `preview.targets[${index}].kind`);
  if (!TARGET_KINDS.has(kind)) invalid(`preview.targets[${index}].kind`);
  const convertedIds = array(item.convertedIds, `preview.targets[${index}].convertedIds`).map((id, idIndex) =>
    text(id, `preview.targets[${index}].convertedIds[${idIndex}]`, undefined, 512),
  );
  if (!convertedIds.length) invalid(`preview.targets[${index}].convertedIds`, 'must not be empty');
  unique(convertedIds, `preview.targets[${index}].convertedIds`);
  return {
    sourcePath: text(item.sourcePath, `preview.targets[${index}].sourcePath`, TARGET_PATH),
    kind: kind as CompositeMigrationTarget['kind'],
    beforeSha256: text(item.beforeSha256, `preview.targets[${index}].beforeSha256`, SHA256),
    afterSha256: text(item.afterSha256, `preview.targets[${index}].afterSha256`, SHA256),
    convertedIds,
    byteLength: nonnegativeInteger(item.byteLength, `preview.targets[${index}].byteLength`),
  };
}

function parseCandidate(value: unknown, label: string): CompositeMigrationCandidate {
  const item = record(value, label);
  exactKeys(
    item,
    label,
    ['kind', 'sourcePath', 'id', 'status'],
    [
      'reason',
      'targetAfterSha256',
      'sourceSha256',
      'legacyCompositeHash',
      'compilerReceipt',
      'semanticEquivalenceAuthority',
      'historicalCompilerMappingAuthority',
    ],
  );
  const kind = text(item.kind, `${label}.kind`);
  if (!CANDIDATE_KINDS.has(kind)) invalid(`${label}.kind`);
  const status = text(item.status, `${label}.status`);
  if (status !== 'blocked' && status !== 'convertible') invalid(`${label}.status`);
  const reason = item.reason === undefined ? undefined : text(item.reason, `${label}.reason`, undefined, 8192);
  const targetAfterSha256 =
    item.targetAfterSha256 === undefined
      ? undefined
      : text(item.targetAfterSha256, `${label}.targetAfterSha256`, SHA256);
  const sourceSha256 =
    item.sourceSha256 === undefined ? undefined : text(item.sourceSha256, `${label}.sourceSha256`, SHA256);
  const legacyCompositeHash =
    item.legacyCompositeHash === undefined
      ? undefined
      : text(item.legacyCompositeHash, `${label}.legacyCompositeHash`, SHA256);
  const compilerReceipt =
    item.compilerReceipt === undefined
      ? undefined
      : parseCompilerReceipt(item.compilerReceipt, `${label}.compilerReceipt`);
  const semanticEquivalenceAuthority =
    item.semanticEquivalenceAuthority === undefined
      ? undefined
      : parseSemanticEquivalenceAuthority(item.semanticEquivalenceAuthority, `${label}.semanticEquivalenceAuthority`);
  const historicalCompilerMappingAuthority =
    item.historicalCompilerMappingAuthority === undefined
      ? undefined
      : parseHistoricalCompilerMappingAuthority(
          item.historicalCompilerMappingAuthority,
          `${label}.historicalCompilerMappingAuthority`,
        );
  if (semanticEquivalenceAuthority && historicalCompilerMappingAuthority)
    invalid(label, 'must not combine semantic-equivalence and historical compiler-mapping authority');
  if ((status === 'blocked') !== Boolean(reason) || (status === 'convertible') !== Boolean(targetAfterSha256))
    invalid(label, 'has inconsistent status details');
  return {
    kind: kind as CompositeMigrationCandidate['kind'],
    sourcePath: text(item.sourcePath, `${label}.sourcePath`, TARGET_PATH),
    id: optionalId(item.id, `${label}.id`),
    status,
    ...(reason ? { reason } : {}),
    ...(targetAfterSha256 ? { targetAfterSha256 } : {}),
    ...(sourceSha256 ? { sourceSha256 } : {}),
    ...(legacyCompositeHash ? { legacyCompositeHash } : {}),
    ...(compilerReceipt ? { compilerReceipt } : {}),
    ...(semanticEquivalenceAuthority ? { semanticEquivalenceAuthority } : {}),
    ...(historicalCompilerMappingAuthority ? { historicalCompilerMappingAuthority } : {}),
  };
}

function parseInventoryIssue(value: unknown, index: number): CompositeMigrationInventoryIssue {
  const label = `preview.inventoryIssues[${index}]`;
  const item = record(value, label);
  exactKeys(item, label, ['sourcePath', 'path', 'code', 'severity', 'message']);
  const severity = text(item.severity, `${label}.severity`);
  if (severity !== 'error' && severity !== 'warning') invalid(`${label}.severity`);
  return {
    sourcePath: text(item.sourcePath, `${label}.sourcePath`, undefined, 4096),
    path: text(item.path, `${label}.path`, undefined, 4096),
    code: text(item.code, `${label}.code`, undefined, 512),
    severity,
    message: text(item.message, `${label}.message`, undefined, 8192),
  };
}

export function parseCompositeMigrationPreviewResponse(value: unknown): CompositeMigrationPreview {
  const response = record(value, 'preview response');
  exactKeys(response, 'preview response', ['error', 'preview']);
  if (response.error !== false) invalid('preview response.error', 'must be false');
  const payload = record(response.preview, 'preview');
  exactKeys(
    payload,
    'preview',
    [
      'schemaVersion',
      'kind',
      'mode',
      'boundary',
      'inventoryReportHash',
      'sourceSetHash',
      'summary',
      'targets',
      'candidates',
      'blocked',
      'inventoryIssues',
      'migrationId',
      'planHash',
    ],
    ['compilerSupplement'],
  );
  if (
    payload.schemaVersion !== 1 ||
    payload.kind !== 'legacy_composite_to_block_v2_migration' ||
    payload.mode !== 'read_only_preview'
  )
    invalid('preview', 'uses an unsupported contract');
  const boundary = record(payload.boundary, 'preview.boundary');
  exactKeys(
    boundary,
    'preview.boundary',
    [
      'writesFiles',
      'requiresExplicitApplyAuthority',
      'createsExactBackupsBeforeReplacement',
      'deletesRecords',
      'mergesRecords',
      'legacyClusterConversionRequiresRegisteredCompiler',
      'containsPromptAndParameterValues',
    ],
    ['compilerSupplementRequiredForRegisteredClusters'],
  );
  if (
    boundary.writesFiles !== false ||
    boundary.requiresExplicitApplyAuthority !== true ||
    boundary.createsExactBackupsBeforeReplacement !== true ||
    boundary.deletesRecords !== false ||
    boundary.mergesRecords !== false ||
    boundary.legacyClusterConversionRequiresRegisteredCompiler !== true ||
    boundary.containsPromptAndParameterValues !== false
  )
    invalid('preview.boundary', 'does not preserve the read-only safety contract');
  const summaryValue = record(payload.summary, 'preview.summary');
  exactKeys(
    summaryValue,
    'preview.summary',
    [
      'sourceCount',
      'targetFileCount',
      'convertibleCandidateCount',
      'blockedCandidateCount',
      'legacyClusterBlockedCount',
      'hasChanges',
    ],
    ['registeredClusterConvertibleCount'],
  );
  const targets = array(payload.targets, 'preview.targets').map(parseTarget);
  const candidates = array(payload.candidates, 'preview.candidates').map((item, index) =>
    parseCandidate(item, `preview.candidates[${index}]`),
  );
  const blocked = array(payload.blocked, 'preview.blocked').map((item, index) =>
    parseCandidate(item, `preview.blocked[${index}]`),
  );
  const inventoryIssues = array(payload.inventoryIssues, 'preview.inventoryIssues').map(parseInventoryIssue);
  const summary = {
    sourceCount: nonnegativeInteger(summaryValue.sourceCount, 'preview.summary.sourceCount'),
    targetFileCount: nonnegativeInteger(summaryValue.targetFileCount, 'preview.summary.targetFileCount'),
    convertibleCandidateCount: nonnegativeInteger(
      summaryValue.convertibleCandidateCount,
      'preview.summary.convertibleCandidateCount',
    ),
    blockedCandidateCount: nonnegativeInteger(
      summaryValue.blockedCandidateCount,
      'preview.summary.blockedCandidateCount',
    ),
    legacyClusterBlockedCount: nonnegativeInteger(
      summaryValue.legacyClusterBlockedCount,
      'preview.summary.legacyClusterBlockedCount',
    ),
    hasChanges: boolean(summaryValue.hasChanges, 'preview.summary.hasChanges'),
    ...(summaryValue.registeredClusterConvertibleCount === undefined
      ? {}
      : {
          registeredClusterConvertibleCount: nonnegativeInteger(
            summaryValue.registeredClusterConvertibleCount,
            'preview.summary.registeredClusterConvertibleCount',
          ),
        }),
  };
  const compilerSupplement =
    payload.compilerSupplement === undefined
      ? undefined
      : (() => {
          const item = record(payload.compilerSupplement, 'preview.compilerSupplement');
          exactKeys(item, 'preview.compilerSupplement', ['provided', 'contentHash', 'sourceCount', 'conversionCount']);
          const provided = boolean(item.provided, 'preview.compilerSupplement.provided');
          const contentHash =
            item.contentHash === null ? null : text(item.contentHash, 'preview.compilerSupplement.contentHash', SHA256);
          if (provided !== Boolean(contentHash))
            invalid('preview.compilerSupplement', 'has an inconsistent provided/contentHash pair');
          return {
            provided,
            contentHash,
            sourceCount: nonnegativeInteger(item.sourceCount, 'preview.compilerSupplement.sourceCount'),
            conversionCount: nonnegativeInteger(item.conversionCount, 'preview.compilerSupplement.conversionCount'),
          };
        })();
  if (
    Boolean(compilerSupplement) !== (boundary.compilerSupplementRequiredForRegisteredClusters === true) ||
    Boolean(compilerSupplement) !== (summary.registeredClusterConvertibleCount !== undefined)
  )
    invalid('preview.compilerSupplement', 'is inconsistent with the compiler-preview boundary and summary');
  unique(
    targets.map(({ sourcePath }) => sourcePath),
    'preview.targets',
  );
  const candidateBlocked = candidates.filter(({ status }) => status === 'blocked');
  if (
    summary.targetFileCount !== targets.length ||
    summary.convertibleCandidateCount !== candidates.filter(({ status }) => status === 'convertible').length ||
    summary.blockedCandidateCount !== candidateBlocked.length ||
    summary.blockedCandidateCount !== blocked.length ||
    summary.legacyClusterBlockedCount !==
      blocked.filter(({ kind }) => kind === 'legacy_registered_cluster_instance').length ||
    (summary.registeredClusterConvertibleCount !== undefined &&
      summary.registeredClusterConvertibleCount !==
        candidates.filter(
          ({ kind, status }) => kind === 'legacy_registered_cluster_instance' && status === 'convertible',
        ).length) ||
    summary.hasChanges !== Boolean(targets.length) ||
    JSON.stringify(candidateBlocked) !== JSON.stringify(blocked)
  )
    invalid('preview.summary', 'does not match the listed targets and candidates');
  const targetHashByPath = new Map(targets.map((target) => [target.sourcePath, target.afterSha256]));
  if (
    candidates.some(
      (candidate) =>
        candidate.status === 'convertible' &&
        targetHashByPath.get(candidate.sourcePath) !== candidate.targetAfterSha256,
    )
  )
    invalid('preview.candidates', 'does not match the target hashes');
  return {
    schemaVersion: 1,
    kind: 'legacy_composite_to_block_v2_migration',
    mode: 'read_only_preview',
    boundary: {
      writesFiles: false,
      requiresExplicitApplyAuthority: true,
      createsExactBackupsBeforeReplacement: true,
      deletesRecords: false,
      mergesRecords: false,
      legacyClusterConversionRequiresRegisteredCompiler: true,
      ...(compilerSupplement ? { compilerSupplementRequiredForRegisteredClusters: true } : {}),
      containsPromptAndParameterValues: false,
    },
    ...(compilerSupplement ? { compilerSupplement } : {}),
    inventoryReportHash: text(payload.inventoryReportHash, 'preview.inventoryReportHash', SHA256),
    sourceSetHash: text(payload.sourceSetHash, 'preview.sourceSetHash', SHA256),
    summary,
    targets,
    candidates,
    blocked,
    inventoryIssues,
    migrationId: text(payload.migrationId, 'preview.migrationId', MIGRATION_ID),
    planHash: text(payload.planHash, 'preview.planHash', SHA256),
  };
}

function parseTargetStatus(value: unknown, index: number): CompositeMigrationTargetStatus {
  const label = `migration status.targets[${index}]`;
  const item = record(value, label);
  exactKeys(item, label, ['sourcePath', 'currentSha256', 'state']);
  const state = text(item.state, `${label}.state`);
  if (!TARGET_STATES.has(state)) invalid(`${label}.state`);
  const currentSha256 = item.currentSha256 === null ? null : text(item.currentSha256, `${label}.currentSha256`, SHA256);
  if ((state === 'missing') !== (currentSha256 === null)) invalid(label, 'has an inconsistent current file hash');
  return {
    sourcePath: text(item.sourcePath, `${label}.sourcePath`, TARGET_PATH),
    currentSha256,
    state: state as CompositeMigrationTargetStatus['state'],
  };
}

export function parseCompositeMigrationStatus(value: unknown): CompositeMigrationStatus {
  const payload = record(value, 'migration status');
  exactKeys(payload, 'migration status', [
    'migrationId',
    'journalState',
    'effectiveState',
    'planHash',
    'inventoryReportHash',
    'targets',
    'rollbackAvailable',
    'resumeAvailable',
  ]);
  const journalState = text(payload.journalState, 'migration status.journalState');
  const effectiveState = text(payload.effectiveState, 'migration status.effectiveState');
  if (!JOURNAL_STATES.has(journalState)) invalid('migration status.journalState');
  if (!EFFECTIVE_STATES.has(effectiveState)) invalid('migration status.effectiveState');
  const targets = array(payload.targets, 'migration status.targets').map(parseTargetStatus);
  if (!targets.length) invalid('migration status.targets', 'must not be empty');
  unique(
    targets.map(({ sourcePath }) => sourcePath),
    'migration status.targets',
  );
  const rollbackAvailable = boolean(payload.rollbackAvailable, 'migration status.rollbackAvailable');
  const resumeAvailable = boolean(payload.resumeAvailable, 'migration status.resumeAvailable');
  const targetStates = new Set(targets.map(({ state }) => state));
  const expectedEffectiveState =
    targetStates.size === 1 && targetStates.has('applied')
      ? 'applied'
      : targetStates.size === 1 && targetStates.has('source')
        ? 'rolled_back'
        : [...targetStates].every((targetState) => targetState === 'source' || targetState === 'applied')
          ? 'interrupted'
          : 'conflict';
  if (
    effectiveState !== expectedEffectiveState ||
    resumeAvailable !== false ||
    rollbackAvailable !== ['applied', 'interrupted', 'rolled_back'].includes(effectiveState)
  )
    invalid('migration status', 'has inconsistent recovery actions');
  return {
    migrationId: text(payload.migrationId, 'migration status.migrationId', MIGRATION_ID),
    journalState: journalState as CompositeMigrationStatus['journalState'],
    effectiveState: effectiveState as CompositeMigrationStatus['effectiveState'],
    planHash: text(payload.planHash, 'migration status.planHash', SHA256),
    inventoryReportHash: text(payload.inventoryReportHash, 'migration status.inventoryReportHash', SHA256),
    targets,
    rollbackAvailable,
    resumeAvailable: false,
  };
}

export function parseCompositeMigrationListResponse(value: unknown) {
  const response = record(value, 'migration list response');
  exactKeys(response, 'migration list response', ['error', 'schemaVersion', 'migrations']);
  if (response.error !== false || response.schemaVersion !== 1)
    invalid('migration list response', 'uses an unsupported contract');
  const migrations = array(response.migrations, 'migration list response.migrations').map(
    parseCompositeMigrationStatus,
  );
  unique(
    migrations.map(({ migrationId }) => migrationId),
    'migration list response.migrations',
  );
  return { schemaVersion: 1 as const, migrations };
}

export function parseCompositeMigrationStatusResponse(value: unknown) {
  const response = record(value, 'migration status response');
  exactKeys(response, 'migration status response', ['error', 'status']);
  if (response.error !== false) invalid('migration status response.error', 'must be false');
  return parseCompositeMigrationStatus(response.status);
}

function parseMutationResponse(value: unknown, pathKey: 'changedPaths' | 'restoredPaths') {
  const response = record(value, 'migration mutation response');
  exactKeys(response, 'migration mutation response', ['error', 'idempotent', 'status'], [pathKey]);
  if (response.error !== false) invalid('migration mutation response.error', 'must be false');
  const status = parseCompositeMigrationStatus(response.status);
  const paths =
    response[pathKey] === undefined
      ? undefined
      : array(response[pathKey], `migration mutation response.${pathKey}`).map((path, index) =>
          text(path, `migration mutation response.${pathKey}[${index}]`, TARGET_PATH),
        );
  if (paths) {
    unique(paths, `migration mutation response.${pathKey}`);
    const targets = new Set(status.targets.map(({ sourcePath }) => sourcePath));
    if (paths.some((path) => !targets.has(path))) invalid(`migration mutation response.${pathKey}`, 'is not a target');
  }
  return {
    idempotent: boolean(response.idempotent, 'migration mutation response.idempotent'),
    ...(pathKey === 'changedPaths' && paths ? { changedPaths: paths } : {}),
    ...(pathKey === 'restoredPaths' && paths ? { restoredPaths: paths } : {}),
    status,
  } as CompositeMigrationMutationResult;
}

export function parseCompositeMigrationApplyResponse(value: unknown) {
  const result = parseMutationResponse(value, 'changedPaths');
  if (result.status.effectiveState !== 'applied')
    invalid('migration apply result.status', 'did not reach the applied state');
  return result;
}

export function parseCompositeMigrationRollbackResponse(value: unknown) {
  const result = parseMutationResponse(value, 'restoredPaths');
  if (result.status.effectiveState !== 'rolled_back')
    invalid('migration rollback result.status', 'did not reach the rolled-back state');
  return result;
}

export function formatCompositeMigrationError(error: unknown, fallback: string) {
  const message = formatRequestError(error, fallback);
  if (error instanceof RequestError && error.status === 403) return `Authorization rejected (HTTP 403): ${message}`;
  if (error instanceof RequestError && error.status === 409) return `Migration state conflict (HTTP 409): ${message}`;
  return message;
}

export function fetchCompositeMigrationPreview(compilerSupplement?: RegisteredClusterCompilerSupplement) {
  const supplement =
    compilerSupplement === undefined ? undefined : parseRegisteredClusterCompilerSupplement(compilerSupplement);
  return requestJson(`${config.serverAddress}/studio/composite-migrations/preview`, {
    ...(supplement
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ compilerSupplement: supplement }),
        }
      : {}),
    timeoutMs: 30_000,
    parse: parseCompositeMigrationPreviewResponse,
  });
}

export function fetchCompositeMigrationList() {
  return requestJson(`${config.serverAddress}/studio/composite-migrations`, {
    timeoutMs: 30_000,
    parse: parseCompositeMigrationListResponse,
  });
}

export async function fetchCompositeMigrationStatus(migrationId: string) {
  text(migrationId, 'migrationId', MIGRATION_ID);
  const status = await requestJson(
    `${config.serverAddress}/studio/composite-migrations/${encodeURIComponent(migrationId)}`,
    { timeoutMs: 30_000, parse: parseCompositeMigrationStatusResponse },
  );
  if (status.migrationId !== migrationId) invalid('migration status.migrationId', 'does not match the request');
  return status;
}

export async function applyCompositeMigration(
  preview: CompositeMigrationPreview,
  options: {
    confirmation: string;
    allowBlockedCandidates: boolean;
    compilerSupplement?: RegisteredClusterCompilerSupplement;
  },
) {
  if (options.confirmation !== COMPOSITE_MIGRATION_APPLY_CONFIRMATION)
    throw new Error(`Type ${COMPOSITE_MIGRATION_APPLY_CONFIRMATION} exactly before applying.`);
  if (typeof options.allowBlockedCandidates !== 'boolean')
    throw new Error('Choose explicitly whether blocked candidates may remain before applying.');
  const reviewed = parseCompositeMigrationPreviewResponse({ error: false, preview });
  const compilerSupplement =
    options.compilerSupplement === undefined
      ? undefined
      : parseRegisteredClusterCompilerSupplement(options.compilerSupplement);
  if (Boolean(reviewed.compilerSupplement) !== Boolean(compilerSupplement))
    throw new Error('Apply must reuse the exact compiler supplement from the reviewed preview.');
  if (
    reviewed.compilerSupplement &&
    compilerSupplement &&
    (reviewed.compilerSupplement.sourceCount !== compilerSupplement.compilerOutputs.length ||
      reviewed.compilerSupplement.conversionCount !==
        compilerSupplement.compilerOutputs.reduce((count, output) => count + output.conversions.length, 0))
  )
    throw new Error('Apply compiler supplement does not match the reviewed preview counts.');
  if (reviewed.summary.blockedCandidateCount > 0 && !options.allowBlockedCandidates)
    throw new Error('Explicitly allow blocked candidates to remain unchanged before applying safe targets.');
  const result = await requestJson(`${config.serverAddress}/studio/composite-migrations/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      migrationId: reviewed.migrationId,
      planHash: reviewed.planHash,
      confirmation: options.confirmation,
      allowBlockedCandidates: options.allowBlockedCandidates,
      ...(compilerSupplement ? { compilerSupplement } : {}),
    }),
    timeoutMs: 120_000,
    parse: parseCompositeMigrationApplyResponse,
  });
  if (result.status.migrationId !== reviewed.migrationId || result.status.planHash !== reviewed.planHash)
    invalid('migration apply result', 'does not match the reviewed preview');
  return result;
}

export async function rollbackCompositeMigration(migrationId: string, confirmation: string) {
  text(migrationId, 'migrationId', MIGRATION_ID);
  if (confirmation !== COMPOSITE_MIGRATION_ROLLBACK_CONFIRMATION)
    throw new Error(`Type ${COMPOSITE_MIGRATION_ROLLBACK_CONFIRMATION} exactly before rollback.`);
  const result = await requestJson(
    `${config.serverAddress}/studio/composite-migrations/${encodeURIComponent(migrationId)}/rollback`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation }),
      timeoutMs: 120_000,
      parse: parseCompositeMigrationRollbackResponse,
    },
  );
  if (result.status.migrationId !== migrationId)
    invalid('migration rollback result', 'does not match the requested journal');
  return result;
}
