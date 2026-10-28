import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalHookCase, hintedCanonicalHookCase } from './canonical-provenance-fixtures.mjs';
import { canonicalAccountingExecutionPlan, createRunProvenance } from './live-proof-provenance.mjs';

const accounting = (value, consumed = value.executedOutput.resolvedExecutionInputs) =>
  canonicalAccountingExecutionPlan({
    apiGraph: value.apiGraph,
    expectedApiGraph: value.canonicalAccountingProof.expectedApiGraph,
    consumed,
    target: value.canonicalAccountingProof.target,
    runtimeEvidence: {
      run: value.canonicalAccountingProof.run,
      output: value.executedOutput,
      graphCompleted: value.canonicalAccountingProof.graphCompleted,
    },
  });

test('real FE managed DDIM producer hints are accounted with original completion and GET authority', async () => {
  const value = await hintedCanonicalHookCase();
  const before = JSON.stringify(value);
  assert.equal(value.apiGraph.runtimeHints.source, 'studio');
  assert.deepEqual(value.apiGraph.runtimeHints.resourceRetryPlans, []);
  assert.equal(value.executionReceipt.runtimeHints, undefined, 'GET does not expose runtimeHints');
  const result = accounting(value);
  assert.equal(result.plan.device, 'cuda:0');
  assert.equal(result.plan.runtimeHintAccounting.policy, 'canonical-ddim-runtime-hints-v1');
  assert.equal(result.plan.runtimeHintAccounting.budgetDecision, 'advisory-reset-recorded');
  const provenance = createRunProvenance(value);
  assert.equal(provenance.graph.executionPlanHash, result.hash);
  assert.equal(JSON.stringify(value), before, 'original packages and receipts stay untouched');
});

test('real FE correlation-only DDIM producer retains its exact no-CUDA budget decision', async () => {
  const value = await hintedCanonicalHookCase({ managed: false, targetNode: true });
  assert.equal(accounting(value).plan.runtimeHintAccounting.budgetDecision, 'no-cuda-target');
  assert.doesNotThrow(() => createRunProvenance(value));
});

test('actual managed producer without advisory counters retains the same strict execution and completion joins', async () => {
  const value = await hintedCanonicalHookCase({ memory: false });
  assert.equal(value.apiGraph.runtimeHints.cudaMemoryTotalBytes, undefined);
  assert.doesNotThrow(() => createRunProvenance(value));
});

test('the ordinary DDIM accounting envelope rejects loops and unsupported top-level execution authority', async () => {
  const original = await hintedCanonicalHookCase();
  const authorities = {
    loops: [{ id: 'unreviewed-loop', bodyNodeIds: ['node-05'], resultNodeId: 'node-05', iterations: 2, maxRetries: 1 }],
    servicePackage: { package: {}, values: {} },
    executionPurpose: { kind: 'preview' },
    workflowAutoPlan: { schemaVersion: 1, graphHash: 'unreviewed' },
    deterministicMode: { enabled: false, strict: false },
    provenance: { source: 'unreviewed-scope' },
    futureExecutionAuthority: {},
  };
  for (const [key, authority] of Object.entries(authorities)) {
    const value = structuredClone(original);
    value.apiGraph[key] = authority;
    assert.equal(value.apiGraph, value.executedOutput.apiGraphSnapshot);
    assert.equal(value.apiGraph, value.canonicalAccountingProof.run.outputs[0].apiGraphSnapshot);
    const accepted = [];
    for (const [route, validate] of [
      ['accounting', accounting],
      ['factory', createRunProvenance],
    ]) {
      try {
        validate(value);
        accepted.push(route);
      } catch (error) {
        assert.match(error.message, /Unsupported canonical graph/);
      }
    }
    assert.deepEqual(accepted, [], `${key} must not survive either graph/output join`);
  }
  const unhinted = canonicalHookCase();
  unhinted.apiGraph.loops = authorities.loops;
  assert.throws(() => accounting(unhinted), /Unsupported canonical graph/);
  assert.throws(() => createRunProvenance(unhinted), /Unsupported canonical graph/);
  const unsupportedSource = structuredClone(original);
  unsupportedSource.canonicalAccountingProof.expectedApiGraph.loops = authorities.loops;
  assert.throws(() => accounting(unsupportedSource), /Unsupported canonical graph/);
  assert.throws(() => createRunProvenance(unsupportedSource), /Unsupported canonical graph/);
});

test('the DDIM envelope permits only absent or explicitly empty loops without changing legacy proof bytes', async () => {
  for (const value of [canonicalHookCase(), await hintedCanonicalHookCase()]) {
    const before = createRunProvenance(value);
    value.apiGraph.loops = [];
    assert.deepEqual(createRunProvenance(value), before);
    for (const malformed of [null, {}, '', false]) {
      value.apiGraph.loops = malformed;
      assert.throws(() => accounting(value), /Unsupported canonical graph/);
      assert.throws(() => createRunProvenance(value), /Unsupported canonical graph/);
    }
  }
});

