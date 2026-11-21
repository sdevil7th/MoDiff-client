// Render the original vector card illustration; this never runs an image model.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1 });
  await page.goto(new URL('../public/assets/minimax-h3-old-town.card-poster.svg', import.meta.url).href);
  await page.screenshot({
    path: fileURLToPath(new URL('../public/assets/minimax-h3-old-town.card-poster.png', import.meta.url)),
  });
} finally {
  await browser.close();
}
