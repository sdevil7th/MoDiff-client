import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { stableStringify } from './live-proof-provenance.mjs';
import { readCanonicalWorkflowEvidence } from './release-contract-core.mjs';
import {
  bindSpandrelInput,
  validateConsumedSpandrelInput,
  validateSpandrelArtifact,
  validateSpandrelDecodedMedia,
} from './input-bound-model-evidence.mjs';

const clientRoot = fileURLToPath(new URL('..', import.meta.url));
const backendRoot = resolve(process.env.MODIFF_BACKEND_DIR || join(clientRoot, '../MoDiff'));
const workflowId = 'SpandrelImageUpscale:image_upscale';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const literal = (value) => ({ source: 'literal', value });

function fixture() {
  const modelArtifact = {
    source: 'hub',
    value: 'fixture/esrgan/RealESRGAN_x2plus.pth',
    revision: 'a'.repeat(40),
    sha256: 'b'.repeat(64),
    byteSize: 512,
  };
  const expected = {
    sid: 'canonical-test',
    paths: [['load', 'upscale', 'result']],
    nodes: {
      load: {
        module: 'modules.Image',
        action: 'Load',
        params: { file: { display: 'filebrowser', value: [] }, alpha_channel: { value: 'ignore' } },
      },
      upscale: {
        module: 'modules.Spandrel',
        action: 'Upscaler',
        params: {
          model_id: { value: modelArtifact },
          device: { value: 'cuda:0' },
          downscale: { value: 1 },
          image: { display: 'input', sourceId: 'load', sourceKey: 'image' },
        },
      },
      result: {
        module: 'modules.Image',
        action: 'Preview',
        params: {
          device: { value: 'cuda:0' },
          export: { value: '0' },
          image: { display: 'input', sourceId: 'upscale', sourceKey: 'output' },
        },
      },
    },
  };
  const registry = Object.fromEntries(
    Object.values(expected.nodes).map((node) => [`${node.module}.${node.action}`, structuredClone(node)]),
  );
  registry['modules.Image.Load'].params.file.fieldOptions = { multiple: true };
  const binding = { nodeId: 'load', field: 'file', sourceValue: 'input.png', file: { sha256: 'c'.repeat(64) } };
  const bound = bindSpandrelInput(expected, binding, registry);
  const nodeFields = {
    load: {
      alpha_channel: literal('ignore'),
      source_hashes: literal([binding.file.sha256]),
      source_widths: literal([64]),
      source_heights: literal([48]),
      source_modes: literal(['RGB']),
    },
    upscale: { device: literal('cuda:0'), model_id: literal(modelArtifact.value) },
    result: { device: literal('cuda:0') },
  };
  const fieldAccounting = {
    schemaVersion: 1,
    fields: {
      device: {
        disposition: 'inactive',
        inputValue: 'cuda:0',
        value: 'cuda:0',
        reason: 'already-decoded-image',
        source: 'literal',
      },
      export: { disposition: 'consumed', inputValue: '0', value: '0', source: 'literal' },
    },
    inputProjections: {},
    outputProjections: {},
    unaccountedFields: [],
    omittedFields: {},
    complete: true,
  };
  const output = {
    taskId: 'test-task',
    resolvedExecutionInputs: {
      schemaVersion: 1,
      source: 'backend-execution',
      taskId: 'test-task',
      attemptIndex: 0,
      nodeId: 'result',
      truncated: false,
      uncapturedNodeIds: [],
      ambiguousFields: [],
      unavailableFields: [],
      fieldAccountingStatus: { schemaVersion: 1, truncated: false },
      nodes: Object.entries(expected.nodes).map(([nodeId, { module, action }]) => ({
        nodeId,
        module,
        action,
        fields: nodeFields[nodeId],
        omittedFields: {},
        ...(nodeId === 'result' ? { fieldAccounting } : {}),
      })),
    },
  };
  const checkpoint = {
    schemaVersion: 1,
    kind: 'spandrel_upscaler',
    module: 'modules.Spandrel',
    action: 'Upscaler',
    artifact: {
      source: 'hub',
      repository: 'fixture/esrgan',
      revision: modelArtifact.revision,
      weightName: 'RealESRGAN_x2plus.pth',
      sha256: modelArtifact.sha256,
    },
  };
  const submissionHints = { clientRunId: 'test-client-run' };
  const runtimeFingerprint = { fingerprint: 'test-runtime' };
  const graphCompleted = {
    runtimeHints: {
      ...submissionHints,
      loaderContract: [],
      controlledArtifacts: [{ ...checkpoint, descriptorSha256: digest(stableStringify(checkpoint)) }],
    },
    runtimeFingerprint,
  };
  const installed = {
    repoId: 'fixture/esrgan',
    installed: true,
    complete: true,
    modelRevision: `fixture/esrgan@${modelArtifact.revision}`,
    selectedRevision: modelArtifact.revision,
    size: modelArtifact.byteSize,
  };
  const observation = { error: false, models: [installed], runtimeFingerprint: runtimeFingerprint.fingerprint };
  return {
    expected,
    registry,
    output,
    binding,
    bound,
    modelArtifact,
    modelSet: [{ repoId: installed.repoId, revision: installed.selectedRevision }],
    submissionHints,
    graphCompleted,
    observation,
  };
}

