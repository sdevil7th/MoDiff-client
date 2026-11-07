import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const ACE_ROUTE = {
  profileId: 'ace-step-audio:direct',
  pipelineClass: 'AceStepPipeline',
  task: 'audio_variation',
  repository: 'ACE-Step/acestep-v15-xl-turbo-diffusers',
  revision: '200ba991ae448051e14b0183157e35c2d27c9fb0',
};

function numericControl(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim()))
    throw new Error('Expected a number or nonblank numeric control string.');
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error('Expected a finite numeric control.');
  return numeric;
}

async function audioRoute(page: Page) {
  return page.evaluate(async () => {
    const [{ useFlowStore }, { runtimeProgressTarget }] = await Promise.all([
      import('/src/stores/useFlowStore.ts'),
      import('/src/studio/userBlocks.ts'),
    ]);
    const flow = useFlowStore.getState();
    const exported = flow.exportGraph('audio-offload-qualification', undefined, { randomizeSeeds: false });
    const one = (module: string, action: string) => {
      const matches = Object.entries(exported.nodes).filter(
        ([, node]) => node.module === module && node.action === action,
      );
      if (matches.length !== 1) throw new Error(`Expected one ${module}.${action} in the actual API graph.`);
      const [id, node] = matches[0]!;
      const uiId = runtimeProgressTarget(flow.nodes, id);
      if (!uiId) throw new Error(`Missing visible owner for ${id}.`);
      return { id, node, uiId };
    };
    return {
      exported,
      owner: one('modules.DiffusersAudio', 'LoadPipeline'),
      generator: one('modules.DiffusersAudio', 'Generate'),
      source: one('modules.Audio', 'Load'),
      preview: one('modules.Audio', 'Preview'),
    };
  });
}

function assertAceRoute(route: Awaited<ReturnType<typeof audioRoute>>) {
  const params = route.owner.node.params;
  expect(params.model_id?.value).toEqual({ source: 'hub', value: ACE_ROUTE.repository });
  expect(params.revision?.value).toBe(ACE_ROUTE.revision);
  expect(params.pipeline_class?.value).toBe(ACE_ROUTE.pipelineClass);
  expect(params.mode?.value).toBe(ACE_ROUTE.task);
  expect(params.audio_contract?.value).toMatchObject({
    pipelineClass: ACE_ROUTE.pipelineClass,
    mode: ACE_ROUTE.task,
    repository: ACE_ROUTE.repository,
  });
  expect(route.generator.node.params.pipeline).toMatchObject({ sourceId: route.owner.id, sourceKey: 'pipeline' });
  expect(route.generator.node.params.source_audio).toMatchObject({ sourceId: route.source.id, sourceKey: 'audio' });
  expect(route.preview.node.params.audio).toMatchObject({ sourceId: route.generator.id, sourceKey: 'audio' });
}

