import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const cache = mkdtempSync(path.join(tmpdir(), 'modiff-enhancement-summary-'));
let server, contract, canonical;
before(async () => {
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    logLevel: 'silent',
    appType: 'custom',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
  });
  contract = await server.ssrLoadModule('/src/studio/promptEnhancementSummary.ts');
  canonical = (await server.ssrLoadModule('/src/studio/blockSchemaV2.ts')).canonicalBlockStringifyV2;
});
after(async () => {
  await server?.close();
  rmSync(cache, { recursive: true, force: true });
});

const sha = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
const copy = (value) => structuredClone(value);

// Synthetic protocol fixture only. Its receipt digest is independently generated
// by the existing HFT _canonical_json/_sealed_receipt source for this closed receipt.
// This is not a model, actual processor/rendered token or producer fixture.
const nativeReceipt = {
  schemaVersion: 1,
  library: 'transformers',
  task: 'image-video-to-text',
  source: { kind: 'hub', repository: 'synthetic/review-fixture', revision: 'a'.repeat(40) },
  loader: { preprocessorAutoClass: 'AutoProcessor', modelAutoClass: 'AutoModelForImageTextToText' },
  security: { localFilesOnly: true, trustRemoteCode: false, safetensorsOnly: true, hostedInference: false },
  runtime: {
    transformersVersion: '5.18.0',
    dtype: 'float32',
    device: 'cpu',
    preprocessorClass: 'FixtureProcessor',
    modelClass: 'FixtureVisionTextModel',
    modelType: 'fixture_model',
    architectures: ['FixtureVisionTextModel'],
    quantization: { mode: 'none' },
  },
  receiptDigest: 'sha256:bf02490f3df13b73bc28a5233592944a839598466d607ec2763a7466bfd25084',
};
const controls = {
  max_new_tokens: 16,
  min_new_tokens: 0,
  do_sample: false,
  num_beams: 1,
  repetition_penalty: 1,
  return_dict_in_generate: false,
  use_chat_template: true,
};
const producer = {
  taskId: 'synthetic-task-A',
  attemptIndex: 0,
  node: { id: 'synthetic/prompt', module: 'modules.HuggingFaceTransformers', action: 'GenerateImageVideoText' },
  sid: null,
  workerInstance: 'synthetic-worker',
  backendSourceFingerprint: `sha256:backend-source-v1:${'b'.repeat(64)}`,
  graphHash: `sha256:workflow-auto-v1:${'c'.repeat(64)}`,
  recipe: null,
  uiContext: {
    clientRunId: null,
    runInputHash: null,
    workflowTabId: null,
    workflowCanvasEpoch: null,
    workflowFormEpoch: null,
  },
};
const adapter = { id: 'synthetic-enhancement-v1', declarationSha256: sha('synthetic descriptor bytes\n') };

