import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { canonicalAuxiliaryTerminalBinding, verifyNoDeadWorkflowNodes } from './workflow-library-dead-nodes.mjs';
import {
  attachCanonicalAuxiliaryBinding,
  parseCanonicalAuxiliarySources,
} from './workflow-library-auxiliary-sources.mjs';

const candidateIds = ['flux2_dev_text_to_image', 'cosmos3_super_text_to_image'];
const expected = {
  flux2_dev_text_to_image: {
    repo: 'black-forest-labs/FLUX.2-dev',
    revision: '26afe3a78bb242c0a8bb181dcc8937bb16e5c66c',
    pipeline: 'Flux2ModularPipeline',
    profile: 'flux2:modular',
    seed: 20260905,
    actions: ['ModelsLoader', 'EncodePrompt', 'Denoise', 'DecodeLatents', 'Preview'],
  },
  cosmos3_super_text_to_image: {
    repo: 'nvidia/Cosmos3-Super-Text2Image',
    revision: 'daf3d374804be4c512c2135568a7cb95d4341d79',
    pipeline: 'Cosmos3OmniModularPipeline',
    profile: 'cosmos3-super-text-to-image:official-modular-workflow',
    seed: 1143,
    actions: [
      'ModelsLoader',
      'WorkflowCosmos3OmniTextEncode',
      'WorkflowCosmos3OmniDenoise',
      'WorkflowCosmos3OmniDecode',
      'WorkflowCosmos3OmniAfterDecode',
      'Preview',
    ],
  },
};
let server, publicTemplates, candidates, builder, exactness, groups, operations, starterRequests, flowStore;
let defaults, fixture, backendCaption, backendCaptionBytes;
let readiness, usagePolicies;
const backend = path.resolve('../MoDiff');

before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    location: { origin: 'http://127.0.0.1:5191' },
    localStorage: globalThis.localStorage,
    dispatchEvent: () => true,
  };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  const module = await server.ssrLoadModule('/src/studio/templates.ts');
  publicTemplates = module.STUDIO_TEMPLATES;
  candidates = candidateIds.map((id) => module.PLANNING_STUDIO_TEMPLATES.find((item) => item.id === id));
  assert.ok(candidates.every(Boolean));
  builder = await server.ssrLoadModule('/src/studio/templateOperationWorkflow.ts');
  exactness = await server.ssrLoadModule('/src/studio/templateExactness.ts');
  readiness = await server.ssrLoadModule('/src/studio/templateReadiness.ts');
  usagePolicies = await server.ssrLoadModule('/src/studio/modelUsagePolicies.ts');
  groups = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  operations = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  starterRequests = await server.ssrLoadModule('/src/workflow/operationStarterRequest.ts');
  ({ useFlowStore: flowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts'));
  ({ DEFAULT_STUDIO_FORM: defaults } = await server.ssrLoadModule('/src/studio/modelProfiles.ts'));
  const python = process.env.MODIFF_BACKEND_PYTHON;
  assert.ok(python, 'Use the declared ordinary native CPU environment, not a managed optional overlay.');
  fixture = JSON.parse(
    execFileSync(python, [path.resolve('scripts/template-operation-fixtures.py')], {
      cwd: backend,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      input: JSON.stringify(candidates.map((item) => ({ id: item.id, selection: item.executionSelection }))),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }),
  );
  backendCaptionBytes = await readFile(path.join(backend, 'data/cosmos3-super-t2i-publisher-caption.v1.json'));
  backendCaption = JSON.parse(backendCaptionBytes);
});
after(async () => server?.close());

function build(template, options = {}) {
  const row = structuredClone(fixture.recipes.find((item) => item.id === template.id));
  row.capability = structuredClone(fixture.capabilities.find((item) => item.modelType === template.modelType));
  options.mutateRow?.(row);
  const contracts = operations.parseOperationContracts(
    fixture.publicPayload.operationContracts,
    fixture.publicPayload.operationContractSchemaVersion,
  );
  const starter = starterRequests.parseOperationStarter(
    row.starter,
    row.starter.pipelineClass,
    row.starter.task,
    contracts,
  );
  const form = { ...defaults, ...exactness.getTemplateLockedSettings(template), ...options.form };
  const graph = builder.createTemplateOperationGraph(
    template,
    form,
    starter,
    fixture.registry,
    row.spec,
    row.capability,
  );
  const flat = groups.unpackVisualOperationGroups(graph).graph;
  const api = flowStore.getState().exportGraph('private-full-image-template-cpu', undefined, {
    sourceGraph: graph,
    randomizeSeeds: false,
  });
  return { row, starter, form, graph, flat, api, nodes: Object.values(api.nodes) };
}

