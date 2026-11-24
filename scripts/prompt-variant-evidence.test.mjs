import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalJsonHash } from './canonical-json.mjs';
import { canonicalGraphIdentity, directImagePromptRoutes } from './live-proof-provenance.mjs';
import { verifyRetainedStructuredText } from './retained-structured-text-evidence.mjs';
import {
  bindPromptVariant,
  validatePromptVariantText,
  validatePromptVariantVideo,
  validateSampledCpuWorkerMemory,
} from './prompt-variant-evidence.mjs';
import {
  exportCanonicalWorkflowGraphs,
  readCanonicalEvidenceFile,
  readCanonicalWorkflowEvidence,
} from './release-contract-core.mjs';

const clientRoot = fileURLToPath(new URL('..', import.meta.url));
const backendRoot = resolve(process.env.MODIFF_BACKEND_DIR ?? join(clientRoot, '../MoDiff'));
const digest = (value) => createHash('sha256').update(value).digest('hex');

test('a CPU capture measures sampled worker memory within its exact original task interval', () => {
  const source = { fingerprint: 'original', gitCommit: null, files: [{}] };
  const worker = {
    origin: 'http://127.0.0.1:8088',
    pid: 123,
    source: { fingerprint: source.fingerprint, gitCommit: null, fileCount: 1 },
  };
  const task = { started_at: 9.5, completed_at: 11.5, runtimeMeasurement: { processRssBytes: 100 } };
  const samples = [
    { unixTime: 9, hostAvailable: 1000, workerRss: 999, accelerator: '{}' },
    { unixTime: 10, hostAvailable: 1000, workerRss: 180, accelerator: '{}' },
    { unixTime: 11, hostAvailable: 1000, workerRss: 120, accelerator: '{}' },
    { unixTime: 12, hostAvailable: 1000, workerRss: 999, accelerator: '{}' },
  ];
  const capture = (entries) => Buffer.from(entries.map((entry) => JSON.stringify(entry)).join('\n'));
  assert.equal(validateSampledCpuWorkerMemory(capture(samples), worker, source, task), 180);
  assert.throws(() => validateSampledCpuWorkerMemory(capture(samples.slice(0, -1)), worker, source, task));
  assert.throws(() =>
    validateSampledCpuWorkerMemory(capture(samples), worker, { ...source, fingerprint: 'other' }, task),
  );
  const contradicted = { ...task, runtimeMeasurement: { processRssBytes: 300 } };
  assert.throws(() => validateSampledCpuWorkerMemory(capture(samples), worker, source, contradicted));
  const unordered = [samples[0], samples[2], samples[1], samples[3]];
  assert.throws(() => validateSampledCpuWorkerMemory(capture(unordered), worker, source, task));
});

test('a prompt variant fills a single empty literal and keeps all other fields and connections', () => {
  const profile = {
    chain: [
      ['loader', 'Fixture', 'Load', 'device'],
      ['generator', 'Fixture', 'Generate', 'prompt'],
      ['preview', 'Fixture', 'Preview', ''],
    ],
  };
  const baseline = {
    sid: 'fixture',
    paths: [['a', 'b', 'c']],
    nodes: {
      a: { module: 'Fixture', action: 'Load', params: { device: { value: 'cuda:0' } } },
      b: {
        module: 'Fixture',
        action: 'Generate',
        params: { prompt: { value: '' }, model: { display: 'input', sourceId: 'a', sourceKey: 'model' } },
      },
      c: {
        module: 'Fixture',
        action: 'Preview',
        params: { input: { display: 'input', sourceId: 'b', sourceKey: 'result' } },
      },
    },
  };
  const creator = structuredClone(baseline);
  creator.nodes.b.params.prompt.value = 'One example';
  const submitted = { ...structuredClone(creator), runtimeHints: {} };
  const baselineHash = canonicalGraphIdentity(baseline).hash;
  assert.equal(bindPromptVariant(profile, baseline, creator, submitted, baselineHash).prompt, 'One example');
  assert.equal(baseline.nodes.b.params.prompt.value, '');

  const wrongControl = structuredClone(submitted);
  wrongControl.nodes.a.params.device.value = 'cpu';
  assert.throws(
    () => bindPromptVariant(profile, baseline, creator, wrongControl, baselineHash),
    /outside the empty prompt/u,
  );
  const wrongWire = structuredClone(submitted);
  wrongWire.nodes.b.params.model.sourceKey = 'alternate';
  assert.throws(
    () => bindPromptVariant(profile, baseline, creator, wrongWire, baselineHash),
    /outside the empty prompt/u,
  );
  const disconnectedNode = structuredClone(submitted);
  disconnectedNode.nodes.d = disconnectedNode.nodes.b;
  assert.throws(
    () => bindPromptVariant(profile, baseline, creator, disconnectedNode, baselineHash),
    /uncontrolled node/u,
  );
  assert.throws(
    () => bindPromptVariant(profile, baseline, creator, { ...submitted, deterministicMode: {} }, baselineHash),
    /envelope/u,
  );
});

