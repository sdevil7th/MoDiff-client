import type { ReactNode } from 'react';
import { cx } from '../utils/classNames';

export type StatusBoxSeverity = 'default' | 'success' | 'warning' | 'error' | 'info';

type LegacySpacingSx = {
  backgroundColor?: string;
  mb?: number;
  mt?: number;
};

export type StatusBoxProps = {
  children: ReactNode;
  severity?: StatusBoxSeverity;
  className?: string;
  sx?: LegacySpacingSx | Array<LegacySpacingSx | false | null | undefined>;
  testId?: string;
};

const severityClasses: Record<StatusBoxSeverity, string> = {
  default: 'border-modiff-border bg-modiff-surface',
  success: 'border-modiff-green/60 bg-modiff-surface',
  warning: 'border-hf-orange/70 bg-modiff-surface',
  error: 'border-modiff-red/70 bg-modiff-red/10',
  info: 'border-modiff-blue/70 bg-modiff-surface',
};

const marginBottomClasses: Record<number, string> = {
  0.5: 'mb-1',
  1: 'mb-2',
  1.5: 'mb-3',
  2: 'mb-4',
};

const marginTopClasses: Record<number, string> = {
  0.5: 'mt-1',
  1: 'mt-2',
  1.5: 'mt-3',
  2: 'mt-4',
};

function spacingClasses(sx: StatusBoxProps['sx']) {
  const entries = Array.isArray(sx) ? sx : [sx];
  return entries.map((entry) => {
    if (!entry) return null;
    return cx(
      typeof entry.mb === 'number' && marginBottomClasses[entry.mb],
      typeof entry.mt === 'number' && marginTopClasses[entry.mt],
    );
  });
}

function backgroundClasses(sx: StatusBoxProps['sx']) {
  const entries = Array.isArray(sx) ? sx : [sx];
  return entries.map((entry) => {
    if (!entry || !entry.backgroundColor) return null;
    if (entry.backgroundColor === 'background.default') return 'bg-modiff-bg';
    if (entry.backgroundColor === 'background.paper') return 'bg-modiff-surface';
    return null;
  });
}

export function StatusBox({ children, severity = 'default', className, sx, testId }: StatusBoxProps) {
  return (
    <div
      data-testid={testId}
      className={cx(
        'border p-2 text-sm text-modiff-text',
        severityClasses[severity],
        ...spacingClasses(sx),
        ...backgroundClasses(sx),
        className,
      )}
    >
      {children}
    </div>
  );
}
