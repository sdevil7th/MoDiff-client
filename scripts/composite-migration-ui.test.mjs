import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;
const MIGRATION_ID = `block-v2-migration-${'d'.repeat(24)}`;

let api;
let components;
let schema;
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
  api = await server.ssrLoadModule('/src/studio/compositeMigrationApi.ts');
  components = await server.ssrLoadModule('/src/components/CompositeMigrationCard.tsx');
  schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
});

after(async () => {
  await server?.close();
});

function previewResponse() {
  const convertible = {
    kind: 'reusable_v1_definition',
    sourcePath: 'studio/blocks/portrait-user-node.json',
    id: 'portrait-user-node',
    status: 'convertible',
    targetAfterSha256: HASH_B,
  };
  const blocked = {
    kind: 'legacy_registered_cluster_instance',
    sourcePath: 'user-workflows/mixed-workflow.json',
    id: 'cluster-root',
    status: 'blocked',
    reason: 'Requires the exact pinned registered-catalog BlockDefinitionV2 compiler output.',
  };
  return {
    error: false,
    preview: {
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
        containsPromptAndParameterValues: false,
      },
      inventoryReportHash: HASH_A,
      sourceSetHash: HASH_C,
      summary: {
        sourceCount: 2,
        targetFileCount: 1,
        convertibleCandidateCount: 1,
        blockedCandidateCount: 1,
        legacyClusterBlockedCount: 1,
        hasChanges: true,
      },
      targets: [
        {
          sourcePath: 'studio/blocks/portrait-user-node.json',
          kind: 'reusable_v1_definition',
          beforeSha256: HASH_A,
          afterSha256: HASH_B,
          convertedIds: ['portrait-user-node'],
          byteLength: 2048,
        },
      ],
      candidates: [blocked, convertible],
      blocked: [blocked],
      inventoryIssues: [
        {
          sourcePath: 'user-workflows/mixed-workflow.json',
          path: 'composites.cluster-root',
          code: 'registered_catalog_external',
          severity: 'warning',
          message: 'Registered catalog definitions are reviewed separately.',
        },
      ],
      migrationId: MIGRATION_ID,
      planHash: HASH_C,
    },
  };
}

function semanticEquivalenceAuthority() {
  return {
    receiptId: 'legacy-cluster-equivalence:test:text2image:2026-09-02',
    receiptHash: HASH_A,
    historical: {
      manifestDefinitionId: 'diffusers.modular:HistoricalPipeline:text2image',
      libraryRevision: '1'.repeat(40),
      manifestContentHash: HASH_B,
      executionAdmissionId: 'diffusers.cluster-admission:historical',
      studioExecutionSpec: {
        id: 'historical-spec:v1',
        contentHash: 'studio-spec-v1-12345678',
        executionProfileId: 'historical-profile',
      },
      executionGraphHash: HASH_A,
      interfaceHash: HASH_B,
    },
    destination: {
      manifestDefinitionId: 'diffusers.modular:CurrentPipeline:text2image',
      libraryRevision: 'a'.repeat(40),
      manifestContentHash: HASH_C,
      executionAdmissionId: 'diffusers.cluster-admission:current',
      blockDefinitionId: 'current-text2image-v2',
      blockDefinitionContentHash: 'block-definition-v2-1234abcd',
      blockDefinitionCanonicalSha256: HASH_A,
      executionGraphHash: 'block-graph-v2-1234abcd',
      interfaceHash: 'block-interface-v2-1234abcd',
    },
    review: {
      decision: 'semantic_equivalent',
      issuer: 'workspace_owner:test-reviewer',
      reviewedAt: '2026-09-02T12:00:00+05:30',
      notes: 'Reviewed every historical block, port, value binding, preview, and execution edge.',
    },
  };
}

