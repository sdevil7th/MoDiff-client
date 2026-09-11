import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Request } from '@playwright/test';

test('workflow save remains responsive during Model Manager planning', async ({ page }) => {
  test.skip(process.env.MODIFF_RUN_WORKFLOW_SAVE_PERFORMANCE !== '1', 'Select the live performance check explicitly.');
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!outputDirectory, 'An isolated evidence directory is required.');
  test.setTimeout(5 * 60 * 1000);
  await mkdir(outputDirectory!, { recursive: true });
  const started = new Map<Request, number>();
  const timings: { path: string; method: string; milliseconds: number }[] = [];
  const planningPayloads: unknown[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/auto_resource/plans' || path.startsWith('/workflows')) started.set(request, Date.now());
    if (path === '/auto_resource/plans') planningPayloads.push(request.postDataJSON());
  });
  page.on('requestfinished', (request) => {
    const start = started.get(request);
    if (start !== undefined)
      timings.push({
        path: new URL(request.url()).pathname,
        method: request.method(),
        milliseconds: Date.now() - start,
      });
  });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('workflow-save-performance')) return;
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('workflow-save-performance', 'initialized');
  });
  await page.goto(process.env.MODIFF_WORKFLOW_SAVE_FRONTEND_URL || '/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible()) await advanced.click();
  await page.getByTestId('workflow-tab-new').click();
  if (await advanced.isVisible()) await advanced.click();
  const search = page.getByLabel('Search nodes');
  if (!(await search.isVisible())) await page.getByTestId('left-tab-nodes').click();
  await search.fill('Flux2 Klein — Text To Image');
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true')
    await group.getByRole('button').first().click();
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Flux2 Klein — Text To Image' });
  await expect(row).toHaveCount(1);
  await row.click();
  const root = page.locator('[data-block-source="diffusers_catalog"]');
  await expect(root).toHaveCount(1, { timeout: 60_000 });
  const prompt = 'A precise brass astrolabe on a navy velvet workbench beneath an arched museum window.';
  await root.getByLabel('prompt', { exact: true }).fill(prompt);
  await root.getByLabel('prompt', { exact: true }).press('Tab');
  await page.getByTestId('topbar-models').click();
  const manager = page.getByTestId('model-manager-dialog');
  await expect(manager).toBeVisible();
  await expect.poll(() => planningPayloads.length, { timeout: 30_000 }).toBeGreaterThan(0);
  await manager.getByTestId('model-manager-close').click();

  const workflowName = `FLUX save responsiveness ${Date.now()}`;
  await page.getByTestId('topbar-save-workflow').click();
  const dialog = page.getByTestId('save-workflow-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('save-workflow-name').fill(workflowName);
  const confirmedAt = Date.now();
  await page.getByTestId('confirm-save-workflow').click({ timeout: 120_000 });
  await expect(dialog).toHaveCount(0, { timeout: 120_000 });
  const saveMilliseconds = Date.now() - confirmedAt;
  await expect
    .poll(() => timings.filter(({ path }) => path === '/auto_resource/plans').length, { timeout: 30_000 })
    .toBe(planningPayloads.length);
  const completedTimings = [...timings];
  const completedPlanningPayloads = [...planningPayloads];
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await expect(root).toHaveCount(1, { timeout: 60_000 });
  await expect(root.getByLabel('prompt', { exact: true })).toHaveValue(prompt);
  await writeFile(
    `${outputDirectory}/workflow-save-performance.json`,
    `${JSON.stringify({ frontendUrl: page.url(), workflowName, saveMilliseconds, timings: completedTimings, planningPayloads: completedPlanningPayloads, saveRefresh: true }, null, 2)}\n`,
  );
  console.log(`[workflow-save-performance] save confirmed in ${saveMilliseconds}ms`);
  if (process.env.MODIFF_WORKFLOW_SAVE_BUDGET_MS)
    expect(saveMilliseconds).toBeLessThan(Number(process.env.MODIFF_WORKFLOW_SAVE_BUDGET_MS));
});