test('binds one empty Image.Load port and preserves all other executable fields', () => {
  const { expected, binding, registry, bound } = fixture();
  assert.deepEqual(expected.nodes.load.params.file.value, []);
  assert.deepEqual(bound.api.nodes.load.params.file.value, [binding.sourceValue]);
  const unbound = structuredClone(bound.api);
  unbound.nodes.load.params.file.value = [];
  assert.deepEqual(unbound, expected);
  assert.throws(() => bindSpandrelInput(expected, { ...binding, sourceValue: '../escape.png' }, registry));
  assert.throws(() => bindSpandrelInput(expected, { ...binding, nodeId: 'upscale' }, registry));
  const extra = structuredClone(registry);
  extra['modules.Image.Load'].params.other = { display: 'filebrowser' };
  assert.throws(() => bindSpandrelInput(expected, binding, extra), /file input contract/u);
  expected.nodes.load.params.file.value = ['already-bound.png'];
  assert.throws(() => bindSpandrelInput(expected, binding, registry), /must be empty/u);
});

test('rejects missing, changed, or unrelated native Image.Load source capture', () => {
  const data = fixture();
  assert.deepEqual(validateConsumedSpandrelInput(data), {
    width: 64,
    height: 48,
    sourceHash: data.binding.file.sha256,
  });
  for (const [change, pattern] of [
    [
      (input) => {
        input.taskId = 'another-task';
      },
      /another task/u,
    ],
    [
      (input) => {
        input.attemptIndex = 1;
      },
      /another attempt/u,
    ],
    [
      (input) => {
        input.nodeId = 'load';
      },
      /output owner/u,
    ],
    [
      (input) => {
        input.nodes[0].action = 'Upload';
      },
      /Load/u,
    ],
    [
      (input) => {
        input.nodes[0].fields.source_hashes.value = ['d'.repeat(64)];
      },
      /source byte identity/u,
    ],
    [
      (input) => {
        delete input.nodes[0].fields.source_hashes;
      },
      /source byte identity/u,
    ],
    [
      (input) => {
        input.nodes[2].fieldAccounting.complete = false;
      },
      /preview accounting/u,
    ],
  ]) {
    const changed = structuredClone(data);
    change(changed.output.resolvedExecutionInputs);
    assert.throws(() => validateConsumedSpandrelInput(changed), pattern);
  }
});

test('rejects changed native model bytes, descriptor, action, and installed revision', () => {
  const data = fixture();
  assert.equal(validateSpandrelArtifact(data).artifact.sha256, data.modelArtifact.sha256);
  for (const change of [
    (model) => {
      model.descriptorSha256 = 'd'.repeat(64);
    },
    (model) => {
      model.artifact.sha256 = 'd'.repeat(64);
    },
    (model) => {
      model.artifact.weightName = 'other.pth';
    },
    (model) => {
      model.action = 'Preview';
    },
  ]) {
    const changed = structuredClone(data);
    change(changed.graphCompleted.runtimeHints.controlledArtifacts[0]);
    assert.throws(() => validateSpandrelArtifact(changed), /checkpoint or descriptor/u);
  }
  data.observation.models[0].selectedRevision = 'd'.repeat(40);
  assert.throws(() => validateSpandrelArtifact(data));
});

