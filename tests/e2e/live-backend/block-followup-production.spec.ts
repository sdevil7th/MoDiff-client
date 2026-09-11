import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('installed custom Qwen resource panel uses exact Block scope without inference', async ({ page }) => {
  const workflowId = process.env.MODIFF_FOLLOWUP_DEMO_WORKFLOW_ID;
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!workflowId || !directory, 'Requires the retained follow-up workflow and evidence directory.');
  test.setTimeout(180_000);
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  const submissions: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/graph') submissions.push(request.url());
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(process.env.MODIFF_LIVE_BACKEND_URL ?? 'http://127.0.0.1:8088');
  await expect(page.getByTestId('left-tab-workflows')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible()) await advanced.click();
  await page.getByTestId('left-tab-workflows').click();
  await page.getByLabel('Search workflows').fill('Qwen Demo 05');
  await page.getByTestId(`saved-workflow-${workflowId}`).getByRole('button').first().click();
  await page.getByTestId('topbar-workflow-resources').click();
  const panel = page.getByTestId('workflow-resource-assessment');
  await expect(panel).toContainText('1 adapters');
  await page.getByTestId('assess-workflow-resources').click();
  await expect(panel).toContainText('Available RAM:', { timeout: 90_000 });
  await expect(panel).toContainText('Current: Qwen/Qwen-Image-Edit-2511');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await mkdir(directory!, { recursive: true });
  await page.screenshot({ path: `${directory}/installed-workflow-resource-assessment.png` });
  await page.getByLabel('Resource assessment scope').click();
  await page
    .getByRole('option', { name: /^Only /u })
    .first()
    .click();
  await expect(panel).toContainText('0 adapters');
  await expect(panel).not.toContainText('Available RAM:');
  await page.getByTestId('assess-workflow-resources').click();
  await expect(panel).toContainText('Available RAM:', { timeout: 90_000 });
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: `${directory}/installed-block-resource-assessment.png` });
  await writeFile(
    `${directory}/installed-resource-proof.json`,
    JSON.stringify({ workflowId, errors, submissions, panel: await panel.innerText() }, null, 2),
  );
  expect(errors).toEqual([]);
  expect(submissions).toEqual([]);
});