test('private full-model recipes do not alter the historical 54 public image recipes or publish proof', () => {
  assert.equal(publicTemplates.filter((item) => item.example?.mediaType === 'image').length, 54);
  for (const template of candidates) {
    assert.equal(
      publicTemplates.some((item) => item.id === template.id),
      false,
    );
    assert.equal(template.example.status, 'blocked');
    assert.equal(template.difficulty, 'blocked');
    assert.ok(template.example.blockReason);
    for (const field of ['outputPath', 'mediaHash', 'runtimeFingerprint', 'verificationTimestamp', 'thumbnailPath'])
      assert.equal(template.example[field], undefined);
    assert.equal(template.executionSelection.implementation, 'native_stages');
    assert.equal(
      template.executionSelection.guidancePolicy,
      undefined,
      'Do not copy FLUX.1 true-CFG policy into embedded guidance.',
    );
  }
});

test('both candidates export ordinary native nodes, exact owners and the original 50-step BF16 recipe', async (t) => {
  for (const template of candidates)
    await t.test(template.id, () => {
      const { nodes, flat, api, form } = build(template);
      const recipe = expected[template.id];
      assert.deepEqual(nodes.map((node) => node.action).sort(), [...recipe.actions].sort());
      assert.equal(
        nodes.some((node) => ['LoadPipeline', 'Generate', 'DiffusersExecutionRecipe', 'Guider'].includes(node.action)),
        false,
      );
      const owner = nodes.find((node) => node.action === 'ModelsLoader');
      assert.equal(owner.params.repo_id.value.value, recipe.repo);
      assert.equal(owner.params.revision.value, recipe.revision);
      assert.equal(owner.params.model_type.value, recipe.pipeline);
      const declaredProfiles = fixture.capabilities.flatMap((capability) => capability.executionProfiles ?? []);
      const profile = declaredProfiles.find((item) => item.id === recipe.profile);
      assert.ok(profile, 'The exact backend execution profile must exist.');
      assert.equal(profile.pipeline_class, recipe.pipeline);
      assert.equal(profile.default_repo, recipe.repo);
      if (template.id === 'cosmos3_super_text_to_image')
        assert.deepEqual(profile.optional_runtime_profiles, ['cosmos-guardrail-0.3.1']);
      if (owner.params.execution_profile_id) assert.equal(owner.params.execution_profile_id.value, recipe.profile);
      assert.equal(owner.params.dtype.value, 'bfloat16');
      assert.equal(form.quantizationMode, 'none');
      assert.equal(owner.params.quant_config.sourceId, undefined);
      assert.equal(owner.params.quant_config.value, undefined);
      assert.equal(owner.params.offload_mode.value, 'none');
      assert.equal(owner.params.auto_offload.value, false);
      assert.equal(owner.params.trust_remote_code.value, false);
      assert.equal(form.resourceMode, 'expert');
      assert.equal(form.randomSeed, false);
      const denoise = nodes.find((node) => /Denoise$/u.test(node.action));
      assert.equal(denoise.params.num_inference_steps.value, 50);
      assert.equal(denoise.params.guidance_scale.value, 4);
      assert.equal(Number(denoise.params.seed.value), recipe.seed);
      if (template.id === 'flux2_dev_text_to_image') {
        const nativeDenoise = flat.nodes.find((node) => node.data.action === 'Denoise');
        const guidance = nativeDenoise.data.operationAuthoring.operation.ports.find(
          (port) => port.name === 'guidance_scale' && port.direction === 'input',
        ).semantics.control;
        assert.equal(guidance.technique, 'embedded_distilled');
        assert.equal(guidance.compatibilityScope, 'diffusers.flux2.embedded.v1');
        assert.equal(form.maxSequenceLength, 512);
      }
      const imageDimensions = nodes.find(
        (node) => node.params.width?.value !== undefined && node.params.height?.value !== undefined,
      );
      assert.equal(imageDimensions.params.width.value, 1024);
      assert.equal(imageDimensions.params.height.value, 1024);
      assert.ok(flat.nodes.some((node) => operations.operationOwnsModel(node.data.operationAuthoring?.operation)));
      assert.equal(Object.values(api.nodes).filter((node) => node.action === 'Preview').length, 1);
    });
});

