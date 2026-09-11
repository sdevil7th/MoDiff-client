import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { CustomNodeType } from '../../../src/stores/useFlowStore';
import type { Edge } from '@xyflow/react';

const profiles = new Map<Page, { session: CDPSession; diagnostics: Array<{ at: number; message: string }> }>();
test.afterEach(async ({ page }) => {
  const profile = profiles.get(page);
  if (!profile) return;
  profiles.delete(page);
  const directory = `${process.env.MODIFF_REVIEW_OUTPUT_DIR ?? 'artifacts'}/nested-connection-profile`;
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/browser-diagnostics.json`, JSON.stringify(profile.diagnostics, null, 2));
  const result = await profile.session.send('Profiler.stop').catch(() => null);
  if (result) await writeFile(`${directory}/browser.cpuprofile`, JSON.stringify(result.profile));
});

async function workspaceReady(page: Page) {
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
}

async function snapshot(page: Page) {
  const started = Date.now();
  const result = await page.evaluate(() => {
    const state = window.__MODIFF_E2E__!.getState() as {
      flow: {
        nodes: Array<{
          id: string;
          blockInstanceV2?: CustomNodeType['data']['blockInstanceV2'];
          blockProjectionOwnerId?: string;
          blockProjectionNodeId?: string;
          blockProjectionPortBindings?: CustomNodeType['data']['blockProjectionPortBindings'];
          params: CustomNodeType['data']['params'];
        }>;
        edges: Edge[];
      };
    };
    const root = state.flow.nodes.find(
      (node) => node.blockInstanceV2?.definitionSnapshot.source.pipelineClass === 'QwenImageModularPipeline',
    );
    if (!root?.blockInstanceV2) throw new Error('Missing test Qwen Block');
    return {
      instance: root.blockInstanceV2,
      nodes: state.flow.nodes
        .filter((node) => node.blockProjectionOwnerId === root.id)
        .map((node) => ({
          id: node.id,
          semanticId: node.blockProjectionNodeId,
          bindings: node.blockProjectionPortBindings ?? {},
          params: node.params,
        })),
      edges: state.flow.edges,
    };
  });
  if (process.env.MODIFF_PROFILE_NESTED_CONNECTIONS === '1')
    console.log(`[nested-connection] snapshot ${Date.now() - started} ms`);
  return result;
}

async function socket(
  page: Page,
  containerId: string,
  semanticId: string,
  field: string,
  direction: 'input' | 'output',
) {
  const current = await snapshot(page);
  const node = current.nodes.find((node) => node.semanticId === containerId);
  if (!node) throw new Error(`Missing visible ${containerId}`);
  const handle = Object.entries(node.bindings).find(
    ([, endpoint]) =>
      endpoint.nodeId === semanticId && endpoint.fieldOrPortId === field && endpoint.direction === direction,
  )?.[0];
  if (!handle) throw new Error(`Missing ${containerId} socket for ${semanticId}.${field}`);
  return page.getByTestId(`node-handle-${node.id}-${handle}`);
}

async function dragWire(page: Page, source: Locator, target: Locator) {
  const point = async (locator: Locator) => {
    await expect(locator).toBeVisible();
    return locator.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y);
      if (hit !== element && (!hit || !element.contains(hit)))
        throw new Error('Socket is obscured, not pointer reachable');
      return point;
    });
  };
  const from = await point(source);
  const to = await point(target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 18 });
  await page.waitForTimeout(120);
  await page.mouse.up();
}

test('Qwen nested connection replacement uses exact leaf identity through collapsed and expanded sockets', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const started = Date.now();
  const checkpoint = (label: string) => console.log(`[nested-connection] ${label}: ${Date.now() - started} ms`);
  const diagnostics: Array<{ at: number; message: string }> = [];
  page.on('console', (message) => {
    if (/ResizeObserver|Maximum update|Error|error/iu.test(message.text()))
      diagnostics.push({ at: Date.now() - started, message: message.text().slice(0, 1000) });
  });
  const profiling = process.env.MODIFF_PROFILE_NESTED_CONNECTIONS === '1';
  const profiler = profiling ? await page.context().newCDPSession(page) : null;
  if (profiler) {
    await profiler.send('Profiler.enable');
    await profiler.send('Profiler.setSamplingInterval', { interval: 5000 });
    await profiler.send('Profiler.start');
    profiles.set(page, { session: profiler, diagnostics });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('nested-connection-test')) return;
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('nested-connection-test', '1');
  });
  await page.goto('/');
  await workspaceReady(page);
  // This dismisses notifications only in this browser session; saved runs and
  // their media remain available in Gallery and history.
  const dismissNotifications = page.getByTitle('Clear finished notifications', { exact: true });
  checkpoint('workspace ready');
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  if (await dismissNotifications.isVisible()) await dismissNotifications.click();
  await page.getByTestId('workflow-tab-new').click();
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  const search = page.getByLabel('Search nodes');
  if (!(await search.isVisible())) await page.getByTestId('left-tab-nodes').click();
  await search.fill('Qwen Image — Text To Image');
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true')
    await group.getByRole('button').first().click();
  await group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image — Text To Image' })
    .click();
  const root = page
    .locator('[data-block-source="diffusers_catalog"]')
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(root).toHaveCount(1, { timeout: 30_000 });
  checkpoint('root inserted');
  await root.getByLabel('Expand block', { exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  const original = (await snapshot(page)).instance;
  await expect
    .poll(async () => (await snapshot(page)).nodes.some((node) => node.semanticId === 'container:denoise'))
    .toBe(true);
  const denoiser = (await snapshot(page)).nodes.find((node) => node.semanticId === 'container:denoise')!;
  const heightSockets = Object.entries(denoiser.bindings).filter(([, endpoint]) => endpoint.fieldOrPortId === 'height');
  expect(heightSockets).toHaveLength(1);
  const expectedHeightConsumers = original.effectiveInterface.boundary.inputs
    .flatMap((port) => [port.binding, ...(port.mirrorBindings ?? [])])
    .filter((binding) => binding.nodeId.startsWith('upstream:denoise.') && binding.fieldOrPortId === 'height');
  expect(
    heightSockets
      .flatMap(([, binding]) => [binding, ...(binding.mirrorBindings ?? [])])
      .map(({ nodeId }) => nodeId)
      .sort(),
  ).toEqual(expectedHeightConsumers.map(({ nodeId }) => nodeId).sort());
  const labels = heightSockets.map(([handle]) => denoiser.params[handle].label);
  expect(new Set(labels).size).toBe(labels.length);
  for (const [handle, endpoint] of heightSockets) {
    const visibleHandle = page.getByTestId(`node-handle-${denoiser.id}-${handle}`);
    await expect(visibleHandle).toHaveAttribute(
      'title',
      new RegExp(endpoint.nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  }
  const decodeNodeId = 'upstream:decode.decode';
  const originalEdge = original.effectiveGraph.edges.find(
    (edge) => edge.targetNodeId === decodeNodeId && edge.targetPortId === 'state_in',
  )!;
  expect(originalEdge).toBeTruthy();

  const changedGraph = {
    ...original.effectiveGraph,
    edges: original.effectiveGraph.edges.map((edge) =>
      edge.edgeId === originalEdge.edgeId ? { ...edge, sourceNodeId: 'prompt', sourcePortId: 'state_out' } : edge,
    ),
  };
  const expectWriter = async (sourceId: string) => {
    await expect
      .poll(async () =>
        (await snapshot(page)).instance.effectiveGraph.edges.filter(
          (edge) => edge.targetNodeId === decodeNodeId && edge.targetPortId === 'state_in',
        ),
      )
      .toEqual([{ ...originalEdge, sourceNodeId: sourceId, sourcePortId: 'state_out' }]);
  };
  const replaceFromPrompt = async () =>
    dragWire(
      page,
      await socket(page, 'container:text_encoder', 'prompt', 'state_out', 'output'),
      await socket(page, 'container:decode', decodeNodeId, 'state_in', 'input'),
    );
  // Both containers are collapsed. Dragging onto an occupied socket retains the
  // semantic edge ID rather than deleting/recreating an unrelated canvas wire.
  await replaceFromPrompt();
  await expectWriter('prompt');
  let changed = (await snapshot(page)).instance;
  expect(changed.effectiveGraph.edges).toEqual(changedGraph.edges);
  expect(changed.values).toEqual(original.values);
  expect(changed.effectiveInterface).toEqual(original.effectiveInterface);
  expect(changed.definitionSnapshot).toEqual(original.definitionSnapshot);
  await page.keyboard.press('Control+z');
  await expectWriter(originalEdge.sourceNodeId);
  checkpoint('collapsed replace and undo/redo finished');
  await page.keyboard.press('Control+Shift+z');
  await expectWriter('prompt');
  checkpoint('expanded replacement finished');
  await page.keyboard.press('Control+z');
  await expectWriter(originalEdge.sourceNodeId);

  // Expand the target container once: the existing edge now ends on a child,
  // while the user connects to the ancestor's still-visible boundary socket.
  await page.getByRole('button', { name: 'Expand Qwen Image Auto Decode Step', exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  await replaceFromPrompt();
  await expectWriter('prompt');
  changed = (await snapshot(page)).instance;
  expect(changed.effectiveGraph.edges).toEqual(changedGraph.edges);
  expect(changed.values).toEqual(original.values);
  expect(changed.effectiveInterface).toEqual(original.effectiveInterface);
  await page.getByTestId('topbar-save-workflow').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await workspaceReady(page);
  checkpoint('refreshed');
  await expectWriter('prompt');
  expect((await snapshot(page)).instance.effectiveGraph).toEqual(changed.effectiveGraph);
  expect((await snapshot(page)).instance.values).toEqual(original.values);

  // Restore the executable route using the ordinary denoiser output socket.
  // The temporary bypass above intentionally tested editing, not model output.
  await page.getByTestId('arrange-graph').click();
  checkpoint('arranged after refresh');
  await dragWire(
    page,
    await socket(page, 'container:denoise', originalEdge.sourceNodeId, originalEdge.sourcePortId, 'output'),
    await socket(page, 'container:decode', decodeNodeId, 'state_in', 'input'),
  );
  await expectWriter(originalEdge.sourceNodeId);
  checkpoint('executable graph restored');
  expect((await snapshot(page)).instance.effectiveGraph).toEqual(original.effectiveGraph);
  const exported = (await page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph())) as {
    nodes: Record<string, { params: Record<string, unknown> }>;
    paths: string[][];
  };
  expect(Object.keys(exported.nodes).length).toBeGreaterThan(0);
  expect(exported.paths.flat().every((id) => Object.hasOwn(exported.nodes, id))).toBe(true);
  await page.getByTestId('topbar-workflow-resources').click();
  await page.getByTestId('assess-workflow-resources').click();
  const resources = page.getByTestId('workflow-resource-assessment');
  await expect(resources).toContainText('Available RAM:', { timeout: 90_000 });
  await expect(resources.getByRole('alert')).toHaveCount(0);
  await expect(resources.getByTestId('workflow-resource-item')).toContainText('Current:');
  await page.getByTestId('topbar-save-workflow').click();
  expect(pageErrors).toEqual([]);
  if (process.env.MODIFF_REVIEW_OUTPUT_DIR) {
    const directory = `${process.env.MODIFF_REVIEW_OUTPUT_DIR}/nested-connections`;
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: `${directory}/restored-frontend.png` });
    await writeFile(
      `${directory}/evidence.json`,
      JSON.stringify(
        { original, changed, restored: (await snapshot(page)).instance, exported, pageErrors, generationTested: false },
        null,
        2,
      ),
    );
  }
});
