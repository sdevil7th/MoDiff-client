import { LoaderCircle } from 'lucide-react';
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

import { cx } from '../utils/classNames';
import {
  ModiffBadge,
  ModiffCheckbox,
  ModiffChip,
  ModiffFieldShell,
  ModiffMultiSelect,
  ModiffNumberInput,
  ModiffPasswordInput,
  ModiffRadioGroup,
  ModiffSearchInput,
  ModiffSelect,
  ModiffSlider,
  ModiffSwitch,
  ModiffTabs,
  ModiffTextarea,
  type ModiffNumberInputProps,
  type ModiffMultiSelectProps,
  type ModiffPasswordInputProps,
  type ModiffRadioGroupProps,
  type ModiffSearchInputProps,
  type ModiffSelectProps,
  type ModiffSliderProps,
  type ModiffSwitchProps,
  type ModiffTabsProps,
  type ModiffTextareaProps,
} from './controls';
import { ModiffButton, ModiffIconButton, ModiffInput, type ModiffIconButtonProps } from './primitives';

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
  readOnly = false,
  description,
  error,
  required = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  multiline?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
}) {
  const id = useId();

  return (
    <ModiffFieldShell
      htmlFor={id}
      label={label}
      description={description}
      error={error}
      disabled={disabled}
      readOnly={readOnly}
      required={required}
    >
      {multiline ? (
        <ModiffTextarea
          id={id}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          rows={4}
          onChange={(event) => onChange(event.target.value)}
          invalid={Boolean(error)}
          className="min-h-24"
        />
      ) : (
        <ModiffInput
          id={id}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
          invalid={Boolean(error)}
        />
      )}
    </ModiffFieldShell>
  );
}

export function StudioTextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <ModiffInput className={cx('min-w-0', className)} {...props} />;
}

export const StudioSearchInput = forwardRef<HTMLInputElement, ModiffSearchInputProps>(function StudioSearchInput(
  { className, controlSize = 'dense', ...props },
  ref,
) {
  return <ModiffSearchInput ref={ref} className={cx('min-w-0', className)} controlSize={controlSize} {...props} />;
});

export const StudioNumberInput = forwardRef<HTMLInputElement, ModiffNumberInputProps>(function StudioNumberInput(
  { className, controlSize = 'dense', ...props },
  ref,
) {
  return <ModiffNumberInput ref={ref} className={cx('min-w-0', className)} controlSize={controlSize} {...props} />;
});

export const StudioPasswordInput = forwardRef<HTMLInputElement, ModiffPasswordInputProps>(function StudioPasswordInput(
  { className, controlSize = 'dense', ...props },
  ref,
) {
  return <ModiffPasswordInput ref={ref} className={cx('min-w-0', className)} controlSize={controlSize} {...props} />;
});

export const StudioTextarea = forwardRef<HTMLTextAreaElement, ModiffTextareaProps>(function StudioTextarea(
  { className, ...props },
  ref,
) {
  return <ModiffTextarea ref={ref} className={cx('min-w-0', className)} {...props} />;
});

export type StudioSelectProps = Omit<ModiffSelectProps, 'size'>;

export function StudioSelect(props: StudioSelectProps) {
  return <ModiffSelect size="dense" {...props} />;
}

export type StudioMultiSelectProps = Omit<ModiffMultiSelectProps, 'size'>;

export function StudioMultiSelect(props: StudioMultiSelectProps) {
  return <ModiffMultiSelect size="dense" {...props} />;
}

export type StudioButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';

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
    <ModiffButton
      type={type}
      align={align}
      fullWidth={fullWidth}
      icon={icon}
      tone={tone}
      className={className}
      {...props}
    >
      {children}
    </ModiffButton>
  );
}

export function StudioIconButton({
  children,
  className,
  title,
  type = 'button',
  ...props
}: Omit<ModiffIconButtonProps, 'label'> & { title: string }) {
  return (
    <ModiffIconButton type={type} label={title} className={className} {...props}>
      {children}
    </ModiffIconButton>
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
  tone?: 'default' | 'success' | 'error' | 'warning';
}) {
  if (!onClick) {
    return (
      <ModiffBadge className={className} title={title} tone={tone}>
        {children}
      </ModiffBadge>
    );
  }

  return (
    <ModiffChip
      type="button"
      active={active}
      className={className}
      onClick={onClick}
      title={title}
      tone={tone}
      {...props}
    >
      {children}
    </ModiffChip>
  );
}

export function StudioCheckbox({
  checked,
  label,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  label: ReactNode;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return <ModiffCheckbox checked={checked} disabled={disabled} label={label} onCheckedChange={onChange} />;
}

export type StudioSliderProps = Omit<ModiffSliderProps, 'onValueChange'> & {
  onChange: (value: number) => void;
};

export function StudioSlider({ onChange, ...props }: StudioSliderProps) {
  return <ModiffSlider {...props} onValueChange={onChange} />;
}

export function StudioSwitch(props: ModiffSwitchProps) {
  return <ModiffSwitch {...props} />;
}

export function StudioRadioGroup(props: ModiffRadioGroupProps) {
  return <ModiffRadioGroup {...props} />;
}

export function StudioTabs(props: ModiffTabsProps) {
  return <ModiffTabs {...props} />;
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
  error: 'text-modiff-invalid',
  warning: 'text-modiff-warning',
  secondary: 'text-modiff-subtle-text',
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