function fixture({
  images = 0,
  layout = null,
  invalidLayout = false,
  prompt = '  Synthetic authored prompt 😀.\n',
} = {}) {
  const references = Array.from({ length: images }, (_, index) => ({
    index,
    mode: 'RGB',
    width: 2,
    height: 3,
    sha256: sha(`synthetic ordered RGB source ${index}`),
  }));
  const bbox = Boolean(layout?.regions.length);
  const mode = `${images ? 'i2i' : 't2i'}${bbox ? '_bbox' : ''}`;
  const rendered = `synthetic rendered ${prompt}`;
  const consumed = {
    schemaVersion: 1,
    renderedPrompt: rendered,
    references,
    processedImageGrid: references.map(() => [1, 1, 2]),
    fingerprints: {
      operation: 'enhance_prompt',
      enhancement_max_new_tokens: controls.max_new_tokens,
      prompt_adapter_id: adapter.id,
      system_prompt_mode: mode,
      system_prompt_sha256: sha('synthetic system').slice(7),
      rendered_prompt_sha256: sha(rendered),
      rendered_prompt_utf8_bytes: Buffer.byteLength(rendered),
      rendered_input_ids_sha256: sha('synthetic input IDs'),
      reference_source_sha256: references.map((ref) => ref.sha256),
      ...(images
        ? {
            processed_pixel_sha256: sha('synthetic pixels'),
            processed_grid_sha256: sha('synthetic grid'),
            processed_pixel_shape: [images * 2, 4],
            processed_grid_shape: [images, 3],
          }
        : {}),
    },
  };
  let structured = null;
  if (bbox && !invalidLayout) {
    const proposed = copy(layout);
    for (const region of proposed.regions) region.description = `Proposed ${region.id}`;
    structured = {
      schemaVersion: 1,
      caption: proposed.regions.map((region) => `<${region.id}>`).join(' beside '),
      layoutConditioning: proposed,
      rawTable: proposed.regions.map((region) => ({
        id: region.id,
        ...(images
          ? { from: 'target', src_bbox: null, tgt_bbox: [200, 100, 700, 400] }
          : { bbox: [200, 100, 700, 400] }),
        desc: region.description,
      })),
    };
  }
  const value = {
    schemaVersion: 1,
    kind: 'prompt-enhancement-proposal',
    producer: copy(producer),
    adapter: copy(adapter),
    request: {
      authoredPromptSha256: sha(prompt),
      authoredLayoutKind: layout === null ? 'none' : 'object',
      authoredLayoutSha256: layout === null ? null : sha(canonical({ kind: 'object', value: layout })),
      controls: copy(controls),
      consumedInputSha256: sha(canonical(consumed)),
    },
    modelReceipt: copy(nativeReceipt),
    consumedInput: consumed,
    proposal: {
      mode,
      text: bbox ? null : 'Synthetic proposal text.',
      structuredProposal: structured,
      finishReason: 'stop',
      inputTokens: 7,
      generatedTokens: 3,
      applyRequired: true,
      applicationAllowed: !invalidLayout,
      layoutOutputValidated: bbox ? !invalidLayout : null,
      semanticFidelityVerified: false,
      applicationBlockedReason: invalidLayout ? 'Invalid generated target layout: synthetic diagnostic.' : null,
    },
  };
  const expectedReceipt = copy(nativeReceipt);
  delete expectedReceipt.receiptDigest;
  return {
    value,
    expected: {
      producer: copy(producer),
      adapter: copy(adapter),
      modelReceipt: expectedReceipt,
      authoredPrompt: prompt,
      authoredLayout: copy(layout),
      controls: copy(controls),
      systemPromptSha256: sha('synthetic system').slice(7),
      references: copy(references),
    },
  };
}
const layout = (version = 2) => ({
  schemaVersion: version,
  coordinateSpace: 'normalized_xyxy',
  regions: [
    {
      id: 'region_1',
      description: 'Authored description.',
      targetBox: [0.1, 0.2, 0.4, 0.7],
      ...(version === 2 ? { action: 'place' } : {}),
    },
  ],
});
const parse = (value) => contract.parsePromptEnhancementSummary(JSON.stringify(value));
const verify = ({ value, expected }) =>
  contract.verifyPromptEnhancementSummaryBindings(JSON.stringify(value), expected);

test('structured source proposals preserve authored binding and remap only a unique exact native table', async () => {
  const authored = layout();
  authored.regions[0].action = 'relocate';
  authored.regions[0].source = { referenceIndex: 0, box: [0, 0, 1, 1], expectedReferenceId: sha('bound encoding') };
  const input = fixture({ layout: authored, images: 1 });
  const structured = input.value.proposal.structuredProposal;
  structured.schemaVersion = 2;
  structured.rawCaption = 'Move <circle_1> from <ref_image_0>.';
  structured.caption = 'Move <region_1> from <ref_image_0>.';
  Object.assign(structured.rawTable[0], { id: 'circle_1', from: 'ref_image_0', src_bbox: [0, 0, 1000, 1000] });
  const result = await verify(input);
  assert.deepEqual(result.proposal.structuredProposal.layoutConditioning.regions[0].source, authored.regions[0].source);
  for (const mutate of [
    (s) => {
      s.rawTable[0].src_bbox[0] = 1;
    },
    (s) => {
      s.rawTable[0].tgt_bbox[0] = 201;
    },
    (s) => {
      s.caption = s.rawCaption;
    },
    (s) => {
      s.rawCaption += ' <foreign>';
    },
    (s) => {
      s.layoutConditioning.regions[0].source.expectedReferenceId = sha('stale binding');
    },
  ]) {
    const changed = copy(input);
    mutate(changed.value.proposal.structuredProposal);
    await assert.rejects(verify(changed), /geometry|bijection|mapping|reference|caption/i);
  }
  const ambiguous = copy(input);
  const s = ambiguous.value.proposal.structuredProposal;
  s.layoutConditioning.regions.push({ ...copy(s.layoutConditioning.regions[0]), id: 'another' });
  s.rawTable.push({ ...copy(s.rawTable[0]), id: 'circle_2' });
  s.rawCaption += ' <circle_2>';
  s.caption += ' <another>';
  assert.throws(() => parse(ambiguous.value), /bijection/);
});

