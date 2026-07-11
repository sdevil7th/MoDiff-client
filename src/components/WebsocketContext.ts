import { createContext } from 'react';
import type { WebsocketState } from '../stores/useWebsocketStore';

export const WebsocketContext = createContext<WebsocketState | null>(null);
