import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Isolated backend state, real registry/starter schemas; native gestures after setup.
test.beforeEach(async ({ page }) => {
  test.skip(process.env.MODIFF_NODE_UX_ISOLATED !== '1', 'Requires an isolated backend');
  page.setDefaultTimeout(20_000);
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => Boolean(window.__MODIFF_E2E__)), { timeout: 120_000 }).toBe(true);
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await expect
    .poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().studio.workflowCanvasHydrated), {
      timeout: 120_000,
    })
    .toBe(true);
  const launcher = page.getByTestId('task-launcher');
  if (!(await page.evaluate(() => window.__MODIFF_E2E__!.getState().studio.launcherDismissed))) {
    await expect(launcher).toBeVisible({ timeout: 60_000 });
    await launcher.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(launcher).toBeHidden();
  }
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

test('retained first and last frame recipe opens with two independent image inputs', async ({ page }) => {
  let requests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/graph') requests++;
  });
  await page.evaluate(async () => {
    await window.__MODIFF_E2E__!.applyTemplate('wan_flf_blue_hour_at_the_tram_shelter', {
      referenceImages: ['@data/images/tram-shelter-first.png', '@data/images/tram-shelter-last.png'],
      resourceMode: 'expert',
    });
  });
  await expect
    .poll(
      async () => {
        const api = await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
        return Object.values(api?.nodes ?? {}).some(({ action }) => action === 'ImageEncode');
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  const api = await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
  const encoder = Object.values(api.nodes).find(({ action }) => action === 'ImageEncode')!;
  const first = encoder.params.image.sourceId!;
  const last = encoder.params.last_image.sourceId!;
  expect(first).not.toEqual(last);
  expect(api.nodes[first].params.file.value).toEqual(['@data/images/tram-shelter-first.png']);
  expect(api.nodes[last].params.file.value).toEqual('@data/images/tram-shelter-last.png');
  const denoise = Object.values(api.nodes).find(({ action }) => action === 'Denoise')!;
  expect(denoise.params.guidance_scale.value).toBe(5.5);
  expect(denoise.params.num_frames.value).toBe(81);
  expect(requests).toBe(0);
});

async function openExamples(page: Page) {
  // A lazy library can be selected and open before its buttons mount. Its
  // temporary absence must not be mistaken for a collapsed panel and toggled shut.
  const sidebar = await page.evaluate(() => ({
    selected: document.querySelector('[data-testid="left-tab-workflows"]')?.classList.contains('bg-modiff-panel'),
    width: document.querySelector('[data-testid="left-panel"]')?.getBoundingClientRect().width ?? 0,
  }));
  await test
    .info()
    .attach('native-library-sidebar-state', { body: JSON.stringify(sidebar), contentType: 'application/json' });
  if (!sidebar.selected || sidebar.width <= 50) await page.getByTestId('left-tab-workflows').click();
  await expect
    .poll(() => page.getByTestId('left-panel').evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(50);
  await page.getByRole('button', { name: 'Example workflows', exact: true }).click({ timeout: 60_000 });
}

test('long native model selectors stay within grouped stage width at both desktop sizes', async ({ page }) => {
  test.setTimeout(180_000);
  const executionRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /^\/(graph|hf_download|execute)(\/|$)/u.test(new URL(request.url()).pathname))
      executionRequests.push(request.url());
  });
  await openExamples(page);
  await page
    .getByRole('searchbox', { name: 'Search workflows', exact: true })
    .fill('control-image HunyuanDiTControlNetPipeline');
  const entry = page.getByTestId(/^workflow-file-/u);
  await expect(entry).toHaveCount(1);
  await entry.dblclick();
  await expect(page.getByText('Workflow opened as a new tab', { exact: true })).toBeVisible({ timeout: 60_000 });
  const setupId = await page.evaluate(
    () => window.__MODIFF_E2E__!.exportWorkflowGraph().nodes.find((node) => node.data.label === 'Model Setup')?.id,
  );
  expect(setupId).toBeTruthy();
  const baseline = await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
  for (const viewport of [
    { width: 1920, height: 1200 },
    { width: 1366, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByTestId('arrange-graph').click();
    await page.evaluate(() => document.fonts.ready);
    const inspect = () =>
      page.evaluate((id) => {
        const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;
        const bounds = node.getBoundingClientRect();
        const scale = bounds.width / node.offsetWidth;
        return [...node.querySelectorAll<HTMLElement>('[data-key]')]
          .filter((field) => field.checkVisibility() && field.getBoundingClientRect().width > 0)
          .map((field) => ({
            key: field.dataset.key,
            overflow: (field.getBoundingClientRect().right - bounds.right) / scale,
          }));
      }, setupId!);
    await expect
      .poll(async () => Math.max(...(await inspect()).map((row) => row.overflow)), { timeout: 15_000 })
      .toBeLessThanOrEqual(2);
    await test.info().attach(`stage-width-${viewport.width}`, {
      body: JSON.stringify(await inspect()),
      contentType: 'application/json',
    });
  }
  const after = await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
  expect(after.nodes).toEqual(baseline.nodes);
  expect(after.paths).toEqual(baseline.paths);
  expect(executionRequests).toEqual([]);
});

