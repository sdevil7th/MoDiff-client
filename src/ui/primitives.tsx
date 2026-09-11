import { Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { LoaderCircle, X } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../utils/classNames';
import { modiffActionToneClasses, type ModiffActionTone } from './actionStyles';
import { ModiffInput, type ModiffInputProps } from './controls';
import { controlHeightClasses, type ModiffControlSize } from './controlStyles';
import { ModiffTooltip } from './overlays';

export type ModiffButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  align?: 'center' | 'left';
  fullWidth?: boolean;
  tone?: ModiffActionTone;
  icon?: ReactNode;
  loading?: boolean;
  size?: ModiffControlSize;
};

export const ModiffButton = forwardRef<HTMLButtonElement, ModiffButtonProps>(function ModiffButton(
  {
    align = 'center',
    className,
    tone = 'secondary',
    fullWidth = false,
    icon,
    loading = false,
    size = 'dense',
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-modiff-compact px-3 font-semibold leading-none transition disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        controlHeightClasses[size],
        fullWidth && 'w-full',
        align === 'center' ? 'justify-center text-center' : 'justify-start whitespace-normal text-left',
        modiffActionToneClasses[tone],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span className="grid size-4 shrink-0 place-items-center">
          <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
        </span>
      ) : icon ? (
        <span className="grid size-4 shrink-0 place-items-center">{icon}</span>
      ) : null}
      {children}
    </button>
  );
});

export type ModiffIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  isRound?: boolean;
  size?: ModiffControlSize;
  tone?: ModiffActionTone;
};

export const ModiffIconButton = forwardRef<HTMLButtonElement, ModiffIconButtonProps>(function ModiffIconButton(
  {
    'aria-describedby': ariaDescribedBy,
    active = false,
    children,
    className,
    isRound = false,
    label,
    onBlur,
    onFocus,
    onPointerEnter,
    onPointerLeave,
    size = 'dense',
    title,
    tone = 'ghost',
    type = 'button',
    ...props
  },
  ref,
) {
  const tooltipLabel = title || label;

  return (
    <ModiffTooltip<HTMLButtonElement> content={tooltipLabel}>
      {(tooltipProps) => (
        <button
          ref={ref}
          type={type}
          aria-label={label}
          aria-describedby={[ariaDescribedBy, tooltipProps['aria-describedby']].filter(Boolean).join(' ') || undefined}
          className={cx(
            'grid shrink-0 place-items-center text-modiff-subtle-text transition hover:bg-modiff-surface-hover hover:text-modiff-text active:bg-modiff-surface-pressed disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-modiff-focus',
            isRound ? 'rounded-full' : 'rounded-modiff-compact',
            size === 'compact' && 'size-7',
            size === 'dense' && 'size-8',
            size === 'normal' && 'size-9',
            size === 'prominent' && 'size-10',
            modiffActionToneClasses[tone],
            active &&
              'bg-hf-yellow text-modiff-on-accent hover:bg-hf-yellow hover:text-modiff-on-accent active:bg-modiff-primary-pressed',
            'data-[open]:bg-modiff-selected-surface data-[open]:text-hf-yellow',
            className,
          )}
          onPointerEnter={(event) => {
            tooltipProps.onPointerEnter(event);
            onPointerEnter?.(event);
          }}
          onPointerLeave={(event) => {
            tooltipProps.onPointerLeave(event);
            onPointerLeave?.(event);
          }}
          onFocus={(event) => {
            tooltipProps.onFocus(event);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            tooltipProps.onBlur(event);
            onBlur?.(event);
          }}
          {...props}
        >
          {children}
        </button>
      )}
    </ModiffTooltip>
  );
});

export function ModiffProgress({
  value,
  className,
  label = 'Progress',
}: {
  value: number;
  className?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cx('h-1.5 overflow-hidden rounded-full bg-modiff-disabled/30', className)}
    >
      <div className="h-full bg-hf-yellow transition-[width]" style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function ModiffStatusOverlay({
  title,
  children,
  testId,
}: {
  title: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-modiff-dialog-backdrop/70 p-4"
      data-testid={testId}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <section className="w-full max-w-sm overflow-hidden rounded-modiff-panel border border-modiff-border bg-modiff-surface shadow-modiff-node">
        <h2 className="border-b border-modiff-border px-4 py-3 text-modiff-modal-title font-semibold text-modiff-text">
          {title}
        </h2>
        <div className="p-4">{children}</div>
      </section>
    </div>,
    document.body,
  );
}

export function ModiffDialog({
  open,
  onClose,
  title,
  description,
  toolbar,
  children,
  footer,
  panelClassName,
  bodyClassName,
  testId,
  dismissible = true,
  closeLabel = 'Close',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  panelClassName?: string;
  bodyClassName?: string;
  testId?: string;
  dismissible?: boolean;
  closeLabel?: string;
}) {
  // Headless UI Dialog requires typeof open === 'boolean'. Keep this runtime
  // coercion even when Terser represents boolean literals as integers.
  const dialogOpen = Boolean(open);
  const hasPanelWidth = /(?:^|\s)!?max-w-/u.test(panelClassName ?? '');
  return (
    <Dialog open={dialogOpen} onClose={dismissible ? onClose : () => undefined} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-modiff-dialog-backdrop/70" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel
          data-testid={testId}
          tabIndex={dismissible ? undefined : 0}
          className={cx(
            'flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-modiff-panel border border-modiff-border bg-modiff-surface shadow-modiff-node',
            !hasPanelWidth && 'max-w-3xl',
            panelClassName,
          )}
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-modiff-border bg-modiff-panel px-4 py-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-modiff-modal-title font-semibold text-modiff-text">{title}</DialogTitle>
              {description ? (
                <Description className="mt-1 text-sm text-modiff-subtle-text">{description}</Description>
              ) : null}
            </div>
            {dismissible ? (
              <ModiffIconButton label={closeLabel} onClick={onClose}>
                <X size={16} />
              </ModiffIconButton>
            ) : null}
          </header>
          {toolbar ? <div className="shrink-0 border-b border-modiff-border bg-modiff-panel">{toolbar}</div> : null}
          <div className={cx('min-h-0 overflow-auto overscroll-contain p-4', bodyClassName)} data-dialog-scroll-body>
            {children}
          </div>
          {footer ? (
            <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-modiff-border bg-modiff-panel px-4 py-3">
              {footer}
            </footer>
          ) : null}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export { ModiffInput };
export type { ModiffInputProps };
