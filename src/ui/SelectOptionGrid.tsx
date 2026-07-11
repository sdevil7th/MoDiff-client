import type { ReactNode } from 'react';
import { cx } from '../utils/classNames';

export type SelectOptionGridProps = {
  children: ReactNode;
  className?: string;
  columns: number;
};

export function SelectOptionGrid({ children, className, columns }: SelectOptionGridProps) {
  const safeColumns = Math.min(Math.max(columns, 1), 20);

  return (
    <div
      className={cx('grid items-center gap-0 p-2', className)}
      style={{ gridTemplateColumns: `repeat(${safeColumns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}
