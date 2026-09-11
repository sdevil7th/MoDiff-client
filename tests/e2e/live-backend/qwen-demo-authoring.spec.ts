import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { output, ready, inspect, save } from './qwenDemoGestures';

test('Qwen User Node saves by an editable name in the right panel and reinserts without outside sockets', async ({
  page,
}) => {
  test.skip(!output || process.env.MODIFF_AUTHOR_QWEN_DEMO !== '1', 'Opt in to retaining the demo User Node.');
  test.setTimeout(6 * 60_000);
  page.setDefaultTimeout(30_000);
  const receipt = JSON.parse(await readFile(`${output}/Qwen Demo 02 — Edit with outside LoRA-receipt.json`, 'utf8'));
  const authoring = JSON.parse(await readFile(`${output}/Qwen-edit-authoring-receipt.json`, 'utf8'));
  const rootId = authoring.rootId as string;
  const name = 'Qwen Product Editor — Demo';
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await ready(page);
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await page.getByTestId('left-tab-workflows').click();
  await page.getByLabel('Search workflows').fill('Qwen Demo');
  await page.getByTestId(`saved-workflow-${receipt.workflow_id}`).getByRole('button').first().click();
  await expect.poll(async () => (await inspect(page)).nodes.some((node) => node.id === rootId)).toBe(true);
  await save(page, 'Qwen Demo 04 — Reusable Block authoring');
  await page.getByTestId('arrange-graph').click();
  const root = page.getByTestId(`user-block-${rootId}`);
  const before = await inspect(page);
  const crossing = before.edges.find((edge) => edge.source === authoring.loraId)!;
  expect(crossing).toBeTruthy();
  await expect(page.getByTestId(`block-crossing-ports-${rootId}`)).toContainText('Lora');
  await root.getByTestId(`user-block-save-choices-${rootId}`).click();
  const panel = page.getByTestId(`save-user-block-choices-${rootId}`);
  await expect(panel).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Save block changes' })).toHaveCount(0);
  const input = panel.getByRole('textbox');
  await expect(input).not.toHaveValue('');
  await input.fill(name);
  await page.screenshot({ path: `${output}/Qwen-user-node-name-right-panel.png` });
  const savedRequest = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/studio/blocks' && request.method() === 'POST',
  );
  await panel.getByRole('button', { name: 'Save as new User Node', exact: true }).click();
  const definition = (await savedRequest).postDataJSON();
  await expect(panel).toHaveCount(0);
  expect(definition.displayName).toBe(name);
  for (const id of [authoring.loraId, authoring.stepsId, authoring.guidanceId])
    expect(definition.graph.nodes.some((node: { nodeId: string }) => node.nodeId === id)).toBe(false);
  expect(
    definition.boundary.inputs.some(
      (port: { binding: { fieldOrPortId: string } }) => port.binding.fieldOrPortId === 'lora_list',
    ),
  ).toBe(false);
  expect((await inspect(page)).edges.find((edge) => edge.id === crossing.id)).toEqual(crossing);
  await save(page, 'Qwen Demo 04 — Reusable Block authoring');
  await page.getByTestId('topbar-new-workflow').click();
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await page.getByTestId('left-tab-nodes').click();
  await page.getByLabel('Search nodes').fill(name);
  await page.locator('[data-testid^="user-block-row-"]').filter({ hasText: name }).click();
  await expect.poll(async () => (await inspect(page)).nodes.filter((node) => node.data.blockInstanceV2).length).toBe(1);
  const inserted = await inspect(page);
  expect(inserted.nodes).toHaveLength(1);
  expect(inserted.edges).toHaveLength(0);
  await expect(page.locator('[data-testid^="block-crossing-ports-"]')).toHaveCount(0);
  await writeFile(
    `${output}/Qwen-user-node-authoring-proof.json`,
    JSON.stringify({ definition, before, inserted }, null, 2),
  );
  await page.screenshot({ path: `${output}/Qwen-user-node-reinserted.png` });
});
