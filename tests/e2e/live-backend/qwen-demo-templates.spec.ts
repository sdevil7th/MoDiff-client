import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { output, ready, inspect } from './qwenDemoGestures';

for (const templateId of ['qwen_product_mockup', 'qwen_product_relight']) {
  test(`Qwen demo regression: ${templateId} materializes and Expert preserves its graph`, async ({ page }) => {
    test.skip(!output || process.env.MODIFF_CHECK_QWEN_TEMPLATES !== '1', 'Opt in to native template regression.');
    test.setTimeout(6 * 60_000);
    page.setDefaultTimeout(30_000);
    const submissions: string[] = [];
    const actions: unknown[] = [];
    const signals: unknown[] = [];
    page.on('websocket', (socket) => {
      socket.on('framereceived', (frame) => {
        try {
          const message = JSON.parse(String(frame.payload));
          if (['get_signal_value', 'node_definition'].includes(message.type))
            signals.push({ at: Date.now(), received: message });
        } catch {
          /* Ignore non-JSON transport frames. */
        }
      });
      socket.on('framesent', (frame) => {
        try {
          const message = JSON.parse(String(frame.payload));
          if (message.type === 'signal_value') signals.push({ at: Date.now(), sent: message });
        } catch {
          /* Ignore non-JSON transport frames. */
        }
      });
    });

    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/fields/action') actions.push(request.postDataJSON());
    });
    page.on('console', (message) => {
      if (message.type() === 'error') console.log('BROWSER', message.text());
    });
    page.on('pageerror', (error) => console.log('PAGE ERROR', error.message));
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/graph') submissions.push(request.url());
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await ready(page);
    const advanced = page.getByRole('button', { name: /Advanced workflow/u });
    if (await advanced.isVisible().catch(() => false)) await advanced.click();
    await page.getByTestId('topbar-templates').click();
    await page
      .getByTestId('template-browser-search')
      .fill(templateId === 'qwen_product_mockup' ? 'Product Mockup' : 'Product Relighting');
    const useTemplate = page.getByTestId(`template-browser-create-card-${templateId}`);
    await expect(useTemplate).toBeVisible({ timeout: 90_000 });
    await useTemplate.click();
    const state = () =>
      page.evaluate(() => {
        const { studio, settings } = window.__MODIFF_E2E__!.getState();
        const { graphBinding, graphFinalization, canvasTransition, activeTemplateId, lastError } = studio;
        return { studio: { graphBinding, graphFinalization, canvasTransition, activeTemplateId, lastError }, settings };
      }) as Promise<{
        studio: {
          graphBinding: unknown;
          graphFinalization: { status: string } | null;
          canvasTransition: unknown;
          activeTemplateId: string;
          lastError: unknown;
        };
        settings: { studioViewMode: string };
      }>;
    try {
      await expect(page.getByTestId('template-browser-dialog')).toHaveCount(0, { timeout: 120_000 });
      console.log('TEMPLATE NOTICES', await page.locator('[role=alert], [role=status]').allTextContents());
      await expect.poll(async () => (await state()).studio.graphBinding, { timeout: 120_000 }).toBeTruthy();
      await expect.poll(async () => (await state()).studio.graphFinalization?.status).toBe('complete');
    } finally {
      await writeFile(`${output}/${templateId}-signals.json`, JSON.stringify(signals, null, 2));
      await writeFile(`${output}/${templateId}-field-actions.json`, JSON.stringify(actions, null, 2));
      await writeFile(`${output}/${templateId}-template-state.json`, JSON.stringify(await state(), null, 2));
      const graph = await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
      await writeFile(`${output}/${templateId}-template-graph.json`, JSON.stringify(graph, null, 2));
      await page.screenshot({ path: `${output}/${templateId}-template.png` });
    }
    expect((await state()).studio.activeTemplateId).toBe(templateId);
    const before = await inspect(page);
    expect(before.nodes.length).toBeGreaterThan(3);
    if (templateId === 'qwen_product_relight') {
      const lora = before.nodes.find((node) => node.data.action === 'Lora');
      expect(lora, 'The template must include its declared Lightning adapter').toBeTruthy();
      expect(before.edges.some((edge) => edge.source === lora!.id)).toBe(true);
    }
    const auto = page.getByTestId('topbar-auto-switch');
    if ((await auto.getAttribute('aria-checked')) === 'true') await auto.click();
    await expect(auto).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => (await state()).studio.graphFinalization?.status).toBe('complete');
    const after = await inspect(page);
    await writeFile(
      `${output}/${templateId}-expert-proof.json`,
      JSON.stringify({ before, after, submissions }, null, 2),
    );
    expect(after.nodes.map((node) => node.id)).toEqual(before.nodes.map((node) => node.id));
    expect(after.edges).toEqual(before.edges);
    // Compare authored values, not async field-display metadata. When quantization
    // is disabled, the component picker default is inactive in both modes.
    const values = (graph: typeof before) =>
      graph.nodes.map((node) => ({
        id: node.id,
        module: node.data.module,
        action: node.data.action,
        values: Object.fromEntries(
          Object.entries(node.data.params)
            .filter(
              ([key]) =>
                !(
                  key === 'components' &&
                  node.data.action === 'PipelineQuantizationConfigV2' &&
                  node.data.params.backend?.value === 'none'
                ),
            )
            .map(([key, field]) => [key, field.value]),
        ),
      }));
    expect(values(after)).toEqual(values(before));
    expect(submissions).toEqual([]);
  });
}
