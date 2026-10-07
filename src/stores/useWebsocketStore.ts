// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import config from '../../app.config';

import { useFlowStore } from './useFlowStore';
import { useSettingsStore } from './useSettingsStore';
import { handleWebsocketMessage, parseWebsocketMessage } from './websocketMessageHandler';
import { requestJson } from '../utils/requestJson';
import { beginWorkerControlRead, parseWorkerControl, updateWorkerControl } from '../utils/supervisorControl';

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

export const useWebsocketStore = create<WebsocketState>((set, get) => {
  let generation = 0;
  let healthProbe: AbortController | undefined;

  const clearPendingConnectionWork = () => {
    clearTimeout(get().connectionTimer);
    clearTimeout(get().loopTimer);
    healthProbe?.abort();
    healthProbe = undefined;
    set({ connectionTimer: undefined, loopTimer: undefined });
  };

  const probeBackend = async (owner: number) => {
    if (owner !== generation) return;
    const controller = new AbortController();
    const controlRead = beginWorkerControlRead();
    healthProbe = controller;
    try {
      const address = (get().address || config.serverAddress).replace(/^ws/, 'http');
      const status = await requestJson(`${address}/health`, {
        signal: controller.signal,
        timeoutMs: 5000,
        parse: (value) => {
          if (!value || typeof value !== 'object' || !('error' in value) || !('ready' in value)) {
            throw new Error('Invalid backend health response.');
          }
          if (value.error !== false || typeof value.ready !== 'boolean') {
            throw new Error('Invalid backend health response.');
          }
          return {
            ready: value.ready,
            workerControl: parseWorkerControl('workerControl' in value ? value.workerControl : undefined),
          };
        },
      });
      if (owner !== generation || controller.signal.aborted) return;
      updateWorkerControl(status.workerControl, controlRead);
      if (!status.ready) throw new Error('The backend is still starting.');
      // Only a successful websocket handshake resets its retry budget.
      get().connect();
    } catch {
      if (owner !== generation || controller.signal.aborted) return;
      const timer = setTimeout(
        () => {
          if (owner !== generation) return;
          set({ connectionTimer: undefined });
          void probeBackend(owner);
        },
        2000 + Math.random() * 1000,
      );
      set({ connectionTimer: timer });
    } finally {
      if (healthProbe === controller) healthProbe = undefined;
    }
  };

  return {
    address: null,
    sid: null,
    ws: null,
    isConnected: false,
    isConnecting: false,
    connectionTimer: undefined,
    loopTimer: undefined,
    reconnectAttempts: 0,

    connect: () => {
      if (get().isConnecting || get().ws?.readyState === WebSocket.OPEN) {
        return;
      }
      const owner = ++generation;
      clearPendingConnectionWork();
      set({ isConnecting: true });

      const curr_ws = get().ws;
      if (curr_ws && curr_ws.readyState < WebSocket.CLOSING) {
        curr_ws.onclose = null;
        curr_ws.close();
        set({ sid: null, ws: null, isConnected: false });
      }

      const sid = nanoid(10);
      const address = get().address || config.serverAddress.replace('http', 'ws');
      if (!address) {
        console.error('Cannot connect to websocket: No address provided');
        set({ isConnecting: false });
        return;
      }

      // Create a new WebSocket instance
      const ws = new WebSocket(`${address}/ws?sid=${sid}`);
      set({ address, ws, sid, isConnected: false });

      ws.onopen = () => {
        if (owner !== generation || get().ws !== ws) {
          return;
        }
        clearPendingConnectionWork();
        set({ isConnected: true, isConnecting: false, reconnectAttempts: 0 });
        console.info('Websocket connected');
      };

      ws.onclose = () => {
        if (owner !== generation || get().ws !== ws) {
          return;
        }
        clearPendingConnectionWork();
        set({ sid: null, ws: null, isConnected: false, isConnecting: false });
        console.info('Websocket disconnected');
        // clear cache status
        useFlowStore.getState().updateCacheStatus([]);
        useSettingsStore.getState().setRunningState('one_shot');
        const attempts = get().reconnectAttempts;
        const delay = 500 * 2 ** attempts + Math.random() * 1000;
        // We retry 5 times, if that fails, we try to ping the server via http
        // this is to overcome the browser's websocket backoff mechanism
        if (attempts < 5) {
          const timeout = setTimeout(() => {
            if (owner !== generation) return;
            set({ reconnectAttempts: attempts + 1 });
            get().connect();
          }, delay);
          set({ connectionTimer: timeout });
        } else {
          void probeBackend(owner);
        }
      };

      ws.onmessage = (event) => {
        if (owner !== generation || get().ws !== ws) {
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
      generation += 1;
      clearPendingConnectionWork();
      const ws = get().ws;
      set({
        sid: null,
        ws: null,
        isConnected: false,
        isConnecting: false,
        connectionTimer: undefined,
        loopTimer: undefined,
        reconnectAttempts: 0,
      });
      if (ws) {
        ws.onopen = null;
        ws.onclose = null;
        ws.onmessage = null;
        ws.close();
      }
    },

    send: (message: unknown) => {
      const ws = get().ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('Websocket is not ready, cannot send message');
        return;
      }
      ws.send(JSON.stringify(message));
    },
  };
});
