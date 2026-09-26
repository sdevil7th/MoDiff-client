import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { save } from './qwenDemoGestures';

// Import immutable rehearsal exports into separate saved tabs. Save As alone
// does not freeze the earlier chapter when its still-open tab is edited later.
test('retain approved demo chapters as separate saved frontend workflows', async ({ page }) => {
  const manifestPath = process.env.MODIFF_DEMO_CHECKPOINT_MANIFEST;
  test.skip(!manifestPath, 'Provide an explicit list of owned rehearsal exports to retain.');
  test.setTimeout(10 * 60_000);
  const entries = JSON.parse(await readFile(manifestPath!, 'utf8')) as Array<{ title: string; path: string }>;
  const backend = process.env.MODIFF_LIVE_BACKEND_URL || 'http://127.0.0.1:8088';
  const output = resolve(process.env.MODIFF_REVIEW_OUTPUT_DIR || 'artifacts/modularity-checkpoints');
  await mkdir(output, { recursive: true });
  await page.goto(backend, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const empty = page.getByRole('button', { name: 'Empty workflow', exact: true });
  if (await empty.isVisible()) await empty.click();
  await page.getByRole('radio', { name: 'Developer', exact: true }).check();
  const memoryPolicy = page.getByTestId('topbar-resource-policy');
  if ((await memoryPolicy.getAttribute('aria-pressed')) === 'true') await memoryPolicy.click();
  const retained: Array<{ title: string; id: string }> = [];
  for (const entry of entries) {
    const source = await readFile(entry.path, 'utf8');
    const expected = JSON.parse(source);
    const transfer = await page.evaluateHandle(
      ({ source, title }) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([source], `${title}.json`, { type: 'application/json' }));
        return transfer;
      },
      { source, title: entry.title },
    );
    await page.locator('.react-flow').dispatchEvent('drop', { dataTransfer: transfer });
    await transfer.dispose();
    await expect(page.locator('.react-flow__node')).toHaveCount(expected.nodes.length);
    if ((await memoryPolicy.getAttribute('aria-pressed')) === 'true') await memoryPolicy.click();
    await save(page, entry.title);
    const catalog = await (await page.request.get(`${backend}/workflows`, { timeout: 15_000 })).json();
    const matches = catalog.workflows.filter((item: { title: string }) => item.title === entry.title);
    expect(matches, 'Use unique chapter names, not ambiguous duplicate saved records.').toHaveLength(1);
    const id = matches[0].id;
    const record = await (await page.request.get(`${backend}/workflows/${id}`, { timeout: 15_000 })).json();
    expect(record.snapshot.studioForm.resourceMode).toBe('expert');
    expect(record.snapshot.nodes).toHaveLength(expected.nodes.length);
    expect(record.snapshot.edges).toEqual(expected.edges);
    for (const original of expected.nodes) {
      const stored = record.snapshot.nodes.find((item: { id: string }) => item.id === original.id);
      for (const [key, field] of Object.entries(original.data.params) as Array<[string, { value?: unknown }]>)
        expect(stored.data.params[key]?.value).toEqual(field.value);
    }
    retained.push({ title: entry.title, id });
    await writeFile(resolve(output, 'saved-chapters.json'), JSON.stringify(retained, null, 2));
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await page.screenshot({ path: resolve(output, 'retained-chapters.png') });
});

