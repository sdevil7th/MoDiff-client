// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import type { MouseEvent, ReactNode, SyntheticEvent, TouchEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Columns2, Copy, Download, ExternalLink, Image as ImageIcon, Maximize2 } from 'lucide-react';
import { FieldProps } from '../components/NodeContent';
import { useFlowStore } from '../stores/useFlowStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { graphImageSources } from '../studio/imageComparison';
import { FieldFrame } from '../ui/FieldFrame';
import { ImageCompareFrame } from '../ui/ImageCompareFrame';
import { PreviewEmptyState, PreviewMediaFrame } from '../ui/PreviewFrame';
import { ModiffSelect } from '../ui/controls';
import { enqueueSnackbar } from '../ui/snackbar';
import { GraphControlButton, GraphIconButton } from '../ui/GraphControls';
import { cx } from '../utils/classNames';
import { normalizeImageArtifacts, sanitizeImageArtifactUrl } from '../utils/imageArtifacts';
import { PreviewHistoryStrip } from './PreviewHistoryStrip';
import { userBlockPreviewSource } from '../studio/userBlocks';
import { useCurrentStudioPreview } from '../studio/previewState';

export default function UIImageField(props: FieldProps) {
  const { setLightboxOpener, setMediaExportOpener } = useSettingsStore();
  const [dimensions, setDimensions] = useState<Record<number, string>>({});
  const [comparisonMode, setComparisonMode] = useState(false);
  const [selectedComparisonSourceId, setSelectedComparisonSourceId] = useState('');
  const [selectedAfterUrl, setSelectedAfterUrl] = useState<string | null>(null);
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDraggingComparison, setIsDraggingComparison] = useState(false);
  const comparisonRef = useRef<HTMLDivElement>(null);
  const flowNodes = useFlowStore((state) => state.nodes);
  const flowEdges = useFlowStore((state) => state.edges);
  const mimeType = typeof props.fieldOptions?.mimeType === 'string' ? props.fieldOptions.mimeType : 'image/webp';
  const imageRendering = props.fieldOptions?.imageRendering === 'pixelated' ? 'pixelated' : 'auto';
  const previewSource = userBlockPreviewSource(props.nodeId, props.fieldKey, props.fieldOptions);
  const currentPreview = useCurrentStudioPreview(previewSource.nodeId, previewSource.fieldKey);
  const compactPreview = props.fieldOptions?.compactPreview === true;
  const images = useMemo(
    () =>
      normalizeImageArtifacts({
        value: currentPreview.hasAuthority ? currentPreview.value : props.value,
        artifacts: currentPreview.hasAuthority ? currentPreview.artifacts : props.artifacts,
        dataType: props.dataType,
        mimeType,
        nodeId: previewSource.nodeId,
        fieldKey: previewSource.fieldKey,
      }),
    [
      currentPreview.artifacts,
      currentPreview.hasAuthority,
      currentPreview.value,
      mimeType,
      previewSource.fieldKey,
      previewSource.nodeId,
      props.artifacts,
      props.dataType,
      props.value,
    ],
  );
  const comparisonSources = useMemo(
    () => graphImageSources(flowNodes, flowEdges, previewSource.nodeId),
    [flowEdges, flowNodes, previewSource.nodeId],
  );
  const availableComparisonSources = useMemo(
    () => comparisonSources.filter((source) => source.url && source.url !== selectedAfterUrl),
    [comparisonSources, selectedAfterUrl],
  );
  const selectedComparisonSource =
    availableComparisonSources.find((source) => source.id === selectedComparisonSourceId) ??
    availableComparisonSources[0] ??
    null;
  const comparisonSource = selectedComparisonSource?.url ?? null;
  const displayImages = useMemo(
    () =>
      images.map((image, index) =>
        index === 0 && selectedAfterUrl && image.url !== selectedAfterUrl ? { ...image, url: selectedAfterUrl } : image,
      ),
    [images, selectedAfterUrl],
  );
  const primaryImageUrl = images[0]?.url ?? null;
  const canCompare = Boolean(comparisonSource && displayImages[0]?.url && comparisonSource !== displayImages[0]?.url);
  const comparisonCapabilityExists = comparisonSources.length > 0;

  useEffect(() => {
    setSelectedAfterUrl(primaryImageUrl);
  }, [primaryImageUrl]);

  useEffect(() => {
    if (
      !selectedComparisonSourceId ||
      !availableComparisonSources.some((source) => source.id === selectedComparisonSourceId)
    ) {
      setSelectedComparisonSourceId(availableComparisonSources[0]?.id ?? '');
    }
  }, [availableComparisonSources, selectedComparisonSourceId]);

  useEffect(() => {
    if (!canCompare && comparisonMode) setComparisonMode(false);
  }, [canCompare, comparisonMode]);

  useEffect(() => {
    const endDrag = () => setIsDraggingComparison(false);
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('touchend', endDrag);
    return () => {
      window.removeEventListener('mouseup', endDrag);
      window.removeEventListener('touchend', endDrag);
    };
  }, []);

  const moveComparison = useCallback((clientX: number) => {
    const rect = comparisonRef.current?.getBoundingClientRect();
    if (!rect?.width) return;
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setSliderPosition((x / rect.width) * 100);
  }, []);

  const startComparisonDrag = (clientX: number) => {
    setIsDraggingComparison(true);
    moveComparison(clientX);
  };

  const handleImageClick = (index: number, forceComparison = false) => {
    if (displayImages.length > 0) {
      setLightboxOpener({
        images: displayImages.map((image) => image.url),
        artifacts: displayImages,
        currentIndex: index,
        dataType: 'url',
        mimeType,
        comparison:
          (comparisonMode || forceComparison) && index === 0 && comparisonSource
            ? {
                beforeUrl: comparisonSource,
                beforeLabel: selectedComparisonSource?.label ?? 'A · Before',
                afterLabel: 'B · After',
              }
            : undefined,
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
  const statusMessage =
    currentPreview.statusMessage || (typeof props.uiStateMessage === 'string' ? props.uiStateMessage : '');
  const currentUrls = images.map((image) => image.url);
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
      {comparisonCapabilityExists ? (
        <div
          className="nodrag mb-2 flex min-w-0 items-center justify-end gap-1"
          data-testid={`node-preview-comparison-controls-${props.nodeId}-${props.fieldKey}`}
        >
          {availableComparisonSources.length > 1 ? (
            <ModiffSelect
              aria-label="Before image source"
              className="max-w-48 flex-1"
              value={selectedComparisonSource?.id ?? ''}
              onValueChange={setSelectedComparisonSourceId}
              options={availableComparisonSources.map((source) => ({
                label: source.label,
                value: source.id,
              }))}
              placeholder="Select source"
            />
          ) : null}
          <GraphControlButton
            type="button"
            disabled={!canCompare}
            aria-pressed={comparisonMode}
            aria-label={comparisonMode ? 'Show rendered image' : 'Compare before and after'}
            title={
              canCompare
                ? comparisonMode
                  ? 'Show the selected render'
                  : 'Compare the upstream source with the selected render'
                : comparisonSource
                  ? 'A rendered output is required before comparison is available'
                  : 'A connected upstream source image is required before comparison is available'
            }
            className="inline-flex min-h-7 items-center gap-1 rounded-modiff-compact border border-modiff-border px-2 text-xs font-semibold text-modiff-subtle-text hover:bg-modiff-surface-hover hover:text-hf-yellow disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setComparisonMode((current) => !current)}
          >
            {comparisonMode ? <ImageIcon size={14} /> : <Columns2 size={14} />}
            A/B
          </GraphControlButton>
          <GraphIconButton
            label="Open full-resolution comparison"
            disabled={!canCompare}
            title={
              canCompare
                ? 'Open full-resolution comparison'
                : 'A source and rendered output are required for comparison'
            }
            onClick={() => handleImageClick(0, true)}
          >
            <Maximize2 size={14} />
          </GraphIconButton>
        </div>
      ) : null}
      {images.length === 0 ? (
        <PreviewEmptyState
          compact={compactPreview}
          message={emptyMessage}
          testId={`node-preview-empty-${props.nodeId}-${props.fieldKey}`}
        />
      ) : (
        <div className={cx(images.length > 1 ? 'grid w-full grid-cols-2 gap-2' : 'flex w-full justify-center')}>
          {displayImages.map((image, index) => (
            <PreviewMediaFrame
              key={`${image.url}-${index}`}
              className="group/image"
              compact={compactPreview}
              testId={`node-preview-image-${props.nodeId}-${props.fieldKey}-${index}`}
            >
              {comparisonMode && index === 0 && comparisonSource ? (
                <ImageCompareFrame
                  ref={comparisonRef}
                  testId={`node-preview-comparison-${props.nodeId}-${props.fieldKey}`}
                  imageFrom={comparisonSource}
                  imageTo={image.url}
                  sliderPosition={sliderPosition}
                  onSliderPositionChange={setSliderPosition}
                  onError={handleOnError}
                  onMouseDown={(event: MouseEvent<HTMLDivElement>) => startComparisonDrag(event.clientX)}
                  onMouseMove={(event: MouseEvent<HTMLDivElement>) => {
                    if (isDraggingComparison) moveComparison(event.clientX);
                  }}
                  onMouseUp={() => setIsDraggingComparison(false)}
                  onTouchStart={(event: TouchEvent<HTMLDivElement>) =>
                    startComparisonDrag(event.touches[0]?.clientX ?? 0)
                  }
                  onTouchMove={(event: TouchEvent<HTMLDivElement>) => {
                    if (isDraggingComparison) moveComparison(event.touches[0]?.clientX ?? 0);
                  }}
                  onTouchEnd={() => setIsDraggingComparison(false)}
                />
              ) : (
                <GraphControlButton
                  aria-label={`Open ${props.label} ${index + 1} full-resolution preview`}
                  className={cx(
                    'nodrag block h-full w-full cursor-zoom-in overflow-hidden border-0 bg-transparent p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-modiff-focus',
                  )}
                  onClick={() => handleImageClick(index)}
                >
                  <img
                    src={image.url}
                    alt={`${props.label} ${index + 1}`}
                    className={cx(
                      'block h-full w-full object-contain',
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
                </GraphControlButton>
              )}
              <div className="nodrag invisible absolute right-2 top-2 z-[1000] flex gap-1 rounded-modiff-compact border border-modiff-border bg-modiff-panel/90 p-1 text-modiff-text shadow-modiff-panel transition group-focus-within/image:visible group-hover/image:visible">
                <ImageActionButton
                  label={`Download ${props.label} ${index + 1}`}
                  onClick={() => {
                    setMediaExportOpener({
                      source: image.url,
                      kind: 'image',
                      filename: image.filename || `MoDiff-${props.nodeId}-${props.fieldKey}-${index + 1}.webp`,
                      title: 'Download image',
                      defaultFormat: 'png',
                    });
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
              <div className="pointer-events-none absolute bottom-2 left-2 rounded-modiff-compact bg-modiff-panel/85 px-2 py-1 text-xs font-semibold text-modiff-subtle-text">
                {displayImages.length > 1 ? `${index + 1}/${displayImages.length}` : null}
                {images.length > 1 && dimensions[index] ? ' | ' : null}
                {dimensions[index] ?? ''}
              </div>
            </PreviewMediaFrame>
          ))}
        </div>
      )}
      <PreviewHistoryStrip
        nodeId={previewSource.nodeId}
        fieldKey={previewSource.fieldKey}
        currentUrls={currentUrls}
        selectedUrl={selectedAfterUrl}
        onSelectImage={(url) => setSelectedAfterUrl(sanitizeImageArtifactUrl(url))}
      />
    </FieldFrame>
  );
}

function ImageActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <GraphIconButton label={label} className="hover:bg-modiff-surface hover:text-hf-yellow" onClick={onClick}>
      {children}
    </GraphIconButton>
  );
}
