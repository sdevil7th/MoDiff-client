import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { canonicalJsonHash } from './canonical-json.mjs';
import {
  canonicalWorkflowContract,
  canonicalEvidenceWritePath,
  exportCanonicalWorkflowGraphs,
  readCanonicalEvidenceFile,
  readCanonicalWorkflowEvidence,
  validateCanonicalWorkflowEvidence,
} from './release-contract-core.mjs';
import { canonicalGraphIdentity, sha256Value } from './live-proof-provenance.mjs';
import { hintedCanonicalHookCase, mockedDdimAccountingFixture } from './canonical-provenance-fixtures.mjs';
import { loadTemplateRuntime } from './template-gallery-harness.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'template-qualification.mjs');

function disposeFixture(directory) {
  const actual = realpathSync(directory);
  assert.equal(dirname(actual), realpathSync(tmpdir()));
  assert.ok(basename(actual).startsWith('modiff-template-qualification-'));
  rmSync(actual, { recursive: true, force: true });
}

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
  disposeFixture(directory);
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
  disposeFixture(directory);
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
  disposeFixture(directory);
});

// Synthetic registrar fixtures test evidence retention, never model output quality.
const BLOCKED_TEMPLATE_ID = 'wan_vace_direct_text_to_video';

function qualificationFixtureProcess(
  directory,
  provenance,
  argv = [],
  { canonical = true, experimental = false, staleGraph = false } = {},
) {
  const provenancePath = join(directory, 'proof.json');
  const registryPath = join(directory, 'registry.json');
  const backendDirectory = canonical
    ? writeBackendFixture(directory, provenance.template.id)
    : join(directory, 'backend');
  if (!canonical) {
    mkdirSync(join(backendDirectory, 'data'), { recursive: true });
    writeFileSync(join(backendDirectory, 'data', 'workflow-library-manifest.json'), '{"workflows":[]}\n');
  }
  if (canonical && experimental) {
    const manifestPath = join(backendDirectory, 'data', 'workflow-library-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const ordinary = manifest.workflows[0];
    const graphFile = join(backendDirectory, 'data', 'graphs', ordinary.graphPath);
    const graph = JSON.parse(readFileSync(graphFile, 'utf8'));
    const modelType = provenance.template.id.startsWith('flux3_klein_base_')
      ? 'Flux3ModularPipeline'
      : provenance.template.id.startsWith('flux3_klein_')
        ? 'Flux3DistilledModularPipeline'
        : 'QwenImageModularPipeline';
    const generic = {
      ...ordinary,
      id: `${modelType}:text_to_image`,
      modelType,
      sourceTemplateId: provenance.template.id.replace('lora_style', 'text_to_image'),
      supportTier: 'experimental',
      runtimeQualificationStatus: 'unqualified',
      optimizationQualificationStatus: 'unqualified',
      qualifiedRuntimeProfiles: [],
    };
    const variantGraph = {
      ...graph,
      nodes: [...graph.nodes, { id: 'synthetic-lora', data: { module: 'modules.ModularDiffusers', action: 'Lora' } }],
    };
    const variant = {
      ...generic,
      id: `${modelType}:text_to_image:${provenance.template.id}`,
      sourceTemplateId: provenance.template.id,
      variant: 'lora-theme',
      graphPath: 'experimental/selected-lora.json',
      graphHash: staleGraph ? '0'.repeat(64) : canonicalJsonHash(variantGraph),
    };
    const variantFile = join(backendDirectory, 'data', 'graphs', variant.graphPath);
    mkdirSync(resolve(variantFile, '..'), { recursive: true });
    writeFileSync(variantFile, `${JSON.stringify(variantGraph, null, 2)}\n`);
    manifest.workflows = [];
    manifest.experimentalWorkflows = [generic, variant];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
  return { result, registryPath, backendDirectory };
}

test('public experimental LoRA variants require explicit canonical lookup and retain their exact graph hash', async (t) => {
  for (const templateId of ['flux3_klein_fp8r512_lora_style', 'flux3_klein_base_fp8r512_lora_style']) {
    await t.test(templateId, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-experimental-'));
      const provenance = await fixture(templateId);
      assert.equal(provenance.adapterApplications, undefined, 'Historical submitted-graph proofs remain optional.');
      try {
        const ordinary = qualificationFixtureProcess(directory, provenance, [], { experimental: true });
        assert.notEqual(ordinary.result.status, 0);
        assert.match(ordinary.result.stderr, /no current canonical workflow/);
        assert.equal(existsSync(ordinary.registryPath), false);
        const explicit = qualificationFixtureProcess(directory, provenance, ['--allow-blocked-probe'], {
          experimental: true,
        });
        assert.equal(explicit.result.status, 0, explicit.result.stderr);
        const manifest = JSON.parse(
          readFileSync(join(explicit.backendDirectory, 'data', 'workflow-library-manifest.json'), 'utf8'),
        );
        const variant = manifest.experimentalWorkflows.find((record) => record.sourceTemplateId === templateId);
        const graph = JSON.parse(
          readFileSync(join(explicit.backendDirectory, 'data', 'graphs', variant.graphPath), 'utf8'),
        );
        const registry = JSON.parse(readFileSync(explicit.registryPath, 'utf8'));
        assert.equal(registry.receipts.length, 1);
        assert.equal(registry.receipts[0].templateId, templateId);
        assert.equal(registry.receipts[0].canonicalWorkflowHash, canonicalWorkflowContract(variant, graph).graphHash);
        assert.deepEqual(manifest.workflows, []);
        assert.ok(
          manifest.experimentalWorkflows.every((record) => record.runtimeQualificationStatus === 'unqualified'),
        );
        assert.ok(manifest.experimentalWorkflows.every((record) => record.qualifiedRuntimeProfiles.length === 0));
        const runtime = await loadTemplateRuntime(ROOT, { includePlanning: true });
        assert.equal(runtime.templates.find((item) => item.id === templateId).example.status, 'unverified');
      } finally {
        disposeFixture(directory);
      }
    });
  }
});

test('optional applied adapter observations cannot bypass validation at recording time', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-applied-adapters-'));
  try {
    const provenance = await fixture();
    provenance.adapterApplications = { schemaVersion: 1, source: 'invented' };
    provenance.adapterApplicationsHash = `sha256:adapter-applications-v1:${'a'.repeat(64)}`;
    const { result, registryPath } = qualificationFixtureProcess(directory, provenance);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Applied adapter proof is invalid/);
    assert.equal(existsSync(registryPath), false);
    assert.equal(existsSync(join(directory, 'retained')), false);
  } finally {
    disposeFixture(directory);
  }
});

