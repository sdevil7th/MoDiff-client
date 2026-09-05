import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { currentResourceRouteManifestHash, normalizeCurrentResourceRouteManifest } from './current-resource-routes.mjs';
import { liveProofLockHash, sha256Value } from './live-proof-provenance.mjs';
import {
  recordRouteResourceQualification,
  validateRouteResourceQualificationPair,
  validateRouteResourceWorkloadReceipt,
} from './route-resource-qualification.mjs';
import { resourceRouteBindingHash } from './resource-route-binding.mjs';

const backendSourceFiles = [{ path: 'main.py', sha256: 'c'.repeat(64) }];
const backendSourceGitCommit = 'd'.repeat(40);
const backendSourceFingerprint = sha256Value('backend-source-v1', {
  gitCommit: backendSourceGitCommit,
  files: backendSourceFiles,
});
const backendSourceIdentity = {
  gitCommit: backendSourceGitCommit,
  fingerprint: backendSourceFingerprint,
  files: backendSourceFiles,
};
const backendSourceAttestation = {
  schemaVersion: 1,
  claim: 'process_start_backend_source_identity',
  gitCommit: backendSourceGitCommit,
  fingerprint: backendSourceFingerprint,
  fileCount: backendSourceFiles.length,
  capturedAt: '2026-09-02T00:00:00.000Z',
};

const admissionId = 'diffusers.cluster-admission:TestPipeline:text2image:mode:text_to_image';
const routeBinding = {
  schemaVersion: 1,
  admissionId,
  blockDefinition: {
    definitionId: admissionId,
    contentHash: 'block-definition-v2-1234abcd',
    canonicalSha256: `sha256:${'b'.repeat(64)}`,
  },
  studioExecutionSpec: {
    id: 'test:studio-spec:v1',
    contentHash: 'studio-spec-v1-1234abcd',
    executionProfileId: 'test:exact-route',
  },
  artifact: { repository: 'repo/model', revision: 'a'.repeat(40) },
  modelDependencies: [],
};

function routeManifest(binding = routeBinding) {
  const body = {
    schemaVersion: 1,
    format: 'modiff.current-resource-routes.v1',
    routes: [
      {
        admissionId: binding.admissionId,
        definition: {
          id: 'diffusers.cluster:TestPipeline:text2image',
          contentHash: 'sha256:' + 'c'.repeat(64),
          libraryRevision: 'd'.repeat(40),
          pipelineClass: 'TestPipeline',
          workflowId: 'text2image',
        },
        studioMode: 'text_to_image',
        routeBinding: structuredClone(binding),
        routeBindingHash: resourceRouteBindingHash(binding),
      },
    ],
  };
  return normalizeCurrentResourceRouteManifest({
    ...body,
    manifestHash: currentResourceRouteManifestHash(body),
  });
}

