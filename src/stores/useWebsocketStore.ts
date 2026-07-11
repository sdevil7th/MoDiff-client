import { create } from 'zustand';
import { nanoid } from 'nanoid';
import config from '../../app.config';

import { useFlowStore } from './useFlowStore';
import { useSettingsStore } from './useSettingsStore';
import { handleWebsocketMessage, parseWebsocketMessage } from './websocketMessageHandler';

export type WebsocketState = {
  address: string | null;
  sid: string | null;
  ws: WebSocket | null;
  isConnected: boolean;
  isConnecting: boolean;
  connectionTimer: NodeJS.Timeout | undefined;
  loopTimer: NodeJS.Timeout | undefined;
  reconnectAttempts: number;

  connect: () => void;
  disconnect: () => void;
  send: (message: unknown) => void;
};

export const useWebsocketStore = create<WebsocketState>((set, get) => ({
  address: null,
  sid: null,
  ws: null,
  isConnected: false,
  isConnecting: false,
  connectionTimer: undefined,
  loopTimer: undefined,
  reconnectAttempts: 0,

  connect: async () => {
    if (get().isConnecting) {
      console.info('Already connecting to websocket');
      return;
    }
    set({ isConnecting: true });

    const timeout = get().connectionTimer;
    const loopTimer = get().loopTimer;
    if (timeout) {
      clearTimeout(timeout);
      set({ connectionTimer: undefined });
    }
    if (loopTimer) {
      clearTimeout(loopTimer);
      set({ loopTimer: undefined });
    }

    const curr_ws = get().ws;
    if (curr_ws && curr_ws.readyState < WebSocket.CLOSING) {
      console.warn('Closing existing websocket before creating a new one');
      curr_ws.onclose = null;
      curr_ws.close();
      set({ sid: null, ws: null, isConnected: false });
    }

    const sid = nanoid(10);
    const address = get().address || config.serverAddress.replace('http', 'ws');
    if (!address) {
      console.error('Cannot connect to websocket: No address provided');
      return;
    }

    // Create a new WebSocket instance
    const ws = new WebSocket(`${address}/ws?sid=${sid}`);
    set({ address, ws, sid, isConnected: false });

    ws.onopen = () => {
      if (get().ws !== ws) {
        console.info('Ignoring stale websocket open');
        return;
      }
      const timeout = get().connectionTimer;
      const loopTimer = get().loopTimer;
      if (timeout) {
        clearTimeout(timeout);
        set({ connectionTimer: undefined });
      }
      if (loopTimer) {
        clearTimeout(loopTimer);
        set({ loopTimer: undefined });
      }
      set({ isConnected: true, isConnecting: false, reconnectAttempts: 0 });
      console.info('Websocket connected');
    };

    ws.onclose = () => {
      if (get().ws !== ws) {
        console.info('Ignoring stale websocket close');
        return;
      }
      set({ sid: null, ws: null, isConnected: false, isConnecting: false, connectionTimer: undefined });
      console.info('Websocket disconnected');
      // clear cache status
      useFlowStore.getState().updateCacheStatus([]);
      useSettingsStore.getState().setRunningState('one_shot');
      clearTimeout(get().connectionTimer);
      clearTimeout(get().loopTimer);
      const attempts = get().reconnectAttempts;
      const delay = 500 * 2 ** attempts + Math.random() * 1000;
      // We retry 5 times, if that fails, we try to ping the server via http
      // this is to overcome the browser's websocket backoff mechanism
      if (attempts < 5) {
        const timeout = setTimeout(() => {
          set({ reconnectAttempts: attempts + 1 });
          get().connect();
          console.info('Trying to reconnect...');
        }, delay);
        set({ connectionTimer: timeout });
      } else {
        const ping = () => {
          const request = new XMLHttpRequest();
          request.open('GET', `${config.serverAddress}/favicon.ico`, true);
          request.send();
          request.onload = () => {
            // server should be alive, try to reconnect the websocket
            get().connect();
            set({ reconnectAttempts: 0, connectionTimer: undefined });
          };
          request.onerror = () => {
            const timeout = setTimeout(
              () => {
                ping();
                console.info('Server is still offline. Trying to reconnect...');
              },
              2000 + Math.random() * 1000,
            );
            set({ connectionTimer: timeout });
          };
        };
        ping();
      }
    };

    ws.onmessage = (event) => {
      if (get().ws !== ws) {
        console.warn('Ignoring message from stale websocket');
        return;
      }
      const message = parseWebsocketMessage(event.data);
      if (!message) {
        console.warn('Ignoring invalid websocket message');
        return;
      }
      const sid = get().sid;
      handleWebsocketMessage(message, {
        sid,
        ws,
        getSid: () => get().sid,
        setSid: (nextSid) => set({ sid: nextSid }),
        setLoopTimer: (loopTimer) => set({ loopTimer }),
      });
    };
  },

  disconnect: () => {
    const timeout = get().connectionTimer;
    if (timeout) {
      clearTimeout(timeout);
    }
    const loopTimer = get().loopTimer;
    if (loopTimer) {
      clearTimeout(loopTimer);
    }

    set((state) => {
      if (state.ws) {
        state.ws.close();
      }
      return {
        sid: null,
        ws: null,
        isConnected: false,
        isConnecting: false,
        connectionTimer: undefined,
        loopTimer: undefined,
        reconnectAttempts: 0,
      };
    });
  },

  send: (message: unknown) => {
    const ws = get().ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('Websocket is not ready, cannot send message');
      return;
    }
    ws.send(JSON.stringify(message));
  },
}));
