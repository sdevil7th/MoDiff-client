import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

test('recorded native loop failure retains its dialog and only relevant Fix guidance; accepted graph exports normally', async ({
  page,
}) => {
  test.skip(process.env.MODIFF_QWEN_FAILURE_REPLAY !== '1', 'Requires captured native failure and accepted graph.');
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR!;
  const evidence = `${directory}/failure-ui-replay`;
  await mkdir(evidence, { recursive: true });
  const bad = JSON.parse(await readFile(`${directory}/runtime-failure/submitted.json`, 'utf8'));
  const failure = JSON.parse(await readFile(`${directory}/runtime-failure/failure.json`, 'utf8'));
  const accepted = JSON.parse(await readFile(`${directory}/qwen-composed/submitted-workflow.json`, 'utf8'));
  const acceptedOutput = JSON.parse(await readFile(`${directory}/qwen-composed/result.json`, 'utf8')).output;
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__));
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { useWebsocketStore } = await import('/src/stores/useWebsocketStore.ts');
          const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
          return Boolean(
            useWebsocketStore.getState().isConnected &&
            useNodesStore.getState().nodesRegistry['modules.ModularDiffusers.ReviewedModularWorkflowStep'],
          );
        }),
      { timeout: 90_000 },
    )
    .toBe(true);
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await page.getByTestId('workflow-tab-new').click();
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await page.evaluate(
    async ({ bad, failure }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
      const { useRunIssueStore } = await import('/src/stores/useRunIssueStore.ts');
      const state = useStudioStore.getState();
      // Replay the captured error with its actual document identity. This is UI
      // evidence, not a new backend run or a claim of native fixture insertion.
      useStudioStore.setState({
        workflowTabs: state.workflowTabs.map((tab) =>
          tab.id === state.activeWorkflowTabId ? { ...tab, id: failure.workflowTabId } : tab,
        ),
        activeWorkflowTabId: failure.workflowTabId,
        currentRunContext: null,
        runContextsByTaskId: {},
        runContextsByClientRunId: {},
        launcherDismissed: true,
      });
      useStudioStore.getState().clearGraphBinding();
      useFlowStore.getState().replaceGraph(bad.runtimeHints.workflowSnapshot, {
        historyLabel: 'Captured invalid draft fixture',
        clearRemovedCache: false,
      });
      useRunIssueStore.getState().reportFailure(failure, true);
    },
    { bad, failure },
  );
  const dialog = page.getByTestId('run-failure-dialog');
  await expect(dialog).toBeVisible();
  await page.evaluate(async (failure) => {
    const { useRunIssueStore } = await import('/src/stores/useRunIssueStore.ts');
    useRunIssueStore.getState().reportFailure(failure, false);
  }, failure);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('latents=list(length=0)');
  await dialog.getByRole('button', { name: 'Inspect node', exact: true }).click();
  await page.getByTestId('graph-fix').click();
  const fix = page.getByRole('dialog', { name: 'Fix graph', exact: true });
  await expect(fix).toContainText('Manual correction required');
  await expect(fix).toContainText('QwenImageLoopBeforeDenoiser');
  await expect(fix).not.toContainText('Add a graph output');
  await expect(fix).not.toContainText('Connect the graph output');
  await expect(fix).not.toContainText('Reconnect or update the backend');
  await expect(fix.getByTestId('graph-fix-apply')).toHaveCount(0);
  await page.screenshot({ path: `${evidence}/manual-fix-only.png` });
  await fix.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(
    async ({ snapshot, form }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const { useRunIssueStore } = await import('/src/stores/useRunIssueStore.ts');
      const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
      useRunIssueStore.getState().clearFailure();
      // Restore the captured form too, rather than exporting this isolated
      // browser's unrelated initial launcher form as package metadata.
      useStudioStore.setState({ form });
      useFlowStore
        .getState()
        .replaceGraph(snapshot, { historyLabel: 'Accepted graph export fixture', clearRemovedCache: false });
    },
    { snapshot: accepted.runtimeHints.workflowSnapshot, form: acceptedOutput.formSnapshot },
  );
  const downloaded = page.waitForEvent('download');
  await page.getByTestId('topbar-export').click();
  await page.getByTestId('topbar-export-workflow-package').click();
  await (await downloaded).saveAs(`${evidence}/Qwen-Modularity.json`);
  const exported = JSON.parse(await readFile(`${evidence}/Qwen-Modularity.json`, 'utf8'));
  expect(exported.graph.nodes[0].data.blockInstanceV2.effectiveGraph).toEqual(
    accepted.runtimeHints.workflowSnapshot.nodes[0].data.blockInstanceV2.effectiveGraph,
  );
  expect(exported.metadata.studio.modelType).toBe('QwenImageModularPipeline');
  expect(exported.metadata.studio.steps).toBe(50);
  await writeFile(
    `${evidence}/result.json`,
    JSON.stringify({
      fixtureReplay: true,
      realFailureTask: failure.taskId,
      passiveUpdateKeepsDialog: true,
      noUnrelatedOutputRepair: true,
      nativeExport: true,
    }),
  );
});
