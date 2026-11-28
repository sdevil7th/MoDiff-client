import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { stableJsonValue } from './canonical-json.mjs';

const fixture = JSON.parse(
  readFileSync(new URL('../tests/fixtures/image-edit-source-binding.v1.json', import.meta.url), 'utf8'),
);
const decode = (sample) => sample.receipt.nodes.find((row) => row.nodeId === sample.loadId).mediaEvidence;
const accounting = (sample) => sample.receipt.nodes.find((row) => row.nodeId === sample.editId).fieldAccounting;
let server, verify, verifyInpaint;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, ws: false },
  });
  ({ verifyImageEditSourceBinding: verify, verifyImageInpaintSourceBinding: verifyInpaint } =
    await server.ssrLoadModule('/scripts/image-edit-source-binding.mjs'));
});

after(async () => server?.close());

test('joins the actual same-size Load and Edit producer records', () => {
  const supplied = structuredClone(fixture);
  const { kind, ...decoded } = decode(fixture).outputs.image[0];
  assert.equal(kind, 'image');
  assert.deepEqual(verify(supplied), { sourceFile: decode(fixture).files.file[0], decodedImage: decoded });
  assert.deepEqual(supplied, fixture, 'The private check must preserve original receipts.');
});

for (const [label, replace, error] of [
  [
    'changed pixels with equal geometry and a valid new projection digest',
    (sample) => {
      const projection = accounting(sample).inputProjections.image;
      projection.values.sha256 = 'b'.repeat(64);
      projection.sha256 = createHash('sha256')
        .update(`decoded-image-v1\n${JSON.stringify(stableJsonValue(projection.values))}`, 'ascii')
        .digest('hex');
    },
    /pixels or geometry/u,
  ],
  [
    'wrong projection digest',
    (sample) => (accounting(sample).inputProjections.image.sha256 = 'b'.repeat(64)),
    /projection digest/u,
  ],
  [
    'changed projection geometry with the same byte count',
    (sample) => {
      const values = accounting(sample).inputProjections.image.values;
      [values.width, values.height] = [values.height, values.width];
    },
    /pixels or geometry/u,
  ],
  [
    'a graph wire that names the wrong producer port',
    (sample) => (sample.submittedApi.nodes[sample.editId].params.image.sourceKey = 'mask'),
    /declared single/u,
  ],
  [
    'a native projection from another producer',
    (sample) => (accounting(sample).inputProjections.image.sourceNodeId = 'wrong-load'),
    /different source node/u,
  ],
  [
    'a native projection from another port',
    (sample) => (accounting(sample).inputProjections.image.sourcePortId = 'mask'),
    /different source port/u,
  ],
  [
    'multiple decoded images',
    (sample) => decode(sample).outputs.image.push(decode(sample).outputs.image[0]),
    /single native decoded image/u,
  ],
  ['multiple files', (sample) => decode(sample).files.file.push(decode(sample).files.file[0]), /single native file/u],
  [
    'a changed original file selection',
    (sample) => (sample.submittedApi.nodes[sample.loadId].params.file.value = ['other.png']),
    /declared selection/u,
  ],
  [
    'an overridden source image',
    (sample) => {
      const edit = accounting(sample);
      const { kind, values, sha256 } = edit.inputProjections.image;
      edit.inputProjections.image = { kind, values, sha256, source: 'override' };
      edit.omittedFields = { image: 'unsupported-origin', overrides: 'unsupported-origin' };
      edit.complete = false;
    },
    /must be complete/u,
  ],
  [
    'an output from another attempt',
    (sample) => (sample.outputIdentity.attemptIndex = 1),
    /Incomplete native receipt/u,
  ],
]) {
  test(`rejects ${label}`, () => {
    const modified = structuredClone(fixture);
    replace(modified);
    assert.throws(() => verify(modified), error);
  });
}

const old = process.env.MODIFF_SD15_EDIT_PAIRED_RECEIPTS;
test('the earlier deliberate-resize producer trace cannot prove original pixels', { skip: !old }, () => {
  const [deliberatelyResized] = JSON.parse(readFileSync(old, 'utf8'));
  const modified = structuredClone(fixture);
  const projection = structuredClone(deliberatelyResized.nodes[0].fieldAccounting.inputProjections.image);
  projection.sourceNodeId = modified.loadId;
  accounting(modified).inputProjections.image = projection;
  assert.throws(() => verify(modified), /pixels or geometry/u);
});

