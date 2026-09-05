import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyGalleryTemplate,
  argsForTemplateInputs,
  acquireRunnerLock,
  clearRuntimeBetweenRuns,
  createGalleryBrowserSessionGuard,
  executionReceiptForProvenance,
  executionReceiptsForRun,
  ensureFrontend,
  expectedOutputContractForCapture,
  failureMessageForRun,
  formOverridesForTemplate,
  galleryCaptureOperationTimeoutMs,
  preferredOutputRoleForTemplate,
  runtimeFingerprintForProvenance,
  galleryGenerateInvocation,
  galleryRunExitCode,
  installEphemeralGalleryStorage,
  isGalleryBrowserLifecycleFailure,
  isGalleryInfrastructureFailure,
  orderTemplatesForRuntimeReuse,
  parseArgs,
  prepareRuntimeForTemplate,
  requireAppDownloadsIdle,
  runWithGalleryBrowserRecovery,
  shouldPrepareRuntimeForTemplate,
  taskProgressFingerprint,
  waitForQueueIdle,
  waitForTaskTerminal,
} from './template-gallery-runner.mjs';
import {
  copyOutput,
  destinationStem,
  expertFallbackResourceOverrides,
  extensionForCampaignOutput,
  fixtureOverrides,
  isCampaignImagePayload,
  isCampaignSkeletonRunnable,
  parseCampaignArgs,
  qualityBlockedWorkflowsFromResearch,
} from './review-generation-campaign.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('campaign keeps raw executions out of the human-review shortlist', () => {
  const destination = destinationStem('AnimateDiffPipeline:text_to_video');
  assert.match(destination, /review-pending\/raw-campaign\/AnimateDiffPipeline__text_to_video\//);
});

test('campaign excludes workflows whose reviewed research dossier marks quality blocked', () => {
  const blocked = qualityBlockedWorkflowsFromResearch([
    {
      kind: 'generation_recipe_research',
      workflowId: 'CogView4Pipeline:text_to_image',
      status: 'quality_blocked_bounded_attempts_exhausted',
    },
    {
      kind: 'generation_recipe_research',
      workflowId: 'ReadyPipeline:text_to_image',
      status: 'researched_one_attempt_authorized',
    },
    {
      kind: 'unrelated_document',
      workflowId: 'IgnoredPipeline:text_to_image',
      status: 'quality_blocked',
    },
  ]);

  assert.deepEqual([...blocked], ['CogView4Pipeline:text_to_image']);
});

test('campaign refuses generic two-second audio fixtures for showcase workflows', () => {
  assert.throws(
    () => fixtureOverrides('ExampleAudioPipeline:audio_variation', [{ field: 'sourceAudio', minimumCount: 1 }]),
    /reviewed workflow-specific sourceAudio fixture/,
  );
  const reviewedFixture = resolve(
    ROOT,
    '..',
    'MoDiff',
    'web',
    'template-gallery',
    'ace_step_text_to_audio.current.wav',
  );
  if (existsSync(reviewedFixture)) {
    const overrides = fixtureOverrides('AceStepAudioPipeline:audio_variation', [
      { field: 'sourceAudio', minimumCount: 1 },
    ]);
    assert.equal(overrides.sourceAudio, reviewedFixture);
  } else {
    assert.throws(
      () => fixtureOverrides('AceStepAudioPipeline:audio_variation', [{ field: 'sourceAudio', minimumCount: 1 }]),
      /reviewed workflow-specific sourceAudio fixture/,
    );
  }
});

test('image upscaling uses its detailed provenance-tracked low-resolution fixture', () => {
  const overrides = fixtureOverrides('SpandrelImageUpscale:image_upscale', [
    { field: 'referenceImages', minimumCount: 1 },
  ]);
  assert.equal(overrides.referenceImages.length, 1);
  assert.match(overrides.referenceImages[0], /input-fixtures\/upscaling\/aura-rain-stop-lowres-q72\.jpg$/);
});

test('Sana Sprint editing uses the reviewed full-resolution AuraFlow source', () => {
  const overrides = fixtureOverrides('SanaSprintPipeline:edit_image', [{ field: 'referenceImages', minimumCount: 1 }]);
  assert.equal(overrides.referenceImages.length, 1);
  assert.match(
    overrides.referenceImages[0],
    /AuraFlowPipeline__text_to_image\/campaign-auraflowpipeline__text_to_image-gpu-v1\.png$/,
  );
});

test('SmolVLM image understanding uses the user-approved detailed AuraFlow source', () => {
  const overrides = fixtureOverrides('HuggingFaceImageTextToTextModel:image_to_text', [
    { field: 'referenceImages', minimumCount: 1 },
  ]);
  assert.equal(overrides.referenceImages.length, 1);
  assert.match(
    overrides.referenceImages[0],
    /AuraFlowPipeline__text_to_image\/campaign-auraflowpipeline__text_to_image-gpu-v1\.png$/,
  );
});

test('JoyAI editing uses the shortlisted native violin workshop source', () => {
  const overrides = fixtureOverrides('JoyImageEditPipeline:edit_image', [
    { field: 'referenceImages', minimumCount: 1 },
  ]);
  assert.equal(overrides.referenceImages.length, 1);
  assert.match(
    overrides.referenceImages[0],
    /JoyImageEditPipeline__text_to_image\/campaign-joyimageeditpipeline__text_to_image-gpu-v1\.webp$/,
  );
});

test('OmniGen editing uses the reviewed full-resolution LongCat tram source', () => {
  const overrides = fixtureOverrides('OmniGenPipeline:edit_image', [{ field: 'referenceImages', minimumCount: 1 }]);
  assert.equal(overrides.referenceImages.length, 1);
  assert.match(
    overrides.referenceImages[0],
    /LongCatImagePipeline__text_to_image\/campaign-longcatimagepipeline__text_to_image-gpu-v1\.png$/,
  );
});

