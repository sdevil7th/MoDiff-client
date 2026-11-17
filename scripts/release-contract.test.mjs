import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { canonicalJsonHash } from './canonical-json.mjs';
import { builtinDataQualificationTarget, validateBuiltinDataExecution } from './builtin-data-qualification.mjs';
import {
  assessHistoricalEvidence,
  selectCurrentHistoricalEvidence,
  canonicalWorkflowContract,
  exportCanonicalWorkflowGraphs,
  readCanonicalWorkflowEvidence,
  findCanonicalWorkflowRecord,
  templateResourceExecutionModelType,
  qualificationModelArtifacts,
  assessGalleryReleaseApproval,
  canonicalWorkflowAuthoringContract,
  canonicalWorkflowDeclaredModelRevision,
  validateCanonicalWorkflowEvidence,
} from './release-contract-core.mjs';
import { canonicalGraphIdentity, createRunProvenance, sha256Value } from './live-proof-provenance.mjs';
import { galleryEvidenceCandidates, readReleaseRunProvenance } from './release-evidence-paths.mjs';
import {
  selectCanonicalWorkflowVariantTemplates,
  retainUnselectedCurrentWorkflowRecords,
  canonicalWorkflowVariantTemplateIds,
  parseCanonicalWorkflowGenerationScope,
  selectCanonicalWorkflowCapabilities,
  selectReviewedExperimentalWorkflows,
} from './workflow-library-manifest-state.mjs';

test('qualification model artifacts preserve each immutable member of an aggregate revision lock', () => {
  const model = { repo: 'Example/model', revision: 'a'.repeat(40), role: 'model' };
  const upscaler = { repo: 'Example/upscaler', revision: 'b'.repeat(40), role: 'qualification_model' };
  const lock = `${model.repo}@${model.revision} | ${upscaler.repo}@${upscaler.revision}`;
  const before = JSON.stringify(model);
  assert.deepEqual(qualificationModelArtifacts(lock, [model]), [upscaler]);
  assert.deepEqual(qualificationModelArtifacts(lock), [{ ...model, role: 'qualification_model' }, upscaler]);
  assert.deepEqual(qualificationModelArtifacts(`${model.repo}@${model.revision}`, [model]), []);
  assert.equal(JSON.stringify(model), before);
});

test('canonical source pins close reporting associations without granting run or review evidence', () => {
  const fixture = canonicalEvidenceFixture({ auxiliary: true });
  const before = structuredClone(fixture);
  assert.equal(
    canonicalWorkflowDeclaredModelRevision(fixture.manifest, fixture.graph, fixture.authoring),
    `example/adapter@${'b'.repeat(40)} | example/base@${'a'.repeat(40)}`,
  );
  assert.deepEqual(fixture, before);
  const stale = structuredClone(fixture);
  stale.graph.nodes[0].data.params.revision.value = 'main';
  assert.throws(() => canonicalWorkflowDeclaredModelRevision(stale.manifest, stale.graph, stale.authoring), /hash/);
  stale.manifest.graphHash = canonicalJsonHash(stale.graph);
  stale.authoring.canonicalGraph.sha256 = stale.manifest.graphHash;
  stale.authoring.defaultsPlan.sourceGraphSha256 = stale.manifest.graphHash;
  assert.throws(
    () => canonicalWorkflowDeclaredModelRevision(stale.manifest, stale.graph, stale.authoring),
    /immutable model pin/,
  );
});

test('canonical model file pins bind exact bytes to their declared repository', () => {
  const fixture = () => {
    const f = canonicalEvidenceFixture();
    f.graph.nodes[0].data.params.model_id.value = {
      source: 'hub',
      value: 'example/base/weights/model.safetensors',
      revision: 'a'.repeat(40),
      sha256: 'c'.repeat(64),
      byteSize: 1024,
    };
    return f;
  };
  const resolve = (f) => {
    f.manifest.graphHash = canonicalJsonHash(f.graph);
    f.authoring.canonicalGraph.sha256 = f.manifest.graphHash;
    f.authoring.defaultsPlan.sourceGraphSha256 = f.manifest.graphHash;
    return canonicalWorkflowDeclaredModelRevision(f.manifest, f.graph, f.authoring);
  };
  assert.equal(resolve(fixture()), `example/base@${'a'.repeat(40)}`);
  for (const change of [
    (v) => {
      delete v.sha256;
    },
    (v) => {
      v.byteSize = 0;
    },
    (v) => {
      v.revision = 'main';
    },
    (v) => {
      v.value = 'example/base/../model.safetensors';
    },
    (v) => {
      v.value = 'other/repository/model.safetensors';
    },
  ]) {
    const f = fixture();
    change(f.graph.nodes[0].data.params.model_id.value);
    assert.throws(() => resolve(f));
  }
});

test('qualification model artifacts reject malformed, mutable and conflicting pins without inventing repositories', () => {
  const pin = `Example/model@${'a'.repeat(40)}`;
  assert.deepEqual(qualificationModelArtifacts(), []);
  assert.deepEqual(qualificationModelArtifacts(`${pin} | ${pin}`), [
    { repo: 'Example/model', revision: 'a'.repeat(40), role: 'qualification_model' },
  ]);
  for (const invalid of [
    '',
    'Example/model@main',
    `${pin} | `,
    `../model@${'a'.repeat(40)}`,
    `${pin} | Example/model@${'b'.repeat(40)}`,
    Array(65).fill(pin).join(' | '),
    {},
  ]) {
    assert.throws(() => qualificationModelArtifacts(invalid));
  }
});

test('reviewed experimental recipes retain their tier and require an exact named association', () => {
  const declaration = {
    id: 'reviewed_edit',
    reason: 'Exact reviewed composition',
    experimentalRecipe: { modelType: 'ExamplePipeline', mode: 'edit_image', runtimeProfileId: 'reviewed-provider-v1' },
  };
  const policy = { schemaVersion: 1, format: 'modiff.canonical-template-variants.v1', templates: [declaration] };
  const record = {
    id: 'ExamplePipeline:edit_image:reviewed_edit',
    modelType: 'ExamplePipeline',
    mode: 'edit_image',
    sourceTemplateId: 'reviewed_edit',
    variant: 'template-recipe',
    supportTier: 'experimental',
    graphPath: 'experimental/example/edit.json',
    experimentalRecipe: declaration.experimentalRecipe,
  };
  assert.deepEqual(selectReviewedExperimentalWorkflows([record], policy), [record]);
  assert.equal(record.supportTier, 'experimental');
  assert.deepEqual(
    selectReviewedExperimentalWorkflows(
      [
        {
          ...record,
          experimentalRecipe: {
            runtimeProfileId: 'reviewed-provider-v1',
            mode: 'edit_image',
            modelType: 'ExamplePipeline',
          },
        },
      ],
      policy,
    ).map((row) => row.id),
    [record.id],
  );
  assert.deepEqual(selectReviewedExperimentalWorkflows([record], { ...policy, templates: [] }), []);
  for (const patch of [
    { id: 'ExamplePipeline:edit_image' },
    { modelType: 'OtherPipeline' },
    { mode: 'text_to_image' },
    { supportTier: 'supported' },
    { graphPath: 'studio/example/edit.json' },
    { graphPath: 'experimental/../outside.json' },
    { graphPath: 'experimental/example/../../outside.json' },
    { graphPath: 'experimental/example/%2e%2e.json' },
    { graphPath: 'experimental/example/edit.json/extra' },
    { experimentalRecipe: { ...declaration.experimentalRecipe, runtimeProfileId: 'other-provider' } },
  ])
    assert.throws(() => selectReviewedExperimentalWorkflows([{ ...record, ...patch }], policy), /experimental/i);
  assert.throws(() => selectReviewedExperimentalWorkflows([record, record], policy), /ambiguous/i);
});

