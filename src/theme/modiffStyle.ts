import type { CSSProperties } from 'react';

const allowedLayoutStyleKeys = [
  'alignSelf',
  'aspectRatio',
  'bottom',
  'clear',
  'display',
  'flex',
  'flexBasis',
  'flexDirection',
  'flexGrow',
  'flexShrink',
  'float',
  'gridArea',
  'gridAutoColumns',
  'gridAutoRows',
  'gridColumn',
  'gridRow',
  'gridTemplateColumns',
  'gridTemplateRows',
  'height',
  'justifySelf',
  'left',
  'margin',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginTop',
  'maxHeight',
  'maxWidth',
  'minHeight',
  'minWidth',
  'objectFit',
  'order',
  'overflow',
  'overflowX',
  'overflowY',
  'padding',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'position',
  'resize',
  'right',
  'top',
  'visibility',
  'width',
  'zIndex',
] as const;

type AllowedLayoutStyleKey = (typeof allowedLayoutStyleKeys)[number];

type ModiffSpacingAliases = {
  m?: string | number;
  mt?: string | number;
  mr?: string | number;
  mb?: string | number;
  ml?: string | number;
  mx?: string | number;
  my?: string | number;
  p?: string | number;
  pt?: string | number;
  pr?: string | number;
  pb?: string | number;
  pl?: string | number;
  px?: string | number;
  py?: string | number;
};

export type ModiffLayoutStyle = Partial<Pick<CSSProperties, AllowedLayoutStyleKey>> & ModiffSpacingAliases;
export type ModiffFieldStyle = ModiffLayoutStyle;
export type ModiffNodeStyle = ModiffLayoutStyle;

const allowedKeys = new Set<string>([
  ...allowedLayoutStyleKeys,
  'm',
  'mt',
  'mr',
  'mb',
  'ml',
  'mx',
  'my',
  'p',
  'pt',
  'pr',
  'pb',
  'pl',
  'px',
  'py',
]);

export function sanitizeModiffStyle<T extends ModiffLayoutStyle>(style: unknown, context: string): T {
  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    return {} as T;
  }

  const next: Record<string, unknown> = {};
  const dropped: string[] = [];

  Object.entries(style as Record<string, unknown>).forEach(([key, value]) => {
    if (allowedKeys.has(key)) {
      next[key] = value;
    } else {
      dropped.push(key);
    }
  });

  if (dropped.length > 0 && import.meta.env.DEV) {
    console.warn(`${context} ignored unsupported backend style keys: ${dropped.join(', ')}`);
  }

  return next as T;
}

export function sanitizeModiffFieldStyle(style: unknown, context = 'MoDiff field') {
  return sanitizeModiffStyle<ModiffFieldStyle>(style, context);
}

export function sanitizeModiffNodeStyle(style: unknown, context = 'MoDiff node') {
  return sanitizeModiffStyle<ModiffNodeStyle>(style, context);
}
