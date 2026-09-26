import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const RUNTIME_ID = 'huggingface-transformers-main-96fe6dce-peft-0.20.0';
const QUALIFY_BASE = process.env.MODIFF_RUN_FLUX2_KLEIN_BASE_CLUSTERS === '1';
const SHOWCASE_BASE = process.env.MODIFF_FLUX2_KLEIN_BASE_SHOWCASE === '1';
const MODEL = QUALIFY_BASE
  ? {
      repo: 'black-forest-labs/FLUX.2-klein-base-4B',
      revision: 'a3b4f4849157f664bdbc776fd7453c2783562f4d',
      modelType: 'Flux2KleinBaseModularPipeline',
      label: 'Flux2 Klein Base',
      folder: SHOWCASE_BASE ? 'flux2-klein-base-showcase' : 'flux2-klein-base-clusters',
      guidanceScale: 4,
    }
  : {
      repo: 'black-forest-labs/FLUX.2-klein-4B',
      revision: 'e7b7dc27f91deacad38e78976d1f2b499d76a294',
      modelType: 'Flux2KleinModularPipeline',
      label: 'Flux2 Klein',
      folder: 'flux2-klein-clusters',
      guidanceScale: 1,
    };
const RUN = SHOWCASE_BASE
  ? {
      width: 768,
      height: 768,
      steps: 24,
      textPrompt:
        'Cinematic editorial photograph of a tiny glass observatory on a windswept alpine ridge at blue hour, warm amber light glowing inside, intricate brass telescope visible through crystal walls, dramatic clouds, distant snow peaks, natural atmospheric depth, physically realistic materials, precise reflections, elegant composition, premium travel magazine cover, no text.',
      editPrompt:
        'Transform the scene from blue hour into a clear moonlit night while preserving the exact observatory design and composition. Add a vivid Milky Way, subtle cool moonlight on the snow, warmer interior glow, realistic glass reflections, and refined cinematic color grading. No text.',
    }
  : {
      width: 256,
      height: 256,
      steps: 2,
      textPrompt: 'Technical FLUX.2 Cluster proof: a red cube on a neutral gray tabletop.',
      editPrompt: 'Technical edit proof: turn the cube into translucent green glass.',
    };

type StudioOutput = {
  taskId?: string;
  displayType?: string;
  mediaHash?: string;
  url?: string;
  mediaItems?: Array<{ backendPath?: string; mediaHash?: string; url?: string }>;
};

async function waitForWorkspaceStartup(page: Page, timeout = 300_000) {
  const deadline = Date.now() + timeout;
  const gate = page.getByTestId('startup-workspace-gate');
  let lastMessage = '';
  while (Date.now() < deadline) {
    if ((await gate.count()) === 0) return;
    lastMessage = (await gate.textContent({ timeout: 250 }).catch(() => null))?.trim() || lastMessage;
    const retry = gate.getByRole('button', { name: 'Retry' });
    if (await retry.isVisible({ timeout: 250 }).catch(() => false)) await retry.click();
    await page.waitForTimeout(500);
  }
  throw new Error(`Workspace startup did not recover within ${timeout}ms. Last gate: ${lastMessage}`);
}

async function ensureOptionalRuntime(page: Page) {
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

  const runtimeRow = page.getByTestId(`optional-runtime-${RUNTIME_ID}`);
  await expect(runtimeRow).toBeVisible({ timeout: 30_000 });
  const install = runtimeRow.getByRole('button', { name: /^(Install|Repair)$/u });
  if (await install.isVisible()) {
    const action = (await install.textContent())?.trim() || 'Install';
    await install.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/optional runtime/u);
    await dialog.getByRole('button', { name: action, exact: true }).click();
    await expect(runtimeRow.getByRole('button', { name: 'Activate', exact: true })).toBeVisible({
      timeout: 30 * 60 * 1000,
    });
  }
  const activate = runtimeRow.getByRole('button', { name: 'Activate', exact: true });
  if (await activate.isVisible()) {
    await activate.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/Activate validated/u);
    await dialog.getByRole('button', { name: 'Activate', exact: true }).click();
  }
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
          await useNodesStore.getState().fetchOptionalRuntimes();
          const catalog = useNodesStore.getState().optionalRuntimeCatalog;
          const profile = catalog?.profiles.find((candidate) => candidate.id === id);
          return `${catalog?.processLoadStatus ?? 'unknown'}:${profile?.overlayStatus ?? 'unknown'}`;
        }, RUNTIME_ID),
      { timeout: 5 * 60 * 1000, intervals: [1000, 2000, 5000] },
    )
    .toBe('active:active');
}

