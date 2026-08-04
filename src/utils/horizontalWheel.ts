import type { WheelEvent } from 'react';

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

function wheelDeltaInPixels(event: WheelEvent<HTMLElement>, element: HTMLElement) {
  const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (event.deltaMode === DOM_DELTA_LINE) return delta * 16;
  if (event.deltaMode === DOM_DELTA_PAGE) return delta * element.clientWidth;
  return delta;
}

export function handleHorizontalWheel(event: WheelEvent<HTMLElement>) {
  const element = event.currentTarget;
  const maxScrollLeft = element.scrollWidth - element.clientWidth;
  if (maxScrollLeft <= 0) return;

  const delta = wheelDeltaInPixels(event, element);
  if (delta === 0) return;

  const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, element.scrollLeft + delta));
  if (nextScrollLeft === element.scrollLeft) return;

  element.scrollLeft = nextScrollLeft;
  event.preventDefault();
}

export function revealHorizontalItem(container: HTMLElement, item: HTMLElement, padding = 4) {
  const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
  if (maxScrollLeft === 0) return;

  const containerRect = container.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const visibleLeft = containerRect.left + padding;
  const visibleRight = containerRect.right - padding;
  let nextScrollLeft = container.scrollLeft;

  if (itemRect.left < visibleLeft) {
    nextScrollLeft += itemRect.left - visibleLeft;
  } else if (itemRect.right > visibleRight) {
    nextScrollLeft += itemRect.right - visibleRight;
  } else {
    return;
  }

  container.scrollLeft = Math.max(0, Math.min(maxScrollLeft, nextScrollLeft));
}
