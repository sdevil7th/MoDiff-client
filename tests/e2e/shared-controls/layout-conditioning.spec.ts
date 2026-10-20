import { expect, test, type Page } from '@playwright/test';

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => expect(pageErrors.get(page)).toEqual([]));

test('generic public inventory defaults to native and submits only the selected immutable format repair', async ({
  page,
}) => {
  await page.goto('/control-state-matrix.html?model-inventory');
  const fixture = page.getByTestId('inventory-fixture');
  await expect(fixture.locator('article')).toHaveCount(1);
  const install = fixture.getByTestId('model-manager-workflow-install-future-native');
  await expect(install).toHaveText('Installed');
  await expect(install).toHaveJSProperty('tagName', 'SPAN');
  const format = fixture.getByRole('button', { name: 'Weight format for Future declared model', exact: true });
  await expect(format).toHaveText('Native');
  const choices = JSON.parse(await page.getByTestId('inventory-choices').innerText());
  for (const choice of choices) {
    await format.click();
    await page.getByRole('option', { name: choice.weightFormat.toUpperCase(), exact: true }).click();
    await expect(install).toHaveText('Repair');
    await install.click();
    const target = JSON.parse(await page.getByTestId('inventory-target').innerText());
    expect(target).toMatchObject({
      repo: choice.repo,
      revision: choice.revision,
      files: choice.downloadFiles,
      repair: true,
      actionLabel: 'Repair',
    });
    expect(target.files).toHaveLength(20);
  }
  const contained = await fixture.locator('article').evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return (
      element.scrollWidth <= element.clientWidth &&
      [...element.querySelectorAll('button,input')].every((control) => {
        const box = control.getBoundingClientRect();
        return box.left >= bounds.left && box.right <= bounds.right;
      })
    );
  });
  expect(contained).toBe(true);
});

function widget(page: Page) {
  return page.getByTestId('layout-widget');
}

async function exported(page: Page) {
  const api = JSON.parse(await page.getByTestId('layout-api').innerText());
  const nodes = (
    Object.values(api.nodes) as { params: Record<string, { value: unknown; sourceId?: string; sourceKey?: string }> }[]
  ).filter((node) => node.params.layout_conditioning);
  expect(nodes).toHaveLength(1);
  return nodes[0]!;
}

async function addRegion(page: Page, description: string) {
  const node = widget(page);
  await node.getByRole('button', { name: 'Add region', exact: true }).click();
  await node.getByLabel('Region description', { exact: true }).fill(description);
  await node.getByRole('button', { name: 'Apply region', exact: true }).click();
}

async function contained(page: Page) {
  return widget(page).evaluate((element) => {
    const outer = element.getBoundingClientRect();
    return {
      width: outer.width,
      overflow: element.scrollWidth - element.clientWidth,
      controls: [...element.querySelectorAll('button,input,textarea,svg')].every((control) => {
        const box = control.getBoundingClientRect();
        return box.left >= outer.left && box.right <= outer.right;
      }),
    };
  });
}

