// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { useEffect, useMemo, useState } from 'react';
import { FieldProps } from '../components/NodeContent';
import fieldAction from '../utils/fieldAction';
import { useInitialFieldAction } from '../utils/useInitialFieldAction';
import { FieldFrame, ModiffCombobox, ModiffFieldShell } from '../ui';
import { isOptionDescriptor, optionDescriptorIsSelectable } from '../studio/runtimeOptions';

type OptionRecord = Record<string, unknown>;
type NormalizedOption = {
  disabled?: boolean;
  id: string | number;
  label: string | number;
  value: unknown;
};

function isRecord(value: unknown): value is OptionRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringOption(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionText(value: unknown, fallback: string | number): string | number {
  return typeof value === 'string' || typeof value === 'number' ? value : fallback;
}

function getOptionKey(option: unknown, key?: string) {
  if (isOptionDescriptor(option)) {
    return option.value;
  }
  if (typeof option === 'string') {
    return option;
  }
  if (!isRecord(option)) {
    return null;
  }
  if (key && key in option) {
    return option[key];
  }
  if ('key' in option) {
    return option.key;
  }
  if ('id' in option) {
    return option.id;
  }
  return null;
}

function getOptionLabel(option: unknown, key?: string) {
  if (typeof option === 'string') {
    return option;
  }
  if (!isRecord(option)) {
    return null;
  }
  if (key && key in option) {
    return option[key];
  }
  if ('label' in option) {
    return option.label;
  }
  if ('name' in option) {
    return option.name;
  }
  if ('title' in option) {
    return option.title;
  }
  return null;
}

function getOptionValue(option: unknown, key?: string) {
  if (typeof option === 'string') {
    return null;
  }
  if (!isRecord(option)) {
    return null;
  }
  if (key && key in option) {
    return option[key];
  }
  if ('value' in option) {
    return option.value;
  }
  return null;
}

function toOptionObj(val: unknown): NormalizedOption | null {
  if (!val) return null;
  if (typeof val === 'string') {
    return { id: val, label: val, value: val };
  }
  if (!isRecord(val) || val.id === undefined || val.id === null) return null;
  return {
    id: String(val.id),
    label: typeof val.label === 'string' || typeof val.label === 'number' ? val.label : String(val.id),
    value: val.value ?? val.id,
  };
}

// props.options can be a string, an array, an object or an array of objects
// normalize it into an array of objects in the following format:
// [{ id: 'id', label: 'label', value: 'value' }, ...]
function normalizeOptions(options: unknown, idKey?: string, labelKey?: string, valueKey?: string): NormalizedOption[] {
  if (!options) return [];
  if (options && typeof options === 'string') {
    return [{ id: options, label: options, value: options }];
  }
  if (Array.isArray(options)) {
    return options
      .map((option, index) =>
        isOptionDescriptor(option)
          ? {
              id: option.value,
              label: option.label,
              value: option.value,
              disabled: !optionDescriptorIsSelectable(option),
            }
          : {
              id: optionText(getOptionKey(option, idKey), index),
              label: optionText(getOptionLabel(option, labelKey), optionText(getOptionKey(option, idKey), index)),
              value: getOptionValue(option, valueKey) ?? getOptionKey(option, idKey) ?? index,
            },
      )
      .filter((option) => option.id !== undefined && option.id !== null && option.id !== '');
  }
  if (typeof options === 'object') {
    return Object.entries(options)
      .filter(([key]) => !key.startsWith('__'))
      .map(([key, value]) =>
        isOptionDescriptor(value)
          ? {
              id: value.value,
              label: value.label,
              value: value.value,
              disabled: !optionDescriptorIsSelectable(value),
            }
          : {
              id: key,
              label: optionText(getOptionLabel(value, labelKey), key),
              value: getOptionValue(value, valueKey) ?? key,
            },
      )
      .filter((option) => option.id !== undefined && option.id !== null && option.id !== '');
  }
  return [];
}

export default function AutocompleteField(props: FieldProps) {
  const [inputValue, setInputValue] = useState('');
  const inputId = props.inputId ?? `${props.nodeId}-${props.fieldKey}`;

  const idKey = stringOption(props.fieldOptions?.optionKey);
  const labelKey = stringOption(props.fieldOptions?.optionLabel);
  const valueKey = stringOption(props.fieldOptions?.optionValue);

  const multiple = Boolean(props.fieldOptions?.multiple);
  const freeSolo = Boolean(props.fieldOptions?.noValidation);

  const fieldOptions = useMemo(
    () => normalizeOptions(props.options, idKey, labelKey, valueKey),
    [props.options, idKey, labelKey, valueKey],
  );
  const fieldValue = (() => {
    const processValue = (val: unknown) => {
      if (val === null || val === undefined || val === '') return null;

      if (typeof val === 'string') {
        const opt = findOptionById(val);
        if (opt) return opt;
        return freeSolo ? toOptionObj(val) : null;
      }

      if (isRecord(val) && val.id) {
        const opt = findOptionById(String(val.id));
        if (opt) return opt;
      }

      return freeSolo ? toOptionObj(val) : null;
    };

    if (multiple) {
      if (!props.value) return [];
      const valueAsArray = Array.isArray(props.value) ? props.value : [props.value];
      return valueAsArray.map(processValue).filter((option): option is NormalizedOption => Boolean(option));
    } else {
      return processValue(props.value);
    }
  })();

  function parseReturnedValue(value: unknown) {
    if (!value) return null;

    if (typeof value === 'string') {
      if (freeSolo && !multiple) return value;
      return freeSolo ? { id: value, value } : null;
    }
    if (Array.isArray(value)) {
      return value.map((option) =>
        isRecord(option) && option.id === option.value
          ? option.id
          : isRecord(option)
            ? { id: option.id, value: option.value }
            : option,
      );
    }
    if (isRecord(value)) {
      return value.id === value.value ? value.id : { id: value.id, value: value.value };
    }
    return null;
  }

  function findOptionById(id: string) {
    return fieldOptions.find((option) => String(option.id) === id);
  }

  function findOptionByInput(value: string) {
    return fieldOptions.find(
      (option) =>
        !option.disabled &&
        (String(option.label) === value || String(option.id) === value || String(option.value) === value),
    );
  }

  const selectedOptions = multiple ? (Array.isArray(fieldValue) ? fieldValue : []) : [];
  const singleOption = !multiple && fieldValue && !Array.isArray(fieldValue) ? fieldValue : null;
  const singleLabel = singleOption ? String(singleOption.label ?? singleOption.id ?? '') : '';

  useEffect(() => {
    setInputValue(multiple ? '' : singleLabel);
  }, [multiple, singleLabel]);

  const commitSingleValue = (rawValue: string) => {
    const value = rawValue.trim();
    fieldAction(props, value);

    if (!value) {
      props.updateStore(props.fieldKey, freeSolo ? '' : null);
      setInputValue('');
      return;
    }

    const option = findOptionByInput(value);
    if (option) {
      props.updateStore(props.fieldKey, parseReturnedValue(option));
      setInputValue(String(option.label));
      return;
    }

    if (freeSolo) {
      props.updateStore(props.fieldKey, value);
    } else {
      setInputValue(singleLabel);
    }
  };

  const appendMultipleValue = (rawValue: string) => {
    const value = rawValue.trim();
    if (!value) return;

    const option = findOptionByInput(value) || (freeSolo ? toOptionObj(value) : null);
    if (!option) {
      setInputValue('');
      return;
    }

    const optionId = String(option.id);
    if (selectedOptions.some((selected) => String(selected.id) === optionId)) {
      setInputValue('');
      return;
    }

    const newValue = [...selectedOptions, option];
    props.updateStore(props.fieldKey, parseReturnedValue(newValue));
    fieldAction(props, value);
    setInputValue('');
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);
    fieldAction(props, value);

    if (multiple) {
      const option = findOptionByInput(value);
      if (option) appendMultipleValue(value);
      return;
    }

    if (freeSolo) {
      props.updateStore(props.fieldKey, value);
      return;
    }

    const option = findOptionByInput(value);
    if (option) {
      props.updateStore(props.fieldKey, parseReturnedValue(option));
    }
  };

  useInitialFieldAction(props);

  const selectedValue = multiple
    ? selectedOptions.map((option) => String(option.id))
    : singleOption
      ? String(singleOption.id)
      : null;

  const handleSelectionChange = (nextValue: string | string[] | null) => {
    if (multiple) {
      const nextOptions = (Array.isArray(nextValue) ? nextValue : [])
        .map((id) => findOptionById(id))
        .filter((option): option is NormalizedOption => Boolean(option));
      props.updateStore(props.fieldKey, parseReturnedValue(nextOptions));
      fieldAction(props, nextOptions.map((option) => String(option.label)).join(', '));
      setInputValue('');
      return;
    }

    const option = typeof nextValue === 'string' ? findOptionById(nextValue) : null;
    if (!option) {
      props.updateStore(props.fieldKey, freeSolo ? inputValue : null);
      if (!freeSolo) setInputValue('');
      return;
    }
    props.updateStore(props.fieldKey, parseReturnedValue(option));
    fieldAction(props, String(option.label));
    setInputValue(String(option.label));
  };

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
        className="flex w-full items-center"
      >
        <ModiffCombobox
          id={inputId}
          aria-label={props.label}
          className="min-w-0"
          disabled={props.disabled}
          emptyMessage={stringOption(props.fieldOptions?.emptyMessage)}
          multiple={multiple}
          options={fieldOptions.map((option) => ({
            value: String(option.id),
            label: String(option.label),
            disabled: option.disabled,
          }))}
          placeholder={stringOption(props.fieldOptions?.placeholder)}
          query={inputValue}
          value={selectedValue}
          onQueryChange={handleInputChange}
          onValueChange={handleSelectionChange}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => {
            if (multiple) {
              if (freeSolo) appendMultipleValue(inputValue);
              else setInputValue('');
            } else if (!freeSolo) {
              commitSingleValue(inputValue);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && multiple) {
              event.preventDefault();
              appendMultipleValue(inputValue);
            }
            if (event.key === 'Escape') {
              setInputValue(multiple ? '' : singleLabel);
            }
          }}
        />
      </ModiffFieldShell>
    </FieldFrame>
  );
}
