import test from 'node:test';
import assert from 'node:assert/strict';
import { runBoundedBrowser } from './bounded-browser-process.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('records success, error and a bounded timeout', async () => {
  assert.deepEqual(await runBoundedBrowser(process.execPath, ['-e', 'process.exit(0)']), { code: 0, timedOut: false });
  const missing = await runBoundedBrowser('modiff-nonexistent-browser-command', []);
  assert.match(missing.code, /ENOENT/);
  const result = await runBoundedBrowser(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    timeoutMs: 150,
    graceMs: 100,
  });
  assert.deepEqual(result, { code: 124, timedOut: true });
});

test(
  'timeout kills the owned grandchild even if the parent exits on TERM',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'modiff-process-tree-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const marker = join(root, 'pid');
    const grandchild = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`;
    const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], {stdio:'ignore'}); setInterval(() => {},1000);`;
    const result = await runBoundedBrowser(process.execPath, ['-e', parent], { timeoutMs: 800, graceMs: 200 });
    assert.equal(result.timedOut, true);
    const pid = Number(await readFile(marker, 'utf8'));
    // Linux may briefly retain a killed orphan as a zombie. It cannot do work.
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
    assert.ok(!stat || /\) Z /.test(stat), `Grandchild ${pid} must not remain running`);
  },
);
