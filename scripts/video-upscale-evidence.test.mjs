import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCanonicalWorkflowEvidence } from './release-contract-core.mjs';
import { verifyVideoUpscaleFileChain } from './video-upscale-evidence.mjs';

const evidencePath = process.env.MODIFF_VIDEO_UPSCALE_EVIDENCE;
test(
  'native upscale receipt binds both original output owners, the checkpoint and the source',
  { skip: !evidencePath },
  async () => {
    const clientRoot = fileURLToPath(new URL('..', import.meta.url));
    const backendRoot = resolve(process.env.MODIFF_BACKEND_DIR ?? join(clientRoot, '..', 'MoDiff'));
    const args = { clientRoot, backendRoot, evidencePath, workflowId: 'SpandrelVideoUpscale:video_upscale' };
    const result = await readCanonicalWorkflowEvidence(args);
    assert.deepEqual(result.receipt.decodedOutput, {
      hash: 'sha256:decoded-video-framemd5:cb31cd0903f5e394e21f0ac8bd6373e0e67fb0a93a3191fef43e628bec0f17ed',
      width: 1024,
      height: 576,
      fps: 16,
      frameCount: 54,
    });
    assert.equal(
      result.receipt.inputBinding.sha256,
      '5c24b2b67f893f48e4dbf0d893e0aa4308852592f30f8179b44298cca4ce197e',
    );
    assert.ok(Object.values(result.receipt.qualificationClaims).every((claim) => claim === false));
    const temp = mkdtempSync(join(tmpdir(), 'modiff-video-evidence-'));
    try {
      for (const file of result.retainedFiles) {
        assert.equal(basename(file.path), file.path);
        copyFileSync(file.absolutePath, join(temp, file.path));
      }
      const changed = JSON.parse(result.descriptorBytes.toString('utf8'));
      changed.intermediate = changed.output;
      const changedPath = join(temp, 'changed.json');
      writeFileSync(changedPath, JSON.stringify(changed));
      await assert.rejects(
        readCanonicalWorkflowEvidence({ ...args, evidencePath: changedPath }),
        /UpscaleVideo bytes or controls differ/u,
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  },
);

test('upscale input and export must belong to the same observed run', () => {
  assert.throws(
    () =>
      verifyVideoUpscaleFileChain({
        resolved: { schemaVersion: 1, source: 'backend-execution', taskId: 'other' },
        taskId: 'reviewed',
      }),
    /other/u,
  );
});
