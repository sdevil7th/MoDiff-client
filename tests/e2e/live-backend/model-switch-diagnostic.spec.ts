import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('diagnose one saved custom-connected model transition without rerunning inference', async ({ page }) => {
  test.skip(process.env.MODIFF_RUN_SWITCH_DIAGNOSTIC !== '1', 'Explicit private reproduction only.');
  test.setTimeout(180_000);
  page.setDefaultTimeout(30_000);
  const output = resolve(process.env.MODIFF_REVIEW_OUTPUT_DIR!);
  await mkdir(output, { recursive: true });
  const name = process.env.MODIFF_REPRO_MODULE!;
  if (!/^PrototypingPrompt\d+$/.test(name)) throw new Error('Expected an owned first-party test copy.');
  const backend = resolve(process.env.MODIFF_BACKEND_DIR || '../MoDiff');
  const example = await readFile(resolve(backend, 'examples/custom_nodes/PromptTools/main.py'), 'utf8');
  expect(await readFile(resolve(backend, 'custom', name, 'main.py'), 'utf8')).toBe(
    example.replace('f"{prefix} {prompt}"', 'f"RELOADED {prefix} {prompt}"'),
  );
  const inspected = await (await page.request.post(`/custom_modules/${name}/inspect`, { data: {} })).json();
  const enabled = await page.request.post(`/custom_modules/${name}/enable`, {
    data: { codeHash: inspected.module.codeHash, consent: true },
  });
  expect(enabled.ok()).toBe(true);
  const diagnostics: unknown[] = [];
  page.on('console', (message) => {
    if (diagnostics.length < 100 && ['error', 'warning'].includes(message.type()))
      diagnostics.push({ type: message.type(), text: message.text().slice(0, 2000) });
  });
  page.on('pageerror', (error) => diagnostics.push({ type: 'pageerror', text: String(error) }));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Debugger.enable');
  cdp.on('Debugger.paused', async (event) => {
    await writeFile(resolve(output, 'paused-stack.json'), JSON.stringify(event, null, 2));
    await cdp.send('Debugger.resume').catch(() => {});
  });
  let profiling = false;
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated));
    await page.getByTestId('task-launcher').getByRole('button', { name: 'Empty workflow', exact: true }).click();
    await page.getByRole('radio', { name: 'Developer', exact: true }).check();
    const graph = JSON.parse(await readFile(process.env.MODIFF_REPRO_GRAPH!, 'utf8'));
    await page.evaluate(async (graph) => {
      const [{ useFlowStore }, { useStudioStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useStudioStore.ts'),
      ]);
      useStudioStore.getState().updateForm({ resourceMode: 'expert' });
      useFlowStore.getState().replaceGraph(graph);
    }, graph);
    await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
    const settle = async () => {
      let prior = '';
      let stable = 0;
      await expect
        .poll(
          async () => {
            const value = await page.evaluate(() => JSON.stringify(window.__MODIFF_E2E__!.exportWorkflowGraph()));
            stable = value === prior ? stable + 1 : 0;
            prior = value;
            return stable;
          },
          { timeout: 15_000, intervals: [100, 250, 500] },
        )
        .toBeGreaterThanOrEqual(3);
    };
    await settle();
    const owner = graph.nodes.find((node: { data: { action: string } }) => node.data.action === 'ModelsLoader').id;
    await page
      .locator(`.react-flow__node[data-id="${owner}"]`)
      .getByRole('button', { name: 'Choose model', exact: true })
      .click();
    const picker = page.getByRole('dialog', { name: 'Choose model for Load Models', exact: true });
    await picker.getByRole('searchbox', { name: 'Search compatible models' }).fill('black-forest-labs/FLUX.1-schnell');
    await settle();
    await writeFile(
      resolve(output, 'before-selection.workflow.json'),
      JSON.stringify(await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph()), null, 2),
    );
    await picker.getByRole('button').filter({ hasText: 'black-forest-labs/FLUX.1-schnell' }).click();
    await expect(picker.getByTestId('model-selection-review')).toBeVisible();
    await writeFile(
      resolve(output, 'before-apply.workflow.json'),
      JSON.stringify(await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph()), null, 2),
    );
    await writeFile(
      resolve(output, 'registry-sizes.json'),
      JSON.stringify(
        await page.evaluate(async () => {
          const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
          return Object.entries(useNodesStore.getState().nodesRegistry)
            .map(([key, data]) => ({
              key,
              inputs: Object.values(data.params).filter((p) => p.display === 'input' || p.isInput).length,
              outputs: Object.values(data.params).filter((p) => p.display === 'output').length,
            }))
            .sort((a, b) => b.inputs * b.outputs - a.inputs * a.outputs)
            .slice(0, 20);
        }),
        null,
        2,
      ),
    );
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
    profiling = true;
    const started = Date.now();
    pauseTimer = setTimeout(() => {
      void cdp.send('Debugger.pause').catch(() => {});
    }, 10_000);
    await picker.getByRole('button', { name: 'Apply model change', exact: true }).click({ timeout: 45_000 });
    diagnostics.push({ type: 'apply elapsed', ms: Date.now() - started });
    await expect(picker).toHaveCount(0);
    await writeFile(
      resolve(output, 'after.workflow.json'),
      JSON.stringify(await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph()), null, 2),
    );
    await page.screenshot({ path: resolve(output, 'after.png') });
    await writeFile(
      resolve(output, 'after-fix-plan.json'),
      JSON.stringify(
        await page.evaluate(async () => {
          const [{ useFlowStore }, { useNodesStore }, { buildGraphFixPlan }] = await Promise.all([
            import('/src/stores/useFlowStore.ts'),
            import('/src/stores/useNodeStore.ts'),
            import('/src/studio/graphFixer.ts'),
          ]);
          return buildGraphFixPlan({
            ...useFlowStore.getState().toObject(),
            registry: useNodesStore.getState().nodesRegistry,
          });
        }),
        null,
        2,
      ),
    );
  } finally {
    clearTimeout(pauseTimer);
    const finalGraph = await Promise.race([
      page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph()).catch((error) => ({ error: String(error) })),
      new Promise((done) => setTimeout(() => done({ error: 'Graph read timed out.' }), 5000)),
    ]);
    await writeFile(resolve(output, 'final.workflow.json'), JSON.stringify(finalGraph, null, 2));
    if (profiling) {
      const profile = await Promise.race([
        cdp.send('Profiler.stop').catch((error) => ({ error: String(error) })),
        new Promise((done) => setTimeout(() => done({ error: 'Profiler stop timed out.' }), 5000)),
      ]);
      await writeFile(resolve(output, 'cpu-profile.json'), JSON.stringify(profile));
    }
    await page.request.post(`/custom_modules/${name}/disable`, { data: {}, timeout: 15_000 });
    await writeFile(resolve(output, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
  }
});
