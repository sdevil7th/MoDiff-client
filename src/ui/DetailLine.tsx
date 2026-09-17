import type { ReactNode } from 'react';
import { cx } from '../utils/classNames';

export function DetailLine({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'success' | 'warning' | 'error';
}) {
  return (
    <p
      className={cx(
        'break-words text-xs leading-5',
        tone === 'muted' && 'text-modiff-subtle-text',
        tone === 'success' && 'text-modiff-green',
        tone === 'warning' && 'text-hf-orange',
        tone === 'error' && 'text-modiff-red',
      )}
    >
      {children}
    </p>
  );
}
