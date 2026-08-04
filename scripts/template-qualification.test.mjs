import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { loadTemplateRuntime } from './template-gallery-harness.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'template-qualification.mjs');

async function fixture() {
  const runtime = await loadTemplateRuntime(ROOT);
  const template = runtime.templates.find((candidate) => candidate.id === 'qwen_low_vram_product_concept');
  const expectedOutput = template.example?.expectedOutput;
  return {
    schemaVersion: 2,
    format: 'modiff.live-proof.provenance.v2',
    capturedAt: '2026-07-26T00:00:00.000Z',
    taskId: 'qualification-task',
    graphHash: 'sha256:canonical-graph-v1:test',
    runtimeFingerprint: 'sha256:stable-runtime-v1:test',
    backendSourceFingerprint: 'sha256:backend-source-v1:test',
    backendContractFingerprint: 'sha256:backend-contract-v1:test',
    modelRevision: 'Qwen/Qwen-Image-2512@1234567890123456789012345678901234567890',
    templateLockHash: 'tpl_resolved_test',
    mediaHash: 'sha256:decoded-rgba:test',
    blockers: [],
    template: {
      id: template.id,
      catalogTemplateLockHash: runtime.templateLockHash(template),
      promptSettingsHash: runtime.promptSettingsHash(template),
    },
    execution: {
      resourceCandidateId: 'qwen-qualified-candidate',
      elapsedSeconds: 12.5,
      peakMemoryBytes: 4096,
    },
    output: {
      items: [
        {
          mediaType: 'image',
          width: expectedOutput.width,
          height: expectedOutput.height,
          decodedSha256: 'sha256:decoded-rgba:test',
        },
      ],
    },
  };
}

test('locked v2 template proofs become immutable execution receipts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-'));
  const provenancePath = join(directory, 'proof.json');
  const registryPath = join(directory, 'registry.json');
  const retainedDirectory = join(directory, 'retained');
  writeFileSync(provenancePath, `${JSON.stringify(await fixture(), null, 2)}\n`);

  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      MODIFF_TEMPLATE_PROVENANCE: provenancePath,
      MODIFF_TEMPLATE_RECEIPT_REGISTRY: registryPath,
      MODIFF_TEMPLATE_PROVENANCE_DIR: retainedDirectory,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  assert.equal(registry.receipts.length, 1);
  assert.equal(registry.receipts[0].templateId, 'qwen_low_vram_product_concept');
  assert.equal(registry.receipts[0].executionDurationSeconds, 12.5);
  assert.equal(registry.receipts[0].peakMemoryBytes, 4096);
  assert.match(registry.receipts[0].canonicalWorkflowHash, /^sha256:workflow-graph-v1:[0-9a-f]{64}$/);
  assert.match(registry.receipts[0].proofSha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    JSON.parse(readFileSync(join(retainedDirectory, registry.receipts[0].proofPath.split('/').at(-1)), 'utf8')).taskId,
    'qualification-task',
  );
  rmSync(directory, { recursive: true, force: true });
});

test('stale template locks are rejected before a receipt is written', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-stale-'));
  const provenancePath = join(directory, 'proof.json');
  const registryPath = join(directory, 'registry.json');
  const provenance = await fixture();
  provenance.template.catalogTemplateLockHash = 'tpl_stale';
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      MODIFF_TEMPLATE_PROVENANCE: provenancePath,
      MODIFF_TEMPLATE_RECEIPT_REGISTRY: registryPath,
      MODIFF_TEMPLATE_PROVENANCE_DIR: join(directory, 'retained'),
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /catalog lock is stale/i);
  rmSync(directory, { recursive: true, force: true });
});

test('template proofs with output dimensions that violate the locked contract are rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-output-contract-'));
  const provenancePath = join(directory, 'proof.json');
  const registryPath = join(directory, 'registry.json');
  const provenance = await fixture();
  provenance.output.items[0].width += 16;
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      MODIFF_TEMPLATE_PROVENANCE: provenancePath,
      MODIFF_TEMPLATE_RECEIPT_REGISTRY: registryPath,
      MODIFF_TEMPLATE_PROVENANCE_DIR: join(directory, 'retained'),
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /output contract mismatch for width/i);
  rmSync(directory, { recursive: true, force: true });
});
