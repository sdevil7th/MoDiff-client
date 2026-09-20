import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const WAN_ANIMATE_2_BASE_QUALIFICATION = {
  modelType: 'WanAnimate2ModularPipeline',
  displayName: 'Wan Animate 2',
  label: 'Wan Animate2 — Character Animate',
  repo: 'Wan-AI/Wan2.2-Animate-2-14B-Diffusers',
  revision: '7d48412d7b903ff3a89f4f5a960d99e1899605a1',
  evidenceDirectory: 'wan-animate-2-base-live',
  workflowName: 'Wan Animate 2 Base Live Qualification',
  guidanceScale: 3,
} as const;

const WAN_ANIMATE_2_DISTILLED_QUALIFICATION = {
  modelType: 'WanAnimate2DistilledModularPipeline',
  displayName: 'Wan Animate 2 Distilled',
  label: 'Wan Animate2 Distilled — Character Animate',
  repo: 'Wan-AI/Wan2.2-Animate-2-14B-Distilled-Diffusers',
  revision: '59e4141466bcb1bf9733eca1bc78be6891c9fbdf',
  evidenceDirectory: 'wan-animate-2-distilled-live',
  workflowName: 'Wan Animate 2 Distilled Live Qualification',
  guidanceScale: 1,
} as const;

function wanAnimate2QualificationVariant(baseRequested: boolean) {
  return baseRequested ? WAN_ANIMATE_2_BASE_QUALIFICATION : WAN_ANIMATE_2_DISTILLED_QUALIFICATION;
}

async function waitForWorkspaceStartup(page: Page, timeout = 300_000) {
  const startedAt = Date.now();
  const deadline = Date.now() + timeout;
  const gate = page.getByTestId('startup-workspace-gate');
  let lastMessage = '';
  let diagnosticsReported = false;
  while (Date.now() < deadline) {
    if ((await gate.count()) === 0) return;
    lastMessage = (await gate.textContent({ timeout: 250 }).catch(() => null))?.trim() || lastMessage;
    if (!diagnosticsReported && Date.now() - startedAt >= 30_000) {
      diagnosticsReported = true;
      const diagnostics = await page.evaluate(async () => {
        const [{ useNodesStore }, { useStudioStore }, { useTaskStore }] = await Promise.all([
          import('/src/stores/useNodeStore.ts'),
          import('/src/stores/useStudioStore.ts'),
          import('/src/stores/useTaskStore.ts'),
        ]);
        const nodes = useNodesStore.getState();
        const studio = useStudioStore.getState();
        const tasks = useTaskStore.getState();
        return {
          discoveryRequests: nodes.discoveryRequests,
          workflowCanvasHydrated: studio.workflowCanvasHydrated,
          resourceMode: studio.form.resourceMode,
          graphBinding: studio.graphBinding,
          autoResourcePlan: studio.autoResourcePlan,
          taskCount: tasks.taskCount,
          currentTask: tasks.currentTask,
          queueFetchState: tasks.fetchState,
        };
      });
      console.log('Workspace startup diagnostics', JSON.stringify(diagnostics));
    }
    const retry = gate.getByRole('button', { name: 'Retry' });
    if (await retry.isVisible({ timeout: 250 }).catch(() => false)) {
      await retry.click();
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Workspace startup did not recover within ${timeout}ms. Last gate: ${lastMessage}`);
}

async function clearFinishedSessionActivity(page: Page) {
  const activity = page.getByRole('region', { name: 'Session activity' });
  if (!(await activity.isVisible().catch(() => false))) return;
  const clear = activity.getByRole('button', { name: 'Clear' });
  if (await clear.isVisible().catch(() => false)) await clear.click();
}

async function startCleanWorkflow(page: Page) {
  await page.getByTestId('topbar-new-workflow').click();
  await expect(page.locator('[data-cluster-role="root"]')).toHaveCount(0);
}

async function waitForLiveTaskCompletion(page: Page, taskId: string, timeout: number) {
  const deadline = Date.now() + timeout;
  let lastTask: { task_id?: string; status?: string; message?: string } | null = null;
  while (Date.now() < deadline) {
    const response = await page.request.get('/queue', { timeout: 10_000 });
    if (!response.ok()) throw new Error(`Could not inspect live task ${taskId}: queue returned ${response.status()}.`);
    const queue = (await response.json()) as {
      current?: { task_id?: string; status?: string; message?: string } | null;
      queued?: Record<string, { task_id?: string; status?: string; message?: string }>;
      recent?: Array<{ task_id?: string; status?: string; message?: string }>;
    };
    lastTask =
      (queue.current?.task_id === taskId ? queue.current : null) ??
      Object.values(queue.queued ?? {}).find((task) => task.task_id === taskId) ??
      queue.recent?.find((task) => task.task_id === taskId) ??
      null;
    if (lastTask?.status === 'completed') return lastTask;
    if (lastTask && ['failed', 'cancelled', 'canceled', 'interrupted'].includes(lastTask.status ?? '')) {
      throw new Error(
        `Live task ${taskId} became ${lastTask.status}: ${lastTask.message ?? 'No backend failure message was provided.'}`,
      );
    }
    await page.waitForTimeout(2_000);
  }
  throw new Error(`Live task ${taskId} did not complete within ${timeout}ms. Last task: ${JSON.stringify(lastTask)}`);
}

async function waitForModelManagerReady(install: Locator, timeout: number) {
  const deadline = Date.now() + timeout;
  let lastLabel = '';
  while (Date.now() < deadline) {
    const label = (await install.textContent({ timeout: 1_000 }).catch(() => null))?.trim() ?? '';
    lastLabel = label || lastLabel;
    if (label === 'Ready') return;
    if (label === 'Retry') {
      const message =
        (await install.getAttribute('title')) ??
        (await install.getAttribute('aria-label')) ??
        'Model Manager reported a terminal install failure.';
      throw new Error(`Model Manager install failed: ${message}`);
    }
    await install.page().waitForTimeout(1_000);
  }
  throw new Error(`Model Manager did not become Ready within ${timeout}ms. Last state: ${lastLabel}`);
}

test('live Qwen text-to-image same-family model selection preserves graph state across refresh', async ({ page }) => {
  test.skip(
    process.env.MODIFF_RUN_QWEN_FAMILY_SWITCH !== '1',
    'The real Qwen same-family selector lifecycle must be selected explicitly.',
  );
  test.setTimeout(8 * 60 * 1000);
  const evidenceRoot = process.env.MODIFF_QWEN_FAMILY_SWITCH_EVIDENCE_ROOT;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('qwen-family-switch-live')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('qwen-family-switch-live', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('topbar-new-workflow').click();
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible({ timeout: 1_000 }).catch(() => false)) await advanced.click();
  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
    await group.getByRole('button').first().click();
  }
  await page.getByLabel('Search nodes').fill('Qwen Image — Text To Image');
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await row.click();
  const inserted = page
    .locator('.react-flow__node-block')
    .filter({ has: page.locator('[data-block-schema-version="2"]') })
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(inserted).toBeVisible({ timeout: 180_000 });
  const rootId = await inserted.getAttribute('data-id');
  expect(rootId).toBeTruthy();
  const root = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
  const instance = () =>
    page.evaluate((id) => {
      const node = window.__MODIFF_E2E__!.getState().flow.nodes.find((candidate) => candidate.id === id);
      if (!node?.blockInstanceV2) throw new Error(`Qwen Block ${id} is unavailable.`);
      return node.blockInstanceV2;
    }, rootId!);

  const prompt =
    'Same-family persistence proof: an intricate copper observatory above a blue cloud canyon, cinematic daylight.';
  await root.getByLabel('prompt', { exact: true }).fill(prompt);
  await root.getByLabel('prompt', { exact: true }).blur();
  const before = await instance();
  await expect(root.getByTestId(`block-v2-route-select-${rootId}`)).toHaveCount(0);
  const modelSelector = root.getByLabel('Model', { exact: true });
  await expect(modelSelector).toBeVisible({ timeout: 30_000 });
  await modelSelector.click();
  const modelOptions = page.getByRole('option');
  await expect(modelOptions).toHaveText(['Qwen/Qwen-Image', 'Qwen/Qwen-Image-2512']);
  await expect(page.getByRole('option', { name: /Edit/u })).toHaveCount(0);
  if (evidenceRoot)
    await page.screenshot({ path: `${evidenceRoot}/00-qwen-collapsed-model-selector.png`, fullPage: false });
  await page.getByRole('option', { name: 'Qwen/Qwen-Image', exact: true }).click();
  await expect.poll(async () => (await instance()).values.modelVariant).toBe('Qwen/Qwen-Image');
  const switched = await instance();
  expect(switched.definitionRef).toEqual(before.definitionRef);
  expect(switched.definitionSnapshot).toEqual(before.definitionSnapshot);
  expect(switched.effectiveGraph).toEqual(before.effectiveGraph);
  expect(switched.effectiveInterface).toEqual(before.effectiveInterface);
  expect(switched.presentation).toEqual(before.presentation);
  expect(switched.values.prompt).toBe(prompt);
  expect(
    Object.keys({ ...before.values, ...switched.values }).filter(
      (key) => key !== 'modelVariant' && JSON.stringify(before.values[key]) !== JSON.stringify(switched.values[key]),
    ),
  ).toEqual([]);
  if (evidenceRoot)
    await page.screenshot({ path: `${evidenceRoot}/01-qwen-base-selected-collapsed.png`, fullPage: false });

  const workflowName = `Qwen Same Family ${Date.now()}`;
  const savedTabId = await page.evaluate(() => window.__MODIFF_E2E__!.getState().studio.activeWorkflowTabId);
  expect(savedTabId).toBeTruthy();
  await page.getByTestId('topbar-save-workflow').click();
  const dialog = page.getByTestId('save-workflow-dialog');
  if (await dialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill(workflowName);
    await page.getByTestId('confirm-save-workflow').click();
    await expect(dialog).toHaveCount(0);
  }
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = window.__MODIFF_E2E__!.getState().studio;
        return state.workflowTabs.find((tab) => tab.id === state.activeWorkflowTabId)?.dirty;
      }),
    )
    .toBe(false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  // A concurrently running backend task may restore its own workflow tab as
  // active. Persistence belongs to the exact saved tab, so select it before
  // asserting the same root identity and instance payload.
  // A workflow that already has a save target keeps its existing name and
  // legitimately bypasses the naming modal. Follow its identity, not a name
  // that was only requested if that modal appeared.
  const savedTab = page.getByTestId(`workflow-tab-${savedTabId}`);
  await expect(savedTab).toBeVisible({ timeout: 180_000 });
  await savedTab.click();
  const restoredRoot = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
  await expect(restoredRoot).toBeVisible({ timeout: 180_000 });
  const restored = await instance();
  expect(restored.values.modelVariant).toBe('Qwen/Qwen-Image');
  expect(restored.values.prompt).toBe(prompt);
  expect(restored.definitionRef).toEqual(before.definitionRef);
  expect(restored.effectiveGraph).toEqual(before.effectiveGraph);
  expect(restored.presentation).toEqual(before.presentation);

  await restoredRoot.getByTestId(`user-block-toggle-${rootId}`).click();
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          window.__MODIFF_E2E__!.getState().flow.nodes.filter((node) => node.blockProjectionOwnerId === id).length,
        rootId!,
      ),
    )
    // Root-only expansion reveals loader, preview and three collapsed Blocks;
    // execution's fourteen leaves are not fourteen visible top-level children.
    .toBe(5);
  const loaderId = await page.evaluate((id) => {
    return window
      .__MODIFF_E2E__!.getState()
      .flow.nodes.find((node) => node.blockProjectionOwnerId === id && node.blockProjectionNodeId === 'models')?.id;
  }, rootId!);
  expect(loaderId).toBeTruthy();
  const loader = page.locator(`.react-flow__node-custom[data-id="${loaderId}"]`);
  await expect(loader.getByLabel('Model', { exact: true })).toContainText('Qwen/Qwen-Image');
  if (evidenceRoot)
    await page.screenshot({ path: `${evidenceRoot}/02-qwen-base-restored-expanded.png`, fullPage: false });
  // Initial expansion measures each collapsed container's connector tray.
  // Compare checkpoint edits to the settled expanded view, not to unmeasured
  // compact catalog boxes from before the first expansion.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      ),
  );
  const beforeExpandedSwitch = await instance();
  await loader.getByLabel('Model', { exact: true }).click();
  await page.getByRole('option', { name: 'Qwen/Qwen-Image-2512', exact: true }).click();
  await expect.poll(async () => (await instance()).values.modelVariant).toBe('Qwen/Qwen-Image-2512');
  const restoredTo2512 = await instance();
  expect(restoredTo2512.effectiveGraph).toEqual(before.effectiveGraph);
  expect(restoredTo2512.presentation).toEqual(beforeExpandedSwitch.presentation);
  expect(restoredTo2512.effectiveInterface).toEqual(beforeExpandedSwitch.effectiveInterface);
  expect(
    Object.keys({ ...beforeExpandedSwitch.values, ...restoredTo2512.values }).filter(
      (key) =>
        key !== 'modelVariant' &&
        JSON.stringify(beforeExpandedSwitch.values[key]) !== JSON.stringify(restoredTo2512.values[key]),
    ),
  ).toEqual([]);
  expect(restoredTo2512.values.prompt).toBe(prompt);
  if (evidenceRoot)
    await writeFile(
      `${evidenceRoot}/same-family-lifecycle.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          cluster: 'Qwen Image — Text To Image',
          modelOptions: ['Qwen/Qwen-Image', 'Qwen/Qwen-Image-2512'],
          excludedModels: ['Qwen/Qwen-Image-Edit-2511'],
          savedModel: restored.values.modelVariant,
          finalModel: restoredTo2512.values.modelVariant,
          prompt,
          semanticNodeCount: (before.effectiveGraph as { nodes: unknown[] }).nodes.length,
          visibleChildrenAfterRootExpansion: 5,
          definitionPreserved: true,
          graphPreserved: true,
          interfacePreserved: true,
          layoutPreserved: true,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
});

declare global {
  interface Window {
    __MODIFF_E2E__?: {
      getState: () => {
        flow: {
          nodes: Array<{
            id: string;
            module: string;
            action: string;
            params: Record<string, { value?: unknown; options?: unknown }>;
            studioOwned?: boolean;
            blockProjectionOwnerId?: string;
            blockProjectionNodeId?: string;
            blockInstanceV2?: {
              definitionRef: unknown;
              definitionSnapshot: unknown;
              effectiveGraph: unknown;
              effectiveInterface: unknown;
              presentation: { internalLayout: unknown };
              values: Record<string, unknown>;
            };
          }>;
          edges: Array<{ source: string; sourceHandle?: string; target: string; targetHandle?: string }>;
          historyPast: number;
        };
        websocket: { sid?: string | null; isConnected: boolean };
        studio: {
          activeWorkflowTabId: string | null;
          workflowTabs: Array<{ id: string; dirty: boolean }>;
          form: { modelType: string; mode: string };
          graphFinalization: { status: string };
        };
        settings: { rightPanelTab: string };
      };
      applyTaskTemplateSkeleton: (templateId: string, formOverrides?: Record<string, unknown>) => Promise<void>;
      refreshTaskTemplateContracts: () => Promise<number>;
      setGraphScenarioForTest: (scenario: 'disconnected_image_output') => void;
    };
  }
}

test('live generic family graphs refresh backend parameters for exact model selections', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().websocket.isConnected), {
      timeout: 30_000,
    })
    .toBe(true);
  await page.evaluate(() => window.__MODIFF_E2E__!.refreshTaskTemplateContracts());

  const applyAndInspect = async (templateId: string) =>
    page.evaluate(async (id) => {
      await window.__MODIFF_E2E__!.applyTaskTemplateSkeleton(id, {
        resourceMode: 'expert',
        device: 'cuda:0',
      });
      const state = window.__MODIFF_E2E__!.getState();
      return {
        form: state.studio.form,
        finalization: state.studio.graphFinalization,
        nodes: state.flow.nodes
          .filter((node) => node.studioOwned)
          .map((node) => ({
            module: node.module,
            action: node.action,
            params: Object.fromEntries(Object.entries(node.params).map(([key, field]) => [key, field.value])),
          })),
      };
    }, templateId);

  const pairs = [
    {
      family: 'image',
      templates: [
        'task-template:hunyuan-dit-v1-2-distilled:text-to-image:v1',
        'task-template:pixart-sigma-1024:text-to-image:v1',
      ],
      module: 'modules.DiffusersImage',
    },
    {
      family: 'video',
      templates: ['task-template:cogvideox-2b:text-to-video:v1', 'task-template:sana-video-480p:text-to-video:v1'],
      module: 'modules.DiffusersVideo',
    },
    {
      family: 'audio',
      templates: [
        'task-template:audioldm2-base:text-to-audio:v1',
        'task-template:longcat-audio-dit-1b:text-to-audio:v1',
      ],
      module: 'modules.DiffusersAudio',
    },
  ] as const;

  for (const pair of pairs) {
    const first = await applyAndInspect(pair.templates[0]);
    const second = await applyAndInspect(pair.templates[1]);
    expect(first.finalization.status, `${pair.family} first graph`).toBe('complete');
    expect(second.finalization.status, `${pair.family} second graph`).toBe('complete');
    expect(
      first.nodes.some((node) => node.module === pair.module),
      `${pair.family} first generic module`,
    ).toBe(true);
    expect(
      second.nodes.some((node) => node.module === pair.module),
      `${pair.family} second generic module`,
    ).toBe(true);
    expect(second.form.modelType).not.toBe(first.form.modelType);
    expect(second.nodes, `${pair.family} backend-selected parameter contract`).not.toEqual(first.nodes);
  }

  for (const single of [
    ['task-template:shap-e:text-to-3d:v1', 'modules.DiffusersThreeD'],
    ['task-template:real-esrgan-x2-image-upscale:v1', 'modules.Spandrel'],
    ['task-template:smollm2-135m-instruct:text-generation:v1', 'modules.HuggingFaceTransformers'],
  ] as const) {
    const snapshot = await applyAndInspect(single[0]);
    expect(snapshot.finalization.status).toBe('complete');
    expect(snapshot.nodes.some((node) => node.module === single[1])).toBe(true);
    expect(snapshot.nodes.every((node) => !node.module.includes(snapshot.form.modelType))).toBe(true);
  }
});

test('live registered text-to-image Block switches Qwen, FLUX, and SDXL routes without losing drafts', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_BLOCK_ROUTE_SWITCH_V1 !== '1',
    'The real registered route-switch lifecycle must be selected explicitly.',
  );
  const generateThroughFrontend = process.env.MODIFF_RUN_BLOCK_ROUTE_SWITCH_V1_GENERATION === '1';
  const saveCopyThroughFrontend = process.env.MODIFF_RUN_BLOCK_ROUTE_SWITCH_V1_SAVE_COPY === '1';
  const geometryScreenshotPath = process.env.MODIFF_BLOCK_GEOMETRY_SCREENSHOT_PATH;
  const geometryScreenshotOnly = process.env.MODIFF_BLOCK_GEOMETRY_SCREENSHOT_ONLY === '1';
  if (geometryScreenshotPath) await page.setViewportSize({ width: 1920, height: 1080 });
  const generationRoute =
    process.env.MODIFF_BLOCK_ROUTE_GENERATION_TARGET === 'sdxl-base-1.0'
      ? {
          key: 'sdxl-base-1.0',
          label: 'Stable Diffusion XL 1.0',
          title: 'Stable Diffusion XL — Text To Image',
          pipelineClass: 'StableDiffusionXLModularPipeline',
          repository: 'stabilityai/stable-diffusion-xl-base-1.0',
          revision: '462165984030d82259a11f4367a4eed129e94a7b',
          dtype: 'float16',
          filename: 'sdxl-route-switch-v1.webp',
          prompt:
            'An immense tidal observatory carved into pale limestone above a restless sapphire sea, brass astronomical instruments, suspended glass walkways, tiny researchers in weatherproof red coats, layered storm light, crisp editorial architectural photography, precise material texture and natural scale.',
          width: 1024,
          height: 1024,
          steps: 30,
          guidanceScale: 5,
          seed: 161803,
        }
      : {
          key: 'flux-1-dev',
          label: 'FLUX.1 Dev',
          title: 'Flux — Text To Image',
          pipelineClass: 'FluxModularPipeline',
          repository: 'black-forest-labs/FLUX.1-dev',
          revision: '3de623fc3c33e44ffbe2bad470d0f45bccf2eb21',
          dtype: 'bfloat16',
          filename: 'flux-route-switch-v1.webp',
          prompt:
            'A vast glass conservatory suspended above storm clouds at blue hour, rare luminous orchids, brass instruments, a lone botanist in a red coat, layered atmospheric depth, cinematic medium-format photography, precise reflections and fine material detail.',
          width: 768,
          height: 768,
          steps: 20,
          guidanceScale: 3.5,
          seed: 271828,
        };
  test.setTimeout((generateThroughFrontend ? 2 * 60 * 60 : 12 * 60) * 1000);
  page.setDefaultTimeout(60_000);
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('block-route-switch-v1-live')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('block-route-switch-v1-live', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('topbar-new-workflow').click();
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible({ timeout: 1_000 }).catch(() => false)) await advanced.click();
  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible();
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
    await group.getByRole('button').first().click();
  }
  await page.getByLabel('Search nodes').fill('Qwen Image — Text To Image');
  const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({
    hasText: 'Qwen Image — Text To Image',
  });
  await expect(row).toHaveCount(1);
  await row.click();
  const pendingInsertion = page.locator('[data-testid^="block-insertion-pending-"]');
  await expect(pendingInsertion).toBeVisible({ timeout: 5_000 });
  const insertedRoot = page
    .locator('.react-flow__node-block')
    .filter({ has: page.locator('[data-block-schema-version="2"]') })
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(insertedRoot).toBeVisible({ timeout: 60_000 });
  await expect(pendingInsertion).toHaveCount(0);
  const rootId = await insertedRoot.getAttribute('data-id');
  expect(rootId).toBeTruthy();
  const root = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
  const routeSelect = root.getByTestId(`block-v2-route-select-${rootId}`);
  await expect(routeSelect).toContainText('Qwen Image 2512');

  // Production-definition regression: a user resize belongs to the collapsed
  // card only. Expanding must derive a fresh frame from every live Qwen child.
  const resizeGrip = root.getByLabel('Drag to resize block');
  const resizeBounds = await resizeGrip.boundingBox();
  expect(resizeBounds).toBeTruthy();
  await page.mouse.move(resizeBounds!.x + resizeBounds!.width / 2, resizeBounds!.y + resizeBounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    resizeBounds!.x + resizeBounds!.width / 2 + 120,
    resizeBounds!.y + resizeBounds!.height / 2 + 160,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect
    .poll(async () =>
      page.evaluate(async (id) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        return Boolean(
          useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2?.presentation.size,
        );
      }, rootId!),
    )
    .toBe(true);
  const collapsedSize = await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2?.presentation.size;
  }, rootId!);
  expect(collapsedSize).toBeTruthy();
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  await expect(root.getByTestId(`user-block-toggle-${rootId}`)).toHaveAccessibleName('Collapse block');
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        return useFlowStore.getState().nodes.filter((node) => node.data.blockProjectionOwnerId === id).length;
      }, rootId!),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const rootElement = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
        const state = window.__MODIFF_E2E__!.getState().flow;
        const children = state.nodes
          .filter((node) => node.blockProjectionOwnerId === id)
          .map((node) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${node.id}"]`))
          .filter((element): element is HTMLElement => Boolean(element));
        if (!rootElement || !children.length) return null;
        const rootBounds = rootElement.getBoundingClientRect();
        const escaped = children.filter((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.left < rootBounds.left - 1 ||
            bounds.top < rootBounds.top - 1 ||
            bounds.right > rootBounds.right + 1 ||
            bounds.bottom > rootBounds.bottom + 1
          );
        }).length;
        const rootNode = state.nodes.find((node) => node.id === id);
        return {
          childCount: children.length,
          escaped,
          expandedWidth: rootNode?.width ?? null,
          expandedHeight: rootNode?.height ?? null,
        };
      }, rootId!),
    )
    .toMatchObject({ childCount: 5, escaped: 0 });
  if (geometryScreenshotPath) {
    await page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      useFlowStore.getState().setBlockPresentationV2(id, { position: { x: 40, y: 80 } });
    }, rootId!);
    await page.waitForTimeout(500);
    await page.mouse.move(420, 180);
    await page.mouse.wheel(0, 520);
    await page.waitForTimeout(400);
    const screenshotGeometry = await page.evaluate((id) => {
      const rootElement = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
      const frameElement = document.querySelector<HTMLElement>(`[data-testid="user-block-${id}"]`);
      const state = window.__MODIFF_E2E__!.getState().flow;
      const rectangle = (element: HTMLElement | null) => {
        if (!element) return null;
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
      };
      return {
        root: rectangle(rootElement),
        frame: rectangle(frameElement),
        children: state.nodes
          .filter((node) => node.blockProjectionOwnerId === id)
          .map((node) => {
            const element = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${node.id}"]`);
            return {
              id: node.id,
              outer: rectangle(element),
              visual: rectangle(element?.firstElementChild as HTMLElement),
            };
          }),
      };
    }, rootId!);
    console.log(`QWEN_BLOCK_SCREENSHOT_GEOMETRY=${JSON.stringify(screenshotGeometry)}`);
    expect(screenshotGeometry.frame).toBeTruthy();
    expect(
      screenshotGeometry.children.filter(
        ({ visual }) =>
          visual &&
          screenshotGeometry.frame &&
          (visual.left < screenshotGeometry.frame.left - 1 ||
            visual.top < screenshotGeometry.frame.top - 1 ||
            visual.right > screenshotGeometry.frame.right + 1 ||
            visual.bottom > screenshotGeometry.frame.bottom + 1),
      ),
    ).toEqual([]);
    await page.screenshot({ path: geometryScreenshotPath });
    if (geometryScreenshotOnly) return;
  }
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  await expect(root.getByTestId(`user-block-toggle-${rootId}`)).toHaveAccessibleName('Expand block');
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const rootNode = useFlowStore.getState().nodes.find((node) => node.id === id);
        return {
          projectionCount: useFlowStore.getState().nodes.filter((node) => node.data.blockProjectionOwnerId === id)
            .length,
          size: rootNode?.data.blockInstanceV2?.presentation.size,
        };
      }, rootId!),
    )
    .toMatchObject({ projectionCount: 0, size: collapsedSize });

  const qwenPrompt = 'A luminous copper airship crossing a monsoon cloud canyon, intricate cinematic detail.';
  await root.getByLabel('prompt', { exact: true }).fill(qwenPrompt);
  await root.getByLabel('prompt', { exact: true }).blur();
  await routeSelect.click();
  await page.getByRole('option', { name: 'FLUX.1 Dev', exact: true }).click();
  const switchDialog = page.getByTestId(`switch-block-route-v1-${rootId}`);
  await expect(switchDialog).toBeVisible();
  await switchDialog.getByRole('button', { name: 'Keep draft and switch', exact: true }).click();
  await expect(root).toContainText('Flux — Text To Image', { timeout: 180_000 });
  await expect(routeSelect).toContainText('FLUX.1 Dev');
  await expect(root.getByLabel('prompt', { exact: true })).toHaveValue(qwenPrompt);
  await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    useFlowStore.getState().undo();
  });
  await expect(root).toContainText('Qwen Image — Text To Image');
  await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    useFlowStore.getState().redo();
  });
  await expect(root).toContainText('Flux — Text To Image');
  const fluxPrompt = 'A translucent botanical laboratory at dawn, photographed on medium-format film.';
  await root.getByLabel('prompt', { exact: true }).fill(fluxPrompt);
  await root.getByLabel('prompt', { exact: true }).blur();

  await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    useFlowStore.getState().setBlockPresentationV2(id, { position: { x: 720, y: 80 } });
  }, rootId!);
  await row.click();
  const v2Roots = page.locator('.react-flow__node-block').filter({
    has: page.locator('[data-block-schema-version="2"]'),
  });
  await expect(v2Roots).toHaveCount(2, { timeout: 180_000 });
  const siblingId = (
    await v2Roots.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-id')))
  ).find((id) => id && id !== rootId);
  expect(siblingId).toBeTruthy();
  await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    useFlowStore.getState().setBlockPresentationV2(id, { position: { x: 80, y: 80 } });
  }, siblingId!);
  const siblingBefore = await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return JSON.stringify(useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2);
  }, siblingId!);

  const beforeSave = await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const flow = useFlowStore.getState();
    const node = flow.nodes.find((candidate) => candidate.id === id);
    return {
      history: flow.historyPast.length,
      instance: node?.data.blockInstanceV2 ?? null,
      projectionCount: flow.nodes.filter((candidate) => candidate.data.blockProjectionOwnerId === id).length,
    };
  }, rootId!);
  expect(beforeSave.instance?.instanceId).toBe(rootId);
  expect(beforeSave.instance?.routeSelection).toMatchObject({
    routeSetId: 'diffusers.route-set:text-to-image:v1',
    selectedRouteKey: 'flux-1-dev',
  });
  expect(beforeSave.instance?.routeSelection?.inactiveDrafts['qwen-image-2512']?.values.prompt).toBe(qwenPrompt);
  expect(beforeSave.instance?.authorities).toEqual([]);
  expect(
    await page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return JSON.stringify(useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2);
    }, siblingId!),
  ).toBe(siblingBefore);

  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill(`Qwen FLUX Route Drafts ${Date.now()}`);
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const [{ useStudioStore }, { stableStringify }] = await Promise.all([
            import('/src/stores/useStudioStore.ts'),
            import('/src/studio/templateExactness.ts'),
          ]);
          const studio = useStudioStore.getState();
          const local = studio.workflowTabs.find((tab) => tab.id === studio.activeWorkflowTabId);
          if (!local) return { dirty: null, sameDocument: false };
          const response = await fetch(`/workflows/${encodeURIComponent(local.id)}`);
          if (!response.ok) return { dirty: local.dirty, sameDocument: false };
          const backend = (await response.json()) as {
            title?: string;
            source?: string;
            sourceLabel?: string;
            snapshot?: unknown;
          };
          return {
            dirty: local.dirty,
            sameDocument:
              stableStringify([local.title, local.source, local.sourceLabel, local.snapshot]) ===
              stableStringify([backend.title, backend.source, backend.sourceLabel, backend.snapshot]),
          };
        }),
      { timeout: 120_000 },
    )
    .toEqual({ dirty: false, sameDocument: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorkspaceStartup(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          async ({ firstId, secondId }) => {
            const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
            const flow = useFlowStore.getState();
            const first = flow.nodes.find((candidate) => candidate.id === firstId)?.data.blockInstanceV2;
            return {
              rootCount: flow.nodes.filter((candidate) => candidate.id === firstId || candidate.id === secondId).length,
              title: first?.definitionSnapshot.displayName ?? null,
              route: first?.routeSelection?.selectedRouteKey ?? null,
            };
          },
          { firstId: rootId!, secondId: siblingId! },
        ),
      { timeout: 120_000 },
    )
    .toEqual({ rootCount: 2, title: 'Flux — Text To Image', route: 'flux-1-dev' });
  // The saved viewport can legitimately keep one of two far-apart Blocks
  // outside React Flow's virtualized DOM. Focus the exact restored root before
  // making renderer assertions; the store assertion above remains the durable
  // persistence proof.
  await page.evaluate(async (id) => {
    const [{ useSettingsStore }, { useStudioStore }] = await Promise.all([
      import('/src/stores/useSettingsStore.ts'),
      import('/src/stores/useStudioStore.ts'),
    ]);
    const workflowTabId = useStudioStore.getState().activeWorkflowTabId;
    if (!workflowTabId) throw new Error('The restored workflow tab is unavailable.');
    useSettingsStore.getState().setWorkflowFocusRequest({
      workflowTabId,
      nodeId: id,
      requestId: Date.now(),
      requestedAt: Date.now(),
    });
  }, rootId!);
  const restored = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
  await expect(restored).toContainText('Flux — Text To Image');
  await expect(restored.getByLabel('prompt', { exact: true })).toHaveValue(fluxPrompt);
  const restoredSelect = restored.getByTestId(`block-v2-route-select-${rootId}`);
  await restoredSelect.click();
  await page.getByRole('option', { name: 'Qwen Image 2512', exact: true }).click();
  const restoredDialog = page.getByTestId(`switch-block-route-v1-${rootId}`);
  await expect(restoredDialog).toBeVisible();
  await restoredDialog.getByRole('button', { name: 'Keep draft and switch', exact: true }).click();
  await expect(restored).toContainText('Qwen Image — Text To Image', { timeout: 180_000 });
  await expect(restored.getByLabel('prompt', { exact: true })).toHaveValue(qwenPrompt);

  const restoredQwen = await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const flow = useFlowStore.getState();
    const instance = flow.nodes.find((candidate) => candidate.id === id)?.data.blockInstanceV2;
    return {
      instance,
      rootCount: flow.nodes.filter((candidate) => candidate.id === id).length,
      legacyClusterCount: flow.nodes.filter((candidate) => candidate.data.huggingFaceClusterRole).length,
    };
  }, rootId!);
  expect(restoredQwen.rootCount).toBe(1);
  expect(restoredQwen.legacyClusterCount).toBe(0);
  expect(restoredQwen.instance?.routeSelection?.selectedRouteKey).toBe('qwen-image-2512');
  expect(restoredQwen.instance?.routeSelection?.inactiveDrafts['flux-1-dev']?.values.prompt).toBe(fluxPrompt);
  expect(
    await page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return JSON.stringify(useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2);
    }, siblingId!),
  ).toBe(siblingBefore);

  const sdxlPrompt = 'An elaborate tidal observatory carved into pale stone, crisp editorial architectural detail.';
  await restoredSelect.click();
  await page.getByRole('option', { name: 'Stable Diffusion XL 1.0', exact: true }).click();
  const sdxlSwitchDialog = page.getByTestId(`switch-block-route-v1-${rootId}`);
  await expect(sdxlSwitchDialog).toBeVisible();
  await sdxlSwitchDialog.getByRole('button', { name: 'Keep draft and switch', exact: true }).click();
  await expect(restored).toContainText('Stable Diffusion XL — Text To Image', { timeout: 180_000 });
  await expect(restored.getByLabel('prompt', { exact: true })).toHaveValue(qwenPrompt);
  await restored.getByLabel('prompt', { exact: true }).fill(sdxlPrompt);
  await restored.getByLabel('prompt', { exact: true }).blur();
  await restoredSelect.click();
  await page.getByRole('option', { name: 'Qwen Image 2512', exact: true }).click();
  const qwenRestoreDialog = page.getByTestId(`switch-block-route-v1-${rootId}`);
  await expect(qwenRestoreDialog).toBeVisible();
  await qwenRestoreDialog.getByRole('button', { name: 'Keep draft and switch', exact: true }).click();
  await expect(restored).toContainText('Qwen Image — Text To Image', { timeout: 180_000 });
  await expect(restored.getByLabel('prompt', { exact: true })).toHaveValue(qwenPrompt);
  const threeRouteDrafts = await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const instance = useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2;
    return {
      selected: instance?.routeSelection?.selectedRouteKey ?? null,
      fluxPrompt: instance?.routeSelection?.inactiveDrafts['flux-1-dev']?.values.prompt ?? null,
      sdxlPrompt: instance?.routeSelection?.inactiveDrafts['sdxl-base-1.0']?.values.prompt ?? null,
    };
  }, rootId!);
  expect(threeRouteDrafts).toEqual({ selected: 'qwen-image-2512', fluxPrompt, sdxlPrompt });
  const postReloadCompilerDefinitions = await page.evaluate(async () => {
    const { getRegisteredBlockV2CompilerDiagnostics } = await import('/src/studio/huggingFaceClusterInsertion.ts');
    return getRegisteredBlockV2CompilerDiagnostics().map(({ definitionId, stage }) => ({ definitionId, stage }));
  });
  expect(postReloadCompilerDefinitions).toEqual([
    {
      definitionId: 'diffusers.modular:StableDiffusionXLModularPipeline:text2image',
      stage: 'completed',
    },
  ]);
  expect(
    await page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return JSON.stringify(useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2);
    }, siblingId!),
  ).toBe(siblingBefore);

  // Persist the complete three-route draft set, not only the earlier
  // Qwen/FLUX pair. This is the regression boundary for the original model
  // switching reset: a browser refresh must retain the selected route and
  // each route's independent parameter draft.
  await page.getByTestId('topbar-save-workflow').click();
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const [{ useStudioStore }, { stableStringify }] = await Promise.all([
            import('/src/stores/useStudioStore.ts'),
            import('/src/studio/templateExactness.ts'),
          ]);
          const studio = useStudioStore.getState();
          const local = studio.workflowTabs.find((tab) => tab.id === studio.activeWorkflowTabId);
          if (!local) return { dirty: null, sameDocument: false };
          const response = await fetch(`/workflows/${encodeURIComponent(local.id)}`);
          if (!response.ok) return { dirty: local.dirty, sameDocument: false };
          const backend = (await response.json()) as {
            title?: string;
            source?: string;
            sourceLabel?: string;
            snapshot?: unknown;
          };
          return {
            dirty: local.dirty,
            sameDocument:
              stableStringify([local.title, local.source, local.sourceLabel, local.snapshot]) ===
              stableStringify([backend.title, backend.source, backend.sourceLabel, backend.snapshot]),
          };
        }),
      { timeout: 120_000 },
    )
    .toEqual({ dirty: false, sameDocument: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorkspaceStartup(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          async ({ firstId, secondId }) => {
            const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
            const flow = useFlowStore.getState();
            const current = flow.nodes.find((node) => node.id === firstId)?.data.blockInstanceV2;
            return {
              rootCount: flow.nodes.filter((node) => node.id === firstId || node.id === secondId).length,
              selected: current?.routeSelection?.selectedRouteKey ?? null,
              fluxPrompt: current?.routeSelection?.inactiveDrafts['flux-1-dev']?.values.prompt ?? null,
              sdxlPrompt: current?.routeSelection?.inactiveDrafts['sdxl-base-1.0']?.values.prompt ?? null,
            };
          },
          { firstId: rootId!, secondId: siblingId! },
        ),
      { timeout: 120_000 },
    )
    .toEqual({ rootCount: 2, selected: 'qwen-image-2512', fluxPrompt, sdxlPrompt });

  let savedRouteCopyId: string | null = null;
  if (saveCopyThroughFrontend || generateThroughFrontend) {
    const existingUserDefinitionIds = await page.evaluate(async () => {
      const { useUserBlockStore } = await import('/src/stores/useUserBlockStore.ts');
      return useUserBlockStore.getState().blockDefinitionsV2.map(({ definitionId }) => definitionId);
    });
    await restoredSelect.click();
    await page.getByRole('option', { name: generationRoute.label, exact: true }).click();
    const finalSwitchDialog = page.getByTestId(`switch-block-route-v1-${rootId}`);
    await finalSwitchDialog
      .getByRole('button', {
        name: saveCopyThroughFrontend ? 'Save active route and switch' : 'Keep draft and switch',
        exact: true,
      })
      .click();
    await expect(restored).toContainText(generationRoute.title, { timeout: 180_000 });
    if (saveCopyThroughFrontend) {
      await expect
        .poll(
          () =>
            page.evaluate(async (before) => {
              const { useUserBlockStore } = await import('/src/stores/useUserBlockStore.ts');
              const definition = useUserBlockStore
                .getState()
                .blockDefinitionsV2.find(({ definitionId }) => !before.includes(definitionId));
              return definition
                ? {
                    definitionId: definition.definitionId,
                    sourceKind: definition.source.kind,
                    parentDefinitionId: definition.source.parent?.definitionId ?? null,
                  }
                : null;
            }, existingUserDefinitionIds),
          { timeout: 120_000, intervals: [250, 500, 1000] },
        )
        .toMatchObject({
          sourceKind: 'user',
          parentDefinitionId: 'diffusers.cluster-admission:QwenImageModularPipeline:text2image:mode:text_to_image',
        });
      const savedCopyState = await page.evaluate(async (before) => {
        const { useUserBlockStore } = await import('/src/stores/useUserBlockStore.ts');
        return (
          useUserBlockStore.getState().blockDefinitionsV2.find(({ definitionId }) => !before.includes(definitionId))
            ?.definitionId ?? null
        );
      }, existingUserDefinitionIds);
      expect(savedCopyState).toBeTruthy();
      savedRouteCopyId = savedCopyState;
    }
  }

  if (generateThroughFrontend) {
    const evidenceRoot = process.env.MODIFF_REVIEW_OUTPUT_DIR
      ? `${process.env.MODIFF_REVIEW_OUTPUT_DIR}/${
          generationRoute.key === 'sdxl-base-1.0' ? 'qwen-flux-sdxl-route-switch-v1' : 'qwen-flux-route-switch-v1'
        }`
      : null;
    if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
    const proof = {
      prompt: generationRoute.prompt,
      width: generationRoute.width,
      height: generationRoute.height,
      steps: generationRoute.steps,
      guidanceScale: generationRoute.guidanceScale,
      seed: generationRoute.seed,
    };
    await page.evaluate(
      async ({ id, values, dtype }) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const flow = useFlowStore.getState();
        flow.setBlockInstanceValueV2(id, 'prompt', values.prompt);
        flow.setBlockInstanceValueV2(id, 'width', values.width);
        flow.setBlockInstanceValueV2(id, 'height', values.height);
        flow.setBlockInstanceValueV2(id, 'num_inference_steps', values.steps);
        flow.setBlockInstanceValueV2(id, 'guidanceScale', values.guidanceScale);
        flow.setBlockInstanceValueV2(id, 'seed', values.seed);
        flow.setBlockInstanceValueV2(id, 'dtype', dtype);
        flow.setBlockInstanceValueV2(id, 'autoOffload', true);
        flow.setBlockInstanceValueV2(id, 'offloadMode', 'model_cpu');
      },
      { id: rootId!, values: proof, dtype: generationRoute.dtype },
    );
    await restored.locator('header').first().click();
    const runFromNode = page.getByTestId('selection-toolbar-run-from-node');
    await expect(runFromNode).toBeVisible();
    const submission = page.waitForResponse(
      (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
      { timeout: 120_000 },
    );
    await runFromNode.click();
    const response = await submission;
    if (!response.ok())
      throw new Error(
        `${generationRoute.label} route-switch graph submission failed (${response.status()}): ${await response.text()}`,
      );
    await expect(page.getByRole('dialog', { name: 'Run blocked' })).toHaveCount(0);
    const submittedGraph = response.request().postDataJSON() as {
      nodes?: Record<string, unknown>;
      runtimeHints?: Record<string, unknown>;
      provenance?: Record<string, unknown>;
    };
    const executableNodesJson = JSON.stringify(submittedGraph.nodes);
    expect(executableNodesJson).toContain(proof.prompt);
    expect(executableNodesJson).toContain(generationRoute.pipelineClass);
    expect(executableNodesJson).not.toContain(qwenPrompt);
    expect(executableNodesJson).not.toContain('routeSelection');
    expect(executableNodesJson).not.toContain('inactiveDrafts');
    expect(submittedGraph.runtimeHints).toMatchObject({
      modelType: generationRoute.pipelineClass,
      modelRepo: generationRoute.repository,
      quantizationMode: 'none',
      dtype: generationRoute.dtype,
      autoOffload: true,
      offloadMode: 'model_cpu',
    });
    const payload = (await response.json()) as { task_id?: string };
    expect(payload.task_id).toBeTruthy();
    const taskId = payload.task_id!;
    await waitForLiveTaskCompletion(page, taskId, 90 * 60 * 1000);
    const readOutput = async () => {
      const response = await page.request.get('/studio_outputs?limit=200', { timeout: 10_000 });
      if (!response.ok()) return null;
      const body = (await response.json()) as {
        outputs?: Array<{ id?: string; taskId?: string; displayType?: string; mediaHash?: string; url?: string }>;
      };
      return body.outputs?.find((candidate) => candidate.taskId === taskId) ?? null;
    };
    await expect.poll(readOutput, { timeout: 120_000, intervals: [500, 1000, 2000] }).toMatchObject({
      taskId,
      displayType: 'image',
    });
    const resolvedOutput = await readOutput();
    expect(resolvedOutput?.url).toBeTruthy();
    if (evidenceRoot) {
      const asset = await page.request.get(new URL(resolvedOutput!.url!, page.url()).toString());
      expect(asset.ok()).toBe(true);
      await writeFile(`${evidenceRoot}/${generationRoute.filename}`, await asset.body());
      await writeFile(
        `${evidenceRoot}/execution-receipt.json`,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
            source: 'visible_frontend_selection_toolbar',
            routeSetId: 'diffusers.route-set:text-to-image:v1',
            routeKey: generationRoute.key,
            repository: generationRoute.repository,
            revision: generationRoute.revision,
            quantizationMode: 'none',
            values: proof,
            taskId,
            runtimeHints: {
              modelType: submittedGraph.runtimeHints?.modelType,
              modelRepo: submittedGraph.runtimeHints?.modelRepo,
              dtype: submittedGraph.runtimeHints?.dtype,
              quantizationMode: submittedGraph.runtimeHints?.quantizationMode,
              autoOffload: submittedGraph.runtimeHints?.autoOffload,
              offloadMode: submittedGraph.runtimeHints?.offloadMode,
            },
            routeBinding: submittedGraph.provenance?.registeredBlockV2RouteBinding,
            output: {
              id: resolvedOutput?.id,
              taskId: resolvedOutput?.taskId,
              displayType: resolvedOutput?.displayType,
              mediaHash: resolvedOutput?.mediaHash,
              url: resolvedOutput?.url,
            },
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      await page.screenshot({ path: `${evidenceRoot}/frontend-after-run.png`, fullPage: false, timeout: 120_000 });
    }
  }
  if (savedRouteCopyId) {
    await page.evaluate(async (definitionId) => {
      const { useUserBlockStore } = await import('/src/stores/useUserBlockStore.ts');
      await useUserBlockStore.getState().deleteBlock(definitionId);
    }, savedRouteCopyId);
  }
});

