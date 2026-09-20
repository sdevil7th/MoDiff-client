import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  backendSourceIdentity,
  createRunProvenance,
  selectInstalledModelIdentity,
  sha256Value,
} from '../../../scripts/live-proof-provenance.mjs';
import { decodedMediaHash } from '../../../scripts/template-gallery-harness.mjs';
import { startRuntimeResponsivenessProbe } from './runtimeResponsivenessProbe';

let runtimeProbe: ReturnType<typeof startRuntimeResponsivenessProbe> | null = null;
test.afterEach(async ({ page }, testInfo) => {
  if (!runtimeProbe) return;
  const samples = await runtimeProbe.stop();
  runtimeProbe = null;
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(`${testInfo.outputDir}/runtime-responsiveness.json`, JSON.stringify(samples, null, 2));
  if (testInfo.status === 'failed' && !page.isClosed()) {
    await testInfo.attach('runtime-probe-failure', { body: await page.screenshot(), contentType: 'image/png' });
  }
  expect(samples.filter((sample) => sample.error || sample.status !== 200)).toEqual([]);
  const active = samples.filter((sample) => sample.path === '/runtime/resources' && sample.taskId);
  expect(active.length).toBeGreaterThan(5);
  expect(
    active.every(
      (sample) =>
        sample.allocatorStatuses?.length &&
        sample.allocatorStatuses.every((status) => status === 'paused_during_execution'),
    ),
  ).toBe(true);
});

const LIVE_BACKEND_URL = process.env.MODIFF_LIVE_BACKEND_URL || 'http://127.0.0.1:8088';
const DEFINITION_ID = 'diffusers.cluster-admission:WanTI2VPipeline:text_to_video:mode:text_to_video';
const MANIFEST_DEFINITION_ID = 'diffusers.composite:WanTI2VPipeline:text_to_video';
const REPOSITORY = 'Wan-AI/Wan2.2-TI2V-5B-Diffusers';
const REVISION = 'b8fff7315c768468a5333511427288870b2e9635';
const CREATOR_PROMPT =
  'Two anthropomorphic cats in comfy boxing gear and bright gloves fight intensely on a spotlighted stage.';
const EDITED_PROMPT =
  'A fixed wide cinematic shot of a bright red tram moving continuously from left to right on coastal rails while foreground grass bends in the wind. Stable camera, consistent geometry, one uninterrupted shot.';
const SHOWCASE_PROMPT =
  'Single uninterrupted wide cinematic shot at golden hour: a bright red vintage tram travels steadily from left to right along coastal tracks while tall foreground grass bends continuously in the ocean wind, gulls cross slowly, and distant waves roll toward shore. Locked tripod camera with gentle natural parallax only, consistent tram geometry and background, smooth physically plausible motion, detailed 35mm film texture.';
const EXPECTED_ROUTE_BINDING = {
  schemaVersion: 1,
  admissionId: DEFINITION_ID,
  blockDefinition: {
    definitionId: DEFINITION_ID,
    contentHash: 'block-definition-v2-5a2c04d3',
    canonicalSha256: 'sha256:ad86ef2f9b3dd1701e700343449634596c8b2a327bcc9f8d08d6e9c2e55d544c',
  },
  studioExecutionSpec: {
    id: 'wan-22-ti2v-5b:text-to-video:v1',
    contentHash: 'studio-spec-v1-a83efd57',
    executionProfileId: 'wan-22-ti2v-5b:direct',
  },
  artifact: { repository: REPOSITORY, revision: REVISION },
  modelDependencies: [],
} as const;

const RUN_CORRELATION_HINT_KEYS = [
  'clientRunId',
  'runInputHash',
  'workflowTabId',
  'workflowCanvasEpoch',
  'workflowTitle',
  'workflowSnapshot',
  'nodeId',
] as const;

type BlockSnapshot = {
  instanceJson: string;
  definitionId: string;
  manifestDefinitionId: string | null;
  contentHash: string;
  repository: string | null;
  repositoryRevision: string | null;
  values: Record<string, unknown>;
  definitionDefaults: Record<string, unknown>;
  boundaryInputs: Array<{ portId: string; valueType: string }>;
  boundaryOutputs: Array<{ portId: string; valueType: string }>;
  internalLayout: Record<string, { x: number; y: number }>;
  projectionNodes: Array<{ id: string; semanticNodeId: string; position: { x: number; y: number } }>;
  projectionEdgeCount: number;
};

type ExecutionExport = {
  nodes: Record<string, { module?: string; action?: string; params?: Record<string, unknown> }>;
  paths: unknown[];
  deterministicMode?: unknown;
  provenance?: Record<string, unknown>;
  runtimeHints?: Record<string, unknown>;
};

type RegisteredRuntimeExpectation = {
  form: Record<string, unknown>;
  routeBinding: Record<string, unknown>;
  runtimeHints: Record<string, unknown>;
  targetNodeId: string | null;
};

