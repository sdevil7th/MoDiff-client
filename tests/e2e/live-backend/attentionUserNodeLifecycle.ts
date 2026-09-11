import { expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { waitForRecursiveDomGeometry } from './blockDomGeometry';

// Native save/reinsert/edit gestures; store access is read-only evidence.
// This is deliberately separate from inference qualification.
export async function attentionUserNodeLifecycle(page: Page, rootId: string, output: string) {
  const inspect = (id: string) =>
    page.evaluate(async (instanceId) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const { useUserBlockStore } = await import('/src/stores/useUserBlockStore.ts');
      const { blockInstanceValueV2 } = await import('/src/studio/blockSchemaV2.ts');
      const flow = useFlowStore.getState();
      const instance = flow.nodes.find((node) => node.id === instanceId)!.data.blockInstanceV2!;
      const source = instance.effectiveGraph.nodes.find((node) => node.data.action === 'AttentionArguments')!;
      const params = source.data.params!;
      return {
        instance,
        values: Object.fromEntries(
          instance.effectiveInterface.controls.map((control) => [
            control.controlId,
            blockInstanceValueV2(instance, control.controlId),
          ]),
        ),
        scale: params.lora_scale.value ?? params.lora_scale.default,
        enabled: params.enable_lora_scale.value ?? params.enable_lora_scale.default,
        sourceId: source.nodeId,
        sourceView: flow.nodes.find(
          (node) =>
            node.data.blockProjectionOwnerId === instanceId && node.data.blockProjectionNodeId === source.nodeId,
        )?.id,
        library: useUserBlockStore
          .getState()
          .blockDefinitionsV2.find(
            (definition) => definition.definitionId === instance.definitionSnapshot.definitionId,
          ),
      };
    }, id);
  const root = page.getByTestId(`user-block-${rootId}`);
  const before = await inspect(rootId);
  expect(before.enabled).toBe(true);
  const response = page.waitForResponse(
    (entry) => new URL(entry.url()).pathname === '/studio/blocks' && entry.request().method() === 'POST',
  );
  await root.getByTestId(`user-block-save-choices-${rootId}`).click();
  const choices = page.getByTestId(`save-user-block-choices-${rootId}`);
  await choices.getByRole('button', { name: 'Save as new User Node', exact: true }).click();
  const savedResponse = await response;
  expect(savedResponse.ok(), await savedResponse.text()).toBe(true);
  await expect(choices).toHaveCount(0);
  const saved = await inspect(rootId);
  expect(saved.instance.definitionSnapshot.source.kind).toBe('user');
  expect(saved.instance.definitionSnapshot.source.parent?.definitionId).toBe(
    before.instance.definitionSnapshot.definitionId,
  );
  expect(saved.values).toEqual(before.values);
  expect(saved.scale).toEqual(before.scale);
  expect(saved.enabled).toBe(true);
  expect(saved.instance.effectiveGraph.edges).toEqual(before.instance.effectiveGraph.edges);
  expect(saved.library).toBeTruthy();
  const definitionId = saved.instance.definitionSnapshot.definitionId;
  if (!(await page.getByLabel('Search nodes').isVisible())) await page.getByTestId('left-tab-nodes').click();
  await page.getByLabel('Search nodes').fill(definitionId);
  const slug = definitionId.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const existing = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore.getState().nodes.map((node) => node.id);
  });
  await page.getByTestId(`user-block-row-${slug}`).click();
  const findClone = () =>
    page.evaluate(async (ids) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return useFlowStore.getState().nodes.find((node) => node.data.blockInstanceV2 && !ids.includes(node.id))?.id;
    }, existing);
  await expect.poll(findClone).toBeTruthy();
  const cloneId = (await findClone())!;
  const reinserted = await inspect(cloneId);
  expect(reinserted.values).toEqual(saved.values);
  expect(reinserted.scale).toEqual(saved.scale);
  expect(reinserted.enabled).toBe(true);
  expect(reinserted.instance.effectiveGraph.edges).toEqual(saved.instance.effectiveGraph.edges);
  const clone = page.getByTestId(`user-block-${cloneId}`);
  await clone.getByLabel('Expand block', { exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  await waitForRecursiveDomGeometry(page);
  const sourceView = (await inspect(cloneId)).sourceView;
  expect(sourceView).toBeTruthy();
  const scale = page.getByTestId(`rf__node-${sourceView}`).getByLabel('LoRA Scale', { exact: true });
  await scale.fill('0.75');
  await scale.press('Tab');
  await expect.poll(async () => String((await inspect(cloneId)).scale)).toBe('0.75');
  const edited = await inspect(cloneId);
  expect(edited.values).toEqual(saved.values);
  expect(edited.enabled).toBe(true);
  expect(edited.instance.effectiveGraph.edges).toEqual(reinserted.instance.effectiveGraph.edges);
  expect((await inspect(rootId)).scale).toEqual(saved.scale);
  expect((await inspect(rootId)).values).toEqual(saved.values);
  expect(edited.library).toEqual(saved.library);
  await clone.getByLabel('Collapse block', { exact: true }).click();
  await page.getByTestId('topbar-save-workflow').click();
  await expect(page.getByText(/^Saved .* to My workflows$/u).last()).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await expect.poll(async () => String((await inspect(cloneId)).scale)).toBe('0.75');
  expect((await inspect(rootId)).scale).toEqual(saved.scale);
  expect((await inspect(cloneId)).library).toEqual(saved.library);
  expect((await inspect(cloneId)).instance.effectiveGraph.edges).toEqual(edited.instance.effectiveGraph.edges);
  await writeFile(
    `${output}/user-node-lifecycle.json`,
    JSON.stringify(
      {
        scope: 'Native UI lifecycle only; no model generation in this test',
        rootId,
        cloneId,
        before,
        saved,
        reinserted,
        edited,
        refreshed: await inspect(cloneId),
        checks: {
          saved: true,
          reinserted: true,
          internalValuePreserved: true,
          editIsolated: true,
          libraryUnchanged: true,
          edgesPreserved: true,
          refreshPreserved: true,
        },
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: `${output}/user-node-after-refresh.png` });
}
