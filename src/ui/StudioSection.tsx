import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { cx } from '../utils/classNames';

export type StudioSectionProps = {
  id: string;
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  level?: 0 | 1 | 2 | 3;
};

const panelSurfaceClasses: Record<NonNullable<StudioSectionProps['level']>, string> = {
  0: 'bg-white/[0.035]',
  1: 'bg-white/[0.055]',
  2: 'bg-white/[0.075]',
  3: 'bg-white/[0.095]',
};

export function StudioSection({
  action,
  children,
  className,
  defaultOpen = false,
  id,
  level = 0,
  title,
}: StudioSectionProps) {
  const storedOpen = useSettingsStore((state) => state.studioSectionOpen[id]);
  const setStudioSectionOpen = useSettingsStore((state) => state.setStudioSectionOpen);
  const initialOpen = storedOpen ?? defaultOpen;

  return (
    <Disclosure
      as="section"
      defaultOpen={initialOpen}
      className={cx('border-t border-modiff-border pt-3 first:border-t-0 first:pt-0', className)}
    >
      {({ open }) => (
        <>
          <div className={cx('mb-2 flex items-center gap-2', open && 'text-white')}>
            <DisclosureButton
              className="group inline-flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-bold text-modiff-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
              data-testid={`studio-section-toggle-${id}`}
              onClick={() => setStudioSectionOpen(id, !open)}
            >
              <ChevronRight size={15} className={cx('shrink-0 transition-transform', open && 'rotate-90')} />
              <span className="truncate">{title}</span>
            </DisclosureButton>
            {action}
          </div>
          <DisclosurePanel
            data-testid={`studio-section-panel-${id}`}
            className={cx(
              'grid gap-3 rounded-modiff-compact border border-modiff-border p-2',
              panelSurfaceClasses[level],
            )}
          >
            {children}
          </DisclosurePanel>
        </>
      )}
    </Disclosure>
  );
}
