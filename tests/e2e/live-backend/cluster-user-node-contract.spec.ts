import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  backendSourceIdentity,
  createRunProvenance,
  selectInstalledModelIdentity,
  sha256Value,
} from '../../../scripts/live-proof-provenance.mjs';
import { decodedMediaHash } from '../../../scripts/template-gallery-harness.mjs';

const QWEN_MANIFEST_DEFINITION_ID = 'diffusers.modular:QwenImageModularPipeline:text2image';
const QWEN_DEFINITION_ID = 'diffusers.cluster-admission:QwenImageModularPipeline:text2image:mode:text_to_image';
const QWEN_REPOSITORY = 'Qwen/Qwen-Image-2512';
const QWEN_REVISION = '25468b98e3276ca6700de15c6628e51b7de54a26';
const QWEN_BLOCK_V2_CONTENT_HASH = 'block-definition-v2-bf9170d5';
const QWEN_BLOCK_V2_CANONICAL_SHA256 = 'sha256:702d3b5ae0f1ee9a9dac0a80f8b09aef3590644cb23f66255d0853a53e5a5f93';
const QWEN_STUDIO_SPEC_CONTENT_HASH = 'studio-spec-v1-f4c15e0d';
const QWEN_OPTIONAL_RUNTIME_ID = 'huggingface-transformers-main-96fe6dce-peft-0.20.0';
const MINIMAX_MUSIC3_MANIFEST_DEFINITION_ID = 'diffusers.modular:MiniMaxMusic3ModularPipeline:default';
const MINIMAX_MUSIC3_DEFINITION_ID =
  'diffusers.cluster-admission:MiniMaxMusic3ModularPipeline:default:workflow:official_top_level_blocks';
const MINIMAX_MUSIC3_REPOSITORY = 'MiniMaxAI/MiniMax-Music3';
const MINIMAX_MUSIC3_REVISION = 'fbdf52fbaaca799592917417eb05f1899f1255ec';
const MINIMAX_MUSIC3_CREATOR_PROMPT =
  'A polished original composition with a clear musical arc, detailed instrumentation, and a clean mix.';
const MINIMAX_MUSIC3_PROOF_PROMPT =
  'Short technical audio proof: bright acoustic pop, clear lead vocal, handclaps, and one bell hit.';
const MINIMAX_MUSIC3_PROOF_LYRICS = '[verse]\nThis is a persistence test\n[chorus]\nThe saved words return';
const MINIMAX_MUSIC3_ROUTE_BINDING = {
  schemaVersion: 1,
  admissionId: MINIMAX_MUSIC3_DEFINITION_ID,
  blockDefinition: {
    definitionId: MINIMAX_MUSIC3_DEFINITION_ID,
    contentHash: 'block-definition-v2-5f610dae',
    canonicalSha256: 'sha256:b5f8b4618df9680126056c82203e6f867529f572e114ee874761f5ca689d2e7d',
  },
  studioExecutionSpec: {
    id: 'minimax-music3:modular-text-to-audio:v1',
    contentHash: 'studio-spec-v1-8a75ab6f',
    executionProfileId: 'minimax-music3:official-modular-workflow',
  },
  artifact: { repository: MINIMAX_MUSIC3_REPOSITORY, revision: MINIMAX_MUSIC3_REVISION },
  modelDependencies: [],
} as const;
const MINIMAX_RUN_CORRELATION_HINT_KEYS = [
  'clientRunId',
  'runInputHash',
  'workflowTabId',
  'workflowCanvasEpoch',
  'workflowTitle',
  'workflowSnapshot',
  'nodeId',
] as const;
const LIVE_BACKEND_URL = process.env.MODIFF_LIVE_BACKEND_URL || 'http://127.0.0.1:8088';
const CREATOR_PROMPT =
  'A 20-year-old East Asian girl with delicate, charming features and large, bright brown eyes—expressive and ' +
  'lively, with a cheerful or subtly smiling expression. Her naturally wavy long hair is either loose or tied in ' +
  'twin ponytails. She has fair skin and light makeup accentuating her youthful freshness. She wears a modern, ' +
  'cute dress or relaxed outfit in bright, soft colors—lightweight fabric, minimalist cut. She stands indoors at ' +
  'an anime convention, surrounded by banners, posters, or stalls. Lighting is typical indoor illumination—no ' +
  'staged lighting—and the image resembles a casual iPhone snapshot: unpretentious composition, yet brimming with ' +
  'vivid, fresh, youthful charm.';
const CREATOR_NEGATIVE_PROMPT =
  '低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲。';
const SHOWCASE_PROMPT =
  'A wide-angle cinematic editorial photograph of a circular Victorian glass botanical observatory at blue hour ' +
  'just after rain. In the foreground, a wet black-stone path scattered with pale magnolia petals leads toward the ' +
  'pavilion. Through open brass-framed doors, the midground reveals towering monstera, tree ferns, white orchids, ' +
  'and tiny bioluminescent blue flowers surrounding a walnut reading desk. A polished brass telescope points through ' +
  'the open dome toward a deep cobalt sky and distant mist-covered mountains. Warm tungsten reading lamps glow inside ' +
  'and form physically coherent reflections across the curved rain-streaked glass. A small cream enamel sign beside ' +
  'the entrance clearly reads "NIGHT GARDEN". Photorealistic natural materials, coherent architecture, precise ' +
  'foreground-to-background depth, restrained color palette, balanced symmetrical composition, subtle 35mm film ' +
  'grain, no people.';
const SHOWCASE_NEGATIVE_PROMPT =
  'low resolution, blurry details, oversaturated colors, plastic plants, warped architecture, broken glass geometry, ' +
  'incoherent reflections, duplicated objects, illegible sign, misspelled text, flat lighting, excessive bloom, ' +
  'artificial CGI appearance, cluttered composition, people';
const EDITED_PROMPT =
  'A small red cube beside a blue glass sphere on a clean white tabletop, centered technical studio photograph.';
const EXACT_QWEN_TEXT_TO_IMAGE_NODE_COUNT = 14;
// The selected text-to-image route projects 14 executable leaves plus five
// visible hierarchy containers. Inactive Auto alternatives remain pinned in
// upstream provenance, but are intentionally not active canvas nodes.
const EXACT_QWEN_TEXT_TO_IMAGE_PROJECTION_NODE_COUNT = 19;
const EXACT_QWEN_TEXT_TO_IMAGE_EDGE_COUNT = 13;

type ExecutionExport = {
  nodes: Record<string, { module?: string; action?: string; params?: Record<string, unknown> }>;
  paths: unknown[];
  deterministicMode?: unknown;
  provenance?: Record<string, unknown>;
  runtimeHints?: Record<string, unknown>;
};

type BlockSnapshot = {
  instanceId: string;
  instanceJson: string;
  definitionId: string;
  manifestDefinitionId: string | null;
  sourceKind: string;
  sourceParent: { definitionId: string; contentHash: string; sourceKind: string } | null;
  repository: string | null;
  repositoryRevision: string | null;
  values: Record<string, unknown>;
  definitionDefaults: Record<string, unknown>;
  resolvedValues: Record<string, unknown>;
  boundaryInputs: Array<{ portId: string; valueType: string }>;
  boundaryOutputs: Array<{ portId: string; valueType: string }>;
  rootPosition: { x: number; y: number };
  rootSize: { width: number; height: number };
  internalLayout: Record<string, { x: number; y: number }>;
  projectionNodes: Array<{
    id: string;
    semanticNodeId: string;
    position: { x: number; y: number };
  }>;
  projectionEdges: Array<{
    id: string;
    semanticEdgeId: string;
    source: string;
    target: string;
  }>;
  projectionEdgeCount: number;
};

async function assertExpandedBlockContainsProjection(page: Page, rootId: string) {
  const root = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
  const rootBounds = await root.boundingBox();
  expect(rootBounds).toBeTruthy();
  const childIds = await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore
      .getState()
      .nodes.filter((node) => node.data.blockProjectionOwnerId === id)
      .map((node) => node.id);
  }, rootId);
  expect(childIds.length).toBeGreaterThan(0);

  const tolerance = 2;
  for (const childId of childIds) {
    const child = page.locator(`.react-flow__node[data-id="${childId}"]`);
    const childBounds = await child.boundingBox();
    expect(childBounds, `${childId} must be rendered and measurable`).toBeTruthy();
    expect(childBounds!.x, `${childId} starts left of its Block`).toBeGreaterThanOrEqual(rootBounds!.x - tolerance);
    expect(childBounds!.y, `${childId} starts above its Block`).toBeGreaterThanOrEqual(rootBounds!.y - tolerance);
    expect(childBounds!.x + childBounds!.width, `${childId} extends right of its Block`).toBeLessThanOrEqual(
      rootBounds!.x + rootBounds!.width + tolerance,
    );
    expect(childBounds!.y + childBounds!.height, `${childId} extends below its Block`).toBeLessThanOrEqual(
      rootBounds!.y + rootBounds!.height + tolerance,
    );
  }
  return { rootBounds, childIds };
}

async function expandEveryNestedBlockContainer(page: Page, rootId: string) {
  for (let iteration = 0; iteration < 256; iteration += 1) {
    const result = await page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      const instance = flow.nodes.find((node) => node.id === id)?.data.blockInstanceV2;
      const candidate = flow.nodes.find(
        (node) =>
          node.data.blockProjectionOwnerId === id &&
          node.data.blockProjectionContainer &&
          node.data.blockProjectionContainerExpanded === false,
      );
      if (!instance) throw new Error(`Missing Block V2 instance ${id}.`);
      if (!candidate?.data.blockProjectionNodeId) {
        return {
          opened: false,
          visibleNodeCount: flow.nodes.filter((node) => node.data.blockProjectionOwnerId === id).length,
          effectiveNodeCount: instance.effectiveGraph.nodes.length,
        };
      }
      flow.toggleBlockContainerExpandedV2(id, candidate.data.blockProjectionNodeId);
      return {
        opened: true,
        visibleNodeCount: flow.nodes.filter((node) => node.data.blockProjectionOwnerId === id).length,
        effectiveNodeCount: instance.effectiveGraph.nodes.length,
      };
    }, rootId);
    if (!result.opened) {
      expect(result.visibleNodeCount).toBe(result.effectiveNodeCount);
      return;
    }
    await assertExpandedBlockContainsProjection(page, rootId);
  }
  throw new Error(`Block ${rootId} exceeded the bounded nested-container expansion limit.`);
}

async function waitForWorkspace(page: Page, timeout = 300_000) {
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  const gate = page.getByTestId('startup-workspace-gate');
  const deadline = Date.now() + timeout;
  let lastGateText = '';
  let readySince: number | null = null;
  while (Date.now() < deadline) {
    if ((await gate.count()) === 0) {
      readySince ??= Date.now();
      if (Date.now() - readySince >= 2_000) return;
      await page.waitForTimeout(250);
      continue;
    }
    readySince = null;
    lastGateText = (await gate.textContent({ timeout: 500 }).catch(() => null))?.trim() || lastGateText;
    const retry = gate.getByRole('button', { name: 'Retry' });
    if (await retry.isVisible({ timeout: 250 }).catch(() => false)) await retry.click();
    await page.waitForTimeout(500);
  }
  throw new Error(`Workspace did not load within ${timeout}ms. Last startup message: ${lastGateText}`);
}

async function dismissTaskLauncher(page: Page, waitForAppearance = false) {
  const launcher = page.getByTestId('task-launcher');
  if (waitForAppearance) {
    await launcher.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  }
  // New-workflow hydration can remount the launcher after the first close.
  // Require a short stable absence so a late remount cannot intercept the
  // catalog drag that follows.
  const deadline = Date.now() + 15_000;
  let absentSince: number | null = null;
  while (Date.now() < deadline) {
    if (await launcher.isVisible().catch(() => false)) {
      absentSince = null;
      const close = launcher.getByRole('button', { name: 'Close' });
      if (await close.isVisible().catch(() => false)) await close.click();
      else await launcher.click({ position: { x: 4, y: 4 } });
      await launcher.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
      continue;
    }
    absentSince ??= Date.now();
    if (Date.now() - absentSince >= 1_500) return;
    await page.waitForTimeout(250);
  }
  throw new Error('The task launcher did not remain closed long enough to interact with the empty graph.');
}

async function dismissRecoveredRunFailure(page: Page) {
  // A supervised worker crash is intentionally restored from the durable
  // queue and presented after a clean browser starts. Qualification resumes
  // from a known failure, so acknowledge that historical modal before using
  // the task launcher; failures from the new run remain test-fatal below.
  const dialog = page.getByTestId('run-failure-dialog');
  const deadline = Date.now() + 15_000;
  let absentSince: number | null = null;
  while (Date.now() < deadline) {
    if (await dialog.isVisible({ timeout: 250 }).catch(() => false)) {
      absentSince = null;
      await dialog.getByLabel('Close', { exact: true }).click();
      await expect(dialog).toHaveCount(0);
      continue;
    }
    absentSince ??= Date.now();
    // The durable queue arrives over HTTP and WebSocket during startup. Keep
    // watching long enough to acknowledge a duplicate restoration event.
    if (Date.now() - absentSince >= 5_000) return;
    await page.waitForTimeout(250);
  }
  throw new Error('A recovered historical run-failure dialog kept reopening during startup.');
}

async function chooseAdvancedWorkflow(page: Page, waitForAppearance = false) {
  const launcher = page.getByTestId('task-launcher');
  if (waitForAppearance) {
    await launcher.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  }
  if (await launcher.isVisible().catch(() => false)) {
    await launcher.getByTestId('launcher-mode-advanced_workflow').click();
  }
  await dismissTaskLauncher(page);
}

async function clearFinishedSessionActivity(page: Page) {
  const activity = page.getByRole('region', { name: 'Session activity' });
  if (!(await activity.isVisible().catch(() => false))) return;
  const clear = activity.getByRole('button', { name: 'Clear' });
  if ((await clear.isVisible().catch(() => false)) && (await clear.isEnabled().catch(() => false))) {
    await clear.click();
  }
}

async function ensureExpertMode(page: Page) {
  const auto = page.getByTestId('topbar-auto-switch');
  const deadline = Date.now() + 300_000;
  let lastError = '';
  while (Date.now() < deadline) {
    await waitForWorkspace(page, Math.max(1, deadline - Date.now()));
    await dismissTaskLauncher(page);
    if ((await auto.getAttribute('aria-checked')) === 'false') return;
    try {
      await auto.click({ timeout: 2_000 });
      await expect(auto).toHaveAttribute('aria-checked', 'false', { timeout: 2_000 });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await page.waitForTimeout(500);
    }
  }
  throw new Error(`Could not enter Expert mode after startup recovery: ${lastError}`);
}

async function optionalRuntimeStatus(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/runtime/optional-runtimes');
    if (!response.ok) throw new Error(`Optional runtime status failed with ${response.status}.`);
    return response.json() as Promise<Record<string, unknown>>;
  });
}

async function waitForResponsiveLiveControlPlane(page: Page, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  const observations: Array<{
    at: number;
    healthMs: number | null;
    queueMs: number | null;
    healthStatus: number | null;
    queueStatus: number | null;
    queueIdle: boolean;
    error: string | null;
  }> = [];
  let consecutive = 0;
  while (Date.now() < deadline) {
    const observation = await page.evaluate(async () => {
      const timed = async (path: string) => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 3_000);
        const startedAt = performance.now();
        try {
          const response = await fetch(path, { signal: controller.signal });
          const body = (await response.json()) as Record<string, unknown>;
          return { milliseconds: performance.now() - startedAt, status: response.status, body };
        } finally {
          window.clearTimeout(timer);
        }
      };
      const at = Date.now();
      try {
        const health = await timed('/health');
        const queue = await timed('/queue');
        return {
          at,
          healthMs: health.milliseconds,
          queueMs: queue.milliseconds,
          healthStatus: health.status,
          queueStatus: queue.status,
          queueIdle:
            queue.body.current == null && Object.keys((queue.body.queued as object | undefined) ?? {}).length === 0,
          error: null,
        };
      } catch (error) {
        return {
          at,
          healthMs: null,
          queueMs: null,
          healthStatus: null,
          queueStatus: null,
          queueIdle: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
    observations.push(observation);
    const responsive =
      observation.healthStatus === 200 &&
      observation.queueStatus === 200 &&
      observation.queueIdle &&
      (observation.healthMs ?? Infinity) < 1_000 &&
      (observation.queueMs ?? Infinity) < 1_000;
    consecutive = responsive ? consecutive + 1 : 0;
    if (consecutive >= 3) return observations;
    await page.waitForTimeout(500);
  }
  throw new Error(
    `The backend control plane did not become stably responsive: ${JSON.stringify(observations.slice(-6))}`,
  );
}

async function activateRequiredHuggingFaceRuntimeThroughSetup(page: Page, evidenceRoot: string) {
  const before = await optionalRuntimeStatus(page);
  await writeFile(`${evidenceRoot}/optional-runtime-before.json`, `${JSON.stringify(before, null, 2)}\n`, 'utf8');
  const beforeProfile = (before.profiles as Array<{ id?: string; overlayStatus?: string }> | undefined)?.find(
    ({ id }) => id === QWEN_OPTIONAL_RUNTIME_ID,
  );
  const beforeOverlay = before.overlay as { processLoadStatus?: string } | undefined;
  if (beforeProfile?.overlayStatus === 'active' && beforeOverlay?.processLoadStatus === 'active') {
    await page.evaluate(async () => {
      const { useSettingsStore } = await import('/src/stores/useSettingsStore.ts');
      useSettingsStore.getState().setRightPanelOpen(false);
    });
    return;
  }

  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/stores/useSettingsStore.ts');
    useSettingsStore.getState().setRightPanelOpen(true);
    useSettingsStore.getState().setRightPanelTab('setup');
  });
  const runtimeRow = page.getByTestId(`optional-runtime-${QWEN_OPTIONAL_RUNTIME_ID}`);
  await expect(runtimeRow).toBeVisible({ timeout: 30_000 });
  let activate = runtimeRow.getByRole('button', { name: 'Activate', exact: true });
  if (!(await activate.isVisible())) {
    const repair = runtimeRow.getByRole('button', { name: 'Repair', exact: true });
    if (!(await repair.isVisible())) {
      throw new Error(
        `The pinned Qwen optional runtime is not active and has neither a visible Repair nor Activate action. ` +
          `Status: ${JSON.stringify(beforeProfile)}`,
      );
    }
    await repair.click();
    const repairDialog = page.getByRole('dialog');
    await expect(repairDialog).toContainText(/optional runtime/u);
    const createdResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/runtime/optional-runtimes/install' &&
        response.request().method() === 'POST',
      { timeout: 120_000 },
    );
    await repairDialog.getByRole('button', { name: 'Repair', exact: true }).click();
    const created = await createdResponse;
    if (!created.ok()) throw new Error(`Optional runtime Repair failed (${created.status()}): ${await created.text()}`);
    const createdReceipt = (await created.json()) as {
      job?: { id?: string; status?: string; error?: string; progress?: { message?: string } };
    };
    await writeFile(
      `${evidenceRoot}/optional-runtime-job-created.json`,
      `${JSON.stringify(createdReceipt, null, 2)}\n`,
      'utf8',
    );
    const jobId = createdReceipt.job?.id;
    if (!jobId) throw new Error('The visible runtime Repair action returned no job ID.');
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const response = await fetch(`/runtime/optional-runtimes/jobs/${encodeURIComponent(id)}`);
            if (!response.ok) return `poll_error:${response.status}`;
            const body = (await response.json()) as { job?: { status?: string; error?: string } };
            if (body.job?.status === 'failed') throw new Error(body.job.error ?? 'Optional runtime Repair failed.');
            return body.job?.status ?? 'missing';
          }, jobId),
        { timeout: 30 * 60 * 1000, intervals: [1000, 2000, 5000] },
      )
      .toBe('ready');
    const finalJob = await page.evaluate(async (id) => {
      const response = await fetch(`/runtime/optional-runtimes/jobs/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error(`Optional runtime final job receipt failed with ${response.status}.`);
      return response.json() as Promise<Record<string, unknown>>;
    }, jobId);
    await writeFile(
      `${evidenceRoot}/optional-runtime-job-final.json`,
      `${JSON.stringify(finalJob, null, 2)}\n`,
      'utf8',
    );
    // Runtime recovery temporarily rejects workflow hydration, which can
    // legitimately remount the empty-workflow launcher over Setup. Restore the
    // visible Setup surface before locating the newly staged Activate action.
    await dismissTaskLauncher(page);
    await page.evaluate(async () => {
      const [{ useNodesStore }, { useSettingsStore }] = await Promise.all([
        import('/src/stores/useNodeStore.ts'),
        import('/src/stores/useSettingsStore.ts'),
      ]);
      useSettingsStore.getState().setRightPanelOpen(true);
      useSettingsStore.getState().setRightPanelTab('setup');
      await useNodesStore.getState().fetchOptionalRuntimes();
    });
    await dismissTaskLauncher(page);
    activate = runtimeRow.getByRole('button', { name: 'Activate', exact: true });
    await expect(activate).toBeVisible({ timeout: 30_000 });
  }
  await activate.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/Activate validated/u);
  await dialog.getByRole('button', { name: 'Activate', exact: true }).click();
  console.log(`[qwen-v2-live] activated ${QWEN_OPTIONAL_RUNTIME_ID} through Setup; waiting for worker restart`);

  await expect
    .poll(
      async () => {
        try {
          const status = await optionalRuntimeStatus(page);
          const profile = (status.profiles as Array<{ id?: string; overlayStatus?: string }> | undefined)?.find(
            ({ id }) => id === QWEN_OPTIONAL_RUNTIME_ID,
          );
          const overlay = status.overlay as { processLoadStatus?: string } | undefined;
          return `${overlay?.processLoadStatus ?? 'unknown'}:${profile?.overlayStatus ?? 'unknown'}`;
        } catch {
          return 'restarting:restarting';
        }
      },
      { timeout: 5 * 60 * 1000, intervals: [1000, 2000, 5000] },
    )
    .toBe('active:active');
  await expect
    .poll(() => page.evaluate(() => window.__MODIFF_E2E__?.getState().websocket.isConnected ?? false), {
      timeout: 120_000,
    })
    .toBe(true);
  const after = await optionalRuntimeStatus(page);
  await writeFile(`${evidenceRoot}/optional-runtime-after.json`, `${JSON.stringify(after, null, 2)}\n`, 'utf8');
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/stores/useSettingsStore.ts');
    useSettingsStore.getState().setRightPanelOpen(false);
  });
}

async function blockSnapshot(page: Page, instanceId: string): Promise<BlockSnapshot> {
  return page.evaluate(async (rootId) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const { blockInstanceValueV2 } = await import('/src/studio/blockSchemaV2.ts');
    const flow = useFlowStore.getState();
    const root = flow.nodes.find((node) => node.id === rootId);
    const instance = root?.data.blockInstanceV2;
    if (!root || !instance) throw new Error(`Block V2 root ${rootId} is unavailable.`);
    return {
      instanceId: instance.instanceId,
      instanceJson: JSON.stringify(instance),
      definitionId: instance.definitionSnapshot.definitionId,
      manifestDefinitionId: instance.definitionSnapshot.source.manifestDefinitionId ?? null,
      sourceKind: instance.definitionSnapshot.source.kind,
      sourceParent: instance.definitionSnapshot.source.parent ? { ...instance.definitionSnapshot.source.parent } : null,
      repository: instance.definitionSnapshot.source.repository ?? null,
      repositoryRevision: instance.definitionSnapshot.source.repositoryRevision ?? null,
      values: JSON.parse(JSON.stringify(instance.values)) as Record<string, unknown>,
      resolvedValues: JSON.parse(
        JSON.stringify({
          ...Object.fromEntries(
            instance.effectiveInterface.controls.map((control) => [
              control.controlId,
              blockInstanceValueV2(instance, control.controlId),
            ]),
          ),
          ...instance.values,
        }),
      ) as Record<string, unknown>,
      definitionDefaults: JSON.parse(
        JSON.stringify(
          Object.fromEntries(
            instance.definitionSnapshot.controls.map((control) => [control.controlId, control.defaultValue]),
          ),
        ),
      ) as Record<string, unknown>,
      boundaryInputs: instance.effectiveInterface.boundary.inputs.map(({ portId, valueType }) => ({
        portId,
        valueType,
      })),
      boundaryOutputs: instance.effectiveInterface.boundary.outputs.map(({ portId, valueType }) => ({
        portId,
        valueType,
      })),
      rootPosition: { ...instance.presentation.position },
      rootSize: { ...instance.presentation.size },
      internalLayout: JSON.parse(JSON.stringify(instance.presentation.internalLayout)) as Record<
        string,
        { x: number; y: number }
      >,
      projectionNodes: flow.nodes
        .filter((node) => node.data.blockProjectionOwnerId === rootId)
        .map((node) => ({
          id: node.id,
          semanticNodeId: node.data.blockProjectionNodeId ?? '',
          position: { ...node.position },
        }))
        .sort((left, right) => left.semanticNodeId.localeCompare(right.semanticNodeId)),
      projectionEdges: flow.edges
        .filter((edge) => edge.data?.blockProjectionOwnerId === rootId)
        .map((edge) => ({
          id: edge.id,
          semanticEdgeId: edge.data?.blockProjectionEdgeId ?? '',
          source: edge.source,
          target: edge.target,
        }))
        .sort((left, right) => left.semanticEdgeId.localeCompare(right.semanticEdgeId)),
      projectionEdgeCount: flow.edges.filter((edge) => edge.data?.blockProjectionOwnerId === rootId).length,
    };
  }, instanceId);
}

async function exportFromBlock(page: Page, instanceId: string): Promise<ExecutionExport> {
  return page.evaluate(async (rootId) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const graph = useFlowStore.getState().exportGraph('qwen-v2-live-contract', rootId);
    return {
      nodes: graph.nodes,
      paths: graph.paths,
      deterministicMode: graph.deterministicMode,
    } as ExecutionExport;
  }, instanceId);
}

async function fillAndCommit(field: Locator, value: string) {
  await field.fill(value);
  await field.blur();
  await expect(field).toHaveValue(value);
}

async function fillBlockValueAndAssert(
  page: Page,
  rootId: string,
  field: Locator,
  logicalId: string,
  displayedValue: string,
  storedValue: unknown,
) {
  await field.fill(displayedValue);
  // A real focus transition exercises the same commit boundary as a user
  // tabbing to the next control. Do not accept a textarea's local draft as
  // proof that the durable BlockInstanceV2 value changed.
  await field.press('Tab');
  await expect
    .poll(async () => (await blockSnapshot(page, rootId)).values[logicalId], {
      timeout: 5_000,
      intervals: [50, 100, 250],
    })
    .toEqual(storedValue);
  await expect(field).toHaveValue(displayedValue);
}

async function waitForTask(page: Page, taskId: string, timeout = 20 * 60 * 1000) {
  const deadline = Date.now() + timeout;
  let lastTask: { task_id?: string; status?: string; message?: string; error?: string } | null = null;
  while (Date.now() < deadline) {
    const response = await page.request.get(`${LIVE_BACKEND_URL}/queue`);
    if (response.ok()) {
      const queue = (await response.json()) as {
        current?: { task_id?: string; status?: string; message?: string; error?: string } | null;
        queued?: Record<string, { task_id?: string; status?: string; message?: string; error?: string }>;
        recent?: Array<{ task_id?: string; status?: string; message?: string; error?: string }>;
      };
      lastTask =
        (queue.current?.task_id === taskId ? queue.current : null) ??
        Object.values(queue.queued ?? {}).find((task) => task.task_id === taskId) ??
        queue.recent?.find((task) => task.task_id === taskId) ??
        null;
    }
    if (lastTask?.status === 'completed') return lastTask;
    if (lastTask && ['failed', 'cancelled', 'canceled', 'interrupted'].includes(lastTask.status ?? '')) {
      throw new Error(
        `V2 task ${taskId} became ${lastTask.status}: ${lastTask.error ?? lastTask.message ?? 'No backend failure message.'}`,
      );
    }
    await page.waitForTimeout(2_000);
  }
  throw new Error(`V2 task ${taskId} timed out. Last queue record: ${JSON.stringify(lastTask)}`);
}

type LiveStudioOutput = {
  taskId?: string;
  displayType?: string;
  mediaHash?: string;
  url?: string;
  metadata?: Record<string, unknown>;
  backendProvenance?: Record<string, unknown>;
  mediaItems?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

async function findLiveStudioOutput(page: Page, taskId: string, displayType = 'image') {
  // Query the backend's exact run identity instead of repeatedly transferring
  // the whole Studio history through the Vite UI proxy. The run endpoint uses
  // the task/client-run provenance pair and cannot confuse another preview.
  const response = await page.request.get(`${LIVE_BACKEND_URL}/runs/${encodeURIComponent(taskId)}`);
  if (!response.ok()) return null;
  const body = (await response.json()) as { outputs?: LiveStudioOutput[] };
  return body.outputs?.find((item) => item.taskId === taskId && item.displayType === displayType) ?? null;
}

async function findDurableCompletionReceipt(
  page: Page,
  taskId: string,
  websocketEvents: Array<Record<string, unknown>>,
) {
  const websocketReceipt = websocketEvents.find(
    (event) => event.type === 'graph_completed' && event.task_id === taskId,
  );
  if (websocketReceipt) return websocketReceipt;

  // A save/refresh lifecycle intentionally reconnects the browser websocket.
  // The completion frame can race that reconnect, so qualification must be
  // recoverable from the backend's task-bound durable run record rather than
  // treating successful model execution as failed because one ephemeral frame
  // was missed.
  const response = await page.request.get(`${LIVE_BACKEND_URL}/runs/${encodeURIComponent(taskId)}`);
  if (!response.ok()) return null;
  const body = (await response.json()) as {
    task?: {
      task_id?: string;
      status?: string;
      runtimeFingerprint?: unknown;
      runtimeMeasurement?: unknown;
      deterministicMode?: unknown;
    };
  };
  const task = body.task;
  if (task?.task_id !== taskId || task.status !== 'completed' || !task.runtimeFingerprint || !task.runtimeMeasurement) {
    return null;
  }
  return {
    type: 'graph_completed',
    task_id: taskId,
    runtimeFingerprint: task.runtimeFingerprint,
    runtimeMeasurement: task.runtimeMeasurement,
    deterministicMode: task.deterministicMode,
    recoveredFrom: 'durable_run_record',
  } satisfies Record<string, unknown>;
}

async function analyzeImageOutput(page: Page, output: LiveStudioOutput) {
  expect(output.url).toBeTruthy();
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not read the generated image (${response.status}).`);
    const blob = await response.blob();
    const encodedDigest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create a 2D context for output verification.');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const decodedDigest = await crypto.subtle.digest('SHA-256', pixels);
    const hexadecimal = (digest: ArrayBuffer) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return {
      ok: bitmap.width > 0 && bitmap.height > 0 && blob.size > 0,
      outputCount: 1,
      analyses: [
        {
          mediaType: 'image',
          byteSize: blob.size,
          width: bitmap.width,
          height: bitmap.height,
          encodedSha256: `sha256:encoded:${hexadecimal(encodedDigest)}`,
          decodedSha256: `sha256:decoded-rgba:${hexadecimal(decodedDigest)}`,
        },
      ],
    };
  }, output.url!);
}

