import { expect, test } from '@playwright/test';
import { waitForRecursiveDomGeometry } from './blockDomGeometry';

test('deployed FLUX image-to-image preserves nested containment after resize and refresh', async ({ page }) => {
  test.skip(!process.env.MODIFF_PRODUCTION_FRONTEND_URL, 'Select the deployed frontend explicitly.');
  test.setTimeout(5 * 60 * 1000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(process.env.MODIFF_PRODUCTION_FRONTEND_URL!, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible()) await advanced.click();
  await page.getByTestId('workflow-tab-new').click();
  await expect(advanced).toBeVisible();
  await advanced.click();
  const search = page.getByLabel('Search nodes');
  if (!(await search.isVisible())) await page.getByTestId('left-tab-nodes').click();
  await search.fill('Flux — Image To Image');
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  const disclosure = group.getByRole('button').first();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  await group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: 'Flux — Image To Image' }).click();
  const root = page.locator('[data-block-source="diffusers_catalog"]');
  await expect(root).toHaveCount(1, { timeout: 120_000 });
  const prompt = root.getByLabel('prompt', { exact: true });
  const value = 'Keep the museum workbench composition and engraved brass astrolabe; change the velvet to burgundy.';
  await prompt.fill(value);
  await prompt.blur();
  const grip = await root.getByTestId('node-resize-grip').boundingBox();
  if (!grip) throw new Error('The deployed root has no visible resize grip.');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 120, grip.y + 80, { steps: 8 });
  await page.mouse.up();
  await root.getByLabel('Expand block', { exact: true }).click();
  await waitForRecursiveDomGeometry(page);
  await page.getByTestId('arrange-graph').click();
  await waitForRecursiveDomGeometry(page);
  const nested = page.locator('[data-block-projection="modular-diffusers"] [aria-label^="Expand "]').first();
  await expect(nested).toBeVisible();
  await nested.click();
  await waitForRecursiveDomGeometry(page);
  await page.getByTestId('arrange-graph').click();
  await waitForRecursiveDomGeometry(page);
  await page.screenshot({ path: test.info().outputPath('deployed-flux-nested.png') });
  await root.getByLabel('Collapse block', { exact: true }).click();
  await page.getByTestId('topbar-save-workflow').click();
  await page.getByTestId('save-workflow-name').fill(`FLUX deployed containment ${Date.now()}`);
  await page.getByTestId('confirm-save-workflow').click();
  await expect(page.getByTestId('save-workflow-dialog')).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(prompt).toHaveValue(value, { timeout: 120_000 });
});

test('deployed Klein T2I selector preserves independent prompts across Save and refresh', async ({ page }) => {
  test.skip(!process.env.MODIFF_PRODUCTION_FRONTEND_URL, 'Select the deployed frontend explicitly.');
  test.setTimeout(5 * 60 * 1000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(process.env.MODIFF_PRODUCTION_FRONTEND_URL!, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible()) await advanced.click();
  await page.getByTestId('workflow-tab-new').click();
  if (await advanced.isVisible()) await advanced.click();
  const search = page.getByLabel('Search nodes');
  if (!(await search.isVisible())) await page.getByTestId('left-tab-nodes').click();
  await search.fill('Flux2 Klein Base — Text To Image');
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  const disclosure = group.getByRole('button').first();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Flux2 Klein Base — Text To Image' });
  await expect(row).toHaveCount(1);
  await row.click();
  const root = page.locator('[data-block-source="diffusers_catalog"]');
  await expect(root).toHaveCount(1, { timeout: 120_000 });
  const selector = root.locator('[data-testid^="block-v2-route-select-"]');
  const prompt = root.getByLabel('prompt', { exact: true });
  await expect(selector).toHaveText('FLUX.2 Klein Base');
  await prompt.fill('A brass astronomical instrument on navy velvet under an arched workshop window.');
  const switchTo = async (label: string) => {
    await selector.click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await page
      .locator('[data-testid^="switch-block-route-v1-"]')
      .getByRole('button', { name: 'Keep draft and switch', exact: true })
      .click();
    await expect(selector).toHaveText(label, { timeout: 120_000 });
  };
  await switchTo('FLUX.2 Klein');
  await expect(prompt).toHaveValue('A brass astronomical instrument on navy velvet under an arched workshop window.');
  await prompt.fill('A miniature observatory with a copper dome beside a brass astronomical instrument.');
  await switchTo('FLUX.2 Klein Base');
  await expect(prompt).toHaveValue('A brass astronomical instrument on navy velvet under an arched workshop window.');
  await page.getByTestId('topbar-save-workflow').click();
  await page.getByTestId('save-workflow-name').fill(`Klein deployed selector ${Date.now()}`);
  await page.getByTestId('confirm-save-workflow').click();
  await expect(page.getByTestId('save-workflow-dialog')).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(selector).toHaveText('FLUX.2 Klein Base', { timeout: 120_000 });
  await switchTo('FLUX.2 Klein');
  await expect(prompt).toHaveValue(
    'A miniature observatory with a copper dome beside a brass astronomical instrument.',
  );
  await page.screenshot({ path: test.info().outputPath('deployed-klein-selector.png'), fullPage: false });
});