function registeredCompilerSupplement() {
  const graphWithoutHash = {
    nodes: [
      {
        nodeId: 'generate',
        nodeType: 'custom',
        data: {
          action: 'Generate',
          module: 'modules.Test',
          params: {
            image: { display: 'output', type: 'image', value: null },
            prompt: { default: 'starter prompt', type: 'string', value: 'persisted prompt' },
          },
        },
        semanticRole: 'generate',
      },
    ],
    edges: [],
    executionOrder: ['generate'],
  };
  const graph = { ...graphWithoutHash, graphHash: schema.blockGraphHashV2(graphWithoutHash) };
  const withoutContentHash = {
    schemaVersion: 2,
    definitionId: 'diffusers:TestModularPipeline:text2image',
    displayName: 'Test registered Cluster',
    source: {
      kind: 'diffusers_catalog',
      catalogCategory: 'diffusers',
      provider: 'diffusers',
      library: 'diffusers',
      libraryRevision: 'diffusers-main-2026-08-23',
      pipelineClass: 'TestModularPipeline',
      workflow: 'text2image',
      manifestDefinitionId: 'diffusers:TestModularPipeline:text2image',
      manifestContentHash: 'manifest-content-a',
      executionAdmissionId: 'diffusers:admission:TestModularPipeline:text2image',
    },
    graph,
    boundary: {
      mode: 'explicit',
      inputs: [
        {
          portId: 'prompt-in',
          label: 'Prompt',
          valueType: 'string',
          required: true,
          binding: { nodeId: 'generate', fieldOrPortId: 'prompt' },
        },
      ],
      outputs: [
        {
          portId: 'image-out',
          label: 'Image',
          valueType: 'image',
          required: false,
          binding: { nodeId: 'generate', fieldOrPortId: 'image' },
        },
      ],
    },
    controls: [
      {
        controlId: 'prompt-in',
        label: 'Prompt',
        binding: { nodeId: 'generate', fieldId: 'prompt' },
        valueType: 'string',
        defaultValue: 'starter prompt',
        required: true,
        order: 0,
      },
    ],
    suggestedInputs: [
      {
        suggestionId: 'publisher-example',
        label: 'Publisher example',
        source: 'https://huggingface.co/owner/model',
        values: { 'prompt-in': 'publisher prompt' },
      },
    ],
    previews: [{ nodeId: 'generate', outputPortId: 'image', mediaType: 'image', primary: true }],
    ownership: { kind: 'registered', definitionMutable: false },
  };
  const definition = {
    ...withoutContentHash,
    contentHash: schema.blockDefinitionContentHashV2(withoutContentHash),
  };
  const blockInstanceV2 = schema.createBlockInstanceV2(definition, {
    instanceId: 'cluster-root',
    position: { x: 120, y: 80 },
    size: { width: 420, height: 480 },
    values: { 'prompt-in': 'persisted prompt' },
    internalLayout: { generate: { x: 24, y: 36, width: 320, height: 240 } },
  });
  return {
    schemaVersion: 1,
    kind: 'registered_cluster_v2_compiler_supplement',
    compilerOutputs: [
      {
        sourcePath: 'user-workflows/mixed-workflow.json',
        sourceSha256: HASH_A,
        conversions: [
          {
            legacyInstanceId: 'cluster-root',
            legacyCompositeHash: HASH_B,
            admissionId: 'diffusers:admission:TestModularPipeline:text2image',
            compiledDefinitionContentHash: definition.contentHash,
            compiledDefinitionCanonicalSha256: HASH_C,
            blockInstanceV2,
            ownedNodeMappings: [{ legacyNodeId: 'cluster-generate', semanticNodeId: 'generate' }],
            portMappings: [
              {
                direction: 'input',
                legacyNodeId: 'cluster-root',
                legacyPortId: 'prompt-in',
                v2PortId: 'prompt-in',
              },
              {
                direction: 'output',
                legacyNodeId: 'cluster-root',
                legacyPortId: 'image-out',
                v2PortId: 'image-out',
              },
            ],
            valueMappings: [
              {
                sourceKind: 'node_param',
                sourceNodeId: 'cluster-generate',
                sourceFieldId: 'prompt',
                targetKind: 'instance_value',
                targetValueId: 'prompt-in',
              },
            ],
            previewMappings: [],
            absorbedInternalEdgeIds: [],
          },
        ],
      },
    ],
  };
}