async function recoverCompletedQwenProof(
  page: Page,
  evidenceRoot: string,
  taskId: string,
  expected: {
    prompt: string;
    negativePrompt: string;
    width: number;
    height: number;
    steps: number;
    seed: number;
    seedStored: { isRandom: boolean; value: string };
  },
) {
  let historyWrites = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET') return;
    if (new URL(request.url()).pathname === '/studio_outputs') historyWrites += 1;
  });
  const queueResponse = await page.request.get(`${LIVE_BACKEND_URL}/queue`);
  expect(queueResponse.ok()).toBe(true);
  const queue = (await queueResponse.json()) as {
    current?: { task_id?: string; status?: string } | null;
    queued?: Record<string, { task_id?: string; status?: string }>;
    recent?: Array<{ task_id?: string; status?: string }>;
  };
  const task =
    (queue.current?.task_id === taskId ? queue.current : null) ??
    Object.values(queue.queued ?? {}).find((candidate) => candidate.task_id === taskId) ??
    queue.recent?.find((candidate) => candidate.task_id === taskId) ??
    null;
  expect(task).toMatchObject({ task_id: taskId, status: 'completed' });

  const outputsResponse = await page.request.get(`${LIVE_BACKEND_URL}/runs/${encodeURIComponent(taskId)}`);
  expect(outputsResponse.ok()).toBe(true);
  const outputs = (await outputsResponse.json()) as {
    workflow_snapshot?: {
      nodes?: Array<{ id?: string; type?: string }>;
    };
    outputs?: Array<{
      id?: string;
      taskId?: string;
      displayType?: string;
      mediaHash?: string;
      url?: string;
      graphSnapshot?: {
        nodes?: Array<{
          id?: string;
          type?: string;
          data?: {
            blockInstanceV2?: {
              definitionRef?: { definitionId?: string };
              definitionSnapshot?: {
                source?: { repository?: string; repositoryRevision?: string };
              };
              values?: Record<string, unknown>;
              presentation?: { internalLayout?: Record<string, unknown> };
            };
          };
        }>;
      };
    }>;
  };
  const output = outputs.outputs?.find((candidate) => candidate.taskId === taskId && candidate.displayType === 'image');
  expect(output?.url).toBeTruthy();
  const roots = output?.graphSnapshot?.nodes?.filter((node) => node.type === 'block') ?? [];
  expect(roots).toHaveLength(2);
  const edited = roots.find((node) => node.data?.blockInstanceV2?.values?.prompt === expected.prompt);
  const sibling = roots.find((node) => node.data?.blockInstanceV2?.values?.prompt === CREATOR_PROMPT);
  expect(edited?.data?.blockInstanceV2).toMatchObject({
    definitionRef: { definitionId: QWEN_DEFINITION_ID },
    definitionSnapshot: { source: { repository: QWEN_REPOSITORY, repositoryRevision: QWEN_REVISION } },
    values: {
      prompt: expected.prompt,
      negative_prompt: expected.negativePrompt,
      width: String(expected.width),
      height: String(expected.height),
      num_inference_steps: String(expected.steps),
      seed: expected.seedStored,
    },
  });
  expect(sibling?.data?.blockInstanceV2).toBeTruthy();

  // The stored backend record intentionally remains immutable. Verify the
  // client now repairs its stale/default Studio labels from the exact V2 root
  // selected by the deterministic preview projection node ID.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const normalizedProvenance = await page.evaluate(async (rawOutput) => {
    const { coerceStudioOutput } = await import('/src/studio/outputContracts.ts');
    const normalized = coerceStudioOutput(rawOutput);
    if (!normalized) throw new Error('The recovered Qwen output did not normalize.');
    return {
      modelType: normalized.modelType,
      mode: normalized.mode,
      modelLabel: normalized.modelLabel,
      repo: normalized.repo,
      prompt: normalized.prompt,
      negativePrompt: normalized.negativePrompt,
      width: normalized.width,
      height: normalized.height,
      steps: normalized.steps,
      guidanceScale: normalized.guidanceScale,
      seed: normalized.seed,
      formSnapshot: normalized.formSnapshot,
    };
  }, output);
  expect(normalizedProvenance).toMatchObject({
    modelType: 'QwenImageModularPipeline',
    mode: 'modular_text_to_image',
    repo: QWEN_REPOSITORY,
    prompt: expected.prompt,
    negativePrompt: expected.negativePrompt,
    width: expected.width,
    height: expected.height,
    steps: expected.steps,
    guidanceScale: 4,
    seed: expected.seed,
    formSnapshot: {
      modelType: 'QwenImageModularPipeline',
      mode: 'modular_text_to_image',
      prompt: expected.prompt,
      width: expected.width,
      height: expected.height,
      steps: expected.steps,
    },
  });
  expect(historyWrites).toBe(0);

  const beforeRefresh = JSON.parse(await readFile(`${evidenceRoot}/before-refresh.json`, 'utf8')) as {
    executionExport?: { nodes?: Record<string, unknown> };
  };
  const durableWorkflowRootIds =
    outputs.workflow_snapshot?.nodes?.filter(({ type }) => type === 'block').map(({ id }) => id) ?? [];
  expect(durableWorkflowRootIds).toEqual(expect.arrayContaining([edited?.id, sibling?.id]));
  expect(Object.keys(beforeRefresh.executionExport?.nodes ?? {})).toHaveLength(EXACT_QWEN_TEXT_TO_IMAGE_NODE_COUNT);

  const assetResponse = await page.request.get(new URL(output!.url!, LIVE_BACKEND_URL).toString());
  expect(assetResponse.ok()).toBe(true);
  const outputAnalysis = await analyzeImageOutput(page, output!);
  expect(outputAnalysis).toMatchObject({
    ok: true,
    outputCount: 1,
    analyses: [{ mediaType: 'image', width: expected.width, height: expected.height }],
  });
  await writeFile(`${evidenceRoot}/qwen-block-v2-live.webp`, await assetResponse.body());
  await writeFile(
    `${evidenceRoot}/frontend-result.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        recoveredExistingCompletedTask: true,
        model: { repository: QWEN_REPOSITORY, revision: QWEN_REVISION },
        definitionId: QWEN_DEFINITION_ID,
        task,
        output,
        outputAnalysis,
        normalizedProvenance,
        outputFilename: 'qwen-block-v2-live.webp',
        workflow: {
          firstInstanceId: edited?.id,
          siblingInstanceId: sibling?.id,
          siblingIsolationPresent: true,
          internalLayoutPersisted: edited?.data?.blockInstanceV2?.presentation?.internalLayout?.models,
          collapsedExpandedExecutionEquivalent: true,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

test('exact Qwen schema-v6 catalog drag is one durable V2 Block and runs its edited instance', async ({ page }) => {
  test.skip(
    process.env.MODIFF_RUN_QWEN_V2_CONTRACT !== '1',
    'Select the installed Qwen Block V2 contract explicitly with MODIFF_RUN_QWEN_V2_CONTRACT=1.',
  );
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!outputDirectory, 'MODIFF_REVIEW_OUTPUT_DIR is required so the live proof is preserved for review.');
  test.setTimeout(30 * 60 * 1000);
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 1920, height: 1080 });

  const showcaseRequested = process.env.MODIFF_QWEN_V2_SHOWCASE === '1';
  const proofPrompt = showcaseRequested ? SHOWCASE_PROMPT : EDITED_PROMPT;
  const proofNegativePrompt = showcaseRequested ? SHOWCASE_NEGATIVE_PROMPT : CREATOR_NEGATIVE_PROMPT;
  const proofWidth = showcaseRequested ? 1664 : 256;
  const proofHeight = showcaseRequested ? 928 : 256;
  const proofSteps = showcaseRequested ? 50 : 2;
  // Exercise a real edit: filling the creator's unchanged seed (42) correctly
  // leaves its numeric representation untouched and does not emit a change.
  const proofSeed = showcaseRequested ? 314159 : 424242;
  const proofSeedStored = { isRandom: false, value: String(proofSeed) };

  const evidenceRoot = `${outputDirectory}/qwen-image-2512-block-v2-live`;
  await mkdir(evidenceRoot, { recursive: true });
  const existingTaskId = process.env.MODIFF_QWEN_V2_EXISTING_TASK_ID;
  if (existingTaskId) {
    await recoverCompletedQwenProof(page, evidenceRoot, existingTaskId, {
      prompt: proofPrompt,
      negativePrompt: proofNegativePrompt,
      width: proofWidth,
      height: proofHeight,
      steps: proofSteps,
      seed: proofSeed,
      seedStored: proofSeedStored,
    });
    return;
  }
  const backendRoot = resolve(process.env.MODIFF_BACKEND_DIR || process.cwd(), '..', 'MoDiff');
  const backendSourceBefore = backendSourceIdentity(backendRoot);
  const pageErrors: string[] = [];
  const reactFlowHandleWarnings: string[] = [];
  const fieldActionRequests: Array<{ node?: string; fn?: string }> = [];
  const websocketEvents: Array<Record<string, unknown>> = [];
  let userNodeWriteRequests = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (text.includes("[React Flow]: Couldn't create edge for")) reactFlowHandleWarnings.push(text);
  });
  page.on('request', (request) => {
    if (request.method() === 'GET') return;
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/studio/blocks' || pathname.startsWith('/studio/blocks/')) userNodeWriteRequests += 1;
    if (pathname === '/fields/action') {
      fieldActionRequests.push((request.postDataJSON() ?? {}) as { node?: string; fn?: string });
    }
  });
  page.on('websocket', (websocket) => {
    websocket.on('framereceived', ({ payload }) => {
      try {
        websocketEvents.push(JSON.parse(String(payload)) as Record<string, unknown>);
      } catch {
        // Binary progress frames are not execution receipts.
      }
    });
  });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('qwen-v2-live-contract')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('qwen-v2-live-contract', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  await ensureExpertMode(page);
  await activateRequiredHuggingFaceRuntimeThroughSetup(page, evidenceRoot);
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  await ensureExpertMode(page);
  console.log('[qwen-v2-live] workspace ready in Expert mode');

  await page.evaluate(async () => {
    const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
    ]);
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useNodesStore.getState().refreshModelIndexes(false),
      useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
    ]);
  });
  // The startup recovery overlay may remount while these three backend-backed
  // stores refresh. Do not interact through it or treat its launcher as the
  // node library.
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  // Create the proof canvas only after initial backend/catalog hydration has
  // settled, otherwise a late initial workflow response can replace the new
  // graph after its first Block is dropped.
  await page.getByTestId('topbar-new-workflow').click();
  await waitForWorkspace(page);
  await chooseAdvancedWorkflow(page, true);
  await clearFinishedSessionActivity(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.waitForTimeout(3_000);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 60_000 });
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
    await group.getByRole('button').first().click();
  }
  await page.getByLabel('Search nodes').fill('Qwen Image — Text To Image');
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
  await expect(row).toHaveAttribute('draggable', 'true');

  const pane = page.locator('.react-flow__pane');
  await row.dragTo(pane, { targetPosition: { x: 800, y: 180 }, timeout: 30_000 });
  const roots = page
    .locator('.react-flow__node-block')
    .filter({ has: page.locator('[data-block-schema-version="2"]') });
  const firstInsertionResult = await Promise.race([
    roots
      .first()
      .waitFor({ state: 'attached', timeout: 30_000 })
      .then(() => 'inserted' as const),
    page
      .getByText(/The reviewed catalog graph did not finalize to its pinned BlockDefinitionV2/u)
      .last()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => 'rejected' as const),
  ]);
  if (firstInsertionResult === 'rejected') {
    throw new Error(
      (await page
        .getByText(/The reviewed catalog graph did not finalize to its pinned BlockDefinitionV2/u)
        .last()
        .textContent()) ?? 'The live Qwen compiler rejected its registered definition pin.',
    );
  }
  await expect(roots).toHaveCount(1, { timeout: 180_000 });
  const siblingId = await roots.first().getAttribute('data-id');
  await row.dragTo(pane, { targetPosition: { x: 250, y: 180 }, timeout: 30_000 });
  await expect(roots).toHaveCount(2, { timeout: 180_000 });
  console.log('[qwen-v2-live] inserted two exact registered V2 roots');
  await expect(page.locator('[data-cluster-role]')).toHaveCount(0);

  // Edit the newly inserted, left-side root. Capture identity from the
  // insertion delta because React Flow may reorder its DOM by selection/z-index.
  const rootIds = await roots.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-id')));
  const firstId = rootIds.find((id) => id && id !== siblingId) ?? null;
  const secondId = siblingId;
  expect(firstId).toBeTruthy();
  expect(secondId).toBeTruthy();
  expect(firstId).not.toBe(secondId);
  // Selection changes React Flow's DOM/z ordering, so bind every later action
  // to the durable root ID instead of keeping a dynamic nth() locator.
  const firstRoot = page.locator(`.react-flow__node-block[data-id="${firstId}"]`);
  const secondRoot = page.locator(`.react-flow__node-block[data-id="${secondId}"]`);

  for (const [root, rootId] of [
    [firstRoot, firstId!],
    [secondRoot, secondId!],
  ] as const) {
    await expect(root.getByTestId(`user-block-${rootId}`)).toHaveAttribute('data-block-schema-version', '2');
    await expect(root.getByTestId(`user-block-${rootId}`)).toHaveAttribute('data-block-source', 'diffusers_catalog');
    await expect(root.getByLabel('prompt', { exact: true })).toHaveValue(CREATOR_PROMPT);
    await expect(root.getByLabel('negative prompt', { exact: true })).toHaveValue(CREATOR_NEGATIVE_PROMPT);
    await expect(root.getByLabel('width', { exact: true })).toHaveValue('1328');
    await expect(root.getByLabel('height', { exact: true })).toHaveValue('1328');
    await expect(root.getByLabel('num inference steps', { exact: true })).toHaveValue('50');
    await expect(root.getByTestId(`node-handle-${rootId}-prompt`)).toBeVisible();
    await expect(root.getByTestId(`node-handle-${rootId}-images`)).toBeVisible();
  }

  const firstBeforeEdit = await blockSnapshot(page, firstId!);
  const siblingBeforeEdit = await blockSnapshot(page, secondId!);
  expect(firstBeforeEdit).toMatchObject({
    definitionId: QWEN_DEFINITION_ID,
    manifestDefinitionId: QWEN_MANIFEST_DEFINITION_ID,
    sourceKind: 'diffusers_catalog',
    repository: QWEN_REPOSITORY,
    repositoryRevision: QWEN_REVISION,
    boundaryInputs: [
      { portId: 'prompt', valueType: 'string' },
      { portId: 'negative_prompt', valueType: 'string' },
      { portId: 'max_sequence_length', valueType: 'int' },
      { portId: 'height', valueType: 'int' },
      { portId: 'width', valueType: 'int' },
      { portId: 'num_inference_steps', valueType: 'int' },
    ],
    boundaryOutputs: [{ portId: 'images', valueType: 'image' }],
    projectionNodes: [],
    projectionEdgeCount: 0,
  });
  expect(siblingBeforeEdit.definitionId).toBe(QWEN_DEFINITION_ID);

  await fillBlockValueAndAssert(
    page,
    firstId!,
    firstRoot.getByLabel('prompt', { exact: true }),
    'prompt',
    proofPrompt,
    proofPrompt,
  );
  const promptOnlyEdit = await blockSnapshot(page, firstId!);
  const beforePromptInstance = JSON.parse(firstBeforeEdit.instanceJson) as Record<string, unknown>;
  const afterPromptInstance = JSON.parse(promptOnlyEdit.instanceJson) as Record<string, unknown>;
  expect(afterPromptInstance.definitionRef).toEqual(beforePromptInstance.definitionRef);
  expect(afterPromptInstance.definitionSnapshot).toEqual(beforePromptInstance.definitionSnapshot);
  expect(afterPromptInstance.effectiveGraph).toEqual(beforePromptInstance.effectiveGraph);
  expect(afterPromptInstance.effectiveInterface).toEqual(beforePromptInstance.effectiveInterface);
  expect(afterPromptInstance.presentation).toEqual(beforePromptInstance.presentation);
  expect(afterPromptInstance.previewStates).toEqual(beforePromptInstance.previewStates);
  expect(afterPromptInstance.values).toEqual({
    ...(beforePromptInstance.values as Record<string, unknown>),
    prompt: proofPrompt,
  });
  expect(afterPromptInstance.customization).toEqual({
    ...(beforePromptInstance.customization as Record<string, unknown>),
    state: 'parameters_changed',
  });
  expect((await blockSnapshot(page, secondId!)).instanceJson).toBe(siblingBeforeEdit.instanceJson);
  if (showcaseRequested) {
    await fillBlockValueAndAssert(
      page,
      firstId!,
      firstRoot.getByLabel('negative prompt', { exact: true }),
      'negative_prompt',
      proofNegativePrompt,
      proofNegativePrompt,
    );
  }
  await fillBlockValueAndAssert(
    page,
    firstId!,
    firstRoot.getByLabel('width', { exact: true }),
    'width',
    String(proofWidth),
    String(proofWidth),
  );
  await fillBlockValueAndAssert(
    page,
    firstId!,
    firstRoot.getByLabel('height', { exact: true }),
    'height',
    String(proofHeight),
    String(proofHeight),
  );
  await fillBlockValueAndAssert(
    page,
    firstId!,
    firstRoot.getByLabel('num inference steps', { exact: true }),
    'num_inference_steps',
    String(proofSteps),
    String(proofSteps),
  );
  await fillBlockValueAndAssert(
    page,
    firstId!,
    firstRoot.getByLabel('Seed', { exact: true }),
    'seed',
    String(proofSeed),
    proofSeedStored,
  );
  console.log('[qwen-v2-live] edited the declared prompt, width, height, and step controls');

  const firstAfterEdit = await blockSnapshot(page, firstId!);
  expect(firstAfterEdit.values).toMatchObject({
    prompt: proofPrompt,
    width: String(proofWidth),
    height: String(proofHeight),
    num_inference_steps: String(proofSteps),
    seed: proofSeedStored,
    ...(showcaseRequested ? { negative_prompt: proofNegativePrompt } : {}),
  });
  expect((await blockSnapshot(page, secondId!)).instanceJson).toBe(siblingBeforeEdit.instanceJson);

  const collapsedExport = await exportFromBlock(page, firstId!);
  expect(Object.keys(collapsedExport.nodes).length).toBe(EXACT_QWEN_TEXT_TO_IMAGE_NODE_COUNT);
  expect(Object.keys(collapsedExport.nodes)).not.toContain(firstId);
  expect(JSON.stringify(collapsedExport.nodes)).not.toContain('blockInstanceV2');
  expect(JSON.stringify(collapsedExport.nodes)).not.toContain('huggingFaceCluster');
  const collapsedCanvasSize = await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const root = useFlowStore.getState().nodes.find((node) => node.id === id);
    return { width: root?.width, height: root?.height };
  }, firstId!);

  const fieldActionCountBeforeExpansion = fieldActionRequests.length;
  await firstRoot.getByTestId(`user-block-toggle-${firstId}`).click();
  await expect(firstRoot.getByTestId(`user-block-toggle-${firstId}`)).toHaveAccessibleName('Collapse block');
  await expect.poll(async () => (await blockSnapshot(page, firstId!)).projectionNodes.length).toBeGreaterThan(0);
  await expandEveryNestedBlockContainer(page, firstId!);
  await expect
    .poll(async () => {
      const snapshot = await blockSnapshot(page, firstId!);
      return { nodes: snapshot.projectionNodes.length, edges: snapshot.projectionEdgeCount };
    })
    .toEqual({ nodes: EXACT_QWEN_TEXT_TO_IMAGE_PROJECTION_NODE_COUNT, edges: EXACT_QWEN_TEXT_TO_IMAGE_EDGE_COUNT });
  await page.waitForTimeout(250);
  await assertExpandedBlockContainsProjection(page, firstId!);
  expect(fieldActionRequests.slice(fieldActionCountBeforeExpansion)).toEqual([]);
  expect(await exportFromBlock(page, firstId!)).toEqual(collapsedExport);

  const expandedBeforeMove = await blockSnapshot(page, firstId!);
  const modelsProjection = expandedBeforeMove.projectionNodes.find(({ semanticNodeId }) => semanticNodeId === 'models');
  expect(modelsProjection).toBeTruthy();
  const modelsNode = page.locator(`.react-flow__node[data-id="${modelsProjection!.id}"]`);
  const dragBounds = await modelsNode.locator('header').first().boundingBox();
  expect(dragBounds).toBeTruthy();
  await page.mouse.move(dragBounds!.x + dragBounds!.width / 2, dragBounds!.y + dragBounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragBounds!.x + dragBounds!.width / 2 + 56, dragBounds!.y + dragBounds!.height / 2 + 36, {
    steps: 6,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await blockSnapshot(page, firstId!)).internalLayout.models)
    .not.toEqual(expandedBeforeMove.internalLayout.models);
  const movedModelsLayout = (await blockSnapshot(page, firstId!)).internalLayout.models;
  await assertExpandedBlockContainsProjection(page, firstId!);
  await page.screenshot({
    path: `${evidenceRoot}/frontend-expanded-contained-after-move.png`,
    fullPage: false,
  });
  expect(await exportFromBlock(page, firstId!)).toEqual(collapsedExport);

  await firstRoot.getByTestId(`user-block-toggle-${firstId}`).click();
  await expect(firstRoot.getByTestId(`user-block-toggle-${firstId}`)).toHaveAccessibleName('Expand block');
  await expect.poll(async () => (await blockSnapshot(page, firstId!)).projectionNodes.length).toBe(0);
  expect(
    await page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const root = useFlowStore.getState().nodes.find((node) => node.id === id);
      return { width: root?.width, height: root?.height };
    }, firstId!),
  ).toEqual(collapsedCanvasSize);

  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill(`Qwen Block V2 Live ${Date.now()}`);
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await expect
    .poll(() =>
      page.evaluate(() => {
        const studio = window.__MODIFF_E2E__!.getState().studio;
        return studio.workflowTabs.find((tab: { id: string }) => tab.id === studio.activeWorkflowTabId)?.dirty;
      }),
    )
    .toBe(false);
  console.log('[qwen-v2-live] edited instance and sibling persisted');

  await writeFile(
    `${evidenceRoot}/before-refresh.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        first: firstAfterEdit,
        sibling: siblingBeforeEdit,
        collapsedExpandedExecutionEquivalent: true,
        executionExport: collapsedExport,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await chooseAdvancedWorkflow(page);
  await ensureExpertMode(page);
  await clearFinishedSessionActivity(page);
  const restoredFirst = page.locator(`.react-flow__node-block[data-id="${firstId}"]`);
  const restoredSecond = page.locator(`.react-flow__node-block[data-id="${secondId}"]`);
  await expect(restoredFirst).toHaveCount(1);
  await expect(restoredSecond).toHaveCount(1);
  await expect(restoredFirst.getByTestId(`user-block-${firstId}`)).toHaveAttribute('data-block-schema-version', '2');
  await expect(restoredFirst.getByTestId(`node-handle-${firstId}-prompt`)).toBeVisible();
  await expect(restoredFirst.getByTestId(`node-handle-${firstId}-images`)).toBeVisible();
  await expect(restoredFirst.getByLabel('prompt', { exact: true })).toHaveValue(proofPrompt);
  await expect(restoredFirst.getByLabel('width', { exact: true })).toHaveValue(String(proofWidth));
  await expect(restoredFirst.getByLabel('height', { exact: true })).toHaveValue(String(proofHeight));
  await expect(restoredFirst.getByLabel('num inference steps', { exact: true })).toHaveValue(String(proofSteps));
  await expect(restoredFirst.getByLabel('Seed', { exact: true })).toHaveValue(String(proofSeed));
  await expect(page.locator('[data-cluster-role]')).toHaveCount(0);

  const restoredFirstSnapshot = await blockSnapshot(page, firstId!);
  const restoredSiblingSnapshot = await blockSnapshot(page, secondId!);
  expect(restoredFirstSnapshot.values).toEqual(firstAfterEdit.values);
  expect(restoredFirstSnapshot.rootPosition).toEqual(firstAfterEdit.rootPosition);
  expect(restoredFirstSnapshot.rootSize).toEqual(firstAfterEdit.rootSize);
  expect(restoredFirstSnapshot.internalLayout.models).toEqual(movedModelsLayout);
  expect(restoredSiblingSnapshot.instanceJson).toBe(siblingBeforeEdit.instanceJson);
  expect(await exportFromBlock(page, firstId!)).toEqual(collapsedExport);

  const fieldActionCountBeforeRematerialization = fieldActionRequests.length;
  await restoredFirst.getByTestId(`user-block-toggle-${firstId}`).click();
  await expect.poll(async () => (await blockSnapshot(page, firstId!)).projectionNodes.length).toBeGreaterThan(0);
  await expandEveryNestedBlockContainer(page, firstId!);
  await page.waitForTimeout(750);
  const postRefreshProjection = await blockSnapshot(page, firstId!);
  console.log(
    `[qwen-v2-live] post-refresh projection ${JSON.stringify({
      nodes: postRefreshProjection.projectionNodes,
      edges: postRefreshProjection.projectionEdges,
    })}`,
  );
  await expect
    .poll(async () => {
      const snapshot = await blockSnapshot(page, firstId!);
      return { nodes: snapshot.projectionNodes.length, edges: snapshot.projectionEdgeCount };
    })
    .toEqual({ nodes: EXACT_QWEN_TEXT_TO_IMAGE_PROJECTION_NODE_COUNT, edges: EXACT_QWEN_TEXT_TO_IMAGE_EDGE_COUNT });
  expect(fieldActionRequests.slice(fieldActionCountBeforeRematerialization)).toEqual([]);
  expect((await blockSnapshot(page, firstId!)).internalLayout.models).toEqual(movedModelsLayout);
  await assertExpandedBlockContainsProjection(page, firstId!);
  await page.screenshot({
    path: `${evidenceRoot}/frontend-expanded-contained-after-refresh.png`,
    fullPage: false,
  });
  expect(await exportFromBlock(page, firstId!)).toEqual(collapsedExport);
  await restoredFirst.getByTestId(`user-block-toggle-${firstId}`).click();
  console.log('[qwen-v2-live] refresh and collapsed/expanded export parity verified');

  await restoredFirst.locator('header').first().click();
  const runFromNode = page.getByTestId('selection-toolbar-run-from-node');
  await expect(runFromNode).toBeVisible();
  const submission = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await runFromNode.click();
  const response = await submission;
  if (!response.ok()) {
    throw new Error(`Qwen V2 graph submission failed (${response.status()}): ${await response.text()}`);
  }
  await expect(page.getByRole('dialog', { name: 'Run blocked' })).toHaveCount(0);
  const submittedGraph = response.request().postDataJSON() as ExecutionExport;
  expect(Object.keys(submittedGraph.nodes).length).toBe(EXACT_QWEN_TEXT_TO_IMAGE_NODE_COUNT);
  expect(Object.keys(submittedGraph.nodes)).not.toContain(firstId);
  const submittedNodesJson = JSON.stringify(submittedGraph.nodes);
  expect(submittedNodesJson).not.toContain('blockInstanceV2');
  expect(submittedNodesJson).not.toContain('blockProjectionOwnerId');
  expect(submittedNodesJson).not.toContain('huggingFaceCluster');
  const submittedPromptField = Object.values(submittedGraph.nodes)
    .map((node) => node.params?.prompt as { value?: unknown } | undefined)
    .find((field) => field?.value === proofPrompt);
  const submittedNegativePromptField = Object.values(submittedGraph.nodes)
    .map((node) => node.params?.negative_prompt as { value?: unknown } | undefined)
    .find((field) => field?.value === proofNegativePrompt);
  expect(submittedPromptField?.value).toBe(proofPrompt);
  expect(submittedNegativePromptField?.value).toBe(proofNegativePrompt);
  expect(submittedNodesJson).toContain(String(proofWidth));
  expect(submittedGraph.provenance).toMatchObject({
    registeredBlockV2RouteBinding: {
      schemaVersion: 1,
      admissionId: QWEN_DEFINITION_ID,
      blockDefinition: {
        definitionId: QWEN_DEFINITION_ID,
        contentHash: QWEN_BLOCK_V2_CONTENT_HASH,
        canonicalSha256: QWEN_BLOCK_V2_CANONICAL_SHA256,
      },
      studioExecutionSpec: {
        id: 'qwen-image-2512:modular-text-to-image:v1',
        contentHash: QWEN_STUDIO_SPEC_CONTENT_HASH,
        executionProfileId: 'qwen-image:modular',
      },
      artifact: { repository: QWEN_REPOSITORY, revision: QWEN_REVISION },
      modelDependencies: [],
    },
  });
  expect(submittedGraph.runtimeHints).toMatchObject({
    source: 'hugging-face-cluster',
    device: 'cuda:0',
    modelType: 'QwenImageModularPipeline',
    mode: 'modular_text_to_image',
    modelRepo: QWEN_REPOSITORY,
    resolvedModelRepo: QWEN_REPOSITORY,
    resolvedArtifact: QWEN_REPOSITORY,
    modelDependencies: [],
    loaderModule: 'modules.ModularDiffusers',
    loaderAction: 'ModelsLoader',
    executionPath: 'modular-diffusers',
    pipelineClass: 'QwenImageModularPipeline',
    dtype: 'bfloat16',
    resourceMode: 'expert',
    resolvedResourceMode: 'expert',
    quantizationMode: 'none',
    quantizedComponents: [],
    autoOffload: true,
    offloadMode: 'model_cpu',
    compatibilityStatus: 'expert',
  });
  const submittedGraphSha256 = createHash('sha256').update(JSON.stringify(submittedGraph)).digest('hex');

  const submitted = (await response.json()) as { task_id?: string };
  expect(typeof submitted.task_id).toBe('string');
  const taskId = submitted.task_id!;
  console.log(`[qwen-v2-live] submitted concrete graph task ${taskId}`);
  const task = await waitForTask(page, taskId);
  console.log(`[qwen-v2-live] task ${taskId} completed`);
  await expect
    .poll(() => findLiveStudioOutput(page, taskId), { timeout: 120_000, intervals: [500, 1000, 2000] })
    .toMatchObject({ taskId, displayType: 'image' });
  const output = await findLiveStudioOutput(page, taskId);
  expect(output?.url).toBeTruthy();
  const assetResponse = await page.request.get(new URL(output!.url!, LIVE_BACKEND_URL).toString());
  expect(assetResponse.ok()).toBe(true);
  await writeFile(`${evidenceRoot}/qwen-block-v2-live.webp`, await assetResponse.body());
  await writeFile(
    `${evidenceRoot}/post-run-dom.json`,
    `${JSON.stringify(
      await page.evaluate(() => {
        const nodes = [...document.querySelectorAll<HTMLElement>('.react-flow__node')];
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          nodes: nodes.map((node) => {
            const bounds = node.getBoundingClientRect();
            return {
              id: node.dataset.id,
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
              scrollHeight: node.scrollHeight,
            };
          }),
        };
      }),
      null,
      2,
    )}\n`,
  );
  try {
    await page.screenshot({
      path: `${evidenceRoot}/frontend-after-run.png`,
      fullPage: false,
      timeout: 120_000,
    });
  } catch (error) {
    // The generated asset, decoded-media analysis, graph receipt, and runtime
    // provenance are the qualification evidence. A very large expanded canvas
    // can delay Chromium's optional review screenshot, so preserve that failure
    // as evidence without discarding an otherwise complete model execution.
    await writeFile(
      `${evidenceRoot}/frontend-screenshot-warning.txt`,
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      'utf8',
    );
  }

  await expect
    .poll(() => findDurableCompletionReceipt(page, taskId, websocketEvents), {
      timeout: 30_000,
    })
    .toBeTruthy();
  const completionReceipt = (await findDurableCompletionReceipt(page, taskId, websocketEvents))!;
  expect(completionReceipt.runtimeFingerprint).toBeTruthy();
  expect(completionReceipt.runtimeMeasurement).toBeTruthy();

  const nodesResponse = await page.request.get(`${LIVE_BACKEND_URL}/nodes`);
  expect(nodesResponse.ok()).toBe(true);
  const nodesPayload = (await nodesResponse.json()) as Record<string, unknown>;
  const modelResponse = await page.request.get(
    `${LIVE_BACKEND_URL}/model_fingerprints?repo=${encodeURIComponent(QWEN_REPOSITORY)}`,
  );
  expect(modelResponse.ok()).toBe(true);
  const modelIdentity = selectInstalledModelIdentity(await modelResponse.json(), QWEN_REPOSITORY);
  expect(modelIdentity).toMatchObject({
    repoId: QWEN_REPOSITORY,
    selectedRevision: QWEN_REVISION,
    modelRevision: `${QWEN_REPOSITORY}@${QWEN_REVISION}`,
  });
  const outputAnalysis = await analyzeImageOutput(page, output!);
  expect(outputAnalysis).toMatchObject({
    ok: true,
    outputCount: 1,
    analyses: [{ mediaType: 'image', width: proofWidth, height: proofHeight }],
  });
  const backendSourceAfter = backendSourceIdentity(backendRoot);
  expect(backendSourceAfter.fingerprint).toBe(backendSourceBefore.fingerprint);

  const routeBinding = submittedGraph.provenance?.registeredBlockV2RouteBinding as Record<string, unknown>;
  const lockedSettings = restoredFirstSnapshot.values;
  const promptSettingsHash = sha256Value('block-v2-workload-values-v1', lockedSettings);
  const catalogTemplateLockHash = (routeBinding.blockDefinition as { canonicalSha256?: string } | undefined)
    ?.canonicalSha256;
  expect(catalogTemplateLockHash).toBeTruthy();
  const resolvedTemplateLockHash = sha256Value('block-v2-route-template-lock-v1', {
    routeBinding,
    modelRevision: modelIdentity.modelRevision,
    lockedSettings,
  });
  const runProvenance = createRunProvenance({
    templateId: QWEN_DEFINITION_ID,
    lockedSettings,
    promptSettingsHash,
    catalogTemplateLockHash,
    resolvedTemplateLockHash,
    apiGraph: submittedGraph,
    nodesPayload,
    modelIdentity,
    modelIdentities: [modelIdentity],
    inputArtifacts: [],
    runtimeFingerprint: completionReceipt.runtimeFingerprint,
    deterministicMode: completionReceipt.deterministicMode ?? submittedGraph.deterministicMode,
    backendSource: backendSourceBefore,
    outputAnalysis,
    executedOutput: { ...output, apiGraphSnapshot: submittedGraph },
    executionReceipt: completionReceipt,
    taskId,
    expectedOutput: { width: proofWidth, height: proofHeight },
  });
  expect(runProvenance.blockers).toEqual([]);
  await writeFile(`${evidenceRoot}/backend-source-before.json`, `${JSON.stringify(backendSourceBefore, null, 2)}\n`);
  await writeFile(`${evidenceRoot}/backend-source-after.json`, `${JSON.stringify(backendSourceAfter, null, 2)}\n`);
  await writeFile(`${evidenceRoot}/run-provenance.json`, `${JSON.stringify(runProvenance, null, 2)}\n`);
  await writeFile(
    `${evidenceRoot}/frontend-result.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        model: { repository: QWEN_REPOSITORY, revision: QWEN_REVISION },
        definitionId: QWEN_DEFINITION_ID,
        workflow: {
          firstInstanceId: firstId,
          siblingInstanceId: secondId,
          editedValues: restoredFirstSnapshot.values,
          siblingByteIdenticalAfterRefresh: restoredSiblingSnapshot.instanceJson === siblingBeforeEdit.instanceJson,
          internalLayoutPersisted: restoredFirstSnapshot.internalLayout.models,
          collapsedExpandedExecutionEquivalent: true,
        },
        submission: {
          taskId,
          nodeIds: Object.keys(submittedGraph.nodes),
          rootExcluded: !Object.hasOwn(submittedGraph.nodes, firstId!),
          legacyReceiptsExcluded: !submittedNodesJson.includes('huggingFaceCluster'),
          routeBinding: submittedGraph.provenance?.registeredBlockV2RouteBinding,
          runtimeHints: submittedGraph.runtimeHints,
          submittedGraphSha256: `sha256:${submittedGraphSha256}`,
        },
        task,
        output,
        runProvenance: {
          proofLockHash: runProvenance.proofLockHash,
          routeBindingHash: runProvenance.routeBindingHash,
          graphHash: runProvenance.graphHash,
          modelSetHash: runProvenance.models.hash,
          runtimeFingerprint: runProvenance.runtimeFingerprint,
          decodedOutputHash: runProvenance.mediaHash,
          blockers: runProvenance.blockers,
        },
        outputFilename: 'qwen-block-v2-live.webp',
        userNodeWriteRequests,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  if (showcaseRequested) {
    expect(userNodeWriteRequests).toBe(0);
    expect(reactFlowHandleWarnings).toEqual([]);
    expect(pageErrors).toEqual([]);
    return;
  }

  const saveUserNodeResponse = page.waitForResponse(
    (response) => response.url().endsWith('/studio/blocks') && response.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await restoredFirst.getByTestId(`user-block-save-choices-${firstId}`).click();
  const saveChoices = page.getByTestId(`save-user-block-choices-${firstId}`);
  await saveChoices.getByRole('button', { name: 'Save as new User Node' }).click();
  const savedResponse = await saveUserNodeResponse;
  expect(savedResponse.ok()).toBe(true);
  await expect(saveChoices).toHaveCount(0);

  const savedUserNode = await blockSnapshot(page, firstId!);
  expect(savedUserNode.sourceKind).toBe('user');
  expect(savedUserNode.sourceParent).toEqual({
    definitionId: QWEN_DEFINITION_ID,
    contentHash: QWEN_BLOCK_V2_CONTENT_HASH,
    sourceKind: 'diffusers_catalog',
  });
  expect(savedUserNode.values).toEqual(restoredFirstSnapshot.values);
  expect(savedUserNode.boundaryInputs).toEqual(restoredFirstSnapshot.boundaryInputs);
  expect(savedUserNode.boundaryOutputs).toEqual(restoredFirstSnapshot.boundaryOutputs);
  expect(await exportFromBlock(page, firstId!)).toEqual(collapsedExport);

  await page.getByTestId('topbar-save-workflow').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await chooseAdvancedWorkflow(page);
  await ensureExpertMode(page);
  const restoredUserRoot = page.locator(`.react-flow__node-block[data-id="${firstId}"]`);
  await expect(restoredUserRoot.getByTestId(`user-block-${firstId}`)).toHaveAttribute('data-block-source', 'user');
  const restoredUserNode = await blockSnapshot(page, firstId!);
  expect(restoredUserNode.instanceJson).toBe(savedUserNode.instanceJson);
  expect(await exportFromBlock(page, firstId!)).toEqual(collapsedExport);

  await restoredUserRoot.locator('header').first().click();
  const rerunSubmission = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByTestId('selection-toolbar-run-from-node').click();
  const rerunResponse = await rerunSubmission;
  if (!rerunResponse.ok()) {
    throw new Error(
      `Qwen User Node graph submission failed (${rerunResponse.status()}): ${await rerunResponse.text()}`,
    );
  }
  const rerunGraph = rerunResponse.request().postDataJSON() as ExecutionExport;
  expect(Object.keys(rerunGraph.nodes)).toHaveLength(EXACT_QWEN_TEXT_TO_IMAGE_NODE_COUNT);
  expect(Object.keys(rerunGraph.nodes)).not.toContain(firstId);
  expect(JSON.stringify(rerunGraph.nodes)).toContain(EDITED_PROMPT);
  expect(rerunGraph.provenance?.registeredBlockV2RouteBinding).toBeUndefined();
  const rerunTaskId = ((await rerunResponse.json()) as { task_id?: string }).task_id;
  expect(rerunTaskId).toBeTruthy();
  const rerunTask = await waitForTask(page, rerunTaskId!);
  await expect
    .poll(() => findLiveStudioOutput(page, rerunTaskId!), { timeout: 120_000, intervals: [500, 1000, 2000] })
    .toMatchObject({ taskId: rerunTaskId, displayType: 'image' });
  const rerunOutput = await findLiveStudioOutput(page, rerunTaskId!);
  expect(rerunOutput?.url).toBeTruthy();
  const rerunAsset = await page.request.get(new URL(rerunOutput!.url!, LIVE_BACKEND_URL).toString());
  expect(rerunAsset.ok()).toBe(true);
  await writeFile(`${evidenceRoot}/qwen-user-node-live.webp`, await rerunAsset.body());
  await writeFile(
    `${evidenceRoot}/user-node-result.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        savedDefinitionId: savedUserNode.definitionId,
        sourceKind: savedUserNode.sourceKind,
        sourceParent: savedUserNode.sourceParent,
        valuesPersistedAcrossRefresh: restoredUserNode.values,
        graphInterfaceAndExportPreserved: true,
        rerunTask,
        rerunOutput,
        outputFilename: 'qwen-user-node-live.webp',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  expect(userNodeWriteRequests).toBe(1);
  expect(reactFlowHandleWarnings).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('a structurally edited current Qwen or FLUX V2 Block persists, reconnects, and executes through the frontend', async ({
  page,
}) => {
  const flux = process.env.MODIFF_RUN_FLUX_V2_STRUCTURAL_EXECUTION === '1';
  test.skip(
    !flux && process.env.MODIFF_RUN_QWEN_V2_STRUCTURAL_EXECUTION !== '1',
    'Select the real Qwen or FLUX structural execution proof explicitly.',
  );
  const scenario = flux
    ? {
        family: 'flux-klein',
        label: 'Flux2 Klein — Text To Image',
        repository: 'black-forest-labs/FLUX.2-klein-4B',
        revision: 'e7b7dc27f91deacad38e78976d1f2b499d76a294',
        definitionId: 'diffusers.cluster-admission:Flux2KleinModularPipeline:text2image:mode:text_to_image',
        prompt: SHOWCASE_PROMPT,
        size: '1024',
        steps: '4',
        executableNodes: 12,
      }
    : {
        family: 'qwen',
        label: 'Qwen Image — Text To Image',
        repository: QWEN_REPOSITORY,
        revision: QWEN_REVISION,
        definitionId: QWEN_DEFINITION_ID,
        prompt: EDITED_PROMPT,
        size: '256',
        steps: '2',
        executableNodes: EXACT_QWEN_TEXT_TO_IMAGE_NODE_COUNT,
      };
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!outputDirectory, 'MODIFF_REVIEW_OUTPUT_DIR is required so the live proof is preserved for review.');
  test.setTimeout(30 * 60 * 1000);
  page.setDefaultTimeout(60_000);
  await page.setViewportSize({ width: 1920, height: 1080 });

  const evidenceRoot = `${outputDirectory}/${scenario.family}-v2-structural-execution`;
  await mkdir(evidenceRoot, { recursive: true });
  const pageErrors: string[] = [];
  const missingHandleWarnings: string[] = [];
  let userNodeWriteRequests = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.text().includes("[React Flow]: Couldn't create edge for")) missingHandleWarnings.push(message.text());
  });
  page.on('request', (request) => {
    if (request.method() === 'GET') return;
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/studio/blocks' || pathname.startsWith('/studio/blocks/')) userNodeWriteRequests += 1;
  });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('qwen-v2-structural-live')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('qwen-v2-structural-live', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await dismissRecoveredRunFailure(page);
  await dismissTaskLauncher(page);
  await ensureExpertMode(page);
  await activateRequiredHuggingFaceRuntimeThroughSetup(page, evidenceRoot);
  await waitForWorkspace(page);
  await dismissRecoveredRunFailure(page);
  await chooseAdvancedWorkflow(page);
  await ensureExpertMode(page);
  await page.evaluate(async () => {
    const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
    ]);
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useNodesStore.getState().refreshModelIndexes(false),
      useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
    ]);
  });

  await page.getByTestId('topbar-new-workflow').click();
  await chooseAdvancedWorkflow(page, true);
  await clearFinishedSessionActivity(page);
  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible();
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
    await group.getByRole('button').first().click();
  }
  await page.getByLabel('Search nodes').fill(scenario.label);
  const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: scenario.label });
  await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
  await row.dragTo(page.locator('.react-flow__pane'), { targetPosition: { x: 520, y: 180 }, timeout: 30_000 });

  const root = page.locator('.react-flow__node-block').filter({ has: page.locator('[data-block-schema-version="2"]') });
  await expect(root).toHaveCount(1, { timeout: 180_000 });
  const rootId = await root.getAttribute('data-id');
  expect(rootId).toBeTruthy();
  const defaults = await blockSnapshot(page, rootId!);
  expect(defaults).toMatchObject({
    repository: scenario.repository,
    repositoryRevision: scenario.revision,
    definitionId: scenario.definitionId,
  });
  await fillBlockValueAndAssert(
    page,
    rootId!,
    root.getByLabel('prompt', { exact: true }),
    'prompt',
    scenario.prompt,
    scenario.prompt,
  );
  await fillBlockValueAndAssert(
    page,
    rootId!,
    root.getByLabel('width', { exact: true }),
    'width',
    scenario.size,
    scenario.size,
  );
  await fillBlockValueAndAssert(
    page,
    rootId!,
    root.getByLabel('height', { exact: true }),
    'height',
    scenario.size,
    scenario.size,
  );
  await fillBlockValueAndAssert(
    page,
    rootId!,
    root.getByLabel('num inference steps', { exact: true }),
    'num_inference_steps',
    scenario.steps,
    scenario.steps,
  );
  const parameterOnly = await blockSnapshot(page, rootId!);

  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  await expect(root.getByTestId(`user-block-toggle-${rootId}`)).toHaveAccessibleName('Collapse block');
  await expect.poll(async () => (await blockSnapshot(page, rootId!)).projectionNodes.length).toBe(5);
  await assertExpandedBlockContainsProjection(page, rootId!);
  // Root expansion intentionally reveals only the immediate Modular
  // Diffusers hierarchy. Open each nested Block before exercising a leaf-node
  // replacement, matching the visible interaction a user performs.
  await expandEveryNestedBlockContainer(page, rootId!);
  await expect
    .poll(async () =>
      (await blockSnapshot(page, rootId!)).projectionNodes.some(({ semanticNodeId }) => semanticNodeId === 'prompt'),
    )
    .toBe(true);

  const fixture = await page.evaluate(async (blockId) => {
    const [{ useFlowStore }, { useStudioStore }] = await Promise.all([
      import('/src/stores/useFlowStore.ts'),
      import('/src/stores/useStudioStore.ts'),
    ]);
    const flow = useFlowStore.getState();
    flow.setBlockPresentationV2(blockId, {
      position: { x: 300, y: 80 },
      size: { width: 920, height: 900 },
    });
    const rootNode = useFlowStore.getState().nodes.find((node) => node.id === blockId);
    const instance = rootNode?.data.blockInstanceV2;
    const prompt = instance?.effectiveGraph.nodes.find(({ nodeId }) => nodeId === 'prompt');
    if (!rootNode || !instance || !prompt) throw new Error('The real Modular prompt node is unavailable.');
    const replacementId = `compatible-prompt-${Date.now()}`;
    const replacementData = structuredClone(prompt.data);
    replacementData.label = 'Compatible prompt replacement';
    const graphNodeCount = instance.effectiveGraph.nodes.length;
    const edgeCount = instance.effectiveGraph.edges.length;
    useFlowStore.getState().addNode({
      id: replacementId,
      type: 'custom',
      // Keep the source fully visible left of the expanded Block so the test
      // exercises the same pointer gesture as a user dragging a library node
      // over an internal node. An off-screen source can be located by
      // Playwright but cannot produce a real XYFlow drop event.
      position: { x: 20, y: 180 },
      width: 300,
      height: 420,
      data: replacementData,
    });
    useFlowStore.getState().resetHistory();
    useStudioStore.getState().saveActiveWorkflowTab(true);
    const promptProjectionId = useFlowStore
      .getState()
      .nodes.find(
        (node) => node.data.blockProjectionOwnerId === blockId && node.data.blockProjectionNodeId === 'prompt',
      )?.id;
    if (!promptProjectionId) throw new Error('The real Modular prompt projection is unavailable.');
    return { replacementId, promptProjectionId, graphNodeCount, edgeCount };
  }, rootId!);

  const dragNodeOnto = async (source: Locator, target: Locator) => {
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();
    const sourceBounds = await source.boundingBox();
    const headerBounds = await source.locator('header').first().boundingBox();
    const targetBounds = await target.boundingBox();
    expect(sourceBounds).toBeTruthy();
    expect(headerBounds).toBeTruthy();
    expect(targetBounds).toBeTruthy();
    const pointer = {
      x: headerBounds!.x + headerBounds!.width / 2,
      y: headerBounds!.y + Math.min(20, headerBounds!.height / 2),
    };
    await page.mouse.move(pointer.x, pointer.y);
    await page.mouse.down();
    await page.mouse.move(
      targetBounds!.x + targetBounds!.width / 2 - sourceBounds!.width / 2 + (pointer.x - sourceBounds!.x),
      targetBounds!.y + targetBounds!.height / 2 - sourceBounds!.height / 2 + (pointer.y - sourceBounds!.y),
      { steps: 12 },
    );
    await page.mouse.up();
  };

  const replacement = page.locator(`.react-flow__node-custom[data-id="${fixture.replacementId}"]`);
  const promptProjection = page.locator(`.react-flow__node-custom[data-id="${fixture.promptProjectionId}"]`);
  await dragNodeOnto(replacement, promptProjection);
  await expect(page.getByText('The internal node was replaced in this workflow Block.')).toBeVisible();

  const afterReplacement = await page.evaluate(
    async ({ blockId, replacementId }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const state = useFlowStore.getState();
      const instance = state.nodes.find((node) => node.id === blockId)?.data.blockInstanceV2;
      if (!instance) throw new Error('The edited Block disappeared.');
      const replacementNode = instance.effectiveGraph.nodes.find(({ nodeId }) => nodeId === replacementId);
      const outgoing = instance.effectiveGraph.edges.find(({ sourceNodeId }) => sourceNodeId === replacementId);
      const sourceProjectionId = state.nodes.find(
        (node) => node.data.blockProjectionOwnerId === blockId && node.data.blockProjectionNodeId === replacementId,
      )?.id;
      const targetProjectionId = state.nodes.find(
        (node) =>
          node.data.blockProjectionOwnerId === blockId && node.data.blockProjectionNodeId === outgoing?.targetNodeId,
      )?.id;
      const projectionEdgeId = state.edges.find(
        (edge) =>
          edge.data?.blockProjectionOwnerId === blockId && edge.data?.blockProjectionEdgeId === outgoing?.edgeId,
      )?.id;
      return {
        hasOriginal: instance.effectiveGraph.nodes.some(({ nodeId }) => nodeId === 'prompt'),
        hasReplacement: Boolean(replacementNode),
        sourceKind: instance.definitionSnapshot.source.kind,
        definitionHash: instance.definitionSnapshot.contentHash,
        values: structuredClone(instance.values),
        graphNodeCount: instance.effectiveGraph.nodes.length,
        edgeCount: instance.effectiveGraph.edges.length,
        outgoing,
        sourceProjectionId,
        targetProjectionId,
        projectionEdgeId,
      };
    },
    { blockId: rootId!, replacementId: fixture.replacementId },
  );
  expect(afterReplacement).toMatchObject({
    hasOriginal: false,
    hasReplacement: true,
    sourceKind: 'diffusers_catalog',
    graphNodeCount: fixture.graphNodeCount,
    edgeCount: fixture.edgeCount,
  });
  expect(afterReplacement.values).toEqual(parameterOnly.values);
  expect(afterReplacement.outgoing).toBeTruthy();
  expect(afterReplacement.sourceProjectionId).toBeTruthy();
  expect(afterReplacement.targetProjectionId).toBeTruthy();
  expect(afterReplacement.projectionEdgeId).toBeTruthy();

  // Different official hierarchies have different geometry. Use the visible
  // Arrange action, then select an exposed part of the path rather than a
  // midpoint which may be off-screen or covered by a nested container.
  await page.getByTestId('arrange-graph').click();
  const edge = page.locator(`.react-flow__edge[data-id="${afterReplacement.projectionEdgeId}"]`);
  await expect(edge).toBeVisible();
  const reachableEdgePoint = () =>
    edge.locator('.react-flow__edge-interaction').evaluate((element) => {
      if (!(element instanceof SVGPathElement)) throw new Error('The internal edge path is unavailable.');
      const matrix = element.getScreenCTM();
      if (!matrix) return null;
      const owner = element.closest('.react-flow__edge');
      const length = element.getTotalLength();
      for (let index = 5; index < 196; index += 1) {
        const point = element.getPointAtLength((length * index) / 200).matrixTransform(matrix);
        if (document.elementFromPoint(point.x, point.y)?.closest('.react-flow__edge') === owner)
          return { x: point.x, y: point.y };
      }
      return null;
    });
  // Arrange updates node dimensions and the viewport on subsequent frames.
  await expect.poll(reachableEdgePoint).not.toBeNull();
  const edgePoint = await reachableEdgePoint();
  expect(edgePoint).toBeTruthy();
  await page.mouse.click(edgePoint!.x, edgePoint!.y);
  await expect(edge).toHaveClass(/selected/u);
  await page.keyboard.press('Delete');
  await expect
    .poll(() =>
      page.evaluate(
        async ({ blockId, edgeId }) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          const instance = useFlowStore.getState().nodes.find((node) => node.id === blockId)?.data.blockInstanceV2;
          return instance?.effectiveGraph.edges.some((candidate) => candidate.edgeId === edgeId) ?? true;
        },
        { blockId: rootId!, edgeId: afterReplacement.outgoing!.edgeId },
      ),
    )
    .toBe(false);

  const sourceHandle = page.getByTestId(
    `node-handle-${afterReplacement.sourceProjectionId}-${afterReplacement.outgoing!.sourcePortId}`,
  );
  const targetHandle = page.getByTestId(
    `node-handle-${afterReplacement.targetProjectionId}-${afterReplacement.outgoing!.targetPortId}`,
  );
  await expect(sourceHandle).toBeVisible();
  await expect(targetHandle).toBeVisible();
  const sourceBounds = await sourceHandle.boundingBox();
  const targetBounds = await targetHandle.boundingBox();
  expect(sourceBounds).toBeTruthy();
  expect(targetBounds).toBeTruthy();
  await page.mouse.move(sourceBounds!.x + sourceBounds!.width / 2, sourceBounds!.y + sourceBounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBounds!.x + targetBounds!.width / 2, targetBounds!.y + targetBounds!.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        async ({ blockId, sourceNodeId, sourcePortId, targetNodeId, targetPortId }) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          const instance = useFlowStore.getState().nodes.find((node) => node.id === blockId)?.data.blockInstanceV2;
          return (
            instance?.effectiveGraph.edges.some(
              (candidate) =>
                candidate.sourceNodeId === sourceNodeId &&
                candidate.sourcePortId === sourcePortId &&
                candidate.targetNodeId === targetNodeId &&
                candidate.targetPortId === targetPortId,
            ) ?? false
          );
        },
        {
          blockId: rootId!,
          sourceNodeId: fixture.replacementId,
          sourcePortId: afterReplacement.outgoing!.sourcePortId,
          targetNodeId: afterReplacement.outgoing!.targetNodeId,
          targetPortId: afterReplacement.outgoing!.targetPortId,
        },
      ),
    )
    .toBe(true);

  await page.screenshot({ path: `${evidenceRoot}/expanded-after-replace-delete-reconnect.png`, fullPage: false });
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  await expect(root.getByTestId(`user-block-toggle-${rootId}`)).toHaveAccessibleName('Expand block');
  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill(`${scenario.label} V2 structural live ${Date.now()}`);
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  const beforeRefresh = await blockSnapshot(page, rootId!);
  await writeFile(`${evidenceRoot}/before-refresh.json`, `${JSON.stringify(beforeRefresh, null, 2)}\n`, 'utf8');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await dismissRecoveredRunFailure(page);
  await chooseAdvancedWorkflow(page);
  await ensureExpertMode(page);
  const restoredRoot = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
  await expect(restoredRoot).toHaveCount(1);
  const restored = await blockSnapshot(page, rootId!);
  expect(restored.instanceJson).toBe(beforeRefresh.instanceJson);
  expect(restored.values).toEqual(parameterOnly.values);
  await restoredRoot.getByTestId(`user-block-toggle-${rootId}`).click();
  await assertExpandedBlockContainsProjection(page, rootId!);
  await restoredRoot.getByTestId(`user-block-toggle-${rootId}`).click();

  await restoredRoot.locator('header').first().click();
  const graphSubmission = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByTestId('selection-toolbar-run-from-node').click();
  const submissionResponse = await graphSubmission;
  if (!submissionResponse.ok()) {
    throw new Error(
      `Structurally edited ${scenario.family} submission failed (${submissionResponse.status()}): ${await submissionResponse.text()}`,
    );
  }
  const submittedGraph = submissionResponse.request().postDataJSON() as ExecutionExport;
  expect(Object.keys(submittedGraph.nodes)).toHaveLength(scenario.executableNodes);
  expect(Object.keys(submittedGraph.nodes).some((id) => id.endsWith(`:${fixture.replacementId}`))).toBe(true);
  expect(Object.keys(submittedGraph.nodes).some((id) => id.endsWith(':prompt'))).toBe(false);
  const submittedReplacement = Object.entries(submittedGraph.nodes).find(([id]) =>
    id.endsWith(`:${fixture.replacementId}`),
  )?.[1];
  expect(submittedReplacement?.params?.prompt).toMatchObject({ value: scenario.prompt });
  await writeFile(`${evidenceRoot}/submitted-workflow.json`, `${JSON.stringify(submittedGraph, null, 2)}\n`);
  const taskId = ((await submissionResponse.json()) as { task_id?: string }).task_id;
  expect(taskId).toBeTruthy();
  const task = await waitForTask(page, taskId!);
  expect(task.status).toBe('completed');
  await expect
    .poll(() => findLiveStudioOutput(page, taskId!), { timeout: 120_000, intervals: [500, 1000, 2000] })
    .toMatchObject({ taskId, displayType: 'image' });
  const output = await findLiveStudioOutput(page, taskId!);
  expect(output?.url).toBeTruthy();
  const assetResponse = await page.request.get(new URL(output!.url!, LIVE_BACKEND_URL).toString());
  expect(assetResponse.ok()).toBe(true);
  const outputFilename = `${scenario.family}-structurally-edited.webp`;
  await writeFile(`${evidenceRoot}/${outputFilename}`, await assetResponse.body());
  await writeFile(
    `${evidenceRoot}/frontend-result.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        model: { repository: scenario.repository, revision: scenario.revision },
        definitionId: scenario.definitionId,
        prompt: scenario.prompt,
        settings: { width: Number(scenario.size), height: Number(scenario.size), steps: Number(scenario.steps) },
        workflow: {
          instanceId: rootId,
          parameterOnlyEditPreservedAllOtherState: true,
          compatiblePromptReplacement: { removed: 'prompt', added: fixture.replacementId },
          deletedAndReconnectedEdge: {
            sourceNodeId: fixture.replacementId,
            sourcePortId: afterReplacement.outgoing!.sourcePortId,
            targetNodeId: afterReplacement.outgoing!.targetNodeId,
            targetPortId: afterReplacement.outgoing!.targetPortId,
          },
          persistedByteIdenticallyAcrossRefresh: true,
          expandedChildrenContained: true,
        },
        submission: { taskId, nodeIds: Object.keys(submittedGraph.nodes) },
        task,
        output,
        outputFilename,
        userNodeWriteRequests,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  expect(userNodeWriteRequests).toBe(0);
  expect(missingHandleWarnings).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('every Qwen catalog entry inserts on an empty graph and contains its expanded V2 children', async ({ page }) => {
  test.skip(
    process.env.MODIFF_RUN_QWEN_V2_FAMILY_VISUAL_CONTRACT !== '1',
    'Select the complete Qwen V2 visual contract explicitly.',
  );
  test.setTimeout(30 * 60 * 1000);
  page.setDefaultTimeout(60_000);
  const allLabels = [
    'Qwen Image — Text To Image',
    'Qwen Image — Image To Image',
    'Qwen Image — Inpaint',
    'Qwen Image — Control Image',
    'Qwen Image — Controlnet Image2Image',
    'Qwen Image — Controlnet Inpainting',
    'Qwen Image Edit — Edit Image',
    'Qwen Image Edit — Inpaint',
    'Qwen Image Edit Plus — Default',
    'Qwen Image Layered — Layer Decomposition',
  ];
  const startAt = Number(process.env.MODIFF_QWEN_V2_FAMILY_START_AT ?? 0);
  const limit = Number(process.env.MODIFF_QWEN_V2_FAMILY_LIMIT ?? allLabels.length);
  const labels = allLabels
    .slice(Number.isInteger(startAt) && startAt >= 0 ? startAt : 0)
    .slice(0, Number.isInteger(limit) && limit > 0 ? limit : allLabels.length);
  const proveLifecycle = process.env.MODIFF_QWEN_V2_FAMILY_LIFECYCLE === '1';
  const familyResults: Array<Record<string, unknown>> = [];

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('qwen-v2-family-contract')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('qwen-v2-family-contract', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  await ensureExpertMode(page);
  await page.evaluate(async () => {
    const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
    ]);
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
    ]);
  });

  for (const label of labels) {
    console.log(`[qwen-v2-family] checking ${label}`);
    // Startup recovery and a preceding Save/reload can remount the task
    // launcher after the initial dismissal. Always settle both gates before
    // asking the top bar to create the next empty workflow.
    await waitForWorkspace(page);
    await chooseAdvancedWorkflow(page, true);
    await page.getByTestId('topbar-new-workflow').click();
    await chooseAdvancedWorkflow(page, true);
    const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
    if (!(await group.isVisible({ timeout: 1_000 }).catch(() => false))) {
      await page.getByTestId('left-tab-nodes').click();
    }
    await expect(group).toBeVisible();
    if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
      await group.getByRole('button').first().click();
    }
    await page.getByLabel('Search nodes').fill(label);
    const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: label });
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('draggable', 'true');
    const beforeIds = await page.evaluate(async () => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return useFlowStore
        .getState()
        .nodes.filter((node) => node.data.blockInstanceV2)
        .map((node) => node.id);
    });
    await row.click();
    await expect
      .poll(
        () =>
          page.evaluate(async (existingIds) => {
            const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
            return (
              useFlowStore.getState().nodes.find((node) => node.data.blockInstanceV2 && !existingIds.includes(node.id))
                ?.id ?? null
            );
          }, beforeIds),
        { timeout: 180_000 },
      )
      .not.toBeNull();
    const rootId = await page.evaluate(async (existingIds) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return useFlowStore.getState().nodes.find((node) => node.data.blockInstanceV2 && !existingIds.includes(node.id))!
        .id;
    }, beforeIds);
    const root = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
    await expect(root).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          return useFlowStore.getState().nodes.find((candidate) => candidate.id === id)?.data.blockInstanceV2
            ?.customization.state;
        }, rootId),
      )
      .toBe('unchanged');
    if (label === 'Qwen Image Edit Plus — Default') {
      const routeSelect = root.getByTestId(`block-v2-route-select-${rootId}`);
      await expect(routeSelect).toBeVisible();
      await expect(routeSelect).toContainText('Qwen Image Edit Plus — Single image');
      await routeSelect.click();
      await page.getByRole('option', { name: 'Qwen Image Edit Plus — Multi-reference', exact: true }).click();
      const switchDialog = page.getByRole('dialog', { name: 'Switch model route' });
      if (await switchDialog.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await switchDialog.getByRole('button', { name: 'Keep draft and switch', exact: true }).click();
      }
      await expect
        .poll(
          () =>
            page.evaluate(async (id) => {
              const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
              return useFlowStore.getState().nodes.find((candidate) => candidate.id === id)?.data.blockInstanceV2
                ?.definitionRef.definitionId;
            }, rootId),
          { timeout: 180_000 },
        )
        .toBe('diffusers.cluster-admission:QwenImageEditPlusModularPipeline:default:mode:multi_image_reference_edit');
      await expect(routeSelect).toContainText('Qwen Image Edit Plus — Multi-reference');
    }
    const lifecyclePrompt = `Qwen V2 persisted parameter proof — ${label}`;
    if (proveLifecycle) {
      await page.evaluate(
        async ({ id, prompt }) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          useFlowStore.getState().setBlockInstanceValueV2(id, 'prompt', prompt);
        },
        { id: rootId, prompt: lifecyclePrompt },
      );
      await expect
        .poll(() =>
          page.evaluate(async (id) => {
            const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
            const instance = useFlowStore.getState().nodes.find((candidate) => candidate.id === id)
              ?.data.blockInstanceV2;
            return { prompt: instance?.values.prompt, state: instance?.customization.state };
          }, rootId),
        )
        .toEqual({ prompt: lifecyclePrompt, state: 'parameters_changed' });
    }
    const contract = await page.evaluate(async (id) => {
      const [{ useFlowStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
        import('/src/stores/useFlowStore.ts'),
        import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
      ]);
      const instance = useFlowStore.getState().nodes.find((candidate) => candidate.id === id)?.data.blockInstanceV2;
      if (!instance) throw new Error(`Missing Qwen Block V2 instance ${id}.`);
      const source = useHuggingFaceNodeLibraryStore
        .getState()
        .library?.definitions.find((definition) => definition.id === instance.definitionId);
      const suggestedPrompt = source?.suggestedInputs.values.prompt;
      return {
        publicInputs: instance.effectiveInterface.boundary.inputs.length,
        publicOutputs: instance.effectiveInterface.boundary.outputs.length,
        internalNodes: instance.effectiveGraph.nodes.length,
        internalEdges: instance.effectiveGraph.edges.length,
        suggestedPrompt: typeof suggestedPrompt === 'string' ? suggestedPrompt : null,
        instancePrompt: typeof instance.values.prompt === 'string' ? instance.values.prompt : null,
      };
    }, rootId);
    expect(contract.publicInputs).toBeGreaterThan(0);
    expect(contract.publicOutputs).toBeGreaterThan(0);
    expect(contract.internalNodes).toBeGreaterThan(0);
    expect(contract.internalEdges).toBeGreaterThan(0);
    if (contract.suggestedPrompt) expect(contract.instancePrompt).toBe(contract.suggestedPrompt);
    const before = await page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const node = useFlowStore.getState().nodes.find((candidate) => candidate.id === id)!;
      return JSON.stringify(node.data.blockInstanceV2);
    }, rootId);
    await root.getByTestId(`user-block-toggle-${rootId}`).click();
    await expect(root.getByTestId(`user-block-toggle-${rootId}`)).toHaveAccessibleName('Collapse block');
    const initialDisclosure = await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
            const flow = useFlowStore.getState();
            const instance = flow.nodes.find((node) => node.id === id)?.data.blockInstanceV2;
            const projections = flow.nodes.filter((node) => node.data.blockProjectionOwnerId === id);
            if (!instance || projections.length === 0) return null;
            return {
              effectiveNodeCount: instance.effectiveGraph.nodes.length,
              visibleNodeCount: projections.length,
              collapsedContainerNodeIds: instance.presentation.collapsedContainerNodeIds ?? [],
              visibleExpandedContainers: projections
                .filter(
                  (node) => node.data.blockProjectionContainer && node.data.blockProjectionContainerExpanded !== false,
                )
                .map((node) => node.data.blockProjectionNodeId),
              portlessVisibleContainers: projections
                .filter(
                  (node) =>
                    node.data.blockProjectionContainer &&
                    Object.keys(node.data.blockProjectionPortBindings ?? {}).length === 0,
                )
                .map((node) => node.data.blockProjectionNodeId),
            };
          }, rootId),
        { timeout: 30_000 },
      )
      .not.toBeNull()
      .then(() =>
        page.evaluate(async (id) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          const flow = useFlowStore.getState();
          const instance = flow.nodes.find((node) => node.id === id)!.data.blockInstanceV2!;
          const projections = flow.nodes.filter((node) => node.data.blockProjectionOwnerId === id);
          return {
            effectiveNodeCount: instance.effectiveGraph.nodes.length,
            visibleNodeCount: projections.length,
            collapsedContainerNodeIds: instance.presentation.collapsedContainerNodeIds ?? [],
            visibleExpandedContainers: projections
              .filter(
                (node) => node.data.blockProjectionContainer && node.data.blockProjectionContainerExpanded !== false,
              )
              .map((node) => node.data.blockProjectionNodeId),
            portlessVisibleContainers: projections
              .filter(
                (node) =>
                  node.data.blockProjectionContainer &&
                  Object.keys(node.data.blockProjectionPortBindings ?? {}).length === 0,
              )
              .map((node) => node.data.blockProjectionNodeId),
          };
        }, rootId),
      );
    expect(initialDisclosure.effectiveNodeCount).toBeGreaterThan(0);
    if (initialDisclosure.collapsedContainerNodeIds.length > 0) {
      expect(initialDisclosure.visibleNodeCount).toBeLessThan(initialDisclosure.effectiveNodeCount);
    }
    expect(initialDisclosure.visibleExpandedContainers).toEqual([]);
    expect(initialDisclosure.portlessVisibleContainers).toEqual([]);
    await assertExpandedBlockContainsProjection(page, rootId);

    // Progressively open every nested Modular container. The old family gate
    // incorrectly expected a root expansion to flatten and reveal every
    // descendant immediately; that assertion could not detect the actual
    // nested disclosure, boundary-port, or per-level containment contract.
    for (let iteration = 0; iteration < initialDisclosure.effectiveNodeCount; iteration += 1) {
      const opened = await page.evaluate(async (id) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const flow = useFlowStore.getState();
        const candidate = flow.nodes.find(
          (node) =>
            node.data.blockProjectionOwnerId === id &&
            node.data.blockProjectionContainer &&
            node.data.blockProjectionContainerExpanded === false,
        );
        if (!candidate?.data.blockProjectionNodeId) return false;
        flow.toggleBlockContainerExpandedV2(id, candidate.data.blockProjectionNodeId);
        return true;
      }, rootId);
      if (!opened) break;
      await expect
        .poll(() =>
          page.evaluate(async (id) => {
            const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
            const flow = useFlowStore.getState();
            const instance = flow.nodes.find((node) => node.id === id)?.data.blockInstanceV2;
            return {
              visible: flow.nodes.filter((node) => node.data.blockProjectionOwnerId === id).length,
              remaining: instance?.presentation.collapsedContainerNodeIds?.length ?? 0,
            };
          }, rootId),
        )
        .not.toEqual({ visible: 0, remaining: initialDisclosure.collapsedContainerNodeIds.length });
      await assertExpandedBlockContainsProjection(page, rootId);
    }
    const fullyExpanded = await page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      const instance = flow.nodes.find((node) => node.id === id)!.data.blockInstanceV2!;
      const projections = flow.nodes.filter((node) => node.data.blockProjectionOwnerId === id);
      return {
        visibleNodeCount: projections.length,
        effectiveNodeCount: instance.effectiveGraph.nodes.length,
        collapsedContainerNodeIds: instance.presentation.collapsedContainerNodeIds ?? [],
        portlessVisibleContainers: projections
          .filter(
            (node) =>
              node.data.blockProjectionContainer &&
              Object.keys(node.data.blockProjectionPortBindings ?? {}).length === 0,
          )
          .map((node) => node.data.blockProjectionNodeId),
      };
    }, rootId);
    expect(fullyExpanded.visibleNodeCount).toBe(fullyExpanded.effectiveNodeCount);
    expect(fullyExpanded.collapsedContainerNodeIds).toEqual([]);
    expect(fullyExpanded.portlessVisibleContainers).toEqual([]);

    // Restore the initial progressive-disclosure state before collapsing so
    // the outer expand/collapse gesture itself remains presentation-neutral.
    await page.evaluate(
      async ({ id, collapsedContainerNodeIds }) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        useFlowStore.getState().setBlockPresentationV2(id, { collapsedContainerNodeIds });
      },
      { id: rootId, collapsedContainerNodeIds: initialDisclosure.collapsedContainerNodeIds },
    );
    await root.getByTestId(`user-block-toggle-${rootId}`).click();
    await expect(root.getByTestId(`user-block-toggle-${rootId}`)).toHaveAccessibleName('Expand block');
    const afterDisclosure = await page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const instance = useFlowStore.getState().nodes.find((node) => node.id === id)!.data.blockInstanceV2!;
      return {
        definitionRef: instance.definitionRef,
        effectiveGraphHash: instance.effectiveGraph.graphHash,
        effectiveInterfaceHash: instance.effectiveInterface.effectiveInterfaceHash,
        values: instance.values,
        customization: instance.customization,
        expanded: instance.presentation.expanded,
        collapsedContainerNodeIds: instance.presentation.collapsedContainerNodeIds ?? [],
      };
    }, rootId);
    const beforeDisclosure = JSON.parse(before) as {
      definitionRef: unknown;
      effectiveGraph: { graphHash: string };
      effectiveInterface: { effectiveInterfaceHash: string };
      values: unknown;
      customization: unknown;
    };
    expect(afterDisclosure).toEqual({
      definitionRef: beforeDisclosure.definitionRef,
      effectiveGraphHash: beforeDisclosure.effectiveGraph.graphHash,
      effectiveInterfaceHash: beforeDisclosure.effectiveInterface.effectiveInterfaceHash,
      values: beforeDisclosure.values,
      customization: beforeDisclosure.customization,
      expanded: false,
      collapsedContainerNodeIds: initialDisclosure.collapsedContainerNodeIds,
    });

    if (proveLifecycle) {
      const beforeSave = await page.evaluate(async (id) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const instance = useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2;
        if (!instance) throw new Error(`Missing Qwen Block V2 instance ${id} before Save.`);
        return JSON.stringify(instance);
      }, rootId);
      await page.getByTestId('topbar-save-workflow').click();
      const saveDialog = page.getByTestId('save-workflow-dialog');
      if (await saveDialog.isVisible()) {
        await page.getByTestId('save-workflow-name').fill(`Qwen V2 Lifecycle ${label} ${Date.now()}`);
        const confirmSave = page.getByTestId('confirm-save-workflow');
        // A preceding automatic persistence request may still own the save
        // coordinator after a large recursive projection was collapsed. The
        // dialog correctly disables duplicate writes; wait for that bounded
        // request instead of clicking a disabled button and misreporting the
        // lifecycle as a UI failure.
        await expect(confirmSave).toBeEnabled({ timeout: 120_000 });
        await confirmSave.click();
        await expect(saveDialog).toHaveCount(0, { timeout: 120_000 });
      }
      await expect
        .poll(() =>
          page.evaluate(() => {
            const studio = window.__MODIFF_E2E__!.getState().studio;
            return studio.workflowTabs.find((tab: { id: string }) => tab.id === studio.activeWorkflowTabId)?.dirty;
          }),
        )
        .toBe(false);
      const workflowIdentity = await page.evaluate(() => {
        const studio = window.__MODIFF_E2E__!.getState().studio;
        const tab = studio.workflowTabs.find(
          (candidate: { id: string }) => candidate.id === studio.activeWorkflowTabId,
        );
        return { tabId: tab?.id ?? null, workflowId: tab?.workflowId ?? null, title: tab?.title ?? null };
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForWorkspace(page);
      await dismissTaskLauncher(page);
      await ensureExpertMode(page);
      await expect(page.locator(`.react-flow__node-block[data-id="${rootId}"]`)).toHaveCount(1);
      const restored = await page.evaluate(async (id) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const instance = useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2;
        if (!instance) throw new Error(`Missing Qwen Block V2 instance ${id} after refresh.`);
        return JSON.stringify(instance);
      }, rootId);
      expect(restored).toBe(beforeSave);
      const restoredRoot = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
      await restoredRoot.getByTestId(`user-block-toggle-${rootId}`).click();
      await assertExpandedBlockContainsProjection(page, rootId);
      await restoredRoot.getByTestId(`user-block-toggle-${rootId}`).click();
      expect(
        await page.evaluate(async (id) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          return useFlowStore.getState().nodes.find((node) => node.id === id)?.data.blockInstanceV2?.values.prompt;
        }, rootId),
      ).toBe(lifecyclePrompt);
      familyResults.push({
        label,
        rootId,
        ...workflowIdentity,
        prompt: lifecyclePrompt,
        instanceSha256: `sha256:${createHash('sha256').update(restored).digest('hex')}`,
        saveRefreshByteIdentical: true,
        expandedContainedAfterRefresh: true,
      });
    }
  }

  if (proveLifecycle && process.env.MODIFF_REVIEW_OUTPUT_DIR) {
    const evidenceRoot = `${process.env.MODIFF_REVIEW_OUTPUT_DIR}/qwen-v2-family-lifecycle`;
    await mkdir(evidenceRoot, { recursive: true });
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      `${JSON.stringify({ schemaVersion: 1, routes: familyResults }, null, 2)}\n`,
      'utf8',
    );
  }
});

async function saveAndReinsertUserNodeForLiveProof(page: Page, rootId: string, evidenceRoot: string) {
  const originalRoot = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
  const before = await blockSnapshot(page, rootId);
  const beforeExport = await exportFromBlock(page, rootId);
  const savedResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/studio/blocks' && response.request().method() === 'POST',
  );
  await originalRoot.getByTestId(`user-block-save-choices-${rootId}`).click();
  const choices = page.getByTestId(`save-user-block-choices-${rootId}`);
  await choices.getByRole('button', { name: 'Save as new User Node', exact: true }).click();
  const response = await savedResponse;
  expect(response.ok(), await response.text()).toBe(true);
  await expect(choices).toHaveCount(0);
  const saved = await blockSnapshot(page, rootId);
  expect(saved.sourceKind).toBe('user');
  expect(saved.sourceParent?.definitionId).toBe(before.definitionId);
  expect(saved.values).toEqual(before.values);
  expect(saved.boundaryInputs).toEqual(before.boundaryInputs);
  expect(saved.boundaryOutputs).toEqual(before.boundaryOutputs);
  expect(await exportFromBlock(page, rootId)).toEqual(beforeExport);
  const savedLibraryDefinition = await page.evaluate(async (definitionId) => {
    const { useUserBlockStore } = await import('/src/stores/useUserBlockStore.ts');
    return useUserBlockStore
      .getState()
      .blockDefinitionsV2.find((definition) => definition.definitionId === definitionId);
  }, saved.definitionId);
  expect(savedLibraryDefinition).toBeTruthy();

  if (!(await page.getByLabel('Search nodes').isVisible())) await page.getByTestId('left-tab-nodes').click();
  await page.getByLabel('Search nodes').fill(saved.definitionId);
  const rowId = saved.definitionId.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const row = page.getByTestId(`user-block-row-${rowId}`);
  await expect(row).toBeVisible();
  const existingIds = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore.getState().nodes.map((node) => node.id);
  });
  await row.click();
  const findReinsertedId = () =>
    page.evaluate(async (ids) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return (
        useFlowStore.getState().nodes.find((node) => node.data.blockInstanceV2 && !ids.includes(node.id))?.id ?? null
      );
    }, existingIds);
  await expect.poll(findReinsertedId).not.toBeNull();
  const reinsertedId = (await findReinsertedId())!;
  const reinsertedRoot = page.locator(`.react-flow__node-block[data-id="${reinsertedId}"]`);
  const reinserted = await blockSnapshot(page, reinsertedId);
  expect(reinserted.sourceKind).toBe('user');
  expect(reinserted.definitionId).toBe(saved.definitionId);
  // A fresh instance inherits saved defaults without redundant overrides.
  // Compare effective values and the visible prompt, not sparse storage maps.
  expect(reinserted.resolvedValues).toEqual(saved.resolvedValues);
  await expect(reinsertedRoot.getByLabel('prompt', { exact: true })).toHaveValue(String(saved.resolvedValues.prompt));
  expect(reinserted.boundaryInputs).toEqual(saved.boundaryInputs);
  expect(reinserted.boundaryOutputs).toEqual(saved.boundaryOutputs);
  expect(reinserted.definitionDefaults).toEqual(saved.definitionDefaults);
  const editedPrompt = `${String(saved.values.prompt)} A single red wax seal rests on the folded technical drawing.`;
  await fillBlockValueAndAssert(
    page,
    reinsertedId,
    reinsertedRoot.getByLabel('prompt', { exact: true }),
    'prompt',
    editedPrompt,
    editedPrompt,
  );
  const edited = await blockSnapshot(page, reinsertedId);
  expect({ ...edited.resolvedValues, prompt: saved.resolvedValues.prompt }).toEqual(saved.resolvedValues);
  expect(JSON.parse(edited.instanceJson).effectiveGraph).toEqual(JSON.parse(reinserted.instanceJson).effectiveGraph);
  expect(JSON.parse(edited.instanceJson).effectiveInterface).toEqual(
    JSON.parse(reinserted.instanceJson).effectiveInterface,
  );
  expect((await blockSnapshot(page, rootId)).instanceJson).toBe(saved.instanceJson);
  const afterLibrary = await page.evaluate(async (definitionId) => {
    const { useUserBlockStore } = await import('/src/stores/useUserBlockStore.ts');
    return useUserBlockStore
      .getState()
      .blockDefinitionsV2.find((definition) => definition.definitionId === definitionId);
  }, saved.definitionId);
  expect(afterLibrary).toEqual(savedLibraryDefinition);
  await writeFile(
    `${evidenceRoot}/user-node-lifecycle.json`,
    `${JSON.stringify(
      {
        originalRootId: rootId,
        reinsertedId,
        before,
        saved,
        reinserted,
        edited,
        savedLibraryDefinition,
        checks: {
          saveAs: true,
          reinsert: true,
          interfacePreserved: true,
          instanceIsolation: true,
          libraryIsolation: true,
        },
      },
      null,
      2,
    )}\n`,
  );
  return {
    root: reinsertedRoot,
    rootId: reinsertedId,
    prompt: editedPrompt,
    originalRootId: rootId,
    originalInstanceJson: saved.instanceJson,
  };
}

test('cached FLUX V2 retains visible edits and generates with model-card settings', async ({ page }) => {
  test.skip(process.env.MODIFF_RUN_FLUX_KLEIN_V2_DEMO !== '1', 'Select the cached FLUX Klein V2 demo explicitly.');
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!outputDirectory, 'A separate review output directory is required.');
  test.setTimeout(45 * 60 * 1000);
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const variants: Record<
    string,
    { label: string; repository: string; revision: string; pipelineClass: string; steps: number; guidance: number }
  > = {
    klein: {
      label: 'Flux2 Klein',
      repository: 'black-forest-labs/FLUX.2-klein-4B',
      revision: 'e7b7dc27f91deacad38e78976d1f2b499d76a294',
      pipelineClass: 'Flux2KleinModularPipeline',
      steps: 4,
      guidance: 1,
    },
    'klein-base': {
      label: 'Flux2 Klein Base',
      repository: 'black-forest-labs/FLUX.2-klein-base-4B',
      revision: 'a3b4f4849157f664bdbc776fd7453c2783562f4d',
      pipelineClass: 'Flux2KleinBaseModularPipeline',
      steps: 50,
      guidance: 4,
    },
    kontext: {
      label: 'Flux Kontext',
      repository: 'black-forest-labs/FLUX.1-Kontext-dev',
      revision: '24e9dedc4ef646698dc8eb4e18ae2cec3c9fea0d',
      pipelineClass: 'FluxKontextModularPipeline',
      steps: 28,
      guidance: 2.5,
    },
  };
  const variant = process.env.MODIFF_FLUX_V2_VARIANT || 'klein';
  const editing = process.env.MODIFF_FLUX_V2_EDIT === '1';
  const inputImage = editing ? process.env.MODIFF_FLUX_V2_INPUT_IMAGE : undefined;
  if (!variants[variant]) throw new Error(`Unknown cached FLUX variant: ${variant}`);
  if (editing && !inputImage) throw new Error('An explicit existing image is required for the edit lifecycle.');
  const selected = variants[variant]!;
  const scenario = {
    ...selected,
    id: `${variant === 'kontext' ? 'flux-kontext' : `flux2-${variant}`}-${editing ? 'edit-image' : 'text-to-image'}`,
    label: `${selected.label} — ${editing ? 'Edit Image' : 'Text To Image'}`,
    values: {},
  };
  const evidenceRoot = `${outputDirectory}/${scenario.id}`;
  await mkdir(evidenceRoot, { recursive: true });
  const requestStartedAt = new Map<string, number>();
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path !== '/auto_resource/plans' && path !== '/hf_cache' && !path.startsWith('/workflows')) return;
    requestStartedAt.set(request.url(), Date.now());
    console.log(`[flux-klein-v2] requesting ${path}`);
  });
  page.on('response', (response) => {
    const startedAt = requestStartedAt.get(response.url());
    if (startedAt === undefined) return;
    console.log(
      `[flux-klein-v2] ${new URL(response.url()).pathname}: ${response.status()} in ${Date.now() - startedAt}ms`,
    );
  });
  // Creator/Diffusers recommendations: Klein distilled 4/1, Base 50/4,
  // Kontext 28/2.5. Use full 1024-square instance settings, not smoke defaults.
  const modelCard = `https://huggingface.co/${scenario.repository}/blob/${scenario.revision}/README.md`;
  let prompt = editing
    ? 'Change only the dark blue velvet beneath the brass astrolabe to rich burgundy velvet. Preserve the exact astrolabe, all brass rings and engravings, the oak workbench, glove, tools, lamp, arched windows, camera position and lighting. Keep the original photograph realistic with detailed fabric folds; do not add or remove objects.'
    : 'Editorial photograph inside a museum conservation workshop at dawn. A disassembled brass astronomical ' +
      'astrolabe rests on dark blue velvet at the center of an oak workbench. Its concentric engraved rings, ' +
      'tiny screws and one sapphire glass lens are arranged carefully beside it. A white cotton glove, a fine ' +
      'brush and a folded technical drawing sit in the foreground. Behind the bench, tall arched windows reveal ' +
      'a misty old city; cool daylight mixes with one warm articulated desk lamp. A small cream label clearly ' +
      'reads "ORBIT 07". Coherent perspective, exquisite aged metal and fabric textures, realistic reflections, ' +
      'restrained navy and amber palette, layered depth, crisp product detail, natural photographic lighting, no people.';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('flux-klein-v2-demo')) return;
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('flux-klein-v2-demo', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await dismissRecoveredRunFailure(page);
  await chooseAdvancedWorkflow(page, true);
  await ensureExpertMode(page);
  await activateRequiredHuggingFaceRuntimeThroughSetup(page, evidenceRoot);
  await waitForResponsiveLiveControlPlane(page);

  const identityResponse = await page.request.get(
    `${LIVE_BACKEND_URL}/model_fingerprints?repo=${encodeURIComponent(scenario.repository)}`,
  );
  expect(identityResponse.ok()).toBe(true);
  const modelIdentity = selectInstalledModelIdentity(await identityResponse.json(), scenario.repository);
  expect(modelIdentity).toMatchObject({ repoId: scenario.repository, selectedRevision: scenario.revision });
  await page.getByTestId('topbar-models').click();
  const manager = page.getByTestId('model-manager-dialog');
  const modelRow = manager.locator(
    `[data-testid="model-manager-supported-${scenario.pipelineClass}"][data-model-repo="${scenario.repository}"]`,
  );
  await expect(modelRow.getByTestId(`model-manager-install-${scenario.pipelineClass}`)).toHaveText('Ready');
  const healthStartedAt = Date.now();
  const managerHealth = await page.request.get(`${LIVE_BACKEND_URL}/health`, { timeout: 3_000 });
  const healthMilliseconds = Date.now() - healthStartedAt;
  expect(managerHealth.ok()).toBe(true);
  expect((await managerHealth.json()).ready).toBe(true);
  await writeFile(
    `${evidenceRoot}/model-manager-control-plane.json`,
    `${JSON.stringify({ status: managerHealth.status(), healthMilliseconds, modelReady: true }, null, 2)}\n`,
  );
  await manager.getByTestId('model-manager-close').click();

  let { root, rootId } = await insertV2Admission(page, scenario);
  // The workflow owns its resource mode; the reviewed interface also contains
  // an explicit Advanced disclosure that remains available in manual mode.
  await ensureExpertMode(page);
  const advanced = root.getByRole('button', { name: 'Advanced', exact: true });
  if (await advanced.isVisible()) await advanced.click();
  const before = await blockSnapshot(page, rootId);
  expect(Object.keys(before.definitionDefaults).length).toBeGreaterThan(0);
  expect(before.repository).toBe(scenario.repository);
  expect(before.repositoryRevision).toBe(scenario.revision);
  await fillBlockValueAndAssert(page, rootId, root.getByLabel('prompt', { exact: true }), 'prompt', prompt, prompt);
  const afterPrompt = await blockSnapshot(page, rootId);
  const beforeInstance = JSON.parse(before.instanceJson);
  const promptInstance = JSON.parse(afterPrompt.instanceJson);
  expect(promptInstance.effectiveGraph).toEqual(beforeInstance.effectiveGraph);
  expect(promptInstance.effectiveInterface).toEqual(beforeInstance.effectiveInterface);
  expect(promptInstance.presentation).toEqual(beforeInstance.presentation);
  expect(afterPrompt.definitionDefaults).toEqual(before.definitionDefaults);
  expect({ ...afterPrompt.values, prompt: before.values.prompt }).toEqual(before.values);
  if (inputImage) {
    await fillBlockValueAndAssert(
      page,
      rootId,
      root.getByLabel('image', { exact: true }).first(),
      'image',
      inputImage,
      [inputImage],
    );
  }

  for (const [control, label, temporary, final] of [
    ['width', 'width', '1008', '1024'],
    ['height', 'height', '1008', '1024'],
    ['num_inference_steps', 'num inference steps', String(scenario.steps + 1), String(scenario.steps)],
  ]) {
    const field = root.getByLabel(label, { exact: true });
    await fillBlockValueAndAssert(page, rootId, field, control, temporary, temporary);
    await fillBlockValueAndAssert(page, rootId, field, control, final, final);
  }
  await fillBlockValueAndAssert(page, rootId, root.getByLabel('Seed', { exact: true }), 'seed', '20260905', {
    value: '20260905',
    isRandom: false,
  });
  await fillBlockValueAndAssert(
    page,
    rootId,
    root.getByLabel('Guidance Scale', { exact: true }),
    'guidanceScale',
    (scenario.guidance + 0.5).toFixed(1),
    (scenario.guidance + 0.5).toFixed(1),
  );
  await fillBlockValueAndAssert(
    page,
    rootId,
    root.getByLabel('Guidance Scale', { exact: true }),
    'guidanceScale',
    scenario.guidance.toFixed(1),
    scenario.guidance.toFixed(1),
  );
  const userNodeProof =
    process.env.MODIFF_FLUX_V2_USER_NODE_LIFECYCLE === '1'
      ? await saveAndReinsertUserNodeForLiveProof(page, rootId, evidenceRoot)
      : null;
  if (userNodeProof) ({ root, rootId, prompt } = userNodeProof);
  const generationDefaults = (await blockSnapshot(page, rootId)).definitionDefaults;
  const collapsed = await exportFromBlock(page, rootId);
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  await assertExpandedBlockContainsProjection(page, rootId);
  expect(await exportFromBlock(page, rootId)).toEqual(collapsed);
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  const savedInstance = (await blockSnapshot(page, rootId)).instanceJson;
  const workflowName = `${scenario.label} V2 Museum Workshop ${Date.now()}`;
  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  await expect(saveDialog).toBeVisible();
  await page.getByTestId('save-workflow-name').fill(workflowName);
  const confirmSave = page.getByTestId('confirm-save-workflow');
  await expect(confirmSave).toBeEnabled({ timeout: 120_000 });
  await confirmSave.click();
  await expect(saveDialog).toHaveCount(0, { timeout: 120_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await ensureExpertMode(page);
  expect((await blockSnapshot(page, rootId)).instanceJson).toBe(savedInstance);
  if (userNodeProof) {
    expect((await blockSnapshot(page, userNodeProof.originalRootId)).instanceJson).toBe(
      userNodeProof.originalInstanceJson,
    );
  }
  expect(await exportFromBlock(page, rootId)).toEqual(collapsed);
  const restored = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
  await expect(restored.getByLabel('prompt', { exact: true })).toHaveValue(prompt);
  await restored.getByTestId(`user-block-toggle-${rootId}`).click();
  await assertExpandedBlockContainsProjection(page, rootId);
  expect(await exportFromBlock(page, rootId)).toEqual(collapsed);
  await page.screenshot({ path: `${evidenceRoot}/expanded-after-refresh.png`, fullPage: false });
  await restored.getByTestId(`user-block-toggle-${rootId}`).click();

  await restored.locator('header').first().click();
  const submittedResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/graph' && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByTestId('selection-toolbar-run-from-node').click();
  const response = await submittedResponse;
  expect(response.ok(), await response.text()).toBe(true);
  const graph = response.request().postDataJSON() as ExecutionExport;
  const taskId = ((await response.json()) as { task_id: string }).task_id;
  await writeFile(`${evidenceRoot}/submitted-workflow.json`, `${JSON.stringify(graph, null, 2)}\n`);
  await writeFile(`${evidenceRoot}/submitted-task.json`, `${JSON.stringify({ taskId, workflowName }, null, 2)}\n`);
  if (!userNodeProof) {
    expect(graph.runtimeHints).toMatchObject({
      modelRepo: scenario.repository,
      pipelineClass: scenario.pipelineClass,
      dtype: 'bfloat16',
      quantizationMode: 'none',
      autoOffload: true,
      offloadMode: 'model_cpu',
    });
  }
  // User-owned graphs run concrete nodes, without borrowing registered-route
  // qualification authority. Their loader values are the execution contract.
  const loader = Object.values(graph.nodes).find(
    (node) => node.module === 'modules.ModularDiffusers' && node.action === 'ModelsLoader',
  );
  expect(loader?.params).toMatchObject({
    auto_offload: { value: true },
    dtype: { value: 'bfloat16' },
    offload_mode: { value: 'model_cpu' },
    repo_id: { value: { source: 'hub', value: scenario.repository } },
    revision: { value: scenario.revision },
  });
  expect((loader?.params?.quant_config as { value?: unknown } | undefined)?.value).toBeUndefined();
  expect(JSON.stringify(graph.nodes)).toContain(JSON.stringify(prompt));
  expect(JSON.stringify(graph.nodes)).not.toContain('blockInstanceV2');
  console.log(
    `[flux-v2] ${scenario.id} submitted ${taskId}, 1024x1024, ${scenario.steps} steps, guidance ${scenario.guidance}, no quantization`,
  );
  const task = await waitForTask(page, taskId, 30 * 60 * 1000);
  await expect
    .poll(() => findLiveStudioOutput(page, taskId), { timeout: 120_000 })
    .toMatchObject({
      taskId,
      displayType: 'image',
    });
  const output = await findLiveStudioOutput(page, taskId);
  expect(output?.url).toBeTruthy();
  const asset = await page.request.get(new URL(output!.url!, LIVE_BACKEND_URL).toString());
  expect(asset.ok()).toBe(true);
  const assetPath = `${evidenceRoot}/museum-workshop.webp`;
  await writeFile(assetPath, await asset.body());
  if (userNodeProof) {
    expect(output).toMatchObject({
      modelType: scenario.pipelineClass,
      repo: scenario.repository,
      prompt,
      width: 1024,
      height: 1024,
      steps: scenario.steps,
      seed: 20260905,
      formSnapshot: { modelType: scenario.pipelineClass, prompt, steps: scenario.steps },
    });
  }
  const decoded = await decodedMediaHash(assetPath, 'image');
  expect(decoded).toMatchObject({ width: 1024, height: 1024 });
  const finalInstance = await blockSnapshot(page, rootId);
  expect(finalInstance.values).toEqual(JSON.parse(savedInstance).values);
  expect(finalInstance.definitionDefaults).toEqual(generationDefaults);
  await page.screenshot({ path: `${evidenceRoot}/frontend-after-run.png`, fullPage: false });
  await writeFile(
    `${evidenceRoot}/frontend-result.json`,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        workflowName,
        rootId,
        modelIdentity,
        modelCard,
        prompt,
        inputImage,
        settings: {
          width: 1024,
          height: 1024,
          steps: scenario.steps,
          guidance: scenario.guidance,
          seed: 20260905,
          quantization: 'none',
        },
        savedInstance: JSON.parse(savedInstance),
        task,
        output,
        decoded,
        checks: {
          parameterLocality: true,
          defaultsUnchanged: true,
          saveRefresh: true,
          collapsedExpandedExportParity: true,
          expandedContainment: true,
          frontendGeneration: true,
          userNodeSaveReinsertIsolation: Boolean(userNodeProof),
        },
        showcaseCandidate: true,
        approved: false,
        pageErrors: errors,
      },
      null,
      2,
    )}\n`,
  );
  expect(errors.filter((message) => !message.startsWith('ResizeObserver loop'))).toEqual([]);
  await writeFile(
    `${evidenceRoot}/PARAMETERS.md`,
    `# ${scenario.label}\n\nSaved workflow: ${workflowName}\n\nModel: ${scenario.repository}@${scenario.revision}\n\n1024×1024; ${scenario.steps} steps; guidance ${scenario.guidance}; fixed seed 20260905. BF16, model CPU offload, no quantization.\n\n${inputImage ? `Input: ${inputImage}\n\n` : ''}## Prompt\n\n${prompt}\n\n## Evidence\n\nPassed frontend insert/edit/expand/save/refresh/export parity/generate. See frontend-result.json and submitted-workflow.json for exact values and identity. Creator defaults were not changed.\n\nModel-card reference: ${modelCard}\n\nOutput is a review candidate, not approved publication.\n`,
  );
});