test('synthetic text, image and target-layout summaries parse and match external snapshots without granting Apply', async (t) => {
  for (const settings of [
    {},
    { images: 1 },
    { images: 10 },
    { layout: layout(1) },
    { layout: layout(2), images: 2 },
    { layout: layout(), invalidLayout: true },
    { layout: { schemaVersion: 2, coordinateSpace: 'normalized_xyxy', regions: [] } },
  ])
    await t.test(JSON.stringify(settings), async () => {
      const input = fixture(settings);
      const result = await verify(input);
      assert.deepEqual(result, input.value);
      assert.equal(result.producer.recipe, null);
      assert.equal(Object.hasOwn(result, 'canApply'), false);
      assert.equal(result.proposal.semanticFidelityVerified, false);
    });
});

test('the existing native ASCII receipt digest is verified in its own closed domain', async () => {
  const input = fixture();
  assert.equal(sha(canonical(input.expected.modelReceipt)), nativeReceipt.receiptDigest);
  await verify(input);
  input.value.modelReceipt.receiptDigest = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(verify(input), /native receipt digest/);
});

test('raw lexical reader refuses duplicate and escape-equivalent keys before JSON.parse loses them', () => {
  const raw = JSON.stringify(fixture().value);
  for (const key of ['schemaVersion', 'schema\\u0056ersion'])
    assert.throws(() => contract.parsePromptEnhancementSummary(`{"${key}":1,${raw.slice(1)}`), /duplicate JSON key/);
  assert.throws(
    () =>
      contract.parsePromptEnhancementSummary(
        raw.replace('"attemptIndex":0', '"attemptIndex":0,"attempt\\u0049ndex":0'),
      ),
    /duplicate JSON key/,
  );
  const input = fixture({ prompt: 'A string containing {"x":1,"x":2} is ordinary authored text.' });
  assert.doesNotThrow(() => parse(input.value));
});

test('raw parser rejects objects without traversing getters and refuses invalid JSON/Unicode/nonfinite values', () => {
  let accessed = false;
  assert.throws(
    () =>
      contract.parsePromptEnhancementSummary({
        get schemaVersion() {
          accessed = true;
          return 1;
        },
      }),
    /raw JSON text/,
  );
  assert.equal(accessed, false);
  const raw = JSON.stringify(fixture().value);
  for (const bad of [
    '',
    'null',
    '{',
    raw + ' garbage',
    raw.replace('"inputTokens":7', '"inputTokens":1e999'),
    raw.replace('Synthetic proposal text.', '\\ud800'),
    raw + '\ud800',
  ])
    assert.throws(() => contract.parsePromptEnhancementSummary(bad));
});

test('wire, depth, entry and key limits are finite and exact', () => {
  const raw = JSON.stringify(fixture().value);
  const padding = contract.MAX_ENHANCEMENT_SUMMARY_BYTES - Buffer.byteLength(raw);
  assert.doesNotThrow(() => contract.parsePromptEnhancementSummary(raw + ' '.repeat(padding)));
  assert.throws(() => contract.parsePromptEnhancementSummary(raw + ' '.repeat(padding + 1)), /2 MiB/);
  assert.throws(() => contract.parsePromptEnhancementSummary('['.repeat(17) + '0' + ']'.repeat(17)), /depth/);
  assert.throws(() => contract.parsePromptEnhancementSummary(JSON.stringify(Array(8192).fill(0))), /entries/);
  assert.throws(
    () =>
      contract.parsePromptEnhancementSummary(
        JSON.stringify(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, i]))),
      ),
    /32 keys/,
  );
});

