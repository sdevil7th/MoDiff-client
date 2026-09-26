import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  test.skip(process.env.MODIFF_NODE_UX_ISOLATED !== '1', 'Requires isolated backend state');
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto('/');
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
});

async function setup(page: Page, task: string, pipeline = 'StableDiffusionXLModularPipeline') {
  return page.evaluate(
    async ({ task, pipeline }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
      const { requestOperationStarter } = await import('/src/workflow/operationStarterRequest.ts');
      const { createWorkflowDraft } = await import('/src/workflow/workflowDraft.ts');
      const { prepareWorkflowForManualInsertion } = await import('/src/studio/manualGraphInsertion.ts');
      const registry = useNodesStore.getState();
      const starter = await requestOperationStarter(pipeline, task, registry.operationContracts);
      const { graph } = createWorkflowDraft(starter, registry.nodesRegistry);
      const input = graph.nodes.find((node) => node.data.label === 'Encode Inputs')!;
      const source = graph.nodes.find((node) => node.data.module === 'modules.Image' && node.data.action === 'Load');
      if (task === 'image_to_image' && !source) throw new Error('Fresh img2img starter must include Load Image');
      graph.nodes.forEach((node, index) => {
        node.position =
          node === source
            ? { x: 20, y: 100 }
            : node === input
              ? { x: 460, y: 70 }
              : { x: 950 + (index % 2) * 450, y: 70 + Math.floor(index / 2) * 620 };
        if (node.data.blockInstanceV2) node.data.blockInstanceV2.presentation.position = node.position;
      });
      prepareWorkflowForManualInsertion();
      useFlowStore.getState().replaceGraph(graph);
      return { input: input.id, source: source?.id, before: graph };
    },
    { task, pipeline },
  );
}

async function api(page: Page) {
  return page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore.getState().exportGraph('', undefined, { randomizeSeeds: false });
  });
}

test('Preview Image rejects a wire back to its encoder with a visible cycle explanation', async ({ page }) => {
  const ids = await setup(page, 'image_to_image');
  const preview = ids.before.nodes.find(
    (node) => node.data.module === 'modules.Image' && node.data.action === 'Preview',
  )!;
  const inputPort = ids.before.nodes
    .find((node) => node.id === ids.input)!
    .data.blockInstanceV2!.effectiveInterface.boundary.inputs.find(
      (port) => port.binding.fieldOrPortId === 'image',
    )!.portId;
  await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
  const source = page.locator(`.react-flow__node[data-id="${preview.id}"] .react-flow__handle.source`).first();
  const target = page.locator(
    `.react-flow__node[data-id="${ids.input}"] .react-flow__handle.target[data-handleid="${inputPort}"]`,
  );
  const before = await api(page);
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Missing cycle gesture sockets');
  await source.hover();
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 25 });
  await page.mouse.up();
  await expect(page.getByText(/Cannot connect:.*dependency loop|would create a cycle/u)).toBeVisible();
  expect(await api(page)).toEqual(before);
  await page.screenshot({ path: test.info().outputPath('cycle-rejection.png') });
});

test('Preview Image connects directly to an independent downstream encoding branch', async ({ page }) => {
  const upstream = await setup(page, 'image_to_image');
  const preview = upstream.before.nodes.find(
    (node) => node.data.module === 'modules.Image' && node.data.action === 'Preview',
  )!;
  const branch = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const { requestOperationStarter } = await import('/src/workflow/operationStarterRequest.ts');
    const { createWorkflowDraft } = await import('/src/workflow/workflowDraft.ts');
    const registry = useNodesStore.getState();
    const starter = await requestOperationStarter(
      'ZImageModularPipeline',
      'text_to_image',
      registry.operationContracts,
    );
    const { graph } = createWorkflowDraft(starter, registry.nodesRegistry);
    const flow = useFlowStore.getState();
    flow.replaceGraph({ nodes: [...flow.nodes, ...graph.nodes], edges: [...flow.edges, ...graph.edges] });
    return graph.nodes.find((node) => node.data.label === 'Encode Inputs')!.id;
  });
  await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
  const source = page.locator(`.react-flow__node[data-id="${preview.id}"] .react-flow__handle.source`).first();
  const target = page.locator(
    `.react-flow__node[data-id="${branch}"] .react-flow__handle.target[data-handleid="modiff-encoding-input:image"]`,
  );
  await expect(target).toBeVisible();
  const before = await api(page);
  const point = await target.boundingBox();
  if (!point) throw new Error('Downstream image socket is missing');
  await source.hover();
  await page.mouse.down();
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2, { steps: 25 });
  await page.mouse.up();
  await expect(target).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Attach media input', exact: true })).toHaveCount(0);
  const connected = await api(page);
  expect(
    Object.values(connected.nodes).some(
      (node) => node.action === 'ImageEncode' && node.params.image.sourceId === preview.id,
    ),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  expect(await api(page)).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await api(page)).toEqual(connected);
  await page.reload();
  await expect(page.locator(`.react-flow__node[data-id="${branch}"]`)).toBeVisible({ timeout: 45_000 });
  expect(await api(page)).toEqual(connected);
  await page.screenshot({ path: test.info().outputPath('preview-downstream-branch.png') });
});

