import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

async function blockInstanceSnapshot(page: Page, rootId: string) {
  return page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const instance = useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2;
    if (!instance) throw new Error(`Missing persisted Block instance ${id}`);
    return JSON.parse(JSON.stringify(instance)) as typeof instance;
  }, rootId);
}

async function waitForWorkspaceStartup(page: Page, timeout = 300_000) {
  const deadline = Date.now() + timeout;
  const gate = page.getByTestId('startup-workspace-gate');
  while (Date.now() < deadline) {
    if ((await gate.count()) === 0) return;
    const retry = gate.getByRole('button', { name: 'Retry' });
    if (await retry.isVisible({ timeout: 250 }).catch(() => false)) await retry.click();
    await page.waitForTimeout(500);
  }
  throw new Error('Workspace startup did not recover.');
}

async function projectionSnapshot(page: Page) {
  return page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const state = useFlowStore.getState();
    const root = state.nodes.find(
      (node) => node.data.blockInstanceV2?.definitionSnapshot.source.pipelineClass === 'QwenImageModularPipeline',
    );
    if (!root?.data.blockInstanceV2) return null;
    const projections = state.nodes.filter((node) => node.data.blockProjectionOwnerId === root.id);
    const projectionEdges = state.edges.filter((edge) => edge.data?.blockProjectionOwnerId === root.id);
    return {
      rootId: root.id,
      expanded: root.data.blockInstanceV2.presentation.expanded,
      collapsedIds: root.data.blockInstanceV2.presentation.collapsedContainerNodeIds ?? [],
      effectiveNodeCount: root.data.blockInstanceV2.effectiveGraph.nodes.length,
      visibleProjectionCount: projections.length,
      visibleModularCount: projections.filter((node) => node.data.blockProjectionModular).length,
      visibleProjectionEdgeCount: projectionEdges.length,
      semanticEdgeCount: root.data.blockInstanceV2.effectiveGraph.edges.length,
      visibleBoundaryHandleCount: projections.reduce(
        (count, node) => count + Object.keys(node.data.blockProjectionPortBindings ?? {}).length,
        0,
      ),
      visibleDepths: projections.map((node) => node.data.blockProjectionDepth ?? -1),
      visibleExpandedContainers: projections
        .filter((node) => node.data.blockProjectionContainer && node.data.blockProjectionContainerExpanded !== false)
        .map((node) => node.data.blockProjectionNodeId),
      portlessVisibleContainers: projections
        .filter(
          (node) =>
            node.data.blockProjectionContainer && Object.keys(node.data.blockProjectionPortBindings ?? {}).length === 0,
        )
        .map((node) => node.data.blockProjectionNodeId),
      inactiveOptionalPaths: root.data.blockInstanceV2.effectiveGraph.nodes.flatMap((node) => {
        const path = node.modularDiffusers?.placementPath?.join('/');
        return path === 'vae_encoder' || path === 'controlnet_vae_encoder' ? [path] : [];
      }),
    };
  });
}

