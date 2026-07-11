export type RequestErrorKind =
  'aborted' | 'application' | 'http' | 'invalid_json' | 'invalid_payload' | 'network' | 'timeout';

export class RequestError extends Error {
  readonly kind: RequestErrorKind;
  readonly status?: number;
  readonly url: string;
  readonly payload?: unknown;

  constructor(
    message: string,
    options: { kind: RequestErrorKind; url: string; status?: number; payload?: unknown; cause?: unknown },
  ) {
    super(message);
    if (options.cause !== undefined) {
      Object.defineProperty(this, 'cause', { configurable: true, value: options.cause });
    }
    this.name = 'RequestError';
    this.kind = options.kind;
    this.status = options.status;
    this.url = options.url;
    this.payload = options.payload;
  }
}

export type RequestOptions = Omit<RequestInit, 'signal'> & {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type RequestJsonOptions<T> = RequestOptions & {
  parse?: (value: unknown) => T;
};

function payloadMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
    if (typeof record.error === 'string' && record.error.trim()) return record.error;
  }
  return fallback;
}

export function formatRequestError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

async function requestWithResponse<T>(
  url: string,
  options: RequestOptions,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const { signal, timeoutMs = 15_000, ...init } = options;
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    forwardAbort();
  } else {
    signal?.addEventListener('abort', forwardAbort, { once: true });
  }
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await read(response);
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (controller.signal.aborted) {
      throw new RequestError(timedOut ? `Request timed out after ${timeoutMs}ms.` : 'Request was cancelled.', {
        kind: timedOut ? 'timeout' : 'aborted',
        url,
        cause: error,
      });
    }
    throw new RequestError(formatRequestError(error, 'Network request failed.'), {
      kind: 'network',
      url,
      cause: error,
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

async function readErrorPayload(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function assertBinaryResponse(response: Response, url: string) {
  if (response.ok) return;
  const payload = await readErrorPayload(response);
  const fallback =
    typeof payload === 'string' && payload.trim() ? payload : `Request failed with HTTP ${response.status}.`;
  throw new RequestError(payloadMessage(payload, fallback), {
    kind: 'http',
    status: response.status,
    url,
    payload,
  });
}

export async function requestJson<T = unknown>(url: string, options: RequestJsonOptions<T> = {}): Promise<T> {
  const { parse, ...requestOptions } = options;
  return requestWithResponse(url, requestOptions, async (response) => {
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch (error) {
        throw new RequestError('The server returned invalid JSON.', {
          kind: 'invalid_json',
          status: response.status,
          url,
          payload: text,
          cause: error,
        });
      }
    }
    if (!response.ok) {
      throw new RequestError(payloadMessage(payload, `Request failed with HTTP ${response.status}.`), {
        kind: 'http',
        status: response.status,
        url,
        payload,
      });
    }
    if (!parse) return payload as T;
    try {
      return parse(payload);
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError(formatRequestError(error, 'The server returned an invalid response.'), {
        kind: 'invalid_payload',
        status: response.status,
        url,
        payload,
        cause: error,
      });
    }
  });
}

export function requestBlob(url: string, options: RequestOptions = {}) {
  return requestWithResponse(url, options, async (response) => {
    await assertBinaryResponse(response, url);
    return response.blob();
  });
}

export function requestArrayBuffer(url: string, options: RequestOptions = {}) {
  return requestWithResponse(url, options, async (response) => {
    await assertBinaryResponse(response, url);
    return response.arrayBuffer();
  });
}

export type LatestRequestTicket = {
  id: number;
  signal: AbortSignal;
  finish: () => void;
  isLatest: () => boolean;
};

export function createLatestRequestGate<Key>() {
  const active = new Map<Key, { controller: AbortController; id: number }>();
  let nextId = 0;

  return {
    begin(key: Key): LatestRequestTicket {
      active.get(key)?.controller.abort(new Error('Superseded by a newer request.'));
      const controller = new AbortController();
      const id = ++nextId;
      active.set(key, { controller, id });
      return {
        id,
        signal: controller.signal,
        isLatest: () => active.get(key)?.id === id,
        finish: () => {
          if (active.get(key)?.id === id) active.delete(key);
        },
      };
    },
  };
}
