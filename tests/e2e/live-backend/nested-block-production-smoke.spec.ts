import { expect, test, type Page } from '@playwright/test';

async function waitForWorkspaceStartup(page: Page, timeout = 300_000) {
  const deadline = Date.now() + timeout;
  const gate = page.getByTestId('startup-workspace-gate');
  while (Date.now() < deadline) {
    if ((await gate.count()) === 0) return;
    const retry = gate.getByRole('button', { name: 'Retry' });
    if (await retry.isVisible({ timeout: 250 }).catch(() => false)) await retry.click();
    await page.waitForTimeout(500);
  }
  throw new Error('Workspace startup did not recover.');
}

async function waitForRecursiveDomGeometry(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      ),
  );
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const issues: string[] = [];
          const byParent = new Map<string, HTMLElement[]>();
          document.querySelectorAll<HTMLElement>('[data-block-projection="modular-diffusers"]').forEach((frame) => {
            const parentId = frame.dataset.blockParentNodeId;
            const wrapper = frame.closest<HTMLElement>('.react-flow__node');
            if (!parentId || !wrapper) {
              issues.push('projected Block has no inspectable parent');
              return;
            }
            const parent = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(parentId)}"]`);
            if (!parent) {
              issues.push(`${wrapper.dataset.id}: missing parent ${parentId}`);
              return;
            }
            const childRect = wrapper.getBoundingClientRect();
            const parentRect = parent.getBoundingClientRect();
            if (
              childRect.left < parentRect.left - 2 ||
              childRect.top < parentRect.top + 1 ||
              childRect.right > parentRect.right + 2 ||
              childRect.bottom > parentRect.bottom + 2
            )
              issues.push(`${wrapper.dataset.id}: escapes ${parentId}`);
            byParent.set(parentId, [...(byParent.get(parentId) ?? []), wrapper]);
          });
          byParent.forEach((siblings, parentId) => {
            siblings.forEach((left, index) => {
              const leftRect = left.getBoundingClientRect();
              siblings.slice(index + 1).forEach((right) => {
                const rightRect = right.getBoundingClientRect();
                if (
                  leftRect.left < rightRect.right - 1 &&
                  leftRect.right > rightRect.left + 1 &&
                  leftRect.top < rightRect.bottom - 1 &&
                  leftRect.bottom > rightRect.top + 1
                )
                  issues.push(`${left.dataset.id}: overlaps ${right.dataset.id} in ${parentId}`);
              });
            });
          });
          return issues;
        }),
      { timeout: 15_000 },
    )
    .toEqual([]);
}

async function expectEveryVisibleContainerHasConnectors(page: Page) {
  const portless = await page.locator('[data-block-projection="modular-diffusers"]').evaluateAll((frames) =>
    frames.flatMap((frame) => {
      const toggle = frame.querySelector('[data-testid^="toggle-modular-container-"]');
      if (!toggle) return [];
      return frame.querySelector('[data-testid^="node-connector-tray-"]')
        ? []
        : [frame.getAttribute('data-block-semantic-node-id') ?? 'unknown'];
    }),
  );
  expect(portless).toEqual([]);
}

