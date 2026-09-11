import { expect, test } from '@playwright/test';
import { mkdir, access, writeFile } from 'node:fs/promises';
import { waitForRecursiveDomGeometry } from './blockDomGeometry';

for (const label of [
  'Mini Max Music3',
  'ACE-Step — Text To Audio',
  'LongCat AudioDiT — Text To Audio',
  'AudioLDM2 — Text To Audio',
]) {
  test(`served audio Block: ${label}`, async ({ page }) => {
    test.skip(process.env.MODIFF_RUN_AUDIO_PRODUCTION !== '1', 'Explicit served-build acceptance.');
    test.setTimeout(process.env.MODIFF_AUDIO_RESTART_MARKER ? 30 * 60_000 : 180_000);
    page.setDefaultTimeout(30_000);
    const output = process.env.MODIFF_REVIEW_OUTPUT_DIR;
    if (!output) throw new Error('Private evidence directory required.');
    await mkdir(output, { recursive: true, mode: 0o700 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('http://127.0.0.1:8088/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });
    const advanced = page.getByRole('button', { name: /Advanced workflow/u });
    // Active server runs restore their workflow into a fresh browser; that is
    // not the empty-session chooser. Never modify the restored running graph.
    await expect(advanced.or(page.locator('.react-flow__node').first()).first()).toBeVisible({ timeout: 90_000 });
    if (await advanced.isVisible()) await advanced.click();
    await page.getByTestId('workflow-tab-new').click();
    if (await advanced.isVisible()) await advanced.click();
    const search = page.getByLabel('Search nodes');
    if (!(await search.isVisible())) await page.getByTestId('left-tab-nodes').click();
    await search.fill(label);
    const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
    const disclosure = group.getByRole('button').first();
    if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
    await group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: label }).click();
    const root = page.locator('[data-block-source="diffusers_catalog"]');
    await expect(root).toHaveCount(1);
    const prompt = root.getByLabel('prompt', { exact: true });
    const value = `A carefully arranged chamber ensemble with cello, felt piano and brushed percussion. ${label} production persistence check.`;
    await prompt.fill(value);
    await prompt.blur();
    const grip = await root.getByTestId('node-resize-grip').boundingBox();
    expect(grip).toBeTruthy();
    await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip!.x - 100, grip!.y - 80, { steps: 12 });
    await page.mouse.up();
    await root.getByLabel('Expand block', { exact: true }).click();
    await page.getByTestId('arrange-graph').click();
    await waitForRecursiveDomGeometry(page);
    const descendants = page.locator('[data-block-projection="modular-diffusers"] [aria-label^="Expand "]');
    for (let level = 0; level < 10 && (await descendants.count()); level += 1) {
      await descendants.first().click();
      await page.getByTestId('arrange-graph').click();
      await waitForRecursiveDomGeometry(page);
    }
    await expect(descendants).toHaveCount(0);
    await page.screenshot({ path: `${output}/${label.split(' ')[0].toLowerCase()}-expanded.png` });
    await root.getByLabel('Collapse block', { exact: true }).click();
    await expect(prompt).toHaveValue(value);
    await page.getByTestId('topbar-save-workflow').click();
    await expect(page.getByTestId('save-workflow-dialog')).toBeVisible();
    await page.getByTestId('save-workflow-name').fill(`Audio served persistence ${label} ${Date.now()}`);
    const saved = page.waitForResponse(
      (response) =>
        /\/workflows(?:\/[^/]+)?$/u.test(new URL(response.url()).pathname) &&
        ['POST', 'PUT'].includes(response.request().method()),
    );
    await page.getByTestId('confirm-save-workflow').click();
    expect((await saved).ok()).toBe(true);
    if (label.startsWith('Mini') && process.env.MODIFF_AUDIO_RESTART_MARKER) {
      await writeFile(`${output}/restart-ready.json`, JSON.stringify({ label, prompt: value }));
      await expect
        .poll(
          async () =>
            access(process.env.MODIFF_AUDIO_RESTART_MARKER!).then(
              () => true,
              () => false,
            ),
          { timeout: 20 * 60_000, intervals: [1000] },
        )
        .toBe(true);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 90_000 });
    await expect(root.getByLabel('prompt', { exact: true })).toHaveValue(value);
    if (label.startsWith('Mini') && process.env.MODIFF_AUDIO_RESTART_MARKER)
      await writeFile(`${output}/restart-passed.json`, JSON.stringify({ label, promptPreserved: true, errors }));
    expect(errors).toEqual([]);
  });
}
