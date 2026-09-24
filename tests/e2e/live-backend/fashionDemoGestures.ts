import { expect, type Page } from '@playwright/test';
import { connect } from './qwenDemoGestures';

export const graph = (page: Page) => page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
export const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
export async function settle(page: Page) {
  let prior = '',
    stable = 0;
  await expect
    .poll(
      async () => {
        const next = JSON.stringify(await graph(page));
        stable = next === prior ? stable + 1 : 0;
        prior = next;
        return stable;
      },
      { timeout: 20_000, intervals: [300] },
    )
    .toBeGreaterThanOrEqual(3);
}

export async function field(page: Page, id: string, key: string, value: string) {
  const item = (await graph(page)).nodes.find((item) => item.id === id)!;
  const label = String(item.data.params[key].label || key);
  const input = node(page, id).getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press('Tab');
}

export async function add(page: Page, key: string) {
  const ids = new Set((await graph(page)).nodes.map((item) => item.id));
  await page.getByLabel('Search nodes', { exact: true }).fill(key);
  const row = page.getByTestId(`node-row-${key.replaceAll('.', '-')}`);
  if (!(await row.isVisible())) {
    const group = page.locator('[data-testid^="node-group-"]').filter({ has: row });
    if (await group.count()) await group.getByRole('button').first().click();
  }
  await row.click();
  await page.getByLabel('Search nodes', { exact: true }).fill('');
  await expect.poll(async () => (await graph(page)).nodes.length).toBe(ids.size + 1);
  // A single-node canvas intentionally has no layout operation.
  if (await page.getByTestId('arrange-graph').isEnabled()) await page.getByTestId('arrange-graph').click();
  await settle(page);
  return (await graph(page)).nodes.find((item) => !ids.has(item.id))!;
}

export async function wire(page: Page, from: string, output: string, to: string, input: string) {
  const clear = page.getByTestId('run-session-shelf').getByRole('button', { name: 'Clear', exact: true });
  if ((await clear.isVisible()) && (await clear.isEnabled())) await clear.click();
  await page.getByTestId('arrange-graph').click();
  let prior = '',
    stable = 0;
  await expect
    .poll(
      async () => {
        const boxes = await Promise.all([
          page.getByTestId(`node-handle-${from}-${output}`).boundingBox(),
          page.getByTestId(`node-handle-${to}-${input}`).boundingBox(),
        ]);
        const next = JSON.stringify(boxes);
        stable = boxes.every(Boolean) && next === prior ? stable + 1 : 0;
        prior = next;
        return stable;
      },
      { timeout: 15_000, intervals: [300] },
    )
    .toBeGreaterThanOrEqual(3);
  await connect(
    page,
    page.getByTestId(`node-handle-${from}-${output}`),
    page.getByTestId(`node-handle-${to}-${input}`),
  );
  await expect
    .poll(async () =>
      (await graph(page)).edges.some(
        (edge) =>
          edge.source === from && edge.sourceHandle === output && edge.target === to && edge.targetHandle === input,
      ),
    )
    .toBe(true);
}

export async function starter(page: Page, pipeline: string, task: string) {
  const ids = new Set((await graph(page)).nodes.map((item) => item.id));
  const panel = page.getByRole('region', { name: 'Diffusers operations' });
  await panel.getByLabel('Operation pipeline').click();
  await page.getByRole('option', { name: pipeline, exact: true }).click();
  await panel.getByLabel('Operation task').click();
  await page.getByRole('option', { name: task, exact: true }).click();
  await panel.getByRole('button', { name: 'Preview connected starter', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Connected starter', exact: true })
    .getByRole('button', { name: 'Add starter to canvas', exact: true })
    .click();
  await page.getByTestId('arrange-graph').click();
  await settle(page);
  return (await graph(page)).nodes.filter((item) => !ids.has(item.id));
}

export async function configure(page: Page, ids: Set<string>, prompt: string, steps: number, guidance: number) {
  for (const item of (await graph(page)).nodes.filter((item) => ids.has(item.id))) {
    if (item.data.uiState?.disabled) continue;
    for (const [key, param] of Object.entries(item.data.params)) {
      if (param.hidden || ['input', 'output'].includes(String(param.display))) continue;
      if (key === 'prompt') await field(page, item.id, key, prompt);
      if (key === 'negative_prompt')
        await field(
          page,
          item.id,
          key,
          'cartoon, illustration, plastic skin, doll, blurry, malformed hands, extra limbs, watermark, text',
        );
      if (['width', 'height'].includes(key)) await field(page, item.id, key, '1024');
      if (key === 'num_inference_steps') await field(page, item.id, key, String(steps));
      if (key === 'guidance_scale') await field(page, item.id, key, String(guidance));
      if (key === 'strength') await field(page, item.id, key, '0.9');
      if (key === 'seed') {
        const toggle = node(page, item.id).getByRole('button', { name: `Toggle random ${param.label}`, exact: true });
        if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click();
        await field(page, item.id, key, '603219');
      }
    }
  }
}