test('closed fields refuse bool-as-int, coercion, foreign actions, sources, grants and reserved layout strings', async (t) => {
  const cases = {
    schema: (x) => {
      x.schemaVersion = true;
    },
    kind: (x) => {
      x.kind = ['prompt-enhancement-proposal'];
    },
    unknown: (x) => {
      x.canApply = true;
    },
    producerNull: (x) => {
      x.producer = null;
    },
    attempt: (x) => {
      x.producer.attemptIndex = true;
    },
    foreignAction: (x) => {
      x.producer.node.action = 'PredictDepth';
    },
    recipe: (x) => {
      x.producer.recipe = { schemaVersion: 1, id: 'fake' };
    },
    source: (x) => {
      x.producer.backendSourceFingerprint = sha('wrong domain');
    },
    layoutString: (x) => {
      x.request.authoredLayoutKind = 'string';
      x.request.authoredLayoutSha256 = sha('null');
    },
    rawLayoutHash: (x) => {
      x.request.authoredLayoutSha256 = sha('none');
    },
    sourceLocal: (x) => {
      x.modelReceipt.source = { kind: 'local', path: 'C:/private' };
    },
    remote: (x) => {
      x.modelReceipt.security.trustRemoteCode = true;
    },
    quant: (x) => {
      x.modelReceipt.runtime.quantization.mode = 'bnb_4bit';
    },
    modelClass: (x) => {
      x.modelReceipt.runtime.modelClass = ['FixtureVisionTextModel'];
    },
    sampled: (x) => {
      x.request.controls.do_sample = true;
    },
    unconsumed: (x) => {
      x.request.controls.temperature = 0.7;
    },
    maxTokens: (x) => {
      x.request.controls.max_new_tokens = 3585;
    },
    finishReason: (x) => {
      x.proposal.finishReason = 'length';
    },
    plainFlag: (x) => {
      x.proposal.layoutOutputValidated = false;
    },
    fidelity: (x) => {
      x.proposal.semanticFidelityVerified = true;
    },
    implicit: (x) => {
      x.proposal.applyRequired = false;
    },
    plainTextControl: (x) => {
      x.proposal.text = 'Bad\u0080text';
    },
  };
  for (const [name, mutate] of Object.entries(cases))
    await t.test(name, () => {
      const { value } = fixture();
      mutate(value);
      assert.throws(() => parse(value));
    });
});

test('actual current opaque API correlation and null observations stay valid, never synthetic UI authority', async () => {
  const input = fixture();
  input.value.producer.uiContext.runInputHash = 'api-correlation:any-reviewed-string';
  input.expected.producer.uiContext.runInputHash = 'api-correlation:any-reviewed-string';
  await verify(input);
  assert.equal(input.value.producer.sid, null);
  input.value.producer.uiContext.workflowFormEpoch = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => parse(input.value));
});

test('ordered references, processed geometry and hash domains must agree before digest matching', async (t) => {
  const cases = {
    order: (x) => {
      x.consumedInput.references.reverse();
    },
    mode: (x) => {
      x.consumedInput.references[0].mode = 'RGBA';
    },
    refHash: (x) => {
      x.consumedInput.fingerprints.reference_source_sha256.reverse();
    },
    width: (x) => {
      x.consumedInput.references[0].width = true;
    },
    gridCount: (x) => {
      x.consumedInput.processedImageGrid.pop();
    },
    gridZero: (x) => {
      x.consumedInput.processedImageGrid[0][0] = 0;
    },
    pixelRows: (x) => {
      x.consumedInput.fingerprints.processed_pixel_shape[0] = 5;
    },
    gridShape: (x) => {
      x.consumedInput.fingerprints.processed_grid_shape = [1, 3];
    },
    missing: (x) => {
      delete x.consumedInput.fingerprints.processed_grid_sha256;
    },
    prefix: (x) => {
      x.consumedInput.fingerprints.system_prompt_sha256 = sha('system');
    },
    bytes: (x) => {
      x.consumedInput.fingerprints.rendered_prompt_utf8_bytes++;
    },
    Nul: (x) => {
      x.consumedInput.renderedPrompt += '\0';
    },
  };
  for (const [name, mutate] of Object.entries(cases))
    await t.test(name, () => {
      const { value } = fixture({ images: 2 });
      mutate(value);
      assert.throws(() => parse(value));
    });
  const input = fixture();
  input.value.consumedInput.fingerprints.processed_grid_shape = [0, 3];
  assert.throws(() => parse(input.value));
});