test('deployed Qwen Block uses progressive shared Block frames', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(process.env.MODIFF_NESTED_FRONTEND_URL ?? '/', { waitUntil: 'domcontentloaded' });
  await waitForWorkspaceStartup(page);
  const advancedWorkflow = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advancedWorkflow.isVisible({ timeout: 1000 }).catch(() => false)) await advancedWorkflow.click();

  // A live backend can expose another browser's currently saved qualification
  // workflow after startup. Always create an explicit empty tab so this visual
  // smoke measures one freshly inserted Block instead of mutating or measuring
  // unrelated in-flight graph state.
  await page.getByTestId('workflow-tab-new').click();

  if (await advancedWorkflow.isVisible({ timeout: 1000 }).catch(() => false)) await advancedWorkflow.click();
  const search = page.getByLabel('Search nodes');
  if (!(await search.isVisible({ timeout: 1000 }).catch(() => false))) await page.getByTestId('left-tab-nodes').click();
  await search.fill('Qwen Image — Text To Image');
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  const disclosure = group.getByRole('button').first();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await row.click();

  const root = page
    .locator('[data-block-source="diffusers_catalog"]')
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(root).toHaveCount(1, { timeout: 30_000 });
  await root.getByLabel('Save block changes', { exact: true }).click();
  const saveChoices = page.getByRole('dialog', { name: 'Save block changes', exact: true });
  await expect(saveChoices.getByRole('button', { name: 'Keep only in this workflow', exact: true })).toBeEnabled();
  await expect(saveChoices.getByRole('button', { name: 'Save as new User Node', exact: true })).toBeEnabled();
  await expect(saveChoices.getByRole('button', { name: 'Update existing User Node', exact: true })).toHaveCount(0);
  await saveChoices.getByRole('button', { name: 'Cancel', exact: true }).click();
  await root.getByLabel('Expand block').click();

  const projectedBlocks = page.locator('[data-block-projection="modular-diffusers"]');
  await expect(projectedBlocks.first()).toBeVisible();
  await expect(projectedBlocks.filter({ hasText: 'Qwen Image Auto Vae Encoder Step' })).toHaveCount(0);
  await expect(projectedBlocks.filter({ hasText: 'Qwen Image Optional Control Net Vae Encoder Step' })).toHaveCount(0);
  const initialCount = await projectedBlocks.count();
  expect(initialCount).toBeGreaterThan(0);
  await expect(projectedBlocks.locator('[aria-label^="Collapse "]')).toHaveCount(0);
  await expect(
    projectedBlocks.filter({ has: page.locator('[data-testid^="node-connector-tray-"]') }).first(),
  ).toBeVisible();
  const projectedEdges = page.locator('.react-flow__edge');
  await expect(projectedEdges.first()).toBeVisible();
  const initialEdgeCount = await projectedEdges.count();
  await waitForRecursiveDomGeometry(page);
  await expectEveryVisibleContainerHasConnectors(page);

  const encoder = projectedBlocks.filter({
    has: page.getByRole('button', { name: 'Save changes to Qwen Image Auto Text Encoder Step', exact: true }),
  });
  await expect(encoder.getByLabel('prompt', { exact: true })).toBeVisible();
  const originalPrompt = await encoder.getByLabel('prompt', { exact: true }).inputValue();
  expect(originalPrompt.length).toBeGreaterThan(80);
  await encoder.getByRole('button', { name: 'Configure exposed inputs, outputs, and controls', exact: true }).click();
  const interfaceDialog = page.getByRole('dialog', { name: 'Configure Block interface', exact: true });
  await expect(interfaceDialog.getByTestId('block-interface-scope')).toBeVisible();
  await expect(interfaceDialog.getByLabel('control prompt label', { exact: true })).toHaveValue('prompt');
  await expect(interfaceDialog.getByLabel('control modelVariant label', { exact: true })).toHaveCount(0);
  if (process.env.MODIFF_REVIEW_INTERFACE_SCREENSHOT)
    await page.screenshot({ path: process.env.MODIFF_REVIEW_INTERFACE_SCREENSHOT, fullPage: false });
  await interfaceDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(encoder.getByLabel('prompt', { exact: true })).toHaveValue(originalPrompt);

  const clearNotifications = page.getByTestId('run-session-shelf').getByRole('button', { name: 'Clear', exact: true });
  if (await clearNotifications.isEnabled().catch(() => false)) await clearNotifications.click();
  if (process.env.MODIFF_REVIEW_CONTROLS_SCREENSHOT)
    await page.screenshot({ path: process.env.MODIFF_REVIEW_CONTROLS_SCREENSHOT, fullPage: false });

  await projectedBlocks
    .getByRole('button', { name: 'Save changes to Qwen Image Auto Text Encoder Step', exact: true })
    .click();
  await expect(saveChoices.getByRole('button', { name: 'Keep only in this workflow', exact: true })).toBeEnabled();
  await expect(saveChoices.getByRole('button', { name: 'Save as new User Node', exact: true })).toBeEnabled();
  await expect(saveChoices.getByRole('button', { name: 'Update existing User Node', exact: true })).toHaveCount(0);
  if (process.env.MODIFF_REVIEW_SAVE_SCREENSHOT) {
    await page.screenshot({ path: process.env.MODIFF_REVIEW_SAVE_SCREENSHOT, fullPage: true });
  }
  await page.keyboard.press('Escape');
  await expect(saveChoices).toHaveCount(0);

  const connectorBlock = projectedBlocks.filter({ has: page.locator('[data-testid^="node-connector-tray-"]') }).first();
  const resizeGrip = connectorBlock.getByTestId('node-resize-grip');
  await expect(resizeGrip).toBeVisible();
  const gripBox = await resizeGrip.boundingBox();
  if (!gripBox) throw new Error('The deployed internal Block resize grip has no layout box.');
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox.x - 500, gripBox.y - 500, { steps: 8 });
  await page.mouse.up();
  await expect(projectedEdges).toHaveCount(initialEdgeCount);
  await expect(connectorBlock.locator('[data-testid^="node-connector-tray-"]')).toBeVisible();
  await expect(projectedEdges.first()).toBeVisible();

  const firstContainerToggle = page.locator('[data-testid^="toggle-modular-container-"]').first();
  await expect(firstContainerToggle).toBeVisible();
  await firstContainerToggle.click();
  await expect.poll(() => projectedBlocks.count()).toBeGreaterThan(initialCount);
  await expect(projectedBlocks.locator('[aria-label^="Collapse "]')).toHaveCount(1);
  await waitForRecursiveDomGeometry(page);
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const nextToggle = projectedBlocks.locator('[aria-label^="Expand "]').first();
    if ((await nextToggle.count()) === 0) break;
    await nextToggle.evaluate((button: HTMLButtonElement) => button.click());
    await waitForRecursiveDomGeometry(page);
    await expectEveryVisibleContainerHasConnectors(page);
  }
  await expect(projectedBlocks.locator('[aria-label^="Expand "]')).toHaveCount(0);
  await page.getByTestId('arrange-graph').click();
  await waitForRecursiveDomGeometry(page);
  const canvas = page.locator('.react-flow').first();
  await expect
    .poll(async () => {
      const frame = await root.boundingBox();
      const bounds = await canvas.boundingBox();
      return Boolean(
        frame &&
        bounds &&
        frame.x >= bounds.x &&
        frame.y >= bounds.y &&
        frame.x + frame.width <= bounds.x + bounds.width &&
        frame.y + frame.height <= bounds.y + bounds.height,
      );
    })
    .toBe(true);
  if (process.env.MODIFF_REVIEW_SCREENSHOT) {
    await page.screenshot({ path: process.env.MODIFF_REVIEW_SCREENSHOT, fullPage: true });
  }
});
