import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, X } from 'lucide-react';
import { cx } from '../utils/classNames';
import { SnackbarContext, closeSnackbar, enqueueSnackbar, getToastItems, subscribeToasts } from './snackbar';
import type { SnackbarVariant, ToastItem } from './snackbar';
import { openRunActivity } from '../studio/runActivity';
import { useSettingsStore } from '../stores/useSettingsStore';
import { ModiffButton, ModiffIconButton } from './primitives';

export type ModiffSnackbarProviderProps = {
  children: ReactNode;
};

const variantClasses: Record<SnackbarVariant, string> = {
  default: 'border-modiff-border bg-modiff-panel text-modiff-text',
  error: 'border-modiff-invalid bg-modiff-panel text-modiff-text',
  success: 'border-modiff-green bg-modiff-panel text-modiff-text',
  warning: 'border-modiff-warning bg-modiff-panel text-modiff-text',
  info: 'border-modiff-blue bg-modiff-panel text-modiff-text',
};

export function ModiffSnackbarProvider({ children }: ModiffSnackbarProviderProps) {
  const [items, setItems] = useState<ToastItem[]>(getToastItems);
  const [mounted, setMounted] = useState(false);
  const pendingTaskId = useSettingsStore((state) => state.runActivityPendingTaskId);
  const timeoutsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    setMounted(true);
    const unsubscribe = subscribeToasts(setItems);
    const timeouts = timeoutsRef.current;

    return () => {
      unsubscribe();
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
      timeouts.clear();
    };
  }, []);

  useEffect(() => {
    timeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
    timeoutsRef.current.clear();

    items.forEach((item) => {
      if (item.persist || item.autoHideDuration === null || item.autoHideDuration <= 0) return;
      const timeout = window.setTimeout(() => closeSnackbar(item.id), item.autoHideDuration);
      timeoutsRef.current.set(item.id, timeout);
    });
  }, [items]);

  const api = useMemo(() => ({ enqueueSnackbar, closeSnackbar }), []);
  const handleDismiss = useCallback((id: string) => closeSnackbar(id), []);
  const handleToast = useCallback(
    async (item: ToastItem) => {
      if (item.action?.type === 'open_task_run') {
        await openRunActivity({
          ...item.action,
          status: item.action.outcome,
        });
      }
      handleDismiss(item.id);
    },
    [handleDismiss],
  );

  return (
    <SnackbarContext.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(40rem,calc(100vw-2rem))] flex-col items-end gap-2">
            {items.map((item) => {
              const messageLabel = typeof item.message === 'string' ? item.message : 'Notification';
              const actionPending = item.action?.taskId === pendingTaskId;
              return (
                <div
                  key={item.id}
                  role={item.variant === 'error' ? 'alert' : 'status'}
                  aria-live={item.variant === 'error' ? 'assertive' : 'polite'}
                  className={cx(
                    'pointer-events-auto isolate flex w-full items-stretch rounded-modiff-panel border opacity-100 shadow-modiff-node',
                    variantClasses[item.variant],
                  )}
                >
                  <ModiffButton
                    align="left"
                    fullWidth
                    tone="ghost"
                    loading={actionPending}
                    aria-label={
                      item.action ? `Open run details: ${messageLabel}` : `Dismiss notification: ${messageLabel}`
                    }
                    className="h-auto! min-w-0 flex-1 rounded-modiff-panel px-4 py-3 text-modiff-control text-modiff-text"
                    onClick={() => void handleToast(item)}
                  >
                    <span className="min-w-0 flex-1 break-words leading-5">{item.message}</span>
                    {item.action ? (
                      <ArrowUpRight size={16} className="mt-0.5 flex-none opacity-70" aria-hidden="true" />
                    ) : (
                      <X size={16} className="mt-0.5 flex-none opacity-70" aria-hidden="true" />
                    )}
                  </ModiffButton>
                  {item.action ? (
                    <ModiffIconButton
                      label={`Dismiss notification: ${messageLabel}`}
                      size="compact"
                      className="m-1.5 self-start text-modiff-text"
                      onClick={() => handleDismiss(item.id)}
                    >
                      <X size={15} />
                    </ModiffIconButton>
                  ) : null}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </SnackbarContext.Provider>
  );
}