test('blocked-probe lookup rejects a stale experimental canonical graph before retaining evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-experimental-stale-'));
  try {
    const provenance = await fixture('flux3_klein_fp8r512_lora_style');
    const { result, registryPath } = qualificationFixtureProcess(directory, provenance, ['--allow-blocked-probe'], {
      experimental: true,
      staleGraph: true,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /graph hash does not match its manifest/);
    assert.equal(existsSync(registryPath), false);
    assert.equal(existsSync(join(directory, 'retained')), false);
  } finally {
    disposeFixture(directory);
  }
});

test('ordinary public recording never falls back to an experimental canonical record', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-public-scope-'));
  try {
    const { result, registryPath } = qualificationFixtureProcess(directory, await fixture(), [], {
      experimental: true,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no current canonical workflow/);
    assert.equal(existsSync(registryPath), false);
    assert.equal(existsSync(join(directory, 'retained')), false);
  } finally {
    disposeFixture(directory);
  }
});

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
    disposeFixture(directory);
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
        disposeFixture(directory);
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

test('standalone canonical recording has an explicit evidence boundary without a public template lookup', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--workflow', 'AllegroPipeline:text_to_video'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, MODIFF_CANONICAL_WORKFLOW_EVIDENCE: '' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MODIFF_CANONICAL_WORKFLOW_EVIDENCE/);
  assert.doesNotMatch(result.stderr, /not in the runtime catalog/);
});

