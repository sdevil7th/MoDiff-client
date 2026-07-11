import { FieldProps } from '../components/NodeContent';

import fieldAction from '../utils/fieldAction';
import { LoaderCircle } from 'lucide-react';
import { useInitialFieldAction } from '../utils/useInitialFieldAction';
import { FieldFrame } from '../ui';
import { cx } from '../utils/classNames';

type SelectOptionEntry =
  { id: string; label: string; type: 'header' } | { label: string; type: 'option'; value: string };

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

function optionLabel(value: unknown) {
  if (typeof value === 'object' && value !== null) {
    const option = value as { label?: unknown; name?: unknown; title?: unknown };
    return String(option.label || option.name || option.title || '');
  }
  return String(value);
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

  const entries: SelectOptionEntry[] = (
    Array.isArray(props.options)
      ? props.options.map((option: unknown) => ({
          type: 'option' as const,
          value: String(option),
          label: productOptionLabel(props.fieldKey, String(option), String(option)),
        }))
      : Object.entries(props.options).map(([key, value]) =>
          key.startsWith('__')
            ? { type: 'header' as const, id: key, label: optionLabel(value) }
            : {
                type: 'option' as const,
                value: key,
                label: productOptionLabel(props.fieldKey, key, optionLabel(value)),
              },
        )
  ).filter((entry) => props.fieldKey !== 'offload_mode' || entry.type === 'header' || entry.value !== 'auto_cpu');

  const optionEntries = entries.filter(
    (entry): entry is Extract<SelectOptionEntry, { type: 'option' }> => entry.type === 'option',
  );
  const validOptions = optionEntries.map((entry) => entry.value);

  const fieldValue = multiple
    ? Array.isArray(currValue)
      ? currValue.map(String).filter((v) => validOptions.includes(v))
      : []
    : validOptions.includes(String(currValue))
      ? String(currValue)
      : '';

  const selectedLabels = Array.isArray(fieldValue)
    ? fieldValue.map((value) => optionEntries.find((entry) => entry.value === value)?.label || value)
    : [];

  const handleOnChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    props.updateStore(props.fieldKey, e.target.value);
    fieldAction(props, e.target.value);
  };

  const handleMultiChange = (value: string, checked: boolean) => {
    const current = Array.isArray(fieldValue) ? fieldValue : [];
    const newValue = checked ? [...current, value] : current.filter((entry) => entry !== value);
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
      <div className="flex w-full items-center justify-between gap-2 overflow-visible rounded-modiff-compact bg-modiff-bg px-2 py-1">
        <div className="pointer-events-none max-w-[50%] pr-1">
          <label htmlFor={props.nodeId + '-' + props.fieldKey}>{props.label}</label>
        </div>
        {multiple ? (
          <details className="nodrag relative min-w-0 flex-1">
            <summary className="flex min-h-7 cursor-pointer list-none items-center rounded-modiff-compact border border-transparent px-1 text-sm text-modiff-text outline-none hover:border-modiff-border focus:border-hf-yellow [&::-webkit-details-marker]:hidden">
              {selectedLabels.length === 0 ? (
                <span className="truncate text-gray-400">{placeholder || 'Select...'}</span>
              ) : (
                <span className="flex min-w-0 flex-wrap gap-1">
                  {selectedLabels.map((label) => (
                    <span
                      key={label}
                      className="max-w-32 truncate rounded-modiff-compact bg-modiff-panel px-2 py-0.5 text-xs"
                    >
                      {label}
                    </span>
                  ))}
                </span>
              )}
            </summary>
            <div className="absolute right-0 z-40 mt-1 max-h-72 min-w-full overflow-auto rounded-modiff-panel border border-modiff-border bg-modiff-surface p-1 shadow-modiff-node">
              {placeholder ? <div className="px-2 py-1 text-sm italic text-gray-500">{placeholder}</div> : null}
              {entries.map((entry) =>
                entry.type === 'header' ? (
                  <div
                    key={entry.id}
                    className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {entry.label}
                  </div>
                ) : (
                  <label
                    key={entry.value}
                    className="flex cursor-pointer items-center gap-2 rounded-modiff-compact px-2 py-1 text-sm text-modiff-text hover:bg-white/10"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-hf-yellow"
                      checked={Array.isArray(fieldValue) && fieldValue.includes(entry.value)}
                      onChange={(event) => handleMultiChange(entry.value, event.target.checked)}
                    />
                    <span className="min-w-0 truncate">{entry.label}</span>
                  </label>
                ),
              )}
            </div>
          </details>
        ) : optionEntries.length === 1 ? (
          <span className="min-w-0 flex-1 truncate px-1 py-1 text-sm text-modiff-text">{optionEntries[0]?.label}</span>
        ) : (
          <select
            id={props.nodeId + '-' + props.fieldKey}
            value={fieldValue}
            disabled={props.disabled}
            onChange={handleOnChange}
            autoComplete="off"
            className={cx(
              'nodrag min-w-0 flex-1 rounded-modiff-compact border border-transparent bg-transparent px-1 py-1 text-sm text-modiff-text outline-none hover:border-modiff-border focus:border-hf-yellow disabled:cursor-not-allowed',
              fieldValue === '' && 'text-gray-400',
            )}
          >
            {placeholder ? (
              <option value="" disabled>
                {placeholder}
              </option>
            ) : null}
            {entries.map((entry) =>
              entry.type === 'header' ? (
                <option key={entry.id} value={entry.id} disabled>
                  {entry.label}
                </option>
              ) : (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ),
            )}
          </select>
        )}
      </div>
      {props.disabled && Boolean(props.fieldOptions?.loading) && (
        <LoaderCircle size={16} className="absolute right-1.5 top-1.5 animate-spin bg-modiff-bg text-hf-yellow" />
      )}
    </FieldFrame>
  );
}
