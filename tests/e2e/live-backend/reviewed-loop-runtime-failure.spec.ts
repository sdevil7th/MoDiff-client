import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

test('an invalid iteration input fails visibly at the exact Qwen loop without changing the saved draft', async ({
  page,
}) => {
  test.skip(process.env.MODIFF_QWEN_RUNTIME_FAILURE !== '1', 'Requires the completed full-setting loop proof.');
  test.setTimeout(35 * 60_000);
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR!;
  const evidence = `${directory}/runtime-failure`;
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await mkdir(evidence, { recursive: true });
  const submitted = JSON.parse(await readFile(`${directory}/qwen-composed/submitted-workflow.json`, 'utf8'));
  const backend = process.env.MODIFF_LIVE_BACKEND_URL ?? 'http://127.0.0.1:8088';
  const queue = await page.request.get(`${backend}/queue`);
  expect((await queue.json()).current, 'Do not interrupt another model run').toBeNull();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 120_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await page.getByTestId('workflow-tab-new').click();
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  const before = await page.evaluate(async (snapshot) => {
    const runtime = await import('/src/studio/blockRuntimeV2.ts');
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
    const { useRunIssueStore } = await import('/src/stores/useRunIssueStore.ts');
    const events: unknown[] = [];
    (window as unknown as Record<string, unknown>).loopFailureEvents = events;
    useRunIssueStore.subscribe((state) =>
      events.push({ at: Date.now(), task: state.failure?.taskId, open: state.failureDialogOpen }),
    );
    const source = snapshot.nodes[0].data.blockInstanceV2;
    const instance = runtime.replaceBlockEffectiveGraphV2(source, {
      ...source.effectiveGraph,
      nodes: source.effectiveGraph.nodes.map((node) =>
        node.modularDiffusers?.blockClass === 'QwenImageLoopBeforeDenoiser'
          ? {
              ...node,
              data: {
                ...node.data,
                params: {
                  ...node.data.params,
                  iteration_input__latents: { ...node.data.params.iteration_input__latents, value: [] },
                },
              },
            }
          : node,
      ),
      edges: source.effectiveGraph.edges.filter((edge) => edge.sourcePortId !== 'iteration_previous__latents'),
    });
    useRunIssueStore.getState().clearFailure();
    useStudioStore.getState().clearGraphBinding();
    useFlowStore
      .getState()
      .replaceGraph(
        { nodes: [runtime.createBlockRootNodeV2(source)], edges: [] },
        { historyLabel: 'Import the accepted loop workflow', clearRemovedCache: false },
      );
    useFlowStore.getState().resetHistory();
    useFlowStore
      .getState()
      .replaceGraph(
        { nodes: [runtime.createBlockRootNodeV2(instance)], edges: [] },
        { historyLabel: 'Import intentionally invalid iteration-input draft', clearRemovedCache: false },
      );
    useStudioStore.setState({ launcherDismissed: true });
    useStudioStore.getState().saveActiveWorkflowTab(true);
    return instance;
  }, submitted.runtimeHints.workflowSnapshot);
  const root = page.locator(`.react-flow__node-block[data-id="${before.instanceId}"]`);
  await expect(root).toBeVisible();
  const auto = page.getByTestId('topbar-auto-switch');
  if ((await auto.getAttribute('aria-checked')) === 'true') await auto.click();
  await root.locator('header').first().click();
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByTestId('selection-toolbar-run-from-node').click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBe(true);
  const taskId = (await response.json()).task_id;
  await writeFile(`${evidence}/submitted.json`, JSON.stringify(response.request().postDataJSON(), null, 2));
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${backend}/queue`);
        return (await response.json()).recent.find((task) => task.task_id === taskId)?.status;
      },
      { timeout: 8 * 60_000, intervals: [1000, 3000] },
    )
    .toBe('failed');
  const dialog = page.getByTestId('run-failure-dialog');
  if (!(await dialog.isVisible().catch(() => false)))
    await page
      .getByTestId('run-session-shelf')
      .getByRole('button', { name: new RegExp(`task ${taskId}$`, 'u') })
      .click();
  await page.waitForTimeout(1000);
  await writeFile(
    `${evidence}/navigation.json`,
    JSON.stringify(
      await page.evaluate(async () => {
        const { useRunIssueStore } = await import('/src/stores/useRunIssueStore.ts');
        const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
        const state = useRunIssueStore.getState(),
          studio = useStudioStore.getState();
        return {
          events: (window as unknown as Record<string, unknown>).loopFailureEvents,
          open: state.failureDialogOpen,
          task: state.failure?.taskId,
          active: studio.activeWorkflowTabId,
        };
      }),
      null,
      2,
    ),
  );
  await writeFile(`${evidence}/page-errors.json`, JSON.stringify(pageErrors));
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Loop member');
  await expect(dialog).toContainText('QwenImageLoopBeforeDenoiser');
  await expect(dialog).toContainText('shape');
  await expect(dialog.getByRole('button', { name: 'Inspect node', exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidence}/named-runtime-failure.png` });
  const failure = await page.evaluate(async () => {
    const { useRunIssueStore } = await import('/src/stores/useRunIssueStore.ts');
    return useRunIssueStore.getState().failure;
  });
  await writeFile(`${evidence}/failure.json`, JSON.stringify(failure, null, 2));
  await dialog.getByRole('button', { name: 'Inspect node', exact: true }).click();
  const after = await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore.getState().nodes.find((node) => node.id === id)!.data.blockInstanceV2;
  }, before.instanceId);
  expect(after?.values).toEqual(before.values);
  expect(after?.effectiveGraph).toEqual(before.effectiveGraph);
  await expect(page.getByTestId('graph-fix')).toBeEnabled();
  await page.getByTestId('graph-fix').click();
  const fix = page.getByRole('dialog', { name: 'Fix graph', exact: true });
  await expect(fix).toContainText('QwenImageLoopBeforeDenoiser');
  await expect(fix).toContainText('Manual correction required');
  await page.screenshot({ path: `${evidence}/manual-fix-guidance.png` });
  await fix.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.keyboard.press('Control+z');
  const original = submitted.runtimeHints.workflowSnapshot.nodes[0].data.blockInstanceV2;
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        return useFlowStore.getState().nodes.find((node) => node.id === id)!.data.blockInstanceV2?.effectiveGraph;
      }, before.instanceId),
    )
    .toEqual(original.effectiveGraph);
  await page.getByTestId('topbar-save-workflow').click();
  const save = page.getByTestId('save-workflow-dialog');
  if (await save.isVisible().catch(() => false)) {
    await page.getByTestId('save-workflow-name').fill('Qwen loop — corrected after runtime error');
    await page.getByTestId('confirm-save-workflow').click();
  }
  await expect(save).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await root.locator('header').first().click();
  const rerunResponse = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByTestId('selection-toolbar-run-from-node').click();
  const rerun = await rerunResponse;
  expect(rerun.ok(), await rerun.text()).toBe(true);
  const repairedTaskId = (await rerun.json()).task_id;
  await writeFile(`${evidence}/corrected-submitted.json`, JSON.stringify(rerun.request().postDataJSON(), null, 2));
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${backend}/queue`);
        return (await response.json()).recent.find((task) => task.task_id === repairedTaskId)?.status;
      },
      { timeout: 25 * 60_000, intervals: [1000, 5000] },
    )
    .toBe('completed');
  const receipt = await page.request.get(`${backend}/runs/${encodeURIComponent(repairedTaskId)}`);
  await writeFile(`${evidence}/corrected-receipt.json`, JSON.stringify(await receipt.json(), null, 2));
  const correctedGraph = rerun.request().postDataJSON();
  const loaderId = Object.keys(correctedGraph.nodes).find((id) => correctedGraph.nodes[id].action === 'ModelsLoader')!;
  expect((await page.request.get(`${backend}/cache/${encodeURIComponent(loaderId)}/repo_id`)).ok()).toBe(true);
  const cleanup = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/cache' &&
      response.request().method() === 'DELETE' &&
      response.request().postDataJSON()?.nodes?.includes(loaderId),
    { timeout: 180_000 },
  );
  await root.locator('header').first().click();
  await page.getByTestId('selection-toolbar-delete').click();
  let cleaned = false;
  const healthLatencies: number[] = [];
  const cleanupResponse = cleanup
    .then(async (value) => {
      expect(value.ok()).toBe(true);
      await value.json();
    })
    .finally(() => {
      cleaned = true;
    });
  while (!cleaned) {
    const started = Date.now();
    expect((await page.request.get(`${backend}/queue`, { timeout: 5000 })).ok()).toBe(true);
    healthLatencies.push(Date.now() - started);
    await page.waitForTimeout(250);
  }
  await cleanupResponse;
  expect((await page.request.get(`${backend}/cache/${encodeURIComponent(loaderId)}/repo_id`)).status()).toBe(404);
  await writeFile(
    `${evidence}/result.json`,
    JSON.stringify({
      taskId,
      repairedTaskId,
      preserved: true,
      manualFixExplanation: true,
      undoSaveReloadRun: true,
      loadedModelCleanup: true,
      healthLatencies,
    }),
  );
});
