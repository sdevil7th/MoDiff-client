import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let browser;
let page;

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
    appType: 'custom',
    plugins: [
      {
        name: 'png-package-codec-probe',
        configureServer(vite) {
          vite.middlewares.use('/png-package-probe', (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end('<!doctype html><title>PNG package codec regression</title>');
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/png-package-probe`);
});

after(async () => {
  await browser?.close();
  await server?.close();
});

for (const mime of ['image/webp', 'image/jpeg', 'image/png']) {
  test(`${mime} exports a real PNG preserving decoded pixels and exact workflow metadata`, async () => {
    const proof = await page.evaluate(async (mime) => {
      const { createPngWithWorkflowMetadata, extractWorkflowPackageFromPngBytes } =
        await import('/src/studio/workflowPackage.ts');
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 16;
      const context = canvas.getContext('2d');
      context.fillStyle = '#1463a0';
      context.fillRect(0, 0, 32, 16);
      context.fillStyle = '#e7ad3a';
      context.fillRect(3, 4, 15, 9);
      const sourceUrl = canvas.toDataURL(mime);
      const sourceBlob = await (await fetch(sourceUrl)).blob();
      const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer());
      const sourceImage = await createImageBitmap(sourceBlob);
      context.clearRect(0, 0, 32, 16);
      context.drawImage(sourceImage, 0, 0);
      const expectedPixels = [...context.getImageData(0, 0, 32, 16).data];
      sourceImage.close();
      const metadata = { graph: { nodes: [], edges: [] }, marker: 'Preserve café / 日本語 / seed 173' };
      const png = await createPngWithWorkflowMetadata(sourceUrl, metadata);
      const bytes = new Uint8Array(await png.arrayBuffer());
      const image = await createImageBitmap(png);
      context.clearRect(0, 0, 32, 16);
      context.drawImage(image, 0, 0);
      const actualPixels = [...context.getImageData(0, 0, 32, 16).data];
      const dimensions = [image.width, image.height];
      image.close();
      return {
        mime: sourceBlob.type,
        exportedType: png.type,
        signature: [...bytes.slice(0, 8)],
        metadata: extractWorkflowPackageFromPngBytes(bytes),
        expectedMetadata: metadata,
        expectedPixels,
        actualPixels,
        dimensions,
        sourceBytes: [...sourceBytes],
        exportedBytes: [...bytes],
      };
    }, mime);
    assert.equal(proof.mime, mime);
    assert.equal(proof.exportedType, 'image/png');
    assert.deepEqual(proof.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.deepEqual(proof.dimensions, [32, 16]);
    assert.deepEqual(proof.actualPixels, proof.expectedPixels);
    assert.deepEqual(proof.metadata, proof.expectedMetadata);
    if (mime === 'image/png') {
      assert.deepEqual(proof.exportedBytes.slice(0, proof.sourceBytes.length - 12), proof.sourceBytes.slice(0, -12));
      assert.deepEqual(proof.exportedBytes.slice(-12), proof.sourceBytes.slice(-12));
    }
  });
}

test('an undecodable source remains an export failure', async () => {
  const error = await page.evaluate(async () => {
    const { createPngWithWorkflowMetadata } = await import('/src/studio/workflowPackage.ts');
    try {
      await createPngWithWorkflowMetadata('data:image/webp;base64,aW52YWxpZA==', {});
      return null;
    } catch (error) {
      return String(error);
    }
  });
  assert.ok(error, 'Invalid image bytes must not produce a successful package');
});