test('audio task switching updates an ordinary Generate consumer and survives Undo and reload', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') posts.push(new URL(request.url()).pathname);
  });
  await openExamples(page);
  await page
    .getByRole('searchbox', { name: 'Search workflows', exact: true })
    .fill('audio-continuation AceStepAudioPipeline');
  const entry = page.getByTestId(/^workflow-file-/);
  await expect(entry).toHaveCount(1);
  await entry.dblclick();
  await expect(page.getByText('Workflow opened as a new tab', { exact: true })).toBeVisible({ timeout: 30_000 });
  const api = () => page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
  const baseline = await api();
  const generator = Object.entries(baseline.nodes).find(([, node]) => node.action === 'Generate')!;
  const document = await snapshot(page);
  expect(document.nodes.some((node) => node.id === generator[0] && !node.data.blockInstanceV2)).toBe(true);
  expect(generator[1].params.task_type.value).toBe('continuation');
  expect(posts.filter((url) => url === '/fields/action')).toEqual([]);
  await page.locator('.react-flow__node').getByRole('button', { name: 'Mode', exact: true }).click();
  await page.getByRole('option', { name: 'text_to_audio', exact: true }).click();
  await expect
    .poll(
      async () => {
        const graph = await api();
        const loader = Object.values(graph.nodes).find((node) => node.action === 'LoadPipeline')!;
        const generate = graph.nodes[generator[0]];
        return {
          mode: loader.params.mode.value,
          selectedTask: (loader.params.audio_contract.value as { taskType: string }).taskType,
          consumedTask: (generate.params.audio_contract.value as { taskType: string }).taskType,
          task: generate.params.task_type.value,
        };
      },
      { timeout: 20_000 },
    )
    .toEqual({ mode: 'text_to_audio', selectedTask: 'text2music', consumedTask: 'text2music', task: 'text2music' });
  const edited = await api();
  await page.getByTestId('topbar-resource-policy').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await api()).nodes).toEqual(baseline.nodes);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await api()).nodes).toEqual(edited.nodes);
  const active = page.getByRole('tablist', { name: 'Workflow tabs' }).getByRole('tab', { selected: true });
  const workflowId = (await active.getAttribute('data-testid'))!.replace(/^workflow-tab-/, '');
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' && new URL(response.url()).pathname === `/workflows/${workflowId}`,
  );
  await page.getByTestId('topbar-save-workflow').click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByText('Saved Audio continuation to My workflows', { exact: true })).toBeVisible();
  const metadataRequests = posts.filter((url) => url === '/fields/action').length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(async () => (await api()).nodes).toEqual(edited.nodes);
  expect(posts.filter((url) => url === '/fields/action')).toHaveLength(metadataRequests);
  expect(posts.some((url) => /^\/(graph|execute|hf_download)(\/|$)/.test(url))).toBe(false);
});

