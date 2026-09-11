// Reproducible code-authored editorial artwork, never generation evidence.
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const root = new URL('../', import.meta.url);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
  await page.setContent(
    `<style>html,body{margin:0}svg{display:block}</style>${await readFile(new URL('src/assets/minimax-chamber-pop.poster.svg', root), 'utf8')}`,
  );
  await page.screenshot({ path: new URL('public/assets/minimax-chamber-pop.card-poster.png', root).pathname });
} finally {
  await browser.close();
}
