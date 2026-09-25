import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Run against scripts/run_node_ux_backend.py, never an operator's normal state.
const remote = process.env.MODIFF_NODE_UX_REPO;
const suffix = Date.now().toString();
const python = `from modiff.NodeBase import NodeBase
MODIFF_RUNTIME_ROLE = "data"
class Proof(NodeBase):
    label = "Local import proof"
    params = {"text": {"type": "string", "display": "text", "default": "local proof"}, "result": {"type": "string", "display": "output"}}
    def execute(self, text):
        return {"result": text + " passed"}
`;

test('detecting a Python file does not enable it; intentional Load and Reload do', async ({ page }) => {
  const root = process.env.MODIFF_NODE_UX_ROOT;
  test.skip(!root, 'Requires the explicitly isolated source directory');
  const name = `UX_detect_${suffix}`;
  const file = path.join(root!, 'custom', name + '.py');
  await writeFile(file, python);
  const group = page.getByTestId('node-group-custom-nodes');
  await group.getByRole('button').first().click();
  await expect(group.getByText(name, { exact: true })).toBeVisible({ timeout: 25_000 });
  await expect(group.getByText(name, { exact: true }).locator('..')).toContainText('Not loaded');
  await group.getByText(name, { exact: true }).click();
  const dialog = page.getByTestId('custom-extensions-dialog');
  const card = dialog
    .locator('div.grid')
    .filter({ has: page.locator('span.font-semibold').filter({ hasText: name }) })
    .last();
  await card.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
  await writeFile(file, python.replace('Local import proof', 'Reloaded local proof'));
  await card.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('loaded');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByPlaceholder('Search nodes').fill(name);
  await expect(group.getByRole('button', { name: 'Reloaded local proof', exact: true })).toBeVisible();
});

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(15_000);
  test.skip(process.env.MODIFF_NODE_UX_ISOLATED !== '1', 'Requires explicitly isolated backend');
  await page.goto('/');
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('left-tab-nodes').click();
  await expect(page.getByTestId('node-group-custom-nodes')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Creator', exact: true })).toHaveCount(0);
});

for (const kind of ['local', 'hub', 'git'] as const) {
  test(`real ${kind} addition enables, inserts, executes and survives refresh`, async ({ page }) => {
    test.skip(kind !== 'local' && !remote, 'Set MODIFF_NODE_UX_REPO to a real compatible fixture');
    test.setTimeout(180_000);
    const name = `UX_${kind}_${suffix}`;
    await page.getByRole('button', { name: 'Add custom node', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Add custom node', exact: true });
    if (kind === 'local') {
      await modal
        .getByLabel('Choose Python node file')
        .setInputFiles({ name: name + '.py', mimeType: 'text/x-python', buffer: Buffer.from(python) });
    } else {
      await modal.getByRole('button', { name: kind === 'hub' ? /Hugging Face/u : /^Git/u }).click();
      await modal
        .getByLabel('Extension source', { exact: true })
        .fill(kind === 'hub' ? remote! : `https://huggingface.co/${remote}`);
      await modal.getByRole('button', { name: 'Advanced options', exact: true }).click();
      await modal.getByLabel('Extension module name').fill(name);
      await modal.getByRole('button', { name: 'Add node', exact: true }).last().click();
    }
    await expect(modal.getByRole('status')).toContainText('Added and enabled', { timeout: 120_000 });
    await page.screenshot({ path: test.info().outputPath(`${kind}-added.png`) });
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    const group = page.getByTestId('node-group-custom-nodes');
    if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true')
      await group.getByRole('button').first().click();
    // Narrow the library by this package identity (the visible label is source-defined).
    await page.getByPlaceholder('Search nodes').fill(name);
    await group
      .getByRole('button', { name: kind === 'local' ? 'Local import proof' : 'Modular Prompt', exact: true })
      .click();
    await page.getByPlaceholder('Search nodes').fill('');
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    const socket = page.locator(
      `.react-flow__handle.source[data-handleid="${kind === 'local' ? 'result' : 'out_result'}"]`,
    );
    const box = await socket.boundingBox();
    const pane = await page.locator('.react-flow__pane').boundingBox();
    if (!box || !pane) throw new Error('Missing canvas or output socket');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(pane.x + pane.width - 150, pane.y + pane.height - 120, { steps: 12 });
    await page.mouse.up();
    await page.getByLabel('Show unverified matches (generic or missing types)').check();
    await page.getByPlaceholder('Search nodes and Blocks').fill('Data Viewer');
    await page.getByRole('option').filter({ hasText: 'Data Viewer' }).first().click();
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    await page.getByTestId('studio-run').click();
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const { useTaskStore } = await import('/src/stores/useTaskStore.ts');
            return useTaskStore.getState().sessionRuns.map((run) => run.status);
          }),
        { timeout: 60_000 },
      )
      .toContain('completed');
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 60_000 });
    await expect(page.getByTestId('node-group-custom-nodes')).toBeVisible();
  });
}