test('Cosmos publisher text comes from the actual backend starter and all safety-stage dependencies remain intact', () => {
  const template = candidates.find((item) => item.id === 'cosmos3_super_text_to_image');
  const { api, nodes, flat, row, starter } = build(template);
  const prompt = nodes.find((node) => node.action === 'WorkflowCosmos3OmniTextEncode');
  const sourcePrompt = starter.nodes.find((item) => item.node.action === 'WorkflowCosmos3OmniTextEncode').node.params
    .prompt;
  assert.equal(prompt.params.prompt.value, sourcePrompt.value ?? sourcePrompt.default);
  assert.deepEqual(JSON.parse(prompt.params.prompt.value), backendCaption);
  assert.deepEqual(Buffer.from(prompt.params.prompt.value, 'utf8'), backendCaptionBytes);
  assert.equal(template.prompt, '', 'Do not duplicate the publisher caption in frontend recipe data.');
  const promptNode = flat.nodes.find((node) => node.data.action === 'WorkflowCosmos3OmniTextEncode');
  assert.equal(promptNode.data.operationAuthoring.authored?.includes('prompt') ?? false, false);
  assert.equal(prompt.params.num_frames.value, 1);
  for (const node of nodes.filter((item) => item.module === 'modules.ModularDiffusers')) {
    assert.equal(node.params.workflow_id.value, 'text2image');
    if (node.action !== 'ModelsLoader') assert.equal(node.params.pipeline_class.value, 'Cosmos3OmniModularPipeline');
  }
  const roleIds = new Map(
    row.spec.roles.map(([role, key]) => [
      role,
      Object.entries(api.nodes).find(([, node]) => `${node.module}.${node.action}` === key)[0],
    ]),
  );
  let wires = 0;
  for (const [source, output, target, input] of row.spec.edges) {
    const param = api.nodes[roleIds.get(target)].params[input];
    assert.equal(param.sourceId, roleIds.get(source));
    assert.equal(param.sourceKey, output);
    wires += 1;
  }
  assert.equal(wires, 8);
  assert.equal(api.nodes[roleIds.get('preview')].params.image.sourceId, roleIds.get('decode'));
  assert.equal(api.nodes[roleIds.get('afterDecode')].params.state_in.sourceId, roleIds.get('decode'));
  assert.equal(api.nodes[roleIds.get('afterDecode')].params.block_path.value, 'after_decode');
  assert.equal(
    nodes.some((node) => node.action.includes('Distilled')),
    false,
  );
  assert.equal(
    template.requiredBackendCapabilities.includes('modules.ModularDiffusers.WorkflowCosmos3OmniAfterDecode'),
    true,
  );
});

test('backend default is only initial provenance: authored text and later intentional clears export unchanged', () => {
  const template = candidates.find((item) => item.id === 'cosmos3_super_text_to_image');
  const authored = 'An intentionally different complete image caption.';
  const { graph, flat, nodes } = build(template, { form: { prompt: authored } });
  const prompt = nodes.find((node) => node.action === 'WorkflowCosmos3OmniTextEncode');
  assert.equal(prompt.params.prompt.value, authored);
  const promptNode = flat.nodes.find((node) => node.data.action === 'WorkflowCosmos3OmniTextEncode');
  assert.ok(promptNode.data.operationAuthoring.authored.includes('prompt'));
  promptNode.data.params.prompt.value = '';
  // Normal saved graph/export does not reapply a fresh-template policy.
  const api = flowStore
    .getState()
    .exportGraph('intentional-clear', undefined, { sourceGraph: flat, randomizeSeeds: false });
  assert.equal(
    Object.values(api.nodes).find((node) => node.action === 'WorkflowCosmos3OmniTextEncode').params.prompt.value,
    '',
  );
  assert.equal(graph.nodes.length > 0, true);
});

