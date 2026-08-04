import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Workflow, X } from 'lucide-react';

import config from '../../app.config';
import { useSettingsStore, type MediaViewerItem } from '../stores/useSettingsStore';
import { openRunActivity } from '../studio/runActivity';
import { ModiffButton, ModiffDialog, ModiffIconButton } from '../ui';
import { enqueueSnackbar } from '../ui/snackbar';
import { cx } from '../utils/classNames';
import {
  clampMediaViewerIndex,
  sanitizeMediaViewerItems,
  shouldIgnoreMediaViewerArrowTarget,
} from '../utils/mediaViewer';
import { requestBlob } from '../utils/requestJson';

function triggerDownload(url: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener noreferrer';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function downloadName(item: MediaViewerItem) {
  const extension = {
    image: 'png',
    video: 'mp4',
    audio: 'wav',
    text: 'txt',
  }[item.kind];
  const requested = item.downloadName
    ?.split(/[\\/]/)
    .pop()
    ?.split('')
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join('')
    .trim();
  return requested || `modiff-${item.kind}.${extension}`;
}

async function downloadItem(item: MediaViewerItem) {
  try {
    const blob =
      item.kind === 'text'
        ? new Blob([item.text ?? ''], { type: 'text/plain;charset=utf-8' })
        : await requestBlob(item.url ?? '');
    const objectUrl = URL.createObjectURL(blob);
    try {
      triggerDownload(objectUrl, downloadName(item));
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  } catch {
    enqueueSnackbar('Could not download output', { variant: 'error', autoHideDuration: 2400 });
  }
}

function MediaViewerAction({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <ModiffIconButton
      label={label}
      size="prominent"
      className="text-modiff-subtle-text hover:bg-modiff-surface-hover hover:text-hf-yellow"
      onClick={onClick}
    >
      {children}
    </ModiffIconButton>
  );
}

function MediaViewerContent({ item }: { item: MediaViewerItem }) {
  if (item.kind === 'video' && item.url) {
    return (
      <video
        key={item.url}
        src={item.url}
        controls
        controlsList="nodownload noremoteplayback"
        playsInline
        className="block max-h-full max-w-full bg-modiff-media-backdrop object-contain"
        data-testid="media-viewer-video"
      />
    );
  }

  if (item.kind === 'audio' && item.url) {
    return (
      <div
        className="flex w-[min(720px,90%)] flex-col items-center gap-5 rounded-modiff-compact border border-modiff-border bg-modiff-panel p-6 shadow-modiff-panel"
        data-testid="media-viewer-audio"
      >
        <div className="text-center">
          <div className="text-base font-semibold text-modiff-text">{item.label}</div>
          <div className="mt-1 text-xs text-modiff-subtle-text">Previous audio render</div>
        </div>
        <audio key={item.url} src={item.url} controls className="w-full" />
      </div>
    );
  }

  if (item.kind === 'text') {
    return (
      <pre
        className="max-h-full w-[min(900px,92%)] overflow-auto whitespace-pre-wrap break-words rounded-modiff-compact border border-modiff-border bg-modiff-panel p-5 text-sm text-modiff-text shadow-modiff-panel"
        data-testid="media-viewer-text"
      >
        <code>{item.text ?? ''}</code>
      </pre>
    );
  }

  return item.url ? (
    <img
      src={item.url}
      alt={item.label}
      className="modiff-generated-image block max-h-full max-w-full border-[12px] border-modiff-bg bg-modiff-bg object-contain"
      data-testid="media-viewer-image"
    />
  ) : null;
}

function MediaViewerThumbnail({
  active,
  item,
  onClick,
}: {
  active: boolean;
  item: MediaViewerItem;
  onClick: () => void;
}) {
  return (
    <ModiffButton
      tone="ghost"
      aria-label={`Show ${item.label}`}
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'h-20 w-28 flex-none overflow-hidden border-2 border-transparent p-0',
        active && 'border-hf-yellow',
      )}
    >
      {item.kind === 'image' && item.url ? (
        <img src={item.url} alt="" className="h-full w-full object-cover" />
      ) : item.kind === 'video' && item.url ? (
        <video src={item.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-modiff-surface px-2 text-center text-xs font-semibold text-modiff-subtle-text">
          {item.kind === 'text' ? (item.text ?? '').slice(0, 48) || 'Text' : 'Audio'}
        </span>
      )}
    </ModiffButton>
  );
}

