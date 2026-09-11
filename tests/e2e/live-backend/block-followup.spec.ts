import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { ready, inspect, save } from './qwenDemoGestures';

test('retained Qwen workflow supports resource assessment, searchable interfaces and atomic batch moves', async ({
  page,
}) => {
  test.skip(process.env.MODIFF_VERIFY_BLOCK_FOLLOWUP !== '1', 'Requires the retained local Qwen demo.');
  test.setTimeout(6 * 60_000);
  page.setDefaultTimeout(30_000);
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR!;
  await mkdir(directory, { recursive: true });
  const rootId = '07173354-cc7a-4538-a143-d6321dbb5b09';
  const ids = ['node-v-Hi7Gb6DJIMFOv1Zw5Ie', 'node-IQnlFFWMv8YHLrgH6MMml'];
  const submissions: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/graph' && request.method() === 'POST') submissions.push(request.url());
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await ready(page);
  console.log('[Block follow-up] Workspace ready');
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible()) await advanced.click();
  const dismiss = page.getByTitle('Clear finished notifications', { exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.getByTestId('left-tab-workflows').click();
  await page.getByLabel('Search workflows').fill('Qwen Demo 04');
  await page.getByTestId('saved-workflow-2bJilBusariAZQ3_6LYO7').getByRole('button').first().click();
  const root = page.getByTestId(`user-block-${rootId}`);
  await expect(root).toBeVisible();
  console.log('[Block follow-up] Saved Qwen opened');
  await save(page, 'Qwen Demo 05 — Block controls and resources');
  const baseline = await inspect(page);
  const instance = async () => (await inspect(page)).nodes.find((node) => node.id === rootId)!.data.blockInstanceV2!;
  await page.getByTestId('topbar-workflow-resources').click();
  const panel = page.getByTestId('workflow-resource-assessment');
  await expect(panel).toContainText('Expert keeps your configured settings');
  await expect(panel).toContainText('1 adapters');
  await page.getByTestId('assess-workflow-resources').click();
  await expect(panel).toContainText('Available RAM:', { timeout: 90_000 });
  console.log('[Block follow-up] Assessment received');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: `${directory}/workflow-resources.png` });
  await page.getByLabel('Resource assessment scope').click();
  await page
    .getByRole('option', { name: /^Only /u })
    .first()
    .click();
  await expect(panel).toContainText('0 adapters');
  await expect(panel).not.toContainText('Available RAM:');
  expect((await instance()).effectiveGraph).toEqual(
    baseline.nodes.find((node) => node.id === rootId)!.data.blockInstanceV2!.effectiveGraph,
  );
  await page.getByTestId('topbar-workflow-resources').click();
  await root.getByTestId(`user-block-configure-${rootId}`).click();
  const picker = page.getByRole('combobox', { name: 'Choose an internal input field', exact: true });
  await picker.fill('lora');
  await expect(page.getByRole('option').filter({ hasText: /Lora/u }).first()).toBeVisible();
  await page.screenshot({ path: `${directory}/searchable-block-interface.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const expand = root.getByLabel('Expand block', { exact: true });
  if (await expand.isVisible()) await expand.click();
  await page.getByTestId('arrange-graph').click();
  const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
  await node(ids[0]).locator('header').click();
  await node(ids[1])
    .locator('header')
    .click({ modifiers: ['Control'] });
  await expect(node(ids[0])).toHaveClass(/selected/u);
  await expect(node(ids[1])).toHaveClass(/selected/u);
  const header = await node(ids[0]).locator('header').boundingBox();
  const box = await node(ids[0]).boundingBox();
  const frame = await root.boundingBox();
  expect(header && box && frame).toBeTruthy();
  await page.keyboard.down('Control');
  await page.mouse.move(header!.x + header!.width / 2, header!.y + header!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    frame!.x + frame!.width - 12,
    frame!.y + frame!.height * 0.6 - (box!.height - header!.height) / 2,
    { steps: 25 },
  );
  await expect(page.getByTestId('block-drag-destination')).toContainText('Move to');
  await page.screenshot({ path: `${directory}/batch-move-destination.png` });
  await page.mouse.up();
  await page.keyboard.up('Control');
  await expect
    .poll(async () => {
      const graph = (await instance()).effectiveGraph;
      return ids.every((id) => graph.nodes.some((node) => node.nodeId === id));
    })
    .toBe(true);
  await page.getByTestId('arrange-graph').click();
  const adopted = await instance();
  const projected = `block-v2-node:${rootId.length}:${rootId}:${ids[0].length}:${ids[0]}`;
  const adoptedHeader = await node(projected).locator('header').boundingBox();
  expect(adoptedHeader).toBeTruthy();
  await page.keyboard.down('Control');
  await page.mouse.move(adoptedHeader!.x + adoptedHeader!.width / 2, adoptedHeader!.y + adoptedHeader!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    adoptedHeader!.x + adoptedHeader!.width / 2 + 30,
    adoptedHeader!.y + adoptedHeader!.height / 2 + 20,
    { steps: 8 },
  );
  await expect(page.getByTestId('block-drag-destination')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.keyboard.up('Control');
  await expect(node(projected)).toBeVisible();
  expect((await instance()).effectiveGraph).toEqual(adopted.effectiveGraph);
  expect((await instance()).presentation).toEqual(adopted.presentation);
  // History cancellation restores the previous selection as well as its wires.
  await page.getByTestId('selection-toolbar-move-out').click();
  await expect
    .poll(async () => {
      const graph = await inspect(page);
      return ids.every((id) => graph.nodes.some((node) => node.id === id));
    })
    .toBe(true);
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await instance()).effectiveGraph.nodes.filter((node) => ids.includes(node.nodeId)).length)
    .toBe(2);
  await page.keyboard.press('Control+Shift+z');
  await expect
    .poll(async () => (await instance()).effectiveGraph.nodes.filter((node) => ids.includes(node.nodeId)).length)
    .toBe(0);
  await root.getByLabel('Collapse block', { exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  expect((await instance()).effectiveGraph).toEqual(
    baseline.nodes.find((node) => node.id === rootId)!.data.blockInstanceV2!.effectiveGraph,
  );
  await save(page, 'Qwen Demo 05 — Block controls and resources');
  await writeFile(
    `${directory}/batch-move-proof.json`,
    JSON.stringify({ baseline, after: await inspect(page), submissions, errors }, null, 2),
  );
  expect(submissions).toEqual([]);
  expect(errors).toEqual([]);
});