async function ensureModelInstalledThroughFrontend(page: Page, evidenceRoot: string | null) {
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
  }, MODEL.modelType);
  expect(capability).toMatchObject({ defaultRepo: MODEL.repo });
  expect(capability?.revisionCandidates).toContain(MODEL.revision);
  expect(capability?.downloadFiles).toHaveLength(21);

  await page.getByTestId('topbar-models').click();
  const manager = page.getByTestId('model-manager-dialog');
  await expect(manager).toBeVisible();
  const managerRow = manager.locator(
    `[data-testid="model-manager-supported-${MODEL.modelType}"][data-model-repo="${MODEL.repo}"]`,
  );
  await expect(managerRow).toBeVisible({ timeout: 60_000 });
  const install = managerRow.getByTestId(`model-manager-install-${MODEL.modelType}`);
  if ((await install.textContent())?.trim() !== 'Ready') {
    const requestPromise = page.waitForRequest(
      (request) => request.url().endsWith('/hf_download') && request.method() === 'POST',
      { timeout: 120_000 },
    );
    await install.click();
    const request = await requestPromise;
    expect(request.postDataJSON()).toMatchObject({
      repo_id: MODEL.repo,
      revision: MODEL.revision,
      files: capability!.downloadFiles,
    });
    if (evidenceRoot) await page.screenshot({ path: `${evidenceRoot}/frontend-download-started.png`, fullPage: true });
    await expect(install).toHaveText('Ready', { timeout: 4 * 60 * 60 * 1000 });
  }
  if (evidenceRoot) await page.screenshot({ path: `${evidenceRoot}/frontend-model-ready.png`, fullPage: true });
  await manager.getByTestId('model-manager-close').click();
  await page.evaluate(async () => {
    const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
    ]);
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useNodesStore.getState().refreshModelIndexes(true),
      useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
    ]);
  });
}

async function insertCluster(page: Page, label: string) {
  const advancedWorkflow = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advancedWorkflow.isVisible({ timeout: 1000 }).catch(() => false)) await advancedWorkflow.click();
  const nodeSearch = page.getByLabel('Search nodes');
  if (!(await nodeSearch.isVisible({ timeout: 1000 }).catch(() => false))) {
    await page.getByTestId('left-tab-nodes').click();
  }
  await expect(nodeSearch).toBeVisible({ timeout: 30_000 });
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 30_000 });
  const disclosure = group.getByRole('button').first();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  await nodeSearch.fill(label);
  const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: label });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
  await row.click();
  const root = page.locator('[data-cluster-role="root"]').filter({ hasText: label });
  await expect(root).toBeVisible();
  return root;
}

async function setClusterInputs(page: Page, prompt: string, image: string | null, seed: number) {
  await page.evaluate(
    async ({ promptValue, imageValue, seedValue, guidanceValue, widthValue, heightValue, stepsValue }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      const root = flow.nodes.find((node) => node.data.huggingFaceClusterRole === 'root');
      if (!root) throw new Error('FLUX.2 Klein Cluster root is unavailable.');
      flow.setHuggingFaceClusterParameter(root.id, 'prompt', promptValue);
      flow.setHuggingFaceClusterParameter(root.id, 'width', widthValue);
      flow.setHuggingFaceClusterParameter(root.id, 'height', heightValue);
      flow.setHuggingFaceClusterParameter(root.id, 'num_inference_steps', stepsValue);
      if (imageValue) flow.setHuggingFaceClusterParameter(root.id, 'image', [imageValue]);
      flow.setHuggingFaceClusterExecutionParameter(root.id, 'guidanceScale', guidanceValue);
      flow.setHuggingFaceClusterExecutionParameter(root.id, 'seed', seedValue);
      flow.setHuggingFaceClusterExecutionParameter(root.id, 'dtype', 'bfloat16');
      flow.setHuggingFaceClusterExecutionParameter(root.id, 'autoOffload', true);
      flow.setHuggingFaceClusterExecutionParameter(root.id, 'offloadMode', 'model_cpu');
    },
    {
      promptValue: prompt,
      imageValue: image,
      seedValue: seed,
      guidanceValue: MODEL.guidanceScale,
      widthValue: RUN.width,
      heightValue: RUN.height,
      stepsValue: RUN.steps,
    },
  );
}

