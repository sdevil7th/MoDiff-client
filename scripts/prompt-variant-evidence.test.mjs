import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalJsonHash } from './canonical-json.mjs';
import { canonicalGraphIdentity } from './live-proof-provenance.mjs';
import { verifyRetainedStructuredText } from './retained-structured-text-evidence.mjs';
import {
  bindPromptVariant,
  validatePromptVariantText,
  validatePromptVariantVideo,
} from './prompt-variant-evidence.mjs';
import { readCanonicalEvidenceFile, readCanonicalWorkflowEvidence } from './release-contract-core.mjs';

const clientRoot = fileURLToPath(new URL('..', import.meta.url));
const backendRoot = resolve(clientRoot, '../MoDiff');
const digest = (value) => createHash('sha256').update(value).digest('hex');

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

for (const [workflowId, variable, kind] of [
  ['HuggingFaceTextGenerationModel:text_generation', 'MODIFF_SMOLLM2_PROMPT_EVIDENCE', 'json'],
  ['ShapEPipeline:text_to_3d', 'MODIFF_SHAPE_PROMPT_EVIDENCE', 'video'],
]) {
  const saved = process.env[variable];
  test(`retained ${kind} prompt variant verifies without new execution`, { skip: !saved }, async () => {
    const evidencePath = resolve(saved);
    const args = { clientRoot, backendRoot, workflowId, evidencePath };
    const original = await readCanonicalWorkflowEvidence(args);
    assert.equal(original.receipt.proofKind, 'real_backend_prompt_bound_model_variant');
    assert.equal(original.receipt.canonicalDefaultsExecuted, false);
    assert.equal(original.receipt.decodedOutput.kind, kind);
    assert.ok(Object.values(original.receipt.qualificationClaims).every((claim) => claim === false));
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
        /another-execution/u,
      );
      assert.ok(readFileSync(evidencePath).equals(original.descriptorBytes));
    } finally {
      if (existsSync(temp) && dirname(temp) === resolve(tmpdir())) rmSync(temp, { recursive: true, force: true });
    }
  });
}
