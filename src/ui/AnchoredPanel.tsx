import type { ReactNode } from 'react';
import { cx } from '../utils/classNames';

export type AnchoredPanelProps = {
  anchor: { left: number; top: number };
  children: ReactNode;
  className?: string;
};

export function AnchoredPanel({ anchor, children, className }: AnchoredPanelProps) {
  return (
    <div className={cx('fixed z-50', className)} style={{ left: anchor.left, top: anchor.top }}>
      {children}
    </div>
  );
}
