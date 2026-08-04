import { expect, test } from '@playwright/test';

const frontendPort = Number(process.env.MODIFF_MOCK_FRONTEND_PORT || 5191);

test('shared controls expose consistent states and keyboard behavior', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${frontendPort}/control-state-matrix.html`);

  await expect(page.getByRole('heading', { name: 'Shared control state matrix' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'compact controls' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'normal controls' })).toBeVisible();
  await page.getByRole('button', { name: 'compact settings' }).hover();
  await expect(page.getByRole('tooltip')).toHaveText('compact settings');

  await expect(page.getByTestId('button-loading')).toBeDisabled();
  await expect(page.getByTestId('button-loading')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByTestId('button-disabled')).toBeDisabled();
  const defaultButton = page.getByTestId('button-default');
  const restBackground = await defaultButton.evaluate((element) => getComputedStyle(element).backgroundColor);
  const defaultButtonBox = await defaultButton.boundingBox();
  expect(defaultButtonBox).not.toBeNull();
  await page.mouse.move(defaultButtonBox!.x + defaultButtonBox!.width / 2, defaultButtonBox!.y + 4);
  await page.mouse.down();
  await expect
    .poll(() => defaultButton.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(restBackground);
  await page.mouse.up();
  await expect(page.getByLabel('Read-only field')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Disabled field')).toBeDisabled();
  await expect(page.getByLabel('Invalid field')).toHaveAttribute('aria-invalid', 'true');
  const readOnlyDescriptionId = await page.getByLabel('Read-only field').getAttribute('aria-describedby');
  expect(readOnlyDescriptionId).toBeTruthy();
  await expect(page.locator(`[id="${readOnlyDescriptionId}"]`)).toHaveText('Managed by the workflow');
  const invalidErrorId = await page.getByLabel('Invalid field').getAttribute('aria-errormessage');
  expect(invalidErrorId).toBeTruthy();
  await expect(page.locator(`[id="${invalidErrorId}"]`)).toHaveText('Enter a valid value');
  await expect(page.getByLabel('Textarea')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Password field')).toHaveAttribute('type', 'password');
  await expect(page.getByText('18 / 120', { exact: true })).toBeVisible();

  const search = page.getByLabel('Search matrix');
  await expect(search).toHaveValue('preview');
  await page.getByRole('button', { name: 'Clear search' }).first().click();
  await expect(search).toHaveValue('');
  await expect(page.getByLabel('Disabled search')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Clear search' }).last()).toBeDisabled();

  const number = page.getByLabel('Number');
  await number.fill('12');
  await expect(number).toHaveValue('10');
  await number.fill('7.6');
  await expect(number).toHaveValue('8');

  await page.getByTestId('matrix-select').click();
  const portalledListbox = page.getByRole('listbox');
  await expect(portalledListbox).toBeVisible();
  expect(
    await portalledListbox.evaluate(
      (element) => !document.querySelector('[data-testid="control-state-matrix"]')?.contains(element),
    ),
  ).toBe(true);
  const listboxTheme = await portalledListbox.evaluate((element) => {
    const styles = getComputedStyle(element);
    const rootStyles = getComputedStyle(document.documentElement);
    return {
      backgroundColor: styles.backgroundColor,
      borderColor: styles.borderTopColor,
      fontFamily: styles.fontFamily,
      semanticBackground: rootStyles.getPropertyValue('--color-modiff-surface').trim(),
      semanticBorder: rootStyles.getPropertyValue('--color-modiff-border-subtle').trim(),
      zIndex: styles.zIndex,
    };
  });
  expect(listboxTheme).toMatchObject({
    backgroundColor: 'rgb(16, 22, 35)',
    borderColor: 'rgb(51, 65, 85)',
    semanticBackground: '#101623',
    semanticBorder: '#334155',
    zIndex: '100',
  });
  expect(listboxTheme.fontFamily).toContain('Source Sans Pro');
  const recommendedOption = page.getByRole('option', { name: 'Recommended' });
  await page.keyboard.press('Home');
  await expect(recommendedOption).toHaveAttribute('data-focus');
  await expect
    .poll(() =>
      recommendedOption.evaluate((element) => {
        const styles = getComputedStyle(element);
        const rootStyles = getComputedStyle(document.documentElement);
        return {
          backgroundColor: styles.backgroundColor,
          color: styles.color,
          semanticBackground: rootStyles.getPropertyValue('--color-modiff-selected-surface').trim(),
          semanticText: rootStyles.getPropertyValue('--color-hf-yellow').trim(),
        };
      }),
    )
    .toEqual({
      backgroundColor: 'rgb(43, 42, 22)',
      color: 'rgb(255, 210, 30)',
      semanticBackground: '#2b2a16',
      semanticText: '#ffd21e',
    });
  await expect(page.getByRole('group', { name: 'General' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Technical' })).toBeVisible();
  await page.getByRole('option', { name: 'Model' }).click();
  await expect(page.getByTestId('matrix-select')).toContainText('Model');
  await page.getByTestId('matrix-select').click();
  await expect(page.getByRole('option', { name: 'Runtime' })).toHaveAttribute('data-disabled');
  await page.keyboard.press('Escape');
  await page.getByTestId('matrix-multi-select').click();
  await page.getByRole('option', { name: 'Video' }).click();
  await expect(page.getByTestId('matrix-multi-select')).toContainText('Image, Video');
  await page.keyboard.press('Escape');
  const readOnlySelect = page.getByLabel('Read-only sort');
  await expect(readOnlySelect).toHaveAttribute('aria-readonly', 'true');
  await readOnlySelect.click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit form' }).click();
  await expect(page.getByTestId('select-form-result')).toHaveText('model');

  await page.getByRole('checkbox', { name: 'Checkbox', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Checkbox', exact: true })).toBeChecked();
  await expect(page.getByTestId('checkbox-indeterminate')).toHaveAttribute('aria-checked', 'mixed');
  await expect(page.getByRole('checkbox', { name: 'Invalid read-only checkbox' })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByRole('checkbox', { name: 'Invalid read-only checkbox' })).toHaveAttribute(
    'aria-readonly',
    'true',
  );
  await page.getByRole('switch', { name: 'Switch', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Switch', exact: true })).toBeChecked();
  const readOnlySwitch = page.getByRole('switch', { name: 'Read-only switch' });
  await expect(readOnlySwitch).toBeChecked();
  await readOnlySwitch.click();
  await expect(readOnlySwitch).toBeChecked();
  await page.getByRole('radio', { name: 'Quality' }).click();
  await expect(page.getByRole('radio', { name: 'Quality' })).toBeChecked();
  await expect(page.getByRole('radiogroup', { name: 'Performance profile' })).toHaveAttribute('aria-invalid', 'true');

  const slider = page.getByRole('slider', { name: 'Matrix slider' });
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('6');
  const readOnlySlider = page.getByRole('slider', { name: 'Read-only slider' });
  await expect(readOnlySlider).toHaveAttribute('aria-readonly', 'true');
  await expect(readOnlySlider).toHaveAttribute('aria-invalid', 'true');
  await readOnlySlider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(readOnlySlider).toHaveValue('4');
  await expect(page.getByRole('slider', { name: 'Lower Matrix range' })).toHaveAttribute('aria-invalid', 'true');

  const chip = page.getByRole('button', { name: 'Interactive chip' });
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  const appearanceTab = page.getByRole('tab', { name: 'Appearance' });
  await appearanceTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Behavior' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Behavior' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Behavior' })).toBeVisible();
  await page.keyboard.press('Home');
  await expect(appearanceTab).toBeFocused();

  const disclosure = page.getByRole('button', { name: 'Disclosure' });
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Keyboard-operable disclosure content.')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Matrix progress' })).toHaveAttribute('aria-valuenow', '64');

  const upload = page.getByRole('button', { name: 'Activate upload' });
  await upload.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('drop-result')).toHaveText('Upload activations: 1');
  const imageAction = page.getByRole('button', { name: 'Open matrix image' });
  await imageAction.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('image-result')).toHaveText('Image activations: 1');
  const comparison = page.getByRole('slider', { name: 'Matrix comparison' });
  await comparison.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(comparison).toHaveAttribute('aria-valuenow', '60');

  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByText('Duplicate selected')).toBeVisible();

  const popoverTrigger = page.getByTestId('open-matrix-popover');
  await popoverTrigger.click();
  const popover = page.getByTestId('matrix-popover');
  await expect(popover).toBeVisible();
  expect(await popover.evaluate((element) => element.parentElement === document.body)).toBe(true);
  await expect(popover).toHaveCSS('font-family', /Source Sans Pro/);
  const popoverBox = await popover.boundingBox();
  const viewport = page.viewportSize();
  expect(popoverBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(popoverBox!.x).toBeGreaterThanOrEqual(0);
  expect(popoverBox!.y).toBeGreaterThanOrEqual(0);
  expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(viewport!.height);
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(popoverTrigger).toBeFocused();

  const dialogTrigger = page.getByTestId('open-matrix-dialog');
  await dialogTrigger.focus();
  await dialogTrigger.click();
  await expect(page.getByTestId('matrix-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('matrix-dialog')).toBeHidden();
  await expect(dialogTrigger).toBeFocused();
  await expect(dialogTrigger).toHaveClass(/focus-visible:outline/);

  await page.getByRole('button', { name: 'Show status' }).click();
  const status = page.getByRole('status').filter({ hasText: 'Status notification' });
  await expect(status).toContainText('Status notification');
  await expect(status).toHaveCSS('opacity', '1');
  await expect(status).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(status.getByRole('button', { name: 'Dismiss notification' })).toBeVisible();
  await status.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(status).toHaveCount(0);

  await page.getByRole('button', { name: 'Show error' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Error notification' });
  await expect(alert).toContainText('Error notification');
  await expect(alert).toHaveCSS('opacity', '1');
  await expect(alert).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(alert.getByRole('button', { name: 'Dismiss notification' })).toBeVisible();
});

test('compact and normal shared controls match the visual contract', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${frontendPort}/control-state-matrix.html`);
  const matrix = page.getByTestId('control-state-matrix');
  await expect(matrix).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  await expect(page.getByTestId('size-compact')).toHaveScreenshot('shared-controls-compact.png', {
    animations: 'disabled',
  });
  await expect(page.getByTestId('size-normal')).toHaveScreenshot('shared-controls-normal.png', {
    animations: 'disabled',
  });
  await expect(matrix).toHaveScreenshot('shared-controls-all-states.png', {
    animations: 'disabled',
  });

  await page.getByTestId('matrix-select').click();
  const listbox = page.getByRole('listbox');
  const recommendedOption = page.getByRole('option', { name: 'Recommended' });
  await page.keyboard.press('Home');
  await expect(recommendedOption).toHaveAttribute('data-focus');
  await expect
    .poll(() => recommendedOption.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe('rgb(43, 42, 22)');
  await expect(listbox).toHaveScreenshot('shared-select-open.png', {
    animations: 'disabled',
  });
});
