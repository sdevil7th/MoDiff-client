import type { ReactNode, SyntheticEvent } from 'react';
import { useMemo, useState } from 'react';
import { Copy, Download, ExternalLink, Maximize2 } from 'lucide-react';
import { FieldProps } from '../components/NodeContent';
import { useSettingsStore } from '../stores/useSettingsStore';
import { FieldFrame } from '../ui/FieldFrame';
import { PreviewEmptyState, PreviewMediaFrame } from '../ui/PreviewFrame';
import { enqueueSnackbar } from '../ui/snackbar';
import { cx } from '../utils/classNames';
import { downloadImageArtifact, normalizeImageArtifacts } from '../utils/imageArtifacts';
import { PreviewHistoryStrip } from './PreviewHistoryStrip';

export default function UIImageField(props: FieldProps) {
  const { setLightboxOpener } = useSettingsStore();
  const [dimensions, setDimensions] = useState<Record<number, string>>({});
  const mimeType = typeof props.fieldOptions?.mimeType === 'string' ? props.fieldOptions.mimeType : 'image/webp';
  const imageRendering = props.fieldOptions?.imageRendering === 'pixelated' ? 'pixelated' : 'auto';
  const images = useMemo(
    () =>
      normalizeImageArtifacts({
        value: props.value,
        artifacts: props.artifacts,
        dataType: props.dataType,
        mimeType,
        nodeId: props.nodeId,
        fieldKey: props.fieldKey,
      }),
    [mimeType, props.artifacts, props.dataType, props.fieldKey, props.nodeId, props.value],
  );

  const handleImageClick = (index: number) => {
    if (images.length > 0) {
      setLightboxOpener({
        images: images.map((image) => image.url),
        artifacts: images,
        currentIndex: index,
        dataType: 'url',
        mimeType,
      });
    }
  };

  const handleOnError = (event: SyntheticEvent<HTMLImageElement, Event>) => {
    event.currentTarget.src =
      "data:image/svg+xml;utf8,<svg width='512' height='512' xmlns='http://www.w3.org/2000/svg'><defs><pattern id='checker' width='32' height='32' patternUnits='userSpaceOnUse'><rect width='32' height='32' fill='%23ffffff11'/><rect x='0' y='0' width='16' height='16' fill='%23ffffff33'/><rect x='16' y='16' width='16' height='16' fill='%23ffffff33'/></pattern></defs><rect width='512' height='512' fill='url(%23checker)'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='24' fill='%23FAFAFA' font-family='IBM Plex Mono, monospace'>Image not ready</text></svg>";
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      enqueueSnackbar('Image URL copied', { variant: 'success', autoHideDuration: 1600 });
    } catch {
      enqueueSnackbar('Could not copy image URL', { variant: 'error', autoHideDuration: 2400 });
    }
  };
  const currentUrls = images.map((image) => image.url);
  const statusMessage = typeof props.uiStateMessage === 'string' ? props.uiStateMessage : '';
  const emptyMessage =
    statusMessage.startsWith('Waiting') || statusMessage.startsWith('Run failed')
      ? statusMessage
      : props.executionStatus === 'running'
        ? props.progressMessage || 'Waiting for this run'
        : props.executionStatus === 'failed'
          ? 'Run failed before producing a new image'
          : 'No current image';

  return (
    <FieldFrame dataKey={props.fieldKey} hidden={props.hidden} layoutStyle={props.style} className="w-full">
      <PreviewHistoryStrip nodeId={props.nodeId} fieldKey={props.fieldKey} currentUrls={currentUrls} />
      {images.length === 0 ? (
        <PreviewEmptyState message={emptyMessage} testId={`node-preview-empty-${props.nodeId}-${props.fieldKey}`} />
      ) : (
        <div className={cx(images.length > 1 ? 'grid w-full grid-cols-2 gap-2' : 'flex w-full justify-center')}>
          {images.map((image, index) => (
            <PreviewMediaFrame
              key={`${image.url}-${index}`}
              className="group/image"
              testId={`node-preview-image-${props.nodeId}-${props.fieldKey}-${index}`}
            >
              <img
                src={image.url}
                alt={`${props.label} ${index}`}
                className={cx(
                  'block h-full w-full object-contain p-0.5',
                  imageRendering === 'pixelated' ? 'crisp-image' : 'modiff-generated-image',
                )}
                onError={handleOnError}
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalWidth && naturalHeight) {
                    setDimensions((current) => ({ ...current, [index]: `${naturalWidth}x${naturalHeight}` }));
                  }
                }}
              />
              <div className="nodrag invisible absolute right-2 top-2 z-[1000] flex gap-1 rounded-modiff-compact border border-modiff-border bg-modiff-panel/90 p-1 text-modiff-text shadow-modiff-panel transition group-focus-within/image:visible group-hover/image:visible">
                <ImageActionButton
                  label={`Download ${props.label} ${index + 1}`}
                  onClick={() => {
                    void downloadImageArtifact(image);
                  }}
                >
                  <Download size={15} />
                </ImageActionButton>
                <ImageActionButton
                  label={`Copy ${props.label} ${index + 1} URL`}
                  onClick={() => {
                    void handleCopyUrl(image.url);
                  }}
                >
                  <Copy size={15} />
                </ImageActionButton>
                <ImageActionButton
                  label={`Open ${props.label} ${index + 1} full size`}
                  onClick={() => window.open(image.url, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink size={15} />
                </ImageActionButton>
                <ImageActionButton
                  label={`Preview ${props.label} ${index + 1}`}
                  onClick={() => handleImageClick(index)}
                >
                  <Maximize2 size={15} />
                </ImageActionButton>
              </div>
              <div className="pointer-events-none absolute bottom-2 left-2 rounded-modiff-compact bg-modiff-panel/85 px-2 py-1 text-xs font-semibold text-modiff-muted">
                {images.length > 1 ? `${index + 1}/${images.length}` : null}
                {images.length > 1 && dimensions[index] ? ' | ' : null}
                {dimensions[index] ?? ''}
              </div>
            </PreviewMediaFrame>
          ))}
        </div>
      )}
    </FieldFrame>
  );
}

function ImageActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="grid size-7 place-items-center rounded-modiff-compact text-modiff-muted transition hover:bg-modiff-surface hover:text-hf-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
