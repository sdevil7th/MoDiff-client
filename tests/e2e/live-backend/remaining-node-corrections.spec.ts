import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  test.skip(process.env.MODIFF_NODE_UX_ISOLATED !== '1', 'Requires isolated backend state');
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto('/');
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
});

async function api(page: Page) {
  return page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore.getState().exportGraph('', undefined, { randomizeSeeds: false });
  });
}
async function graph(page: Page) {
  return page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
}

for (const task of [
  'image_to_image',
  'edit_image',
  'inpaint',
  'audio_variation',
  'audio_continuation',
  'audio_repaint',
]) {
  test(`native ${task} creation includes connected separate required sources`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const launcher = page.getByTestId('task-launcher');
    if (task.startsWith('audio')) await launcher.getByRole('button', { name: 'Audio', exact: true }).click();
    await launcher.getByTestId(`workflow-task-${task}`).click();
    const label = task.startsWith('audio') ? 'Load Audio' : 'Load Image';
    const loader = page.locator('.react-flow__node').filter({ has: page.locator('header', { hasText: label }) });
    await expect(loader).toHaveCount(1, { timeout: 45_000 });
    await expect(loader.locator('input[type=file]')).toHaveCount(1);
    await expect(page.getByTestId('studio-run')).toBeDisabled();
    await expect(page.getByText(`${label} needs a file before running.`, { exact: true }).first()).toBeVisible();
    const policy = page.getByTestId('topbar-resource-policy');
    if ((await policy.getAttribute('aria-pressed')) === 'true') await policy.click();
    await expect(page.getByTestId('studio-run')).toBeDisabled();
    const workflow = await graph(page);
    const sources = workflow.nodes.filter(
      (n) => ['modules.Image', 'modules.Audio'].includes(n.data.module) && n.data.action === 'Load',
    );
    expect(sources.length).toBeGreaterThanOrEqual(task === 'inpaint' ? 2 : 1);
    for (const source of sources) {
      expect(source.parentId).toBeUndefined();
      expect(workflow.edges.some((e) => e.source === source.id)).toBe(true);
    }
    const before = await api(page);
    await page.reload();
    await expect(loader).toHaveCount(1, { timeout: 45_000 });
    expect(await api(page)).toEqual(before);
    expect(errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`${task}.png`) });
  });
}

async function setup(page: Page, pipeline: string, task: string, grouped = true, refreshedFields = false) {
  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
  return page.evaluate(
    async ({ pipeline, task, grouped, refreshedFields }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
      const { requestOperationStarter } = await import('/src/workflow/operationStarterRequest.ts');
      const { createWorkflowDraft } = await import('/src/workflow/workflowDraft.ts');
      const { createOperationStarter } = await import('/src/workflow/operationAuthoring.ts');
      const { groupNewOperationGraph } = await import('/src/workflow/visualOperationGroups.ts');
      const { prepareWorkflowForManualInsertion } = await import('/src/studio/manualGraphInsertion.ts');
      const registry = useNodesStore.getState();
      const starter = await requestOperationStarter(pipeline, task, registry.operationContracts);
      let graph = grouped
        ? createWorkflowDraft(starter, registry.nodesRegistry).graph
        : createOperationStarter(starter, { x: 30, y: 80 });
      if (refreshedFields) {
        graph = createOperationStarter(starter, { x: 30, y: 80 });
        for (const stage of graph.nodes) {
          if (['Guider', 'Layers'].includes(stage.data.action))
            for (const field of Object.values(stage.data.params)) delete field.onChange;
        }
        graph = groupNewOperationGraph(graph);
      }
      graph.nodes.forEach((node, index) => {
        node.position = { x: 50 + index * 430, y: 80 };
        if (node.data.label === 'Guidance') node.position = { x: 440, y: 80 };
        else if (node.data.label === 'Encode Inputs') node.position = { x: 950, y: 80 };
        if (node.data.blockInstanceV2) node.data.blockInstanceV2.presentation.position = node.position;
      });
      prepareWorkflowForManualInsertion();
      useFlowStore.getState().replaceGraph(graph);
      return graph.nodes;
    },
    { pipeline, task, grouped, refreshedFields },
  );
}

