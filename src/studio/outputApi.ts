import config from '../../app.config';
import { isRecord, parseBackendOutputsResponse, type BackendOutputsResponse } from './outputContracts';
import type { StudioOutput } from './types';
import { requestJson, RequestError } from '../utils/requestJson';

function parseOutputsResponse(value: unknown, url: string, fallbackMessage: string) {
  if (!isRecord(value) || !Array.isArray(value.outputs)) {
    throw new Error('The Studio output response has no outputs array.');
  }
  const data = parseBackendOutputsResponse(value);
  if (data.error) {
    throw new RequestError(data.message || fallbackMessage, {
      kind: 'application',
      url,
      payload: value,
    });
  }
  if ((data.outputs?.length ?? 0) !== value.outputs.length) {
    throw new Error('The Studio output response contains an invalid output.');
  }
  if (Array.isArray(value.previewSlots) && data.previewSlots.length !== value.previewSlots.length) {
    throw new Error('The Studio output response contains an invalid preview state.');
  }
  return data;
}

function outputRequest(
  path: string,
  fallbackMessage: string,
  init: Omit<RequestInit, 'signal'> = {},
  signal?: AbortSignal,
) {
  const url = `${config.serverAddress}${path}`;
  return requestJson<BackendOutputsResponse>(url, {
    ...init,
    signal,
    parse: (value) => parseOutputsResponse(value, url, fallbackMessage),
  });
}

export function fetchStudioOutputs(signal?: AbortSignal) {
  return outputRequest('/studio_outputs?limit=80', 'Could not load Studio output history.', {}, signal);
}

export function syncStudioOutput(output: StudioOutput & { image_data?: string }) {
  return outputRequest('/studio_outputs', 'Could not sync Studio output history.', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outputs: [output] }),
  });
}

export function setStudioOutputFavorite(id: string, favorite: boolean) {
  return outputRequest(`/studio_outputs/${encodeURIComponent(id)}`, 'Could not update the Studio output.', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorite }),
  });
}

export function deleteStudioOutput(id: string) {
  return outputRequest(`/studio_outputs/${encodeURIComponent(id)}`, 'Could not delete the Studio output.', {
    method: 'DELETE',
  });
}