test('OmniGen multi-reference generation preserves both reviewed source roles in order', () => {
  const overrides = fixtureOverrides('OmniGenPipeline:multi_image_reference_edit', [
    { field: 'referenceImages', minimumCount: 2 },
  ]);
  assert.equal(overrides.referenceImages.length, 2);
  assert.match(
    overrides.referenceImages[0],
    /QwenImageModularPipeline__text_to_image\/campaign-qwenimagemodularpipeline__text_to_image-gpu-v1\.png$/,
  );
  assert.match(
    overrides.referenceImages[1],
    /FluxSchnellPipeline__text_to_image__gguf_q4_0\/campaign-fluxschnellpipeline__text_to_image__gguf_q4_0-gpu-v1\.webp$/,
  );
});

test('video upscaling uses its motion-rich provenance-tracked low-resolution fixture', () => {
  const overrides = fixtureOverrides('SpandrelVideoUpscale:video_upscale', [{ field: 'sourceVideo', minimumCount: 1 }]);
  assert.match(overrides.sourceVideo, /input-fixtures\/upscaling\/sana-greenhouse-motion-lowres\.mp4$/);
});

test('gallery runner waits for the same background graph finalizer after a caller timeout', async () => {
  const calls = [];
  let evaluateCount = 0;
  const page = {
    evaluate: async (_callback, payload) => {
      evaluateCount += 1;
      calls.push({ type: 'evaluate', payload });
      if (evaluateCount === 1) {
        throw new Error(
          'Graph preparation is still running after 120000 ms. It will continue in the background; retry Queue when the graph is ready.',
        );
      }
      return { status: 'complete', message: 'Graph ready.' };
    },
    waitForFunction: async (_callback, _argument, options) => {
      calls.push({ type: 'waitForFunction', options });
    },
  };

  await applyGalleryTemplate(page, 'ltx_video_text_to_video', { numFrames: 9 }, 240_000);

  assert.deepEqual(calls, [
    {
      type: 'evaluate',
      payload: {
        selectedTemplateId: 'ltx_video_text_to_video',
        selectedFormOverrides: { numFrames: 9 },
      },
    },
    { type: 'waitForFunction', options: { timeout: 240_000 } },
    { type: 'evaluate', payload: undefined },
  ]);
});

test('gallery runner does not reinterpret an operation-context cancellation as a graph timeout', async () => {
  const page = {
    evaluate: async () => {
      throw new Error('WorkflowOperationCancelledError: The workflow changed before this operation completed.');
    },
    waitForFunction: async () => {
      throw new Error('unexpected wait');
    },
  };

  await assert.rejects(
    () => applyGalleryTemplate(page, 'qwen_low_vram_product_concept'),
    /WorkflowOperationCancelledError/,
  );
});

test('gallery:run forwards npm arguments directly to the targeted app runner', () => {
  const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['gallery:run'], 'node scripts/template-gallery-runner.mjs');
});

test('review campaign names fetched WebP bytes from the response MIME type', () => {
  assert.equal(
    extensionForCampaignOutput(
      { displayType: 'image' },
      'http://127.0.0.1:8088/file?file=%40data%2Fstudio%2Foutputs%2Frun-output.webp',
      'image/webp; charset=binary',
    ),
    '.webp',
  );
});