function proof({
  taskId = 'route-task-1',
  capturedAt = '2026-09-02T00:00:00.000Z',
  prompt = 'same exact route workload',
  dtype = 'bfloat16',
  runtimeFingerprint = 'sha256:stable-runtime-v1:test',
  outputHash = 'sha256:decoded-output-v1:first',
  peakMemoryBytes = 12_345,
  binding = routeBinding,
} = {}) {
  const modelItems = [
    {
      repoId: binding.artifact.repository,
      selectedRevision: binding.artifact.revision,
      modelRevision: `${binding.artifact.repository}@${binding.artifact.revision}`,
    },
    ...binding.modelDependencies.map((dependency) => ({
      repoId: dependency.repository,
      selectedRevision: dependency.revision,
      modelRevision: `${dependency.repository}@${dependency.revision}`,
    })),
  ];
  const modelSetHash = sha256Value('model-set-v1', modelItems);
  const value = {
    schemaVersion: 2,
    format: 'modiff.live-proof.provenance.v2',
    taskId,
    capturedAt,
    graphHash: 'sha256:canonical-graph-v1:test',
    runtimeFingerprint,
    backendSourceFingerprint,
    backendContractFingerprint: 'sha256:backend-contract-v1:test',
    modelRevision: modelItems.map((item) => item.modelRevision).join(' | '),
    modelCommit: modelItems.map((item) => `${item.repoId}@${item.selectedRevision}`).join(' | '),
    mediaHash: outputHash,
    inputArtifactsHash: 'sha256:input-artifacts-v1:test',
    routeBinding: structuredClone(binding),
    routeBindingHash: resourceRouteBindingHash(binding),
    template: {
      id: null,
      catalogTemplateLockHash: null,
      promptSettingsHash: null,
      resolvedTemplateLockHash: 'sha256:resolved-template-v1:test',
      revisionHash: 'sha256:template-revision-v1:test',
      lockedSettings: null,
      expectedOutput: { width: 512, height: 512 },
    },
    graph: {
      hash: 'sha256:canonical-graph-v1:test',
      executionPlanHash: 'sha256:execution-plan-v1:test',
      executionPlan: {
        modelType: 'TestPipeline',
        pipelineClass: 'TestPipeline',
        executionPath: 'diffusers_modular_pipeline',
        dtype,
        device: 'cuda:0',
        deviceMap: null,
        offloadMode: 'model_cpu',
        quantizationMode: 'none',
        quantizedComponents: [],
        autoOffload: true,
        attentionBackend: 'auto',
        regionalCompile: false,
        denoiserCache: 'none',
        channelsLast: false,
        layerwiseCasting: false,
      },
      canonicalGraph: {
        schemaVersion: 1,
        deterministicMode: { seed: 42 },
        nodes: [
          {
            key: 'generate',
            module: 'modules.DiffusersImage',
            action: 'Generate',
            params: { prompt: { value: prompt }, steps: { value: 8 } },
          },
        ],
        paths: [],
      },
    },
    execution: {
      resourceCandidateId: 'manual:exact-route',
      elapsedSeconds: 11.5,
      peakMemoryBytes,
      measurement: {
        backend: 'rocm',
        device: 'cuda:0',
        peakReservedBytes: peakMemoryBytes + 100,
        processRssBytes: peakMemoryBytes + 200,
      },
    },
    model: {
      repoId: modelItems.length === 1 ? modelItems[0].repoId : `model-set:${modelSetHash}`,
      selectedRevision:
        modelItems.length === 1
          ? modelItems[0].selectedRevision
          : modelItems.map((item) => item.modelRevision).join(' | '),
      modelRevision: modelItems.map((item) => item.modelRevision).join(' | '),
      fingerprint: modelSetHash,
    },
    models: {
      count: modelItems.length,
      hash: modelSetHash,
      revisionLock: modelItems.map((item) => item.modelRevision).join(' | '),
      commitLock: modelItems.map((item) => `${item.repoId}@${item.selectedRevision}`).join(' | '),
      items: modelItems,
    },
    inputs: { count: 0, hash: 'sha256:input-artifacts-v1:test', items: [] },
    runtime: {
      lockFingerprint: runtimeFingerprint,
      backendSource: structuredClone(backendSourceIdentity),
      backendSourceAttestation: structuredClone(backendSourceAttestation),
      backendContract: { fingerprint: 'sha256:backend-contract-v1:test' },
      deterministic: { fingerprint: 'sha256:deterministic-v1:test' },
    },
    output: {
      count: 1,
      collectionHash: `sha256:decoded-output-collection-v1:${outputHash.split(':').at(-1)}`,
      items: [
        {
          index: 0,
          decodedSha256: outputHash,
          mediaType: 'image',
          width: 512,
          height: 512,
        },
      ],
    },
    blockers: [],
  };
  value.proofLockHash = liveProofLockHash(value);
  return value;
}

function pair() {
  return [
    proof(),
    proof({
      taskId: 'route-task-2',
      capturedAt: '2026-09-02T00:05:00.000Z',
      outputHash: 'sha256:decoded-output-v1:second',
      peakMemoryBytes: 12_678,
    }),
  ];
}

test('accepts only two exact current route proofs with one canonical workload and runtime contract', () => {
  const currentRoute = routeManifest().routes[0];
  const validated = validateRouteResourceQualificationPair({ proofs: pair(), currentRoute });
  assert.equal(validated.routeBindingHash, resourceRouteBindingHash(routeBinding));
  assert.equal(validated.recipe.modelType, 'TestPipeline');
  assert.equal(validated.checked.length, 2);
  assert.notEqual(validated.checked[0].taskId, validated.checked[1].taskId);
});