test('hinted canonical accounting and the shared factory fail closed on unsupported authority and broken joins', async () => {
  const original = await hintedCanonicalHookCase();
  const frame = (value) => value.canonicalAccountingProof.graphCompleted;
  const hints = (value) => value.apiGraph.runtimeHints;
  const bothHints = (value, key, item) => {
    hints(value)[key] = item;
    frame(value).runtimeHints[key] = structuredClone(item);
  };
  const changes = {
    'missing original completion': (value) => {
      delete value.canonicalAccountingProof.graphCompleted;
    },
    'unknown submitted authority even if echoed': (value) => {
      bothHints(value, 'futureAuthority', true);
    },
    'unknown workflow form epoch': (value) => {
      bothHints(value, 'workflowFormEpoch', 7);
    },
    'execution purpose': (value) => {
      bothHints(value, 'executionPurpose', { kind: 'preview' });
    },
    Auto: (value) => {
      bothHints(value, 'resourceMode', 'auto');
    },
    'Auto candidate': (value) => {
      bothHints(value, 'autoResourceCandidateId', 'invented');
    },
    'Auto task': (value) => {
      value.executionReceipt.resourceCandidateId = 'invented';
    },
    'invented GET hints': (value) => {
      value.executionReceipt.runtimeHints = structuredClone(hints(value));
    },
    'worker changed dtype': (value) => {
      frame(value).runtimeHints.dtype = 'float16';
    },
    'offload variant': (value) => {
      bothHints(value, 'offloadMode', 'model_cpu');
    },
    'quantization variant': (value) => {
      bothHints(value, 'quantizationMode', 'fp8');
    },
    'model dependency variant': (value) => {
      bothHints(value, 'modelDependencies', [
        { id: 'other', repo: 'other/model', revision: 'a'.repeat(40), kind: 'vae' },
      ]);
    },
    'retry plan': (value) => {
      bothHints(value, 'resourceRetryPlans', [{ offloadMode: 'model_cpu' }]);
    },
    'retry state': (value) => {
      frame(value).runtimeHints.resourceRetryAttempt = 0;
    },
    'retry history': (value) => {
      frame(value).resourceRetryHistory.push({ attempt: 1 });
    },
    'raw task attempt': (value) => {
      value.executionReceipt.attempt_index = 1;
    },
    'output attempt': (value) => {
      value.executedOutput.attemptIndex = 1;
    },
    'accounting attempt': (value) => {
      value.executedOutput.resolvedExecutionInputs.attemptIndex = 1;
    },
    'completion task': (value) => {
      frame(value).task_id = 'another-task';
    },
    'completion session': (value) => {
      frame(value).sid = 'another-session';
    },
    'completion client run': (value) => {
      frame(value).client_run_id = 'another-run';
    },
    'completion run input hash': (value) => {
      frame(value).run_input_hash = 'run_other';
    },
    'completion workflow': (value) => {
      frame(value).workflow_tab_id = 'another-workflow';
    },
    'completion epoch': (value) => {
      frame(value).workflow_canvas_epoch += 1;
    },
    'unexpected raw task form epoch': (value) => {
      value.executionReceipt.workflow_form_epoch = 7;
    },
    'persisted output attempt': (value) => {
      value.canonicalAccountingProof.run.outputs[0] = { ...value.executedOutput, attemptIndex: 1 };
    },
    'missing original output media hash': (value) => {
      delete value.executedOutput.mediaHash;
    },
    'output owner differs from accounted Preview': (value) => {
      value.executedOutput.nodeId = 'node-04';
    },
    'fraction alone after failed reset': (value) => {
      frame(value).runtimeBudget.reason =
        'CUDA budget is advisory; could not reset PyTorch process memory fraction: synthetic failure';
    },
    'enforced budget': (value) => {
      bothHints(value, 'cudaBudgetPolicy', 'enforced');
    },
    'budget decision device': (value) => {
      frame(value).runtimeBudget.cuda_index = 1;
    },
    'advisory counters arithmetic': (value) => {
      bothHints(value, 'requestedCudaBudgetBytes', 1);
    },
    'runtime source identity': (value) => {
      frame(value).runtimeFingerprint = structuredClone(frame(value).runtimeFingerprint);
      frame(value).runtimeFingerprint.backendSource.gitCommit = 'd'.repeat(40);
    },
    'runtime measurement': (value) => {
      frame(value).runtimeMeasurement = { ...frame(value).runtimeMeasurement, processRssBytes: 8192 };
    },
    'controlled artifact': (value) => {
      frame(value).runtimeHints.controlledArtifacts.push({ repo: 'other/model' });
    },
    'loader contract': (value) => {
      frame(value).runtimeHints.loaderContract = ['modules.Other.Loader'];
    },
    'resource summary': (value) => {
      bothHints(value, 'resourcePlan', { ...hints(value).resourcePlan, offloadMode: 'model_cpu' });
    },
    'observation form': (value) => {
      bothHints(value, 'optimizationQualificationForm', {
        ...value.executedOutput.formSnapshot,
        mode: 'text_to_image',
      });
    },
    'workflow title coercion': (value) => {
      bothHints(value, 'workflowTitle', ' Protocol DDIM ');
      value.executionReceipt.workflow_title = value.canonicalAccountingProof.run.workflow_title = ' Protocol DDIM ';
    },
    'preparation Auto route': (value) => {
      value.executionReceipt.runtimePreparation = frame(value).runtimePreparation = {
        resourceMode: 'expert',
        workflowAuto: {},
      };
    },
    'extra completion attempt': (value) => {
      frame(value).attempt_index = 0;
    },
  };
  for (const [label, change] of Object.entries(changes)) {
    const value = structuredClone(original);
    change(value);
    assert.throws(() => accounting(value), undefined, `${label}: independent accounting`);
    assert.throws(() => createRunProvenance(value), undefined, `${label}: shared factory`);
  }
  const unrelated = structuredClone(original.executedOutput.resolvedExecutionInputs);
  unrelated.taskId = 'another-task';
  assert.throws(() => accounting(original, unrelated), /consumed receipt differs/);
});
