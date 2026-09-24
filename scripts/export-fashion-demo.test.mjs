import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportFashionDemo } from './export-fashion-demo.mjs';

async function fixture(t, value = '@data/a.png') {
  const root = await mkdtemp(join(tmpdir(), 'modiff-transfer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'data'));
  await writeFile(join(root, 'data/a.png'), 'test image bytes');
  const workflow = {
    nodes: [{ id: 'node', data: { params: { image: { value }, prompt: { value: 'retained prompt' } } } }],
    edges: [],
  };
  await writeFile(join(root, 'workflow.json'), JSON.stringify(workflow));
  await writeFile(join(root, 'manifest.json'), JSON.stringify([{ title: 'Chapter', path: 'workflow.json' }]));
  return {
    root,
    workflow,
    run: () => exportFashionDemo(join(root, 'manifest.json'), join(root, 'data'), join(root, 'package')),
  };
}

test('portable image namespace preserves graph and authored values without local paths', async (t) => {
  const f = await fixture(t);
  const manifest = await f.run();
  assert.equal(manifest.assets.length, 1);
  const workflow = JSON.parse(await readFile(join(f.root, 'package/workflows/01.workflow.json')));
  assert.equal(workflow.nodes[0].data.params.prompt.value, 'retained prompt');
  assert.deepEqual(workflow.edges, f.workflow.edges);
  assert.match(workflow.nodes[0].data.params.image.value, /^@data\/fashion-demo\/[a-f0-9]{64}\.png$/);
  await assert.rejects(f.run(), { code: 'EEXIST' });
});

test('preview URLs are rebound to packaged files, not mutable cache outputs', async (t) => {
  const f = await fixture(t, '/file?file=%40data%2Fa.png');
  await f.run();
  const workflow = JSON.parse(await readFile(join(f.root, 'package/workflows/01.workflow.json')));
  const file = new URL(workflow.nodes[0].data.params.image.value, 'http://localhost').searchParams.get('file');
  assert.match(file, /^@data\/fashion-demo\//);
});

for (const value of ['@data/../secret.png', '/cache/node/output/0', 'C:\\private\\image.png']) {
  test(`rejects nonportable or escaping reference ${value}`, async (t) => {
    const f = await fixture(t, value);
    await assert.rejects(f.run(), /Unsafe|machine-local/);
  });
}

test('symlink media cannot escape the selected data directory', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t, '@data/escape.png');
  await writeFile(join(f.root, 'outside.png'), 'private');
  await symlink(join(f.root, 'outside.png'), join(f.root, 'data/escape.png'));
  await assert.rejects(f.run(), /escapes/);
});