test('review campaign writes extensionless Studio image output with its fetched WebP extension', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'modiff-review-campaign-'));
  try {
    const bytes = Buffer.alloc(8_192);
    bytes.write('RIFF', 0, 'ascii');
    bytes.write('WEBP', 8, 'ascii');
    const output = {
      url: `data:image/webp;base64,${bytes.toString('base64')}`,
      displayType: 'image',
      taskId: 'task-webp',
    };
    const page = { evaluate: async () => output };

    const filePath = await copyOutput(
      page,
      { taskId: 'task-webp', startedAt: Date.now() },
      'http://127.0.0.1:5192',
      resolve(root, 'campaign-output'),
      'image',
    );

    assert.equal(filePath, resolve(root, 'campaign-output.webp'));
    assert.deepEqual(readFileSync(filePath), bytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('review campaign accepts compact native-resolution images and rejects non-image payloads', () => {
  const compactWebp = Buffer.alloc(954);
  compactWebp.write('RIFF', 0, 'ascii');
  compactWebp.write('WEBP', 8, 'ascii');
  assert.equal(isCampaignImagePayload(compactWebp), true);
  assert.equal(isCampaignImagePayload(Buffer.from('backend error: model unavailable')), false);
});

test('review campaign writes inline text output without treating its payload as a file suffix', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'modiff-review-campaign-text-'));
  try {
    const text = JSON.stringify({ generated_text: 'A bounded local result.' });
    const output = {
      url: `data:text/plain,${encodeURIComponent(text)}`,
      displayType: 'text',
      taskId: 'task-text',
    };
    const page = { evaluate: async () => output };

    const filePath = await copyOutput(
      page,
      { taskId: 'task-text', startedAt: Date.now() },
      'http://127.0.0.1:5192',
      resolve(root, 'campaign-output'),
      'json',
    );

    assert.equal(filePath, resolve(root, 'campaign-output.txt'));
    assert.equal(readFileSync(filePath, 'utf8'), text);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('review campaign recovers a late Studio output from the authoritative run receipt', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'modiff-review-campaign-receipt-'));
  try {
    const bytes = Buffer.alloc(8_192);
    bytes.write('RIFF', 0, 'ascii');
    bytes.write('WEBP', 8, 'ascii');
    const mediaUrl = `data:image/webp;base64,${bytes.toString('base64')}`;
    const fetchImpl = async (input) => {
      if (String(input).includes('/runs/task-late')) {
        return new Response(
          JSON.stringify({
            outputs: [{ url: mediaUrl, displayType: 'image', taskId: 'task-late' }],
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      return fetch(input);
    };

    const filePath = await copyOutput(
      { evaluate: async () => null },
      { taskId: 'task-late', startedAt: Date.now() },
      'http://127.0.0.1:5192',
      resolve(root, 'campaign-output'),
      'image',
      { fetchImpl, outputWaitMs: 0, server: 'http://127.0.0.1:8088' },
    );

    assert.equal(filePath, resolve(root, 'campaign-output.webp'));
    assert.deepEqual(readFileSync(filePath), bytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('review campaign MIME metadata overrides a conflicting URL suffix', () => {
  assert.equal(
    extensionForCampaignOutput({ displayType: 'image' }, 'http://127.0.0.1:8088/cache/node/output/0.png', 'image/webp'),
    '.webp',
  );
});

test('review campaign falls back to URL and media-kind extensions when MIME is unknown', () => {
  assert.equal(
    extensionForCampaignOutput({ displayType: 'video' }, 'http://127.0.0.1:8088/output/result.webm', ''),
    '.webm',
  );
  assert.equal(
    extensionForCampaignOutput({ displayType: 'audio' }, 'http://127.0.0.1:8088/cache/node/output', ''),
    '.wav',
  );
  assert.equal(
    extensionForCampaignOutput({ displayType: 'text' }, 'data:text/plain,%7B%22version%22%3A%22v1.dev0%22%7D', ''),
    '.txt',
  );
});

test('review campaign never persists or consumes a permanent failure skip set', () => {
  const source = readFileSync(resolve(ROOT, 'scripts/review-generation-campaign.mjs'), 'utf8');
  assert.doesNotMatch(source, /generation-campaign-skip|loadSkipSet|rememberFailure|skipFailed/);
  assert.doesNotMatch(source, /overlayActive|overlayReady/);
  assert.match(source, /writeRetryLedger/);
});

test('review campaign does not retry an unchanged optional-runtime gate', () => {
  const source = readFileSync(resolve(ROOT, 'scripts/review-generation-campaign.mjs'), 'utf8');
  assert.doesNotMatch(source, /optional runtime gate stale/);
  assert.doesNotMatch(source, /optional runtime required[\s\S]{0,500}queueRun\(\)/i);
});

test('review campaign help and invalid options cannot accidentally start a campaign', () => {
  assert.equal(parseCampaignArgs(['--help']).help, true);
  assert.throws(() => parseCampaignArgs(['--unknown']), /Unknown campaign option/);
  assert.throws(() => parseCampaignArgs(['--max-new']), /requires a non-negative number/);
});

test('review campaign runs built-ins only after an exact opt-in', () => {
  const imageUpscale = {
    id: 'task-template:builtin-image-operations:image-upscale:v1',
    modelType: 'BuiltinImageOperation',
    mode: 'image_upscale',
  };
  assert.equal(isCampaignSkeletonRunnable(imageUpscale), false);
  assert.equal(isCampaignSkeletonRunnable(imageUpscale, { only: ['BuiltinImageOperation:image_upscale'] }), true);
  assert.equal(isCampaignSkeletonRunnable(imageUpscale, { only: ['video_upscale'] }), false);
});

test('review campaign does not invent offload for none-only execution profiles', () => {
  assert.deepEqual(expertFallbackResourceOverrides({ offloadSupport: { modes: ['none'] } }), {
    device: 'cuda:0',
    autoOffload: false,
    offloadMode: 'none',
  });
  assert.deepEqual(expertFallbackResourceOverrides({ offloadSupport: { modes: ['none', 'model_cpu'] } }), {
    device: 'cuda:0',
    autoOffload: true,
  });
});

test('review campaign clears the idle runtime before every attempted generation', () => {
  const source = readFileSync(resolve(ROOT, 'scripts/review-generation-campaign.mjs'), 'utf8');
  assert.match(source, /prepareRuntimeForTemplate/);
  assert.doesNotMatch(source, /await waitForQueueIdle/);
});

test('review campaign records a completed result before recycling its page', () => {
  const source = readFileSync(resolve(ROOT, 'scripts/review-generation-campaign.mjs'), 'utf8');
  assert.match(
    source,
    /console\.log\(`completed \$\{workflowId\}`\);[\s\S]*?writeReport\(results\);[\s\S]*?replacePage\('post-run recycle'\)/,
  );
  assert.match(source, /post-run page recycle failed after \$\{workflowId\} was durably recorded/);
});

test('gallery runner applies per-template media inputs without leaking them to sibling templates', () => {
  const args = {
    referenceImages: ['global.png'],
    templateInputMap: {
      first: { referenceImages: ['first.png'], maskImage: 'first-mask.png' },
    },
  };

  assert.deepEqual(argsForTemplateInputs(args, { id: 'first' }).referenceImages, ['first.png']);
  assert.equal(argsForTemplateInputs(args, { id: 'first' }).maskImage, 'first-mask.png');
  assert.equal(argsForTemplateInputs(args, { id: 'second' }), args);
});

test('gallery runner reuses the same byte-pinned default inputs as the product', () => {
  const base = { referenceImages: [], templateInputMap: {} };
  const audio = argsForTemplateInputs(base, { id: 'ace_step_audio_variation' });
  const outpaint = argsForTemplateInputs(base, { id: 'wan_vace_outpaint_reframe' });

  assert.match(audio.sourceAudio, /runtime-inputs[\\/]assets[\\/][0-9a-f]{64}\.wav$/);
  assert.match(outpaint.sourceVideo, /runtime-inputs[\\/]assets[\\/][0-9a-f]{64}\.mp4$/);
  assert.match(outpaint.maskVideo, /runtime-inputs[\\/]assets[\\/][0-9a-f]{64}\.mp4$/);
});

test('gallery runner resolves installer-managed default inputs from backend web', () => {
  const backendDir = mkdtempSync(resolve(tmpdir(), 'modiff-runner-backend-'));
  try {
    const bindings = JSON.parse(
      readFileSync(resolve(ROOT, 'public/template-gallery/runtime-inputs/default-input-bindings.json'), 'utf8'),
    );
    const runtimePath = bindings.ace_step_audio_variation[0].defaultAssets[0].runtimePath;
    const installedPath = resolve(backendDir, 'web', runtimePath.replace(/^\/+/, ''));
    mkdirSync(dirname(installedPath), { recursive: true });
    writeFileSync(installedPath, 'installed fixture');
    const resolvedArgs = argsForTemplateInputs(
      { backendDir, referenceImages: [], templateInputMap: {} },
      { id: 'ace_step_audio_variation' },
    );
    assert.equal(resolvedArgs.sourceAudio, installedPath);
  } finally {
    rmSync(backendDir, { recursive: true, force: true });
  }
});

test('gallery provenance recovers measurements from a queue-restored completion receipt', () => {
  const terminalTask = {
    task_id: 'task-one',
    runtimeMeasurement: {
      elapsedSeconds: 12.5,
      peakAllocatedBytes: 8_589_934_592,
    },
  };
  const recoveredEvent = {
    type: 'graph_completed',
    task_id: 'task-one',
    recovered: true,
    terminalReceipt: terminalTask,
  };

  const receipt = executionReceiptForProvenance(recoveredEvent, terminalTask);

  assert.equal(receipt.task_id, 'task-one');
  assert.deepEqual(receipt.runtimeMeasurement, terminalTask.runtimeMeasurement);
});

test('gallery provenance prefers the complete graph-completion runtime over a compact terminal task claim', () => {
  const runtimeFingerprint = {
    fingerprint: 'sha256:runtime-complete',
    packages: { python: '3.12.13', torch: '2.9.1+rocm7.2' },
    torch: { cuda_available: true, cuda_device_count: 1 },
    work_dir: '/srv/modiff/data',
    data_dir: '/srv/modiff/data',
  };

  assert.deepEqual(
    runtimeFingerprintForProvenance({
      deterministicEvent: null,
      completionEvent: { runtimeFingerprint },
      terminalTask: { runtimeFingerprint: runtimeFingerprint.fingerprint },
      output: { provenance: { runtimeFingerprint: runtimeFingerprint.fingerprint } },
    }),
    runtimeFingerprint,
  );
  assert.equal(
    runtimeFingerprintForProvenance({
      deterministicEvent: null,
      completionEvent: { runtimeFingerprint },
      terminalTask: { runtimeFingerprint: 'sha256:different-runtime' },
      output: {},
    }),
    null,
  );
});

test('gallery runner performs worker-source preflight before waiting for or submitting graphs', () => {
  const source = readFileSync(resolve(ROOT, 'scripts/template-gallery-runner.mjs'), 'utf8');
  const preflight = source.indexOf('Backend source preflight failed before generation.');
  const queueWait = source.indexOf('await waitForQueueIdle(args.server');
  assert.ok(preflight > 0);
  assert.ok(queueWait > preflight);
});

test('offline evidence repair refuses to substitute current state for a missing original backend source snapshot', () => {
  const artifactDir = mkdtempSync(resolve(tmpdir(), 'modiff-retained-proof-'));
  try {
    const mediaDir = resolve(artifactDir, 'media');
    const evidenceDir = resolve(mediaDir, 'evidence');
    mkdirSync(evidenceDir, { recursive: true });
    for (const fileName of [
      'high_quality.run1.output.json',
      'high_quality.run1.websocket-events.json',
      'high_quality.run1.nodes.json',
      'high_quality.run1.model-fingerprint.json',
      'high_quality.run1.backend-source-after.json',
    ]) {
      writeFileSync(resolve(evidenceDir, fileName), '{}\n');
    }

    const repaired = spawnSync(
      process.execPath,
      [
        resolve(ROOT, 'scripts/template-gallery-repair-evidence.mjs'),
        '--media-dir',
        mediaDir,
        '--template',
        'high_quality',
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );

    assert.notEqual(repaired.status, 0);
    assert.match(repaired.stderr, /backend-source-before\.json/u);
    assert.equal(existsSync(resolve(evidenceDir, 'high_quality.run1.provenance.json')), false);
  } finally {
    rmSync(artifactDir, { recursive: true, force: true });
  }
});

test('gallery output waits can distinguish backend progress from an unchanged receipt', () => {
  const loading = {
    status: 'running',
    updated_at: 100,
    current_node: 'loader',
    progress: 20,
    node_progress: 45,
    phase: 'loading',
    message: 'Loading weights 50/219',
    current_step: 50,
    total_steps: 219,
  };

  assert.equal(taskProgressFingerprint(loading), taskProgressFingerprint({ ...loading }));
  assert.notEqual(
    taskProgressFingerprint(loading),
    taskProgressFingerprint({
      ...loading,
      updated_at: 101,
      node_progress: 46,
      message: 'Loading weights 51/219',
      current_step: 51,
    }),
  );
  assert.equal(taskProgressFingerprint(null), '');
});

test('gallery runner resolves checked-in per-template batch inputs to absolute paths', () => {
  const args = parseArgs([
    'node',
    'template-gallery-runner.mjs',
    '--template-input-map',
    'scripts/template-gallery-qwen-edit-inputs.json',
  ]);

  assert.match(args.templateInputMap.qwen_character_angles.referenceImages[0], /character_edit\.run1\.webp$/);
  assert.match(args.templateInputMap.qwen_inpaint_mask_draft.maskImage, /qwen-inpaint-field-cup-mask\.png$/);
});

test('LTX long-showcase inputs preserve the authored arrival then antenna-reveal pairing', () => {
  const args = parseArgs([
    'node',
    'template-gallery-runner.mjs',
    '--template-input-map',
    'scripts/template-gallery-ltx-inputs-v2.json',
  ]);

  assert.deepEqual(
    args.templateInputMap.ltx_video_long_showcase.referenceImages.slice(-2).map((path) => basename(path)),
    ['ltx-rescue-station-arrival-keyframe.webp', 'ltx-rescue-station-approach-keyframe.webp'],
  );
});

test('gallery runner defaults source-only capture to one run unless explicitly overridden', () => {
  assert.equal(parseArgs(['node', 'runner', '--source-only']).runs, 1);
  assert.equal(parseArgs(['node', 'runner', '--source-only', '--runs', '2']).runs, 2);
});

test('source-only capture validates decoded media without impersonating the parent release size', () => {
  const template = { example: { expectedOutput: { width: 1536, height: 1024, frames: 121 } } };
  assert.deepEqual(expectedOutputContractForCapture(template, { sourceOnly: true }), {});
  assert.deepEqual(expectedOutputContractForCapture(template, { sourceOnly: false }), {
    width: 1536,
    height: 1024,
    frames: 121,
  });
});

test('gallery runner parses fail-fast qualification batches explicitly', () => {
  assert.equal(parseArgs(['node', 'runner']).stopOnFailure, false);
  assert.equal(parseArgs(['node', 'runner', '--stop-on-failure']).stopOnFailure, true);
});

test('gallery runner distinguishes infrastructure loss from a template execution failure', () => {
  assert.equal(isGalleryInfrastructureFailure(new Error('Failed to fetch')), true);
  assert.equal(
    isGalleryInfrastructureFailure(new Error('Frontend port 5194 is already occupied. Refusing implicit reuse.')),
    true,
  );
  assert.equal(isGalleryInfrastructureFailure(new Error('Diffusers.Generate failed: invalid prompt tensor')), false);
  assert.equal(
    galleryRunExitCode(
      [{ templateId: 'infra', skipped: true, failureKind: 'infrastructure', reason: 'Failed to fetch' }],
      { code: 0 },
    ),
    70,
  );
});

test('gallery runner only reuses a frontend when the caller makes that choice explicitly', () => {
  const implicit = parseArgs(['node', 'runner', '--port', '5194']);
  const explicit = parseArgs(['node', 'runner', '--frontend-url', 'http://127.0.0.1:5173']);
  assert.equal(implicit.frontendUrlExplicit, false);
  assert.equal(explicit.frontendUrlExplicit, true);
});

test('gallery runner refuses to reuse an occupied implicit frontend port', async () => {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  try {
    await assert.rejects(
      ensureFrontend(
        {
          port: address.port,
          frontendUrl: `http://127.0.0.1:${address.port}`,
          frontendUrlExplicit: false,
          noStart: false,
        },
        [],
      ),
      /Refusing to reuse an unverified app session/,
    );
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test('gallery runner disables large persisted graph state before page navigation', async () => {
  let initScript = null;
  await installEphemeralGalleryStorage({
    addInitScript(script) {
      initScript = script;
    },
  });

  assert.equal(typeof initScript, 'function');
  const source = initScript.toString();
  assert.match(source, /modiff\.studio/);
  assert.match(source, /modiff\.flow/);
});

test('gallery runner rejects terminal page and browser events before they poison later templates', async () => {
  const session = () => {
    const page = new EventEmitter();
    const browser = new EventEmitter();
    return { browser, page };
  };

  for (const [target, event, code] of [
    ['page', 'crash', 'page_crashed'],
    ['page', 'close', 'page_closed'],
    ['browser', 'disconnected', 'browser_disconnected'],
  ]) {
    const current = session();
    const guard = createGalleryBrowserSessionGuard({ ...current, operationTimeoutMs: 1_000 });
    const pending = guard.run('capturing a test template', () => new Promise(() => {}));
    current[target].emit(event);
    await assert.rejects(
      pending,
      (error) =>
        error?.code === code && /template Gallery/i.test(error.message) && isGalleryBrowserLifecycleFailure(error),
    );
    guard.dispose();
  }

  assert.equal(isGalleryBrowserLifecycleFailure(new Error('Target page, context or browser has been closed')), true);
});

test('gallery runner retries one terminal browser failure in a clean session but not template failures', async () => {
  let attempts = 0;
  const recovered = await runWithGalleryBrowserRecovery(
    async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('renderer crashed'), { code: 'page_crashed' });
      return 'captured';
    },
    async (error, nextAttempt) => ({ reason: error.message, attempts: nextAttempt }),
  );
  assert.deepEqual(recovered, {
    value: 'captured',
    recovery: { reason: 'renderer crashed', attempts: 2 },
  });
  assert.equal(attempts, 2);

  attempts = 0;
  await assert.rejects(
    runWithGalleryBrowserRecovery(
      async () => {
        attempts += 1;
        throw new Error('model contract rejected');
      },
      async () => ({ attempts: 2 }),
    ),
    /model contract rejected/,
  );
  assert.equal(attempts, 1);
});

test('gallery runner can wait behind a long app-managed generation without bypassing the queue', () => {
  const args = parseArgs(['node', 'runner', '--queue-wait-timeout-ms', '36000000']);
  assert.equal(args.queueWaitTimeoutMs, 36_000_000);
});

test('gallery runner outer browser guard cannot preempt a healthy long capture', () => {
  assert.equal(galleryCaptureOperationTimeoutMs(15 * 60 * 1000, 1), 2 * 60 * 60 * 1000);
  assert.equal(galleryCaptureOperationTimeoutMs(60 * 60 * 1000, 2), 2 * 60 * 60 * 1000 + 180_000);
  assert.throws(() => galleryCaptureOperationTimeoutMs(0, 1), /positive number/);
  assert.throws(() => galleryCaptureOperationTimeoutMs(1_000, 0), /positive integer/);
});

test('gallery runner can retain successful locked runs without publishing gallery media', () => {
  const args = parseArgs(['node', 'runner', '--reviewed', '--record-qualification']);
  assert.equal(args.reviewed, true);
  assert.equal(args.recordQualification, true);
  assert.equal(args.publish, false);
  const source = readFileSync(resolve(ROOT, 'scripts', 'template-gallery-runner.mjs'), 'utf8');
  assert.match(source, /MODIFF_TEMPLATE_PROVENANCE: provenancePath/);
  assert.match(source, /template-qualification\.mjs/);
  assert.match(source, /!result\.sourceOnly && !result\.skipped/);
});

test('resource qualification capture is a single non-publishing locked-workload run', () => {
  const args = parseArgs([
    'node',
    'runner',
    '--template',
    'flux_schnell_text_to_image',
    '--record-resource-qualification',
    '--resource-mode',
    'expert',
    '--offload-mode',
    'model_cpu',
  ]);
  assert.equal(args.recordResourceQualification, true);
  assert.equal(args.reviewed, true);
  assert.equal(args.runs, 1);
  assert.equal(args.publish, false);
  assert.equal(args['resource-mode'], 'expert');
  assert.equal(args['offload-mode'], 'model_cpu');
});

test('resource qualification requires an explicit recipe override', () => {
  assert.throws(
    () => parseArgs(['node', 'runner', '--template', 'flux_schnell_text_to_image', '--record-resource-qualification']),
    /requires an explicit resource, offload, or quantization override/,
  );
});

test('gallery runner prevents two capture processes from sharing one app execution session', () => {
  const directory = mkdtempSync('/tmp/modiff-gallery-lock-');
  const lockPath = resolve(directory, '.runner.lock');
  const release = acquireRunnerLock(lockPath, process.pid);
  assert.throws(() => acquireRunnerLock(lockPath, process.pid), /Another template-gallery runner is active/);
  release();
  const releaseAgain = acquireRunnerLock(lockPath, process.pid);
  releaseAgain();
  rmSync(directory, { recursive: true, force: true });
});

test('gallery runner selects the generated audio export instead of the source loader preview', () => {
  assert.equal(preferredOutputRoleForTemplate({ modelType: 'AceStepAudioPipeline' }), 'audioExport');
  assert.equal(
    preferredOutputRoleForTemplate({
      modelType: 'WanTI2VPipeline',
      mediaType: 'video',
      workflowBlocks: ['soundtrack'],
    }),
    'exportWithAudio',
  );
  assert.equal(
    preferredOutputRoleForTemplate({ modelType: 'LTXVideoPipeline', mediaType: 'video', workflowBlocks: ['upscaler'] }),
    'videoExport',
  );
  assert.equal(
    preferredOutputRoleForTemplate({ modelType: 'QwenImageModularPipeline', workflowBlocks: ['upscaler'] }),
    'upscalePreview',
  );
  assert.equal(preferredOutputRoleForTemplate({ modelType: 'QwenImageModularPipeline' }), '');
});

test('gallery runner reuses runtime only for an explicit matching loader-contract key', () => {
  const qwenA = { id: 'a', modelType: 'QwenImageEditModularPipeline' };
  const qwenB = { id: 'b', modelType: 'QwenImageEditModularPipeline' };
  const qwenStableA = { ...qwenA, runtimeReuseKey: 'qwen-bf16-no-offload' };
  const qwenStableB = { ...qwenB, runtimeReuseKey: 'qwen-bf16-no-offload' };
  const qwenOffloaded = { ...qwenB, runtimeReuseKey: 'qwen-bf16-model-offload' };
  const qwenAutoA = { ...qwenA, runtimeReuseKey: 'QwenImageEditModularPipeline:auto-planned' };
  const qwenAutoB = { ...qwenB, runtimeReuseKey: 'QwenImageEditModularPipeline:auto-planned' };

  assert.equal(shouldPrepareRuntimeForTemplate(null, qwenA, true), true);
  assert.equal(shouldPrepareRuntimeForTemplate(qwenA, qwenB, false), true);
  assert.equal(shouldPrepareRuntimeForTemplate(qwenA, qwenB, true), true);
  assert.equal(shouldPrepareRuntimeForTemplate(qwenStableA, qwenStableB, true), false);
  assert.equal(shouldPrepareRuntimeForTemplate(qwenStableA, qwenOffloaded, true), true);
  assert.equal(
    shouldPrepareRuntimeForTemplate(qwenAutoA, qwenAutoB, true),
    false,
    'matching Auto catalog keys defer the final graph-aware reuse decision to the backend',
  );
});

test('gallery runner parses an explicitly attested already-resident loader key', () => {
  const args = parseArgs([
    'node',
    'template-gallery-runner.mjs',
    '--reuse-existing-runtime-key',
    'ZImageModularPipeline:profile-default:none:resident:none',
  ]);
  assert.equal(args.reuseRuntimeWithinModel, true);
  assert.equal(args.reuseExistingRuntimeKey, 'ZImageModularPipeline:profile-default:none:resident:none');
});

test('runtime reuse batches keep identical loader contracts contiguous without disturbing group order', () => {
  const residentA = { id: 'resident-a', runtimeReuseKey: 'resident' };
  const offloaded = { id: 'offloaded', runtimeReuseKey: 'offloaded' };
  const residentB = { id: 'resident-b', runtimeReuseKey: 'resident' };
  const quantized = { id: 'quantized', runtimeReuseKey: 'quantized' };

  assert.deepEqual(
    orderTemplatesForRuntimeReuse([residentA, offloaded, residentB, quantized], true).map((template) => template.id),
    ['resident-a', 'resident-b', 'offloaded', 'quantized'],
  );
  assert.deepEqual(
    orderTemplatesForRuntimeReuse([residentA, offloaded, residentB], false).map((template) => template.id),
    ['resident-a', 'offloaded', 'resident-b'],
  );
});

test('gallery runner preserves repeated reference images in CLI order', () => {
  const args = parseArgs([
    'node',
    'template-gallery-runner.mjs',
    '--reference-image',
    'primary.png',
    '--reference-image',
    'style.png',
  ]);

  assert.deepEqual(
    args.referenceImages.map((path) => basename(path)),
    ['primary.png', 'style.png'],
  );
});

test('gallery runner applies an explicit deterministic seed override', () => {
  const result = formOverridesForTemplate({ mode: 'text_to_image' }, { seed: '6202', referenceImages: [] });

  assert.equal(result.overrides.seed, 6202);
});

test('gallery runner requires an explicit qualification switch for blocked templates', () => {
  assert.deepEqual(formOverridesForTemplate({ mode: 'text_to_image', exampleStatus: 'blocked' }, {}), {
    skipReason: 'Template is blocked.',
  });
  assert.deepEqual(
    formOverridesForTemplate(
      { mode: 'text_to_image', exampleStatus: 'blocked' },
      { allowBlockedProbe: true, referenceImages: [] },
    ),
    { overrides: {} },
  );
});

test('gallery runner binds both expanded canvas and boundary mask for image outpaint', () => {
  const result = formOverridesForTemplate(
    { mode: 'outpaint' },
    {
      referenceImages: ['wide-canvas.png'],
      maskImage: 'boundary-mask.png',
    },
  );

  assert.deepEqual(result, {
    overrides: {
      referenceImages: ['wide-canvas.png'],
      maskImage: 'boundary-mask.png',
    },
  });
});

test('gallery runner lets the direct Qwen outpaint graph derive its own canvas and mask', () => {
  const result = formOverridesForTemplate(
    { mode: 'outpaint', modelType: 'QwenImageEditModularPipeline' },
    {
      referenceImages: ['source.png'],
    },
  );

  assert.deepEqual(result, {
    overrides: {
      referenceImages: ['source.png'],
    },
  });
});

test('gallery runner fails the process when any selected template is skipped', () => {
  assert.equal(galleryRunExitCode([{ templateId: 'ready', skipped: false }], { code: 0 }), 0);
  assert.equal(
    galleryRunExitCode(
      [
        { templateId: 'ready', skipped: false },
        { templateId: 'failed', skipped: true, reason: 'runtime failure' },
      ],
      { code: 0 },
    ),
    1,
  );
});

test('gallery runner propagates manifest generation failures', () => {
  assert.equal(galleryRunExitCode([{ templateId: 'ready', skipped: false }], { code: 7 }), 7);
});

test('gallery runner invokes the harness through Node without a platform shell shim', () => {
  const invocation = galleryGenerateInvocation({
    mediaDir: 'C:\\proof media',
    modelRevision: 'repo/model@commit',
    runtimeFingerprint: 'runtime-lock',
    publish: true,
  });

  assert.equal(invocation.command, process.execPath);
  assert.match(invocation.args[0], /template-gallery-harness\.mjs$/);
  assert.deepEqual(invocation.args.slice(1), [
    'generate',
    '--media-dir',
    'C:\\proof media',
    '--model-revision',
    'repo/model@commit',
    '--runtime-fingerprint',
    'runtime-lock',
    '--verification',
    'exact',
    '--publish',
  ]);
});

test('gallery runner stops only for a failure attributed to the active run', () => {
  const run = { taskId: 'task-current', startedAt: 2_000 };
  assert.equal(
    failureMessageForRun({ taskId: 'task-current', createdAt: 2_001, message: 'model load failed' }, run),
    'model load failed',
  );
  assert.equal(failureMessageForRun({ taskId: 'task-old', createdAt: 2_001, message: 'old task' }, run), null);
  assert.equal(failureMessageForRun({ taskId: 'task-current', createdAt: 1_999, message: 'stale failure' }, run), null);
});

test('gallery runner requires a successful cache-clearing receipt between duplicate runs', async () => {
  const calls = [];
  const payload = await clearRuntimeBetweenRuns('http://127.0.0.1:8088', async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ error: false, released_node_count: 6, cleanup_errors: [] }),
    };
  });

  assert.equal(payload.released_node_count, 6);
  assert.deepEqual(calls, [
    {
      url: 'http://127.0.0.1:8088/runtime/gpu_cleanup',
      options: { method: 'POST' },
    },
  ]);
  await assert.rejects(
    clearRuntimeBetweenRuns('http://127.0.0.1:8088', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: false, released_node_count: 0 }),
    })),
    /did not prove that any cached node objects were released/,
  );
});

test('gallery runner accepts an empty cleanup receipt before a template starts', async () => {
  const payloads = [
    { current: null, queued: {} },
    { error: false, released_node_count: 0, cleanup_errors: [] },
  ];
  const payload = await prepareRuntimeForTemplate('http://127.0.0.1:8088', async () => ({
    ok: true,
    status: 200,
    json: async () => payloads.shift(),
  }));

  assert.equal(payload.released_node_count, 0);
  await assert.rejects(
    prepareRuntimeForTemplate(
      'http://127.0.0.1:8088',
      async (url) => ({
        ok: true,
        status: 200,
        json: async () =>
          String(url).endsWith('/queue') ? { current: null, queued: {} } : { error: false, released_node_count: -1 },
      }),
      { timeoutMs: 10, pollMs: 0 },
    ),
    /invalid released-node count/,
  );
});

test('gallery runner waits for cancelled-task teardown before runtime cleanup', async () => {
  const observations = [
    { current: { task_id: 'stopping-task' }, queued: {} },
    { current: null, queued: {} },
  ];
  const result = await waitForQueueIdle(
    'http://127.0.0.1:8088',
    async () => ({
      ok: true,
      status: 200,
      json: async () => observations.shift(),
    }),
    { timeoutMs: 100, pollMs: 0 },
  );

  assert.equal(result.current, null);
  assert.equal(observations.length, 0);
});

test('gallery runner tolerates a transient queue request failure while waiting for idle', async () => {
  let calls = 0;
  const result = await waitForQueueIdle(
    'http://127.0.0.1:8088',
    async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary transport loss');
      return {
        ok: true,
        async json() {
          return { queued: {}, current: null };
        },
      };
    },
    { timeoutMs: 100, pollMs: 1 },
  );
  assert.deepEqual(result, { queued: {}, current: null });
  assert.equal(calls, 2);
});