test('shared seed edit preserves a customized Guidance interface and supports Undo, Redo and refresh', async ({
  page,
}) => {
  await setup(page, 'StableDiffusionXLModularPipeline', 'image_to_image');
  const ids = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const runtime = await import('/src/studio/blockRuntimeV2.ts');
    const graph = useFlowStore.getState().toObject();
    const guide = graph.nodes.find((n) => n.data.label === 'Guidance')!;
    let instance = runtime.addBlockEffectiveGraphNodeV2(guide.data.blockInstanceV2!, {
      nodeId: 'custom-bool',
      nodeType: 'custom',
      data: {
        type: 'custom',
        module: 'custom.Proof',
        action: 'Bool',
        params: { enabled: { type: 'boolean', default: true } },
      },
    });
    instance = runtime.replaceBlockEffectiveInterfaceV2(instance, {
      boundary: instance.effectiveInterface.boundary,
      controls: instance.effectiveInterface.controls.map((c) =>
        c.binding.fieldId === 'enabled' ? { ...c, mirrorBindings: [{ nodeId: 'custom-bool', fieldId: 'enabled' }] } : c,
      ),
    });
    guide.data.blockInstanceV2 = instance;
    useFlowStore.getState().replaceGraph(graph);
    useFlowStore.getState().resetHistory();
    return { input: graph.nodes.find((n) => n.data.label === 'Encode Inputs')!.id, guide: guide.id };
  });
  const original = await graph(page);
  const guideBefore = original.nodes.find((n) => n.id === ids.guide)!.data.blockInstanceV2;
  const before = await api(page);
  const input = page.locator(`.react-flow__node[data-id="${ids.input}"]`);
  const seed = input.getByLabel('Seed', { exact: true });
  await seed.fill('555');
  await seed.press('Tab');
  await expect
    .poll(async () => {
      const submitted = await api(page);
      return Object.values(submitted.nodes)
        .filter((n) => ['ImageEncode', 'Denoise'].includes(n.action))
        .map((n) => String(n.params.seed.value));
    })
    .toEqual(['555', '555']);
  const edited = await api(page);
  expect((await graph(page)).nodes.find((n) => n.id === ids.guide)!.data.blockInstanceV2).toEqual(guideBefore);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  expect(await api(page)).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await api(page)).toEqual(edited);
  await page.reload();
  await expect(seed).toHaveValue('555', { timeout: 45_000 });
  expect(await api(page)).toEqual(edited);
  expect((await graph(page)).nodes.find((n) => n.id === ids.guide)!.data.blockInstanceV2).toEqual(guideBefore);
});

test('Guidance is an ordinary node: refreshed fields, related membership, controls, resize, inspection, separate and Undo', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const nodes = await setup(page, 'StableDiffusionXLModularPipeline', 'text_to_image', true, true);
  const root = nodes.find((n) => n.data.label === 'Guidance')!;
  expect(root.data.blockInstanceV2!.effectiveGraph.nodes.map((n) => n.data.action).sort()).toEqual([
    'Guider',
    'Layers',
  ]);
  const node = page.locator(`.react-flow__node[data-id="${root.id}"]`);
  await expect(node.getByTestId(`guidance-node-${root.id}`)).toBeVisible();
  await expect(node.locator('[data-block-expanded]')).toHaveCount(0);
  await expect(node.getByRole('button', { name: 'Ungroup stages', exact: true })).toHaveCount(0);
  await node.getByRole('button', { name: 'Guider', exact: true }).click();
  await page.getByRole('option', { name: 'SkipLayerGuidance', exact: true }).click();
  await expect(node.getByText('Skip Layer Guidance Scale', { exact: true })).toBeVisible();
  await node.getByRole('button', { name: 'Blocks', exact: true }).click();
  await page.getByRole('option', { name: 'mid_block.attentions.0.transformer_blocks', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(node.getByPlaceholder('Indices')).toBeVisible();
  await node.getByPlaceholder('Indices').fill('0');
  await node.getByPlaceholder('Indices').press('Tab');
  await expect(node.getByText('Updating guidance controls…')).toHaveCount(0);
  const before = await api(page);
  const guider = Object.values(before.nodes).find((n) => n.action === 'Guider')!;
  const layers = Object.values(before.nodes).find((n) => n.action === 'Layers')!;
  expect(guider.params.guider.value).toBe('SkipLayerGuidance');
  expect(layers.params['mid_block.attentions.0.transformer_blocks'].value).toMatchObject({ indices: '0' });
  const bounds = (await node.boundingBox())!;
  const grip = (await node.getByLabel('Drag to resize node', { exact: true }).boundingBox())!;
  const port = (await node.locator('.react-flow__handle').first().boundingBox())!;
  expect(grip.y).toBeLessThan(port.y);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 65, grip.y + 70, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await node.boundingBox())!.width).toBeGreaterThan(bounds.width + 20);
  expect(await api(page)).toEqual(before);
  await node.getByRole('button', { name: 'Guidance options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Inspect implementation', exact: true }).click();
  const inspect = page.getByRole('dialog', { name: 'Guidance implementation', exact: true });
  await expect(inspect.getByRole('heading', { name: 'Guidance implementation', exact: true })).toBeVisible();
  expect(await api(page)).toEqual(before);
  await inspect.getByRole('button', { name: 'Close', exact: true }).click();
  await node.getByRole('button', { name: 'Guidance options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Separate guidance stages', exact: true }).click();
  await expect(node).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(node).toBeVisible();
  expect(await api(page)).toEqual(before);
  await page.reload();
  await expect(node.getByTestId(`guidance-node-${root.id}`)).toBeVisible({ timeout: 45_000 });
  expect(await api(page)).toEqual(before);
  await node.screenshot({ path: test.info().outputPath('guidance-node.png') });
  expect(errors).toEqual([]);
});

