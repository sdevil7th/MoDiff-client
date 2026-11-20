import { expect, test, type Locator, type Page } from '@playwright/test';
import { connect, ready, save } from './qwenDemoGestures';

const graph = (page: Page) => page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const handle = (card: Locator, direction: 'source' | 'target', field: string) =>
  card.locator(`.react-flow__handle.${direction}[data-handleid="${field}"]`);
const optionField = (card: Locator, field: string) =>
  card.locator(`[data-key="${field}"] button[aria-haspopup="listbox"]`);

async function add(page: Page, name: string) {
  const search = page.getByLabel('Search nodes', { exact: true });
  await search.fill(name);
  const previous = new Set((await graph(page)).nodes.map(({ id }) => id));
  await page.getByTestId(`node-row-${name.replace(/\./gu, '-')}`).click();
  const after = await graph(page);
  const added = after.nodes.find(({ id, data }) => !previous.has(id) && `${data.module}.${data.action}` === name);
  expect(added).toBeDefined();
  return added!.id;
}

async function arrange(page: Page) {
  await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
}

async function choose(page: Page, card: Locator, field: string, option: string) {
  await optionField(card, field).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function expectMode(card: Locator, mode: string) {
  await expect(card.locator('[data-key="mode"]')).toContainText(mode);
}

async function expectLink(page: Page, source: string, sourceHandle: string, target: string, targetHandle: string) {
  await expect
    .poll(async () => (await graph(page)).edges)
    .toContainEqual(expect.objectContaining({ source, sourceHandle, target, targetHandle }));
}

async function importSdxlStages(page: Page, guidance = false, olderContract = false) {
  // Import the registered starter's exact model binding without creating its
  // unrelated output stages. The Preview connection is authored natively.
  const fixture = await page.evaluate(
    async ({ guidance, olderContract }) => {
      const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
      const { requestOperationStarter } = await import('/src/workflow/operationStarterRequest.ts');
      const { createOperationStarter } = await import('/src/workflow/operationAuthoring.ts');
      const { operationContracts } = useNodesStore.getState();
      const starter = await requestOperationStarter(
        'StableDiffusionXLModularPipeline',
        'text_to_image',
        operationContracts,
        undefined,
        guidance ? 'sdxl-pag:modular' : undefined,
      );
      const draft = createOperationStarter(starter, { x: 30, y: 80 });
      const loader = draft.nodes.find(({ data }) => data.action === 'ModelsLoader');
      const denoise = draft.nodes.find(({ data }) => data.action === 'Denoise');
      if (!loader || !denoise) throw new Error('The reviewed SDXL starter has a different denoise binding.');
      const visible = new Set(guidance ? ['ModelsLoader', 'Denoise', 'Guider', 'Layers'] : ['ModelsLoader', 'Denoise']);
      const nodes = draft.nodes.filter(({ data }) => visible.has(data.action));
      if (olderContract) {
        const context = nodes.find(({ data }) => data.action === 'Guider')?.data.params.guider_out;
        if (context) delete context.fieldOptions;
      }
      const ids = new Set(nodes.map(({ id }) => id));
      const edges = draft.edges.filter(
        ({ source, target, targetHandle }) => ids.has(source) && ids.has(target) && targetHandle !== 'layers_config',
      );
      return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } };
    },
    { guidance, olderContract },
  );
  const transfer = await page.evaluateHandle((draft) => {
    const data = new DataTransfer();
    data.items.add(new File([JSON.stringify(draft)], 'Reviewed SDXL sockets.json', { type: 'application/json' }));
    return data;
  }, fixture);
  await page.locator('.react-flow').dispatchEvent('drop', { dataTransfer: transfer });
  const ids = Object.fromEntries(fixture.nodes.map(({ data, id }) => [data.action, id]));
  await expectLink(page, ids.ModelsLoader!, 'unet_out', ids.Denoise!, 'unet');
  return ids;
}

const blockedExecutionRequests = new WeakMap<Page, string[]>();
const rejectedFieldActions = new WeakMap<Page, string[]>();

