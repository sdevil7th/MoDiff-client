import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cx } from '../utils/classNames';
import { GraphControlButton } from './GraphControls';

export type GraphMenuActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  danger?: boolean;
  focused?: boolean;
  icon: ReactNode;
};

export const GraphMenuAction = forwardRef<HTMLButtonElement, GraphMenuActionProps>(function GraphMenuAction(
  { children, className, danger = false, focused = false, icon, type = 'button', ...props },
  ref,
) {
  return (
    <GraphControlButton
      {...props}
      ref={ref}
      type={type}
      role="menuitem"
      className={cx(
        'nodrag nowheel flex h-8 w-full items-center gap-2 rounded-modiff-compact px-2 text-left text-sm font-semibold text-modiff-text transition hover:bg-modiff-surface-hover hover:text-modiff-text disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none',
        focused && 'bg-modiff-selected-surface text-hf-yellow',
        danger && 'text-modiff-red hover:bg-modiff-red/10 hover:text-modiff-red',
        className,
      )}
    >
      <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </GraphControlButton>
  );
});

export function GraphMenuDivider() {
  return <div className="my-1 border-t border-modiff-border" role="separator" />;
}