async function clusterSnapshot(page: Page) {
  return page.evaluate(async () => {
    const [{ useFlowStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
      import('/src/stores/useFlowStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
    ]);
    const flow = useFlowStore.getState();
    const root = flow.nodes.find((node) => node.data.huggingFaceClusterRole === 'root');
    if (!root) return null;
    const definition = useHuggingFaceNodeLibraryStore
      .getState()
      .library?.definitions.find((candidate) => candidate.id === root.data.huggingFaceClusterInstance?.definition.id);
    const graph = flow.exportGraph('flux2-klein-cluster-qualification');
    return {
      definitionId: root.data.huggingFaceClusterInstance?.definition.id,
      workflowId: root.data.huggingFaceClusterInstance?.definition.workflowId,
      overrides: root.data.huggingFaceClusterInstance?.parameterOverrides,
      executionOverrides: root.data.huggingFaceClusterInstance?.execution?.parameterOverrides,
      effective: Object.fromEntries(Object.entries(root.data.params).map(([key, field]) => [key, field.value])),
      blockPlacementCount: definition?.blockPlacements.length,
      graph: { nodes: graph.nodes, paths: graph.paths, deterministicMode: graph.deterministicMode },
    };
  });
}

async function saveRefreshAndProveExpansion(
  page: Page,
  root: Locator,
  workflowName: string,
  expectedBlockPlacements: number,
) {
  const before = await clusterSnapshot(page);
  expect(before?.effective).toMatchObject({
    width: RUN.width,
    height: RUN.height,
    num_inference_steps: RUN.steps,
  });
  expect(before?.blockPlacementCount).toBe(expectedBlockPlacements);

  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill(workflowName);
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await expect(root).toBeVisible();
  const after = await clusterSnapshot(page);
  expect(after).toEqual(before);

  const collapsed = after!.graph;
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  await expect(page.locator('[data-cluster-role="block"]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window
            .__MODIFF_E2E__!.getState()
            .flow.nodes.filter((node) => node.huggingFaceClusterRole === 'execution' && node.hidden !== true).length,
      ),
    )
    .toBeGreaterThan(0);
  await expect(page.locator('.react-flow__edge').first()).toBeVisible();
  expect((await clusterSnapshot(page))!.graph).toEqual(collapsed);
  await root.getByLabel('Collapse Diffusers Cluster Node').click();
  expect((await clusterSnapshot(page))!.graph).toEqual(collapsed);
  return { before, after };
}

async function prepareAndRun(page: Page, root: Locator) {
  if (SHOWCASE_BASE) {
    await root.getByRole('button', { name: 'Prepare qualification run' }).click();
  } else {
    await page.evaluate(async () => {
      const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
      useNodesStore.setState({ studioModelCapabilities: [], studioModelCapabilitiesAuthoritative: false });
    });
    const capabilityRefresh = page.waitForResponse(
      (response) => response.url().endsWith('/model_capabilities') && response.request().method() === 'GET',
      { timeout: 120_000 },
    );
    await root.getByRole('button', { name: 'Prepare qualification run' }).click();
    expect((await capabilityRefresh).ok()).toBe(true);
  }
  await expect(root.getByRole('status')).toContainText(/Ready for a qualification run/u, { timeout: 300_000 });
  const preparedCollapsed = await clusterSnapshot(page);
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  expect((await clusterSnapshot(page))!.graph).toEqual(preparedCollapsed!.graph);
  await root.getByLabel('Collapse Diffusers Cluster Node').click();

  const prepared = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore
      .getState()
      .nodes.filter((node) => node.data.huggingFaceClusterRole === 'execution')
      .map((node) => ({
        role: node.data.huggingFaceClusterExecutionRole,
        module: node.data.module,
        action: node.data.action,
        disabled: Boolean(node.data.uiState?.disabled),
        values: Object.fromEntries(Object.entries(node.data.params).map(([key, field]) => [key, field.value])),
      }));
  });
  expect(prepared.every((node) => !node.disabled)).toBe(true);
  expect(prepared.find((node) => node.role === 'models')).toMatchObject({
    module: 'modules.ModularDiffusers',
    action: 'ModelsLoader',
    values: {
      model_type: MODEL.modelType,
      repo_id: { source: 'hub', value: MODEL.repo },
      revision: MODEL.revision,
    },
  });

  const submission = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByTestId('studio-run').click();
  const usageTerms = page.getByTestId('model-usage-terms-dialog');
  if (await usageTerms.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByTestId('model-usage-terms-confirm').click();
  }
  const response = await submission;
  expect(response.ok()).toBe(true);
  const taskId = ((await response.json()) as { task_id?: string }).task_id;
  expect(taskId).toBeTruthy();
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
      { timeout: 45 * 60 * 1000, intervals: [1000, 2000, 5000] },
    )
    .toMatchObject({ task_id: taskId, status: 'completed' });
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
            outputs?: StudioOutput[];
          };
          return body.outputs?.find((item) => item.taskId === id && item.displayType === 'image') ?? null;
        }, taskId),
      { timeout: 120_000, intervals: [500, 1000, 2000] },
    )
    .toMatchObject({ taskId, displayType: 'image' });
  const output = await page.evaluate(async (id) => {
    const body = (await (await fetch('/studio_outputs?limit=200')).json()) as { outputs?: StudioOutput[] };
    return body.outputs?.find((item) => item.taskId === id && item.displayType === 'image') ?? null;
  }, taskId);
  expect(output?.mediaHash ?? output?.mediaItems?.[0]?.mediaHash).toMatch(/^sha256:/u);
  return { taskId: taskId!, output: output! };
}