type LiveStudioOutput = {
  taskId?: string;
  displayType?: string;
  mediaHash?: string;
  url?: string;
  metadata?: Record<string, unknown>;
  backendProvenance?: Record<string, unknown>;
  mediaItems?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

async function waitForWorkspace(page: Page, timeout = 300_000) {
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  const gate = page.getByTestId('startup-workspace-gate');
  const deadline = Date.now() + timeout;
  let lastGateText = '';
  let readySince: number | null = null;
  while (Date.now() < deadline) {
    if ((await gate.count()) === 0) {
      readySince ??= Date.now();
      if (Date.now() - readySince >= 2_000) return;
      await page.waitForTimeout(250);
      continue;
    }
    readySince = null;
    lastGateText = (await gate.textContent({ timeout: 500 }).catch(() => null))?.trim() || lastGateText;
    const retry = gate.getByRole('button', { name: 'Retry' });
    if (await retry.isVisible({ timeout: 250 }).catch(() => false)) await retry.click();
    await page.waitForTimeout(500);
  }
  throw new Error(`Workspace did not load within ${timeout}ms. Last startup message: ${lastGateText}`);
}

async function dismissTaskLauncher(page: Page, waitForAppearance = false) {
  const launcher = page.getByTestId('task-launcher');
  if (waitForAppearance) await launcher.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  const deadline = Date.now() + 15_000;
  let absentSince: number | null = null;
  while (Date.now() < deadline) {
    if (await launcher.isVisible().catch(() => false)) {
      absentSince = null;
      const close = launcher.getByRole('button', { name: 'Close' });
      if (await close.isVisible().catch(() => false)) await close.click();
      else await launcher.click({ position: { x: 4, y: 4 } });
      await page.waitForTimeout(250);
      continue;
    }
    absentSince ??= Date.now();
    if (Date.now() - absentSince >= 2_000) return;
    await page.waitForTimeout(250);
  }
  throw new Error('Task launcher did not remain dismissed.');
}

async function ensureExpertMode(page: Page) {
  const auto = page.getByRole('radio', { name: 'Creator', exact: true });
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  if ((await auto.getAttribute('aria-checked')) === 'true')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await expect(auto).toHaveAttribute('aria-checked', 'false');
}

async function fillAndCommit(field: Locator, value: string) {
  await field.fill(value);
  await field.blur();
  await expect(field).toHaveValue(value);
}

async function refreshCatalog(page: Page) {
  await page.evaluate(async () => {
    const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
    ]);
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useNodesStore.getState().fetchOptionalRuntimes(),
      useNodesStore.getState().refreshModelIndexes(false),
      useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
    ]);
  });
}

