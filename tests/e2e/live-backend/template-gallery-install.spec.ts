import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('Setup installs the immutable Gallery through the app Hub pull with explicit confirmation', async ({ page }) => {
  test.skip(process.env.MODIFF_INSTALL_TEMPLATE_GALLERY !== '1', 'Explicitly select the real Gallery installation.');
  test.setTimeout(15 * 60 * 1000);
  const evidence = `${process.env.MODIFF_REVIEW_OUTPUT_DIR ?? 'artifacts'}/template-gallery-install`;
  await mkdir(evidence, { recursive: true });
  const pageErrors: string[] = [];
  const installRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/template_gallery/install') installRequests.push(request.method());
  });
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 120_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await page.evaluate(() => window.__MODIFF_E2E__!.openWorkspacePanelForTest('setup'));
  const card = page.getByTestId('template-gallery-setup-card');
  await expect(card).toBeVisible();
  const statusBefore = await page.request.get('/template_gallery/status');
  expect(statusBefore.ok()).toBe(true);
  const before = await statusBefore.json();
  let result: unknown = null;
  if (!before.complete) {
    await expect(card).toContainText('Not installed', { timeout: 30_000 });
    await page.getByTestId('template-gallery-install').click();
    const dialog = page.getByRole('dialog', { name: 'Install Template Gallery assets?', exact: true });
    await expect(dialog).toContainText('immutable revision');
    await expect(dialog).toContainText('cached models will not be removed');
    expect(installRequests).toEqual([]);
    await page.screenshot({ path: `${evidence}/confirmation.png` });
    const response = page.waitForResponse(
      (candidate) => new URL(candidate.url()).pathname === '/template_gallery/install',
      { timeout: 12 * 60 * 1000 },
    );
    await dialog.getByRole('button', { name: 'Install', exact: true }).click();
    const installed = await response;
    result = await installed.json();
    expect(installed.ok()).toBe(true);
    expect(result).toMatchObject({ error: false, complete: true });
    expect(installRequests).toEqual(['POST']);
  }
  await expect(card).toContainText('Ready', { timeout: 120_000 });
  await expect(card).toContainText('356 files');
  const after = await (await page.request.get('/template_gallery/status')).json();
  expect(after).toMatchObject({ complete: true, installed: true, assetCount: 356, repairRequired: false });
  await page.screenshot({ path: `${evidence}/ready.png` });
  await writeFile(`${evidence}/result.json`, JSON.stringify({ before, result, after, pageErrors }, null, 2));
  expect(pageErrors).toEqual([]);
});
