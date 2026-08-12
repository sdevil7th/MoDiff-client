import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { canonicalJsonHash as hash, stableJsonValue as stable } from './canonical-json.mjs';
import { normalizePortableWorkflowNodeOffload } from './workflow-library-contract.mjs';

const ROOT = process.cwd();
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(ROOT, '..', 'MoDiff'));
const OUTPUT_ROOT = join(BACKEND_ROOT, 'data', 'graphs', 'studio');
const EXPERIMENTAL_OUTPUT_ROOT = join(BACKEND_ROOT, 'data', 'graphs', 'experimental');
const MANIFEST_PATH = join(BACKEND_ROOT, 'data', 'workflow-library-manifest.json');

function qualificationDimensions(qualificationStatus) {
  const hasExecutionEvidence = String(qualificationStatus).startsWith('execution-qualified');
  return {
    graphQualificationStatus: qualificationStatus,
    runtimeQualificationStatus: hasExecutionEvidence ? 'observed-on-recorded-platform' : 'unqualified',
    optimizationQualificationStatus: 'unqualified',
    qualifiedRuntimeProfiles: [],
    qualificationScope: 'exact-model-recipe-runtime-hardware',
  };
}
const BACKEND_URL = process.env.MODIFF_SERVER || 'http://127.0.0.1:8088';
const FRONTEND_URL = process.env.MODIFF_FRONTEND || 'http://127.0.0.1:5173';
const LAYOUT_ALGORITHM = 'modiff-layered-v1';
const LAYOUT_HORIZONTAL_GAP = 140;
const LAYOUT_VERTICAL_GAP = 72;
const pairArgument = process.argv.find((argument) => argument.startsWith('--pair='));
const requestedPair = pairArgument?.slice('--pair='.length) ?? null;
if (requestedPair && !/^[A-Za-z\d_]+\|[a-z\d_]+$/.test(requestedPair)) {
  throw new Error('The workflow pair must use --pair=ModelType|mode.');
}

function slug(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

const DROP_KEYS = new Set([
  'artifacts',
  'clientRunId',
  'createdAt',
  'current_node',
  'currentNode',
  'hfCache',
  'previewHistory',
  'progress',
  'runInputHash',
  'selected',
  'sid',
  'task_id',
  'taskId',
  'updatedAt',
]);

const GENERATED_PREVIEW_DISPLAYS = new Set(['ui_image', 'ui_video', 'ui_audio', 'ui_text']);

function sanitize(value, key = '', ancestors = []) {
  if (DROP_KEYS.has(key)) return undefined;
  if (key === 'preview' && !ancestors.includes('params')) return undefined;
  if (typeof value === 'string') {
    if (/^(?:cuda|mps|cpu)(?::\d+)?$/i.test(value)) {
      if (
        key === 'options' ||
        key === 'device' ||
        key === 'device_map' ||
        ancestors.includes('device') ||
        ancestors.includes('device_map')
      )
        return value;
      return 'cpu:0';
    }
    if (/^(?:file:\/\/|\/(?:home|Users|root|tmp|mnt|workspace)(?:\/|$)|[A-Za-z]:[\\/]|\\\\)/i.test(value)) return '';
    if (/\/cache\//i.test(value) || /127\.0\.0\.1|localhost/i.test(value)) return '';
    return value;
  }
  if (Array.isArray(value))
    return value.map((item) => sanitize(item, key, ancestors)).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  const isGeneratedPreviewField = typeof value.display === 'string' && GENERATED_PREVIEW_DISPLAYS.has(value.display);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([childKey]) => !isGeneratedPreviewField || childKey !== 'value')
      .map(([childKey, child]) => [childKey, sanitize(child, childKey, [...ancestors, key])])
      .filter(([, child]) => child !== undefined),
  );
}

function applyPortableContracts(graph, mode) {
  for (const node of graph?.nodes ?? []) {
    normalizePortableWorkflowNodeOffload(node);
    if (node?.data?.module === 'modules.DiffusersImage' && node?.data?.action === 'LoadPipeline') {
      node.data.params = node.data.params ?? {};
      node.data.params.mode = { ...(node.data.params.mode ?? {}), value: mode };
    }
    if (node?.data?.module === 'modules.DiffusersAudio' && node?.data?.action === 'LoadPipeline') {
      node.data.params = node.data.params ?? {};
      node.data.params.mode = { ...(node.data.params.mode ?? {}), value: mode };
    }
    if (
      node?.data?.module === 'modules.DiffusersRuntime' &&
      node?.data?.action === 'DiffusersExecutionRecipe' &&
      node?.data?.params?.device_map?.value === 'cuda'
    ) {
      node.data.params.device = { ...(node.data.params.device ?? {}), value: 'cuda:0' };
    }
  }
  return graph;
}

