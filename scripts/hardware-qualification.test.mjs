import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const SCRIPT = resolve('scripts/hardware-qualification.mjs');

test('completed RTX 4080 gallery evidence records the platform and enforces the ACE-Step cold-load target', async () => {
  const root = mkdtempSync(join(tmpdir(), 'modiff-hardware-qualification-'));
  const backend = join(root, 'backend');
  const artifact = join(root, 'gallery');
  const provenancePath = join(artifact, 'run.provenance.json');
  const websocketEventsPath = join(artifact, 'run.websocket-events.json');
  const reportPath = join(artifact, 'report.json');
  mkdirSync(dirname(join(backend, 'data', 'qualification', 'release', 'placeholder')), {
    recursive: true,
  });
  mkdirSync(artifact, { recursive: true });

  writeFileSync(
    provenancePath,
    JSON.stringify({
      schemaVersion: 2,
      blockers: [],
      taskId: 'task-1',
      capturedAt: '2026-07-28T03:17:41.922Z',
      runtimeFingerprint: 'stable-runtime',
      modelRevision: 'model@1234567890123456789012345678901234567890',
      mediaHash: 'sha256:decoded-rgba:test',
      graph: {
        executionPlan: {
          modelType: 'AceStepAudioPipeline',
          offloadMode: 'none',
          quantizationMode: 'none',
        },
      },
      execution: {
        resourceCandidateId: 'example-native',
        elapsedSeconds: 1.5,
        peakMemoryBytes: 1024,
      },
    }),
  );
  writeFileSync(
    websocketEventsPath,
    JSON.stringify({
      events: [
        {
          type: 'executed',
          name: 'modules.DiffusersAudio.LoadPipeline',
          hasChanged: true,
          executionTime: { last: 91.25 },
        },
      ],
    }),
  );

  const server = createServer((request, response) => {
    if (request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        ready: true,
        runtime_fingerprint: 'runtime-1',
        runtime_profile: {
          execution_ready: true,
          installed: 'amd-rocm-linux',
          support_tier: 'experimental',
          manifest_revision: 'revision-1',
        },
        python: { platform: 'linux', version: '3.12.1' },
        packages: {
          torch: {
            version: '2.9.1',
            cuda_devices: [{ name: 'NVIDIA GeForce RTX 4080', total_memory: 16 * 1024 ** 3 }],
          },
        },
      }),
    );
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();

  writeFileSync(
    reportPath,
    JSON.stringify({
      server: `http://127.0.0.1:${address.port}`,
      results: [
        {
          outputs: [
            {
              terminalTask: { status: 'completed', runtimeFingerprint: 'runtime-1' },
              evidence: { provenance: provenancePath, websocketEvents: websocketEventsPath },
            },
          ],
        },
      ],
    }),
  );

  try {
    const result = await new Promise((resolveRun) => {
      const child = spawn(process.execPath, [SCRIPT], {
        cwd: resolve('.'),
        env: {
          ...process.env,
          MODIFF_BACKEND_DIR: backend,
          MODIFF_GALLERY_REPORT: reportPath,
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('close', (status) => resolveRun({ status, stdout, stderr }));
    });
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(
      readFileSync(join(backend, 'data', 'qualification', 'release', 'hardware-qualification.v1.json')),
    ).receipts[0];
    assert.equal(receipt.profileId, 'amd-rocm-linux');
    assert.equal(receipt.supportTierAtCapture, 'experimental');
    assert.equal(receipt.status, 'observed');
    assert.equal(receipt.taskId, 'task-1');
    assert.equal(receipt.resourceCandidateId, 'example-native');
    assert.equal(receipt.coldLoaderDurationSeconds, 91.25);
    assert.equal(receipt.performanceTarget.maxSeconds, 120);
    assert.equal(receipt.performanceQualified, true);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
