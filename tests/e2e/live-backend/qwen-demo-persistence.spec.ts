import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { backend, output, ready, inspect, save } from './qwenDemoGestures';

for (const name of ['Qwen Demo 01 — Product photo', 'Qwen Demo 02 — Edit with outside LoRA']) {
  test(`retain ${name} by name with decoded previews and Gallery media`, async ({ page }) => {
    test.skip(!output || process.env.MODIFF_RETAIN_QWEN_DEMO !== '1', 'Opt in to organizing the completed demo.');
    test.setTimeout(240_000);
    const receipt = JSON.parse(await readFile(`${output}/${name}-receipt.json`, 'utf8'));
    const workflowId = name.startsWith('Qwen Demo 01') ? 'xRIQ_kwN-M2FkKy4m8XWs' : receipt.workflow_id;
    const taskId = receipt.outputs[0].taskId;
    const graph = JSON.parse(await readFile(`${output}/${name}-reopened.json`, 'utf8'));
    const rootId = graph.nodes.find((node: { data: { blockInstanceV2?: unknown } }) => node.data.blockInstanceV2).id;
    const submissions: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/graph' && request.method() === 'POST') submissions.push(request.url());
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await ready(page);
    const advanced = page.getByRole('button', { name: /Advanced workflow/u });
    if (await advanced.isVisible().catch(() => false)) await advanced.click();
    await page.getByTestId('left-tab-workflows').click();
    await page.getByLabel('Search workflows').fill('Qwen Demo');
    await expect(page.getByTestId('my-workflows').locator('[data-testid^="saved-workflow-"]')).not.toHaveCount(0);
    const row = page.getByTestId(`saved-workflow-${workflowId}`);
    await expect(row).toBeVisible({ timeout: 120_000 });
    await row.getByRole('button').first().click();
    await expect.poll(async () => (await inspect(page)).nodes.some((node) => node.id === rootId)).toBe(true);
    await expect(page.getByTestId('topbar-save-workflow')).toHaveAttribute(
      'title',
      `Save ${name} to My workflows (Ctrl/⌘+S)`,
    );
    await page.getByTestId('arrange-graph').click();
    const root = page.getByTestId(`user-block-${rootId}`);
    const currentHeight = (await inspect(page)).nodes.find((node) => node.id === rootId)!.data.blockInstanceV2!
      .presentation.size.height;
    if (currentHeight < 850) {
      const grip = root.getByLabel('Drag to resize block', { exact: true });
      const box = await grip.boundingBox();
      expect(box).toBeTruthy();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.move(box!.x + 210, box!.y + 600, { steps: 20 });
      await page.mouse.up();
      await page.getByTestId('arrange-graph').click();
    }
    const preview = root.locator('[data-testid^="block-v2-preview-"] img').first();
    await preview.scrollIntoViewIfNeeded();
    await expect
      .poll(() => preview.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const retained = (await inspect(page)).nodes.find((node) => node.id === rootId)!.data.blockInstanceV2!
      .previewStates;
    expect(retained.some((state) => state.taskId === taskId && state.mediaReference?.startsWith('/file?'))).toBe(true);
    await save(page, name);
    await page.screenshot({ path: `${output}/${name}-visible-preview.png` });
    await page.getByTestId('topbar-export').click();
    const downloaded = page.waitForEvent('download');
    await page.getByTestId('topbar-export-workflow-package').click();
    await (await downloaded).saveAs(`${output}/${name}-modiff-workflow-package.json`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(page);
    await expect.poll(async () => (await inspect(page)).nodes.some((node) => node.id === rootId)).toBe(true);
    await preview.scrollIntoViewIfNeeded();
    await expect
      .poll(() => preview.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await page.getByTestId('topbar-gallery').click();
    await expect(page.getByTestId('gallery-panel')).toBeVisible();
    const run = await (await page.request.get(`${backend}/runs/${taskId}`)).json();
    const media = run.outputs.find(
      (item: { taskId: string; displayType: string }) => item.taskId === taskId && item.displayType === 'image',
    );
    const mediaUrl = new URL(media.url, backend);
    const assetPath = mediaUrl.pathname + mediaUrl.search;
    const galleryImage = page.getByTestId('gallery-panel').locator('img');
    await expect
      .poll(() =>
        galleryImage.evaluateAll(
          (elements, path) =>
            elements.some((element) => {
              const image = element as HTMLImageElement;
              const url = new URL(image.src);
              return url.pathname + url.search === path && image.naturalWidth > 0;
            }),
          assetPath,
        ),
      )
      .toBe(true);
    await page.screenshot({ path: `${output}/${name}-gallery.png` });
    await writeFile(
      `${output}/${name}-persistence-proof.json`,
      JSON.stringify({ workflowId, name, submissions, media, graph: await inspect(page) }, null, 2),
    );
    expect(submissions).toEqual([]);
  });
}
