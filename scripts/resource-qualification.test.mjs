import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  resourceRecipeFromProvenance,
  resourceRecipeHash,
  resourceWorkloadHash,
  validateResourceQualificationEvidence,
} from './resource-qualification.mjs';

function provenance({
  prompt = 'locked prompt',
  steps = 4,
  offloadMode = 'none',
  autoOffload = false,
  blockers = [],
} = {}) {
  return {
    schemaVersion: 2,
    format: 'modiff.live-proof.provenance.v2',
    taskId: 'task-1',
    capturedAt: '2026-07-28T00:00:00.000Z',
    graphHash: 'sha256:graph',
    runtimeFingerprint: 'sha256:runtime',
    modelRevision: `repo/model@${'a'.repeat(40)}`,
    mediaHash: 'sha256:output',
    inputArtifactsHash: 'sha256:inputs',
    template: {
      id: 'template-1',
      catalogTemplateLockHash: 'tpl_current',
      promptSettingsHash: 'prompt_current',
      lockedSettings: { prompt: 'locked prompt', steps: 4, width: 1024, height: 1024 },
      expectedOutput: { width: 1024, height: 1024 },
    },
    graph: {
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
      elapsedSeconds: 12.5,
      peakMemoryBytes: 1234,
      measurement: { backend: 'rocm', device: 'cuda:0' },
    },
    output: { items: [{ decodedSha256: 'sha256:output', width: 1024, height: 1024 }] },
    blockers,
  };
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
    const candidate = provenance({ offloadMode: 'model_cpu', autoOffload: true });
    const baselineRelativePath = 'data/qualification/release/template-provenance/baseline.json';
    const proofRelativePath = 'data/qualification/release/resource-provenance/candidate.json';
    const proofPath = join(backendRoot, proofRelativePath);
    writeFileSync(join(backendRoot, baselineRelativePath), `${JSON.stringify(baseline)}\n`);
    writeFileSync(proofPath, `${JSON.stringify(candidate)}\n`);
    const proofSha256 = `sha256:${createHash('sha256').update(readFileSync(proofPath)).digest('hex')}`;
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
            modelRevision: candidate.modelRevision,
            resourceCandidateId: 'manual:test',
            graphHash: candidate.graphHash,
            workloadHash: resourceWorkloadHash(candidate),
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
  } finally {
    rmSync(backendRoot, { recursive: true, force: true });
  }
});
