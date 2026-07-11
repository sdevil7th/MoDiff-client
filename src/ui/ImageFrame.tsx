import type { CSSProperties } from 'react';
import { cx } from '../utils/classNames';

export type ImageFrameProps = {
  src: string;
  alt: string;
  fit?: 'contain' | 'cover';
  aspectRatio?: string;
  maxHeight?: number | string;
  selected?: boolean;
  bordered?: boolean;
  onClick?: () => void;
  className?: string;
  imgClassName?: string;
  testId?: string;
};

export function ImageFrame({
  src,
  alt,
  fit = 'contain',
  aspectRatio,
  maxHeight,
  selected = false,
  bordered = true,
  onClick,
  className,
  imgClassName,
  testId,
}: ImageFrameProps) {
  const imgStyle: CSSProperties = {};
  if (maxHeight !== undefined) imgStyle.maxHeight = maxHeight;
  if (aspectRatio !== undefined) imgStyle.aspectRatio = aspectRatio;

  return (
    <div
      data-testid={testId}
      className={cx(
        'bg-modiff-surface',
        bordered ? (selected ? 'border border-hf-yellow' : 'border border-modiff-border') : 'border border-transparent',
        className,
      )}
    >
      <img
        src={src}
        alt={alt}
        onClick={onClick}
        className={cx(
          'block w-full bg-black',
          fit === 'cover' ? 'object-cover' : 'object-contain',
          onClick && 'cursor-pointer',
          imgClassName,
        )}
        style={imgStyle}
      />
    </div>
  );
}