test('backend-default preservation fails closed without an exact declared text binding and nonempty starter default', () => {
  const template = candidates.find((item) => item.id === 'cosmos3_super_text_to_image');
  const badField = structuredClone(template);
  badField.executionSelection.backendDefaultInputs = ['artifact'];
  assert.throws(() => build(badField), /needs one declared text binding/u);
  assert.throws(
    () =>
      build(template, {
        mutateRow: (row) => {
          const item = row.starter.nodes.find((node) => node.node.action === 'WorkflowCosmos3OmniTextEncode');
          item.node.params.prompt.value = '';
          item.node.params.prompt.default = '';
        },
      }),
    /is missing or already authored/u,
  );
  assert.throws(
    () =>
      build(template, {
        mutateRow: (row) => row.spec.bindings.push(['prompt', 'negative_prompt', 'prompt']),
      }),
    /needs one declared text binding/u,
  );
});

test('an immutable fresh recipe rejects a same-class artifact/revision or missing exact public profile', () => {
  const template = candidates.find((item) => item.id === 'cosmos3_super_text_to_image');
  for (const mutation of [
    (row) => {
      row.starter.nodes.find((item) => item.node.action === 'ModelsLoader').node.params.repo_id.value = {
        source: 'hub',
        value: 'nvidia/Cosmos3-Nano',
      };
    },
    (row) => {
      row.starter.nodes.find((item) => item.node.action === 'ModelsLoader').node.params.revision.value = 'a'.repeat(40);
    },
    (row) => {
      row.capability.executionProfiles = row.capability.executionProfiles.filter(
        (profile) => profile.id !== template.executionSelection.executionProfileId,
      );
    },
  ])
    assert.throws(() => build(template, { mutateRow: mutation }), /different immutable template model artifact/u);
  for (const mutate of [
    (recipe) => {
      recipe.modelArtifact.value = 'nvidia/Cosmos3-Nano';
    },
    (recipe) => {
      recipe.modelArtifact.revision = 'a'.repeat(40);
    },
  ]) {
    const other = structuredClone(template);
    mutate(other);
    assert.throws(() => build(other), /different immutable template model artifact/u);
  }
  const withoutMediaRevision = structuredClone(template);
  delete withoutMediaRevision.example.modelRevision;
  assert.ok(build(withoutMediaRevision).graph.nodes.length);
  assert.throws(
    () =>
      build(withoutMediaRevision, {
        mutateRow: (row) => {
          row.starter.nodes.find((item) => item.node.action === 'ModelsLoader').node.params.revision.value = 'a'.repeat(
            40,
          );
        },
      }),
    /different immutable template model artifact/u,
  );
  withoutMediaRevision.modelArtifact.revision = 'main';
  assert.throws(() => build(withoutMediaRevision), /different immutable template model artifact/u);
});

function runnableCandidate(template) {
  // A CPU fixture exercising separate Custom admission; it publishes no recipe or proof.
  return {
    ...structuredClone(template),
    difficulty: 'advanced',
    readinessPolicy: 'runnable',
    example: { ...template.example, status: 'unverified' },
  };
}

