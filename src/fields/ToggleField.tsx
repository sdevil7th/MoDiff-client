import { ChangeEvent } from 'react';
import { FieldProps } from '../components/NodeContent';
import fieldAction from '../utils/fieldAction';
import { useInitialFieldAction } from '../utils/useInitialFieldAction';
import { FieldFrame } from '../ui';
import { cx } from '../utils/classNames';

export default function ToggleField(props: FieldProps) {
  const isCheckbox = props.fieldType === 'checkbox';
  const multiOptions =
    !Array.isArray(props.options) && typeof props.options === 'object' ? Object.entries(props.options) : null;
  const selectedValues = Array.isArray(props.value) ? props.value : [];

  const handleOnChange = (e: ChangeEvent<HTMLInputElement>, key?: string) => {
    if (multiOptions) {
      const newValue = e.target.checked ? [...selectedValues, key] : selectedValues.filter((k: string) => k !== key);
      props.updateStore(props.fieldKey, newValue);
      fieldAction(props, newValue);
    } else {
      props.updateStore(props.fieldKey, e.target.checked);
      fieldAction(props, e.target.checked.toString());
    }
  };

  useInitialFieldAction(props, multiOptions ? props.value : props.value?.toString());

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      disabled={props.disabled}
      layoutStyle={props.style}
      className="modiff-field"
    >
      {!multiOptions ? (
        <label className="flex w-full cursor-pointer items-center gap-2 rounded-modiff-compact px-2 py-1 text-sm text-modiff-text">
          <ToggleControl
            checked={Boolean(props.value)}
            disabled={props.disabled}
            isCheckbox={isCheckbox}
            onChange={(event) => handleOnChange(event)}
          />
          <span className="min-w-0 truncate">{props.label}</span>
        </label>
      ) : (
        <>
          <div className="text-[13px] text-gray-400">{props.label}</div>
          <div
            className={cx(
              'flex w-full flex-wrap gap-1 p-1',
              props.fieldOptions?.direction === 'column' ? 'flex-col' : 'flex-row',
            )}
          >
            {multiOptions.map(([key, value]) => (
              <label key={key} className="flex cursor-pointer items-center gap-1.5 pr-2 text-sm text-modiff-text">
                <ToggleControl
                  checked={selectedValues.includes(key)}
                  disabled={props.disabled}
                  isCheckbox={isCheckbox}
                  onChange={(event) => handleOnChange(event, key)}
                />
                <span className="min-w-0 truncate">{String(value)}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </FieldFrame>
  );
}

function ToggleControl({
  checked,
  disabled,
  isCheckbox,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  isCheckbox: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  if (isCheckbox) {
    return (
      <input
        type="checkbox"
        className="nodrag size-4 accent-hf-yellow"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  return (
    <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
      <input
        type="checkbox"
        role="switch"
        className="peer nodrag absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="absolute inset-0 rounded-full bg-white/15 transition peer-checked:bg-hf-yellow peer-disabled:opacity-50" />
      <span className="absolute left-0.5 size-4 rounded-full bg-gray-200 transition peer-checked:translate-x-4 peer-checked:bg-black" />
    </span>
  );
}
