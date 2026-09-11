import { expect, type Page } from '@playwright/test';

export async function waitForRecursiveDomGeometry(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      ),
  );
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const issues: string[] = [];
          const byParent = new Map<string, HTMLElement[]>();
          const frames = document.querySelectorAll<HTMLElement>(
            '[data-block-projection="modular-diffusers"], [data-node-parent-id]',
          );
          if (!document.querySelector('[data-node-parent-id]')) issues.push('no ordinary internal nodes inspected');
          frames.forEach((frame) => {
            const parentId = frame.dataset.blockParentNodeId ?? frame.dataset.nodeParentId;
            const wrapper = frame.closest<HTMLElement>('.react-flow__node');
            if (!parentId || !wrapper) {
              issues.push('internal node or Block has no inspectable parent');
              return;
            }
            const parent = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(parentId)}"]`);
            if (!parent) {
              issues.push(`${wrapper.dataset.id}: missing parent ${parentId}`);
              return;
            }
            const childRect = wrapper.getBoundingClientRect();
            const parentRect = parent.getBoundingClientRect();
            const parentFrame = parent.querySelector<HTMLElement>(`[data-testid="user-block-${CSS.escape(parentId)}"]`);
            const parentHeader = parentFrame?.querySelector<HTMLElement>(':scope > header');
            const parentTray = parentFrame?.querySelector<HTMLElement>(
              `[data-testid="node-connector-tray-${CSS.escape(parentId)}"]`,
            );
            const contentTop = parentHeader?.getBoundingClientRect().bottom ?? parentRect.top;
            const contentBottom = parentTray?.getBoundingClientRect().top ?? parentRect.bottom;
            if (
              childRect.left < parentRect.left - 2 ||
              childRect.top < contentTop - 2 ||
              childRect.right > parentRect.right + 2 ||
              childRect.bottom > contentBottom + 2
            )
              issues.push(
                `${wrapper.dataset.id}: escapes content area of ${parentId} (${JSON.stringify({
                  child: childRect.toJSON(),
                  parent: parentRect.toJSON(),
                  contentTop,
                  contentBottom,
                })})`,
              );
            byParent.set(parentId, [...(byParent.get(parentId) ?? []), wrapper]);
          });
          byParent.forEach((siblings, parentId) => {
            siblings.forEach((left, index) => {
              const leftRect = left.getBoundingClientRect();
              siblings.slice(index + 1).forEach((right) => {
                const rightRect = right.getBoundingClientRect();
                if (
                  leftRect.left < rightRect.right - 1 &&
                  leftRect.right > rightRect.left + 1 &&
                  leftRect.top < rightRect.bottom - 1 &&
                  leftRect.bottom > rightRect.top + 1
                )
                  issues.push(`${left.dataset.id}: overlaps ${right.dataset.id} in ${parentId}`);
              });
            });
          });
          return issues;
        }),
      { timeout: 15_000 },
    )
    .toEqual([]);
}