test('arrange saved demo chapters after dynamic fields have settled', async ({ page }) => {
  const manifest = process.env.MODIFF_DEMO_LAYOUT_MANIFEST;
  test.skip(!manifest, 'Select the explicitly retained demo records to arrange.');
  test.setTimeout(10 * 60_000);
  page.setDefaultTimeout(20_000);
  const entries = JSON.parse(await readFile(manifest!, 'utf8')) as Array<{ title: string; id: string }>;
  const backend = process.env.MODIFF_LIVE_BACKEND_URL || 'http://127.0.0.1:8088';
  const output = resolve(process.env.MODIFF_REVIEW_OUTPUT_DIR || 'artifacts/modularity-layout');
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(backend, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const empty = page.getByRole('button', { name: 'Empty workflow', exact: true });
  if (await empty.isVisible()) await empty.click();
  await page.getByRole('radio', { name: 'Developer', exact: true }).check();
  const boxes = () =>
    page.locator('.react-flow__node').evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { id: node.getAttribute('data-id'), x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );
  const settle = async () => {
    let previous = '',
      unchanged = 0;
    await expect
      .poll(
        async () => {
          const value = JSON.stringify(await boxes());
          unchanged = value === previous ? unchanged + 1 : 0;
          previous = value;
          return unchanged;
        },
        { timeout: 20_000, intervals: [400] },
      )
      .toBeGreaterThanOrEqual(3);
  };
  const retained: Array<{ id: string; title: string; overlaps: unknown[] }> = process.env.MODIFF_DEMO_LAYOUT_DONE
    ? JSON.parse(await readFile(process.env.MODIFF_DEMO_LAYOUT_DONE, 'utf8'))
    : [];
  for (const entry of entries) {
    if (retained.some((done) => done.id === entry.id)) continue;
    const before = await (await page.request.get(`${backend}/workflows/${entry.id}`, { timeout: 30_000 })).json();
    if (!(await page.getByRole('button', { name: 'My workflows', exact: true }).isVisible()))
      await page.getByTestId('left-tab-workflows').click();
    await page.getByRole('button', { name: 'My workflows', exact: true }).click();
    await page.getByLabel('Search workflows').fill('Demo Ready');
    await page.getByTestId(`saved-workflow-${entry.id}`).getByRole('button').first().click();
    await expect(page.locator('.react-flow__node')).toHaveCount(before.snapshot.nodes.length);
    const clear = page.getByTestId('run-session-shelf').getByRole('button', { name: 'Clear', exact: true });
    if ((await clear.isVisible()) && (await clear.isEnabled())) await clear.click();
    await settle();
    await page.getByTestId('arrange-graph').click();
    await settle();
    const positions = await boxes();
    const overlaps = positions.flatMap((left, i) =>
      positions
        .slice(i + 1)
        .flatMap((right) =>
          Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x) > 2 &&
          Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y) > 2
            ? [[left.id, right.id]]
            : [],
        ),
    );
    expect(overlaps, entry.title).toEqual([]);
    await page.getByTestId('topbar-save-workflow').click();
    await page.getByTestId('topbar-export').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('topbar-export-raw-workflow').click();
    const exportPath = resolve(output, `${entry.title}.workflow.json`);
    await (await download).saveAs(exportPath);
    const exported = JSON.parse(await readFile(exportPath, 'utf8'));
    const layout = (nodes: Array<{ id: string; position: unknown }>) => nodes.map((node) => [node.id, node.position]);
    await expect
      .poll(async () => {
        const saved = await (await page.request.get(`${backend}/workflows/${entry.id}`, { timeout: 30_000 })).json();
        return layout(saved.snapshot.nodes);
      })
      .toEqual(layout(exported.nodes));
    const after = await (await page.request.get(`${backend}/workflows/${entry.id}`, { timeout: 30_000 })).json();
    expect(after.snapshot.edges).toEqual(before.snapshot.edges);
    for (const original of before.snapshot.nodes) {
      const stored = after.snapshot.nodes.find((node: { id: string }) => node.id === original.id);
      for (const [key, field] of Object.entries(original.data.params) as Array<
        [string, { display?: string; value?: unknown }]
      >)
        if (field.display !== 'output' && !field.display?.startsWith('ui_'))
          expect(stored.data.params[key]?.value).toEqual(field.value);
    }
    retained.push({ ...entry, overlaps });
    await writeFile(resolve(output, 'layouts.json'), JSON.stringify(retained, null, 2));
  }
  await page.screenshot({ path: resolve(output, 'final-layout.png') });
});