async function writeStandaloneEvidence(directory, { input = false, accounting = false, hinted = false } = {}) {
  const nativeFixture = accounting ? mockedDdimAccountingFixture() : null;
  const hintedFixture = hinted ? await hintedCanonicalHookCase() : null;
  const backendRoot = join(directory, 'backend');
  const evidenceRoot = join(directory, 'originals');
  mkdirSync(evidenceRoot, { recursive: true });
  const write = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    writeFileSync(path, bytes);
    return {
      path: path.slice(evidenceRoot.length + 1).replaceAll('\\', '/'),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  };
  const revision = nativeFixture?.apiGraph.nodes['node-01'].params.revision.value ?? 'a'.repeat(40);
  const modelRepo = nativeFixture?.apiGraph.nodes['node-01'].params.model_id.value.value ?? 'synthetic/model';
  const value = (x, type = 'string') => ({ value: x, type });
  let graph = {
    nodes: [
      {
        id: 'loader',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          module: 'modules.DiffusersImage',
          action: 'LoadPipeline',
          params: {
            model_id: { ...value({ source: 'hub', value: 'synthetic/model' }), display: 'modelselect' },
            revision: value(revision),
            dtype: value('float32'),
            auto_offload: value(false, 'bool'),
            offload_mode: value('none'),
            pipeline: { display: 'output', type: 'pipeline' },
          },
        },
      },
      {
        id: 'generate',
        type: 'custom',
        position: { x: 200, y: 0 },
        data: {
          module: 'modules.DiffusersImage',
          action: 'Generate',
          params: {
            pipeline: { display: 'input', type: 'pipeline' },
            prompt: value('Synthetic metadata-only protocol test'),
            seed: { ...value({ value: 7, isRandom: false }, 'int'), display: 'random' },
            width: value(1, 'int'),
            height: value(1, 'int'),
            image: { display: 'output', type: 'image' },
          },
        },
      },
      {
        id: 'preview',
        type: 'custom',
        position: { x: 400, y: 0 },
        data: { module: 'modules.Image', action: 'Preview', params: { image: { display: 'input', type: 'image' } } },
      },
    ],
    edges: [
      { id: 'e1', source: 'loader', target: 'generate', sourceHandle: 'pipeline', targetHandle: 'pipeline' },
      { id: 'e2', source: 'generate', target: 'preview', sourceHandle: 'image', targetHandle: 'image' },
    ],
  };
  if (nativeFixture) graph = nativeFixture.graph;
  if (input)
    graph.nodes[1].data.params.input_image = {
      ...value(input === true ? '@data/images/synthetic.png' : input),
      display: 'filebrowser',
    };
  const manifest = {
    id: accounting ? 'DDIMPipeline:unconditional_image' : 'SyntheticPipeline:text_to_image',
    modelType: accounting ? 'DDIMPipeline' : 'SyntheticPipeline',
    mode: accounting ? 'unconditional_image' : 'text_to_image',
    sourceTemplateId: 'task-template:synthetic:text-to-image:v1',
    graphPath: 'studio/synthetic.json',
    graphHash: canonicalJsonHash(graph),
    requiredArtifacts: [modelRepo],
  };
  write(join(backendRoot, 'data/graphs', manifest.graphPath), graph);
  write(join(backendRoot, 'data/workflow-library-manifest.json'), { workflows: [manifest] });
  write(join(backendRoot, 'data/model-artifact-catalog.json'), {
    models: [{ modelType: manifest.modelType, baseRepo: modelRepo, baseRevision: revision }],
  });
  write(join(backendRoot, 'data/template-authoring-specs.v1.json'), {
    specifications: [
      {
        id: 'template-authoring:synthetic',
        canonicalWorkflowId: manifest.id,
        modelType: manifest.modelType,
        mode: manifest.mode,
        canonicalGraph: { path: manifest.graphPath, sha256: manifest.graphHash },
        defaultsPlan: { sourceGraphSha256: manifest.graphHash },
        artifactPlan: { requiredArtifacts: manifest.requiredArtifacts },
        outputPlan: { minimumAssetCount: 1, mediaKinds: ['image'] },
      },
    ],
  });
  let [api] = await exportCanonicalWorkflowGraphs(ROOT, [graph]);
  if (nativeFixture)
    assert.equal(canonicalGraphIdentity(api).hash, canonicalGraphIdentity(nativeFixture.apiGraph).hash);
  else
    api.runtimeHints = {
      modelType: manifest.modelType,
      dtype: 'float32',
      offloadMode: 'none',
      autoOffload: false,
      quantizationMode: 'none',
    };
  if (hintedFixture) api = hintedFixture.apiGraph;
  const source = { gitCommit: 'b'.repeat(40), files: [{ path: 'main.py', sha256: 'c'.repeat(64) }] };
  source.fingerprint = sha256Value('backend-source-v1', source);
  const runtime = {
    fingerprint: 'sha256:synthetic-runtime',
    packages: { torch: 'synthetic-test-only' },
    torch: { version: 'synthetic-test-only' },
    work_dir: '/synthetic/work',
    data_dir: '/synthetic/data',
    backendSource: {
      schemaVersion: 1,
      claim: 'process_start_backend_source_identity',
      gitCommit: source.gitCommit,
      fingerprint: source.fingerprint,
      fileCount: 1,
      capturedAt: '2026-10-27T00:00:00.000Z',
    },
  };
  const form = hintedFixture?.executedOutput.formSnapshot ?? {
    modelType: manifest.modelType,
    mode: manifest.mode,
    prompt: 'Synthetic metadata-only protocol test',
    seed: 7,
  };
  const task = {
    ...(hintedFixture ? hintedFixture.executionReceipt : {}),
    task_id: nativeFixture?.receipt.taskId ?? 'synthetic-task',
    status: 'completed',
    attempt_index: 0,
    started_at: 100,
    completed_at: 101,
    runtimeFingerprint: runtime,
    runtimeMeasurement: { elapsedSeconds: 1, processRssBytes: 4096 },
  };
  // A one-pixel PNG fixture, not generated model output.
  const media = write(
    join(evidenceRoot, 'output.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhvcAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const output = {
    id: 'synthetic-output',
    taskId: task.task_id,
    clientRunId: hintedFixture?.executedOutput.clientRunId ?? 'synthetic-run',
    runInputHash: hintedFixture?.executedOutput.runInputHash ?? 'run_synthetic',
    workflowTabId: hintedFixture?.executedOutput.workflowTabId ?? 'synthetic-owned',
    attemptIndex: 0,
    nodeId: nativeFixture?.receipt.nodeId ?? 'preview',
    fieldKey: 'image',
    formSnapshot: form,
    graphSnapshot: hintedFixture?.executedOutput.graphSnapshot ?? graph,
    apiGraphSnapshot: api,
    mediaHash: `sha256:bytes:${media.sha256}`,
    mediaItems: [
      {
        backendPath: '@data/studio/outputs/synthetic.png',
        mediaHash: `sha256:bytes:${media.sha256}`,
        byteSize: media.bytes,
      },
    ],
    resolvedExecutionInputs: nativeFixture?.receipt ?? {
      source: 'backend-execution',
      taskId: task.task_id,
      attemptIndex: 0,
      truncated: false,
      uncapturedNodeIds: [],
      nodes: Object.entries(api.nodes).map(([nodeId, node]) => ({
        nodeId,
        module: node.module,
        action: node.action,
        fields: Object.fromEntries(
          Object.entries(node.params)
            .filter(([, p]) => Object.hasOwn(p, 'value') && !p.sourceId)
            .map(([key, p]) => [
              key,
              { source: 'literal', value: p.value?.source === 'hub' ? p.value.value : p.value },
            ]),
        ),
      })),
    },
  };
  const creator = {
    manifest: { packageType: 'modiff-workflow-share' },
    metadata: { studio: form },
    graph,
    apiGraph: api,
  };
  const outputPackage = { manifest: { packageType: 'modiff-output-package' }, apiGraph: api, latestOutput: output };
  const descriptor = {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-evidence.v1',
    workflowId: manifest.id,
    creatorPackage: write(join(evidenceRoot, 'creator.json'), creator),
    outputPackage: write(join(evidenceRoot, 'output.json'), outputPackage),
    runDetail: write(join(evidenceRoot, 'run.json'), {
      workflow_id: output.workflowTabId,
      task,
      outputs: [output],
      ...(hintedFixture ? { workflow_title: task.workflow_title, workflow_snapshot: task.workflow_snapshot } : {}),
    }),
    ...(hintedFixture
      ? {
          graphCompleted: write(join(evidenceRoot, 'graph-completed.json'), {
            ...hintedFixture.canonicalAccountingProof.graphCompleted,
            runtimeFingerprint: runtime,
            runtimeMeasurement: task.runtimeMeasurement,
          }),
        }
      : {}),
    nodes: write(join(evidenceRoot, 'nodes.json'), {
      nodes: Object.fromEntries(
        Object.values(api.nodes).map((node) => [
          `${node.module}.${node.action}`,
          { module: node.module, action: node.action, params: {} },
        ]),
      ),
    }),
    backendSourceBefore: write(join(evidenceRoot, 'source-before.json'), { identity: source }),
    backendSourceAfter: write(join(evidenceRoot, 'source-after.json'), { identity: source }),
    modelObservations: [
      write(join(evidenceRoot, 'models.json'), {
        error: false,
        models: [
          {
            installed: true,
            repoId: modelRepo,
            selectedRevision: revision,
            modelRevision: `${modelRepo}@${revision}`,
            fingerprint: 'sha256:synthetic-model',
            revisions: [],
          },
        ],
      }),
    ],
    inputs: input ? [{ role: 'input_image', sourceValue: '@data/images/synthetic.png', file: media }] : [],
    outputs: [{ backendPath: output.mediaItems[0].backendPath, mediaType: 'image', file: media }],
  };
  const evidencePath = join(evidenceRoot, 'input.json');
  write(evidencePath, descriptor);
  return { backendRoot, evidenceRoot, evidencePath, descriptor, manifest, write };
}

