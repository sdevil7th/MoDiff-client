import { FieldProps } from '../components/NodeContent';
import { useEffect, useMemo, useState } from 'react';

import { FieldFrame, RangeSliderFrame } from '../ui';
import { deepEqual } from '../utils/deepEqual';

type RangeValue = number | [number, number];

export default function RangeField(props: FieldProps) {
  const normalizedValue: RangeValue = useMemo(() => {
    const rangeValue = Array.isArray(props.value)
      ? props.value.filter((item): item is number => typeof item === 'number')
      : typeof props.value === 'number'
        ? props.value
        : 0;
    return Array.isArray(rangeValue) ? [rangeValue[0] ?? 0, rangeValue[1] ?? rangeValue[0] ?? 0] : rangeValue;
  }, [props.value]);
  const [draftValue, setDraftValue] = useState<RangeValue>(normalizedValue);

  useEffect(() => {
    setDraftValue((currentValue) => (deepEqual(currentValue, normalizedValue) ? currentValue : normalizedValue));
  }, [normalizedValue]);

  const valueText = Array.isArray(draftValue)
    ? { start: draftValue[0], end: draftValue[1] }
    : { start: undefined, end: draftValue };

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      disabled={props.disabled}
      layoutStyle={props.style}
      className="modiff-field"
    >
      <div className="relative flex w-full items-center justify-between">
        {valueText.start !== undefined ? (
          <span className="rounded-modiff-compact bg-modiff-bg px-2 py-1 text-[13px] leading-none text-modiff-text">
            {valueText.start}
          </span>
        ) : (
          <span />
        )}
        <span
          className="absolute left-1/2 max-w-[60%] -translate-x-1/2 truncate px-2 py-1 text-[13px] leading-none text-gray-400"
          title={props.label}
        >
          {props.label}
        </span>
        <span className="rounded-modiff-compact bg-modiff-bg px-2 py-1 text-[13px] leading-none text-modiff-text">
          {valueText.end}
        </span>
      </div>
      <RangeSliderFrame
        className="nodrag"
        disabled={props.disabled}
        value={draftValue}
        onChange={setDraftValue}
        onCommit={(value) => props.updateStore(props.fieldKey, value)}
        min={props.min}
        max={props.max}
        step={props.step}
        marks={
          Array.isArray(props.fieldOptions?.marks) || typeof props.fieldOptions?.marks === 'boolean'
            ? props.fieldOptions.marks
            : false
        }
      />
    </FieldFrame>
  );
}
