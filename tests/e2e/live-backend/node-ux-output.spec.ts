import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Bounded, opt-in acceptance, against the isolated backend only. Starter/media
// values are fixtures; attachment, Run, delivery and refresh use the real UI.
const output = process.env.MODIFF_NODE_UX_OUTPUT;
const image = process.env.MODIFF_NODE_UX_IMAGE;
const mask = process.env.MODIFF_NODE_UX_MASK;
const audio = process.env.MODIFF_NODE_UX_AUDIO;
const prompt =
  'A sophisticated fashion editorial photograph, an elegant woman in a deep red tailored coat walking through a rainy New York street at night, glowing shop windows, wet pavement reflections, cinematic realistic photography.';

test.beforeEach(async ({ page }) => {
  test.skip(process.env.MODIFF_NODE_UX_ISOLATED !== '1' || !output, 'Explicit isolated output acceptance only');
  test.setTimeout(12 * 60_000);
  page.setDefaultTimeout(20_000);
  await mkdir(output!, { recursive: true });
  const queue = await (await page.request.get('/queue')).json();
  expect(queue.current, 'Never overlap an existing task').toBeNull();
  expect(Object.keys(queue.queued)).toHaveLength(0);
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.goto('/');
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
});

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus || !output || page.isClosed()) return;
  // Persist failure details immediately; do not replay an already completed task.
  await writeFile(
    `${output}/failure-${info.testId.replace(/[^a-z0-9_-]/giu, '_')}.txt`,
    await page
      .locator('body')
      .innerText()
      .catch(() => 'Page closed'),
  );
});

async function attach(page: Page, owner: string, label: string) {
  await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
  await page.locator(`.react-flow__node[data-id="${owner}"] header`).first().click();
  await page.getByRole('button', { name: 'Inspect node', exact: true }).click();
  const inspector = page.getByRole('dialog', { name: 'Node inspector', exact: true });
  await inspector.getByRole('button', { name: 'Workflow stage actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add image / audio input…', exact: true }).click();
  const attachment = page.getByRole('dialog', { name: 'Add image / audio input', exact: true });
  await attachment.getByLabel('Media input role', { exact: true }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await attachment.getByRole('button', { name: 'Attach input', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        return useFlowStore
          .getState()
          .nodes.filter((n) => ['modules.Image', 'modules.Audio'].includes(n.data.module) && n.data.action === 'Load')
          .length;
      }),
    )
    .toBeGreaterThan(label.includes('mask') ? 1 : 0);
  if (await inspector.count()) await inspector.getByRole('button', { name: 'Close', exact: true }).click();
}

async function run(page: Page, name: string, displayType: 'image' | 'audio') {
  const submitted = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/graph' && r.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByTestId('studio-run').click();
  const terms = page.getByTestId('model-usage-terms-dialog');
  if (await terms.isVisible().catch(() => false)) await page.getByTestId('model-usage-terms-confirm').click();
  const response = await submitted;
  const admission = await response.json();
  const receipt: Record<string, unknown> = { admission, request: response.request().postDataJSON() };
  const save = () => writeFile(`${output}/${name}.json`, JSON.stringify(receipt, null, 2));
  await save();
  expect(response.ok(), JSON.stringify(admission)).toBe(true);
  const taskId = admission.task_id;
  console.log(`${name}: ${taskId}`);
  // No retries/replay. On timeout retain the exact task for manual inspection.
  await expect
    .poll(
      async () => {
        const queue = await (await page.request.get('/queue')).json();
        const task = [queue.current, ...Object.values(queue.queued), ...queue.recent].find(
          (t) => t?.task_id === taskId,
        );
        receipt.terminal = task;
        await save();
        return task?.status;
      },
      { timeout: 10 * 60_000, intervals: [3000, 5000] },
    )
    .toMatch(/^(completed|failed|cancelled)$/u);
  const details = await (await page.request.get(`/runs/${taskId}`)).json();
  receipt.run = details;
  await save();
  expect((receipt.terminal as { status: string }).status, JSON.stringify(details.error)).toBe('completed');
  const media = details.outputs
    .flatMap(
      (item: {
        backendProvenance?: {
          mediaItems?: Array<{ taskId: string; displayType: string; url: string; mediaHash: string }>;
        };
      }) => item.backendProvenance?.mediaItems ?? [],
    )
    .filter(
      (item: { taskId: string; displayType: string }) => item.taskId === taskId && item.displayType === displayType,
    );
  expect(media.length).toBeGreaterThan(0);
  for (const [index, item] of media.entries()) {
    const response = await page.request.get(item.url);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(`sha256:bytes:${createHash('sha256').update(bytes).digest('hex')}`).toBe(item.mediaHash);
    const mime = response.headers()['content-type']?.split(';')[0];
    const extension = (
      {
        'image/png': 'png',
        'image/webp': 'webp',
        'image/jpeg': 'jpg',
        'audio/wav': 'wav',
        'audio/x-wav': 'wav',
      } as Record<string, string>
    )[mime];
    expect(extension, `Unexpected output content type: ${mime}`).toBeTruthy();
    await writeFile(`${output}/${name}-${index}.${extension}`, bytes);
  }
  await page.screenshot({ path: `${output}/${name}.png` });
}

