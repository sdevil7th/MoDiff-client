// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { FieldProps } from '../components/NodeContent';
import { useEffect, useMemo, useState } from 'react';

import { FieldFrame, ModiffFieldShell, RangeSliderFrame } from '../ui';
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
      <ModiffFieldShell
        htmlFor={`${props.nodeId}-${props.fieldKey}`}
        label={props.label}
        disabled={props.disabled}
        labelClassName="px-2 pt-1 font-normal"
        className="rounded-modiff-compact bg-modiff-bg"
      >
        <div className="flex w-full items-center justify-between px-2">
          {valueText.start !== undefined ? (
            <output className="text-modiff-control leading-none text-modiff-text">{valueText.start}</output>
          ) : (
            <span />
          )}
          <output className="text-modiff-control leading-none text-modiff-text">{valueText.end}</output>
        </div>
        <RangeSliderFrame
          id={`${props.nodeId}-${props.fieldKey}`}
          aria-label={props.label}
          className="nodrag nowheel"
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
      </ModiffFieldShell>
    </FieldFrame>
  );
}
