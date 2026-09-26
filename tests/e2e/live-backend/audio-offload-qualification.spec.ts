import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Opt-in installed-model proof, one bounded run at a time. No model downloads.
test('installed ACE-Step variation executes and delivers playable generated audio', async ({ page }) => {
  test.skip(!process.env.MODIFF_AUDIO_PROOF_INPUT, 'Requires an explicit existing WAV and installed ACE-Step model.');
  test.setTimeout(12 * 60_000);
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto('/');
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const queue = await (await page.request.get('/queue')).json();
  expect(queue.current).toBeFalsy();
  expect(Object.keys(queue.queued)).toHaveLength(0);
  const launcher = page.getByTestId('task-launcher');
  await launcher.getByRole('button', { name: 'Audio', exact: true }).click();
  await launcher.getByTestId('workflow-task-audio_variation').click();
  const source = page.locator('.react-flow__node').filter({ has: page.locator('header', { hasText: 'Load Audio' }) });
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
  const memory = page.getByTestId('topbar-resource-policy');
  if ((await memory.getAttribute('aria-pressed')) === 'true') await memory.click();
  const loader = page.locator('.react-flow__node').filter({ has: page.locator('header', { hasText: 'Load Models' }) });
  await loader.getByRole('button', { name: 'Offload Mode', exact: true }).click();
  await page
    .getByRole('option', { name: process.env.MODIFF_AUDIO_PROOF_OFFLOAD || 'SSD group offload', exact: true })
    .click();
  const generator = page.locator('.react-flow__node').filter({ has: page.locator('[data-key="audio_duration"]') });
  await generator.getByRole('textbox', { name: 'Duration', exact: true }).fill('5');
  await generator.getByRole('textbox', { name: 'Duration', exact: true }).press('Tab');
  await generator.getByRole('textbox', { name: 'Steps', exact: true }).fill('8');
  await generator.getByRole('textbox', { name: 'Steps', exact: true }).press('Tab');
  const snapshot = await page.evaluate(() => window.__MODIFF_E2E__?.exportWorkflowGraph() ?? null);
  await writeFile(test.info().outputPath('submitted-workflow.json'), JSON.stringify(snapshot, null, 2));
  const submitted = page.waitForResponse(
    (response) => response.url().endsWith('/graph') && response.request().method() === 'POST',
  );
  await expect(page.getByTestId('studio-run')).toBeEnabled();
  await page.getByTestId('studio-run').click();
  const response = await submitted;
  await writeFile(
    test.info().outputPath('submitted-api-graph.json'),
    JSON.stringify(response.request().postDataJSON(), null, 2),
  );
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
  const preview = page
    .locator('.react-flow__node')
    .filter({ has: page.locator('header', { hasText: 'Preview Audio' }) });
  const player = preview.locator('audio').first();
  await expect
    .poll(() => player.evaluate((el: HTMLAudioElement) => el.readyState), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(2);
  expect(await player.evaluate((el: HTMLAudioElement) => el.duration)).toBeGreaterThan(0);
  await player.evaluate((el: HTMLAudioElement) => el.play());
  await expect.poll(() => player.evaluate((el: HTMLAudioElement) => el.ended), { timeout: 20_000 }).toBe(true);
  let finalReceipt = receipt;
  await expect
    .poll(
      async () => {
        finalReceipt = await (await page.request.get(`/runs/${submission.task_id}`)).json();
        return finalReceipt.outputs.some(
          (output: { displayType: string; mediaHash?: string }) => output.displayType === 'audio' && output.mediaHash,
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  const output = finalReceipt.outputs.find(
    (output: { displayType: string; mediaHash?: string }) => output.displayType === 'audio' && output.mediaHash,
  );
  const media = await page.request.get(output.url);
  expect(media.ok()).toBe(true);
  const bytes = await media.body();
  const hash = `sha256:bytes:${createHash('sha256').update(bytes).digest('hex')}`;
  expect(hash).toBe(output.mediaHash);
  await writeFile(test.info().outputPath('generated-audio.wav'), bytes);
  await writeFile(test.info().outputPath('receipt.json'), JSON.stringify(finalReceipt, null, 2));
  await page.screenshot({ path: test.info().outputPath('generated-audio.png') });
});