test('an image prompt variant binds the authored seed with the prompt and accepts no other controls', () => {
  const profile = {
    bindSeed: true,
    chain: [['generator', 'Fixture', 'Generate', 'prompt seed']],
  };
  const baseline = {
    sid: 'fixture',
    paths: [['generator']],
    nodes: {
      generator: {
        module: 'Fixture',
        action: 'Generate',
        params: { prompt: { value: '' }, seed: { value: 42 }, num_inference_steps: { value: 2 } },
      },
    },
  };
  const creator = structuredClone(baseline);
  creator.nodes.generator.params.prompt.value = 'A close photograph of a painted ceramic bowl.';
  creator.nodes.generator.params.seed.value = 1093;
  const submitted = { ...structuredClone(creator), runtimeHints: {} };
  const baselineHash = canonicalGraphIdentity(baseline).hash;
  const bound = bindPromptVariant(profile, baseline, creator, submitted, baselineHash);
  assert.equal(bound.seed, 1093);
  assert.deepEqual(bound.expected.nodes.generator.params, creator.nodes.generator.params);
  assert.equal(baseline.nodes.generator.params.seed.value, 42);

  const wrongStep = structuredClone(submitted);
  wrongStep.nodes.generator.params.num_inference_steps.value = 4;
  assert.throws(() => bindPromptVariant(profile, baseline, creator, wrongStep, baselineHash), /outside the bound/u);
  const invalidSeed = structuredClone(submitted);
  invalidSeed.nodes.generator.params.seed.value = -1;
  assert.throws(() => bindPromptVariant(profile, baseline, creator, invalidSeed, baselineHash), /unsigned seed/u);
  const connectedSeed = structuredClone(submitted);
  connectedSeed.nodes.generator.params.seed.sourceId = 'generator';
  assert.throws(() => bindPromptVariant(profile, baseline, creator, connectedSeed, baselineHash), /literal seed/u);
});

test('retained Janus text and captions preserve the output modality and source image binding', () => {
  const model = {
    source: {
      repository: 'deepseek-community/Janus-Pro-1B',
      revision: '1655280bb75959cc1cb85529a2a8b26e7016072e',
    },
  };
  const modelReceiptDigest = `sha256:${canonicalJsonHash(model)}`;
  const sourceImage = { decodedImage: { width: 640, height: 512 } };
  for (const caption of [false, true]) {
    const receipt = {
      schemaVersion: 1,
      format: 'modiff.canonical-workflow-run-receipt.v1',
      proofKind: caption ? 'real_backend_input_bound_model_variant' : 'real_backend_prompt_bound_model_variant',
      workflowId: `HuggingFaceAnyToAnyModel:${caption ? 'image_to_text' : 'text_generation'}`,
      modelSet: [{ repoId: model.source.repository, revision: model.source.revision }],
      decodedOutput: {
        schemaVersion: 1,
        kind: 'json',
        finishReason: 'stop',
        inputTokens: 7,
        generatedTokens: 5,
        modelReceiptDigest,
      },
      ...(caption && { inputBinding: sourceImage }),
    };
    const native = {
      schemaVersion: 1,
      task: 'any-to-any-generation',
      outputModality: 'text',
      text: caption ? 'A red triangle on white.' : 'Reykjavik is the capital of Iceland.',
      finishReason: 'stop',
      inputTokens: 7,
      generatedTokens: 5,
      inputImageCount: caption ? 1 : 0,
      inputMediaPixels: caption ? 640 * 512 : 0,
      modelReceipt: { ...model, receiptDigest: modelReceiptDigest },
    };
    function verify(result, receiptOverrides = {}) {
      const transportBytes = Buffer.from(JSON.stringify([JSON.stringify(result)]));
      const structuredBytes = Buffer.from(JSON.stringify(result));
      return verifyRetainedStructuredText({
        receipt: { ...receipt, outputHash: `sha256:bytes:${digest(transportBytes)}`, ...receiptOverrides },
        transportBytes,
        structuredBytes,
        outputSha256: digest(structuredBytes),
      });
    }
    assert.equal(verify(native).decodedMediaHash, `sha256:canonical-json:${canonicalJsonHash(native)}`);
    assert.throws(() => verify(native, { inputBinding: caption ? undefined : sourceImage }), /source evidence/u);
    assert.throws(() => verify({ ...native, outputModality: 'image' }));
    assert.throws(() => verify({ ...native, inputImageCount: 2 }));
    assert.throws(() => verify({ ...native, inputMediaPixels: 1 }));
  }
});

