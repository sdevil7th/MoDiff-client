import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { waitForRecursiveDomGeometry } from './blockDomGeometry';
import type { BlockDefinitionV2 } from '../../../src/studio/blockSchemaV2';

const MUSIC_PROMPT =
  'An original English chamber-pop song, 96 BPM in D major, intimate clear female lead vocal. ' +
  'Begin with fingerpicked acoustic guitar and soft felt piano; add warm upright bass and brushed drums ' +
  'during the verse. The chorus opens into close three-part vocal harmonies, a lyrical cello countermelody ' +
  'and restrained tambourine. A brief instrumental answer follows the chorus, then the final line resolves ' +
  'gently with piano and cello. Hopeful late-night train journey atmosphere, natural breathing, intelligible ' +
  'lyrics, spacious stereo acoustic production, balanced dynamics, no audience or spoken introduction.';
const LYRICS =
  '[verse]\n' +
  'Silver rails beneath the rain\nEvery window holds a flame\nI have carried maps of home\nThrough the miles I walked alone\n' +
  '[chorus]\n' +
  'Leave a little light for me\nWhere the river meets the sea\nThrough the dark the wheels will sing\nMorning waits on folded wings\n' +
  '[outro]\n' +
  'Leave a little light for me\nI am closer than I seem';
const CASE_NAME = process.env.MODIFF_AUDIO_ACCEPTANCE_CASE ?? 'minimax';
const SOUND_MODELS = {
  longcat: { pipeline: 'LongCatAudioDiTPipeline', label: 'LongCat AudioDiT', duration: 5, steps: 16 },
  audioldm2: { pipeline: 'AudioLDM2Pipeline', label: 'AudioLDM2', duration: 10, steps: 200 },
} as const;
const soundModel = SOUND_MODELS[CASE_NAME as keyof typeof SOUND_MODELS];
const PROMPT = soundModel
  ? 'Close recording in a quiet workshop: a mechanical clock ticks steadily, a small brass gear rolls across a wooden bench, then a winding key turns with three distinct metallic clicks. Natural room ambience and a short clean decay, no music or speech.'
  : MUSIC_PROMPT;
const ACE_MODES = {
  'ace-text-to-audio': { mode: 'text_to_audio', label: 'Text To Audio', nodes: 5, edges: 4 },
  'ace-audio-variation': { mode: 'audio_variation', label: 'Audio Variation', nodes: 6, edges: 5 },
  'ace-audio-continuation': { mode: 'audio_continuation', label: 'Audio Continuation', nodes: 8, edges: 9 },
  'ace-audio-repaint': { mode: 'audio_repaint', label: 'Audio Repaint', nodes: 6, edges: 5 },
} as const;
if (CASE_NAME !== 'minimax' && !(CASE_NAME in ACE_MODES) && !soundModel)
  throw new Error(`Unknown audio case: ${CASE_NAME}`);
const aceMode = ACE_MODES[CASE_NAME as keyof typeof ACE_MODES];
const ACE = Boolean(aceMode);
const SOURCE_REQUIRED = ACE && aceMode.mode !== 'text_to_audio';
const AUDIO_CASE = soundModel
  ? {
      slug: CASE_NAME,
      search: soundModel.label,
      label: `${soundModel.label} — Text To Audio`,
      manifest: `diffusers.composite:${soundModel.pipeline}:text_to_audio`,
      admission: `diffusers.cluster-admission:${soundModel.pipeline}:text_to_audio:mode:text_to_audio`,
      nodes: 5,
      edges: 4,
      duration: soundModel.duration,
      steps: soundModel.steps,
    }
  : ACE
    ? {
        slug: CASE_NAME,
        search: 'ACE-Step',
        label: `ACE-Step — ${aceMode.label}`,
        manifest: `diffusers.composite:AceStepAudioPipeline:${aceMode.mode}`,
        admission: `diffusers.cluster-admission:AceStepAudioPipeline:${aceMode.mode}:mode:${aceMode.mode}`,
        nodes: aceMode.nodes,
        edges: aceMode.edges,
        duration: 30,
        steps: 8,
      }
    : {
        slug: 'minimax',
        search: 'Mini Max Music3',
        label: 'Mini Max Music3',
        manifest: 'diffusers.modular:MiniMaxMusic3ModularPipeline:default',
        admission:
          'diffusers.cluster-admission:MiniMaxMusic3ModularPipeline:default:workflow:official_top_level_blocks',
        nodes: 14,
        edges: 11,
        duration: 60,
        steps: 30,
      };

async function ready(page: Page) {
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 180_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
}

