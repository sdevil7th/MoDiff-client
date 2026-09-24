import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { decodedImageStatistics } from './imageProofStatistics';

test('first-party custom image block borrows the connected VAE and preserves its saved image graph', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_CUSTOM_RECONSTRUCTION !== '1',
    'Explicit first-party custom-code approval required.',
  );
  test.setTimeout(10 * 60_000);
  page.setDefaultTimeout(20_000);
  const sourceFile = process.env.MODIFF_RECONSTRUCTION_SOURCE;
  if (!sourceFile) throw new Error('Supply an explicit owned image fixture.');
  const name = `PrototypingReconstruction${Date.now()}`;
  const output = resolve(process.env.MODIFF_REVIEW_OUTPUT_DIR || 'artifacts/custom-prototyping', name);
  await mkdir(output, { recursive: true });
  const receipts: unknown[] = [];
  let staged = false;
  try {
    const queue = await (await page.request.get('/queue')).json();
    expect(queue.current).toBeFalsy();
    expect(Object.keys(queue.queued || {})).toHaveLength(0);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated));
    await page.getByTestId('task-launcher').getByRole('button', { name: 'Empty workflow', exact: true }).click();
    await page.getByRole('radio', { name: 'Developer', exact: true }).check();
    await page.getByTestId('left-tab-nodes').click();
    await page.getByRole('button', { name: 'Custom nodes', exact: true }).click();
    const dialog = page.getByTestId('custom-extensions-dialog');
    await dialog
      .getByLabel('Extension source', { exact: true })
      .fill('examples/custom_nodes/ModularImageReconstruction');
    await dialog.getByLabel('Extension module name').fill(name);
    const installed = page.waitForResponse((response) => response.url().endsWith('/custom_modules/install'));
    await dialog.getByRole('button', { name: 'Stage source', exact: true }).click();
    const installation = await (await installed).json();
    expect(installation.error).toBeFalsy();
    staged = true;
    receipts.push({ operation: 'stage', response: installation });
    const review = dialog.getByRole('region', { name: 'Extension review' });
    await expect(review).toContainText('VAE Image Reconstruction');
    await review.getByRole('checkbox').check();
    const enabled = page.waitForResponse((response) => response.url().endsWith(`/custom_modules/${name}/enable`));
    await review.getByRole('button', { name: 'Enable code', exact: true }).click();
    const activation = await (await enabled).json();
    receipts.push({ operation: 'enable', response: activation });
    expect(activation.modules.find((item: { name: string }) => item.name === name).enabled).toBe(true);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Search nodes', { exact: true }).fill(`custom.${name}.Block`);
    await page.getByTestId(`node-row-custom-${name}-Block`).click();
    const response = await page.request.post('/operations/starter', {
      data: { pipelineClass: 'ZImageModularPipeline', task: 'text_to_image', executionProfileId: 'z-image:modular' },
      timeout: 60_000,
    });
    expect(response.ok()).toBe(true);
    const starter = await response.json();
    const ids = await page.evaluate(
      async ({ name, starter, sourceFile }) => {
        const [
          { useFlowStore },
          { useStudioStore },
          { useNodesStore },
          { createNodeFromRegistry },
          { createOperationStarter },
        ] = await Promise.all([
          import('/src/stores/useFlowStore.ts'),
          import('/src/stores/useStudioStore.ts'),
          import('/src/stores/useNodeStore.ts'),
          import('/src/workflow/nodeFactory.ts'),
          import('/src/workflow/operationAuthoring.ts'),
        ]);
        const flow = useFlowStore.getState();
        const custom = flow.nodes.find((node) => node.data.module === `custom.${name}`)!;
        const loader = createOperationStarter(starter, { x: 0, y: 0 }).nodes.find(
          (node) => node.data.action === 'ModelsLoader',
        )!;
        const registry = useNodesStore.getState().nodesRegistry;
        const image = createNodeFromRegistry('modules.Image.Load', registry, { x: 0, y: 350 })!;
        const preview = createNodeFromRegistry('modules.Image.Preview', registry, { x: 900, y: 0 })!;
        if (
          !custom?.data.params.pipeline_components ||
          !loader.data.params.pipeline_components ||
          !image?.data.params.file
        )
          throw new Error('Expected reviewed connected-component and image contracts.');
        image.data.params.file.value = sourceFile;
        custom.position = { x: 450, y: 0 };
        custom.data.params.amount.value = 0;
        useStudioStore.getState().updateForm({ resourceMode: 'expert' });
        flow.replaceGraph({
          nodes: [loader, image, custom, preview],
          edges: [
            {
              id: `${name}-vae`,
              source: loader.id,
              sourceHandle: 'pipeline_components',
              target: custom.id,
              targetHandle: 'pipeline_components',
            },
            { id: `${name}-image`, source: image.id, sourceHandle: 'image', target: custom.id, targetHandle: 'image' },
            {
              id: `${name}-preview`,
              source: custom.id,
              sourceHandle: 'out_images',
              target: preview.id,
              targetHandle: 'image',
            },
          ],
        });
        return { custom: custom.id, preview: preview.id, loader: loader.id };
      },
      { name, starter, sourceFile },
    );
    const hashes: string[] = [];
    for (const [index, amount] of [0, 1, 1].entries()) {
      if (index === 2) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated));
      }
      await page.evaluate(
        async ({ id, amount }) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          useFlowStore.getState().setParamWithHistory(id, 'amount', amount);
        },
        { id: ids.custom, amount },
      );
      const graph = await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
      expect(graph.nodes.some((node) => node.id === ids.loader)).toBe(true);
      expect(graph.edges).toHaveLength(3);
      await writeFile(resolve(output, `${index}.workflow.json`), JSON.stringify(graph, null, 2));
      const submitted = page.waitForResponse(
        (reply) => reply.url().endsWith('/graph') && reply.request().method() === 'POST',
        { timeout: 45_000 },
      );
      await expect(page.getByTestId('studio-run')).toBeEnabled();
      await page.getByTestId('studio-run').click();
      const submission = await (await submitted).json();
      receipts.push({ operation: 'submission', amount, response: submission });
      expect(submission.task_id, JSON.stringify(submission)).toBeTruthy();
      await expect
        .poll(
          async () => {
            const state = await (await page.request.get('/queue')).json();
            const task = [state.current, ...Object.values(state.queued || {}), ...(state.recent || [])].find(
              (item) => item?.task_id === submission.task_id,
            );
            if (task && ['failed', 'error', 'cancelled'].includes(task.status))
              throw new Error(task.error || task.message);
            return task?.status;
          },
          { timeout: 5 * 60_000 },
        )
        .toBe('completed');
      const run = await (await page.request.get(`/runs/${submission.task_id}`)).json();
      await writeFile(resolve(output, `${index}.run.json`), JSON.stringify(run, null, 2));
      const result = await page.request.get(`/cache/${ids.preview}/output/0?format=PNG`);
      expect(result.ok()).toBe(true);
      const bytes = await result.body();
      const image = await decodedImageStatistics(page, bytes);
      expect(image.width).toBe(512);
      expect(image.height).toBe(512);
      expect(image.standardDeviation).toBeGreaterThan(5);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      hashes.push(sha256);
      receipts.push({ operation: 'image', amount, sha256, image });
      await writeFile(resolve(output, `${index}.png`), bytes);
    }
    expect(hashes[1]).not.toBe(hashes[0]);
    expect(hashes[2]).toBe(hashes[1]);
    await page.screenshot({ path: resolve(output, 'restored.png') });
  } finally {
    if (staged) {
      const disabled = await page.request.post(`/custom_modules/${name}/disable`, { data: {}, timeout: 15_000 });
      receipts.push({ operation: 'disable own copy', status: disabled.status() });
    }
    await writeFile(resolve(output, 'receipt.json'), JSON.stringify({ name, receipts }, null, 2));
  }
});