test('the native text output binds exact durable JSON, prompt route and local model receipt', () => {
  const model = {
    schemaVersion: 1,
    library: 'transformers',
    task: 'text-generation',
    loader: { modelAutoClass: 'AutoModelForCausalLM', preprocessorAutoClass: 'AutoTokenizer' },
    runtime: {
      architectures: ['LlamaForCausalLM'],
      device: 'cuda:0',
      dtype: 'float32',
      modelClass: 'LlamaForCausalLM',
      modelType: 'llama',
      preprocessorClass: 'GPT2Tokenizer',
      quantization: { mode: 'none' },
      transformersVersion: '5.18.0',
    },
    security: { hostedInference: false, localFilesOnly: true, safetensorsOnly: true, trustRemoteCode: false },
    source: {
      kind: 'hub',
      repository: 'HuggingFaceTB/SmolLM2-135M-Instruct',
      revision: '12fd25f77366fa6b3b4b768ec3050bf629380bac',
    },
  };
  const result = {
    schemaVersion: 1,
    task: 'text-generation',
    text: 'A technical fixture result.',
    finishReason: 'stop',
    inputTokens: 5,
    generatedTokens: 7,
    modelReceipt: { ...model, receiptDigest: `sha256:${canonicalJsonHash(model)}` },
  };
  const bound = {
    generator: { node: { params: { max_new_tokens: { value: 256 } } } },
    loader: { node: { params: { device: { value: 'cuda:0' }, dtype: { value: 'float32' } } } },
  };
  const runtime = { packages: { transformers: '5.18.0' } };
  function data(value) {
    const item = { value: [JSON.stringify(value)] };
    return { item, bytes: Buffer.from(JSON.stringify(item.value)) };
  }
  const { item, bytes } = data(result);
  const decodedOutput = validatePromptVariantText(bytes, item, bound, runtime);
  assert.equal(decodedOutput.generatedTokens, 7);
  assert.throws(
    () => validatePromptVariantText(bytes, { value: ['"other output"'] }, bound, runtime),
    /native output/u,
  );
  const wrongDigest = data({ ...result, modelReceipt: { ...result.modelReceipt, receiptDigest: 'sha256:changed' } });
  assert.throws(
    () => validatePromptVariantText(wrongDigest.bytes, wrongDigest.item, bound, runtime),
    /receipt digest/u,
  );
  const excessiveTokens = data({ ...result, generatedTokens: 257 });
  assert.throws(() => validatePromptVariantText(excessiveTokens.bytes, excessiveTokens.item, bound, runtime));

  const structuredBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
  const releaseEvidence = {
    receipt: {
      schemaVersion: 1,
      format: 'modiff.canonical-workflow-run-receipt.v1',
      proofKind: 'real_backend_prompt_bound_model_variant',
      workflowId: 'HuggingFaceTextGenerationModel:text_generation',
      modelSet: [{ repoId: model.source.repository, revision: model.source.revision }],
      outputHash: `sha256:bytes:${digest(bytes)}`,
      decodedOutput,
    },
    transportBytes: bytes,
    structuredBytes,
    outputSha256: digest(structuredBytes),
  };
  const original = structuredClone(releaseEvidence.receipt);
  const association = verifyRetainedStructuredText(releaseEvidence);
  assert.equal(association.sourceOutputHash, releaseEvidence.receipt.outputHash);
  assert.equal(association.outputEncodedSha256, `sha256:bytes:${digest(structuredBytes)}`);
  assert.equal(association.decodedMediaHash, `sha256:canonical-json:${canonicalJsonHash(result)}`);
  assert.deepEqual(releaseEvidence.receipt, original, 'The native receipt is immutable.');

  // Byte identities remain exact even when a different file decodes to the same value.
  assert.throws(
    () => verifyRetainedStructuredText({ ...releaseEvidence, structuredBytes: Buffer.from(JSON.stringify(result)) }),
    /approved structured result/u,
  );
  assert.throws(
    () =>
      verifyRetainedStructuredText({
        ...releaseEvidence,
        transportBytes: Buffer.from(JSON.stringify(item.value, null, 2)),
      }),
    /original native transport/u,
  );

  // Rehashing substituted bytes cannot make a different answer the saved result.
  const otherAnswer = Buffer.from(JSON.stringify({ ...result, text: 'An unrelated answer.' }));
  assert.throws(
    () =>
      verifyRetainedStructuredText({
        ...releaseEvidence,
        structuredBytes: otherAnswer,
        outputSha256: digest(otherAnswer),
      }),
    /decoded native result/u,
  );
  const identicalAnswerDifferentTokens = Buffer.from(JSON.stringify({ ...result, generatedTokens: 2 }));
  assert.throws(
    () =>
      verifyRetainedStructuredText({
        ...releaseEvidence,
        structuredBytes: identicalAnswerDifferentTokens,
        outputSha256: digest(identicalAnswerDifferentTokens),
      }),
    /decoded native result/u,
  );
  assert.throws(
    () =>
      verifyRetainedStructuredText({
        ...releaseEvidence,
        receipt: { ...releaseEvidence.receipt, workflowId: 'ShapEPipeline:text_to_3d' },
      }),
    /reviewed text workflow/u,
  );
  assert.throws(
    () =>
      verifyRetainedStructuredText({
        ...releaseEvidence,
        receipt: { ...releaseEvidence.receipt, decodedOutput: { ...decodedOutput, generatedTokens: 99 } },
      }),
    /native text receipt/u,
  );
  assert.throws(
    () => verifyRetainedStructuredText({ ...releaseEvidence, transportBytes: Buffer.alloc(2 * 1024 * 1024 + 1) }),
    /bounded file/u,
  );
});

