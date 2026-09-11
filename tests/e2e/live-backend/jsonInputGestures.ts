import { expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { waitForRecursiveDomGeometry } from './blockDomGeometry';

/** Real palette additions and wires for multiple independently editable JSON inputs. */
export async function addJsonInputs(page: Page, rootId: string, values: Record<string, unknown>, output: string) {
  const root = page.getByTestId(`user-block-${rootId}`);
  await root.getByLabel('Expand block', { exact: true }).click();
  const graph = () =>
    page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      return {
        graph: flow.nodes.find((node) => node.id === id)!.data.blockInstanceV2!.effectiveGraph,
        views: flow.nodes.filter((node) => node.data.blockProjectionOwnerId === id),
      };
    }, rootId);
  for (const [port, value] of Object.entries(values)) {
    const before = new Set((await graph()).graph.nodes.map((node) => node.nodeId));
    await page.getByTestId('arrange-graph').click();
    await page.getByLabel('Search nodes').fill('Process Text/Data');
    const section = page.getByTestId('node-group-text').getByRole('button').first();
    if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
    await waitForRecursiveDomGeometry(page);
    // Arrange animates the viewport independently of graph geometry. Measure
    // the native drop point only after the screen-space frame has settled.
    let previousBox = '';
    let stableSamples = 0;
    await expect
      .poll(
        async () => {
          const box = await page.getByTestId(`rf__node-${rootId}`).boundingBox();
          const currentBox = JSON.stringify(box);
          stableSamples = currentBox === previousBox ? stableSamples + 1 : 0;
          previousBox = currentBox;
          return stableSamples;
        },
        { intervals: [100] },
      )
      .toBeGreaterThanOrEqual(3);
    const target = await page.getByTestId(`rf__node-${rootId}`).boundingBox();
    const pane = page.locator('.react-flow__pane');
    const paneBox = await pane.boundingBox();
    if (!target || !paneBox) throw new Error('Missing native JSON producer drop target.');
    // Expanded empty content is pointer-transparent: the pane is the real
    // native drop receiver; graph coordinates determine Block adoption.
    await page.getByTestId('node-row-modules-Text-ProcessText').dragTo(pane, {
      targetPosition: { x: target.x + 8 - paneBox.x, y: target.y + 35 - paneBox.y },
    });
    await expect
      .poll(async () => (await graph()).graph.nodes.filter((node) => !before.has(node.nodeId)).length)
      .toBe(1);
    const sourceId = (await graph()).graph.nodes.find((node) => !before.has(node.nodeId))!.nodeId;
    let state = await graph();
    let view = state.views.find((node) => node.data.blockProjectionNodeId === sourceId)!;
    const source = page.getByTestId(`rf__node-${view.id}`);
    await source.getByLabel('Source', { exact: true }).fill(JSON.stringify(value));
    await source.getByLabel('Source', { exact: true }).press('Tab');
    await source.getByLabel('Operation', { exact: true }).click();
    await page.getByRole('option', { name: 'Convert Data', exact: true }).click();
    await expect
      .poll(async () => {
        const params = (await graph()).graph.nodes.find((node) => node.nodeId === sourceId)!.data.params!;
        return {
          source: params.source.value,
          operation: params.operation.value,
          target: params.target_type.value ?? params.target_type.default,
        };
      })
      .toEqual({ source: JSON.stringify(value), operation: 'data_conversion', target: 'json' });
    await page.getByTestId('arrange-graph').click();
    await waitForRecursiveDomGeometry(page);
    state = await graph();
    view = state.views.find((node) => node.data.blockProjectionNodeId === sourceId)!;
    const consumers = state.graph.nodes.filter(
      (node) =>
        node.data.module === 'modules.DiffusersImage' &&
        ['Generate', 'Edit', 'Inpaint'].includes(String(node.data.action)) &&
        Object.hasOwn(node.data.params ?? {}, port),
    );
    expect(consumers, `One exact image consumer must declare optional input ${port}`).toHaveLength(1);
    const generator = consumers[0]!;
    const generatorView = state.views.find((node) => node.data.blockProjectionNodeId === generator.nodeId)!;
    const socket =
      Object.entries(generatorView.data.blockProjectionPortBindings ?? {}).find(
        ([, binding]) => binding.direction === 'input' && binding.fieldOrPortId === port,
      )?.[0] ?? port;
    const a = await page.getByTestId(`node-handle-${view.id}-output`).boundingBox();
    const b = await page.getByTestId(`node-handle-${generatorView.id}-${socket}`).boundingBox();
    if (!a || !b) throw new Error(`Missing visible JSON connection for ${port}.`);
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        (await graph()).graph.edges.some(
          (edge) =>
            edge.sourceNodeId === sourceId && edge.targetNodeId === generator.nodeId && edge.targetPortId === port,
        ),
      )
      .toBe(true);
  }
  await writeFile(
    `${output}/native-json-inputs.json`,
    JSON.stringify({ values, graph: (await graph()).graph }, null, 2),
  );
  await root.getByLabel('Collapse block', { exact: true }).click();
}
