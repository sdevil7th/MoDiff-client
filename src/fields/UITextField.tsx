// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { FieldProps } from '../components/NodeContent';
import { FieldFrame } from '../ui/FieldFrame';
import { PreviewEmptyState, PreviewMediaFrame } from '../ui/PreviewFrame';
import { PreviewHistoryStrip } from './PreviewHistoryStrip';
import { userBlockPreviewSource } from '../studio/userBlocks';
import { useCurrentStudioPreview } from '../studio/previewState';

export default function UITextField(props: FieldProps) {
  const compactPreview = props.fieldOptions?.compactPreview === true;
  const previewSource = userBlockPreviewSource(props.nodeId, props.fieldKey, props.fieldOptions);
  const currentPreview = useCurrentStudioPreview(previewSource.nodeId, previewSource.fieldKey);
  const previewValue = currentPreview.hasAuthority ? currentPreview.value : props.value;
  const hasValue = previewValue !== null && previewValue !== undefined && previewValue !== '';
  const value = hasValue
    ? typeof previewValue === 'string'
      ? previewValue
      : JSON.stringify(previewValue, null, 2)
    : '';
  const statusMessage =
    currentPreview.statusMessage || (typeof props.uiStateMessage === 'string' ? props.uiStateMessage : '');
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
      {hasValue ? (
        <PreviewMediaFrame
          compact={compactPreview}
          kind="text"
          className="items-start justify-start p-2"
          testId={`node-preview-text-${props.nodeId}-${props.fieldKey}`}
        >
          <pre className="max-h-full w-full overflow-auto whitespace-pre-wrap break-words text-xs text-modiff-subtle-text">
            <code>{value}</code>
          </pre>
        </PreviewMediaFrame>
      ) : (
        <PreviewEmptyState
          compact={compactPreview}
          kind="text"
          message={emptyMessage}
          testId={`node-preview-empty-${props.nodeId}-${props.fieldKey}`}
        />
      )}
      <PreviewHistoryStrip nodeId={previewSource.nodeId} fieldKey={previewSource.fieldKey} currentUrls={[]} />
    </FieldFrame>
  );
}
