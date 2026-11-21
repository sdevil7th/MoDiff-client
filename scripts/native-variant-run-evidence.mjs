import assert from 'node:assert/strict';
import { stableStringify } from './live-proof-provenance.mjs';

const same = (a, b, message) => assert.equal(stableStringify(a), stableStringify(b), message);
const recordKeys = (row, keys, message) => same(Object.keys(row ?? {}).sort(), keys.sort(), message);
const nativeOutputFields = [
  'id',
  'taskId',
  'sid',
  'clientRunId',
  'runInputHash',
  'workflowTabId',
  'attemptIndex',
  'nodeId',
  'fieldKey',
  'displayType',
  'formSnapshot',
  'graphSnapshot',
  'apiGraphSnapshot',
  'resolvedExecutionInputs',
  'backendProvenance',
  'mediaHash',
  'mediaCollectionHash',
  'mediaItems',
];

export function validateUnmodifiedExpertPreparation(preparation, modelType) {
  const { availableRamBytes, availableVramBytes, ...status } = preparation;
  assert.ok(Number.isSafeInteger(availableRamBytes) && availableRamBytes > 0);
  assert.ok(Number.isSafeInteger(availableVramBytes) && availableVramBytes > 0);
  same(
    status,
    {
      cleanup: null,
      incomingModelFamily: modelType,
      performed: false,
      previousModelFamily: null,
      reasons: [],
      residentRecipeReusable: false,
      resourceMode: 'expert',
      resourceRecipeChanged: false,
    },
    'The captured resource preparation differed from the unmodified Expert recipe.',
  );
}

// Join independently retained native task, output and completion facts. Route
// readers must separately bind the submitted graph, model and consumed inputs.
export function validateNativeVariantRun({
  target,
  outputNodeId,
  displayType,
  creator,
  outputPackage,
  run,
  graphCompleted,
  graphRequest,
  graphAcknowledgment,
  validatePreparation = (preparation) => assert.equal(preparation, null),
}) {
  assert.equal(creator?.manifest?.packageType, 'modiff-workflow-share');
  assert.equal(outputPackage?.manifest?.packageType, 'modiff-output-package');
  const output = outputPackage.latestOutput;
  const task = run.task;
  const submitted = output.apiGraphSnapshot;
  const hints = submitted.runtimeHints;
  recordKeys(
    hints,
    ['clientRunId', 'runInputHash', 'workflowTabId', 'workflowCanvasEpoch', 'workflowTitle', 'workflowSnapshot'],
    'Unexpected submission runtime hints.',
  );
  same(outputPackage.apiGraph, submitted, 'Original package API graph differs.');
  same(outputPackage.graph, output.graphSnapshot, 'Original package visual graph differs.');
  same(creator.metadata?.studio, output.formSnapshot, 'Creator form differs from the persisted output.');
  assert.equal(output.formSnapshot.mode, target.task);
  assert.equal(output.formSnapshot.modelType, target.modelType);
  assert.equal(output.formSnapshot.resourceMode, 'expert');
  assert.equal(task.status, 'completed');
  assert.equal(task.attempt_index, 0);
  assert.equal(task.resourceCandidateId, null);
  assert.ok(!task.runtimeHints || Object.keys(task.runtimeHints).length === 0);
  assert.ok(
    Number.isFinite(task.started_at) && Number.isFinite(task.completed_at) && task.completed_at >= task.started_at,
  );
  assert.match(task.task_id, /^[a-zA-Z0-9_-]+$/u);
  assert.equal(output.taskId, task.task_id);
  assert.equal(output.sid, task.sid);
  assert.equal(submitted.sid, task.sid);
  assert.equal(output.attemptIndex, 0);
  assert.equal(output.nodeId, outputNodeId);
  assert.equal(output.fieldKey, 'preview');
  assert.equal(output.displayType, displayType);
  assert.equal(run.workflow_id, output.workflowTabId);
  assert.equal(run.workflow_title, hints.workflowTitle);
  same(run.workflow_snapshot, hints.workflowSnapshot, 'Native workflow snapshot differs.');
  same(task.workflow_snapshot, hints.workflowSnapshot, 'Completed task workflow snapshot differs.');
  const context = {
    client_run_id: hints.clientRunId,
    run_input_hash: hints.runInputHash,
    workflow_tab_id: hints.workflowTabId,
    workflow_canvas_epoch: hints.workflowCanvasEpoch,
  };
  for (const [key, value] of Object.entries(context)) {
    assert.ok(typeof value === 'string' ? value.length > 0 : Number.isSafeInteger(value));
    assert.equal(task[key], value, 'Completed task context differs.');
    assert.equal(graphCompleted[key], value, 'Native completion context differs.');
  }
  for (const key of ['clientRunId', 'runInputHash', 'workflowTabId']) assert.equal(output[key], hints[key]);
  assert.equal(graphCompleted.type, 'graph_completed');
  assert.equal(graphCompleted.task_id, task.task_id);
  assert.equal(graphCompleted.sid, task.sid);
  assert.equal(graphCompleted.deterministicMode, null);
  same(graphCompleted.resourceRetryHistory, []);
  assert.equal(graphCompleted.runtimeBudget?.applied, false);
  validatePreparation(task.runtimePreparation);
  same(graphCompleted.runtimeFingerprint, task.runtimeFingerprint, 'Native completion runtime differs.');
  same(graphCompleted.runtimeMeasurement, task.runtimeMeasurement, 'Native completion measurements differ.');
  same(graphCompleted.runtimePreparation, task.runtimePreparation, 'Native completion preparation differs.');
  assert.equal(run.outputs.length, 1, 'A single native output is required.');
  const nativeOutput = run.outputs[0];
  for (const field of nativeOutputFields) {
    assert.notEqual(output[field], undefined, `Original output is missing ${field}.`);
    same(output[field], nativeOutput[field], `Original native output ${field} differs.`);
  }
  if (graphRequest !== undefined) {
    same(graphRequest, submitted, 'Original Run request differs from the output graph.');
    assert.equal(graphAcknowledgment.error, false);
    assert.equal(graphAcknowledgment.task_id, task.task_id);
    assert.equal(graphAcknowledgment.sid, task.sid);
  }
  return { task, output, hints };
}