function customContext(template) {
  const capabilities = structuredClone(fixture.capabilities);
  const capability = capabilities.find((item) => item.modelType === template.modelType);
  const profile = capability.executionProfiles.find(
    (item) => item.id === template.executionSelection.executionProfileId,
  );
  const optionalId = profile.optional_runtime_profiles?.[0];
  profile.optionalRuntimeRequirement = {
    schemaVersion: 1,
    delivery: optionalId ? 'optional_overlay' : 'base',
    requiredNow: Boolean(optionalId),
    profileIds: optionalId ? [optionalId] : [],
    executionProfileIds: [profile.id],
    state: optionalId ? 'active' : 'base_satisfied',
    reason: 'Exact CPU fixture runtime requirement.',
  };
  const requirements =
    capability.modeRequirements?.[template.mode]?.modelRequirements ?? capability.additionalRequirements ?? [];
  const artifact = capability.artifactSelections?.find(
    (item) => item.repo === template.modelArtifact.value && item.modes.includes(template.mode),
  );
  const baseFiles =
    artifact?.downloadFiles ??
    (capability.defaultRepo === template.modelArtifact.value ? capability.downloadFiles : undefined);
  const hfCache = [
    {
      id: template.modelArtifact.value,
      complete: true,
      installed: true,
      planned_revision: template.modelArtifact.revision,
      planned_files: baseFiles ?? [],
    },
    ...requirements.map((item) => ({
      id: item.repo,
      complete: true,
      installed: true,
      planned_revision: item.revision,
      planned_files: item.downloadFiles ?? [],
    })),
  ];
  const digest = `sha256:${'a'.repeat(64)}`;
  return {
    form: {
      ...defaults,
      ...exactness.getTemplateLockedSettings(template),
      mode: template.mode,
      modelType: template.modelType,
    },
    hfCache,
    localModels: [],
    modelCacheDiagnostics: { locations: [] },
    nodesRegistry: fixture.registry,
    studioModelCapabilities: capabilities,
    runtimeStatus: {
      ready: true,
      runtimeEnvironment: { profileVerified: true, executionReady: true },
      packages: Object.fromEntries(
        ['torch', 'diffusers', 'transformers', 'peft'].map((name) => [name, { available: true }]),
      ),
      missing_required_packages: [],
    },
    optionalRuntimeCatalog: optionalId
      ? {
          profiles: [
            {
              id: optionalId,
              specDigest: digest,
              cutoverReady: true,
              contractState: 'qualified',
              overlayStatus: 'active',
            },
          ],
          processLoadStatus: 'active',
          activeOptionalRuntimeSpecs: [{ profileId: optionalId, specDigest: digest }],
        }
      : null,
    // A missing Auto proof is deliberately not an installation/runtime waiver.
    autoResourcePlan: {
      status: 'needs_setup',
      readiness: 'expert_only',
      issue: { category: 'device' },
      compatibility: {
        state: 'expert_only',
        severity: 'warning',
        code: 'manual_only',
        summary: 'Auto unqualified',
        detail: 'No Auto fit has been qualified.',
        source: 'backend_auto_planner',
      },
    },
  };
}

test('explicit resolved Custom recipes check exact prerequisites without requiring or claiming an Auto fit', async (t) => {
  for (const template of candidates)
    await t.test(template.id, () => {
      const recipe = runnableCandidate(template),
        context = customContext(recipe);
      const result = readiness.getTemplateReadiness(recipe, context);
      assert.equal(result.status, 'ready');
      assert.equal(result.label, 'Custom · experimental');
      assert.equal(result.tone, 'warning');
      assert.equal(result.compatibility.source, 'backend_execution_profile');
      assert.equal(result.compatibility.code, 'custom_recipe_experimental');
      assert.match(result.summary, /hardware fit and output quality remain experimental/u);
      assert.equal(result.issues.length, 0);
      assert.deepEqual(result.modelInstallTargets, []);
      assert.equal(readiness.getTemplateReadiness(template, context).status, 'planning');
    });
});

test('Custom readiness rejects wrong same-family defaults and preserves exact install revision/files', () => {
  const recipe = runnableCandidate(candidates.find((item) => item.id === 'cosmos3_super_text_to_image'));
  const context = customContext(recipe);
  context.hfCache = context.hfCache.filter((item) => item.id !== recipe.modelArtifact.value);
  context.hfCache.push({ id: 'nvidia/Cosmos3-Nano', complete: true, installed: true });
  let result = readiness.getTemplateReadiness(recipe, context);
  assert.equal(result.status, 'needs_model');
  assert.deepEqual(result.missingModelRepos, [recipe.modelArtifact.value]);
  assert.equal(result.modelInstallTargets[0].revision, recipe.modelArtifact.revision);
  assert.equal(
    result.modelInstallTargets.some((item) => item.repoId === 'nvidia/Cosmos3-Nano'),
    false,
  );
  context.hfCache.push({
    id: `${recipe.modelArtifact.value}-other`,
    complete: true,
    installed: true,
    planned_revision: recipe.modelArtifact.revision,
  });
  assert.equal(readiness.getTemplateReadiness(recipe, context).status, 'needs_model');
  context.hfCache.push({
    id: recipe.modelArtifact.value,
    complete: true,
    installed: true,
    planned_revision: 'b'.repeat(40),
  });
  result = readiness.getTemplateReadiness(recipe, context);
  assert.equal(result.modelInstallTargets[0].repair, true);
  assert.equal(result.issues.find((item) => item.repoId === recipe.modelArtifact.value).category, 'model_integrity');
  context.hfCache[context.hfCache.length - 1] = {
    id: recipe.modelArtifact.value,
    complete: false,
    installed: false,
    planned_revision: recipe.modelArtifact.revision,
    repair_required: true,
  };
  result = readiness.getTemplateReadiness(recipe, context);
  assert.equal(result.modelInstallTargets[0].repair, true);
  assert.equal(result.modelInstallTargets[0].actionLabel, 'Repair');
});