test('removed dynamic Guidance row stays hidden through Undo Redo save reopen and refresh without changing its value', async ({
  page,
}) => {
  const nodes = await setup(page, 'StableDiffusionXLModularPipeline', 'text_to_image', true, true);
  const root = nodes.find((n) => n.data.label === 'Guidance')!;
  const node = page.locator(`.react-flow__node[data-id="${root.id}"]`);
  await node.getByRole('button', { name: 'Guider', exact: true }).click();
  await page.getByRole('option', { name: 'SkipLayerGuidance', exact: true }).click();
  const label = 'Skip Layer Guidance Scale';
  await expect(node.getByText(label, { exact: true })).toBeVisible();
  const scale = node.getByLabel(label, { exact: true });
  await scale.fill('4.2');
  await scale.press('Tab');
  await expect(node.getByText('Updating guidance controls…')).toHaveCount(0);
  const consumed = async () => Object.values((await api(page)).nodes).find((n) => n.action === 'Guider')!.params;
  const before = await consumed();
  expect(before.skip_layer_guidance_scale.value).toBe('4.2');
  const definition = (await graph(page)).nodes.find((n) => n.id === root.id)!.data.blockInstanceV2!.definitionSnapshot;
  await node.getByRole('button', { name: 'Guidance options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Inspect implementation', exact: true }).click();
  await page.getByRole('button', { name: 'Configure inputs, outputs and controls', exact: true }).click();
  const dialog = page.getByTestId(`configure-block-v2-${root.id}`);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: `Remove control ${label}`, exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply interface', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(node.getByText(label, { exact: true })).toHaveCount(0);
  expect(await consumed()).toEqual(before);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(node.getByText(label, { exact: true })).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(node.getByText(label, { exact: true })).toHaveCount(0);
  const savedName = `Guidance removal ${Date.now()}`;
  await page.getByTestId('topbar-save-workflow-options').click();
  await page.getByTestId('topbar-save-workflow-as').click();
  await page.getByTestId('save-workflow-name').fill(savedName);
  await page.getByTestId('confirm-save-workflow').click();
  await expect(page.getByTestId('save-workflow-dialog')).toHaveCount(0);
  await page.getByRole('button', { name: `Close ${savedName}`, exact: true }).click();
  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('left-tab-workflows').click();
  await page.getByRole('button', { name: 'My workflows', exact: true }).click();
  await page.getByLabel('Search workflows').fill(savedName);
  await page
    .locator('[data-testid^="saved-workflow-"]')
    .filter({ hasText: savedName })
    .getByRole('button')
    .first()
    .click();
  await expect(node.getByTestId(`guidance-node-${root.id}`)).toBeVisible();
  await expect(node.getByText(label, { exact: true })).toHaveCount(0);
  expect(await consumed()).toEqual(before);
  await page.reload();
  await expect(node.getByTestId(`guidance-node-${root.id}`)).toBeVisible({ timeout: 45_000 });
  await expect(node.getByText(label, { exact: true })).toHaveCount(0);
  expect(await consumed()).toEqual(before);
  expect((await graph(page)).nodes.find((n) => n.id === root.id)!.data.blockInstanceV2!.definitionSnapshot).toEqual(
    definition,
  );
  await node.screenshot({ path: test.info().outputPath('guidance-removed-row.png') });
});

