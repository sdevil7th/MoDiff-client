// Protocol fixtures only: allocation, inference, runtime and media are mocked.
// Nothing produced here is native execution, hardware or release evidence.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { sha256Value } from './live-proof-provenance.mjs';
import { canonicalJsonHash } from './canonical-json.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
let ddim;
let applied;
export function actualAppliedAdapterFixtures() {
  if (applied) return structuredClone(applied);
  const backend = fileURLToPath(new URL('../../MoDiff/', import.meta.url));
  const python =
    process.env.MODIFF_BACKEND_PYTHON ||
    `${backend}.venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`;
  const result = spawnSync(
    python,
    [
      '-B',
      '-c',
      String.raw`
import contextlib, io, json, sys
sys.path.insert(0, 'tests')
with contextlib.redirect_stdout(io.StringIO()):
    from test_applied_adapter_provenance import actual_applied_adapter_fixture
    values = {case: actual_applied_adapter_fixture(case) for case in ('activated', 'reused', 'empty', 'unavailable')}
print(json.dumps(values))
`,
    ],
    { cwd: backend, encoding: 'utf8', maxBuffer: 2_000_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  applied = JSON.parse(result.stdout);
  return structuredClone(applied);
}
export function mockedDdimAccountingFixture() {
  if (ddim) return structuredClone(ddim);
  const backend = fileURLToPath(new URL('../../MoDiff/', import.meta.url));
  const python =
    process.env.MODIFF_BACKEND_PYTHON ||
    `${backend}.venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`;
  const result = spawnSync(
    python,
    [
      '-B',
      '-c',
      String.raw`
import importlib.util, json
from pathlib import Path
from pytest import MonkeyPatch
spec = importlib.util.spec_from_file_location('ddim_protocol', Path('tests/test_canonical_field_accounting.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with MonkeyPatch.context() as patch:
    api = module.ddim_graph()
    receipt, _, _, _ = module.run_ddim(patch, api)
graph = json.loads(Path('data/graphs/studio/ddim-pipeline/unconditional-image.json').read_text())
print(json.dumps({'apiGraph': api, 'receipt': receipt, 'graph': graph}))
`,
    ],
    { cwd: backend, encoding: 'utf8', maxBuffer: 2_000_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  ddim = JSON.parse(result.stdout);
  return structuredClone(ddim);
}

export function protocolFactoryArguments(apiGraph, nodesPayload = {}) {
  const pins = new Map();
  for (const node of Object.values(apiGraph.nodes)) {
    for (const [key, parameter] of Object.entries(node.params)) {
      if (parameter.value?.source === 'hub' && ['repo_id', 'model_id', 'model'].includes(key))
        pins.set(parameter.value.value, node.params.revision.value);
    }
  }
  const source = { gitCommit: 'b'.repeat(40), files: [{ path: 'main.py', sha256: 'c'.repeat(64) }] };
  source.fingerprint = sha256Value('backend-source-v1', source);
  const runtime = {
    fingerprint: 'sha256:synthetic-protocol-runtime',
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
  return {
    templateId: 'protocol-only',
    lockedSettings: { seed: 42 },
    promptSettingsHash: 'protocol-settings',
    catalogTemplateLockHash: 'protocol-catalog',
    resolvedTemplateLockHash: 'protocol-resolved',
    apiGraph,
    nodesPayload,
    modelIdentities: [...pins].map(([repoId, selectedRevision]) => ({
      repoId,
      selectedRevision,
      modelRevision: `${repoId}@${selectedRevision}`,
      fingerprint: 'sha256:synthetic-protocol-model',
      revisions: [],
    })),
    runtimeFingerprint: runtime,
    backendSource: source,
    outputAnalysis: {
      analyses: [
        {
          width: 32,
          height: 32,
          mediaType: 'image',
          byteSize: 100,
          encodedSha256: 'sha256:synthetic-encoded',
          decodedSha256: 'sha256:synthetic-decoded',
        },
      ],
    },
    executedOutput: { mediaHash: 'sha256:bytes:synthetic', mediaItems: [{ mediaHash: 'sha256:bytes:synthetic' }] },
    executionReceipt: { runtimeMeasurement: { elapsedSeconds: 1, processRssBytes: 4096 } },
    taskId: 'protocol-only',
    capturedAt: '1970-01-01T00:01:41.000Z',
  };
}

export function canonicalHookCase() {
  const { apiGraph, receipt } = mockedDdimAccountingFixture();
  const args = protocolFactoryArguments(apiGraph);
  const loader = Object.values(apiGraph.nodes).find((node) => node.action === 'LoadPipeline');
  const target = {
    modelType: 'DDIMPipeline',
    task: 'unconditional_image',
    modelSet: [{ repoId: loader.params.model_id.value.value, revision: loader.params.revision.value }],
  };
  const task = {
    task_id: receipt.taskId,
    status: 'completed',
    attempt_index: 0,
    started_at: 100,
    completed_at: 101,
    runtimeFingerprint: args.runtimeFingerprint,
    runtimeMeasurement: args.executionReceipt.runtimeMeasurement,
    resourceCandidateId: null,
  };
  const output = {
    ...args.executedOutput,
    id: 'protocol-output',
    taskId: task.task_id,
    attemptIndex: 0,
    nodeId: receipt.nodeId,
    fieldKey: 'preview',
    workflowTabId: 'protocol-workflow',
    clientRunId: 'protocol-run',
    runInputHash: 'protocol-input',
    apiGraphSnapshot: apiGraph,
    resolvedExecutionInputs: receipt,
  };
  return {
    ...args,
    taskId: task.task_id,
    executedOutput: output,
    executionReceipt: task,
    canonicalAccountingProof: {
      expectedApiGraph: structuredClone(apiGraph),
      target,
      run: { task, workflow_id: output.workflowTabId, outputs: [output] },
    },
  };
}

// Exercise the real serialized FE producers. The task, completion, runtime,
// allocation and media below remain synthetic protocol fixtures, not live proof.
export async function hintedCanonicalHookCase({ managed = true, memory = true, targetNode = false } = {}) {
  const value = canonicalHookCase();
  const { graph } = mockedDdimAccountingFixture();
  const previousWindow = globalThis.window;
  globalThis.window ??= { location: { origin: 'http://localhost' } };
  const server = await createServer({
    configFile: false,
    root: ROOT,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  try {
    const [{ useStudioStore }, { useNodesStore }, preparation, profiles, inference] = await Promise.all([
      server.ssrLoadModule('/src/stores/useStudioStore.ts'),
      server.ssrLoadModule('/src/stores/useNodeStore.ts'),
      server.ssrLoadModule('/src/studio/runPreparation.ts'),
      server.ssrLoadModule('/src/studio/modelProfiles.ts'),
      server.ssrLoadModule('/src/studio/workflowInference.ts'),
    ]);
    const fallbackForm = {
      ...profiles.DEFAULT_STUDIO_FORM,
      modelType: 'DDIMPipeline',
      mode: 'unconditional_image',
      resourceMode: 'expert',
      device: 'cuda:0',
      dtype: 'float32',
      quantizationMode: 'none',
      offloadMode: 'none',
      autoOffload: false,
      randomSeed: false,
      width: 32,
      height: 32,
      steps: 50,
      guidanceScale: 0,
    };
    const output = value.executedOutput;
    const snapshot = inference.workflowSnapshotFromGraph(graph, 'default', fallbackForm);
    // Ordinary imports initially select Auto. This bounded protocol case models
    // the explicit Custom/Expert choice without changing any authored node,
    // wire, model pin, sampling control or resident execution recipe.
    const form = { ...snapshot.studioForm, resourceMode: 'expert' };
    snapshot.studioForm = form;
    assert.ok(snapshot.studioGraphBinding, 'The ordinary canonical import is managed by the real adoption path.');
    useStudioStore.setState({
      form,
      graphBinding: snapshot.studioGraphBinding,
      activeTemplateId: null,
      autoResourcePlan: null,
      autoFieldOverrides: {},
      activeWorkflowTabId: output.workflowTabId,
      workflowCanvasEpoch: 7,
      workflowTabs: [{ id: output.workflowTabId, title: 'Protocol DDIM', snapshot }],
    });
    useNodesStore.setState({
      studioModelCapabilities: [],
      runtimeStatus: memory
        ? {
            packages: {
              torch: {
                cuda_available: true,
                cuda_devices: [{ index: 0, memory_total_bytes: 16 * 1024 ** 3, memory_free_bytes: 12 * 1024 ** 3 }],
              },
            },
          }
        : null,
    });
    const identity = {
      clientRunId: output.clientRunId,
      runInputHash: preparation.getStudioRunInputHash(form, value.apiGraph),
    };
    value.apiGraph = JSON.parse(
      JSON.stringify(
        preparation.applyRunCorrelationHints(
          managed ? preparation.applyStudioRuntimeHints(value.apiGraph, identity) : value.apiGraph,
          identity,
          { formSnapshot: form, ...(targetNode ? { targetNodeId: output.nodeId } : {}) },
        ),
      ),
    );
    output.apiGraphSnapshot = value.apiGraph;
    output.runInputHash = identity.runInputHash;
    output.formSnapshot = form;
    output.graphSnapshot = { nodes: snapshot.nodes, edges: snapshot.edges, viewport: snapshot.viewport };
    output.sid = value.apiGraph.sid;
    const task = value.executionReceipt;
    Object.assign(task, {
      sid: output.sid,
      client_run_id: identity.clientRunId,
      run_input_hash: identity.runInputHash,
      workflow_tab_id: output.workflowTabId,
      workflow_canvas_epoch: 7,
      workflow_title: 'Protocol DDIM',
      workflow_snapshot: snapshot,
      ...(targetNode ? { node_id: output.nodeId } : {}),
    });
    const run = value.canonicalAccountingProof.run;
    Object.assign(run, { workflow_title: task.workflow_title, workflow_snapshot: snapshot });
    value.canonicalAccountingProof.graphCompleted = {
      type: 'graph_completed',
      sid: task.sid,
      task_id: task.task_id,
      client_run_id: task.client_run_id,
      run_input_hash: task.run_input_hash,
      workflow_tab_id: task.workflow_tab_id,
      workflow_canvas_epoch: task.workflow_canvas_epoch,
      ...(targetNode ? { node_id: output.nodeId } : {}),
      executionTime: 1,
      runtimeFingerprint: task.runtimeFingerprint,
      deterministicMode: null,
      runtimeHints: {
        ...structuredClone(value.apiGraph.runtimeHints),
        controlledArtifacts: [],
        loaderContract: ['modules.DiffusersImage.LoadPipeline'],
      },
      runtimeBudget: managed
        ? {
            applied: false,
            reason: 'CUDA budget is advisory; reset PyTorch process memory fraction to full device.',
            cuda_index: 0,
            cuda_budget_policy: 'advisory',
            fraction: 1,
            model_repo: value.apiGraph.runtimeHints.modelRepo,
            model_name: value.apiGraph.runtimeHints.modelName,
            execution_path: null,
            offload_mode: 'none',
          }
        : { applied: false, reason: 'Runtime hints did not target a CUDA device.' },
      runtimeMeasurement: task.runtimeMeasurement,
      runtimePreparation: null,
      resourceRetryHistory: [],
    };
    return value;
  } finally {
    await server.close();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

export function appliedOrderCase() {
  const literal = (value) => ({ value });
  const adapters = [0, 1].map((scale, index) => ({
    adapterName: `protocol_${index}`,
    scale,
    descriptorSha256: String(index + 1).repeat(64),
    artifact: {
      source: 'hub',
      repository: `protocol/adapter-${index}`,
      revision: 'a'.repeat(40),
      weightName: 'adapter.safetensors',
      sha256: String(index + 4).repeat(64),
    },
    scheduler: null,
  }));
  const nodes = Object.fromEntries(
    adapters.map((item, index) => [
      `adapter-${index}`,
      {
        module: 'modules.ModularDiffusers',
        action: 'Lora',
        params: {
          model: literal({ source: 'hub', value: item.artifact.repository }),
          revision: literal(item.artifact.revision),
          weight_name: literal(item.artifact.weightName),
          expected_sha256: literal(item.artifact.sha256),
          adapter_name: literal(item.adapterName),
          scale: literal(item.scale),
          scheduler_class: literal(''),
          scheduler_config: literal('{}'),
          previous_loras: index === 0 ? { display: 'input' } : { sourceId: 'adapter-0', sourceKey: 'lora' },
        },
      },
    ]),
  );
  nodes.loader = {
    module: 'modules.ModularDiffusers',
    action: 'ModelsLoader',
    params: {
      repo_id: literal({ source: 'hub', value: 'protocol/base' }),
      revision: literal('b'.repeat(40)),
      model_type: literal('ProtocolModularPipeline'),
      dtype: literal('float32'),
      lora_list: { sourceId: 'adapter-1', sourceKey: 'lora' },
    },
  };
  nodes.preview = {
    module: 'modules.Image',
    action: 'Preview',
    params: {
      image: { sourceId: 'loader', sourceKey: 'images' },
      preview: { display: 'ui_image', sourceKey: 'output' },
    },
  };
  const apiGraph = {
    nodes,
    paths: [['adapter-0', 'adapter-1', 'loader', 'preview']],
    runtimeHints: {
      modelType: 'ProtocolModularPipeline',
      dtype: 'float32',
      offloadMode: 'none',
      quantizationMode: 'none',
    },
  };
  const args = protocolFactoryArguments(apiGraph);
  const application = {
    schemaVersion: 1,
    status: 'complete',
    source: 'backend-adapter-application',
    applicationId: 'a'.repeat(32),
    observation: 'activated',
    adapters,
    stateSha256: `sha256:applied-adapters-v1:${canonicalJsonHash({ adapters })}`,
  };
  args.executedOutput = {
    ...args.executedOutput,
    taskId: args.taskId,
    attemptIndex: 0,
    nodeId: 'preview',
    apiGraphSnapshot: structuredClone(apiGraph),
    resolvedExecutionInputs: {
      schemaVersion: 1,
      source: 'backend-execution',
      taskId: args.taskId,
      attemptIndex: 0,
      nodeId: 'preview',
      nodes: [
        {
          nodeId: 'loader',
          module: 'modules.ModularDiffusers',
          action: 'ModelsLoader',
          fields: {},
          omittedFields: {},
          appliedAdapters: application,
        },
      ],
      summary: {},
      ambiguousFields: [],
      unavailableFields: [],
      uncapturedNodeIds: [],
      truncated: false,
      appliedAdaptersStatus: { schemaVersion: 1, truncated: false },
    },
  };
  args.executionReceipt = { ...args.executionReceipt, task_id: args.taskId, status: 'completed', attempt_index: 0 };
  return args;
}

// Reuse the actual ten creator fixtures and normal exporter, with rejecting
// networking and ephemeral state. Grouped/ordinary vectors exercise both paths.
export async function legacyCreatorFactoryCases() {
  const prior = new Map(
    ['window', 'localStorage', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    location: { origin: 'http://127.0.0.1:5191' },
    localStorage: globalThis.localStorage,
    dispatchEvent: () => true,
  };
  globalThis.fetch = () => {
    throw new Error('Protocol creator fixtures cannot access the network.');
  };
  let server;
  try {
    server = await createServer({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      optimizeDeps: { entries: [], noDiscovery: true },
      // Only ephemeral ID allocation is deterministic; creator/export behavior
      // and the resulting original graph inputs are not rewritten for the test.
      ssr: { noExternal: ['nanoid'] },
      plugins: [
        {
          name: 'protocol-fixture-ids',
          enforce: 'pre',
          resolveId: (id) => (id === 'nanoid' ? '\0protocol-fixture-ids' : null),
          load: (id) =>
            id === '\0protocol-fixture-ids'
              ? "let id = 0; export const nanoid = () => String(++id).padStart(12, '0');"
              : null,
        },
      ],
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: 'custom',
    });
    const load = (name) => server.ssrLoadModule(`/src/${name}.ts`);
    const [
      templates,
      inputs,
      selection,
      operations,
      catalog,
      choices,
      requests,
      creator,
      flow,
      defaults,
      exactness,
      groups,
    ] = await Promise.all(
      [
        'studio/templates',
        'studio/templateInputs',
        'studio/templateModelSelection',
        'workflow/operationContracts',
        'workflow/operationCatalog',
        'workflow/workflowChoices',
        'workflow/operationStarterRequest',
        'studio/templateOperationWorkflow',
        'stores/useFlowStore',
        'studio/modelProfiles',
        'studio/templateExactness',
        'workflow/visualOperationGroupProjection',
      ].map(load),
    );
    const fixture = JSON.parse(
      readFileSync(new URL('../tests/fixtures/public-flux3-template-creators.v1.json', import.meta.url), 'utf8'),
    );
    const payload = fixture.capabilitiesPayload;
    const contracts = operations.parseOperationContracts(
      payload.operationContracts,
      payload.operationContractSchemaVersion,
    );
    const support = catalog.parsePipelineSupport(
      payload.pipelineSupport,
      payload.pipelineSupportSchemaVersion,
      contracts,
    );
    const descriptors = choices.parseWorkflowModelDescriptors(payload, support);
    const cases = [];
    const cards = templates.PLANNING_STUDIO_TEMPLATES.filter((card) => /^flux3_klein(?:_base)?_fp8r512_/.test(card.id));
    assert.equal(cards.length, 10);
    for (const card of cards) {
      const { capability } = selection.resolveTemplateModelSelection(card, payload.capabilities);
      const binding = card.executionSelection;
      const spec = capability.studioExecutionSpecs.find(
        (item) => item.mode === card.mode && item.executionProfileId === binding.executionProfileId,
      );
      const source = fixture.starters.find(
        (item) =>
          item.pipelineClass === binding.pipelineClass &&
          item.task === binding.task &&
          item.authoring.id === binding.authoringRecipeId &&
          item.authoring.executionProfileIds.includes(binding.executionProfileId),
      );
      const starter = requests.parseOperationStarter(
        structuredClone(source),
        binding.pipelineClass,
        binding.task,
        contracts,
        { executionProfileId: binding.executionProfileId, authoringRecipeId: binding.authoringRecipeId },
      );
      const device = starter.nodes.find((item) => item.node.action === 'ModelsLoader').node.params.device.value;
      const assets = inputs
        .resolveTemplateInputs(card)
        .templateDefaultBindings.flatMap((binding) => binding.defaultAssets);
      const form = {
        ...defaults.DEFAULT_STUDIO_FORM,
        ...exactness.getTemplateLockedSettings(card),
        mode: card.mode,
        modelType: card.modelType,
        device,
        referenceImages: assets.map((asset, index) => `unit-managed-inputs/${card.id}/${index}-${asset.fileName}`),
      };
      const grouped = creator.createTemplateOperationGraph(
        card,
        form,
        starter,
        structuredClone(fixture.registry),
        spec,
        capability,
        { workflowModelDescriptors: descriptors },
      );
      for (const [kind, graph] of [
        ['grouped', grouped],
        ['ordinary', groups.unpackVisualOperationGroups(grouped).graph],
      ]) {
        const api = flow.useFlowStore
          .getState()
          .exportGraph('protocol-legacy', undefined, { sourceGraph: graph, randomizeSeeds: false });
        api.runtimeHints = {
          workflowSnapshot: { ...structuredClone(graph), studioForm: form, studioGraphBinding: null },
        };
        const args = protocolFactoryArguments(api, { nodes: fixture.registry });
        args.templateId = card.id;
        cases.push({ id: `${card.id}:${kind}`, args });
      }
    }
    return cases;
  } finally {
    await server?.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}
