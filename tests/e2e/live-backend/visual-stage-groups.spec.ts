import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Isolated backend state, real registry/starter schemas; native gestures after setup.
test.beforeEach(async ({ page }) => {
  test.skip(process.env.MODIFF_NODE_UX_ISOLATED !== '1', 'Requires an isolated backend');
  page.setDefaultTimeout(20_000);
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto('/');
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
});

async function snapshot(page: Page) {
  return page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph()) as Promise<{
    nodes: Array<{
      id: string;
      data: {
        action: string;
        params: Record<string, { value?: unknown }>;
        blockInstanceV2?: {
          effectiveGraph: { nodes: Array<{ data: { action: string; params: Record<string, { value?: unknown }> } }> };
          values: Record<string, unknown>;
        };
      };
    }>;
    edges: Array<{ source: string; sourceHandle: string; target: string }>;
  }>;
}

test('Encode Inputs supports prompt editing, image attachment, Undo, refresh and ungroup', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const ids = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const { requestOperationStarter } = await import('/src/workflow/operationStarterRequest.ts');
    const { createWorkflowDraft } = await import('/src/workflow/workflowDraft.ts');
    const { prepareWorkflowForManualInsertion } = await import('/src/studio/manualGraphInsertion.ts');
    const starter = await requestOperationStarter(
      'StableDiffusionXLModularPipeline',
      'text_to_image',
      useNodesStore.getState().operationContracts,
    );
    const { graph } = createWorkflowDraft(starter, useNodesStore.getState().nodesRegistry);
    // Compact fixture placement keeps actual controls legible at native zoom.
    graph.nodes.forEach((node, index) => {
      node.position = { x: 60 + (index % 3) * 450, y: 60 + Math.floor(index / 3) * 680 };
    });
    for (const node of graph.nodes)
      if (node.data.blockInstanceV2) node.data.blockInstanceV2.presentation.position = node.position;
    prepareWorkflowForManualInsertion();
    useFlowStore.getState().replaceGraph(graph);
    return {
      input: graph.nodes.find((node) => node.data.label === 'Encode Inputs')!.id,
      guidance: graph.nodes.find((node) => node.data.label === 'Guidance')!.id,
      count: graph.nodes.length,
    };
  });
  await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
  const input = page.locator(`.react-flow__node[data-id="${ids.input}"]`);
  await expect(input.getByText('Encode Inputs', { exact: true }).first()).toBeVisible();
  const prompt = input.locator('textarea').first();
  await prompt.fill('A sophisticated fashion editorial in rainy New York, a crimson coat and wet street reflections');
  await prompt.press('Tab');
  const sourceId = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const { createNodeFromRegistry } = await import('/src/workflow/nodeFactory.ts');
    const source = createNodeFromRegistry('modules.Image.Load', useNodesStore.getState().nodesRegistry, {
      x: 0,
      y: 400,
    })!;
    useFlowStore.getState().addNode(source);
    return source.id;
  });
  await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
  const a = (await page
    .locator(`.react-flow__node[data-id="${sourceId}"] .react-flow__handle.source[data-handleid="image"]`)
    .boundingBox())!;
  const b = (await input
    .locator('.react-flow__handle.target[data-handleid="modiff-encoding-input:image"]')
    .boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 });
  await page.mouse.up();
  const attachment = page.getByRole('dialog', { name: 'Attach media input', exact: true });
  await expect(attachment).toHaveCount(0);
  const hasImage = async () =>
    (await snapshot(page)).nodes.some((node) =>
      node.data.blockInstanceV2?.effectiveGraph.nodes.some((member) => member.data.action === 'ImageEncode'),
    );
  await expect.poll(hasImage).toBe(true);
  expect((await snapshot(page)).nodes).toHaveLength(ids.count + 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect.poll(hasImage).toBe(false);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(hasImage).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(window.__MODIFF_E2E__)), { timeout: 60_000 }).toBe(true);
  await expect.poll(hasImage, { timeout: 60_000 }).toBe(true);
  await expect(prompt).toHaveValue(/crimson coat/u);
  await input.getByRole('button', { name: 'Encode Inputs options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Inspect implementation', exact: true }).click();
  const implementation = page.getByRole('dialog', { name: 'Encode Inputs implementation', exact: true });
  await expect(implementation.getByRole('heading', { name: 'Encode Image', exact: true })).toBeVisible();
  await implementation.getByRole('button', { name: 'Close', exact: true }).click();
  await input.getByRole('button', { name: 'Encode Inputs options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Separate encoding stages', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).nodes.some((node) => node.data.action === 'ImageEncode'))
    .toBe(true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(input).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('encode-inputs.png') });
});

