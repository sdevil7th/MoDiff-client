// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { useMemo, useState, type ChangeEvent } from 'react';
import { FieldProps } from '../components/NodeContent';

import { ExternalLink, X } from 'lucide-react';
import {
  FieldFrame,
  ModiffButton,
  ModiffCheckbox,
  ModiffDialog,
  ModiffFieldShell,
  ModiffIconButton,
  ModiffSearchInput,
  SelectOptionGrid,
} from '../ui';
import { GraphControlButton, GraphIconButton } from '../ui/GraphControls';
import { cx } from '../utils/classNames';
import { runtimeOptionEntries } from '../studio/runtimeOptions';

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
    return runtimeOptionEntries(props.options)
      .filter((entry) => entry.type === 'option')
      .map((entry) => ({
        id: entry.value,
        label: entry.label,
        disabled: entry.disabled,
        disabledReason: entry.disabledReason,
      }));
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
      <ModiffFieldShell
        htmlFor={`${props.nodeId}-${props.fieldKey}`}
        label={props.label}
        layout="inline"
        disabled={props.disabled}
        labelClassName="pointer-events-none max-w-[50%] pr-2 font-normal"
        className={cx(
          'flex w-full items-center justify-between overflow-hidden rounded-modiff-compact bg-modiff-bg px-2 py-1 outline outline-2',
          isFocused ? 'outline-hf-yellow' : 'outline-transparent',
        )}
      >
        <div className="relative max-h-[898px] min-w-0 flex-1 overflow-y-auto">
          <GraphControlButton
            id={`${props.nodeId}-${props.fieldKey}`}
            type="button"
            disabled={props.disabled}
            aria-haspopup="dialog"
            aria-expanded={isDialogOpen}
            aria-label={`Choose ${props.label}`}
            className="absolute inset-0 size-full cursor-pointer rounded-modiff-compact"
            onClick={() => setIsDialogOpen(true)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          />
          <div className="pointer-events-none relative flex min-h-7 flex-wrap items-center gap-1">
            {selectedValues.map((value) => {
              const option = normalizedOptions.find((opt) => opt.id === value);
              return (
                <span
                  key={value}
                  className="inline-flex max-w-full items-center gap-1 rounded-modiff-compact bg-modiff-panel px-2 py-0.5 text-xs text-modiff-text"
                >
                  <span className="truncate">{option ? option.label : value}</span>
                  <GraphIconButton
                    type="button"
                    disabled={props.disabled}
                    className="pointer-events-auto rounded-full"
                    onClick={() => handleOnDelete(value)}
                    label={`Remove ${option ? option.label : value}`}
                  >
                    <X size={12} />
                  </GraphIconButton>
                </span>
              );
            })}
            {selectedValues.length === 0 && (
              <span className="text-sm text-modiff-subtle-text">
                {asString(props.fieldOptions?.placeholder, 'Open dialog...')}
              </span>
            )}
          </div>
        </div>
        <ModiffIconButton
          disabled={props.disabled}
          onClick={() => setIsDialogOpen(true)}
          className="nodrag text-modiff-text hover:text-hf-yellow"
          label={`Choose ${props.label}`}
          size="compact"
        >
          <ExternalLink size={16} />
        </ModiffIconButton>
      </ModiffFieldShell>
      <ModiffDialog
        open={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        title={asString(props.fieldOptions?.dialogTitle, props.label)}
        panelClassName={dialogWidthClass}
        bodyClassName="relative !max-h-[70vh] bg-modiff-panel !p-0"
        footer={
          <>
            <span className="mr-auto text-sm text-modiff-subtle-text">
              Selected options: {selectedValues.length} / {optionCount}
            </span>
            <ModiffButton disabled={props.disabled} onClick={() => props.updateStore(props.fieldKey, [])}>
              Clear Selection
            </ModiffButton>
            <ModiffButton tone="primary" onClick={() => setIsDialogOpen(false)}>
              Done
            </ModiffButton>
          </>
        }
      >
        {optionCount > 50 && (
          <div className="sticky top-0 z-[1] bg-modiff-panel p-3">
            <ModiffSearchInput
              aria-label={`Filter ${props.label} options`}
              className="nodrag nowheel"
              placeholder="Filter options..."
              value={optionFilter}
              onChange={handleFilterChange}
              onClear={() => setOptionFilter('')}
            />
            {suggestedValues.length > 0 && (
              <ModiffCheckbox
                checked={showSuggestedValues}
                label="Show suggested values"
                className="mt-2 text-hf-yellow"
                onCheckedChange={(checked) => {
                  setOptionFilter('');
                  setShowSuggestedValues(checked);
                }}
              />
            )}
          </div>
        )}
        <SelectOptionGrid columns={optionColumns}>
          {filteredOptions.map((option) => {
            const checked = selectedValues.includes(option.id);
            const suggested = suggestedValues.includes(option.id);
            return (
              <ModiffCheckbox
                key={option.id}
                checked={checked}
                className="py-1 pr-2"
                label={
                  <span
                    className={cx('min-w-0 truncate', (checked || suggested) && 'text-hf-yellow')}
                    title={option.disabledReason || option.label}
                  >
                    {option.label}
                  </span>
                }
                disabled={props.disabled || option.disabled}
                onCheckedChange={(nextChecked) => {
                  const newValue = nextChecked
                    ? [...selectedValues, option.id]
                    : selectedValues.filter((value: string) => value !== option.id);
                  props.updateStore(props.fieldKey, newValue);
                }}
              />
            );
          })}
        </SelectOptionGrid>
      </ModiffDialog>
    </FieldFrame>
  );
}
