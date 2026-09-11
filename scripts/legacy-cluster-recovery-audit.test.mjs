import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;
const COMMIT = 'd'.repeat(40);
const STUDIO_SPEC = {
  id: 'historical-qwen:text2image:v1',
  contentHash: 'studio-spec-v1-1234abcd',
  executionProfileId: 'historical-qwen:modular',
};

let api;
let components;
let server;

before(async () => {
  globalThis.window = { location: { origin: 'http://127.0.0.1:5191' } };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  api = await server.ssrLoadModule('/src/studio/legacyClusterRecoveryAuditApi.ts');
  components = await server.ssrLoadModule('/src/components/CompositeMigrationCard.tsx');
});

after(async () => {
  await server?.close();
});

function recoveryAuditResponse() {
  return {
    error: false,
    audit: {
      schemaVersion: 4,
      kind: 'registered_cluster_manifest_recovery_audit',
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
      localEvidence: {
        registeredArchivedDefinitionCount: 0,
        reviewedSemanticEquivalenceReceiptCount: 0,
        checkedInReviewedCompilerMappingCount: 0,
        checkedInReviewedCompilerMappingLedgerHash: null,
        workflowEmbeddedCompleteDefinitionInstanceCount: 0,
        checkedInRecoveredStudioSpecSourceCount: 1,
        checkedInRecoveredStudioSpecBodyCount: 1,
        checkedInRecoveredStudioSpecEvidenceHash: HASH_A,
        checkedInPartialReviewCount: 0,
        checkedInPartialReviewLedgerHash: HASH_B,
        migrationStorage: {},
      },
      summary: {
        legacyClusterInstanceCount: 2,
        definitionIdentityCount: 1,
        currentManifestExactInstanceCount: 0,
        currentManifestExactIdentityCount: 0,
        currentExecutionTupleExactInstanceCount: 0,
        currentExecutionTupleExactIdentityCount: 0,
        archivedManifestExactInstanceCount: 0,
        archivedManifestExactIdentityCount: 0,
        semanticEquivalenceReviewedInstanceCount: 0,
        semanticEquivalenceReviewedIdentityCount: 0,
        compilerMappingEligibleInstanceCount: 0,
        compilerMappingEligibleIdentityCount: 0,
        remainingBlockedHistoricalInstanceCount: 2,
        remainingBlockedHistoricalIdentityCount: 1,
        historicalEvidenceRequiredInstanceCount: 2,
        historicalEvidenceRequiredIdentityCount: 1,
        completeExecutionReceiptInstanceCount: 2,
        missingExecutionReceiptInstanceCount: 0,
        missingExecutionReceiptIdentityCount: 0,
        incompleteExecutionReceiptInstanceCount: 0,
        incompleteExecutionReceiptIdentityCount: 0,
        identityReferenceOnlyInstanceCount: 2,
        embeddedCompleteDefinitionInstanceCount: 0,
        presentationProjectionInstanceCount: 2,
        presentationProjectionNodeCount: 12,
        malformedIdentityInstanceCount: 0,
        malformedIdentityCount: 0,
        recoveredStudioSpecBodyCount: 1,
        recoveredStudioSpecManifestIdentityCount: 1,
        recoveredStudioSpecExecutionTupleCount: 1,
        recoveredStudioSpecInstanceCount: 2,
        partialReviewVerifiedExecutionTupleCount: 0,
        partialReviewRejectedExecutionTupleCount: 0,
      },
      partialStudioSpecEvidence: {
        status: 'matched',
        authorizesConversion: false,
        sources: [
          {
            sourceId: 'reviewed-frontend-capture',
            artifactLabel: 'sanitized historical frontend capture',
            compressedSha256: HASH_A,
            compressedBytes: 512,
            uncompressedSha256: HASH_B,
            uncompressedBytes: 4096,
            selector: '/nodes/studioModelCapabilities/*/studioExecutionSpecs/*',
            candidateSpecificationCount: 1,
          },
        ],
        specifications: [
          {
            identity: { ...STUDIO_SPEC },
            canonicalBodySha256: HASH_C,
            sourceIds: ['reviewed-frontend-capture'],
            authorizesConversion: false,
            specification: {
              schemaVersion: 1,
              canonicalizationVersion: 1,
              id: STUDIO_SPEC.id,
              modelType: 'historical-qwen',
              mode: 'text-to-image',
              executionProfileId: STUDIO_SPEC.executionProfileId,
              loaderModule: 'Diffusers',
              loaderAction: 'LoadPipeline',
              executionPath: 'modular-diffusers',
              pipelineClass: 'HistoricalModularPipeline',
              defaultRepo: 'owner/historical-model',
              roles: [{ id: 'models' }, { id: 'denoise' }],
              edges: [['models', 'pipeline', 'denoise', 'pipeline']],
              bindings: [['denoise', 'prompt', 'prompt']],
              autoFields: [],
              actions: [],
              contentHash: STUDIO_SPEC.contentHash,
            },
          },
        ],
        manualReviews: [],
      },
      identities: [
        {
          definitionId: 'diffusers.modular:HistoricalModularPipeline:text2image',
          libraryRevision: COMMIT,
          manifestContentHash: HASH_A,
          admissionIds: ['diffusers.cluster-admission:historical:text2image'],
          instanceCount: 2,
          disposition: 'historical_manifest_evidence_required',
          sourceEvidence: {
            embeddedManifest: {
              identityReferenceOnlyInstanceCount: 2,
              completeDefinitionBodyInstanceCount: 0,
              incompleteOrInvalidInstanceCount: 0,
            },
            executionReceipt: { completeInstanceCount: 2, missingInstanceCount: 0, incompleteInstanceCount: 0 },
            presentationProjection: { instanceCount: 2, nodeCount: 12, isDefinitionOrExecutionAuthority: false },
            currentCatalog: { status: 'definition_id_absent' },
            registeredArchive: { status: 'missing' },
            reviewedSemanticEquivalence: { status: 'missing' },
            recoveredStudioSpecs: {
              status: 'partial_evidence_available',
              specificationBodyCount: 1,
              executionTupleCount: 1,
              instanceCount: 2,
              verifiedPartialReviewExecutionTupleCount: 0,
              rejectedPartialReviewExecutionTupleCount: 0,
              isManifestDefinitionOrConversionAuthority: false,
            },
          },
          executionTuples: [
            {
              admissionId: 'diffusers.cluster-admission:historical:text2image',
              studioExecutionSpec: { ...STUDIO_SPEC },
              instanceCount: 2,
              recoveredStudioSpec: {
                status: 'self_hash_valid_partial_evidence',
                canonicalBodySha256: HASH_C,
                sourceIds: ['reviewed-frontend-capture'],
                authorizesConversion: false,
              },
              manualReview: { status: 'unreviewed', authorizesConversion: false },
            },
          ],
          missingEvidence: [
            {
              code: 'historical_manifest_definition_body_missing',
              message: 'The exact historical manifest body is not available.',
            },
          ],
          safeNextActions: [
            {
              code: 'recover_canonical_archived_definition',
              message: 'Recover and authenticate the exact archived definition.',
            },
          ],
        },
      ],
      contentHash: HASH_B,
    },
  };
}

