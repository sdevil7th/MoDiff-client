import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalJsonHash } from './canonical-json.mjs';
import { canonicalGraphIdentity } from './live-proof-provenance.mjs';
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
  assert.equal(validatePromptVariantText(bytes, item, bound, runtime).generatedTokens, 7);
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
