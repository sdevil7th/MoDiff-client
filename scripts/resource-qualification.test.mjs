import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { liveProofLockHash, sha256Value } from './live-proof-provenance.mjs';
import {
  resourceRecipeFromProvenance,
  resourceRecipeHash,
  resourceWorkloadHash,
  validateResourceQualificationEvidence,
} from './resource-qualification.mjs';
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
  capturedAt: '2026-07-28T00:00:00.000Z',
};

const routeBinding = {
  schemaVersion: 1,
  admissionId: 'diffusers.cluster-admission:TestPipeline:text2image:mode:text_to_image',
  blockDefinition: {
    definitionId: 'diffusers.cluster-admission:TestPipeline:text2image:mode:text_to_image',
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

function provenance({
  prompt = 'locked prompt',
  steps = 4,
  offloadMode = 'none',
  autoOffload = false,
  blockers = [],
  exactRoute = false,
} = {}) {
  const proof = {
    schemaVersion: 2,
    format: 'modiff.live-proof.provenance.v2',
    taskId: 'task-1',
    capturedAt: '2026-07-28T00:00:00.000Z',
    graphHash: 'sha256:graph',
    runtimeFingerprint: 'sha256:runtime',
    modelRevision: `repo/model@${'a'.repeat(40)}`,
    models: {
      count: 1,
      hash: null,
      items: [
        {
          repoId: 'repo/model',
          selectedRevision: 'a'.repeat(40),
          modelRevision: `repo/model@${'a'.repeat(40)}`,
        },
      ],
    },
    mediaHash: 'sha256:output',
    inputArtifactsHash: 'sha256:inputs',
    template: {
      id: 'template-1',
      catalogTemplateLockHash: 'tpl_current',
      promptSettingsHash: 'prompt_current',
      resolvedTemplateLockHash: 'sha256:resolved-template',
      revisionHash: 'sha256:template-revision',
      lockedSettings: { prompt: 'locked prompt', steps: 4, width: 1024, height: 1024 },
      expectedOutput: { width: 1024, height: 1024 },
    },
    graph: {
      hash: 'sha256:graph',
      executionPlanHash: 'sha256:execution-plan',
      executionPlan: {
        modelType: 'FluxSchnellPipeline',
        dtype: 'bfloat16',
        offloadMode,
        quantizationMode: 'none',
        autoOffload,
      },
      canonicalGraph: {
        schemaVersion: 1,
        deterministicMode: { seed: 1 },
        nodes: [
          {
            key: 'loader',
            module: 'modules.DiffusersImage',
            action: 'LoadPipeline',
            params: {
              model_id: { value: 'repo/model' },
              auto_offload: { value: autoOffload },
              offload_mode: { value: offloadMode },
            },
          },
          {
            key: 'generate',
            module: 'modules.DiffusersImage',
            action: 'Generate',
            params: {
              prompt: { value: prompt },
              steps: { value: steps },
            },
          },
        ],
        paths: [{ source: 'loader', target: 'generate' }],
      },
    },
    execution: {
      resourceCandidateId: 'manual:test',
      elapsedSeconds: 12.5,
      peakMemoryBytes: 1234,
      measurement: { backend: 'rocm', device: 'cuda:0' },
    },
    model: {
      repoId: 'repo/model',
      selectedRevision: 'a'.repeat(40),
      modelRevision: `repo/model@${'a'.repeat(40)}`,
      fingerprint: 'sha256:model-fingerprint',
    },
    inputs: { count: 0, hash: 'sha256:inputs', items: [] },
    runtime: {
      lockFingerprint: 'sha256:runtime',
      backendSource: structuredClone(backendSourceIdentity),
      backendSourceAttestation: structuredClone(backendSourceAttestation),
      backendContract: { fingerprint: 'sha256:backend-contract' },
      deterministic: { fingerprint: 'sha256:deterministic' },
    },
    output: {
      count: 1,
      collectionHash: 'sha256:output-collection',
      items: [{ decodedSha256: 'sha256:output', mediaType: 'image', width: 1024, height: 1024 }],
    },
    blockers,
    ...(exactRoute
      ? {
          routeBinding: structuredClone(routeBinding),
          routeBindingHash: resourceRouteBindingHash(routeBinding),
        }
      : {}),
  };
  proof.models.hash = sha256Value('model-set-v1', proof.models.items);
  proof.proofLockHash = liveProofLockHash(proof);
  return proof;
}

const contractTemplate = {
  id: 'template-1',
  modelType: 'FluxSchnellPipeline',
  schemaHash: 'schema-current',
  resourceRecipes: {
    declaredRecipes: [
      {
        dtype: 'bfloat16',
        offloadMode: 'none',
        quantizationMode: 'none',
      },
      {
        dtype: 'bfloat16',
        offloadMode: 'model_cpu',
        quantizationMode: 'none',
      },
    ],
  },
};

test('accepts a full locked workload when only resource controls change', () => {
  const baseline = provenance();
  const candidate = provenance({ offloadMode: 'model_cpu', autoOffload: true });
  baseline.graph.canonicalGraph.deterministicMode.promptSettingsHash = 'legacy-resident-resource-hash';
  candidate.graph.canonicalGraph.deterministicMode.promptSettingsHash = 'expert-offload-resource-hash';
  assert.equal(resourceWorkloadHash(candidate), resourceWorkloadHash(baseline));
  const result = validateResourceQualificationEvidence({
    provenance: candidate,
    baseline,
    contractTemplate,
  });
  assert.equal(result.recipe.offloadMode, 'model_cpu');
});

test('resource recipe identity changes for optimization and placement controls', () => {
  const baseline = provenance();
  baseline.graph.executionPlan.device = 'cuda:0';
  baseline.graph.executionPlan.deviceMap = 'cuda';
  baseline.graph.executionPlan.attentionBackend = 'auto';
  baseline.graph.executionPlan.regionalCompile = false;
  baseline.graph.executionPlan.denoiserCache = 'none';
  baseline.graph.executionPlan.channelsLast = false;
  baseline.graph.executionPlan.layerwiseCasting = false;
  const baselineHash = resourceRecipeHash(resourceRecipeFromProvenance(baseline));

  for (const [field, value] of [
    ['deviceMap', null],
    ['attentionBackend', 'flash'],
    ['regionalCompile', true],
    ['denoiserCache', 'first_block'],
    ['channelsLast', true],
    ['layerwiseCasting', true],
  ]) {
    const candidate = structuredClone(baseline);
    candidate.graph.executionPlan[field] = value;
    assert.notEqual(resourceRecipeHash(resourceRecipeFromProvenance(candidate)), baselineHash, field);
  }
});

test('accepts only a hash-locked exact route whose artifact is the executed immutable model', () => {
  const baseline = provenance();
  const candidate = provenance({ exactRoute: true });
  const result = validateResourceQualificationEvidence({ provenance: candidate, baseline, contractTemplate });
  assert.deepEqual(result.routeBinding, routeBinding);
  assert.equal(result.routeBindingHash, resourceRouteBindingHash(routeBinding));

  const tamperedHash = structuredClone(candidate);
  tamperedHash.routeBindingHash = `sha256:resource-route-binding-v1:${'0'.repeat(64)}`;
  assert.throws(
    () => validateResourceQualificationEvidence({ provenance: tamperedHash, baseline, contractTemplate }),
    /routeBindingHash does not match the exact registered route binding/u,
  );

  const wrongArtifact = structuredClone(candidate);
  wrongArtifact.routeBinding.artifact.repository = 'repo/sibling';
  wrongArtifact.routeBindingHash = resourceRouteBindingHash(wrongArtifact.routeBinding);
  wrongArtifact.proofLockHash = liveProofLockHash(wrongArtifact);
  assert.throws(
    () => validateResourceQualificationEvidence({ provenance: wrongArtifact, baseline, contractTemplate }),
    /artifacts and dependencies do not match the complete executed immutable model set/u,
  );
});

test('exact route artifact is resolved inside and locked with a multi-model dependency set', () => {
  const baseline = provenance({ exactRoute: true });
  const candidate = provenance({ exactRoute: true, offloadMode: 'model_cpu', autoOffload: true });
  const dependency = {
    repoId: 'owner/dependency',
    selectedRevision: 'd'.repeat(40),
    modelRevision: `owner/dependency@${'d'.repeat(40)}`,
  };
  for (const proof of [baseline, candidate]) {
    proof.routeBinding.modelDependencies = [
      {
        id: 'dependency',
        kind: 'text_encoder',
        repository: dependency.repoId,
        revision: dependency.selectedRevision,
      },
    ];
    proof.routeBindingHash = resourceRouteBindingHash(proof.routeBinding);
    proof.models = {
      count: 2,
      hash: null,
      items: [...proof.models.items, dependency],
    };
    proof.models.hash = sha256Value('model-set-v1', proof.models.items);
    proof.modelRevision = `${proof.models.items[1].modelRevision} | ${proof.models.items[0].modelRevision}`;
    proof.model = {
      repoId: `model-set:${proof.models.hash}`,
      selectedRevision: proof.modelRevision,
      modelRevision: proof.modelRevision,
      fingerprint: proof.models.hash,
    };
    proof.proofLockHash = liveProofLockHash(proof);
  }
  const result = validateResourceQualificationEvidence({ provenance: candidate, baseline, contractTemplate });
  assert.equal(result.modelSetHash, candidate.models.hash);
  assert.equal(result.routeBinding.artifact.repository, 'repo/model');

  candidate.models.hash = 'sha256:different-model-set';
  candidate.proofLockHash = liveProofLockHash(candidate);
  assert.throws(
    () => validateResourceQualificationEvidence({ provenance: candidate, baseline, contractTemplate }),
    /models\.hash|locked template model set/u,
  );
});

test('rejects resource evidence when generation workload changes', () => {
  const baseline = provenance();
  for (const candidate of [provenance({ prompt: 'different' }), provenance({ steps: 1 })]) {
    assert.throws(
      () => validateResourceQualificationEvidence({ provenance: candidate, baseline, contractTemplate }),
      /changed the locked workload/,
    );
  }
});

test('rejects incomplete resource provenance', () => {
  assert.throws(
    () =>
      validateResourceQualificationEvidence({
        provenance: provenance({ blockers: ['output missing'] }),
        baseline: provenance(),
        contractTemplate,
      }),
    /contains blocker/,
  );
});

test('pre-attestation V2 resource evidence requires a fresh worker run', () => {
  const candidate = provenance();
  delete candidate.runtime.backendSourceAttestation;
  assert.throws(
    () =>
      validateResourceQualificationEvidence({
        provenance: candidate,
        baseline: provenance(),
        contractTemplate,
      }),
    /runtime\.backendSourceAttestation is missing or invalid/u,
  );
});

test('resource coverage consumes a retained full-workload receipt', () => {
  const backendRoot = mkdtempSync(join(tmpdir(), 'modiff-resource-report-'));
  try {
    const releaseDir = join(backendRoot, 'data', 'qualification', 'release');
    const templateProofDir = join(releaseDir, 'template-provenance');
    const resourceProofDir = join(releaseDir, 'resource-provenance');
    const historyDir = join(backendRoot, 'data', 'auto_resource');
    mkdirSync(templateProofDir, { recursive: true });
    mkdirSync(resourceProofDir, { recursive: true });
    mkdirSync(historyDir, { recursive: true });

    const baseline = provenance();
    const candidate = provenance({ offloadMode: 'model_cpu', autoOffload: true, exactRoute: true });
    const baselineRelativePath = 'data/qualification/release/template-provenance/baseline.json';
    const proofRelativePath = 'data/qualification/release/resource-provenance/candidate.json';
    const proofPath = join(backendRoot, proofRelativePath);
    writeFileSync(join(backendRoot, baselineRelativePath), `${JSON.stringify(baseline)}\n`);
    writeFileSync(proofPath, `${JSON.stringify(candidate)}\n`);
    const proofSha256 = `sha256:${createHash('sha256').update(readFileSync(proofPath)).digest('hex')}`;
    const recipe = resourceRecipeFromProvenance(candidate);
    const recipeHash = resourceRecipeHash(recipe);
    writeFileSync(
      join(backendRoot, 'data', 'release-contract.v1.json'),
      `${JSON.stringify({
        generatedAt: '2026-07-28T00:00:00.000Z',
        contractHash: 'sha256:contract',
        templates: [
          {
            ...contractTemplate,
            releaseEligible: true,
            qualificationExemption: null,
            lastSuccessfulRealRun: { provenancePath: baselineRelativePath },
          },
        ],
      })}\n`,
    );
    writeFileSync(join(historyDir, 'history.json'), `${JSON.stringify({ entries: {} })}\n`);
    writeFileSync(
      join(releaseDir, 'resource-run-receipts.v1.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        format: 'modiff.resource-run-receipt-registry.v1',
        receipts: [
          {
            templateId: contractTemplate.id,
            templateSchemaHash: contractTemplate.schemaHash,
            taskId: candidate.taskId,
            capturedAt: candidate.capturedAt,
            modelType: 'FluxSchnellPipeline',
            dtype: 'bfloat16',
            offloadMode: 'model_cpu',
            quantizationMode: 'none',
            recipe,
            recipeHash,
            bindingStatus: 'exact_route_bound',
            routeBinding: candidate.routeBinding,
            routeBindingHash: candidate.routeBindingHash,
            modelRevision: candidate.modelRevision,
            modelSetHash: candidate.models.hash,
            resourceCandidateId: 'manual:test',
            graphHash: candidate.graphHash,
            workloadHash: resourceWorkloadHash(candidate),
            baselineWorkloadHash: resourceWorkloadHash(baseline),
            runtimeFingerprint: candidate.runtimeFingerprint,
            outputHash: candidate.mediaHash,
            executionDurationSeconds: candidate.execution.elapsedSeconds,
            peakMemoryBytes: candidate.execution.peakMemoryBytes,
            peakReservedBytes: 1400,
            processRssBytes: 5600,
            proofPath: proofRelativePath,
            proofSha256,
          },
        ],
      })}\n`,
    );

    const result = spawnSync(process.execPath, [resolve('scripts/resource-qualification-report.mjs')], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: { ...process.env, MODIFF_BACKEND_DIR: backendRoot },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(join(releaseDir, 'resource-recipe-coverage.v1.json'), 'utf8'));
    assert.equal(report.coverage.qualified, 1);
    const qualified = report.recipes.find((recipe) => recipe.status === 'qualified');
    assert.equal(qualified.evidence.evidenceSource, 'resource_run_receipt');
    assert.equal(qualified.evidence.taskId, candidate.taskId);
    assert.equal(qualified.evidence.processRssBytes, 5600);
    assert.equal(qualified.evidence.bindingStatus, 'exact_route_bound');
    assert.equal(qualified.evidence.routeBindingHash, candidate.routeBindingHash);
    assert.equal(qualified.evidence.modelSetHash, candidate.models.hash);
    // Standard-template evidence qualifies the explicitly declared family
    // recipe only. Even when it retains an exact binding for audit, it cannot
    // authorize the independent two-proof exact-route lane.
    assert.equal(report.routeQualifications.length, 0);
  } finally {
    rmSync(backendRoot, { recursive: true, force: true });
  }
});

test('resource coverage treats missing local history as empty evidence on a clean host', () => {
  const backendRoot = mkdtempSync(join(tmpdir(), 'modiff-resource-report-clean-'));
  try {
    mkdirSync(join(backendRoot, 'data'), { recursive: true });
    writeFileSync(
      join(backendRoot, 'data', 'release-contract.v1.json'),
      `${JSON.stringify({
        generatedAt: '2026-07-28T00:00:00.000Z',
        contractHash: 'sha256:contract',
        templates: [
          {
            id: 'clean-template',
            modelType: 'CleanPipeline',
            releaseEligible: false,
            qualificationExemption: null,
            resourceRecipes: {
              declaredRecipes: [
                {
                  dtype: 'float16',
                  offloadMode: 'model_cpu',
                  quantizationMode: 'none',
                },
              ],
            },
          },
        ],
      })}\n`,
    );

    const result = spawnSync(process.execPath, [resolve('scripts/resource-qualification-report.mjs')], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: { ...process.env, MODIFF_BACKEND_DIR: backendRoot },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(
      readFileSync(join(backendRoot, 'data', 'qualification', 'release', 'resource-recipe-coverage.v1.json'), 'utf8'),
    );
    assert.equal(report.status, 'incomplete');
    assert.deepEqual(report.coverage, {
      required: 1,
      qualified: 0,
      missing: 1,
      byReleaseLane: {
        releaseEligible: { required: 0, qualified: 0, missing: 0 },
        deferred: { required: 1, qualified: 0, missing: 1 },
      },
    });
    assert.equal(report.recipes[0].status, 'missing');
    assert.deepEqual(report.routeQualifications, []);
  } finally {
    rmSync(backendRoot, { recursive: true, force: true });
  }
});

test('legacy Auto history remains family-only and explicitly unbound', () => {
  const backendRoot = mkdtempSync(join(tmpdir(), 'modiff-resource-report-legacy-'));
  try {
    const historyDir = join(backendRoot, 'data', 'auto_resource');
    mkdirSync(historyDir, { recursive: true });
    writeFileSync(
      join(backendRoot, 'data', 'release-contract.v1.json'),
      `${JSON.stringify({
        generatedAt: '2026-07-28T00:00:00.000Z',
        contractHash: 'sha256:contract',
        templates: [
          {
            id: 'legacy-template',
            modelType: 'LegacyPipeline',
            releaseEligible: true,
            qualificationExemption: null,
            resourceRecipes: {
              declaredRecipes: [{ dtype: 'float16', offloadMode: 'model_cpu', quantizationMode: 'none' }],
            },
          },
        ],
      })}\n`,
    );
    writeFileSync(
      join(historyDir, 'history.json'),
      `${JSON.stringify({
        entries: {
          legacy: {
            lastStatus: 'live_proven',
            lastSuccessAt: Date.parse('2026-07-28T00:00:00.000Z'),
            candidate: {
              id: 'legacy:family-recipe',
              modelType: 'LegacyPipeline',
              dtype: 'float16',
              offloadMode: 'model_cpu',
              quantizationMode: 'none',
              artifact: 'owner/legacy-model',
              artifactRevision: `owner/legacy-model@${'e'.repeat(40)}`,
            },
            signature: { hardwareFingerprint: 'legacy-hardware' },
            lastMeasurement: {
              elapsedSeconds: 4.5,
              peakAllocatedBytes: 2048,
              backend: 'cuda',
              device: 'cuda:0',
            },
          },
        },
      })}\n`,
    );

    const result = spawnSync(process.execPath, [resolve('scripts/resource-qualification-report.mjs')], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: { ...process.env, MODIFF_BACKEND_DIR: backendRoot },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(
      readFileSync(join(backendRoot, 'data', 'qualification', 'release', 'resource-recipe-coverage.v1.json'), 'utf8'),
    );
    assert.equal(report.coverage.qualified, 1);
    assert.equal(report.recipes[0].evidence.bindingStatus, 'legacy_unbound');
    assert.equal(report.recipes[0].evidence.routeBindingHash, null);
    assert.deepEqual(report.routeQualifications, []);
  } finally {
    rmSync(backendRoot, { recursive: true, force: true });
  }
});
