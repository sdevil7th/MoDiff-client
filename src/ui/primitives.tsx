import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
} from '@headlessui/react';
import { Check, ChevronDown, X } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/classNames';

type Tone = 'primary' | 'secondary' | 'danger' | 'ghost';

const toneClasses: Record<Tone, string> = {
  primary: 'bg-hf-yellow text-black hover:bg-hf-orange focus-visible:outline-hf-yellow',
  secondary:
    'border border-modiff-border bg-modiff-panel text-modiff-text hover:border-hf-yellow/70 hover:text-white focus-visible:outline-hf-yellow',
  danger: 'bg-modiff-red text-white hover:brightness-110 focus-visible:outline-modiff-red',
  ghost: 'text-gray-300 hover:bg-white/10 hover:text-white focus-visible:outline-hf-yellow',
};

export type ModiffButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone;
  icon?: ReactNode;
};

export const ModiffButton = forwardRef<HTMLButtonElement, ModiffButtonProps>(function ModiffButton(
  { className, tone = 'secondary', icon, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-modiff-compact px-3 text-sm font-semibold leading-none transition disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {icon ? <span className="grid size-4 place-items-center">{icon}</span> : null}
      {children}
    </button>
  );
});

export type ModiffIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
};

export const ModiffIconButton = forwardRef<HTMLButtonElement, ModiffIconButtonProps>(function ModiffIconButton(
  { className, label, active = false, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'grid size-8 place-items-center rounded-modiff-compact text-gray-300 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow',
        active && 'bg-hf-yellow text-black hover:bg-hf-yellow hover:text-black',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export type ModiffInputProps = InputHTMLAttributes<HTMLInputElement>;

export const ModiffInput = forwardRef<HTMLInputElement, ModiffInputProps>(function ModiffInput(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx(
        'h-8 w-full rounded-modiff-compact border border-modiff-border bg-modiff-bg px-2 text-sm text-modiff-text placeholder:text-gray-500 focus:border-hf-yellow focus:outline-none',
        className,
      )}
      {...props}
    />
  );
});

export function ModiffProgress({ value, className }: { value: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cx('h-1.5 overflow-hidden rounded-full bg-white/10', className)}>
      <div className="h-full bg-hf-yellow transition-[width]" style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function ModiffDialog({
  open,
  onClose,
  title,
  children,
  footer,
  panelClassName,
  bodyClassName,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  panelClassName?: string;
  bodyClassName?: string;
  testId?: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/70" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel
          data-testid={testId}
          className={cx(
            'max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-modiff-panel border border-modiff-border bg-modiff-surface shadow-modiff-node',
            panelClassName,
          )}
        >
          <header className="flex items-center justify-between gap-3 border-b border-modiff-border px-4 py-3">
            <DialogTitle className="min-w-0 truncate text-base font-semibold text-white">{title}</DialogTitle>
            <ModiffIconButton label="Close" onClick={onClose}>
              <X size={16} />
            </ModiffIconButton>
          </header>
          <div className={cx('max-h-[70vh] overflow-auto p-4', bodyClassName)}>{children}</div>
          {footer ? (
            <footer className="flex justify-end gap-2 border-t border-modiff-border px-4 py-3">{footer}</footer>
          ) : null}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export function ModiffMenu({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Menu as="div" className="relative inline-block text-left">
      <MenuButton className="inline-flex h-8 items-center gap-1 rounded-modiff-compact border border-modiff-border bg-modiff-panel px-2 text-sm text-gray-200 hover:border-hf-yellow/70">
        {label}
        <ChevronDown size={14} />
      </MenuButton>
      <MenuItems className="absolute right-0 z-40 mt-1 min-w-44 rounded-modiff-panel border border-modiff-border bg-modiff-surface p-1 shadow-modiff-node focus:outline-none">
        {children}
      </MenuItems>
    </Menu>
  );
}

export function ModiffMenuItem({
  children,
  onClick,
  active,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <MenuItem>
      {({ focus }) => (
        <button
          type="button"
          onClick={onClick}
          className={cx(
            'flex w-full items-center gap-2 rounded-modiff-compact px-2 py-1.5 text-left text-sm text-gray-200',
            focus && 'bg-white/10 text-white',
          )}
        >
          <span className="grid size-4 place-items-center">{active ? <Check size={14} /> : null}</span>
          {children}
        </button>
      )}
    </MenuItem>
  );
}