async function verifyExactModelThroughFrontend(page: Page, evidenceRoot: string) {
  type Capability = {
    modelType?: string;
    defaultRepo?: string;
    revisionCandidates?: string[];
    downloadFiles?: string[];
  };
  let capability: Capability | null = null;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${LIVE_BACKEND_URL}/model_capabilities`, { timeout: 30_000 });
        if (!response.ok()) return null;
        const body = (await response.json()) as { capabilities?: Capability[] };
        capability = body.capabilities?.find(({ modelType }) => modelType === 'WanTI2VPipeline') ?? null;
        return capability;
      },
      { timeout: 120_000, intervals: [500, 1000, 2000, 5000] },
    )
    .not.toBeNull();
  expect(capability).toMatchObject({ defaultRepo: REPOSITORY });
  expect(capability?.revisionCandidates).toContain(REVISION);
  expect(capability?.downloadFiles?.length).toBeGreaterThan(0);

  await page.evaluate(async () => {
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    await useNodesStore.getState().refreshModelIndexes(true);
  });
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  await page.getByTestId('topbar-models').click({ timeout: 5_000 });
  const manager = page.getByTestId('model-manager-dialog');
  await expect(manager).toBeVisible();
  const row = manager.locator(
    `[data-testid="model-manager-supported-WanTI2VPipeline"][data-model-repo="${REPOSITORY}"]`,
  );
  await expect(row).toBeVisible({ timeout: 60_000 });
  const install = row.getByTestId('model-manager-install-WanTI2VPipeline');
  if ((await install.textContent())?.trim() !== 'Ready') {
    const requestPromise = page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/hf_download' && request.method() === 'POST',
      { timeout: 120_000 },
    );
    await install.click();
    const request = await requestPromise;
    expect(request.postDataJSON()).toMatchObject({ repo_id: REPOSITORY, revision: REVISION });
    await expect(install).toHaveText('Ready', { timeout: 4 * 60 * 60 * 1000 });
  }
  await page.screenshot({ path: `${evidenceRoot}/frontend-model-ready.png`, fullPage: true });
  await manager.getByTestId('model-manager-close').click();
}

async function blockSnapshot(page: Page, instanceId: string): Promise<BlockSnapshot> {
  return page.evaluate(async (rootId) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const flow = useFlowStore.getState();
    const root = flow.nodes.find((node) => node.id === rootId);
    const instance = root?.data.blockInstanceV2;
    if (!root || !instance) throw new Error(`Block V2 root ${rootId} is unavailable.`);
    return {
      instanceJson: JSON.stringify(instance),
      definitionId: instance.definitionSnapshot.definitionId,
      manifestDefinitionId: instance.definitionSnapshot.source.manifestDefinitionId ?? null,
      contentHash: instance.definitionSnapshot.contentHash,
      repository: instance.definitionSnapshot.source.repository ?? null,
      repositoryRevision: instance.definitionSnapshot.source.repositoryRevision ?? null,
      values: JSON.parse(JSON.stringify(instance.values)) as Record<string, unknown>,
      definitionDefaults: Object.fromEntries(
        instance.definitionSnapshot.controls.map((control) => [control.controlId, control.defaultValue]),
      ),
      boundaryInputs: instance.effectiveInterface.boundary.inputs.map(({ portId, valueType }) => ({
        portId,
        valueType,
      })),
      boundaryOutputs: instance.effectiveInterface.boundary.outputs.map(({ portId, valueType }) => ({
        portId,
        valueType,
      })),
      internalLayout: JSON.parse(JSON.stringify(instance.presentation.internalLayout)) as Record<
        string,
        { x: number; y: number }
      >,
      projectionNodes: flow.nodes
        .filter((node) => node.data.blockProjectionOwnerId === rootId)
        .map((node) => ({
          id: node.id,
          semanticNodeId: node.data.blockProjectionNodeId ?? '',
          position: { ...node.position },
        }))
        .sort((left, right) => left.semanticNodeId.localeCompare(right.semanticNodeId)),
      projectionEdgeCount: flow.edges.filter((edge) => edge.data?.blockProjectionOwnerId === rootId).length,
    };
  }, instanceId);
}

async function exportFromBlock(page: Page, instanceId: string): Promise<ExecutionExport> {
  return page.evaluate(async (rootId) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const graph = useFlowStore.getState().exportGraph('wan-ti2v-v2-live-contract', rootId);
    return { nodes: graph.nodes, paths: graph.paths, deterministicMode: graph.deterministicMode } as ExecutionExport;
  }, instanceId);
}

async function registeredRuntimeExpectation(page: Page, instanceId: string): Promise<RegisteredRuntimeExpectation> {
  return page.evaluate(async (rootId) => {
    const [
      { useFlowStore, resolveFlowExecutionTargetNodeId },
      { useHuggingFaceNodeLibraryStore },
      { useNodesStore },
      { registeredBlockRunFormV2 },
      { registeredBlockResourceRouteBindingV2 },
      { registeredBlockExpertRuntimeHintsV2 },
    ] = await Promise.all([
      import('/src/stores/useFlowStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
      import('/src/stores/useNodeStore.ts'),
      import('/src/studio/blockRunFormV2.ts'),
      import('/src/studio/blockResourceRouteBindingV2.ts'),
      import('/src/studio/blockRuntimeHintsV2.ts'),
    ]);
    const flow = useFlowStore.getState();
    const root = flow.nodes.find((node) => node.id === rootId);
    if (!root?.data.blockInstanceV2) throw new Error(`Block V2 root ${rootId} is unavailable.`);
    const projection = registeredBlockRunFormV2(root.data.blockInstanceV2, 'expert');
    if (!projection) throw new Error(`Block V2 root ${rootId} does not resolve to an exact registered route.`);
    const admissions = (useHuggingFaceNodeLibraryStore.getState().library?.definitions ?? []).flatMap(
      (definition) => definition.executionAdmissions,
    );
    const matchingAdmissions = admissions.filter((admission) => admission.id === projection.route.admissionId);
    if (matchingAdmissions.length !== 1) {
      throw new Error(
        `Expected one execution admission for ${projection.route.admissionId}, found ${matchingAdmissions.length}.`,
      );
    }
    const admission = matchingAdmissions[0]!;
    const routeBinding = await registeredBlockResourceRouteBindingV2(
      projection.instance,
      projection.route,
      admission.modelDependencies,
    );
    if (!routeBinding) throw new Error(`Block V2 root ${rootId} did not produce an immutable route binding.`);
    const nodeState = useNodesStore.getState();
    const runtimeHints = registeredBlockExpertRuntimeHintsV2(
      {
        form: projection.form,
        instanceLabel: projection.instance.definitionSnapshot.displayName,
        route: projection.route,
        admission,
        routeBinding,
      },
      nodeState.studioModelCapabilities,
      {
        authoritative: nodeState.studioModelCapabilitiesAuthoritative,
        executionSpecInvalid: nodeState.studioExecutionSpecInvalid,
      },
    );
    if (!runtimeHints) {
      throw new Error(`Block V2 root ${rootId} did not produce exact per-instance Expert runtime hints.`);
    }
    return JSON.parse(
      JSON.stringify({
        form: projection.form,
        routeBinding,
        runtimeHints,
        targetNodeId: resolveFlowExecutionTargetNodeId(flow.nodes, rootId) ?? null,
      }),
    ) as RegisteredRuntimeExpectation;
  }, instanceId);
}

function withoutKeys(value: Record<string, unknown>, omitted: readonly string[]) {
  const omittedSet = new Set(omitted);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omittedSet.has(key)));
}

async function waitForTask(page: Page, taskId: string, timeout = 90 * 60 * 1000) {
  const deadline = Date.now() + timeout;
  let lastTask: { task_id?: string; status?: string; message?: string; error?: string; phase?: string } | null = null;
  while (Date.now() < deadline) {
    const response = await page.request.get(`${LIVE_BACKEND_URL}/queue`);
    if (response.ok()) {
      const queue = (await response.json()) as {
        current?: typeof lastTask;
        queued?: Record<string, NonNullable<typeof lastTask>>;
        recent?: Array<NonNullable<typeof lastTask>>;
      };
      lastTask =
        (queue.current?.task_id === taskId ? queue.current : null) ??
        Object.values(queue.queued ?? {}).find((task) => task.task_id === taskId) ??
        queue.recent?.find((task) => task.task_id === taskId) ??
        null;
    }
    if (lastTask?.status === 'completed') return lastTask;
    if (lastTask && ['failed', 'cancelled', 'canceled', 'interrupted'].includes(lastTask.status ?? '')) {
      throw new Error(
        `Wan V2 task ${taskId} became ${lastTask.status}: ${lastTask.error ?? lastTask.message ?? 'No failure detail.'}`,
      );
    }
    await page.waitForTimeout(2_000);
  }
  throw new Error(`Wan V2 task ${taskId} timed out. Last queue record: ${JSON.stringify(lastTask)}`);
}

async function findDurableCompletionReceipt(
  page: Page,
  taskId: string,
  websocketEvents: Array<Record<string, unknown>>,
) {
  const websocketReceipt = websocketEvents.find(
    (event) => event.type === 'graph_completed' && event.task_id === taskId,
  );
  if (websocketReceipt) return websocketReceipt;

  // The save/refresh lifecycle reconnects the browser websocket. Recover the
  // exact task-bound receipt from the durable run record if the ephemeral
  // completion frame raced that reconnect.
  const response = await page.request.get(`${LIVE_BACKEND_URL}/runs/${encodeURIComponent(taskId)}`);
  if (!response.ok()) return null;
  const body = (await response.json()) as {
    task?: {
      task_id?: string;
      status?: string;
      runtimeFingerprint?: unknown;
      runtimeMeasurement?: unknown;
      deterministicMode?: unknown;
    };
  };
  const task = body.task;
  if (task?.task_id !== taskId || task.status !== 'completed' || !task.runtimeFingerprint || !task.runtimeMeasurement) {
    return null;
  }
  return {
    type: 'graph_completed',
    task_id: taskId,
    runtimeFingerprint: task.runtimeFingerprint,
    runtimeMeasurement: task.runtimeMeasurement,
    deterministicMode: task.deterministicMode,
    recoveredFrom: 'durable_run_record',
  } satisfies Record<string, unknown>;
}

test('exact Wan TI2V catalog drag is one durable V2 Block and generates video after save and refresh', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_WAN_V2_CONTRACT !== '1',
    'Select the installed exact Wan TI2V Block V2 contract explicitly with MODIFF_RUN_WAN_V2_CONTRACT=1.',
  );
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!outputDirectory, 'MODIFF_REVIEW_OUTPUT_DIR is required so the live proof is preserved for review.');
  const lifecycleOnly = process.env.MODIFF_WAN_V2_LIFECYCLE_ONLY === '1';
  const showcaseCandidate = process.env.MODIFF_WAN_V2_SHOWCASE === '1';
  const workload = showcaseCandidate
    ? { prompt: SHOWCASE_PROMPT, width: 1280, height: 704, frames: 121, steps: 50 }
    : { prompt: EDITED_PROMPT, width: 480, height: 288, frames: 25, steps: 6 };
  test.setTimeout(6 * 60 * 60 * 1000);
  page.setDefaultTimeout(30_000);
  const evidenceRoot = `${outputDirectory}/${showcaseCandidate ? 'wan-22-ti2v-5b-showcase-candidate' : 'wan-22-ti2v-5b-block-v2-live'}`;
  await mkdir(evidenceRoot, { recursive: true });
  const backendRoot = process.env.MODIFF_BACKEND_DIR
    ? resolve(process.env.MODIFF_BACKEND_DIR)
    : resolve(process.cwd(), '..', 'MoDiff');
  const backendSourceBefore = backendSourceIdentity(backendRoot);

  const pageErrors: string[] = [];
  const handleWarnings: string[] = [];
  const websocketEvents: Array<Record<string, unknown>> = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (text.includes("[React Flow]: Couldn't create edge for")) handleWarnings.push(text);
  });
  page.on('websocket', (websocket) => {
    websocket.on('framereceived', ({ payload }) => {
      try {
        websocketEvents.push(JSON.parse(String(payload)) as Record<string, unknown>);
      } catch {
        // Binary progress frames are not execution receipts.
      }
    });
  });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('wan-v2-video-live-contract')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('wan-v2-video-live-contract', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  await ensureExpertMode(page);
  await refreshCatalog(page);
  await waitForWorkspace(page);
  await verifyExactModelThroughFrontend(page, evidenceRoot);

  await page.getByTestId('topbar-new-workflow').click();
  await waitForWorkspace(page);
  await dismissTaskLauncher(page, true);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 60_000 });
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
    await group.getByRole('button').first().click();
  }
  await page.getByLabel('Search nodes').fill('Wan 2.2 TI2V 5B — Text to Video');
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Wan 2.2 TI2V 5B — Text to Video' });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
  await expect(row).toHaveAttribute('draggable', 'true');
  await row.dragTo(page.locator('.react-flow__pane'), { targetPosition: { x: 650, y: 180 }, timeout: 30_000 });

  const root = page.locator('.react-flow__node-block').filter({ has: page.locator('[data-block-schema-version="2"]') });
  await expect(root).toHaveCount(1, { timeout: 180_000 });
  const rootId = await root.getAttribute('data-id');
  expect(rootId).toBeTruthy();
  await expect(page.locator('[data-cluster-role]')).toHaveCount(0);
  await expect(root.getByLabel('prompt', { exact: true })).toHaveValue(CREATOR_PROMPT);
  await expect(root.getByTestId(`node-handle-${rootId}-prompt`)).toBeVisible();
  await expect(root.getByTestId(`node-handle-${rootId}-video`)).toBeVisible();

  const beforeEdit = await blockSnapshot(page, rootId!);
  expect(beforeEdit).toMatchObject({
    definitionId: DEFINITION_ID,
    manifestDefinitionId: MANIFEST_DEFINITION_ID,
    repository: REPOSITORY,
    repositoryRevision: REVISION,
    values: { prompt: CREATOR_PROMPT },
    boundaryOutputs: [{ portId: 'video', valueType: 'video' }],
  });
  expect(String(beforeEdit.values.width)).toBe('1280');
  expect(String(beforeEdit.values.height)).toBe('704');
  expect(String(beforeEdit.values.num_frames)).toBe('121');
  expect(String(beforeEdit.values.num_inference_steps)).toBe('50');
  expect(beforeEdit.definitionDefaults).toMatchObject({
    width: 1280,
    height: 704,
    num_frames: 121,
    num_inference_steps: 50,
  });
  const definitionDefaultsJson = JSON.stringify(beforeEdit.definitionDefaults);

  // These are workflow-instance edits for a bounded lifecycle proof. They do
  // not mutate the registered definition defaults captured above.
  await fillAndCommit(root.getByLabel('prompt', { exact: true }), workload.prompt);
  await fillAndCommit(root.getByLabel('width', { exact: true }), String(workload.width));
  await fillAndCommit(root.getByLabel('height', { exact: true }), String(workload.height));
  await fillAndCommit(root.getByLabel('num frames', { exact: true }), String(workload.frames));
  await fillAndCommit(root.getByLabel('num inference steps', { exact: true }), String(workload.steps));
  const afterEdit = await blockSnapshot(page, rootId!);
  expect(afterEdit.values).toMatchObject({
    prompt: workload.prompt,
    width: String(workload.width),
    height: String(workload.height),
    num_frames: String(workload.frames),
    num_inference_steps: String(workload.steps),
  });
  const proofEditIds = new Set(['prompt', 'width', 'height', 'num_frames', 'num_inference_steps']);
  const valuesOutsideProofEdits = (values: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(values).filter(([logicalId]) => !proofEditIds.has(logicalId)));
  expect(valuesOutsideProofEdits(afterEdit.values)).toEqual(valuesOutsideProofEdits(beforeEdit.values));
  expect(JSON.stringify(afterEdit.definitionDefaults)).toBe(definitionDefaultsJson);

  const collapsedExport = await exportFromBlock(page, rootId!);
  expect(Object.keys(collapsedExport.nodes)).toHaveLength(5);
  expect(Object.keys(collapsedExport.nodes)).not.toContain(rootId);
  expect(JSON.stringify(collapsedExport.nodes)).not.toContain('blockInstanceV2');
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  await expect.poll(async () => (await blockSnapshot(page, rootId!)).projectionNodes.length).toBe(5);
  const expanded = await blockSnapshot(page, rootId!);
  const viewport = page.viewportSize();
  let movedSemanticNodeId = '';
  let dragBounds: Awaited<ReturnType<Locator['boundingBox']>> = null;
  for (const projection of expanded.projectionNodes) {
    const candidateBounds = await page
      .locator(`.react-flow__node[data-id="${projection.id}"]`)
      .locator('header')
      .first()
      .boundingBox();
    if (
      candidateBounds &&
      viewport &&
      candidateBounds.x >= 0 &&
      candidateBounds.y >= 0 &&
      candidateBounds.x + 96 < viewport.width &&
      candidateBounds.y + 24 < viewport.height
    ) {
      movedSemanticNodeId = projection.semanticNodeId;
      dragBounds = candidateBounds;
      break;
    }
  }
  expect(movedSemanticNodeId).not.toBe('');
  expect(dragBounds).toBeTruthy();
  const dragStart = { x: dragBounds!.x + 80, y: dragBounds!.y + 18 };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x - 48, dragStart.y + 36, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await blockSnapshot(page, rootId!)).internalLayout[movedSemanticNodeId])
    .not.toEqual(expanded.internalLayout[movedSemanticNodeId]);
  const movedLayout = (await blockSnapshot(page, rootId!)).internalLayout[movedSemanticNodeId];
  expect(await exportFromBlock(page, rootId!)).toEqual(collapsedExport);
  await root.getByTestId(`user-block-toggle-${rootId}`).click();

  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill(`Wan TI2V Block V2 Live ${Date.now()}`);
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await expect
    .poll(() =>
      page.evaluate(() => {
        const studio = window.__MODIFF_E2E__!.getState().studio;
        return studio.workflowTabs.find((tab: { id: string }) => tab.id === studio.activeWorkflowTabId)?.dirty;
      }),
    )
    .toBe(false);
  await writeFile(
    `${evidenceRoot}/before-refresh.json`,
    `${JSON.stringify({ schemaVersion: 1, beforeEdit, afterEdit, collapsedExport }, null, 2)}\n`,
    'utf8',
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  await ensureExpertMode(page);
  const restored = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
  await expect(restored).toHaveCount(1);
  await expect(restored.getByLabel('prompt', { exact: true })).toHaveValue(workload.prompt);
  await expect(restored.getByLabel('width', { exact: true })).toHaveValue(String(workload.width));
  await expect(restored.getByLabel('height', { exact: true })).toHaveValue(String(workload.height));
  await expect(restored.getByLabel('num frames', { exact: true })).toHaveValue(String(workload.frames));
  await expect(restored.getByLabel('num inference steps', { exact: true })).toHaveValue(String(workload.steps));
  const afterRefresh = await blockSnapshot(page, rootId!);
  expect(afterRefresh.values).toEqual(afterEdit.values);
  expect(afterRefresh.internalLayout[movedSemanticNodeId]).toEqual(movedLayout);
  expect(JSON.stringify(afterRefresh.definitionDefaults)).toBe(definitionDefaultsJson);
  expect(await exportFromBlock(page, rootId!)).toEqual(collapsedExport);
  await restored.getByTestId(`user-block-toggle-${rootId}`).click();
  await expect.poll(async () => (await blockSnapshot(page, rootId!)).projectionNodes.length).toBe(5);
  expect(await exportFromBlock(page, rootId!)).toEqual(collapsedExport);
  await restored.getByTestId(`user-block-toggle-${rootId}`).click();

  await page.screenshot({ path: `${evidenceRoot}/frontend-after-refresh.png`, fullPage: false });
  await writeFile(
    `${evidenceRoot}/frontend-lifecycle.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        model: { repository: REPOSITORY, revision: REVISION },
        definitionId: DEFINITION_ID,
        contentHash: afterRefresh.contentHash,
        creatorPrompt: CREATOR_PROMPT,
        definitionDefaults: afterRefresh.definitionDefaults,
        insertedStarterValues: beforeEdit.values,
        workflowOnlyProofEdits: {
          prompt: workload.prompt,
          width: workload.width,
          height: workload.height,
          num_frames: workload.frames,
          num_inference_steps: workload.steps,
        },
        valuesAfterEdits: afterRefresh.values,
        valuesOutsideProofEditsUnchanged:
          JSON.stringify(valuesOutsideProofEdits(afterRefresh.values)) ===
          JSON.stringify(valuesOutsideProofEdits(beforeEdit.values)),
        definitionDefaultsUnchanged: JSON.stringify(afterRefresh.definitionDefaults) === definitionDefaultsJson,
        collapsedExpandedExecutionEquivalent: true,
        executionDeferred: lifecycleOnly,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  if (lifecycleOnly) {
    expect(handleWarnings).toEqual([]);
    expect(pageErrors).toEqual([]);
    return;
  }

  const runtimeExpectation = await registeredRuntimeExpectation(page, rootId!);
  expect(runtimeExpectation.routeBinding).toEqual(EXPECTED_ROUTE_BINDING);
  expect(runtimeExpectation.targetNodeId).toBeTruthy();
  expect(runtimeExpectation.form).toMatchObject({
    modelType: 'WanTI2VPipeline',
    mode: 'text_to_video',
    prompt: workload.prompt,
    width: workload.width,
    height: workload.height,
    numFrames: workload.frames,
    steps: workload.steps,
    dtype: 'bfloat16',
    resourceMode: 'expert',
    quantizationMode: 'none',
    autoOffload: true,
    offloadMode: 'model_cpu',
  });
  expect(runtimeExpectation.runtimeHints).toMatchObject({
    source: 'hugging-face-cluster',
    device: 'cuda:0',
    modelType: 'WanTI2VPipeline',
    mode: 'text_to_video',
    modelRepo: REPOSITORY,
    resolvedModelRepo: REPOSITORY,
    resolvedArtifact: REPOSITORY,
    modelDependencies: [],
    loaderModule: 'modules.DiffusersVideo',
    loaderAction: 'LoadPipeline',
    executionPath: 'direct-diffusers-video',
    pipelineClass: 'WanTI2VPipeline',
    dtype: 'bfloat16',
    resourceMode: 'expert',
    resolvedResourceMode: 'expert',
    quantizationMode: 'none',
    quantizedComponents: [],
    autoOffload: true,
    offloadMode: 'model_cpu',
    supportedOffloadModes: ['none', 'model_cpu', 'sequential_cpu', 'group_cpu', 'group_disk'],
    resourceRetryModes: ['model_cpu', 'group_cpu', 'group_disk'],
    compatibilityStatus: 'expert',
  });
  expect(Object.hasOwn(runtimeExpectation.runtimeHints, 'attentionBackend')).toBe(false);
  expect(runtimeExpectation.runtimeHints.optimizationQualificationForm).toEqual(runtimeExpectation.form);

  await restored.locator('header').first().click();
  if (process.env.MODIFF_VERIFY_RUNTIME_RESPONSIVENESS === '1') {
    runtimeProbe = startRuntimeResponsivenessProbe(LIVE_BACKEND_URL);
  }
  const submission = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/graph' && response.request().method() === 'POST',
    { timeout: 180_000 },
  );
  await page.getByTestId('selection-toolbar-run-from-node').click();
  const response = await submission;
  if (!response.ok())
    throw new Error(`Wan V2 graph submission failed (${response.status()}): ${await response.text()}`);
  await expect(page.getByRole('dialog', { name: 'Run blocked' })).toHaveCount(0);
  if (runtimeProbe) {
    await page.getByTestId('topbar-resource-monitor').click();
    await expect(page.getByTestId('topbar-resource-popover')).toContainText(
      'Allocator readings are paused during generation',
      { timeout: 20_000 },
    );
    await page.screenshot({ path: `${evidenceRoot}/resource-monitor-during-run.png`, fullPage: false });
    await page.keyboard.press('Escape');
  }
  const submittedGraph = response.request().postDataJSON() as ExecutionExport;
  expect(Object.keys(submittedGraph.nodes)).toHaveLength(5);
  expect(JSON.stringify(submittedGraph.nodes)).toContain(workload.prompt);
  expect(JSON.stringify(submittedGraph.nodes)).not.toContain('blockInstanceV2');
  expect(submittedGraph.provenance?.registeredBlockV2RouteBinding).toEqual(EXPECTED_ROUTE_BINDING);
  const submittedRuntimeHints = submittedGraph.runtimeHints ?? {};
  expect(withoutKeys(submittedRuntimeHints, RUN_CORRELATION_HINT_KEYS)).toEqual(runtimeExpectation.runtimeHints);
  expect(submittedRuntimeHints.optimizationQualificationForm).toEqual(runtimeExpectation.form);
  expect(submittedRuntimeHints).toMatchObject({
    clientRunId: expect.any(String),
    runInputHash: expect.any(String),
    workflowTabId: expect.any(String),
    workflowCanvasEpoch: expect.any(Number),
    workflowTitle: expect.any(String),
    workflowSnapshot: { studioForm: runtimeExpectation.form },
    nodeId: runtimeExpectation.targetNodeId,
  });
  expect(
    Object.keys(submittedRuntimeHints)
      .filter((key) => !Object.hasOwn(runtimeExpectation.runtimeHints, key))
      .sort(),
  ).toEqual([...RUN_CORRELATION_HINT_KEYS].sort());
  const submitted = (await response.json()) as { task_id?: string };
  expect(submitted.task_id).toBeTruthy();
  const taskId = submitted.task_id!;
  const task = await waitForTask(page, taskId);

  let output: LiveStudioOutput | null = null;
  await expect
    .poll(
      async () => {
        const outputResponse = await page.request.get(`${LIVE_BACKEND_URL}/runs/${encodeURIComponent(taskId)}`);
        if (!outputResponse.ok()) return null;
        const body = (await outputResponse.json()) as { outputs?: LiveStudioOutput[] };
        output = body.outputs?.find((item) => item.taskId === taskId && item.displayType === 'video') ?? null;
        return output ? { taskId: output.taskId, displayType: output.displayType } : null;
      },
      { timeout: 120_000, intervals: [500, 1000, 2000] },
    )
    .toEqual({ taskId, displayType: 'video' });
  const outputUrl = typeof output?.url === 'string' ? output.url : '';
  expect(outputUrl).toBeTruthy();
  const assetResponse = await page.request.get(new URL(outputUrl, LIVE_BACKEND_URL).toString());
  expect(assetResponse.ok()).toBe(true);
  const assetBytes = await assetResponse.body();
  const outputFilename = showcaseCandidate ? 'wan-ti2v-showcase-candidate.mp4' : 'wan-ti2v-block-v2-live.mp4';
  const videoPath = `${evidenceRoot}/${outputFilename}`;
  await writeFile(videoPath, assetBytes);
  try {
    await page.screenshot({
      path: `${evidenceRoot}/frontend-after-run.png`,
      fullPage: false,
      timeout: 120_000,
    });
  } catch (error) {
    // Screenshot capture is review-only; decoded video and immutable execution
    // provenance remain the qualification boundary.
    await writeFile(
      `${evidenceRoot}/frontend-screenshot-warning.txt`,
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      'utf8',
    );
  }

  await expect
    .poll(() => findDurableCompletionReceipt(page, taskId, websocketEvents), { timeout: 30_000 })
    .toBeTruthy();
  const completionReceipt = (await findDurableCompletionReceipt(page, taskId, websocketEvents))!;
  expect(completionReceipt.runtimeFingerprint).toBeTruthy();
  expect(completionReceipt.runtimeMeasurement).toBeTruthy();

  const nodesResponse = await page.request.get(`${LIVE_BACKEND_URL}/nodes`);
  expect(nodesResponse.ok()).toBe(true);
  const nodesPayload = (await nodesResponse.json()) as Record<string, unknown>;
  const modelResponse = await page.request.get(
    `${LIVE_BACKEND_URL}/model_fingerprints?repo=${encodeURIComponent(REPOSITORY)}`,
  );
  expect(modelResponse.ok()).toBe(true);
  const modelFingerprintPayload = (await modelResponse.json()) as Record<string, unknown>;
  const modelIdentity = selectInstalledModelIdentity(modelFingerprintPayload, REPOSITORY);
  expect(modelIdentity).toMatchObject({
    repoId: REPOSITORY,
    selectedRevision: REVISION,
    modelRevision: `${REPOSITORY}@${REVISION}`,
  });
  expect(modelIdentity?.fingerprint).toBeTruthy();
  if (!modelIdentity) throw new Error(`The exact installed model fingerprint for ${REPOSITORY}@${REVISION} is absent.`);

  const decodedVideo = (await decodedMediaHash(videoPath, 'video')) as {
    width: number;
    height: number;
    frames: number;
    durationSeconds: number;
    hasAudio: boolean;
    embeddedAudio?: { hash?: string } | null;
    audiovisualMediaHash?: string | null;
    hash: string;
    [key: string]: unknown;
  };
  expect(decodedVideo).toMatchObject({
    width: workload.width,
    height: workload.height,
    frames: workload.frames,
    hasAudio: false,
  });
  expect(decodedVideo.durationSeconds).toBeGreaterThan(0);
  expect(decodedVideo.hash).toMatch(/^sha256:decoded-video-framemd5:[a-f0-9]{64}$/u);
  const outputAnalysis = {
    ok: assetBytes.byteLength > 0,
    outputCount: 1,
    analyses: [
      {
        ...decodedVideo,
        mediaType: 'video',
        byteSize: assetBytes.byteLength,
        encodedSha256: `sha256:encoded:${createHash('sha256').update(assetBytes).digest('hex')}`,
        decodedSha256: decodedVideo.hash,
      },
    ],
  };
  expect(outputAnalysis).toMatchObject({ ok: true, outputCount: 1 });

  const backendSourceAfter = backendSourceIdentity(backendRoot);
  expect(backendSourceAfter.fingerprint).toBe(backendSourceBefore.fingerprint);
  const routeBinding = submittedGraph.provenance?.registeredBlockV2RouteBinding as Record<string, unknown>;
  const lockedSettings = afterRefresh.values;
  const promptSettingsHash = sha256Value('block-v2-workload-values-v1', lockedSettings);
  const catalogTemplateLockHash = EXPECTED_ROUTE_BINDING.blockDefinition.canonicalSha256;
  const resolvedTemplateLockHash = sha256Value('block-v2-route-template-lock-v1', {
    routeBinding,
    modelRevision: modelIdentity.modelRevision,
    lockedSettings,
  });
  const runProvenance = createRunProvenance({
    templateId: DEFINITION_ID,
    lockedSettings,
    promptSettingsHash,
    catalogTemplateLockHash,
    resolvedTemplateLockHash,
    apiGraph: submittedGraph,
    nodesPayload,
    modelIdentity,
    modelIdentities: [modelIdentity],
    inputArtifacts: [],
    runtimeFingerprint: completionReceipt.runtimeFingerprint,
    deterministicMode: completionReceipt.deterministicMode ?? submittedGraph.deterministicMode,
    backendSource: backendSourceBefore,
    outputAnalysis,
    executedOutput: { ...output, apiGraphSnapshot: submittedGraph },
    executionReceipt: completionReceipt,
    taskId,
    expectedOutput: { width: workload.width, height: workload.height, frames: workload.frames },
  });
  expect(runProvenance.schemaVersion).toBe(2);
  expect(runProvenance.routeBinding).toEqual(EXPECTED_ROUTE_BINDING);
  expect(runProvenance.blockers).toEqual([]);
  await writeFile(`${evidenceRoot}/backend-source-before.json`, `${JSON.stringify(backendSourceBefore, null, 2)}\n`);
  await writeFile(`${evidenceRoot}/backend-source-after.json`, `${JSON.stringify(backendSourceAfter, null, 2)}\n`);
  await writeFile(`${evidenceRoot}/backend-nodes.json`, `${JSON.stringify(nodesPayload, null, 2)}\n`);
  await writeFile(
    `${evidenceRoot}/model-fingerprint.json`,
    `${JSON.stringify({ query: modelFingerprintPayload, selected: modelIdentity }, null, 2)}\n`,
  );
  await writeFile(`${evidenceRoot}/run-provenance.json`, `${JSON.stringify(runProvenance, null, 2)}\n`);
  await writeFile(
    `${evidenceRoot}/frontend-result.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        model: { repository: REPOSITORY, revision: REVISION },
        definitionId: DEFINITION_ID,
        contentHash: afterRefresh.contentHash,
        creatorPrompt: CREATOR_PROMPT,
        definitionDefaults: afterRefresh.definitionDefaults,
        insertedStarterValues: beforeEdit.values,
        workflowOnlyProofEdits: {
          prompt: workload.prompt,
          width: workload.width,
          height: workload.height,
          num_frames: workload.frames,
          num_inference_steps: workload.steps,
        },
        valuesAfterEdits: afterRefresh.values,
        valuesOutsideProofEditsUnchanged:
          JSON.stringify(valuesOutsideProofEdits(afterRefresh.values)) ===
          JSON.stringify(valuesOutsideProofEdits(beforeEdit.values)),
        definitionDefaultsUnchanged: JSON.stringify(afterRefresh.definitionDefaults) === definitionDefaultsJson,
        collapsedExpandedExecutionEquivalent: true,
        submittedGraph,
        registeredBlockV2RouteBinding: routeBinding,
        exactPerInstanceRuntimeHints: runtimeExpectation.runtimeHints,
        task,
        graphCompleted: completionReceipt,
        output,
        decodedVideo,
        runProvenance,
        outputFilename,
        qualificationOnly: !showcaseCandidate,
        showcaseCandidate,
        showcaseApproved: false,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  expect(handleWarnings).toEqual([]);
  expect(pageErrors).toEqual([]);
});
