import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
let server, createDispatch;
before(async () => {
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  ({ createNodeMeasurementDispatch: createDispatch } = await server.ssrLoadModule(
    '/src/workflow/nodeMeasurementDispatch.ts',
  ));
});
after(async () => {
  await server?.close();
});
function fixture() {
  const nodes = new Map([
    ['child', { id: 'child', measured: { width: 100, height: 100 } }],
    ['parent', { id: 'parent', width: 150, height: 150 }],
  ]);
  const calls = [],
    frames = new Map();
  let epoch = 1,
    frame = 0;
  const dispatcher = createDispatch({
    apply: (changes) => calls.push(changes),
    epoch: () => epoch,
    node: (id) => nodes.get(id),
    schedule: (callback) => {
      frames.set(++frame, callback);
      return frame;
    },
    cancel: (id) => frames.delete(id),
  });
  return {
    dispatcher,
    nodes,
    calls,
    frames,
    navigate: () => epoch++,
    flush: () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    },
  };
}
test('passive measurements and their parent expansion stay together outside observer delivery', () => {
  const f = fixture();
  const changes = [
    { id: 'child', type: 'dimensions', dimensions: { width: 200, height: 300 } },
    { id: 'parent', type: 'position', position: { x: -10, y: 0 } },
    { id: 'parent', type: 'dimensions', dimensions: { width: 300, height: 400 }, setAttributes: true },
  ];
  f.dispatcher.dispatch(changes);
  assert.equal(f.calls.length, 0);
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.deepEqual(f.calls, [changes]);
});
test('latest measurements coalesce; ghost and identical measurements do not mutate persisted nodes', () => {
  const f = fixture();
  f.dispatcher.dispatch([{ id: 'child', type: 'dimensions', dimensions: { width: 110, height: 120 } }]);
  f.dispatcher.dispatch([
    { id: 'child', type: 'dimensions', dimensions: { width: 130, height: 140 } },
    { id: 'ghost', type: 'dimensions', dimensions: { width: 900, height: 900 } },
  ]);
  f.flush();
  assert.deepEqual(f.calls[0], [{ id: 'child', type: 'dimensions', dimensions: { width: 130, height: 140 } }]);
  f.dispatcher.dispatch([{ id: 'child', type: 'dimensions', dimensions: { width: 100, height: 100 } }]);
  f.flush();
  assert.equal(f.calls.length, 1);
});
test('user resize and drag remain immediate and invalidate pending stale measurements', () => {
  const f = fixture();
  f.dispatcher.dispatch([{ id: 'child', type: 'dimensions', dimensions: { width: 110, height: 120 } }]);
  const resize = {
    id: 'child',
    type: 'dimensions',
    dimensions: { width: 400, height: 500 },
    resizing: true,
    setAttributes: true,
  };
  f.dispatcher.dispatch([resize]);
  assert.deepEqual(f.calls, [[resize]]);
  f.flush();
  assert.equal(f.calls.length, 1);
  const drag = { id: 'child', type: 'position', position: { x: 100, y: 200 }, dragging: true };
  f.dispatcher.dispatch([drag]);
  assert.deepEqual(f.calls[1], [drag]);
});
test('navigation, removal and unmount discard stale measurement work', () => {
  for (const action of ['navigate', 'remove', 'unmount']) {
    const f = fixture();
    f.dispatcher.dispatch([{ id: 'child', type: 'dimensions', dimensions: { width: 110, height: 120 } }]);
    if (action === 'navigate') f.navigate();
    if (action === 'remove') f.nodes.delete('child');
    if (action === 'unmount') f.dispatcher.clear();
    f.flush();
    assert.equal(f.calls.length, 0, action);
  }
});