function compiledPreviewResponse(supplement = registeredCompilerSupplement()) {
  const conversion = supplement.compilerOutputs[0].conversions[0];
  const candidate = {
    kind: 'legacy_registered_cluster_instance',
    sourcePath: 'user-workflows/mixed-workflow.json',
    sourceSha256: HASH_A,
    legacyCompositeHash: HASH_B,
    id: 'cluster-root',
    status: 'convertible',
    targetAfterSha256: HASH_B,
    compilerReceipt: {
      instanceId: 'cluster-root',
      definitionId: conversion.blockInstanceV2.definitionRef.definitionId,
      admissionId: conversion.admissionId,
      compiledDefinitionContentHash: conversion.compiledDefinitionContentHash,
      compiledDefinitionCanonicalSha256: conversion.compiledDefinitionCanonicalSha256,
      legacyCompositeHash: conversion.legacyCompositeHash,
      absorbedProjectionNodeIds: ['cluster-generate'],
      absorbedInternalEdgeIds: [],
    },
  };
  return {
    error: false,
    preview: {
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
        compilerSupplementRequiredForRegisteredClusters: true,
        containsPromptAndParameterValues: false,
      },
      compilerSupplement: {
        provided: true,
        contentHash: HASH_C,
        sourceCount: 1,
        conversionCount: 1,
      },
      inventoryReportHash: HASH_A,
      sourceSetHash: HASH_C,
      summary: {
        sourceCount: 1,
        targetFileCount: 1,
        convertibleCandidateCount: 1,
        blockedCandidateCount: 0,
        legacyClusterBlockedCount: 0,
        registeredClusterConvertibleCount: 1,
        hasChanges: true,
      },
      targets: [
        {
          sourcePath: 'user-workflows/mixed-workflow.json',
          kind: 'workflow_composite_instances',
          beforeSha256: HASH_A,
          afterSha256: HASH_B,
          convertedIds: ['cluster-root'],
          byteLength: 4096,
        },
      ],
      candidates: [candidate],
      blocked: [],
      inventoryIssues: [],
      migrationId: MIGRATION_ID,
      planHash: HASH_C,
    },
  };
}

function status(effectiveState = 'applied', sourcePath = 'studio/blocks/portrait-user-node.json') {
  const targetState =
    effectiveState === 'rolled_back' ? 'source' : effectiveState === 'conflict' ? 'conflict' : 'applied';
  return {
    migrationId: MIGRATION_ID,
    journalState:
      effectiveState === 'rolled_back'
        ? 'rolled_back'
        : effectiveState === 'conflict'
          ? 'recovery_required'
          : 'applied',
    effectiveState,
    planHash: HASH_C,
    inventoryReportHash: HASH_A,
    targets: [
      {
        sourcePath,
        currentSha256: targetState === 'conflict' ? HASH_C : targetState === 'source' ? HASH_A : HASH_B,
        state: targetState,
      },
    ],
    rollbackAvailable: effectiveState !== 'conflict',
    resumeAvailable: false,
  };
}