test('existing stages group explicitly and an image wire adapts Encode Inputs', async ({ page }) => {
  const owner = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const { requestOperationStarter } = await import('/src/workflow/operationStarterRequest.ts');
    const { createOperationStarter } = await import('/src/workflow/operationAuthoring.ts');
    const { createNodeFromRegistry } = await import('/src/workflow/nodeFactory.ts');
    const { prepareWorkflowForManualInsertion } = await import('/src/studio/manualGraphInsertion.ts');
    const registry = useNodesStore.getState();
    const starter = await requestOperationStarter(
      'StableDiffusionXLModularPipeline',
      'text_to_image',
      registry.operationContracts,
    );
    const graph = createOperationStarter(starter, { x: 450, y: 40 });
    graph.nodes.push(createNodeFromRegistry('modules.Image.Load', registry.nodesRegistry, { x: 0, y: 400 })!);
    prepareWorkflowForManualInsertion();
    useFlowStore.getState().replaceGraph(graph);
    return graph.nodes.find((node) => node.data.action === 'ModelsLoader')!.id;
  });
  await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
  await page.locator(`.react-flow__node[data-id="${owner}"] header`).first().click();
  await page.getByRole('button', { name: 'Inspect node', exact: true }).click();
  const inspector = page.getByRole('dialog', { name: 'Node inspector', exact: true });
  await inspector.getByRole('button', { name: 'Workflow stage actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Group input encoders', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).nodes.filter((node) => node.data.blockInstanceV2).length)
    .toBe(1);
  if (!(await inspector.getByRole('heading', { name: 'Node inspector', exact: true }).isVisible())) {
    await page.locator(`.react-flow__node[data-id="${owner}"] header`).first().click();
    await page.getByRole('button', { name: 'Inspect node', exact: true }).click();
  }
  await inspector.getByRole('button', { name: 'Workflow stage actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Group guidance', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).nodes.filter((node) => node.data.blockInstanceV2).length)
    .toBe(2);
  if (await inspector.count()) await inspector.getByRole('button', { name: 'Close', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
  const graph = await snapshot(page);
  const sourceId = graph.nodes.find((node) => node.data.action === 'Load')!.id;
  const targetId = graph.nodes.find((node) =>
    node.data.blockInstanceV2?.effectiveGraph.nodes.some((member) => member.data.action === 'EncodePrompt'),
  )!.id;
  const clear = page.getByTitle('Clear finished notifications', { exact: true });
  if (await clear.isVisible()) await clear.click();
  const a = (await page
    .locator(`.react-flow__node[data-id="${sourceId}"] .react-flow__handle.source[data-handleid="image"]`)
    .boundingBox())!;
  const b = (await page
    .locator(
      `.react-flow__node[data-id="${targetId}"] .react-flow__handle.target[data-handleid="modiff-encoding-input:image"]`,
    )
    .boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: 'Attach media input', exact: true });
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await snapshot(page)).edges.some((edge) => edge.source === sourceId && edge.target === targetId))
    .toBe(true);
  const after = await snapshot(page);
  expect(after.nodes).toHaveLength(graph.nodes.length);
  expect(after.edges.some((edge) => edge.source === sourceId && edge.target === targetId)).toBe(true);
  expect(
    after.nodes
      .find((node) => node.id === targetId)
      ?.data.blockInstanceV2?.effectiveGraph.nodes.some((node) => node.data.action === 'ImageEncode'),
  ).toBe(true);
});

