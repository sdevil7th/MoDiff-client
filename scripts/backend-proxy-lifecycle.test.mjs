import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer, request } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger, createServer } from 'vite';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let loader;
let lifecycleModule;

before(async () => {
  loader = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  lifecycleModule = await loader.ssrLoadModule('/scripts/backend-proxy-lifecycle.ts');
});
after(async () => {
  await loader?.close();
});

test('only known errors owned by a disconnected browser bypass the proxy error logger', () => {
  const lifecycle = lifecycleModule.backendProxyLifecycle();
  const errors = [];
  const config = { logger: { error: (message) => errors.push(message) } };
  lifecycle.plugin.configResolved(config);
  const proxy = new EventEmitter();
  lifecycle.configure(proxy);
  const socket = new EventEmitter();
  const outgoing = new EventEmitter();
  proxy.emit('proxyReqWs', outgoing, new EventEmitter(), socket);
  const upstreamFailure = Object.assign(new Error('upstream failed'), { code: 'ECONNRESET' });
  proxy.emit('error', upstreamFailure, {}, socket);
  config.logger.error('upstream failed', { error: upstreamFailure });
  assert.deepEqual(errors, ['upstream failed']);
  socket.emit('end');
  for (const code of ['ECONNRESET', 'ECONNABORTED', 'EPIPE']) {
    const expected = Object.assign(new Error('browser left'), { code });
    outgoing.emit('error', expected);
    config.logger.error('browser left', { error: expected });
  }
  const unrelated = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
  proxy.emit('error', unrelated, {}, socket);
  config.logger.error('refused', { error: unrelated });
  config.logger.error('another error with similar text', { error: new Error('ECONNRESET') });
  assert.deepEqual(errors, ['upstream failed', 'refused', 'another error with similar text']);
});

async function openSocket(port) {
  return new Promise((resolve, reject) => {
    const client = request({
      hostname: '127.0.0.1',
      port,
      path: '/ws?sid=isolated-probe',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    client.on('error', reject);
    client.on('upgrade', (_response, socket) => {
      socket.on('error', () => {});
      resolve(socket);
    });
    client.end();
  });
}

test('real websocket proxy treats browser reset as teardown and reports an upstream reset', async () => {
  const backend = createHttpServer();
  const backendSockets = new Set();
  backend.on('upgrade', (incoming, socket) => {
    backendSockets.add(socket);
    socket.on('close', () => backendSockets.delete(socket));
    socket.on('error', () => {});
    const accept = createHash('sha1')
      .update(incoming.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const payload = JSON.stringify({ task_id: 'retained-task', status: 'running' });
    socket.write(Buffer.concat([Buffer.from([0x81, Buffer.byteLength(payload)]), Buffer.from(payload)]));
  });
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const lifecycle = lifecycleModule.backendProxyLifecycle();
  const errors = [];
  const logger = createLogger('silent');
  logger.error = (message) => errors.push(message);
  const frontend = await createServer({
    root: ROOT,
    configFile: false,
    customLogger: logger,
    plugins: [
      lifecycle.plugin,
      {
        name: 'isolated-browser-socket-probe',
        configureServer(server) {
          server.middlewares.use((incoming, response, next) => {
            if (incoming.url !== '/socket-probe') return next();
            response.setHeader('Content-Type', 'text/html');
            response.end(`<p id="connection">connecting</p><p id="task"></p><script>
            const ws = new WebSocket(location.origin.replace('http', 'ws') + '/ws');
            ws.onopen = () => document.querySelector('#connection').textContent = 'connected';
            ws.onmessage = (event) => {
              const task = JSON.parse(event.data);
              document.querySelector('#task').textContent = task.task_id + ':' + task.status;
            };
          </script>`);
          });
        },
      },
    ],
    optimizeDeps: { entries: [], noDiscovery: true },
    server: {
      host: '127.0.0.1',
      port: 0,
      watch: null,
      hmr: false,
      proxy: {
        '/ws': { target: `http://127.0.0.1:${backend.address().port}`, ws: true, configure: lifecycle.configure },
      },
    },
    appType: 'custom',
  });
  const clients = [];
  try {
    await frontend.listen();
    const port = frontend.httpServer.address().port;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const browser = await openSocket(port);
      clients.push(browser);
      browser.resetAndDestroy();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.deepEqual(errors, [], 'browser resets must not emit proxy stack traces');
    const browser = await openSocket(port);
    clients.push(browser);
    const upstream = [...backendSockets].at(-1);
    assert.ok(upstream);
    upstream.resetAndDestroy();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(
      errors.some((message) => message.includes('ws proxy error')),
      'an upstream reset while the browser is connected must remain visible',
    );
    errors.length = 0;
    const browserProcess = await chromium.launch({ headless: true });
    try {
      const page = await browserProcess.newPage();
      for (let refresh = 0; refresh < 3; refresh += 1) {
        await page.goto(`http://127.0.0.1:${port}/socket-probe`);
        await page.waitForFunction(
          () =>
            document.querySelector('#connection').textContent === 'connected' &&
            document.querySelector('#task').textContent === 'retained-task:running',
        );
      }
      await page.close();
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.deepEqual(
        errors,
        [],
        'browser refresh and close must preserve handshake/task delivery without proxy stack traces',
      );
    } finally {
      await browserProcess.close();
    }
  } finally {
    for (const client of clients) client.destroy();
    for (const socket of backendSockets) socket.destroy();
    await frontend.close();
    await new Promise((resolve) => backend.close(resolve));
  }
});