test('gallery runner fails closed while app downloads or Gallery installation reserve space', async () => {
  const status = (overrides = {}) => ({
    error: false,
    schemaVersion: 1,
    downloads: [],
    activeCount: 0,
    queuedReservationBytes: 0,
    templateGalleryReservationBytes: 0,
    ...overrides,
  });
  const fetchStatus =
    (payload, response = {}) =>
    async () =>
      new Response(JSON.stringify(payload), {
        status: response.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });

  const ready = await requireAppDownloadsIdle('http://127.0.0.1:8088', fetchStatus(status()));
  assert.equal(ready.activeCount, 0);

  await assert.rejects(
    requireAppDownloadsIdle(
      'http://127.0.0.1:8088',
      fetchStatus(
        status({
          downloads: [{ repo_id: 'owner/model', task_id: 'download-task', status: 'downloading' }],
          activeCount: 1,
          queuedReservationBytes: 100,
        }),
      ),
    ),
    /App downloads.*active.*owner\/model/,
  );
  await assert.rejects(
    requireAppDownloadsIdle('http://127.0.0.1:8088', fetchStatus(status({ templateGalleryReservationBytes: 10 }))),
    /App downloads.*active/,
  );
  await assert.rejects(
    requireAppDownloadsIdle('http://127.0.0.1:8088', fetchStatus({ error: false, downloads: [] })),
    /malformed/,
  );
  assert.equal(isGalleryInfrastructureFailure(new Error('App downloads or Gallery installation are active')), true);
});

