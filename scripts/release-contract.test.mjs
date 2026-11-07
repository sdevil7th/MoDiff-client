import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { canonicalJsonHash } from './canonical-json.mjs';
import {
  assessHistoricalEvidence,
  canonicalWorkflowContract,
  findCanonicalWorkflowRecord,
  canonicalWorkflowAuthoringContract,
  validateCanonicalWorkflowEvidence,
} from './release-contract-core.mjs';
import { canonicalGraphIdentity, createRunProvenance, sha256Value } from './live-proof-provenance.mjs';
import { galleryEvidenceCandidates } from './release-evidence-paths.mjs';

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