for (const route of ['native-image', 'standard-mask'] as const) {
  test(`${route}: attach declared inputs and deliver a real generated image`, async ({ page }) => {
    test.skip(!image || (route === 'standard-mask' && !mask), 'Provide existing backend image and mask identifiers');
    let customKey = '';
    if (route === 'standard-mask') {
      await page.getByTestId('left-tab-nodes').click();
      await page.getByRole('button', { name: 'Add custom node', exact: true }).click();
      const modal = page.getByRole('dialog', { name: 'Add custom node', exact: true });
      const name = `UXPalette_${Date.now()}`;
      const code = await readFile('../MoDiff/examples/custom_nodes/LightPaletteDirector/main.py', 'utf8');
      await modal.getByLabel('Choose Python node file').setInputFiles({
        name: `${name}.py`,
        mimeType: 'text/x-python',
        buffer: Buffer.from('MODIFF_RUNTIME_ROLE = "data"\n' + code),
      });
      await expect(modal.getByRole('status')).toContainText('Added and enabled');
      await modal.getByRole('button', { name: 'Close', exact: true }).click();
      customKey = `custom.${name}.LightPaletteDirector`;
    }
    const owner = await page.evaluate(
      async ({ route, prompt, customKey }) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
        const { requestOperationStarter } = await import('/src/workflow/operationStarterRequest.ts');
        const { createOperationStarter } = await import('/src/workflow/operationAuthoring.ts');
        const { prepareWorkflowForManualInsertion } = await import('/src/studio/manualGraphInsertion.ts');
        const { createNodeFromRegistry } = await import('/src/workflow/nodeFactory.ts');
        const starter = await requestOperationStarter(
          route === 'native-image' ? 'StableDiffusionXLModularPipeline' : 'StableDiffusionXLInpaintPipeline',
          route === 'native-image' ? 'text_to_image' : 'inpaint',
          useNodesStore.getState().operationContracts,
        );
        const graph = createOperationStarter(starter, { x: 40, y: 60 });
        for (const node of graph.nodes)
          for (const [key, value] of Object.entries({
            prompt,
            width: 512,
            height: 512,
            num_inference_steps: 16,
            guidance_scale: 6,
            strength: 0.85,
            seed: 61024,
          }))
            if (node.data.params[key]) node.data.params[key].value = value;
        if (customKey) {
          const custom = createNodeFromRegistry(customKey, useNodesStore.getState().nodesRegistry, {
            x: 1000,
            y: 600,
          })!;
          custom.data.params.strength.value = 0.25;
          const source = graph.nodes.find((n) => n.data.action === 'Inpaint')!;
          graph.nodes.push(custom);
          graph.edges.push({
            id: `custom-${source.id}`,
            source: source.id,
            sourceHandle: 'images',
            target: custom.id,
            targetHandle: 'image',
            type: 'default',
          });
        }
        prepareWorkflowForManualInsertion();
        useFlowStore.getState().replaceGraph(graph);
        return graph.nodes.find((n) => n.data.operationAuthoring?.operation.decomposition === 'loader')!.id;
      },
      { route, prompt, customKey },
    );
    await attach(page, owner, route === 'native-image' ? 'image to image · image' : 'inpaint · image');
    if (route === 'standard-mask') await attach(page, owner, 'inpaint · mask image');
    if (customKey)
      await expect
        .poll(() =>
          page.evaluate(async (key) => {
            const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
            const graph = useFlowStore.getState().toObject();
            const custom = graph.nodes.find((n) => `${n.data.module}.${n.data.action}` === key);
            return custom && graph.edges.some((e) => e.target === custom.id) && custom.data.params.strength.value;
          }, customKey),
        )
        .toBe(0.25);
    await page.evaluate(
      async ({ image, mask }) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
        const { createNodeFromRegistry } = await import('/src/workflow/nodeFactory.ts');
        const graph = useFlowStore.getState().toObject();
        for (const node of graph.nodes.filter((n) => n.data.module === 'modules.Image' && n.data.action === 'Load'))
          node.data.params.file.value = node.data.label === 'Load Mask' ? mask : image;
        const source =
          graph.nodes.find((n) => n.data.action === 'LightPaletteDirector') ??
          graph.nodes.find((n) => ['DecodeLatents', 'Inpaint'].includes(n.data.action))!;
        const handle = Object.entries(source.data.params).find(
          ([, p]) => p.display === 'output' && (Array.isArray(p.type) ? p.type : [p.type]).includes('image'),
        )![0];
        const preview = createNodeFromRegistry('modules.Image.Preview', useNodesStore.getState().nodesRegistry, {
          x: 1500,
          y: 600,
        })!;
        graph.nodes.push(preview);
        graph.edges.push({
          id: `preview-${source.id}`,
          source: source.id,
          sourceHandle: handle,
          target: preview.id,
          targetHandle: 'image',
          type: 'default',
        });
        useFlowStore.getState().replaceGraph(graph);
      },
      { image: image!, mask: mask ?? '' },
    );
    await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
    // These low-resolution acceptance settings are not a new Auto recipe.
    // Choose Custom explicitly, keeping the loader's actual offload settings.
    const automatic = page.getByRole('button', { name: 'Memory policy: Automatic. Click to switch.', exact: true });
    if (await automatic.count()) await automatic.click();
    await run(page, route, 'image');
  });
}