function jsonResponse(value, statusCode = 200) {
  return new Response(JSON.stringify(value), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('strict migration response parsers enforce the read-only plan and recovery invariants', () => {
  const parsed = api.parseCompositeMigrationPreviewResponse(previewResponse());
  assert.equal(parsed.mode, 'read_only_preview');
  assert.equal(parsed.boundary.writesFiles, false);
  assert.deepEqual(
    parsed.targets.map(({ sourcePath }) => sourcePath),
    ['studio/blocks/portrait-user-node.json'],
  );
  assert.equal(parsed.blocked[0].id, 'cluster-root');

  const unknown = structuredClone(previewResponse());
  unknown.preview.unreviewedField = true;
  assert.throws(() => api.parseCompositeMigrationPreviewResponse(unknown), /unknown keys unreviewedField/u);

  const unsafe = structuredClone(previewResponse());
  unsafe.preview.boundary.writesFiles = true;
  assert.throws(() => api.parseCompositeMigrationPreviewResponse(unsafe), /read-only safety contract/u);

  const mismatched = structuredClone(previewResponse());
  mismatched.preview.summary.blockedCandidateCount = 0;
  assert.throws(() => api.parseCompositeMigrationPreviewResponse(mismatched), /listed targets and candidates/u);

  const parsedList = api.parseCompositeMigrationListResponse({
    error: false,
    schemaVersion: 1,
    migrations: [status('applied')],
  });
  assert.equal(parsedList.migrations[0].targets[0].state, 'applied');
  const inconsistentStatus = status('conflict');
  inconsistentStatus.rollbackAvailable = true;
  assert.throws(() => api.parseCompositeMigrationStatus(inconsistentStatus), /inconsistent recovery actions/u);
});

test('strict registered-Cluster compiler supplement parser preserves the normalized Block V2 instance', () => {
  const fixture = registeredCompilerSupplement();
  const parsed = api.parseRegisteredClusterCompilerSupplement(fixture);
  assert.deepEqual(parsed, fixture);
  assert.equal(parsed.compilerOutputs[0].conversions[0].blockInstanceV2.schemaVersion, 2);
  assert.equal(parsed.compilerOutputs[0].conversions[0].previewMappings.length, 0);

  const historical = structuredClone(fixture);
  historical.compilerOutputs[0].conversions[0].semanticEquivalenceReceipt = {
    receiptId: semanticEquivalenceAuthority().receiptId,
    receiptHash: semanticEquivalenceAuthority().receiptHash,
  };
  const parsedHistorical = api.parseRegisteredClusterCompilerSupplement(historical);
  assert.deepEqual(
    parsedHistorical.compilerOutputs[0].conversions[0].semanticEquivalenceReceipt,
    historical.compilerOutputs[0].conversions[0].semanticEquivalenceReceipt,
  );

  const augmented = api.parseCompositeMigrationPreviewResponse(compiledPreviewResponse(fixture));
  assert.equal(augmented.compilerSupplement?.conversionCount, 1);
  assert.equal(augmented.summary.registeredClusterConvertibleCount, 1);
  assert.equal(augmented.candidates[0].compilerReceipt?.instanceId, 'cluster-root');

  const unknown = structuredClone(fixture);
  unknown.compilerOutputs[0].conversions[0].unsafeField = true;
  assert.throws(() => api.parseRegisteredClusterCompilerSupplement(unknown), /contains unknown keys unsafeField/u);

  const unordered = structuredClone(fixture);
  unordered.compilerOutputs[0].conversions[0].portMappings.reverse();
  assert.throws(
    () => api.parseRegisteredClusterCompilerSupplement(unordered),
    /must be unique and canonically ordered/u,
  );

  const malformedInstance = structuredClone(fixture);
  malformedInstance.compilerOutputs[0].conversions[0].blockInstanceV2.presentation.position.x = Number.NaN;
  assert.throws(() => api.parseRegisteredClusterCompilerSupplement(malformedInstance), /Block Instance V2/u);
});

test('historical semantic-equivalence preview exposes only the reviewed hash diff and stays non-mutating', () => {
  const response = previewResponse();
  const authority = semanticEquivalenceAuthority();
  response.preview.candidates[0].semanticEquivalenceAuthority = authority;
  response.preview.blocked[0].semanticEquivalenceAuthority = authority;
  response.preview.candidates[0].reason =
    'A checked-in historical semantic-equivalence receipt is available; requires an exact compiler output that references it.';
  response.preview.blocked[0].reason = response.preview.candidates[0].reason;

  const preview = api.parseCompositeMigrationPreviewResponse(response);
  assert.deepEqual(preview.candidates[0].semanticEquivalenceAuthority, authority);
  assert.equal(preview.boundary.writesFiles, false);
  const markup = renderToStaticMarkup(React.createElement(components.CompositeMigrationPreviewDetails, { preview }));
  assert.match(markup, /Reviewed historical equivalence \(preview only\)/u);
  assert.match(markup, /workspace_owner:test-reviewer/u);
  assert.match(markup, /block-graph-v2-1234abcd/u);
  assert.match(markup, /does not apply or mutate a workflow/u);

  const malformed = previewResponse();
  malformed.preview.candidates[0].semanticEquivalenceAuthority = structuredClone(authority);
  malformed.preview.blocked[0].semanticEquivalenceAuthority = structuredClone(authority);
  malformed.preview.candidates[0].semanticEquivalenceAuthority.review.reviewedAt = '2026-09-02T12:00:00';
  malformed.preview.blocked[0].semanticEquivalenceAuthority.review.reviewedAt = '2026-09-02T12:00:00';
  assert.throws(() => api.parseCompositeMigrationPreviewResponse(malformed), /offset ISO-8601 timestamp/u);
});

test('mocked API calls send only exact preview identity, opt-in, and literal confirmations', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith('/preview')) return jsonResponse(previewResponse());
    if (pathname.endsWith('/apply')) {
      return jsonResponse({
        error: false,
        idempotent: false,
        changedPaths: ['studio/blocks/portrait-user-node.json'],
        status: status('applied'),
      });
    }
    if (pathname.endsWith('/rollback')) {
      return jsonResponse({
        error: false,
        idempotent: false,
        restoredPaths: ['studio/blocks/portrait-user-node.json'],
        status: status('rolled_back'),
      });
    }
    if (pathname.endsWith(`/${MIGRATION_ID}`)) return jsonResponse({ error: false, status: status('applied') });
    return jsonResponse({ error: false, schemaVersion: 1, migrations: [status('applied')] });
  };
  try {
    const preview = await api.fetchCompositeMigrationPreview();
    await api.fetchCompositeMigrationList();
    await api.fetchCompositeMigrationStatus(MIGRATION_ID);
    await assert.rejects(
      api.applyCompositeMigration(preview, { confirmation: 'yes', allowBlockedCandidates: true }),
      /Type APPLY_BLOCK_V2_MIGRATION exactly/u,
    );
    await assert.rejects(
      api.applyCompositeMigration(preview, {
        confirmation: 'APPLY_BLOCK_V2_MIGRATION',
        allowBlockedCandidates: false,
      }),
      /allow blocked candidates to remain unchanged/u,
    );
    await assert.rejects(api.rollbackCompositeMigration(MIGRATION_ID, 'yes'), /Type ROLLBACK_BLOCK_V2_MIGRATION/u);
    await api.applyCompositeMigration(preview, {
      confirmation: 'APPLY_BLOCK_V2_MIGRATION',
      allowBlockedCandidates: true,
    });
    await api.rollbackCompositeMigration(MIGRATION_ID, 'ROLLBACK_BLOCK_V2_MIGRATION');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 5);
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    migrationId: MIGRATION_ID,
    planHash: HASH_C,
    confirmation: 'APPLY_BLOCK_V2_MIGRATION',
    allowBlockedCandidates: true,
  });
  assert.deepEqual(JSON.parse(calls[4].init.body), {
    confirmation: 'ROLLBACK_BLOCK_V2_MIGRATION',
  });
  assert.equal(calls[3].init.method, 'POST');
  assert.equal(calls[4].init.method, 'POST');
});