test('Custom readiness retains required safety artifacts and their exact reviewed selections', () => {
  const recipe = runnableCandidate(candidates.find((item) => item.id === 'cosmos3_super_text_to_image'));
  const context = customContext(recipe);
  assert.ok(context.hfCache.length >= 2);
  const safety = context.hfCache[1];
  const capability = context.studioModelCapabilities.find((item) => item.modelType === recipe.modelType);
  const dependency = (
    capability.modeRequirements?.[recipe.mode]?.modelRequirements ?? capability.additionalRequirements
  ).find((item) => item.repo === safety.id);
  dependency.downloadFiles = ['README.md']; // Exercise the generic declared file contract in this CPU fixture.
  safety.planned_files = [...dependency.downloadFiles];
  context.hfCache[1] = { ...safety, planned_revision: 'c'.repeat(40) };
  const result = readiness.getTemplateReadiness(recipe, context);
  assert.equal(result.status, 'needs_model');
  assert.equal(result.modelInstallTargets.find((item) => item.repoId === safety.id).repair, true);
  assert.equal(result.modelInstallTargets.find((item) => item.repoId === safety.id).revision, safety.planned_revision);
  assert.deepEqual(result.modelInstallTargets.find((item) => item.repoId === safety.id).files, safety.planned_files);
});

test('Custom memory never waives broken base runtime, profile identity, optional activation, or required image inputs', () => {
  const template = candidates.find((item) => item.id === 'cosmos3_super_text_to_image');
  for (const mutate of [
    (recipe, context) => {
      context.runtimeStatus.runtimeEnvironment.profileVerified = false;
    },
    (recipe, context) => {
      context.runtimeStatus.runtimeEnvironment.executionReady = false;
    },
    (recipe, context) => {
      context.runtimeStatus.packages.transformers.available = false;
    },
    (recipe, context) => {
      context.runtimeStatus.packages.peft.available = false;
    },
    (recipe, context) => {
      context.runtimeStatus.missing_required_packages = ['transformers'];
    },
    (recipe, context) => {
      context.studioModelCapabilities = [];
    },
    (recipe) => {
      recipe.modelArtifact.value = 'nvidia/Cosmos3-Nano';
    },
    (recipe) => {
      recipe.modelArtifact.revision = 'd'.repeat(40);
    },
    (recipe, context) => {
      context.optionalRuntimeCatalog = null;
    },
    (recipe, context) => {
      context.optionalRuntimeCatalog.processLoadStatus = 'restart_required';
    },
    (recipe, context) => {
      context.optionalRuntimeCatalog.activeOptionalRuntimeSpecs[0].specDigest = 'wrong';
    },
    (recipe, context) => {
      const capability = context.studioModelCapabilities.find((item) => item.modelType === recipe.modelType);
      const profile = capability.executionProfiles.find(
        (item) => item.id === recipe.executionSelection.executionProfileId,
      );
      profile.optionalRuntimeRequirement.state = 'staged';
    },
  ]) {
    const recipe = runnableCandidate(template),
      context = customContext(recipe);
    mutate(recipe, context);
    const result = readiness.getTemplateReadiness(recipe, context);
    assert.equal(result.status, 'needs_backend');
    assert.equal(result.decision.state, 'blocked');
  }
  const recipe = runnableCandidate(template),
    context = customContext(recipe);
  context.form.resourceMode = 'auto';
  assert.equal(readiness.getTemplateReadiness(recipe, context).status, 'needs_setup');
  recipe.inputRequirements = { referenceImages: 1 };
  context.form.resourceMode = 'expert';
  assert.equal(readiness.getTemplateReadiness(recipe, context).status, 'needs_input');
});

