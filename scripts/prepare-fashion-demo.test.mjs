import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const script = resolve('scripts/prepare-fashion-demo.mjs');
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'modiff-fashion-curation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workflow = {
    nodes: [
      {
        id: 'preview',
        data: {
          module: 'modules.Image',
          action: 'Preview',
          params: {
            image: { display: 'input', value: 'retained-input' },
            preview: {
              display: 'ui_image',
              dataSource: 'output',
              value: ['/cache/shared/output'],
              artifacts: [{ url: '/cache/stale' }],
            },
          },
        },
      },
    ],
    edges: [{ id: 'wire', source: 'decode', target: 'preview' }],
  };
  await writeFile(join(directory, 'output.png'), 'owned fixture bytes');
  await writeFile(
    join(directory, 'visual-review.json'),
    JSON.stringify({
      status: 'accepted',
      sha256: createHash('sha256').update('owned fixture bytes').digest('hex'),
      findings: 'Checked <not markup>.',
    }),
  );
  await writeFile(join(directory, 'final.workflow.json'), JSON.stringify(workflow));
  const run = {
    task: { status: 'completed', task_id: 'task-one' },
    outputs: [
      {
        nodeId: 'preview',
        fieldKey: 'preview',
        taskId: 'task-one',
        mediaItems: [{ url: '/file?file=%40data/result.webp', taskId: 'task-one', mediaHash: 'sha256:bytes:exact' }],
      },
    ],
  };
  const manifest = join(directory, 'chapters.json');
  await writeFile(manifest, JSON.stringify([{ directory, number: '01', title: 'Fashion Demo <one>' }]));
  return {
    directory,
    workflow,
    run,
    execute: async () => {
      await writeFile(join(directory, 'run.json'), JSON.stringify(run));
      return spawnSync(process.execPath, [script, manifest, join(directory, 'curated')], {
        encoding: 'utf8',
        timeout: 5000,
      });
    },
  };
}

test('curation binds exact durable preview without changing executable values or edges', async (t) => {
  const f = await fixture(t);
  const result = await f.execute();
  assert.equal(result.status, 0, result.stderr);
  const stored = JSON.parse(await readFile(join(f.directory, 'curated/01.workflow.json'), 'utf8'));
  assert.deepEqual(stored.edges, f.workflow.edges);
  assert.deepEqual(stored.nodes[0].data.params.image, f.workflow.nodes[0].data.params.image);
  assert.deepEqual(stored.nodes[0].data.params.preview.value, ['/file?file=%40data/result.webp']);
  assert.equal(stored.nodes[0].data.params.preview.artifacts, undefined);
  assert.match(await readFile(join(f.directory, 'review.html'), 'utf8'), /Fashion Demo &lt;one&gt;/);
});

test('unrelated task media cannot be attached to a chapter', async (t) => {
  const f = await fixture(t);
  f.run.outputs[0].mediaItems[0].taskId = 'different-task';
  const result = await f.execute();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /same-task/);
});

test('changing the inspected image invalidates the visual review', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'output.png'), 'changed bytes');
  const result = await f.execute();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exact-image visual review/);
});