test('canonical recorder retains original packages and revalidates exact physical evidence through the same projection reader', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-canonical-'));
  try {
    const fixture = await writeStandaloneEvidence(directory);
    const original = readFileSync(join(fixture.evidenceRoot, 'output.json'));
    const result = spawnSync(process.execPath, [SCRIPT, '--workflow', fixture.manifest.id], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        MODIFF_BACKEND_DIR: fixture.backendRoot,
        MODIFF_CANONICAL_WORKFLOW_EVIDENCE: fixture.evidencePath,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const registryPath = join(
      fixture.backendRoot,
      'data/qualification/release/canonical-workflow-run-receipts.v1.json',
    );
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    assert.equal(registry.receipts.length, 1);
    const receipt = registry.receipts[0];
    assert.equal(receipt.workflowId, fixture.manifest.id);
    assert.deepEqual(receipt.qualificationClaims, {
      publicTemplate: false,
      qualityApproved: false,
      rightsApproved: false,
      hardwareQualified: false,
    });
    const retained = join(fixture.backendRoot, receipt.evidencePath);
    assert.deepEqual(readFileSync(join(dirname(retained), 'output.json')), original);
    const repeated = await readCanonicalWorkflowEvidence({
      clientRoot: ROOT,
      backendRoot: fixture.backendRoot,
      workflowId: fixture.manifest.id,
      evidencePath: retained,
    });
    assert.equal(repeated.receipt.outputHash, receipt.outputHash);
    assert.equal(repeated.receipt.authoringHash, receipt.authoringHash);
    assert.deepEqual(repeated.descriptorBytes, readFileSync(fixture.evidencePath));
    assert.equal(
      existsSync(join(fixture.backendRoot, 'data/qualification/release/template-run-receipts.v2.json')),
      false,
    );
    const bytes = readFileSync(join(dirname(retained), 'output.png'));
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(join(dirname(retained), 'output.png'), bytes);
    await assert.rejects(
      readCanonicalWorkflowEvidence({
        clientRoot: ROOT,
        backendRoot: fixture.backendRoot,
        workflowId: fixture.manifest.id,
        evidencePath: retained,
      }),
      /hash differs/,
    );
  } finally {
    disposeFixture(directory);
  }
});

