import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const scripts = dirname(fileURLToPath(import.meta.url));
function fixture(workflows = []) {
  const root = mkdtempSync(join(tmpdir(), 'modiff-release-freshness-'));
  const clientScripts = join(root, 'client', 'scripts');
  const backend = join(root, 'backend');
  const output = join(backend, 'data', 'qualification', 'release', 'release-candidate-report.v1.json');
  mkdirSync(clientScripts, { recursive: true });
  mkdirSync(dirname(output), { recursive: true });
  const contractPath = join(backend, 'data', 'release-contract.v1.json');
  writeFileSync(
    contractPath,
    JSON.stringify({
      generatedAt: '2026-01-01T00:00:00Z',
      contractHash: 'retained-contract-hash',
      packageSets: {},
      templates: [],
      workflows,
      coverage: {
        templateCount: 0,
        completeQualificationReceiptCount: 0,
        workflowCount: workflows.length,
        releaseEligibleWorkflowCount: workflows.filter(({ releaseEligible }) => releaseEligible).length,
      },
    }),
  );
  const original = readFileSync(contractPath);
  const sourceState = join(backend, 'source-state.txt');
  writeFileSync(sourceState, 'current');
  const reportSource = readFileSync(join(scripts, 'release-candidate-report.mjs'), 'utf8').replace(
    "'./release-qualification-policy.mjs'",
    JSON.stringify(pathToFileURL(join(scripts, 'release-qualification-policy.mjs')).href),
  );
  const report = join(clientScripts, 'release-candidate-report.mjs');
  writeFileSync(report, reportSource);
  // Controlled dependency stand-in exercises the normal read-only --check protocol.
  // It never imports a model/runtime or rewrites the retained contract.
  writeFileSync(
    join(clientScripts, 'release-contract.mjs'),
    `
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    if (process.argv.slice(2).join(' ') !== '--check') process.exit(81);
    const state = readFileSync(join(process.env.MODIFF_BACKEND_DIR, 'source-state.txt'), 'utf8');
    process.exit(state === 'current' ? 0 : state === 'stale' ? 1 : 7);
  `,
  );
  return {
    root,
    backend,
    output,
    sourceState,
    run: (...args) =>
      spawnSync(process.execPath, [report, ...args], {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, MODIFF_BACKEND_DIR: backend },
      }),
    read: () => JSON.parse(readFileSync(output, 'utf8')),
    assertPreserved: () =>
      assert.equal(
        createHash('sha256').update(readFileSync(contractPath)).digest('hex'),
        createHash('sha256').update(original).digest('hex'),
      ),
    close: () => {
      assert.equal(dirname(root), resolve(tmpdir()));
      assert(basename(root).startsWith('modiff-release-freshness-'));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('candidate report checks current source rather than trusting a retained contract hash', () => {
  const f = fixture();
  try {
    writeFileSync(f.sourceState, 'stale');
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const report = f.read();
    assert.equal(report.gates.releaseContractCurrent, false);
    assert(report.blockers.some((blocker) => blocker.id === 'release-contract-not-current'));
    assert.equal(report.status, 'blocked');
    f.assertPreserved();
  } finally {
    f.close();
  }
});

test('candidate --check detects source drift even while the retained contract bytes stay unchanged', () => {
  const f = fixture();
  try {
    assert.equal(f.run().status, 0);
    assert.equal(f.run('--check').status, 0);
    writeFileSync(f.sourceState, 'stale');
    const result = f.run('--check');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /stale/u);
    f.assertPreserved();
  } finally {
    f.close();
  }
});

test('current-source verification failure stays blocked without inventing other qualification', () => {
  const f = fixture();
  try {
    writeFileSync(f.sourceState, 'verification-error');
    assert.equal(f.run().status, 0);
    assert.equal(f.read().gates.releaseContractCurrent, false);
    assert(f.read().blockers.some((blocker) => blocker.id === 'release-contract-not-current'));
    writeFileSync(f.sourceState, 'current');
    assert.equal(f.run().status, 0);
    const current = f.read();
    assert.equal(current.gates.releaseContractCurrent, true);
    assert(!current.blockers.some((blocker) => blocker.id === 'release-contract-not-current'));
    assert.equal(current.status, 'blocked', 'Freshness alone cannot grant hardware/resource readiness.');
    assert.notEqual(f.run('--check', '--require-ready').status, 0);
    f.assertPreserved();
  } finally {
    f.close();
  }
});

test('candidate report counts exact runs and bound variants without granting release eligibility', () => {
  const standalone = (id, status, receipt, missing, releaseEligible = false) => ({
    id,
    releaseEligible,
    canonicalExecutionEvidence: { status, releaseApprovalGranted: false },
    lastSuccessfulRealRun: receipt,
    missingReleaseEvidence: missing,
  });
  const f = fixture([
    standalone('exact-image', 'verified_execution_only', { taskId: 'native-image' }, ['eligible_source_template']),
    standalone('prompt-variant', 'verified_prompt_bound_model_variant', { canonicalDefaultsExecuted: false }, [
      'eligible_source_template',
      'reviewed_bound_recipe',
    ]),
    standalone(
      'source-image-variant',
      'verified_input_bound_model_variant',
      { observationLimits: { numericDepthPrediction: false } },
      ['eligible_source_template', 'reviewed_bound_recipe'],
    ),
    standalone('deterministic', 'verified_deterministic_execution', { taskId: 'native-data' }, [], true),
    standalone('missing-proof', 'missing', null, ['successful_real_run_receipt']),
    {
      id: 'template',
      releaseEligible: false,
      lastSuccessfulRealRun: { taskId: 'native-template' },
      missingReleaseEvidence: ['approved_gallery_example'],
    },
  ]);
  try {
    assert.equal(f.run().status, 0);
    const report = f.read();
    assert.equal(report.coverage.eligibleWorkflows, 1);
    assert.deepEqual(report.coverage.standaloneExecution, {
      verified: 4,
      exactModelWorkflows: 1,
      boundVariants: 2,
      deterministicWorkflows: 1,
      awaitingReleaseEligibility: 3,
    });
    assert.deepEqual(report.incompleteWorkflows, [
      'exact-image',
      'prompt-variant',
      'source-image-variant',
      'missing-proof',
      'template',
    ]);
    assert.deepEqual(report.incompleteWorkflowEvidence, [
      { id: 'exact-image', executionStatus: 'verified_execution_only', missing: ['eligible_source_template'] },
      {
        id: 'prompt-variant',
        executionStatus: 'verified_prompt_bound_model_variant',
        missing: ['eligible_source_template', 'reviewed_bound_recipe'],
      },
      {
        id: 'source-image-variant',
        executionStatus: 'verified_input_bound_model_variant',
        missing: ['eligible_source_template', 'reviewed_bound_recipe'],
      },
      { id: 'missing-proof', executionStatus: 'missing', missing: ['successful_real_run_receipt'] },
      { id: 'template', executionStatus: 'retained_template_execution', missing: ['approved_gallery_example'] },
    ]);
    assert.equal(report.gates.workflowsEligible, false);
    assert.notEqual(f.run('--check', '--require-ready').status, 0);
    f.assertPreserved();
  } finally {
    f.close();
  }
});
