import { Clock3, Copy, Download, ExternalLink, History, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import type { StudioOutput } from '../studio/types';
import { cx } from '../utils/classNames';
import { normalizeImageArtifacts, type ImageArtifact } from '../utils/imageArtifacts';
import { enqueueSnackbar } from '../ui/snackbar';
import { requestBlob } from '../utils/requestJson';

type PreviewHistoryStripProps = {
  nodeId: string;
  fieldKey: string;
  currentUrls?: string[];
};

function outputUrl(output: StudioOutput) {
  return output.mediaItems?.[0]?.url ?? output.url;
}

function outputType(output: StudioOutput) {
  return output.mediaItems?.[0]?.displayType ?? output.displayType ?? 'unknown';
}

function outputLabel(output: StudioOutput) {
  const type = outputType(output);
  if (type === 'image') return output.width && output.height ? `${output.width}x${output.height}` : 'Image';
  if (type === 'video') return output.formSnapshot.numFrames ? `${output.formSnapshot.numFrames} frames` : 'Video';
  if (type === 'audio') return 'Audio';
  if (type === 'text') return 'Text';
  return 'Output';
}

function openTextOutput(output: StudioOutput) {
  const text = typeof output.value === 'string' ? output.value : JSON.stringify(output.value, null, 2);
  const url = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    enqueueSnackbar('Output URL copied', { variant: 'success', autoHideDuration: 1600 });
  } catch {
    enqueueSnackbar('Could not copy output URL', { variant: 'error', autoHideDuration: 2400 });
  }
}

function triggerDownload(url: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener noreferrer';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function downloadOutput(output: StudioOutput) {
  const url = outputUrl(output);
  const filename =
    output.mediaItems?.[0]?.backendPath?.split('/').pop() ??
    `modiff-${output.nodeId}-${output.fieldKey}-${output.createdAt}`;
  try {
    const blob = await requestBlob(url);
    const objectUrl = URL.createObjectURL(blob);
    try {
      triggerDownload(objectUrl, filename);
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  } catch {
    triggerDownload(url, filename);
  }
}

export function PreviewHistoryStrip({ nodeId, fieldKey, currentUrls = [] }: PreviewHistoryStripProps) {
  const outputs = useStudioStore((state) => state.outputs);
  const activeWorkflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const currentRunContext = useStudioStore((state) => state.currentRunContext);
  const restoreWorkflowFromOutput = useStudioStore((state) => state.restoreWorkflowFromOutput);
  const setLightboxOpener = useSettingsStore((state) => state.setLightboxOpener);
  const setRightPanelOpen = useSettingsStore((state) => state.setRightPanelOpen);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);

  const currentUrlSet = useMemo(() => new Set(currentUrls), [currentUrls]);
  const history = useMemo(
    () =>
      outputs
        .filter((output) => output.nodeId === nodeId && output.fieldKey === fieldKey)
        .filter(
          (output) => !activeWorkflowTabId || !output.workflowTabId || output.workflowTabId === activeWorkflowTabId,
        )
        .filter((output) => !output.clientRunId || output.clientRunId !== currentRunContext?.clientRunId)
        .filter((output) => !currentUrlSet.has(outputUrl(output)))
        .slice(0, 6),
    [activeWorkflowTabId, currentRunContext?.clientRunId, currentUrlSet, fieldKey, nodeId, outputs],
  );

  if (history.length === 0) return null;

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
      openTextOutput(output);
      return;
    }
    window.open(outputUrl(output), '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="nodrag mb-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg/80 p-2">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-modiff-muted">
        <span className="inline-flex items-center gap-1 font-semibold text-modiff-text">
          <History size={13} />
          Previous
        </span>
        <button
          type="button"
          className="text-modiff-muted transition hover:text-hf-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
          onClick={openGallery}
        >
          Gallery
        </button>
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
              <button
                type="button"
                className="block h-16 w-full overflow-hidden text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
                onClick={() => openOutput(output)}
                title={`${outputLabel(output)} from ${new Date(output.createdAt).toLocaleTimeString()}`}
              >
                {type === 'image' ? (
                  <img
                    src={url}
                    alt={outputLabel(output)}
                    className="h-full w-full object-cover modiff-generated-image"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-modiff-surface px-2 text-center text-xs font-semibold text-modiff-muted">
                    {outputLabel(output)}
                  </span>
                )}
              </button>
              <div className="flex items-center gap-1 border-t border-modiff-border px-1 py-1 text-[11px] text-modiff-muted">
                <Clock3 size={11} />
                <span className="min-w-0 flex-1 truncate">{new Date(output.createdAt).toLocaleTimeString()}</span>
              </div>
              <div className="absolute right-1 top-1 hidden gap-1 rounded-modiff-compact border border-modiff-border bg-modiff-panel/90 p-1 group-hover/history:flex group-focus-within/history:flex">
                {[
                  {
                    label: 'Download output',
                    icon: <Download size={12} />,
                    action: () => {
                      void downloadOutput(output);
                    },
                  },
                  {
                    label: 'Copy output URL',
                    icon: <Copy size={12} />,
                    action: () => {
                      void copyUrl(url);
                    },
                  },
                  { label: 'Open output', icon: <ExternalLink size={12} />, action: () => openOutput(output) },
                  {
                    label: 'Restore settings',
                    icon: <RotateCcw size={12} />,
                    action: () => restoreWorkflowFromOutput(output),
                  },
                ].map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    aria-label={action.label}
                    title={action.label}
                    className={cx(
                      'grid size-6 place-items-center rounded-modiff-compact text-modiff-muted transition',
                      'hover:bg-modiff-surface hover:text-hf-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow',
                    )}
                    onClick={action.action}
                  >
                    {action.icon}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