test('model setup switching updates native model and Generate contract inside collapsed stages', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') posts.push(request.url());
  });
  await openExamples(page);
  await page
    .getByRole('searchbox', { name: 'Search workflows', exact: true })
    .fill('text-to-image StableDiffusionPipeline');
  const entry = page.getByTestId(/^workflow-file-/);
  await expect(entry).toHaveCount(1);
  await entry.dblclick();
  await expect(page.getByText('Workflow opened as a new tab', { exact: true })).toBeVisible({ timeout: 30_000 });
  const baseline = await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
  expect(posts.filter((url) => url.endsWith('/fields/action'))).toEqual([]);
  const model = page.locator('.react-flow__node [data-key="stage-node-02:pipeline_class"]');
  await model.getByRole('button').click();
  await page.getByRole('option', { name: 'SanaSprintPipeline', exact: true }).click();
  const api = () => page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
  await expect
    .poll(async () => {
      const graph = await api();
      const loader = Object.values(graph.nodes).find((node) => node.action === 'LoadPipeline')!;
      const generate = Object.values(graph.nodes).find((node) => node.action === 'Generate')!;
      return { model: loader.params.model_id?.value, contract: generate.params.image_contract?.value };
    })
    .toMatchObject({
      model: { value: 'Efficient-Large-Model/Sana_Sprint_0.6B_1024px_diffusers' },
      contract: { pipelineClass: 'SanaSprintPipeline' },
    });
  const edited = await api();
  expect(posts.some((url) => url.endsWith('/fields/action'))).toBe(true);
  expect(posts.some((url) => /\/graph$|\/download/.test(url))).toBe(false);
  await page.getByTestId('topbar-resource-policy').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await api()).nodes).toEqual(baseline.nodes);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await api()).nodes).toEqual(edited.nodes);
  await page.getByTestId('topbar-save-workflow').click();
  await expect(page.getByText('Saved text-to-image to My workflows', { exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(window.__MODIFF_E2E__?.getState().websocket.sid))).toBe(true);
  expect((await api()).nodes).toEqual(edited.nodes);
  const sequenceLength = page.locator('.react-flow__node [data-key="stage-node-01:max_sequence_length"] input');
  await expect(sequenceLength).toBeVisible();
  // The imported example uses a default value. Author a value valid for Sana
  // but above PRX's limit so preservation is independent of example defaults.
  await sequenceLength.fill('257');
  await sequenceLength.press('Tab');
  await expect(sequenceLength).toHaveValue('257');
  await model.getByRole('button').click();
  await page.getByRole('option', { name: 'PRXPipeline', exact: true }).click();
  await expect(
    page
      .locator('.react-flow__node [data-key="stage-node-01:max_sequence_length"]')
      .getByRole('button', { name: 'Increase Max Sequence Length', exact: true }),
  ).toBeDisabled();
  await expect(sequenceLength).toHaveValue('257');
  await expect(sequenceLength).toHaveAttribute('aria-invalid', 'true');
  const incompatible = await api();
  await sequenceLength.focus();
  await sequenceLength.press('Tab');
  await expect.poll(api).toEqual(incompatible);
  await sequenceLength.fill('256');
  await sequenceLength.press('Tab');
  await expect(
    page
      .locator('.react-flow__node [data-key="stage-node-01:max_sequence_length"]')
      .getByRole('button', { name: 'Increase Max Sequence Length', exact: true }),
  ).toBeDisabled();
  await expect
    .poll(
      async () =>
        Object.values((await api()).nodes).find((node) => node.action === 'Generate')!.params.max_sequence_length
          ?.value,
    )
    .toBe(256);
  await page.getByTestId('topbar-resource-policy').focus();
  await page.keyboard.press('Control+z');
  await expect(sequenceLength).toHaveValue('257');
  await page.keyboard.press('Control+Shift+z');
  await expect(sequenceLength).toHaveValue('256');
  await expect(sequenceLength).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('topbar-save-workflow').click();
  await expect(page.getByText('Saved text-to-image to My workflows', { exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(sequenceLength).toHaveValue('256', { timeout: 60_000 });
  await model.getByRole('button').click();
  await page.getByRole('option', { name: 'StableDiffusionPipeline', exact: true }).click();
  await expect(sequenceLength).toBeHidden();
  expect(posts.some((url) => /\/graph$|\/download/.test(url))).toBe(false);
});

test('tabbing across an untouched numeric stage control keeps one edit as one Undo', async ({ page }) => {
  if (!(await page.getByRole('button', { name: 'Example workflows', exact: true }).isVisible()))
    await page.getByTestId('left-tab-workflows').click();
  await page.getByRole('button', { name: 'Example workflows', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search workflows', exact: true }).fill('text-to-video AllegroPipeline');
  const entry = page.getByTestId(/^workflow-file-/);
  await expect(entry).toHaveCount(1);
  await entry.dblclick();
  await expect(page.getByText('Workflow opened as a new tab', { exact: true })).toBeVisible({ timeout: 30_000 });
  const baseline = await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
  const steps = page.locator('.react-flow__node [data-key="stage-node-04:num_inference_steps"] input');
  const count = page.locator('.react-flow__node [data-key="stage-node-04:num_videos_per_prompt"] input');
  const original = await steps.inputValue();
  for (const gesture of ['Tab', 'Enter']) {
    await steps.fill(String(Number(original) - 1));
    await steps.press(gesture);
    if (gesture === 'Tab') await expect(count).toBeFocused();
    await page.getByTestId('topbar-resource-policy').focus();
    const edited = await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
    expect(edited.nodes).not.toEqual(baseline.nodes);
    await page.keyboard.press('Control+z');
    await expect.poll(() => page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph())).toEqual(baseline);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph())).toEqual(edited);
    await page.keyboard.press('Control+z');
    await expect.poll(() => page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph())).toEqual(baseline);
  }
  await page.getByTestId('topbar-save-workflow').click();
  await expect(page.getByText('Saved text-to-video to My workflows', { exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(window.__MODIFF_E2E__?.getState().websocket.sid))).toBe(true);
  const restored = await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
  expect(restored.nodes).toEqual(baseline.nodes);
  expect(restored.paths).toEqual(baseline.paths);
});

test('aliased stage options follow current runtime availability without changing the saved graph', async ({ page }) => {
  if (!(await page.getByRole('button', { name: 'Example workflows', exact: true }).isVisible()))
    await page.getByTestId('left-tab-workflows').click();
  await page.getByRole('button', { name: 'Example workflows', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search workflows', exact: true }).fill('text-to-video AllegroPipeline');
  const entry = page.getByTestId(/^workflow-file-/);
  await expect(entry).toHaveCount(1);
  await entry.dblclick();
  await expect(page.getByText('Workflow opened as a new tab', { exact: true })).toBeVisible({ timeout: 30_000 });
  const baseline = await snapshot(page);
  const api = await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
  const field = page.locator('.react-flow__node [data-key="stage-node-02:attention_backend"]');
  for (const available of [true, false]) {
    // Simulate only the independent registry availability signal. This is a
    // presentation contract test, not a GPU execution or installation claim.
    await page.evaluate(async (available) => {
      const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
      const registry = useNodesStore.getState().nodesRegistry;
      const key = 'modules.DiffusersRuntime.DiffusersExecutionRecipe';
      const definition = registry[key]!;
      const param = definition.params.attention_backend!;
      const options = (param.options as Array<Record<string, unknown>>).map((option) =>
        option.value === '_native_efficient'
          ? {
              ...option,
              compatibility: available ? 'compatible' : 'incompatible',
              availability: available ? 'installed' : 'unavailable',
              installationState: available ? 'installed' : 'unavailable',
              disabledReason: available ? undefined : 'Unavailable in this current runtime',
            }
          : option,
      );
      useNodesStore.setState({
        nodesRegistry: {
          ...registry,
          [key]: { ...definition, params: { ...definition.params, attention_backend: { ...param, options } } },
        },
      });
    }, available);
    await field.getByRole('button').click();
    const option = page.getByRole('option', { name: '_native_efficient', exact: true });
    if (available) await expect(option).toBeEnabled();
    else await expect(option).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(await snapshot(page)).toEqual(baseline);
    expect(await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph())).toEqual(api);
  }
  const device = page.locator('.react-flow__node [data-key="stage-node-05:device"]');
  for (const available of [true, false]) {
    await page.evaluate(async (available) => {
      const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
      const registry = useNodesStore.getState().nodesRegistry;
      const key = 'modules.DiffusersVideo.LoadPipeline';
      const definition = registry[key]!;
      const choice = (value: string) => ({
        schemaVersion: 1,
        value,
        label: value,
        compatibility: 'compatible',
        availability: 'installed',
        installationState: 'installed',
      });
      useNodesStore.setState({
        nodesRegistry: {
          ...registry,
          [key]: {
            ...definition,
            params: {
              ...definition.params,
              device: {
                ...definition.params.device,
                runtimeOptions: 'choices',
                options: available ? [choice('cpu'), choice('cuda:0')] : [choice('cpu')],
              },
            },
          },
        },
      });
    }, available);
    await device.getByRole('button').click();
    const option = page.getByRole('option', { name: /^cuda:0/ });
    if (available) await expect(option).toBeEnabled();
    else await expect(option).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(await snapshot(page)).toEqual(baseline);
    expect(await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph())).toEqual(api);
  }
});

test('a selected workflow library icon reopens its collapsed panel in one click', async ({ page }) => {
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/stores/useSettingsStore.ts');
    useSettingsStore.getState().setLeftPanelTabIndex(4);
    useSettingsStore.getState().setLeftPanelOpen(false);
  });
  await page.getByTestId('left-tab-workflows').click();
  await expect(page.getByRole('button', { name: 'Example workflows', exact: true })).toBeVisible();
});

