import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

let fileApiModule;
let originalFetch;
let requestModule;
let server;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(entryPath);
      return /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : [];
    }),
  );
  return nested.flat();
}

before(async () => {
  globalThis.window = {
    dispatchEvent: () => true,
    location: { origin: 'http://127.0.0.1:5191' },
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  requestModule = await server.ssrLoadModule('/src/utils/requestJson.ts');
  fileApiModule = await server.ssrLoadModule('/src/utils/backendUpload.ts');
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('production source keeps raw fetch calls inside the request transport boundary', async () => {
  const violations = [];
  for (const filename of await sourceFiles(SRC)) {
    const source = await readFile(filename, 'utf8');
    if (/\bfetch\s*\(/.test(source) && !filename.endsWith(path.join('utils', 'requestJson.ts'))) {
      violations.push(path.relative(ROOT, filename));
    }
  }
  assert.deepEqual(violations, []);
});

test('the development proxy covers run attribution and workflow restoration routes', async () => {
  const viteConfig = await readFile(path.join(ROOT, 'vite.config.ts'), 'utf8');
  for (const route of ['/runs', '/workflows', '/queue', '/graph', '/ws']) {
    assert.match(viteConfig, new RegExp(`['"]${route}['"]`), `${route} must be proxied to the backend`);
  }
});

test('binary request helpers consume blobs and array buffers through the shared transport', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  globalThis.fetch = async () => new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/png' } });

  const blob = await requestModule.requestBlob('/image');
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  assert.deepEqual(new Uint8Array(await requestModule.requestArrayBuffer('/bytes')), bytes);
});

test('binary HTTP failures preserve structured backend messages', async () => {
  globalThis.fetch = async () => jsonResponse({ error: true, message: 'Media is unavailable.' }, 404);

  await assert.rejects(requestModule.requestBlob('/missing'), (error) => {
    assert.equal(error.kind, 'http');
    assert.equal(error.status, 404);
    assert.equal(error.message, 'Media is unavailable.');
    return true;
  });
});

test('file uploads use multipart form data and validate returned paths', async () => {
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return jsonResponse({ error: false, path: ['images/example.png'] });
  };

  const paths = await fileApiModule.uploadBackendFile(
    new File([new Uint8Array([1, 2])], 'example.png', { type: 'image/png' }),
    'images',
  );
  assert.match(request.url, /\/file$/);
  assert.equal(request.init.method, 'POST');
  assert.ok(request.init.body instanceof FormData);
  assert.equal(request.init.body.get('type'), 'images');
  assert.deepEqual(paths, ['images/example.png']);

  globalThis.fetch = async () => jsonResponse({ error: 'Upload rejected.' });
  await assert.rejects(
    fileApiModule.uploadBackendFile(new File(['x'], 'bad.png', { type: 'image/png' }), 'images'),
    (error) => error.kind === 'application' && error.message === 'Upload rejected.',
  );
});