function canonicalizeGraphIds(graph) {
  const nodes = [...(graph?.nodes ?? [])].sort((left, right) => {
    const leftKey = `${left?.data?.studioRole ?? ''}|${left?.data?.module ?? ''}|${left?.data?.action ?? ''}|${left?.position?.y ?? 0}|${left?.position?.x ?? 0}`;
    const rightKey = `${right?.data?.studioRole ?? ''}|${right?.data?.module ?? ''}|${right?.data?.action ?? ''}|${right?.position?.y ?? 0}|${right?.position?.x ?? 0}`;
    return leftKey.localeCompare(rightKey) || String(left?.id ?? '').localeCompare(String(right?.id ?? ''));
  });
  const ids = new Map(nodes.map((node, index) => [node.id, `node-${String(index + 1).padStart(2, '0')}`]));
  graph.nodes = nodes.map((node) => ({
    ...node,
    id: ids.get(node.id),
    ...(node.parentId ? { parentId: ids.get(node.parentId) } : {}),
  }));
  graph.edges = [...(graph?.edges ?? [])]
    .map((edge) => ({ ...edge, source: ids.get(edge.source), target: ids.get(edge.target) }))
    .sort((left, right) =>
      `${left.source}|${left.sourceHandle}|${left.target}|${left.targetHandle}`.localeCompare(
        `${right.source}|${right.sourceHandle}|${right.target}|${right.targetHandle}`,
      ),
    )
    .map((edge, index) => ({ ...edge, id: `edge-${String(index + 1).padStart(2, '0')}` }));
  return graph;
}

