import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  test.skip(process.env.MODIFF_NODE_UX_ISOLATED !== '1', 'Requires an isolated registry worker');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0);
  await page.waitForFunction(() => window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated);
  if (!(await page.evaluate(() => window.__MODIFF_E2E__!.getState().studio.launcherDismissed))) {
    await page.getByTestId('task-launcher').getByRole('button', { name: 'Close', exact: true }).click();
  }
  const search = page.getByLabel('Search nodes', { exact: true });
  if (!(await search.isVisible())) await page.getByTestId('left-tab-nodes').click();
  await expect(search).toBeVisible();
});

async function insertNode(page: Page, key: string) {
  await page.getByLabel('Search nodes', { exact: true }).fill(key);
  const entry = page.getByTestId(`node-row-${key.replaceAll('.', '-')}`);
  await entry.click();
  const card = page.locator('.react-flow__node');
  await expect(card).toHaveCount(1);
  return card;
}

test('ordinary media and scheduler cards distinguish controls and sockets without changing their identities', async ({
  page,
}) => {
  await page.getByRole('checkbox', { name: 'Show implementation nodes', exact: true }).check();
  const routes = [
    [
      'modules.VideoConditioning.Normalize',
      'num_frames',
      'Target frames',
      [
        ['video', 'Input Source frames, image or video'],
        ['output', 'Output Normalized video, video'],
        ['frames_out', 'Output Actual frame count, int'],
      ],
    ],
    [
      'modules.ModularDiffusers.Scheduler',
      'scheduler',
      'Scheduler type',
      [
        ['scheduler_in', 'Input Base scheduler, diffusers_auto_model'],
        ['scheduler_out', 'Output Configured scheduler, diffusers_auto_model'],
      ],
    ],
    ['modules.Video.MuxAudioAsset', 'fit', 'Audio fit', [['duration_seconds', 'Output Measured duration (s), float']]],
    [
      'modules.DiffusersAudio.Generate',
      'sample_rate',
      'Requested sample rate',
      [['sample_rate_out', 'Output Actual sample rate, int']],
    ],
    ['modules.Audio.FitDuration', 'target_sample_rate', 'Target sample rate', []],
  ] as const;
  for (const [key, field, caption, sockets] of routes) {
    const card = await insertNode(page, key);
    await expect(card.locator(`[data-key="${field}"]`).getByText(caption, { exact: true })).toBeVisible();
    for (const [handle, name] of sockets) {
      await expect(card.locator(`[data-handleid="${handle}"]`)).toHaveAttribute('aria-label', name);
      const caption = card.locator(`[data-key="${handle}"] > div[title]:not([data-testid])`);
      await expect
        .poll(() => caption.evaluate((element) => element.scrollWidth - element.clientWidth))
        .toBeLessThanOrEqual(2);
    }
    const active = await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
    const [{ data }] = active.nodes;
    expect(`${data.module}.${data.action}`).toBe(key);
    expect(active.edges).toHaveLength(0);
    await card.screenshot({ path: test.info().outputPath(`${key}.png`) });
    await page.keyboard.press('Control+z');
    await expect(card).toHaveCount(0);
  }
});

test('the common palette offers dual-media upscaling and groups Encode Image with conditioning', async ({ page }) => {
  const search = page.getByLabel('Search nodes', { exact: true });
  await search.fill('video upscale');
  const upscale = page.getByTestId('node-group-Image-Video').getByRole('button', { name: 'Upscale Image or Video' });
  await expect(upscale).toBeVisible();
  await search.fill('image upscale');
  await expect(upscale).toBeVisible();
  await search.fill('Encode Image');
  await expect(
    page
      .getByTestId('node-subgroup-runtime-Models-Components-Condition')
      .getByTestId('node-row-modules-ModularDiffusers-ImageEncode'),
  ).toBeVisible();
});

test('a narrow ordinary reviewed step renders its full previous-iteration output caption', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Show implementation nodes', exact: true }).check();
  const action = 'modules.ModularDiffusers.ReviewedModularWorkflowStep';
  await page.getByLabel('Search nodes', { exact: true }).fill(action);
  await expect(page.getByTestId('node-row-modules-ModularDiffusers-ReviewedModularWorkflowStep')).toHaveCount(0);
  const id = await page.evaluate(async (key) => {
    const [{ useFlowStore }, { useNodesStore }, { createNodeFromRegistry }] = await Promise.all([
      import('/src/stores/useFlowStore.ts'),
      import('/src/stores/useNodeStore.ts'),
      import('/src/workflow/nodeFactory.ts'),
    ]);
    // Render a legacy placement outside discovery to retain coverage for saved cards.
    const node = createNodeFromRegistry(key, useNodesStore.getState().nodesRegistry, { x: 40, y: 60 });
    if (!node) throw new Error('The saved reviewed step no longer resolves against the registry');
    useFlowStore.getState().addNode(node);
    return node.id;
  }, action);
  const card = page.locator(`.react-flow__node[data-id="${id}"]`);
  const key = 'iteration_previous__negative_connector_audio_prompt_embeds';
  const text = 'negative_connector_audio_prompt_embeds (previous iteration)';
  const field = card.locator(`[data-key="${key}"]`);
  await expect(field.locator(`[data-handleid="${key}"]`)).toHaveAttribute(
    'aria-label',
    `Output ${text}, modular_loop_value`,
  );
  const caption = field.getByText(text, { exact: true });
  await expect(caption).toBeVisible();
  await expect
    .poll(() =>
      caption.evaluate((element) => ({
        overflows: element.scrollWidth - element.clientWidth > 2,
        wraps: getComputedStyle(element).whiteSpace === 'normal',
      })),
    )
    .toEqual({ overflows: false, wraps: true });
});

test('image composition, frame extraction and generation name their typed boundaries', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Show implementation nodes', exact: true }).check();
  const routes = [
    ['modules.Image.Merge', ['Input Overlay image, image', 'Input Base image, image', 'Output Composite image, image']],
    [
      'modules.VideoConditioning.FirstLastFrames',
      ['Output First frame, image', 'Output Last frame, image', 'Output Frame pair, image'],
    ],
    ['modules.DiffusersImage.Generate', ['Output Actual width, int', 'Output Actual height, int']],
  ] as const;
  for (const [action, sockets] of routes) {
    const card = await insertNode(page, action);
    for (const name of sockets) {
      const handle = card.getByLabel(name, { exact: true });
      await expect(handle).toBeVisible();
      const caption = handle.locator('..').locator(':scope > div[title]:not([data-testid])');
      await expect.poll(() => caption.evaluate((item) => item.scrollWidth - item.clientWidth)).toBeLessThanOrEqual(2);
    }
    await page.keyboard.press('Control+z');
    await expect(card).toHaveCount(0);
  }
});
