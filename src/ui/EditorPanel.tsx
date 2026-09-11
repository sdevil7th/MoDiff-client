import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { ModiffIconButton } from './primitives';

export function EditorPanel({
  title,
  children,
  footer,
  onClose,
  testId,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  testId?: string;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={title} data-testid={testId}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-modiff-border px-3 py-2">
        <h2 className="text-sm font-semibold text-modiff-text">{title}</h2>
        <ModiffIconButton label="Close Block editor" onClick={onClose}>
          <X size={16} />
        </ModiffIconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
      {footer ? (
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-modiff-border bg-modiff-panel p-3">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