test('fails closed for one proof, duplicate tasks, sibling routes, workload, recipe, runtime, and measurements', () => {
  const currentRoute = routeManifest().routes[0];
  assert.throws(
    () => validateRouteResourceQualificationPair({ proofs: [proof()], currentRoute }),
    /exactly two retained/u,
  );

  const duplicateTask = pair();
  duplicateTask[1].taskId = duplicateTask[0].taskId;
  assert.throws(
    () => validateRouteResourceQualificationPair({ proofs: duplicateTask, currentRoute }),
    /distinct backend task IDs/u,
  );

  const siblingBinding = structuredClone(routeBinding);
  siblingBinding.admissionId = `${routeBinding.admissionId}:sibling`;
  siblingBinding.blockDefinition.definitionId = siblingBinding.admissionId;
  const sibling = pair();
  sibling[1] = proof({
    taskId: 'route-task-2',
    capturedAt: '2026-09-02T00:05:00.000Z',
    binding: siblingBinding,
  });
  assert.throws(
    () => validateRouteResourceQualificationPair({ proofs: sibling, currentRoute }),
    /exact current registered/u,
  );

  for (const [changed, expected] of [
    [
      proof({ taskId: 'route-task-2', capturedAt: '2026-09-02T00:05:00.000Z', prompt: 'other workload' }),
      /canonical workload/u,
    ],
    [proof({ taskId: 'route-task-2', capturedAt: '2026-09-02T00:05:00.000Z', dtype: 'float16' }), /resource recipe/u],
    [
      proof({
        taskId: 'route-task-2',
        capturedAt: '2026-09-02T00:05:00.000Z',
        runtimeFingerprint: 'sha256:stable-runtime-v1:other',
      }),
      /runtime\/backend\/deterministic contracts/u,
    ],
    [
      proof({ taskId: 'route-task-2', capturedAt: '2026-09-02T00:05:00.000Z', peakMemoryBytes: 0 }),
      /peakMemoryBytes|peak memory/u,
    ],
  ]) {
    assert.throws(() => validateRouteResourceQualificationPair({ proofs: [proof(), changed], currentRoute }), expected);
  }
});

test('requires the complete artifact and dependency model set', () => {
  const dependencyBinding = structuredClone(routeBinding);
  dependencyBinding.modelDependencies = [
    {
      id: 'text-encoder',
      kind: 'text_encoder',
      repository: 'repo/encoder',
      revision: 'e'.repeat(40),
    },
  ];
  const currentRoute = routeManifest(dependencyBinding).routes[0];
  const first = proof({ binding: dependencyBinding });
  const second = proof({
    taskId: 'route-task-2',
    capturedAt: '2026-09-02T00:05:00.000Z',
    binding: dependencyBinding,
  });
  validateRouteResourceQualificationPair({ proofs: [first, second], currentRoute });

  second.models.items.pop();
  second.models.count = second.models.items.length;
  second.models.hash = sha256Value('model-set-v1', second.models.items);
  second.models.revisionLock = second.models.items.map((item) => item.modelRevision).join(' | ');
  second.models.commitLock = second.models.items.map((item) => `${item.repoId}@${item.selectedRevision}`).join(' | ');
  second.proofLockHash = liveProofLockHash(second);
  assert.throws(
    () => validateRouteResourceQualificationPair({ proofs: [first, second], currentRoute }),
    /complete exact route artifact\/dependency model set/u,
  );
});

test('records a non-authorizing two-proof receipt and verifies every retained measurement', async () => {
  const backendRoot = mkdtempSync(join(tmpdir(), 'modiff-route-resource-'));
  try {
    const incoming = join(backendRoot, 'incoming');
    const release = join(backendRoot, 'data', 'qualification', 'release');
    const retained = join(release, 'route-resource-provenance');
    const registryPath = join(release, 'route-resource-workload-receipts.v1.json');
    mkdirSync(incoming, { recursive: true });
    const proofs = pair();
    const provenancePaths = proofs.map((value, index) => {
      const path = join(incoming, `proof-${index}.json`);
      writeFileSync(path, `${JSON.stringify(value)}\n`);
      return path;
    });
    const currentRouteManifest = routeManifest();
    const receipt = await recordRouteResourceQualification({
      provenancePaths,
      registryPath,
      provenanceDir: retained,
      backendRoot,
      currentRouteManifest,
    });
    assert.equal(receipt.familyCoverageDeclared, false);
    assert.equal(receipt.publicationAuthority, false);
    assert.equal(receipt.autoAuthority, false);
    assert.deepEqual(
      receipt.proofs.map((item) => item.taskId),
      ['route-task-1', 'route-task-2'],
    );
    const retainedProofs = receipt.proofs.map((item) =>
      JSON.parse(readFileSync(join(backendRoot, item.proofPath), 'utf8')),
    );
    validateRouteResourceWorkloadReceipt({
      receipt,
      proofs: retainedProofs,
      currentRoute: currentRouteManifest.routes[0],
    });

    const forged = structuredClone(receipt);
    forged.proofs[0].peakMemoryBytes += 1;
    assert.throws(
      () =>
        validateRouteResourceWorkloadReceipt({
          receipt: forged,
          proofs: retainedProofs,
          currentRoute: currentRouteManifest.routes[0],
        }),
      /malformed|does not match/u,
    );
  } finally {
    rmSync(backendRoot, { recursive: true, force: true });
  }
});