test('target proposals refuse changed boxes, unknown IDs/tags, sources and contradictory flags', async (t) => {
  const cases = {
    box: (x) => {
      x.proposal.structuredProposal.rawTable[0].tgt_bbox[0]++;
    },
    id: (x) => {
      x.proposal.structuredProposal.rawTable[0].id = 'foreign';
    },
    description: (x) => {
      x.proposal.structuredProposal.rawTable[0].desc = 'foreign';
    },
    source: (x) => {
      x.proposal.structuredProposal.rawTable[0].from = 'ref_image_0';
    },
    tag: (x) => {
      x.proposal.structuredProposal.caption += '<unknown>';
    },
    referenceTag: (x) => {
      x.proposal.structuredProposal.caption += '<ref_image_2>';
    },
    sourceRegion: (x) => {
      x.proposal.structuredProposal.layoutConditioning.regions[0].source = {
        referenceIndex: 0,
        box: [0, 0, 1, 1],
        expectedReferenceId: sha('fake'),
      };
    },
    extraText: (x) => {
      x.proposal.text = 'caption/table';
    },
    flag: (x) => {
      x.proposal.applicationAllowed = false;
    },
    reason: (x) => {
      x.proposal.applicationBlockedReason = 'contradictory';
    },
    nullStructure: (x) => {
      x.proposal.structuredProposal = null;
    },
  };
  for (const [name, mutate] of Object.entries(cases))
    await t.test(name, () => {
      const { value } = fixture({ images: 1, layout: layout() });
      mutate(value);
      assert.throws(() => parse(value));
    });
  const input = fixture({ layout: layout() });
  input.value.proposal.structuredProposal.layoutConditioning.regions[0].targetBox[0] = 0.10000000000000002;
  assert.throws(() => parse(input.value), /integer grid/);
});

test('digest and external binding checks refuse tampering rather than trusting self-selected declarations', async (t) => {
  const cases = {
    adapter: (x) => {
      x.value.adapter.declarationSha256 = sha('forged declaration');
    },
    receipt: (x) => {
      x.value.modelReceipt.receiptDigest = sha('forged receipt');
    },
    consumed: (x) => {
      x.value.request.consumedInputSha256 = sha('forged consumed');
    },
    rendered: (x) => {
      x.value.consumedInput.fingerprints.rendered_prompt_sha256 = sha('forged rendered');
    },
    prompt: (x) => {
      x.expected.authoredPrompt = x.expected.authoredPrompt.trim();
    },
    task: (x) => {
      x.expected.producer.taskId = 'later-task-B';
    },
    attempt: (x) => {
      x.expected.producer.attemptIndex = 1;
    },
    worker: (x) => {
      x.expected.producer.workerInstance = 'new-worker';
    },
    source: (x) => {
      x.expected.producer.backendSourceFingerprint = `sha256:backend-source-v1:${'d'.repeat(64)}`;
    },
    tab: (x) => {
      x.expected.producer.uiContext.workflowTabId = 'foreign-tab';
    },
    model: (x) => {
      x.expected.modelReceipt.source.revision = 'd'.repeat(40);
    },
    controls: (x) => {
      x.expected.controls.min_new_tokens = 1;
    },
    references: (x) => {
      x.expected.references[0].sha256 = sha('replaced source');
    },
  };
  for (const [name, mutate] of Object.entries(cases))
    await t.test(name, async () => {
      const input = fixture({ images: 1 });
      mutate(input);
      await assert.rejects(verify(input));
    });
});