// Some image output stores attach the API snapshot after the completed task
// GET returns. Compare that original response and the late native record
// before applying the ordinary complete-output validation to the late record.
export function validateLateNativeImageVariantRun({ run, persistedOutput, ...options }) {
  assert.equal(options.displayType, 'image');
  assert.equal(run.outputs.length, 1);
  const [early] = run.outputs;
  assert.equal(early.apiGraphSnapshot, undefined, 'Unexpected already captured early API snapshot.');
  assert.ok(persistedOutput?.apiGraphSnapshot, 'The late native API snapshot is missing.');
  for (const field of nativeOutputFields) {
    if (['apiGraphSnapshot', 'backendProvenance', 'mediaItems'].includes(field)) continue;
    assert.notEqual(early[field], undefined, `Early native output lacks ${field}.`);
    same(early[field], persistedOutput[field], `Native output changed ${field} during persistence.`);
  }
  const earlyMedia = early.mediaItems;
  const lateMedia = persistedOutput.mediaItems;
  assert.equal(earlyMedia.length, 1);
  assert.equal(lateMedia.length, 1);
  const { durationSeconds: earlyDuration, label: earlyLabel, ...earlyItem } = earlyMedia[0];
  const { durationSeconds: lateDuration, label: lateLabel, ...lateItem } = lateMedia[0];
  assert.equal(earlyDuration, null);
  assert.equal(lateDuration, undefined);
  assert.equal(earlyLabel, undefined);
  assert.equal(lateLabel, 'Item 1');
  same(earlyItem, lateItem, 'Native image identity changed during persistence.');
  const provenanceAt = (row, media) => {
    const { capturedAt, exactTemplateCompatible, promptSettingsHash, mediaItems, ...identity } = row.backendProvenance;
    assert.ok(Number.isSafeInteger(capturedAt) && capturedAt > 0);
    assert.ok(exactTemplateCompatible == null || exactTemplateCompatible === false);
    assert.ok(promptSettingsHash == null);
    same(mediaItems, media, 'Native provenance media differs from its output.');
    return { capturedAt, identity };
  };
  const earlyProof = provenanceAt(early, earlyMedia);
  const lateProof = provenanceAt(persistedOutput, lateMedia);
  assert.ok(earlyProof.capturedAt <= lateProof.capturedAt);
  same(earlyProof.identity, lateProof.identity, 'Native provenance identity changed during persistence.');
  return validateNativeVariantRun({ ...options, run: { ...run, outputs: [persistedOutput] } });
}

export function validateNativeVariantOutput({ output, outputRef, task, bytes, displayType, contentType }) {
  const { backendProvenance } = output;
  assert.equal(backendProvenance.source, 'backend-record');
  assert.equal(backendProvenance.backendExecutionId, task.task_id);
  for (const key of ['clientRunId', 'runInputHash', 'workflowTabId', 'mediaCollectionHash'])
    assert.equal(backendProvenance[key], output[key]);
  assert.equal(backendProvenance.attemptIndex, 0);
  assert.equal(backendProvenance.nodeId, output.nodeId);
  assert.equal(backendProvenance.fieldKey, 'preview');
  assert.equal(backendProvenance.runtimeFingerprint, task.runtimeFingerprint.fingerprint);
  assert.equal(backendProvenance.mediaPath, outputRef.backendPath);
  assert.equal(backendProvenance.mediaHash, output.mediaHash);
  same(backendProvenance.mediaItems, output.mediaItems);
  assert.equal(output.mediaItems.length, 1);
  const [item] = output.mediaItems;
  assert.equal(item.index, 0);
  assert.equal(item.backendPath, outputRef.backendPath);
  assert.equal(item.taskId, task.task_id);
  assert.equal(item.attemptIndex, 0);
  assert.equal(item.clientRunId, output.clientRunId);
  assert.equal(item.runInputHash, output.runInputHash);
  assert.equal(item.displayType, displayType);
  assert.equal(item.contentType, contentType);
  assert.equal(outputRef.mediaType, displayType);
  assert.equal(item.mediaHash, output.mediaHash);
  assert.equal(item.mediaHash, `sha256:bytes:${outputRef.file.sha256}`);
  assert.equal(item.byteSize, bytes.length);
  return item;
}
