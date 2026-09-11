import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import type { BlockDefinitionV2, BlockJsonObject } from '../../../src/studio/blockSchemaV2';

test('saved Qwen derived-step override is unchanged until explicit Fix and survives Undo, Redo, Save and refresh', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const evidence = `${process.env.MODIFF_REVIEW_OUTPUT_DIR ?? 'artifacts'}/derived-control-repair`;
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('derived-control-proof')) return;
    localStorage.clear();
    sessionStorage.setItem('derived-control-proof', '1');
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
  ) as { entries: Array<{ definition: BlockDefinitionV2; values: BlockJsonObject }> };
  const entry = catalog.entries.find(
    ({ definition }) =>
      definition.source.pipelineClass === 'QwenImageModularPipeline' && definition.source.workflow === 'image2image',
  );
  if (!entry) throw new Error('Exact Qwen image-to-image admission missing');
  const before = await page.evaluate(async ({ definition, values }) => {
    const schema = await import('/src/studio/blockSchemaV2.ts');
    const runtime = await import('/src/studio/blockRuntimeV2.ts');
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
    const { useHuggingFaceNodeLibraryStore } = await import('/src/stores/useHuggingFaceNodeLibraryStore.ts');
    await useHuggingFaceNodeLibraryStore.getState().fetchLibrary();
    const writer = definition.graph.nodes.find(
      (node) => node.modularDiffusers?.blockClass === 'QwenImageSetTimestepsWithStrengthStep',
    )!;
    const loop = definition.graph.nodes.find((node) => node.modularDiffusers?.blockKind === 'loop')!;
    const fieldId = 'num_inference_steps';
    (loop.data.params as BlockJsonObject)[fieldId] = structuredClone((writer.data.params as BlockJsonObject)[fieldId]!);
    const control = definition.controls.find((control) =>
      [control.binding, ...(control.mirrorBindings ?? [])].some(
        (binding) => binding.nodeId === writer.nodeId && binding.fieldId === fieldId,
      ),
    )!;
    control.binding = { nodeId: loop.nodeId, fieldId };
    control.mirrorBindings = [{ nodeId: writer.nodeId, fieldId }];
    definition.source = { kind: 'user' };
    definition.ownership = { kind: 'user', definitionMutable: true };
    definition.definitionId = 'user:historical-qwen-count-test';
    definition.displayName = 'Saved Qwen scheduler repair proof';
    definition.graph.graphHash = schema.blockGraphHashV2(definition.graph);
    definition.contentHash = schema.blockDefinitionContentHashV2(definition);
    let instance = schema.createBlockInstanceV2(definition, {
      instanceId: 'derived-control-proof',
      position: { x: 100, y: 70 },
      size: { width: 540, height: 660 },
    });
    for (const [id, value] of Object.entries(values)) instance = runtime.setBlockInstanceValueV2(instance, id, value);
    instance = runtime.setBlockInstanceValueV2(instance, control.controlId, 37);
    instance = runtime.setBlockInstanceValueV2(
      instance,
      'prompt',
      'An intricate cobalt ceramic architectural miniature with precise glaze highlights.',
    );
    useStudioStore.getState().clearGraphBinding();
    useFlowStore
      .getState()
      .replaceGraph(
        { nodes: [runtime.createBlockRootNodeV2(instance)], edges: [] },
        { historyLabel: 'Load historical count fixture', clearRemovedCache: false },
      );
    useFlowStore.getState().resetHistory();
    useStudioStore.setState({ launcherDismissed: true });
    useStudioStore.getState().saveActiveWorkflowTab(true);
    return { instance, writerId: writer.nodeId, loopId: loop.nodeId, controlId: control.controlId };
  }, entry);
  const snapshot = () =>
    page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return useFlowStore.getState().nodes.find(({ id }) => id === 'derived-control-proof')!.data.blockInstanceV2!;
    });
  const warnings = await page.evaluate(async () => {
    const { collectRunReadinessIssues } = await import('/src/studio/runReadiness.ts');
    return collectRunReadinessIssues({ isConnected: true, sid: 'derived-control-proof', includeStudio: false }).filter(
      ({ code }) => code === 'modular_derived_control_overridden',
    );
  });
  expect(warnings).toHaveLength(1);
  expect(warnings[0]!.blocking).toBe(false);
  expect(await snapshot()).toEqual(before.instance);
  await page.getByTestId('graph-fix').click();
  const dialog = page.getByRole('dialog', { name: 'Fix graph', exact: true });
  await expect(dialog).toContainText('A mirrored control overwrites an upstream-derived value');
  await dialog.getByRole('radio', { name: /Use the upstream-derived value/u }).check();
  await page.screenshot({ path: `${evidence}/explicit-fix.png` });
  await dialog.getByRole('button', { name: 'Apply fix', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const repaired = await snapshot();
  expect(repaired.values).toEqual(before.instance.values);
  expect(repaired.definitionSnapshot).toEqual(before.instance.definitionSnapshot);
  expect(repaired.presentation).toEqual(before.instance.presentation);
  expect(
    repaired.effectiveInterface.controls.find(({ controlId }) => controlId === before.controlId)!.binding.nodeId,
  ).toBe(before.writerId);
  expect(
    (repaired.effectiveGraph.nodes.find(({ nodeId }) => nodeId === before.loopId)!.data.params as BlockJsonObject)
      .num_inference_steps,
  ).toBeUndefined();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(before.instance.effectiveGraph);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(repaired.effectiveGraph);
  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible().catch(() => false)) {
    await page.getByTestId('save-workflow-name').fill(`Qwen derived control repair ${Date.now()}`);
    await page.getByTestId('confirm-save-workflow').click();
  }
  await expect(saveDialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(repaired.effectiveGraph);
  expect((await snapshot()).values).toEqual(before.instance.values);
  await page.screenshot({ path: `${evidence}/repaired-after-refresh.png` });
  await writeFile(`${evidence}/result.json`, JSON.stringify({ before, repaired, warnings }, null, 2));
  expect(errors).toEqual([]);
});
