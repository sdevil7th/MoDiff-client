import { useId } from 'react';
import { modiffColors, modiffOverlays } from '../theme';
import { cx } from '../utils/classNames';

type RangeValue = number | [number, number];

type Mark =
  | number
  | {
      label?: string;
      value: number;
    };

export type RangeSliderFrameProps = {
  className?: string;
  disabled?: boolean;
  marks?: boolean | Mark[];
  max?: number;
  min?: number;
  onChange: (value: RangeValue) => void;
  onCommit?: (value: RangeValue) => void;
  step?: number;
  value: number | number[];
};

const rangeInputClassName =
  'pointer-events-none absolute inset-x-0 top-1/2 h-4 -translate-y-1/2 appearance-none bg-transparent accent-hf-yellow disabled:opacity-40 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-hf-yellow [&::-webkit-slider-runnable-track]:h-4 [&::-webkit-slider-runnable-track]:appearance-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-hf-yellow';

function toFiniteNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeMarks(marks: boolean | Mark[] | undefined) {
  if (!Array.isArray(marks)) return [];
  return marks
    .map((mark) => (typeof mark === 'number' ? { value: mark, label: String(mark) } : mark))
    .filter((mark) => Number.isFinite(mark.value));
}

export function RangeSliderFrame({
  className,
  disabled = false,
  marks,
  max = 100,
  min = 0,
  onChange,
  onCommit,
  step,
  value,
}: RangeSliderFrameProps) {
  const datalistId = useId();
  const normalizedMarks = normalizeMarks(marks);
  const hasMarks = normalizedMarks.length > 0;
  const isDual = Array.isArray(value);
  const range = max - min || 1;
  const singleValue = clamp(toFiniteNumber(value, min), min, max);
  const lowerValue = isDual ? clamp(toFiniteNumber(value[0], min), min, max) : min;
  const upperValue = isDual ? clamp(toFiniteNumber(value[1], max), min, max) : singleValue;
  const startPercent = (((isDual ? lowerValue : min) - min) / range) * 100;
  const endPercent = ((upperValue - min) / range) * 100;
  const background = `linear-gradient(to right, ${modiffOverlays.transparentLight} 0%, ${modiffOverlays.transparentLight} ${startPercent}%, ${modiffColors.primary} ${startPercent}%, ${modiffColors.primary} ${endPercent}%, ${modiffOverlays.transparentLight} ${endPercent}%, ${modiffOverlays.transparentLight} 100%)`;
  const stepValue = step ?? 1;
  const listId = hasMarks ? datalistId : undefined;
  const commitValue = (nextValue: RangeValue) => {
    onCommit?.(nextValue);
  };

  return (
    <div className={cx('px-4 pb-1 pt-2', className)}>
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/15" />
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full" style={{ background }} />
        {isDual ? (
          <>
            <input
              type="range"
              className={rangeInputClassName}
              min={min}
              max={max}
              step={stepValue}
              value={lowerValue}
              disabled={disabled}
              list={listId}
              onChange={(event) => {
                const next = Math.min(toFiniteNumber(event.target.value, lowerValue), upperValue);
                onChange([next, upperValue]);
              }}
              onPointerUp={(event) => {
                const next = Math.min(toFiniteNumber(event.currentTarget.value, lowerValue), upperValue);
                commitValue([next, upperValue]);
              }}
              onBlur={(event) => {
                const next = Math.min(toFiniteNumber(event.currentTarget.value, lowerValue), upperValue);
                commitValue([next, upperValue]);
              }}
            />
            <input
              type="range"
              className={rangeInputClassName}
              min={min}
              max={max}
              step={stepValue}
              value={upperValue}
              disabled={disabled}
              list={listId}
              onChange={(event) => {
                const next = Math.max(toFiniteNumber(event.target.value, upperValue), lowerValue);
                onChange([lowerValue, next]);
              }}
              onPointerUp={(event) => {
                const next = Math.max(toFiniteNumber(event.currentTarget.value, upperValue), lowerValue);
                commitValue([lowerValue, next]);
              }}
              onBlur={(event) => {
                const next = Math.max(toFiniteNumber(event.currentTarget.value, upperValue), lowerValue);
                commitValue([lowerValue, next]);
              }}
            />
          </>
        ) : (
          <input
            type="range"
            className={rangeInputClassName}
            min={min}
            max={max}
            step={stepValue}
            value={singleValue}
            disabled={disabled}
            list={listId}
            onChange={(event) => onChange(toFiniteNumber(event.target.value, singleValue))}
            onPointerUp={(event) => commitValue(toFiniteNumber(event.currentTarget.value, singleValue))}
            onBlur={(event) => commitValue(toFiniteNumber(event.currentTarget.value, singleValue))}
          />
        )}
      </div>
      {hasMarks ? (
        <datalist id={datalistId}>
          {normalizedMarks.map((mark) => (
            <option key={`${mark.value}-${mark.label ?? ''}`} value={mark.value} label={mark.label} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}
