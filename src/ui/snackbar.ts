import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export type SnackbarKey = string | number;
export type SnackbarVariant = 'default' | 'error' | 'success' | 'warning' | 'info';

export type SnackbarOptions = {
  key?: SnackbarKey;
  variant?: SnackbarVariant;
  autoHideDuration?: number | null;
  persist?: boolean;
};

export type ToastItem = {
  id: string;
  message: ReactNode;
  variant: SnackbarVariant;
  autoHideDuration: number | null;
  persist: boolean;
};

export type SnackbarApi = {
  enqueueSnackbar: typeof enqueueSnackbar;
  closeSnackbar: typeof closeSnackbar;
};

const DEFAULT_AUTO_HIDE_DURATION = 5000;
const MAX_TOASTS = 10;

let toastCounter = 0;
let toastItems: ToastItem[] = [];
const toastListeners = new Set<(items: ToastItem[]) => void>();

function publishToasts() {
  const nextItems = [...toastItems];
  toastListeners.forEach((listener) => listener(nextItems));
}

export function getToastItems() {
  return [...toastItems];
}

export function subscribeToasts(listener: (items: ToastItem[]) => void) {
  toastListeners.add(listener);
  listener(getToastItems());
  return () => toastListeners.delete(listener);
}

export function enqueueSnackbar(message: ReactNode, options: SnackbarOptions = {}) {
  const variant = options.variant ?? 'default';
  const id = String(options.key ?? `modiff-snackbar-${Date.now()}-${(toastCounter += 1)}`);
  const persist = options.persist ?? false;
  const autoHideDuration = persist ? null : (options.autoHideDuration ?? DEFAULT_AUTO_HIDE_DURATION);
  const isDuplicate = toastItems.some((item) => item.message === message && item.variant === variant);

  if (isDuplicate) return id;

  toastItems = [
    ...toastItems.filter((item) => item.id !== id),
    { id, message, variant, autoHideDuration, persist },
  ].slice(-MAX_TOASTS);
  publishToasts();
  return id;
}

export function closeSnackbar(key?: SnackbarKey) {
  toastItems = key === undefined ? [] : toastItems.filter((item) => item.id !== String(key));
  publishToasts();
}

export const SnackbarContext = createContext<SnackbarApi>({
  enqueueSnackbar,
  closeSnackbar,
});

export function useSnackbar() {
  return useContext(SnackbarContext);
}
