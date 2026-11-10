import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createServer } from 'vite';

let server, parser, conditionals, catalog, fixture;
before(async () => {
  const backend = process.env.MODIFF_BACKEND_DIR || path.resolve('../MoDiff');
  const python =
    process.env.MODIFF_BACKEND_PYTHON ||
    path.join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  fixture = JSON.parse(
    execFileSync(
      python,
      [
        '-B',
        '-c',
        `
import json
from modiff.huggingface_node_library import build_huggingface_node_library
from modiff.modular_conditional_contracts import reviewed_modular_conditional_collection, reviewed_modular_conditional_snapshot
print(json.dumps({'mixed': build_huggingface_node_library(), 'legacy': build_huggingface_node_library(include_source_supplements=False), 'conditionals': reviewed_modular_conditional_collection(), 'legacyConditionals': reviewed_modular_conditional_snapshot()}))
`,
      ],
      {
        cwd: backend,
        encoding: 'utf8',
        timeout: 60_000,
        maxBuffer: 48 * 1024 ** 2,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1' },
      },
    ),
  );
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
  });
  parser = await server.ssrLoadModule('/src/studio/huggingFaceNodeLibrary.ts');
  conditionals = await server.ssrLoadModule('/src/studio/huggingFaceModularConditionals.ts');
  catalog = await server.ssrLoadModule('/src/studio/huggingFaceNodeCatalog.ts');
});
after(async () => {
  await server?.close();
});

test('actual mixed-source collection preserves all legacy definitions through the client parser', () => {
  const mixed = parser.parseHuggingFaceNodeLibrary(fixture.mixed);
  const legacy = parser.parseHuggingFaceNodeLibrary(fixture.legacy);
  assert.equal(mixed.schemaVersion, 7);
  assert.equal(legacy.schemaVersion, 6);
  assert.equal(mixed.diffusersRevision, legacy.diffusersRevision);
  assert.equal(mixed.sourceSupplements.length, 2);
  const image = mixed.sourceSupplements.find(
    (source) => source.runtimeProfileId === 'huggingface-diffusers-h3-image-875373a',
  );
  assert.equal(image.libraryRevision, '875373ac7f5856071e345a3e394c74efccc6b9e6');
  const imageDefinitions = mixed.definitions.filter((definition) => image.definitionIds.includes(definition.id));
  assert.deepEqual(imageDefinitions.map((definition) => definition.workflowId).sort(), [
    'image_conditioned',
    'text2image',
  ]);
  for (const definition of imageDefinitions) {
    assert.equal(definition.integrationStatus, 'contract_only');
    assert.equal(definition.pipelineClass, 'MiniMaxH3ImageModularPipeline');
    assert.deepEqual(definition.executionAdmissions, []);
  }
  for (const old of legacy.definitions) {
    assert.deepEqual(
      mixed.definitions.find((item) => item.id === old.id),
      old,
      old.id,
    );
  }
  const source = mixed.sourceSupplements[0];
  const added = mixed.definitions.filter((item) => source.definitionIds.includes(item.id));
  assert.equal(added.length, 3);
  assert.ok(added.every((item) => item.libraryRevision === source.libraryRevision));
  assert.ok(added.every((item) => item.executionClaim === 'discovery_only'));
  assert.ok(added.every((item) => item.schemaVersion === 6));
  assert.equal(Object.hasOwn(legacy, 'sourceSupplements'), false);
});

for (const mutation of [
  'missing',
  'revision',
  'duplicate',
  'membership',
  'unknown',
  'runtime-format',
  'member-version',
  'legacy-envelope',
]) {
  test(`mixed-source parsing rejects inconsistent ${mutation} metadata`, () => {
    const value = structuredClone(fixture.mixed);
    const source = value.sourceSupplements[0];
    if (mutation === 'missing') delete value.sourceSupplements;
    else if (mutation === 'revision') source.libraryRevision = value.diffusersRevision;
    else if (mutation === 'duplicate') value.sourceSupplements.push(structuredClone(source));
    else if (mutation === 'membership') source.definitionIds.push('diffusers.modular:UnknownPipeline:text2image');
    else if (mutation === 'unknown') source.runModels = true;
    else if (mutation === 'runtime-format') source.runtimeProfileId = 'outside/profile';
    else if (mutation === 'member-version') value.definitions[0].schemaVersion = 7;
    else {
      value.schemaVersion = 6;
      delete value.sourceSupplements;
    }
    assert.throws(() => parser.parseHuggingFaceNodeLibrary(value));
  });
}

test('mixed hierarchy selects the exact source while preserving every historical tree', () => {
  const mixed = conditionals.parseHuggingFaceModularConditionalSnapshot(fixture.conditionals);
  const legacy = conditionals.parseHuggingFaceModularConditionalSnapshot(fixture.legacyConditionals);
  const { sourceSupplements, ...base } = mixed;
  assert.deepEqual({ ...base, schemaVersion: 1 }, legacy);
  const pika = fixture.mixed.sourceSupplements[0];
  const selected = conditionals.modularConditionalSnapshotForSource(mixed, pika.libraryRevision);
  assert.equal(selected, sourceSupplements[0]);
  assert.deepEqual(
    selected.pipelines.map((item) => item.pipelineClass),
    ['PikaH3FlexModularPipeline'],
  );
  assert.equal(conditionals.modularConditionalSnapshotForSource(mixed, 'f'.repeat(40)), null);
  assert.equal(conditionals.modularConditionalSnapshotForSource(legacy, pika.libraryRevision), null);
  assert.equal(conditionals.modularConditionalSnapshotForSource(mixed, legacy.diffusersRevision), mixed);
  const library = parser.parseHuggingFaceNodeLibrary(fixture.mixed);
  const entries = catalog
    .buildHuggingFaceCatalogSections(library, mixed)
    .find((section) => section.id === 'modular_diffusers_block_nodes').entries;
  const contexts = entries
    .flatMap((entry) => entry.modularBlockContexts ?? [entry.modularBlockPlacement])
    .filter((context) => context.pipelineClass === selected.pipelines[0].pipelineClass);
  assert.equal(contexts.length, 43);
  assert.ok(contexts.every((context) => pika.definitionIds.includes(context.definitionId)));
});

for (const mutation of ['missing', 'duplicate', 'base-revision', 'nested', 'unknown', 'pipeline-conflict', 'boolean']) {
  test(`mixed hierarchy rejects ${mutation} source metadata`, () => {
    const value = structuredClone(fixture.conditionals);
    if (mutation === 'missing') delete value.sourceSupplements;
    else if (mutation === 'duplicate') value.sourceSupplements.push(structuredClone(value.sourceSupplements[0]));
    else if (mutation === 'base-revision') value.sourceSupplements[0].diffusersRevision = value.diffusersRevision;
    else if (mutation === 'nested') value.sourceSupplements[0] = structuredClone(fixture.conditionals);
    else if (mutation === 'unknown') value.sourceSupplements[0].execute = true;
    else if (mutation === 'pipeline-conflict') value.sourceSupplements[0].pipelines = structuredClone(value.pipelines);
    else value.schemaVersion = true;
    assert.throws(() => conditionals.parseHuggingFaceModularConditionalSnapshot(value));
  });
}
