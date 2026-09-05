import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let runtimeHints;
let modelProfiles;
let server;

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  runtimeHints = await server.ssrLoadModule('/src/studio/blockRuntimeHintsV2.ts');
  modelProfiles = await server.ssrLoadModule('/src/studio/modelProfiles.ts');
});

after(async () => server?.close());

function fixture() {
  const artifact = {
    repo: 'Qwen/Qwen-Image-2512',
    revision: '25468b98e3276ca6700de15c6628e51b7de54a26',
  };
  const studioExecutionSpec = {
    id: 'qwen-image-2512:modular-text-to-image:v1',
    contentHash: 'studio-spec-v1-6df91280',
    executionProfileId: 'qwen-image:modular',
  };
  const route = {
    definitionId: 'diffusers.modular:QwenImageModularPipeline:text2image',
    definitionContentHash: `sha256:${'1'.repeat(64)}`,
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'modular_pipeline_workflow',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'QwenImageModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:QwenImageModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-exact123',
    compiledDefinitionCanonicalSha256: `sha256:${'2'.repeat(64)}`,
    studioMode: 'modular_text_to_image',
    adapterContractId: 'diffusers.modular-adapter:QwenImageModularPipeline:text2image:mode:text_to_image',
    studioExecutionSpec,
    artifact,
    reviewedArtifacts: [artifact, { repo: 'Qwen/Qwen-Image', revision: '75e0b4be04f60ec59a75f475837eced720f823b6' }],
    dynamicFieldActions: [],
    boundary: { outputs: [] },
  };
  const dependencies = [
    { id: 'text-encoder', kind: 'model', repo: 'Qwen/Qwen2.5-VL-7B-Instruct', revision: '3'.repeat(40) },
    { id: 'model', kind: 'model', repo: artifact.repo, revision: artifact.revision },
  ];
  const admission = {
    schemaVersion: 4,
    id: route.admissionId,
    definitionId: route.definitionId,
    studioMode: route.studioMode,
    bindingSources: [],
    instanceInputBindings: [],
    executionParameterSources: [],
    sealedBindingValues: {},
    modelDependencies: dependencies,
    dynamicFieldActions: [],
    adapterContractId: route.adapterContractId,
    studioExecutionSpec,
    artifact,
    status: 'admitted',
    claim: 'static_graph_contract_compatible',
    executable: false,
    publication: {
      schemaVersion: 1,
      readiness: 'graph_qualified',
      insertable: true,
      executable: false,
      autoEligible: false,
      liveProof: false,
      reasons: [],
    },
    reasons: [],
  };
  const routeBinding = {
    schemaVersion: 1,
    admissionId: route.admissionId,
    blockDefinition: {
      definitionId: route.admissionId,
      contentHash: route.compiledDefinitionContentHash,
      canonicalSha256: route.compiledDefinitionCanonicalSha256,
    },
    studioExecutionSpec,
    artifact: { repository: artifact.repo, revision: artifact.revision },
    modelDependencies: dependencies
      .map(({ id, kind, repo, revision }) => ({ id, kind, repository: repo, revision }))
      .sort((left, right) =>
        `${left.id}\0${left.repository}\0${left.revision}`.localeCompare(
          `${right.id}\0${right.repository}\0${right.revision}`,
        ),
      ),
  };
  const spec = {
    schemaVersion: 1,
    canonicalizationVersion: 1,
    ...studioExecutionSpec,
    modelType: route.pipelineClass,
    mode: route.studioMode,
    loaderModule: 'modules.ModularDiffusers',
    loaderAction: 'ModelsLoader',
    executionPath: 'modular-diffusers',
    pipelineClass: route.pipelineClass,
    defaultRepo: artifact.repo,
    roles: [],
    edges: [],
    bindings: [],
    autoFields: [],
    actions: [],
  };
  const profile = {
    id: studioExecutionSpec.executionProfileId,
    model_type: route.pipelineClass,
    modes: [route.studioMode],
    loader_module: spec.loaderModule,
    loader_action: spec.loaderAction,
    execution_path: spec.executionPath,
    backend_path: 'modular',
    pipeline_class: spec.pipelineClass,
    default_repo: artifact.repo,
    quantizable_components: ['transformer', 'text_encoder'],
    default_quantized_components: ['transformer'],
    supported_offload_modes: ['none', 'model_cpu', 'group_disk'],
    retry_offload_modes: ['model_cpu', 'group_disk'],
    live_proof: false,
  };
  const capability = {
    modelType: route.pipelineClass,
    executionProfiles: [profile],
    studioExecutionSpecSchemaVersion: 1,
    studioExecutionSpecModes: [route.studioMode],
    studioExecutionSpecs: [spec],
  };
  const form = {
    ...modelProfiles.getFormDefaultsForMode(route.studioMode, route.pipelineClass),
    modelType: route.pipelineClass,
    mode: route.studioMode,
    resourceMode: 'expert',
    modelRepo: artifact.repo,
    prompt: 'selected exact Block prompt',
    device: 'cuda:3',
    dtype: 'float16',
    quantizationMode: 'bnb_4bit',
    autoOffload: true,
    offloadMode: 'group_disk',
    attentionBackend: '_native_math',
  };
  return {
    projection: { form, instanceLabel: 'Qwen selected instance', route, admission, routeBinding },
    capability,
  };
}

