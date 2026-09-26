import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// No generation or downloads. The named fixture must already be reviewed and
// explicitly enabled through the real custom-node lifecycle.
test('model replacement retains a trusted custom prompt supplier and compatible settings', async ({ page }) => {
  const module = process.env.MODIFF_NODE_UX_TRUSTED_MODULE;
  test.skip(!module || process.env.MODIFF_NODE_UX_ISOLATED !== '1', 'Requires an enabled trusted isolated fixture');
  test.setTimeout(4 * 60_000);
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto('/');
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await page.getByTestId('task-launcher').getByRole('button', { name: 'Empty workflow', exact: true }).click();
  const customId = await page.evaluate(async (module) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const { createNodeFromRegistry } = await import('/src/workflow/nodeFactory.ts');
    const { createOperationStarter } = await import('/src/workflow/operationAuthoring.ts');
    const { requestOperationStarter } = await import('/src/workflow/operationStarterRequest.ts');
    const registry = useNodesStore.getState();
    const key = Object.keys(registry.nodesRegistry).find((key) => key.startsWith(`custom.${module}.`));
    if (!key) throw new Error('Reviewed fixture is not registered');
    const custom = createNodeFromRegistry(key, registry.nodesRegistry, { x: 20, y: 100 })!;
    custom.data.params.text.value = 'A watercolor lighthouse at night';
    const starter = await requestOperationStarter(
      'ZImageModularPipeline',
      'text_to_image',
      registry.operationContracts,
    );
    const graph = createOperationStarter(starter, { x: 500, y: 100 });
    const prompt = graph.nodes.find((node) => node.data.action === 'EncodePrompt')!;
    for (const node of graph.nodes) {
      if (node.data.params.num_inference_steps) node.data.params.num_inference_steps.value = 4;
      if (node.data.params.width) node.data.params.width.value = 512;
      if (node.data.params.height) node.data.params.height.value = 512;
    }
    useFlowStore.getState().replaceGraph({
      nodes: [custom, ...graph.nodes],
      edges: [
        ...graph.edges,
        {
          id: `${custom.id}-prompt`,
          source: custom.id,
          sourceHandle: 'out_result',
          target: prompt.id,
          targetHandle: 'prompt_input',
        },
      ],
    });
    return custom.id;
  }, module!);
  const original = await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
  for (const [repository, pipeline] of [
    ['black-forest-labs/FLUX.2-klein-4B', 'Flux2KleinModularPipeline'],
    ['Tongyi-MAI/Z-Image-Turbo', 'ZImageModularPipeline'],
  ]) {
    await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
    const owner = await page.evaluate(
      () => window.__MODIFF_E2E__!.exportWorkflowGraph().nodes.find((node) => node.data.action === 'ModelsLoader')!.id,
    );
    await page
      .locator(`.react-flow__node[data-id="${owner}"]`)
      .getByRole('button', { name: 'Choose model', exact: true })
      .click();
    const picker = page.getByRole('dialog', { name: 'Choose model for Load Models', exact: true });
    await picker.getByRole('searchbox', { name: 'Search compatible models' }).fill(repository!);
    await picker.getByRole('button').filter({ hasText: repository! }).click();
    await expect(picker.getByTestId('model-selection-review')).toBeVisible({ timeout: 60_000 });
    await picker.getByRole('button', { name: 'Apply model change', exact: true }).click();
    await expect(picker).toHaveCount(0);
    const changed = await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
    expect(changed.nodes.find((node) => node.id === customId)?.data).toEqual(
      original.nodes.find((node) => node.id === customId)!.data,
    );
    expect(changed.nodes.some((node) => node.data.operationAuthoring?.operation.pipelineClass === pipeline)).toBe(true);
    expect(changed.edges.some((edge) => edge.source === customId && edge.sourceHandle === 'out_result')).toBe(true);
    const denoise = changed.nodes.find((node) => node.data.action === 'Denoise')!;
    expect(Number(denoise.data.params.num_inference_steps.value)).toBe(4);
    await writeFile(test.info().outputPath(`${pipeline}.json`), JSON.stringify(changed, null, 2));
  }
  const beforeReload = await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
  await page.reload();
  await expect(page.locator(`.react-flow__node[data-id="${customId}"]`)).toBeVisible({ timeout: 45_000 });
  const after = await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
  expect(after.edges).toEqual(beforeReload.edges);
  expect(after.nodes.map((node) => node.id)).toEqual(beforeReload.nodes.map((node) => node.id));
  await page.screenshot({ path: test.info().outputPath('custom-model-roundtrip.png') });
});
