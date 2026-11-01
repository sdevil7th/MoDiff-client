import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createServer } from 'vite';

let server, parser, fixture;
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
print(json.dumps({'mixed': build_huggingface_node_library(), 'legacy': build_huggingface_node_library(include_source_supplements=False)}))
`,
      ],
      {
        cwd: backend,
        encoding: 'utf8',
        timeout: 60_000,
        maxBuffer: 24 * 1024 ** 2,
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
  assert.equal(mixed.sourceSupplements.length, 1);
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
