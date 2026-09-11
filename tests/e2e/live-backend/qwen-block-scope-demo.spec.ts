import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { output, ready, inspect, save, retainRun } from './qwenDemoGestures';

test('selected Qwen Block retains its own result and excludes all outside sources', async ({ page }) => {
  test.skip(!output || process.env.MODIFF_RUN_QWEN_SCOPE_DEMO !== '1', 'Opt in to a retained real Block-only run.');
  test.setTimeout(90 * 60_000);
  page.setDefaultTimeout(30_000);
  const prior = JSON.parse(await readFile(`${output}/Qwen Demo 02 — Edit with outside LoRA-receipt.json`, 'utf8'));
  const authoring = JSON.parse(await readFile(`${output}/Qwen-edit-authoring-receipt.json`, 'utf8'));
  const rootId = authoring.rootId as string;
  const name = 'Qwen Demo 03 — Run only this Block';
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await ready(page);
  console.log('[Qwen scope] app ready');
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await page.getByTestId('left-tab-workflows').click();
  await page.getByLabel('Search workflows').fill('Qwen Demo');
  console.log('[Qwen scope] workflows open');
  await page.getByTestId(`saved-workflow-${prior.workflow_id}`).getByRole('button').first().click();
  await expect.poll(async () => (await inspect(page)).nodes.some((node) => node.id === rootId)).toBe(true);
  console.log('[Qwen scope] editing workflow loaded');
  await save(page, name);
  console.log('[Qwen scope] isolated demo copy saved');
  await page.getByTestId('arrange-graph').click();
  const root = page.getByTestId(`user-block-${rootId}`);
  const original = (await inspect(page)).nodes.find((node) => node.id === rootId)!.data.blockInstanceV2!;
  expect(original.values.num_inference_steps).toBe(40);
  expect(original.values.guidanceScale).toBe(4);
  await root.locator('header').first().click();
  const request = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/graph' && request.method() === 'POST',
  );
  const running = retainRun(page, name, rootId, page.getByTestId('selection-toolbar-run-from-node'));
  const submitted = (await request).postDataJSON();
  const text = JSON.stringify(submitted.nodes);
  await writeFile(
    `${output}/Qwen-block-only-scope-proof.json`,
    JSON.stringify({ outsideNodeIds: [authoring.loraId, authoring.stepsId, authoring.guidanceId], submitted }, null, 2),
  );
  for (const id of [authoring.loraId, authoring.stepsId, authoring.guidanceId]) expect(text).not.toContain(id);
  expect(text).not.toContain('Lightning');
  await running;
});
