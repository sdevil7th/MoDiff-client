import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const RUNTIME_ID = 'huggingface-transformers-main-96fe6dce-peft-0.20.0';
const MODELS = {
  flux: {
    modelType: 'FluxModularPipeline',
    repo: 'black-forest-labs/FLUX.1-dev',
    revision: '3de623fc3c33e44ffbe2bad470d0f45bccf2eb21',
  },
  kontext: {
    modelType: 'FluxKontextModularPipeline',
    repo: 'black-forest-labs/FLUX.1-Kontext-dev',
    revision: '24e9dedc4ef646698dc8eb4e18ae2cec3c9fea0d',
  },
} as const;

type Model = {
  modelType: string;
  repo: string;
  revision: string;
};

type Scenario = {
  id: string;
  label: string;
  workflowName: string;
  model: Model;
  prompt: string;
  negativePrompt?: string;
  seed: number;
  guidanceScale: number;
  guidanceScale2?: number;
  shift?: number;
  quantizationMode?: string;
  blockPlacementCount: number;
  setGeometry?: boolean;
  studioMode?: string;
  image?: string | string[];
  ipAdapterImage?: string;
  ipAdapterScale?: number;
  lastImage?: string;
  controlImage?: string;
  controlMode?: number;
  mask?: string;
  strength?: number;
  conditioningScale?: number;
  controlGuidanceStart?: number;
  controlGuidanceEnd?: number;
  layers?: number;
  resolution?: number;
  maxSequenceLength?: number;
  numFrames?: number;
  fps?: number;
  expectedDisplayType?: 'image' | 'image_collection' | 'video';
  expectedMediaItemCount?: number;
  width?: number;
  height?: number;
  steps?: number;
  dtype?: 'float16' | 'bfloat16';
  dtypeAsParameter?: boolean;
  offloadMode?: 'none' | 'model_cpu' | 'sequential_cpu' | 'group_cpu' | 'group_disk';
  standardExecutor?: {
    role: string;
    module: string;
    action: string;
    pipelineClass: string;
    executionProfileId: string;
  };
  expandedExecutionEdit?: {
    role: string;
    field: string;
    value: string | number | boolean;
    bindingSource: string;
  };
  visiblePromptEdit?: boolean;
};

type StudioOutput = {
  taskId?: string;
  displayType?: string;
  mediaHash?: string;
  url?: string;
  mediaItems?: Array<{ backendPath?: string; mediaHash?: string; url?: string }>;
};

type RunTask = { task_id?: string; status?: string; message?: string; phase?: string };

test.beforeEach(({ page }) => {
  // Model execution has its own explicit multi-hour polling budget. Ordinary
  // browser controls should never inherit an unlimited action/navigation wait,
  // because a missing collapsed-only control would otherwise consume that
  // entire model budget without producing a useful failure.
  page.setDefaultTimeout(2 * 60 * 1000);
  page.setDefaultNavigationTimeout(2 * 60 * 1000);
});

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

async function clearFinishedSessionActivity(page: Page) {
  const activity = page.getByRole('region', { name: 'Session activity' });
  if (!(await activity.isVisible().catch(() => false))) return;
  const clear = activity.getByRole('button', { name: 'Clear' });
  if (await clear.isVisible().catch(() => false)) await clear.click();
}

async function startCleanWorkflow(page: Page) {
  const advancedWorkflow = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advancedWorkflow.isVisible({ timeout: 1000 }).catch(() => false)) await advancedWorkflow.click();
  await page.getByTestId('topbar-new-workflow').click();
  if (await advancedWorkflow.isVisible({ timeout: 1000 }).catch(() => false)) await advancedWorkflow.click();
  await expect(page.locator('[data-cluster-role="root"]')).toHaveCount(0);
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

