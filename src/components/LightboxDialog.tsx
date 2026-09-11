// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
  type TouchEvent,
} from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, ExternalLink, X } from 'lucide-react';
import { useSettingsStore, type LightboxOpener } from '../stores/useSettingsStore';
import { enqueueSnackbar } from '../ui/snackbar';
import { cx } from '../utils/classNames';
import { normalizeImageArtifacts } from '../utils/imageArtifacts';
import { MEDIA_PLACEHOLDER_DATA_URL } from '../utils/mediaViewer';
import { ModiffButton, ModiffDialog, ModiffIconButton } from '../ui';
import { ImageCompareFrame } from '../ui/ImageCompareFrame';

function LightboxDialog({ opener, onClose }: { opener: LightboxOpener; onClose: () => void }) {
  const setMediaExportOpener = useSettingsStore((state) => state.setMediaExportOpener);
  const sourceImages = useMemo(() => {
    const images = opener && !Array.isArray(opener.images) ? [opener.images] : opener?.images || [];
    return images.filter((image) => image !== '' && image !== null && image !== undefined);
  }, [opener]);

  const images = useMemo(
    () =>
      normalizeImageArtifacts({
        value: sourceImages,
        artifacts: opener?.artifacts,
        dataType: opener?.dataType ?? 'url',
        mimeType: opener?.mimeType || 'image/webp',
      }),
    [opener?.artifacts, opener?.dataType, opener?.mimeType, sourceImages],
  );

  const initialIndex = opener ? Math.min(Math.max(opener.currentIndex, 0), Math.max(images.length - 1, 0)) : 0;
  const [lbIndex, setLbIndex] = useState<number>(initialIndex);
  const [dimensions, setDimensions] = useState<Record<number, string>>({});
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDraggingComparison, setIsDraggingComparison] = useState(false);
  const comparisonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLbIndex(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    const stopDragging = () => setIsDraggingComparison(false);
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('touchend', stopDragging);
    return () => {
      window.removeEventListener('mouseup', stopDragging);
      window.removeEventListener('touchend', stopDragging);
    };
  }, []);

  const moveComparison = useCallback((clientX: number) => {
    const rect = comparisonRef.current?.getBoundingClientRect();
    if (!rect?.width) return;
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setSliderPosition((x / rect.width) * 100);
  }, []);

  useEffect(() => {
    if (!opener) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setLbIndex((prev) => (prev - 1 + images.length) % images.length);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setLbIndex((prev) => (prev + 1) % images.length);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [images.length, onClose, opener]);

  const handleOnError = (e: SyntheticEvent<HTMLImageElement, Event>) => {
    e.currentTarget.src = MEDIA_PLACEHOLDER_DATA_URL;
  };

  if (!opener || images.length === 0) return null;

  const currentImage = images[lbIndex] ?? images[0];
  if (!currentImage) return null;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(currentImage.url);
      enqueueSnackbar('Image URL copied', { variant: 'success', autoHideDuration: 1600 });
    } catch {
      enqueueSnackbar('Could not copy image URL', { variant: 'error', autoHideDuration: 2400 });
    }
  };

  return (
    <ModiffDialog
      open
      onClose={onClose}
      title={
        opener.comparison
          ? 'A/B image comparison'
          : images.length > 1
            ? `Image ${lbIndex + 1} of ${images.length}`
            : 'Image preview'
      }
      panelClassName="flex h-[96vh] max-h-none max-w-[96vw] flex-col bg-modiff-media-backdrop/85"
      bodyClassName="!max-h-none min-h-0 flex-1 !p-0"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div
          className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden px-4 py-8"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          {opener.comparison ? (
            <ImageCompareFrame
              ref={comparisonRef}
              imageFrom={opener.comparison.beforeUrl}
              imageTo={currentImage.url}
              beforeLabel={opener.comparison.beforeLabel}
              afterLabel={opener.comparison.afterLabel}
              sliderPosition={sliderPosition}
              onSliderPositionChange={setSliderPosition}
              onError={handleOnError}
              className="max-h-full max-w-full border-[16px] border-modiff-bg bg-modiff-bg"
              onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
                event.stopPropagation();
                setIsDraggingComparison(true);
                moveComparison(event.clientX);
              }}
              onMouseMove={(event: MouseEvent<HTMLDivElement>) => {
                if (isDraggingComparison) moveComparison(event.clientX);
              }}
              onMouseUp={() => setIsDraggingComparison(false)}
              onTouchStart={(event: TouchEvent<HTMLDivElement>) => {
                event.stopPropagation();
                setIsDraggingComparison(true);
                moveComparison(event.touches[0]?.clientX ?? 0);
              }}
              onTouchMove={(event: TouchEvent<HTMLDivElement>) => {
                if (isDraggingComparison) moveComparison(event.touches[0]?.clientX ?? 0);
              }}
              onTouchEnd={() => setIsDraggingComparison(false)}
            />
          ) : (
            <img
              src={currentImage.url}
              alt={`Image ${lbIndex + 1}`}
              className="modiff-generated-image block max-h-full max-w-full border-[16px] border-modiff-bg bg-modiff-bg object-contain"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onError={handleOnError}
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalWidth && naturalHeight) {
                  setDimensions((current) => ({ ...current, [lbIndex]: `${naturalWidth}x${naturalHeight}` }));
                }
              }}
            />
          )}
          <div className="nodrag absolute right-4 top-4 flex gap-1 rounded-modiff-compact border border-modiff-border bg-modiff-panel/90 p-1 text-modiff-text shadow-modiff-panel">
            <LightboxActionButton
              label="Download image as…"
              onClick={() => {
                setMediaExportOpener({
                  source: currentImage.url,
                  filename: currentImage.filename || 'MoDiff-image.png',
                  kind: 'image',
                  defaultFormat: 'png',
                  title: 'Download image',
                });
              }}
            >
              <Download size={18} />
            </LightboxActionButton>
            <LightboxActionButton
              label="Copy image URL"
              onClick={() => {
                void handleCopyUrl();
              }}
            >
              <Copy size={18} />
            </LightboxActionButton>
            <LightboxActionButton
              label="Open full size"
              onClick={() => window.open(currentImage.url, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink size={18} />
            </LightboxActionButton>
            <LightboxActionButton label="Close preview" onClick={onClose}>
              <X size={20} />
            </LightboxActionButton>
          </div>
          {images.length > 1 && (
            <>
              <LightboxNavButton
                label="Previous image"
                side="left"
                onClick={() => setLbIndex((prev) => (prev - 1 + images.length) % images.length)}
              >
                <ChevronLeft size={28} />
              </LightboxNavButton>
              <LightboxNavButton
                label="Next image"
                side="right"
                onClick={() => setLbIndex((prev) => (prev + 1) % images.length)}
              >
                <ChevronRight size={28} />
              </LightboxNavButton>
            </>
          )}
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-modiff-compact border border-modiff-border bg-modiff-panel/90 px-3 py-1 text-sm font-semibold text-modiff-subtle-text shadow-modiff-panel">
            {images.length > 1 ? `${lbIndex + 1}/${images.length}` : 'Image'}
            {dimensions[lbIndex] ? ` | ${dimensions[lbIndex]}` : ''}
          </div>
        </div>
        {images.length > 1 && (
          <div className="flex h-32 w-full flex-none items-center justify-center gap-2 overflow-x-auto overflow-y-hidden bg-modiff-panel/90 p-3">
            {images.map((image, index) => (
              <ModiffButton
                key={`${image.url}-${index}`}
                tone="ghost"
                aria-label={`Show image ${index + 1}`}
                onClick={() => setLbIndex(index)}
                className={cx(
                  'h-full flex-none border-2 border-transparent p-0',
                  lbIndex === index && 'border-hf-yellow',
                )}
              >
                <img
                  src={image.url}
                  alt={`Image ${index + 1}`}
                  className="modiff-generated-image block h-full w-auto object-contain"
                  onError={handleOnError}
                />
              </ModiffButton>
            ))}
          </div>
        )}
      </div>
    </ModiffDialog>
  );
}

function LightboxActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <ModiffIconButton
      label={label}
      size="prominent"
      className="text-modiff-subtle-text hover:bg-modiff-surface-hover hover:text-hf-yellow"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </ModiffIconButton>
  );
}

function LightboxNavButton({
  label,
  side,
  onClick,
  children,
}: {
  label: string;
  side: 'left' | 'right';
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <ModiffIconButton
      label={label}
      size="prominent"
      className={cx(
        'nodrag absolute top-1/2 size-12 -translate-y-1/2 border border-modiff-border bg-modiff-panel/80 text-modiff-subtle-text shadow-modiff-panel hover:bg-modiff-surface-hover hover:text-hf-yellow',
        side === 'left' ? 'left-4' : 'right-4',
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </ModiffIconButton>
  );
}

export default LightboxDialog;
