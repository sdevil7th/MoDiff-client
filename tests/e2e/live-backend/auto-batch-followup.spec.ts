import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { ready, inspect, save, retainRun } from './qwenDemoGestures';

test('custom Qwen with a legacy control Block supports atomic mixed moves and graph Auto with retained output', async ({
  page,
}) => {
  test.skip(process.env.MODIFF_VERIFY_AUTO_BATCH !== '1', 'Requires the retained local Qwen demo and installed model.');
  test.setTimeout(15 * 60_000);
  page.setDefaultTimeout(30_000);
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR!;
  await mkdir(directory, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  // Reset only this follow-up's disposable Demo 06 from the retained Demo 05.
  // The actual authoring and movement below use native controls.
  const baseline = await (await page.request.get('http://127.0.0.1:8088/workflows/klS4WvyWb050fzRTgYg0c')).json();
  await page.request.put('http://127.0.0.1:8088/workflows/Mq5kON_wvsYfwJSOMRAGF', {
    data: { title: 'Qwen Demo 06 — Custom Blocks in Auto', snapshot: baseline.snapshot, source: 'manual' },
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await ready(page);
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible()) await advanced.click();
  const dismiss = page.getByTitle('Clear finished notifications', { exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.getByTestId('left-tab-workflows').click();
  await page.getByLabel('Search workflows').fill('Qwen Demo 06');
  await page.getByTestId('saved-workflow-Mq5kON_wvsYfwJSOMRAGF').getByRole('button').first().click();
  const rootId = '07173354-cc7a-4538-a143-d6321dbb5b09';
  const loraId = 'node-v-Hi7Gb6DJIMFOv1Zw5Ie';
  const root = page.getByTestId(`user-block-${rootId}`);
  await expect(root).toBeVisible();
  const title = 'Qwen Demo 06 — Custom Blocks in Auto';
  await save(page, title);
  console.log('[Auto follow-up] Saved demo');
  const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
  await page.getByTestId('arrange-graph').click();
  await node('node-IQnlFFWMv8YHLrgH6MMml').locator('header').click();
  console.log('[Auto follow-up] Controls selected');
  await page.getByTestId('selection-toolbar-create-block').click();
  await page.getByTestId('create-user-block-dialog').getByLabel('Name').fill('Qwen Demo — Shared generation controls');
  await page.getByTestId('confirm-create-user-block').click();
  await expect(page.getByTestId('create-user-block-dialog')).toHaveCount(0);
  const legacy = (await inspect(page)).nodes.find((item) => item.data.userBlockSnapshot && !item.data.blockInstanceV2)!;
  expect(legacy).toBeTruthy();
  console.log('[Auto follow-up] Created legacy block', legacy.id);
  const expand = root.getByLabel('Expand block', { exact: true });
  if (await expand.isVisible()) await expand.click();
  await page.getByTestId('arrange-graph').click();
  await node(legacy.id).locator('header').click();
  await node(loraId)
    .locator('header')
    .click({ modifiers: ['Control'] });
  const header = await node(loraId).locator('header').boundingBox();
  const box = await node(loraId).boundingBox();
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
  await expect(page.getByTestId('block-drag-destination')).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up('Control');
  await expect.poll(async () => (await inspect(page)).nodes.some((item) => item.id === legacy.id)).toBe(false);
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () =>
      (await inspect(page)).nodes.some((item) => item.id === legacy.id && Boolean(item.data.userBlockSnapshot)),
    )
    .toBe(true);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await inspect(page)).nodes.some((item) => item.id === legacy.id)).toBe(false);
  await page.getByTestId('arrange-graph').click();
  const moved = (await inspect(page)).nodes.find((item) => item.id === rootId)!.data.blockInstanceV2!.effectiveGraph
    .nodes;
  const movedBlock = moved.find(
    (item) =>
      typeof item.data.label === 'string' && item.data.label.startsWith('Qwen Demo — Shared generation controls'),
  )!;
  const movedLora = moved.find((item) => item.data.action === 'Lora')!;
  expect(movedBlock && movedLora).toBeTruthy();
  const projectionId = (id: string) => `block-v2-node:${rootId.length}:${rootId}:${id.length}:${id}`;
  await node(projectionId(movedBlock.nodeId)).locator('header').first().click();
  await node(projectionId(movedLora.nodeId))
    .locator('header')
    .click({ modifiers: ['Control'] });
  await expect(page.getByTestId('selection-toolbar-move-out')).toBeVisible();
  await page.getByTestId('selection-toolbar-move-out').click();
  await expect.poll(async () => (await inspect(page)).nodes.filter((item) => item.data.blockInstanceV2).length).toBe(2);
  await root.getByLabel('Collapse block', { exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  const mode = page.getByTestId('topbar-auto-switch');
  if ((await mode.getAttribute('aria-checked')) !== 'true') await mode.click();
  await expect(mode).toHaveAttribute('aria-checked', 'true');
  const before = await inspect(page);
  const planResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/auto_resource/workflow',
  );
  await page.getByTestId('topbar-workflow-resources').click();
  await page.getByTestId('plan-workflow-auto').click();
  const plan = await (await planResponse).json();
  await writeFile(`${directory}/workflow-auto-plan.json`, JSON.stringify(plan, null, 2));
  await expect(page.getByTestId('workflow-auto-plan')).toContainText('Ready for Auto execution', { timeout: 120_000 });
  expect(plan.loaders).toHaveLength(1);
  expect(plan.adapters).toHaveLength(1);
  expect((await inspect(page)).exported.nodes).toEqual(before.exported.nodes);
  await page.screenshot({ path: `${directory}/custom-workflow-auto-plan.png` });
  await page.getByTestId('topbar-workflow-resources').click();
  await save(page, title);
  console.log('[Auto follow-up] Mixed legacy moves and read-only plan passed; starting real Qwen run');
  await retainRun(page, title, rootId);
  await writeFile(
    `${directory}/native-proof.json`,
    JSON.stringify({ errors, before, after: await inspect(page) }, null, 2),
  );
  expect(errors).toEqual([]);
});

test('saved custom Qwen repeats in Auto and remains plannable with a warm runtime', async ({ page }) => {
  test.skip(process.env.MODIFF_VERIFY_AUTO_REPEAT !== '1', 'Requires the saved Demo 06 and installed model.');
  test.setTimeout(10 * 60_000);
  page.setDefaultTimeout(30_000);
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR!;
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await ready(page);
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible()) await advanced.click();
  await page.getByTestId('left-tab-workflows').click();
  await page.getByLabel('Search workflows').fill('Qwen Demo 06');
  await page.getByTestId('saved-workflow-Mq5kON_wvsYfwJSOMRAGF').getByRole('button').first().click();
  const rootId = '07173354-cc7a-4538-a143-d6321dbb5b09';
  await expect(page.getByTestId(`user-block-${rootId}`)).toBeVisible();
  await expect(page.getByTestId('topbar-auto-switch')).toHaveAttribute('aria-checked', 'true');
  await retainRun(page, 'Qwen Demo 06 — Custom Blocks in Auto', rootId);
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === '/auto_resource/workflow');
  await page.getByTestId('topbar-workflow-resources').click();
  await page.getByTestId('plan-workflow-auto').click();
  const plan = await (await response).json();
  await writeFile(`${directory}/warm-runtime-auto-plan.json`, JSON.stringify(plan, null, 2));
  await expect(page.getByTestId('workflow-auto-plan')).toContainText('Ready for Auto execution', { timeout: 120_000 });
  expect(plan.canAutoRun).toBe(true);
  await page.screenshot({ path: `${directory}/warm-runtime-auto-plan.png` });
});
