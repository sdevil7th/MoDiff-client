import config from '../../app.config';
import { requestJson } from '../utils/requestJson';
import { coerceStudioPreviewSlot, isRecord } from './outputContracts';

type DecodeRecovery = {
  status: 'ready' | 'unavailable';
  reason?: string;
  vaeTiling: boolean | null;
  canEnableVaeTiling: boolean;
};

const retryRequests = new Set<string>();

function runUrl(taskId: string) {
  return `${config.serverAddress}/runs/${encodeURIComponent(taskId)}`;
}

export function readDecodeRecovery(taskId: string, signal: AbortSignal) {
  return requestJson<DecodeRecovery | null>(runUrl(taskId), {
    signal,
    parse: (value) => {
      if (!isRecord(value) || !isRecord(value.task) || value.task.task_id !== taskId)
        throw new Error('The run recovery response does not match the selected task.');
      if (value.recovery === undefined) return null;
      const recovery = value.recovery;
      if (
        !isRecord(recovery) ||
        recovery.kind !== 'decode' ||
        (recovery.status !== 'ready' && recovery.status !== 'unavailable') ||
        (typeof recovery.vaeTiling !== 'boolean' && recovery.vaeTiling !== null) ||
        typeof recovery.canEnableVaeTiling !== 'boolean' ||
        (recovery.reason !== undefined && typeof recovery.reason !== 'string')
      )
        throw new Error('The backend returned an invalid decode recovery option.');
      return {
        status: recovery.status,
        reason: recovery.reason,
        vaeTiling: recovery.vaeTiling,
        canEnableVaeTiling: recovery.canEnableVaeTiling,
      };
    },
  });
}

export async function retrySavedDecode(taskId: string, sid: string, enableVaeTiling: boolean) {
  if (retryRequests.has(taskId)) throw new Error('The saved decode retry is already being submitted.');
  retryRequests.add(taskId);
  try {
    return await requestJson(`${runUrl(taskId)}/retry_decode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid, ...(enableVaeTiling ? { enableVaeTiling: true } : {}) }),
      parse: (value) => {
        if (
          !isRecord(value) ||
          value.error !== false ||
          value.sid !== sid ||
          value.recoveredFromTaskId !== taskId ||
          typeof value.task_id !== 'string' ||
          !value.task_id.trim() ||
          value.task_id === taskId
        )
          throw new Error('The backend did not confirm a new decode retry for the selected task.');
        return {
          taskId: value.task_id,
          previewSlots: Array.isArray(value.preview_slots)
            ? value.preview_slots.map(coerceStudioPreviewSlot).filter((slot) => slot !== null)
            : [],
          previewStateRevision:
            typeof value.preview_state_revision === 'number' ? value.preview_state_revision : undefined,
        };
      },
    });
  } finally {
    retryRequests.delete(taskId);
  }
}
