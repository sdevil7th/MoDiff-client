import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = '\0workflow-hydration-lifecycle-test';
let frontend;
let browser;
let origin;

before(async () => {
  frontend = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    cacheDir: path.join(ROOT, 'node_modules/.vite-workflow-hydration-lifecycle'),
    optimizeDeps: { include: ['react', 'react-dom/client'], entries: [], noDiscovery: true },
    server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
    appType: 'custom',
    plugins: [
      {
        name: 'mounted-workflow-hydration-lifecycle-test',
        enforce: 'pre',
        resolveId(id, importer) {
          if (id === '/workflow-hydration-test.js') return PROBE;
          if (!importer?.replaceAll('\\', '/').endsWith('/src/studio/useWorkflowBackendSync.ts')) return;
          if (id === '../stores/useStudioStore') return '\0hydration-test-studio';
          if (id === '../stores/useNodeStore') return '\0hydration-test-nodes';
          if (id === './templateExactness') return '\0hydration-test-signature';
        },
        load(id) {
          // Keep the actual hook, React effects and requestJson transport. These selector/merge
          // stubs isolate lifecycle ownership from the separately tested document merge rules.
          if (id === '\0hydration-test-studio')
            return `export const useStudioStore = selector => selector(window.hydrationTest.state);
              useStudioStore.getState = () => window.hydrationTest.state;
              useStudioStore.setState = () => { throw Error('Unexpected document state write'); };`;
          if (id === '\0hydration-test-nodes')
            return `export const useNodesStore = {getState: () => ({nodesRegistry:{}})};`;
          if (id === '\0hydration-test-signature') return `export {stableStringify} from '/src/studio/stableHash.ts';`;
          if (id !== PROBE) return;
          return `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { useWorkflowBackendSync } from '/src/studio/useWorkflowBackendSync.ts';
            const state = window.hydrationTest = { requests: [], warnings: [], merges: [] };
            const originalWarn = console.warn;
            console.warn = (...args) => { state.warnings.push(args.map(String)); originalWarn(...args); };
            state.tab = {id:'lifecycle-test',title:'Lifecycle test',createdAt:1,updatedAt:2,dirty:true,
              source:'manual',backendRevision:7,snapshot:{nodes:[],edges:[],
              studioForm:{prompt:'Keep local dirty prompt'},selectedMode:'text_to_image'}};
            state.state = {workflowTabs:[state.tab],workflowCanvasHydrated:true,workflowCanvasEpoch:1,
              mergeBackendWorkflow: tab => state.merges.push(tab)};
            window.fetch = (url, init = {}) => new Promise((resolve, reject) => {
              const request = {url:String(url),method:init.method || 'GET',signal:init.signal,
                fail: () => reject(new TypeError('Failed to fetch'))};
              state.requests.push(request);
              if (init.signal?.aborted) reject(init.signal.reason);
              else init.signal?.addEventListener('abort', () => reject(init.signal.reason), {once:true});
            });
            function Probe() { useWorkflowBackendSync(); return React.createElement('p',null,'mounted'); }
            const owner = createRoot(document.getElementById('root'));
            owner.render(React.createElement(Probe));
            state.unmount = () => owner.unmount();
          `;
        },
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (request.url !== '/hydration-test') return next();
            response.setHeader('Content-Type', 'text/html');
            response.end('<div id="root"></div><script type="module" src="/workflow-hydration-test.js"></script>');
          });
        },
      },
    ],
  });
  await frontend.listen();
  origin = `http://127.0.0.1:${frontend.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await frontend?.close();
});

for (const kind of [
  'nonpersisted-pagehide',
  'effect-unmount',
  'live-failure',
  'persisted-pagehide',
  'failure-before-pagehide',
  'failure-before-unmount',
]) {
  test(`mounted workflow hydration handles ${kind} without losing its dirty document`, async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    try {
      await page.goto(`${origin}/hydration-test`);
      await page.waitForFunction(() => window.hydrationTest?.requests.length === 1);
      const before = await page.evaluate(() => JSON.stringify(window.hydrationTest.tab));
      if (kind === 'nonpersisted-pagehide') {
        await page.evaluate(() => {
          window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
          window.hydrationTest.requests[0].fail();
        });
      } else if (kind === 'effect-unmount') {
        await page.evaluate(() => window.hydrationTest.unmount());
      } else if (kind === 'persisted-pagehide') {
        await page.evaluate(() => {
          window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
          window.hydrationTest.requests[0].fail();
        });
      } else {
        await page.evaluate(() => window.hydrationTest.requests[0].fail());
        if (kind === 'failure-before-pagehide' || kind === 'failure-before-unmount') {
          await page.waitForFunction(() => window.hydrationTest.warnings.length === 1);
          if (kind === 'failure-before-pagehide')
            await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
          else await page.evaluate(() => window.hydrationTest.unmount());
        }
      }
      // Observe the real two-second retry deadline, including teardown after it was scheduled.
      await page.waitForTimeout(2200);
      const observed = await page.evaluate(() => ({
        requests: window.hydrationTest.requests.length,
        warnings: window.hydrationTest.warnings,
        aborted: window.hydrationTest.requests[0].signal.aborted,
        merges: window.hydrationTest.merges,
        document: JSON.stringify(window.hydrationTest.tab),
      }));
      assert.deepEqual(errors, []);
      assert.equal(observed.document, before);
      assert.deepEqual(observed.merges, []);
      const expectsWarning = [
        'live-failure',
        'persisted-pagehide',
        'failure-before-pagehide',
        'failure-before-unmount',
      ].includes(kind);
      const expectsRetry = ['live-failure', 'persisted-pagehide'].includes(kind);
      assert.equal(observed.warnings.length, expectsWarning ? 1 : 0);
      if (expectsWarning) assert.match(observed.warnings[0][1], /RequestError: Failed to fetch/u);
      assert.equal(observed.requests, expectsRetry ? 2 : 1, 'a retired hydration must not start another request');
      // A settled failed transport has already removed its forwarded-abort listener.
      assert.equal(observed.aborted, ['nonpersisted-pagehide', 'effect-unmount'].includes(kind));
    } finally {
      await page.close();
    }
  });
}
