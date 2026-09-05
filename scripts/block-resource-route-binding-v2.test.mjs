import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBRARY_REVISION = 'a'.repeat(40);
const ARTIFACT_REVISION = 'b'.repeat(40);

let bindingModule;
let schema;
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
  schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  bindingModule = await server.ssrLoadModule('/src/studio/blockResourceRouteBindingV2.ts');
});

after(async () => {
  await server?.close();
});

function fixture() {
  const admissionId = 'diffusers.cluster-admission:TestModularPipeline:text2image:mode:text_to_image';
  const graphWithoutHash = {
    nodes: [
      {
        nodeId: 'generate',
        nodeType: 'Diffusers.Generate',
        semanticRole: 'denoise',
        data: { params: { prompt: { type: 'string' }, images: { type: 'list[image]' } } },
      },
    ],
    edges: [],
    executionOrder: ['generate'],
  };
  const graph = { ...graphWithoutHash, graphHash: schema.blockGraphHashV2(graphWithoutHash) };
  const withoutHash = {
    schemaVersion: 2,
    definitionId: admissionId,
    displayName: 'Test exact route',
    source: {
      kind: 'diffusers_catalog',
      catalogCategory: 'diffusers',
      provider: 'test-publisher',
      library: 'diffusers',
      libraryRevision: LIBRARY_REVISION,
      pipelineClass: 'TestModularPipeline',
      workflow: 'text2image',
      manifestDefinitionId: 'diffusers.modular:TestModularPipeline:text2image',
      manifestContentHash: `sha256:${'c'.repeat(64)}`,
      executionAdmissionId: admissionId,
      repository: 'owner/model',
      repositoryRevision: ARTIFACT_REVISION,
    },
    graph,
    boundary: {
      mode: 'explicit',
      inputs: [
        {
          portId: 'prompt',
          label: 'Prompt',
          valueType: 'string',
          required: true,
          binding: { nodeId: 'generate', fieldOrPortId: 'prompt' },
        },
      ],
      outputs: [
        {
          portId: 'images',
          label: 'Images',
          valueType: 'list[image]',
          required: true,
          binding: { nodeId: 'generate', fieldOrPortId: 'images' },
        },
      ],
    },
    controls: [
      {
        controlId: 'prompt',
        label: 'Prompt',
        binding: { nodeId: 'generate', fieldId: 'prompt' },
        valueType: 'string',
        defaultValue: 'A creator-provided prompt.',
        required: true,
        order: 0,
      },
    ],
    previews: [{ nodeId: 'generate', outputPortId: 'images', mediaType: 'image', primary: true }],
    ownership: { kind: 'registered', definitionMutable: false },
  };
  const definition = {
    ...withoutHash,
    contentHash: schema.blockDefinitionContentHashV2(withoutHash),
  };
  const canonicalSha256 = `sha256:${createHash('sha256')
    .update(schema.canonicalBlockStringifyV2(schema.canonicalBlockDefinitionV2(definition)))
    .digest('hex')}`;
  const route = {
    definitionId: definition.source.manifestDefinitionId,
    definitionContentHash: definition.source.manifestContentHash,
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'modular_pipeline_workflow',
    libraryRevision: LIBRARY_REVISION,
    pipelineClass: definition.source.pipelineClass,
    workflowId: definition.source.workflow,
    admissionId,
    compiledDefinitionContentHash: definition.contentHash,
    compiledDefinitionCanonicalSha256: canonicalSha256,
    studioMode: 'text_to_image',
    adapterContractId: 'test:adapter:v1',
    studioExecutionSpec: {
      id: 'test:studio:v1',
      contentHash: 'studio-spec-v1-1234abcd',
      executionProfileId: 'test:exact-route',
    },
    artifact: { repo: definition.source.repository, revision: ARTIFACT_REVISION },
    dynamicFieldActions: [],
    boundary: { outputs: [] },
  };
  const instance = schema.createBlockInstanceV2(definition, {
    instanceId: 'instance-exact-route',
    position: { x: 0, y: 0 },
    size: { width: 480, height: 560 },
  });
  return { definition, instance, route };
}