for (const grouped of [false, true]) {
  test(`${grouped ? 'Block' : 'ordinary'} layout controls preserve drafts, ordered edits, Undo and persisted API at 368px`, async ({
    page,
  }) => {
    await page.goto(`/control-state-matrix.html?layout-conditioning${grouped ? '&block' : ''}`);
    const node = widget(page);
    await expect(node.getByRole('radio', { name: 'Raw prompt', exact: true })).toBeChecked();
    const prompt = (await exported(page)).params.prompt!.value;
    await node.getByRole('radio', { name: 'Structured layout', exact: true }).click();
    await node.getByRole('button', { name: 'Add region', exact: true }).click();
    await node.getByLabel('Region description', { exact: true }).fill('  Draft fox 🦊  ');
    expect(await contained(page)).toEqual({ width: 368, overflow: 0, controls: true });
    await node.getByLabel('Target box right', { exact: true }).fill('0');
    await node.getByRole('button', { name: 'Apply region', exact: true }).click();
    await expect(node.getByRole('alert')).toContainText('positive area');
    expect((await exported(page)).params.layout_conditioning!.value).toMatchObject({ regions: [] });
    await node.getByLabel('Target box right', { exact: true }).fill('1');
    const projectionBefore = await node.getByTestId('layout-projection-state').innerText();
    await node.getByRole('button', { name: 'Refresh equivalent controls', exact: true }).click();
    if (grouped) await expect(node.getByTestId('layout-projection-state')).not.toHaveText(projectionBefore);
    await expect(node.getByLabel('Region description', { exact: true })).toHaveValue('  Draft fox 🦊  ');
    await node.getByRole('button', { name: 'Apply region', exact: true }).click();
    await addRegion(page, 'Background');
    await node.getByRole('button', { name: 'Edit region_2', exact: true }).click();
    await node.getByLabel('Region ID', { exact: true }).fill('region_1');
    await node.getByRole('button', { name: 'Apply region', exact: true }).click();
    await expect(node.getByRole('alert')).toContainText('unique');
    await node.getByLabel('Region ID', { exact: true }).fill('region_2');
    await node.getByLabel('Region description', { exact: true }).fill('Backdrop');
    await node.getByRole('button', { name: 'Apply region', exact: true }).click();
    await node.getByRole('button', { name: 'Move region_2 up', exact: true }).click();
    const after = await exported(page);
    expect(after.params.prompt!.value).toBe(prompt);
    expect(after.params.layout_conditioning!.value).toMatchObject({
      regions: [{ id: 'region_2' }, { id: 'region_1', description: '  Draft fox 🦊  ' }],
    });
    await node.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await exported(page)).params.layout_conditioning!.value).toMatchObject({
      regions: [{ id: 'region_1' }, { id: 'region_2' }],
    });
    await node.getByRole('button', { name: 'Redo', exact: true }).click();
    expect(await exported(page)).toEqual(after);
    expect(await contained(page)).toEqual({ width: 368, overflow: 0, controls: true });
    await page.screenshot({ path: test.info().outputPath(`${grouped ? 'block' : 'ordinary'}-layout.png`) });
    await page.reload();
    await expect(node.getByRole('button', { name: 'Edit region_1', exact: true })).toBeVisible();
    expect(await exported(page)).toEqual(after);
    await node.getByRole('button', { name: 'Edit region_1', exact: true }).click();
    await node.getByLabel('Region description', { exact: true }).fill('Uncommitted edit');
    await node.getByRole('button', { name: 'Apply concurrent layout', exact: true }).click();
    await expect(node.getByRole('alert')).toContainText('layout changed while you were editing');
    await expect(node.getByRole('button', { name: 'Apply region', exact: true })).toHaveCount(0);
    expect((await exported(page)).params.layout_conditioning!.value).toMatchObject({
      regions: [{ description: 'Concurrent edit' }],
    });
    await node.getByRole('button', { name: 'Cancel stale draft', exact: true }).click();
    await node.getByRole('radio', { name: 'Raw prompt', exact: true }).click();
    expect((await exported(page)).params.layout_conditioning!.value).toBeNull();
    expect((await exported(page)).params.prompt!.value).toBe(prompt);
  });
}