test('one Encode Inputs: simultaneous inputs, preview, disclosure, persistence and implementation menu', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.text().includes('reactflow.dev/error#008')) errors.push(message.text());
  });
  const ids = await setup(page, 'image_to_image');
  await writeFile(test.info().outputPath('before-workflow.json'), JSON.stringify(ids.before, null, 2));
  const input = page.locator(`.react-flow__node[data-id="${ids.input}"]`);
  const source = page.locator(`.react-flow__node[data-id="${ids.source}"]`);
  await expect(input.getByTestId(`encoding-controls-${ids.input}`)).toBeVisible();
  await expect(input).toHaveClass(/react-flow__node-encoding/);
  await expect(input.locator('[data-block-expanded]')).toHaveCount(0);
  await expect(input.getByRole('button', { name: 'Attach input', exact: true })).toHaveCount(0);
  await expect(input.locator('input[type=file]')).toHaveCount(0);
  await expect(input.getByRole('button', { name: 'Text encoding controls', exact: true })).toBeVisible();
  await expect(input.getByRole('button', { name: 'Image encoding controls', exact: true })).toBeVisible();
  await source
    .locator('input[type=file]')
    .setInputFiles(process.env.MODIFF_ENCODING_REVIEW_IMAGE || 'public/assets/modiff-icon-256.png');
  const preview = source.locator('img').first();
  await expect
    .poll(() => preview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  await input
    .locator('textarea')
    .first()
    .fill('An editorial photograph of a woman in a crimson coat walking on a rainy New York street');
  await input.locator('textarea').first().press('Tab');
  const before = await api(page);
  const denoise = Object.values(before.nodes).find((node) => node.action === 'Denoise')!;
  expect(before.nodes[denoise.params.embeddings.sourceId!].action).toBe('EncodePrompt');
  expect(before.nodes[denoise.params.image_latents.sourceId!].action).toBe('ImageEncode');
  const sourceColor = await source
    .locator('.react-flow__handle.source[data-handleid="image"]')
    .evaluate((handle) => getComputedStyle(handle).getPropertyValue('--modiff-flow-handle-color'));
  const imagePort = ids.before.nodes
    .find((node) => node.id === ids.input)!
    .data.blockInstanceV2!.effectiveInterface.boundary.inputs.find(
      (port) => port.binding.fieldOrPortId === 'image',
    )!.portId;
  const targetColor = await input
    .locator(`.react-flow__handle.target[data-handleid="${imagePort}"]`)
    .evaluate((handle) => getComputedStyle(handle).getPropertyValue('--modiff-flow-handle-color'));
  expect(targetColor).toBe(sourceColor);
  expect(targetColor.trim()).not.toBe('');
  await input.getByRole('button', { name: 'Text encoding controls', exact: true }).click();
  await input.getByRole('button', { name: 'Image encoding controls', exact: true }).click();
  await expect(input.locator('textarea').first()).toBeHidden();
  expect(await api(page)).toEqual(before);
  await input.getByRole('button', { name: 'Text encoding controls', exact: true }).click();
  await input.getByRole('button', { name: 'Image encoding controls', exact: true }).click();
  await expect(input.getByText(/Seed for image-latent sampling/)).toBeVisible();
  await expect(input.getByText(/Shared with/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('image-workflow.png') });
  await input.screenshot({ path: test.info().outputPath('encode-inputs.png') });
  await page.reload();
  await expect(input.getByTestId(`encoding-controls-${ids.input}`)).toBeVisible({ timeout: 60_000 });
  await expect(input.locator('textarea').first()).toHaveValue(/crimson coat/);
  await expect
    .poll(() => preview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  expect(await api(page)).toEqual(before);
  await input.getByRole('button', { name: 'Encode Inputs options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Documentation', exact: true }).click();
  const docs = page.getByRole('dialog', { name: 'Encode Inputs documentation', exact: true });
  await expect(docs.getByRole('heading', { name: 'Encode Inputs documentation', exact: true })).toBeVisible();
  await docs.getByRole('button', { name: 'Close', exact: true }).click();
  await input.getByRole('button', { name: 'Encode Inputs options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Inspect implementation', exact: true }).click();
  const implementation = page.getByRole('dialog', { name: 'Encode Inputs implementation', exact: true });
  await expect(
    implementation.getByRole('heading', { name: 'Encode Inputs implementation', exact: true }),
  ).toBeVisible();
  await expect(implementation.getByRole('heading', { name: 'Encode Image', exact: true })).toBeVisible();
  expect(await api(page)).toEqual(before);
  await implementation.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(input.getByRole('button', { name: /Expand block|Collapse block/ })).toHaveCount(0);
  await input.getByRole('button', { name: 'Encode Inputs options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Separate encoding stages', exact: true }).click();
  await expect(input).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(input).toBeVisible();
  expect(await api(page)).toEqual(before);
  expect(errors).toEqual([]);
  await writeFile(test.info().outputPath('api-preserved.json'), JSON.stringify(before, null, 2));
});