test('actual mocked DDIM accounting records through the shared factory and revalidates from retained originals', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-canonical-ddim-'));
  try {
    const fixture = await writeStandaloneEvidence(directory, { accounting: true });
    const original = readFileSync(join(fixture.evidenceRoot, 'output.json'));
    const result = spawnSync(process.execPath, [SCRIPT, '--workflow', fixture.manifest.id], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        MODIFF_BACKEND_DIR: fixture.backendRoot,
        MODIFF_CANONICAL_WORKFLOW_EVIDENCE: fixture.evidencePath,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const registry = JSON.parse(
      readFileSync(
        join(fixture.backendRoot, 'data/qualification/release/canonical-workflow-run-receipts.v1.json'),
        'utf8',
      ),
    );
    assert.equal(registry.receipts.length, 1);
    const retained = join(fixture.backendRoot, registry.receipts[0].evidencePath);
    assert.deepEqual(readFileSync(join(dirname(retained), 'output.json')), original);
    const resultAgain = await readCanonicalWorkflowEvidence({
      clientRoot: ROOT,
      backendRoot: fixture.backendRoot,
      workflowId: fixture.manifest.id,
      evidencePath: retained,
    });
    assert.equal(resultAgain.provenance.graph.executionPlan.source, 'executed-canonical-accounting-v1');
    assert.equal(resultAgain.provenance.graph.executionPlan.device, 'cuda:0');
    assert.equal(resultAgain.provenance.graph.executionPlan.deviceMap, 'cuda');
    assert.equal(
      resultAgain.provenance.execution.resourceCandidateId,
      'manual-resource-v1:DDIMPipeline|float32|none|none',
    );
    // Registry adds retained-file references to the same receipt identity.
    for (const [key, value] of Object.entries(resultAgain.receipt))
      assert.deepEqual(registry.receipts[0][key], value, key);
    assert.ok(Object.values(resultAgain.receipt.qualificationClaims).every((value) => value === false));
    assert.equal(JSON.parse(original).apiGraph.runtimeHints, undefined);
    const validation = {
      target: resultAgain.receipt,
      expectedApiGraph: mockedDdimAccountingFixture().apiGraph,
      creator: JSON.parse(readFileSync(join(fixture.evidenceRoot, 'creator.json'), 'utf8')),
      outputPackage: JSON.parse(original),
      run: JSON.parse(readFileSync(join(fixture.evidenceRoot, 'run.json'), 'utf8')),
      provenance: resultAgain.provenance,
    };
    assert.deepEqual(validateCanonicalWorkflowEvidence(validation), resultAgain.receipt);
    const wrongOwner = structuredClone(validation);
    wrongOwner.outputPackage.latestOutput.nodeId = wrongOwner.run.outputs[0].nodeId = 'node-04';
    assert.throws(() => validateCanonicalWorkflowEvidence(wrongOwner), /output owner differs/);
    const inventedHints = structuredClone(validation);
    inventedHints.run.task.runtimeHints = { autoResourceCandidateId: 'invented' };
    assert.throws(() => validateCanonicalWorkflowEvidence(inventedHints), /unreviewed runtime hints/);
    const omitted = structuredClone(validation);
    for (const output of [omitted.outputPackage.latestOutput, omitted.run.outputs[0]]) {
      delete output.resolvedExecutionInputs.fieldAccountingStatus;
      for (const row of output.resolvedExecutionInputs.nodes) delete row.fieldAccounting;
    }
    assert.throws(() => validateCanonicalWorkflowEvidence(omitted), /Consumed literal is missing/);
  } finally {
    disposeFixture(directory);
  }
});