test('registered Block V2 produces an exact route binding after parameter-only edits', async () => {
  const { instance, route } = fixture();
  instance.values.prompt = 'A workflow-specific prompt that does not change route identity.';
  instance.customization.state = 'parameters_changed';
  const binding = await bindingModule.registeredBlockResourceRouteBindingV2(instance, route, []);
  assert.deepEqual(binding, {
    schemaVersion: 1,
    admissionId: route.admissionId,
    blockDefinition: {
      definitionId: route.admissionId,
      contentHash: route.compiledDefinitionContentHash,
      canonicalSha256: route.compiledDefinitionCanonicalSha256,
    },
    studioExecutionSpec: route.studioExecutionSpec,
    artifact: { repository: route.artifact.repo, revision: route.artifact.revision },
    modelDependencies: [],
  });
  const graph = bindingModule.applyRegisteredBlockResourceRouteBindingV2(
    { sid: 'sid', nodes: {}, paths: [], provenance: { existing: true } },
    binding,
  );
  assert.equal(graph.provenance.existing, true);
  assert.deepEqual(graph.provenance.registeredBlockV2RouteBinding, binding);
});

test('stale compiled definitions and structural/interface customization stay unbound', async () => {
  const { instance, route } = fixture();
  assert.equal(
    await bindingModule.registeredBlockResourceRouteBindingV2(
      instance,
      {
        ...route,
        compiledDefinitionCanonicalSha256: `sha256:${'0'.repeat(64)}`,
      },
      [],
    ),
    null,
  );

  const structural = structuredClone(instance);
  structural.effectiveGraph.nodes[0].data.extra = true;
  structural.effectiveGraph.graphHash = schema.blockGraphHashV2(structural.effectiveGraph);
  structural.customization.state = 'structure_changed';
  structural.customization.effectiveGraphHash = structural.effectiveGraph.graphHash;
  assert.equal(await bindingModule.registeredBlockResourceRouteBindingV2(structural, route, []), null);

  const interfaceChanged = structuredClone(instance);
  interfaceChanged.effectiveInterface.controls[0].label = 'Workflow prompt';
  interfaceChanged.effectiveInterface.effectiveInterfaceHash = schema.blockInterfaceHashV2(
    interfaceChanged.effectiveInterface,
  );
  interfaceChanged.customization.state = 'structure_changed';
  assert.equal(await bindingModule.registeredBlockResourceRouteBindingV2(interfaceChanged, route, []), null);
});

test('reserved route provenance is stripped unless a fresh exact binding is supplied', async () => {
  const { instance, route } = fixture();
  const binding = await bindingModule.registeredBlockResourceRouteBindingV2(instance, route, []);
  const staleGraph = {
    sid: 'sid',
    nodes: {},
    paths: [],
    provenance: { existing: true, registeredBlockV2RouteBinding: { forged: true } },
  };
  const stripped = bindingModule.applyRegisteredBlockResourceRouteBindingV2(staleGraph, null);
  assert.equal(stripped.provenance.existing, true);
  assert.equal(stripped.provenance.registeredBlockV2RouteBinding, undefined);
  assert.deepEqual(staleGraph.provenance.registeredBlockV2RouteBinding, { forged: true });

  const rebound = bindingModule.applyRegisteredBlockResourceRouteBindingV2(staleGraph, binding);
  assert.deepEqual(rebound.provenance.registeredBlockV2RouteBinding, binding);
});

test('unavailable WebCrypto leaves Expert execution evidence unbound instead of throwing', async () => {
  const { instance, route } = fixture();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { subtle: { digest: async () => Promise.reject(new Error('WebCrypto unavailable')) } },
  });
  try {
    assert.equal(await bindingModule.registeredBlockResourceRouteBindingV2(instance, route, []), null);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
});
