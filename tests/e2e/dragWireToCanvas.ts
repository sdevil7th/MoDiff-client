import { expect, type Locator, type Page } from '@playwright/test';
import { emptyCanvasPoint } from './canvasBackground';

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
  const destination = await emptyCanvasPoint(page);
  await page.mouse.move(destination.x, destination.y, { steps: 18 });
  await page.mouse.up();
}
