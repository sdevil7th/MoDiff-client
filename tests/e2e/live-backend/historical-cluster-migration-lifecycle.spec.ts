import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

type FixtureMetadata = {
  schemaVersion: 1;
  kind: 'isolated_historical_cluster_migration_fixture';
  sourcePath: string;
  workflowId: string;
  instanceId: string;
  mappingId: string;
  mappingHash: string;
  originalSha256: string;
  originalByteLength: number;
};

type SavedWorkflow = {
  id: string;
  snapshot: {
    nodes: Array<{
      id: string;
      type: string;
      data: Record<string, unknown>;
    }>;
    edges: unknown[];
  };
};

const dataDir = process.env.MODIFF_ISOLATED_MIGRATION_DATA_DIR;
const metadataPath = process.env.MODIFF_ISOLATED_MIGRATION_METADATA;

function sha256(bytes: Buffer) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function resolveFixtureFile(root: string, sourcePath: string) {
  if (!/^user-workflows\/[A-Za-z0-9_-]+\.json$/u.test(sourcePath))
    throw new Error(`Unsafe isolated migration source path: ${sourcePath}`);
  const target = path.resolve(root, ...sourcePath.split('/'));
  const relative = path.relative(path.resolve(root), target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error(`Isolated migration source escapes its data directory: ${sourcePath}`);
  return target;
}

async function fixtureMetadata() {
  if (!dataDir || !metadataPath)
    throw new Error(
      'Run this spec through `npm run e2e:migration:isolated`; its disposable backend metadata is missing.',
    );
  const parsed = JSON.parse(await readFile(metadataPath, 'utf8')) as Partial<FixtureMetadata>;
  if (
    parsed.schemaVersion !== 1 ||
    parsed.kind !== 'isolated_historical_cluster_migration_fixture' ||
    typeof parsed.sourcePath !== 'string' ||
    typeof parsed.workflowId !== 'string' ||
    typeof parsed.instanceId !== 'string' ||
    typeof parsed.mappingId !== 'string' ||
    typeof parsed.mappingHash !== 'string' ||
    typeof parsed.originalSha256 !== 'string' ||
    typeof parsed.originalByteLength !== 'number'
  )
    throw new Error('The disposable backend fixture metadata is malformed.');
  return parsed as FixtureMetadata;
}

async function waitForWorkspaceStartup(page: Page, timeout = 180_000) {
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

async function dismissTaskLauncher(page: Page) {
  const launcher = page.getByTestId('task-launcher');
  if (!(await launcher.isVisible().catch(() => false))) return;
  await launcher.getByRole('button', { name: 'Close' }).click();
  await expect(launcher).toHaveCount(0);
}

async function openMigrationCard(page: Page) {
  await page.evaluate(() => window.__MODIFF_E2E__!.openWorkspacePanelForTest('setup'));
  await dismissTaskLauncher(page);
  const diagnostics = page.getByText('Advanced diagnostics', { exact: true });
  await diagnostics.click();
  const card = page.getByTestId('composite-migration-card');
  await expect(card).toBeVisible({ timeout: 60_000 });
  return card;
}

async function savedWorkflow(page: Page, workflowId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/workflows/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`Saved workflow returned HTTP ${response.status}.`);
    return (await response.json()) as SavedWorkflow;
  }, workflowId);
}

async function exactChangeTarget(previewDetails: Locator) {
  const section = previewDetails.locator('section').filter({ hasText: 'Exact files that would change' });
  await expect(section).toBeVisible();
  return section.locator('li');
}