async function ensureModelInstalledThroughFrontend(
  page: Page,
  modelType: string,
  expected: { repo: string; revision: string },
  evidenceRoot: string | null,
) {
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
  expect(capability).toMatchObject({ defaultRepo: expected.repo });
  expect(capability?.revisionCandidates).toContain(expected.revision);
  expect(capability?.downloadFiles?.length).toBeGreaterThan(0);

  // Model Manager starts an asynchronous cache actualization when opened. A
  // complete exact snapshot can therefore briefly render as Install before
  // the row settles to Ready. Resolve the same frontend-owned index refresh
  // first so the test never clicks a stale action or waits for a redundant
  // multi-gigabyte download request.
  await page.evaluate(async () => {
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    await useNodesStore.getState().refreshModelIndexes(true);
  });
  await page.getByTestId('topbar-models').click();
  const manager = page.getByTestId('model-manager-dialog');
  await expect(manager).toBeVisible();
  const managerRow = manager.locator(
    `[data-testid="model-manager-supported-${modelType}"][data-model-repo="${expected.repo}"]`,
  );
  await expect(managerRow).toBeVisible({ timeout: 60_000 });
  const install = managerRow.getByTestId(`model-manager-install-${modelType}`);
  let installedDuringTest = false;
  if ((await install.textContent())?.trim() !== 'Ready') {
    const requestPromise = page.waitForRequest(
      (request) => request.url().endsWith('/hf_download') && request.method() === 'POST',
      { timeout: 120_000 },
    );
    await install.click();
    const request = await requestPromise;
    expect(request.postDataJSON()).toMatchObject({
      repo_id: expected.repo,
      revision: expected.revision,
      files: capability!.downloadFiles,
    });
    installedDuringTest = true;
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
  return { capability, installedDuringTest };
}

async function insertCluster(page: Page, label: string, studioMode?: string) {
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
  await clearFinishedSessionActivity(page);
  const root = page.locator('[data-cluster-role="root"]').filter({ hasText: label }).last();
  await expect(root).toBeVisible();
  if (studioMode) {
    const mode = root.getByLabel('Reviewed workflow mode');
    await expect(mode).toBeVisible();
    await mode.click();
    await page.getByRole('option', { name: studioMode.replace(/_/gu, ' '), exact: true }).click();
    await expect(mode).toContainText(studioMode.replace(/_/gu, ' '));
  }
  return root;
}

async function setClusterInputs(page: Page, scenario: Scenario) {
  if (scenario.visiblePromptEdit) {
    const root = page.locator('[data-cluster-role="root"]').filter({ hasText: scenario.label }).last();
    const prompt = root.getByLabel('prompt', { exact: true });
    await expect(prompt).toBeVisible();
    await prompt.fill(scenario.prompt);
    await prompt.blur();
    if (scenario.negativePrompt !== undefined) {
      const negativePrompt = root.getByLabel('negative prompt', { exact: true });
      await expect(negativePrompt).toBeVisible();
      await negativePrompt.fill(scenario.negativePrompt);
      await negativePrompt.blur();
    }
  }
  await page.evaluate(
    async ({
      prompt,
      negativePrompt,
      image,
      ipAdapterImage,
      ipAdapterScale,
      lastImage,
      controlImage,
      controlMode,
      mask,
      seed,
      guidanceScale,
      guidanceScale2,
      shift,
      quantizationMode,
      strength,
      conditioningScale,
      controlGuidanceStart,
      controlGuidanceEnd,
      layers,
      resolution,
      maxSequenceLength,
      numFrames,
      fps,
      setGeometry,
      width,
      height,
      steps,
      dtype,
      dtypeAsParameter,
      offloadMode,
      scenarioLabel,
      visiblePromptEdit,
    }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      const root = [...flow.nodes]
        .reverse()
        .find((node) => node.data.huggingFaceClusterRole === 'root' && node.data.label === scenarioLabel);
      if (!root) throw new Error('FLUX Cluster root is unavailable.');
      if (!visiblePromptEdit) {
        flow.setHuggingFaceClusterParameter(root.id, 'prompt', prompt);
        if (negativePrompt !== undefined)
          flow.setHuggingFaceClusterParameter(root.id, 'negative_prompt', negativePrompt);
      }
      if (setGeometry !== false) {
        flow.setHuggingFaceClusterParameter(root.id, 'width', width ?? 256);
        flow.setHuggingFaceClusterParameter(root.id, 'height', height ?? 256);
      }
      flow.setHuggingFaceClusterParameter(root.id, 'num_inference_steps', steps ?? 2);
      if (image) flow.setHuggingFaceClusterParameter(root.id, 'image', Array.isArray(image) ? image : [image]);
      if (ipAdapterImage) flow.setHuggingFaceClusterParameter(root.id, 'ip_adapter_image', ipAdapterImage);
      if (ipAdapterScale !== undefined)
        flow.setHuggingFaceClusterExecutionParameter(root.id, 'ipAdapterScale', ipAdapterScale);
      if (lastImage) flow.setHuggingFaceClusterParameter(root.id, 'last_image', lastImage);
      if (controlImage) flow.setHuggingFaceClusterParameter(root.id, 'control_image', controlImage);
      if (controlMode !== undefined) flow.setHuggingFaceClusterParameter(root.id, 'control_mode', controlMode);
      if (mask) flow.setHuggingFaceClusterParameter(root.id, 'mask_image', mask);
      if (strength !== undefined) flow.setHuggingFaceClusterParameter(root.id, 'strength', strength);
      if (conditioningScale !== undefined)
        flow.setHuggingFaceClusterParameter(root.id, 'controlnet_conditioning_scale', conditioningScale);
      if (controlGuidanceStart !== undefined)
        flow.setHuggingFaceClusterParameter(root.id, 'control_guidance_start', controlGuidanceStart);
      if (controlGuidanceEnd !== undefined)
        flow.setHuggingFaceClusterParameter(root.id, 'control_guidance_end', controlGuidanceEnd);
      if (layers !== undefined) flow.setHuggingFaceClusterParameter(root.id, 'layers', layers);
      if (resolution !== undefined) flow.setHuggingFaceClusterParameter(root.id, 'resolution', resolution);
      if (maxSequenceLength !== undefined)
        flow.setHuggingFaceClusterParameter(root.id, 'max_sequence_length', maxSequenceLength);
      if (numFrames !== undefined) flow.setHuggingFaceClusterParameter(root.id, 'num_frames', numFrames);
      flow.setHuggingFaceClusterExecutionParameter(root.id, 'guidanceScale', guidanceScale);
      if (guidanceScale2 !== undefined)
        flow.setHuggingFaceClusterExecutionParameter(root.id, 'guidanceScale2', guidanceScale2);
      if (shift !== undefined) flow.setHuggingFaceClusterExecutionParameter(root.id, 'shift', shift);
      if (quantizationMode !== undefined)
        flow.setHuggingFaceClusterExecutionParameter(root.id, 'quantizationMode', quantizationMode);
      flow.setHuggingFaceClusterExecutionParameter(root.id, 'seed', seed);
      if (fps !== undefined) flow.setHuggingFaceClusterExecutionParameter(root.id, 'fps', fps);
      if (dtypeAsParameter) flow.setHuggingFaceClusterParameter(root.id, 'dtype', dtype ?? 'bfloat16');
      else flow.setHuggingFaceClusterExecutionParameter(root.id, 'dtype', dtype ?? 'bfloat16');
      const selectedOffload = offloadMode ?? 'model_cpu';
      flow.setHuggingFaceClusterExecutionParameter(root.id, 'autoOffload', selectedOffload !== 'none');
      flow.setHuggingFaceClusterExecutionParameter(root.id, 'offloadMode', selectedOffload);
    },
    { ...scenario, scenarioLabel: scenario.label },
  );
}

async function clusterSnapshot(page: Page, graphName: string, label: string) {
  return page.evaluate(
    async ({ name, scenarioLabel }) => {
      const [{ useFlowStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
      ]);
      const flow = useFlowStore.getState();
      const root = [...flow.nodes]
        .reverse()
        .find((node) => node.data.huggingFaceClusterRole === 'root' && node.data.label === scenarioLabel);
      if (!root) return null;
      const definition = useHuggingFaceNodeLibraryStore
        .getState()
        .library?.definitions.find((candidate) => candidate.id === root.data.huggingFaceClusterInstance?.definition.id);
      const graph = flow.exportGraph(name);
      return {
        definitionId: root.data.huggingFaceClusterInstance?.definition.id,
        workflowId: definition?.workflowId,
        overrides: root.data.huggingFaceClusterInstance?.parameterOverrides,
        executionOverrides: root.data.huggingFaceClusterInstance?.execution?.parameterOverrides,
        admissionMode: definition?.executionAdmissions.find(
          (admission) => admission.id === root.data.huggingFaceClusterInstance?.execution?.admissionId,
        )?.studioMode,
        effective: Object.fromEntries(Object.entries(root.data.params).map(([key, field]) => [key, field.value])),
        blockPlacementCount: definition?.blockPlacements.length,
        graph: { nodes: graph.nodes, paths: graph.paths, deterministicMode: graph.deterministicMode },
      };
    },
    { name: graphName, scenarioLabel: label },
  );
}

async function saveRefreshAndProveExpansion(page: Page, root: Locator, scenario: Scenario) {
  const before = await clusterSnapshot(page, scenario.id, scenario.label);
  expect(before?.effective).toMatchObject({ num_inference_steps: scenario.steps ?? 2 });
  if (scenario.setGeometry !== false)
    expect(before?.effective).toMatchObject({ width: scenario.width ?? 256, height: scenario.height ?? 256 });
  if (scenario.studioMode) expect(before?.admissionMode).toBe(scenario.studioMode);
  if (scenario.image)
    expect(before?.effective).toMatchObject({
      image: Array.isArray(scenario.image) ? scenario.image : [scenario.image],
    });
  if (scenario.negativePrompt !== undefined)
    expect(before?.effective).toMatchObject({ negative_prompt: scenario.negativePrompt });
  if (scenario.ipAdapterImage) expect(before?.effective).toMatchObject({ ip_adapter_image: scenario.ipAdapterImage });
  if (scenario.ipAdapterScale !== undefined)
    expect(before?.executionOverrides).toMatchObject({ ipAdapterScale: scenario.ipAdapterScale });
  if (scenario.lastImage) expect(before?.effective).toMatchObject({ last_image: scenario.lastImage });
  if (scenario.controlImage) expect(before?.effective).toMatchObject({ control_image: scenario.controlImage });
  if (scenario.controlMode !== undefined)
    expect(before?.effective).toMatchObject({ control_mode: scenario.controlMode });
  if (scenario.mask) expect(before?.effective).toMatchObject({ mask_image: scenario.mask });
  if (scenario.strength !== undefined) expect(before?.effective).toMatchObject({ strength: scenario.strength });
  if (scenario.conditioningScale !== undefined)
    expect(before?.effective).toMatchObject({ controlnet_conditioning_scale: scenario.conditioningScale });
  if (scenario.controlGuidanceStart !== undefined)
    expect(before?.effective).toMatchObject({ control_guidance_start: scenario.controlGuidanceStart });
  if (scenario.controlGuidanceEnd !== undefined)
    expect(before?.effective).toMatchObject({ control_guidance_end: scenario.controlGuidanceEnd });
  if (scenario.layers !== undefined) expect(before?.effective).toMatchObject({ layers: scenario.layers });
  if (scenario.resolution !== undefined) expect(before?.effective).toMatchObject({ resolution: scenario.resolution });
  if (scenario.maxSequenceLength !== undefined)
    expect(before?.effective).toMatchObject({ max_sequence_length: scenario.maxSequenceLength });
  if (scenario.numFrames !== undefined) expect(before?.effective).toMatchObject({ num_frames: scenario.numFrames });
  if (scenario.guidanceScale2 !== undefined)
    expect(before?.executionOverrides).toMatchObject({ guidanceScale2: scenario.guidanceScale2 });
  if (scenario.shift !== undefined) expect(before?.executionOverrides).toMatchObject({ shift: scenario.shift });
  if (scenario.quantizationMode !== undefined)
    expect(before?.executionOverrides).toMatchObject({ quantizationMode: scenario.quantizationMode });
  if (scenario.dtypeAsParameter) expect(before?.effective).toMatchObject({ dtype: scenario.dtype });
  else if (scenario.dtype) expect(before?.executionOverrides).toMatchObject({ dtype: scenario.dtype });
  if (scenario.fps !== undefined) expect(before?.executionOverrides).toMatchObject({ fps: scenario.fps });
  expect(before?.blockPlacementCount).toBe(scenario.blockPlacementCount);

  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill(scenario.workflowName);
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await clearFinishedSessionActivity(page);
  await expect(root).toBeVisible();
  const after = await clusterSnapshot(page, scenario.id, scenario.label);
  expect(after).toEqual(before);

  const collapsed = after!.graph;
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  const expandedHierarchy = await page.evaluate(async (scenarioLabel) => {
    const [{ useFlowStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
      import('/src/stores/useFlowStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
    ]);
    const flow = useFlowStore.getState();
    const rootNode = [...flow.nodes]
      .reverse()
      .find((node) => node.data.huggingFaceClusterRole === 'root' && node.data.label === scenarioLabel);
    const definition = useHuggingFaceNodeLibraryStore
      .getState()
      .library?.definitions.find(
        (candidate) => candidate.id === rootNode?.data.huggingFaceClusterInstance?.definition.id,
      );
    return {
      materializedPaths: flow.nodes
        .filter((node) => node.data.huggingFaceClusterRole === 'block')
        .map((node) => node.data.huggingFaceClusterPath)
        .sort(),
      executionRoles: flow.nodes
        .filter(
          (node) =>
            node.data.huggingFaceClusterRole === 'execution' && node.data.huggingFaceClusterInstanceId === rootNode?.id,
        )
        .map((node) => node.data.huggingFaceClusterExecutionRole)
        .filter((role): role is string => Boolean(role))
        .sort(),
      renderedNodeIds: flow.nodes
        .filter(
          (node) =>
            node.data.huggingFaceClusterRole === 'block' ||
            (node.data.huggingFaceClusterRole === 'execution' &&
              node.data.huggingFaceClusterInstanceId === rootNode?.id),
        )
        .map((node) => node.id),
      parameterPaths: [
        ...new Set(
          flow.nodes
            .filter((node) => node.data.huggingFaceClusterRole === 'block')
            .map((node) => node.data.huggingFaceClusterParameterPath)
            .filter((path): path is string => Boolean(path)),
        ),
      ].sort(),
      conditionalNodeCount: flow.nodes.filter(
        (node) =>
          node.data.huggingFaceClusterRole === 'block' &&
          typeof node.data.huggingFaceClusterConditionalStatus === 'string',
      ).length,
      reviewedPaths: definition?.blockPlacements.map((placement) => placement.path.join('/')).sort() ?? [],
    };
  }, scenario.label);
  if (expandedHierarchy.conditionalNodeCount > 0) {
    expect(expandedHierarchy.parameterPaths).toEqual(expandedHierarchy.reviewedPaths);
    expect(expandedHierarchy.parameterPaths).toHaveLength(scenario.blockPlacementCount);
    expect(expandedHierarchy.materializedPaths.length).toBeGreaterThanOrEqual(scenario.blockPlacementCount);
  } else {
    const ordinaryExpandedPaths = expandedHierarchy.materializedPaths.length
      ? expandedHierarchy.materializedPaths
      : expandedHierarchy.executionRoles;
    expect(ordinaryExpandedPaths).toEqual(expandedHierarchy.reviewedPaths);
    expect(ordinaryExpandedPaths).toHaveLength(scenario.blockPlacementCount);
  }
  expect(expandedHierarchy.renderedNodeIds.length).toBeGreaterThan(0);
  await expect(page.locator(`[data-id="${expandedHierarchy.renderedNodeIds[0]}"]`)).toBeVisible();
  expect((await clusterSnapshot(page, scenario.id, scenario.label))!.graph).toEqual(collapsed);
  await root.getByLabel('Collapse Diffusers Cluster Node').click();
  expect((await clusterSnapshot(page, scenario.id, scenario.label))!.graph).toEqual(collapsed);
  return { before, after };
}

async function prepareAndRun(page: Page, root: Locator, scenario: Scenario) {
  // Projection is automatic. Expert runtime preparation is exercised through
  // the visible top-bar Run action below; Cluster cards intentionally have no
  // separate qualification/preparation control.
  await expect
    .poll(
      () =>
        page.evaluate(async (scenarioLabel) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          const flow = useFlowStore.getState();
          const cluster = [...flow.nodes]
            .reverse()
            .find((node) => node.data.huggingFaceClusterRole === 'root' && node.data.label === scenarioLabel);
          return cluster
            ? flow.nodes.filter(
                (node) =>
                  node.data.huggingFaceClusterRole === 'execution' &&
                  node.data.huggingFaceClusterInstanceId === cluster.id,
              ).length
            : 0;
        }, scenario.label),
      { timeout: 300_000, intervals: [250, 500, 1000, 2000] },
    )
    .toBeGreaterThan(0);
  const preparedCollapsed = await clusterSnapshot(page, scenario.id, scenario.label);
  await root.getByLabel('Expand Diffusers Cluster Node').click();
  expect((await clusterSnapshot(page, scenario.id, scenario.label))!.graph).toEqual(preparedCollapsed!.graph);
  await root.getByLabel('Collapse Diffusers Cluster Node').click();

  let prepared = await page.evaluate(async (scenarioLabel) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const nodes = useFlowStore.getState().nodes;
    const cluster = [...nodes]
      .reverse()
      .find((node) => node.data.huggingFaceClusterRole === 'root' && node.data.label === scenarioLabel);
    if (!cluster) throw new Error(`Cluster ${scenarioLabel} is unavailable after preparation.`);
    const instanceId = cluster.data.huggingFaceClusterInstance?.instanceId;
    return nodes
      .filter(
        (node) =>
          node.data.huggingFaceClusterRole === 'execution' && node.data.huggingFaceClusterInstanceId === instanceId,
      )
      .map((node) => ({
        role: node.data.huggingFaceClusterExecutionRole,
        module: node.data.module,
        action: node.data.action,
        disabled: Boolean(node.data.uiState?.disabled),
        values: Object.fromEntries(Object.entries(node.data.params).map(([key, field]) => [key, field.value])),
      }));
  }, scenario.label);
  if (scenario.expandedExecutionEdit) {
    await root.getByLabel('Expand Diffusers Cluster Node').click();
    const editedOverrides = await page.evaluate(
      async ({ scenarioLabel, edit }) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const flow = useFlowStore.getState();
        const cluster = [...flow.nodes]
          .reverse()
          .find((node) => node.data.huggingFaceClusterRole === 'root' && node.data.label === scenarioLabel);
        if (!cluster) throw new Error(`Cluster ${scenarioLabel} is unavailable for an expanded edit.`);
        const child = flow.nodes.find(
          (node) =>
            node.data.huggingFaceClusterRole === 'execution' &&
            node.data.huggingFaceClusterInstanceId === cluster.id &&
            node.data.huggingFaceClusterExecutionRole === edit.role,
        );
        if (!child) throw new Error(`Expanded execution role ${edit.role} is unavailable.`);
        flow.setParamWithHistory(child.id, edit.field, edit.value);
        return useFlowStore.getState().nodes.find((node) => node.id === cluster.id)?.data.huggingFaceClusterInstance
          ?.execution?.parameterOverrides;
      },
      { scenarioLabel: scenario.label, edit: scenario.expandedExecutionEdit },
    );
    expect(editedOverrides).toMatchObject({
      [scenario.expandedExecutionEdit.bindingSource]: scenario.expandedExecutionEdit.value,
    });
    const workflowSave = page.waitForResponse(
      (response) => response.url().includes('/workflows/') && response.request().method() === 'PUT',
      { timeout: 120_000 },
    );
    await page.getByTestId('topbar-save-workflow').click();
    expect((await workflowSave).ok()).toBe(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
    await waitForWorkspaceStartup(page);
    await clearFinishedSessionActivity(page);
    await expect(root).toBeVisible();
    expect((await clusterSnapshot(page, scenario.id, scenario.label))?.executionOverrides).toMatchObject({
      [scenario.expandedExecutionEdit.bindingSource]: scenario.expandedExecutionEdit.value,
    });
    // Expansion is presentation state and intentionally survives Save and
    // refresh. Confirm it explicitly, then let automatic graph projection
    // settle before using the ordinary top-bar Run action.
    const persistedCollapse = root.getByLabel('Collapse Diffusers Cluster Node');
    await expect(persistedCollapse).toBeVisible();
    await persistedCollapse.click();
    await expect
      .poll(
        () =>
          page.evaluate(async (scenarioLabel) => {
            const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
            const flow = useFlowStore.getState();
            const cluster = [...flow.nodes]
              .reverse()
              .find((node) => node.data.huggingFaceClusterRole === 'root' && node.data.label === scenarioLabel);
            return cluster
              ? flow.nodes.filter(
                  (node) =>
                    node.data.huggingFaceClusterRole === 'execution' &&
                    node.data.huggingFaceClusterInstanceId === cluster.id,
                ).length
              : 0;
          }, scenario.label),
        { timeout: 300_000, intervals: [250, 500, 1000, 2000] },
      )
      .toBeGreaterThan(0);
    await root.getByLabel('Expand Diffusers Cluster Node').click();
    prepared = await page.evaluate(async (scenarioLabel) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      const cluster = [...flow.nodes]
        .reverse()
        .find((node) => node.data.huggingFaceClusterRole === 'root' && node.data.label === scenarioLabel);
      if (!cluster) throw new Error(`Cluster ${scenarioLabel} is unavailable after refresh and preparation.`);
      return flow.nodes
        .filter(
          (node) =>
            node.data.huggingFaceClusterRole === 'execution' && node.data.huggingFaceClusterInstanceId === cluster.id,
        )
        .map((node) => ({
          role: node.data.huggingFaceClusterExecutionRole,
          module: node.data.module,
          action: node.data.action,
          disabled: Boolean(node.data.uiState?.disabled),
          values: Object.fromEntries(Object.entries(node.data.params).map(([key, field]) => [key, field.value])),
        }));
    }, scenario.label);
    expect(
      prepared.find((node) => node.role === scenario.expandedExecutionEdit!.role)?.values[
        scenario.expandedExecutionEdit.field
      ],
    ).toBe(scenario.expandedExecutionEdit.value);
    await root.getByLabel('Collapse Diffusers Cluster Node').click();
  }
  if (scenario.standardExecutor) {
    expect(prepared.find((node) => node.role === scenario.standardExecutor!.role)).toMatchObject({
      module: scenario.standardExecutor.module,
      action: scenario.standardExecutor.action,
      values: {
        model_id: { source: 'hub', value: scenario.model.repo },
        pipeline_class: scenario.standardExecutor.pipelineClass,
        execution_profile_id: scenario.standardExecutor.executionProfileId,
        revision: scenario.model.revision,
      },
    });
  } else {
    expect(prepared.find((node) => node.role === 'models')).toMatchObject({
      module: 'modules.ModularDiffusers',
      action: 'ModelsLoader',
      values: {
        model_type: scenario.model.modelType,
        repo_id: { source: 'hub', value: scenario.model.repo },
        revision: scenario.model.revision,
      },
    });
  }
  if (scenario.controlImage) {
    const controlImageRole = scenario.image ? 'loadControlImage' : 'loadImage';
    expect(prepared.find((node) => node.role === controlImageRole)).toMatchObject({
      module: 'modules.Image',
      action: 'Load',
      values: { file: scenario.controlImage },
    });
    expect(prepared.find((node) => node.role === 'controlnet')).toMatchObject({
      module: 'modules.ModularDiffusers',
      action: 'Controlnet',
      values: {
        controlnet_conditioning_scale: scenario.conditioningScale,
        control_guidance_start: scenario.controlGuidanceStart,
        control_guidance_end: scenario.controlGuidanceEnd,
        ...(scenario.controlMode === undefined ? {} : { control_mode: scenario.controlMode }),
      },
    });
  }
  if (scenario.ipAdapterImage) {
    expect(prepared.find((node) => node.role === 'loadIPAdapterImage')).toMatchObject({
      module: 'modules.Image',
      action: 'Load',
      values: { file: scenario.ipAdapterImage },
    });
    expect(prepared.find((node) => node.role === 'ipAdapter')).toMatchObject({
      module: 'modules.ModularDiffusers',
      action: 'IPAdapter',
      values: { adapter_scale: scenario.ipAdapterScale },
    });
  }
  if (scenario.expectedDisplayType === 'video' && scenario.image) {
    expect(prepared.find((node) => node.role === 'loadImage')).toMatchObject({
      module: 'modules.Image',
      action: 'Load',
      values: { file: Array.isArray(scenario.image) ? scenario.image : [scenario.image] },
    });
  }
  if (scenario.expectedDisplayType === 'video') {
    const videoExport = prepared.find((node) => node.role === 'videoExport');
    expect(videoExport).toMatchObject({
      module: 'modules.Video',
      action: 'Export',
      values: { fps: scenario.fps },
    });
    const inheritedQuality = await page.evaluate(async () => {
      const response = await fetch('/nodes');
      if (!response.ok) throw new Error(`Could not read the live node contracts (${response.status}).`);
      const body = (await response.json()) as {
        nodes?: Record<string, { params?: Record<string, { default?: unknown }> }>;
      };
      return body.nodes?.['modules.Video.Export']?.params?.quality?.default;
    });
    expect(videoExport?.values.quality ?? inheritedQuality).toBe(8);
  }
  if (scenario.lastImage) {
    expect(prepared.find((node) => node.role === 'loadLastImage')).toMatchObject({
      module: 'modules.Image',
      action: 'Load',
      values: { file: scenario.lastImage },
    });
  }
  if (scenario.maxSequenceLength !== undefined) {
    expect(prepared.find((node) => node.role === (scenario.standardExecutor ? 'wanGenerate' : 'prompt'))).toMatchObject(
      scenario.standardExecutor
        ? {
            module: 'modules.DiffusersVideo',
            action: 'Generate',
            values: { max_sequence_length: scenario.maxSequenceLength },
          }
        : {
            module: 'modules.ModularDiffusers',
            action: 'EncodePrompt',
            values: { max_sequence_length: scenario.maxSequenceLength },
          },
    );
  }
  if (scenario.numFrames !== undefined) {
    expect(
      prepared.find((node) => node.role === (scenario.standardExecutor ? 'wanGenerate' : 'denoise')),
    ).toMatchObject(
      scenario.standardExecutor
        ? {
            module: 'modules.DiffusersVideo',
            action: 'Generate',
            values: {
              width: scenario.width ?? 256,
              height: scenario.height ?? 256,
              num_frames: scenario.numFrames,
              guidance_scale: scenario.guidanceScale,
              ...(scenario.guidanceScale2 === undefined
                ? {}
                : { guidance_scale_2: scenario.guidanceScale2, use_guidance_scale_2: true }),
            },
          }
        : {
            module: 'modules.ModularDiffusers',
            action: 'Denoise',
            values: {
              width: scenario.width ?? 256,
              height: scenario.height ?? 256,
              num_frames: scenario.numFrames,
            },
          },
    );
  }

  const submission = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByTestId('studio-run').click();
  const usageTerms = page.getByTestId('model-usage-terms-dialog');
  if (await usageTerms.isVisible({ timeout: 3000 }).catch(() => false)) {
    throw new Error('The qualification run requires a user-owned model-terms acknowledgement.');
  }
  const response = await submission;
  expect(response.ok()).toBe(true);
  prepared = await page.evaluate(async (scenarioLabel) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const flow = useFlowStore.getState();
    const cluster = [...flow.nodes]
      .reverse()
      .find((node) => node.data.huggingFaceClusterRole === 'root' && node.data.label === scenarioLabel);
    if (!cluster) throw new Error(`Cluster ${scenarioLabel} is unavailable after Run preparation.`);
    return flow.nodes
      .filter(
        (node) =>
          node.data.huggingFaceClusterRole === 'execution' && node.data.huggingFaceClusterInstanceId === cluster.id,
      )
      .map((node) => ({
        role: node.data.huggingFaceClusterExecutionRole,
        module: node.data.module,
        action: node.data.action,
        disabled: Boolean(node.data.uiState?.disabled),
        values: Object.fromEntries(Object.entries(node.data.params).map(([key, field]) => [key, field.value])),
      }));
  }, scenario.label);
  expect(prepared.every((node) => !node.disabled)).toBe(true);
  const taskId = ((await response.json()) as { task_id?: string }).task_id;
  expect(taskId).toBeTruthy();
  const modelIoDeadline =
    Date.now() + (process.env.MODIFF_LONG_RUNNING_QUALIFICATION === '1' ? 11 : 4) * 60 * 60 * 1000;
  // Native 14B video qualifications on CPU-offloaded consumer hardware can
  // spend several minutes per denoising step. Keep ordinary live tests bounded
  // to one hour, while an explicit long-running qualification inherits the
  // surrounding long-running test budget with time left for media validation.
  let activeExecutionBudgetMs =
    process.env.MODIFF_LONG_RUNNING_QUALIFICATION === '1' ? 10 * 60 * 60 * 1000 : 60 * 60 * 1000;
  let previousPollAt = Date.now();
  let terminalTask: RunTask | null = null;
  let lastObservedTask: RunTask | null = null;
  while (!terminalTask && Date.now() < modelIoDeadline && activeExecutionBudgetMs > 0) {
    const queueResponse = await page.request.get('/queue').catch(() => null);
    if (queueResponse?.ok()) {
      const queue = (await queueResponse.json()) as {
        current?: RunTask | null;
        queued?: Record<string, RunTask>;
        recent?: RunTask[];
      };
      const task =
        (queue.current?.task_id === taskId ? queue.current : null) ??
        Object.values(queue.queued ?? {}).find((candidate) => candidate.task_id === taskId) ??
        queue.recent?.find((candidate) => candidate.task_id === taskId) ??
        null;
      lastObservedTask = task;
      if (task && ['completed', 'failed', 'cancelled'].includes(task.status ?? '')) terminalTask = task;
      const now = Date.now();
      const parkedForModelIo =
        task?.phase === 'waiting_for_model_io' ||
        task?.status === 'queued' ||
        Object.values(queue.queued ?? {}).some((candidate) => candidate.task_id === taskId);
      if (task && !terminalTask && !parkedForModelIo) activeExecutionBudgetMs -= now - previousPollAt;
      previousPollAt = now;
    }
    if (!terminalTask) await page.waitForTimeout(1000);
  }
  expect(
    terminalTask,
    `The graph run did not reach a terminal queue state before timeout. Last observed task: ${JSON.stringify(lastObservedTask)}`,
  ).not.toBeNull();
  expect(terminalTask, terminalTask?.message).toMatchObject({ task_id: taskId, status: 'completed' });
  const expectedDisplayType =
    scenario.expectedDisplayType ?? (scenario.expectedMediaItemCount === undefined ? 'image' : 'image_collection');
  await expect
    .poll(
      () =>
        page.evaluate(
          async (id) => {
            const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
              outputs?: StudioOutput[];
            };
            return (
              body.outputs?.find((item) => item.taskId === id.taskId && item.displayType === id.expectedDisplayType) ??
              null
            );
          },
          {
            taskId,
            expectedDisplayType,
          },
        ),
      { timeout: 120_000, intervals: [500, 1000, 2000] },
    )
    .toMatchObject({
      taskId,
      displayType: expectedDisplayType,
    });
  const output = await page.evaluate(
    async ({ id, expectedDisplayType }) => {
      const body = (await (await fetch('/studio_outputs?limit=200')).json()) as { outputs?: StudioOutput[] };
      return body.outputs?.find((item) => item.taskId === id && item.displayType === expectedDisplayType) ?? null;
    },
    {
      id: taskId,
      expectedDisplayType,
    },
  );
  expect(output?.mediaHash ?? output?.mediaItems?.[0]?.mediaHash).toMatch(/^sha256:/u);
  if (scenario.expectedMediaItemCount !== undefined)
    expect(output?.mediaItems).toHaveLength(scenario.expectedMediaItemCount);
  return { taskId: taskId!, output: output! };
}