test('backend-served UI contains a resized Qwen Cluster after expansion', async ({ page }) => {
  test.skip(
    process.env.MODIFF_RUN_PRODUCTION_BLOCK_LAYOUT !== '1',
    'The backend-served production bundle smoke must be selected explicitly.',
  );
  test.setTimeout(2 * 60 * 1000);
  await page.setViewportSize({ width: 2400, height: 1400 });
  // This regression exists to prove the exact production bundle a user opens,
  // rather than a second Vite process that merely shares the same source tree.
  await page.goto(process.env.MODIFF_PRODUCTION_UI_URL || '/', { waitUntil: 'domcontentloaded' });

  const launcher = page.getByTestId('task-launcher');
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  await launcher.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('left-tab-nodes').click();
  const advanced = page.getByRole('button', { name: 'Advanced', exact: true });
  if (await advanced.isVisible()) await advanced.click();
  await page.getByRole('searchbox', { name: 'Search nodes' }).fill('qwen');

  const clusterGroup = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(clusterGroup).toBeVisible({ timeout: 30_000 });
  const clusterGroupButton = clusterGroup.getByRole('button').first();
  if ((await clusterGroupButton.getAttribute('aria-expanded')) !== 'true') await clusterGroupButton.click();
  await page
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image — Text To Image' })
    .first()
    .click();

  const block = page.locator('[data-block-schema-version="2"]').first();
  await expect(block).toBeVisible({ timeout: 30_000 });
  const root = block.locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " react-flow__node ")][1]',
  );
  const resizeGrip = block.getByTestId('node-resize-grip');
  const resizeBox = await resizeGrip.boundingBox();
  expect(resizeBox).not.toBeNull();
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2 + 220, resizeBox!.y + resizeBox!.height / 2 + 180, {
    steps: 12,
  });
  await page.mouse.up();
  const collapsedBox = await root.boundingBox();
  expect(collapsedBox).not.toBeNull();

  await block.getByRole('button', { name: 'Expand block', exact: true }).click();
  await expect.poll(() => page.locator('.react-flow__node').count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(6);
  await page.waitForTimeout(750);

  const rootId = await root.getAttribute('data-id');
  const expandedBox = await root.boundingBox();
  expect(rootId).toBeTruthy();
  expect(expandedBox).not.toBeNull();
  expect(expandedBox!.width).toBeGreaterThan(collapsedBox!.width);
  expect(expandedBox!.height).toBeGreaterThan(collapsedBox!.height);
  const projectedNodes = await page.locator('.react-flow__node').evaluateAll(
    (elements, ownerId) =>
      elements
        .map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            id: element.getAttribute('data-id'),
            x: bounds.x,
            y: bounds.y,
            right: bounds.right,
            bottom: bounds.bottom,
          };
        })
        .filter(
          (node) =>
            typeof node.id === 'string' &&
            typeof ownerId === 'string' &&
            node.id.startsWith(`block-v2-node:${ownerId.length}:${ownerId}:`),
        ),
    rootId,
  );
  // The exact Qwen Modular Diffusers route currently exposes twelve upstream
  // steps. Keep this assertion structural so adding another reviewed upstream
  // step cannot silently weaken the containment proof.
  expect(projectedNodes.length).toBeGreaterThanOrEqual(10);
  for (const projected of projectedNodes) {
    expect(projected.x).toBeGreaterThanOrEqual(expandedBox!.x - 2);
    expect(projected.y).toBeGreaterThanOrEqual(expandedBox!.y - 2);
    expect(projected.right).toBeLessThanOrEqual(expandedBox!.x + expandedBox!.width + 2);
    expect(projected.bottom).toBeLessThanOrEqual(expandedBox!.y + expandedBox!.height + 2);
  }

  const modelsNode = page.locator('.react-flow__node[data-id$=":models"]');
  await expect(modelsNode).toBeVisible();
  const modelsBeforeResize = await modelsNode.boundingBox();
  const internalResizeGrip = modelsNode.getByTestId('node-resize-grip');
  await expect(internalResizeGrip).toBeVisible();
  const internalResizeBox = await internalResizeGrip.boundingBox();
  expect(modelsBeforeResize).not.toBeNull();
  expect(internalResizeBox).not.toBeNull();
  await page.mouse.move(
    internalResizeBox!.x + internalResizeBox!.width / 2,
    internalResizeBox!.y + internalResizeBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    internalResizeBox!.x + internalResizeBox!.width / 2 + 220,
    internalResizeBox!.y + internalResizeBox!.height / 2 + 60,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await modelsNode.boundingBox())?.width ?? 0)
    .toBeGreaterThan(modelsBeforeResize!.width + 150);
  const resizedModelsBox = await modelsNode.boundingBox();
  expect(resizedModelsBox).not.toBeNull();

  await block.getByRole('button', { name: 'Collapse block', exact: true }).click();
  await expect(modelsNode).toHaveCount(0);
  await block.getByRole('button', { name: 'Expand block', exact: true }).click();
  await expect(modelsNode).toBeVisible();
  await expect
    .poll(async () => (await modelsNode.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(resizedModelsBox!.width - 2);

  const screenshotPath = process.env.MODIFF_PRODUCTION_BLOCK_LAYOUT_SCREENSHOT;
  if (screenshotPath) await page.screenshot({ path: screenshotPath });
});

test('saved registered route-set Block survives a full backend restart and opens from My workflows', async ({
  page,
}) => {
  const workflowId = process.env.MODIFF_BLOCK_ROUTE_RESTART_WORKFLOW_ID;
  test.skip(!workflowId, 'Provide the exact saved workflow id after restarting the MoDiff backend.');
  test.setTimeout(5 * 60 * 1000);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('left-tab-workflows').click();
  const savedRow = page.getByTestId(`saved-workflow-${workflowId}`);
  await expect(savedRow).toBeVisible({ timeout: 120_000 });
  await savedRow.locator('button:not([aria-label])').click();
  await expect
    .poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().studio.activeWorkflowTabId), {
      timeout: 120_000,
    })
    .toBe(workflowId);
  const restored = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore
      .getState()
      .nodes.filter((node) => node.data.blockInstanceV2)
      .map((node) => ({
        id: node.id,
        title: node.data.blockInstanceV2!.definitionSnapshot.displayName,
        route: node.data.blockInstanceV2!.routeSelection?.selectedRouteKey ?? null,
        prompt: node.data.blockInstanceV2!.values.prompt,
        inactiveQwenPrompt:
          node.data.blockInstanceV2!.routeSelection?.inactiveDrafts['qwen-image-2512']?.values.prompt ?? null,
      }));
  });
  expect(restored).toHaveLength(2);
  const flux = restored.find(({ route }) => route === 'flux-1-dev');
  expect(flux).toMatchObject({
    title: 'Flux — Text To Image',
    prompt:
      'A vast glass conservatory suspended above storm clouds at blue hour, rare luminous orchids, brass instruments, a lone botanist in a red coat, layered atmospheric depth, cinematic medium-format photography, precise reflections and fine material detail.',
    inactiveQwenPrompt: 'A luminous copper airship crossing a monsoon cloud canyon, intricate cinematic detail.',
  });
  expect(restored.filter(({ title }) => title === 'Qwen Image — Text To Image')).toHaveLength(1);
});

test('all registered generic Diffusers route sets are exposed by newly inserted Blocks', async ({ page }) => {
  test.setTimeout(12 * 60 * 1000);
  page.setDefaultTimeout(90_000);
  const cases = [
    {
      label: 'Qwen Image — Image To Image',
      selected: 'Qwen Image 2512',
      options: ['Qwen Image 2512', 'FLUX.1 Dev', 'Anima', 'Stable Diffusion XL 1.0'],
    },
    {
      label: 'Qwen Image Edit — Edit Image',
      selected: 'Qwen Image Edit',
      options: ['Qwen Image Edit', 'Qwen Image Edit Plus', 'FLUX.1 Kontext', 'FLUX.2 Klein', 'FLUX.2 Klein Base'],
    },
    {
      label: 'Qwen Image — Inpaint',
      selected: 'Qwen Image 2512',
      options: ['Qwen Image 2512', 'Qwen Image Edit', 'Stable Diffusion XL 1.0'],
    },
    {
      label: 'Qwen Image — Control Image',
      selected: 'Qwen Image 2512',
      options: ['Qwen Image 2512', 'Stable Diffusion XL 1.0'],
    },
    {
      label: 'Wan — Text To Video',
      selected: 'Wan 2.1',
      options: [
        'Wan 2.1',
        'Wan 2.2',
        'LTX Video',
        'LTX-2',
        'HunyuanVideo 1.5',
        'Helios',
        'Helios Pyramid',
        'Helios Pyramid Distilled',
        'Cosmos 3 Omni',
      ],
    },
    {
      label: 'LTX — Image To Video',
      selected: 'LTX Video',
      options: ['Cosmos 3 Distilled', 'Cosmos 3 Omni', 'HunyuanVideo 1.5', 'LTX Video', 'LTX-2', 'Wan 2.2', 'Wan 2.1'],
    },
  ] as const;

  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible();
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
    await group.getByRole('button').first().click();
  }

  for (const scenario of cases) {
    await page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      useFlowStore.setState({ nodes: [], edges: [] });
    });
    await page.getByLabel('Search nodes').fill(scenario.label);
    const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: scenario.label });
    await expect(row).toHaveCount(1);
    await row.click();
    const insertedRoot = page.locator('.react-flow__node-block').filter({ hasText: scenario.label });
    await expect(insertedRoot).toBeVisible({ timeout: 180_000 });
    const rootId = await insertedRoot.getAttribute('data-id');
    expect(rootId).toBeTruthy();
    // The renderer keeps the root ID but correctly changes its title when the
    // active exact route changes, so subsequent assertions must follow the
    // durable instance identity rather than the source route's title.
    const root = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
    const routeSelect = root.getByTestId(`block-v2-route-select-${rootId}`);
    await expect(routeSelect).toContainText(scenario.selected);
    await routeSelect.click();
    await expect(page.getByRole('option')).toHaveCount(scenario.options.length);
    for (const option of scenario.options) {
      await expect(page.getByRole('option', { name: option, exact: true })).toBeVisible();
    }
    await page.keyboard.press('Escape');
  }
});

test('new generic edit and video Blocks switch exact routes and restore their source drafts', async ({ page }) => {
  test.setTimeout(12 * 60 * 1000);
  page.setDefaultTimeout(90_000);
  const cases = [
    {
      label: 'Qwen Image Edit — Edit Image',
      source: 'Qwen Image Edit',
      target: 'FLUX.1 Kontext',
      prompt: 'Replace only the ceramic vase with a translucent amber-glass vase while preserving the table.',
    },
    {
      label: 'Wan — Text To Video',
      source: 'Wan 2.1',
      target: 'LTX Video',
      prompt: 'A red paper kite climbs steadily over wind-bent grass as the camera tracks smoothly beside it.',
    },
  ] as const;

  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible();
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
    await group.getByRole('button').first().click();
  }

  for (const scenario of cases) {
    await page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      useFlowStore.setState({ nodes: [], edges: [] });
    });
    await page.getByLabel('Search nodes').fill(scenario.label);
    const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: scenario.label });
    await expect(row).toHaveCount(1);
    await row.click();
    const insertedRoot = page.locator('.react-flow__node-block').filter({ hasText: scenario.label });
    await expect(insertedRoot).toBeVisible({ timeout: 180_000 });
    const rootId = await insertedRoot.getAttribute('data-id');
    expect(rootId).toBeTruthy();
    const root = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
    const routeSelect = root.getByTestId(`block-v2-route-select-${rootId}`);
    await root.getByLabel('prompt', { exact: true }).fill(scenario.prompt);
    await root.getByLabel('prompt', { exact: true }).blur();

    await routeSelect.click();
    await page.getByRole('option', { name: scenario.target, exact: true }).click();
    let dialog = page.getByTestId(`switch-block-route-v1-${rootId}`);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep draft and switch', exact: true }).click();
    await expect(routeSelect).toContainText(scenario.target, { timeout: 180_000 });
    await expect(root.getByLabel('prompt', { exact: true })).toHaveValue(scenario.prompt);

    await routeSelect.click();
    await page.getByRole('option', { name: scenario.source, exact: true }).click();
    dialog = page.getByTestId(`switch-block-route-v1-${rootId}`);
    await expect(dialog).toBeVisible();
    const restoreStartedAt = Date.now();
    await dialog.getByRole('button', { name: 'Keep draft and switch', exact: true }).click();
    await expect(routeSelect).toContainText(scenario.source, { timeout: 30_000 });
    expect(Date.now() - restoreStartedAt).toBeLessThan(20_000);
    await expect(root.getByLabel('prompt', { exact: true })).toHaveValue(scenario.prompt);
  }
});

