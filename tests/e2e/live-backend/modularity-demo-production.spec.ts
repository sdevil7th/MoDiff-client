import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

type CapturedField = { display?: string; dataSource?: string; value?: unknown };
const isExecutionInput = (field: CapturedField) =>
  field.display !== 'output' && !field.display?.startsWith('ui_') && field.dataSource !== 'output';

test('deployed modularity workflow retains values through custom reload, refresh and execution', async ({ page }) => {
  const workflowId = process.env.MODIFF_DEMO_PRODUCTION_WORKFLOW;
  const moduleName = process.env.MODIFF_DEMO_MODULE;
  const baseline = process.env.MODIFF_DEMO_PRODUCTION_PHASE === 'baseline';
  const restoreOnly = process.env.MODIFF_DEMO_PRODUCTION_PHASE === 'restore';
  test.skip(
    !workflowId || !moduleName || process.env.MODIFF_DEMO_PRODUCTION !== '1',
    'Select the owned saved demo and explicitly approve its edited custom code.',
  );
  test.setTimeout(15 * 60_000);
  page.setDefaultTimeout(30_000);
  const backend = process.env.MODIFF_LIVE_BACKEND_URL || 'http://127.0.0.1:8088';
  const output = resolve(process.env.MODIFF_REVIEW_OUTPUT_DIR || 'artifacts/modularity-production');
  await mkdir(output, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const request = (path: string) => page.request.get(`${backend}${path}`, { timeout: 60_000 });
  const exportGraph = async (page: Page, name: string) => {
    await page.getByTestId('topbar-export').click();
    const pending = page.waitForEvent('download');
    await page.getByTestId('topbar-export-raw-workflow').click();
    const downloaded = await pending;
    const path = resolve(output, `${name}.workflow.json`);
    await downloaded.saveAs(path);
    return JSON.parse(await readFile(path, 'utf8'));
  };
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(backend, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const empty = page.getByRole('button', { name: 'Empty workflow', exact: true });
  if (await empty.isVisible()) await empty.click();
  await page.getByRole('radio', { name: 'Developer', exact: true }).check();
  await page.getByTestId('left-tab-workflows').click();
  await page.getByRole('button', { name: 'My workflows', exact: true }).click();
  await page.getByLabel('Search workflows').fill(process.env.MODIFF_DEMO_PRODUCTION_SEARCH || 'Demo Ready');
  await page.getByTestId(`saved-workflow-${workflowId}`).getByRole('button').first().click();
  const before = await exportGraph(page, 'before-reload');
  const custom = before.nodes.find((node: { data: { module: string } }) => node.data.module === `custom.${moduleName}`);
  expect(custom).toBeTruthy();
  let originalSha256: string | undefined;
  if (!baseline && !restoreOnly) {
    expect(
      process.env.MODIFF_DEMO_BASELINE_IMAGE,
      'Retain the unchanged workflow baseline before editing code.',
    ).toBeTruthy();
    const originalBytes = await readFile(process.env.MODIFF_DEMO_BASELINE_IMAGE!);
    originalSha256 = createHash('sha256').update(originalBytes).digest('hex');
    await writeFile(resolve(output, 'original-custom.png'), originalBytes);
  }
  if (!baseline) {
    await page.getByTestId('left-tab-nodes').click();
    await page.getByRole('button', { name: 'Custom nodes', exact: true }).click();
    const dialog = page.getByTestId('custom-extensions-dialog');
    const card = dialog.getByText(moduleName!, { exact: true }).locator('..').locator('..');
    await card.getByRole('button', { name: 'Review reload', exact: true }).click();
    const review = dialog.getByRole('region', { name: 'Extension review' });
    await expect(review.getByRole('checkbox')).not.toBeChecked();
    await review.getByRole('checkbox').check();
    const enabled = page.waitForResponse((response) => response.url().endsWith(`/custom_modules/${moduleName}/enable`));
    await review.getByRole('button', { name: 'Enable and reload code', exact: true }).click();
    const approval = await (await enabled).json();
    expect(approval.error).toBeFalsy();
    await writeFile(resolve(output, 'code-approval.json'), JSON.stringify(approval, null, 2));
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  }
  await page.getByTestId('topbar-save-workflow').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const after = await exportGraph(page, 'after-refresh');
  expect(after.edges).toEqual(before.edges);
  for (const original of before.nodes) {
    const restored = after.nodes.find((item: { id: string }) => item.id === original.id);
    expect(restored.position).toEqual(original.position);
    for (const [key, field] of Object.entries(original.data.params) as Array<[string, CapturedField]>)
      if (isExecutionInput(field)) expect(restored.data.params[key]?.value).toEqual(field.value);
  }
  if (restoreOnly) {
    expect(errors).toEqual([]);
    await writeFile(
      resolve(output, 'receipt.json'),
      JSON.stringify(
        { workflowId, moduleName, phase: 'restore-original-code', retained: true, production: true, errors },
        null,
        2,
      ),
    );
    return;
  }
  const queue = await (await request('/queue')).json();
  expect(queue.current).toBeFalsy();
  expect(Object.keys(queue.queued || {})).toHaveLength(0);
  const completedBaseline = process.env.MODIFF_DEMO_COMPLETED_BASELINE_TASK;
  let accepted: { task_id: string };
  if (completedBaseline) {
    expect(baseline, 'Only capture an explicitly completed, unchanged baseline.').toBe(true);
    expect(queue.recent[0]?.task_id, 'Another run must not have replaced these cached previews.').toBe(
      completedBaseline,
    );
    expect(queue.recent[0]?.status).toBe('completed');
    accepted = { task_id: completedBaseline };
  } else {
    await expect(page.getByTestId('studio-run')).toBeEnabled();
    const submission = page.waitForResponse(
      (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    );
    await page.getByTestId('studio-run').click();
    accepted = await (await submission).json();
    expect(accepted.task_id).toBeTruthy();
    await writeFile(resolve(output, 'submission.json'), JSON.stringify(accepted, null, 2));
    await expect
      .poll(
        async () => {
          const queue = await (await request('/queue')).json();
          const task = [queue.current, ...(queue.recent || [])].find((item) => item?.task_id === accepted.task_id);
          if (task && ['failed', 'cancelled'].includes(task.status)) throw new Error(JSON.stringify(task));
          return task?.status;
        },
        { timeout: 10 * 60_000, intervals: [2000] },
      )
      .toBe('completed');
  }
  const run = await (await request(`/runs/${accepted.task_id}`)).json();
  expect(run.workflow_id).toBe(workflowId);
  expect(run.task.status).toBe('completed');
  if (completedBaseline) {
    expect(run.workflow_snapshot.edges).toEqual(after.edges);
    for (const node of after.nodes) {
      const consumed = run.workflow_snapshot.nodes.find((item: { id: string }) => item.id === node.id);
      expect(consumed).toBeTruthy();
      for (const [key, field] of Object.entries(node.data.params) as Array<[string, CapturedField]>)
        if (isExecutionInput(field)) expect(consumed.data.params[key]?.value).toEqual(field.value);
    }
  }
  await writeFile(resolve(output, 'run.json'), JSON.stringify(run, null, 2));
  const imageInput = after.edges.find(
    (edge: { target: string; targetHandle: string }) => edge.target === custom.id && edge.targetHandle === 'image',
  );
  expect(imageInput).toBeTruthy();
  const previewFor = (source: string, sourceHandle: string) => {
    const edge = after.edges.find(
      (edge: { source: string; sourceHandle: string; target: string }) =>
        edge.source === source &&
        edge.sourceHandle === sourceHandle &&
        after.nodes.some(
          (node: { id: string; data: { module: string; action: string } }) =>
            node.id === edge.target && node.data.module === 'modules.Image' && node.data.action === 'Preview',
        ),
    );
    expect(edge, 'Use the visible preview: intermediate nodes intentionally do not cache images.').toBeTruthy();
    return edge.target;
  };
  const sourceImage = await request(
    `/cache/${previewFor(imageInput.source, imageInput.sourceHandle)}/output/0?format=PNG`,
  );
  expect(sourceImage.ok()).toBe(true);
  const sourceBytes = await sourceImage.body();
  const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
  if (!baseline) {
    const originalSource = await readFile(resolve(process.env.MODIFF_DEMO_BASELINE_IMAGE!, '..', 'custom-input.png'));
    expect(sourceSha256, 'Code-only comparison requires the exact same generator image.').toBe(
      createHash('sha256').update(originalSource).digest('hex'),
    );
  }
  await writeFile(resolve(output, 'custom-input.png'), sourceBytes);
  const decoded = await request(`/cache/${previewFor(custom.id, 'out_image')}/output/0?format=PNG`);
  expect(decoded.ok()).toBe(true);
  const bytes = await decoded.body();
  const customSha256 = createHash('sha256').update(bytes).digest('hex');
  if (!baseline)
    expect(customSha256, 'The approved code edit changes the custom output without rewiring.').not.toBe(originalSha256);
  await writeFile(resolve(output, 'reloaded-custom.png'), bytes);
  await page.screenshot({ path: resolve(output, 'deployed-reloaded.png') });
  expect(errors).toEqual([]);
  await writeFile(
    resolve(output, 'receipt.json'),
    JSON.stringify(
      {
        workflowId,
        moduleName,
        taskId: accepted.task_id,
        retained: true,
        production: true,
        phase: baseline ? 'baseline' : 'code-reload',
        originalSha256,
        customSha256,
        sourceSha256,
        reusedCompletedTask: completedBaseline || null,
        errors,
      },
      null,
      2,
    ),
  );
});
