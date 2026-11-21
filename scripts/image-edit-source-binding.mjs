// Private join for an unchanged RGB image on the direct Image.Load â†’ Edit wire.
// The caller owns exact recipe, archived file, task and output authorization.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { coerceResolvedExecutionInputs } from '../src/studio/resolvedExecutionInputs.ts';
import { stableJsonValue } from './canonical-json.mjs';

const literal = (value) => ({ value, source: 'literal' });

export function verifyImageEditSourceBinding({ submittedApi, receipt, outputIdentity, loadId, editId }) {
  return verifyImageSourceBindings({
    submittedApi,
    receipt,
    outputIdentity,
    consumerId: editId,
    action: 'Edit',
    task: 'edit_image',
    ports: [{ input: 'image', loadId, mode: 'RGB', projectionKind: 'decoded-image-v1' }],
  }).inputs.image;
}

export function verifyImageInpaintSourceBinding({
  submittedApi,
  receipt,
  outputIdentity,
  sourceId,
  maskId,
  inpaintId,
}) {
  assert.notEqual(sourceId, maskId, 'Source and mask must be separate Image.Load nodes.');
  const { observed, inputs } = verifyImageSourceBindings({
    submittedApi,
    receipt,
    outputIdentity,
    consumerId: inpaintId,
    action: 'Inpaint',
    task: 'inpaint',
    ports: [
      { input: 'image', loadId: sourceId, mode: 'RGB', projectionKind: 'decoded-image-v1' },
      { input: 'mask_image', loadId: maskId, mode: 'L', projectionKind: 'decoded-mask-v1' },
    ],
  });
  const pipeline = submittedApi.nodes[inpaintId].params.pipeline;
  const ownerId = pipeline.sourceId;
  assert.deepEqual(pipeline, { display: 'input', sourceId: ownerId, sourceKey: 'pipeline' });
  assert.ok(![sourceId, maskId, inpaintId].includes(ownerId));
  const owner = submittedApi.nodes[ownerId];
  assert.equal(owner?.module, 'modules.DiffusersImage');
  assert.equal(owner.action, 'LoadPipeline');
  const observedOwner = observed.nodes.find((row) => row.nodeId === ownerId);
  assert.equal(observedOwner?.module, owner.module);
  assert.equal(observedOwner.action, owner.action);
  const repo = 'stable-diffusion-v1-5/stable-diffusion-v1-5';
  assert.deepEqual(owner.params.model_id.value, { source: 'hub', value: repo });
  assert.deepEqual(observedOwner.fields.model_id, literal(repo));
  for (const [field, value] of Object.entries({
    mode: 'inpaint',
    pipeline_class: 'StableDiffusionInpaintPipeline',
    revision: '451f4fe16113bff5a5d2269ed5ad43b0592e9a14',
  })) {
    assert.equal(owner.params[field].value, value, `Unexpected Inpaint loader ${field}.`);
    assert.deepEqual(observedOwner.fields[field], literal(value), `Unexpected native Inpaint loader ${field}.`);
  }
  const { image: source, mask_image: mask } = inputs;
  assert.notEqual(source.sourceFile.sourceValue, mask.sourceFile.sourceValue);
  assert.notEqual(source.sourceFile.sha256, mask.sourceFile.sha256);
  assert.deepEqual(
    [source.decodedImage.width, source.decodedImage.height],
    [mask.decodedImage.width, mask.decodedImage.height],
    'Inpaint source and mask must share their original geometry.',
  );
  return { source, mask };
}

function verifyImageSourceBindings({ submittedApi, receipt, outputIdentity, consumerId, action, task, ports }) {
  const consumer = submittedApi.nodes[consumerId];
  assert.equal(consumer?.module, 'modules.DiffusersImage');
  assert.equal(consumer.action, action);
  for (const { input, loadId } of ports) {
    assert.notEqual(loadId, consumerId, `Load and ${action} must be separate nodes.`);
    assert.deepEqual(
      consumer.params[input],
      { display: 'input', sourceId: loadId, sourceKey: 'image' },
      `${action} must have the declared single Image.Load ${input} wire.`,
    );
  }
  const observed = coerceResolvedExecutionInputs(receipt, outputIdentity);
  assert.ok(observed && !observed.truncated && observed.uncapturedNodeIds.length === 0, 'Incomplete native receipt.');
  assert.deepEqual(observed.mediaEvidenceStatus, { schemaVersion: 1, truncated: false });
  assert.deepEqual(observed.fieldAccountingStatus, { schemaVersion: 1, truncated: false });
  const target = observed.nodes.find((row) => row.nodeId === consumerId);
  assert.equal(target?.module, consumer.module);
  assert.equal(target.action, consumer.action);
  assert.deepEqual(target.omittedFields, {});
  assert.deepEqual(target.fields.executed_task, literal(task));
  const accounting = target.fieldAccounting;
  assert.equal(accounting?.complete, true, `${action} input accounting must be complete.`);
  const inputs = Object.fromEntries(
    ports.map(({ input, loadId, mode, projectionKind }) => [
      input,
      verifyOneDecodedSource(
        submittedApi.nodes[loadId],
        observed.nodes.find((row) => row.nodeId === loadId),
        accounting.inputProjections[input],
        { loadId, mode, projectionKind, action },
      ),
    ]),
  );
  return { observed, inputs };
}

function verifyOneDecodedSource(load, loaded, projection, { loadId, mode, projectionKind, action }) {
  assert.equal(load?.module, 'modules.Image');
  assert.equal(load.action, 'Load');
  assert.equal(loaded?.module, load.module);
  assert.equal(loaded.action, load.action);
  assert.deepEqual(loaded.omittedFields, {});

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
  assert.equal(decoded.mode, mode);
  assert.deepEqual(media.controls, { alpha_channel: load.params.alpha_channel.value });
  assert.deepEqual(loaded.fields, {
    alpha_channel: literal(media.controls.alpha_channel),
    source_hashes: literal([file.sha256]),
    source_widths: literal([decoded.width]),
    source_heights: literal([decoded.height]),
    source_modes: literal([mode]),
  });

  assert.equal(projection.kind, projectionKind);
  assert.equal(projection.source, 'connected');
  assert.equal(projection.sourceNodeId, loadId, `${action} recorded a different source node.`);
  assert.equal(projection.sourcePortId, 'image', `${action} recorded a different source port.`);
  assert.deepEqual(projection.values, decoded, `${action} input pixels or geometry differ from the decoded source.`);
  const digest = createHash('sha256')
    .update(`${projectionKind}\n${JSON.stringify(stableJsonValue(decoded))}`, 'ascii')
    .digest('hex');
  assert.equal(projection.sha256, digest, `${action} image projection digest differs.`);
  return { sourceFile: file, decodedImage: decoded };
}
