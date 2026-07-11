import type { WheelEvent } from 'react';

export function handleHorizontalWheel(event: WheelEvent<HTMLElement>) {
  const element = event.currentTarget;
  const maxScrollLeft = element.scrollWidth - element.clientWidth;
  if (maxScrollLeft <= 0) return;

  const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (delta === 0) return;

  const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, element.scrollLeft + delta));
  if (nextScrollLeft === element.scrollLeft) return;

  element.scrollLeft = nextScrollLeft;
  event.preventDefault();
}
