import { cx } from '../utils/classNames';

export type ProgressBarProps = {
  value?: number | null;
  className?: string;
  tone?: 'default' | 'success';
};

export function ProgressBar({ value, className, tone = 'default' }: ProgressBarProps) {
  const determinate = typeof value === 'number' && value > 0;
  const clamped = Math.max(0, Math.min(value ?? 0, 100));

  return (
    <div className={cx('h-1.5 overflow-hidden bg-white/10', className)}>
      <div
        className={cx(
          'h-full transition-[width]',
          tone === 'success' ? 'bg-modiff-green' : 'bg-hf-yellow',
          determinate ? '' : 'w-1/4 animate-[modiff-progress-indeterminate_1.15s_ease-in-out_infinite]',
        )}
        style={determinate ? { width: `${clamped}%` } : undefined}
      />
    </div>
  );
}
