import { useId } from 'react';
import { cx } from '../utils/classNames';
import { useModiffFieldControl } from './fieldContext';

type RangeValue = number | [number, number];

type Mark =
  | number
  | {
      label?: string;
      value: number;
    };

export type RangeSliderFrameProps = {
  'aria-describedby'?: string;
  'aria-errormessage'?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean | 'false' | 'true';
  className?: string;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
  marks?: boolean | Mark[];
  max?: number;
  min?: number;
  onChange: (value: RangeValue) => void;
  onCommit?: (value: RangeValue) => void;
  readOnly?: boolean;
  required?: boolean;
  step?: number;
  value: number | number[];
};

const rangeInputClassName =
  'modiff-slider modiff-range-slider pointer-events-none absolute inset-x-0 top-1/2 h-4 -translate-y-1/2 bg-transparent disabled:opacity-40 focus-visible:rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-modiff-focus/35 aria-[invalid=true]:focus-visible:ring-modiff-invalid/35';

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
  'aria-describedby': ariaDescribedBy,
  'aria-errormessage': ariaErrorMessage,
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabel = 'Range',
  className,
  disabled,
  id,
  invalid,
  marks,
  max = 100,
  min = 0,
  onChange,
  onCommit,
  readOnly,
  required,
  step,
  value,
}: RangeSliderFrameProps) {
  const datalistId = useId();
  const field = useModiffFieldControl({
    ariaDescribedBy,
    ariaErrorMessage,
    disabled,
    id,
    invalid: Boolean(invalid || ariaInvalid === true || ariaInvalid === 'true'),
    readOnly,
    required,
  });
  const normalizedMarks = normalizeMarks(marks);
  const hasMarks = normalizedMarks.length > 0;
  const isDual = Array.isArray(value);
  const range = max - min || 1;
  const singleValue = clamp(toFiniteNumber(value, min), min, max);
  const lowerValue = isDual ? clamp(toFiniteNumber(value[0], min), min, max) : min;
  const upperValue = isDual ? clamp(toFiniteNumber(value[1], max), min, max) : singleValue;
  const startPercent = (((isDual ? lowerValue : min) - min) / range) * 100;
  const endPercent = ((upperValue - min) / range) * 100;
  const background = `linear-gradient(to right, transparent 0%, transparent ${startPercent}%, var(--color-hf-yellow) ${startPercent}%, var(--color-hf-yellow) ${endPercent}%, transparent ${endPercent}%, transparent 100%)`;
  const stepValue = step ?? 1;
  const listId = hasMarks ? datalistId : undefined;
  const commitValue = (nextValue: RangeValue) => {
    if (!field.readOnly) onCommit?.(nextValue);
  };

  return (
    <div className={cx('px-4 pb-1 pt-2', className)}>
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-modiff-disabled/30" />
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full" style={{ background }} />
        {isDual ? (
          <>
            <input
              type="range"
              id={field.id}
              aria-label={`Lower ${ariaLabel}`}
              aria-describedby={field.ariaDescribedBy}
              aria-errormessage={field.ariaErrorMessage}
              aria-invalid={field.invalid || undefined}
              aria-readonly={field.readOnly || undefined}
              aria-required={field.required || undefined}
              className={rangeInputClassName}
              min={min}
              max={max}
              step={stepValue}
              value={lowerValue}
              disabled={field.disabled}
              list={listId}
              onChange={(event) => {
                if (field.readOnly) return;
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
              id={field.id ? `${field.id}-upper` : undefined}
              aria-label={`Upper ${ariaLabel}`}
              aria-describedby={field.ariaDescribedBy}
              aria-errormessage={field.ariaErrorMessage}
              aria-invalid={field.invalid || undefined}
              aria-readonly={field.readOnly || undefined}
              aria-required={field.required || undefined}
              className={rangeInputClassName}
              min={min}
              max={max}
              step={stepValue}
              value={upperValue}
              disabled={field.disabled}
              list={listId}
              onChange={(event) => {
                if (field.readOnly) return;
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
            id={field.id}
            aria-label={ariaLabel}
            aria-describedby={field.ariaDescribedBy}
            aria-errormessage={field.ariaErrorMessage}
            aria-invalid={field.invalid || undefined}
            aria-readonly={field.readOnly || undefined}
            aria-required={field.required || undefined}
            className={rangeInputClassName}
            min={min}
            max={max}
            step={stepValue}
            value={singleValue}
            disabled={field.disabled}
            list={listId}
            onChange={(event) => {
              if (!field.readOnly) onChange(toFiniteNumber(event.target.value, singleValue));
            }}
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