test('saved expanded encoder restores as a node, never a nested Block', async ({ page }) => {
  const ids = await setup(page, 'text_to_image');
  const before = await api(page);
  await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { blockOperationGraphV2 } = await import('/src/studio/blockRuntimeV2.ts');
    const graph = useFlowStore.getState().toObject();
    const root = graph.nodes.find((node) => node.id === id)!;
    const instance = root.data.blockInstanceV2!;
    instance.presentation.expanded = true;
    const projection = blockOperationGraphV2(instance);
    graph.nodes.push(...projection.nodes.map((node) => ({ ...node, parentId: id, position: { x: 24, y: 96 } })));
    graph.edges.push(...projection.edges.map((edge) => ({ ...edge, data: { blockProjectionOwnerId: id } })));
    useFlowStore.getState().replaceGraph(graph);
  }, ids.input);
  const input = page.locator(`.react-flow__node[data-id="${ids.input}"]`);
  await expect(input).toHaveClass(/react-flow__node-encoding/);
  await expect(input.locator('textarea').first()).toBeVisible();
  await input.getByText('Encode Inputs', { exact: true }).click();
  await expect(input.getByRole('button', { name: /Expand block|Collapse block/i })).toHaveCount(0);
  await expect(page.getByTestId('selection-toolbar-collapse')).toHaveCount(0);
  await expect(page.getByTestId('selection-toolbar-inspect-node')).toHaveAccessibleName('Inspect node');
  // Native drag and resize must not leak the canvas-only renderer type into persistence.
  const originalBounds = (await input.boundingBox())!;
  const header = (await input.locator('header').boundingBox())!;
  await page.mouse.move(header.x + 100, header.y + 20);
  await page.mouse.down();
  await page.mouse.move(header.x + 160, header.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await input.boundingBox())!.x).toBeGreaterThan(originalBounds.x + 30);
  const movedBounds = (await input.boundingBox())!;
  const grip = (await input.getByLabel('Drag to resize node', { exact: true }).boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 40, grip.y + grip.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await input.boundingBox())!.width).toBeGreaterThan(movedBounds.width + 20);
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const state = useFlowStore.getState();
        state.toggleUserBlockExpanded(id);
        return {
          expanded: state.nodes.find((node) => node.id === id)!.data.blockInstanceV2!.presentation.expanded,
          children: state.nodes.filter((node) => node.parentId === id || node.data.blockProjectionOwnerId === id)
            .length,
        };
      }, ids.input),
    )
    .toEqual({ expanded: false, children: 0 });
  expect(await api(page)).toEqual(before);
  await page.reload();
  await expect(input).toHaveClass(/react-flow__node-encoding/, { timeout: 60_000 });
  await expect(input.locator('textarea').first()).toBeVisible();
  expect(await api(page)).toEqual(before);
  await input.screenshot({ path: test.info().outputPath('restored-expanded-as-node.png') });
});