test('failed Guidance metadata leaves values, graph and reusable definition unchanged', async ({ page }) => {
  const nodes = await setup(page, 'StableDiffusionXLModularPipeline', 'text_to_image');
  const root = nodes.find((n) => n.data.label === 'Guidance')!;
  const node = page.locator(`.react-flow__node[data-id="${root.id}"]`);
  const before = await api(page);
  const definition = root.data.blockInstanceV2!.definitionSnapshot;
  await page.route('**/fields/action', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Test metadata failure' }),
    }),
  );
  await node.getByRole('button', { name: 'Guider', exact: true }).click();
  await page.getByRole('option', { name: 'SkipLayerGuidance', exact: true }).click();
  await expect(node.getByRole('alert')).toBeVisible();
  expect(await api(page)).toEqual(before);
  expect((await graph(page)).nodes.find((n) => n.id === root.id)!.data.blockInstanceV2!.definitionSnapshot).toEqual(
    definition,
  );
});

function wav(seconds: number) {
  const samples = seconds * 8000;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF');
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin((i * Math.PI) / 20) * 1000), 44 + i * 2);
  return { name: `test-${seconds}.wav`, mimeType: 'audio/wav', buffer: data };
}

test('contextual audio attachment preserves prompt, cancels cleanly, Undo/Redo and playable source after refresh', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const nodes = await setup(page, 'AceStepPipeline', 'text_to_audio');
  const owner = nodes.find((n) => n.data.action === 'LoadPipeline')!;
  const baseline = await api(page);
  const sourcePrompt = Object.values(baseline.nodes).find((n) => n.params.prompt)?.params.prompt;
  await page.locator(`.react-flow__node[data-id="${owner.id}"] header`).first().click();
  await page.getByRole('button', { name: 'Inspect node', exact: true }).click();
  const inspector = page.getByRole('dialog', { name: 'Node inspector', exact: true });
  await expect(inspector.getByLabel('Media input role', { exact: true })).toHaveCount(0);
  async function openAttachment() {
    await inspector.getByRole('button', { name: 'Workflow stage actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Add image / audio input…', exact: true }).click();
  }
  await openAttachment();
  const dialog = page.getByRole('dialog', { name: 'Add image / audio input', exact: true });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await api(page)).toEqual(baseline);
  await openAttachment();
  await dialog.getByLabel('Media input role', { exact: true }).click();
  await page.getByRole('option', { name: 'audio variation · source audio', exact: true }).click();
  await dialog.getByRole('button', { name: 'Attach input', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  if (await inspector.isVisible()) await inspector.getByRole('button', { name: 'Close', exact: true }).click();
  await page.keyboard.press('Escape');
  const loader = page.locator('.react-flow__node').filter({ has: page.locator('header', { hasText: 'Load Audio' }) });
  await expect(loader).toHaveCount(1);
  const attached = await api(page);
  expect(Object.values(attached.nodes).find((n) => n.params.prompt)?.params.prompt).toEqual(sourcePrompt);
  await page.keyboard.press('Control+z');
  await expect(loader).toHaveCount(0);
  expect(await api(page)).toEqual(baseline);
  await page.keyboard.press('Control+Shift+z');
  await expect(loader).toHaveCount(1);
  await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
  for (const duration of [4, 6]) {
    await loader.locator('input[type=file]').setInputFiles(wav(duration));
    const audio = loader.locator('audio');
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration)).toBe(duration);
    await audio.evaluate(async (a: HTMLAudioElement) => {
      a.muted = true;
      await a.play();
    });
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0);
    await audio.evaluate((a: HTMLAudioElement) => {
      a.pause();
      a.currentTime = 2;
    });
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBe(2);
  }
  const beforeReload = await api(page);
  await page.reload();
  await expect(loader).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => loader.locator('audio').evaluate((a: HTMLAudioElement) => a.duration)).toBe(6);
  expect(await api(page)).toEqual(beforeReload);
  await loader.screenshot({ path: test.info().outputPath('audio-loader.png') });
  expect(errors).toEqual([]);
});