export default function MediaViewerDialog() {
  const opener = useSettingsStore((state) => state.mediaViewerOpener);
  const setMediaViewerOpener = useSettingsStore((state) => state.setMediaViewerOpener);
  const setMediaExportOpener = useSettingsStore((state) => state.setMediaExportOpener);
  const items = useMemo(() => sanitizeMediaViewerItems(opener?.items ?? [], config.serverAddress), [opener]);
  const initialIndex = clampMediaViewerIndex(opener?.currentIndex ?? 0, items.length);
  const [index, setIndex] = useState(initialIndex);
  const activeIndex = clampMediaViewerIndex(index, items.length);
  const [openingWorkflow, setOpeningWorkflow] = useState(false);

  useEffect(() => {
    setIndex(initialIndex);
  }, [initialIndex, opener]);

  useEffect(() => {
    if (opener && items.length === 0) setMediaViewerOpener(null);
  }, [items.length, opener, setMediaViewerOpener]);

  useEffect(() => {
    if (!opener || items.length < 2) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        shouldIgnoreMediaViewerArrowTarget(event.target)
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setIndex((current) => (clampMediaViewerIndex(current, items.length) - 1 + items.length) % items.length);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setIndex((current) => (clampMediaViewerIndex(current, items.length) + 1) % items.length);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [items.length, opener]);

  if (!opener || items.length === 0) return null;
  const current = items[activeIndex] ?? items[0];
  if (!current) return null;
  const close = () => setMediaViewerOpener(null);

  const openWorkflow = async () => {
    if (!opener.workflow || openingWorkflow) return;
    setOpeningWorkflow(true);
    try {
      const result = await openRunActivity({
        ...opener.workflow,
        status: 'completed',
        preferWorkflow: true,
      });
      if (result === 'workflow') close();
      else {
        enqueueSnackbar(`Could not open ${opener.workflow.name}.`, {
          variant: 'error',
          autoHideDuration: 4000,
        });
      }
    } finally {
      setOpeningWorkflow(false);
    }
  };

  const copyCurrent = async () => {
    try {
      await navigator.clipboard.writeText(current.url ?? current.text ?? '');
      enqueueSnackbar(current.url ? 'Output URL copied' : 'Output text copied', {
        variant: 'success',
        autoHideDuration: 1600,
      });
    } catch {
      enqueueSnackbar('Could not copy output', { variant: 'error', autoHideDuration: 2400 });
    }
  };

  return (
    <ModiffDialog
      open
      onClose={close}
      title={items.length > 1 ? `${opener.title} · ${activeIndex + 1} of ${items.length}` : opener.title}
      panelClassName="flex h-[80vh] w-[82vw] max-h-[80vh] max-w-[82vw] flex-col bg-modiff-media-backdrop/95"
      bodyClassName="!max-h-none min-h-0 flex-1 !p-0"
    >
      <div className="flex h-full min-h-0 flex-col" data-testid="media-viewer-dialog">
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
          <MediaViewerContent item={current} />
          <div className="nodrag absolute right-3 top-3 flex gap-1 rounded-modiff-compact border border-modiff-border bg-modiff-panel/95 p-1 shadow-modiff-panel">
            <MediaViewerAction
              label={`Download ${current.kind}`}
              onClick={() => {
                if (current.kind === 'text') {
                  void downloadItem(current);
                  return;
                }
                if (!current.url) return;
                setMediaExportOpener({
                  source: current.url,
                  kind: current.kind,
                  filename: downloadName(current),
                  title: `Download ${current.kind}`,
                  defaultFormat: current.kind === 'audio' ? 'wav' : current.kind === 'video' ? 'mp4' : 'png',
                });
              }}
            >
              <Download size={18} />
            </MediaViewerAction>
            <MediaViewerAction label="Copy output" onClick={() => void copyCurrent()}>
              <Copy size={18} />
            </MediaViewerAction>
            {current.url ? (
              <MediaViewerAction
                label="Open output in new tab"
                onClick={() => window.open(current.url, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink size={18} />
              </MediaViewerAction>
            ) : null}
            {opener.workflow ? (
              <ModiffIconButton
                label={`Open workflow ${opener.workflow.name}`}
                size="prominent"
                disabled={openingWorkflow}
                aria-busy={openingWorkflow}
                className="text-modiff-subtle-text hover:bg-modiff-surface-hover hover:text-hf-yellow"
                onClick={() => void openWorkflow()}
              >
                <Workflow size={18} />
              </ModiffIconButton>
            ) : null}
            <MediaViewerAction label="Close media viewer" onClick={close}>
              <X size={20} />
            </MediaViewerAction>
          </div>
          {items.length > 1 ? (
            <>
              <ModiffIconButton
                label="Previous output"
                size="prominent"
                className="absolute left-4 top-1/2 size-12 -translate-y-1/2 border border-modiff-border bg-modiff-panel/90 text-modiff-subtle-text hover:text-hf-yellow"
                onClick={() =>
                  setIndex(
                    (currentIndex) =>
                      (clampMediaViewerIndex(currentIndex, items.length) - 1 + items.length) % items.length,
                  )
                }
              >
                <ChevronLeft size={28} />
              </ModiffIconButton>
              <ModiffIconButton
                label="Next output"
                size="prominent"
                className="absolute right-4 top-1/2 size-12 -translate-y-1/2 border border-modiff-border bg-modiff-panel/90 text-modiff-subtle-text hover:text-hf-yellow"
                onClick={() =>
                  setIndex((currentIndex) => (clampMediaViewerIndex(currentIndex, items.length) + 1) % items.length)
                }
              >
                <ChevronRight size={28} />
              </ModiffIconButton>
            </>
          ) : null}
        </div>
        {items.length > 1 ? (
          <div className="flex h-24 flex-none items-center justify-center gap-2 overflow-x-auto border-t border-modiff-border bg-modiff-panel/95 p-2">
            {items.map((item, itemIndex) => (
              <MediaViewerThumbnail
                key={item.id}
                active={itemIndex === activeIndex}
                item={item}
                onClick={() => setIndex(itemIndex)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </ModiffDialog>
  );
}
