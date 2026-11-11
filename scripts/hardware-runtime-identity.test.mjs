import assert from 'node:assert/strict';
import test from 'node:test';
import { assertHardwareRuntimeMatches } from './hardware-qualification-runtime.mjs';
import { normalizeBackendRuntime, sha256Value } from './live-proof-provenance.mjs';

function fixture() {
  const source = { gitCommit: 'a'.repeat(40), files: [{ path: 'main.py', sha256: 'b'.repeat(64) }] };
  source.fingerprint = sha256Value('backend-source-v1', source);
  const attestation = {
    schemaVersion: 1,
    claim: 'process_start_backend_source_identity',
    gitCommit: source.gitCommit,
    fingerprint: source.fingerprint,
    fileCount: 1,
    capturedAt: '2026-11-03T00:00:00Z',
  };
  const observed = {
    fingerprint: 'sha256:execution',
    resourceFingerprint: 'sha256:resource',
    packages: { torch: 'synthetic' },
    torch: { cuda_available: true },
    work_dir: '/mock/work',
    data_dir: '/mock/data',
    backendSource: attestation,
  };
  return [
    observed,
    { runtime_fingerprint: observed.resourceFingerprint, backend_source: structuredClone(attestation) },
    {
      runtimeFingerprint: normalizeBackendRuntime(observed).lockFingerprint,
      runtime: { reportedFingerprint: observed.fingerprint, backendSource: source },
    },
  ];
}

test('health resource identity corroborates separate execution identity and exact source', () => {
  const args = fixture();
  const before = structuredClone(args);
  assert.notEqual(args[0].fingerprint, args[1].runtime_fingerprint);
  assert.doesNotThrow(() => assertHardwareRuntimeMatches(...args));
  assert.deepEqual(args, before);
});

for (const [name, mutate] of [
  [
    'a resource hash without execution identity',
    ([runtime]) => {
      delete runtime.fingerprint;
    },
  ],
  [
    'the wrong health hash domain',
    ([runtime, health]) => {
      health.runtime_fingerprint = runtime.fingerprint;
    },
  ],
  [
    'another execution with the same resource hash',
    ([runtime]) => {
      runtime.fingerprint = 'sha256:other-execution';
    },
  ],
  [
    'changed runtime contents behind matching string hashes',
    ([runtime]) => {
      runtime.packages.torch = 'other';
    },
  ],
  [
    'another worker source',
    ([, health]) => {
      health.backend_source.gitCommit = 'c'.repeat(40);
    },
  ],
  [
    'missing worker source',
    ([, health]) => {
      delete health.backend_source;
    },
  ],
  [
    'invalid source inventory',
    ([, , proof]) => {
      proof.runtime.backendSource.files[0].sha256 = 'd'.repeat(64);
    },
  ],
  [
    'missing original execution binding',
    ([, , proof]) => {
      delete proof.runtime.reportedFingerprint;
    },
  ],
]) {
  test(`reject ${name}`, () => {
    const args = fixture();
    mutate(args);
    assert.throws(() => assertHardwareRuntimeMatches(...args));
  });
}