test('requires original media formats and an independently decoded 2× result', () => {
  const sourceBytes = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(sourceBytes);
  sourceBytes.write('IHDR', 12);
  sourceBytes[25] = 2;
  const outputBytes = Buffer.alloc(20);
  outputBytes.write('RIFF', 0);
  outputBytes.write('WEBP', 8);
  const input = { width: 64, height: 48 };
  const item = { width: 128, height: 96 };
  const data = {
    sourceBytes,
    outputBytes,
    input,
    item,
    sourceDecoded: input,
    outputDecoded: { ...item, nearBlackRatio: 0, lumaStdDev: 10 },
  };
  validateSpandrelDecodedMedia(data);
  assert.throws(
    () => validateSpandrelDecodedMedia({ ...data, outputDecoded: { ...data.outputDecoded, width: 127 } }),
    /not 2×/u,
  );
  assert.throws(() => validateSpandrelDecodedMedia({ ...data, outputBytes: data.sourceBytes }), /not WebP/u);
});

const savedEvidence = process.env.MODIFF_INPUT_BOUND_MODEL_TEST_EVIDENCE;
test(
  'retained Windows Spandrel proof verifies through the release reader without a rerun',
  { skip: !savedEvidence },
  async () => {
    const args = { clientRoot, backendRoot, workflowId, evidencePath: resolve(savedEvidence) };
    const result = await readCanonicalWorkflowEvidence(args);
    assert.equal(result.receipt.proofKind, 'real_backend_input_bound_model_variant');
    assert.equal(result.receipt.canonicalDefaultsExecuted, false);
    assert.ok(Object.values(result.receipt.qualificationClaims).every((claim) => claim === false));
    const temp = mkdtempSync(join(tmpdir(), 'modiff-input-evidence-'));
    try {
      cpSync(dirname(args.evidencePath), temp, { recursive: true });
      const evidencePath = join(temp, 'evidence.json');
      const evidence = JSON.parse(readFileSync(evidencePath));
      const retainedRef = (path) => {
        const bytes = readFileSync(join(temp, path));
        return { path, bytes: bytes.length, sha256: digest(bytes) };
      };
      evidence.graphRequest = retainedRef('graph-request.original.json');
      evidence.graphAcknowledgment = retainedRef('graph-acknowledgment.original.json');
      evidence.inputs[0].before = retainedRef('input-server-before.original.png');
      evidence.inputs[0].after = retainedRef('input-server-after.original.png');
      writeFileSync(evidencePath, JSON.stringify(evidence));
      const corroborated = await readCanonicalWorkflowEvidence({ ...args, evidencePath });
      assert.equal(corroborated.receipt.inputBinding.serverReadsCompared, true);
      evidence.inputs[0].after = retainedRef('output-0.original.webp');
      writeFileSync(evidencePath, JSON.stringify(evidence));
      await assert.rejects(
        () => readCanonicalWorkflowEvidence({ ...args, evidencePath }),
        /Server input observations differ/u,
      );
      evidence.inputs[0].after = retainedRef('input-server-after.original.png');
      writeFileSync(evidencePath, JSON.stringify(evidence));
      const inputPath = join(temp, evidence.inputs[0].file.path);
      const bytes = Buffer.from(readFileSync(inputPath));
      bytes[bytes.length - 1] ^= 1;
      writeFileSync(inputPath, bytes);
      await assert.rejects(
        () => readCanonicalWorkflowEvidence({ ...args, evidencePath }),
        /Evidence file hash differs/u,
      );
      evidence.inputs[0].file.sha256 = digest(bytes);
      writeFileSync(evidencePath, JSON.stringify(evidence));
      await assert.rejects(
        () => readCanonicalWorkflowEvidence({ ...args, evidencePath }),
        /Native Image.Load source byte identity/u,
      );
    } finally {
      assert.equal(resolve(temp, '..'), resolve(tmpdir()));
      assert.ok(temp.includes('modiff-input-evidence-'));
      rmSync(temp, { recursive: true, force: true });
    }
  },
);