test('gallery runner waits for the attributed task terminal receipt after media appears', async () => {
  const page = {
    evaluate: async (_callback, taskId) => ({
      run: { id: taskId, task_id: taskId, status: 'completed', durationMs: 1250 },
      failure: null,
    }),
  };

  const terminal = await waitForTaskTerminal(page, { taskId: 'task-proof', timeoutMs: 1000 });
  assert.equal(terminal.status, 'completed');
  assert.equal(terminal.task_id, 'task-proof');
});

test('gallery runner rejects cached audio/video generation receipts as vacuous duplicates', () => {
  const template = { modelType: 'WanVACEPipeline' };
  const output = {
    taskId: 'task-wan',
    apiGraphSnapshot: {
      nodes: {
        generate: { module: 'modules.DiffusersVideo', action: 'Generate' },
        export: { module: 'modules.Video', action: 'Export' },
      },
    },
  };
  const fresh = [
    { type: 'executed', task_id: 'task-wan', node: 'generate', status: 'succeeded', hasChanged: true },
    { type: 'executed', task_id: 'task-wan', node: 'export', status: 'succeeded', hasChanged: true },
  ];

  assert.equal(executionReceiptsForRun(template, output, fresh).length, 2);
  assert.throws(
    () =>
      executionReceiptsForRun(template, output, [
        ...fresh.slice(0, 1),
        { type: 'executed', task_id: 'task-wan', node: 'export', status: 'cached', hasChanged: false },
      ]),
    /cached output/,
  );
});