test('text-only workflow exposes optional Image without adding execution stages', async ({ page }) => {
  const ids = await setup(page, 'text_to_image');
  const input = page.locator(`.react-flow__node[data-id="${ids.input}"]`);
  await expect(input.getByRole('button', { name: 'Text encoding controls', exact: true })).toBeVisible();
  await expect(input.getByRole('button', { name: 'Image encoding controls', exact: true })).toBeVisible();
  await expect(input.locator('.react-flow__handle.target[data-handleid="modiff-encoding-input:image"]')).toBeVisible();
  await expect(input.locator('.react-flow__handle.target[data-handleid="modiff-encoding-input:vae"]')).toBeVisible();
  await expect(
    input.locator('.react-flow__handle.source[data-handleid="modiff-encoding-output:image_latents"]'),
  ).toBeVisible();
  await expect(input.getByRole('button', { name: 'Attach input', exact: true })).toHaveCount(0);
  expect(
    ids.before.nodes
      .find((node) => node.id === ids.input)!
      .data.blockInstanceV2!.effectiveGraph.nodes.every((node) => node.data.action !== 'ImageEncode'),
  ).toBe(true);
  await input.screenshot({ path: test.info().outputPath('text-only.png') });
});

test('optional Image drag-to-add connects directly, is typed, atomic and persistent', async ({ page }) => {
  const ids = await setup(page, 'text_to_image');
  const input = page.locator(`.react-flow__node[data-id="${ids.input}"]`);
  await input.locator('textarea').first().fill('Retain this editorial prompt while adding an image');
  await input.locator('textarea').first().press('Tab');
  const before = await api(page);
  const optional = input.locator('.react-flow__handle.target[data-handleid="modiff-encoding-input:image"]');
  async function openFromSocket() {
    const box = (await optional.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 240, box.y - 60, { steps: 15 });
    await page.mouse.up();
    await page.getByPlaceholder('Search nodes and Blocks').fill('Load Image');
    const matching = page.getByRole('listbox', { name: 'Matching nodes' });
    await expect(matching.getByRole('option').filter({ hasText: 'Load Audio' })).toHaveCount(0);
    return matching;
  }
  await openFromSocket();
  await page.keyboard.press('Escape');
  expect(await api(page)).toEqual(before);
  await expect(optional).toBeVisible();
  const matching = await openFromSocket();
  await matching
    .getByRole('option')
    .filter({ hasText: /^Load Image/ })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: 'Attach media input', exact: true })).toHaveCount(0);
  await expect(input.locator('textarea').first()).toHaveValue('Retain this editorial prompt while adding an image');
  await expect(optional).toHaveCount(0);
  await expect(
    page.locator('.react-flow__node').filter({ has: page.locator('header', { hasText: 'Load Image' }) }),
  ).toHaveCount(1);
  const after = await api(page);
  const encoder = Object.values(after.nodes).find((node) => node.action === 'ImageEncode')!;
  expect(encoder).toBeTruthy();
  expect(after.nodes[encoder.params.image.sourceId!].action).toBe('Load');
  expect(JSON.stringify(after)).not.toContain('modiff-encoding-input:image');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(optional).toBeVisible();
  expect(await api(page)).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  await expect(optional).toHaveCount(0);
  expect(await api(page)).toEqual(after);
  await page.reload();
  await expect(input.locator('textarea').first()).toHaveValue('Retain this editorial prompt while adding an image', {
    timeout: 60_000,
  });
  expect(await api(page)).toEqual(after);
  await page.screenshot({ path: test.info().outputPath('optional-image-attached.png') });
});

