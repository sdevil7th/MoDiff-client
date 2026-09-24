import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('first-party ModularPrompt reload invalidates stale service code and preserves the saved graph', async ({
  page,
}) => {
  test.skip(process.env.MODIFF_RUN_MODULAR_PROMPT !== '1', 'Explicit first-party custom-code approval required.');
  test.setTimeout(6 * 60_000);
  page.setDefaultTimeout(20_000);
  const backend = resolve(process.env.MODIFF_BACKEND_DIR || '../MoDiff');
  const name = `PrototypingModularPrompt${Date.now()}`;
  const output = resolve(process.env.MODIFF_REVIEW_OUTPUT_DIR || 'artifacts/custom-prototyping', name);
  await mkdir(output, { recursive: true });
  const source = await readFile(resolve(backend, 'examples/custom_nodes/ModularPrompt/block.py'), 'utf8');
  expect(source).toContain('state.get("text") + " — modular"');
  const receipts: unknown[] = [];
  let staged = false;
  try {
    await expect
      .poll(async () => (await page.request.get('/health', { timeout: 5000 }).catch(() => null))?.ok() ?? false, {
        timeout: 90_000,
      })
      .toBe(true);
    const queue = await (await page.request.get('/queue')).json();
    expect(queue.current).toBeFalsy();
    expect(Object.keys(queue.queued || {})).toHaveLength(0);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated));
    await expect(page.getByTestId('startup-workspace-gate')).toBeHidden({ timeout: 90_000 });
    const launcher = page.getByTestId('task-launcher');
    await expect(launcher).toBeVisible();
    await launcher.getByRole('button', { name: 'Empty workflow', exact: true }).click();
    await page.getByRole('radio', { name: 'Developer', exact: true }).check();
    await page.getByTestId('left-tab-nodes').click();
    await page.getByRole('button', { name: 'Custom nodes', exact: true }).click();
    const dialog = page.getByTestId('custom-extensions-dialog');
    await dialog.getByLabel('Extension source', { exact: true }).fill('examples/custom_nodes/ModularPrompt');
    await dialog.getByLabel('Extension module name').fill(name);
    const installed = page.waitForResponse((response) => response.url().endsWith('/custom_modules/install'));
    await dialog.getByRole('button', { name: 'Stage source', exact: true }).click();
    const installation = await (await installed).json();
    expect(installation.error).toBeFalsy();
    staged = true;
    receipts.push({ operation: 'stage', response: installation });
    const review = dialog.getByRole('region', { name: 'Extension review' });
    await expect(review).toContainText('Modular Prompt');
    await review.getByRole('checkbox').check();
    const enabled = page.waitForResponse((response) => response.url().endsWith(`/custom_modules/${name}/enable`));
    await review.getByRole('button', { name: 'Enable code', exact: true }).click();
    const activation = await (await enabled).json();
    receipts.push({ operation: 'enable', response: activation });
    expect(activation.modules.find((item: { name: string }) => item.name === name).enabled).toBe(true);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Search nodes', { exact: true }).fill(`custom.${name}.Block`);
    await page.getByTestId(`node-row-custom-${name}-Block`).click();
    const ids = await page.evaluate(async (name) => {
      const [{ useFlowStore }, { useStudioStore }, { useNodesStore }, { createNodeFromRegistry }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useStudioStore.ts'),
        import('/src/stores/useNodeStore.ts'),
        import('/src/workflow/nodeFactory.ts'),
      ]);
      const flow = useFlowStore.getState();
      const custom = flow.nodes.find((node) => node.data.module === `custom.${name}`)!;
      const viewer = createNodeFromRegistry('modules.Primitive.DataViewer', useNodesStore.getState().nodesRegistry, {
        x: 600,
        y: 0,
      })!;
      if (!custom?.data.params.text || !custom.data.params.out_result || !viewer?.data.params.value)
        throw new Error('Expected the exact reviewed custom-block text boundary.');
      custom.data.params.text.value = 'a blue house';
      useStudioStore.getState().updateForm({ resourceMode: 'expert' });
      flow.replaceGraph({
        nodes: [custom, viewer],
        edges: [
          {
            id: `${name}-text`,
            source: custom.id,
            sourceHandle: 'out_result',
            target: viewer.id,
            targetHandle: 'value',
          },
        ],
      });
      return { custom: custom.id, viewer: viewer.id };
    }, name);
    const settle = async (taskId: string, expected: string) => {
      await expect
        .poll(
          async () => {
            const state = await (await page.request.get('/queue')).json();
            const task = [state.current, ...Object.values(state.queued || {}), ...(state.recent || [])].find(
              (item) => item?.task_id === taskId,
            );
            if (task && ['failed', 'error', 'cancelled'].includes(task.status))
              throw new Error(task.error || task.message);
            return task?.status;
          },
          { timeout: 60_000 },
        )
        .toBe('completed');
      const result = await page.request.get(`/cache/${ids.viewer}/output`);
      expect(result.ok()).toBe(true);
      expect(await result.text()).toBe(expected);
      receipts.push({ operation: 'result', taskId, expected });
    };
    const run = async (expected: string) => {
      const submitted = page.waitForResponse(
        (reply) => reply.url().endsWith('/graph') && reply.request().method() === 'POST',
        { timeout: 45_000 },
      );
      await expect(page.getByTestId('studio-run')).toBeEnabled();
      await page.getByTestId('studio-run').click();
      const response = await submitted;
      const graph = response.request().postDataJSON();
      const submission = await response.json();
      expect(submission.task_id, JSON.stringify(submission)).toBeTruthy();
      await settle(submission.task_id, expected);
      return graph;
    };
    let graph = await run('a blue house — modular');
    const before = await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
    await writeFile(resolve(output, 'before.workflow.json'), JSON.stringify(before, null, 2));
    const build = async () => {
      const response = await page.request.post('/service_package', {
        data: {
          operation: 'build',
          graph,
          interface: { inputs: {}, outputs: { text: [{ nodeId: ids.viewer, field: 'preview' }] } },
        },
      });
      const result = await response.json();
      expect(response.ok(), JSON.stringify(result)).toBe(true);
      return result.package;
    };
    const originalPackage = await build();
    await writeFile(resolve(output, 'before.service.json'), JSON.stringify(originalPackage, null, 2));
    const installedPath = resolve(backend, 'custom', name, 'block.py');
    expect(await readFile(installedPath, 'utf8')).toBe(source);
    await writeFile(installedPath, source.replace(' + " — modular"', ' + " — reviewed modular"'));
    await page.getByRole('button', { name: 'Custom nodes', exact: true }).click();
    const card = dialog.getByText(name, { exact: true }).locator('..').locator('..');
    await card.getByRole('button', { name: 'Review reload', exact: true }).click();
    await expect(review.getByRole('checkbox')).not.toBeChecked();
    await review.getByRole('checkbox').check();
    const reloaded = page.waitForResponse((response) => response.url().endsWith(`/custom_modules/${name}/enable`));
    await review.getByRole('button', { name: 'Enable and reload code', exact: true }).click();
    receipts.push({ operation: 'reload', response: await (await reloaded).json() });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    graph = await run('a blue house — reviewed modular');
    const stale = await page.request.post('/service_package', {
      data: { operation: 'prepare', package: originalPackage, values: {}, sid: 'modularPromptService' },
    });
    expect(stale.ok()).toBe(false);
    const staleBody = await stale.json();
    expect(staleBody.message).toContain('Service requirements changed');
    receipts.push({ operation: 'reject stale code package', status: stale.status(), response: staleBody });
    const updatedPackage = await build();
    await writeFile(resolve(output, 'after.service.json'), JSON.stringify(updatedPackage, null, 2));
    const prepared = await page.request.post('/service_package', {
      data: { operation: 'prepare', package: updatedPackage, values: {}, sid: 'modularPromptService' },
    });
    const preparedBody = await prepared.json();
    expect(prepared.ok(), JSON.stringify(preparedBody)).toBe(true);
    const submitted = await (await page.request.post('/graph', { data: preparedBody.graph })).json();
    expect(submitted.task_id, JSON.stringify(submitted)).toBeTruthy();
    await settle(submitted.task_id, 'a blue house — reviewed modular');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated));
    const restored = await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
    expect(restored.edges).toEqual(before.edges);
    expect(restored.nodes.map((node) => node.id)).toEqual(before.nodes.map((node) => node.id));
    await run('a blue house — reviewed modular');
    await page.screenshot({ path: resolve(output, 'restored.png') });
  } finally {
    if (staged) {
      const disabled = await page.request.post(`/custom_modules/${name}/disable`, { data: {}, timeout: 15_000 });
      receipts.push({ operation: 'disable own copy', status: disabled.status() });
    }
    await writeFile(resolve(output, 'receipt.json'), JSON.stringify({ name, receipts }, null, 2));
  }
});
