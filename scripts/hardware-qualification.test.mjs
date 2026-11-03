import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { createRunProvenance, sha256Value } from './live-proof-provenance.mjs';
import { protocolFactoryArguments } from './canonical-provenance-fixtures.mjs';

const SCRIPT = resolve(process.env.MODIFF_HARDWARE_QUALIFIER_SCRIPT || 'scripts/hardware-qualification.mjs');

// Synthetic values in the actual retained /runs runtimeFingerprint shape. These
// exercise the recorder contract; they are never physical qualification evidence.
const sourceInventory = { gitCommit: 'a'.repeat(40), files: [{ path: 'main.py', sha256: 'b'.repeat(64) }] };
sourceInventory.fingerprint = sha256Value('backend-source-v1', sourceInventory);
const sourceAttestation = {
  schemaVersion: 1,
  claim: 'process_start_backend_source_identity',
  gitCommit: sourceInventory.gitCommit,
  fingerprint: sourceInventory.fingerprint,
  fileCount: 1,
  capturedAt: '2026-07-28T00:00:00Z',
};
const structuredFingerprint = {
  fingerprint: 'runtime-1',
  resourceFingerprint: 'resource-runtime-1',
  packages: { torch: '2.9.1' },
  torch: { cuda_available: true },
  work_dir: 'unit-work',
  data_dir: 'unit-data',
  backendSource: sourceAttestation,
  hardware: { peakAccountingVersion: 2 },
};

for (const {
  name,
  fingerprint,
  healthFingerprint = fingerprint?.resourceFingerprint ?? 'runtime-1',
  measuredDevice = 'cuda:0',
  measuredBackend = 'cuda',
  retained = false,
  missingTerminal = false,
  terminalId = 'task-1',
  error,
} of [
  { name: 'legacy string', fingerprint: 'runtime-1' },
  { name: 'structured current task', fingerprint: structuredFingerprint },
  { name: 'retained original completed task', fingerprint: structuredFingerprint, retained: true },
  {
    name: 'retained status cannot replace original task',
    fingerprint: structuredFingerprint,
    retained: true,
    missingTerminal: true,
    error: /Original completed task receipt is missing/,
  },
  {
    name: 'retained task must own the provenance',
    fingerprint: structuredFingerprint,
    retained: true,
    terminalId: 'other-task',
    error: /not the completed provenance owner/,
  },
  {
    name: 'CPU evidence cannot qualify a GPU host',
    fingerprint: structuredFingerprint,
    measuredDevice: 'cpu',
    measuredBackend: 'cpu',
    error: /Executed device\/backend does not match/,
  },
  {
    name: 'executed GPU index cannot fall back to the first GPU',
    fingerprint: structuredFingerprint,
    measuredDevice: 'cuda:1',
    error: /Executed accelerator is missing/,
  },
  { name: 'different legacy runtime', fingerprint: 'runtime-2', error: /does not match/ },
  {
    name: 'different structured runtime',
    fingerprint: { ...structuredFingerprint, fingerprint: 'runtime-2' },
    healthFingerprint: 'different-resource-runtime',
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
    const apiGraph = {
      nodes: {
        loader: {
          module: 'modules.DiffusersAudio',
          action: 'LoadPipeline',
          params: {
            model_id: { value: { source: 'hub', value: 'unit/model' } },
            revision: { value: '1'.repeat(40) },
          },
        },
      },
      paths: [['loader']],
      runtimeHints: {
        modelType: 'AceStepAudioPipeline',
        dtype: 'bfloat16',
        offloadMode: 'none',
        quantizationMode: 'none',
      },
    };
    const args = protocolFactoryArguments(apiGraph);
    Object.assign(args, {
      backendSource: sourceInventory,
      taskId: 'task-1',
      capturedAt: '2026-07-28T03:17:41.922Z',
      runtimeFingerprint:
        typeof fingerprint?.fingerprint === 'string' && fingerprint?.backendSource
          ? fingerprint
          : {
              ...structuredFingerprint,
              fingerprint: typeof fingerprint === 'string' && fingerprint ? fingerprint : 'runtime-1',
            },
      executionReceipt: {
        runtimeHints: { autoResourceCandidateId: 'example-native' },
        runtimeMeasurement: {
          device: measuredDevice,
          backend: measuredBackend,
          elapsedSeconds: 1.5,
          peakAllocatedBytes: 1024,
        },
      },
    });
    const provenance = createRunProvenance(args);
    assert.deepEqual(provenance.blockers, []);
    const stableRuntime = provenance.runtimeFingerprint;
    mkdirSync(dirname(join(backend, 'data', 'qualification', 'release', 'placeholder')), {
      recursive: true,
    });
    mkdirSync(artifact, { recursive: true });

    writeFileSync(provenancePath, JSON.stringify(provenance));
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
          backend_source: sourceAttestation,
          runtime_profile: {
            execution_ready: true,
            installed: 'nvidia-cuda',
            support_tier: 'experimental',
            manifest_revision: 'revision-1',
          },
          python: { platform: 'linux', version: '3.12.1' },
          packages: {
            torch: {
              version: '2.9.1',
              cuda_devices: [
                { index: 0, name: 'NVIDIA GeForce RTX 4080', backend: 'cuda', total_memory: 16 * 1024 ** 3 },
              ],
            },
          },
        }),
      );
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (retained) {
      const health = await (await fetch(`http://127.0.0.1:${address.port}/health`)).json();
      writeFileSync(join(artifact, 'websocket-events.json'), readFileSync(websocketEventsPath));
      writeFileSync(join(artifact, 'backend-health.json'), JSON.stringify(health));
      writeFileSync(join(artifact, 'run-provenance.json'), JSON.stringify(provenance));
      writeFileSync(join(artifact, 'status.json'), JSON.stringify({ step: 'success' }));
      if (!missingTerminal)
        writeFileSync(
          join(artifact, 'run-terminal.json'),
          JSON.stringify({
            task: {
              status: 'completed',
              task_id: terminalId,
              runtimeFingerprint: fingerprint,
            },
          }),
        );
    }

    writeFileSync(
      reportPath,
      JSON.stringify({
        server: `http://127.0.0.1:${address.port}`,
        results: [
          {
            outputs: [
              {
                terminalTask: { status: 'completed', task_id: 'task-1', runtimeFingerprint: fingerprint },
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
            MODIFF_GALLERY_REPORT: retained ? '' : reportPath,
            MODIFF_LIVE_PROOF_ARTIFACT: retained ? artifact : '',
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
      assert.equal(receipt.profileId, 'nvidia-cuda');
      assert.equal(receipt.supportTierAtCapture, 'experimental');
      assert.equal(receipt.status, 'observed');
      assert.equal(receipt.taskId, 'task-1');
      assert.equal(receipt.resourceCandidateId, 'example-native');
      assert.equal(receipt.runtimeFingerprint, stableRuntime, 'Retain the downstream provenance lock.');
      assert.equal(receipt.peakMemoryBytes, 1024);
      assert.equal(receipt.coldLoaderDurationSeconds, 91.25);
      assert.equal(receipt.performanceTarget.maxSeconds, 120);
      assert.equal(receipt.performanceQualified, true);
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  });