test('encoding uses standard status-strip resize, shrinking scrolls controls and persists', async ({ page }) => {
  const ids = await setup(page, 'image_to_image');
  const input = page.locator(`.react-flow__node[data-id="${ids.input}"]`);
  const body = input.getByTestId(`node-scroll-body-${ids.input}`);
  const grip = input.getByLabel('Drag to resize node', { exact: true });
  await expect(input.getByRole('button', { name: 'Node help', exact: true })).toBeVisible();
  await expect(input.getByRole('button', { name: 'Node is not cached', exact: true })).toBeVisible();
  const before = await api(page);
  const initial = (await input.boundingBox())!;
  const start = (await grip.boundingBox())!;
  const target = input.locator('.react-flow__handle.target').first();
  expect(start.y + start.height).toBeLessThanOrEqual((await target.boundingBox())!.y + 8);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 - 35, start.y + start.height / 2 - 420, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await input.boundingBox())!.height).toBeLessThan(initial.height - 100);
  await expect.poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(await body.evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(95);
  const resized = (await input.boundingBox())!;
  for (const handle of await input.locator('.react-flow__handle').all()) {
    const bounds = (await handle.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(resized.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(resized.y + resized.height + 1);
  }
  await input.locator('textarea').first().fill('Prompt edited after shrinking the standard node');
  await input.locator('textarea').first().press('Tab');
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(input.getByText(/Seed for image-latent sampling/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('standard-resize-scrolling.png') });
  await page.reload();
  await expect(input).toBeVisible({ timeout: 60_000 });
  expect(Math.abs((await input.boundingBox())!.height - resized.height)).toBeLessThan(2);
  await expect(input.locator('textarea').first()).toHaveValue('Prompt edited after shrinking the standard node');
  const after = await api(page);
  expect(Object.keys(after.nodes)).toEqual(Object.keys(before.nodes));
});

for (const [pipeline, task] of [
  ['ZImageModularPipeline', 'text_to_image'],
  ['QwenImageModularPipeline', 'text_to_image'],
  ['QwenImageModularPipeline', 'control_image'],
]) {
  test(`${pipeline} ${task}: existing image output connects directly and retains branches`, async ({ page }) => {
    const ids = await setup(page, task!, pipeline!);
    const input = page.locator(`.react-flow__node[data-id="${ids.input}"]`);
    const sourceId = await page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
      const { createNodeFromRegistry } = await import('/src/workflow/nodeFactory.ts');
      const node = createNodeFromRegistry('modules.Image.Load', useNodesStore.getState().nodesRegistry, {
        x: 20,
        y: 550,
      })!;
      useFlowStore.getState().addNode(node);
      const control = useFlowStore.getState().nodes.find((item) => item.data.action === 'Controlnet');
      if (control)
        useFlowStore.getState().onConnect({
          source: node.id,
          sourceHandle: 'image',
          target: control.id,
          targetHandle: 'control_image',
          edgeType: 'default',
        });
      return node.id;
    });
    await input.locator('textarea').first().fill('Preserve this prompt and the ControlNet branch');
    await input.locator('textarea').first().press('Tab');
    const before = await api(page);
    const source = page.locator(`.react-flow__node[data-id="${sourceId}"]`);
    const a = (await source.locator('.react-flow__handle.source[data-handleid="image"]').boundingBox())!;
    const optional = input.locator('.react-flow__handle.target[data-handleid="modiff-encoding-input:image"]');
    await expect(optional).toBeVisible();
    const b = (await optional.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
    await page.mouse.up();
    await expect(optional).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Attach media input', exact: true })).toHaveCount(0);
    await expect(input.locator('textarea').first()).toHaveValue('Preserve this prompt and the ControlNet branch');
    const graph = await api(page);
    const image = Object.values(graph.nodes).find((node) => node.action === 'ImageEncode')!;
    expect(image.params.image.sourceId).toBe(sourceId);
    expect(JSON.stringify(graph)).not.toContain('modiff-encoding-input:image');
    const denoise = Object.values(graph.nodes).find((node) => node.action === 'Denoise')!;
    expect(graph.nodes[denoise.params.image_latents.sourceId!].action).toBe('ImageEncode');
    expect(graph.nodes[denoise.params.embeddings.sourceId!].action).toBe('EncodePrompt');
    if (task === 'control_image') {
      const controls = Object.entries(graph.nodes).filter(([, node]) => node.action === 'Controlnet');
      expect(controls).toHaveLength(1);
      expect(controls[0]![1].params.control_image.sourceId).toBe(sourceId);
      expect(denoise.params.controlnet_bundle.sourceId).toBe(controls[0]![0]);
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await expect(optional).toBeVisible();
    expect(await api(page)).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    await expect(optional).toHaveCount(0);
    expect(await api(page)).toEqual(graph);
    await page.reload();
    await expect(input).toBeVisible({ timeout: 60_000 });
    expect(await api(page)).toEqual(graph);
    await input.screenshot({ path: test.info().outputPath('connected.png') });
  });
}

test('Image Latents is connectable before Image; subsequent image input is an ordinary wire', async ({ page }) => {
  const ids = await setup(page, 'text_to_image');
  const before = await api(page);
  const input = page.locator(`.react-flow__node[data-id="${ids.input}"]`);
  const denoiseId = ids.before.nodes.find((node) => node.data.action === 'Denoise')!.id;
  const denoise = page.locator(`.react-flow__node[data-id="${denoiseId}"]`);
  const optional = input.locator('.react-flow__handle.source[data-handleid="modiff-encoding-output:image_latents"]');
  await expect(optional).toBeVisible();
  const from = (await optional.boundingBox())!;
  const to = (await denoise.locator('.react-flow__handle.target[data-handleid="image_latents"]').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(optional).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Attach media input', exact: true })).toHaveCount(0);
  const graph = await api(page);
  const promptBefore = Object.values(before.nodes).find((node) => node.action === 'EncodePrompt')!;
  const promptAfter = Object.values(graph.nodes).find((node) => node.action === 'EncodePrompt')!;
  expect(promptAfter.params.prompt).toEqual(promptBefore.params.prompt);
  const encoded = graph.nodes[graph.nodes[denoiseId].params.image_latents.sourceId!];
  expect(encoded.action).toBe('ImageEncode');
  expect(encoded.params.image.sourceId).toBeUndefined();
  // Connecting the actual Image port must no longer request any route at all.
  let starterRequests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/operations/starter')) starterRequests++;
  });
  const image = input.locator('.react-flow__handle.target[data-handleid$=":image"]');
  const box = (await image.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 230, box.y - 40, { steps: 15 });
  await page.mouse.up();
  await page.getByPlaceholder('Search nodes and Blocks').fill('Load Image');
  await page
    .getByRole('listbox', { name: 'Matching nodes' })
    .getByRole('option')
    .filter({ hasText: /^Load Image/ })
    .first()
    .click();
  await expect
    .poll(async () => {
      const next = await api(page);
      const encoder = next.nodes[next.nodes[denoiseId].params.image_latents.sourceId!];
      return Boolean(encoder.params.image.sourceId);
    })
    .toBe(true);
  expect(starterRequests).toBe(0);
  await expect(page.getByRole('dialog', { name: 'Attach media input', exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('output-first-connected.png') });
});

test('failed direct preparation does not leave a source, stages or wires', async ({ page }) => {
  const ids = await setup(page, 'text_to_image');
  const before = await api(page);
  await page.route('**/operations/starter', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Test preparation unavailable' }),
    }),
  );
  const input = page.locator(`.react-flow__node[data-id="${ids.input}"]`);
  const optional = input.locator('.react-flow__handle.target[data-handleid="modiff-encoding-input:image"]');
  const box = (await optional.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 240, box.y - 60, { steps: 15 });
  await page.mouse.up();
  await page.getByPlaceholder('Search nodes and Blocks').fill('Load Image');
  await page
    .getByRole('listbox', { name: 'Matching nodes' })
    .getByRole('option')
    .filter({ hasText: /^Load Image/ })
    .first()
    .click();
  await expect(page.getByText(/Test preparation unavailable/)).toBeVisible();
  expect(await api(page)).toEqual(before);
  await expect(optional).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Attach media input', exact: true })).toHaveCount(0);
});

