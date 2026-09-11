import { forwardRef, type CSSProperties, type MouseEventHandler, type ReactNode } from 'react';
import type { ModiffNodeStyle } from '../theme';
import { cx } from '../utils/classNames';

export type CustomNodeFrameProps = {
  children: ReactNode;
  className?: string;
  headerColor?: string;
  id: string;
  parentNodeId?: string;
  isError?: boolean;
  maxWidth: number;
  minWidth?: number;
  nodeStyle?: ModiffNodeStyle;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  testId?: string;
};

export const CustomNodeFrame = forwardRef<HTMLDivElement, CustomNodeFrameProps>(function CustomNodeFrame(
  { children, className, id, parentNodeId, isError = false, maxWidth, minWidth, nodeStyle, onContextMenu, testId },
  ref,
) {
  const frameStyle: CSSProperties = {
    maxWidth,
    minWidth,
    ...nodeStyle,
    maxHeight: 'none',
  };

  return (
    <div
      ref={ref}
      id={id}
      data-testid={testId}
      data-node-parent-id={parentNodeId}
      className={cx(
        'relative flex h-full min-h-0 w-full flex-col items-center justify-between border bg-modiff-surface outline outline-2 outline-offset-[5px] outline-transparent',
        isError
          ? 'border-modiff-invalid shadow-[0_0_0_2px_var(--color-modiff-invalid)]'
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
      className="flex w-full items-center justify-between border-b border-modiff-border-subtle border-t-[5px] border-t-modiff-border-subtle bg-modiff-bg p-2 pl-3 text-modiff-text"
      style={{
        backgroundColor: headerColor,
        borderTopColor: headerColor,
      }}
    >
      {children}
    </header>
  );
}
