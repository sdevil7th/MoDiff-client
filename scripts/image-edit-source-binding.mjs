// Private join for an unchanged RGB image on the direct Image.Load â†’ Edit wire.
// The caller owns exact recipe, archived file, task and output authorization.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { coerceResolvedExecutionInputs } from '../src/studio/resolvedExecutionInputs.ts';
import { stableJsonValue } from './canonical-json.mjs';

const literal = (value) => ({ value, source: 'literal' });

export function verifyImageEditSourceBinding({ submittedApi, receipt, outputIdentity, loadId, editId }) {
  assert.notEqual(loadId, editId, 'Load and Edit must be separate nodes.');
  const load = submittedApi.nodes[loadId];
  const edit = submittedApi.nodes[editId];
  assert.equal(load?.module, 'modules.Image');
  assert.equal(load.action, 'Load');
  assert.equal(edit?.module, 'modules.DiffusersImage');
  assert.equal(edit.action, 'Edit');
  assert.deepEqual(
    edit.params.image,
    { display: 'input', sourceId: loadId, sourceKey: 'image' },
    'Edit must have the declared single Image.Load image wire.',
  );

  const observed = coerceResolvedExecutionInputs(receipt, outputIdentity);
  assert.ok(observed && !observed.truncated && observed.uncapturedNodeIds.length === 0, 'Incomplete native receipt.');
  assert.deepEqual(observed.mediaEvidenceStatus, { schemaVersion: 1, truncated: false });
  assert.deepEqual(observed.fieldAccountingStatus, { schemaVersion: 1, truncated: false });
  const loaded = observed.nodes.find((row) => row.nodeId === loadId);
  const edited = observed.nodes.find((row) => row.nodeId === editId);
  assert.equal(loaded?.module, load.module);
  assert.equal(loaded.action, load.action);
  assert.equal(edited?.module, edit.module);
  assert.equal(edited.action, edit.action);
  assert.deepEqual(loaded.omittedFields, {});
  assert.deepEqual(edited.omittedFields, {});
  assert.deepEqual(edited.fields.executed_task, literal('edit_image'));

  const media = loaded.mediaEvidence;
  assert.equal(media?.status, 'complete', 'The native source decode is missing.');
  assert.equal(media.files.file?.length, 1, 'A single native file observation is required.');
  const [file] = media.files.file;
  assert.ok(typeof file.sourceValue === 'string' && file.sourceValue && file.byteSize > 0 && !file.converted);
  assert.deepEqual(
    load.params.file,
    { display: 'filebrowser', value: [file.sourceValue] },
    'Image.Load file differs from the declared selection.',
  );
  assert.equal(media.outputs.image?.length, 1, 'A single native decoded image is required.');
  const [{ kind, ...decoded }] = media.outputs.image;
  assert.equal(kind, 'image');
  assert.equal(decoded.mode, 'RGB');
  assert.deepEqual(media.controls, { alpha_channel: load.params.alpha_channel.value });
  assert.deepEqual(loaded.fields, {
    alpha_channel: literal(media.controls.alpha_channel),
    source_hashes: literal([file.sha256]),
    source_widths: literal([decoded.width]),
    source_heights: literal([decoded.height]),
    source_modes: literal(['RGB']),
  });

  const accounting = edited.fieldAccounting;
  assert.equal(accounting?.complete, true, 'Edit input accounting must be complete.');
  const projection = accounting.inputProjections.image;
  assert.equal(projection.kind, 'decoded-image-v1');
  assert.equal(projection.source, 'connected');
  assert.equal(projection.sourceNodeId, loadId, 'Edit recorded a different source node.');
  assert.equal(projection.sourcePortId, 'image', 'Edit recorded a different source port.');
  assert.deepEqual(projection.values, decoded, 'Edit input pixels or geometry differ from the decoded source.');
  const digest = createHash('sha256')
    .update(`decoded-image-v1\n${JSON.stringify(stableJsonValue(decoded))}`, 'ascii')
    .digest('hex');
  assert.equal(projection.sha256, digest, 'Edit image projection digest differs.');
  return { sourceFile: file, decodedImage: decoded };
}
