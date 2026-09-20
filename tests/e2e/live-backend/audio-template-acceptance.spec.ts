import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const templateId = process.env.MODIFF_AUDIO_TEMPLATE ?? 'minimax_music3_chamber_pop';
const allowed = new Set([
  'minimax_music3_chamber_pop',
  'ace_step_text_to_audio',
  'ace_step_audio_variation',
  'ace_step_audio_continuation',
  'ace_step_audio_repaint',
  'ace_step_chinese_new_year_lora',
]);

test.afterEach(async ({ page }, info) => {
  const output = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  if (!output || info.status === info.expectedStatus || page.isClosed()) return;
  const diagnostic = await page
    .evaluate(async () => {
      const studio = (await import('/src/stores/useStudioStore.ts')).useStudioStore.getState();
      return {
        lastError: studio.lastError,
        finalization: studio.graphFinalization,
        activeTemplateId: studio.activeTemplateId,
        visibleText: document.body.innerText,
      };
    })
    .catch(() => null);
  await writeFile(`${output}/failure.json`, JSON.stringify(diagnostic, null, 2));
});

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const [{ useFlowStore }, { useStudioStore }, { STUDIO_TEMPLATES }] = await Promise.all([
      import('/src/stores/useFlowStore.ts'),
      import('/src/stores/useStudioStore.ts'),
      import('/src/studio/templates.ts'),
    ]);
    const flow = useFlowStore.getState();
    const studio = useStudioStore.getState();
    const exported = flow.exportGraph('audio-template-acceptance');
    return {
      form: studio.form,
      template: STUDIO_TEMPLATES.find((item) => item.id === studio.activeTemplateId),
      exported: { nodes: exported.nodes, paths: exported.paths },
      lastError: studio.lastError,
      canvasTransition: studio.canvasTransition,
      binding: studio.graphBinding,
      schemas: Object.fromEntries(flow.nodes.map((node) => [node.id, node.data.params])),
    };
  });
}

