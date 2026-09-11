import { expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { waitForRecursiveDomGeometry } from './blockDomGeometry';

/** Both configuration nodes and both connections use the actual palette/handles. */
export async function addControlComponents(page: Page, rootId: string, output: string, union = false) {
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
  const add = async () => {
    const before = new Set((await graph()).graph.nodes.map((node) => node.nodeId));
    await page.getByTestId('arrange-graph').click();
    await page.getByLabel('Search nodes').fill('Control Component');
    const section = page.getByTestId('node-group-Diffusers-Image').getByRole('button').first();
    if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
    const source = await page.getByTestId('node-row-modules-DiffusersImage-ControlComponent').boundingBox();
    const target = await page.getByTestId(`rf__node-${rootId}`).boundingBox();
    if (!source || !target) throw new Error('Missing native Control Component drag target.');
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 10, source.y + source.height / 2, { steps: 3 });
    await page.mouse.move(target.x + 8, target.y + 35, { steps: 20 });
    await page.mouse.move(target.x + 9, target.y + 36);
    await page.mouse.up();
    await expect
      .poll(async () => (await graph()).graph.nodes.filter((node) => !before.has(node.nodeId)).length)
      .toBe(1);
    return (await graph()).graph.nodes.find((node) => !before.has(node.nodeId))!.nodeId;
  };
  const first = await add();
  let second: string | undefined;
  if (union) {
    const view = (await graph()).views.find((node) => node.data.blockProjectionNodeId === first)!;
    const node = page.getByTestId(`rf__node-${view.id}`);
    await node.getByLabel('Control Model', { exact: true }).fill('InstantX/FLUX.1-dev-Controlnet-Union');
    await node.getByLabel('Control Model', { exact: true }).press('Tab');
    await expect
      .poll(async () => (await graph()).graph.nodes.find((item) => item.nodeId === first)!.data.params!.model_id.value)
      .toEqual({ source: 'hub', value: 'InstantX/FLUX.1-dev-Controlnet-Union' });
    await node.getByLabel('Revision', { exact: true }).fill('4f32d6f2b220f8873d49bb8acc073e1df180c994');
    await node.getByLabel('Revision', { exact: true }).press('Tab');
    await node.getByRole('switch', { name: 'Shared Union Conditions' }).click();
    await expect
      .poll(
        async () =>
          (await graph()).graph.nodes.find((item) => item.nodeId === first)!.data.params!.shared_conditions.value,
      )
      .toBe(true);
  } else {
    second = await add();
  }
  const loader = (await graph()).graph.nodes.find(
    (node) => node.data.module === 'modules.DiffusersImage' && node.data.action === 'LoadPipeline',
  )!;
  const wire = async (sourceId: string, targetId: string, port: string) => {
    await page.getByTestId('arrange-graph').click();
    await waitForRecursiveDomGeometry(page);
    const state = await graph();
    const source = state.views.find((node) => node.data.blockProjectionNodeId === sourceId)!;
    const target = state.views.find((node) => node.data.blockProjectionNodeId === targetId)!;
    const binding =
      Object.entries(target.data.blockProjectionPortBindings ?? {}).find(
        ([, value]) => value.direction === 'input' && value.fieldOrPortId === port,
      )?.[0] ?? port;
    const a = await page.getByTestId(`node-handle-${source.id}-components`).boundingBox();
    const b = await page.getByTestId(`node-handle-${target.id}-${binding}`).boundingBox();
    if (!a || !b) throw new Error('Missing visible Control Component sockets.');
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        (await graph()).graph.edges.some(
          (edge) =>
            edge.sourceNodeId === sourceId &&
            edge.sourcePortId === 'components' &&
            edge.targetNodeId === targetId &&
            edge.targetPortId === port,
        ),
      )
      .toBe(true);
  };
  if (second) await wire(first, second, 'previous');
  await wire(second ?? first, loader.nodeId, 'control_components');
  await writeFile(
    `${output}/control-components-native.json`,
    JSON.stringify(
      {
        nativePalette: true,
        nativeUnionModelEdit: union,
        nativeWires: true,
        first,
        second,
        graph: (await graph()).graph,
      },
      null,
      2,
    ),
  );
  await root.getByLabel('Collapse block', { exact: true }).click();
}
