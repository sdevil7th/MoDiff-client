import config from '../../app.config';
import { requestJson, RequestError } from './requestJson';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function uploadBackendFile(file: File, type: string, signal?: AbortSignal) {
  const body = new FormData();
  body.append('file', file);
  body.append('type', type);
  const url = `${config.serverAddress}/file`;
  return requestJson<string[]>(url, {
    method: 'POST',
    body,
    signal,
    timeoutMs: 60_000,
    parse: (value) => {
      if (!isRecord(value)) throw new Error('The file upload returned an invalid response.');
      if (value.error) {
        throw new RequestError(
          typeof value.error === 'string'
            ? value.error
            : typeof value.message === 'string'
              ? value.message
              : 'Could not upload the file.',
          { kind: 'application', url, payload: value },
        );
      }
      const paths = Array.isArray(value.path) ? value.path : [value.path];
      if (paths.length === 0 || paths.some((path) => typeof path !== 'string' || !path.trim())) {
        throw new Error('The file upload response has no valid file path.');
      }
      return paths as string[];
    },
  });
}
