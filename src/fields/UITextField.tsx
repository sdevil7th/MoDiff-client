import { FieldProps } from '../components/NodeContent';
import { FieldFrame } from '../ui/FieldFrame';
import { PreviewEmptyState, PreviewMediaFrame } from '../ui/PreviewFrame';
import { PreviewHistoryStrip } from './PreviewHistoryStrip';

export default function UITextField(props: FieldProps) {
  const hasValue = props.value !== null && props.value !== undefined && props.value !== '';
  const value = hasValue ? (typeof props.value === 'string' ? props.value : JSON.stringify(props.value, null, 2)) : '';
  const statusMessage = typeof props.uiStateMessage === 'string' ? props.uiStateMessage : '';
  const emptyMessage =
    statusMessage.startsWith('Waiting') || statusMessage.startsWith('Run failed')
      ? statusMessage
      : props.executionStatus === 'running'
        ? props.progressMessage || 'Waiting for this run'
        : props.executionStatus === 'failed'
          ? 'Run failed before producing new text'
          : 'No current text';
  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      layoutStyle={props.style}
      className="nowheel max-h-[75vh] overflow-auto"
    >
      <PreviewHistoryStrip nodeId={props.nodeId} fieldKey={props.fieldKey} currentUrls={[]} />
      {hasValue ? (
        <PreviewMediaFrame
          kind="text"
          className="items-start justify-start p-2"
          testId={`node-preview-text-${props.nodeId}-${props.fieldKey}`}
        >
          <pre className="max-h-full w-full overflow-auto whitespace-pre-wrap break-words text-xs text-modiff-muted">
            <code>{value}</code>
          </pre>
        </PreviewMediaFrame>
      ) : (
        <PreviewEmptyState
          kind="text"
          message={emptyMessage}
          testId={`node-preview-empty-${props.nodeId}-${props.fieldKey}`}
        />
      )}
    </FieldFrame>
  );
}