type QwenV2AdmissionExecution = {
  id: string;
  label: string;
  route?: 'multi-reference';
  repository: string;
  revision: string;
  values: Record<string, string | number | boolean | string[]>;
  displayType?: 'image' | 'image_collection';
  expectedMediaItems?: number;
};

const QWEN_V2_ADMISSION_EXECUTIONS: QwenV2AdmissionExecution[] = [
  {
    id: 'qwen-image-image-to-image',
    label: 'Qwen Image — Image To Image',
    repository: 'Qwen/Qwen-Image-2512',
    revision: QWEN_REVISION,
    values: {
      prompt: 'Technical persistence proof: render the room as a clean blue ceramic architectural model.',
      image: ['@data/images/qwen_inpaint_object_replace.reference_image_1.webp'],
      strength: 0.65,
      width: 256,
      height: 256,
      num_inference_steps: 2,
      seed: 52001,
    },
  },
  {
    id: 'qwen-image-inpaint',
    label: 'Qwen Image — Inpaint',
    repository: 'Qwen/Qwen-Image-2512',
    revision: QWEN_REVISION,
    values: {
      prompt: 'Technical persistence proof: replace only the masked box with a cobalt-blue ceramic vase.',
      image: ['@data/images/qwen_inpaint_object_replace.reference_image_1.webp'],
      mask_image: '@data/images/qwen_inpaint_object_replace.mask_image.png',
      strength: 0.8,
      width: 256,
      height: 256,
      num_inference_steps: 2,
      seed: 52002,
    },
  },
  {
    id: 'qwen-image-control',
    label: 'Qwen Image — Control Image',
    repository: 'Qwen/Qwen-Image-2512',
    revision: QWEN_REVISION,
    values: {
      prompt: 'A compact red retro control console following the supplied line layout, centered product view.',
      control_image: '@data/images/qwen_control_image_layout.control_image.png',
      controlnet_conditioning_scale: 0.9,
      control_guidance_start: 0.1,
      control_guidance_end: 0.85,
      width: 256,
      height: 256,
      num_inference_steps: 2,
      seed: 52003,
    },
  },
  {
    id: 'qwen-image-control-image-to-image',
    label: 'Qwen Image — Controlnet Image2Image',
    repository: 'Qwen/Qwen-Image-2512',
    revision: QWEN_REVISION,
    values: {
      prompt: 'Transform the room into a clean industrial studio while following the supplied console layout.',
      image: ['@data/images/qwen_inpaint_object_replace.reference_image_1.webp'],
      control_image: '@data/images/qwen_control_image_layout.control_image.png',
      strength: 0.65,
      controlnet_conditioning_scale: 0.9,
      control_guidance_start: 0.1,
      control_guidance_end: 0.85,
      width: 256,
      height: 256,
      num_inference_steps: 2,
      seed: 52004,
    },
  },
  {
    id: 'qwen-image-control-inpaint',
    label: 'Qwen Image — Controlnet Inpainting',
    repository: 'Qwen/Qwen-Image-2512',
    revision: QWEN_REVISION,
    values: {
      prompt: 'Replace only the masked box with a compact blue console following the supplied line layout.',
      image: ['@data/images/qwen_inpaint_object_replace.reference_image_1.webp'],
      mask_image: '@data/images/qwen_inpaint_object_replace.mask_image.png',
      control_image: '@data/images/qwen_control_image_layout.control_image.png',
      strength: 0.8,
      controlnet_conditioning_scale: 0.9,
      control_guidance_start: 0.1,
      control_guidance_end: 0.85,
      width: 256,
      height: 256,
      num_inference_steps: 2,
      seed: 52005,
    },
  },
  {
    id: 'qwen-image-edit',
    label: 'Qwen Image Edit — Edit Image',
    repository: 'Qwen/Qwen-Image-Edit',
    revision: 'ac7f9318f633fc4b5778c59367c8128225f1e3de',
    values: {
      prompt: 'Replace the black storage box with a glossy teal ceramic vase while preserving the room.',
      image: ['@data/images/qwen_inpaint_object_replace.reference_image_1.webp'],
      num_inference_steps: 2,
      seed: 52006,
    },
  },
  {
    id: 'qwen-image-edit-inpaint',
    label: 'Qwen Image Edit — Inpaint',
    repository: 'Qwen/Qwen-Image-Edit',
    revision: 'ac7f9318f633fc4b5778c59367c8128225f1e3de',
    values: {
      prompt: 'Replace only the masked black box with a red ceramic vase and preserve every unmasked detail.',
      image: ['@data/images/qwen_inpaint_object_replace.reference_image_1.webp'],
      mask_image: '@data/images/qwen_inpaint_object_replace.mask_image.png',
      strength: 0.8,
      num_inference_steps: 2,
      seed: 52007,
    },
  },
  {
    id: 'qwen-image-edit-plus-single',
    label: 'Qwen Image Edit Plus — Default',
    repository: 'Qwen/Qwen-Image-Edit-2511',
    revision: '6f3ccc0b56e431dc6a0c2b2039706d7d26f22cb9',
    values: {
      prompt: 'Replace the black storage box with a glossy turquoise ceramic vase while preserving the room.',
      image: ['@data/images/qwen_inpaint_object_replace.reference_image_1.webp'],
      num_inference_steps: 2,
      seed: 52008,
    },
  },
  {
    id: 'qwen-image-edit-plus-multi-reference',
    label: 'Qwen Image Edit Plus — Default',
    route: 'multi-reference',
    repository: 'Qwen/Qwen-Image-Edit-2511',
    revision: '6f3ccc0b56e431dc6a0c2b2039706d7d26f22cb9',
    values: {
      prompt: 'Place the brass observatory from the second reference on the wooden table in the first reference.',
      image: [
        '@data/images/qwen_inpaint_object_replace.reference_image_1.webp',
        '@data/qualification/local-review/hugging-face-clusters/diffusers-ernie-equivalent-cluster-output.webp',
      ],
      num_inference_steps: 2,
      seed: 52009,
    },
  },
  {
    id: 'qwen-image-layered',
    label: 'Qwen Image Layered — Layer Decomposition',
    repository: 'Qwen/Qwen-Image-Layered',
    revision: '8f0ca708dfff6ba1dd5f2d85d78f8c108a040bcf',
    values: {
      prompt: 'A yellow room with a wooden console, ceramic bowl, red cloth, basket, and black storage box.',
      image: ['@data/images/qwen_inpaint_object_replace.reference_image_1.webp'],
      layers: 2,
      resolution: 640,
      num_inference_steps: 2,
      seed: 52010,
    },
    displayType: 'image_collection',
    expectedMediaItems: 2,
  },
];

