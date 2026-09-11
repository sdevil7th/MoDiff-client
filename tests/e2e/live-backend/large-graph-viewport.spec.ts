import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('large ordinary graphs retain nodes and links while viewport culling mounts and unmounts fields', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const evidence = `${process.env.MODIFF_REVIEW_OUTPUT_DIR ?? 'artifacts'}/large-graph-viewport`;
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [],
    warnings: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.text().includes("[React Flow]: Couldn't create edge for")) warnings.push(message.text());
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 120_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await page.getByTestId('workflow-tab-new').click();
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
    const { createNodeFromRegistry } = await import('/src/workflow/nodeFactory.ts');
    const nodes = Array.from({ length: 150 }, (_, index) => {
      const registryKey = index % 2 === 0 ? 'modules.Primitive.TextValue' : 'modules.Primitive.DataViewer';
      const node = createNodeFromRegistry(registryKey, useNodesStore.getState().nodesRegistry, {
        x: (index % 15) * 420,
        y: Math.floor(index / 15) * 430,
      });
      if (!node) throw new Error(`The real ${registryKey} registry contract is missing`);
      node.id = `viewport-node-${index}`;
      node.data.label = `Viewport node ${index}`;
      if (node.data.params.text) node.data.params.text.value = `Preserve ordinary-node text ${index}`;
      return node;
    });
    const edges = nodes
      .filter((_, index) => index % 2 === 1)
      .map((node, index) => ({
        id: `viewport-edge-${index}`,
        source: nodes[index * 2]!.id,
        sourceHandle: 'output',
        target: node.id,
        targetHandle: 'value',
        type: 'default',
      }));
    useStudioStore.getState().clearGraphBinding();
    useFlowStore
      .getState()
      .replaceGraph({ nodes, edges }, { historyLabel: 'Large viewport fixture', clearRemovedCache: false });
    useStudioStore.setState({ launcherDismissed: true });
  });
  const snapshot = () =>
    page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const state = useFlowStore.getState();
      return {
        nodes: state.nodes.map(({ id, data }) => ({ id, params: data.params })),
        edges: state.edges.map(({ id, source, sourceHandle, target, targetHandle }) => ({
          id,
          source,
          sourceHandle,
          target,
          targetHandle,
        })),
      };
    });
  const before = await snapshot();
  await expect(page.locator('.react-flow__node')).not.toHaveCount(0);
  const mountedSets: string[][] = [];
  for (const [x, y, delta] of [
    [900, 250, -650],
    [1600, 750, 400],
    [750, 650, -450],
    [1100, 400, 750],
    [1700, 250, -450],
  ] as const) {
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(500);
    mountedSets.push(
      await page
        .locator('.react-flow__node')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')!)),
    );
  }
  expect(mountedSets.some((nodes) => nodes.length > 0 && nodes.length < 150)).toBe(true);
  expect(new Set(mountedSets.map((nodes) => nodes.sort().join(','))).size).toBeGreaterThan(1);
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(500);
  }
  expect(await snapshot()).toEqual(before);
  await page.screenshot({ path: `${evidence}/viewport-culling.png` });
  await writeFile(
    `${evidence}/result.json`,
    JSON.stringify(
      { totalNodes: 150, totalEdges: 75, mountedCounts: mountedSets.map((nodes) => nodes.length), errors, warnings },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
  expect(warnings).toEqual([]);
});
