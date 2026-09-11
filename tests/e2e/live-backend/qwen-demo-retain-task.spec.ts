import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { backend, output, ready, inspect, retainTask } from './qwenDemoGestures';

test('retain the already submitted Block-only Qwen run without submitting it again', async ({ page }) => {
  const taskId = process.env.MODIFF_RETAIN_QWEN_TASK_ID;
  test.skip(!output || !taskId, 'Opt in to retaining an existing demo task.');
  test.setTimeout(60 * 60_000);
  page.setDefaultTimeout(30_000);
  const proof = JSON.parse(await readFile(`${output}/Qwen-block-only-scope-proof.json`, 'utf8'));
  expect(proof.taskId).toBe(taskId);
  const executable = JSON.stringify(proof.submitted.nodes);
  for (const id of proof.outsideNodeIds) expect(executable).not.toContain(id);
  expect(executable).not.toContain('Lightning');
  const run = await (await page.request.get(`${backend}/runs/${taskId}`)).json();
  const rootId = run.workflow_snapshot.nodes.find(
    (node: { data: { blockInstanceV2?: unknown } }) => node.data.blockInstanceV2,
  ).id;
  const submissions: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/graph') submissions.push(request.url());
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await ready(page);
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await page.getByTestId('left-tab-workflows').click();
  await page.getByLabel('Search workflows').fill('Qwen Demo');
  await page.getByTestId(`saved-workflow-${run.workflow_id}`).getByRole('button').first().click();
  await expect.poll(async () => (await inspect(page)).nodes.some((node) => node.id === rootId)).toBe(true);
  await page.getByTestId('arrange-graph').click();
  await retainTask(page, run.workflow_title, rootId, taskId!);
  expect(submissions).toEqual([]);
});