test.afterEach(({ page }) => {
  const blocked = blockedExecutionRequests.get(page);
  if (blocked) expect(blocked).toEqual([]);
  const rejected = rejectedFieldActions.get(page);
  if (rejected) expect(rejected).toEqual([]);
});

test.beforeEach(async ({ page }) => {
  test.skip(process.env.MODIFF_NODE_UX_ISOLATED !== '1', 'Requires an isolated live backend');
  page.setDefaultTimeout(20_000);
  const forbidden: string[] = [];
  const rejected: string[] = [];
  rejectedFieldActions.set(page, rejected);
  page.on('response', (response) => {
    if (!response.ok() && new URL(response.url()).pathname === '/fields/action') {
      const { module, action, fn } = response.request().postDataJSON();
      rejected.push(`${module}.${action}.${fn} (${response.status()})`);
    }
  });
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /^\/(?:graph|hf_download|execute)(?:\/|$)/u.test(new URL(request.url()).pathname)
    )
      forbidden.push(request.url());
  });
  await page.route(/\/(?:graph|hf_download|execute)(?:\/|$)/u, (route) =>
    route.request().method() === 'POST' ? route.abort() : route.continue(),
  );
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto('/', { waitUntil: 'commit', timeout: 60_000 });
  await ready(page);
  await page.waitForFunction(() => window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated);
  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
  if (!(await page.getByLabel('Search nodes', { exact: true }).isVisible()))
    await page.getByTestId('left-tab-nodes').click();
  await page.getByRole('checkbox', { name: 'Show implementation nodes', exact: true }).check();
  blockedExecutionRequests.set(page, forbidden);
});

test('Wan loader wiring updates conditional native video stage controls', async ({ page }) => {
  const loaderId = await add(page, 'modules.DiffusersVideo.LoadPipeline');
  const encodeId = await add(page, 'modules.DiffusersVideo.EncodeInputs');
  const denoiseId = await add(page, 'modules.DiffusersVideo.Denoise');
  const loader = node(page, loaderId);
  const encode = node(page, encodeId);
  const denoise = node(page, denoiseId);
  await arrange(page);
  await expectMode(encode, 'text_to_video');
  await expect(handle(encode, 'target', 'reference_images')).toBeHidden();
  await choose(page, loader, 'pipeline_class', 'WanImageToVideoPipeline');
  const source = handle(loader, 'source', 'pipeline');
  await connect(page, source, handle(encode, 'target', 'pipeline'));
  await expectLink(page, loaderId, 'pipeline', encodeId, 'pipeline');
  await expectMode(encode, 'image_to_video');
  await expect(handle(encode, 'target', 'reference_images')).toBeVisible();
  await expect(handle(encode, 'target', 'last_image')).toBeVisible();
  await expect(handle(encode, 'target', 'video')).toBeHidden();
  await connect(page, source, handle(denoise, 'target', 'pipeline'));
  await expectLink(page, loaderId, 'pipeline', denoiseId, 'pipeline');
  await expectMode(denoise, 'image_to_video');
  await connect(page, handle(encode, 'source', 'encoded_inputs'), handle(denoise, 'target', 'encoded_inputs'));
  await expectLink(page, encodeId, 'encoded_inputs', denoiseId, 'encoded_inputs');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await graph(page)).edges).toHaveLength(2);
  await page.keyboard.press('Control+Shift+z');
  await expectLink(page, encodeId, 'encoded_inputs', denoiseId, 'encoded_inputs');
  const imageId = await add(page, 'modules.Image.Load');
  await arrange(page);
  await connect(page, handle(node(page, imageId), 'source', 'image'), handle(encode, 'target', 'reference_images'));
  await expectLink(page, imageId, 'image', encodeId, 'reference_images');
  // The isolated worker can author the same graph on CPU. Its execution-plan
  // export requires explicit agreement between device, switch, and mode.
  await choose(page, loader, 'offload_mode', 'Off');
  const autoOffload = loader.getByRole('switch', { name: 'Auto offload', exact: true });
  if ((await autoOffload.getAttribute('aria-checked')) === 'true') await autoOffload.click();
  const api = await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
  expect(api.nodes[loaderId]?.params.offload_mode?.value).toBe('none');
  expect(api.nodes[encodeId]?.params.mode?.value).toBe('image_to_video');
  expect(api.nodes[denoiseId]?.params.mode?.value).toBe('image_to_video');
  await save(page, 'Wan conditional sockets');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await expectMode(encode, 'image_to_video');
  await expectMode(denoise, 'image_to_video');
  await expect(handle(encode, 'target', 'reference_images')).toBeVisible();
  const restored = await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
  expect(restored.nodes).toEqual(api.nodes);
  expect(restored.paths).toEqual(api.paths);
  await page.screenshot({ path: test.info().outputPath('wan-conditional-wiring.png') });
});

