import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

import { cx } from '../utils/classNames';

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-sm font-bold text-modiff-text">{title}</h3>
      {action}
    </div>
  );
}

export function StudioInput({
  label,
  value,
  onChange,
  multiline = false,
  disabled = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  multiline?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="block border border-modiff-border bg-modiff-bg">
      <span className="block px-2 pt-1.5 text-xs text-gray-400">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          disabled={disabled}
          rows={4}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-24 w-full resize-y bg-transparent px-2 pb-2 pt-1 text-sm text-modiff-text outline-none placeholder:text-gray-500 disabled:opacity-50"
        />
      ) : (
        <input
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-full bg-transparent px-2 text-sm text-modiff-text outline-none placeholder:text-gray-500 disabled:opacity-50"
        />
      )}
    </label>
  );
}

export function StudioTextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'h-8 min-w-0 rounded-modiff-compact border border-modiff-border bg-modiff-bg px-2 text-sm text-modiff-text outline-none placeholder:text-gray-500 focus:border-hf-yellow disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function StudioSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        'h-8 min-w-0 rounded-modiff-compact border border-modiff-border bg-modiff-bg px-2 text-sm text-modiff-text outline-none focus:border-hf-yellow disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export type StudioButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonToneClasses: Record<StudioButtonTone, string> = {
  primary: 'bg-hf-yellow text-black hover:bg-hf-orange',
  secondary: 'border border-modiff-border bg-modiff-panel text-modiff-text hover:border-hf-yellow/70 hover:text-white',
  ghost: 'text-gray-300 hover:bg-white/10 hover:text-white',
  danger: 'bg-modiff-red text-white hover:brightness-110',
};

export function StudioButton({
  align = 'center',
  children,
  className,
  fullWidth = false,
  icon,
  tone = 'secondary',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  align?: 'center' | 'left';
  fullWidth?: boolean;
  icon?: ReactNode;
  tone?: StudioButtonTone;
}) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex min-h-8 items-center gap-1.5 rounded-modiff-compact px-3 py-1 text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow',
        fullWidth && 'w-full',
        align === 'center' ? 'justify-center text-center' : 'justify-start text-left whitespace-normal',
        buttonToneClasses[tone],
        className,
      )}
      {...props}
    >
      {icon ? <span className="grid size-4 shrink-0 place-items-center">{icon}</span> : null}
      {children}
    </button>
  );
}

export function StudioIconButton({
  children,
  className,
  title,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return (
    <button
      type={type}
      title={title}
      aria-label={title}
      className={cx(
        'grid size-8 shrink-0 place-items-center rounded-modiff-compact text-gray-300 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function StudioChip({
  active = false,
  children,
  className,
  onClick,
  title,
  tone = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  tone?: 'default' | 'success' | 'error';
}) {
  const classes = cx(
    'inline-flex min-h-6 items-center rounded-modiff-compact border px-2 py-0.5 text-xs font-semibold transition',
    active && 'border-hf-yellow bg-hf-yellow text-black',
    !active && tone === 'success' && 'border-modiff-green/60 bg-modiff-green/10 text-modiff-green',
    !active && tone === 'error' && 'border-modiff-red/60 bg-modiff-red/10 text-modiff-red',
    !active && tone === 'default' && 'border-modiff-border bg-modiff-panel text-gray-300',
    onClick && 'hover:border-hf-yellow/70 hover:text-white',
    className,
  );

  if (!onClick) {
    return (
      <span className={classes} title={title}>
        {children}
      </span>
    );
  }

  return (
    <button type="button" className={classes} onClick={onClick} title={title} {...props}>
      {children}
    </button>
  );
}

export function StudioCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: ReactNode;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-gray-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-hf-yellow"
      />
      {label}
    </label>
  );
}

export function StudioSlider({
  max,
  min,
  onChange,
  step,
  value,
}: {
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number.isFinite(Number(event.target.value)) ? Number(event.target.value) : value)}
      className="w-full accent-hf-yellow"
    />
  );
}

export function StudioDivider() {
  return <div className="border-t border-modiff-border" />;
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <LoaderCircle size={size} className="animate-spin" />;
}

export type StatusTone = 'success' | 'error' | 'warning' | 'secondary';

const statusTextClasses: Record<StatusTone, string> = {
  success: 'text-modiff-green',
  error: 'text-modiff-red',
  warning: 'text-hf-orange',
  secondary: 'text-gray-400',
};

export function StatusLine({
  children,
  tone = 'secondary',
  breakAll = false,
}: {
  children: ReactNode;
  tone?: StatusTone;
  breakAll?: boolean;
}) {
  return (
    <p className={cx('block text-xs', statusTextClasses[tone], breakAll ? 'break-all' : 'break-words')}>{children}</p>
  );
}
