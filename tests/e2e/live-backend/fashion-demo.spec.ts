import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { connect, save } from './qwenDemoGestures';
import { editorialChapter } from './fashionEditorialChapters';

const graph = (page: Page) => page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const moduleName = 'FashionEditorialRegions';
const baselinePrompt =
  'Full-length luxury fashion editorial photograph on a real SoHo New York street. One elegant adult woman aged 30 with brunette hair, wearing an impeccably tailored ivory blazer and ivory wide-leg trousers, holding a structured burgundy leather handbag, walking toward the camera. Her entire body and shoes are visible, she occupies the center third of the image, with space above her head and below her feet. Detailed ornate cast-iron buildings, large boutique windows and a flower display on the left, a yellow New York taxi on the right, distant pedestrians, cobblestone texture, intricate fire escapes. Warm late-afternoon sunlight, natural skin texture, exquisite fabric tailoring, sophisticated magazine photography, 35mm lens, deep layered street composition, realistic materials, restrained luxury. No illustration, no cartoon, no text overlay, no watermark.';

async function settle(page: Page) {
  let prior = '',
    stable = 0;
  await expect
    .poll(
      async () => {
        const next = JSON.stringify(await graph(page));
        stable = next === prior ? stable + 1 : 0;
        prior = next;
        return stable;
      },
      { timeout: 20_000, intervals: [300] },
    )
    .toBeGreaterThanOrEqual(3);
}

async function field(page: Page, id: string, key: string, value: string) {
  const item = (await graph(page)).nodes.find((item) => item.id === id)!;
  const label = String(item.data.params[key].label || key);
  const input = node(page, id).getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press('Tab');
}

async function add(page: Page, key: string) {
  const ids = new Set((await graph(page)).nodes.map((item) => item.id));
  await page.getByLabel('Search nodes', { exact: true }).fill(key);
  const row = page.getByTestId(`node-row-${key.replaceAll('.', '-')}`);
  if (!(await row.isVisible())) {
    const group = page.locator('[data-testid^="node-group-"]').filter({ has: row });
    if (await group.count()) await group.getByRole('button').first().click();
  }
  await row.click();
  await page.getByLabel('Search nodes', { exact: true }).fill('');
  await page.getByTestId('arrange-graph').click();
  await settle(page);
  return (await graph(page)).nodes.find((item) => !ids.has(item.id))!;
}

async function wire(page: Page, from: string, output: string, to: string, input: string) {
  const clear = page.getByTestId('run-session-shelf').getByRole('button', { name: 'Clear', exact: true });
  if ((await clear.isVisible()) && (await clear.isEnabled())) await clear.click();
  await page.getByTestId('arrange-graph').click();
  let prior = '',
    stable = 0;
  await expect
    .poll(
      async () => {
        const boxes = await Promise.all([
          page.getByTestId(`node-handle-${from}-${output}`).boundingBox(),
          page.getByTestId(`node-handle-${to}-${input}`).boundingBox(),
        ]);
        const next = JSON.stringify(boxes);
        stable = boxes.every(Boolean) && next === prior ? stable + 1 : 0;
        prior = next;
        return stable;
      },
      { timeout: 15_000, intervals: [300] },
    )
    .toBeGreaterThanOrEqual(3);
  await connect(
    page,
    page.getByTestId(`node-handle-${from}-${output}`),
    page.getByTestId(`node-handle-${to}-${input}`),
  );
  await expect
    .poll(async () =>
      (await graph(page)).edges.some(
        (edge) =>
          edge.source === from && edge.sourceHandle === output && edge.target === to && edge.targetHandle === input,
      ),
    )
    .toBe(true);
}

