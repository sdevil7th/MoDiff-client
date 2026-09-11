import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import type { BlockDefinitionV2, BlockJsonObject } from '../../../src/studio/blockSchemaV2';

test('Qwen missing-state Fix reconnects only the affected edge and preserves the draft through Undo, Save and refresh', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const evidence = `${process.env.MODIFF_REVIEW_OUTPUT_DIR ?? 'artifacts'}/reviewed-state-repair`;
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('state-repair-proof')) return;
    localStorage.clear();
    sessionStorage.setItem('state-repair-proof', '1');
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 120_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await page.getByTestId('workflow-tab-new').click();
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  const catalog = JSON.parse(
    gunzipSync(await readFile('../MoDiff/modiff/registered_block_v2_catalog.v1.json.gz')).toString(),
  ) as {
    entries: Array<{ definition: BlockDefinitionV2; values: BlockJsonObject }>;
  };
  const entry = catalog.entries.find(
    ({ definition }) =>
      definition.source.pipelineClass === 'QwenImageModularPipeline' && definition.source.workflow === 'text2image',
  );
  if (!entry) throw new Error('Current Qwen text-to-image admission missing');
  const before = await page.evaluate(async ({ definition, values }) => {
    const schema = await import('/src/studio/blockSchemaV2.ts');
    const runtime = await import('/src/studio/blockRuntimeV2.ts');
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
    const { useHuggingFaceNodeLibraryStore } = await import('/src/stores/useHuggingFaceNodeLibraryStore.ts');
    await useHuggingFaceNodeLibraryStore.getState().fetchLibrary();
    let instance = schema.createBlockInstanceV2(definition, {
      instanceId: 'state-repair-proof',
      position: { x: 100, y: 70 },
      size: { width: 540, height: 660 },
    });
    for (const [id, value] of Object.entries(values)) instance = runtime.setBlockInstanceValueV2(instance, id, value);
    instance = runtime.setBlockInstanceValueV2(
      instance,
      'prompt',
      'An intricate cobalt ceramic architectural miniature with precise glaze highlights.',
    );
    const target = instance.effectiveGraph.nodes.find(
      (node) => node.modularDiffusers?.blockClass === 'QwenImageTextInputsStep',
    )!;
    const removed = instance.effectiveGraph.edges.find(
      (edge) => edge.targetNodeId === target.nodeId && edge.targetPortId === 'state_in',
    )!;
    if (!removed) throw new Error('Expected exact upstream state connection');
    instance = runtime.replaceBlockEffectiveGraphV2(instance, {
      ...instance.effectiveGraph,
      edges: instance.effectiveGraph.edges.filter((edge) => edge.edgeId !== removed.edgeId),
    });
    useStudioStore.getState().clearGraphBinding();
    useFlowStore
      .getState()
      .replaceGraph(
        { nodes: [runtime.createBlockRootNodeV2(instance)], edges: [] },
        { historyLabel: 'Load disconnected draft fixture', clearRemovedCache: false },
      );
    useFlowStore.getState().resetHistory();
    useStudioStore.setState({ launcherDismissed: true });
    useStudioStore.getState().saveActiveWorkflowTab(true);
    return { instance, removed, targetId: target.nodeId };
  }, entry);
  const snapshot = () =>
    page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return useFlowStore.getState().nodes.find(({ id }) => id === 'state-repair-proof')!.data.blockInstanceV2!;
    });
  // The invalid composition must survive a reload before any repair is requested.
  await page.reload();
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(before.instance.effectiveGraph);
  const diagnostics = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useHuggingFaceNodeLibraryStore } = await import('/src/stores/useHuggingFaceNodeLibraryStore.ts');
    const { inspectReviewedStateV2 } = await import('/src/studio/reviewedStateDiagnosticsV2.ts');
    await useHuggingFaceNodeLibraryStore.getState().fetchLibrary();
    const library = useHuggingFaceNodeLibraryStore.getState();
    const instance = useFlowStore.getState().nodes.find(({ id }) => id === 'state-repair-proof')!.data.blockInstanceV2!;
    return {
      error: library.error,
      definitions: library.library?.blockDefinitions.length,
      issues: inspectReviewedStateV2(instance, library.library?.blockDefinitions ?? []),
    };
  });
  await writeFile(`${evidence}/diagnostics.json`, JSON.stringify(diagnostics, null, 2));
  expect(diagnostics.issues.some(({ nodeId }) => nodeId === before.targetId)).toBe(true);
  await page.getByTestId('graph-fix').click();
  const dialog = page.getByRole('dialog', { name: 'Fix graph', exact: true });
  await expect(dialog).toContainText('prompt_embeds');
  await dialog
    .getByRole('radio', { name: /Reconnect Pipeline State from/u })
    .first()
    .check();
  await page.screenshot({ path: `${evidence}/exact-missing-input.png` });
  await dialog.getByRole('button', { name: 'Apply fix', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const repaired = await snapshot();
  expect(repaired.values).toEqual(before.instance.values);
  expect(repaired.definitionSnapshot).toEqual(before.instance.definitionSnapshot);
  expect(repaired.effectiveGraph.nodes).toEqual(before.instance.effectiveGraph.nodes);
  expect(repaired.effectiveGraph.edges).toHaveLength(before.instance.effectiveGraph.edges.length + 1);
  expect(repaired.effectiveGraph.edges).toContainEqual(
    expect.objectContaining({
      sourceNodeId: before.removed.sourceNodeId,
      sourcePortId: 'state_out',
      targetNodeId: before.targetId,
      targetPortId: 'state_in',
    }),
  );
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(before.instance.effectiveGraph);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(repaired.effectiveGraph);
  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible().catch(() => false)) {
    await page.getByTestId('save-workflow-name').fill(`Qwen targeted reconnection proof ${Date.now()}`);
    await page.getByTestId('confirm-save-workflow').click();
  }
  await expect(saveDialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(repaired.effectiveGraph);
  expect((await snapshot()).values).toEqual(before.instance.values);
  await page.screenshot({ path: `${evidence}/repaired-after-refresh.png` });
  await writeFile(`${evidence}/result.json`, JSON.stringify({ before, repaired }, null, 2));
  expect(errors).toEqual([]);
});