async function resize(page: Page, frame: Locator, dx: number, dy: number) {
  const grip = frame.getByTestId('node-resize-grip');
  const box = await grip.boundingBox();
  if (!box) throw new Error('Resize grip is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 12 });
  await page.mouse.up();
}

async function snapshot(page: Page, id: string) {
  return page.evaluate(async (rootId) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { blockInstanceValueV2 } = await import('/src/studio/blockSchemaV2.ts');
    const flow = useFlowStore.getState();
    const instance = flow.nodes.find((node) => node.id === rootId)?.data.blockInstanceV2;
    if (!instance) throw new Error('Missing audio Block instance');
    const exported = flow.exportGraph('audio-acceptance', rootId);
    return {
      instance,
      resolvedValues: {
        ...Object.fromEntries(
          instance.effectiveInterface.controls.map((control) => [
            control.controlId,
            blockInstanceValueV2(instance, control.controlId),
          ]),
        ),
        ...instance.values,
      },
      exported: { nodes: exported.nodes, paths: exported.paths },
      projected: flow.nodes.filter((node) => node.data.blockProjectionOwnerId === rootId).length,
    };
  }, id);
}

async function reconnectExportThroughCanvas(page: Page, rootId: string) {
  const clearFinished = page.getByTitle('Clear finished notifications', { exact: true });
  if ((await clearFinished.isVisible()) && (await clearFinished.isEnabled())) await clearFinished.click();
  const fixture = await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const state = useFlowStore.getState();
    const instance = state.nodes.find((node) => node.id === id)?.data.blockInstanceV2;
    const edge = instance?.effectiveGraph.edges.find((item) => item.targetNodeId === 'audioExport');
    if (!edge) throw new Error('The exact audio export connection is unavailable.');
    const projectionId = (nodeId: string) =>
      state.nodes.find((node) => node.data.blockProjectionOwnerId === id && node.data.blockProjectionNodeId === nodeId)
        ?.id;
    const projectedEdge = state.edges.find(
      (item) => item.data?.blockProjectionOwnerId === id && item.data?.blockProjectionEdgeId === edge.edgeId,
    );
    return {
      edge,
      source: projectionId(edge.sourceNodeId),
      target: projectionId(edge.targetNodeId),
      projectedEdge: projectedEdge?.id,
    };
  }, rootId);
  expect(fixture.projectedEdge).toBeTruthy();
  const before = await snapshot(page, rootId);
  const edge = page
    .locator('.react-flow__edge')
    .filter({ has: page.locator('path') })
    .and(page.locator(`[data-id="${fixture.projectedEdge}"]`));
  const reachablePoint = () =>
    edge.locator('.react-flow__edge-interaction').evaluate((element) => {
      const path = element as SVGPathElement;
      const matrix = path.getScreenCTM();
      if (!matrix) return null;
      const owner = path.closest('.react-flow__edge');
      for (let i = 5; i < 196; i += 1) {
        const point = path.getPointAtLength((path.getTotalLength() * i) / 200).matrixTransform(matrix);
        if (document.elementFromPoint(point.x, point.y)?.closest('.react-flow__edge') === owner) {
          return { x: point.x, y: point.y };
        }
      }
      return null;
    });
  if (!(await reachablePoint())) {
    // At fit-to-view a short export wire can sit entirely under its handles.
    // Move the output through the ordinary header gesture, not a forced click
    // through an occluding element or an injected edge selection.
    await page.locator('.react-flow__pane').click({ position: { x: 50, y: 50 } });
    const header = page.locator(`.react-flow__node[data-id="${fixture.target}"] header`).first();
    await header.click();
    const bounds = await header.boundingBox();
    expect(bounds).toBeTruthy();
    const x = bounds!.x + bounds!.width / 2;
    const y = bounds!.y + bounds!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 140, { steps: 12 });
    await page.mouse.up();
    await waitForRecursiveDomGeometry(page);
  }
  await expect.poll(reachablePoint).not.toBeNull();
  const point = await reachablePoint();
  await page.mouse.click(point!.x, point!.y);
  await expect(edge).toHaveClass(/selected/u);
  await page.keyboard.press('Delete');
  const connected = async () =>
    (await snapshot(page, rootId)).instance.effectiveGraph.edges.some(
      (item) =>
        item.sourceNodeId === fixture.edge.sourceNodeId &&
        item.sourcePortId === fixture.edge.sourcePortId &&
        item.targetNodeId === fixture.edge.targetNodeId &&
        item.targetPortId === fixture.edge.targetPortId,
    );
  await expect.poll(connected).toBe(false);
  await expect(page.getByTestId('studio-run')).toBeDisabled();
  await page.getByTestId('graph-fix').click();
  const fix = page.getByTestId('graph-fix-dialog');
  await expect(fix.locator('[data-testid^="graph-fix-issue-"]').first()).toBeVisible();
  const fixExplanation = await fix.innerText();
  expect(fixExplanation).not.toMatch(/needs (prompt|lyrics)/iu);
  await fix.getByTestId('graph-fix-apply').click();
  await expect(fix).toHaveCount(0);
  await expect.poll(connected).toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(connected).toBe(false);
  await page.keyboard.press('Control+z');
  await expect.poll(connected).toBe(true);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(connected).toBe(false);
  await waitForRecursiveDomGeometry(page);
  const source = page.getByTestId(`node-handle-${fixture.source}-${fixture.edge.sourcePortId}`);
  const target = page.getByTestId(`node-handle-${fixture.target}-${fixture.edge.targetPortId}`);
  await source.click({ trial: true });
  await target.click({ trial: true });
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).toBeTruthy();
  expect(targetBox).toBeTruthy();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(connected).toBe(true);
  const after = await snapshot(page, rootId);
  expect(after.instance.definitionSnapshot).toEqual(before.instance.definitionSnapshot);
  expect(after.instance.values).toEqual(before.instance.values);
  expect(after.instance.effectiveGraph.nodes).toEqual(before.instance.effectiveGraph.nodes);
  expect(after.exported.nodes).toEqual(before.exported.nodes);
  expect(after.exported.paths.map((item) => JSON.stringify(item)).sort()).toEqual(
    before.exported.paths.map((item) => JSON.stringify(item)).sort(),
  );
  await waitForRecursiveDomGeometry(page);
  return {
    deleted: fixture.edge,
    fixExplanation,
    fixAppliedAndUndone: true,
    undo: true,
    redo: true,
    nativeReconnect: true,
    valuesUnchanged: true,
  };
}

