import type { ReactNode } from 'react';
import { cx } from '../utils/classNames';

export type PreviewFrameKind = 'visual' | 'audio' | 'text';
export type PreviewFrameBorder = 'solid' | 'dashed';

export type PreviewMediaFrameProps = {
  children: ReactNode;
  kind?: PreviewFrameKind;
  border?: PreviewFrameBorder;
  compact?: boolean;
  className?: string;
  testId?: string;
  title?: string;
};

export function PreviewMediaFrame({
  border = 'solid',
  children,
  className,
  compact = false,
  kind = 'visual',
  testId,
  title,
}: PreviewMediaFrameProps) {
  return (
    <div
      data-testid={testId}
      title={title}
      className={cx(
        'nodrag nopan nowheel relative flex min-w-0 max-w-full items-center justify-center overflow-hidden rounded-modiff-compact bg-modiff-bg',
        border === 'dashed' ? 'border border-dashed border-modiff-border' : 'border border-modiff-border',
        kind === 'visual' &&
          (compact ? 'aspect-video max-h-28 min-h-20 w-full' : 'aspect-video max-h-[360px] min-h-32 w-full'),
        // Reserve a 54px native player, the frame border and its vertical padding
        // while the preview renderer or the selected recording is still loading.
        kind === 'audio' && (compact ? 'min-h-14 w-full px-2' : 'min-h-[72px] w-full p-2'),
        kind === 'text' &&
          (compact ? 'max-h-32 min-h-16 w-full overflow-auto' : 'max-h-72 min-h-24 w-full overflow-auto'),
        className,
      )}
    >
      {children}
    </div>
  );
}

export type PreviewEmptyStateProps = {
  message: string;
  kind?: PreviewFrameKind;
  compact?: boolean;
  testId?: string;
};

export function PreviewEmptyState({ compact = false, kind = 'visual', message, testId }: PreviewEmptyStateProps) {
  return (
    <PreviewMediaFrame border="dashed" compact={compact} kind={kind} testId={testId} title={message}>
      <span className="line-clamp-2 max-w-full px-3 text-center text-modiff-control text-modiff-subtle-text">
        {message}
      </span>
    </PreviewMediaFrame>
  );
}
