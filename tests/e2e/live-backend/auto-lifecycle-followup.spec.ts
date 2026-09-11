import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { backend, ready, inspect, save, retainRun, connect } from './qwenDemoGestures';

test('two Qwen Blocks release model ownership between runs and retain both results', async ({ page }) => {
  test.skip(process.env.MODIFF_VERIFY_AUTO_LIFECYCLE !== '1', 'Requires the saved local Qwen demo and cached models.');
  test.setTimeout(20 * 60_000);
  page.setDefaultTimeout(30_000);
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR!;
  await mkdir(directory, { recursive: true });
  const title = 'Qwen Demo 07 — Auto model handoff';
  const workflowId = process.env.MODIFF_LIFECYCLE_WORKFLOW_ID ?? 'auto-lifecycle-demo-20260911';
  const queue = await (await page.request.get(`${backend}/queue`)).json();
  expect(queue.current).toBeFalsy();
  expect(Object.keys(queue.queued ?? {})).toHaveLength(0);
  const baseline = await (await page.request.get(`${backend}/workflows/Mq5kON_wvsYfwJSOMRAGF`)).json();
  const created = await page.request.put(`${backend}/workflows/${workflowId}`, {
    data: { title, snapshot: baseline.snapshot, source: 'manual' },
  });
  expect(created.ok()).toBe(true);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 2560, height: 1600 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await ready(page);
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible()) await advanced.click();
  await page.getByTestId('left-tab-workflows').click();
  await page.getByLabel('Search workflows').fill(title);
  await page.getByTestId(`saved-workflow-${workflowId}`).getByRole('button').first().click();
  const rootId = '07173354-cc7a-4538-a143-d6321dbb5b09';
  const root = page.getByTestId(`user-block-${rootId}`);
  const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
  await expect(root).toBeVisible();
  await page.getByTestId('arrange-graph').click();
  await node(rootId).locator('header').first().click();
  await page.getByTestId('selection-toolbar-duplicate').click();
  const duplicate = (await inspect(page)).nodes.find(
    (item) =>
      item.id !== rootId && item.data.blockInstanceV2?.effectiveGraph.nodes.some((inner) => inner.nodeId === 'models'),
  )!;
  expect(duplicate).toBeTruthy();
  const duplicateRoot = page.getByTestId(`user-block-${duplicate.id}`);
  await duplicateRoot.getByLabel('Expand block', { exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  const handle = (id: string, field: string, direction: 'source' | 'target') =>
    node(id).locator(`.react-flow__handle.${direction}[data-handleid="${field}"]`);
  const models = `block-v2-node:${duplicate.id.length}:${duplicate.id}:6:models`;
  await connect(page, handle('node-v-Hi7Gb6DJIMFOv1Zw5Ie', 'lora', 'source'), handle(models, 'lora_list', 'target'));
  await connect(
    page,
    handle('block-FlvSrjfg31CKp8mO445cx', 'output', 'source'),
    handle(duplicate.id, 'num_inference_steps', 'target'),
  );
  await connect(
    page,
    handle('node-0SSPwJxTRfrK990sfFTpH', 'output', 'source'),
    handle(duplicate.id, 'input:denoise:guidance_scale', 'target'),
  );
  await duplicateRoot.getByLabel('Collapse block', { exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  const before = await inspect(page);
  expect(before.edges.filter((edge) => edge.target === duplicate.id)).toHaveLength(3);
  await save(page, title);
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === '/auto_resource/workflow');
  await page.getByTestId('topbar-workflow-resources').click();
  await page.getByTestId('plan-workflow-auto').click();
  const plan = await (await response).json();
  await writeFile(`${directory}/lifecycle-plan.json`, JSON.stringify(plan, null, 2));
  expect(plan.canAutoRun, JSON.stringify(plan.issues)).toBe(true);
  expect(plan.loaders).toHaveLength(2);
  expect(plan.strategy).toBe('dependency_order_release_owners');
  expect(plan.schedule.releases.length).toBeGreaterThan(0);
  await page.screenshot({ path: `${directory}/lifecycle-plan.png` });
  await page.getByTestId('topbar-workflow-resources').click();
  console.log('[Auto lifecycle] Both native connections and the release plan passed; starting Qwen');
  await retainRun(page, title, rootId);
  const after = await inspect(page);
  const first = after.nodes.find((item) => item.id === rootId)!.data.blockInstanceV2!;
  const second = after.nodes.find((item) => item.id === duplicate.id)!.data.blockInstanceV2!;
  const taskId = first.previewStates.find((state) => state.status === 'complete')!.taskId;
  expect(second.previewStates.some((state) => state.status === 'complete' && state.taskId === taskId)).toBe(true);
  const receipt = await (await page.request.get(`${backend}/runs/${taskId}`)).json();
  expect(receipt.task.runtimePreparation.workflowAuto.releases.length).toBeGreaterThan(0);
  expect(
    receipt.outputs.filter((item: { displayType: string }) => item.displayType === 'image').length,
  ).toBeGreaterThanOrEqual(2);
  await writeFile(
    `${directory}/lifecycle-native-proof.json`,
    JSON.stringify({ workflowId, duplicateId: duplicate.id, errors, before, after, receipt }, null, 2),
  );
  expect(errors).toEqual([]);
});

test('revalidate the saved model handoff workflow without repeating authoring', async ({ page }) => {
  test.skip(process.env.MODIFF_RETRY_AUTO_LIFECYCLE !== '1', 'Opt in to the already saved handoff workflow.');
  test.setTimeout(20 * 60_000);
  page.setDefaultTimeout(30_000);
  const title = 'Qwen Demo 07 — Auto model handoff';
  const rootId = '07173354-cc7a-4538-a143-d6321dbb5b09';
  await page.setViewportSize({ width: 2560, height: 1600 });
  await page.goto('/');
  await ready(page);
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible()) await advanced.click();
  await page.getByTestId('left-tab-workflows').click();
  await page.getByLabel('Search workflows').fill(title);
  await page.getByTestId('saved-workflow-auto-lifecycle-demo-20260911').getByRole('button').first().click();
  await expect(page.getByTestId(`user-block-${rootId}`)).toBeVisible();
  await page.getByTestId('arrange-graph').click();
  const mode = page.getByTestId('topbar-auto-switch');
  if ((await mode.getAttribute('aria-checked')) !== 'true') await mode.click();
  await retainRun(page, title, rootId);
  const after = await inspect(page);
  const owners = after.nodes.filter((node) =>
    node.data.blockInstanceV2?.effectiveGraph.nodes.some((inner) => inner.nodeId === 'models'),
  );
  expect(owners).toHaveLength(2);
  const taskId = owners[0]!.data.blockInstanceV2!.previewStates.find((state) => state.status === 'complete')!.taskId;
  expect(
    owners.every((owner) =>
      owner.data.blockInstanceV2!.previewStates.some((state) => state.status === 'complete' && state.taskId === taskId),
    ),
  ).toBe(true);
  const receipt = await (await page.request.get(`${backend}/runs/${taskId}`)).json();
  expect(receipt.task.runtimePreparation.workflowAuto.releases.length).toBeGreaterThan(0);
  expect(
    receipt.outputs.filter((item: { displayType: string }) => item.displayType === 'image').length,
  ).toBeGreaterThanOrEqual(2);
  await writeFile(
    `${process.env.MODIFF_REVIEW_OUTPUT_DIR}/lifecycle-native-proof.json`,
    JSON.stringify({ after, receipt }, null, 2),
  );
});
