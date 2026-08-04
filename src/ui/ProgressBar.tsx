import { cx } from '../utils/classNames';

export type ProgressBarProps = {
  className?: string;
  label?: string;
  tone?: 'default' | 'success';
  value?: number | null;
};

export function ProgressBar({ value, className, label = 'Progress', tone = 'default' }: ProgressBarProps) {
  const determinate = typeof value === 'number';
  const clamped = Math.max(0, Math.min(value ?? 0, 100));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? clamped : undefined}
      className={cx('h-1.5 overflow-hidden bg-modiff-disabled/30', className)}
    >
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
