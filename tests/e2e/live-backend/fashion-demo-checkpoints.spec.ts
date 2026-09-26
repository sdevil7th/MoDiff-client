import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { save } from './qwenDemoGestures';

type Chapter = { title: string; path: string; mediaChecks: Array<{ nodeId: string; url: string; sha256: string }> };

test('curate fashion chapters and verify their own durable images on the deployed frontend', async ({ page }) => {
  const manifest = process.env.MODIFF_FASHION_CURATE;
  test.skip(!manifest, 'Select the reviewed, durable-image chapter manifest.');
  test.setTimeout(15 * 60_000);
  page.setDefaultTimeout(30_000);
  const entries = JSON.parse(await readFile(manifest!, 'utf8')) as Chapter[];
  const output = resolve(process.env.MODIFF_REVIEW_OUTPUT_DIR!);
  await mkdir(output, { recursive: true });
  const backend = 'http://127.0.0.1:8088';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(backend, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const empty = page.getByRole('button', { name: 'Empty workflow', exact: true });
  if (!(await empty.isVisible())) await page.getByTestId('topbar-new-workflow').click();
  await empty.click();
  await page.getByRole('radio', { name: 'Developer', exact: true }).check();
  const retained: Array<{ title: string; id: string }> = [];
  const initial = await (await page.request.get(`${backend}/workflows`, { timeout: 30_000 })).json();
  for (const entry of entries) {
    const existing = initial.workflows.filter((item: { title: string }) => item.title === entry.title);
    expect(existing.length, 'No ambiguous duplicate curated chapter titles.').toBeLessThanOrEqual(1);
    if (existing.length) {
      retained.push({ title: entry.title, id: existing[0].id });
      continue;
    }
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
    const policy = page.getByTestId('topbar-resource-policy');
    if ((await policy.getAttribute('aria-pressed')) === 'true') await policy.click();
    await save(page, entry.title);
    const catalog = await (await page.request.get(`${backend}/workflows`, { timeout: 30_000 })).json();
    const matches = catalog.workflows.filter((item: { title: string }) => item.title === entry.title);
    expect(matches).toHaveLength(1);
    retained.push({ title: entry.title, id: matches[0].id });
    await writeFile(resolve(output, 'saved-chapters.json'), JSON.stringify(retained, null, 2));
  }
  // Reload after all chapters exist: reused execution IDs must not make every
  // saved chapter display the last cached image.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const proof = [];
  for (const saved of retained) {
    const entry = entries.find((item) => item.title === saved.title)!;
    if (!(await page.getByRole('button', { name: 'My workflows', exact: true }).isVisible()))
      await page.getByTestId('left-tab-workflows').click();
    await page.getByRole('button', { name: 'My workflows', exact: true }).click();
    await page.getByLabel('Search workflows').fill('Fashion Demo');
    await page.getByTestId(`saved-workflow-${saved.id}`).getByRole('button').first().click();
    const expected = JSON.parse(await readFile(entry.path, 'utf8'));
    await expect(page.locator('.react-flow__node')).toHaveCount(expected.nodes.length);
    await page.getByTestId('arrange-graph').click();
    for (const media of entry.mediaChecks) {
      const image = page.getByTestId(`node-preview-image-${media.nodeId}-preview-0`).locator('img').first();
      await expect(image).toBeVisible();
      const file = new URL(media.url, backend).searchParams.get('file');
      await expect
        .poll(async () => new URL((await image.getAttribute('src')) || '/', backend).searchParams.get('file'))
        .toBe(file);
      await expect.poll(() => image.evaluate((item) => (item as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      const bytes = await (await page.request.get(new URL(media.url, backend).href, { timeout: 30_000 })).body();
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(media.sha256);
    }
    await save(page, saved.title);
    const record = await (await page.request.get(`${backend}/workflows/${saved.id}`, { timeout: 30_000 })).json();
    expect(record.snapshot.studioForm.resourceMode).toBe('expert');
    expect(record.snapshot.edges).toEqual(expected.edges);
    for (const original of expected.nodes) {
      const stored = record.snapshot.nodes.find((item: { id: string }) => item.id === original.id);
      for (const [key, field] of Object.entries(original.data.params) as Array<
        [string, { value?: unknown; display?: string }]
      >)
        if (field.display !== 'output' && !field.display?.startsWith('ui_'))
          expect(stored.data.params[key]?.value).toEqual(field.value);
    }
    proof.push({ ...saved, mediaChecks: entry.mediaChecks.length, inputsAndEdgesPreserved: true });
    await writeFile(resolve(output, 'durable-preview-proof.json'), JSON.stringify(proof, null, 2));
    await page.screenshot({ path: resolve(output, `${saved.title}.png`) });
  }
  expect(errors).toEqual([]);
});