test('exact Expert projection binds selected instance recipe, artifact, dependencies and route contract', () => {
  const { projection, capability } = fixture();
  const hints = runtimeHints.registeredBlockExpertRuntimeHintsV2(projection, [capability], {
    authoritative: true,
    executionSpecInvalid: false,
  });

  assert.ok(hints);
  assert.equal(hints.modelType, 'QwenImageModularPipeline');
  assert.equal(hints.mode, 'modular_text_to_image');
  assert.equal(hints.modelRepo, 'Qwen/Qwen-Image-2512');
  assert.equal(hints.resolvedArtifact, 'Qwen/Qwen-Image-2512');
  assert.equal(hints.device, 'cuda:3');
  assert.equal(hints.dtype, 'float16');
  assert.equal(hints.quantizationMode, 'bnb_4bit');
  assert.deepEqual(hints.quantizedComponents, ['transformer', 'text_encoder']);
  assert.equal(hints.autoOffload, true);
  assert.equal(hints.offloadMode, 'group_disk');
  assert.equal(hints.executionPath, 'modular-diffusers');
  assert.equal(hints.pipelineClass, 'QwenImageModularPipeline');
  assert.equal(hints.optimizationQualificationForm.prompt, 'selected exact Block prompt');
  assert.deepEqual(hints.modelDependencies, projection.admission.modelDependencies);
  assert.deepEqual(hints.resourcePlan.studioExecutionSpecContract, projection.route.studioExecutionSpec);
  assert.equal(hints.resourcePlan.artifactRevision, projection.route.artifact.revision);
});

test('same-family Expert projection reports the selected immutable artifact without changing the route', () => {
  const { projection, capability } = fixture();
  const selected = {
    repo: 'Qwen/Qwen-Image',
    revision: '75e0b4be04f60ec59a75f475837eced720f823b6',
  };
  projection.form.modelRepo = selected.repo;
  projection.routeBinding.artifact = { repository: selected.repo, revision: selected.revision };
  const hints = runtimeHints.registeredBlockExpertRuntimeHintsV2(projection, [capability], {
    authoritative: true,
    executionSpecInvalid: false,
  });
  assert.ok(hints);
  assert.equal(hints.modelRepo, selected.repo);
  assert.equal(hints.resolvedArtifact, selected.repo);
  assert.equal(hints.resourcePlan.artifactRevision, selected.revision);
  assert.equal(
    projection.route.admissionId,
    'diffusers.cluster-admission:QwenImageModularPipeline:text2image:mode:text_to_image',
  );
});

test('projection fails closed for sibling, stale dependency, unauthoritative and ambiguous capability identity', () => {
  const { projection, capability } = fixture();
  const options = { authoritative: true, executionSpecInvalid: false };
  assert.equal(
    runtimeHints.registeredBlockExpertRuntimeHintsV2(
      { ...projection, admission: { ...projection.admission, id: `${projection.admission.id}:sibling` } },
      [capability],
      options,
    ),
    null,
  );
  assert.equal(
    runtimeHints.registeredBlockExpertRuntimeHintsV2(
      {
        ...projection,
        routeBinding: {
          ...projection.routeBinding,
          modelDependencies: projection.routeBinding.modelDependencies.slice(1),
        },
      },
      [capability],
      options,
    ),
    null,
  );
  assert.equal(
    runtimeHints.registeredBlockExpertRuntimeHintsV2(projection, [capability], {
      ...options,
      authoritative: false,
    }),
    null,
  );
  assert.equal(
    runtimeHints.registeredBlockExpertRuntimeHintsV2(
      projection,
      [
        {
          ...capability,
          studioExecutionSpecs: [
            capability.studioExecutionSpecs[0],
            structuredClone(capability.studioExecutionSpecs[0]),
          ],
        },
      ],
      options,
    ),
    null,
  );
});

test('application replaces unrelated Studio resource state atomically and strips stale prepared-route hints', () => {
  const { projection, capability } = fixture();
  const exact = runtimeHints.registeredBlockExpertRuntimeHintsV2(projection, [capability], {
    authoritative: true,
    executionSpecInvalid: false,
  });
  const apiGraph = {
    sid: 'test',
    nodes: {},
    paths: [],
    runtimeHints: {
      clientRunId: 'retain-correlation',
      source: 'studio',
      modelType: 'ZImageModularPipeline',
      resolvedArtifact: 'Tongyi-MAI/Z-Image-Turbo',
      dtype: 'bfloat16',
      quantizationMode: 'none',
      offloadMode: 'none',
      studioExecutionSpec: { stale: true },
      autoResourcePlan: { stale: true },
    },
  };
  const applied = runtimeHints.applyRegisteredBlockExpertRuntimeHintsV2(apiGraph, exact);
  assert.equal(applied.runtimeHints.clientRunId, 'retain-correlation');
  assert.equal(applied.runtimeHints.modelType, 'QwenImageModularPipeline');
  assert.equal(applied.runtimeHints.resolvedArtifact, 'Qwen/Qwen-Image-2512');
  assert.equal(applied.runtimeHints.dtype, 'float16');
  assert.equal(applied.runtimeHints.studioExecutionSpec, undefined);
  assert.equal(applied.runtimeHints.autoResourcePlan, undefined);

  const stripped = runtimeHints.applyRegisteredBlockExpertRuntimeHintsV2(apiGraph, null, {
    stripStaleRouteHints: true,
  });
  assert.deepEqual(stripped.runtimeHints, { clientRunId: 'retain-correlation' });
});
