import type { Page } from '@playwright/test';

/** Decoding/contrast evidence, not an aesthetic score or a restriction on user art. */
export function decodedImageStatistics(
  page: Page,
  bytes: Buffer,
  region?: { x: number; y: number; width: number; height: number },
) {
  return page.evaluate(
    async ({ base64, region }) => {
      const blob = await (await fetch(`data:image/webp;base64,${base64}`)).blob();
      const bitmap = await createImageBitmap(blob);
      try {
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        const rect = region ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
        if (
          !Object.values(rect).every(Number.isInteger) ||
          rect.x < 0 ||
          rect.y < 0 ||
          rect.width < 1 ||
          rect.height < 1 ||
          rect.x + rect.width > bitmap.width ||
          rect.y + rect.height > bitmap.height
        )
          throw new Error('The image assessment region must be inside the decoded image.');
        const pixels = context.getImageData(rect.x, rect.y, rect.width, rect.height).data;
        let sum = 0,
          squares = 0,
          minimum = 255,
          maximum = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const value = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
          sum += value;
          squares += value * value;
          minimum = Math.min(minimum, value);
          maximum = Math.max(maximum, value);
        }
        const count = rect.width * rect.height;
        return {
          width: bitmap.width,
          height: bitmap.height,
          region: rect,
          minimum,
          maximum,
          mean: sum / count,
          standardDeviation: Math.sqrt(Math.max(0, squares / count - (sum / count) ** 2)),
        };
      } finally {
        bitmap.close();
      }
    },
    { base64: bytes.toString('base64'), region },
  );
}