test('video Generate follows its adapter and Sequence rejects an image-only loader', async ({ page }) => {
  const loaderId = await add(page, 'modules.DiffusersVideo.LoadPipeline');
  const generateId = await add(page, 'modules.DiffusersVideo.Generate');
  const sequenceId = await add(page, 'modules.DiffusersVideo.GenerateSequence');
  const loader = node(page, loaderId);
  const generate = node(page, generateId);
  const sequence = node(page, sequenceId);
  const source = handle(loader, 'source', 'pipeline');
  await arrange(page);
  await choose(page, loader, 'pipeline_class', 'WanImageToVideoPipeline');
  await connect(page, source, handle(generate, 'target', 'pipeline'));
  await expectLink(page, loaderId, 'pipeline', generateId, 'pipeline');
  await expectMode(generate, 'image_to_video');
  await expect(handle(generate, 'target', 'reference_images')).toBeVisible();
  await expect(handle(generate, 'target', 'video')).toBeHidden();
  await connect(page, source, handle(sequence, 'target', 'pipeline'));
  await expect.poll(async () => (await graph(page)).edges).toHaveLength(1);
  await page.keyboard.press('Escape');
  await page.locator('.react-flow__pane').click({ position: { x: 50, y: 50 } });
  await expect(page.getByTestId('selection-toolbar')).toBeHidden();
  await choose(page, loader, 'pipeline_class', 'WanPipeline');
  await expectMode(generate, 'text_to_video');
  await expect(handle(generate, 'target', 'reference_images')).toBeHidden();
  await arrange(page);
  await connect(page, source, handle(sequence, 'target', 'pipeline'));
  await expectLink(page, loaderId, 'pipeline', sequenceId, 'pipeline');
  await expectMode(sequence, 'text_to_video');
  await expect(handle(sequence, 'source', 'clips')).toBeVisible();
  await expect(handle(sequence, 'target', 'reference_images')).toBeHidden();
  await expect(handle(sequence, 'target', 'video')).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('video-generate-sequence.png') });
});

