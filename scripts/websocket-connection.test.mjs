import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
const originalXhr = globalThis.XMLHttpRequest;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
let server;
let store;
let sockets;
let probes;
let timers;
let nextTimer;

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = FakeSocket.CONNECTING;
  constructor(url) {
    this.url = url;
    sockets.push(this);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
  fail() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
}

class LegacyProbe {
  open(_method, url) {
    this.url = url;
  }
  send() {
    probes.push({
      url: this.url,
      signal: undefined,
      respond: (status) => {
        this.status = status;
        this.onload?.();
      },
    });
  }
}

before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
    key: (index) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
  };
  globalThis.window = { dispatchEvent: () => true, localStorage, location: { origin: 'http://127.0.0.1:5191' } };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  store = (await server.ssrLoadModule('/src/stores/useWebsocketStore.ts')).useWebsocketStore;
});

beforeEach(() => {
  store.getState().disconnect();
  sockets = [];
  probes = [];
  timers = new Map();
  nextTimer = 0;
  globalThis.WebSocket = FakeSocket;
  globalThis.XMLHttpRequest = LegacyProbe;
  globalThis.setTimeout = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  globalThis.fetch = (url, init) =>
    new Promise((resolve) => {
      probes.push({
        url: String(url),
        signal: init.signal,
        respond: (status, body = { error: false, ready: true }) =>
          resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
      });
    });
});

after(async () => {
  store?.getState().disconnect();
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  globalThis.XMLHttpRequest = originalXhr;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  await server?.close();
});

async function settle() {
  await new Promise((resolve) => originalSetTimeout(resolve, 0));
}

function enterHealthRecovery() {
  const previousProbes = probes.length;
  store.getState().connect();
  store.setState({ reconnectAttempts: 5 });
  sockets.at(-1).fail();
  assert.equal(probes.length, previousProbes + 1);
  return probes.at(-1);
}

test('recovery checks backend health instead of a frontend favicon and rejects HTTP failures', async () => {
  const probe = enterHealthRecovery();
  probe.respond(502);
  await settle();
  assert.match(probe.url, /\/health$/);
  assert.equal(sockets.length, 1);
  assert.equal(store.getState().reconnectAttempts, 5);
  assert.ok([...timers.values()].some(({ delay }) => delay >= 2000 && delay <= 3000));
});

test('a successful response with an unready or malformed health payload does not reconnect', async () => {
  for (const payload of [{ error: false, ready: false }, { ready: true }, { error: false, ready: 'true' }]) {
    const previous = sockets.length;
    const probe = enterHealthRecovery();
    probe.respond(200, payload);
    await settle();
    assert.equal(sockets.length, previous + 1);
    store.getState().disconnect();
  }
});

test('disconnect aborts its health probe and a late successful response cannot reconnect', async () => {
  const probe = enterHealthRecovery();
  store.getState().disconnect();
  probe.respond(200);
  await settle();
  assert.equal(probe.signal?.aborted, true);
  assert.equal(sockets.length, 1);
  assert.equal(store.getState().ws, null);
  assert.equal(store.getState().isConnecting, false);
  assert.equal(timers.size, 0);
});

test('healthy recovery retains the retry budget until the websocket actually opens', async () => {
  const probe = enterHealthRecovery();
  probe.respond(200);
  await settle();
  assert.equal(sockets.length, 2);
  assert.equal(store.getState().reconnectAttempts, 5);
  sockets.at(-1).open();
  assert.equal(store.getState().reconnectAttempts, 0);
  assert.equal(store.getState().isConnected, true);
});

test('stale recovery callbacks cannot replace a newer manually connected socket', async () => {
  const probe = enterHealthRecovery();
  store.getState().disconnect();
  store.getState().connect();
  const current = sockets.at(-1);
  current.open();
  probe.respond(200);
  await settle();
  assert.equal(sockets.length, 2);
  assert.equal(store.getState().ws, current);
  assert.equal(store.getState().isConnected, true);
});

test('disconnect cancels a retry timer even when its callback was already queued', () => {
  store.getState().connect();
  sockets.at(-1).fail();
  const timer = [...timers.values()][0];
  assert.ok(timer);
  store.getState().disconnect();
  timer.callback();
  assert.equal(sockets.length, 1);
  assert.equal(store.getState().ws, null);
});

test('a stalled backend health request times out and retries without starting another socket', async () => {
  globalThis.fetch = (url, init) =>
    new Promise((_resolve, reject) => {
      probes.push({ url: String(url), signal: init.signal });
      init.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    });
  enterHealthRecovery();
  const [timeoutId, timeout] = [...timers.entries()].find(([, timer]) => timer.delay === 5000);
  timers.delete(timeoutId);
  timeout.callback();
  await settle();
  assert.equal(probes[0].signal.aborted, true);
  assert.equal(sockets.length, 1);
  assert.equal(store.getState().reconnectAttempts, 5);
  assert.equal(timers.size, 1);
});
