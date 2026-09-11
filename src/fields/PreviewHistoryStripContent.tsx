import { Clock3, Copy, Download, FileText, History, MoreHorizontal, Music2, RotateCcw } from 'lucide-react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import type { StudioOutput } from '../studio/types';
import { outputMediaSizeLabel, outputNumericInputValue } from '../studio/resolvedExecutionInputs';
import { normalizeImageArtifacts, type ImageArtifact } from '../utils/imageArtifacts';
import { enqueueSnackbar } from '../ui/snackbar';
import { GraphControlButton, GraphIconButton } from '../ui/GraphControls';
import { ModiffMenuAction, ModiffMenuRoot, ModiffMenuSurface, ModiffMenuTrigger } from '../ui/menus';
import { cx } from '../utils/classNames';
import type { PreviewHistoryStripProps } from './PreviewHistoryStrip';

function outputUrl(output: StudioOutput) {
  return output.mediaItems?.[0]?.url ?? output.url;
}

function outputType(output: StudioOutput) {
  return output.mediaItems?.[0]?.displayType ?? output.displayType ?? 'unknown';
}

function outputLabel(output: StudioOutput) {
  const type = outputType(output);
  if (type === 'image') return outputMediaSizeLabel(output) ?? 'Image';
  if (type === 'video') {
    const frames = outputNumericInputValue(output, 'numFrames');
    return frames === undefined ? 'Video' : `${frames} frames`;
  }
  if (type === 'audio') return 'Audio';
  if (type === 'text') return 'Text';
  return 'Output';
}

function outputText(output: StudioOutput) {
  return typeof output.value === 'string' ? output.value : JSON.stringify(output.value, null, 2);
}

