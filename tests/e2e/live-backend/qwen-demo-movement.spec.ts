import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { backend, output, ready, inspect, save } from './qwenDemoGestures';

async function dragHeader(page: Page, node: Locator, destination: { x: number; y: number }, modified = false) {
  const header = node.locator('header').first();
  await header.click();
  const box = await header.boundingBox();
  expect(box).toBeTruthy();
  if (modified) await page.keyboard.down('Control');
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 25 });
  await page.mouse.up();
  if (modified) await page.keyboard.up('Control');
}

test('native Qwen Block keeps plain drag local and explicitly moves LoRA in and out with its wire', async ({
  page,
}) => {
  test.skip(!output || process.env.MODIFF_MOVE_QWEN_DEMO !== '1', 'Opt in to the retained demo movement proof.');
  test.setTimeout(6 * 60_000);
  page.setDefaultTimeout(30_000);
  const authoring = JSON.parse(await readFile(`${output}/Qwen-edit-authoring-receipt.json`, 'utf8'));
  const rootId = authoring.rootId as string;
  const loraId = authoring.loraId as string;
  const workflows = await (await page.request.get(`${backend}/workflows?view=summary`)).json();
  const workflow = workflows.workflows.find(
    (item: { title: string }) =>
      item.title === (process.env.MODIFF_MOVE_QWEN_WORKFLOW_TITLE ?? 'Qwen Demo 04 — Reusable Block authoring'),
  );
  expect(workflow).toBeTruthy();
  const submissions: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/graph' && request.method() === 'POST') submissions.push(request.url());
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await ready(page);
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await page.getByTestId('left-tab-workflows').click();
  await page.getByLabel('Search workflows').fill('Qwen Demo');
  await page.getByTestId(`saved-workflow-${workflow.id}`).getByRole('button').first().click();
  const root = page.getByTestId(`user-block-${rootId}`);
  await expect(root).toBeVisible();
  // Recover an interrupted rehearsal through the same native toolbar action.
  const existing = (await inspect(page)).nodes.find((node) => node.id === rootId)!.data.blockInstanceV2!;
  if (existing.effectiveGraph.nodes.some((node) => node.nodeId === loraId)) {
    const expand = root.getByLabel('Expand block', { exact: true });
    if (await expand.isVisible()) await expand.click();
    await page.getByTestId('arrange-graph').click();
    const projected = `block-v2-node:${rootId.length}:${rootId}:${loraId.length}:${loraId}`;
    await page.locator(`.react-flow__node[data-id="${projected}"] header`).click();
    await page.getByTestId('selection-toolbar-move-out').click();
    await expect.poll(async () => (await inspect(page)).nodes.some((node) => node.id === loraId)).toBe(true);
  }
  const collapse = root.getByLabel('Collapse block', { exact: true });
  if (await collapse.isVisible()) await collapse.click();
  await page.getByTestId('arrange-graph').click();
  const baseline = await inspect(page);
  const instance = () =>
    inspect(page).then((graph) => graph.nodes.find((node) => node.id === rootId)!.data.blockInstanceV2!);
  const crossing = baseline.edges.find((edge) => edge.source === loraId)!;
  const edge = page.locator(`.react-flow__edge[data-id="${crossing.id}"] .react-flow__edge-interaction`);
  await expect(edge).toBeAttached();
  expect(
    await page.locator(`.react-flow__edge[data-id="${crossing.id}"] .react-flow__edge-path`).getAttribute('d'),
  ).toContain('C');
  // Double-click the actual curve halfway along its SVG path.
  const point = await edge.evaluate((element) => {
    const path = element as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.dblclick(point.x, point.y);
  await expect.poll(async () => (await inspect(page)).edges.some((item) => item.id === crossing.id)).toBe(false);
  await expect(page.getByTestId(`block-crossing-ports-${rootId}`)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId(`block-crossing-ports-${rootId}`)).toContainText('Lora');
  await root.getByLabel('Expand block', { exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  const outside = page.locator(`.react-flow__node[data-id="${loraId}"]`);
  const destination = async (fraction: number) => {
    const frame = await root.boundingBox();
    const node = await outside.boundingBox();
    const header = await outside.locator('header').boundingBox();
    expect(frame && node && header).toBeTruthy();
    return {
      x: frame!.x + frame!.width - 8,
      y: frame!.y + frame!.height * fraction - (node!.height - header!.height) / 2,
    };
  };
  await dragHeader(page, outside, await destination(0.45));
  expect((await inspect(page)).nodes.some((node) => node.id === loraId)).toBe(true);
  expect((await instance()).effectiveGraph.nodes.some((node) => node.nodeId === loraId)).toBe(false);
  await dragHeader(page, outside, await destination(0.6), true);
  await expect
    .poll(async () => (await instance()).effectiveGraph.nodes.some((node) => node.nodeId === loraId))
    .toBe(true);
  expect((await inspect(page)).nodes.some((node) => node.id === loraId)).toBe(false);
  expect(
    (await instance()).effectiveGraph.edges.some(
      (item) => item.sourceNodeId === loraId && item.targetNodeId === 'models',
    ),
  ).toBe(true);
  const projectedId = `block-v2-node:${rootId.length}:${rootId}:${loraId.length}:${loraId}`;
  await page.getByTestId('arrange-graph').click();
  await page.locator(`.react-flow__node[data-id="${projectedId}"] header`).click();
  const moveOut = page.getByTestId('selection-toolbar-move-out');
  await moveOut.hover();
  await expect(page.getByRole('tooltip')).toContainText('Move out of Block · Ctrl/Cmd + drag');
  await moveOut.click();
  await expect.poll(async () => (await inspect(page)).nodes.some((node) => node.id === loraId)).toBe(true);
  expect((await instance()).effectiveGraph.nodes.some((node) => node.nodeId === loraId)).toBe(false);
  await root.getByLabel('Collapse block', { exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  await expect(page.getByTestId(`block-crossing-ports-${rootId}`)).toContainText('Lora');
  expect((await inspect(page)).edges.some((item) => item.source === loraId && item.target === rootId)).toBe(true);
  expect((await instance()).effectiveInterface).toEqual(
    baseline.nodes.find((node) => node.id === rootId)!.data.blockInstanceV2!.effectiveInterface,
  );
  await save(page, workflow.title);
  await writeFile(
    `${output}/Qwen-native-movement-proof.json`,
    JSON.stringify({ before: baseline, after: await inspect(page), submissions }, null, 2),
  );
  await page.screenshot({ path: `${output}/Qwen-native-movement-restored.png` });
  expect(submissions).toEqual([]);
});
