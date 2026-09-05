import { expect, test, type Page } from '@playwright/test';

async function waitForWorkspaceStartup(page: Page, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  const gate = page.getByTestId('startup-workspace-gate');
  while (Date.now() < deadline) {
    if ((await gate.count()) === 0) return;
    const retry = gate.getByRole('button', { name: 'Retry' });
    if (await retry.isVisible({ timeout: 250 }).catch(() => false)) await retry.click();
    await page.waitForTimeout(500);
  }
  throw new Error(`Workspace startup did not finish within ${timeout}ms.`);
}

test('live backend historical Cluster recovery evidence is visible and remains read-only', async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  const recoveryRequests: Array<{ method: string; path: string }> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/studio/composite-migrations')) {
      recoveryRequests.push({ method: request.method(), path: url.pathname });
    }
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);

  const launcher = page.getByTestId('task-launcher');
  if (await launcher.isVisible().catch(() => false)) {
    await launcher.getByRole('button', { name: 'Close' }).click();
    await expect(launcher).toHaveCount(0);
  }
  await page.evaluate(() => window.__MODIFF_E2E__!.openWorkspacePanelForTest('setup'));
  await page.getByText('Advanced diagnostics', { exact: true }).click();
  const card = page.getByTestId('composite-migration-card');
  await expect(card).toBeVisible({ timeout: 30_000 });

  const disclosure = card.getByTestId('legacy-cluster-recovery-evidence-disclosure');
  await disclosure.getByRole('button').first().click();
  const panel = card.getByTestId('legacy-cluster-recovery-evidence-panel');
  await expect(panel).toBeVisible();
  const summary = panel.getByTestId('legacy-cluster-recovery-evidence-summary');
  await expect(summary).toContainText('375 saved Clusters', { timeout: 60_000 });
  await expect(summary).toContainText('15 mapping-ready instances');
  await expect(summary).toContainText('3 mapping-ready identities');
  await expect(summary).toContainText('339 historical still blocked');
  await expect(summary).toContainText('97 blocked identities');
  await expect(summary).toContainText('18 recovered bodies');
  await expect(summary).toContainText('20 identities');
  await expect(summary).toContainText('21 execution tuples');
  await expect(summary).toContainText('65 covered instances');
  await expect(panel).toContainText('does not compile, convert, execute, approve, or mutate a Cluster by itself');

  const backendAudit = await page.evaluate(async () => {
    const response = await fetch('/studio/composite-migrations/recovery-audit');
    if (!response.ok) throw new Error(`Recovery audit returned HTTP ${response.status}.`);
    const payload = (await response.json()) as {
      error: boolean;
      audit: {
        schemaVersion: number;
        contentHash: string;
        boundary: Record<string, boolean>;
        summary: Record<string, number>;
      };
    };
    if (payload.error || !payload.audit) throw new Error('Recovery audit response did not include an audit.');
    return payload.audit;
  });
  expect(backendAudit.schemaVersion).toBe(4);
  expect(backendAudit.boundary).toMatchObject({
    readOnly: true,
    containsWorkflowPaths: false,
    containsInstanceIds: false,
    containsPromptOrParameterValues: false,
    recoveredStudioSpecEvidenceDoesNotAuthorizeConversion: true,
    compilerMappingPresenceAloneDoesNotAuthorizeConversion: true,
  });
  expect(backendAudit.summary).toMatchObject({
    legacyClusterInstanceCount: 375,
    currentExecutionTupleExactInstanceCount: 21,
    currentExecutionTupleExactIdentityCount: 2,
    compilerMappingEligibleInstanceCount: 15,
    compilerMappingEligibleIdentityCount: 3,
    remainingBlockedHistoricalInstanceCount: 339,
    remainingBlockedHistoricalIdentityCount: 97,
    historicalEvidenceRequiredInstanceCount: 312,
    recoveredStudioSpecBodyCount: 18,
    recoveredStudioSpecManifestIdentityCount: 20,
    recoveredStudioSpecExecutionTupleCount: 21,
    recoveredStudioSpecInstanceCount: 65,
  });
  await expect(panel).toContainText(backendAudit.contentHash);
  await expect(panel.getByRole('button', { name: /convert|compile|execute|apply/i })).toHaveCount(0);

  const beforeRefresh = recoveryRequests.filter(
    ({ method, path }) => method === 'GET' && path === '/studio/composite-migrations/recovery-audit',
  ).length;
  await panel.getByTestId('legacy-cluster-recovery-evidence-refresh').click();
  await expect
    .poll(
      () =>
        recoveryRequests.filter(
          ({ method, path }) => method === 'GET' && path === '/studio/composite-migrations/recovery-audit',
        ).length,
      { timeout: 30_000 },
    )
    .toBeGreaterThan(beforeRefresh);
  expect(recoveryRequests.filter(({ method }) => method !== 'GET')).toEqual([]);
});