test('compiler preview, apply, and rollback reuse one exact parsed supplement', async () => {
  const supplement = api.parseRegisteredClusterCompilerSupplement(registeredCompilerSupplement());
  const compiledResponse = compiledPreviewResponse(supplement);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith('/preview')) return jsonResponse(compiledResponse);
    if (pathname.endsWith('/apply')) {
      return jsonResponse({
        error: false,
        idempotent: false,
        changedPaths: ['user-workflows/mixed-workflow.json'],
        status: status('applied', 'user-workflows/mixed-workflow.json'),
      });
    }
    if (pathname.endsWith('/rollback')) {
      return jsonResponse({
        error: false,
        idempotent: false,
        restoredPaths: ['user-workflows/mixed-workflow.json'],
        status: status('rolled_back', 'user-workflows/mixed-workflow.json'),
      });
    }
    throw new Error(`Unexpected request ${pathname}`);
  };
  try {
    const preview = await api.fetchCompositeMigrationPreview(supplement);
    await assert.rejects(
      api.applyCompositeMigration(preview, {
        confirmation: 'APPLY_BLOCK_V2_MIGRATION',
        allowBlockedCandidates: false,
      }),
      /must reuse the exact compiler supplement/u,
    );
    await api.applyCompositeMigration(preview, {
      confirmation: 'APPLY_BLOCK_V2_MIGRATION',
      allowBlockedCandidates: false,
      compilerSupplement: supplement,
    });
    await api.rollbackCompositeMigration(MIGRATION_ID, 'ROLLBACK_BLOCK_V2_MIGRATION');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 3, 'client-side authority rejection must not reach the backend');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { compilerSupplement: supplement });
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    migrationId: MIGRATION_ID,
    planHash: HASH_C,
    confirmation: 'APPLY_BLOCK_V2_MIGRATION',
    allowBlockedCandidates: false,
    compilerSupplement: supplement,
  });
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    confirmation: 'ROLLBACK_BLOCK_V2_MIGRATION',
  });
});

