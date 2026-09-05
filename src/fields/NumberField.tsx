// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { useRef, useState, useEffect, useCallback } from 'react';

import { FieldProps } from '../components/NodeContent';
import getDecimalPlaces from '../utils/getDecimalPlaces';

import { FieldFrame, ModiffFieldShell, NumberFieldFrame } from '../ui';
import { GraphControlInput, GraphIconButton } from '../ui/GraphControls';
import { cx } from '../utils/classNames';

import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function NumberField(props: FieldProps) {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragStartRef = useRef<{ x: number; value: number; moved: boolean; currentValue: number } | null>(null);
  const skipNextCommitRef = useRef(false);
  const { default: defaultValue, fieldKey, updateStore, value: fieldValue } = props;
  const numericDefault = Number.isFinite(Number(defaultValue)) ? Number(defaultValue) : 0;

  const isSlider = props.fieldType === 'slider' && props.min !== undefined && props.max !== undefined;
  const minValue = props.min !== undefined ? props.min : -Number.MAX_SAFE_INTEGER;
  const maxValue = props.max !== undefined ? props.max : Number.MAX_SAFE_INTEGER;
  const decimals = props.dataType === 'float' ? getDecimalPlaces(props.step) : 0;
  const increment = props.step !== undefined ? props.step : props.dataType === 'float' ? 0.1 : 1;
  const inputId = `${props.nodeId}-${props.fieldKey}`;

  const formatValue = useCallback(
    (value: number | string, force: boolean = false) => {
      if (isFocused && !force) {
        return value;
      }
      const newValue = isNaN(Number(value)) ? numericDefault : Number(value);
      return Math.min(maxValue, Math.max(minValue, newValue)).toFixed(decimals);
    },
    [decimals, numericDefault, isFocused, maxValue, minValue],
  );
  const committedValue = formatValue(
    typeof fieldValue === 'number' || typeof fieldValue === 'string' ? fieldValue : numericDefault,
    true,
  );
  const [draftValue, setDraftValue] = useState(String(committedValue));

  useEffect(() => {
    if (!isFocused && !dragStartRef.current) {
      setDraftValue(String(committedValue));
    }
  }, [committedValue, isFocused]);

  const commitValue = useCallback(
    (value: number | string) => {
      const nextValue = String(formatValue(value, true));
      setDraftValue(nextValue);
      updateStore(fieldKey, nextValue);
      return nextValue;
    },
    [fieldKey, formatValue, updateStore],
  );

  const handleChevronClick = useCallback(
    (direction: 'left' | 'right') => {
      if (!inputRef.current) return;

      const nextValue =
        direction === 'left' ? Number(inputRef.current.value) - increment : Number(inputRef.current.value) + increment;
      const inputWasFocused = document.activeElement === inputRef.current;
      if (inputWasFocused) {
        skipNextCommitRef.current = true;
        inputRef.current.blur();
      }
      setIsFocused(false);
      commitValue(nextValue);
    },
    [commitValue, increment],
  );

  const activeValue = isFocused || dragStartRef.current ? draftValue : props.value;
  const sliderPercent = isSlider
    ? isNaN(Number(activeValue))
      ? 0
      : ((Number(activeValue) - minValue) / (maxValue - minValue)) * 100
    : undefined;

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (!dragStartRef.current) return;

      if (document.activeElement === inputRef.current) {
        setIsFocused(false);
        inputRef.current?.blur();
      }

      const deltaX = e.clientX - dragStartRef.current.x;
      // ignore small movements

      if (Math.abs(deltaX) < 3) return;
      dragStartRef.current.moved = true;

      const range = maxValue - minValue;
      const step = range / increment || 100; // increment * (range / 100);
      const valueRange = isSlider ? (step / 250) * deltaX : deltaX;
      const newValue = dragStartRef.current.value + valueRange * increment;

      dragStartRef.current.currentValue = Number(formatValue(newValue, true));
      setDraftValue(String(formatValue(newValue, true)));
    },
    [formatValue, increment, isSlider, maxValue, minValue],
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dragState = dragStartRef.current;

      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      if (dragState.moved) {
        commitValue(dragState.currentValue);
        dragStartRef.current = null;
        return;
      }

      // check if the mouseup event was triggered by the current field
      const targetField = (e.target as HTMLElement).closest('.modiff-field');
      const targetButton = (e.target as HTMLElement).closest('button');
      if (isSlider && targetField && !targetButton) {
        const rect = targetField.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const relPos = Math.max(0, Math.min(1, x / rect.width));
        const newValue = minValue + (maxValue - minValue) * relPos;
        commitValue(newValue);
      } else {
        setDraftValue(String(committedValue));
      }

      dragStartRef.current = null;
    },
    [commitValue, committedValue, handleMouseMove, isSlider, maxValue, minValue],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      // only handle left mouse button
      if (e.button !== 0) return;

      if (isFocused) return;
      // blur any currently focused element
      (document.activeElement as HTMLElement)?.blur();

      const startValue = Number(isFocused ? draftValue : fieldValue);
      dragStartRef.current = {
        x: e.clientX,
        value: Number.isFinite(startValue) ? startValue : numericDefault,
        moved: false,
        currentValue: Number.isFinite(startValue) ? startValue : numericDefault,
      };
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [draftValue, fieldValue, handleMouseMove, handleMouseUp, isFocused, numericDefault],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const input = e.currentTarget;

      if (e.key === 'Enter' || e.key === 'Escape') {
        if (e.key === 'Enter') {
          commitValue(input.value);
        } else {
          skipNextCommitRef.current = true;
          setDraftValue(String(committedValue));
        }
        input.blur();
        setIsFocused(false);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const newValue = formatValue(Number(input.value) + increment, true);
        setDraftValue(String(newValue));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const newValue = formatValue(Number(input.value) - increment, true);
        setDraftValue(String(newValue));
      }
    },
    [commitValue, committedValue, formatValue, increment],
  );

  const handleBlur = useCallback(() => {
    setIsFocused(false);

    if (!inputRef.current) return;
    if (skipNextCommitRef.current) {
      skipNextCommitRef.current = false;
      return;
    }

    commitValue(inputRef.current.value);
  }, [commitValue]);

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;

    if (!inputRef.current) return;

    inputRef.current.select();
    inputRef.current.focus();
  }, []);

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      disabled={props.disabled}
      layoutStyle={props.style}
      className="modiff-field bg-modiff-bg"
    >
      <NumberFieldFrame
        focused={isFocused}
        sliderPercent={sliderPercent}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <GraphIconButton
          type="button"
          disabled={Number(props.value) <= minValue}
          onClick={() => handleChevronClick('left')}
          className="shrink-0 disabled:opacity-35"
          label={`Decrease ${props.label}`}
        >
          <ChevronLeft size={16} />
        </GraphIconButton>
        <ModiffFieldShell
          htmlFor={inputId}
          label={props.label}
          layout="inline"
          disabled={props.disabled}
          className="min-w-0 flex-1"
          labelClassName="text-modiff-control pointer-events-none max-w-[50%] truncate pr-1 font-normal"
        >
          <GraphControlInput
            ref={inputRef}
            id={inputId}
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            autoComplete="off"
            className={cx(
              'nodrag min-w-0 flex-1 cursor-default bg-transparent p-0 text-right text-sm text-modiff-text outline-none disabled:cursor-not-allowed',
            )}
            onFocus={() => {
              setIsFocused(true);
              setDraftValue(String(committedValue));
            }}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
          />
        </ModiffFieldShell>
        <GraphIconButton
          type="button"
          disabled={Number(props.value) >= maxValue}
          onClick={() => handleChevronClick('right')}
          className="shrink-0 disabled:opacity-35"
          label={`Increase ${props.label}`}
        >
          <ChevronRight size={16} />
        </GraphIconButton>
      </NumberFieldFrame>
    </FieldFrame>
  );
}
