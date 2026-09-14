// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { FieldProps } from '../components/NodeContent';

import fieldAction from '../utils/fieldAction';
import { LoaderCircle } from 'lucide-react';
import { useInitialFieldAction } from '../utils/useInitialFieldAction';
import { FieldFrame, ModiffFieldShell, ModiffMultiSelect, ModiffSelect, type ModiffSelectOption } from '../ui';
import { runtimeOptionEntries, type RuntimeOptionEntry } from '../studio/runtimeOptions';

const OFFLOAD_LABELS: Record<string, string> = {
  none: 'Off',
  model_cpu: 'RAM/CPU model offload',
  sequential_cpu: 'RAM/CPU sequential offload',
  group_cpu: 'RAM/CPU group offload',
  group_disk: 'SSD group offload',
};

function productOptionLabel(fieldKey: string, value: string, fallback: string) {
  return fieldKey === 'offload_mode' ? (OFFLOAD_LABELS[value] ?? fallback) : fallback;
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

export default function SelectField(props: FieldProps) {
  const multiple = Boolean(props.fieldOptions?.multiple);
  const placeholder = asString(props.fieldOptions?.placeholder);
  const currValue = multiple
    ? !Array.isArray(props.value)
      ? props.value !== undefined && props.value !== null
        ? [props.value]
        : []
      : props.value
    : props.fieldKey === 'offload_mode' && props.value === 'auto_cpu'
      ? 'model_cpu'
      : props.value;

  const entries: RuntimeOptionEntry[] = runtimeOptionEntries(props.options)
    .map((entry) =>
      entry.type === 'option'
        ? { ...entry, label: productOptionLabel(props.fieldKey, entry.value, entry.label) }
        : entry,
    )
    .filter((entry) => props.fieldKey !== 'offload_mode' || entry.type === 'header' || entry.value !== 'auto_cpu');

  const configuredOptionEntries = entries.filter(
    (entry): entry is Extract<RuntimeOptionEntry, { type: 'option' }> => entry.type === 'option',
  );
  const configuredValues = configuredOptionEntries.map((entry) => entry.value);
  const currentValues = multiple
    ? Array.isArray(currValue)
      ? currValue.map(String)
      : []
    : String(currValue ?? '')
      ? [String(currValue)]
      : [];
  const unavailableEntries = currentValues
    .filter((value, index, values) => value && !configuredValues.includes(value) && values.indexOf(value) === index)
    .map((value) => ({
      type: 'option' as const,
      value,
      label: `${value} (unavailable)`,
      group: 'Unavailable saved value',
      disabled: true,
      disabledReason: 'This saved value is not available for the current node connections and runtime.',
    }));
  const optionEntries = [...configuredOptionEntries, ...unavailableEntries];
  const validOptions = optionEntries.map((entry) => entry.value);
  const selectOptions = [...entries, ...unavailableEntries].reduce<{ group?: string; options: ModiffSelectOption[] }>(
    (result, entry) => {
      if (entry.type === 'header') {
        result.group = entry.label;
      } else {
        const disabledReason = entry.disabledReason;
        result.options.push({
          value: entry.value,
          label: disabledReason ? <span title={disabledReason}>{entry.label}</span> : entry.label,
          group: entry.group ?? result.group,
          disabled: entry.disabled,
        });
      }
      return result;
    },
    { options: [] },
  ).options;

  const fieldValue = multiple
    ? Array.isArray(currValue)
      ? currValue.map(String).filter((v) => validOptions.includes(v))
      : []
    : validOptions.includes(String(currValue))
      ? String(currValue)
      : '';

  const handleOnChange = (value: string) => {
    const nextValue = props.fieldKey === 'sample_rate' && Number.isFinite(Number(value)) ? Number(value) : value;
    props.updateStore(props.fieldKey, nextValue);
    fieldAction(props, nextValue);
  };

  const handleMultiChange = (newValue: string[]) => {
    props.updateStore(props.fieldKey, newValue);
    fieldAction(props, newValue);
  };

  useInitialFieldAction(props);

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      disabled={props.disabled}
      layoutStyle={props.style}
      className="modiff-field relative"
    >
      <ModiffFieldShell
        htmlFor={props.inputId ?? props.nodeId + '-' + props.fieldKey}
        label={props.label}
        layout="inline"
        disabled={props.disabled}
        labelClassName="text-modiff-control pointer-events-none max-w-[50%] pr-1 font-normal"
        className="flex w-full items-center justify-between gap-2 overflow-visible rounded-modiff-compact bg-modiff-bg px-2 py-1"
      >
        {multiple ? (
          <ModiffMultiSelect
            id={props.inputId ?? props.nodeId + '-' + props.fieldKey}
            value={Array.isArray(fieldValue) ? fieldValue : []}
            onValueChange={handleMultiChange}
            options={selectOptions}
            disabled={props.disabled}
            placeholder={placeholder || 'Select…'}
            size="compact"
            className="min-w-0 flex-1"
            buttonClassName="border-transparent bg-transparent px-1 font-normal hover:border-modiff-border"
            optionsClassName="z-[110]"
            renderValue={(selectedOptions) => (
              <span className="flex min-w-0 flex-wrap gap-1">
                {selectedOptions.map((option) => (
                  <span
                    key={option.value}
                    className="max-w-32 truncate rounded-modiff-compact bg-modiff-panel px-2 py-0.5 text-xs"
                  >
                    {option.label}
                  </span>
                ))}
              </span>
            )}
          />
        ) : optionEntries.length === 1 ? (
          <span
            id={props.inputId ?? props.nodeId + '-' + props.fieldKey}
            className="min-w-0 flex-1 truncate px-1 py-1 text-sm text-modiff-text"
          >
            {optionEntries[0]?.label}
          </span>
        ) : (
          <ModiffSelect
            id={props.inputId ?? props.nodeId + '-' + props.fieldKey}
            value={String(fieldValue)}
            disabled={props.disabled}
            onValueChange={handleOnChange}
            options={selectOptions}
            placeholder={placeholder || 'Select…'}
            size="compact"
            className="min-w-0 flex-1"
            buttonClassName="border-transparent bg-transparent px-1 hover:border-modiff-border"
          />
        )}
      </ModiffFieldShell>
      {props.disabled && Boolean(props.fieldOptions?.loading) && (
        <LoaderCircle size={16} className="absolute right-1.5 top-1.5 animate-spin bg-modiff-bg text-hf-yellow" />
      )}
    </FieldFrame>
  );
}
