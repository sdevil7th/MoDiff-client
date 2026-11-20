import { expect, test } from '@playwright/test';
import { ready } from './qwenDemoGestures';

test('selection toolbar stays off the adjacent editable node when there is room below the selection', async ({
  page,
}, testInfo) => {
  test.skip(process.env.MODIFF_NODE_UX_ISOLATED !== '1', 'Requires an isolated live backend');
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto('/');
  await ready(page);
  await page.waitForFunction(() => window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated);
  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
    const { createNodeFromRegistry } = await import('/src/workflow/nodeFactory.ts');
    const nodes = ['toolbar-neighbor', 'toolbar-selected'].map((id, index) => {
      const node = createNodeFromRegistry('modules.Primitive.TextValue', useNodesStore.getState().nodesRegistry, {
        x: 360,
        y: 140 + 210 * index,
      });
      if (!node) throw new Error('The Text Value fixture is unavailable.');
      return { ...node, id };
    });
    useFlowStore.getState().replaceGraph({ nodes, edges: [] });
  });
  const neighbor = page.locator('.react-flow__node[data-id="toolbar-neighbor"]');
  const selected = page.locator('.react-flow__node[data-id="toolbar-selected"]');
  const field = neighbor.getByRole('textbox', { name: 'Text', exact: true });
  await expect(field).toBeVisible();
  await expect(selected).toBeVisible();
  const geometry = await page.evaluate(() => {
    const field = document.querySelector('[data-id="toolbar-neighbor"] textarea, [data-id="toolbar-neighbor"] input')!;
    const fieldBounds = field.getBoundingClientRect();
    const node = document.querySelector('[data-id="toolbar-selected"]')!.getBoundingClientRect();
    const transform = new DOMMatrixReadOnly(
      getComputedStyle(document.querySelector('.react-flow__viewport')!).transform,
    );
    const fieldCenterY = fieldBounds.top + fieldBounds.height / 2;
    return { delta: (fieldCenterY + 32 - node.top) / transform.a, fieldBounds: fieldBounds.toJSON() };
  });
  await page.evaluate(async (delta) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const flow = useFlowStore.getState();
    flow.onNodesChange([
      {
        type: 'position',
        id: 'toolbar-selected',
        position: { x: 360, y: 350 + delta },
      },
    ]);
  }, geometry.delta);
  await selected.getByText('Text Value', { exact: true }).click();
  const toolbar = page.getByTestId('selection-toolbar');
  await expect(toolbar).toBeVisible();
  await testInfo.attach('placement', {
    body: JSON.stringify(
      await field.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          field: bounds.toJSON(),
          toolbar: document.querySelector('[data-testid="selection-toolbar"]')?.getBoundingClientRect().toJSON(),
          hit: document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.outerHTML,
        };
      }),
    ),
    contentType: 'application/json',
  });
  await expect
    .poll(() =>
      field.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === element;
      }),
    )
    .toBe(true);
  await page.getByTestId('selection-toolbar-inspect-node').click({ trial: true });
  await field.click();
  await field.fill('Edited adjacent to the selection');
  await expect(field).toHaveValue('Edited adjacent to the selection');
  await page.screenshot({ path: testInfo.outputPath('toolbar-clearance.png') });
});
