import { expect, test, type Page } from '@playwright/test';
import { connect, ready, save } from './qwenDemoGestures';

const unicodeText = '夕暮れの観測所\nCafé • Δ';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAGklEQVR4nGNUS3BnIAUwkaSaYVQDcWA4BCsA8wwA5VTmOSsAAAAASUVORK5CYII=',
  'base64',
);

const readGraph = (page: Page) => page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
const exportGraph = (page: Page) => page.evaluate(() => window.__MODIFF_E2E__!.exportAuthorizedApiGraph());
const attemptedSubmissions = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  test.skip(process.env.MODIFF_NODE_UX_ISOLATED !== '1', 'Requires an isolated backend and storage');
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  const submissions: string[] = [];
  attemptedSubmissions.set(page, submissions);
  await page.route(/\/(graph|hf_download|execute)(\/|$)/u, (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    submissions.push(new URL(route.request().url()).pathname);
    return route.abort();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await ready(page);
  const launcher = page.getByTestId('task-launcher');
  const showLauncher = await page.evaluate(() => !window.__MODIFF_E2E__!.getState().studio.launcherDismissed);
  if (showLauncher) await launcher.getByRole('button', { name: 'Close', exact: true }).click({ timeout: 60_000 });
  await expect.poll(async () => (await readGraph(page)).nodes.length).toBe(0);
  await page.getByTestId('left-tab-nodes').click();
  await page.getByRole('checkbox', { name: 'Show implementation nodes', exact: true }).check({ timeout: 60_000 });
});

test.afterEach(({ page }) => expect(attemptedSubmissions.get(page) ?? []).toEqual([]));

async function addNode(page: Page, key: string) {
  const [module, action] = [key.slice(0, key.lastIndexOf('.')), key.slice(key.lastIndexOf('.') + 1)];
  const search = page.getByLabel('Search nodes', { exact: true });
  await search.fill(key);
  await page.getByTestId(`node-row-${key.replaceAll('.', '-')}`).click();
  const find = async () =>
    (await readGraph(page)).nodes.find((node) => node.data.action === action && node.data.module === module)?.id;
  await expect.poll(find).toEqual(expect.any(String));
  const id = (await find())!;
  return { id, node: page.locator(`.react-flow__node[data-id="${id}"]`) };
}

async function arrange(page: Page) {
  await page.getByLabel('Search nodes', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
}

async function reopen(page: Page, title: string) {
  const stored = page.waitForResponse(
    (response) =>
      /\/workflows\/[^/]+$/u.test(new URL(response.url()).pathname) && response.request().method() === 'PUT',
  );
  await save(page, title);
  expect((await stored).ok()).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await expect.poll(async () => (await readGraph(page)).nodes.length).toBeGreaterThan(0);
}

test('ordinary numeric, text, selection and switch controls survive keyboard edits and reload', async ({ page }) => {
  const text = await addNode(page, 'modules.Text.ProcessText');
  const video = await addNode(page, 'modules.Video.Export');
  const data = await addNode(page, 'modules.Primitive.ExportData');
  await arrange(page);

  const prompt = text.node.locator('[data-key="source"] textarea');
  await prompt.fill(unicodeText);
  await prompt.press('Tab');
  const toggle = text.node.locator('[data-key="ignore_empty_lines"]').getByRole('switch');
  await toggle.focus();
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  const index = text.node.locator('[data-key="index"] input');
  await index.fill('-1');
  await index.press('Enter');
  await expect.poll(async () => (await exportGraph(page)).nodes[text.id]?.params.index?.value).toBe(-1);
  await index.fill('0');
  await index.press('Tab');

  const fps = video.node.locator('[data-key="fps"] input');
  await fps.fill('23.97');
  await fps.press('Tab');
  await fps.fill('31');
  await fps.press('Escape');
  await expect(fps).toHaveValue('23.97');
  const quality = video.node.locator('[data-key="quality"] input');
  await quality.focus();
  await quality.press('ArrowDown');
  await quality.press('Enter');
  await expect(quality).toHaveValue('7');

  const selectFormat = data.node.locator('[data-key="format"]').getByRole('button');
  await selectFormat.focus();
  await selectFormat.press('Space');
  await expect(page.getByRole('option', { name: 'text', exact: true })).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(selectFormat).toHaveText('text');

  const before = await exportGraph(page);
  expect(before.nodes[text.id]?.params.source?.value).toBe(unicodeText);
  expect(before.nodes[text.id]?.params.ignore_empty_lines?.value).toBe(true);
  expect(before.nodes[text.id]?.params.index?.value).toBe(0);
  expect(before.nodes[video.id]?.params.fps?.value).toBe(23.97);
  expect(before.nodes[video.id]?.params.quality?.value).toBe(7);
  expect(before.nodes[data.id]?.params.format?.value).toBe('text');
  await reopen(page, 'Ordinary keyboard field review');
  await expect.poll(async () => (await exportGraph(page)).nodes).toEqual(before.nodes);
  await expect(prompt).toHaveValue(unicodeText);
  await expect(index).toHaveValue('0');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(fps).toHaveValue('23.97');
  await expect(selectFormat).toHaveText('text');
  await page.screenshot({ path: test.info().outputPath('reopened-ordinary-controls.png') });
});

test('ordinary file upload, incompatible wiring, Undo and typed route survive reload', async ({ page }) => {
  const text = await addNode(page, 'modules.Primitive.TextValue');
  const source = await addNode(page, 'modules.Image.Load');
  const resize = await addNode(page, 'modules.Image.Resize');
  const upload = source.node.locator('[data-key="file"] input[type="file"]');
  const uploadedResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/file' && response.request().method() === 'POST',
  );
  await upload.setInputFiles({ name: 'ordinary-audit.png', mimeType: 'image/png', buffer: png });
  expect(await (await uploadedResponse).json()).toMatchObject({ path: expect.anything() });
  const uploaded = async () => (await exportGraph(page)).nodes[source.id]?.params.file?.value;
  await expect.poll(uploaded).toEqual([expect.any(String)]);
  const exactFile = await uploaded();
  await arrange(page);

  const handle = (id: string, key: string) => page.getByTestId(`node-handle-${id}-${key}`);
  await connect(page, handle(text.id, 'output'), handle(resize.id, 'image'));
  await expect.poll(async () => (await readGraph(page)).edges).toEqual([]);
  await connect(page, handle(source.id, 'image'), handle(resize.id, 'image'));
  const connection = { source: source.id, sourceHandle: 'image', target: resize.id, targetHandle: 'image' };
  await expect.poll(async () => (await readGraph(page)).edges).toMatchObject([connection]);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await readGraph(page)).edges).toEqual([]);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await readGraph(page)).edges).toMatchObject([connection]);

  const before = await exportGraph(page);
  expect(before.nodes[resize.id]?.params.image).toMatchObject({ sourceId: source.id, sourceKey: 'image' });
  await reopen(page, 'Ordinary file and socket review');
  await expect.poll(uploaded).toEqual(exactFile);
  const preview = source.node.locator('[data-key="file"] img');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(16);
  await expect.poll(async () => (await readGraph(page)).edges).toMatchObject([connection]);
  await expect.poll(async () => (await exportGraph(page)).nodes).toEqual(before.nodes);
  await page.screenshot({ path: test.info().outputPath('reopened-ordinary-file-and-wire.png') });
});