async function projectionGeometryIssues(page: Page) {
  return page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const state = useFlowStore.getState();
    const root = state.nodes.find(
      (node) => node.data.blockInstanceV2?.definitionSnapshot.source.pipelineClass === 'QwenImageModularPipeline',
    );
    if (!root) return ['Qwen root is absent'];
    const projected = state.nodes.filter((node) => node.data.blockProjectionOwnerId === root.id);
    const all = [root, ...projected];
    const byId = new Map(all.map((node) => [node.id, node]));
    const issues: string[] = [];
    const dimension = (node: (typeof all)[number]) => ({
      width: node.width ?? node.measured?.width ?? 0,
      height: node.height ?? node.measured?.height ?? 0,
    });
    const childrenByParent = new Map<string, typeof projected>();
    projected.forEach((node) => {
      const parentId = node.parentId ?? root.id;
      childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), node]);
    });
    childrenByParent.forEach((children, parentId) => {
      const parent = byId.get(parentId);
      if (!parent) {
        issues.push(`${parentId}: missing parent`);
        return;
      }
      const parentSize = dimension(parent);
      children.forEach((child) => {
        const childSize = dimension(child);
        if (child.position.x < -1 || child.position.y < 43) issues.push(`${child.id}: starts outside ${parentId}`);
        if (child.position.x + childSize.width > parentSize.width + 1)
          issues.push(
            `${child.id}: right edge ${child.position.x + childSize.width} escapes ${parentId} width ${parentSize.width}`,
          );
        if (child.position.y + childSize.height > parentSize.height + 1)
          issues.push(
            `${child.id}: bottom edge ${child.position.y + childSize.height} escapes ${parentId} height ${parentSize.height}`,
          );
      });
      children.forEach((left, leftIndex) => {
        const leftSize = dimension(left);
        children.slice(leftIndex + 1).forEach((right) => {
          const rightSize = dimension(right);
          const overlaps =
            left.position.x < right.position.x + rightSize.width - 1 &&
            left.position.x + leftSize.width > right.position.x + 1 &&
            left.position.y < right.position.y + rightSize.height - 1 &&
            left.position.y + leftSize.height > right.position.y + 1;
          if (overlaps) issues.push(`${left.id}: overlaps sibling ${right.id} in ${parentId}`);
        });
      });
    });

    // Store geometry can be correct while React Flow retains an obsolete DOM
    // measurement for a long-lived node id. Verify the actual browser boxes as
    // well, which is the failure visible in the reported screenshots.
    childrenByParent.forEach((children, parentId) => {
      const parentElement = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(parentId)}"]`);
      if (!parentElement) return;
      const parentRect = parentElement.getBoundingClientRect();
      children.forEach((child) => {
        const childElement = document.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${CSS.escape(child.id)}"]`,
        );
        if (!childElement) return;
        const childRect = childElement.getBoundingClientRect();
        if (
          childRect.left < parentRect.left - 2 ||
          childRect.top < parentRect.top + 1 ||
          childRect.right > parentRect.right + 2 ||
          childRect.bottom > parentRect.bottom + 2
        )
          issues.push(`${child.id}: DOM box escapes ${parentId}`);
      });
    });
    return issues;
  });
}

async function waitForStableProjection(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      ),
  );
  await expect.poll(() => projectionGeometryIssues(page), { timeout: 15_000 }).toEqual([]);
}

