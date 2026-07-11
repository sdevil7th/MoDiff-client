import { forwardRef, type ReactNode } from 'react';
import type { ModiffNodeStyle } from '../theme';
import { cx } from '../utils/classNames';

export type AnyNodeFrameProps = {
  children: ReactNode;
  className?: string;
  id: string;
  nodeStyle?: ModiffNodeStyle;
};

export const AnyNodeFrame = forwardRef<HTMLDivElement, AnyNodeFrameProps>(function AnyNodeFrame(
  { children, className, id, nodeStyle },
  ref,
) {
  return (
    <div
      ref={ref}
      id={id}
      className={cx(
        'relative flex min-h-full w-full flex-col items-center justify-center bg-transparent outline outline-2 outline-offset-[5px] outline-transparent',
        className,
      )}
      style={nodeStyle}
    >
      {children}
    </div>
  );
});
