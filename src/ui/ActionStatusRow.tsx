import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../utils/classNames';
import type { IssueCardTone } from './IssueCard';

const toneClasses: Record<IssueCardTone, string> = {
  default: 'border-modiff-border bg-modiff-surface text-modiff-text hover:border-hf-yellow/70',
  success: 'border-modiff-green/50 bg-modiff-surface text-modiff-text hover:border-modiff-green',
  warning: 'border-modiff-warning/70 bg-modiff-surface text-modiff-text hover:border-modiff-warning',
  error: 'border-modiff-invalid/70 bg-modiff-surface text-modiff-text hover:border-modiff-invalid',
  info: 'border-modiff-blue/70 bg-modiff-surface text-modiff-text hover:border-modiff-blue',
};

const iconClasses: Record<IssueCardTone, string> = {
  default: 'text-modiff-subtle-text',
  success: 'text-modiff-green',
  warning: 'text-modiff-warning',
  error: 'text-modiff-invalid',
  info: 'text-modiff-blue',
};

function iconForTone(tone: IssueCardTone): LucideIcon {
  if (tone === 'success') return CheckCircle2;
  if (tone === 'warning') return AlertTriangle;
  if (tone === 'error') return XCircle;
  return Info;
}

export function ActionStatusRow({
  action,
  className,
  disabled,
  meta,
  onClick,
  testId,
  title,
  tone = 'default',
}: {
  action?: ReactNode;
  className?: string;
  disabled?: boolean;
  meta?: ReactNode;
  onClick?: () => void;
  testId?: string;
  title: ReactNode;
  tone?: IssueCardTone;
}) {
  const Icon = iconForTone(tone);
  const content = (
    <>
      <Icon size={16} className={cx('shrink-0', iconClasses[tone])} />
      <span className="min-w-0 flex-1 overflow-hidden">
        <span className="block break-words font-semibold">{title}</span>
        {meta ? (
          <span className="mt-0.5 block break-words text-modiff-metadata text-modiff-subtle-text">{meta}</span>
        ) : null}
      </span>
      {action ? <span className="shrink-0">{action}</span> : null}
    </>
  );
  const rowClassName = cx(
    'flex min-h-11 w-full min-w-0 items-center gap-2 overflow-hidden rounded-modiff-compact border px-3 py-2 text-left text-sm transition',
    onClick &&
      'active:bg-modiff-surface-pressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-modiff-focus',
    disabled && 'pointer-events-none opacity-50',
    toneClasses[tone],
    className,
  );

  if (onClick) {
    return (
      <button type="button" data-testid={testId} disabled={disabled} onClick={onClick} className={rowClassName}>
        {content}
      </button>
    );
  }

  return (
    <div data-testid={testId} className={rowClassName}>
      {content}
    </div>
  );
}
