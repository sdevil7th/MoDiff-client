import { expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { waitForRecursiveDomGeometry } from './blockDomGeometry';

/** Save/reinsert through native controls; evaluate is read-only inspection. */
export async function verifyCatalogUserNodeReuse(page: Page, rootId: string, output: string) {
  const inspect = (id: string) =>
    page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const { blockInstanceValueV2 } = await import('/src/studio/blockSchemaV2.ts');
      const instance = useFlowStore.getState().nodes.find((node) => node.id === id)!.data.blockInstanceV2!;
      const ids = new Set([
        ...instance.effectiveInterface.controls.map((control) => control.controlId),
        ...instance.effectiveInterface.boundary.inputs.map((port) => port.portId),
        ...Object.keys(instance.values),
      ]);
      return {
        instance,
        values: Object.fromEntries([...ids].sort().map((key) => [key, blockInstanceValueV2(instance, key)])),
        boundary: instance.effectiveInterface.boundary,
      };
    }, id);
  const root = page.getByTestId(`user-block-${rootId}`);
  await root.getByLabel('Collapse block', { exact: true }).click();
  const before = await inspect(rootId);
  const request = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/studio/blocks' && response.request().method() === 'POST',
  );
  await root.getByTestId(`user-block-save-choices-${rootId}`).click();
  const choices = page.getByTestId(`save-user-block-choices-${rootId}`);
  await choices.getByRole('button', { name: 'Save as new User Node', exact: true }).click();
  const response = await request;
  expect(response.ok(), await response.text()).toBe(true);
  await expect(choices).toHaveCount(0);
  const saved = await inspect(rootId);
  expect(saved.instance.definitionSnapshot.source.kind).toBe('user');
  expect(saved.values).toEqual(before.values);
  expect(saved.boundary).toEqual(before.boundary);
  const definition = saved.instance.definitionSnapshot;
  await page.getByLabel('Search nodes').fill(definition.definitionId);
  const rowId = definition.definitionId.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  await page.getByTestId(`user-block-row-${rowId}`).click();
  const findCopy = () =>
    page.evaluate(
      async ({ rootId, definitionId }) =>
        (await import('/src/stores/useFlowStore.ts')).useFlowStore
          .getState()
          .nodes.find(
            (node) => node.id !== rootId && node.data.blockInstanceV2?.definitionSnapshot.definitionId === definitionId,
          )?.id,
      { rootId, definitionId: definition.definitionId },
    );
  await expect.poll(findCopy).toBeTruthy();
  const copyId = (await findCopy())!;
  const copy = await inspect(copyId);
  expect(copy.instance.definitionSnapshot).toEqual(definition);
  expect(copy.values).toEqual(saved.values);
  expect(copy.boundary).toEqual(saved.boundary);
  const copyFrame = page.getByTestId(`user-block-${copyId}`);
  await page.getByTestId('arrange-graph').click();
  // Arrange legitimately moves both roots. Isolate the subsequent text edit
  // from that earlier explicit layout operation, retaining exact comparisons.
  const originalBeforeEdit = await inspect(rootId);
  const prompt = copyFrame.locator('textarea:not([disabled]):not([readonly])').first();
  const originalPrompt = await prompt.inputValue();
  await prompt.fill(`${originalPrompt} Independent reused instance.`);
  await prompt.blur();
  await expect
    .poll(async () => (await inspect(copyId)).values.prompt)
    .toBe(`${originalPrompt} Independent reused instance.`);
  expect((await inspect(rootId)).instance).toEqual(originalBeforeEdit.instance);
  expect((await inspect(copyId)).instance.definitionSnapshot).toEqual(definition);
  const edited = await inspect(copyId);
  expect({ ...edited.values, prompt: saved.values.prompt }).toEqual(saved.values);
  await copyFrame.getByLabel('Expand block', { exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  await waitForRecursiveDomGeometry(page);
  await page.screenshot({ path: `${output}-user-node.png` });
  await writeFile(
    `${output}-user-node.json`,
    JSON.stringify(
      {
        originalRootId: rootId,
        copyId,
        definition,
        before: before.values,
        reused: copy.values,
        edited: edited.values,
        nativeSave: true,
        nativeReinsert: true,
        independentEdit: true,
        unchangedOriginal: true,
        unchangedSavedDefinition: true,
        containment: true,
      },
      null,
      2,
    ),
  );
}
