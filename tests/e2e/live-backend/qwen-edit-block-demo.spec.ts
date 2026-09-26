import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { output, ready, inspect, connect, save, retainRun } from './qwenDemoGestures';

const adapter = {
  repository: 'lightx2v/Qwen-Image-Edit-2511-Lightning',
  revision: 'd74eba145674fd7e31b949324e148e21e7118abd',
  file: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors',
  sha256: '22226e8d05d354bb356627d428809f5afd7819399b077238a2b70a82883a904f',
  scheduler: {
    base_image_seq_len: 256,
    base_shift: 1.0986122886681098,
    invert_sigmas: false,
    max_image_seq_len: 8192,
    max_shift: 1.0986122886681098,
    num_train_timesteps: 1000,
    shift: 1,
    shift_terminal: null,
    stochastic_sampling: false,
    time_shift_type: 'exponential',
    use_beta_sigmas: false,
    use_dynamic_shifting: true,
    use_exponential_sigmas: false,
    use_karras_sigmas: false,
  },
};
async function runtimeNode(page: Page, key: string, label: string, groupName: string) {
  const before = new Set((await inspect(page)).nodes.map((node) => node.id));
  const search = page.getByLabel('Search nodes');
  if (!(await search.isVisible())) await page.getByTestId('left-tab-nodes').click();
  await search.fill(label);
  const group = page.getByTestId(`node-group-${groupName}`).getByRole('button').first();
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click();
  await page.getByTestId(`node-row-${key.replace(/[^a-zA-Z0-9]+/g, '-')}`).click();
  await expect.poll(async () => (await inspect(page)).nodes.filter((node) => !before.has(node.id)).length).toBe(1);
  const node = (await inspect(page)).nodes.find((node) => !before.has(node.id))!;
  return { id: node.id, frame: page.locator(`.react-flow__node[data-id="${node.id}"]`) };
}
async function scalar(page: Page, value: string, targetType: string) {
  const node = await runtimeNode(page, 'modules.Text.ProcessText', 'Process Text/Data', 'text');
  await node.frame.locator('.modiff-field[data-key="source"] textarea').fill(value);
  await node.frame.locator('.modiff-field[data-key="source"] textarea').blur();
  await node.frame.getByLabel('Operation', { exact: true }).click();
  await page.getByRole('option', { name: 'Convert Data', exact: true }).click();
  await node.frame.getByLabel('Target Type', { exact: true }).click();
  await page.getByRole('option', { name: targetType, exact: true }).click();
  return node;
}

