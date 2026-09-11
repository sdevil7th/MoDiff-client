import { expect, test } from '@playwright/test';

test('editable model selection preserves typed repositories on Tab and still permits explicit alternatives', async ({
  page,
}) => {
  await page.goto('/control-state-matrix.html');
  await page.evaluate(async () => {
    await import('/tests/e2e/shared-controls/freeFormModelFixture.tsx');
  });
  const input = page.getByLabel('Editable repository');
  const saved = page.getByTestId('selected-repository');
  for (const repository of ['InstantX/Union', 'custom/not-installed']) {
    await input.fill(repository);
    await input.press('Tab');
    await expect(input).toHaveValue(repository);
    await expect(saved).toHaveText(repository);
  }
  await input.locator('..').getByRole('button', { name: 'Show options' }).click();
  await page.getByRole('option', { name: 'InstantX/Canny', exact: true }).click();
  await expect(input).toHaveValue('InstantX/Canny');
  await expect(saved).toHaveText('InstantX/Canny');
  await input.fill('InstantX/Union');
  await page.getByRole('button', { name: 'After repository', exact: true }).click();
  await expect(saved).toHaveText('InstantX/Union');
});
