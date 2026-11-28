import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifySavedVaceTaskIdentity } from './saved-vace-composite-evidence.mjs';

test('archived VACE output joins the same native task and attempt', () => {
  const queue = {
    task_id: 'original-task',
    sid: 'worker-session',
    attempt_index: 0,
    client_run_id: 'client-run',
    run_input_hash: 'ordered-inputs',
    workflow_tab_id: 'original-workflow',
    workflow_canvas_epoch: 4,
    status: 'running',
    started_at: 1,
    updated_at: 2,
  };
  const task = { ...queue, status: 'completed', completed_at: 3 };
  const output = {
    taskId: task.task_id,
    runInputHash: task.run_input_hash,
    clientRunId: task.client_run_id,
    attemptIndex: task.attempt_index,
  };
  assert.doesNotThrow(() => verifySavedVaceTaskIdentity(queue, task, output));
  assert.throws(() => verifySavedVaceTaskIdentity({ ...queue, attempt_index: 1 }, task, output));
  assert.throws(() => verifySavedVaceTaskIdentity({ ...queue, sid: 'different-session' }, task, output));
  assert.throws(() => verifySavedVaceTaskIdentity({ ...queue, updated_at: 4 }, task, output));
  assert.throws(() => verifySavedVaceTaskIdentity(queue, { ...task, status: 'failed' }, output));
  assert.throws(() => verifySavedVaceTaskIdentity(queue, task, { ...output, runInputHash: 'different-inputs' }));
});