test('gallery runner accepts generic Diffusers video receipts for Wan and LTX graphs', () => {
  for (const modelType of ['WanVACEPipeline', 'WanVideoPipeline', 'LTXVideoPipeline']) {
    const template = { modelType };
    const output = {
      taskId: `task-${modelType}`,
      apiGraphSnapshot: {
        nodes: {
          generate: { module: 'modules.DiffusersVideo', action: 'Generate' },
          export: { module: 'modules.Video', action: 'Export' },
        },
      },
    };
    const events = [
      { type: 'executed', task_id: output.taskId, node: 'generate', status: 'succeeded', hasChanged: true },
      { type: 'executed', task_id: output.taskId, node: 'export', status: 'succeeded', hasChanged: true },
    ];

    const receipts = executionReceiptsForRun(template, output, events);
    assert.deepEqual(
      receipts.map(({ module, action }) => [module, action]),
      [
        ['modules.DiffusersVideo', 'Generate'],
        ['modules.Video', 'Export'],
      ],
    );
  }
});

test('gallery runner accepts generic multi-shot and lyric-video receipts', () => {
  const sequence = { modelType: 'LTXVideoPipeline', workflowBlocks: ['video_sequence'] };
  const sequenceOutput = {
    taskId: 'task-sequence',
    apiGraphSnapshot: {
      nodes: {
        sequence: { module: 'modules.DiffusersVideo', action: 'GenerateSequence' },
        export: { module: 'modules.Video', action: 'Export' },
      },
    },
  };
  const sequenceEvents = [
    { type: 'executed', task_id: 'task-sequence', node: 'sequence', status: 'succeeded', hasChanged: true },
    { type: 'executed', task_id: 'task-sequence', node: 'export', status: 'succeeded', hasChanged: true },
  ];
  assert.deepEqual(
    executionReceiptsForRun(sequence, sequenceOutput, sequenceEvents).map(({ action }) => action),
    ['GenerateSequence', 'Export'],
  );

  const lyric = { modelType: 'AceStepAudioPipeline', workflowBlocks: ['lyric_video'] };
  const lyricOutput = {
    taskId: 'task-lyric',
    apiGraphSnapshot: {
      nodes: {
        audio: { module: 'modules.DiffusersAudio', action: 'Generate' },
        sequence: { module: 'modules.DiffusersVideo', action: 'GenerateSequence' },
        export: { module: 'modules.Video', action: 'ExportWithAudio' },
      },
    },
  };
  const lyricEvents = ['audio', 'sequence', 'export'].map((node) => ({
    type: 'executed',
    task_id: 'task-lyric',
    node,
    status: 'succeeded',
    hasChanged: true,
  }));
  lyricEvents.splice(1, 0, {
    type: 'executed',
    task_id: 'task-lyric',
    node: 'audio',
    status: 'cached',
    hasChanged: false,
  });
  assert.equal(executionReceiptsForRun(lyric, lyricOutput, lyricEvents).length, 3);
});

test('gallery runner accepts visible quality-loop video receipts', () => {
  const template = { modelType: 'LTXVideoPipeline', workflowBlocks: ['quality_video_sequence'] };
  const output = {
    taskId: 'task-quality-loop',
    apiGraphSnapshot: {
      nodes: {
        generate: { module: 'modules.DiffusersVideo', action: 'GenerateShotJob' },
        retain: { module: 'modules.Video', action: 'ExportAsset' },
        join: { module: 'modules.Video', action: 'ConcatenateAssets' },
        disabledBase: { module: 'modules.DiffusersVideo', action: 'Generate' },
      },
    },
  };
  const events = ['generate', 'retain', 'join'].map((node) => ({
    type: 'executed',
    task_id: output.taskId,
    node,
    status: 'succeeded',
    hasChanged: true,
  }));

  assert.deepEqual(
    executionReceiptsForRun(template, output, events).map(({ action }) => action),
    ['GenerateShotJob', 'ExportAsset', 'ConcatenateAssets'],
  );
});