test('isolated reviewed historical Cluster previews, applies, survives refresh, and rolls back exact bytes', async ({
  page,
}) => {
  test.setTimeout(8 * 60 * 1000);
  const metadata = await fixtureMetadata();
  const fixtureFile = resolveFixtureFile(dataDir!, metadata.sourcePath);
  const originalBytes = await readFile(fixtureFile);
  expect(originalBytes.byteLength).toBe(metadata.originalByteLength);
  expect(sha256(originalBytes)).toBe(metadata.originalSha256);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await dismissTaskLauncher(page);

  let card = await openMigrationCard(page);
  await card.getByTestId('composite-migration-preview-disclosure').getByRole('button').first().click();
  let previewDetails = card.getByTestId('composite-migration-preview-details');
  await expect(previewDetails).toContainText('0 target files', { timeout: 60_000 });
  await expect(previewDetails).toContainText('0 convertible');
  await expect(previewDetails).toContainText('1 blocked');
  await expect(previewDetails).toContainText(metadata.sourcePath);
  await expect(card.getByTestId('composite-migration-archived-compiler-mappings')).toContainText(metadata.mappingId);
  expect(await readFile(fixtureFile)).toEqual(originalBytes);

  await card.getByTestId('composite-migration-compiler-disclosure').getByRole('button').first().click();
  await card.getByTestId('composite-migration-compiler-generate').click();
  const compilerJson = card.getByTestId('composite-migration-compiler-json');
  await expect(compilerJson).toHaveValue(new RegExp(metadata.instanceId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), {
    timeout: 120_000,
  });
  await expect(compilerJson).toHaveValue(/"historicalCompilerMapping"/u);
  previewDetails = card.getByTestId('composite-migration-preview-details');
  await expect(previewDetails).toContainText('1 target files', { timeout: 120_000 });
  await expect(previewDetails).toContainText('1 convertible');
  await expect(previewDetails).toContainText('1 registered Clusters compiled');
  await expect(previewDetails).toContainText('0 blocked');
  const targetRows = await exactChangeTarget(previewDetails);
  await expect(targetRows).toHaveCount(1);
  await expect(targetRows.first()).toHaveText(metadata.sourcePath);
  expect(await readFile(fixtureFile)).toEqual(originalBytes);

  await card.getByTestId('composite-migration-review').click();
  const applyDialog = page.getByTestId('composite-migration-review-dialog');
  await expect(applyDialog).toBeVisible();
  await expect(applyDialog.getByTestId('composite-migration-allow-blocked')).toHaveCount(0);
  await applyDialog.getByTestId('composite-migration-apply-confirmation').fill('APPLY_BLOCK_V2_MIGRATION');
  await applyDialog.getByTestId('composite-migration-apply').click();
  await expect(applyDialog).toHaveCount(0, { timeout: 120_000 });

  await expect
    .poll(async () => sha256(await readFile(fixtureFile)), { timeout: 30_000 })
    .not.toBe(metadata.originalSha256);
  const appliedBytes = await readFile(fixtureFile);
  const appliedRecord = JSON.parse(appliedBytes.toString('utf8')) as SavedWorkflow;
  expect(appliedRecord.snapshot.nodes).toHaveLength(1);
  expect(appliedRecord.snapshot.nodes[0]).toMatchObject({ id: metadata.instanceId, type: 'block' });
  expect(appliedRecord.snapshot.nodes[0]!.data.blockInstanceV2).toBeTruthy();
  expect(appliedRecord.snapshot.nodes[0]!.data.huggingFaceClusterInstance).toBeUndefined();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await dismissTaskLauncher(page);
  const refreshedApplied = await savedWorkflow(page, metadata.workflowId);
  expect(refreshedApplied.snapshot.nodes[0]).toMatchObject({ id: metadata.instanceId, type: 'block' });
  expect(refreshedApplied.snapshot.nodes[0]!.data.blockInstanceV2).toBeTruthy();

  card = await openMigrationCard(page);
  const recovery = card.getByTestId('composite-migration-recovery-disclosure');
  await expect(recovery).toContainText('Recovery journals (1)', { timeout: 60_000 });
  await recovery.getByRole('button').first().click();
  const recoveryList = card.getByTestId('composite-migration-recovery-list');
  await expect(recoveryList).toContainText('applied');
  await expect(recoveryList).toContainText(metadata.sourcePath);
  const inspect = recoveryList.locator('[data-testid^="composite-migration-inspect-"]');
  await expect(inspect).toHaveCount(1);
  await inspect.click();
  const rollbackDialog = page.getByTestId('composite-migration-rollback-dialog');
  await expect(rollbackDialog).toBeVisible();
  await expect(rollbackDialog).toContainText(metadata.sourcePath);
  await rollbackDialog.getByTestId('composite-migration-rollback-confirmation').fill('ROLLBACK_BLOCK_V2_MIGRATION');
  await rollbackDialog.getByTestId('composite-migration-rollback').click();
  await expect(rollbackDialog).toHaveCount(0, { timeout: 120_000 });

  await expect.poll(async () => sha256(await readFile(fixtureFile)), { timeout: 30_000 }).toBe(metadata.originalSha256);
  expect(await readFile(fixtureFile)).toEqual(originalBytes);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await waitForWorkspaceStartup(page);
  await dismissTaskLauncher(page);
  const refreshedRolledBack = await savedWorkflow(page, metadata.workflowId);
  expect(refreshedRolledBack.snapshot.nodes).toHaveLength(1);
  expect(refreshedRolledBack.snapshot.nodes[0]).toMatchObject({ id: metadata.instanceId, type: 'cluster' });
  expect(refreshedRolledBack.snapshot.nodes[0]!.data.huggingFaceClusterInstance).toBeTruthy();
  expect(refreshedRolledBack.snapshot.nodes[0]!.data.blockInstanceV2).toBeUndefined();

  const journals = await page.evaluate(async () => {
    const response = await fetch('/studio/composite-migrations');
    if (!response.ok) throw new Error(`Migration list returned HTTP ${response.status}.`);
    return (await response.json()) as {
      migrations: Array<{
        effectiveState: string;
        targets: Array<{ sourcePath: string; state: string; currentSha256: string }>;
      }>;
    };
  });
  expect(journals.migrations).toHaveLength(1);
  expect(journals.migrations[0]).toMatchObject({
    effectiveState: 'rolled_back',
    targets: [{ sourcePath: metadata.sourcePath, state: 'source', currentSha256: metadata.originalSha256 }],
  });
  expect(await readFile(fixtureFile)).toEqual(originalBytes);
});
