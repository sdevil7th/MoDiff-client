import { Download, MoreVertical } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FieldProps } from '../components/NodeContent';
import { FieldFrame } from '../ui/FieldFrame';
import { PreviewEmptyState, PreviewMediaFrame } from '../ui/PreviewFrame';
import { PreviewHistoryStrip } from './PreviewHistoryStrip';
import { resolveStudioAudioUrl } from '../studio/outputUtils';
import { userBlockPreviewSource } from '../studio/userBlocks';
import { GraphIconButton } from '../ui/GraphControls';
import {
  ModiffMenuAction,
  ModiffMenuRoot,
  ModiffMenuSeparator,
  ModiffMenuSurface,
  ModiffMenuTrigger,
} from '../ui/menus';
import { mediaDownloadName, requiresSeekableAudioBuffer } from '../utils/mediaDownload';
import { useFlowStore } from '../stores/useFlowStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { requestBlob } from '../utils/requestJson';
import { useCurrentStudioPreview } from '../studio/previewState';

function resolveAudio(value: unknown, nodeId: string, fieldKey: string): string | null {
  if (!value || typeof value !== 'string') return null;
  return resolveStudioAudioUrl(value, nodeId, fieldKey);
}

function SeekableAudioPlayer({ source, downloadSampleRate }: { source: string; downloadSampleRate?: number | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackSource, setPlaybackSource] = useState<string | null>(
    requiresSeekableAudioBuffer(source) ? null : source,
  );
  const [playbackRate, setPlaybackRate] = useState(1);
  const setMediaExportOpener = useSettingsStore((state) => state.setMediaExportOpener);

  useEffect(() => {
    if (!requiresSeekableAudioBuffer(source)) {
      setPlaybackSource(source);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;
    setPlaybackSource(null);

    void requestBlob(source, { signal: controller.signal })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPlaybackSource(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          // Preserve playback on older or remote backends even if buffering
          // fails; range-capable backends can still seek this direct source.
          setPlaybackSource(source);
        }
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);

  const stopGraphInteraction = (event: React.SyntheticEvent) => event.stopPropagation();
  const changePlaybackRate = (nextRate: number) => {
    setPlaybackRate(nextRate);
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  };
  const openDownload = () =>
    setMediaExportOpener({
      source,
      kind: 'audio',
      filename: mediaDownloadName(source, 'MoDiff-audio.wav'),
      title: 'Download audio',
      defaultFormat: 'wav',
      defaultSampleRate: downloadSampleRate,
    });

  return (
    <div className="nodrag nopan nowheel relative min-w-80">
      <audio
        ref={audioRef}
        controls
        controlsList="nodownload noplaybackrate noremoteplayback"
        preload="metadata"
        src={playbackSource ?? undefined}
        aria-busy={playbackSource === null}
        className="modiff-audio-player w-full"
        onClick={stopGraphInteraction}
        onMouseDown={stopGraphInteraction}
        onPointerDown={stopGraphInteraction}
        onTouchStart={stopGraphInteraction}
      />
      <div className="absolute right-2 top-1/2 z-10 -translate-y-1/2">
        <ModiffMenuRoot>
          <ModiffMenuTrigger>
            <GraphIconButton
              label="Audio actions"
              isRound
              className="bg-modiff-surface/90 text-modiff-text hover:bg-modiff-selected-surface hover:text-hf-yellow"
            >
              <MoreVertical size={17} />
            </GraphIconButton>
          </ModiffMenuTrigger>
          <ModiffMenuSurface layer="graph" anchor="bottom end" className="min-w-48">
            <ModiffMenuAction icon={<Download size={14} />} onClick={openDownload}>
              Download…
            </ModiffMenuAction>
            <ModiffMenuSeparator />
            {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
              <ModiffMenuAction key={rate} selected={playbackRate === rate} onClick={() => changePlaybackRate(rate)}>
                Playback {rate}×
              </ModiffMenuAction>
            ))}
          </ModiffMenuSurface>
        </ModiffMenuRoot>
      </div>
    </div>
  );
}

export default function UIAudioField(props: FieldProps) {
  const compactPreview = props.fieldOptions?.compactPreview === true;
  const previewSource = userBlockPreviewSource(props.nodeId, props.fieldKey, props.fieldOptions);
  const currentPreview = useCurrentStudioPreview(previewSource.nodeId, previewSource.fieldKey);
  const downloadSampleRate = useFlowStore((state) => {
    const node = state.nodes.find((candidate) => candidate.id === previewSource.nodeId);
    const value = node?.data.params.sample_rate?.value ?? node?.data.params.sample_rate?.default;
    const sampleRate = Number(value);
    return [44100, 48000, 88200, 96000].includes(sampleRate) ? sampleRate : null;
  });
  const previewValue = currentPreview.hasAuthority ? currentPreview.value : props.value;
  const audioValues = Array.isArray(previewValue)
    ? previewValue.map((value) => resolveAudio(value, previewSource.nodeId, previewSource.fieldKey))
    : [resolveAudio(previewValue, previewSource.nodeId, previewSource.fieldKey)];
  const audios = audioValues.filter((audio): audio is string => Boolean(audio));
  const statusMessage =
    currentPreview.statusMessage || (typeof props.uiStateMessage === 'string' ? props.uiStateMessage : '');
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
      {audios.length === 0 ? (
        <PreviewEmptyState
          compact={compactPreview}
          kind="audio"
          message={emptyMessage}
          testId={`node-preview-empty-${props.nodeId}-${props.fieldKey}`}
        />
      ) : (
        audios.map((audio, index) => {
          return (
            <PreviewMediaFrame
              compact={compactPreview}
              key={`${audio}-${index}`}
              kind="audio"
              className="p-2"
              testId={`node-preview-audio-${props.nodeId}-${props.fieldKey}-${index}`}
            >
              <SeekableAudioPlayer source={audio} downloadSampleRate={downloadSampleRate} />
            </PreviewMediaFrame>
          );
        })
      )}
      <PreviewHistoryStrip
        nodeId={previewSource.nodeId}
        fieldKey={previewSource.fieldKey}
        currentUrls={audios}
        audioDownloadSampleRate={downloadSampleRate}
      />
    </FieldFrame>
  );
}