function pairedInpaintFixture(
  expectedOwner = {
    modelRepo: 'stable-diffusion-v1-5/stable-diffusion-v1-5',
    modelRevision: '451f4fe16113bff5a5d2269ed5ad43b0592e9a14',
    loaderClass: 'StableDiffusionInpaintPipeline',
  },
) {
  const value = structuredClone(fixture);
  const { submittedApi, receipt, editId: inpaintId, loadId: sourceId } = value;
  const maskId = 'mask';
  const target = submittedApi.nodes[inpaintId];
  target.action = 'Inpaint';
  target.params.mask_image = { display: 'input', sourceId: maskId, sourceKey: 'image' };
  const mask = (submittedApi.nodes[maskId] = structuredClone(submittedApi.nodes[sourceId]));
  mask.params.file.value = ['@data/images/test-mask.png'];
  const literal = (value) => ({ value, source: 'literal' });
  const observed = receipt.nodes.find((row) => row.nodeId === inpaintId);
  observed.action = 'Inpaint';
  observed.fields.executed_task = literal('inpaint');
  receipt.summary.executedTask = 'inpaint';
  const loaded = structuredClone(receipt.nodes.find((row) => row.nodeId === sourceId));
  loaded.nodeId = maskId;
  const [file] = loaded.mediaEvidence.files.file;
  file.sourceValue = mask.params.file.value[0];
  file.sha256 = 'c'.repeat(64);
  const [decoded] = loaded.mediaEvidence.outputs.image;
  decoded.mode = 'L';
  decoded.byteSize = decoded.width * decoded.height;
  decoded.sha256 = 'd'.repeat(64);
  loaded.fields.source_modes = literal(['L']);
  loaded.fields.source_hashes = literal([file.sha256]);
  receipt.nodes.push(loaded);
  receipt.ambiguousFields.push('imageSourceHashes', 'imageSourceModes');
  delete receipt.summary.imageSourceHashes;
  delete receipt.summary.imageSourceModes;
  const { kind: _kind, ...pixels } = decoded;
  observed.fieldAccounting.inputProjections.mask_image = {
    kind: 'decoded-mask-v1',
    values: pixels,
    sha256: createHash('sha256')
      .update(`decoded-mask-v1\n${JSON.stringify(stableJsonValue(pixels))}`, 'ascii')
      .digest('hex'),
    source: 'connected',
    sourceNodeId: maskId,
    sourcePortId: 'image',
  };
  const owner = 'model';
  target.params.pipeline = { display: 'input', sourceId: owner, sourceKey: 'pipeline' };
  const module = 'modules.DiffusersImage';
  const action = 'LoadPipeline';
  const { modelRepo, modelRevision, loaderClass } = expectedOwner;
  const controls = {
    model_id: modelRepo,
    mode: 'inpaint',
    pipeline_class: loaderClass,
    revision: modelRevision,
  };
  submittedApi.nodes[owner] = {
    module,
    action,
    params: Object.fromEntries(
      Object.entries(controls).map(([key, item]) => [
        key,
        { value: key === 'model_id' ? { source: 'hub', value: item } : item },
      ]),
    ),
  };
  const ownerRecord = {
    nodeId: owner,
    module,
    action,
    fields: Object.fromEntries(Object.entries(controls).map(([key, item]) => [key, literal(item)])),
    omittedFields: {},
  };
  receipt.nodes.push(ownerRecord);
  Object.assign(receipt.summary, {
    repo: modelRepo,
    executionMode: controls.mode,
    modelType: controls.pipeline_class,
    revision: controls.revision,
  });
  return { submittedApi, receipt, outputIdentity: value.outputIdentity, sourceId, maskId, inpaintId, expectedOwner };
}

test('direct SDXL Inpaint rejects an otherwise valid source and mask from an SD 1.5 recipe', () => {
  const expectedOwner = {
    modelRepo: 'stabilityai/stable-diffusion-xl-base-1.0',
    modelRevision: '462165984030d82259a11f4367a4eed129e94a7b',
    loaderClass: 'StableDiffusionXLInpaintPipeline',
  };
  const sample = pairedInpaintFixture(expectedOwner);
  assert.equal(verifyInpaint(sample).mask.decodedImage.mode, 'L');
  assert.throws(() => verifyInpaint({ ...pairedInpaintFixture(), expectedOwner }));
});

test('direct Inpaint independently joins the RGB source and grayscale mask to their actual call', () => {
  const sample = pairedInpaintFixture();
  const original = structuredClone(sample);
  const joined = verifyInpaint(sample);
  assert.equal(joined.source.decodedImage.mode, 'RGB');
  assert.equal(joined.mask.decodedImage.mode, 'L');
  assert.equal(joined.mask.sourceFile.sourceValue, '@data/images/test-mask.png');
  assert.deepEqual(sample, original);
});

test('direct Inpaint rejects missing, swapped, rehashed or overridden mask evidence and a mismatched model pin', () => {
  const inputProjections = (s) => s.receipt.nodes[0].fieldAccounting.inputProjections;
  const mutate = [
    (s) => delete inputProjections(s).mask_image,
    (s) => (s.submittedApi.nodes[s.inpaintId].params.mask_image.sourceId = s.sourceId),
    (s) => (inputProjections(s).mask_image.sourceNodeId = s.sourceId),
    (s) => (inputProjections(s).mask_image.kind = 'decoded-image-v1'),
    (s) => (inputProjections(s).mask_image.source = 'override'),
    (s) => {
      const projection = inputProjections(s).mask_image;
      projection.values.sha256 = 'e'.repeat(64);
      projection.sha256 = createHash('sha256')
        .update(`decoded-mask-v1\n${JSON.stringify(stableJsonValue(projection.values))}`, 'ascii')
        .digest('hex');
    },
    (s) => (s.receipt.nodes.find((row) => row.nodeId === 'model').fields.revision.value = '0'.repeat(40)),
    (s) => (s.outputIdentity.attemptIndex = 1),
  ];
  for (const change of mutate) {
    const sample = pairedInpaintFixture();
    change(sample);
    assert.throws(() => verifyInpaint(sample));
  }
});
