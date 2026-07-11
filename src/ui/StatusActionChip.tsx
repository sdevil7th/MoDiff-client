import { AlertCircle, CheckCircle2, Download, Info, LoaderCircle, RefreshCw, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';

import { cx } from '../utils/classNames';
import { ProgressBar } from './ProgressBar';

export type StatusActionChipTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export type StatusActionChipAction =
  'details' | 'install' | 'installing' | 'missing' | 'ready' | 'repair' | 'retry' | 'use_local' | 'expert';

export type StatusActionChipProps = {
  action?: StatusActionChipAction;
  className?: string;
  disabled?: boolean;
  label?: ReactNode;
  onClick?: () => void;
  progress?: number | null;
  testId?: string;
  title?: string;
  tone?: StatusActionChipTone;
};

const toneClasses: Record<StatusActionChipTone, string> = {
  neutral: 'border-modiff-border bg-modiff-surface text-modiff-muted hover:border-hf-yellow/70',
  info: 'border-modiff-blue/70 bg-modiff-blue/10 text-modiff-text hover:border-modiff-blue',
  success: 'border-modiff-green/60 bg-modiff-green/10 text-modiff-green hover:border-modiff-green',
  warning: 'border-hf-orange/70 bg-hf-orange/10 text-hf-orange hover:border-hf-orange',
  error: 'border-modiff-red/70 bg-modiff-red/10 text-modiff-red hover:border-modiff-red',
};

function iconFor(action: StatusActionChipAction | undefined, tone: StatusActionChipTone) {
  if (action === 'install' || action === 'use_local') return Download;
  if (action === 'installing') return LoaderCircle;
  if (action === 'repair') return Wrench;
  if (action === 'retry') return RefreshCw;
  if (action === 'details' || action === 'expert') return Info;
  if (action === 'ready') return CheckCircle2;
  if (action === 'missing') return AlertCircle;
  if (tone === 'success') return CheckCircle2;
  if (tone === 'warning' || tone === 'error') return AlertCircle;
  return Info;
}

function labelText(label: ReactNode): string | undefined {
  return typeof label === 'string' ? label : undefined;
}

export function StatusActionChip({
  action,
  className,
  disabled = false,
  label,
  onClick,
  progress,
  testId,
  title,
  tone = 'neutral',
}: StatusActionChipProps) {
  const Icon = iconFor(action, tone);
  const content = label ?? action ?? 'Status';
  const ariaLabel = title ?? labelText(content) ?? 'Status';
  const baseClassName = cx(
    'inline-flex min-h-8 items-center gap-2 rounded-modiff-compact border px-3 py-1.5 text-sm font-semibold transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-modiff-focus focus-visible:ring-offset-2 focus-visible:ring-offset-modiff-bg',
    toneClasses[tone],
    disabled && 'cursor-not-allowed opacity-60 hover:border-modiff-border',
    action === 'installing' && 'cursor-progress',
    className,
  );
  const inner = (
    <>
      <Icon aria-hidden className={cx('h-4 w-4 shrink-0', action === 'installing' && 'animate-spin')} />
      <span className="min-w-0 truncate">{content}</span>
      {typeof progress === 'number' ? <ProgressBar className="w-16" value={progress} /> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        aria-label={ariaLabel}
        className={baseClassName}
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
        title={title}
        type="button"
      >
        {inner}
      </button>
    );
  }

  return (
    <span aria-label={ariaLabel} className={baseClassName} data-testid={testId} title={title}>
      {inner}
    </span>
  );
}