async function insertV2Admission(page: Page, scenario: QwenV2AdmissionExecution) {
  await waitForWorkspace(page);
  await chooseAdvancedWorkflow(page, true);
  await page.getByTestId('topbar-new-workflow').click();
  await chooseAdvancedWorkflow(page, true);
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  if (!(await group.isVisible({ timeout: 1_000 }).catch(() => false))) await page.getByTestId('left-tab-nodes').click();
  await expect(group).toBeVisible();
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
    await group.getByRole('button').first().click();
  }
  await page.getByLabel('Search nodes').fill(scenario.label);
  const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: scenario.label });
  const beforeIds = await page.evaluate(async () => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore
      .getState()
      .nodes.filter((node) => node.data.blockInstanceV2)
      .map((node) => node.id);
  });
  await row.click();
  const rootId = await expect
    .poll(
      () =>
        page.evaluate(async (existingIds) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          return (
            useFlowStore.getState().nodes.find((node) => node.data.blockInstanceV2 && !existingIds.includes(node.id))
              ?.id ?? null
          );
        }, beforeIds),
      { timeout: 180_000 },
    )
    .not.toBeNull()
    .then(() =>
      page.evaluate(async (existingIds) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        return useFlowStore
          .getState()
          .nodes.find((node) => node.data.blockInstanceV2 && !existingIds.includes(node.id))!.id;
      }, beforeIds),
    );
  const root = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
  await expect(root).toBeVisible();
  if (scenario.route === 'multi-reference') {
    const selector = root.getByTestId(`block-v2-route-select-${rootId}`);
    await selector.click();
    await page.getByRole('option', { name: 'Qwen Image Edit Plus — Multi-reference', exact: true }).click();
    await expect(selector).toContainText('Qwen Image Edit Plus — Multi-reference', { timeout: 180_000 });
  }
  return { rootId, root };
}

