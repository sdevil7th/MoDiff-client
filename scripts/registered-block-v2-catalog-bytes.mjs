import { gunzipSync } from 'node:zlib';

// gzip headers and deflate output vary by OS/zlib version. The entire decoded
// source must still match byte-for-byte, including ordering and whitespace.
export function registeredCatalogBytesMatch(current, candidate) {
  return gunzipSync(current).equals(gunzipSync(candidate));
}