test('Image Preview discloses VAE and device only for connected latents', async ({ page }) => {
  const { Denoise: denoiseId } = await importSdxlStages(page);
  if (!denoiseId) throw new Error('The SDXL starter has no Denoise stage.');
  const previewId = await add(page, 'modules.Image.Preview');
  const denoise = node(page, denoiseId);
  const preview = node(page, previewId);
  await arrange(page);
  const vae = handle(preview, 'target', 'vae');
  await expect(vae).toBeHidden();
  await expect(preview.locator('[data-key="device"]')).toBeHidden();
  const latents = handle(denoise, 'source', 'latents_preview');
  await expect(latents).toBeVisible();
  await arrange(page);
  await connect(page, latents, handle(preview, 'target', 'image'));
  await expectLink(page, denoiseId, 'latents_preview', previewId, 'image');
  await expect(vae).toBeVisible();
  await expect(preview.locator('[data-key="device"]')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(vae).toBeHidden();
  await page.keyboard.press('Control+Shift+z');
  await expect(vae).toBeVisible();
  await expectLink(page, denoiseId, 'latents_preview', previewId, 'image');
  await page.screenshot({ path: test.info().outputPath('image-preview-latent.png') });
});

test('reviewed SDXL Guider reveals and wires the Layers input for layer guidance', async ({ page }) => {
  const {
    ModelsLoader: loaderId,
    Denoise: denoiseId,
    Guider: guiderId,
    Layers: layersId,
  } = await importSdxlStages(page, true);
  if (!loaderId || !denoiseId || !guiderId || !layersId) throw new Error('The reviewed PAG recipe is incomplete.');
  const guider = node(page, guiderId);
  const layers = node(page, layersId);
  const target = handle(guider, 'target', 'layers_config');
  await expectLink(page, guiderId, 'guider_out', denoiseId, 'guider');
  const modelType = () =>
    page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return useFlowStore.getState().getParam(id, 'model_type', 'value');
    }, guiderId);
  expect(await modelType()).toBe('StableDiffusionXLModularPipeline');
  await arrange(page);
  await expect(target).toBeVisible();
  await expect(guider.locator('[data-key="perturbed_guidance_scale"]')).toBeVisible();
  await choose(page, guider, 'guider', 'ClassifierFreeGuidance');
  await expect(target).toBeHidden();
  await expect(guider.locator('[data-key="perturbed_guidance_scale"]')).toBeHidden();
  await choose(page, guider, 'guider', 'Perturbed Attention Guidance');
  await expect(target).toBeVisible();
  await expect(guider.locator('[data-key="perturbed_guidance_scale"]')).toBeVisible();
  await arrange(page);
  await connect(page, handle(layers, 'source', 'layers_config'), target);
  await expectLink(page, layersId, 'layers_config', guiderId, 'layers_config');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await graph(page)).edges.some(({ source }) => source === layersId)).toBe(false);
  expect(await modelType()).toBe('StableDiffusionXLModularPipeline');
  await page.keyboard.press('Control+Shift+z');
  await expectLink(page, layersId, 'layers_config', guiderId, 'layers_config');
  await page.screenshot({ path: test.info().outputPath('guider-layers-wiring.png') });
});

test('adding Guider before model wiring has no metadata error', async ({ page }) => {
  const reply = page.waitForResponse((response) => {
    const request = response.request();
    if (request.method() !== 'POST' || new URL(response.url()).pathname !== '/fields/action') return false;
    const { action, fn } = request.postDataJSON();
    return action === 'Guider' && fn === 'updateNode';
  });
  const guiderId = await add(page, 'modules.ModularDiffusers.Guider');
  await expect(node(page, guiderId)).toBeVisible();
  expect((await graph(page)).edges).toHaveLength(0);
  expect((await reply).status()).toBe(200);
  await expect(handle(node(page, guiderId), 'target', 'layers_config')).toBeHidden();
});