test('route workload receipts populate only the independent route lane', async () => {
  const backendRoot = mkdtempSync(join(tmpdir(), 'modiff-route-report-'));
  try {
    const incoming = join(backendRoot, 'incoming');
    const data = join(backendRoot, 'data');
    const release = join(data, 'qualification', 'release');
    const retained = join(release, 'route-resource-provenance');
    const registryPath = join(release, 'route-resource-workload-receipts.v1.json');
    const manifestPath = join(data, 'current-resource-routes.v1.json');
    mkdirSync(incoming, { recursive: true });
    mkdirSync(join(data, 'auto_resource'), { recursive: true });
    const proofs = pair();
    const provenancePaths = proofs.map((value, index) => {
      const path = join(incoming, `proof-${index}.json`);
      writeFileSync(path, `${JSON.stringify(value)}\n`);
      return path;
    });
    const currentRouteManifest = routeManifest();
    writeFileSync(manifestPath, `${JSON.stringify(currentRouteManifest)}\n`);
    await recordRouteResourceQualification({
      provenancePaths,
      registryPath,
      provenanceDir: retained,
      backendRoot,
      currentRouteManifest,
    });
    writeFileSync(
      join(data, 'release-contract.v1.json'),
      `${JSON.stringify({
        generatedAt: '2026-09-01T00:00:00.000Z',
        contractHash: 'sha256:test-contract',
        templates: [
          {
            id: 'family-template',
            modelType: 'TestPipeline',
            releaseEligible: true,
            qualificationExemption: null,
            resourceRecipes: {
              declaredRecipes: [{ dtype: 'bfloat16', offloadMode: 'model_cpu', quantizationMode: 'none' }],
            },
          },
        ],
      })}\n`,
    );
    writeFileSync(join(data, 'auto_resource', 'history.json'), `${JSON.stringify({ entries: {} })}\n`);

    const result = spawnSync(process.execPath, [resolve('scripts/resource-qualification-report.mjs')], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        MODIFF_BACKEND_DIR: backendRoot,
        MODIFF_CURRENT_RESOURCE_ROUTES_MANIFEST: manifestPath,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(join(release, 'resource-recipe-coverage.v1.json'), 'utf8'));
    assert.deepEqual(report.coverage, {
      required: 1,
      qualified: 0,
      missing: 1,
      byReleaseLane: {
        releaseEligible: { required: 1, qualified: 0, missing: 1 },
        deferred: { required: 0, qualified: 0, missing: 0 },
      },
    });
    assert.equal(report.routeQualifications.length, 1);
    assert.equal(report.routeQualifications[0].evidence.proofCount, 2);
    assert.deepEqual(report.routeQualifications[0].evidence.taskIds, ['route-task-1', 'route-task-2']);
    assert.equal(report.routeQualifications[0].evidence.evidenceSource, 'route_resource_two_live_proofs');
  } finally {
    rmSync(backendRoot, { recursive: true, force: true });
  }
});

test('current route manifests fail closed on duplicate or stale identities', () => {
  const manifest = routeManifest();
  const duplicate = structuredClone(manifest);
  duplicate.routes.push(structuredClone(duplicate.routes[0]));
  duplicate.manifestHash = currentResourceRouteManifestHash(duplicate);
  assert.throws(() => normalizeCurrentResourceRouteManifest(duplicate), /invalid or ambiguous|uniquely sorted/u);

  const stale = structuredClone(manifest);
  stale.routes[0].definition.contentHash = `sha256:${'f'.repeat(64)}`;
  assert.throws(() => normalizeCurrentResourceRouteManifest(stale), /malformed or stale/u);
});