test('live current-V2 Qwen Block saves a connected structural customization as a User Node and executes it', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_QWEN_V2_CUSTOMIZATION !== '1',
    'The real current-V2 Qwen structural customization proof must be selected explicitly.',
  );
  test.setTimeout(2 * 60 * 60 * 1000);
  page.setDefaultTimeout(60_000);
  const evidenceRoot = process.env.MODIFF_REVIEW_OUTPUT_DIR
    ? `${process.env.MODIFF_REVIEW_OUTPUT_DIR}/qwen-v2-custom-user-node`
    : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
  const prompt =
    'A precision clockmaker assembling a transparent astronomical watch beneath a skylight, brass gears, sapphire bridges, fine workshop dust, controlled cinematic light, crisp macro product photography.';
  const values = {
    width: 640,
    height: 640,
    steps: 12,
    guidanceScale: 4,
    seed: 424242,
  };

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('qwen-v2-custom-user-node-live')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('qwen-v2-custom-user-node-live', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) === 'true')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await expect(autoToggle).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('topbar-new-workflow').click();
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible({ timeout: 1_000 }).catch(() => false)) await advanced.click();
  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible();
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
    await group.getByRole('button').first().click();
  }
  await page.getByLabel('Search nodes').fill('Qwen Image — Text To Image');
  const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({
    hasText: 'Qwen Image — Text To Image',
  });
  await expect(row).toHaveCount(1);
  await row.click();
  const root = page
    .locator('.react-flow__node-block')
    .filter({ has: page.locator('[data-block-schema-version="2"]') })
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(root).toBeVisible({ timeout: 180_000 });
  const rootId = await root.getAttribute('data-id');
  expect(rootId).toBeTruthy();
  await root.getByLabel('prompt', { exact: true }).fill(prompt);
  await root.getByLabel('prompt', { exact: true }).blur();
  await page.evaluate(
    async ({ id, values: proofValues }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      flow.setBlockInstanceValueV2(id, 'width', proofValues.width);
      flow.setBlockInstanceValueV2(id, 'height', proofValues.height);
      flow.setBlockInstanceValueV2(id, 'num_inference_steps', proofValues.steps);
      flow.setBlockInstanceValueV2(id, 'guidanceScale', proofValues.guidanceScale);
      flow.setBlockInstanceValueV2(id, 'seed', proofValues.seed);
      flow.setBlockInstanceValueV2(id, 'dtype', 'bfloat16');
      flow.setBlockInstanceValueV2(id, 'autoOffload', true);
      flow.setBlockInstanceValueV2(id, 'offloadMode', 'model_cpu');
    },
    { id: rootId!, values },
  );
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  await expect(root.getByTestId(`user-block-toggle-${rootId}`)).toHaveAccessibleName('Collapse block');
  await clearFinishedSessionActivity(page);

  const viewerId = await page.evaluate(() =>
    window.__MODIFF_E2E__!.addCustomNodeForTest('modules.Primitive.DataViewer'),
  );
  await page.evaluate(
    async ({ id, viewerId }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      useFlowStore.setState((state) => ({
        nodes: state.nodes.map((node) =>
          node.id === id
            ? { ...node, position: { x: 80, y: 250 } }
            : node.id === viewerId
              ? { ...node, position: { x: 400, y: 20 } }
              : node,
        ),
      }));
      await useFlowStore
        .getState()
        .onNodesChange(
          useFlowStore
            .getState()
            .nodes.map((node) => ({ id: node.id, type: 'select' as const, selected: node.id === viewerId })),
        );
    },
    { id: rootId!, viewerId },
  );
  const viewerNode = page.locator(`.react-flow__node-custom[data-id="${viewerId}"]`);
  await expect(viewerNode).toBeVisible();
  const viewerBounds = await viewerNode.boundingBox();
  const rootBounds = await root.boundingBox();
  expect(viewerBounds).toBeTruthy();
  expect(rootBounds).toBeTruthy();
  const dropPoint = await page.evaluate(
    ({ rootId, viewerId }) => {
      const rootElement = document.querySelector<HTMLElement>(`.react-flow__node-block[data-id="${rootId}"]`);
      if (!rootElement) throw new Error('The expanded Qwen Block root is unavailable for the pointer drop.');
      const rootRect = rootElement.getBoundingClientRect();
      const headerPoint = {
        x: Math.min(rootRect.right - 40, rootRect.left + 100),
        y: rootRect.top + Math.min(24, rootRect.height / 2),
      };
      if (
        headerPoint.x >= 0 &&
        headerPoint.x < window.innerWidth &&
        headerPoint.y >= 0 &&
        headerPoint.y < window.innerHeight
      ) {
        return headerPoint;
      }
      const occupied = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node-custom'))
        .filter((element) => element.dataset.id !== viewerId)
        .map((element) => element.getBoundingClientRect());
      const visibleRight = Math.min(rootRect.right, window.innerWidth - 24);
      const visibleBottom = Math.min(rootRect.bottom, window.innerHeight - 24);
      for (let y = visibleBottom - 40; y >= rootRect.top + 100; y -= 24) {
        for (let x = visibleRight - 40; x >= rootRect.left + 40; x -= 24) {
          if (!occupied.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) {
            return { x, y };
          }
        }
      }
      throw new Error('The expanded Qwen Block has no pointer-reachable blank area for node adoption.');
    },
    { rootId: rootId!, viewerId },
  );
  const viewerHeader = viewerNode.locator('header').first();
  const headerBounds = await viewerHeader.boundingBox();
  expect(headerBounds).toBeTruthy();
  const dragStart = {
    x: headerBounds!.x + Math.min(80, headerBounds!.width / 2),
    y: headerBounds!.y + headerBounds!.height / 2,
  };
  await expect
    .poll(() =>
      page.evaluate(
        ({ point, viewerId }) =>
          document.elementFromPoint(point.x, point.y)?.closest('.react-flow__node')?.getAttribute('data-id') ===
          viewerId,
        { point: dragStart, viewerId },
      ),
    )
    .toBe(true);
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(viewerBounds!.x + viewerBounds!.width / 2 + 12, dragStart.y + 8, {
    steps: 3,
  });
  await page.waitForTimeout(100);
  await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        async ({ id, viewerId }) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          const instance = useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2;
          return instance?.effectiveGraph.nodes.some(({ nodeId }) => nodeId === viewerId) ?? false;
        },
        { id: rootId!, viewerId },
      ),
    )
    .toBe(true);
  await expect(page.getByText('The existing node was moved into this Block.')).toBeVisible();

  const customized = await page.evaluate(
    async ({ id, viewerId }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const projected = useFlowStore.getState().nodes.filter((node) => node.data.blockProjectionOwnerId === id);
      const decode = projected.find((node) => node.data.blockProjectionNodeId === 'decode');
      const viewer = projected.find((node) => node.data.blockProjectionNodeId === viewerId);
      if (!decode || !viewer) throw new Error('The expanded Qwen projection did not retain both connected nodes.');
      useFlowStore.getState().onConnect({
        source: decode.id,
        sourceHandle: 'images',
        target: viewer.id,
        targetHandle: 'value',
        edgeType: 'default',
      });
      const instance = useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2;
      if (!instance) throw new Error('The customized current-V2 Qwen instance disappeared.');
      return {
        viewerId,
        definitionId: instance.definitionSnapshot.definitionId,
        definitionHash: instance.definitionSnapshot.contentHash,
        graphHash: instance.customization.effectiveGraphHash,
        interfaceHash: instance.effectiveInterface.effectiveInterfaceHash,
        customizationState: instance.customization.state,
        semanticNodeIds: instance.effectiveGraph.nodes.map(({ nodeId }) => nodeId).sort(),
        semanticEdges: instance.effectiveGraph.edges.map(
          ({ sourceNodeId, sourcePortId, targetNodeId, targetPortId }) =>
            `${sourceNodeId}:${sourcePortId}>${targetNodeId}:${targetPortId}`,
        ),
        values: instance.values,
      };
    },
    { id: rootId!, viewerId },
  );
  expect(customized.customizationState).toBe('structure_changed');
  expect(customized.semanticNodeIds).toContain(customized.viewerId);
  expect(customized.semanticEdges).toContain(`decode:images>${customized.viewerId}:value`);
  expect(customized.values).toMatchObject({
    prompt,
    width: values.width,
    height: values.height,
    num_inference_steps: values.steps,
    guidanceScale: values.guidanceScale,
    seed: values.seed,
  });

  const existingUserDefinitions = await page.evaluate(async () => {
    const { useUserBlockStore } = await import('/src/stores/useUserBlockStore.ts');
    return useUserBlockStore.getState().blockDefinitionsV2.map(({ definitionId }) => definitionId);
  });
  await root.getByTestId(`user-block-save-choices-${rootId}`).click();
  const choices = page.getByTestId(`save-user-block-choices-${rootId}`);
  await expect(choices).toBeVisible();
  await choices.getByRole('button', { name: 'Save as new User Node', exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(async (before) => {
          const { useUserBlockStore } = await import('/src/stores/useUserBlockStore.ts');
          const definition = useUserBlockStore
            .getState()
            .blockDefinitionsV2.find(({ definitionId }) => !before.includes(definitionId));
          return definition
            ? {
                definitionId: definition.definitionId,
                displayName: definition.displayName,
                contentHash: definition.contentHash,
                sourceKind: definition.source.kind,
                parentDefinitionId: definition.source.parent?.definitionId ?? null,
                graphHash: definition.graph.graphHash,
              }
            : null;
        }, existingUserDefinitions),
      { timeout: 120_000, intervals: [250, 500, 1000] },
    )
    .toMatchObject({
      sourceKind: 'user',
      parentDefinitionId: customized.definitionId,
      graphHash: customized.graphHash,
    });
  const savedDefinition = await page.evaluate(async (before) => {
    const { useUserBlockStore } = await import('/src/stores/useUserBlockStore.ts');
    const definition = useUserBlockStore
      .getState()
      .blockDefinitionsV2.find(({ definitionId }) => !before.includes(definitionId));
    return definition
      ? {
          definitionId: definition.definitionId,
          displayName: definition.displayName,
          contentHash: definition.contentHash,
          sourceKind: definition.source.kind,
          parentDefinitionId: definition.source.parent?.definitionId ?? null,
          graphHash: definition.graph.graphHash,
        }
      : null;
  }, existingUserDefinitions);
  if (!savedDefinition) throw new Error('The newly saved current-V2 Qwen User Node could not be captured.');
  const rebasedBeforeRefresh = await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const instance = useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2;
    if (!instance) throw new Error('The Qwen workflow insertion was not rebased to its saved User Node.');
    return {
      definitionId: instance.definitionSnapshot.definitionId,
      definitionHash: instance.definitionSnapshot.contentHash,
      sourceKind: instance.definitionSnapshot.source.kind,
      graphHash: instance.customization.effectiveGraphHash,
      interfaceHash: instance.effectiveInterface.effectiveInterfaceHash,
      customizationState: instance.customization.state,
      semanticNodeIds: instance.effectiveGraph.nodes.map(({ nodeId }) => nodeId).sort(),
      semanticEdges: instance.effectiveGraph.edges.map(
        ({ sourceNodeId, sourcePortId, targetNodeId, targetPortId }) =>
          `${sourceNodeId}:${sourcePortId}>${targetNodeId}:${targetPortId}`,
      ),
      values: instance.values,
    };
  }, rootId!);
  expect(rebasedBeforeRefresh).toMatchObject({
    definitionId: savedDefinition.definitionId,
    definitionHash: savedDefinition.contentHash,
    sourceKind: 'user',
    graphHash: customized.graphHash,
    semanticNodeIds: customized.semanticNodeIds,
    semanticEdges: customized.semanticEdges,
    values: customized.values,
  });

  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('Demo — Qwen Customized V2 User Node');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const studio = window.__MODIFF_E2E__!.getState().studio;
          const tab = studio.workflowTabs.find(({ id }) => id === studio.activeWorkflowTabId);
          return { id: tab?.id ?? null, dirty: tab?.dirty ?? null };
        }),
      { timeout: 120_000 },
    )
    .toMatchObject({ dirty: false });
  const workflowId = await page.evaluate(() => window.__MODIFF_E2E__!.getState().studio.activeWorkflowTabId);
  expect(workflowId).toBeTruthy();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorkspaceStartup(page);
  const restored = await page.evaluate(
    async ({ id, userDefinitionId }) => {
      const [{ useFlowStore }, { useUserBlockStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useUserBlockStore.ts'),
      ]);
      const instance = useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2;
      const saved = useUserBlockStore
        .getState()
        .blockDefinitionsV2.find(({ definitionId }) => definitionId === userDefinitionId);
      return {
        instance: instance
          ? {
              definitionId: instance.definitionSnapshot.definitionId,
              definitionHash: instance.definitionSnapshot.contentHash,
              sourceKind: instance.definitionSnapshot.source.kind,
              graphHash: instance.customization.effectiveGraphHash,
              interfaceHash: instance.effectiveInterface.effectiveInterfaceHash,
              customizationState: instance.customization.state,
              semanticNodeIds: instance.effectiveGraph.nodes.map(({ nodeId }) => nodeId).sort(),
              semanticEdges: instance.effectiveGraph.edges.map(
                ({ sourceNodeId, sourcePortId, targetNodeId, targetPortId }) =>
                  `${sourceNodeId}:${sourcePortId}>${targetNodeId}:${targetPortId}`,
              ),
              values: instance.values,
            }
          : null,
        saved: saved
          ? {
              definitionId: saved.definitionId,
              sourceKind: saved.source.kind,
              graphHash: saved.graph.graphHash,
            }
          : null,
      };
    },
    { id: rootId!, userDefinitionId: savedDefinition.definitionId },
  );
  expect(restored.instance).toEqual(rebasedBeforeRefresh);
  expect(restored.saved).toEqual({
    definitionId: savedDefinition.definitionId,
    sourceKind: 'user',
    graphHash: customized.graphHash,
  });

  const restoredRoot = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
  await expect(restoredRoot).toBeVisible();
  const submission = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByTestId('studio-run').click();
  const response = await submission;
  if (!response.ok()) {
    throw new Error(`Customized Qwen graph submission failed (${response.status()}): ${await response.text()}`);
  }
  const submittedGraph = response.request().postDataJSON() as {
    nodes?: Record<string, { module?: string; action?: string; params?: Record<string, unknown> }>;
    runtimeHints?: Record<string, unknown>;
  };
  const submittedNodesJson = JSON.stringify(submittedGraph.nodes);
  expect(submittedNodesJson).toContain(prompt);
  expect(submittedNodesJson).toContain('modules.Primitive');
  expect(submittedNodesJson).toContain('DataViewer');
  expect(submittedNodesJson).toContain('QwenImageModularPipeline');
  expect(submittedNodesJson).toContain('Qwen/Qwen-Image-2512');
  const submittedBlockValues = (
    submittedGraph.runtimeHints?.workflowSnapshot as
      | {
          nodes?: Array<{
            data?: { blockInstanceV2?: { values?: Record<string, unknown> } };
          }>;
        }
      | undefined
  )?.nodes?.find(({ data }) => data?.blockInstanceV2)?.data?.blockInstanceV2?.values;
  expect(submittedBlockValues).toMatchObject({
    dtype: 'bfloat16',
    autoOffload: true,
    offloadMode: 'model_cpu',
    width: values.width,
    height: values.height,
    num_inference_steps: values.steps,
    seed: values.seed,
  });
  const payload = (await response.json()) as { task_id?: string };
  expect(payload.task_id).toBeTruthy();
  const taskId = payload.task_id!;
  await waitForLiveTaskCompletion(page, taskId, 90 * 60 * 1000);
  const readOutput = async () => {
    const outputResponse = await page.request.get('/studio_outputs?limit=200', { timeout: 10_000 });
    if (!outputResponse.ok()) return null;
    const body = (await outputResponse.json()) as {
      outputs?: Array<{ id?: string; taskId?: string; displayType?: string; mediaHash?: string; url?: string }>;
    };
    return body.outputs?.find((candidate) => candidate.taskId === taskId && candidate.displayType === 'image') ?? null;
  };
  await expect.poll(readOutput, { timeout: 120_000, intervals: [500, 1000, 2000] }).toMatchObject({
    taskId,
    displayType: 'image',
  });
  const output = await readOutput();
  expect(output?.url).toBeTruthy();
  const debugOutputResponse = await page.request.get('/studio_outputs?limit=200', { timeout: 10_000 });
  expect(debugOutputResponse.ok()).toBe(true);
  const debugOutputBody = (await debugOutputResponse.json()) as {
    outputs?: Array<{ id?: string; taskId?: string; displayType?: string; mediaHash?: string; url?: string }>;
  };
  const debugOutput =
    debugOutputBody.outputs?.find((candidate) => candidate.taskId === taskId && candidate.displayType === 'text') ??
    null;
  expect(debugOutput).toMatchObject({ taskId, displayType: 'text' });
  if (evidenceRoot) {
    const asset = await page.request.get(new URL(output!.url!, page.url()).toString());
    expect(asset.ok()).toBe(true);
    await writeFile(`${evidenceRoot}/qwen-v2-custom-user-node.webp`, await asset.body());
    await writeFile(
      `${evidenceRoot}/execution-receipt.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          source: 'visible_frontend_current_v2_custom_user_node',
          workflowId,
          rootId,
          savedDefinition,
          customized,
          rebasedBeforeRefresh,
          restored,
          model: {
            repository: 'Qwen/Qwen-Image-2512',
            revision: '25468b98e3276ca6700de15c6628e51b7de54a26',
          },
          runtimeHints: {
            clientRunId: submittedGraph.runtimeHints?.clientRunId,
            workflowTabId: submittedGraph.runtimeHints?.workflowTabId,
            workflowTitle: submittedGraph.runtimeHints?.workflowTitle,
          },
          taskId,
          output: {
            id: output?.id,
            taskId: output?.taskId,
            displayType: output?.displayType,
            mediaHash: output?.mediaHash,
            url: output?.url,
          },
          debugOutput: {
            id: debugOutput?.id,
            taskId: debugOutput?.taskId,
            displayType: debugOutput?.displayType,
            mediaHash: debugOutput?.mediaHash,
            url: debugOutput?.url,
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await page.screenshot({ path: `${evidenceRoot}/frontend-after-run.png`, fullPage: false, timeout: 120_000 });
  }
});

test('saved customized current-V2 Qwen User Node survives a full backend restart', async ({ page }) => {
  const workflowId = process.env.MODIFF_QWEN_V2_CUSTOM_RESTART_WORKFLOW_ID;
  const definitionId = process.env.MODIFF_QWEN_V2_CUSTOM_RESTART_DEFINITION_ID;
  test.skip(!workflowId || !definitionId, 'Provide the retained workflow and User Node definition ids after restart.');
  test.setTimeout(5 * 60 * 1000);
  page.setDefaultTimeout(60_000);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('left-tab-workflows').click();
  const savedRow = page.getByTestId(`saved-workflow-${workflowId}`);
  await expect(savedRow).toBeVisible({ timeout: 120_000 });
  await savedRow.locator('button:not([aria-label])').click();
  await expect
    .poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().studio.activeWorkflowTabId), {
      timeout: 120_000,
    })
    .toBe(workflowId);
  const restored = await page.evaluate(
    async ({ definitionId }) => {
      const [{ useFlowStore }, { useUserBlockStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useUserBlockStore.ts'),
      ]);
      const instance = useFlowStore
        .getState()
        .nodes.find((node) => node.data.blockInstanceV2?.definitionRef.definitionId === definitionId)
        ?.data.blockInstanceV2;
      const definition = useUserBlockStore
        .getState()
        .blockDefinitionsV2.find((candidate) => candidate.definitionId === definitionId);
      return {
        definition: definition
          ? {
              definitionId: definition.definitionId,
              sourceKind: definition.source.kind,
              parentDefinitionId: definition.source.parent?.definitionId ?? null,
              graphHash: definition.graph.graphHash,
            }
          : null,
        instance: instance
          ? {
              definitionId: instance.definitionRef.definitionId,
              sourceKind: instance.definitionSnapshot.source.kind,
              graphHash: instance.customization.effectiveGraphHash,
              nodeActions: instance.effectiveGraph.nodes.map(({ data }) => data.action).sort(),
              semanticEdges: instance.effectiveGraph.edges.map(
                ({ sourceNodeId, sourcePortId, targetNodeId, targetPortId }) =>
                  `${sourceNodeId}:${sourcePortId}>${targetNodeId}:${targetPortId}`,
              ),
              values: instance.values,
            }
          : null,
      };
    },
    { definitionId: definitionId! },
  );
  expect(restored.definition).toMatchObject({
    definitionId,
    sourceKind: 'user',
    parentDefinitionId: 'diffusers.cluster-admission:QwenImageModularPipeline:text2image:mode:text_to_image',
  });
  expect(restored.instance).toMatchObject({
    definitionId,
    sourceKind: 'user',
    graphHash: restored.definition!.graphHash,
    values: {
      prompt:
        'A precision clockmaker assembling a transparent astronomical watch beneath a skylight, brass gears, sapphire bridges, fine workshop dust, controlled cinematic light, crisp macro product photography.',
      width: 640,
      height: 640,
      num_inference_steps: 12,
      guidanceScale: 4,
      seed: 424242,
    },
  });
  expect(restored.instance?.nodeActions).toContain('DataViewer');
  expect(restored.instance?.semanticEdges.some((edge) => edge.endsWith(':value'))).toBe(true);
  await expect(
    page.locator('.react-flow__node-block').filter({ hasText: 'Qwen Image — Text To Image — Workflow 2' }),
  ).toBeVisible();
});

test('live backend exposes every reviewed Diffusers workflow as an insertable structural Cluster Node', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('diffusers-live-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('diffusers-live-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(async () => {
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    await useNodesStore.getState().fetchStudioModelCapabilities();
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
          return useNodesStore.getState().discoveryRequests.capabilities.status;
        }),
      { timeout: 120_000 },
    )
    .not.toBe('loading');
  const capabilityState = await page.evaluate(async () => {
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    return useNodesStore.getState().discoveryRequests.capabilities;
  });
  expect(capabilityState).toMatchObject({ status: 'success', error: null });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });

  const definitionCount = await page.evaluate(async () => {
    const response = await fetch('/huggingface/node-library');
    if (!response.ok) throw new Error(`Hugging Face node library returned ${response.status}.`);
    const library = (await response.json()) as {
      definitions?: Array<{ provider?: string }>;
    };
    return (library.definitions ?? []).filter((definition) => definition.provider === 'diffusers').length;
  });
  expect(definitionCount).toBe(95);

  const catalogState = await page.evaluate(async () => {
    const response = await fetch('/huggingface/node-library');
    const raw = await response.json();
    const { parseHuggingFaceNodeLibrary } = await import('/src/studio/huggingFaceNodeLibrary.ts');
    let parserError: string | null = null;
    try {
      parseHuggingFaceNodeLibrary(raw);
    } catch (error) {
      parserError = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    }
    const { useHuggingFaceNodeLibraryStore } = await import('/src/stores/useHuggingFaceNodeLibraryStore.ts');
    await useHuggingFaceNodeLibraryStore.getState().fetchLibrary();
    const state = useHuggingFaceNodeLibraryStore.getState();
    return {
      loaded: state.loaded,
      error: state.error,
      definitions: state.library?.definitions.length ?? 0,
      parserError,
    };
  });
  expect(catalogState).toEqual({ loaded: true, error: null, definitions: 103, parserError: null });

  const taskLauncher = page.getByTestId('task-launcher');
  if (await taskLauncher.isVisible()) {
    await taskLauncher.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(taskLauncher).toHaveCount(0);
  }
  await page.getByTestId('left-tab-nodes').click();
  const retryCatalog = page.getByRole('button', { name: 'Retry catalog' });
  if (await retryCatalog.isVisible()) await retryCatalog.click();
  const clusterGroup = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(clusterGroup).toBeVisible({ timeout: 30_000 });
  await clusterGroup.getByRole('button').first().click();
  const clusterRows = clusterGroup.locator('[data-testid^="hugging-face-node-row-"]');
  await expect(clusterRows).toHaveCount(definitionCount);
  await expect(clusterRows.locator('[aria-disabled="true"]')).toHaveCount(0);

  await page.getByLabel('Search nodes').fill('Helios Pyramid Distilled — Text To Video');
  const helios = page
    .getByTestId('node-group-Diffusers-Cluster-Nodes')
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Helios Pyramid Distilled — Text To Video' });
  await expect(helios).toHaveCount(1);
  await expect(helios).toHaveAttribute('data-readiness', 'graph_qualified');
  await helios.click();

  const root = page
    .locator('.react-flow__node-block')
    .filter({ has: page.locator('[data-block-schema-version="2"]') })
    .filter({ hasText: 'Helios Pyramid Distilled' });
  await expect(root).toBeVisible();
  const rootId = await root.getAttribute('data-id');
  expect(rootId).toBeTruthy();
  await expect(root.getByTestId(`user-block-${rootId}`)).toHaveAttribute('data-block-source', 'diffusers_catalog');
  await expect(page.locator('[data-cluster-role]')).toHaveCount(0);

  const persistedPrompt = 'A brass observatory above monsoon clouds';
  const blockPrompt = root.getByLabel('prompt', { exact: true });
  await blockPrompt.fill(persistedPrompt);
  await blockPrompt.blur();
  await page.evaluate(
    async ({ instanceId }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      const rootNode = flow.nodes.find((node) => node.id === instanceId);
      const instance = rootNode?.data.blockInstanceV2;
      if (!instance) throw new Error('The Helios Block V2 instance is unavailable.');
      const setField = (fieldId: string, value: string | number) => {
        const control = instance.effectiveInterface.controls.find(({ binding }) => binding.fieldId === fieldId);
        if (!control) throw new Error(`The Helios Block V2 control ${fieldId} is unavailable.`);
        useFlowStore.getState().setBlockInstanceValueV2(instanceId, control.controlId, value);
      };
      setField('width', 576);
      setField('height', 320);
      setField('num_frames', 33);
    },
    { instanceId: rootId! },
  );

  const inspect = () =>
    page.evaluate(async (instanceId) => {
      const [{ useFlowStore }, runtime] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/studio/blockRuntimeV2.ts'),
      ]);
      const flow = useFlowStore.getState();
      const rootNode = flow.nodes.find((node) => node.id === instanceId);
      const instance = rootNode?.data.blockInstanceV2;
      if (!rootNode || !instance) throw new Error('The Helios Block V2 instance is unavailable.');
      const execution = runtime.expandBlockGraphV2ForExecution(flow.nodes, flow.edges);
      return {
        definitionId: instance.definitionSnapshot.definitionId,
        definitionHash: instance.definitionSnapshot.contentHash,
        sourceKind: instance.definitionSnapshot.source.kind,
        values: instance.values,
        expanded: instance.presentation.expanded,
        effectiveGraphHash: instance.customization.effectiveGraphHash,
        effectiveInterfaceHash: instance.effectiveInterface.effectiveInterfaceHash,
        projectionNodeCount: flow.nodes.filter((node) => node.data.blockProjectionOwnerId === instanceId).length,
        projectionEdgeCount: flow.edges.filter((edge) => edge.data?.blockProjectionOwnerId === instanceId).length,
        executionActions: execution.nodes.map((node) => `${node.data.module}.${node.data.action}`).sort(),
        executionEdges: execution.edges
          .map(
            ({ source, sourceHandle, target, targetHandle }) =>
              `${source}:${sourceHandle ?? ''}>${target}:${targetHandle ?? ''}`,
          )
          .sort(),
      };
    }, rootId!);

  const collapsed = await inspect();
  expect(collapsed).toMatchObject({
    definitionId:
      'diffusers.cluster-admission:HeliosPyramidDistilledModularPipeline:text2video:workflow:official_top_level_blocks',
    sourceKind: 'diffusers_catalog',
    values: expect.objectContaining({
      prompt: persistedPrompt,
      width: 576,
      height: 320,
      num_frames: 33,
    }),
    expanded: false,
    projectionNodeCount: 0,
    projectionEdgeCount: 0,
  });
  expect(collapsed.executionActions).toEqual(
    expect.arrayContaining([
      'modules.ModularDiffusers.ModelsLoader',
      'modules.ModularDiffusers.WorkflowTextEncode',
      'modules.ModularDiffusers.WorkflowVideoDenoise',
      'modules.ModularDiffusers.WorkflowDecodeVideo',
      'modules.Video.Export',
    ]),
  );

  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  await expect(root.getByTestId(`user-block-toggle-${rootId}`)).toHaveAccessibleName('Collapse block');
  const expanded = await inspect();
  expect(expanded.projectionNodeCount).toBeGreaterThan(0);
  expect(expanded.projectionEdgeCount).toBeGreaterThan(0);
  expect(expanded.executionActions).toEqual(collapsed.executionActions);
  expect(expanded.executionEdges).toEqual(collapsed.executionEdges);

  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('Diffusers Helios Block Persistence Proof');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const studio = window.__MODIFF_E2E__!.getState().studio;
          return studio.workflowTabs.find((tab: { id: string }) => tab.id === studio.activeWorkflowTabId)?.dirty;
        }),
      { timeout: 30_000 },
    )
    .toBe(false);

  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const activity = page.getByRole('region', { name: 'Session activity' });
  if (await activity.isVisible()) {
    const clear = activity.getByRole('button', { name: 'Clear' });
    if (await clear.isVisible()) await clear.click();
  }
  if (outputDirectory) {
    await page.screenshot({
      path: `${outputDirectory}/diffusers-helios-structural-cluster-expanded.png`,
      fullPage: true,
    });
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });
  const restoredRoot = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
  await expect(restoredRoot).toBeVisible({ timeout: 30_000 });
  await expect(restoredRoot.getByTestId(`user-block-${rootId}`)).toHaveAttribute(
    'data-block-source',
    'diffusers_catalog',
  );
  await expect(restoredRoot.getByTestId(`user-block-toggle-${rootId}`)).toHaveAccessibleName('Collapse block');
  const restored = await inspect();
  expect(restored).toMatchObject({
    definitionId: collapsed.definitionId,
    definitionHash: collapsed.definitionHash,
    sourceKind: 'diffusers_catalog',
    values: collapsed.values,
    expanded: true,
    effectiveGraphHash: collapsed.effectiveGraphHash,
    effectiveInterfaceHash: collapsed.effectiveInterfaceHash,
  });
  expect(restored.executionActions).toEqual(collapsed.executionActions);
  expect(restored.executionEdges).toEqual(collapsed.executionEdges);
  await restoredRoot.getByTestId(`user-block-toggle-${rootId}`).click();
  await expect(restoredRoot.getByTestId(`user-block-toggle-${rootId}`)).toHaveAccessibleName('Expand block');
  await expect(restoredRoot.getByLabel('prompt', { exact: true })).toHaveValue(persistedPrompt);
  if (outputDirectory) {
    await page.screenshot({
      path: `${outputDirectory}/diffusers-helios-cluster-save-refresh.png`,
      fullPage: true,
    });
  }
});

test('live HunyuanVideo 1.5 structural Cluster preserves parameters without exposing gated execution', async ({
  page,
}) => {
  test.setTimeout(3 * 60 * 1000);
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('hunyuan-video-15-structural-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('hunyuan-video-15-structural-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });

  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 30_000 });
  await group.getByRole('button').first().click();
  await page.getByLabel('Search nodes').fill('Hunyuan Video15 — Text To Video');
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Hunyuan Video15 — Text To Video' });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-readiness', 'catalog_only');
  await expect(row).not.toHaveAttribute('aria-disabled', 'true');
  await row.click();

  let root = page.locator('[data-cluster-role="root"]').filter({ hasText: 'Hunyuan Video15 — Text To Video' });
  await expect(root).toBeVisible();
  await expect(root.getByRole('button', { name: 'Prepare qualification run' })).toHaveCount(0);
  await expect(root.getByLabel('Customize Cluster as User Node')).toBeDisabled();
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  await expect(root.getByLabel('Collapse Diffusers Cluster Node')).toBeVisible();
  const hierarchy = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore
      .getState()
      .nodes.filter((node) => node.data.huggingFaceClusterRole === 'block')
      .map((node) => ({
        path: node.data.huggingFaceClusterPath,
        status: node.data.huggingFaceClusterConditionalStatus,
        selected: node.data.huggingFaceClusterSelectedBlockName,
      }));
  });
  expect(hierarchy.map((node) => node.path)).toEqual(
    expect.arrayContaining([
      'text_encoder',
      'vae_encoder',
      'vae_encoder/vae_encoder',
      'image_encoder',
      'image_encoder/image_encoder',
      'denoise',
      'denoise/image2video',
      'denoise/text2video',
      'decode',
    ]),
  );
  expect(hierarchy.find((node) => node.path === 'vae_encoder')).toMatchObject({ status: 'skipped', selected: null });
  expect(hierarchy.find((node) => node.path === 'image_encoder')).toMatchObject({
    status: 'skipped',
    selected: null,
  });
  expect(hierarchy.find((node) => node.path === 'denoise')).toMatchObject({
    status: 'active',
    selected: 'text2video',
  });
  expect(hierarchy.find((node) => node.path === 'denoise/image2video')).toMatchObject({ status: 'inactive' });
  expect(hierarchy.find((node) => node.path === 'denoise/text2video')).toMatchObject({ status: 'active' });

  const textEncoder = page.locator('[data-cluster-role="block"][data-cluster-path="text_encoder"]');
  await textEncoder.getByLabel('Expand Diffusers Block Node parameters').click();
  const prompt = 'A hand-built lunar greenhouse drifting above monsoon clouds';
  await textEncoder.getByLabel('prompt', { exact: true }).fill(prompt);
  await textEncoder.getByLabel('prompt', { exact: true }).blur();
  await page.evaluate(() => {
    const cluster = window.__MODIFF_E2E__!.getState().flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
    if (!cluster) throw new Error('HunyuanVideo 1.5 Cluster root is unavailable.');
    return import('/src/stores/useFlowStore.ts').then(({ useFlowStore }) => {
      const flow = useFlowStore.getState();
      flow.setHuggingFaceClusterParameter(cluster.id, 'width', 768);
      flow.setHuggingFaceClusterParameter(cluster.id, 'height', 448);
      flow.setHuggingFaceClusterParameter(cluster.id, 'num_frames', 49);
      flow.setHuggingFaceClusterParameter(cluster.id, 'num_inference_steps', 17);
      flow.setHuggingFaceClusterParameter(cluster.id, 'num_videos_per_prompt', 2);
    });
  });

  const beforeSave = await page.evaluate(() => {
    const cluster = window.__MODIFF_E2E__!.getState().flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
    return cluster
      ? {
          definitionId: cluster.huggingFaceClusterInstance?.definition.id,
          overrides: cluster.huggingFaceClusterInstance?.parameterOverrides,
          execution: cluster.huggingFaceClusterInstance?.execution ?? null,
          expanded: cluster.huggingFaceClusterInstance?.presentation,
        }
      : null;
  });
  expect(beforeSave).toEqual({
    definitionId: 'diffusers.modular:HunyuanVideo15ModularPipeline:text2video',
    overrides: {
      prompt,
      width: 768,
      height: 448,
      num_frames: 49,
      num_inference_steps: 17,
      num_videos_per_prompt: 2,
    },
    execution: null,
    expanded: { expanded: true, expandedPaths: ['text_encoder'] },
  });

  await page.getByTestId('topbar-save-workflow').click();
  const dialog = page.getByTestId('save-workflow-dialog');
  if (await dialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('HunyuanVideo 1.5 Structural Persistence Proof');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(dialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });

  root = page.locator('[data-cluster-role="root"]').filter({ hasText: 'Hunyuan Video15 — Text To Video' });
  await expect(root.getByLabel('Collapse Diffusers Cluster Node')).toBeVisible({ timeout: 30_000 });
  const restoredTextEncoder = page.locator('[data-cluster-role="block"][data-cluster-path="text_encoder"]');
  await expect(restoredTextEncoder.getByLabel('prompt', { exact: true })).toHaveValue(prompt);
  const afterRefresh = await page.evaluate(() => {
    const cluster = window.__MODIFF_E2E__!.getState().flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
    return cluster
      ? {
          definitionId: cluster.huggingFaceClusterInstance?.definition.id,
          overrides: cluster.huggingFaceClusterInstance?.parameterOverrides,
          execution: cluster.huggingFaceClusterInstance?.execution ?? null,
          expanded: cluster.huggingFaceClusterInstance?.presentation,
        }
      : null;
  });
  expect(afterRefresh).toEqual(beforeSave);
  await expect(root.getByRole('button', { name: 'Prepare qualification run' })).toHaveCount(0);

  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  if (outputDirectory) {
    await page.screenshot({
      path: `${outputDirectory}/diffusers-hunyuan-video-15-structural-save-refresh.png`,
      fullPage: true,
    });
  }
});

test('live Stable Diffusion 3 structural Cluster preserves nested edits without exposing gated execution', async ({
  page,
}) => {
  test.setTimeout(3 * 60 * 1000);
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('stable-diffusion-3-structural-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('stable-diffusion-3-structural-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });

  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 30_000 });
  await group.getByRole('button').first().click();
  await page.getByLabel('Search nodes').fill('Stable Diffusion3 — Image To Image');
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Stable Diffusion3 — Image To Image' });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-readiness', 'catalog_only');
  await expect(row).not.toHaveAttribute('aria-disabled', 'true');
  await row.click();

  let root = page.locator('[data-cluster-role="root"]').filter({ hasText: 'Stable Diffusion3 — Image To Image' });
  await expect(root).toBeVisible();
  await expect(root.getByRole('button', { name: 'Prepare qualification run' })).toHaveCount(0);
  await expect(root.getByLabel('Customize Cluster as User Node')).toBeDisabled();
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  const hierarchy = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore
      .getState()
      .nodes.filter((node) => node.data.huggingFaceClusterRole === 'block')
      .map((node) => ({
        path: node.data.huggingFaceClusterPath,
        status: node.data.huggingFaceClusterConditionalStatus,
        selected: node.data.huggingFaceClusterSelectedBlockName,
      }));
  });
  expect(hierarchy.map((node) => node.path)).toEqual(
    expect.arrayContaining([
      'text_encoder',
      'vae_encoder',
      'vae_encoder/img2img',
      'vae_encoder/img2img/preprocess',
      'vae_encoder/img2img/encode',
      'denoise',
      'denoise/img2img',
      'denoise/img2img/text_inputs',
      'denoise/img2img/additional_inputs',
      'denoise/img2img/prepare_latents',
      'denoise/img2img/set_timesteps',
      'denoise/img2img/prepare_img2img_latents',
      'denoise/img2img/denoise',
      'denoise/img2img/denoise/denoiser',
      'denoise/img2img/denoise/after_denoiser',
      'denoise/text2image',
      'decode',
    ]),
  );
  expect(hierarchy.find((node) => node.path === 'vae_encoder')).toMatchObject({ status: 'skipped', selected: null });
  expect(hierarchy.find((node) => node.path === 'denoise')).toMatchObject({
    status: 'active',
    selected: 'text2image',
  });
  expect(hierarchy.find((node) => node.path === 'denoise/img2img')).toMatchObject({ status: 'inactive' });
  expect(hierarchy.find((node) => node.path === 'denoise/text2image')).toMatchObject({ status: 'active' });

  const textEncoder = page.locator('[data-cluster-role="block"][data-cluster-path="text_encoder"]');
  await textEncoder.getByLabel('Expand Diffusers Block Node parameters').click();
  const prompt = 'A rain-polished brutalist museum containing a luminous garden';
  await textEncoder.getByLabel('prompt', { exact: true }).fill(prompt);
  await textEncoder.getByLabel('prompt', { exact: true }).blur();
  await page.evaluate(() => {
    const cluster = window.__MODIFF_E2E__!.getState().flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
    if (!cluster) throw new Error('Stable Diffusion 3 Cluster root is unavailable.');
    return import('/src/stores/useFlowStore.ts').then(({ useFlowStore }) => {
      const flow = useFlowStore.getState();
      flow.setHuggingFaceClusterParameter(cluster.id, 'width', 896);
      flow.setHuggingFaceClusterParameter(cluster.id, 'height', 640);
      flow.setHuggingFaceClusterParameter(cluster.id, 'num_inference_steps', 24);
      flow.setHuggingFaceClusterParameter(cluster.id, 'strength', 0.72);
      flow.setHuggingFaceClusterParameter(cluster.id, 'max_sequence_length', 384);
    });
  });

  const beforeSave = await page.evaluate(() => {
    const cluster = window.__MODIFF_E2E__!.getState().flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
    return cluster
      ? {
          definitionId: cluster.huggingFaceClusterInstance?.definition.id,
          overrides: cluster.huggingFaceClusterInstance?.parameterOverrides,
          execution: cluster.huggingFaceClusterInstance?.execution ?? null,
          expanded: cluster.huggingFaceClusterInstance?.presentation,
        }
      : null;
  });
  expect(beforeSave).toEqual({
    definitionId: 'diffusers.modular:StableDiffusion3ModularPipeline:image2image',
    overrides: {
      prompt,
      width: 896,
      height: 640,
      num_inference_steps: 24,
      strength: 0.72,
      max_sequence_length: 384,
    },
    execution: null,
    expanded: { expanded: true, expandedPaths: ['text_encoder'] },
  });

  await page.getByTestId('topbar-save-workflow').click();
  const dialog = page.getByTestId('save-workflow-dialog');
  if (await dialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('Stable Diffusion 3 Structural Persistence Proof');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(dialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });

  root = page.locator('[data-cluster-role="root"]').filter({ hasText: 'Stable Diffusion3 — Image To Image' });
  await expect(root.getByLabel('Collapse Diffusers Cluster Node')).toBeVisible({ timeout: 30_000 });
  const restoredTextEncoder = page.locator('[data-cluster-role="block"][data-cluster-path="text_encoder"]');
  await expect(restoredTextEncoder.getByLabel('prompt', { exact: true })).toHaveValue(prompt);
  const afterRefresh = await page.evaluate(() => {
    const cluster = window.__MODIFF_E2E__!.getState().flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
    return cluster
      ? {
          definitionId: cluster.huggingFaceClusterInstance?.definition.id,
          overrides: cluster.huggingFaceClusterInstance?.parameterOverrides,
          execution: cluster.huggingFaceClusterInstance?.execution ?? null,
          expanded: cluster.huggingFaceClusterInstance?.presentation,
        }
      : null;
  });
  expect(afterRefresh).toEqual(beforeSave);
  await expect(root.getByRole('button', { name: 'Prepare qualification run' })).toHaveCount(0);

  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  if (outputDirectory) {
    await page.screenshot({
      path: `${outputDirectory}/diffusers-stable-diffusion-3-structural-save-refresh.png`,
      fullPage: true,
    });
  }
});

test('live Wan Animate 2 Cluster preserves customized official blocks across save, refresh, and expansion', async ({
  page,
}) => {
  test.setTimeout(5 * 60 * 1000);
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('wan-animate-2-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('wan-animate-2-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await page.evaluate(async () => {
    const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
    ]);
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
    ]);
  });

  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 30_000 });
  await group.getByRole('button').first().click();
  const label = 'Wan Animate2 Distilled — Character Animate';
  await page.getByLabel('Search nodes').fill(label);
  const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: label });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
  await row.click();

  let root = page.locator('[data-cluster-role="root"]').filter({ hasText: label });
  await expect(root).toBeVisible();
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  await expect(root.getByLabel('Collapse Diffusers Cluster Node')).toBeVisible();
  const officialPaths = ['text_encoder', 'image_encoder', 'video_encoder', 'vae_encoder', 'denoise', 'decode'];
  const expandedPaths = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore
      .getState()
      .nodes.filter((node) => node.data.huggingFaceClusterRole === 'block')
      .map((node) => node.data.huggingFaceClusterPath);
  });
  expect(expandedPaths).toEqual(expect.arrayContaining(officialPaths));

  const textEncoder = page.locator('[data-cluster-role="block"][data-cluster-path="text_encoder"]');
  await textEncoder.getByLabel('Expand Diffusers Block Node parameters').click();
  const prompt = 'A dancer in a red coat follows the driving performance, technical persistence proof';
  const promptRef = 'A source performer demonstrates the exact movement sequence';
  await textEncoder.getByLabel('prompt', { exact: true }).fill(prompt);
  await textEncoder.getByLabel('prompt', { exact: true }).blur();
  await page.evaluate(async (referencePrompt) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const flow = useFlowStore.getState();
    const cluster = flow.nodes.find((node) => node.data.huggingFaceClusterRole === 'root');
    if (!cluster) throw new Error('Wan Animate 2 Cluster root is unavailable.');
    flow.setHuggingFaceClusterParameter(cluster.id, 'width', 768);
    flow.setHuggingFaceClusterParameter(cluster.id, 'height', 512);
    flow.setHuggingFaceClusterParameter(cluster.id, 'prompt_ref', referencePrompt);
    flow.setHuggingFaceClusterParameter(cluster.id, 'segment_frame_length', 41);
    flow.setHuggingFaceClusterParameter(cluster.id, 'prev_segment_conditioning_frames', 2);
    flow.setHuggingFaceClusterParameter(cluster.id, 'num_inference_steps', 12);
    flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'fps', 20);
    flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'guidanceScale', 1);
    flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'seed', 280828);
  }, promptRef);

  const snapshot = () =>
    page.evaluate(async () => {
      const [flowModule, nodesModule, libraryModule, materializer, runtime] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useNodeStore.ts'),
        import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
        import('/src/studio/huggingFaceClusterMaterializer.ts'),
        import('/src/studio/huggingFaceClusterRuntime.ts'),
      ]);
      const { useFlowStore } = flowModule;
      const flow = useFlowStore.getState();
      const cluster = flow.nodes.find((node) => node.data.huggingFaceClusterRole === 'root');
      if (!cluster?.data.huggingFaceClusterInstance) return null;
      const instance = cluster.data.huggingFaceClusterInstance;
      const definition = libraryModule.useHuggingFaceNodeLibraryStore
        .getState()
        .library?.definitions.find((candidate) => candidate.id === instance.definition.id);
      const admission = definition?.executionAdmissions.find(
        (candidate) => candidate.id === instance.execution?.admissionId,
      );
      const spec = nodesModule.useNodesStore
        .getState()
        .studioModelCapabilities.find((capability) => capability.modelType === definition?.pipelineClass)
        ?.studioExecutionSpecs?.find((candidate) => candidate.id === admission?.studioExecutionSpec?.id);
      if (!definition || !admission || !spec) {
        throw new Error(
          `The exact Wan Animate 2 materialization contract is unavailable: ${JSON.stringify({
            definition: definition?.id ?? null,
            admission: admission?.id ?? null,
            requestedSpec: admission?.studioExecutionSpec?.id ?? null,
            modelType: definition?.pipelineClass ?? null,
            capabilityModelTypes: nodesModule.useNodesStore
              .getState()
              .studioModelCapabilities.filter((capability) => capability.modelType.includes('WanAnimate'))
              .map((capability) => capability.modelType),
          })}`,
        );
      }
      const skeleton = materializer.materializeHuggingFaceClusterExecutionSkeleton({
        definition,
        instance,
        admission,
        executionSpec: spec,
        nodesRegistry: nodesModule.useNodesStore.getState().nodesRegistry,
        bindingValues: runtime.provisionalHuggingFaceClusterExecutionParameterValues(definition, instance, admission),
        expanded: false,
      });
      const graph = materializer.canonicalHuggingFaceClusterExecutionSnapshot(skeleton);
      return {
        definitionId: instance.definition.id,
        overrides: instance.parameterOverrides,
        executionOverrides: instance.execution?.parameterOverrides,
        effective: Object.fromEntries(Object.entries(cluster.data.params).map(([name, field]) => [name, field.value])),
        graph,
      };
    });
  const beforeSave = await snapshot();
  expect(beforeSave).toMatchObject({
    definitionId: 'diffusers.modular:WanAnimate2DistilledModularPipeline:default',
    overrides: {
      prompt,
      prompt_ref: promptRef,
      width: 768,
      height: 512,
      segment_frame_length: 41,
      prev_segment_conditioning_frames: 2,
      num_inference_steps: 12,
    },
    executionOverrides: { fps: 20, guidanceScale: 1, seed: 280828 },
  });
  const actions = beforeSave!.graph.nodes.map((node) => `${node.module}.${node.action}`);
  expect(actions).toEqual(
    expect.arrayContaining([
      'modules.ModularDiffusers.ModelsLoader',
      'modules.ModularDiffusers.WorkflowWanAnimateTextEncode',
      'modules.ModularDiffusers.WorkflowWanAnimateImageEncode',
      'modules.ModularDiffusers.WorkflowWanAnimateVideoEncode',
      'modules.ModularDiffusers.WorkflowWanAnimateVaeEncode',
      'modules.ModularDiffusers.WorkflowWanAnimateDenoise',
      'modules.ModularDiffusers.WorkflowWanAnimateDecode',
      'modules.Video.Export',
    ]),
  );
  const promptExecutionParams = beforeSave!.graph.nodes.find((node) => node.role === 'prompt')?.params;
  expect(promptExecutionParams?.find((param) => param.field === 'prompt_ref')?.value).toBe(promptRef);
  const videoExecutionParams = beforeSave!.graph.nodes.find((node) => node.role === 'videoEncode')?.params;
  expect(videoExecutionParams?.find((param) => param.field === 'segment_frame_length')?.value).toBe(41);
  expect(videoExecutionParams?.find((param) => param.field === 'prev_segment_conditioning_frames')?.value).toBe(2);

  await root.getByLabel('Collapse Diffusers Cluster Node').click();
  expect((await snapshot())!.graph).toEqual(beforeSave!.graph);
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  expect((await snapshot())!.graph).toEqual(beforeSave!.graph);

  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('Wan Animate 2 Cluster Persistence Proof');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);

  root = page.locator('[data-cluster-role="root"]').filter({ hasText: label });
  await expect(root.getByLabel('Collapse Diffusers Cluster Node')).toBeVisible({ timeout: 30_000 });
  const afterRefresh = await snapshot();
  expect(afterRefresh).toEqual(beforeSave);
  const restoredTextEncoder = page.locator('[data-cluster-role="block"][data-cluster-path="text_encoder"]');
  await expect(restoredTextEncoder.getByLabel('Collapse Diffusers Block Node parameters')).toBeVisible();
  await expect(restoredTextEncoder.getByLabel('prompt', { exact: true })).toHaveValue(prompt);

  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  if (outputDirectory) {
    const evidenceRoot = `${outputDirectory}/wan-animate-2-cluster`;
    await mkdir(evidenceRoot, { recursive: true });
    await page.screenshot({ path: `${evidenceRoot}/save-refresh-expanded.png`, fullPage: true });
    await writeFile(
      `${evidenceRoot}/frontend-persistence-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          definitionId: afterRefresh!.definitionId,
          officialPaths,
          overrides: afterRefresh!.overrides,
          executionOverrides: afterRefresh!.executionOverrides,
          collapsedExpandedGraphEquivalent: true,
          saveRefreshGraphEquivalent: true,
          generatedAsset: null,
          generationBlockedBy: ['exact_snapshot_not_installed', 'compiled_flex_attention_qualification_pending'],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live selected Wan Animate 2 exact snapshot installs through Model Manager', async ({ page }) => {
  const baseRequested = process.env.MODIFF_INSTALL_WAN_ANIMATE_2_BASE === '1';
  test.skip(
    !baseRequested && process.env.MODIFF_INSTALL_WAN_ANIMATE_2_DISTILLED !== '1',
    'An immutable Wan Animate 2 snapshot must be selected explicitly.',
  );
  test.setTimeout(6 * 60 * 60 * 1000);
  const variant = wanAnimate2QualificationVariant(baseRequested);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/${variant.evidenceDirectory}` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
  const { modelType, repo, revision } = variant;

  await page.addInitScript((sessionKey) => {
    if (window.sessionStorage.getItem(sessionKey)) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem(sessionKey, 'initialized');
  }, `${variant.evidenceDirectory}-install`);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await expect(autoToggle).toHaveAttribute('aria-checked', 'false');

  const transformersRuntimeId = 'huggingface-transformers-main-96fe6dce-peft-0.20.0';
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/stores/useSettingsStore.ts');
    useSettingsStore.getState().setRightPanelOpen(true);
    useSettingsStore.getState().setRightPanelTab('setup');
  });
  const runtimeRow = page.getByTestId(`optional-runtime-${transformersRuntimeId}`);
  await expect(runtimeRow).toBeVisible({ timeout: 30_000 });
  const installRuntime = runtimeRow.getByRole('button', { name: /^(Install|Repair)$/u });
  if (await installRuntime.isVisible()) {
    const action = (await installRuntime.textContent())?.trim() || 'Install';
    await installRuntime.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/optional runtime/u);
    await dialog.getByRole('button', { name: action, exact: true }).click();
    await expect(runtimeRow.getByRole('button', { name: 'Activate', exact: true })).toBeVisible({
      timeout: 30 * 60 * 1000,
    });
  }
  const activateRuntime = runtimeRow.getByRole('button', { name: 'Activate', exact: true });
  if (await activateRuntime.isVisible()) {
    await activateRuntime.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/Activate validated/u);
    await dialog.getByRole('button', { name: 'Activate', exact: true }).click();
  }
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          try {
            const response = await fetch('/runtime/optional-runtimes');
            if (!response.ok) return 'restarting:restarting';
            const body = (await response.json()) as {
              overlay?: { processLoadStatus?: string };
              profiles?: Array<{ id?: string; overlayStatus?: string }>;
            };
            const profile = body.profiles?.find((candidate) => candidate.id === id);
            return `${body.overlay?.processLoadStatus ?? 'unknown'}:${profile?.overlayStatus ?? 'unknown'}`;
          } catch {
            return 'restarting:restarting';
          }
        }, transformersRuntimeId),
      { timeout: 5 * 60 * 1000, intervals: [1000, 2000, 5000] },
    )
    .toBe('active:active');
  await expect
    .poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().websocket.isConnected), {
      timeout: 120_000,
    })
    .toBe(true);
  await page.evaluate(async () => {
    const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
    ]);
    await Promise.all([
      useNodesStore.getState().fetchOptionalRuntimes(),
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useNodesStore.getState().refreshModelIndexes(true),
      useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
    ]);
  });

  const capability = await page.evaluate(async (requestedModelType) => {
    const body = (await (await fetch('/model_capabilities')).json()) as {
      capabilities?: Array<{
        modelType?: string;
        defaultRepo?: string;
        revisionCandidates?: string[];
        downloadFiles?: string[];
      }>;
    };
    return body.capabilities?.find((candidate) => candidate.modelType === requestedModelType) ?? null;
  }, modelType);
  expect(capability).toMatchObject({ defaultRepo: repo, revisionCandidates: [revision] });
  expect(capability?.downloadFiles).toHaveLength(30);

  await page.getByTestId('topbar-models').click();
  const manager = page.getByTestId('model-manager-dialog');
  await expect(manager).toBeVisible();
  const managerRow = manager.getByTestId(`model-manager-supported-${modelType}`);
  await expect(managerRow).toBeVisible({ timeout: 60_000 });
  await expect(managerRow).toHaveAttribute('data-model-repo', repo);
  const install = managerRow.getByTestId(`model-manager-install-${modelType}`);
  let exactInstallRequest: Record<string, unknown> | null = null;
  if ((await install.textContent())?.trim() !== 'Ready') {
    const requestPromise = page.waitForRequest(
      (request) => request.url().endsWith('/hf_download') && request.method() === 'POST',
      { timeout: 120_000 },
    );
    await install.click();
    const request = await requestPromise;
    exactInstallRequest = request.postDataJSON() as Record<string, unknown>;
    expect(exactInstallRequest).toMatchObject({
      repo_id: repo,
      revision,
      files: [...capability!.downloadFiles!].sort(),
    });
    if (evidenceRoot) {
      await page.screenshot({ path: `${evidenceRoot}/frontend-download-started.png`, fullPage: true });
    }
    await waitForModelManagerReady(install, 6 * 60 * 60 * 1000);
  }
  await expect(install).toHaveText('Ready');
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/frontend-model-ready.png`, fullPage: true });
    await writeFile(
      `${evidenceRoot}/frontend-install-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          modelType,
          repository: repo,
          revision,
          files: capability!.downloadFiles,
          fileCount: capability!.downloadFiles!.length,
          installedThroughFrontend: true,
          exactInstallRequest,
          modelManagerStatus: 'Ready',
          generationTested: false,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live selected Wan Animate 2 Cluster persists a bounded configuration and generates video', async ({ page }) => {
  const baseRequested = process.env.MODIFF_RUN_WAN_ANIMATE_2_BASE_GENERATION === '1';
  test.skip(
    !baseRequested && process.env.MODIFF_RUN_WAN_ANIMATE_2_DISTILLED_GENERATION !== '1',
    'The selected exact Wan Animate 2 snapshot must be installed before the qualification generation runs.',
  );
  test.setTimeout(8 * 60 * 60 * 1000);
  const variant = wanAnimate2QualificationVariant(baseRequested);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/${variant.evidenceDirectory}` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
  const { label, modelType, repo, revision } = variant;
  const prompt = 'A realistic calico cat walks steadily across sunlit green grass, natural animal motion';
  const promptRef = 'A calico cat walking from left to right';
  const referenceImage =
    '@data/qualification/local-review/hugging-face-clusters/wan-animate-2-distilled-live/reference-cat.png';
  const drivingVideo =
    '@data/qualification/local-review/hugging-face-clusters/wan-animate-2-distilled-live/driving-cat-9f.mp4';

  await page.addInitScript((sessionKey) => {
    if (window.sessionStorage.getItem(sessionKey)) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem(sessionKey, 'initialized');
  }, `${variant.evidenceDirectory}-generation`);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await expect(autoToggle).toHaveAttribute('aria-checked', 'false');
  await page.evaluate(async () => {
    const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
    ]);
    await Promise.all([
      useNodesStore.getState().fetchOptionalRuntimes(),
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useNodesStore.getState().refreshModelIndexes(true),
      useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
    ]);
  });
  const prerequisites = await page.evaluate(async (requestedModelType) => {
    const [runtimeResponse, capabilityResponse] = await Promise.all([
      fetch('/runtime/optional-runtimes'),
      fetch('/model_capabilities'),
    ]);
    const runtime = (await runtimeResponse.json()) as {
      overlay?: { processLoadStatus?: string };
      profiles?: Array<{ id?: string; overlayStatus?: string }>;
    };
    const capabilities = (await capabilityResponse.json()) as {
      capabilities?: Array<{ modelType?: string; defaultRepo?: string; revisionCandidates?: string[] }>;
    };
    return {
      overlay: runtime.overlay?.processLoadStatus,
      transformers: runtime.profiles?.find(
        (profile) => profile.id === 'huggingface-transformers-main-96fe6dce-peft-0.20.0',
      )?.overlayStatus,
      capability: capabilities.capabilities?.find((capability) => capability.modelType === requestedModelType),
    };
  }, modelType);
  expect(prerequisites).toMatchObject({
    overlay: 'active',
    transformers: 'active',
    capability: { defaultRepo: repo, revisionCandidates: [revision] },
  });

  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 30_000 });
  await group.getByRole('button').first().click();
  await page.getByLabel('Search nodes').fill(label);
  const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: label });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
  await row.click();

  let root = page.locator('[data-cluster-role="root"]').filter({ hasText: label });
  await expect(root).toBeVisible();
  await page.evaluate(
    async ({ drivingVideoValue, guidanceScaleValue, promptRefValue, promptValue, referenceImageValue }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      const cluster = flow.nodes.find((node) => node.data.huggingFaceClusterRole === 'root');
      if (!cluster) throw new Error('Wan Animate 2 Cluster root is unavailable.');
      flow.setHuggingFaceClusterParameter(cluster.id, 'prompt', promptValue);
      flow.setHuggingFaceClusterParameter(cluster.id, 'prompt_ref', promptRefValue);
      flow.setHuggingFaceClusterParameter(cluster.id, 'image', [referenceImageValue]);
      flow.setHuggingFaceClusterParameter(cluster.id, 'driving_video', drivingVideoValue);
      flow.setHuggingFaceClusterParameter(cluster.id, 'width', 256);
      flow.setHuggingFaceClusterParameter(cluster.id, 'height', 256);
      flow.setHuggingFaceClusterParameter(cluster.id, 'segment_frame_length', 9);
      // Use a non-default value so the persistence proof exercises an actual
      // serialized override instead of correctly eliding the default of 1.
      flow.setHuggingFaceClusterParameter(cluster.id, 'prev_segment_conditioning_frames', 2);
      flow.setHuggingFaceClusterParameter(cluster.id, 'num_inference_steps', 1);
      flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'fps', 16);
      flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'guidanceScale', guidanceScaleValue);
      flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'seed', 280828);
    },
    {
      drivingVideoValue: drivingVideo,
      promptRefValue: promptRef,
      promptValue: prompt,
      referenceImageValue: referenceImage,
      guidanceScaleValue: variant.guidanceScale,
    },
  );
  const persisted = () =>
    page.evaluate(() => {
      const rootNode = window
        .__MODIFF_E2E__!.getState()
        .flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
      return rootNode
        ? {
            overrides: rootNode.huggingFaceClusterInstance?.parameterOverrides,
            executionOverrides: rootNode.huggingFaceClusterInstance?.execution?.parameterOverrides,
          }
        : null;
    });
  const beforeSave = await persisted();
  expect(beforeSave).toMatchObject({
    overrides: {
      prompt,
      prompt_ref: promptRef,
      image: [referenceImage],
      driving_video: drivingVideo,
      width: 256,
      height: 256,
      segment_frame_length: 9,
      prev_segment_conditioning_frames: 2,
      num_inference_steps: 1,
    },
    executionOverrides: { fps: 16, guidanceScale: variant.guidanceScale, seed: 280828 },
  });
  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill(variant.workflowName);
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  expect(await persisted()).toEqual(beforeSave);

  root = page.locator('[data-cluster-role="root"]').filter({ hasText: label });
  await expect(root).toBeVisible({ timeout: 30_000 });
  await root.getByRole('button', { name: 'Prepare qualification run' }).click();
  await expect(root.getByRole('status')).toContainText(/Ready for a qualification run/u, { timeout: 300_000 });
  const execution = await page.evaluate(() =>
    window
      .__MODIFF_E2E__!.getState()
      .flow.nodes.filter((node) => node.huggingFaceClusterRole === 'execution')
      .map((node) => ({
        role: node.huggingFaceClusterExecutionRole,
        module: node.module,
        action: node.action,
        disabled: node.uiState?.disabled,
        params: Object.fromEntries(Object.entries(node.params).map(([key, field]) => [key, field.value])),
      })),
  );
  expect(execution.every((node) => node.disabled === false)).toBe(true);
  expect(execution.find((node) => node.role === 'models')).toMatchObject({
    module: 'modules.ModularDiffusers',
    action: 'ModelsLoader',
    params: {
      model_type: modelType,
      repo_id: { source: 'hub', value: repo },
      revision,
    },
  });
  expect(execution.find((node) => node.role === 'videoEncode')?.params).toMatchObject({
    segment_frame_length: 9,
    prev_segment_conditioning_frames: 2,
    fps: 16,
  });
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/frontend-prepared.png`, fullPage: true });
  }

  const runButton = page.getByTestId('studio-run');
  await expect(runButton).toBeEnabled({ timeout: 30_000 });
  const submission = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await runButton.click();
  const response = await submission;
  expect(response.ok()).toBe(true);
  const submitted = (await response.json()) as { task_id?: string };
  expect(typeof submitted.task_id).toBe('string');
  const taskId = submitted.task_id!;
  await waitForLiveTaskCompletion(page, taskId, 3 * 60 * 60 * 1000);
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
            outputs?: Array<{ taskId?: string; displayType?: string; mediaHash?: string; url?: string }>;
          };
          return body.outputs?.find((item) => item.taskId === id) ?? null;
        }, taskId),
      { timeout: 120_000, intervals: [500, 1000, 2000] },
    )
    .toMatchObject({ taskId, displayType: 'video' });
  const generatedOutput = await page.evaluate(async (id) => {
    const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
      outputs?: Array<{ taskId?: string; displayType?: string; mediaHash?: string; url?: string }>;
    };
    return body.outputs?.find((item) => item.taskId === id) ?? null;
  }, taskId);
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/frontend-generated.png`, fullPage: true });
    if (generatedOutput?.url) {
      const assetResponse = await page.request.get(generatedOutput.url);
      expect(assetResponse.ok()).toBe(true);
      await writeFile(`${evidenceRoot}/${variant.evidenceDirectory}-generated.mp4`, await assetResponse.body());
    }
    await writeFile(
      `${evidenceRoot}/frontend-generation-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model: { repo, revision },
          taskId,
          inputs: { prompt, promptRef, referenceImage, drivingVideo },
          parameters: beforeSave,
          saveRefreshEquivalent: true,
          execution,
          generatedOutput,
          qualificationOnly: true,
          showcaseApproved: false,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live Anima Cluster preserves edited parameters across save, refresh, and expansion parity', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('anima-live-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('anima-live-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);

  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 30_000 });
  await group.getByRole('button').first().click();
  await page.getByLabel('Search nodes').fill('Anima — Text To Image');
  const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: 'Anima — Text To Image' });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
  await row.click();

  let root = page.locator('[data-cluster-role="root"]').filter({ hasText: 'Anima — Text To Image' });
  await expect(root).toBeVisible({ timeout: 30_000 });
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  const textEncoder = page.locator('[data-cluster-role="block"][data-cluster-path="text_encoder"]');
  await expect(textEncoder).toBeVisible();
  await textEncoder.getByLabel('Expand Diffusers Block Node parameters').click();
  const prompt = 'A copper observatory over rain clouds, precise geometric architecture';
  await textEncoder.getByLabel('prompt', { exact: true }).fill(prompt);
  await textEncoder.getByLabel('prompt', { exact: true }).blur();
  await page.evaluate(() => {
    const rootNode = window
      .__MODIFF_E2E__!.getState()
      .flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
    if (!rootNode) throw new Error('Anima Cluster root is unavailable.');
    return import('/src/stores/useFlowStore.ts').then(({ useFlowStore }) => {
      const flow = useFlowStore.getState();
      flow.setHuggingFaceClusterParameter(rootNode.id, 'width', 768);
      flow.setHuggingFaceClusterParameter(rootNode.id, 'height', 768);
      flow.setHuggingFaceClusterParameter(rootNode.id, 'num_inference_steps', 12);
      flow.setHuggingFaceClusterExecutionParameter(rootNode.id, 'seed', 280826);
    });
  });

  const instanceBeforeSave = await page.evaluate(() => {
    const rootNode = window
      .__MODIFF_E2E__!.getState()
      .flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
    return rootNode
      ? {
          definitionId: rootNode.huggingFaceClusterInstance?.definition.id,
          overrides: rootNode.huggingFaceClusterInstance?.parameterOverrides,
          executionOverrides: rootNode.huggingFaceClusterInstance?.execution?.parameterOverrides,
          specId: rootNode.huggingFaceClusterInstance?.execution?.studioExecutionSpec.id,
          expandedPaths: rootNode.huggingFaceClusterInstance?.presentation.expandedPaths,
        }
      : null;
  });
  expect(instanceBeforeSave).toMatchObject({
    definitionId: 'diffusers.modular:AnimaModularPipeline:text2image',
    overrides: { prompt, width: 768, height: 768, num_inference_steps: 12 },
    executionOverrides: { seed: 280826 },
    specId: 'anima:modular-text-to-image:v1',
    expandedPaths: ['text_encoder'],
  });

  const canonicalMaterialization = (expanded: boolean) =>
    page.evaluate(async (showExecution) => {
      const [flowModule, nodesModule, libraryModule, materializer, runtime] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useNodeStore.ts'),
        import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
        import('/src/studio/huggingFaceClusterMaterializer.ts'),
        import('/src/studio/huggingFaceClusterRuntime.ts'),
      ]);
      const rootNode = flowModule.useFlowStore
        .getState()
        .nodes.find((node) => node.data.huggingFaceClusterRole === 'root');
      const instance = rootNode?.data.huggingFaceClusterInstance;
      const definition = libraryModule.useHuggingFaceNodeLibraryStore
        .getState()
        .library?.definitions.find((candidate) => candidate.id === instance?.definition.id);
      const admission = definition?.executionAdmissions.find(
        (candidate) => candidate.id === instance?.execution?.admissionId,
      );
      const spec = nodesModule.useNodesStore
        .getState()
        .studioModelCapabilities.find((capability) => capability.modelType === definition?.pipelineClass)
        ?.studioExecutionSpecs?.find((candidate) => candidate.id === admission?.studioExecutionSpec?.id);
      if (!instance || !definition || !admission || !spec) {
        throw new Error('The exact Anima execution materialization inputs are unavailable.');
      }
      const skeleton = materializer.materializeHuggingFaceClusterExecutionSkeleton({
        definition,
        instance,
        admission,
        executionSpec: spec,
        nodesRegistry: nodesModule.useNodesStore.getState().nodesRegistry,
        bindingValues: runtime.provisionalHuggingFaceClusterExecutionParameterValues(definition, instance, admission),
        expanded: showExecution,
      });
      return materializer.canonicalHuggingFaceClusterExecutionSnapshot(skeleton);
    }, expanded);
  await textEncoder.getByLabel('Collapse Diffusers Block Node parameters').click();
  await root.getByLabel('Collapse Diffusers Cluster Node').click();
  const collapsedGraph = await canonicalMaterialization(false);
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  await expect(page.locator('[data-cluster-role="block"]')).not.toHaveCount(0);
  expect(await canonicalMaterialization(true)).toEqual(collapsedGraph);
  const compiledActions = collapsedGraph.nodes.map((node) => `${node.module}.${node.action}`);
  expect(compiledActions).toEqual(
    expect.arrayContaining([
      'modules.ModularDiffusers.ModelsLoader',
      'modules.ModularDiffusers.WorkflowTextEncode',
      'modules.ModularDiffusers.WorkflowImageDenoise',
      'modules.ModularDiffusers.WorkflowDecodeImage',
      'modules.Image.Preview',
    ]),
  );

  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('Anima Cluster Persistence Proof');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const studio = window.__MODIFF_E2E__!.getState().studio;
          return studio.workflowTabs.find((tab: { id: string }) => tab.id === studio.activeWorkflowTabId)?.dirty;
        }),
      { timeout: 30_000 },
    )
    .toBe(false);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  root = page.locator('[data-cluster-role="root"]').filter({ hasText: 'Anima — Text To Image' });
  await expect(root.getByLabel('Collapse Diffusers Cluster Node')).toBeVisible({ timeout: 30_000 });
  const restored = await page.evaluate(() => {
    const state = window.__MODIFF_E2E__!.getState();
    const rootNode = state.flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
    return rootNode
      ? {
          definitionId: rootNode.huggingFaceClusterInstance?.definition.id,
          overrides: rootNode.huggingFaceClusterInstance?.parameterOverrides,
          executionOverrides: rootNode.huggingFaceClusterInstance?.execution?.parameterOverrides,
          specId: rootNode.huggingFaceClusterInstance?.execution?.studioExecutionSpec.id,
          expandedPaths: rootNode.huggingFaceClusterInstance?.presentation.expandedPaths,
        }
      : null;
  });
  expect(restored).toMatchObject({
    definitionId: instanceBeforeSave?.definitionId,
    overrides: instanceBeforeSave?.overrides,
    executionOverrides: instanceBeforeSave?.executionOverrides,
    specId: instanceBeforeSave?.specId,
    expandedPaths: [],
  });
  expect(await canonicalMaterialization(false)).toEqual(collapsedGraph);
  const restoredTextEncoder = page.locator('[data-cluster-role="block"][data-cluster-path="text_encoder"]');
  await expect(restoredTextEncoder.getByLabel('Expand Diffusers Block Node parameters')).toBeVisible();
  await restoredTextEncoder.getByLabel('Expand Diffusers Block Node parameters').click();
  await expect(restoredTextEncoder.getByLabel('prompt', { exact: true })).toHaveValue(prompt);
});

test('live LTX2 catalog promotes only exact standard overlaps and preserves broader workflows as catalog-only', async ({
  page,
}) => {
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });
  const catalogProof = await page.evaluate(async () => {
    const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
    ]);
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
    ]);
    const definitions = useHuggingFaceNodeLibraryStore
      .getState()
      .library!.definitions.filter((definition) => definition.pipelineClass === 'LTX2ModularPipeline');
    const capability = useNodesStore
      .getState()
      .studioModelCapabilities.find((item) => item.modelType === 'LTX2ModularPipeline');
    return {
      definitions: definitions.map((definition) => ({
        workflowId: definition.workflowId,
        integrationStatus: definition.integrationStatus,
        readiness: definition.executionAdmissions[0]?.publication.readiness ?? 'catalog_only',
        executable: definition.executionAdmissions[0]?.publication.executable ?? false,
        autoEligible: definition.executionAdmissions[0]?.publication.autoEligible ?? false,
        liveProof: definition.executionAdmissions[0]?.publication.liveProof ?? false,
      })),
      downloadFiles: capability?.downloadFiles ?? [],
      revisionCandidates: capability?.revisionCandidates ?? [],
    };
  });
  expect(catalogProof.definitions).toEqual([
    {
      workflowId: 'condition',
      integrationStatus: 'contract_only',
      readiness: 'catalog_only',
      executable: false,
      autoEligible: false,
      liveProof: false,
    },
    {
      workflowId: 'image2video',
      integrationStatus: 'equivalent_standard_route',
      readiness: 'graph_qualified',
      executable: false,
      autoEligible: false,
      liveProof: false,
    },
    {
      workflowId: 'in_context',
      integrationStatus: 'contract_only',
      readiness: 'catalog_only',
      executable: false,
      autoEligible: false,
      liveProof: false,
    },
    {
      workflowId: 'text2video',
      integrationStatus: 'equivalent_standard_route',
      readiness: 'graph_qualified',
      executable: false,
      autoEligible: false,
      liveProof: false,
    },
  ]);
  expect(catalogProof.revisionCandidates).toEqual(['47da56e2ad66ce4125a9922b4a8826bf407f9d0a']);
  expect(catalogProof.downloadFiles).toHaveLength(45);
  expect(catalogProof.downloadFiles).toContain('model_index.json');
  expect(catalogProof.downloadFiles).toContain('transformer/diffusion_pytorch_model-00008-of-00008.safetensors');
  expect(catalogProof.downloadFiles.some((path) => path.startsWith('ltx-2-19b-'))).toBe(false);

  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 30_000 });
  await group.getByRole('button').first().click();
  await page.getByLabel('Search nodes').fill('LTX2 —');
  const rows = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: 'LTX2 —' });
  await expect(rows).toHaveCount(4);
  const text = rows.filter({ hasText: 'LTX2 — Text To Video With Audio' });
  const image = rows.filter({ hasText: 'LTX2 — Image To Video With Audio' });
  const condition = rows.filter({ hasText: 'LTX2 — Condition To Video With Audio' });
  const inContext = rows.filter({ hasText: 'LTX2 — In Context To Video With Audio' });
  await expect(text).toHaveAttribute('data-readiness', 'graph_qualified');
  await expect(image).toHaveAttribute('data-readiness', 'graph_qualified');
  await expect(condition).toHaveAttribute('data-readiness', 'catalog_only');
  await expect(inContext).toHaveAttribute('data-readiness', 'catalog_only');
  await text.click();
  const root = page.locator('[data-cluster-role="root"]').filter({ hasText: 'LTX2 — Text To Video With Audio' });
  await expect(root).toBeVisible();
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  await expect(root.getByLabel('Collapse Diffusers Cluster Node')).toBeVisible();
  await expect(page.locator('[data-cluster-role="block"]')).not.toHaveCount(0);
  const clearFinishedNotifications = page.getByTitle('Clear finished notifications');
  if (await clearFinishedNotifications.isVisible()) await clearFinishedNotifications.click();
  if (outputDirectory) {
    await page.screenshot({
      path: `${outputDirectory}/diffusers-ltx2-equivalent-cluster-expanded-storage-blocked.png`,
      fullPage: true,
    });
  }
});

test('live LTX2 Cluster shows upstream conditional alternatives and persists the selected branch across refresh', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_MODULAR_CONDITIONAL_UI !== '1',
    'The reviewed Modular Diffusers conditional UI proof must be selected explicitly.',
  );
  test.setTimeout(10 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/ltx2-conditional-cluster-ui` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('ltx2-conditional-cluster-ui-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('ltx2-conditional-cluster-ui-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();

  const loaded = await page.evaluate(async () => {
    const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }, { useHuggingFaceModularConditionalStore }] =
      await Promise.all([
        import('/src/stores/useNodeStore.ts'),
        import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
        import('/src/stores/useHuggingFaceModularConditionalStore.ts'),
      ]);
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
      useHuggingFaceModularConditionalStore.getState().fetchSnapshot(),
    ]);
    const conditional = useHuggingFaceModularConditionalStore.getState();
    return {
      error: conditional.error,
      pipelines: conditional.snapshot?.pipelines.length,
      blocks: conditional.snapshot?.blockDefinitions.length,
    };
  });
  expect(loaded).toEqual({ error: null, pipelines: 34, blocks: 632 });

  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 30_000 });
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true')
    await group.getByRole('button').first().click();
  await page.getByLabel('Search nodes').fill('LTX2 — Text To Video With Audio');
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'LTX2 — Text To Video With Audio' });
  await expect(row).toHaveCount(1);
  await row.click();
  let root = page.locator('[data-cluster-role="root"]').filter({ hasText: 'LTX2 — Text To Video With Audio' });
  await expect(root).toBeVisible();
  const focusConditionalPath = async (path: string) => {
    const focused = await page.evaluate(async (requestedPath) => {
      const [{ useFlowStore }, { useSettingsStore }, { useStudioStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useSettingsStore.ts'),
        import('/src/stores/useStudioStore.ts'),
      ]);
      const node = useFlowStore
        .getState()
        .nodes.find((candidate) => candidate.data.huggingFaceClusterPath === requestedPath);
      const workflowTabId = useStudioStore.getState().activeWorkflowTabId;
      if (!node || !workflowTabId) return null;
      const now = Date.now();
      useSettingsStore.getState().setWorkflowFocusRequest({
        workflowTabId,
        nodeId: node.id,
        requestId: now,
        requestedAt: now,
      });
      return {
        id: node.id,
        role: node.data.huggingFaceClusterConditionalRole,
        status: node.data.huggingFaceClusterConditionalStatus,
        selectedBlockName: node.data.huggingFaceClusterSelectedBlockName,
      };
    }, path);
    expect(focused).not.toBeNull();
    await expect(page.locator(`[data-cluster-path="${path}"]`)).toBeVisible({ timeout: 30_000 });
    return focused!;
  };
  const collapsedGraph = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore.getState().exportGraph('ltx2-conditional-proof');
  });
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  await expect(root.getByLabel('Collapse Diffusers Cluster Node')).toBeVisible();
  expect(await focusConditionalPath('duration')).toMatchObject({
    role: 'selector',
    status: 'active',
    selectedBlockName: 'duration',
  });
  const durationSelector = page.locator('[data-cluster-path="duration"]');
  const durationBranch = page.locator('[data-cluster-path="duration/duration"]');
  await expect(durationSelector).toHaveAttribute('data-cluster-conditional-role', 'selector');
  await expect(durationSelector).toHaveAttribute('data-cluster-conditional-status', 'active');
  await expect(durationSelector).toContainText('Selected: duration');
  await focusConditionalPath('duration/duration');
  await expect(durationBranch).toHaveAttribute('data-cluster-conditional-role', 'branch');
  await expect(durationBranch).toHaveAttribute('data-cluster-conditional-status', 'active');
  expect(
    await page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return useFlowStore.getState().exportGraph('ltx2-conditional-proof');
    }),
  ).toEqual(collapsedGraph);

  await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const flow = useFlowStore.getState();
    const cluster = flow.nodes.find((node) => node.data.huggingFaceClusterRole === 'root');
    if (!cluster) throw new Error('The LTX2 conditional Cluster root is unavailable.');
    flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'numFrames', 9);
  });
  await focusConditionalPath('duration');
  await expect(durationSelector).toHaveAttribute('data-cluster-conditional-status', 'skipped');
  await expect(durationSelector).toContainText('Skipped');
  await focusConditionalPath('duration/duration');
  await expect(durationBranch).toHaveAttribute('data-cluster-conditional-status', 'inactive');
  await expect(durationBranch).toContainText('Inactive alternative');

  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('LTX2 Conditional Cluster Proof');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });
  root = page.locator('[data-cluster-role="root"]').filter({ hasText: 'LTX2 — Text To Video With Audio' });
  await expect(root.getByLabel('Collapse Diffusers Cluster Node')).toBeVisible({ timeout: 30_000 });
  const restoredState = await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          const flow = useFlowStore.getState();
          const cluster = flow.nodes.find((node) => node.data.huggingFaceClusterRole === 'root');
          const duration = flow.nodes.find((node) => node.data.huggingFaceClusterPath === 'duration');
          const durationBranch = flow.nodes.find((node) => node.data.huggingFaceClusterPath === 'duration/duration');
          return cluster
            ? {
                value: cluster.data.huggingFaceClusterInstance?.execution?.parameterOverrides.numFrames,
                explicitSources: cluster.data.huggingFaceClusterInstance?.execution?.explicitParameterSources ?? null,
                durationStatus: duration?.data.huggingFaceClusterConditionalStatus ?? null,
                durationBranchStatus: durationBranch?.data.huggingFaceClusterConditionalStatus ?? null,
              }
            : null;
        }),
      { timeout: 30_000, intervals: [100, 250, 500] },
    )
    .toEqual({
      value: 9,
      explicitSources: ['numFrames'],
      durationStatus: 'skipped',
      durationBranchStatus: 'inactive',
    });
  void restoredState;
  const persisted = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const flow = useFlowStore.getState();
    const cluster = flow.nodes.find((node) => node.data.huggingFaceClusterRole === 'root');
    if (!cluster) throw new Error('The restored LTX2 conditional Cluster root is unavailable.');
    const value = cluster.data.huggingFaceClusterInstance?.execution?.parameterOverrides.numFrames;
    flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'numFrames', undefined);
    return value;
  });
  expect(persisted).toBe(9);
  const clearedState = await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          const flow = useFlowStore.getState();
          const cluster = flow.nodes.find((node) => node.data.huggingFaceClusterRole === 'root');
          const duration = flow.nodes.find((node) => node.data.huggingFaceClusterPath === 'duration');
          const durationBranch = flow.nodes.find((node) => node.data.huggingFaceClusterPath === 'duration/duration');
          return {
            hasNumFrames: Object.hasOwn(
              cluster?.data.huggingFaceClusterInstance?.execution?.parameterOverrides ?? {},
              'numFrames',
            ),
            explicitSources: cluster?.data.huggingFaceClusterInstance?.execution?.explicitParameterSources ?? null,
            durationStatus: duration?.data.huggingFaceClusterConditionalStatus ?? null,
            durationBranchStatus: durationBranch?.data.huggingFaceClusterConditionalStatus ?? null,
          };
        }),
      { timeout: 30_000, intervals: [100, 250, 500] },
    )
    .toEqual({
      hasNumFrames: false,
      explicitSources: [],
      durationStatus: 'active',
      durationBranchStatus: 'active',
    });
  void clearedState;
  await focusConditionalPath('duration');

  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/frontend-after-refresh-duration-active.png`, fullPage: true });
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          pipelineClass: 'LTX2ModularPipeline',
          workflowId: 'text2video',
          companion: loaded,
          explicitNumFramesPersistedAcrossRefresh: persisted,
          explicitNumFramesSkippedDurationBranch: true,
          omittedNumFramesSelectedDurationBranch: true,
          inactiveOfficialAlternativesRetained: true,
          collapsedExpandedGraphEquivalent: true,
          upstreamExecutionProof: 'get_execution_blocks/init_pipeline',
          modelWeightsLoaded: false,
          publicationUnchangedPendingLicenseAndOutputApproval: true,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('newly unblocked Diffusers Cluster preserves parameters and executes the same collapsed and expanded graph', async ({
  page,
}) => {
  const scenarioId = process.env.MODIFF_RUN_UNBLOCKED_DIFFUSERS_CLUSTER;
  test.skip(
    ![
      'ltx_text_to_video',
      'ltx_image_to_video',
      'ltx2_text_to_video',
      'ltx2_image_to_video',
      'wan22_text_to_video',
      'wan22_image_to_video',
    ].includes(scenarioId ?? ''),
    'A downloaded heavy-model scenario must be selected explicitly.',
  );
  test.skip(
    scenarioId?.startsWith('ltx2_') && process.env.MODIFF_ACKNOWLEDGE_LTX2_LICENSE !== '1',
    'The user must explicitly authorize the revision-bound LTX-2 license acknowledgement.',
  );
  test.setTimeout(8 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const scenarios = {
    ltx_text_to_video: {
      label: 'LTX — Text To Video',
      modelType: 'LTXModularPipeline',
      repo: 'Lightricks/LTX-Video-0.9.8-13B-distilled',
      revision: '7c64400e1861cc0d7b98d570a1926d5408ec60cd',
      pipelineClass: 'LTXConditionPipeline',
      executionProfileId: 'ltx:equivalent-standard',
      exportAction: 'Export',
      prompt: 'Technical frontend motion proof: a red cube rolls from left to right across a white floor.',
      steps: 8,
      frames: 9,
      fps: 8,
    },
    ltx_image_to_video: {
      label: 'LTX — Image To Video',
      modelType: 'LTXModularPipeline',
      repo: 'Lightricks/LTX-Video-0.9.8-13B-distilled',
      revision: '7c64400e1861cc0d7b98d570a1926d5408ec60cd',
      pipelineClass: 'LTXConditionPipeline',
      executionProfileId: 'ltx:equivalent-standard',
      exportAction: 'Export',
      prompt: 'Technical frontend motion proof: the reference object rotates slowly on a white floor.',
      image: ['@data/images/source.png'],
      steps: 8,
      frames: 9,
      fps: 8,
    },
    ltx2_text_to_video: {
      label: 'LTX2 — Text To Video With Audio',
      modelType: 'LTX2ModularPipeline',
      repo: 'Lightricks/LTX-2',
      revision: '47da56e2ad66ce4125a9922b4a8826bf407f9d0a',
      pipelineClass: 'LTX2ConditionPipeline',
      executionProfileId: 'ltx2-modular:equivalent-standard',
      exportAction: 'ExportWithAudio',
      prompt: 'Technical frontend motion proof: a red cube rolls from left to right while a bell rings once.',
      steps: 2,
      frames: 9,
      fps: 8,
    },
    ltx2_image_to_video: {
      label: 'LTX2 — Image To Video With Audio',
      modelType: 'LTX2ModularPipeline',
      repo: 'Lightricks/LTX-2',
      revision: '47da56e2ad66ce4125a9922b4a8826bf407f9d0a',
      pipelineClass: 'LTX2ConditionPipeline',
      executionProfileId: 'ltx2-modular:equivalent-standard',
      exportAction: 'ExportWithAudio',
      prompt: 'Technical frontend motion proof: the reference object rotates slowly while a bell rings once.',
      image: ['@data/images/source.png'],
      steps: 2,
      frames: 9,
      fps: 8,
    },
    wan22_text_to_video: {
      label: 'Wan22 — Text To Video',
      modelType: 'Wan22ModularPipeline',
      repo: 'Wan-AI/Wan2.2-T2V-A14B-Diffusers',
      revision: '5be7df9619b54f4e2667b2755bc6a756675b5cd7',
      pipelineClass: 'Wan22Pipeline',
      executionProfileId: 'wan22:equivalent-standard',
      exportAction: 'Export',
      prompt: 'Technical frontend motion proof: a red cube rolls from left to right across a white floor.',
      steps: 2,
      frames: 9,
      fps: 8,
    },
    wan22_image_to_video: {
      label: 'Wan22 Image2 Video — Image To Video',
      modelType: 'Wan22Image2VideoModularPipeline',
      repo: 'Wan-AI/Wan2.2-I2V-A14B-Diffusers',
      revision: '596658fd9ca6b7b71d5057529bbf319ecbc61d74',
      pipelineClass: 'WanImageToVideoPipeline',
      executionProfileId: 'wan22-i2v:equivalent-standard',
      exportAction: 'Export',
      prompt: 'Technical frontend motion proof: the reference object rotates slowly on a white floor.',
      image: ['@data/images/source.png'],
      steps: 2,
      frames: 81,
      fps: 16,
    },
  } as const;
  const scenario = scenarios[scenarioId as keyof typeof scenarios];
  const evidenceRoot = outputDirectory
    ? scenarioId?.startsWith('ltx2_')
      ? `${outputDirectory}/ltx2-native-licensed`
      : `${outputDirectory}/remaining-admitted-video-clusters`
    : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('unblocked-diffusers-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('unblocked-diffusers-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await expect(autoToggle).toHaveAttribute('aria-checked', 'false');
  await page.evaluate(async () => {
    const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }, { useHuggingFaceModularConditionalStore }] =
      await Promise.all([
        import('/src/stores/useNodeStore.ts'),
        import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
        import('/src/stores/useHuggingFaceModularConditionalStore.ts'),
      ]);
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useNodesStore.getState().fetchOptionalRuntimes(),
      useNodesStore.getState().refreshModelIndexes(false),
      useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
      useHuggingFaceModularConditionalStore.getState().fetchSnapshot(),
    ]);
  });

  if (scenarioId === 'ltx2_image_to_video') {
    const mediaRuntimeId = 'gallery-media-opencv-5.0.0.93-pyav-18.1.0';
    await page.evaluate(async () => {
      const { useSettingsStore } = await import('/src/stores/useSettingsStore.ts');
      useSettingsStore.getState().setRightPanelOpen(true);
      useSettingsStore.getState().setRightPanelTab('setup');
    });
    const runtimeRow = page.getByTestId(`optional-runtime-${mediaRuntimeId}`);
    await expect(runtimeRow).toBeVisible({ timeout: 30_000 });
    const installRuntime = runtimeRow.getByRole('button', { name: /^(Install|Repair)$/u });
    if (await installRuntime.isVisible()) {
      const action = (await installRuntime.textContent())?.trim() || 'Install';
      await installRuntime.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(/optional runtime/u);
      await dialog.getByRole('button', { name: action, exact: true }).click();
      await expect(runtimeRow.getByRole('button', { name: 'Activate', exact: true })).toBeVisible({
        timeout: 30 * 60 * 1000,
      });
    }
    const activateRuntime = runtimeRow.getByRole('button', { name: 'Activate', exact: true });
    if (await activateRuntime.isVisible()) {
      await activateRuntime.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(/Activate validated/u);
      await dialog.getByRole('button', { name: 'Activate', exact: true }).click();
    }
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            try {
              const response = await fetch('/runtime/optional-runtimes');
              if (!response.ok) return 'restarting:restarting';
              const body = (await response.json()) as {
                overlay?: { processLoadStatus?: string };
                profiles?: Array<{ id?: string; overlayStatus?: string }>;
              };
              const profile = body.profiles?.find((candidate) => candidate.id === id);
              return `${body.overlay?.processLoadStatus ?? 'unknown'}:${profile?.overlayStatus ?? 'unknown'}`;
            } catch {
              return 'restarting:restarting';
            }
          }, mediaRuntimeId),
        { timeout: 5 * 60 * 1000, intervals: [1000, 2000, 5000] },
      )
      .toBe('active:active');
    await expect
      .poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().websocket.isConnected), {
        timeout: 120_000,
      })
      .toBe(true);
    await page.evaluate(async () => {
      const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
        import('/src/stores/useNodeStore.ts'),
        import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
      ]);
      await Promise.all([
        useNodesStore.getState().fetchOptionalRuntimes(),
        useNodesStore.getState().refreshModelIndexes(true),
        useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
      ]);
    });
    if (evidenceRoot) {
      await page.screenshot({
        path: `${evidenceRoot}/${scenarioId}-frontend-media-runtime-active.png`,
        fullPage: true,
      });
    }
  }

  if (scenarioId?.startsWith('ltx2_')) {
    const capability = await page.evaluate(async (modelType) => {
      const body = (await (await fetch('/model_capabilities')).json()) as {
        capabilities?: Array<{
          modelType?: string;
          defaultRepo?: string;
          revisionCandidates?: string[];
          downloadFiles?: string[];
        }>;
      };
      return body.capabilities?.find((candidate) => candidate.modelType === modelType) ?? null;
    }, 'LTX2ConditionPipeline');
    expect(capability).toMatchObject({
      defaultRepo: scenario.repo,
      revisionCandidates: [scenario.revision],
    });
    expect(capability?.downloadFiles).toHaveLength(45);

    await page.getByTestId('topbar-models').click();
    const manager = page.getByTestId('model-manager-dialog');
    await expect(manager).toBeVisible();
    const managerRow = manager.getByTestId('model-manager-supported-LTX2ConditionPipeline');
    await expect(managerRow).toBeVisible({ timeout: 60_000 });
    const install = managerRow.getByTestId('model-manager-install-LTX2ConditionPipeline');
    if ((await install.textContent())?.trim() !== 'Ready') {
      const requestPromise = page.waitForRequest(
        (request) => request.url().endsWith('/hf_download') && request.method() === 'POST',
        { timeout: 120_000 },
      );
      await install.click();
      const terms = page.getByTestId('template-usage-terms-dialog');
      await expect(terms).toBeVisible();
      await expect(terms).toContainText('$10 million entity-wide annual-revenue threshold');
      await expect(terms.getByRole('link', { name: 'View terms' })).toHaveAttribute(
        'href',
        `https://huggingface.co/${scenario.repo}/blob/${scenario.revision}/LICENSE`,
      );
      await page.getByTestId('template-usage-terms-confirm').click();
      const request = await requestPromise;
      expect(request.postDataJSON()).toMatchObject({
        repo_id: scenario.repo,
        revision: scenario.revision,
        files: [...capability!.downloadFiles!].sort(),
      });
      if (evidenceRoot) {
        await page.screenshot({
          path: `${evidenceRoot}/${scenarioId}-frontend-download-started.png`,
          fullPage: true,
        });
      }
      await waitForModelManagerReady(install, 6 * 60 * 60 * 1000);
    }
    if (evidenceRoot) {
      await page.screenshot({
        path: `${evidenceRoot}/${scenarioId}-frontend-model-ready.png`,
        fullPage: true,
      });
    }
    await manager.getByTestId('model-manager-close').click();
    await page.evaluate(async () => {
      const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
        import('/src/stores/useNodeStore.ts'),
        import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
      ]);
      await Promise.all([
        useNodesStore.getState().refreshModelIndexes(true),
        useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
      ]);
    });
  }

  if (scenarioId && !scenarioId.startsWith('ltx2_')) {
    const capability = await page.evaluate(async (modelType) => {
      const body = (await (await fetch('/model_capabilities')).json()) as {
        capabilities?: Array<{
          modelType?: string;
          defaultRepo?: string;
          revisionCandidates?: string[];
          downloadFiles?: string[];
        }>;
      };
      return body.capabilities?.find((candidate) => candidate.modelType === modelType) ?? null;
    }, scenario.modelType);
    expect(capability).toMatchObject({
      defaultRepo: scenario.repo,
      revisionCandidates: [scenario.revision],
    });
    expect(capability?.downloadFiles?.length).toBeGreaterThan(0);

    await page.getByTestId('topbar-models').click();
    const manager = page.getByTestId('model-manager-dialog');
    await expect(manager).toBeVisible();
    const managerRow = manager.getByTestId(`model-manager-supported-${scenario.modelType}`);
    await expect(managerRow).toBeVisible({ timeout: 60_000 });
    const install = managerRow.getByTestId(`model-manager-install-${scenario.modelType}`);
    if ((await install.textContent())?.trim() !== 'Ready') {
      const requestPromise = page.waitForRequest(
        (request) => request.url().endsWith('/hf_download') && request.method() === 'POST',
        { timeout: 120_000 },
      );
      await install.click();
      const terms = page.getByTestId('template-usage-terms-dialog');
      if (await terms.isVisible({ timeout: 1500 }).catch(() => false)) {
        await page.getByTestId('template-usage-terms-confirm').click();
      }
      const request = await requestPromise;
      expect(request.postDataJSON()).toMatchObject({
        repo_id: scenario.repo,
        revision: scenario.revision,
        files: [...capability!.downloadFiles!].sort(),
      });
      if (evidenceRoot) {
        await page.screenshot({
          path: `${evidenceRoot}/${scenarioId}-frontend-download-started.png`,
          fullPage: true,
        });
      }
      await waitForModelManagerReady(install, 6 * 60 * 60 * 1000);
    }
    if (evidenceRoot) {
      await page.screenshot({
        path: `${evidenceRoot}/${scenarioId}-frontend-model-ready.png`,
        fullPage: true,
      });
    }
    await manager.getByTestId('model-manager-close').click();
    await page.evaluate(async () => {
      const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
        import('/src/stores/useNodeStore.ts'),
        import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
      ]);
      await Promise.all([
        useNodesStore.getState().refreshModelIndexes(true),
        useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
      ]);
    });
  }

  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 30_000 });
  await group.getByRole('button').first().click();
  await page.getByLabel('Search nodes').fill(scenario.label);
  const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: scenario.label });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
  await row.click();

  const root = page.locator('[data-cluster-role="root"]').filter({ hasText: scenario.label });
  await expect(root).toBeVisible();
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  await expect(root.getByLabel('Collapse Diffusers Cluster Node')).toBeVisible();
  const focusClusterPath = async (expectedPaths: string[]) => {
    const state = await page.evaluate(async (paths) => {
      const [{ useFlowStore }, { useSettingsStore }, { useStudioStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useSettingsStore.ts'),
        import('/src/stores/useStudioStore.ts'),
      ]);
      const node = useFlowStore
        .getState()
        .nodes.find((candidate) => paths.includes(candidate.data.huggingFaceClusterPath ?? ''));
      const workflowTabId = useStudioStore.getState().activeWorkflowTabId;
      if (!node || !workflowTabId) return null;
      const requestedAt = Date.now();
      useSettingsStore.getState().setWorkflowFocusRequest({
        workflowTabId,
        nodeId: node.id,
        requestId: requestedAt,
        requestedAt,
      });
      return {
        id: node.id,
        path: node.data.huggingFaceClusterPath!,
        prompt: node.data.params.prompt?.value,
        controlsExpanded: node.data.huggingFaceClusterPathExpanded === true,
      };
    }, expectedPaths);
    expect(state).not.toBeNull();
    await expect(page.locator(`[data-cluster-path="${state!.path}"]`)).toBeVisible({ timeout: 30_000 });
    return state!;
  };
  const promptBlockPaths = ['text_encoder', 'text_encoder/text_encoder', 'text_encoder.text_encoder'];
  const initialPromptBlockState = await focusClusterPath(promptBlockPaths);
  const promptBlock = page.locator(`[data-cluster-role="block"][data-cluster-path="${initialPromptBlockState.path}"]`);
  await expect(promptBlock).toBeVisible({ timeout: 30_000 });
  await promptBlock.getByLabel('Expand Diffusers Block Node parameters').click();
  const promptControl = promptBlock.getByLabel('prompt', { exact: true });
  await expect(promptControl).toBeVisible();
  await promptControl.fill(scenario.prompt);
  await promptControl.blur();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const rootNode = window
          .__MODIFF_E2E__!.getState()
          .flow.nodes.find((candidate) => candidate.huggingFaceClusterRole === 'root');
        return rootNode?.huggingFaceClusterInstance?.parameterOverrides.prompt ?? null;
      }),
    )
    .toBe(scenario.prompt);
  await page.evaluate(
    async ({ frames, fps, image, steps }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const cluster = useFlowStore
        .getState()
        .nodes.find((candidate) => candidate.data.huggingFaceClusterRole === 'root');
      if (!cluster) throw new Error('Heavy Diffusers Cluster root is unavailable.');
      const flow = useFlowStore.getState();
      flow.setHuggingFaceClusterParameter(cluster.id, 'width', 256);
      flow.setHuggingFaceClusterParameter(cluster.id, 'height', 256);
      flow.setHuggingFaceClusterParameter(cluster.id, 'num_inference_steps', steps);
      if (cluster.data.params.num_frames) {
        flow.setHuggingFaceClusterParameter(cluster.id, 'num_frames', frames);
      } else {
        flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'numFrames', frames);
      }
      flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'fps', fps);
      flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'guidanceScale', 1);
      flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'guidanceScale2', 1);
      if (image) flow.setHuggingFaceClusterParameter(cluster.id, 'image', image);
    },
    {
      frames: scenario.frames,
      fps: scenario.fps,
      image: 'image' in scenario ? scenario.image : null,
      steps: scenario.steps,
    },
  );
  const persistedBeforeRefresh = await page.evaluate(() => {
    const rootNode = window
      .__MODIFF_E2E__!.getState()
      .flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
    return rootNode
      ? {
          overrides: rootNode.huggingFaceClusterInstance?.parameterOverrides,
          executionOverrides: rootNode.huggingFaceClusterInstance?.execution?.parameterOverrides,
          effective: Object.fromEntries(Object.entries(rootNode.params).map(([key, field]) => [key, field.value])),
        }
      : null;
  });
  expect(persistedBeforeRefresh?.effective.prompt).toBe(scenario.prompt);
  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill(`${scenario.label} Frontend Proof`);
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const persistedAfterRefresh = await page.evaluate(() => {
    const rootNode = window
      .__MODIFF_E2E__!.getState()
      .flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
    return rootNode
      ? {
          overrides: rootNode.huggingFaceClusterInstance?.parameterOverrides,
          executionOverrides: rootNode.huggingFaceClusterInstance?.execution?.parameterOverrides,
          effective: Object.fromEntries(Object.entries(rootNode.params).map(([key, field]) => [key, field.value])),
        }
      : null;
  });
  expect(persistedAfterRefresh).toEqual(persistedBeforeRefresh);
  await expect(root.getByLabel('Collapse Diffusers Cluster Node')).toBeVisible();
  const promptBlockAfterRefreshState = await focusClusterPath(promptBlockPaths);
  expect(promptBlockAfterRefreshState.prompt).toBe(scenario.prompt);
  const promptBlockAfterRefresh = page.locator(
    `[data-cluster-role="block"][data-cluster-path="${promptBlockAfterRefreshState.path}"]`,
  );
  await expect(promptBlockAfterRefresh).toBeVisible({ timeout: 30_000 });
  const expandPromptParameters = promptBlockAfterRefresh.getByLabel('Expand Diffusers Block Node parameters');
  if (await expandPromptParameters.isVisible()) await expandPromptParameters.click();
  await expect(promptBlockAfterRefresh.getByLabel('prompt', { exact: true })).toHaveValue(scenario.prompt);

  await root.getByLabel('Collapse Diffusers Cluster Node').click();
  await root.getByRole('button', { name: 'Prepare qualification run' }).click();
  await expect(root.getByRole('status')).toContainText(/Ready for a qualification run/u, { timeout: 300_000 });
  const canonicalExport = () =>
    page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const graph = useFlowStore.getState().exportGraph('newly-unblocked-diffusers-equivalence');
      return { nodes: graph.nodes, paths: graph.paths, deterministicMode: graph.deterministicMode };
    });
  const collapsedGraph = await canonicalExport();
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  await expect(root.getByLabel('Collapse Diffusers Cluster Node')).toBeVisible();
  await expect(page.locator('[data-cluster-role="block"]')).not.toHaveCount(0);
  expect(await canonicalExport()).toEqual(collapsedGraph);
  await root.getByLabel('Collapse Diffusers Cluster Node').click();

  const execution = await page.evaluate(() =>
    window
      .__MODIFF_E2E__!.getState()
      .flow.nodes.filter((node) => node.huggingFaceClusterRole === 'execution')
      .map((node) => ({
        role: node.huggingFaceClusterExecutionRole,
        module: node.module,
        action: node.action,
        disabled: node.uiState?.disabled,
        params: Object.fromEntries(Object.entries(node.params).map(([key, field]) => [key, field.value])),
      })),
  );
  expect(execution.every((node) => node.disabled === false)).toBe(true);
  expect(execution.find((node) => node.role === 'wanPipeline')).toMatchObject({
    module: 'modules.DiffusersVideo',
    action: 'LoadPipeline',
    params: {
      model_id: { source: 'hub', value: scenario.repo },
      revision: scenario.revision,
      pipeline_class: scenario.pipelineClass,
      execution_profile_id: scenario.executionProfileId,
    },
  });
  expect(execution.some((node) => node.module === 'modules.Video' && node.action === scenario.exportAction)).toBe(true);

  if (evidenceRoot) {
    await page.screenshot({
      path: `${evidenceRoot}/${scenarioId}-prepared.png`,
      fullPage: true,
    });
  }
  const runButton = page.getByTestId('studio-run');
  await expect(runButton).toBeEnabled({ timeout: 30_000 });
  const submission = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await runButton.click();
  const response = await submission;
  expect(response.ok()).toBe(true);
  const submitted = (await response.json()) as { task_id?: string };
  expect(typeof submitted.task_id).toBe('string');
  const taskId = submitted.task_id!;
  await waitForLiveTaskCompletion(page, taskId, 2 * 60 * 60 * 1000);
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
            outputs?: Array<{ taskId?: string; displayType?: string; mediaHash?: string; url?: string }>;
          };
          return body.outputs?.find((item) => item.taskId === id) ?? null;
        }, taskId),
      { timeout: 120_000, intervals: [500, 1000, 2000] },
    )
    .toMatchObject({ taskId, displayType: 'video' });
  const generatedOutput = await page.evaluate(async (id) => {
    const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
      outputs?: Array<{ taskId?: string; displayType?: string; mediaHash?: string; url?: string }>;
    };
    return body.outputs?.find((item) => item.taskId === id) ?? null;
  }, taskId);
  const runtimePreparation = await page.evaluate(async (id) => {
    const body = (await (await fetch(`/runs/${encodeURIComponent(id)}`)).json()) as {
      task?: {
        runtimePreparation?: {
          performed?: boolean;
          resourceMode?: string;
          previousModelFamily?: string | null;
          incomingModelFamily?: string | null;
          reasons?: string[];
          cleanup?: unknown;
        };
      };
    };
    return body.task?.runtimePreparation ?? null;
  }, taskId);
  const expectedPreviousFamily = process.env.MODIFF_EXPECT_PREVIOUS_MODEL_FAMILY;
  if (expectedPreviousFamily) {
    expect(runtimePreparation).toMatchObject({
      performed: true,
      resourceMode: 'expert',
      previousModelFamily: expectedPreviousFamily,
      incomingModelFamily: scenario.modelType,
    });
    expect(runtimePreparation?.reasons).toContain(
      `model family changed from ${expectedPreviousFamily} to ${scenario.modelType}`,
    );
    expect(runtimePreparation?.cleanup).toBeTruthy();
  }
  if (evidenceRoot) {
    await page.screenshot({
      path: `${evidenceRoot}/${scenarioId}-generated.png`,
      fullPage: true,
    });
    if (generatedOutput?.url) {
      const assetResponse = await page.request.get(generatedOutput.url);
      expect(assetResponse.ok()).toBe(true);
      await writeFile(`${evidenceRoot}/${scenarioId}-generated.mp4`, await assetResponse.body());
    }
    await writeFile(
      `${evidenceRoot}/${scenarioId}-frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          scenarioId,
          taskId,
          model: { repo: scenario.repo, revision: scenario.revision },
          persistedBeforeRefresh,
          persistedAfterRefresh,
          collapsedExpandedGraphEquivalent: true,
          execution,
          generatedOutput,
          runtimePreparation,
          licenseAcknowledgement: {
            received: scenarioId?.startsWith('ltx2_') === true,
            revision: scenarioId?.startsWith('ltx2_') ? scenario.revision : null,
            termsUrl: scenarioId?.startsWith('ltx2_')
              ? `https://huggingface.co/${scenario.repo}/blob/${scenario.revision}/LICENSE`
              : null,
          },
          qualificationOnly: true,
          showcaseApproved: false,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live Hub import installs and persists an official Mellon contract without executing repository Python', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_REAL_HUB_IMPORT !== '1',
    'The real Hub import proof is opt-in because it installs an immutable external repository revision.',
  );
  test.setTimeout(15 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/safe-hub-import` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
  const repo = 'diffusers/gemini-prompt-expander-mellon';
  const revision = '0562591cbb2144060ce641aaf101fea686a4cb71';

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('safe-hub-import-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('safe-hub-import-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await page.getByTestId('left-tab-nodes').click();
  const userNodes = page.getByTestId('node-group-User-Nodes');
  if ((await userNodes.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
    await userNodes.getByRole('button').first().click();
  }
  await userNodes.getByTestId('import-hugging-face-user-node').click();
  const dialog = page.getByTestId('import-hugging-face-user-node-dialog');
  await dialog.getByLabel('Hugging Face User Node repository').fill(repo);
  await dialog.getByLabel('Hugging Face User Node revision').fill(revision);
  await dialog.getByTestId('hugging-face-user-node-reviewed').click();
  await dialog.getByTestId('inspect-hugging-face-user-node').click();

  const inspection = dialog.getByTestId('hugging-face-user-node-inspection');
  await expect(inspection).toBeVisible({ timeout: 10 * 60 * 1000 });
  await expect(inspection).toContainText('Gemini Prompt Expander');
  await expect(inspection).toContainText('mellon_pipeline_config.json');
  await expect(inspection).toContainText('1 blocks');
  await expect(inspection).toContainText('prompt');
  await expect(inspection).toContainText('out_prompt');
  await expect(inspection).toContainText('preview only');
  await expect(inspection).toContainText('repository Python remains disabled');
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/official-mellon-preview.png`, fullPage: true });
  }
  await dialog.getByTestId('confirm-hugging-face-user-node-import').click();
  await expect(dialog).toHaveCount(0);

  const importedBlock = page.locator('.react-flow__node-block').filter({ hasText: 'Gemini Prompt Expander' });
  await expect(importedBlock).toBeVisible();
  await importedBlock.getByRole('button', { name: 'Expand block' }).click();
  const beforeRefresh = await page.evaluate(() => {
    const node = window
      .__MODIFF_E2E__!.getState()
      .flow.nodes.find((candidate) => candidate.action === 'DynamicBlockNode');
    return node
      ? {
          category: node.category,
          repo: node.params.repo_id?.value,
          revision: node.params.revision?.value,
          trustRemoteCode: node.params.trust_remote_code?.value,
          disabled: node.uiState?.disabled,
        }
      : null;
  });
  expect(beforeRefresh).toEqual({
    category: 'User Nodes',
    repo: { source: 'hub', value: repo },
    revision,
    trustRemoteCode: false,
    disabled: true,
  });
  await importedBlock.getByRole('button', { name: 'Collapse block' }).click();
  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('Official Mellon Hub Import Proof');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const restoredBlock = page.locator('.react-flow__node-block').filter({ hasText: 'Gemini Prompt Expander' });
  await expect(restoredBlock).toBeVisible();
  await restoredBlock.getByRole('button', { name: 'Expand block' }).click();
  const afterRefresh = await page.evaluate(() => {
    const node = window
      .__MODIFF_E2E__!.getState()
      .flow.nodes.find((candidate) => candidate.action === 'DynamicBlockNode');
    return node
      ? {
          category: node.category,
          repo: node.params.repo_id?.value,
          revision: node.params.revision?.value,
          trustRemoteCode: node.params.trust_remote_code?.value,
          disabled: node.uiState?.disabled,
        }
      : null;
  });
  expect(afterRefresh).toEqual(beforeRefresh);
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/user-node-after-refresh.png`, fullPage: true });
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          repository: repo,
          revision,
          sidecar: 'mellon_pipeline_config.json',
          translatedWithoutExecutingRepositoryPython: true,
          persistedBeforeRefresh: beforeRefresh,
          persistedAfterRefresh: afterRefresh,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live MiniMax Music 3 Cluster installs in the frontend, persists internal edits, and generates audio', async ({
  page,
}) => {
  const showcaseRequested = process.env.MODIFF_RUN_MINIMAX_MUSIC3_SHOWCASE === '1';
  test.skip(
    process.env.MODIFF_RUN_MINIMAX_MUSIC3_AUDIO !== '1' && !showcaseRequested,
    'The exact MiniMax Music 3 snapshot and license acknowledgement must be selected explicitly.',
  );
  test.skip(
    process.env.MODIFF_ACKNOWLEDGE_MINIMAX_MUSIC3_LICENSE !== '1',
    'The user must explicitly authorize the revision-bound MiniMax Music 3 license acknowledgement.',
  );
  test.setTimeout(6 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory
    ? `${outputDirectory}/${showcaseRequested ? 'minimax-music3-showcase' : 'minimax-music3-audio'}`
    : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
  const repo = 'MiniMaxAI/MiniMax-Music3';
  const revision = 'fbdf52fbaaca799592917417eb05f1899f1255ec';
  const prompt = showcaseRequested
    ? 'Genre: cinematic synth-pop. BPM: 104. Key: D major. Hopeful and luminous, beginning intimate and building into a wide, memorable chorus. Vocals: warm expressive female lead with clear diction and gentle stacked harmonies. Arrangement: pulsing analog synthesizer, clean electric guitar, rounded bass, crisp drums, and a short sparkling bell motif before the final chorus.'
    : 'Short technical audio proof: bright acoustic pop, clear lead vocal, handclaps, and one bell hit.';
  const lyrics = showcaseRequested
    ? '[verse]\nCity lights are waking in the rain\nSilver rivers running down the pane\nEvery quiet signal finds a way\nTo turn the dark into the day\n[chorus]\nWe are sparks across the skyline\nHolding steady through the night\nWhen the morning opens slowly\nWe will rise into the light'
    : '[verse]\nThis is a persistence test\n[chorus]\nThe saved words return';
  const audioDuration = showcaseRequested ? 30 : 2;
  const inferenceSteps = showcaseRequested ? 30 : 2;
  const seed = showcaseRequested ? 7 : 314159;

  await page.addInitScript(
    (sessionKey) => {
      if (window.sessionStorage.getItem(sessionKey)) return;
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.sessionStorage.setItem(sessionKey, 'initialized');
    },
    showcaseRequested ? 'minimax-music3-showcase' : 'minimax-music3-audio-proof',
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await expect(autoToggle).toHaveAttribute('aria-checked', 'false');
  await startCleanWorkflow(page);

  const capability = await page.evaluate(async (modelType) => {
    const body = (await (await fetch('/model_capabilities')).json()) as {
      capabilities?: Array<{
        modelType?: string;
        defaultRepo?: string;
        revisionCandidates?: string[];
        downloadFiles?: string[];
      }>;
    };
    return body.capabilities?.find((candidate) => candidate.modelType === modelType) ?? null;
  }, 'MiniMaxMusic3ModularPipeline');
  expect(capability).toMatchObject({ defaultRepo: repo, revisionCandidates: [revision] });
  expect(capability?.downloadFiles).toHaveLength(23);

  await page.getByTestId('topbar-models').click();
  const manager = page.getByTestId('model-manager-dialog');
  await expect(manager).toBeVisible();
  const managerRow = manager.getByTestId('model-manager-supported-MiniMaxMusic3ModularPipeline');
  await expect(managerRow).toBeVisible({ timeout: 60_000 });
  const install = managerRow.getByTestId('model-manager-install-MiniMaxMusic3ModularPipeline');
  if ((await install.textContent())?.trim() !== 'Ready') {
    const requestPromise = page.waitForRequest(
      (request) => request.url().endsWith('/hf_download') && request.method() === 'POST',
      { timeout: 120_000 },
    );
    await install.click();
    const terms = page.getByTestId('template-usage-terms-dialog');
    await expect(terms).toBeVisible();
    await expect(terms).toContainText('Product and user review required');
    await expect(terms.getByRole('link', { name: 'View terms' })).toHaveAttribute(
      'href',
      `https://huggingface.co/${repo}/blob/${revision}/LICENSE`,
    );
    await page.getByTestId('template-usage-terms-confirm').click();
    const request = await requestPromise;
    expect(request.postDataJSON()).toMatchObject({
      repo_id: repo,
      revision,
      files: capability!.downloadFiles,
    });
    if (evidenceRoot) {
      await page.screenshot({ path: `${evidenceRoot}/frontend-download-started.png`, fullPage: true });
    }
    await waitForModelManagerReady(install, 4 * 60 * 60 * 1000);
  }
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/frontend-model-ready.png`, fullPage: true });
  }
  await manager.getByTestId('model-manager-close').click();

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
  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await page.evaluate(async () => {
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const nodes = useNodesStore.getState();
    await Promise.all([nodes.fetchRuntimeStatus(), nodes.fetchStudioModelCapabilities()]);
  });
  await group.getByRole('button').first().click();
  await page.getByLabel('Search nodes').fill('Mini Max Music3');
  const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: 'Mini Max Music3' });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
  await row.click();
  await clearFinishedSessionActivity(page);

  const root = page.locator('[data-cluster-role="root"]').filter({ hasText: 'Mini Max Music3' });
  await expect(root).toBeVisible();
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  const materializedBlockPaths = await page
    .locator('[data-cluster-role="block"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-cluster-path') ?? ''));
  const promptBlockPath = materializedBlockPaths.find(
    (path) => path.includes('semantic_generator') && path.includes('tokenize'),
  );
  expect(
    promptBlockPath,
    `MiniMax Music 3 tokenize block was not materialized. Observed: ${JSON.stringify(materializedBlockPaths)}`,
  ).toBeTruthy();
  const promptBlock = page.locator(`[data-cluster-role="block"][data-cluster-path="${promptBlockPath!}"]`);
  await expect(promptBlock).toBeVisible({ timeout: 30_000 });
  await promptBlock.getByLabel('Expand Diffusers Block Node parameters').click();
  const promptControl = promptBlock.getByLabel('prompt', { exact: true });
  const lyricsControl = promptBlock.getByLabel('lyrics', { exact: true });
  await promptControl.fill(prompt);
  await promptControl.blur();
  await lyricsControl.fill(lyrics);
  await lyricsControl.blur();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const rootNode = window
          .__MODIFF_E2E__!.getState()
          .flow.nodes.find((candidate) => candidate.huggingFaceClusterRole === 'root');
        return rootNode?.huggingFaceClusterInstance?.parameterOverrides ?? null;
      }),
    )
    .toMatchObject({ prompt, lyrics });
  await page.evaluate(
    ({ durationValue, seedValue, stepsValue }) => {
      const cluster = window
        .__MODIFF_E2E__!.getState()
        .flow.nodes.find((candidate) => candidate.huggingFaceClusterRole === 'root');
      if (!cluster) throw new Error('MiniMax Music 3 Cluster root is unavailable.');
      return Promise.all([
        import('/src/stores/useFlowStore.ts').then(({ useFlowStore }) => {
          const flow = useFlowStore.getState();
          flow.setHuggingFaceClusterParameter(cluster.id, 'audio_duration', durationValue);
          flow.setHuggingFaceClusterParameter(cluster.id, 'num_inference_steps', stepsValue);
          flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'seed', seedValue);
        }),
      ]);
    },
    { durationValue: audioDuration, seedValue: seed, stepsValue: inferenceSteps },
  );
  const persistedBeforeRefresh = await page.evaluate(() => {
    const rootNode = window
      .__MODIFF_E2E__!.getState()
      .flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
    return rootNode
      ? {
          overrides: rootNode.huggingFaceClusterInstance?.parameterOverrides,
          executionOverrides: rootNode.huggingFaceClusterInstance?.execution?.parameterOverrides,
          effective: Object.fromEntries(Object.entries(rootNode.params).map(([key, field]) => [key, field.value])),
        }
      : null;
  });
  expect(persistedBeforeRefresh?.effective).toMatchObject({
    prompt,
    lyrics,
    audio_duration: audioDuration,
    num_inference_steps: inferenceSteps,
  });
  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page
      .getByTestId('save-workflow-name')
      .fill(showcaseRequested ? 'MiniMax Music 3 Showcase' : 'MiniMax Music 3 Frontend Proof');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await clearFinishedSessionActivity(page);
  const persistedAfterRefresh = await page.evaluate(() => {
    const rootNode = window
      .__MODIFF_E2E__!.getState()
      .flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
    return rootNode
      ? {
          overrides: rootNode.huggingFaceClusterInstance?.parameterOverrides,
          executionOverrides: rootNode.huggingFaceClusterInstance?.execution?.parameterOverrides,
          effective: Object.fromEntries(Object.entries(rootNode.params).map(([key, field]) => [key, field.value])),
        }
      : null;
  });
  expect(persistedAfterRefresh).toEqual(persistedBeforeRefresh);
  await expect(promptBlock.getByLabel('prompt', { exact: true })).toHaveValue(prompt);
  await expect(promptBlock.getByLabel('lyrics', { exact: true })).toHaveValue(lyrics);

  const canonicalExport = () =>
    page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const graph = useFlowStore.getState().exportGraph('minimax-music3-equivalence');
      return { nodes: graph.nodes, paths: graph.paths, deterministicMode: graph.deterministicMode };
    });
  const unpreparedExpandedGraph = await canonicalExport();
  await root.getByLabel('Collapse Diffusers Cluster Node').click();
  expect(await canonicalExport()).toEqual(unpreparedExpandedGraph);
  await root.getByRole('button', { name: 'Prepare qualification run' }).click();
  await expect(root.getByRole('status')).toContainText(/Ready for a qualification run/u, { timeout: 300_000 });
  const preparedGraph = await canonicalExport();
  expect(Object.keys(preparedGraph.nodes).length).toBeGreaterThan(1);
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  expect(await canonicalExport()).toEqual(preparedGraph);
  await root.getByLabel('Collapse Diffusers Cluster Node').click();

  const runButton = page.getByTestId('studio-run');
  const submission = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await runButton.click();
  const runTerms = page.getByTestId('model-usage-terms-dialog');
  if (await runTerms.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await page.getByTestId('model-usage-terms-confirm').click();
  }
  const response = await submission;
  expect(response.ok()).toBe(true);
  const submitted = (await response.json()) as { task_id?: string };
  expect(typeof submitted.task_id).toBe('string');
  const taskId = submitted.task_id!;
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const queue = (await (await fetch('/queue')).json()) as {
            current?: { task_id?: string; status?: string; message?: string } | null;
            queued?: Record<string, { task_id?: string; status?: string; message?: string }>;
            recent?: Array<{ task_id?: string; status?: string; message?: string }>;
          };
          return (
            (queue.current?.task_id === id ? queue.current : null) ??
            Object.values(queue.queued ?? {}).find((task) => task.task_id === id) ??
            queue.recent?.find((task) => task.task_id === id) ??
            null
          );
        }, taskId),
      { timeout: 2 * 60 * 60 * 1000, intervals: [1000, 2000, 5000] },
    )
    .toMatchObject({ task_id: taskId, status: 'completed' });
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
            outputs?: Array<{ taskId?: string; displayType?: string; mediaHash?: string; url?: string }>;
          };
          return body.outputs?.find((item) => item.taskId === id) ?? null;
        }, taskId),
      { timeout: 120_000, intervals: [500, 1000, 2000] },
    )
    .toMatchObject({ taskId, displayType: 'audio' });
  const generatedOutput = await page.evaluate(async (id) => {
    const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
      outputs?: Array<{ taskId?: string; displayType?: string; mediaHash?: string; url?: string }>;
    };
    return body.outputs?.find((item) => item.taskId === id) ?? null;
  }, taskId);
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/frontend-generated.png`, fullPage: true });
    const outputUrl = generatedOutput?.url;
    if (!outputUrl) throw new Error('MiniMax Music 3 output URL is unavailable.');
    const assetResponse = await page.request.get(outputUrl);
    expect(assetResponse.ok()).toBe(true);
    const outputFilename = showcaseRequested
      ? 'minimax-music3-showcase-seed-7.wav'
      : 'minimax-music3-technical-proof.wav';
    await writeFile(`${evidenceRoot}/${outputFilename}`, await assetResponse.body());
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          taskId,
          model: { repo, revision },
          persistedBeforeRefresh,
          persistedAfterRefresh,
          collapsedExpandedGraphEquivalent: true,
          outputFilename,
          showcaseCandidate: showcaseRequested,
          generatedOutput,
          qualificationOnly: !showcaseRequested,
          showcaseApproved: false,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live declarative Hub import pins official component revisions and executes without repository Python', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_DECLARATIVE_HUB_IMPORT !== '1',
    'The executable declarative Hub import proof is opt-in because it installs an immutable external repository.',
  );
  test.setTimeout(60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/declarative-hub-import` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
  const runtimeId = 'huggingface-transformers-main-96fe6dce-peft-0.20.0-bitsandbytes-0.50.0';
  const repo = 'diffusers/FLUX.2-klein-4B-modular';
  const revision = '62ac375aa5308588f111fcd12115f5c54a8b1f4f';
  const prompt = 'Technical Hub import proof: a red cube on a neutral gray tabletop.';

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('declarative-hub-import-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('declarative-hub-import-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await page.evaluate(async () => {
    const [{ useNodesStore }, { useSettingsStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useSettingsStore.ts'),
    ]);
    await useNodesStore.getState().fetchOptionalRuntimes();
    useSettingsStore.getState().setRightPanelOpen(true);
    useSettingsStore.getState().setRightPanelTab('setup');
  });
  const runtimeRow = page.getByTestId(`optional-runtime-${runtimeId}`);
  await expect(runtimeRow).toBeVisible({ timeout: 30_000 });
  const installRuntime = runtimeRow.getByRole('button', { name: /^(Install|Repair)$/u });
  if (await installRuntime.isVisible()) {
    const action = (await installRuntime.textContent())?.trim() || 'Install';
    await installRuntime.click();
    const consentDialog = page.getByRole('dialog');
    await expect(consentDialog).toContainText(/optional runtime/u);
    await consentDialog.getByRole('button', { name: action, exact: true }).click();
    await expect(runtimeRow.getByRole('button', { name: 'Activate', exact: true })).toBeVisible({
      timeout: 30 * 60 * 1000,
    });
  }
  const activateRuntime = runtimeRow.getByRole('button', { name: 'Activate', exact: true });
  if (await activateRuntime.isVisible()) {
    await activateRuntime.click();
    const consentDialog = page.getByRole('dialog');
    await expect(consentDialog).toContainText(/Activate validated/u);
    await consentDialog.getByRole('button', { name: 'Activate', exact: true }).click();
  }
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          try {
            const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
            await useNodesStore.getState().fetchOptionalRuntimes();
            const catalog = useNodesStore.getState().optionalRuntimeCatalog;
            const profile = catalog?.profiles.find((candidate) => candidate.id === id);
            return `${catalog?.processLoadStatus ?? 'unknown'}:${profile?.overlayStatus ?? 'unknown'}`;
          } catch {
            return 'unavailable';
          }
        }, runtimeId),
      { timeout: 5 * 60 * 1000, intervals: [1000, 2000, 5000] },
    )
    .toBe('active:active');
  await page.evaluate(async () => {
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const nodes = useNodesStore.getState();
    await Promise.all([nodes.fetchRuntimeStatus(), nodes.fetchStudioModelCapabilities()]);
  });
  await expect
    .poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().websocket.isConnected), {
      timeout: 120_000,
    })
    .toBe(true);
  await page.getByTestId('left-tab-nodes').click();
  const userNodes = page.getByTestId('node-group-User-Nodes');
  if ((await userNodes.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
    await userNodes.getByRole('button').first().click();
  }
  await userNodes.getByTestId('import-hugging-face-user-node').click();
  const dialog = page.getByTestId('import-hugging-face-user-node-dialog');
  await dialog.getByLabel('Hugging Face User Node repository').fill(repo);
  await dialog.getByLabel('Hugging Face User Node revision').fill(revision);
  await dialog.getByTestId('hugging-face-user-node-reviewed').click();
  await dialog.getByTestId('inspect-hugging-face-user-node').click();

  const inspection = dialog.getByTestId('hugging-face-user-node-inspection');
  await expect(inspection).toBeVisible({ timeout: 15 * 60 * 1000 });
  await expect(inspection).toContainText('Flux2 Klein Auto Blocks');
  await expect(inspection).toContainText('mellon_pipeline_config.json');
  await expect(inspection).toContainText('executable');
  await expect(inspection).toContainText('No repository Python was detected or executed');
  await expect(inspection).toContainText('Reviewed components');
  if (evidenceRoot) await page.screenshot({ path: `${evidenceRoot}/inspection.png`, fullPage: true });
  await dialog.getByTestId('confirm-hugging-face-user-node-import').click();
  await expect(dialog).toHaveCount(0, { timeout: 20 * 60 * 1000 });

  const importedBlock = page.locator('.react-flow__node-block').filter({ hasText: 'Flux2 Klein Auto Blocks' });
  await expect(importedBlock).toBeVisible();
  await importedBlock.getByRole('button', { name: 'Expand block' }).click();
  const persistedBeforeRefresh = await page.evaluate(
    async ({ value }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      const node = flow.nodes.find((candidate) => candidate.data.action === 'DynamicBlockNode');
      if (!node) throw new Error('The executable imported Dynamic Block Node is unavailable.');
      flow.setParamWithHistory(node.id, 'prompt', value);
      flow.setParamWithHistory(node.id, 'num_inference_steps', 2);
      flow.setParamWithHistory(node.id, 'auto_offload', true);
      flow.setParamWithHistory(node.id, 'offload_mode', 'model_cpu');
      const refreshed = useFlowStore.getState().nodes.find((candidate) => candidate.id === node.id)!;
      const root = useFlowStore
        .getState()
        .nodes.find((candidate) => candidate.id === refreshed.data.userBlockInstanceId);
      return {
        blockId: refreshed.data.userBlockInstanceId,
        nodeId: refreshed.id,
        outputPortId: root?.data.userBlockSnapshot?.outputs.find((port) => port.paramKey === 'images')?.id,
        repo: refreshed.data.params.repo_id?.value,
        revision: refreshed.data.params.revision?.value,
        trustRemoteCode: refreshed.data.params.trust_remote_code?.value,
        identity: refreshed.data.params.modiff_pipeline_identity?.value,
        prompt: refreshed.data.params.prompt?.value,
        steps: refreshed.data.params.num_inference_steps?.value,
        autoOffload: refreshed.data.params.auto_offload?.value,
        offloadMode: refreshed.data.params.offload_mode?.value,
        disabled: Boolean(refreshed.data.uiState?.disabled),
      };
    },
    { value: prompt },
  );
  expect(persistedBeforeRefresh).toMatchObject({
    repo: { source: 'hub', value: repo },
    revision,
    trustRemoteCode: false,
    prompt,
    steps: 2,
    autoOffload: true,
    offloadMode: 'model_cpu',
    disabled: false,
    identity: {
      schema: 'modiff.custom-pipeline-identity.v3',
      repo_id: repo,
      revision,
      trust_remote_code: false,
      config_filename: 'mellon_pipeline_config.json',
      component_revisions: {
        'black-forest-labs/FLUX.2-klein-4B': 'e7b7dc27f91deacad38e78976d1f2b499d76a294',
        'OzzyGT/Qwen3-4B-bnb-4bit': '89ad3f4ab45a2e6119f49db60f51513d783c3259',
      },
    },
  });
  await importedBlock.getByRole('button', { name: 'Collapse block' }).click();
  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('Declarative Hub Import Proof');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await expect(importedBlock).toBeVisible();
  await importedBlock.getByRole('button', { name: 'Expand block' }).click();
  const persistedAfterRefresh = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const node = useFlowStore.getState().nodes.find((candidate) => candidate.data.action === 'DynamicBlockNode');
    const root = node
      ? useFlowStore.getState().nodes.find((candidate) => candidate.id === node.data.userBlockInstanceId)
      : undefined;
    return node
      ? {
          blockId: node.data.userBlockInstanceId,
          nodeId: node.id,
          outputPortId: root?.data.userBlockSnapshot?.outputs.find((port) => port.paramKey === 'images')?.id,
          repo: node.data.params.repo_id?.value,
          revision: node.data.params.revision?.value,
          trustRemoteCode: node.data.params.trust_remote_code?.value,
          identity: node.data.params.modiff_pipeline_identity?.value,
          prompt: node.data.params.prompt?.value,
          steps: node.data.params.num_inference_steps?.value,
          autoOffload: node.data.params.auto_offload?.value,
          offloadMode: node.data.params.offload_mode?.value,
          disabled: Boolean(node.data.uiState?.disabled),
        }
      : null;
  });
  expect(persistedAfterRefresh).toEqual(persistedBeforeRefresh);
  expect(persistedAfterRefresh?.outputPortId).toBeTruthy();

  let taskId: string | null = null;
  let generatedOutput: { taskId?: string; displayType?: string; mediaHash?: string; url?: string } | null = null;
  if (process.env.MODIFF_RUN_DECLARATIVE_HUB_EXECUTION === '1') {
    await importedBlock.getByRole('button', { name: 'Collapse block' }).click();
    const previewId = await page.evaluate(
      async ({ blockId, outputPortId }) => {
        const previewNodeId = window.__MODIFF_E2E__!.addCustomNodeForTest('modules.Image.Preview');
        const [{ useFlowStore }, { useSettingsStore }, { useStudioStore }] = await Promise.all([
          import('/src/stores/useFlowStore.ts'),
          import('/src/stores/useSettingsStore.ts'),
          import('/src/stores/useStudioStore.ts'),
        ]);
        const root = useFlowStore.getState().nodes.find((node) => node.id === blockId);
        useFlowStore.setState((state) => ({
          nodes: state.nodes.map((node) =>
            node.id === previewNodeId
              ? {
                  ...node,
                  position: {
                    x: (root?.position.x ?? 120) + 520,
                    y: root?.position.y ?? 100,
                  },
                }
              : node,
          ),
        }));
        useFlowStore.getState().onConnect({
          source: blockId,
          sourceHandle: outputPortId,
          target: previewNodeId,
          targetHandle: 'image',
          edgeType: 'default',
        });
        useStudioStore.getState().saveActiveWorkflowTab(true);
        const workflowTabId = useStudioStore.getState().activeWorkflowTabId;
        if (workflowTabId) {
          const requestedAt = Date.now();
          useSettingsStore.getState().setWorkflowFocusRequest({
            workflowTabId,
            nodeId: null,
            requestId: requestedAt,
            requestedAt,
          });
        }
        return previewNodeId;
      },
      { blockId: persistedAfterRefresh!.blockId, outputPortId: persistedAfterRefresh!.outputPortId! },
    );
    await expect(page.locator(`.react-flow__node[data-id="${previewId}"]`)).toBeVisible();
    await expect(page.getByTestId('studio-run')).toBeEnabled();
    const submission = page.waitForResponse(
      (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
      { timeout: 120_000 },
    );
    await page.getByTestId('studio-run').click();
    const response = await submission;
    expect(response.ok()).toBe(true);
    taskId = ((await response.json()) as { task_id?: string }).task_id ?? null;
    expect(taskId).toBeTruthy();
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const queue = (await (await fetch('/queue')).json()) as {
              current?: { task_id?: string; status?: string } | null;
              queued?: Record<string, { task_id?: string; status?: string }>;
              recent?: Array<{ task_id?: string; status?: string }>;
            };
            return (
              (queue.current?.task_id === id ? queue.current : null) ??
              Object.values(queue.queued ?? {}).find((task) => task.task_id === id) ??
              queue.recent?.find((task) => task.task_id === id) ??
              null
            );
          }, taskId),
        { timeout: 45 * 60 * 1000, intervals: [1000, 2000, 5000] },
      )
      .toMatchObject({ task_id: taskId, status: 'completed' });
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
              outputs?: Array<{ taskId?: string; displayType?: string; mediaHash?: string; url?: string }>;
            };
            return body.outputs?.find((item) => item.taskId === id && item.displayType === 'image') ?? null;
          }, taskId),
        { timeout: 120_000, intervals: [500, 1000, 2000] },
      )
      .toMatchObject({ taskId, displayType: 'image' });
    generatedOutput = await page.evaluate(async (id) => {
      const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
        outputs?: Array<{ taskId?: string; displayType?: string; mediaHash?: string; url?: string }>;
      };
      return body.outputs?.find((item) => item.taskId === id) ?? null;
    }, taskId);
  }
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/after-refresh.png`, fullPage: true });
    if (generatedOutput?.url) {
      const assetResponse = await page.request.get(generatedOutput.url);
      expect(assetResponse.ok()).toBe(true);
      await writeFile(`${evidenceRoot}/generated.webp`, await assetResponse.body());
    }
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          repository: repo,
          revision,
          persistedBeforeRefresh,
          persistedAfterRefresh,
          taskId,
          generatedOutput,
          repositoryPythonExecuted: false,
          qualificationOnly: true,
          showcaseApproved: false,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live User Node persistence choices isolate open workflows and survive backend save plus refresh', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_LIVE_USER_NODE_HARDENING !== '1',
    'The live User Node lifecycle proof is selected explicitly.',
  );
  test.setTimeout(10 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/user-node-lifecycle` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('live-user-node-hardening')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('live-user-node-hardening', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);

  const setup = await page.evaluate(async () => {
    const [{ useFlowStore }, { useStudioStore }, { useUserBlockStore }, userBlocks] = await Promise.all([
      import('/src/stores/useFlowStore.ts'),
      import('/src/stores/useStudioStore.ts'),
      import('/src/stores/useUserBlockStore.ts'),
      import('/src/studio/userBlocks.ts'),
    ]);
    const now = Date.now();
    const definition = {
      id: 'live-three-choice-user-node-v1',
      name: 'Live three-choice node',
      version: 1 as const,
      nodes: [
        {
          id: 'value-node',
          type: 'custom',
          position: { x: 0, y: 0 },
          data: {
            type: 'custom',
            module: 'modules.Test',
            action: 'Value',
            label: 'Value',
            category: 'Test',
            params: { value: { label: 'Value', type: 'string', value: 'reusable-original' } },
          },
        },
      ],
      edges: [],
      inputs: [],
      outputs: [],
      exposedParams: [],
      createdAt: now,
      updatedAt: now,
    };
    const saved = await useUserBlockStore.getState().saveBlock(definition);
    const studio = useStudioStore.getState();
    studio.ensureWorkflowTabs();
    const firstWorkflowId = useStudioStore.getState().activeWorkflowTabId!;
    const instanceId = 'live-three-choice-instance';
    useFlowStore.getState().replaceGraph({
      nodes: [userBlocks.createUserBlockNode(saved, { x: 120, y: 120 }, instanceId)],
      edges: [],
    });
    useStudioStore.getState().saveActiveWorkflowTab(true);
    return { definitionId: definition.id, firstWorkflowId, instanceId };
  });
  const block = page.getByTestId(`user-block-${setup.instanceId}`);
  await expect(block).toBeVisible();
  await block.getByRole('button', { name: 'Expand block' }).click();

  const editChild = async (value: string) =>
    page.evaluate(
      async ({ instanceId, nextValue }) => {
        const [{ useFlowStore }, { useStudioStore }] = await Promise.all([
          import('/src/stores/useFlowStore.ts'),
          import('/src/stores/useStudioStore.ts'),
        ]);
        const child = useFlowStore
          .getState()
          .nodes.find((node) => node.data.userBlockInstanceId === instanceId && node.data.params.value);
        if (!child) throw new Error('The live User Node child is unavailable.');
        useFlowStore.getState().setParamWithHistory(child.id, 'value', nextValue);
        useStudioStore.getState().saveActiveWorkflowTab(true);
        return child.id;
      },
      { instanceId: setup.instanceId, nextValue: value },
    );

  await editChild('workflow-only-value');
  await block.getByRole('button', { name: 'Save User Node changes' }).click();
  let choices = page.locator(`[data-testid="save-user-block-choices-${setup.instanceId}"]`);
  await choices.getByRole('button', { name: 'Keep only in this workflow' }).click();
  await expect(choices).toHaveCount(0);
  const reusableAfterWorkflowOnly = await page.evaluate(async (definitionId) => {
    const payload = (await (await fetch('/studio/blocks')).json()) as {
      blocks?: Array<{ id?: string; nodes?: Array<{ data?: { params?: { value?: { value?: unknown } } } }> }>;
    };
    return payload.blocks?.find((candidate) => candidate.id === definitionId)?.nodes?.[0]?.data?.params?.value?.value;
  }, setup.definitionId);
  expect(reusableAfterWorkflowOnly).toBe('reusable-original');

  await editChild('save-as-new-value');
  await block.getByRole('button', { name: 'Save User Node changes' }).click();
  choices = page.locator(`[data-testid="save-user-block-choices-${setup.instanceId}"]`);
  await choices.getByRole('button', { name: 'Save as new User Node' }).click();
  await expect(choices).toHaveCount(0);
  const copied = await page.evaluate(
    async ({ originalId, instanceId }) => {
      const [{ useFlowStore }, { useUserBlockStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useUserBlockStore.ts'),
      ]);
      const root = useFlowStore.getState().nodes.find((node) => node.id === instanceId)!;
      const currentId = root.data.userBlockId!;
      return {
        currentId,
        currentName: root.data.label,
        originalExists: useUserBlockStore.getState().blocks.some((definition) => definition.id === originalId),
        currentExists: useUserBlockStore.getState().blocks.some((definition) => definition.id === currentId),
      };
    },
    { originalId: setup.definitionId, instanceId: setup.instanceId },
  );
  expect(copied.currentId).not.toBe(setup.definitionId);
  expect(copied.currentName).toContain('Workflow 1');
  expect(copied.originalExists).toBe(true);
  expect(copied.currentExists).toBe(true);

  const isolated = await page.evaluate(
    async ({ firstWorkflowId, instanceId }) => {
      const [{ useFlowStore }, { useStudioStore }, userBlocks] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useStudioStore.ts'),
        import('/src/studio/userBlocks.ts'),
      ]);
      const flow = useFlowStore.getState();
      const definition = userBlocks.snapshotUserBlockInstance(flow, instanceId, []);
      if (!definition) throw new Error('Could not capture the first User Node for workflow isolation.');
      useStudioStore.getState().saveActiveWorkflowTab(true);
      const secondWorkflowId = useStudioStore.getState().createWorkflowTab('Isolated User Node workflow');
      useFlowStore.getState().replaceGraph({
        nodes: [userBlocks.createUserBlockNode(definition, { x: 160, y: 140 }, 'isolated-second-instance')],
        edges: [],
      });
      useStudioStore.getState().saveActiveWorkflowTab(true);
      const secondBefore = JSON.stringify(
        useStudioStore.getState().workflowTabs.find((tab) => tab.id === secondWorkflowId)?.snapshot,
      );
      useStudioStore.getState().switchWorkflowTab(firstWorkflowId);
      return { secondWorkflowId, secondBefore };
    },
    { firstWorkflowId: setup.firstWorkflowId, instanceId: setup.instanceId },
  );
  await expect(block).toBeVisible();
  await editChild('updated-existing-value');
  await block.getByRole('button', { name: 'Save User Node changes' }).click();
  choices = page.locator(`[data-testid="save-user-block-choices-${setup.instanceId}"]`);
  await choices.getByRole('button', { name: 'Update existing User Node' }).click();
  await expect(choices).toHaveCount(0);
  const updateProof = await page.evaluate(
    async ({ currentId, secondWorkflowId }) => {
      const [{ useStudioStore }, response] = await Promise.all([
        import('/src/stores/useStudioStore.ts'),
        fetch('/studio/blocks'),
      ]);
      const payload = (await response.json()) as {
        blocks?: Array<{ id?: string; nodes?: Array<{ data?: { params?: { value?: { value?: unknown } } } }> }>;
      };
      return {
        reusableValue: payload.blocks?.find((candidate) => candidate.id === currentId)?.nodes?.[0]?.data?.params?.value
          ?.value,
        secondAfter: JSON.stringify(
          useStudioStore.getState().workflowTabs.find((tab) => tab.id === secondWorkflowId)?.snapshot,
        ),
      };
    },
    { currentId: copied.currentId, secondWorkflowId: isolated.secondWorkflowId },
  );
  expect(updateProof.reusableValue).toBe('updated-existing-value');
  expect(updateProof.secondAfter).toBe(isolated.secondBefore);

  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('Live User Node Lifecycle');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const restored = await page.evaluate(
    async ({ currentId, instanceId, secondWorkflowId }) => {
      const [{ useFlowStore }, { useStudioStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useStudioStore.ts'),
      ]);
      const first = useFlowStore.getState().nodes.find((node) => node.id === instanceId);
      const firstValue = (
        first?.data.userBlockSnapshot?.nodes?.[0] as { data?: { params?: { value?: { value?: unknown } } } } | undefined
      )?.data?.params?.value?.value;
      useStudioStore.getState().switchWorkflowTab(secondWorkflowId);
      const second = useFlowStore.getState().nodes.find((node) => node.id === 'isolated-second-instance');
      const secondValue = (
        second?.data.userBlockSnapshot?.nodes?.[0] as
          { data?: { params?: { value?: { value?: unknown } } } } | undefined
      )?.data?.params?.value?.value;
      return { firstId: first?.data.userBlockId, firstValue, secondValue, expectedId: currentId };
    },
    { currentId: copied.currentId, instanceId: setup.instanceId, secondWorkflowId: isolated.secondWorkflowId },
  );
  expect(restored).toEqual({
    firstId: copied.currentId,
    firstValue: 'updated-existing-value',
    secondValue: 'save-as-new-value',
    expectedId: copied.currentId,
  });
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/isolated-workflow-after-refresh.png`, fullPage: true });
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          setup,
          copied,
          reusableAfterWorkflowOnly,
          updateProof,
          isolated,
          restored,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live Cluster instances remain isolated across two nodes, two workflows, save, and browser refresh', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_LIVE_CLUSTER_ISOLATION !== '1',
    'The live multi-Cluster isolation proof is selected explicitly.',
  );
  test.setTimeout(10 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/cluster-isolation` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('live-cluster-isolation')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('live-cluster-isolation', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
    await group.getByRole('button').first().click();
  }
  await page.getByLabel('Search nodes').fill('Qwen Image — Text To Image');
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(row).toHaveCount(1);
  await row.click();
  await row.click();
  const roots = page.locator('[data-cluster-role="root"]').filter({ hasText: 'Qwen Image' });
  await expect(roots).toHaveCount(2);

  const firstWorkflow = await page.evaluate(async () => {
    const [{ useFlowStore }, { useStudioStore }] = await Promise.all([
      import('/src/stores/useFlowStore.ts'),
      import('/src/stores/useStudioStore.ts'),
    ]);
    const flow = useFlowStore.getState();
    const roots = flow.nodes.filter((node) => node.data.huggingFaceClusterRole === 'root');
    if (roots.length !== 2) throw new Error('Expected two Qwen Cluster roots.');
    const [first, second] = roots;
    const secondBefore = JSON.stringify({
      params: second.data.params,
      instance: second.data.huggingFaceClusterInstance,
    });
    flow.setHuggingFaceClusterParameter(first.id, 'prompt', 'First isolated Cluster prompt');
    flow.setHuggingFaceClusterParameter(first.id, 'width', 320);
    flow.setHuggingFaceClusterParameter(first.id, 'height', 256);
    flow.setHuggingFaceClusterParameter(first.id, 'num_inference_steps', 3);
    flow.setHuggingFaceClusterExecutionParameter(first.id, 'seed', 12345);
    useStudioStore.getState().saveActiveWorkflowTab(true);
    return {
      workflowId: useStudioStore.getState().activeWorkflowTabId!,
      firstId: first.id,
      secondId: second.id,
      secondBefore,
    };
  });
  await page.getByTestId('topbar-save-workflow').click();
  let saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('First Cluster Isolation Workflow');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }

  const secondWorkflowId = await page.evaluate(async () => {
    const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
    return useStudioStore.getState().createWorkflowTab('Second Cluster Isolation Workflow');
  });
  await expect(roots).toHaveCount(0);
  await row.click();
  await expect(roots).toHaveCount(1);
  const secondWorkflowRoot = await page.evaluate(async () => {
    const [{ useFlowStore }, { useStudioStore }] = await Promise.all([
      import('/src/stores/useFlowStore.ts'),
      import('/src/stores/useStudioStore.ts'),
    ]);
    const root = useFlowStore.getState().nodes.find((node) => node.data.huggingFaceClusterRole === 'root');
    if (!root) throw new Error('The second-workflow Cluster is unavailable.');
    useFlowStore.getState().setHuggingFaceClusterParameter(root.id, 'prompt', 'Second workflow Cluster prompt');
    useFlowStore.getState().setHuggingFaceClusterParameter(root.id, 'width', 512);
    useFlowStore.getState().setHuggingFaceClusterExecutionParameter(root.id, 'seed', 67890);
    useStudioStore.getState().saveActiveWorkflowTab(true);
    return root.id;
  });
  await page.getByTestId('topbar-save-workflow').click();
  saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('Second Cluster Isolation Workflow');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await page.evaluate(async (workflowId) => {
    const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
    useStudioStore.getState().switchWorkflowTab(workflowId);
  }, firstWorkflow.workflowId);
  await expect(roots).toHaveCount(2);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);

  const restoredFirst = await page.evaluate(async ({ firstId, secondId, secondBefore }) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const roots = useFlowStore.getState().nodes.filter((node) => node.data.huggingFaceClusterRole === 'root');
    const first = roots.find((node) => node.id === firstId)!;
    const second = roots.find((node) => node.id === secondId)!;
    return {
      first: {
        prompt: first.data.params.prompt?.value,
        width: first.data.params.width?.value,
        height: first.data.params.height?.value,
        steps: first.data.params.num_inference_steps?.value,
        seed: first.data.huggingFaceClusterInstance?.execution?.parameterOverrides?.seed,
      },
      secondUnchanged:
        JSON.stringify({ params: second.data.params, instance: second.data.huggingFaceClusterInstance }) ===
        secondBefore,
    };
  }, firstWorkflow);
  expect(restoredFirst).toEqual({
    first: {
      prompt: 'First isolated Cluster prompt',
      width: 320,
      height: 256,
      steps: 3,
      seed: 12345,
    },
    secondUnchanged: true,
  });
  const restoredSecond = await page.evaluate(
    async ({ workflowId, rootId }) => {
      const [{ useFlowStore }, { useStudioStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useStudioStore.ts'),
      ]);
      useStudioStore.getState().switchWorkflowTab(workflowId);
      const root = useFlowStore.getState().nodes.find((node) => node.id === rootId)!;
      return {
        prompt: root.data.params.prompt?.value,
        width: root.data.params.width?.value,
        seed: root.data.huggingFaceClusterInstance?.execution?.parameterOverrides?.seed,
      };
    },
    { workflowId: secondWorkflowId, rootId: secondWorkflowRoot },
  );
  expect(restoredSecond).toEqual({ prompt: 'Second workflow Cluster prompt', width: 512, seed: 67890 });
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/second-workflow-after-refresh.png`, fullPage: true });
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          firstWorkflow,
          secondWorkflowId,
          secondWorkflowRoot,
          restoredFirst,
          restoredSecond,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live User Node validates a modified pinned Modular block tree through upstream init_pipeline', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_LIVE_MODULAR_COMPOSITION !== '1',
    'The live upstream Modular composition receipt proof is selected explicitly.',
  );
  test.setTimeout(5 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/modular-composition` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('live-modular-composition')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('live-modular-composition', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const instanceId = await page.evaluate(async () => {
    const [{ useFlowStore }, { useStudioStore }, { useUserBlockStore }, libraryStore, userBlocks] = await Promise.all([
      import('/src/stores/useFlowStore.ts'),
      import('/src/stores/useStudioStore.ts'),
      import('/src/stores/useUserBlockStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
      import('/src/studio/userBlocks.ts'),
    ]);
    await libraryStore.useHuggingFaceNodeLibraryStore.getState().fetchLibrary();
    const library = libraryStore.useHuggingFaceNodeLibraryStore.getState().library;
    const definition = library?.definitions.find(
      (candidate) => candidate.pipelineClass === 'QwenImageModularPipeline' && candidate.workflowId === 'text2image',
    );
    if (!definition) throw new Error('The reviewed Qwen Image Modular definition is unavailable.');
    const now = Date.now();
    const block = {
      id: 'live-reviewed-modular-composition-v1',
      name: 'Live reviewed Modular composition',
      version: 1 as const,
      nodes: [
        {
          id: 'viewer',
          type: 'custom',
          position: { x: 0, y: 0 },
          data: {
            type: 'custom',
            module: 'modules.Primitive',
            action: 'DataViewer',
            label: 'Data Viewer',
            category: 'Primitive',
            params: {},
          },
        },
      ],
      edges: [],
      inputs: [],
      outputs: [],
      exposedParams: [],
      createdAt: now,
      updatedAt: now,
      origin: {
        schemaVersion: 1 as const,
        kind: 'hugging_face_cluster_fork' as const,
        provider: 'diffusers' as const,
        definitionId: definition.id,
        libraryRevision: definition.libraryRevision,
        contentHash: definition.contentHash,
        pipelineClass: definition.pipelineClass,
        workflowId: definition.workflowId,
        rootBlockDefinitionId: definition.rootBlockDefinitionId,
        blockContractHash: definition.blockContractHash,
        compositionKind: 'modiff_graph_snapshot' as const,
        importedAt: now,
      },
    };
    const saved = await useUserBlockStore.getState().saveBlock(block);
    const instanceId = 'live-reviewed-modular-composition-instance';
    useFlowStore.getState().replaceGraph({
      nodes: [userBlocks.createUserBlockNode(saved, { x: 100, y: 100 }, instanceId)],
      edges: [],
    });
    useStudioStore.getState().saveActiveWorkflowTab(true);
    return instanceId;
  });
  const block = page.getByTestId(`user-block-${instanceId}`);
  await expect(block).toBeVisible();
  await block.getByRole('button', { name: 'Expand block' }).click();
  await block.getByLabel('Inspect User Node composition').click();
  const dialog = page.getByTestId(`user-block-composition-dialog-${instanceId}`);
  const upstream = dialog.getByTestId(`reviewed-modular-composition-${instanceId}`);
  await expect(upstream).toBeVisible();
  await upstream.getByRole('button', { name: 'Validate duplicate' }).last().click();
  const receipt = dialog.getByTestId(`reviewed-modular-composition-receipt-${instanceId}`);
  await expect(receipt).toContainText('init_pipeline() rebuild passed', { timeout: 60_000 });
  await expect(receipt).toContainText('13 block paths');
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/upstream-rebuild-receipt.png`, fullPage: true });
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          instanceId,
          receiptText: await receipt.textContent(),
          upstreamInitPipelineRebuilt: true,
          modelWeightsLoaded: false,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live Cluster customization recovers from save failure and remains one undoable browser action', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_LIVE_CLUSTER_RECOVERY !== '1',
    'The live Cluster conversion recovery proof is selected explicitly.',
  );
  test.setTimeout(10 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/cluster-conversion-recovery` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('live-cluster-conversion-recovery')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('live-cluster-conversion-recovery', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const previousWorkflowTabId = await page.evaluate(() => window.__MODIFF_E2E__!.getState().studio.activeWorkflowTabId);
  await page.getByTestId('workflow-tab-new').click();
  await expect
    .poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().studio.activeWorkflowTabId))
    .not.toBe(previousWorkflowTabId);
  await expect.poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().flow.nodes.length)).toBe(0);
  const sessionShelf = page.getByTestId('run-session-shelf');
  if (await sessionShelf.isVisible().catch(() => false)) {
    const dismissButtons = sessionShelf.getByRole('button', { name: /^Dismiss /u });
    while ((await dismissButtons.count()) > 0) await dismissButtons.first().click();
    await expect(sessionShelf).toHaveCount(0);
  }
  await page.evaluate(async () => {
    const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
    ]);
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
    ]);
  });
  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
    await group.getByRole('button').first().click();
  }
  await page.getByLabel('Search nodes').fill('Qwen Image — Text To Image');
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(row).toHaveCount(1);
  await row.click();
  const root = page.locator('[data-cluster-role="root"]').filter({ hasText: 'Qwen Image' });
  await expect(root).toBeVisible();
  const rootId = await root.evaluate(
    (element) => element.closest('.react-flow__node')?.getAttribute('data-id') ?? null,
  );
  expect(rootId).toBeTruthy();
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  const adoptedNodeId = await page.evaluate(() =>
    window.__MODIFF_E2E__!.addCustomNodeForTest('modules.Primitive.DataViewer'),
  );
  const adoptedNode = page.locator(`.react-flow__node[data-id="${adoptedNodeId}"]`);
  await page.evaluate(
    async ({ rootId, adoptedNodeId }) => {
      const [{ useFlowStore }, { useSettingsStore }, { useStudioStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useSettingsStore.ts'),
        import('/src/stores/useStudioStore.ts'),
      ]);
      useFlowStore.setState((state) => ({
        nodes: state.nodes.map((node) =>
          node.id === rootId
            ? { ...node, position: { x: 80, y: 80 } }
            : node.id === adoptedNodeId
              ? { ...node, position: { x: 980, y: 180 } }
              : node,
        ),
      }));
      const workflowTabId = useStudioStore.getState().activeWorkflowTabId;
      if (workflowTabId) {
        const requestedAt = Date.now();
        useSettingsStore.getState().setWorkflowFocusRequest({
          workflowTabId,
          nodeId: null,
          requestId: requestedAt,
          requestedAt,
        });
      }
    },
    { rootId: rootId!, adoptedNodeId },
  );
  await expect(root).toBeVisible();
  await expect(adoptedNode).toBeVisible();

  let rejectBlockSave = true;
  await page.route('**/studio/blocks', async (route) => {
    if (route.request().method() === 'POST' && rejectBlockSave) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Injected User Node persistence failure.' }),
      });
      return;
    }
    await route.continue();
  });
  const dragIntoCluster = async () => {
    const adoptedBounds = await adoptedNode.boundingBox();
    const rootBounds = await root.boundingBox();
    expect(adoptedBounds).toBeTruthy();
    expect(rootBounds).toBeTruthy();
    await page.mouse.move(
      adoptedBounds!.x + adoptedBounds!.width / 2,
      adoptedBounds!.y + Math.min(5, adoptedBounds!.height / 2),
    );
    await page.mouse.down();
    await page.mouse.move(
      rootBounds!.x + Math.min(rootBounds!.width - 80, Math.max(120, rootBounds!.width / 2)),
      rootBounds!.y + Math.min(90, rootBounds!.height / 2),
      { steps: 10 },
    );
    await page.mouse.up();
  };

  await dragIntoCluster();
  await expect(
    page.locator('[role="status"], [role="alert"]').filter({ hasText: 'Injected User Node persistence failure' }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(root).toBeVisible();
  const failedState = await page.evaluate(
    async ({ nodeId, clusterId }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      const adopted = flow.nodes.find((node) => node.id === nodeId);
      return {
        clusterPresent: flow.nodes.some((node) => node.id === clusterId && node.data.huggingFaceClusterRole === 'root'),
        userNodePresent: flow.nodes.some((node) => node.id === clusterId && node.data.type === 'block'),
        adoptedParentId: adopted?.parentId ?? null,
        adoptedInstanceId: adopted?.data.userBlockInstanceId ?? null,
      };
    },
    { nodeId: adoptedNodeId, clusterId: rootId! },
  );
  expect(failedState).toEqual({
    clusterPresent: true,
    userNodePresent: false,
    adoptedParentId: null,
    adoptedInstanceId: null,
  });

  rejectBlockSave = false;
  await dragIntoCluster();
  const userNode = page.getByTestId(`user-block-${rootId}`);
  await expect(root).toHaveCount(0, { timeout: 60_000 });
  await expect(userNode).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        async ({ nodeId }) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          const node = useFlowStore.getState().nodes.find((candidate) => candidate.id === nodeId);
          return { parentId: node?.parentId ?? null, instanceId: node?.data.userBlockInstanceId ?? null };
        },
        { nodeId: adoptedNodeId, instanceId: rootId! },
      ),
    )
    .toEqual({ parentId: rootId, instanceId: rootId });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        return useFlowStore.getState().historyTransaction === null;
      }),
    )
    .toBe(true);
  const undoTarget = await page.evaluate(
    async ({ rootId, adoptedNodeId }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      const previous = flow.historyPast.at(-1);
      const root = previous?.nodes.find((node) => node.id === rootId);
      const adopted = previous?.nodes.find((node) => node.id === adoptedNodeId);
      return {
        historyPast: flow.historyPast.length,
        clusterPresent: root?.data.huggingFaceClusterRole === 'root',
        userNodePresent: root?.data.type === 'block',
        adoptedParentId: adopted?.parentId ?? null,
      };
    },
    { rootId: rootId!, adoptedNodeId },
  );
  expect(undoTarget.historyPast).toBeGreaterThan(0);
  expect(undoTarget).toMatchObject({
    clusterPresent: true,
    userNodePresent: false,
    adoptedParentId: null,
  });

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+z');
  await expect(root).toBeVisible();
  await expect(userNode).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(root).toHaveCount(0);
  await expect(userNode).toBeVisible();
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/conversion-redone.png`, fullPage: true });
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          rootId,
          adoptedNodeId,
          failedState,
          failedSavePreservedCluster: true,
          conversionUndoRestoredCluster: true,
          conversionRedoRestoredUserNode: true,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live modified User Node path executes, replaces, deletes, validates, and recovers workflow save', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_LIVE_USER_NODE_TOPOLOGY !== '1',
    'The live User Node topology and interrupted-save proof is selected explicitly.',
  );
  test.setTimeout(10 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/user-node-topology` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('live-user-node-topology')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('live-user-node-topology', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const setup = await page.evaluate(async () => {
    const textId = window.__MODIFF_E2E__!.addCustomNodeForTest('modules.Primitive.TextValue');
    const viewerId = window.__MODIFF_E2E__!.addCustomNodeForTest('modules.Primitive.DataViewer');
    const [{ useFlowStore }, { useStudioStore }, { useUserBlockStore }, userBlocks] = await Promise.all([
      import('/src/stores/useFlowStore.ts'),
      import('/src/stores/useStudioStore.ts'),
      import('/src/stores/useUserBlockStore.ts'),
      import('/src/studio/userBlocks.ts'),
    ]);
    const flow = useFlowStore.getState();
    flow.setParam(textId, 'text', 'Live guided composition execution');
    flow.onConnect({
      source: textId,
      sourceHandle: 'output',
      target: viewerId,
      targetHandle: 'value',
      edgeType: 'default',
    });
    const selected = {
      nodes: useFlowStore
        .getState()
        .nodes.map((node) => ({ ...node, selected: node.id === textId || node.id === viewerId })),
      edges: useFlowStore.getState().edges,
    };
    const created = userBlocks.createUserBlockFromSelection(selected, 'Live guided User Node');
    if (!created.ok) throw new Error(created.reason);
    const saved = await useUserBlockStore.getState().saveBlock(created.block);
    const instanceId = 'live-guided-user-node-instance';
    useFlowStore.getState().replaceGraph({
      nodes: [userBlocks.createUserBlockNode(saved, { x: 120, y: 100 }, instanceId)],
      edges: [],
    });
    useStudioStore.getState().saveActiveWorkflowTab(true);
    return { instanceId, textSourceId: textId, viewerSourceId: viewerId };
  });
  const block = page.getByTestId(`user-block-${setup.instanceId}`);
  await expect(block).toBeVisible();
  await block.getByRole('button', { name: 'Expand block' }).click();

  const insertedNodeId = await page.evaluate(async (instanceId) => {
    const nodeId = window.__MODIFF_E2E__!.addCustomNodeForTest('modules.Primitive.DataViewer');
    const [{ useFlowStore }, { useStudioStore }, userBlocks] = await Promise.all([
      import('/src/stores/useFlowStore.ts'),
      import('/src/stores/useStudioStore.ts'),
      import('/src/studio/userBlocks.ts'),
    ]);
    useFlowStore.getState().placeNodeInUserBlock(nodeId, instanceId);
    const report = userBlocks.inspectUserBlockComposition(useFlowStore.getState(), instanceId);
    const suggestion = report.insertionSuggestions.find((candidate) => candidate.nodeId === nodeId);
    if (!suggestion) throw new Error('The compatible guided insertion point was not discovered.');
    useFlowStore.getState().insertNodeInUserBlock(instanceId, suggestion);
    useStudioStore.getState().saveActiveWorkflowTab(true);
    return nodeId;
  }, setup.instanceId);
  const insertedPath = await page.evaluate(
    async ({ instanceId, insertedNodeId }) => {
      const [{ useFlowStore }, userBlocks] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/studio/userBlocks.ts'),
      ]);
      const flow = useFlowStore.getState();
      const report = userBlocks.inspectUserBlockComposition(flow, instanceId);
      return {
        valid: report.valid,
        nodePresent: flow.nodes.some(
          (node) => node.id === insertedNodeId && node.data.userBlockInstanceId === instanceId,
        ),
        edgeCount: flow.edges.filter((edge) => edge.data?.userBlockInstanceId === instanceId).length,
      };
    },
    { instanceId: setup.instanceId, insertedNodeId },
  );
  expect(insertedPath).toEqual({ valid: true, nodePresent: true, edgeCount: 2 });
  await block.getByRole('button', { name: 'Collapse block' }).click();
  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('Live User Node Topology');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await expect(block).toBeVisible();
  const restoredInsertion = await page.evaluate(
    async ({ instanceId, insertedNodeId }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const root = useFlowStore.getState().nodes.find((node) => node.id === instanceId);
      const definitionNodes = (root?.data.userBlockSnapshot?.nodes ?? []) as Array<{ id?: string }>;
      return {
        insertedPersisted: definitionNodes.some((node) => node.id === insertedNodeId),
        nodeCount: definitionNodes.length,
        edgeCount: root?.data.userBlockSnapshot?.edges.length ?? 0,
      };
    },
    { instanceId: setup.instanceId, insertedNodeId },
  );
  expect(restoredInsertion).toEqual({ insertedPersisted: true, nodeCount: 3, edgeCount: 2 });
  await expect(page.getByTestId('studio-run')).toBeEnabled();
  const submission = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByTestId('studio-run').click();
  const submitted = await submission;
  expect(submitted.ok()).toBe(true);
  const taskId = ((await submitted.json()) as { task_id?: string }).task_id;
  expect(taskId).toBeTruthy();
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const queue = (await (await fetch('/queue')).json()) as {
            current?: { task_id?: string; status?: string } | null;
            queued?: Record<string, { task_id?: string; status?: string }>;
            recent?: Array<{ task_id?: string; status?: string }>;
          };
          return (
            (queue.current?.task_id === id ? queue.current : null) ??
            Object.values(queue.queued ?? {}).find((task) => task.task_id === id) ??
            queue.recent?.find((task) => task.task_id === id) ??
            null
          );
        }, taskId),
      { timeout: 120_000, intervals: [500, 1000, 2000] },
    )
    .toMatchObject({ task_id: taskId, status: 'completed' });

  await block.getByRole('button', { name: 'Expand block' }).click();
  const replacementNodeId = await page.evaluate(
    async ({ instanceId, insertedNodeId, textSourceId, viewerSourceId }) => {
      const [{ useFlowStore }, { useStudioStore }, userBlocks] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useStudioStore.ts'),
        import('/src/studio/userBlocks.ts'),
      ]);
      const flow = useFlowStore.getState();
      const text = flow.nodes.find(
        (node) => node.data.userBlockInstanceId === instanceId && node.data.userBlockSourceNodeId === textSourceId,
      );
      const viewer = flow.nodes.find(
        (node) => node.data.userBlockInstanceId === instanceId && node.data.userBlockSourceNodeId === viewerSourceId,
      );
      const inserted = flow.nodes.find(
        (node) => node.data.userBlockInstanceId === instanceId && node.data.userBlockSourceNodeId === insertedNodeId,
      );
      if (!text || !viewer || !inserted) throw new Error('The original User Node path was not restored.');
      flow.removeNodes([inserted.id]);
      useFlowStore.getState().onConnect({
        source: text.id,
        sourceHandle: 'output',
        target: viewer.id,
        targetHandle: 'value',
        edgeType: 'default',
      });
      const replacementId = window.__MODIFF_E2E__!.addCustomNodeForTest('modules.Primitive.DataViewer');
      useFlowStore.getState().placeNodeInUserBlock(replacementId, instanceId);
      const report = userBlocks.inspectUserBlockComposition(useFlowStore.getState(), instanceId);
      const suggestion = report.insertionSuggestions.find((candidate) => candidate.nodeId === replacementId);
      if (!suggestion) throw new Error('The replacement insertion point was not discovered.');
      useFlowStore.getState().insertNodeInUserBlock(instanceId, suggestion);
      useStudioStore.getState().saveActiveWorkflowTab(true);
      return replacementId;
    },
    { ...setup, insertedNodeId },
  );
  const validGraph = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore.getState().toObject();
  });
  const invalidMessage = await page.evaluate(
    async ({ instanceId, textSourceId }) => {
      const [{ useFlowStore }, userBlocks] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/studio/userBlocks.ts'),
      ]);
      const flow = useFlowStore.getState();
      const text = flow.nodes.find(
        (node) => node.data.userBlockInstanceId === instanceId && node.data.userBlockSourceNodeId === textSourceId,
      );
      const edge = flow.edges.find((candidate) => candidate.source === text?.id);
      if (!edge) throw new Error('The replacement path has no source edge.');
      flow.replaceGraph(
        {
          nodes: flow.nodes,
          edges: flow.edges.map((candidate) =>
            candidate.id === edge.id ? { ...candidate, sourceHandle: 'text' } : candidate,
          ),
        },
        { historyLabel: 'Inject invalid User Node socket for recovery proof' },
      );
      return userBlocks.inspectUserBlockComposition(useFlowStore.getState(), instanceId).issues[0]?.message ?? null;
    },
    { instanceId: setup.instanceId, textSourceId: setup.textSourceId },
  );
  expect(invalidMessage).toMatch(/must connect from an output to an input socket/u);
  await block.getByRole('button', { name: 'Collapse block' }).click();
  await expect(page.getByTestId('studio-run')).toBeDisabled();
  await expect(page.getByTestId('studio-run')).toHaveAttribute(
    'title',
    /must connect from an output to an input socket/u,
  );
  await page.evaluate(async (graph) => {
    const [{ useFlowStore }, { useStudioStore }] = await Promise.all([
      import('/src/stores/useFlowStore.ts'),
      import('/src/stores/useStudioStore.ts'),
    ]);
    useFlowStore.getState().replaceGraph(graph, { historyLabel: 'Recover valid User Node path' });
    useStudioStore.getState().saveActiveWorkflowTab(true);
  }, validGraph);
  // Commit the recovered expanded children into the root's embedded snapshot
  // before exercising backend workflow persistence and page hydration.
  await block.getByRole('button', { name: 'Collapse block' }).click();

  let rejectWorkflowSave = true;
  await page.route('**/workflows/*', async (route) => {
    if (route.request().method() === 'PUT' && rejectWorkflowSave) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Injected workflow persistence failure.' }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByTestId('topbar-save-workflow').click();
  await expect(
    page.locator('[role="status"], [role="alert"]').filter({ hasText: 'Injected workflow persistence failure' }),
  ).toBeVisible({ timeout: 30_000 });
  const afterFailedWorkflowSave = await page.evaluate(
    async ({ instanceId, insertedNodeId, replacementNodeId }) => {
      const [{ useFlowStore }, { useStudioStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useStudioStore.ts'),
      ]);
      const flow = useFlowStore.getState();
      const studio = useStudioStore.getState();
      const root = flow.nodes.find((node) => node.id === instanceId);
      const snapshotNodes = (root?.data.userBlockSnapshot?.nodes ?? []) as Array<{ id?: string }>;
      return {
        dirty: studio.workflowTabs.find((tab) => tab.id === studio.activeWorkflowTabId)?.dirty,
        oldNodeDeleted: !snapshotNodes.some((node) => node.id === insertedNodeId),
        replacementPresent: snapshotNodes.some((node) => node.id === replacementNodeId),
        instancePresent: Boolean(root),
      };
    },
    { instanceId: setup.instanceId, insertedNodeId, replacementNodeId },
  );
  expect(afterFailedWorkflowSave).toEqual({
    dirty: true,
    oldNodeDeleted: true,
    replacementPresent: true,
    instancePresent: true,
  });
  rejectWorkflowSave = false;
  const successfulRetry = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && /\/workflows\//u.test(response.url()),
    { timeout: 30_000 },
  );
  await page.getByTestId('topbar-save-workflow').click();
  expect((await successfulRetry).ok()).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
        const studio = useStudioStore.getState();
        return studio.workflowTabs.find((tab) => tab.id === studio.activeWorkflowTabId)?.dirty ?? true;
      }),
    )
    .toBe(false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const restoredReplacement = await page.evaluate(
    async ({ instanceId, insertedNodeId, replacementNodeId }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const root = useFlowStore.getState().nodes.find((node) => node.id === instanceId);
      const nodes = (root?.data.userBlockSnapshot?.nodes ?? []) as Array<{ id?: string }>;
      return {
        deletedAbsent: !nodes.some((node) => node.id === insertedNodeId),
        replacementPresent: nodes.some((node) => node.id === replacementNodeId),
        nodeCount: nodes.length,
        edgeCount: root?.data.userBlockSnapshot?.edges.length ?? 0,
      };
    },
    { instanceId: setup.instanceId, insertedNodeId, replacementNodeId },
  );
  expect(restoredReplacement).toEqual({
    deletedAbsent: true,
    replacementPresent: true,
    nodeCount: 3,
    edgeCount: 2,
  });
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/replacement-after-recovery-refresh.png`, fullPage: true });
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          taskId,
          setup,
          insertedNodeId,
          insertedPath,
          restoredInsertion,
          replacementNodeId,
          invalidMessage,
          afterFailedWorkflowSave,
          restoredReplacement,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live Qwen Image Cluster persists internal edits, customizes as User Nodes, and executes both forms', async ({
  page,
}) => {
  const showcaseRequested = process.env.MODIFF_RUN_QWEN_IMAGE_SHOWCASE === '1';
  test.skip(
    process.env.MODIFF_RUN_QWEN_IMAGE_CLUSTER !== '1' && !showcaseRequested,
    'The installed Qwen Image Cluster acceptance scenario must be selected explicitly.',
  );
  test.setTimeout((showcaseRequested ? 4 : 2) * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory
    ? `${outputDirectory}/${showcaseRequested ? 'qwen-image-2512-showcase' : 'qwen-image-cluster'}`
    : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
  const runtimeId = 'huggingface-transformers-main-96fe6dce-peft-0.20.0';
  const repo = 'Qwen/Qwen-Image-2512';
  const revision = '25468b98e3276ca6700de15c6628e51b7de54a26';
  const prompt = showcaseRequested
    ? 'A cinematic botanical observatory at blue hour, a circular glass pavilion filled with towering tropical plants and delicate bioluminescent flowers, warm amber reading lamps reflecting in rain-covered windows, a brass telescope aimed through the open dome, richly detailed natural materials, believable atmospheric depth, elegant editorial photography, precise composition, realistic reflections, subtle film grain, no people.'
    : 'Technical persistence proof: a red cube and a blue sphere on a white tabletop, studio light.';
  const negativePrompt = showcaseRequested
    ? 'low resolution, low quality, oversaturated, waxy, artificial-looking, cluttered composition, blurry text, distorted geometry, duplicate objects, malformed plants, flat lighting'
    : '';
  const width = showcaseRequested ? 1328 : 256;
  const height = showcaseRequested ? 1328 : 256;
  const inferenceSteps = showcaseRequested ? 50 : 2;
  const guidanceScale = showcaseRequested ? 4 : 1;
  const seed = showcaseRequested ? 280828 : 271828;

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('qwen-image-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('qwen-image-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await expect(autoToggle).toHaveAttribute('aria-checked', 'false');
  await startCleanWorkflow(page);
  await page.evaluate(async () => {
    const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }, { useSettingsStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
      import('/src/stores/useSettingsStore.ts'),
    ]);
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useNodesStore.getState().fetchOptionalRuntimes(),
      useNodesStore.getState().refreshModelIndexes(false),
      useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
    ]);
    useSettingsStore.getState().setRightPanelOpen(true);
    useSettingsStore.getState().setRightPanelTab('setup');
  });

  const runtimeRow = page.getByTestId(`optional-runtime-${runtimeId}`);
  await expect(runtimeRow).toBeVisible({ timeout: 30_000 });
  const installRuntime = runtimeRow.getByRole('button', { name: /^(Install|Repair)$/u });
  if (await installRuntime.isVisible()) {
    const action = (await installRuntime.textContent())?.trim() || 'Install';
    await installRuntime.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/optional runtime/u);
    await dialog.getByRole('button', { name: action, exact: true }).click();
    await expect(runtimeRow.getByRole('button', { name: 'Activate', exact: true })).toBeVisible({
      timeout: 30 * 60 * 1000,
    });
  }
  const activateRuntime = runtimeRow.getByRole('button', { name: 'Activate', exact: true });
  if (await activateRuntime.isVisible()) {
    await activateRuntime.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/Activate validated/u);
    await dialog.getByRole('button', { name: 'Activate', exact: true }).click();
  }
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          try {
            const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
            await useNodesStore.getState().fetchOptionalRuntimes();
            const catalog = useNodesStore.getState().optionalRuntimeCatalog;
            const profile = catalog?.profiles.find((candidate) => candidate.id === id);
            return `${catalog?.processLoadStatus ?? 'unknown'}:${profile?.overlayStatus ?? 'unknown'}`;
          } catch {
            return 'unavailable';
          }
        }, runtimeId),
      { timeout: 5 * 60 * 1000, intervals: [1000, 2000, 5000] },
    )
    .toBe('active:active');
  await expect
    .poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().websocket.isConnected), {
      timeout: 120_000,
    })
    .toBe(true);

  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await group.getByRole('button').first().click();
  await page.getByLabel('Search nodes').fill('Qwen Image — Text To Image');
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
  await row.click();

  // The persistent activity shelf can overlap expanded block controls when the
  // backend already has completed qualification runs from this campaign.
  await clearFinishedSessionActivity(page);

  const root = page.locator('[data-cluster-role="root"]').filter({ hasText: 'Qwen Image' });
  await expect(root).toBeVisible();
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  // The reviewed Qwen auto block is a selector. Its active, editable branch is
  // the nested text_encoder placement, while the parent selector is sealed.
  const promptBlock = page.locator('[data-cluster-role="block"][data-cluster-path="text_encoder/text_encoder"]');
  await expect(promptBlock).toBeVisible();
  await promptBlock.getByLabel('Expand Diffusers Block Node parameters').click();
  const promptControl = promptBlock.getByLabel('prompt', { exact: true });
  await promptControl.fill(prompt);
  await promptControl.blur();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const rootNode = window
          .__MODIFF_E2E__!.getState()
          .flow.nodes.find((candidate) => candidate.huggingFaceClusterRole === 'root');
        return rootNode?.huggingFaceClusterInstance?.parameterOverrides.prompt ?? null;
      }),
    )
    .toBe(prompt);
  await page.evaluate(
    ({ guidanceScaleValue, heightValue, negativePromptValue, seedValue, stepsValue, widthValue }) => {
      const cluster = window
        .__MODIFF_E2E__!.getState()
        .flow.nodes.find((candidate) => candidate.huggingFaceClusterRole === 'root');
      if (!cluster) throw new Error('Qwen Image Cluster root is unavailable.');
      return import('/src/stores/useFlowStore.ts').then(({ useFlowStore }) => {
        const flow = useFlowStore.getState();
        flow.setHuggingFaceClusterParameter(cluster.id, 'negative_prompt', negativePromptValue);
        flow.setHuggingFaceClusterParameter(cluster.id, 'width', widthValue);
        flow.setHuggingFaceClusterParameter(cluster.id, 'height', heightValue);
        flow.setHuggingFaceClusterParameter(cluster.id, 'num_inference_steps', stepsValue);
        flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'guidanceScale', guidanceScaleValue);
        flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'seed', seedValue);
      });
    },
    {
      guidanceScaleValue: guidanceScale,
      heightValue: height,
      negativePromptValue: negativePrompt,
      seedValue: seed,
      stepsValue: inferenceSteps,
      widthValue: width,
    },
  );
  const persistedBeforeRefresh = await page.evaluate(() => {
    const rootNode = window
      .__MODIFF_E2E__!.getState()
      .flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
    return rootNode
      ? {
          id: rootNode.id,
          overrides: rootNode.huggingFaceClusterInstance?.parameterOverrides,
          executionOverrides: rootNode.huggingFaceClusterInstance?.execution?.parameterOverrides,
          effective: Object.fromEntries(Object.entries(rootNode.params).map(([key, field]) => [key, field.value])),
        }
      : null;
  });
  expect(persistedBeforeRefresh?.effective).toMatchObject({
    prompt,
    negative_prompt: negativePrompt,
    width,
    height,
    num_inference_steps: inferenceSteps,
  });
  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page
      .getByTestId('save-workflow-name')
      .fill(showcaseRequested ? 'Qwen Image 2512 Showcase' : 'Qwen Image Cluster Frontend Proof');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await clearFinishedSessionActivity(page);
  const persistedAfterRefresh = await page.evaluate(() => {
    const rootNode = window
      .__MODIFF_E2E__!.getState()
      .flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
    return rootNode
      ? {
          id: rootNode.id,
          overrides: rootNode.huggingFaceClusterInstance?.parameterOverrides,
          executionOverrides: rootNode.huggingFaceClusterInstance?.execution?.parameterOverrides,
          effective: Object.fromEntries(Object.entries(rootNode.params).map(([key, field]) => [key, field.value])),
        }
      : null;
  });
  expect(persistedAfterRefresh).toEqual(persistedBeforeRefresh);
  await expect(promptBlock.getByLabel('prompt', { exact: true })).toHaveValue(prompt);

  const canonicalExport = () =>
    page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const graph = useFlowStore.getState().exportGraph('qwen-image-cluster-equivalence');
      return { nodes: graph.nodes, paths: graph.paths, deterministicMode: graph.deterministicMode };
    });
  const unpreparedExpandedGraph = await canonicalExport();
  await root.getByLabel('Collapse Diffusers Cluster Node').click();
  expect(await canonicalExport()).toEqual(unpreparedExpandedGraph);
  await root.getByRole('button', { name: 'Prepare qualification run' }).click();
  await expect(root.getByRole('status')).toContainText(/Ready for a qualification run/u, { timeout: 300_000 });
  const preparedGraph = await canonicalExport();
  expect(Object.keys(preparedGraph.nodes).length).toBeGreaterThan(1);
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  expect(await canonicalExport()).toEqual(preparedGraph);
  await root.getByLabel('Collapse Diffusers Cluster Node').click();

  const runGraph = async () => {
    const submission = page.waitForResponse(
      (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
      { timeout: 120_000 },
    );
    await page.getByTestId('studio-run').click();
    const response = await submission;
    expect(response.ok()).toBe(true);
    const submitted = (await response.json()) as { task_id?: string };
    expect(typeof submitted.task_id).toBe('string');
    const taskId = submitted.task_id!;
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            try {
              const response = await fetch('/queue');
              if (!response.ok) return null;
              const queue = (await response.json()) as {
                current?: { task_id?: string; status?: string; message?: string } | null;
                queued?: Record<string, { task_id?: string; status?: string; message?: string }>;
                recent?: Array<{ task_id?: string; status?: string; message?: string }>;
              };
              return (
                (queue.current?.task_id === id ? queue.current : null) ??
                Object.values(queue.queued ?? {}).find((task) => task.task_id === id) ??
                queue.recent?.find((task) => task.task_id === id) ??
                null
              );
            } catch {
              return null;
            }
          }, taskId),
        { timeout: 90 * 60 * 1000, intervals: [1000, 2000, 5000] },
      )
      .toMatchObject({ task_id: taskId, status: 'completed' });
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            try {
              const response = await fetch('/studio_outputs?limit=200');
              if (!response.ok) return null;
              const body = (await response.json()) as {
                outputs?: Array<{ taskId?: string; displayType?: string; mediaHash?: string; url?: string }>;
              };
              return body.outputs?.find((item) => item.taskId === id) ?? null;
            } catch {
              return null;
            }
          }, taskId),
        { timeout: 120_000, intervals: [500, 1000, 2000] },
      )
      .toMatchObject({ taskId, displayType: 'image' });
    return taskId;
  };

  const clusterTaskId = await runGraph();
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/cluster-generated.png`, fullPage: false, timeout: 30_000 });
  }
  if (showcaseRequested) {
    const output = await page.evaluate(async (id) => {
      const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
        outputs?: Array<{ taskId?: string; displayType?: string; mediaHash?: string; url?: string }>;
      };
      return body.outputs?.find((item) => item.taskId === id && item.displayType === 'image') ?? null;
    }, clusterTaskId);
    expect(output?.url).toBeTruthy();
    const filename = `qwen-image-2512-showcase-seed-${seed}.webp`;
    const response = await page.request.get(new URL(output!.url!, page.url()).toString());
    expect(response.ok()).toBe(true);
    if (evidenceRoot) {
      await writeFile(`${evidenceRoot}/${filename}`, await response.body());
      await writeFile(
        `${evidenceRoot}/frontend-result.json`,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            model: { repo, revision },
            clusterTaskId,
            persistedBeforeRefresh,
            persistedAfterRefresh,
            collapsedExpandedGraphEquivalent: true,
            output,
            outputFilename: filename,
            showcaseCandidate: true,
            showcaseApproved: false,
            publicationUnchangedPendingApproval: true,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    }
    return;
  }
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  const adoptedNodeId = await page.evaluate(() =>
    window.__MODIFF_E2E__!.addCustomNodeForTest('modules.Primitive.DataViewer'),
  );
  await page.evaluate(
    async ({ nodeId, rootId }) => {
      const [{ useFlowStore }, { useSettingsStore }, { useStudioStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useSettingsStore.ts'),
        import('/src/stores/useStudioStore.ts'),
      ]);
      useFlowStore.setState((state) => {
        const rootNode = state.nodes.find((node) => node.id === rootId);
        const rootWidth = rootNode?.measured?.width ?? rootNode?.width ?? 2400;
        return {
          nodes: state.nodes.map((node) =>
            node.id === rootId
              ? { ...node, position: { x: 80, y: 80 } }
              : node.id === nodeId
                ? { ...node, position: { x: 80 + rootWidth + 300, y: 180 } }
                : node,
          ),
        };
      });
      const flow = useFlowStore.getState();
      await flow.onNodesChange(
        flow.nodes.map((node) => ({ id: node.id, type: 'select' as const, selected: node.id === nodeId })),
      );
      const workflowTabId = useStudioStore.getState().activeWorkflowTabId;
      if (workflowTabId) {
        const requestedAt = Date.now();
        useSettingsStore.getState().setWorkflowFocusRequest({
          workflowTabId,
          nodeId: null,
          requestId: requestedAt,
          requestedAt,
        });
      }
    },
    { nodeId: adoptedNodeId, rootId: persistedBeforeRefresh!.id },
  );
  const adoptedNode = page.locator(`.react-flow__node[data-id="${adoptedNodeId}"]`);
  await expect(adoptedNode).toBeVisible();
  const adoptedBounds = await adoptedNode.boundingBox();
  const expandedClusterBounds = await root.boundingBox();
  expect(adoptedBounds).toBeTruthy();
  expect(expandedClusterBounds).toBeTruthy();
  await page.mouse.move(
    adoptedBounds!.x + adoptedBounds!.width / 2,
    adoptedBounds!.y + Math.min(5, adoptedBounds!.height / 2),
  );
  await page.mouse.down();
  await page.mouse.move(
    expandedClusterBounds!.x + expandedClusterBounds!.width - 40,
    expandedClusterBounds!.y + Math.min(100, expandedClusterBounds!.height / 3),
    { steps: 10 },
  );
  await page.mouse.up();
  const dragHit = await page.evaluate(
    async ({ nodeId, rootId }) => {
      const [{ useFlowStore }, { expandedHuggingFaceClusterAtPosition }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/studio/huggingFaceClusterGraph.ts'),
      ]);
      const nodes = useFlowStore.getState().nodes;
      const node = nodes.find((candidate) => candidate.id === nodeId);
      const rootNode = nodes.find((candidate) => candidate.id === rootId);
      if (!node || !rootNode) return { node: null, root: null, targetId: null };
      const width = node.measured?.width ?? node.width ?? 220;
      const height = node.measured?.height ?? node.height ?? 120;
      const center = { x: node.position.x + width / 2, y: node.position.y + height / 2 };
      return {
        node: { position: node.position, width, height, center },
        root: {
          position: rootNode.position,
          width: rootNode.measured?.width ?? rootNode.width ?? null,
          height: rootNode.measured?.height ?? rootNode.height ?? null,
        },
        targetId: expandedHuggingFaceClusterAtPosition(nodes, center)?.id ?? null,
      };
    },
    { nodeId: adoptedNodeId, rootId: persistedBeforeRefresh!.id },
  );
  expect(dragHit.targetId, JSON.stringify(dragHit)).toBe(persistedBeforeRefresh!.id);
  await expect(root).toHaveCount(0);
  const userNode = page.getByTestId(`user-block-${persistedBeforeRefresh!.id}`);
  await expect(userNode).toBeVisible();
  await expect(userNode).toContainText('Workflow 1');
  await expect
    .poll(() =>
      page.evaluate(
        async ({ nodeId, blockId }) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          const node = useFlowStore.getState().nodes.find((candidate) => candidate.id === nodeId);
          return { parentId: node?.parentId ?? null, instanceId: node?.data.userBlockInstanceId ?? null, blockId };
        },
        { nodeId: adoptedNodeId, blockId: persistedBeforeRefresh!.id },
      ),
    )
    .toEqual({
      parentId: persistedBeforeRefresh!.id,
      instanceId: persistedBeforeRefresh!.id,
      blockId: persistedBeforeRefresh!.id,
    });
  const retainedConnection = await page.evaluate(
    async ({ nodeId, blockId }) => {
      const [{ useFlowStore }, { useStudioStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useStudioStore.ts'),
      ]);
      const flow = useFlowStore.getState();
      const decode = flow.nodes.find(
        (candidate) =>
          candidate.data.userBlockInstanceId === blockId &&
          candidate.data.module === 'modules.ModularDiffusers' &&
          candidate.data.action === 'DecodeLatents',
      );
      if (!decode) throw new Error('The customized Qwen User Node has no image decode child.');
      flow.onConnect({
        source: decode.id,
        sourceHandle: 'images',
        target: nodeId,
        targetHandle: 'value',
        edgeType: 'default',
      });
      useStudioStore.getState().saveActiveWorkflowTab(true);
      return { source: decode.id, sourceHandle: 'images', target: nodeId, targetHandle: 'value' };
    },
    { nodeId: adoptedNodeId, blockId: persistedBeforeRefresh!.id },
  );
  await expect
    .poll(() =>
      page.evaluate(async ({ source, sourceHandle, target, targetHandle }) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        return useFlowStore
          .getState()
          .edges.some(
            (edge) =>
              edge.source === source &&
              edge.sourceHandle === sourceHandle &&
              edge.target === target &&
              edge.targetHandle === targetHandle,
          );
      }, retainedConnection),
    )
    .toBe(true);
  await userNode.getByLabel('Collapse block').click();
  const modifiedGraph = await canonicalExport();
  expect(modifiedGraph).not.toEqual(preparedGraph);
  expect(Object.keys(modifiedGraph.nodes).length).toBe(Object.keys(preparedGraph.nodes).length + 1);
  await userNode.getByLabel('Expand block').click();
  const internalNodes = await page.evaluate(async (instanceId) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore
      .getState()
      .nodes.filter((node) => node.data.userBlockInstanceId === instanceId)
      .map((node) => ({ module: node.data.module, action: node.data.action }));
  }, persistedBeforeRefresh!.id);
  expect(internalNodes.length).toBeGreaterThan(1);
  await userNode.getByLabel('Collapse block').click();
  expect(await canonicalExport()).toEqual(modifiedGraph);
  await page.getByTestId('topbar-save-workflow').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await expect(userNode).toContainText('Workflow 1');
  expect(await canonicalExport()).toEqual(modifiedGraph);
  const userNodeTaskId = await runGraph();
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/user-node-generated.png`, fullPage: false, timeout: 30_000 });
    const outputs = await page.evaluate(
      async (ids) => {
        const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
          outputs?: Array<{ taskId?: string; displayType?: string; mediaHash?: string; url?: string }>;
        };
        return body.outputs?.filter((item) => ids.includes(item.taskId ?? '')) ?? [];
      },
      [clusterTaskId, userNodeTaskId],
    );
    const savedAssets: Record<string, string> = {};
    for (const [taskId, filename] of [
      [clusterTaskId, 'qwen-cluster-generated.webp'],
      [userNodeTaskId, 'qwen-user-node-generated.webp'],
    ] as const) {
      const output = outputs.find((item) => item.taskId === taskId && item.displayType === 'image');
      expect(output?.url).toBeTruthy();
      const response = await page.request.get(new URL(output!.url!, page.url()).toString());
      expect(response.ok()).toBe(true);
      await writeFile(`${evidenceRoot}/${filename}`, await response.body());
      savedAssets[taskId] = filename;
    }
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model: { repo, revision },
          clusterTaskId,
          userNodeTaskId,
          persistedBeforeRefresh,
          persistedAfterRefresh,
          collapsedExpandedGraphEquivalent: true,
          clusterForkBaseGraphEquivalent: true,
          retainedModifiedExecutionPath: retainedConnection,
          modifiedGraphDiffersFromClusterBase: true,
          userNodeRefreshEquivalent: true,
          internalNodes,
          outputs,
          savedAssets,
          qualificationOnly: true,
          showcaseApproved: false,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live equivalent Diffusers Cluster prepares its sealed standard executor through the frontend', async ({
  page,
}) => {
  const runHeavyGeneration = process.env.MODIFF_RUN_HEAVY_DIFFUSERS === '1';
  test.setTimeout((runHeavyGeneration ? 35 : 5) * 60 * 1000);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await page.evaluate(async () => {
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useNodesStore.getState().fetchOptionalRuntimes(),
    ]);
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
          const state = useNodesStore.getState();
          return [state.discoveryRequests.capabilities.status, state.discoveryRequests.optionalRuntimes.status];
        }),
      { timeout: 120_000 },
    )
    .toEqual(['success', 'success']);
  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 30_000 });
  await group.getByRole('button').first().click();
  await page.getByLabel('Search nodes').fill('Ernie Image');
  const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: 'Ernie Image' });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
  await row.click();

  const root = page.locator('[data-cluster-role="root"]').filter({ hasText: 'Ernie Image' });
  await expect(root).toBeVisible();
  await root.getByLabel('prompt', { exact: true }).fill('A tiny brass observatory under a clear night sky');
  if (runHeavyGeneration) {
    await page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const cluster = useFlowStore
        .getState()
        .nodes.find((candidate) => candidate.data.huggingFaceClusterRole === 'root');
      if (!cluster) throw new Error('ERNIE Cluster root is unavailable.');
      const flow = useFlowStore.getState();
      flow.setHuggingFaceClusterParameter(cluster.id, 'num_inference_steps', 1);
      flow.setHuggingFaceClusterParameter(cluster.id, 'width', 1024);
      flow.setHuggingFaceClusterParameter(cluster.id, 'height', 1024);
    });
    console.log(
      'Applied the one-step, contract-sized ERNIE qualification parameters through the frontend Cluster store.',
    );
  }
  await root.getByRole('button', { name: 'Prepare qualification run' }).click();
  await expect(root.getByRole('status')).toContainText(/Ready for a qualification run/u, { timeout: 120_000 });

  const execution = await page.evaluate(() => {
    const state = window.__MODIFF_E2E__!.getState();
    return state.flow.nodes
      .filter((node) => node.huggingFaceClusterRole === 'execution')
      .map((node) => ({
        role: node.huggingFaceClusterExecutionRole,
        module: node.module,
        action: node.action,
        disabled: node.uiState?.disabled,
        params: Object.fromEntries(Object.entries(node.params).map(([key, field]) => [key, field.value])),
      }));
  });
  expect(execution).toHaveLength(5);
  expect(execution.every((node) => node.disabled === false)).toBe(true);
  const loader = execution.find((node) => node.role === 'diffusersImagePipeline');
  expect(loader).toMatchObject({
    module: 'modules.DiffusersImage',
    action: 'LoadPipeline',
    params: {
      model_id: { source: 'hub', value: 'baidu/ERNIE-Image-Turbo' },
      pipeline_class: 'ErnieImagePipeline',
      execution_profile_id: 'ernie-image:equivalent-standard',
      mode: 'text_to_image',
      revision: 'bc68c81e2a1730a394d5fc9fae70713dee940140',
    },
  });
  expect(execution.find((node) => node.role === 'diffusersImageGenerate')?.params.prompt).toBe(
    'A tiny brass observatory under a clear night sky',
  );
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  if (outputDirectory) {
    await page.screenshot({
      path: `${outputDirectory}/diffusers-ernie-equivalent-cluster-prepared.png`,
      fullPage: true,
    });
  }
  if (!runHeavyGeneration) return;

  const runButton = page.getByTestId('studio-run');
  await expect(runButton).toBeEnabled({ timeout: 30_000 });
  console.log('The one-step ERNIE Cluster graph is prepared; submitting through the frontend Run button.');
  const submission = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await runButton.click();
  const response = await submission;
  expect(response.ok()).toBe(true);
  const submitted = (await response.json()) as { task_id?: string };
  expect(typeof submitted.task_id).toBe('string');
  const taskId = submitted.task_id!;
  console.log(`Submitted ERNIE Cluster qualification task ${taskId}.`);

  const terminal = await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const queue = (await (await fetch('/queue')).json()) as {
            current?: { task_id?: string; status?: string; message?: string } | null;
            queued?: Record<string, { task_id?: string; status?: string; message?: string }>;
            recent?: Array<{ task_id?: string; status?: string; message?: string }>;
          };
          return (
            (queue.current?.task_id === id ? queue.current : null) ??
            Object.values(queue.queued ?? {}).find((task) => task.task_id === id) ??
            queue.recent?.find((task) => task.task_id === id) ??
            null
          );
        }, taskId),
      { timeout: 30 * 60 * 1000, intervals: [1000, 2000, 5000] },
    )
    .toMatchObject({ task_id: taskId, status: 'completed' });
  void terminal;

  const output = await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const payload = (await (await fetch('/studio_outputs?limit=200')).json()) as {
            outputs?: Array<{
              taskId?: string | null;
              displayType?: string;
              backendImagePath?: string;
              mediaHash?: string;
              url?: string;
            }>;
          };
          return payload.outputs?.find((candidate) => candidate.taskId === id) ?? null;
        }, taskId),
      { timeout: 120_000, intervals: [500, 1000, 2000] },
    )
    .toMatchObject({ taskId, displayType: 'image' });
  void output;
  if (outputDirectory) {
    await page.screenshot({
      path: `${outputDirectory}/diffusers-ernie-equivalent-cluster-generated.png`,
      fullPage: true,
    });
  }
});

