import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { backend, output } from './qwenDemoGestures';

const demos = [
  {
    name: 'Qwen Demo 01 — Product photo',
    workflowId: 'xRIQ_kwN-M2FkKy4m8XWs',
    rootId: '98f06ef7-cddd-4411-a64d-8e51d69e017c',
  },
  {
    name: 'Qwen Demo 02 — Edit with outside LoRA',
    workflowId: 'iWBGHxgwHMQptT7b1FCqG',
    rootId: '07173354-cc7a-4538-a143-d6321dbb5b09',
  },
  {
    name: 'Qwen Demo 03 — Run only this Block',
    workflowId: 'TWAGcWNaBM6JnXEZpb22d',
    rootId: '07173354-cc7a-4538-a143-d6321dbb5b09',
  },
];

if (process.env.MODIFF_FOLLOWUP_DEMO_WORKFLOW_ID) {
  demos.push({
    name: 'Qwen Demo 05 — Block controls and resources',
    workflowId: process.env.MODIFF_FOLLOWUP_DEMO_WORKFLOW_ID,
    rootId: '07173354-cc7a-4538-a143-d6321dbb5b09',
  });
}

if (process.env.MODIFF_AUTO_DEMO_WORKFLOW_ID) {
  demos.push({
    name: 'Qwen Demo 06 — Custom Blocks in Auto',
    workflowId: process.env.MODIFF_AUTO_DEMO_WORKFLOW_ID,
    rootId: '07173354-cc7a-4538-a143-d6321dbb5b09',
  });
}

if (process.env.MODIFF_LIFECYCLE_DEMO_WORKFLOW_ID) {
  demos.push({
    name: 'Qwen Demo 07 — Auto model handoff',
    workflowId: process.env.MODIFF_LIFECYCLE_DEMO_WORKFLOW_ID,
    rootId: '07173354-cc7a-4538-a143-d6321dbb5b09',
  });
}

