import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { connect, save } from './qwenDemoGestures';
import { decodedImageStatistics } from './imageProofStatistics';

async function settle(page: Page) {
  let previous = '';
  let unchanged = 0;
  await expect
    .poll(
      async () => {
        const current = JSON.stringify(await graph(page));
        unchanged = current === previous ? unchanged + 1 : 0;
        previous = current;
        return unchanged;
      },
      { timeout: 20_000, intervals: [200] },
    )
    .toBeGreaterThanOrEqual(3);
}

const prompt =
  'Studio product photograph of a small retro robot, cream enamel and teal metal, two round eyes, on a peach pedestal, warm side lighting, full body, simple backdrop, no text.';
const revisedPrompt = prompt.replace('teal metal', 'cobalt blue metal');
const graph = (page: Page) => page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const authoredValues = (params: Record<string, { value?: unknown; default?: unknown }>) =>
  Object.fromEntries(
    Object.entries(params).map(([key, field]) => [key, { value: field.value, default: field.default }]),
  );

async function field(page: Page, id: string, label: string, value: string) {
  const input = node(page, id).getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press('Tab');
  const numeric = Number.isFinite(Number(value));
  await expect
    .poll(async () => (numeric ? Number(await input.inputValue()) : await input.inputValue()))
    .toBe(numeric ? Number(value) : value);
}

