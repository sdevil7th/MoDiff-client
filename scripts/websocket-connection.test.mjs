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
let nodeStore, originalRuntimeRead, runtimeReads;
let control;
let config;

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
  nodeStore = (await server.ssrLoadModule('/src/stores/useNodeStore.ts')).useNodesStore;
  originalRuntimeRead = nodeStore.getState().fetchRuntimeStatus;
  control = await server.ssrLoadModule('/src/utils/supervisorControl.ts');
  config = (await server.ssrLoadModule('/app.config.ts')).default;
});

beforeEach(() => {
  store.getState().disconnect();
  store.setState({ address: null });
  control.resetSupervisorControl();
  sockets = [];
  probes = [];
  timers = new Map();
  nextTimer = 0;
  runtimeReads = 0;
  nodeStore.setState({
    fetchRuntimeStatus: async () => {
      runtimeReads += 1;
    },
  });
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
  nodeStore?.setState({ fetchRuntimeStatus: originalRuntimeRead });
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

test('an unready replacement health instance refreshes runtime once without reconnecting', async () => {
  const probe = enterHealthRecovery();
  probe.respond(200, { error: false, ready: false, instance: 'broken-worker' });
  await settle();
  assert.equal(runtimeReads, 1);
  assert.equal(sockets.length, 1);
  const retry = [...timers.entries()].find(([, timer]) => timer.delay >= 2000 && timer.delay <= 3000);
  timers.delete(retry[0]);
  retry[1].callback();
  probes.at(-1).respond(200, { error: false, ready: false, instance: 'broken-worker' });
  await settle();
  assert.equal(runtimeReads, 1, 'Repeated unready probes must not repeatedly read runtime metadata');
  assert.equal(sockets.length, 1);
});

test('a stale unready health response cannot refresh runtime for a newer connection', async () => {
  const probe = enterHealthRecovery();
  store.getState().disconnect();
  store.getState().connect();
  sockets.at(-1).open();
  probe.respond(200, { error: false, ready: false, instance: 'stale-worker' });
  await settle();
  assert.equal(runtimeReads, 0);
  assert.equal(store.getState().isConnected, true);
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

test('health discovery binds a custom websocket tunnel to its own supervisor and ignores stale metadata', async () => {
  const previous = { ...config };
  Object.assign(config, {
    backendAddress: 'http://127.0.0.1:8088',
    supervisorAddress: 'http://127.0.0.1:8089',
    supervisorAddressExplicit: false,
  });
  try {
    const metadata = {
      error: false,
      ready: true,
      server: { host: '127.0.0.1', port: 8088, scheme: 'http' },
      workerControl: { available: true, address: 'http://127.0.0.1:8089' },
    };
    store.setState({ address: 'ws://127.0.0.1:18088' });
    const older = enterHealthRecovery();
    assert.equal(older.url, 'http://127.0.0.1:18088/health');
    store.getState().disconnect();
    store.setState({ address: 'ws://127.0.0.1:28088' });
    const newer = enterHealthRecovery();
    newer.respond(200, metadata);
    await settle();
    assert.equal(control.supervisorControlAddress(), 'http://127.0.0.1:28089');
    older.respond(200, metadata);
    await settle();
    assert.equal(control.supervisorControlAddress(), 'http://127.0.0.1:28089');
    assert.equal(older.signal.aborted, true);
  } finally {
    Object.assign(config, previous);
  }
});

test('default Vite websocket recovery retains the configured backend transport and its custom supervisor', async () => {
  const previous = { ...config };
  const previousNodes = nodeStore.getState();
  Object.assign(config, {
    serverAddress: 'http://127.0.0.1:5191',
    backendAddress: 'http://127.0.0.1:8088',
    supervisorAddress: 'http://127.0.0.1:8089',
    supervisorAddressExplicit: false,
  });
  nodeStore.setState({ fetchRuntimeStatus: originalRuntimeRead });
  try {
    for (const port of [8089, 43001]) {
      store.getState().disconnect();
      store.setState({ address: null });
      control.resetSupervisorControl();
      const previousSockets = sockets.length;
      const probe = enterHealthRecovery();
      assert.equal(store.getState().address, 'ws://127.0.0.1:5191');
      assert.equal(probe.url, 'http://127.0.0.1:5191/health');
      const metadata = {
        error: false,
        ready: true,
        instance: 'proxy-worker',
        server: { host: '127.0.0.1', port: 8088, scheme: 'http' },
        workerControl: { available: true, address: `http://127.0.0.1:${port}` },
      };
      probe.respond(200, metadata);
      await settle();
      const runtime = probes.at(-1);
      assert.equal(runtime.url, 'http://127.0.0.1:5191/runtime/status');
      runtime.respond(200, metadata);
      await settle();
      assert.equal(control.supervisorControlAddress(), `http://127.0.0.1:${port}`);
      assert.equal(nodeStore.getState().runtimeStatus.ready, true);
      assert.equal(sockets.length, previousSockets + 2);
    }
  } finally {
    Object.assign(config, previous);
    nodeStore.setState(previousNodes);
  }
});

test('custom websocket recovery and welcome refresh the same runtime transport and fence the older status', async () => {
  const previous = { ...config };
  const previousNodes = nodeStore.getState();
  Object.assign(config, {
    serverAddress: 'http://127.0.0.1:5191',
    backendAddress: 'http://127.0.0.1:8088',
    supervisorAddress: 'http://127.0.0.1:8089',
    supervisorAddressExplicit: false,
  });
  nodeStore.setState({ fetchRuntimeStatus: originalRuntimeRead, instance: 'custom-worker' });
  try {
    store.setState({ address: 'ws://127.0.0.1:18088' });
    const health = enterHealthRecovery();
    const metadata = {
      error: false,
      ready: true,
      instance: 'custom-worker',
      server: { host: '127.0.0.1', port: 8088, scheme: 'http' },
      workerControl: { available: true, address: 'http://127.0.0.1:8089' },
    };
    health.respond(200, metadata);
    await settle();
    const older = probes.find((probe) => probe.url.endsWith('/runtime/status'));
    assert.equal(older?.url, 'http://127.0.0.1:18088/runtime/status');
    assert.equal(control.supervisorControlAddress(), 'http://127.0.0.1:18089');

    const replacement = sockets.at(-1);
    replacement.open();
    replacement.onmessage({
      data: JSON.stringify({
        type: 'welcome',
        sid: store.getState().sid,
        instance: 'custom-worker',
        current: null,
        queued: {},
        recent: [],
      }),
    });
    await settle();
    const runtimeProbes = probes.filter((probe) => probe.url.endsWith('/runtime/status'));
    assert.deepEqual(
      runtimeProbes.map((probe) => probe.url),
      ['http://127.0.0.1:18088/runtime/status', 'http://127.0.0.1:18088/runtime/status'],
    );
    assert.equal(older.signal.aborted, true);
    runtimeProbes[1].respond(200, { ...metadata, packages: { transformers: { available: true } } });
    await settle();
    older.respond(200, {
      ...metadata,
      ready: false,
      packages: { transformers: { available: false } },
      workerControl: { available: true, address: 'http://127.0.0.1:43001' },
    });
    await settle();
    assert.equal(nodeStore.getState().runtimeStatus.ready, true);
    assert.equal(nodeStore.getState().runtimeStatus.packages.transformers.available, true);
    assert.equal(control.supervisorControlAddress(), 'http://127.0.0.1:18089');
    for (const probe of probes.filter((probe) => probe.url.includes('/studio_outputs')))
      probe.respond(200, { error: false, outputs: [] });
    await settle();
  } finally {
    Object.assign(config, previous);
    nodeStore.setState(previousNodes);
  }
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
