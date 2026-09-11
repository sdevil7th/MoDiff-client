import type { Page, TestInfo } from '@playwright/test';
import fs from 'node:fs/promises';

/** Read-only opt-in trace: keep native warnings and avoid recording field values. */
export async function installLegacyHandleDiagnostics(page: Page) {
  await page.addInitScript(() => {
    let lastAction = '';
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target.closest('button') : null;
        if (target) lastAction = target.getAttribute('aria-label') || target.textContent?.slice(0, 100) || '';
      },
      true,
    );
    const nativeWarn = console.warn.bind(console);
    console.warn = (...args: unknown[]) => {
      nativeWarn(...args);
      const message = args.find((value) => typeof value === 'string' && value.includes("Couldn't create edge for"));
      if (!message) return;
      try {
        const events = JSON.parse(sessionStorage.getItem('modiff-handle-diagnostics') ?? '[]') as unknown[];
        if (events.length >= 30) return;
        const snapshot = window.__MODIFF_E2E__?.getState().flow;
        events.push({
          message,
          lastAction,
          time: performance.now(),
          nodes: snapshot?.nodes.map((node) => ({
            id: node.id,
            parentId: node.parentId,
            action: node.action,
            fields: Object.entries(node.params ?? {}).map(([key, field]) => ({
              key,
              display: field.display,
              hidden: field.hidden,
            })),
          })),
          edges: snapshot?.edges,
          domNodes: [...document.querySelectorAll('.react-flow__node')].map((node) => ({
            id: node.getAttribute('data-id'),
            handles: [...node.querySelectorAll('.react-flow__handle')].map((handle) => ({
              id: handle.getAttribute('data-handleid'),
              type: handle.classList.contains('source') ? 'source' : 'target',
            })),
          })),
        });
        sessionStorage.setItem('modiff-handle-diagnostics', JSON.stringify(events));
      } catch {
        // Diagnostic collection cannot alter the warning or the graph.
      }
    };
  });
}

export async function attachLegacyHandleDiagnostics(page: Page, info: TestInfo) {
  const outputPath = info.outputPath('legacy-handles.json');
  await fs.writeFile(
    outputPath,
    await page.evaluate(() => sessionStorage.getItem('modiff-handle-diagnostics') ?? '[]'),
  );
  await info.attach('legacy-handles.json', {
    path: outputPath,
    contentType: 'application/json',
  });
}
