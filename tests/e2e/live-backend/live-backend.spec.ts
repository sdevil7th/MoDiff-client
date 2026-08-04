import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __MODIFF_E2E__?: {
      getState: () => {
        flow: {
          nodes: Array<{ id: string; action: string }>;
          edges: Array<{ source: string; sourceHandle?: string; target: string; targetHandle?: string }>;
          historyPast: number;
        };
        websocket: { sid?: string | null; isConnected: boolean };
      };
      setGraphScenarioForTest: (scenario: 'disconnected_image_output') => void;
    };
  }
}

test('live backend Graph Fix clears the exact issue and enables Run', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => window.__MODIFF_E2E__!.getState().websocket.isConnected), {
      timeout: 30_000,
    })
    .toBe(true);

  await page.evaluate(() => window.__MODIFF_E2E__!.setGraphScenarioForTest('disconnected_image_output'));
  const before = await page.evaluate(() => window.__MODIFF_E2E__!.getState().flow);
  expect(before.nodes.map((node) => node.id).sort()).toEqual(['scenario-image-load', 'scenario-preview']);

  await expect(page.getByTestId('studio-run')).toBeDisabled();
  await page.getByTestId('graph-fix').click();
  const dialog = page.getByTestId('graph-fix-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/Connect Load Image|Connect.*image/i);
  await dialog.getByTestId('graph-fix-apply').click();
  await expect(dialog).toHaveCount(0);

  const after = await page.evaluate(() => window.__MODIFF_E2E__!.getState().flow);
  expect(after.nodes).toHaveLength(before.nodes.length);
  expect(after.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: 'scenario-image-load',
        sourceHandle: 'image',
        target: 'scenario-preview',
        targetHandle: 'image',
      }),
    ]),
  );
  expect(after.historyPast).toBe(before.historyPast + 1);
  await expect(page.getByRole('status').filter({ hasText: 'Fix applied and verified' })).toBeVisible();
  await expect(page.getByTestId('studio-run')).toBeEnabled();
});
