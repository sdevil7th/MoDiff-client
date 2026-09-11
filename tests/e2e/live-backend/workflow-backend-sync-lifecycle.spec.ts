import { expect, test, type Page } from '@playwright/test';

async function waitForWorkspace(page: Page) {
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
}

async function restartWorkflowHydration(page: Page) {
  await page.evaluate(async () => {
    const { useStudioStore } = await import('/src/stores/useStudioStore.ts');
    useStudioStore.setState({ workflowCanvasHydrated: false });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    useStudioStore.setState({ workflowCanvasHydrated: true });
  });
}

test('document teardown cancels workflow hydration without reporting a backend outage or retrying', async ({
  page,
}) => {
  const syncWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Backend workflow sync is unavailable.')) {
      syncWarnings.push(message.text());
    }
  });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);

  let releaseRequest: (() => void) | undefined;
  const requestReleased = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  let interceptedRequests = 0;
  let resolveIntercepted: (() => void) | undefined;
  const intercepted = new Promise<void>((resolve) => {
    resolveIntercepted = resolve;
  });
  await page.route('**/workflows/*', async (route) => {
    if (route.request().method() !== 'GET' || interceptedRequests > 0) {
      await route.fallback();
      return;
    }
    interceptedRequests += 1;
    resolveIntercepted?.();
    await requestReleased;
    await route.abort('aborted').catch(() => undefined);
  });

  await restartWorkflowHydration(page);
  await intercepted;
  const navigated = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
  const reload = page.reload({ waitUntil: 'domcontentloaded' });
  await navigated;
  releaseRequest?.();
  await reload;
  await waitForWorkspace(page);
  await page.waitForTimeout(2_500);

  expect(syncWarnings).toEqual([]);
  expect(interceptedRequests).toBe(1);
});

test('an active workflow hydration network failure remains visible and retries', async ({ page }) => {
  const syncWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Backend workflow sync is unavailable.')) {
      syncWarnings.push(message.text());
    }
  });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);

  let workflowGets = 0;
  await page.route('**/workflows/*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    workflowGets += 1;
    if (workflowGets === 1) {
      await route.abort('failed');
      return;
    }
    await route.fallback();
  });
  await restartWorkflowHydration(page);

  await expect.poll(() => syncWarnings.length, { timeout: 30_000 }).toBe(1);
  await expect.poll(() => workflowGets, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
});
