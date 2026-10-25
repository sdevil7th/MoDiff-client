import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { canonicalJsonHash } from './canonical-json.mjs';
import { loadTemplateRuntime } from './template-gallery-harness.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'template-qualification.mjs');

function writeBackendFixture(directory, templateId = 'qwen_low_vram_product_concept') {
  const backendDirectory = join(directory, 'backend');
  const graphPath = 'studio/qwen-image-modular-pipeline/text-to-image.json';
  const graph = {
    nodes: [
      {
        id: 'qwen-loader',
        data: {
          module: 'diffusers',
          action: 'QwenImagePipelineLoader',
        },
      },
    ],
    edges: [],
  };
  const graphFile = join(backendDirectory, 'data', 'graphs', ...graphPath.split('/'));
  mkdirSync(resolve(graphFile, '..'), { recursive: true });
  writeFileSync(graphFile, `${JSON.stringify(graph, null, 2)}\n`);
  const manifest = {
    schemaVersion: 1,
    workflows: [
      {
        id: 'QwenImageModularPipeline:text_to_image',
        modelType: 'QwenImageModularPipeline',
        mode: 'text_to_image',
        sourceTemplateId: templateId,
        graphPath,
        graphHash: canonicalJsonHash(graph),
      },
    ],
  };
  const manifestPath = join(backendDirectory, 'data', 'workflow-library-manifest.json');
  mkdirSync(resolve(manifestPath, '..'), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return backendDirectory;
}

async function fixture(templateId = 'qwen_low_vram_product_concept') {
  const runtime = await loadTemplateRuntime(ROOT, { includePlanning: true });
  const template = runtime.templates.find((candidate) => candidate.id === templateId);
  assert.ok(template, templateId);
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
          mediaType: template.example.mediaType,
          width: expectedOutput.width,
          height: expectedOutput.height,
          ...(expectedOutput.frames ? { frames: expectedOutput.frames } : {}),
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
  const backendDirectory = writeBackendFixture(directory);
  writeFileSync(provenancePath, `${JSON.stringify(await fixture(), null, 2)}\n`);

  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      MODIFF_BACKEND_DIR: backendDirectory,
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
  const backendDirectory = writeBackendFixture(directory);
  const provenance = await fixture();
  provenance.template.catalogTemplateLockHash = 'tpl_stale';
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      MODIFF_BACKEND_DIR: backendDirectory,
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
  const backendDirectory = writeBackendFixture(directory);
  const provenance = await fixture();
  provenance.output.items[0].width += 16;
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      MODIFF_BACKEND_DIR: backendDirectory,
      MODIFF_TEMPLATE_PROVENANCE: provenancePath,
      MODIFF_TEMPLATE_RECEIPT_REGISTRY: registryPath,
      MODIFF_TEMPLATE_PROVENANCE_DIR: join(directory, 'retained'),
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /output contract mismatch for width/i);
  rmSync(directory, { recursive: true, force: true });
});

// Synthetic registrar fixtures test evidence retention, never model output quality.
const BLOCKED_TEMPLATE_ID = 'wan_vace_direct_text_to_video';

function qualificationFixtureProcess(directory, provenance, argv = [], { canonical = true } = {}) {
  const provenancePath = join(directory, 'proof.json');
  const registryPath = join(directory, 'registry.json');
  const backendDirectory = canonical
    ? writeBackendFixture(directory, provenance.template.id)
    : join(directory, 'backend');
  if (!canonical) {
    mkdirSync(join(backendDirectory, 'data'), { recursive: true });
    writeFileSync(join(backendDirectory, 'data', 'workflow-library-manifest.json'), '{"workflows":[]}\n');
  }
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  const result = spawnSync(process.execPath, [SCRIPT, ...argv], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      MODIFF_BACKEND_DIR: backendDirectory,
      MODIFF_TEMPLATE_PROVENANCE: provenancePath,
      MODIFF_TEMPLATE_RECEIPT_REGISTRY: registryPath,
      MODIFF_TEMPLATE_PROVENANCE_DIR: join(directory, 'retained'),
    },
  });
  return { result, registryPath };
}

