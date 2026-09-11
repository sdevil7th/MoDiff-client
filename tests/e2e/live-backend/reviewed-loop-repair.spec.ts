import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { backendSourceIdentity } from '../../../scripts/live-proof-provenance.mjs';
import { decodedImageStatistics } from './imageProofStatistics';
import type { BlockDefinitionV2, BlockJsonObject } from '../../../src/studio/blockSchemaV2';
import { waitForRecursiveDomGeometry } from './blockDomGeometry';

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const state = await page
    .evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      return {
        past: flow.historyPast,
        future: flow.historyFuture,
        transaction: flow.historyTransaction,
        nodes: flow.nodes,
        edges: flow.edges,
        active: { tag: document.activeElement?.tagName, id: document.activeElement?.id },
        trace: (window as unknown as { __loopHistoryTrace?: unknown[] }).__loopHistoryTrace,
      };
    })
    .catch((error: unknown) => ({ captureError: String(error) }));
  await writeFile(info.outputPath('failed-history.json'), JSON.stringify(state, null, 2));
});

const repairCases =
  process.env.MODIFF_LOOP_REPAIR_FAMILY === 'flux'
    ? [
        'FluxModularPipeline',
        'FluxKontextModularPipeline',
        'Flux2ModularPipeline',
        'Flux2KleinModularPipeline',
        'Flux2KleinBaseModularPipeline',
      ].flatMap((pipelineClass) =>
        ['text2image', pipelineClass === 'FluxModularPipeline' ? 'image2image' : 'image_conditioned'].map(
          (workflow) => ({ pipelineClass, workflow }),
        ),
      )
    : [{ pipelineClass: 'QwenImageModularPipeline', workflow: 'text2image' }];

