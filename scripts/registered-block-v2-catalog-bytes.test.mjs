import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { registeredCatalogBytesMatch } from './registered-block-v2-catalog-bytes.mjs';

test('catalog verification accepts different gzip packaging of identical source bytes', () => {
  const source = Buffer.from('{"entries":[]}\n');
  const current = gzipSync(source, { level: 9 });
  const candidate = gzipSync(source, { level: 0 });
  candidate[9] = 10; // Windows OS header, independent of the payload.
  assert.notDeepEqual(current, candidate);
  assert.equal(registeredCatalogBytesMatch(current, candidate), true);
});

test('catalog verification rejects changed source bytes and corrupt compressed input', () => {
  const current = gzipSync('{"entries":[]}\n');
  assert.equal(registeredCatalogBytesMatch(current, gzipSync('{"entries":[{}]}\n')), false);
  assert.equal(registeredCatalogBytesMatch(current, gzipSync('{"entries":[]}')), false);
  assert.throws(() => registeredCatalogBytesMatch(current, Buffer.from('invalid gzip')));
});
