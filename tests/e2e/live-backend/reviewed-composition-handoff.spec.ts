import { expect, test } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';

test('the executed typed Qwen instance exports as an editable workflow package', async ({ page }) => {
  test.skip(process.env.MODIFF_QWEN_COMPOSITION_HANDOFF !== '1', 'Requires the completed composition proof.');
  test.setTimeout(180_000);
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  if (!directory) throw new Error('An isolated evidence directory is required');
  const instance = JSON.parse(await readFile(`${directory}/qwen-composed/workflow-instance.json`, 'utf8'));
  await mkdir(`${directory}/handoff`, { recursive: true });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 120_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  const graph = await page.evaluate(async (value) => {
    const { createBlockRootNodeV2 } = await import('/src/studio/blockRuntimeV2.ts');
    return { nodes: [createBlockRootNodeV2(value)], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  }, instance);
  const drop = async (value: unknown) => {
    const transfer = await page.evaluateHandle((content) => {
      const data = new DataTransfer();
      data.items.add(new File([JSON.stringify(content)], 'Qwen Typed Composition.json', { type: 'application/json' }));
      return data;
    }, value);
    await page.locator('.react-flow').dispatchEvent('drop', { dataTransfer: transfer });
    await transfer.dispose();
  };
  await drop(graph);
  await expect(page.locator(`.react-flow__node-block[data-id="${instance.instanceId}"]`)).toBeVisible();
  await page.getByTestId('topbar-export').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('topbar-export-workflow-package').click();
  const output = `${directory}/handoff/Qwen-Composition.json`;
  await (await download).saveAs(output);
  const packaged = JSON.parse(await readFile(output, 'utf8'));
  expect(packaged.graph.nodes).toHaveLength(1);
  const exported = packaged.graph.nodes[0].data.blockInstanceV2;
  expect(exported.effectiveGraph.graphHash).toEqual(instance.effectiveGraph.graphHash);
  expect(exported.values).toEqual(instance.values);
  expect(exported.definitionSnapshot).toEqual(instance.definitionSnapshot);
  await drop(packaged);
  await expect(page.locator(`.react-flow__node-block[data-id="${instance.instanceId}"]`)).toBeVisible();
  await page.screenshot({ path: `${directory}/handoff/imported.png` });
});
