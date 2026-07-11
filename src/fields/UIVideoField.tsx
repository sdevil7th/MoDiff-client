import { useState } from 'react';
import { FieldProps } from '../components/NodeContent';
import { FieldFrame } from '../ui/FieldFrame';
import config from '../../app.config';
import { PreviewHistoryStrip } from './PreviewHistoryStrip';
import { PreviewEmptyState, PreviewMediaFrame } from '../ui/PreviewFrame';

export default function UIVideoField(props: FieldProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const processVideo = (video: unknown): string | null => {
    if (!video) return null;

    if (typeof video === 'string' && video.slice(0, 5) === 'data:') {
      return video;
    }
    return `${config.serverAddress}${video}`;
  };

  const videos: (string | null)[] = (() => {
    if (!props.value) return [];
    if (Array.isArray(props.value)) {
      return props.value.map(processVideo);
    }
    return [processVideo(props.value)];
  })();

  const currentVideo = videos[selectedIndex] || null;
  const currentUrls = videos.filter((video): video is string => Boolean(video));
  const statusMessage = typeof props.uiStateMessage === 'string' ? props.uiStateMessage : '';
  const emptyMessage =
    statusMessage.startsWith('Waiting') || statusMessage.startsWith('Run failed')
      ? statusMessage
      : props.executionStatus === 'running'
        ? props.progressMessage || 'Waiting for this run'
        : props.executionStatus === 'failed'
          ? 'Run failed before producing a new video'
          : 'No current video';

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      layoutStyle={props.style}
      className="flex flex-col flex-wrap items-start justify-center gap-2"
    >
      <PreviewHistoryStrip nodeId={props.nodeId} fieldKey={props.fieldKey} currentUrls={currentUrls} />
      {videos.length > 1 && (
        <select
          autoComplete="off"
          value={selectedIndex}
          className="nodrag h-8 border border-modiff-border bg-modiff-bg px-2 text-sm text-modiff-text focus:border-hf-yellow focus:outline-none"
          aria-label="Preview Video"
          onChange={(event) => setSelectedIndex(Number(event.target.value))}
        >
          {videos.map((_, index) => (
            <option key={index} value={index}>
              Video {index + 1}
            </option>
          ))}
        </select>
      )}
      {!currentVideo ? (
        <PreviewEmptyState message={emptyMessage} testId={`node-preview-empty-${props.nodeId}-${props.fieldKey}`} />
      ) : (
        <PreviewMediaFrame testId={`node-preview-video-${props.nodeId}-${props.fieldKey}`}>
          <video
            key={selectedIndex}
            src={currentVideo}
            controls
            className="block h-full w-full object-contain p-0.5"
            onError={(event) => {
              event.currentTarget.poster =
                "data:image/svg+xml;utf8,<svg width='512' height='512' xmlns='http://www.w3.org/2000/svg'><defs><pattern id='checker' width='32' height='32' patternUnits='userSpaceOnUse'><rect width='32' height='32' fill='%23ffffff11'/><rect x='0' y='0' width='16' height='16' fill='%23ffffff33'/><rect x='16' y='16' width='16' height='16' fill='%23ffffff33'/></pattern></defs><rect width='512' height='512' fill='url(%23checker)'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='24' fill='%23FAFAFA' font-family='IBM Plex Mono, monospace'>Video not ready</text></svg>";
            }}
            onLoadedData={(event) => {
              event.currentTarget.poster = '';
            }}
          />
        </PreviewMediaFrame>
      )}
    </FieldFrame>
  );
}
