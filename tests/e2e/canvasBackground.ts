import type { Page } from '@playwright/test';

export async function emptyCanvasPoint(page: Page) {
  const pane = page.locator('.react-flow__pane');
  const point = await pane.evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    for (const y of [0.25, 0.75, 0.5, 0.15, 0.85]) {
      for (const x of [0.8, 0.2, 0.65, 0.35, 0.5]) {
        const point = { x: bounds.left + bounds.width * x, y: bounds.top + bounds.height * y };
        if (document.elementFromPoint(point.x, point.y) === el) return point;
      }
    }
    return null;
  });
  if (!point) throw new Error('The workflow canvas has no exposed background for this gesture.');
  return point;
}

export async function clickCanvasBackground(page: Page) {
  const point = await emptyCanvasPoint(page);
  await page.mouse.click(point.x, point.y);
}
