import type { MouseEvent, SyntheticEvent, TouchEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import config from '../../app.config';
import { FieldProps } from '../components/NodeContent';
import { FieldFrame } from '../ui/FieldFrame';
import { ImageCompareFrame } from '../ui/ImageCompareFrame';
import { PreviewMediaFrame } from '../ui/PreviewFrame';

const EMPTY_IMAGE =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512'><rect width='512' height='512' fill='black'/></svg>";

function imageToSource(image: unknown, dataType: string, mimeType: string) {
  if (typeof image !== 'string') return EMPTY_IMAGE;
  if (dataType === 'url') return `${config.serverAddress}${image}`;
  if (image.slice(0, 5) !== 'data:') return `data:${mimeType};base64,${image}`;
  return image;
}

export default function UIImagecompareField(props: FieldProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mimeType = typeof props.fieldOptions?.mimeType === 'string' ? props.fieldOptions.mimeType : 'image/webp';

  const images = (!Array.isArray(props.value) ? [props.value] : props.value).filter(
    (image) => image !== '' && image !== null && image !== undefined,
  );
  const rawImageFrom = Array.isArray(images[0]) ? images[0][0] : images[0];
  const rawImageTo = Array.isArray(images[1]) ? images[1][0] : images[1];
  const imageFrom = imageToSource(rawImageFrom, props.dataType, mimeType);
  const imageTo = imageToSource(rawImageTo, props.dataType, mimeType);

  const handleOnError = (event: SyntheticEvent<HTMLImageElement, Event>) => {
    event.currentTarget.src = '/assets/modiff-icon-256.png';
  };

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = (x / rect.width) * 100;
    setSliderPosition(percent);
  }, []);

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    handleMove(event.clientX);
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    setIsDragging(true);
    handleMove(event.touches[0]?.clientX ?? 0);
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    handleMove(event.touches[0]?.clientX ?? 0);
  };

  const endDrag = () => setIsDragging(false);

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    handleMove(event.clientX);
  };

  useEffect(() => {
    const handleMouseUpGlobal = () => setIsDragging(false);
    window.addEventListener('mouseup', handleMouseUpGlobal);
    window.addEventListener('touchend', handleMouseUpGlobal);
    return () => {
      window.removeEventListener('mouseup', handleMouseUpGlobal);
      window.removeEventListener('touchend', handleMouseUpGlobal);
    };
  }, []);

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      layoutStyle={props.style}
      className="nodrag flex flex-col items-center justify-center gap-2 px-4 py-1"
    >
      <PreviewMediaFrame testId={`node-preview-compare-${props.nodeId}-${props.fieldKey}`}>
        <ImageCompareFrame
          ref={containerRef}
          imageFrom={imageFrom}
          imageTo={imageTo}
          sliderPosition={sliderPosition}
          onError={handleOnError}
          onMouseMove={handleMouseMove}
          onMouseUp={endDrag}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={endDrag}
        />
      </PreviewMediaFrame>
      <button
        type="button"
        className="whitespace-nowrap bg-modiff-panel px-3 py-1.5 text-xs font-semibold text-gray-200 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
        onClick={() => {
          setSliderPosition(sliderPosition < 50 && sliderPosition > 0 ? 0 : sliderPosition < 100 ? 100 : 0);
        }}
      >
        Toggle images
      </button>
    </FieldFrame>
  );
}
