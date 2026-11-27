import type { ModiffNodeStyle } from '../theme';

/** A registry's preferred height is a starting minimum for a fresh Python node.
 * An explicit canvas resize owns the wrapper size after saving and reopening. */
export function contentDrivenNodeStyle(
  style: ModiffNodeStyle | undefined,
  explicitHeight?: number,
): ModiffNodeStyle | undefined {
  if (style?.height === undefined) return style;
  return {
    ...style,
    height: explicitHeight === undefined ? 'auto' : '100%',
    minHeight: explicitHeight === undefined ? (style.minHeight ?? style.height) : undefined,
  };
}

/** Measure the open controls and fixed socket trays in CSS pixels, independent of graph zoom. */
export function measuredNodeContentSize(frame: HTMLElement | null, limitBody = true) {
  const body = frame?.querySelector<HTMLElement>('[data-node-body]');
  const content = body?.querySelector<HTMLElement>('[data-node-fields]');
  if (!frame || !body || !content || !frame.offsetWidth || !frame.offsetHeight) return undefined;
  const css = getComputedStyle(body);
  const padding = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
  const fieldsHeight = content.offsetHeight + padding;
  // Long specialist forms can scroll. The explicit Fit action exposes every field.
  // Leave four pixels for fractional font metrics and the control focus outline.
  const height = Math.max(
    160,
    Math.ceil(frame.offsetHeight - body.clientHeight + (limitBody ? Math.min(960, fieldsHeight) : fieldsHeight) + 4),
  );
  return { width: frame.offsetWidth, height };
}