test('template terms identify the declared full checkpoint rather than a static family default', () => {
  const template = structuredClone(candidates[0]);
  const policy = Object.values(usagePolicies.MODEL_USAGE_POLICIES).find((item) =>
    item.repository.includes('FLUX.1-dev'),
  );
  assert.ok(policy, 'Use an existing reviewed policy; do not invent terms for the private new candidates.');
  template.modelArtifact = { source: 'hub', value: policy.repository, revision: 'd'.repeat(40) };
  const selected = usagePolicies.templateUsagePolicies(template).find((item) => item.repository === policy.repository);
  assert.equal(selected?.revision, template.modelArtifact.revision);
  const cosmosPolicies = usagePolicies.templateUsagePolicies(candidates[1]);
  assert.ok(
    cosmosPolicies.some((item) => item.repository === 'nvidia/Cosmos-Guardrail1' && item.acknowledgementRequired),
  );
});

test('canonical native workflows keep declaration-bound auxiliary terminals and reject every unused branch', async (t) => {
  const template = candidates.find((item) => item.id === 'cosmos3_super_text_to_image');
  const built = build(template);
  const workflow = { id: `${template.modelType}:${template.mode}`, modelType: template.modelType, mode: template.mode };
  const source = {
    executionSpec: built.row.spec,
    operationContracts: operations.parseOperationContracts(
      fixture.publicPayload.operationContracts,
      fixture.publicPayload.operationContractSchemaVersion,
    ),
  };
  assert.throws(() => verifyNoDeadWorkflowNodes(workflow, built.flat), /outside every output dependency path/);
  workflow.auxiliaryTerminalBinding = canonicalAuxiliaryTerminalBinding(workflow, built.flat, source);
  assert.equal(workflow.auxiliaryTerminalBinding.executionSpecId, built.row.spec.id);
  assert.equal(workflow.auxiliaryTerminalBinding.executionSpecContentHash, built.row.spec.contentHash);
  assert.equal(workflow.auxiliaryTerminalBinding.terminals.length, 1);
  verifyNoDeadWorkflowNodes(workflow, built.flat, source);
  assert.throws(() => verifyNoDeadWorkflowNodes(workflow, built.flat), /authoritative.*source contract/);
  const byAction = (graph, action) => graph.nodes.find((node) => node.data.action === action);
  const cases = {
    'missing mandatory post-processing': (graph) => {
      graph.nodes = graph.nodes.filter((node) => node.data.action !== 'WorkflowCosmos3OmniAfterDecode');
    },
    'missing SDK decode-state dependency': (graph) => {
      const id = byAction(graph, 'WorkflowCosmos3OmniAfterDecode').id;
      graph.edges = graph.edges.filter((edge) => edge.target !== id || edge.targetHandle !== 'state_in');
    },
    'wrong model owner class': (graph) => {
      byAction(graph, 'ModelsLoader').data.params.model_type.value = 'OtherModularPipeline';
    },
    'wrong SDK stage': (graph) => {
      byAction(graph, 'WorkflowCosmos3OmniAfterDecode').data.params.block_path.value = 'denoise';
    },
    'wrong workflow context': (graph) => {
      byAction(graph, 'WorkflowCosmos3OmniAfterDecode').data.params.workflow_id.value = 'text2video';
    },
    'forged operation metadata': (graph) => {
      byAction(graph, 'WorkflowCosmos3OmniAfterDecode').data.operationAuthoring.operation.operationId =
        'diffusion.denoise';
    },
    'duplicate declared stage': (graph) => {
      graph.nodes.push({ ...structuredClone(byAction(graph, 'WorkflowCosmos3OmniAfterDecode')), id: 'extra-stage' });
    },
    'invented AfterDecode image port': (graph) => {
      const preview = byAction(graph, 'Preview');
      const edge = graph.edges.find((row) => row.target === preview.id && row.targetHandle === 'image');
      edge.source = byAction(graph, 'WorkflowCosmos3OmniAfterDecode').id;
      edge.sourceHandle = 'image';
    },
    'extra dependency into auxiliary terminal': (graph) => {
      graph.edges.push({
        id: 'extra-input',
        source: byAction(graph, 'Preview').id,
        sourceHandle: 'output',
        target: byAction(graph, 'WorkflowCosmos3OmniAfterDecode').id,
        targetHandle: 'action',
      });
    },
    'duplicate source for required SDK input': (graph) => {
      const edge = graph.edges.find(
        (row) => row.target === byAction(graph, 'WorkflowCosmos3OmniDenoise').id && row.targetHandle === 'state_in',
      );
      graph.edges.push({ ...edge, id: 'duplicate-input' });
    },
    'undeclared isolated branch': (graph) => {
      graph.nodes.push({ id: 'stray', data: { module: 'modules.Image', action: 'Load', params: {} } });
    },
    'disabled mandatory post-processing': (graph) => {
      byAction(graph, 'WorkflowCosmos3OmniAfterDecode').data.uiState = { disabled: true };
    },
  };
  for (const [name, mutate] of Object.entries(cases))
    await t.test(name, () => {
      const graph = structuredClone(built.flat);
      mutate(graph);
      assert.throws(() => verifyNoDeadWorkflowNodes(workflow, graph, source));
    });
  await t.test('forged manifest terminal, source identity and absent binding stay closed', () => {
    const forged = structuredClone(workflow);
    forged.auxiliaryTerminalBinding.terminals.push({ role: 'stray', nodeId: 'stray' });
    assert.throws(() => verifyNoDeadWorkflowNodes(forged, built.flat, source), /metadata differs/);
    const wrongSource = structuredClone(source);
    wrongSource.executionSpec.mode = 'text_to_video';
    assert.throws(() => verifyNoDeadWorkflowNodes(workflow, built.flat, wrongSource), /source contract/);
    const changed = structuredClone(workflow);
    changed.auxiliaryTerminalBinding.executionSpecContentHash = 'studio-spec-v1-ffffffff';
    assert.throws(() => verifyNoDeadWorkflowNodes(changed, built.flat, source), /metadata differs/);
  });
  const flux = build(candidates.find((item) => item.id === 'flux2_dev_text_to_image'));
  verifyNoDeadWorkflowNodes({ id: 'unchanged-full-flux' }, flux.flat);
});