test('raw layout hashing preserves representation and geometry while descriptions may be proposed', async () => {
  const input = fixture({ layout: layout() });
  await verify(input);
  input.expected.authoredLayout.regions[0].description = 'A concurrent authored layout edit.';
  await assert.rejects(verify(input), /authored layout digest/);
  const next = fixture({ layout: layout() });
  next.expected.authoredLayout.regions[0].targetBox[0] = 0.2;
  await assert.rejects(verify(next), /authored layout digest/);
  const invalid = fixture();
  invalid.expected.authoredLayout = 'null';
  await assert.rejects(verify(invalid));
});

test('external snapshot rejects getters/toJSON and is detached before async hashing', async () => {
  const input = fixture();
  let accessed = false;
  Object.defineProperty(input.expected, 'authoredPrompt', {
    enumerable: true,
    get() {
      accessed = true;
      return 'bad';
    },
  });
  await assert.rejects(verify(input), /data bindings/);
  assert.equal(accessed, false);
  const valid = fixture();
  const pending = verify(valid);
  valid.expected.authoredPrompt = 'Changed after the explicit immutable snapshot.';
  assert.equal((await pending).producer.taskId, producer.taskId);
  // A future UI still must recheck its live editing epoch after every await.
});

test('parity: native five-digit devices and 256-character type/architecture observations remain accepted', () => {
  const input = fixture();
  input.value.modelReceipt.runtime.device = 'cuda:12345';
  input.value.modelReceipt.runtime.modelType = 'A' + '-'.repeat(255);
  input.value.modelReceipt.runtime.architectures = ['Model-With-Hyphen'];
  assert.doesNotThrow(() => parse(input.value));
});

test('parity: malformed model type observations cannot become a native receipt', () => {
  for (const modelType of ['invalid space', 'invalid_\u{1f600}', 'A'.repeat(257), [], true]) {
    const input = fixture();
    input.value.modelReceipt.runtime.modelType = modelType;
    assert.throws(() => parse(input.value), /type|class/);
  }
});

test('parity: JSON structural entries include every object key', () => {
  const raw = JSON.stringify(Array.from({ length: 3000 }, () => ({ a: 0 })));
  assert.throws(() => contract.parsePromptEnhancementSummary(raw), /entries/);
});

test('parity: the existing consumed ASCII projection budget remains additive to UTF8', () => {
  const input = fixture();
  input.value.consumedInput.renderedPrompt = '\u{1f600}'.repeat(24000);
  input.value.consumedInput.fingerprints.rendered_prompt_utf8_bytes = 96000;
  input.value.consumedInput.fingerprints.rendered_prompt_sha256 = sha(input.value.consumedInput.renderedPrompt);
  assert.throws(() => parse(input.value), /ASCII/);
});

test('parity: the existing structured ASCII projection budget remains additive to UTF8', () => {
  const authored = layout();
  authored.regions = Array.from({ length: 32 }, (_, index) => ({
    ...copy(authored.regions[0]),
    id: `region_${index}`,
  }));
  const input = fixture({ layout: authored });
  for (const region of input.value.proposal.structuredProposal.layoutConditioning.regions)
    region.description = '\u{1f600}'.repeat(350);
  for (const row of input.value.proposal.structuredProposal.rawTable) row.desc = '\u{1f600}'.repeat(350);
  assert.throws(() => parse(input.value), /ASCII/);
});

test('parity: structured captions preserve the producer Markdown fence refusal', () => {
  const input = fixture({ layout: layout() });
  input.value.proposal.structuredProposal.caption += ' ```';
  assert.throws(() => parse(input.value), /fence/);
});

test('parity: external snapshot key bytes are bounded before unknown-key validation', async () => {
  const input = fixture();
  input.expected['x'.repeat(contract.MAX_ENHANCEMENT_SUMMARY_BYTES + 1)] = null;
  await assert.rejects(verify(input), /binding.*limit/);
});

