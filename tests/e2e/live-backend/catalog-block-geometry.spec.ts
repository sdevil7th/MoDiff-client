import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { waitForRecursiveDomGeometry } from './blockDomGeometry';
import { verifyCatalogUserNodeReuse } from './catalogUserNodeGestures';

async function waitForHydratedWorkspace(page: Page) {
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  const deadline = Date.now() + 120_000;
  let readySince: number | null = null;
  while (Date.now() < deadline) {
    const gate = page.getByTestId('startup-workspace-gate');
    if ((await gate.count()) === 0) {
      readySince ??= Date.now();
      if (Date.now() - readySince >= 2_000) return;
    } else {
      readySince = null;
      const retry = gate.getByRole('button', { name: 'Retry', exact: true });
      if (await retry.isVisible().catch(() => false)) await retry.click();
    }
    await page.waitForTimeout(250);
  }
  throw new Error('The catalog matrix workspace did not finish hydration.');
}

test('every insertable Diffusers catalog cluster retains its complete expanded DOM hierarchy', async ({
  page,
}, testInfo) => {
  test.skip(process.env.MODIFF_RUN_CATALOG_GEOMETRY !== '1', 'Opt in to the complete live catalog geometry matrix.');
  const outputRoot = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  if (!outputRoot) throw new Error('MODIFF_REVIEW_OUTPUT_DIR is required for the catalog matrix.');
  const output =
    testInfo.project.repeatEach > 1 || testInfo.config.workers > 1
      ? `${outputRoot}/worker-${testInfo.parallelIndex}-repeat-${testInfo.repeatEachIndex}`
      : outputRoot;
  test.setTimeout(45 * 60_000);
  page.setDefaultTimeout(15_000);
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  const pageErrors: string[] = [];
  const handleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.text().includes("[React Flow]: Couldn't create edge for")) handleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('catalog-geometry-initialized')) return;
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('catalog-geometry-initialized', 'true');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHydratedWorkspace(page);
  const profiler = process.env.MODIFF_CATALOG_PROFILE === '1' ? await page.context().newCDPSession(page) : null;
  if (profiler) {
    await profiler.send('Profiler.enable');
    await profiler.send('Profiler.setSamplingInterval', { interval: 2000 });
  }
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  const entries = await page.evaluate(async () => {
    const [{ useHuggingFaceNodeLibraryStore }, { buildHuggingFaceCatalogSections }] = await Promise.all([
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
      import('/src/studio/huggingFaceNodeCatalog.ts'),
    ]);
    await useHuggingFaceNodeLibraryStore.getState().fetchLibrary();
    const library = useHuggingFaceNodeLibraryStore.getState().library;
    if (!library) throw new Error('The live catalog did not load.');
    return buildHuggingFaceCatalogSections(library)
      .find((section) => section.id === 'diffusers_cluster_nodes')!
      .entries.map(({ id, label, insertable, readiness }) => ({ id, label, insertable, readiness }));
  });
  expect(entries.length).toBeGreaterThanOrEqual(94);
  expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  const results: Array<{
    id: string;
    label: string;
    status: string;
    milliseconds?: number;
    error?: string;
    visibleNodes?: number;
  }> = [];
  for (const entry of entries) {
    if (
      process.env.MODIFF_CATALOG_GEOMETRY_FILTER &&
      !entry.id.toLowerCase().includes(process.env.MODIFF_CATALOG_GEOMETRY_FILTER.toLowerCase())
    )
      continue;
    if (!entry.insertable) {
      results.push({ id: entry.id, label: entry.label, status: 'catalog_only_not_tested' });
      continue;
    }
    const started = Date.now();
    const errorsBefore = pageErrors.length;
    const handlesBefore = handleErrors.length;
    const slug = entry.id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (profiler) await profiler.send('Profiler.start');
    try {
      console.log(`[catalog geometry] starting: ${entry.label}`);
      await waitForHydratedWorkspace(page);
      await page.keyboard.press('Escape');
      await page.getByTestId('workflow-tab-new').click();
      if (await advanced.isVisible().catch(() => false)) await advanced.click();
      const tabId = await page
        .locator('[role="tab"][aria-selected="true"][data-testid^="workflow-tab-"]')
        .getAttribute('data-testid');
      if (!tabId) throw new Error('The new workflow has no selected tab.');
      if (
        !(await page
          .getByLabel('Search nodes')
          .isVisible()
          .catch(() => false))
      )
        await page.getByTestId('left-tab-nodes').click();
      await page.getByLabel('Search nodes').fill(entry.label);
      const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
      const groupButton = group.getByRole('button').first();
      if ((await groupButton.getAttribute('aria-expanded')) !== 'true') await groupButton.click();
      const row = page.getByTestId(`hugging-face-node-row-${slug}`);
      await expect(row).toHaveCount(1);
      await row.click();
      const root = page.locator('[data-block-source="diffusers_catalog"][data-block-schema-version="2"]');
      await expect(root).toHaveCount(1, { timeout: 45_000 });
      const rootId = (await root.getAttribute('data-testid'))!.replace(/^user-block-/u, '');
      const editable = root.locator('textarea:not([disabled]):not([readonly])').first();
      if (await editable.isVisible().catch(() => false)) {
        const value = `Workflow-local catalog geometry and persistence check for ${entry.label}. Do not change creator defaults.`;
        await editable.fill(value);
        await editable.blur();
        await expect
          .poll(() =>
            page.evaluate(
              async ({ id, expected }) => {
                const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
                const values = useFlowStore.getState().nodes.find((node) => node.id === id)?.data
                  .blockInstanceV2?.values;
                return Boolean(values && Object.values(values).includes(expected));
              },
              { id: rootId, expected: value },
            ),
          )
          .toBe(true);
      }
      const valuesBefore = await page.evaluate(async (id) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const instance = useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2;
        if (!instance) throw new Error('Inserted catalog entry has no V2 instance.');
        return JSON.stringify({
          values: instance.values,
          definition: instance.definitionSnapshot,
          graph: instance.effectiveGraph,
        });
      }, rootId);
      const grip = await root.getByTestId('node-resize-grip').boundingBox();
      if (!grip) throw new Error('A collapsed catalog Block has no resize grip.');
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x - 180, grip.y - 160, { steps: 8 });
      await page.mouse.up();
      await root.getByLabel('Expand block', { exact: true }).click();
      await waitForRecursiveDomGeometry(page);
      for (let level = 0; level < 100; level += 1) {
        const toggle = page.locator('[data-block-projection="modular-diffusers"] [aria-label^="Expand "]').first();
        if ((await toggle.count()) === 0) break;
        await toggle.evaluate((button: HTMLButtonElement) => button.click());
        await waitForRecursiveDomGeometry(page);
      }
      await expect(page.locator('[data-block-projection="modular-diffusers"] [aria-label^="Expand "]')).toHaveCount(0);
      await page.getByTestId('arrange-graph').click();
      await waitForRecursiveDomGeometry(page);
      if (process.env.MODIFF_CATALOG_CHECK_CONTROL_BODIES === '1') {
        const bodies = await page.evaluate(() =>
          [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid^="node-scroll-body-"], [data-testid^="user-block-controls-"]',
            ),
          ].flatMap((body) => {
            if (!body.querySelector('textarea,input,select,[role="combobox"],button[aria-haspopup="listbox"]'))
              return [];
            const rect = body.getBoundingClientRect();
            return [{ id: body.dataset.testid, height: body.clientHeight, renderedHeight: rect.height }];
          }),
        );
        expect(bodies.length).toBeGreaterThan(0);
        for (const body of bodies) expect(body.height, JSON.stringify(body)).toBeGreaterThanOrEqual(96);
      }
      if (process.env.MODIFF_CATALOG_CHECK_SELECTED_LOADER_FIELDS === '1') {
        const loaders = await page.evaluate(async () => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          return useFlowStore
            .getState()
            .nodes.flatMap((node) =>
              node.data.module === 'modules.DiffusersImage' && node.data.action === 'LoadPipeline'
                ? [{ id: node.id, params: node.data.params }]
                : [],
            );
        });
        expect(loaders.length).toBeGreaterThan(0);
        for (const loader of loaders) {
          const body = page.getByTestId(`node-scroll-body-${loader.id}`);
          const advancedFields = body.getByRole('button', { name: 'Advanced', exact: true });
          if ((await advancedFields.count()) && (await advancedFields.getAttribute('aria-expanded')) !== 'true')
            await advancedFields.click();
          for (const key of ['conditioning_kind', 'conditioning_model_id', 'conditioning_revision']) {
            const field = loader.params[key];
            expect(typeof field?.hidden, `${entry.label}: ${key} must have a selected visibility contract`).toBe(
              'boolean',
            );
            const control = body.locator(`[data-key="${key}"]`).first();
            if (field!.hidden) await expect(control).not.toBeVisible();
            else {
              await control.scrollIntoViewIfNeeded();
              await expect(control).toBeVisible();
            }
          }
          expect(loader.params.model_id?.fieldOptions).toBeTruthy();
        }
        await waitForRecursiveDomGeometry(page);
      }
      const visibleNodes = await page.locator('.react-flow__node').count();
      await page.screenshot({ path: `${output}/${slug}.png` });
      await root.getByLabel('Collapse block', { exact: true }).click();
      await page.getByTestId('topbar-save-workflow').click();
      const saveDialog = page.getByTestId('save-workflow-dialog');
      if (
        await saveDialog
          .waitFor({ state: 'visible', timeout: 5_000 })
          .then(() => true)
          .catch(() => false)
      ) {
        await page.getByTestId('save-workflow-name').fill(`Catalog geometry — ${entry.label} — ${started}`);
        await page.getByTestId('confirm-save-workflow').click();
        await expect(saveDialog).toHaveCount(0);
      }
      await expect(page.getByTestId(tabId).locator('..')).not.toHaveAttribute('data-dirty', 'true');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForHydratedWorkspace(page);
      // A second frontend may have an active run. Restore this test's saved tab
      // explicitly rather than inspecting the other browser's recovered graph.
      await page.getByTestId(tabId).click();
      await expect(root).toHaveCount(1, { timeout: 30_000 });
      const valuesAfter = await page.evaluate(async (id) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const instance = useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2;
        if (!instance) throw new Error('Saved catalog instance did not survive refresh.');
        return JSON.stringify({
          values: instance.values,
          definition: instance.definitionSnapshot,
          graph: instance.effectiveGraph,
        });
      }, rootId);
      expect(valuesAfter).toBe(valuesBefore);
      // The saved expanded viewport can put the collapsed header behind the
      // sidebar. Focus the root using the app's viewport-only navigation path;
      // Arrange is intentionally disabled for a one-node graph. This does not
      // change graph coordinates, values, interfaces, or the real expand click.
      await page.evaluate(async (nodeId) => {
        const [{ useSettingsStore }, { useStudioStore }] = await Promise.all([
          import('/src/stores/useSettingsStore.ts'),
          import('/src/stores/useStudioStore.ts'),
        ]);
        const now = Date.now();
        useSettingsStore.getState().setWorkflowFocusRequest({
          workflowTabId: useStudioStore.getState().activeWorkflowTabId,
          nodeId,
          requestId: now,
          requestedAt: now,
        });
      }, rootId);
      await expect
        .poll(() =>
          page.evaluate(
            async () =>
              (await import('/src/stores/useSettingsStore.ts')).useSettingsStore.getState().workflowFocusRequest,
          ),
        )
        .toBeNull();
      await root.getByLabel('Expand block', { exact: true }).click();
      await waitForRecursiveDomGeometry(page);
      if (process.env.MODIFF_CATALOG_CHECK_USER_NODE_REUSE === '1')
        await verifyCatalogUserNodeReuse(page, rootId, `${output}/${slug}`);
      expect(pageErrors.slice(errorsBefore)).toEqual([]);
      expect(handleErrors.slice(handlesBefore)).toEqual([]);
      results.push({
        id: entry.id,
        label: entry.label,
        status: 'passed_ui_not_execution',
        visibleNodes,
        milliseconds: Date.now() - started,
      });
    } catch (error) {
      if (page.isClosed()) throw error;
      results.push({
        id: entry.id,
        label: entry.label,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        milliseconds: Date.now() - started,
      });
      await writeFile(
        `${output}/${slug}-error.txt`,
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      const diagnostic = await page.evaluate(async () => {
        const [{ useFlowStore }, { useSettingsStore }, { useStudioStore }] = await Promise.all([
          import('/src/stores/useFlowStore.ts'),
          import('/src/stores/useSettingsStore.ts'),
          import('/src/stores/useStudioStore.ts'),
        ]);
        return {
          activeTab: useStudioStore.getState().activeWorkflowTabId,
          tabIds: useStudioStore.getState().workflowTabs.map(({ id }) => id),
          renderedTabIds: Array.from(document.querySelectorAll('[role="tab"][data-testid^="workflow-tab-"]')).map(
            (tab) => tab.getAttribute('data-testid'),
          ),
          canvasTransition: useStudioStore.getState().canvasTransition,
          canvasHydrated: useStudioStore.getState().workflowCanvasHydrated,
          moduleUrls: performance
            .getEntriesByType('resource')
            .map(({ name }) => name)
            .filter((name) => /use(?:Studio|Flow|Settings)Store|WorkflowTabsBar/u.test(name)),
          focus: useSettingsStore.getState().workflowFocusRequest,
          nodes: useFlowStore.getState().nodes.map(({ id, hidden, measured }) => ({ id, hidden, measured })),
        };
      });
      await writeFile(`${output}/${slug}-diagnostic.json`, JSON.stringify(diagnostic, null, 2));
      await page.screenshot({ path: `${output}/${slug}-failed.png` }).catch(() => undefined);
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
    } finally {
      if (profiler) {
        const { profile } = await profiler.send('Profiler.stop');
        await writeFile(`${output}/${slug}.cpuprofile`, JSON.stringify(profile));
      }
    }
    await writeFile(`${output}/catalog-geometry.json`, JSON.stringify({ entries: entries.length, results }, null, 2));
    console.log(`[catalog geometry] ${results.at(-1)?.status}: ${entry.label}`);
  }
  await writeFile(`${output}/catalog-geometry.json`, JSON.stringify({ entries: entries.length, results }, null, 2));
  expect(results.filter((result) => result.status === 'failed')).toEqual([]);
  expect(results.filter((result) => result.status === 'passed_ui_not_execution').length).toBeGreaterThan(0);
});
