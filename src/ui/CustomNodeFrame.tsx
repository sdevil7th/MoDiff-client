import { forwardRef, type CSSProperties, type MouseEventHandler, type ReactNode } from 'react';
import type { ModiffNodeStyle } from '../theme';
import { cx } from '../utils/classNames';

export type CustomNodeFrameProps = {
  children: ReactNode;
  className?: string;
  headerColor?: string;
  id: string;
  isError?: boolean;
  maxHeight: number;
  maxWidth: number;
  nodeStyle?: ModiffNodeStyle;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  testId?: string;
};

export const CustomNodeFrame = forwardRef<HTMLDivElement, CustomNodeFrameProps>(function CustomNodeFrame(
  { children, className, id, isError = false, maxHeight, maxWidth, nodeStyle, onContextMenu, testId },
  ref,
) {
  const frameStyle: CSSProperties = {
    maxHeight,
    maxWidth,
    ...nodeStyle,
  };

  return (
    <div
      ref={ref}
      id={id}
      data-testid={testId}
      className={cx(
        'relative flex min-h-full w-full min-w-[200px] flex-col items-center justify-between border bg-modiff-surface outline outline-2 outline-offset-[5px] outline-transparent',
        isError
          ? 'border-modiff-red shadow-[0_0_0_2px_var(--color-modiff-red)]'
          : 'border-modiff-border shadow-modiff-node',
        className,
      )}
      style={frameStyle}
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  );
});

export function CustomNodeHeaderFrame({ children, headerColor }: { children: ReactNode; headerColor?: string }) {
  return (
    <header
      className="flex w-full items-center justify-between border-b border-white/10 border-t-[5px] border-t-hf-gray bg-modiff-bg p-2 pl-3 text-white"
      style={{
        backgroundColor: headerColor,
        borderTopColor: headerColor,
      }}
    >
      {children}
    </header>
  );
}
