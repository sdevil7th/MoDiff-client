import assert from 'node:assert/strict';

const literal = (value) => ({ value, source: 'literal' });

export function verifyNativeLoadedImage(load, loaded, mode) {
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
  return { sourceFile: file, decodedImage: decoded };
}