function graphLayoutSignature(graph) {
  return stable(
    [...(graph?.nodes ?? [])]
      .map((node) => ({
        id: node.id,
        parentId: node.parentId ?? null,
        position: node.position,
        width: node.width ?? null,
        height: node.height ?? null,
        measured: node.measured ?? null,
      }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
  );
}

function addLayoutMetadata(graph) {
  graph.layout = {
    algorithm: LAYOUT_ALGORITHM,
    horizontalGap: LAYOUT_HORIZONTAL_GAP,
    verticalGap: LAYOUT_VERTICAL_GAP,
    positionHash: hash(graphLayoutSignature(graph)),
  };
  return graph;
}

export async function installEphemeralWorkflowStorage(page) {
  await page.addInitScript(() => {
    const generatedGraphKeys = new Set(['modiff.studio', 'modiff.flow']);
    const originalSetItem = Storage.prototype.setItem;

    Storage.prototype.setItem = function setEphemeralWorkflowItem(key, value) {
      if (this === localStorage && generatedGraphKeys.has(String(key))) return;
      return originalSetItem.call(this, key, value);
    };

    for (const key of generatedGraphKeys) {
      localStorage.removeItem(key);
    }
  });
}

async function loadCapabilities() {
  const response = await fetch(`${BACKEND_URL}/model_capabilities`);
  if (!response.ok) throw new Error(`Capability request failed: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.schemaVersion !== 2 || !Array.isArray(payload.capabilities)) {
    throw new Error('Backend must expose /model_capabilities schemaVersion 2.');
  }
  return payload;
}

async function main() {
  const capabilities = await loadCapabilities();
  const selectedCapabilities = requestedPair
    ? capabilities.capabilities.filter((capability) =>
        (capability.runnableModes ?? []).some((mode) => `${capability.modelType}|${mode}` === requestedPair),
      )
    : capabilities.capabilities;
  if (requestedPair && selectedCapabilities.length !== 1) {
    throw new Error(`The requested workflow pair is not uniquely runnable: ${requestedPair}.`);
  }
  const installedChrome = join(
    process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright'),
    'chromium-1228',
    'chrome-linux64',
    'chrome',
  );
  const browser = await chromium.launch({
    headless: true,
    ...(existsSync(installedChrome) ? { executablePath: installedChrome } : {}),
  });
  const page = await browser.newPage();
  try {
    // Canonical generation intentionally exercises the real application graph
    // assembly path, but it is not a user editing session. Suppress only the
    // two large persisted graph documents before Zustand hydrates so building
    // one template cannot consume browser quota while the next is assembled.
    // Production browser sessions retain their normal persistence behavior.
    await installEphemeralWorkflowStorage(page);
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
    // A fresh Vite page can expose the E2E bridge before node/model discovery
    // settles. Use the same app-owned refresh path as gallery qualification so
    // graph generation never races an empty node registry.
    await page.evaluate(() => window.__MODIFF_E2E__?.refreshModelIndexes());
    // Include blocked planning templates here so graph contracts remain
    // portable and migration-safe even when the browser correctly hides an
    // execution path that has not passed live qualification yet.
    let templates = [];
    let byPair = new Map();
    let missingPairs = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      templates = await page.evaluate(() => window.__MODIFF_E2E__?.listTemplates(true) ?? []);
      byPair = new Map();
      for (const template of templates) {
        const pair = `${template.modelType}|${template.mode}`;
        const current = byPair.get(pair);
        const isLoraVariant = template.category === 'lora';
        const currentIsLoraVariant = current?.category === 'lora';
        if (!current || (currentIsLoraVariant && !isLoraVariant)) byPair.set(pair, template);
      }
      missingPairs = selectedCapabilities.flatMap((capability) =>
        (capability.runnableModes ?? [])
          .map((mode) => `${capability.modelType}|${mode}`)
          .filter((pair) => !byPair.has(pair)),
      );
      if (missingPairs.length === 0) break;
      if (attempt < 3) await page.waitForTimeout(500);
    }
    if (missingPairs.length > 0) {
      throw new Error(`No Studio template can build: ${missingPairs.join(', ')}.`);
    }
    let records = [];
    let experimentalRecords = [];
    if (requestedPair && existsSync(MANIFEST_PATH)) {
      const existingManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
      const retainOtherCanonicalPairs = (record) =>
        record.variant || `${record.modelType}|${record.mode}` !== requestedPair;
      records = (existingManifest.workflows ?? []).filter(retainOtherCanonicalPairs);
      experimentalRecords = (existingManifest.experimentalWorkflows ?? []).filter(retainOtherCanonicalPairs);
    }

    const arrangeSnapshot = async (graph) => {
      const arranged = await page.evaluate(
        (snapshot) => window.__MODIFF_E2E__?.arrangeWorkflowGraphSnapshot(snapshot),
        graph,
      );
      if (!arranged || !Array.isArray(arranged.nodes) || !Array.isArray(arranged.edges)) {
        throw new Error('The frontend did not expose a usable canonical workflow layout hook.');
      }
      return arranged;
    };

    const finalizeCanonicalGraph = async (graph) => {
      const arrangedBeforeCanonicalIds = await arrangeSnapshot(graph);
      const canonical = canonicalizeGraphIds(arrangedBeforeCanonicalIds);
      const arranged = await arrangeSnapshot(canonical);
      const repeated = await arrangeSnapshot(arranged);
      if (JSON.stringify(graphLayoutSignature(arranged)) !== JSON.stringify(graphLayoutSignature(repeated))) {
        throw new Error('Canonical graph layout did not reach a deterministic fixed point.');
      }
      return stable(addLayoutMetadata(repeated));
    };

    const buildTemplateGraph = async (template, mode, description) => {
      let buildError = null;
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          await page.evaluate((templateId) => window.__MODIFF_E2E__?.applyTemplate(templateId), template.id);
          buildError = null;
          break;
        } catch (error) {
          buildError = error;
          if (attempt < 4) await page.waitForTimeout(1_000);
        }
      }
      if (buildError) {
        throw new Error(
          `Could not build ${description} from template ${template.id}: ${buildError instanceof Error ? buildError.message : buildError}`,
        );
      }
      const exported = await page.evaluate(() => window.__MODIFF_E2E__?.prepareWorkflowGraphForExport());
      if (!exported || !Array.isArray(exported.nodes) || !Array.isArray(exported.edges)) {
        throw new Error(`Could not export a completed graph for ${description}.`);
      }
      return finalizeCanonicalGraph(applyPortableContracts(sanitize(exported), mode));
    };

    if (!requestedPair) {
      rmSync(OUTPUT_ROOT, { recursive: true, force: true });
      rmSync(EXPERIMENTAL_OUTPUT_ROOT, { recursive: true, force: true });
    }
    for (const capability of selectedCapabilities) {
      for (const mode of capability.runnableModes ?? []) {
        const pair = `${capability.modelType}|${mode}`;
        if (requestedPair && pair !== requestedPair) continue;
        const template = byPair.get(pair);
        if (!template) throw new Error(`No Studio template can build ${pair}.`);
        const graph = await buildTemplateGraph(template, mode, `canonical workflow ${pair}`);
        const graphHash = hash(graph);
        const isSupported = capability.supportTier === 'supported';
        const libraryTier = isSupported ? 'studio' : 'experimental';
        const relativePath = join(libraryTier, slug(capability.modelType), `${slug(mode)}.json`).replaceAll('\\', '/');
        const outputPath = join(BACKEND_ROOT, 'data', 'graphs', relativePath);
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, `${JSON.stringify(graph, null, 2)}\n`);
        const qualificationStatus = Array.isArray(capability.qualifiedModes)
          ? capability.qualifiedModes.includes(mode)
            ? 'execution-qualified-gallery-review-pending'
            : 'graph-qualified-execution-pending'
          : (capability.qualificationStatus ?? 'graph-qualified');
        const record = {
          id: `${capability.modelType}:${mode}`,
          modelType: capability.modelType,
          modelFamily: capability.family,
          mode,
          mediaKind: capability.mediaKind,
          supportTier: capability.supportTier,
          qualificationStatus,
          ...qualificationDimensions(qualificationStatus),
          requiredArtifacts: [capability.defaultRepo].filter(Boolean),
          requiredInputs: capability.inputContracts?.[mode] ?? [],
          pipelineClasses: capability.pipelineClasses ?? [],
          sourceTemplateId: template.id,
          minimumAppVersion: '0.2.0',
          minimumBackendVersion: '0.2.0',
          graphPath: relativePath,
          graphHash,
        };
        (isSupported ? records : experimentalRecords).push(record);
      }
    }

    const capabilitiesByType = new Map(
      capabilities.capabilities.map((capability) => [capability.modelType, capability]),
    );
    for (const template of requestedPair ? [] : templates.filter((candidate) => candidate.category === 'lora')) {
      const capability = capabilitiesByType.get(template.modelType);
      if (!capability?.runnableModes?.includes(template.mode)) {
        throw new Error(
          `LoRA template ${template.id} has no runnable capability for ${template.modelType}|${template.mode}.`,
        );
      }
      const graph = await buildTemplateGraph(template, template.mode, `LoRA workflow variant`);
      const graphHash = hash(graph);
      const isSupported = capability.supportTier === 'supported';
      const libraryTier = isSupported ? 'studio' : 'experimental';
      const relativePath = join(
        libraryTier,
        slug(capability.modelType),
        `${slug(template.mode)}--${slug(template.id)}.json`,
      ).replaceAll('\\', '/');
      const outputPath = join(BACKEND_ROOT, 'data', 'graphs', relativePath);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(graph, null, 2)}\n`);
      const adapterNode = graph.nodes.find(
        (node) =>
          (node?.data?.module === 'modules.DiffusersImage' && node?.data?.action === 'LoadAdapter') ||
          (node?.data?.module === 'modules.ModularDiffusers' && node?.data?.action === 'Lora'),
      );
      const adapterSelection =
        adapterNode?.data?.params?.adapter_path?.value ?? adapterNode?.data?.params?.lora_path?.value;
      const adapterRepo =
        adapterSelection && typeof adapterSelection === 'object' ? adapterSelection.value : adapterSelection;
      const qualificationStatus = 'graph-qualified-gallery-review-pending';
      const record = {
        id: `${capability.modelType}:${template.mode}:${template.id}`,
        modelType: capability.modelType,
        modelFamily: capability.family,
        mode: template.mode,
        mediaKind: capability.mediaKind,
        supportTier: capability.supportTier,
        qualificationStatus,
        ...qualificationDimensions(qualificationStatus),
        variant: 'lora-theme',
        requiredArtifacts: [capability.defaultRepo, adapterRepo].filter(Boolean),
        requiredInputs: capability.inputContracts?.[template.mode] ?? [],
        pipelineClasses: capability.pipelineClasses ?? [],
        sourceTemplateId: template.id,
        minimumAppVersion: '0.2.0',
        minimumBackendVersion: '0.2.0',
        graphPath: relativePath,
        graphHash,
      };
      (isSupported ? records : experimentalRecords).push(record);
    }

    records.sort((left, right) => left.id.localeCompare(right.id));
    const manifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      capabilitySchemaVersion: capabilities.schemaVersion,
      capabilitySource: capabilities.source,
      supportedCanonicalPairCount: capabilities.capabilities.reduce(
        (total, capability) => total + (capability.runnableModes?.length ?? 0),
        0,
      ),
      supportedPairCount: records.length,
      workflows: records,
      experimentalWorkflowCount: experimentalRecords.length,
      experimentalWorkflows: experimentalRecords,
    };
    mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(
      `Generated ${records.length} supported and ${experimentalRecords.length} qualified experimental portable workflows.\n`,
    );
  } finally {
    await browser.close();
  }
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    [
      'Generate portable Studio workflows from a running MoDiff capability registry.',
      '',
      'Environment:',
      '  MODIFF_SERVER       Backend URL (default http://127.0.0.1:8088)',
      '  MODIFF_FRONTEND     Client URL (default http://127.0.0.1:5173)',
      '  MODIFF_BACKEND_DIR  Backend repository root (default ../MoDiff)',
      '',
      'Options:',
      '  --pair=ModelType|mode  Regenerate one canonical pair and merge it into the manifest.',
      '',
      'Full generation replaces both graph catalogs and the workflow manifest; --pair updates only that canonical pair.',
    ].join('\n') + '\n',
  );
} else {
  await main();
}