// Opt-in installed-model proof, one bounded run at a time. No model downloads.
test('installed ACE-Step variation executes and delivers playable generated audio', async ({ page }) => {
  test.skip(!process.env.MODIFF_AUDIO_PROOF_INPUT, 'Requires an explicit existing WAV and installed ACE-Step model.');
  test.setTimeout(12 * 60_000);
  page.setDefaultTimeout(45_000);
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto('/');
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const queue = await (await page.request.get('/queue')).json();
  expect(queue.current).toBeFalsy();
  expect(Object.keys(queue.queued)).toHaveLength(0);
  const initialLauncher = page.getByTestId('task-launcher');
  await expect(initialLauncher).toBeVisible();
  await initialLauncher.getByTestId('launcher-mode-advanced_workflow').click();
  await expect(initialLauncher).toHaveCount(0);
  // This explicit Custom smoke must not require Auto admission to create its task.
  const memory = page.getByTestId('topbar-resource-policy');
  if ((await memory.getAttribute('aria-pressed')) === 'true') await memory.click();
  await expect(memory).toHaveAttribute('aria-pressed', 'false');
  // New workflow resets its form. Use the ordinary embedded task browser so
  // its starter request reads the explicit Custom choice made above.
  const start = page.getByRole('button', { name: 'Start', exact: true });
  if (!(await start.isVisible())) await page.getByTestId('left-tab-workflows').click();
  await expect(start).toBeVisible();
  await start.click();
  const launcher = page.getByTestId('task-browser');
  await expect(launcher).toBeVisible();
  await launcher.getByRole('button', { name: 'Audio', exact: true }).click();
  const starterResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/operations/task-starter' && response.request().method() === 'POST',
  );
  await launcher.getByTestId('workflow-task-audio_variation').click();
  const starter = await starterResponse;
  const selection = await starter.json();
  await writeFile(test.info().outputPath('selected-task-starter.json'), JSON.stringify(selection, null, 2));
  expect(starter.ok()).toBe(true);
  expect(starter.request().postDataJSON().task).toBe(ACE_ROUTE.task);
  expect(starter.request().postDataJSON().resourceMode).toBe('expert');
  expect(selection).toMatchObject({
    schemaVersion: 1,
    profileId: ACE_ROUTE.profileId,
    unbound: false,
    starter: { pipelineClass: ACE_ROUTE.pipelineClass, task: ACE_ROUTE.task },
  });
  await expect(page.locator('.react-flow__node')).not.toHaveCount(0);
  // Embedded task creation opens a fresh tab with its default memory form.
  // Keep this run explicitly Custom after checking the Expert starter request.
  if ((await memory.getAttribute('aria-pressed')) === 'true') await memory.click();
  await expect(memory).toHaveAttribute('aria-pressed', 'false');
  const initial = await audioRoute(page);
  assertAceRoute(initial);
  const source = page.locator(`.react-flow__node[data-id=${JSON.stringify(initial.source.uiId)}]`);
  await expect(source).toHaveCount(1, { timeout: 60_000 });
  await source.locator('input[type=file]').setInputFiles(process.env.MODIFF_AUDIO_PROOF_INPUT!);
  // Upload commits are intentionally cancelled by concurrent workflow edits.
  // Wait for the actual source preview before changing other graph controls.
  await expect
    .poll(
      () =>
        source
          .locator('audio')
          .first()
          .evaluate((el: HTMLAudioElement) => el.readyState),
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(2);
  const loader = page.locator(`.react-flow__node[data-id=${JSON.stringify(initial.owner.uiId)}]`);
  await loader.getByRole('button', { name: 'Offload Mode', exact: true }).click();
  await page
    .getByRole('option', { name: process.env.MODIFF_AUDIO_PROOF_OFFLOAD || 'SSD group offload', exact: true })
    .click();
  const generator = page.locator(`.react-flow__node[data-id=${JSON.stringify(initial.generator.uiId)}]`);
  await generator.getByRole('textbox', { name: 'Duration', exact: true }).fill('5');
  await generator.getByRole('textbox', { name: 'Duration', exact: true }).press('Tab');
  await generator.getByRole('textbox', { name: 'Steps', exact: true }).fill('8');
  await generator.getByRole('textbox', { name: 'Steps', exact: true }).press('Tab');
  const snapshot = await page.evaluate(() => window.__MODIFF_E2E__?.exportWorkflowGraph() ?? null);
  await writeFile(test.info().outputPath('submitted-workflow.json'), JSON.stringify(snapshot, null, 2));
  const prepared = await audioRoute(page);
  assertAceRoute(prepared);
  expect(prepared.owner.id).toBe(initial.owner.id);
  expect(prepared.preview.id).toBe(initial.preview.id);
  expect(numericControl(prepared.generator.node.params.audio_duration?.value)).toBe(5);
  expect(numericControl(prepared.generator.node.params.num_inference_steps?.value)).toBe(8);
  await writeFile(test.info().outputPath('prepared-api-graph.json'), JSON.stringify(prepared, null, 2));
  const submitted = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
  );
  await expect(page.getByTestId('studio-run')).toBeEnabled();
  await page.getByTestId('studio-run').click();
  const response = await submitted;
  const submittedGraph = response.request().postDataJSON();
  await writeFile(test.info().outputPath('submitted-api-graph.json'), JSON.stringify(submittedGraph, null, 2));
  expect(submittedGraph.nodes[prepared.owner.id]).toEqual(prepared.owner.node);
  expect(submittedGraph.nodes[prepared.generator.id].module).toBe('modules.DiffusersAudio');
  expect(submittedGraph.nodes[prepared.generator.id].action).toBe('Generate');
  expect(submittedGraph.nodes[prepared.generator.id].params.pipeline).toMatchObject({
    sourceId: prepared.owner.id,
    sourceKey: 'pipeline',
  });
  expect(numericControl(submittedGraph.nodes[prepared.generator.id].params.audio_duration.value)).toBe(5);
  expect(numericControl(submittedGraph.nodes[prepared.generator.id].params.num_inference_steps.value)).toBe(8);
  expect(submittedGraph.nodes[prepared.preview.id]).toEqual(prepared.preview.node);
  const submission = await response.json();
  expect(submission.task_id).toBeTruthy();
  await writeFile(test.info().outputPath('submission.json'), JSON.stringify(submission));
  let status = '';
  try {
    await expect
      .poll(
        async () => {
          const q = await (await page.request.get('/queue', { timeout: 15_000 })).json();
          status = q.recent?.find((entry: { task_id: string }) => entry.task_id === submission.task_id)?.status ?? '';
          return ['completed', 'failed', 'cancelled'].includes(status);
        },
        { timeout: 9 * 60_000, intervals: [3000] },
      )
      .toBe(true);
  } catch (error) {
    // This isolated backend is checked idle above. Do not leave a timed-out
    // qualification running while the next independent case starts.
    const q = await (await page.request.get('/queue', { timeout: 15_000 })).json();
    if (q.current?.task_id === submission.task_id && Object.keys(q.queued).length === 0) {
      await page.request.post('/stop', { timeout: 15_000 });
    }
    throw error;
  }
  const receipt = await (await page.request.get(`/runs/${submission.task_id}`, { timeout: 20_000 })).json();
  await writeFile(test.info().outputPath('receipt.json'), JSON.stringify(receipt, null, 2));
  expect(status, receipt.task?.message).toBe('completed');
  const preview = page.locator(`.react-flow__node[data-id=${JSON.stringify(prepared.preview.uiId)}]`);
  const player = preview.locator('audio').first();
  await expect
    .poll(() => player.evaluate((el: HTMLAudioElement) => el.readyState), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(2);
  expect(await player.evaluate((el: HTMLAudioElement) => el.duration)).toBeGreaterThan(0);
  await player.evaluate((el: HTMLAudioElement) => el.play());
  await expect.poll(() => player.evaluate((el: HTMLAudioElement) => el.ended), { timeout: 20_000 }).toBe(true);
  const generatedOutputs = (record: {
    outputs: Array<{
      taskId?: string;
      nodeId?: string;
      fieldKey?: string;
      displayType?: string;
      mediaHash?: string;
      url: string;
    }>;
  }) =>
    record.outputs.filter(
      (output) =>
        output.taskId === submission.task_id &&
        output.nodeId === prepared.preview.id &&
        output.fieldKey === 'preview' &&
        output.displayType === 'audio' &&
        typeof output.mediaHash === 'string' &&
        /^sha256:bytes:[a-f0-9]{64}$/u.test(output.mediaHash),
    );
  let finalReceipt = receipt;
  await expect
    .poll(
      async () => {
        finalReceipt = await (await page.request.get(`/runs/${submission.task_id}`)).json();
        return generatedOutputs(finalReceipt).length === 1;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  const outputs = generatedOutputs(finalReceipt);
  expect(outputs).toHaveLength(1);
  const output = outputs[0]!;
  const media = await page.request.get(output.url);
  expect(media.ok()).toBe(true);
  const bytes = await media.body();
  const hash = `sha256:bytes:${createHash('sha256').update(bytes).digest('hex')}`;
  expect(hash).toBe(output.mediaHash);
  await writeFile(test.info().outputPath('generated-audio.wav'), bytes);
  await writeFile(test.info().outputPath('receipt.json'), JSON.stringify(finalReceipt, null, 2));
  await page.screenshot({ path: test.info().outputPath('generated-audio.png') });
});
