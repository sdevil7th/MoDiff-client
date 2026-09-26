import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { outputNumericInputValue } from '../../../src/studio/resolvedExecutionInputs';

import {
  backendSourceIdentity,
  createRunProvenance,
  selectInstalledModelIdentity,
  sha256Value,
} from '../../../scripts/live-proof-provenance.mjs';
import { decodedMediaHash } from '../../../scripts/template-gallery-harness.mjs';
import { waitForRecursiveDomGeometry } from './blockDomGeometry';
import { decodedImageStatistics } from './imageProofStatistics';

const QWEN_MANIFEST_DEFINITION_ID = 'diffusers.modular:QwenImageModularPipeline:text2image';
const QWEN_DEFINITION_ID = 'diffusers.cluster-admission:QwenImageModularPipeline:text2image:mode:text_to_image';
const QWEN_REPOSITORY = 'Qwen/Qwen-Image-2512';
const QWEN_REVISION = '25468b98e3276ca6700de15c6628e51b7de54a26';
const QWEN_BLOCK_V2_CONTENT_HASH = 'block-definition-v2-af4d765b';
const QWEN_BLOCK_V2_CANONICAL_SHA256 = 'sha256:f3c85515a659cb3b72edfaff05cea98d589bafb8241fc2db161bbde340dd15b1';
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
  await waitForRecursiveDomGeometry(page);
  // Measure one coherent DOM frame. Sequential locator calls can straddle
  // many progress renders under GPU load and compare unrelated layout times.
  const { rootBounds, children } = await page.evaluate(async (id) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    const bounds = (nodeId: string) => {
      const rect = document
        .querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)
        ?.getBoundingClientRect();
      return rect && rect.width > 0 && rect.height > 0
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : null;
    };
    const children = useFlowStore
      .getState()
      .nodes.filter((node) => node.data.blockProjectionOwnerId === id)
      .map((node) => ({ id: node.id, bounds: bounds(node.id) }));
    return { rootBounds: bounds(id), children };
  }, rootId);
  expect(rootBounds).toBeTruthy();
  const childIds = children.map((child) => child.id);
  expect(childIds.length).toBeGreaterThan(0);

  const tolerance = 2;
  for (const { id: childId, bounds: childBounds } of children) {
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
  const auto = page.getByRole('radio', { name: 'Creator', exact: true });
  const deadline = Date.now() + 300_000;
  let lastError = '';
  while (Date.now() < deadline) {
    await waitForWorkspace(page, Math.max(1, deadline - Date.now()));
    await dismissTaskLauncher(page);
    if ((await auto.getAttribute('aria-checked')) === 'false') return;
    try {
      await page.getByRole('radio', { name: 'Developer', exact: true }).click({ timeout: 2_000 });
      await expect(auto).toHaveAttribute('aria-checked', 'false', { timeout: 2_000 });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await page.waitForTimeout(500);
    }
  }
  throw new Error(`Could not enter Developer workspace after startup recovery: ${lastError}`);
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

async function assertCapturedImageInGallery(
  page: Page,
  taskId: string,
  expected: { prompt: string; width: number; height: number; steps: number; guidanceScale?: number; seed: number },
  screenshot: string,
  dimensionsDerivedFromMedia = false,
) {
  // Production deliberately has no debug state bridge. Its native Gallery
  // assertions below still verify the captured inputs and exact task identity.
  if (await page.evaluate(() => Boolean(window.__MODIFF_E2E__)))
    await expect
      .poll(
        async () => {
          const item = await page.evaluate(
            (id) => window.__MODIFF_E2E__?.getState().studio.outputs.find((output) => output.taskId === id),
            taskId,
          );
          if (!item) return null;
          return {
            prompt: item.prompt,
            width: item.width,
            height: item.height,
            steps: item.steps,
            ...(outputNumericInputValue(item, 'guidanceScale') === undefined
              ? {}
              : { guidanceScale: outputNumericInputValue(item, 'guidanceScale') }),
            seed: item.seed,
          };
        },
        { timeout: 120_000 },
      )
      .toEqual(expected);
  await page.getByTestId('topbar-gallery').click();
  await page.getByTestId('gallery-view-grid').click();
  const card = page
    .locator('[data-testid^="gallery-output-"]')
    .filter({ hasText: `Task ${taskId}` })
    .first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByTestId('gallery-view-inspect').click();
  const inspector = page.getByTestId('gallery-inspect-view');
  await expect(inspector).toContainText(`Task ${taskId}`);
  await expect(inspector.getByTestId('resolved-inputs-status')).toContainText('captured by the backend');
  const metadata = JSON.parse((await inspector.locator('pre').textContent())!);
  expect(metadata).toMatchObject({
    seed: expected.seed,
    size: `${expected.width}x${expected.height}`,
    steps: expected.steps,
    guidanceScale: expected.guidanceScale ?? 'Not uniquely captured — see resolved inputs',
  });
  const { width, height, ...expectedInputs } = expected;
  expect(metadata.resolvedExecutionInputs).toMatchObject({
    taskId,
    summary: dimensionsDerivedFromMedia ? expectedInputs : { ...expectedInputs, width, height },
  });
  if (dimensionsDerivedFromMedia) {
    expect(metadata.resolvedExecutionInputs.summary).not.toHaveProperty('width');
    expect(metadata.resolvedExecutionInputs.summary).not.toHaveProperty('height');
    expect(metadata.resolvedInputDimensions).toEqual({
      width: 'Not uniquely captured — see resolved inputs',
      height: 'Not uniquely captured — see resolved inputs',
    });
  }
  if (expected.guidanceScale === undefined)
    expect(metadata.resolvedExecutionInputs.summary).not.toHaveProperty('guidanceScale');
  await inspector.locator('pre').scrollIntoViewIfNeeded();
  await page.screenshot({ path: screenshot, fullPage: false });
  await page.keyboard.press('Escape');
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

test('ordinary palette text inside a nested Qwen Block retains ownership, wiring, local interface and real execution', async ({
  page,
}) => {
  test.skip(process.env.MODIFF_RUN_NESTED_ORDINARY !== '1', 'Select the nested ordinary-node lifecycle explicitly.');
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!outputDirectory, 'An isolated review output directory is required.');
  const generate = process.env.MODIFF_RUN_NESTED_ORDINARY_GENERATION === '1';
  const switchModel = process.env.MODIFF_QWEN_NESTED_MODEL_VARIANT === 'base';
  const started = Date.now();
  const checkpoint = (label: string) => console.log(`[nested-ordinary] ${label}: ${Date.now() - started} ms`);
  test.setTimeout(generate ? 30 * 60 * 1000 : 180_000);
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const evidenceRoot = `${outputDirectory}/qwen-nested-ordinary-node`;
  await mkdir(evidenceRoot, { recursive: true });
  const errors: string[] = [];
  const handleWarnings: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.text().includes("[React Flow]: Couldn't create edge for")) handleWarnings.push(message.text());
  });
  const prompt =
    'A photorealistic architectural editorial photograph of a two-storey circular clockmaker workshop inside a restored Victorian railway signal tower at blue hour. The entire building fits comfortably in frame. Its wide open brass-framed doors reveal an orderly oak workbench holding a disassembled astronomical clock with intricate gears, engraved silver rings and sapphire bearings. Warm practical lamps illuminate the workshop; the upper floor contains neatly arranged old astronomical charts and a small telescope beside a tall arched window. A narrow wet cobblestone path curves through ferns toward the doorway, with subtle physically coherent amber reflections. A small cream enamel sign above the entrance clearly reads "TIME ATELIER". Deep indigo sky, restrained amber and teal palette, realistic weathered brick and polished brass, fine mechanical detail, coherent perspective, balanced composition, natural 35mm photography, no people, no duplicate buildings.';
  await page.addInitScript(() => {
    if (sessionStorage.getItem('nested-ordinary-live')) return;
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('nested-ordinary-live', '1');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await dismissRecoveredRunFailure(page);
  await dismissTaskLauncher(page);
  await ensureExpertMode(page);
  await page.getByTestId('topbar-new-workflow').click();
  await chooseAdvancedWorkflow(page, true);
  await clearFinishedSessionActivity(page);
  checkpoint('new empty workflow ready');
  await page.getByTestId('left-tab-nodes').click();
  const search = page.getByLabel('Search nodes');
  await search.fill('Qwen Image — Text To Image');
  const catalog = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  if ((await catalog.getByRole('button').first().getAttribute('aria-expanded')) !== 'true')
    await catalog.getByRole('button').first().click();
  await catalog
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image — Text To Image' })
    .click();
  const root = page.locator('.react-flow__node-block').filter({ has: page.locator('[data-block-schema-version="2"]') });
  await expect(root).toHaveCount(1, { timeout: 60_000 });
  const rootId = (await root.getAttribute('data-id'))!;
  const inspect = () =>
    page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      const instance = flow.nodes.find((n) => n.id === id)!.data.blockInstanceV2!;
      return {
        instance,
        projection: flow.nodes
          .filter((n) => n.data.blockProjectionOwnerId === id)
          .map((n) => ({
            id: n.id,
            parentId: n.parentId,
            semanticId: n.data.blockProjectionNodeId,
            bindings: n.data.blockProjectionPortBindings ?? {},
          })),
        orphanUtilities: flow.nodes.filter((n) => !n.data.blockProjectionOwnerId && n.data.action === 'TextValue')
          .length,
      };
    }, rootId);
  const baseline = (await inspect()).instance;
  checkpoint('Qwen inserted');
  // Only the added Text Value supplies a new prompt. All registered generation
  // defaults, negative prompt, model, precision and offload settings stay intact.
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  const encoder = () => page.locator('[data-block-semantic-node-id="container:text_encoder"]');
  await encoder().getByRole('button', { name: 'Expand Qwen Image Auto Text Encoder Step', exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  await search.fill('Text Value');
  checkpoint('encoder expanded');
  await expect(search).toHaveValue('Text Value');
  const ordinaryGroup = page.getByTestId('node-group-primitive');
  await expect(ordinaryGroup).toBeVisible();
  if ((await ordinaryGroup.getByRole('button').first().getAttribute('aria-expanded')) !== 'true')
    await ordinaryGroup.getByRole('button').first().click();
  // The expanded decorative frame is pointer-transparent. Its React Flow
  // wrapper is the actual canvas drop surface; do not force events through it.
  const encoderProjectionId = (await inspect()).projection.find((n) => n.semanticId === 'container:text_encoder')!.id;
  await page
    .getByTestId('node-row-modules-Primitive-TextValue')
    .dragTo(page.getByTestId(`rf__node-${encoderProjectionId}`), { targetPosition: { x: 8, y: 35 } });
  await expect
    .poll(
      async () => (await inspect()).instance.effectiveGraph.nodes.filter((n) => n.data.action === 'TextValue').length,
    )
    .toBe(1);
  let current = await inspect();
  checkpoint('ordinary palette node adopted');
  const utilityId = current.instance.effectiveGraph.nodes.find((n) => n.data.action === 'TextValue')!.nodeId;
  expect(current.instance.effectiveGraph.nodes.find((n) => n.nodeId === utilityId)).toMatchObject({
    parentNodeId: 'container:text_encoder',
  });
  expect(current.instance.effectiveGraph.nodes.find((n) => n.nodeId === utilityId)!.modularDiffusers).toBeUndefined();
  expect(current.orphanUtilities).toBe(0);
  expect(current.instance.values).toEqual(baseline.values);
  expect(current.instance.effectiveInterface).toEqual(baseline.effectiveInterface);
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await inspect()).instance.effectiveGraph.nodes.length)
    .toBe(baseline.effectiveGraph.nodes.length);
  await page.keyboard.press('Control+Shift+z');
  await expect
    .poll(async () => (await inspect()).instance.effectiveGraph.nodes.some((n) => n.nodeId === utilityId))
    .toBe(true);
  const utilityProjectionId = (await inspect()).projection.find((n) => n.semanticId === utilityId)!.id;
  const utility = () => page.locator(`.react-flow__node[data-id="${utilityProjectionId}"]`);
  await utility().getByLabel('Text', { exact: true }).fill(prompt);
  await utility().getByLabel('Text', { exact: true }).press('Tab');
  await expect
    .poll(
      async () =>
        (await inspect()).instance.effectiveGraph.nodes.find((n) => n.nodeId === utilityId)?.data.params?.text?.value,
    )
    .toBe(prompt);
  await page.getByTestId('arrange-graph').click();
  current = await inspect();
  const source = current.projection.find((n) => n.semanticId === utilityId)!;
  const target = current.projection.find((n) => n.semanticId === 'prompt')!;
  const sourceHandle = page.getByTestId(`node-handle-${source.id}-output`);
  const targetSocket = Object.entries(target.bindings).find(
    ([, binding]) => binding.nodeId === 'prompt' && binding.fieldOrPortId === 'prompt' && binding.direction === 'input',
  )?.[0];
  expect(targetSocket).toBeTruthy();
  const targetHandle = page.getByTestId(`node-handle-${target.id}-${targetSocket}`);
  const reachable = async (locator: Locator) =>
    locator.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y);
      if (!hit || (hit !== element && !element.contains(hit))) throw new Error('The nested wire endpoint is obscured.');
      return point;
    });
  await expect(sourceHandle).toBeVisible();
  await expect(targetHandle).toBeVisible();
  const from = await reachable(sourceHandle),
    to = await reachable(targetHandle);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 18 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      (await inspect()).instance.effectiveGraph.edges.some(
        (e) => e.sourceNodeId === utilityId && e.targetNodeId === 'prompt' && e.targetPortId === 'prompt',
      ),
    )
    .toBe(true);
  await encoder().getByRole('button', { name: 'Configure exposed inputs, outputs, and controls', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Configure Block interface', exact: true });
  await expect(dialog.getByTestId('block-interface-scope')).toBeVisible();
  await dialog
    .getByLabel('control prompt label', { exact: true })
    .fill('Fallback prompt (external Text Value takes priority)');
  await dialog.getByRole('button', { name: 'Apply interface', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const modified = (await inspect()).instance;
  checkpoint('wire and interface edited');
  expect(
    modified.effectiveGraph.nodes.find((n) => n.nodeId === 'container:text_encoder')?.containerInterface,
  ).toBeTruthy();
  expect(modified.definitionSnapshot).toEqual(baseline.definitionSnapshot);
  expect(modified.effectiveInterface).toEqual(baseline.effectiveInterface);
  expect(modified.values).toEqual(baseline.values);
  for (const node of baseline.effectiveGraph.nodes.filter((n) => n.nodeId !== 'container:text_encoder'))
    expect(modified.effectiveGraph.nodes.find((n) => n.nodeId === node.nodeId)).toEqual(node);
  const assertNestedGeometry = async () => {
    const nodes = (await inspect()).projection;
    await expect
      .poll(
        () =>
          page.evaluate(
            (projection) =>
              projection.flatMap((node) => {
                const child = document.querySelector<HTMLElement>(
                  `.react-flow__node[data-id="${CSS.escape(node.id)}"]`,
                );
                const parent = document.querySelector<HTMLElement>(
                  `.react-flow__node[data-id="${CSS.escape(node.parentId!)}"]`,
                );
                if (!child || !parent) return [`Missing visible node/parent for ${node.semanticId}`];
                const childBox = child.getBoundingClientRect(),
                  parentBox = parent.getBoundingClientRect();
                const frame = parent.querySelector<HTMLElement>(
                  `[data-testid="user-block-${CSS.escape(node.parentId!)}"]`,
                );
                const header = frame?.querySelector<HTMLElement>(':scope > header');
                const tray = frame?.querySelector<HTMLElement>(
                  `[data-testid="node-connector-tray-${CSS.escape(node.parentId!)}"]`,
                );
                const top = header?.getBoundingClientRect().bottom ?? parentBox.top;
                const bottom = tray?.getBoundingClientRect().top ?? parentBox.bottom;
                return childBox.left < parentBox.left - 2 ||
                  childBox.top < top - 2 ||
                  childBox.right > parentBox.right + 2 ||
                  childBox.bottom > bottom + 2
                  ? [`${node.semanticId} escapes the actual content area of ${node.parentId}`]
                  : [];
              }),
            nodes,
          ),
        { timeout: 15_000 },
      )
      .toEqual([]);
  };
  await assertExpandedBlockContainsProjection(page, rootId);
  await assertNestedGeometry();
  await page.screenshot({ path: `${evidenceRoot}/nested-text-wired.png`, fullPage: false });
  if (switchModel) {
    const beforeSwitch = (await inspect()).instance;
    const modelProjection = (await inspect()).projection.find((node) => node.semanticId === 'models')!;
    const modelField = page.locator(`.react-flow__node[data-id="${modelProjection.id}"] [data-key="reviewed_variant"]`);
    const choice = modelField.getByRole('button').first();
    await expect(choice).toBeEnabled();
    for (const repository of ['Qwen/Qwen-Image', QWEN_REPOSITORY, 'Qwen/Qwen-Image']) {
      await choice.click();
      await page.getByRole('option', { name: repository, exact: true }).click();
      await expect.poll(async () => (await inspect()).instance.values.modelVariant).toBe(repository);
      const switched = (await inspect()).instance;
      // Public controls live in the instance's single value authority. The
      // loader projection resolves that binding; it must not duplicate a value
      // into the immutable graph or replace an otherwise compatible node.
      expect(switched.effectiveGraph).toEqual(beforeSwitch.effectiveGraph);
      expect(switched.values).toEqual({ ...beforeSwitch.values, modelVariant: repository });
      expect(switched.effectiveInterface).toEqual(beforeSwitch.effectiveInterface);
      expect(switched.definitionSnapshot).toEqual(beforeSwitch.definitionSnapshot);
    }
    await page.screenshot({ path: `${evidenceRoot}/same-family-model-selected.png`, fullPage: false });
    checkpoint('same-family model switched both ways; only selected repository field changed');
  }
  const expandedExport = await exportFromBlock(page, rootId);
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  expect(await exportFromBlock(page, rootId)).toEqual(expandedExport);
  const connectedPrompt = root.locator('[data-connected-control="prompt"]');
  await expect(connectedPrompt).toContainText('Connected from');
  await expect(connectedPrompt).toContainText('saved fallback, not the connected execution value');
  await expect(connectedPrompt.locator('textarea')).toBeDisabled();
  const storedFallback = String(
    modified.values.prompt ??
      modified.effectiveInterface.controls.find((control) => control.controlId === 'prompt')?.defaultValue ??
      '',
  );
  await expect(connectedPrompt.locator('textarea')).toHaveValue(storedFallback);
  await page.screenshot({ path: `${evidenceRoot}/connected-prompt-explained.png`, fullPage: false });
  await page.getByTestId('topbar-save-workflow').click();
  const saveDialog = page.getByTestId('save-workflow-dialog');
  if (await saveDialog.isVisible()) {
    await page.getByTestId('save-workflow-name').fill(`Qwen nested ordinary Text Value ${Date.now()}`);
    await page.getByTestId('confirm-save-workflow').click();
    await expect(saveDialog).toHaveCount(0);
  }
  const beforeRefresh = (await inspect()).instance;
  checkpoint('saved before refresh');
  await writeFile(`${evidenceRoot}/before-refresh.json`, JSON.stringify(beforeRefresh, null, 2));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await ensureExpertMode(page);
  await expect(root).toHaveCount(1);
  expect((await inspect()).instance).toEqual(beforeRefresh);
  expect(await exportFromBlock(page, rootId)).toEqual(expandedExport);
  await expect(connectedPrompt.locator('textarea')).toBeDisabled();
  await expect(connectedPrompt.locator('textarea')).toHaveValue(storedFallback);
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  await page.getByTestId('arrange-graph').click();
  await assertExpandedBlockContainsProjection(page, rootId);
  await assertNestedGeometry();
  await page.screenshot({ path: `${evidenceRoot}/restored-nested-text.png`, fullPage: false });
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  const report: Record<string, unknown> = {
    schemaVersion: 1,
    rootId,
    utilityId,
    prompt,
    parameters: Object.fromEntries(Object.entries(expandedExport.nodes).map(([id, node]) => [id, node.params])),
    parameterSource: 'effective exported graph; connected inputs resolve at backend dispatch',
    defaultChanges: false,
    parentOwnership: 'container:text_encoder',
    undoRedo: true,
    localInterface: true,
    refreshParity: true,
    collapsedExpandedExecutionParity: true,
    connectedControlFallbackExplained: true,
    handleWarnings,
    generated: false,
    sameFamilyModelSwitch: switchModel,
  };
  await writeFile(`${evidenceRoot}/frontend-result.json`, JSON.stringify(report, null, 2));
  if (generate) {
    await root.locator('header').first().click();
    const submitted = page.waitForResponse((r) => r.url().endsWith('/graph') && r.request().method() === 'POST', {
      timeout: 120_000,
    });
    await page.getByTestId('selection-toolbar-run-from-node').click();
    const response = await submitted;
    expect(response.ok(), await response.text()).toBe(true);
    const graph = response.request().postDataJSON() as ExecutionExport;
    expect(Object.keys(graph.nodes)).toHaveLength(EXACT_QWEN_TEXT_TO_IMAGE_NODE_COUNT + 1);
    expect(Object.values(graph.nodes).some((n) => n.params?.text?.value === prompt)).toBe(true);
    await writeFile(`${evidenceRoot}/submitted-workflow.json`, JSON.stringify(graph, null, 2));
    const taskId = ((await response.json()) as { task_id: string }).task_id;
    await waitForTask(page, taskId);
    await expect
      .poll(() => findLiveStudioOutput(page, taskId), { timeout: 120_000 })
      .toMatchObject({ taskId, displayType: 'image' });
    const output = (await findLiveStudioOutput(page, taskId))!;
    expect(output.prompt).toBe(prompt);
    expect(output).toMatchObject({ width: 1328, height: 1328, steps: 50, guidanceScale: 4, seed: 42 });
    expect(output.resolvedExecutionInputs).toMatchObject({
      schemaVersion: 1,
      source: 'backend-execution',
      taskId,
      summary: { prompt, width: 1328, height: 1328, steps: 50, guidanceScale: 4, seed: 42 },
    });
    if (switchModel)
      expect(output.resolvedExecutionInputs).toMatchObject({
        summary: {
          repo: 'Qwen/Qwen-Image',
          revision: '75e0b4be04f60ec59a75f475837eced720f823b6',
        },
      });
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.__MODIFF_E2E__!.getState().studio.outputs.find((item) => item.taskId === id)?.prompt,
          taskId,
        ),
      )
      .toBe(prompt);
    const asset = await page.request.get(new URL(output.url!, LIVE_BACKEND_URL).toString());
    expect(asset.ok()).toBe(true);
    await writeFile(`${evidenceRoot}/qwen-nested-ordinary.webp`, await asset.body());
    const receipt = await page.request.get(`${LIVE_BACKEND_URL}/runs/${encodeURIComponent(taskId)}`);
    await writeFile(`${evidenceRoot}/run-receipt.json`, JSON.stringify(await receipt.json(), null, 2));
    const expectedInputs = { prompt, width: 1328, height: 1328, steps: 50, guidanceScale: 4, seed: 42 };
    await assertCapturedImageInGallery(page, taskId, expectedInputs, `${evidenceRoot}/gallery-resolved-inputs.png`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForWorkspace(page);
    await assertCapturedImageInGallery(
      page,
      taskId,
      expectedInputs,
      `${evidenceRoot}/gallery-resolved-inputs-after-refresh.png`,
    );
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.__MODIFF_E2E__!.getState().studio.outputs.find((item) => item.taskId === id)?.prompt,
          taskId,
        ),
      )
      .toBe(prompt);
    await page.screenshot({ path: `${evidenceRoot}/frontend-after-run.png`, fullPage: false });
    await writeFile(
      `${evidenceRoot}/frontend-result.json`,
      JSON.stringify({ ...report, generated: true, taskId, output }, null, 2),
    );
    await writeFile(
      `${evidenceRoot}/PARAMETERS.md`,
      `# Nested Qwen ordinary-node generation\n\nTask: ${taskId}\n\nSelected model: ${switchModel ? 'Qwen/Qwen-Image@75e0b4be04f60ec59a75f475837eced720f823b6' : `${QWEN_REPOSITORY}@${QWEN_REVISION}`}\n\n1328×1328, 50 steps, guidance 4, seed 42, maximum sequence length 512, BF16, model CPU offload, no quantization. Creator defaults unchanged. Prompt is supplied by an added, wired Text Value inside the text-encoder container.\n\n${prompt}\n\nGallery captured settings checked before and after refresh. Same-family picker both directions tested: ${switchModel}. Not publication approval.\n`,
    );
  }
  expect(errors).toEqual([]);
  expect(handleWarnings).toEqual([]);
});