test('schema-v4 recovery evidence parses and renders mapping progress as a read-only projection', () => {
  const parsed = api.parseLegacyClusterRecoveryAuditResponse(recoveryAuditResponse());
  assert.equal(parsed.schemaVersion, 4);
  assert.equal(parsed.specifications.length, 1);
  assert.equal(parsed.specifications[0].roleCount, 2);
  assert.equal(parsed.specifications[0].edgeCount, 1);
  assert.equal(parsed.identities[0].executionTuples[0].recoveredStudioSpec.authorizesConversion, false);

  const markup = renderToStaticMarkup(
    React.createElement(components.LegacyClusterRecoveryEvidencePanel, {
      audit: parsed,
      error: null,
      loading: false,
      onRefresh: () => undefined,
    }),
  );
  assert.match(markup, /2 saved Clusters/u);
  assert.match(markup, /0 mapping-ready instances/u);
  assert.match(markup, /2 historical still blocked/u);
  assert.match(markup, /1 blocked identity/u);
  assert.match(markup, /1 recovered bodies/u);
  assert.match(markup, /historical-qwen:text2image:v1/u);
  assert.match(markup, /conversion authority: none/u);
  assert.match(markup, /Read-only boundary/u);

  const buttons = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/gu) ?? [];
  assert.equal(buttons.length, 1, 'the evidence projection exposes only its refresh action');
  assert.match(buttons[0], /legacy-cluster-recovery-evidence-refresh/u);
  assert.match(buttons[0], /Refresh evidence/u);
  assert.doesNotMatch(markup, /data-testid="[^"]*(?:convert|apply|execute)[^"]*"/iu);
});

test('schema-v4 recovery evidence rejects any conversion authority', () => {
  const rootAuthority = recoveryAuditResponse();
  rootAuthority.audit.partialStudioSpecEvidence.authorizesConversion = true;
  assert.throws(
    () => api.parseLegacyClusterRecoveryAuditResponse(rootAuthority),
    /partialStudioSpecEvidence grants authority/u,
  );

  const specificationAuthority = recoveryAuditResponse();
  specificationAuthority.audit.partialStudioSpecEvidence.specifications[0].authorizesConversion = true;
  assert.throws(
    () => api.parseLegacyClusterRecoveryAuditResponse(specificationAuthority),
    /specifications\[0\] grants authority/u,
  );

  const compilerMappingAuthority = recoveryAuditResponse();
  compilerMappingAuthority.audit.boundary.compilerMappingPresenceAloneDoesNotAuthorizeConversion = false;
  assert.throws(
    () => api.parseLegacyClusterRecoveryAuditResponse(compilerMappingAuthority),
    /weakens the read-only evidence boundary/u,
  );
});

test('schema-v4 recovery evidence rejects unknown fields and inconsistent aggregate counts', () => {
  const unknown = recoveryAuditResponse();
  unknown.audit.unreviewedField = 'unsafe';
  assert.throws(() => api.parseLegacyClusterRecoveryAuditResponse(unknown), /missing or unknown fields/u);

  const inconsistent = recoveryAuditResponse();
  inconsistent.audit.summary.definitionIdentityCount = 2;
  inconsistent.audit.summary.remainingBlockedHistoricalIdentityCount = 2;
  assert.throws(() => api.parseLegacyClusterRecoveryAuditResponse(inconsistent), /summary\.definitionIdentityCount/u);

  const inconsistentProgress = recoveryAuditResponse();
  inconsistentProgress.audit.summary.remainingBlockedHistoricalInstanceCount = 1;
  assert.throws(
    () => api.parseLegacyClusterRecoveryAuditResponse(inconsistentProgress),
    /inconsistent historical compiler-mapping progress/u,
  );
});
