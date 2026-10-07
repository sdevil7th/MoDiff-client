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

export function parseWorkerControl(value: unknown): WorkerControl | undefined {
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
  return { available: true, address: loopbackControlAddress(record.address) };
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
  return knownControl?.address ?? loopbackControlAddress(config.supervisorAddress);
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
