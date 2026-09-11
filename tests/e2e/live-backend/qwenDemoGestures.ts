import { expect, type Page, type Locator } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { backendSourceIdentity } from '../../../scripts/live-proof-provenance.mjs';
import type { CustomNodeType } from '../../../src/stores/useFlowStore';
import type { Edge } from '@xyflow/react';

export const output = process.env.MODIFF_REVIEW_OUTPUT_DIR;
export const backend = process.env.MODIFF_LIVE_BACKEND_URL ?? 'http://127.0.0.1:8088';
export const shotPrompt =
  'Premium studio product photograph of a matte sage-green stand-up coffee pouch with a clean cream paper label. The label reads "MoDiff" in large crisp elegant dark-green lettering, with "CREATIVE BLEND" in small lettering below. A single coffee cup and a few roasted coffee beans sit beside the pouch on a warm pale stone plinth. Soft peach background, warm morning side light, subtle natural shadows, balanced editorial composition, beautifully detailed paper texture, professional commercial photography. The entire pouch is visible with generous space around it. No extra logos, no watermark.';

export async function ready(page: Page) {
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 120_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
}
export async function connect(page: Page, source: Locator, target: Locator) {
  const point = async (locator: Locator) => {
    await expect(locator).toBeVisible();
    await expect
      .poll(() =>
        locator.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return hit === element || Boolean(hit && element.contains(hit));
        }),
      )
      .toBe(true);
    return locator.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y);
      if (hit !== element && (!hit || !element.contains(hit))) throw new Error('The connector is obscured.');
      return point;
    });
  };
  const from = await point(source),
    to = await point(target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  console.log(
    'DEMO GESTURE result',
    await page.evaluate(() => ({
      connecting: Boolean(document.querySelector('.react-flow.connecting')),
      connection: Boolean(document.querySelector('.react-flow__connection')),
      edges: document.querySelectorAll('.react-flow__edge').length,
    })),
  );
}
export async function inspect(page: Page) {
  return page.evaluate(() => {
    const state = window.__MODIFF_E2E__!.exportWorkflowGraph() as { nodes: CustomNodeType[]; edges: Edge[] };
    return { ...state, exported: window.__MODIFF_E2E__!.exportAuthorizedApiGraph() };
  });
}
export async function save(page: Page, name: string) {
  const current = page.getByTestId('topbar-save-workflow');
  if ((await current.getAttribute('title'))?.includes(name)) {
    const saved = page.waitForResponse(
      (response) =>
        /\/workflows\/[^/]+$/u.test(new URL(response.url()).pathname) && response.request().method() === 'PUT',
    );
    await current.click();
    expect((await saved).ok()).toBe(true);
    return;
  }
  await page.getByTestId('topbar-save-workflow-options').click();
  await page.getByTestId('topbar-save-workflow-as').click();
  const dialog = page.getByTestId('save-workflow-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('save-workflow-name').fill(name);
  await page.getByTestId('confirm-save-workflow').click();
  await expect(dialog).toHaveCount(0);
  await expect(current).toHaveAttribute('title', `Save ${name} to My workflows (Ctrl/⌘+S)`);
}
export async function retainRun(page: Page, name: string, rootId: string, runButton = page.getByTestId('studio-run')) {
  const before = await inspect(page);
  await writeFile(`${output}/${name}-before-run.json`, JSON.stringify(before, null, 2));
  const source = backendSourceIdentity('../MoDiff');
  const health = await (await page.request.get(`${backend}/health`)).json();
  expect(health.backend_source.fingerprint).toBe(source.fingerprint);
  const submissions: unknown[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/graph' && request.method() === 'POST')
      submissions.push(request.postDataJSON());
  });
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/graph' && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await expect(runButton).toBeEnabled({ timeout: 60_000 });
  await runButton.click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBe(true);
  const { task_id: taskId } = await response.json();
  expect(taskId).toBeTruthy();
  await writeFile(`${output}/${name}-submitted.json`, JSON.stringify({ taskId, submissions, source, health }, null, 2));
  console.log(`[Qwen demo] ${name} running: ${taskId}`);
  await retainTask(page, name, rootId, taskId);
  const after = await (await page.request.get(`${backend}/health`)).json();
  expect(after.backend_source.fingerprint).toBe(source.fingerprint);
  expect(submissions).toHaveLength(1);
}

export async function retainTask(page: Page, name: string, rootId: string, taskId: string) {
  let run: { outputs?: Array<{ taskId: string; displayType: string; url: string }>; [key: string]: unknown } = {};
  for (let attempt = 0; attempt < 540; attempt++) {
    const queue = await (await page.request.get(`${backend}/queue`, { timeout: 30_000 })).json();
    const task =
      queue.current?.task_id === taskId
        ? queue.current
        : queue.recent?.find((item: { task_id: string }) => item.task_id === taskId);
    if (attempt % 6 === 0)
      console.log(`[Qwen demo] ${taskId}: ${task?.status} ${task?.phase ?? ''} ${task?.progress ?? 0}%`);
    if (task?.status === 'failed' || task?.status === 'cancelled') throw new Error(JSON.stringify(task));
    if (task?.status === 'completed') {
      run = await (await page.request.get(`${backend}/runs/${encodeURIComponent(taskId)}`)).json();
      if (run.outputs?.some((item) => item.taskId === taskId && item.displayType === 'image')) break;
    }
    await page.waitForTimeout(5_000);
  }
  const media = run.outputs?.find((item) => item.taskId === taskId && item.displayType === 'image');
  expect(media, 'This run must retain an actual generated image.').toBeTruthy();
  const imageResponse = await page.request.get(new URL(media!.url, backend).href);
  expect(imageResponse.ok()).toBe(true);
  await writeFile(`${output}/${name}.webp`, await imageResponse.body());
  await writeFile(`${output}/${name}-receipt.json`, JSON.stringify(run, null, 2));
  await expect
    .poll(
      async () =>
        (await inspect(page)).nodes
          .find((node) => node.id === rootId)
          ?.data.blockInstanceV2?.previewStates.some((state) => state.status === 'complete' && state.taskId === taskId),
      { timeout: 60_000 },
    )
    .toBe(true);
  await save(page, name);
  await page.getByTestId('topbar-export').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('topbar-export-workflow-package').click();
  const download = await downloadPromise;
  await download.saveAs(`${output}/${name}-${download.suggestedFilename()}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await expect
    .poll(
      async () =>
        (await inspect(page)).nodes
          .find((node) => node.id === rootId)
          ?.data.blockInstanceV2?.previewStates.some((state) => state.status === 'complete' && state.taskId === taskId),
      { timeout: 60_000 },
    )
    .toBe(true);
  await page.screenshot({ path: `${output}/${name}-reopened.png` });
  await writeFile(`${output}/${name}-reopened.json`, JSON.stringify(await inspect(page), null, 2));
}