test('hinted DDIM descriptor retains and revalidates the hash-bound original completion without adding GET hints', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-ddim-hints-'));
  try {
    const fixture = await writeStandaloneEvidence(directory, { accounting: true, hinted: true });
    const completionPath = join(fixture.evidenceRoot, 'graph-completed.json');
    const runPath = join(fixture.evidenceRoot, 'run.json');
    const originals = [fixture.evidencePath, completionPath, runPath].map((path) => readFileSync(path));
    const readEvidence = () =>
      readCanonicalWorkflowEvidence({
        clientRoot: ROOT,
        backendRoot: fixture.backendRoot,
        workflowId: fixture.manifest.id,
        evidencePath: fixture.evidencePath,
      });
    const result = await readEvidence();
    assert.equal(result.provenance.graph.executionPlan.runtimeHintAccounting.policy, 'canonical-ddim-runtime-hints-v1');
    assert.ok(
      result.retainedFiles.some(
        (ref) => ref.path === 'graph-completed.json' && ref.sha256 === fixture.descriptor.graphCompleted.sha256,
      ),
    );
    assert.ok(Object.values(result.receipt.qualificationClaims).every((value) => value === false));
    assert.equal(JSON.parse(readFileSync(runPath, 'utf8')).task.runtimeHints, undefined);
    [fixture.evidencePath, completionPath, runPath].forEach((path, index) =>
      assert.deepEqual(readFileSync(path), originals[index]),
    );
    const descriptor = structuredClone(fixture.descriptor);
    delete descriptor.graphCompleted;
    fixture.write(fixture.evidencePath, descriptor);
    await assert.rejects(readEvidence, /completion/);
    fixture.write(fixture.evidencePath, fixture.descriptor);
    writeFileSync(completionPath, Buffer.concat([originals[1], Buffer.from(' ')]));
    await assert.rejects(readEvidence, /size|hash/);
    writeFileSync(completionPath, originals[1]);
    const wrongTask = JSON.parse(originals[1]);
    wrongTask.task_id = 'another-task';
    descriptor.graphCompleted = fixture.write(completionPath, wrongTask);
    fixture.write(fixture.evidencePath, descriptor);
    await assert.rejects(readEvidence, /another task/);
  } finally {
    disposeFixture(directory);
  }
});