test('fresh Qwen Block expands progressively and every visible upstream placement uses the shared Block frame', async ({
  page,
}) => {
  test.setTimeout(process.env.MODIFF_RUN_QWEN_NESTED_REUSE === '1' ? 300_000 : 120_000);
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('nested-block-progressive-disclosure')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('nested-block-progressive-disclosure', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);

  const advancedWorkflow = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advancedWorkflow.isVisible({ timeout: 1000 }).catch(() => false)) await advancedWorkflow.click();
  await page.getByTestId('topbar-new-workflow').click();
  await expect(advancedWorkflow).toBeVisible();
  await advancedWorkflow.click();
  const search = page.getByLabel('Search nodes');
  if (!(await search.isVisible({ timeout: 1000 }).catch(() => false))) await page.getByTestId('left-tab-nodes').click();
  await search.fill('Qwen Image — Text To Image');
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  const disclosure = group.getByRole('button').first();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await row.click();

  const root = page
    .locator('[data-block-source="diffusers_catalog"]')
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(root).toHaveCount(1, { timeout: 30_000 });
  await root.getByLabel('Expand block').click();

  await expect.poll(() => projectionSnapshot(page)).not.toBeNull();
  const initial = await projectionSnapshot(page);
  expect(initial?.expanded).toBe(true);
  expect(initial?.effectiveNodeCount).toBeGreaterThan(initial?.visibleProjectionCount ?? 0);
  expect(initial?.collapsedIds.length).toBeGreaterThan(0);
  expect(initial?.visibleExpandedContainers).toEqual([]);
  expect(initial?.portlessVisibleContainers).toEqual([]);
  expect(initial?.inactiveOptionalPaths).toEqual([]);
  expect(Math.max(...(initial?.visibleDepths ?? [-1]))).toBe(0);
  expect(initial?.visibleProjectionEdgeCount).toBeGreaterThan(0);
  expect(initial?.visibleBoundaryHandleCount).toBeGreaterThan(0);
  expect(initial?.semanticEdgeCount).toBeGreaterThanOrEqual(initial?.visibleProjectionEdgeCount ?? 0);
  await expect(page.locator('[data-block-projection="modular-diffusers"]')).toHaveCount(
    initial?.visibleModularCount ?? 0,
  );
  await expect(page.locator('.react-flow__edge').first()).toBeVisible();
  await waitForStableProjection(page);

  const connectorBlock = page
    .locator('[data-block-projection="modular-diffusers"]')
    .filter({ has: page.locator('[data-testid^="node-connector-tray-"]') })
    .first();
  const resizeGrip = connectorBlock.getByTestId('node-resize-grip');
  await expect(resizeGrip).toBeVisible();
  const gripBox = await resizeGrip.boundingBox();
  if (!gripBox) throw new Error('The internal Block resize grip has no layout box.');
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox.x - 500, gripBox.y - 500, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await projectionSnapshot(page))?.visibleProjectionEdgeCount)
    .toBe(initial?.visibleProjectionEdgeCount);
  await expect(connectorBlock.locator('[data-testid^="node-connector-tray-"]')).toBeVisible();
  await expect(page.locator('.react-flow__edge').first()).toBeVisible();

  const firstContainerToggle = page.locator('[data-testid^="toggle-modular-container-"]').first();
  await expect(firstContainerToggle).toBeVisible();
  await firstContainerToggle.click();
  await expect
    .poll(async () => (await projectionSnapshot(page))?.visibleProjectionCount ?? 0)
    .toBeGreaterThan(initial?.visibleProjectionCount ?? 0);
  const opened = await projectionSnapshot(page);
  expect(opened?.collapsedIds.length).toBe((initial?.collapsedIds.length ?? 1) - 1);
  expect(opened?.visibleExpandedContainers).toHaveLength(1);
  await expect(page.locator('[data-block-projection="modular-diffusers"]')).toHaveCount(
    opened?.visibleModularCount ?? 0,
  );
  await waitForStableProjection(page);

  // Open every subsequently revealed Modular container and recheck every
  // parent/child boundary after each projection change. This catches nested
  // overflow and sibling overlap, not merely the root frame.
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const next = await page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const state = useFlowStore.getState();
      const root = state.nodes.find(
        (node) => node.data.blockInstanceV2?.definitionSnapshot.source.pipelineClass === 'QwenImageModularPipeline',
      );
      if (!root?.data.blockInstanceV2) return null;
      const candidate = state.nodes.find(
        (node) =>
          node.data.blockProjectionOwnerId === root.id &&
          node.data.blockProjectionContainer &&
          node.data.blockProjectionContainerExpanded === false,
      );
      if (!candidate?.data.blockProjectionNodeId) return null;
      state.toggleBlockContainerExpandedV2(root.id, candidate.data.blockProjectionNodeId);
      return candidate.data.blockProjectionNodeId;
    });
    if (!next) break;
    await waitForStableProjection(page);
  }
  const fullyOpened = await projectionSnapshot(page);
  expect(fullyOpened?.visibleProjectionCount).toBe(fullyOpened?.effectiveNodeCount);
  expect(fullyOpened?.visibleExpandedContainers.length).toBeGreaterThanOrEqual(4);
  expect(fullyOpened?.portlessVisibleContainers).toEqual([]);

  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill('Nested Block Progressive Disclosure Proof');
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await expect.poll(() => projectionSnapshot(page)).not.toBeNull();
  const refreshed = await projectionSnapshot(page);
  expect(refreshed?.expanded).toBe(true);
  expect(refreshed?.collapsedIds).toEqual(fullyOpened?.collapsedIds);
  expect(refreshed?.visibleProjectionCount).toBe(fullyOpened?.visibleProjectionCount);
  expect(refreshed?.visibleExpandedContainers).toEqual(fullyOpened?.visibleExpandedContainers);
  await expect(page.locator('[data-block-projection="modular-diffusers"]')).toHaveCount(
    refreshed?.visibleModularCount ?? 0,
  );
  await waitForStableProjection(page);

  if (process.env.MODIFF_RUN_QWEN_NESTED_REUSE !== '1') return;
  const rootId = refreshed!.rootId;
  const nestedPrompt =
    'A precision clockmaker assembling a transparent astronomical watch beneath a skylight, brass gears, ' +
    'sapphire bridges, fine workshop dust, controlled cinematic light, crisp macro product photography.';
  const rootNode = page.locator(`.react-flow__node[data-id="${rootId}"]`);
  await rootNode.getByLabel('Collapse block', { exact: true }).click();
  await rootNode.getByLabel('prompt', { exact: true }).fill(nestedPrompt);
  await rootNode.getByLabel('prompt', { exact: true }).blur();
  await expect.poll(async () => (await blockInstanceSnapshot(page, rootId)).values.prompt).toBe(nestedPrompt);
  await rootNode.getByLabel('Expand block', { exact: true }).click();
  await waitForStableProjection(page);

  // Use the collapsed internal Block's actual fields, not a store mutation or
  // the owning root form. The leaf and owning root must remain the same value.
  const encoderSave = page.getByRole('button', {
    name: 'Save changes to Qwen Image Auto Text Encoder Step',
    exact: true,
  });
  const encoder = page.locator('[data-block-projection="modular-diffusers"]').filter({ has: encoderSave });
  await encoder.getByRole('button', { name: 'Collapse Qwen Image Auto Text Encoder Step', exact: true }).click();
  const beforeNestedEdit = await blockInstanceSnapshot(page, rootId);
  const editedPrompt = `${nestedPrompt} A tiny enamel constellation dial reads STAR ATLAS; realistic optical reflections.`;
  await encoder.getByLabel('prompt', { exact: true }).fill(editedPrompt);
  await encoder.getByLabel('prompt', { exact: true }).blur();
  await expect.poll(async () => (await blockInstanceSnapshot(page, rootId)).values.prompt).toBe(editedPrompt);
  const afterNestedEdit = await blockInstanceSnapshot(page, rootId);
  expect(afterNestedEdit.effectiveGraph).toEqual(beforeNestedEdit.effectiveGraph);
  expect(afterNestedEdit.effectiveInterface).toEqual(beforeNestedEdit.effectiveInterface);
  expect(afterNestedEdit.presentation).toEqual(beforeNestedEdit.presentation);
  expect(afterNestedEdit.definitionSnapshot).toEqual(beforeNestedEdit.definitionSnapshot);

  // Rename this subtree's exposed control with the common interface editor.
  // A separate socket label and all unrelated controls/ports remain unchanged.
  await encoder.getByRole('button', { name: 'Configure exposed inputs, outputs, and controls', exact: true }).click();
  const interfaceDialog = page.getByRole('dialog', { name: 'Configure Block interface', exact: true });
  await expect(interfaceDialog.getByTestId('block-interface-scope')).toContainText('own ports and controls');
  await expect(interfaceDialog.getByLabel('control modelVariant label', { exact: true })).toHaveCount(0);
  await interfaceDialog.getByLabel('control prompt label', { exact: true }).fill('Scene prompt');
  await interfaceDialog.getByRole('button', { name: 'Apply interface', exact: true }).click();
  await expect(interfaceDialog).toHaveCount(0);
  await expect(encoder.getByLabel('Scene prompt', { exact: true })).toHaveValue(editedPrompt);
  const configured = await blockInstanceSnapshot(page, rootId);
  expect(configured.values).toEqual(afterNestedEdit.values);
  expect(configured.effectiveInterface).toEqual(afterNestedEdit.effectiveInterface);
  expect(configured.effectiveGraph.edges).toEqual(afterNestedEdit.effectiveGraph.edges);
  const localOwner = configured.effectiveGraph.nodes.find((node) =>
    node.containerInterface?.controls.some((control) => control.controlId === 'prompt'),
  )!;
  expect(localOwner.containerInterface!.controls.find((control) => control.controlId === 'prompt')?.label).toBe(
    'Scene prompt',
  );
  expect(configured.effectiveGraph.nodes.filter((node) => node.nodeId !== localOwner.nodeId)).toEqual(
    afterNestedEdit.effectiveGraph.nodes.filter((node) => node.nodeId !== localOwner.nodeId),
  );
  await page.getByTestId('topbar-save-workflow').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await expect.poll(() => blockInstanceSnapshot(page, rootId)).toEqual(configured);
  await expect(encoder.getByLabel('Scene prompt', { exact: true })).toHaveValue(editedPrompt);
  // Return the field label/value through the same UI so existing subtree reuse
  // assertions continue to check the exact library interface and prompt.
  await encoder.getByRole('button', { name: 'Configure exposed inputs, outputs, and controls', exact: true }).click();
  await interfaceDialog.getByLabel('control prompt label', { exact: true }).fill('prompt');
  await interfaceDialog.getByRole('button', { name: 'Apply interface', exact: true }).click();
  await encoder.getByLabel('prompt', { exact: true }).fill(nestedPrompt);
  await encoder.getByLabel('prompt', { exact: true }).blur();
  await waitForStableProjection(page);
  const original = await blockInstanceSnapshot(page, rootId);

  // Headers and selection toolbar share explicit persistence choices.
  const libraryWrites: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/studio/blocks') && request.method() === 'POST') libraryWrites.push(request.url());
  });
  const nestedSave = page.getByRole('button', {
    name: 'Save changes to Qwen Image Auto Text Encoder Step',
    exact: true,
  });
  await nestedSave.click();
  const subtreeChoices = page.getByRole('dialog', { name: 'Save block changes', exact: true });
  await expect(subtreeChoices.getByRole('button', { name: 'Update existing User Node', exact: true })).toHaveCount(0);
  await subtreeChoices.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(subtreeChoices).toHaveCount(0);
  await nestedSave.click();
  await subtreeChoices.getByRole('button', { name: 'Keep only in this workflow', exact: true }).click();
  await expect(subtreeChoices).toHaveCount(0);
  expect(libraryWrites).toHaveLength(0);
  expect(await blockInstanceSnapshot(page, rootId)).toEqual(original);
  const nestedFrame = page.locator('[data-block-projection="modular-diffusers"]').filter({ has: nestedSave });
  await nestedFrame.locator('header').click();
  await page.getByTestId('selection-toolbar-save-modular-subtree').click();
  await expect(subtreeChoices.getByRole('heading', { name: 'Save block changes', exact: true })).toBeVisible();
  await expect(subtreeChoices.getByRole('button', { name: 'Update existing User Node', exact: true })).toHaveCount(0);
  const savedResponse = page.waitForResponse(
    (response) => response.url().endsWith('/studio/blocks') && response.request().method() === 'POST',
  );
  await subtreeChoices.getByRole('button', { name: 'Save as new User Node', exact: true }).click();
  const response = await savedResponse;
  expect(response.ok(), await response.text()).toBe(true);
  const { block: saved } = (await response.json()) as { block: typeof original.definitionSnapshot };
  expect(saved.source.kind).toBe('user');
  expect(saved.graph.nodes).toHaveLength(2);
  expect(saved.controls.find(({ controlId }) => controlId === 'prompt')?.defaultValue).toBe(nestedPrompt);
  expect(saved.boundary).toEqual(
    original.effectiveGraph.nodes.find((node) => node.nodeId === localOwner.nodeId)!.containerInterface!.boundary,
  );
  expect(saved.boundary.inputs.some(({ binding }) => binding.fieldOrPortId === 'pipeline_components')).toBe(true);
  expect(saved.boundary.outputs).toContainEqual(
    expect.objectContaining({
      valueType: 'modular_workflow_state',
      binding: { nodeId: 'prompt', fieldOrPortId: 'state_out' },
    }),
  );
  expect(await blockInstanceSnapshot(page, rootId)).toEqual(original);

  await search.fill(saved.displayName);
  const userGroup = page.getByTestId('node-group-User-Nodes');
  const userDisclosure = userGroup.getByRole('button').first();
  if ((await userDisclosure.getAttribute('aria-expanded')) !== 'true') await userDisclosure.click();
  const savedRow = userGroup.getByTestId(
    `user-block-row-${saved.definitionId.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
  );
  await expect(savedRow).toHaveCount(1);
  await expect(savedRow).toHaveAttribute('draggable', 'true');
  await savedRow.click();
  const newId = await page.evaluate(async (definitionId) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore
      .getState()
      .nodes.find((node) => node.data.blockInstanceV2?.definitionRef.definitionId === definitionId)?.id;
  }, saved.definitionId);
  expect(newId).toBeTruthy();
  const inserted = await blockInstanceSnapshot(page, newId!);
  expect(inserted.definitionSnapshot).toEqual(saved);
  expect(await blockInstanceSnapshot(page, rootId)).toEqual(original);

  const reusedRoot = page.locator(`.react-flow__node[data-id="${newId}"]`);
  await expect
    .poll(async () => {
      const sourceBox = await rootNode.boundingBox();
      const reusedBox = await reusedRoot.boundingBox();
      if (!sourceBox || !reusedBox) return false;
      return (
        sourceBox.x + sourceBox.width <= reusedBox.x ||
        reusedBox.x + reusedBox.width <= sourceBox.x ||
        sourceBox.y + sourceBox.height <= reusedBox.y ||
        reusedBox.y + reusedBox.height <= sourceBox.y
      );
    })
    .toBe(true);
  // New instances inherit saved control defaults until the first local edit;
  // an empty overrides object is not a reset to the catalog's creator values.
  await expect(reusedRoot.getByLabel('prompt', { exact: true })).toHaveValue(nestedPrompt);
  const isolatedPrompt = `${nestedPrompt} A single ruby accent on the winding crown.`;
  await reusedRoot.getByLabel('prompt', { exact: true }).fill(isolatedPrompt);
  await reusedRoot.getByLabel('prompt', { exact: true }).blur();
  await expect.poll(async () => (await blockInstanceSnapshot(page, newId!)).values.prompt).toBe(isolatedPrompt);
  expect(await blockInstanceSnapshot(page, rootId)).toEqual(original);
  const reusedBeforeRefresh = await blockInstanceSnapshot(page, newId!);

  await page.getByTestId('topbar-save-workflow').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await expect.poll(() => blockInstanceSnapshot(page, rootId)).toEqual(original);
  await expect.poll(() => blockInstanceSnapshot(page, newId!)).toEqual(reusedBeforeRefresh);
  await waitForStableProjection(page);

  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  if (outputDirectory) {
    const evidenceRoot = `${outputDirectory}/nested-subtree-reuse`;
    await mkdir(evidenceRoot, { recursive: true });
    await page.screenshot({ path: `${evidenceRoot}/frontend.png`, fullPage: true });
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          savedDefinition: saved,
          originalInstance: original,
          reusedInstance: reusedBeforeRefresh,
          assertions: {
            progressiveExpansionAndGeometry: true,
            nestedHeaderAndToolbarShareSaveChoices: true,
            cancelAndWorkflowOnlyMadeNoLibraryWrites: true,
            savedThroughNestedToolbar: true,
            nestedControlEditedWithoutCollateralChanges: true,
            scopedInterfacePreservedOtherBranchesAndValues: true,
            savedSubtreeHasCrossingPorts: true,
            insertedThroughUserNodesLibrary: true,
            editedPromptPreserved: true,
            originalInstanceByteIdentical: true,
            bothInstancesPreservedAcrossRefresh: true,
          },
          generationTested: false,
        },
        null,
        2,
      )}\n`,
    );
  }
});

