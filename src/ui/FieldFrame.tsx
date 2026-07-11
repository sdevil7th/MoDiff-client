import type { ReactNode } from 'react';
import type { ModiffFieldStyle } from '../theme';
import { cx } from '../utils/classNames';

export type FieldFrameProps = {
  children: ReactNode;
  className?: string;
  dataKey: string;
  disabled?: boolean;
  hidden?: boolean;
  layoutStyle?: ModiffFieldStyle;
};

export function FieldFrame({
  children,
  className,
  dataKey,
  disabled = false,
  hidden = false,
  layoutStyle,
}: FieldFrameProps) {
  return (
    <div
      data-key={dataKey}
      className={cx('w-full', hidden && 'modiff-hidden', disabled && 'modiff-disabled', className)}
      style={layoutStyle}
    >
      {children}
    </div>
  );
}