test('canonical descriptor rejects top-level loop and service authority even when every original API snapshot agrees', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-authority-'));
  try {
    const fixture = await writeStandaloneEvidence(directory, { accounting: true, hinted: true });
    const original = Object.fromEntries(
      ['creator', 'output', 'run'].map((name) => [
        name,
        JSON.parse(readFileSync(join(fixture.evidenceRoot, `${name}.json`), 'utf8')),
      ]),
    );
    const authorities = {
      loops: [
        { id: 'unreviewed-loop', bodyNodeIds: ['node-05'], resultNodeId: 'node-05', iterations: 2, maxRetries: 1 },
      ],
      servicePackage: { package: {}, values: {} },
      futureExecutionAuthority: {},
    };
    for (const [key, authority] of Object.entries(authorities)) {
      const bodies = structuredClone(original);
      for (const graph of [
        bodies.creator.apiGraph,
        bodies.output.apiGraph,
        bodies.output.latestOutput.apiGraphSnapshot,
        bodies.run.outputs[0].apiGraphSnapshot,
      ])
        graph[key] = structuredClone(authority);
      const descriptor = structuredClone(fixture.descriptor);
      descriptor.creatorPackage = fixture.write(join(fixture.evidenceRoot, 'creator.json'), bodies.creator);
      descriptor.outputPackage = fixture.write(join(fixture.evidenceRoot, 'output.json'), bodies.output);
      descriptor.runDetail = fixture.write(join(fixture.evidenceRoot, 'run.json'), bodies.run);
      fixture.write(fixture.evidencePath, descriptor);
      await assert.rejects(
        () =>
          readCanonicalWorkflowEvidence({
            clientRoot: ROOT,
            backendRoot: fixture.backendRoot,
            workflowId: fixture.manifest.id,
            evidencePath: fixture.evidencePath,
          }),
        /Unsupported canonical graph/,
      );
    }
    const creatorOnly = structuredClone(original);
    creatorOnly.creator.apiGraph.loops = authorities.loops;
    const descriptor = structuredClone(fixture.descriptor);
    descriptor.creatorPackage = fixture.write(join(fixture.evidenceRoot, 'creator.json'), creatorOnly.creator);
    descriptor.outputPackage = fixture.write(join(fixture.evidenceRoot, 'output.json'), creatorOnly.output);
    descriptor.runDetail = fixture.write(join(fixture.evidenceRoot, 'run.json'), creatorOnly.run);
    fixture.write(fixture.evidencePath, descriptor);
    await assert.rejects(
      () =>
        readCanonicalWorkflowEvidence({
          clientRoot: ROOT,
          backendRoot: fixture.backendRoot,
          workflowId: fixture.manifest.id,
          evidencePath: fixture.evidencePath,
        }),
      /Unsupported canonical graph/,
    );
  } finally {
    disposeFixture(directory);
  }
});

