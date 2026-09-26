import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

test('recover exact completed fashion output without resubmitting generation', async ({ page }) => {
  const submission = process.env.MODIFF_FASHION_CAPTURE_SUBMISSION;
  test.skip(!submission, 'Select an existing submitted task receipt.');
  test.setTimeout(5 * 60_000);
  page.setDefaultTimeout(30_000);
  const prior = JSON.parse(await readFile(submission!, 'utf8'));
  const out = resolve(process.env.MODIFF_REVIEW_OUTPUT_DIR!);
  await mkdir(out, { recursive: true });
  const run = await (await page.request.get(`/runs/${prior.taskId}`, { timeout: 60_000 })).json();
  expect(run.task.status).toBe('completed');
  expect(run.outputs.some((item: { nodeId: string }) => item.nodeId === prior.preview)).toBe(true);
  let submissions = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/graph') submissions++;
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated), null, {
    timeout: 120_000,
  });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const empty = page.getByRole('button', { name: 'Empty workflow', exact: true });
  if (await empty.isVisible()) await empty.click();
  await page.getByRole('radio', { name: 'Developer', exact: true }).check();
  if (!(await page.getByRole('button', { name: 'My workflows', exact: true }).isVisible()))
    await page.getByTestId('left-tab-workflows').click();
  await page.getByRole('button', { name: 'My workflows', exact: true }).click();
  await page.getByLabel('Search workflows').fill('Fashion Study');
  await page.getByTestId(`saved-workflow-${run.workflow_id}`).getByRole('button').first().click();
  await page.getByTestId('arrange-graph').click();
  const preview = page.locator(`.react-flow__node[data-id="${prior.preview}"] img`).first();
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((item) => (item as HTMLImageElement).naturalWidth)).toBe(1024);
  const response = await page.request.get(`/cache/${prior.preview}/output/0?format=PNG`, { timeout: 30_000 });
  expect(response.ok()).toBe(true);
  const bytes = await response.body();
  await writeFile(resolve(out, 'output.png'), bytes);
  await writeFile(resolve(out, 'run.json'), JSON.stringify(run, null, 2));
  await writeFile(
    resolve(out, 'final.workflow.json'),
    JSON.stringify(await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph()), null, 2),
  );
  await page.screenshot({ path: resolve(out, 'frontend.png') });
  expect(submissions).toBe(0);
  await writeFile(
    resolve(out, 'receipt.json'),
    JSON.stringify(
      {
        ...prior,
        request: undefined,
        recoveredWithoutGeneration: true,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        visualReview: 'separate',
      },
      null,
      2,
    ),
  );
});