test('remaining cached equivalent Diffusers Clusters prepare exact video executors through the frontend', async ({
  page,
}) => {
  const heavyScenario =
    process.env.MODIFF_RUN_HEAVY_EQUIVALENT_VIDEO ??
    (process.env.MODIFF_RUN_HEAVY_LTX_VIDEO === '1' ? 'ltx_text_to_video' : '');
  test.setTimeout((heavyScenario ? 45 : 15) * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const sourceImage = [
    '@data/qualification/local-review/hugging-face-clusters/diffusers-ernie-equivalent-cluster-output.webp',
  ];
  const scenarios = [
    {
      label: 'LTX — Text To Video',
      modelType: 'LTXModularPipeline',
      mode: 'text_to_video',
      pipelineClass: 'LTXConditionPipeline',
      executionProfileId: 'ltx:equivalent-standard',
      repo: 'Lightricks/LTX-Video-0.9.8-13B-distilled',
      revision: '7c64400e1861cc0d7b98d570a1926d5408ec60cd',
    },
    {
      label: 'LTX — Image To Video',
      modelType: 'LTXModularPipeline',
      mode: 'image_to_video',
      pipelineClass: 'LTXConditionPipeline',
      executionProfileId: 'ltx:equivalent-standard',
      repo: 'Lightricks/LTX-Video-0.9.8-13B-distilled',
      revision: '7c64400e1861cc0d7b98d570a1926d5408ec60cd',
      image: sourceImage,
    },
    {
      label: 'Wan22 Image2 Video — Image To Video',
      modelType: 'Wan22Image2VideoModularPipeline',
      mode: 'image_to_video',
      pipelineClass: 'WanImageToVideoPipeline',
      executionProfileId: 'wan22-i2v:equivalent-standard',
      repo: 'Wan-AI/Wan2.2-I2V-A14B-Diffusers',
      revision: '596658fd9ca6b7b71d5057529bbf319ecbc61d74',
      image: sourceImage,
    },
  ] as const;
  const evidence: Array<Record<string, unknown>> = [];

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('equivalent-video-clusters-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('equivalent-video-clusters-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });
  await page.evaluate(async () => {
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useNodesStore.getState().fetchOptionalRuntimes(),
    ]);
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
          const state = useNodesStore.getState();
          return [state.discoveryRequests.capabilities.status, state.discoveryRequests.optionalRuntimes.status];
        }),
      { timeout: 120_000 },
    )
    .toEqual(['success', 'success']);
  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 30_000 });
  await group.getByRole('button').first().click();

  for (const scenario of scenarios) {
    const runHeavyScenario =
      heavyScenario ===
      (scenario.modelType === 'LTXModularPipeline'
        ? `ltx_${scenario.mode}`
        : scenario.modelType === 'Wan22Image2VideoModularPipeline'
          ? 'wan22_image_to_video'
          : '');
    await page.evaluate(async () => {
      const [{ useFlowStore }, { useHuggingFaceClusterRuntimeStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useHuggingFaceClusterRuntimeStore.ts'),
      ]);
      useFlowStore.setState({ nodes: [], edges: [] });
      useHuggingFaceClusterRuntimeStore.getState().clearAuthorities();
    });
    await page.getByLabel('Search nodes').fill(scenario.label);
    const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: scenario.label });
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
    await row.click();

    const root = page.locator('[data-cluster-role="root"]').filter({ hasText: scenario.label });
    await expect(root).toBeVisible();
    const prompt = `Frontend qualification proof for ${scenario.label}`;
    await root.getByLabel('prompt', { exact: true }).fill(prompt);
    if (runHeavyScenario && scenario.modelType === 'LTXModularPipeline') {
      await page.evaluate(async () => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const cluster = useFlowStore
          .getState()
          .nodes.find((candidate) => candidate.data.huggingFaceClusterRole === 'root');
        if (!cluster) throw new Error('LTX text-to-video Cluster root is unavailable.');
        const flow = useFlowStore.getState();
        flow.setHuggingFaceClusterParameter(cluster.id, 'width', 256);
        flow.setHuggingFaceClusterParameter(cluster.id, 'height', 256);
        flow.setHuggingFaceClusterParameter(cluster.id, 'num_frames', 9);
        flow.setHuggingFaceClusterParameter(cluster.id, 'num_inference_steps', 8);
        flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'guidanceScale', 1);
        flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'fps', 8);
      });
    }
    if (runHeavyScenario && scenario.modelType === 'Wan22Image2VideoModularPipeline') {
      await page.evaluate(async () => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const cluster = useFlowStore
          .getState()
          .nodes.find((candidate) => candidate.data.huggingFaceClusterRole === 'root');
        if (!cluster) throw new Error('Wan 2.2 image-to-video Cluster root is unavailable.');
        const flow = useFlowStore.getState();
        // This is a bounded route smoke proof, not a visual-quality recipe.
        // Keep the upstream-default 81-frame temporal contract while reducing
        // spatial size and denoising work on the qualification host.
        flow.setHuggingFaceClusterParameter(cluster.id, 'width', 256);
        flow.setHuggingFaceClusterParameter(cluster.id, 'height', 256);
        flow.setHuggingFaceClusterParameter(cluster.id, 'num_frames', 81);
        flow.setHuggingFaceClusterParameter(cluster.id, 'num_inference_steps', 2);
        flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'guidanceScale', 1);
        flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'guidanceScale2', 1);
        flow.setHuggingFaceClusterExecutionParameter(cluster.id, 'fps', 16);
      });
    }
    if ('image' in scenario) {
      await page.evaluate(
        async ({ image }) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          const cluster = useFlowStore
            .getState()
            .nodes.find((candidate) => candidate.data.huggingFaceClusterRole === 'root');
          if (!cluster) throw new Error('Equivalent Diffusers video Cluster root is unavailable.');
          useFlowStore.getState().setHuggingFaceClusterParameter(cluster.id, 'image', image);
        },
        { image: scenario.image },
      );
    }

    await root.getByRole('button', { name: 'Prepare qualification run' }).click();
    await expect(root.getByRole('status')).toContainText(/Ready for a qualification run/u, { timeout: 180_000 });
    const prepared = await page.evaluate(() => {
      const state = window.__MODIFF_E2E__!.getState();
      const rootNode = state.flow.nodes.find((node) => node.huggingFaceClusterRole === 'root');
      const execution = state.flow.nodes
        .filter((node) => node.huggingFaceClusterRole === 'execution')
        .map((node) => ({
          role: node.huggingFaceClusterExecutionRole,
          module: node.module,
          action: node.action,
          disabled: node.uiState?.disabled,
          params: Object.fromEntries(Object.entries(node.params).map(([key, field]) => [key, field.value])),
        }));
      return {
        definitionId: rootNode?.huggingFaceClusterInstance?.definition.id,
        instance: rootNode?.huggingFaceClusterInstance,
        execution,
      };
    });
    expect(prepared.execution).toHaveLength('image' in scenario ? 6 : 5);
    expect(prepared.execution.every((node) => node.disabled === false)).toBe(true);
    const loader = prepared.execution.find((node) => node.role === 'wanPipeline');
    expect(loader).toMatchObject({
      module: 'modules.DiffusersVideo',
      action: 'LoadPipeline',
      params: {
        model_id: { source: 'hub', value: scenario.repo },
        pipeline_class: scenario.pipelineClass,
        execution_profile_id: scenario.executionProfileId,
        revision: scenario.revision,
      },
    });
    expect(prepared.execution.find((node) => node.role === 'wanGenerate')?.params.prompt).toBe(prompt);
    expect(prepared.instance?.execution?.studioExecutionSpec.executionProfileId).toBe(scenario.executionProfileId);
    const scenarioEvidence: Record<string, unknown> = {
      label: scenario.label,
      modelType: scenario.modelType,
      mode: scenario.mode,
      definitionId: prepared.definitionId,
      loader,
      prompt,
      sourceImage: 'image' in scenario ? scenario.image : null,
      preparedThroughFrontend: true,
      publicExecutableUnchanged: true,
    };
    if (outputDirectory) {
      await page.screenshot({
        path: `${outputDirectory}/diffusers-${scenario.modelType.toLowerCase()}-${scenario.mode}-prepared.png`,
        fullPage: true,
      });
    }
    if (runHeavyScenario) {
      const runButton = page.getByTestId('studio-run');
      await expect(runButton).toBeEnabled({ timeout: 30_000 });
      const submission = page.waitForResponse(
        (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
        { timeout: 120_000 },
      );
      await runButton.click();
      const response = await submission;
      expect(response.ok()).toBe(true);
      const submitted = (await response.json()) as { task_id?: string };
      expect(typeof submitted.task_id).toBe('string');
      const taskId = submitted.task_id!;
      console.log(`Submitted ${scenario.label} equivalent Cluster qualification task ${taskId}.`);
      await expect
        .poll(
          () =>
            page.evaluate(async (id) => {
              const queue = (await (await fetch('/queue')).json()) as {
                current?: { task_id?: string; status?: string; message?: string } | null;
                queued?: Record<string, { task_id?: string; status?: string; message?: string }>;
                recent?: Array<{ task_id?: string; status?: string; message?: string }>;
              };
              return (
                (queue.current?.task_id === id ? queue.current : null) ??
                Object.values(queue.queued ?? {}).find((task) => task.task_id === id) ??
                queue.recent?.find((task) => task.task_id === id) ??
                null
              );
            }, taskId),
          { timeout: 35 * 60 * 1000, intervals: [1000, 2000, 5000] },
        )
        .toMatchObject({ task_id: taskId, status: 'completed' });
      await expect
        .poll(
          () =>
            page.evaluate(async (id) => {
              const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
                outputs?: Array<{
                  taskId?: string;
                  displayType?: string;
                  backendVideoPath?: string;
                  mediaHash?: string;
                  url?: string;
                }>;
              };
              return body.outputs?.find((item) => item.taskId === id) ?? null;
            }, taskId),
          { timeout: 120_000, intervals: [500, 1000, 2000] },
        )
        .toMatchObject({ taskId, displayType: 'video' });
      const generatedOutput = await page.evaluate(async (id) => {
        const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
          outputs?: Array<{
            taskId?: string;
            displayType?: string;
            backendVideoPath?: string;
            mediaHash?: string;
            url?: string;
          }>;
        };
        return body.outputs?.find((item) => item.taskId === id) ?? null;
      }, taskId);
      scenarioEvidence.generatedThroughFrontend = true;
      scenarioEvidence.taskId = taskId;
      scenarioEvidence.output = generatedOutput;
      if (outputDirectory) {
        await page.screenshot({
          path: `${outputDirectory}/diffusers-${scenario.modelType.toLowerCase()}-${scenario.mode}-generated.png`,
          fullPage: true,
        });
      }
    }
    evidence.push(scenarioEvidence);
  }

  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      `${outputDirectory}/diffusers-equivalent-video-clusters-preparation.json`,
      `${JSON.stringify({ schemaVersion: 1, scenarios: evidence }, null, 2)}\n`,
      'utf8',
    );
  }
});