for (const grouped of [false, true]) {
  test(`version two ${grouped ? 'Block' : 'ordinary'} placement keeps explicit actions and refuses unbound source tools`, async ({
    page,
  }) => {
    await page.goto(`/control-state-matrix.html?layout-conditioning&v2${grouped ? '&block' : ''}`);
    const node = widget(page);
    const prompt = (await exported(page)).params.prompt!.value;
    await node.getByRole('radio', { name: 'Structured layout', exact: true }).click();
    await node.getByRole('button', { name: 'Add region', exact: true }).click();
    await node.getByRole('button', { name: 'Region action', exact: true }).click();
    await expect(page.getByRole('option', { name: 'Relocate from source', exact: true })).toBeDisabled();
    await expect(page.getByRole('option', { name: 'Remove from source', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await node.getByLabel('Region description', { exact: true }).fill('Preserved version two placement');
    expect(await contained(page)).toEqual({ width: 368, overflow: 0, controls: true });
    await node.getByRole('button', { name: 'Apply region', exact: true }).click();
    const after = await exported(page);
    expect(after.params.layout_conditioning!.value).toMatchObject({
      schemaVersion: 2,
      regions: [{ action: 'place', targetBox: [0, 0, 1, 1], description: 'Preserved version two placement' }],
    });
    expect(after.params.prompt!.value).toBe(prompt);
    await node.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await exported(page)).params.layout_conditioning!.value).toMatchObject({ schemaVersion: 2, regions: [] });
    await node.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.reload();
    await expect(node.getByRole('button', { name: 'Edit region_1', exact: true })).toBeVisible();
    expect(await exported(page)).toEqual(after);
    expect(await contained(page)).toEqual({ width: 368, overflow: 0, controls: true });
  });
}

test('layout default, unsupported source regions and disabled inputs keep their declared boundaries', async ({
  page,
}) => {
  await page.goto('/control-state-matrix.html?layout-conditioning&structured-default');
  const node = widget(page);
  await expect(node.getByRole('radio', { name: 'Structured layout', exact: true })).toBeChecked();
  await expect(node.getByRole('button', { name: 'Edit subject', exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.clear());
  await page.goto('/control-state-matrix.html?layout-conditioning&source-region');
  await expect(node.getByRole('alert')).toContainText('source regions are unavailable');
  await expect(node.getByRole('button', { name: 'Add region', exact: true })).toBeDisabled();
  const sourceBefore = await exported(page);
  await node.getByRole('button', { name: 'Edit subject', exact: true }).click();
  await expect(node.getByRole('checkbox', { name: 'Use a source region', exact: true })).toHaveCount(0);
  await node.getByRole('button', { name: 'Apply region', exact: true }).click();
  expect(await exported(page)).toEqual(sourceBefore);
  await page.evaluate(() => localStorage.clear());
  await page.goto('/control-state-matrix.html?layout-conditioning&structured-default&disabled');
  await expect(node.getByRole('radio', { name: 'Raw prompt', exact: true })).toBeDisabled();
  await expect(node.getByRole('button', { name: 'Edit subject', exact: true })).toBeDisabled();
  await expect(node.getByRole('button', { name: 'Remove subject', exact: true })).toBeDisabled();
  await expect(node.getByRole('button', { name: 'Add region', exact: true })).toBeDisabled();
});

for (const mode of ['ordinary', 'Block', 'visual stage Block']) {
  const grouped = mode !== 'ordinary';
  test(`bound ${mode} source actions use task-matched summaries and require explicit rebind`, async ({ page }) => {
    await page.goto(
      `/control-state-matrix.html?layout-conditioning&v2&bound-references${grouped ? '&block' : ''}${mode === 'visual stage Block' ? '&visual-stage' : ''}`,
    );
    const node = widget(page);
    const snapshot = () => page.getByTestId('layout-snapshot').innerText().then(JSON.parse);
    let recorded = await snapshot();
    let referenceIds = ['a', 'b'].map((letter) => `sha256:${letter.repeat(64)}`);
    let taskId = 'reference_task';
    const cacheRequests: string[] = [];
    await page.route('**/cache/**/layout_reference_summary', async (route) => {
      cacheRequests.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: JSON.stringify({
          schemaVersion: 1,
          ownerFingerprint: 'sha256:' + '1'.repeat(64),
          bindingFingerprint: 'sha256:' + '2'.repeat(64),
          taskId,
          attemptIndex: 0,
          runInputHash: 'run_1234abcd',
          references: referenceIds.map((referenceId) => ({
            referenceId,
            sourceSize: [64, 48],
            processedSize: [64, 48],
          })),
        }),
      });
    });
    await page.route('**/runs/reference_*', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          task: { task_id: taskId, attempt_index: 0, run_input_hash: 'run_1234abcd', status: 'completed' },
          workflow_id: 'layout-widget-fixture',
          workflow_snapshot: recorded,
          outputs: [],
        }),
      }),
    );
    const prompt = (await exported(page)).params.prompt!.value;
    await node.getByRole('radio', { name: 'Structured layout', exact: true }).click();
    await node.getByRole('button', { name: 'Read encoded references', exact: true }).click();
    await expect(node.getByRole('status')).toContainText('2 encoded references');
    expect(cacheRequests).toHaveLength(1);
    const supplierId = (await exported(page)).params.reference_binding!.sourceId;
    expect(supplierId).toBeTruthy();
    expect(
      new URL(cacheRequests[0]!).pathname.endsWith(
        `/cache/${encodeURIComponent(supplierId!)}/layout_reference_summary`,
      ),
    ).toBe(true);
    await node.getByRole('button', { name: 'Add region', exact: true }).click();
    await node.getByRole('button', { name: 'Region action', exact: true }).click();
    await page.getByRole('option', { name: 'Remove from source', exact: true }).click();
    await node.getByRole('button', { name: 'Source reference index', exact: true }).click();
    await page.getByRole('option', { name: 'Reference 1: 64×48 → 64×48', exact: true }).click();
    await node.getByLabel('Region description', { exact: true }).fill('Remove only the selected source');
    await expect(node.getByLabel('Target box left', { exact: true })).toHaveCount(0);
    expect(await contained(page)).toEqual({ width: 368, overflow: 0, controls: true });
    await node.getByRole('button', { name: 'Apply region', exact: true }).click();
    const removal = await exported(page);
    expect(removal.params.layout_conditioning!.value).toMatchObject({
      schemaVersion: 2,
      regions: [
        { action: 'remove', targetBox: null, source: { referenceIndex: 1, expectedReferenceId: referenceIds[1] } },
      ],
    });
    expect(removal.params.prompt!.value).toBe(prompt);
    await node.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await exported(page)).params.layout_conditioning!.value).toMatchObject({ regions: [] });
    await node.getByRole('button', { name: 'Redo', exact: true }).click();
    expect(await exported(page)).toEqual(removal);
    for (const action of ['remove', 'relocate']) {
      if (action === 'relocate') {
        await node.getByRole('button', { name: 'Edit region_1', exact: true }).click();
        await node.getByRole('button', { name: 'Region action', exact: true }).click();
        await page.getByRole('option', { name: 'Relocate from source', exact: true }).click();
        await node.getByLabel('Target box left', { exact: true }).fill('0.2');
        await node.getByRole('button', { name: 'Apply region', exact: true }).click();
      }
      const beforeDetach = await exported(page);
      await node.getByRole('button', { name: 'Edit region_1', exact: true }).click();
      await node.getByRole('button', { name: 'Remove source region', exact: true }).click();
      await node.getByRole('button', { name: 'Apply region', exact: true }).click();
      await expect(node.getByRole('alert')).toHaveCount(0);
      const detached = await exported(page);
      expect(detached.params.layout_conditioning!.value).toMatchObject({
        regions: [
          {
            action: 'place',
            description: 'Remove only the selected source',
            targetBox: action === 'remove' ? [0, 0, 1, 1] : [0.2, 0, 1, 1],
          },
        ],
      });
      expect(JSON.stringify(detached.params.layout_conditioning!.value)).not.toContain('referenceIndex');
      expect(detached.params.prompt!.value).toBe(prompt);
      await node.getByRole('button', { name: 'Undo', exact: true }).click();
      expect(await exported(page)).toEqual(beforeDetach);
      if (action === 'relocate') await node.getByRole('button', { name: 'Undo', exact: true }).click();
    }
    await node.getByRole('button', { name: 'Replace reference media', exact: true }).click();
    await expect(node.getByRole('status')).toContainText('Reference context changed');
    await node.getByRole('button', { name: 'Read encoded references', exact: true }).click();
    await expect(node.getByRole('alert')).toContainText('source graph changed');
    // The next mocked normal cache/run pair represents a new actual encoding;
    // it grants display context only. Backend execution still needs its receipt.
    recorded = await snapshot();
    referenceIds = ['c', 'd'].map((letter) => `sha256:${letter.repeat(64)}`);
    taskId = 'reference_reencoded';
    await node.getByRole('button', { name: 'Read encoded references', exact: true }).click();
    await expect(node.getByRole('alert')).toContainText('explicitly rebind');
    expect((await exported(page)).params.layout_conditioning!.value).toMatchObject({
      regions: [
        {
          source: {
            referenceIndex: 1,
            expectedReferenceId: 'sha256:' + 'b'.repeat(64),
          },
        },
      ],
    });
    await node.getByRole('button', { name: 'Edit region_1', exact: true }).click();
    await node.getByRole('button', { name: 'Apply region', exact: true }).click();
    await expect(node.getByRole('alert')).toHaveCount(0);
    const rebound = await exported(page);
    expect(rebound.params.layout_conditioning!.value).toMatchObject({
      regions: [{ source: { referenceIndex: 1, expectedReferenceId: referenceIds[1] }, targetBox: null }],
    });
    await page.reload();
    await expect(node.getByRole('button', { name: 'Edit region_1', exact: true })).toBeVisible();
    expect(await exported(page)).toEqual(rebound);
    await expect(node.getByRole('alert')).toContainText('source regions are unavailable');
    await node.getByRole('button', { name: 'Read encoded references', exact: true }).click();
    await expect(node.getByRole('alert')).toHaveCount(0);
    expect(await exported(page)).toEqual(rebound);
    expect(await contained(page)).toEqual({ width: 368, overflow: 0, controls: true });
  });
}