function downloadTextOutput(output: StudioOutput) {
  const blobUrl = URL.createObjectURL(new Blob([outputText(output)], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = `modiff-${output.nodeId}-${output.fieldKey}.txt`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    enqueueSnackbar('Output URL copied', { variant: 'success', autoHideDuration: 1600 });
  } catch {
    enqueueSnackbar('Could not copy output URL', { variant: 'error', autoHideDuration: 2400 });
  }
}

export default function PreviewHistoryStripContent({
  history,
  onSelectImage,
  selectedUrl,
  audioDownloadSampleRate,
}: Pick<PreviewHistoryStripProps, 'onSelectImage' | 'selectedUrl' | 'audioDownloadSampleRate'> & {
  history: StudioOutput[];
}) {
  const restoreWorkflowFromOutput = useStudioStore((state) => state.restoreWorkflowFromOutput);
  const setLightboxOpener = useSettingsStore((state) => state.setLightboxOpener);
  const setMediaViewerOpener = useSettingsStore((state) => state.setMediaViewerOpener);
  const setMediaExportOpener = useSettingsStore((state) => state.setMediaExportOpener);
  const setRightPanelOpen = useSettingsStore((state) => state.setRightPanelOpen);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);

  const openGallery = () => {
    setRightPanelOpen(true);
    setRightPanelTab('gallery');
  };

  const openOutput = (output: StudioOutput) => {
    const type = outputType(output);
    if (type === 'image' || output.displayType === 'image_collection') {
      const images = normalizeImageArtifacts({
        value: output.mediaItems?.map((item) => item.url) ?? [output.url],
        artifacts: output.mediaItems?.map(
          (item) =>
            ({
              url: item.url,
              nodeId: output.nodeId,
              fieldKey: output.fieldKey,
              index: item.index,
              mimeType: item.contentType,
              filename: item.backendPath?.split('/').pop(),
              width: item.width,
              height: item.height,
            }) satisfies ImageArtifact,
        ),
        dataType: 'url',
        mimeType: 'image/webp',
        nodeId: output.nodeId,
        fieldKey: output.fieldKey,
      });
      setLightboxOpener({
        images: images.map((image) => image.url),
        artifacts: images,
        currentIndex: 0,
        dataType: 'url',
        mimeType: images[0]?.mimeType ?? 'image/webp',
      });
      return;
    }
    if (type === 'text' || output.displayType === 'text') {
      setMediaViewerOpener({
        title: 'Previous text render',
        currentIndex: 0,
        items: [
          {
            id: output.id,
            kind: 'text',
            label: outputLabel(output),
            text: outputText(output),
            downloadName: `modiff-${output.nodeId}-${output.fieldKey}.txt`,
          },
        ],
      });
      return;
    }
    if (type === 'video' || type === 'audio') {
      const mediaItems =
        output.mediaItems && output.mediaItems.length > 0
          ? output.mediaItems
          : [
              {
                index: 0,
                url: outputUrl(output),
                displayType: type,
              },
            ];
      setMediaViewerOpener({
        title: type === 'video' ? 'Previous video render' : 'Previous audio render',
        currentIndex: 0,
        items: mediaItems
          .filter((item) => item.url)
          .map((item, index) => ({
            id: `${output.id}:${item.index ?? index}`,
            kind: type,
            label: item.label || `${outputLabel(output)} ${mediaItems.length > 1 ? index + 1 : ''}`.trim(),
            url: item.url,
            downloadName:
              item.backendPath?.split('/').pop() ??
              `modiff-${output.nodeId}-${output.fieldKey}-${index + 1}.${type === 'video' ? 'mp4' : 'wav'}`,
          })),
      });
      return;
    }
  };

  return (
    <div className="nodrag mb-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg/80 p-2">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-modiff-subtle-text">
        <span className="inline-flex items-center gap-1 font-semibold text-modiff-text">
          <History size={13} />
          Previous
        </span>
        <GraphControlButton
          type="button"
          className="min-h-7 px-1 text-modiff-subtle-text transition hover:text-hf-yellow"
          onClick={openGallery}
        >
          Gallery
        </GraphControlButton>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {history.map((output) => {
          const type = outputType(output);
          const url = outputUrl(output);
          return (
            <div
              key={output.id}
              className="group/history relative min-w-[96px] max-w-[120px] overflow-hidden rounded-modiff-compact border border-modiff-border bg-modiff-panel"
            >
              <GraphControlButton
                type="button"
                className={cx(
                  'block h-16 w-full overflow-hidden border-2 border-transparent text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-modiff-focus',
                  selectedUrl === url && 'border-hf-yellow',
                )}
                aria-pressed={type === 'image' && onSelectImage ? selectedUrl === url : undefined}
                onClick={() => {
                  if (type === 'image' && onSelectImage) {
                    onSelectImage(url);
                  }
                  openOutput(output);
                }}
                title={`${outputLabel(output)} from ${new Date(output.createdAt).toLocaleTimeString()}`}
              >
                {type === 'image' ? (
                  <img
                    src={url}
                    alt={outputLabel(output)}
                    className="h-full w-full object-cover modiff-generated-image"
                  />
                ) : type === 'video' ? (
                  <video
                    src={url}
                    muted
                    playsInline
                    preload="metadata"
                    aria-label={outputLabel(output)}
                    className="pointer-events-none h-full w-full object-cover"
                  />
                ) : type === 'audio' ? (
                  <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-modiff-surface px-2 text-center text-xs font-semibold text-modiff-subtle-text">
                    <Music2 size={20} className="text-hf-yellow" />
                    {outputLabel(output)}
                  </span>
                ) : type === 'text' ? (
                  <span className="flex h-full w-full items-start gap-1 overflow-hidden bg-modiff-surface p-2 text-left text-xs text-modiff-subtle-text">
                    <FileText size={14} className="mt-0.5 shrink-0 text-hf-yellow" />
                    <span className="line-clamp-3">{outputText(output)}</span>
                  </span>
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-modiff-surface px-2 text-center text-xs font-semibold text-modiff-subtle-text">
                    {outputLabel(output)}
                  </span>
                )}
              </GraphControlButton>
              <div className="text-modiff-label flex items-center gap-1 border-t border-modiff-border px-1 py-1 text-modiff-subtle-text">
                <Clock3 size={11} />
                <span className="min-w-0 flex-1 truncate">{new Date(output.createdAt).toLocaleTimeString()}</span>
              </div>
              <div className="absolute right-1 top-1">
                <ModiffMenuRoot>
                  <ModiffMenuTrigger>
                    <GraphIconButton
                      label="Output actions"
                      className="border border-modiff-border bg-modiff-panel/90 hover:bg-modiff-surface hover:text-hf-yellow"
                    >
                      <MoreHorizontal size={14} />
                    </GraphIconButton>
                  </ModiffMenuTrigger>
                  <ModiffMenuSurface layer="graph" anchor="bottom end" className="min-w-44">
                    <ModiffMenuAction
                      icon={<Download size={14} />}
                      onClick={() => {
                        if (type === 'text') {
                          downloadTextOutput(output);
                          return;
                        }
                        if (type === 'video' || type === 'audio' || type === 'image') {
                          setMediaExportOpener({
                            source: url,
                            kind: type,
                            filename:
                              output.mediaItems?.[0]?.backendPath?.split('/').pop() ??
                              `modiff-${output.nodeId}-${output.fieldKey}-${output.createdAt}.${
                                type === 'audio' ? 'wav' : type === 'video' ? 'mp4' : 'webp'
                              }`,
                            title: `Download ${type}`,
                            defaultFormat: type === 'audio' ? 'wav' : type === 'video' ? 'mp4' : 'png',
                            defaultSampleRate: type === 'audio' ? audioDownloadSampleRate : undefined,
                          });
                        }
                      }}
                      disabled={type === 'unknown'}
                    >
                      Download…
                    </ModiffMenuAction>
                    <ModiffMenuAction
                      icon={<Copy size={14} />}
                      onClick={() => {
                        void copyUrl(url);
                      }}
                    >
                      Copy URL
                    </ModiffMenuAction>
                    <ModiffMenuAction icon={<RotateCcw size={14} />} onClick={() => restoreWorkflowFromOutput(output)}>
                      Restore settings
                    </ModiffMenuAction>
                  </ModiffMenuSurface>
                </ModiffMenuRoot>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