test('experimental recipe declarations reject missing, unknown and malformed authority', () => {
  const declaration = { id: 'reviewed_edit', reason: 'Reviewed composition' };
  const policy = { schemaVersion: 1, format: 'modiff.canonical-template-variants.v1', templates: [] };
  for (const experimentalRecipe of [
    null,
    {},
    { modelType: 'ExamplePipeline', mode: 'edit_image' },
    { modelType: 'ExamplePipeline', mode: '../edit', runtimeProfileId: 'provider' },
    { modelType: 'ExamplePipeline', mode: 'edit_image', runtimeProfileId: 'provider', autoEligible: true },
  ])
    assert.throws(
      () => canonicalWorkflowVariantTemplateIds({ ...policy, templates: [{ ...declaration, experimentalRecipe }] }),
      /experimental/i,
    );
});

test('canonical variant generation includes reviewed exact recipes without replacing the default pair', () => {
  const templates = [
    { id: 'default', category: 'generation', modelType: 'Example', mode: 'text_to_image' },
    { id: 'theme', category: 'lora', modelType: 'Example', mode: 'text_to_image' },
    { id: 'finish', category: 'upscale', modelType: 'Example', mode: 'text_to_image' },
    { id: 'sequence', category: 'video_generation', modelType: 'Video', mode: 'text_to_video' },
  ];
  assert.deepEqual(
    selectCanonicalWorkflowVariantTemplates(templates, ['finish', 'sequence']).map((row) => row.id),
    ['theme', 'finish', 'sequence'],
  );
  assert.deepEqual(
    selectCanonicalWorkflowVariantTemplates(templates, ['finish', 'sequence'], { requestedTemplateId: 'finish' }),
    [templates[2]],
  );
  const records = [
    { id: 'Example:text_to_image', sourceTemplateId: 'finish', modelType: 'Example', mode: 'text_to_image' },
    {
      id: 'Example:text_to_image:finish',
      sourceTemplateId: 'finish',
      modelType: 'Example',
      mode: 'text_to_image',
      variant: 'template-recipe',
    },
    {
      id: 'Example:text_to_image:theme',
      sourceTemplateId: 'theme',
      modelType: 'Example',
      mode: 'text_to_image',
      variant: 'lora-theme',
    },
    { id: 'Video:text_to_video', sourceTemplateId: 'default-video', modelType: 'Video', mode: 'text_to_video' },
  ];
  const capabilities = [
    { modelType: 'Example', runnableModes: ['text_to_image'] },
    { modelType: 'Video', runnableModes: ['text_to_video'] },
  ];
  assert.deepEqual(retainUnselectedCurrentWorkflowRecords(records, capabilities, null, 'finish'), [
    records[0],
    records[2],
    records[3],
  ]);
});

test('canonical variant scope rejects unknown, malformed and ambiguous declarations before mutation', () => {
  const policy = {
    schemaVersion: 1,
    format: 'modiff.canonical-template-variants.v1',
    templates: [{ id: 'finish', reason: 'Pinned finishing recipe' }],
  };
  assert.deepEqual(canonicalWorkflowVariantTemplateIds(policy), ['finish']);
  assert.throws(
    () => canonicalWorkflowVariantTemplateIds({ ...policy, templates: [policy.templates[0], policy.templates[0]] }),
    /duplicated/,
  );
  for (const id of ['../finish', 'finish/else', '', 'x'.repeat(129)])
    assert.throws(
      () => canonicalWorkflowVariantTemplateIds({ ...policy, templates: [{ id, reason: 'reviewed' }] }),
      /invalid/,
    );
  const templates = [{ id: 'finish', category: 'upscale', modelType: 'Example', mode: 'text_to_image' }];
  assert.throws(() => selectCanonicalWorkflowVariantTemplates(templates, ['missing']), /missing or ambiguous/);
  assert.throws(() => selectCanonicalWorkflowVariantTemplates([...templates, ...templates], ['finish']), /ambiguous/);
  assert.throws(
    () => selectCanonicalWorkflowVariantTemplates(templates, [], { requestedTemplateId: 'finish' }),
    /no reviewed/,
  );
  assert.deepEqual(parseCanonicalWorkflowGenerationScope(['--template=finish']), {
    requestedPair: null,
    requestedTemplateId: 'finish',
  });
  assert.deepEqual(parseCanonicalWorkflowGenerationScope(['--pair=Example|text_to_image']), {
    requestedPair: 'Example|text_to_image',
    requestedTemplateId: null,
  });
  for (const args of [
    ['--template=../finish'],
    ['--template=finish', '--template=finish'],
    ['--unknown'],
    ['--template=finish', '--pair=Example|text_to_image'],
  ])
    assert.throws(() => parseCanonicalWorkflowGenerationScope(args), /scope/);
});

test('one named canonical recipe does not require unrelated new backend families to have Studio skeletons', () => {
  const selected = { modelType: 'Example', runnableModes: ['text_to_image', 'unmapped_task'] };
  const unrelated = { modelType: 'NewUpstreamFamily', runnableModes: ['unmapped_task'] };
  const templates = [{ id: 'finish', category: 'upscale', modelType: 'Example', mode: 'text_to_image' }];
  const scope = { requestedPair: null, requestedTemplateId: 'finish' };
  assert.deepEqual(selectCanonicalWorkflowCapabilities([selected, unrelated], templates, ['finish'], scope), [
    { ...selected, runnableModes: ['text_to_image'] },
  ]);
  assert.deepEqual(selected.runnableModes, ['text_to_image', 'unmapped_task']);
  assert.throws(
    () => selectCanonicalWorkflowCapabilities([unrelated], templates, ['finish'], scope),
    /not uniquely runnable/,
  );
  assert.throws(
    () => selectCanonicalWorkflowCapabilities([selected, selected], templates, ['finish'], scope),
    /not uniquely runnable/,
  );
});

test('current retained receipts win same-time Gallery projections without overriding newer evidence', () => {
  const direct = {
    candidate: { capturedAt: '2026-11-12T02:00:00.000Z', provenancePath: 'original.json' },
    assessment: { matches: true, status: 'current' },
  };
  const gallery = {
    candidate: { capturedAt: direct.candidate.capturedAt, provenancePath: '/template-gallery/public.json' },
    assessment: { matches: true, status: 'legacy_node_contract_match' },
  };
  const stale = {
    candidate: { capturedAt: '2026-11-14T02:00:00.000Z' },
    assessment: { matches: false, status: 'stale' },
  };
  const input = [direct, gallery, stale];
  assert.equal(selectCurrentHistoricalEvidence(input), direct);
  assert.deepEqual(input, [direct, gallery, stale]);
  const newer = { ...gallery, candidate: { ...gallery.candidate, capturedAt: '2026-11-13T02:00:00.000Z' } };
  assert.equal(selectCurrentHistoricalEvidence([direct, newer]), newer);
  assert.equal(selectCurrentHistoricalEvidence([stale]), undefined);
});