async function assertPublicationStillPending(page: Page, definitionId: string) {
  const publication = await page.evaluate(async (id) => {
    const body = (await (await fetch('/huggingface/node-library')).json()) as {
      definitions?: Array<{
        id?: string;
        executionAdmissions?: Array<{
          publication?: { executable?: boolean; autoEligible?: boolean; liveProof?: boolean };
        }>;
      }>;
    };
    return body.definitions?.find((definition) => definition.id === id)?.executionAdmissions?.[0]?.publication;
  }, definitionId);
  expect(publication).toMatchObject({ executable: false, autoEligible: false, liveProof: false });
}

test('live FLUX.2 Klein Clusters persist, expand equivalently, and qualify text and edit workflows', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_FLUX2_KLEIN_CLUSTERS !== '1' && !QUALIFY_BASE,
    'The installed FLUX.2 Klein Cluster qualification wave must be selected explicitly.',
  );
  test.setTimeout(2 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/${MODEL.folder}` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('flux2-klein-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('flux2-klein-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await ensureOptionalRuntime(page);
  await ensureModelInstalledThroughFrontend(page, evidenceRoot);

  const textPrompt = RUN.textPrompt;
  let root = await insertCluster(page, `${MODEL.label} — Text To Image`);
  await setClusterInputs(page, textPrompt, null, 41001);
  const textPersistence = await saveRefreshAndProveExpansion(page, root, 'FLUX.2 Klein Text Cluster Proof', 10);
  const textRun = await prepareAndRun(page, root);
  await assertPublicationStillPending(page, textPersistence.after!.definitionId!);
  const sourceImage = textRun.output.mediaItems?.[0]?.backendPath;
  expect(sourceImage).toMatch(/^@data\//u);
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/text-to-image-generated.png`, fullPage: true });
    const response = await page.request.get(textRun.output.url!);
    expect(response.ok()).toBe(true);
    await writeFile(`${evidenceRoot}/text-to-image-generated.webp`, await response.body());
  }

  await page.getByTestId('topbar-new-workflow').click();
  root = await insertCluster(page, `${MODEL.label} — Edit Image`);
  const editPrompt = RUN.editPrompt;
  await setClusterInputs(page, editPrompt, sourceImage!, 41002);
  const editPersistence = await saveRefreshAndProveExpansion(page, root, 'FLUX.2 Klein Edit Cluster Proof', 13);
  const editRun = await prepareAndRun(page, root);
  await assertPublicationStillPending(page, editPersistence.after!.definitionId!);
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/edit-image-generated.png`, fullPage: true });
    const response = await page.request.get(editRun.output.url!);
    expect(response.ok()).toBe(true);
    await writeFile(`${evidenceRoot}/edit-image-generated.webp`, await response.body());
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model: MODEL,
          textToImage: { ...textPersistence, ...textRun },
          editImage: { sourceImage, ...editPersistence, ...editRun },
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
          qualificationOnly: !SHOWCASE_BASE,
          showcaseCandidate: SHOWCASE_BASE,
          showcaseApproved: false,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});
