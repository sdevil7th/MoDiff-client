import { expect, test, type Page } from '@playwright/test';

async function freshLauncher(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  return page.getByRole('dialog', { name: 'Workflows', exact: true });
}

test('fresh image stages fit their open controls, preserve guidance settings and reopen at their saved sizes', async ({
  page,
}) => {
  test.skip(process.env.MODIFF_NODE_UX_ISOLATED !== '1', 'Uses the isolated native SDXL task starter.');
  await page.setViewportSize({ width: 1500, height: 1000 });
  const launcher = await freshLauncher(page);
  await launcher
    .getByRole('button', { name: /^Text to image /i })
    .first()
    .click();
  const encoder = page.locator('[data-testid^="encoding-controls-"]').first();
  const owner = page.getByRole('button', { name: 'Choose model', exact: true });
  await expect(owner).toContainText('Model');
  const frames = page.locator('[data-node-body]');
  await expect(frames).toHaveCount(4);
  await expect
    .poll(() => frames.evaluateAll((nodes) => Math.max(...nodes.map((n) => n.scrollHeight - n.clientHeight))))
    .toBeLessThanOrEqual(2);
  const rects = () =>
    frames.evaluateAll((nodes) =>
      nodes
        .map((n) => {
          const frame = n.closest<HTMLElement>('.react-flow__node')!;
          return { id: frame.dataset.id!, height: frame.offsetHeight, width: frame.offsetWidth };
        })
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  const before = await rects();
  const enabled = encoder.getByRole('switch', { name: 'Enabled', exact: true });
  const scale = encoder.getByRole('textbox', { name: 'Guidance Scale', exact: true });
  await expect(enabled).toBeChecked();
  const savedScale = await scale.inputValue();
  await enabled.click();
  await expect(enabled).not.toBeChecked();
  await expect(scale).toHaveCount(0);
  await enabled.click();
  await expect(scale).toHaveValue(savedScale);
  const inspector = page.getByTestId('studio-custom-graph-inspector');
  await expect(inspector.getByRole('textbox', { name: 'Guidance Scale', exact: true })).toHaveValue(savedScale);
  await expect(inspector.getByRole('textbox', { name: 'Negative Prompt', exact: true })).toBeVisible();
  await page.reload();
  await expect(owner).toBeVisible();
  await expect.poll(rects).toEqual(before);
});

test('a newly added Python node fits both of its authored prompt fields on first insertion', async ({ page }) => {
  test.skip(
    process.env.MODIFF_NODE_UX_ISOLATED !== '1' || process.env.MODIFF_RUN_CUSTOM_LIFECYCLE !== '1',
    'Requires the isolated backend and its documented first-party example.',
  );
  const name = 'CanvasSizing' + Date.now();
  let staged = false;
  try {
    const launcher = await freshLauncher(page);
    await launcher.getByRole('button', { name: 'Empty workflow', exact: true }).click();
    await page.getByTestId('left-tab-nodes').click();
    await page.getByRole('button', { name: 'Add custom node', exact: true }).click();
    const dialog = page.getByTestId('custom-extensions-dialog');
    await dialog.getByRole('button', { name: 'Advanced options', exact: true }).click();
    await dialog.getByLabel('Extension source', { exact: true }).fill('examples/custom_nodes/PromptTools');
    await dialog.getByLabel('Extension module name').fill(name);
    const installed = page.waitForResponse((r) => r.url().endsWith('/custom_modules/add'));
    await dialog.getByTestId('extension-source-form').getByRole('button', { name: 'Add node', exact: true }).click();
    const response = await installed;
    expect(response.ok()).toBe(true);
    expect((await response.json()).error).toBeFalsy();
    staged = true;
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Search nodes', { exact: true }).fill(name);
    await page
      .getByTestId('node-group-custom-nodes')
      .getByRole('button', { name: 'Prompt Prefix', exact: true })
      .click();
    const frame = page
      .locator('.react-flow__node')
      .filter({ has: page.getByRole('textbox', { name: 'Prefix', exact: true }) });
    await expect(frame.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible();
    const body = frame.locator('[data-node-body]');
    await expect.poll(() => body.evaluate((n) => n.scrollHeight - n.clientHeight)).toBeLessThanOrEqual(2);
  } finally {
    if (staged) expect((await page.request.post('/custom_modules/' + name + '/disable', { data: {} })).ok()).toBe(true);
  }
});
