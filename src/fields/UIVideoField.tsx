// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { useEffect, useState } from 'react';
import { Download, MoreVertical } from 'lucide-react';
import { FieldProps } from '../components/NodeContent';
import { FieldFrame } from '../ui/FieldFrame';
import { PreviewHistoryStrip } from './PreviewHistoryStrip';
import { ModiffSelect } from '../ui';
import { PreviewEmptyState, PreviewMediaFrame } from '../ui/PreviewFrame';
import { resolveStudioVideoUrl } from '../studio/outputUtils';
import { clampMediaViewerIndex, compactResolvedMediaUrls } from '../utils/mediaViewer';
import { userBlockPreviewSource } from '../studio/userBlocks';
import { GraphIconButton } from '../ui/GraphControls';
import { mediaDownloadName } from '../utils/mediaDownload';
import { useSettingsStore } from '../stores/useSettingsStore';
import { ModiffMenuAction, ModiffMenuRoot, ModiffMenuSurface, ModiffMenuTrigger } from '../ui/menus';
import { useCurrentStudioPreview } from '../studio/previewState';

export default function UIVideoField(props: FieldProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const previewSource = userBlockPreviewSource(props.nodeId, props.fieldKey, props.fieldOptions);
  const currentPreview = useCurrentStudioPreview(previewSource.nodeId, previewSource.fieldKey);
  const compactPreview = props.fieldOptions?.compactPreview === true;
  const setMediaExportOpener = useSettingsStore((state) => state.setMediaExportOpener);

  const videos = compactResolvedMediaUrls(currentPreview.hasAuthority ? currentPreview.value : props.value, (video) =>
    resolveStudioVideoUrl(video, previewSource.nodeId, previewSource.fieldKey),
  );
  const activeIndex = clampMediaViewerIndex(selectedIndex, videos.length);

  useEffect(() => {
    if (selectedIndex !== activeIndex) setSelectedIndex(activeIndex);
  }, [activeIndex, selectedIndex]);

  const currentVideo = videos[activeIndex] || null;
  const statusMessage =
    currentPreview.statusMessage || (typeof props.uiStateMessage === 'string' ? props.uiStateMessage : '');
  const emptyMessage =
    statusMessage.startsWith('Waiting') || statusMessage.startsWith('Run failed')
      ? statusMessage
      : props.executionStatus === 'running'
        ? props.progressMessage || 'Waiting for this run'
        : props.executionStatus === 'failed'
          ? 'Run failed before producing a new video'
          : 'No current video';
  const openDownload = () => {
    if (!currentVideo) return;
    setMediaExportOpener({
      source: currentVideo,
      kind: 'video',
      filename: mediaDownloadName(currentVideo, `MoDiff-${props.nodeId}-${props.fieldKey}.mp4`),
      title: 'Download video',
      defaultFormat: 'mp4',
    });
  };

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      layoutStyle={props.style}
      className="flex flex-col flex-wrap items-start justify-center gap-2"
    >
      {videos.length > 1 && (
        <ModiffSelect
          value={String(activeIndex)}
          className="nodrag"
          aria-label="Preview Video"
          onValueChange={(value) => setSelectedIndex(clampMediaViewerIndex(Number(value), videos.length))}
          options={videos.map((_, index) => ({ value: String(index), label: `Video ${index + 1}` }))}
        />
      )}
      {!currentVideo ? (
        <PreviewEmptyState
          compact={compactPreview}
          message={emptyMessage}
          testId={`node-preview-empty-${props.nodeId}-${props.fieldKey}`}
        />
      ) : (
        <PreviewMediaFrame
          compact={compactPreview}
          className="group/video"
          testId={`node-preview-video-${props.nodeId}-${props.fieldKey}`}
        >
          <video
            key={activeIndex}
            src={currentVideo}
            controls
            controlsList="nodownload noremoteplayback"
            preload="metadata"
            className="nodrag nopan nowheel block h-full w-full object-contain p-0.5"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onError={(event) => {
              event.currentTarget.poster =
                "data:image/svg+xml;utf8,<svg width='512' height='512' xmlns='http://www.w3.org/2000/svg'><defs><pattern id='checker' width='32' height='32' patternUnits='userSpaceOnUse'><rect width='32' height='32' fill='%23ffffff11'/><rect x='0' y='0' width='16' height='16' fill='%23ffffff33'/><rect x='16' y='16' width='16' height='16' fill='%23ffffff33'/></pattern></defs><rect width='512' height='512' fill='url(%23checker)'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='24' fill='%23FAFAFA' font-family='IBM Plex Mono, monospace'>Video not ready</text></svg>";
            }}
            onLoadedData={(event) => {
              event.currentTarget.poster = '';
            }}
          />
          <div className="nodrag nopan absolute right-2 top-2 z-10">
            <ModiffMenuRoot>
              <ModiffMenuTrigger>
                <GraphIconButton
                  label="Video actions"
                  isRound
                  className="border border-modiff-border bg-modiff-panel/90 text-modiff-text hover:bg-modiff-surface-hover hover:text-hf-yellow"
                >
                  <MoreVertical size={17} />
                </GraphIconButton>
              </ModiffMenuTrigger>
              <ModiffMenuSurface layer="graph" anchor="bottom end" className="min-w-48">
                <ModiffMenuAction icon={<Download size={14} />} onClick={openDownload}>
                  Download…
                </ModiffMenuAction>
              </ModiffMenuSurface>
            </ModiffMenuRoot>
          </div>
        </PreviewMediaFrame>
      )}
      <PreviewHistoryStrip nodeId={previewSource.nodeId} fieldKey={previewSource.fieldKey} currentUrls={videos} />
    </FieldFrame>
  );
}