async function starter(page: Page, pipeline: string, task: string) {
  const before = new Set((await graph(page)).nodes.map((item) => item.id));
  const panel = page.getByRole('region', { name: 'Diffusers operations' });
  await panel.getByLabel('Operation pipeline').click();
  await page.getByRole('option', { name: pipeline, exact: true }).click();
  await panel.getByLabel('Operation task').click();
  await page.getByRole('option', { name: task.replaceAll('_', ' '), exact: true }).click();
  await panel.getByRole('button', { name: 'Preview connected starter', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Connected starter', exact: true })
    .getByRole('button', { name: 'Add starter to canvas', exact: true })
    .click();
  await page.getByTestId('arrange-graph').click();
  await settle(page);
  return (await graph(page)).nodes.filter((item) => !before.has(item.id));
}

async function addNode(page: Page, key: string) {
  const before = new Set((await graph(page)).nodes.map((item) => item.id));
  await page.getByLabel('Search nodes', { exact: true }).fill(key);
  const row = page.getByTestId(`node-row-${key.replaceAll('.', '-')}`);
  if (!(await row.isVisible())) {
    const group = page.locator('[data-testid^="node-group-"]').filter({ has: row });
    if (await group.count()) await group.getByRole('button').first().click();
  }
  await row.click();
  await page.getByLabel('Search nodes', { exact: true }).fill('');
  await page.getByTestId('arrange-graph').click();
  return (await graph(page)).nodes.find((item) => !before.has(item.id))!;
}

async function wire(page: Page, from: string, output: string, to: string, input: string) {
  if (
    (await graph(page)).edges.some(
      (edge) =>
        edge.source === from && edge.sourceHandle === output && edge.target === to && edge.targetHandle === input,
    )
  )
    return;
  const clear = page.getByTestId('run-session-shelf').getByRole('button', { name: 'Clear', exact: true });
  if ((await clear.isVisible()) && (await clear.isEnabled())) await clear.click();
  await page.getByTestId('arrange-graph').click();
  // Arrange animates the viewport. Hit-test visibility alone is insufficient:
  // a formerly correct source coordinate can land on a numeric control.
  let prior = '';
  let stable = 0;
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
      { timeout: 10_000, intervals: [200] },
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

async function settings(page: Page, ids: Set<string>, steps: number, guidance?: number, writePrompt = true) {
  const nodes = (await graph(page)).nodes.filter((item) => ids.has(item.id));
  for (const item of nodes) {
    if (item.data.uiState?.disabled) continue;
    for (const [key, value] of Object.entries(item.data.params)) {
      if (value.display === 'output' || value.display === 'input' || value.hidden) continue;
      const label = typeof value.label === 'string' ? value.label : key;
      if (key === 'prompt' && writePrompt) await field(page, item.id, label, prompt);
      if (key === 'width' || key === 'height') await field(page, item.id, label, '512');
      if (key === 'num_inference_steps') await field(page, item.id, label, String(steps));
      if (key === 'guidance_scale' && guidance !== undefined) await field(page, item.id, label, String(guidance));
      if (key === 'seed') {
        const toggle = node(page, item.id).getByRole('button', { name: `Toggle random ${label}`, exact: true });
        if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click();
        await field(page, item.id, label, '271828');
      }
    }
  }
}

test('approved modularity demo: native authoring, custom image/mask, model switches and refresh', async ({ page }) => {
  test.skip(
    process.env.MODIFF_RUN_MODULARITY_DEMO !== '1',
    'Explicit approval to retain demo workflows/custom code required.',
  );
  test.setTimeout(100 * 60_000);
  page.setDefaultTimeout(20_000);
  const out = resolve(process.env.MODIFF_REVIEW_OUTPUT_DIR || 'artifacts/modularity-demo');
  await mkdir(out, { recursive: true });
  const moduleName = process.env.MODIFF_DEMO_MODULE || `DemoPalette${Date.now()}`;
  const receipts: Record<string, unknown>[] = [];
  let activeTask: string | undefined;
  const record = async () => writeFile(resolve(out, 'receipt.json'), JSON.stringify({ moduleName, receipts }, null, 2));
  const recoverOwnedRun = async () => {
    if (!activeTask) return;
    const taskId = activeTask;
    try {
      const state = await (await page.request.get('/queue', { timeout: 10_000 })).json();
      if (state.current?.task_id === taskId) {
        if (Object.keys(state.queued || {}).length)
          throw new Error('Recovery withheld: another queued task could be affected.');
        const backendOrigin = new URL(
          process.env.MODIFF_LIVE_BACKEND_URL || process.env.MODIFF_SERVER || 'http://127.0.0.1:8088',
        ).origin;
        if (!['http://127.0.0.1:8088', 'http://localhost:8088'].includes(backendOrigin))
          throw new Error('Recovery withheld: automatic worker stop is only scoped to the local demo backend.');
        const stopped = await page.request.post('http://127.0.0.1:8089/stop', { timeout: 15_000 });
        expect(stopped.ok()).toBe(true);
        await expect
          .poll(
            async () => {
              try {
                const health = await (await page.request.get('/health', { timeout: 5000 })).json();
                const queue = await (await page.request.get('/queue', { timeout: 5000 })).json();
                return health.ready === true && !queue.current;
              } catch {
                return false;
              }
            },
            { timeout: 120_000, intervals: [2000] },
          )
          .toBe(true);
      }
    } catch (error) {
      receipts.push({ name: 'owned-run-recovery', taskId, phase: 'failed', error: String(error) });
      await record();
    } finally {
      activeTask = undefined;
    }
  };
  const checkpoint = async (name: string) => {
    await save(page, `Modularity Demo - ${name}`);
    await writeFile(resolve(out, `${name}.workflow.json`), JSON.stringify(await graph(page), null, 2));
    await page.screenshot({ path: resolve(out, `${name}.png`) });
  };
  const run = async (name: string, preview: string) => {
    if (process.env.MODIFF_DEMO_AUTHOR_ONLY === '1') return;
    const queue = await (await page.request.get('/queue', { timeout: 10_000 })).json();
    expect(queue.current, 'Do not queue behind another task.').toBeFalsy();
    expect(Object.keys(queue.queued || {})).toHaveLength(0);
    const started = Date.now();
    await expect(page.getByTestId('studio-run')).toBeEnabled({ timeout: 30_000 });
    const submission = page.waitForResponse(
      (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
      { timeout: 60_000 },
    );
    await page.getByTestId('studio-run').click();
    const accepted = await (await submission).json();
    expect(accepted.task_id, JSON.stringify(accepted)).toBeTruthy();
    activeTask = accepted.task_id;
    receipts.push({ name, phase: 'submitted', taskId: activeTask });
    await record();
    const deadline = Date.now() + 10 * 60_000;
    let completed = false;
    while (Date.now() < deadline) {
      const state = await (await page.request.get('/queue', { timeout: 10_000 })).json();
      const task = [state.current, ...Object.values(state.queued || {}), ...(state.recent || [])].find(
        (item) => item?.task_id === activeTask,
      );
      if (task && ['failed', 'error', 'cancelled'].includes(task.status)) throw new Error(JSON.stringify(task));
      if (task?.status === 'completed') {
        completed = true;
        break;
      }
      await page.waitForTimeout(1500);
    }
    expect(completed, `Bounded generation timed out: ${activeTask}`).toBe(true);
    const evidence = await (await page.request.get(`/runs/${activeTask}`, { timeout: 60_000 })).json();
    await writeFile(resolve(out, `${name}.run.json`), JSON.stringify(evidence, null, 2));
    const response = await page.request.get(`/cache/${preview}/output/0?format=PNG`, { timeout: 30_000 });
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    const statistics = await decodedImageStatistics(page, bytes);
    expect(statistics.width).toBe(512);
    expect(statistics.height).toBe(512);
    expect(statistics.standardDeviation).toBeGreaterThan(3);
    await writeFile(resolve(out, `${name}.output.png`), bytes);
    receipts.push({
      name,
      phase: 'completed',
      taskId: activeTask,
      elapsedMs: Date.now() - started,
      statistics,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    activeTask = undefined;
    await record();
  };
  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    // Wait before initial hydration; starting Vite alongside a restarting
    // backend must not turn an HTTP 502 into a false authoring failure.
    await expect
      .poll(
        async () => {
          try {
            const response = await page.request.get('/health', { timeout: 5000 });
            return response.ok() && (await response.json()).ready === true;
          } catch {
            return false;
          }
        },
        { timeout: 120_000, intervals: [2000] },
      )
      .toBe(true);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated), null, {
      timeout: 120_000,
    });
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
    const launcher = page.getByTestId('task-launcher');
    if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Empty workflow', exact: true }).click();
    else await page.getByTestId('topbar-new-workflow').click();
    await page.getByRole('radio', { name: 'Developer', exact: true }).check();
    const memoryPolicy = page.getByTestId('topbar-resource-policy');
    if ((await memoryPolicy.getAttribute('aria-pressed')) === 'true') await memoryPolicy.click();
    const resume = process.env.MODIFF_DEMO_RESUME_WORKFLOW;
    if (resume) {
      await page.getByTestId('left-tab-workflows').click();
      await page.getByRole('button', { name: 'My workflows', exact: true }).click();
      await page.getByLabel('Search workflows').fill('Modularity Demo');
      await page.getByTestId(`saved-workflow-${resume}`).getByRole('button').first().click();
      await expect.poll(async () => (await graph(page)).nodes.length).toBeGreaterThan(0);
    }
    await page.getByTestId('left-tab-nodes').click();
    const initial = resume
      ? (await graph(page)).nodes.filter((item) => item.data.operationAuthoring?.operation.task === 'text_to_image')
      : await starter(page, 'ZImageModularPipeline', 'text_to_image');
    let generator = new Set(initial.map((item) => item.id));
    const decode = initial.find((item) => item.data.action === 'DecodeLatents')!;
    if (!resume) {
      await settings(page, generator, 8, 1);
      const preview = await addNode(page, 'modules.Image.Preview');
      await wire(page, decode.id, 'images', preview.id, 'image');
      await checkpoint('01 - Native Z-Image');
      await run('01-native', preview.id);
    }

    let director = (await graph(page)).nodes.find((item) => item.data.action === 'LightPaletteDirector');
    if (!director) {
      await page.getByRole('button', { name: 'Custom nodes', exact: true }).click();
      const dialog = page.getByTestId('custom-extensions-dialog');
      await dialog.getByLabel('Extension source', { exact: true }).fill('examples/custom_nodes/LightPaletteDirector');
      await dialog.getByLabel('Extension module name').fill(moduleName);
      await dialog.getByRole('button', { name: 'Stage source', exact: true }).click();
      const review = dialog.getByRole('region', { name: 'Extension review' });
      await expect(review).toContainText('Light & Palette Director');
      await review.getByRole('checkbox').check();
      await review.getByRole('button', { name: 'Enable code', exact: true }).click();
      await expect(review).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      director = await addNode(page, `custom.${moduleName}.LightPaletteDirector`);
    }
    const current = await graph(page);
    const availablePreviews = current.nodes.filter(
      (item) => item.data.action === 'Preview' && !current.edges.some((edge) => edge.target === item.id),
    );
    const attachedPreview = (port: string) =>
      current.nodes.find(
        (item) =>
          item.data.action === 'Preview' &&
          current.edges.some(
            (edge) => edge.source === director!.id && edge.sourceHandle === port && edge.target === item.id,
          ),
      );
    const directedPreview =
      attachedPreview('out_image') ?? availablePreviews[0] ?? (await addNode(page, 'modules.Image.Preview'));
    const maskPreview =
      attachedPreview('mask') ?? availablePreviews[1] ?? (await addNode(page, 'modules.Image.Preview'));
    await wire(page, decode.id, 'images', director.id, 'image');
    await wire(page, director.id, 'out_image', directedPreview.id, 'image');
    await wire(page, director.id, 'mask', maskPreview.id, 'image');
    await field(page, director.id, 'Palette strength', '0.8');
    await field(page, director.id, 'Region X', '0.5');
    await checkpoint('02 - Custom art direction');
    if (!process.env.MODIFF_DEMO_START_AT) await run('02-custom', directedPreview.id);

    const existingRefiner = (await graph(page)).nodes.filter(
      (item) => item.data.operationAuthoring?.operation.task === 'inpaint',
    );
    const refiner = existingRefiner.length
      ? existingRefiner
      : await starter(page, 'StableDiffusionXLModularPipeline', 'inpaint');
    await settings(page, new Set(refiner.map((item) => item.id)), 20, 5);
    const imageEncode = refiner.find((item) => item.data.action === 'ImageEncode')!;
    expect(
      imageEncode,
      JSON.stringify(refiner.map((item) => ({ action: item.data.action, params: Object.keys(item.data.params) }))),
    ).toBeTruthy();
    await wire(page, director.id, 'out_image', imageEncode.id, 'image');
    const maskTarget = refiner.find((item) => item.data.params.mask_image?.display === 'input');
    expect(maskTarget).toBeTruthy();
    await wire(page, director.id, 'mask', maskTarget!.id, 'mask_image');
    const refinedGraph = await graph(page);
    const refinerDecode = refiner.find((item) => item.data.action === 'DecodeLatents')!;
    const finalPreview =
      refinedGraph.nodes.find(
        (item) =>
          item.data.action === 'Preview' &&
          refinedGraph.edges.some((edge) => edge.source === refinerDecode.id && edge.target === item.id),
      ) ?? (await addNode(page, 'modules.Image.Preview'));
    await wire(
      page,
      refiner.find((item) => item.data.action === 'DecodeLatents')!.id,
      'images',
      finalPreview.id,
      'image',
    );
    await checkpoint('03 - SDXL masked refinement');
    for (const item of (await graph(page)).nodes.filter((item) =>
      refiner.some((candidate) => candidate.id === item.id),
    )) {
      for (const key of ['width', 'height'])
        if (item.data.params[key] && !item.data.params[key].hidden)
          expect(Number(item.data.params[key].value ?? item.data.params[key].default)).toBe(512);
    }
    if (process.env.MODIFF_DEMO_START_AT !== 'switches') await run('03-refined', finalPreview.id);
    const retained = await graph(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated));
    const restored = await graph(page);
    expect(restored.edges).toEqual(retained.edges);
    for (const item of retained.nodes) {
      const found = restored.nodes.find((candidate) => candidate.id === item.id)!;
      expect(found.position).toEqual(item.position);
      for (const [key, value] of Object.entries(item.data.params))
        expect(found.data.params[key]?.value).toEqual(value.value);
    }
    if (process.env.MODIFF_DEMO_START_AT !== 'switches') await run('04-refreshed', finalPreview.id);
    receipts.push({ name: 'refresh', phase: 'passed', nativeUiGestures: true });
    await record();
    const generatorPrompt = (await graph(page)).nodes.find(
      (item) => generator.has(item.id) && item.data.params.prompt,
    )!;
    await field(page, generatorPrompt.id, String(generatorPrompt.data.params.prompt.label), revisedPrompt);
    await settle(page);

    const cases = [
      ['sdxl', 'stabilityai/stable-diffusion-xl-base-1.0', 25, 5],
      ['sdxl-pag', 'stabilityai/stable-diffusion-xl-base-1.0', 25, 5, 'sdxl-pag:modular'],
      ['klein', 'black-forest-labs/FLUX.2-klein-4B', 4, 1],
      ['flux-dev', 'black-forest-labs/FLUX.1-dev', 28, 3.5],
      ['qwen-2512', 'Qwen/Qwen-Image-2512', 28, 4],
      ['schnell', 'black-forest-labs/FLUX.1-schnell', 4, 0],
      ['krea', 'black-forest-labs/FLUX.1-Krea-dev', 28, 3.5],
      ['turbo', 'stabilityai/sdxl-turbo', 1, 0],
      ['qwen-21', 'Qwen/Qwen-Image-2.1', 40, 1],
      ['return-z-image', 'Tongyi-MAI/Z-Image-Turbo', 8, 1],
    ] as const;
    for (const [name, repository, steps, guidance, exactProfile] of cases) {
      if ((process.env.MODIFF_DEMO_SKIP_CASES || '').split(',').includes(name)) {
        receipts.push({ name, phase: 'skipped', reason: 'Explicit previous receipt reuse' });
        await record();
        continue;
      }
      try {
        const before = await graph(page);
        const owner = before.nodes.find(
          (item) => generator.has(item.id) && ['ModelsLoader', 'LoadPipeline'].includes(item.data.action),
        )!;
        await page.getByTestId('arrange-graph').click();
        await settle(page);
        await node(page, owner.id).getByRole('button', { name: 'Choose model', exact: true }).click();
        const picker = page.getByRole('dialog', { name: /Choose model for/u });
        await picker.getByRole('searchbox', { name: 'Search compatible models' }).fill(repository);
        await writeFile(resolve(out, `${name}.before-preview.json`), JSON.stringify(await graph(page), null, 2));
        if (exactProfile) {
          await picker.getByRole('button', { name: /Other implementations/u }).click();
          await picker.getByRole('button').filter({ hasText: exactProfile }).click();
        } else await picker.getByRole('button').filter({ hasText: repository }).first().click();
        let reviewRequired = false;
        await expect
          .poll(
            async () => {
              if (await picker.getByTestId('model-selection-review').isVisible()) {
                reviewRequired = true;
                return true;
              }
              // During Headless UI transitions a dialog can be temporarily excluded
              // from the accessibility tree without being closed. Wait for removal.
              return (await page.locator('[role="dialog"]').count()) === 0;
            },
            { timeout: 60_000 },
          )
          .toBe(true);
        if (reviewRequired) {
          await writeFile(resolve(out, `${name}.before-apply.json`), JSON.stringify(await graph(page), null, 2));
          await picker.getByRole('button', { name: 'Apply model change', exact: true }).click();
        }
        await expect(picker).toHaveCount(0);
        await settle(page);
        const after = await graph(page);
        const outside = new Set(before.nodes.filter((item) => !generator.has(item.id)).map((item) => item.id));
        generator = new Set(after.nodes.filter((item) => !outside.has(item.id)).map((item) => item.id));
        const carriedPrompt = after.nodes
          .filter((item) => generator.has(item.id))
          .find((item) => item.data.params.prompt);
        expect(carriedPrompt?.data.params.prompt.value, 'The authored prompt survives without retyping.').toBe(
          revisedPrompt,
        );
        const ownerAfter = after.nodes.find(
          (item) => generator.has(item.id) && ['ModelsLoader', 'LoadPipeline'].includes(item.data.action),
        )!;
        expect(ownerAfter.data.operationAuthoring?.operation.decomposition).toBe('loader');
        if (name !== 'qwen-21') expect(ownerAfter.data.module).toBe('modules.ModularDiffusers');
        else expect(ownerAfter.data.module).toBe('modules.DiffusersImage');
        expect(authoredValues(after.nodes.find((item) => item.id === director.id)!.data.params)).toEqual(
          authoredValues(before.nodes.find((item) => item.id === director.id)!.data.params),
        );
        expect(after.edges.some((edge) => edge.target === director.id && generator.has(edge.source))).toBe(true);
        for (const item of refiner)
          expect(authoredValues(after.nodes.find((candidate) => candidate.id === item.id)!.data.params)).toEqual(
            authoredValues(before.nodes.find((candidate) => candidate.id === item.id)!.data.params),
          );
        await settings(page, generator, steps, guidance, false);
        const configured = (await graph(page)).nodes.filter((item) => generator.has(item.id));
        const configuredOwner = configured.find((item) => ['ModelsLoader', 'LoadPipeline'].includes(item.data.action))!;
        expect(
          [undefined, null, '', repository],
          'A hidden variant must not override the chosen repository.',
        ).toContain(configuredOwner.data.params.reviewed_variant?.value);
        if (name === 'sdxl-pag')
          expect(configured.find((item) => item.data.action === 'Guider')?.data.params.guider.value).toBe(
            'PerturbedAttentionGuidance',
          );
        if (name === 'schnell') {
          const scale = configured.find((item) => item.data.action === 'Denoise')!.data.params.guidance_scale;
          expect(scale.hidden).toBe(true);
          expect(Number(scale.value)).toBe(0);
        }
        await checkpoint(`05 - ${name}`);
        if ((process.env.MODIFF_DEMO_REUSE_GENERATIONS || '').split(',').includes(name)) {
          receipts.push({
            name,
            phase: 'generation-reused',
            reason: 'Explicit prior output proof; authoring and refresh still checked.',
          });
          await record();
        } else await run(name, finalPreview.id);
        const saved = await graph(page);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated));
        await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
        const restoredCase = await graph(page);
        expect(restoredCase.edges).toEqual(saved.edges);
        for (const item of saved.nodes) {
          const found = restoredCase.nodes.find((candidate) => candidate.id === item.id)!;
          expect(found.position).toEqual(item.position);
          for (const [key, value] of Object.entries(item.data.params))
            expect(found.data.params[key]?.value).toEqual(value.value);
        }
        receipts.push({ name, phase: 'refresh-preserved', execution: ownerAfter.data.module });
        await record();
      } catch (error) {
        receipts.push({ name, phase: 'failed', error: String(error) });
        await record();
        await writeFile(resolve(out, `${name}.failed.workflow.json`), JSON.stringify(await graph(page), null, 2));
        await page.screenshot({ path: resolve(out, `${name}.failure.png`) }).catch(() => {});
        await recoverOwnedRun();
        const close = page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true });
        if (await close.isVisible().catch(() => false)) await close.click();
        else await page.keyboard.press('Escape');
      }
    }
    expect(
      receipts.filter((item) => item.phase === 'failed'),
      'All model cases were attempted; see retained failure receipts.',
    ).toEqual([]);
  } catch (error) {
    receipts.push({ name: 'authoring', phase: 'failed', error: String(error) });
    await page.screenshot({ path: resolve(out, 'authoring.failure.png') }).catch(() => {});
    throw error;
  } finally {
    await recoverOwnedRun();
    await writeFile(resolve(out, 'last.workflow.json'), JSON.stringify(await graph(page).catch(() => null), null, 2));
    await record();
  }
});
