import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../utils/classNames';

export type IssueCardTone = 'default' | 'success' | 'warning' | 'error' | 'info';

const toneClasses: Record<IssueCardTone, string> = {
  default: 'border-modiff-border bg-modiff-surface',
  success: 'border-modiff-green/60 bg-modiff-surface',
  warning: 'border-hf-orange/70 bg-modiff-surface',
  error: 'border-modiff-red/70 bg-modiff-surface',
  info: 'border-modiff-blue/70 bg-modiff-surface',
};

const iconClasses: Record<IssueCardTone, string> = {
  default: 'text-gray-400',
  success: 'text-modiff-green',
  warning: 'text-hf-orange',
  error: 'text-modiff-red',
  info: 'text-modiff-blue',
};

function ToneIcon({ tone }: { tone: IssueCardTone }) {
  const className = iconClasses[tone];
  if (tone === 'success') return <CheckCircle2 size={16} className={className} />;
  if (tone === 'warning') return <AlertTriangle size={16} className={className} />;
  if (tone === 'error') return <XCircle size={16} className={className} />;
  return <Info size={16} className={className} />;
}

export function IssueCard({
  action,
  children,
  className,
  meta,
  testId,
  title,
  tone = 'default',
}: {
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  meta?: ReactNode;
  testId?: string;
  title: ReactNode;
  tone?: IssueCardTone;
}) {
  return (
    <article
      data-testid={testId}
      className={cx('rounded-modiff-compact border p-3 text-sm text-modiff-text', toneClasses[tone], className)}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
          <ToneIcon tone={tone} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 break-words text-sm font-semibold text-modiff-text">{title}</h3>
            {action}
          </div>
          {meta ? <div className="mt-1 break-words text-xs text-modiff-muted">{meta}</div> : null}
          {children ? <div className="mt-2 text-xs leading-5 text-gray-300">{children}</div> : null}
        </div>
      </div>
    </article>
  );
}
