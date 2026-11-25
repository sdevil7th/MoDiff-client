import assert from 'node:assert/strict';

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
