import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from '../utils/classNames';
import { SnackbarContext, closeSnackbar, enqueueSnackbar, getToastItems, subscribeToasts } from './snackbar';
import type { SnackbarVariant, ToastItem } from './snackbar';

export type ModiffSnackbarProviderProps = {
  children: ReactNode;
};

const variantClasses: Record<SnackbarVariant, string> = {
  default: 'border-modiff-border bg-modiff-panel text-modiff-text',
  error: 'border-modiff-red bg-red-950/95 text-red-50',
  success: 'border-modiff-green bg-emerald-950/95 text-emerald-50',
  warning: 'border-hf-orange bg-amber-950/95 text-amber-50',
  info: 'border-modiff-blue bg-sky-950/95 text-sky-50',
};

export function ModiffSnackbarProvider({ children }: ModiffSnackbarProviderProps) {
  const [items, setItems] = useState<ToastItem[]>(getToastItems);
  const [mounted, setMounted] = useState(false);
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

  return (
    <SnackbarContext.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(40rem,calc(100vw-2rem))] flex-col items-end gap-2">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label="Dismiss notification"
                role={item.variant === 'error' ? 'alert' : 'status'}
                className={cx(
                  'pointer-events-auto flex w-full items-start gap-3 rounded-modiff-panel border px-4 py-3 text-left text-sm shadow-modiff-node transition hover:brightness-110',
                  variantClasses[item.variant],
                )}
                onClick={() => handleDismiss(item.id)}
              >
                <span className="min-w-0 flex-1 break-words leading-5">{item.message}</span>
                <X size={16} className="mt-0.5 flex-none opacity-70" aria-hidden="true" />
              </button>
            ))}
          </div>,
          document.body,
        )}
    </SnackbarContext.Provider>
  );
}