test('a structurally edited current Qwen or FLUX V2 Block persists, reconnects, and executes through the frontend', async ({
  page,
}) => {
  const flux = process.env.MODIFF_RUN_FLUX_V2_STRUCTURAL_EXECUTION === '1';
  const qwenQuality = process.env.MODIFF_QWEN_V2_STRUCTURAL_QUALITY === '1';
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
        prompt: qwenQuality ? SHOWCASE_PROMPT : EDITED_PROMPT,
        size: qwenQuality ? '1328' : '256',
        steps: qwenQuality ? '50' : '2',
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
  const allAdmissions = allLabels.flatMap((label) =>
    label === 'Qwen Image Edit Plus — Default'
      ? [
          { label, route: 'single-reference' },
          { label, route: 'multi-reference' },
        ]
      : [{ label, route: 'default' }],
  );
  const startAt = Number(process.env.MODIFF_QWEN_V2_FAMILY_START_AT ?? 0);
  const limit = Number(process.env.MODIFF_QWEN_V2_FAMILY_LIMIT ?? allAdmissions.length);
  const admissions = allAdmissions
    .slice(Number.isInteger(startAt) && startAt >= 0 ? startAt : 0)
    .slice(0, Number.isInteger(limit) && limit > 0 ? limit : allAdmissions.length);
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
  await dismissRecoveredRunFailure(page);
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

  for (const { label, route } of admissions) {
    console.log(`[qwen-v2-family] checking ${label} (${route})`);
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
    if (route === 'multi-reference') {
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
    const initialSnapshot = await blockSnapshot(page, rootId);
    const suggestedPrompt = await page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      return useFlowStore.getState().nodes.find((node) => node.id === id)!.data.blockInstanceV2!.definitionSnapshot
        .suggestedInputs?.[0]?.values.prompt;
    }, rootId);
    if (typeof suggestedPrompt === 'string') expect(initialSnapshot.resolvedValues.prompt).toBe(suggestedPrompt);
    const lifecyclePrompt = `Qwen V2 persisted parameter proof — ${label} (${route})`;
    if (proveLifecycle) {
      await fillBlockValueAndAssert(
        page,
        rootId,
        root.getByLabel('prompt', { exact: true }),
        'prompt',
        lifecyclePrompt,
        lifecyclePrompt,
      );
      const edited = await blockSnapshot(page, rootId);
      const initialInstance = JSON.parse(initialSnapshot.instanceJson);
      const editedInstance = JSON.parse(edited.instanceJson);
      expect(editedInstance.effectiveGraph).toEqual(initialInstance.effectiveGraph);
      expect(editedInstance.effectiveInterface).toEqual(initialInstance.effectiveInterface);
      expect(editedInstance.presentation).toEqual(initialInstance.presentation);
      expect(edited.definitionDefaults).toEqual(initialSnapshot.definitionDefaults);
      expect({ ...edited.values, prompt: initialSnapshot.values.prompt }).toEqual(initialSnapshot.values);
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
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const instance = useFlowStore.getState().nodes.find((candidate) => candidate.id === id)?.data.blockInstanceV2;
      if (!instance) throw new Error(`Missing Qwen Block V2 instance ${id}.`);
      return {
        publicInputs: instance.effectiveInterface.boundary.inputs.length,
        publicOutputs: instance.effectiveInterface.boundary.outputs.length,
        internalNodes: instance.effectiveGraph.nodes.length,
        internalEdges: instance.effectiveGraph.edges.length,
      };
    }, rootId);
    expect(contract.publicInputs).toBeGreaterThan(0);
    expect(contract.publicOutputs).toBeGreaterThan(0);
    expect(contract.internalNodes).toBeGreaterThan(0);
    expect(contract.internalEdges).toBeGreaterThan(0);
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
      await expect(saveDialog).toBeVisible({ timeout: 120_000 });
      {
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
      await dismissRecoveredRunFailure(page);
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
        route,
        definitionId: initialSnapshot.definitionId,
        rootId,
        ...workflowIdentity,
        prompt: lifecyclePrompt,
        instanceSha256: `sha256:${createHash('sha256').update(restored).digest('hex')}`,
        saveRefreshByteIdentical: true,
        expandedContainedAfterRefresh: true,
        parameterLocality: true,
        defaultsUnchanged: true,
      });
      if (process.env.MODIFF_REVIEW_OUTPUT_DIR) {
        const evidenceRoot = `${process.env.MODIFF_REVIEW_OUTPUT_DIR}/qwen-v2-family-lifecycle`;
        await mkdir(evidenceRoot, { recursive: true });
        await writeFile(
          `${evidenceRoot}/frontend-result.json`,
          `${JSON.stringify(
            {
              schemaVersion: 1,
              expectedAdmissions: admissions.length,
              complete: familyResults.length === admissions.length,
              routes: familyResults,
            },
            null,
            2,
          )}\n`,
        );
      }
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

