import { useMemo, useState, type ChangeEvent } from 'react';
import { FieldProps } from '../components/NodeContent';

import { ExternalLink, X } from 'lucide-react';
import { FieldFrame, ModiffButton, SelectOptionGrid } from '../ui';
import { cx } from '../utils/classNames';

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

export default function SelectDialogField(props: FieldProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [optionFilter, setOptionFilter] = useState('');
  const [showSuggestedValues, setShowSuggestedValues] = useState(false);

  const selectedValues = asStringArray(props.value);

  const normalizedOptions = useMemo(() => {
    if (Array.isArray(props.options)) {
      return (props.options || []).filter(Boolean).map((opt: unknown) => ({ id: String(opt), label: String(opt) }));
    }
    if (typeof props.options === 'object' && props.options !== null) {
      return Object.entries(props.options).map(([id, label]) => ({ id, label: String(label) }));
    }
    return [];
  }, [props.options]);

  const optionCount = normalizedOptions.length;
  const suggestedValues = useMemo(() => asStringArray(props.fieldOptions?.suggested), [props.fieldOptions?.suggested]);

  const filteredOptions = useMemo(() => {
    let options = normalizedOptions;
    if (showSuggestedValues && suggestedValues.length > 0) {
      options = options.filter((option) => suggestedValues.includes(option.id));
    }
    return options.filter((option) => option.label.toLowerCase().includes(optionFilter.toLowerCase()));
  }, [normalizedOptions, optionFilter, showSuggestedValues, suggestedValues]);

  const handleFilterChange = (event: ChangeEvent<HTMLInputElement>) => {
    setOptionFilter(event.target.value);
  };

  const handleOnDelete = (value: string) => {
    const newValue = selectedValues.filter((v: string) => v !== value);
    props.updateStore(props.fieldKey, newValue);
  };

  const maxWidth = asString(
    props.fieldOptions?.dialogMaxWidth,
    optionCount < 25 ? 'sm' : optionCount < 100 ? 'md' : 'xl',
  );
  const dialogWidthClass = maxWidth === 'sm' ? 'max-w-lg' : maxWidth === 'md' ? 'max-w-3xl' : 'max-w-6xl';
  const optionColumns = props.fieldOptions?.columns
    ? Math.min(Math.max(Number(props.fieldOptions.columns), 1), 20)
    : optionCount < 15
      ? 1
      : 3;

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
        {props.label && (
          <div className="pointer-events-none max-w-[50%] pr-2">
            <span className="block truncate text-[13px] text-gray-400" title={props.label}>
              {props.label}
            </span>
          </div>
        )}
        <div
          tabIndex={0}
          onClick={() => setIsDialogOpen(true)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="flex max-h-[898px] min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-1 overflow-y-auto"
        >
          {selectedValues.map((value) => {
            const option = normalizedOptions.find((opt) => opt.id === value);
            return (
              <span
                key={value}
                className="inline-flex max-w-full items-center gap-1 rounded-modiff-compact bg-modiff-panel px-2 py-0.5 text-xs text-modiff-text"
              >
                <span className="truncate">{option ? option.label : value}</span>
                <button
                  type="button"
                  className="grid size-4 place-items-center rounded-full text-gray-400 hover:bg-white/10 hover:text-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleOnDelete(value);
                  }}
                  aria-label={`Remove ${option ? option.label : value}`}
                  title={`Remove ${option ? option.label : value}`}
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
          {selectedValues.length === 0 && (
            <span className="text-sm text-gray-400">{asString(props.fieldOptions?.placeholder, 'Open dialog...')}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsDialogOpen(true)}
          className="nodrag grid size-7 shrink-0 place-items-center rounded-modiff-compact text-gray-300 transition hover:bg-white/10 hover:text-hf-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
          title="Open dialog"
          aria-label="Open dialog"
        >
          <ExternalLink size={16} />
        </button>
      </div>
      {isDialogOpen && (
        <div
          className="relative z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${props.nodeId}-${props.fieldKey}-dialog-title`}
        >
          <div
            className="fixed inset-0 flex items-center justify-center bg-black/70 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setIsDialogOpen(false);
            }}
          >
            <div
              className={cx(
                'max-h-[90vh] w-full overflow-hidden rounded-modiff-panel border border-modiff-border bg-modiff-surface shadow-modiff-node',
                dialogWidthClass,
              )}
            >
              <header className="flex items-center justify-between gap-3 border-b border-modiff-border bg-modiff-panel px-4 py-3">
                <h2
                  id={`${props.nodeId}-${props.fieldKey}-dialog-title`}
                  className="min-w-0 truncate text-base font-semibold text-modiff-text"
                >
                  {asString(props.fieldOptions?.dialogTitle, props.label)}
                </h2>
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded-modiff-compact text-gray-300 transition hover:bg-white/10 hover:text-white"
                  onClick={() => setIsDialogOpen(false)}
                  aria-label="Close"
                  title="Close"
                >
                  <X size={16} />
                </button>
              </header>
              <div className="relative max-h-[70vh] overflow-auto bg-modiff-panel">
                {optionCount > 50 && (
                  <div className="sticky top-0 z-[1] bg-modiff-panel p-3">
                    <input
                      className="h-8 w-full rounded-modiff-compact border border-modiff-border bg-modiff-bg px-2 text-sm text-modiff-text outline-none focus:border-hf-yellow"
                      placeholder="Filter options..."
                      value={optionFilter}
                      onChange={handleFilterChange}
                    />
                    {suggestedValues.length > 0 && (
                      <label className="mt-2 flex cursor-pointer items-center text-sm text-hf-yellow">
                        <input
                          type="checkbox"
                          className="mr-2 size-4 accent-hf-yellow"
                          checked={showSuggestedValues}
                          onChange={(event) => {
                            setOptionFilter('');
                            setShowSuggestedValues(event.target.checked);
                          }}
                        />
                        <span>Show suggested values</span>
                      </label>
                    )}
                  </div>
                )}
                <SelectOptionGrid columns={optionColumns}>
                  {filteredOptions.map((option) => {
                    const checked = selectedValues.includes(option.id);
                    const suggested = suggestedValues.includes(option.id);
                    return (
                      <label
                        key={option.id}
                        className="flex min-w-0 cursor-pointer items-center gap-2 py-1 pr-2 text-sm text-modiff-text"
                      >
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-hf-yellow"
                          checked={checked}
                          onChange={(event) => {
                            const newValue = event.target.checked
                              ? [...selectedValues, option.id]
                              : selectedValues.filter((v: string) => v !== option.id);
                            props.updateStore(props.fieldKey, newValue);
                          }}
                        />
                        <span
                          className={cx('min-w-0 truncate', (checked || suggested) && 'text-hf-yellow')}
                          title={option.label}
                        >
                          {option.label}
                        </span>
                      </label>
                    );
                  })}
                </SelectOptionGrid>
              </div>
              <footer className="flex items-center justify-end gap-2 border-t border-modiff-border bg-modiff-panel px-4 py-3">
                <span className="mr-auto text-sm text-gray-400">
                  Selected options: {selectedValues.length} / {optionCount}
                </span>
                <ModiffButton onClick={() => props.updateStore(props.fieldKey, [])}>Clear Selection</ModiffButton>
                <ModiffButton tone="primary" onClick={() => setIsDialogOpen(false)}>
                  Done
                </ModiffButton>
              </footer>
            </div>
          </div>
        </div>
      )}
    </FieldFrame>
  );
}
