import type { Page, TestInfo } from '@playwright/test';
import fs from 'node:fs/promises';
import { expect } from '@playwright/test';

/** Opt-in, bounded observation only: never suppress or replace browser errors. */
export async function installResizeObserverDiagnostics(page: Page) {
  await page.addInitScript(() => {
    const deliveries: unknown[] = [];
    const failures: unknown[] = [];
    const observations: unknown[] = [];
    let lastAction = '';
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target.closest('button') : null;
        if (target)
          lastAction =
            target.getAttribute('aria-label') ||
            target.getAttribute('data-testid') ||
            target.textContent?.slice(0, 100) ||
            '';
      },
      true,
    );
    const observed = new Map<Element, { width: string; height: string }>();
    const nativeObserver = window.ResizeObserver;
    const diagnosticWindow = window as unknown as {
      __modiffResizeDiagnostics: { deliveries: unknown[]; failures: unknown[] };
    };
    try {
      failures.push(...JSON.parse(sessionStorage.getItem('modiff-resize-failures') ?? '[]'));
    } catch {
      /* Diagnostics must not interfere with application startup. */
    }
    diagnosticWindow.__modiffResizeDiagnostics = { deliveries, failures };
    window.ResizeObserver = class extends nativeObserver {
      observe(target: Element, options?: ResizeObserverOptions) {
        observations.push({
          time: performance.now(),
          nodeId: target.closest('[data-id]')?.getAttribute('data-id'),
          target: target.getAttribute('data-testid') || target.className,
          origin: new Error('observe').stack,
        });
        if (observations.length > 30) observations.shift();
        super.observe(target, options);
      }
      unobserve(target: Element) {
        observed.delete(target);
        super.unobserve(target);
      }
      constructor(callback: ResizeObserverCallback) {
        const origin = new Error('ResizeObserver created').stack;
        super((entries, observer) => {
          const dimensions = () =>
            entries.map(({ target }) => {
              const style = getComputedStyle(target);
              return {
                id: target.getAttribute('data-id'),
                width: style.width,
                height: style.height,
                display: style.display,
                children: [...target.children].map((child) => {
                  const cs = getComputedStyle(child);
                  return { name: child.className, width: cs.width, height: cs.height };
                }),
              };
            });
          const before = dimensions();
          for (const { target } of entries) {
            const s = getComputedStyle(target);
            observed.set(target, { width: s.width, height: s.height });
          }
          deliveries.push({
            time: performance.now(),
            origin,
            targets: entries.map(({ target, contentRect }) => ({
              tag: target.tagName,
              testId: target.getAttribute('data-testid'),
              nodeId: target.closest('[data-id]')?.getAttribute('data-id'),
              className: target.getAttribute('class'),
              width: contentRect.width,
              height: contentRect.height,
            })),
          });
          if (deliveries.length > 30) deliveries.shift();
          callback(entries, observer);
          const after = dimensions();
          if (JSON.stringify(before) !== JSON.stringify(after))
            deliveries.push({ time: performance.now(), changedDuringCallback: true, origin, before, after });
        });
      }
    };
    window.addEventListener('error', (event) => {
      if (!event.message.includes('ResizeObserver') || failures.length >= 10) return;
      const changed = [...observed]
        .filter(([target]) => target.isConnected)
        .flatMap(([target, before]) => {
          const s = getComputedStyle(target);
          const after = { width: s.width, height: s.height };
          return JSON.stringify(before) === JSON.stringify(after)
            ? []
            : [
                {
                  nodeId: target.closest('[data-id]')?.getAttribute('data-id'),
                  testId: target.getAttribute('data-testid'),
                  className: target.getAttribute('class'),
                  before,
                  after,
                },
              ];
        });
      failures.push({
        message: event.message,
        time: performance.now(),
        lastAction,
        observations: [...observations],
        deliveries: [...deliveries],
        changed,
      });
      try {
        sessionStorage.setItem('modiff-resize-failures', JSON.stringify(failures));
      } catch {
        /* Best effort. */
      }
    });
  });
}

export async function attachResizeObserverDiagnostics(page: Page, testInfo: TestInfo) {
  if (page.isClosed()) return;
  const trace = await page.evaluate(
    () => (window as unknown as { __modiffResizeDiagnostics?: unknown }).__modiffResizeDiagnostics,
  );
  if (trace) {
    const outputPath = testInfo.outputPath('resize-observer-diagnostics.json');
    await fs.mkdir(testInfo.outputDir, { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(trace, null, 2));
    await testInfo.attach('resize-observer-diagnostics', {
      path: outputPath,
      contentType: 'application/json',
    });
    if (process.env.MODIFF_ASSERT_NO_RESIZE_ERRORS === '1')
      expect(
        (trace as { failures: unknown[] }).failures,
        'ResizeObserver errors must not be hidden by passing gestures',
      ).toEqual([]);
  }
}
