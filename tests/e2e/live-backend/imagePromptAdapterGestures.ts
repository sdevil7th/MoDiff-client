import { expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { waitForRecursiveDomGeometry } from './blockDomGeometry';

/** Native palette adoption, reference upload, parameter edit and both wires. */
export async function addImagePromptAdapter(page: Page, rootId: string, source: string, output: string) {
  const root = page.getByTestId(`user-block-${rootId}`);
  await root.getByLabel('Expand block', { exact: true }).click();
  const graph = () =>
    page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      const instance = flow.nodes.find((node) => node.id === id)!.data.blockInstanceV2!;
      return {
        graph: instance.effectiveGraph,
        views: flow.nodes.filter((node) => node.data.blockProjectionOwnerId === id),
      };
    }, rootId);
  const add = async (label: string, group: string, row: string) => {
    const before = new Set((await graph()).graph.nodes.map((node) => node.nodeId));
    await page.getByTestId('arrange-graph').click();
    await page.getByLabel('Search nodes').fill(label);
    const section = page.getByTestId(`node-group-${group}`).getByRole('button').first();
    if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
    const from = await page.getByTestId(row).boundingBox();
    const to = await page.getByTestId(`rf__node-${rootId}`).boundingBox();
    if (!from || !to) throw new Error('Missing palette/Block drag target.');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 3 });
    await page.mouse.move(to.x + 8, to.y + 35, { steps: 20 });
    await page.mouse.move(to.x + 9, to.y + 36);
    await page.mouse.up();
    await expect
      .poll(async () => (await graph()).graph.nodes.filter((node) => !before.has(node.nodeId)).length)
      .toBe(1);
    return (await graph()).graph.nodes.find((node) => !before.has(node.nodeId))!.nodeId;
  };
  const view = async (id: string) => (await graph()).views.find((node) => node.data.blockProjectionNodeId === id)!;
  const adapter = await add(
    'Image Prompt Adapter',
    'Diffusers-Image',
    'node-row-modules-DiffusersImage-ImagePromptAdapter',
  );
  const adapterView = await view(adapter);
  await page.getByTestId(`rf__node-${adapterView.id}`).getByLabel('Scale', { exact: true }).fill('0.65');
  await page.getByTestId(`rf__node-${adapterView.id}`).getByLabel('Scale', { exact: true }).press('Tab');
  await expect
    .poll(async () =>
      String((await graph()).graph.nodes.find((node) => node.nodeId === adapter)!.data.params!.scale.value),
    )
    .toBe('0.65');
  const reference = await add('Load Image', 'image', 'node-row-modules-Image-Load');
  const referenceView = await view(reference);
  const server = process.env.MODIFF_LIVE_BACKEND_URL ?? 'http://127.0.0.1:8088';
  const response = await page.request.get(`${server}/file?file=${encodeURIComponent(source)}`);
  expect(response.ok()).toBe(true);
  const buffer = await response.body();
  await page.getByTestId(`rf__node-${referenceView.id}`).locator('input[type="file"]').setInputFiles({
    name: 'flux-ip-adapter-reference.webp',
    mimeType: 'image/webp',
    buffer,
  });
  await expect
    .poll(async () => (await graph()).graph.nodes.find((node) => node.nodeId === reference)!.data.params!.file.value)
    .toBeTruthy();
  const current = (await graph()).graph;
  const loader = current.nodes.find(
    (node) => node.data.action === 'LoadPipeline' && node.data.module === 'modules.DiffusersImage',
  )!;
  const generate = current.nodes.find(
    (node) =>
      node.data.module === 'modules.DiffusersImage' &&
      ['Generate', 'ControlGenerate', 'Edit'].includes(String(node.data.action)),
  )!;
  const wire = async (sourceId: string, sourcePort: string, targetId: string, targetPort: string) => {
    await page.getByTestId('arrange-graph').click();
    await waitForRecursiveDomGeometry(page);
    const sourceView = await view(sourceId),
      targetView = await view(targetId);
    const targetBinding =
      Object.entries(targetView.data.blockProjectionPortBindings ?? {}).find(
        ([, binding]) => binding.direction === 'input' && binding.fieldOrPortId === targetPort,
      )?.[0] ?? targetPort;
    const a = await page.getByTestId(`node-handle-${sourceView.id}-${sourcePort}`).boundingBox();
    const b = await page.getByTestId(`node-handle-${targetView.id}-${targetBinding}`).boundingBox();
    if (!a || !b) throw new Error('Missing visible IP-Adapter connection handles.');
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        (await graph()).graph.edges.some(
          (edge) =>
            edge.sourceNodeId === sourceId &&
            edge.sourcePortId === sourcePort &&
            edge.targetNodeId === targetId &&
            edge.targetPortId === targetPort,
        ),
      )
      .toBe(true);
  };
  await wire(adapter, 'adapters', loader.nodeId, 'image_prompt_adapter');
  await wire(reference, 'image', generate.nodeId, 'ip_adapter_image');
  await writeFile(
    `${output}/ip-adapter-native.json`,
    JSON.stringify(
      {
        adapter,
        reference,
        source,
        sourceSha256: createHash('sha256').update(buffer).digest('hex'),
        nativePalette: true,
        nativeUpload: true,
        nativeScaleEdit: true,
        nativeWires: true,
        graph: (await graph()).graph,
      },
      null,
      2,
    ),
  );
  await root.getByLabel('Collapse block', { exact: true }).click();
}