test('wire dragging highlights matching existing image sockets, not audio sockets', async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1100 });
  const clearActivity = page.getByTestId('run-session-shelf').getByRole('button', { name: 'Clear', exact: true });
  if (await clearActivity.isVisible()) await clearActivity.click();
  const ids = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const { createNodeFromRegistry } = await import('/src/workflow/nodeFactory.ts');
    const { prepareWorkflowForManualInsertion } = await import('/src/studio/manualGraphInsertion.ts');
    const nodes = ['modules.Image.Load', 'modules.Image.Preview', 'modules.Audio.TrimPad'].map((key, i) =>
      createNodeFromRegistry(key, useNodesStore.getState().nodesRegistry, { x: i * 430, y: 80 })!,
    );
    prepareWorkflowForManualInsertion();
    useFlowStore.getState().replaceGraph({ nodes, edges: [] });
    return nodes.map((node) => node.id);
  });
  await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
  const source = page.locator(
    `.react-flow__node[data-id="${ids[0]}"] .react-flow__handle.source[data-handleid="image"]`,
  );
  const target = page.locator(
    `.react-flow__node[data-id="${ids[1]}"] .react-flow__handle.target[data-handleid="image"]`,
  );
  const incompatible = page.locator(
    `.react-flow__node[data-id="${ids[2]}"] .react-flow__handle.target[data-handleid="audio"]`,
  );
  await source.hover(); // Ensure no activity overlay intercepts the real socket.
  const box = await source.boundingBox();
  if (!box) throw new Error('Missing image output');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 30, { steps: 5 });
  await expect(target).toHaveAttribute('data-connection-match', 'compatible');
  await expect(incompatible).not.toHaveAttribute('data-connection-match', 'compatible');
  await page.screenshot({ path: test.info().outputPath('matching-sockets.png') });
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('canvas Python drop inserts the declared node; invalid file gives a reason', async ({ page }) => {
  const name = `UX_drop_${suffix}`;
  const transfer = await page.evaluateHandle(
    ({ name, python }) => {
      const data = new DataTransfer();
      data.items.add(new File([python], name + '.py', { type: 'text/x-python' }));
      return data;
    },
    { name, python },
  );
  await page.locator('.react-flow__pane').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  const bad = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['print("not a node")'], 'BadNode.py'));
    return data;
  });
  await page.locator('.react-flow__pane').dispatchEvent('drop', { dataTransfer: bad });
  await expect(page.getByText(/Node import failed:/u)).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
});