for (const demo of demos) {
  test(`installed Qwen demo reopens exact saved media without inference: ${demo.name}`, async ({ page }) => {
    test.skip(
      !output || process.env.MODIFF_VERIFY_QWEN_PRODUCTION !== '1',
      'Opt in to the installed saved-demo check.',
    );
    test.setTimeout(4 * 60_000);
    const receipt = JSON.parse(await readFile(`${output}/${demo.name}-receipt.json`, 'utf8'));
    const taskId = receipt.outputs[0].taskId;
    const run = await (await page.request.get(`${backend}/runs/${taskId}`)).json();
    const images = run.outputs.filter(
      (item: { taskId: string; displayType: string }) => item.taskId === taskId && item.displayType === 'image',
    );
    const media =
      images.find((item: { nodeId?: string }) =>
        item.nodeId?.startsWith(`block-v2-node:${demo.rootId.length}:${demo.rootId}:`),
      ) ?? (images.length === 1 ? images[0] : undefined);
    expect(media).toBeTruthy();
    const mediaUrl = new URL(media.url, backend);
    const assetPath = mediaUrl.pathname + mediaUrl.search;
    const downloaded = await page.request.get(mediaUrl.href);
    expect(downloaded.ok()).toBe(true);
    const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const assetHash = sha256(await downloaded.body());
    expect(assetHash).toBe(sha256(await readFile(`${output}/${demo.name}.webp`)));
    const submissions: string[] = [];
    const pageErrors: string[] = [];
    const failedChunks: string[] = [];
    const cachedChunks: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/graph' && request.method() === 'POST') submissions.push(request.url());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (!/\/assets\/.*\.js$/u.test(new URL(response.url()).pathname)) return;
      // A reload can legitimately revalidate a cached module with HTTP 304.
      if (response.status() === 304) cachedChunks.push(response.url());
      else if (response.status() >= 400) failedChunks.push(response.url());
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(backend, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('left-tab-workflows')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
    const advanced = page.getByRole('button', { name: /Advanced workflow/u });
    if (await advanced.isVisible().catch(() => false)) await advanced.click();
    await page.getByTestId('left-tab-workflows').click();
    await page.getByLabel('Search workflows').fill('Qwen Demo 0');
    await page.getByTestId(`saved-workflow-${demo.workflowId}`).getByRole('button').first().click();
    const root = page.getByTestId(`user-block-${demo.rootId}`);
    await expect(root).toBeVisible();
    await page.getByTestId('arrange-graph').click();
    const preview = root.locator('[data-testid^="block-v2-preview-"] img').first();
    const exactPreview = async () =>
      preview.evaluate((element, expected) => {
        const image = element as HTMLImageElement;
        const url = new URL(image.src);
        return {
          matches: url.pathname + url.search === expected,
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
      }, assetPath);
    await expect.poll(async () => (await exactPreview()).matches).toBe(true);
    await expect.poll(async () => (await exactPreview()).width).toBeGreaterThanOrEqual(1024);
    await preview.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/${demo.name}-installed-preview.png` });
    await page.getByTestId('topbar-save-workflow').click();
    await page.getByTestId('topbar-export').click();
    const packageDownload = page.waitForEvent('download');
    await page.getByTestId('topbar-export-workflow-package').click();
    await (await packageDownload).saveAs(`${output}/${demo.name}-modiff-workflow-package.json`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(root).toBeVisible({ timeout: 120_000 });
    await expect.poll(async () => (await exactPreview()).matches).toBe(true);
    await expect.poll(async () => (await exactPreview()).width).toBeGreaterThanOrEqual(1024);
    await page.getByTestId('topbar-gallery').click();
    const gallery = page.getByTestId('gallery-panel');
    await expect(gallery).toBeVisible();
    // History hydration is independent of canvas preview restoration. Wait for
    // its observable completion before checking a saved gallery item.
    const historyStartedAt = Date.now();
    await expect(gallery.getByTestId('gallery-backend-status')).toHaveText('Backend history', { timeout: 120_000 });
    const historyWaitMs = Date.now() - historyStartedAt;
    await expect
      .poll(() =>
        gallery.locator('img').evaluateAll(
          (images, expected) =>
            images.some((element) => {
              const image = element as HTMLImageElement;
              const url = new URL(image.src);
              return url.pathname + url.search === expected && image.naturalWidth >= 1024;
            }),
          assetPath,
        ),
      )
      .toBe(true);
    await page.screenshot({ path: `${output}/${demo.name}-installed-gallery.png` });
    const health = await (await page.request.get(`${backend}/health`)).json();
    await writeFile(
      `${output}/${demo.name}-installed-proof.json`,
      JSON.stringify(
        {
          ...demo,
          taskId,
          assetPath,
          assetHash,
          health,
          submissions,
          pageErrors,
          failedChunks,
          cachedChunks,
          historyWaitMs,
          preview: await exactPreview(),
        },
        null,
        2,
      ),
    );
    expect(submissions).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedChunks).toEqual([]);
  });
}

test('installed Qwen authoring opens both Block editors in the right panel', async ({ page }) => {
  test.skip(!output || process.env.MODIFF_VERIFY_QWEN_PRODUCTION !== '1', 'Opt in to the installed saved-demo check.');
  test.setTimeout(3 * 60_000);
  const rootId = '07173354-cc7a-4538-a143-d6321dbb5b09';
  const submissions: string[] = [];
  const pageErrors: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/graph' && request.method() === 'POST') submissions.push(request.url());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(backend, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('left-tab-workflows')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await page.getByTestId('left-tab-workflows').click();
  await page.getByLabel('Search workflows').fill('Qwen Demo 0');
  await page.getByTestId('saved-workflow-2bJilBusariAZQ3_6LYO7').getByRole('button').first().click();
  const root = page.getByTestId(`user-block-${rootId}`);
  await expect(root).toBeVisible();
  await page.getByTestId('arrange-graph').click();
  await root.getByTestId(`user-block-save-choices-${rootId}`).click();
  const save = page.getByTestId(`save-user-block-choices-${rootId}`);
  await expect(save).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Save block changes' })).toHaveCount(0);
  await expect(save.getByRole('textbox')).not.toHaveValue('');
  const suggestedName = await save.getByRole('textbox').inputValue();
  const saveBounds = await save.boundingBox();
  expect(saveBounds!.x).toBeGreaterThan(960);
  await save.getByRole('textbox').fill('Demo name — cancel rehearsal');
  await page.screenshot({ path: `${output}/Qwen-authoring-installed-save-panel.png` });
  await save.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(save).toHaveCount(0);
  await root.getByTestId(`user-block-configure-${rootId}`).click();
  const configure = page.getByTestId(`configure-block-v2-${rootId}`);
  await expect(configure).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Configure Block interface' })).toHaveCount(0);
  const interfaceBounds = await configure.boundingBox();
  expect(interfaceBounds!.x).toBeGreaterThan(960);
  await page.screenshot({ path: `${output}/Qwen-authoring-installed-interface-panel.png` });
  await configure.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByTestId('topbar-export').click();
  const packageDownload = page.waitForEvent('download');
  await page.getByTestId('topbar-export-workflow-package').click();
  await (
    await packageDownload
  ).saveAs(`${output}/Qwen Demo 04 — Reusable Block authoring-modiff-workflow-package.json`);
  await writeFile(
    `${output}/Qwen-authoring-installed-proof.json`,
    JSON.stringify(
      {
        suggestedName,
        saveBounds,
        interfaceBounds,
        submissions,
        pageErrors,
      },
      null,
      2,
    ),
  );
  expect(submissions).toEqual([]);
  expect(pageErrors).toEqual([]);
});