test('grouped native text and image generation deliver actual backend outputs', async ({ page }) => {
  const output = process.env.MODIFF_VISUAL_GROUP_OUTPUT;
  const source = process.env.MODIFF_NODE_UX_IMAGE;
  test.skip(!output || !source, 'Opt-in real installed-model acceptance');
  test.setTimeout(12 * 60_000);
  await mkdir(output!, { recursive: true });
  const queue = await (await page.request.get('/queue')).json();
  expect(queue.current).toBeNull();
  expect(Object.keys(queue.queued)).toHaveLength(0);
  const inputId = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const { requestOperationStarter } = await import('/src/workflow/operationStarterRequest.ts');
    const { createOperationStarter } = await import('/src/workflow/operationAuthoring.ts');
    const { groupNewOperationGraph } = await import('/src/workflow/visualOperationGroups.ts');
    const { createNodeFromRegistry } = await import('/src/workflow/nodeFactory.ts');
    const { prepareWorkflowForManualInsertion } = await import('/src/studio/manualGraphInsertion.ts');
    const registry = useNodesStore.getState();
    const starter = await requestOperationStarter(
      'StableDiffusionXLModularPipeline',
      'text_to_image',
      registry.operationContracts,
    );
    const graph = createOperationStarter(starter, { x: 40, y: 80 });
    for (const node of graph.nodes)
      for (const [key, value] of Object.entries({
        prompt:
          'An elegant woman in a crimson tailored coat walking on a rainy New York avenue at night, cinematic fashion editorial photograph, reflections on wet asphalt, intricate architectural facades, warm shop windows',
        width: 512,
        height: 512,
        num_inference_steps: 16,
        guidance_scale: 6,
        seed: { value: 8241, isRandom: false },
      }))
        if (node.data.params[key]) node.data.params[key].value = value;
    const decoder = graph.nodes.find((node) => node.data.action === 'DecodeLatents')!;
    const preview = createNodeFromRegistry('modules.Image.Preview', registry.nodesRegistry, { x: 2600, y: 100 })!;
    graph.nodes.push(preview);
    graph.edges.push({
      id: 'acceptance-preview',
      source: decoder.id,
      sourceHandle: 'images',
      target: preview.id,
      targetHandle: 'image',
      type: 'default',
    });
    const grouped = groupNewOperationGraph(graph);
    prepareWorkflowForManualInsertion();
    useFlowStore.getState().replaceGraph(grouped);
    return grouped.nodes.find((node) => node.data.label === 'Encode Inputs')!.id;
  });
  const automatic = page.getByRole('button', { name: 'Memory policy: Automatic. Click to switch.', exact: true });
  if (await automatic.count()) await automatic.click();
  for (const task of ['text', 'image']) {
    if (task === 'image') {
      const input = page.locator(`.react-flow__node[data-id="${inputId}"]`);
      const handle = (await input
        .locator('.react-flow__handle.target[data-handleid="modiff-encoding-input:image"]')
        .boundingBox())!;
      const pane = (await page.locator('.react-flow__pane').boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(pane.x + 30, pane.y + 40, { steps: 15 });
      await page.mouse.up();
      await page.getByPlaceholder('Search nodes and Blocks').fill('Load Image');
      await page
        .getByRole('listbox', { name: 'Matching nodes' })
        .getByRole('option')
        .filter({ hasText: /^Load Image/ })
        .first()
        .click();
      await expect
        .poll(async () => (await snapshot(page)).nodes.some((node) => node.data.action === 'Load'))
        .toBe(true);
      // Existing source-file fixture; use the ordinary file control's store path.
      await page.evaluate(async (path) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const flow = useFlowStore.getState();
        const load = flow.nodes.find((node) => node.data.module === 'modules.Image' && node.data.action === 'Load')!;
        flow.setParamWithHistory(load.id, 'file', path);
      }, source!);
    }
    await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
    const submitted = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/graph' && response.request().method() === 'POST',
      { timeout: 45_000 },
    );
    await page.getByTestId('studio-run').click();
    const response = await submitted;
    const admission = await response.json();
    const receipt: Record<string, unknown> = { admission, request: response.request().postDataJSON() };
    const save = () => writeFile(`${output}/${task}.json`, JSON.stringify(receipt, null, 2));
    await save();
    expect(response.ok(), JSON.stringify(admission)).toBe(true);
    const id = admission.task_id;
    await expect
      .poll(
        async () => {
          const queue = await (await page.request.get('/queue')).json();
          const run = [queue.current, ...Object.values(queue.queued), ...queue.recent].find(
            (item) => item?.task_id === id,
          );
          receipt.terminal = run;
          await save();
          return run?.status;
        },
        { timeout: 5 * 60_000, intervals: [3000, 5000] },
      )
      .toMatch(/^(completed|failed|cancelled)$/u);
    const run = await (await page.request.get(`/runs/${id}`)).json();
    receipt.run = run;
    await save();
    expect((receipt.terminal as { status: string }).status, JSON.stringify(run.error)).toBe('completed');
    const images = run.outputs
      .flatMap(
        (item: { backendProvenance?: { mediaItems?: Array<{ url: string; displayType: string }> } }) =>
          item.backendProvenance?.mediaItems ?? [],
      )
      .filter((item: { displayType: string }) => item.displayType === 'image');
    expect(images.length).toBeGreaterThan(0);
    const image = await page.request.get(images[0].url);
    expect(image.ok()).toBe(true);
    await writeFile(`${output}/${task}.webp`, await image.body());
    await page.screenshot({ path: `${output}/${task}-canvas.png` });
  }
});