async function starter(page: Page, pipeline: string, task: string) {
  const ids = new Set((await graph(page)).nodes.map((item) => item.id));
  const panel = page.getByRole('region', { name: 'Diffusers operations' });
  await panel.getByLabel('Operation pipeline').click();
  await page.getByRole('option', { name: pipeline, exact: true }).click();
  await panel.getByLabel('Operation task').click();
  await page.getByRole('option', { name: task, exact: true }).click();
  await panel.getByRole('button', { name: 'Preview connected starter', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Connected starter', exact: true })
    .getByRole('button', { name: 'Add starter to canvas', exact: true })
    .click();
  await page.getByTestId('arrange-graph').click();
  await settle(page);
  return (await graph(page)).nodes.filter((item) => !ids.has(item.id));
}

async function configure(page: Page, ids: Set<string>, prompt: string, steps: number, guidance: number) {
  for (const item of (await graph(page)).nodes.filter((item) => ids.has(item.id))) {
    if (item.data.uiState?.disabled) continue;
    for (const [key, param] of Object.entries(item.data.params)) {
      if (param.hidden || ['input', 'output'].includes(String(param.display))) continue;
      if (key === 'prompt') await field(page, item.id, key, prompt);
      if (key === 'negative_prompt')
        await field(
          page,
          item.id,
          key,
          'cartoon, illustration, plastic skin, doll, blurry, malformed hands, extra limbs, watermark, text',
        );
      if (['width', 'height'].includes(key)) await field(page, item.id, key, '1024');
      if (key === 'num_inference_steps') await field(page, item.id, key, String(steps));
      if (key === 'guidance_scale') await field(page, item.id, key, String(guidance));
      if (key === 'strength') await field(page, item.id, key, '0.9');
      if (key === 'seed') {
        const toggle = node(page, item.id).getByRole('button', { name: `Toggle random ${param.label}`, exact: true });
        if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click();
        await field(page, item.id, key, '603219');
      }
    }
  }
}

test('fashion demo: one explicitly selected chapter, native UI and retained image', async ({ page }) => {
  test.skip(process.env.MODIFF_FASHION_DEMO !== '1', 'Explicit local demo authoring required.');
  test.setTimeout(20 * 60_000);
  page.setDefaultTimeout(25_000);
  const chapter = Number(process.env.MODIFF_FASHION_CHAPTER || '1');
  const out = resolve(process.env.MODIFF_REVIEW_OUTPUT_DIR || 'artifacts/fashion-demo');
  await mkdir(out, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  let taskId: string | undefined;
  try {
    await expect
      .poll(async () => (await (await page.request.get('/health', { timeout: 5000 })).json()).ready, {
        timeout: 120_000,
        intervals: [2000],
      })
      .toBe(true);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated), null, {
      timeout: 120_000,
    });
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
    const empty = page.getByRole('button', { name: 'Empty workflow', exact: true });
    if (!(await empty.isVisible())) await page.getByTestId('topbar-new-workflow').click();
    await empty.click();
    await expect(page.getByRole('dialog', { name: 'Workflows', exact: true })).toHaveCount(0);
    await page.getByRole('radio', { name: 'Developer', exact: true }).check();
    if (process.env.MODIFF_FASHION_SOURCE) {
      const source = await readFile(process.env.MODIFF_FASHION_SOURCE, 'utf8');
      const transfer = await page.evaluateHandle((source) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([source], 'Fashion.json', { type: 'application/json' }));
        return transfer;
      }, source);
      await page.locator('.react-flow').dispatchEvent('drop', { dataTransfer: transfer });
      await transfer.dispose();
      await expect(page.locator('.react-flow__node')).toHaveCount(JSON.parse(source).nodes.length);
    }
    const policy = page.getByTestId('topbar-resource-policy');
    if ((await policy.getAttribute('aria-pressed')) === 'true') await policy.click();
    const title =
      process.env.MODIFF_FASHION_TITLE ||
      `Fashion Study - ${String(chapter).padStart(2, '0')} - ${['', 'SoHo baseline', 'Split lighting', 'Emerald wardrobe'][chapter]}`;
    // Snapshot BEFORE edits; never autosave chapter N+1 into chapter N.
    // Saving a still-empty canvas creates a new workflow identity and reopens
    // the task launcher. Only imported, nonempty chapters need this early fork.
    if ((await graph(page)).nodes.length) await save(page, title);
    if (!(await page.getByLabel('Search nodes', { exact: true }).isVisible()))
      await page.getByTestId('left-tab-nodes').click();
    let preview: string;
    if (chapter >= 4) {
      preview = await editorialChapter(page, chapter);
    } else if (process.env.MODIFF_FASHION_TUNE === '1') {
      const current = await graph(page);
      const mask = current.nodes.filter((item) => item.data.action === 'EditorialRegions').at(-1)!;
      await field(page, mask.id, 'regions', process.env.MODIFF_FASHION_REGIONS!);
      await field(page, mask.id, 'feather', '0.006');
      if (process.env.MODIFF_FASHION_EDIT_PROMPT) {
        const promptNode = current.nodes.find(
          (item) => item.data.operationAuthoring?.operation.task === 'inpaint' && item.data.params.prompt,
        )!;
        await field(page, promptNode.id, 'prompt', process.env.MODIFF_FASHION_EDIT_PROMPT);
      }
      const composite = current.nodes.find((item) => item.data.action === 'ProtectedComposite')!;
      preview = current.edges.find((edge) => edge.source === composite.id && edge.sourceHandle === 'out_image')!.target;
    } else if (chapter === 1) {
      const initial = await starter(page, 'ZImageModularPipeline', 'text to image');
      await configure(page, new Set(initial.map((item) => item.id)), baselinePrompt, 9, 1);
      const display = await add(page, 'modules.Image.Preview');
      await wire(page, initial.find((item) => item.data.action === 'DecodeLatents')!.id, 'images', display.id, 'image');
      preview = display.id;
    } else if (chapter === 2) {
      const registry = await (await page.request.get('/custom_modules', { timeout: 15_000 })).json();
      if (!JSON.stringify(registry).includes(`custom.${moduleName}`)) {
        await page.getByRole('button', { name: 'Custom nodes', exact: true }).click();
        const dialog = page.getByTestId('custom-extensions-dialog');
        await dialog.getByLabel('Extension source', { exact: true }).fill('examples/custom_nodes/EditorialRegions');
        await dialog.getByLabel('Extension module name').fill(moduleName);
        await dialog.getByRole('button', { name: 'Stage source', exact: true }).click();
        const review = dialog.getByRole('region', { name: 'Extension review' });
        await expect(review).toContainText('Editorial Regions');
        await review.getByRole('checkbox').check();
        await review.getByRole('button', { name: 'Enable code', exact: true }).click();
        await expect(review).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      }
      const decode = (await graph(page)).nodes.find((item) => item.data.action === 'DecodeLatents')!;
      const director = await add(page, `custom.${moduleName}.EditorialRegions`);
      await wire(page, decode.id, 'images', director.id, 'image');
      await field(page, director.id, 'temperature', '0.8');
      await field(page, director.id, 'exposure', '-0.3');
      const display = await add(page, 'modules.Image.Preview');
      await wire(page, director.id, 'out_image', display.id, 'image');
      preview = display.id;
    } else {
      const original = (await graph(page)).nodes.find((item) => item.data.action === 'EditorialRegions')!;
      const mask = await add(page, `custom.${moduleName}.EditorialRegions`);
      await wire(page, original.id, 'out_image', mask.id, 'image');
      await field(
        page,
        mask.id,
        'regions',
        process.env.MODIFF_FASHION_REGIONS ||
          '[{"operation":"add","points":[[0.36,0.32],[0.65,0.32],[0.69,0.9],[0.31,0.9]]}]',
      );
      const referenceEdit = process.env.MODIFF_FASHION_EDITOR === 'klein';
      const refine = await starter(
        page,
        referenceEdit ? 'Flux2KleinModularPipeline' : 'StableDiffusionXLModularPipeline',
        referenceEdit ? 'edit image' : 'inpaint',
      );
      await configure(
        page,
        new Set(refine.map((item) => item.id)),
        process.env.MODIFF_FASHION_EDIT_PROMPT ||
          'Luxury fashion editorial photograph of an elegant adult brunette woman wearing a long emerald green silk evening gown with an elegantly draped fitted bodice and flowing pleated skirt, luxurious shimmering emerald fabric, walking on a SoHo New York street. Realistic couture fashion photography, natural daylight, detailed fabric folds.',
        referenceEdit ? 4 : 40,
        referenceEdit ? 1 : 7,
      );
      for (const consumer of refine.filter((item) => item.data.params.image?.display === 'input'))
        await wire(page, mask.id, 'out_image', consumer.id, 'image');
      if (!referenceEdit)
        await wire(
          page,
          mask.id,
          'mask',
          refine.find((item) => item.data.params.mask_image?.display === 'input')!.id,
          'mask_image',
        );
      const composite = await add(page, `custom.${moduleName}.ProtectedComposite`);
      await wire(page, original.id, 'out_image', composite.id, 'original');
      await wire(
        page,
        refine.find((item) => item.data.action === 'DecodeLatents')!.id,
        'images',
        composite.id,
        'edited',
      );
      await wire(page, mask.id, 'mask', composite.id, 'mask');
      const display = await add(page, 'modules.Image.Preview');
      await wire(page, composite.id, 'out_image', display.id, 'image');
      const maskDisplay = await add(page, 'modules.Image.Preview');
      await wire(page, mask.id, 'mask', maskDisplay.id, 'image');
      preview = display.id;
    }
    await settle(page);
    await save(page, title);
    const authored = await graph(page);
    await writeFile(resolve(out, 'authored.workflow.json'), JSON.stringify(authored, null, 2));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated));
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
    const restored = await graph(page);
    expect(restored.edges).toEqual(authored.edges);
    for (const item of authored.nodes)
      for (const [key, param] of Object.entries(item.data.params))
        if (param.display !== 'output' && !String(param.display).startsWith('ui_'))
          expect(restored.nodes.find((found) => found.id === item.id)!.data.params[key]?.value).toEqual(param.value);
    const queue = await (await page.request.get('/queue', { timeout: 10_000 })).json();
    expect(queue.current).toBeFalsy();
    expect(Object.keys(queue.queued || {})).toHaveLength(0);
    await expect(page.getByTestId('studio-run')).toBeEnabled({ timeout: 60_000 });
    const submitted = page.waitForResponse(
      (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
      { timeout: 60_000 },
    );
    await page.getByTestId('studio-run').click();
    const response = await submitted;
    taskId = (await response.json()).task_id;
    expect(taskId).toBeTruthy();
    await writeFile(
      resolve(out, 'submitted.json'),
      JSON.stringify({ taskId, title, chapter, preview, request: response.request().postDataJSON() }, null, 2),
    );
    console.log(`FASHION ${chapter}: submitted ${taskId}`);
    await expect
      .poll(
        async () => {
          let state;
          try {
            state = await (await page.request.get('/queue', { timeout: 10_000 })).json();
          } catch (error) {
            // Keep the failed latency evidence, but recover read-only status
            // within the original overall deadline. Never resubmit inference.
            console.log('FASHION status transport interruption:', String(error));
            return 'transport-unavailable';
          }
          const task = [state.current, ...(state.recent || [])].find((item) => item?.task_id === taskId);
          if (['failed', 'cancelled', 'error'].includes(task?.status)) throw new Error(JSON.stringify(task));
          return task?.status;
        },
        { timeout: 12 * 60_000, intervals: [3000] },
      )
      .toBe('completed');
    await writeFile(
      resolve(out, 'run.json'),
      JSON.stringify(await (await page.request.get(`/runs/${taskId}`, { timeout: 60_000 })).json(), null, 2),
    );
    const image = await page.request.get(`/cache/${preview}/output/0?format=PNG`, { timeout: 30_000 });
    expect(image.ok()).toBe(true);
    const bytes = await image.body();
    await writeFile(resolve(out, 'output.png'), bytes);
    await page.getByTestId('arrange-graph').click();
    await settle(page);
    await save(page, title);
    await writeFile(resolve(out, 'final.workflow.json'), JSON.stringify(await graph(page), null, 2));
    await page.screenshot({ path: resolve(out, 'frontend.png') });
    await writeFile(
      resolve(out, 'receipt.json'),
      JSON.stringify(
        {
          taskId,
          title,
          chapter,
          preview,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          errors,
          visualReview: 'pending',
        },
        null,
        2,
      ),
    );
    expect(errors).toEqual([]);
  } catch (error) {
    await writeFile(resolve(out, 'failure.json'), JSON.stringify({ taskId, error: String(error), errors }, null, 2));
    await writeFile(resolve(out, 'failed.workflow.json'), JSON.stringify(await graph(page).catch(() => null), null, 2));
    await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
    // Leave any still-running task attributable; never stop an unrelated queue.
    throw error;
  }
});