for (const id of ['qwen_product_ad_composite', 'qwen_inpaint_object_replace', 'reference_fusion']) {
  test(`fresh image inputs stay within their arranged nodes after previews load: ${id}`, async ({ page }) => {
    const label = await page.evaluate(
      (id) => window.__MODIFF_E2E__!.listTemplates(true).find((item) => item.id === id)!.label,
      id,
    );
    await page.getByTestId('topbar-templates').click();
    const dialog = page.getByRole('dialog', { name: 'Templates', exact: true });
    await dialog.getByTestId('template-browser-category-all').click();
    await dialog.getByTestId('template-browser-search').fill(label);
    await dialog.getByTestId(`template-browser-create-card-${id}`).click();
    await expect(dialog).toHaveCount(0, { timeout: 60_000 });
    // The encoding editor is lazy. Its fallback already has the stage title,
    // while its reference preview and fonts can arrive after the source nodes.
    // Wait for the actual controls before evaluating the constructor's geometry.
    await expect(page.locator('.react-flow__node').getByText('Loading node controls…', { exact: true })).toHaveCount(
      0,
      { timeout: 45_000 },
    );
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await test.info().attach('native-image-font-state', {
      body: JSON.stringify(
        await page.evaluate(() => ({
          fonts: [...document.fonts].map((font) => ({ family: font.family, status: font.status })),
          status: document.fonts.status,
          images: [...document.querySelectorAll<HTMLImageElement>('.react-flow__node img')].map((image) => ({
            src: image.currentSrc || image.src,
            complete: image.complete,
            width: image.naturalWidth,
          })),
        })),
      ),
      contentType: 'application/json',
    });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const previews = [...document.querySelectorAll<HTMLImageElement>('.react-flow__node img')];
            return previews.length > 0 && previews.every((image) => image.complete && image.naturalWidth > 0);
          }),
        { timeout: 45_000 },
      )
      .toBe(true);
    // Inspect the constructor's layout without clicking Arrange. Media arrival
    // must not invalidate the space reserved when that layout was calculated.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const graph = window.__MODIFF_E2E__!.exportWorkflowGraph();
            const boxes = graph.nodes
              .filter((node) => !node.parentId)
              .flatMap((node) => {
                const element = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${node.id}"]`);
                return element ? [{ id: node.id, ...element.getBoundingClientRect().toJSON() }] : [];
              });
            const overlaps: string[] = [];
            for (let i = 0; i < boxes.length; i++)
              for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i]!,
                  b = boxes[j]!;
                if (
                  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
                  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2
                )
                  overlaps.push(`${a.id}/${b.id}`);
              }
            return overlaps;
          }),
        { timeout: 10_000 },
      )
      .toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`${id}-loaded-input-layout.png`) });
  });
}

