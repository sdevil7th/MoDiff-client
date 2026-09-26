import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('required Fill media is diagnosed before Run, Fix opens the input, picker repair persists without changing other settings', async ({
  page,
}) => {
  const output = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!output, 'Select a private UI proof directory. This test does not generate.');
  test.setTimeout(4 * 60_000);
  await mkdir(output!, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('media-preflight-proof')) {
      localStorage.clear();
      sessionStorage.setItem('media-preflight-proof', '1');
    }
  });
  const submissions: string[] = [];
  const submittedGraphs: Array<{ nodes: Record<string, unknown> }> = [];
  await page.route('**/graph', async (route) => {
    if (route.request().method() === 'POST') {
      submissions.push(route.request().url());
      submittedGraphs.push(route.request().postDataJSON());
      await route.abort();
    } else await route.continue();
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 120_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible()) await advanced.click();
  await page.getByTestId('workflow-tab-new').click();
  if (await advanced.isVisible()) await advanced.click();
  const entry = await page.evaluate(async () => {
    const { useHuggingFaceNodeLibraryStore } = await import('/src/stores/useHuggingFaceNodeLibraryStore.ts');
    const { buildHuggingFaceCatalogSections } = await import('/src/studio/huggingFaceNodeCatalog.ts');
    await useHuggingFaceNodeLibraryStore.getState().fetchLibrary();
    const item = buildHuggingFaceCatalogSections(useHuggingFaceNodeLibraryStore.getState().library!)
      .flatMap((section) => section.entries)
      .find((item) => item.id === 'diffusers.composite:FluxFillPipeline:outpaint');
    if (!item?.insertable) throw new Error('The exact Fill outpaint catalog entry is not insertable.');
    return { id: item.id, label: item.label };
  });
  if (!(await page.getByLabel('Search nodes').isVisible())) await page.getByTestId('left-tab-nodes').click();
  await page.getByLabel('Search nodes').fill(entry.label);
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes').getByRole('button').first();
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click();
  await page
    .getByTestId(`hugging-face-node-row-${entry.id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`)
    .click();
  const root = page.locator('[data-block-source="diffusers_catalog"][data-block-schema-version="2"]');
  await expect(root).toHaveCount(1, { timeout: 60_000 });
  const rootId = (await root.getAttribute('data-testid'))!.replace(/^user-block-/u, '');
  const auto = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await auto.getAttribute('aria-checked')) === 'true')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  const inspect = () =>
    page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const { collectRunReadinessIssues } = await import('/src/studio/runReadiness.ts');
      const { useWebsocketStore } = await import('/src/stores/useWebsocketStore.ts');
      const flow = useFlowStore.getState();
      const instance = flow.nodes.find((node) => node.id === id)!.data.blockInstanceV2!;
      const socket = useWebsocketStore.getState();
      return {
        values: instance.values,
        graph: instance.effectiveGraph,
        definition: instance.definitionSnapshot,
        issues: collectRunReadinessIssues({
          sid: socket.sid,
          isConnected: socket.isConnected,
          includeStudio: false,
        }).filter((issue) => issue.code === 'block_media_input_missing'),
        selected: flow.nodes.filter((node) => node.selected).map((node) => node.id),
      };
    }, rootId);
  const initial = await inspect();
  expect(initial.issues.map((issue) => issue.fieldId).sort()).toEqual(['image', 'mask_image']);
  expect(initial.issues.every((issue) => issue.blocking)).toBe(true);
  await expect(page.getByTestId('studio-run')).toBeDisabled();
  await page.getByTestId('graph-fix').click();
  const dialog = page.getByTestId('graph-fix-dialog');
  await expect(dialog.getByText(/Connect an existing compatible value or add a matching source node/)).toHaveCount(0);
  await expect(dialog.locator('[data-testid^="graph-fix-issue-"]')).toHaveCount(2);
  await expect(dialog.getByText('Open required input', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `${output}/missing-media-fix.png` });
  await page.getByTestId('graph-fix-apply').click();
  await expect(dialog).toHaveCount(0);
  expect((await inspect()).selected).toContain(rootId);
  expect((await inspect()).values).toEqual(initial.values);
  const backend = process.env.MODIFF_LIVE_BACKEND_URL ?? 'http://127.0.0.1:8088';
  for (const [field, label, source] of [
    ['image', 'image', '@data/images/flux_fill_outpaint.reference_image_1.png'],
    ['mask_image', 'mask image', '@data/images/flux_fill_outpaint.mask_image.png'],
  ]) {
    const response = await page.request.get(`${backend}/file?file=${encodeURIComponent(source)}`);
    expect(response.ok()).toBe(true);
    const picker = root
      .locator('.modiff-field')
      .filter({ has: page.getByLabel(label, { exact: true }) })
      .locator('input[type="file"]');
    await expect(picker).toHaveCount(1);
    await picker.setInputFiles({
      name: `flux-required-${field}.png`,
      mimeType: 'image/png',
      buffer: await response.body(),
    });
    await expect.poll(async () => (await inspect()).issues.some((issue) => issue.fieldId === field)).toBe(false);
  }
  const repaired = await inspect();
  expect(repaired.issues).toEqual([]);
  for (const [key, value] of Object.entries(initial.values)) {
    if (!['image', 'mask_image'].includes(key)) expect(repaired.values[key], key).toEqual(value);
  }
  expect(repaired.definition).toEqual(initial.definition);
  await page.getByTestId('topbar-save-workflow').click();
  await page.getByTestId('save-workflow-name').fill(`Fill required media proof ${Date.now()}`);
  await page.getByTestId('confirm-save-workflow').click();
  await expect(page.getByTestId('save-workflow-dialog')).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(root).toHaveCount(1, { timeout: 120_000 });
  await expect.poll(async () => (await inspect()).values).toEqual(repaired.values);
  const refreshed = await inspect();
  expect(refreshed.issues).toEqual([]);
  expect(refreshed.graph).toEqual(repaired.graph);
  expect(submissions).toEqual([]);
  await page.screenshot({ path: `${output}/repaired-media-after-refresh.png` });
  await writeFile(
    `${output}/receipt.json`,
    JSON.stringify(
      { scope: 'native required-media UI; no generation', initial, repaired, refreshed, submittedRuns: submissions },
      null,
      2,
    ),
  );
  // A second, unfinished draft must keep whole-workflow Run blocked without
  // preventing this already repaired Block from running on its own. Intercept
  // the submission: this is a native selection/preflight proof, not inference.
  await page.getByTestId('left-tab-templates').click();
  await page.getByTestId('left-tab-nodes').click();
  await expect(page.getByLabel('Search nodes')).toBeVisible();
  await page.getByLabel('Search nodes').fill(entry.label);
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click();
  await page
    .getByTestId(`hugging-face-node-row-${entry.id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`)
    .click();
  await expect(root).toHaveCount(2, { timeout: 60_000 });
  await expect.poll(async () => (await inspect()).issues.length).toBe(2);
  await expect(page.getByTestId('studio-run')).toBeDisabled();
  const expectedIds = await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return Object.keys(useFlowStore.getState().exportGraph('scope-proof', id).nodes).sort();
  }, rootId);
  await page.getByTestId('arrange-graph').click();
  await page.getByTestId(`user-block-${rootId}`).locator('header').first().click({ timeout: 15_000 });
  await page.getByTestId('selection-toolbar-run-from-node').click({ timeout: 15_000 });
  await expect.poll(() => submittedGraphs.length, { timeout: 15_000 }).toBe(1);
  expect(Object.keys(submittedGraphs[0].nodes).sort()).toEqual(expectedIds);
  expect((await inspect()).values).toEqual(repaired.values);
  await writeFile(
    `${output}/selected-branch.json`,
    JSON.stringify(
      {
        scope: 'native selected Run reaches submission; HTTP graph request intercepted, no inference',
        expectedIds,
        submittedIds: Object.keys(submittedGraphs[0].nodes).sort(),
        wholeGraphMissingMedia: (await inspect()).issues,
      },
      null,
      2,
    ),
  );
});
