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
let server, verify;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, ws: false },
  });
  ({ verifyImageEditSourceBinding: verify } = await server.ssrLoadModule('/scripts/image-edit-source-binding.mjs'));
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