test('authorization and stale-plan backend failures remain visible and actionable', async () => {
  const preview = api.parseCompositeMigrationPreviewResponse(previewResponse());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({ error: true, message: 'Migration sources changed after preview; request a fresh preview.' }, 409);
  try {
    await assert.rejects(
      api.applyCompositeMigration(preview, {
        confirmation: 'APPLY_BLOCK_V2_MIGRATION',
        allowBlockedCandidates: true,
      }),
      (error) => {
        assert.equal(error.status, 409);
        assert.match(
          api.formatCompositeMigrationError(error, 'Apply failed.'),
          /Migration state conflict \(HTTP 409\)/u,
        );
        assert.match(api.formatCompositeMigrationError(error, 'Apply failed.'), /request a fresh preview/u);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () =>
    jsonResponse({ error: true, message: 'confirmation must equal ROLLBACK_BLOCK_V2_MIGRATION.' }, 403);
  try {
    await assert.rejects(api.rollbackCompositeMigration(MIGRATION_ID, 'ROLLBACK_BLOCK_V2_MIGRATION'), (error) => {
      assert.equal(error.status, 403);
      assert.match(
        api.formatCompositeMigrationError(error, 'Rollback failed.'),
        /Authorization rejected \(HTTP 403\)/u,
      );
      assert.match(api.formatCompositeMigrationError(error, 'Rollback failed.'), /confirmation must equal/u);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('mocked review component shows exact paths and keeps apply gated by both explicit acknowledgements', () => {
  const preview = api.parseCompositeMigrationPreviewResponse(previewResponse());
  const noop = () => undefined;
  const blockedMarkup = renderToStaticMarkup(
    React.createElement(components.CompositeMigrationApplyReview, {
      preview,
      confirmation: 'yes',
      allowBlockedCandidates: false,
      busy: false,
      onConfirmationChange: noop,
      onAllowBlockedCandidatesChange: noop,
      onCancel: noop,
      onApply: noop,
    }),
  );
  assert.match(blockedMarkup, /studio\/blocks\/portrait-user-node\.json/u);
  assert.match(blockedMarkup, /user-workflows\/mixed-workflow\.json/u);
  assert.match(blockedMarkup, /Requires the exact pinned registered-catalog BlockDefinitionV2 compiler output/u);
  assert.match(blockedMarkup, /APPLY_BLOCK_V2_MIGRATION/u);
  const blockedButton = blockedMarkup.match(/<button[^>]*data-testid="composite-migration-apply"[^>]*>/u)?.[0];
  assert.match(blockedButton ?? '', /\sdisabled(?:=""|(?=[ >]))/u);
  assert.equal(components.canApplyCompositeMigration, undefined, 'non-component policy is kept outside the React file');
  assert.equal(api.canApplyCompositeMigration(preview, 'APPLY_BLOCK_V2_MIGRATION', false), false);
  assert.equal(api.canApplyCompositeMigration(preview, 'APPLY_BLOCK_V2_MIGRATION', true), true);

  const enabledMarkup = renderToStaticMarkup(
    React.createElement(components.CompositeMigrationApplyReview, {
      preview,
      confirmation: 'APPLY_BLOCK_V2_MIGRATION',
      allowBlockedCandidates: true,
      busy: false,
      onConfirmationChange: noop,
      onAllowBlockedCandidatesChange: noop,
      onCancel: noop,
      onApply: noop,
    }),
  );
  const enabledButton = enabledMarkup.match(/<button[^>]*data-testid="composite-migration-apply"[^>]*>/u)?.[0];
  assert.doesNotMatch(enabledButton ?? '', /\sdisabled(?:=""|(?=[ >]))/u);
});

test('registered compiler preview and visible generator explain the read-only exact-supplement flow', () => {
  const preview = api.parseCompositeMigrationPreviewResponse(compiledPreviewResponse());
  const details = renderToStaticMarkup(React.createElement(components.CompositeMigrationPreviewDetails, { preview }));
  assert.match(details, /1 registered Blocks compiled/u);
  assert.match(details, new RegExp(HASH_C, 'u'));
  assert.match(details, /user-workflows\/mixed-workflow\.json/u);

  const card = renderToStaticMarkup(React.createElement(components.CompositeMigrationCard));
  assert.match(card, /Registered Block compiler supplement/u);
  assert.match(card, /Recovery journals/u);
  const source = readFileSync(path.join(ROOT, 'src/components/CompositeMigrationCard.tsx'), 'utf8');
  assert.match(source, /Generate exact supplement/u);
  assert.match(source, /Generation and preview are read-only/u);
  assert.match(source, /fetchCompositeMigrationPreview\(\)/u);
  assert.match(source, /generateRegisteredClusterCompilerSupplement/u);
  assert.match(source, /fetchCompositeMigrationPreview\(parsed\)/u);
  assert.match(source, /data-testid="composite-migration-compiler-json"/u);
  assert.match(source, /data-testid="composite-migration-compiler-generate"/u);
  assert.match(source, /data-testid="composite-migration-compiler-cancel"/u);
  assert.match(source, /data-testid="composite-migration-compiler-preview"/u);
  assert.match(source, /compilerSupplementRef\.current = parsed/u);
  assert.match(source, /if \(compilerSupplementRef\.current\)[\s\S]+setPreview\(null\)/u);
  assert.match(source, /applyCompositeMigration\(preview/u);
  assert.match(source, /rollbackCompositeMigration\(rollbackStatus\.migrationId/u);
});

test('mocked recovery component lists exact journal targets and conflict state', () => {
  const markup = renderToStaticMarkup(
    React.createElement(components.CompositeMigrationRecoveryList, {
      migrations: [api.parseCompositeMigrationStatus(status('conflict'))],
      onInspectRollback: () => undefined,
    }),
  );
  assert.match(markup, new RegExp(MIGRATION_ID, 'u'));
  assert.match(markup, /studio\/blocks\/portrait-user-node\.json/u);
  assert.match(markup, /conflict/u);
  assert.doesNotMatch(markup, /Review rollback/u, 'conflicting journals cannot offer a force rollback');
});

test('mocked rollback review requires the exact rollback literal', () => {
  const noop = () => undefined;
  const blockedMarkup = renderToStaticMarkup(
    React.createElement(components.CompositeMigrationRollbackReview, {
      status: api.parseCompositeMigrationStatus(status('applied')),
      confirmation: 'rollback',
      busy: false,
      onConfirmationChange: noop,
      onCancel: noop,
      onRollback: noop,
    }),
  );
  assert.match(blockedMarkup, /ROLLBACK_BLOCK_V2_MIGRATION/u);
  assert.match(blockedMarkup, /studio\/blocks\/portrait-user-node\.json/u);
  const blockedButton = blockedMarkup.match(/<button[^>]*data-testid="composite-migration-rollback"[^>]*>/u)?.[0];
  assert.match(blockedButton ?? '', /\sdisabled(?:=""|(?=[ >]))/u);

  const enabledMarkup = renderToStaticMarkup(
    React.createElement(components.CompositeMigrationRollbackReview, {
      status: api.parseCompositeMigrationStatus(status('applied')),
      confirmation: 'ROLLBACK_BLOCK_V2_MIGRATION',
      busy: false,
      onConfirmationChange: noop,
      onCancel: noop,
      onRollback: noop,
    }),
  );
  const enabledButton = enabledMarkup.match(/<button[^>]*data-testid="composite-migration-rollback"[^>]*>/u)?.[0];
  assert.doesNotMatch(enabledButton ?? '', /\sdisabled(?:=""|(?=[ >]))/u);
});