test('connected prompt provenance and hidden runtime summary preserve the authored graph', async ({ page }) => {
  const ids = await setup(page, 'image_to_image');
  const input = page.locator(`.react-flow__node[data-id="${ids.input}"]`);
  const prompt = input.locator('textarea').first();
  await prompt.fill('Retained local fallback');
  await prompt.press('Tab');
  const stageId = await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const { createNodeFromRegistry } = await import('/src/workflow/nodeFactory.ts');
    const { blockProjectionNodeIdV2 } = await import('/src/studio/blockRuntimeV2.ts');
    const graph = useFlowStore.getState().toObject();
    const root = graph.nodes.find((node) => node.id === id)!;
    const instance = root.data.blockInstanceV2!;
    const text = createNodeFromRegistry('modules.Primitive.TextValue', useNodesStore.getState().nodesRegistry, {
      x: 0,
      y: 850,
    })!;
    const port = instance.effectiveInterface.boundary.inputs.find(
      (port) => port.binding.fieldOrPortId === 'prompt_input',
    )!;
    const output = Object.entries(text.data.params).find(([, param]) => param.display === 'output')![0];
    graph.nodes.push(text);
    graph.edges.push({
      id: 'review-prompt-wire',
      source: text.id,
      sourceHandle: output,
      target: id,
      targetHandle: port.portId,
    });
    useFlowStore.getState().replaceGraph(graph);
    return blockProjectionNodeIdV2(
      id,
      instance.effectiveGraph.nodes.find((stage) => stage.data.action === 'ImageEncode')!.nodeId,
    );
  }, ids.input);
  await expect(prompt).toBeDisabled();
  await expect(prompt).toHaveValue('Retained local fallback');
  await expect(input.getByText(/Using Prompt Input from Text Value/)).toBeVisible();
  const before = await api(page);
  // Synthetic websocket receipt: verifies UI wiring, not model inference.
  const receipt = await page.evaluate(async (stageId) => {
    const { useFlowStore, durableFlowNodeSnapshot } = await import('/src/stores/useFlowStore.ts');
    const { handleWebsocketMessage } = await import('/src/stores/websocketMessageHandler.ts');
    const before = useFlowStore.getState().toObject();
    handleWebsocketMessage(
      {
        type: 'update_value',
        node: stageId,
        key: 'encode_summary',
        value: JSON.stringify({
          schemaVersion: 1,
          status: 'encoded',
          shape: [1, 4, 64, 64],
          dtype: 'float16',
          device: 'cpu',
          elapsedSeconds: 0.25,
        }),
      },
      { sid: null, ws: {} as WebSocket, getSid: () => null, setSid: () => undefined, setLoopTimer: () => undefined },
    );
    const owner = useFlowStore.getState().nodes.find((node) => node.data.uiState?.encodingSummaries?.[stageId])!;
    return {
      received: Boolean(owner),
      persisted: owner ? Boolean(durableFlowNodeSnapshot(owner).data.uiState?.encodingSummaries) : null,
      graphPreserved:
        JSON.stringify(before.nodes.map((node) => node.data.blockInstanceV2)) ===
        JSON.stringify(useFlowStore.getState().nodes.map((node) => node.data.blockInstanceV2)),
    };
  }, stageId);
  expect(receipt).toEqual({ received: true, persisted: false, graphPreserved: true });
  await expect(input.getByText('1×4×64×64', { exact: true })).toBeVisible();
  expect(await api(page)).toEqual(before);
  await input.screenshot({ path: test.info().outputPath('connected-prompt-synthetic-summary.png') });
  await input.getByRole('button', { name: 'Encode Inputs options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Inspect implementation', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Encode Inputs implementation', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await expect(input.getByText('1×4×64×64', { exact: true })).toBeVisible();
  expect(await api(page)).toEqual(before);
  await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    useFlowStore.getState().resetExecutionProgress();
    const graph = useFlowStore.getState().toObject();
    useFlowStore.getState().replaceGraph({
      ...graph,
      edges: graph.edges.filter((edge) => !['review-prompt-wire', 'review-image-wire'].includes(edge.id)),
    });
  });
  await expect(prompt).toBeEnabled();
  await expect(prompt).toHaveValue('Retained local fallback');
  await expect(input.getByText('1×4×64×64', { exact: true })).toHaveCount(0);
  await expect(input.getByText('Connect an input image to encode.', { exact: true })).toBeVisible();
});
