import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { readDecodeRecovery, retrySavedDecode } from '../studio/decodeRecovery';
import { useRunIssueStore } from '../stores/useRunIssueStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { IssueCard, ModiffButton, ModiffCheckbox } from '../ui';
import { formatRequestError } from '../utils/requestJson';

export default function DecodeRecoveryOption({ taskId }: { taskId: string }) {
  const [recovery, setRecovery] = useState<Awaited<ReturnType<typeof readDecodeRecovery>>>(null);
  const [submitting, setSubmitting] = useState(false);
  const [enableVaeTiling, setEnableVaeTiling] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const sid = useWebsocketStore((state) => state.sid);
  const isConnected = useWebsocketStore((state) => state.isConnected);

  useEffect(() => {
    const controller = new AbortController();
    void readDecodeRecovery(taskId, controller.signal)
      .then((details) => {
        if (!controller.signal.aborted) setRecovery(details);
      })
      .catch(() => {
        // Older or offline backends may not expose recovery for this run.
        if (!controller.signal.aborted) setRecovery(null);
      });
    return () => controller.abort();
  }, [taskId]);

  async function retry() {
    if (!sid || !isConnected || recovery?.status !== 'ready' || submitting || retryError) return;
    setSubmitting(true);
    try {
      const result = await retrySavedDecode(taskId, sid, recovery.canEnableVaeTiling && enableVaeTiling);
      const tasks = useTaskStore.getState();
      if (result.previewStateRevision !== undefined)
        useStudioStore.getState().mergePreviewState(result.previewSlots, result.previewStateRevision);
      void tasks.fetchTasks();
      const selection = useRunIssueStore.getState();
      if (selection.failureDialogOpen && selection.failure?.taskId === taskId) {
        selection.closeFailure();
        tasks.setFocusedTaskId(result.taskId);
        const settings = useSettingsStore.getState();
        settings.setRightPanelOpen(true);
        settings.setRightPanelTab('queue');
      }
    } catch (error) {
      setRetryError(formatRequestError(error, 'Could not queue the saved decode retry.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (!recovery) return null;
  return (
    <div className="mt-2" data-testid="decode-recovery-option">
      {recovery.status === 'unavailable' || retryError ? (
        <IssueCard tone="warning" title="Saved decode retry unavailable">
          <p className="break-words" role="status">
            {retryError || recovery.reason || 'A usable decode checkpoint is unavailable for this run.'}
          </p>
        </IssueCard>
      ) : (
        <IssueCard tone="info" title="Retry from the saved decode checkpoint">
          <p>
            Uses the saved denoising result and original model placement.
            {recovery.vaeTiling === true ? ' VAE tiling is already enabled.' : ''}
          </p>
          {recovery.canEnableVaeTiling && (
            <div className="mt-2">
              <ModiffCheckbox
                label="Enable VAE tiling for this retry"
                checked={enableVaeTiling}
                onCheckedChange={setEnableVaeTiling}
                disabled={submitting}
              />
            </div>
          )}
          <ModiffButton
            className="mt-2"
            icon={<RefreshCw size={15} />}
            onClick={() => void retry()}
            loading={submitting}
            disabled={!sid || !isConnected || submitting}
          >
            Retry Decode
          </ModiffButton>
        </IssueCard>
      )}
    </div>
  );
}