test('canonical generator and verifier parse the same independent source before emitting an auxiliary binding', async () => {
  const template = candidates.find((item) => item.id === 'cosmos3_super_text_to_image');
  const built = build(template);
  const selected = [fixture.capabilities.find((item) => item.modelType === template.modelType)];
  const parsed = await parseCanonicalAuxiliarySources(fixture.publicPayload, selected, server);
  const source = parsed.sources.get(`${template.modelType}|${template.mode}`);
  assert.ok(source);
  assert.equal(parsed.sources.has('Flux2ModularPipeline|text_to_image'), false);
  const workflow = { id: `${template.modelType}:${template.mode}`, modelType: template.modelType, mode: template.mode };
  attachCanonicalAuxiliaryBinding(workflow, built.graph, parsed);
  assert.ok(workflow.auxiliaryTerminalBinding);
  verifyNoDeadWorkflowNodes(workflow, parsed.unpackGraph(built.graph), source);
  const changed = structuredClone(fixture.publicPayload);
  changed.capabilities.find((item) => item.modelType === template.modelType).studioExecutionSpecs[0].contentHash =
    'studio-spec-v1-ffffffff';
  await assert.rejects(
    parseCanonicalAuxiliarySources(changed, selected, server),
    /Invalid Studio execution specification/,
  );
  const unrelated = await parseCanonicalAuxiliarySources(
    fixture.publicPayload,
    [{ modelType: 'Flux2ModularPipeline' }],
    server,
  );
  assert.equal(unrelated.sources.size, 0);
  assert.equal(unrelated.unpackGraph(built.graph), built.graph);
  const ordinary = { id: 'ordinary', modelType: 'Flux2ModularPipeline', mode: 'text_to_image' };
  const before = structuredClone(ordinary);
  assert.equal(attachCanonicalAuxiliaryBinding(ordinary, built.graph, unrelated), ordinary);
  assert.deepEqual(ordinary, before);
});