test('the video variant needs independently decoded and moving geometry at the native cadence', () => {
  const bound = {
    generator: { node: { params: { frame_size: { value: 256 } } } },
    preview: { node: { params: { fps: { value: 12 } } } },
  };
  const item = {
    mediaMetadata: {
      source: 'encoded-file',
      width: 256,
      height: 256,
      frame_count: 20,
      fps: 12,
      duration_seconds: 1.67,
    },
  };
  const decoded = {
    width: 256,
    height: 256,
    frames: 20,
    fps: 12,
    durationSeconds: 1.67,
    codecName: 'h264',
    hasAudio: false,
    uniqueFrameRatio: 1,
    hash: 'sha256:decoded-video-framemd5:fixture',
  };
  assert.equal(validatePromptVariantVideo(decoded, item, bound).frames, 20);
  assert.throws(() => validatePromptVariantVideo({ ...decoded, fps: 24 }, item, bound), /differ from native/u);
  assert.throws(() => validatePromptVariantVideo({ ...decoded, uniqueFrameRatio: 0.1 }, item, bound));
});

for (const [workflowId, variable, kind, proofKind = 'real_backend_prompt_bound_model_variant'] of [
  ['HuggingFaceAnyToAnyModel:text_generation', 'MODIFF_JANUS_TEXT_PROMPT_EVIDENCE', 'json'],
  ['HuggingFaceAnyToAnyModel:text_to_image', 'MODIFF_JANUS_IMAGE_PROMPT_EVIDENCE', 'image'],
  [
    'HuggingFaceAnyToAnyModel:image_to_text',
    'MODIFF_JANUS_CAPTION_EVIDENCE',
    'json',
    'real_backend_input_bound_model_variant',
  ],
  [
    'HuggingFaceImageTextToTextModel:image_to_text',
    'MODIFF_SMOLVLM_CAPTION_EVIDENCE',
    'json',
    'real_backend_input_bound_model_variant',
  ],
  ['LuminaPipeline:text_to_image', 'MODIFF_LUMINA_PROMPT_EVIDENCE', 'image'],
  ['Kandinsky3Pipeline:text_to_image', 'MODIFF_KANDINSKY3_CPU_PROMPT_EVIDENCE', 'image'],
  ['HuggingFaceTextGenerationModel:text_generation', 'MODIFF_SMOLLM2_PROMPT_EVIDENCE', 'json'],
  ['ShapEPipeline:text_to_3d', 'MODIFF_SHAPE_PROMPT_EVIDENCE', 'video'],
  ['LongCatAudioDiTPipeline:text_to_audio', 'MODIFF_LONGCAT_AUDIO_PROMPT_EVIDENCE', 'audio'],
  ['CogView3PlusPipeline:text_to_image', 'MODIFF_COGVIEW3_PROMPT_EVIDENCE', 'image'],
  ['StableDiffusionXLTurboPipeline:text_to_image', 'MODIFF_SDXL_TURBO_PROMPT_EVIDENCE', 'image'],
  ['SanaPAGPipeline:text_to_image', 'MODIFF_SANA_PAG_PROMPT_EVIDENCE', 'image'],
  ['AuraFlowPipeline:text_to_image', 'MODIFF_AURAFLOW_PROMPT_EVIDENCE', 'image'],
  ['LatentConsistencyModelPipeline:text_to_image', 'MODIFF_LCM_IMAGE_PROMPT_EVIDENCE', 'image'],
  ['SanaPipeline:text_to_image', 'MODIFF_SANA_IMAGE_PROMPT_EVIDENCE', 'image'],
  ['ChromaPipeline:text_to_image', 'MODIFF_CHROMA_IMAGE_PROMPT_EVIDENCE', 'image'],
  ['Lumina2Pipeline:text_to_image', 'MODIFF_LUMINA2_SAVED_PROMPT_EVIDENCE', 'image'],
  ['HunyuanDiTPipeline:text_to_image', 'MODIFF_HUNYUAN_DIT_SAVED_PROMPT_EVIDENCE', 'image'],
  ['OmniGenPipeline:text_to_image', 'MODIFF_OMNIGEN_SAVED_PROMPT_EVIDENCE', 'image'],
  ['SanaSprintPipeline:text_to_image', 'MODIFF_SANA_SPRINT_IMAGE_PROMPT_EVIDENCE', 'image'],
  ['StableDiffusionXLPAGPipeline:text_to_image', 'MODIFF_SDXL_PAG_PROMPT_EVIDENCE', 'image'],
]) {
  const saved = process.env[variable];
  test(`${workflowId} retained ${kind} prompt variant verifies without new execution`, { skip: !saved }, async () => {
    const evidencePath = resolve(saved);
    const args = { clientRoot, backendRoot, workflowId, evidencePath };
    const original = await readCanonicalWorkflowEvidence(args);
    assert.equal(original.receipt.proofKind, proofKind);
    assert.equal(original.receipt.canonicalDefaultsExecuted, false);
    assert.equal(original.receipt.decodedOutput.kind, kind);
    assert.ok(Object.values(original.receipt.qualificationClaims).every((claim) => claim === false));
    if (workflowId === 'HuggingFaceImageTextToTextModel:image_to_text') {
      const [{ file }] = original.evidence.outputs;
      const transportBytes = readCanonicalEvidenceFile(dirname(evidencePath), file).bytes;
      const structuredBytes = Buffer.from(JSON.parse(transportBytes)[0]);
      const args = {
        receipt: original.receipt,
        transportBytes,
        structuredBytes,
        outputSha256: digest(structuredBytes),
      };
      assert.equal(verifyRetainedStructuredText(args).sourceOutputHash, original.receipt.outputHash);
      assert.throws(
        () => verifyRetainedStructuredText({ ...args, receipt: { ...original.receipt, inputBinding: undefined } }),
        /missing its original source evidence/u,
      );
    }
    const temp = mkdtempSync(join(tmpdir(), 'modiff-prompt-variant-'));
    try {
      const refs = original.retainedFiles;
      for (const ref of refs) {
        assert.match(ref.path, /^[a-z0-9.-]+$/iu);
        const archived = readCanonicalEvidenceFile(dirname(evidencePath), ref);
        writeFileSync(join(temp, ref.path), archived.bytes);
      }
      const changedPath = join(temp, 'evidence.json');
      const evidence = JSON.parse(original.descriptorBytes);
      const route = directImagePromptRoutes.find((row) => row.workflowId === workflowId);
      if (route?.retainedObservationSource) {
        assert.equal(original.receipt.observationLimits.fullConsumedFieldAccounting, false);
        const packagePath = join(temp, evidence.outputPackage.path);
        const originalPackage = readFileSync(packagePath);
        const altered = JSON.parse(originalPackage);
        const owner = altered.latestOutput.resolvedExecutionInputs.nodes.find((node) => node.action === 'Generate');
        assert.equal(owner.fieldAccounting, undefined);
        owner.fields.num_inference_steps.value += 1;
        const replacement = Buffer.from(JSON.stringify(altered));
        const descriptor = structuredClone(evidence);
        descriptor.outputPackage = {
          ...evidence.outputPackage,
          bytes: replacement.length,
          sha256: digest(replacement),
        };
        const runPath = join(temp, evidence.runDetail.path);
        const originalRun = readFileSync(runPath);
        const run = JSON.parse(originalRun);
        run.outputs[0].resolvedExecutionInputs = altered.latestOutput.resolvedExecutionInputs;
        const changedRun = Buffer.from(JSON.stringify(run));
        descriptor.runDetail = { ...evidence.runDetail, bytes: changedRun.length, sha256: digest(changedRun) };
        writeFileSync(packagePath, replacement);
        writeFileSync(runPath, changedRun);
        writeFileSync(changedPath, JSON.stringify(descriptor));
        await assert.rejects(
          () => readCanonicalWorkflowEvidence({ ...args, evidencePath: changedPath }),
          /Retained adapter control differs: num_inference_steps/u,
        );
        writeFileSync(packagePath, originalPackage);
        writeFileSync(runPath, originalRun);
      }
      if (['SanaPipeline:text_to_image', 'ChromaPipeline:text_to_image'].includes(workflowId)) {
        const runPath = join(temp, evidence.runDetail.path);
        const originalRun = readFileSync(runPath);
        const run = JSON.parse(originalRun);
        const originalPreparation = structuredClone(run.task.runtimePreparation);
        run.task.runtimePreparation.previousModelFamily = 'UnreviewedPipeline';
        const replacement = Buffer.from(JSON.stringify(run));
        const substituted = structuredClone(evidence);
        substituted.runDetail = { ...evidence.runDetail, bytes: replacement.length, sha256: digest(replacement) };
        writeFileSync(runPath, replacement);
        writeFileSync(changedPath, JSON.stringify(substituted));
        await assert.rejects(
          () => readCanonicalWorkflowEvidence({ ...args, evidencePath: changedPath }),
          /Unreviewed previous Expert model family/u,
        );
        if (workflowId === 'ChromaPipeline:text_to_image') {
          run.task.runtimePreparation = {
            ...originalPreparation,
            reasons: ['model family changed from ChromaPipeline to ChromaPipeline'],
          };
          const changed = Buffer.from(JSON.stringify(run));
          substituted.runDetail = { ...evidence.runDetail, bytes: changed.length, sha256: digest(changed) };
          writeFileSync(runPath, changed);
          writeFileSync(changedPath, JSON.stringify(substituted));
          await assert.rejects(
            () => readCanonicalWorkflowEvidence({ ...args, evidencePath: changedPath }),
            /Unreviewed direct image cache cleanup/u,
          );
        }
        writeFileSync(runPath, originalRun);
      }
      if (proofKind === 'real_backend_input_bound_model_variant') {
        const [input] = evidence.inputs;
        const path = join(temp, input.file.path);
        const originalBytes = readFileSync(path);
        const replacement = Buffer.concat([originalBytes, Buffer.from([0])]);
        const substituted = structuredClone(evidence);
        substituted.inputs[0].file = { ...input.file, bytes: replacement.length, sha256: digest(replacement) };
        writeFileSync(path, replacement);
        writeFileSync(changedPath, JSON.stringify(substituted));
        await assert.rejects(
          () => readCanonicalWorkflowEvidence({ ...args, evidencePath: changedPath }),
          workflowId === 'HuggingFaceAnyToAnyModel:image_to_text'
            ? /Caption source bytes differ from the native load|Archived authoring requires the exact original capture/u
            : /Caption source bytes differ from the native load/u,
        );
        writeFileSync(path, originalBytes);
      }
      const completionPath = join(temp, evidence.graphCompleted.path);
      const completion = JSON.parse(readFileSync(completionPath));
      completion.task_id = 'another-execution';
      const changed = Buffer.from(JSON.stringify(completion));
      writeFileSync(completionPath, changed);
      evidence.graphCompleted.bytes = changed.length;
      evidence.graphCompleted.sha256 = digest(changed);
      writeFileSync(changedPath, JSON.stringify(evidence));
      await assert.rejects(
        () => readCanonicalWorkflowEvidence({ ...args, evidencePath: changedPath }),
        /another-execution|Archived authoring requires the exact original capture/u,
      );
      assert.ok(readFileSync(evidencePath).equals(original.descriptorBytes));
    } finally {
      if (existsSync(temp) && dirname(temp) === resolve(tmpdir())) rmSync(temp, { recursive: true, force: true });
    }
  });
}

