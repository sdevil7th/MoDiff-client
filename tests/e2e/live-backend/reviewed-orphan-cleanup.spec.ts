import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

test('deleting an older Qwen snapshot releases loaded children absent from that snapshot', async ({ page }) => {
  test.skip(process.env.MODIFF_QWEN_ORPHAN_CLEANUP !== '1', 'Requires the completed typed-composition generation.');
  test.setTimeout(240_000);
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  if (!directory) throw new Error('An isolated evidence directory is required');
  const base = `${directory}/qwen-composed`;
  const evidence = `${directory}/orphan-cleanup`;
  await mkdir(evidence, { recursive: true });
  const graph = JSON.parse(await readFile(`${base}/submitted-workflow.json`, 'utf8'));
  const current = JSON.parse(await readFile(`${base}/workflow-instance.json`, 'utf8'));
  const lifecycle = JSON.parse(await readFile(`${base}/user-node-lifecycle.json`, 'utf8'));
  const added = JSON.parse(await readFile(`${base}/added-step.json`, 'utf8'));
  const original = JSON.parse(lifecycle.before.instanceJson);
  const entries = Object.entries(graph.nodes) as Array<
    [string, { action: string; params?: Record<string, { value?: unknown }> }]
  >;
  const loaderId = entries.find(([, node]) => node.action === 'ModelsLoader')![0];
  const orphanId = entries.find(
    ([, node]) =>
      JSON.stringify(node.params?.placement_path?.value) === JSON.stringify(added.modularDiffusers.placementPath),
  )![0];
  const backend = process.env.MODIFF_LIVE_BACKEND_URL ?? 'http://127.0.0.1:8088';
  const cached = (id: string, field: string) => page.request.get(`${backend}/cache/${encodeURIComponent(id)}/${field}`);
  expect((await cached(loaderId, 'repo_id')).ok(), 'the model must actually be loaded').toBe(true);
  expect((await cached(orphanId, 'block_class')).ok(), 'the removed internal node must actually be cached').toBe(true);
  await page.goto('/');
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 120_000 });
  const older = await page.evaluate(
    async ({ original, current }) => {
      const schema = await import('/src/studio/blockSchemaV2.ts');
      const runtime = await import('/src/studio/blockRuntimeV2.ts');
      let instance = schema.createBlockInstanceV2(original.definitionSnapshot, {
        instanceId: current.instanceId,
        position: { x: 100, y: 100 },
        size: { width: 520, height: 640 },
      });
      for (const [id, value] of Object.entries(current.values))
        instance = runtime.setBlockInstanceValueV2(
          instance,
          id,
          value as import('../../../src/studio/blockSchemaV2').BlockJsonValue,
        );
      return { nodes: [runtime.createBlockRootNodeV2(instance)], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    },
    { original, current },
  );
  expect(older.nodes[0]!.data.blockInstanceV2!.effectiveGraph.nodes.some((node) => node.nodeId === added.nodeId)).toBe(
    false,
  );
  const transfer = await page.evaluateHandle((value) => {
    const data = new DataTransfer();
    data.items.add(
      new File([JSON.stringify(value)], 'Qwen prior structure cleanup.json', { type: 'application/json' }),
    );
    return data;
  }, older);
  await page.locator('.react-flow').dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
  const root = page.locator(`.react-flow__node-block[data-id="${current.instanceId}"]`);
  await expect(root).toBeVisible({ timeout: 60_000 });
  expect((await cached(orphanId, 'block_class')).ok()).toBe(true);
  const resources = async () => (await page.request.get(`${backend}/runtime/resources`, { timeout: 5000 })).json();
  const before = await resources();
  let peakRss = before.process.rssBytes;
  let finished = false;
  const latencies: number[] = [];
  const release = page
    .waitForResponse(
      (response) => new URL(response.url()).pathname === '/cache' && response.request().method() === 'DELETE',
      { timeout: 180_000 },
    )
    .then(async (response) => {
      expect(response.ok()).toBe(true);
      return response.json();
    })
    .finally(() => {
      finished = true;
    });
  const monitor = (async () => {
    while (!finished) {
      const start = Date.now();
      const status = await page.request.get(`${backend}/queue`, { timeout: 5000 });
      expect(status.ok()).toBe(true);
      expect((await status.json()).current).toBeNull();
      latencies.push(Date.now() - start);
      peakRss = Math.max(peakRss, (await resources()).process.rssBytes);
      await page.waitForTimeout(100);
    }
  })();
  await root.locator('header').first().click();
  await page.getByTestId('selection-toolbar-delete').click();
  const [receipt] = await Promise.all([release, monitor]);
  await expect(root).toHaveCount(0);
  expect(receipt.nodes).toContain(loaderId);
  expect(receipt.nodes).toContain(orphanId);
  expect((await cached(loaderId, 'repo_id')).status()).toBe(404);
  expect((await cached(orphanId, 'block_class')).status()).toBe(404);
  expect(latencies.length).toBeGreaterThan(0);
  expect(Math.max(...latencies)).toBeLessThan(4000);
  expect(peakRss - before.process.rssBytes).toBeLessThan(8 * 1024 ** 3);
  await writeFile(
    `${evidence}/result.json`,
    JSON.stringify({ loaderId, orphanId, receipt, before, after: await resources(), peakRss, latencies }, null, 2),
  );
  await page.screenshot({ path: `${evidence}/released.png` });
});