test('live Qwen Image Edit Cluster preserves one executable graph across collapse and expansion', async ({ page }) => {
  const runHeavyGeneration = process.env.MODIFF_RUN_HEAVY_QWEN_EDIT === '1';
  test.setTimeout((runHeavyGeneration ? 40 : 6) * 60 * 1000);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });
  await page.evaluate(async () => {
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useNodesStore.getState().fetchOptionalRuntimes(),
    ]);
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
          const state = useNodesStore.getState();
          return [state.discoveryRequests.capabilities.status, state.discoveryRequests.optionalRuntimes.status];
        }),
      { timeout: 120_000 },
    )
    .toEqual(['success', 'success']);

  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 30_000 });
  await group.getByRole('button').first().click();
  await page.getByLabel('Search nodes').fill('Qwen Image Edit');
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image Edit — Edit Image' });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
  await row.click();

  const root = page.locator('[data-cluster-role="root"]').filter({ hasText: 'Qwen Image Edit — Edit Image' });
  await expect(root).toBeVisible();
  const prompt = 'Turn the brass observatory into a moonlit silver observatory';
  await root.getByLabel('prompt', { exact: true }).fill(prompt);
  await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const cluster = useFlowStore.getState().nodes.find((candidate) => candidate.data.huggingFaceClusterRole === 'root');
    if (!cluster) throw new Error('Qwen Image Edit Cluster root is unavailable.');
    const flow = useFlowStore.getState();
    flow.setHuggingFaceClusterParameter(cluster.id, 'image', [
      '@data/qualification/local-review/hugging-face-clusters/diffusers-ernie-equivalent-cluster-output.webp',
    ]);
    flow.setHuggingFaceClusterParameter(cluster.id, 'num_inference_steps', 2);
  });

  await root.getByRole('button', { name: 'Prepare qualification run' }).click();
  await expect(root.getByRole('status')).toContainText(/Ready for a qualification run/u, { timeout: 180_000 });

  const canonicalExport = () =>
    page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const graph = useFlowStore.getState().exportGraph('qwen-edit-equivalence');
      return { nodes: graph.nodes, paths: graph.paths, deterministicMode: graph.deterministicMode };
    });
  const collapsedGraph = await canonicalExport();
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  await expect(root.getByLabel('Collapse Diffusers Cluster Node')).toBeVisible();
  await expect(page.locator('[data-cluster-role="block"]')).not.toHaveCount(0);
  const expandedGraph = await canonicalExport();
  expect(expandedGraph).toEqual(collapsedGraph);
  await root.getByLabel('Collapse Diffusers Cluster Node').click();

  const execution = await page.evaluate(() =>
    window
      .__MODIFF_E2E__!.getState()
      .flow.nodes.filter((node) => node.huggingFaceClusterRole === 'execution')
      .map((node) => ({
        role: node.huggingFaceClusterExecutionRole,
        module: node.module,
        action: node.action,
        disabled: node.uiState?.disabled,
        params: Object.fromEntries(Object.entries(node.params).map(([key, field]) => [key, field.value])),
      })),
  );
  expect(execution.every((node) => node.disabled === false)).toBe(true);
  expect(execution.find((node) => node.role === 'models')).toMatchObject({
    module: 'modules.ModularDiffusers',
    action: 'ModelsLoader',
    params: {
      repo_id: { source: 'hub', value: 'Qwen/Qwen-Image-Edit' },
      model_type: 'QwenImageEditModularPipeline',
    },
  });
  expect(execution.find((node) => node.role === 'prompt')?.params.prompt).toBe(prompt);
  expect(execution.find((node) => node.role === 'loadImage')?.params.file).toEqual([
    '@data/qualification/local-review/hugging-face-clusters/diffusers-ernie-equivalent-cluster-output.webp',
  ]);

  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  if (outputDirectory) {
    await page.screenshot({
      path: `${outputDirectory}/diffusers-qwen-edit-cluster-prepared.png`,
      fullPage: true,
    });
  }
  if (!runHeavyGeneration) return;

  const runButton = page.getByTestId('studio-run');
  await expect(runButton).toBeEnabled({ timeout: 30_000 });
  const submission = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await runButton.click();
  const response = await submission;
  expect(response.ok()).toBe(true);
  const submitted = (await response.json()) as { task_id?: string };
  expect(typeof submitted.task_id).toBe('string');
  const taskId = submitted.task_id!;
  console.log(`Submitted Qwen Image Edit Cluster qualification task ${taskId}.`);

  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const queue = (await (await fetch('/queue')).json()) as {
            current?: { task_id?: string; status?: string } | null;
            queued?: Record<string, { task_id?: string; status?: string }>;
            recent?: Array<{ task_id?: string; status?: string }>;
          };
          return (
            (queue.current?.task_id === id ? queue.current : null) ??
            Object.values(queue.queued ?? {}).find((task) => task.task_id === id) ??
            queue.recent?.find((task) => task.task_id === id) ??
            null
          );
        }, taskId),
      { timeout: 35 * 60 * 1000, intervals: [1000, 2000, 5000] },
    )
    .toMatchObject({ task_id: taskId, status: 'completed' });

  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
            outputs?: Array<{ taskId?: string; displayType?: string; mediaItems?: unknown[] }>;
          };
          return body.outputs?.find((item) => item.taskId === id) ?? null;
        }, taskId),
      { timeout: 120_000, intervals: [500, 1000, 2000] },
    )
    .toMatchObject({ taskId, displayType: 'image' });
  if (outputDirectory) {
    await page.screenshot({
      path: `${outputDirectory}/diffusers-qwen-edit-cluster-generated.png`,
      fullPage: true,
    });
  }
});