test('demo Qwen editing Block uses an outside LoRA and connected-only ports with retained output', async ({ page }) => {
  test.skip(!output || process.env.MODIFF_RUN_QWEN_EDIT_DEMO !== '1', 'Opt in to retained real Qwen editing proof.');
  test.setTimeout(90 * 60_000);
  page.setDefaultTimeout(30_000);
  page.on('console', (message) => {
    if (/DEMO GESTURE|error/i.test(message.text())) console.log(message.text());
  });
  page.on('pageerror', (error) => console.log('PAGE ERROR', error.message));
  await mkdir(output!, { recursive: true });
  const sourceImage = await readFile(`${output}/Qwen Demo 01 — Product photo.webp`);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await ready(page);
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  const clearActivity = page.getByTitle('Clear finished notifications', { exact: true });
  if (await clearActivity.isVisible().catch(() => false)) await clearActivity.click();
  await page.getByTestId('left-tab-nodes').click();
  await page.getByLabel('Search nodes').fill('Qwen Image Edit Plus — Default');
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes').getByRole('button').first();
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click();
  await page
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image Edit Plus — Default' })
    .click();
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const root = page.locator('[data-block-source="diffusers_catalog"][data-block-schema-version="2"]');
  await expect(root).toHaveCount(1, { timeout: 120_000 });
  const rootId = (await root.getAttribute('data-testid'))!.replace(/^user-block-/u, '');
  const auto = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await auto.getAttribute('aria-checked')) === 'true')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await root
    .locator('.modiff-field[data-key="image"] input[type="file"]')
    .setInputFiles({ name: 'modiff-product-source.webp', mimeType: 'image/webp', buffer: sourceImage });
  await root
    .getByLabel('prompt', { exact: true })
    .fill(
      'Change the sage-green coffee pouch to a rich cobalt-blue pouch. Change the peach background to a soft pale lavender background. Keep the cream label with the exact readable words "MoDiff" and "CREATIVE BLEND", the coffee cup, coffee beans, stone plinth, composition, camera angle, material textures and studio lighting unchanged. Make a polished realistic product photograph.',
    );
  await root.getByLabel('prompt', { exact: true }).blur();
  const before = (await inspect(page)).nodes.find((node) => node.id === rootId)!.data.blockInstanceV2!;
  expect(before.values.num_inference_steps).toBe(40);
  expect(before.values.guidanceScale).toBe(4);

  // Deliberately configure one reusable input. This differs from the temporary
  // LoRA socket, which must never be added to the reusable public interface.
  await root.getByLabel('Configure public inputs, outputs, and controls', { exact: true }).click();
  const editor = page.getByTestId(`configure-block-v2-${rootId}`);
  await expect(page.getByTestId('workspace-panel')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Configure Block interface' })).toHaveCount(0);
  const guidance = before.effectiveInterface.controls.find((control) => control.controlId === 'guidanceScale')!;
  const guidanceNode = before.effectiveGraph.nodes.find((node) => node.nodeId === guidance.binding.nodeId)!;
  await editor.getByRole('button', { name: 'Choose an internal input field', exact: true }).click();
  await page
    .getByRole('option')
    .filter({ hasText: `${guidanceNode.data.label} / Guidance Scale` })
    .click();
  await editor.getByRole('button', { name: 'Add public input', exact: true }).click();
  await editor.getByRole('button', { name: 'Apply interface', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const configured = (await inspect(page)).nodes.find((node) => node.id === rootId)!.data.blockInstanceV2!;
  const guidancePort = configured.effectiveInterface.boundary.inputs.find(
    (port) =>
      port.binding.nodeId === guidance.binding.nodeId && port.binding.fieldOrPortId === guidance.binding.fieldId,
  )!;
  expect(guidancePort).toBeTruthy();
  const steps = await scalar(page, '4', 'Integer');
  const cfg = await scalar(page, '1.0', 'Float');
  await page.getByTestId('arrange-graph').click();
  await connect(
    page,
    page.getByTestId(`node-handle-${steps.id}-output`),
    page.getByTestId(`node-handle-${rootId}-num_inference_steps`),
  );
  await connect(
    page,
    page.getByTestId(`node-handle-${cfg.id}-output`),
    page.getByTestId(`node-handle-${rootId}-${guidancePort.portId}`),
  );
  const lora = await runtimeNode(page, 'modules.ModularDiffusers.Lora', 'Lora', 'adapters');
  await lora.frame.getByLabel('Model', { exact: true }).fill(adapter.repository);
  await lora.frame.getByLabel('Model', { exact: true }).press('Tab');
  for (const [label, value] of [
    ['Weight Name', adapter.file],
    ['Revision', adapter.revision],
    ['Expected SHA-256', adapter.sha256],
    ['Scheduler Class', 'FlowMatchEulerDiscreteScheduler'],
  ]) {
    await lora.frame.getByLabel(label, { exact: true }).fill(value);
    await lora.frame.getByLabel(label, { exact: true }).blur();
  }
  await lora.frame.getByLabel('Scheduler Config (JSON)', { exact: true }).fill(JSON.stringify(adapter.scheduler));
  await lora.frame.getByLabel('Scheduler Config (JSON)', { exact: true }).blur();
  await root.getByLabel('Expand block', { exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  const models = configured.effectiveGraph.nodes.find((node) => node.data.action === 'ModelsLoader')!;
  // Ordinary execution leaves use the React Flow semantic id when their frame
  // does not carry the modular container attribute.
  const loaderId = `block-v2-node:${rootId.length}:${rootId}:${models.nodeId.length}:${models.nodeId}`;
  await page.screenshot({ path: `${output}/Qwen-edit-before-LoRA-connection.png` });
  await writeFile(
    `${output}/Qwen-edit-connectors-debug.json`,
    JSON.stringify(
      await page.evaluate(() => ({
        handles: Array.from(document.querySelectorAll('.react-flow__handle')).map((element) =>
          element.getAttribute('data-testid'),
        ),
        flow: window.__MODIFF_E2E__!.getState().flow,
      })),
      null,
      2,
    ),
  );
  await connect(
    page,
    page.getByTestId(`node-handle-${lora.id}-lora`),
    page.getByTestId(`node-handle-${loaderId}-lora_list`),
  );
  const linked = await inspect(page);
  const crossing = linked.edges.find((edge) => edge.source === lora.id && edge.target === rootId)!;
  expect(crossing.targetHandle).toMatch(/^block-crossing:input:/);
  expect(linked.nodes.find((node) => node.id === rootId)!.data.blockInstanceV2!.effectiveInterface).toEqual(
    configured.effectiveInterface,
  );
  await page.screenshot({ path: `${output}/Qwen-edit-expanded-outside-LoRA.png` });
  await root.getByLabel('Collapse block', { exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  await expect(page.getByTestId(`block-crossing-ports-${rootId}`)).toContainText('Lora');
  await writeFile(
    `${output}/Qwen-edit-authoring-receipt.json`,
    JSON.stringify(
      {
        rootId,
        stepsId: steps.id,
        guidanceId: cfg.id,
        loraId: lora.id,
        crossing,
        adapter,
        configuredInterface: configured.effectiveInterface,
        nativeCatalogInsertion: true,
        nativeInterfaceEditor: true,
        nativeExternalConnection: true,
      },
      null,
      2,
    ),
  );
  await save(page, 'Qwen Demo 02 — Edit with outside LoRA');
  await retainRun(page, 'Qwen Demo 02 — Edit with outside LoRA', rootId);
});