test('disconnecting Guider model context preserves authored guidance across Undo and reload', async ({ page }) => {
  const { Denoise: denoiseId, Guider: guiderId, Layers: layersId } = await importSdxlStages(page, true, true);
  if (!denoiseId || !guiderId || !layersId) throw new Error('The reviewed PAG recipe is incomplete.');
  const guider = node(page, guiderId);
  const denoise = node(page, denoiseId);
  const layers = node(page, layersId);
  const layerInput = handle(guider, 'target', 'layers_config');
  const scale = guider.locator('[data-key="perturbed_guidance_scale"] input');
  const note = 'Connect Guider to a reviewed Denoise model to edit model-specific guidance.';
  const inspector = page.getByTestId('studio-custom-graph-inspector');
  const fields = async () => (await graph(page)).nodes.find(({ id }) => id === guiderId)?.data.params;
  const modelEdge = (await graph(page)).edges.find(
    ({ source, sourceHandle, target, targetHandle }) =>
      source === guiderId && sourceHandle === 'guider_out' && target === denoiseId && targetHandle === 'guider',
  );
  if (!modelEdge) throw new Error('The model-context edge is missing from the reviewed recipe.');
  const removeModelEdge = async () => {
    const edge = page.locator(`.react-flow__edge[data-id="${modelEdge.id}"]`);
    await edge.dispatchEvent('click');
    await expect(edge).toHaveClass(/selected/);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await graph(page)).edges.some(({ id }) => id === modelEdge.id)).toBe(false);
    await expect(guider.getByText(note, { exact: true })).toBeVisible();
    await expect(scale).toBeHidden();
  };

  await arrange(page);
  await expect(layerInput).toBeVisible();
  await scale.fill('4.2');
  await scale.press('Enter');
  await expect.poll(async () => (await fields())?.perturbed_guidance_scale?.value).toBe(4.2);
  await removeModelEdge();
  await expect(layerInput).toBeHidden();
  await page.keyboard.press('Control+z');
  await expectLink(page, guiderId, 'guider_out', denoiseId, 'guider');
  await expect(scale).toBeVisible();
  await expect(scale).toHaveValue('4.2');
  await arrange(page);
  await connect(page, handle(layers, 'source', 'layers_config'), layerInput);
  await expectLink(page, layersId, 'layers_config', guiderId, 'layers_config');
  await removeModelEdge();
  await expect(layerInput).toBeVisible();
  await expectLink(page, layersId, 'layers_config', guiderId, 'layers_config');
  await expect.poll(async () => (await fields())?.guider_out?.signal?.value).toBeUndefined();

  await guider.click({ position: { x: 45, y: 20 } });
  await expect(inspector.getByText(note, { exact: true })).toBeVisible();
  await expect(inspector.locator('[data-key="perturbed_guidance_scale"] input')).toBeHidden();
  await inspector.getByRole('tab', { name: 'Interface', exact: true }).click();
  await expect(inspector.getByText('Socket: layers_config', { exact: true })).toBeVisible();
  await expect(inspector.getByText(note, { exact: true })).toBeVisible();
  await expect(inspector.getByText(`From ${layersId}.layers_config`, { exact: true })).toBeVisible();

  await save(page, 'Disconnected guidance settings');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await expect(guider.getByText(note, { exact: true })).toBeVisible();
  await expect(scale).toBeHidden();
  await expect(layerInput).toBeVisible();
  await expectLink(page, layersId, 'layers_config', guiderId, 'layers_config');
  await expect.poll(async () => (await fields())?.perturbed_guidance_scale?.value).toBe(4.2);
  await expect.poll(async () => (await fields())?.guider?.value).toBe('PerturbedAttentionGuidance');

  await arrange(page);
  await connect(page, handle(guider, 'source', 'guider_out'), handle(denoise, 'target', 'guider'));
  await expectLink(page, guiderId, 'guider_out', denoiseId, 'guider');
  await expect(scale).toBeVisible();
  await expect(scale).toHaveValue('4.2');
  await expect(guider.getByText(note)).toBeHidden();
});