test('Qwen executes an upstream step added from the palette after User Node save and reload', async ({ page }) => {
  test.skip(process.env.MODIFF_QWEN_COMPOSED_DEMO !== '1', 'Select the real upstream-composition demo explicitly.');
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!outputDirectory, 'A separate evidence directory is required.');
  const generate = process.env.MODIFF_QWEN_COMPOSED_GENERATION === '1';
  test.setTimeout(generate ? 30 * 60_000 : 240_000);
  page.setDefaultTimeout(20_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const evidenceRoot = `${outputDirectory}/qwen-composed`;
  await mkdir(evidenceRoot, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('qwen-composed-demo')) return;
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('qwen-composed-demo', '1');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await dismissRecoveredRunFailure(page);
  await dismissTaskLauncher(page);
  await ensureExpertMode(page);
  await page.getByTestId('topbar-new-workflow').click();
  await chooseAdvancedWorkflow(page, true);
  await clearFinishedSessionActivity(page);
  await page.getByTestId('left-tab-nodes').click();
  const search = page.getByLabel('Search nodes');
  await search.fill('Qwen Image — Text To Image');
  const catalog = page.getByTestId('node-group-Diffusers-Cluster-Nodes');
  if ((await catalog.getByRole('button').first().getAttribute('aria-expanded')) !== 'true')
    await catalog.getByRole('button').first().click();
  await catalog
    .locator('[data-testid^="hugging-face-node-row-"]')
    .filter({ hasText: 'Qwen Image — Text To Image' })
    .click();
  const roots = page
    .locator('.react-flow__node-block')
    .filter({ has: page.locator('[data-block-schema-version="2"]') });
  await expect(roots).toHaveCount(1, { timeout: 60_000 });
  const rootId = (await roots.getAttribute('data-id'))!;
  const root = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
  const inspect = () =>
    page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const nodes = useFlowStore.getState().nodes;
      return {
        instance: nodes.find((n) => n.id === id)!.data.blockInstanceV2!,
        projection: nodes
          .filter((n) => n.data.blockProjectionOwnerId === id)
          .map((n) => ({
            id: n.id,
            semanticId: n.data.blockProjectionNodeId,
            bindings: n.data.blockProjectionPortBindings ?? {},
          })),
      };
    }, rootId);
  const prompt =
    'A meticulously composed architectural photograph of a compact circular clockmaker workshop in a restored Victorian railway signal tower at blue hour. Show the complete two-storey brick building, with space around the roof. Wide open brass-framed doors reveal a richly detailed oak workbench with an astronomical clock, exposed engraved gears and sapphire bearings. Warm practical lamps, framed astronomical charts and a telescope visible upstairs. A wet cobblestone path winds through ferns, reflecting restrained amber light against the deep indigo sky. A cream enamel sign clearly reads "TIME ATELIER". Realistic material textures, coherent perspective, fine mechanical detail, natural 35mm editorial photography, no people, no duplicate buildings.';
  await root.getByLabel('prompt', { exact: true }).fill(prompt);
  await root.getByLabel('prompt', { exact: true }).press('Tab');
  const baseline = (await inspect()).instance;
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  await page
    .locator('[data-block-semantic-node-id="container:denoise"]')
    .getByRole('button', { name: 'Expand Qwen Image Auto Core Denoise Step', exact: true })
    .click();
  await page
    .locator('[data-block-semantic-node-id="container:denoise/text2image"]')
    .getByRole('button', { name: 'Expand Qwen Image Core Denoise Step', exact: true })
    .click();
  await page.getByTestId('arrange-graph').click();
  const coreId = (await inspect()).projection.find((n) => n.semanticId === 'container:denoise/text2image')!.id;
  await search.fill('Qwen Image Text Inputs');
  const row = page.locator('[data-testid^="hugging-face-node-row-"]').filter({ hasText: 'Qwen Image Text Inputs' });
  await expect(row).toHaveCount(1);
  await row.dragTo(page.getByTestId(`rf__node-${coreId}`), { targetPosition: { x: 8, y: 35 } });
  await expect
    .poll(async () => (await inspect()).instance.effectiveGraph.nodes.length)
    .toBe(baseline.effectiveGraph.nodes.length + 1);
  let current = await inspect();
  const added = current.instance.effectiveGraph.nodes.find(
    (n) => !baseline.effectiveGraph.nodes.some((b) => b.nodeId === n.nodeId),
  )!;
  await writeFile(`${evidenceRoot}/added-step.json`, JSON.stringify(added, null, 2));
  expect(added.modularDiffusers?.parentPlacementPath).toEqual(['denoise', 'text2image']);
  expect(added.modularDiffusers?.pipelineClass).toBe('QwenImageModularPipeline');
  expect(current.instance.values).toEqual(baseline.values);
  await page.getByTestId('arrange-graph').click();
  const wire = async (
    sourceSemantic: string,
    targetSemantic: string,
    sourcePort = 'state_out',
    targetPort = 'state_in',
  ) => {
    current = await inspect();
    const source = current.projection.find((n) => n.semanticId === sourceSemantic)!;
    const target = current.projection.find((n) => n.semanticId === targetSemantic)!;
    const socket = (node: typeof source, direction: string, port: string) =>
      Object.entries(node.bindings).find(([, b]) => b.direction === direction && b.fieldOrPortId === port)?.[0] ?? port;
    const from = page.getByTestId(`node-handle-${source.id}-${socket(source, 'output', sourcePort)}`);
    const to = page.getByTestId(`node-handle-${target.id}-${socket(target, 'input', targetPort)}`);
    const point = async (locator: Locator) => {
      const hitEvidence = await locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hits = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const owner = el.closest('.react-flow__node')!;
        const ancestors = [];
        let ancestor = el.parentElement;
        while (ancestor && ancestor !== owner) {
          ancestors.push({
            class: ancestor.className,
            rect: ancestor.getBoundingClientRect().toJSON(),
            style: ancestor.getAttribute('style'),
            width: getComputedStyle(ancestor).width,
          });
          ancestor = ancestor.parentElement;
        }
        return {
          target: el.outerHTML,
          rect: r.toJSON(),
          ancestors,
          owner: { rect: owner.getBoundingClientRect().toJSON(), style: owner.getAttribute('style') },
          hits: hits.slice(0, 6).map((hit) => ({
            tag: hit.tagName,
            class: hit.getAttribute('class'),
            id: hit.getAttribute('data-id'),
            testId: hit.getAttribute('data-testid'),
            style: hit.getAttribute('style'),
            owner: hit.closest('.react-flow__node')?.getBoundingClientRect().toJSON(),
          })),
        };
      });
      await writeFile(`${evidenceRoot}/socket-hit.json`, JSON.stringify(hitEvidence, null, 2));
      await expect
        .poll(
          () =>
            locator.evaluate((el) => {
              const r = el.getBoundingClientRect();
              const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return hit === el || Boolean(hit && el.contains(hit));
            }),
          { message: `Socket must be natively reachable: ${await locator.getAttribute('data-testid')}` },
        )
        .toBe(true);
      return locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const p = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        const hit = document.elementFromPoint(p.x, p.y);
        if (!hit || (hit !== el && !el.contains(hit)))
          throw new Error(`The real composition socket is obscured by ${hit?.tagName}.${hit?.getAttribute('class')}.`);
        return p;
      });
    };
    const a = await point(from);
    const b = await point(to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 18 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        (await inspect()).instance.effectiveGraph.edges.some(
          (e) =>
            e.sourceNodeId === sourceSemantic &&
            e.sourcePortId === sourcePort &&
            e.targetNodeId === targetSemantic &&
            e.targetPortId === targetPort,
        ),
      )
      .toBe(true);
  };
  await wire('upstream:denoise.input', added.nodeId);
  await wire(added.nodeId, 'upstream:denoise.prepare_latents');
  if (process.env.MODIFF_QWEN_TYPED_CONNECTIONS === '1') {
    await wire('upstream:denoise.input', added.nodeId, 'state_output__prompt_embeds', 'prompt_embeds');
    await wire('upstream:denoise.input', added.nodeId, 'state_output__prompt_embeds_mask', 'prompt_embeds_mask');
  }
  if (process.env.MODIFF_QWEN_ITERATION_CONNECTIONS === '1') {
    const current = (await inspect()).instance;
    const owner = current.effectiveGraph.nodes.find((node) => node.modularDiffusers?.blockKind === 'loop')!;
    await page
      .locator(`[data-block-semantic-node-id="${owner.nodeId}"]`)
      .getByRole('button', { name: /^Expand /u })
      .click();
    await page.getByTestId('arrange-graph').click();
    const source = current.effectiveGraph.nodes.find(
      (node) => node.modularDiffusers?.blockClass === 'QwenImageLoopAfterDenoiser',
    )!;
    const target = current.effectiveGraph.nodes.find(
      (node) => node.modularDiffusers?.blockClass === 'QwenImageLoopBeforeDenoiser',
    )!;
    expect(source && target).toBeTruthy();
    await wire(source.nodeId, target.nodeId, 'iteration_previous__latents', 'iteration_input__latents');
  }
  await assertExpandedBlockContainsProjection(page, rootId);
  await waitForRecursiveDomGeometry(page);
  expect(
    await page.locator('.react-flow__handle').evaluateAll((handles) =>
      handles.flatMap((handle) => {
        const box = handle.getBoundingClientRect();
        const owner = handle.closest<HTMLElement>('.react-flow__node');
        if (!owner || !box.width || !box.height) return [];
        const bounds = owner.getBoundingClientRect();
        const allowance = (12 * bounds.width) / owner.offsetWidth;
        const center = box.x + box.width / 2;
        return center < bounds.left - allowance || center > bounds.right + allowance
          ? [handle.getAttribute('data-testid')]
          : [];
      }),
    ),
  ).toEqual([]);
  await page.screenshot({ path: `${evidenceRoot}/palette-step-wired.png` });
  const expanded = await exportFromBlock(page, rootId);
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  expect(await exportFromBlock(page, rootId)).toEqual(expanded);
  const saved = await saveAndReinsertUserNodeForLiveProof(page, rootId, evidenceRoot);
  // The demo's normal Run button must execute one graph, not both the source
  // and the independently reinserted copy used by the persistence assertions.
  await page.getByTestId('arrange-graph').click();
  await root.locator('header').first().click();
  await page.getByTestId('selection-toolbar-delete').click();
  await expect(root).toHaveCount(0);
  await page.getByTestId('topbar-save-workflow').click();
  if (await page.getByTestId('save-workflow-dialog').isVisible()) {
    await page.getByTestId('save-workflow-name').fill('Qwen demo — editable astronomical workshop');
    await page.getByTestId('confirm-save-workflow').click();
  }
  const beforeReload = await blockSnapshot(page, saved.rootId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await ensureExpertMode(page);
  expect((await blockSnapshot(page, saved.rootId)).instanceJson).toEqual(beforeReload.instanceJson);
  const demoRoot = page.locator(`.react-flow__node-block[data-id="${saved.rootId}"]`);
  await writeFile(`${evidenceRoot}/workflow-instance.json`, beforeReload.instanceJson);
  if (generate) {
    await demoRoot.locator('header').first().click();
    const submitted = page.waitForResponse((r) => r.url().endsWith('/graph') && r.request().method() === 'POST', {
      timeout: 120_000,
    });
    await page.getByTestId('selection-toolbar-run-from-node').click();
    const response = await submitted;
    expect(response.ok(), await response.text()).toBe(true);
    const graph = response.request().postDataJSON() as ExecutionExport;
    const inserted = Object.values(graph.nodes).find(
      (n) => JSON.stringify(n.params?.placement_path?.value) === JSON.stringify(added.modularDiffusers?.placementPath),
    );
    expect(inserted?.params?.composition_recipe?.value).toMatchObject({ pipelineClass: 'QwenImageModularPipeline' });
    expect(inserted?.params?.execution_scope?.value).toBe('unpruned_pipeline');
    if (process.env.MODIFF_QWEN_ITERATION_CONNECTIONS === '1')
      expect(Object.values(graph.nodes).some((node) => node.params?.iteration_bindings?.value)).toBe(true);
    await writeFile(`${evidenceRoot}/submitted-workflow.json`, JSON.stringify(graph, null, 2));
    const taskId = (await response.json()).task_id;
    await waitForTask(page, taskId, 25 * 60_000);
    await expect
      .poll(() => findLiveStudioOutput(page, taskId), { timeout: 120_000 })
      .toMatchObject({ taskId, displayType: 'image' });
    const output = (await findLiveStudioOutput(page, taskId))!;
    expect(output).toMatchObject({
      prompt: saved.prompt,
      width: 1328,
      height: 1328,
      steps: 50,
      guidanceScale: 4,
      seed: 42,
    });
    const asset = await page.request.get(new URL(output.url!, LIVE_BACKEND_URL).toString());
    expect(asset.ok()).toBe(true);
    await writeFile(`${evidenceRoot}/qwen-composed.webp`, await asset.body());
    const receipt = await page.request.get(`${LIVE_BACKEND_URL}/runs/${encodeURIComponent(taskId)}`);
    await writeFile(`${evidenceRoot}/run-receipt.json`, JSON.stringify(await receipt.json(), null, 2));
    await assertCapturedImageInGallery(
      page,
      taskId,
      { prompt: saved.prompt, width: 1328, height: 1328, steps: 50, guidanceScale: 4, seed: 42 },
      `${evidenceRoot}/gallery.png`,
    );
    await writeFile(
      `${evidenceRoot}/result.json`,
      JSON.stringify(
        { taskId, output, paletteInsertion: true, userNodeSaveReinsert: true, refresh: true, added },
        null,
        2,
      ),
    );
  }
  expect(errors).toEqual([]);
});