async function saveUserChoice(page: Page, selectedId: string, button: Locator) {
  await button.click();
  const pending = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/studio/blocks' && response.request().method() === 'POST',
  );
  const dialog = page.getByTestId(`save-user-block-choices-${selectedId}`);
  await dialog.getByRole('button', { name: 'Save as new User Node', exact: true }).click();
  const response = await pending;
  expect(response.ok()).toBe(true);
  await expect(dialog).toHaveCount(0);
  return response.request().postDataJSON() as BlockDefinitionV2;
}

async function reinsertSavedUserNode(page: Page, definition: BlockDefinitionV2) {
  await page.getByTestId('workflow-tab-new').click();
  await ready(page);
  await page.getByLabel('Search nodes').fill(definition.displayName);
  const rowId = definition.definitionId.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  await page.getByTestId(`user-block-row-${rowId}`).click();
  const frame = page.locator('[data-block-source="user"]');
  await expect(frame).toHaveCount(1);
  const id = (await frame.getAttribute('data-testid'))!.replace('user-block-', '');
  const restored = await snapshot(page, id);
  expect(restored.instance.definitionSnapshot).toEqual(definition);
  return { id, restored };
}

async function editOrdinaryChildThroughCanvas(page: Page, rootId: string) {
  const before = await snapshot(page, rootId);
  const clear = page.getByTitle('Clear finished notifications', { exact: true });
  if ((await clear.isVisible()) && (await clear.isEnabled())) await clear.click();
  const insert = async () => {
    const ids = await page.evaluate(async () =>
      (await import('/src/stores/useFlowStore.ts')).useFlowStore.getState().nodes.map((node) => node.id),
    );
    await page.getByLabel('Search nodes').fill('Data Viewer');
    const primitive = page.getByTestId('node-group-primitive').getByRole('button').first();
    if ((await primitive.getAttribute('aria-expanded')) !== 'true') await primitive.click();
    await page.getByTestId('node-row-modules-Primitive-DataViewer').click();
    const addedId = await page.evaluate(
      async (existing) =>
        (await import('/src/stores/useFlowStore.ts')).useFlowStore
          .getState()
          .nodes.find((node) => !existing.includes(node.id) && node.data.action === 'DataViewer')?.id,
      ids,
    );
    expect(addedId).toBeTruthy();
    return addedId!;
  };
  const drag = async (source: Locator, destination: { x: number; y: number }) => {
    await page.locator('.react-flow__pane').click({ position: { x: 80, y: 30 } });
    await source.locator('header').first().click();
    const header = await source.locator('header').first().boundingBox();
    if (!header) throw new Error('Ordinary node header missing');
    const pointer = { x: header.x + header.width / 2, y: header.y + header.height / 2 };
    await page.mouse.move(pointer.x, pointer.y);
    await page.mouse.down();
    await page.mouse.move(pointer.x + 4, pointer.y + 4, { steps: 4 });
    const bounds = await source.boundingBox();
    if (!bounds) throw new Error('Dragging node disappeared');
    await page.mouse.move(
      destination.x - bounds.width / 2 + pointer.x + 4 - bounds.x,
      destination.y - bounds.height / 2 + pointer.y + 4 - bounds.y,
      { steps: 12 },
    );
    const landed = await source.boundingBox();
    if (!landed) throw new Error('Dragged node has no measured bounds');
    expect(Math.abs(landed.x + landed.width / 2 - destination.x)).toBeLessThan(8);
    expect(Math.abs(landed.y + landed.height / 2 - destination.y)).toBeLessThan(8);
    await page.mouse.up();
  };
  const root = page.getByTestId(`user-block-${rootId}`);
  const firstId = await insert();
  await page.getByTestId('arrange-graph').click();
  await waitForRecursiveDomGeometry(page);
  // Choose visible empty container space, not a percentage that can land on
  // an existing child (replacement) or outside the viewport after fitView.
  const sourceBounds = await page.locator(`.react-flow__node[data-id="${firstId}"]`).boundingBox();
  if (!sourceBounds) throw new Error('Inserted node has no bounds');
  const destination = await root.evaluate((element, source) => {
    const bounds = element.getBoundingClientRect();
    const children = [...document.querySelectorAll('.react-flow__node')]
      .filter((node) => node !== element.closest('.react-flow__node'))
      .map((node) => node.getBoundingClientRect());
    // Keep the entire node and its header drag pointer inside the body. A
    // center inside the root can still leave the pointer on its header.
    for (
      let y = bounds.y + 60 + source.height / 2;
      y < Math.min(bounds.bottom - 80 - source.height / 2, innerHeight - 40);
      y += 25
    ) {
      for (
        let x = bounds.x + 35 + source.width / 2;
        x < Math.min(bounds.right - 35 - source.width / 2, innerWidth - 40);
        x += 25
      ) {
        if (
          children.every(
            (child) => x < child.left - 15 || x > child.right + 15 || y < child.top - 15 || y > child.bottom + 15,
          )
        )
          return { x, y };
      }
    }
    throw new Error('No visible blank container space for adoption');
  }, sourceBounds);
  await drag(page.locator(`.react-flow__node[data-id="${firstId}"]`), destination);
  await expect
    .poll(async () =>
      (await snapshot(page, rootId)).instance.effectiveGraph.nodes.some((node) => node.nodeId === firstId),
    )
    .toBe(true);
  await waitForRecursiveDomGeometry(page);
  const adopted = await snapshot(page, rootId);
  expect(adopted.instance.definitionSnapshot).toEqual(before.instance.definitionSnapshot);
  expect(adopted.instance.values).toEqual(before.instance.values);
  const secondId = await insert();
  await page.getByTestId('arrange-graph').click();
  const projected = async (semanticId: string) => {
    const id = await page.evaluate(
      async ({ owner, semantic }) =>
        (await import('/src/stores/useFlowStore.ts')).useFlowStore
          .getState()
          .nodes.find(
            (node) => node.data.blockProjectionOwnerId === owner && node.data.blockProjectionNodeId === semantic,
          )?.id,
      { owner: rootId, semantic: semanticId },
    );
    if (!id) throw new Error(`Missing projected ordinary child ${semanticId}`);
    return page.locator(`.react-flow__node[data-id="${id}"]`);
  };
  const target = await (await projected(firstId)).boundingBox();
  if (!target) throw new Error('Replacement target missing');
  await drag(page.locator(`.react-flow__node[data-id="${secondId}"]`), {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  });
  // The transient success snackbar may expire during a measured layout pass.
  // Assert the durable replacement itself, including both semantic identities.
  await expect
    .poll(async () => {
      const graph = (await snapshot(page, rootId)).instance.effectiveGraph;
      return [
        graph.nodes.some((node) => node.nodeId === firstId),
        graph.nodes.some((node) => node.nodeId === secondId),
      ];
    })
    .toEqual([false, true]);
  const replaced = await snapshot(page, rootId);
  expect(replaced.instance.effectiveGraph.nodes.some((node) => node.nodeId === firstId)).toBe(false);
  expect(replaced.instance.effectiveGraph.nodes.some((node) => node.nodeId === secondId)).toBe(true);
  expect(replaced.instance.values).toEqual(before.instance.values);
  await (await projected(secondId)).locator('header').first().click();
  await page.getByTestId('selection-toolbar-delete').click();
  await expect
    .poll(async () =>
      (await snapshot(page, rootId)).instance.effectiveGraph.nodes.some((node) => node.nodeId === secondId),
    )
    .toBe(false);
  const deleted = await snapshot(page, rootId);
  expect(deleted.instance.effectiveGraph.nodes).toEqual(before.instance.effectiveGraph.nodes);
  expect(deleted.instance.effectiveGraph.edges).toEqual(before.instance.effectiveGraph.edges);
  expect(deleted.instance.values).toEqual(before.instance.values);
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () =>
      (await snapshot(page, rootId)).instance.effectiveGraph.nodes.some((node) => node.nodeId === secondId),
    )
    .toBe(true);
  await page.keyboard.press('Control+Shift+z');
  await expect
    .poll(async () =>
      (await snapshot(page, rootId)).instance.effectiveGraph.nodes.some((node) => node.nodeId === secondId),
    )
    .toBe(false);
  await waitForRecursiveDomGeometry(page);
  return {
    firstId,
    secondId,
    adopted,
    replaced,
    deleted,
    scope:
      'Native palette insertion, adoption, compatible ordinary-child replacement, deletion and Undo/Redo; source graph and parameters restored',
  };
}