test('release baseline reader binds managed Gallery bundles and direct proofs to the original receipt', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'modiff-release-baseline-'));
  t.after(() => {
    assert.equal(resolve(root, '..'), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  const clientRoot = join(root, 'client');
  const backendRoot = join(root, 'backend');
  const provenance = {
    schemaVersion: 2,
    format: 'modiff.live-proof.provenance.v2',
    template: { id: 'baseline-template' },
    taskId: 'original-task',
    graphHash: 'original-graph',
    modelRevision: `owner/model@${'a'.repeat(40)}`,
    runtimeFingerprint: 'original-runtime',
    mediaHash: 'original-output',
    execution: { resourceCandidateId: 'original-candidate', elapsedSeconds: 12, peakMemoryBytes: 345 },
  };
  const receipt = {
    templateId: provenance.template.id,
    taskId: provenance.taskId,
    graphHash: provenance.graphHash,
    modelRevision: provenance.modelRevision,
    runtimeFingerprint: provenance.runtimeFingerprint,
    outputHash: provenance.mediaHash,
    resourceCandidateId: provenance.execution.resourceCandidateId,
    executionDurationSeconds: provenance.execution.elapsedSeconds,
    peakMemoryBytes: provenance.execution.peakMemoryBytes,
  };
  const bundle = {
    schemaVersion: 1,
    format: 'modiff.gallery.reviewed-provenance.v1',
    templateId: receipt.templateId,
    originalCapture: { _native: true, Alpha: 'retained', alpha: 'retained' },
    run: provenance,
  };
  const publicPath = '/template-gallery/reviews/baseline.json';
  const write = (filename, body) => {
    mkdirSync(resolve(filename, '..'), { recursive: true });
    writeFileSync(filename, JSON.stringify(body) + '\n');
  };
  const publicReceipt = {
    ...receipt,
    provenancePath: publicPath,
    provenanceHash: sha256Value('canonical-json', bundle),
  };
  const backendPublic = join(backendRoot, 'web', publicPath.slice(1));
  write(backendPublic, bundle);
  const load = (row = publicReceipt) => readReleaseRunProvenance({ clientRoot, backendRoot, receipt: row });
  assert.deepEqual(load(), provenance, 'backend-owned Gallery cache is supported');
  const clientPublic = join(clientRoot, 'public', publicPath.slice(1));
  write(clientPublic, bundle);
  assert.deepEqual(load(), provenance, 'client Gallery cache is supported');
  write(clientPublic, { ...bundle, run: { ...provenance, taskId: 'different-task' } });
  assert.throws(() => load(), /hash differs/, 'do not hide a corrupt preferred cache with another copy');
  assert.throws(
    () =>
      load({
        ...publicReceipt,
        provenanceHash: sha256Value('canonical-json', JSON.parse(readFileSync(clientPublic, 'utf8'))),
      }),
    /taskId differs/,
  );
  write(clientPublic, bundle);
  for (const field of Object.keys(receipt)) {
    const changed = { ...publicReceipt, [field]: 'different' };
    assert.throws(() => load(changed), new RegExp(`${field} differs`), field);
  }
  assert.throws(() => load({ ...publicReceipt, provenanceHash: undefined }), /hash differs/);
  const directPath = 'data/qualification/release/proof.json';
  const directFile = join(backendRoot, directPath);
  write(directFile, provenance);
  const directReceipt = {
    ...receipt,
    provenancePath: directPath,
    provenanceHash: `sha256:${createHash('sha256').update(readFileSync(directFile)).digest('hex')}`,
  };
  assert.deepEqual(load(directReceipt), provenance);
  write(directFile, { ...provenance, mediaHash: 'different' });
  assert.throws(() => load(directReceipt), /hash differs/);
  const outside = join(root, 'outside');
  const escaped = join(outside, 'proof.json');
  write(escaped, provenance);
  assert.throws(() => load({ ...directReceipt, provenancePath: escaped }), /escapes its managed root/);
  const link = join(clientRoot, 'public', 'template-gallery', 'linked');
  symlinkSync(outside, link, 'junction');
  assert.throws(
    () => load({ ...directReceipt, provenancePath: '/template-gallery/linked/proof.json' }),
    /symbolic links/,
  );
  const emptyRun = { ...bundle, run: undefined, runs: [provenance] };
  write(clientPublic, emptyRun);
  assert.throws(
    () => load({ ...publicReceipt, provenanceHash: sha256Value('canonical-json', emptyRun) }),
    /unambiguous original v2 run/,
  );
  writeFileSync(clientPublic, Buffer.alloc(16 * 1024 ** 2 + 1, 32));
  assert.throws(() => load(), /bounded JSON file/);
});

function graphHash(graph) {
  return canonicalJsonHash(graph);
}

test('Gallery evidence lookup includes the backend-owned runtime media tree', () => {
  const clientRoot = resolve('workspace-client-fixture');
  const backendRoot = resolve('workspace-backend-fixture');
  assert.deepEqual(galleryEvidenceCandidates(clientRoot, backendRoot, '/template-gallery/reviews/run.json'), [
    join(clientRoot, 'public', 'template-gallery', 'reviews', 'run.json'),
    join(backendRoot, 'web', 'template-gallery', 'reviews', 'run.json'),
  ]);
  assert.throws(
    () => galleryEvidenceCandidates(clientRoot, backendRoot, '../../outside.json'),
    /escapes its managed root/,
  );
});

test('resource requirements retain the selected execution identity separately from the catalog family', () => {
  assert.equal(
    templateResourceExecutionModelType({
      modelType: 'AudioDisplay',
      executionSelection: { pipelineClass: 'ActualAudioPipeline' },
    }),
    'ActualAudioPipeline',
  );
  assert.equal(templateResourceExecutionModelType({ modelType: 'LegacyPipeline' }), 'LegacyPipeline');
  assert.equal(
    templateResourceExecutionModelType({ modelType: 'LegacyPipeline', executionSelection: { pipelineClass: '' } }),
    'LegacyPipeline',
  );
});

test('execution evidence cannot approve a different recipe or publicly withheld Gallery media', () => {
  const entry = {
    qualityReviewStatus: 'approved_reviewed',
    outputPath: '/template-gallery/result.webp',
    thumbnailPath: '/template-gallery/result.card.webp',
  };
  assert.equal(assessGalleryReleaseApproval(entry, { matchesCurrentRecipe: true }).approved, true);
  const historical = assessGalleryReleaseApproval(entry, { matchesCurrentRecipe: false });
  assert.equal(historical.approved, false);
  assert.deepEqual(historical.reasons, ['current_recipe_example']);
  for (const path of [entry.outputPath, entry.thumbnailPath]) {
    const held = assessGalleryReleaseApproval(entry, {
      matchesCurrentRecipe: true,
      unavailableAssets: [path.slice(1)],
    });
    assert.equal(held.approved, false);
    assert.deepEqual(held.reasons, ['unavailable_asset:' + path]);
  }
  assert.equal(
    assessGalleryReleaseApproval({ ...entry, qualityReviewStatus: 'approved_proposed' }, { matchesCurrentRecipe: true })
      .approved,
    false,
  );
  assert.equal(assessGalleryReleaseApproval(undefined, { matchesCurrentRecipe: false }).approved, false);
});

test('canonical workflow identity comes from current graph bytes and historical evidence must match it', () => {
  const graph = {
    nodes: [
      { data: { module: 'modules.DiffusersImage', action: 'LoadPipeline' } },
      { data: { module: 'modules.DiffusersImage', action: 'Generate' } },
    ],
    edges: [],
  };
  const manifest = { id: 'Current:text_to_image', graphHash: graphHash(graph) };
  const current = canonicalWorkflowContract(manifest, graph);
  const registry = new Set(current.backendNodes);
  assert.equal(current.graphHash, `sha256:workflow-graph-v1:${manifest.graphHash}`);
  assert.deepEqual(current.backendNodes, ['modules.DiffusersImage.Generate', 'modules.DiffusersImage.LoadPipeline']);
  assert.equal(
    assessHistoricalEvidence(
      { canonicalWorkflowHash: current.graphHash, backendNodes: current.backendNodes },
      current,
      registry,
    ).matches,
    true,
  );
  const stale = assessHistoricalEvidence(
    {
      canonicalWorkflowHash: 'sha256:workflow-graph-v1:stale',
      backendNodes: ['modules.QwenImage.Generate'],
    },
    current,
    registry,
  );
  assert.equal(stale.matches, false);
  assert.deepEqual(stale.reasons, [
    'canonical_workflow_hash_mismatch',
    'canonical_workflow_node_contract_mismatch',
    'historical_backend_nodes_missing',
  ]);
  assert.throws(
    () => canonicalWorkflowContract({ ...manifest, graphHash: 'stale' }, graph),
    /graph hash does not match its manifest/,
  );
});

test('canonical workflow identity is insensitive to object-key order', () => {
  const graph = {
    nodes: [{ data: { module: 'modules.DiffusersImage', action: 'Generate' }, id: 'generate' }],
    edges: [],
  };
  const reorderedGraph = {
    edges: [],
    nodes: [{ id: 'generate', data: { action: 'Generate', module: 'modules.DiffusersImage' } }],
  };
  const manifest = { id: 'Current:text_to_image', graphHash: graphHash(graph) };
  assert.equal(
    canonicalWorkflowContract(manifest, reorderedGraph).graphHash,
    `sha256:workflow-graph-v1:${manifest.graphHash}`,
  );
});

test('historical evidence keeps changed template and prompt locks visible as stale', () => {
  const graph = {
    nodes: [{ data: { module: 'modules.DiffusersImage', action: 'Generate' } }],
    edges: [],
  };
  const manifest = { id: 'Current:text_to_image', graphHash: graphHash(graph) };
  const current = canonicalWorkflowContract(manifest, graph);
  const assessment = assessHistoricalEvidence(
    {
      backendNodes: current.backendNodes,
      catalogTemplateLockHash: 'tpl_old',
      promptSettingsHash: 'ps_old',
    },
    current,
    new Set(current.backendNodes),
    { catalogTemplateLockHash: 'tpl_current', promptSettingsHash: 'ps_current' },
  );
  assert.equal(assessment.matches, false);
  assert.equal(assessment.status, 'stale');
  assert.deepEqual(assessment.reasons, ['catalog_template_lock_mismatch', 'prompt_settings_hash_mismatch']);
});

test('base workflow lookup cannot be replaced by a later same-mode variant', () => {
  const base = { manifest: { id: 'Model:text_to_image', modelType: 'Model', mode: 'text_to_image' } };
  const variant = {
    manifest: {
      id: 'Model:text_to_image:variant',
      modelType: 'Model',
      mode: 'text_to_image',
      sourceTemplateId: 'variant-template',
    },
  };
  assert.equal(
    findCanonicalWorkflowRecord([base, variant], {
      id: 'base-template',
      modelType: 'Model',
      mode: 'text_to_image',
    }),
    base,
  );
  assert.equal(
    findCanonicalWorkflowRecord([base, variant], {
      id: 'variant-template',
      modelType: 'Model',
      mode: 'text_to_image',
    }),
    variant,
  );
});

test('legacy Qwen evidence cannot restore a deleted backend driver into a current modular contract', () => {
  const staleCases = [
    'high_quality',
    'qwen_low_vram_poster_layout',
    'qwen_low_vram_product_concept',
    'qwen_low_vram_text_rendering',
    'qwen_outpaint_aspect_template',
    'qwen_outpaint_draft',
    'qwen_poster_logo_text',
    'qwen_product_mockup',
    'qwen_text_rendering',
  ];
  const outpaint = new Set(['qwen_outpaint_aspect_template', 'qwen_outpaint_draft']);
  for (const templateId of staleCases) {
    const mode = outpaint.has(templateId) ? 'outpaint' : 'text_to_image';
    const modelType = outpaint.has(templateId) ? 'QwenImageEditModularPipeline' : 'QwenImageModularPipeline';
    const currentBackendNodes = outpaint.has(templateId)
      ? [
          'modules.DiffusersImage.Inpaint',
          'modules.DiffusersImage.LoadPipeline',
          'modules.DiffusersImage.OutpaintCanvas',
          'modules.Image.Load',
          'modules.Image.Preview',
        ]
      : ['modules.DiffusersImage.Generate', 'modules.DiffusersImage.LoadPipeline', 'modules.Image.Preview'];
    const graph = {
      nodes: currentBackendNodes.map((nodeKey, index) => {
        const separator = nodeKey.lastIndexOf('.');
        return {
          id: `node-${index}`,
          data: { module: nodeKey.slice(0, separator), action: nodeKey.slice(separator + 1) },
        };
      }),
      edges: [],
    };
    const manifest = {
      id: `${modelType}:${mode}:${templateId}`,
      modelType,
      mode,
      sourceTemplateId: templateId,
      graphHash: graphHash(graph),
    };
    const workflowRecords = [{ manifest, graph, contract: canonicalWorkflowContract(manifest, graph) }];
    const workflow = findCanonicalWorkflowRecord(workflowRecords, { id: templateId, mode, modelType });
    assert.ok(workflow, `${templateId} must resolve a canonical workflow`);
    assert.equal(
      workflow.contract.backendNodes.some((nodeKey) => nodeKey.startsWith('modules.QwenImage.')),
      false,
    );
    assert.equal(
      workflow.contract.backendNodes.every((nodeKey) => new Set(currentBackendNodes).has(nodeKey)),
      true,
    );
    const legacyBackendNodes = outpaint.has(templateId)
      ? [
          'modules.Image.Load',
          'modules.Image.Preview',
          'modules.QwenImage.Inpaint',
          'modules.QwenImage.LoadInpaintPipeline',
          'modules.QwenImage.OutpaintCanvas',
        ]
      : ['modules.Image.Preview', 'modules.QwenImage.Generate', 'modules.QwenImage.LoadPipeline'];
    const assessment = assessHistoricalEvidence(
      { graphHash: `sha256:canonical-graph-v1:${templateId}`, backendNodes: legacyBackendNodes },
      workflow.contract,
      new Set(currentBackendNodes),
    );
    assert.equal(assessment.matches, false, `${templateId} legacy evidence must be stale`);
    assert.ok(assessment.reasons.includes('canonical_workflow_node_contract_mismatch'));
    assert.ok(assessment.reasons.includes('historical_backend_nodes_missing'));
    assert.ok(assessment.missingBackendNodes.some((nodeKey) => nodeKey.startsWith('modules.QwenImage.')));
  }
});

// Synthetic protocol fixtures exercise metadata validation only. They never
// execute weights or confer qualification on a real catalog row.
function canonicalEvidenceFixture({ auxiliary = false, auto = false } = {}) {
  const revision = 'a'.repeat(40);
  const params = {
    model_id: { value: { source: 'hub', value: 'example/base' } },
    revision: { value: revision },
    dtype: { value: 'bfloat16' },
    offload_mode: { value: 'model_cpu' },
    auto_offload: { value: true },
  };
  const api = {
    nodes: {
      loader: { module: 'modules.DiffusersImage', action: 'LoadPipeline', params },
      generate: {
        module: 'modules.DiffusersImage',
        action: 'Generate',
        params: {
          pipeline: { sourceId: 'loader', sourceKey: 'pipeline' },
          prompt: { value: 'Exact canonical prompt' },
          width: { value: 512 },
          height: { value: 512 },
          steps: { value: 16 },
          seed: { value: 7 },
        },
      },
    },
    paths: [['loader', 'generate']],
    runtimeHints: {
      modelType: 'ExamplePipeline',
      dtype: 'bfloat16',
      offloadMode: 'model_cpu',
      quantizationMode: 'none',
      autoOffload: true,
      ...(auto
        ? { resourceMode: 'auto', resolvedResourceMode: 'auto', autoResourceCandidateId: 'synthetic-auto-candidate' }
        : {}),
    },
  };
  if (auxiliary) {
    api.nodes.adapter = {
      module: 'modules.ModularDiffusers',
      action: 'Lora',
      params: {
        model: { value: { source: 'hub', value: 'example/adapter' } },
        revision: { value: 'b'.repeat(40) },
        scale: { value: 0.75 },
      },
    };
    api.paths = [['adapter', 'loader', 'generate']];
  }
  const graph = {
    nodes: Object.entries(api.nodes).map(([id, node]) => ({ id, data: structuredClone(node) })),
    edges: [],
  };
  const manifest = {
    id: 'ExamplePipeline:text_to_image',
    modelType: 'ExamplePipeline',
    mode: 'text_to_image',
    sourceTemplateId: 'task-template:example:text-to-image:v1',
    graphPath: 'studio/example.json',
    graphHash: canonicalJsonHash(graph),
    requiredArtifacts: ['example/base', ...(auxiliary ? ['example/adapter'] : [])],
  };
  const authoring = {
    id: 'template-authoring:ExamplePipeline:text_to_image',
    canonicalWorkflowId: manifest.id,
    modelType: manifest.modelType,
    mode: manifest.mode,
    canonicalGraph: { path: manifest.graphPath, sha256: manifest.graphHash },
    defaultsPlan: { sourceGraphSha256: manifest.graphHash },
    artifactPlan: { requiredArtifacts: manifest.requiredArtifacts, componentRequirements: [] },
    outputPlan: { minimumAssetCount: 1, mediaKinds: ['image'] },
  };
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring);
  const files = [{ path: 'main.py', sha256: 'c'.repeat(64) }];
  const gitCommit = 'd'.repeat(40);
  const fingerprint = sha256Value('backend-source-v1', { gitCommit, files });
  const backendSource = { fingerprint, gitCommit, files };
  const runtime = {
    fingerprint: 'sha256:actual-runtime',
    packages: { torch: '2.9.1' },
    torch: { version: '2.9.1' },
    work_dir: '/synthetic/work',
    data_dir: '/synthetic/data',
    backendSource: {
      schemaVersion: 1,
      claim: 'process_start_backend_source_identity',
      fingerprint,
      gitCommit,
      fileCount: 1,
      capturedAt: '2026-10-27T00:00:00.000Z',
    },
  };
  const form = { modelType: manifest.modelType, mode: manifest.mode, prompt: 'Exact canonical prompt', seed: 7 };
  const task = {
    task_id: 'synthetic-task',
    status: 'completed',
    attempt_index: 0,
    started_at: 100,
    completed_at: 112.5,
    runtimeFingerprint: runtime,
    runtimeMeasurement: { elapsedSeconds: 12.5, processRssBytes: 4096 },
    resourceCandidateId: auto ? 'synthetic-auto-candidate' : null,
  };
  const output = {
    id: 'synthetic-output',
    taskId: task.task_id,
    clientRunId: 'synthetic-run',
    runInputHash: 'run_synthetic',
    workflowTabId: 'synthetic-owned',
    attemptIndex: 0,
    nodeId: 'generate',
    fieldKey: 'image',
    formSnapshot: form,
    graphSnapshot: graph,
    apiGraphSnapshot: structuredClone(api),
    mediaHash: 'sha256:bytes:synthetic',
    mediaItems: [],
    resolvedExecutionInputs: {
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
            .filter(([, p]) => Object.hasOwn(p, 'value'))
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
    metadata: { studio: structuredClone(form) },
    graph,
    apiGraph: structuredClone(api),
  };
  const outputPackage = {
    manifest: { packageType: 'modiff-output-package' },
    apiGraph: structuredClone(api),
    latestOutput: output,
  };
  const modelIdentities = target.modelSet.map(({ repoId, revision: selectedRevision }) => ({
    repoId,
    selectedRevision,
    modelRevision: `${repoId}@${selectedRevision}`,
    fingerprint: `sha256:model:${repoId}`,
    revisions: [],
  }));
  const provenance = createRunProvenance({
    templateId: target.authoringId,
    lockedSettings: form,
    promptSettingsHash: sha256Value('canonical-workflow-settings-v1', form),
    catalogTemplateLockHash: target.authoringHash,
    resolvedTemplateLockHash: sha256Value('canonical-workflow-execution-v1', {
      authoringHash: target.authoringHash,
      graphHash: canonicalGraphIdentity(api).hash,
    }),
    apiGraph: api,
    nodesPayload: { nodes: {} },
    modelIdentities,
    runtimeFingerprint: runtime,
    backendSource,
    outputAnalysis: {
      analyses: [
        {
          mediaType: 'image',
          width: 512,
          height: 512,
          byteSize: 99,
          encodedSha256: 'sha256:synthetic',
          decodedSha256: 'sha256:decoded:synthetic',
        },
      ],
    },
    executedOutput: output,
    executionReceipt: task,
    taskId: task.task_id,
    capturedAt: new Date(task.completed_at * 1000).toISOString(),
  });
  return {
    target,
    expectedApiGraph: api,
    creator,
    outputPackage,
    run: { workflow_id: output.workflowTabId, task, outputs: [structuredClone(output)] },
    provenance,
    manifest,
    graph,
    authoring,
  };
}

test('standalone canonical receipts bind real authoring, exact execution and full model sets without granting approval', () => {
  for (const auxiliary of [false, true]) {
    const fixture = canonicalEvidenceFixture({ auxiliary });
    const receipt = validateCanonicalWorkflowEvidence(fixture);
    assert.equal(receipt.workflowId, fixture.manifest.id);
    assert.equal(receipt.modelSet.length, auxiliary ? 2 : 1);
    assert.equal(receipt.taskId, 'synthetic-task');
    assert.deepEqual(receipt.qualificationClaims, {
      publicTemplate: false,
      qualityApproved: false,
      rightsApproved: false,
      hardwareQualified: false,
    });
  }
});

async function builtinEvidenceFixture(mode = 'data_conversion') {
  const backend = resolve(process.env.MODIFF_BACKEND_DIR || '../MoDiff');
  const read = (file) => JSON.parse(readFileSync(join(backend, file), 'utf8'));
  const manifest = read('data/workflow-library-manifest.json').workflows.find(
    (row) => row.id === `BuiltinDataOperation:${mode}`,
  );
  const graph = read(`data/graphs/${manifest.graphPath}`);
  const authoring = read('data/template-authoring-specs.v1.json').specifications.find(
    (row) => row.canonicalWorkflowId === manifest.id,
  );
  const target = builtinDataQualificationTarget(manifest, graph, authoring);
  const [expectedApiGraph] = await exportCanonicalWorkflowGraphs(resolve('.'), [target.boundGraph]);
  const task = canonicalEvidenceFixture().run.task;
  task.started_at = Date.parse('2026-10-27T00:00:01.000Z') / 1000;
  task.completed_at = task.started_at + 12.5;
  task.sid = expectedApiGraph.sid;
  task.runtimeMeasurement = {
    backend: 'cpu',
    device: 'cpu:0',
    peakMeasurementVersion: 2,
    elapsedSeconds: 12.5,
    processRssBytes: 4096,
  };
  const sourceInventory = {
    gitCommit: 'd'.repeat(40),
    files: [{ path: 'main.py', sha256: 'c'.repeat(64) }],
    fingerprint: task.runtimeFingerprint.backendSource.fingerprint,
  };
  const expected = {
    data_conversion: {
      project: 'footbridge repair',
      shot_count: 5,
      approved: false,
      tags: ['documentary', 'community'],
    },
    graph_utility: 'Primary branch: the repaired footbridge is ready for the morning crossing.',
    text_select: 'Wide establishing shot at dawn',
  }[mode];
  const text = typeof expected === 'string' ? expected : JSON.stringify(expected, null, 2);
  const exportText = JSON.stringify(expected, null, 2);
  const messages = Object.entries(expectedApiGraph.nodes).map(([node, value]) => ({
    type: 'executed',
    task_id: task.task_id,
    attempt_index: 0,
    node,
    name: `${value.module}.${value.action}`,
    status: 'succeeded',
  }));
  const outputs = [],
    durableOutputs = [];
  for (const node of [target.roles.DataViewer, target.roles.ExportData]) {
    const value = [node === target.roles.ExportData ? exportText : text];
    const bytes = Buffer.from(JSON.stringify(value));
    const backendPath = `@data/synthetic-${node}.txt`;
    const consumed = {
      source: 'backend-execution',
      taskId: task.task_id,
      attemptIndex: 0,
      nodeId: node,
      truncated: false,
      uncapturedNodeIds: [],
      nodes: [
        target.roles.ProcessText,
        target.roles.DataViewer,
        ...(node === target.roles.ExportData ? [target.roles.ExportData] : []),
      ].map((nodeId) => ({
        nodeId,
        module: expectedApiGraph.nodes[nodeId].module,
        action: expectedApiGraph.nodes[nodeId].action,
        fields:
          nodeId === target.roles.ProcessText
            ? { pipeline_class: { value: 'BuiltinDataOperationV1', source: 'literal' } }
            : {},
        omittedFields: {},
      })),
    };
    outputs.push({
      id: node,
      taskId: task.task_id,
      attemptIndex: 0,
      nodeId: node,
      value,
      resolvedExecutionInputs: consumed,
      mediaItems: [
        {
          backendPath,
          taskId: task.task_id,
          attemptIndex: 0,
          byteSize: bytes.length,
          mediaHash: `sha256:bytes:${createHash('sha256').update(bytes).digest('hex')}`,
        },
      ],
    });
    messages.push({
      type: 'update_value',
      task_id: task.task_id,
      attempt_index: 0,
      node,
      key: 'preview',
      backend_persisted: true,
      value,
      output_id: node,
      runtimeFingerprint: task.runtimeFingerprint.fingerprint,
      resolved_execution_inputs: consumed,
    });
    durableOutputs.push({ nodeId: node, backendPath, bytes });
  }
  messages.push({
    type: 'graph_completed',
    task_id: task.task_id,
    runtimeFingerprint: task.runtimeFingerprint,
    runtimeMeasurement: task.runtimeMeasurement,
    runtimeHints: null,
    resourceRetryHistory: [],
  });
  return {
    target,
    expectedApiGraph,
    submittedApiGraph: structuredClone(expectedApiGraph),
    acceptedGraph: { taskId: task.task_id, graph: structuredClone(expectedApiGraph) },
    run: { task, outputs },
    messages,
    sourceBefore: { identity: structuredClone(task.runtimeFingerprint.backendSource) },
    sourceAfter: { identity: { ...task.runtimeFingerprint.backendSource, capturedAt: '2026-10-27T00:00:20.000Z' } },
    sourceInventory,
    exportedBytes: Buffer.from(exportText + '\n'),
    durableOutputs,
    manifest,
    graph,
    authoring,
  };
}

test('model-free canonical data proofs bind all three exact deterministic results without model or publication claims', async () => {
  for (const mode of ['data_conversion', 'graph_utility', 'text_select']) {
    const f = await builtinEvidenceFixture(mode);
    const original = JSON.stringify(f.graph);
    assert.throws(
      () => canonicalWorkflowAuthoringContract(f.manifest, f.graph, f.authoring),
      /builtin qualification is unsupported/,
    );
    const receipt = validateBuiltinDataExecution(f);
    assert.equal(receipt.proofKind, 'real_backend_deterministic_data');
    assert.equal(receipt.deterministicCorrectness, 'verified_exact_result');
    assert.deepEqual(receipt.modelSet, []);
    assert.equal(receipt.resourceCandidateId, null);
    assert.ok(Object.values(receipt.qualificationClaims).every((value) => value === false));
    assert.equal(receipt.observationLimits.fullConsumedFieldAccounting, false);
    assert.equal(JSON.stringify(f.graph), original, 'Canonical source/defaults must not be edited');
  }
});

test('deterministic data proofs reject graph, authority, task, output and source substitutions', async (t) => {
  const original = await builtinEvidenceFixture();
  const cases = [
    [
      'changed selector',
      (f) => {
        f.submittedApiGraph.nodes[f.target.roles.ProcessText].params.index.value = 1;
      },
    ],
    [
      'runtime authority',
      (f) => {
        f.submittedApiGraph.runtimeHints = { resourceMode: 'auto' };
      },
    ],
    [
      'service authority',
      (f) => {
        f.acceptedGraph.graph.servicePackage = {};
      },
    ],
    [
      'failed task',
      (f) => {
        f.run.task.status = 'failed';
      },
    ],
    [
      'fallback',
      (f) => {
        f.run.task.attempt_index = 1;
      },
    ],
    [
      'unrelated accepted graph',
      (f) => {
        f.acceptedGraph.taskId = 'other';
      },
    ],
    [
      'cached execution',
      (f) => {
        f.messages.find((row) => row.type === 'executed').status = 'cached';
      },
    ],
    [
      'missing execution',
      (f) => {
        f.messages.splice(0, 1);
      },
    ],
    [
      'unrelated preview',
      (f) => {
        f.messages.find((row) => row.type === 'update_value').task_id = 'other';
      },
    ],
    [
      'unpersisted preview',
      (f) => {
        f.messages.find((row) => row.type === 'update_value').backend_persisted = false;
      },
    ],
    [
      'wrong export',
      (f) => {
        f.exportedBytes = Buffer.from('{}\n');
      },
    ],
    [
      'corrupt durable file',
      (f) => {
        f.durableOutputs[0].bytes = Buffer.from('[]');
      },
    ],
    [
      'missing durable file',
      (f) => {
        f.durableOutputs.pop();
      },
    ],
    [
      'different source',
      (f) => {
        f.sourceInventory.files[0].sha256 = 'a'.repeat(64);
      },
    ],
    [
      'changed before source',
      (f) => {
        f.sourceBefore.identity.fingerprint = 'sha256:changed';
      },
    ],
    [
      'missing native measurement',
      (f) => {
        delete f.run.task.runtimeMeasurement.processRssBytes;
      },
    ],
    [
      'uncaptured owner',
      (f) => {
        f.messages.find((row) => row.type === 'update_value').resolved_execution_inputs.uncapturedNodeIds = ['absent'];
      },
    ],
  ];
  for (const [name, change] of cases)
    await t.test(name, () => {
      const f = structuredClone(original);
      f.exportedBytes = Buffer.from(f.exportedBytes);
      f.durableOutputs.forEach((row) => {
        row.bytes = Buffer.from(row.bytes);
      });
      change(f);
      assert.throws(() => validateBuiltinDataExecution(f));
    });
});

test('builtin data admission rejects model/file-backed variants and stale authoring before execution', async () => {
  const original = await builtinEvidenceFixture();
  for (const change of [
    (f) => {
      f.manifest.modelType = 'BuiltinImageOperation';
    },
    (f) => {
      f.manifest.requiredArtifacts.push('example/model');
    },
    (f) => {
      f.authoring.inputPlan.items.push({ path: '@data/input.json' });
    },
    (f) => {
      f.authoring.canonicalGraph.sha256 = 'stale';
    },
    (f) => {
      f.authoring.promptPlan.prompt = '';
    },
  ]) {
    const f = structuredClone(original);
    change(f);
    assert.throws(() => builtinDataQualificationTarget(f.manifest, f.graph, f.authoring));
  }
});

test('the normal canonical recorder retains deterministic originals and rejects file or descriptor substitution', async () => {
  const f = await builtinEvidenceFixture();
  const root = mkdtempSync(join(tmpdir(), 'modiff-builtin-canonical-'));
  try {
    const backendRoot = join(root, 'backend');
    const evidenceRoot = join(root, 'originals');
    mkdirSync(join(backendRoot, 'data/graphs/studio/builtin-data-operation'), { recursive: true });
    mkdirSync(evidenceRoot);
    const write = (path, value) => writeFileSync(path, JSON.stringify(value));
    write(join(backendRoot, 'data/workflow-library-manifest.json'), { workflows: [f.manifest] });
    write(join(backendRoot, 'data/template-authoring-specs.v1.json'), { specifications: [f.authoring] });
    write(join(backendRoot, 'data/graphs', f.manifest.graphPath), f.graph);
    const retain = (path, value, raw = false) => {
      const bytes = raw ? value : Buffer.from(JSON.stringify(value));
      writeFileSync(join(evidenceRoot, path), bytes);
      return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    };
    const evidence = {
      schemaVersion: 1,
      format: 'modiff.canonical-builtin-data-evidence.v1',
      workflowId: f.manifest.id,
      submittedApiGraph: retain('submitted.json', f.submittedApiGraph),
      acceptedGraph: retain('accepted.json', f.acceptedGraph),
      runDetail: retain('run.json', f.run),
      messages: retain('messages.json', f.messages),
      sourceBefore: retain('before.json', f.sourceBefore),
      sourceAfter: retain('after.json', f.sourceAfter),
      sourceInventory: retain('source.json', f.sourceInventory),
      exportedData: retain('data.json', f.exportedBytes, true),
      durableOutputs: f.durableOutputs.map((row, i) => ({
        nodeId: row.nodeId,
        backendPath: row.backendPath,
        file: retain(`output-${i}.txt`, row.bytes, true),
      })),
    };
    const evidencePath = join(evidenceRoot, 'evidence.json');
    write(evidencePath, evidence);
    const args = { clientRoot: resolve('.'), backendRoot, workflowId: f.manifest.id, evidencePath };
    const readback = await readCanonicalWorkflowEvidence(args);
    assert.equal(readback.receipt.proofKind, 'real_backend_deterministic_data');
    const recorded = spawnSync(process.execPath, ['scripts/template-qualification.mjs', '--workflow', f.manifest.id], {
      cwd: resolve('.'),
      env: { ...process.env, MODIFF_BACKEND_DIR: backendRoot, MODIFF_CANONICAL_WORKFLOW_EVIDENCE: evidencePath },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(recorded.status, 0, recorded.stderr);
    const registry = JSON.parse(
      readFileSync(join(backendRoot, 'data/qualification/release/canonical-workflow-run-receipts.v1.json')),
    );
    assert.equal(registry.receipts.length, 1);
    const receipt = registry.receipts[0];
    const retained = await readCanonicalWorkflowEvidence({
      ...args,
      evidencePath: join(backendRoot, receipt.evidencePath),
    });
    assert.deepEqual(retained.receipt, readback.receipt);
    writeFileSync(join(evidenceRoot, 'data.json'), '{}');
    await assert.rejects(() => readCanonicalWorkflowEvidence(args), /size|hash|bytes/i);
    writeFileSync(join(evidenceRoot, 'data.json'), f.exportedBytes);
    write(evidencePath, { ...evidence, modelObservations: [] });
    await assert.rejects(() => readCanonicalWorkflowEvidence(args), /Unreviewed deterministic evidence fields/);
    write(evidencePath, { ...evidence, exportedData: { ...evidence.exportedData, path: '../outside.json' } });
    await assert.rejects(() => readCanonicalWorkflowEvidence(args));
  } finally {
    assert.equal(resolve(root, '..'), resolve(tmpdir()));
    assert.ok(root.includes('modiff-builtin-canonical-'));
    rmSync(root, { recursive: true, force: true });
  }
});

test('canonical Auto receipts join the actual task candidate and reject contradictory Expert candidates', async (t) => {
  const accepted = canonicalEvidenceFixture({ auto: true });
  assert.equal(validateCanonicalWorkflowEvidence(accepted).resourceCandidateId, 'synthetic-auto-candidate');
  assert.equal(Object.hasOwn(accepted.run.task, 'runtimeHints'), false, 'Native task schema has no runtimeHints.');
  for (const [label, candidate] of [
    ['missing', undefined],
    ['null', null],
    ['different', 'another-native-candidate'],
    ['empty', ''],
  ]) {
    await t.test(`Auto ${label} native candidate refuses`, () => {
      const fixture = canonicalEvidenceFixture({ auto: true });
      if (candidate === undefined) delete fixture.run.task.resourceCandidateId;
      else fixture.run.task.resourceCandidateId = candidate;
      assert.throws(() => validateCanonicalWorkflowEvidence(fixture), /Native Auto resource candidate/);
    });
  }
  await t.test('Auto without a declared candidate refuses', () => {
    const fixture = canonicalEvidenceFixture({ auto: true });
    delete fixture.outputPackage.latestOutput.apiGraphSnapshot.runtimeHints.autoResourceCandidateId;
    delete fixture.outputPackage.apiGraph.runtimeHints.autoResourceCandidateId;
    fixture.run.outputs[0] = structuredClone(fixture.outputPackage.latestOutput);
    assert.throws(() => validateCanonicalWorkflowEvidence(fixture), /Auto resource candidate is missing/);
  });
  for (const candidate of ['unexpected-native-candidate', '']) {
    await t.test(`Expert nonnull native candidate ${JSON.stringify(candidate)} refuses`, () => {
      const fixture = canonicalEvidenceFixture();
      fixture.run.task.resourceCandidateId = candidate;
      assert.throws(
        () => validateCanonicalWorkflowEvidence(fixture),
        /Non-Auto task retains an Auto resource candidate/,
      );
    });
  }
  await t.test('Expert missing native candidate keeps measured graph-derived identity', () => {
    const fixture = canonicalEvidenceFixture();
    delete fixture.run.task.resourceCandidateId;
    assert.match(validateCanonicalWorkflowEvidence(fixture).resourceCandidateId, /^manual-resource-v1:/);
  });
});

test('standalone canonical source resolution rejects stale, ambiguous, builtin and unresolved declarations', () => {
  const f = canonicalEvidenceFixture();
  const cases = [
    [
      'stale graph',
      (v) => {
        v.manifest.graphHash = '0'.repeat(64);
      },
      /graph hash/,
    ],
    [
      'wrong authoring',
      (v) => {
        v.authoring.canonicalWorkflowId = 'other';
      },
      /authoring record/,
    ],
    [
      'stale defaults',
      (v) => {
        v.authoring.defaultsPlan.sourceGraphSha256 = 'stale';
      },
      /defaults are stale/,
    ],
    [
      'builtin',
      (v) => {
        v.manifest.requiredArtifacts = ['builtin://modiff/image-operations/v1'];
      },
      /builtin qualification is unsupported/,
    ],
    [
      'missing artifact',
      (v) => {
        v.authoring.artifactPlan.requiredArtifacts = [];
      },
      /artifact set differs/,
    ],
    [
      'mutable pin',
      (v) => {
        v.graph.nodes[0].data.params.revision.value = 'main';
        v.manifest.graphHash = canonicalJsonHash(v.graph);
        v.authoring.canonicalGraph.sha256 = v.manifest.graphHash;
        v.authoring.defaultsPlan.sourceGraphSha256 = v.manifest.graphHash;
      },
      /immutable model pin/,
    ],
    [
      'implicit component',
      (v) => {
        v.manifest.requiredArtifacts.push('example/hidden');
        v.authoring.artifactPlan.requiredArtifacts.push('example/hidden');
      },
      /Missing or ambiguous immutable model pin/,
    ],
  ];
  for (const [name, change, message] of cases) {
    const value = structuredClone(f);
    change(value);
    assert.throws(
      () => canonicalWorkflowAuthoringContract(value.manifest, value.graph, value.authoring),
      message,
      name,
    );
  }
});

test('standalone canonical validation rejects unrelated, incomplete or drifted native evidence', () => {
  const cases = [
    [
      'task',
      (f) => {
        f.run.task.task_id = 'other';
      },
      /another task/,
    ],
    [
      'failed',
      (f) => {
        f.run.task.status = 'failed';
      },
      /not completed/,
    ],
    [
      'fallback',
      (f) => {
        f.run.task.attempt_index = 1;
      },
      /Retry\/fallback/,
    ],
    [
      'owner',
      (f) => {
        f.run.workflow_id = 'other';
      },
      /another workflow/,
    ],
    [
      'raw output',
      (f) => {
        f.run.outputs = [];
      },
      /uniquely present/,
    ],
    [
      'input correlation',
      (f) => {
        f.run.outputs[0].runInputHash = 'other';
      },
      /runInputHash differs/,
    ],
    [
      'form',
      (f) => {
        f.creator.metadata.studio.prompt = 'other';
      },
      /settings changed/,
    ],
    [
      'default',
      (f) => {
        f.creator.apiGraph.nodes.generate.params.steps.value = 15;
      },
      /defaults\/bindings differ/,
    ],
    [
      'wire',
      (f) => {
        f.creator.apiGraph.nodes.generate.params.pipeline.sourceKey = 'other';
      },
      /defaults\/bindings differ/,
    ],
    [
      'consumed field',
      (f) => {
        f.outputPackage.latestOutput.resolvedExecutionInputs.nodes[1].fields.width.value = 256;
        f.run.outputs[0] = structuredClone(f.outputPackage.latestOutput);
      },
      /Consumed field differs/,
    ],
    [
      'consumed override',
      (f) => {
        f.outputPackage.latestOutput.resolvedExecutionInputs.nodes[1].fields.width = { source: 'override', value: 256 };
        f.run.outputs[0] = structuredClone(f.outputPackage.latestOutput);
      },
      /overridden consumed scalar/,
    ],
    [
      'consumed missing',
      (f) => {
        delete f.outputPackage.latestOutput.resolvedExecutionInputs.nodes[0].fields.model_id;
        f.run.outputs[0] = structuredClone(f.outputPackage.latestOutput);
      },
      /Consumed literal is missing/,
    ],
    [
      'consumed omission',
      (f) => {
        f.outputPackage.latestOutput.resolvedExecutionInputs.nodes[0].omittedFields = { revision: 'oversize-string' };
        f.run.outputs[0] = structuredClone(f.outputPackage.latestOutput);
      },
      /Consumed fields were omitted/,
    ],
    [
      'consumed connected origin',
      (f) => {
        f.outputPackage.latestOutput.resolvedExecutionInputs.nodes[0].fields.revision = {
          source: 'connected',
          sourceNodeId: 'other',
          sourcePortId: 'text',
          value: 'a'.repeat(40),
        };
        f.run.outputs[0] = structuredClone(f.outputPackage.latestOutput);
      },
      /Connected or overridden/,
    ],
    [
      'uncaptured',
      (f) => {
        f.outputPackage.latestOutput.resolvedExecutionInputs.uncapturedNodeIds = ['loader'];
        f.run.outputs[0] = structuredClone(f.outputPackage.latestOutput);
      },
      /incomplete/,
    ],
    [
      'missing model',
      (f) => {
        f.target.modelSet.push({ repoId: 'example/missing', revision: 'e'.repeat(40) });
      },
      /Complete executed model set/,
    ],
    [
      'source',
      (f) => {
        f.run.task.runtimeFingerprint.backendSource.gitCommit = 'f'.repeat(40);
      },
      /source authority differs/,
    ],
    [
      'runtime',
      (f) => {
        f.run.task.runtimeFingerprint = 'sha256:compact';
      },
      /Complete structured/,
    ],
    [
      'resource recipe consumed identity',
      (f) => {
        f.outputPackage.latestOutput.apiGraphSnapshot.runtimeHints.offloadMode = 'none';
        f.outputPackage.apiGraph.runtimeHints.offloadMode = 'none';
        f.run.outputs[0] = structuredClone(f.outputPackage.latestOutput);
      },
      /matching consumed offload_mode/,
    ],
    [
      'memory',
      (f) => {
        f.run.task.runtimeMeasurement.processRssBytes = 0;
      },
      /resource measurements differ/,
    ],
    [
      'time',
      (f) => {
        f.run.task.completed_at += 1;
      },
      /Completion time differs/,
    ],
    [
      'blocker',
      (f) => {
        f.provenance.blockers.push('unqualified');
      },
      /retains blockers/,
    ],
  ];
  for (const [name, change, expected] of cases) {
    const fixture = canonicalEvidenceFixture();
    change(fixture);
    assert.throws(() => validateCanonicalWorkflowEvidence(fixture), expected, name);
  }
});
