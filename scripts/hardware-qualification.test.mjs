import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const SCRIPT = resolve('scripts/hardware-qualification.mjs');

// Synthetic values in the actual retained /runs runtimeFingerprint shape. These
// exercise the recorder contract; they are never physical qualification evidence.
const structuredFingerprint = {
  fingerprint: 'runtime-1',
  resourceFingerprint: 'resource-runtime-1',
  packages: { torch: '2.9.1' },
  torch: { cuda_available: true },
  work_dir: 'unit-work',
  data_dir: 'unit-data',
  backendSource: { fingerprint: 'unit-source' },
  hardware: { peakAccountingVersion: 2 },
};

for (const { name, fingerprint, healthFingerprint = 'runtime-1', error } of [
  { name: 'legacy string', fingerprint: 'runtime-1' },
  { name: 'structured current task', fingerprint: structuredFingerprint },
  { name: 'different legacy runtime', fingerprint: 'runtime-2', error: /does not match/ },
  {
    name: 'different structured runtime',
    fingerprint: { ...structuredFingerprint, fingerprint: 'runtime-2' },
    error: /does not match/,
  },
  { name: 'missing task runtime', fingerprint: undefined, error: /missing a runtime fingerprint/ },
  { name: 'null task runtime', fingerprint: null, error: /missing a runtime fingerprint/ },
  { name: 'empty task runtime', fingerprint: '', error: /missing a runtime fingerprint/ },
  {
    name: 'resource hash cannot replace runtime hash',
    fingerprint: { resourceFingerprint: 'runtime-1' },
    error: /missing a runtime fingerprint/,
  },
  { name: 'non-string structured hash', fingerprint: { fingerprint: 123 }, error: /missing a runtime fingerprint/ },
  { name: 'array is not a structured runtime', fingerprint: ['runtime-1'], error: /missing a runtime fingerprint/ },
  {
    name: 'missing health runtime',
    fingerprint: structuredFingerprint,
    healthFingerprint: null,
    error: /missing a runtime fingerprint/,
  },
])
  test(`gallery hardware evidence: ${name}`, async () => {
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
          runtime_fingerprint: healthFingerprint,
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
                terminalTask: { status: 'completed', runtimeFingerprint: fingerprint },
                evidence: { provenance: provenancePath, websocketEvents: websocketEventsPath },
              },
            ],
          },
        ],
      }),
    );
    const reportBefore = readFileSync(reportPath);
    const provenanceBefore = readFileSync(provenancePath);

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
      assert.deepEqual(readFileSync(reportPath), reportBefore, 'Preserve the complete task runtime object.');
      assert.deepEqual(readFileSync(provenancePath), provenanceBefore, 'Do not rewrite downstream provenance.');
      if (error) {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, error);
        assert.equal(
          existsSync(join(backend, 'data', 'qualification', 'release', 'hardware-qualification.v1.json')),
          false,
        );
        return;
      }
      assert.equal(result.status, 0, result.stderr);
      const receipt = JSON.parse(
        readFileSync(join(backend, 'data', 'qualification', 'release', 'hardware-qualification.v1.json')),
      ).receipts[0];
      assert.equal(receipt.profileId, 'amd-rocm-linux');
      assert.equal(receipt.supportTierAtCapture, 'experimental');
      assert.equal(receipt.status, 'observed');
      assert.equal(receipt.taskId, 'task-1');
      assert.equal(receipt.resourceCandidateId, 'example-native');
      assert.equal(receipt.runtimeFingerprint, 'stable-runtime', 'Retain the downstream provenance lock.');
      assert.equal(receipt.peakMemoryBytes, 1024);
      assert.equal(receipt.coldLoaderDurationSeconds, 91.25);
      assert.equal(receipt.performanceTarget.maxSeconds, 120);
      assert.equal(receipt.performanceQualified, true);
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  });
