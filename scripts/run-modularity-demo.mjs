#!/usr/bin/env node
// Explicit, bounded frontend rehearsal. No hidden retry or background agent.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (process.env.MODIFF_RUN_MODULARITY_DEMO !== '1') {
  throw new Error(
    'Set MODIFF_RUN_MODULARITY_DEMO=1 to approve creating demo workflows and enabling the first-party custom example.',
  );
}
const output = resolve(process.env.MODIFF_REVIEW_OUTPUT_DIR || `artifacts/modularity-demo-${Date.now()}`);
await mkdir(output, { recursive: true });
const receiptPath = resolve(output, 'receipt.json');
try {
  await readFile(receiptPath);
  throw new Error(
    'This evidence directory already has a receipt. Use a new directory and an explicit resume workflow; completed work must not be overwritten.',
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const startedAt = new Date().toISOString();
const child = spawn(
  process.execPath,
  [
    resolve('node_modules/@playwright/test/cli.js'),
    'test',
    'tests/e2e/live-backend/modularity-demo.spec.ts',
    '--reporter=line',
    '--retries=0',
    '--workers=1',
  ],
  {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    env: { ...process.env, MODIFF_REVIEW_OUTPUT_DIR: output, MODIFF_LONG_RUNNING_QUALIFICATION: '1' },
  },
);
let timedOut = false;
const stop = () => {
  // Only this owned browser/test process group, never the MoDiff backend or models.
  if (process.platform === 'win32') child.kill();
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
};
const deadline = setTimeout(() => {
  timedOut = true;
  stop();
}, 105 * 60_000);
const forceDeadline = setTimeout(
  () => {
    if (process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    } else child.kill('SIGKILL');
  },
  105 * 60_000 + 15_000,
);
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
let code;
try {
  code = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', done);
  });
} finally {
  clearTimeout(deadline);
  clearTimeout(forceDeadline);
}
const receipt = await readFile(receiptPath, 'utf8')
  .then(JSON.parse)
  .catch(() => null);
const failures = receipt?.receipts?.filter((item) => item.phase === 'failed') || [];
const summary = { startedAt, finishedAt: new Date().toISOString(), code, timedOut, failures, receiptPath };
await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exitCode = code === 0 && !timedOut && failures.length === 0 ? 0 : 1;