test('native image attachment uses backend roles, keeps prompt and supports Undo/refresh', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const ownerId = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const { requestOperationStarter } = await import('/src/workflow/operationStarterRequest.ts');
    const { createOperationStarter } = await import('/src/workflow/operationAuthoring.ts');
    const { prepareWorkflowForManualInsertion } = await import('/src/studio/manualGraphInsertion.ts');
    const starter = await requestOperationStarter(
      'StableDiffusionXLModularPipeline',
      'text_to_image',
      useNodesStore.getState().operationContracts,
    );
    const graph = createOperationStarter(starter, { x: 40, y: 60 });
    const prompt = graph.nodes.find((node) => node.data.params.prompt)!;
    prompt.data.params.prompt.value = 'A fashion editorial on a rainy New York street';
    prepareWorkflowForManualInsertion();
    useFlowStore.getState().replaceGraph(graph);
    return graph.nodes.find((node) => node.data.operationAuthoring?.operation.decomposition === 'loader')!.id;
  });
  await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
  await page.locator(`.react-flow__node[data-id="${ownerId}"] header`).first().click();
  await page.getByRole('button', { name: 'Inspect node', exact: true }).click();
  const inspector = page.getByRole('dialog', { name: 'Node inspector', exact: true });
  await inspector.getByRole('button', { name: 'Workflow stage actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add image / audio input…', exact: true }).click();
  const attachment = page.getByRole('dialog', { name: 'Add image / audio input', exact: true });
  await attachment.getByLabel('Media input role', { exact: true }).click();
  await page.getByRole('option', { name: 'image to image · image', exact: true }).click();
  await attachment.getByRole('button', { name: 'Attach input', exact: true }).click();
  const state = () =>
    page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const graph = useFlowStore.getState().toObject();
      return {
        actions: graph.nodes.map((node) => node.data.action),
        prompt: graph.nodes.find((node) => node.data.params.prompt)?.data.params.prompt.value,
        imageWires: graph.edges.filter((edge) => edge.sourceHandle === 'image').length,
      };
    });
  await expect.poll(async () => (await state()).actions).toContain('ImageEncode');
  expect((await state()).prompt).toBe('A fashion editorial on a rainy New York street');
  expect((await state()).imageWires).toBeGreaterThan(0);
  if (await inspector.isVisible()) await inspector.getByRole('button', { name: 'Close', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state()).actions.includes('ImageEncode')).toBe(false);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await state()).actions).toContain('ImageEncode');
  await page.reload();
  await expect.poll(async () => (await state()).actions, { timeout: 60_000 }).toContain('ImageEncode');
  expect((await state()).prompt).toBe('A fashion editorial on a rainy New York street');
  await page.screenshot({ path: test.info().outputPath('image-attachment.png') });
});

test('drag an existing image output onto the operation to adapt the same graph', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const ids = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const { requestOperationStarter } = await import('/src/workflow/operationStarterRequest.ts');
    const { createOperationStarter } = await import('/src/workflow/operationAuthoring.ts');
    const { createNodeFromRegistry } = await import('/src/workflow/nodeFactory.ts');
    const { prepareWorkflowForManualInsertion } = await import('/src/studio/manualGraphInsertion.ts');
    const catalog = useNodesStore.getState();
    const starter = await requestOperationStarter(
      'StableDiffusionXLModularPipeline',
      'text_to_image',
      catalog.operationContracts,
    );
    const graph = createOperationStarter(starter, { x: 450, y: 50 });
    const source = createNodeFromRegistry('modules.Image.Load', catalog.nodesRegistry, { x: 0, y: 100 })!;
    graph.nodes.push(source);
    prepareWorkflowForManualInsertion();
    useFlowStore.getState().replaceGraph(graph);
    return { source: source.id, target: graph.nodes.find((node) => node.data.action === 'Denoise')!.id };
  });
  await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
  const source = page.locator(
    `.react-flow__node[data-id="${ids.source}"] .react-flow__handle.source[data-handleid="image"]`,
  );
  const target = page.locator(`.react-flow__node[data-id="${ids.target}"] header`).first();
  const a = (await source.boundingBox())!,
    b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: 'Attach media input', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Attach media input', exact: true })).toBeVisible();
  await dialog.getByLabel('Media input role', { exact: true }).click();
  await page.getByRole('option', { name: 'image to image · image', exact: true }).click();
  await dialog.getByRole('button', { name: 'Attach input', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const result = await page.evaluate(async (sourceId) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const graph = useFlowStore.getState().toObject();
    return {
      loads: graph.nodes.filter((node) => node.data.module === 'modules.Image' && node.data.action === 'Load').length,
      connected: graph.edges.some((edge) => edge.source === sourceId && edge.sourceHandle === 'image'),
    };
  }, ids.source);
  expect(result).toEqual({ loads: 1, connected: true });
});