for (const scenario of repairCases)
  test(`${scenario.pipelineClass}/${scenario.workflow} missing-loop-link Fix preserves the draft through Undo, Save, pointer wiring and connected move`, async ({
    page,
  }) => {
    const execute = process.env.MODIFF_LOOP_REPAIR_EXECUTE === '1';
    const prompt =
      process.env.MODIFF_LOOP_REPAIR_PROMPT ??
      'An intricate cobalt ceramic architectural miniature with precise glaze highlights.';
    const offloadMode = process.env.MODIFF_LOOP_REPAIR_OFFLOAD;
    if (offloadMode && !['group_disk', 'model_cpu'].includes(offloadMode))
      throw new Error('Use an explicit reviewed offload mode for the test instance.');
    // Full offloaded models have a different measured inference budget from
    // Klein. Select it explicitly before launch; individual status requests
    // retain their strict 5-second responsiveness check.
    const generationMinutes = Number(process.env.MODIFF_LOOP_REPAIR_TIMEOUT_MINUTES ?? 15);
    if (!Number.isFinite(generationMinutes) || generationMinutes < 5 || generationMinutes > 120)
      throw new Error('Choose an explicit bounded 5–120 minute inference budget.');
    test.setTimeout(execute ? (generationMinutes + 5) * 60_000 : 240_000);
    const repeat = test.info().project.repeatEach > 1 ? `-repeat-${test.info().repeatEachIndex}` : '';
    const evidence = `${process.env.MODIFF_REVIEW_OUTPUT_DIR ?? 'artifacts'}/reviewed-loop-repair/${scenario.pipelineClass}-${scenario.workflow}${repeat}`;
    await mkdir(evidence, { recursive: true });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.addInitScript(() => {
      if (sessionStorage.getItem('loop-repair-proof')) return;
      localStorage.clear();
      sessionStorage.setItem('loop-repair-proof', '1');
    });
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 120_000 });
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
    const advanced = page.getByRole('button', { name: /Advanced workflow/u });
    if (await advanced.isVisible().catch(() => false)) await advanced.click();
    await page.getByTestId('workflow-tab-new').click();
    if (await advanced.isVisible().catch(() => false)) await advanced.click();
    const catalog = JSON.parse(
      gunzipSync(await readFile('../MoDiff/modiff/registered_block_v2_catalog.v1.json.gz')).toString(),
    ) as {
      entries: Array<{ definition: BlockDefinitionV2; values: BlockJsonObject }>;
    };
    const entry = catalog.entries.find(
      ({ definition }) =>
        definition.source.pipelineClass === scenario.pipelineClass && definition.source.workflow === scenario.workflow,
    );
    if (!entry) throw new Error(`Current ${scenario.pipelineClass}/${scenario.workflow} admission missing`);
    const before = await page.evaluate(
      async ({ definition, values, prompt, offloadMode }) => {
        const schema = await import('/src/studio/blockSchemaV2.ts');
        const runtime = await import('/src/studio/blockRuntimeV2.ts');
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
        const { useHuggingFaceNodeLibraryStore } = await import('/src/stores/useHuggingFaceNodeLibraryStore.ts');
        await useHuggingFaceNodeLibraryStore.getState().fetchLibrary();
        let instance = schema.createBlockInstanceV2(definition, {
          instanceId: 'loop-repair-proof',
          position: { x: 100, y: 70 },
          size: { width: 540, height: 660 },
        });
        for (const [id, value] of Object.entries(values))
          instance = runtime.setBlockInstanceValueV2(instance, id, value);
        instance = runtime.setBlockInstanceValueV2(instance, 'prompt', prompt);
        if (offloadMode) instance = runtime.setBlockInstanceValueV2(instance, 'offloadMode', offloadMode);
        // FLUX starts with its denoiser (no before-denoiser member). Remove an
        // actual member-to-member edge, not a Qwen-specific incoming edge.
        const target = instance.effectiveGraph.nodes.find(
          (node) =>
            node.modularDiffusers?.blockClass?.includes('Loop') &&
            instance.effectiveGraph.edges.some(
              (edge) => edge.targetNodeId === node.nodeId && edge.targetPortId === 'loop_members_in',
            ),
        )!;
        const removed = instance.effectiveGraph.edges.find(
          (edge) => edge.targetNodeId === target.nodeId && edge.targetPortId === 'loop_members_in',
        )!;
        if (!removed) throw new Error('Expected exact upstream state connection');
        instance = runtime.replaceBlockEffectiveGraphV2(instance, {
          ...instance.effectiveGraph,
          edges: instance.effectiveGraph.edges.filter((edge) => edge.edgeId !== removed.edgeId),
        });
        useStudioStore.getState().clearGraphBinding();
        useFlowStore
          .getState()
          .replaceGraph(
            { nodes: [runtime.createBlockRootNodeV2(instance)], edges: [] },
            { historyLabel: 'Load disconnected draft fixture', clearRemovedCache: false },
          );
        useFlowStore.getState().resetHistory();
        useStudioStore.setState({ launcherDismissed: true });
        useStudioStore.getState().saveActiveWorkflowTab(true);
        return { instance, removed, targetId: target.nodeId };
      },
      { ...entry, prompt, offloadMode },
    );
    if (offloadMode) {
      expect(before.instance.values.offloadMode).toBe(offloadMode);
      expect(before.instance.values.num_inference_steps).toBe(entry.values.num_inference_steps);
      expect(before.instance.values.dtype).toBe(entry.values.dtype);
      await writeFile(
        `${evidence}/resource-choice.json`,
        JSON.stringify(
          {
            original: entry.values.offloadMode,
            selected: offloadMode,
            steps: entry.values.num_inference_steps,
            dtype: entry.values.dtype,
            scope: 'explicit test-instance resource choice; no catalog/default mutation',
          },
          null,
          2,
        ),
      );
    }
    const snapshot = () =>
      page.evaluate(async () => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        return useFlowStore.getState().nodes.find(({ id }) => id === 'loop-repair-proof')!.data.blockInstanceV2!;
      });
    const reference = process.env.MODIFF_LOOP_REPAIR_IMAGE;
    if (reference) {
      if (!entry.definition.boundary.inputs.some((input) => input.portId === 'image'))
        throw new Error('This admission has no image input for the supplied reference.');
      const server = process.env.MODIFF_LIVE_BACKEND_URL ?? 'http://127.0.0.1:8088';
      const response = await page.request.get(`${server}/file?file=${encodeURIComponent(reference)}`);
      expect(response.ok()).toBe(true);
      const picker = page
        .getByTestId('user-block-loop-repair-proof')
        .locator('.modiff-field')
        .filter({ has: page.getByLabel('image', { exact: true }) })
        .locator('input[type="file"]');
      await expect(picker).toHaveCount(1);
      await picker.setInputFiles({
        name: 'loop-edit-reference.webp',
        mimeType: 'image/webp',
        buffer: await response.body(),
      });
      await expect.poll(async () => (await snapshot()).values.image).not.toBeNull();
      const withReference = await snapshot();
      for (const [key, value] of Object.entries(before.instance.values))
        if (key !== 'image') expect(withReference.values[key], key).toEqual(value);
      expect(withReference.effectiveGraph).toEqual(before.instance.effectiveGraph);
      before.instance = withReference;
      await writeFile(
        `${evidence}/reference-picker.json`,
        JSON.stringify(
          {
            source: reference,
            uploaded: withReference.values.image,
            nativePicker: true,
            otherValuesUnchanged: true,
          },
          null,
          2,
        ),
      );
    } else if (execute && scenario.workflow !== 'text2image') {
      throw new Error('Image-conditioned generation requires an explicit native-picker reference fixture.');
    }
    const waitForPointerGeometry = async () => {
      // This dismisses notifications in this isolated browser only; it does
      // not delete run records. Otherwise the floating activity shelf can
      // cover a real drag handle and a raw mouse-down opens a past workflow.
      const clear = page.getByTestId('run-session-shelf').getByRole('button', { name: 'Clear', exact: true });
      if (await clear.isVisible().catch(() => false)) {
        if (await clear.isEnabled()) await clear.click();
      }
      await waitForRecursiveDomGeometry(page);
      let previous = '';
      let stableSamples = 0;
      await expect
        .poll(
          async () => {
            const signature = await page.evaluate(() =>
              JSON.stringify({
                transform: document.querySelector('.react-flow__viewport')?.getAttribute('style'),
                nodes: [...document.querySelectorAll('.react-flow__node')].map((node) => {
                  const rect = node.getBoundingClientRect();
                  return [node.getAttribute('data-id'), rect.x, rect.y, rect.width, rect.height];
                }),
              }),
            );
            stableSamples = signature === previous ? stableSamples + 1 : 0;
            previous = signature;
            return stableSamples;
          },
          { timeout: 15_000, intervals: [100] },
        )
        .toBeGreaterThanOrEqual(3);
    };
    const startHistoryTrace = () =>
      page.evaluate(async () => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
        const target = window as unknown as { __loopHistoryTrace?: unknown[] };
        target.__loopHistoryTrace = [];
        useFlowStore.subscribe((next, previous) => {
          if (
            next.historyPast === previous.historyPast &&
            next.historyFuture === previous.historyFuture &&
            next.historyTransaction === previous.historyTransaction
          )
            return;
          target.__loopHistoryTrace!.push({
            time: performance.now(),
            resetStack:
              previous.historyPast.length > 0 && next.historyPast.length === 0
                ? new Error('History cleared').stack
                : undefined,
            past: next.historyPast.length,
            future: next.historyFuture.length,
            transaction: next.historyTransaction?.label,
            activeTab: useStudioStore.getState().activeWorkflowTabId,
            normalizedBound: next
              .toObject()
              .nodes.find((node) => node.id === 'loop-repair-proof')
              ?.data.blockInstanceV2?.effectiveGraph.edges.filter((edge) => edge.sourcePortId.startsWith('iteration_')),
            bound: next.nodes
              .find((node) => node.id === 'loop-repair-proof')
              ?.data.blockInstanceV2?.effectiveGraph.edges.filter((edge) => edge.sourcePortId.startsWith('iteration_')),
          });
          target.__loopHistoryTrace = target.__loopHistoryTrace!.slice(-80);
        });
      });
    // The invalid composition must survive a reload before any repair is requested.
    await page.reload();
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
    await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(before.instance.effectiveGraph);
    const diagnostics = await page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const { useHuggingFaceNodeLibraryStore } = await import('/src/stores/useHuggingFaceNodeLibraryStore.ts');
      const { inspectReviewedLoopV2 } = await import('/src/studio/reviewedLoopDiagnosticsV2.ts');
      await useHuggingFaceNodeLibraryStore.getState().fetchLibrary();
      const library = useHuggingFaceNodeLibraryStore.getState();
      const instance = useFlowStore.getState().nodes.find(({ id }) => id === 'loop-repair-proof')!.data
        .blockInstanceV2!;
      return {
        error: library.error,
        definitions: library.library?.blockDefinitions.length,
        issues: inspectReviewedLoopV2(instance, library.library?.blockDefinitions ?? []),
      };
    });
    await writeFile(`${evidence}/diagnostics.json`, JSON.stringify(diagnostics, null, 2));
    expect(diagnostics.issues.some(({ nodeId }) => nodeId === before.targetId)).toBe(true);
    await page.getByTestId('graph-fix').click();
    const dialog = page.getByRole('dialog', { name: 'Fix graph', exact: true });
    await expect(dialog).toContainText('loop member');
    await dialog
      .getByRole('radio', { name: /Reconnect the missing Loop Members link/u })
      .first()
      .check();
    // A missing model must not force navigation or installation just to fix
    // a draft connection. Use the visible per-issue opt-out, never the store.
    const unrelated = dialog.getByRole('button', { name: /^Skip (?!Invalid loop connection)/u });
    while (await unrelated.count()) await unrelated.first().click();
    await page.screenshot({ path: `${evidence}/exact-missing-loop-link.png` });
    await dialog.getByRole('button', { name: 'Apply fix', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const repaired = await snapshot();
    expect(repaired.values).toEqual(before.instance.values);
    expect(repaired.definitionSnapshot).toEqual(before.instance.definitionSnapshot);
    expect(repaired.effectiveGraph.nodes).toEqual(before.instance.effectiveGraph.nodes);
    expect(repaired.effectiveGraph.edges).toHaveLength(before.instance.effectiveGraph.edges.length + 1);
    expect(repaired.effectiveGraph.edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: before.removed.sourceNodeId,
        sourcePortId: 'loop_members',
        targetNodeId: before.targetId,
        targetPortId: 'loop_members_in',
      }),
    );
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(before.instance.effectiveGraph);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(repaired.effectiveGraph);
    await page.getByTestId('topbar-save-workflow').click();
    const saveDialog = page.getByTestId('save-workflow-dialog');
    await expect(saveDialog).toBeVisible();
    const workflowName = `${scenario.pipelineClass} targeted loop reconnection ${Date.now()}`;
    await page.getByTestId('save-workflow-name').fill(workflowName);
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
    const saveNamedWorkflow = async () => {
      await page.getByTestId('topbar-save-workflow').click();
      // Wait for the explicit save to finish before destroying the page. An
      // immediate isVisible() check races both dialog rendering and the PUT.
      await expect(page.getByText(`Saved ${workflowName} to My workflows`, { exact: true })).toBeVisible();
    };
    await page.reload();
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
    await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(repaired.effectiveGraph);
    expect((await snapshot()).values).toEqual(before.instance.values);
    await page.screenshot({ path: `${evidence}/repaired-after-refresh.png` });
    await startHistoryTrace();
    const endpoints = await page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const runtime = await import('/src/studio/blockRuntimeV2.ts');
      const flow = useFlowStore.getState();
      const current = flow.nodes.find(({ id }) => id === 'loop-repair-proof')!.data.blockInstanceV2!;
      const expanded = runtime.setBlockPresentationV2(current, { expanded: true, collapsedContainerNodeIds: [] });
      flow.replaceGraph(runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(expanded)), {
        historyLabel: 'Expand loop for pointer proof',
        clearRemovedCache: false,
      });
      const source = current.effectiveGraph.nodes.find((node) =>
        node.modularDiffusers?.blockClass?.endsWith('LoopAfterDenoiser'),
      )!;
      const target =
        current.effectiveGraph.nodes.find((node) =>
          node.modularDiffusers?.blockClass?.endsWith('LoopBeforeDenoiser'),
        ) ?? current.effectiveGraph.nodes.find((node) => node.modularDiffusers?.blockClass?.endsWith('LoopDenoiser'))!;
      return {
        sourceId: runtime.blockProjectionNodeIdV2(current.instanceId, source.nodeId),
        targetId: runtime.blockProjectionNodeIdV2(current.instanceId, target.nodeId),
        sourceSemanticId: source.nodeId,
        targetSemanticId: target.nodeId,
      };
    });
    await page.getByTestId('arrange-graph').click();
    await waitForPointerGeometry();
    const socketPoint = async (id: string, handle: string) => {
      const locator = page.getByTestId(`node-handle-${id}-${handle}`);
      await expect(locator).toBeVisible();
      return locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        const hit = document.elementFromPoint(point.x, point.y);
        if (hit !== element && (!hit || !element.contains(hit))) throw new Error('Iteration socket is obscured');
        return point;
      });
    };
    const from = await socketPoint(endpoints.sourceId, 'iteration_previous__latents');
    const to = await socketPoint(endpoints.targetId, 'iteration_input__latents');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 24 });
    await page.mouse.up();
    const boundEdge = {
      sourceNodeId: endpoints.sourceSemanticId,
      sourcePortId: 'iteration_previous__latents',
      targetNodeId: endpoints.targetSemanticId,
      targetPortId: 'iteration_input__latents',
    };
    await expect
      .poll(async () => (await snapshot()).effectiveGraph.edges)
      .toContainEqual(expect.objectContaining(boundEdge));
    const wired = await snapshot();
    expect(wired.values).toEqual(repaired.values);
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => (await snapshot()).effectiveGraph.edges)
      .not.toContainEqual(expect.objectContaining(boundEdge));
    await page.keyboard.press('Control+Shift+z');
    await expect
      .poll(async () => (await snapshot()).effectiveGraph.edges)
      .toContainEqual(expect.objectContaining(boundEdge));
    await saveNamedWorkflow();
    await page.reload();
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
    await expect
      .poll(async () => (await snapshot()).effectiveGraph.edges)
      .toContainEqual(expect.objectContaining(boundEdge));
    await page.getByTestId('arrange-graph').click();
    await waitForRecursiveDomGeometry(page);
    const exported = await page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const { buildApiGraphExport } = await import('/src/stores/flowGraphExport.ts');
      const flow = useFlowStore.getState();
      return buildApiGraphExport({ nodes: flow.nodes, edges: flow.edges, sid: 'loop-wire-proof', setParam: () => {} });
    });
    expect(Object.values(exported.nodes).some((node) => node.params.iteration_bindings?.value)).toBe(true);
    await page.screenshot({ path: `${evidence}/iteration-wire-after-refresh.png` });
    await writeFile(`${evidence}/iteration-export.json`, JSON.stringify(exported, null, 2));
    const moveTargets = await page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const { blockProjectionNodeIdV2 } = await import('/src/studio/blockRuntimeV2.ts');
      const instance = useFlowStore.getState().nodes.find(({ id }) => id === 'loop-repair-proof')!.data
        .blockInstanceV2!;
      const source = instance.effectiveGraph.nodes.find((node) =>
        /TextInputs?Step$/u.test(node.modularDiffusers?.blockClass ?? ''),
      )!;
      const target =
        instance.effectiveGraph.nodes.find((node) => node.modularDiffusers?.blockClass === 'QwenImageDecodeStep') ??
        instance.effectiveGraph.nodes.find((node) => node.nodeId === 'container:denoise')!;
      return {
        source: source.nodeId,
        target: target.nodeId,
        sourceId: blockProjectionNodeIdV2(instance.instanceId, source.nodeId),
        targetId: blockProjectionNodeIdV2(instance.instanceId, target.nodeId),
      };
    });
    const beforeMove = await snapshot();
    await waitForPointerGeometry();
    const sourceHeader = page.locator(`.react-flow__node[data-id="${moveTargets.sourceId}"]`).locator('header').first();
    await sourceHeader.click({ trial: true });
    const sourceBox = await sourceHeader.boundingBox();
    const destinationHeader = await page
      .locator(`.react-flow__node[data-id="${moveTargets.targetId}"]`)
      .locator('header')
      .first()
      .boundingBox();
    if (!sourceBox || !destinationHeader) throw new Error('Move endpoints are not visible');
    const grab = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    // XYFlow establishes the grab offset when its drag threshold is crossed,
    // not on mouse-down. A single large synthetic first step changes that
    // offset. Cross the threshold first, then measure the actual grabbed node.
    await page.mouse.move(grab.x + 4, grab.y);
    await page.mouse.move(grab.x + 5, grab.y);
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          return useFlowStore.getState().nodes.find((node) => node.id === id)?.dragging;
        }, moveTargets.sourceId),
      )
      .toBe(true);
    const nodeBox = await page.locator(`.react-flow__node[data-id="${moveTargets.sourceId}"]`).boundingBox();
    if (!nodeBox) throw new Error('Grabbed node disappeared');
    // Reparenting hit-tests the NODE CENTER, not the pointer. Target the
    // outer container's header strip, clear of deeper containers, and retain
    // the original grab offset at the actual current canvas zoom.
    const drop = {
      x: destinationHeader.x + destinationHeader.width / 2 - (nodeBox.x + nodeBox.width / 2 - grab.x - 5),
      y: destinationHeader.y + destinationHeader.height / 2 - (nodeBox.y + nodeBox.height / 2 - grab.y),
    };
    await page.mouse.move(drop.x, drop.y, { steps: 24 });
    const beforeRelease = await page.evaluate(async ({ sourceId, targetId }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const { expandedBlockV2AtPosition } = await import('/src/studio/blockDropTargetsV2.ts');
      const nodes = useFlowStore.getState().nodes;
      const source = nodes.find((node) => node.id === sourceId)!;
      const center = {
        x: source.position.x + (source.measured?.width ?? source.width ?? 220) / 2,
        y: source.position.y + (source.measured?.height ?? source.height ?? 120) / 2,
      };
      let parent = source.parentId;
      while (parent) {
        const node = nodes.find((item) => item.id === parent)!;
        center.x += node.position.x;
        center.y += node.position.y;
        parent = node.parentId;
      }
      return {
        center,
        intended: targetId,
        actual: expandedBlockV2AtPosition(
          nodes.filter((node) => node.id !== sourceId),
          center,
        )?.id,
        nodes,
      };
    }, moveTargets);
    await writeFile(`${evidence}/before-move-release.json`, JSON.stringify({ grab, drop, beforeRelease }, null, 2));
    expect(beforeRelease.actual).toBe(moveTargets.targetId);
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await snapshot()).effectiveGraph.nodes.find((node) => node.nodeId === moveTargets.source)?.parentNodeId,
      )
      .toBe(moveTargets.target);
    const moved = await snapshot();
    expect(moved.values).toEqual(beforeMove.values);
    expect(moved.effectiveGraph.edges).toEqual(beforeMove.effectiveGraph.edges);
    await waitForRecursiveDomGeometry(page);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(beforeMove.effectiveGraph);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(moved.effectiveGraph);
    await saveNamedWorkflow();
    await page.reload();
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
    await expect.poll(async () => (await snapshot()).effectiveGraph).toEqual(moved.effectiveGraph);
    await page.getByTestId('arrange-graph').click();
    await waitForRecursiveDomGeometry(page);
    await page.screenshot({ path: `${evidence}/moved-upstream-after-refresh.png` });
    if (process.env.MODIFF_LOOP_REPAIR_VALIDATE_COMPOSITION === '1') {
      await page.getByTestId('user-block-composition-loop-repair-proof').click();
      const dialog = page.getByTestId('user-block-composition-dialog-loop-repair-proof');
      const validate = dialog.getByRole('button', { name: 'Validate upstream composition', exact: true });
      await expect(validate).toBeVisible({ timeout: 15_000 });
      const response = page.waitForResponse(
        (item) =>
          new URL(item.url()).pathname === '/huggingface/modular-composition/rebuild' &&
          item.request().method() === 'POST',
        { timeout: 15_000 },
      );
      await validate.click({ timeout: 15_000 });
      const result = await response;
      expect(result.ok(), await result.text()).toBe(true);
      const body = await result.json();
      expect(body.receipt).toMatchObject({ executable: false, inspectionScope: 'edited_unpruned_tree' });
      await expect(dialog.getByTestId('block-v2-composition-receipt-loop-repair-proof')).toBeVisible();
      await expect(dialog).toContainText('It does not load models or qualify a run.');
      await writeFile(`${evidence}/upstream-tree-inspection.json`, JSON.stringify(body, null, 2));
      await page.screenshot({ path: `${evidence}/upstream-tree-inspection.png` });
      await dialog.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
      expect((await snapshot()).effectiveGraph).toEqual(moved.effectiveGraph);
      expect((await snapshot()).values).toEqual(moved.values);
    }
    await writeFile(
      `${evidence}/result.json`,
      JSON.stringify(
        {
          before,
          repaired,
          wired,
          moved,
          checks: {
            invalidDraftPersisted: true,
            targetedFixUndoRedo: true,
            pointerIterationConnection: true,
            connectedCrossContainerMove: true,
            moveUndoRedo: true,
            saveRefresh: true,
            valuesAndExistingEdgesPreserved: true,
            recursiveContainment: true,
          },
        },
        null,
        2,
      ),
    );
    if (execute) {
      const autoSwitch = page.getByTestId('topbar-auto-switch');
      if ((await autoSwitch.getAttribute('aria-checked')) === 'true') await autoSwitch.click();
      await expect(autoSwitch).toHaveAttribute('aria-checked', 'false');
      const server = process.env.MODIFF_LIVE_BACKEND_URL ?? 'http://127.0.0.1:8088';
      const backendRoot = process.env.MODIFF_BACKEND_ROOT ?? resolve(process.cwd(), '..', 'MoDiff');
      const sourceBefore = backendSourceIdentity(backendRoot);
      const healthBefore = await (await page.request.get(`${server}/health`, { timeout: 15_000 })).json();
      const workerBefore = { instance: healthBefore.instance, backendSource: healthBefore.backend_source };
      expect(workerBefore.backendSource?.fingerprint).toBe(sourceBefore.fingerprint);
      await writeFile(`${evidence}/source-before.json`, JSON.stringify({ sourceBefore, workerBefore }, null, 2));
      const submitted = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/graph' && response.request().method() === 'POST',
        { timeout: 120_000 },
      );
      await page.locator('.react-flow__node[data-id="loop-repair-proof"]').locator('header').first().click();
      await page.getByTestId('selection-toolbar-run-from-node').click();
      const response = await submitted;
      expect(response.ok(), await response.text()).toBe(true);
      const { task_id: taskId } = (await response.json()) as { task_id: string };
      await writeFile(
        `${evidence}/submitted-workflow.json`,
        JSON.stringify(response.request().postDataJSON(), null, 2),
      );
      await writeFile(`${evidence}/submitted-task.json`, JSON.stringify({ taskId }, null, 2));
      const statusSamples: Array<{ elapsedMs: number; status?: string }> = [];
      const deadline = Date.now() + generationMinutes * 60_000;
      let finalStatus = '';
      try {
        while (Date.now() < deadline) {
          const started = Date.now();
          const result = await page.request.get(`${server}/queue`, { timeout: 5_000 });
          expect(result.ok()).toBe(true);
          const queue = await result.json();
          const task = [queue.current, ...Object.values(queue.queued ?? {}), ...(queue.recent ?? [])].find(
            (candidate) => candidate?.task_id === taskId,
          );
          expect(task).toBeTruthy();
          statusSamples.push({ elapsedMs: Date.now() - started, status: task.status });
          if (['failed', 'cancelled', 'interrupted'].includes(task.status ?? ''))
            throw new Error(`Modified loop run ${taskId}: ${JSON.stringify(task)}`);
          finalStatus = task.status;
          if (finalStatus === 'completed') break;
          await page.waitForTimeout(2_000);
        }
      } finally {
        await writeFile(`${evidence}/status-responsiveness.json`, JSON.stringify(statusSamples, null, 2));
      }
      expect(finalStatus).toBe('completed');
      const result = await page.request.get(`${server}/runs/${encodeURIComponent(taskId)}`, { timeout: 15_000 });
      const run = (await result.json()) as { outputs: Array<{ taskId: string; displayType: string; url: string }> };
      const output = run.outputs.find((item) => item.taskId === taskId && item.displayType === 'image');
      expect(output).toBeTruthy();
      expect(output).toMatchObject({
        modelType: scenario.pipelineClass,
        prompt,
        steps: Number(moved.values.num_inference_steps),
        resolvedExecutionInputs: {
          source: 'backend-execution',
          taskId,
          summary: {
            repo: entry.definition.source.repository,
            revision: entry.definition.source.repositoryRevision,
          },
        },
      });
      const asset = await page.request.get(new URL(output!.url, server).toString());
      expect(asset.ok()).toBe(true);
      const bytes = await asset.body();
      const statistics = await decodedImageStatistics(page, bytes);
      expect(statistics.standardDeviation).toBeGreaterThan(2);
      await writeFile(`${evidence}/modified-loop.webp`, bytes);
      await writeFile(`${evidence}/image-statistics.json`, JSON.stringify(statistics, null, 2));
      await writeFile(`${evidence}/run.json`, JSON.stringify(run, null, 2));
      const sourceAfter = backendSourceIdentity(backendRoot);
      const healthAfter = await (await page.request.get(`${server}/health`, { timeout: 15_000 })).json();
      const workerAfter = { instance: healthAfter.instance, backendSource: healthAfter.backend_source };
      expect(sourceAfter.fingerprint).toBe(sourceBefore.fingerprint);
      expect(workerAfter).toEqual(workerBefore);
      await writeFile(`${evidence}/source-after.json`, JSON.stringify({ sourceAfter, workerAfter }, null, 2));
      expect((await snapshot()).effectiveGraph).toEqual(moved.effectiveGraph);
      expect((await snapshot()).values).toEqual(moved.values);
      await page.screenshot({ path: `${evidence}/modified-loop-generated.png` });
    }
    expect(errors).toEqual([]);
  });
