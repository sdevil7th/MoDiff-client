import { expect, test, type Locator, type Page } from '@playwright/test';
import { waitForRecursiveDomGeometry } from './blockDomGeometry';

test('deployed cold workspace panels initialize all tab icons without a module-cycle crash', async ({ browser }) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // The supported share entry opens the lazy workspace panel during cold
    // startup, exposing icon descriptors captured before a cyclic entry loads.
    const url = new URL(process.env.MODIFF_NESTED_FRONTEND_URL ?? 'http://127.0.0.1:8088');
    url.searchParams.set('share', '');
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('workspace-panel')).toBeVisible({ timeout: 60_000 });
    for (const tab of ['studio', 'queue', 'setup'])
      await expect(page.getByTestId(`workspace-tab-${tab}`).locator('svg')).toBeVisible();
    // Catch deferred mount/recovery errors rather than racing to a new tab.
    await page.waitForTimeout(5_000);
    await expect(page.getByTestId('workspace-panel')).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  }
});

async function dragResizeGrip(page: Page, node: Locator, dx: number, dy: number) {
  const grip = node.getByTestId('node-resize-grip');
  await expect(grip).toBeVisible();
  const bounds = await grip.boundingBox();
  if (!bounds) throw new Error('The deployed node resize grip has no layout box.');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

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
  const pageErrors: string[] = [];
  const missingHandles: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.text().includes("[React Flow]: Couldn't create edge for")) missingHandles.push(message.text());
  });
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
  // This is the original reported failure: a manually resized collapsed root
  // must not constrain its expanded descendants to the same saved dimensions.
  await dragResizeGrip(page, root, -180, -180);
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
  const denoiser = projectedBlocks.filter({
    has: page.getByRole('button', { name: 'Save changes to Qwen Image Auto Core Denoise Step', exact: true }),
  });
  const heightLabels = await denoiser
    .locator('.react-flow__handle.target[aria-label^="Input height"]')
    .evaluateAll((handles) =>
      handles.map((handle) => ({ label: handle.getAttribute('aria-label'), title: handle.getAttribute('title') })),
    );
  // One public height control fans out to both preparation and denoising.
  // The shared Block surface must expose one socket, not duplicate aliases.
  expect(heightLabels).toHaveLength(1);
  expect(new Set(heightLabels.map(({ label }) => label)).size).toBe(heightLabels.length);
  expect(heightLabels.every(({ title }) => title?.includes('height') && title.includes('denoise'))).toBe(true);
  await page.getByTestId('arrange-graph').click();
  await waitForRecursiveDomGeometry(page);

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
  // The node envelope fitting is not enough: Advanced's intrinsic grid sizing
  // previously pushed the numeric value and right step button out of the body.
  const textStep = projectedBlocks.filter({
    has: page.getByRole('button', { name: 'Save changes to Qwen Image Text Encoder Step', exact: true }),
  });
  await expect(textStep).toHaveCount(1);
  const auto = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await auto.getAttribute('aria-checked')) !== 'true') await auto.click();
  const advanced = textStep.getByRole('button', { name: 'Advanced', exact: true });
  await advanced.click();
  const sequenceLength = textStep.getByLabel('Maximum Sequence Length', { exact: true });
  await expect(sequenceLength).toHaveValue('512');
  await sequenceLength.scrollIntoViewIfNeeded();
  for (const sizeChange of [
    { x: -50, y: 60 },
    { x: 100, y: 60 },
  ]) {
    await dragResizeGrip(page, textStep, sizeChange.x, sizeChange.y);
    await waitForRecursiveDomGeometry(page);
    await expect
      .poll(() =>
        sequenceLength.evaluate((input) => {
          const field = input.closest('[data-key]')!;
          const disclosure = field.closest('[data-testid^="node-advanced-controls-"]')!;
          const box = disclosure.getBoundingClientRect();
          return (
            disclosure.scrollWidth <= disclosure.clientWidth + 1 &&
            [...field.querySelectorAll('input, button')].every((element) => {
              const child = element.getBoundingClientRect();
              return child.left >= box.left - 1 && child.right <= box.right + 1;
            })
          );
        }),
      )
      .toBe(true);
  }
  await advanced.click();
  await expect(sequenceLength).toHaveCount(0);
  await advanced.click();
  await expect(sequenceLength).toHaveValue('512');
  await page.getByTestId('arrange-graph').click();
  await waitForRecursiveDomGeometry(page);
  const ordinaryLeaf = page
    .locator('[data-node-parent-id]')
    .filter({
      has: page.getByTestId('node-resize-grip'),
    })
    .first();
  await expect(ordinaryLeaf).toBeVisible();
  const originalLeafSize = await ordinaryLeaf.boundingBox();
  if (!originalLeafSize) throw new Error('An internal ordinary node must have measurable dimensions.');
  await dragResizeGrip(page, ordinaryLeaf, 70, 90);
  await expect
    .poll(async () => {
      const resized = await ordinaryLeaf.boundingBox();
      return Boolean(
        resized && resized.width > originalLeafSize.width + 20 && resized.height > originalLeafSize.height + 20,
      );
    })
    .toBe(true);
  await waitForRecursiveDomGeometry(page);
  await expectEveryVisibleContainerHasConnectors(page);
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
  if (process.env.MODIFF_REVIEW_NUMERIC_SCREENSHOT) {
    // Fit first; DOM screenshot clipping alone does not pan the React Flow
    // viewport and can otherwise capture an overlapping off-screen region.
    // The body deliberately consumes wheel events for its own scrollbar.
    // Zoom over the header, not over editable/scrollable content. One fixed
    // wheel delta is not enough at every fit-to-graph starting scale.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const overviewBox = (await textStep.boundingBox())!;
      if (overviewBox.width > 250) break;
      await page.mouse.move(overviewBox.x + overviewBox.width / 2, overviewBox.y + 2);
      await page.mouse.wheel(0, -350);
      await page.waitForTimeout(250);
    }
    await expect.poll(async () => (await textStep.boundingBox())!.width).toBeGreaterThan(250);
    await sequenceLength.scrollIntoViewIfNeeded();
    const box = (await textStep.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await textStep.screenshot({ path: process.env.MODIFF_REVIEW_NUMERIC_SCREENSHOT });
  }
  if (process.env.MODIFF_REVIEW_LIBRARY_SCREENSHOT) {
    const resize = (await page.getByTestId('left-panel-resize-handle').boundingBox())!;
    await page.mouse.move(resize.x + resize.width / 2, resize.y + 100);
    await page.mouse.down();
    await page.mouse.move(640, resize.y + 100, { steps: 10 });
    await page.mouse.up();
    const label = (await row.locator('[data-catalog-entry-label]').boundingBox())!;
    const badge = (await row.locator('[data-catalog-entry-readiness]').boundingBox())!;
    expect(badge.x).toBeGreaterThan(label.x + label.width);
    expect(badge.y).toBeLessThan(label.y + label.height + 12);
    await group.screenshot({ path: process.env.MODIFF_REVIEW_LIBRARY_SCREENSHOT });
  }
  expect(pageErrors).toEqual([]);
  expect(missingHandles).toEqual([]);
});
