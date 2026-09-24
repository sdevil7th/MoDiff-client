#!/usr/bin/env node
// One bounded browser case at a time. Completed receipts are never rerun.
// Visual acceptance remains an explicit review of retained images.
import { runBoundedBrowser } from './bounded-browser-process.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

if (process.env.MODIFF_FASHION_DEMO !== '1' || !process.argv[2]) {
  throw new Error('Use MODIFF_FASHION_DEMO=1 node scripts/run-fashion-demo.mjs <local-case-manifest.json>');
}
const manifest = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
if (!Array.isArray(manifest) || manifest.length > 32) throw new Error('Expected at most 32 explicit cases.');
const summary = [];
for (const [index, entry] of manifest.entries()) {
  if (process.exitCode === 130) break;
  if (!entry.output || !Number.isInteger(entry.chapter) || entry.chapter < 1 || entry.chapter > 13)
    throw new Error('Each case requires output and a chapter from 1 to 13.');
  const output = resolve(entry.output);
  const exists = (path) =>
    readFile(path).then(
      () => true,
      (error) => {
        if (error.code !== 'ENOENT') throw error;
        return false;
      },
    );
  await mkdir(output, { recursive: true });
  if (await exists(resolve(output, 'receipt.json'))) {
    summary.push({ chapter: entry.chapter, state: 'retained-completed-receipt', output });
    continue;
  }
  if (await exists(resolve(output, 'failure.json'))) {
    summary.push({ chapter: entry.chapter, state: 'retained-failure-no-unchanged-retry', output });
    continue;
  }
  if (
    (entry.source && !(await exists(resolve(entry.source)))) ||
    (entry.image && !(await exists(resolve(entry.image))))
  ) {
    summary.push({ chapter: entry.chapter, state: 'blocked-missing-predecessor', output });
    continue;
  }
  if (entry.image) {
    const review = await readFile(resolve(dirname(entry.image), 'visual-review.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    const hash = createHash('sha256')
      .update(await readFile(entry.image))
      .digest('hex');
    if (review?.status !== 'accepted' || review.sha256 !== hash) {
      summary.push({ chapter: entry.chapter, state: 'blocked-awaiting-visual-review', output });
      continue;
    }
  }
  let queue;
  try {
    queue = await (await fetch('http://127.0.0.1:8088/queue', { signal: AbortSignal.timeout(10000) })).json();
  } catch (error) {
    summary.push({ chapter: entry.chapter, state: 'backend-unavailable', error: String(error) });
    continue;
  }
  if (queue.current || Object.keys(queue.queued || {}).length) {
    summary.push({ chapter: entry.chapter, state: 'backend-busy-no-interference' });
    continue;
  }
  const env = {
    ...process.env,
    MODIFF_LONG_RUNNING_QUALIFICATION: '1',
    MODIFF_MOCK_FRONTEND_PORT: String((manifest[0].port || 5250) + index),
    MODIFF_REVIEW_OUTPUT_DIR: output,
    MODIFF_FASHION_CHAPTER: String(entry.chapter),
    MODIFF_FASHION_SOURCE: entry.source || '',
    MODIFF_FASHION_IMAGE: entry.image || '',
    MODIFF_FASHION_TITLE: entry.title || '',
    MODIFF_FASHION_EDIT_PROMPT: entry.prompt || '',
    MODIFF_FASHION_REGIONS: entry.regions ? JSON.stringify(entry.regions) : '',
    MODIFF_FASHION_MODEL: entry.model || '',
    MODIFF_FASHION_STEPS: entry.steps ? String(entry.steps) : '',
    MODIFF_FASHION_GUIDANCE: entry.guidance === undefined ? '' : String(entry.guidance),
  };
  const { code, timedOut } = await runBoundedBrowser(
    process.execPath,
    [
      resolve('node_modules/@playwright/test/cli.js'),
      'test',
      'tests/e2e/live-backend/fashion-demo.spec.ts',
      '--reporter=line',
      '--retries=0',
      '--workers=1',
    ],
    { env },
  );
  const result = { chapter: entry.chapter, code, timedOut, output, visualReview: 'required' };
  await writeFile(resolve(output, 'runner.json'), JSON.stringify(result, null, 2));
  // A terminated browser may never reach the test's own catch/failure writer.
  // Persist that failure here too, so the next invocation cannot replay it.
  if ((code !== 0 || timedOut) && !(await exists(resolve(output, 'failure.json'))))
    await writeFile(
      resolve(output, 'failure.json'),
      JSON.stringify(
        { ...result, error: 'Browser process failed; inspect submitted task before any changed retry.' },
        null,
        2,
      ),
    );
  summary.push(result);
  // A browser timeout is not authorization to stop arbitrary backend work.
  // Following cases independently check the real queue and skip if occupied.
}
console.log(JSON.stringify(summary, null, 2));
process.exitCode ||= summary.some((item) =>
  item.code !== undefined ? item.code !== 0 : item.state !== 'retained-completed-receipt',
)
  ? 1
  : 0;