test('custom audio source transformation delivers a shorter faded clip', async ({ page }) => {
  test.skip(!audio, 'Provide an existing backend WAV identifier');
  await page.getByTestId('left-tab-nodes').click();
  await page.getByRole('button', { name: 'Add custom node', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Add custom node', exact: true });
  const name = `AudioEnvelope_${Date.now()}`;
  await modal.getByLabel('Choose Python node file').setInputFiles({
    name: `${name}.py`,
    mimeType: 'text/x-python',
    buffer: await readFile('../MoDiff/examples/custom_nodes/AudioEnvelope.py'),
  });
  await expect(modal.getByRole('status')).toContainText('Added and enabled');
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(async (file) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const { createNodeFromRegistry } = await import('/src/workflow/nodeFactory.ts');
    const { prepareWorkflowForManualInsertion } = await import('/src/studio/manualGraphInsertion.ts');
    const registry = useNodesStore.getState().nodesRegistry;
    const customKey = Object.keys(registry)
      .filter((key) => key.startsWith('custom.AudioEnvelope_') && key.endsWith('.AudioEnvelope'))
      .sort()
      .at(-1)!;
    const nodes = ['modules.Audio.Load', customKey, 'modules.Audio.Preview'].map((key, i) =>
      createNodeFromRegistry(key, registry, { x: i * 420, y: 80 })!,
    );
    nodes[0].data.params.file.value = file;
    nodes[1].data.params.start_seconds.value = 1;
    nodes[1].data.params.duration_seconds.value = 3;
    nodes[1].data.params.gain_db.value = -6;
    nodes[1].data.params.fade_seconds.value = 0.5;
    const edges = nodes.slice(1).map((node, i) => ({
      id: `audio-${i}`,
      source: nodes[i].id,
      sourceHandle: i === 0 ? 'audio' : 'output',
      target: node.id,
      targetHandle: 'audio',
      type: 'default',
    }));
    prepareWorkflowForManualInsertion();
    useFlowStore.getState().replaceGraph({ nodes, edges });
  }, audio!);
  await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
  await run(page, 'audio-transform', 'audio');
});