test('live Whisper speech Clusters transcribe and translate an official speech fixture through the frontend', async ({
  page,
}) => {
  test.setTimeout(20 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const fixture =
    '@data/qualification/local-review/hugging-face-clusters/transformers-asr/librispeech-1272-128104-0008.wav';
  const scenarios = [
    { label: 'Whisper Tiny — Speech to Text', mode: 'speech_to_text', task: 'transcribe' },
    { label: 'Whisper Tiny — Speech Translation', mode: 'speech_translation', task: 'translate' },
  ] as const;
  const evidence: Array<Record<string, unknown>> = [];

  await page.addInitScript(() => {
    if (window.localStorage.getItem('whisper-cluster-live-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem('whisper-cluster-live-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await expect(autoToggle).toHaveAttribute('aria-checked', 'false');
  await page.evaluate(async () => {
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useNodesStore.getState().fetchOptionalRuntimes(),
    ]);
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
          const state = useNodesStore.getState();
          return [state.discoveryRequests.capabilities.status, state.discoveryRequests.optionalRuntimes.status];
        }),
      { timeout: 120_000 },
    )
    .toEqual(['success', 'success']);
  await page.evaluate(async () => {
    const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
    const current = useStudioStore.getState().form;
    useStudioStore.setState({
      form: {
        ...current,
        modelType: 'LTXModularPipeline',
        mode: 'text_to_video',
        dtype: 'bfloat16',
        autoOffload: true,
        offloadMode: 'model_cpu',
      },
    });
  });

  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Transformers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 30_000 });
  await group.getByRole('button').first().click();

  for (const scenario of scenarios) {
    await page.evaluate(async () => {
      const [{ useFlowStore }, { useHuggingFaceClusterRuntimeStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useHuggingFaceClusterRuntimeStore.ts'),
      ]);
      useFlowStore.setState({ nodes: [], edges: [] });
      useHuggingFaceClusterRuntimeStore.getState().clearAuthorities();
    });
    await page.getByLabel('Search nodes').fill(scenario.label);
    const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: scenario.label });
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
    await row.click();

    const root = page.locator('[data-cluster-role="root"]').filter({ hasText: scenario.label });
    await expect(root).toBeVisible();
    await page.evaluate(
      async ({ audio }) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const cluster = useFlowStore
          .getState()
          .nodes.find((candidate) => candidate.data.huggingFaceClusterRole === 'root');
        if (!cluster) throw new Error('Whisper Cluster root is unavailable.');
        const flow = useFlowStore.getState();
        flow.setHuggingFaceClusterParameter(cluster.id, 'audio', audio);
        flow.setHuggingFaceClusterParameter(cluster.id, 'language', 'English');
        flow.setHuggingFaceClusterParameter(cluster.id, 'timestamps', 'segment');
        flow.setHuggingFaceClusterParameter(cluster.id, 'chunk_length_seconds', 0);
        flow.setHuggingFaceClusterParameter(cluster.id, 'stride_length_seconds', 0);
      },
      { audio: fixture },
    );
    const isolatedDefaults = await page.evaluate(async () => {
      const [{ useFlowStore }, { useStudioStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useStudioStore.ts'),
      ]);
      const cluster = useFlowStore
        .getState()
        .nodes.find((candidate) => candidate.data.huggingFaceClusterRole === 'root');
      return {
        clusterDtype: cluster?.data.params.dtype?.value,
        globalModelType: useStudioStore.getState().form.modelType,
        globalOffloadMode: useStudioStore.getState().form.offloadMode,
      };
    });
    expect(isolatedDefaults).toEqual({
      clusterDtype: 'float32',
      globalModelType: 'LTXModularPipeline',
      globalOffloadMode: 'model_cpu',
    });

    const persistedBeforeRefresh = await page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const cluster = useFlowStore
        .getState()
        .nodes.find((candidate) => candidate.data.huggingFaceClusterRole === 'root');
      if (!cluster?.data.huggingFaceClusterInstance) throw new Error('Whisper Cluster instance is unavailable.');
      return {
        definition: cluster.data.huggingFaceClusterInstance.definition,
        parameterOverrides: cluster.data.huggingFaceClusterInstance.parameterOverrides,
        effective: Object.fromEntries(Object.entries(cluster.data.params).map(([key, field]) => [key, field.value])),
      };
    });
    expect(persistedBeforeRefresh.effective).toMatchObject({
      audio: fixture,
      language: 'English',
      timestamps: 'segment',
      chunk_length_seconds: 0,
      stride_length_seconds: 0,
      dtype: 'float32',
    });
    const needsSaveName = await page.evaluate(() => {
      const studio = window.__MODIFF_E2E__!.getState().studio;
      const tab = studio.workflowTabs.find((candidate: { id: string }) => candidate.id === studio.activeWorkflowTabId);
      return Boolean(tab?.source === 'new' && /^Workflow \d+$/u.test(tab.title));
    });
    await page.getByTestId('topbar-save-workflow').click();
    const saveDialog = page.getByTestId('save-workflow-dialog');
    if (needsSaveName) {
      await expect(saveDialog).toBeVisible();
      await page.getByTestId('save-workflow-name').fill(`Whisper ${scenario.mode} Cluster Proof`);
      await page.getByTestId('confirm-save-workflow').click();
      await expect(saveDialog).toHaveCount(0);
    }
    await expect(page.getByTestId('topbar-save-workflow')).toBeEnabled({ timeout: 120_000 });
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const studio = window.__MODIFF_E2E__!.getState().studio;
            if (!studio.activeWorkflowTabId) return null;
            const response = await fetch(`/workflows/${encodeURIComponent(studio.activeWorkflowTabId)}`);
            if (!response.ok) return null;
            const workflow = (await response.json()) as {
              snapshot?: {
                nodes?: Array<{
                  data?: {
                    huggingFaceClusterRole?: string;
                    huggingFaceClusterInstance?: {
                      definition?: unknown;
                      parameterOverrides?: unknown;
                    };
                    params?: Record<string, { value?: unknown }>;
                  };
                }>;
              };
            };
            const cluster = workflow.snapshot?.nodes?.find((node) => node.data?.huggingFaceClusterRole === 'root');
            if (!cluster?.data?.huggingFaceClusterInstance) return null;
            return {
              definition: cluster.data.huggingFaceClusterInstance.definition,
              parameterOverrides: cluster.data.huggingFaceClusterInstance.parameterOverrides,
              effective: Object.fromEntries(
                Object.entries(cluster.data.params ?? {}).map(([key, field]) => [key, field.value]),
              ),
            };
          }),
        { timeout: 120_000, intervals: [100, 250, 500, 1000] },
      )
      .toEqual(persistedBeforeRefresh);
    expect(await page.evaluate(() => window.localStorage.getItem('whisper-cluster-live-proof'))).toBe('initialized');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });
    await expect(root).toBeVisible();
    const persistedAfterRefresh = await page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const cluster = useFlowStore
        .getState()
        .nodes.find((candidate) => candidate.data.huggingFaceClusterRole === 'root');
      if (!cluster?.data.huggingFaceClusterInstance) throw new Error('Whisper Cluster instance was not restored.');
      return {
        definition: cluster.data.huggingFaceClusterInstance.definition,
        parameterOverrides: cluster.data.huggingFaceClusterInstance.parameterOverrides,
        effective: Object.fromEntries(Object.entries(cluster.data.params).map(([key, field]) => [key, field.value])),
      };
    });
    expect(persistedAfterRefresh).toEqual(persistedBeforeRefresh);

    await root.getByRole('button', { name: 'Prepare qualification run' }).click();
    await expect(root.getByRole('status')).toContainText(/Ready for a qualification run/u, { timeout: 180_000 });
    const canonicalExport = () =>
      page.evaluate(async () => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const graph = useFlowStore.getState().exportGraph('whisper-cluster-equivalence');
        return { nodes: graph.nodes, paths: graph.paths, deterministicMode: graph.deterministicMode };
      });
    const collapsedGraph = await canonicalExport();
    await root.getByLabel('Expand Transformers Cluster Node').click();
    await expect(root.getByLabel('Collapse Transformers Cluster Node')).toBeVisible();
    await expect(page.locator('[data-cluster-role="block"]')).toHaveCount(4);
    expect(await canonicalExport()).toEqual(collapsedGraph);
    await root.getByLabel('Collapse Transformers Cluster Node').click();

    const prepared = await page.evaluate(() =>
      window
        .__MODIFF_E2E__!.getState()
        .flow.nodes.filter((node) => node.huggingFaceClusterRole === 'execution')
        .map((node) => ({
          role: node.huggingFaceClusterExecutionRole,
          module: node.module,
          action: node.action,
          disabled: node.uiState?.disabled,
          params: Object.fromEntries(Object.entries(node.params).map(([key, field]) => [key, field.value])),
        })),
    );
    expect(prepared).toHaveLength(4);
    expect(prepared.every((node) => node.disabled === false)).toBe(true);
    expect(prepared.find((node) => node.role === 'speechModel')).toMatchObject({
      module: 'modules.HuggingFaceSpeech',
      action: 'LoadSpeechRecognitionModel',
      params: {
        model_id: { source: 'hub', value: 'openai/whisper-tiny' },
        revision: '169d4a4341b33bc18d8881c4b69c2e104e1cc0af',
      },
    });
    expect(prepared.find((node) => node.role === 'loadAudio')?.params.file).toBe(fixture);
    expect(prepared.find((node) => node.role === 'transcribeAudio')).toMatchObject({
      params: {
        task: scenario.task,
        language: 'English',
        timestamps: 'segment',
        chunk_length_seconds: 0,
        stride_length_seconds: 0,
      },
    });
    if (outputDirectory) {
      await page.screenshot({
        path: `${outputDirectory}/transformers-asr/whisper-${scenario.mode}-prepared.png`,
        fullPage: true,
      });
    }

    const runButton = page.getByTestId('studio-run');
    await expect(runButton).toBeEnabled({ timeout: 30_000 });
    const submission = page.waitForResponse(
      (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
      { timeout: 120_000 },
    );
    await runButton.click();
    const response = await submission;
    expect(response.ok()).toBe(true);
    const submitted = (await response.json()) as { task_id?: string };
    expect(typeof submitted.task_id).toBe('string');
    const taskId = submitted.task_id!;
    console.log(`Submitted ${scenario.label} qualification task ${taskId}.`);
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const queue = (await (await fetch('/queue')).json()) as {
              current?: { task_id?: string; status?: string } | null;
              queued?: Record<string, { task_id?: string; status?: string }>;
              recent?: Array<{ task_id?: string; status?: string }>;
            };
            return (
              (queue.current?.task_id === id ? queue.current : null) ??
              Object.values(queue.queued ?? {}).find((task) => task.task_id === id) ??
              queue.recent?.find((task) => task.task_id === id) ??
              null
            );
          }, taskId),
        { timeout: 10 * 60 * 1000, intervals: [500, 1000, 2000] },
      )
      .toMatchObject({ task_id: taskId, status: 'completed' });
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
              outputs?: Array<{ taskId?: string; displayType?: string }>;
            };
            return body.outputs?.find((item) => item.taskId === id) ?? null;
          }, taskId),
        { timeout: 120_000, intervals: [500, 1000, 2000] },
      )
      .toMatchObject({ taskId, displayType: 'text' });
    const generatedOutput = await page.evaluate(async (id) => {
      const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
        outputs?: Array<{
          taskId?: string;
          displayType?: string;
          value?: unknown[];
          mediaHash?: string;
          backendMediaPath?: string;
          runtimeFingerprint?: string;
        }>;
      };
      return body.outputs?.find((item) => item.taskId === id) ?? null;
    }, taskId);
    expect(generatedOutput).not.toBeNull();
    const rawTranscript = generatedOutput?.value?.[0];
    expect(typeof rawTranscript).toBe('string');
    const transcript = JSON.parse(rawTranscript as string) as {
      schemaVersion?: number;
      task?: string;
      text?: string;
      timestampMode?: string;
      durationSeconds?: number;
      segments?: unknown[];
    };
    expect(transcript).toMatchObject({
      schemaVersion: 1,
      task: scenario.task,
      timestampMode: 'segment',
    });
    expect(transcript.text?.toUpperCase()).toContain('ETCHINGS');
    expect(transcript.durationSeconds).toBeGreaterThan(0);
    expect(Array.isArray(transcript.segments)).toBe(true);
    evidence.push({
      label: scenario.label,
      mode: scenario.mode,
      task: scenario.task,
      fixture,
      taskId,
      persistedBeforeRefresh,
      persistedAfterRefresh,
      saveRefreshParametersEqual: true,
      collapsedExpandedApiGraphEqual: true,
      transcript,
      output: generatedOutput,
      publicExecutableUnchanged: true,
      publicLiveProofUnchanged: true,
    });
    if (outputDirectory) {
      await page.screenshot({
        path: `${outputDirectory}/transformers-asr/whisper-${scenario.mode}-generated.png`,
        fullPage: true,
      });
    }
  }

  if (outputDirectory) {
    await mkdir(`${outputDirectory}/transformers-asr`, { recursive: true });
    await writeFile(
      `${outputDirectory}/transformers-asr/whisper-cluster-frontend-results.json`,
      `${JSON.stringify({ schemaVersion: 1, status: 'pending_user_review', scenarios: evidence }, null, 2)}\n`,
      'utf8',
    );
  }
});

