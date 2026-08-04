// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import type { ReactNode } from 'react';
import { FieldProps } from '../components/NodeContent';
import fieldAction from '../utils/fieldAction';
import { useInitialFieldAction } from '../utils/useInitialFieldAction';
import { FieldFrame, ModiffCheckbox, ModiffSwitch } from '../ui';
import { cx } from '../utils/classNames';
import { runtimeOptionEntries } from '../studio/runtimeOptions';

export default function ToggleField(props: FieldProps) {
  const isCheckbox = props.fieldType === 'checkbox';
  const multiOptions =
    !Array.isArray(props.options) && typeof props.options === 'object'
      ? runtimeOptionEntries(props.options).filter((entry) => entry.type === 'option')
      : null;
  const selectedValues = Array.isArray(props.value) ? props.value : [];

  const handleOnChange = (checked: boolean, key?: string) => {
    if (multiOptions) {
      const newValue = checked ? [...selectedValues, key] : selectedValues.filter((k: string) => k !== key);
      props.updateStore(props.fieldKey, newValue);
      fieldAction(props, newValue);
    } else {
      props.updateStore(props.fieldKey, checked);
      fieldAction(props, checked.toString());
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
        <ToggleControl
          checked={Boolean(props.value)}
          disabled={props.disabled}
          isCheckbox={isCheckbox}
          label={<span className="min-w-0 truncate">{props.label}</span>}
          onChange={(checked) => handleOnChange(checked)}
          className="w-full rounded-modiff-compact px-2 py-1"
        />
      ) : (
        <>
          <div className="text-modiff-label text-modiff-subtle-text">{props.label}</div>
          <div
            className={cx(
              'flex w-full flex-wrap gap-1 p-1',
              props.fieldOptions?.direction === 'column' ? 'flex-col' : 'flex-row',
            )}
          >
            {multiOptions.map((option) => (
              <ToggleControl
                key={option.key}
                checked={selectedValues.includes(option.value)}
                disabled={props.disabled || option.disabled}
                isCheckbox={isCheckbox}
                label={
                  <span className="min-w-0 truncate" title={option.disabledReason}>
                    {option.label}
                  </span>
                }
                onChange={(checked) => handleOnChange(checked, option.value)}
                className="pr-2"
              />
            ))}
          </div>
        </>
      )}
    </FieldFrame>
  );
}

function ToggleControl({
  checked,
  className,
  disabled,
  isCheckbox,
  label,
  onChange,
}: {
  checked: boolean;
  className?: string;
  disabled?: boolean;
  isCheckbox: boolean;
  label: ReactNode;
  onChange: (checked: boolean) => void;
}) {
  if (isCheckbox) {
    return (
      <ModiffCheckbox
        checked={checked}
        disabled={disabled}
        label={label}
        onCheckedChange={onChange}
        className={className}
      />
    );
  }

  return (
    <ModiffSwitch
      checked={checked}
      disabled={disabled}
      label={label}
      onCheckedChange={onChange}
      className={className}
    />
  );
}