async function assertPublicationStillPending(page: Page, definitionId: string, studioMode?: string) {
  const publication = await page.evaluate(
    async ({ id, mode }) => {
      const body = (await (await fetch('/huggingface/node-library')).json()) as {
        definitions?: Array<{
          id?: string;
          executionAdmissions?: Array<{
            studioMode?: string;
            publication?: { executable?: boolean; autoEligible?: boolean; liveProof?: boolean };
          }>;
        }>;
      };
      const admissions = body.definitions?.find((definition) => definition.id === id)?.executionAdmissions ?? [];
      return (mode ? admissions.find((admission) => admission.studioMode === mode) : admissions[0])?.publication;
    },
    { id: definitionId, mode: studioMode },
  );
  expect(publication).toMatchObject({ executable: false, autoEligible: false, liveProof: false });
}

async function runScenario(page: Page, scenario: Scenario, evidenceRoot: string | null) {
  const root = await insertCluster(page, scenario.label, scenario.studioMode);
  await setClusterInputs(page, scenario);
  const persistence = await saveRefreshAndProveExpansion(page, root, scenario);
  const run = await prepareAndRun(page, root, scenario);
  await assertPublicationStillPending(page, persistence.after!.definitionId!, scenario.studioMode);
  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/${scenario.id}-generated.png`, fullPage: true });
    const media = run.output.mediaItems?.length
      ? run.output.mediaItems.map((item) => item.url).filter((url): url is string => Boolean(url))
      : run.output.url
        ? [run.output.url]
        : [];
    expect(media.length).toBeGreaterThan(0);
    for (const [index, url] of media.entries()) {
      const response = await page.request.get(url);
      expect(response.ok()).toBe(true);
      const suffix = media.length === 1 ? '' : `-layer-${index + 1}`;
      const extension = scenario.expectedDisplayType === 'video' ? 'mp4' : 'webp';
      await writeFile(`${evidenceRoot}/${scenario.id}-generated${suffix}.${extension}`, await response.body());
    }
  }
  return { ...persistence, ...run };
}

test('live FLUX.1 Clusters persist, expand equivalently, and qualify all four admitted workflows', async ({ page }) => {
  test.skip(
    process.env.MODIFF_RUN_FLUX1_CLUSTERS !== '1',
    'The installed FLUX.1 and FLUX Kontext Cluster qualification wave must be selected explicitly.',
  );
  test.setTimeout(4 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/flux1-clusters` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('flux1-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('flux1-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await startCleanWorkflow(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await ensureOptionalRuntime(page);

  const fluxText = await runScenario(
    page,
    {
      id: 'flux-text-to-image',
      label: 'Flux — Text To Image',
      workflowName: 'FLUX.1 Text Cluster Proof',
      model: MODELS.flux,
      prompt: 'Technical FLUX.1 Cluster proof: a red cube on a neutral gray tabletop.',
      seed: 42001,
      guidanceScale: 3.5,
      blockPlacementCount: 9,
    },
    evidenceRoot,
  );
  const fluxSource = fluxText.output.mediaItems?.[0]?.backendPath;
  expect(fluxSource).toMatch(/^@data\//u);

  await page.getByTestId('topbar-new-workflow').click();
  const fluxImage = await runScenario(
    page,
    {
      id: 'flux-image-to-image',
      label: 'Flux — Image To Image',
      workflowName: 'FLUX.1 Image Cluster Proof',
      model: MODELS.flux,
      prompt: 'Technical image-to-image proof: make the cube polished blue ceramic.',
      seed: 42002,
      guidanceScale: 3.5,
      blockPlacementCount: 13,
      image: fluxSource!,
      strength: 0.72,
    },
    evidenceRoot,
  );

  await page.getByTestId('topbar-new-workflow').click();
  const kontextText = await runScenario(
    page,
    {
      id: 'kontext-text-to-image',
      label: 'Flux Kontext — Text To Image',
      workflowName: 'FLUX Kontext Text Cluster Proof',
      model: MODELS.kontext,
      prompt: 'Technical FLUX Kontext Cluster proof: a yellow sphere on a dark studio pedestal.',
      seed: 42003,
      guidanceScale: 2.5,
      blockPlacementCount: 9,
    },
    evidenceRoot,
  );
  const kontextSource = kontextText.output.mediaItems?.[0]?.backendPath;
  expect(kontextSource).toMatch(/^@data\//u);

  await page.getByTestId('topbar-new-workflow').click();
  const kontextEdit = await runScenario(
    page,
    {
      id: 'kontext-edit-image',
      label: 'Flux Kontext — Edit Image',
      workflowName: 'FLUX Kontext Edit Cluster Proof',
      model: MODELS.kontext,
      prompt: 'Technical Kontext edit proof: turn the yellow sphere into translucent violet glass.',
      seed: 42004,
      guidanceScale: 2.5,
      blockPlacementCount: 13,
      image: kontextSource!,
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          models: MODELS,
          fluxTextToImage: fluxText,
          fluxImageToImage: { sourceImage: fluxSource, ...fluxImage },
          kontextTextToImage: kontextText,
          kontextEditImage: { sourceImage: kontextSource, ...kontextEdit },
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
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

test('live Z-Image Clusters persist, expand equivalently, and qualify both admitted workflows', async ({ page }) => {
  test.skip(
    process.env.MODIFF_RUN_Z_IMAGE_CLUSTERS !== '1',
    'The installed Z-Image Cluster qualification wave must be selected explicitly.',
  );
  test.setTimeout(4 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/z-image-clusters` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('z-image-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('z-image-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await startCleanWorkflow(page);
  await ensureOptionalRuntime(page);

  const model: Model = {
    modelType: 'ZImageModularPipeline',
    repo: 'Tongyi-MAI/Z-Image-Turbo',
    revision: 'f332072aa78be7aecdf3ee76d5c247082da564a6',
  };
  const textToImage = await runScenario(
    page,
    {
      id: 'z-image-text-to-image',
      label: 'ZImage — Text To Image',
      workflowName: 'Z-Image Text Cluster Proof',
      model,
      prompt: 'Technical Z-Image Cluster proof: a matte orange pyramid on a neutral gray tabletop.',
      seed: 43001,
      guidanceScale: 1,
      blockPlacementCount: 9,
    },
    evidenceRoot,
  );
  const sourceImage = textToImage.output.mediaItems?.[0]?.backendPath;
  expect(sourceImage).toMatch(/^@data\//u);

  await page.getByTestId('topbar-new-workflow').click();
  const imageToImage = await runScenario(
    page,
    {
      id: 'z-image-image-to-image',
      label: 'ZImage — Image To Image',
      workflowName: 'Z-Image Image Cluster Proof',
      model,
      prompt: 'Technical Z-Image image-to-image proof: turn the pyramid into polished green jade.',
      seed: 43002,
      guidanceScale: 1,
      blockPlacementCount: 13,
      image: sourceImage!,
      strength: 0.65,
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          textToImage,
          imageToImage: { sourceImage, ...imageToImage },
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
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

test('live Qwen Image Edit Cluster persists, expands equivalently, and qualifies image editing', async ({ page }) => {
  test.skip(
    process.env.MODIFF_RUN_QWEN_IMAGE_EDIT_CLUSTER !== '1',
    'The installed Qwen Image Edit Cluster qualification must be selected explicitly.',
  );
  test.setTimeout(4 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/qwen-image-edit-cluster` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('qwen-image-edit-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('qwen-image-edit-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await ensureOptionalRuntime(page);

  const sourceImage =
    process.env.MODIFF_QWEN_EDIT_SOURCE_IMAGE ??
    '@data/qualification/local-review/hugging-face-clusters/diffusers-ernie-equivalent-cluster-output.webp';
  const model: Model = {
    modelType: 'QwenImageEditModularPipeline',
    repo: 'Qwen/Qwen-Image-Edit',
    revision: 'ac7f9318f633fc4b5778c59367c8128225f1e3de',
  };
  const edit = await runScenario(
    page,
    {
      id: 'qwen-image-edit',
      label: 'Qwen Image Edit — Edit Image',
      workflowName: 'Qwen Image Edit Cluster Proof',
      model,
      prompt: 'Technical Qwen Image Edit proof: replace the warm brass finish with cool polished silver.',
      seed: 44001,
      guidanceScale: 1,
      blockPlacementCount: 17,
      setGeometry: false,
      image: sourceImage,
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          edit: { sourceImage, ...edit },
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
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

test('live Qwen Image image-to-image Cluster persists, expands equivalently, and qualifies generation', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_QWEN_IMAGE_TO_IMAGE_CLUSTER !== '1',
    'The installed Qwen Image image-to-image Cluster qualification must be selected explicitly.',
  );
  test.setTimeout(4 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/qwen-image-to-image-cluster` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('qwen-image-to-image-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('qwen-image-to-image-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await ensureOptionalRuntime(page);

  const sourceImage =
    process.env.MODIFF_QWEN_IMAGE_SOURCE_IMAGE ??
    '@data/qualification/local-review/hugging-face-clusters/diffusers-ernie-equivalent-cluster-output.webp';
  const model: Model = {
    modelType: 'QwenImageModularPipeline',
    repo: 'Qwen/Qwen-Image-2512',
    revision: '25468b98e3276ca6700de15c6628e51b7de54a26',
  };
  const imageToImage = await runScenario(
    page,
    {
      id: 'qwen-image-to-image',
      label: 'Qwen Image — Image To Image',
      workflowName: 'Qwen Image Image-To-Image Cluster Proof',
      model,
      prompt: 'Technical Qwen Image proof: render the observatory as a compact blue ceramic scale model.',
      seed: 45001,
      guidanceScale: 1,
      blockPlacementCount: 16,
      image: sourceImage,
      strength: 0.65,
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          imageToImage: { sourceImage, ...imageToImage },
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
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

test('live Qwen Image inpaint Cluster persists, expands equivalently, and qualifies masked generation', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_QWEN_IMAGE_INPAINT_CLUSTER !== '1',
    'The installed Qwen Image inpaint Cluster qualification must be selected explicitly.',
  );
  test.setTimeout(4 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/qwen-image-inpaint-cluster` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('qwen-image-inpaint-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('qwen-image-inpaint-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await ensureOptionalRuntime(page);

  const sourceImage = '@data/images/qwen_inpaint_object_replace.reference_image_1.webp';
  const maskImage = '@data/images/qwen_inpaint_object_replace.mask_image.png';
  const model: Model = {
    modelType: 'QwenImageModularPipeline',
    repo: 'Qwen/Qwen-Image-2512',
    revision: '25468b98e3276ca6700de15c6628e51b7de54a26',
  };
  const inpaint = await runScenario(
    page,
    {
      id: 'qwen-image-inpaint',
      label: 'Qwen Image — Inpaint',
      workflowName: 'Qwen Image Inpaint Cluster Proof',
      model,
      prompt: 'Technical Qwen Image inpaint proof: replace the black box with a small cobalt-blue ceramic vase.',
      seed: 46001,
      guidanceScale: 1,
      blockPlacementCount: 18,
      image: sourceImage,
      mask: maskImage,
      strength: 0.8,
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          inpaint: { sourceImage, maskImage, ...inpaint },
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
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

test('live Qwen Image Edit inpaint Cluster persists, expands equivalently, and qualifies masked editing', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_QWEN_IMAGE_EDIT_INPAINT_CLUSTER !== '1',
    'The installed Qwen Image Edit inpaint Cluster qualification must be selected explicitly.',
  );
  test.setTimeout(4 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/qwen-image-edit-inpaint-cluster` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('qwen-image-edit-inpaint-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('qwen-image-edit-inpaint-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await ensureOptionalRuntime(page);

  const sourceImage = '@data/images/qwen_inpaint_object_replace.reference_image_1.webp';
  const maskImage = '@data/images/qwen_inpaint_object_replace.mask_image.png';
  const model: Model = {
    modelType: 'QwenImageEditModularPipeline',
    repo: 'Qwen/Qwen-Image-Edit',
    revision: 'ac7f9318f633fc4b5778c59367c8128225f1e3de',
  };
  const inpaint = await runScenario(
    page,
    {
      id: 'qwen-image-edit-inpaint',
      label: 'Qwen Image Edit — Inpaint',
      workflowName: 'Qwen Image Edit Inpaint Cluster Proof',
      model,
      prompt: 'Technical Qwen Image Edit inpaint proof: replace only the masked black box with a red ceramic vase.',
      seed: 47001,
      guidanceScale: 1,
      blockPlacementCount: 20,
      setGeometry: false,
      image: sourceImage,
      mask: maskImage,
      strength: 0.8,
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          inpaint: { sourceImage, maskImage, ...inpaint },
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
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

test('live Qwen Image Edit Plus Cluster persists its selected mode and qualifies single and multi-reference editing', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_QWEN_IMAGE_EDIT_PLUS_CLUSTER !== '1',
    'The installed Qwen Image Edit Plus Cluster qualification must be selected explicitly.',
  );
  test.setTimeout(4 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/qwen-image-edit-plus-cluster` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('qwen-image-edit-plus-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('qwen-image-edit-plus-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await ensureOptionalRuntime(page);

  const roomImage = '@data/images/qwen_inpaint_object_replace.reference_image_1.webp';
  const observatoryImage =
    '@data/qualification/local-review/hugging-face-clusters/diffusers-ernie-equivalent-cluster-output.webp';
  const model: Model = {
    modelType: 'QwenImageEditPlusModularPipeline',
    repo: 'Qwen/Qwen-Image-Edit-2511',
    revision: '6f3ccc0b56e431dc6a0c2b2039706d7d26f22cb9',
  };
  const singleEdit = await runScenario(
    page,
    {
      id: 'qwen-image-edit-plus-single',
      label: 'Qwen Image Edit Plus — Default',
      workflowName: 'Qwen Image Edit Plus Single Cluster Proof',
      model,
      studioMode: 'edit_image',
      prompt: 'Technical Qwen Image Edit Plus proof: replace the black box with a glossy teal ceramic vase.',
      seed: 48001,
      guidanceScale: 1,
      blockPlacementCount: 17,
      setGeometry: false,
      image: [roomImage],
    },
    evidenceRoot,
  );

  await page.getByTestId('topbar-new-workflow').click();
  const multiReferenceEdit = await runScenario(
    page,
    {
      id: 'qwen-image-edit-plus-multi-reference',
      label: 'Qwen Image Edit Plus — Default',
      workflowName: 'Qwen Image Edit Plus Multi-Reference Cluster Proof',
      model,
      studioMode: 'multi_image_reference_edit',
      prompt:
        'Technical multi-reference proof: place the brass observatory from the second image on the wooden table in the first image.',
      seed: 48002,
      guidanceScale: 1,
      blockPlacementCount: 17,
      setGeometry: false,
      image: [roomImage, observatoryImage],
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          singleEdit: { sourceImages: [roomImage], ...singleEdit },
          multiReferenceEdit: { sourceImages: [roomImage, observatoryImage], ...multiReferenceEdit },
          selectedModePersistedAcrossRefresh: true,
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
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

test('live Qwen Image Layered Cluster persists decomposition parameters and returns every requested RGBA layer', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_QWEN_IMAGE_LAYERED_CLUSTER !== '1',
    'The installed Qwen Image Layered Cluster qualification must be selected explicitly.',
  );
  test.setTimeout(4 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/qwen-image-layered-cluster` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('qwen-image-layered-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('qwen-image-layered-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await ensureOptionalRuntime(page);

  const sourceImage = '@data/images/qwen_inpaint_object_replace.reference_image_1.webp';
  const model: Model = {
    modelType: 'QwenImageLayeredModularPipeline',
    repo: 'Qwen/Qwen-Image-Layered',
    revision: '8f0ca708dfff6ba1dd5f2d85d78f8c108a040bcf',
  };
  const decomposition = await runScenario(
    page,
    {
      id: 'qwen-image-layered-decomposition',
      label: 'Qwen Image Layered — Layer Decomposition',
      workflowName: 'Qwen Image Layered Cluster Proof',
      model,
      prompt:
        'A yellow room with a wooden console table, ceramic bowl, red cloth, wicker basket, and black storage box.',
      seed: 49001,
      guidanceScale: 4,
      blockPlacementCount: 18,
      setGeometry: false,
      image: [sourceImage],
      layers: 3,
      resolution: 640,
      maxSequenceLength: 512,
      expectedMediaItemCount: 3,
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          decomposition: { sourceImage, ...decomposition },
          requestedLayers: 3,
          allRequestedLayersPreserved: true,
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
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

test('live Qwen Image ControlNet Clusters persist every control and route parameter and qualify all official workflows', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_QWEN_IMAGE_CONTROLNET_CLUSTERS !== '1',
    'The installed Qwen Image ControlNet Cluster qualification wave must be selected explicitly.',
  );
  test.setTimeout(6 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/qwen-image-controlnet-clusters` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('qwen-image-controlnet-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('qwen-image-controlnet-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await ensureOptionalRuntime(page);

  const controlImage = '@data/images/qwen_control_image_layout.control_image.png';
  const sourceImage = '@data/images/qwen_inpaint_object_replace.reference_image_1.webp';
  const maskImage = '@data/images/qwen_inpaint_object_replace.mask_image.png';
  const model: Model = {
    modelType: 'QwenImageModularPipeline',
    repo: 'Qwen/Qwen-Image-2512',
    revision: '25468b98e3276ca6700de15c6628e51b7de54a26',
  };
  const common = {
    model,
    controlImage,
    guidanceScale: 1,
    conditioningScale: 0.9,
    controlGuidanceStart: 0.1,
    controlGuidanceEnd: 0.85,
    maxSequenceLength: 512,
  } as const;

  const textToImage = await runScenario(
    page,
    {
      ...common,
      id: 'qwen-image-controlnet-text-to-image',
      label: 'Qwen Image — Control Image',
      workflowName: 'Qwen Image ControlNet Text-To-Image Cluster Proof',
      prompt: 'A compact red retro control console, front view, following the exact supplied line layout.',
      seed: 50001,
      blockPlacementCount: 16,
    },
    evidenceRoot,
  );

  await page.getByTestId('topbar-new-workflow').click();
  const imageToImage = await runScenario(
    page,
    {
      ...common,
      id: 'qwen-image-controlnet-image-to-image',
      label: 'Qwen Image — Controlnet Image2Image',
      workflowName: 'Qwen Image ControlNet Image-To-Image Cluster Proof',
      prompt: 'Transform the room into a clean industrial studio while following the supplied console layout.',
      seed: 50002,
      blockPlacementCount: 20,
      image: sourceImage,
      strength: 0.65,
    },
    evidenceRoot,
  );

  await page.getByTestId('topbar-new-workflow').click();
  const inpaint = await runScenario(
    page,
    {
      ...common,
      id: 'qwen-image-controlnet-inpaint',
      label: 'Qwen Image — Controlnet Inpainting',
      workflowName: 'Qwen Image ControlNet Inpaint Cluster Proof',
      prompt: 'Replace only the masked box with a compact blue console that follows the supplied line layout.',
      seed: 50003,
      blockPlacementCount: 22,
      image: sourceImage,
      mask: maskImage,
      strength: 0.8,
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          controlnet: {
            repo: 'InstantX/Qwen-Image-ControlNet-Union',
            revision: 'b13036f066d6dee7c20513e263d3d673055e9de8',
          },
          textToImage: { controlImage, ...textToImage },
          imageToImage: { sourceImage, controlImage, ...imageToImage },
          inpaint: { sourceImage, maskImage, controlImage, ...inpaint },
          exactControlParametersReachedExpandedExecutionNodes: true,
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
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

test('live Wan 2.1 1.3B Cluster persists the official Modular video controls and generates an MP4', async ({
  page,
}) => {
  const showcaseRequested = process.env.MODIFF_RUN_WAN_21_T2V_SHOWCASE === '1';
  test.skip(
    process.env.MODIFF_RUN_WAN_21_T2V_CLUSTER !== '1' && !showcaseRequested,
    'The installed Wan 2.1 1.3B Cluster qualification must be selected explicitly.',
  );
  test.setTimeout(4 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory
    ? `${outputDirectory}/${showcaseRequested ? 'wan-21-t2v-showcase' : 'wan-21-t2v-cluster'}`
    : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(
    (sessionKey) => {
      if (window.sessionStorage.getItem(sessionKey)) return;
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.sessionStorage.setItem(sessionKey, 'initialized');
    },
    showcaseRequested ? 'wan-21-t2v-showcase' : 'wan-21-t2v-cluster-proof',
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await startCleanWorkflow(page);
  await ensureOptionalRuntime(page);

  const model: Model = {
    modelType: 'WanModularPipeline',
    repo: 'Wan-AI/Wan2.1-T2V-1.3B-Diffusers',
    revision: '0fad780a534b6463e45facd96134c9f345acfa5b',
  };
  const video = await runScenario(
    page,
    {
      id: 'wan-21-text-to-video',
      label: 'Wan — Text To Video',
      workflowName: 'Wan 2.1 Text-To-Video Cluster Proof',
      model,
      prompt: showcaseRequested
        ? 'Low fixed camera, close product-cinematic shot. A large glossy red wind-up toy car fills most of the frame and races from the left foreground to the right across a gray tabletop. Its black wheels spin rapidly and visibly. The car strikes three large colored wooden blocks one after another; each block tips, falls, and slides across the table. Strong continuous lateral motion, crisp daylight, sharp subject, uncluttered pale studio background.'
        : 'A bright red toy cube rolls continuously from the left side of a gray tabletop to the right, static camera.',
      negativePrompt: showcaseRequested
        ? 'Bright tones, overexposed, static, blurred details, subtitles, painting, still picture, worst quality, low quality, JPEG artifacts, malformed body, extra limbs, fused fingers, walking backwards, crowded background, camera shake'
        : undefined,
      seed: showcaseRequested ? 280829 : 51001,
      guidanceScale: showcaseRequested ? 6 : 1,
      blockPlacementCount: 9,
      maxSequenceLength: 256,
      numFrames: showcaseRequested ? 81 : 9,
      fps: showcaseRequested ? 15 : 8,
      width: showcaseRequested ? 832 : undefined,
      height: showcaseRequested ? 480 : undefined,
      steps: showcaseRequested ? 50 : undefined,
      expectedDisplayType: 'video',
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          video,
          requestedFrames: showcaseRequested ? 81 : 9,
          fps: showcaseRequested ? 15 : 8,
          exactVideoControlsReachedExpandedExecutionNodes: true,
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
          showcaseCandidate: showcaseRequested,
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

test('live Wan showcase delivery upscale persists and runs through the frontend', async ({ page }) => {
  const sourceVideo = process.env.MODIFF_VIDEO_UPSCALE_SOURCE;
  test.skip(
    process.env.MODIFF_RUN_VIDEO_UPSCALE_DELIVERY !== '1' || !sourceVideo,
    'The reviewed native video and the delivery-upscale qualification must be selected explicitly.',
  );
  test.setTimeout(2 * 60 * 60 * 1000);
  const evidenceRoot = process.env.MODIFF_VIDEO_UPSCALE_EVIDENCE_DIR ?? null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('wan-showcase-delivery-upscale')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('wan-showcase-delivery-upscale', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await startCleanWorkflow(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await expect(autoToggle).toHaveAttribute('aria-checked', 'false');

  const capability = await page.evaluate(async () => {
    const response = await fetch('/model_capabilities');
    if (!response.ok) throw new Error(`Could not read model capabilities (${response.status}).`);
    const body = (await response.json()) as {
      capabilities?: Array<{
        modelType?: string;
        defaultRepo?: string;
        revisionCandidates?: string[];
        downloadFiles?: string[];
      }>;
    };
    return body.capabilities?.find((candidate) => candidate.modelType === 'SpandrelVideoUpscale') ?? null;
  });
  expect(capability).toMatchObject({
    defaultRepo: 'nateraw/real-esrgan',
    revisionCandidates: ['42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094'],
    downloadFiles: ['RealESRGAN_x2plus.pth'],
  });
  const installation = await ensureModelInstalledThroughFrontend(
    page,
    'SpandrelVideoUpscale',
    {
      repo: 'nateraw/real-esrgan',
      revision: '42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094',
    },
    evidenceRoot,
  );

  await page.evaluate(
    async ({ source }) => {
      const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
      await Promise.all([
        useNodesStore.getState().fetchStudioModelCapabilities(),
        useNodesStore.getState().refreshModelIndexes(true),
      ]);
      window.__MODIFF_E2E__!.setStudioFormForTest({
        modelType: 'SpandrelVideoUpscale',
        mode: 'video_upscale',
        resourceMode: 'expert',
        sourceVideo: source,
        device: 'cuda:0',
        fps: 15,
        autoOffload: false,
        offloadMode: 'none',
      });
      window.__MODIFF_E2E__!.openWorkspacePanelForTest('studio');
      await window.__MODIFF_E2E__!.startManagedGraphFinalizationForTest();
    },
    { source: sourceVideo! },
  );
  await expect(page.getByTestId('studio-panel')).toBeVisible();
  await expect(page.getByLabel('Source video path')).toHaveValue(sourceVideo!);

  const snapshot = async () =>
    page.evaluate(() => {
      const state = window.__MODIFF_E2E__!.getState();
      const binding = state.studio.graphBinding;
      if (!binding) return null;
      const node = (role: string) => state.flow.nodes.find((candidate) => candidate.id === binding.nodes?.[role]);
      const upscaler = node('videoUpscaler');
      const exporter = node('videoExport');
      const value = (roleNode: typeof upscaler, key: string) =>
        roleNode?.params?.[key]?.value ?? roleNode?.params?.[key]?.default;
      return {
        modelType: state.studio.form.modelType,
        mode: state.studio.form.mode,
        sourceVideo: state.studio.form.sourceVideo,
        receipt: binding.executionSpec,
        upscaler: {
          module: upscaler?.module,
          action: upscaler?.action,
          video: value(upscaler, 'video'),
          pipelineClass: value(upscaler, 'pipeline_class'),
          operation: value(upscaler, 'operation'),
          modelId: value(upscaler, 'model_id'),
          fps: value(upscaler, 'fps'),
        },
        exporter: {
          module: exporter?.module,
          action: exporter?.action,
          fps: value(exporter, 'fps'),
          quality: value(exporter, 'quality'),
        },
      };
    });

  const before = await snapshot();
  expect(before).toMatchObject({
    modelType: 'SpandrelVideoUpscale',
    mode: 'video_upscale',
    sourceVideo,
    receipt: {
      id: 'real-esrgan-x2-video-upscale:v1',
      contentHash: 'studio-spec-v1-231f621f',
      executionProfileId: 'real-esrgan-x2-video-upscale:direct',
    },
    upscaler: {
      module: 'modules.Video',
      action: 'UpscaleVideo',
      video: sourceVideo,
      pipelineClass: 'SpandrelVideoUpscaleV1',
      operation: 'video_upscale',
      fps: 15,
    },
    exporter: { module: 'modules.Video', action: 'Export', fps: 15 },
  });
  const inheritedDefaults = await page.evaluate(async () => {
    const response = await fetch('/nodes');
    if (!response.ok) throw new Error(`Could not read the live node contracts (${response.status}).`);
    const body = (await response.json()) as {
      nodes?: Record<string, { params?: Record<string, { default?: unknown }> }>;
    };
    return {
      modelId: body.nodes?.['modules.Video.UpscaleVideo']?.params?.model_id?.default,
      quality: body.nodes?.['modules.Video.Export']?.params?.quality?.default,
    };
  });
  expect(before?.upscaler.modelId ?? inheritedDefaults.modelId).toMatchObject({
    source: 'hub',
    value: 'nateraw/real-esrgan/RealESRGAN_x2plus.pth',
    revision: '42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094',
    byteSize: 67_061_725,
  });
  expect(before?.exporter.quality ?? inheritedDefaults.quality).toBe(8);

  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('Wan 2.1 Showcase Delivery Upscale');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await expect.poll(snapshot, { timeout: 30_000 }).toEqual(before);

  const submission = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByTestId('studio-run').click();
  const response = await submission;
  expect(response.ok()).toBe(true);
  const taskId = ((await response.json()) as { task_id?: string }).task_id;
  expect(taskId).toBeTruthy();

  let terminalTask: RunTask | null = null;
  let lastObservedTask: RunTask | null = null;
  const deadline = Date.now() + 90 * 60 * 1000;
  while (!terminalTask && Date.now() < deadline) {
    const queueResponse = await page.request.get('/queue').catch(() => null);
    if (queueResponse?.ok()) {
      const queue = (await queueResponse.json()) as {
        current?: RunTask | null;
        queued?: Record<string, RunTask>;
        recent?: RunTask[];
      };
      const task =
        (queue.current?.task_id === taskId ? queue.current : null) ??
        Object.values(queue.queued ?? {}).find((candidate) => candidate.task_id === taskId) ??
        queue.recent?.find((candidate) => candidate.task_id === taskId) ??
        null;
      lastObservedTask = task;
      if (task && ['completed', 'failed', 'cancelled'].includes(task.status ?? '')) terminalTask = task;
    }
    if (!terminalTask) await page.waitForTimeout(1000);
  }
  expect(terminalTask, `Last observed task: ${JSON.stringify(lastObservedTask)}`).toMatchObject({
    task_id: taskId,
    status: 'completed',
  });

  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const body = (await (await fetch('/studio_outputs?limit=200')).json()) as {
            outputs?: StudioOutput[];
          };
          return body.outputs?.find((item) => item.taskId === id && item.displayType === 'video') ?? null;
        }, taskId!),
      { timeout: 120_000, intervals: [500, 1000, 2000] },
    )
    .toMatchObject({ taskId, displayType: 'video' });
  const savedOutput = await page.evaluate(async (id) => {
    const body = (await (await fetch('/studio_outputs?limit=200')).json()) as { outputs?: StudioOutput[] };
    return body.outputs?.find((item) => item.taskId === id && item.displayType === 'video') ?? null;
  }, taskId!);
  expect(savedOutput).not.toBeNull();
  expect(savedOutput.mediaHash ?? savedOutput.mediaItems?.[0]?.mediaHash).toMatch(/^sha256:/u);

  if (evidenceRoot) {
    await page.screenshot({ path: `${evidenceRoot}/frontend-upscale-generated.png`, fullPage: true });
    const url = savedOutput.mediaItems?.[0]?.url ?? savedOutput.url;
    expect(url).toBeTruthy();
    const media = await page.request.get(url!);
    expect(media.ok()).toBe(true);
    await writeFile(`${evidenceRoot}/wan-21-text-to-video-upscaled-x2.mp4`, await media.body());
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          sourceVideo,
          model: capability,
          installation,
          beforeRefresh: before,
          afterRefresh: await snapshot(),
          taskId,
          output: savedOutput,
          generatedThroughVisibleFrontend: true,
          workflowPersistedAcrossRefresh: true,
          qualificationOnly: true,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live Wan 2.1 FLF2V Cluster persists both endpoint frames and generates an MP4', async ({ page }) => {
  test.skip(
    process.env.MODIFF_RUN_WAN_21_FLF_CLUSTER !== '1',
    'The installed Wan 2.1 FLF2V Cluster qualification must be selected explicitly.',
  );
  test.setTimeout(6 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/wan-21-flf-cluster` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('wan-21-flf-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('wan-21-flf-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await ensureOptionalRuntime(page);

  const firstFrame = '@data/images/qwen_inpaint_object_replace.reference_image_1.webp';
  const lastFrame = '@data/images/qwen_layered_portrait.reference_image_1.webp';
  const model: Model = {
    modelType: 'WanImage2VideoModularPipeline',
    repo: 'Wan-AI/Wan2.1-FLF2V-14B-720P-diffusers',
    revision: '17c30769b1e0b5dcaa1799b117bf20a9c31f59d7',
  };
  const video = await runScenario(
    page,
    {
      id: 'wan-21-first-last-frame-to-video',
      label: 'Wan Image2 Video — Flf2V',
      workflowName: 'Wan 2.1 First-Last-Frame Cluster Proof',
      model,
      prompt:
        'A continuous cinematic transition from a warm yellow interior into a blue mountaintop observatory at dusk.',
      seed: 52001,
      guidanceScale: 1,
      blockPlacementCount: 17,
      image: firstFrame,
      lastImage: lastFrame,
      maxSequenceLength: 256,
      numFrames: 9,
      fps: 8,
      expectedDisplayType: 'video',
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          video: { firstFrame, lastFrame, ...video },
          requestedFrames: 9,
          fps: 8,
          exactEndpointFramesReachedDistinctExpandedLoaders: true,
          exactVideoControlsReachedExpandedExecutionNodes: true,
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
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

test('live Wan 2.1 single-image-to-video Cluster installs through Model Manager and generates an MP4', async ({
  page,
}) => {
  const showcaseRequested = process.env.MODIFF_RUN_WAN_21_I2V_SHOWCASE === '1';
  test.skip(
    process.env.MODIFF_RUN_WAN_21_I2V_CLUSTER !== '1' && !showcaseRequested,
    'The Wan 2.1 480P single-image Cluster installation and qualification must be selected explicitly.',
  );
  test.setTimeout(6 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory
    ? `${outputDirectory}/${showcaseRequested ? 'wan-21-i2v-showcase' : 'wan-21-i2v-cluster'}`
    : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(
    (sessionKey) => {
      if (window.sessionStorage.getItem(sessionKey)) return;
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.sessionStorage.setItem(sessionKey, 'initialized');
    },
    showcaseRequested ? 'wan-21-i2v-showcase' : 'wan-21-i2v-cluster-proof',
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await startCleanWorkflow(page);
  await ensureOptionalRuntime(page);

  const sourceImage = showcaseRequested
    ? '@data/images/wan-21-i2v-observatory-source.webp'
    : '@data/images/qwen_inpaint_object_replace.reference_image_1.webp';
  const model: Model = {
    modelType: 'WanImage2VideoModularPipeline',
    repo: 'Wan-AI/Wan2.1-I2V-14B-480P-Diffusers',
    revision: 'b184e23a8a16b20f108f727c902e769e873ffc73',
  };
  const installation = await ensureModelInstalledThroughFrontend(page, model.modelType, model, evidenceRoot);
  const video = await runScenario(
    page,
    {
      id: 'wan-21-single-image-to-video',
      label: 'Wan Image2 Video — Image To Video',
      workflowName: showcaseRequested
        ? 'Wan 2.1 I2V 14B Observatory Showcase'
        : 'Wan 2.1 Single-Image-To-Video Cluster Proof',
      model,
      prompt: showcaseRequested
        ? 'The camera makes a slow, steady push forward toward the telescope. Rain beads slide smoothly down the glass while palm leaves outside sway gently in a light breeze. The warm lamplight remains constant and the observatory structure stays rigid and unchanged.'
        : 'A slow cinematic camera push toward the black box while the folded red cloth moves in a gentle breeze.',
      negativePrompt: showcaseRequested
        ? 'Bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, deformed, disfigured, misshapen structures, still picture, messy background, flicker, frame jumps, abrupt camera movement, camera shake, duplicated objects, disappearing objects, inconsistent geometry'
        : undefined,
      seed: showcaseRequested ? 280830 : 53001,
      guidanceScale: showcaseRequested ? 5 : 1,
      blockPlacementCount: 15,
      image: sourceImage,
      maxSequenceLength: showcaseRequested ? 512 : 256,
      // The official 81-frame/50-step recipe benchmarks at roughly 9.5 hours
      // on this ROCm APU. Keep Wan's valid 4k+1 frame contract and all other
      // official controls while bounding the visible qualification below five
      // hours for iterative human review.
      numFrames: showcaseRequested ? 49 : 9,
      fps: showcaseRequested ? 16 : 8,
      width: showcaseRequested ? 832 : undefined,
      height: showcaseRequested ? 480 : undefined,
      steps: showcaseRequested ? 30 : undefined,
      expectedDisplayType: 'video',
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          installation: {
            installedThroughVisibleModelManagerDuringTest: installation.installedDuringTest,
            exactFileCount: installation.capability?.downloadFiles?.length,
          },
          video: { sourceImage, ...video },
          requestedFrames: showcaseRequested ? 49 : 9,
          fps: showcaseRequested ? 16 : 8,
          parameters: showcaseRequested
            ? {
                width: 832,
                height: 480,
                numInferenceSteps: 30,
                guidanceScale: 5,
                maxSequenceLength: 512,
                seed: 280830,
                profileRationale:
                  'Official 81-frame/50-step recipe measured about 11.5 minutes per step on this ROCm APU; 49 frames and 30 steps bound the review run while retaining native size, CFG, and fps.',
              }
            : undefined,
          exactSourceImageReachedExpandedLoader: true,
          exactVideoControlsReachedExpandedExecutionNodes: true,
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
          showcaseCandidate: showcaseRequested,
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

test('live Wan 2.2 A14B image-to-video Cluster preserves reviewed controls and generates visible motion', async ({
  page,
}) => {
  const canaryRequested = process.env.MODIFF_RUN_WAN_22_I2V_MOTION_CANARY === '1';
  const showcaseRequested = process.env.MODIFF_RUN_WAN_22_I2V_SHOWCASE === '1';
  test.skip(
    !canaryRequested && !showcaseRequested,
    'The Wan 2.2 A14B I2V Cluster installation and motion qualification must be selected explicitly.',
  );
  test.setTimeout(12 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceDirectory = showcaseRequested ? 'wan-22-i2v-guitar-showcase' : 'wan-22-i2v-guitar-canary';
  const evidenceRoot = outputDirectory ? `${outputDirectory}/${evidenceDirectory}` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(
    (sessionKey) => {
      if (window.sessionStorage.getItem(sessionKey)) return;
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.sessionStorage.setItem(sessionKey, 'initialized');
    },
    showcaseRequested ? 'wan-22-i2v-guitar-showcase' : 'wan-22-i2v-guitar-canary',
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await startCleanWorkflow(page);
  await ensureOptionalRuntime(page);

  const model: Model = {
    modelType: 'Wan22Image2VideoModularPipeline',
    repo: 'Wan-AI/Wan2.2-I2V-A14B-Diffusers',
    revision: '596658fd9ca6b7b71d5057529bbf319ecbc61d74',
  };
  const sourceImage = '@data/images/wan-22-i2v-guitar-man.png';
  const prompt =
    'A man continuously plays the red electric guitar. His picking hand strums the strings in a clear steady rhythm while his fretting hand moves between chords along the neck. He nods gently to the beat. The camera remains fixed.';
  const negativePrompt =
    'static, frozen pose, still image, no hand movement, blurry, low quality, distorted hands, extra fingers, warped guitar, flicker, frame jumps, camera shake';
  const parameters = showcaseRequested
    ? { numFrames: 81, steps: 40, seed: 280832 }
    : { numFrames: 81, steps: 12, seed: 280831 };
  const installation = await ensureModelInstalledThroughFrontend(page, model.modelType, model, evidenceRoot);
  const video = await runScenario(
    page,
    {
      id: showcaseRequested ? 'wan-22-i2v-guitar-showcase' : 'wan-22-i2v-guitar-canary',
      label: 'Wan22 Image2 Video — Image To Video',
      workflowName: showcaseRequested ? 'Wan 2.2 A14B Guitar Motion Showcase' : 'Wan 2.2 A14B Guitar Motion Canary',
      model,
      prompt,
      negativePrompt,
      seed: parameters.seed,
      guidanceScale: 3.5,
      guidanceScale2: 3.5,
      blockPlacementCount: 13,
      image: sourceImage,
      maxSequenceLength: 512,
      numFrames: parameters.numFrames,
      fps: 16,
      width: 832,
      height: 480,
      steps: parameters.steps,
      offloadMode: 'group_disk',
      expectedDisplayType: 'video',
      standardExecutor: {
        role: 'wanPipeline',
        module: 'modules.DiffusersVideo',
        action: 'LoadPipeline',
        pipelineClass: 'WanImageToVideoPipeline',
        executionProfileId: 'wan22-i2v:equivalent-standard',
      },
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          installation: {
            installedThroughVisibleModelManagerDuringTest: installation.installedDuringTest,
            exactFileCount: installation.capability?.downloadFiles?.length,
          },
          video: { sourceImage, ...video },
          prompt,
          negativePrompt,
          parameters: {
            width: 832,
            height: 480,
            numFrames: parameters.numFrames,
            numInferenceSteps: parameters.steps,
            guidanceScale: 3.5,
            guidanceScale2: 3.5,
            maxSequenceLength: 512,
            fps: 16,
            seed: parameters.seed,
          },
          officialFullRecipe: { width: 832, height: 480, numFrames: 81, numInferenceSteps: 40, fps: 16 },
          exactSourceImageReachedExpandedLoader: true,
          exactVideoControlsReachedExpandedExecutionNodes: true,
          collapsedExpandedGraphEquivalent: true,
          promptFollowsOfficialUnder100WordDynamicContentGuidance: true,
          fixedCameraMakesSubjectMotionAuditable: true,
          publicationUnchangedPendingApproval: true,
          showcaseCandidate: showcaseRequested,
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

test('live Wan 2.2 TI2V 5B standard Diffusers Cluster persists its official recipe and generates video', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_WAN_22_TI2V_5B_CLUSTER !== '1',
    'The cached Wan 2.2 TI2V 5B standard Diffusers Cluster qualification must be selected explicitly.',
  );
  test.setTimeout(6 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/wan-22-ti2v-5b-cluster` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('wan-22-ti2v-5b-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('wan-22-ti2v-5b-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await startCleanWorkflow(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await ensureOptionalRuntime(page);

  const model: Model = {
    modelType: 'WanTI2VPipeline',
    repo: 'Wan-AI/Wan2.2-TI2V-5B-Diffusers',
    revision: 'b8fff7315c768468a5333511427288870b2e9635',
  };
  // Start from the publisher's demonstrated motion prompt instead of an
  // unqualified hand-and-drumstick composition.  The extra shot direction is
  // deliberately small so the official example remains the semantic anchor.
  const prompt =
    'Two anthropomorphic cats in comfy boxing gear and bright gloves fight intensely on a spotlighted stage. They exchange clear punches, duck, and circle each other in a medium full-body shot while the camera remains steady.';
  const negativePrompt =
    '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走，flicker, frame jumps, abrupt camera movement';
  const installation = await ensureModelInstalledThroughFrontend(page, model.modelType, model, evidenceRoot);
  const video = await runScenario(
    page,
    {
      id: 'wan-22-ti2v-5b-cluster',
      label: 'Wan 2.2 TI2V 5B — Text to Video',
      workflowName: 'Wan 2.2 TI2V 5B Boxing Showcase',
      model,
      prompt,
      negativePrompt,
      seed: 280833,
      guidanceScale: 5,
      shift: 4.5,
      blockPlacementCount: 5,
      maxSequenceLength: 512,
      numFrames: 121,
      fps: 24,
      width: 1280,
      height: 704,
      steps: 50,
      offloadMode: 'model_cpu',
      expectedDisplayType: 'video',
      standardExecutor: {
        role: 'wanPipeline',
        module: 'modules.DiffusersVideo',
        action: 'LoadPipeline',
        pipelineClass: 'WanTI2VPipeline',
        executionProfileId: 'wan-22-ti2v-5b:direct',
      },
      expandedExecutionEdit: {
        role: 'wanGenerate',
        field: 'scheduler_flow_shift',
        value: 5,
        bindingSource: 'shift',
      },
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          installation: {
            installedThroughVisibleModelManagerDuringTest: installation.installedDuringTest,
            exactFileCount: installation.capability?.downloadFiles?.length,
          },
          video,
          prompt,
          negativePrompt,
          parameters: {
            width: 1280,
            height: 704,
            numFrames: 121,
            numInferenceSteps: 50,
            guidanceScale: 5,
            schedulerFlowShift: 5,
            maxSequenceLength: 512,
            fps: 24,
            seed: 280833,
            offloadMode: 'model_cpu',
          },
          followsPinnedOfficialDiffusersRecipe: true,
          standardDiffusersCompositeNotModularHierarchy: true,
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
          showcaseCandidate: true,
          showcaseApproved: false,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live Wan 2.2 TI2V 5B Cluster generates a reviewable continuous-motion showcase through the frontend', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_WAN_22_TI2V_5B_MOTION_SHOWCASE !== '1',
    'The Wan 2.2 TI2V 5B continuous-motion showcase must be selected explicitly.',
  );
  test.setTimeout(6 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/wan-22-ti2v-5b-motion-showcase` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('wan-22-ti2v-5b-motion-showcase')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('wan-22-ti2v-5b-motion-showcase', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await startCleanWorkflow(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await ensureOptionalRuntime(page);

  const model: Model = {
    modelType: 'WanTI2VPipeline',
    repo: 'Wan-AI/Wan2.2-TI2V-5B-Diffusers',
    revision: 'b8fff7315c768468a5333511427288870b2e9635',
  };
  const prompt =
    'A fixed wide cinematic shot at golden hour. A bright red vintage tram enters from the far left, travels smoothly across the entire frame on coastal rails, and continues toward the far right at a constant speed. Its steel wheels rotate clearly. Tall foreground grass bends continuously in the sea breeze and ocean waves roll behind it. One uninterrupted shot, stable geometry, consistent lighting, natural motion blur, no camera movement.';
  const negativePrompt =
    '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，畸形的，毁容的，形态畸形的肢体，静止不动的画面，杂乱的背景，frozen frame, duplicated frames, slideshow, temporal flicker, frame jumps, abrupt cuts, camera shake, warped rails, deformed wheels, morphing vehicle';
  const installation = await ensureModelInstalledThroughFrontend(page, model.modelType, model, evidenceRoot);
  const video = await runScenario(
    page,
    {
      id: 'wan-22-ti2v-5b-motion-showcase',
      label: 'Wan 2.2 TI2V 5B — Text to Video',
      workflowName: 'Wan 2.2 TI2V 5B Continuous Motion Showcase',
      model,
      prompt,
      negativePrompt,
      visiblePromptEdit: true,
      seed: 280834,
      guidanceScale: 5,
      shift: 4.5,
      quantizationMode: 'none',
      blockPlacementCount: 5,
      maxSequenceLength: 512,
      numFrames: 121,
      fps: 24,
      width: 1280,
      height: 704,
      steps: 50,
      offloadMode: 'model_cpu',
      expectedDisplayType: 'video',
      standardExecutor: {
        role: 'wanPipeline',
        module: 'modules.DiffusersVideo',
        action: 'LoadPipeline',
        pipelineClass: 'WanTI2VPipeline',
        executionProfileId: 'wan-22-ti2v-5b:direct',
      },
      // The pinned snapshot scheduler_config.json specifies flow_shift 5.0.
      // Editing it through the expanded ordinary execution node proves that
      // the final creator-compatible value survives Save and browser refresh.
      expandedExecutionEdit: {
        role: 'wanGenerate',
        field: 'scheduler_flow_shift',
        value: 5,
        bindingSource: 'shift',
      },
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          installation: {
            path: 'visible Model Manager -> POST /hf_download -> huggingface_hub.snapshot_download',
            installedThroughVisibleModelManagerDuringTest: installation.installedDuringTest,
            exactFileCount: installation.capability?.downloadFiles?.length,
            wgetUsed: false,
          },
          video,
          prompt,
          negativePrompt,
          parameters: {
            width: 1280,
            height: 704,
            numFrames: 121,
            numInferenceSteps: 50,
            guidanceScale: 5,
            schedulerFlowShift: 5,
            maxSequenceLength: 512,
            fps: 24,
            seed: 280834,
            dtype: 'bfloat16',
            quantizationMode: 'none',
            offloadMode: 'model_cpu',
          },
          research: {
            modelCard: `https://huggingface.co/${model.repo}/blob/${model.revision}/README.md`,
            officialRecipePreserved: true,
            motionPromptPolicy:
              'Rigid subject crossing a fixed wide frame with explicit continuous secondary motion and no cuts.',
          },
          lifecycle: {
            insertedFromVisibleNodeLibrary: true,
            promptEditedInVisibleClusterControl: true,
            expandedExecutionParameterEdited: true,
            savedRefreshedAndCompared: true,
            submittedWithVisibleTopBarRun: true,
          },
          publicationUnchangedPendingApproval: true,
          showcaseCandidate: true,
          showcaseApproved: false,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});

test('live ERNIE Image Cluster persists, expands equivalently, and generates through its reviewed Diffusers executor', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_ERNIE_IMAGE_CLUSTER !== '1',
    'The cached ERNIE Image equivalent-standard Cluster qualification must be selected explicitly.',
  );
  test.setTimeout(2 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/ernie-image-cluster` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('ernie-image-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('ernie-image-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await ensureOptionalRuntime(page);

  const model: Model = {
    modelType: 'ErnieImageModularPipeline',
    repo: 'baidu/ERNIE-Image-Turbo',
    revision: 'bc68c81e2a1730a394d5fc9fae70713dee940140',
  };
  const installation = await ensureModelInstalledThroughFrontend(page, model.modelType, model, evidenceRoot);
  const image = await runScenario(
    page,
    {
      id: 'ernie-image-text-to-image',
      label: 'Ernie Image — Text To Image',
      workflowName: 'ERNIE Image Cluster Proof',
      model,
      prompt: 'Technical ERNIE Cluster proof: a tiny brass observatory under a clear night sky.',
      seed: 54001,
      guidanceScale: 1,
      blockPlacementCount: 9,
      width: 1024,
      height: 1024,
      steps: 1,
      standardExecutor: {
        role: 'diffusersImagePipeline',
        module: 'modules.DiffusersImage',
        action: 'LoadPipeline',
        pipelineClass: 'ErnieImagePipeline',
        executionProfileId: 'ernie-image:equivalent-standard',
      },
    },
    evidenceRoot,
  );

  if (evidenceRoot) {
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          installation: {
            installedThroughVisibleModelManagerDuringTest: installation.installedDuringTest,
            exactFileCount: installation.capability?.downloadFiles?.length,
          },
          image,
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
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

test('remaining admitted SDXL Clusters persist edited block parameters, expand equivalently, and generate', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_SDXL_REMAINING_CLUSTERS !== '1',
    'The cached SDXL remaining-route qualification wave must be selected explicitly.',
  );
  test.setTimeout(8 * 60 * 60 * 1000);
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  const evidenceRoot = outputDirectory ? `${outputDirectory}/sdxl-remaining-clusters` : null;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('sdxl-remaining-cluster-proof')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('sdxl-remaining-cluster-proof', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  const autoToggle = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoToggle.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await ensureOptionalRuntime(page);

  const model: Model = {
    modelType: 'StableDiffusionXLModularPipeline',
    repo: 'stabilityai/stable-diffusion-xl-base-1.0',
    revision: '462165984030d82259a11f4367a4eed129e94a7b',
  };
  const sourceImage = '@data/images/output-sdxl.webp';
  const controlImage = '@data/images/flux_control_canny.control_image.png';
  const mask = '@data/images/flux_fill_inpaint.mask_image.png';
  const ipAdapterImage = '@data/images/source.png';
  const common = {
    model,
    seed: 55001,
    guidanceScale: 1,
    width: 256,
    height: 256,
    steps: 2,
    dtype: 'float16' as const,
  };
  const scenarios: Scenario[] = [
    {
      ...common,
      id: 'sdxl-text-to-image',
      label: 'Stable Diffusion XL — Text To Image',
      workflowName: 'SDXL Text-to-Image Cluster Proof',
      prompt: 'Technical persistence proof: a blue ceramic robot on a clean studio backdrop.',
      blockPlacementCount: 10,
      studioMode: 'text_to_image',
    },
    {
      ...common,
      id: 'sdxl-image-to-image',
      label: 'Stable Diffusion XL — Image To Image',
      workflowName: 'SDXL Image-to-Image Cluster Proof',
      prompt: 'Technical persistence proof: restyle the source as blue ceramic while preserving its composition.',
      blockPlacementCount: 11,
      studioMode: 'edit_image',
      image: sourceImage,
      dtypeAsParameter: true,
      strength: 0.72,
    },
    {
      ...common,
      id: 'sdxl-inpainting',
      label: 'Stable Diffusion XL — Inpaint',
      workflowName: 'SDXL Inpainting Cluster Proof',
      prompt: 'Technical persistence proof: replace only the masked area with a small polished red sphere.',
      blockPlacementCount: 11,
      studioMode: 'inpaint',
      image: sourceImage,
      dtypeAsParameter: true,
      mask,
      strength: 0.72,
    },
    {
      ...common,
      id: 'sdxl-controlnet-text-to-image',
      label: 'Stable Diffusion XL — Control Image',
      workflowName: 'SDXL ControlNet Text-to-Image Cluster Proof',
      prompt: 'Technical persistence proof: a modernist house following the control image composition.',
      blockPlacementCount: 11,
      studioMode: 'control_image',
      controlImage,
      conditioningScale: 0.7,
      controlGuidanceStart: 0,
      controlGuidanceEnd: 1,
    },
    {
      ...common,
      id: 'sdxl-controlnet-image-to-image',
      label: 'Stable Diffusion XL — Control Edit Image',
      workflowName: 'SDXL ControlNet Image-to-Image Cluster Proof',
      prompt: 'Technical persistence proof: refine the source while preserving the control structure.',
      blockPlacementCount: 12,
      studioMode: 'control_edit_image',
      image: sourceImage,
      dtypeAsParameter: true,
      controlImage,
      conditioningScale: 0.7,
      controlGuidanceStart: 0,
      controlGuidanceEnd: 1,
      strength: 0.72,
    },
    {
      ...common,
      id: 'sdxl-controlnet-inpainting',
      label: 'Stable Diffusion XL — Control Inpaint',
      workflowName: 'SDXL ControlNet Inpainting Cluster Proof',
      prompt: 'Technical persistence proof: replace the masked area while retaining the control structure.',
      blockPlacementCount: 12,
      studioMode: 'control_inpaint',
      image: sourceImage,
      dtypeAsParameter: true,
      mask,
      controlImage,
      conditioningScale: 0.7,
      controlGuidanceStart: 0,
      controlGuidanceEnd: 1,
      strength: 0.72,
    },
    {
      ...common,
      id: 'sdxl-controlnet-union-text-to-image',
      label: 'Stable Diffusion XL — Controlnet Union Text2Image',
      workflowName: 'SDXL ControlNet Union Text-to-Image Cluster Proof',
      prompt: 'Technical persistence proof: a modernist house following the Union control image.',
      blockPlacementCount: 11,
      studioMode: 'control_union_image',
      controlImage,
      controlMode: 0,
      conditioningScale: 0.7,
      controlGuidanceStart: 0,
      controlGuidanceEnd: 1,
    },
    {
      ...common,
      id: 'sdxl-ip-adapter-text-to-image',
      label: 'Stable Diffusion XL — Ip Adapter Text2Image',
      workflowName: 'SDXL IP-Adapter Text-to-Image Cluster Proof',
      prompt: 'Technical persistence proof: a blue ceramic robot in the reference image visual language.',
      blockPlacementCount: 11,
      studioMode: 'ip_adapter_image',
      ipAdapterImage,
      ipAdapterScale: 0.65,
      guidanceScale: 5,
    },
    {
      ...common,
      id: 'sdxl-ip-adapter-controlnet-union-inpainting',
      label: 'Stable Diffusion XL — Ip Adapter Controlnet Union Inpainting',
      workflowName: 'SDXL IP-Adapter ControlNet Union Inpainting Cluster Proof',
      prompt: 'Technical persistence proof: replace the masked area while respecting both references.',
      blockPlacementCount: 13,
      studioMode: 'ip_adapter_control_union_inpaint',
      image: sourceImage,
      dtypeAsParameter: true,
      mask,
      controlImage,
      controlMode: 0,
      ipAdapterImage,
      ipAdapterScale: 0.65,
      guidanceScale: 5,
      conditioningScale: 0.7,
      controlGuidanceStart: 0,
      controlGuidanceEnd: 1,
      strength: 0.72,
    },
    {
      ...common,
      id: 'sdxl-controlnet-union-image-to-image',
      label: 'Stable Diffusion XL — Controlnet Union Image2Image',
      workflowName: 'SDXL ControlNet Union Image-to-Image Proof',
      prompt: 'Technical persistence proof: restyle the source as blue ceramic while preserving its composition.',
      blockPlacementCount: 12,
      studioMode: 'control_union_edit_image',
      image: sourceImage,
      dtypeAsParameter: true,
      controlImage,
      controlMode: 0,
      conditioningScale: 0.7,
      controlGuidanceStart: 0,
      controlGuidanceEnd: 1,
      strength: 0.72,
    },
    {
      ...common,
      id: 'sdxl-controlnet-union-inpainting',
      label: 'Stable Diffusion XL — Controlnet Union Inpainting',
      workflowName: 'SDXL ControlNet Union Inpainting Proof',
      prompt: 'Technical persistence proof: replace only the masked area with a small polished red sphere.',
      blockPlacementCount: 12,
      studioMode: 'control_union_inpaint',
      image: sourceImage,
      dtypeAsParameter: true,
      mask,
      controlImage,
      controlMode: 0,
      conditioningScale: 0.7,
      controlGuidanceStart: 0,
      controlGuidanceEnd: 1,
      strength: 0.72,
    },
    {
      ...common,
      id: 'sdxl-ip-adapter-image-to-image',
      label: 'Stable Diffusion XL — Ip Adapter Image2Image',
      workflowName: 'SDXL IP-Adapter Image-to-Image Proof',
      prompt: 'Technical persistence proof: restyle the source using the reference image palette.',
      blockPlacementCount: 12,
      studioMode: 'ip_adapter_edit_image',
      image: sourceImage,
      dtypeAsParameter: true,
      ipAdapterImage,
      ipAdapterScale: 0.65,
      guidanceScale: 5,
      strength: 0.72,
    },
    {
      ...common,
      id: 'sdxl-ip-adapter-inpainting',
      label: 'Stable Diffusion XL — Ip Adapter Inpainting',
      workflowName: 'SDXL IP-Adapter Inpainting Proof',
      prompt: 'Technical persistence proof: fill the masked region using the reference image style.',
      blockPlacementCount: 12,
      studioMode: 'ip_adapter_inpaint',
      image: sourceImage,
      dtypeAsParameter: true,
      mask,
      ipAdapterImage,
      ipAdapterScale: 0.65,
      guidanceScale: 5,
      strength: 0.72,
    },
    {
      ...common,
      id: 'sdxl-ip-adapter-controlnet-text-to-image',
      label: 'Stable Diffusion XL — Ip Adapter Controlnet Text2Image',
      workflowName: 'SDXL IP-Adapter ControlNet Text-to-Image Proof',
      prompt: 'Technical persistence proof: a modernist house following the control image composition.',
      blockPlacementCount: 12,
      studioMode: 'ip_adapter_control_image',
      controlImage,
      ipAdapterImage,
      ipAdapterScale: 0.65,
      guidanceScale: 5,
      conditioningScale: 0.7,
      controlGuidanceStart: 0,
      controlGuidanceEnd: 1,
    },
    {
      ...common,
      id: 'sdxl-ip-adapter-controlnet-image-to-image',
      label: 'Stable Diffusion XL — Ip Adapter Controlnet Image2Image',
      workflowName: 'SDXL IP-Adapter ControlNet Image-to-Image Proof',
      prompt: 'Technical persistence proof: refine the source while preserving the control structure.',
      blockPlacementCount: 13,
      studioMode: 'ip_adapter_control_edit_image',
      image: sourceImage,
      dtypeAsParameter: true,
      controlImage,
      ipAdapterImage,
      ipAdapterScale: 0.65,
      guidanceScale: 5,
      conditioningScale: 0.7,
      controlGuidanceStart: 0,
      controlGuidanceEnd: 1,
      strength: 0.72,
    },
    {
      ...common,
      id: 'sdxl-ip-adapter-controlnet-inpainting',
      label: 'Stable Diffusion XL — Ip Adapter Controlnet Inpainting',
      workflowName: 'SDXL IP-Adapter ControlNet Inpainting Proof',
      prompt: 'Technical persistence proof: replace the masked area while respecting both references.',
      blockPlacementCount: 13,
      studioMode: 'ip_adapter_control_inpaint',
      image: sourceImage,
      dtypeAsParameter: true,
      mask,
      controlImage,
      ipAdapterImage,
      ipAdapterScale: 0.65,
      guidanceScale: 5,
      conditioningScale: 0.7,
      controlGuidanceStart: 0,
      controlGuidanceEnd: 1,
      strength: 0.72,
    },
    {
      ...common,
      id: 'sdxl-ip-adapter-controlnet-union-text-to-image',
      label: 'Stable Diffusion XL — Ip Adapter Controlnet Union Text2Image',
      workflowName: 'SDXL IP-Adapter ControlNet Union Text-to-Image Proof',
      prompt: 'Technical persistence proof: a modernist house with the reference image visual language.',
      blockPlacementCount: 12,
      studioMode: 'ip_adapter_control_union_image',
      controlImage,
      controlMode: 0,
      ipAdapterImage,
      ipAdapterScale: 0.65,
      guidanceScale: 5,
      conditioningScale: 0.7,
      controlGuidanceStart: 0,
      controlGuidanceEnd: 1,
    },
    {
      ...common,
      id: 'sdxl-ip-adapter-controlnet-union-image-to-image',
      label: 'Stable Diffusion XL — Ip Adapter Controlnet Union Image2Image',
      workflowName: 'SDXL IP-Adapter ControlNet Union Image-to-Image Proof',
      prompt: 'Technical persistence proof: restyle the source while retaining its exact controlled layout.',
      blockPlacementCount: 13,
      studioMode: 'ip_adapter_control_union_edit_image',
      image: sourceImage,
      dtypeAsParameter: true,
      controlImage,
      controlMode: 0,
      ipAdapterImage,
      ipAdapterScale: 0.65,
      guidanceScale: 5,
      conditioningScale: 0.7,
      controlGuidanceStart: 0,
      controlGuidanceEnd: 1,
      strength: 0.72,
    },
  ];
  const selectedId = process.env.MODIFF_SDXL_CLUSTER_SCENARIO;
  const selectedSet = process.env.MODIFF_SDXL_CLUSTER_SET;
  const baselineIds = new Set([
    'sdxl-text-to-image',
    'sdxl-image-to-image',
    'sdxl-inpainting',
    'sdxl-controlnet-text-to-image',
    'sdxl-controlnet-image-to-image',
    'sdxl-controlnet-inpainting',
    'sdxl-controlnet-union-text-to-image',
    'sdxl-ip-adapter-text-to-image',
    'sdxl-ip-adapter-controlnet-union-inpainting',
  ]);
  const selectedScenarios = selectedId
    ? scenarios.filter((scenario) => scenario.id === selectedId)
    : selectedSet === 'baseline'
      ? scenarios.filter((scenario) => baselineIds.has(scenario.id))
      : selectedSet === 'ip-adapter-reuse'
        ? scenarios.filter((scenario) =>
            ['sdxl-ip-adapter-text-to-image', 'sdxl-ip-adapter-controlnet-union-inpainting'].includes(scenario.id),
          )
        : scenarios;
  expect(selectedScenarios, `Unknown MODIFF_SDXL_CLUSTER_SCENARIO=${selectedId ?? ''}`).not.toHaveLength(0);
  const results: Record<string, unknown> = {};

  for (const [index, scenario] of selectedScenarios.entries()) {
    if (index > 0) await page.getByTestId('topbar-new-workflow').click();
    const scenarioResult = await runScenario(page, scenario, evidenceRoot);
    results[scenario.id] = scenarioResult;
    if (evidenceRoot) {
      await writeFile(
        `${evidenceRoot}/${scenario.id}-frontend-result.json`,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            model,
            selectedScenario: scenario.id,
            sourceAssets: { sourceImage, controlImage, mask, ipAdapterImage },
            result: scenarioResult,
            editedParametersPersistedAcrossRefresh: true,
            collapsedExpandedGraphEquivalent: true,
            publicationUnchangedPendingApproval: true,
            qualificationOnly: true,
            showcaseApproved: false,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    }
  }

  if (evidenceRoot) {
    const receiptName = selectedId ? `${selectedId}-frontend-result.json` : 'frontend-result.json';
    await writeFile(
      `${evidenceRoot}/${receiptName}`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          model,
          selectedScenario: selectedId ?? null,
          sourceAssets: { sourceImage, controlImage, mask, ipAdapterImage },
          results,
          editedParametersPersistedAcrossRefresh: true,
          collapsedExpandedGraphEquivalent: true,
          publicationUnchangedPendingApproval: true,
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
