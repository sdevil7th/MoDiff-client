import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import type { BlockDefinitionV2, BlockJsonObject } from '../../../src/studio/blockSchemaV2';
import { waitForRecursiveDomGeometry } from './blockDomGeometry';

test('composition inspection loads its own pinned metadata and retries a failed catalog without editing the graph', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 120_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible()) await advanced.click();
  await page.getByTestId('workflow-tab-new').click();
  if (await advanced.isVisible()) await advanced.click();
  const catalog = JSON.parse(
    gunzipSync(await readFile('../MoDiff/modiff/registered_block_v2_catalog.v1.json.gz')).toString(),
  ) as {
    entries: Array<{ definition: BlockDefinitionV2; values: BlockJsonObject }>;
  };
  const entry = catalog.entries.find(
    ({ definition }) =>
      definition.source.pipelineClass === 'FluxModularPipeline' && definition.source.workflow === 'text2image',
  )!;
  await page.evaluate(async ({ definition, values }) => {
    const schema = await import('/src/studio/blockSchemaV2.ts');
    const runtime = await import('/src/studio/blockRuntimeV2.ts');
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
    let instance = schema.createBlockInstanceV2(definition, {
      instanceId: 'metadata-proof',
      position: { x: 100, y: 70 },
      size: { width: 540, height: 660 },
    });
    for (const [key, value] of Object.entries(values)) instance = runtime.setBlockInstanceValueV2(instance, key, value);
    instance = runtime.setBlockPresentationV2(instance, { expanded: true });
    useStudioStore.getState().clearGraphBinding();
    useFlowStore
      .getState()
      .replaceGraph(
        { nodes: [runtime.createBlockRootNodeV2(instance)], edges: [] },
        { historyLabel: 'Metadata inspection fixture', clearRemovedCache: false },
      );
    useStudioStore.setState({ launcherDismissed: true });
  }, entry);
  if (await page.getByLabel('Search nodes').isVisible()) await page.getByTestId('left-tab-nodes').click();
  await page.getByTestId('arrange-graph').click();
  await waitForRecursiveDomGeometry(page);
  const snapshot = () =>
    page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const instance = useFlowStore.getState().nodes.find((node) => node.id === 'metadata-proof')!.data
        .blockInstanceV2!;
      return { values: instance.values, graph: instance.effectiveGraph, definition: instance.definitionSnapshot };
    });
  const before = await snapshot();
  let libraryRequests = 0;
  let failLibrary = true;
  await page.route('**/huggingface/node-library', async (route) => {
    libraryRequests += 1;
    if (failLibrary)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: true, message: 'Metadata unavailable for retry test' }),
      });
    else await route.continue();
  });
  await page.evaluate(async () => {
    const { useHuggingFaceNodeLibraryStore } = await import('/src/stores/useHuggingFaceNodeLibraryStore.ts');
    const { useHuggingFaceModularConditionalStore } =
      await import('/src/stores/useHuggingFaceModularConditionalStore.ts');
    useHuggingFaceNodeLibraryStore.setState({ library: null, loaded: false, error: null });
    useHuggingFaceModularConditionalStore.setState({ snapshot: null, loaded: false, error: null });
  });
  await page.getByTestId('user-block-composition-metadata-proof').click({ timeout: 15_000 });
  const dialog = page.getByTestId('user-block-composition-dialog-metadata-proof');
  const retry = dialog.getByRole('button', { name: 'Retry pinned catalog', exact: true });
  await expect(retry).toBeEnabled();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Validate upstream composition', exact: true })).toHaveCount(0);
  expect(libraryRequests).toBeGreaterThan(0);
  expect(await snapshot()).toEqual(before);
  failLibrary = false;
  await retry.click();
  const validate = dialog.getByRole('button', { name: 'Validate upstream composition', exact: true });
  await expect(validate).toBeEnabled({ timeout: 15_000 });
  const response = page.waitForResponse(
    (item) => new URL(item.url()).pathname === '/huggingface/modular-composition/rebuild',
    { timeout: 15_000 },
  );
  await validate.click();
  expect((await response).ok()).toBe(true);
  await expect(dialog.getByTestId('block-v2-composition-receipt-metadata-proof')).toBeVisible();
  await expect(dialog).toContainText('It does not load models or qualify a run.');
  expect(libraryRequests).toBeGreaterThan(1);
  expect(await snapshot()).toEqual(before);
});
