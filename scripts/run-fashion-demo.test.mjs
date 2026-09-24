import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const runner = resolve('scripts/run-fashion-demo.mjs');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'modiff-fashion-runner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stub = join(root, 'fetch.mjs');
  await writeFile(
    stub,
    'globalThis.fetch = async () => ({ json: async () => ({current: process.env.FAKE_BUSY ? {task_id:"unrelated"} : null, queued:{}}) });',
  );
  await mkdir(join(root, 'node_modules/@playwright/test'), { recursive: true });
  await writeFile(
    join(root, 'node_modules/@playwright/test/cli.js'),
    `
    const fs = require('node:fs');
    fs.appendFileSync(process.env.FAKE_CALLS, process.env.MODIFF_FASHION_CHAPTER + '\\n');
    process.exitCode = process.env.MODIFF_FASHION_CHAPTER === '5' ? 1 : 0;
  `,
  );
  const calls = join(root, 'calls.txt');
  const image = join(root, 'input.png');
  await writeFile(image, 'owned test bytes, not a real image');
  const sha256 = createHash('sha256')
    .update(await readFile(image))
    .digest('hex');
  await writeFile(join(root, 'visual-review.json'), JSON.stringify({ status: 'accepted', sha256 }));
  return {
    root,
    calls,
    image,
    run: async (entries, extra = {}) => {
      const manifest = join(root, 'manifest.json');
      await writeFile(manifest, JSON.stringify(entries));
      return spawnSync(process.execPath, [runner, manifest], {
        cwd: root,
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          MODIFF_FASHION_DEMO: '1',
          NODE_OPTIONS: `--import ${pathToFileURL(stub).href}`,
          FAKE_CALLS: calls,
          ...extra,
        },
      });
    },
  };
}

test('retained success and failure are not submitted again', async (t) => {
  const f = await fixture(t);
  const good = join(f.root, 'good'),
    bad = join(f.root, 'bad');
  await mkdir(good);
  await mkdir(bad);
  await writeFile(join(good, 'receipt.json'), '{}');
  await writeFile(join(bad, 'failure.json'), '{}');
  const result = await f.run([
    { chapter: 4, output: good },
    { chapter: 5, output: bad },
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /retained-completed-receipt/);
  assert.match(result.stdout, /retained-failure-no-unchanged-retry/);
  await assert.rejects(readFile(f.calls), { code: 'ENOENT' });
});

test('missing predecessor and mismatched visual review block dependent submission', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'visual-review.json'), JSON.stringify({ status: 'accepted', sha256: 'wrong' }));
  const result = await f.run([
    { chapter: 4, output: join(f.root, 'a'), source: join(f.root, 'missing.json') },
    { chapter: 5, output: join(f.root, 'b'), image: f.image },
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /blocked-missing-predecessor/);
  assert.match(result.stdout, /blocked-awaiting-visual-review/);
  await assert.rejects(readFile(f.calls), { code: 'ENOENT' });
});

test('busy backend is not interrupted or submitted behind', async (t) => {
  const f = await fixture(t);
  const result = await f.run([{ chapter: 4, output: join(f.root, 'a'), image: f.image }], { FAKE_BUSY: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /backend-busy-no-interference/);
  await assert.rejects(readFile(f.calls), { code: 'ENOENT' });
});

test('failed case is recorded and independent next case still runs exactly once', async (t) => {
  const f = await fixture(t);
  const result = await f.run([
    { chapter: 5, output: join(f.root, 'a'), image: f.image },
    { chapter: 6, output: join(f.root, 'b'), image: f.image },
  ]);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(await readFile(f.calls, 'utf8'), '5\n6\n');
  assert.equal(JSON.parse(await readFile(join(f.root, 'a/runner.json'), 'utf8')).code, 1);
  assert.equal(JSON.parse(await readFile(join(f.root, 'b/runner.json'), 'utf8')).code, 0);
  assert.equal(JSON.parse(await readFile(join(f.root, 'a/failure.json'), 'utf8')).code, 1);
  const replay = await f.run([{ chapter: 5, output: join(f.root, 'a'), image: f.image }]);
  assert.match(replay.stdout, /retained-failure-no-unchanged-retry/);
  assert.equal(await readFile(f.calls, 'utf8'), '5\n6\n');
});
