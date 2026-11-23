import { expect, type Locator, type Page } from '@playwright/test';

export async function dragWireToCanvas(page: Page, handle: Locator) {
  await handle.click({ trial: true });
  // Insertion can start an animated fit after the card has mounted.
  // Wait for its socket to stop moving before starting a gesture in screen coordinates.
  await handle.evaluate(async (element) => {
    let last = element.getBoundingClientRect();
    let stableSince = performance.now();
    while (performance.now() - stableSince < 275) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const next = element.getBoundingClientRect();
      if (Math.abs(next.x - last.x) + Math.abs(next.y - last.y) > 0.1) stableSince = performance.now();
      last = next;
    }
  });
  await handle.hover();
  const start = await handle.boundingBox();
  if (!start) throw new Error('The connection handle is outside the visible canvas.');
  const x = start.x + start.width / 2,
    y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 18, y + 5, { steps: 4 });
  await expect(page.locator('.react-flow__connection')).toBeVisible();
  const pane = page.locator('.react-flow__pane');
  const destination = await pane.evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    for (const y of [0.25, 0.75, 0.5, 0.15, 0.85]) {
      for (const x of [0.8, 0.2, 0.65, 0.35, 0.5]) {
        const point = { x: bounds.left + bounds.width * x, y: bounds.top + bounds.height * y };
        if (document.elementFromPoint(point.x, point.y) === el) return point;
      }
    }
    return null;
  });
  expect(destination, 'Workflow canvas has a visible area to drop a wire').toBeTruthy();
  await page.mouse.move(destination!.x, destination!.y, { steps: 18 });
  await page.mouse.up();
}
