import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

async function ready(page: Page) {
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 120_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
}

async function geometry(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          const issues: string[] = [];
          for (const node of useFlowStore.getState().nodes) {
            if (!node.parentId || node.hidden) continue;
            const child = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`);
            const parent = document.querySelector<HTMLElement>(
              `.react-flow__node[data-id="${CSS.escape(node.parentId)}"]`,
            );
            if (!child || !parent) {
              issues.push(`Missing DOM: ${node.id}`);
              continue;
            }
            const c = child.getBoundingClientRect(),
              p = parent.getBoundingClientRect();
            const frame = parent.querySelector<HTMLElement>(`[data-testid="user-block-${CSS.escape(node.parentId)}"]`);
            const header = frame?.querySelector(':scope > header')?.getBoundingClientRect();
            const tray = frame
              ?.querySelector(`[data-testid="node-connector-tray-${CSS.escape(node.parentId)}"]`)
              ?.getBoundingClientRect();
            if (
              c.left < p.left - 2 ||
              c.right > p.right + 2 ||
              c.top < (header?.bottom ?? p.top) - 2 ||
              c.bottom > (tray?.top ?? p.bottom) + 2
            )
              issues.push(`${node.id} escapes ${node.parentId}`);
          }
          return issues;
        }),
      { timeout: 20_000 },
    )
    .toEqual([]);
}

test('a whole Qwen catalog Block drops inside a generic Block with editable controls, nested Run, save and reuse', async ({
  page,
}) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  const evidence = `${process.env.MODIFF_REVIEW_OUTPUT_DIR ?? 'artifacts'}/whole-block-nesting`;
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [],
    warnings: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.text().includes("[React Flow]: Couldn't create edge for")) warnings.push(message.text());
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('whole-block-nesting')) return;
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('whole-block-nesting', '1');
  });
  await page.goto('/');
  await ready(page);
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await page.getByTestId('workflow-tab-new').click();
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  // An ordinary generic host is test setup; catalog admission and the actual
  // drop, editing, disclosure, save and reusable-node dialog are real UI actions.
  await page.evaluate(async () => {
    const schema = await import('/src/studio/blockSchemaV2.ts');
    const runtime = await import('/src/studio/blockRuntimeV2.ts');
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useSettingsStore } = await import('/src/stores/useSettingsStore.ts');
    const graph = {
      nodes: [
        {
          nodeId: 'host-note',
          nodeType: 'custom',
          data: {
            type: 'custom',
            label: 'Unrelated host note',
            module: 'modules.Primitive',
            action: 'TextValue',
            params: {
              text: { type: 'string', display: 'textarea', value: 'Keep this host note unchanged' },
              output: { type: 'string', display: 'output' },
            },
          },
        },
      ],
      edges: [],
      graphHash: '',
    };
    graph.graphHash = schema.blockGraphHashV2(graph);
    const definition = {
      schemaVersion: 2 as const,
      definitionId: 'user:whole-nesting-host',
      displayName: 'Generic nesting host',
      contentHash: '',
      source: { kind: 'user' as const },
      graph,
      boundary: { mode: 'explicit' as const, inputs: [], outputs: [] },
      controls: [],
      previews: [],
      ownership: { kind: 'user' as const, definitionMutable: true },
    };
    definition.contentHash = schema.blockDefinitionContentHashV2(definition);
    const instance = schema.createBlockInstanceV2(definition, {
      instanceId: 'whole-nesting-host',
      position: { x: 40, y: 40 },
      size: { width: 950, height: 900 },
      internalLayoutMode: 'hierarchical',
      internalLayout: { 'host-note': { x: 32, y: 80, width: 320, height: 260 } },
    });
    useFlowStore.getState().addNode(runtime.createBlockRootNodeV2(instance));
    useSettingsStore.getState().setRightPanelOpen(false);
  });
  await page.getByTestId('user-block-toggle-whole-nesting-host').click();
  await page.getByTestId('arrange-graph').click();
  const search = page.getByLabel('Search nodes');
  if (!(await search.isVisible())) await page.getByTestId('left-tab-nodes').click();
  await search.fill('Qwen Image — Text To Image');
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true')
    await group.getByRole('button').first().click();
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image — Text To Image' });
  const host = page.getByTestId('user-block-whole-nesting-host');
  await expect(host).toBeVisible();
  const bounds = await host.boundingBox();
  if (!bounds) throw new Error('No host geometry');
  // Expanded frames intentionally pass pointer events through to the pane.
  // Drop on the real event recipient at a point inside the host's rectangle.
  const pane = page.locator('.react-flow__pane');
  const paneBounds = await pane.boundingBox();
  if (!paneBounds) throw new Error('No graph pane geometry');
  await row.dragTo(pane, {
    targetPosition: { x: bounds.x + bounds.width - 45 - paneBounds.x, y: bounds.y + 85 - paneBounds.y },
  });
  const inspect = () =>
    page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const state = useFlowStore.getState();
      const instance = state.nodes.find((node) => node.id === 'whole-nesting-host')!.data.blockInstanceV2!;
      const wrapper = instance.effectiveGraph.nodes.find((node) => node.nodeType === 'group' && !node.modularDiffusers);
      const projected = state.nodes.find((node) => node.data.blockProjectionNodeId === wrapper?.nodeId);
      return {
        instance,
        wrapper,
        projectedId: projected?.id,
        roots: state.nodes.filter((node) => node.data.blockInstanceV2).length,
        export: projected ? state.exportGraph('whole-nesting-proof', projected.id) : null,
      };
    });
  await expect
    .poll(async () => (await inspect()).wrapper?.data.label, { timeout: 60_000 })
    .toBe('Qwen Image — Text To Image');
  const inserted = await inspect();
  expect(inserted.roots).toBe(1);
  expect(inserted.instance.presentation.collapsedContainerNodeIds).toContain(inserted.wrapper!.nodeId);
  expect(inserted.wrapper!.containerInterface!.previews!.length).toBeGreaterThan(0);
  const nested = () => page.getByTestId(`user-block-${inserted.projectedId}`);
  const prompt =
    'An intricate cutaway model of a circular astronomical observatory at blue hour, with a copper dome, precision brass telescope, oak spiral staircase, star charts and warm lamps. A cream enamel sign reads NIGHTGARDEN. Coherent architectural perspective, tactile materials, balanced cinematic composition.';
  const promptField = nested().locator('textarea').first();
  await promptField.fill(prompt);
  await promptField.press('Tab');
  const changed = await inspect();
  expect(JSON.stringify(changed.export)).toContain(prompt);
  expect(JSON.stringify(changed.export)).not.toContain('Keep this host note unchanged');
  expect(changed.instance.effectiveGraph.nodes.find((node) => node.nodeId === 'host-note')!.data.params).toEqual(
    inserted.instance.effectiveGraph.nodes.find((node) => node.nodeId === 'host-note')!.data.params,
  );
  await nested().getByRole('button', { name: 'Expand Qwen Image — Text To Image', exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  await geometry(page);
  expect((await inspect()).export).toEqual(changed.export);
  const denoiseInputs = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const node = useFlowStore
      .getState()
      .nodes.find(
        (candidate) =>
          candidate.data.blockProjectionContainer && candidate.data.label === 'Qwen Image Auto Core Denoise Step',
      );
    if (!node) throw new Error('Missing nested denoiser');
    return Object.entries(node.data.blockProjectionPortBindings ?? {})
      .filter(([, binding]) => binding.direction === 'input')
      .map(([key]) => node.data.params[key]?.label);
  });
  expect(denoiseInputs.filter((label) => label === 'height')).toHaveLength(1);
  expect(denoiseInputs.filter((label) => label === 'width')).toHaveLength(1);
  expect(denoiseInputs.filter((label) => label === 'num inference steps')).toHaveLength(1);
  const encoderId = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore
      .getState()
      .nodes.find(
        (node) => node.data.blockProjectionContainer && node.data.label === 'Qwen Image Auto Text Encoder Step',
      )?.id;
  });
  expect(encoderId).toBeTruthy();
  const encoder = page.getByTestId(`user-block-${encoderId}`);
  const inheritedPrompt = encoder.locator('textarea').filter({ visible: true }).first();
  // Prompt, not just a description/port: the deeper collapsed Block is editable.
  await expect(inheritedPrompt).toHaveValue(prompt);
  await inheritedPrompt.fill(`${prompt} Fine engraved constellation markings.`);
  await inheritedPrompt.press('Tab');
  expect(JSON.stringify((await inspect()).export)).toContain(`${prompt} Fine engraved constellation markings.`);
  await inheritedPrompt.fill(prompt);
  await inheritedPrompt.press('Tab');
  expect((await inspect()).export).toEqual(changed.export);
  await page.screenshot({ path: `${evidence}/expanded-whole-cluster.png` });
  await nested().getByRole('button', { name: 'Collapse Qwen Image — Text To Image', exact: true }).click();
  await page.getByTestId('topbar-save-workflow').click();
  const save = page.getByTestId('save-workflow-dialog');
  if (await save.isVisible()) {
    await page.getByTestId('save-workflow-name').fill(`Whole Qwen nested Block ${Date.now()}`);
    await page.getByTestId('confirm-save-workflow').click();
    await expect(save).toHaveCount(0);
  }
  const beforeRefresh = await inspect();
  await page.reload();
  await ready(page);
  await expect(nested()).toBeVisible();
  const restored = await inspect();
  expect(restored.instance).toEqual(beforeRefresh.instance);
  expect(restored.export).toEqual(beforeRefresh.export);
  await expect(nested().locator('textarea').first()).toHaveValue(prompt);
  await nested().getByTestId(`projected-block-save-${inserted.projectedId}`).click();
  const choices = page.getByTestId(`save-user-block-choices-${inserted.projectedId}`);
  await expect(choices).toBeVisible();
  const response = page.waitForResponse((r) => r.url().endsWith('/studio/blocks') && r.request().method() === 'POST');
  await choices.getByRole('button', { name: 'Save as new User Node', exact: true }).click();
  const saved = await response;
  expect(saved.ok(), await saved.text()).toBe(true);
  await expect(choices).toHaveCount(0);
  expect((await inspect()).instance).toEqual(restored.instance);
  await page.screenshot({ path: `${evidence}/restored-whole-cluster.png` });
  await writeFile(`${evidence}/workflow-and-export.json`, JSON.stringify(await inspect(), null, 2));
  await writeFile(`${evidence}/saved-user-node-response.json`, await saved.text());

  // Real pointer reparenting must be one undoable gesture and cannot change
  // execution order, values or links merely because canvas ownership changed.
  await nested().getByRole('button', { name: 'Expand Qwen Image — Text To Image', exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  const entireGraph = () =>
    page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return useFlowStore.getState().exportGraph('whole-reparent-parity');
    });
  const beforeReparent = await entireGraph();
  const noteId = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore.getState().nodes.find((node) => node.data.blockProjectionNodeId === 'host-note')!.id;
  });
  const note = page.locator(`.react-flow__node[data-id="${noteId}"]`);
  const noteBounds = await note.boundingBox(),
    nestedBounds = await nested().boundingBox();
  if (!noteBounds || !nestedBounds) throw new Error('Missing reparent gesture geometry');
  await page.mouse.move(noteBounds.x + 45, noteBounds.y + 14);
  await page.mouse.down();
  await page.mouse.move(nestedBounds.x + nestedBounds.width * 0.6, nestedBounds.y + nestedBounds.height * 0.7, {
    steps: 18,
  });
  await page.mouse.up();
  const noteParent = async () =>
    (await inspect()).instance.effectiveGraph.nodes.find((node) => node.nodeId === 'host-note')?.parentNodeId;
  await expect.poll(noteParent).toBe(inserted.wrapper!.nodeId);
  expect(await entireGraph()).toEqual(beforeReparent);
  await page.keyboard.press('Control+z');
  await expect.poll(noteParent).toBeUndefined();
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(noteParent).toBe(inserted.wrapper!.nodeId);
  await page.keyboard.press('Control+z');
  await expect.poll(noteParent).toBeUndefined();
  expect(await entireGraph()).toEqual(beforeReparent);

  // A whole nested Block detaches through the normal drag gesture, retains
  // its edited fields, and is not implicitly registered in the User library.
  await nested().getByRole('button', { name: 'Collapse Qwen Image — Text To Image', exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  // Reserve real blank canvas outside the host. Arrange may zoom a compact
  // graph past the right edge; a pointer still inside that frame is not a
  // detach gesture.
  await expect(async () => {
    // React Flow owns its live viewport; wheel the actual pane rather than
    // changing only the saved/default viewport in the workflow store.
    await page.mouse.move(500, 150);
    await page.mouse.wheel(0, 500);
    const bounds = await host.boundingBox();
    expect(bounds?.width).toBeLessThan(1000);
    expect(bounds ? bounds.x + bounds.width : 1920).toBeLessThan(1650);
  }).toPass({ timeout: 10_000, intervals: [250, 500] });
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        let previous = '',
          stable = 0;
        const deadline = performance.now() + 5000;
        const check = () => {
          const current = document.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform ?? '';
          stable = current === previous ? stable + 1 : 0;
          previous = current;
          if (stable >= 12) resolve();
          else if (performance.now() > deadline) reject(new Error('Viewport did not settle before drag'));
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
  );
  const libraryWrites: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/studio/blocks') && request.method() === 'POST') libraryWrites.push(request.url());
  });
  const moving = await nested().locator(':scope > header').boundingBox(),
    owner = await host.boundingBox();
  if (!moving || !owner) throw new Error('Missing subtree detach geometry');
  await page.screenshot({ path: `${evidence}/before-subtree-detach.png` });
  await page.mouse.move(moving.x + Math.min(60, moving.width / 4), moving.y + moving.height / 2);
  await page.mouse.down();
  await page.mouse.move(Math.min(1890, owner.x + owner.width + 70), moving.y + 40, { steps: 20 });
  await page.mouse.up();
  const detachedState = () =>
    page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const roots = useFlowStore.getState().nodes.filter((node) => node.data.blockInstanceV2);
      return roots.map((node) => ({ id: node.id, instance: node.data.blockInstanceV2! }));
    });
  await expect.poll(async () => (await detachedState()).length).toBe(2);
  const detached = (await detachedState()).find((node) => node.id !== 'whole-nesting-host')!;
  expect(detached.instance.definitionSnapshot.source.kind).toBe('user');
  expect(JSON.stringify(detached.instance.effectiveGraph)).toContain(prompt);
  expect(
    (await detachedState()).find((node) => node.id === 'whole-nesting-host')!.instance.effectiveGraph.nodes,
  ).toHaveLength(1);
  expect(libraryWrites).toEqual([]);
  await page.getByTestId('arrange-graph').click();
  await page.getByTestId('topbar-save-workflow').click();
  const detachedBeforeRefresh = await detachedState();
  await page.reload();
  await ready(page);
  await expect.poll(detachedState).toEqual(detachedBeforeRefresh);
  await page.screenshot({ path: `${evidence}/detached-whole-cluster.png` });
  await writeFile(`${evidence}/detached-workflow.json`, JSON.stringify(detachedBeforeRefresh, null, 2));
  if (process.env.MODIFF_RUN_REJECTED_DRAG === '1') {
    // Moving a loader with undeclared crossing outputs is not a safe detach.
    // Exercise the real pointer failure, including the final position already
    // emitted by React Flow, and require the visible geometry to roll back.
    const detachedRoot = page.getByTestId(`user-block-${detached.id}`);
    await page.getByTestId(`user-block-toggle-${detached.id}`).click();
    const expandNested = page.getByRole('button', {
      name: 'Expand Qwen Image — Text To Image',
      exact: true,
    });
    if (await expandNested.isVisible().catch(() => false)) await expandNested.click();
    await page.getByTestId('arrange-graph').click();
    await expect(async () => {
      await page.mouse.move(500, 150);
      await page.mouse.wheel(0, 450);
      const bounds = await detachedRoot.boundingBox();
      expect(bounds ? bounds.x + bounds.width : 1920).toBeLessThan(1650);
    }).toPass({ timeout: 10_000, intervals: [250, 500] });
    const loaderId = await page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return useFlowStore
        .getState()
        .nodes.find((node) => node.data.blockProjectionOwnerId === id && node.data.action === 'ModelsLoader')!.id;
    }, detached.id);
    const loader = page.locator(`.react-flow__node[data-id="${loaderId}"]`);
    await expect(loader).toBeVisible();
    await geometry(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          let last = '',
            stableSince = performance.now();
          const deadline = performance.now() + 10_000;
          const check = () => {
            const transform = document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '';
            if (transform !== last) {
              last = transform;
              stableSince = performance.now();
            }
            if (performance.now() - stableSince > 500) resolve();
            else if (performance.now() > deadline) reject(new Error('Viewport did not settle before rejected drag'));
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        }),
    );
    const beforeRejected = await detachedState();
    const loaderBox = await loader.boundingBox(),
      rootBox = await detachedRoot.boundingBox();
    const loaderHeader = await loader.locator('header').first().boundingBox();
    if (!loaderBox || !rootBox) throw new Error('Missing rejected-drag geometry');
    if (!loaderHeader) throw new Error('Missing loader drag header');
    await page.mouse.move(loaderHeader.x + loaderHeader.width / 2, loaderHeader.y + loaderHeader.height / 2);
    await page.mouse.down();
    await page.mouse.move(Math.min(1890, rootBox.x + rootBox.width + 110), loaderBox.y + 30, { steps: 20 });
    await expect(loader).toHaveClass(/dragging/u);
    await page.mouse.up();
    await expect(
      page.getByText(/Cannot move .*Configure a public input for .*pipeline_components first/u),
    ).toBeVisible();
    await expect.poll(detachedState).toEqual(beforeRejected);
    await geometry(page);
    await page.screenshot({ path: `${evidence}/rejected-loader-detach-restored.png` });
    await page.getByTestId('topbar-save-workflow').click();
    await page.reload();
    await ready(page);
    await expect.poll(detachedState).toEqual(beforeRejected);
    await geometry(page);
  }
  expect(warnings).toEqual([]);
  expect(errors).toEqual([]);
});
