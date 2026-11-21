import config from '../../app.config';

export type WorkerControl = { available: boolean; address: string | null };

let knownControl: WorkerControl | undefined;
let retryAt = 0;
let failures = 0;
let readSequence = 0;
let appliedRead = 0;

function loopbackControlAddress(value: unknown): string {
  const match =
    typeof value === 'string' && value.length <= 128
      ? /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):([0-9]+)\/?$/.exec(value)
      : null;
  if (!match) throw new Error('Invalid supervisor control address.');
  const url = new URL(match[0]);
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid supervisor control address.');
  return url.origin;
}

function loopbackEndpoint(value: unknown): { host: string; port: number; origin: string } | null {
  const match =
    typeof value === 'string' && value.length <= 128
      ? /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::([0-9]+))?\/?$/.exec(value)
      : null;
  if (!match) return null;
  const port = Number(match[2] ?? ((value as string).startsWith('https:') ? 443 : 80));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const url = new URL(value as string);
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port, origin: url.origin };
}

function advertisedBackendEndpoint(value: unknown): { host: string; port: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const server = value as Record<string, unknown>;
  if (
    !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(server.host as string) ||
    typeof server.port !== 'number' ||
    !Number.isInteger(server.port) ||
    server.port < 1 ||
    server.port > 65535 ||
    !['http', 'https'].includes(server.scheme as string)
  )
    return null;
  return { host: (server.host as string).replace(/^\[|\]$/g, ''), port: server.port };
}

function resolvedControlAddress(address: string, server: unknown, backendAddress: string): string | null {
  // A trusted explicit override is the only authority for a custom tunnel
  // mapping. Neither advertised hosts nor arbitrary port deltas can supply it.
  if (config.supervisorAddressExplicit) return loopbackControlAddress(config.supervisorAddress);
  const backend = loopbackEndpoint(backendAddress);
  const advertised = advertisedBackendEndpoint(server);
  const control = loopbackEndpoint(address);
  if (!backend || !advertised || !control) return null;
  // All accepted hosts refer to this machine. A matching backend port keeps
  // its actual custom/ephemeral control listener rather than assuming +1.
  if (backend.port === advertised.port) return address;
  if (control.host !== advertised.host || control.port !== advertised.port + 1 || backend.port === 65535) return null;
  if (backendAddress === config.backendAddress) return loopbackControlAddress(config.supervisorAddress);
  // A custom websocket endpoint is operator configuration too. Bind health
  // metadata to that endpoint, never the unrelated default backend origin.
  const target = new URL(backend.origin);
  target.protocol = 'http:';
  target.port = String(backend.port + 1);
  return loopbackControlAddress(target.origin);
}

export function parseWorkerControl(
  value: unknown,
  server?: unknown,
  backendAddress = config.backendAddress,
): WorkerControl | undefined {
  // Missing metadata belongs to older backends. It is not evidence that a
  // previously advertised supervisor disappeared during worker replacement.
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid worker control metadata.');
  const record = value as Record<string, unknown>;
  if (
    typeof record.available !== 'boolean' ||
    Object.keys(record).some((key) => !['available', 'address'].includes(key))
  )
    throw new Error('Invalid worker control metadata.');
  if (!record.available) {
    if (record.address !== null) throw new Error('Unavailable worker control must have no address.');
    return { available: false, address: null };
  }
  const address = loopbackControlAddress(record.address);
  // Older backends omit server metadata. Preserve their existing advertised
  // address behavior while new metadata can identify tunneled transports.
  return {
    available: true,
    address: server === undefined ? address : resolvedControlAddress(address, server, backendAddress),
  };
}

export function beginWorkerControlRead() {
  return ++readSequence;
}

export function updateWorkerControl(control: WorkerControl | undefined, read = beginWorkerControlRead()) {
  if (!control || read < appliedRead) return;
  appliedRead = read;
  if (control.available !== knownControl?.available || control.address !== knownControl?.address) {
    failures = 0;
    retryAt = 0;
  }
  knownControl = control;
}

export function supervisorControlCanPoll() {
  return knownControl?.available !== false;
}

type ControlDiscoveryStore = {
  getState: () => {
    discoveryRequests: { nodes: { status: string }; runtime: { status: string } };
  };
  subscribe: (listener: () => void) => () => void;
};

/** Await only discovery already owned by startup; a busy/older worker still gets legacy recovery. */
export async function waitForSupervisorMetadata(store: ControlDiscoveryStore, signal?: AbortSignal, timeoutMs = 1000) {
  if (signal?.aborted) return false;
  const initial = store.getState().discoveryRequests;
  if (knownControl || (initial.nodes.status !== 'loading' && initial.runtime.status !== 'loading')) return true;
  return new Promise<boolean>((resolve) => {
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    let settled = false;
    const finish = (proceed: boolean) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      resolve(proceed);
    };
    const cancel = () => finish(false);
    const check = () => {
      const { nodes, runtime } = store.getState().discoveryRequests;
      if (knownControl || nodes.status === 'error' || runtime.status === 'success' || runtime.status === 'error') {
        finish(true);
      }
    };
    unsubscribe = store.subscribe(check);
    if (settled) {
      unsubscribe();
      return;
    }
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => finish(true), timeoutMs);
    // Subscribe before rechecking so completion/cancellation cannot fall between reads.
    if (signal?.aborted) cancel();
    else check();
  });
}

export function supervisorControlAddress(explicitAction = false): string | null {
  if (!supervisorControlCanPoll() || (!explicitAction && Date.now() < retryAt)) return null;
  if (knownControl) {
    if (!knownControl.address) {
      throw new Error(
        'The supervisor cannot be resolved through the configured backend. Set a trusted loopback VITE_SUPERVISOR_CONTROL_ADDRESS.',
      );
    }
    return knownControl.address;
  }
  return loopbackControlAddress(config.supervisorAddress);
}

export function supervisorControlFailed() {
  failures += 1;
  retryAt = Date.now() + Math.min(5000 * 2 ** Math.min(failures - 1, 4), 60_000);
}

export function supervisorControlSucceeded() {
  failures = 0;
  retryAt = 0;
}

/** Clear process-local discovery when starting a new isolated client context. */
export function resetSupervisorControl() {
  knownControl = undefined;
  readSequence = appliedRead = 0;
  supervisorControlSucceeded();
}
