import test from 'node:test';
import assert from 'node:assert/strict';
import { runBoundedBrowser } from './bounded-browser-process.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

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
    t.after(() => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    });
    // Sending SIGKILL does not wait for Linux to finish terminating the process.
    // Allow bounded scheduling time; a killed orphan may remain as a zombie.
    const deadline = performance.now() + 2000;
    let stat;
    do {
      stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
      if (!stat || /\) Z /.test(stat)) break;
      await delay(20);
    } while (performance.now() < deadline);
    assert.ok(!stat || /\) Z /.test(stat), `Grandchild ${pid} must not remain running`);
  },
);