test('blocked template lookup requires explicit opt-in and retaining a receipt cannot promote its source', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-blocked-'));
  const sourcePaths = [
    join(ROOT, 'src/studio/templates.ts'),
    join(ROOT, 'src/studio/templateOperationSelections.ts'),
    join(ROOT, 'public/template-gallery/manifest.json'),
  ];
  const sourceBefore = sourcePaths.map((file) => readFileSync(file));
  const provenance = await fixture(BLOCKED_TEMPLATE_ID);
  try {
    const ordinary = qualificationFixtureProcess(directory, provenance);
    assert.notEqual(ordinary.result.status, 0);
    assert.match(ordinary.result.stderr, /not in the runtime catalog/);
    assert.equal(existsSync(ordinary.registryPath), false);
    const explicit = qualificationFixtureProcess(directory, provenance, ['--allow-blocked-probe']);
    assert.equal(explicit.result.status, 0, explicit.result.stderr);
    const registry = JSON.parse(readFileSync(explicit.registryPath, 'utf8'));
    assert.equal(registry.receipts.length, 1);
    assert.equal(registry.receipts[0].templateId, BLOCKED_TEMPLATE_ID);
    assert.equal(registry.receipts[0].catalogTemplateLockHash, provenance.template.catalogTemplateLockHash);
    assert.equal(registry.receipts[0].promptSettingsHash, provenance.template.promptSettingsHash);
    assert.equal(registry.receipts[0].outputHash, provenance.mediaHash);
    const runtime = await loadTemplateRuntime(ROOT, { includePlanning: true });
    assert.equal(runtime.templates.find((item) => item.id === BLOCKED_TEMPLATE_ID).example.status, 'blocked');
    sourcePaths.forEach((file, index) => assert.deepEqual(readFileSync(file), sourceBefore[index], file));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('blocked lookup opt-in retains every receipt prerequisite', async (t) => {
  const provenance = await fixture(BLOCKED_TEMPLATE_ID);
  const cases = [
    [
      'proof blockers',
      (value) => {
        value.blockers = ['unresolved source identity'];
      },
      /contains blocker/,
    ],
    [
      'catalog lock',
      (value) => {
        value.template.catalogTemplateLockHash = 'tpl_stale';
      },
      /catalog lock is stale/i,
    ],
    [
      'prompt lock',
      (value) => {
        value.template.promptSettingsHash = 'prompt_stale';
      },
      /prompt\/settings lock is stale/i,
    ],
    ['canonical workflow', () => {}, /no current canonical workflow/i, { canonical: false }],
    [
      'output contract',
      (value) => {
        value.output.items[0].width += 16;
      },
      /output contract mismatch for width/i,
    ],
    [
      'immutable model',
      (value) => {
        value.modelRevision = 'model@main';
      },
      /missing modelRevision/,
    ],
    [
      'resource identity',
      (value) => {
        value.execution.resourceCandidateId = null;
      },
      /missing resourceCandidateId/,
    ],
    [
      'timing',
      (value) => {
        value.execution.elapsedSeconds = null;
      },
      /missing executionDurationSeconds/,
    ],
    [
      'memory',
      (value) => {
        value.execution.peakMemoryBytes = 0;
      },
      /missing peakMemoryBytes/,
    ],
  ];
  for (const [name, change, expected, options] of cases) {
    await t.test(name, () => {
      const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-blocked-negative-'));
      try {
        const candidate = structuredClone(provenance);
        change(candidate);
        const { result, registryPath } = qualificationFixtureProcess(
          directory,
          candidate,
          ['--allow-blocked-probe'],
          options,
        );
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, expected);
        assert.equal(existsSync(registryPath), false);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});

test('template qualification rejects unknown or repeated lookup options', () => {
  for (const argv of [['--include-planning'], ['--publish'], ['--allow-blocked-probe', '--allow-blocked-probe']]) {
    const result = spawnSync(process.execPath, [SCRIPT, ...argv], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /only one optional --allow-blocked-probe argument/);
  }
});