test('historical ASCII lexical guard preserves native float/exponent spelling and exact boundary', () => {
  // Padding independently measured with Python json.dumps(ensure_ascii=True),
  // using native 1.0 / 1e-07 spellings. This is a lexical-budget probe, not a DTO.
  const prefix = 'escaped " quote } [ {"x":1} \u00e9';
  for (const key of ['consumedInput', 'consumed\\u0049nput', 'structuredProposal', 'structured\\u0050roposal']) {
    const raw = (extra) =>
      `{"${key}":{"text":${JSON.stringify(prefix + 'x'.repeat(262070 + extra))},"n":1.0,"tiny":1e-07}}`;
    assert.throws(
      () => contract.parsePromptEnhancementSummary(raw(0)),
      (error) => !/ASCII/.test(error.message),
    );
    assert.throws(() => contract.parsePromptEnhancementSummary(raw(1)), /ASCII/);
  }
  assert.throws(() => contract.parsePromptEnhancementSummary('{"consumedInput":{"n":1e--07}}'), SyntaxError);
});

test('Markdown fences in a target description are also refused before successful layout transport', () => {
  const input = fixture({ layout: layout() });
  input.value.proposal.structuredProposal.layoutConditioning.regions[0].description = 'not ``` native output';
  input.value.proposal.structuredProposal.rawTable[0].desc = 'not ``` native output';
  assert.throws(() => parse(input.value), /fence/);
});

test('decoded C0 controls are refused in every wire string, including nonhuman identities', () => {
  for (const mutate of [
    (value) => {
      value.producer.taskId = 'task\u0000';
    },
    (value) => {
      value.producer.sid = 'sid\u0001';
    },
    (value) => {
      value.modelReceipt.runtime.transformersVersion = '5.18.0\u001f';
    },
  ]) {
    const input = fixture();
    mutate(input.value);
    assert.throws(() => parse(input.value), /control/);
  }
});

test('decoded C1 controls are refused in nonhuman identities while tab LF CR remain valid', () => {
  for (const mutate of [
    (value) => {
      value.producer.workerInstance = 'unit\u007fworker';
    },
    (value) => {
      value.producer.uiContext.runInputHash = 'opaque\u0085correlation';
    },
    (value) => {
      value.modelReceipt.runtime.transformersVersion = '5.18.0\u009f';
    },
  ]) {
    const input = fixture();
    mutate(input.value);
    assert.throws(() => parse(input.value), /control/);
  }
  const input = fixture();
  input.value.producer.uiContext.runInputHash = 'opaque\t\n\rcorrelation';
  assert.doesNotThrow(() => parse(input.value));
});

test('exact optional native NF4 receipt is transport data and malformed recipes refuse', async () => {
  const input = fixture();
  const quantization = {
    mode: 'bnb_4bit',
    quantType: 'nf4',
    doubleQuant: true,
    computeDtype: 'bfloat16',
    skipModules: ['lm_head', 'model.visual'],
  };
  input.value.modelReceipt.runtime.quantization = copy(quantization);
  input.expected.modelReceipt.runtime.quantization = copy(quantization);
  input.value.modelReceipt.receiptDigest = sha(canonical(input.expected.modelReceipt));
  const result = await verify(input);
  assert.deepEqual(result.modelReceipt.runtime.quantization, quantization);
  assert.equal(Object.hasOwn(result, 'canApply'), false);
  for (const changed of [
    { ...quantization, doubleQuant: false },
    { ...quantization, doubleQuant: 1 },
    { ...quantization, quantType: 'fp4' },
    { ...quantization, computeDtype: 'float16' },
    { ...quantization, skipModules: ['model.visual', 'lm_head'] },
    { ...quantization, skipModules: ['lm_head'] },
    { ...quantization, skipModules: ['lm_head', 'model.visual', 'extra'] },
    { ...quantization, unexpected: true },
    { mode: ['none'] },
    { mode: 'none', quantType: 'nf4' },
  ]) {
    const malformed = copy(input.value);
    malformed.modelReceipt.runtime.quantization = changed;
    assert.throws(() => parse(malformed), /quantized provider|unknown|missing/);
  }
});
