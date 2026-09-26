import { expect, test } from '@playwright/test';

// Uses only rendered UI, including in an emitted production bundle.
for (const [task, label] of [
  ['image_to_image', 'Load Image'],
  ['audio_variation', 'Load Audio'],
]) {
  test(`fresh ${task} blocks an empty source in Auto and Custom memory modes`, async ({ page }) => {
    test.skip(process.env.MODIFF_NODE_UX_ISOLATED !== '1', 'Requires isolated backend state');
    await page.setViewportSize({ width: 1920, height: 1200 });
    await page.goto('/');
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
    const launcher = page.getByTestId('task-launcher');
    if (task!.startsWith('audio')) await launcher.getByRole('button', { name: 'Audio', exact: true }).click();
    await launcher.getByTestId(`workflow-task-${task}`).click();
    const loader = page.locator('.react-flow__node').filter({ has: page.locator('header', { hasText: label! }) });
    await expect(loader.locator('input[type=file]')).toHaveCount(1, { timeout: 45_000 });
    const policy = page.getByTestId('topbar-resource-policy');
    if ((await policy.getAttribute('aria-pressed')) !== 'true') await policy.click();
    await expect(page.getByTestId('studio-run')).toBeDisabled();
    await expect(page.getByText(`${label} needs a file before running.`, { exact: true }).first()).toBeVisible();
    await policy.click();
    await expect(policy).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('studio-run')).toBeDisabled();
    await page.reload();
    await expect(loader).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('studio-run')).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath(`${task}-custom-readiness.png`) });
  });
}