test('production portable demo preserves native edits, resize, nesting and Save across refresh', async ({ page }) => {
  const packagePath = process.env.MODIFF_PORTABLE_DEMO_PACKAGE;
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!packagePath || !directory, 'Select an existing one-root demo package and an isolated evidence directory.');
  test.setTimeout(8 * 60_000);
  await mkdir(directory!, { recursive: true });
  const original = JSON.parse(await readFile(packagePath!, 'utf8'));
  expect(original.graph.nodes).toHaveLength(1);
  const errors: string[] = [];
  const diagnostics: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      diagnostics.push(message.text());
      console.log(`[portable demo console] ${message.text()}`);
    }
  });
  page.on('response', (response) => {
    if (
      response.url().includes('/huggingface/') ||
      response.url().includes('/assets/studio-templates.js') ||
      response.status() >= 400
    )
      diagnostics.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.log(`[portable demo page error] ${error.stack}`);
  });
  page.setDefaultTimeout(20_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const ready = async () => {
    await expect(page.getByTestId('topbar-new-workflow')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
    await dismissRecoveredRunFailure(page);
    await dismissTaskLauncher(page);
  };
  await page.goto(process.env.MODIFF_NESTED_FRONTEND_URL ?? LIVE_BACKEND_URL, { waitUntil: 'domcontentloaded' });
  await ready();
  await page.getByTestId('workflow-tab-new').click();
  await dismissTaskLauncher(page);
  const transfer = await page.evaluateHandle((snapshot) => {
    const data = new DataTransfer();
    data.items.add(new File([JSON.stringify(snapshot)], 'Portable Demo.json', { type: 'application/json' }));
    return data;
  }, original);
  await page.locator('.react-flow').dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
  const root = page.locator('.react-flow__node-block');
  await expect(root).toHaveCount(1, { timeout: 60_000 });
  const rootId = (await root.getAttribute('data-id'))!;
  // Match the demo's import -> explicit Save sequence, waiting for the import's
  // first durable document acknowledgement before exporting its composition.
  await page.getByTestId('topbar-save-workflow-options').click();
  await page.getByTestId('topbar-save-workflow-as').click();
  await page.getByTestId('save-workflow-name').fill(`Demo rehearsal ${Date.now()}`);
  await page.getByTestId('confirm-save-workflow').click();
  await expect(page.getByTestId('save-workflow-dialog')).toHaveCount(0);
  const exportPackage = async (name: string) => {
    const inspect = async () => {
      if (process.env.MODIFF_PORTABLE_DEMO_DIAGNOSTICS !== '1') return null;
      return page.evaluate(async () => {
        const bundleUrl = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((url) => url.includes('/assets/studio-templates.js'));
        if (bundleUrl) {
          const exports = await import(/* @vite-ignore */ bundleUrl);
          const store = Object.values(exports).find((candidate) => {
            if (typeof candidate !== 'function' || !('getState' in candidate)) return false;
            const state = (candidate as unknown as { getState: () => Record<string, unknown> }).getState();
            return Array.isArray(state.nodes) && Array.isArray(state.edges);
          }) as { getState: () => { nodes: unknown[]; edges: unknown[] } } | undefined;
          if (!store) throw new Error('Could not identify the already-loaded read-only flow store.');
          const { nodes, edges } = store.getState();
          return { nodes, edges };
        }
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const { captureWorkflowOperationContext } = await import('/src/stores/useStudioStore.ts');
        const flow = useFlowStore.getState();
        return { nodes: flow.nodes, edges: flow.edges, context: captureWorkflowOperationContext() };
      });
    };
    const prior = await inspect();
    await page.getByTestId('topbar-export').click();
    const downloaded = page.waitForEvent('download');
    await page.getByTestId('topbar-export-workflow-package').click();
    const path = `${directory}/${name}.json`;
    try {
      const download = await Promise.race([
        downloaded,
        page
          .getByRole('alert')
          .first()
          .waitFor({ state: 'visible' })
          .then(async () => {
            throw new Error(`Export notification: ${await page.getByRole('alert').first().textContent()}`);
          }),
      ]);
      await download.saveAs(path);
    } catch (error) {
      await writeFile(`${directory}/export-diagnostics.json`, JSON.stringify(diagnostics, null, 2));
      await writeFile(
        `${directory}/loaded-state-modules.json`,
        JSON.stringify(
          await page.evaluate(() =>
            performance
              .getEntriesByType('resource')
              .map((entry) => entry.name)
              .filter((url) => url.includes('/assets/studio-templates.js')),
          ),
          null,
          2,
        ),
      );
      if (prior)
        await writeFile(
          `${directory}/export-state.json`,
          JSON.stringify({ before: prior, after: await inspect() }, null, 2),
        );
      throw error;
    }
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const imported = await exportPackage('imported');
  expect(imported.apiGraph.nodes).toEqual(original.apiGraph.nodes);
  expect(imported.apiGraph.paths).toEqual(original.apiGraph.paths);
  const prompt = root.locator('textarea:not([disabled]):not([readonly])').first();
  await expect(prompt).toBeVisible();
  const originalPrompt = await prompt.inputValue();
  const editedPrompt = `${originalPrompt} A single polished copper ruler lies beside the drawing.`;
  await prompt.fill(editedPrompt);
  await prompt.blur();
  const edited = await exportPackage('edited');
  const before = imported.graph.nodes[0].data.blockInstanceV2;
  const after = edited.graph.nodes[0].data.blockInstanceV2;
  expect(after.effectiveGraph).toEqual(before.effectiveGraph);
  expect(after.effectiveInterface).toEqual(before.effectiveInterface);
  expect(Object.keys(after.values).filter((key) => after.values[key] !== before.values[key])).toHaveLength(1);
  expect(Object.values(after.values)).toContain(editedPrompt);
  await page.getByTestId('topbar-save-workflow').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await expect(prompt).toHaveValue(editedPrompt);
  expect((await exportPackage('refreshed')).apiGraph.nodes).toEqual(edited.apiGraph.nodes);
  // Restore the recorded generation recipe; this rehearsal submits no GPU task.
  await prompt.fill(originalPrompt);
  await prompt.blur();
  await root.locator('header').first().click();
  const grip = (await root.getByTestId('node-resize-grip').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 100, Math.min(990, grip.y + grip.height / 2 + 80), { steps: 12 });
  await page.mouse.up();
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  await page.getByTestId('arrange-graph').click();
  await waitForRecursiveDomGeometry(page);
  await page.screenshot({ path: `${directory}/expanded.png` });
  const nested = page.locator('[data-block-projection="modular-diffusers"]').getByRole('button', { name: /^Expand /u });
  let expandedCount = 0;
  for (let count = 0; count < 20 && (await nested.count()) > 0; count += 1) {
    await nested.first().click();
    expandedCount += 1;
    await page.getByTestId('arrange-graph').click();
    await waitForRecursiveDomGeometry(page);
  }
  expect(expandedCount).toBeGreaterThan(0);
  await page.screenshot({ path: `${directory}/nested.png` });
  await page.locator(`.react-flow__node[data-id="${rootId}"]`).getByTestId(`user-block-toggle-${rootId}`).click();
  await page.getByTestId('topbar-save-workflow').click();
  const finalPackage = await exportPackage('Demo');
  expect(finalPackage.apiGraph.nodes).toEqual(imported.apiGraph.nodes);
  expect(finalPackage.apiGraph.paths).toEqual(imported.apiGraph.paths);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  expect((await exportPackage('final-refresh')).apiGraph.nodes).toEqual(imported.apiGraph.nodes);
  const stateModules = await page.evaluate(() => [
    ...new Set(
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((url) => url.includes('/assets/studio-templates.js')),
    ),
  ]);
  if (stateModules.length) {
    expect(stateModules).toHaveLength(1);
    expect(new URL(stateModules[0]!).searchParams.get('v')).toMatch(/^[a-f0-9]{16}$/u);
  }
  await page.screenshot({ path: `${directory}/ready.png` });
  expect(errors).toEqual([]);
  await writeFile(
    `${directory}/result.json`,
    JSON.stringify(
      {
        frontend: page.url(),
        imported: true,
        nativePromptEdit: true,
        saved: true,
        refreshed: true,
        resizeBeforeExpand: true,
        recursiveContainment: true,
        restoredOriginalRecipe: true,
        newInference: false,
        errors,
      },
      null,
      2,
    ),
  );
});

test('production Qwen demo imports, saves one editable User Node and runs from the normal toolbar', async ({
  page,
}) => {
  test.skip(process.env.MODIFF_QWEN_DEMO_HANDOFF !== '1', 'Select the production handoff explicitly.');
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!directory, 'An isolated review directory is required.');
  test.setTimeout(35 * 60_000);
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const submitted = JSON.parse(await readFile(`${directory}/qwen-composed/submitted-workflow.json`, 'utf8'));
  const lifecycle = JSON.parse(await readFile(`${directory}/qwen-composed/user-node-lifecycle.json`, 'utf8'));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const ready = async () => {
    await expect(page.getByTestId('topbar-new-workflow')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
    await dismissRecoveredRunFailure(page);
    await dismissTaskLauncher(page);
    const auto = page.getByRole('radio', { name: 'Creator', exact: true });
    if ((await auto.getAttribute('aria-checked')) === 'true')
      await page.getByRole('radio', { name: 'Developer', exact: true }).click();
    await expect(auto).toHaveAttribute('aria-checked', 'false');
  };
  await page.goto(process.env.MODIFF_NESTED_FRONTEND_URL ?? LIVE_BACKEND_URL, { waitUntil: 'domcontentloaded' });
  await ready();
  // Exercise the real file-drop importer, not a store setter or API submission.
  const transfer = await page.evaluateHandle((snapshot) => {
    const data = new DataTransfer();
    data.items.add(new File([JSON.stringify(snapshot)], 'Qwen Workshop Demo.json', { type: 'application/json' }));
    return data;
  }, submitted.runtimeHints.workflowSnapshot);
  await page.locator('.react-flow').dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
  const source = page.locator(`.react-flow__node-block[data-id="${lifecycle.originalRootId}"]`);
  const demo = page.locator(`.react-flow__node-block[data-id="${lifecycle.reinsertedId}"]`);
  await expect(demo).toBeVisible({ timeout: 60_000 });
  await source.locator('header').first().click();
  await page.getByTestId('selection-toolbar-delete').click();
  await expect(source).toHaveCount(0);
  await expect(page.locator('.react-flow__node-block')).toHaveCount(1);
  // Make the demo's controls readable using the same resize gesture as a user.
  // Layout is presentation-only; the assertions below still compare every
  // effective node, connection, parameter and interface to the executed graph.
  const headerBounds = (await demo.locator('header').first().boundingBox())!;
  if (headerBounds.y < 120) {
    await page.mouse.move(1800, 200);
    await page.mouse.down();
    await page.mouse.move(1600, 200 + 160 - headerBounds.y, { steps: 12 });
    await page.mouse.up();
  }
  await demo.locator('header').first().click();
  const grip = (await demo.getByTestId('node-resize-grip').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 170, Math.min(1010, grip.y + grip.height / 2 + 350), { steps: 15 });
  await page.mouse.up();
  await page.getByTestId('topbar-save-workflow-options').click();
  await page.getByTestId('topbar-save-workflow-as').click();
  await page.getByTestId('save-workflow-name').fill('Qwen Demo — Time Atelier');
  await page.getByTestId('confirm-save-workflow').click();
  await expect(page.getByTestId('save-workflow-dialog')).toHaveCount(0);
  const exportPackage = async () => {
    await page.getByTestId('topbar-export').click();
    const downloaded = page.waitForEvent('download');
    await page.getByTestId('topbar-export-workflow-package').click();
    await (await downloaded).saveAs(`${directory}/Qwen-Demo.json`);
    return JSON.parse(await readFile(`${directory}/Qwen-Demo.json`, 'utf8'));
  };
  const packaged = await exportPackage();
  expect(packaged.graph.nodes).toHaveLength(1);
  if (process.env.MODIFF_QWEN_DEMO_HANDOFF_GENERATE !== '1') {
    const executed = JSON.parse(await readFile(`${directory}/production-submitted.json`, 'utf8'));
    expect(packaged.apiGraph.nodes).toEqual(executed.nodes);
    expect(packaged.apiGraph.paths).toEqual(executed.paths);
  }
  expect(
    Object.values(packaged.apiGraph.nodes).some(
      (node) => (node as { params?: { composition_recipe?: unknown } }).params?.composition_recipe,
    ),
  ).toBe(true);
  const expectedInstance = submitted.runtimeHints.workflowSnapshot.nodes.find((n) => n.id === lifecycle.reinsertedId)
    .data.blockInstanceV2;
  const instance = packaged.graph.nodes[0].data.blockInstanceV2;
  expect(instance.effectiveGraph).toEqual(expectedInstance.effectiveGraph);
  expect(instance.values).toEqual(expectedInstance.values);
  expect(instance.effectiveInterface).toEqual(expectedInstance.effectiveInterface);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  expect((await exportPackage()).graph.nodes[0].data.blockInstanceV2).toEqual(instance);
  await demo.getByTestId(`user-block-toggle-${lifecycle.reinsertedId}`).click();
  await page.getByTestId('arrange-graph').click();
  await waitForRecursiveDomGeometry(page);
  if (process.env.MODIFF_QWEN_DEMO_PRESENTATION === '1') {
    // Author a readable demo layout with ordinary drag gestures. This is saved
    // presentation only, not a replacement graph or a model/default change.
    const bounds = (await demo.locator('header').first().boundingBox())!;
    await page.mouse.move(1800, 140);
    await page.mouse.down();
    await page.mouse.move(1800 + 70 - bounds.x, 140 + 180 - bounds.y, { steps: 14 });
    await page.mouse.up();
    const ordinary = (label: string) =>
      page
        .locator('.react-flow__node-custom')
        .filter({ has: page.locator('header').getByText(label, { exact: true }) });
    const ordered = [
      ordinary('Load Qwen Image Components'),
      page.locator('[data-block-semantic-node-id="container:text_encoder"]'),
      page.locator('[data-block-semantic-node-id="container:denoise"]'),
      page.locator('[data-block-semantic-node-id="container:decode"]'),
      ordinary('Preview Image'),
    ];
    for (const [index, node] of ordered.entries()) {
      const header = node.locator('header').first();
      const from = (await header.boundingBox())!;
      await page.mouse.move(from.x + 30, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(130 + index * 300, 250 + from.height / 2, { steps: 18 });
      await page.mouse.up();
      await expect.poll(async () => Math.abs((await header.boundingBox())!.x - (100 + index * 300))).toBeLessThan(4);
    }
    await waitForRecursiveDomGeometry(page);
  }
  await page.screenshot({ path: `${directory}/demo-expanded.png` });
  await demo.getByTestId(`user-block-toggle-${lifecycle.reinsertedId}`).click();
  await page.screenshot({ path: `${directory}/demo-ready.png` });
  await page.getByTestId('topbar-save-workflow').click();
  const finalPackage = await exportPackage();
  expect(finalPackage.apiGraph.nodes).toEqual(packaged.apiGraph.nodes);
  expect(finalPackage.apiGraph.paths).toEqual(packaged.apiGraph.paths);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  expect((await exportPackage()).graph.nodes[0].data.blockInstanceV2).toEqual(
    finalPackage.graph.nodes[0].data.blockInstanceV2,
  );
  if (process.env.MODIFF_QWEN_DEMO_HANDOFF_GENERATE === '1') {
    const responsePromise = page.waitForResponse((r) => r.url().endsWith('/graph') && r.request().method() === 'POST', {
      timeout: 120_000,
    });
    await page.getByRole('button', { name: 'Run current graph', exact: true }).click();
    const response = await responsePromise;
    expect(response.ok(), await response.text()).toBe(true);
    const graph = response.request().postDataJSON();
    expect(Object.values(graph.nodes).filter((n) => (n as { action?: string }).action === 'ModelsLoader')).toHaveLength(
      1,
    );
    expect(
      Object.values(graph.nodes).some(
        (n) => (n as { params?: { composition_recipe?: unknown } }).params?.composition_recipe,
      ),
    ).toBe(true);
    await writeFile(`${directory}/production-submitted.json`, JSON.stringify(graph, null, 2));
    const taskId = (await response.json()).task_id;
    await waitForTask(page, taskId, 30 * 60_000);
    const output = (await findLiveStudioOutput(page, taskId))!;
    expect(output).toMatchObject({
      prompt: instance.values.prompt,
      width: 1328,
      height: 1328,
      steps: 50,
      guidanceScale: 4,
      seed: 42,
    });
    const media = await page.request.get(new URL(output.url!, LIVE_BACKEND_URL).toString());
    expect(media.ok()).toBe(true);
    await writeFile(`${directory}/Qwen-Demo.webp`, await media.body());
    await page.getByTestId('topbar-gallery').click();
    await page.getByTestId('gallery-view-grid').click();
    const card = page
      .locator('[data-testid^="gallery-output-"]')
      .filter({ hasText: `Task ${taskId}` })
      .first();
    await expect(card).toBeVisible({ timeout: 120_000 });
    await card.getByRole('button', { name: 'Select', exact: true }).click();
    await page.getByTestId('gallery-view-inspect').click();
    const inspector = page.getByTestId('gallery-inspect-view');
    await expect(inspector.getByTestId('resolved-inputs-status')).toContainText('captured by the backend');
    const metadata = JSON.parse((await inspector.locator('pre').textContent())!);
    expect(metadata.resolvedExecutionInputs).toMatchObject({
      taskId,
      summary: { prompt: instance.values.prompt, width: 1328, height: 1328, steps: 50, guidanceScale: 4, seed: 42 },
    });
    await page.screenshot({ path: `${directory}/demo-gallery.png` });
    await page.keyboard.press('Escape');
    await exportPackage();
    await writeFile(
      `${directory}/production-result.json`,
      JSON.stringify(
        { taskId, output, frontend: page.url(), imported: true, saved: true, refreshed: true, normalRun: true, errors },
        null,
        2,
      ),
    );
  }
  expect(errors).toEqual([]);
});

test('production Qwen removes an added upstream step, undoes, reconnects and executes after refresh', async ({
  page,
}) => {
  test.skip(process.env.MODIFF_QWEN_REMOVAL_DEMO !== '1', 'Select the removal proof explicitly.');
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!directory, 'An isolated review directory is required.');
  test.setTimeout(35 * 60_000);
  page.setDefaultTimeout(20_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const original = JSON.parse(await readFile(`${directory}/Qwen-Demo.json`, 'utf8'));
  const added = JSON.parse(await readFile(`${directory}/qwen-composed/added-step.json`, 'utf8'));
  const before = original.graph.nodes[0].data.blockInstanceV2;
  const evidence = `${directory}/qwen-removed`;
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const ready = async () => {
    await expect(page.getByTestId('topbar-new-workflow')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
    await dismissRecoveredRunFailure(page);
    await dismissTaskLauncher(page);
    const auto = page.getByRole('radio', { name: 'Creator', exact: true });
    if ((await auto.getAttribute('aria-checked')) === 'true')
      await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  };
  await page.goto(process.env.MODIFF_NESTED_FRONTEND_URL ?? LIVE_BACKEND_URL, { waitUntil: 'domcontentloaded' });
  await ready();
  const transfer = await page.evaluateHandle((value) => {
    const data = new DataTransfer();
    data.items.add(new File([JSON.stringify(value)], 'Qwen Removal Check.json', { type: 'application/json' }));
    return data;
  }, original);
  await page.locator('.react-flow').dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
  const root = page.locator(`.react-flow__node-block[data-id="${before.instanceId}"]`);
  await expect(root).toBeVisible({ timeout: 60_000 });
  const exportPackage = async (raw = false) => {
    await page.getByTestId('topbar-export').click();
    const downloaded = page.waitForEvent('download');
    await page.getByTestId(raw ? 'topbar-export-raw-workflow' : 'topbar-export-workflow-package').click();
    const destination = `${evidence}/${raw ? 'raw' : 'workflow'}.json`;
    await (await downloaded).saveAs(destination);
    const value = JSON.parse(await readFile(destination, 'utf8'));
    return raw ? value : value.graph;
  };
  await root.getByTestId(`user-block-toggle-${before.instanceId}`).click();
  await page
    .locator('[data-block-semantic-node-id="container:denoise"]')
    .getByRole('button', { name: 'Expand Qwen Image Auto Core Denoise Step', exact: true })
    .click();
  await page
    .locator('[data-block-semantic-node-id="container:denoise/text2image"]')
    .getByRole('button', { name: 'Expand Qwen Image Core Denoise Step', exact: true })
    .click();
  await page.getByTestId('arrange-graph').click();
  const frame = (label: string) =>
    page.locator('.react-flow__node-custom').filter({
      has: page.locator('header').getByText(label, { exact: true }),
    });
  const addedFrame = frame(added.data.label);
  await expect(addedFrame).toHaveCount(1);
  await addedFrame.locator('header').click();
  await page.getByTestId('selection-toolbar-delete').click();
  await expect(addedFrame).toHaveCount(0);
  const removed = (await exportPackage(true)).nodes[0].data.blockInstanceV2;
  expect(removed.values).toEqual(before.values);
  expect(removed.effectiveGraph.nodes).toEqual(before.effectiveGraph.nodes.filter((n) => n.nodeId !== added.nodeId));
  await page.keyboard.press('Control+z');
  await expect(addedFrame).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(addedFrame).toHaveCount(0);
  const sourceNode = before.effectiveGraph.nodes.find((n) => n.nodeId === 'upstream:denoise.input');
  const targetNode = before.effectiveGraph.nodes.find((n) => n.nodeId === 'upstream:denoise.prepare_latents');
  const source = frame(sourceNode.data.label).locator('[aria-label^="Output Pipeline State,"]');
  const target = frame(targetNode.data.label).locator('[aria-label^="Input Pipeline State,"]');
  const a = (await source.boundingBox())!;
  const b = (await target.boundingBox())!;
  for (const handle of [source, target]) {
    expect(
      await handle.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit === element || element.contains(hit);
      }),
    ).toBe(true);
  }
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 });
  await page.mouse.up();
  const reconnected = (await exportPackage(true)).nodes[0].data.blockInstanceV2;
  expect(reconnected.values).toEqual(before.values);
  expect(reconnected.definitionSnapshot).toEqual(before.definitionSnapshot);
  expect(
    reconnected.effectiveGraph.edges.some(
      (e) =>
        e.sourceNodeId === sourceNode.nodeId && e.targetNodeId === targetNode.nodeId && e.targetPortId === 'state_in',
    ),
  ).toBe(true);
  await waitForRecursiveDomGeometry(page);
  await page.screenshot({ path: `${evidence}/reconnected.png` });
  await root.getByTestId(`user-block-toggle-${before.instanceId}`).click();
  await page.getByTestId('topbar-save-workflow-options').click();
  await page.getByTestId('topbar-save-workflow-as').click();
  await page.getByTestId('save-workflow-name').fill('Qwen Demo — Removed Step Check');
  await page.getByTestId('confirm-save-workflow').click();
  await expect(page.getByTestId('save-workflow-dialog')).toHaveCount(0);
  const saved = (await exportPackage()).nodes[0].data.blockInstanceV2;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  expect((await exportPackage()).nodes[0].data.blockInstanceV2).toEqual(saved);
  const responsePromise = page.waitForResponse((r) => r.url().endsWith('/graph') && r.request().method() === 'POST', {
    timeout: 120_000,
  });
  await page.getByRole('button', { name: 'Run current graph', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBe(true);
  const graph = response.request().postDataJSON();
  expect(
    Object.values(graph.nodes).some(
      (n) => (n as { params?: { composition_recipe?: unknown } }).params?.composition_recipe,
    ),
  ).toBe(false);
  await writeFile(`${evidence}/submitted.json`, JSON.stringify(graph, null, 2));
  const taskId = (await response.json()).task_id;
  await waitForTask(page, taskId, 30 * 60_000);
  const output = (await findLiveStudioOutput(page, taskId))!;
  expect(output).toMatchObject({
    prompt: before.values.prompt,
    width: 1328,
    height: 1328,
    steps: 50,
    guidanceScale: 4,
    seed: 42,
  });
  const media = await page.request.get(new URL(output.url!, LIVE_BACKEND_URL).toString());
  expect(media.ok()).toBe(true);
  await writeFile(`${evidence}/qwen-removed.webp`, await media.body());
  await writeFile(
    `${evidence}/result.json`,
    JSON.stringify(
      {
        taskId,
        output,
        errors,
        removed: added.nodeId,
        undoRedo: true,
        reconnected: true,
        saved: true,
        refreshed: true,
        frontend: page.url(),
      },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
});

test('production FLUX reviews a retained completed image through Gallery and refresh', async ({ page }) => {
  const taskId = process.env.MODIFF_FLUX_REVIEW_TASK;
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!taskId || !directory, 'Select an existing completed FLUX task and a private review directory.');
  test.setTimeout(5 * 60_000);
  await mkdir(directory!, { recursive: true });
  const receiptResponse = await page.request.get(`${LIVE_BACKEND_URL}/runs/${encodeURIComponent(taskId!)}`);
  expect(receiptResponse.ok()).toBe(true);
  const receipt = await receiptResponse.json();
  expect(receipt.task).toMatchObject({ task_id: taskId, status: 'completed' });
  const output = receipt.outputs.find(
    (item: LiveStudioOutput) => item.taskId === taskId && item.displayType === 'image',
  );
  const compositeDirectory = process.env.MODIFF_FLUX_REVIEW_COMPOSITE_DIRECTORY;
  const composite = compositeDirectory
    ? JSON.parse(await readFile(`${compositeDirectory}/before.json`, 'utf8')).before
    : null;
  if (composite) {
    const submitted = JSON.parse(await readFile(`${compositeDirectory}/submitted.json`, 'utf8'));
    expect(submitted.taskId).toBe(taskId);
    const nodes = Object.values(submitted.graph.nodes) as Array<{
      action?: string;
      params?: Record<string, { value?: unknown; default?: unknown }>;
    }>;
    const loader = nodes.find((node) => node.action === 'LoadPipeline');
    expect(loader).toBeTruthy();
    expect(nodes.some((node) => node.params?.prompt?.value === composite.values.prompt)).toBe(true);
    expect(output).toMatchObject({
      modelType: loader!.params!.pipeline_class.value,
      prompt: composite.values.prompt,
      width: composite.values.width,
      height: composite.values.height,
      steps: composite.values.num_inference_steps,
      seed: composite.values.seed,
      resolvedExecutionInputs: {
        source: 'backend-execution',
        taskId,
        summary: {
          repo: composite.definition.source.repository,
          revision: composite.definition.source.repositoryRevision,
          dtype: composite.values.dtype,
          offloadMode: composite.values.offloadMode,
          guidanceScale: composite.values.guidance_scale,
        },
      },
    });
  } else {
    expect(output).toMatchObject({
      modelType: 'Flux2ModularPipeline',
      width: 1024,
      height: 1024,
      steps: 50,
      seed: 20260905,
      resolvedExecutionInputs: {
        source: 'backend-execution',
        taskId,
        summary: {
          repo: 'black-forest-labs/FLUX.2-dev',
          revision: '26afe3a78bb242c0a8bb181dcc8937bb16e5c66c',
          dtype: 'bfloat16',
          offloadMode: 'group_disk',
          guidanceScale: 4,
        },
      },
    });
  }
  const lifecyclePath = process.env.MODIFF_FLUX_REVIEW_USER_NODE_EVIDENCE;
  const submittedPath = process.env.MODIFF_FLUX_REVIEW_SUBMITTED_GRAPH;
  let expectedPrompt = output.prompt;
  if (lifecyclePath || submittedPath) {
    if (!lifecyclePath || !submittedPath)
      throw new Error('Retained User Node review requires both pre-run evidence files.');
    const lifecycle = JSON.parse(await readFile(lifecyclePath, 'utf8'));
    const submitted = JSON.parse(await readFile(submittedPath, 'utf8'));
    expect(lifecycle.checks).toEqual({
      saveAs: true,
      reinsert: true,
      interfacePreserved: true,
      instanceIsolation: true,
      libraryIsolation: true,
    });
    expectedPrompt = lifecycle.edited.resolvedValues.prompt;
    expect(typeof expectedPrompt).toBe('string');
    expect(expectedPrompt.length).toBeGreaterThan(100);
    const nodes = Object.values(submitted.nodes) as Array<{ params?: Record<string, { value?: unknown }> }>;
    expect(nodes.some((node) => node.params?.prompt?.value === expectedPrompt)).toBe(true);
    expect(output.prompt).toBe(expectedPrompt);
  }
  const expected = composite
    ? {
        prompt: composite.values.prompt,
        width: Number(composite.values.width),
        height: Number(composite.values.height),
        steps: Number(composite.values.num_inference_steps),
        guidanceScale: Number(composite.values.guidance_scale),
        seed: Number(composite.values.seed),
      }
    : { prompt: expectedPrompt, width: 1024, height: 1024, steps: 50, guidanceScale: 4, seed: 20260905 };
  await page.goto(process.env.MODIFF_NESTED_FRONTEND_URL ?? LIVE_BACKEND_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await dismissRecoveredRunFailure(page);
  await dismissTaskLauncher(page);
  await assertCapturedImageInGallery(page, taskId!, expected, `${directory}/gallery.png`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await dismissTaskLauncher(page);
  await assertCapturedImageInGallery(page, taskId!, expected, `${directory}/gallery-after-refresh.png`);
  const asset = await page.request.get(new URL(output.url, LIVE_BACKEND_URL).toString());
  expect(asset.ok()).toBe(true);
  const bytes = await asset.body();
  const statistics = await decodedImageStatistics(page, bytes);
  expect(statistics.maximum - statistics.minimum).toBeGreaterThan(16);
  expect(statistics.standardDeviation).toBeGreaterThan(2);
  await writeFile(`${directory}/image.webp`, bytes);
  await writeFile(`${directory}/receipt.json`, JSON.stringify(receipt, null, 2));
  await writeFile(
    `${directory}/result.json`,
    JSON.stringify(
      {
        taskId,
        frontend: page.url(),
        retainedGeneration: true,
        newInference: false,
        preRunUserNodeEvidenceChecked: Boolean(lifecyclePath),
        preRunCompositeEvidenceChecked: Boolean(compositeDirectory),
        galleryBeforeAndAfterRefresh: true,
        expected,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        statistics,
      },
      null,
      2,
    ),
  );
});

test('production Klein retains its generated image and captured settings after model cleanup', async ({ page }) => {
  const taskId = process.env.MODIFF_KLEIN_RETAINED_TASK;
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!taskId || !directory, 'Select a completed Klein task after idle model cleanup.');
  test.setTimeout(3 * 60_000);
  await mkdir(directory!, { recursive: true });
  const response = await page.request.get(`${LIVE_BACKEND_URL}/runs/${encodeURIComponent(taskId!)}`);
  expect(response.ok()).toBe(true);
  const receipt = await response.json();
  expect(receipt.task).toMatchObject({ task_id: taskId, status: 'completed' });
  const output = receipt.outputs.find(
    (item: LiveStudioOutput) => item.taskId === taskId && item.displayType === 'image',
  );
  expect(output).toMatchObject({
    modelType: 'Flux2KleinModularPipeline',
    repo: 'black-forest-labs/FLUX.2-klein-4B',
    width: 1024,
    height: 1024,
    steps: 4,
    seed: 20260905,
  });
  // Distilled Klein does not consume CFG. Its creator form may show 1, but
  // the Gallery must not invent a backend-captured guidance input from that.
  expect(output.resolvedExecutionInputs.summary).not.toHaveProperty('guidanceScale');
  const expected = { prompt: output.prompt, width: 1024, height: 1024, steps: 4, seed: 20260905 };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(LIVE_BACKEND_URL, { waitUntil: 'domcontentloaded' });
  for (const stage of ['cold', 'refresh']) {
    if (stage === 'refresh') await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 60_000 });
    await dismissRecoveredRunFailure(page);
    await dismissTaskLauncher(page);
    await assertCapturedImageInGallery(page, taskId!, expected, `${directory}/${stage}.png`);
  }
  const media = await page.request.get(new URL(output.url, LIVE_BACKEND_URL).toString());
  expect(media.ok()).toBe(true);
  expect(errors).toEqual([]);
  await writeFile(
    `${directory}/result.json`,
    JSON.stringify(
      {
        taskId,
        expected,
        errors,
        frontend: page.url(),
        newInference: false,
        afterCleanup: true,
        sha256: createHash('sha256')
          .update(await media.body())
          .digest('hex'),
      },
      null,
      2,
    ),
  );
});

test('production Qwen reviews the completed demo after historical recovery is dismissed', async ({ page }) => {
  const taskId = process.env.MODIFF_QWEN_DEMO_REVIEW_TASK;
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!taskId || !directory, 'Select the completed production task and isolated review directory.');
  await page.goto(process.env.MODIFF_NESTED_FRONTEND_URL ?? LIVE_BACKEND_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await expect(page.getByTestId('topbar-gallery')).toBeVisible({ timeout: 120_000 });
  await dismissRecoveredRunFailure(page);
  await dismissTaskLauncher(page);
  await waitForTask(page, taskId!, 30_000);
  const output = (await findLiveStudioOutput(page, taskId!))!;
  const instance = JSON.parse(await readFile(`${directory}/Qwen-Demo.json`, 'utf8')).graph.nodes[0].data
    .blockInstanceV2;
  const expected = { prompt: instance.values.prompt, width: 1328, height: 1328, steps: 50, guidanceScale: 4, seed: 42 };
  expect(output).toMatchObject(expected);
  await assertCapturedImageInGallery(page, taskId!, expected, `${directory}/demo-gallery.png`);
  const receipt = await page.request.get(`${LIVE_BACKEND_URL}/runs/${encodeURIComponent(taskId!)}`);
  expect(receipt.ok()).toBe(true);
  await writeFile(`${directory}/production-run-receipt.json`, JSON.stringify(await receipt.json(), null, 2));
  await writeFile(
    `${directory}/production-result.json`,
    JSON.stringify(
      {
        taskId,
        output,
        frontend: page.url(),
        reviewResumedAfterHistoricalDialog: true,
        generationLifecycleLog: 'qwen-demo-final-production.log',
        galleryReview: true,
      },
      null,
      2,
    ),
  );
});

test('production Qwen releases a loaded graph without blocking status requests', async ({ page }) => {
  test.skip(process.env.MODIFF_QWEN_LOADED_CLEANUP !== '1', 'Requires the completed removal-generation proof.');
  const directory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!directory, 'An isolated review directory is required.');
  test.setTimeout(5 * 60_000);
  const evidence = `${directory}/qwen-removed`;
  const workflow = JSON.parse(await readFile(`${evidence}/workflow.json`, 'utf8'));
  const submitted = JSON.parse(await readFile(`${evidence}/submitted.json`, 'utf8'));
  const loaderId = Object.keys(submitted.nodes).find((id) => submitted.nodes[id].action === 'ModelsLoader')!;
  const url = process.env.MODIFF_NESTED_FRONTEND_URL ?? LIVE_BACKEND_URL;
  const cached = () => page.request.get(`${url}/cache/${encodeURIComponent(loaderId)}/repo_id`);
  expect((await cached()).ok(), 'The real generation must leave a loaded model before this check').toBe(true);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('topbar-new-workflow')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await dismissRecoveredRunFailure(page);
  await dismissTaskLauncher(page);
  const transfer = await page.evaluateHandle((value) => {
    const data = new DataTransfer();
    data.items.add(new File([JSON.stringify(value)], 'Qwen Loaded Cleanup Check.json', { type: 'application/json' }));
    return data;
  }, workflow);
  await page.locator('.react-flow').dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
  const rootId = workflow.graph.nodes[0].id;
  const root = page.locator(`.react-flow__node-block[data-id="${rootId}"]`);
  await expect(root).toBeVisible({ timeout: 60_000 });
  expect((await cached()).ok()).toBe(true);
  const resources = async () => {
    const response = await page.request.get(`${url}/runtime/resources`, { timeout: 5000 });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const beforeResources = await resources();
  let peakRssBytes = beforeResources.process.rssBytes;
  let finished = false;
  const release = page
    .waitForResponse(
      (response) => {
        if (new URL(response.url()).pathname !== '/cache' || response.request().method() !== 'DELETE') return false;
        const nodes = response.request().postDataJSON()?.nodes;
        return nodes === '*' || (Array.isArray(nodes) && nodes.includes(loaderId));
      },
      { timeout: 180_000 },
    )
    .then(async (response) => {
      expect(response.ok()).toBe(true);
      return response.json();
    })
    .finally(() => {
      finished = true;
    });
  const samples: number[] = [];
  const status = async () => {
    while (!finished) {
      const started = Date.now();
      const response = await page.request.get(`${url}/queue`, { timeout: 5000 });
      expect(response.ok()).toBe(true);
      expect((await response.json()).current).toBeNull();
      samples.push(Date.now() - started);
      peakRssBytes = Math.max(peakRssBytes, (await resources()).process.rssBytes);
      await page.waitForTimeout(250);
    }
  };
  const responsive = status();
  await root.locator('header').click();
  await page.getByTestId('selection-toolbar-delete').click();
  const [receipt] = await Promise.all([release, responsive]);
  await expect(root).toHaveCount(0);
  expect((await cached()).status()).toBe(404);
  expect(samples.length).toBeGreaterThan(0);
  expect(Math.max(...samples)).toBeLessThan(4000);
  const afterResources = await resources();
  expect(peakRssBytes - beforeResources.process.rssBytes).toBeLessThan(8 * 1024 ** 3);
  await writeFile(
    `${evidence}/loaded-cleanup.json`,
    JSON.stringify(
      {
        loaderId,
        receipt,
        statusSamples: samples.length,
        maximumStatusLatencyMs: Math.max(...samples),
        peakRssBytes,
        beforeResources,
        afterResources,
      },
      null,
      2,
    ),
  );
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

test('FLUX Klein routes preserve independent drafts through native switching and refresh', async ({ page }) => {
  test.skip(process.env.MODIFF_RUN_FLUX_KLEIN_ROUTE_LIFECYCLE !== '1', 'Select the FLUX route lifecycle explicitly.');
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(!outputDirectory, 'A separate evidence directory is required.');
  test.setTimeout(12 * 60 * 1000);
  const textToImage = process.env.MODIFF_FLUX_ROUTE_MODE === 'text_to_image';
  const execute = process.env.MODIFF_FLUX_ROUTE_EXECUTE === '1';
  if (execute && !textToImage) throw new Error('The switch-execution proof requires text-to-image mode.');
  const evidenceRoot = `${outputDirectory}/klein-${textToImage ? 't2i' : 'edit'}-route-switch`;
  await mkdir(evidenceRoot, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('klein-route-lifecycle')) return;
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('klein-route-lifecycle', 'initialized');
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await dismissRecoveredRunFailure(page);
  await ensureExpertMode(page);
  const { root, rootId } = await insertV2Admission(page, {
    id: `flux2-klein-base-${textToImage ? 'text-to-image' : 'edit-image'}`,
    label: `Flux2 Klein Base — ${textToImage ? 'Text To Image' : 'Edit Image'}`,
    values: {},
  });
  const basePrompt = textToImage
    ? 'Editorial photograph of a museum conservation workshop at dawn. A brass astrolabe with engraved rings rests on navy velvet on an oak workbench. A white cotton glove, fine brush, technical drawing and red wax seal sit in the foreground. Arched windows show a misty city; cool daylight mixes with a warm articulated desk lamp. Detailed aged metal, natural fabric folds, coherent perspective and realistic shadows, no people.'
    : 'Replace only the velvet with burgundy silk; preserve the brass astrolabe, tools and dawn lighting.';
  const distilledPrompt = textToImage
    ? `${basePrompt} A small round observatory miniature stands beside the astrolabe, with a balcony, telescope and illuminated clock workshop below.`
    : 'Keep the astrolabe and silk; add one small ivory conservation tag beside the brush.';
  await fillBlockValueAndAssert(
    page,
    rootId,
    root.getByLabel('prompt', { exact: true }),
    'prompt',
    basePrompt,
    basePrompt,
  );
  const base = await blockSnapshot(page, rootId);
  const selector = root.getByTestId(`block-v2-route-select-${rootId}`);
  const switchTo = async (name: string) => {
    await selector.click();
    await page.getByRole('option', { name, exact: true }).click();
    const dialog = page.getByTestId(`switch-block-route-v1-${rootId}`);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep draft and switch', exact: true }).click();
    // "FLUX.2 Klein" is also a substring of "FLUX.2 Klein Base". Wait for
    // the committed exact model, not an old label that happens to match.
    await expect(selector).toHaveText(name, { timeout: 180_000 });
    await expect
      .poll(async () => (await blockSnapshot(page, rootId)).repository, { timeout: 180_000 })
      .toBe(name === 'FLUX.2 Klein' ? 'black-forest-labs/FLUX.2-klein-4B' : 'black-forest-labs/FLUX.2-klein-base-4B');
  };
  const assertRestored = async (before: BlockSnapshot) => {
    const after = await blockSnapshot(page, rootId);
    expect(after.definitionId).toBe(before.definitionId);
    expect(after.values).toEqual(before.values);
    expect(after.definitionDefaults).toEqual(before.definitionDefaults);
    const previous = JSON.parse(before.instanceJson);
    const restored = JSON.parse(after.instanceJson);
    expect(restored.effectiveGraph).toEqual(previous.effectiveGraph);
    expect(restored.effectiveInterface).toEqual(previous.effectiveInterface);
    expect(after.internalLayout).toEqual(before.internalLayout);
  };
  await switchTo('FLUX.2 Klein');
  await expect(root.getByLabel('prompt', { exact: true })).toHaveValue(basePrompt);
  expect((await blockSnapshot(page, rootId)).repository).toBe('black-forest-labs/FLUX.2-klein-4B');
  await fillBlockValueAndAssert(
    page,
    rootId,
    root.getByLabel('prompt', { exact: true }),
    'prompt',
    distilledPrompt,
    distilledPrompt,
  );
  const distilled = await blockSnapshot(page, rootId);
  await switchTo('FLUX.2 Klein Base');
  await assertRestored(base);
  const saved = (await blockSnapshot(page, rootId)).instanceJson;
  await page.getByTestId('topbar-save-workflow').click();
  const dialog = page.getByTestId('save-workflow-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('save-workflow-name').fill(`FLUX Klein independent route drafts ${Date.now()}`);
  await page.getByTestId('confirm-save-workflow').click();
  await expect(dialog).toHaveCount(0, { timeout: 120_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  expect((await blockSnapshot(page, rootId)).instanceJson).toBe(saved);
  await switchTo('FLUX.2 Klein');
  await assertRestored(distilled);
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  await assertExpandedBlockContainsProjection(page, rootId);
  await page.screenshot({ path: `${evidenceRoot}/distilled-restored-expanded.png`, fullPage: false });
  if (execute) {
    await root.getByTestId(`user-block-toggle-${rootId}`).click();
    for (const [id, label, value] of [
      ['width', 'width', '1024'],
      ['height', 'height', '1024'],
      ['num_inference_steps', 'num inference steps', '4'],
    ]) {
      await fillBlockValueAndAssert(page, rootId, root.getByLabel(label, { exact: true }), id, value, value);
    }
    await fillBlockValueAndAssert(page, rootId, root.getByLabel('Seed', { exact: true }), 'seed', '20260905', {
      value: '20260905',
      isRandom: false,
    });
    await root.locator('header').first().click();
    const submitted = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/graph' && response.request().method() === 'POST',
      { timeout: 120_000 },
    );
    await page.getByTestId('selection-toolbar-run-from-node').click();
    const response = await submitted;
    expect(response.ok(), await response.text()).toBe(true);
    const graph = response.request().postDataJSON() as ExecutionExport;
    const loader = Object.values(graph.nodes).find((node) => node.action === 'ModelsLoader');
    expect(loader?.params).toMatchObject({
      repo_id: { value: { source: 'hub', value: 'black-forest-labs/FLUX.2-klein-4B' } },
      revision: { value: 'e7b7dc27f91deacad38e78976d1f2b499d76a294' },
      dtype: { value: 'bfloat16' },
      offload_mode: { value: 'model_cpu' },
    });
    expect((loader?.params?.quant_config as { value?: unknown } | undefined)?.value).toBeUndefined();
    const { task_id: taskId } = (await response.json()) as { task_id: string };
    await writeFile(`${evidenceRoot}/submitted-workflow.json`, `${JSON.stringify(graph, null, 2)}\n`);
    await writeFile(`${evidenceRoot}/submitted-task.json`, `${JSON.stringify({ taskId })}\n`);
    const task = await waitForTask(page, taskId, 20 * 60 * 1000);
    const expected = { prompt: distilledPrompt, width: 1024, height: 1024, steps: 4, seed: 20260905 };
    await assertCapturedImageInGallery(page, taskId, expected, `${evidenceRoot}/gallery-after-switch.png`);
    const output = await findLiveStudioOutput(page, taskId);
    expect(output?.url).toBeTruthy();
    const image = await page.request.get(new URL(output!.url!, LIVE_BACKEND_URL).toString());
    expect(image.ok()).toBe(true);
    await writeFile(`${evidenceRoot}/after-switch.webp`, await image.body());
    await writeFile(`${evidenceRoot}/execution.json`, `${JSON.stringify({ task, output }, null, 2)}\n`);
  }
  expect(errors).toEqual([]);
  await writeFile(
    `${evidenceRoot}/result.json`,
    `${JSON.stringify(
      {
        checks: {
          nativeSwitchBothDirections: true,
          independentDrafts: true,
          saveRefresh: true,
          expandedContainment: true,
        },
        base,
        distilled,
        restored: await blockSnapshot(page, rootId),
        execution: execute
          ? 'See execution.json and after-switch.webp.'
          : 'Separate generation proofs; no GPU work submitted.',
      },
      null,
      2,
    )}\n`,
  );
});

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
    dev: {
      label: 'Flux',
      repository: 'black-forest-labs/FLUX.1-dev',
      revision: '3de623fc3c33e44ffbe2bad470d0f45bccf2eb21',
      pipelineClass: 'FluxModularPipeline',
      steps: 50,
      guidance: 3.5,
    },
    flux2: {
      label: 'Flux2',
      repository: 'black-forest-labs/FLUX.2-dev',
      revision: '26afe3a78bb242c0a8bb181dcc8937bb16e5c66c',
      pipelineClass: 'Flux2ModularPipeline',
      steps: 50,
      guidance: 4,
    },
  };
  const variant = process.env.MODIFF_FLUX_V2_VARIANT || 'klein';
  // Match the reviewed resource default, not a Klein-only assumption. This
  // assertion does not alter the instance or silently select a lighter recipe.
  const creatorOffloadMode = ['kontext', 'dev'].includes(variant) ? 'group_disk' : 'model_cpu';
  const expectedOffloadMode = process.env.MODIFF_FLUX_V2_OFFLOAD_MODE ?? creatorOffloadMode;
  if (!['model_cpu', 'group_cpu', 'group_disk'].includes(expectedOffloadMode))
    throw new Error('Select an explicit supported FLUX offload mode.');
  const editing = process.env.MODIFF_FLUX_V2_EDIT === '1';
  const inputImage = editing ? process.env.MODIFF_FLUX_V2_INPUT_IMAGE : undefined;
  const inputImages: unknown = process.env.MODIFF_FLUX_V2_INPUT_IMAGES
    ? JSON.parse(process.env.MODIFF_FLUX_V2_INPUT_IMAGES)
    : inputImage
      ? [inputImage]
      : [];
  if (!variants[variant]) throw new Error(`Unknown cached FLUX variant: ${variant}`);
  if (!Array.isArray(inputImages) || inputImages.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error('MODIFF_FLUX_V2_INPUT_IMAGES must be a JSON array of existing backend image paths.');
  }
  const references = inputImages as string[];
  if (editing && !references.length) throw new Error('Explicit existing images are required for the edit lifecycle.');
  if (!editing && references.length) throw new Error('Reference images require the edit lifecycle.');
  if (references.length > 1 && ['kontext', 'dev'].includes(variant))
    throw new Error('This multi-reference proof targets FLUX Klein.');
  const uploadedReferences: Array<{ source: string; sha256: string; bytes: number }> = [];
  let storedReferences: string[] = [];
  const selected = variants[variant]!;
  const scenario = {
    ...selected,
    id: `${variant === 'dev' ? 'flux' : variant === 'kontext' ? 'flux-kontext' : variant === 'flux2' ? 'flux2' : `flux2-${variant}`}-${editing ? (variant === 'dev' ? 'image-to-image' : 'edit-image') : 'text-to-image'}`,
    label: `${selected.label} — ${editing ? (variant === 'dev' ? 'Image To Image' : 'Edit Image') : 'Text To Image'}`,
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
  // Kontext 28/2.5, FLUX.1 dev 50/3.5, full FLUX.2 50/4. These are explicit 1024-square
  // test-instance settings; no stored creator defaults are modified.
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
  if (editing && variant === 'dev') {
    // FLUX.1 img2img is caption-conditioned denoising, not an instruction-edit
    // model. Test its genuine capability rather than demanding Kontext-style
    // "change only" preservation at the unchanged default strength.
    prompt =
      'Editorial photograph of a brass astronomical astrolabe on rich burgundy velvet in a museum ' +
      'conservation workshop. The astrolabe stands at the center of an oak workbench with engraved brass rings, ' +
      'a white cotton glove, fine brushes, tiny screws and a folded technical drawing. Tall arched windows ' +
      'overlook a misty old city at dawn. Cool window light and a warm brass desk lamp illuminate the detailed ' +
      'metal, deep wine-red fabric folds and polished wood. Coherent perspective, restrained burgundy and amber ' +
      'palette, realistic photographic texture, no people.';
  }
  if (references.length > 1) {
    prompt =
      'Use image 1 as the base photograph: preserve its brass astrolabe, navy velvet, oak workbench, tools, ' +
      'arched windows, ORBIT 07 label, camera position and dawn lighting. Add a detailed tabletop architectural ' +
      'miniature of the clock tower from image 2 on the right side of the workbench, beside the astrolabe, not ' +
      'replacing it. Reproduce the second reference’s tower silhouette, clock face, balcony, telescope and TIME ' +
      'ATELIER sign at miniature scale. Ground both objects with coherent shadows on the same table. Natural ' +
      'museum conservation photograph, precise brass and stone textures, no collage borders or split screen.';
  }
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
  expect(before.resolvedValues.offloadMode).toBe(creatorOffloadMode);
  if (expectedOffloadMode !== creatorOffloadMode) {
    // Explicit test-instance resource selection, never a creator-default repair.
    // Native prompt/numeric/Save gestures are tested separately below.
    await page.evaluate(
      async ({ id, mode }) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        useFlowStore.getState().setBlockInstanceValueV2(id, 'offloadMode', mode);
      },
      { id: rootId, mode: expectedOffloadMode },
    );
    const afterResource = await blockSnapshot(page, rootId);
    expect(afterResource.resolvedValues.offloadMode).toBe(expectedOffloadMode);
    expect(afterResource.definitionDefaults).toEqual(before.definitionDefaults);
  }
  if (references.length > 1) {
    // Exercise the real multiple-file picker, not a store mutation or newline
    // string masquerading as a list. Preserve ordered bytes and upload identity.
    const fields = root.getByLabel('image', { exact: true });
    for (let index = (await fields.count()) - 1; index >= 0; index -= 1) {
      await fields.nth(index).fill('');
      await fields.nth(index).press('Tab');
    }
    const files = [];
    for (const [index, source] of references.entries()) {
      const response = await page.request.get(`${LIVE_BACKEND_URL}/file?file=${encodeURIComponent(source)}`);
      expect(response.ok(), `Reference image ${index + 1} must exist`).toBe(true);
      const buffer = await response.body();
      uploadedReferences.push({
        source,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        bytes: buffer.length,
      });
      const extension = /\.(png|jpe?g|webp)$/i.exec(source)?.[1]?.toLowerCase();
      if (!extension) throw new Error(`Unsupported proof image extension: ${source}`);
      files.push({
        name: `flux-reference-${index + 1}.${extension}`,
        mimeType: extension === 'jpg' ? 'image/jpeg' : `image/${extension}`,
        buffer,
      });
    }
    await root.locator('input[type="file"]').first().setInputFiles(files);
    await expect
      .poll(async () => (await blockSnapshot(page, rootId)).resolvedValues.image, { timeout: 60_000 })
      .toHaveLength(references.length);
    storedReferences = (await blockSnapshot(page, rootId)).resolvedValues.image as string[];
    for (const [index, stored] of storedReferences.entries()) {
      const response = await page.request.get(`${LIVE_BACKEND_URL}/file?file=${encodeURIComponent(stored)}`);
      expect(response.ok()).toBe(true);
      expect(
        createHash('sha256')
          .update(await response.body())
          .digest('hex'),
      ).toBe(uploadedReferences[index]!.sha256);
    }
  } else if (references[0]) {
    await fillBlockValueAndAssert(
      page,
      rootId,
      root.getByLabel('image', { exact: true }).first(),
      'image',
      references[0],
      references,
    );
    storedReferences = [...references];
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
  if (editing) expect((await blockSnapshot(page, rootId)).resolvedValues.image).toEqual(storedReferences);
  const generationDefaults = (await blockSnapshot(page, rootId)).definitionDefaults;
  const collapsed = await exportFromBlock(page, rootId);
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  await assertExpandedBlockContainsProjection(page, rootId);
  expect(await exportFromBlock(page, rootId)).toEqual(collapsed);
  if (editing) expect((await blockSnapshot(page, rootId)).resolvedValues.image).toEqual(storedReferences);
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
      offloadMode: expectedOffloadMode,
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
    offload_mode: { value: expectedOffloadMode },
    repo_id: { value: { source: 'hub', value: scenario.repository } },
    revision: { value: scenario.revision },
  });
  expect((loader?.params?.quant_config as { value?: unknown } | undefined)?.value).toBeUndefined();
  expect(JSON.stringify(graph.nodes)).toContain(JSON.stringify(prompt));
  expect(JSON.stringify(graph.nodes)).not.toContain('blockInstanceV2');
  if (editing) {
    const imageLoaders = Object.values(graph.nodes).filter(
      (node) => node.module === 'modules.Image' && node.action === 'Load',
    );
    expect(imageLoaders).toHaveLength(1);
    expect(imageLoaders[0]!.params?.file).toMatchObject({ value: storedReferences });
  }
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
  const statistics = await decodedImageStatistics(page, await readFile(assetPath));
  await writeFile(`${evidenceRoot}/image-statistics.json`, JSON.stringify(statistics, null, 2));
  // This proof asks for a detailed photograph: a black NaN-conversion output
  // cannot pass simply because its encoded dimensions are correct.
  expect(statistics.maximum - statistics.minimum).toBeGreaterThan(16);
  expect(statistics.standardDeviation).toBeGreaterThan(2);
  const expectedInputs = {
    prompt,
    width: 1024,
    height: 1024,
    steps: scenario.steps,
    // Distilled Klein has no guider component and consumes no guidance_scale.
    // Do not relabel a historical form default as an executed model argument.
    ...(variant === 'klein' ? {} : { guidanceScale: scenario.guidance }),
    seed: 20260905,
  };
  expect(output!.resolvedExecutionInputs).toMatchObject({
    source: 'backend-execution',
    taskId,
    summary: { ...expectedInputs, offloadMode: expectedOffloadMode },
  });
  await assertCapturedImageInGallery(page, taskId, expectedInputs, `${evidenceRoot}/gallery-resolved-inputs.png`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await assertCapturedImageInGallery(
    page,
    taskId,
    expectedInputs,
    `${evidenceRoot}/gallery-resolved-inputs-after-refresh.png`,
  );
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
        inputImages: references,
        uploadedReferences,
        storedReferences,
        settings: {
          width: 1024,
          height: 1024,
          steps: scenario.steps,
          guidance: scenario.guidance,
          guidanceConsumed: variant !== 'klein',
          seed: 20260905,
          quantization: 'none',
          offloadMode: expectedOffloadMode,
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
          multiReferencePickerByteOrderAndPersistence: references.length > 1,
          capturedNumericInputsInGalleryBeforeAndAfterRefresh: true,
        },
        showcaseCandidate: true,
        approved: false,
        pageErrors: errors,
      },
      null,
      2,
    )}\n`,
  );
  expect(errors).toEqual([]);
  await writeFile(
    `${evidenceRoot}/PARAMETERS.md`,
    `# ${scenario.label}\n\nSaved workflow: ${workflowName}\n\nModel: ${scenario.repository}@${scenario.revision}\n\n1024×1024; ${scenario.steps} steps; ${variant === 'klein' ? 'guidance is not consumed by this distilled route (form recommendation: 1)' : `guidance ${scenario.guidance}`}; fixed seed 20260905. BF16, offload: ${expectedOffloadMode} (checked against backend execution inputs), no quantization.\n\n${inputImage ? `Input: ${inputImage}\n\n` : ''}## Prompt\n\n${prompt}\n\n## Evidence\n\nPassed frontend insert/edit/expand/save/refresh/export parity/generate. See frontend-result.json and submitted-workflow.json for exact values and identity. Creator defaults were not changed.\n\nModel-card reference: ${modelCard}\n\nOutput is a review candidate, not approved publication.\n`,
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

/** Acceptance recipes are explicit instance edits, never catalog default changes. */
function qwenFullQualityScenario(scenario: QwenV2AdmissionExecution): QwenV2AdmissionExecution {
  const layered = scenario.id === 'qwen-image-layered';
  const control = scenario.id.includes('-control');
  const editPlus = scenario.repository === 'Qwen/Qwen-Image-Edit-2511';
  const strengthOverride = process.env.MODIFF_QWEN_QUALITY_STRENGTH;
  if (
    strengthOverride !== undefined &&
    (!Number.isFinite(Number(strengthOverride)) || Number(strengthOverride) <= 0 || Number(strengthOverride) > 1)
  ) {
    throw new Error('The explicit quality-instance strength must be greater than zero and at most one.');
  }
  const prompts: Record<string, string> = {
    'qwen-image-image-to-image':
      'An architectural scale model of the reference interior made from glazed cobalt-blue ceramic. Preserve the reference composition: a narrow console with a rectangular lidded box on the right, a shallow bowl and folded cloth on the left, a wicker-shaped basket beneath, a tall open doorway at left and two wall hooks. All objects are carefully sculpted ceramic miniatures, with subtle glaze highlights, precise edges, soft window light and convincing shadows. No new furniture or text.',
    'qwen-image-inpaint':
      'A realistic photograph of a yellow room and an oak console. In the masked area on the right of the console stands a short round cobalt-blue ceramic vase, with a narrow neck, rich glossy glaze and soft reflected window light. No box in the masked area. Preserve the doorway, hooks, bowl, rust-red cloth, basket, furniture and the unmasked yellow wall. Natural contact shadow under the vase, consistent camera perspective.',
    'qwen-image-edit':
      'Replace only the black storage box on the wooden console with a glossy turquoise ceramic vase containing three delicate white magnolia branches. Preserve the yellow wall, doorway, hooks, ceramic bowl, rust-red folded cloth, wicker basket, wooden furniture, camera position and soft daylight. Realistic ceramic glaze, natural branches and grounded contact shadows. Do not add or remove other objects.',
    'qwen-image-edit-inpaint':
      'Replace only the masked black storage box with a short round red ceramic vase with a narrow neck. Keep the vase inside the masked region, with realistic glossy glaze and a natural contact shadow. Preserve the yellow wall, doorway, hooks, bowl, folded rust-red cloth, wicker basket, wood grain, camera angle and lighting outside the mask.',
    'qwen-image-layered':
      'A softly sunlit yellow interior. An oak console holds a black lidded storage box on the right, a white ceramic bowl and a folded rust-red cloth on the left. A woven wicker basket stands underneath. The background contains a doorway on the left and two small dark wall hooks.',
    'qwen-image-control':
      'A realistic interior photograph following the supplied edge geometry: a narrow oak console against a warm yellow wall, an open doorway at left, two dark hooks, a ceramic bowl and rust-red folded cloth on the left of the table, a rectangular blue lacquered storage box with a lid on the right and a woven basket beneath. Preserve the strong perspective lines, object silhouettes and placement. Soft daylight, natural shadows and detailed wood grain.',
    'qwen-image-control-image-to-image':
      'Restyle the reference interior as a sophisticated navy-blue study while following the supplied edge geometry. Change the wall to deep navy, the console to warm walnut and the rectangular storage box to polished brass. Preserve the doorway, hooks, bowl, folded cloth, basket, camera perspective, furniture silhouettes and exact object placement. Soft window light and realistic material reflections.',
    'qwen-image-control-inpaint':
      'Change only the masked black storage box into a cobalt-blue lacquered storage box with the same rectangular silhouette, hinged lid and front clasp. Keep its geometry aligned with the control edges. Preserve all unmasked room details, the yellow wall, doorway, bowl, red cloth, basket, wood grain and daylight. Realistic glossy blue lacquer and a subtle contact shadow.',
  };
  return {
    ...scenario,
    values: {
      ...scenario.values,
      ...(prompts[scenario.id] ? { prompt: prompts[scenario.id] } : {}),
      num_inference_steps: editPlus ? 40 : control ? 30 : 50,
      guidanceScale: 4,
      ...('width' in scenario.values ? { width: 1024, height: 1024 } : {}),
      ...(control
        ? {
            control_image: '@data/images/qwen_inpaint_object_replace.reference_image_1.webp',
            controlnet_conditioning_scale: 0.9,
            control_guidance_start: 0,
            control_guidance_end: 1,
          }
        : {}),
      ...(layered ? { layers: 4, resolution: 640 } : {}),
      ...(strengthOverride !== undefined && 'strength' in scenario.values
        ? { strength: Number(strengthOverride) }
        : {}),
    },
    ...(layered ? { expectedMediaItems: 4 } : {}),
  };
}

async function insertCannyIntoQwenControl(page: Page, rootId: string, root: Locator) {
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
  await page.getByTestId('arrange-graph').click();
  await page.getByLabel('Search nodes').fill('Canny Edge Detection');
  const group = page.getByTestId('node-group-image-filter');
  await expect(group).toBeVisible();
  if ((await group.getByRole('button').first().getAttribute('aria-expanded')) !== 'true')
    await group.getByRole('button').first().click();
  // Expanded root backgrounds are pointer-transparent. Drop on the actual
  // canvas pane at a point inside its geometry, as the user's pointer does.
  const pane = page.locator('.react-flow__pane');
  let previousGeometry = '';
  let stableSamples = 0;
  await expect
    .poll(
      async () => {
        const box = await root.boundingBox();
        const geometry = JSON.stringify(box && Object.values(box).map((value) => Math.round(value)));
        stableSamples = geometry === previousGeometry ? stableSamples + 1 : 0;
        previousGeometry = geometry;
        return stableSamples;
      },
      { intervals: [150], timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(3);
  await expect(pane).toBeVisible();
  const rootBox = (await root.boundingBox())!;
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, {
    x: rootBox.x + 8,
    y: rootBox.y + 45,
  });
  expect(String(hit)).toContain('react-flow__pane');
  await page.evaluate(() => {
    const events: unknown[] = [];
    Object.assign(window, { __qwenCannyDragEvents: events });
    for (const type of ['dragstart', 'dragenter', 'dragover', 'drop', 'dragend']) {
      document.addEventListener(
        type,
        (event) => {
          const drag = event as DragEvent;
          events.push({
            type,
            x: drag.clientX,
            y: drag.clientY,
            target: (drag.target as HTMLElement)?.className,
            data: drag.dataTransfer?.getData('text/plain'),
            types: [...(drag.dataTransfer?.types ?? [])],
          });
        },
        { capture: true, passive: true },
      );
    }
  });
  const sourceBox = (await page.getByTestId('node-row-modules-ImageFilters-Canny').boundingBox())!;
  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(sourceX + 12, sourceY, { steps: 3 });
  await page.mouse.move(rootBox.x + 8, rootBox.y + 45, { steps: 20 });
  // HTML drag targets receive dragover only after a second pointer movement.
  await page.mouse.move(rootBox.x + 9, rootBox.y + 45);
  await page.mouse.up();
  await test.info().attach('canny-native-drag', {
    body: JSON.stringify(await page.evaluate(() => Reflect.get(window, '__qwenCannyDragEvents')), null, 2),
    contentType: 'application/json',
  });
  const inspect = () =>
    page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const flow = useFlowStore.getState();
      const instance = flow.nodes.find((node) => node.id === id)!.data.blockInstanceV2!;
      const canny = instance.effectiveGraph.nodes.find((node) => node.data.action === 'Canny');
      const original = instance.definitionSnapshot.graph.edges.find(
        (edge) => edge.targetNodeId === 'controlnet' && edge.targetPortId === 'control_image',
      );
      if (!canny || !original) return null;
      const handle = (semanticId: string, field: string, direction: 'input' | 'output') => {
        for (const node of flow.nodes.filter((node) => node.data.blockProjectionOwnerId === id)) {
          const binding = Object.entries(node.data.blockProjectionPortBindings ?? {}).find(
            ([, item]) => item.nodeId === semanticId && item.fieldOrPortId === field && item.direction === direction,
          );
          if (binding) return `node-handle-${node.id}-${binding[0]}`;
          if (node.data.blockProjectionNodeId === semanticId && node.data.params?.[field])
            return `node-handle-${node.id}-${field}`;
        }
        throw new Error(`Missing projected ${semanticId}.${field} ${direction}`);
      };
      return {
        cannyId: canny.nodeId,
        cannyProjectionId: flow.nodes.find((node) => node.data.blockProjectionNodeId === canny.nodeId)?.id,
        cannyOutputMode: (canny.data.params?.output_mode as { value?: string } | undefined)?.value,
        original,
        source: handle(original.sourceNodeId, original.sourcePortId, 'output'),
        cannyInput: handle(canny.nodeId, 'image', 'input'),
        cannyOutput: handle(canny.nodeId, 'output', 'output'),
        target: handle('controlnet', 'control_image', 'input'),
        edges: instance.effectiveGraph.edges,
      };
    }, rootId);
  await expect.poll(inspect).not.toBeNull();
  await page.getByTestId('arrange-graph').click();
  const state = (await inspect())!;
  // The upstream ControlNet VAE expects RGB. Choose the ordinary processor's
  // explicit format control; do not silently rewrite its grayscale default.
  const outputMode = page.locator(`.react-flow__node[data-id="${state.cannyProjectionId}"] [data-key="output_mode"]`);
  await outputMode.getByRole('button').first().click();
  await page.getByRole('option', { name: 'RGB', exact: true }).click();
  await expect.poll(async () => (await inspect())!.cannyOutputMode).toBe('RGB');
  for (const [sourceId, targetId] of [
    [state.source, state.cannyInput],
    [state.cannyOutput, state.target],
  ]) {
    const source = page.getByTestId(sourceId!);
    const target = page.getByTestId(targetId!);
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();
    const from = (await source.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 18 });
    await page.mouse.up();
  }
  await expect
    .poll(async () => (await inspect())!.edges)
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: state.original.sourceNodeId,
          targetNodeId: state.cannyId,
          targetPortId: 'image',
        }),
        expect.objectContaining({
          sourceNodeId: state.cannyId,
          sourcePortId: 'output',
          targetNodeId: 'controlnet',
          targetPortId: 'control_image',
        }),
      ]),
    );
  expect(
    (await inspect())!.edges.some(
      (edge) =>
        edge.sourceNodeId === state.original.sourceNodeId &&
        edge.targetNodeId === 'controlnet' &&
        edge.targetPortId === 'control_image',
    ),
  ).toBe(false);
  await assertExpandedBlockContainsProjection(page, rootId);
  await root.getByTestId(`user-block-toggle-${rootId}`).click();
}

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
  const fullQuality = process.env.MODIFF_QWEN_FULL_QUALITY === '1';
  const offloadMode = process.env.MODIFF_QWEN_RESOURCE_OFFLOAD_MODE ?? 'model_cpu';
  if (!['none', 'model_cpu', 'group_cpu', 'group_disk'].includes(offloadMode))
    throw new Error('Invalid explicit Qwen qualification offload mode.');
  const autoOffload = offloadMode !== 'none';
  const scenarios = QWEN_V2_ADMISSION_EXECUTIONS.map((scenario) =>
    fullQuality ? qwenFullQualityScenario(scenario) : scenario,
  )
    .slice(Number.isInteger(startAt) && startAt >= 0 ? startAt : 0)
    .slice(0, Number.isInteger(limit) && limit > 0 ? limit : QWEN_V2_ADMISSION_EXECUTIONS.length);
  const editPlusQuality = process.env.MODIFF_QWEN_EDIT_PLUS_QUALITY === '1';
  if (editPlusQuality) {
    expect(scenarios.every((scenario) => scenario.repository === 'Qwen/Qwen-Image-Edit-2511')).toBe(true);
  }
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
    console.log(`[qwen-v2-execution] inserted ${scenario.id}`);
    const creatorDefaults = (await blockSnapshot(page, rootId)).definitionDefaults;
    const runValues = { ...scenario.values };
    if (editPlusQuality || fullQuality) {
      // Instance-only acceptance settings from the pinned creator example.
      // Do not rewrite catalog defaults or silently upgrade the smoke recipe.
      delete runValues.image;
      delete runValues.prompt;
      delete runValues.num_inference_steps;
    }
    await page.evaluate(
      async ({ id, values, offloadMode, autoOffload }) => {
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
          ['autoOffload', autoOffload],
          ['offloadMode', offloadMode],
        ] as const) {
          if (available.has(logicalId)) flow.setBlockInstanceValueV2(id, logicalId, value);
        }
      },
      { id: rootId, values: runValues, offloadMode, autoOffload },
    );
    const uploadedReferences: Array<{ source: string; stored: string; sha256: string }> = [];
    if (editPlusQuality || fullQuality) {
      const advanced = root.getByRole('button', { name: 'Advanced', exact: true });
      if (await advanced.isVisible()) await advanced.click();
      const prompt =
        fullQuality && scenario.repository !== 'Qwen/Qwen-Image-Edit-2511'
          ? String(scenario.values.prompt)
          : scenario.route === 'multi-reference'
            ? 'Use image 1 as the base photograph. Replace only the black storage box on the wooden console with a tabletop miniature of the brass observatory in image 2. Preserve the observatory’s domed roof, weather vane, glowing golden globe, exposed gears and circular balcony. Scale it to fit naturally on the console. Preserve the yellow wall, doorway, hooks, ceramic bowl, rust-red folded cloth, wicker basket, wooden furniture, camera angle and soft daylight from image 1. Realistic brass reflections and contact shadows; one coherent interior photograph, no collage, no extra furniture.'
            : 'Replace only the black storage box on the wooden console with a glossy turquoise ceramic vase containing three delicate white magnolia branches. Preserve the yellow wall, doorway, hooks, ceramic bowl, rust-red folded cloth, wicker basket, wooden furniture, camera position and soft daylight exactly. Realistic ceramic glaze, natural branch shapes and grounded contact shadows. Do not add or remove any other objects.';
      await fillBlockValueAndAssert(page, rootId, root.getByLabel('prompt', { exact: true }), 'prompt', prompt, prompt);
      await fillBlockValueAndAssert(
        page,
        rootId,
        root.getByLabel('num inference steps', { exact: true }),
        'num_inference_steps',
        String(fullQuality ? scenario.values.num_inference_steps : 40),
        String(fullQuality ? scenario.values.num_inference_steps : 40),
      );
      const fields = root.getByLabel('image', { exact: true });
      for (let index = (await fields.count()) - 1; index >= 0; index -= 1) {
        await fields.nth(index).fill('');
        await fields.nth(index).press('Tab');
      }
      const sources = (scenario.values.image ?? []) as string[];
      const files = [];
      for (const [index, source] of sources.entries()) {
        const response = await page.request.get(`${LIVE_BACKEND_URL}/file?file=${encodeURIComponent(source)}`);
        expect(response.ok()).toBe(true);
        const buffer = await response.body();
        files.push({ name: `qwen-reference-${index + 1}.webp`, mimeType: 'image/webp', buffer });
        uploadedReferences.push({ source, stored: '', sha256: createHash('sha256').update(buffer).digest('hex') });
      }
      if (sources.length) {
        // Inpainting exposes mask_image before image; never choose a picker by
        // DOM order or a reference photo can silently become a second mask.
        const imagePicker = root
          .locator('.modiff-field')
          .filter({ has: page.getByLabel('image', { exact: true }) })
          .locator('input[type="file"]');
        await expect(imagePicker).toHaveCount(1);
        await imagePicker.setInputFiles(files);
        await expect
          .poll(async () => (await blockSnapshot(page, rootId)).resolvedValues.image)
          .toHaveLength(sources.length);
      }
      const stored = ((await blockSnapshot(page, rootId)).resolvedValues.image ?? []) as string[];
      for (const logicalId of ['mask_image', 'control_image']) {
        if (logicalId in scenario.values) {
          expect((await blockSnapshot(page, rootId)).resolvedValues[logicalId]).toEqual(scenario.values[logicalId]);
        }
      }
      const maskFile = process.env.MODIFF_QWEN_QUALITY_MASK_FILE;
      if (maskFile) {
        expect(fullQuality && 'mask_image' in scenario.values).toBe(true);
        const buffer = await readFile(maskFile);
        const picker = root
          .locator('.modiff-field')
          .filter({ has: page.getByLabel('mask image', { exact: true }) })
          .locator('input[type="file"]');
        await expect(picker).toHaveCount(1);
        const original = scenario.values.mask_image;
        const maskFields = root.getByLabel('mask image', { exact: true });
        for (let index = (await maskFields.count()) - 1; index >= 0; index -= 1) {
          await maskFields.nth(index).fill('');
          await maskFields.nth(index).press('Tab');
        }
        await picker.setInputFiles({ name: 'qwen-box-and-shadow-mask.png', mimeType: 'image/png', buffer });
        await expect
          .poll(async () => (await blockSnapshot(page, rootId)).resolvedValues.mask_image)
          .not.toEqual(original);
        const storedMask = (await blockSnapshot(page, rootId)).resolvedValues.mask_image;
        const masks = Array.isArray(storedMask) ? storedMask : [storedMask];
        expect(masks).toHaveLength(1);
        expect(typeof masks[0]).toBe('string');
        const response = await page.request.get(
          `${LIVE_BACKEND_URL}/file?file=${encodeURIComponent(String(masks[0]))}`,
        );
        expect(response.ok()).toBe(true);
        const sha256 = createHash('sha256').update(buffer).digest('hex');
        expect(
          createHash('sha256')
            .update(await response.body())
            .digest('hex'),
        ).toBe(sha256);
        scenario.values.mask_image = storedMask;
        await writeFile(
          `${evidenceRoot}/${scenario.id}-mask-upload.json`,
          `${JSON.stringify({ original, source: maskFile, stored: storedMask, sha256 }, null, 2)}\n`,
        );
      }
      for (const [index, reference] of uploadedReferences.entries()) {
        reference.stored = stored[index]!;
        const response = await page.request.get(
          `${LIVE_BACKEND_URL}/file?file=${encodeURIComponent(reference.stored)}`,
        );
        expect(response.ok()).toBe(true);
        expect(
          createHash('sha256')
            .update(await response.body())
            .digest('hex'),
        ).toBe(reference.sha256);
      }
      expect((await blockSnapshot(page, rootId)).definitionDefaults).toEqual(creatorDefaults);
    }
    if (fullQuality && scenario.id.includes('-control')) await insertCannyIntoQwenControl(page, rootId, root);
    const controlScale = process.env.MODIFF_QWEN_QUALITY_CONTROL_SCALE;
    if (controlScale !== undefined) {
      expect(fullQuality && scenario.id.includes('-control')).toBe(true);
      const value = Number(controlScale);
      expect(Number.isFinite(value) && value >= 0 && value <= 2).toBe(true);
      const field = root.getByLabel('controlnet conditioning scale', { exact: true });
      if (!(await field.isVisible())) {
        const advanced = root.getByRole('button', { name: 'Advanced', exact: true });
        if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click();
      }
      const before = (await blockSnapshot(page, rootId)).resolvedValues;
      const formatted = value.toFixed(2);
      await fillBlockValueAndAssert(page, rootId, field, 'controlnet_conditioning_scale', formatted, formatted);
      const after = (await blockSnapshot(page, rootId)).resolvedValues;
      expect(after).toEqual({ ...before, controlnet_conditioning_scale: formatted });
      expect(Number(after.controlnet_conditioning_scale)).toBe(value);
      scenario.values.controlnet_conditioning_scale = formatted;
      expect((await blockSnapshot(page, rootId)).definitionDefaults).toEqual(creatorDefaults);
    }
    console.log(`[qwen-v2-execution] configured ${scenario.id}`);
    const collapsedExport = await exportFromBlock(page, rootId);
    const modelLoader = Object.values(collapsedExport.nodes).find(
      (node) => node.module === 'modules.ModularDiffusers' && node.action === 'ModelsLoader',
    );
    expect(modelLoader?.params).toMatchObject({
      dtype: { value: 'bfloat16' },
      auto_offload: { value: autoOffload },
      offload_mode: { value: offloadMode },
    });
    await root.getByTestId(`user-block-toggle-${rootId}`).click();
    await assertExpandedBlockContainsProjection(page, rootId);
    expect(await exportFromBlock(page, rootId)).toEqual(collapsedExport);
    await root.getByTestId(`user-block-toggle-${rootId}`).click();
    const beforeSave = (await blockSnapshot(page, rootId)).instanceJson;

    await page.getByTestId('topbar-save-workflow').click();
    const saveDialog = page.getByTestId('save-workflow-dialog');
    await expect(saveDialog).toBeVisible({ timeout: 120_000 });
    {
      await page.getByTestId('save-workflow-name').fill(`Qwen V2 Execution ${scenario.id} ${Date.now()}`);
      const saveStartedAt = Date.now();
      const saveResponse = page.waitForResponse(
        (response) => response.request().method() === 'PUT' && /\/workflows\/[^/]+$/u.test(response.url()),
        { timeout: 60_000 },
      );
      await page.getByTestId('confirm-save-workflow').click();
      const response = await saveResponse;
      await writeFile(
        `${evidenceRoot}/${scenario.id}-save-response.json`,
        `${JSON.stringify({ status: response.status(), elapsedMs: Date.now() - saveStartedAt, timing: response.request().timing() }, null, 2)}\n`,
      );
      expect(response.ok()).toBe(true);
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

    if (process.env.MODIFF_QWEN_PREPARE_ONLY === '1') {
      await writeFile(
        `${evidenceRoot}/${scenario.id}-prepared.json`,
        `${JSON.stringify({ rootId, instance: (await blockSnapshot(page, rootId)).instanceJson, graph: collapsedExport }, null, 2)}\n`,
      );
      console.log(`[qwen-v2-execution] prepared without submission ${scenario.id}`);
      continue;
    }
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
    await writeFile(
      `${evidenceRoot}/${scenario.id}-submitted-graph.json`,
      `${JSON.stringify(submittedGraph, null, 2)}\n`,
    );
    const taskId = ((await response.json()) as { task_id?: string }).task_id;
    expect(taskId).toBeTruthy();
    console.log(`[qwen-v2-execution] submitted ${scenario.id} as task ${taskId}`);
    await writeFile(
      `${evidenceRoot}/${scenario.id}-submission.json`,
      `${JSON.stringify({ taskId, submittedAt: new Date().toISOString(), values: (await blockSnapshot(page, rootId)).resolvedValues }, null, 2)}\n`,
    );
    const task = await waitForTask(page, taskId!, (fullQuality ? 240 : 90) * 60 * 1000);
    const displayType = scenario.displayType ?? 'image';
    await expect
      .poll(() => findLiveStudioOutput(page, taskId!, displayType), {
        timeout: 120_000,
        intervals: [500, 1000, 2000],
      })
      .toMatchObject({ taskId, displayType });
    const output = await findLiveStudioOutput(page, taskId!, displayType);
    if (!output) throw new Error(`Qwen V2 ${scenario.id} completed without a ${displayType} output.`);
    if (fullQuality || editPlusQuality) {
      const values = (await blockSnapshot(page, rootId)).resolvedValues;
      expect(output.resolvedExecutionInputs).toMatchObject({
        source: 'backend-execution',
        taskId,
        summary: {
          prompt: values.prompt,
          steps: Number(values.num_inference_steps),
          guidanceScale: 4,
          seed: Number(values.seed),
          dtype: 'bfloat16',
          autoOffload,
          offloadMode,
          quantConfig: null,
        },
      });
      // ControlNet graphs have multiple genuine repository/revision values.
      // Inspect the primary loader, not a fabricated single-model summary.
      const receipt = output.resolvedExecutionInputs as {
        nodes: Array<{ module: string; action: string; fields: Record<string, { value: unknown }> }>;
      };
      const loaders = receipt.nodes.filter(
        (node) => node.module === 'modules.ModularDiffusers' && node.action === 'ModelsLoader',
      );
      expect(loaders).toHaveLength(1);
      expect(loaders[0]!.fields).toMatchObject({
        repo_id: { value: scenario.repository },
        revision: { value: scenario.revision },
        dtype: { value: 'bfloat16' },
        quant_config: { value: null },
      });
    }
    const runRecord = await page.request.get(`${LIVE_BACKEND_URL}/runs/${encodeURIComponent(taskId!)}`);
    expect(runRecord.ok()).toBe(true);
    await writeFile(`${evidenceRoot}/${scenario.id}-run.json`, `${JSON.stringify(await runRecord.json(), null, 2)}\n`);
    expect((await blockSnapshot(page, rootId)).definitionDefaults).toEqual(creatorDefaults);
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
      values: (await blockSnapshot(page, rootId)).resolvedValues,
      recipeKind: fullQuality
        ? 'full-setting-family-acceptance'
        : editPlusQuality
          ? 'creator-setting-edit-plus-acceptance'
          : 'two-step-smoke',
      uploadedReferences,
      definitionDefaults: (await blockSnapshot(page, rootId)).definitionDefaults,
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

test('completed Edit Plus quality proof exposes consumed inputs in the Gallery', async ({ page }) => {
  const taskId = process.env.MODIFF_QWEN_EDIT_PLUS_INSPECT_TASK;
  const outputDirectory = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  test.skip(
    !taskId || !outputDirectory,
    'Select an existing Edit Plus quality task explicitly; never submit a new run.',
  );
  test.setTimeout(20 * 60 * 1000);
  await waitForTask(page, taskId!, 18 * 60 * 1000);
  const response = await page.request.get(`${LIVE_BACKEND_URL}/runs/${encodeURIComponent(taskId!)}`);
  expect(response.ok()).toBe(true);
  const record = await response.json();
  const instance = record.workflow_snapshot.nodes.find(
    (node: { data?: { blockInstanceV2?: unknown } }) => node.data?.blockInstanceV2,
  ).data.blockInstanceV2;
  expect(instance.definitionSnapshot.source.repository).toBe('Qwen/Qwen-Image-Edit-2511');
  expect(instance.values.image).toHaveLength(2);
  expect(Number(instance.values.num_inference_steps)).toBe(40);
  expect(instance.values.seed).toBe(52009);
  const output = record.outputs.find(
    (item: LiveStudioOutput) => item.taskId === taskId && item.displayType === 'image',
  );
  expect(output).toBeTruthy();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await dismissTaskLauncher(page);
  const analysis = await analyzeImageOutput(page, output);
  expect(analysis.ok).toBe(true);
  await mkdir(outputDirectory!, { recursive: true });
  await writeFile(`${outputDirectory}/completed-run.json`, `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(`${outputDirectory}/image-analysis.json`, `${JSON.stringify(analysis, null, 2)}\n`);
  await assertCapturedImageInGallery(
    page,
    taskId!,
    {
      prompt: instance.values.prompt,
      width: analysis.analyses[0]!.width,
      height: analysis.analyses[0]!.height,
      steps: 40,
      guidanceScale: 4,
      seed: 52009,
    },
    `${outputDirectory}/gallery-consumed-inputs.png`,
    true,
  );
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
  await expect(page.getByRole('radio', { name: 'Creator', exact: true })).toHaveAttribute('aria-checked', 'false');
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

  const autoSwitch = page.getByRole('radio', { name: 'Creator', exact: true });
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