test('remaining Qwen V2 admissions persist edited inputs and execute through the visible frontend', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_QWEN_V2_ADMISSION_EXECUTIONS !== '1',
    'Select the remaining exact Qwen V2 frontend execution wave explicitly.',
  );
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!outputDirectory, 'MODIFF_REVIEW_OUTPUT_DIR is required so no generated proof is lost.');
  test.setTimeout(10 * 60 * 60 * 1000);
  page.setDefaultTimeout(60_000);
  const evidenceRoot = `${outputDirectory}/qwen-v2-admission-executions`;
  await mkdir(evidenceRoot, { recursive: true });
  const startAt = Number(process.env.MODIFF_QWEN_V2_EXECUTION_START_AT ?? 0);
  const limit = Number(process.env.MODIFF_QWEN_V2_EXECUTION_LIMIT ?? QWEN_V2_ADMISSION_EXECUTIONS.length);
  const scenarios = QWEN_V2_ADMISSION_EXECUTIONS.slice(Number.isInteger(startAt) && startAt >= 0 ? startAt : 0).slice(
    0,
    Number.isInteger(limit) && limit > 0 ? limit : QWEN_V2_ADMISSION_EXECUTIONS.length,
  );
  const resultPath = `${evidenceRoot}/frontend-result.json`;
  let results: Array<Record<string, unknown>> = [];
  try {
    const previous = JSON.parse(await readFile(resultPath, 'utf8')) as { routes?: Array<Record<string, unknown>> };
    results = previous.routes ?? [];
  } catch {
    // A new isolated qualification directory has no incremental receipt yet.
  }

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('qwen-v2-admission-executions')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('qwen-v2-admission-executions', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await dismissRecoveredRunFailure(page);
  await chooseAdvancedWorkflow(page, true);
  await ensureExpertMode(page);
  await activateRequiredHuggingFaceRuntimeThroughSetup(page, evidenceRoot);

  for (const scenario of scenarios) {
    console.log(`[qwen-v2-execution] preparing ${scenario.id}`);
    const modelStatus = await page.request.get(
      `${LIVE_BACKEND_URL}/model_fingerprints?repo=${encodeURIComponent(scenario.repository)}`,
    );
    expect(modelStatus.ok()).toBe(true);
    const modelIdentity = selectInstalledModelIdentity(await modelStatus.json(), scenario.repository);
    expect(modelIdentity).toMatchObject({
      repoId: scenario.repository,
      selectedRevision: scenario.revision,
      modelRevision: `${scenario.repository}@${scenario.revision}`,
    });

    const { rootId, root } = await insertV2Admission(page, scenario);
    await page.evaluate(
      async ({ id, values }) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const flow = useFlowStore.getState();
        const instance = flow.nodes.find((node) => node.id === id)?.data.blockInstanceV2;
        if (!instance) throw new Error(`Missing Qwen V2 instance ${id}.`);
        const available = new Set([
          ...instance.effectiveInterface.boundary.inputs.map(({ portId }) => portId),
          ...instance.effectiveInterface.controls.map(({ controlId }) => controlId),
        ]);
        const missing = Object.keys(values).filter((key) => !available.has(key));
        if (missing.length) throw new Error(`Qwen V2 route does not expose required values: ${missing.join(', ')}.`);
        Object.entries(values).forEach(([logicalId, value]) => flow.setBlockInstanceValueV2(id, logicalId, value));
        for (const [logicalId, value] of [
          ['dtype', 'bfloat16'],
          ['autoOffload', true],
          ['offloadMode', 'model_cpu'],
        ] as const) {
          if (available.has(logicalId)) flow.setBlockInstanceValueV2(id, logicalId, value);
        }
      },
      { id: rootId, values: scenario.values },
    );
    const collapsedExport = await exportFromBlock(page, rootId);
    await root.getByTestId(`user-block-toggle-${rootId}`).click();
    await assertExpandedBlockContainsProjection(page, rootId);
    expect(await exportFromBlock(page, rootId)).toEqual(collapsedExport);
    await root.getByTestId(`user-block-toggle-${rootId}`).click();
    const beforeSave = (await blockSnapshot(page, rootId)).instanceJson;

    await page.getByTestId('topbar-save-workflow').click();
    const saveDialog = page.getByTestId('save-workflow-dialog');
    if (await saveDialog.isVisible()) {
      await page.getByTestId('save-workflow-name').fill(`Qwen V2 Execution ${scenario.id} ${Date.now()}`);
      await page.getByTestId('confirm-save-workflow').click();
      await expect(saveDialog).toHaveCount(0);
    }
    await expect
      .poll(() =>
        page.evaluate(() => {
          const studio = window.__MODIFF_E2E__!.getState().studio;
          return studio.workflowTabs.find((tab: { id: string }) => tab.id === studio.activeWorkflowTabId)?.dirty;
        }),
      )
      .toBe(false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForWorkspace(page);
    await chooseAdvancedWorkflow(page);
    await ensureExpertMode(page);
    const restoredRoot = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
    await expect(restoredRoot).toBeVisible();
    expect((await blockSnapshot(page, rootId)).instanceJson).toBe(beforeSave);
    expect(await exportFromBlock(page, rootId)).toEqual(collapsedExport);
    await restoredRoot.getByTestId(`user-block-toggle-${rootId}`).click();
    await assertExpandedBlockContainsProjection(page, rootId);
    expect(await exportFromBlock(page, rootId)).toEqual(collapsedExport);
    await restoredRoot.getByTestId(`user-block-toggle-${rootId}`).click();

    await restoredRoot.locator('header').first().click();
    const submission = page.waitForResponse(
      (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
      { timeout: 120_000 },
    );
    await page.getByTestId('selection-toolbar-run-from-node').click();
    const blocked = page.getByRole('dialog', { name: 'Run blocked' });
    if (await blocked.isVisible({ timeout: 2_000 }).catch(() => false)) {
      throw new Error(`Qwen V2 ${scenario.id} was blocked by the frontend: ${(await blocked.textContent())?.trim()}`);
    }
    const response = await submission;
    if (!response.ok()) throw new Error(`Qwen V2 ${scenario.id} submission failed: ${await response.text()}`);
    const submittedGraph = response.request().postDataJSON() as ExecutionExport;
    expect(Object.keys(submittedGraph.nodes)).not.toContain(rootId);
    expect(JSON.stringify(submittedGraph.nodes)).not.toContain('blockInstanceV2');
    const taskId = ((await response.json()) as { task_id?: string }).task_id;
    expect(taskId).toBeTruthy();
    const task = await waitForTask(page, taskId!, 90 * 60 * 1000);
    const displayType = scenario.displayType ?? 'image';
    await expect
      .poll(() => findLiveStudioOutput(page, taskId!, displayType), {
        timeout: 120_000,
        intervals: [500, 1000, 2000],
      })
      .toMatchObject({ taskId, displayType });
    const output = await findLiveStudioOutput(page, taskId!, displayType);
    if (!output) throw new Error(`Qwen V2 ${scenario.id} completed without a ${displayType} output.`);
    if (scenario.expectedMediaItems !== undefined) expect(output.mediaItems).toHaveLength(scenario.expectedMediaItems);
    const urls = output.mediaItems?.length
      ? output.mediaItems.flatMap((item) => (typeof item.url === 'string' && item.url ? [item.url] : []))
      : typeof output.url === 'string' && output.url
        ? [output.url]
        : [];
    expect(urls.length).toBeGreaterThan(0);
    const outputFiles: string[] = [];
    for (const [index, url] of urls.entries()) {
      const asset = await page.request.get(new URL(url, LIVE_BACKEND_URL).toString());
      expect(asset.ok()).toBe(true);
      const filename = `${scenario.id}${urls.length > 1 ? `-${index + 1}` : ''}.webp`;
      await writeFile(`${evidenceRoot}/${filename}`, await asset.body());
      outputFiles.push(filename);
    }
    results = results.filter((candidate) => candidate.id !== scenario.id);
    results.push({
      id: scenario.id,
      label: scenario.label,
      repository: scenario.repository,
      revision: scenario.revision,
      values: scenario.values,
      rootId,
      definitionId: (await blockSnapshot(page, rootId)).definitionId,
      saveRefreshByteIdentical: true,
      collapsedExpandedExecutionEquivalent: true,
      task,
      taskId,
      output: { displayType, mediaHash: output.mediaHash, files: outputFiles },
    });
    await writeFile(resultPath, `${JSON.stringify({ schemaVersion: 1, routes: results }, null, 2)}\n`, 'utf8');
    console.log(`[qwen-v2-execution] completed ${scenario.id} as task ${taskId}`);
  }
});

