import config from '../../app.config';
import { FieldProps } from '../components/NodeContent';
import { FieldFrame } from '../ui/FieldFrame';
import { PreviewEmptyState, PreviewMediaFrame } from '../ui/PreviewFrame';
import { PreviewHistoryStrip } from './PreviewHistoryStrip';

function resolveAudio(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null;
  if (/^(?:https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith('/')) return `${config.serverAddress}${value}`;
  return `${config.serverAddress}/file?file=${encodeURIComponent(value)}`;
}

export default function UIAudioField(props: FieldProps) {
  const audioValues = Array.isArray(props.value) ? props.value.map(resolveAudio) : [resolveAudio(props.value)];
  const audios = audioValues.filter((audio): audio is string => Boolean(audio));
  const statusMessage = typeof props.uiStateMessage === 'string' ? props.uiStateMessage : '';
  const emptyMessage =
    statusMessage.startsWith('Waiting') || statusMessage.startsWith('Run failed')
      ? statusMessage
      : props.executionStatus === 'running'
        ? props.progressMessage || 'Waiting for this run'
        : props.executionStatus === 'failed'
          ? 'Run failed before producing new audio'
          : 'No current audio';

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      layoutStyle={props.style}
      className="flex flex-col gap-2"
    >
      <PreviewHistoryStrip nodeId={props.nodeId} fieldKey={props.fieldKey} currentUrls={audios} />
      {audios.length === 0 ? (
        <PreviewEmptyState
          kind="audio"
          message={emptyMessage}
          testId={`node-preview-empty-${props.nodeId}-${props.fieldKey}`}
        />
      ) : (
        audios.map((audio, index) => (
          <PreviewMediaFrame
            key={`${audio}-${index}`}
            kind="audio"
            className="p-2"
            testId={`node-preview-audio-${props.nodeId}-${props.fieldKey}-${index}`}
          >
            <audio controls src={audio} className="w-full" />
          </PreviewMediaFrame>
        ))
      )}
    </FieldFrame>
  );
}
