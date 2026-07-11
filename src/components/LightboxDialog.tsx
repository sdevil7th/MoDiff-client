import { useEffect, useMemo, useState, type ReactNode, type SyntheticEvent } from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, ExternalLink, X } from 'lucide-react';
import type { LightboxOpener } from '../stores/useSettingsStore';
import { enqueueSnackbar } from '../ui/snackbar';
import { cx } from '../utils/classNames';
import { downloadImageArtifact, normalizeImageArtifacts } from '../utils/imageArtifacts';

function LightboxDialog({ opener, onClose }: { opener: LightboxOpener; onClose: () => void }) {
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

  useEffect(() => {
    setLbIndex(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    if (!opener) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowLeft') {
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
    e.currentTarget.src =
      "data:image/svg+xml;utf8,<svg width='512' height='512' xmlns='http://www.w3.org/2000/svg'><defs><pattern id='checker' width='32' height='32' patternUnits='userSpaceOnUse'><rect width='32' height='32' fill='%23ffffff11'/><rect x='0' y='0' width='16' height='16' fill='%23ffffff33'/><rect x='16' y='16' width='16' height='16' fill='%23ffffff33'/></pattern></defs><rect width='512' height='512' fill='url(%23checker)'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='24' fill='%23FAFAFA' font-family='IBM Plex Mono, monospace'>Image not found</text></svg>";
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-black/85"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden px-4 py-8"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
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
        <div className="nodrag absolute right-4 top-4 flex gap-1 rounded-modiff-compact border border-modiff-border bg-modiff-panel/90 p-1 text-modiff-text shadow-modiff-panel">
          <LightboxActionButton
            label="Download image"
            onClick={() => {
              void downloadImageArtifact(currentImage);
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
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-modiff-compact border border-modiff-border bg-modiff-panel/90 px-3 py-1 text-sm font-semibold text-modiff-muted shadow-modiff-panel">
          {images.length > 1 ? `${lbIndex + 1}/${images.length}` : 'Image'}
          {dimensions[lbIndex] ? ` | ${dimensions[lbIndex]}` : ''}
        </div>
      </div>
      {images.length > 1 && (
        <div
          className="flex h-32 w-full flex-none items-center justify-center gap-2 overflow-x-auto overflow-y-hidden bg-modiff-panel/90 p-3"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
        >
          {images.map((image, index) => (
            <button
              key={`${image}-${index}`}
              type="button"
              aria-label={`Show image ${index + 1}`}
              onClick={() => setLbIndex(index)}
              className={cx(
                'h-full flex-none border-2 border-transparent p-0 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow',
                lbIndex === index && 'border-hf-yellow',
              )}
            >
              <img
                src={image.url}
                alt={`Image ${index + 1}`}
                className="modiff-generated-image block h-full w-auto object-contain"
                onError={handleOnError}
              />
            </button>
          ))}
        </div>
      )}
    </div>
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
    <button
      type="button"
      className="grid size-10 place-items-center rounded-modiff-compact text-modiff-muted transition hover:bg-modiff-surface hover:text-hf-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
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
    <button
      type="button"
      className={cx(
        'nodrag absolute top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-modiff-compact border border-modiff-border bg-modiff-panel/80 text-modiff-muted shadow-modiff-panel transition hover:bg-modiff-surface hover:text-hf-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow',
        side === 'left' ? 'left-4' : 'right-4',
      )}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

export default LightboxDialog;
