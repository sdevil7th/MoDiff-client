import { expect, test } from '@playwright/test';

test('fresh image stages fit their open controls, preserve guidance settings and reopen at their saved sizes', async ({
  page,
}) => {
  test.skip(process.env.MODIFF_NODE_UX_ISOLATED !== '1', 'Uses the isolated native SDXL task starter.');
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  const launcher = page.getByTestId('task-launcher');
  await page.getByRole('tab', { name: 'Studio', exact: true }).waitFor();
  if (!(await launcher.isVisible())) {
    await page.getByRole('button', { name: 'Workflow library', exact: true }).click();
  }
  // The fresh-workflow dialog can finish mounting over the embedded task browser during startup.
  await page.getByTestId('workflow-task-text_to_image').last().click();
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
