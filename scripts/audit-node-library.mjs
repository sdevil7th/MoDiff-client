import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const backend = process.env.MODIFF_LIVE_BACKEND_URL ?? 'http://127.0.0.1:8088';
const output = path.resolve(process.argv[2] ?? path.join(root, 'artifacts/node-library-audit'));
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
globalThis.window = { localStorage: globalThis.localStorage, location: { origin: backend }, dispatchEvent: () => true };
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'silent',
  optimizeDeps: { entries: [], noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
try {
  const read = async (endpoint) => {
    const response = await fetch(`${backend}${endpoint}`, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
    return response.json();
  };
  const [registryResponse, rawLibrary, rawSnapshot, rawUserNodes] = await Promise.all([
    read('/nodes'),
    read('/huggingface/node-library'),
    read('/huggingface/modular-conditionals'),
    read('/studio/blocks'),
  ]);
  const registry = registryResponse.nodes;
  if (
    !registry ||
    typeof registry !== 'object' ||
    Object.values(registry).some((node) => !node || typeof node.module !== 'string' || typeof node.action !== 'string')
  )
    throw new Error('Invalid node registry response.');
  const libraryModule = await server.ssrLoadModule('/src/studio/huggingFaceNodeLibrary.ts');
  const conditionalModule = await server.ssrLoadModule('/src/studio/huggingFaceModularConditionals.ts');
  const catalog = await server.ssrLoadModule('/src/studio/huggingFaceNodeCatalog.ts');
  const runtime = await server.ssrLoadModule('/src/studio/nodeCatalog.ts');
  const audit = await server.ssrLoadModule('/src/studio/nodeLibraryAuditV2.ts');
  const userLibrary = await server.ssrLoadModule('/src/studio/userBlockLibrary.ts');
  const schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  const userBlocks = await server.ssrLoadModule('/src/studio/userBlocks.ts');
  if (!Array.isArray(rawUserNodes.blocks)) throw new Error('Invalid saved User Nodes response.');
  const saved = rawUserNodes.blocks.map((block) =>
    block.schemaVersion === 2
      ? schema.normalizeBlockDefinitionV2(block)
      : userBlocks.normalizeUserBlockDefinition(block),
  );
  const library = libraryModule.parseHuggingFaceNodeLibrary(rawLibrary);
  const snapshot = conditionalModule.parseHuggingFaceModularConditionalSnapshot(rawSnapshot);
  const sections = catalog.buildHuggingFaceCatalogSections(library, snapshot);
  const report = {
    checkedAt: new Date().toISOString(),
    ...audit.auditNodeLibraryV2(registry, sections),
    userNodes: audit.auditSavedUserNodesV2(saved),
    userNodeCategories: saved.map((block) => ({
      id: userLibrary.storedUserBlockId(block),
      name: userLibrary.storedUserBlockName(block),
      groupPath: userLibrary.storedUserBlockGroupPath(block),
    })),
    runtimeCategories: runtime
      .nodeCatalogEntries(registry)
      .map(({ key, label, groupPath }) => ({ key, label, groupPath })),
    catalogCategories: sections.flatMap((section) =>
      section.entries.map(({ id, label, groupPath }) => ({ section: section.label, id, label, groupPath })),
    ),
  };
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'node-library-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    '# Node library identity and categorization audit',
    '',
    `Checked ${report.checkedAt}. Read-only inventory of the running backend.`,
    '',
    `Runtime: ${report.runtimeEntries} entries, ${report.uniqueRuntimeContracts} distinct executable contracts, ${report.exactRuntimeAliases.length} proven alias groups.`,
    '',
    '| Segment | Entries | Unique identities | Placement contexts | Same-label candidate groups |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...report.sections.map(
      (section) =>
        `| ${section.label} | ${section.entries} | ${section.uniqueIdentities} | ${section.placementContexts} | ${section.sameLabelDifferentIdentities.length} |`,
    ),
    '',
    `User Nodes: ${report.userNodes.entries} saved definitions, ${report.userNodes.distinctSavedContracts} distinct saved contracts, ${report.userNodes.identicalSavedContractGroups.length} groups with identical saved graphs/interfaces/defaults. These are retained as separately named user-owned copies. The comparison retains node identities and legacy layout; additional equivalent copies may exist.`,
    '',
    '## Dispositions',
    '',
    ...report.decisions.map((decision) => `- ${decision}`),
    '',
    '## Exact runtime aliases',
    '',
    ...(report.exactRuntimeAliases.length
      ? report.exactRuntimeAliases.map((keys) => `- ${keys.join(', ')}`)
      : ['None found in the current registry.']),
    '',
    '## Scope of equivalence review',
    '',
    'The audit compares immutable catalog identities and complete runtime action/field/default contracts. Same-label candidates are listed in the JSON; they are not proven functional duplicates. Different algorithms, model variants, full workflows and their constituent steps remain available. No model inference or automatic removal of distinct implementations was performed.',
    '',
    'Full entry-to-category mapping and candidate identities: [node-library-audit.json](node-library-audit.json).',
    '',
  ];
  await writeFile(path.join(output, 'node-library-audit.md'), lines.join('\n'));
  console.log(
    JSON.stringify(
      {
        output,
        runtime: report.runtimeEntries,
        uniqueRuntime: report.uniqueRuntimeContracts,
        sections: report.sections.map(({ id, entries, uniqueIdentities, placementContexts }) => ({
          id,
          entries,
          uniqueIdentities,
          placementContexts,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