test('Reviewed image prompt receipts keep the exact portable artifact and graph', async () => {
  const graphs = join(backendRoot, 'data/graphs');
  const manifest = JSON.parse(readFileSync(join(backendRoot, 'data/workflow-library-manifest.json'), 'utf8'));
  const workflowIds = [
    'LuminaPipeline:text_to_image',
    'GlmImagePipeline:text_to_image',
    'NucleusMoEImagePipeline:text_to_image',
    'ErnieImagePipeline:text_to_image',
    'OvisImagePipeline:text_to_image',
    'CogView3PlusPipeline:text_to_image',
    'CogView4Pipeline:text_to_image',
    'StableDiffusionXLTurboPipeline:text_to_image',
    'SanaPAGPipeline:text_to_image',
    'AuraFlowPipeline:text_to_image',
    'LatentConsistencyModelPipeline:text_to_image',
    'SanaPipeline:text_to_image',
    'ChromaPipeline:text_to_image',
    'Lumina2Pipeline:text_to_image',
    'HunyuanDiTPipeline:text_to_image',
    'OmniGenPipeline:text_to_image',
    'SanaSprintPipeline:text_to_image',
    'StableDiffusionXLPAGPipeline:text_to_image',
  ];
  const fixtures = workflowIds.map((id) =>
    JSON.parse(readFileSync(join(graphs, manifest.workflows.find((entry) => entry.id === id).graphPath), 'utf8')),
  );
  const originals = await exportCanonicalWorkflowGraphs(clientRoot, fixtures);
  for (const [index, workflowId] of workflowIds.entries()) {
    const record = directImagePromptRoutes.find((route) => route.workflowId === workflowId);
    const original = originals[index];
    const identity = canonicalGraphIdentity(original);
    const profile = {
      ...record,
      bindSeed: true,
      chain: [
        ['quantization', 'modules.DiffusersRuntime', 'PipelineQuantizationConfigV2', ''],
        ['recipe', 'modules.DiffusersRuntime', 'DiffusersExecutionRecipe', ''],
        ['loader', 'modules.DiffusersImage', 'LoadPipeline', ''],
        ['generator', 'modules.DiffusersImage', 'Generate', ''],
        ['preview', 'modules.Image', 'Preview', ''],
      ],
    };
    const created = structuredClone(original);
    const generation = Object.values(created.nodes).find((node) => node.action === 'Generate').params;
    generation.prompt.value = 'A botanical print on ivory paper';
    generation.seed.value = record.generation.seed;
    const output = { ...structuredClone(created), runtimeHints: {} };
    const witness = bindPromptVariant(profile, original, created, output, identity.hash);
    assert.equal(witness.prompt, generation.prompt.value);
    assert.equal(witness.loader.node.params.model_id.value.value, record.modelRepo);
    assert.equal(witness.loader.node.params.revision.value, record.modelRevision);
    assert.equal(witness.generator.node.params.max_sequence_length.value, record.generation.max_sequence_length);

    const changed = structuredClone(output);
    Object.values(changed.nodes).find((node) => node.action === 'Generate').params.width.value += 32;
    assert.throws(
      () => bindPromptVariant(profile, original, created, changed, identity.hash),
      /outside the bound prompt and seed/u,
    );
  }
});
