import { createContext, useContext, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/classNames';

const indentClasses = ['pl-4', 'pl-8', 'pl-12', 'pl-16', 'pl-20', 'pl-24', 'pl-28', 'pl-32'] as const;
const TreePanelContext = createContext(false);

const treeOpenSurfaceClasses = [
  'bg-modiff-surface-hover/25',
  'bg-modiff-surface-hover/40',
  'bg-modiff-surface-hover/55',
  'bg-modiff-surface-hover/70',
] as const;

function indentClass(level: number) {
  return indentClasses[Math.min(Math.max(0, level), indentClasses.length - 1)];
}

function openClass(level: number) {
  return treeOpenSurfaceClasses[Math.min(Math.max(0, level), treeOpenSurfaceClasses.length - 1)];
}

export type TreeButtonRowProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  level?: number;
  open?: boolean;
};

export function TreeButtonRow({
  children,
  className,
  level = 0,
  open = false,
  type = 'button',
  ...props
}: TreeButtonRowProps) {
  const insidePanel = useContext(TreePanelContext);
  return (
    <button
      type={type}
      className={cx(
        'flex min-h-8 min-w-0 w-full items-center gap-2 overflow-hidden rounded-modiff-compact pr-2 text-left text-modiff-control text-modiff-text transition hover:bg-modiff-surface-hover active:bg-modiff-surface-pressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-modiff-focus',
        insidePanel ? 'pl-2' : indentClass(level),
        open && openClass(level),
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export type TreeStaticRowProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  level?: number;
  open?: boolean;
};

export function TreeStaticRow({ children, className, level = 0, open = false, ...props }: TreeStaticRowProps) {
  const insidePanel = useContext(TreePanelContext);
  return (
    <div
      className={cx(
        'flex min-h-8 min-w-0 w-full items-center gap-2 overflow-hidden rounded-modiff-compact pr-2 text-sm text-modiff-text',
        insidePanel ? 'pl-2' : indentClass(level),
        open && openClass(level),
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function TreeChildrenPanel({
  children,
  className,
  level = 0,
}: {
  children: ReactNode;
  className?: string;
  level?: number;
}) {
  return (
    <TreePanelContext.Provider value={true}>
      <div
        data-tree-children-level={level}
        className={cx(
          'mb-1 ml-2 mr-1 rounded-modiff-compact border-l border-dashed border-modiff-border-subtle py-1 pl-2 transition-colors hover:border-modiff-subtle-text focus-within:border-modiff-subtle-text',
          className,
        )}
      >
        {children}
      </div>
    </TreePanelContext.Provider>
  );
}