test('Audio Block preserves full-setting native edits and generates audio when authorized', async ({ page }) => {
  test.skip(process.env.MODIFF_RUN_AUDIO_ACCEPTANCE !== '1', 'Explicit live audio acceptance opt-in.');
  const generate = process.env.MODIFF_AUDIO_GENERATE === '1';
  if (generate && CASE_NAME === 'minimax' && process.env.MODIFF_ACKNOWLEDGE_MINIMAX_MUSIC3_LICENSE !== '1') {
    throw new Error('MiniMax generation requires the user’s model-use acknowledgement.');
  }
  const output = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  if (!output) throw new Error('A private evidence directory is required.');
  const prefix = `${output}/${AUDIO_CASE.slug}`;
  await mkdir(output, { recursive: true, mode: 0o700 });
  test.setTimeout(generate ? 2 * 60 * 60_000 : 8 * 60_000);
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors: string[] = [];
  const missingHandles: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.text().includes("[React Flow]: Couldn't create edge for")) missingHandles.push(message.text());
  });
  const completions: unknown[] = [];
  const deliveryEvents: Array<{ at: number; type: string; taskId?: string }> = [];
  page.on('websocket', (socket) => {
    socket.on('close', () => deliveryEvents.push({ at: Date.now(), type: 'socket_closed' }));
    socket.on('socketerror', () => deliveryEvents.push({ at: Date.now(), type: 'socket_error' }));
    socket.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload)) as { type?: string; task_id?: string };
        if (
          message.type &&
          ['welcome', 'graph_started', 'graph_completed', 'graph_error', 'queue'].includes(message.type)
        )
          deliveryEvents.push({ at: Date.now(), type: message.type, taskId: message.task_id });
        if (message.type === 'graph_completed' || message.type === 'graph_error') completions.push(message);
      } catch {
        // Only JSON completion receipts are captured, not binary frames.
      }
    });
  });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('audio-acceptance-initialized')) return;
    localStorage.clear();
    sessionStorage.setItem('audio-acceptance-initialized', 'yes');
  });
  // Start only after the intentionally restarted backend has loaded its registry.
  // A 502 during startup is a visible Retry state, not a model acceptance result.
  await expect
    .poll(
      async () => {
        const response = await page.request
          .get(`${process.env.MODIFF_LIVE_BACKEND_URL ?? 'http://127.0.0.1:8088'}/health`, { timeout: 10_000 })
          .catch(() => null);
        return response?.ok() ? (await response.json()).ready : false;
      },
      { timeout: 180_000 },
    )
    .toBe(true);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.getByTestId('workflow-tab-new').click();
  await ready(page);
  const auto = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await auto.getAttribute('aria-checked')) !== 'false')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  const search = page.getByLabel('Search nodes');
  if (!(await search.isVisible())) await page.getByTestId('left-tab-nodes').click();
  await search.fill(AUDIO_CASE.search);
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  const disclosure = group.getByRole('button').first();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: AUDIO_CASE.label });
  await expect(row).toHaveCount(1);
  await row.click();
  const frame = page.locator('[data-block-source="diffusers_catalog"]');
  await expect(frame).toHaveCount(1);
  const id = (await frame.getAttribute('data-testid'))!.replace('user-block-', '');
  const original = await snapshot(page, id);
  expect(original.instance.definitionSnapshot.source.manifestDefinitionId).toBe(AUDIO_CASE.manifest);
  expect(original.instance.definitionSnapshot.source.executionAdmissionId).toBe(AUDIO_CASE.admission);
  expect(original.instance.effectiveGraph.nodes).toHaveLength(AUDIO_CASE.nodes);
  expect(original.instance.effectiveGraph.edges).toHaveLength(AUDIO_CASE.edges);
  if (soundModel) {
    const fields = original.instance.effectiveGraph.nodes.find((node) => node.nodeId === 'audioGenerate')!.data.params;
    expect(fields.bpm.hidden).toBe(true);
    expect(fields.guidance_scale.hidden).toBe(true);
    expect(fields.stable_audio_steps.hidden).toBe(false);
    expect(fields.stable_audio_guidance.hidden).toBe(false);
  }
  if ('audio_duration' in original.instance.values) {
    expect(original.instance.values.audio_duration).toBe(AUDIO_CASE.duration);
  }
  expect(original.instance.values.num_inference_steps).toBe(AUDIO_CASE.steps);

  const edits: Array<[string, string, string]> = [
    ['prompt', 'prompt', PROMPT],
    ['num inference steps', 'num_inference_steps', String(AUDIO_CASE.steps)],
    ['Seed', 'seed', '20260908'],
  ];
  if (!soundModel) edits.push(['lyrics', 'lyrics', LYRICS]);
  if ('audio_duration' in original.instance.values) {
    edits.push(['audio duration', 'audio_duration', `${AUDIO_CASE.duration}.0`]);
  }
  if (aceMode?.mode === 'audio_continuation') {
    expect(original.instance.values.extension_duration).toBe(15);
    edits.push(['extension duration', 'extension_duration', '15.0']);
  }
  if (aceMode?.mode === 'audio_repaint') {
    expect(original.instance.values.repainting_start).toBe(0);
    expect(original.instance.values.repainting_end).toBe(10);
    edits.push(['repainting start', 'repainting_start', '10.00'], ['repainting end', 'repainting_end', '20.00']);
  }
  if (aceMode?.mode === 'audio_variation') {
    expect(original.instance.values.audio_cover_strength).toBe(0.5);
    edits.push(['audio cover strength', 'audio_cover_strength', '0.65']);
  }
  for (const [label, , value] of edits) {
    const field = frame.getByLabel(label, { exact: true });
    if (!(await field.count())) {
      const advanced = frame.getByRole('button', { name: 'Advanced', exact: true });
      if ((await advanced.count()) === 1 && (await advanced.getAttribute('aria-expanded')) !== 'true') {
        await advanced.click();
      }
    }
    await field.fill(value);
    await field.blur();
    await expect(field).toHaveValue(value);
  }
  let reference: { sha256: string; stored: string } | undefined;
  if (SOURCE_REQUIRED) {
    const source = process.env.MODIFF_AUDIO_SOURCE;
    if (!source) throw new Error('Edit acceptance requires an explicitly supplied owned audio reference.');
    const bytes = await readFile(source);
    const picker = frame.locator('input[type="file"]');
    await expect(picker).toHaveCount(1);
    await picker.setInputFiles({ name: 'owned-audio-reference.wav', mimeType: 'audio/wav', buffer: bytes });
    await expect.poll(async () => (await snapshot(page, id)).instance.values.source_audio).toBeTruthy();
    const value = (await snapshot(page, id)).instance.values.source_audio;
    const stored = Array.isArray(value) ? String(value[0]) : String(value);
    expect(stored).not.toBe('');
    const uploaded = await page.request.get(`/file?file=${encodeURIComponent(stored)}`);
    expect(uploaded.ok()).toBe(true);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(
      createHash('sha256')
        .update(await uploaded.body())
        .digest('hex'),
    ).toBe(sha256);
    reference = { sha256, stored };
  }
  let edited = await snapshot(page, id);
  expect(edited.instance.definitionSnapshot).toEqual(original.instance.definitionSnapshot);
  expect(edited.instance.effectiveGraph).toEqual(original.instance.effectiveGraph);
  for (const [key, value] of Object.entries(original.instance.values)) {
    if (!edits.some(([, fieldId]) => fieldId === key) && !(SOURCE_REQUIRED && key === 'source_audio')) {
      expect(edited.instance.values[key]).toEqual(value);
    }
  }
  await resize(page, frame, -150, -100);
  await frame.getByLabel('Expand block', { exact: true }).click();
  const blocks = page.locator('[data-block-projection="modular-diffusers"]');
  await expect(blocks.locator('[aria-label^="Collapse "]')).toHaveCount(0);
  await waitForRecursiveDomGeometry(page);
  expect((await snapshot(page, id)).exported).toEqual(edited.exported);
  for (let level = 0; level < 12; level += 1) {
    const button = blocks.locator('[aria-label^="Expand "]').first();
    if (!(await button.count())) break;
    await page.getByTestId('arrange-graph').click();
    await button.click();
    await waitForRecursiveDomGeometry(page);
    expect((await snapshot(page, id)).exported).toEqual(edited.exported);
  }
  await expect(blocks.locator('[aria-label^="Expand "]')).toHaveCount(0);
  expect((await snapshot(page, id)).projected).toBe(AUDIO_CASE.nodes);
  await page.getByTestId('arrange-graph').click();
  await waitForRecursiveDomGeometry(page);
  const structural =
    process.env.MODIFF_AUDIO_STRUCTURAL === '1' ? await reconnectExportThroughCanvas(page, id) : undefined;
  if (structural) edited = await snapshot(page, id);
  const ordinaryEdits =
    process.env.MODIFF_AUDIO_NODE_EDITS === '1' ? await editOrdinaryChildThroughCanvas(page, id) : undefined;
  if (ordinaryEdits) edited = await snapshot(page, id);
  let nestedUserDefinition: BlockDefinitionV2 | undefined;
  if (process.env.MODIFF_AUDIO_USER_NODE === '1' && CASE_NAME === 'minimax') {
    const selectedId = await page.evaluate(async (ownerId) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return useFlowStore
        .getState()
        .nodes.find(
          (node) =>
            node.data.blockProjectionOwnerId === ownerId &&
            node.data.blockProjectionNodeId === 'container:semantic_generator',
        )?.id;
    }, id);
    expect(selectedId).toBeTruthy();
    const beforeNestedSave = await snapshot(page, id);
    nestedUserDefinition = await saveUserChoice(
      page,
      selectedId!,
      page.getByTestId(`projected-block-save-${selectedId}`),
    );
    expect(await snapshot(page, id)).toEqual(beforeNestedSave);
    expect(nestedUserDefinition.source.kind).toBe('user');
    expect(nestedUserDefinition.graph.nodes).toHaveLength(3);
  }
  await page.screenshot({ path: `${prefix}-expanded.png` });
  await frame.getByLabel('Collapse block', { exact: true }).click();
  expect((await snapshot(page, id)).exported).toEqual(edited.exported);
  await page.getByTestId('topbar-save-workflow').click();
  await expect(page.getByTestId('save-workflow-dialog')).toBeVisible();
  await page.getByTestId('save-workflow-name').fill(`${AUDIO_CASE.slug} full-setting acceptance ${Date.now()}`);
  const savedResponse = page.waitForResponse(
    (response) =>
      /\/workflows(?:\/[^/]+)?$/u.test(new URL(response.url()).pathname) &&
      ['POST', 'PUT'].includes(response.request().method()),
  );
  await page.getByTestId('confirm-save-workflow').click();
  expect((await savedResponse).ok()).toBe(true);
  await expect(page.getByTestId('save-workflow-dialog')).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  expect((await snapshot(page, id)).exported).toEqual(edited.exported);
  await expect(frame.getByLabel('prompt', { exact: true })).toHaveValue(PROMPT);
  if (!soundModel) await expect(frame.getByLabel('lyrics', { exact: true })).toHaveValue(LYRICS);
  const evidence: Record<string, unknown> = {
    scope: 'native parameter edits, resize-before-expand, recursive geometry, execution-export parity, Save/refresh',
    generationRequested: generate,
    structural,
    ordinaryEdits,
    reference,
    nestedUserDefinition,
    original: original.instance,
    restored: await snapshot(page, id),
    errors,
    missingHandles,
  };
  await writeFile(`${prefix}-lifecycle.json`, JSON.stringify(evidence, null, 2));
  expect(errors).toEqual([]);
  expect(missingHandles).toEqual([]);
  if (process.env.MODIFF_AUDIO_USER_NODE === '1') {
    if (generate) throw new Error('Run reusable-node persistence separately from GPU execution acceptance.');
    const saved = await saveUserChoice(page, id, frame.getByTestId(`user-block-save-choices-${id}`));
    const converted = await snapshot(page, id);
    expect(converted.instance.definitionSnapshot.source.kind).toBe('user');
    expect(converted.instance.values).toEqual(edited.instance.values);
    expect(converted.exported).toEqual(edited.exported);
    const persistedUserWorkflow = page.waitForResponse(
      (response) =>
        /\/workflows(?:\/[^/]+)?$/u.test(new URL(response.url()).pathname) &&
        ['POST', 'PUT'].includes(response.request().method()),
    );
    await page.getByTestId('topbar-save-workflow').click();
    expect((await persistedUserWorkflow).ok()).toBe(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(page);
    expect((await snapshot(page, id)).exported).toEqual(converted.exported);
    const inserted = await reinsertSavedUserNode(page, saved);
    expect(inserted.restored.resolvedValues).toEqual(converted.resolvedValues);
    expect(
      JSON.parse(
        JSON.stringify(inserted.restored.exported).replaceAll(
          `block-v2-node:${inserted.id.length}:${inserted.id}:`,
          'block-v2-node:<root>:',
        ),
      ),
    ).toEqual(
      JSON.parse(
        JSON.stringify(converted.exported).replaceAll(`block-v2-node:${id.length}:${id}:`, 'block-v2-node:<root>:'),
      ),
    );
    let insertedNested;
    if (nestedUserDefinition) {
      insertedNested = await reinsertSavedUserNode(page, nestedUserDefinition);
      expect(JSON.stringify(insertedNested.restored.exported)).toContain(MUSIC_PROMPT);
      expect(JSON.stringify(insertedNested.restored.exported)).toContain(JSON.stringify(LYRICS).slice(1, -1));
    }
    evidence.reusable = { saved, converted, inserted, insertedNested };
    await writeFile(`${prefix}-lifecycle.json`, JSON.stringify(evidence, null, 2));
    expect(errors).toEqual([]);
    expect(missingHandles).toEqual([]);
  }
  if (!generate) return;

  const backend = process.env.MODIFF_LIVE_BACKEND_URL ?? 'http://127.0.0.1:8088';
  const health = await page.request.get(`${backend}/health`);
  evidence.healthBefore = await health.json();
  const profiler = process.env.MODIFF_AUDIO_PROFILE === '1' ? await page.context().newCDPSession(page) : null;
  if (profiler) {
    await profiler.send('Profiler.enable');
    await profiler.send('Profiler.setSamplingInterval', { interval: 2000 });
    await profiler.send('Profiler.start');
  }
  await frame.locator('header').first().click();
  const submission = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/graph' && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByTestId('selection-toolbar-run-from-node').click();
  const terms = page.getByTestId('model-usage-terms-dialog');
  if (await terms.isVisible().catch(() => false)) await page.getByTestId('model-usage-terms-confirm').click();
  const response = await submission;
  evidence.submittedGraph = response.request().postDataJSON();
  evidence.submission = await response.json();
  await writeFile(`${prefix}-lifecycle.json`, JSON.stringify(evidence, null, 2));
  expect(response.ok()).toBe(true);
  const taskId = (evidence.submission as { task_id?: string }).task_id;
  expect(taskId).toBeTruthy();
  console.log(`[audio acceptance] ${AUDIO_CASE.slug} full-setting task ${taskId}`);
  let terminal: unknown;
  await expect
    .poll(
      async () => {
        const result = await page.request.get(`${backend}/queue`);
        const queue = await result.json();
        const tasks = [
          ...Object.values(queue.queued ?? {}),
          ...(queue.recent ?? []),
          ...(queue.current ? [queue.current] : []),
        ];
        const task = tasks.find((entry: { task_id?: string }) => entry.task_id === taskId);
        if (task && ['completed', 'failed', 'cancelled'].includes(task.status)) terminal = task;
        return task?.status;
      },
      { timeout: 100 * 60_000, intervals: [2000, 5000] },
    )
    .toMatch(/^(completed|failed|cancelled)$/u);
  const run = await page.request.get(`${backend}/runs/${taskId}`);
  evidence.terminal = terminal;
  evidence.run = await run.json();
  evidence.completions = completions;
  evidence.deliveryEvents = deliveryEvents;
  await writeFile(`${prefix}-lifecycle.json`, JSON.stringify(evidence, null, 2));
  expect((terminal as { status: string }).status).toBe('completed');
  // An edit Block also contains a source-audio player. Only the declared output
  // preview proves generated playback; never capture the first audio element.
  const audio = frame.locator('[data-testid^="block-v2-preview-"]').locator('audio').first();
  try {
    await expect(audio).toBeVisible({ timeout: 60_000 });
  } catch (error) {
    if (profiler) await writeFile(`${prefix}-cpu-profile.json`, JSON.stringify(await profiler.send('Profiler.stop')));
    await writeFile(`${prefix}-lifecycle.json`, JSON.stringify(evidence, null, 2));
    throw error;
  }
  const src = await audio.evaluate((element: HTMLAudioElement) => element.currentSrc || element.src);
  expect(src).toBeTruthy();
  await expect
    .poll(() =>
      audio.evaluate(
        (element: HTMLAudioElement) => !element.error && Number.isFinite(element.duration) && element.duration > 0,
      ),
    )
    .toBe(true);
  evidence.playback = await audio.evaluate((element: HTMLAudioElement) => ({
    src: element.currentSrc || element.src,
    duration: element.duration,
    readyState: element.readyState,
    error: element.error?.message ?? null,
  }));
  const runRecord = evidence.run as {
    outputs: Array<{
      backendProvenance?: {
        mediaItems?: Array<{ displayType: string; taskId: string; url: string; mediaHash: string }>;
      };
    }>;
  };
  const media = runRecord.outputs
    .flatMap((item) => item.backendProvenance?.mediaItems ?? [])
    .filter((item) => item.displayType === 'audio' && item.taskId === taskId);
  expect(media).toHaveLength(1);
  // Delivery previews may be transcoded. Archive the original WAV tied to this
  // exact backend execution, and verify the receipt's hash, not the input player.
  const asset = await page.request.get(new URL(media[0].url, backend).href);
  expect(asset.ok()).toBe(true);
  const bytes = await asset.body();
  expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
  expect(`sha256:bytes:${createHash('sha256').update(bytes).digest('hex')}`).toBe(media[0].mediaHash);
  await writeFile(`${prefix}-full-setting.wav`, bytes);
  evidence.asset = {
    filename: `${AUDIO_CASE.slug}-full-setting.wav`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  await writeFile(`${prefix}-lifecycle.json`, JSON.stringify(evidence, null, 2));
  if (profiler) await writeFile(`${prefix}-cpu-profile.json`, JSON.stringify(await profiler.send('Profiler.stop')));
  if (process.env.MODIFF_AUDIO_DELIVERY_CHECK === '1') {
    const delivered = deliveryEvents.find((event) => event.type === 'graph_completed' && event.taskId === taskId);
    expect(delivered).toBeTruthy();
    const completedAt = (terminal as { completed_at: number }).completed_at * 1000;
    expect(delivered!.at - completedAt).toBeLessThan(10_000);
  }
  expect(errors).toEqual([]);
  expect(missingHandles).toEqual([]);
});
