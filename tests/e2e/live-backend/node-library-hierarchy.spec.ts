import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { ready } from './qwenDemoGestures';

test('every node library segment exposes a nested browse hierarchy and search reaches its leaves', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(25_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await ready(page);
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible()) await advanced.click();
  const auto = page.getByTestId('topbar-auto-switch');
  if ((await auto.getAttribute('aria-checked')) === 'true') await auto.click();
  await page.getByTestId('left-tab-nodes').click();
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  const paths: Record<string, string[]> = {};
  for (const segment of [
    'Diffusers-Cluster-Nodes',
    'Transformers-Cluster-Nodes',
    'Modular-Diffusers-Block-Nodes',
    'Diffusers-Component-Nodes',
    'User-Nodes',
    'Image',
    'Audio',
    'Models-Components',
    'Data-Utilities',
    '3D',
    'Text',
    'Video',
    'Transformers',
  ]) {
    const group = page.getByTestId(`node-group-${segment}`);
    const button = group.getByRole('button').first();
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
    const branches = group.locator('[data-testid^="node-subgroup-"], [data-testid^="user-node-subgroup-"]');
    await expect.poll(() => branches.count()).toBeGreaterThan(0);
    paths[segment] = await branches.getByRole('button').allTextContents();
    await button.click();
  }
  await page.getByLabel('Search nodes').fill('Schedulers');
  const components = page.getByTestId('node-group-Diffusers-Component-Nodes');
  await expect(components.locator('[data-testid^="hugging-face-node-row-"]').first()).toBeVisible();
  await page.getByLabel('Search nodes').fill('Qwen');
  const modular = page.getByTestId('node-group-Modular-Diffusers-Block-Nodes');
  await expect(modular.locator('[data-testid^="hugging-face-node-row-"]').first()).toBeVisible();
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  if (directory) {
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/node-library-browser-hierarchy.json`, JSON.stringify(paths, null, 2));
    await page.screenshot({ path: `${directory}/node-library-hierarchy.png` });
  }
});
