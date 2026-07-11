import { useEffect, useId, useMemo, useState } from 'react';
import { FieldProps } from '../components/NodeContent';
import { X } from 'lucide-react';
import fieldAction from '../utils/fieldAction';
import { useInitialFieldAction } from '../utils/useInitialFieldAction';
import { FieldFrame } from '../ui';
import { cx } from '../utils/classNames';

type OptionRecord = Record<string, unknown>;
type NormalizedOption = {
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
      .map((option, index) => ({
        id: optionText(getOptionKey(option, idKey), index),
        label: optionText(getOptionLabel(option, labelKey), optionText(getOptionKey(option, idKey), index)),
        value: getOptionValue(option, valueKey) ?? getOptionKey(option, idKey) ?? index,
      }))
      .filter((option) => option.id !== undefined && option.id !== null && option.id !== '');
  }
  if (typeof options === 'object') {
    return Object.entries(options)
      .map(([key, value]) => ({
        id: key,
        label: optionText(getOptionLabel(value, labelKey), key),
        value: getOptionValue(value, valueKey) ?? key,
      }))
      .filter((option) => option.id !== undefined && option.id !== null && option.id !== '');
  }
  return [];
}

export default function AutocompleteField(props: FieldProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const reactId = useId();
  const inputId = `${props.nodeId}-${props.fieldKey}`;
  const listId = `${inputId}-${reactId.replace(/:/g, '')}`;

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
    return fieldOptions.find((option) => option.id === id);
  }

  function findOptionByInput(value: string) {
    return fieldOptions.find(
      (option) => String(option.label) === value || String(option.id) === value || String(option.value) === value,
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

  const removeMultipleValue = (id: string) => {
    const newValue = selectedOptions.filter((option) => String(option.id) !== id);
    props.updateStore(props.fieldKey, parseReturnedValue(newValue));
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

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      disabled={props.disabled}
      layoutStyle={props.style}
      className="modiff-field"
    >
      <div
        className={cx(
          'flex w-full items-center justify-between overflow-hidden rounded-modiff-compact bg-modiff-bg px-2 py-1 outline outline-2',
          isFocused ? 'outline-hf-yellow' : 'outline-transparent',
        )}
      >
        <label
          htmlFor={inputId}
          className="pointer-events-none max-w-[50%] truncate pr-2 text-[13px] text-gray-400"
          title={props.label}
        >
          {props.label}
        </label>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {multiple &&
            selectedOptions.map((option) => (
              <span
                key={String(option.id)}
                className="inline-flex max-w-full items-center gap-1 rounded-modiff-compact bg-modiff-panel px-2 py-0.5 text-xs text-modiff-text"
              >
                <span className="truncate">{String(option.label)}</span>
                <button
                  type="button"
                  className="grid size-4 place-items-center rounded-full text-gray-400 hover:bg-white/10 hover:text-white"
                  onClick={() => removeMultipleValue(String(option.id))}
                  aria-label={`Remove ${option.label}`}
                  title={`Remove ${option.label}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          <input
            id={inputId}
            list={listId}
            value={inputValue}
            disabled={props.disabled}
            placeholder={stringOption(props.fieldOptions?.placeholder)}
            autoComplete="off"
            className="nodrag min-w-20 flex-1 bg-transparent p-0 text-sm text-modiff-text outline-none placeholder:text-gray-500 disabled:cursor-not-allowed"
            onChange={(event) => handleInputChange(event.target.value)}
            onFocus={(event) => {
              setIsFocused(true);
              event.currentTarget.select();
            }}
            onBlur={() => {
              setIsFocused(false);
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
          <datalist id={listId}>
            {fieldOptions
              .filter((option) => !selectedOptions.some((selected) => String(selected.id) === String(option.id)))
              .map((option) => (
                <option key={String(option.id)} value={String(option.label)} />
              ))}
          </datalist>
        </div>
      </div>
    </FieldFrame>
  );
}
