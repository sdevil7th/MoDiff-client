// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { FieldProps } from '../components/NodeContent';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { FieldFrame, ModiffFieldShell } from '../ui';
import { GraphControlInput } from '../ui/GraphControls';
import { cx } from '../utils/classNames';

export default function InputField(props: FieldProps) {
  const [isFocused, setIsFocused] = useState(false);
  const inputId = useId();
  const numeric = props.dataType.startsWith('int') || props.dataType === 'float' || props.dataType === 'number';
  const fieldValue = props.value === null || props.value === undefined ? '' : String(props.value);
  const [draftValue, setDraftValue] = useState(fieldValue);
  const skipNextCommitRef = useRef(false);
  const { fieldKey, updateStore } = props;

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(fieldValue);
    }
  }, [fieldValue, isFocused]);

  const commitValue = useCallback(
    (value: string) => {
      if (value !== fieldValue) {
        updateStore(fieldKey, value);
      }
    },
    [fieldKey, fieldValue, updateStore],
  );

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      disabled={props.disabled}
      layoutStyle={props.style}
      className="modiff-field"
    >
      <ModiffFieldShell
        htmlFor={inputId}
        label={props.label}
        layout="inline"
        disabled={props.disabled}
        labelClassName="text-modiff-control pointer-events-none max-w-[50%] truncate pr-2 font-normal"
        className={cx(
          'flex w-full items-center justify-between overflow-hidden rounded-modiff-compact bg-modiff-bg px-2 py-1 outline outline-2',
          isFocused ? 'outline-hf-yellow' : 'outline-transparent',
        )}
      >
        <GraphControlInput
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          autoComplete="off"
          className={cx(
            'nodrag min-w-0 flex-1 bg-transparent p-0 text-sm text-modiff-text outline-none disabled:cursor-not-allowed',
            numeric && 'text-right',
          )}
          onFocus={() => setIsFocused(true)}
          onBlur={(event) => {
            setIsFocused(false);
            if (skipNextCommitRef.current) {
              skipNextCommitRef.current = false;
              return;
            }
            commitValue(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              skipNextCommitRef.current = true;
              setDraftValue(fieldValue);
              event.currentTarget.blur();
            }
          }}
        />
      </ModiffFieldShell>
    </FieldFrame>
  );
}