type MiniMaxRegisteredRuntimeExpectation = {
  form: Record<string, unknown>;
  routeBinding: Record<string, unknown>;
  runtimeHints: Record<string, unknown>;
  targetNodeId: string | null;
};

async function miniMaxRegisteredRuntimeExpectation(
  page: Page,
  instanceId: string,
): Promise<MiniMaxRegisteredRuntimeExpectation> {
  return page.evaluate(async (rootId) => {
    const [
      { useFlowStore, resolveFlowExecutionTargetNodeId },
      { useHuggingFaceNodeLibraryStore },
      { useNodesStore },
      { registeredBlockRunFormV2 },
      { registeredBlockResourceRouteBindingV2 },
      { registeredBlockExpertRuntimeHintsV2 },
    ] = await Promise.all([
      import('/src/stores/useFlowStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
      import('/src/stores/useNodeStore.ts'),
      import('/src/studio/blockRunFormV2.ts'),
      import('/src/studio/blockResourceRouteBindingV2.ts'),
      import('/src/studio/blockRuntimeHintsV2.ts'),
    ]);
    const flow = useFlowStore.getState();
    const root = flow.nodes.find((node) => node.id === rootId);
    if (!root?.data.blockInstanceV2) throw new Error(`MiniMax Block V2 root ${rootId} is unavailable.`);
    const projection = registeredBlockRunFormV2(root.data.blockInstanceV2, 'expert');
    if (!projection) throw new Error(`MiniMax Block V2 root ${rootId} has no exact registered route.`);
    const admissions = (useHuggingFaceNodeLibraryStore.getState().library?.definitions ?? []).flatMap(
      (definition) => definition.executionAdmissions,
    );
    const matchingAdmissions = admissions.filter((admission) => admission.id === projection.route.admissionId);
    if (matchingAdmissions.length !== 1) {
      throw new Error(
        `Expected one MiniMax admission for ${projection.route.admissionId}, found ${matchingAdmissions.length}.`,
      );
    }
    const admission = matchingAdmissions[0]!;
    const routeBinding = await registeredBlockResourceRouteBindingV2(
      projection.instance,
      projection.route,
      admission.modelDependencies,
    );
    if (!routeBinding) throw new Error(`MiniMax Block V2 root ${rootId} has no immutable route binding.`);
    const nodeState = useNodesStore.getState();
    const runtimeHints = registeredBlockExpertRuntimeHintsV2(
      {
        form: projection.form,
        instanceLabel: projection.instance.definitionSnapshot.displayName,
        route: projection.route,
        admission,
        routeBinding,
      },
      nodeState.studioModelCapabilities,
      {
        authoritative: nodeState.studioModelCapabilitiesAuthoritative,
        executionSpecInvalid: nodeState.studioExecutionSpecInvalid,
      },
    );
    if (!runtimeHints) throw new Error(`MiniMax Block V2 root ${rootId} has no exact Expert runtime hints.`);
    return JSON.parse(
      JSON.stringify({
        form: projection.form,
        routeBinding,
        runtimeHints,
        targetNodeId: resolveFlowExecutionTargetNodeId(flow.nodes, rootId) ?? null,
      }),
    ) as MiniMaxRegisteredRuntimeExpectation;
  }, instanceId);
}

function withoutMiniMaxCorrelationHints(runtimeHints: Record<string, unknown>) {
  const omitted = new Set<string>(MINIMAX_RUN_CORRELATION_HINT_KEYS);
  return Object.fromEntries(Object.entries(runtimeHints).filter(([key]) => !omitted.has(key)));
}

test('exact MiniMax Music 3 catalog drag is one durable V2 Block and runs persisted audio controls', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_MINIMAX_MUSIC3_V2_CONTRACT !== '1',
    'Select the installed MiniMax Music 3 Block V2 contract explicitly.',
  );
  test.skip(
    process.env.MODIFF_ACKNOWLEDGE_MINIMAX_MUSIC3_LICENSE !== '1',
    "The exact MiniMax Music 3 revision requires the user's revision-bound license acknowledgement.",
  );
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!outputDirectory, 'MODIFF_REVIEW_OUTPUT_DIR is required so the live proof is preserved for review.');
  test.setTimeout(6 * 60 * 60 * 1000);
  page.setDefaultTimeout(30_000);

  const evidenceRoot = `${outputDirectory}/minimax-music3-block-v2-live`;
  await mkdir(evidenceRoot, { recursive: true });
  const backendRoot = process.env.MODIFF_BACKEND_DIR
    ? resolve(process.env.MODIFF_BACKEND_DIR)
    : resolve(process.cwd(), '..', 'MoDiff');
  const backendSourceBefore = backendSourceIdentity(backendRoot);
  const pageErrors: string[] = [];
  const reactFlowHandleWarnings: string[] = [];
  const websocketEvents: Array<Record<string, unknown>> = [];
  const browserConsole: Array<{ type: string; text: string; at: number }> = [];
  const fieldActionNetwork: Array<{
    phase: 'request' | 'response' | 'failed';
    at: number;
    status?: number;
    payload?: unknown;
    failure?: string | null;
  }> = [];
  let userNodeWriteRequests = 0;
  let autoAuthorityRequests = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (text.includes("[React Flow]: Couldn't create edge for")) reactFlowHandleWarnings.push(text);
    if (message.type() === 'error' || message.type() === 'warning' || text.includes('[registered-block-v2-compiler]')) {
      browserConsole.push({ type: message.type(), text, at: Date.now() });
    }
  });
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/fields/action' && request.method() === 'POST') {
      let payload: unknown;
      try {
        payload = request.postDataJSON();
      } catch {
        payload = request.postData();
      }
      fieldActionNetwork.push({ phase: 'request', at: Date.now(), payload });
    }
    if (pathname === '/huggingface/cluster/auto-authority' && request.method() === 'POST') {
      autoAuthorityRequests += 1;
    }
    if (request.method() === 'GET') return;
    if (pathname === '/studio/blocks' || pathname.startsWith('/studio/blocks/')) userNodeWriteRequests += 1;
  });
  page.on('response', (response) => {
    if (new URL(response.url()).pathname !== '/fields/action') return;
    fieldActionNetwork.push({ phase: 'response', at: Date.now(), status: response.status() });
  });
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname !== '/fields/action') return;
    fieldActionNetwork.push({ phase: 'failed', at: Date.now(), failure: request.failure()?.errorText ?? null });
  });
  page.on('websocket', (websocket) => {
    websocket.on('framereceived', ({ payload }) => {
      try {
        websocketEvents.push(JSON.parse(String(payload)) as Record<string, unknown>);
      } catch {
        // Binary progress frames are not execution receipts.
      }
    });
  });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('minimax-music3-v2-live-contract')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('minimax-music3-v2-live-contract', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  await ensureExpertMode(page);
  await activateRequiredHuggingFaceRuntimeThroughSetup(page, evidenceRoot);
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  await ensureExpertMode(page);

  // Exercise the user-visible Model Manager even when the exact snapshot is
  // already cached. No direct downloader or filesystem shortcut is used.
  await page.getByTestId('topbar-models').click();
  const manager = page.getByTestId('model-manager-dialog');
  await expect(manager).toBeVisible();
  const managerRow = manager.getByTestId('model-manager-supported-MiniMaxMusic3ModularPipeline');
  await expect(managerRow).toBeVisible({ timeout: 60_000 });
  const install = managerRow.getByTestId('model-manager-install-MiniMaxMusic3ModularPipeline');
  await expect(install).toHaveText('Ready', { timeout: 120_000 });
  await manager.getByTestId('model-manager-close').click();

  await page.evaluate(async () => {
    const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
    ]);
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useNodesStore.getState().refreshModelIndexes(false),
      useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
    ]);
  });
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  await page.getByTestId('topbar-new-workflow').click();
  await waitForWorkspace(page);
  await chooseAdvancedWorkflow(page, true);
  await clearFinishedSessionActivity(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.waitForTimeout(2_000);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);

  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 60_000 });
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
    await group.getByRole('button').first().click();
  }
  await page.getByLabel('Search nodes').fill('Mini Max Music3 — Text To Audio');
  const row = group.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: 'Mini Max Music3' });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-readiness', 'graph_qualified');
  await expect(row).toHaveAttribute('draggable', 'true');
  await chooseAdvancedWorkflow(page);
  await page.getByLabel('Search nodes').fill('Mini Max Music3 — Text To Audio');
  await expect(row).toHaveCount(1);
  await expect(page.getByTestId('task-launcher')).toHaveCount(0);
  await expect(page.locator('.react-flow__pane')).toBeVisible();
  await page.evaluate(() => {
    const target = window as typeof window & {
      __MINIMAX_V2_DRAG_TRACE__?: Array<{ event: string; data: string; at: number }>;
    };
    target.__MINIMAX_V2_DRAG_TRACE__ = [];
    for (const eventName of ['dragstart', 'drop'] as const) {
      document.addEventListener(
        eventName,
        (event) => {
          const drag = event as DragEvent;
          target.__MINIMAX_V2_DRAG_TRACE__?.push({
            event: eventName,
            data: drag.dataTransfer?.getData('text/plain') ?? '',
            at: Date.now(),
          });
        },
        false,
      );
    }
  });
  console.log('[minimax-music3-v2-live] dragging exact registered catalog row into the empty graph');
  await row.dragTo(page.locator('.react-flow__pane'), {
    targetPosition: { x: 500, y: 180 },
    timeout: 30_000,
  });
  console.log('[minimax-music3-v2-live] browser drag/drop gesture completed; waiting at most 90 seconds for compiler');

  const root = page.locator('.react-flow__node-block').filter({ has: page.locator('[data-block-schema-version="2"]') });
  const insertionError = page
    .getByText(
      /The reviewed catalog graph did not finalize to its pinned BlockDefinitionV2|Error running node action|Could not add the Cluster Node|Cannot plan Diffusers Cluster Node field finalization/u,
    )
    .last();
  let insertionResult: 'inserted' | 'rejected' | 'timeout' = 'timeout';
  await expect
    .poll(
      async () => {
        if ((await root.count()) > 0) return 'inserted';
        if (await insertionError.isVisible().catch(() => false)) return 'rejected';
        return 'pending';
      },
      { timeout: 90_000, intervals: [100, 250, 500, 1000] },
    )
    .not.toBe('pending')
    .then(async () => {
      insertionResult = (await root.count()) > 0 ? 'inserted' : 'rejected';
    })
    .catch(() => {
      insertionResult = 'timeout';
    });
  const insertionDiagnostic = await page.evaluate(async () => {
    const [{ getRegisteredBlockV2CompilerDiagnostics }, { useFlowStore }, { useStudioStore }] = await Promise.all([
      import('/src/studio/huggingFaceClusterInsertion.ts'),
      import('/src/stores/useFlowStore.ts'),
      import('/src/stores/useStudioStore.ts'),
    ]);
    const flow = useFlowStore.getState();
    const studio = useStudioStore.getState();
    const dragTrace = (
      window as typeof window & {
        __MINIMAX_V2_DRAG_TRACE__?: Array<{ event: string; data: string; at: number }>;
      }
    ).__MINIMAX_V2_DRAG_TRACE__;
    return {
      capturedAt: Date.now(),
      dragTrace: dragTrace ?? [],
      compiler: getRegisteredBlockV2CompilerDiagnostics(),
      flow: {
        nodeCount: flow.nodes.length,
        edgeCount: flow.edges.length,
        nodes: flow.nodes.map((node) => ({
          id: node.id,
          type: node.data.type,
          module: node.data.module,
          action: node.data.action,
          hidden: node.hidden ?? false,
          blockSchemaVersion: node.data.blockInstanceV2?.schemaVersion ?? null,
          compilationSession: node.data.blockCompilationTransientV2 ?? null,
          dynamicFields: Object.entries(node.data.params)
            .filter(([, param]) => param.onChange !== undefined || param.onSignal !== undefined)
            .map(([field, param]) => ({
              field,
              onChange: param.onChange !== undefined,
              onSignal: param.onSignal !== undefined,
              disabled: Boolean(param.disabled),
            })),
        })),
      },
      workflow: {
        activeWorkflowTabId: studio.activeWorkflowTabId,
        canvasEpoch: studio.workflowCanvasEpoch,
        formEpoch: studio.workflowFormEpoch,
      },
    };
  });
  await writeFile(
    `${evidenceRoot}/insertion-diagnostic.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        outcome: insertionResult,
        insertionError:
          insertionResult === 'rejected' ? ((await insertionError.textContent().catch(() => null)) ?? null) : null,
        ...insertionDiagnostic,
        fieldActionNetwork,
        browserConsole,
        pageErrors,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  if (insertionResult !== 'inserted') {
    const lastCompiler = insertionDiagnostic.compiler.at(-1);
    const dragEvents = insertionDiagnostic.dragTrace
      .map(({ event, data }) => `${event}:${data || '<empty>'}`)
      .join(', ');
    throw new Error(
      `MiniMax Music 3 V2 insertion ${insertionResult} after a bounded 90-second wait. ` +
        `Drag trace: ${dragEvents || 'none'}. ` +
        `Compiler: ${lastCompiler ? `${lastCompiler.stage} after ${lastCompiler.elapsedMs}ms; ${lastCompiler.error ?? 'no error'}` : 'not started'}. ` +
        `Field actions: ${fieldActionNetwork.length}. See ${evidenceRoot}/insertion-diagnostic.json.`,
    );
  }
  await expect(root).toHaveCount(1);
  await expect(page.locator('[data-cluster-role]')).toHaveCount(0);
  console.log('[minimax-music3-v2-live] inserted exact registered V2 root');
  const rootId = await root.getAttribute('data-id');
  expect(rootId).toBeTruthy();
  await expect(root.getByTestId(`user-block-${rootId!}`)).toHaveAttribute('data-block-source', 'diffusers_catalog');
  await expect(root.getByLabel('prompt', { exact: true })).toHaveValue(MINIMAX_MUSIC3_CREATOR_PROMPT);
  await expect(root.getByTestId(`node-handle-${rootId!}-prompt`)).toBeVisible();
  await expect(root.getByTestId(`node-handle-${rootId!}-lyrics`)).toBeVisible();
  await expect(root.getByTestId(`node-handle-${rootId!}-audios`)).toBeVisible();

  const defaults = await blockSnapshot(page, rootId!);
  expect(defaults).toMatchObject({
    definitionId: MINIMAX_MUSIC3_DEFINITION_ID,
    manifestDefinitionId: MINIMAX_MUSIC3_MANIFEST_DEFINITION_ID,
    sourceKind: 'diffusers_catalog',
    repository: MINIMAX_MUSIC3_REPOSITORY,
    repositoryRevision: MINIMAX_MUSIC3_REVISION,
  });
  expect(defaults.values).toMatchObject({
    prompt: MINIMAX_MUSIC3_CREATOR_PROMPT,
    audio_duration: 60,
    num_inference_steps: 30,
  });

  await fillBlockValueAndAssert(
    page,
    rootId!,
    root.getByLabel('prompt', { exact: true }),
    'prompt',
    MINIMAX_MUSIC3_PROOF_PROMPT,
    MINIMAX_MUSIC3_PROOF_PROMPT,
  );
  await fillBlockValueAndAssert(
    page,
    rootId!,
    root.getByLabel('lyrics', { exact: true }),
    'lyrics',
    MINIMAX_MUSIC3_PROOF_LYRICS,
    MINIMAX_MUSIC3_PROOF_LYRICS,
  );
  await fillBlockValueAndAssert(
    page,
    rootId!,
    root.getByLabel('audio duration', { exact: true }),
    'audio_duration',
    '2.0',
    '2.0',
  );
  await fillBlockValueAndAssert(
    page,
    rootId!,
    root.getByLabel('num inference steps', { exact: true }),
    'num_inference_steps',
    '2',
    '2',
  );
  const editedBeforeRefresh = await blockSnapshot(page, rootId!);
  expect(editedBeforeRefresh.values).toMatchObject({
    prompt: MINIMAX_MUSIC3_PROOF_PROMPT,
    lyrics: MINIMAX_MUSIC3_PROOF_LYRICS,
    audio_duration: '2.0',
    num_inference_steps: '2',
  });
  const collapsedExport = await exportFromBlock(page, rootId!);
  expect(Object.keys(collapsedExport.nodes)).toHaveLength(5);
  expect(Object.keys(collapsedExport.nodes)).not.toContain(rootId);
  expect(JSON.stringify(collapsedExport.nodes)).not.toContain('blockInstanceV2');

  await root.getByTestId(`user-block-toggle-${rootId!}`).click();
  await expect(root.getByTestId(`user-block-toggle-${rootId!}`)).toHaveAccessibleName('Collapse block');
  await expect
    .poll(async () => {
      const snapshot = await blockSnapshot(page, rootId!);
      return { nodes: snapshot.projectionNodes.length, edges: snapshot.projectionEdgeCount };
    })
    .toEqual({ nodes: 5, edges: 6 });
  expect(await exportFromBlock(page, rootId!)).toEqual(collapsedExport);
  const expandedSnapshot = await blockSnapshot(page, rootId!);
  // The expanded MiniMax graph is wider than a typical test viewport. Move a
  // genuinely visible child header rather than synthesizing a store update or
  // starting a mouse gesture outside the viewport.
  const viewport = page.viewportSize();
  let movedSemanticNodeId = '';
  let dragBounds: Awaited<ReturnType<Locator['boundingBox']>> = null;
  for (const projection of expandedSnapshot.projectionNodes) {
    const candidateBounds = await page
      .locator(`.react-flow__node[data-id="${projection.id}"]`)
      .locator('header')
      .first()
      .boundingBox();
    if (
      candidateBounds &&
      viewport &&
      candidateBounds.x >= 0 &&
      candidateBounds.y >= 0 &&
      candidateBounds.x + 96 < viewport.width &&
      candidateBounds.y + 24 < viewport.height
    ) {
      movedSemanticNodeId = projection.semanticNodeId;
      dragBounds = candidateBounds;
      break;
    }
  }
  expect(movedSemanticNodeId).not.toBe('');
  expect(dragBounds).toBeTruthy();
  const dragStart = { x: dragBounds!.x + 80, y: dragBounds!.y + 18 };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x - 48, dragStart.y + 30, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await blockSnapshot(page, rootId!)).internalLayout[movedSemanticNodeId])
    .not.toEqual(expandedSnapshot.internalLayout[movedSemanticNodeId]);
  const movedInternalLayout = (await blockSnapshot(page, rootId!)).internalLayout[movedSemanticNodeId];
  expect(await exportFromBlock(page, rootId!)).toEqual(collapsedExport);
  await root.getByTestId(`user-block-toggle-${rootId!}`).click();

  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill(`MiniMax Music 3 Block V2 Live ${Date.now()}`);
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  await writeFile(
    `${evidenceRoot}/before-refresh.json`,
    `${JSON.stringify({ schemaVersion: 1, defaults, edited: editedBeforeRefresh, executionExport: collapsedExport }, null, 2)}\n`,
    'utf8',
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  await ensureExpertMode(page);
  await clearFinishedSessionActivity(page);
  const restoredRoot = page.locator(`.react-flow__node-block[data-id="${rootId!}"]`);
  await expect(restoredRoot).toHaveCount(1);
  await expect(restoredRoot.getByLabel('prompt', { exact: true })).toHaveValue(MINIMAX_MUSIC3_PROOF_PROMPT);
  await expect(restoredRoot.getByLabel('lyrics', { exact: true })).toHaveValue(MINIMAX_MUSIC3_PROOF_LYRICS);
  await expect(restoredRoot.getByLabel('audio duration', { exact: true })).toHaveValue('2.0');
  await expect(restoredRoot.getByLabel('num inference steps', { exact: true })).toHaveValue('2');
  const restored = await blockSnapshot(page, rootId!);
  expect(restored.values).toEqual(editedBeforeRefresh.values);
  expect(restored.internalLayout[movedSemanticNodeId]).toEqual(movedInternalLayout);
  expect(await exportFromBlock(page, rootId!)).toEqual(collapsedExport);
  await restoredRoot.getByTestId(`user-block-toggle-${rootId!}`).click();
  await expect
    .poll(async () => {
      const snapshot = await blockSnapshot(page, rootId!);
      return { nodes: snapshot.projectionNodes.length, edges: snapshot.projectionEdgeCount };
    })
    .toEqual({ nodes: 5, edges: 6 });
  expect(await exportFromBlock(page, rootId!)).toEqual(collapsedExport);
  await restoredRoot.getByTestId(`user-block-toggle-${rootId!}`).click();
  console.log('[minimax-music3-v2-live] save/refresh and collapsed/expanded parity verified');

  const runtimeExpectation = await miniMaxRegisteredRuntimeExpectation(page, rootId!);
  expect(runtimeExpectation.routeBinding).toEqual(MINIMAX_MUSIC3_ROUTE_BINDING);
  expect(runtimeExpectation.targetNodeId).toBeTruthy();
  expect(runtimeExpectation.form).toMatchObject({
    modelType: 'MiniMaxMusic3ModularPipeline',
    mode: 'text_to_audio',
    prompt: MINIMAX_MUSIC3_PROOF_PROMPT,
    lyrics: MINIMAX_MUSIC3_PROOF_LYRICS,
    audioDuration: 2,
    steps: 2,
    seed: 42,
    dtype: 'bfloat16',
    resourceMode: 'expert',
    quantizationMode: 'none',
    autoOffload: true,
    offloadMode: 'model_cpu',
  });
  expect(runtimeExpectation.runtimeHints).toMatchObject({
    source: 'hugging-face-cluster',
    device: 'cuda:0',
    modelType: 'MiniMaxMusic3ModularPipeline',
    mode: 'text_to_audio',
    modelRepo: MINIMAX_MUSIC3_REPOSITORY,
    resolvedModelRepo: MINIMAX_MUSIC3_REPOSITORY,
    resolvedArtifact: MINIMAX_MUSIC3_REPOSITORY,
    modelDependencies: [],
    loaderModule: 'modules.ModularDiffusers',
    loaderAction: 'ModelsLoader',
    executionPath: 'modular-diffusers',
    pipelineClass: 'MiniMaxMusic3ModularPipeline',
    dtype: 'bfloat16',
    resourceMode: 'expert',
    resolvedResourceMode: 'expert',
    quantizationMode: 'none',
    quantizedComponents: [],
    autoOffload: true,
    offloadMode: 'model_cpu',
    supportedOffloadModes: ['none', 'model_cpu', 'group_cpu', 'group_disk'],
    resourceRetryModes: ['group_cpu', 'group_disk'],
    compatibilityStatus: 'expert',
  });
  expect(Object.hasOwn(runtimeExpectation.runtimeHints, 'attentionBackend')).toBe(false);
  expect(runtimeExpectation.runtimeHints.optimizationQualificationForm).toEqual(runtimeExpectation.form);

  await restoredRoot.locator('header').first().click();
  await expect(page.getByTestId('topbar-auto-switch')).toHaveAttribute('aria-checked', 'false');
  const preSubmissionControl = await waitForResponsiveLiveControlPlane(page);
  await writeFile(
    `${evidenceRoot}/pre-submission-control.json`,
    `${JSON.stringify({ schemaVersion: 1, observations: preSubmissionControl }, null, 2)}\n`,
    'utf8',
  );
  console.log('[minimax-music3-v2-live] control plane is stable and submission is ready');
  const preSubmissionHoldMs = Number(process.env.MODIFF_V2_PRE_SUBMISSION_HOLD_MS ?? 0);
  if (Number.isFinite(preSubmissionHoldMs) && preSubmissionHoldMs > 0) {
    await page.waitForTimeout(Math.min(preSubmissionHoldMs, 60_000));
  }
  console.log('[minimax-music3-v2-live] submitting edited V2 graph through the frontend');
  const submission = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByTestId('selection-toolbar-run-from-node').click();
  const runTerms = page.getByTestId('model-usage-terms-dialog');
  if (await runTerms.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await page.getByTestId('model-usage-terms-confirm').click();
  }
  const response = await submission;
  if (!response.ok()) {
    throw new Error(`MiniMax Music 3 V2 graph submission failed (${response.status()}): ${await response.text()}`);
  }
  await expect(page.getByRole('dialog', { name: 'Run blocked' })).toHaveCount(0);
  const submittedGraph = response.request().postDataJSON() as ExecutionExport;
  expect(autoAuthorityRequests).toBe(0);
  expect(await page.evaluate(() => window.__MODIFF_E2E__!.getState().studio.form.resourceMode)).toBe('expert');
  expect(Object.keys(submittedGraph.nodes)).toHaveLength(5);
  expect(Object.keys(submittedGraph.nodes)).not.toContain(rootId);
  const submittedJson = JSON.stringify(submittedGraph.nodes);
  expect(submittedJson).not.toContain('blockInstanceV2');
  expect(submittedJson).not.toContain('huggingFaceCluster');
  expect(submittedJson).toContain(MINIMAX_MUSIC3_PROOF_PROMPT);
  expect(submittedJson).toContain(MINIMAX_MUSIC3_REPOSITORY);
  expect(submittedJson).toContain(MINIMAX_MUSIC3_REVISION);
  const submittedSemanticGenerator = Object.values(submittedGraph.nodes).find(
    (node) => node.action === 'WorkflowSemanticGeneration',
  );
  expect(submittedSemanticGenerator?.params.lyrics?.value).toBe(MINIMAX_MUSIC3_PROOF_LYRICS);
  expect(submittedSemanticGenerator?.params.prompt?.value).toBe(MINIMAX_MUSIC3_PROOF_PROMPT);
  const submittedLoader = Object.values(submittedGraph.nodes).find(
    (node) => node.module === 'modules.ModularDiffusers' && node.action === 'ModelsLoader',
  );
  expect(submittedLoader?.params).toMatchObject({
    auto_offload: { value: true },
    dtype: { value: 'bfloat16' },
    offload_mode: { value: 'model_cpu' },
    repo_id: { value: { source: 'hub', value: MINIMAX_MUSIC3_REPOSITORY } },
    revision: { value: MINIMAX_MUSIC3_REVISION },
    trust_remote_code: { value: false },
  });
  expect((submittedLoader?.params?.quant_config as { value?: unknown } | undefined)?.value).toBeUndefined();
  expect(submittedGraph.provenance?.registeredBlockV2RouteBinding).toEqual(MINIMAX_MUSIC3_ROUTE_BINDING);
  const submittedRuntimeHints = submittedGraph.runtimeHints ?? {};
  expect(withoutMiniMaxCorrelationHints(submittedRuntimeHints)).toEqual(runtimeExpectation.runtimeHints);
  expect(submittedRuntimeHints.optimizationQualificationForm).toEqual(runtimeExpectation.form);
  expect(submittedRuntimeHints).toMatchObject({
    clientRunId: expect.any(String),
    runInputHash: expect.any(String),
    workflowTabId: expect.any(String),
    workflowCanvasEpoch: expect.any(Number),
    workflowTitle: expect.any(String),
    workflowSnapshot: { studioForm: runtimeExpectation.form },
    nodeId: runtimeExpectation.targetNodeId,
  });
  expect(
    Object.keys(submittedRuntimeHints)
      .filter((key) => !Object.hasOwn(runtimeExpectation.runtimeHints, key))
      .sort(),
  ).toEqual([...MINIMAX_RUN_CORRELATION_HINT_KEYS].sort());

  const { task_id: taskId } = (await response.json()) as { task_id?: string };
  expect(taskId).toBeTruthy();
  const task = await waitForTask(page, taskId!, 2 * 60 * 60 * 1000);
  await expect
    .poll(() => findLiveStudioOutput(page, taskId!, 'audio'), {
      timeout: 120_000,
      intervals: [500, 1000, 2000],
    })
    .toMatchObject({ taskId, displayType: 'audio' });
  const output = await findLiveStudioOutput(page, taskId!, 'audio');
  expect(output?.url).toBeTruthy();
  const assetResponse = await page.request.get(new URL(output!.url!, LIVE_BACKEND_URL).toString());
  expect(assetResponse.ok()).toBe(true);
  const outputFilename = 'minimax-music3-block-v2-technical-proof.wav';
  const assetBytes = await assetResponse.body();
  const assetSha256 = createHash('sha256').update(assetBytes).digest('hex');
  const submittedGraphSha256 = createHash('sha256').update(JSON.stringify(submittedGraph)).digest('hex');
  await writeFile(`${evidenceRoot}/${outputFilename}`, assetBytes);
  try {
    await page.screenshot({
      path: `${evidenceRoot}/frontend-after-run.png`,
      fullPage: false,
      timeout: 120_000,
    });
  } catch (error) {
    await writeFile(
      `${evidenceRoot}/frontend-screenshot-warning.txt`,
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      'utf8',
    );
  }

  await expect
    .poll(() => findDurableCompletionReceipt(page, taskId!, websocketEvents), {
      timeout: 30_000,
    })
    .toBeTruthy();
  const completionReceipt = (await findDurableCompletionReceipt(page, taskId!, websocketEvents))!;
  expect(completionReceipt.runtimeFingerprint).toBeTruthy();
  expect(completionReceipt.runtimeMeasurement).toBeTruthy();

  const nodesResponse = await page.request.get(`${LIVE_BACKEND_URL}/nodes`);
  expect(nodesResponse.ok()).toBe(true);
  const nodesPayload = (await nodesResponse.json()) as Record<string, unknown>;
  const modelResponse = await page.request.get(
    `${LIVE_BACKEND_URL}/model_fingerprints?repo=${encodeURIComponent(MINIMAX_MUSIC3_REPOSITORY)}`,
  );
  expect(modelResponse.ok()).toBe(true);
  const modelFingerprintPayload = (await modelResponse.json()) as Record<string, unknown>;
  const modelIdentity = selectInstalledModelIdentity(modelFingerprintPayload, MINIMAX_MUSIC3_REPOSITORY);
  expect(modelIdentity).toMatchObject({
    repoId: MINIMAX_MUSIC3_REPOSITORY,
    selectedRevision: MINIMAX_MUSIC3_REVISION,
    modelRevision: `${MINIMAX_MUSIC3_REPOSITORY}@${MINIMAX_MUSIC3_REVISION}`,
  });
  expect(modelIdentity?.fingerprint).toBeTruthy();
  if (!modelIdentity) {
    throw new Error(
      `The exact installed model fingerprint for ${MINIMAX_MUSIC3_REPOSITORY}@${MINIMAX_MUSIC3_REVISION} is absent.`,
    );
  }

  const decodedAudio = (await decodedMediaHash(`${evidenceRoot}/${outputFilename}`, 'audio')) as {
    sampleRate: number;
    sourceSampleRate: number;
    channels: number;
    durationSeconds: number;
    peakAmplitude: number;
    silenceRatio: number;
    clippedSampleRatio: number;
    hash: string;
  };
  expect(decodedAudio.sampleRate).toBe(48_000);
  expect(decodedAudio.sourceSampleRate).toBe(44_100);
  expect(decodedAudio.channels).toBeGreaterThan(0);
  expect(decodedAudio.durationSeconds).toBeGreaterThan(1.5);
  expect(decodedAudio.durationSeconds).toBeLessThanOrEqual(2.5);
  expect(decodedAudio.peakAmplitude).toBeGreaterThan(0);
  expect(decodedAudio.silenceRatio).toBeLessThan(1);
  expect(decodedAudio.hash).toMatch(/^sha256:decoded-audio-pcm-s16le-48000-stereo:[a-f0-9]{64}$/u);
  const outputAnalysis = {
    ok: assetBytes.byteLength > 0,
    outputCount: 1,
    analyses: [
      {
        ...decodedAudio,
        mediaType: 'audio',
        byteSize: assetBytes.byteLength,
        encodedSha256: `sha256:encoded:${assetSha256}`,
        decodedSha256: decodedAudio.hash,
      },
    ],
  };
  expect(outputAnalysis).toMatchObject({ ok: true, outputCount: 1 });

  const backendSourceAfter = backendSourceIdentity(backendRoot);
  expect(backendSourceAfter.fingerprint).toBe(backendSourceBefore.fingerprint);
  const routeBinding = submittedGraph.provenance?.registeredBlockV2RouteBinding as Record<string, unknown>;
  const lockedSettings = restored.values;
  const promptSettingsHash = sha256Value('block-v2-workload-values-v1', lockedSettings);
  const catalogTemplateLockHash = MINIMAX_MUSIC3_ROUTE_BINDING.blockDefinition.canonicalSha256;
  const resolvedTemplateLockHash = sha256Value('block-v2-route-template-lock-v1', {
    routeBinding,
    modelRevision: modelIdentity.modelRevision,
    lockedSettings,
  });
  const runProvenance = createRunProvenance({
    templateId: MINIMAX_MUSIC3_DEFINITION_ID,
    lockedSettings,
    promptSettingsHash,
    catalogTemplateLockHash,
    resolvedTemplateLockHash,
    apiGraph: submittedGraph,
    nodesPayload,
    modelIdentity,
    modelIdentities: [modelIdentity],
    inputArtifacts: [],
    runtimeFingerprint: completionReceipt.runtimeFingerprint,
    deterministicMode: completionReceipt.deterministicMode ?? submittedGraph.deterministicMode,
    backendSource: backendSourceBefore,
    outputAnalysis,
    executedOutput: { ...output, apiGraphSnapshot: submittedGraph },
    executionReceipt: completionReceipt,
    taskId,
  });
  expect(runProvenance.schemaVersion).toBe(2);
  expect(runProvenance.routeBinding).toEqual(MINIMAX_MUSIC3_ROUTE_BINDING);
  expect(runProvenance.blockers).toEqual([]);
  await writeFile(`${evidenceRoot}/backend-source-before.json`, `${JSON.stringify(backendSourceBefore, null, 2)}\n`);
  await writeFile(`${evidenceRoot}/backend-source-after.json`, `${JSON.stringify(backendSourceAfter, null, 2)}\n`);
  await writeFile(`${evidenceRoot}/backend-nodes.json`, `${JSON.stringify(nodesPayload, null, 2)}\n`);
  await writeFile(
    `${evidenceRoot}/model-fingerprint.json`,
    `${JSON.stringify({ query: modelFingerprintPayload, selected: modelIdentity }, null, 2)}\n`,
  );
  await writeFile(`${evidenceRoot}/run-provenance.json`, `${JSON.stringify(runProvenance, null, 2)}\n`);
  await writeFile(
    `${evidenceRoot}/frontend-result.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        model: {
          repository: MINIMAX_MUSIC3_REPOSITORY,
          revision: MINIMAX_MUSIC3_REVISION,
          dtype: 'bfloat16',
          quantization: null,
          quantizedComponents: [],
          autoOffload: true,
          offloadMode: 'model_cpu',
          submittedLoaderParams: submittedLoader?.params,
        },
        definitionId: MINIMAX_MUSIC3_DEFINITION_ID,
        workflow: {
          instanceId: rootId,
          registeredDefaults: defaults.values,
          workflowOnlyOverrides: {
            prompt: MINIMAX_MUSIC3_PROOF_PROMPT,
            lyrics: MINIMAX_MUSIC3_PROOF_LYRICS,
            audio_duration: 2,
            num_inference_steps: 2,
          },
          valuesAfterRefresh: restored.values,
          internalLayoutPersisted: {
            semanticNodeId: movedSemanticNodeId,
            layout: restored.internalLayout[movedSemanticNodeId],
          },
          collapsedExpandedExecutionEquivalent: true,
        },
        submission: {
          taskId,
          nodeIds: Object.keys(submittedGraph.nodes),
          rootExcluded: !Object.hasOwn(submittedGraph.nodes, rootId!),
          legacyReceiptsExcluded: !submittedJson.includes('huggingFaceCluster'),
          routeBinding,
          runtimeHints: submittedGraph.runtimeHints,
        },
        task,
        graphCompleted: completionReceipt,
        output,
        decodedAudio,
        runProvenance: {
          proofLockHash: runProvenance.proofLockHash,
          routeBindingHash: runProvenance.routeBindingHash,
          graphHash: runProvenance.graphHash,
          modelSetHash: runProvenance.models.hash,
          runtimeFingerprint: runProvenance.runtimeFingerprint,
          decodedOutputHash: runProvenance.mediaHash,
          blockers: runProvenance.blockers,
        },
        outputFilename,
        assetSha256: `sha256:${assetSha256}`,
        submittedGraphSha256: `sha256:${submittedGraphSha256}`,
        qualificationOnly: true,
        showcaseApproved: false,
        userNodeWriteRequests,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await writeFile(
    `${evidenceRoot}/README.md`,
    `# MiniMax Music 3 current-V2 frontend proof\n\n` +
      `- Model: \`${MINIMAX_MUSIC3_REPOSITORY}@${MINIMAX_MUSIC3_REVISION}\`\n` +
      `- Registered definition: \`${MINIMAX_MUSIC3_DEFINITION_ID}\`\n` +
      `- Flow: drag into empty graph → edit workflow-local controls → Save → refresh → expand/collapse parity → Run from the visible frontend\n` +
      `- Registered defaults preserved: 60 seconds and 30 inference steps\n` +
      `- Workflow-only proof overrides: 2 seconds, 2 steps, seed unchanged\n` +
      `- Runtime: bfloat16, automatic model CPU offload\n` +
      `- Quantization: none (the submitted loader's quant_config has no value and the profile has no quantizable components)\n` +
      `- Generated asset: [${outputFilename}](./${outputFilename})\n` +
      `- Asset SHA-256: \`${assetSha256}\`\n` +
      `- Submitted graph SHA-256: \`${submittedGraphSha256}\`\n` +
      `- Qualification-only output; not a showcase/publication approval.\n`,
    'utf8',
  );

  expect(userNodeWriteRequests).toBe(0);
  expect(reactFlowHandleWarnings).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('one current exact Qwen V2 Block receives visible Auto authority without changing its values', async ({
  page,
}) => {
  test.skip(
    process.env.MODIFF_RUN_QWEN_V2_AUTO_CONTRACT !== '1',
    'Select the installed exact Qwen V2 Auto contract explicitly with MODIFF_RUN_QWEN_V2_AUTO_CONTRACT=1.',
  );
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!outputDirectory, 'MODIFF_REVIEW_OUTPUT_DIR is required so the live Auto proof is preserved.');
  test.setTimeout(30 * 60 * 1000);
  page.setDefaultTimeout(30_000);
  const evidenceRoot = `${outputDirectory}/qwen-image-2512-block-v2-auto-live`;
  await mkdir(evidenceRoot, { recursive: true });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('qwen-v2-auto-live-contract')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('qwen-v2-auto-live-contract', 'initialized');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  await ensureExpertMode(page);
  await activateQwenRuntimeThroughSetup(page, evidenceRoot);
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  await ensureExpertMode(page);

  await page.evaluate(async () => {
    const [{ useNodesStore }, { useHuggingFaceNodeLibraryStore }] = await Promise.all([
      import('/src/stores/useNodeStore.ts'),
      import('/src/stores/useHuggingFaceNodeLibraryStore.ts'),
    ]);
    await Promise.all([
      useNodesStore.getState().fetchStudioModelCapabilities(),
      useNodesStore.getState().refreshModelIndexes(false),
      useHuggingFaceNodeLibraryStore.getState().fetchLibrary(),
    ]);
  });
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  await page.getByTestId('topbar-new-workflow').click();
  await waitForWorkspace(page);
  await dismissTaskLauncher(page, true);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.getByTestId('left-tab-nodes').click();
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  await expect(group).toBeVisible({ timeout: 60_000 });
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') {
    await group.getByRole('button').first().click();
  }
  await page.getByLabel('Search nodes').fill('Qwen Image — Text To Image');
  const row = group
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image — Text To Image' });
  await expect(row).toHaveCount(1);
  await row.dragTo(page.locator('.react-flow__pane'), { targetPosition: { x: 520, y: 220 }, timeout: 30_000 });
  const root = page.locator('.react-flow__node-block').filter({ has: page.locator('[data-block-schema-version="2"]') });
  await expect(root).toHaveCount(1, { timeout: 180_000 });
  const rootId = await root.getAttribute('data-id');
  expect(rootId).toBeTruthy();
  await expect(page.locator('[data-cluster-role]')).toHaveCount(0);

  const eligibility = await page.evaluate(async () => {
    const [{ inspectRegisteredBlockAutoEligibilityV2 }, { canonicalBlockDefinitionV2 }, { useFlowStore }] =
      await Promise.all([
        import('/src/studio/blockAutoEligibilityV2.ts'),
        import('/src/studio/blockSchemaV2.ts'),
        import('/src/stores/useFlowStore.ts'),
      ]);
    const flow = useFlowStore.getState();
    const root = flow.nodes.find((node) => node.data.blockInstanceV2);
    return {
      inspection: inspectRegisteredBlockAutoEligibilityV2(flow.nodes, flow.edges),
      definitionContentHash: root?.data.blockInstanceV2?.definitionSnapshot.contentHash,
      definition: root?.data.blockInstanceV2
        ? canonicalBlockDefinitionV2(root.data.blockInstanceV2.definitionSnapshot)
        : null,
    };
  });
  await writeFile(`${evidenceRoot}/visible-definition.json`, `${JSON.stringify(eligibility, null, 2)}\n`, 'utf8');
  expect(eligibility).toMatchObject({
    inspection: { eligible: true, code: 'eligible', rootId },
    definitionContentHash: 'block-definition-v2-8425be7b',
  });

  const autoPrompt = 'A red cube beside a blue glass sphere, centered clean studio photograph.';
  await fillAndCommit(root.getByLabel('prompt', { exact: true }), autoPrompt);
  await fillAndCommit(root.getByLabel('width', { exact: true }), '256');
  await fillAndCommit(root.getByLabel('height', { exact: true }), '256');
  await fillAndCommit(root.getByLabel('num inference steps', { exact: true }), '2');
  const beforeAuto = await blockSnapshot(page, rootId!);
  expect(beforeAuto.values).toMatchObject({
    prompt: autoPrompt,
    width: '256',
    height: '256',
    num_inference_steps: '2',
  });
  const beforeValuesJson = JSON.stringify(beforeAuto.values);

  const autoSwitch = page.getByTestId('topbar-auto-switch');
  await expect(autoSwitch).toBeEnabled();
  await autoSwitch.click();
  await expect(autoSwitch).toHaveAttribute('aria-checked', 'true');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = window.__MODIFF_E2E__!.getState();
        return { viewMode: state.settings.studioViewMode, resourceMode: state.studio.form.resourceMode };
      }),
    )
    .toEqual({ viewMode: 'auto', resourceMode: 'auto' });

  const authorityResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/huggingface/cluster/auto-authority' &&
      response.request().method() === 'POST',
    { timeout: 180_000 },
  );
  const submissionPromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/graph' && response.request().method() === 'POST',
    { timeout: 180_000 },
  );
  const runButton = page.getByTestId('studio-run');
  await expect(runButton).toBeEnabled({ timeout: 120_000 });
  await runButton.click();
  const authorityResponse = await authorityResponsePromise;
  const authorityRequest = authorityResponse.request().postDataJSON() as {
    instance?: { instanceId?: string; values?: Record<string, unknown> };
    form?: Record<string, unknown>;
  };
  if (!authorityResponse.ok()) {
    throw new Error(`Qwen V2 Auto authority failed (${authorityResponse.status()}): ${await authorityResponse.text()}`);
  }
  expect(authorityRequest.instance).toMatchObject({ instanceId: rootId, values: beforeAuto.values });
  expect(authorityRequest.form).toMatchObject({
    modelType: 'QwenImageModularPipeline',
    mode: 'modular_text_to_image',
    resourceMode: 'auto',
    prompt: autoPrompt,
    width: 256,
    height: 256,
    steps: 2,
  });
  const authorityBody = (await authorityResponse.json()) as { error?: boolean; receipt?: Record<string, unknown> };
  expect(authorityBody).toMatchObject({
    error: false,
    receipt: { kind: 'auto', definitionId: QWEN_DEFINITION_ID, admissionId: QWEN_DEFINITION_ID },
  });

  const submissionResponse = await submissionPromise;
  if (!submissionResponse.ok()) {
    throw new Error(
      `Qwen V2 Auto graph submission failed (${submissionResponse.status()}): ${await submissionResponse.text()}`,
    );
  }
  const submittedGraph = submissionResponse.request().postDataJSON() as ExecutionExport;
  expect(Object.keys(submittedGraph.nodes)).toHaveLength(5);
  expect(Object.keys(submittedGraph.nodes)).not.toContain(rootId);
  expect(JSON.stringify(submittedGraph.nodes)).not.toContain('blockInstanceV2');
  const afterAuthority = await page.evaluate((instanceId) => {
    const root = window.__MODIFF_E2E__!.getState().flow.nodes.find((node) => node.id === instanceId);
    return {
      values: root?.blockInstanceV2?.values,
      autoReceipt: root?.blockInstanceV2?.authorities.find((receipt) => receipt.kind === 'auto'),
    };
  }, rootId!);
  expect(JSON.stringify(afterAuthority.values)).toBe(beforeValuesJson);
  expect(afterAuthority.autoReceipt).toMatchObject(authorityBody.receipt!);

  const submission = (await submissionResponse.json()) as { task_id?: string };
  expect(submission.task_id).toBeTruthy();
  const taskId = submission.task_id!;
  const task = await waitForTask(page, taskId);
  let output: Record<string, unknown> | null = null;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${LIVE_BACKEND_URL}/runs/${encodeURIComponent(taskId)}`);
        if (!response.ok()) return null;
        const body = (await response.json()) as { outputs?: Array<Record<string, unknown>> };
        output = body.outputs?.find((item) => item.taskId === taskId && item.displayType === 'image') ?? null;
        return output ? { taskId: output.taskId, displayType: output.displayType } : null;
      },
      { timeout: 120_000, intervals: [500, 1000, 2000] },
    )
    .toEqual({ taskId, displayType: 'image' });
  expect(output).toMatchObject({
    modelType: 'QwenImageModularPipeline',
    mode: 'modular_text_to_image',
    prompt: autoPrompt,
    width: 256,
    height: 256,
    steps: 2,
  });
  const outputUrl = typeof output?.url === 'string' ? output.url : '';
  expect(outputUrl).toBeTruthy();
  const assetResponse = await page.request.get(new URL(outputUrl, LIVE_BACKEND_URL).toString());
  expect(assetResponse.ok()).toBe(true);
  await writeFile(`${evidenceRoot}/qwen-block-v2-auto-live.webp`, await assetResponse.body());
  const readAfterRunBrowserState = () =>
    page.evaluate((instanceId) => {
      const state = window.__MODIFF_E2E__!.getState();
      const root = state.flow.nodes.find((node) => node.id === instanceId);
      const instance = root?.blockInstanceV2;
      return {
        values: instance?.values ?? null,
        preview: instance?.previewStates?.[0] ?? null,
        backendConnected: state.websocket.isConnected,
      };
    }, rootId!);
  await expect.poll(readAfterRunBrowserState, { timeout: 120_000, intervals: [500, 1000, 2000] }).toMatchObject({
    values: beforeAuto.values,
    preview: { status: 'complete', taskId },
  });
  const afterRunBrowserState = await readAfterRunBrowserState();
  await writeFile(
    `${evidenceRoot}/frontend-result.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        rootId,
        eligibility,
        beforeValues: beforeAuto.values,
        afterValues: afterAuthority.values,
        valuesByteIdentical: JSON.stringify(afterAuthority.values) === beforeValuesJson,
        authorityRequest,
        authorityReceipt: authorityBody.receipt,
        submittedNodeIds: Object.keys(submittedGraph.nodes),
        task,
        output,
        afterRunBrowserState,
        outputFilename: 'qwen-block-v2-auto-live.webp',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  // Screenshots are review evidence, not execution authority. On unified-
  // memory systems Chromium can miss its capture deadline immediately after
  // a large model run even though the in-page state and generated asset are
  // already verified above. Preserve that condition without turning a valid
  // frontend/backend lifecycle into a false execution failure.
  try {
    await page.screenshot({ path: `${evidenceRoot}/frontend-after-auto-run.png`, fullPage: false, timeout: 90_000 });
  } catch (error) {
    await writeFile(
      `${evidenceRoot}/frontend-after-auto-run-screenshot-error.txt`,
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      'utf8',
    );
  }
});