test('canonical input bytes cannot be authenticated by a path and post-run copy alone', async () => {
  for (const input of [true, 'https://example.invalid/image.png', 'C:/runtime/image.png', 'relative/image.png']) {
    const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-input-hold-'));
    try {
      const fixture = await writeStandaloneEvidence(directory, { input });
      await assert.rejects(
        readCanonicalWorkflowEvidence({
          clientRoot: ROOT,
          backendRoot: fixture.backendRoot,
          workflowId: fixture.manifest.id,
          evidencePath: fixture.evidencePath,
        }),
        /Input-backed canonical qualification is unsupported/,
      );
      assert.equal(existsSync(join(fixture.backendRoot, 'data/qualification/release')), false);
    } finally {
      disposeFixture(directory);
    }
  }
});

test('canonical evidence paths reject traversal, aliases, absolute paths and missing measured bodies before reading', () => {
  const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-paths-'));
  try {
    const file = join(directory, 'safe.json');
    writeFileSync(file, '{}');
    const ref = { path: 'safe.json', bytes: 2, sha256: createHash('sha256').update('{}').digest('hex') };
    assert.equal(readCanonicalEvidenceFile(directory, ref).bytes.toString(), '{}');
    for (const path of ['../outside.json', './safe.json', 'nested/../safe.json', file, 'nested\\safe.json']) {
      assert.throws(() => readCanonicalEvidenceFile(directory, { ...ref, path }), /canonical|relative/);
    }
    assert.throws(() => readCanonicalEvidenceFile(directory, { ...ref, bytes: 3 }), /size\/type/);
    assert.throws(() => readCanonicalEvidenceFile(directory, { ...ref, sha256: '0'.repeat(64) }), /hash differs/);
    mkdirSync(join(directory, 'outside'));
    symlinkSync(join(directory, 'outside'), join(directory, 'linked'), 'junction');
    assert.throws(() => canonicalEvidenceWritePath(directory, 'linked/receipt.json'), /symlinks/);
    assert.equal(
      canonicalEvidenceWritePath(directory, 'new/receipt.json'),
      join(realpathSync(directory), 'new/receipt.json'),
    );
  } finally {
    disposeFixture(directory);
  }
});

test('canonical retention rejects dangling registry links and directory links before writing', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'modiff-template-qualification-dangling-'));
  try {
    const root = join(directory, 'backend');
    const outside = join(directory, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    const cases = [
      {
        name: 'registry leaf',
        link: 'registry.json',
        target: join(outside, 'missing-registry.json'),
        type: 'file',
        suffix: '',
      },
      {
        name: 'directory ancestor',
        link: 'retained',
        target: join(outside, 'missing-directory'),
        type: 'junction',
        suffix: '/evidence.json',
      },
    ];
    for (const row of cases) {
      await t.test(row.name, () => {
        const link = join(root, row.link);
        symlinkSync(row.target, link, row.type);
        assert.equal(existsSync(link), false, 'This reproduction needs a dangling link.');
        assert.equal(lstatSync(link).isSymbolicLink(), true);
        assert.throws(() => canonicalEvidenceWritePath(root, `${row.link}${row.suffix}`), /Retention symlinks/);
        assert.equal(existsSync(row.target), false, 'No target outside the retained root may be created.');
      });
    }
  } finally {
    disposeFixture(directory);
  }
});