test('an unchanged legacy Qwen text-to-image snapshot hides unselected optional VAE wrappers', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);

  const advancedWorkflow = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advancedWorkflow.isVisible({ timeout: 1000 }).catch(() => false)) await advancedWorkflow.click();
  const search = page.getByLabel('Search nodes');
  if (!(await search.isVisible({ timeout: 1000 }).catch(() => false))) await page.getByTestId('left-tab-nodes').click();
  await search.fill('Qwen Image — Text To Image');
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  const disclosure = group.getByRole('button').first();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await row.click();

  const root = page
    .locator('[data-block-source="diffusers_catalog"]')
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(root).toHaveCount(1, { timeout: 30_000 });
  await root.getByLabel('Expand block').click();
  await expect.poll(() => projectionSnapshot(page)).not.toBeNull();

  const result = await page.evaluate(async () => {
    const schema = await import('/src/studio/blockSchemaV2.ts');
    const runtime = await import('/src/studio/blockRuntimeV2.ts');
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const state = useFlowStore.getState();
    const currentRoot = state.nodes.find(
      (node) => node.data.blockInstanceV2?.definitionSnapshot.source.pipelineClass === 'QwenImageModularPipeline',
    );
    const current = currentRoot?.data.blockInstanceV2;
    if (!current || !currentRoot) throw new Error('The fresh Qwen Block instance was not found.');
    const structuralTemplate = current.effectiveGraph.nodes.find(
      (node) => node.nodeType === 'group' && node.modularDiffusers?.kind === 'upstream_block',
    );
    if (!structuralTemplate?.modularDiffusers) throw new Error('The Qwen hierarchy has no structural template.');

    const legacyNodeId = 'legacy-unselected-auto-vae';
    const legacyModularMetadata = {
      ...structuredClone(structuralTemplate.modularDiffusers),
      runtimeRole: 'legacy-unselected-auto-vae',
      placementPath: ['legacy_unselected_auto_vae'],
      componentNames: [],
    };
    delete (legacyModularMetadata as Partial<typeof legacyModularMetadata>).parentPlacementPath;
    const legacyNode = {
      ...structuredClone(structuralTemplate),
      nodeId: legacyNodeId,
      semanticRole: 'upstream:legacy-unselected-auto-vae',
      data: {
        ...structuredClone(structuralTemplate.data),
        label: 'Legacy Unselected Auto VAE',
        params: {},
      },
      modularDiffusers: legacyModularMetadata,
    };
    const graphWithoutHash = {
      ...structuredClone(current.effectiveGraph),
      nodes: [...structuredClone(current.effectiveGraph.nodes), legacyNode],
      executionOrder: [...current.effectiveGraph.executionOrder, legacyNodeId],
    };
    delete (graphWithoutHash as Partial<typeof graphWithoutHash>).graphHash;
    const graph = { ...graphWithoutHash, graphHash: schema.blockGraphHashV2(graphWithoutHash) };
    const definitionWithoutHash = {
      ...structuredClone(current.definitionSnapshot),
      graph,
    };
    delete (definitionWithoutHash as Partial<typeof definitionWithoutHash>).contentHash;
    const definition = {
      ...definitionWithoutHash,
      contentHash: schema.blockDefinitionContentHashV2(definitionWithoutHash),
    };
    const legacyInstance = schema.normalizeBlockInstanceV2({
      ...structuredClone(current),
      definitionRef: { definitionId: definition.definitionId, contentHash: definition.contentHash },
      definitionSnapshot: definition,
      effectiveGraph: graph,
      customization: {
        ...structuredClone(current.customization),
        baseGraphHash: graph.graphHash,
        effectiveGraphHash: graph.graphHash,
      },
    });
    const projection = runtime.materializeBlockProjectionV2(
      runtime.createBlockRootNodeV2(legacyInstance, { selected: true }),
    );
    state.replaceGraph(projection, { historyLabel: 'Load legacy registered Block proof' });
    const restored = useFlowStore.getState().nodes.find((node) => node.id === legacyInstance.instanceId)
      ?.data.blockInstanceV2;
    return {
      definitionStillContainsLegacyNode: restored?.effectiveGraph.nodes.some((node) => node.nodeId === legacyNodeId),
      projectionContainsLegacyNode: useFlowStore
        .getState()
        .nodes.some((node) => node.data.blockProjectionNodeId === legacyNodeId),
    };
  });

  expect(result.definitionStillContainsLegacyNode).toBe(true);
  expect(result.projectionContainsLegacyNode).toBe(false);
  await expect(page.getByText('Legacy Unselected Auto VAE', { exact: true })).toHaveCount(0);
  await waitForStableProjection(page);
});
