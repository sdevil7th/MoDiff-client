import { expect, test } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import type { BlockDefinitionV2, BlockJsonObject } from '../../../src/studio/blockSchemaV2';

test('saved FLUX seed warning is nonblocking and explicit Fix preserves values through Undo, Redo and refresh', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const evidence = `${process.env.MODIFF_REVIEW_OUTPUT_DIR ?? 'artifacts'}/seed-binding-repair`;
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seed-repair-proof')) return;
    localStorage.clear();
    sessionStorage.setItem('seed-repair-proof', '1');
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
      definition.source.pipelineClass === 'Flux2KleinBaseModularPipeline' &&
      definition.source.workflow === 'text2image',
  );
  if (!entry) throw new Error('The exact FLUX Klein Base admission is absent');
  const before = await page.evaluate(async ({ definition, values }) => {
    const schema = await import('/src/studio/blockSchemaV2.ts');
    const runtime = await import('/src/studio/blockRuntimeV2.ts');
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
    const { useHuggingFaceNodeLibraryStore } = await import('/src/stores/useHuggingFaceNodeLibraryStore.ts');
    await useHuggingFaceNodeLibraryStore.getState().fetchLibrary();
    const contracts = useHuggingFaceNodeLibraryStore.getState().library!.blockDefinitions;
    const original = definition.graph.nodes.find(
      (node) => node.data.action === 'ReviewedModularWorkflowStep' && (node.data.params as BlockJsonObject)?.seed,
    )!;
    const oldTarget = definition.graph.nodes.find(
      (node) =>
        node.data.action === 'ReviewedModularWorkflowStep' &&
        /DenoiseStep$/u.test(node.modularDiffusers?.blockClass ?? '') &&
        !contracts
          .find((contract) => contract.id === node.modularDiffusers?.blockDefinitionId)!
          .inputs.some(({ name }) => name === 'generator'),
    );
    if (!original || !oldTarget) throw new Error('Cannot build exact historical seed-placement fixture');
    (oldTarget.data.params as BlockJsonObject).seed = (original.data.params as BlockJsonObject).seed!;
    delete (original.data.params as BlockJsonObject).seed;
    for (const port of definition.boundary.inputs)
      for (const binding of [port.binding, ...(port.mirrorBindings ?? [])])
        if (binding.nodeId === original.nodeId && binding.fieldOrPortId === 'seed') binding.nodeId = oldTarget.nodeId;
    for (const control of definition.controls)
      for (const binding of [control.binding, ...(control.mirrorBindings ?? [])])
        if (binding.nodeId === original.nodeId && binding.fieldId === 'seed') binding.nodeId = oldTarget.nodeId;
    // Deliberately historical user fixture, not a forged registered identity.
    definition.source = { kind: 'user' };
    definition.ownership = { kind: 'user', definitionMutable: true };
    definition.definitionId = 'user:historical-flux-seed-test';
    definition.displayName = 'Saved FLUX seed repair proof';
    definition.graph.graphHash = schema.blockGraphHashV2(definition.graph);
    definition.contentHash = schema.blockDefinitionContentHashV2(definition);
    let instance = schema.createBlockInstanceV2(definition, {
      instanceId: 'seed-repair-proof',
      position: { x: 100, y: 70 },
      size: { width: 520, height: 650 },
    });
    for (const [id, value] of Object.entries(values)) instance = runtime.setBlockInstanceValueV2(instance, id, value);
    instance = runtime.setBlockInstanceValueV2(instance, 'seed', 20260906);
    useStudioStore.getState().clearGraphBinding();
    useFlowStore
      .getState()
      .replaceGraph(
        { nodes: [runtime.createBlockRootNodeV2(instance)], edges: [] },
        { historyLabel: 'Load historical seed fixture', clearRemovedCache: false },
      );
    useFlowStore.getState().resetHistory();
    useStudioStore.setState({ launcherDismissed: true });
    useStudioStore.getState().saveActiveWorkflowTab(true);
    return { instance, sourceId: oldTarget.nodeId, consumerId: original.nodeId };
  }, entry);
  const snapshot = () =>
    page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return useFlowStore.getState().nodes.find(({ id }) => id === 'seed-repair-proof')!.data.blockInstanceV2!;
    });
  const warnings = await page.evaluate(async () => {
    const { collectRunReadinessIssues } = await import('/src/studio/runReadiness.ts');
    return collectRunReadinessIssues({ isConnected: true, sid: 'seed-proof', includeStudio: false }).filter(
      ({ code }) => code === 'modular_seed_not_consumed',
    );
  });
  expect(warnings).toHaveLength(1);
  expect(warnings[0]!.blocking).toBe(false);
  await writeFile(`${evidence}/diagnostic.json`, JSON.stringify({ before, warnings }, null, 2));
  expect(warnings[0]!.details).toContain('Use Fix');
  await page.getByTestId('graph-fix').click();
  const dialog = page.getByRole('dialog', { name: 'Fix graph', exact: true });
  await expect(dialog).toContainText('A saved seed is attached to a step that does not consume it');
  await dialog.getByRole('radio', { name: /Connect seed to its Generator consumer/u }).check();
  await page.screenshot({ path: `${evidence}/explicit-fix.png` });
  await dialog.getByRole('button', { name: 'Apply fix', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const repaired = await snapshot();
  expect(repaired.values).toEqual(before.instance.values);
  expect(repaired.definitionSnapshot).toEqual(before.instance.definitionSnapshot);
  expect(repaired.effectiveInterface.controls.find(({ controlId }) => controlId === 'seed')!.binding.nodeId).toBe(
    before.consumerId,
  );
  expect(
    (repaired.effectiveGraph.nodes.find(({ nodeId }) => nodeId === before.sourceId)!.data.params as BlockJsonObject)
      .seed,
  ).toBeUndefined();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(before.instance.effectiveGraph);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(repaired.effectiveGraph);
  await page.getByTestId('topbar-save-workflow').click();
  await page.reload();
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(repaired.effectiveGraph);
  expect((await snapshot()).values).toEqual(before.instance.values);
  await page.screenshot({ path: `${evidence}/repaired-after-refresh.png` });
  await writeFile(`${evidence}/result.json`, JSON.stringify({ before, repaired, warnings }, null, 2));
  expect(errors).toEqual([]);
});
