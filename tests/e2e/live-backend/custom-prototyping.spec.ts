import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { decodedImageStatistics } from './imageProofStatistics';

// Explicit opt-in: creates a uniquely named, reviewed first-party extension.
// It never overwrites an existing package, and disables its own copy afterward.
test('fresh documented custom package enables and reloads through the rendered UI and graph executor', async ({
  page,
}) => {
  test.skip(process.env.MODIFF_RUN_CUSTOM_LIFECYCLE !== '1', 'Requires explicit local custom-code lifecycle approval.');
  const nativeImage = process.env.MODIFF_CUSTOM_NATIVE_IMAGE === '1';
  const modelSwitches = nativeImage && process.env.MODIFF_CUSTOM_MODEL_SWITCHES === '1';
  test.setTimeout((modelSwitches ? 30 : nativeImage ? 20 : 5) * 60_000);
  page.setDefaultTimeout(15_000);
  const backend = resolve(process.env.MODIFF_BACKEND_DIR || '../MoDiff');
  const name = `PrototypingPrompt${Date.now()}`;
  const output = resolve(process.env.MODIFF_REVIEW_OUTPUT_DIR || 'artifacts/custom-prototyping', name);
  await mkdir(output, { recursive: true });
  const source = await readFile(resolve(backend, 'examples/custom_nodes/PromptTools/main.py'), 'utf8');
  expect(source).toContain('return {"result": f"{prefix} {prompt}".strip()}');
  await expect
    .poll(
      async () => {
        const response = await page.request.get('/health', { timeout: 5000 }).catch(() => null);
        return response?.ok() ?? false;
      },
      { timeout: 90_000 },
    )
    .toBe(true);
  const queue = await (await page.request.get('/queue')).json();
  expect(queue.current).toBeFalsy();
  expect(Object.keys(queue.queued || {})).toHaveLength(0);
  let staged = false;
  const receipts: unknown[] = [];
  const network: unknown[] = [];
  const startedAt = Date.now();
  page.on('request', (request) => {
    if (!request.url().includes('/src/') && request.method() === 'POST')
      network.push({ event: 'request', elapsedMs: Date.now() - startedAt, url: request.url() });
  });
  page.on('response', (response) => {
    if (response.request().method() === 'POST')
      network.push({
        event: 'response',
        elapsedMs: Date.now() - startedAt,
        url: response.url(),
        status: response.status(),
      });
  });
  try {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated));
    await expect(page.getByTestId('startup-workspace-gate')).toBeHidden({ timeout: 90_000 });
    const launcher = page.getByTestId('task-launcher');
    await expect(launcher).toBeVisible();
    await launcher.getByRole('button', { name: 'Empty workflow', exact: true }).click();
    await expect(page.getByTestId('startup-workspace-gate')).toBeHidden({ timeout: 90_000 });
    await page.getByRole('radio', { name: 'Developer', exact: true }).check();
    await page.getByTestId('left-tab-nodes').click();
    await page.getByRole('button', { name: 'Custom nodes', exact: true }).click();
    const dialog = page.getByTestId('custom-extensions-dialog');
    await dialog.getByLabel('Extension source', { exact: true }).fill('examples/custom_nodes/PromptTools');
    await dialog.getByLabel('Extension module name').fill(name);
    const installed = page.waitForResponse((response) => response.url().endsWith('/custom_modules/install'));
    await dialog.getByRole('button', { name: 'Stage source', exact: true }).click();
    const installation = await (await installed).json();
    expect(installation.error).toBeFalsy();
    staged = true;
    receipts.push({ operation: 'stage', response: installation });
    const review = dialog.getByRole('region', { name: 'Extension review' });
    await expect(review).toContainText('Prompt Prefix');
    await expect(review.getByRole('button', { name: 'Enable code', exact: true })).toBeDisabled();
    await review.getByRole('checkbox').check();
    const enabled = page.waitForResponse((response) => response.url().endsWith(`/custom_modules/${name}/enable`));
    await review.getByRole('button', { name: 'Enable code', exact: true }).click();
    const activation = await (await enabled).json();
    receipts.push({ operation: 'enable', response: activation });
    const activatedModule = activation.modules.find((item: { name: string }) => item.name === name);
    expect(activatedModule.enabled).toBe(true);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Search nodes', { exact: true }).fill(`custom.${name}.PromptPrefix`);
    await page.getByTestId(`node-row-custom-${name}-PromptPrefix`).click();

    // Import a tiny ordinary graph through the real frontend factories. The
    // approval, Run, reload and persistence gestures below use the actual UI.
    const ids = await page.evaluate(async (name) => {
      const [{ useFlowStore }, { useNodesStore }, { createNodeFromRegistry }, { useStudioStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useNodeStore.ts'),
        import('/src/workflow/nodeFactory.ts'),
        import('/src/stores/useStudioStore.ts'),
      ]);
      const flow = useFlowStore.getState();
      const custom = flow.nodes.find((node) => node.data.module === `custom.${name}`)!;
      if (!custom) throw new Error('The UI did not insert the enabled custom node.');
      const registry = useNodesStore.getState().nodesRegistry;
      const text = createNodeFromRegistry('modules.Primitive.TextValue', registry, { x: 20, y: 100 })!;
      const exported = createNodeFromRegistry('modules.Primitive.ExportData', registry, { x: 760, y: 100 })!;
      text.data.params.text.value = 'a lighthouse at night';
      custom.data.params.text.value = 'This inline value must not override the connected prompt';
      custom.data.params.prefix.value = 'Watercolor:';
      custom.position = { x: 370, y: 100 };
      exported.data.params.format.value = 'text';
      exported.data.params.filename.value = `{PATH:data}/exports/${name}_{HASH:6}.txt`;
      useStudioStore.getState().updateForm({ resourceMode: 'expert' });
      flow.replaceGraph({
        nodes: [text, custom, exported],
        edges: [
          {
            id: `${name}-input`,
            source: text.id,
            sourceHandle: 'output',
            target: custom.id,
            targetHandle: 'prompt_input',
          },
          {
            id: `${name}-output`,
            source: custom.id,
            sourceHandle: 'result',
            target: exported.id,
            targetHandle: 'value',
          },
        ],
      });
      return { custom: custom.id, exported: exported.id };
    }, name);
    let nativePreview: string | null = null;
    const imageHashes: string[] = [];
    if (nativeImage) {
      const response = await page.request.post('/operations/starter', {
        data: { pipelineClass: 'ZImageModularPipeline', task: 'text_to_image', executionProfileId: 'z-image:modular' },
        timeout: 60_000,
      });
      expect(response.ok()).toBe(true);
      const starter = await response.json();
      nativePreview = await page.evaluate(
        async ({ starter, customId }) => {
          const [{ useFlowStore }, { createOperationStarter }, { useNodesStore }, { createNodeFromRegistry }] =
            await Promise.all([
              import('/src/stores/useFlowStore.ts'),
              import('/src/workflow/operationAuthoring.ts'),
              import('/src/stores/useNodeStore.ts'),
              import('/src/workflow/nodeFactory.ts'),
            ]);
          const native = createOperationStarter(starter, { x: 1100, y: 100 });
          for (const node of native.nodes)
            for (const [field, param] of Object.entries(node.data.params)) {
              if (field === 'seed') param.value = { value: 271828, isRandom: false };
              if (field === 'width' || field === 'height') param.value = 512;
            }
          const prompt = native.nodes.find((node) => node.data.action === 'EncodePrompt');
          const decode = native.nodes.find((node) => node.data.action === 'DecodeLatents');
          if (!prompt?.data.params.prompt_input || !decode?.data.params.images)
            throw new Error('The reviewed native starter lacks its declared prompt/image boundary.');
          const preview = createNodeFromRegistry('modules.Image.Preview', useNodesStore.getState().nodesRegistry, {
            x: 2200,
            y: 100,
          });
          if (!preview) throw new Error('Preview Image is unavailable.');
          const flow = useFlowStore.getState();
          flow.replaceGraph({
            nodes: [...flow.nodes, ...native.nodes, preview],
            edges: [
              ...flow.edges,
              ...native.edges,
              {
                id: `${customId}-native`,
                source: customId,
                sourceHandle: 'result',
                target: prompt.id,
                targetHandle: 'prompt_input',
              },
              {
                id: `${decode.id}-preview`,
                source: decode.id,
                sourceHandle: 'images',
                target: preview.id,
                targetHandle: 'image',
              },
            ],
          });
          return preview.id;
        },
        { starter, customId: ids.custom },
      );
    }
    const run = async (expected: string) => {
      const clickedAt = Date.now();
      receipts.push({ operation: 'run requested', elapsedMs: clickedAt - startedAt });
      const submitted = page.waitForResponse(
        (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
        // Live browser restoration measured ~20 seconds from the Run request
        // to its HTTP acknowledgement. Keep this bounded independently of
        // the short locator timeout and retain request/response timing evidence.
        { timeout: 45_000 },
      );
      await expect(page.getByTestId('studio-run')).toBeEnabled();
      await page.getByTestId('studio-run').click();
      const submission = await (await submitted).json();
      receipts.push({ operation: 'submission', response: submission });
      expect(submission.task_id, submission.message || submission.error || 'No task identity').toBeTruthy();
      await expect
        .poll(
          async () => {
            const response = await page.request.get('/queue');
            const state = await response.json();
            const task = [state.current, ...Object.values(state.queued || {}), ...(state.recent || [])].find(
              (entry) => entry?.task_id === submission.task_id,
            );
            if (task && ['failed', 'error', 'cancelled'].includes(task.status))
              throw new Error(task.error || task.message);
            return task?.status;
          },
          { timeout: nativeImage ? 5 * 60_000 : 60_000 },
        )
        .toBe('completed');
      const value = await page.request.get(`/cache/${ids.custom}/result`);
      expect(value.ok()).toBe(true);
      expect(await value.text()).toBe(expected);
      if (nativePreview) {
        const evidence = await (await page.request.get(`/runs/${submission.task_id}`)).json();
        // Retain mismatching evidence too; an assertion must not erase the
        // concrete backend receipt needed to diagnose a provenance defect.
        await writeFile(resolve(output, `native-${imageHashes.length}.run.json`), JSON.stringify(evidence, null, 2));
        expect(
          evidence.outputs.some(
            (item: { resolvedExecutionInputs?: { summary?: { prompt?: string } } }) =>
              item.resolvedExecutionInputs?.summary?.prompt === expected,
          ),
        ).toBe(true);
        const response = await page.request.get(`/cache/${nativePreview}/output/0?format=PNG`);
        expect(response.ok()).toBe(true);
        const bytes = await response.body();
        const image = await decodedImageStatistics(page, bytes);
        expect(image.width).toBe(512);
        expect(image.height).toBe(512);
        expect(image.maximum).toBeGreaterThan(1);
        const hash = createHash('sha256').update(bytes).digest('hex');
        await writeFile(resolve(output, `native-${imageHashes.length}.png`), bytes);
        imageHashes.push(hash);
        receipts.push({ operation: 'native image', taskId: submission.task_id, sha256: hash, image });
      }
      receipts.push({ operation: 'run', taskId: submission.task_id, expected, elapsedMs: Date.now() - clickedAt });
    };
    await run('Watercolor: a lighthouse at night');
    const before = await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
    await writeFile(resolve(output, 'before.workflow.json'), JSON.stringify(before, null, 2));
    const installedPath = resolve(backend, 'custom', name, 'main.py');
    expect(await readFile(installedPath, 'utf8')).toBe(source);
    // Change only this test's freshly staged copy; the repository example and
    // every pre-existing installed extension stay untouched.
    await writeFile(installedPath, source.replace('f"{prefix} {prompt}"', 'f"RELOADED {prefix} {prompt}"'));
    await page.getByRole('button', { name: 'Custom nodes', exact: true }).click();
    // Selecting via the exact module text scopes the review to the owned copy.
    const inspected = await page.request.post(`/custom_modules/${name}/inspect`, { data: {} });
    const inspection = await inspected.json();
    expect(inspection.module.codeHash).not.toBe(activatedModule.codeHash);
    receipts.push({ operation: 'inspect edited installed copy', response: inspection });
    // The management list is a collection of cards, each named by its heading.
    const card = dialog.getByText(name, { exact: true }).locator('..').locator('..');
    await expect(card).toContainText(name);
    await card.getByRole('button', { name: 'Review reload', exact: true }).click();
    await expect(review.getByRole('checkbox')).not.toBeChecked();
    await review.getByRole('checkbox').check();
    // The rendered client intentionally uses the same hash-bound enable API
    // for initial approval and reload; /reload is an HTTP alias for that owner.
    const reloaded = page.waitForResponse((response) => response.url().endsWith(`/custom_modules/${name}/enable`));
    await review.getByRole('button', { name: 'Enable and reload code', exact: true }).click();
    const reload = await (await reloaded).json();
    receipts.push({ operation: 'reload', response: reload });
    expect(reload.modules.find((item: { name: string }) => item.name === name).enabled).toBe(true);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await run('RELOADED Watercolor: a lighthouse at night');
    if (nativeImage) expect(imageHashes[1]).not.toBe(imageHashes[0]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated));
    const restored = await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
    expect(restored.edges).toEqual(before.edges);
    expect(restored.nodes.map((node) => node.id)).toEqual(before.nodes.map((node) => node.id));
    await run('RELOADED Watercolor: a lighthouse at night');
    if (nativeImage) expect(imageHashes[2]).toBe(imageHashes[1]);
    if (modelSwitches) {
      // A real native → native → ordinary whole-pipeline → native round trip.
      // Only the initial graph uses factories; every replacement below is the
      // rendered model picker and its atomic impact review.
      for (const [repository, pipeline] of [
        ['black-forest-labs/FLUX.2-klein-4B', 'Flux2KleinModularPipeline'],
        ['black-forest-labs/FLUX.1-schnell', 'FluxPipeline'],
        ['Tongyi-MAI/Z-Image-Turbo', 'ZImageModularPipeline'],
      ]) {
        await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
        let signature = '';
        let stable = 0;
        await expect
          .poll(
            async () => {
              const current = await page.evaluate(() => JSON.stringify(window.__MODIFF_E2E__!.exportWorkflowGraph()));
              stable = current === signature ? stable + 1 : 0;
              signature = current;
              return stable;
            },
            { timeout: 15_000, intervals: [100, 250, 500] },
          )
          .toBeGreaterThanOrEqual(3);
        const owner = await page.evaluate(
          () =>
            window
              .__MODIFF_E2E__!.exportWorkflowGraph()
              .nodes.find(
                (node) => node.data.operationAuthoring && ['ModelsLoader', 'LoadPipeline'].includes(node.data.action),
              )?.id,
        );
        expect(owner).toBeTruthy();
        await page
          .locator(`.react-flow__node[data-id="${owner}"]`)
          .getByRole('button', { name: 'Choose model', exact: true })
          .click();
        const picker = page.getByRole('dialog', { name: 'Choose model for Load Models', exact: true });
        await picker.getByRole('searchbox', { name: 'Search compatible models' }).fill(repository);
        await picker.getByRole('button').filter({ hasText: repository }).click();
        await expect(picker.getByTestId('model-selection-review')).toBeVisible({ timeout: 60_000 });
        await picker.getByRole('button', { name: 'Apply model change', exact: true }).click();
        await expect(picker).toHaveCount(0);
        const changed = await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
        await writeFile(resolve(output, `switch-${pipeline}.workflow.json`), JSON.stringify(changed, null, 2));
        expect(changed.nodes.some((node) => node.id === ids.custom)).toBe(true);
        expect(changed.nodes.some((node) => node.id === nativePreview)).toBe(true);
        expect(changed.nodes.some((node) => node.data.operationAuthoring?.operation.pipelineClass === pipeline)).toBe(
          true,
        );
        expect(changed.edges.some((edge) => edge.source === ids.custom && edge.target !== ids.exported)).toBe(true);
        receipts.push({ operation: 'browser model switch', repository, pipeline });
        await run('RELOADED Watercolor: a lighthouse at night');
      }
      const returned = await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
      expect(returned.nodes.map((node) => node.id).sort()).toEqual(before.nodes.map((node) => node.id).sort());
      expect(imageHashes.at(-1)).toBe(imageHashes[2]);
    }
    await page.screenshot({ path: resolve(output, 'restored.png'), fullPage: true });
  } finally {
    if (staged) {
      const disabled = await page.request.post(`/custom_modules/${name}/disable`, { data: {}, timeout: 15_000 });
      receipts.push({ operation: 'disable own copy', status: disabled.status(), response: await disabled.json() });
    }
    await writeFile(
      resolve(output, 'receipt.json'),
      JSON.stringify(
        {
          name,
          modelSwitches,
          proofLevel: nativeImage
            ? 'live_browser_custom_lifecycle_with_native_image'
            : 'live_browser_custom_lifecycle_without_model',
          receipts,
          network,
        },
        null,
        2,
      ),
    );
  }
});