test('LTX 2.5 conditioned AV starter preserves typed image, video and audio wiring after save', async ({ page }) => {
  const fixture = await page.evaluate(async () => {
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const { requestOperationStarter } = await import('/src/workflow/operationStarterRequest.ts');
    const { createOperationStarter } = await import('/src/workflow/operationAuthoring.ts');
    const { operationContracts } = useNodesStore.getState();
    const starter = await requestOperationStarter(
      'LTX25FullPipeline',
      'image_to_video_with_audio',
      operationContracts,
      undefined,
      'ltx25-full-av:direct',
    );
    const draft = createOperationStarter(starter, { x: 30, y: 80 });
    const loader = draft.nodes.find(
      ({ data }) => data.module === 'modules.DiffusersVideo' && data.action === 'LoadPipeline',
    );
    const generate = draft.nodes.find(
      ({ data }) => data.module === 'modules.DiffusersVideo' && data.action === 'GenerateVideoAudio',
    );
    if (!loader || !generate) throw new Error('The reviewed LTX 2.5 starter has a different generating route.');
    const nodes = [loader, generate];
    const ids = new Set(nodes.map(({ id }) => id));
    const edges = draft.edges.filter(({ source, target }) => ids.has(source) && ids.has(target));
    return {
      nodes,
      edges,
      loaderId: loader.id,
      avId: generate.id,
      viewport: { x: 0, y: 0, zoom: 1 },
    };
  });
  const transfer = await page.evaluateHandle(
    (draft) => {
      const data = new DataTransfer();
      data.items.add(new File([JSON.stringify(draft)], 'LTX 2.5 conditioned AV.json', { type: 'application/json' }));
      return data;
    },
    { nodes: fixture.nodes, edges: fixture.edges, viewport: fixture.viewport },
  );
  await page.locator('.react-flow').dispatchEvent('drop', { dataTransfer: transfer });
  const loader = node(page, fixture.loaderId);
  const av = node(page, fixture.avId);
  await expectLink(page, fixture.loaderId, 'pipeline', fixture.avId, 'pipeline');
  await expectMode(av, 'image_to_video_with_audio');
  const imageInput = handle(av, 'target', 'reference_images');
  await expect(imageInput).toBeVisible();
  await expect(imageInput).toHaveAttribute('data-connection-type', /\bimage\b/u);
  await expect(handle(av, 'target', 'video')).toBeHidden();
  await expect(handle(av, 'target', 'audio')).toHaveCount(0);
  const authoritativeNode = () => graph(page).then(({ nodes }) => nodes.find(({ id }) => id === fixture.avId));
  expect((await authoritativeNode())?.data.params.reference_images?.required).toBe(true);
  expect((await authoritativeNode())?.data.params.audio?.display).toBe('output');

  const imageId = await add(page, 'modules.Image.Load');
  const exportId = await add(page, 'modules.Video.ExportWithAudio');
  const image = handle(node(page, imageId), 'source', 'image');
  const exporter = node(page, exportId);
  const audioInput = handle(exporter, 'target', 'audio');
  const generatedAudio = handle(av, 'source', 'audio');
  const generatedVideo = handle(av, 'source', 'video_out');
  await expect(generatedAudio).toHaveAttribute('data-connection-type', 'audio');
  await expect(generatedVideo).toHaveAttribute('data-connection-type', 'video');
  await arrange(page);
  const original = (await graph(page)).edges;
  await connect(page, image, audioInput);
  await expect.poll(async () => (await graph(page)).edges).toEqual(original);
  await page.keyboard.press('Escape');
  await connect(page, image, imageInput);
  await expectLink(page, imageId, 'image', fixture.avId, 'reference_images');
  await connect(page, generatedAudio, audioInput);
  await expectLink(page, fixture.avId, 'audio', exportId, 'audio');
  await connect(page, generatedVideo, handle(exporter, 'target', 'video'));
  await expectLink(page, fixture.avId, 'video_out', exportId, 'video');

  // The test worker is CPU-only; apply its explicit compatible loading policy
  // through the editable controls without accepting model terms or running.
  await choose(page, loader, 'offload_mode', 'Off');
  const autoOffload = loader.getByRole('switch', { name: 'Auto offload', exact: true });
  if ((await autoOffload.getAttribute('aria-checked')) === 'true') await autoOffload.click();
  const api = () => page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
  const before = await api();
  expect(before.nodes[fixture.avId]?.params.mode?.value).toBe('image_to_video_with_audio');
  expect(before.nodes[fixture.avId]?.params.reference_images?.sourceId).toBe(imageId);
  expect(before.nodes[exportId]?.params.audio?.sourceKey).toBe('audio');
  expect(before.nodes[exportId]?.params.video?.sourceKey).toBe('video_out');
  await save(page, 'LTX 2.5 AV conditional sockets');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await expectMode(av, 'image_to_video_with_audio');
  await expect(imageInput).toBeVisible();
  const restored = await api();
  expect(restored.nodes).toEqual(before.nodes);
  expect(restored.paths).toEqual(before.paths);
  await page.screenshot({ path: test.info().outputPath('ltx-conditioned-av-wiring.png') });
});
