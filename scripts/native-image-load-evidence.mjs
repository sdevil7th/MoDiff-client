import assert from 'node:assert/strict';

export function verifyRetainedHostImageFiles(observation, { taskId, persistedOutputSha256, inputs }) {
  assert.deepEqual(Object.keys(observation).sort(), ['files', 'persistedOutputSha256', 'taskId']);
  assert.equal(observation.taskId, taskId);
  assert.equal(observation.persistedOutputSha256, persistedOutputSha256);
  const bySource = (items) => [...items].sort((left, right) => left.sourceValue.localeCompare(right.sourceValue));
  assert.deepEqual(
    bySource(observation.files),
    bySource(inputs.map(({ sourceValue, file }) => ({ sourceValue, byteSize: file.bytes, sha256: file.sha256 }))),
    'Original host inputs differ from the saved media.',
  );
}

const literal = (value) => ({ value, source: 'literal' });

export function verifyNativeLoadedImages(load, loaded, modes) {
  assert.equal(load?.module, 'modules.Image');
  assert.equal(load.action, 'Load');
  assert.equal(loaded?.module, load.module);
  assert.equal(loaded.action, load.action);
  assert.deepEqual(loaded.omittedFields, {});

  const media = loaded.mediaEvidence;
  assert.equal(media?.status, 'complete', 'The native source decode is missing.');
  assert.ok(modes.length > 0);
  const files = media.files.file;
  assert.equal(
    files?.length,
    modes.length,
    modes.length === 1 ? 'A single native file observation is required.' : 'Native file observation count differs.',
  );
  for (const file of files) {
    assert.ok(typeof file.sourceValue === 'string' && file.sourceValue && file.byteSize > 0 && !file.converted);
  }
  assert.deepEqual(
    load.params.file,
    { display: 'filebrowser', value: files.map(({ sourceValue }) => sourceValue) },
    'Image.Load file differs from the declared selection.',
  );
  assert.equal(
    media.outputs.image?.length,
    modes.length,
    modes.length === 1 ? 'A single native decoded image is required.' : 'Native decoded image count differs.',
  );
  const images = media.outputs.image.map(({ kind, ...decodedImage }, index) => {
    assert.equal(kind, 'image');
    assert.equal(decodedImage.mode, modes[index]);
    return { sourceFile: files[index], decodedImage };
  });
  assert.deepEqual(media.controls, { alpha_channel: load.params.alpha_channel.value });
  assert.deepEqual(loaded.fields, {
    alpha_channel: literal(media.controls.alpha_channel),
    source_hashes: literal(files.map(({ sha256 }) => sha256)),
    source_widths: literal(images.map(({ decodedImage }) => decodedImage.width)),
    source_heights: literal(images.map(({ decodedImage }) => decodedImage.height)),
    source_modes: literal(modes),
  });
  return images;
}

export function verifyNativeLoadedImage(load, loaded, mode) {
  const [image] = verifyNativeLoadedImages(load, loaded, [mode]);
  return image;
}

export function verifyNativeCanny(settings, evidence, decodedGuide) {
  assert.equal(evidence?.schemaVersion, 1);
  assert.equal(evidence.source, 'native-builtin-media-v1');
  assert.equal(evidence.status, 'complete');
  const thresholds = [settings.low_threshold.value, settings.high_threshold.value];
  const outputMode = settings.output_mode?.value ?? 'L';
  assert.deepEqual(evidence.controls, {
    low_threshold: Math.min(...thresholds),
    high_threshold: Math.max(...thresholds),
    output_mode: outputMode,
    device: settings.device.value,
  });
  assert.deepEqual(evidence.inputs, { image: [{ kind: 'image', ...decodedGuide }] }, 'Canny guide bytes differ.');
  assert.deepEqual(evidence.files, {});
  assert.deepEqual(Object.keys(evidence.outputs), ['output']);
  assert.equal(evidence.outputs.output.length, 1);
  const [edgeImage] = evidence.outputs.output;
  assert.equal(edgeImage.kind, 'image');
  assert.equal(edgeImage.mode, outputMode);
  assert.deepEqual([edgeImage.width, edgeImage.height], [decodedGuide.width, decodedGuide.height]);
  assert.match(edgeImage.sha256, /^[a-f0-9]{64}$/u);
  assert.ok(edgeImage.byteSize > 0);
  return evidence.outputs.output;
}
