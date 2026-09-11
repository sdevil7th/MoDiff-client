import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('live Model Manager and Settings remain bounded and usable without installing models', async ({ page }) => {
  test.skip(process.env.MODIFF_RUN_DIALOG_LAYOUT !== '1', 'Opt in to the live dialog review.');
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!outputDirectory, 'A separate review directory is required.');
  test.setTimeout(5 * 60 * 1000);
  await mkdir(outputDirectory!, { recursive: true });
  const errors: string[] = [];
  const mutations: string[] = [];
  const initializedDrafts = new Map<string, number>();
  const startedAt = Date.now();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'PUT' && path.startsWith('/workflows/')) {
      const draft = request.postDataJSON();
      // A fresh browser initializes and autosaves its own empty workspace.
      // Permit only that new, empty draft; never allow an existing graph edit.
      if (
        typeof draft?.createdAt === 'number' &&
        draft.createdAt >= startedAt &&
        Array.isArray(draft?.snapshot?.nodes) &&
        draft.snapshot.nodes.length === 0 &&
        Array.isArray(draft?.snapshot?.edges) &&
        draft.snapshot.edges.length === 0
      ) {
        initializedDrafts.set(request.url(), draft.createdAt);
        return;
      }
    }
    if (
      request.method() !== 'GET' &&
      /^\/(?:graph|hf_download|workflows)(?:\/|$)/u.test(new URL(request.url()).pathname)
    )
      mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(process.env.MODIFF_DIALOG_FRONTEND_URL || '/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible()) await advanced.click();
  await page.getByTestId('topbar-models').click();
  const manager = page.getByTestId('model-manager-dialog');
  await expect(manager.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({ timeout: 120_000 });
  await page.screenshot({ path: `${outputDirectory}/models-all.png` });
  await manager.getByRole('tab', { name: 'Installed', exact: true }).click();
  await expect(manager.getByRole('tab', { name: 'Installed', exact: true })).toHaveAttribute('aria-selected', 'true');
  await manager.getByLabel('Filter models and artifacts').fill('qwen');
  await expect(manager.getByTestId('model-manager-installed')).toContainText('Qwen');
  await page.screenshot({ path: `${outputDirectory}/models-installed-qwen.png`, animations: 'disabled' });
  await manager.getByLabel('Filter models and artifacts').fill('');
  await manager.getByRole('tab', { name: 'All models', exact: true }).click();
  const geometry = [];
  for (const viewport of [
    { width: 1280, height: 480 },
    { width: 390, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    const toolbar = manager.getByTestId('model-manager-toolbar');
    const before = await toolbar.boundingBox();
    await manager.locator('[data-dialog-scroll-body]').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const after = await toolbar.boundingBox();
    const footer = await manager.locator('footer').boundingBox();
    const panel = await manager.boundingBox();
    expect(after!.y).toBeCloseTo(before!.y, 0);
    expect(footer!.y + footer!.height).toBeLessThan(viewport.height);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width);
    expect(
      await manager.locator('[data-dialog-scroll-body]').evaluate((element) => element.clientHeight),
    ).toBeGreaterThan(60);
    geometry.push({ viewport, panel, toolbar: after, footer });
    await page.screenshot({ path: `${outputDirectory}/models-${viewport.width}x${viewport.height}.png` });
  }
  await manager.getByTestId('model-manager-close').click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByTestId('settings-dialog');
  await expect(settings).toBeVisible();
  await page.screenshot({ path: `${outputDirectory}/settings-preferences.png` });
  await settings.getByRole('tab', { name: 'About', exact: true }).click();
  await expect(settings.getByRole('tab', { name: 'About', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.setViewportSize({ width: 390, height: 540 });
  const footer = await settings.locator('footer').boundingBox();
  expect(footer!.y + footer!.height).toBeLessThan(540);
  await page.screenshot({ path: `${outputDirectory}/settings-narrow.png`, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('left-tab-nodes').click();
  await page.getByLabel('Search nodes').fill('Qwen Image');
  const clusters = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  if ((await clusters.getByRole('button').first().getAttribute('aria-expanded')) !== 'true')
    await clusters.getByRole('button').first().click();
  const row = clusters
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(row).toHaveCount(1);
  await row.scrollIntoViewIfNeeded();
  const label = row.locator('[data-catalog-entry-label]');
  expect((await label.boundingBox())!.width).toBeGreaterThan(90);
  expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(
    await row.evaluate((element) => {
      let depth = 0;
      for (let parent = element.parentElement; parent; parent = parent.parentElement)
        if (parent.dataset.testid?.startsWith('node-subgroup-')) depth += 1;
      return depth;
    }),
  ).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: `${outputDirectory}/nested-qwen-library.png` });
  const userNodes = page.getByTestId('node-group-User-Nodes');
  if ((await userNodes.getByRole('button').first().getAttribute('aria-expanded')) !== 'true')
    await userNodes.getByRole('button').first().click();
  await userNodes.getByLabel('Group User Nodes by').click();
  await page.getByRole('option', { name: 'By saved workflow context', exact: true }).click();
  await expect(userNodes.getByLabel('Group User Nodes by')).toContainText('By saved workflow context');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  const savedRow = userNodes.locator('[data-testid^="user-block-row-"]').first();
  await expect(savedRow).toBeVisible();
  await expect(savedRow).toContainText(/Revision|Saved/u);
  await savedRow.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${outputDirectory}/user-nodes-by-workflow.png`, animations: 'disabled' });
  await userNodes.getByTestId('import-hugging-face-user-node').click();
  const importer = page.getByTestId('import-hugging-face-user-node-dialog');
  await expect(importer).toBeVisible();
  await page.screenshot({ path: `${outputDirectory}/hub-import.png`, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 640 });
  await page.screenshot({ path: `${outputDirectory}/hub-import-narrow.png`, animations: 'disabled' });
  expect(
    await importer
      .locator('[data-dialog-scroll-body]')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(importer).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press('Control+Shift+S');
  const workflowSave = page.getByTestId('save-workflow-dialog');
  await expect(workflowSave).toBeVisible();
  await page.screenshot({ path: `${outputDirectory}/workflow-save.png`, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(workflowSave).toHaveCount(0);
  await page.getByTestId('topbar-gallery').click();
  await page.getByTestId('gallery-download-image-0').click();
  const exporter = page.getByTestId('media-export-dialog');
  await expect(exporter).toBeVisible();
  await expect(exporter.getByLabel('Download format')).toBeEnabled();
  await page.screenshot({ path: `${outputDirectory}/media-export.png`, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 640 });
  expect(
    await exporter
      .locator('[data-dialog-scroll-body]')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: `${outputDirectory}/media-export-narrow.png`, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(exporter).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(mutations).toEqual([]);
  await page.close();
  const removedEmptyDrafts: string[] = [];
  for (const [url, createdAt] of initializedDrafts) {
    const response = await page.request.get(url);
    const current = await response.json();
    expect(response.ok()).toBe(true);
    expect(current.createdAt).toBe(createdAt);
    expect(current.snapshot.nodes).toEqual([]);
    expect(current.snapshot.edges).toEqual([]);
    expect((await page.request.delete(url)).ok()).toBe(true);
    removedEmptyDrafts.push(new URL(url).pathname);
  }
  await writeFile(
    `${outputDirectory}/dialog-proof.json`,
    `${JSON.stringify({ frontend: page.url(), geometry, errors, mutations, removedEmptyDrafts, settingsEscape: true, nestedLibraryDepth: 3, duplicateQwenTextToImageRows: 0 }, null, 2)}\n`,
  );
});
