import { Menu, MenuButton, MenuItem, MenuItems, type MenuItemsProps } from '@headlessui/react';
import { Check, ChevronDown } from 'lucide-react';
import { Fragment, type ButtonHTMLAttributes, type ComponentProps, type ReactElement, type ReactNode } from 'react';

import { cx } from '../utils/classNames';
import type { ModiffActionTone } from './actionStyles';
import { ModiffButton } from './primitives';

export type ModiffMenuRootProps = {
  children: ReactNode;
  className?: string;
};

export function ModiffMenuRoot({ children, className }: ModiffMenuRootProps) {
  return (
    <Menu as="div" className={cx('relative inline-block text-left', className)}>
      {children}
    </Menu>
  );
}

export function ModiffMenuTrigger({ children }: { children: ReactElement }) {
  return <MenuButton as={Fragment}>{children}</MenuButton>;
}

export type ModiffMenuSurfaceProps = Omit<ComponentProps<typeof MenuItems>, 'children' | 'className'> & {
  children: ReactNode;
  className?: string;
  layer?: 'default' | 'graph';
};

export function ModiffMenuSurface({
  anchor = 'bottom end',
  children,
  className,
  layer = 'default',
  modal = false,
  portal = true,
  ...props
}: ModiffMenuSurfaceProps) {
  return (
    <MenuItems
      {...props}
      anchor={anchor as MenuItemsProps['anchor']}
      portal={portal}
      modal={modal}
      className={cx(
        'mt-1 min-w-44 rounded-modiff-panel border border-modiff-border-subtle bg-modiff-surface p-1 font-sans text-modiff-control text-modiff-text shadow-modiff-panel outline-none',
        layer === 'graph' ? 'z-[110]' : 'z-[100]',
        className,
      )}
    >
      {children}
    </MenuItems>
  );
}

export type ModiffMenuActionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: ReactNode;
  icon?: ReactNode;
  selected?: boolean;
  tone?: ModiffActionTone;
};

export function ModiffMenuAction({
  children,
  className,
  disabled,
  icon,
  selected = false,
  tone = 'ghost',
  type = 'button',
  ...props
}: ModiffMenuActionProps) {
  return (
    <MenuItem disabled={disabled}>
      {({ focus }) => (
        <ModiffButton
          {...props}
          type={type}
          tone={tone}
          align="left"
          fullWidth
          size="normal"
          disabled={disabled}
          icon={icon}
          className={cx(
            'px-2',
            focus && 'bg-modiff-selected-surface text-hf-yellow',
            selected && 'text-hf-yellow',
            className,
          )}
        >
          {children}
        </ModiffButton>
      )}
    </MenuItem>
  );
}

export function ModiffMenuSeparator() {
  return <div className="my-1 border-t border-modiff-border" role="separator" />;
}

export function ModiffMenu({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <ModiffMenuRoot>
      <ModiffMenuTrigger>
        <ModiffButton size="dense">
          {label}
          <ChevronDown size={14} aria-hidden="true" />
        </ModiffButton>
      </ModiffMenuTrigger>
      <ModiffMenuSurface>{children}</ModiffMenuSurface>
    </ModiffMenuRoot>
  );
}

export function ModiffMenuItem({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <ModiffMenuAction icon={active ? <Check size={14} /> : <span aria-hidden="true" />} onClick={onClick}>
      {children}
    </ModiffMenuAction>
  );
}