test('live Wav2Vec2 CTC Cluster installs through the frontend, survives refresh, and transcribes end to end', async ({
  page,
}) => {
  test.setTimeout(50 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const runtimeId = 'huggingface-transformers-main-96fe6dce-peft-0.20.0';
  const modelRepo = 'facebook/wav2vec2-base-960h';
  const revision = '22aad52d435eb6dbaf354bdad9b0da84ce7d6156';
  const files = [
    '.gitattributes',
    'README.md',
    'config.json',
    'feature_extractor_config.json',
    'model.safetensors',
    'preprocessor_config.json',
    'special_tokens_map.json',
    'tokenizer_config.json',
    'vocab.json',
  ];
  const fixture =
    '@data/qualification/local-review/hugging-face-clusters/transformers-asr/librispeech-1272-128104-0008.wav';

  if (outputDirectory) await mkdir(`${outputDirectory}/transformers-asr`, { recursive: true });
  await page.addInitScript(() => {
    if (window.localStorage.getItem('wav2vec2-ctc-live-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem('wav2vec2-ctc-live-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await expect(autoToggle).toHaveAttribute('aria-checked', 'false');
  await page.evaluate(async () => {
    const [{ useNodesStore }, { useSettingsStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useSettingsStore.ts'),
    ]);
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useNodesStore.getState().fetchOptionalRuntimes(),
      useNodesStore.getState().fetchHfCache(true),
      useNodesStore.getState().fetchModelCacheDiagnostics(true),
    ]);
    useSettingsStore.getState().setRightPanelOpen(true);
    useSettingsStore.getState().setRightPanelTab('setup');
  });

  const runtimeRow = page.getByTestId(`optional-runtime-${runtimeId}`);
  await expect(runtimeRow).toBeVisible({ timeout: 30_000 });
  const installRuntime = runtimeRow.getByRole('button', { name: /^(Install|Repair)$/u });
  if (await installRuntime.isVisible()) {
    if (outputDirectory) {
      await page.screenshot({
        path: `${outputDirectory}/transformers-asr/wav2vec2-runtime-before-install.png`,
        fullPage: true,
      });
    }
    const action = (await installRuntime.textContent())?.trim() || 'Install';
    await installRuntime.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/optional runtime/u);
    await dialog.getByRole('button', { name: action, exact: true }).click();
    await expect(runtimeRow.getByRole('button', { name: 'Activate', exact: true })).toBeVisible({
      timeout: 30 * 60 * 1000,
    });
  }
  const activateRuntime = runtimeRow.getByRole('button', { name: 'Activate', exact: true });
  if (await activateRuntime.isVisible()) {
    await activateRuntime.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/Activate validated/u);
    await dialog.getByRole('button', { name: 'Activate', exact: true }).click();
  }
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          try {
            const response = await fetch('/runtime/optional-runtimes');
            if (!response.ok) return 'unavailable';
            const catalog = (await response.json()) as {
              overlay?: { processLoadStatus?: string };
              profiles?: Array<{ id?: string; overlayStatus?: string }>;
            };
            const profile = catalog.profiles?.find((candidate) => candidate.id === id);
            return `${catalog.overlay?.processLoadStatus ?? 'unknown'}:${profile?.overlayStatus ?? 'unknown'}`;
          } catch {
            return 'unavailable';
          }
        }, runtimeId),
      { timeout: 5 * 60 * 1000, intervals: [1000, 2000, 5000] },
    )
    .toBe('active:active');
  await expect
    .poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().websocket.isConnected), {
      timeout: 120_000,
    })
    .toBe(true);
  if (outputDirectory) {
    await page.screenshot({
      path: `${outputDirectory}/transformers-asr/wav2vec2-runtime-active.png`,
      fullPage: true,
    });
  }

  await page.evaluate(async () => {
    const [{ useNodesStore }, { useSettingsStore }, { useStudioStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useSettingsStore.ts'),
      import('/src/stores/useStudioStore.ts'),
    ]);
    await useNodesStore.getState().refreshModelIndexes(true);
    const current = useStudioStore.getState().form;
    useStudioStore.setState({
      form: {
        ...current,
        modelType: 'HuggingFaceCTCSpeechRecognitionModel',
        mode: 'speech_to_text',
        resourceMode: 'expert',
        dtype: 'float32',
        device: 'cuda:0',
        autoOffload: false,
        offloadMode: 'none',
      },
    });
    useSettingsStore.getState().setRightPanelOpen(true);
    useSettingsStore.getState().setRightPanelTab('studio');
  });

  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Transformers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 30_000 });
  await group.getByRole('button').first().click();
  await page.getByLabel('Search nodes').fill('Wav2Vec2 Base 960h — Speech to Text');
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Wav2Vec2 Base 960h — Speech to Text' });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
  await row.click();

  const root = page.locator('[data-cluster-role="root"]').filter({ hasText: 'Wav2Vec2 Base 960h — Speech to Text' });
  await expect(root).toBeVisible();
  await page.evaluate(
    async ({ audio }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const cluster = useFlowStore
        .getState()
        .nodes.find((candidate) => candidate.data.huggingFaceClusterRole === 'root');
      if (!cluster) throw new Error('Wav2Vec2 CTC Cluster root is unavailable.');
      const flow = useFlowStore.getState();
      flow.setHuggingFaceClusterParameter(cluster.id, 'audio', audio);
      flow.setHuggingFaceClusterParameter(cluster.id, 'timestamps', 'word');
      flow.setHuggingFaceClusterParameter(cluster.id, 'chunk_length_seconds', 0);
      flow.setHuggingFaceClusterParameter(cluster.id, 'stride_length_seconds', 0);
    },
    { audio: fixture },
  );

  const installModel = page.getByTestId('studio-install-missing-model');
  if (await installModel.isVisible()) {
    await expect(installModel).toContainText('Install Wav2Vec2 Base 960h');
    if (outputDirectory) {
      await page.screenshot({
        path: `${outputDirectory}/transformers-asr/wav2vec2-model-before-install.png`,
        fullPage: true,
      });
    }
    const requestPromise = page.waitForRequest(
      (request) => request.url().endsWith('/hf_download') && request.method() === 'POST',
      { timeout: 120_000 },
    );
    await installModel.click();
    const request = await requestPromise;
    expect(request.postDataJSON()).toMatchObject({ repo_id: modelRepo, revision, files: [...files].sort() });
    await expect(installModel).toHaveCount(0, { timeout: 20 * 60 * 1000 });
  }
  const cacheReceipt = await page.evaluate(async (repo) => {
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    await useNodesStore.getState().refreshModelIndexes(true);
    return useNodesStore.getState().hfCache.find((item) => JSON.stringify(item).includes(repo)) ?? null;
  }, modelRepo);
  expect(cacheReceipt).not.toBeNull();

  const persistedBeforeRefresh = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const cluster = useFlowStore.getState().nodes.find((candidate) => candidate.data.huggingFaceClusterRole === 'root');
    return cluster
      ? {
          overrides: cluster.data.huggingFaceClusterInstance?.parameterOverrides ?? null,
          effective: Object.fromEntries(Object.entries(cluster.data.params).map(([key, field]) => [key, field.value])),
        }
      : null;
  });
  expect(persistedBeforeRefresh).toMatchObject({
    overrides: {
      audio: fixture,
      chunk_length_seconds: 0,
      stride_length_seconds: 0,
    },
    effective: {
      audio: fixture,
      timestamps: 'word',
      chunk_length_seconds: 0,
      stride_length_seconds: 0,
    },
  });
  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('Wav2Vec2 CTC Frontend Proof');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  const persistedBackendSnapshot = await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const studio = window.__MODIFF_E2E__!.getState().studio;
          const activeId = studio.activeWorkflowTabId;
          if (!activeId) return null;
          const response = await fetch(`/workflows/${encodeURIComponent(activeId)}`);
          if (!response.ok) return null;
          const workflow = (await response.json()) as {
            snapshot?: {
              nodes?: Array<{
                data?: { label?: string; params?: Record<string, { value?: unknown }> };
              }>;
            };
          };
          const cluster = workflow.snapshot?.nodes?.find((node) => node.data?.label?.startsWith('Wav2Vec2'));
          if (!cluster) return null;
          return Object.fromEntries(
            Object.entries(cluster.data?.params ?? {}).map(([key, field]) => [key, field.value]),
          );
        }),
      { timeout: 120_000, intervals: [250, 500, 1000, 2000] },
    )
    .toMatchObject({
      audio: fixture,
      timestamps: 'word',
      chunk_length_seconds: 0,
      stride_length_seconds: 0,
    });
  void persistedBackendSnapshot;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });
  const persistedAfterRefresh = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const cluster = useFlowStore.getState().nodes.find((candidate) => candidate.data.huggingFaceClusterRole === 'root');
    return cluster
      ? {
          overrides: cluster.data.huggingFaceClusterInstance?.parameterOverrides ?? null,
          effective: Object.fromEntries(Object.entries(cluster.data.params).map(([key, field]) => [key, field.value])),
        }
      : null;
  });
  expect(persistedAfterRefresh).toEqual(persistedBeforeRefresh);

  const clearFinishedNotifications = page.getByTitle('Clear finished notifications');
  if (await clearFinishedNotifications.isVisible()) {
    await clearFinishedNotifications.click();
  }
  await root.getByRole('button', { name: 'Prepare qualification run' }).click();
  await expect(root.getByRole('status')).toContainText(/Ready for a qualification run/u, { timeout: 180_000 });
  const canonicalExport = () =>
    page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const graph = useFlowStore.getState().exportGraph('wav2vec2-ctc-cluster-equivalence');
      return { nodes: graph.nodes, paths: graph.paths, deterministicMode: graph.deterministicMode };
    });
  const collapsedGraph = await canonicalExport();
  await root.getByLabel('Expand Transformers Cluster Node').click();
  await expect(root.getByLabel('Collapse Transformers Cluster Node')).toBeVisible();
  await expect(page.locator('[data-cluster-role="block"]')).toHaveCount(4);
  expect(await canonicalExport()).toEqual(collapsedGraph);
  await root.getByLabel('Collapse Transformers Cluster Node').click();

  const prepared = await page.evaluate(() =>
    window
      .__MODIFF_E2E__!.getState()
      .flow.nodes.filter((node) => node.huggingFaceClusterRole === 'execution')
      .map((node) => ({
        role: node.huggingFaceClusterExecutionRole,
        module: node.module,
        action: node.action,
        disabled: node.uiState?.disabled,
        params: Object.fromEntries(Object.entries(node.params).map(([key, field]) => [key, field.value])),
      })),
  );
  expect(prepared).toHaveLength(4);
  expect(prepared.every((node) => node.disabled === false)).toBe(true);
  expect(prepared.find((node) => node.role === 'speechModel')).toMatchObject({
    module: 'modules.HuggingFaceSpeech',
    action: 'LoadCTCSpeechRecognitionModel',
    params: {
      model_id: { source: 'hub', value: modelRepo },
      revision,
      pipeline_class: 'AutoModelForCTC',
      execution_profile_id: 'wav2vec2-base-960h:ctc-direct',
      dtype: 'float32',
      device: 'cuda:0',
    },
  });
  const transcribe = prepared.find((node) => node.role === 'transcribeAudio');
  expect(transcribe).toMatchObject({
    module: 'modules.HuggingFaceSpeech',
    action: 'TranscribeCTCAudio',
    params: { timestamps: 'word', chunk_length_seconds: 0, stride_length_seconds: 0 },
  });
  expect(transcribe?.params).not.toHaveProperty('task');
  expect(transcribe?.params).not.toHaveProperty('language');
  const publication = await page.evaluate(async () => {
    const library = (await (await fetch('/huggingface/node-library')).json()) as {
      definitions?: Array<{
        label?: string;
        executionAdmissions?: Array<{
          executable?: boolean;
          publication?: { autoEligible?: boolean; executable?: boolean; liveProof?: boolean };
        }>;
      }>;
    };
    return library.definitions?.find((definition) => definition.label?.startsWith('Wav2Vec2'))
      ?.executionAdmissions?.[0];
  });
  expect(publication).toMatchObject({
    executable: false,
    publication: { autoEligible: false, executable: false, liveProof: false },
  });
  if (outputDirectory) {
    await page.screenshot({
      path: `${outputDirectory}/transformers-asr/wav2vec2-ctc-cluster-prepared.png`,
      fullPage: true,
    });
  }

  const runButton = page.getByTestId('studio-run');
  await expect(runButton).toBeEnabled({ timeout: 30_000 });
  const submission = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await runButton.click();
  const response = await submission;
  expect(response.ok()).toBe(true);
  const submitted = (await response.json()) as { task_id?: string };
  expect(typeof submitted.task_id).toBe('string');
  const taskId = submitted.task_id!;
  console.log(`Submitted Wav2Vec2 CTC Cluster qualification task ${taskId}.`);
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const queue = (await (await fetch('/queue')).json()) as {
            current?: { task_id?: string; status?: string } | null;
            queued?: Record<string, { task_id?: string; status?: string }>;
            recent?: Array<{ task_id?: string; status?: string }>;
          };
          return (
            (queue.current?.task_id === id ? queue.current : null) ??
            Object.values(queue.queued ?? {}).find((task) => task.task_id === id) ??
            queue.recent?.find((task) => task.task_id === id) ??
            null
          );
        }, taskId),
      { timeout: 10 * 60 * 1000, intervals: [500, 1000, 2000] },
    )
    .toMatchObject({ task_id: taskId, status: 'completed' });
  const generatedOutput = await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
            outputs?: Array<{
              taskId?: string;
              displayType?: string;
              value?: unknown[];
              mediaHash?: string;
              runtimeFingerprint?: string;
            }>;
          };
          return body.outputs?.find((item) => item.taskId === id) ?? null;
        }, taskId),
      { timeout: 120_000, intervals: [500, 1000, 2000] },
    )
    .toMatchObject({ taskId, displayType: 'text' });
  void generatedOutput;
  const output = await page.evaluate(async (id) => {
    const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
      outputs?: Array<{
        taskId?: string;
        displayType?: string;
        value?: unknown[];
        mediaHash?: string;
        runtimeFingerprint?: string;
      }>;
    };
    return body.outputs?.find((item) => item.taskId === id) ?? null;
  }, taskId);
  expect(output).not.toBeNull();
  const rawTranscript = output?.value?.[0];
  expect(typeof rawTranscript).toBe('string');
  const transcript = JSON.parse(rawTranscript as string) as {
    schemaVersion?: number;
    task?: string;
    text?: string;
    timestampMode?: string;
    durationSeconds?: number;
    segments?: unknown[];
  };
  expect(transcript).toMatchObject({ schemaVersion: 1, task: 'transcribe', timestampMode: 'word' });
  expect(transcript.text?.toUpperCase()).toContain('ETCHINGS');
  expect(transcript.durationSeconds).toBeGreaterThan(0);
  expect(Array.isArray(transcript.segments)).toBe(true);
  if (outputDirectory) {
    await page.screenshot({
      path: `${outputDirectory}/transformers-asr/wav2vec2-ctc-cluster-generated.png`,
      fullPage: true,
    });
    await writeFile(
      `${outputDirectory}/transformers-asr/wav2vec2-ctc-cluster-frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          status: 'pending_user_review',
          runtimeInstalledAndActivatedThroughFrontend: true,
          modelInstalledThroughFrontend: true,
          exactInstall: { repo: modelRepo, revision, files },
          fixture,
          taskId,
          savedAndRefreshedParameterOverridesEqual: true,
          collapsedExpandedApiGraphEqual: true,
          transcript,
          output,
          publicExecutableUnchanged: true,
          publicAutoEligibleUnchanged: true,
          publicLiveProofUnchanged: true,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live backend Graph Fix clears the exact issue and enables Run', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().websocket.isConnected), {
      timeout: 30_000,
    })
    .toBe(true);

  await page.evaluate(() => window.__MODIFF_E2E__!.setGraphScenarioForTest('disconnected_image_output'));
  const before = await page.evaluate(() => window.__MODIFF_E2E__!.getState().flow);
  expect(before.nodes.map((node) => node.id).sort()).toEqual(['scenario-image-load', 'scenario-preview']);

  await expect(page.getByTestId('studio-run')).toBeDisabled();
  await page.getByTestId('graph-fix').click();
  const dialog = page.getByTestId('graph-fix-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/Connect Load Image|Connect.*image/i);
  await dialog.getByTestId('graph-fix-apply').click();
  await expect(dialog).toHaveCount(0);

  const after = await page.evaluate(() => window.__MODIFF_E2E__!.getState().flow);
  expect(after.nodes).toHaveLength(before.nodes.length);
  expect(after.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: 'scenario-image-load',
        sourceHandle: 'image',
        target: 'scenario-preview',
        targetHandle: 'image',
      }),
    ]),
  );
  expect(after.historyPast).toBe(before.historyPast + 1);
  await expect(page.getByRole('status').filter({ hasText: 'Fix applied and verified' })).toBeVisible();
  await expect(page.getByTestId('studio-run')).toBeEnabled();
});

test('a live recent-run notification restores its exact backend workflow without exhausting browser storage', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });

  const recent = await page.evaluate(async () => {
    const response = await fetch('/queue');
    const payload = (await response.json()) as {
      recent?: Array<Record<string, unknown> & { task_id?: string; workflow_tab_id?: string }>;
    };
    const run = payload.recent?.find(
      (candidate) => typeof candidate.task_id === 'string' && typeof candidate.workflow_tab_id === 'string',
    );
    if (!run) return null;
    const { useTaskStore } = await import('../../../src/stores/useTaskStore.ts');
    useTaskStore.setState({ sessionRuns: [] });
    useTaskStore.getState().setTasks(undefined, {}, [
      {
        ...run,
        status: 'running',
        completed_at: undefined,
        completedAtMs: undefined,
      },
    ]);
    return { taskId: run.task_id!, workflowTabId: run.workflow_tab_id! };
  });
  test.skip(!recent, 'The live backend has no recent workflow-owned run to restore.');

  await page.getByTestId(`session-run-${recent!.taskId}`).click();
  await expect
    .poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().studio.activeWorkflowTabId), {
      timeout: 30_000,
    })
    .toBe(recent!.workflowTabId);
  await expect.poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().settings.rightPanelTab)).toBe('studio');

  const checkpointBytes = await page.evaluate(() => localStorage.getItem('modiff.studio')?.length ?? 0);
  expect(checkpointBytes).toBeLessThan(2_000_000);
  expect(pageErrors.filter((message) => /QuotaExceededError|Could not open run/i.test(message))).toEqual([]);
});

test('live Model Manager explicitly evicts completed-proof and deferred local model copies', async ({ page }) => {
  test.skip(process.env.MODIFF_ALLOW_CACHE_EVICTION !== '1', 'Destructive cache eviction requires explicit opt-in.');
  test.setTimeout(20 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const requestedTargets = (process.env.MODIFF_CACHE_EVICTION_TARGETS ?? '')
    .split(',')
    .map((repo) => repo.trim())
    .filter(Boolean);
  const targets = requestedTargets.length
    ? requestedTargets
    : [
        'Wan-AI/Wan2.2-I2V-A14B-Diffusers',
        'Lightricks/LTX-Video-0.9.8-13B-distilled',
        'baidu/ERNIE-Image-Turbo',
        'deepseek-community/Janus-Pro-1B',
        'HuggingFaceTB/SmolLM2-135M-Instruct',
        'HuggingFaceTB/SmolVLM-256M-Instruct',
      ];

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().websocket.isConnected), {
      timeout: 30_000,
    })
    .toBe(true);

  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await expect(autoToggle).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('topbar-models').click();
  const dialog = page.getByTestId('model-manager-dialog');
  await expect(dialog).toBeVisible();
  await dialog
    .getByTestId('model-manager-diagnostics')
    .getByRole('button', { name: /Diagnostics/ })
    .click();

  const cacheBefore = await page.evaluate(async () => {
    const response = await fetch('/hf_cache?refresh=true');
    return (await response.json()) as Array<{ id: string; size: number }>;
  });
  const beforeByRepo = Object.fromEntries(cacheBefore.map((model) => [model.id, model.size]));
  expect(targets.every((repo) => Number(beforeByRepo[repo]) > 0)).toBe(true);
  const deletionReceipts: Array<Record<string, unknown>> = [];
  page.on('response', async (response) => {
    if (response.request().method() !== 'DELETE' || !/\/hf_cache\/[0-9a-f]{40}$/.test(response.url())) return;
    try {
      const payload = (await response.json()) as Record<string, unknown>;
      deletionReceipts.push(payload);
    } catch {
      // The assertions below surface a missing or malformed receipt.
    }
  });
  const search = dialog.getByRole('searchbox', { name: 'Filter models and artifacts' });
  if (outputDirectory) await mkdir(`${outputDirectory}/storage-turnover`, { recursive: true });

  for (const [index, repo] of targets.entries()) {
    await search.fill(repo);
    const deleteButton = dialog.getByRole('button', { name: `Delete ${repo}`, exact: true });
    await expect(deleteButton).toBeVisible({ timeout: 120_000 });
    await deleteButton.click();
    const confirmationTitle = page.getByText(/^(?:Free local model storage\?|Confirm safe model deletion)$/u);
    await expect(confirmationTitle).toHaveCount(1, { timeout: 120_000 });
    const confirmation = confirmationTitle.locator('xpath=ancestor::*[@role="dialog"][1]');
    await expect(confirmation).toContainText(
      /(?:will be kept|canonical workflow dependenc(?:y|ies).+turnover-complete)/u,
    );
    await expect(confirmation).toContainText(/(?:download this exact model revision|cannot be undone)/u);
    if (outputDirectory && index === 0) {
      await page.screenshot({
        path: `${outputDirectory}/storage-turnover/model-manager-eviction-confirmation.png`,
        fullPage: true,
      });
    }
    await confirmation
      .locator('button')
      .filter({ hasText: /^(?:Evict local copy|Delete exact revision)$/u })
      .click({ force: true });
    await expect(deleteButton).toHaveCount(0, { timeout: 300_000 });
  }

  const cacheAfter = await page.evaluate(async () => {
    const response = await fetch('/hf_cache?refresh=true');
    return (await response.json()) as Array<{ id: string; size: number }>;
  });
  const remaining = new Set(cacheAfter.map((model) => model.id));
  expect(targets.filter((repo) => remaining.has(repo))).toEqual([]);
  expect(deletionReceipts).toHaveLength(targets.length);
  for (const receipt of deletionReceipts) {
    expect(receipt.deleted).toBe(true);
    expect(receipt.runtimeRelease).toMatchObject({ errors: [], released: expect.any(Object) });
  }
  const reclaimedBytes = targets.reduce((total, repo) => total + Number(beforeByRepo[repo] ?? 0), 0);
  await search.fill('');
  if (outputDirectory) {
    await page.screenshot({
      path: `${outputDirectory}/storage-turnover/model-manager-after-eviction.png`,
      fullPage: true,
    });
    await writeFile(
      `${outputDirectory}/storage-turnover/model-manager-eviction-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          targets: targets.map((repo) => ({ repo, sizeBytes: beforeByRepo[repo] })),
          reclaimedBytes,
          savedWorkflowsPreserved: true,
          canonicalDefinitionsPreserved: true,
          frontendConfirmationProven: true,
          runtimeReleaseReceipts: deletionReceipts.map((receipt) => receipt.runtimeRelease),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});
