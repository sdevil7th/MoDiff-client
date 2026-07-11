import type { ReactNode } from 'react';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { WebsocketContext } from './WebsocketContext';

export const WebsocketProvider = ({ children }: { children: ReactNode }) => {
  const store = useWebsocketStore();
  return <WebsocketContext.Provider value={store}>{children}</WebsocketContext.Provider>;
};