for (const [file, model] of [
  ['data-conversion', 'BuiltinDataOperation'],
  ['text-to-image', 'AuraFlowPipeline'],
  ['text-to-image', 'SanaSprintPipeline'],
  ['image-to-text', 'HuggingFaceImageTextToTextModel'],
  ['text-to-audio', 'MiniMaxMusic3ModularPipeline'],
  ['image-to-video', 'WanImage2VideoModularPipeline'],
  ['audio-join', 'BuiltinAudioOperation'],
]) {
  test(`canonical Example retains its ordinary graph and saves its staged layout: ${model}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openExamples(page);
    await page.getByRole('searchbox', { name: 'Search workflows', exact: true }).fill(`${file} ${model}`);
    const entry = page.getByTestId(/^workflow-file-/);
    await expect(entry).toHaveCount(1);
    await entry.dblclick();
    await expect(page.getByText('Workflow opened as a new tab', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.react-flow__node')).not.toHaveCount(0);
    const state = await page.evaluate(
      () => (window.__MODIFF_E2E__!.getState() as { studio: { graphBinding: unknown } }).studio,
    );
    expect(state.graphBinding).toBeNull();
    const api = await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
    if (model === 'AuraFlowPipeline') {
      const generate = Object.values(api.nodes).find((node) => node.action === 'Generate')!;
      expect(generate.params).not.toHaveProperty('use_guidance_scale_2');
      expect(generate.params).not.toHaveProperty('guidance_scale_2');
      const connectors = page.getByTestId(/^setup-node-/).getByRole('group', { name: 'Node connectors' });
      await expect(connectors.getByText('Pipeline Quantization Config V2 · Summary', { exact: true })).toBeVisible();
      await expect(connectors.getByText('Diffusers Execution Recipe · Summary', { exact: true })).toBeVisible();
      await expect(connectors.getByText('Summary', { exact: true })).toHaveCount(0);
    }
    if (model === 'HuggingFaceImageTextToTextModel') {
      const generate = Object.values(api.nodes).find((node) => node.action === 'GenerateImageVideoText')!;
      for (const field of ['operation', 'enhancement_max_new_tokens', 'layout_conditioning'])
        expect(generate.params).not.toHaveProperty(field);
    }
    if (['MiniMaxMusic3ModularPipeline', 'WanImage2VideoModularPipeline'].includes(model)) {
      const loader = Object.values(api.nodes).find((node) => node.action === 'ModelsLoader')!;
      expect(loader.params).not.toHaveProperty('weight_format');
    }
    if (model === 'WanImage2VideoModularPipeline') {
      const encode = page.getByTestId(/^encoding-node-/).getByRole('group', { name: 'Node connectors' });
      await expect(encode.getByText('Image *', { exact: true })).toBeVisible();
      await expect(encode.getByText('Last Image', { exact: true })).toBeVisible();
      const generate = page.getByTestId(/^generate-node-/).getByRole('group', { name: 'Node connectors' });
      await expect(generate.getByText('VAE *', { exact: true })).toBeVisible();
      const embedding = Object.values(api.nodes).find((node) => node.action === 'ImageEmbeddings')!;
      const encoder = Object.values(api.nodes).find((node) => node.action === 'ImageEncode')!;
      expect(embedding.params.image).toMatchObject({
        sourceId: encoder.params.image.sourceId,
        sourceKey: encoder.params.image.sourceKey,
      });
      expect(embedding.params.last_image).toMatchObject({
        sourceId: encoder.params.last_image.sourceId,
        sourceKey: encoder.params.last_image.sourceKey,
      });
      expect(embedding.params.image.sourceId).not.toBe(embedding.params.last_image.sourceId);
      const denoise = Object.values(api.nodes).find((node) => node.action === 'Denoise')!;
      const decode = Object.values(api.nodes).find((node) => node.action === 'DecodeLatents')!;
      expect(denoise.params.vae).toMatchObject({
        sourceId: decode.params.vae.sourceId,
        sourceKey: decode.params.vae.sourceKey,
      });
    }
    if (model === 'MiniMaxMusic3ModularPipeline') {
      const setup = page.getByTestId(/^setup-node-/);
      await expect(setup.getByRole('button', { name: 'Change model / task' })).toBeVisible();
      await expect(setup.getByRole('button', { name: 'Adapters', exact: true })).toHaveCount(0);
      const generate = page.getByTestId(/^generate-node-/);
      await expect(generate).toHaveCount(1);
      await expect(generate.getByText('Generate', { exact: true }).first()).toBeVisible();
      await expect(generate.getByText('Steps', { exact: true }).first()).toBeVisible();
      await expect(page.getByTestId(/^output-node-/).getByText('Audio Output', { exact: true })).toBeVisible();
      const [samplerId] = Object.entries(api.nodes).find(([, node]) => node.action === 'WorkflowDenoise')!;
      const [decoderId, decoder] = Object.entries(api.nodes).find(([, node]) => node.action === 'WorkflowDecodeAudio')!;
      const audio = Object.values(api.nodes).find(
        (node) => node.action === 'Export' && node.module === 'modules.Audio',
      )!;
      expect(decoder.params.state_in).toMatchObject({ sourceId: samplerId, sourceKey: 'state_out' });
      expect(audio.params.audio).toMatchObject({ sourceId: decoderId, sourceKey: 'audio' });
    }
    if (model === 'BuiltinAudioOperation') {
      await expect(page.locator('.react-flow__node').getByText('Previous', { exact: true })).toHaveCount(0);
      const overlaps = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('.react-flow__node')].map((node) => node.getBoundingClientRect());
        return boxes.flatMap((a, i) =>
          boxes
            .slice(i + 1)
            .filter(
              (b) =>
                Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
                Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2,
            ),
        ).length;
      });
      expect(overlaps).toBe(0);
    }
    await page.getByTestId('topbar-save-workflow').click();
    await expect(page.getByText(`Saved ${file} to My workflows`, { exact: true })).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect
      .poll(() =>
        page.evaluate(
          () => Boolean(window.__MODIFF_E2E__) && document.querySelectorAll('.react-flow__node').length > 0,
        ),
      )
      .toBe(true);
    const restored = await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
    expect(restored.nodes).toEqual(api.nodes);
    expect(restored.paths).toEqual(api.paths);
    if (model === 'MiniMaxMusic3ModularPipeline') {
      const setup = page.getByTestId(/^setup-node-/);
      await expect(setup.getByRole('button', { name: 'Change model / task' })).toBeVisible();
      await expect(setup.getByRole('button', { name: 'Adapters', exact: true })).toHaveCount(0);
      const generate = page.getByTestId(/^generate-node-/);
      await expect(generate).toHaveCount(1);
      await expect(generate.getByText('Steps', { exact: true }).first()).toBeVisible();
    }
    expect(errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`${model}-example-restored.png`) });
  });
}

for (const resourceMode of ['auto', 'expert'] as const) {
  test(`a stale managed document preserves ${resourceMode} diagnostics during CPU normalization`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const graph = JSON.parse(
      await readFile(
        path.resolve(
          process.env.MODIFF_BACKEND_DIR || '../MoDiff',
          'data/graphs/studio/builtin-data-operation/data-conversion.json',
        ),
        'utf8',
      ),
    );
    const form = await page.evaluate(
      () => (window.__MODIFF_E2E__!.getState() as { studio: { form: Record<string, unknown> } }).studio.form,
    );
    const id = `node-ux-stale-${Date.now()}`;
    const roles = Object.fromEntries(
      graph.nodes.map((node: { id: string; data: { studioRole: string } }) => [node.data.studioRole, node.id]),
    );
    const binding = {
      mode: 'data_conversion',
      modelType: 'BuiltinDataOperation',
      nodes: roles,
      managedNodeIds: graph.nodes.map((node: { id: string }) => node.id),
      managedEdgeIds: graph.edges.map((edge: { id: string }) => edge.id),
      fingerprint: `data_conversion:BuiltinDataOperation:${resourceMode}:none`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      executionSpec: {
        schemaVersion: 1,
        id: 'builtin-data-operations:data-conversion:v1',
        contentHash: 'studio-spec-v1-00000000',
        executionProfileId: 'builtin-data-operations:direct',
      },
    };
    const response = await page.request.put(`/workflows/${id}`, {
      data: {
        title: 'Legacy data receipt recovery',
        intent: 'saved',
        source: 'import',
        snapshot: {
          nodes: graph.nodes,
          edges: graph.edges,
          viewport: { x: 0, y: 0, zoom: 1 },
          studioForm: {
            ...form,
            modelType: 'BuiltinDataOperation',
            mode: 'data_conversion',
            device: 'cuda:0',
            resourceMode,
          },
          studioGraphBinding: binding,
          selectedMode: 'data_conversion',
          activeTemplateId: null,
          sourceOutputId: null,
        },
      },
    });
    expect(response.ok()).toBe(true);
    if (!(await page.getByRole('button', { name: 'My workflows', exact: true }).isVisible()))
      await page.getByTestId('left-tab-workflows').click();
    await page.getByRole('button', { name: 'My workflows', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search workflows', exact: true }).fill('Legacy data receipt recovery');
    await page
      .getByTestId(`saved-workflow-${id}`)
      .getByRole('button', { name: 'Legacy data receipt recovery', exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window.__MODIFF_E2E__!.getState() as { studio: { lastError: string | null } }).studio.lastError,
        ),
      )
      .toBe('The Studio execution specification receipt is stale.');
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    const diagnostic = await page.evaluate(() => {
      const state = window.__MODIFF_E2E__!.getState() as {
        studio: { graphBinding: unknown; graphFinalization: unknown; lastError: unknown; form: unknown };
        flow: unknown;
      };
      return {
        binding: state.studio.graphBinding,
        finalization: state.studio.graphFinalization,
        lastError: state.studio.lastError,
        form: state.studio.form,
      };
    });
    await test
      .info()
      .attach('stale-managed-state', { body: JSON.stringify(diagnostic, null, 2), contentType: 'application/json' });
    // Custom memory policy already permits backend diagnostics without managed
    // Auto authority. UI recovery must retain that policy, not add a new block.
    if (resourceMode === 'auto') await expect(page.getByTestId('studio-run')).toBeDisabled();
    else await expect(page.getByTestId('studio-run')).toBeEnabled();
    const restored = await snapshot(page);
    const operation = restored.nodes.find((node) => node.data.action === 'ProcessText')!;
    const original = graph.nodes.find((node: { data: { action: string } }) => node.data.action === 'ProcessText');
    for (const field of ['source', 'operation', 'pipeline_class'])
      expect(operation.data.params[field]?.value).toEqual(original.data.params[field]?.value);
    expect(errors).toEqual([]);
  });
}

test('repeated shot stages keep collapsed connector trays inside every ancestor', async ({ page }) => {
  await page.evaluate(async () => {
    await window.__MODIFF_E2E__!.applyTemplate('ltx_video_long_showcase', {
      device: 'cpu:0',
      offloadMode: 'none',
      autoOffload: false,
    });
  });
  const ids = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const roots = useFlowStore.getState().nodes;
    const shot = roots.find((node) => node.data.label?.startsWith('Shot 2 '))!;
    return { shot: shot.id };
  });
  const shot = page.locator(`.react-flow__node[data-id="${ids.shot}"]`);
  await shot.getByRole('button', { name: 'Expand block', exact: true }).click();
  await expect
    .poll(
      async () =>
        page.evaluate(async (owner) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          const nodes = useFlowStore
            .getState()
            .nodes.filter(
              (node) =>
                node.parentId === owner &&
                node.data.blockProjectionContainer &&
                ['Encode Inputs', 'Generate'].includes(node.data.label ?? ''),
            );
          if (nodes.length !== 2) return false;
          return nodes.every((node) => {
            const frame = document.querySelector<HTMLElement>(
              `.react-flow__node[data-id="${node.id}"] [data-block-projection]`,
            );
            const parent = document.querySelector<HTMLElement>(
              `.react-flow__node[data-id="${owner}"] [data-block-schema-version="2"]`,
            );
            if (!frame || !parent || frame.scrollHeight > frame.clientHeight + 2) return false;
            return frame.getBoundingClientRect().bottom < parent.getBoundingClientRect().bottom - 8;
          });
        }, ids.shot),
      { timeout: 15_000 },
    )
    .toBe(true);
  const generateId = await page.evaluate(async (owner) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore.getState().nodes.find((node) => node.parentId === owner && node.data.label === 'Generate')!.id;
  }, ids.shot);
  const generate = page.locator(`.react-flow__node[data-id="${generateId}"]`);
  const projectedControls = await page.evaluate(async (owner) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { visualStageFieldSources } = await import('/src/studio/visualStageFieldActions.ts');
    const nodes = useFlowStore.getState().nodes;
    return nodes
      .filter((node) => node.parentId === owner)
      .flatMap((node) =>
        Object.entries(node.data.params)
          .filter(([, param]) => !param.hidden && param.fieldOptions?.blockContainerControlV1)
          .map(([fieldKey]) => ({
            fieldKey,
            sources: visualStageFieldSources(nodes, {
              nodeId: node.id,
              fieldKey,
              module: node.data.module,
              action: node.data.action,
            })?.map((source) => ({
              module: source.node.data.module,
              action: source.node.data.action,
              field: source.fieldKey,
            })),
          })),
      );
  }, ids.shot);
  expect(projectedControls.length).toBeGreaterThan(0);
  for (const control of projectedControls) {
    expect(control.sources, control.fieldKey).toBeTruthy();
    expect(control.sources?.every((source) => source.module && source.action && source.field)).toBe(true);
  }
  const frames = generate.getByLabel('Frames', { exact: true }).filter({ visible: true });
  await frames.fill('121');
  await frames.press('Tab');
  const strength = generate.getByLabel('Condition strength', { exact: true }).filter({ visible: true });
  await strength.fill('0.85');
  await strength.press('Tab');
  const actual = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return Object.values(useFlowStore.getState().exportGraph('native-edited-shot').nodes)
      .filter((node) => node.action === 'Denoise')
      .map((node) => ({ frames: node.params.num_frames, strength: node.params.strength }));
  });
  expect(
    actual.filter(
      (node) =>
        Number(node.frames.value) === 121 &&
        Number(node.strength.value) === 0.85 &&
        !node.frames.sourceId &&
        !node.strength.sourceId,
    ),
  ).toHaveLength(1);
  expect(actual.filter((node) => Number(node.frames.value) === 81)).toHaveLength(5);
  await page.getByTestId('arrange-graph').click();
  await page.screenshot({ path: test.info().outputPath('sequence-contained-stages.png') });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(window.__MODIFF_E2E__))).toBe(true);
  await expect(page.locator(`.react-flow__node[data-id="${ids.shot}"]`)).toBeVisible();
});

test('nested shot guidance keeps its encoder paired through native editing and persistence', async ({ page }) => {
  test.setTimeout(240_000);
  const executions: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /^\/(graph|execute|hf_download)(\/|$)/u.test(new URL(request.url()).pathname))
      executions.push(request.url());
  });
  await page.getByTestId('topbar-templates').click();
  const dialog = page.getByRole('dialog', { name: 'Templates', exact: true });
  await dialog.getByTestId('template-browser-category-all').click();
  await dialog.getByTestId('template-browser-search').fill('Before Sunrise');
  await dialog.getByTestId('template-browser-create-card-wan_video_long_showcase').click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window
              .__MODIFF_E2E__!.exportWorkflowGraph()
              .nodes.filter((node) => /^Shot \d+\b/u.test(node.data.label ?? '')).length,
        ),
      { timeout: 60_000 },
    )
    .toBe(5);
  await page.getByTestId('arrange-graph').click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
          .flatMap((element) => {
            const label = window
              .__MODIFF_E2E__!.exportWorkflowGraph()
              .nodes.find((node) => node.id === element.dataset.id)?.data.label;
            return /^Shot \d+\b/u.test(label ?? '') ? [{ label, y: element.getBoundingClientRect().y }] : [];
          })
          .sort((left, right) => left.y - right.y)
          .map(({ label }) => label),
      ),
    )
    .toEqual(['Shot 1', 'Shot 2', 'Shot 3', 'Shot 4', 'Shot 5']);
  const shotId = await page.evaluate(
    () =>
      window.__MODIFF_E2E__!.exportWorkflowGraph().nodes.find((node) => /^Shot 2\b/u.test(node.data.label ?? ''))!.id,
  );
  await page
    .locator(`.react-flow__node[data-id="${shotId}"]`)
    .getByRole('button', { name: 'Expand block', exact: true })
    .click();
  await page.getByTestId('arrange-graph').click();
  const generateId = await page.evaluate(async (owner) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore.getState().nodes.find((node) => node.parentId === owner && node.data.label === 'Generate')!.id;
  }, shotId);
  const read = () => page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
  const signature = (value: unknown): string =>
    JSON.stringify(
      (function sort(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(sort);
        if (value && typeof value === 'object')
          return Object.fromEntries(
            Object.entries(value)
              .filter(([key]) => key !== 'sid')
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, sort(item)]),
          );
        return value;
      })(value),
    );
  const before = await read();
  const input = page
    .locator(`.react-flow__node[data-id="${generateId}"]`)
    .getByLabel('Guidance', { exact: true })
    .filter({ visible: true });
  await input.fill('6');
  await input.press('Tab');
  await page.getByTestId('topbar-resource-policy').focus();
  await expect
    .poll(async () => {
      const after = await read();
      const changed = Object.entries(after.nodes).flatMap(([id, node]) =>
        Object.entries(node.params)
          .filter(([key, param]) => signature(param) !== signature(before.nodes[id].params[key]))
          .map(([field, param]) => ({ action: node.action, field, value: Number(param.value) })),
      );
      return changed.sort((a, b) => a.action.localeCompare(b.action));
    })
    .toEqual([
      { action: 'Denoise', field: 'guidance_scale', value: 6 },
      { action: 'EncodeInputs', field: 'guidance_scale', value: 6 },
    ]);
  const after = await read();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => signature(await read())).toBe(signature(before));
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => signature(await read())).toBe(signature(after));
  const active = page.getByRole('tablist', { name: 'Workflow tabs' }).getByRole('tab', { selected: true });
  const workflowId = (await active.getAttribute('data-testid'))!.replace(/^workflow-tab-/u, '');
  const [saved] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' && new URL(response.url()).pathname === `/workflows/${workflowId}`,
      { timeout: 60_000 },
    ),
    page.getByTestId('topbar-save-workflow').click(),
  ]);
  expect(saved.ok()).toBe(true);
  await saved.finished();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator(`.react-flow__node[data-id="${shotId}"]`)).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => signature(await read()), { timeout: 60_000 }).toBe(signature(after));
  expect(executions).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('paired-shot-guidance.png') });
});

test('native template browser creates every selected migration layout', async ({ page }) => {
  test.setTimeout(300_000);
  const ids = [
    'wan_21_t2v_13b_seed_vault',
    'wan_vace_cinematic_text_to_video',
    'wan_vace_video_color_grade',
    'wan_vace_masked_object_replace',
    'wan_vace_outpaint_reframe',
    'wan_vace_grayscale_control',
    'wan_vace_video_to_video',
    'ltx_video_long_showcase',
    'wan_video_long_showcase',
    'wan_22_i2v_seed_vault',
    'ltx_video_animated_story',
    'wan_22_ti2v_5b_seed_vault',
    'ace_step_lyric_music_video',
    'flux3_klein_fp8r512_multi_reference_edit',
    'flux3_klein_base_fp8r512_multi_reference_edit',
  ];
  const evidence: unknown[] = [];
  const requested = process.env.MODIFF_VISUAL_STAGE_TEMPLATE_IDS?.split(',').filter(Boolean);
  if (requested?.some((id) => !ids.includes(id)))
    throw new Error('Unknown migration template requested by the browser runner.');
  for (const id of ids) {
    if (requested && !requested.includes(id)) continue;
    const label = await page.evaluate(
      (id) => window.__MODIFF_E2E__!.listTemplates(true).find((item) => item.id === id)!.label,
      id,
    );
    await page.getByTestId('topbar-templates').click();
    const dialog = page.getByRole('dialog', { name: 'Templates', exact: true });
    await page
      .getByTestId(id.startsWith('flux3_') ? 'template-browser-category-experimental' : 'template-browser-category-all')
      .click();
    await page.getByTestId('template-browser-search').fill(label);
    await page.getByTestId(`template-browser-create-card-${id}`).click();
    await expect(dialog, id).toHaveCount(0, { timeout: 30_000 });
    const graph = (await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph())) as {
      nodes: Array<{ id: string; data: { label: string; action?: string } }>;
      edges: unknown[];
    };
    expect(graph.nodes.length, id).toBeGreaterThan(3);
    expect(
      graph.nodes.some((node) => node.data.label === 'Model Setup'),
      id,
    ).toBe(true);
    expect(
      graph.nodes.some((node) =>
        ['GenerateSequence', 'GenerateShotJob', 'BuildShotJobs'].includes(node.data.action ?? ''),
      ),
      id,
    ).toBe(false);
    await page.getByTestId('arrange-graph').click();
    await page.screenshot({ path: test.info().outputPath(`${id}.png`) });
    evidence.push({ id, labels: graph.nodes.map((node) => node.data.label), nodes: graph.nodes.length, modelsRun: 0 });
    await writeFile(test.info().outputPath('template-creation-results.json'), JSON.stringify(evidence, null, 2));
  }
});

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
  await page.getByRole('menuitem', { name: 'Convert to independent nodes…', exact: true }).click();
  await page.getByRole('button', { name: 'Convert to independent nodes', exact: true }).click();
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
  await inspector.getByRole('button', { name: 'Connections and grouping', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Group input encoders', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).nodes.filter((node) => node.data.blockInstanceV2).length)
    .toBe(1);
  if (!(await inspector.getByRole('heading', { name: 'Node inspector', exact: true }).isVisible())) {
    await page.locator(`.react-flow__node[data-id="${owner}"] header`).first().click();
    await page.getByRole('button', { name: 'Inspect node', exact: true }).click();
  }
  await inspector.getByRole('button', { name: 'Connections and grouping', exact: true }).click();
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

test('imported SDXL encoding output finds its model-bound latent consumer without selecting a pipeline', async ({
  page,
}) => {
  const draft = await page.evaluate(async () => {
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const { requestOperationStarter } = await import('/src/workflow/operationStarterRequest.ts');
    const { createWorkflowDraft } = await import('/src/workflow/workflowDraft.ts');
    const store = useNodesStore.getState();
    const starter = await requestOperationStarter(
      'StableDiffusionXLModularPipeline',
      'text_to_image',
      store.operationContracts,
    );
    return createWorkflowDraft(starter, store.nodesRegistry).graph;
  });
  await page.getByRole('button', { name: 'New workflow tab', exact: true }).click();
  await page.getByLabel('Workflow JSON file', { exact: true }).setInputFiles({
    name: 'SDXL authoring.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(draft)),
  });
  const pane = page.locator('.react-flow__pane');
  const output = page.locator('.react-flow__handle.source[data-handleid="modiff-encoding-output:image_latents"]');
  await expect(output).toBeVisible();
  await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
  const label = await output.getAttribute('data-nodeid');
  const start = await output.boundingBox();
  expect(start).toBeTruthy();
  const end = await pane.evaluate((el) => {
    const b = el.getBoundingClientRect();
    for (let y = b.top + 65; y < Math.min(innerHeight, b.bottom) - 20; y += 35)
      for (let x = b.left + 70; x < Math.min(innerWidth, b.right) - 20; x += 45)
        if (document.elementFromPoint(x, y) === el) return { x, y };
    throw Error('No clear canvas point for wire release');
  });
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 16 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: 'Search nodes' });
  await expect(dialog.getByLabel('Operation pipeline')).toContainText('StableDiffusionXLModularPipeline');
  await dialog.getByLabel('Search nodes', { exact: true }).fill('VAE Decode');
  const option = dialog
    .getByRole('option')
    .filter({ hasText: /Input · latents/i })
    .first();
  await expect(option).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('sdxl-latents-suggestions.png'), animations: 'disabled' });
  await option.click();
  await expect(dialog).toBeHidden();
  const check = async () => {
    const graph = await snapshot(page);
    const added = graph.nodes.find(
      (node) => node.data.action === 'DecodeLatents' && !draft.nodes.some((old) => old.id === node.id),
    );
    return Boolean(
      added &&
      graph.edges.some(
        (edge) =>
          edge.source === label &&
          edge.target === added.id &&
          (edge as { targetHandle?: string }).targetHandle === 'latents',
      ),
    );
  };
  await expect.poll(check).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated);
  await expect.poll(check).toBe(true);
});

test('node and workflow libraries use compact stage rows and fit task rows to sidebar width', async ({ page }) => {
  await page.getByTestId('left-tab-nodes').click();
  const panel = page.getByTestId('left-panel');
  const audio = panel.getByTestId('stage-add-generate-audio');
  await expect(audio).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Setup & inputs' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Outputs' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Add custom node' })).toBeVisible();
  await page.mouse.move(0, 0);
  await panel.screenshot({ path: test.info().outputPath('nodes-library.png'), animations: 'disabled' });
  await page.getByTestId('left-tab-workflows').click();
  await panel.getByRole('button', { name: 'Start', exact: true }).click();
  await panel.getByLabel('Workflow category', { exact: true }).click();
  await page.getByRole('option', { name: 'All workflows', exact: true }).click();
  const rows = panel.getByRole('region', { name: 'Image workflows' }).getByTestId(/^workflow-task-/);
  await expect(rows.first()).toBeVisible();
  const first = await rows.nth(0).boundingBox();
  const second = await rows.nth(1).boundingBox();
  const panelB = await panel.boundingBox();
  if (panelB!.width < 550) expect(second!.y).toBeGreaterThan(first!.y);
  expect(first!.width).toBeGreaterThan(Math.min(220, panelB!.width - 48));
  const nav = panel.getByRole('navigation', { name: 'Workflow library' }).getByRole('button');
  await expect(nav).toHaveCount(4);
  const navRows = () =>
    nav.evaluateAll((buttons) => {
      const tops = buttons.map((button) => Math.round(button.getBoundingClientRect().top));
      return tops.map((top) => tops.indexOf(top));
    });
  await expect.poll(navRows).toEqual([0, 0, 2, 2]);
  await panel.screenshot({ path: test.info().outputPath('workflows-library.png'), animations: 'disabled' });

  const separator = page.getByTestId('left-panel-resize-handle');
  const grip = await separator.boundingBox();
  expect(grip).not.toBeNull();
  const dragY = grip!.y + grip!.height / 2;
  await page.mouse.move(grip!.x + grip!.width / 2, dragY);
  await page.mouse.down();
  await page.mouse.move(panelB!.x + 520, dragY, { steps: 15 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThanOrEqual(500);
  await expect.poll(navRows).toEqual([0, 0, 0, 0]);
});

test('example search matches the model and action in either order, including older directory-only model names', async ({
  page,
}) => {
  await page.getByTestId('left-tab-workflows').click();
  const panel = page.getByTestId('left-panel');
  await panel.getByRole('button', { name: 'Example workflows', exact: true }).click();
  const query = panel.getByRole('searchbox', { name: 'Search workflows', exact: true });
  const example = panel.locator('[data-testid$="ace-step-audio-pipeline-audio-continuation-json"]');
  for (const text of ['audio-continuation AceStepAudioPipeline', 'ACESTEPAUDIOPIPELINE continuation_audio']) {
    await query.fill(text);
    await expect(example).toHaveCount(1);
    await expect(example).toBeVisible();
  }
  await query.fill('ace-step-audio-pipeline no-such-action');
  await expect(example).toHaveCount(0);
});
