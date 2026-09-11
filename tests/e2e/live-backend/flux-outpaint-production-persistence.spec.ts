import { expect, test, type Locator } from '@playwright/test';

test('deployed outpaint keeps saved strength and duplicate isolation while new Blocks use the corrected seed', async ({
  page,
}) => {
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
  const label = 'FLUX.2 Klein Inpaint (Standard Diffusers) — Outpaint';
  await search.fill(label);
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  const disclosure = group.getByRole('button').first();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: label });
  await expect(row).toHaveCount(1);
  await row.click();
  const roots = page.locator('[data-block-source="diffusers_catalog"]');
  await expect(roots).toHaveCount(1, { timeout: 120_000 });
  const strength = async (root: Locator) => {
    const input = root.locator('[data-key="strength"] input').first();
    if (!(await input.isVisible())) {
      const toggles = root.getByRole('button', { name: 'Advanced', exact: true });
      for (const toggle of await toggles.all())
        if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    }
    await expect(input).toBeVisible();
    return input;
  };
  const original = roots.first();
  expect(Number(await (await strength(original)).inputValue())).toBe(1);
  const prompt = original.locator('[data-key="prompt"] textarea').first();
  const savedPrompt =
    'Extend the quiet conservation workshop with matching walnut grain and soft window light; preserve the central clock.';
  await prompt.fill(savedPrompt);
  await prompt.blur();
  await (await strength(original)).fill('0.85');
  await (await strength(original)).blur();
  let named = false;
  const savedName = `FLUX outpaint saved-value regression ${Date.now()}`;
  const save = async () => {
    await page.getByTestId('topbar-save-workflow').click();
    if (!named) {
      await expect(page.getByTestId('save-workflow-dialog')).toBeVisible();
      await page.getByTestId('save-workflow-name').fill(savedName);
      await page.getByTestId('confirm-save-workflow').click();
      await expect(page.getByTestId('save-workflow-dialog')).toHaveCount(0);
      named = true;
    } else {
      // Saving a named workflow writes in place; it does not open Save As.
      await expect(page.getByText(`Saved ${savedName} to My workflows`, { exact: true })).toBeVisible();
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
    await expect(roots.first()).toBeVisible();
  };
  await save();
  expect(Number(await (await strength(original)).inputValue())).toBe(0.85);
  await expect(prompt).toHaveValue(savedPrompt);
  await original.locator('header').first().click();
  await page.getByTestId('selection-toolbar-duplicate').click();
  await expect(roots).toHaveCount(2);
  const clone = roots.nth(1);
  expect(Number(await (await strength(clone)).inputValue())).toBe(0.85);
  await (await strength(clone)).fill('0.65');
  await (await strength(clone)).blur();
  expect(Number(await (await strength(original)).inputValue())).toBe(0.85);
  await save();
  await expect(roots).toHaveCount(2);
  expect(Number(await (await strength(original)).inputValue())).toBe(0.85);
  expect(Number(await (await strength(clone)).inputValue())).toBe(0.65);
  await search.fill(label);
  await row.click();
  await expect(roots).toHaveCount(3);
  expect(Number(await (await strength(roots.nth(2))).inputValue())).toBe(1);
  expect(Number(await (await strength(original)).inputValue())).toBe(0.85);
  await page.screenshot({ path: test.info().outputPath('outpaint-saved-values.png') });
});