test('authored audio template preserves settings through the requested native lifecycle', async ({ page }) => {
  test.skip(process.env.MODIFF_RUN_AUDIO_TEMPLATE !== '1', 'Explicit real-backend template acceptance opt-in.');
  if (!allowed.has(templateId)) throw new Error(`Unreviewed audio template ${templateId}`);
  const generate = process.env.MODIFF_AUDIO_GENERATE === '1';
  if (templateId.startsWith('minimax') && process.env.MODIFF_ACKNOWLEDGE_MINIMAX_MUSIC3_LICENSE !== '1') {
    throw new Error('MiniMax requires the already-authorized local model-use acknowledgement.');
  }
  const output = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  if (!output) throw new Error('Private output directory required.');
  await mkdir(output, { recursive: true, mode: 0o700 });
  test.setTimeout(generate ? 3 * 60 * 60_000 : 6 * 60_000);
  page.setDefaultTimeout(60_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors: string[] = [];
  const fieldActions: unknown[] = [];
  const completions: unknown[] = [];
  const diagnostics: unknown[] = [];
  page.on('console', async (message) => {
    if (message.type() === 'error')
      diagnostics.push(await Promise.all(message.args().map((arg) => arg.jsonValue().catch(() => message.text()))));
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', async (response) => {
    if (new URL(response.url()).pathname === '/fields/action') {
      fieldActions.push({
        request: response.request().postDataJSON(),
        response: await response.json().catch(() => null),
      });
    }
  });
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload)) as { type?: string };
        if (['graph_completed', 'graph_error', 'set_field_params', 'set_field_value'].includes(message.type ?? ''))
          completions.push(message);
      } catch {
        /* Ignore non-JSON frames. */
      }
    }),
  );
  const evidence: Record<string, unknown> = { templateId, errors, completions, fieldActions, diagnostics };
  const save = () => writeFile(`${output}/receipt.json`, JSON.stringify(evidence, null, 2));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 180_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  await expect(advanced).toBeVisible();
  await advanced.click();
  await expect(advanced).toHaveCount(0);
  const auto = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await auto.getAttribute('aria-checked')) === 'true')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await page.getByTestId('topbar-templates').click();
  await page.getByTestId('template-browser-search').fill(
    templateId.startsWith('minimax')
      ? 'Leave a Little Light'
      : ({
          ace_step_text_to_audio: 'Alternative-Metal Song',
          ace_step_audio_variation: 'Alternate Arrangement',
          ace_step_audio_continuation: 'Extend Track',
          ace_step_audio_repaint: 'Replace Segment',
          ace_step_chinese_new_year_lora: 'Chinese New Year Ensemble',
        }[templateId] ?? ''),
  );
  await page.getByTestId(`template-browser-create-card-${templateId}`).click();
  const terms = page.getByTestId('template-usage-terms-dialog');
  if (await terms.isVisible().catch(() => false)) await page.getByTestId('template-usage-terms-confirm').click();
  await expect(page.getByTestId('template-browser-search')).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).template?.id).toBe(templateId);
  await expect
    .poll(
      async () => {
        const state = await snapshot(page);
        return state.lastError ?? (Object.keys(state.exported.nodes).length > 0 ? 'graph-created' : 'pending');
      },
      { timeout: 60_000 },
    )
    .not.toBe('pending');
  await expect.poll(async () => (await snapshot(page)).canvasTransition).toBeNull();
  const prepared = await snapshot(page);
  evidence.prepared = prepared;
  await save();
  expect(
    Object.keys(prepared.exported.nodes).length,
    prepared.lastError ?? 'Template must create its real graph',
  ).toBeGreaterThan(0);
  await expect(page.getByTestId('studio-run')).toBeEnabled({ timeout: 180_000 });
  if (templateId.startsWith('minimax')) {
    await expect
      .poll(async () => {
        const state = await snapshot(page);
        return Object.values(state.exported.nodes).find((node) => node.action === 'ModelsLoader')?.params
          .reviewed_variant?.value;
      })
      .toBe('MiniMaxAI/MiniMax-Music3');
  }
  const before = await snapshot(page);
  expect(before.form.prompt).toBe(before.template!.prompt);
  expect(before.form.steps).toBe(before.template!.example!.lockedSettings!.steps);
  expect(before.form.lyrics).toBe(before.template!.example!.lockedSettings!.lyrics);
  expect(before.form.seed).toBe(before.template!.example!.lockedSeed);
  evidence.before = before;
  await save();
  const saved = page.waitForResponse(
    (response) =>
      /\/workflows(?:\/[^/]+)?$/u.test(new URL(response.url()).pathname) &&
      ['POST', 'PUT'].includes(response.request().method()),
  );
  await page.getByTestId('topbar-save-workflow').click();
  // Template creation already names and persists its new workflow. A later
  // Save can overwrite that owned file directly, unlike a fresh palette graph.
  if (await page.getByTestId('save-workflow-dialog').isVisible()) {
    await page.getByTestId('save-workflow-name').fill(`Audio template acceptance ${templateId} ${Date.now()}`);
    await page.getByTestId('confirm-save-workflow').click();
  }
  expect((await saved).ok()).toBe(true);
  await expect(page.getByTestId('save-workflow-dialog')).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 180_000 });
  await expect.poll(async () => (await snapshot(page)).exported).toEqual(before.exported);
  await expect(page.getByTestId('studio-run')).toBeEnabled({ timeout: 60_000 });
  evidence.restored = await snapshot(page);
  await page.screenshot({ path: `${output}/template-restored.png` });
  await save();
  if (!generate) return;
  const runs: unknown[] = [];
  evidence.runs = runs;
  const hashes: string[] = [];
  const runCount = process.env.MODIFF_AUDIO_SINGLE_RUN === '1' ? 1 : 2;
  const cancelRecovery = process.env.MODIFF_AUDIO_CANCEL_RECOVERY === '1';
  for (let repeat = cancelRecovery ? -1 : 0; repeat < runCount; repeat += 1) {
    if (repeat > 0) {
      // A second Run normally reuses cached node outputs. Evict compute-node
      // caches through the real toolbar so this proves independent inference.
      await page.getByTestId('arrange-graph').click();
      const ids = await page.evaluate(async () =>
        (await import('/src/stores/useFlowStore.ts')).useFlowStore
          .getState()
          .nodes.filter((node) => node.data.isCached && !['ModelsLoader', 'LoadPipeline'].includes(node.data.action))
          .map((node) => node.id),
      );
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        await page.locator(`.react-flow__node[data-id="${id}"] header`).first().click();
        await page.getByTestId('selection-toolbar-more').click();
        await page.getByRole('menuitem', { name: 'Clear cache', exact: true }).click();
      }
      evidence.clearedComputeNodes = ids;
      await save();
    }
    const submitted = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/graph' && response.request().method() === 'POST',
      { timeout: 180_000 },
    );
    await page.getByTestId('studio-run').click();
    const modelTerms = page.getByTestId('model-usage-terms-dialog');
    if (await modelTerms.isVisible().catch(() => false)) await page.getByTestId('model-usage-terms-confirm').click();
    const response = await submitted;
    const admission = await response.json();
    const record: Record<string, unknown> = { admission, submitted: response.request().postDataJSON() };
    runs.push(record);
    await save();
    expect(response.ok()).toBe(true);
    const taskId = admission.task_id as string;
    expect(taskId).toBeTruthy();
    console.log(`[authored audio] ${templateId} ${repeat + 1}/${runCount}: ${taskId}`);
    if (repeat === -1) {
      await expect.poll(async () => (await (await page.request.get('/queue')).json()).current?.task_id).toBe(taskId);
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
    }
    await expect
      .poll(
        async () => {
          // Native Stop may replace an uninterruptible model worker. The
          // supervisor keeps the durable task receipt while HTTP reconnects.
          const response = await page.request.get('/queue').catch(() => null);
          if (!response?.ok()) return 'reconnecting';
          const queue = await response.json().catch(() => null);
          if (!queue) return 'reconnecting';
          const task = [queue.current, ...Object.values(queue.queued ?? {}), ...queue.recent].find(
            (item) => item?.task_id === taskId,
          );
          record.terminal = task;
          return task?.status;
        },
        { timeout: 80 * 60_000, intervals: [3000, 5000] },
      )
      .toMatch(/^(completed|failed|cancelled)$/u);
    if (repeat === -1) {
      record.scope = 'Native Stop, then a fresh Run with unchanged authored settings';
      expect((record.terminal as { status: string }).status).toBe('cancelled');
      await expect(page.getByTestId('studio-run')).toBeEnabled({ timeout: 60_000 });
      expect((await snapshot(page)).exported).toEqual(before.exported);
      await save();
      continue;
    }
    const run = await (await page.request.get(`/runs/${taskId}`, { timeout: 60_000 })).json();
    record.run = run;
    await save();
    expect((record.terminal as { status: string }).status).toBe('completed');
    const media = run.outputs
      .flatMap((item: { backendProvenance?: { mediaItems?: unknown[] } }) => item.backendProvenance?.mediaItems ?? [])
      .filter(
        (item: { taskId: string; displayType: string }) => item.taskId === taskId && item.displayType === 'audio',
      );
    expect(media).toHaveLength(1);
    console.log(`[authored audio] retrieving verified output for ${taskId}`);
    const bytes = await (await page.request.get(media[0].url, { timeout: 60_000 })).body();
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(`sha256:bytes:${hash}`).toBe(media[0].mediaHash);
    await writeFile(`${output}/run-${repeat + 1}.wav`, bytes);
    hashes.push(hash);
    record.asset = { name: `run-${repeat + 1}.wav`, sha256: hash };
    await page.screenshot({ path: `${output}/run-${repeat + 1}.png` });
    await save();
  }
  if (runCount > 1) expect(hashes[1]).toBe(hashes[0]);
  expect(errors).toEqual([]);
});
